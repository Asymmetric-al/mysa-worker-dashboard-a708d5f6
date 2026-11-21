/**
 * `POST /api/initiatives/requests` — the two changes that create one Request and record what was
 * presented: `draftRequest` and `presentRequest`.
 *
 * **One record family, one path, two named mutations.** The discriminant is `payload.operation`, whose
 * closed set is those two names — the mutation names themselves. It is routing metadata rather than a
 * Request field, so it selects one mutation and is removed before that mutation's own closed schema
 * reads the payload; a body naming anything else is answered `invalid` naming `payload.operation`. No
 * table of operations, no field map and no universal command dispatcher sits in between: each name on
 * this path reaches exactly one named mutation.
 *
 * **What the two record.** One Request is one independently answerable invitation: a recipient, an
 * optionally represented organization as its own opaque reference, a purpose, and requested terms under
 * a version — exact money with currency, amount, cadence and term, or a non-financial description and
 * no amount. Drafting records what the worker intends to ask and nothing more: no pledge, gift,
 * commitment, subscription, receipt, task or send. `presentRequest` records the actual presentation —
 * the day, the manner and the terms version shown — once: an identical presentation is `unchanged`, and
 * a different one is refused rather than overwriting what an answer behind it may be bound to.
 *
 * **Who authorises.** The service, per request: the initiative's ministry must be the claimed one and
 * the session's principal must be the person responsible for it, and a closed initiative accepts no new
 * Request. Nothing here decides authority, so a refusal is `denied` with a reason code that discloses
 * nothing about the record it was asked about.
 *
 * **What this file never does.** It never chooses a status (only `toResponse` maps an outcome to one),
 * wraps a body, mints or bumps an `operationId` or an `expectedRevision`, restates a payload rule,
 * computes an amount, or decides whether a Request may still be presented — the mutations own all of
 * that, and they answer with their own outcomes.
 *
 * **Layering.** `app/api → modules/data-service`, through the barrel only.
 */

import { z } from "zod";

import { assertNever } from "@/lib/result";
import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  toResponse,
  type MutationInput,
  type MutationOutcome,
} from "@/modules/data-service";

// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// Every request resolves the development session and evaluates the scenario clock once.
export const dynamic = "force-dynamic";

/**
 * The marker a refused request carries where a real attempt would carry its `operationId`.
 *
 * A body too malformed to state a usable id names no attempt; the marker matches the service's own for
 * that case, so both refusals read alike and nothing is replayed under it.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/** Why a body that names no mutation of this path is refused, and which names it may state. */
const PAYLOAD_OPERATION_MESSAGE =
  "State which change this request makes as payload.operation: draftRequest or presentRequest.";

/** Why a body could not be read as a JSON object at all. */
const BODY_NOT_JSON_MESSAGE =
  "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.";

/** The closed set of mutations this path dispatches, in the order the plan states them. */
const REQUEST_OPERATIONS = ["draftRequest", "presentRequest"] as const;

/**
 * The payload whichever Request mutation the discriminant selected will receive, taken from the
 * mutations' own signatures.
 *
 * It is the mutations' business what a payload may carry: `draftRequest` requires a recipient, a
 * purpose and versioned requested terms, `presentRequest` requires the Request, the day, the manner and
 * the terms version shown. Each parses its own closed schema and answers a violation as `invalid` with
 * a message keyed by field path, so restating those rules here would give one rule two owners.
 */
type RequestPayload = Parameters<typeof mutations.outreach.draftRequest>[0]["payload"];

/**
 * The four-field mutation input around that payload, with the payload member left opaque for the
 * mutation to judge.
 *
 * One schema serves both mutations because the only thing that differs between them at this layer is
 * the discriminant the payload carries — and that is `payload.operation`'s job below, not the
 * envelope's.
 */
const requestBodySchema = mutationInputSchema(z.custom<RequestPayload>());

/** The attempt identity a body states, so a refusal can name the attempt the caller may re-query. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of the two names above.
 *
 * Only the discriminant is read at this point, so a body carrying extra keys is not refused here: the
 * chosen mutation's own closed schema reports those against their own field paths.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(REQUEST_OPERATIONS, { error: PAYLOAD_OPERATION_MESSAGE }) },
      { error: PAYLOAD_OPERATION_MESSAGE },
    ),
  },
  { error: BODY_NOT_JSON_MESSAGE },
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
 * Neither mutation's schema declares an `operation` member, and both are closed, so leaving the
 * discriminant in place would turn every request into an unrecognised-key refusal. Removing it here is
 * what keeps the field a routing fact rather than a second description of a Request. A payload that is
 * not an object is forwarded as it arrived, so the mutation refuses it as `invalid` instead of this
 * file deciding what shape it should have had.
 */
function payloadOf(payload: RequestPayload): RequestPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return payload;
  }
  const { operation: _discriminant, ...forwarded } = payload as Readonly<Record<string, unknown>>;
  return forwarded;
}

/**
 * Validates one body against this path's envelope, then calls exactly that mutation once.
 *
 * The four contract fields are forwarded untouched — `expectedRevision` and `operationId` included — so
 * a draft replayed after a lost acknowledgement answers with the stored Request instead of creating a
 * second one, and a stale revision still reaches the service as a `conflict`. Nothing is minted, bumped
 * or stripped. A thrown fault is converted the way the service's error mapping specifies.
 */
async function dispatch(
  schema: z.ZodType<MutationInput<RequestPayload>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<RequestPayload>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }

  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    return toResponse(outcomeFromError(operationId, error));
  }
}

/**
 * One named Request change, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with the status `toResponse` gives it, so a client never
 * infers success from an absent error: a replay is `alreadyAccepted` with the stored result, a repeated
 * presentation is `unchanged`, a stale revision is a `conflict` that preserves the submitted input, and
 * a discriminant naming no mutation on this path — the answer, the close or the reopen, which belong to
 * other paths — is `invalid` naming `payload.operation` and listing the two names accepted here.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);

  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }

  switch (claimed.data.payload.operation) {
    case "draftRequest":
      return dispatch(requestBodySchema, raw, operationId, mutations.outreach.draftRequest);
    case "presentRequest":
      return dispatch(requestBodySchema, raw, operationId, mutations.outreach.presentRequest);
    default:
      // Unreachable: the two names above are the closed set the discriminant admits, so a third
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled Request mutation");
  }
}
