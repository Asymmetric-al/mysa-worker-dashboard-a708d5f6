import { isNonEmptyString, isRecord } from "@/lib/guards";
import { READ_ATTEMPT_ID } from "@/lib/read-transport";
import type { MutationInput, MutationOutcome, ReadEnvelope, ReadResult } from "@/modules/data-service";
import { isOutcome } from "@/modules/data-service/outcome";
const UNEXPECTED_BODY_REFERENCE = "unexpected-body";
const UNREAD_RESULT_GUIDANCE = "This page could not read the result from the local data service. Nothing was changed, because a read has no effect to repeat, so the same request can be tried again.";
/** The closed set of transport paths this family may call, exactly as AAP 0.6.3 names them. */
export const INITIATIVE_API = Object.freeze({ initiatives: "/api/initiatives", members: "/api/initiatives/members", stages: "/api/initiatives/stages", requests: "/api/initiatives/requests", response: "/api/initiatives/requests/response", close: "/api/initiatives/close", reopen: "/api/initiatives/reopen" } as const);
export type InitiativeApiPath = (typeof INITIATIVE_API)[keyof typeof INITIATIVE_API];
/** Submits one named change to the initiative route it belongs to and answers with exactly one of the eight mutation outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`. */
export async function postMutation<P>(path: InitiativeApiPath, input: MutationInput<P>): Promise<MutationOutcome> {
  let body: string;
  try {
    body = JSON.stringify(input);
  } catch {
    return { outcome: "invalid", operationId: input.operationId, fields: { payload: ["This change could not be encoded for sending, so nothing was sent. Check the entered values and try again."] } };
  }
  let text: string;
  try {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", cache: "no-store", body });
    text = await response.text();
  } catch {
    return { outcome: "unknown", operationId: input.operationId };
  }
  const parsed = parseJson(text);
  if (parsed !== null && isOutcome(parsed.value)) return parsed.value;
  return { outcome: "unknown", operationId: input.operationId };
}
/** Whether a parsed body carries the frame every read envelope the service owns states: its `data`, the scope, source, coverage and value states it ran under, its revision and as-of instant, and its advisory actions. `data`'s own shape is never checked here: this transport is generic over `T`, so the caller owns its payload type. */
function isEnvelopeFrame(value: unknown): value is ReadEnvelope<unknown> {
  return (
    isRecord(value) &&
    "data" in value &&
    isRecord(value.scope) &&
    isRecord(value.source) &&
    isNonEmptyString(value.revision) &&
    isNonEmptyString(value.asOf) &&
    isRecord(value.coverage) &&
    isRecord(value.valueStates) &&
    Array.isArray(value.actions) &&
    value.actions.every((action: unknown) => isRecord(action) && typeof action.name === "string" && typeof action.available === "boolean")
  );
}
/** Reads one initiative result under the scope and query state the caller supplies, and answers with the outcomes the read produces: `{ kind: "envelope", envelope }`, a denial, the refusal of a request it does not admit, or the outage. A status-200 body is admitted by its frame, so a body that carries none of the envelope's members is an outage rather than an envelope. */
export async function readEnvelope<T>(path: InitiativeApiPath, params: Readonly<Record<string, string | number | undefined>>): Promise<ReadResult<T>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const search = query.toString();
  let status: number;
  let text: string;
  try {
    const response = await fetch(search === "" ? path : `${path}?${search}`, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    status = response.status;
    text = await response.text();
  } catch {
    return unreadResult("no-response");
  }
  const parsed = parseJson(text);
  if (parsed === null) return unreadResult("unreadable-body");
  const body: unknown = parsed.value;
  if (status === 200) return isEnvelopeFrame(body) ? { kind: "envelope", envelope: body as T } : unreadResult(UNEXPECTED_BODY_REFERENCE);
  if (isOutcome(body)) {
    if (body.outcome === "denied") return { kind: "denied", denied: body };
    if (body.outcome === "unavailable") return { kind: "unavailable", unavailable: body };
    if (body.outcome === "invalid") return { kind: "refused", refused: body };
  }
  return unreadResult(UNEXPECTED_BODY_REFERENCE);
}
function parseJson(text: string): { readonly value: unknown } | null {
  if (text === "") return null;
  try {
    const value: unknown = JSON.parse(text);
    return { value };
  } catch {
    return null;
  }
}
/** The outage a read states when it produced none of its own outcomes: it reports the shared read attempt identity, because a read has no attempt of its own to name and its outage is the same read-level answer every other transport states. */
const unreadResult = <T>(reference: string): ReadResult<T> => ({ kind: "unavailable", unavailable: { outcome: "unavailable", operationId: READ_ATTEMPT_ID, source: { system: "data-service-transport", reference }, guidance: UNREAD_RESULT_GUIDANCE } });
