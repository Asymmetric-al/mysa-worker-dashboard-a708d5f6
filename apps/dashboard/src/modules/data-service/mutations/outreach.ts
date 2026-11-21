/**
 * The outreach mutations: the twelve named commands that create and maintain an initiative's
 * reviewed working list, the versioned Requests presented inside it, and the referral cycles that
 * record an original introduction date and the window resolved from it.
 *
 * The twelve names are the whole surface, and each answers one job:
 * `createInitiative`, `addMembers`, `removeMember`, `returnMember`, `setStage`,
 * `draftRequest`, `presentRequest`, `recordRequestResponse`,
 * `closeInitiative`, `reopenInitiative`, `recordIntroduction`, `continueReferral`.
 *
 * Plan items that put this file in scope: AAP 0.6.1's "Mutations: initiatives and referrals" row,
 * 0.7.1's job groups "Coordinate outreach" and "Act on an introduction", 0.8.3 (outreach, Requests
 * and referrals), 0.8.7 (the referral New and continuation windows), 0.9.1's mutation tree and
 * 0.11.1's "(9 files)" row; success criteria 14 and 15 are the evidence.
 *
 * What this module refuses to blur, because each distinction is a workflow's meaning rather than a
 * presentational preference:
 *
 * - **Inclusion is not consent.** A working-list member is `included`, `removed` or `excluded` and
 *   nothing else. Adding a partner records inclusion — never "asked", never contact permission,
 *   never membership of an Update's audience — and only an explicitly selected, eligible partner is
 *   added, because a later filter that happens to match someone never joins the list. A removal
 *   keeps the history of having been included and preserves every independent obligation recorded
 *   elsewhere, and an exclusion is a deliberate decision that no other command reverses silently.
 * - **A stage predicts nothing.** A stage is a human assessment drawn from the source-approved list;
 *   recording the same value again is a no-op that writes no history, and changing one creates no
 *   task, unpauses nothing and measures no worth.
 * - **A Request is an invitation, not a transaction.** Its terms are *requested* terms, versioned;
 *   its presentation records what was actually shown; its response is the named respondent's own
 *   answer, bound to the terms version it answers. Agreement creates no pledge, gift, commitment,
 *   subscription, receipt, task or send — none of those records is written here, and money in an ask
 *   never enters a support projection.
 * - **An introduction date is evidence.** The recorded date is the date of the introduction itself
 *   with the precision it is known to, kept apart from entry time: import, first view, reassignment,
 *   merge and retry are never a new introduction, so the same source reference for the same partner
 *   is a no-op. A late first entry may already be expired, because the window is computed from the
 *   original date and never started today.
 * - **A continuation is not an introduction.** It needs an ordinarily expired New window, the
 *   worker-continuation setting, and a cycle that has not already been continued; it ends at the
 *   acceptance instant plus elapsed seconds, produces at most one successor even under a race, and
 *   grants no contact consent, no supporter interest, no interaction credit and no new introduction.
 *
 * The contract every mutation in this folder is built on is AAP 0.7.1's: a caller presents
 * `{ operationId, scope, expectedRevision, payload }` and receives exactly one outcome from the
 * closed set `../outcome` owns. Validation, authorisation, replay detection, the revision
 * comparison, the effect, the scope re-check and the ledger entry all happen inside
 * `../operations`' `runMutation`, in that order, in one store transaction; this file contributes one
 * concrete schema per mutation and one concrete apply function, and never validates its own
 * envelope, compares its own revision, writes its own ledger entry or reaches the store.
 *
 * Three consequences of that runner shape are stated here rather than discovered later:
 *
 * - `runMutation` serialises its transaction by session, so every mutation in this folder takes
 *   `(input, source?)` and `runOutreachMutation` establishes the session the attempt acts for before
 *   a transaction opens; the runner then resolves it again authoritatively and refuses a request that
 *   claims a session it did not come from. The same call shape is what the sibling mutation families
 *   expose, so one Route Handler composes any of them identically.
 * - `runMutation` asks a mutation's own authority question with the resolved session alone, and
 *   locates the target with the transaction's documents alone, so neither hook is given the
 *   validated payload. `runOutreachMutation` below is the one place that validation result is
 *   narrowed for them. It is not a dispatcher: every call names a concrete schema and concrete
 *   hooks, so there is no table, no field map and nothing to dispatch on.
 * - A record-level fact that refuses a change — a record in another ministry, an initiative someone
 *   else is responsible for, an id this session does not hold — is decided inside the transaction,
 *   where the record is readable, and answered as `denied` with the closed set's `no-permission`
 *   reason code: the three reasons answer alike, so nothing about what the record holds is disclosed,
 *   and the caller still reads that the change was refused rather than that there was nothing to do.
 *   A refusal of the payload against the record it names — a closed initiative, a terms version that
 *   was never presented, a member who is not on the list — is a thrown `ZodError`, which the runner
 *   answers as `invalid` with a message keyed by the field the caller must change.
 *
 * Every window judgement comes from `@/modules/time/window` and every civil date from
 * `@/modules/time/civil`; no boundary, DST resolution or elapsed-second span is computed here. Every
 * command instant is the session's own scenario clock (`instantAt(session.clockOffsetMs)`), so two
 * sessions running in different scenarios are judged at their own now rather than at whichever
 * offset the process last held. Nothing here reads a wall clock, a file, a network or the
 * machine's locale, and nothing logs: diagnostics belong to `runMutation`.
 *
 * Layering: a service mutation module. It imports the session, scope and permission decisions of
 * `../authorize`, the record shapes and closed vocabularies of `../envelope`, the outcome vocabulary
 * of `../outcome`, the runner of `../operations`, the fixed boundaries of `@/modules/time/*`, the
 * currency table of `@/modules/money/currency`, the scenario flags that own the worker-continuation
 * setting, and `@/lib/ids` for the one permitted source-reference comparison. It imports no store,
 * no component, no feature and no application route, and it scaffolds no integration: no CRM
 * adapter, no campaign or automation engine, no reminder job and no provider client.
 */
import { Temporal } from "temporal-polyfill";
import { ZodError, z } from "zod";

import { sameSourceReference, type SourceReference } from "@/lib/ids";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import { isKnownCurrency } from "@/modules/money/currency";
import { instantAt } from "@/modules/time/clock";
import {
  DATE_PRECISIONS,
  parseCivilDate,
  serialiseCivilDate,
  startOfCivilDay,
  type CivilDate,
} from "@/modules/time/civil";
import { continuedWindowEnd, newWindowEnd, referralWindowState } from "@/modules/time/window";

import {
  assertScope,
  outcomeOfRefusal,
  resolveSession,
  type ResolvedSession,
  type ScopeDecision,
  type SessionSource,
} from "../authorize";
import {
  REQUEST_RESPONSE_KINDS,
  initiativeMemberRecordSchema,
  initiativeRecordSchema,
  moneySchema,
  partnerRecordSchema,
  referralCycleRecordSchema,
  requestRecordSchema,
  sessionContextRecordSchema,
  taskRecordSchema,
  type InitiativeMemberRecord,
  type InitiativeRecord,
  type MutationInput,
  type ReferralCycleRecord,
  type RequestPresentation,
  type RequestRecord,
  type RequestResponse,
  type RequestResponseKind,
  type RequestTerms,
  type Scope,
} from "../envelope";
import {
  runMutation,
  type ApplyResult,
  type CurrentTarget,
  type MutationContext,
} from "../operations";
import { denied, type MutationOutcome, type MutationResult, type PerItemResult } from "../outcome";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The revision a record this build creates starts at, which is the same first revision the seed
 * writes, so a created record and a seeded one are indistinguishable to the next write.
 */
const FIRST_REVISION = "rev-1";

/** A stored revision's trailing counter, which `nextRevision` advances by one. */
const REVISION_COUNTER = /^(?<prefix>.*-)(?<counter>\d+)$/u;

/**
 * The stages the source-approved list offers, stated here in the same closed set the read offers for
 * its compact selector.
 *
 * `reads/outreach.ts` keeps its own copy private on purpose — the vocabulary reaches a surface
 * through the value a read reports, never as an exported list — so the write path states the set it
 * admits. Only these values may be recorded: a stored value the source no longer offers is still
 * shown by the read as retired so it can be replaced deliberately, which is why a write never accepts
 * an arbitrary string in their place.
 */
const INITIATIVE_STAGES = [
  "Not yet asked",
  "Asked",
  "Answered",
  "Follow up due",
  "Paused",
] as const;

/**
 * How many calendar days the release's referral New window runs over, and how many elapsed days a
 * continuation runs over.
 *
 * The specification fixes the arithmetic and leaves the period to the builder (AAP 0.8.7), and the
 * development runtime states the same two periods for the cycles it seeds. They are stated here as
 * well because a recorded introduction must resolve to the same window a seeded one does, and a
 * service mutation may not import the seed.
 */
const REFERRAL_NEW_WINDOW_DAYS = 14;
const REFERRAL_CONTINUATION_DAYS = 30;

/** The most partners one selection may add, matching a list page of the application's cap. */
const MAX_SELECTED_PARTNERS = 200;

/**
 * The name a decoded-but-unusable session document is reported under.
 *
 * The runner recognises this fault structurally (`outcome.ts` names it) because the data service may
 * not import the store, so a document that exists but cannot be read as this build's records becomes
 * `unavailable` for the local store rather than `unknown` or an empty answer.
 */
const CORRUPT_DOCUMENT_FAULT = "CorruptJsonError";

// ---------------------------------------------------------------------------------------------
// Field schemas shared by the twelve payloads
// ---------------------------------------------------------------------------------------------

/**
 * Builds a trimmed text field whose length is bounded in Unicode code points.
 *
 * `.min`/`.max` count UTF-16 code units and would refuse a valid astral-plane value, so length is
 * measured over the code points a reader counts. A blank value is refused rather than silently
 * treated as absent, because every field built here is required.
 */
function boundedTextSchema(
  maxCodePoints: number,
  messages: { readonly required: string; readonly tooLong: string },
): z.ZodString {
  return z
    .string()
    .trim()
    .superRefine((value, context) => {
      const length = Array.from(value).length;
      if (length === 0) {
        context.addIssue({ code: "custom", message: messages.required });
      } else if (length > maxCodePoints) {
        context.addIssue({ code: "custom", message: messages.tooLong });
      }
    });
}

