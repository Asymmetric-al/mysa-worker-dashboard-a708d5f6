/**
 * `GET /api/coaching/checkins` — the worker's own check-ins, private draft and shared revision apart —
 * and `POST /api/coaching/checkins`, the four named check-in changes.
 *
 * **The read.** `GET` forwards the page window the request stated — `page` and `pageSize` — to
 * `reads.coaching.readCheckIns` untouched. The read applies the coaching family's 25-row default and
 * 100-row cap, reports the private draft and the shared revision as two identities with two revisions,
 * states the request ceiling it measures against, and never shortens a value: a check-in over a limit is
 * refused when it is written, with its count shown, because a truncated answer would misstate what the
 * worker wrote. Nothing is defaulted, clamped or measured a second time here.
 *
 * **The writes.** `POST` runs exactly one named mutation, selected by `payload.operation`, whose closed
 * set is `saveCheckIn`, `shareCheckIn`, `updateSharedCheckIn` and `withdrawCheckIn`. The body is the
 * four-field mutation input of AAP 0.7.1 plus that discriminant:
 *
 *     { operationId, scope, expectedRevision, payload: { operation, ...this mutation's fields } }
 *
 * `operation` is routing metadata, not a field of any check-in: it selects one schema here and is
 * removed before the mutation reads the payload, whose own strict schema is the only declaration of its
 * fields and the only source of the per-field messages an `invalid` answer carries. `operationId`,
 * `scope` and `expectedRevision` are forwarded untouched, so a replay is recognised by identity and a
 * stale revision still reaches the service as a `conflict`.
 *
 * **The four states stay four.** Private autosave and sharing are different acts, so `saveCheckIn`
 * writes the private draft and shares nothing, `shareCheckIn` snapshots what was saved, only
 * `updateSharedCheckIn` changes what a coach reads, and `withdrawCheckIn` ends the disclosure without
 * deleting the worker's own text. Withdrawal carries no body on purpose, so it succeeds while an
 * unrelated draft elsewhere is invalid — which is why this path validates no text of its own and lets
 * the mutation's schema keep that property.
 *
 * **Who authorises.** The service, inside each mutation: it re-derives the caller from the development
 * session, checks that the check-in is the worker's own, and refuses a stale shared revision. This file
 * checks no permission, reads no clock and measures no scalar.
 *
 * **One status ladder.** Every answer goes through `toResponse` — an envelope is 200, as are
 * `accepted`, `alreadyAccepted` and `unchanged`; `unknown` is 202 with the `operationId`; `denied` 403,
 * `conflict` 409, `invalid` 422 and `unavailable` 503 naming the source. A throw is mapped by
 * `outcomeFromError` rather than escaping, on both verbs, so no fault is answered with an empty
 * check-in list.
 *
 * **Layering.** `app/api → modules/data-service`, the package root only: never the synthetic store,
 * never a read or mutation module's deep path, never a feature module for a value or a type.
 */

import { z } from "zod";

import { assertNever } from "@/lib/result";
import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  reads,
  toResponse,
  type MutationInput,
  type MutationOutcome,
} from "@/modules/data-service";

/** The store reads and writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";

/** Both verbs resolve the development session and evaluate the scenario clock once per request. */
export const dynamic = "force-dynamic";

/**
 * The marker the service puts on an attempt that carries no identity of its own, and the one a read
 * carries in place of an attempt it never makes.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
const READ_ATTEMPT_ID = "read";

/**
 * The wording this file owns: the two refusals it makes before any mutation sees the request.
 *
 * Every limit and every message about a question or an answer comes from the check-in module, which is
 * the one owner of those numbers — so no ceiling, no message and no truncation appears here.
 */
const MESSAGES = {
  operationRequired:
    "State which change this request makes as payload.operation: saveCheckIn, shareCheckIn, updateSharedCheckIn or withdrawCheckIn.",
  bodyNotJson:
    "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

// ---------------------------------------------------------------------------------------------
// One payload type per named mutation, read from the mutation that validates it
// ---------------------------------------------------------------------------------------------

/** What `saveCheckIn` accepts: the draft it extends, the captured questions and the answers. */
type SaveCheckInPayload = Parameters<typeof mutations.coaching.saveCheckIn>[0]["payload"];

/** What `shareCheckIn` accepts: the check-in whose saved revision becomes readable. */
type ShareCheckInPayload = Parameters<typeof mutations.coaching.shareCheckIn>[0]["payload"];

/** What `updateSharedCheckIn` accepts: the check-in and the wording that replaces what was read. */
type UpdateSharedCheckInPayload = Parameters<
  typeof mutations.coaching.updateSharedCheckIn
>[0]["payload"];

/** What `withdrawCheckIn` accepts: which check-in, and which shared revision if the surface states one. */
type WithdrawCheckInPayload = Parameters<typeof mutations.coaching.withdrawCheckIn>[0]["payload"];

/**
 * A payload as it arrives on the wire: the mutation's own payload, plus the discriminant that selected
 * it.
 *
 * The intersection is a type statement only. The discriminant is stripped before the mutation reads the
 * payload, so a request cannot smuggle a routing fact into a record that declares no such field.
 */
type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };

// ---------------------------------------------------------------------------------------------
// One body schema per mutation: the four-field envelope around that mutation's own payload
// ---------------------------------------------------------------------------------------------

