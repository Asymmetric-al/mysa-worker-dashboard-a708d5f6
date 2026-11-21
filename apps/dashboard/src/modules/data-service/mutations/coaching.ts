/**
 * The sixteen named coaching mutations: the invitation and the episode it opens, the worker's own
 * targets, the check-ins a coach may be shown, and the reviewed task summaries.
 *
 * **What this file is.** One named mutation per visible job, in the order AAP 0.7.1 lists them under
 * "Prepare and share with a coach" and "Read as a coach": `inviteCoach`, `acceptInvitation`,
 * `revokeGrant`, `endCoaching`, `leaveCoaching`, `setModule`, `saveTarget`, `editTarget`,
 * `pauseTarget`, `endTarget`, `saveCheckIn`, `shareCheckIn`, `updateSharedCheckIn`,
 * `withdrawCheckIn`, `shareTaskSummary`, `stopTaskShare`. There is no seventeenth, no dispatcher and
 * no field-level create/update/delete layer: a mutation that needed a new effect would be a new name
 * here.
 *
 * **What it delegates.** Every request runs through `runMutation` in `../operations`, which owns the
 * one order of validate → authorise → replay → revision → apply → record. Each mutation below supplies
 * exactly three things of its own: one concrete Zod schema for its payload, one `readCurrent` locator
 * where it changes an existing record, and one `apply` that calls the coaching domain module and writes
 * the stored record. Nothing here compares a revision, writes a ledger entry, opens a transaction,
 * reads a clock other than `now()`, or resolves a window boundary that `@/modules/time` owns. The grant
 * episode, the frozen cutoff, the five modules, the four measures, the version history, the check-in
 * capture and the safe summary are all decided by `@/modules/coaching/{grant,target,checkin,taskshare}`;
 * this file supplies the stored record and the caller's principal, and records what those modules
 * decided.
 *
 * **Where the authority of these mutations lives.** The runner establishes the session, the admitting
 * state and the claimed scope before anything is read, and answers a refusal that names the caller's
 * relationship and nothing it asked about. What is left to decide is whether *this record* admits
 * *this caller*: whether the caller is the worker who owns the relationship or the coach it names,
 * whether the episode is still open at the scenario clock, and whether the value presented is current.
 * Those questions can only be answered from the record, which is readable inside the transaction and
 * nowhere else, so the per-mutation `authorize` states the one thing the scope assertion already
 * settled and `apply` answers `denied` — never a count, a title, an existence flag or a module name —
 * when the record does not admit the caller.
 *
 * **Two authorities, kept apart.** A worker acts under a ministry membership; a coach holds no
 * membership and must not be given one, so the coach's two writes (`acceptInvitation`,
 * `leaveCoaching`) declare `scopeAuthority: "grant"` and are authorised against the grant itself. The
 * scope they claim must still name the coach's own principal, the session must still be admitting, and
 * the change must still keep the scope it started from.
 *
 * **Private stays private.** A target's `privateLabel`, a private check-in draft, and a task's title,
 * note, donor, amount and history are never written into a share. `setModule` switches a disclosure on
 * or off; it never copies a record. Sharing a check-in creates a shared revision beside the private one
 * and changes nothing else: no notification, no interaction, no task. Sharing a task summary stores the
 * reviewed description, its measured length, the live-value fingerprint it was reviewed against and
 * nothing else. Nothing in this file logs a label, a check-in text or a description, and no result it
 * returns carries one.
 *
 * **Payload shapes.** Each schema accepts the payload the coaching surfaces submit (`../features/coaching`
 * composes them) and the names AAP 0.6.1 uses where the two differ, normalised once inside the schema:
 * `recipientPrincipalId`/`ministryIds` and `coachPrincipalId`/`ministryId`, `module` and `moduleKey`,
 * `shareId` and `taskShareId`. Every object is strict, so an unknown key is refused rather than dropped,
 * and no envelope field (`operationId`, `scope`, `expectedRevision`) is declared here.
 *
 * **Rule 1 obligations.** Clause 1: only these sixteen effects, with no integration, reminder job,
 * provider client, cohort aggregate or scaffolding for a deferred capability. Clause 2: one runner, one
 * ledger, one schema per mutation, one outcome union, and the domain's rules called rather than copied.
 * Clause 3: private and shared stay distinct, ended and unavailable stay distinct, a revoked or ended
 * episode cannot be revived by a stale action, an undetermined effect stays `unknown` and is recovered by
 * its `operationId`.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import {
  savePrivateDraft,
  shareCheckIn as openCheckInShare,
  updateSharedCheckIn as reviseSharedCheckIn,
  withdrawSharedCheckIn,
  type CheckIn,
  type CheckInAnswer,
  type CheckInPayload,
  type CheckInRefusal,
  type CheckInShareDuration,
  type CheckInSharedRevision,
} from "@/modules/coaching/checkin";
import {
  MODULE_KEYS,
  acceptGrant,
  activeGrant,
  endGrant,
  freezeShareDuration,
  inviteGrant,
  leaveGrant,
  revokeGrant as revokeCoachingGrant,
  setModuleSelection,
  type CoachingAccessContext,
  type CoachingGrant,
  type CoachingRefusal,
  type GrantDuration,
  type ModuleKey,
  type ModuleSelection,
  type ShareDuration,
} from "@/modules/coaching/grant";
import {
  TARGET_MEASURES,
  resolvePeriodContaining,
  startProspectiveVersion,
  type PeriodAnchor,
  type TargetMeasure,
  type TargetPeriod,
  type TargetVersion,
} from "@/modules/coaching/target";
import {
  reviewTaskSummary,
  stopTaskShare as stopCoachingTaskShare,
  type TaskShare,
  type TaskShareRefusal,
} from "@/modules/coaching/taskshare";
import {
  parseCivilDate,
  serialiseCivilDate,
  todayInZone,
  type CivilDate,
} from "@/modules/time/civil";
import { now } from "@/modules/time/clock";
import { shareThroughDateOfCutoff } from "@/modules/time/window";

import {
  outcomeOfRefusal,
  resolveSession,
  type ScopeDecision,
  type SessionSource,
} from "../authorize";
import {
  coachingCheckInRecordSchema,
  coachingGrantRecordSchema,
  coachingTaskShareRecordSchema,
  coachingTargetRecordSchema,
  ministryIdSchema,
  principalIdSchema,
  taskRecordSchema,
  taskReviewedFingerprint,
  type CoachingCheckInRecord,
  type CoachingDurationRecord,
  type CoachingGrantRecord,
  type CoachingTaskShareRecord,
  type CoachingTargetRecord,
  type MutationInput,
  type Scope,
  type TaskRecord,
} from "../envelope";
import {
  runMutation,
  type ApplyResult,
  type CurrentTarget,
  type MutationContext,
} from "../operations";
import {
  LOCAL_STORE_SYSTEM,
  ROOT_FIELD_KEY,
  conflict,
  denied,
  invalid,
  unavailable,
  type FieldMessages,
  type JsonValue,
  type MutationOutcome,
} from "../outcome";

// ---------------------------------------------------------------------------------------------
// The values this synthetic runtime declares once
// ---------------------------------------------------------------------------------------------

/**
 * The source-approved zone a share cutoff is resolved in.
 *
 * A payload never carries a zone: a client-supplied one would let a display change move a boundary that
 * is meant to be frozen. The synthetic source declares the zone once, here, and the seeded relationships
 * record the same zone, so an invitation made through this mutation and one laid down by the seed freeze
 * their cutoffs in the same calendar.
 */
const SHARE_SOURCE_ZONE = "Europe/London";

/**
 * The zone a target's weekly and monthly periods are bucketed in.
 *
 * A period is a civil-day bucket and a target stores a calendar start rather than a zone, so one zone is
 * declared for the whole application. UTC is that declaration, matching the coaching reads, so the same
 * target resolves to the same dates on every machine and no reader's display zone moves a boundary.
 */
const TARGET_PLANNING_ZONE = "UTC";

/** The reference a state document that cannot be read is reported under. */
const STATE_DOCUMENT_REFERENCE = "session-state";

/**
 * What a mutation says when the session's own records cannot be read.
 *
 * It never offers to try the write again: an unreadable document means the effect is unknown, so the
 * guidance names the recovery that rebuilds the documents rather than repeating the change.
 */
const STATE_UNAVAILABLE_GUIDANCE =
  "This session's coaching records could not be read. Reload the page; if they stay unreadable, reset the development seed, which rebuilds the session documents deterministically.";

/**
 * The authority every mutation in this file answers with before its transaction opens.
 *
 * The session, its admitting state and the claimed scope are settled by the runner, and the question
 * that remains — does this record admit this caller — is answerable only from the record, which is
 * readable inside the transaction. `apply` answers it, with a denial that names no record.
 */
const SCOPE_ESTABLISHED: ScopeDecision = { ok: true };

// ---------------------------------------------------------------------------------------------
// Small values: revisions, instants and calendar days
// ---------------------------------------------------------------------------------------------

/**
 * The ordinal a stored revision token states.
 *
 * A stored revision is an opaque token (`"rev-1"`), while the coaching modules guard their transitions
 * with a whole number. The digits of the token are read as that number, and a token with none counts as
 * the record's first state; the token is what the caller presents back, and it is compared as a string
 * by the runner before any of this runs.
 */
