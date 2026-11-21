/**
 * The six coaching reads: a worker's preparation and sharing surface, and a coach's read-only
 * portfolio and subject.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isNonEmptyString } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { compareCodeUnits } from "@/lib/ordering";
import { err, ok, type Result } from "@/lib/result";
import { failureFor, failurePlanOfDocument } from "@/modules/dev-runtime/failures";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import {
  CHECKIN_MAX_ANSWER_SCALARS,
  CHECKIN_MAX_QUESTIONS,
  CHECKIN_MAX_QUESTION_SCALARS,
  CHECKIN_MAX_REQUEST_BYTES,
  checkInReadState,
  validateCheckInRequest,
  type CheckIn,
  type CheckInAnswer,
  type CheckInPayload,
  type CheckInPrivateDraftRevision,
  type CheckInQuestion,
  type CheckInShareDuration,
  type CheckInSharedRevision,
  type CheckInState,
} from "@/modules/coaching/checkin";
import {
  MODULE_KEYS,
  activeGrant,
  moduleReadState,
  type CoachingAccessContext,
  type CoachingGrant,
  type CoachingRefusal,
  type GrantDuration,
  type GrantLifecycleState,
  type ModuleContentPresence,
  type ModuleKey,
  type ModuleObservation,
  type ModuleReadState,
  type PermissionHold,
  type SubjectAvailability,
} from "@/modules/coaching/grant";
import {
  TARGET_MEASURES,
  coachTargetProgress,
  measureFor,
  resolveCurrentPeriod,
  resolvePeriodContaining,
  resolveTargetState,
  resolveTargetVersion,
  workerTargetProgress,
  type ActivityEvent,
  type ActivityEventKind,
  type PeriodAnchor,
  type PeriodBoundaryResolution,
  type ResolvedPeriod,
  type TargetHomePlacement,
  type TargetState,
  type TargetMeasure,
  type TargetPeriod,
  type TargetRecord,
  type TargetRefusalReason,
  type TargetVersion,
} from "@/modules/coaching/target";
import { TASK_SUMMARY_MAX_CODE_POINTS, safeTaskSummary, taskShareReadState, type TaskShare, type TaskShareSummaryState, type TaskStatus, type TaskSummaryDueDate } from "@/modules/coaching/taskshare";
import type { Money } from "@/modules/money/amount";
import { exponentOf } from "@/modules/money/currency";
import { BASIS_DESCRIPTION, SUPPORT_BASIS, type GiftRow, type SupportProjection } from "@/modules/support/basis";
import { buildReportQuery, runReport, type ReportResult } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import { civilDateAt, parseCivilDate, serialiseCivilDate, todayInZone, type CivilDate, type DatePrecision } from "@/modules/time/civil";
import { shareThroughDateOfCutoff } from "@/modules/time/window";
import { readSession } from "../../store/repository";
import { assertScope, canView, readResultOfRefusal, resolveSession, type ResolvedSession, type SessionSource } from "../authorize";
import {
  buildEnvelope,
  coachingCheckInRecordSchema,
  coachingGrantRecordSchema,
  coachingTaskShareRecordSchema,
  coachingTargetRecordSchema,
  commitmentRowRecordSchema,
  giftRowRecordSchema,
  interactionRecordSchema,
  partnerRecordSchema,
  privateNoteRecordSchema,
  project,
  scopeSchema,
  supportProjectionRecordSchema,
  taskRecordSchema,
  taskReviewedFingerprint,
  type CoachingCheckInRecord,
  type CoachingDurationRecord,
  type CoachingGrantRecord,
  type CoachingTaskShareRecord,
  type CoachingTargetRecord,
  type CommitmentRowRecord,
  type Coverage,
  type GiftRowRecord,
  type InteractionRecord,
  type PrivateNoteRecord,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type Scope,
  type SupportProjectionRecord,
  type TaskRecord,
  type ValueState,
} from "../envelope";
import { LOCAL_STORE_SYSTEM, denied, unavailable, type DenialReason, type ReadResult } from "../outcome";
// Fixed values
const READ_ATTEMPT_ID = "read";

const COACHING_PAGE_SIZE_DEFAULT = 25;

const COACHING_PAGE_SIZE_CAP = 100;

const COACHING_PLANNING_ZONE = "UTC";

const COACHING_SOURCE_REFERENCE = "coaching";

const SUPPORT_PROJECTION_REFERENCE = "support-projection";
// The reason a financial module carries when the scenario this session runs in reports the source behind it
// as down: the module states unavailable and says why, so a surface can never render it as an empty module
// or as a zero reading for a source nothing could read.
const COACHING_MODULE_SOURCE_DOWN_REASON =
  "The source behind this module is reported unavailable in this scenario, so nothing is shown for it rather than a zero or an empty reading.";
// The stored families these reads parse
type StoredCoachingTaskShare = CoachingTaskShareRecord;

const coachingStateSchema = z.object({
  coachingGrants: z.array(coachingGrantRecordSchema),
  coachingTargets: z.array(coachingTargetRecordSchema),
  coachingCheckIns: z.array(coachingCheckInRecordSchema),
  coachingTaskShares: z.array(coachingTaskShareRecordSchema).optional(),
  interactions: z.array(interactionRecordSchema),
  tasks: z.array(taskRecordSchema),
  partners: z.array(partnerRecordSchema),
  privateNotes: z.array(privateNoteRecordSchema).optional(),
  supportProjection: supportProjectionRecordSchema.nullable(),
  gifts: z.array(giftRowRecordSchema),
  commitments: z.array(commitmentRowRecordSchema),
});
type CoachingState = z.infer<typeof coachingStateSchema>;
// Shapes shared by more than one read
interface CoachingPageView {
  readonly index: number;
  readonly size: number;
  readonly total: number;
  readonly totalPages: number;
  readonly cappedAt: number;
}
function relationshipMinistryOf(record: CoachingGrantRecord, scope: Scope): string | null {
  if (record.ministryIds.includes(scope.ministryId)) return scope.ministryId;
  return record.ministryIds.at(0) ?? null;
}
interface CoachingModuleFlagView {
  readonly module: ModuleKey;
  readonly selected: boolean;
}
interface CoachingDurationView {
  readonly kind: "ongoing" | "through-date" | "none";
  readonly shareThroughDate: string | null;
  readonly frozenZone: string | null;
  readonly cutoffInstant: string | null;
  readonly boundedBy: "share-through" | "source" | null;
  readonly boundInstant: string | null;
  readonly openAtRead: boolean;
  readonly remainingMilliseconds: number | null;
}
interface CoachingModuleAdmissionView {
  readonly module: ModuleKey;
  readonly until: string | null;
  readonly remainingMilliseconds: number | null;
}
// Session, state and scope
interface CoachingReadContext {
  readonly session: ResolvedSession;
  readonly state: CoachingState;
  readonly at: Temporal.Instant;
}
type CoachingLoad = { readonly ok: true; readonly context: CoachingReadContext } | { readonly ok: false; readonly result: ReadResult<never> };

type ScopeLoad = { readonly ok: true; readonly scope: Scope } | { readonly ok: false; readonly result: ReadResult<never> };

function deniedRead(reasonCode: DenialReason): ReadResult<never> {
  return { kind: "denied", denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode }) };
}
function unavailableRead(reference: string, guidance: string): ReadResult<never> {
  const source: SourceReference = { system: LOCAL_STORE_SYSTEM, reference };
  logger.sourceUnavailable({ job: "coaching", source });
  return {
    kind: "unavailable",
    unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance }),
  };
}
async function loadCoachingState(job: string, source?: SessionSource): Promise<CoachingLoad> {
  let resolution: Awaited<ReturnType<typeof resolveSession>>;
  try {
    resolution = await resolveSession(source);
  } catch {
    // A request context that cannot yield its cookie leaves no session to establish, which is the one
    // refusal the resolver names for that case: it discloses nothing about a record.
    return { ok: false, result: deniedRead("session-unavailable") };
  }
  if (!resolution.ok) {
    return { ok: false, result: readResultOfRefusal(resolution.refusal) };
  }
  const { session } = resolution;
  let documents: Awaited<ReturnType<typeof readSession>>;
  try {
    documents = await readSession(session.sessionId);
  } catch {
    return {
      ok: false,
      result: unavailableRead(COACHING_SOURCE_REFERENCE, "The coaching records for this session could not be read. Reload the session; nothing was changed."),
    };
  }
  if (documents === undefined) {
    return {
      ok: false,
      result: unavailableRead(COACHING_SOURCE_REFERENCE, "This session holds no records yet. Reset the development data and try again."),
    };
  }
  // An armed scope-denial plan must take effect on the read it names, so it is answered here — after
  // the documents are read and before the coaching families are decoded, so nothing is enumerated,
  // counted or projected first. The refusal is this family's ordinary denial by its ordinary reason
  // code, so no module name, count, title or existence flag leaves with it.
  if (failureFor(failurePlanOfDocument(documents.meta), "read", job) === "denied") {
    return { ok: false, result: deniedRead("no-permission") };
  }
  const parsed = coachingStateSchema.safeParse(documents.state);
  if (!parsed.success) {
    return {
      ok: false,
      result: unavailableRead(COACHING_SOURCE_REFERENCE, "The coaching records for this session did not decode. Nothing is shown, and nothing was changed."),
    };
  }
  return {
    ok: true,
    context: { session, state: parsed.data, at: instantAt(session.clockOffsetMs) },
  };
}
function workerScope(context: CoachingReadContext): ScopeLoad {
  const { session } = context;
  const selected = session.selected;
  if (selected === null) {
    return { ok: false, result: deniedRead("no-permission") };
  }
  const decision = assertScope(session, selected);
  if (!decision.ok) {
    return { ok: false, result: { kind: "denied", denied: decision.denial } };
  }
  return { ok: true, scope: selected };
}
function coachScope(session: ResolvedSession, ministryId: string): Scope {
  const admission = session.admittedMemberships.find((membership) => membership.ministryId === ministryId);
  if (admission !== undefined) {
    return scopeSchema.parse({
      organizationId: admission.organizationId,
      ministryId: admission.ministryId,
      supportSubjectId: admission.supportSubjectId,
      principalId: session.principalId,
    });
  }
  return scopeSchema.parse({
    organizationId: `grant-authority:${ministryId}`,
    ministryId,
    supportSubjectId: `grant-authority:${ministryId}`,
    principalId: session.principalId,
  });
}
// Small shared helpers
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
function asOfDate(at: Temporal.Instant): string | null {
  const today = todayInZone(COACHING_PLANNING_ZONE, at);
  return today.status === "resolved" ? serialiseCivilDate(today.date) : null;
}
function coverageOf(from: string | null, at: Temporal.Instant): Coverage {
  return { from, to: asOfDate(at), state: "complete" };
}
function collectionRevision(members: readonly { readonly id: string; readonly revision: string }[]): string {
  if (members.length === 0) return "empty";
  return members.map((member) => `${member.id}@${member.revision}`).join("|");
}
function pageOf<T>(items: readonly T[], page: number | undefined, pageSize: number | undefined): { readonly items: readonly T[]; readonly page: CoachingPageView } {
  const size = clampPageSize(pageSize);
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / size);
  const index = clampPageIndex(page, totalPages);
  const start = index * size;
  return {
    items: items.slice(start, start + size),
    page: { index, size, total, totalPages, cappedAt: COACHING_PAGE_SIZE_CAP },
  };
}
function clampPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isSafeInteger(requested) || requested <= 0) {
    return COACHING_PAGE_SIZE_DEFAULT;
  }
  return Math.min(requested, COACHING_PAGE_SIZE_CAP);
}
function clampPageIndex(requested: number | undefined, totalPages: number): number {
  if (totalPages === 0) return 0;
  if (requested === undefined || !Number.isSafeInteger(requested) || requested < 0) return 0;
  return Math.min(requested, totalPages - 1);
}
function countState(count: number | null): RecordedValueState {
  if (count === null) return "unavailable";
  return count === 0 ? "zero" : "value";
}
function actionOf(name: string, available: boolean, reason?: string): ReadAction {
  return available ? { name, available: true } : { name, available: false, reason: reason ?? "This action is not available here." };
}
// Adapting a stored grant to the coaching module's working grant
function revisionNumberOf(stored: string): number {
  const parsed = Number.parseInt(stored, 10);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}
function workingDurationOf(record: CoachingGrantRecord): GrantDuration | null {
  const { duration } = record;
  if (duration.kind === "through-date") {
    const cutoff = duration.cutoffInstant === null ? null : instantOf(duration.cutoffInstant);
    if (cutoff === null) return null;
    return {
      kind: "through-date",
      // The day the worker chose is named by the frozen instant and its zone, read back through the
      // one calendar rule in `modules/time`; a bound whose zone cannot be resolved states no day.
      shareThroughDate: shareThroughDateOfCutoff({
        cutoffInstant: cutoff,
        frozenZone: duration.frozenZone,
      }),
      frozenZone: duration.frozenZone,
      cutoffInstant: cutoff,
      sourceLimitInstant: null,
      limitedBy: "share-through",
      nominalWording: `Shared until ${cutoff.toString()} in ${duration.frozenZone}`,
      resolution: null,
      nominalDisagreesWithResolved: false,
      settledAt: null,
    };
  }
  return {
    kind: "ongoing",
    shareThroughDate: null,
    frozenZone: duration.frozenZone,
    cutoffInstant: null,
    sourceLimitInstant: null,
    limitedBy: null,
    nominalWording: "Open-ended, with no Share-through date of its own",
    resolution: null,
    nominalDisagreesWithResolved: false,
    settledAt: null,
  };
}
function workingFinancialRangeOf(record: CoachingGrantRecord): Result<CoachingGrant["financialRange"], string> {
  const range = record.financialRange;
  if (range === null) return ok(null);
  const from = civilDateOf(range.from);
  const to = civilDateOf(range.to);
  if (from === null || to === null) return err("a reviewed financial range could not be read");
  return ok({ from, to, measures: [] });
}
function toWorkingGrant(record: CoachingGrantRecord): Result<CoachingGrant, string> {
  const issuedAt = instantOf(record.invitation.issuedAt);
  const expiresAt = instantOf(record.invitation.expiresAt);
  if (issuedAt === null || expiresAt === null) return err("an invitation instant could not be read");
  const financialRange = workingFinancialRangeOf(record);
  if (!financialRange.ok) return financialRange;
  // Every closure in the stored vocabulary follows an acceptance: an invitation that was revoked, ended or
  // expired was accepted first, so it states an acceptance instant and the module names the closure instead
  // of reporting `not-accepted`. The stored states carry no `superseded` member — a superseded invitation is
  // recorded by `invitation.supersededBy` — and an unwrapped replacement closes through its own row.
  const accepted = record.state !== "invited";
  return ok({
    grantId: record.grantId,
    workerPrincipalId: record.workerPrincipalId,
    coachPrincipalId: record.coachPrincipalId,
    ministryIds: [...record.ministryIds],
    modules: record.modules,
    duration: workingDurationOf(record),
    financialRange: financialRange.value,
    state: record.state satisfies GrantLifecycleState,
    identityVerification: accepted ? "verified" : "unverified",
    acceptedAt: accepted ? issuedAt : null,
    invitation: {
      issuedAt,
      expiresAt,
      supersededBy: record.invitation.supersededBy,
    },
    revision: revisionNumberOf(record.revision),
  });
}
function accessContextOf(actor: "worker" | "coach", principalId: string, organizationId: string, ministryId: string, subjectAvailability: "available" | "unavailable"): CoachingAccessContext {
  return {
    actor: { role: actor, principalId },
    organizationId,
    ministryId,
    subjectAvailability,
    permissionHold: "none",
  };
}
function durationViewOf(episode: {
  readonly duration: GrantDuration;
  readonly cutoffInstant: Temporal.Instant | null;
  readonly boundInstant: Temporal.Instant | null;
  readonly remainingMilliseconds: number | null;
}): CoachingDurationView {
  return {
    kind: episode.duration.kind,
    shareThroughDate: episode.duration.shareThroughDate === null ? null : serialiseCivilDate(episode.duration.shareThroughDate),
    frozenZone: episode.duration.frozenZone,
    cutoffInstant: episode.cutoffInstant?.toString() ?? null,
    boundedBy: episode.duration.limitedBy,
    boundInstant: episode.boundInstant?.toString() ?? null,
    openAtRead: episode.boundInstant === null || episode.remainingMilliseconds !== null,
    remainingMilliseconds: episode.remainingMilliseconds,
  };
}
// Adapting a stored target to the coaching module's working target
function workingPeriodOf(record: CoachingTargetRecord): Result<TargetPeriod, string> {
  const period = record.period;
  if (period.kind !== "custom") return ok({ kind: period.kind });
  if (period.from === null || period.to === null) return err("a custom period states no range");
  const from = civilDateOf(period.from);
  const to = civilDateOf(period.to);
  if (from === null || to === null) return err("a custom period's range could not be read");
  return ok({ kind: "custom", start: from, end: to });
}
function workingVersionOf(version: CoachingTargetRecord["versions"][number]): Result<TargetVersion, string> {
  const effectiveFrom = civilDateOf(version.effectiveFrom);
  const calendarStart = civilDateOf(version.calendarStart);
  if (effectiveFrom === null || calendarStart === null) {
    return err("a target version's dates could not be read");
  }
  if (version.effectiveTo === null) {
    return ok({
      revisionId: version.revisionId,
      effectiveFrom,
      quantity: version.quantity,
      measure: version.measure,
      calendarStart,
    });
  }
  const effectiveTo = civilDateOf(version.effectiveTo);
  if (effectiveTo === null) return err("a target version's end could not be read");
  return ok({
    revisionId: version.revisionId,
    effectiveFrom,
    effectiveTo,
    quantity: version.quantity,
    measure: version.measure,
    calendarStart,
  });
}
function toWorkingTarget(record: CoachingTargetRecord): Result<TargetRecord, string> {
  const calendarStart = civilDateOf(record.calendarStart);
  if (calendarStart === null) return err("a target's calendar start could not be read");
  const period = workingPeriodOf(record);
  if (!period.ok) return period;
  const versions: TargetVersion[] = [];
  for (const stored of record.versions) {
    const version = workingVersionOf(stored);
    if (!version.ok) return version;
    versions.push(version.value);
  }
  return ok({
    targetId: record.targetId,
    privateLabel: record.privateLabel,
    measure: record.measure,
    quantity: record.quantity,
    period: period.value,
    calendarStart,
    homePlacement: record.homePlacement satisfies TargetHomePlacement,
    state: record.state,
    versions,
  });
}
function anchorOf(target: TargetRecord): PeriodAnchor {
  return { period: target.period, calendarStart: target.calendarStart };
}
interface TargetVersionView {
  readonly revisionId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly quantity: number;
  readonly measure: TargetMeasure;
  readonly calendarStart: string;
}
function versionViewOf(version: TargetVersion): TargetVersionView {
  return {
    revisionId: version.revisionId,
    effectiveFrom: serialiseCivilDate(version.effectiveFrom),
    effectiveTo: version.effectiveTo === undefined ? null : serialiseCivilDate(version.effectiveTo),
    quantity: version.quantity,
    measure: version.measure,
    calendarStart: serialiseCivilDate(version.calendarStart),
  };
}
interface MeasuredPeriod {
  readonly period: ResolvedPeriod;
  readonly version: TargetVersion | null;
  readonly versionProblem: TargetRefusalReason | null;
  readonly count: number | null;
}
function measuredPeriodOf(target: TargetRecord, activities: readonly ActivityEvent[], period: ResolvedPeriod): MeasuredPeriod {
  const version = resolveTargetVersion(target.versions, period);
  if (!version.ok) {
    return { period, version: null, versionProblem: version.error, count: null };
  }
  const count = measureFor({
    measure: version.value.measure,
    period,
    activities,
    alreadyCredited: new Set<string>(),
  }).count;
  return { period, version: version.value, versionProblem: null, count };
}
function measuredPeriodsOf(target: TargetRecord, activities: readonly ActivityEvent[], at: Temporal.Instant): readonly MeasuredPeriod[] {
  const anchor = anchorOf(target);
  const current = resolveCurrentPeriod(anchor, COACHING_PLANNING_ZONE, at);
  if (!current.ok) return [];
  const periods: MeasuredPeriod[] = [measuredPeriodOf(target, activities, current.value)];
  const previous = resolvePeriodContaining(anchor, current.value.start.subtract({ days: 1 }));
  if (previous.ok) periods.push(measuredPeriodOf(target, activities, previous.value));
  return periods;
}
// Activity records: the one mapping from what was recorded to what a measure counts
const ACTIVITY_KIND_BY_RECORDED_TYPE: Readonly<Record<string, ActivityEventKind>> = {
  call: "call",
  "phone call": "call",
  "phone-call": "call",
  "telephone call": "call",
  email: "personal-message",
  "personal message": "personal-message",
  "personal-message": "personal-message",
  message: "personal-message",
  conversation: "conversation",
  "conversation held": "conversation",
  meeting: "meeting-held",
  "meeting held": "meeting-held",
  "meeting-held": "meeting-held",
  visit: "meeting-held",
};
function activityKindOf(recordedType: string): ActivityEventKind | undefined {
  return ACTIVITY_KIND_BY_RECORDED_TYPE[recordedType.trim().toLowerCase()];
}
function occurrenceOf(interaction: InteractionRecord): ActivityEvent["occurrence"] | null {
  if (interaction.precision === "unknown") return { precision: "unknown" };
  const recorded = interaction.occurredOn;
  if (recorded === null) return null;
  const date = civilDateOf(recorded);
  if (date === null) return null;
  return { precision: interaction.precision, date };
}
function activityEventsOf(interactions: readonly InteractionRecord[]): readonly ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const interaction of interactions) {
    const kind = activityKindOf(interaction.type);
    if (kind === undefined) continue;
    const occurrence = occurrenceOf(interaction);
    if (occurrence === null) continue;
    events.push({ activityId: interaction.interactionId, kind, occurrence });
  }
  return events;
}
// The support projection a coach's reviewed range is read over
function giftRowOf(record: GiftRowRecord): GiftRow | null {
  const entryOn = civilDateOf(record.entryOn);
  if (entryOn === null) return null;
  const originalGiftOn = record.originalGiftOn === null ? null : civilDateOf(record.originalGiftOn);
  if (record.originalGiftOn !== null && originalGiftOn === null) return null;
  return {
    giftRowId: record.giftRowId,
    giftId: record.giftId,
    ...(record.allocationId === null ? {} : { allocationId: record.allocationId }),
    amount: record.amount,
    ...(originalGiftOn === null ? {} : { originalGiftOn }),
    datePrecision: record.datePrecision satisfies DatePrecision,
    ...(record.designation === null ? {} : { designation: record.designation }),
    attribution: record.attribution,
    ...(record.refundOf === null ? {} : { refundOf: record.refundOf }),
    provenance: record.provenance,
    entryOn,
  };
}
type CommitmentRow = SupportProjection["commitments"][number];

function commitmentRowOf(record: CommitmentRowRecord): CommitmentRow | null {
  const lastSuccessfulOn = record.lastSuccessfulOn === null ? null : civilDateOf(record.lastSuccessfulOn);
  if (record.lastSuccessfulOn !== null && lastSuccessfulOn === null) return null;
  const nextEligibleOn = record.nextEligibleOn === null ? null : civilDateOf(record.nextEligibleOn);
  if (record.nextEligibleOn !== null && nextEligibleOn === null) return null;
  const resumeOn = record.pause.resumeOn === null ? null : civilDateOf(record.pause.resumeOn);
  if (record.pause.resumeOn !== null && resumeOn === null) return null;
  return {
    commitmentRowId: record.commitmentRowId,
    kind: record.kind,
    cadence: record.cadence,
    perOccurrence: record.perOccurrence,
    bucketState: record.bucketState,
    ...(lastSuccessfulOn === null ? {} : { lastSuccessfulOn }),
    ...(nextEligibleOn === null ? {} : { nextEligibleOn }),
    pause: { state: record.pause.state, ...(resumeOn === null ? {} : { resumeOn }) },
    ...(record.fixedTotal === null
      ? {}
      : {
          fixedTotal: {
            promised: record.fixedTotal.promised,
            fulfilled: record.fixedTotal.fulfilled,
            released: record.fixedTotal.released,
            remaining: record.fixedTotal.remaining,
          },
        }),
  };
}
function unavailableSupportReason(why: string): string {
  logger.sourceUnavailable({
    job: "coaching",
    source: { system: LOCAL_STORE_SYSTEM, reference: SUPPORT_PROJECTION_REFERENCE },
  });
  return `the support source behind this range could not be read: ${why}`;
}
type SupportLoad = { readonly ok: true; readonly projection: SupportProjection } | { readonly ok: false; readonly reason: string };

function supportProjectionOf(state: CoachingState): SupportLoad {
  const record: SupportProjectionRecord | null = state.supportProjection;
  if (record === null) {
    return { ok: false, reason: unavailableSupportReason("no projection is held") };
  }
  const gifts: GiftRow[] = [];
  for (const stored of state.gifts) {
    const row = giftRowOf(stored);
    if (row === null) {
      return { ok: false, reason: unavailableSupportReason("a gift row's day could not be read") };
    }
    gifts.push(row);
  }
  const commitments: CommitmentRow[] = [];
  for (const stored of state.commitments) {
    const row = commitmentRowOf(stored);
    if (row === null) {
      return {
        ok: false,
        reason: unavailableSupportReason("a commitment row's day could not be read"),
      };
    }
    commitments.push(row);
  }
  return {
    ok: true,
    projection: {
      supportSubjectId: record.supportSubjectId,
      basis: record.basis,
      currencyExponents: record.currencyExponents,
      coverage: record.coverage,
      asOf: record.asOf,
      lastSourceUpdate: record.lastSourceUpdate,
      source: record.source,
      gifts,
      commitments,
    },
  };
}
// Shared task summaries
function dueDateOf(task: TaskRecord): TaskSummaryDueDate {
  if (task.dueOn === null) return { kind: "undated" };
  const date = civilDateOf(task.dueOn);
  return date === null ? { kind: "undated" } : { kind: "dated", date, precision: "date" };
}
type TaskDueDateView = { readonly kind: "dated"; readonly date: string; readonly precision: string } | { readonly kind: "undated" };

function dueDateViewOf(dueDate: TaskSummaryDueDate): TaskDueDateView {
  return dueDate.kind === "undated" ? { kind: "undated" } : { kind: "dated", date: serialiseCivilDate(dueDate.date), precision: dueDate.precision };
}
function workingShareOf(share: StoredCoachingTaskShare): TaskShare | null {
  const reviewedAt = instantOf(share.reviewedSummary.reviewedAt);
  if (reviewedAt === null) return null;
  const base: TaskShare = {
    shareId: share.shareId,
    occurrenceId: share.occurrenceId,
    reviewedSummary: {
      description: share.reviewedSummary.description,
      codePoints: share.reviewedSummary.codePoints,
      reviewedAt,
    },
    reviewedFingerprint: share.reviewedFingerprint,
    state: share.state,
    revision: share.revision,
  };
  if (share.withdrawnAt === undefined || share.withdrawnAt === null) return base;
  const withdrawnAt = instantOf(share.withdrawnAt);
  if (withdrawnAt === null) return null;
  return { ...base, withdrawnAt };
}
function taskSummaryObservation(states: readonly TaskShareSummaryState[]): ModuleObservation {
  const present = states.filter((state) => state === "shared").length;
  const presence: ModuleContentPresence = states.length === 0 ? "none" : present === states.length ? "complete" : "partial";
  return {
    presence,
    withheldUntilReReviewed: states.some((state) => state === "needs-review"),
  };
}
function taskStatusOf(task: TaskRecord | undefined): TaskStatus | null {
  return task === undefined ? null : task.status;
}
function statedDurationViewOf(duration: GrantDuration | null, at: Temporal.Instant): CoachingDurationView {
  if (duration === null) {
    return {
      kind: "none",
      shareThroughDate: null,
      frozenZone: null,
      cutoffInstant: null,
      boundedBy: null,
      boundInstant: null,
      openAtRead: false,
      remainingMilliseconds: null,
    };
  }
  const bound = duration.cutoffInstant ?? duration.sourceLimitInstant;
  const remaining = bound === null ? null : bound.epochMilliseconds - at.epochMilliseconds;
  const ahead = remaining !== null && remaining > 0;
  return {
    kind: duration.kind,
    shareThroughDate: duration.shareThroughDate === null ? null : serialiseCivilDate(duration.shareThroughDate),
    frozenZone: duration.frozenZone,
    cutoffInstant: duration.cutoffInstant?.toString() ?? null,
    boundedBy: duration.limitedBy,
    boundInstant: bound?.toString() ?? null,
    openAtRead: bound === null || ahead,
    remainingMilliseconds: ahead ? remaining : null,
  };
}
// readCoachingOverview: the worker's own preparation and sharing situation
interface PrivatePreparationView {
  readonly preparationId: string;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly revision: string;
  readonly body: string | null;
  readonly updatedOn: string | null;
}
interface CoachingOutcomesView {
  readonly invitationIssued: boolean;
  readonly identityVerified: boolean;
  readonly accepted: boolean;
  readonly accessLive: boolean;
}
interface AdmittedModuleView {
  readonly module: ModuleKey;
  readonly readState: ModuleReadState | null;
}
interface WorkerRelationshipView {
  readonly grantId: string;
  readonly recipientPrincipalId: string;
  readonly ministryIds: readonly string[];
  readonly state: GrantLifecycleState;
  readonly modules: readonly CoachingModuleFlagView[];
  readonly selectedModules: readonly ModuleKey[];
  readonly sharesNothing: boolean;
  readonly availability: {
    readonly source: SubjectAvailability;
    readonly permissionHold: PermissionHold;
  };
  readonly admittedModules: readonly AdmittedModuleView[];
  readonly duration: CoachingDurationView;
  readonly invitation: {
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly supersededBy: string | null;
    readonly acceptanceWindowOpen: boolean;
  };
  readonly outcomes: CoachingOutcomesView;
  readonly readRefusal: CoachingRefusal | null;
  readonly revision: string;
}
interface CoachingOverviewView {
  readonly preparation: readonly PrivatePreparationView[];
  readonly relationships: readonly WorkerRelationshipView[];
  readonly activeGrantId: string | null;
  readonly activeModuleCount: number;
}
function latestPrivateNoteOf(notes: readonly PrivateNoteRecord[], partnerId: string, principalId: string): { readonly body: string; readonly updatedOn: string | null } | null {
  let latest: PrivateNoteRecord | null = null;
  let latestAt: Temporal.Instant | null = null;
  for (const note of notes) {
    if (note.partnerId !== partnerId || note.authorPrincipalId !== principalId) continue;
    const createdAt = instantOf(note.createdAt);
    if (createdAt === null) continue;
    if (latestAt === null || Temporal.Instant.compare(createdAt, latestAt) > 0) {
      latest = note;
      latestAt = createdAt;
    }
  }
  if (latest === null || latestAt === null) return null;
  const day = civilDateAt(latestAt, COACHING_PLANNING_ZONE);
  return {
    body: latest.body,
    updatedOn: day.status === "resolved" ? serialiseCivilDate(day.date) : null,
  };
}
/** The worker's own preparation and sharing situation. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCoachingOverview(): Promise<ReadResult<ReadEnvelope<CoachingOverviewView>>> {
  const loaded = await loadCoachingState("readCoachingOverview");
  if (!loaded.ok) return loaded.result;
  const scoped = workerScope(loaded.context);
  if (!scoped.ok) return scoped.result;
  const { session, state, at } = loaded.context;
  const scope = scoped.scope;
  // A preparation record's prose is its own class's note text, so each record states the principal's
  // latest private note on it and the day that note stands for. A record with no note keeps both fields
  // absent, which the surface states as an empty preparation rather than filling the slot with a name.
  const ownNotes = state.privateNotes ?? [];
  const preparation = state.partners
    .filter((partner) => partner.kind === "private-preparation" && partner.audience === "private")
    .map((partner): PrivatePreparationView => {
      const visible = project(partner, ["partnerId", "displayName", "tags", "revision"] as const);
      const prose = latestPrivateNoteOf(ownNotes, partner.partnerId, session.principalId);
      return {
        preparationId: visible.partnerId,
        displayName: visible.displayName,
        tags: visible.tags,
        revision: visible.revision,
        body: prose === null ? null : prose.body,
        updatedOn: prose === null ? null : prose.updatedOn,
      };
    })
    .toSorted((one, two) => compareCodeUnits(one.displayName, two.displayName));
  const relationships: WorkerRelationshipView[] = [];
  const valueStates: Record<string, RecordedValueState> = {};
  let activeGrantId: string | null = null;
  let activeModuleCount = 0;
  // The support source is assembled at most once for this read, and only when a live relationship
  // actually shares a module that reads it: assembling it eagerly would record a source outage for a
  // session that shares no financial module at all, which is a diagnostic no read asked for.
  let support: SupportLoad | null = null;
  const supportLoad = (): SupportLoad => {
    support ??= supportProjectionOf(state);
    return support;
  };
  for (const record of state.coachingGrants) {
    const decision = canView(session, { kind: "coaching-grant", grant: record, now: at });
    if (!decision.allowed) continue;
    const working = toWorkingGrant(record);
    if (!working.ok) {
      return unavailableRead(COACHING_SOURCE_REFERENCE, "A coaching relationship could not be read. Nothing is shown for it, and nothing was changed.");
    }
    const ministryId = relationshipMinistryOf(record, scope);
    const admission = ministryId === null ? null : activeGrant(working.value, accessContextOf("worker", session.principalId, scope.organizationId, ministryId, "available"), at);
    const episode = admission !== null && admission.ok ? admission.value : null;
    const readRefusal: CoachingRefusal | null =
      ministryId === null
        ? {
            reason: "ministry-not-admitted",
            message: "This relationship covers no ministry, so nothing is shared in it.",
          }
        : admission !== null && !admission.ok
          ? admission.error
          : null;
    const selectedModules = MODULE_KEYS.filter((key) => record.modules[key]);
    const expiresAt = instantOf(record.invitation.expiresAt);
    // What a coach can read right now, decided by the coaching module for each selected module and for
    // nothing the grant never switched on. A module that reads the support source is `unavailable` while
    // that source cannot be read — or while the scenario this session runs in reports it down — and the
    // independent modules stay usable, which is what keeps an outage distinct from an ending.
    const admittedModules: AdmittedModuleView[] = [];
    if (episode !== null && ministryId !== null) {
      for (const key of selectedModules) {
        // The source is assembled at most once, and only for a module that reads it: a session sharing
        // nothing financial must not record its outage as a diagnostic this read never asked for.
        const supportSource: SupportLoad | null = isFinancialModule(key) ? supportLoad() : null;
        const subjectAvailability: SubjectAvailability =
          (supportSource !== null && !supportSource.ok) || moduleSourceReportedDown(session, key) ? "unavailable" : "available";
        const decision = moduleReadState(
          working.value,
          key,
          accessContextOf("worker", session.principalId, scope.organizationId, ministryId, subjectAvailability),
          at,
          observationOf(key, state, supportSource),
        );
        // A module this read does not admit is left out rather than listed with a guessed state, so the
        // surface cannot render a placeholder for something nothing authorised.
        if (!decision.ok) continue;
        admittedModules.push({ module: key, readState: decision.value });
      }
    }
    // The availability is the read's own evidence, never a fixed answer. The source is unavailable when
    // a module a coach can read right now is in that state, and the hold is the refusal this read
    // produced: no stored record in this release carries a permission hold (see `accessContextOf`), so a
    // hold a source states will arrive through that refusal rather than through a literal set here.
    const availability: {
      readonly source: SubjectAvailability;
      readonly permissionHold: PermissionHold;
    } = {
      source: admittedModules.some((entry) => entry.readState === "unavailable") ? "unavailable" : "available",
      permissionHold: readRefusal?.reason === "permission-hold" ? "temporary" : "none",
    };
    if (episode !== null && activeGrantId === null) {
      activeGrantId = record.grantId;
      activeModuleCount = selectedModules.length;
    }
    const index = relationships.length;
    valueStates[`relationships.${index}.duration.remainingMilliseconds`] = countState(episode === null ? null : episode.remainingMilliseconds);
    relationships.push({
      grantId: record.grantId,
      recipientPrincipalId: record.coachPrincipalId,
      ministryIds: [...record.ministryIds],
      state: record.state,
      modules: MODULE_KEYS.map((key) => ({ module: key, selected: record.modules[key] })),
      selectedModules,
      sharesNothing: selectedModules.length === 0,
      availability,
      admittedModules,
      duration: episode === null ? statedDurationViewOf(working.value.duration, at) : durationViewOf(episode),
      invitation: {
        issuedAt: record.invitation.issuedAt,
        expiresAt: record.invitation.expiresAt,
        supersededBy: record.invitation.supersededBy,
        acceptanceWindowOpen: record.state === "invited" && record.invitation.supersededBy === null && expiresAt !== null && Temporal.Instant.compare(at, expiresAt) < 0,
      },
      outcomes: {
        invitationIssued: true,
        identityVerified: working.value.identityVerification === "verified",
        accepted: working.value.acceptedAt !== null,
        accessLive: episode !== null,
      },
      readRefusal,
      revision: record.revision,
    });
  }
  relationships.sort((one, two) => compareCodeUnits(one.grantId, two.grantId));
  valueStates.activeModuleCount = countState(activeModuleCount);
  const anyLive = relationships.some((relationship) => relationship.outcomes.accessLive);
  const actions: readonly ReadAction[] = [
    actionOf("inviteCoach", true),
    actionOf("setModule", anyLive, "No live coaching relationship covers this ministry, so no module can be switched."),
    actionOf("revokeGrant", anyLive, "No live coaching relationship covers this ministry, so there is nothing to revoke."),
    actionOf("endCoaching", anyLive, "No live coaching relationship covers this ministry, so there is nothing to end."),
  ];
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data: { preparation, relationships, activeGrantId, activeModuleCount },
      scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: COACHING_SOURCE_REFERENCE },
      revision: collectionRevision(
        relationships.map((relationship) => ({
          id: relationship.grantId,
          revision: relationship.revision,
        })),
      ),
      asOf: at.toString(),
      coverage: coverageOf(null, at),
      valueStates,
      actions,
    }),
  };
}
// readTargets: the four measures, over the periods the worker set
interface WorkerTargetPeriodView {
  readonly start: string;
  readonly endInclusive: string;
  readonly exclusiveEnd: string;
  readonly startResolution: PeriodBoundaryResolution;
  readonly exclusiveEndResolution: PeriodBoundaryResolution;
  readonly version: TargetVersionView | null;
  readonly versionProblem: TargetRefusalReason | null;
  readonly count: number | null;
  readonly countState: RecordedValueState;
  readonly state: TargetState;
}
interface WorkerTargetView {
  readonly targetId: string;
  readonly privateLabel: string;
  readonly measure: TargetMeasure;
  readonly quantity: number;
  readonly period: {
    readonly kind: "weekly" | "monthly" | "custom";
    readonly from: string | null;
    readonly to: string | null;
  };
  readonly calendarStart: string;
  readonly homePlacement: TargetHomePlacement;
  readonly state: TargetState;
  readonly versions: readonly TargetVersionView[];
  readonly periods: readonly WorkerTargetPeriodView[];
  readonly revision: string;
}
interface TargetsView {
  readonly targets: readonly WorkerTargetView[];
  readonly measures: readonly TargetMeasure[];
  readonly page: CoachingPageView;
  readonly planningZone: string;
  readonly activityEventsRead: number;
}
function workerTargetViewOf(record: CoachingTargetRecord, target: TargetRecord, activities: readonly ActivityEvent[], at: Temporal.Instant): WorkerTargetView {
  const periods: WorkerTargetPeriodView[] = [];
  const measured = measuredPeriodsOf(target, activities, at);
  for (const entry of measured) {
    const version = entry.version;
    const progress =
      version === null
        ? null
        : workerTargetProgress({
            target,
            version,
            period: entry.period,
            count: entry.count,
          });
    // A period that no single version covers is measured against nothing, so its state names the
    // unreadable source rather than borrowing the plan that happens to be current.
    const state = progress === null ? resolveTargetState({ target, recorded: entry.count, placement: target.homePlacement }) : progress.state;
    periods.push({
      start: serialiseCivilDate(entry.period.start),
      endInclusive: serialiseCivilDate(entry.period.endInclusive),
      exclusiveEnd: serialiseCivilDate(entry.period.exclusiveEnd),
      startResolution: entry.period.startResolution,
      exclusiveEndResolution: entry.period.exclusiveEndResolution,
      version: version === null ? null : versionViewOf(version),
      versionProblem: entry.versionProblem,
      count: entry.count,
      countState: countState(entry.count),
      state,
    });
  }
  const current = periods.at(0);
  const storedPeriod = record.period;
  return {
    targetId: record.targetId,
    privateLabel: record.privateLabel,
    measure: record.measure,
    quantity: record.quantity,
    period: { kind: storedPeriod.kind, from: storedPeriod.from, to: storedPeriod.to },
    calendarStart: record.calendarStart,
    homePlacement: record.homePlacement,
    state: current?.state ?? "unavailable",
    versions: target.versions.map(versionViewOf),
    periods,
    revision: record.revision,
  };
}
/**
 * The worker's own targets, over the four canonical measures only. Answers `envelope`, or the read's own
 * refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read.
 * A caller that names no source reads the request's own session; one that names a source reads the
 * session it names, through the same authorisation.
 */