/** An opaque reference the caller supplies: trimmed, never parsed, never compared loosely. */
function identifierFieldSchema(message: string): z.ZodString {
  return z.string().trim().min(1, message);
}

/**
 * A civil date carried as `YYYY-MM-DD` and read by the one civil-date implementation.
 *
 * Shape and calendar in one check: `2026-02-31` has the shape of a date yet names no day, so it is
 * refused rather than rolled forward. The result is the parsed `Temporal.PlainDate` the boundary
 * functions take, so no second parse and no invented midnight happens downstream.
 */
const civilDateSchema: z.ZodType<CivilDate> = z
  .string()
  .trim()
  .transform((value: string, context) => {
    const parsed = parseCivilDate(value);
    if (parsed.status === "refused") {
      context.addIssue({ code: "custom", message: "Enter a real calendar date as YYYY-MM-DD." });
      return z.NEVER;
    }
    return parsed.date;
  });

/** An opaque, source-qualified reference to a record another system owns. */
const sourceReferenceFieldSchema: z.ZodType<SourceReference> = z.strictObject({
  system: z.string().trim().min(1, "Name the source system that issued this reference."),
  reference: z.string().trim().min(1, "Enter the reference the source issued."),
});

// ---------------------------------------------------------------------------------------------
// The stored records these mutations read and write
// ---------------------------------------------------------------------------------------------

/**
 * The members of a session's state document these twelve mutations need.
 *
 * Each collection is validated through the record schema `../envelope` declares — the single
 * declaration of every stored shape — and the object is loose so the collections this file never
 * touches (support, content, audience, coaching) are carried through a write unchanged. A document
 * written by another version is reported as an unavailable source rather than partially rewritten
 * into a shape a later read would render as fact.
 */
const outreachStateSchema = z.looseObject({
  context: sessionContextRecordSchema,
  partners: z.array(partnerRecordSchema),
  initiatives: z.array(initiativeRecordSchema),
  initiativeMembers: z.array(initiativeMemberRecordSchema),
  requests: z.array(requestRecordSchema),
  referrals: z.array(referralCycleRecordSchema),
  tasks: z.array(taskRecordSchema),
});

/** The validated outage-bearing records of one session. */
type OutreachState = z.infer<typeof outreachStateSchema>;

/** The store documents a mutation applies to, reached structurally so the store is never imported. */
type StoredDocuments = MutationContext["docs"];

/**
 * Raised when a session's state document exists but cannot be decoded as this build's records.
 *
 * Nothing is written in that case, and the answer is `unavailable` for the local store: presenting an
 * undecodable document as an empty collection would let a change be applied on top of records the
 * service never read.
 */
class StoredRecordsUnreadable extends Error {
  constructor() {
    super(
      "The stored outreach records cannot be read as this build's records, so nothing was changed. Reset the development seed from Settings to restore the known dataset.",
    );
    this.name = CORRUPT_DOCUMENT_FAULT;
    Object.setPrototypeOf(this, StoredRecordsUnreadable.prototype);
  }
}

/** Reads the records a change applies to, refusing rather than repairing an unreadable document. */
function readState(documents: StoredDocuments): OutreachState {
  const parsed = outreachStateSchema.safeParse(documents.state);
  if (!parsed.success) {
    throw new StoredRecordsUnreadable();
  }
  return parsed.data;
}

/**
 * Writes the records a change produced, advancing the document set's own revision.
 *
 * The collection reads report the state document's `context.revision` rather than a per-row token,
 * so every accepted change advances it: a list envelope read before a change is then stale, which is
 * what lets the next write that presents it be answered as a conflict instead of overwriting.
 */
function writeState(
  documents: StoredDocuments,
  state: OutreachState,
  changed: Partial<OutreachState>,
): void {
  documents.state = {
    ...state,
    ...changed,
    context: { ...state.context, revision: nextRevision(state.context.revision) },
  };
}

/**
 * Advances a record's opaque revision token by one.
 *
 * The token is opaque to callers, so its only requirement is that it changes on every accepted
 * write. A trailing counter is advanced when the stored token has one — which every seeded and
 * previously advanced token does — and a token without one is suffixed rather than guessed at, so
 * two consecutive writes can never mint the same token.
 */
function nextRevision(revision: string): string {
  const parsed = REVISION_COUNTER.exec(revision);
  const counter = parsed?.groups?.counter;
  const prefix = parsed?.groups?.prefix;
  if (counter === undefined || prefix === undefined) {
    return `${revision}-2`;
  }
  const advanced = Number(counter) + 1;
  return Number.isSafeInteger(advanced) ? `${prefix}${String(advanced)}` : `${revision}-2`;
}

/**
 * Mints a record identifier from the attempt that creates it.
 *
 * Deriving the identifier from the caller's `operationId` rather than from a clock, a counter or a
 * random source means a record's identity is decided by the attempt identity the ledger already
 * recovers by, so a lost acknowledgement is answered with the record it created instead of a second
 * one. Identifiers stay opaque: nothing parses them back.
 */
function recordIdFor(kind: string, operationId: string): string {
  return `${kind}-${operationId}`;
}

/** The instant a command runs at: the session's own scenario clock, never the process-wide one. */
function commandInstant(session: ResolvedSession): Temporal.Instant {
  return instantAt(session.clockOffsetMs);
}

/** Reads a stored instant, or reports that the stored value cannot be read as one. */
function readInstant(value: string): Temporal.Instant | undefined {
  try {
    return Temporal.Instant.from(value);
  } catch {
    return undefined;
  }
}

/**
 * Refuses a change with a message keyed by the field the caller must change.
 *
 * A record-state refusal — a closed initiative, a terms version that was never presented, a member
 * who is not on the list — is a validation failure of the request against the record it names, so it
 * travels as `invalid` with its field message. The runner converts the thrown error at its boundary,
 * which is why nothing is thrown past it.
 */
function refuseField(path: string, message: string): never {
  throw new ZodError([{ code: "custom", message, path: [path] }]);
}

/**
 * The refusal `apply` answers with when the record it names may not be changed through this scope.
 *
 * It is the shape `ApplyResult` reserves for a question only the transaction can answer, so the runner
 * returns this outcome verbatim with nothing written, no revision advanced and no ledger entry.
 */
type RefusalResult = { readonly refused: MutationOutcome };

/**
 * Refuses a change to a record whose access check refused it, naming the attempt that asked.
 *
 * The initiative is not in this session's document set, it runs in another ministry, or another
 * principal is responsible for it: all three answer here identically, with the closed set's
 * `no-permission` reason code, so the refusal discloses nothing about which one applies — no record's
 * existence, title, count or size. What it does say is the truth the caller can act on, that the
 * change was refused, rather than reporting a refusal as though there had been nothing to do.
 */
function refuseDenied(operationId: string): RefusalResult {
  return { refused: denied({ operationId, reasonCode: "no-permission" }) };
}

// ---------------------------------------------------------------------------------------------
// The one place a validated payload reaches the runner's hooks
// ---------------------------------------------------------------------------------------------

/**
 * The payload of one attempt, as the runner will have validated it, or the fact that it will not.
 *
 * The runner validates the four-field envelope and the payload before it asks a mutation's authority
 * question or reads the transaction's documents, so a hook reached with `validated: false` was never
 * called. Modelling that as a value rather than an assertion keeps every hook total without a second
 * parse and without a throw that would escape the runner's boundary.
 */
type PayloadState<P> =
  | { readonly validated: true; readonly payload: P }
  | { readonly validated: false };

/**
 * One named mutation's request to {@link runOutreachMutation}: a concrete schema and concrete hooks.
 *
 * There is no table of operations here and no string-keyed lookup: every member is supplied by the
 * one mutation that owns the job, which is the difference between this helper and the universal
 * dispatcher the release excludes.
 */
interface OutreachMutation<P, R extends MutationResult> {
  /** This mutation's own payload schema, which decides whether the request is well formed. */
  readonly schema: z.ZodType<P>;
  /** This mutation's name, used by the armed failure plan and by the diagnostic line. */
  readonly name: string;
  /** The mutation's own authority question, asked once the claimed scope has been asserted. */
  readonly authorize?: (session: ResolvedSession, payload: P, scope: Scope) => ScopeDecision;
  /** Locates the target's current revision, for the optimistic-concurrency comparison. */
  readonly readCurrent?: (documents: StoredDocuments, payload: P, scope: Scope) => CurrentTarget;
  /** The change itself, run inside the transaction. */
  readonly apply: (context: MutationContext, payload: P, scope: Scope) => ApplyResult<R>;
}

/** The attempt identity a request that states no usable one is answered and refused under. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/**
 * The attempt identity a request carries, read without trusting its type.
 *
 * It is the same marker `runMutation` uses, so a refusal built here is labelled exactly as the runner
 * would label it: this helper refuses a request whose session cannot be established, and the answer
 * still has to name the attempt it refused.
 */
function attemptIdOf(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const candidate: unknown = Reflect.get(input, "operationId");
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return UNIDENTIFIED_ATTEMPT;
}

/**
 * Runs one named outreach mutation through `runMutation`, narrowing the payload for its hooks.
 *
 * `runMutation` owns the order — validate, authorise, replay, revision, apply, scope re-check, record
 * — and this helper adds nothing to it: it parses the payload once so the hooks that need it can see
 * it, and leaves every decision to the runner. A payload that fails validation is answered by the
 * runner as `invalid`, so the unvalidated branches below are never reached; each answers without
 * changing anything, which keeps the failure mode fail-safe rather than throwing.
 */