function revisionOrdinalOf(token: string): number {
  const digits = /(\d+)\s*$/u.exec(token);
  if (digits === null) return 1;
  const parsed = Number.parseInt(digits[1] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** The ordinal a revision the caller presented states, whether it arrived as a number or as a token. */
function revisionOrdinalOfValue(value: number | string): number {
  return typeof value === "number" ? value : revisionOrdinalOf(value);
}

/** The token a record stands at one change later than the token given. */
function nextRevisionTokenOf(token: string): string {
  return `rev-${String(revisionOrdinalOf(token) + 1)}`;
}

/** The first revision token of a record this file creates. */
const FIRST_REVISION = "rev-1";

/** Reads a stored instant, or `null` when the value is not one this runtime can resolve. */
function instantOf(value: string): Temporal.Instant | null {
  try {
    return Temporal.Instant.from(value);
  } catch {
    return null;
  }
}

/** Reads a stored or submitted civil date, or `null` when the value names no day. */
function civilDateOf(value: string): CivilDate | null {
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : null;
}

/** The scenario day in the planning zone, or `null` when that zone cannot be resolved. */
function planningToday(at: Temporal.Instant): CivilDate | null {
  const today = todayInZone(TARGET_PLANNING_ZONE, at);
  return today.status === "resolved" ? today.date : null;
}

/** The attempt identity a request that states no usable one is answered under. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/** The attempt identity a request carries, read without trusting its type. */
function attemptIdOf(input: unknown): string {
  if (typeof input !== "object" || input === null) return UNIDENTIFIED_ATTEMPT;
  const candidate: unknown = Reflect.get(input, "operationId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : UNIDENTIFIED_ATTEMPT;
}

// ---------------------------------------------------------------------------------------------
// The session a mutation acts for
// ---------------------------------------------------------------------------------------------

/** The session a mutation runs under, or the refusal that ends the attempt. */
type SessionForMutation =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly outcome: MutationOutcome };

/**
 * The session id the runner is asked to act for.
 *
 * The browser path carries the development-session cookie, which the runner resolves and then requires
 * to be the session named here, so a request can never act for another session's documents. The named
 * path exists for the callers that hold a session id and no request scope — the domain and integration
 * tests that prove isolation by naming a seeded session — and the runner gates it to a development
 * build. A request that resolves to no session at all is refused here rather than reaching the runner
 * with an identifier nobody stated.
 */
async function mutationSessionId(
  source: SessionSource | undefined,
  operationId: string,
): Promise<SessionForMutation> {
  if (source !== undefined) {
    return { ok: true, sessionId: source.sessionId };
  }
  const resolution = await resolveSession().catch(() => undefined);
  if (resolution === undefined) {
    return { ok: false, outcome: denied({ operationId, reasonCode: "session-unavailable" }) };
  }
  return resolution.ok
    ? { ok: true, sessionId: resolution.session.sessionId }
    : { ok: false, outcome: outcomeOfRefusal(resolution.refusal, operationId) };
}

// ---------------------------------------------------------------------------------------------
// The one session document this file reads and writes
// ---------------------------------------------------------------------------------------------

/**
 * The member of a session's draft documents this file reaches.
 *
 * The state document is one JSON object holding every record family, and a write replaces one family in
 * it while every other family travels through untouched. Naming the carrier structurally keeps the
 * store's own document type out of this file: the runner hands its draft in, and the only member a
 * mutation may change is `state`.
 */
interface StateDocumentCarrier {
  state: unknown;
}

/** The record families this file reads, validated through the schemas the envelope declares. */
interface CoachingFamilies {
  readonly document: Record<string, unknown>;
  readonly grants: readonly CoachingGrantRecord[];
  readonly targets: readonly CoachingTargetRecord[];
  readonly checkIns: readonly CoachingCheckInRecord[];
  readonly taskShares: readonly CoachingTaskShareRecord[];
  readonly tasks: readonly TaskRecord[];
  /** The currencies the session's support projection states, for a reviewed financial range. */
  readonly projectionCurrencies: readonly string[];
}

/** The families, or the reference of the one that could not be read. */
type FamiliesLoad =
  | { readonly ok: true; readonly families: CoachingFamilies }
  | { readonly ok: false; readonly reference: string };

/** A JSON object, or `null` for anything that is not one. */
function plainRecordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One family of the state document, or `null` when it is present but unreadable. */
function familyOf<T>(
  document: Record<string, unknown>,
  key: string,
  schema: z.ZodType<T>,
): readonly T[] | null {
  const parsed = z.array(schema).safeParse(Reflect.get(document, key) ?? []);
  return parsed.success ? parsed.data : null;
}

/** The currencies a stored support projection states, read for their names alone. */
function projectionCurrenciesOf(document: Record<string, unknown>): readonly string[] {
  const projection = plainRecordOf(Reflect.get(document, "supportProjection"));
  if (projection === null) return [];
  const exponents = plainRecordOf(Reflect.get(projection, "currencyExponents"));
  return exponents === null ? [] : Object.keys(exponents);
}

/**
 * Reads the record families this file changes, and nothing else.
 *
 * A family that is absent reads as empty — the seed lays every family down, and a document written by an
 * earlier build may not hold one of these yet — while a family that is present but does not match its
 * declared shape is reported as the source it is, so a caller is told the records could not be read
 * instead of being shown an empty collection that would read as "nothing is shared".
 */
function readFamilies(carrier: StateDocumentCarrier): FamiliesLoad {
  const document = plainRecordOf(carrier.state);
  if (document === null) {
    return { ok: false, reference: STATE_DOCUMENT_REFERENCE };
  }

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

  return {
    ok: true,
    families: {
      document,
      grants,
      targets,
      checkIns,
      taskShares,
      tasks,
      projectionCurrencies: projectionCurrenciesOf(document),
    },
  };
}

/**
 * The state document with one family replaced.
 *
 * Every other family is carried through exactly as stored, so a mutation of a coaching record can never
 * drop a partner, a gift, a task or a content revision on its way to disk.
 */
function withFamily(
  document: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...document, [key]: value };
}

/** Replaces one record in a family by identity, keeping the family's order. */
function replacingRecord<T>(
  records: readonly T[],
  identifierOf: (record: T) => string,
  identifier: string,
  next: T,
): readonly T[] {
  return records.map((record) => (identifierOf(record) === identifier ? next : record));
}

// ---------------------------------------------------------------------------------------------
// The refusals an `apply` answers with
// ---------------------------------------------------------------------------------------------

/** A refusal an `apply` reached only after reading the record the change acts on. */
type RefusalResult = { readonly refused: MutationOutcome };

/** The refusal for a caller this record does not admit, naming nothing it asked about. */
function refuseDenied(operationId: string): RefusalResult {
  return { refused: denied({ operationId, reasonCode: "no-permission" }) };
}

/**
 * The refusal for an action whose assumption about the record no longer holds.
 *
 * A closed episode, an invitation nobody accepted and a value the caller presented that is no longer
 * current all answer here: the record as it now stands travels back beside the caller's preserved input,
 * nothing was written, and there is no path from this answer to a revival. The reason code is the closed
 * set's own, because the alternative — naming which closure it was in a field a hidden record could be
 * described by — is exactly what a denial exists to prevent.
 */
function refuseConflict(
  operationId: string,
  currentRevision: string,
  current: unknown,
  preservedInput: unknown,
): RefusalResult {
  return {
    refused: conflict({
      operationId,
      currentRevision,
      current,
      preservedInput,
      reason: "stale-revision",
    }),
  };
}

/** The refusal for a payload the record cannot accept, with messages keyed by field path. */
function refuseInvalid(operationId: string, fields: FieldMessages): RefusalResult {
  return { refused: invalid({ operationId, fields }) };
}

/** The refusal for a state document or a related record that could not be read. */
function refuseUnavailable(operationId: string, reference: string): RefusalResult {
  return {
    refused: unavailable({
      operationId,
      source: { system: LOCAL_STORE_SYSTEM, reference },
      guidance: STATE_UNAVAILABLE_GUIDANCE,
    }),
  };
}

/**
 * The refusal a coaching module's own refusal becomes, with no record named.
 *
 * The coaching modules answer with a reason from their closed vocabulary. The three answers a caller can
 * act on are kept apart: a refusal about the caller's relationship to the record is `denied`; a refusal
 * that the record has moved past the action (a closure, a superseded invitation, a frozen cutoff, a
 * value the module has moved beyond) is a `conflict` carrying the record as it stands and the caller's
 * preserved input; and a refusal about the coherence of what was asked for is `invalid`, with the
 * module's own wording — which names no record — keyed to the field it belongs to.
 */
function refuseFromCoaching(
  operationId: string,
  refusal: CoachingRefusal,
  record: CoachingGrantRecord,
  preservedInput: unknown,
): RefusalResult {
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

// ---------------------------------------------------------------------------------------------
// Reading the payload the runner has already validated
// ---------------------------------------------------------------------------------------------

/**
 * Re-reads the payload with the mutation's own schema inside the transaction.
 *
 * The runner validates the payload before it opens the transaction and hands `apply` the documents
 * rather than the parsed value, so the mutation reads the same schema again instead of a second copy of
 * the shape. The parse cannot fail at this point — a payload that failed it never reached the
 * transaction — and if it somehow did, the thrown `ZodError` is what the runner turns into `invalid`,
 * so the caller still reads a value from the closed set.
 */
function payloadOf<P>(schema: z.ZodType<P>, raw: unknown): P {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

// ---------------------------------------------------------------------------------------------
// A coaching relationship: the stored record and the module's own grant
// ---------------------------------------------------------------------------------------------

/**
 * The duration a stored grant records, in the coaching module's shape.
 *
 * A stored duration states the kind, the zone and — for a Share-through grant — the cutoff it froze. The
 * module's own duration also states the Share-through day, which the recorded instant and zone name
 * exactly (the day the cutoff falls on, less one), so acceptance can freeze the duration again from its
 * own terms instead of from the day the acceptance happened to run. An instant or zone that cannot be
 * read makes the duration unreadable rather than indefinite: an unbounded share is not what the worker
 * chose.
 */
function workingDurationOf(duration: CoachingDurationRecord): GrantDuration | null {
  if (duration.kind === "ongoing") {
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

  const cutoff = duration.cutoffInstant === null ? null : instantOf(duration.cutoffInstant);
  if (cutoff === null) return null;
  const shareThroughDate = shareThroughDateOfCutoff({
    cutoffInstant: cutoff,
    frozenZone: duration.frozenZone,
  });
  if (shareThroughDate === null) return null;

  return {
    kind: "through-date",
    shareThroughDate,
    frozenZone: duration.frozenZone,
    cutoffInstant: cutoff,
    sourceLimitInstant: null,
    limitedBy: "share-through",
    nominalWording: `Shared through ${serialiseCivilDate(shareThroughDate)}`,
    resolution: null,
    nominalDisagreesWithResolved: false,
    settledAt: null,
  };
}

/**
 * The duration as stored: the kind, the zone, and the cutoff the module froze.
 *
 * The frozen instant is copied exactly as the module resolved it and is never recomputed from a later
 * instant, which is what keeps a travel, settings or timezone-data change from moving a boundary a coach
 * was already told about.
 */
function storedDurationOf(duration: GrantDuration): CoachingDurationRecord {
  return {
    kind: duration.kind,
    cutoffInstant: duration.cutoffInstant === null ? null : duration.cutoffInstant.toString(),
    frozenZone: duration.frozenZone,
  };
}

/**
 * A stored grant in the coaching module's own shape, or `null` when it cannot be read.
 *
 * The stored record states the lifecycle, the five switches, the frozen duration and the reviewed range;
 * the two facts it leaves implicit are stated here once: an episode that is not `invited` was accepted
 * (every closure follows an acceptance), and an accepted episode's identity is verified, because the
 * deliberate acceptance from the named coach's own session is the identity step in this synthetic
 * runtime. A future identity owner supplies the real fact at this seam without a stored field changing.
 */
function workingGrantOf(record: CoachingGrantRecord): CoachingGrant | null {
  const issuedAt = instantOf(record.invitation.issuedAt);
  const expiresAt = instantOf(record.invitation.expiresAt);
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

/**
 * The stored record a module transition produced, with the caller's own record carried through.
 *
 * Only the five facts a transition can change are written: the episode's state, the five switches, the
 * frozen duration, the invitation's supersession note and the revision. Every other field — the grant's
 * identity, the two principals, the ministries and the reviewed range — is the record's own and travels
 * through exactly as stored, so a transition can never rewrite who the relationship is between.
 */
function storedGrantOf(
  record: CoachingGrantRecord,
  grant: CoachingGrant,
  nextRevision: string,
): CoachingGrantRecord {
  const duration = grant.duration === null ? record.duration : storedDurationOf(grant.duration);
  return {
    ...record,
    modules: grant.modules,
    duration,
    state: grant.state === "superseded" ? record.state : grant.state,
    invitation: { ...record.invitation, supersededBy: grant.invitation.supersededBy },
    revision: nextRevision,
  };
}

/**
 * The authority context a module question is asked under.
 *
 * The ministry is the one the claim names when the grant covers it, and the grant's own first ministry
 * otherwise: a relationship the worker holds is theirs to review from whichever context they are working
 * in, and the row states every ministry it covers. Nothing here is a permission — the module decides.
 */
function accessContextOf(
  record: CoachingGrantRecord,
  principalId: string,
  role: "worker" | "coach",
  scope: Scope,
): CoachingAccessContext {
  const ministryId = record.ministryIds.includes(scope.ministryId)
    ? scope.ministryId
    : (record.ministryIds.at(0) ?? scope.ministryId);
  return {
    actor: { role, principalId },
    organizationId: scope.organizationId,
    ministryId,
    subjectAvailability: "available",
    permissionHold: "none",
  };
}

// ---------------------------------------------------------------------------------------------
// A target: the plan history a closed period is measured against
// ---------------------------------------------------------------------------------------------

/** A stored target version in the module's own shape. */
function workingVersionOf(version: CoachingTargetRecord["versions"][number]): TargetVersion | null {
  const effectiveFrom = civilDateOf(version.effectiveFrom);
  const calendarStart = civilDateOf(version.calendarStart);
  if (effectiveFrom === null || calendarStart === null) return null;
  const effectiveTo = version.effectiveTo === null ? null : civilDateOf(version.effectiveTo);
  if (version.effectiveTo !== null && effectiveTo === null) return null;
  return {
    revisionId: version.revisionId,
    effectiveFrom,
    ...(effectiveTo === null ? {} : { effectiveTo }),
    quantity: version.quantity,
    measure: version.measure,
    calendarStart,
  };
}

/** The stored form of a version history, with the boundaries kept as civil dates. */
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

/** A stored target period in the module's own shape, or `null` when its own days cannot be read. */
function workingPeriodOf(record: CoachingTargetRecord): TargetPeriod | null {
  const period = record.period;
  if (period.kind !== "custom") return { kind: period.kind };
  if (period.from === null || period.to === null) return null;
  const start = civilDateOf(period.from);
  const end = civilDateOf(period.to);
  return start === null || end === null ? null : { kind: "custom", start, end };
}

/** The stored form of a target period. */
function storedPeriodOf(period: TargetPeriod): CoachingTargetRecord["period"] {
  return period.kind === "custom"
    ? {
        kind: "custom",
        from: serialiseCivilDate(period.start),
        to: serialiseCivilDate(period.end),
      }
    : { kind: period.kind, from: null, to: null };
}

// ---------------------------------------------------------------------------------------------
// A check-in: the private draft, and the one shared revision a coach may read
// ---------------------------------------------------------------------------------------------

/**
 * The share duration a stored grant's duration states in the check-in module's own vocabulary.
 *
 * The shared revision records the duration the grant was accepted with rather than resolving a cutoff of
 * its own, so the grant's duration is the single source and this only restates it in the shape the
 * check-in module carries.
 */
function checkInShareDurationOf(duration: CoachingDurationRecord): CheckInShareDuration | null {
  if (duration.kind === "ongoing") return { kind: "ongoing" };
  const cutoff = duration.cutoffInstant === null ? null : instantOf(duration.cutoffInstant);
  if (cutoff === null) return null;
  const throughOn = shareThroughDateOfCutoff({
    cutoffInstant: cutoff,
    frozenZone: duration.frozenZone,
  });
  return throughOn === null ? null : { kind: "through-date", throughOn };
}

/** The answers a stored revision holds, in the module's own shape. */
function answersOf(answers: readonly CheckInAnswer[]): CheckInAnswer[] {
  return answers.map((answer) => ({ questionOrder: answer.questionOrder, text: answer.text }));
}

/**
 * A stored check-in in the check-in module's own shape, or `null` when an instant, a zone or a form the
 * record states cannot be read.
 *
 * The record's four states are carried as they are: a check-in with no private draft and no shared
 * revision is neither, because the caller says which mutation it is running; a check-in whose shared
 * revision was withdrawn keeps that revision, which is the record of what was shared.
 */
function workingCheckInOf(record: CoachingCheckInRecord): CheckIn | null {
  let privateDraft: CheckIn["privateDraft"];
  const draft = record.privateDraft;
  if (draft !== null) {
    const capturedAt = instantOf(draft.questionsCapturedAt);
    const savedAt = instantOf(draft.savedAt);
    if (capturedAt === null || savedAt === null) return null;
    privateDraft = {
      revisionId: draft.revisionId,
      captured: {
        questions: draft.questions.map((question) => ({
          wording: question.wording,
          order: question.order,
        })),
        capturedAt,
      },
      answers: answersOf(draft.answers),
      savedAt,
    };
  }

  let shared: CheckInSharedRevision | undefined;
  const stored = record.shared;
  if (stored !== null) {
    const capturedAt = instantOf(stored.questionsCapturedAt);
    const sharedAt = instantOf(stored.sharedAt);
    const updatedAt = instantOf(stored.updatedAt);
    if (capturedAt === null || sharedAt === null || updatedAt === null) return null;
    const withdrawnAt = stored.withdrawnAt === null ? null : instantOf(stored.withdrawnAt);
    if (stored.withdrawnAt !== null && withdrawnAt === null) return null;
    const duration = checkInShareDurationOf(stored.duration);
    if (duration === null) return null;
    shared = {
      revisionId: stored.revisionId,
      captured: {
        questions: stored.questions.map((question) => ({
          wording: question.wording,
          order: question.order,
        })),
        capturedAt,
      },
      answers: answersOf(stored.answers),
      recipients: [...stored.recipientPrincipalIds],
      duration,
      sharedAt,
      updatedAt,
      ...(withdrawnAt === null ? {} : { withdrawnAt }),
    };
  }

  return {
    checkInId: record.checkInId,
    revision: revisionOrdinalOf(record.revision),
    ...(privateDraft === undefined ? {} : { privateDraft }),
    ...(shared === undefined ? {} : { shared }),
  };
}

/**
 * The stored check-in a module transition produced.
 *
 * The shared revision's duration is written from the grant the sharing was made under, because a share
 * records the duration the relationship was accepted with and never resolves a cutoff of its own. The
 * private draft and the shared revision are separate members throughout: an autosave writes the first
 * and leaves the second exactly as it was, which is why a coach cannot read a private draft.
 */
function storedCheckInOf(
  record: CoachingCheckInRecord,
  checkIn: CheckIn,
  nextRevision: string,
  sharedDuration: CoachingDurationRecord | undefined,
): CoachingCheckInRecord | null {
  const draft = checkIn.privateDraft;
  const privateDraft: CoachingCheckInRecord["privateDraft"] =
    draft === undefined
      ? null
      : {
          revisionId: draft.revisionId,
          questions: draft.captured.questions.map((question) => ({
            wording: question.wording,
            order: question.order,
          })),
          questionsCapturedAt: draft.captured.capturedAt.toString(),
          answers: answersOf(draft.answers),
          savedAt: draft.savedAt.toString(),
        };

  let shared: CoachingCheckInRecord["shared"] = null;
  const revision = checkIn.shared;
  if (revision !== undefined) {
    const duration = sharedDuration ?? record.shared?.duration;
    if (duration === undefined) return null;
    shared = {
      revisionId: revision.revisionId,
      questions: revision.captured.questions.map((question) => ({
        wording: question.wording,
        order: question.order,
      })),
      questionsCapturedAt: revision.captured.capturedAt.toString(),
      answers: answersOf(revision.answers),
      recipientPrincipalIds: revision.recipients.map((recipient) =>
        principalIdSchema.parse(recipient),
      ),
      duration,
      sharedAt: revision.sharedAt.toString(),
      updatedAt: revision.updatedAt.toString(),
      withdrawnAt: revision.withdrawnAt === undefined ? null : revision.withdrawnAt.toString(),
    };
  }

  return { ...record, privateDraft, shared, revision: nextRevision };
}

/** The question set a check-in payload states, paired positionally with its answers. */
function checkInPayloadOf(
  questions: readonly string[],
  answers: readonly string[],
): CheckInPayload {
  return {
    questions: questions.map((wording, index) => ({ wording, order: index })),
    answers:
      questions.length === 0
        ? answers.map((text) => ({ questionOrder: null, text }))
        : answers.map((text, index) => ({ questionOrder: index, text })),
  };
}

// ---------------------------------------------------------------------------------------------
// A task share: the reviewed description and the live values beside it
// ---------------------------------------------------------------------------------------------

/** A stored share in the task-share module's own shape, or `null` when its reviewed instant cannot be read. */
function workingTaskShareOf(record: CoachingTaskShareRecord): TaskShare | null {
  const reviewedAt = instantOf(record.reviewedSummary.reviewedAt);
  if (reviewedAt === null) return null;
  const withdrawnAt =
    record.withdrawnAt === undefined || record.withdrawnAt === null
      ? null
      : instantOf(record.withdrawnAt);
  if (record.withdrawnAt !== undefined && record.withdrawnAt !== null && withdrawnAt === null) {
    return null;
  }
  return {
    shareId: record.shareId,
    occurrenceId: record.occurrenceId,
    reviewedSummary: {
      description: record.reviewedSummary.description,
      codePoints: record.reviewedSummary.codePoints,
      reviewedAt,
    },
    reviewedFingerprint: record.reviewedFingerprint,
    state: record.state,
    revision: record.revision,
    ...(withdrawnAt === null ? {} : { withdrawnAt }),
  };
}

/** The refusal a task-share module refusal becomes, with no task field named in the answer. */
function refuseFromTaskShare(operationId: string, refusal: TaskShareRefusal): RefusalResult {
  switch (refusal.reason) {
    case "description-too-long":
      return refuseInvalid(operationId, {
        safeDescription: [
          `A shared description is at most ${String(refusal.limit)} Unicode code points; this one is ${String(refusal.codePoints)}. Nothing was shortened: take out the text you do not want to share, and review it again.`,
        ],
      });
    case "description-empty":
      return refuseInvalid(operationId, {
        safeDescription: [
          "A shared description states what you want your coach to read, so it cannot be blank.",
        ],
      });
    case "unavailable":
      return refuseUnavailable(operationId, "coaching-task-share");
    default:
      return refuseInvalid(operationId, {
        [ROOT_FIELD_KEY]: [
          "This shared summary no longer stands as it was read, so nothing was shared. Reload the summaries, review the description and share it again.",
        ],
      });
  }
}

// ---------------------------------------------------------------------------------------------
// The sixteen payloads
// ---------------------------------------------------------------------------------------------

/** An opaque reference exactly as a read envelope handed it out: never parsed, never a name or address. */
const referenceField = z.string().trim().min(1);

/**
 * A civil date a payload states, validated as a real calendar day and kept as the text it arrived as.
 *
 * The calendar is read by the one implementation that owns it, so a value shaped like a date that names
 * no day — the thirtieth of February, for instance — is refused rather than rolled forward into March.
 * No time of day, zone or instant is invented for the day the worker chose.
 */
const civilDateField = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({
        code: "custom",
        message: "A date is a real calendar day written as YYYY-MM-DD; this value names no day.",
      });
    }
  });

/**
 * How long the worker chose to share: open-ended, or through one civil date.
 *
 * There is no zone field beside the date. The zone a cutoff is resolved in belongs to the source, so a
 * client-supplied one would let a display change move a boundary that is meant to be frozen; the zone is
 * declared once in this file and the cutoff is resolved when the invitation is made.
 */
const shareDurationField = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ongoing") }),
  z.strictObject({ kind: z.literal("through-date"), shareThroughDate: civilDateField }),
]);