export async function readTargets(
  input: { readonly page?: number; readonly pageSize?: number } = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<TargetsView>>> {
  const loaded = await loadCoachingState("readTargets", source);
  if (!loaded.ok) return loaded.result;
  const scoped = workerScope(loaded.context);
  if (!scoped.ok) return scoped.result;
  const { session, state, at } = loaded.context;
  const activities = activityEventsOf(state.interactions);
  const valueStates: Record<string, RecordedValueState> = {};
  const targets: WorkerTargetView[] = [];
  for (const record of state.coachingTargets) {
    if (record.workerPrincipalId !== session.principalId) continue;
    const working = toWorkingTarget(record);
    if (!working.ok) {
      return unavailableRead(COACHING_SOURCE_REFERENCE, "A coaching target could not be read. Nothing is shown for it, and nothing was changed.");
    }
    targets.push(workerTargetViewOf(record, working.value, activities, at));
  }
  targets.sort((one, two) => {
    const order = TARGET_MEASURES.indexOf(one.measure) - TARGET_MEASURES.indexOf(two.measure);
    return order === 0 ? compareCodeUnits(one.targetId, two.targetId) : order;
  });
  const paged = pageOf(targets, input.page, input.pageSize);
  paged.items.forEach((target, index) => {
    target.periods.forEach((period, periodIndex) => {
      valueStates[`targets.${index}.periods.${periodIndex}.count`] = period.countState;
    });
  });
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data: {
        targets: paged.items,
        measures: [...TARGET_MEASURES],
        page: paged.page,
        planningZone: COACHING_PLANNING_ZONE,
        activityEventsRead: activities.length,
      },
      scope: scoped.scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: "coaching-targets" },
      revision: collectionRevision(targets.map((target) => ({ id: target.targetId, revision: target.revision }))),
      asOf: at.toString(),
      coverage: coverageOf(earliestVersionStart(targets), at),
      valueStates,
      actions: [
        actionOf("saveTarget", true),
        actionOf("editTarget", targets.length > 0, "There is no target to change yet."),
        actionOf("pauseTarget", targets.length > 0, "There is no target to pause yet."),
        actionOf("endTarget", targets.length > 0, "There is no target to end yet."),
      ],
    }),
  };
}
function earliestVersionStart(targets: readonly WorkerTargetView[]): string | null {
  const starts = targets.flatMap((target) => target.versions.map((version) => version.effectiveFrom));
  if (starts.length === 0) return null;
  return starts.toSorted(compareCodeUnits).at(0) ?? null;
}
// readCheckIns: the worker's private drafts and the revisions they shared
interface CheckInQuestionView {
  readonly wording: string;
  readonly order: number;
  readonly scalars: number;
}
interface CheckInAnswerView {
  readonly questionOrder: number | null;
  readonly text: string;
  readonly scalars: number;
}
interface CheckInViolationView {
  readonly path: string;
  readonly reason: string;
  readonly measured: number;
  readonly limit: number;
  readonly message: string;
}
interface CheckInMeasurementsView {
  readonly questionCount: number;
  readonly answerCount: number;
  readonly longestQuestionScalars: number;
  readonly longestAnswerScalars: number;
  readonly totalAnswerScalars: number;
  readonly requestBytes: number;
  readonly withinLimits: boolean;
  readonly violations: readonly CheckInViolationView[];
}
interface PrivateDraftView {
  readonly revisionId: string;
  readonly questionsCapturedAt: string;
  readonly savedAt: string;
  readonly questions: readonly CheckInQuestionView[];
  readonly answers: readonly CheckInAnswerView[];
  readonly measurements: CheckInMeasurementsView;
}
interface SharedRevisionView {
  readonly revisionId: string;
  readonly questionsCapturedAt: string;
  readonly sharedAt: string;
  readonly updatedAt: string;
  readonly withdrawnAt: string | null;
  readonly recipientPrincipalIds: readonly string[];
  readonly duration: {
    readonly kind: "ongoing" | "through-date";
    readonly cutoffInstant: string | null;
    readonly frozenZone: string;
  };
  readonly questions: readonly CheckInQuestionView[];
  readonly answers: readonly CheckInAnswerView[];
  readonly measurements: CheckInMeasurementsView;
}
interface WorkerCheckInView {
  readonly checkInId: string;
  readonly grantId: string;
  readonly state: CheckInState;
  readonly revision: string;
  readonly privateDraft: PrivateDraftView | null;
  readonly shared: SharedRevisionView | null;
  readonly draftAndSharedDiffer: boolean;
}
interface CheckInsView {
  readonly checkIns: readonly WorkerCheckInView[];
  readonly page: CoachingPageView;
  readonly limits: {
    readonly maxQuestions: number;
    readonly maxQuestionScalars: number;
    readonly maxAnswerScalars: number;
    readonly maxRequestBytes: number;
  };
}
function scalarCountOf(value: string): number {
  return [...value].length;
}
const UTF8_ENCODER = new TextEncoder();

