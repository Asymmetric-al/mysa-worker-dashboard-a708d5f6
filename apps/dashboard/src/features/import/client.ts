"use client";
/**
 * The contact-import family's one browser transport: the four `POST` paths that carry a named change —
 * `proposeImport`, `setRowDecision`, `acceptImportRows`, `cancelImport` — and the one recovery `GET` that
 * reads an import operation's proposal or its receipt by the operation's own identity.
 *
 * **Why one module.** AAP 0.3.2 makes a Route Handler the only browser mutation transport and forbids a
 * Server Action, and Rule 1 clause 2 forbids a generic request dispatcher: the four paths are named once
 * here and nowhere else in this family, so the hooks that drive the five steps cannot grow a second call
 * path to the same route. The service's own contracts travel unchanged — the four-field mutation input in,
 * exactly one of the closed eight outcomes out; a read envelope, a denial or an outage out — and this
 * module adds no field, status, retry, cache or fallback of its own.
 *
 * **Why the narrowing is written here.** `@/modules/data-service` exports `isOutcome` and `isReadResult`,
 * but that outcome module imports `next/server` and the logger, so a *value* import would drag server code
 * into the browser bundle. This module therefore imports types only, and re-establishes the closed outcome
 * set as an exhaustive record keyed by `MutationOutcome["outcome"]`: a member added to, renamed in or
 * removed from the union fails typecheck here instead of letting an unrecognised body through as an answer.
 *
 * **What the wire actually carries.** `toResponse` flattens both directions onto the status: a read answers
 * the envelope itself at 200, its denial at 403 and its outage at 503 with no `kind` wrapper; a mutation
 * answers `accepted`, `alreadyAccepted` or `unchanged` at 200, `conflict` at 409, `denied` at 403,
 * `invalid` at 422, `unavailable` at 503 and `unknown` at 202. Those are answers a caller renders, so the
 * body is read first and no status is treated as the verdict, turned into a message or mapped to an outcome
 * of this module's own invention.
 *
 * **What it never does.** It throws nothing out of a call the journey drives: a request that never left, a
 * body that is not JSON, and a body that is neither an envelope nor one of the eight outcomes become the
 * honest answer for their direction — an `unavailable` read, because a read that could not reach its source
 * is never rendered as an empty result, or an `unknown` outcome carrying the caller's own `operationId`,
 * because a mutation that produced no answer may still have been applied and both "accepted" and "failed"
 * would be assertions the browser cannot support. It never retries (a retry is the same `operationId`
 * submitted again, so it is recovered as a replay rather than repeated as a second effect), never mints an
 * operation identity (the caller owns that through `lib/ids`), never reads a clock, never logs — a file name,
 * a row or an address in a log line is exactly what this family must not leak — and never computes a value
 * the service produced.
 *
 * **What it does not decide.** What a row means, whether a file is inside the displayed limits and whether a
 * decision is eligible are `modules/import`'s and the service's to answer. This file carries bytes and
 * answers back; it parses no CSV and it merges no contact.
 *
 * **Layering.** `features/import → modules/data-service (types)`: it imports no store, no development
 * runtime, no feature, no component and no domain module, so it is safe in the browser bundle and in a test.
 */
import type { DenialReason, MutationInput, MutationOutcome, ReadEnvelope, ReadResult } from "@/modules/data-service";

/** The payload types belong to the callers (`features/import/schemas/*`), so every call here stays generic. */

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The four paths this family posts a change to, exactly as AAP 0.6.3 names them. */
export const IMPORT_ENDPOINTS = {
  propose: "/api/import",
  decisions: "/api/import/decisions",
  accept: "/api/import/accept",
  cancel: "/api/import/cancel",
} as const;

/**
 * The system this transport names when a call produced no readable answer of the service's.
 *
 * It is the transport rather than the local store, because the request can fail before it reaches the
 * service, and naming the store would claim knowledge of where the failure happened. An opaque reference
 * only: it is displayed as text and never parsed.
 */
const TRANSPORT_SYSTEM = "browser-transport";

/** No response was received at all, so the request either never left or was cut off. */
const NO_RESPONSE_REFERENCE = "no-response";