/** The five switches as an invitation may state them: all off, because an invitation grants nothing. */
const invitedModulesShape = {
  "support-goal": z.literal(false),
  "support-results": z.literal(false),
  targets: z.literal(false),
  "check-ins": z.literal(false),
  "task-summaries": z.literal(false),
} satisfies Record<ModuleKey, z.ZodLiteral<false>>;

/**
 * The invitation payload: one named coach, the organization and ministry it is made in, a duration, and
 * optionally the one reviewed range whose figures the coach may read.
 *
 * Both namings in use are accepted — `coachPrincipalId` with `ministryId`, and AAP 0.6.1's
 * `recipientPrincipalId` with `ministryIds` — and normalised once before anything is written. A missing
 * duration is refused here and again by the module, because a missing duration is not permission.
 */
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
      .strictObject({
        fromDate: civilDateField,
        toDate: civilDateField,
        currency: z.string().trim().min(1).optional(),
      })
      .refine((range) => range.fromDate <= range.toDate, {
        path: ["toDate"],
        message: "A reviewed range ends on or after the day it starts.",
      })
      .optional(),
  })
  .superRefine((payload, ctx) => {
    if (invitedCoachOf(payload) === "") {
      ctx.addIssue({
        code: "custom",
        path: ["coachPrincipalId"],
        message: "An invitation names the coach it is for, by identifier.",
      });
    }
    if (invitedMinistriesOf(payload).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["ministryIds"],
        message: "An invitation names the ministry it is made in, by identifier.",
      });
    }
  });

/** The validated invitation payload. */
type InvitationPayload = z.infer<typeof invitationPayload>;

/** The coach an invitation names, under either accepted naming. */
function invitedCoachOf(payload: InvitationPayload): string {
  return payload.coachPrincipalId ?? payload.recipientPrincipalId ?? "";
}

/** The ministries an invitation names, under either accepted naming. */
function invitedMinistriesOf(payload: InvitationPayload): readonly string[] {
  if (payload.ministryIds !== undefined) return payload.ministryIds;
  return payload.ministryId === undefined ? [] : [payload.ministryId];
}

/**
 * The acceptance payload: the invitation, and the revision of it the coach actually saw.
 *
 * Acceptance states nothing about identity and nothing about the cutoff: whether the identity is verified
 * and where the cutoff freezes are the service's facts, read from the session and resolved from the
 * invitation's own terms.
 */
const acceptancePayload = z.strictObject({
  grantId: referenceField,
  // The revision the coach saw, in either form a read hands out: the ordinal number, or the stored token
  // (`"rev-1"`) a relationship's own envelope states. Both are read as the same ordinal below.
  invitationRevision: z.union([z.number().int().min(0), referenceField]).optional(),
});

/** The validated acceptance payload. */
type AcceptancePayload = z.infer<typeof acceptancePayload>;

/** The payload of a mutation that addresses one relationship and states nothing else about it. */
const grantReferencePayload = z.strictObject({ grantId: referenceField });

/** The validated payload of a mutation that addresses one relationship. */
type GrantReferencePayload = z.infer<typeof grantReferencePayload>;

/**
 * The module payload: one relationship, one of the five modules, and whether it is now shared.
 *
 * Both namings in use are accepted (`moduleKey` from the surface, `module` from AAP 0.6.1). No field can
 * ask for deletion, a cascade or a reason: stopping a module ends that module's disclosure and changes no
 * source record.
 */
const modulePayload = z
  .strictObject({
    grantId: referenceField,
    moduleKey: z.enum(MODULE_KEYS).optional(),
    module: z.enum(MODULE_KEYS).optional(),
    enabled: z.boolean(),
  })
  .superRefine((payload, ctx) => {
    if ((payload.moduleKey ?? payload.module) === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["moduleKey"],
        message: "A module change names the one module it switches.",
      });
    }
  });

/** The validated module payload. */
type ModulePayload = z.infer<typeof modulePayload>;

/** The one module a payload switches, under either accepted naming. */
function moduleKeyOf(payload: ModulePayload): ModuleKey | undefined {
  return payload.moduleKey ?? payload.module;
}

/** One of the four canonical measures. A fifth is a product change, not a payload value. */
const measureField = z.enum(TARGET_MEASURES);

/** How many of the measure a target counts: a positive whole count, never coerced from text. */
const quantityField = z.number().int().min(1);

/** One of the three periods a target may be measured over. */
const periodKindField = z.enum(["weekly", "monthly", "custom"]);

/** The three fields a one-off custom period is decided from. */
interface CustomRangeFields {
  readonly period?: "weekly" | "monthly" | "custom" | undefined;
  readonly calendarStart?: string | undefined;
  readonly periodEnd?: string | undefined;
}

