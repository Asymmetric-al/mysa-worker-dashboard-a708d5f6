/** The sixteen named coaching mutations: the invitation and the episode it opens, the worker's own targets, the check-ins a coach may be shown, and the reviewed task summaries. */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { savePrivateDraft, shareCheckIn as openCheckInShare, updateSharedCheckIn as reviseSharedCheckIn, withdrawSharedCheckIn, type CheckIn, type CheckInAnswer, type CheckInPayload, type CheckInRefusal, type CheckInShareDuration, type CheckInSharedRevision } from "@/modules/coaching/checkin";
import { MODULE_KEYS, acceptGrant, activeGrant, endGrant, freezeShareDuration, inviteGrant, leaveGrant, revokeGrant as revokeCoachingGrant, setModuleSelection } from "@/modules/coaching/grant";
import type { CoachingAccessContext, CoachingGrant, CoachingRefusal, GrantDuration, ModuleKey, ModuleSelection, ShareDuration } from "@/modules/coaching/grant";
import { TARGET_MEASURES, resolvePeriodContaining, startProspectiveVersion, type PeriodAnchor, type TargetMeasure, type TargetPeriod, type TargetVersion } from "@/modules/coaching/target";
import { reviewTaskSummary, stopTaskShare as stopCoachingTaskShare, type TaskShare, type TaskShareRefusal } from "@/modules/coaching/taskshare";
import { parseCivilDate, serialiseCivilDate, todayInZone, type CivilDate } from "@/modules/time/civil";
import { now } from "@/modules/time/clock";
import { shareThroughDateOfCutoff } from "@/modules/time/window";
import { outcomeOfRefusal, resolveSession, type ScopeDecision, type SessionSource } from "../authorize";
import { coachingCheckInRecordSchema, coachingGrantRecordSchema, coachingTaskShareRecordSchema, coachingTargetRecordSchema, ministryIdSchema, principalIdSchema, taskRecordSchema, taskReviewedFingerprint } from "../envelope";
import type { CoachingCheckInRecord, CoachingDurationRecord, CoachingGrantRecord, CoachingTaskShareRecord, CoachingTargetRecord, MutationInput, Scope, TaskRecord } from "../envelope";
import { runMutation, type ApplyResult, type CurrentTarget, type MutationContext, type MutationName } from "../operations";
import { LOCAL_STORE_SYSTEM, ROOT_FIELD_KEY, UNIDENTIFIED_ATTEMPT, conflict, denied, invalid, unavailable, type FieldMessages, type JsonValue, type MutationOutcome, type MutationResult } from "../outcome";
const SHARE_SOURCE_ZONE = "Europe/London",
  TARGET_PLANNING_ZONE = "UTC";
const STATE_DOCUMENT_REFERENCE = "session-state",
  STATE_UNAVAILABLE_GUIDANCE = "This session's coaching records could not be read. Reload the page; if they stay unreadable, reset the development seed, which rebuilds the session documents deterministically.";
const SCOPE_ESTABLISHED: ScopeDecision = { ok: true };
/** The one runner behind every coaching mutation: the session an attempt acts for is established before a transaction opens, and every one of the sixteen declares itself under the development control's own authority. */
type CoachingSpec<R extends MutationResult> = { readonly scopeAuthority?: "grant"; readonly readCurrent?: (documents: MutationContext["docs"]) => CurrentTarget; readonly apply: (context: MutationContext) => ApplyResult<R> };
async function runCoachingMutation<P, R extends MutationResult>(input: MutationInput<P>, source: SessionSource | undefined, schema: z.ZodType<P>, name: MutationName, spec: CoachingSpec<R>): Promise<MutationOutcome> {
  const session = await mutationSessionId(source, attemptIdOf(input));
  if (!session.ok) return session.outcome;
  return runMutation<P, R>({ sessionId: session.sessionId, input, schema, name, authorize: () => SCOPE_ESTABLISHED, ...(spec.scopeAuthority === undefined ? {} : { scopeAuthority: spec.scopeAuthority }), ...(spec.readCurrent === undefined ? {} : { readCurrent: spec.readCurrent }), apply: spec.apply });
}