async function runOutreachMutation<P, R extends MutationResult>(
  input: MutationInput<unknown>,
  source: SessionSource | undefined,
  plan: OutreachMutation<P, R>,
): Promise<MutationOutcome> {
  const parsed = plan.schema.safeParse(input.payload);
  const pending: PayloadState<P> = parsed.success
    ? { validated: true, payload: parsed.data }
    : { validated: false };
  const scope = input.scope;

  // `runMutation` serialises its transaction by session, so the session an attempt acts for has to be
  // established before one opens; the runner then resolves it again authoritatively and refuses a
  // request that claims a session it did not come from. A session that cannot be established is
  // refused here, before any record is looked at, so the attempt learns nothing it asked about.
  let sessionId: string;
  try {
    const resolution = await resolveSession(source);
    if (!resolution.ok) {
      return outcomeOfRefusal(resolution.refusal, attemptIdOf(input));
    }
    sessionId = resolution.session.sessionId;
  } catch {
    // A request scope that cannot yield its cookie leaves no session to establish, which is the one
    // refusal the resolver names for that case.
    return denied({ operationId: attemptIdOf(input), reasonCode: "session-unavailable" });
  }

  return runMutation<P, R>({
    sessionId,
    // A browser posts JSON, so the payload arrives untyped. The runner validates both the envelope
    // and this payload before either hook reads them, and the assertion states the type that
    // validation establishes rather than a claim about the bytes that arrived.
    input: input as MutationInput<P>,
    schema: plan.schema,
    name: plan.name,
    authorize: (session) =>
      pending.validated && plan.authorize !== undefined
        ? plan.authorize(session, pending.payload, scope)
        : assertScope(session, scope),
    readCurrent: (documents) =>
      pending.validated && plan.readCurrent !== undefined
        ? plan.readCurrent(documents, pending.payload, scope)
        : { kind: "absent" },
    apply: (context) =>
      pending.validated ? plan.apply(context, pending.payload, scope) : { changed: false },
  });
}

// ---------------------------------------------------------------------------------------------
// Locating the record a change belongs to
// ---------------------------------------------------------------------------------------------

/**
 * What locating the initiative a change belongs to answered.
 *
 * `refused` covers every reason the record cannot be acted on through this scope — it is not in the
 * document set, it belongs to another ministry, or another principal is responsible for it — because
 * one answer for all three discloses nothing about which applies.
 */
type InitiativeAccess =
  | { readonly kind: "found"; readonly initiative: InitiativeRecord }
  | { readonly kind: "refused" };

/**
 * Locates one initiative this caller may change.
 *
 * The record states the ministry it runs in and the person accountable for it, so both are checked
 * against the scope the caller is acting in and the principal the session resolved to: admission to
 * a ministry lets a colleague read an initiative without changing it, and a record whose own
 * ministry is not the claimed one has drifted out of the context it is read in.
 */
function initiativeAccessOf(
  state: OutreachState,
  initiativeId: string,
  session: ResolvedSession,
  scope: Scope,
): InitiativeAccess {
  const initiative = state.initiatives.find((row) => row.initiativeId === initiativeId);
  if (initiative === undefined) {
    return { kind: "refused" };
  }
  if (initiative.ministryContextId !== scope.ministryId) {
    return { kind: "refused" };
  }
  return initiative.responsiblePrincipalId === session.principalId
    ? { kind: "found", initiative }
    : { kind: "refused" };
}

/**
 * What locating the Request a change belongs to answered, with the initiative that authorises it.
 *
 * A Request carries no owner of its own: the initiative it belongs to is what decides who may present
 * it and who may record its answer.
 */
type RequestAccess =
  | {
      readonly kind: "found";
      readonly request: RequestRecord;
      readonly initiative: InitiativeRecord;
    }
  | { readonly kind: "refused" };

/** Locates one Request this caller may change, through the initiative it belongs to. */
function requestAccessOf(
  state: OutreachState,
  requestId: string,
  session: ResolvedSession,
  scope: Scope,
): RequestAccess {
  const request = state.requests.find((row) => row.requestId === requestId);
  if (request === undefined) {
    return { kind: "refused" };
  }
  const access = initiativeAccessOf(state, request.initiativeId, session, scope);
  return access.kind === "found"
    ? { kind: "found", request, initiative: access.initiative }
    : { kind: "refused" };
}

/** One working-list member, located inside the initiative a change names. */
interface LocatedMember {
  readonly index: number;
  readonly member: InitiativeMemberRecord;
}

/** Finds a member of one initiative's working list, or reports that the list does not hold it. */
function memberOf(
  state: OutreachState,
  initiativeId: string,
  memberId: string,
): LocatedMember | undefined {
  const index = state.initiativeMembers.findIndex(
    (row) => row.memberId === memberId && row.initiativeId === initiativeId,
  );
  const member = index === -1 ? undefined : state.initiativeMembers[index];
  return member === undefined ? undefined : { index, member };
}

/** The current-target answer for a record a change replaces. */
function recordTarget(revision: string, value: unknown): CurrentTarget {
  return { kind: "record", revision, value };
}

/**
 * Locates the initiative a change replaces, for the runner's revision comparison.
 *
 * The revision comparison runs before `apply`, so it cannot consult the principal the session
 * resolved to. It therefore answers `absent` for a record outside the claimed ministry — the one
 * authority fact the stored document states and the scope can be compared with — which means such a
 * change is answered as a no-op later rather than with a conflict that would report the record's
 * contents back to a caller who may not change it.
 */
function initiativeTargetOf(
  documents: StoredDocuments,
  initiativeId: string,
  scope: Scope,
): CurrentTarget {
  const state = readState(documents);
  const initiative = state.initiatives.find((row) => row.initiativeId === initiativeId);
  if (initiative === undefined || initiative.ministryContextId !== scope.ministryId) {
    return { kind: "absent" };
  }
  return recordTarget(initiative.revision, initiative);
}

/** Locates the Request a change replaces, or answers `absent` for one this scope cannot act on. */
function requestTargetOf(
  documents: StoredDocuments,
  requestId: string,
  scope: Scope,
): CurrentTarget {
  const state = readState(documents);
  const request = state.requests.find((row) => row.requestId === requestId);
  if (request === undefined) {
    return { kind: "absent" };
  }
  const initiative = state.initiatives.find((row) => row.initiativeId === request.initiativeId);
  if (initiative === undefined || initiative.ministryContextId !== scope.ministryId) {
    return { kind: "absent" };
  }
  return recordTarget(request.revision, request);
}

/** Locates one working-list member a change replaces, or answers `absent`. */
function memberTargetOf(
  documents: StoredDocuments,
  initiativeId: string,
  memberId: string,
  scope: Scope,
): CurrentTarget {
  const state = readState(documents);
  const initiative = state.initiatives.find((row) => row.initiativeId === initiativeId);
  if (initiative === undefined || initiative.ministryContextId !== scope.ministryId) {
    return { kind: "absent" };
  }
  const found = memberOf(state, initiativeId, memberId);
  return found === undefined
    ? { kind: "absent" }
    : recordTarget(found.member.revision, found.member);
}

// ---------------------------------------------------------------------------------------------
// Initiatives: creation and the reviewed working list
// ---------------------------------------------------------------------------------------------

/** Validates the `createInitiative` payload: a name, a purpose, an accountable person and a period. */
const createInitiativePayloadSchema = z
  .strictObject({
    name: boundedTextSchema(200, {
      required: "Give the initiative a name.",
      tooLong: "Keep the name to 200 characters or fewer.",
    }),
    purpose: boundedTextSchema(2000, {
      required: "Describe what this initiative is for.",
      tooLong: "Keep the purpose to 2,000 characters or fewer.",
    }),
    // An opaque principal reference inside the acting scope: a name or an email address never
    // establishes identity, so neither is accepted in its place. Omitted, it defaults to the caller.
    responsiblePrincipalId: z
      .string()
      .trim()
      .min(1, "Choose the person responsible for this initiative.")
      .optional(),
    // The acting ministry travels in the mutation's scope, so a body never names a context the caller
    // is not admitted to; the period is a pair of civil dates and carries no time of day or zone.
    period: z.strictObject({ startOn: civilDateSchema, endOn: civilDateSchema }).optional(),
  })
  .superRefine((value, context) => {
    if (value.period === undefined) {
      return;
    }
    if (Temporal.PlainDate.compare(value.period.endOn, value.period.startOn) < 0) {
      context.addIssue({
        code: "custom",
        path: ["period", "endOn"],
        message: "Choose an end date on or after the start date.",
      });
    }
  });

/** The validated `createInitiative` payload. */
type CreateInitiativePayload = z.infer<typeof createInitiativePayloadSchema>;

/**
 * Creates one finite piece of outreach in the ministry the caller is acting in.
 *
 * The working list starts empty — a filter that later matches a partner never joins it — and the
 * record starts `open` with no closure disposition, so its first close is the first closure the
 * initiative has. Outcomes: `accepted` with the new identifier, `denied`, `invalid`, `conflict`,
 * `unavailable` or `unknown`.
 */
export async function createInitiative(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<CreateInitiativePayload, MutationResult>(input, source, {
    schema: createInitiativePayloadSchema,
    name: "createInitiative",
    apply: (context, payload, scope) => {
      const state = readState(context.docs);
      const { session } = context;
      const responsiblePrincipalId = payload.responsiblePrincipalId ?? session.principalId;
      if (responsiblePrincipalId !== session.principalId) {
        // Admission lets a colleague read a ministry's initiatives; it does not hand one over, and
        // this release records no delegation that would.
        refuseField(
          "responsiblePrincipalId",
          "Only the acting principal may be responsible for an initiative in this release, because it carries no delegation.",
        );
      }

      const initiativeId = recordIdFor("initiative", input.operationId);
      const initiative: InitiativeRecord = {
        initiativeId,
        name: payload.name,
        purpose: payload.purpose,
        ministryContextId: scope.ministryId,
        responsiblePrincipalId: session.principalId,
        period:
          payload.period === undefined
            ? null
            : {
                from: serialiseCivilDate(payload.period.startOn),
                to: serialiseCivilDate(payload.period.endOn),
              },
        state: "open",
        closureDisposition: null,
        revision: FIRST_REVISION,
      };

      writeState(context.docs, state, { initiatives: [...state.initiatives, initiative] });
      return {
        changed: true,
        revision: FIRST_REVISION,
        result: { initiativeId },
        created: [initiativeId],
      };
    },
  });
}