/**
 * Refuses a one-off custom period that states no first or last day.
 *
 * A recurring period is anchored to the day the target already started on, so it needs neither. A custom
 * range names its own days and has no anchor to fall back on, and inferring one from today would start or
 * end a period the worker never chose.
 */
function requireCustomRange(fields: CustomRangeFields, ctx: z.RefinementCtx): void {
  if (fields.period !== "custom") return;
  if (fields.calendarStart === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["calendarStart"],
      message: "A one-off custom period states the day it starts.",
    });
  }
  if (fields.periodEnd === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["periodEnd"],
      message: "A one-off custom period states the day it ends.",
    });
  }
}

/**
 * The payload that sets a target for the first time: what it counts, how many, over which period, what
 * the worker calls it and whether they placed it on Home.
 *
 * `privateLabel` is the worker's own wording and never reaches a coach. `homePlacement` decides only
 * whether Home lists the target and carries no commitment, reminder or notification.
 */
const targetSavePayload = z
  .strictObject({
    measure: measureField,
    quantity: quantityField,
    period: periodKindField.optional(),
    calendarStart: civilDateField.optional(),
    periodEnd: civilDateField.optional(),
    privateLabel: z.string().trim().min(1),
    homePlacement: z.boolean().optional(),
  })
  .superRefine(requireCustomRange);

/** The validated target-creation payload. */
type TargetSavePayload = z.infer<typeof targetSavePayload>;

/**
 * The payload that changes a target's plan.
 *
 * Nothing here can name a version boundary, a proration, a bridge period or a version identifier: a
 * change to quantity, measure or calendar start opens a prospective version at the boundary the service
 * chooses, and every period that already closed keeps the version it was measured against. Renaming the
 * target or moving it on Home starts no version at all.
 */
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

/** The validated target-edit payload. */
type TargetEditPayload = z.infer<typeof targetEditPayload>;

/**
 * The payload that pauses or ends a target.
 *
 * Pausing and ending are separate named mutations that take the target alone: neither deletes the
 * version history, neither touches an activity record, and neither carries a reason, an effective day or
 * a cascade flag.
 */
const targetStatePayload = z.strictObject({ targetId: referenceField });

/** The validated payload of a target lifecycle change. */
type TargetStatePayload = z.infer<typeof targetStatePayload>;

/** A plain-text entry a check-in carries: no markup, no attachment, no structured field. */
const checkInTextsField = z.array(z.string());

/**
 * The private autosave payload: the text as it stands, and the draft it extends.
 *
 * `checkInId` is absent when the worker starts a check-in and present once a private draft exists, so one
 * schema covers the first save and every autosave after it. Saving changes the private draft and nothing
 * else: this payload cannot express recipients, a duration or a shared revision, because an autosave
 * shares nothing with anyone and must not be able to say that it did.
 */
const saveCheckInPayload = z.strictObject({
  checkInId: referenceField.optional(),
  questions: checkInTextsField.optional(),
  answers: checkInTextsField,
});

/** The validated private-autosave payload. */
type SaveCheckInPayload = z.infer<typeof saveCheckInPayload>;

/**
 * The share payload: the check-in whose saved revision becomes readable by the named coach.
 *
 * The body is optional: the saved private draft is what a share snapshots, so a payload that omits it
 * shares exactly what was saved. When the body is present it must be the body that was saved, because a
 * coach must read the wording the worker reviewed rather than text that was never saved.
 */
const shareCheckInPayload = z.strictObject({
  checkInId: referenceField,
  questions: checkInTextsField.optional(),
  answers: checkInTextsField.optional(),
  recipients: z.array(referenceField).min(1).optional(),
  duration: shareDurationField.optional(),
});

/** The validated share payload. */
type ShareCheckInPayload = z.infer<typeof shareCheckInPayload>;

/**
 * The payload that changes what a coach reads.
 *
 * The identity of the shared revision being replaced is part of the intent, and the captured question set
 * governs: a payload cannot reword the prompts behind a revision a coach is already reading.
 */
const updateSharedCheckInPayload = z.strictObject({
  checkInId: referenceField,
  sharedRevisionId: referenceField.optional(),
  questions: checkInTextsField.optional(),
  answers: checkInTextsField,
});

/** The validated shared-revision change payload. */
type UpdateSharedCheckInPayload = z.infer<typeof updateSharedCheckInPayload>;

/**
 * The withdrawal payload: which check-in, and which shared revision if the surface states one.
 *
 * It carries no question or answer body on purpose. Withdrawal must succeed while a draft elsewhere is
 * invalid, so a body here would let a text validation error block a stop-type effect the worker is
 * entitled to perform at any moment.
 */
const withdrawCheckInPayload = z.strictObject({
  checkInId: referenceField,
  sharedRevisionId: referenceField.optional(),
});

/** The validated withdrawal payload. */
type WithdrawCheckInPayload = z.infer<typeof withdrawCheckInPayload>;

/**
 * The share-a-summary payload: the task, the occurrence the worker selected, the review the description
 * belongs to, and the description itself.
 *
 * Nothing else can travel here: no title, no note, no partner or donor, no amount, no attachment, no
 * source reference, no link and no due date or status, because the coach's view renders those live from
 * the record. A blank description is refused rather than stored, and the 240-code-point limit is enforced
 * by the module that owns it, with the measured count and never by shortening the text.
 */
const taskSharePayload = z.strictObject({
  taskId: referenceField,
  occurrenceId: referenceField.optional(),
  reviewedFingerprint: referenceField.optional(),
  safeDescription: z.string().superRefine((description, ctx) => {
    if (description.trim() === "") {
      ctx.addIssue({
        code: "custom",
        message: "A shared summary states what you want your coach to read, so it cannot be blank.",
      });
    }
  }),
});

/** The validated share-a-summary payload. */
type TaskSharePayload = z.infer<typeof taskSharePayload>;

/**
 * The stop-a-share payload: the share identity and nothing else.
 *
 * Stopping must succeed while an unrelated draft is invalid, so this payload carries nothing a body
 * validation could refuse for reasons of its own. Both namings in use are accepted (`shareId` from AAP
 * 0.7.1, `taskShareId` from the surface).
 */
const stopTaskSharePayload = z
  .strictObject({
    shareId: referenceField.optional(),
    taskShareId: referenceField.optional(),
  })
  .superRefine((payload, ctx) => {
    if ((payload.shareId ?? payload.taskShareId) === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["shareId"],
        message: "Stopping a shared summary names the summary it stops.",
      });
    }
  });

/** The validated stop-a-share payload. */
type StopTaskSharePayload = z.infer<typeof stopTaskSharePayload>;

/** The share a stop payload names, under either accepted naming. */
function stoppedShareIdOf(payload: StopTaskSharePayload): string {
  return payload.shareId ?? payload.taskShareId ?? "";
}

// ---------------------------------------------------------------------------------------------
// What every mutation in this file answers with
// ---------------------------------------------------------------------------------------------

/**
 * The opaque result of a relationship change: which relationship, where it now stands, at what revision.
 *
 * Each result below states identifiers, a lifecycle word and a revision — never a label, a check-in text
 * or a description — and each carries `JsonValue`'s index signature so the ledger can store it and a
 * replay can return it byte for byte.
 */
interface GrantResult {
  readonly [field: string]: JsonValue;
  readonly grantId: string;
  readonly state: string;
  readonly revision: string;
}

/** The opaque result of a target change: which target, its state, and the revision it now stands at. */
interface TargetResult {
  readonly [field: string]: JsonValue;
  readonly targetId: string;
  readonly state: string;
  readonly revision: string;
}

/** The opaque result of a check-in change: the record, its state, and the revision identities it carries. */
interface CheckInResult {
  readonly [field: string]: JsonValue;
  readonly checkInId: string;
  readonly state: string;
  readonly revision: string;
}

/** The opaque result of a task-share change: which share, where it stands, and the task it covers. */
interface TaskShareResult {
  readonly [field: string]: JsonValue;
  readonly shareId: string;
  readonly taskId: string;
  readonly state: string;
  readonly revision: string;
}

/** The hours an invitation stays acceptable on its own: seven days, stated once. */
const INVITATION_WINDOW_HOURS = 168;

/** The invitation's own window as the scenario clock states it, from its issue instant. */
function invitationExpiryOf(issuedAt: Temporal.Instant): Temporal.Instant {
  return issuedAt.add({ hours: INVITATION_WINDOW_HOURS });
}

/** The duration a payload states, in the coaching module's own shape, with the source zone. */
function chosenShareDurationOf(duration: InvitationPayload["duration"]): ShareDuration | null {
  if (duration.kind === "ongoing") return { kind: "ongoing", frozenZone: SHARE_SOURCE_ZONE };
  const shareThroughDate = civilDateOf(duration.shareThroughDate);
  return shareThroughDate === null
    ? null
    : { kind: "through-date", shareThroughDate, frozenZone: SHARE_SOURCE_ZONE };
}

/**
 * The reviewed financial range an invitation states, in both the module's shape and the stored one.
 *
 * The range names one fixed period and no amount: the figures inside it are produced by the one report
 * function when the range is read, on the basis every financial surface uses. Its currency is the one the
 * session's support projection states, because a range that named a currency the source does not hold
 * would be a figure nobody reviewed; a source stating none or several is refused rather than defaulted.
 */
function invitedRangeOf(
  payload: InvitationPayload,
  projectionCurrencies: readonly string[],
):
  | { readonly ok: true; readonly stored: CoachingGrantRecord["financialRange"] }
  | { readonly ok: false; readonly fields: FieldMessages } {
  const range = payload.financialRange;
  if (range === undefined) return { ok: true, stored: null };

  const from = civilDateOf(range.fromDate);
  const to = civilDateOf(range.toDate);
  if (from === null || to === null) {
    return {
      ok: false,
      fields: { financialRange: ["A reviewed range states two real calendar days."] },
    };
  }
  const stated = range.currency;
  const currency =
    stated === undefined
      ? projectionCurrencies.length === 1
        ? projectionCurrencies[0]
        : undefined
      : projectionCurrencies.includes(stated)
        ? stated
        : undefined;
  if (currency === undefined) {
    return {
      ok: false,
      fields: {
        financialRange: [
          stated === undefined
            ? "A reviewed range states the one currency it was reviewed in, because this session's support source states more than one and no figure is recorded against a currency nobody chose."
            : "A reviewed range states a currency this session's support source holds, so a figure is never disclosed in a currency nothing was measured in.",
        ],
      },
    };
  }

  return { ok: true, stored: { from: range.fromDate, to: range.toDate, currency } };
}

/** The record a conflict or a conflict-shaped answer may name: identity, state and revision only. */
function grantStandingOf(record: CoachingGrantRecord): GrantResult {
  return { grantId: record.grantId, state: record.state, revision: record.revision };
}

/**
 * Invites one named coach over the ministries and for the duration the worker chose.
 *
 * Outcomes: `accepted` with the new relationship's identity at `rev-1`; `alreadyAccepted` for a replayed
 * attempt, returning the same identity; `denied` when the invitation names a ministry the caller is not
 * admitted to; `invalid` for a missing duration, an unresolvable date, an incoherent range or the worker
 * naming themselves; `unavailable` when the session's records cannot be read; `unknown` when the effect's
 * fate is not known. Every module starts unselected: an invitation grants nothing.
 */
export async function inviteCoach(
  input: MutationInput<InvitationPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: invitationPayload,
    name: "inviteCoach",
    authorize: () => SCOPE_ESTABLISHED,
    apply: (context) => applyInviteCoach(context, input.payload),
  });
}