/** A response arrived, but its body was empty or was not JSON. */
const UNREADABLE_BODY_REFERENCE = "unreadable-body";

/** A response arrived and parsed, but it was neither an envelope nor a refusal this contract defines. */
const UNEXPECTED_BODY_REFERENCE = "unexpected-body";

/**
 * The attempt a read failure names. A `GET` performs no effect, so it has no operation to identify and mints
 * none: `"read"` is the same non-unique marker the service's own read refusals carry, which keeps a failed
 * read from being mistaken for a change somebody could replay.
 */
const READ_ATTEMPT = "read";

/** Why a read that produced no envelope could not answer, stated for the reader's next step. */
const READ_GUIDANCE =
  "The import record could not be read from the local data service, so nothing is shown as empty and no count is shown as zero. A read has no effect to repeat, so the same read can be tried again.";

// ---------------------------------------------------------------------------------------------
// What a recovery read hands the journey
// ---------------------------------------------------------------------------------------------

/**
 * Which phase of one import operation the recovery read answered in.
 *
 * `in-flight` is the reviewable proposal the operation started; `completed` is the receipt of the rows it
 * processed. They are the same identity on the same path, so the phase is what keeps "not processed yet"
 * from being read as "processed and produced nothing".
 */
export type ImportReadPhase = "in-flight" | "completed";

/**
 * What the recovery read of one import identity hands back: the JSON the envelope carried, untouched, and
 * the phase that answered.
 *
 * The data stays `unknown` on purpose. The proposal and the receipt are `modules/import`'s and the service's
 * records; restating them here would be a second declaration of a shape this file does not own, so the hook
 * that renders a step narrows what it needs from the same read it asked for.
 */
export interface ImportReadEnvelope {
  readonly phase: ImportReadPhase;
  readonly data: unknown;
}

/** The proposal read's answer: `in-flight` while the operation is reviewable, `completed` once its identity answers a receipt. */
export type ImportProposalEnvelope = ImportReadEnvelope;

/** The receipt read's answer: `completed` once the operation has processed its rows, `in-flight` while it has not. */
export type ImportReceiptEnvelope = ImportReadEnvelope;

// ---------------------------------------------------------------------------------------------
// Narrowing what arrived
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The closed denial reason list, restated as an exhaustive record so a new reason cannot go unrecognised. */
const DENIAL_REASONS: { readonly [Reason in DenialReason]: true } = {
  "not-admitted": true,
  "no-membership": true,
  "no-permission": true,
  "no-export-permission": true,
  "no-protected-grant": true,
  "capability-absent": true,
  "session-expired": true,
  "session-unavailable": true,
};

function isDenialReason(value: unknown): value is DenialReason {
  return typeof value === "string" && Object.hasOwn(DENIAL_REASONS, value);
}

type OutcomeName = MutationOutcome["outcome"];

type OutcomeCheck = (body: Record<string, unknown>) => boolean;

/**
 * One check per outcome, so the guard accepts exactly the eight members the service may answer with and
 * nothing else. An outcome this file has never seen is not passed onward as if it were one of them.
 *
 * Keyed by `outcome` rather than `kind` because that is how `MutationOutcome` discriminates its members;
 * `kind` belongs to `ReadResult` alone, which {@link isReadResultBody} reads. Tying each list to the union's
 * own discriminant is what makes a ninth member a compile error here instead of an answer this file would
 * quietly pass on.
 */
const OUTCOME_CHECKS: { readonly [Name in OutcomeName]: OutcomeCheck } = {
  accepted: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string",
  alreadyAccepted: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string" && "result" in body,
  unchanged: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string",
  conflict: (body) =>
    isNonEmptyString(body.operationId) &&
    typeof body.currentRevision === "string" &&
    (body.reason === "stale-revision" || body.reason === "changed-intent") &&
    "current" in body &&
    "preservedInput" in body,
  denied: (body) => isNonEmptyString(body.operationId) && isDenialReason(body.reasonCode),
  invalid: (body) => isNonEmptyString(body.operationId) && isRecord(body.fields),
  unavailable: (body) => isNonEmptyString(body.operationId) && isSourceReference(body.source) && isNonEmptyString(body.guidance),
  unknown: (body) => isNonEmptyString(body.operationId),
};

