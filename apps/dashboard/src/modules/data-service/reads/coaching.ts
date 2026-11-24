import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isNonEmptyString } from "@/lib/guards";
import { logger } from "@/lib/logger";
import { compareCodeUnits } from "@/lib/ordering";
import { err, ok, type Result } from "@/lib/result";
import { failureFor, failurePlanOfDocument } from "@/modules/dev-runtime/failures";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import { CHECKIN_MAX_ANSWER_SCALARS, CHECKIN_MAX_QUESTIONS, CHECKIN_MAX_QUESTION_SCALARS, CHECKIN_MAX_REQUEST_BYTES, checkInReadState, validateCheckInRequest } from "@/modules/coaching/checkin";
import type { CheckIn, CheckInAnswer, CheckInPayload, CheckInPrivateDraftRevision, CheckInQuestion, CheckInShareDuration, CheckInSharedRevision, CheckInState } from "@/modules/coaching/checkin";
import { MODULE_KEYS, activeGrant, moduleReadState } from "@/modules/coaching/grant";
import type { CoachingAccessContext, CoachingGrant, CoachingRefusal, GrantDuration, GrantLifecycleState, ModuleContentPresence, ModuleKey, ModuleObservation, ModuleReadState, PermissionHold, SubjectAvailability } from "@/modules/coaching/grant";
import { TARGET_MEASURES, coachTargetProgress, measureFor, resolveCurrentPeriod, resolvePeriodContaining, resolveTargetState, resolveTargetVersion, workerTargetProgress } from "@/modules/coaching/target";
import type { ActivityEvent, ActivityEventKind, PeriodAnchor, PeriodBoundaryResolution, ResolvedPeriod, TargetHomePlacement, TargetMeasure, TargetPeriod, TargetRecord, TargetRefusalReason, TargetState, TargetVersion } from "@/modules/coaching/target";
import { TASK_SUMMARY_MAX_CODE_POINTS, safeTaskSummary, taskShareReadState, type TaskShare, type TaskShareSummaryState, type TaskStatus, type TaskSummaryDueDate } from "@/modules/coaching/taskshare";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { exponentOf } from "@/modules/money/currency";
import { BASIS_DESCRIPTION, SUPPORT_BASIS, type SupportProjection } from "@/modules/support/basis";
import { buildReportQuery, runReport, type ReportResult } from "@/modules/support/report";
import type { SessionDocuments } from "@/modules/store/paths";
import { instantAt } from "@/modules/time/clock";
import { civilDateAt, serialiseCivilDate, todayInZone, type CivilDate } from "@/modules/time/civil";
import { shareThroughDateOfCutoff } from "@/modules/time/window";
import { readSession } from "../../store/repository";
import { assertScope, canView, coachingRecordsSessionIdOf, readResultOfRefusal, recordRefusalOutage, resolveSession, type ResolvedSession, type SessionSource } from "../authorize";
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
  sessionContextRecordSchema,
  supportProjectionRecordSchema,
  taskRecordSchema,
  taskReviewedFingerprint,
  type AdmittedMembership,
  type CoachingCheckInRecord,
  type CoachingDurationRecord,
  type CoachingGrantRecord,
  type CoachingTargetRecord,
  type CoachingTaskShareRecord,
  type Coverage,
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
import { LOCAL_STORE_SYSTEM, type ReadResult } from "../outcome";
import { answerOf, civilDateOf as frameCivilDateOf, commitmentRowsOf, deniedRead, giftRowsOf, instantOf as storedInstant, readAction, storeUnavailableRead, recordedStateOf } from "./frame";
const COACHING_PAGE_SIZE_DEFAULT = 25;
const COACHING_PAGE_SIZE_CAP = 100;
const COACHING_PLANNING_ZONE = "UTC";
const COACHING_SOURCE_REFERENCE = "coaching";
const SUPPORT_PROJECTION_REFERENCE = "support-projection";
const COACHING_MODULE_SOURCE_DOWN_REASON = "The source behind this module is reported unavailable in this scenario, so nothing is shown for it rather than a zero or an empty reading.";
const UNREADABLE_DURATION_SENTENCE = "The duration this invitation was made for cannot be read from its record, so none is stated here.";
type StoredCoachingTaskShare = CoachingTaskShareRecord;
const coachingStateSchema = z.object({
  context: sessionContextRecordSchema,
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
type CoachingPageView = { readonly index: number; readonly size: number; readonly total: number; readonly totalPages: number; readonly cappedAt: number };
const relationshipMinistryOf = (record: CoachingGrantRecord, scope: Scope): string | null => (record.ministryIds.includes(scope.ministryId) ? scope.ministryId : (record.ministryIds.at(0) ?? null));
type CoachingModuleFlagView = { readonly module: ModuleKey; readonly selected: boolean };
type CoachingDurationView = { readonly kind: "ongoing" | "through-date" | "none"; readonly shareThroughDate: string | null; readonly frozenZone: string | null } & { readonly cutoffInstant: string | null; readonly boundedBy: "share-through" | "source" | null; readonly boundInstant: string | null } & {
  readonly openAtRead: boolean;
  readonly remainingMilliseconds: number | null;
};
type CoachingModuleAdmissionView = { readonly module: ModuleKey; readonly until: string | null; readonly remainingMilliseconds: number | null };
type CoachingReadContext = { readonly session: ResolvedSession; readonly state: CoachingState; readonly at: Temporal.Instant };
type CoachingLoad = { readonly ok: true; readonly context: CoachingReadContext } | { readonly ok: false; readonly result: ReadResult<never> };
type ScopeLoad = { readonly ok: true; readonly scope: Scope } | { readonly ok: false; readonly result: ReadResult<never> };
/** The document set one coaching seat addresses for its records: its own, or the world it was seated in, which is the worker's own record and never a copy of it. */
async function coachingRecordsOf(session: ResolvedSession, seat: SessionDocuments): Promise<SessionDocuments | undefined> {
  const recordsSessionId = coachingRecordsSessionIdOf(session);
  if (recordsSessionId === session.sessionId) return seat;
  try {
    return await readSession(recordsSessionId);
  } catch {
    return undefined;
  }
}
async function loadCoachingState(job: string, source?: SessionSource): Promise<CoachingLoad> {
  let resolution: Awaited<ReturnType<typeof resolveSession>>;
  try {
    resolution = await resolveSession(source);
  } catch {
    return { ok: false, result: deniedRead("session-unavailable") };
  }
  if (!resolution.ok) {
    recordRefusalOutage(job, resolution.refusal);
    return { ok: false, result: readResultOfRefusal(resolution.refusal) };
  }
  const { session } = resolution;
  let seat: Awaited<ReturnType<typeof readSession>>;
  try {
    seat = await readSession(session.sessionId);
  } catch {
    return { ok: false, result: storeUnavailableRead("coaching", COACHING_SOURCE_REFERENCE, "The coaching records for this session could not be read. Reload the session; nothing was changed.") };
  }
  if (seat === undefined) return { ok: false, result: storeUnavailableRead("coaching", COACHING_SOURCE_REFERENCE, "This session holds no records yet. Reset the development data and try again.") };
  // The seat's own document proves the session exists and carries the failure plan the development control armed on it, so the denial is judged there before any record is enumerated.
  if (failureFor(failurePlanOfDocument(seat.meta), "read", job) === "denied") return { ok: false, result: deniedRead("no-permission") };
  const records = await coachingRecordsOf(session, seat);
  if (records === undefined) return { ok: false, result: storeUnavailableRead("coaching", COACHING_SOURCE_REFERENCE, "The coaching records this seat shares could not be read. Reload the session; nothing was changed.") };
  const parsed = coachingStateSchema.safeParse(records.state);
  return !parsed.success ? { ok: false, result: storeUnavailableRead("coaching", COACHING_SOURCE_REFERENCE, "The coaching records for this session did not decode. Nothing is shown, and nothing was changed.") } : { ok: true, context: { session, state: parsed.data, at: instantAt(session.clockOffsetMs) } };
}
function workerScope(context: CoachingReadContext): ScopeLoad {
  const { session } = context;
  const selected = session.selected;
  if (selected === null) return { ok: false, result: deniedRead("no-permission") };
  const decision = assertScope(session, selected);
  return !decision.ok ? { ok: false, result: { kind: "denied", denied: decision.denial } } : { ok: true, scope: selected };
}
function coachScope(session: ResolvedSession, ministryId: string): Scope {
  const admission = session.admittedMemberships.find((membership) => membership.ministryId === ministryId);
  if (admission !== undefined) return scopeSchema.parse({ organizationId: admission.organizationId, ministryId: admission.ministryId, supportSubjectId: admission.supportSubjectId, principalId: session.principalId });
  return scopeSchema.parse({ organizationId: `grant-authority:${ministryId}`, ministryId, supportSubjectId: `grant-authority:${ministryId}`, principalId: session.principalId });
}
const instantOf = (value: string): Temporal.Instant | null => storedInstant(value) ?? null;
const civilDateOf = (value: string): CivilDate | null => frameCivilDateOf(value) ?? null;
function asOfDate(at: Temporal.Instant): string | null {
  const today = todayInZone(COACHING_PLANNING_ZONE, at);
  return today.status === "resolved" ? serialiseCivilDate(today.date) : null;
}
const coverageOf = (from: string | null, at: Temporal.Instant): Coverage => ({ from, to: asOfDate(at), state: "complete" });
const collectionRevision = (members: readonly { readonly id: string; readonly revision: string }[]): string => (members.length === 0 ? "empty" : members.map((member) => `${member.id}@${member.revision}`).join("|"));
type OpenedWorkerRead = { readonly ok: true; readonly session: CoachingReadContext["session"]; readonly state: CoachingState; readonly at: CoachingReadContext["at"]; readonly scope: Scope } | { readonly ok: false; readonly result: ReadResult<never> };
/** Opens the coaching state and the worker scope one read answers from, or answers the read's own refusal. */ async function openWorkerRead(job: string, source?: SessionSource): Promise<OpenedWorkerRead> {
  const loaded = await loadCoachingState(job, source);
  if (!loaded.ok) return loaded;
  const scoped = workerScope(loaded.context);
  if (!scoped.ok) return scoped;
  const { session, state, at } = loaded.context;
  return { ok: true, session, state, at, scope: scoped.scope };
}
type EnvelopeFields<T> = { readonly scope: Scope; readonly source: Parameters<typeof buildEnvelope>[0]["source"]; readonly revision: string; readonly data: T; readonly valueStates: Readonly<Record<string, RecordedValueState>>; readonly actions: readonly ReadAction[] };
/** The result a read answers with, assembled through this file's own envelope builder. */ function respond<T>(at: Temporal.Instant, coverageFrom: string | null, fields: EnvelopeFields<T>): ReadResult<ReadEnvelope<T>> {
  return answerOf(fields.scope, at.toString(), { data: fields.data, source: fields.source, revision: fields.revision, coverage: coverageOf(coverageFrom, at), valueStates: fields.valueStates, actions: fields.actions });
}
function pageOf<T>(items: readonly T[], page: number | undefined, pageSize: number | undefined): { readonly items: readonly T[]; readonly page: CoachingPageView } {
  const size = clampPageSize(pageSize);
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / size);
  const index = clampPageIndex(page, totalPages);
  const start = index * size;
  return { items: items.slice(start, start + size), page: { index, size, total, totalPages, cappedAt: COACHING_PAGE_SIZE_CAP } };
}
const clampPageSize = (requested: number | undefined): number => (requested === undefined || !Number.isSafeInteger(requested) || requested <= 0 ? COACHING_PAGE_SIZE_DEFAULT : Math.min(requested, COACHING_PAGE_SIZE_CAP));
const clampPageIndex = (requested: number | undefined, totalPages: number): number => (totalPages === 0 ? 0 : requested === undefined || !Number.isSafeInteger(requested) || requested < 0 ? 0 : Math.min(requested, totalPages - 1));
const countState = (count: number | null): RecordedValueState => (count === null ? "unavailable" : count === 0 ? "zero" : "value");
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
      shareThroughDate: shareThroughDateOfCutoff({ cutoffInstant: cutoff, frozenZone: duration.frozenZone }),
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
  return { kind: "ongoing", shareThroughDate: null, frozenZone: duration.frozenZone, cutoffInstant: null, sourceLimitInstant: null, limitedBy: null, nominalWording: "Open-ended, with no Share-through date of its own", resolution: null, nominalDisagreesWithResolved: false, settledAt: null };
}
function workingFinancialRangeOf(record: CoachingGrantRecord): Result<CoachingGrant["financialRange"], string> {
  const range = record.financialRange;
  if (range === null) return ok(null);
  const from = civilDateOf(range.from);
  const to = civilDateOf(range.to);
  return from === null || to === null ? err("a reviewed financial range could not be read") : ok({ from, to, measures: [] });
}
function toWorkingGrant(record: CoachingGrantRecord): Result<CoachingGrant, string> {
  const issuedAt = instantOf(record.invitation.issuedAt);
  const expiresAt = instantOf(record.invitation.expiresAt);
  if (issuedAt === null || expiresAt === null) return err("an invitation instant could not be read");
  const financialRange = workingFinancialRangeOf(record);
  if (!financialRange.ok) return financialRange;
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
    invitation: { issuedAt, expiresAt, supersededBy: record.invitation.supersededBy },
    revision: revisionNumberOf(record.revision),
  });
}
const accessContextOf = (actor: "worker" | "coach", principalId: string, organizationId: string, ministryId: string, subjectAvailability: "available" | "unavailable"): CoachingAccessContext => ({ actor: { role: actor, principalId }, organizationId, ministryId, subjectAvailability, permissionHold: "none" });
function durationViewOf(episode: { readonly duration: GrantDuration; readonly cutoffInstant: Temporal.Instant | null; readonly boundInstant: Temporal.Instant | null; readonly remainingMilliseconds: number | null }): CoachingDurationView {
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
function workingPeriodOf(record: CoachingTargetRecord): Result<TargetPeriod, string> {
  const period = record.period;
  if (period.kind !== "custom") return ok({ kind: period.kind });
  if (period.from === null || period.to === null) return err("a custom period states no range");
  const from = civilDateOf(period.from);
  const to = civilDateOf(period.to);
  return from === null || to === null ? err("a custom period's range could not be read") : ok({ kind: "custom", start: from, end: to });
}
function workingVersionOf(version: CoachingTargetRecord["versions"][number]): Result<TargetVersion, string> {
  const effectiveFrom = civilDateOf(version.effectiveFrom);
  const calendarStart = civilDateOf(version.calendarStart);
  if (effectiveFrom === null || calendarStart === null) return err("a target version's dates could not be read");
  if (version.effectiveTo === null) return ok({ revisionId: version.revisionId, effectiveFrom, quantity: version.quantity, measure: version.measure, calendarStart });
  const effectiveTo = civilDateOf(version.effectiveTo);
  return effectiveTo === null ? err("a target version's end could not be read") : ok({ revisionId: version.revisionId, effectiveFrom, effectiveTo, quantity: version.quantity, measure: version.measure, calendarStart });
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
  return ok({ targetId: record.targetId, privateLabel: record.privateLabel, measure: record.measure, quantity: record.quantity, period: period.value, calendarStart, homePlacement: record.homePlacement satisfies TargetHomePlacement, state: record.state, versions });
}
const anchorOf = (target: TargetRecord): PeriodAnchor => ({ period: target.period, calendarStart: target.calendarStart });
type TargetVersionView = { readonly revisionId: string; readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly quantity: number; readonly measure: TargetMeasure; readonly calendarStart: string };
function versionViewOf(version: TargetVersion): TargetVersionView {
  return { revisionId: version.revisionId, effectiveFrom: serialiseCivilDate(version.effectiveFrom), effectiveTo: version.effectiveTo === undefined ? null : serialiseCivilDate(version.effectiveTo), quantity: version.quantity, measure: version.measure, calendarStart: serialiseCivilDate(version.calendarStart) };
}
type MeasuredPeriod = { readonly period: ResolvedPeriod; readonly version: TargetVersion | null; readonly versionProblem: TargetRefusalReason | null; readonly count: number | null };
function measuredPeriodOf(target: TargetRecord, activities: readonly ActivityEvent[], period: ResolvedPeriod): MeasuredPeriod {
  const version = resolveTargetVersion(target.versions, period);
  if (!version.ok) return { period, version: null, versionProblem: version.error, count: null };
  const count = measureFor({ measure: version.value.measure, period, activities, alreadyCredited: new Set<string>() }).count;
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
const activityKindOf = (recordedType: string): ActivityEventKind | undefined => ACTIVITY_KIND_BY_RECORDED_TYPE[recordedType.trim().toLowerCase()];
function occurrenceOf(interaction: InteractionRecord): ActivityEvent["occurrence"] | null {
  if (interaction.precision === "unknown") return { precision: "unknown" };
  const recorded = interaction.occurredOn;
  if (recorded === null) return null;
  const date = civilDateOf(recorded);
  return date === null ? null : { precision: interaction.precision, date };
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
function unavailableSupportReason(why: string): string {
  logger.sourceUnavailable({ job: "coaching", source: { system: LOCAL_STORE_SYSTEM, reference: SUPPORT_PROJECTION_REFERENCE } });
  return `the support source behind this range could not be read: ${why}`;
}
type SupportLoad = { readonly ok: true; readonly projection: SupportProjection } | { readonly ok: false; readonly reason: string };
function supportProjectionOf(state: CoachingState): SupportLoad {
  const record: SupportProjectionRecord | null = state.supportProjection;
  if (record === null) return { ok: false, reason: unavailableSupportReason("no projection is held") };
  const gifts = giftRowsOf(state.gifts);
  if (gifts === undefined) return { ok: false, reason: unavailableSupportReason("a gift row's day could not be read") };
  const commitments = commitmentRowsOf(state.commitments);
  if (commitments === undefined) return { ok: false, reason: unavailableSupportReason("a commitment row's day could not be read") };
  return { ok: true, projection: { supportSubjectId: record.supportSubjectId, basis: record.basis, currencyExponents: record.currencyExponents, coverage: record.coverage, asOf: record.asOf, lastSourceUpdate: record.lastSourceUpdate, source: record.source, gifts, commitments } };
}
type WorkerFinancialRangeView = { readonly from: string; readonly to: string; readonly currency: string; readonly money: Money | null; readonly valueState: ValueState; readonly coverage: Coverage };
// The coverage of a source nothing could be read from: no period is stated as covered, because stating one would claim a completeness the outage never established.
const UNSTATED_COVERAGE: Coverage = { from: null, to: null, state: "unknown" };
/** One relationship's separately reviewed financial range as the worker's own surface reads it: the fixed period and the one currency the grant records, and the figure a coach would read for that period, computed by the one report path over the one named basis — so the worker's surface and the coach's . */
function workerFinancialRangeOf(range: { readonly from: string; readonly to: string; readonly currency: string }, support: SupportLoad, sourceDown: boolean, authority: Scope): WorkerFinancialRangeView {
  const period = { from: range.from, to: range.to, currency: range.currency };
  if (!support.ok) return { ...period, money: null, valueState: "unavailable", coverage: UNSTATED_COVERAGE };
  const coverage = support.projection.coverage;
  if (sourceDown) return { ...period, money: null, valueState: "unavailable", coverage };
  const figures = receivedFiguresOf(support.projection, range, authority);
  // A report the engine could not produce leaves the range's period and currency stated and its figure absent: the range itself is a recorded fact, and only what could not be read is withheld from the surface.
  if (!figures.ok) return { ...period, money: null, valueState: "unavailable", coverage };
  const figure = figures.value[0];
  return figure === undefined || figure.minorUnits === null ? { ...period, money: null, valueState: "unknown", coverage } : { ...period, money: { currency: figure.currency, minorUnits: minorUnitsOf(figure.minorUnits) }, valueState: figure.valueState, coverage };
}
function dueDateOf(task: TaskRecord): TaskSummaryDueDate {
  if (task.dueOn === null) return { kind: "undated" };
  const date = civilDateOf(task.dueOn);
  return date === null ? { kind: "undated" } : { kind: "dated", date, precision: "date" };
}
type TaskDueDateView = { readonly kind: "dated"; readonly date: string; readonly precision: string } | { readonly kind: "undated" };
const dueDateViewOf = (dueDate: TaskSummaryDueDate): TaskDueDateView => (dueDate.kind === "undated" ? { kind: "undated" } : { kind: "dated", date: serialiseCivilDate(dueDate.date), precision: dueDate.precision });
function workingShareOf(share: StoredCoachingTaskShare): TaskShare | null {
  const reviewedAt = instantOf(share.reviewedSummary.reviewedAt);
  if (reviewedAt === null) return null;
  const base: TaskShare = { shareId: share.shareId, occurrenceId: share.occurrenceId, reviewedSummary: { description: share.reviewedSummary.description, codePoints: share.reviewedSummary.codePoints, reviewedAt }, reviewedFingerprint: share.reviewedFingerprint, state: share.state, revision: share.revision };
  if (share.withdrawnAt === undefined || share.withdrawnAt === null) return base;
  const withdrawnAt = instantOf(share.withdrawnAt);
  return withdrawnAt === null ? null : { ...base, withdrawnAt };
}
function taskSummaryObservation(states: readonly TaskShareSummaryState[]): ModuleObservation {
  const presence: ModuleContentPresence = states.length === 0 ? "none" : states.filter((state) => state === "shared").length === states.length ? "complete" : "partial";
  return { presence, withheldUntilReReviewed: states.some((state) => state === "needs-review") };
}
const taskStatusOf = (task: TaskRecord | undefined): TaskStatus | null => (task === undefined ? null : task.status);
// The stored tasks indexed once per read: every share resolves against this index rather than scanning the collection, and the first stored record for an identity is the one a scan would have returned.
function tasksByIdOf(tasks: readonly TaskRecord[]): ReadonlyMap<string, TaskRecord> {
  const byId = new Map<string, TaskRecord>();
  for (const task of tasks) if (!byId.has(task.taskId)) byId.set(task.taskId, task);
  return byId;
}
/** The same index restricted to one principal's own work, because a share is resolved only against the tasks its owner holds. */
const ownedTasksByIdOf = (tasks: readonly TaskRecord[], ownerPrincipalId: string): ReadonlyMap<string, TaskRecord> => tasksByIdOf(tasks.filter((task) => task.ownerPrincipalId === ownerPrincipalId));
function statedDurationViewOf(duration: GrantDuration | null, at: Temporal.Instant): CoachingDurationView {
  if (duration === null) return { kind: "none", shareThroughDate: null, frozenZone: null, cutoffInstant: null, boundedBy: null, boundInstant: null, openAtRead: false, remainingMilliseconds: null };
  const bound = duration.cutoffInstant ?? duration.sourceLimitInstant;
  const remaining = bound === null ? null : bound.epochMilliseconds - at.epochMilliseconds;
  return durationViewOf({ duration, cutoffInstant: duration.cutoffInstant ?? null, boundInstant: bound, remainingMilliseconds: remaining !== null && remaining > 0 ? remaining : null });
}
type PrivatePreparationView = { readonly preparationId: string; readonly displayName: string; readonly tags: readonly string[]; readonly revision: string; readonly body: string | null; readonly updatedOn: string | null };
type CoachingOutcomesView = { readonly invitationIssued: boolean; readonly identityVerified: boolean; readonly accepted: boolean; readonly accessLive: boolean };
type AdmittedModuleView = { readonly module: ModuleKey; readonly readState: ModuleReadState | null };
type WorkerRelationshipView = { readonly grantId: string; readonly recipientPrincipalId: string; readonly ministryIds: readonly string[]; readonly state: GrantLifecycleState } & { readonly modules: readonly CoachingModuleFlagView[]; readonly selectedModules: readonly ModuleKey[]; readonly sharesNothing: boolean } & {
  readonly availability: { readonly source: SubjectAvailability; readonly permissionHold: PermissionHold };
} & { readonly admittedModules: readonly AdmittedModuleView[]; readonly duration: CoachingDurationView } & { readonly financialRange: WorkerFinancialRangeView | null } & {
  readonly invitation: { readonly issuedAt: string; readonly expiresAt: string; readonly supersededBy: string | null; readonly acceptanceWindowOpen: boolean };
} & { readonly outcomes: CoachingOutcomesView; readonly readRefusal: CoachingRefusal | null; readonly revision: string };
type CoachingOverviewView = { readonly preparation: readonly PrivatePreparationView[]; readonly relationships: readonly WorkerRelationshipView[]; readonly activeGrantId: string | null; readonly activeModuleCount: number; readonly invitableCoaches: readonly InvitableCoachView[] } & {
  /** The currencies this session's support source holds, which a reviewed range must name exactly one of. */ readonly reviewedRangeCurrencies: readonly string[];
};
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
  return { body: latest.body, updatedOn: day.status === "resolved" ? serialiseCivilDate(day.date) : null };
}
/** One person an invitation can name: the principal this session's own coaching records name as a coach, and nothing those records do not hold. */ type InvitableCoachView = { readonly principalId: string; readonly displayName: string };
/** The people an invitation can name, taken from this session's own coaching records — the coach principals its grants already name — rather than from the development runtime's persona catalogue, which belongs to the preview switcher, or from the store's listing of other sessions, which belong to whoev. */
function invitableCoachesOf(coachPrincipalIds: readonly string[], actingPrincipalId: string): readonly InvitableCoachView[] {
  const coaches = new Map<string, InvitableCoachView>();
  for (const principalId of coachPrincipalIds) {
    // A worker is never offered themselves as their own coach, and one principal named by several grants is offered once.
    if (principalId === actingPrincipalId || coaches.has(principalId)) continue;
    coaches.set(principalId, { principalId, displayName: principalId });
  }
  return Array.from(coaches.values()).toSorted((one, two) => compareCodeUnits(one.principalId, two.principalId));
}
/** The worker's own preparation and sharing situation. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCoachingOverview(): Promise<ReadResult<ReadEnvelope<CoachingOverviewView>>> {
  const opened = await openWorkerRead("readCoachingOverview");
  if (!opened.ok) return opened.result;
  const { session, state, at, scope } = opened;
  const ownNotes = state.privateNotes ?? [];
  const preparation = state.partners
    .filter((partner) => partner.kind === "private-preparation" && partner.audience === "private")
    .map((partner): PrivatePreparationView => {
      const visible = project(partner, ["partnerId", "displayName", "tags", "revision"] as const);
      const prose = latestPrivateNoteOf(ownNotes, partner.partnerId, session.principalId);
      return { preparationId: visible.partnerId, displayName: visible.displayName, tags: visible.tags, revision: visible.revision, body: prose === null ? null : prose.body, updatedOn: prose === null ? null : prose.updatedOn };
    })
    .toSorted((one, two) => compareCodeUnits(one.displayName, two.displayName));
  const relationships: WorkerRelationshipView[] = [];
  const valueStates: Record<string, RecordedValueState> = {};
  let activeGrantId: string | null = null;
  let activeModuleCount = 0;
  let support: SupportLoad | null = null;
  const supportLoad = (): SupportLoad => {
    support ??= supportProjectionOf(state);
    return support;
  };
  for (const record of state.coachingGrants) {
    const decision = canView(session, { kind: "coaching-grant", grant: record, now: at });
    if (!decision.allowed) continue;
    const working = toWorkingGrant(record);
    if (!working.ok) return storeUnavailableRead("coaching", COACHING_SOURCE_REFERENCE, "A coaching relationship could not be read. Nothing is shown for it, and nothing was changed.");
    const ministryId = relationshipMinistryOf(record, scope);
    const admission = ministryId === null ? null : activeGrant(working.value, accessContextOf("worker", session.principalId, scope.organizationId, ministryId, "available"), at);
    const episode = admission !== null && admission.ok ? admission.value : null;
    const readRefusal: CoachingRefusal | null = ministryId === null ? { reason: "ministry-not-admitted", message: "This relationship covers no ministry, so nothing is shared in it." } : admission !== null && !admission.ok ? admission.error : null;
    const selectedModules = MODULE_KEYS.filter((key) => record.modules[key]);
    const expiresAt = instantOf(record.invitation.expiresAt);
    const admittedModules: AdmittedModuleView[] = [];
    if (episode !== null && ministryId !== null) {
      for (const key of selectedModules) {
        const supportSource: SupportLoad | null = isFinancialModule(key) ? supportLoad() : null;
        const subjectAvailability: SubjectAvailability = (supportSource !== null && !supportSource.ok) || moduleSourceReportedDown(session, key) ? "unavailable" : "available";
        const decision = moduleReadState(working.value, key, accessContextOf("worker", session.principalId, scope.organizationId, ministryId, subjectAvailability), at, observationOf(key, state, record.grantId, supportSource));
        if (!decision.ok) continue;
        admittedModules.push({ module: key, readState: decision.value });
      }
    }
    const availability: { readonly source: SubjectAvailability; readonly permissionHold: PermissionHold } = { source: admittedModules.some((entry) => entry.readState === "unavailable") ? "unavailable" : "available", permissionHold: readRefusal?.reason === "permission-hold" ? "temporary" : "none" };
    if (episode !== null && activeGrantId === null) {
      activeGrantId = record.grantId;
      activeModuleCount = selectedModules.length;
    }
    // The separately reviewed financial range this relationship records, read for the worker's own surface: its period, its one currency, and the figure a coach would read for that period.
    const storedRange = reviewedRangeOf(record);
    const rangeSource: SupportLoad | null = storedRange === null ? null : supportLoad();
    const financialRange: WorkerFinancialRangeView | null = storedRange === null || rangeSource === null ? null : workerFinancialRangeOf(storedRange, rangeSource, moduleSourceReportedDown(session, "support-results"), scope);
    const index = relationships.length;
    valueStates[`relationships.${index}.duration.remainingMilliseconds`] = countState(episode === null ? null : episode.remainingMilliseconds);
    if (financialRange !== null) valueStates[`relationships.${index}.financialRange.money`] = recordedStateOf(financialRange.valueState);
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
      financialRange,
      invitation: { issuedAt: record.invitation.issuedAt, expiresAt: record.invitation.expiresAt, supersededBy: record.invitation.supersededBy, acceptanceWindowOpen: record.state === "invited" && record.invitation.supersededBy === null && expiresAt !== null && Temporal.Instant.compare(at, expiresAt) < 0 },
      outcomes: { invitationIssued: true, identityVerified: working.value.identityVerification === "verified", accepted: working.value.acceptedAt !== null, accessLive: episode !== null },
      readRefusal,
      revision: record.revision,
    });
  }
  relationships.sort((one, two) => compareCodeUnits(one.grantId, two.grantId));
  // The invitation's recipient list is read here, in this read, because it is a projection over the relationships this read already resolved: the principal each of them names as its coach.
  const invitableCoaches = invitableCoachesOf(
    relationships.map((relationship) => relationship.recipientPrincipalId),
    session.principalId,
  );
  // The currencies this session's support source holds, in code-unit order. A reviewed range names exactly one of them — the invitation mutation refuses a currency the source does not hold — so the invitation control offers this closed list instead of free text.
  const reviewedRangeCurrencies = state.supportProjection === null ? [] : Object.keys(state.supportProjection.currencyExponents).toSorted(compareCodeUnits);
  valueStates.activeModuleCount = countState(activeModuleCount);
  const anyLive = relationships.some((relationship) => relationship.outcomes.accessLive);
  const actions: readonly ReadAction[] = [
    readAction("inviteCoach", true),
    readAction("setModule", anyLive, "No live coaching relationship covers this ministry, so no module can be switched."),
    readAction("revokeGrant", anyLive, "No live coaching relationship covers this ministry, so there is nothing to revoke."),
    readAction("endCoaching", anyLive, "No live coaching relationship covers this ministry, so there is nothing to end."),
  ];
  const data: CoachingOverviewView = { preparation, relationships, activeGrantId, activeModuleCount, invitableCoaches, reviewedRangeCurrencies };
  return respond(at, null, { data, scope, source: { system: LOCAL_STORE_SYSTEM, reference: COACHING_SOURCE_REFERENCE }, revision: collectionRevision(relationships.map((relationship) => ({ id: relationship.grantId, revision: relationship.revision }))), valueStates, actions });
}
type WorkerTargetPeriodView = { readonly start: string; readonly endInclusive: string; readonly exclusiveEnd: string; readonly startResolution: PeriodBoundaryResolution } & { readonly exclusiveEndResolution: PeriodBoundaryResolution; readonly version: TargetVersionView | null } & {
  readonly versionProblem: TargetRefusalReason | null;
  readonly count: number | null;
  readonly countState: RecordedValueState;
} & { readonly state: TargetState };
type WorkerTargetView = { readonly targetId: string; readonly privateLabel: string; readonly measure: TargetMeasure; readonly quantity: number } & { readonly period: { readonly kind: "weekly" | "monthly" | "custom"; readonly from: string | null; readonly to: string | null } } & {
  readonly calendarStart: string;
  readonly homePlacement: TargetHomePlacement;
  readonly state: TargetState;
} & { readonly versions: readonly TargetVersionView[]; readonly periods: readonly WorkerTargetPeriodView[]; readonly revision: string };
type TargetsView = { readonly targets: readonly WorkerTargetView[]; readonly measures: readonly TargetMeasure[]; readonly page: CoachingPageView; readonly planningZone: string; readonly activityEventsRead: number };
function workerTargetViewOf(record: CoachingTargetRecord, target: TargetRecord, activities: readonly ActivityEvent[], at: Temporal.Instant): WorkerTargetView {
  const periods: WorkerTargetPeriodView[] = [];
  for (const entry of measuredPeriodsOf(target, activities, at)) {
    const version = entry.version;
    const progress = version === null ? null : workerTargetProgress({ target, version, period: entry.period, count: entry.count });
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
  const { targetId, privateLabel, measure, quantity, calendarStart, homePlacement, revision } = record;
  return { targetId, privateLabel, measure, quantity, period: { kind: storedPeriod.kind, from: storedPeriod.from, to: storedPeriod.to }, calendarStart, homePlacement, state: current?.state ?? "unavailable", versions: target.versions.map(versionViewOf), periods, revision };
}
/** The worker's own targets, over the four canonical measures only. */
export async function readTargets(input: { readonly page?: number; readonly pageSize?: number } = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<TargetsView>>> {
  const opened = await openWorkerRead("readTargets", source);
  if (!opened.ok) return opened.result;
  const { session, state, at, scope } = opened;
  const activities = activityEventsOf(state.interactions);
  const valueStates: Record<string, RecordedValueState> = {};
  const targets: WorkerTargetView[] = [];
  for (const record of state.coachingTargets) {
    if (record.workerPrincipalId !== session.principalId) continue;
    const working = toWorkingTarget(record);
    if (!working.ok) return storeUnavailableRead("coaching", COACHING_SOURCE_REFERENCE, "A coaching target could not be read. Nothing is shown for it, and nothing was changed.");
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
  const data: TargetsView = { targets: paged.items, measures: [...TARGET_MEASURES], page: paged.page, planningZone: COACHING_PLANNING_ZONE, activityEventsRead: activities.length };
  const actions = [readAction("saveTarget", true), readAction("editTarget", targets.length > 0, "There is no target to change yet."), readAction("pauseTarget", targets.length > 0, "There is no target to pause yet."), readAction("endTarget", targets.length > 0, "There is no target to end yet.")];
  return respond(at, earliestVersionStart(targets), { data, scope, source: { system: LOCAL_STORE_SYSTEM, reference: "coaching-targets" }, revision: collectionRevision(targets.map((target) => ({ id: target.targetId, revision: target.revision }))), valueStates, actions });
}
function earliestVersionStart(targets: readonly WorkerTargetView[]): string | null {
  const starts = targets.flatMap((target) => target.versions.map((version) => version.effectiveFrom));
  return starts.length === 0 ? null : (starts.toSorted(compareCodeUnits).at(0) ?? null);
}
type CheckInQuestionView = { readonly wording: string; readonly order: number; readonly scalars: number };
type CheckInAnswerView = { readonly questionOrder: number | null; readonly text: string; readonly scalars: number };
type CheckInViolationView = { readonly path: string; readonly reason: string; readonly measured: number; readonly limit: number; readonly message: string };
type CheckInMeasurementsView = { readonly questionCount: number; readonly answerCount: number; readonly longestQuestionScalars: number; readonly longestAnswerScalars: number } & { readonly totalAnswerScalars: number; readonly requestBytes: number; readonly withinLimits: boolean } & {
  readonly violations: readonly CheckInViolationView[];
};
type PrivateDraftView = { readonly revisionId: string; readonly questionsCapturedAt: string; readonly savedAt: string; readonly questions: readonly CheckInQuestionView[]; readonly answers: readonly CheckInAnswerView[]; readonly measurements: CheckInMeasurementsView };
type SharedRevisionView = { readonly revisionId: string; readonly questionsCapturedAt: string; readonly sharedAt: string; readonly updatedAt: string } & { readonly withdrawnAt: string | null; readonly recipientPrincipalIds: readonly string[] } & {
  readonly duration: { readonly kind: "ongoing" | "through-date"; readonly cutoffInstant: string | null; readonly frozenZone: string };
} & { readonly questions: readonly CheckInQuestionView[]; readonly answers: readonly CheckInAnswerView[] } & { readonly measurements: CheckInMeasurementsView };
type WorkerCheckInView = { readonly checkInId: string; readonly grantId: string; readonly state: CheckInState; readonly revision: string; readonly privateDraft: PrivateDraftView | null; readonly shared: SharedRevisionView | null; readonly draftAndSharedDiffer: boolean };
type CheckInsView = { readonly checkIns: readonly WorkerCheckInView[]; readonly page: CoachingPageView; readonly limits: { readonly maxQuestions: number; readonly maxQuestionScalars: number; readonly maxAnswerScalars: number; readonly maxRequestBytes: number } };
const scalarCountOf = (value: string): number => [...value].length;
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
    violations: violations.map((violation) => ({ path: violation.path, reason: violation.reason, measured: violation.measured, limit: violation.limit, message: violation.message })),
  };
}
const questionViewsOf = (questions: readonly CheckInQuestion[]): readonly CheckInQuestionView[] => questions.map((question) => ({ wording: question.wording, order: question.order, scalars: scalarCountOf(question.wording) }));
const answerViewsOf = (answers: readonly CheckInAnswer[]): readonly CheckInAnswerView[] => answers.map((answer) => ({ questionOrder: answer.questionOrder, text: answer.text, scalars: scalarCountOf(answer.text) }));
function draftDiffersFromShared(draft: PrivateDraftView | null, shared: SharedRevisionView | null): boolean {
  return draft === null || shared === null ? false : draft.revisionId === shared.revisionId ? false : draft.answers.map((answer) => `${answer.questionOrder}:${answer.text}`).join("\u0000") !== shared.answers.map((answer) => `${answer.questionOrder}:${answer.text}`).join("\u0000");
}
/** The worker's private check-ins, their captured question sets and the revisions they shared. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCheckIns(input: { readonly page?: number; readonly pageSize?: number } = {}): Promise<ReadResult<ReadEnvelope<CheckInsView>>> {
  const opened = await openWorkerRead("readCheckIns");
  if (!opened.ok) return opened.result;
  const { session, state, at, scope } = opened;
  const valueStates: Record<string, RecordedValueState> = {};
  const checkIns: WorkerCheckInView[] = [];
  for (const record of state.coachingCheckIns) {
    if (record.workerPrincipalId !== session.principalId) continue;
    const privateDraft = privateDraftViewOf(record);
    const shared = sharedRevisionViewOf(record);
    const workingCheckIn = workingCheckInOf(record);
    if (!workingCheckIn.ok) return storeUnavailableRead("coaching", COACHING_SOURCE_REFERENCE, "A check-in could not be read. Nothing is shown for it, and nothing was changed.");
    checkIns.push({ checkInId: record.checkInId, grantId: record.grantId, state: checkInReadState(workingCheckIn.value, "available"), revision: record.revision, privateDraft, shared, draftAndSharedDiffer: draftDiffersFromShared(privateDraft, shared) });
  }
  checkIns.sort((one, two) => compareCodeUnits(one.checkInId, two.checkInId));
  const paged = pageOf(checkIns, input.page, input.pageSize);
  paged.items.forEach((checkIn, index) => {
    valueStates[`checkIns.${index}.answers`] = countState(checkIn.privateDraft === null ? (checkIn.shared?.answers.length ?? null) : checkIn.privateDraft.answers.length);
  });
  const data: CheckInsView = { checkIns: paged.items, page: paged.page, limits: { maxQuestions: CHECKIN_MAX_QUESTIONS, maxQuestionScalars: CHECKIN_MAX_QUESTION_SCALARS, maxAnswerScalars: CHECKIN_MAX_ANSWER_SCALARS, maxRequestBytes: CHECKIN_MAX_REQUEST_BYTES } };
  const actions = [
    readAction("saveCheckIn", true),
    readAction(
      "shareCheckIn",
      checkIns.some((checkIn) => checkIn.privateDraft !== null && checkIn.shared === null),
      "Nothing awaits a share. A check-in is shared from a saved private draft, and one that already holds a shared revision is changed with Update shared check-in.",
    ),
    readAction(
      "updateSharedCheckIn",
      checkIns.some((checkIn) => checkIn.shared !== null && checkIn.shared.withdrawnAt === null),
      "No check-in has a live shared revision to update. A withdrawn share cannot be updated, and a share is created from a saved private draft.",
    ),
    readAction(
      "withdrawCheckIn",
      checkIns.some((checkIn) => checkIn.shared !== null && checkIn.shared.withdrawnAt === null),
      "No check-in has a live shared revision to withdraw. A withdrawn share is already withdrawn, and a private draft is not a share.",
    ),
  ];
  return respond(at, null, { data, scope, source: { system: LOCAL_STORE_SYSTEM, reference: "coaching-check-ins" }, revision: collectionRevision(checkIns.map((checkIn) => ({ id: checkIn.checkInId, revision: checkIn.revision }))), valueStates, actions });
}
function privateDraftViewOf(record: CoachingCheckInRecord): PrivateDraftView | null {
  const draft = record.privateDraft;
  if (draft === null) return null;
  const questions: CheckInQuestion[] = draft.questions.map((question) => ({ wording: question.wording, order: question.order }));
  const answers: CheckInAnswer[] = draft.answers.map((answer) => ({ questionOrder: answer.questionOrder, text: answer.text }));
  return { revisionId: draft.revisionId, questionsCapturedAt: draft.questionsCapturedAt, savedAt: draft.savedAt, questions: questionViewsOf(questions), answers: answerViewsOf(answers), measurements: measurementsOf({ questions, answers }) };
}
function sharedRevisionViewOf(record: CoachingCheckInRecord): SharedRevisionView | null {
  const shared = record.shared;
  if (shared === null) return null;
  const questions: CheckInQuestion[] = shared.questions.map((question) => ({ wording: question.wording, order: question.order }));
  const answers: CheckInAnswer[] = shared.answers.map((answer) => ({ questionOrder: answer.questionOrder, text: answer.text }));
  return {
    revisionId: shared.revisionId,
    questionsCapturedAt: shared.questionsCapturedAt,
    sharedAt: shared.sharedAt,
    updatedAt: shared.updatedAt,
    withdrawnAt: shared.withdrawnAt,
    recipientPrincipalIds: [...shared.recipientPrincipalIds],
    duration: { kind: shared.duration.kind, cutoffInstant: shared.duration.cutoffInstant, frozenZone: shared.duration.frozenZone },
    questions: questionViewsOf(questions),
    answers: answerViewsOf(answers),
    measurements: measurementsOf({ questions, answers }),
  };
}
function workingShareDurationOf(duration: CoachingDurationRecord): Result<CheckInShareDuration, string> {
  if (duration.kind === "ongoing") return ok({ kind: "ongoing" });
  const cutoff = duration.cutoffInstant === null ? null : instantOf(duration.cutoffInstant);
  if (cutoff === null) return err("a shared revision's cutoff could not be read");
  const throughOn = shareThroughDateOfCutoff({ cutoffInstant: cutoff, frozenZone: duration.frozenZone });
  return throughOn === null ? err("a shared revision's frozen zone could not be resolved") : ok({ kind: "through-date", throughOn });
}
function workingCheckInOf(record: CoachingCheckInRecord): Result<CheckIn, string> {
  let privateDraft: CheckInPrivateDraftRevision | undefined;
  const draft = record.privateDraft;
  if (draft !== null) {
    const capturedAt = instantOf(draft.questionsCapturedAt);
    const savedAt = instantOf(draft.savedAt);
    if (capturedAt === null || savedAt === null) return err("a private draft's instant could not be read");
    privateDraft = { revisionId: draft.revisionId, captured: { questions: draft.questions.map((question) => ({ wording: question.wording, order: question.order })), capturedAt }, answers: draft.answers.map((answer) => ({ questionOrder: answer.questionOrder, text: answer.text })), savedAt };
  }
  let shared: CheckInSharedRevision | undefined;
  const sharedRecord = record.shared;
  if (sharedRecord !== null) {
    const capturedAt = instantOf(sharedRecord.questionsCapturedAt);
    const sharedAt = instantOf(sharedRecord.sharedAt);
    const updatedAt = instantOf(sharedRecord.updatedAt);
    if (capturedAt === null || sharedAt === null || updatedAt === null) return err("a shared revision's instant could not be read");
    const duration = workingShareDurationOf(sharedRecord.duration);
    if (!duration.ok) return duration;
    const withdrawnAt = sharedRecord.withdrawnAt === null ? null : instantOf(sharedRecord.withdrawnAt);
    if (sharedRecord.withdrawnAt !== null && withdrawnAt === null) return err("a withdrawal instant could not be read");
    shared = {
      revisionId: sharedRecord.revisionId,
      captured: { questions: sharedRecord.questions.map((question) => ({ wording: question.wording, order: question.order })), capturedAt },
      answers: sharedRecord.answers.map((answer) => ({ questionOrder: answer.questionOrder, text: answer.text })),
      recipients: [...sharedRecord.recipientPrincipalIds],
      duration: duration.value,
      sharedAt,
      updatedAt,
      ...(withdrawnAt === null ? {} : { withdrawnAt }),
    };
  }
  return ok({ checkInId: record.checkInId, revision: revisionNumberOf(record.revision), ...(privateDraft === undefined ? {} : { privateDraft }), ...(shared === undefined ? {} : { shared }) });
}
type WorkerTaskShareView = { readonly shareId: string; readonly taskId: string; readonly occurrenceId: string; readonly state: TaskShareSummaryState; readonly description: string | null } & { readonly reviewedCodePoints: number; readonly reviewedAt: string; readonly dueDate: TaskDueDateView | null } & {
  readonly status: TaskStatus | null;
  readonly revision: number;
  readonly withdrawnAt: string | null;
} & { readonly successorSelectionRequired: boolean };
// One task the worker may share a summary of, as the envelope states it: the task's identity, the label it is chosen by, the civil day it is due, the status it holds now, the fingerprint of the meaning a description is reviewed against, and the task's own revision.
type TaskSummaryCandidateView = { readonly taskId: string; readonly safeLabel: string; readonly dueDate: TaskDueDateView; readonly status: TaskStatus; readonly isRecurringSuccessor: boolean; readonly reviewedFingerprint: string; readonly revision: string };
type TaskSharesView = { readonly candidates: readonly TaskSummaryCandidateView[]; readonly shares: readonly WorkerTaskShareView[]; readonly page: CoachingPageView; readonly maxCodePoints: number; readonly sharesNothing: boolean };
/** The worker's own tasks as shareable candidates, in one deterministic order so two reads of the same records offer the same list. A repeating task is not offered. */
function taskSummaryCandidatesOf(tasks: readonly TaskRecord[]): readonly TaskSummaryCandidateView[] {
  return tasks
    .filter((task) => task.seriesId === null)
    .map((task) => ({ taskId: task.taskId, safeLabel: task.title, dueDate: dueDateViewOf(dueDateOf(task)), status: task.status, isRecurringSuccessor: false, reviewedFingerprint: taskReviewedFingerprint(task), revision: task.revision }))
    .sort((one, two) => compareCodeUnits(one.taskId, two.taskId));
}
/** The tasks a summary may be shared from and the summaries the worker selected for sharing, each with how it stands now. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readTaskShares(input: { readonly page?: number; readonly pageSize?: number } = {}): Promise<ReadResult<ReadEnvelope<TaskSharesView>>> {
  const opened = await openWorkerRead("readTaskShares");
  if (!opened.ok) return opened.result;
  const { session, state, at, scope } = opened;
  const valueStates: Record<string, RecordedValueState> = {};
  // The worker's own tasks indexed once: every share below resolves against this index rather than scanning the collection, and the same index answers which tasks may be shared next.
  const tasksById = ownedTasksByIdOf(state.tasks, session.principalId);
  const shares: WorkerTaskShareView[] = [];
  for (const stored of state.coachingTaskShares ?? []) {
    const task = tasksById.get(stored.taskId);
    const working = workingShareOf(stored);
    const sourceAvailable = working !== null && task !== undefined;
    const currentFingerprint = task === undefined ? undefined : taskReviewedFingerprint(task);
    const shareState = working === null ? "unavailable" : taskShareReadState({ share: working, currentFingerprint, sourceAvailable });
    const summary =
      working === null || task === undefined || shareState === "removed" || shareState === "unavailable"
        ? null
        : safeTaskSummary({ state: working.state, description: working.reviewedSummary.description, dueDate: dueDateOf(task), status: task.status, reviewedFingerprint: working.reviewedFingerprint, currentFingerprint, sourceAvailable });
    const summaryResult = summary?.ok === true ? summary.value : null;
    const currentSummary = summaryResult !== null && summaryResult.state === "shared" ? summaryResult : null;
    shares.push({
      shareId: stored.shareId,
      taskId: stored.taskId,
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
  const data: TaskSharesView = { candidates: taskSummaryCandidatesOf([...tasksById.values()]), shares: paged.items, page: paged.page, maxCodePoints: TASK_SUMMARY_MAX_CODE_POINTS, sharesNothing: shares.every((share) => share.state !== "shared") };
  const actions = [
    readAction("shareTaskSummary", true),
    readAction(
      "stopTaskShare",
      shares.some((share) => share.state === "shared"),
      "Nothing is currently shared, so there is nothing to stop sharing.",
    ),
    readAction(
      "selectSuccessorForSharing",
      shares.some((share) => share.successorSelectionRequired),
      "No shared occurrence belongs to a repeating task.",
    ),
  ];
  return respond(at, null, { data, scope, source: { system: LOCAL_STORE_SYSTEM, reference: "coaching-task-shares" }, revision: collectionRevision(shares.map((share) => ({ id: share.shareId, revision: String(share.revision) }))), valueStates, actions });
}
type CoachPortfolioSubjectView = { readonly grantId: string; readonly workerPrincipalId: string; readonly ministryId: string; readonly duration: CoachingDurationView; readonly admittedModules: readonly CoachingModuleAdmissionView[]; readonly revision: string };
type CoachPendingInvitationView = {
  readonly grantId: string;
  readonly state: "delivered";
  readonly recipientPrincipalId: string;
  readonly workerPrincipalId: string;
  readonly organizationId: string | null;
  readonly organizationLabel: string | null;
  readonly ministries: readonly { readonly ministryId: string; readonly ministryLabel: string | null }[];
  readonly modules: readonly ModuleKey[];
  readonly durationLabel: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revision: string;
};
type CoachPortfolioView = { readonly subjects: readonly CoachPortfolioSubjectView[]; readonly pendingInvitations: readonly CoachPendingInvitationView[]; readonly holdsNoSubjects: boolean };
/** One invitation this coach may accept, named from the records themselves: the principals it connects, the organization and the ministries the worker's own admission records state, the modules the grant names and the duration wording the domain already owns. Nothing here is inferred from a name or an address, and the grant's own revision is the one its acceptance is compared against. */
function pendingInvitationViewOf(record: CoachingGrantRecord, membershipsByMinistry: ReadonlyMap<string, AdmittedMembership>): CoachPendingInvitationView {
  const ministries = record.ministryIds.map((ministryId) => ({ ministryId, ministryLabel: membershipsByMinistry.get(ministryId)?.ministryLabel ?? null }));
  const home = record.ministryIds.flatMap((ministryId) => membershipsByMinistry.get(ministryId) ?? []).at(0);
  const duration = workingDurationOf(record);
  return {
    grantId: record.grantId,
    state: "delivered",
    recipientPrincipalId: record.coachPrincipalId,
    workerPrincipalId: record.workerPrincipalId,
    organizationId: home?.organizationId ?? null,
    organizationLabel: home?.organizationLabel ?? null,
    ministries,
    modules: MODULE_KEYS.filter((key) => record.modules[key]),
    durationLabel: duration === null ? UNREADABLE_DURATION_SENTENCE : duration.nominalWording,
    issuedAt: record.invitation.issuedAt,
    expiresAt: record.invitation.expiresAt,
    revision: record.revision,
  };
}
function coachPortfolioScope(session: ResolvedSession, ministryIds: readonly string[]): Scope {
  const first = ministryIds.at(0);
  return first !== undefined ? coachScope(session, first) : scopeSchema.parse({ organizationId: "grant-authority:portfolio", ministryId: "grant-authority:portfolio", supportSubjectId: "grant-authority:portfolio", principalId: session.principalId });
}
/** The subjects this coach holds an open, in-cutoff grant for, and the invitations addressed to this coach that still await their own decision. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCoachPortfolio(source?: SessionSource): Promise<ReadResult<ReadEnvelope<CoachPortfolioView>>> {
  const loaded = await loadCoachingState("readCoachPortfolio", source);
  if (!loaded.ok) return loaded.result;
  const { session, state, at } = loaded.context;
  const subjects: CoachPortfolioSubjectView[] = [];
  const pendingInvitations: CoachPendingInvitationView[] = [];
  const valueStates: Record<string, RecordedValueState> = {};
  // The worker's own admission records indexed once: an invitation names its organization and ministries from the membership that admits them, never from a name or an address.
  const membershipsByMinistry = new Map(state.context.admittedMemberships.map((membership) => [membership.ministryId, membership]));
  for (const record of state.coachingGrants) {
    if (record.coachPrincipalId !== session.principalId) continue;
    const expiresAt = instantOf(record.invitation.expiresAt);
    if (record.state === "invited" && record.invitation.supersededBy === null && expiresAt !== null && Temporal.Instant.compare(at, expiresAt) < 0) pendingInvitations.push(pendingInvitationViewOf(record, membershipsByMinistry));
    if (!canView(session, { kind: "coaching-grant", grant: record, now: at }).allowed) continue;
    const working = toWorkingGrant(record);
    if (!working.ok) continue;
    for (const ministryId of working.value.ministryIds) {
      const episode = activeGrant(working.value, accessContextOf("coach", session.principalId, coachScope(session, ministryId).organizationId, ministryId, "available"), at);
      if (!episode.ok) continue;
      const index = subjects.length;
      const admittedModules = episode.value.admittedModules.map((module) => ({ module, until: episode.value.boundInstant?.toString() ?? null, remainingMilliseconds: episode.value.remainingMilliseconds }));
      valueStates[`subjects.${index}.remainingMilliseconds`] = countState(episode.value.remainingMilliseconds);
      subjects.push({ grantId: record.grantId, workerPrincipalId: record.workerPrincipalId, ministryId, duration: durationViewOf(episode.value), admittedModules, revision: record.revision });
      break;
    }
  }
  subjects.sort((one, two) => {
    const byMinistry = compareCodeUnits(one.ministryId, two.ministryId);
    return byMinistry === 0 ? compareCodeUnits(one.grantId, two.grantId) : byMinistry;
  });
  pendingInvitations.sort((one, two) => compareCodeUnits(one.grantId, two.grantId));
  const scope = coachPortfolioScope(
    session,
    subjects.map((subject) => subject.ministryId),
  );
  const data: CoachPortfolioView = { subjects, pendingInvitations, holdsNoSubjects: subjects.length === 0 };
  const actions = [readAction("acceptInvitation", pendingInvitations.length > 0, "No invitation addressed to you is awaiting acceptance."), readAction("leaveCoaching", subjects.length > 0, "No coaching relationship of yours is open to leave.")];
  return respond(at, null, { data, scope, source: { system: LOCAL_STORE_SYSTEM, reference: COACHING_SOURCE_REFERENCE }, revision: collectionRevision(subjects.map((subject) => ({ id: subject.grantId, revision: subject.revision }))), valueStates, actions });
}
type CoachTargetProgressView = { readonly revisionId: string; readonly measure: TargetMeasure; readonly quantity: number; readonly start: string; readonly endInclusive: string; readonly count: number | null; readonly countState: RecordedValueState; readonly state: TargetState };
type CoachSharedCheckInView = { readonly revisionId: string; readonly questionsCapturedAt: string; readonly sharedAt: string; readonly updatedAt: string } & { readonly recipientPrincipalIds: readonly string[] } & {
  readonly duration: { readonly kind: "ongoing" | "through-date"; readonly cutoffInstant: string | null; readonly frozenZone: string };
} & { readonly questions: readonly CheckInQuestionView[]; readonly answers: readonly CheckInAnswerView[] };
type CoachTaskSummaryView = { readonly shareId: string; readonly state: TaskShareSummaryState; readonly description: string | null; readonly dueDate: TaskDueDateView | null; readonly status: TaskStatus | null };
type CoachGoalView = { readonly amount: Money; readonly exponent: number | null; readonly measure: string; readonly effectiveFrom: string; readonly valueState: RecordedValueState };
type CoachReceivedFigureView = { readonly currency: string; readonly exponent: number | null; readonly minorUnits: number | null; readonly valueState: ValueState; readonly from: string; readonly to: string; readonly periodState: string; readonly coverageState: Coverage["state"] };
type CoachModuleViewBase = { readonly module: ModuleKey; readonly state: ModuleReadState | null; readonly unavailability: string | null };
type CoachTargetsModuleView = CoachModuleViewBase & { readonly module: "targets"; readonly progress: readonly CoachTargetProgressView[] };
type CoachCheckInsModuleView = CoachModuleViewBase & { readonly module: "check-ins"; readonly sharedCheckIns: readonly CoachSharedCheckInView[] };
type CoachTaskSummariesModuleView = CoachModuleViewBase & { readonly module: "task-summaries"; readonly summaries: readonly CoachTaskSummaryView[] };
type CoachGoalModuleView = CoachModuleViewBase & { readonly module: "support-goal"; readonly goal: CoachGoalView | null };
interface CoachResultsModuleView extends CoachModuleViewBase {
  readonly module: "support-results";
  readonly basis: string;
  readonly basisDescription: string;
  readonly range: { readonly from: string; readonly to: string; readonly currency: string } | null;
  readonly received: readonly CoachReceivedFigureView[];
  readonly figureProblem: string | null;
}
type CoachModuleView = CoachTargetsModuleView | CoachCheckInsModuleView | CoachTaskSummariesModuleView | CoachGoalModuleView | CoachResultsModuleView;
type CoachSubjectView = { readonly grantId: string; readonly workerPrincipalId: string; readonly ministryId: string; readonly duration: CoachingDurationView } & { readonly financialRange: { readonly from: string; readonly to: string; readonly currency: string } | null } & {
  readonly modules: readonly CoachModuleView[];
  readonly sharesNothing: boolean;
  readonly revision: string;
};
const isFinancialModule = (module: ModuleKey): boolean => module === "support-goal" || module === "support-results";
const moduleSourceReportedDown = (session: ResolvedSession, module: ModuleKey): boolean => (!isFinancialModule(module) ? false : isScenarioId(session.scenarioId) && scenarioFlagsFor(session.scenarioId).coachingModule === "unavailable");
function receivedFiguresOf(projection: SupportProjection, range: { readonly from: string; readonly to: string; readonly currency: string }, authority: Scope): Result<readonly CoachReceivedFigureView[], string> {
  const from = civilDateOf(range.from);
  const to = civilDateOf(range.to);
  if (from === null || to === null) return err("the reviewed range could not be read");
  const built = buildReportQuery({
    reportId: "received-period-and-year-to-date",
    scope: { organizationId: authority.organizationId, ministryId: authority.ministryId, supportSubjectId: authority.supportSubjectId, principalId: authority.principalId },
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
      coverageState: result.snapshot.coverage.state,
    },
  ]);
}
function observationOf(module: ModuleKey, state: CoachingState, grantId: string, support: SupportLoad | null): ModuleObservation {
  switch (module) {
    case "targets": {
      const presence: ModuleContentPresence = state.coachingTargets.length === 0 ? "none" : "complete";
      return { presence, withheldUntilReReviewed: false };
    }
    case "check-ins": {
      // A check-in belongs to the relationship it was shared under, so only that relationship's own shared revisions are its content: a revision shared under another grant leaves this one with nothing recorded rather than borrowing another episode's content.
      const shared = state.coachingCheckIns.filter((checkIn) => checkIn.grantId === grantId && checkIn.shared !== null && checkIn.shared.withdrawnAt === null);
      return { presence: shared.length === 0 ? "none" : "complete", withheldUntilReReviewed: false };
    }
    case "task-summaries": {
      const shares = (state.coachingTaskShares ?? []).filter((share) => share.state === "shared");
      // The collection is indexed once for the module rather than scanned for every share, so what a share's task states is a lookup.
      const tasksById = tasksByIdOf(state.tasks);
      return taskSummaryObservation(shares.map((share) => taskShareSummaryStateOf(share, tasksById)));
    }
    case "support-goal": {
      return support === null || !support.ok ? { presence: "none", withheldUntilReReviewed: false } : { presence: storedGoalOf(state) === null ? "none" : "complete", withheldUntilReReviewed: false };
    }
    case "support-results": {
      return support === null || !support.ok ? { presence: "none", withheldUntilReReviewed: false } : { presence: support.projection.gifts.length === 0 ? "none" : "complete", withheldUntilReReviewed: false };
    }
    default:
      return { presence: "none", withheldUntilReReviewed: false };
  }
}
function taskShareSummaryStateOf(share: StoredCoachingTaskShare, tasksById: ReadonlyMap<string, TaskRecord>): TaskShareSummaryState {
  const working = workingShareOf(share);
  const task = tasksById.get(share.taskId);
  return working === null ? "unavailable" : taskShareReadState({ share: working, currentFingerprint: task === undefined ? undefined : taskReviewedFingerprint(task), sourceAvailable: task !== undefined });
}
function coachTargetProgressOf(state: CoachingState, activities: readonly ActivityEvent[], at: Temporal.Instant, valueStates: Record<string, RecordedValueState>, moduleIndex: number, workerPrincipalId: string): readonly CoachTargetProgressView[] {
  const progress: CoachTargetProgressView[] = [];
  for (const record of state.coachingTargets) {
    if (record.workerPrincipalId !== workerPrincipalId) continue;
    const working = toWorkingTarget(record);
    if (!working.ok) continue;
    for (const entry of measuredPeriodsOf(working.value, activities, at)) {
      if (entry.version === null) continue;
      const view = coachTargetProgress({ target: working.value, version: entry.version, period: entry.period, count: entry.count });
      valueStates[`modules.${moduleIndex}.progress.${progress.length}.count`] = countState(view.count);
      progress.push({ revisionId: view.revisionId, measure: view.measure, quantity: view.quantity, start: serialiseCivilDate(view.period.start), endInclusive: serialiseCivilDate(view.period.endInclusive), count: view.count, countState: countState(view.count), state: view.state });
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
    const questions: CheckInQuestion[] = revision.questions.map((question) => ({ wording: question.wording, order: question.order }));
    const answers: CheckInAnswer[] = revision.answers.map((answer) => ({ questionOrder: answer.questionOrder, text: answer.text }));
    shared.push({
      revisionId: revision.revisionId,
      questionsCapturedAt: revision.questionsCapturedAt,
      sharedAt: revision.sharedAt,
      updatedAt: revision.updatedAt,
      recipientPrincipalIds: [...revision.recipientPrincipalIds],
      duration: { kind: revision.duration.kind, cutoffInstant: revision.duration.cutoffInstant, frozenZone: revision.duration.frozenZone },
      questions: questionViewsOf(questions),
      answers: answerViewsOf(answers),
    });
  }
  return shared;
}
function coachTaskSummariesOf(state: CoachingState, tasksById: ReadonlyMap<string, TaskRecord>): readonly CoachTaskSummaryView[] {
  const summaries: CoachTaskSummaryView[] = [];
  for (const stored of state.coachingTaskShares ?? []) {
    const task = tasksById.get(stored.taskId);
    if (task === undefined) continue;
    const working = workingShareOf(stored);
    const readState = working === null ? "unavailable" : taskShareReadState({ share: working, currentFingerprint: task === undefined ? undefined : taskReviewedFingerprint(task), sourceAvailable: task !== undefined });
    if (readState === "removed") continue;
    const summary =
      working === null || task === undefined ? null : safeTaskSummary({ state: working.state, description: working.reviewedSummary.description, dueDate: dueDateOf(task), status: task.status, reviewedFingerprint: working.reviewedFingerprint, currentFingerprint: taskReviewedFingerprint(task), sourceAvailable: true });
    const current = summary !== null && summary.ok && summary.value.state === "shared" ? summary.value : null;
    summaries.push({ shareId: stored.shareId, state: readState, description: current === null ? null : current.description, dueDate: task === undefined ? null : dueDateViewOf(dueDateOf(task)), status: taskStatusOf(task) });
  }
  return summaries;
}
const storedGoalOf = (state: CoachingState): SupportProjectionRecord["goal"] => (state.supportProjection === null ? null : state.supportProjection.goal);
function coachGoalOf(state: CoachingState): CoachGoalView | null {
  const goal = storedGoalOf(state);
  if (goal === null) return null;
  const exponent = exponentOf(goal.amount.currency);
  return { amount: goal.amount, exponent: exponent ?? null, measure: goal.measure, effectiveFrom: goal.effectiveFrom, valueState: exponent === undefined ? "unknown" : goal.amount.minorUnits === 0 ? "zero" : "value" };
}
function coachModulesOf(context: CoachingReadContext, working: CoachingGrant, record: CoachingGrantRecord, scope: Scope, modules: readonly ModuleKey[], support: SupportLoad, valueStates: Record<string, RecordedValueState>): readonly CoachModuleView[] {
  const { session, state, at } = context;
  const activities = activityEventsOf(state.interactions);
  const views: CoachModuleView[] = [];
  for (const key of modules) {
    const sourceDown = (isFinancialModule(key) && !support.ok) || moduleSourceReportedDown(session, key);
    const unavailability = sourceDown ? (support.ok ? COACHING_MODULE_SOURCE_DOWN_REASON : support.reason) : null;
    const availability: SubjectAvailability = sourceDown ? "unavailable" : "available";
    const decision = moduleReadState(working, key, accessContextOf("coach", session.principalId, scope.organizationId, scope.ministryId, availability), at, observationOf(key, state, working.grantId, support));
    if (!decision.ok) continue;
    const base = { state: decision.value, unavailability };
    const index = views.length;
    switch (key) {
      case "targets":
        views.push({ module: key, ...base, progress: coachTargetProgressOf(state, activities, at, valueStates, index, working.workerPrincipalId) });
        break;
      case "check-ins":
        views.push({ module: key, ...base, sharedCheckIns: coachSharedCheckInsOf(state, working.grantId) });
        break;
      case "task-summaries":
        views.push({ module: key, ...base, summaries: coachTaskSummariesOf(state, ownedTasksByIdOf(state.tasks, working.workerPrincipalId)) });
        break;
      case "support-goal":
        views.push({ module: key, ...base, goal: sourceDown ? null : coachGoalOf(state) });
        break;
      case "support-results": {
        const range = reviewedRangeOf(record);
        const figures = support.ok && !sourceDown && range !== null ? receivedFiguresOf(support.projection, range, scope) : null;
        const figureProblem = sourceDown ? unavailability : figures !== null && !figures.ok ? figures.error : range === null ? "no reviewed range is recorded" : null;
        views.push({ module: key, ...base, basis: SUPPORT_BASIS, basisDescription: BASIS_DESCRIPTION, range, received: figures !== null && figures.ok ? figures.value : [], figureProblem });
        break;
      }
      default:
        break;
    }
  }
  return views;
}
function reviewedRangeOf(record: CoachingGrantRecord): { readonly from: string; readonly to: string; readonly currency: string } | null {
  const range = record.financialRange;
  return range === null ? null : { from: range.from, to: range.to, currency: range.currency };
}
/** One subject's admitted modules, as a coach reads them. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCoachSubject(input: { readonly grantId: string }, source?: SessionSource): Promise<ReadResult<ReadEnvelope<CoachSubjectView>>> {
  const loaded = await loadCoachingState("readCoachSubject", source);
  if (!loaded.ok) return loaded.result;
  const context = loaded.context;
  const { session, state, at } = context;
  if (!isNonEmptyString(input.grantId)) return deniedRead("no-permission");
  const record = state.coachingGrants.find((grant) => grant.grantId === input.grantId && grant.coachPrincipalId === session.principalId);
  if (record === undefined) return deniedRead("no-permission");
  if (!canView(session, { kind: "coaching-grant", grant: record, now: at }).allowed) return deniedRead("no-permission");
  const working = toWorkingGrant(record);
  if (!working.ok) return storeUnavailableRead("coaching", COACHING_SOURCE_REFERENCE, "This coaching relationship could not be read. Nothing is shown, and nothing was changed.");
  let episode: { readonly scope: Scope; readonly admitted: readonly ModuleKey[]; readonly duration: CoachingDurationView } | null = null;
  for (const ministryId of working.value.ministryIds) {
    const authority = coachScope(session, ministryId);
    const admission = activeGrant(working.value, accessContextOf("coach", session.principalId, authority.organizationId, ministryId, "available"), at);
    if (!admission.ok) continue;
    episode = { scope: authority, admitted: admission.value.admittedModules, duration: durationViewOf(admission.value) };
    break;
  }
  if (episode === null) return deniedRead("no-permission");
  const openEpisode = episode;
  const support: SupportLoad = openEpisode.admitted.some(isFinancialModule) ? supportProjectionOf(state) : { ok: false, reason: "no financial module is shared with this coach" };
  const valueStates: Record<string, RecordedValueState> = {};
  const modules = coachModulesOf(context, working.value, record, openEpisode.scope, openEpisode.admitted, support, valueStates);
  const range = reviewedRangeOf(record);
  const data: CoachSubjectView = { grantId: record.grantId, workerPrincipalId: record.workerPrincipalId, ministryId: openEpisode.scope.ministryId, duration: openEpisode.duration, financialRange: range, modules, sharesNothing: openEpisode.admitted.length === 0, revision: record.revision };
  const actions = [readAction("acceptInvitation", record.state === "invited", "This invitation was already accepted, so there is nothing to accept."), readAction("leaveCoaching", record.state === "active" || record.state === "accepted", "This relationship is not open, so there is nothing to leave.")];
  return respond(at, range?.from ?? null, { data, scope: openEpisode.scope, source: { system: LOCAL_STORE_SYSTEM, reference: record.grantId }, revision: record.revision, valueStates, actions });
}