/** The invitation itself: one relationship, nothing shared, and no acceptance recorded. */
function applyInviteCoach(context: MutationContext, raw: unknown): ApplyResult<GrantResult> {
  const operationId = context.operationId;
  const payload = payloadOf(invitationPayload, raw);
  const at = now();

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;

  const coachPrincipalId = invitedCoachOf(payload);
  const ministryIds = invitedMinistriesOf(payload);

  // An invitation states the scope it was made in, and the runner asserted the scope the request
  // claimed. Those are two statements of where the worker is acting, so the stated one is checked
  // against the same admissions the claimed one was.
  const admitted = ministryIds.every((ministryId) =>
    context.session.admittedMemberships.some(
      (membership) =>
        membership.organizationId === payload.organizationId &&
        membership.ministryId === ministryId,
    ),
  );
  if (!admitted) return refuseDenied(operationId);

  if (coachPrincipalId === context.session.principalId) {
    return refuseInvalid(operationId, {
      coachPrincipalId: ["A worker cannot invite their own principal as coach."],
    });
  }

  const chosen = chosenShareDurationOf(payload.duration);
  if (chosen === null) {
    return refuseInvalid(operationId, {
      duration: ["A Share-through date is a real calendar day, so this duration names none."],
    });
  }
  const frozen = freezeShareDuration(chosen, at);
  if (!frozen.ok) return refuseInvalid(operationId, { duration: [frozen.error.message] });

  const range = invitedRangeOf(payload, families.projectionCurrencies);
  if (!range.ok) return refuseInvalid(operationId, range.fields);

  const grantId = `coaching-grant-${operationId}`;
  const coachPrincipal = principalIdSchema.safeParse(coachPrincipalId);
  const ministries = z.array(ministryIdSchema).safeParse(ministryIds);
  if (!coachPrincipal.success || !ministries.success) return refuseDenied(operationId);

  const invitation = inviteGrant({
    grantId,
    workerPrincipalId: context.session.principalId,
    coachPrincipalId: coachPrincipal.data,
    ministryIds: ministries.data,
    duration: chosen,
    // A range is recorded with its period and currency; the figures inside it are produced by the one
    // report function at read time, and an invitation states none, so the module is handed no range
    // rather than a measured amount this mutation would have had to invent.
    financialRange: null,
    issuedAt: at,
    expiresAt: invitationExpiryOf(at),
    revision: revisionOrdinalOf(FIRST_REVISION),
  });
  if (!invitation.ok) {
    return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: [invitation.error.message] });
  }

  const record: CoachingGrantRecord = {
    grantId,
    workerPrincipalId: context.session.principalId,
    coachPrincipalId: coachPrincipal.data,
    ministryIds: ministries.data,
    modules: invitation.value.modules,
    duration: storedDurationOf(frozen.value),
    financialRange: range.stored,
    state: "invited",
    invitation: {
      issuedAt: at.toString(),
      expiresAt: invitationExpiryOf(at).toString(),
      supersededBy: null,
    },
    revision: FIRST_REVISION,
  };

  context.docs.state = withFamily(families.document, "coachingGrants", [
    ...families.grants,
    record,
  ]);

  return {
    changed: true,
    revision: FIRST_REVISION,
    created: [grantId],
    result: { grantId, state: record.state, revision: FIRST_REVISION },
  };
}

/**
 * Accepts an invitation, as the coach it names, freezing the share cutoff at this instant.
 *
 * Outcomes: `accepted` with the relationship now `active` and its cutoff frozen; `alreadyAccepted` for a
 * replayed attempt; `denied` for any principal but the named coach, revealing nothing about the record;
 * `conflict` for an invitation that was superseded, revoked, ended or already accepted, or one whose own
 * window has closed, with no revival path; `invalid` for a record whose duration cannot be read;
 * `unavailable` when the records cannot be read; `unknown` when the effect's fate is not known.
 */
export async function acceptInvitation(
  input: MutationInput<AcceptancePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: acceptancePayload,
    name: "acceptInvitation",
    authorize: () => SCOPE_ESTABLISHED,
    scopeAuthority: "grant",
    readCurrent: (docs) => currentGrantTarget(docs, rawGrantIdOf(input)),
    apply: (context) => applyAcceptInvitation(context, input.payload),
  });
}

/** The acceptance itself: the named coach's own act, and the cutoff it freezes. */
function applyAcceptInvitation(context: MutationContext, raw: unknown): ApplyResult<GrantResult> {
  const operationId = context.operationId;
  const payload = payloadOf(acceptancePayload, raw);
  const at = now();

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;
  const record = families.grants.find((candidate) => candidate.grantId === payload.grantId);
  // A relationship the caller does not hold and one that does not exist answer alike: a distinguishable
  // answer would let a caller enumerate what is not theirs.
  if (record === undefined || record.coachPrincipalId !== context.session.principalId) {
    return refuseDenied(operationId);
  }

  if (
    payload.invitationRevision !== undefined &&
    revisionOrdinalOfValue(payload.invitationRevision) !== revisionOrdinalOf(record.revision)
  ) {
    return refuseConflict(operationId, record.revision, grantStandingOf(record), payload);
  }

  const working = workingGrantOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-grant");

  const accepted = acceptGrant(
    working,
    {
      acceptedBy: context.session.principalId,
      identityVerification: "verified",
      expectedRevision: revisionOrdinalOf(record.revision),
    },
    at,
  );
  if (!accepted.ok) return refuseFromCoaching(operationId, accepted.error, record, payload);

  const nextRevision = nextRevisionTokenOf(record.revision);
  const next = storedGrantOf(record, accepted.value, nextRevision);
  context.docs.state = withFamily(
    families.document,
    "coachingGrants",
    replacingRecord(families.grants, (grant) => grant.grantId, record.grantId, next),
  );

  return {
    changed: true,
    revision: nextRevision,
    changedIds: [record.grantId],
    result: grantStandingOf(next),
  };
}

/**
 * Revokes a grant: the worker's own stop of the sharing, kept apart from ending the relationship.
 *
 * Outcomes: `accepted` with the relationship now `revoked`; `alreadyAccepted` for a replay; `denied` for
 * a caller who is not the worker; `conflict` when the relationship is already closed, with no revival
 * path; `unavailable` when the records cannot be read; `unknown` when the effect's fate is not known.
 */
export async function revokeGrant(
  input: MutationInput<GrantReferencePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: grantReferencePayload,
    name: "revokeGrant",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentGrantTarget(docs, rawGrantIdOf(input)),
    apply: (context) => applyGrantClosure(context, input.payload, "revoke"),
  });
}

/**
 * Ends the coaching relationship, as the worker.
 *
 * Outcomes are those of `revokeGrant`, with the relationship ending in `ended` instead of `revoked`: the
 * two closures are different acts and are never reported as one another, and an invitation nobody
 * accepted has no relationship to end.
 */
export async function endCoaching(
  input: MutationInput<GrantReferencePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: grantReferencePayload,
    name: "endCoaching",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentGrantTarget(docs, rawGrantIdOf(input)),
    apply: (context) => applyGrantClosure(context, input.payload, "end"),
  });
}

/**
 * Records that the coach left: the coach identity's second and last write.
 *
 * Outcomes are those of `revokeGrant`, with the relationship closing in `left` — the coach's own
 * departure, kept distinct from the worker ending it, because collapsing the two would report an ending
 * the worker never chose. Nothing of the worker's work changes, and nothing the coach already read is
 * recalled.
 */
export async function leaveCoaching(
  input: MutationInput<GrantReferencePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: grantReferencePayload,
    name: "leaveCoaching",
    authorize: () => SCOPE_ESTABLISHED,
    scopeAuthority: "grant",
    readCurrent: (docs) => currentGrantTarget(docs, rawGrantIdOf(input)),
    apply: (context) => applyGrantClosure(context, input.payload, "leave"),
  });
}

/** Which of the three closures a request is: the worker revoking, the worker ending, the coach leaving. */
type GrantClosure = "revoke" | "end" | "leave";

/** One of the three closures, decided by the module that owns the episode. */
function applyGrantClosure(
  context: MutationContext,
  raw: unknown,
  closure: GrantClosure,
): ApplyResult<GrantResult> {
  const operationId = context.operationId;
  const payload = payloadOf(grantReferencePayload, raw);

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;
  const record = families.grants.find((candidate) => candidate.grantId === payload.grantId);
  if (record === undefined) return refuseDenied(operationId);

  const principalId = context.session.principalId;
  const holds =
    closure === "leave"
      ? record.coachPrincipalId === principalId
      : record.workerPrincipalId === principalId;
  if (!holds) return refuseDenied(operationId);

  const working = workingGrantOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-grant");

  const expectedRevision = revisionOrdinalOf(record.revision);
  const closed =
    closure === "revoke"
      ? revokeCoachingGrant(working, { revokedBy: principalId, expectedRevision })
      : closure === "end"
        ? endGrant(working, { endedBy: principalId, expectedRevision })
        : leaveGrant(working, { leftBy: principalId, expectedRevision });
  if (!closed.ok) return refuseFromCoaching(operationId, closed.error, record, payload);

  const nextRevision = nextRevisionTokenOf(record.revision);
  const next = storedGrantOf(record, closed.value, nextRevision);
  context.docs.state = withFamily(
    families.document,
    "coachingGrants",
    replacingRecord(families.grants, (grant) => grant.grantId, record.grantId, next),
  );

  return {
    changed: true,
    revision: nextRevision,
    changedIds: [record.grantId],
    result: grantStandingOf(next),
  };
}

/**
 * Switches one of the five modules on or off for an open relationship.
 *
 * Outcomes: `accepted` with the new selection and revision; `unchanged` when the switch already stood
 * where the payload puts it, with no revision advance; `denied` for a caller who is not the worker;
 * `conflict` when the relationship is closed or its frozen cutoff has passed, with no revival path;
 * `unavailable` when the records cannot be read; `unknown` when the effect's fate is not known.
 *
 * Switching a module off stops it, and switching it back on never restores what was shared before: no
 * module's content is copied anywhere, so a stopped module leaves nothing behind to re-expose.
 */
export async function setModule(
  input: MutationInput<ModulePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: modulePayload,
    name: "setModule",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentGrantTarget(docs, rawGrantIdOf(input)),
    apply: (context) => applySetModule(context, input.payload),
  });
}

/** The module switch itself, applied to the selection the relationship already carries. */
function applySetModule(context: MutationContext, raw: unknown): ApplyResult<GrantResult> {
  const operationId = context.operationId;
  const payload = payloadOf(modulePayload, raw);
  const at = now();
  const key = moduleKeyOf(payload);
  if (key === undefined) {
    return refuseInvalid(operationId, {
      moduleKey: ["A module change names the one module it switches."],
    });
  }

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;
  const record = families.grants.find((candidate) => candidate.grantId === payload.grantId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) {
    return refuseDenied(operationId);
  }

  const working = workingGrantOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-grant");

  const selection: ModuleSelection = { ...record.modules, [key]: payload.enabled };
  const changed = setModuleSelection(
    working,
    {
      changedBy: context.session.principalId,
      selection,
      expectedRevision: revisionOrdinalOf(record.revision),
    },
    at,
  );
  if (!changed.ok) return refuseFromCoaching(operationId, changed.error, record, payload);
  if (changed.value.revision === working.revision) return { changed: false };

  const nextRevision = nextRevisionTokenOf(record.revision);
  const next = storedGrantOf(record, changed.value, nextRevision);
  context.docs.state = withFamily(
    families.document,
    "coachingGrants",
    replacingRecord(families.grants, (grant) => grant.grantId, record.grantId, next),
  );

  return {
    changed: true,
    revision: nextRevision,
    changedIds: [record.grantId],
    result: grantStandingOf(next),
  };
}

/**
 * The target of a grant change, for the runner's revision comparison.
 *
 * A relationship the caller cannot read and one that does not exist answer alike here: both read as no
 * target, so the comparison is skipped and `apply` answers the denial, which reveals nothing either way.
 */
function currentGrantTarget(
  docs: StateDocumentCarrier,
  grantId: string | undefined,
): CurrentTarget {
  if (grantId === undefined) return { kind: "absent" };
  const loaded = readFamilies(docs);
  if (!loaded.ok) return { kind: "absent" };
  const record = loaded.families.grants.find((candidate) => candidate.grantId === grantId);
  return record === undefined
    ? { kind: "absent" }
    : { kind: "record", revision: record.revision, value: grantStandingOf(record) };
}

/** The grant identifier a raw payload names, read without trusting its type. */
function rawGrantIdOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const payload: unknown = Reflect.get(input, "payload");
  if (typeof payload !== "object" || payload === null) return undefined;
  const grantId: unknown = Reflect.get(payload, "grantId");
  return typeof grantId === "string" && grantId.length > 0 ? grantId : undefined;
}

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

/** A target's standing, which is all a conflict or a denial-free answer names about it. */
function targetStandingOf(record: CoachingTargetRecord): TargetResult {
  return { targetId: record.targetId, state: record.state, revision: record.revision };
}

/**
 * The period a payload states, with a one-off custom range's own days.
 *
 * A recurring period is anchored to the target's calendar start, so it states its kind alone. A custom
 * range names both days; a range that ends before it starts is refused rather than swapped, because a
 * silently reversed range would measure a period the worker never chose.
 */
function periodOf(
  kind: "weekly" | "monthly" | "custom",
  calendarStart: CivilDate,
  periodEnd: string | undefined,
):
  | { readonly ok: true; readonly period: TargetPeriod }
  | { readonly ok: false; readonly field: string } {
  if (kind !== "custom") return { ok: true, period: { kind } };
  const end = periodEnd === undefined ? null : civilDateOf(periodEnd);
  if (end === null) return { ok: false, field: "A one-off custom period states the day it ends." };
  if (Temporal.PlainDate.compare(end, calendarStart) < 0) {
    return { ok: false, field: "A one-off custom period ends on or after the day it starts." };
  }
  return { ok: true, period: { kind: "custom", start: calendarStart, end } };
}