function revisionOrdinalOf(token: string): number {
  const digits = /(\d+)\s*$/u.exec(token);
  if (digits === null) return 1;
  const parsed = Number.parseInt(digits[1] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
const revisionOrdinalOfValue = (value: number | string): number => (typeof value === "number" ? value : revisionOrdinalOf(value)),
  nextRevisionTokenOf = (token: string): string => `rev-${String(revisionOrdinalOf(token) + 1)}`;
const FIRST_REVISION = "rev-1";

function instantOf(value: string): Temporal.Instant | null {
  try {
    return Temporal.Instant.from(value);
  } catch {
    return null;
  }
}
function civilDateOf(value: string): CivilDate | null {
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : null;
}
function planningToday(at: Temporal.Instant): CivilDate | null {
  const today = todayInZone(TARGET_PLANNING_ZONE, at);
  return today.status === "resolved" ? today.date : null;
}
function attemptIdOf(input: unknown): string {
  if (typeof input !== "object" || input === null) return UNIDENTIFIED_ATTEMPT;
  const candidate: unknown = Reflect.get(input, "operationId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : UNIDENTIFIED_ATTEMPT;
}
type SessionForMutation = { readonly ok: true; readonly sessionId: string } | { readonly ok: false; readonly outcome: MutationOutcome };

async function mutationSessionId(source: SessionSource | undefined, operationId: string): Promise<SessionForMutation> {
  if (source !== undefined) return { ok: true, sessionId: source.sessionId };
  const resolution = await resolveSession().catch(() => undefined);
  if (resolution === undefined) return { ok: false, outcome: denied({ operationId, reasonCode: "session-unavailable" }) };
  return resolution.ok ? { ok: true, sessionId: resolution.session.sessionId } : { ok: false, outcome: outcomeOfRefusal(resolution.refusal, operationId) };
}
type StateDocumentCarrier = { state: unknown };
type CoachingFamilies = {
  readonly document: Record<string, unknown>;
  readonly grants: readonly CoachingGrantRecord[];
  readonly targets: readonly CoachingTargetRecord[];
  readonly checkIns: readonly CoachingCheckInRecord[];
  readonly taskShares: readonly CoachingTaskShareRecord[];
  readonly tasks: readonly TaskRecord[];
  readonly projectionCurrencies: readonly string[];
};
type FamiliesLoad = { readonly ok: true; readonly families: CoachingFamilies } | { readonly ok: false; readonly reference: string };
function familiesOf(context: MutationContext, operationId: string): CoachingFamilies | RefusalResult {
  const loaded = readFamilies(context.docs);
  return loaded.ok ? loaded.families : refuseUnavailable(operationId, loaded.reference);
}

const plainRecordOf = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const familyOf = <T>(document: Record<string, unknown>, key: string, schema: z.ZodType<T>): readonly T[] | null => {
  const parsed = z.array(schema).safeParse(Reflect.get(document, key) ?? []);
  return parsed.success ? parsed.data : null;
};
function projectionCurrenciesOf(document: Record<string, unknown>): readonly string[] {
  const projection = plainRecordOf(Reflect.get(document, "supportProjection"));
  if (projection === null) return [];
  const exponents = plainRecordOf(Reflect.get(projection, "currencyExponents"));
  return exponents === null ? [] : Object.keys(exponents);
}
function readFamilies(carrier: StateDocumentCarrier): FamiliesLoad {
  const document = plainRecordOf(carrier.state);
  if (document === null) return { ok: false, reference: STATE_DOCUMENT_REFERENCE };
  const grants = familyOf(document, "coachingGrants", coachingGrantRecordSchema);
  if (grants === null) return { ok: false, reference: "coaching-grants" };
  const targets = familyOf(document, "coachingTargets", coachingTargetRecordSchema);
  if (targets === null) return { ok: false, reference: "coaching-targets" };
  const checkIns = familyOf(document, "coachingCheckIns", coachingCheckInRecordSchema);
  if (checkIns === null) return { ok: false, reference: "coaching-check-ins" };
  const taskShares = familyOf(document, "coachingTaskShares", coachingTaskShareRecordSchema);
  if (taskShares === null) return { ok: false, reference: "coaching-task-shares" };
  const tasks = familyOf(document, "tasks", taskRecordSchema);
  if (tasks === null) return { ok: false, reference: "tasks" };
  return { ok: true, families: { document, grants, targets, checkIns, taskShares, tasks, projectionCurrencies: projectionCurrenciesOf(document) } };
}
const withFamily = (document: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> => ({ ...document, [key]: value });
const replacingRecord = <T>(records: readonly T[], identifierOf: (record: T) => string, identifier: string, next: T): readonly T[] => records.map((record) => (identifierOf(record) === identifier ? next : record));
const grantIdOf = (grant: CoachingGrantRecord): string => grant.grantId;
const targetIdOf = (target: CoachingTargetRecord): string => target.targetId;
const checkInIdOf = (checkIn: CoachingCheckInRecord): string => checkIn.checkInId;
const shareIdOf = (share: CoachingTaskShareRecord): string => share.shareId;
type RefusalResult = { readonly refused: MutationOutcome };

const refuseDenied = (operationId: string): RefusalResult => ({ refused: denied({ operationId, reasonCode: "no-permission" }) });
const refuseConflict = (operationId: string, currentRevision: string, current: unknown, preservedInput: unknown): RefusalResult => ({ refused: conflict({ operationId, currentRevision, current, preservedInput, reason: "stale-revision" }) });
const refuseInvalid = (operationId: string, fields: FieldMessages): RefusalResult => ({ refused: invalid({ operationId, fields }) });
const refuseUnavailable = (operationId: string, reference: string): RefusalResult => ({ refused: unavailable({ operationId, source: { system: LOCAL_STORE_SYSTEM, reference }, guidance: STATE_UNAVAILABLE_GUIDANCE }) });
function refuseFromCoaching(operationId: string, refusal: CoachingRefusal, record: CoachingGrantRecord, preservedInput: unknown): RefusalResult {
  switch (refusal.reason) {
    case "not-holder":
    case "ministry-not-admitted":
    case "module-not-admitted":
    case "permission-hold":
      return refuseDenied(operationId);
    case "missing-duration":
    case "invalid-selection":
    case "invalid-duration":
    case "identity-not-verified":
      return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: [refusal.message] });
    default:
      return refuseConflict(operationId, record.revision, record, preservedInput);
  }
}
function workingDurationOf(duration: CoachingDurationRecord): GrantDuration | null {
  if (duration.kind === "ongoing")
    return { kind: "ongoing", shareThroughDate: null, frozenZone: duration.frozenZone, cutoffInstant: null, sourceLimitInstant: null, limitedBy: null, nominalWording: "Open-ended, with no Share-through date of its own", resolution: null, nominalDisagreesWithResolved: false, settledAt: null };
  const cutoff = duration.cutoffInstant === null ? null : instantOf(duration.cutoffInstant);
  if (cutoff === null) return null;
  const shareThroughDate = shareThroughDateOfCutoff({ cutoffInstant: cutoff, frozenZone: duration.frozenZone });
  if (shareThroughDate === null) return null;
  return { kind: "through-date", shareThroughDate, frozenZone: duration.frozenZone, cutoffInstant: cutoff, sourceLimitInstant: null, limitedBy: "share-through", nominalWording: `Shared through ${serialiseCivilDate(shareThroughDate)}`, resolution: null, nominalDisagreesWithResolved: false, settledAt: null };
}
const storedDurationOf = (duration: GrantDuration): CoachingDurationRecord => ({ kind: duration.kind, cutoffInstant: duration.cutoffInstant === null ? null : duration.cutoffInstant.toString(), frozenZone: duration.frozenZone });
function workingGrantOf(record: CoachingGrantRecord): CoachingGrant | null {
  const issuedAt = instantOf(record.invitation.issuedAt),
    expiresAt = instantOf(record.invitation.expiresAt);
  if (issuedAt === null || expiresAt === null) return null;
  const duration = workingDurationOf(record.duration);
  if (duration === null) return null;
  const accepted = record.state !== "invited";
  return {
    grantId: record.grantId,
    workerPrincipalId: record.workerPrincipalId,
    coachPrincipalId: record.coachPrincipalId,
    ministryIds: [...record.ministryIds],
    modules: record.modules,
    duration,
    financialRange: null,
    state: record.state,
    identityVerification: accepted ? "verified" : "unverified",
    acceptedAt: accepted ? issuedAt : null,
    invitation: { issuedAt, expiresAt, supersededBy: record.invitation.supersededBy },
    revision: revisionOrdinalOf(record.revision),
  };
}
function storedGrantOf(record: CoachingGrantRecord, grant: CoachingGrant, nextRevision: string): CoachingGrantRecord {
  const duration = grant.duration === null ? record.duration : storedDurationOf(grant.duration);
  return { ...record, modules: grant.modules, duration, state: grant.state === "superseded" ? record.state : grant.state, invitation: { ...record.invitation, supersededBy: grant.invitation.supersededBy }, revision: nextRevision };
}
function accessContextOf(record: CoachingGrantRecord, principalId: string, role: "worker" | "coach", scope: Scope): CoachingAccessContext {
  const ministryId = record.ministryIds.includes(scope.ministryId) ? scope.ministryId : (record.ministryIds.at(0) ?? scope.ministryId);
  return { actor: { role, principalId }, organizationId: scope.organizationId, ministryId, subjectAvailability: "available", permissionHold: "none" };
}
function workingVersionOf(version: CoachingTargetRecord["versions"][number]): TargetVersion | null {
  const effectiveFrom = civilDateOf(version.effectiveFrom),
    calendarStart = civilDateOf(version.calendarStart);
  if (effectiveFrom === null || calendarStart === null) return null;
  const effectiveTo = version.effectiveTo === null ? null : civilDateOf(version.effectiveTo);
  if (version.effectiveTo !== null && effectiveTo === null) return null;
  return { revisionId: version.revisionId, effectiveFrom, ...(effectiveTo === null ? {} : { effectiveTo }), quantity: version.quantity, measure: version.measure, calendarStart };
}
function storedVersionsOf(versions: readonly TargetVersion[]): CoachingTargetRecord["versions"] {
  return versions.map((version) => ({
    revisionId: version.revisionId,
    effectiveFrom: serialiseCivilDate(version.effectiveFrom),
    effectiveTo: version.effectiveTo === undefined ? null : serialiseCivilDate(version.effectiveTo),
    quantity: version.quantity,
    measure: version.measure,
    calendarStart: serialiseCivilDate(version.calendarStart),
  }));
}
function workingPeriodOf(record: CoachingTargetRecord): TargetPeriod | null {
  const period = record.period;
  if (period.kind !== "custom") return { kind: period.kind };
  if (period.from === null || period.to === null) return null;
  const start = civilDateOf(period.from),
    end = civilDateOf(period.to);
  return start === null || end === null ? null : { kind: "custom", start, end };
}
const storedPeriodOf = (period: TargetPeriod): CoachingTargetRecord["period"] => (period.kind === "custom" ? { kind: "custom", from: serialiseCivilDate(period.start), to: serialiseCivilDate(period.end) } : { kind: period.kind, from: null, to: null });
function checkInShareDurationOf(duration: CoachingDurationRecord): CheckInShareDuration | null {
  if (duration.kind === "ongoing") return { kind: "ongoing" };
  const cutoff = duration.cutoffInstant === null ? null : instantOf(duration.cutoffInstant);
  if (cutoff === null) return null;
  const throughOn = shareThroughDateOfCutoff({ cutoffInstant: cutoff, frozenZone: duration.frozenZone });
  return throughOn === null ? null : { kind: "through-date", throughOn };
}
const answersOf = (answers: readonly CheckInAnswer[]): CheckInAnswer[] => answers.map((answer) => ({ questionOrder: answer.questionOrder, text: answer.text }));
function workingCheckInOf(record: CoachingCheckInRecord): CheckIn | null {
  let privateDraft: CheckIn["privateDraft"];
  const draft = record.privateDraft;
  if (draft !== null) {
    const capturedAt = instantOf(draft.questionsCapturedAt),
      savedAt = instantOf(draft.savedAt);
    if (capturedAt === null || savedAt === null) return null;
    privateDraft = { revisionId: draft.revisionId, captured: { questions: draft.questions.map((question) => ({ wording: question.wording, order: question.order })), capturedAt }, answers: answersOf(draft.answers), savedAt };
  }
  let shared: CheckInSharedRevision | undefined;
  const stored = record.shared;
  if (stored !== null) {
    const capturedAt = instantOf(stored.questionsCapturedAt),
      sharedAt = instantOf(stored.sharedAt);
    const updatedAt = instantOf(stored.updatedAt);
    if (capturedAt === null || sharedAt === null || updatedAt === null) return null;
    const withdrawnAt = stored.withdrawnAt === null ? null : instantOf(stored.withdrawnAt);
    if (stored.withdrawnAt !== null && withdrawnAt === null) return null;
    const duration = checkInShareDurationOf(stored.duration);
    if (duration === null) return null;
    shared = {
      revisionId: stored.revisionId,
      captured: { questions: stored.questions.map((question) => ({ wording: question.wording, order: question.order })), capturedAt },
      answers: answersOf(stored.answers),
      recipients: [...stored.recipientPrincipalIds],
      duration,
      sharedAt,
      updatedAt,
      ...(withdrawnAt === null ? {} : { withdrawnAt }),
    };
  }
  return { checkInId: record.checkInId, revision: revisionOrdinalOf(record.revision), ...(privateDraft === undefined ? {} : { privateDraft }), ...(shared === undefined ? {} : { shared }) };
}
function storedCheckInOf(record: CoachingCheckInRecord, checkIn: CheckIn, nextRevision: string, sharedDuration: CoachingDurationRecord | undefined): CoachingCheckInRecord | null {
  const draft = checkIn.privateDraft;
  const privateDraft: CoachingCheckInRecord["privateDraft"] =
    draft === undefined ? null : { revisionId: draft.revisionId, questions: draft.captured.questions.map((question) => ({ wording: question.wording, order: question.order })), questionsCapturedAt: draft.captured.capturedAt.toString(), answers: answersOf(draft.answers), savedAt: draft.savedAt.toString() };
  let shared: CoachingCheckInRecord["shared"] = null;
  const revision = checkIn.shared;
  if (revision !== undefined) {
    const duration = sharedDuration ?? record.shared?.duration;
    if (duration === undefined) return null;
    shared = {
      revisionId: revision.revisionId,
      questions: revision.captured.questions.map((question) => ({ wording: question.wording, order: question.order })),
      questionsCapturedAt: revision.captured.capturedAt.toString(),
      answers: answersOf(revision.answers),
      recipientPrincipalIds: revision.recipients.map((recipient) => principalIdSchema.parse(recipient)),
      duration,
      sharedAt: revision.sharedAt.toString(),
      updatedAt: revision.updatedAt.toString(),
      withdrawnAt: revision.withdrawnAt === undefined ? null : revision.withdrawnAt.toString(),
    };
  }
  return { ...record, privateDraft, shared, revision: nextRevision };
}
const checkInPayloadOf = (questions: readonly string[], answers: readonly string[]): CheckInPayload => ({
  questions: questions.map((wording, index) => ({ wording, order: index })),
  answers: questions.length === 0 ? answers.map((text) => ({ questionOrder: null, text })) : answers.map((text, index) => ({ questionOrder: index, text })),
});
function workingTaskShareOf(record: CoachingTaskShareRecord): TaskShare | null {
  const reviewedAt = instantOf(record.reviewedSummary.reviewedAt);
  if (reviewedAt === null) return null;
  const withdrawnAt = record.withdrawnAt === undefined || record.withdrawnAt === null ? null : instantOf(record.withdrawnAt);
  if (record.withdrawnAt !== undefined && record.withdrawnAt !== null && withdrawnAt === null) return null;
  const reviewedSummary = { description: record.reviewedSummary.description, codePoints: record.reviewedSummary.codePoints, reviewedAt };
  const reviewedFingerprint = record.reviewedFingerprint;
  const occurrenceId = record.occurrenceId;
  const revision = record.revision;
  const shareId = record.shareId;
  const state = record.state;
  return { shareId, occurrenceId, reviewedSummary, reviewedFingerprint, state, revision, ...(withdrawnAt === null ? {} : { withdrawnAt }) };
}
function refuseFromTaskShare(operationId: string, refusal: TaskShareRefusal): RefusalResult {
  switch (refusal.reason) {
    case "description-too-long":
      return refuseInvalid(operationId, { safeDescription: [`A shared description is at most ${String(refusal.limit)} Unicode code points; this one is ${String(refusal.codePoints)}. Nothing was shortened: take out the text you do not want to share, and review it again.`] });
    case "description-empty":
      return refuseInvalid(operationId, { safeDescription: ["A shared description states what you want your coach to read, so it cannot be blank."] });
    case "unavailable":
      return refuseUnavailable(operationId, "coaching-task-share");
    default:
      return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: ["This shared summary no longer stands as it was read, so nothing was shared. Reload the summaries, review the description and share it again."] });
  }
}
const referenceField = z.string().trim().min(1);