/** Validates the `addMembers` payload: the initiative and the partners the worker explicitly selected. */
const addMembersPayloadSchema = z
  .strictObject({
    initiativeId: identifierFieldSchema(
      "This change is missing the initiative it belongs to; reopen the initiative and try again.",
    ),
    partnerIds: z
      .array(
        identifierFieldSchema(
          "This selection is missing a partner; reopen the member picker and choose again.",
        ),
      )
      .min(1, "Choose at least one partner to add.")
      .max(
        MAX_SELECTED_PARTNERS,
        `Add ${String(MAX_SELECTED_PARTNERS)} partners or fewer at a time.`,
      ),
  })
  .superRefine((payload, context) => {
    const seen = new Set<string>();
    payload.partnerIds.forEach((partnerId, index) => {
      if (seen.has(partnerId)) {
        // The path points at the repeated entry, so a picker marks that chip rather than the whole list.
        context.addIssue({
          code: "custom",
          path: ["partnerIds", index],
          message: "Remove the duplicate partner from this selection.",
        });
        return;
      }
      seen.add(partnerId);
    });
  });

/** The validated `addMembers` payload. */
type AddMembersPayload = z.infer<typeof addMembersPayloadSchema>;

/**
 * Adds explicitly selected, eligible partners to an initiative's reviewed working list.
 *
 * Inclusion is what is recorded and nothing more: it is not "asked", not contact permission and not
 * membership of an Update's audience. A partner already included is `unchanged`, and one the worker
 * excluded from this initiative deliberately stays excluded, because a new selection is not where
 * that decision is reversed. Per-item results are `accepted | unchanged | excluded`; outcomes are
 * `accepted`, `unchanged` when nothing changed, `denied` for an initiative this scope may not act
 * on, `invalid`, `conflict`, `unavailable` or `unknown`.
 */
export async function addMembers(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<AddMembersPayload, MutationResult>(input, source, {
    schema: addMembersPayloadSchema,
    name: "addMembers",
    readCurrent: (documents, payload, scope) =>
      initiativeTargetOf(documents, payload.initiativeId, scope),
    apply: (context, payload, scope) => {
      const state = readState(context.docs);
      const { session } = context;
      const access = initiativeAccessOf(state, payload.initiativeId, session, scope);
      if (access.kind !== "found") {
        return refuseDenied(context.operationId);
      }
      const { initiative } = access;
      if (initiative.state === "closed") {
        refuseField(
          "initiativeId",
          "This initiative is closed, so its working list no longer takes new members.",
        );
      }

      const at = commandInstant(session).toString();
      const partners = new Map(
        state.partners.map((partner) => [partner.partnerId, partner] as const),
      );
      const members = [...state.initiativeMembers];
      const items: PerItemResult[] = [];
      const created: string[] = [];
      const changedIds: string[] = [];
      let changed = false;

      for (const partnerId of payload.partnerIds) {
        const partner = partners.get(partnerId);
        if (partner === undefined || partner.audience !== "shared") {
          // A partner this roster does not carry, or the worker's own private preparation, is never
          // approached: private preparation is a different record class from a shared relationship.
          items.push({
            targetId: partnerId,
            state: "excluded",
            reasonCode: "not-eligible",
            reason: "This partner is not one this working list can include.",
          });
          continue;
        }

        const index = members.findIndex(
          (row) => row.initiativeId === initiative.initiativeId && row.partnerId === partnerId,
        );
        const existing = index === -1 ? undefined : members[index];
        if (existing === undefined) {
          const memberId = `member-${initiative.initiativeId}-${partnerId}`;
          members.push({
            memberId,
            initiativeId: initiative.initiativeId,
            partnerId,
            state: "included",
            stage: null,
            addedAt: at,
            returnedAt: null,
            history: [
              {
                state: "included",
                at,
                byPrincipalId: session.principalId,
                reason: "Added from the reviewed working list.",
              },
            ],
            revision: FIRST_REVISION,
          });
          created.push(memberId);
          items.push({ targetId: partnerId, state: "accepted", revision: FIRST_REVISION });
          changed = true;
          continue;
        }
        if (existing.state === "included") {
          items.push({
            targetId: partnerId,
            state: "unchanged",
            revision: existing.revision,
            reasonCode: "already-included",
          });
          continue;
        }
        if (existing.state === "excluded") {
          items.push({
            targetId: partnerId,
            state: "excluded",
            revision: existing.revision,
            reasonCode: "excluded-deliberately",
            reason:
              "This partner was excluded from this initiative deliberately, so a new selection does not include them.",
          });
          continue;
        }

        const revision = nextRevision(existing.revision);
        members[index] = {
          ...existing,
          state: "included",
          returnedAt: null,
          history: [
            ...existing.history,
            {
              state: "included",
              at,
              byPrincipalId: session.principalId,
              reason: "Added back to the reviewed working list.",
            },
          ],
          revision,
        };
        changedIds.push(existing.memberId);
        items.push({ targetId: partnerId, state: "accepted", revision });
        changed = true;
      }

      if (!changed) {
        return { changed: false };
      }

      const revision = nextRevision(initiative.revision);
      writeState(context.docs, state, {
        initiatives: state.initiatives.map((row) =>
          row.initiativeId === initiative.initiativeId ? { ...row, revision } : row,
        ),
        initiativeMembers: members,
      });
      return {
        changed: true,
        revision,
        result: {
          initiativeId: initiative.initiativeId,
          addedMemberIds: created,
          updatedMemberIds: changedIds,
        },
        created,
        changedIds,
        items,
      };
    },
  });
}

/** Validates the `removeMember` payload: the initiative, the member, and an optional reason. */
const removeMemberPayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema(
    "This change is missing the initiative it belongs to; reopen the initiative and try again.",
  ),
  memberId: identifierFieldSchema(
    "This change is missing the working-list member it belongs to; reload the working list and try again.",
  ),
  // Leaving the key out is a valid removal; a blank reason is not silently treated as absent.
  reason: boundedTextSchema(500, {
    required: "Enter a reason or leave the reason empty.",
    tooLong: "Keep the reason to 500 characters or fewer.",
  }).optional(),
});

/** The validated `removeMember` payload. */
type RemoveMemberPayload = z.infer<typeof removeMemberPayloadSchema>;

/**
 * Removes one partner from an initiative's reviewed working list.
 *
 * The member becomes `removed` and the history keeps the fact of having been included, together with
 * the reason if one was given; every independent obligation recorded elsewhere — a task, a Request,
 * an interaction — is untouched, because a removal settles nothing but the list. Removing someone
 * already removed is `unchanged`, and an exclusion is never overwritten by a removal. Outcomes:
 * `accepted`, `unchanged`, `denied` for an initiative this scope may not act on, `invalid`,
 * `conflict`, `unavailable` or `unknown`.
 */
export async function removeMember(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<RemoveMemberPayload, MutationResult>(input, source, {
    schema: removeMemberPayloadSchema,
    name: "removeMember",
    readCurrent: (documents, payload, scope) =>
      memberTargetOf(documents, payload.initiativeId, payload.memberId, scope),
    apply: (context, payload, scope) => {
      const state = readState(context.docs);
      const { session } = context;
      const access = initiativeAccessOf(state, payload.initiativeId, session, scope);
      if (access.kind !== "found") {
        return refuseDenied(context.operationId);
      }
      const found = memberOf(state, payload.initiativeId, payload.memberId);
      if (found === undefined) {
        refuseField("memberId", "This working-list member is not on this initiative.");
      }
      const { index, member } = found;
      if (member.state === "removed") {
        return { changed: false };
      }
      if (member.state === "excluded") {
        refuseField(
          "memberId",
          "This partner was excluded from this initiative deliberately, so a removal is not recorded in place of that decision.",
        );
      }

      const at = commandInstant(session).toString();
      const revision = nextRevision(member.revision);
      const members = [...state.initiativeMembers];
      members[index] = {
        ...member,
        state: "removed",
        // The stored field names the instant the partner left the working list, which is what the
        // seeded records state; a return clears it and the history keeps both facts.
        returnedAt: at,
        history: [
          ...member.history,
          {
            state: "removed",
            at,
            byPrincipalId: session.principalId,
            reason: payload.reason ?? null,
          },
        ],
        revision,
      };

      const initiativeRevision = nextRevision(access.initiative.revision);
      writeState(context.docs, state, {
        initiatives: state.initiatives.map((row) =>
          row.initiativeId === access.initiative.initiativeId
            ? { ...row, revision: initiativeRevision }
            : row,
        ),
        initiativeMembers: members,
      });
      return {
        changed: true,
        revision,
        result: {
          initiativeId: access.initiative.initiativeId,
          memberId: member.memberId,
          state: "removed",
        },
        changedIds: [member.memberId],
      };
    },
  });
}

/** Validates the `returnMember` payload: the initiative and the working-list member to return. */
const returnMemberPayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema(
    "This change is missing the initiative it belongs to; reopen the initiative and try again.",
  ),
  memberId: identifierFieldSchema(
    "This change is missing the working-list member it belongs to; reload the working list and try again.",
  ),
});

/** The validated `returnMember` payload. */
type ReturnMemberPayload = z.infer<typeof returnMemberPayloadSchema>;

/**
 * Returns one removed partner to an initiative's reviewed working list.
 *
 * Only eligible planning state is restored: the member becomes `included` again and the history keeps
 * both the removal and the return. A member the worker excluded deliberately is refused rather than
 * silently included, because that decision is not reversed by returning a different one, and a member
 * already included is `unchanged`. Outcomes: `accepted`, `unchanged`, `denied` for an initiative
 * this scope may not act on, `invalid`, `conflict`, `unavailable` or `unknown`.
 */