/**
 * The day a prospective version may begin at: the first period boundary that lies after the plan in
 * force, so no period is split and no proration exists.
 *
 * A change made on the first day of the current period cannot start that period again, so the boundary
 * is the next period's first day; a change made after the period started closes the period in force and
 * opens the new plan the day after it ends. A one-off custom range that has already ended has no period
 * to close, so a change to it starts on the scenario day itself.
 */
function prospectiveBoundaryOf(
  anchor: PeriodAnchor,
  today: CivilDate,
  latestEffectiveFrom: CivilDate,
): CivilDate | null {
  const current = resolvePeriodContaining(anchor, today);
  if (current.ok) {
    if (Temporal.PlainDate.compare(current.value.start, latestEffectiveFrom) > 0) {
      return current.value.start;
    }
    const next = resolvePeriodContaining(anchor, current.value.exclusiveEnd);
    return next.ok && Temporal.PlainDate.compare(next.value.start, latestEffectiveFrom) > 0
      ? next.value.start
      : null;
  }
  return Temporal.PlainDate.compare(today, latestEffectiveFrom) > 0 ? today : null;
}

/**
 * Sets a target for the first time: what it counts, how many, over which period, under the worker's own
 * private label, and whether Home lists it.
 *
 * Outcomes: `accepted` with the new target at `rev-1` and its first plan version; `alreadyAccepted` for a
 * replay; `invalid` for a one-off range that states no days or ends before it starts, or a plan the
 * calendar cannot resolve; `denied` when the caller is not admitted to the scope it claimed;
 * `unavailable` when the records cannot be read; `unknown` when the effect's fate is not known.
 */
export async function saveTarget(
  input: MutationInput<TargetSavePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: targetSavePayload,
    name: "saveTarget",
    authorize: () => SCOPE_ESTABLISHED,
    apply: (context) => applySaveTarget(context, input.payload),
  });
}

/** The target's first plan, and the version every closed period will be measured against. */
function applySaveTarget(context: MutationContext, raw: unknown): ApplyResult<TargetResult> {
  const operationId = context.operationId;
  const payload = payloadOf(targetSavePayload, raw);
  const at = now();

  const today = planningToday(at);
  if (today === null) return refuseUnavailable(operationId, "planning-calendar");
  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;

  const calendarStart =
    payload.calendarStart === undefined ? today : civilDateOf(payload.calendarStart);
  if (calendarStart === null) {
    return refuseInvalid(operationId, {
      calendarStart: ["This target starts on a real calendar day."],
    });
  }

  const period = periodOf(payload.period ?? "weekly", calendarStart, payload.periodEnd);
  if (!period.ok) return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: [period.field] });

  const targetId = `coaching-target-${operationId}`;
  const firstVersion: TargetVersion = {
    revisionId: `${targetId}-version-1`,
    effectiveFrom: calendarStart,
    quantity: payload.quantity,
    measure: payload.measure,
    calendarStart,
  };

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

  context.docs.state = withFamily(families.document, "coachingTargets", [
    ...families.targets,
    record,
  ]);

  return {
    changed: true,
    revision: FIRST_REVISION,
    created: [targetId],
    result: {
      targetId,
      state: record.state,
      revision: FIRST_REVISION,
      versionRevisionId: firstVersion.revisionId,
    },
  };
}

/**
 * Changes a target's plan, opening a prospective version when the count, the measure or the calendar
 * start changes.
 *
 * Outcomes: `accepted` with the new revision and, when a version opened, its identity; `unchanged` when
 * the payload repeats what the target already states, with no revision advance and no version;
 * `denied` for a caller who is not the worker whose target it is; `conflict` when the target has ended,
 * or when no period boundary is available to open a version at, carrying the target as it stands and the
 * caller's input; `invalid` for a plan the calendar cannot resolve; `unavailable` when the records cannot
 * be read; `unknown` when the effect's fate is not known.
 *
 * A period change alone opens no version: the version history states a quantity, a measure and a
 * calendar start, and a change to the bucket the plan is counted in is not a change to the plan.
 */
export async function editTarget(
  input: MutationInput<TargetEditPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: targetEditPayload,
    name: "editTarget",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentTargetTarget(docs, rawTargetIdOf(input)),
    apply: (context) => applyEditTarget(context, input.payload),
  });
}

/** The plan change itself, with the version boundary the calendar in force allows. */
function applyEditTarget(context: MutationContext, raw: unknown): ApplyResult<TargetResult> {
  const operationId = context.operationId;
  const payload = payloadOf(targetEditPayload, raw);
  const at = now();

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;
  const record = families.targets.find((candidate) => candidate.targetId === payload.targetId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) {
    return refuseDenied(operationId);
  }

  const today = planningToday(at);
  const period = workingPeriodOf(record);
  const calendarStart = civilDateOf(record.calendarStart);
  const versions = record.versions.map(workingVersionOf);
  if (today === null || period === null || calendarStart === null) {
    return refuseUnavailable(operationId, "coaching-target");
  }
  if (versions.some((version) => version === null)) {
    return refuseUnavailable(operationId, "coaching-target-versions");
  }
  const history = versions.filter((version): version is TargetVersion => version !== null);
  const latest = history.at(-1);
  if (latest === undefined) return refuseUnavailable(operationId, "coaching-target-versions");

  const nextMeasure: TargetMeasure = payload.measure ?? record.measure;
  const nextQuantity = payload.quantity ?? record.quantity;
  const nextCalendarStart =
    payload.calendarStart === undefined ? calendarStart : civilDateOf(payload.calendarStart);
  if (nextCalendarStart === null) {
    return refuseInvalid(operationId, {
      calendarStart: ["This target's calendar starts on a real calendar day."],
    });
  }

  const nextPeriodKind = payload.period ?? period.kind;
  const nextPeriodEnd =
    payload.periodEnd ?? (period.kind === "custom" ? serialiseCivilDate(period.end) : undefined);
  const nextPeriod = periodOf(nextPeriodKind, nextCalendarStart, nextPeriodEnd);
  if (!nextPeriod.ok) return refuseInvalid(operationId, { [ROOT_FIELD_KEY]: [nextPeriod.field] });

  const nextLabel = payload.privateLabel ?? record.privateLabel;
  const nextPlacement =
    payload.homePlacement === undefined
      ? record.homePlacement
      : payload.homePlacement
        ? "placed"
        : "unplaced";

  const planChanged =
    nextMeasure !== record.measure ||
    nextQuantity !== record.quantity ||
    Temporal.PlainDate.compare(nextCalendarStart, calendarStart) !== 0;
  const periodChanged =
    nextPeriod.period.kind !== period.kind ||
    (nextPeriod.period.kind === "custom" &&
      period.kind === "custom" &&
      !nextPeriod.period.end.equals(period.end));

  if (
    !planChanged &&
    !periodChanged &&
    nextLabel === record.privateLabel &&
    nextPlacement === record.homePlacement
  ) {
    return { changed: false };
  }

  if (record.state === "ended") {
    return refuseConflict(operationId, record.revision, targetStandingOf(record), payload);
  }

  let nextVersions: readonly TargetVersion[] = history;
  let openedVersionId: string | undefined;
  if (planChanged) {
    const boundary = prospectiveBoundaryOf({ period, calendarStart }, today, latest.effectiveFrom);
    if (boundary === null) {
      return refuseConflict(operationId, record.revision, targetStandingOf(record), payload);
    }
    const versionRevisionId = `${record.targetId}-version-${String(history.length + 1)}`;
    const planned = startProspectiveVersion({
      versions: history,
      anchor: { period, calendarStart },
      change: {
        revisionId: versionRevisionId,
        quantity: nextQuantity,
        measure: nextMeasure,
        calendarStart: nextCalendarStart,
      },
      effectiveFrom: boundary,
    });
    if (!planned.ok) {
      if (planned.error === "invalid-quantity") {
        return refuseInvalid(operationId, {
          quantity: ["A target counts a positive whole number of the measure it sets."],
        });
      }
      if (planned.error === "no-change") {
        return { changed: false };
      }
      return refuseConflict(operationId, record.revision, targetStandingOf(record), payload);
    }
    nextVersions = planned.value;
    openedVersionId = versionRevisionId;
  }

  const nextRevision = nextRevisionTokenOf(record.revision);
  const next: CoachingTargetRecord = {
    ...record,
    privateLabel: nextLabel,
    measure: nextMeasure,
    quantity: nextQuantity,
    period: storedPeriodOf(nextPeriod.period),
    calendarStart: serialiseCivilDate(nextCalendarStart),
    homePlacement: nextPlacement,
    versions: storedVersionsOf(nextVersions),
    revision: nextRevision,
  };
  context.docs.state = withFamily(
    families.document,
    "coachingTargets",
    replacingRecord(families.targets, (target) => target.targetId, record.targetId, next),
  );

  return {
    changed: true,
    revision: nextRevision,
    changedIds: [record.targetId],
    result: {
      targetId: record.targetId,
      state: next.state,
      revision: nextRevision,
      ...(openedVersionId === undefined ? {} : { versionRevisionId: openedVersionId }),
    },
  };
}

/**
 * Pauses a target: distinct from ending it and from a source that cannot be read.
 *
 * Outcomes: `accepted` with the target now `paused`; `alreadyAccepted` for a replay; `unchanged` when it
 * was already paused, with no revision advance; `denied` for a caller who is not the worker whose target
 * it is; `conflict` when the target has ended, with no revival path; `unavailable` when the records
 * cannot be read; `unknown` when the effect's fate is not known.
 */
export async function pauseTarget(
  input: MutationInput<TargetStatePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: targetStatePayload,
    name: "pauseTarget",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentTargetTarget(docs, rawTargetIdOf(input)),
    apply: (context) => applyTargetLifecycle(context, input.payload, "paused"),
  });
}

/**
 * Ends a target: its history is kept, its closed periods keep the version they were measured against, and
 * no later action reopens it.
 *
 * Outcomes are those of `pauseTarget`, with the target ending in `ended` instead of pausing.
 */
export async function endTarget(
  input: MutationInput<TargetStatePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: targetStatePayload,
    name: "endTarget",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentTargetTarget(docs, rawTargetIdOf(input)),
    apply: (context) => applyTargetLifecycle(context, input.payload, "ended"),
  });
}

/**
 * A lifecycle change: one field of the target, with the version history untouched.
 *
 * Pausing and ending are states of the target and never versions of it, so neither opens, closes nor
 * rewrites a version — which is what keeps a closed period rendering against the plan it was measured
 * against after the worker stops working towards it.
 */
function applyTargetLifecycle(
  context: MutationContext,
  raw: unknown,
  state: "paused" | "ended",
): ApplyResult<TargetResult> {
  const operationId = context.operationId;
  const payload = payloadOf(targetStatePayload, raw);

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;
  const record = families.targets.find((candidate) => candidate.targetId === payload.targetId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) {
    return refuseDenied(operationId);
  }

  if (record.state === "ended") {
    return state === "ended"
      ? { changed: false }
      : refuseConflict(operationId, record.revision, targetStandingOf(record), payload);
  }
  if (record.state === state) return { changed: false };

  const nextRevision = nextRevisionTokenOf(record.revision);
  const next: CoachingTargetRecord = { ...record, state, revision: nextRevision };
  context.docs.state = withFamily(
    families.document,
    "coachingTargets",
    replacingRecord(families.targets, (target) => target.targetId, record.targetId, next),
  );

  return {
    changed: true,
    revision: nextRevision,
    changedIds: [record.targetId],
    result: { targetId: record.targetId, state, revision: nextRevision },
  };
}

/** The target of a target change, for the runner's revision comparison. */
function currentTargetTarget(
  docs: StateDocumentCarrier,
  targetId: string | undefined,
): CurrentTarget {
  if (targetId === undefined) return { kind: "absent" };
  const loaded = readFamilies(docs);
  if (!loaded.ok) return { kind: "absent" };
  const record = loaded.families.targets.find((candidate) => candidate.targetId === targetId);
  return record === undefined
    ? { kind: "absent" }
    : { kind: "record", revision: record.revision, value: targetStandingOf(record) };
}

/** The target identifier a raw payload names, read without trusting its type. */
function rawTargetIdOf(input: unknown): string | undefined {
  return rawIdentifierOf(input, "targetId");
}

// ---------------------------------------------------------------------------------------------
// Check-ins
// ---------------------------------------------------------------------------------------------

/** A check-in's standing, which is all a conflict or a result names about it. */
function checkInStandingOf(record: CoachingCheckInRecord): CheckInResult {
  return {
    checkInId: record.checkInId,
    state:
      record.shared === null
        ? "private-draft"
        : record.shared.withdrawnAt === null
          ? "shared"
          : "withdrawn",
    revision: record.revision,
    ...(record.privateDraft === null ? {} : { privateRevisionId: record.privateDraft.revisionId }),
    ...(record.shared === null ? {} : { sharedRevisionId: record.shared.revisionId }),
  };
}

