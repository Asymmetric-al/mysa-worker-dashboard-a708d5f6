"use client";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import type { MutationInput, MutationOutcome, ReadEnvelope, ReadResult } from "@/modules/data-service";
import { isOutcome, isReadResult } from "@/modules/data-service/outcome";
/** The four paths this family posts a change to, exactly as AAP 0.6.3 names them. */ export const IMPORT_ENDPOINTS = { propose: "/api/import", decisions: "/api/import/decisions", accept: "/api/import/accept", cancel: "/api/import/cancel" } as const;
const UNREADABLE_BODY_REFERENCE = "unreadable-body";
const UNEXPECTED_BODY_REFERENCE = "unexpected-body";
const READ_GUIDANCE = "The import record could not be read from the local data service, so nothing is shown as empty and no count is shown as zero. A read has no effect to repeat, so the same read can be tried again.";
/** Which phase of one import operation the recovery read answered in. */ export type ImportReadPhase = "in-flight" | "completed";
/** What the recovery read of one import identity hands back: the JSON the envelope carried, untouched, and the phase that answered. */ export type ImportReadEnvelope = { readonly phase: ImportReadPhase; readonly data: unknown };
/** The proposal read's answer: `in-flight` while the operation is reviewable, `completed` once its identity answers a receipt. */ export type ImportProposalEnvelope = ImportReadEnvelope;
/** The receipt read's answer: `completed` once the operation has processed its rows, `in-flight` while it has not. */ export type ImportReceiptEnvelope = ImportReadEnvelope;
type ImportReadWindow = { readonly page?: number; readonly pageSize?: number };
/** Whether a parsed body is the envelope the service owns: the scope, source, revision, as-of, coverage, value states and advisory actions every read carries. */
const isEnvelopeBody = (value: unknown): value is ReadEnvelope<unknown> =>
  isRecord(value) && "data" in value && isRecord(value.scope) && isRecord(value.source) && typeof value.revision === "string" && typeof value.asOf === "string" && isRecord(value.coverage) && isRecord(value.valueStates) && Array.isArray(value.actions);
/** Whether a parsed body is one of a read's four answers, with a wrapped envelope admitted by the same rule a flat one is. */
const isReadResultBody = (value: unknown): value is ReadResult<ReadEnvelope<unknown>> => isReadResult(value) && (value.kind !== "envelope" || isEnvelopeBody(value.envelope));
function readResultOf(body: unknown): ReadResult<ReadEnvelope<unknown>> | undefined {
  if (isReadResultBody(body)) return body;
  if (isEnvelopeBody(body)) return { kind: "envelope", envelope: body };
  return !isOutcome(body) ? undefined : body.outcome === "denied" ? { kind: "denied", denied: body } : body.outcome === "unavailable" ? { kind: "unavailable", unavailable: body } : body.outcome === "invalid" ? { kind: "refused", refused: body } : undefined;
}
function phaseOfData(data: unknown): ImportReadPhase | undefined {
  if (!isRecord(data)) return undefined;
  const inFlight: unknown = data.inFlight;
  return typeof inFlight === "boolean" && Array.isArray(data.rows) && isRecord(data.file) ? (inFlight ? "in-flight" : "completed") : isNonEmptyString(data.processedAt) && isRecord(data.counts) && typeof data.cancelled === "boolean" ? "completed" : undefined;
}
const withPhase = (envelope: ReadEnvelope<unknown>, phase: ImportReadPhase): ReadEnvelope<ImportReadEnvelope> => ({ ...envelope, data: { phase, data: envelope.data } });
const readOutage = (reference: string): ReadResult<never> => ({ kind: "unavailable", unavailable: { outcome: "unavailable", operationId: "read", source: { system: "browser-transport", reference }, guidance: READ_GUIDANCE } });
const unknownMember = (operationId: string): MutationOutcome => ({ outcome: "unknown", operationId });
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text.trim().length === 0 ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}
async function postJson<P>(path: string, input: MutationInput<P>): Promise<MutationOutcome> {
  const envelope: MutationInput<unknown> = { operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload };
  try {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(envelope) });
    const body = await readJsonBody(response);
    return isOutcome(body) ? body : unknownMember(input.operationId);
  } catch {
    return unknownMember(input.operationId);
  }
}
function receiptPath(operationId: string, window: ImportReadWindow): string {
  const search = new URLSearchParams({ ...(window.page === undefined ? {} : { page: String(window.page) }), ...(window.pageSize === undefined ? {} : { pageSize: String(window.pageSize) }) }).toString();
  return `${IMPORT_ENDPOINTS.propose}/${encodeURIComponent(operationId)}${search.length === 0 ? "" : `?${search}`}`;
}
async function getJson(path: string): Promise<ReadResult<ReadEnvelope<unknown>>> {
  let body: unknown;
  try {
    const response = await fetch(path, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    body = await readJsonBody(response);
  } catch {
    return readOutage("no-response");
  }
  const answer = readResultOf(body);
  return answer ?? readOutage(body === undefined ? UNREADABLE_BODY_REFERENCE : UNEXPECTED_BODY_REFERENCE);
}
async function readImportRecord(operationId: string, window: ImportReadWindow): Promise<ReadResult<ReadEnvelope<ImportReadEnvelope>>> {
  const answer = await getJson(receiptPath(operationId, window));
  if (answer.kind !== "envelope") return answer;
  const phase = phaseOfData(answer.envelope.data);
  return phase === undefined ? readOutage(UNEXPECTED_BODY_REFERENCE) : { kind: "envelope", envelope: withPhase(answer.envelope, phase) };
}
/** `proposeImport`: turns the file the worker chose into a reviewable proposal — the limits measured before anything was processed, the columns, the suggested mapping, the per-row validation and the … */
export const proposeImportRequest = <P>(input: MutationInput<P>): Promise<MutationOutcome> => postJson(IMPORT_ENDPOINTS.propose, input);
/** `setRowDecision`: records the decision taken about one row of the reviewed proposal. */ export const setRowDecisionRequest = <P>(input: MutationInput<P>): Promise<MutationOutcome> => postJson(IMPORT_ENDPOINTS.decisions, input);
/** `acceptImportRows`: writes the contacts of the reviewed snapshot. */ export const acceptImportRowsRequest = <P>(input: MutationInput<P>): Promise<MutationOutcome> => postJson(IMPORT_ENDPOINTS.accept, input);
/** `cancelImport`: stops the unaccepted rows of an import still in flight and leaves the accepted ones in place. */ export const cancelImportRequest = <P>(input: MutationInput<P>): Promise<MutationOutcome> => postJson(IMPORT_ENDPOINTS.cancel, input);
/** Reads the recoverable receipt of one import operation by its identity — the call that resolves a lost acknowledgement without repeating it. */
export const fetchImportReceipt = (operationId: string, window: ImportReadWindow = {}): Promise<ReadResult<ReadEnvelope<ImportReceiptEnvelope>>> => readImportRecord(operationId, window);
/** Reads the reviewable proposal of one import operation by its identity, so a reload or a return visit resumes the same file instead of uploading it again. */
export const fetchImportProposal = (operationId: string, window: ImportReadWindow = {}): Promise<ReadResult<ReadEnvelope<ImportProposalEnvelope>>> => readImportRecord(operationId, window);
