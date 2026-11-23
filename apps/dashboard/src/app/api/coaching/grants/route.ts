import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, toResponse } from "@/modules/data-service";
import { invalid } from "@/modules/data-service/outcome";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, mutate, operationIdentityOf } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  verb: "Name the change this request makes as payload.operation: acceptInvitation, revokeGrant, endCoaching or leaveCoaching.",
  body: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  reference: "A grant reference is the opaque identifier a coaching read handed out. A name, an email address, a job title, a household or a project is not that reference and grants nothing.",
} as const;
const GRANT_VERBS = ["acceptInvitation", "revokeGrant", "endCoaching", "leaveCoaching"] as const;
const grantReference = z.string().trim().min(1, MESSAGES.reference);
type AcceptInvitationPayload = Parameters<typeof mutations.coach.acceptInvitation>[0]["payload"];
type RevokeGrantPayload = Parameters<typeof mutations.coaching.revokeGrant>[0]["payload"];
type EndCoachingPayload = Parameters<typeof mutations.coaching.endCoaching>[0]["payload"];
type LeaveCoachingPayload = Parameters<typeof mutations.coach.leaveCoaching>[0]["payload"];
const acceptInvitationPayload = z.strictObject({ operation: z.literal("acceptInvitation"), grantId: grantReference, invitationRevision: z.union([z.number().int().min(0), grantReference]).optional() }) satisfies z.ZodType<AcceptInvitationPayload & { readonly operation: "acceptInvitation" }>;
const revokeGrantPayload = z.strictObject({ operation: z.literal("revokeGrant"), grantId: grantReference }) satisfies z.ZodType<RevokeGrantPayload & { readonly operation: "revokeGrant" }>;
const endCoachingPayload = z.strictObject({ operation: z.literal("endCoaching"), grantId: grantReference }) satisfies z.ZodType<EndCoachingPayload & { readonly operation: "endCoaching" }>;
const leaveCoachingPayload = z.strictObject({ operation: z.literal("leaveCoaching"), grantId: grantReference }) satisfies z.ZodType<LeaveCoachingPayload & { readonly operation: "leaveCoaching" }>;
const acceptInvitationRequest = mutationInputSchema(acceptInvitationPayload);
const revokeGrantRequest = mutationInputSchema(revokeGrantPayload);
const endCoachingRequest = mutationInputSchema(endCoachingPayload);
const leaveCoachingRequest = mutationInputSchema(leaveCoachingPayload);
const verbRead = z.object({ payload: z.object({ operation: z.enum(GRANT_VERBS, { error: MESSAGES.verb }) }, { error: MESSAGES.verb }) }, { error: MESSAGES.body });
const MAX_ECHOED_OPERATION_ID_LENGTH = 64;
function refusalIdentityOf(raw: unknown): string {
  const stated = operationIdentityOf(raw);
  return stated.length > MAX_ECHOED_OPERATION_ID_LENGTH ? UNIDENTIFIED_ATTEMPT : stated;
}
const refusal = (operationId: string, error: z.ZodError): Response => toResponse(invalid({ operationId, fields: error }));
/** Applies exactly one named coaching-grant change and answers with one of the eight outcomes: `accepted`, `alreadyAccepted` for a replay of the same operationId, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
async function changeGrant(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = refusalIdentityOf(raw);
  const verb = verbRead.safeParse(raw);
  if (!verb.success) return refusal(operationId, verb.error);
  switch (verb.data.payload.operation) {
    case "acceptInvitation": {
      const parsed = acceptInvitationRequest.safeParse(raw);
      if (!parsed.success) return refusal(operationId, parsed.error);
      const { grantId, invitationRevision } = parsed.data.payload;
      return mutate(operationId, () => mutations.coach.acceptInvitation({ operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: invitationRevision === undefined ? { grantId } : { grantId, invitationRevision } }));
    }
    case "revokeGrant": {
      const parsed = revokeGrantRequest.safeParse(raw);
      if (!parsed.success) return refusal(operationId, parsed.error);
      return mutate(operationId, () => mutations.coaching.revokeGrant({ operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: { grantId: parsed.data.payload.grantId } }));
    }
    case "endCoaching": {
      const parsed = endCoachingRequest.safeParse(raw);
      if (!parsed.success) return refusal(operationId, parsed.error);
      return mutate(operationId, () => mutations.coaching.endCoaching({ operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: { grantId: parsed.data.payload.grantId } }));
    }
    case "leaveCoaching": {
      const parsed = leaveCoachingRequest.safeParse(raw);
      if (!parsed.success) return refusal(operationId, parsed.error);
      return mutate(operationId, () => mutations.coach.leaveCoaching({ operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: { grantId: parsed.data.payload.grantId } }));
    }
    default:
      return assertNever(verb.data.payload.operation, "Unhandled coaching grant mutation");
  }
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: changeGrant });