function measurementsOf(payload: CheckInPayload): CheckInMeasurementsView {
  const questions = payload.questions.map((question) => scalarCountOf(question.wording));
  const answers = payload.answers.map((answer) => scalarCountOf(answer.text));
  const violations = validateCheckInRequest(payload);
  return {
    questionCount: payload.questions.length,
    answerCount: payload.answers.length,
    longestQuestionScalars: questions.reduce((longest, next) => Math.max(longest, next), 0),
    longestAnswerScalars: answers.reduce((longest, next) => Math.max(longest, next), 0),
    totalAnswerScalars: answers.reduce((total, next) => total + next, 0),
    requestBytes: UTF8_ENCODER.encode(JSON.stringify(payload)).length,
    withinLimits: violations.length === 0,
    violations: violations.map((violation) => ({
      path: violation.path,
      reason: violation.reason,
      measured: violation.measured,
      limit: violation.limit,
      message: violation.message,
    })),
  };
}
function questionViewsOf(questions: readonly CheckInQuestion[]): readonly CheckInQuestionView[] {
  return questions.map((question) => ({
    wording: question.wording,
    order: question.order,
    scalars: scalarCountOf(question.wording),
  }));
}
function answerViewsOf(answers: readonly CheckInAnswer[]): readonly CheckInAnswerView[] {
  return answers.map((answer) => ({
    questionOrder: answer.questionOrder,
    text: answer.text,
    scalars: scalarCountOf(answer.text),
  }));
}
function draftDiffersFromShared(draft: PrivateDraftView | null, shared: SharedRevisionView | null): boolean {
  if (draft === null || shared === null) return false;
  if (draft.revisionId === shared.revisionId) return false;
  const draftAnswers = draft.answers.map((answer) => `${answer.questionOrder}:${answer.text}`);
  const sharedAnswers = shared.answers.map((answer) => `${answer.questionOrder}:${answer.text}`);
  return draftAnswers.join("\u0000") !== sharedAnswers.join("\u0000");
}
/** The worker's private check-ins, their captured question sets and the revisions they shared. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCheckIns(input: { readonly page?: number; readonly pageSize?: number } = {}): Promise<ReadResult<ReadEnvelope<CheckInsView>>> {
  const loaded = await loadCoachingState("readCheckIns");
  if (!loaded.ok) return loaded.result;
  const scoped = workerScope(loaded.context);
  if (!scoped.ok) return scoped.result;
  const { session, state, at } = loaded.context;
  const valueStates: Record<string, RecordedValueState> = {};
  const checkIns: WorkerCheckInView[] = [];
  for (const record of state.coachingCheckIns) {
    if (record.workerPrincipalId !== session.principalId) continue;
    const privateDraft = privateDraftViewOf(record);
    const shared = sharedRevisionViewOf(record);
    const workingCheckIn = workingCheckInOf(record);
    if (!workingCheckIn.ok) {
      return unavailableRead(COACHING_SOURCE_REFERENCE, "A check-in could not be read. Nothing is shown for it, and nothing was changed.");
    }
    checkIns.push({
      checkInId: record.checkInId,
      grantId: record.grantId,
      state: checkInReadState(workingCheckIn.value, "available"),
      revision: record.revision,
      privateDraft,
      shared,
      draftAndSharedDiffer: draftDiffersFromShared(privateDraft, shared),
    });
  }
  checkIns.sort((one, two) => compareCodeUnits(one.checkInId, two.checkInId));
  const paged = pageOf(checkIns, input.page, input.pageSize);
  paged.items.forEach((checkIn, index) => {
    valueStates[`checkIns.${index}.answers`] = countState(checkIn.privateDraft === null ? (checkIn.shared?.answers.length ?? null) : checkIn.privateDraft.answers.length);
  });
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data: {
        checkIns: paged.items,
        page: paged.page,
        limits: {
          maxQuestions: CHECKIN_MAX_QUESTIONS,
          maxQuestionScalars: CHECKIN_MAX_QUESTION_SCALARS,
          maxAnswerScalars: CHECKIN_MAX_ANSWER_SCALARS,
          maxRequestBytes: CHECKIN_MAX_REQUEST_BYTES,
        },
      },
      scope: scoped.scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: "coaching-check-ins" },
      revision: collectionRevision(checkIns.map((checkIn) => ({ id: checkIn.checkInId, revision: checkIn.revision }))),
      asOf: at.toString(),
      coverage: coverageOf(null, at),
      valueStates,
      actions: [
        actionOf("saveCheckIn", true),
        actionOf(
          "shareCheckIn",
          checkIns.some((checkIn) => checkIn.privateDraft !== null && checkIn.shared === null),
          "No check-in holds a private draft that could be shared.",
        ),
        actionOf(
          "updateSharedCheckIn",
          checkIns.some((checkIn) => checkIn.shared !== null && checkIn.shared.withdrawnAt === null),
          "No check-in has a shared revision to update.",
        ),
        actionOf(
          "withdrawCheckIn",
          checkIns.some((checkIn) => checkIn.shared !== null && checkIn.shared.withdrawnAt === null),
          "No check-in has a shared revision to withdraw.",
        ),
      ],
    }),
  };
}
function privateDraftViewOf(record: CoachingCheckInRecord): PrivateDraftView | null {
  const draft = record.privateDraft;
  if (draft === null) return null;
  const questions: CheckInQuestion[] = draft.questions.map((question) => ({
    wording: question.wording,
    order: question.order,
  }));
  const answers: CheckInAnswer[] = draft.answers.map((answer) => ({
    questionOrder: answer.questionOrder,
    text: answer.text,
  }));
  return {
    revisionId: draft.revisionId,
    questionsCapturedAt: draft.questionsCapturedAt,
    savedAt: draft.savedAt,
    questions: questionViewsOf(questions),
    answers: answerViewsOf(answers),
    measurements: measurementsOf({ questions, answers }),
  };
}
function sharedRevisionViewOf(record: CoachingCheckInRecord): SharedRevisionView | null {
  const shared = record.shared;
  if (shared === null) return null;
  const questions: CheckInQuestion[] = shared.questions.map((question) => ({
    wording: question.wording,
    order: question.order,
  }));
  const answers: CheckInAnswer[] = shared.answers.map((answer) => ({
    questionOrder: answer.questionOrder,
    text: answer.text,
  }));
  return {
    revisionId: shared.revisionId,
    questionsCapturedAt: shared.questionsCapturedAt,
    sharedAt: shared.sharedAt,
    updatedAt: shared.updatedAt,
    withdrawnAt: shared.withdrawnAt,
    recipientPrincipalIds: [...shared.recipientPrincipalIds],
    duration: {
      kind: shared.duration.kind,
      cutoffInstant: shared.duration.cutoffInstant,
      frozenZone: shared.duration.frozenZone,
    },
    questions: questionViewsOf(questions),
    answers: answerViewsOf(answers),
    measurements: measurementsOf({ questions, answers }),
  };
}
function workingShareDurationOf(duration: CoachingDurationRecord): Result<CheckInShareDuration, string> {
  if (duration.kind === "ongoing") return ok({ kind: "ongoing" });
  const cutoff = duration.cutoffInstant === null ? null : instantOf(duration.cutoffInstant);
  if (cutoff === null) return err("a shared revision's cutoff could not be read");
  const throughOn = shareThroughDateOfCutoff({
    cutoffInstant: cutoff,
    frozenZone: duration.frozenZone,
  });
  if (throughOn === null) {
    return err("a shared revision's frozen zone could not be resolved");
  }
  return ok({ kind: "through-date", throughOn });
}
function workingCheckInOf(record: CoachingCheckInRecord): Result<CheckIn, string> {
  let privateDraft: CheckInPrivateDraftRevision | undefined;
  const draft = record.privateDraft;
  if (draft !== null) {
    const capturedAt = instantOf(draft.questionsCapturedAt);
    const savedAt = instantOf(draft.savedAt);
    if (capturedAt === null || savedAt === null) {
      return err("a private draft's instant could not be read");
    }
    privateDraft = {
      revisionId: draft.revisionId,
      captured: {
        questions: draft.questions.map((question) => ({
          wording: question.wording,
          order: question.order,
        })),
        capturedAt,
      },
      answers: draft.answers.map((answer) => ({
        questionOrder: answer.questionOrder,
        text: answer.text,
      })),
      savedAt,
    };
  }
  let shared: CheckInSharedRevision | undefined;
  const sharedRecord = record.shared;
  if (sharedRecord !== null) {
    const capturedAt = instantOf(sharedRecord.questionsCapturedAt);
    const sharedAt = instantOf(sharedRecord.sharedAt);
    const updatedAt = instantOf(sharedRecord.updatedAt);
    if (capturedAt === null || sharedAt === null || updatedAt === null) {
      return err("a shared revision's instant could not be read");
    }
    const duration = workingShareDurationOf(sharedRecord.duration);
    if (!duration.ok) return duration;
    const withdrawnAt = sharedRecord.withdrawnAt === null ? null : instantOf(sharedRecord.withdrawnAt);
    if (sharedRecord.withdrawnAt !== null && withdrawnAt === null) {
      return err("a withdrawal instant could not be read");
    }
    shared = {
      revisionId: sharedRecord.revisionId,
      captured: {
        questions: sharedRecord.questions.map((question) => ({
          wording: question.wording,
          order: question.order,
        })),
        capturedAt,
      },
      answers: sharedRecord.answers.map((answer) => ({
        questionOrder: answer.questionOrder,
        text: answer.text,
      })),
      recipients: [...sharedRecord.recipientPrincipalIds],
      duration: duration.value,
      sharedAt,
      updatedAt,
      ...(withdrawnAt === null ? {} : { withdrawnAt }),
    };
  }
  return ok({
    checkInId: record.checkInId,
    revision: revisionNumberOf(record.revision),
    ...(privateDraft === undefined ? {} : { privateDraft }),
    ...(shared === undefined ? {} : { shared }),
  });
}
// readTaskShares: the reviewed summaries a worker selected
interface WorkerTaskShareView {
  readonly shareId: string;
  readonly occurrenceId: string;
  readonly state: TaskShareSummaryState;
  readonly description: string | null;
  readonly reviewedCodePoints: number;
  readonly reviewedAt: string;
  readonly dueDate: TaskDueDateView | null;
  readonly status: TaskStatus | null;
  readonly revision: number;
  readonly withdrawnAt: string | null;
  readonly successorSelectionRequired: boolean;
}
interface TaskSharesView {
  readonly shares: readonly WorkerTaskShareView[];
  readonly page: CoachingPageView;
  readonly maxCodePoints: number;
  readonly sharesNothing: boolean;
}
/** The task summaries the worker selected for sharing, and how each one stands now. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readTaskShares(input: { readonly page?: number; readonly pageSize?: number } = {}): Promise<ReadResult<ReadEnvelope<TaskSharesView>>> {
  const loaded = await loadCoachingState("readTaskShares");
  if (!loaded.ok) return loaded.result;
  const scoped = workerScope(loaded.context);
  if (!scoped.ok) return scoped.result;
  const { session, state, at } = loaded.context;
  const valueStates: Record<string, RecordedValueState> = {};
  const shares: WorkerTaskShareView[] = [];
  for (const stored of state.coachingTaskShares ?? []) {
    const task = state.tasks.find((candidate) => candidate.taskId === stored.taskId && candidate.ownerPrincipalId === session.principalId);
    const working = workingShareOf(stored);
    const sourceAvailable = working !== null && task !== undefined;
    const currentFingerprint = task === undefined ? undefined : taskReviewedFingerprint(task);
    const shareState =
      working === null
        ? "unavailable"
        : taskShareReadState({
            share: working,
            currentFingerprint,
            sourceAvailable,
          });
    const summary =
      working === null || task === undefined || shareState === "removed" || shareState === "unavailable"
        ? null
        : safeTaskSummary({
            state: working.state,
            description: working.reviewedSummary.description,
            dueDate: dueDateOf(task),
            status: task.status,
            reviewedFingerprint: working.reviewedFingerprint,
            currentFingerprint,
            sourceAvailable,
          });
    const summaryResult = summary?.ok === true ? summary.value : null;
    const currentSummary = summaryResult !== null && summaryResult.state === "shared" ? summaryResult : null;
    shares.push({
      shareId: stored.shareId,
      occurrenceId: stored.occurrenceId,
      state: shareState,
      description: currentSummary === null ? null : currentSummary.description,
      reviewedCodePoints: stored.reviewedSummary.codePoints,
      reviewedAt: stored.reviewedSummary.reviewedAt,
      dueDate: task === undefined ? null : dueDateViewOf(dueDateOf(task)),
      status: taskStatusOf(task),
      revision: stored.revision,
      withdrawnAt: stored.withdrawnAt ?? null,
      successorSelectionRequired: task !== undefined && task.seriesId !== null,
    });
  }
  shares.sort((one, two) => compareCodeUnits(one.shareId, two.shareId));
  const paged = pageOf(shares, input.page, input.pageSize);
  paged.items.forEach((share, index) => {
    valueStates[`shares.${index}.reviewedCodePoints`] = countState(share.reviewedCodePoints);
  });
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data: {
        shares: paged.items,
        page: paged.page,
        maxCodePoints: TASK_SUMMARY_MAX_CODE_POINTS,
        sharesNothing: shares.every((share) => share.state !== "shared"),
      },
      scope: scoped.scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: "coaching-task-shares" },
      revision: collectionRevision(shares.map((share) => ({ id: share.shareId, revision: String(share.revision) }))),
      asOf: at.toString(),
      coverage: coverageOf(null, at),
      valueStates,
      actions: [
        actionOf("shareTaskSummary", true),
        actionOf(
          "stopTaskShare",
          shares.some((share) => share.state === "shared"),
          "Nothing is currently shared, so there is nothing to stop sharing.",
        ),
        actionOf(
          "selectSuccessorForSharing",
          shares.some((share) => share.successorSelectionRequired),
          "No shared occurrence belongs to a repeating task.",
        ),
      ],
    }),
  };
}
// readCoachPortfolio: authorise before enumerating
interface CoachPortfolioSubjectView {
  readonly grantId: string;
  readonly workerPrincipalId: string;
  readonly ministryId: string;
  readonly duration: CoachingDurationView;
  readonly admittedModules: readonly CoachingModuleAdmissionView[];
  readonly revision: string;
}
interface CoachPortfolioView {
  readonly subjects: readonly CoachPortfolioSubjectView[];
  readonly holdsNoSubjects: boolean;
}
function coachPortfolioScope(session: ResolvedSession, ministryIds: readonly string[]): Scope {
  const first = ministryIds.at(0);
  if (first !== undefined) return coachScope(session, first);
  return scopeSchema.parse({
    organizationId: "grant-authority:portfolio",
    ministryId: "grant-authority:portfolio",
    supportSubjectId: "grant-authority:portfolio",
    principalId: session.principalId,
  });
}
/** The subjects this coach holds an open, in-cutoff grant for. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCoachPortfolio(source?: SessionSource): Promise<ReadResult<ReadEnvelope<CoachPortfolioView>>> {
  // The source is optional so the browser transport keeps resolving the request's own session, while a
  // caller that names one — an integration test, a script — reads the coach's listing through the same
  // authorisation, exactly as `readCoachSubject` already allowed.
  const loaded = await loadCoachingState("readCoachPortfolio", source);
  if (!loaded.ok) return loaded.result;
  const { session, state, at } = loaded.context;
  const subjects: CoachPortfolioSubjectView[] = [];
  const valueStates: Record<string, RecordedValueState> = {};
  let invitationOutstanding = false;
  for (const record of state.coachingGrants) {
    if (record.coachPrincipalId !== session.principalId) continue;
    const expiresAt = instantOf(record.invitation.expiresAt);
    if (record.state === "invited" && record.invitation.supersededBy === null && expiresAt !== null && Temporal.Instant.compare(at, expiresAt) < 0) {
      invitationOutstanding = true;
    }
    if (!canView(session, { kind: "coaching-grant", grant: record, now: at }).allowed) continue;
    const working = toWorkingGrant(record);
    if (!working.ok) continue;
    for (const ministryId of working.value.ministryIds) {
      const authority = coachScope(session, ministryId);
      const episode = activeGrant(working.value, accessContextOf("coach", session.principalId, authority.organizationId, ministryId, "available"), at);
      if (!episode.ok) continue;
      const index = subjects.length;
      const admittedModules = episode.value.admittedModules.map((module) => ({
        module,
        until: episode.value.boundInstant?.toString() ?? null,
        remainingMilliseconds: episode.value.remainingMilliseconds,
      }));
      valueStates[`subjects.${index}.remainingMilliseconds`] = countState(episode.value.remainingMilliseconds);
      subjects.push({
        grantId: record.grantId,
        workerPrincipalId: record.workerPrincipalId,
        ministryId,
        duration: durationViewOf(episode.value),
        admittedModules,
        revision: record.revision,
      });
      break;
    }
  }
  subjects.sort((one, two) => {
    const byMinistry = compareCodeUnits(one.ministryId, two.ministryId);
    return byMinistry === 0 ? compareCodeUnits(one.grantId, two.grantId) : byMinistry;
  });
  const scope = coachPortfolioScope(
    session,
    subjects.map((subject) => subject.ministryId),
  );
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data: { subjects, holdsNoSubjects: subjects.length === 0 },
      scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: COACHING_SOURCE_REFERENCE },
      revision: collectionRevision(subjects.map((subject) => ({ id: subject.grantId, revision: subject.revision }))),
      asOf: at.toString(),
      coverage: coverageOf(null, at),
      valueStates,
      actions: [
        actionOf("acceptInvitation", invitationOutstanding, "No invitation addressed to you is awaiting acceptance."),
        actionOf("leaveCoaching", subjects.length > 0, "No coaching relationship of yours is open to leave."),
      ],
    }),
  };
}
// readCoachSubject: the module-scoped read
interface CoachTargetProgressView {
  readonly revisionId: string;
  readonly measure: TargetMeasure;
  readonly quantity: number;
  readonly start: string;
  readonly endInclusive: string;
  readonly count: number | null;
  readonly countState: RecordedValueState;
  readonly state: TargetState;
}
interface CoachSharedCheckInView {
  readonly revisionId: string;
  readonly questionsCapturedAt: string;
  readonly sharedAt: string;
  readonly updatedAt: string;
  readonly recipientPrincipalIds: readonly string[];
  readonly duration: {
    readonly kind: "ongoing" | "through-date";
    readonly cutoffInstant: string | null;
    readonly frozenZone: string;
  };
  readonly questions: readonly CheckInQuestionView[];
  readonly answers: readonly CheckInAnswerView[];
}
interface CoachTaskSummaryView {
  readonly shareId: string;
  readonly state: TaskShareSummaryState;
  readonly description: string | null;
  readonly dueDate: TaskDueDateView | null;
  readonly status: TaskStatus | null;
}
interface CoachGoalView {
  readonly amount: Money;
  readonly exponent: number | null;
  readonly measure: string;
  readonly effectiveFrom: string;
  readonly valueState: RecordedValueState;
}
interface CoachReceivedFigureView {
  readonly currency: string;
  readonly exponent: number | null;
  readonly minorUnits: number | null;
  readonly valueState: ValueState;
  readonly from: string;
  readonly to: string;
  readonly periodState: string;
}
interface CoachModuleViewBase {
  readonly module: ModuleKey;
  readonly state: ModuleReadState | null;
  readonly unavailability: string | null;
}
interface CoachTargetsModuleView extends CoachModuleViewBase {
  readonly module: "targets";
  readonly progress: readonly CoachTargetProgressView[];
}
interface CoachCheckInsModuleView extends CoachModuleViewBase {
  readonly module: "check-ins";
  readonly sharedCheckIns: readonly CoachSharedCheckInView[];
}
interface CoachTaskSummariesModuleView extends CoachModuleViewBase {
  readonly module: "task-summaries";
  readonly summaries: readonly CoachTaskSummaryView[];
}
interface CoachGoalModuleView extends CoachModuleViewBase {
  readonly module: "support-goal";
  readonly goal: CoachGoalView | null;
}
interface CoachResultsModuleView extends CoachModuleViewBase {
  readonly module: "support-results";
  readonly basis: string;
  readonly basisDescription: string;
  readonly range: { readonly from: string; readonly to: string; readonly currency: string } | null;
  readonly received: readonly CoachReceivedFigureView[];
  readonly figureProblem: string | null;
}
type CoachModuleView = CoachTargetsModuleView | CoachCheckInsModuleView | CoachTaskSummariesModuleView | CoachGoalModuleView | CoachResultsModuleView;

interface CoachSubjectView {
  readonly grantId: string;
  readonly workerPrincipalId: string;
  readonly ministryId: string;
  readonly duration: CoachingDurationView;
  readonly financialRange: {
    readonly from: string;
    readonly to: string;
    readonly currency: string;
  } | null;
  readonly modules: readonly CoachModuleView[];
  readonly sharesNothing: boolean;
  readonly revision: string;
}
function isFinancialModule(module: ModuleKey): boolean {
  return module === "support-goal" || module === "support-results";
}
// The scenario registry is the single owner of the scenario vocabulary, and the flag its row sets is what
// this read consults: a session the development panel has switched into the "coaching module unavailable"
// world reports the source behind a financial module as down, so that module answers as unavailable while
// the modules that do not read the source stay usable. The fact travels per module rather than per read,
// which is what keeps one outage from blanking a relationship. A scenario id this build does not define
// cannot establish that the source is down, so it states nothing rather than inventing an outage — and the
// registry is never asked about an id it does not define, because it refuses one rather than answering.
function moduleSourceReportedDown(session: ResolvedSession, module: ModuleKey): boolean {
  if (!isFinancialModule(module)) return false;
  return isScenarioId(session.scenarioId) && scenarioFlagsFor(session.scenarioId).coachingModule === "unavailable";
}
function receivedFiguresOf(
  projection: SupportProjection,
  range: { readonly from: string; readonly to: string; readonly currency: string },
  authority: Scope,
): Result<readonly CoachReceivedFigureView[], string> {
  const from = civilDateOf(range.from);
  const to = civilDateOf(range.to);
  if (from === null || to === null) return err("the reviewed range could not be read");
  const built = buildReportQuery({
    reportId: "received-period-and-year-to-date",
    scope: {
      organizationId: authority.organizationId,
      ministryId: authority.ministryId,
      supportSubjectId: authority.supportSubjectId,
      principalId: authority.principalId,
    },
    period: { kind: "explicit", from, to },
    currency: { kind: "one", currency: range.currency },
  });
  if (!built.ok) return err("the reviewed range is not a query the report engine accepts");
  let result: ReportResult;
  try {
    result = runReport(built.query, projection);
  } catch {
    return err("the support source could not be reported");
  }
  const summary = result.summary.find((entry) => entry.currency === range.currency);
  if (summary === undefined) return ok([]);
  return ok([
    {
      currency: summary.currency,
      exponent: summary.exponent ?? null,
      minorUnits: summary.received.minorUnits,
      valueState: summary.received.valueState,
      from: serialiseCivilDate(result.snapshot.period.from),
      to: serialiseCivilDate(result.snapshot.period.to),
      periodState: result.snapshot.period.state,
    },
  ]);
}
function observationOf(module: ModuleKey, state: CoachingState, support: SupportLoad | null): ModuleObservation {
  switch (module) {
    case "targets": {
      const presence: ModuleContentPresence = state.coachingTargets.length === 0 ? "none" : "complete";
      return { presence, withheldUntilReReviewed: false };
    }
    case "check-ins": {
      const shared = state.coachingCheckIns.filter((checkIn) => checkIn.shared !== null && checkIn.shared.withdrawnAt === null);
      return {
        presence: shared.length === 0 ? "none" : "complete",
        withheldUntilReReviewed: false,
      };
    }
    case "task-summaries": {
      const shares = (state.coachingTaskShares ?? []).filter((share) => share.state === "shared");
      const states = shares.map((share) => taskShareSummaryStateOf(share, state.tasks));
      return taskSummaryObservation(states);
    }
    case "support-goal": {
      if (support === null || !support.ok) {
        return { presence: "none", withheldUntilReReviewed: false };
      }
      return {
        presence: storedGoalOf(state) === null ? "none" : "complete",
        withheldUntilReReviewed: false,
      };
    }
    case "support-results": {
      if (support === null || !support.ok) {
        return { presence: "none", withheldUntilReReviewed: false };
      }
      return {
        presence: support.projection.gifts.length === 0 ? "none" : "complete",
        withheldUntilReReviewed: false,
      };
    }
    default:
      return { presence: "none", withheldUntilReReviewed: false };
  }
}
function taskShareSummaryStateOf(share: StoredCoachingTaskShare, tasks: readonly TaskRecord[]): TaskShareSummaryState {
  const working = workingShareOf(share);
  const task = tasks.find((candidate) => candidate.taskId === share.taskId);
  if (working === null) return "unavailable";
  return taskShareReadState({
    share: working,
    currentFingerprint: task === undefined ? undefined : taskReviewedFingerprint(task),
    sourceAvailable: task !== undefined,
  });
}
function coachTargetProgressOf(
  state: CoachingState,
  activities: readonly ActivityEvent[],
  at: Temporal.Instant,
  valueStates: Record<string, RecordedValueState>,
  moduleIndex: number,
  workerPrincipalId: string,
): readonly CoachTargetProgressView[] {
  const progress: CoachTargetProgressView[] = [];
  for (const record of state.coachingTargets) {
    if (record.workerPrincipalId !== workerPrincipalId) continue;
    const working = toWorkingTarget(record);
    if (!working.ok) continue;
    for (const entry of measuredPeriodsOf(working.value, activities, at)) {
      if (entry.version === null) continue;
      const view = coachTargetProgress({
        target: working.value,
        version: entry.version,
        period: entry.period,
        count: entry.count,
      });
      valueStates[`modules.${moduleIndex}.progress.${progress.length}.count`] = countState(view.count);
      progress.push({
        revisionId: view.revisionId,
        measure: view.measure,
        quantity: view.quantity,
        start: serialiseCivilDate(view.period.start),
        endInclusive: serialiseCivilDate(view.period.endInclusive),
        count: view.count,
        countState: countState(view.count),
        state: view.state,
      });
    }
  }
  return progress;
}
function coachSharedCheckInsOf(state: CoachingState, grantId: string): readonly CoachSharedCheckInView[] {
  const shared: CoachSharedCheckInView[] = [];
  for (const record of state.coachingCheckIns) {
    if (record.grantId !== grantId) continue;
    const revision = record.shared;
    if (revision === null || revision.withdrawnAt !== null) continue;
    const questions: CheckInQuestion[] = revision.questions.map((question) => ({
      wording: question.wording,
      order: question.order,
    }));
    const answers: CheckInAnswer[] = revision.answers.map((answer) => ({
      questionOrder: answer.questionOrder,
      text: answer.text,
    }));
    shared.push({
      revisionId: revision.revisionId,
      questionsCapturedAt: revision.questionsCapturedAt,
      sharedAt: revision.sharedAt,
      updatedAt: revision.updatedAt,
      recipientPrincipalIds: [...revision.recipientPrincipalIds],
      duration: {
        kind: revision.duration.kind,
        cutoffInstant: revision.duration.cutoffInstant,
        frozenZone: revision.duration.frozenZone,
      },
      questions: questionViewsOf(questions),
      answers: answerViewsOf(answers),
    });
  }
  return shared;
}
function coachTaskSummariesOf(state: CoachingState, workerPrincipalId: string): readonly CoachTaskSummaryView[] {
  const summaries: CoachTaskSummaryView[] = [];
  for (const stored of state.coachingTaskShares ?? []) {
    const task = state.tasks.find((candidate) => candidate.taskId === stored.taskId && candidate.ownerPrincipalId === workerPrincipalId);
    if (task === undefined) continue;
    const working = workingShareOf(stored);
    const readState =
      working === null
        ? "unavailable"
        : taskShareReadState({
            share: working,
            currentFingerprint: task === undefined ? undefined : taskReviewedFingerprint(task),
            sourceAvailable: task !== undefined,
          });
    if (readState === "removed") continue;
    const summary =
      working === null || task === undefined
        ? null
        : safeTaskSummary({
            state: working.state,
            description: working.reviewedSummary.description,
            dueDate: dueDateOf(task),
            status: task.status,
            reviewedFingerprint: working.reviewedFingerprint,
            currentFingerprint: taskReviewedFingerprint(task),
            sourceAvailable: true,
          });
    const current = summary !== null && summary.ok && summary.value.state === "shared" ? summary.value : null;
    summaries.push({
      shareId: stored.shareId,
      state: readState,
      description: current === null ? null : current.description,
      dueDate: task === undefined ? null : dueDateViewOf(dueDateOf(task)),
      status: taskStatusOf(task),
    });
  }
  return summaries;
}
function storedGoalOf(state: CoachingState): SupportProjectionRecord["goal"] {
  return state.supportProjection === null ? null : state.supportProjection.goal;
}
function coachGoalOf(state: CoachingState): CoachGoalView | null {
  const goal = storedGoalOf(state);
  if (goal === null) return null;
  const exponent = exponentOf(goal.amount.currency);
  return {
    amount: goal.amount,
    exponent: exponent ?? null,
    measure: goal.measure,
    effectiveFrom: goal.effectiveFrom,
    valueState: exponent === undefined ? "unknown" : goal.amount.minorUnits === 0 ? "zero" : "value",
  };
}
function coachModulesOf(
  context: CoachingReadContext,
  working: CoachingGrant,
  record: CoachingGrantRecord,
  scope: Scope,
  modules: readonly ModuleKey[],
  support: SupportLoad,
  valueStates: Record<string, RecordedValueState>,
): readonly CoachModuleView[] {
  const { session, state, at } = context;
  const activities = activityEventsOf(state.interactions);
  const views: CoachModuleView[] = [];
  for (const key of modules) {
    // A financial module's source is down when this session's own support load failed, or when the
    // scenario the session runs in reports that source unavailable: either way the module is shown as
    // unavailable, with the reason it carries — the support failure stated as itself, the scenario by its
    // own words — and the independent modules stay usable beside it.
    const supportDown = isFinancialModule(key) && !support.ok;
    const sourceDown = supportDown || moduleSourceReportedDown(session, key);
    const unavailability = sourceDown ? (support.ok ? COACHING_MODULE_SOURCE_DOWN_REASON : support.reason) : null;
    const availability: SubjectAvailability = sourceDown ? "unavailable" : "available";
    const decision = moduleReadState(working, key, accessContextOf("coach", session.principalId, scope.organizationId, scope.ministryId, availability), at, observationOf(key, state, support));
    if (!decision.ok) continue;
    const base = { state: decision.value, unavailability };
    const index = views.length;
    switch (key) {
      case "targets":
        views.push({
          module: key,
          ...base,
          progress: coachTargetProgressOf(state, activities, at, valueStates, index, working.workerPrincipalId),
        });
        break;
      case "check-ins":
        views.push({
          module: key,
          ...base,
          sharedCheckIns: coachSharedCheckInsOf(state, working.grantId),
        });
        break;
      case "task-summaries":
        views.push({
          module: key,
          ...base,
          summaries: coachTaskSummariesOf(state, working.workerPrincipalId),
        });
        break;
      case "support-goal":
        // A goal is a figure like any other: a module whose source is down states no goal at all, rather
        // than the last goal the store happens to hold.
        views.push({ module: key, ...base, goal: sourceDown ? null : coachGoalOf(state) });
        break;
      case "support-results": {
        const range = reviewedRangeOf(record);
        // Nothing is projected from a source that is down. The reviewed range stays the fact the grant
        // states, the figures are absent rather than zero, and the reason the module states is the one its
        // figure problem carries, so no surface can show a figure or a zero beside a module it calls
        // unavailable.
        const figures = support.ok && !sourceDown && range !== null ? receivedFiguresOf(support.projection, range, scope) : null;
        const figureProblem = sourceDown ? unavailability : figures !== null && !figures.ok ? figures.error : range === null ? "no reviewed range is recorded" : null;
        views.push({
          module: key,
          ...base,
          basis: SUPPORT_BASIS,
          basisDescription: BASIS_DESCRIPTION,
          range,
          received: figures !== null && figures.ok ? figures.value : [],
          figureProblem,
        });
        break;
      }
      default:
        break;
    }
  }
  return views;
}
function reviewedRangeOf(record: CoachingGrantRecord): {
  readonly from: string;
  readonly to: string;
  readonly currency: string;
} | null {
  const range = record.financialRange;
  return range === null ? null : { from: range.from, to: range.to, currency: range.currency };
}
/** One subject's admitted modules, as a coach reads them. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCoachSubject(
  input: {
    readonly grantId: string;
  },
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<CoachSubjectView>>> {
  const loaded = await loadCoachingState("readCoachSubject", source);
  if (!loaded.ok) return loaded.result;
  const context = loaded.context;
  const { session, state, at } = context;
  if (!isNonEmptyString(input.grantId)) return deniedRead("no-permission");
  const record = state.coachingGrants.find((grant) => grant.grantId === input.grantId && grant.coachPrincipalId === session.principalId);
  if (record === undefined) return deniedRead("no-permission");
  if (!canView(session, { kind: "coaching-grant", grant: record, now: at }).allowed) {
    return deniedRead("no-permission");
  }
  const working = toWorkingGrant(record);
  if (!working.ok) {
    return unavailableRead(COACHING_SOURCE_REFERENCE, "This coaching relationship could not be read. Nothing is shown, and nothing was changed.");
  }
  let episode: {
    readonly scope: Scope;
    readonly admitted: readonly ModuleKey[];
    readonly duration: CoachingDurationView;
  } | null = null;
  for (const ministryId of working.value.ministryIds) {
    const authority = coachScope(session, ministryId);
    const admission = activeGrant(working.value, accessContextOf("coach", session.principalId, authority.organizationId, ministryId, "available"), at);
    if (!admission.ok) continue;
    episode = {
      scope: authority,
      admitted: admission.value.admittedModules,
      duration: durationViewOf(admission.value),
    };
    break;
  }
  if (episode === null) return deniedRead("no-permission");
  const openEpisode = episode;
  // The support source is read only when a financial module is actually shared: a relationship that shares
  // targets and check-ins does not consult the finance source at all, and no outage is reported for a
  // module nobody asked for.
  const wantsSupport = openEpisode.admitted.some(isFinancialModule);
  const support: SupportLoad = wantsSupport ? supportProjectionOf(state) : { ok: false, reason: "no financial module is shared with this coach" };
  const valueStates: Record<string, RecordedValueState> = {};
  const modules = coachModulesOf(context, working.value, record, openEpisode.scope, openEpisode.admitted, support, valueStates);
  const range = reviewedRangeOf(record);
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data: {
        grantId: record.grantId,
        workerPrincipalId: record.workerPrincipalId,
        ministryId: openEpisode.scope.ministryId,
        duration: openEpisode.duration,
        financialRange: range,
        modules,
        sharesNothing: openEpisode.admitted.length === 0,
        revision: record.revision,
      },
      scope: openEpisode.scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: record.grantId },
      revision: record.revision,
      asOf: at.toString(),
      coverage: coverageOf(range?.from ?? null, at),
      valueStates,
      // Exactly the two writes the coach identity holds, and nothing else — no edit, comment, assign,
      // remind, complete, reopen, impersonate or export action appears here, not even as disabled.
      actions: [
        actionOf("acceptInvitation", record.state === "invited", "This invitation was already accepted, so there is nothing to accept."),
        actionOf("leaveCoaching", record.state === "active" || record.state === "accepted", "This relationship is not open, so there is nothing to leave."),
      ],
    }),
  };
}