export async function returnMember(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<ReturnMemberPayload, MutationResult>(input, source, {
    schema: returnMemberPayloadSchema,
    name: "returnMember",
    readCurrent: (documents, payload, scope) =>
      memberTargetOf(documents, payload.initiativeId, payload.memberId, scope),
    apply: (context, payload, scope) => {
      const state = readState(context.docs);
      const { session } = context;
      const access = initiativeAccessOf(state, payload.initiativeId, session, scope);
      if (access.kind !== "found") {
        return refuseDenied(context.operationId);
      }
      const found = memberOf(state, payload.initiativeId, payload.memberId);
      if (found === undefined) {
        refuseField("memberId", "This working-list member is not on this initiative.");
      }
      const { index, member } = found;
      if (member.state === "included") {
        return { changed: false };
      }
      if (member.state === "excluded") {
        refuseField(
          "memberId",
          "This partner was excluded from this initiative deliberately, so returning them would include them without that decision changing.",
        );
      }

      const at = commandInstant(session).toString();
      const revision = nextRevision(member.revision);
      const members = [...state.initiativeMembers];
      members[index] = {
        ...member,
        state: "included",
        returnedAt: null,
        history: [
          ...member.history,
          {
            state: "included",
            at,
            byPrincipalId: session.principalId,
            reason: "Returned to the reviewed working list.",
          },
        ],
        revision,
      };

      const initiativeRevision = nextRevision(access.initiative.revision);
      writeState(context.docs, state, {
        initiatives: state.initiatives.map((row) =>
          row.initiativeId === access.initiative.initiativeId
            ? { ...row, revision: initiativeRevision }
            : row,
        ),
        initiativeMembers: members,
      });
      return {
        changed: true,
        revision,
        result: {
          initiativeId: access.initiative.initiativeId,
          memberId: member.memberId,
          state: "included",
        },
        changedIds: [member.memberId],
      };
    },
  });
}

/**
 * Validates the `setStage` payload: the initiative, the member, and an approved stage or an explicit
 * Clear.
 *
 * The stage is a closed set rather than free text, with `null` meaning Clear. A value the source no
 * longer offers is refused here even though a read still reports it as retired, so a stale assessment
 * can be replaced deliberately but never recorded again.
 */
const setStagePayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema(
    "This change is missing the initiative it belongs to; reopen the initiative and try again.",
  ),
  memberId: identifierFieldSchema(
    "This change is missing the working-list member it belongs to; reload the working list and try again.",
  ),
  stage: z
    .enum(INITIATIVE_STAGES, {
      error: "Choose a stage from the approved list, or clear the stage.",
    })
    .nullable(),
});

/** The validated `setStage` payload. */
type SetStagePayload = z.infer<typeof setStagePayloadSchema>;

/**
 * Records one human assessment of where a working-list member stands.
 *
 * A stage predicts no giving, measures no worth and fulfils no obligation: recording the same value
 * again is `unchanged`, writes no history entry and changes nothing, and recording a different one
 * creates no task and unpauses nothing. A stage belongs to an included member, so a partner who was
 * removed or excluded must return to the list before an assessment is recorded. Outcomes:
 * `accepted`, `unchanged`, `denied` for an initiative this scope may not act on, `invalid`,
 * `conflict`, `unavailable` or `unknown`.
 */
export async function setStage(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<SetStagePayload, MutationResult>(input, source, {
    schema: setStagePayloadSchema,
    name: "setStage",
    readCurrent: (documents, payload, scope) =>
      memberTargetOf(documents, payload.initiativeId, payload.memberId, scope),
    apply: (context, payload, scope) => {
      const state = readState(context.docs);
      const { session } = context;
      const access = initiativeAccessOf(state, payload.initiativeId, session, scope);
      if (access.kind !== "found") {
        return refuseDenied(context.operationId);
      }
      const found = memberOf(state, payload.initiativeId, payload.memberId);
      if (found === undefined) {
        refuseField("memberId", "This working-list member is not on this initiative.");
      }
      const { index, member } = found;
      if (member.state !== "included" && payload.stage !== null) {
        refuseField(
          "stage",
          "A stage is recorded against an included member; return this partner to the working list first.",
        );
      }
      if (member.stage === payload.stage) {
        return { changed: false };
      }

      const at = commandInstant(session).toString();
      const revision = nextRevision(member.revision);
      const members = [...state.initiativeMembers];
      members[index] = {
        ...member,
        stage: payload.stage,
        history: [
          ...member.history,
          {
            // An assessment is not a change of state, so the entry repeats the state the member
            // already stands in and names the stage in the reason: the history is the only place
            // this record keeps an account of what was assessed and when.
            state: member.state,
            at,
            byPrincipalId: session.principalId,
            reason:
              payload.stage === null ? "Stage cleared." : `Stage recorded as ${payload.stage}.`,
          },
        ],
        revision,
      };

      const initiativeRevision = nextRevision(access.initiative.revision);
      writeState(context.docs, state, {
        initiatives: state.initiatives.map((row) =>
          row.initiativeId === access.initiative.initiativeId
            ? { ...row, revision: initiativeRevision }
            : row,
        ),
        initiativeMembers: members,
      });
      return {
        changed: true,
        revision,
        result: {
          initiativeId: access.initiative.initiativeId,
          memberId: member.memberId,
          stage: payload.stage,
        },
        changedIds: [member.memberId],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Requests: versioned requested terms and the answers bound to them
// ---------------------------------------------------------------------------------------------

/**
 * The seven response kinds, with the specification's own wording of the seventh beside the stored
 * token it is recorded as.
 *
 * The stored vocabulary is `../envelope`'s, because that schema is what a stored Request is read
 * back through; the specification words the seventh kind "needs clarification", so that spelling is
 * accepted and normalised here rather than refused as an unknown answer.
 */
const RESPONSE_KIND_INPUT = [...REQUEST_RESPONSE_KINDS, "needs clarification"] as const;

/** One response kind as a caller may state it, before the stored token is decided. */
type ResponseKindInput = (typeof RESPONSE_KIND_INPUT)[number];

/** Reads a stated response kind and normalises the seventh to the stored token. */
const responseKindSchema: z.ZodType<RequestResponseKind> = z
  .enum(RESPONSE_KIND_INPUT, {
    error: "Choose how this Request was answered from the recorded responses.",
  })
  .transform((kind: ResponseKindInput) =>
    kind === "needs clarification" ? "needs-clarification" : kind,
  );

/**
 * Validates the requested terms one ask carries: a version, and either exact requested money or a
 * non-financial ask, never both and never an amount alongside a non-financial description.
 *
 * `version` is an opaque label. An integer is the composer's shorthand and becomes the stored
 * `terms-v<n>`, which is the form the seeded terms and every presented version reference use; a
 * string is taken as the label it is, unchanged.
 */
const requestedTermsSchema = z
  .strictObject({
    version: z.union([
      z
        .int({ error: "Record which terms version this ask carries." })
        .positive("Record which terms version this ask carries."),
      z.string().trim().min(1, "Record which terms version this ask carries."),
    ]),
    currency: z.string().trim().min(1, "Choose the currency for the requested amount.").optional(),
    minorUnits: z.int({ error: "Enter the amount as a whole number of minor units." }).optional(),
    cadence: z.string().trim().min(1, "Enter the cadence or leave it empty.").optional(),
    term: z.string().trim().min(1, "Enter the term or leave it empty.").optional(),
    nonFinancial: z
      .strictObject({
        description: boundedTextSchema(2000, {
          required: "Describe the non-financial ask.",
          tooLong: "Keep the description to 2,000 characters or fewer.",
        }),
      })
      .optional(),
  })
  .superRefine((terms, context) => {
    const hasMoneyField =
      terms.currency !== undefined ||
      terms.minorUnits !== undefined ||
      terms.cadence !== undefined ||
      terms.term !== undefined;

    if (terms.nonFinancial !== undefined) {
      if (hasMoneyField) {
        context.addIssue({
          code: "custom",
          path: ["nonFinancial"],
          message: "A non-financial ask carries no amount, currency, cadence or term.",
        });
      }
      return;
    }

    if (!hasMoneyField) {
      context.addIssue({
        code: "custom",
        path: ["nonFinancial"],
        message:
          "Choose requested financial terms (currency and amount) or describe a non-financial ask.",
      });
      return;
    }
    if (terms.currency === undefined) {
      context.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Choose the currency for the requested amount.",
      });
    } else if (!isKnownCurrency(terms.currency)) {
      // An amount in a currency whose exponent this build does not hold cannot be stated exactly, and
      // the one money rule forbids defaulting it to two decimals.
      context.addIssue({
        code: "custom",
        path: ["currency"],
        message:
          "Choose a currency whose minor unit this build knows, so the requested amount is exact.",
      });
    }
    if (terms.minorUnits === undefined) {
      context.addIssue({
        code: "custom",
        path: ["minorUnits"],
        message: "Enter the requested amount in minor units.",
      });
    } else if (terms.minorUnits <= 0) {
      context.addIssue({
        code: "custom",
        path: ["minorUnits"],
        message: "Enter an amount greater than zero; a non-financial ask carries no amount.",
      });
    }
  });

/** The validated requested terms. */
type RequestedTermsPayload = z.infer<typeof requestedTermsSchema>;

/**
 * Turns validated requested terms into the versioned stored form.
 *
 * The result is *requested* terms: nothing here reaches a support projection, a gift, a goal or an
 * export, and the amount is carried as an exact minor-unit integer with its own currency code.
 */
function storedTermsOf(terms: RequestedTermsPayload): RequestTerms {
  const version =
    typeof terms.version === "number" ? `terms-v${String(terms.version)}` : terms.version;
  if (terms.nonFinancial !== undefined) {
    return { version, money: null, nonFinancial: terms.nonFinancial.description };
  }
  const { currency, minorUnits } = terms;
  if (currency === undefined || minorUnits === undefined) {
    // The terms schema requires both for a financial ask, so this is unreachable; refusing keeps the
    // type honest and fails closed rather than writing an amount with no currency.
    refuseField("currency", "Choose the currency for the requested amount.");
  }
  const amount = moneySchema.parse({ currency, minorUnits });
  return {
    version,
    money: { amount, cadence: terms.cadence ?? null, term: terms.term ?? null },
    nonFinancial: null,
  };
}

/** Validates the `draftRequest` payload: who is asked, who they represent, why, and on which terms. */
const draftRequestPayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema(
    "This change is missing the initiative it belongs to; reopen the initiative and try again.",
  ),
  recipientPartnerId: identifierFieldSchema(
    "Choose the person or organization this request is for.",
  ),
  // A separate opaque reference: an organization representative is its own record, so this is never
  // derived from, compared with, or defaulted to the recipient.
  representedOrganizationId: identifierFieldSchema(
    "Choose the organization this person represents, or leave it empty.",
  ).optional(),
  purpose: boundedTextSchema(2000, {
    required: "Describe the purpose of this request.",
    tooLong: "Keep the purpose to 2,000 characters or fewer.",
  }),
  terms: requestedTermsSchema,
});

/** The validated `draftRequest` payload. */
type DraftRequestPayload = z.infer<typeof draftRequestPayloadSchema>;

/**
 * Drafts one independently answerable Request inside an initiative.
 *
 * A Request is one invitation with its own versioned terms, one presentation and one answer. Drafting
 * creates no pledge, gift, commitment, subscription, receipt, task or send: it records what the worker
 * intends to ask, and nothing else. Outcomes: `accepted` with the new identifier, `denied` for an
 * initiative this scope may not act on, `invalid`, `conflict`, `unavailable` or `unknown`.
 */
export async function draftRequest(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<DraftRequestPayload, MutationResult>(input, source, {
    schema: draftRequestPayloadSchema,
    name: "draftRequest",
    apply: (context, payload, scope) => {
      const state = readState(context.docs);
      const access = initiativeAccessOf(state, payload.initiativeId, context.session, scope);
      if (access.kind !== "found") {
        return refuseDenied(context.operationId);
      }
      const { initiative } = access;
      if (initiative.state === "closed") {
        refuseField("initiativeId", "This initiative is closed, so no new Request may be drafted.");
      }

      const partners = new Map(
        state.partners.map((partner) => [partner.partnerId, partner] as const),
      );
      const recipient = partners.get(payload.recipientPartnerId);
      if (recipient === undefined || recipient.audience !== "shared") {
        refuseField(
          "recipientPartnerId",
          "This Request names a recipient the roster does not carry.",
        );
      }
      if (payload.representedOrganizationId !== undefined) {
        const organization = partners.get(payload.representedOrganizationId);
        if (organization === undefined || organization.audience !== "shared") {
          refuseField(
            "representedOrganizationId",
            "This Request names an organization the roster does not carry.",
          );
        }
      }

      const terms = storedTermsOf(payload.terms);
      const requestId = recordIdFor("request", input.operationId);
      const request: RequestRecord = {
        requestId,
        initiativeId: initiative.initiativeId,
        recipientPartnerId: payload.recipientPartnerId,
        representedOrganizationId: payload.representedOrganizationId ?? null,
        purpose: payload.purpose,
        terms,
        presentation: null,
        response: null,
        // Work a Response later suggests is recorded by the task family, never inferred into the ask.
        nextWorkIds: [],
        revision: FIRST_REVISION,
      };

      const initiativeRevision = nextRevision(initiative.revision);
      writeState(context.docs, state, {
        initiatives: state.initiatives.map((row) =>
          row.initiativeId === initiative.initiativeId
            ? { ...row, revision: initiativeRevision }
            : row,
        ),
        requests: [...state.requests, request],
      });
      return {
        changed: true,
        revision: FIRST_REVISION,
        result: {
          requestId,
          initiativeId: initiative.initiativeId,
          termsVersion: terms.version,
        },
        created: [requestId],
      };
    },
  });
}

/** Validates the `presentRequest` payload: what was presented, when, how, and on which terms version. */
const presentRequestPayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema(
    "This change is missing the initiative it belongs to; reopen the initiative and try again.",
  ).optional(),
  requestId: identifierFieldSchema(
    "This change is missing the request it belongs to; reopen the request and try again.",
  ),
  presentedOn: civilDateSchema,
  manner: boundedTextSchema(200, {
    required: "Describe how the request was presented.",
    tooLong: "Keep the description to 200 characters or fewer.",
  }),
  versionRef: identifierFieldSchema("Record which terms version was presented."),
});

