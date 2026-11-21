/**
 * The six coaching reads: a worker's preparation and sharing surface, and a coach's read-only
 * portfolio and subject.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Reads: coaching" row and AAP 0.7.1, which name the six reads here —
 *   `readCoachingOverview`, `readTargets`, `readCheckIns`, `readTaskShares`, `readCoachPortfolio` and
 *   `readCoachSubject` — under the job groups "Prepare and share with a coach" and "Read as a coach".
 * - AAP 0.8.4 coaching rules: private preparation as its own record class; the five module flags
 *   starting unselected; a missing duration never read as permission; the frozen exclusive cutoff; the
 *   four canonical measures counted only from actual activity records; prospective target versions
 *   with closed periods keeping their own; check-in limits enforced and never truncated; the reviewed
 *   safe task description; a coach view that authorises before it enumerates; the six stop-type
 *   effects kept apart.
 * - AAP 0.8.7 fixed values: coaching lists page 25 by default and cap at 100, a check-in carries at
 *   most five questions of 500 Unicode scalars, answers of 4,000, a 256 KiB request, and a shared task
 *   description of at most 240 code points.
 * - AAP 0.11.1 deliverable row for `data-service/reads/*.ts`, with acceptance criteria 16 and 19.
 *
 * Two properties hold of every export here.
 *
 * Authorisation precedes enumeration. A read resolves the session, authorises the relationship, and
 * only then reads a module. A coach who is not admitted to a module receives no state for it — not an
 * empty one, not a zero and not its name — so nothing in this file can tell a coach that an unshared
 * module exists. A denial is the closed reason code the authorisation layer produces, with no count,
 * title, size or existence flag beside it.
 *
 * A missing value is never a zero. A count that could not be read is `null` and the module says
 * `unavailable`; a genuine zero is a count and the surface says `zero recorded`; an ended
 * relationship, a temporary permission hold and an unreachable source stay three different answers.
 *
 * Layering: a data-service read. It imports the domain modules (`modules/coaching/*`,
 * `modules/support/*`, `modules/money`, `modules/time`), the authorisation layer, the envelope and
 * outcome contracts, and the store's one read function. It opens no transaction, writes nothing, sends
 * nothing, schedules nothing, reads no clock except `now()`, and holds no second activity counter:
 * every count here comes from `measureFor`.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { isNonEmptyString } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
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
import {
  TASK_SUMMARY_MAX_CODE_POINTS,
  safeTaskSummary,
  taskShareReadState,
  type TaskShare,
  type TaskShareSummaryState,
  type TaskStatus,
  type TaskSummaryDueDate,
} from "@/modules/coaching/taskshare";
import type { Money } from "@/modules/money/amount";
import { exponentOf } from "@/modules/money/currency";
import {
  BASIS_DESCRIPTION,
  SUPPORT_BASIS,
  type GiftRow,
  type SupportProjection,
} from "@/modules/support/basis";
import { buildReportQuery, runReport, type ReportResult } from "@/modules/support/report";
import { now } from "@/modules/time/clock";
import {
  civilDateAt,
  parseCivilDate,
  serialiseCivilDate,
  todayInZone,
  type CivilDate,
  type DatePrecision,
} from "@/modules/time/civil";

import { readSession } from "../../store/repository";
import { assertScope, canView, resolveSession, type ResolvedSession } from "../authorize";
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
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type Scope,
  type SupportProjectionRecord,
  type TaskRecord,
  type ValueState,
} from "../envelope";
import {
  LOCAL_STORE_SYSTEM,
  denied,
  unavailable,
  type DenialReason,
  type ReadResult,
} from "../outcome";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The attempt identity a read states in a refusal.
 *
 * A read has no attempt to replay, so it states that instead of inventing an identifier, and the
 * refusal's shape stays byte-identical to a mutation's. A mutation replaces it with its own
 * `operationId`, because for a write the attempt identity is the caller's recovery handle.
 */
const READ_ATTEMPT_ID = "read";

/** A coaching list's default page: 25 rows, as AAP 0.8.7 fixes for every coaching list. */
const COACHING_PAGE_SIZE_DEFAULT = 25;

/** The most a coaching list may be asked for at once. Eligible history is never truncated by it. */
const COACHING_PAGE_SIZE_CAP = 100;

/**
 * The zone a target's weekly, monthly and custom periods are bucketed in.
 *
 * A target stores a calendar start and no zone, and a period is a civil-day bucket: it needs one
 * declared zone so the same target resolves to the same dates on every machine. The synthetic
 * runtime declares UTC once, here, rather than taking a host zone or a reader's display zone, and
 * every display-zone change therefore moves no boundary.
 */
const COACHING_PLANNING_ZONE = "UTC";

/** The source system's own reference for the coaching families a read enumerates. */
const COACHING_SOURCE_REFERENCE = "coaching";

/** The reference a support projection's absence is reported under, so a surface can find its owner. */
const SUPPORT_PROJECTION_REFERENCE = "support-projection";

// ---------------------------------------------------------------------------------------------
// The stored families these reads parse
// ---------------------------------------------------------------------------------------------

/**
 * One share of one task occurrence, as stored.
 *
 * The record's shape is declared once in `../envelope`, beside the vocabulary every other stored record
 * belongs to, because both the write that records a share and this read validate it.
 * `reviewedFingerprint` is opaque: this file compares it with the fingerprint of the task's reviewed
 * fields as they stand now and never interprets it.
 */
type StoredCoachingTaskShare = CoachingTaskShareRecord;

/**
 * The families these six reads parse out of the session's opaque state document.
 *
 * Only what coaching reads is validated, and the record schemas are the ones `envelope.ts` declares,
 * so a record is read through the one declaration of its shape. Every family is present in a seeded
 * document because the development runtime lays each one down, empty where a session holds none.
 */
const coachingStateSchema = z.object({
  coachingGrants: z.array(coachingGrantRecordSchema),
  coachingTargets: z.array(coachingTargetRecordSchema),
  coachingCheckIns: z.array(coachingCheckInRecordSchema),
  coachingTaskShares: z.array(coachingTaskShareRecordSchema).optional(),
  interactions: z.array(interactionRecordSchema),
  tasks: z.array(taskRecordSchema),
  partners: z.array(partnerRecordSchema),
  supportProjection: supportProjectionRecordSchema.nullable(),
  gifts: z.array(giftRowRecordSchema),
  commitments: z.array(commitmentRowRecordSchema),
});

/** The stored families this file reads, as the schema above yields them. */
type CoachingState = z.infer<typeof coachingStateSchema>;

// ---------------------------------------------------------------------------------------------
// Shapes shared by more than one read
// ---------------------------------------------------------------------------------------------

/** One page of a coaching list: the window, and the whole-result count it is a window onto. */
interface CoachingPageView {
  readonly index: number;
  readonly size: number;
  readonly total: number;
  readonly totalPages: number;
  readonly cappedAt: number;
}

/**
 * The ministry one relationship is evaluated in.
 *
 * A relationship is the worker's own record and lists the ministries the sharing covers, which need not
 * include the context this read was scoped to — a grant made in another ministry is still the worker's to
 * review, and hiding it would hide a closure they performed. The selected ministry is used when the grant
 * covers it; otherwise the grant's own first ministry is, and the row states every ministry it covers so a
 * surface can disclose which one it belongs to. An admitted action is still re-checked against the ministry
 * it is submitted in.
 */
function relationshipMinistryOf(record: CoachingGrantRecord, scope: Scope): string | null {
  if (record.ministryIds.includes(scope.ministryId)) return scope.ministryId;
  return record.ministryIds.at(0) ?? null;
}

/** One module switch, in the canonical order, so five flags are five facts and not a bitmask. */
interface CoachingModuleFlagView {
  readonly module: ModuleKey;
  readonly selected: boolean;
}

/**
 * How long a share lasts, and whether it is open at the instant the read ran.
 *
 * `cutoffInstant` is the exclusive bound frozen at acceptance: the whole Share-through date stays
 * readable and a read at the instant itself is denied. `boundedBy` names which limit decided, because
 * an earlier source limit wins and is shown rather than the chosen date being presented as its reason.
 */