const civilDateField = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") ctx.addIssue({ code: "custom", message: "A date is a real calendar day written as YYYY-MM-DD; this value names no day." });
  });
const shareDurationField = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("ongoing") }), z.strictObject({ kind: z.literal("through-date"), shareThroughDate: civilDateField })]);
const invitedModulesShape = { "support-goal": z.literal(false), "support-results": z.literal(false), targets: z.literal(false), "check-ins": z.literal(false), "task-summaries": z.literal(false) } satisfies Record<ModuleKey, z.ZodLiteral<false>>;
const invitationPayload = z
  .strictObject({
    coachPrincipalId: referenceField.optional(),
    recipientPrincipalId: referenceField.optional(),
    organizationId: referenceField,
    ministryId: referenceField.optional(),
    ministryIds: z.array(referenceField).min(1).optional(),
    modules: z.strictObject(invitedModulesShape).optional(),
    duration: shareDurationField,
    financialRange: z
      .strictObject({ fromDate: civilDateField, toDate: civilDateField, currency: z.string().trim().min(1).optional() })
      .refine((range) => range.fromDate <= range.toDate, { path: ["toDate"], message: "A reviewed range ends on or after the day it starts." })
      .optional(),
  })
  .superRefine((payload, ctx) => {
    if (invitedCoachOf(payload) === "") ctx.addIssue({ code: "custom", path: ["coachPrincipalId"], message: "An invitation names the coach it is for, by identifier." });
    if (invitedMinistriesOf(payload).length === 0) ctx.addIssue({ code: "custom", path: ["ministryIds"], message: "An invitation names the ministry it is made in, by identifier." });
  });
type InvitationPayload = z.infer<typeof invitationPayload>;

function invitedCoachOf(payload: InvitationPayload): string {
  return payload.coachPrincipalId ?? payload.recipientPrincipalId ?? "";
}
function invitedMinistriesOf(payload: InvitationPayload): readonly string[] {
  if (payload.ministryIds !== undefined) return payload.ministryIds;
  return payload.ministryId === undefined ? [] : [payload.ministryId];
}
const acceptancePayload = z.strictObject({
  grantId: referenceField,
  // The revision the coach saw, in either form a read hands out: the ordinal number, or the stored token (`"rev-1"`) a relationship's own envelope states. Both are read as the same ordinal below.
  invitationRevision: z.union([z.number().int().min(0), referenceField]).optional(),
});
type AcceptancePayload = z.infer<typeof acceptancePayload>;
const grantReferencePayload = z.strictObject({ grantId: referenceField });

type GrantReferencePayload = z.infer<typeof grantReferencePayload>;
const modulePayload = z.strictObject({ grantId: referenceField, moduleKey: z.enum(MODULE_KEYS).optional(), module: z.enum(MODULE_KEYS).optional(), enabled: z.boolean() }).superRefine((payload, ctx) => {
  if ((payload.moduleKey ?? payload.module) === undefined) ctx.addIssue({ code: "custom", path: ["moduleKey"], message: "A module change names the one module it switches." });
});
type ModulePayload = z.infer<typeof modulePayload>;
const moduleKeyOf = (payload: ModulePayload): ModuleKey | undefined => payload.moduleKey ?? payload.module,
  measureField = z.enum(TARGET_MEASURES);
const quantityField = z.number().int().min(1),
  periodKindField = z.enum(["weekly", "monthly", "custom"]);

type CustomRangeFields = { readonly period?: "weekly" | "monthly" | "custom" | undefined; readonly calendarStart?: string | undefined; readonly periodEnd?: string | undefined };
function requireCustomRange(fields: CustomRangeFields, ctx: z.RefinementCtx): void {
  if (fields.period !== "custom") return;
  if (fields.calendarStart === undefined) ctx.addIssue({ code: "custom", path: ["calendarStart"], message: "A one-off custom period states the day it starts." });
  if (fields.periodEnd === undefined) ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "A one-off custom period states the day it ends." });
}
const targetSavePayload = z.strictObject({ measure: measureField, quantity: quantityField, period: periodKindField.optional(), calendarStart: civilDateField.optional(), periodEnd: civilDateField.optional(), privateLabel: z.string().trim().min(1), homePlacement: z.boolean().optional() }).superRefine(requireCustomRange);
type TargetSavePayload = z.infer<typeof targetSavePayload>;
const targetEditPayload = z
  .strictObject({
    targetId: referenceField,
    measure: measureField.optional(),
    quantity: quantityField.optional(),
    period: periodKindField.optional(),
    calendarStart: civilDateField.optional(),
    periodEnd: civilDateField.optional(),
    privateLabel: z.string().trim().min(1).optional(),
    homePlacement: z.boolean().optional(),
  })
  .superRefine(requireCustomRange);
type TargetEditPayload = z.infer<typeof targetEditPayload>;
const targetStatePayload = z.strictObject({ targetId: referenceField });