function isSourceReference(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.system) && isNonEmptyString(value.reference);
}

/**
 * Reports whether a parsed body is one of the eight mutation outcomes, with the identity of its attempt
 * intact — which is the only handle a lost acknowledgement can be recovered by.
 */
function isOutcomeBody(value: unknown): value is MutationOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const name: unknown = value.outcome;
  if (typeof name !== "string" || !Object.hasOwn(OUTCOME_CHECKS, name)) {
    return false;
  }
  return OUTCOME_CHECKS[name as OutcomeName](value);
}

/**
 * Reports whether a parsed body carries a complete read envelope.
 *
 * Only the eight members are checked, and only for shape: the service owns every value inside them. An
 * envelope that arrived without a `revision` or a `valueStates` map is refused rather than handed onward,
 * because the journey's next write must present that revision and a surface must read each value's state
 * from that map rather than from the number itself.
 */
function isEnvelopeBody(value: unknown): value is ReadEnvelope<unknown> {
  return (
    isRecord(value) &&
    "data" in value &&
    isRecord(value.scope) &&
    isSourceReference(value.source) &&
    typeof value.revision === "string" &&
    typeof value.asOf === "string" &&
    isRecord(value.coverage) &&
    isRecord(value.valueStates) &&
    Array.isArray(value.actions)
  );
}

/**
 * Reports whether a parsed body is the read union in its wrapped form: `{ kind: "envelope" }`, `{ kind:
 * "denied" }` or `{ kind: "unavailable" }`.
 *
 * `toResponse` sends the flattened form (the envelope itself, or the refusal itself), which
 * {@link readResultOf} recognises as well. The wrapped form is accepted too, so a difference in how a handler
 * packages its answer can never turn a denial into an outage in the journey's eyes.
 */
function isReadResultBody(value: unknown): value is ReadResult<ReadEnvelope<unknown>> {
  if (!isRecord(value)) {
    return false;
  }
  const kind: unknown = value.kind;
  switch (kind) {
    case "envelope":
      return isEnvelopeBody(value.envelope);
    case "denied": {
      const denial: unknown = value.denied;
      return isOutcomeBody(denial) && denial.outcome === "denied";
    }
    case "unavailable": {
      const outage: unknown = value.unavailable;
      return isOutcomeBody(outage) && outage.outcome === "unavailable";
    }
    default:
      return false;
  }
}

/**
 * Reads a body back as the read union: the envelope the service answered with, its denial or its outage.
 *
 * `undefined` means the body was not a read answer at all, which the caller reports as an outage of the
 * transport instead of as an empty result.
 */
function readResultOf(body: unknown): ReadResult<ReadEnvelope<unknown>> | undefined {
  if (isReadResultBody(body)) {
    return body;
  }
  if (isEnvelopeBody(body)) {
    return { kind: "envelope", envelope: body };
  }
  if (isOutcomeBody(body)) {
    if (body.outcome === "denied") {
      return { kind: "denied", denied: body };
    }
    if (body.outcome === "unavailable") {
      return { kind: "unavailable", unavailable: body };
    }
  }
  return undefined;
}

/**
 * Recognises which phase of the import an identity answered in, from the members each read writes and the
 * other never does: the proposal states `inFlight` beside its file and rows, the receipt states a processed
 * instant beside its per-state counts and its cancellation flag.
 *
 * A body carrying neither shape is not guessed at: the caller reports an outage rather than presenting
 * something it does not understand as a proposal or a receipt.
 */
function phaseOfData(data: unknown): ImportReadPhase | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const inFlight: unknown = data.inFlight;
  if (typeof inFlight === "boolean" && Array.isArray(data.rows) && isRecord(data.file)) {
    return inFlight ? "in-flight" : "completed";
  }
  if (isNonEmptyString(data.processedAt) && isRecord(data.counts) && typeof data.cancelled === "boolean") {
    return "completed";
  }
  return undefined;
}

