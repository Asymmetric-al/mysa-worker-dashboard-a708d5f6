/**
 * The one HTTP response a Route Handler returns for a mutation outcome or a read result.
 */
import { NextResponse } from "next/server";
import { redactDenial } from "@/lib/redaction";
import { assertNever } from "@/lib/result";
import { isReadResult, ROOT_FIELD_KEY, type FieldMessages, type MutationOutcome, type ReadResult } from "./outcome";
const PAYLOAD_FIELD_PATH = "payload";

const PAYLOAD_FIELD_PREFIX = `${PAYLOAD_FIELD_PATH}.`;

function payloadRelativeFields(fields: FieldMessages): FieldMessages {
  // A re-based path is still the caller's own text, so it may name a member of `Object.prototype` or
  // be `__proto__` itself. A map keeps every path an ordinary key here for the same reason: on a plain
  // object `constructor` would answer with the inherited function and `__proto__` would change the
  // object's prototype, so the 422 body would either throw or lose the message it has to carry.
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
/** Turns an outcome — or a read result — into the one HTTP response a Route Handler returns. */
export function toResponse(input: MutationOutcome | ReadResult<unknown>, init?: { headers?: HeadersInit }): Response {
  const headers = new Headers(init?.headers);
  // Stated explicitly rather than relied on: a body carrying a person's name, a currency code or
  // a right-to-left string must be decoded as UTF-8 by every client, including curl.
  headers.set("content-type", "application/json; charset=utf-8");
  if (isReadResult(input)) {
    switch (input.kind) {
      case "envelope":
        // An envelope is scope-dependent private data whose staleness would break whole-query
        // agreement, so it is never stored by an intermediary or a browser cache.
        headers.set("cache-control", "no-store");
        return NextResponse.json(input.envelope === undefined ? null : input.envelope, {
          status: 200,
          headers,
        });
      case "denied":
        return respond(input.denied, headers);
      case "unavailable":
        return respond(input.unavailable, headers);
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
    case "denied":
      // Redacted once more on the way out: a denial built by hand, without the constructor, still
      // cannot carry an existence flag, a count, a title or a size.
      return NextResponse.json(redactDenial(outcome), { status: 403, headers });
    case "invalid":
      // Field keys are re-based onto the payload the caller posted at the one boundary every
      // mutation response crosses, so a handler that validated the whole body and a service that
      // validated the payload alone answer with one convention.
      return NextResponse.json({ ...outcome, fields: payloadRelativeFields(outcome.fields) }, { status: 422, headers });
    case "unavailable":
      return NextResponse.json(outcome, { status: 503, headers });
    case "unknown":
      return NextResponse.json(outcome, { status: 202, headers });
    default:
      return assertNever(outcome, "Unhandled mutation outcome");
  }
}