type TargetStatePayload = z.infer<typeof targetStatePayload>;
const checkInTextsField = z.array(z.string()),
  saveCheckInPayload = z.strictObject({ checkInId: referenceField.optional(), questions: checkInTextsField.optional(), answers: checkInTextsField });
type SaveCheckInPayload = z.infer<typeof saveCheckInPayload>;
const shareCheckInPayload = z.strictObject({ checkInId: referenceField, questions: checkInTextsField.optional(), answers: checkInTextsField.optional(), recipients: z.array(referenceField).min(1).optional(), duration: shareDurationField.optional() });
type ShareCheckInPayload = z.infer<typeof shareCheckInPayload>;
const updateSharedCheckInPayload = z.strictObject({ checkInId: referenceField, sharedRevisionId: referenceField.optional(), questions: checkInTextsField.optional(), answers: checkInTextsField });
type UpdateSharedCheckInPayload = z.infer<typeof updateSharedCheckInPayload>;
const withdrawCheckInPayload = z.strictObject({ checkInId: referenceField, sharedRevisionId: referenceField.optional() });
type WithdrawCheckInPayload = z.infer<typeof withdrawCheckInPayload>;
const taskSharePayload = z.strictObject({
  taskId: referenceField,
  occurrenceId: referenceField.optional(),
  reviewedFingerprint: referenceField.optional(),
  safeDescription: z.string().superRefine((description, ctx) => {
    if (description.trim() === "") ctx.addIssue({ code: "custom", message: "A shared summary states what you want your coach to read, so it cannot be blank." });
  }),
});
type TaskSharePayload = z.infer<typeof taskSharePayload>;
const stopTaskSharePayload = z.strictObject({ shareId: referenceField.optional(), taskShareId: referenceField.optional() }).superRefine((payload, ctx) => {
  if ((payload.shareId ?? payload.taskShareId) === undefined) ctx.addIssue({ code: "custom", path: ["shareId"], message: "Stopping a shared summary names the summary it stops." });
});
type StopTaskSharePayload = z.infer<typeof stopTaskSharePayload>;
const stoppedShareIdOf = (payload: StopTaskSharePayload): string => payload.shareId ?? payload.taskShareId ?? "";
type GrantResult = { readonly [field: string]: JsonValue; readonly grantId: string; readonly state: string; readonly revision: string };
type TargetResult = { readonly [field: string]: JsonValue; readonly targetId: string; readonly state: string; readonly revision: string };
type CheckInResult = { readonly [field: string]: JsonValue; readonly checkInId: string; readonly state: string; readonly revision: string };
type TaskShareResult = { readonly [field: string]: JsonValue; readonly shareId: string; readonly taskId: string; readonly state: string; readonly revision: string };
const INVITATION_WINDOW_HOURS = 168;

const invitationExpiryOf = (issuedAt: Temporal.Instant): Temporal.Instant => issuedAt.add({ hours: INVITATION_WINDOW_HOURS });
function chosenShareDurationOf(duration: InvitationPayload["duration"]): ShareDuration | null {
  if (duration.kind === "ongoing") return { kind: "ongoing", frozenZone: SHARE_SOURCE_ZONE };
  const shareThroughDate = civilDateOf(duration.shareThroughDate);
  return shareThroughDate === null ? null : { kind: "through-date", shareThroughDate, frozenZone: SHARE_SOURCE_ZONE };
}
function invitedRangeOf(payload: InvitationPayload, projectionCurrencies: readonly string[]): { readonly ok: true; readonly stored: CoachingGrantRecord["financialRange"] } | { readonly ok: false; readonly fields: FieldMessages } {
  const range = payload.financialRange;
  if (range === undefined) return { ok: true, stored: null };
  const from = civilDateOf(range.fromDate),
    to = civilDateOf(range.toDate);
  if (from === null || to === null) return { ok: false, fields: { financialRange: ["A reviewed range states two real calendar days."] } };
  const stated = range.currency,
    currency = stated === undefined ? (projectionCurrencies.length === 1 ? projectionCurrencies[0] : undefined) : projectionCurrencies.includes(stated) ? stated : undefined;
  if (currency === undefined) {
    const absent = "A reviewed range states the one currency it was reviewed in, because this session's support source states more than one and no figure is recorded against a currency nobody chose.";
    const foreign = "A reviewed range states a currency this session's support source holds, so a figure is never disclosed in a currency nothing was measured in.";
    return { ok: false, fields: { financialRange: [stated === undefined ? absent : foreign] } };
  }
  return { ok: true, stored: { from: range.fromDate, to: range.toDate, currency } };
}
const grantStandingOf = (record: CoachingGrantRecord): GrantResult => ({ grantId: record.grantId, state: record.state, revision: record.revision });
/** Invites one named coach over the ministries and for the duration the worker chose. */
export async function inviteCoach(input: MutationInput<InvitationPayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, invitationPayload, "inviteCoach", { apply: (context) => applyInviteCoach(context, input.payload) });
}
function applyInviteCoach(context: MutationContext, payload: InvitationPayload): ApplyResult<GrantResult> {
  const { operationId } = context;
  const at = now();
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const coachPrincipalId = invitedCoachOf(payload),
    ministryIds = invitedMinistriesOf(payload);
  // An invitation states the scope it was made in, and the runner asserted the scope the request claimed. Those are two statements of where the worker is acting, so the stated one is checked against the same admissions the claimed one was.
  const admitted = ministryIds.every((ministryId) => context.session.admittedMemberships.some((membership) => membership.organizationId === payload.organizationId && membership.ministryId === ministryId));
  if (!admitted) return refuseDenied(operationId);
  if (coachPrincipalId === context.session.principalId) return refuseInvalid(operationId, { coachPrincipalId: ["A worker cannot invite their own principal as coach."] });
  const chosen = chosenShareDurationOf(payload.duration);
  if (chosen === null) return refuseInvalid(operationId, { duration: ["A Share-through date is a real calendar day, so this duration names none."] });
  const frozen = freezeShareDuration(chosen, at);
  if (!frozen.ok) return refuseInvalid(operationId, { duration: [frozen.error.message] });
  const range = invitedRangeOf(payload, families.projectionCurrencies);
  if (!range.ok) return refuseInvalid(operationId, range.fields);
  const grantId = `coaching-grant-${operationId}`,
    coachPrincipal = principalIdSchema.safeParse(coachPrincipalId);
  const ministries = z.array(ministryIdSchema).safeParse(ministryIds);
  if (!coachPrincipal.success || !ministries.success) return refuseDenied(operationId);
  const invitation = inviteGrant({
    grantId,
    workerPrincipalId: context.session.principalId,
    coachPrincipalId: coachPrincipal.data,
    ministryIds: ministries.data,
    duration: chosen,
    // A range is recorded with its period and currency; the figures inside it are produced by the one report function at read time, and an invitation states none, so the module is handed no range rather than a measured amount this mutation would have had to invent.
    financialRange: null,
    issuedAt: at,
    expiresAt: invitationExpiryOf(at),
    revision: revisionOrdinalOf(FIRST_REVISION),
  });
  if (!invitation.ok) return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: [invitation.error.message] });
  const record: CoachingGrantRecord = {
    grantId,
    workerPrincipalId: context.session.principalId,
    coachPrincipalId: coachPrincipal.data,
    ministryIds: ministries.data,
    modules: invitation.value.modules,
    duration: storedDurationOf(frozen.value),
    financialRange: range.stored,
    state: "invited",
    invitation: { issuedAt: at.toString(), expiresAt: invitationExpiryOf(at).toString(), supersededBy: null },
    revision: FIRST_REVISION,
  };
  context.docs.state = withFamily(families.document, "coachingGrants", [...families.grants, record]);
  return { changed: true, revision: FIRST_REVISION, created: [grantId], result: { grantId, state: record.state, revision: FIRST_REVISION } };
}
/** Accepts an invitation, as the coach it names, freezing the share cutoff at this instant. */
export async function acceptInvitation(input: MutationInput<AcceptancePayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, acceptancePayload, "acceptInvitation", { scopeAuthority: "grant", readCurrent: (docs) => currentGrantTarget(docs, rawGrantIdOf(input)), apply: (context) => applyAcceptInvitation(context, input.payload) });
}
function applyAcceptInvitation(context: MutationContext, payload: AcceptancePayload): ApplyResult<GrantResult> {
  const { operationId } = context;
  const at = now();
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const record = families.grants.find((candidate) => candidate.grantId === payload.grantId);
  // A relationship the caller does not hold and one that does not exist answer alike: a distinguishable answer would let a caller enumerate what is not theirs.
  if (record === undefined || record.coachPrincipalId !== context.session.principalId) return refuseDenied(operationId);
  if (payload.invitationRevision !== undefined && revisionOrdinalOfValue(payload.invitationRevision) !== revisionOrdinalOf(record.revision)) return refuseConflict(operationId, record.revision, grantStandingOf(record), payload);
  const working = workingGrantOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-grant");
  const accepted = acceptGrant(working, { acceptedBy: context.session.principalId, identityVerification: "verified", expectedRevision: revisionOrdinalOf(record.revision) }, at);
  if (!accepted.ok) return refuseFromCoaching(operationId, accepted.error, record, payload);
  const nextRevision = nextRevisionTokenOf(record.revision),
    next = storedGrantOf(record, accepted.value, nextRevision);
  context.docs.state = withFamily(families.document, "coachingGrants", replacingRecord(families.grants, grantIdOf, record.grantId, next));
  return { changed: true, revision: nextRevision, changedIds: [record.grantId], result: grantStandingOf(next) };
}
/** Revokes a grant: the worker's own stop of the sharing, kept apart from ending the relationship. */
export async function revokeGrant(input: MutationInput<GrantReferencePayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, grantReferencePayload, "revokeGrant", { readCurrent: (docs) => currentGrantTarget(docs, rawGrantIdOf(input)), apply: (context) => applyGrantClosure(context, input.payload, "revoke") });
}
/** Ends the coaching relationship, as the worker. */
export async function endCoaching(input: MutationInput<GrantReferencePayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, grantReferencePayload, "endCoaching", { readCurrent: (docs) => currentGrantTarget(docs, rawGrantIdOf(input)), apply: (context) => applyGrantClosure(context, input.payload, "end") });
}
/** Records that the coach left: the coach identity's second and last write. */
export async function leaveCoaching(input: MutationInput<GrantReferencePayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, grantReferencePayload, "leaveCoaching", { scopeAuthority: "grant", readCurrent: (docs) => currentGrantTarget(docs, rawGrantIdOf(input)), apply: (context) => applyGrantClosure(context, input.payload, "leave") });
}
type GrantClosure = "revoke" | "end" | "leave";