/** Wraps the envelope's data with the phase that answered, keeping every other envelope member as it arrived. */
function withPhase(envelope: ReadEnvelope<unknown>, phase: ImportReadPhase): ReadEnvelope<ImportReadEnvelope> {
  return {
    data: { phase, data: envelope.data },
    scope: envelope.scope,
    source: envelope.source,
    revision: envelope.revision,
    asOf: envelope.asOf,
    coverage: envelope.coverage,
    valueStates: envelope.valueStates,
    actions: envelope.actions,
  };
}

// ---------------------------------------------------------------------------------------------
// What this transport answers with when the service did not answer
// ---------------------------------------------------------------------------------------------

/** The outage a read names when it could not reach its source: never an empty list, never a zero. */
function readOutage(reference: string): ReadResult<never> {
  return {
    kind: "unavailable",
    unavailable: {
      outcome: "unavailable",
      operationId: READ_ATTEMPT,
      source: { system: TRANSPORT_SYSTEM, reference },
      guidance: READ_GUIDANCE,
    },
  };
}

/** The unconfirmed result of a mutation: the caller's own attempt identity is the only recovery handle. */
function unknownMember(operationId: string): MutationOutcome {
  return { outcome: "unknown", operationId };
}

// ---------------------------------------------------------------------------------------------
// The two directions
// ---------------------------------------------------------------------------------------------

/** The parsed JSON body, or `undefined` when the body was empty or was not JSON. */
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text.trim().length === 0) {
      return undefined;
    }
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Posts one named change and answers exactly one of the closed outcomes.
 *
 * The body is the four-member envelope every mutation presents and nothing beside them: `operationId` is the
 * identity of the attempt, `scope` is the context the caller believes it acts in, `expectedRevision` is the
 * revision it read, and `payload` is the caller's own. A member is neither renamed nor enriched here, because
 * the handler's strict schema refuses an unexpected key rather than guessing at what it was for.
 *
 * A call that produced no answer returns `unknown` under the same `operationId`: the effect may have been
 * applied, so the caller re-reads the result of that identity rather than sending the work again, and the
 * ledger answers a replay with the stored result.
 */
async function postJson<P>(path: string, input: MutationInput<P>): Promise<MutationOutcome> {
  // Typed as the envelope rather than left to inference, so a member dropped from it — or a fifth one added
  // beside them — fails to compile here instead of reaching a handler whose strict schema would refuse it.
  const envelope: MutationInput<unknown> = {
    operationId: input.operationId,
    scope: input.scope,
    expectedRevision: input.expectedRevision,
    payload: input.payload,
  };
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The session that decides this request's scope travels as its own development cookie.
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(envelope),
    });
    const body = await readJsonBody(response);
    return isOutcomeBody(body) ? body : unknownMember(input.operationId);
  } catch {
    return unknownMember(input.operationId);
  }
}

/**
 * The path an import operation's proposal or receipt is read at: the same route family as the proposal write,
 * addressed by the operation's own opaque identity.
 *
 * The identity is percent-encoded and never trimmed, parsed or compared, because an equal-looking identifier
 * establishes neither identity nor authority; the service decides what an identity may read.
 */
function receiptPath(operationId: string): string {
  return `${IMPORT_ENDPOINTS.propose}/${encodeURIComponent(operationId)}`;
}

/** Reads one import identity and answers with the envelope it produced, its refusal, or the transport's outage. */
async function getJson(path: string): Promise<ReadResult<ReadEnvelope<unknown>>> {
  let body: unknown;
  try {
    const response = await fetch(path, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      // The answer is derived from this session's cookie and its clock on every request, so a stored copy
      // would serve one session's context — or a stale revision — to another.
      cache: "no-store",
    });
    body = await readJsonBody(response);
  } catch {
    return readOutage(NO_RESPONSE_REFERENCE);
  }
  const answer = readResultOf(body);
  if (answer !== undefined) {
    return answer;
  }
  return readOutage(body === undefined ? UNREADABLE_BODY_REFERENCE : UNEXPECTED_BODY_REFERENCE);
}