const saveCheckInBodySchema = mutationInputSchema(
  z.custom<WirePayload<SaveCheckInPayload, "saveCheckIn">>(),
);
const shareCheckInBodySchema = mutationInputSchema(
  z.custom<WirePayload<ShareCheckInPayload, "shareCheckIn">>(),
);
const updateSharedCheckInBodySchema = mutationInputSchema(
  z.custom<WirePayload<UpdateSharedCheckInPayload, "updateSharedCheckIn">>(),
);
const withdrawCheckInBodySchema = mutationInputSchema(
  z.custom<WirePayload<WithdrawCheckInPayload, "withdrawCheckIn">>(),
);

/** The closed set of mutations this path dispatches, in the order the plan states them. */
const CHECK_IN_OPERATIONS = [
  "saveCheckIn",
  "shareCheckIn",
  "updateSharedCheckIn",
  "withdrawCheckIn",
] as const;

// ---------------------------------------------------------------------------------------------
// The read side: the page window the request stated, forwarded as it stands
// ---------------------------------------------------------------------------------------------

/** The declared parameter shape of the one read this handler serves. */
type CheckInListQuery = Parameters<typeof reads.coaching.readCheckIns>[0];

/**
 * The page window exactly as the request stated it.
 *
 * An absent parameter stays absent rather than becoming a zero, so "not stated" and "stated as the first
 * page" remain different requests and the read's own default applies to the first of them. A value that
 * is not a number is passed on as the `NaN` a URL produces, which the read treats as unstated rather
 * than a page this file invented.
 */
function checkInListQueryOf(request: Request): CheckInListQuery {
  const params = new URL(request.url).searchParams;
  const page = params.get("page");
  const pageSize = params.get("pageSize");

  return {
    page: page === null ? undefined : Number(page),
    pageSize: pageSize === null ? undefined : Number(pageSize),
  };
}

// ---------------------------------------------------------------------------------------------
// The write side: one named mutation per request
// ---------------------------------------------------------------------------------------------

/** The attempt identity a body states, so a refusal can name the attempt the caller can replay. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of this path's four names.
 *
 * Only the discriminant is read here, so a body carrying extra keys is not refused at this point: the
 * chosen mutation's own closed schema reports those against their own field paths.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(CHECK_IN_OPERATIONS, { error: MESSAGES.operationRequired }) },
      { error: MESSAGES.operationRequired },
    ),
  },
  { error: MESSAGES.bodyNotJson },
);

/** The request body, or `undefined` when it is absent or is not valid JSON. */
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}

/** The attempt identity to report on a refusal, read defensively: a malformed body states none. */
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0
    ? identity.data.operationId
    : UNIDENTIFIED_ATTEMPT;
}

/**
 * The payload a mutation receives: the routing discriminant removed, everything else as stated.
 *
 * Every check-in payload schema is closed and declares no `operation` field, so leaving the discriminant
 * in place would turn every request into an unrecognised-key refusal. Removing it here is what keeps the
 * field a routing fact rather than a second description of a check-in.
 */
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

/**
 * Validates one body against one mutation's own schema, then calls exactly that mutation once.
 *
 * The four contract fields are forwarded untouched. A throw is mapped rather than propagated: the
 * service answers its refusals as outcomes, so a throw means a store or medium fault, or a failure whose
 * fate is not known.
 */
async function dispatch<Wire extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<Wire>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<Wire, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}

// ---------------------------------------------------------------------------------------------
// The two verbs
// ---------------------------------------------------------------------------------------------

/**
 * One page of the worker's check-ins, each with its captured question set, its private draft revision,
 * its shared revision and the states they stand in.
 *
 * The answer is always one envelope — `data`, `scope`, `source`, `revision`, `asOf`, `coverage`,
 * `valueStates`, `actions` — never a bare array and never a handler-computed total. A denial carries no
 * check-in text, count or existence hint, and an unavailable source is neither an empty list nor a zero.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return toResponse(await reads.coaching.readCheckIns(checkInListQueryOf(request)));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and
    // a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}

/**
 * One named check-in mutation, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with its own status: a stale shared revision is a `conflict`
 * that preserves the submitted wording for comparison, a replay is `alreadyAccepted` with the stored
 * result, an over-limit answer is `invalid` with each measured value and its limit, and a discriminant
 * naming a mutation of another coaching path is `invalid` naming `payload.operation`.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);

  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }

  switch (claimed.data.payload.operation) {
    case "saveCheckIn":
      return dispatch(saveCheckInBodySchema, raw, operationId, mutations.coaching.saveCheckIn);
    case "shareCheckIn":
      return dispatch(shareCheckInBodySchema, raw, operationId, mutations.coaching.shareCheckIn);
    case "updateSharedCheckIn":
      return dispatch(
        updateSharedCheckInBodySchema,
        raw,
        operationId,
        mutations.coaching.updateSharedCheckIn,
      );
    case "withdrawCheckIn":
      return dispatch(
        withdrawCheckInBodySchema,
        raw,
        operationId,
        mutations.coaching.withdrawCheckIn,
      );
    default:
      // Unreachable: the four names above are the closed set the discriminant schema admits, so a fifth
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled coaching check-in mutation");
  }
}
