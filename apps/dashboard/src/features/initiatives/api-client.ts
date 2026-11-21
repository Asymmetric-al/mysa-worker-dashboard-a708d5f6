/**
 * The initiatives family's one browser transport: the closed set of paths this family may call, the one
 * POST that submits a named change, and the one GET that reads a result.
 *
 * **Scope.** AAP 0.7.1 fixes both directions of browser traffic — a read calls `GET /api/<job>` with the
 * scope and query state in the URL and receives one `ReadEnvelope`; a change posts
 * `{ operationId, scope, expectedRevision, payload }` and receives exactly one of the eight mutation
 * outcomes. AAP 0.6.3 is the closed set of initiative paths named below, AAP 0.3.2 makes a Route Handler
 * the only browser mutation transport (Server Actions are not used), and Rule 1 clause 2 forbids a
 * generic `request(method, path, body)` dispatcher, a generated SDK and a field-map payload. Those
 * constraints are why this module is a path map, one POST and one GET rather than a small HTTP client,
 * and why nothing else in the family may call `fetch`.
 *
 * **Why the narrowing is written here.** `@/modules/data-service` also exports `isOutcome` and
 * `isReadResult`, but its outcome module imports `next/server`, `@/lib/guards` (which reads
 * `process.env`) and the redaction helpers, so a *value* import from it inside a Client Component would
 * drag server-only code into the browser bundle. This module therefore imports types only and
 * re-establishes the closed set as an exhaustive `Record<MutationOutcome["outcome"], check>`: a member
 * added to, renamed in or removed from the union fails typecheck here, instead of letting an
 * unrecognised body through as a valid answer.
 *
 * **What the wire actually carries.** `toResponse` flattens `ReadResult` onto the status — 200 carries
 * the envelope object itself, 403 the denial and 503 the outage, with no `kind` wrapper around any of
 * them — so {@link readEnvelope} is the one place that mapping is read back and the union rebuilt. The
 * same flattening is why {@link postMutation} ignores `response.ok`: the body is the contract, and
 * `conflict` (409), `invalid` (422), `denied` (403), `unavailable` (503) and `unknown` (202) are answers
 * a caller renders, not faults to throw.
 *
 * **What it never does.** It never throws: a rejected request, a body that is not JSON and a body that is
 * not one of the eight outcomes all become the honest answer for their direction — `unknown` carrying
 * the caller's own `operationId` for a change, because success and failure would both be lies; and
 * `unavailable` for a read, because a read never renders as nothing found. It never retries, never mints
 * a second identity for one intent, never falls back to a fixture or a cached value, never reads a clock
 * (the envelope's `asOf` is the only time a view may state), never logs and never computes a filter, a
 * sort, a page or a total: the service owns all of that (AAP 0.9.2), so a value this module returns is
 * exactly the value the service produced.
 *
 * **Where it may be called.** It carries no `"use client"` directive and exports no hook and no JSX, so
 * it imports from either side of the boundary without creating one — and it is nevertheless the browser's
 * transport. A Server Component reads through the data service directly rather than through this module
 * or the application's own HTTP endpoint (AAP 0.3.2), so no server rendering path reaches it.
 */

import { newOperationId, type SourceReference } from "@/lib/ids";
import type {
  DenialReason,
  MutationInput,
  MutationOutcome,
  ReadResult,
} from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The source this module names when a request produced no readable result.
 *
 * It is the transport rather than the local store: the request can fail before it reaches the service,
 * so naming the store would claim knowledge of where the failure happened.
 */
const TRANSPORT_SYSTEM = "data-service-transport";

/** No response arrived at all: the request was rejected before a status or a body existed. */
const NO_RESPONSE_REFERENCE = "no-response";

/** A response arrived but its body was empty or not JSON, so nothing could be read from it. */
const UNREADABLE_BODY_REFERENCE = "unreadable-body";

/** A response arrived whose body is not the shape its status promises. */
const UNEXPECTED_BODY_REFERENCE = "unexpected-body";

/**
 * What a surface tells someone when a read could not be read. It says that nothing changed — a read has
 * no effect to repeat — and names the one safe action, which is making the same read again.
 */
const UNREAD_RESULT_GUIDANCE =
  "This page could not read the result from the local data service. Nothing was changed, because a read has no effect to repeat, so the same request can be tried again.";

/** Why a change was refused before it left the browser: its payload could not be encoded as JSON. */
const UNENCODABLE_PAYLOAD_MESSAGE =
  "This change could not be encoded for sending, so nothing was sent. Check the entered values and try again.";

// ---------------------------------------------------------------------------------------------
// The closed set of paths
// ---------------------------------------------------------------------------------------------

