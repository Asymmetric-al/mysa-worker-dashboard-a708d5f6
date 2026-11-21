/**
 * `POST /api/coaching/grants` — the coaching relationship's own lifecycle writes.
 *
 * **What it serves.** One named mutation per request, selected by `payload.operation`, whose closed set
 * is `inviteCoach`, `revokeGrant`, `endCoaching`, `acceptInvitation` and `leaveCoaching`. The first
 * three are the worker's acts on a relationship they own; the last two are the coach's, and the coach
 * identity holds exactly those two writes in the whole application. Every other coaching mutation has a
 * more specific home — the module toggles on `/modules`, the target lifecycle on `/targets`, the
 * check-in and its sharing on `/checkins`, the task summary on `/taskshare` — so no verb on this path
 * can mean a second thing, and the other paths' verbs are `invalid` here rather than quietly accepted.
 *
 * **The wire contract clients share.** The body is the four-field mutation input of AAP 0.7.1 plus one
 * discriminant:
 *
 *     { operationId, scope, expectedRevision, payload: { operation, ...this mutation's fields } }
 *
 * `operation` is routing metadata for one record family, not a field of any record: it selects one
 * schema here and is removed before the mutation reads the payload. Each payload field is declared by
 * the mutation's own strict schema and nowhere else, so the field names, their bounds and the per-field
 * messages an `invalid` answer carries all come from the one owner — this file holds no copy of them.
 * `operationId`, `scope` and `expectedRevision` are forwarded untouched, so a replay is recognised by
 * identity, a stale revision still reaches the service as a `conflict`, and nothing is minted, bumped or
 * stripped on the way through.
 *
 * **Who authorises, and what a write here never does.** The service does, inside each mutation: it
 * re-derives the caller from the development session, checks the ministry the relationship names or the
 * coach's own grant, and refuses a superseded invitation, a revoked or ended episode and a stale action.
 * No payload field can delete the work behind a module, claim back what a coach already read, or revive
 * an ended episode; the service's own schemas refuse such a field and this path adds none.
 *
 * **One status ladder.** Every answer goes through `toResponse`: `accepted`, `alreadyAccepted` and
 * `unchanged` 200, `unknown` 202 with the `operationId`, `denied` 403, `conflict` 409, `invalid` 422
 * and `unavailable` 503 naming the source. A throw is mapped by `outcomeFromError` rather than
 * escaping, so a store fault becomes `unavailable` and an unrecognised failure becomes `unknown`
 * carrying the caller's identity. No status, outcome or body shape is written by hand here.
 *
 * **Layering.** `app/api → modules/data-service`, the package root only: never the synthetic store,
 * never a mutation module's deep path, never a feature module for a value or a type.
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

/** The store writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";

/** The mutation resolves the development session and evaluates the scenario clock once per request. */
export const dynamic = "force-dynamic";

/**
 * The marker the service puts on an attempt that carries no identity of its own.
 *
 * An invalid answer still names an attempt, and a body so malformed that it states no `operationId` has
 * no other identity to report. Matching the service's own marker keeps the two answers alike.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/**
 * The wording this file owns: the two refusals it makes before any mutation sees the request.
 *
 * Everything else a caller can be told about a field comes from the mutation's own schema, which is the
 * only declaration of those fields — so there is no second wording for a grant reference, a duration or
 * a reviewed range here.
 */
