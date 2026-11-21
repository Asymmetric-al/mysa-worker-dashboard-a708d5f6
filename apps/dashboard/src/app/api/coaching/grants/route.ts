/** `POST /api/coaching/grants` — the four coaching-grant lifecycle writes, selected by `payload.operation`. */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationOutcome } from "@/modules/data-service";
import { invalid } from "@/modules/data-service/outcome";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, operationIdentityOf } from "../../handler";
/** The store writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Each write resolves the development session and evaluates the scenario clock once per request, so no answer is cached. */
export const dynamic = "force-dynamic";
const MESSAGES = {
  verb: "Name the change this request makes as payload.operation: acceptInvitation, revokeGrant, endCoaching or leaveCoaching.",
  body: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  reference: "A grant reference is the opaque identifier a coaching read handed out. A name, an email address, a job title, a household or a project is not that reference and grants nothing.",
} as const;
const GRANT_VERBS = ["acceptInvitation", "revokeGrant", "endCoaching", "leaveCoaching"] as const;
const grantReference = z.string().trim().min(1, MESSAGES.reference);
// The payload each mutation accepts, taken from the mutation itself: a change to one of them fails to compile here, so this transport cannot fall out of step with the service it forwards to.
type AcceptInvitationPayload = Parameters<typeof mutations.coach.acceptInvitation>[0]["payload"];
type RevokeGrantPayload = Parameters<typeof mutations.coaching.revokeGrant>[0]["payload"];
type EndCoachingPayload = Parameters<typeof mutations.coaching.endCoaching>[0]["payload"];
type LeaveCoachingPayload = Parameters<typeof mutations.coach.leaveCoaching>[0]["payload"];
// One payload schema per mutation, strict at its own level: a field the mutation does not accept — an address-derived identity, a status or state the service must derive, a module map, a cutoff or a duration — is named in an `invalid` answer rather than stripped and ignored.
const acceptInvitationPayload = z.strictObject({ operation: z.literal("acceptInvitation"), grantId: grantReference, invitationRevision: z.union([z.number().int().min(0), grantReference]).optional() }) satisfies z.ZodType<AcceptInvitationPayload & { readonly operation: "acceptInvitation" }>;
const revokeGrantPayload = z.strictObject({ operation: z.literal("revokeGrant"), grantId: grantReference }) satisfies z.ZodType<RevokeGrantPayload & { readonly operation: "revokeGrant" }>;
const endCoachingPayload = z.strictObject({ operation: z.literal("endCoaching"), grantId: grantReference }) satisfies z.ZodType<EndCoachingPayload & { readonly operation: "endCoaching" }>;
const leaveCoachingPayload = z.strictObject({ operation: z.literal("leaveCoaching"), grantId: grantReference }) satisfies z.ZodType<LeaveCoachingPayload & { readonly operation: "leaveCoaching" }>;
const acceptInvitationRequest = mutationInputSchema(acceptInvitationPayload);
const revokeGrantRequest = mutationInputSchema(revokeGrantPayload);
const endCoachingRequest = mutationInputSchema(endCoachingPayload);
const leaveCoachingRequest = mutationInputSchema(leaveCoachingPayload);
// Which change this request makes is read from `payload.operation` alone first, so a body whose payload no mutation accepts is still told which change it failed to name.
const verbRead = z.object({ payload: z.object({ operation: z.enum(GRANT_VERBS, { error: MESSAGES.verb }) }, { error: MESSAGES.verb }) }, { error: MESSAGES.body });
/** The length beyond which this path has always refused to echo a stated attempt id, answering under the placeholder rather than a truncated one, so that bound stays here while the claim itself is read by the shared reader. */
const MAX_ECHOED_OPERATION_ID_LENGTH = 64;
/** The attempt a refusal answers for: the shared reader states which attempt the body claimed, and this path states the bound it echoes one within. */
function refusalIdentityOf(raw: unknown): string {
  const stated = operationIdentityOf(raw);
  return stated.length > MAX_ECHOED_OPERATION_ID_LENGTH ? UNIDENTIFIED_ATTEMPT : stated;
}
function refusal(operationId: string, error: z.ZodError): Response {
  return toResponse(invalid({ operationId, fields: error }));
}
async function answer(operationId: string, write: () => Promise<MutationOutcome>): Promise<Response> {
  try {
    return toResponse(await write());
  } catch (error) {
    // One mapper tells a store outage from a lost acknowledgement; this boundary never guesses between them.
    return toResponse(outcomeFromError(operationId, error));
  }
}
/** Applies exactly one named coaching-grant change and answers with one of the eight outcomes: `accepted`, `alreadyAccepted` for a replay of the same operationId, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = refusalIdentityOf(raw);
  const verb = verbRead.safeParse(raw);
  if (!verb.success) return refusal(operationId, verb.error);
  // The four verbs share one payload shape and the ledger hashes only the scope, the expected revision and the payload, so one operationId must never be reused across verbs: that reuse would read as a replay of the first verb instead of as changed intent.
  switch (verb.data.payload.operation) {
    case "acceptInvitation": {
      const parsed = acceptInvitationRequest.safeParse(raw);
      if (!parsed.success) return refusal(operationId, parsed.error);
      const { grantId, invitationRevision } = parsed.data.payload;
      return answer(operationId, () => mutations.coach.acceptInvitation({ operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: invitationRevision === undefined ? { grantId } : { grantId, invitationRevision } }));
    }
    case "revokeGrant": {
      const parsed = revokeGrantRequest.safeParse(raw);
      if (!parsed.success) return refusal(operationId, parsed.error);
      return answer(operationId, () => mutations.coaching.revokeGrant({ operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: { grantId: parsed.data.payload.grantId } }));
    }
    case "endCoaching": {
      const parsed = endCoachingRequest.safeParse(raw);
      if (!parsed.success) return refusal(operationId, parsed.error);
      return answer(operationId, () => mutations.coaching.endCoaching({ operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: { grantId: parsed.data.payload.grantId } }));
    }
    case "leaveCoaching": {
      const parsed = leaveCoachingRequest.safeParse(raw);
      if (!parsed.success) return refusal(operationId, parsed.error);
      return answer(operationId, () => mutations.coach.leaveCoaching({ operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: { grantId: parsed.data.payload.grantId } }));
    }
    default:
      // Unreachable: the enum above is the closed set of four verbs, so a fifth fails to compile at this call.
      return assertNever(verb.data.payload.operation, "Unhandled coaching grant mutation");
  }
}