/**
 * The closed set of transport paths this family may call, exactly as AAP 0.6.3 names them.
 *
 * One map rather than a URL assembled at each call site, because a path built in a hook is a second
 * statement of the route contract: a hook that needs an endpoint this map does not carry means the plan
 * changed, not that a string may be concatenated here. `response` is the path that records one answer
 * against a Request that was already presented, which is why it sits under `requests` rather than beside
 * it.
 */
export const INITIATIVE_API = Object.freeze({
  initiatives: "/api/initiatives",
  members: "/api/initiatives/members",
  stages: "/api/initiatives/stages",
  requests: "/api/initiatives/requests",
  response: "/api/initiatives/requests/response",
  close: "/api/initiatives/close",
  reopen: "/api/initiatives/reopen",
} as const);

/** Every path {@link INITIATIVE_API} declares, and the only transport path a hook in this family may pass. */
export type InitiativeApiPath = (typeof INITIATIVE_API)[keyof typeof INITIATIVE_API];

// ---------------------------------------------------------------------------------------------
// Narrowing untrusted bodies
// ---------------------------------------------------------------------------------------------

/*
 * The three guards below are declared here rather than imported from `@/lib/guards`, whose helpers they
 * mirror. That module reads the environment for the development boundary, so importing it from a module
 * a Client Component loads would pull an environment read into the browser bundle for a type predicate
 * that needs nothing at all.
 */

/** Narrows an unparsed value to a plain object, excluding arrays and null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrows an unparsed value to a string carrying at least one character. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Narrows an unparsed value to a source identity whose owner and opaque reference are both present. */
function isSourceReference(value: unknown): value is SourceReference {
  return isRecord(value) && isNonEmptyString(value.system) && isNonEmptyString(value.reference);
}

/**
 * The closed denial vocabulary, restated as an exhaustive record over the service's `DenialReason`.
 *
 * It is a mapped type rather than a hand-written list so a reason added to, renamed in or removed from
 * the service's union leaves a key missing or surplus and fails typecheck here — otherwise a legitimate
 * denial would silently be read as an unrecognised body and answered as `unknown`.
 */
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

/** Narrows an unparsed value to one of the closed denial reason codes. */
function isDenialReason(value: unknown): value is DenialReason {
  return typeof value === "string" && Object.hasOwn(DENIAL_REASONS, value);
}

/** The members of {@link MutationOutcome}, read off the union itself so the checks below cannot drift. */
type OutcomeName = MutationOutcome["outcome"];

/** One structural check of an unparsed body against a single outcome member. */
type OutcomeCheck = (body: Record<string, unknown>) => boolean;

/**
 * One structural check per mutation outcome, keyed by the union's own discriminant.
 *
 * Mapping over `MutationOutcome["outcome"]` makes this record exhaustive by construction: an outcome
 * added to, renamed in or removed from the service's union leaves a key missing or surplus and fails
 * typecheck here. Each check requires the fields that member carries, because a truncated body must be
 * refused rather than read as a valid answer — the first thing this predicate protects is the difference
 * between `accepted` and `unknown`.
 */
const OUTCOME_CHECKS: { readonly [Name in OutcomeName]: OutcomeCheck } = {
  accepted: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string",
  alreadyAccepted: (body) =>
    isNonEmptyString(body.operationId) && typeof body.revision === "string" && "result" in body,
  unchanged: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string",
  conflict: (body) =>
    isNonEmptyString(body.operationId) &&
    typeof body.currentRevision === "string" &&
    (body.reason === "stale-revision" || body.reason === "changed-intent") &&
    "current" in body &&
    "preservedInput" in body,
  denied: (body) => isNonEmptyString(body.operationId) && isDenialReason(body.reasonCode),
  invalid: (body) => isNonEmptyString(body.operationId) && isRecord(body.fields),
  unavailable: (body) =>
    isNonEmptyString(body.operationId) &&
    isSourceReference(body.source) &&
    isNonEmptyString(body.guidance),
  unknown: (body) => isNonEmptyString(body.operationId),
};

/**
 * Reports whether a parsed body is one of the eight mutation outcomes.
 *
 * This is the client-side half of the service's contract, written here rather than imported because the
 * service's own `isOutcome` lives beside a `next/server` import (see the module comment). It reads the
 * discriminant as an untrusted string, refuses anything that is not a plain object or not a name the
 * union declares, and then checks the fields that member must carry — so a truncated or foreign body is
 * refused instead of being presented as an answer the caller can act on.
 */
export function isMutationOutcome(value: unknown): value is MutationOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const name: unknown = value.outcome;
  if (typeof name !== "string" || !Object.hasOwn(OUTCOME_CHECKS, name)) {
    return false;
  }
  return OUTCOME_CHECKS[name as OutcomeName](value);
}

