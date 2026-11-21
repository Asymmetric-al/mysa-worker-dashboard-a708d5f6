/**
 * `POST /api/initiatives/members` — the three changes that act on one initiative's reviewed working
 * list: `addMembers`, `removeMember` and `returnMember`.
 *
 * **One record family, one path, three named mutations.** The discriminant is `payload.operation`,
 * whose closed set is those three names — the mutation names themselves. It is routing metadata rather
 * than a member field, so it selects one mutation and is removed before that mutation's own closed
 * schema reads the payload; a body naming anything else is answered `invalid` naming
 * `payload.operation`. There is no table of operations, no field map and no universal command
 * dispatcher: each name on this path reaches exactly one named mutation, and each mutation parses its
 * own payload before it asks any authority question.
 *
 * **What the three record and what they never prove.** `addMembers` records that explicitly selected
 * partners are on the list — which is not "asked", not contact permission and not membership of any
 * Update audience. `removeMember` keeps the history of having been included and the reason, and leaves
 * every independent obligation recorded elsewhere untouched, because a removal settles nothing but the
 * list. `returnMember` restores eligible planning only: a partner the worker excluded deliberately is
 * refused rather than silently included, and a return is not a new assessment, a task or a message.
 *
 * **Who authorises.** The service, per request: the initiative's own ministry must be the claimed one
 * and the principal the session resolves to must be the person responsible for it. Admission to a
 * ministry lets a colleague read an initiative without changing it, so nothing here decides authority —
 * a change outside that authority is `denied` with a reason code that discloses nothing.
 *
 * **What this file never does.** It never chooses a status (only `toResponse` maps an outcome to one),
 * wraps a body, mints or bumps an `operationId` or an `expectedRevision`, re-states a payload rule,
 * decides whether a partner is eligible, or turns a partial per-item result into a success: the
 * mutation's own `accepted | unchanged | excluded` items travel back inside its outcome untouched.
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
  "State which change this request makes as payload.operation: addMembers, removeMember or returnMember.";

/** Why a body could not be read as a JSON object at all. */
const BODY_NOT_JSON_MESSAGE =
  "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.";

/** The closed set of mutations this path dispatches, in the order the plan states them. */
const MEMBER_OPERATIONS = ["addMembers", "removeMember", "returnMember"] as const;

/**
 * The payload whichever member mutation the discriminant selected will receive, taken from the
 * mutations' own signatures.
 *
 * It is the mutations' business what a payload may carry: `addMembers` requires explicit partner
 * selections, `removeMember` requires a member and accepts a reason, `returnMember` requires a member
 * and nothing else. Each parses its own closed schema and answers a violation as `invalid` with a
 * message keyed by field path, so restating those rules here would give one rule two owners.
 */
type MemberPayload = Parameters<typeof mutations.outreach.addMembers>[0]["payload"];

/**
 * The four-field mutation input around that payload, with the payload member left opaque for the
 * mutation to judge.
 *
 * One schema serves the three mutations because the only thing that differs between them at this layer
 * is the discriminant the payload carries — and that is `payload.operation`'s job below, not the
 * envelope's.
 */
const memberRequestSchema = mutationInputSchema(z.custom<MemberPayload>());

/** The attempt identity a body states, so a refusal can name the attempt the caller may re-query. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of the three names above.
 *
 * Only the discriminant is read at this point, so a body carrying extra keys is not refused here: the
 * chosen mutation's own closed schema reports those against their own field paths.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(MEMBER_OPERATIONS, { error: PAYLOAD_OPERATION_MESSAGE }) },
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
 * The chosen mutation's schema is closed and declares no `operation` member, so leaving the
 * discriminant in place would turn every request into an unrecognised-key refusal. Removing it here is
 * what keeps the field a routing fact rather than a second description of a working-list member. A
 * payload that is not an object is forwarded as it arrived, so the mutation refuses it as `invalid`
 * instead of this file deciding what shape it should have had.
 */
function payloadOf(payload: MemberPayload): MemberPayload {
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
 * a replay still answers with the stored result instead of applying a second effect and a stale
 * revision still reaches the service as a `conflict`. Nothing is minted, bumped or stripped. A thrown
 * fault is converted the way the service's error mapping specifies, under this attempt's id.
 */
async function dispatch(
  schema: z.ZodType<MutationInput<MemberPayload>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<MemberPayload>) => Promise<MutationOutcome>,
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
 * One named working-list change, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with the status `toResponse` gives it, so a client never
 * infers success from an absent error: a stale revision is a `conflict` that preserves the submitted
 * input, a replay is `alreadyAccepted` with the stored result, a repeated selection is `unchanged`, and
 * a discriminant naming no mutation on this path — a stage change or a Request change, which belong to
 * other paths — is `invalid` naming `payload.operation` and listing the three names accepted here.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);

  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }

  switch (claimed.data.payload.operation) {
    case "addMembers":
      return dispatch(memberRequestSchema, raw, operationId, mutations.outreach.addMembers);
    case "removeMember":
      return dispatch(memberRequestSchema, raw, operationId, mutations.outreach.removeMember);
    case "returnMember":
      return dispatch(memberRequestSchema, raw, operationId, mutations.outreach.returnMember);
    default:
      // Unreachable: the three names above are the closed set the discriminant admits, so a fourth
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled working-list mutation");
  }
}