/** The validated `presentRequest` payload. */
type PresentRequestPayload = z.infer<typeof presentRequestPayloadSchema>;

/**
 * Records the actual presentation of a named terms version.
 *
 * The stored presentation is the record of what a person was shown, so it is written once: an
 * identical presentation is `unchanged`, and a different one is refused rather than overwriting what
 * the answer behind it may be bound to. The version this presentation cites need not be the current
 * terms — a Request whose terms moved on still records the version that was actually shown — which is
 * what keeps an earlier presented version and the answer that cites it legible. Outcomes:
 * `accepted`, `unchanged`, `denied` for a Request this scope may not act on, `invalid`, `conflict`,
 * `unavailable` or `unknown`.
 */
export async function presentRequest(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<PresentRequestPayload, MutationResult>(input, source, {
    schema: presentRequestPayloadSchema,
    name: "presentRequest",
    readCurrent: (documents, payload, scope) =>
      requestTargetOf(documents, payload.requestId, scope),
    apply: (context, payload, scope) => {
      const state = readState(context.docs);
      const access = requestAccessOf(state, payload.requestId, context.session, scope);
      if (access.kind === "refused") {
        return refuseDenied(context.operationId);
      }
      return presentRequestFor(context.docs, state, access, payload);
    },
  });
}

/**
 * Applies one presentation to a Request this caller may change.
 *
 * Split from the mutation only so the authority answer above stays one clear decision; it performs
 * the change, its history and the initiative revision advance in the transaction the runner opened.
 */
function presentRequestFor(
  documents: StoredDocuments,
  state: OutreachState,
  access: Extract<RequestAccess, { kind: "found" }>,
  payload: PresentRequestPayload,
): ApplyResult<MutationResult> {
  const { request, initiative } = access;
  if (payload.initiativeId !== undefined && payload.initiativeId !== request.initiativeId) {
    refuseField("initiativeId", "This Request belongs to a different initiative.");
  }

  const presentation: RequestPresentation = {
    presentedOn: serialiseCivilDate(payload.presentedOn),
    manner: payload.manner,
    versionRef: payload.versionRef,
  };
  const existing = request.presentation;
  if (existing !== null) {
    if (
      existing.presentedOn === presentation.presentedOn &&
      existing.manner === presentation.manner &&
      existing.versionRef === presentation.versionRef
    ) {
      return { changed: false };
    }
    refuseField(
      "versionRef",
      `This Request already records the presentation of ${existing.versionRef} on ${existing.presentedOn}, and a recorded presentation is never overwritten.`,
    );
  }

  const revision = nextRevision(request.revision);
  const initiativeRevision = nextRevision(initiative.revision);
  writeState(documents, state, {
    initiatives: state.initiatives.map((row) =>
      row.initiativeId === initiative.initiativeId ? { ...row, revision: initiativeRevision } : row,
    ),
    requests: state.requests.map((row) =>
      row.requestId === request.requestId ? { ...row, presentation, revision } : row,
    ),
  });
  return {
    changed: true,
    revision,
    result: { requestId: request.requestId, versionRef: presentation.versionRef },
    changedIds: [request.requestId],
  };
}

/**
 * Validates the five facts one answer states.
 *
 * `standingEvidence` is recorded as the respondent's answer was said on the strength of, and `null`
 * states that nothing was written down: the record keeps the absence as an absence rather than
 * refusing an answer that was genuinely given without documentation, and a job title, a household
 * relationship or an email match is never inferred into evidence that was not stated.
 */
const responseFactsSchema = z.strictObject({
  kind: responseKindSchema,
  respondentId: identifierFieldSchema("Name the person who gave this answer."),
  standingEvidence: z.string().trim().nullable(),
  termsVersionRef: identifierFieldSchema("Record which terms version this answer responds to."),
});

/** The validated facts of one recorded answer. */
type ResponseFactsPayload = z.infer<typeof responseFactsSchema>;

/**
 * Accepts the answer either as the record-shaped `{ response: { … } }` form the plan names or as the
 * flat form the family's own composer validates, and normalises both to the canonical shape.
 *
 * Both spellings state the same five facts once; normalising before validation means one strict
 * schema decides what is well formed, so the two cannot drift into two acceptance rules.
 */
function normaliseResponsePayload(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const fields: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if ("response" in fields) {
    return fields;
  }
  const { kind, respondentId, standingEvidence, termsVersionRef, ...rest } = fields;
  if (kind === undefined && respondentId === undefined && termsVersionRef === undefined) {
    return fields;
  }
  return {
    ...rest,
    response: { kind, respondentId, standingEvidence: standingEvidence ?? null, termsVersionRef },
  };
}

/** Validates the `recordRequestResponse` payload, in either spelling, as one canonical answer. */
const recordRequestResponsePayloadSchema = z.preprocess(
  normaliseResponsePayload,
  z.strictObject({
    initiativeId: identifierFieldSchema(
      "This answer is missing the initiative it belongs to; reopen the initiative and try again.",
    ).optional(),
    requestId: identifierFieldSchema(
      "This answer is missing the request it belongs to; reopen the request and try again.",
    ),
    response: responseFactsSchema,
  }),
);

/** The validated `recordRequestResponse` payload. */
type RecordRequestResponsePayload = z.infer<typeof recordRequestResponsePayloadSchema>;

/**
 * Records the named respondent's own answer to one Request, bound to the terms version it answers.
 *
 * The terms version must be the one the stored presentation cites, because an answer is only evidence
 * about the terms it actually responded to. Agreement creates no pledge, gift, commitment,
 * subscription, receipt, task or send: it records a human answer and nothing else. Re-recording the
 * same answer is `unchanged`; a later, different answer replaces the recorded one with its own
 * recorded instant, because a respondent's changed answer is a new fact about the same invitation.
 * Outcomes: `accepted`, `unchanged`, `denied` for a Request this scope may not act on, `invalid`,
 * `conflict`, `unavailable` or `unknown`.
 */
