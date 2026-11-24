import { NextResponse } from "next/server";
import { redactDenial } from "@/lib/redaction";
import { assertNever } from "@/lib/result";
import { isReadResult, ROOT_FIELD_KEY, type DenialReason, type FieldMessages, type InvalidOutcome, type MutationOutcome, type ReadResult } from "./outcome";
const PAYLOAD_FIELD_PATH = "payload";
const PAYLOAD_FIELD_PREFIX = `${PAYLOAD_FIELD_PATH}.`;
const PERMISSION_REFUSAL_STATUS = 403;
const SESSION_FAULT_STATUS = 401;
const REQUEST_REFUSAL_STATUS = 422;
const SESSION_FAULT_REASONS: ReadonlySet<DenialReason> = new Set<DenialReason>(["session-expired", "session-unavailable"]);
function payloadRelativeFields(fields: FieldMessages): FieldMessages {
  const messages = new Map<string, string[]>();
  for (const [path, pathMessages] of Object.entries(fields)) {
    let key = path;
    if (key === PAYLOAD_FIELD_PATH) {
      key = ROOT_FIELD_KEY;
    } else if (key.startsWith(PAYLOAD_FIELD_PREFIX)) key = key.slice(PAYLOAD_FIELD_PREFIX.length);
    const existing = messages.get(key);
    if (existing === undefined) {
      messages.set(key, [...pathMessages]);
    } else {
      for (const message of pathMessages) if (!existing.includes(message)) existing.push(message);
    }
  }
  return Object.fromEntries(messages);
}
const requestRefusal = (outcome: InvalidOutcome, headers: Headers): Response => NextResponse.json({ ...outcome, fields: payloadRelativeFields(outcome.fields) }, { status: REQUEST_REFUSAL_STATUS, headers });
/** Turns an outcome — or a read result — into the one HTTP response a Route Handler returns. */ export function toResponse(input: MutationOutcome | ReadResult<unknown>, init?: { headers?: HeadersInit }): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (isReadResult(input)) {
    switch (input.kind) {
      case "envelope":
        headers.set("cache-control", "no-store");
        return NextResponse.json(input.envelope === undefined ? null : input.envelope, { status: 200, headers });
      case "denied":
        return respond(input.denied, headers);
      case "unavailable":
        return respond(input.unavailable, headers);
      case "refused":
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
      const status = SESSION_FAULT_REASONS.has(outcome.reasonCode) ? SESSION_FAULT_STATUS : PERMISSION_REFUSAL_STATUS;
      return NextResponse.json(redactDenial(outcome), { status, headers });
    }
    case "invalid":
      return requestRefusal(outcome, headers);
    case "unavailable":
      return NextResponse.json(outcome, { status: 503, headers });
    case "unknown":
      return NextResponse.json(outcome, { status: 202, headers });
    default:
      return assertNever(outcome, "Unhandled mutation outcome");
  }
}
