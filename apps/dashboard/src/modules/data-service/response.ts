/**
 * The one HTTP response a Route Handler returns for a mutation outcome or a read result.
 *
 * This module holds the single status ladder of the contract. An `accepted`, `alreadyAccepted` or
 * `unchanged` operation answers 200, a `conflict` 409, a `denied` 403 saying nothing about the
 * record it hides, an `invalid` payload 422 with per-field messages, an `unavailable` source 503
 * naming that source and the retry that is safe, and a lost acknowledgement 202 carrying the
 * `operationId`. A read result flattens onto the same ladder, because the status already
 * discriminates its arms: 200 carries the envelope itself, 403 the denial and 503 the outage.
 *
 * Why the mapping is its own module rather than part of `outcome.ts`. It is the only part of the
 * contract that needs `next/server`, because `NextResponse.json` is what serialises a body and
 * builds the `Response` an adapter returns. An import of it at the top of `outcome.ts` would put
 * server response machinery in the module graph of everything that value-imports the contract —
 * the eight constructors, `isOutcome`, `isReadResult`, `outcomeFromError` — so a Client Component
 * that read a mutation answer would pull the server runtime into the browser bundle. Keeping the
 * one server-only function here is what lets the contract itself stay browser-safe: a component
 * imports `isOutcome` and `outcomeFromError` from `outcome.ts` directly, and only this module,
 * which no component imports, reaches `next/server`.
 *
 * Nothing is duplicated by that split. This file carries the contract's only status ladder, moved
 * whole from `outcome.ts`, and no handler, read or mutation states a status of its own.
 *
 * Layering: a data-service module that imports the outcome contract it maps, the redaction helper
 * that keeps a denial from carrying an existence flag, a count, a title or a size, and the
 * exhaustive-switch helper that makes a ninth outcome fail to compile rather than fall through. It
 * imports no store, no read, no mutation, no component and no feature; nothing imports it except
 * the data service's barrel, which the four Route Handlers under `src/app/api/**` take
 * `toResponse` from, so the dependency direction stays one-way and no cycle can form.
 */
import { NextResponse } from "next/server";

import { redactDenial } from "@/lib/redaction";
import { assertNever } from "@/lib/result";

import {
  isReadResult,
  ROOT_FIELD_KEY,
  type FieldMessages,
  type MutationOutcome,
  type ReadResult,
} from "./outcome";

/** The envelope member a request body's payload hangs off, as a whole-body schema names it. */
const PAYLOAD_FIELD_PATH = "payload";

/** The path a field inside the payload arrives under when the whole request body was validated. */
const PAYLOAD_FIELD_PREFIX = `${PAYLOAD_FIELD_PATH}.`;

/**
 * Re-keys an `invalid` body's fields onto the payload the caller posted, which is the convention
 * every form in this tree already renders: the media picker's field labels are `placement.altText`
 * and `probe.width`, the import mapper reads `byField.confirmedMapping`, and the hooks that
 * pre-validate a payload themselves (`use-save-goal`, `use-follow-up-task`) answer with the payload's
 * own paths. A handler that validated the whole request body reports the same input as
 * `payload.title`, so the transport is the outlier and this is the one place that reconciles it.
 *
 * A path beginning `payload.` loses that prefix and nothing else changes. The bare path `payload`
 * names the payload object as a whole rather than a control, so it becomes `ROOT_FIELD_KEY`: a
 * form-level issue, which is the answer the service already gives for the same input. Every other
 * key is an envelope-level refusal or a payload-relative key the service produced, and passes through
 * untouched. Order is kept — keys in the order they arrived, each key's messages in their own order,
 * and two source keys that collapse onto one append the later messages rather than replace them.
 */
function payloadRelativeFields(fields: FieldMessages): FieldMessages {
  const messages: Record<string, string[]> = {};
  for (const [path, pathMessages] of Object.entries(fields)) {
    let key = path;
    if (key === PAYLOAD_FIELD_PATH) {
      key = ROOT_FIELD_KEY;
    } else if (key.startsWith(PAYLOAD_FIELD_PREFIX)) {
      key = key.slice(PAYLOAD_FIELD_PREFIX.length);
    }
    const existing = messages[key];
    if (existing === undefined) {
      messages[key] = [...pathMessages];
    } else {
      for (const message of pathMessages) {
        if (!existing.includes(message)) {
          existing.push(message);
        }
      }
    }
  }
  return messages;
}


/**
 * Turns an outcome — or a read result — into the one HTTP response a Route Handler returns.
 *
 * This is the only status ladder in the application. A handler that mapped an outcome itself would
 * be a second policy for the same contract, and the two would eventually disagree about whether a
 * lost acknowledgement is a success.
 *
 * Three properties of the mapping are deliberate and must not be "tidied":
 *
 * - `denied` is 403 for every denial, with the same body shape whether or not the record exists,
 *   because 404-versus-403 is an existence oracle.
 * - `unknown` is 202 and carries the `operationId`; the body promises neither success nor failure.
 * - `unavailable` is 503 and carries `{ system, reference }` plus retry guidance, so a surface can
 *   name the source that is down rather than showing an empty list or a zero.
 *
 * Bodies are the outcome objects themselves — never `{ ok: true }` or `{ data }` wrappers — so the
 * union's discriminant is the contract a client switches on. No caching directive is set on a
 * mutation response: the response is not reusable at all, and a policy header here would be a
 * second, contradictory statement of that.
 *
 * Field keys on an `invalid` body are relative to the payload the caller posted, never to the
 * envelope it arrived in: `fieldErrorsFromInvalid` attaches each message to the control that carried
 * the value, so `title` and `placement.altText` are the keys a form renders. A schema that validated
 * the whole request body reports that same input as `payload.title`, and the prefix is what this
 * mapping removes. An envelope-level refusal keeps its own name (`operationId`, `scope`,
 * `expectedRevision`), and an issue with the payload as a whole — which names no control and belongs
 * to the form — is keyed `ROOT_FIELD_KEY` like every other form-level issue.
 *
 * A read result flattens onto the wire, because the status already discriminates it: 200 carries
 * the envelope itself, 403 the denial and 503 the outage. The `kind` wrapper belongs to the
 * in-process value a read returns, which is what `isReadResult` narrows; a client that has a
 * response reads the status first and then `isOutcome` for the two failure bodies.
 */
export function toResponse(
  input: MutationOutcome | ReadResult<unknown>,
  init?: { headers?: HeadersInit },
): Response {
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

/**
 * The one status ladder, reached from both arms of `toResponse` so a denial or an outage carries
 * exactly the status it would carry as a bare outcome.
 *
 * The grouped cases are not an accident: `accepted`, `alreadyAccepted` and `unchanged` are three
 * different facts that share one status, and they keep their separate discriminants in the body so
 * a client still distinguishes "applied now" from "applied earlier" from "nothing to do".
 */
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
      return NextResponse.json(
        { ...outcome, fields: payloadRelativeFields(outcome.fields) },
        { status: 422, headers },
      );
    case "unavailable":
      return NextResponse.json(outcome, { status: 503, headers });
    case "unknown":
      return NextResponse.json(outcome, { status: 202, headers });
    default:
      return assertNever(outcome, "Unhandled mutation outcome");
  }
}