export async function recordRequestResponse(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<RecordRequestResponsePayload, MutationResult>(input, source, {
    schema: recordRequestResponsePayloadSchema,
    name: "recordRequestResponse",
    readCurrent: (documents, payload, scope) =>
      requestTargetOf(documents, payload.requestId, scope),
    apply: (context, payload, scope) => {
      const state = readState(context.docs);
      const access = requestAccessOf(state, payload.requestId, context.session, scope);
      if (access.kind === "refused") {
        return refuseDenied(context.operationId);
      }
      const { request, initiative } = access;
      if (payload.initiativeId !== undefined && payload.initiativeId !== request.initiativeId) {
        refuseField("initiativeId", "This Request belongs to a different initiative.");
      }

      const presentation = request.presentation;
      if (presentation === null) {
        refuseField(
          "response.termsVersionRef",
          "No terms version has been presented for this Request, so there is nothing to answer yet.",
        );
      }
      const facts: ResponseFactsPayload = payload.response;
      if (presentation.versionRef !== facts.termsVersionRef) {
        refuseField(
          "response.termsVersionRef",
          "Answer the terms version that was presented; reload the request and try again.",
        );
      }

      const recorded: RequestResponse = {
        kind: facts.kind,
        respondentId: facts.respondentId,
        standingEvidence: facts.standingEvidence,
        termsVersionRef: facts.termsVersionRef,
        recordedAt: commandInstant(context.session).toString(),
      };
      const existing = request.response;
      if (
        existing !== null &&
        existing.kind === recorded.kind &&
        existing.respondentId === recorded.respondentId &&
        existing.standingEvidence === recorded.standingEvidence &&
        existing.termsVersionRef === recorded.termsVersionRef
      ) {
        return { changed: false };
      }

      const revision = nextRevision(request.revision);
      const initiativeRevision = nextRevision(initiative.revision);
      writeState(context.docs, state, {
        initiatives: state.initiatives.map((row) =>
          row.initiativeId === initiative.initiativeId
            ? { ...row, revision: initiativeRevision }
            : row,
        ),
        requests: state.requests.map((row) =>
          row.requestId === request.requestId ? { ...row, response: recorded, revision } : row,
        ),
      });
      return {
        changed: true,
        revision,
        result: {
          requestId: request.requestId,
          kind: recorded.kind,
          termsVersionRef: recorded.termsVersionRef,
        },
        changedIds: [request.requestId],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Initiatives: closure
// ---------------------------------------------------------------------------------------------

/**
 * How owned unfinished work is dealt with when an initiative closes: handed to a named person, or
 * stated as needing no handoff.
 *
 * Both members are required to say something, because silence cannot close an initiative: a closure
 * that left the fate of outstanding work unstated would report a decision nobody made.
 */
const initiativeHandoffSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("eligible-handoff"),
    toPrincipalId: identifierFieldSchema("Name the person who takes over the unfinished work."),
    note: boundedTextSchema(500, {
      required: "Describe what is being handed over.",
      tooLong: "Keep the note to 500 characters or fewer.",
    }),
  }),
  z.strictObject({
    kind: z.literal("none"),
    reason: boundedTextSchema(500, {
      required: "Say why no handoff is needed.",
      tooLong: "Keep the reason to 500 characters or fewer.",
    }),
  }),
]);

/**
 * Validates the `closeInitiative` payload: a disposition, an eligible handoff, or at least one of the
 * two.
 *
 * Whether the initiative actually owns unfinished work is the record's question, answered where the
 * tasks and Requests are readable; this only requires the worker to have answered how it closes.
 */
const closeInitiativePayloadSchema = z
  .strictObject({
    initiativeId: identifierFieldSchema(
      "This change is missing the initiative it belongs to; reopen the initiative and try again.",
    ),
    disposition: boundedTextSchema(200, {
      required:
        "Choose how this initiative is closing, or name who takes over the unfinished work.",
      tooLong: "Keep the disposition to 200 characters or fewer.",
    }).optional(),
    handoff: initiativeHandoffSchema,
  })
  .superRefine((payload, context) => {
    if (payload.disposition === undefined && payload.handoff.kind !== "eligible-handoff") {
      context.addIssue({
        code: "custom",
        path: ["disposition"],
        message:
          "Say how this initiative closes: choose a disposition, or name who takes over the unfinished work.",
      });
    }
  });

/** The validated `closeInitiative` payload. */
type CloseInitiativePayload = z.infer<typeof closeInitiativePayloadSchema>;

/** States, in the one field the record keeps, how unfinished work was handed on or resolved. */
function closureDispositionOf(payload: CloseInitiativePayload): string {
  const handoff = payload.handoff;
  const handoffText =
    handoff.kind === "eligible-handoff"
      ? `Handed off to ${handoff.toPrincipalId}: ${handoff.note}`
      : `No handoff needed: ${handoff.reason}`;
  return payload.disposition === undefined
    ? handoffText
    : `${payload.disposition} — ${handoffText}`;
}

/**
 * Closes an initiative's solicitation, recording how its unfinished work is dealt with.
 *
 * Closing fences new solicitation and resolves nothing silently: every open task the initiative owns
 * and every presented Request still awaiting an answer is reported in the per-item results as it
 * stands, so a closure never claims work was completed or an answer received. Late actual responses
 * remain recordable afterwards without reopening, because closing fences solicitation rather than
 * the record of what happened. Closing an already closed initiative is `unchanged`. Outcomes:
 * `accepted` (with per-item results), `unchanged`, `denied` for an initiative this scope may not act
 * on, `invalid`, `conflict`, `unavailable` or `unknown`.
 */
export async function closeInitiative(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<CloseInitiativePayload, MutationResult>(input, source, {
    schema: closeInitiativePayloadSchema,
    name: "closeInitiative",
    readCurrent: (documents, payload, scope) =>
      initiativeTargetOf(documents, payload.initiativeId, scope),
    apply: (context, payload, scope) => {
      const state = readState(context.docs);
      const access = initiativeAccessOf(state, payload.initiativeId, context.session, scope);
      if (access.kind !== "found") {
        return refuseDenied(context.operationId);
      }
      const { initiative } = access;
      if (initiative.state === "closed") {
        return { changed: false };
      }

      const items: PerItemResult[] = [
        ...state.tasks
          .filter(
            (task) =>
              task.initiativeId === initiative.initiativeId &&
              (task.status === "open" || task.status === "reopened"),
          )
          .map((task) => ({
            targetId: task.taskId,
            state: "still-open",
            reasonCode: "independent-obligation",
            reason:
              "Closing the initiative does not complete this work, which stays open for whoever owns it.",
          })),
        ...state.requests
          .filter(
            (request) =>
              request.initiativeId === initiative.initiativeId &&
              request.presentation !== null &&
              request.response === null,
          )
          .map((request) => ({
            targetId: request.requestId,
            state: "awaiting-response",
            reasonCode: "independent-obligation",
            reason: "This Request was presented and has no recorded answer yet.",
          })),
      ];

      const revision = nextRevision(initiative.revision);
      const closureDisposition = closureDispositionOf(payload);
      writeState(context.docs, state, {
        initiatives: state.initiatives.map((row) =>
          row.initiativeId === initiative.initiativeId
            ? { ...row, state: "closed", closureDisposition, revision }
            : row,
        ),
      });
      return {
        changed: true,
        revision,
        result: {
          initiativeId: initiative.initiativeId,
          state: "closed",
          closureDisposition,
          openWorkCount: items.length,
        },
        changedIds: [initiative.initiativeId],
        items,
      };
    },
  });
}

/** Validates the `reopenInitiative` payload: the initiative and an optional reason. */
const reopenInitiativePayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema(
    "This change is missing the initiative it belongs to; reopen the initiative and try again.",
  ),
  reason: boundedTextSchema(500, {
    required: "Enter a reason or leave the reason empty.",
    tooLong: "Keep the reason to 500 characters or fewer.",
  }).optional(),
});

/** The validated `reopenInitiative` payload. */
type ReopenInitiativePayload = z.infer<typeof reopenInitiativePayloadSchema>;

/**
 * Reopens a closed initiative for further solicitation.
 *
 * The record keeps the closure disposition it recorded, which is what lets a reader tell a reopened
 * initiative from one that was never closed, and it keeps every working-list exclusion and removal:
 * reopening restores planning, not membership, so a member who was excluded deliberately stays out
 * of the list. Reopening an open initiative is `unchanged`. Outcomes: `accepted`, `unchanged`,
 * `denied` for an initiative this scope may not act on, `invalid`, `conflict`, `unavailable` or
 * `unknown`.
 */
