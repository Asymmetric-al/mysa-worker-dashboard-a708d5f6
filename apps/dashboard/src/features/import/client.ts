"use client";
/** The contact-import family's one browser transport: the four `POST` paths that carry a named change — `proposeImport`, `setRowDecision`, `acceptImportRows`, `cancelImport` — and the one recovery … */
import type { DenialReason, MutationInput, MutationOutcome, ReadEnvelope, ReadResult } from "@/modules/data-service";

/** The payload types belong to the callers (`features/import/schemas/*`), so every call here stays generic. */

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The four paths this family posts a change to, exactly as AAP 0.6.3 names them. */
export const IMPORT_ENDPOINTS = { propose: "/api/import", decisions: "/api/import/decisions", accept: "/api/import/accept", cancel: "/api/import/cancel" } as const;

/** The system this transport names when a call produced no readable answer of the service's. */
const TRANSPORT_SYSTEM = "browser-transport";

/** No response was received at all, so the request either never left or was cut off. */
const NO_RESPONSE_REFERENCE = "no-response";

/** A response arrived, but its body was empty or was not JSON. */
const UNREADABLE_BODY_REFERENCE = "unreadable-body";

/** A response arrived and parsed, but it was neither an envelope nor a refusal this contract defines. */
const UNEXPECTED_BODY_REFERENCE = "unexpected-body";

/** The attempt a read failure names. */
const READ_ATTEMPT = "read";

/** Why a read that produced no envelope could not answer, stated for the reader's next step. */
const READ_GUIDANCE = "The import record could not be read from the local data service, so nothing is shown as empty and no count is shown as zero. A read has no effect to repeat, so the same read can be tried again.";

// ---------------------------------------------------------------------------------------------
// What a recovery read hands the journey
// ---------------------------------------------------------------------------------------------

/** Which phase of one import operation the recovery read answered in. */
export type ImportReadPhase = "in-flight" | "completed";

/** What the recovery read of one import identity hands back: the JSON the envelope carried, untouched, and the phase that answered. */
export interface ImportReadEnvelope {
  readonly phase: ImportReadPhase;
  readonly data: unknown;
}

/** The proposal read's answer: `in-flight` while the operation is reviewable, `completed` once its identity answers a receipt. */
export type ImportProposalEnvelope = ImportReadEnvelope;

/** The receipt read's answer: `completed` once the operation has processed its rows, `in-flight` while it has not. */
export type ImportReceiptEnvelope = ImportReadEnvelope;

/**
 * The window of rows a recovery read is showing: the page a caller stands on, counting from one, and how many
 * rows it shows.
 *
 * Neither member is defaulted, clamped or validated here. The service's read applies the size it documents and
 * its own ceiling, and the route refuses a value that is not a positive whole number, so a caller states a window
 * and this transport carries it unchanged.
 */
interface ImportReadWindow {
  readonly page?: number;
  readonly pageSize?: number;
}

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
const DENIAL_REASONS: { readonly [Reason in DenialReason]: true } = { "not-admitted": true, "no-membership": true, "no-permission": true, "no-export-permission": true, "no-protected-grant": true, "capability-absent": true, "session-expired": true, "session-unavailable": true };

function isDenialReason(value: unknown): value is DenialReason {
  return typeof value === "string" && Object.hasOwn(DENIAL_REASONS, value);
}

type OutcomeName = MutationOutcome["outcome"];

type OutcomeCheck = (body: Record<string, unknown>) => boolean;

/** One check per outcome, so the guard accepts exactly the eight members the service may answer with and nothing else. */
const OUTCOME_CHECKS: { readonly [Name in OutcomeName]: OutcomeCheck } = {
  accepted: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string",
  alreadyAccepted: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string" && "result" in body,
  unchanged: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string",
  conflict: (body) => isNonEmptyString(body.operationId) && typeof body.currentRevision === "string" && (body.reason === "stale-revision" || body.reason === "changed-intent") && "current" in body && "preservedInput" in body,
  denied: (body) => isNonEmptyString(body.operationId) && isDenialReason(body.reasonCode),
  invalid: (body) => isNonEmptyString(body.operationId) && isRecord(body.fields),
  unavailable: (body) => isNonEmptyString(body.operationId) && isSourceReference(body.source) && isNonEmptyString(body.guidance),
  unknown: (body) => isNonEmptyString(body.operationId),
};

function isSourceReference(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.system) && isNonEmptyString(value.reference);
}

/** Reports whether a parsed body is one of the eight mutation outcomes, with the identity of its attempt intact — which is the only handle a lost acknowledgement can be recovered by. */
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

/** Reports whether a parsed body carries a complete read envelope. */
function isEnvelopeBody(value: unknown): value is ReadEnvelope<unknown> {
  return isRecord(value) && "data" in value && isRecord(value.scope) && isSourceReference(value.source) && typeof value.revision === "string" && typeof value.asOf === "string" && isRecord(value.coverage) && isRecord(value.valueStates) && Array.isArray(value.actions);
}

/** Reports whether a parsed body is the read union in its wrapped form: */
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
    case "refused": {
      const refusal: unknown = value.refused;
      return isOutcomeBody(refusal) && refusal.outcome === "invalid";
    }
    default:
      return false;
  }
}

/** Reads a body back as the read union: the envelope the service answered with, its denial, its refusal of a request the read does not admit, or its outage. */
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
    if (body.outcome === "invalid") {
      // The identity this read was asked for is one the handler does not admit: the field-keyed refusal
      // is the read's own answer, and no import record behind it failed to arrive.
      return { kind: "refused", refused: body };
    }
  }
  return undefined;
}