/**
 * Reads the proposal or the receipt of one import operation by its identity, and states which phase answered.
 *
 * The two declared reads share the one path (`readImportReceipt` first, `readImportProposal` second), so the
 * phase is what tells the journey whether it may resume reviewing or must show the result it came back for.
 */
async function readImportRecord(operationId: string): Promise<ReadResult<ReadEnvelope<ImportReadEnvelope>>> {
  const answer = await getJson(receiptPath(operationId));
  if (answer.kind !== "envelope") {
    return answer;
  }
  const phase = phaseOfData(answer.envelope.data);
  if (phase === undefined) {
    // The identity answered with something that is neither a proposal nor a receipt. It is reported as an
    // outage rather than rendered, because a body this contract does not recognise cannot be relied on for a
    // revision or a per-row result, and guessing would present an unknown state as a known one.
    return readOutage(UNEXPECTED_BODY_REFERENCE);
  }
  return { kind: "envelope", envelope: withPhase(answer.envelope, phase) };
}

// ---------------------------------------------------------------------------------------------
// The four changes
// ---------------------------------------------------------------------------------------------

/**
 * `proposeImport`: turns the file the worker chose into a reviewable proposal — the limits measured before
 * anything was processed, the columns, the suggested mapping, the per-row validation and the duplicate
 * suggestions. Answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`,
 * `unavailable` or `unknown`; a refusal inside the limits' own vocabulary arrives as `invalid` with its
 * readable reason, never as a message this transport wrote.
 */
export async function proposeImportRequest<P>(input: MutationInput<P>): Promise<MutationOutcome> {
  return postJson(IMPORT_ENDPOINTS.propose, input);
}

/**
 * `setRowDecision`: records the decision taken about one row of the reviewed proposal. Answers `accepted`,
 * `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. A recorded
 * decision is not an accepted contact and creates none.
 */
export async function setRowDecisionRequest<P>(input: MutationInput<P>): Promise<MutationOutcome> {
  return postJson(IMPORT_ENDPOINTS.decisions, input);
}

/**
 * `acceptImportRows`: writes the contacts of the reviewed snapshot. Answers `accepted`, `alreadyAccepted`,
 * `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`; its per-item results are the
 * receipt of what happened to each reviewed row, and an acceptance is still not a merge with an existing
 * identity.
 */
export async function acceptImportRowsRequest<P>(input: MutationInput<P>): Promise<MutationOutcome> {
  return postJson(IMPORT_ENDPOINTS.accept, input);
}

/**
 * `cancelImport`: stops the unaccepted rows of an import still in flight and leaves the accepted ones in
 * place. Answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable`
 * or `unknown`.
 */
export async function cancelImportRequest<P>(input: MutationInput<P>): Promise<MutationOutcome> {
  return postJson(IMPORT_ENDPOINTS.cancel, input);
}

// ---------------------------------------------------------------------------------------------
// The two recovery reads
// ---------------------------------------------------------------------------------------------

/**
 * Reads the recoverable receipt of one import operation by its identity — the call that resolves a lost
 * acknowledgement without repeating it.
 *
 * Answers the read union the service itself returns: the envelope (200), the denial (403) or the outage
 * (503), with `phase` stating whether the operation has completed yet. A request that never reached the
 * handler, and a body that is none of those three, answer `unavailable` with the transport's own source,
 * because a receipt that could not be read is never rendered as "nothing was imported".
 */
export async function fetchImportReceipt(operationId: string): Promise<ReadResult<ReadEnvelope<ImportReceiptEnvelope>>> {
  return readImportRecord(operationId);
}

/**
 * Reads the reviewable proposal of one import operation by its identity, so a reload or a return visit
 * resumes the same file instead of uploading it again.
 *
 * Answers the same union as {@link fetchImportReceipt}; a body whose data is the receipt means the operation
 * has already completed, and the phase it carries is what lets the journey move on to the result of the
 * acceptance it is asking about rather than offering it a second time. A body that is neither a proposal nor
 * a receipt answers `unavailable`, never a throw.
 */
export async function fetchImportProposal(operationId: string): Promise<ReadResult<ReadEnvelope<ImportProposalEnvelope>>> {
  return readImportRecord(operationId);
}