// ---------------------------------------------------------------------------------------------
// The two directions
// ---------------------------------------------------------------------------------------------

/**
 * Submits one named change to the initiative route it belongs to and answers with exactly one of the
 * eight mutation outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`,
 * `unavailable` or `unknown`.
 *
 * `unknown` is the answer whenever this module cannot know what happened — a rejected request, a body
 * that is not JSON, a body that is not one of the eight — and it carries the caller's own `operationId`,
 * which is the only handle by which that attempt can be recovered. Nothing here retries, mints a second
 * identity for one intent, or reads a lost acknowledgement as a reason to send the work again. A payload
 * that cannot be encoded as JSON never leaves the browser, so it is refused as `invalid` input rather
 * than reported as an uncertain effect.
 */
export async function postMutation<P>(
  path: InitiativeApiPath,
  input: MutationInput<P>,
): Promise<MutationOutcome> {
  let body: string;
  try {
    body = JSON.stringify(input);
  } catch {
    return {
      outcome: "invalid",
      operationId: input.operationId,
      fields: { payload: [UNENCODABLE_PAYLOAD_MESSAGE] },
    };
  }

  let text: string;
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body,
    });
    text = await response.text();
  } catch {
    return { outcome: "unknown", operationId: input.operationId };
  }

  const parsed = parseJson(text);
  if (parsed !== null && isMutationOutcome(parsed.value)) {
    return parsed.value;
  }
  return { outcome: "unknown", operationId: input.operationId };
}

/**
 * Reads one initiative result under the scope and query state the caller supplies, and answers with the
 * three outcomes the in-process service read produces: `{ kind: "envelope", envelope }`,
 * `{ kind: "denied", denied }` and `{ kind: "unavailable", unavailable }`.
 *
 * The wire flattens that union onto the status — 200 carries the envelope object itself, 403 the denial
 * and 503 the outage — so this function reads the mapping back and rebuilds the union, and anything it
 * cannot map (a rejected request, an empty body, a body that is not JSON, a body that is not the shape
 * its status promises) becomes `unavailable` rather than a thrown error or an empty result. `params`
 * carries the scope identifiers and the query state; `undefined` entries are skipped so an absent filter
 * is absent rather than the string "undefined", and the caller's object is never mutated. Nothing here
 * filters, sorts, paginates, totals or caches: the envelope is what the service computed.
 */
export async function readEnvelope<T>(
  path: InitiativeApiPath,
  params: Readonly<Record<string, string | number | undefined>>,
): Promise<ReadResult<T>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const search = query.toString();
  const url = search === "" ? path : `${path}?${search}`;

  let status: number;
  let text: string;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    status = response.status;
    text = await response.text();
  } catch {
    return unreadResult(NO_RESPONSE_REFERENCE);
  }

  const parsed = parseJson(text);
  if (parsed === null) {
    return unreadResult(UNREADABLE_BODY_REFERENCE);
  }
  const body: unknown = parsed.value;

  if (status === 200) {
    return isRecord(body)
      ? { kind: "envelope", envelope: body as T }
      : unreadResult(UNEXPECTED_BODY_REFERENCE);
  }
  if (isMutationOutcome(body)) {
    if (body.outcome === "denied") {
      return { kind: "denied", denied: body };
    }
    if (body.outcome === "unavailable") {
      return { kind: "unavailable", unavailable: body };
    }
  }
  return unreadResult(UNEXPECTED_BODY_REFERENCE);
}

// ---------------------------------------------------------------------------------------------
// Body parsing and the outage a read can name
// ---------------------------------------------------------------------------------------------

/** A successfully parsed body, tagged so a body of JSON `null` is distinct from an unparseable one. */
interface ParsedBody {
  readonly value: unknown;
}

/**
 * Parses a response body as JSON, answering `null` when it is empty or malformed.
 *
 * The parsed value is wrapped rather than returned directly, because `null` is a legitimate JSON value
 * and must not be confused with a body that could not be parsed at all.
 */
function parseJson(text: string): ParsedBody | null {
  if (text === "") {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return { value };
  } catch {
    return null;
  }
}

/**
 * Builds the `unavailable` result a read answers with when no usable response was read.
 *
 * The attempt identity is minted here because the outcome type requires one and no caller supplied it; it
 * names this attempt for a diagnostic, and the guidance states the one safe action — the same read again
 * — rather than inviting anything to be repeated that could have an effect.
 */
function unreadResult<T>(reference: string): ReadResult<T> {
  return {
    kind: "unavailable",
    unavailable: {
      outcome: "unavailable",
      operationId: newOperationId(),
      source: { system: TRANSPORT_SYSTEM, reference },
      guidance: UNREAD_RESULT_GUIDANCE,
    },
  };
}
