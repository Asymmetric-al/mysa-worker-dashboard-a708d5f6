/**
 * `POST /api/coaching/grants` — the coaching relationship's own lifecycle writes.
 */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
/** The store writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** The mutation resolves the development session and evaluates the scenario clock once per request. */
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: inviteCoach, revokeGrant, endCoaching, acceptInvitation or leaveCoaching.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
// One payload type per named mutation, read from the mutation that validates it
type InviteCoachPayload = Parameters<typeof mutations.coaching.inviteCoach>[0]["payload"];

type AcceptInvitationPayload = Parameters<typeof mutations.coach.acceptInvitation>[0]["payload"];

type RevokeGrantPayload = Parameters<typeof mutations.coaching.revokeGrant>[0]["payload"];

type EndCoachingPayload = Parameters<typeof mutations.coaching.endCoaching>[0]["payload"];

type LeaveCoachingPayload = Parameters<typeof mutations.coach.leaveCoaching>[0]["payload"];

type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };
// One body schema per mutation: the four-field envelope around that mutation's own payload
const inviteCoachBodySchema = mutationInputSchema(z.custom<WirePayload<InviteCoachPayload, "inviteCoach">>());
const acceptInvitationBodySchema = mutationInputSchema(z.custom<WirePayload<AcceptInvitationPayload, "acceptInvitation">>());
const revokeGrantBodySchema = mutationInputSchema(z.custom<WirePayload<RevokeGrantPayload, "revokeGrant">>());
const endCoachingBodySchema = mutationInputSchema(z.custom<WirePayload<EndCoachingPayload, "endCoaching">>());
const leaveCoachingBodySchema = mutationInputSchema(z.custom<WirePayload<LeaveCoachingPayload, "leaveCoaching">>());

const GRANT_OPERATIONS = ["inviteCoach", "revokeGrant", "endCoaching", "acceptInvitation", "leaveCoaching"] as const;
// Reading the request
const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(GRANT_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
  },
  { error: MESSAGES.bodyNotJson },
);
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}
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
// The one verb
/** One named relationship mutation, selected by `payload.operation`. */
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
      return dispatch(acceptInvitationBodySchema, raw, operationId, mutations.coach.acceptInvitation);
    case "leaveCoaching":
      return dispatch(leaveCoachingBodySchema, raw, operationId, mutations.coach.leaveCoaching);
    default:
      // Unreachable: the five names above are the closed set the discriminant schema admits, so a sixth
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled coaching grant mutation");
  }
}