interface CoachingDurationView {
  /**
   * `none` states that the record holds no usable duration at all, which is a different answer from an
   * open-ended one and is never read as permission.
   */
  readonly kind: "ongoing" | "through-date" | "none";
  readonly frozenZone: string | null;
  readonly cutoffInstant: string | null;
  readonly boundedBy: "share-through" | "source" | null;
  readonly boundInstant: string | null;
  readonly openAtRead: boolean;
  readonly remainingMilliseconds: number | null;
}

/** One module a coach is admitted to, with the period that admission runs for. */
interface CoachingModuleAdmissionView {
  readonly module: ModuleKey;
  readonly until: string | null;
  readonly remainingMilliseconds: number | null;
}

// ---------------------------------------------------------------------------------------------
// Session, state and scope
// ---------------------------------------------------------------------------------------------

/** The session, its parsed coaching families and the instant the read runs at. */
interface CoachingReadContext {
  readonly session: ResolvedSession;
  readonly state: CoachingState;
  readonly at: Temporal.Instant;
}

/** A loaded read context, or the refusal that replaced the envelope. */
type CoachingLoad =
  | { readonly ok: true; readonly context: CoachingReadContext }
  | { readonly ok: false; readonly result: ReadResult<never> };

/** A resolved scope, or the refusal that replaced the envelope. */
type ScopeLoad =
  | { readonly ok: true; readonly scope: Scope }
  | { readonly ok: false; readonly result: ReadResult<never> };

/** A refusal carrying one closed reason code, and nothing about what was refused. */
function deniedRead(reasonCode: DenialReason): ReadResult<never> {
  return { kind: "denied", denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode }) };
}

/**
 * A source that could not answer: the source identity and guidance, never an empty list or a zero.
 *
 * The outage is also written to the local diagnostics as one line naming the job and the source, and
 * never a value the read was unable to return.
 */
function unavailableRead(reference: string, guidance: string): ReadResult<never> {
  const source: SourceReference = { system: LOCAL_STORE_SYSTEM, reference };
  logger.sourceUnavailable({ job: "coaching", source });
  return {
    kind: "unavailable",
    unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance }),
  };
}

/**
 * Resolves the session and parses the coaching families out of its own state document.
 *
 * Nothing is cached: the document is read on every call, so a scenario change, a clock change or a
 * reset takes effect on the next request. A session that does not exist, a document that cannot be
 * read and a document whose coaching records do not decode all answer `unavailable` with the source
 * named, because there is no honest retry to offer and an empty list would be a different fact.
 */
async function loadCoachingState(): Promise<CoachingLoad> {
  const resolution = await resolveSession();
  if (!resolution.ok) {
    return { ok: false, result: { kind: "denied", denied: resolution.denial } };
  }

  const { session } = resolution;
  let documents: Awaited<ReturnType<typeof readSession>>;
  try {
    documents = await readSession(session.sessionId);
  } catch {
    return {
      ok: false,
      result: unavailableRead(
        COACHING_SOURCE_REFERENCE,
        "The coaching records for this session could not be read. Reload the session; nothing was changed.",
      ),
    };
  }

  if (documents === undefined) {
    return {
      ok: false,
      result: unavailableRead(
        COACHING_SOURCE_REFERENCE,
        "This session holds no records yet. Reset the development data and try again.",
      ),
    };
  }

  const parsed = coachingStateSchema.safeParse(documents.state);
  if (!parsed.success) {
    return {
      ok: false,
      result: unavailableRead(
        COACHING_SOURCE_REFERENCE,
        "The coaching records for this session did not decode. Nothing is shown, and nothing was changed.",
      ),
    };
  }

  return { ok: true, context: { session, state: parsed.data, at: now() } };
}

/**
 * The scope a worker-side coaching read runs under: the context the session has selected, authorised.
 *
 * A session that has selected no context has no authority in any ministry, so it is refused rather
 * than served the records of one it never chose.
 */
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

/**
 * The authority a grant-authorised coach read states in its envelope.
 *
 * A coach holds no ministry membership and must not be given one, so the authority a coach read runs
 * under is the grant. The grant records the ministries the sharing covers and says nothing about the
 * organisation they belong to — the envelope's own vocabulary is explicit that a ministry is meaningful
 * only inside one organisation, and that the authorisation layer hands the pair in rather than deriving
 * it. Where the coach does hold an admission to the covered ministry, its organisation and support
 * subject are stated exactly; otherwise the two references are grant-bound markers that carry the grant
 * authority and can never equal an organisation or support subject an admitted worker reads. Neither
 * marker is ever parsed, compared or displayed as if it named a real record.
 */
function coachScope(session: ResolvedSession, ministryId: string): Scope {
  const admission = session.admittedMemberships.find(
    (membership) => membership.ministryId === ministryId,
  );
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

// ---------------------------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------------------------

/** Reads a stored instant, or `null` when the value is not one this runtime can resolve. */
function instantOf(value: string): Temporal.Instant | null {
  try {
    return Temporal.Instant.from(value);
  } catch {
    return null;
  }
}

/** Reads a stored civil date, or `null` when the value is not a day this runtime can resolve. */
function civilDateOf(value: string): CivilDate | null {
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : null;
}

/** The calendar day the read ran on, in the planning zone, or `null` when that zone cannot resolve. */
function asOfDate(at: Temporal.Instant): string | null {
  const today = todayInZone(COACHING_PLANNING_ZONE, at);
  return today.status === "resolved" ? serialiseCivilDate(today.date) : null;
}

/** A list's coverage statement: no earlier boundary is claimed than the records actually state. */
function coverageOf(from: string | null, at: Temporal.Instant): Coverage {
  return { from, to: asOfDate(at), state: "complete" };
}

/** The revision a collection read reports, derived from its members' own revisions, never invented. */
function collectionRevision(
  members: readonly { readonly id: string; readonly revision: string }[],
): string {
  if (members.length === 0) return "empty";
  return members.map((member) => `${member.id}@${member.revision}`).join("|");
}

/** One page's window, with the whole-result count the window is taken from. */
function pageOf<T>(
  items: readonly T[],
  page: number | undefined,
  pageSize: number | undefined,
): { readonly items: readonly T[]; readonly page: CoachingPageView } {
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

/** The page size a request asks for, clamped to the fixed cap; a request above it is clamped. */
function clampPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isSafeInteger(requested) || requested <= 0) {
    return COACHING_PAGE_SIZE_DEFAULT;
  }
  return Math.min(requested, COACHING_PAGE_SIZE_CAP);
}

/** The page index a request asks for, clamped into the pages the result actually has. */
function clampPageIndex(requested: number | undefined, totalPages: number): number {
  if (totalPages === 0) return 0;
  if (requested === undefined || !Number.isSafeInteger(requested) || requested < 0) return 0;
  return Math.min(requested, totalPages - 1);
}

/** The recorded state of a count: a genuine zero, a stated value, or a value that is not stated. */
function countState(count: number | null): RecordedValueState {
  if (count === null) return "unavailable";
  return count === 0 ? "zero" : "value";
}

/** Whether an action list may offer a named action, with the reason it cannot when it may not. */
function actionOf(name: string, available: boolean, reason?: string): ReadAction {
  return available
    ? { name, available: true }
    : { name, available: false, reason: reason ?? "This action is not available here." };
}

// ---------------------------------------------------------------------------------------------
// Adapting a stored grant to the coaching module's working grant
// ---------------------------------------------------------------------------------------------

/**
 * Reads a stored revision as the working grant's number.
 *
 * The stored form is an opaque string because a record's optimistic token is opaque, while the
 * coaching module's working type carries a number it uses only to detect a stale command. A value that
 * is not a safe integer becomes `0`, which no stored revision equals, so a command built from it is
 * refused as stale rather than applied against a guess.
 */