/** The grant a check-in belongs to, which is the relationship the check-in was written inside. */
function checkInGrantOf(
  families: CoachingFamilies,
  principalId: string,
  scope: Scope,
): CoachingGrantRecord | undefined {
  const live = families.grants.filter(
    (grant) =>
      grant.workerPrincipalId === principalId &&
      (grant.state === "accepted" || grant.state === "active"),
  );
  return live.find((grant) => grant.ministryIds.includes(scope.ministryId)) ?? live.at(0);
}

/** The duration a check-in's shared revision records, taken from the relationship it was shared under. */
function checkInSharedDurationOf(
  families: CoachingFamilies,
  record: CoachingCheckInRecord,
): CoachingDurationRecord | undefined {
  const grant = families.grants.find((candidate) => candidate.grantId === record.grantId);
  return grant === undefined ? record.shared?.duration : grant.duration;
}

/**
 * Whether a payload's question and answer lists line up, stated with both counts and never padded.
 *
 * An empty question set is the legal "no prompts" form, so answers without prompts are prose that answers
 * nothing in particular rather than a list that failed to line up. Where prompts exist, each answer
 * answers one of them, and a list that does not line up is refused rather than padded: a padded answer
 * would read as an answer the worker never wrote.
 */
function refuseMisalignedCheckIn(
  operationId: string,
  questions: readonly string[],
  answers: readonly string[],
): RefusalResult | null {
  if (questions.length === 0 || questions.length === answers.length) return null;
  return refuseInvalid(operationId, {
    answers: [
      `This check-in carries ${String(answers.length)} answers and ${String(questions.length)} questions. Nothing was padded or dropped: give each question one answer and save again.`,
    ],
  });
}

/** The refusal a check-in module refusal becomes, with no check-in text and no recipient named. */
function refuseFromCheckIn(
  operationId: string,
  refusal: CheckInRefusal,
  record: CoachingCheckInRecord,
  preservedInput: unknown,
): RefusalResult {
  if (refusal.violations.length > 0) {
    const fields: Record<string, string[]> = {};
    for (const violation of refusal.violations) {
      const existing = fields[violation.path];
      if (existing === undefined) {
        fields[violation.path] = [violation.message];
      } else if (!existing.includes(violation.message)) {
        existing.push(violation.message);
      }
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
      return refuseConflict(
        operationId,
        record.revision,
        checkInStandingOf(record),
        preservedInput,
      );
  }
}

/**
 * Saves the worker's private draft of a check-in.
 *
 * Outcomes: `accepted` with the private revision identity; `unchanged` when the text repeats what the
 * draft already holds, with no revision advance; `denied` for a caller who is not the worker whose
 * check-in it is; `invalid` for a request over one of the check-in limits — with every violation, each
 * measured value and its limit, and never a shortened value — or for a check-in the worker has no
 * coaching relationship to write inside; `unavailable` when the records cannot be read; `unknown` when
 * the effect's fate is not known.
 *
 * This is private autosave: it creates or updates the private draft and shares nothing. No coach can read
 * it, and nothing about it changes a shared revision.
 */
export async function saveCheckIn(
  input: MutationInput<SaveCheckInPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: saveCheckInPayload,
    name: "saveCheckIn",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentCheckInTarget(docs, rawCheckInIdOf(input)),
    apply: (context) => applySaveCheckIn(context, input.payload, input.scope),
  });
}

/** The autosave itself: the private draft, and nothing a coach can read. */
function applySaveCheckIn(
  context: MutationContext,
  raw: unknown,
  scope: Scope,
): ApplyResult<CheckInResult> {
  const operationId = context.operationId;
  const payload = payloadOf(saveCheckInPayload, raw);
  const at = now();

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;

  const questions = payload.questions ?? [];
  const misaligned = refuseMisalignedCheckIn(operationId, questions, payload.answers);
  if (misaligned !== null) return misaligned;

  let record: CoachingCheckInRecord;
  let working: CheckIn;
  if (payload.checkInId === undefined) {
    const grant = checkInGrantOf(families, context.session.principalId, scope);
    if (grant === undefined) {
      return refuseInvalid(operationId, {
        [ROOT_FIELD_KEY]: [
          "A check-in belongs to a coaching relationship, and none is open here: invite a coach first.",
        ],
      });
    }
    record = {
      checkInId: `coaching-check-in-${operationId}`,
      workerPrincipalId: context.session.principalId,
      grantId: grant.grantId,
      privateDraft: null,
      shared: null,
      revision: FIRST_REVISION,
    };
    working = { checkInId: record.checkInId, revision: revisionOrdinalOf(FIRST_REVISION) };
  } else {
    const found = families.checkIns.find((candidate) => candidate.checkInId === payload.checkInId);
    if (found === undefined || found.workerPrincipalId !== context.session.principalId) {
      return refuseDenied(operationId);
    }
    record = found;
    const workingRecord = workingCheckInOf(found);
    if (workingRecord === null) return refuseUnavailable(operationId, "coaching-check-in");
    working = workingRecord;
  }

  const saved = savePrivateDraft(
    working,
    checkInPayloadOf(questions, payload.answers),
    revisionOrdinalOf(record.revision),
    at,
  );
  if (!saved.ok) return refuseFromCheckIn(operationId, saved.error, record, payload);
  if (!saved.value.changed) return { changed: false };

  // A check-in this mutation creates stands at its first revision; every later autosave advances it.
  const nextRevision =
    payload.checkInId === undefined ? FIRST_REVISION : nextRevisionTokenOf(record.revision);
  const sharedDuration = checkInSharedDurationOf(families, record);
  const next = storedCheckInOf(record, saved.value.checkIn, nextRevision, sharedDuration);
  if (next === null) return refuseUnavailable(operationId, "coaching-check-in");

  context.docs.state = withFamily(
    families.document,
    "coachingCheckIns",
    payload.checkInId === undefined
      ? [...families.checkIns, next]
      : replacingRecord(families.checkIns, (checkIn) => checkIn.checkInId, record.checkInId, next),
  );

  return {
    changed: true,
    revision: nextRevision,
    ...(payload.checkInId === undefined
      ? { created: [record.checkInId] }
      : { changedIds: [record.checkInId] }),
    result: checkInStandingOf(next),
  };
}

/**
 * Shares the saved private draft, creating the one revision a named coach may read.
 *
 * Outcomes: `accepted` with the shared revision identity; `denied` for a caller who is not the worker,
 * or whose relationship is not open; `conflict` when the check-in was already shared (update the shared
 * revision instead), when nothing is saved to share, or when the relationship's frozen cutoff has passed;
 * `invalid` for a body that does not match the saved draft or a request over a check-in limit, with the
 * measured values and no truncation; `unavailable` when a record it needs cannot be read; `unknown` when
 * the effect's fate is not known. Sharing sends no notification, records no interaction and creates no
 * task.
 */
export async function shareCheckIn(
  input: MutationInput<ShareCheckInPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: shareCheckInPayload,
    name: "shareCheckIn",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentCheckInTarget(docs, rawCheckInIdOf(input)),
    apply: (context) => applyShareCheckIn(context, input.payload, input.scope),
  });
}

/** The share itself: one snapshot of the saved private draft, under the relationship's own duration. */
function applyShareCheckIn(
  context: MutationContext,
  raw: unknown,
  scope: Scope,
): ApplyResult<CheckInResult> {
  const operationId = context.operationId;
  const payload = payloadOf(shareCheckInPayload, raw);
  const at = now();

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;
  const record = families.checkIns.find((candidate) => candidate.checkInId === payload.checkInId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) {
    return refuseDenied(operationId);
  }
  const working = workingCheckInOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-check-in");

  const grantRecord = families.grants.find((candidate) => candidate.grantId === record.grantId);
  const grant = grantRecord === undefined ? null : workingGrantOf(grantRecord);
  if (grantRecord === undefined || grant === null) {
    return refuseUnavailable(operationId, "coaching-grant");
  }

  // The relationship must still be open: a share inside a revoked, ended or expired episode, or past its
  // frozen cutoff, is refused rather than recorded as a disclosure nobody may read.
  const episode = activeGrant(
    grant,
    accessContextOf(grantRecord, context.session.principalId, "worker", scope),
    at,
  );
  if (!episode.ok) return refuseFromCoaching(operationId, episode.error, grantRecord, payload);

  const duration = checkInShareDurationOf(grantRecord.duration);
  if (duration === null) return refuseUnavailable(operationId, "coaching-grant");

  // A share records the duration the relationship was accepted with. A payload that states another kind
  // is asking to widen or shorten that window, which a share is not the act that can do.
  if (payload.duration !== undefined && payload.duration.kind !== grantRecord.duration.kind) {
    return refuseInvalid(operationId, {
      duration: [
        "A shared check-in records the duration this relationship was accepted with, so the share cannot state another.",
      ],
    });
  }

  const draft = working.privateDraft;
  if (payload.questions !== undefined || payload.answers !== undefined) {
    if (draft === undefined) {
      return refuseInvalid(operationId, {
        [ROOT_FIELD_KEY]: [
          "There is no private draft to share yet. Save the draft, then share it.",
        ],
      });
    }
    const questions =
      payload.questions ?? draft.captured.questions.map((question) => question.wording);
    const misaligned = refuseMisalignedCheckIn(operationId, questions, payload.answers ?? []);
    if (misaligned !== null) return misaligned;
    const bodyDiffers =
      questions.some((wording, index) => wording !== draft.captured.questions[index]?.wording) ||
      (payload.answers ?? []).some((text, index) => text !== draft.answers[index]?.text);
    if (bodyDiffers) {
      return refuseInvalid(operationId, {
        answers: [
          "The text on screen is not the saved draft, so nothing was shared. Save the private draft, then share it, so a coach reads the wording you reviewed.",
        ],
      });
    }
  }

  const recipients = payload.recipients ?? [grantRecord.coachPrincipalId];
  const shared = openCheckInShare(
    working,
    revisionOrdinalOf(record.revision),
    recipients,
    duration,
    at,
  );
  if (!shared.ok) return refuseFromCheckIn(operationId, shared.error, record, payload);

  const nextRevision = nextRevisionTokenOf(record.revision);
  const next = storedCheckInOf(record, shared.value.checkIn, nextRevision, grantRecord.duration);
  if (next === null) return refuseUnavailable(operationId, "coaching-check-in");

  context.docs.state = withFamily(
    families.document,
    "coachingCheckIns",
    replacingRecord(families.checkIns, (checkIn) => checkIn.checkInId, record.checkInId, next),
  );

  return {
    changed: true,
    revision: nextRevision,
    changedIds: [record.checkInId],
    result: checkInStandingOf(next),
  };
}

/**
 * Changes the shared revision of a check-in, which no other operation may.
 *
 * Outcomes: `accepted` with the shared revision identity; `unchanged` when the answers repeat what the
 * coach already reads, with no revision advance; `denied` for a caller who is not the worker; `conflict`
 * when the check-in shares nothing, its share was withdrawn, or the revision the caller read is no longer
 * the current one; `invalid` for a request over a limit, with the measured value and no truncation;
 * `unavailable` when a record it needs cannot be read; `unknown` when the effect's fate is not known.
 *
 * The captured question set governs: a payload cannot reword the prompts behind a revision a coach is
 * already reading, and an answer for a question outside that set is refused rather than attached to it.
 */
export async function updateSharedCheckIn(
  input: MutationInput<UpdateSharedCheckInPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: updateSharedCheckInPayload,
    name: "updateSharedCheckIn",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentCheckInTarget(docs, rawCheckInIdOf(input)),
    apply: (context) => applyUpdateSharedCheckIn(context, input.payload),
  });
}

