import { z } from "zod";
import { logger } from "@/lib/logger";
import { isOutcome, mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationOutcome } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, refusalIdentityGiven } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  referralRequired: "This change is missing the referral it belongs to, so reload the referral and try again.",
  referralTooLong: "A referral reference is at most 200 characters.",
  bodyUnreadable: "Send this change as a JSON object carrying operationId, scope, expectedRevision and payload, so it can be read before anything changes.",
} as const;
const MAX_REFERENCE_LENGTH = 200;
const MAX_OPERATION_ID_LENGTH = 64;
const MAX_SCOPE_ID_LENGTH = 128;
const UNSTATED_SCOPE_ID = "unidentified-scope";
const continueReferralPayloadSchema = z.strictObject({ referralId: z.string({ error: MESSAGES.referralRequired }).trim().min(1, MESSAGES.referralRequired).max(MAX_REFERENCE_LENGTH, MESSAGES.referralTooLong) });
const continueReferralRequestSchema = mutationInputSchema(continueReferralPayloadSchema);
const claimedScopeIdSchema = z.string().min(1).max(MAX_SCOPE_ID_LENGTH);
const claimedScopeSchema = z.object({ scope: z.object({ organizationId: claimedScopeIdSchema, ministryId: claimedScopeIdSchema, supportSubjectId: claimedScopeIdSchema, principalId: claimedScopeIdSchema }) });
type LoggedScope = { readonly organizationId: string; readonly ministryId: string; readonly supportSubjectId: string; readonly principalId: string };
type RequestDiagnostic = { readonly operationId: string; readonly scope: LoggedScope; readonly startedAt: number };
const UNSTATED_SCOPE: LoggedScope = { organizationId: UNSTATED_SCOPE_ID, ministryId: UNSTATED_SCOPE_ID, supportSubjectId: UNSTATED_SCOPE_ID, principalId: UNSTATED_SCOPE_ID };
const refusalIdentityOf = refusalIdentityGiven(UNIDENTIFIED_ATTEMPT, MAX_OPERATION_ID_LENGTH);
function loggedScopeOf(body: unknown): LoggedScope {
  const claimed = claimedScopeSchema.safeParse(body);
  return claimed.success ? claimed.data.scope : UNSTATED_SCOPE;
}
const unreadableBodyRefusal = (operationId: string): MutationOutcome => outcomeFromError(operationId, new z.ZodError([{ code: "custom", path: ["body"], message: MESSAGES.bodyUnreadable }]));
function answer(answered: unknown, diagnostic: RequestDiagnostic): Response {
  const outcome: MutationOutcome = isOutcome(answered) ? answered : outcomeFromError(diagnostic.operationId, answered);
  logger.mutation({ operationId: diagnostic.operationId, scope: diagnostic.scope, outcome: outcome.outcome, elapsedMs: Math.round(performance.now() - diagnostic.startedAt) });
  return toResponse(outcome);
}
/** Continues one ordinarily expired referral cycle and answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const raw = await jsonBodyOf(request);
  const diagnostic: RequestDiagnostic = { operationId: refusalIdentityOf(raw), scope: loggedScopeOf(raw), startedAt };
  if (raw === undefined) return answer(unreadableBodyRefusal(diagnostic.operationId), diagnostic);
  const parsed = continueReferralRequestSchema.safeParse(raw);
  if (!parsed.success) return answer(outcomeFromError(diagnostic.operationId, parsed.error), diagnostic);
  return answer(await mutations.referrals.continueReferral(parsed.data).catch((error: unknown) => outcomeFromError(diagnostic.operationId, error)), diagnostic);
}