const MESSAGES = {
  operationRequired:
    "State which change this request makes as payload.operation: inviteCoach, revokeGrant, endCoaching, acceptInvitation or leaveCoaching.",
  bodyNotJson:
    "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

// ---------------------------------------------------------------------------------------------
// One payload type per named mutation, read from the mutation that validates it
// ---------------------------------------------------------------------------------------------

/** What `inviteCoach` accepts: a named coach, the ministries, the duration and any reviewed range. */
type InviteCoachPayload = Parameters<typeof mutations.coaching.inviteCoach>[0]["payload"];

/** What `acceptInvitation` accepts: the invitation, and the revision of it the coach saw. */
type AcceptInvitationPayload = Parameters<typeof mutations.coach.acceptInvitation>[0]["payload"];

/** What `revokeGrant` accepts: the relationship whose coach access is being revoked. */
type RevokeGrantPayload = Parameters<typeof mutations.coaching.revokeGrant>[0]["payload"];

/** What `endCoaching` accepts: the relationship the worker is ending. */
type EndCoachingPayload = Parameters<typeof mutations.coaching.endCoaching>[0]["payload"];

/** What `leaveCoaching` accepts: the relationship the coach is leaving. */
type LeaveCoachingPayload = Parameters<typeof mutations.coach.leaveCoaching>[0]["payload"];

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

const inviteCoachBodySchema = mutationInputSchema(
  z.custom<WirePayload<InviteCoachPayload, "inviteCoach">>(),
);
const acceptInvitationBodySchema = mutationInputSchema(
  z.custom<WirePayload<AcceptInvitationPayload, "acceptInvitation">>(),
);
const revokeGrantBodySchema = mutationInputSchema(
  z.custom<WirePayload<RevokeGrantPayload, "revokeGrant">>(),
);
const endCoachingBodySchema = mutationInputSchema(
  z.custom<WirePayload<EndCoachingPayload, "endCoaching">>(),
);
const leaveCoachingBodySchema = mutationInputSchema(
  z.custom<WirePayload<LeaveCoachingPayload, "leaveCoaching">>(),
);

/** The closed set of mutations this path dispatches, in the order the plan states them. */
const GRANT_OPERATIONS = [
  "inviteCoach",
  "revokeGrant",
  "endCoaching",
  "acceptInvitation",
  "leaveCoaching",
] as const;

// ---------------------------------------------------------------------------------------------
// Reading the request
// ---------------------------------------------------------------------------------------------

/** The attempt identity a body states, so a refusal can name the attempt the caller can replay. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of this path's five names.
 *
 * Only the discriminant is read here, so a body carrying extra keys is not refused at this point: the
 * chosen mutation's own closed schema reports those against their own field paths.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(GRANT_OPERATIONS, { error: MESSAGES.operationRequired }) },
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
 * Every coaching payload schema is closed and declares no `operation` field, so leaving the
 * discriminant in place would turn every request into an unrecognised-key refusal. Removing it here is
 * what keeps the field a routing fact rather than a second description of a relationship.
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
 * fate is not known — `unavailable` and `unknown` are the only two honest answers to either.
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
// The one verb
// ---------------------------------------------------------------------------------------------

/**
 * One named relationship mutation, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with its own status, so a client never infers success from
 * an absent error: a stale revision is a `conflict` that preserves the submitted input, a replay is
 * `alreadyAccepted` with the stored result, and a discriminant naming no mutation of this path — a
 * module toggle, a target or a check-in, which belong to their own paths — is `invalid` naming
 * `payload.operation`. Only `POST` is exported: nothing on this path is readable, so every other method
 * answers 405 from the framework.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);

  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }

  switch (claimed.data.payload.operation) {
    case "inviteCoach":
      return dispatch(inviteCoachBodySchema, raw, operationId, mutations.coaching.inviteCoach);
    case "revokeGrant":
      return dispatch(revokeGrantBodySchema, raw, operationId, mutations.coaching.revokeGrant);
    case "endCoaching":
      return dispatch(endCoachingBodySchema, raw, operationId, mutations.coaching.endCoaching);
    case "acceptInvitation":
      return dispatch(
        acceptInvitationBodySchema,
        raw,
        operationId,
        mutations.coach.acceptInvitation,
      );
    case "leaveCoaching":
      return dispatch(leaveCoachingBodySchema, raw, operationId, mutations.coach.leaveCoaching);
    default:
      // Unreachable: the five names above are the closed set the discriminant schema admits, so a sixth
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled coaching grant mutation");
  }
}