/** The shared revision's change: the answers it now holds, under the captured prompts. */
function applyUpdateSharedCheckIn(
  context: MutationContext,
  raw: unknown,
): ApplyResult<CheckInResult> {
  const operationId = context.operationId;
  const payload = payloadOf(updateSharedCheckInPayload, raw);
  const at = now();

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;
  const record = families.checkIns.find((candidate) => candidate.checkInId === payload.checkInId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) {
    return refuseDenied(operationId);
  }
  const working = workingCheckInOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-check-in");

  if (
    payload.sharedRevisionId !== undefined &&
    (record.shared === null || payload.sharedRevisionId !== record.shared.revisionId)
  ) {
    return refuseConflict(operationId, record.revision, checkInStandingOf(record), payload);
  }

  const captured = working.shared?.captured.questions ?? [];
  const questions =
    payload.questions === undefined
      ? captured.map((question) => question.wording)
      : payload.questions;
  const misaligned = refuseMisalignedCheckIn(operationId, questions, payload.answers);
  if (misaligned !== null) return misaligned;

  const revised = reviseSharedCheckIn(
    working,
    checkInPayloadOf(questions, payload.answers),
    revisionOrdinalOf(record.revision),
    at,
  );
  if (!revised.ok) return refuseFromCheckIn(operationId, revised.error, record, payload);
  if (!revised.value.changed) return { changed: false };

  const nextRevision = nextRevisionTokenOf(record.revision);
  const sharedDuration = checkInSharedDurationOf(families, record);
  const next = storedCheckInOf(record, revised.value.checkIn, nextRevision, sharedDuration);
  if (next === null) return refuseUnavailable(operationId, "coaching-check-in");

  context.docs.state = withFamily(
    families.document,
    "coachingCheckIns",
    replacingRecord(families.checkIns, (checkIn) => checkIn.checkInId, record.checkInId, next),
  );

  return {
    changed: true,
    revision: nextRevision,
    changedIds: [record.checkInId],
    result: checkInStandingOf(next),
  };
}

/**
 * Withdraws a shared check-in, so a coach can no longer open it.
 *
 * Outcomes: `accepted` with the check-in now withdrawn; `unchanged` when it was already withdrawn, with
 * no revision advance; `denied` for a caller who is not the worker; `conflict` when nothing is shared;
 * `unavailable` when a record it needs cannot be read; `unknown` when the effect's fate is not known.
 *
 * It validates no content at all, so an invalid draft elsewhere in the application cannot block it, and
 * it claims no recall: withdrawal removes access from this moment and cannot take back what a coach has
 * already read. The private draft is left exactly as it was.
 */
export async function withdrawCheckIn(
  input: MutationInput<WithdrawCheckInPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: withdrawCheckInPayload,
    name: "withdrawCheckIn",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentCheckInTarget(docs, rawCheckInIdOf(input)),
    apply: (context) => applyWithdrawCheckIn(context, input.payload),
  });
}

/** The withdrawal itself: the shared revision's access ends; nothing is deleted. */
function applyWithdrawCheckIn(context: MutationContext, raw: unknown): ApplyResult<CheckInResult> {
  const operationId = context.operationId;
  const payload = payloadOf(withdrawCheckInPayload, raw);
  const at = now();

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;
  const record = families.checkIns.find((candidate) => candidate.checkInId === payload.checkInId);
  if (record === undefined || record.workerPrincipalId !== context.session.principalId) {
    return refuseDenied(operationId);
  }
  const working = workingCheckInOf(record);
  if (working === null) return refuseUnavailable(operationId, "coaching-check-in");

  if (
    payload.sharedRevisionId !== undefined &&
    (record.shared === null || payload.sharedRevisionId !== record.shared.revisionId)
  ) {
    return refuseConflict(operationId, record.revision, checkInStandingOf(record), payload);
  }

  const withdrawn = withdrawSharedCheckIn(working, revisionOrdinalOf(record.revision), at);
  if (!withdrawn.ok) return refuseFromCheckIn(operationId, withdrawn.error, record, payload);
  if (!withdrawn.value.changed) return { changed: false };

  const nextRevision = nextRevisionTokenOf(record.revision);
  const sharedDuration = checkInSharedDurationOf(families, record);
  const next = storedCheckInOf(record, withdrawn.value.checkIn, nextRevision, sharedDuration);
  if (next === null) return refuseUnavailable(operationId, "coaching-check-in");

  context.docs.state = withFamily(
    families.document,
    "coachingCheckIns",
    replacingRecord(families.checkIns, (checkIn) => checkIn.checkInId, record.checkInId, next),
  );

  return {
    changed: true,
    revision: nextRevision,
    changedIds: [record.checkInId],
    result: checkInStandingOf(next),
  };
}

/** The check-in target of a check-in change, for the runner's revision comparison. */
function currentCheckInTarget(
  docs: StateDocumentCarrier,
  checkInId: string | undefined,
): CurrentTarget {
  if (checkInId === undefined) return { kind: "absent" };
  const loaded = readFamilies(docs);
  if (!loaded.ok) return { kind: "absent" };
  const record = loaded.families.checkIns.find((candidate) => candidate.checkInId === checkInId);
  return record === undefined
    ? { kind: "absent" }
    : { kind: "record", revision: record.revision, value: checkInStandingOf(record) };
}

/** The check-in identifier a raw payload names, read without trusting its type. */
function rawCheckInIdOf(input: unknown): string | undefined {
  return rawIdentifierOf(input, "checkInId");
}

// ---------------------------------------------------------------------------------------------
// Task summaries
// ---------------------------------------------------------------------------------------------

/** A share's standing, which is all a conflict or a result names about it. */
function taskShareStandingOf(record: CoachingTaskShareRecord): TaskShareResult {
  return {
    shareId: record.shareId,
    taskId: record.taskId,
    state: record.state,
    revision: String(record.revision),
  };
}

/**
 * Shares a reviewed description of one task occurrence with the coach the worker shares with.
 *
 * Outcomes: `accepted` with the share's identity; `unchanged` when the same description is already shared
 * for that occurrence, with no revision advance; `denied` for a caller who is not the task's owner;
 * `conflict` when a different description is already shared for that occurrence — stop it first, so one
 * occurrence never carries two summaries — or when the revision presented is no longer current;
 * `invalid` for a blank description, a description over 240 Unicode code points (refused with its
 * measured count and never shortened), a review of a task state that has since changed, or a recurring
 * task whose occurrence was not selected; `unavailable` when the records cannot be read; `unknown` when
 * the effect's fate is not known.
 *
 * The share carries the reviewed description, its measured length, the fingerprint it was reviewed
 * against and the occurrence it covers. It carries no title, note, donor, amount, attachment, source
 * reference or link, creates no task, sets no deadline, and leaves the task exactly as it was.
 */
export async function shareTaskSummary(
  input: MutationInput<TaskSharePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: taskSharePayload,
    name: "shareTaskSummary",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentTaskTarget(docs, rawTaskIdOf(input)),
    apply: (context) => applyShareTaskSummary(context, input.payload),
  });
}

/** The share itself: the reviewed description, and the occurrence the worker selected. */
function applyShareTaskSummary(
  context: MutationContext,
  raw: unknown,
): ApplyResult<TaskShareResult> {
  const operationId = context.operationId;
  const payload = payloadOf(taskSharePayload, raw);
  const at = now();

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;
  const task = families.tasks.find((candidate) => candidate.taskId === payload.taskId);
  if (task === undefined || task.ownerPrincipalId !== context.session.principalId) {
    return refuseDenied(operationId);
  }

  // A recurring task's next occurrence never inherits the predecessor's share: the occurrence identity
  // must be the one the worker selected, so a summary never appears in front of a coach for work nobody
  // chose to share. A task that does not recur has exactly one occurrence, whose identity is the task's.
  const occurrenceId = payload.occurrenceId ?? (task.seriesId === null ? task.taskId : undefined);
  if (occurrenceId === undefined) {
    return refuseInvalid(operationId, {
      occurrenceId: [
        "A recurring task's next occurrence is shared only when it is selected, so choose the occurrence you want to share.",
      ],
    });
  }

  const fingerprint = taskReviewedFingerprint(task);
  if (payload.reviewedFingerprint !== undefined && payload.reviewedFingerprint !== fingerprint) {
    return refuseInvalid(operationId, {
      reviewedFingerprint: [
        "This task changed since that description was reviewed, so nothing was shared. Review the description again and share it.",
      ],
    });
  }

  const reviewed = reviewTaskSummary(payload.safeDescription, at);
  if (!reviewed.ok) return refuseFromTaskShare(operationId, reviewed.error);

  const existing = families.taskShares.find(
    (share) =>
      share.taskId === task.taskId &&
      share.occurrenceId === occurrenceId &&
      share.state === "shared",
  );
  if (existing !== undefined) {
    const same =
      existing.reviewedSummary.description === reviewed.value.description &&
      existing.reviewedFingerprint === fingerprint;
    return same
      ? { changed: false }
      : refuseConflict(
          operationId,
          String(existing.revision),
          taskShareStandingOf(existing),
          payload,
        );
  }

  const shareId = `coaching-task-share-${operationId}`;
  const record: CoachingTaskShareRecord = {
    shareId,
    taskId: task.taskId,
    occurrenceId,
    reviewedSummary: {
      description: reviewed.value.description,
      codePoints: reviewed.value.codePoints,
      reviewedAt: at.toString(),
    },
    reviewedFingerprint: fingerprint,
    state: "shared",
    revision: 1,
    withdrawnAt: null,
  };

  context.docs.state = withFamily(families.document, "coachingTaskShares", [
    ...families.taskShares,
    record,
  ]);

  return {
    changed: true,
    revision: String(record.revision),
    created: [shareId],
    result: taskShareStandingOf(record),
  };
}

/**
 * Stops sharing one occurrence's summary.
 *
 * Outcomes: `accepted` with the share now removed; `unchanged` when it was already stopped, with no
 * revision advance; `denied` for a caller who is not the task's owner; `conflict` when the share's own
 * revision moved since it was read; `unavailable` when the task behind the share cannot be read;
 * `unknown` when the effect's fate is not known.
 *
 * The task is untouched: its status, its due date and its existence survive a stop exactly as they were.
 * Stopping validates nothing else in the document, so it works while an unrelated draft is invalid, and
 * it claims no recall of what a coach has already read.
 */
export async function stopTaskShare(
  input: MutationInput<StopTaskSharePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const session = await mutationSessionId(source, operationId);
  if (!session.ok) return session.outcome;

  return runMutation({
    sessionId: session.sessionId,
    input,
    schema: stopTaskSharePayload,
    name: "stopTaskShare",
    authorize: () => SCOPE_ESTABLISHED,
    readCurrent: (docs) => currentShareTarget(docs, rawShareIdOf(input)),
    apply: (context) => applyStopTaskShare(context, input.payload),
  });
}

/** The stop itself: the share's lifecycle, and nothing of the task's. */
function applyStopTaskShare(context: MutationContext, raw: unknown): ApplyResult<TaskShareResult> {
  const operationId = context.operationId;
  const payload = payloadOf(stopTaskSharePayload, raw);
  const at = now();

  const loaded = readFamilies(context.docs);
  if (!loaded.ok) return refuseUnavailable(operationId, loaded.reference);
  const { families } = loaded;
  const record = families.taskShares.find(
    (candidate) => candidate.shareId === stoppedShareIdOf(payload),
  );
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

  const next: CoachingTaskShareRecord = {
    ...record,
    state: stopped.value.state,
    revision: stopped.value.revision,
    withdrawnAt:
      stopped.value.withdrawnAt === undefined ? null : stopped.value.withdrawnAt.toString(),
  };
  context.docs.state = withFamily(
    families.document,
    "coachingTaskShares",
    replacingRecord(families.taskShares, (share) => share.shareId, record.shareId, next),
  );

  return {
    changed: true,
    revision: String(next.revision),
    changedIds: [record.shareId],
    result: taskShareStandingOf(next),
  };
}

/** The task target of a share, for the runner's revision comparison: the task the summary covers. */
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
        // The task's own fields are not a conflict payload: a surface compares the revision it read and
        // the status it shows, and nothing of the task's text or its people travels back here.
        value: { taskId: record.taskId, status: record.status, revision: record.revision },
      };
}

/** The share target of a stop, for the runner's revision comparison. */
function currentShareTarget(
  docs: StateDocumentCarrier,
  shareId: string | undefined,
): CurrentTarget {
  if (shareId === undefined) return { kind: "absent" };
  const loaded = readFamilies(docs);
  if (!loaded.ok) return { kind: "absent" };
  const record = loaded.families.taskShares.find((candidate) => candidate.shareId === shareId);
  return record === undefined
    ? { kind: "absent" }
    : { kind: "record", revision: String(record.revision), value: taskShareStandingOf(record) };
}

/** The task identifier a raw payload names, read without trusting its type. */
function rawTaskIdOf(input: unknown): string | undefined {
  return rawIdentifierOf(input, "taskId");
}

/** The share identifier a raw payload names, under either accepted naming. */
function rawShareIdOf(input: unknown): string | undefined {
  return rawIdentifierOf(input, "shareId") ?? rawIdentifierOf(input, "taskShareId");
}

/**
 * One identifier a raw payload names, read structurally before anything is validated.
 *
 * A body arrives from a browser, so the locator that finds the record a conflict would name reads the
 * identifier without trusting its type: a value that is not a non-empty string locates nothing, and the
 * mutation's own schema is what reports the field if the request reaches its transaction.
 */
function rawIdentifierOf(input: unknown, field: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const payload: unknown = Reflect.get(input, "payload");
  if (typeof payload !== "object" || payload === null) return undefined;
  const value: unknown = Reflect.get(payload, field);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