export async function reopenInitiative(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<ReopenInitiativePayload, MutationResult>(input, source, {
    schema: reopenInitiativePayloadSchema,
    name: "reopenInitiative",
    readCurrent: (documents, payload, scope) =>
      initiativeTargetOf(documents, payload.initiativeId, scope),
    apply: (context, payload, scope) => {
      const state = readState(context.docs);
      const access = initiativeAccessOf(state, payload.initiativeId, context.session, scope);
      if (access.kind !== "found") {
        return refuseDenied(context.operationId);
      }
      const { initiative } = access;
      if (initiative.state === "open") {
        return { changed: false };
      }

      const revision = nextRevision(initiative.revision);
      writeState(context.docs, state, {
        initiatives: state.initiatives.map((row) =>
          row.initiativeId === initiative.initiativeId
            ? // `closureDisposition` is deliberately preserved: it is the record of the earlier close,
              // and the lifecycle a read reports is derived from it.
              { ...row, state: "open", revision }
            : row,
        ),
      });
      return {
        changed: true,
        revision,
        // The record keeps no reopen note, so the stated reason travels back in the result rather
        // than being validated and dropped.
        result: {
          initiativeId: initiative.initiativeId,
          state: "open",
          reason: payload.reason ?? null,
        },
        changedIds: [initiative.initiativeId],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Referrals: the introduction and the single continuation
// ---------------------------------------------------------------------------------------------

/** Validates the `recordIntroduction` payload: the original date, its precision and its source. */
const recordIntroductionPayloadSchema = z
  .strictObject({
    partnerId: identifierFieldSchema("Choose the person this introduction refers to."),
    originalIntroductionOn: civilDateSchema.nullable().optional(),
    datePrecision: z.enum(DATE_PRECISIONS, {
      error: "Record how precisely the introduction date is known.",
    }),
    sourceZone: identifierFieldSchema("State the time zone the introduction date is known in."),
    sourceReference: sourceReferenceFieldSchema,
  })
  .superRefine((payload, context) => {
    if (payload.datePrecision === "unknown") {
      if (payload.originalIntroductionOn !== null && payload.originalIntroductionOn !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["originalIntroductionOn"],
          message:
            "An unknown introduction date states no date at all, rather than a guessed one a later reader would treat as evidence.",
        });
      }
      return;
    }
    if (payload.originalIntroductionOn === null || payload.originalIntroductionOn === undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalIntroductionOn"],
        message: "State the date the introduction actually happened on.",
      });
      return;
    }
    if (payload.datePrecision !== "date") {
      return;
    }
    // The window's arithmetic and the zone's DST rule are the boundary module's; asking it here is how
    // a written introduction is refused before anything is stored, when its zone cannot be resolved.
    const window = newWindowEnd({
      originalIntroductionOn: payload.originalIntroductionOn,
      datePrecision: payload.datePrecision,
      sourceZone: payload.sourceZone,
      days: REFERRAL_NEW_WINDOW_DAYS,
    });
    if (window.status === "refused") {
      context.addIssue({
        code: "custom",
        path: ["sourceZone"],
        message:
          window.reason === "invalid-zone"
            ? "Choose a time zone this build can resolve, so the window can be stated exactly."
            : "This introduction date cannot be given a window; check the date and try again.",
      });
    }
  });

/** The validated `recordIntroduction` payload. */
type RecordIntroductionPayload = z.infer<typeof recordIntroductionPayloadSchema>;

/**
 * Records the original introduction date of one referral cycle, with the precision it is known to.
 *
 * The date recorded is the introduction's own, kept apart from entry time: import, first view,
 * reassignment, merge and retry are never a new introduction, so the same source reference for the
 * same partner is `unchanged` and no second cycle appears. A date-precise introduction resolves its
 * New window once, here, and persists the endpoint — a late first entry may already be expired,
 * because the window is computed from the original date rather than started today. An approximate or
 * unknown date records no deadline and no Active/Expired judgement at all. Outcomes: `accepted`,
 * `unchanged`, `denied`, `invalid`, `conflict`, `unavailable` or `unknown`.
 */
export async function recordIntroduction(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<RecordIntroductionPayload, MutationResult>(input, source, {
    schema: recordIntroductionPayloadSchema,
    name: "recordIntroduction",
    apply: (context, payload) => {
      const state = readState(context.docs);
      const partner = state.partners.find((row) => row.partnerId === payload.partnerId);
      if (partner === undefined || partner.audience !== "shared") {
        refuseField("partnerId", "This introduction names a partner the roster does not carry.");
      }

      const sourceReference: SourceReference = {
        system: payload.sourceReference.system,
        reference: payload.sourceReference.reference,
      };
      const recorded = state.referrals.some(
        (cycle) =>
          cycle.partnerId === payload.partnerId &&
          cycle.sourceReference !== null &&
          sameSourceReference(cycle.sourceReference, sourceReference),
      );
      if (recorded) {
        return { changed: false };
      }

      const introductionOn = payload.originalIntroductionOn ?? null;
      let windowStart: string | null = null;
      let windowEnd: string | null = null;
      if (payload.datePrecision === "date" && introductionOn !== null) {
        const dayStart = startOfCivilDay(introductionOn, payload.sourceZone);
        if (dayStart.status === "refused") {
          refuseField("sourceZone", "Choose a time zone this build can resolve.");
        }
        const window = newWindowEnd({
          originalIntroductionOn: introductionOn,
          datePrecision: payload.datePrecision,
          sourceZone: payload.sourceZone,
          days: REFERRAL_NEW_WINDOW_DAYS,
        });
        if (window.status !== "bounded") {
          refuseField("originalIntroductionOn", "This introduction date cannot be given a window.");
        }
        windowStart = dayStart.instant.toString();
        windowEnd = window.resolvedEndInstant.toString();
      }

      const referralId = recordIdFor("referral", input.operationId);
      const cycle: ReferralCycleRecord = {
        referralId,
        partnerId: payload.partnerId,
        originalIntroductionOn: introductionOn === null ? null : serialiseCivilDate(introductionOn),
        datePrecision: payload.datePrecision,
        sourceZone: payload.sourceZone,
        sourceReference,
        cycleIndex: 0,
        windowKind: "new",
        windowStart,
        windowEnd,
        consumed: false,
        predecessorId: null,
        revision: FIRST_REVISION,
      };

      writeState(context.docs, state, { referrals: [...state.referrals, cycle] });
      return {
        changed: true,
        revision: FIRST_REVISION,
        result: {
          referralId,
          partnerId: payload.partnerId,
          datePrecision: payload.datePrecision,
          windowEnd,
        },
        created: [referralId],
      };
    },
  });
}

/** Validates the `continueReferral` payload: the expired cycle to continue. */
const continueReferralPayloadSchema = z.strictObject({
  referralId: identifierFieldSchema(
    "This change is missing the referral it belongs to; reload the referral and try again.",
  ),
});

/** The validated `continueReferral` payload. */
type ContinueReferralPayload = z.infer<typeof continueReferralPayloadSchema>;

/**
 * Reports whether this session's worker-continuation setting offers a continuation at all.
 *
 * The setting is off by default and a scenario this build does not define is not read as on, so an
 * unknown policy withholds the action instead of granting it. It is the one policy a person can
 * change, which is why it is answered before the cycle's own facts.
 */
function continuationOfferedFor(session: ResolvedSession): boolean {
  return (
    isScenarioId(session.scenarioId) &&
    scenarioFlagsFor(session.scenarioId).continuationSetting === "on"
  );
}

/** Locates the referral cycle a change replaces, or answers `absent` when the session holds none. */
function referralTargetOf(documents: StoredDocuments, referralId: string): CurrentTarget {
  const state = readState(documents);
  const cycle = state.referrals.find((row) => row.referralId === referralId);
  return cycle === undefined ? { kind: "absent" } : recordTarget(cycle.revision, cycle);
}

/**
 * Continues one ordinarily expired referral cycle, producing at most one successor.
 *
 * The continuation ends at the acceptance instant plus elapsed seconds counted from the moment it is
 * accepted — not calendar days, so a DST change inside it cannot make it an hour short or long. The
 * consumed cycle is marked in the same transaction that creates the successor, and the successor's
 * identifier is derived from its predecessor, so two racing Continues produce one successor and a
 * second attempt is `unchanged` rather than a second cycle. Continue grants no contact consent, no
 * supporter interest, no new introduction, no interaction credit, no send and no duplicate task: it
 * opens one new window on an introduction that already happened. Outcomes: `accepted`, `unchanged`,
 * `denied` (including when the worker-continuation setting is off), `invalid`, `conflict`,
 * `unavailable` or `unknown`.
 */
export async function continueReferral(
  input: MutationInput<unknown>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runOutreachMutation<ContinueReferralPayload, MutationResult>(input, source, {
    schema: continueReferralPayloadSchema,
    name: "continueReferral",
    authorize: (session) => {
      const admitted = assertScope(session, input.scope);
      if (!admitted.ok) {
        return admitted;
      }
      // Worker continuation is off by default, so withholding it is a capability this session does
      // not hold rather than a fault in the request.
      return continuationOfferedFor(session)
        ? { ok: true }
        : {
            ok: false,
            denial: denied({ operationId: input.operationId, reasonCode: "capability-absent" }),
          };
    },
    readCurrent: (documents, payload) => referralTargetOf(documents, payload.referralId),
    apply: (context, payload) => {
      const state = readState(context.docs);
      const cycle = state.referrals.find((row) => row.referralId === payload.referralId);
      if (cycle === undefined) {
        refuseField("referralId", "This referral is not one this session holds.");
      }
      if (cycle.windowKind !== "new") {
        refuseField(
          "referralId",
          "This cycle is itself a continuation, and an introduction carries at most one continuation.",
        );
      }
      const successorId = `${cycle.referralId}-continued`;
      const alreadyContinued =
        cycle.consumed || state.referrals.some((row) => row.predecessorId === cycle.referralId);
      if (alreadyContinued) {
        return { changed: false };
      }
      if (cycle.datePrecision !== "date") {
        refuseField(
          "referralId",
          "The introduction date is not precise enough to have had a window, so there is nothing to continue.",
        );
      }
      if (cycle.windowEnd === null) {
        refuseField(
          "referralId",
          "This referral states no window endpoint, so there is nothing to continue.",
        );
      }
      const windowEnd = readInstant(cycle.windowEnd);
      if (windowEnd === undefined) {
        refuseField(
          "referralId",
          "The window this referral carries could not be evaluated, so no continuation is offered.",
        );
      }

      const now = commandInstant(context.session);
      const status = referralWindowState({ windowEnd, now });
      switch (status.status) {
        case "active":
          refuseField(
            "referralId",
            "This referral's window has not ended, so there is nothing to continue.",
          );
        case "no-deadline":
          refuseField(
            "referralId",
            "The introduction date is not precise enough to have had a window, so there is nothing to continue.",
          );
        case "refused":
          refuseField(
            "referralId",
            "The window this referral carries could not be evaluated, so no continuation is offered.",
          );
        case "expired":
          break;
      }

      const continued = continuedWindowEnd({
        acceptedAt: now,
        days: REFERRAL_CONTINUATION_DAYS,
        cycle: { consumed: false },
      });
      if (continued.status === "refused") {
        refuseField(
          "referralId",
          "This continuation cannot be bounded from the instant it would be accepted.",
        );
      }
      if (state.referrals.some((row) => row.referralId === successorId)) {
        // The successor's identity is derived from its predecessor, so this is the last guard against a
        // second cycle for one introduction even if the consumed flag were ever missing.
        return { changed: false };
      }

      const consumedRevision = nextRevision(cycle.revision);
      const successor: ReferralCycleRecord = {
        referralId: successorId,
        partnerId: cycle.partnerId,
        originalIntroductionOn: cycle.originalIntroductionOn,
        datePrecision: cycle.datePrecision,
        sourceZone: cycle.sourceZone,
        sourceReference: cycle.sourceReference,
        cycleIndex: cycle.cycleIndex + 1,
        windowKind: "continued",
        windowStart: now.toString(),
        windowEnd: continued.endInstant.toString(),
        consumed: false,
        predecessorId: cycle.referralId,
        revision: FIRST_REVISION,
      };

      writeState(context.docs, state, {
        referrals: [
          ...state.referrals.map((row) =>
            row.referralId === cycle.referralId
              ? { ...row, consumed: true, revision: consumedRevision }
              : row,
          ),
          successor,
        ],
      });
      return {
        changed: true,
        revision: consumedRevision,
        result: {
          referralId: cycle.referralId,
          successorId,
          windowEnd: successor.windowEnd,
          elapsedSeconds: continued.elapsedSeconds,
        },
        created: [successorId],
        changedIds: [cycle.referralId],
      };
    },
  });
}