function revisionNumberOf(stored: string): number {
  const parsed = Number.parseInt(stored, 10);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

/**
 * The duration a stored grant records, or `null` when it states no usable one.
 *
 * A missing duration is not permission. A share-through grant whose frozen cutoff cannot be read has
 * no bound at all, and an unbounded share is not what the worker chose, so it is reported as absent
 * and every read refuses it as `missing-duration` instead of reading it as indefinite.
 */
function workingDurationOf(record: CoachingGrantRecord): GrantDuration | null {
  const { duration } = record;
  if (duration.kind === "through-date") {
    const cutoff = duration.cutoffInstant === null ? null : instantOf(duration.cutoffInstant);
    if (cutoff === null) return null;
    return {
      kind: "through-date",
      shareThroughDate: null,
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

/**
 * The reviewed fixed date range a grant shares support figures over, in the module's own shape.
 *
 * The stored record states the range's first day, last day and currency; it carries no figure, so the
 * range states no measures — a figure is produced when it is read, through the one report function.
 */
function workingFinancialRangeOf(
  record: CoachingGrantRecord,
): Result<CoachingGrant["financialRange"], string> {
  const range = record.financialRange;
  if (range === null) return ok(null);
  const from = civilDateOf(range.from);
  const to = civilDateOf(range.to);
  if (from === null || to === null) return err("a reviewed financial range could not be read");
  return ok({ from, to, measures: [] });
}

/**
 * Adapts a stored grant to the coaching module's working grant, so the episode, the cutoff and the
 * module admission are decided by that module and nowhere else.
 *
 * The stored record states the lifecycle, the five switches, the frozen duration and the reviewed
 * financial range, and it states no acceptance instant and no identity-verification fact. The two are
 * derived here, once, and documented rather than assumed:
 *
 * - `acceptedAt` is the invitation's own issue instant for an episode that was accepted, and absent for
 *   an `invited` or `superseded` one. Every closure except `superseded` follows an acceptance, which is
 *   why a revoked, ended, expired or left relationship still states one: were it absent, the episode would
 *   be refused as `not-accepted` and the closure the worker actually chose would never be named. The
 *   stored state is the acceptance fact; the instant is the earliest the record can state, and it is used
 *   only as the accepted/not-accepted guard.
 * - `identityVerification` is `verified` for an accepted episode and `unverified` otherwise, because in
 *   this synthetic runtime the deliberate acceptance from the named coach's own session is the identity
 *   step, while an invitation nobody accepted has verified nothing. A future identity owner supplies the
 *   real fact at this seam without a read changing.
 */
function toWorkingGrant(record: CoachingGrantRecord): Result<CoachingGrant, string> {
  const issuedAt = instantOf(record.invitation.issuedAt);
  const expiresAt = instantOf(record.invitation.expiresAt);
  if (issuedAt === null || expiresAt === null)
    return err("an invitation instant could not be read");

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

/**
 * The already-resolved authority one admission or module question runs under.
 *
 * `subjectAvailability` is a dimension of the read rather than a lifecycle state: a source that cannot be
 * read makes the module that needs it `unavailable` and leaves the independent ones usable, so the caller
 * states it per module. The permission hold is `none` here because no stored record in this release carries
 * one — a hold belongs to the source that imposes it, and inventing one would report a suspension nobody
 * applied. The module's own vocabulary keeps a hold distinct from an end for the day a source states one.
 */
function accessContextOf(
  actor: "worker" | "coach",
  principalId: string,
  organizationId: string,
  ministryId: string,
  subjectAvailability: "available" | "unavailable",
): CoachingAccessContext {
  return {
    actor: { role: actor, principalId },
    organizationId,
    ministryId,
    subjectAvailability,
    permissionHold: "none",
  };
}

/**
 * The duration an episode states, as a surface reads it: the exclusive bound, which limit decided it,
 * and whether it is open at this instant.
 *
 * The bound is evaluated against the read's own instant every time, so a stored status that still says
 * `active` after its cutoff denies the read, and a temporary hold is reported as itself rather than as
 * an end.
 */
function durationViewOf(episode: {
  readonly duration: GrantDuration;
  readonly cutoffInstant: Temporal.Instant | null;
  readonly boundInstant: Temporal.Instant | null;
  readonly remainingMilliseconds: number | null;
}): CoachingDurationView {
  return {
    kind: episode.duration.kind,
    frozenZone: episode.duration.frozenZone,
    cutoffInstant: episode.cutoffInstant?.toString() ?? null,
    boundedBy: episode.duration.limitedBy,
    boundInstant: episode.boundInstant?.toString() ?? null,
    openAtRead: episode.boundInstant === null || episode.remainingMilliseconds !== null,
    remainingMilliseconds: episode.remainingMilliseconds,
  };
}

// ---------------------------------------------------------------------------------------------
// Adapting a stored target to the coaching module's working target
// ---------------------------------------------------------------------------------------------

/** A target's period in the module's own shape, with a custom range's own days resolved. */
function workingPeriodOf(record: CoachingTargetRecord): Result<TargetPeriod, string> {
  const period = record.period;
  if (period.kind !== "custom") return ok({ kind: period.kind });
  if (period.from === null || period.to === null) return err("a custom period states no range");
  const from = civilDateOf(period.from);
  const to = civilDateOf(period.to);
  if (from === null || to === null) return err("a custom period's range could not be read");
  return ok({ kind: "custom", start: from, end: to });
}

/** One stored version in the module's own shape, its dates resolved and the period left unversioned. */
function workingVersionOf(
  version: CoachingTargetRecord["versions"][number],
): Result<TargetVersion, string> {
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

/**
 * Adapts a stored target to the module's working target.
 *
 * The whole version history travels with it, because a closed period is rendered against the version it
 * was measured against: a later change to quantity, measure or calendar opens a prospective version and
 * never re-renders a period that has already closed.
 */
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

/** The calendar a target's periods are anchored to: its period, and the day that calendar starts on. */
function anchorOf(target: TargetRecord): PeriodAnchor {
  return { period: target.period, calendarStart: target.calendarStart };
}

/** One version as a surface reads it, with its effective boundary stated in civil dates. */
interface TargetVersionView {
  readonly revisionId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly quantity: number;
  readonly measure: TargetMeasure;
  readonly calendarStart: string;
}

/** A version in its serialisable form. */
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

/** One period of a target's calendar, measured against the version that period falls inside. */
interface MeasuredPeriod {
  readonly period: ResolvedPeriod;
  readonly version: TargetVersion | null;
  readonly versionProblem: TargetRefusalReason | null;
  readonly count: number | null;
}

/**
 * One period of a target, with its count from the one activity counter.
 *
 * The version is resolved first: a period that no single version covers is measured against nothing, so
 * its count is `null` and the surface says `unavailable` rather than measuring it against the plan that
 * happens to be current. A period one version does cover is counted by `measureFor`, which credits each
 * activity once, buckets it by its own occurrence date, and counts nothing for a planned meeting, a
 * completed task, a no-show or a click.
 */
function measuredPeriodOf(
  target: TargetRecord,
  activities: readonly ActivityEvent[],
  period: ResolvedPeriod,
): MeasuredPeriod {
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

/**
 * The current period of a target and the one before it, each measured against its own version.
 *
 * The period before is the one the worker most recently closed, so a changed plan is visible as a change:
 * the closed week keeps the quantity it was measured against while the current week carries the new one.
 */
function measuredPeriodsOf(
  target: TargetRecord,
  activities: readonly ActivityEvent[],
  at: Temporal.Instant,
): readonly MeasuredPeriod[] {
  const anchor = anchorOf(target);
  const current = resolveCurrentPeriod(anchor, COACHING_PLANNING_ZONE, at);
  if (!current.ok) return [];
  const periods: MeasuredPeriod[] = [measuredPeriodOf(target, activities, current.value)];
  const previous = resolvePeriodContaining(anchor, current.value.start.subtract({ days: 1 }));
  if (previous.ok) periods.push(measuredPeriodOf(target, activities, previous.value));
  return periods;
}

// ---------------------------------------------------------------------------------------------
// Activity records: the one mapping from what was recorded to what a measure counts
// ---------------------------------------------------------------------------------------------

/**
 * The activity kind an interaction's recorded type names.
 *
 * An interaction states its type as free text, because it is the worker's own description of what
 * happened, while a target counts only the four actual exchanges, in the closed kind set that
 * `modules/coaching/target` owns. This table is the one place the recorded wording is read as a measure,
 * and a type it does not name credits nothing rather than being guessed into one. A plan, a completed
 * task, an opened application, a no-show, a broadcast, an automated reply, an open or a click is not an
 * interaction at all, so none of them can reach this table.
 */
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

/** The activity kind a recorded interaction type names, or `undefined` when it names none. */
function activityKindOf(recordedType: string): ActivityEventKind | undefined {
  return ACTIVITY_KIND_BY_RECORDED_TYPE[recordedType.trim().toLowerCase()];
}

/**
 * When an activity happened, as the record states it, or `null` when the recorded day cannot be read.
 *
 * An honest `unknown` precision carries no date and names no period, so such a record is offered with
 * unknown precision and the counter credits it to no period rather than guessing a day. A dated record
 * whose day cannot be parsed is dropped instead of being credited to today.
 */
function occurrenceOf(interaction: InteractionRecord): ActivityEvent["occurrence"] | null {
  if (interaction.precision === "unknown") return { precision: "unknown" };
  const recorded = interaction.occurredOn;
  if (recorded === null) return null;
  const date = civilDateOf(recorded);
  if (date === null) return null;
  return { precision: interaction.precision, date };
}

/**
 * Every activity record a target may count, in the counter's own event shape.
 *
 * The identities are the interaction identities, which is what makes a credit unique: re-reading,
 * retrying or replaying cannot credit one record twice.
 */
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

// ---------------------------------------------------------------------------------------------
// The support projection a coach's reviewed range is read over
// ---------------------------------------------------------------------------------------------

/** One gift row in the report's own shape, or `null` when one of its days cannot be read. */
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

/**
 * One commitment row in the report's own shape.
 *
 * The shape is taken from the projection the report consumes rather than declared or imported again, so
 * this file holds no second copy of it: a commitment is never added to received support, and this mapping
 * exists only because the projection the report reads carries the rows it was derived from.
 */
type CommitmentRow = SupportProjection["commitments"][number];

/** One commitment row in the report's own shape, or `null` when one of its days cannot be read. */
function commitmentRowOf(record: CommitmentRowRecord): CommitmentRow | null {
  const lastSuccessfulOn =
    record.lastSuccessfulOn === null ? null : civilDateOf(record.lastSuccessfulOn);
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

/**
 * The reason a coach's financial module cannot be read, recorded once in the local diagnostics.
 *
 * The line names the job and the source's opaque identity and nothing else: no amount, no row and no
 * query value has a place in a diagnostic, and a surface states the reason from the returned value.
 */
function unavailableSupportReason(why: string): string {
  logger.sourceUnavailable({
    job: "coaching",
    source: { system: LOCAL_STORE_SYSTEM, reference: SUPPORT_PROJECTION_REFERENCE },
  });
  return `the support source behind this range could not be read: ${why}`;
}

/** A support projection, or the reason it cannot be read at all. */
type SupportLoad =
  | { readonly ok: true; readonly projection: SupportProjection }
  | { readonly ok: false; readonly reason: string };

/**
 * Assembles the read-only projection a coach's reviewed range is reported over.
 *
 * The stored projection states the basis, the currency exponents, the coverage and the as-of instant; its
 * gift and commitment rows are their own stored families, so both are assembled here and never summed,
 * compared or reformatted — `runReport` is the only computation, and a row whose day cannot be read makes
 * the whole source unavailable rather than quietly dropping that row.
 *
 * The goal is deliberately withheld from this projection. A shared goal is not shared financial results,
 * they are two modules with two switches, and a received figure must not be produced with the goal folded
 * into it; the goal is read where it belongs, by the support-goal module, from the stored record alone.
 */
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

// ---------------------------------------------------------------------------------------------
// Shared task summaries
// ---------------------------------------------------------------------------------------------

/** A due date in the shared summary's own shape: dated at its recorded precision, or undated. */
function dueDateOf(task: TaskRecord): TaskSummaryDueDate {
  if (task.dueOn === null) return { kind: "undated" };
  const date = civilDateOf(task.dueOn);
  return date === null ? { kind: "undated" } : { kind: "dated", date, precision: "date" };
}

/** A due date in its serialisable form, so a surface states the day rather than a midnight. */
type TaskDueDateView =
  | { readonly kind: "dated"; readonly date: string; readonly precision: string }
  | { readonly kind: "undated" };

/** A due date as a surface reads it. */
function dueDateViewOf(dueDate: TaskSummaryDueDate): TaskDueDateView {
  return dueDate.kind === "undated"
    ? { kind: "undated" }
    : { kind: "dated", date: serialiseCivilDate(dueDate.date), precision: dueDate.precision };
}

/**
 * One stored share in the coaching module's own shape.
 *
 * The reviewed instant is the recorded one: a share whose reviewed instant cannot be read is reported as
 * unreadable rather than as reviewed now, and the caller treats that as an unavailable source.
 */
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

/** What the task-summaries module holds, as its single read state is decided from it. */
function taskSummaryObservation(states: readonly TaskShareSummaryState[]): ModuleObservation {
  const present = states.filter((state) => state === "shared").length;
  const presence: ModuleContentPresence =
    states.length === 0 ? "none" : present === states.length ? "complete" : "partial";
  return {
    presence,
    withheldUntilReReviewed: states.some((state) => state === "needs-review"),
  };
}

/** The status a shared task states, or `null` when the task behind the share could not be read. */
function taskStatusOf(task: TaskRecord | undefined): TaskStatus | null {
  return task === undefined ? null : task.status;
}

/**
 * The duration a stored grant states, as a surface reads it, whether or not the episode is open.
 *
 * The remaining time is stated only while the bound is still ahead, so a closed window says no number
 * rather than a negative one, and a record that states no usable duration says exactly that.
 */
function statedDurationViewOf(
  duration: GrantDuration | null,
  at: Temporal.Instant,
): CoachingDurationView {
  if (duration === null) {
    return {
      kind: "none",
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
    frozenZone: duration.frozenZone,
    cutoffInstant: duration.cutoffInstant?.toString() ?? null,
    boundedBy: duration.limitedBy,
    boundInstant: bound?.toString() ?? null,
    openAtRead: bound === null || ahead,
    remainingMilliseconds: ahead ? remaining : null,
  };
}

// ---------------------------------------------------------------------------------------------
// readCoachingOverview: the worker's own preparation and sharing situation
// ---------------------------------------------------------------------------------------------

/**
 * One private preparation record as the worker's own surface reads it.
 *
 * A preparation record is a different record class from a shared operational fact: its audience is the
 * literal `private`, it is readable only by the principal whose preparation it is, and nothing in this
 * file copies its text into shared history, an export or another record's audience. The projection is
 * narrowed to the four fields a list needs, so contact details and restrictions are absent from the
 * envelope rather than hidden by a component.
 */
interface PrivatePreparationView {
  readonly preparationId: string;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly revision: string;
}

/**
 * The four facts a coaching relationship must never collapse into one another.
 *
 * An invitation existing, the coach's identity being verified, the invitation being deliberately
 * accepted, and access being live are separate outcomes, and only all of them together make a module
 * readable. An address that matches grants nothing here.
 */
interface CoachingOutcomesView {
  readonly invitationIssued: boolean;
  readonly identityVerified: boolean;
  readonly accepted: boolean;
  readonly accessLive: boolean;
}

/** One coaching relationship as the worker's own surface reads it, in whatever state it stands. */
interface WorkerRelationshipView {
  readonly grantId: string;
  readonly recipientPrincipalId: string;
  readonly ministryIds: readonly string[];
  readonly state: GrantLifecycleState;
  readonly modules: readonly CoachingModuleFlagView[];
  readonly selectedModules: readonly ModuleKey[];
  /** True when the five switches share nothing, which is different from sharing something unused. */
  readonly sharesNothing: boolean;
  readonly duration: CoachingDurationView;
  readonly invitation: {
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly supersededBy: string | null;
    readonly acceptanceWindowOpen: boolean;
  };
  readonly outcomes: CoachingOutcomesView;
  /** Why the episode is not open, in the coaching module's own vocabulary, or `null` when it is. */
  readonly readRefusal: CoachingRefusal | null;
  readonly revision: string;
}

/** What the worker's sharing surface reads: private preparation, and every relationship it holds. */
interface CoachingOverviewView {
  readonly preparation: readonly PrivatePreparationView[];
  readonly relationships: readonly WorkerRelationshipView[];
  readonly activeGrantId: string | null;
  readonly activeModuleCount: number;
}

/**
 * The worker's own preparation and sharing situation.
 *
 * Private preparation is listed as its own record class; each relationship is reported with the five
 * independent module switches (all unselected until the worker switches one on), its duration as a
 * separate fact that is never defaulted, the four acceptance outcomes apart, and the module's own
 * refusal when the episode is not open. A relationship the worker revoked or ended is still theirs to
 * review, and a stale control on it explains itself instead of offering a revival.
 *
 * A relationship lists the ministries the sharing covers, and one made in another ministry is still the
 * worker's own record: it is included, with the ministries it names, rather than hidden because the read
 * was scoped elsewhere — hiding it would hide a closure the worker performed. The envelope's scope states
 * the context the read ran under, and every admitted action is re-checked against the ministry it is
 * submitted in.
 */
export async function readCoachingOverview(): Promise<
  ReadResult<ReadEnvelope<CoachingOverviewView>>
> {
  const loaded = await loadCoachingState();
  if (!loaded.ok) return loaded.result;
  const scoped = workerScope(loaded.context);
  if (!scoped.ok) return scoped.result;

  const { session, state, at } = loaded.context;
  const scope = scoped.scope;

  const preparation = state.partners
    .filter((partner) => partner.kind === "private-preparation" && partner.audience === "private")
    .map((partner): PrivatePreparationView => {
      const visible = project(partner, ["partnerId", "displayName", "tags", "revision"] as const);
      return {
        preparationId: visible.partnerId,
        displayName: visible.displayName,
        tags: visible.tags,
        revision: visible.revision,
      };
    })
    .toSorted((one, two) => one.displayName.localeCompare(two.displayName));

  const relationships: WorkerRelationshipView[] = [];
  const valueStates: Record<string, RecordedValueState> = {};
  let activeGrantId: string | null = null;
  let activeModuleCount = 0;

  for (const record of state.coachingGrants) {
    const decision = canView(session, { kind: "coaching-grant", grant: record, now: at });
    if (!decision.allowed) continue;

    const working = toWorkingGrant(record);
    if (!working.ok) {
      return unavailableRead(
        COACHING_SOURCE_REFERENCE,
        "A coaching relationship could not be read. Nothing is shown for it, and nothing was changed.",
      );
    }

    const ministryId = relationshipMinistryOf(record, scope);
    const admission =
      ministryId === null
        ? null
        : activeGrant(
            working.value,
            accessContextOf(
              "worker",
              session.principalId,
              scope.organizationId,
              ministryId,
              "available",
            ),
            at,
          );
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

    if (episode !== null && activeGrantId === null) {
      activeGrantId = record.grantId;
      activeModuleCount = selectedModules.length;
    }

    const index = relationships.length;
    valueStates[`relationships.${index}.duration.remainingMilliseconds`] = countState(
      episode === null ? null : episode.remainingMilliseconds,
    );

    relationships.push({
      grantId: record.grantId,
      recipientPrincipalId: record.coachPrincipalId,
      ministryIds: [...record.ministryIds],
      state: record.state,
      modules: MODULE_KEYS.map((key) => ({ module: key, selected: record.modules[key] })),
      selectedModules,
      sharesNothing: selectedModules.length === 0,
      duration:
        episode === null
          ? statedDurationViewOf(working.value.duration, at)
          : durationViewOf(episode),
      invitation: {
        issuedAt: record.invitation.issuedAt,
        expiresAt: record.invitation.expiresAt,
        supersededBy: record.invitation.supersededBy,
        acceptanceWindowOpen:
          record.state === "invited" &&
          record.invitation.supersededBy === null &&
          expiresAt !== null &&
          Temporal.Instant.compare(at, expiresAt) < 0,
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

  relationships.sort((one, two) => one.grantId.localeCompare(two.grantId));
  valueStates.activeModuleCount = countState(activeModuleCount);

  const anyLive = relationships.some((relationship) => relationship.outcomes.accessLive);
  const actions: readonly ReadAction[] = [
    actionOf("inviteCoach", true),
    actionOf(
      "setModule",
      anyLive,
      "No live coaching relationship covers this ministry, so no module can be switched.",
    ),
    actionOf(
      "revokeGrant",
      anyLive,
      "No live coaching relationship covers this ministry, so there is nothing to revoke.",
    ),
    actionOf(
      "endCoaching",
      anyLive,
      "No live coaching relationship covers this ministry, so there is nothing to end.",
    ),
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

// ---------------------------------------------------------------------------------------------
// readTargets: the four measures, over the periods the worker set
// ---------------------------------------------------------------------------------------------

/** One period of a target as the worker's own surface reads it. */
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

/** One target as the worker's own surface reads it: the private label, the plan and its periods. */
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

/** What the worker's targets surface reads. */
interface TargetsView {
  readonly targets: readonly WorkerTargetView[];
  readonly measures: readonly TargetMeasure[];
  readonly page: CoachingPageView;
  readonly planningZone: string;
  readonly activityEventsRead: number;
}

/**
 * One target's periods, each measured against the version that period falls inside.
 *
 * The worker's projection is the one that discloses the private label and the Home placement, and it
 * comes from `workerTargetProgress`, so the plan a period was measured against and its state are not
 * computed twice. A target whose periods cannot be resolved still reads, with no period and the state
 * its lifecycle states.
 */
function workerTargetViewOf(
  record: CoachingTargetRecord,
  target: TargetRecord,
  activities: readonly ActivityEvent[],
  at: Temporal.Instant,
): WorkerTargetView {
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
    const state =
      progress === null
        ? resolveTargetState({ target, recorded: entry.count, placement: target.homePlacement })
        : progress.state;

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
 * The worker's own targets, over the four canonical measures only.
 *
 * Every count comes from `measureFor`: a call that contained two conversations stays one call and one
 * conversation, a planned meeting and a completed task count nothing, and a record whose date is unknown
 * is credited to no period. A closed period is measured against the version it fell inside, so a later
 * change to the quantity never re-renders a week that has already closed. The list pages 25 at a time and
 * caps at 100; `total` is the whole-result count, never the window's.
 */
export async function readTargets(
  input: { readonly page?: number; readonly pageSize?: number } = {},
): Promise<ReadResult<ReadEnvelope<TargetsView>>> {
  const loaded = await loadCoachingState();
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
      return unavailableRead(
        COACHING_SOURCE_REFERENCE,
        "A coaching target could not be read. Nothing is shown for it, and nothing was changed.",
      );
    }
    targets.push(workerTargetViewOf(record, working.value, activities, at));
  }

  targets.sort((one, two) => {
    const order = TARGET_MEASURES.indexOf(one.measure) - TARGET_MEASURES.indexOf(two.measure);
    return order === 0 ? one.targetId.localeCompare(two.targetId) : order;
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
      revision: collectionRevision(
        targets.map((target) => ({ id: target.targetId, revision: target.revision })),
      ),
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

/** The earliest day any target's version took effect, as the collection's own coverage boundary. */
function earliestVersionStart(targets: readonly WorkerTargetView[]): string | null {
  const starts = targets.flatMap((target) =>
    target.versions.map((version) => version.effectiveFrom),
  );
  if (starts.length === 0) return null;
  return starts.toSorted((one, two) => one.localeCompare(two)).at(0) ?? null;
}

// ---------------------------------------------------------------------------------------------
// readCheckIns: the worker's private drafts and the revisions they shared
// ---------------------------------------------------------------------------------------------

/** One question as a surface reads it, with the length the limit is measured in. */
interface CheckInQuestionView {
  readonly wording: string;
  readonly order: number;
  readonly scalars: number;
}

/** One answer as a surface reads it, with the length the limit is measured in and no truncation. */
interface CheckInAnswerView {
  readonly questionOrder: number | null;
  readonly text: string;
  readonly scalars: number;
}

/** One limit violation, measured rather than repaired. */
interface CheckInViolationView {
  readonly path: string;
  readonly reason: string;
  readonly measured: number;
  readonly limit: number;
  readonly message: string;
}

/** How a check-in's content measures against the four fixed limits, as the surface shows them. */
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

/**
 * The worker's own working revision: autosaved, and never readable by a coach on its own.
 *
 * It carries its own revision identity, which is what keeps it visibly different from a shared revision:
 * autosave touches this one only, and only an explicit Share produces the other.
 */
interface PrivateDraftView {
  readonly revisionId: string;
  readonly questionsCapturedAt: string;
  readonly savedAt: string;
  readonly questions: readonly CheckInQuestionView[];
  readonly answers: readonly CheckInAnswerView[];
  readonly measurements: CheckInMeasurementsView;
}

/** The revision a named coach may read, created by an explicit Share and changed only by an update. */
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

/** One check-in as the worker's own surface reads it. */
interface WorkerCheckInView {
  readonly checkInId: string;
  readonly grantId: string;
  readonly state: CheckInState;
  readonly revision: string;
  readonly privateDraft: PrivateDraftView | null;
  readonly shared: SharedRevisionView | null;
  readonly draftAndSharedDiffer: boolean;
}

/** What the worker's check-ins surface reads. */
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

/** The Unicode scalar values in a string, which is the unit the check-in limits are stated in. */
function scalarCountOf(value: string): number {
  return [...value].length;
}

/** UTF-8 encoder for the request ceiling, built once because it holds no state between calls. */
const UTF8_ENCODER = new TextEncoder();

/**
 * How one check-in's content measures against the four limits, and every violation found.
 *
 * The measurement is reported, never applied: an answer of 4,001 scalars is refused by the domain's own
 * validator with its count shown, and nothing here shortens, trims or reflows what the worker wrote. The
 * serialised request's byte length is measured with the same encoder the domain validator uses, so a
 * surface can state how close a request stands to the ceiling it will be refused at.
 */
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

/** Questions in their serialisable form, each with the scalar count the limit measures. */
function questionViewsOf(questions: readonly CheckInQuestion[]): readonly CheckInQuestionView[] {
  return questions.map((question) => ({
    wording: question.wording,
    order: question.order,
    scalars: scalarCountOf(question.wording),
  }));
}

/** Answers in their serialisable form, each with the scalar count the limit measures. */
function answerViewsOf(answers: readonly CheckInAnswer[]): readonly CheckInAnswerView[] {
  return answers.map((answer) => ({
    questionOrder: answer.questionOrder,
    text: answer.text,
    scalars: scalarCountOf(answer.text),
  }));
}

/** Whether a private draft and a shared revision hold different content, as two identities. */
function draftDiffersFromShared(
  draft: PrivateDraftView | null,
  shared: SharedRevisionView | null,
): boolean {
  if (draft === null || shared === null) return false;
  if (draft.revisionId === shared.revisionId) return false;
  const draftAnswers = draft.answers.map((answer) => `${answer.questionOrder}:${answer.text}`);
  const sharedAnswers = shared.answers.map((answer) => `${answer.questionOrder}:${answer.text}`);
  return draftAnswers.join("\u0000") !== sharedAnswers.join("\u0000");
}

/**
 * The worker's private check-ins, their captured question sets and the revisions they shared.
 *
 * The question set a coach may read is the one captured when the editor started, not the one on screen
 * now, so a later edit cannot rewrite what was shared. The private draft and the shared revision are two
 * identities with two revisions, and they are reported apart. The four limits are measured and reported
 * on every check-in and are never applied here: a value over a limit is refused when it is written, with
 * its count shown, because a shortened answer would misstate what the worker wrote. Withdrawal is a state
 * of this record, so it works while an unrelated draft elsewhere in the application is invalid.
 */
export async function readCheckIns(
  input: { readonly page?: number; readonly pageSize?: number } = {},
): Promise<ReadResult<ReadEnvelope<CheckInsView>>> {
  const loaded = await loadCoachingState();
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
      return unavailableRead(
        COACHING_SOURCE_REFERENCE,
        "A check-in could not be read. Nothing is shown for it, and nothing was changed.",
      );
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

  checkIns.sort((one, two) => one.checkInId.localeCompare(two.checkInId));
  const paged = pageOf(checkIns, input.page, input.pageSize);
  paged.items.forEach((checkIn, index) => {
    valueStates[`checkIns.${index}.answers`] = countState(
      checkIn.privateDraft === null
        ? (checkIn.shared?.answers.length ?? null)
        : checkIn.privateDraft.answers.length,
    );
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
      revision: collectionRevision(
        checkIns.map((checkIn) => ({ id: checkIn.checkInId, revision: checkIn.revision })),
      ),
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
          checkIns.some(
            (checkIn) => checkIn.shared !== null && checkIn.shared.withdrawnAt === null,
          ),
          "No check-in has a shared revision to update.",
        ),
        actionOf(
          "withdrawCheckIn",
          checkIns.some(
            (checkIn) => checkIn.shared !== null && checkIn.shared.withdrawnAt === null,
          ),
          "No check-in has a shared revision to withdraw.",
        ),
      ],
    }),
  };
}

/** The worker's private draft as a surface reads it, or `null` when nothing is autosaved yet. */
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

/** The shared revision as a surface reads it, or `null` when nothing has been shared. */
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

/**
 * The share-through day a frozen cutoff implies, in the zone it was frozen in.
 *
 * A cutoff is the exclusive start of the civil day after the Share-through date, so the recorded instant
 * and zone name that day exactly: the day the cutoff falls on, less one. Deriving it here keeps the
 * calendar rule in `modules/time` and never invents a day the record does not state.
 */
function workingShareDurationOf(
  duration: CoachingDurationRecord,
): Result<CheckInShareDuration, string> {
  if (duration.kind === "ongoing") return ok({ kind: "ongoing" });
  const cutoff = duration.cutoffInstant === null ? null : instantOf(duration.cutoffInstant);
  if (cutoff === null) return err("a shared revision's cutoff could not be read");
  const dayOfCutoff = civilDateAt(cutoff, duration.frozenZone);
  if (dayOfCutoff.status === "refused") {
    return err("a shared revision's frozen zone could not be resolved");
  }
  return ok({ kind: "through-date", throughOn: dayOfCutoff.date.subtract({ days: 1 }) });
}

/**
 * One stored check-in in the coaching module's own shape, so its read state is decided there.
 *
 * The four states stay four answers: a check-in nobody shared yet is a private draft, one with a shared
 * revision is shared, one whose share was withdrawn is withdrawn, and an unreadable record is
 * unavailable — never an empty check-in. A record whose instants or zone cannot be read is reported as
 * unreadable rather than being given the instant the read happened to run at.
 */
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
    const withdrawnAt =
      sharedRecord.withdrawnAt === null ? null : instantOf(sharedRecord.withdrawnAt);
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

// ---------------------------------------------------------------------------------------------
// readTaskShares: the reviewed summaries a worker selected
// ---------------------------------------------------------------------------------------------

/**
 * One share as the worker's own surface reads it.
 *
 * The description appears only when the reviewed summary is current. When the task's reviewed meaning has
 * changed the summary is withheld completely — not returned with a warning, not partly returned and not
 * guessable — and the share states that a reviewer must review it again before any of it is shown.
 */
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

/** What the worker's shared-task surface reads. */
interface TaskSharesView {
  readonly shares: readonly WorkerTaskShareView[];
  readonly page: CoachingPageView;
  readonly maxCodePoints: number;
  readonly sharesNothing: boolean;
}

/**
 * The task summaries the worker selected for sharing, and how each one stands now.
 *
 * A share covers one occurrence of one task, so a recurring task's next occurrence needs a fresh
 * selection rather than inheriting this one. The coach-readable content is exactly three things — the
 * reviewed description, the task's live due date and its live status — and the description is the only
 * field able to carry text, so no field here could hold the task's own name, its body, a donor, an amount,
 * an attachment, a link or a private history. Stopping a share leaves the task intact and claims no recall
 * of what was already seen, and completing a share's task proves nothing about contact or payment.
 */
export async function readTaskShares(
  input: { readonly page?: number; readonly pageSize?: number } = {},
): Promise<ReadResult<ReadEnvelope<TaskSharesView>>> {
  const loaded = await loadCoachingState();
  if (!loaded.ok) return loaded.result;
  const scoped = workerScope(loaded.context);
  if (!scoped.ok) return scoped.result;

  const { session, state, at } = loaded.context;
  const valueStates: Record<string, RecordedValueState> = {};
  const shares: WorkerTaskShareView[] = [];

  for (const stored of state.coachingTaskShares ?? []) {
    const task = state.tasks.find(
      (candidate) =>
        candidate.taskId === stored.taskId && candidate.ownerPrincipalId === session.principalId,
    );
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
      working === null ||
      task === undefined ||
      shareState === "removed" ||
      shareState === "unavailable"
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
    const currentSummary =
      summaryResult !== null && summaryResult.state === "shared" ? summaryResult : null;
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

  shares.sort((one, two) => one.shareId.localeCompare(two.shareId));
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
      revision: collectionRevision(
        shares.map((share) => ({ id: share.shareId, revision: String(share.revision) })),
      ),
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

// ---------------------------------------------------------------------------------------------
// readCoachPortfolio: authorise before enumerating
// ---------------------------------------------------------------------------------------------

/** One subject a coach holds an open grant for, with the modules admitted at this instant. */
interface CoachPortfolioSubjectView {
  readonly grantId: string;
  readonly workerPrincipalId: string;
  readonly ministryId: string;
  readonly duration: CoachingDurationView;
  readonly admittedModules: readonly CoachingModuleAdmissionView[];
  readonly revision: string;
}

/**
 * What a coach's portfolio reads.
 *
 * There is no portfolio-wide figure of any kind: no sum, no ranking, no effort score and no private
 * snippet shared between subjects, because each subject's numbers exist only inside that subject's own
 * admitted modules. `holdsNoSubjects` states an authorised empty portfolio, which is not an error and not
 * a disclosure about grants other coaches hold.
 */
interface CoachPortfolioView {
  readonly subjects: readonly CoachPortfolioSubjectView[];
  readonly holdsNoSubjects: boolean;
}

/**
 * The authority a portfolio read states when no subject has been admitted.
 *
 * The ministry a portfolio is read under is one the coach's own grants cover. When the coach holds no
 * grant at all there is no such ministry, so the read states a portfolio marker instead of borrowing a
 * ministry it was never granted; the marker is opaque, is never parsed, and can never equal a ministry an
 * admitted worker reads.
 */
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

/**
 * The subjects this coach holds an open, in-cutoff grant for.
 *
 * The read authorises before it enumerates: a grant the coach does not hold, a closure (`revoked`,
 * `ended`, `left`, `expired`, `superseded`) and a window whose frozen bound has been reached are all
 * omitted before any record is looked at, so a subject appears only while it is readable. The cutoff is
 * evaluated against this read's own instant, so a status row that still says `active` after its bound
 * grants nothing. An ended relationship is therefore absent here rather than reported as an unavailable
 * module, and an empty result is an authorised empty list rather than an error.
 */
export async function readCoachPortfolio(): Promise<ReadResult<ReadEnvelope<CoachPortfolioView>>> {
  const loaded = await loadCoachingState();
  if (!loaded.ok) return loaded.result;

  const { session, state, at } = loaded.context;
  const subjects: CoachPortfolioSubjectView[] = [];
  const valueStates: Record<string, RecordedValueState> = {};
  let invitationOutstanding = false;

  for (const record of state.coachingGrants) {
    if (record.coachPrincipalId !== session.principalId) continue;
    const expiresAt = instantOf(record.invitation.expiresAt);
    if (
      record.state === "invited" &&
      record.invitation.supersededBy === null &&
      expiresAt !== null &&
      Temporal.Instant.compare(at, expiresAt) < 0
    ) {
      invitationOutstanding = true;
    }

    if (!canView(session, { kind: "coaching-grant", grant: record, now: at }).allowed) continue;
    const working = toWorkingGrant(record);
    if (!working.ok) continue;

    for (const ministryId of working.value.ministryIds) {
      const authority = coachScope(session, ministryId);
      const episode = activeGrant(
        working.value,
        accessContextOf(
          "coach",
          session.principalId,
          authority.organizationId,
          ministryId,
          "available",
        ),
        at,
      );
      if (!episode.ok) continue;

      const index = subjects.length;
      const admittedModules = episode.value.admittedModules.map((module) => ({
        module,
        until: episode.value.boundInstant?.toString() ?? null,
        remainingMilliseconds: episode.value.remainingMilliseconds,
      }));
      valueStates[`subjects.${index}.remainingMilliseconds`] = countState(
        episode.value.remainingMilliseconds,
      );
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
    const byMinistry = one.ministryId.localeCompare(two.ministryId);
    return byMinistry === 0 ? one.grantId.localeCompare(two.grantId) : byMinistry;
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
      revision: collectionRevision(
        subjects.map((subject) => ({ id: subject.grantId, revision: subject.revision })),
      ),
      asOf: at.toString(),
      coverage: coverageOf(null, at),
      valueStates,
      actions: [
        actionOf(
          "acceptInvitation",
          invitationOutstanding,
          "No invitation addressed to you is awaiting acceptance.",
        ),
        actionOf(
          "leaveCoaching",
          subjects.length > 0,
          "No coaching relationship of yours is open to leave.",
        ),
      ],
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// readCoachSubject: the module-scoped read
// ---------------------------------------------------------------------------------------------

/** One target as a coach reads it: the plan a period was measured against, its count and its state. */
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

/** One shared check-in as a coach reads it: the revision that was shared, and never the private draft. */
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

/**
 * One shared task summary as a coach reads it.
 *
 * Three fields can carry content and no more: the reviewed description, the task's live due date and its
 * live status. The description is `null` unless the reviewed summary is current, so a changed meaning
 * withholds it completely; no field here could hold the task's own name, its body, a donor, an amount, an
 * attachment, a link or a private history.
 */
interface CoachTaskSummaryView {
  readonly shareId: string;
  readonly state: TaskShareSummaryState;
  readonly description: string | null;
  readonly dueDate: TaskDueDateView | null;
  readonly status: TaskStatus | null;
}

/** One support goal as a coach reads it: the amount and the measure, and no results figure beside it. */
interface CoachGoalView {
  readonly amount: Money;
  readonly exponent: number | null;
  readonly measure: string;
  readonly effectiveFrom: string;
  readonly valueState: RecordedValueState;
}

/** One received figure over a reviewed fixed range: one currency, its exact minor units and its state. */
interface CoachReceivedFigureView {
  readonly currency: string;
  readonly exponent: number | null;
  readonly minorUnits: number | null;
  readonly valueState: ValueState;
  readonly from: string;
  readonly to: string;
  readonly periodState: string;
}

/** What every admitted module states, whatever it holds. */
interface CoachModuleViewBase {
  readonly module: ModuleKey;
  /** The single state a module stands in, or `null` when nothing stands beside its content. */
  readonly state: ModuleReadState | null;
  /** Why the module's source could not be read, or `null` when it could. */
  readonly unavailability: string | null;
}

/** The targets module: the four measures over the periods the worker set. */
interface CoachTargetsModuleView extends CoachModuleViewBase {
  readonly module: "targets";
  readonly progress: readonly CoachTargetProgressView[];
}

/** The check-ins module: the shared revisions only. */
interface CoachCheckInsModuleView extends CoachModuleViewBase {
  readonly module: "check-ins";
  readonly sharedCheckIns: readonly CoachSharedCheckInView[];
}

/** The task-summaries module: the reviewed safe descriptions only. */
interface CoachTaskSummariesModuleView extends CoachModuleViewBase {
  readonly module: "task-summaries";
  readonly summaries: readonly CoachTaskSummaryView[];
}

/** The support-goal module: the goal, which is a separate module from the results. */
interface CoachGoalModuleView extends CoachModuleViewBase {
  readonly module: "support-goal";
  readonly goal: CoachGoalView | null;
}

/** The support-results module: one reviewed fixed range, one figure per currency, no drilldown. */
interface CoachResultsModuleView extends CoachModuleViewBase {
  readonly module: "support-results";
  readonly basis: string;
  readonly basisDescription: string;
  readonly range: { readonly from: string; readonly to: string; readonly currency: string } | null;
  readonly received: readonly CoachReceivedFigureView[];
  /**
   * Why no figure is stated, or `null` when one is. An empty `received` list is never left to speak for
   * itself: a range that produced no figure says so, because an empty list would read as a genuine zero.
   */
  readonly figureProblem: string | null;
}

/** One admitted module as a coach reads it. An unadmitted module is absent and has no member here. */
type CoachModuleView =
  | CoachTargetsModuleView
  | CoachCheckInsModuleView
  | CoachTaskSummariesModuleView
  | CoachGoalModuleView
  | CoachResultsModuleView;

/** What a coach's read of one subject states. */
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
  /** True when the grant shares no module at all, which is different from a module with nothing in it. */
  readonly sharesNothing: boolean;
  readonly revision: string;
}

/** Whether a module reports money, and therefore needs the support source to be readable. */
function isFinancialModule(module: ModuleKey): boolean {
  return module === "support-goal" || module === "support-results";
}

/** One received figure over the grant's reviewed range, through the one report function. */
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

/** What one module's content looks like before its read state is decided, per admitted module. */
function observationOf(
  module: ModuleKey,
  state: CoachingState,
  support: SupportLoad,
): ModuleObservation {
  switch (module) {
    case "targets": {
      const presence: ModuleContentPresence =
        state.coachingTargets.length === 0 ? "none" : "complete";
      return { presence, withheldUntilReReviewed: false };
    }
    case "check-ins": {
      const shared = state.coachingCheckIns.filter(
        (checkIn) => checkIn.shared !== null && checkIn.shared.withdrawnAt === null,
      );
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
      if (!support.ok) return { presence: "none", withheldUntilReReviewed: false };
      return {
        presence: storedGoalOf(state) === null ? "none" : "complete",
        withheldUntilReReviewed: false,
      };
    }
    case "support-results": {
      if (!support.ok) return { presence: "none", withheldUntilReReviewed: false };
      return {
        presence: support.projection.gifts.length === 0 ? "none" : "complete",
        withheldUntilReReviewed: false,
      };
    }
    default:
      return { presence: "none", withheldUntilReReviewed: false };
  }
}

/** The single state one stored share stands in, from the task it summarises as it stands now. */
function taskShareSummaryStateOf(
  share: StoredCoachingTaskShare,
  tasks: readonly TaskRecord[],
): TaskShareSummaryState {
  const working = workingShareOf(share);
  const task = tasks.find((candidate) => candidate.taskId === share.taskId);
  if (working === null) return "unavailable";
  return taskShareReadState({
    share: working,
    currentFingerprint: task === undefined ? undefined : taskReviewedFingerprint(task),
    sourceAvailable: task !== undefined,
  });
}

/** One subject's targets as a coach reads them, measured against the version each period fell inside. */
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
      valueStates[`modules.${moduleIndex}.progress.${progress.length}.count`] = countState(
        view.count,
      );
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

/** One subject's shared check-ins as a coach reads them: the shared revision, never the private draft. */
function coachSharedCheckInsOf(
  state: CoachingState,
  grantId: string,
): readonly CoachSharedCheckInView[] {
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

/** One subject's shared task summaries as a coach reads them. */
function coachTaskSummariesOf(
  state: CoachingState,
  workerPrincipalId: string,
): readonly CoachTaskSummaryView[] {
  const summaries: CoachTaskSummaryView[] = [];
  for (const stored of state.coachingTaskShares ?? []) {
    const task = state.tasks.find(
      (candidate) =>
        candidate.taskId === stored.taskId && candidate.ownerPrincipalId === workerPrincipalId,
    );
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
    const current =
      summary !== null && summary.ok && summary.value.state === "shared" ? summary.value : null;

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

/** The goal a coach is admitted to read, from the stored projection record alone. */
function storedGoalOf(state: CoachingState): SupportProjectionRecord["goal"] {
  return state.supportProjection === null ? null : state.supportProjection.goal;
}

/** The goal as a coach reads it: the amount, its exponent and the measure it counts. */
function coachGoalOf(state: CoachingState): CoachGoalView | null {
  const goal = storedGoalOf(state);
  if (goal === null) return null;
  const exponent = exponentOf(goal.amount.currency);
  return {
    amount: goal.amount,
    exponent: exponent ?? null,
    measure: goal.measure,
    effectiveFrom: goal.effectiveFrom,
    valueState:
      exponent === undefined ? "unknown" : goal.amount.minorUnits === 0 ? "zero" : "value",
  };
}

/**
 * One subject's admitted modules, and nothing about the ones the worker never shared.
 *
 * The module set is the grant's own five switches, so an unshared module is absent from this list rather
 * than present and empty: a coach cannot learn from its shape that it exists, and its name is never
 * returned. Each admitted module is then decided by `moduleReadState`, which yields exactly one of the five
 * states — or nothing, when the module's content is complete and needs no caveat — and one unavailable
 * source leaves the independent modules usable.
 */
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
    const financial = isFinancialModule(key);
    const availability = financial && !support.ok ? "unavailable" : "available";
    const decision = moduleReadState(
      working,
      key,
      accessContextOf(
        "coach",
        session.principalId,
        scope.organizationId,
        scope.ministryId,
        availability,
      ),
      at,
      observationOf(key, state, support),
    );
    if (!decision.ok) continue;

    const base = {
      state: decision.value,
      unavailability: financial && !support.ok ? support.reason : null,
    };
    const index = views.length;

    switch (key) {
      case "targets":
        views.push({
          module: key,
          ...base,
          progress: coachTargetProgressOf(
            state,
            activities,
            at,
            valueStates,
            index,
            working.workerPrincipalId,
          ),
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
        views.push({ module: key, ...base, goal: support.ok ? coachGoalOf(state) : null });
        break;
      case "support-results": {
        const range = reviewedRangeOf(record);
        const figures =
          support.ok && range !== null ? receivedFiguresOf(support.projection, range, scope) : null;
        const figureProblem =
          figures !== null && !figures.ok
            ? figures.error
            : range === null
              ? "no reviewed range is recorded"
              : null;
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

/** The reviewed fixed range a subject's figures are reported over, as a surface states it. */
function reviewedRangeOf(record: CoachingGrantRecord): {
  readonly from: string;
  readonly to: string;
  readonly currency: string;
} | null {
  const range = record.financialRange;
  return range === null ? null : { from: range.from, to: range.to, currency: range.currency };
}

/**
 * One subject's admitted modules, as a coach reads them.
 *
 * Authorisation runs first: the grant must be one this coach holds, the relationship must be live and
 * inside its frozen bound, and the ministry must be one the grant covers. Only then is anything
 * enumerated, which is why a refusal here carries no module name, no count and no existence flag. An
 * ended relationship is denied as a whole — it is not an empty portfolio and not an unavailable module —
 * and a temporary hold is not reported as an end.
 */
export async function readCoachSubject(input: {
  readonly grantId: string;
}): Promise<ReadResult<ReadEnvelope<CoachSubjectView>>> {
  const loaded = await loadCoachingState();
  if (!loaded.ok) return loaded.result;

  const context = loaded.context;
  const { session, state, at } = context;
  if (!isNonEmptyString(input.grantId)) return deniedRead("no-permission");

  const record = state.coachingGrants.find(
    (grant) => grant.grantId === input.grantId && grant.coachPrincipalId === session.principalId,
  );
  if (record === undefined) return deniedRead("no-permission");
  if (!canView(session, { kind: "coaching-grant", grant: record, now: at }).allowed) {
    return deniedRead("no-permission");
  }

  const working = toWorkingGrant(record);
  if (!working.ok) {
    return unavailableRead(
      COACHING_SOURCE_REFERENCE,
      "This coaching relationship could not be read. Nothing is shown, and nothing was changed.",
    );
  }

  let episode: {
    readonly scope: Scope;
    readonly admitted: readonly ModuleKey[];
    readonly duration: CoachingDurationView;
  } | null = null;
  for (const ministryId of working.value.ministryIds) {
    const authority = coachScope(session, ministryId);
    const admission = activeGrant(
      working.value,
      accessContextOf(
        "coach",
        session.principalId,
        authority.organizationId,
        ministryId,
        "available",
      ),
      at,
    );
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
  const support: SupportLoad = wantsSupport
    ? supportProjectionOf(state)
    : { ok: false, reason: "no financial module is shared with this coach" };
  const valueStates: Record<string, RecordedValueState> = {};
  const modules = coachModulesOf(
    context,
    working.value,
    record,
    openEpisode.scope,
    openEpisode.admitted,
    support,
    valueStates,
  );
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
        actionOf(
          "acceptInvitation",
          record.state === "invited",
          "This invitation was already accepted, so there is nothing to accept.",
        ),
        actionOf(
          "leaveCoaching",
          record.state === "active" || record.state === "accepted",
          "This relationship is not open, so there is nothing to leave.",
        ),
      ],
    }),
  };
}