/** Recognises which phase of the import an identity answered in, from the members each read writes and the other never does: the proposal states `inFlight` beside its file and rows, the receipt … */
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
  return { data: { phase, data: envelope.data }, scope: envelope.scope, source: envelope.source, revision: envelope.revision, asOf: envelope.asOf, coverage: envelope.coverage, valueStates: envelope.valueStates, actions: envelope.actions };
}

// ---------------------------------------------------------------------------------------------
// What this transport answers with when the service did not answer
// ---------------------------------------------------------------------------------------------

/** The outage a read names when it could not reach its source: never an empty list, never a zero. */
function readOutage(reference: string): ReadResult<never> {
  return { kind: "unavailable", unavailable: { outcome: "unavailable", operationId: READ_ATTEMPT, source: { system: TRANSPORT_SYSTEM, reference }, guidance: READ_GUIDANCE } };
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

/** Posts one named change and answers exactly one of the closed outcomes. */
async function postJson<P>(path: string, input: MutationInput<P>): Promise<MutationOutcome> {
  // Typed as the envelope rather than left to inference, so a member dropped from it — or a fifth one added
  // beside them — fails to compile here instead of reaching a handler whose strict schema would refuse it.
  const envelope: MutationInput<unknown> = { operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload };
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
 * The path an import operation's proposal or receipt is read at: the same route family as the proposal write, addressed by the operation's own opaque identity, and carrying the window of rows a caller is showing. The identity is percent-encoded and never trimmed, parsed or compared, because an equal-looking identifier establishes neither identity nor authority; the service decides what an identity may read. A paging member travels only when the caller stated it: the read behind this path owns the default size and its ceiling, so neither is supplied, guessed or clamped here.
 */
function receiptPath(operationId: string, window: ImportReadWindow): string {
  const query = new URLSearchParams();
  if (window.page !== undefined) {
    query.set("page", String(window.page));
  }
  if (window.pageSize !== undefined) {
    query.set("pageSize", String(window.pageSize));
  }
  const search = query.toString();
  return `${IMPORT_ENDPOINTS.propose}/${encodeURIComponent(operationId)}${search.length === 0 ? "" : `?${search}`}`;
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

/** Reads the proposal or the receipt of one import operation by its identity, and states which phase answered. The two declared reads share the one path (`readImportReceipt` first, `readImportProposal` second), so the phase is what tells the journey whether it may resume reviewing or must show the result it came back for; the window a caller states is carried on that one request, because both reads page the rows they return. */
async function readImportRecord(operationId: string, window: ImportReadWindow): Promise<ReadResult<ReadEnvelope<ImportReadEnvelope>>> {
  const answer = await getJson(receiptPath(operationId, window));
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

/** `proposeImport`: turns the file the worker chose into a reviewable proposal — the limits measured before anything was processed, the columns, the suggested mapping, the per-row validation and the … */
export async function proposeImportRequest<P>(input: MutationInput<P>): Promise<MutationOutcome> {
  return postJson(IMPORT_ENDPOINTS.propose, input);
}

/** `setRowDecision`: records the decision taken about one row of the reviewed proposal. */
export async function setRowDecisionRequest<P>(input: MutationInput<P>): Promise<MutationOutcome> {
  return postJson(IMPORT_ENDPOINTS.decisions, input);
}

/** `acceptImportRows`: writes the contacts of the reviewed snapshot. */
export async function acceptImportRowsRequest<P>(input: MutationInput<P>): Promise<MutationOutcome> {
  return postJson(IMPORT_ENDPOINTS.accept, input);
}

/** `cancelImport`: stops the unaccepted rows of an import still in flight and leaves the accepted ones in place. */
export async function cancelImportRequest<P>(input: MutationInput<P>): Promise<MutationOutcome> {
  return postJson(IMPORT_ENDPOINTS.cancel, input);
}

// ---------------------------------------------------------------------------------------------
// The two recovery reads
// ---------------------------------------------------------------------------------------------

/**
 * Reads the recoverable receipt of one import operation by its identity — the call that resolves a lost acknowledgement without repeating it. Answers the read union the service itself returns: the envelope, the denial, the outage, or the refusal a request defect receives, with `phase` stating whether the operation has completed yet. A request that never reached the handler, and a body that is none of those, answer `unavailable` with the transport's own source, because a receipt that could not be read is never rendered as "nothing was imported". The optional window states which page of the receipt's rows to read; left out, the service reads the page it documents.
 */
export async function fetchImportReceipt(operationId: string, window: ImportReadWindow = {}): Promise<ReadResult<ReadEnvelope<ImportReceiptEnvelope>>> {
  return readImportRecord(operationId, window);
}

/**
 * Reads the reviewable proposal of one import operation by its identity, so a reload or a return visit resumes the same file instead of uploading it again. Answers the same union as {@link fetchImportReceipt}; a body whose data is the receipt means the operation has already completed, and the phase it carries is what lets the journey move on to the result of the acceptance it is asking about rather than offering it a second time. A body that is neither a proposal nor a receipt answers `unavailable`, never a throw. The optional window states which page of the proposal's rows to read; left out, the service reads the page it documents.
 */
export async function fetchImportProposal(operationId: string, window: ImportReadWindow = {}): Promise<ReadResult<ReadEnvelope<ImportProposalEnvelope>>> {
  return readImportRecord(operationId, window);
}
