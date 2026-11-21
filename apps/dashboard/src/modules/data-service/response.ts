/** The one HTTP response a Route Handler returns for a mutation outcome or a read result. */
import { NextResponse } from "next/server";
import { redactDenial } from "@/lib/redaction";
import { assertNever } from "@/lib/result";
import { isReadResult, ROOT_FIELD_KEY, type DenialReason, type FieldMessages, type InvalidOutcome, type MutationOutcome, type ReadResult } from "./outcome";
const PAYLOAD_FIELD_PATH = "payload";
const PAYLOAD_FIELD_PREFIX = `${PAYLOAD_FIELD_PATH}.`;
/** The status a refusal of the caller's authority answers with. */
const PERMISSION_REFUSAL_STATUS = 403;
/** The status a session that expired or could not be established answers with, since no permission was ever refused. */
const SESSION_FAULT_STATUS = 401;
/** The status a refusal of the request itself answers with: the caller has to correct a field, and nothing was read or changed. */
const REQUEST_REFUSAL_STATUS = 422;
/** The two reasons a refusal is the session's own fault rather than the caller's authority. */
const SESSION_FAULT_REASONS: ReadonlySet<DenialReason> = new Set<DenialReason>(["session-expired", "session-unavailable"]);
function payloadRelativeFields(fields: FieldMessages): FieldMessages {
  // A re-based path is still the caller's own text, so it may name a member of `Object.prototype` or be `__proto__` itself. A map keeps every path an ordinary key here for the same reason: on a plain object `constructor` would answer with the inherited function and `__proto__` would change the object's prototype, so
  // the 422 body would either throw or lose the message it has to carry.
  const messages = new Map<string, string[]>();
  for (const [path, pathMessages] of Object.entries(fields)) {
    let key = path;
    if (key === PAYLOAD_FIELD_PATH) {
      key = ROOT_FIELD_KEY;
    } else if (key.startsWith(PAYLOAD_FIELD_PREFIX)) {
      key = key.slice(PAYLOAD_FIELD_PREFIX.length);
    }
    const existing = messages.get(key);
    if (existing === undefined) {
      messages.set(key, [...pathMessages]);
    } else {
      for (const message of pathMessages) {
        if (!existing.includes(message)) {
          existing.push(message);
        }
      }
    }
  }
  return Object.fromEntries(messages);
}
/** The one answer a refused request gets, whether the refusal was a mutation's payload or a read's own query: the field-keyed `invalid` outcome at 422, with its keys re-based onto the payload the … */
function requestRefusal(outcome: InvalidOutcome, headers: Headers): Response {
  return NextResponse.json({ ...outcome, fields: payloadRelativeFields(outcome.fields) }, { status: REQUEST_REFUSAL_STATUS, headers });
}
/** Turns an outcome — or a read result — into the one HTTP response a Route Handler returns. */
export function toResponse(input: MutationOutcome | ReadResult<unknown>, init?: { headers?: HeadersInit }): Response {
  const headers = new Headers(init?.headers);
  // Stated explicitly rather than relied on: a body carrying a person's name, a currency code or a right-to-left string must be decoded as UTF-8 by every client, including curl.
  headers.set("content-type", "application/json; charset=utf-8");
  if (isReadResult(input)) {
    switch (input.kind) {
      case "envelope":
        // An envelope is scope-dependent private data whose staleness would break whole-query agreement, so it is never stored by an intermediary or a browser cache.
        headers.set("cache-control", "no-store");
        return NextResponse.json(input.envelope === undefined ? null : input.envelope, { status: 200, headers });
      case "denied":
        return respond(input.denied, headers);
      case "unavailable":
        return respond(input.unavailable, headers);
      case "refused":
        // The request the read was asked to serve is the fault, so the caller is answered exactly what a malformed mutation payload is answered: the field-keyed refusal, and no claim that a source is down or that a permission was refused.
        return requestRefusal(input.refused, headers);
      default:
        return assertNever(input, "Unhandled read result");
    }
  }
  return respond(input, headers);
}
function respond(outcome: MutationOutcome, headers: Headers): Response {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
    case "unchanged":
      return NextResponse.json(outcome, { status: 200, headers });
    case "conflict":
      return NextResponse.json(outcome, { status: 409, headers });
    case "denied": {
      // A session that expired or could not be established is not an authorisation refusal: the caller never reached the permission check, so it is answered 401 while every other reason keeps 403. Only the status differs. The body is the same redacted `denied` outcome the closed eight-outcome set defines, so a client
      // that reads the body sees one answer and one that reads the status can tell a stale session apart from a refused permission.
      const status = SESSION_FAULT_REASONS.has(outcome.reasonCode) ? SESSION_FAULT_STATUS : PERMISSION_REFUSAL_STATUS;
      // Redacted once more on the way out: a denial built by hand, without the constructor, still cannot carry an existence flag, a count, a title or a size.
      return NextResponse.json(redactDenial(outcome), { status, headers });
    }
    case "invalid":
      return requestRefusal(outcome, headers);
    case "unavailable":
      return NextResponse.json(outcome, { status: 503, headers });
    case "unknown":
      // 202 by decision, never by accident: the request was well formed and the attempt is recorded under the caller's own operation id, so the exchange succeeded while the effect's fate did not. The body's `outcome: "unknown"` is the authoritative statement and the status never is — every client here reads the body
      // before deciding, and the ladder is recorded in docs/architecture.md.
      return NextResponse.json(outcome, { status: 202, headers });
    default:
      return assertNever(outcome, "Unhandled mutation outcome");
  }
}