function applyGrantClosure(context: MutationContext, payload: GrantReferencePayload, closure: GrantClosure): ApplyResult<GrantResult> {
  const { operationId } = context;
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const record = families.grants.find((candidate) => candidate.grantId === payload.grantId);
  if (record === undefined) return refuseDenied(operationId);
  const principalId = context.session.principalId,
    holds = closure === "leave" ? record.coachPrincipalId === principalId : record.workerPrincipalId === principalId;
  if (!holds) return refuseDenied(operationId);
  const working = workingGrantOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-grant");
  const expectedRevision = revisionOrdinalOf(record.revision);
  const closed = closure === "revoke" ? revokeCoachingGrant(working, { revokedBy: principalId, expectedRevision }) : closure === "end" ? endGrant(working, { endedBy: principalId, expectedRevision }) : leaveGrant(working, { leftBy: principalId, expectedRevision });
  if (!closed.ok) return refuseFromCoaching(operationId, closed.error, record, payload);
  const nextRevision = nextRevisionTokenOf(record.revision),
    next = storedGrantOf(record, closed.value, nextRevision);
  context.docs.state = withFamily(families.document, "coachingGrants", replacingRecord(families.grants, grantIdOf, record.grantId, next));
  return { changed: true, revision: nextRevision, changedIds: [record.grantId], result: grantStandingOf(next) };
}
/** Switches one of the five modules on or off for an open relationship. */
export async function setModule(input: MutationInput<ModulePayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, modulePayload, "setModule", { readCurrent: (docs) => currentGrantTarget(docs, rawGrantIdOf(input)), apply: (context) => applySetModule(context, input.payload) });
}
function applySetModule(context: MutationContext, payload: ModulePayload): ApplyResult<GrantResult> {
  const { operationId } = context;
  const at = now(),
    key = moduleKeyOf(payload);
  if (key === undefined) return refuseInvalid(operationId, { moduleKey: ["A module change names the one module it switches."] });
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const record = families.grants.find((candidate) => candidate.grantId === payload.grantId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) return refuseDenied(operationId);
  const working = workingGrantOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-grant");
  const selection: ModuleSelection = { ...record.modules, [key]: payload.enabled };
  const changed = setModuleSelection(working, { changedBy: context.session.principalId, selection, expectedRevision: revisionOrdinalOf(record.revision) }, at);
  if (!changed.ok) return refuseFromCoaching(operationId, changed.error, record, payload);
  if (changed.value.revision === working.revision) return { changed: false };
  const nextRevision = nextRevisionTokenOf(record.revision),
    next = storedGrantOf(record, changed.value, nextRevision);
  context.docs.state = withFamily(families.document, "coachingGrants", replacingRecord(families.grants, grantIdOf, record.grantId, next));
  return { changed: true, revision: nextRevision, changedIds: [record.grantId], result: grantStandingOf(next) };
}
function currentGrantTarget(docs: StateDocumentCarrier, grantId: string | undefined): CurrentTarget {
  if (grantId === undefined) return { kind: "absent" };
  const loaded = readFamilies(docs);
  if (!loaded.ok) return { kind: "absent" };
  const record = loaded.families.grants.find((candidate) => candidate.grantId === grantId);
  return record === undefined ? { kind: "absent" } : { kind: "record", revision: record.revision, value: grantStandingOf(record) };
}
function rawGrantIdOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const payload: unknown = Reflect.get(input, "payload");
  if (typeof payload !== "object" || payload === null) return undefined;
  const grantId: unknown = Reflect.get(payload, "grantId");
  return typeof grantId === "string" && grantId.length > 0 ? grantId : undefined;
}
const targetStandingOf = (record: CoachingTargetRecord): TargetResult => ({ targetId: record.targetId, state: record.state, revision: record.revision });
function periodOf(kind: "weekly" | "monthly" | "custom", calendarStart: CivilDate, periodEnd: string | undefined): { readonly ok: true; readonly period: TargetPeriod } | { readonly ok: false; readonly field: string } {
  if (kind !== "custom") return { ok: true, period: { kind } };
  const end = periodEnd === undefined ? null : civilDateOf(periodEnd);
  if (end === null) return { ok: false, field: "A one-off custom period states the day it ends." };
  if (Temporal.PlainDate.compare(end, calendarStart) < 0) return { ok: false, field: "A one-off custom period ends on or after the day it starts." };
  return { ok: true, period: { kind: "custom", start: calendarStart, end } };
}
function prospectiveBoundaryOf(anchor: PeriodAnchor, today: CivilDate, latestEffectiveFrom: CivilDate): CivilDate | null {
  const current = resolvePeriodContaining(anchor, today);
  if (current.ok) {
    if (Temporal.PlainDate.compare(current.value.start, latestEffectiveFrom) > 0) return current.value.start;
    const next = resolvePeriodContaining(anchor, current.value.exclusiveEnd);
    return next.ok && Temporal.PlainDate.compare(next.value.start, latestEffectiveFrom) > 0 ? next.value.start : null;
  }
  return Temporal.PlainDate.compare(today, latestEffectiveFrom) > 0 ? today : null;
}
/** Sets a target for the first time: what it counts, how many, over which period, under the worker's own private label, and whether Home lists it. */
export async function saveTarget(input: MutationInput<TargetSavePayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, targetSavePayload, "saveTarget", { apply: (context) => applySaveTarget(context, input.payload) });
}
function applySaveTarget(context: MutationContext, payload: TargetSavePayload): ApplyResult<TargetResult> {
  const { operationId } = context;
  const at = now(),
    today = planningToday(at);
  if (today === null) return refuseUnavailable(operationId, "planning-calendar");
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const calendarStart = payload.calendarStart === undefined ? today : civilDateOf(payload.calendarStart);
  if (calendarStart === null) return refuseInvalid(operationId, { calendarStart: ["This target starts on a real calendar day."] });
  const period = periodOf(payload.period ?? "weekly", calendarStart, payload.periodEnd);
  if (!period.ok) return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: [period.field] });
  const targetId = `coaching-target-${operationId}`;
  const firstVersion: TargetVersion = { revisionId: `${targetId}-version-1`, effectiveFrom: calendarStart, quantity: payload.quantity, measure: payload.measure, calendarStart };
  const record: CoachingTargetRecord = {
    targetId,
    workerPrincipalId: context.session.principalId,
    privateLabel: payload.privateLabel,
    measure: payload.measure,
    quantity: payload.quantity,
    period: storedPeriodOf(period.period),
    calendarStart: serialiseCivilDate(calendarStart),
    homePlacement: payload.homePlacement === true ? "placed" : "unplaced",
    state: "active",
    versions: storedVersionsOf([firstVersion]),
    revision: FIRST_REVISION,
  };
  context.docs.state = withFamily(families.document, "coachingTargets", [...families.targets, record]);
  return { changed: true, revision: FIRST_REVISION, created: [targetId], result: { targetId, state: record.state, revision: FIRST_REVISION, versionRevisionId: firstVersion.revisionId } };
}
/** Changes a target's plan, opening a prospective version when the count, the measure or the calendar start changes. */
export async function editTarget(input: MutationInput<TargetEditPayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, targetEditPayload, "editTarget", { readCurrent: (docs) => currentTargetTarget(docs, rawTargetIdOf(input)), apply: (context) => applyEditTarget(context, input.payload) });
}
function applyEditTarget(context: MutationContext, payload: TargetEditPayload): ApplyResult<TargetResult> {
  const { operationId } = context;
  const at = now();
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const record = families.targets.find((candidate) => candidate.targetId === payload.targetId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) return refuseDenied(operationId);
  const today = planningToday(at),
    period = workingPeriodOf(record);
  const calendarStart = civilDateOf(record.calendarStart),
    versions = record.versions.map(workingVersionOf);
  if (today === null || period === null || calendarStart === null) return refuseUnavailable(operationId, "coaching-target");
  if (versions.some((version) => version === null)) return refuseUnavailable(operationId, "coaching-target-versions");
  const history = versions.filter((version): version is TargetVersion => version !== null),
    latest = history.at(-1);
  if (latest === undefined) return refuseUnavailable(operationId, "coaching-target-versions");
  const nextMeasure: TargetMeasure = payload.measure ?? record.measure;
  const nextQuantity = payload.quantity ?? record.quantity,
    nextCalendarStart = payload.calendarStart === undefined ? calendarStart : civilDateOf(payload.calendarStart);
  if (nextCalendarStart === null) return refuseInvalid(operationId, { calendarStart: ["This target's calendar starts on a real calendar day."] });
  const nextPeriodKind = payload.period ?? period.kind,
    nextPeriodEnd = payload.periodEnd ?? (period.kind === "custom" ? serialiseCivilDate(period.end) : undefined);
  const nextPeriod = periodOf(nextPeriodKind, nextCalendarStart, nextPeriodEnd);
  if (!nextPeriod.ok) return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: [nextPeriod.field] });
  const nextLabel = payload.privateLabel ?? record.privateLabel,
    nextPlacement = payload.homePlacement === undefined ? record.homePlacement : payload.homePlacement ? "placed" : "unplaced";
  const planChanged = nextMeasure !== record.measure || nextQuantity !== record.quantity || Temporal.PlainDate.compare(nextCalendarStart, calendarStart) !== 0;
  const periodChanged = nextPeriod.period.kind !== period.kind || (nextPeriod.period.kind === "custom" && period.kind === "custom" && !nextPeriod.period.end.equals(period.end));
  if (!planChanged && !periodChanged && nextLabel === record.privateLabel && nextPlacement === record.homePlacement) return { changed: false };
  if (record.state === "ended") return refuseConflict(operationId, record.revision, targetStandingOf(record), payload);
  let nextVersions: readonly TargetVersion[] = history;
  let openedVersionId: string | undefined;
  if (planChanged) {
    const boundary = prospectiveBoundaryOf({ period, calendarStart }, today, latest.effectiveFrom);
    if (boundary === null) return refuseConflict(operationId, record.revision, targetStandingOf(record), payload);
    const versionRevisionId = `${record.targetId}-version-${String(history.length + 1)}`;
    const planned = startProspectiveVersion({ versions: history, anchor: { period, calendarStart }, change: { revisionId: versionRevisionId, quantity: nextQuantity, measure: nextMeasure, calendarStart: nextCalendarStart }, effectiveFrom: boundary });
    if (!planned.ok) {
      if (planned.error === "invalid-quantity") return refuseInvalid(operationId, { quantity: ["A target counts a positive whole number of the measure it sets."] });
      if (planned.error === "no-change") return { changed: false };
      return refuseConflict(operationId, record.revision, targetStandingOf(record), payload);
    }
    nextVersions = planned.value;
    openedVersionId = versionRevisionId;
  }
  const nextRevision = nextRevisionTokenOf(record.revision);
  const next: CoachingTargetRecord = { ...record, privateLabel: nextLabel, measure: nextMeasure, quantity: nextQuantity, period: storedPeriodOf(nextPeriod.period), calendarStart: serialiseCivilDate(nextCalendarStart), homePlacement: nextPlacement, versions: storedVersionsOf(nextVersions), revision: nextRevision };
  context.docs.state = withFamily(families.document, "coachingTargets", replacingRecord(families.targets, targetIdOf, record.targetId, next));
  return { changed: true, revision: nextRevision, changedIds: [record.targetId], result: { targetId: record.targetId, state: next.state, revision: nextRevision, ...(openedVersionId === undefined ? {} : { versionRevisionId: openedVersionId }) } };
}
/** Pauses a target: distinct from ending it and from a source that cannot be read. */
export async function pauseTarget(input: MutationInput<TargetStatePayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, targetStatePayload, "pauseTarget", { readCurrent: (docs) => currentTargetTarget(docs, rawTargetIdOf(input)), apply: (context) => applyTargetLifecycle(context, input.payload, "paused") });
}
/** Ends a target: its history is kept, its closed periods keep the version they were measured against, and no later action reopens it. */
export async function endTarget(input: MutationInput<TargetStatePayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, targetStatePayload, "endTarget", { readCurrent: (docs) => currentTargetTarget(docs, rawTargetIdOf(input)), apply: (context) => applyTargetLifecycle(context, input.payload, "ended") });
}
function applyTargetLifecycle(context: MutationContext, payload: TargetStatePayload, state: "paused" | "ended"): ApplyResult<TargetResult> {
  const { operationId } = context;
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const record = families.targets.find((candidate) => candidate.targetId === payload.targetId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) return refuseDenied(operationId);
  if (record.state === "ended") return state === "ended" ? { changed: false } : refuseConflict(operationId, record.revision, targetStandingOf(record), payload);
  if (record.state === state) return { changed: false };
  const nextRevision = nextRevisionTokenOf(record.revision);
  const next: CoachingTargetRecord = { ...record, state, revision: nextRevision };
  context.docs.state = withFamily(families.document, "coachingTargets", replacingRecord(families.targets, targetIdOf, record.targetId, next));
  return { changed: true, revision: nextRevision, changedIds: [record.targetId], result: { targetId: record.targetId, state, revision: nextRevision } };
}
function currentTargetTarget(docs: StateDocumentCarrier, targetId: string | undefined): CurrentTarget {
  if (targetId === undefined) return { kind: "absent" };
  const loaded = readFamilies(docs);
  if (!loaded.ok) return { kind: "absent" };
  const record = loaded.families.targets.find((candidate) => candidate.targetId === targetId);
  return record === undefined ? { kind: "absent" } : { kind: "record", revision: record.revision, value: targetStandingOf(record) };
}
const rawTargetIdOf = (input: unknown): string | undefined => rawIdentifierOf(input, "targetId");
function checkInStandingOf(record: CoachingCheckInRecord): CheckInResult {
  const shared = record.shared;
  const state = shared === null ? "private-draft" : shared.withdrawnAt === null ? "shared" : "withdrawn";
  return { checkInId: record.checkInId, state, revision: record.revision, ...(record.privateDraft === null ? {} : { privateRevisionId: record.privateDraft.revisionId }), ...(shared === null ? {} : { sharedRevisionId: shared.revisionId }) };
}
function checkInGrantOf(families: CoachingFamilies, principalId: string, scope: Scope): CoachingGrantRecord | undefined {
  const live = families.grants.filter((grant) => grant.workerPrincipalId === principalId && (grant.state === "accepted" || grant.state === "active"));
  return live.find((grant) => grant.ministryIds.includes(scope.ministryId)) ?? live.at(0);
}
function checkInSharedDurationOf(families: CoachingFamilies, record: CoachingCheckInRecord): CoachingDurationRecord | undefined {
  const grant = families.grants.find((candidate) => candidate.grantId === record.grantId);
  return grant === undefined ? record.shared?.duration : grant.duration;
}
function refuseMisalignedCheckIn(operationId: string, questions: readonly string[], answers: readonly string[]): RefusalResult | null {
  if (questions.length === 0 || questions.length === answers.length) return null;
  return refuseInvalid(operationId, { answers: [`This check-in carries ${String(answers.length)} answers and ${String(questions.length)} questions. Nothing was padded or dropped: give each question one answer and save again.`] });
}
function refuseFromCheckIn(operationId: string, refusal: CheckInRefusal, record: CoachingCheckInRecord, preservedInput: unknown): RefusalResult {
  if (refusal.violations.length > 0) {
    const fields: Record<string, string[]> = {};
    for (const violation of refusal.violations) {
      const existing = (fields[violation.path] ??= []);
      if (!existing.includes(violation.message)) existing.push(violation.message);
    }
    return refuseInvalid(operationId, fields);
  }
  switch (refusal.reason) {
    case "unavailable":
      return refuseUnavailable(operationId, "coaching-check-in");
    case "no-private-draft":
    case "no-recipients":
      return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: [refusal.message] });
    default:
      return refuseConflict(operationId, record.revision, checkInStandingOf(record), preservedInput);
  }
}
/** Saves the worker's private draft of a check-in. */
export async function saveCheckIn(input: MutationInput<SaveCheckInPayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, saveCheckInPayload, "saveCheckIn", { readCurrent: (docs) => currentCheckInTarget(docs, rawCheckInIdOf(input)), apply: (context) => applySaveCheckIn(context, input.payload, input.scope) });
}
function applySaveCheckIn(context: MutationContext, payload: SaveCheckInPayload, scope: Scope): ApplyResult<CheckInResult> {
  const { operationId } = context;
  const at = now();
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const questions = payload.questions ?? [],
    misaligned = refuseMisalignedCheckIn(operationId, questions, payload.answers);
  if (misaligned !== null) return misaligned;
  let record: CoachingCheckInRecord;
  let working: CheckIn;
  if (payload.checkInId === undefined) {
    const grant = checkInGrantOf(families, context.session.principalId, scope);
    if (grant === undefined) return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: ["A check-in belongs to a coaching relationship, and none is open here: invite a coach first."] });
    record = { checkInId: `coaching-check-in-${operationId}`, workerPrincipalId: context.session.principalId, grantId: grant.grantId, privateDraft: null, shared: null, revision: FIRST_REVISION };
    working = { checkInId: record.checkInId, revision: revisionOrdinalOf(FIRST_REVISION) };
  } else {
    const found = families.checkIns.find((candidate) => candidate.checkInId === payload.checkInId);
    if (found === undefined || found.workerPrincipalId !== context.session.principalId) return refuseDenied(operationId);
    record = found;
    const workingRecord = workingCheckInOf(found);
    if (workingRecord === null) return refuseUnavailable(operationId, "coaching-check-in");
    working = workingRecord;
  }
  const saved = savePrivateDraft(working, checkInPayloadOf(questions, payload.answers), revisionOrdinalOf(record.revision), at);
  if (!saved.ok) return refuseFromCheckIn(operationId, saved.error, record, payload);
  if (!saved.value.changed) return { changed: false };
  // A check-in this mutation creates stands at its first revision; every later autosave advances it.
  const nextRevision = payload.checkInId === undefined ? FIRST_REVISION : nextRevisionTokenOf(record.revision),
    sharedDuration = checkInSharedDurationOf(families, record);
  const next = storedCheckInOf(record, saved.value.checkIn, nextRevision, sharedDuration);
  if (next === null) return refuseUnavailable(operationId, "coaching-check-in");
  context.docs.state = withFamily(families.document, "coachingCheckIns", payload.checkInId === undefined ? [...families.checkIns, next] : replacingRecord(families.checkIns, checkInIdOf, record.checkInId, next));
  return { changed: true, revision: nextRevision, ...(payload.checkInId === undefined ? { created: [record.checkInId] } : { changedIds: [record.checkInId] }), result: checkInStandingOf(next) };
}
/** Shares the saved private draft, creating the one revision a named coach may read. */
export async function shareCheckIn(input: MutationInput<ShareCheckInPayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, shareCheckInPayload, "shareCheckIn", { readCurrent: (docs) => currentCheckInTarget(docs, rawCheckInIdOf(input)), apply: (context) => applyShareCheckIn(context, input.payload, input.scope) });
}
function applyShareCheckIn(context: MutationContext, payload: ShareCheckInPayload, scope: Scope): ApplyResult<CheckInResult> {
  const { operationId } = context;
  const at = now();
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const record = families.checkIns.find((candidate) => candidate.checkInId === payload.checkInId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) return refuseDenied(operationId);
  const working = workingCheckInOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-check-in");
  const grantRecord = families.grants.find((candidate) => candidate.grantId === record.grantId),
    grant = grantRecord === undefined ? null : workingGrantOf(grantRecord);
  if (grantRecord === undefined || grant === null) return refuseUnavailable(operationId, "coaching-grant");
  // The relationship must still be open: a share inside a revoked, ended or expired episode, or past its frozen cutoff, is refused rather than recorded as a disclosure nobody may read.
  const episode = activeGrant(grant, accessContextOf(grantRecord, context.session.principalId, "worker", scope), at);
  if (!episode.ok) return refuseFromCoaching(operationId, episode.error, grantRecord, payload);
  const duration = checkInShareDurationOf(grantRecord.duration);
  if (duration === null) return refuseUnavailable(operationId, "coaching-grant");
  // A share records the duration the relationship was accepted with. A payload that states another kind is asking to widen or shorten that window, which a share is not the act that can do.
  if (payload.duration !== undefined && payload.duration.kind !== grantRecord.duration.kind) return refuseInvalid(operationId, { duration: ["A shared check-in records the duration this relationship was accepted with, so the share cannot state another."] });
  const draft = working.privateDraft;
  if (payload.questions !== undefined || payload.answers !== undefined) {
    if (draft === undefined) return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: ["There is no private draft to share yet. Save the draft, then share it."] });
    const questions = payload.questions ?? draft.captured.questions.map((question) => question.wording),
      misaligned = refuseMisalignedCheckIn(operationId, questions, payload.answers ?? []);
    if (misaligned !== null) return misaligned;
    const bodyDiffers = questions.some((wording, index) => wording !== draft.captured.questions[index]?.wording) || (payload.answers ?? []).some((text, index) => text !== draft.answers[index]?.text);
    if (bodyDiffers) return refuseInvalid(operationId, { answers: ["The text on screen is not the saved draft, so nothing was shared. Save the private draft, then share it, so a coach reads the wording you reviewed."] });
  }
  const recipients = payload.recipients ?? [grantRecord.coachPrincipalId],
    shared = openCheckInShare(working, revisionOrdinalOf(record.revision), recipients, duration, at);
  if (!shared.ok) return refuseFromCheckIn(operationId, shared.error, record, payload);
  const nextRevision = nextRevisionTokenOf(record.revision),
    next = storedCheckInOf(record, shared.value.checkIn, nextRevision, grantRecord.duration);
  if (next === null) return refuseUnavailable(operationId, "coaching-check-in");
  context.docs.state = withFamily(families.document, "coachingCheckIns", replacingRecord(families.checkIns, checkInIdOf, record.checkInId, next));
  return { changed: true, revision: nextRevision, changedIds: [record.checkInId], result: checkInStandingOf(next) };
}
/** Changes the shared revision of a check-in, which no other operation may. */
export async function updateSharedCheckIn(input: MutationInput<UpdateSharedCheckInPayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, updateSharedCheckInPayload, "updateSharedCheckIn", { readCurrent: (docs) => currentCheckInTarget(docs, rawCheckInIdOf(input)), apply: (context) => applyUpdateSharedCheckIn(context, input.payload) });
}
function applyUpdateSharedCheckIn(context: MutationContext, payload: UpdateSharedCheckInPayload): ApplyResult<CheckInResult> {
  const { operationId } = context;
  const at = now();
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const record = families.checkIns.find((candidate) => candidate.checkInId === payload.checkInId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) return refuseDenied(operationId);
  const working = workingCheckInOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-check-in");
  if (payload.sharedRevisionId !== undefined && (record.shared === null || payload.sharedRevisionId !== record.shared.revisionId)) return refuseConflict(operationId, record.revision, checkInStandingOf(record), payload);
  const captured = working.shared?.captured.questions ?? [],
    questions = payload.questions === undefined ? captured.map((question) => question.wording) : payload.questions;
  const misaligned = refuseMisalignedCheckIn(operationId, questions, payload.answers);
  if (misaligned !== null) return misaligned;
  const revised = reviseSharedCheckIn(working, checkInPayloadOf(questions, payload.answers), revisionOrdinalOf(record.revision), at);
  if (!revised.ok) return refuseFromCheckIn(operationId, revised.error, record, payload);
  if (!revised.value.changed) return { changed: false };
  const nextRevision = nextRevisionTokenOf(record.revision),
    sharedDuration = checkInSharedDurationOf(families, record);
  const next = storedCheckInOf(record, revised.value.checkIn, nextRevision, sharedDuration);
  if (next === null) return refuseUnavailable(operationId, "coaching-check-in");
  context.docs.state = withFamily(families.document, "coachingCheckIns", replacingRecord(families.checkIns, checkInIdOf, record.checkInId, next));
  return { changed: true, revision: nextRevision, changedIds: [record.checkInId], result: checkInStandingOf(next) };
}
/** Withdraws a shared check-in, so a coach can no longer open it. */
export async function withdrawCheckIn(input: MutationInput<WithdrawCheckInPayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, withdrawCheckInPayload, "withdrawCheckIn", { readCurrent: (docs) => currentCheckInTarget(docs, rawCheckInIdOf(input)), apply: (context) => applyWithdrawCheckIn(context, input.payload) });
}
function applyWithdrawCheckIn(context: MutationContext, payload: WithdrawCheckInPayload): ApplyResult<CheckInResult> {
  const { operationId } = context;
  const at = now();
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const record = families.checkIns.find((candidate) => candidate.checkInId === payload.checkInId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) return refuseDenied(operationId);
  const working = workingCheckInOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-check-in");
  if (payload.sharedRevisionId !== undefined && (record.shared === null || payload.sharedRevisionId !== record.shared.revisionId)) return refuseConflict(operationId, record.revision, checkInStandingOf(record), payload);
  const withdrawn = withdrawSharedCheckIn(working, revisionOrdinalOf(record.revision), at);
  if (!withdrawn.ok) return refuseFromCheckIn(operationId, withdrawn.error, record, payload);
  if (!withdrawn.value.changed) return { changed: false };
  const nextRevision = nextRevisionTokenOf(record.revision),
    sharedDuration = checkInSharedDurationOf(families, record);
  const next = storedCheckInOf(record, withdrawn.value.checkIn, nextRevision, sharedDuration);
  if (next === null) return refuseUnavailable(operationId, "coaching-check-in");
  context.docs.state = withFamily(families.document, "coachingCheckIns", replacingRecord(families.checkIns, checkInIdOf, record.checkInId, next));
  return { changed: true, revision: nextRevision, changedIds: [record.checkInId], result: checkInStandingOf(next) };
}
function currentCheckInTarget(docs: StateDocumentCarrier, checkInId: string | undefined): CurrentTarget {
  if (checkInId === undefined) return { kind: "absent" };
  const loaded = readFamilies(docs);
  if (!loaded.ok) return { kind: "absent" };
  const record = loaded.families.checkIns.find((candidate) => candidate.checkInId === checkInId);
  return record === undefined ? { kind: "absent" } : { kind: "record", revision: record.revision, value: checkInStandingOf(record) };
}
const rawCheckInIdOf = (input: unknown): string | undefined => rawIdentifierOf(input, "checkInId");
const taskShareStandingOf = (record: CoachingTaskShareRecord): TaskShareResult => ({ shareId: record.shareId, taskId: record.taskId, state: record.state, revision: String(record.revision) });
/** Shares a reviewed description of one task occurrence with the coach the worker shares with. */
export async function shareTaskSummary(input: MutationInput<TaskSharePayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, taskSharePayload, "shareTaskSummary", { readCurrent: (docs) => currentTaskTarget(docs, rawTaskIdOf(input)), apply: (context) => applyShareTaskSummary(context, input.payload) });
}
function applyShareTaskSummary(context: MutationContext, payload: TaskSharePayload): ApplyResult<TaskShareResult> {
  const { operationId } = context;
  const at = now();
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const task = families.tasks.find((candidate) => candidate.taskId === payload.taskId);
  if (task === undefined || task.ownerPrincipalId !== context.session.principalId) return refuseDenied(operationId);
  // A recurring task's next occurrence never inherits the predecessor's share: the occurrence identity must be the one the worker selected, so a summary never appears in front of a coach for work nobody chose to share. A task that does not recur has exactly one occurrence, whose identity is the task's.
  const occurrenceId = payload.occurrenceId ?? (task.seriesId === null ? task.taskId : undefined);
  if (occurrenceId === undefined) return refuseInvalid(operationId, { occurrenceId: ["A recurring task's next occurrence is shared only when it is selected, so choose the occurrence you want to share."] });
  const fingerprint = taskReviewedFingerprint(task);
  if (payload.reviewedFingerprint !== undefined && payload.reviewedFingerprint !== fingerprint) return refuseInvalid(operationId, { reviewedFingerprint: ["This task changed since that description was reviewed, so nothing was shared. Review the description again and share it."] });
  const reviewed = reviewTaskSummary(payload.safeDescription, at);
  if (!reviewed.ok) return refuseFromTaskShare(operationId, reviewed.error);
  const existing = families.taskShares.find((share) => share.taskId === task.taskId && share.occurrenceId === occurrenceId && share.state === "shared");
  if (existing !== undefined) {
    const same = existing.reviewedSummary.description === reviewed.value.description && existing.reviewedFingerprint === fingerprint;
    return same ? { changed: false } : refuseConflict(operationId, String(existing.revision), taskShareStandingOf(existing), payload);
  }
  const shareId = `coaching-task-share-${operationId}`;
  const record: CoachingTaskShareRecord = { shareId, taskId: task.taskId, occurrenceId, reviewedSummary: { description: reviewed.value.description, codePoints: reviewed.value.codePoints, reviewedAt: at.toString() }, reviewedFingerprint: fingerprint, state: "shared", revision: 1, withdrawnAt: null };
  context.docs.state = withFamily(families.document, "coachingTaskShares", [...families.taskShares, record]);
  return { changed: true, revision: String(record.revision), created: [shareId], result: taskShareStandingOf(record) };
}
/** Stops sharing one occurrence's summary. */
export async function stopTaskShare(input: MutationInput<StopTaskSharePayload>, source?: SessionSource): Promise<MutationOutcome> {
  return runCoachingMutation(input, source, stopTaskSharePayload, "stopTaskShare", { readCurrent: (docs) => currentShareTarget(docs, rawShareIdOf(input)), apply: (context) => applyStopTaskShare(context, input.payload) });
}
function applyStopTaskShare(context: MutationContext, payload: StopTaskSharePayload): ApplyResult<TaskShareResult> {
  const { operationId } = context;
  const at = now();
  const families = familiesOf(context, operationId);
  if ("refused" in families) return families;
  const record = families.taskShares.find((candidate) => candidate.shareId === stoppedShareIdOf(payload));
  if (record === undefined) return refuseDenied(operationId);
  const task = families.tasks.find((candidate) => candidate.taskId === record.taskId);
  if (task === undefined) return refuseUnavailable(operationId, "tasks");
  if (task.ownerPrincipalId !== context.session.principalId) return refuseDenied(operationId);
  if (record.state === "removed") return { changed: false };
  const working = workingTaskShareOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-task-share");
  const stopped = stopCoachingTaskShare({ share: working, expectedRevision: record.revision }, at);
  if (!stopped.ok) return refuseFromTaskShare(operationId, stopped.error);
  if (stopped.value.state === record.state) return { changed: false };
  const next: CoachingTaskShareRecord = { ...record, state: stopped.value.state, revision: stopped.value.revision, withdrawnAt: stopped.value.withdrawnAt === undefined ? null : stopped.value.withdrawnAt.toString() };
  context.docs.state = withFamily(families.document, "coachingTaskShares", replacingRecord(families.taskShares, shareIdOf, record.shareId, next));
  return { changed: true, revision: String(next.revision), changedIds: [record.shareId], result: taskShareStandingOf(next) };
}
function currentTaskTarget(docs: StateDocumentCarrier, taskId: string | undefined): CurrentTarget {
  if (taskId === undefined) return { kind: "absent" };
  const loaded = readFamilies(docs);
  if (!loaded.ok) return { kind: "absent" };
  const record = loaded.families.tasks.find((candidate) => candidate.taskId === taskId);
  return record === undefined
    ? { kind: "absent" }
    : {
        kind: "record",
        revision: record.revision,
        // The task's own fields are not a conflict payload: a surface compares the revision it read and the status it shows, and nothing of the task's text or its people travels back here.
        value: { taskId: record.taskId, status: record.status, revision: record.revision },
      };
}
function currentShareTarget(docs: StateDocumentCarrier, shareId: string | undefined): CurrentTarget {
  if (shareId === undefined) return { kind: "absent" };
  const loaded = readFamilies(docs);
  if (!loaded.ok) return { kind: "absent" };
  const record = loaded.families.taskShares.find((candidate) => candidate.shareId === shareId);
  return record === undefined ? { kind: "absent" } : { kind: "record", revision: String(record.revision), value: taskShareStandingOf(record) };
}
const rawTaskIdOf = (input: unknown): string | undefined => rawIdentifierOf(input, "taskId");
const rawShareIdOf = (input: unknown): string | undefined => rawIdentifierOf(input, "shareId") ?? rawIdentifierOf(input, "taskShareId");
function rawIdentifierOf(input: unknown, field: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const payload: unknown = Reflect.get(input, "payload");
  if (typeof payload !== "object" || payload === null) return undefined;
  const value: unknown = Reflect.get(payload, field);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
