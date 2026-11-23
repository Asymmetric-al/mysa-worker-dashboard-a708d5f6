import { z } from "zod";
import { isOutcome, mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationOutcome } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, refusalIdentityGiven } from "../../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  referralRequired: "This change is missing the referral it belongs to, so reload the referral and try again.",
  referralTooLong: "A referral reference is at most 200 characters.",
  bodyUnreadable: "Send this change as a JSON object carrying operationId, scope, expectedRevision and payload, so it can be read before anything changes.",
} as const;
const MAX_REFERENCE_LENGTH = 200;
const MAX_OPERATION_ID_LENGTH = 64;
const continueReferralPayloadSchema = z.strictObject({ referralId: z.string({ error: MESSAGES.referralRequired }).trim().min(1, MESSAGES.referralRequired).max(MAX_REFERENCE_LENGTH, MESSAGES.referralTooLong) });
const continueReferralRequestSchema = mutationInputSchema(continueReferralPayloadSchema);
const refusalIdentityOf = refusalIdentityGiven(UNIDENTIFIED_ATTEMPT, MAX_OPERATION_ID_LENGTH);
const unreadableBodyRefusal = (operationId: string): MutationOutcome => outcomeFromError(operationId, new z.ZodError([{ code: "custom", path: ["body"], message: MESSAGES.bodyUnreadable }]));
/** The one answer a refusal or a settled attempt earns: the outcome it is, or the outcome its failure maps to. The diagnostic line for a referral mutation is the service runner's own, so this transport writes none. */
const answer = (operationId: string, answered: unknown): Response => toResponse(isOutcome(answered) ? answered : outcomeFromError(operationId, answered));
/** Continues one ordinarily expired referral cycle and answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
async function continueReferral(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = refusalIdentityOf(raw);
  if (raw === undefined) return toResponse(unreadableBodyRefusal(operationId));
  const parsed = continueReferralRequestSchema.safeParse(raw);
  if (!parsed.success) return toResponse(outcomeFromError(operationId, parsed.error));
  return answer(operationId, await mutations.referrals.continueReferral(parsed.data).catch((error: unknown) => outcomeFromError(operationId, error)));
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: continueReferral });
