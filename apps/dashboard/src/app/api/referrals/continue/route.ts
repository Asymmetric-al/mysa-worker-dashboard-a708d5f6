/** `POST /api/referrals/continue` — the one way a browser continues an ordinarily expired referral cycle, answering exactly one of the service's eight outcomes: */
import { z } from "zod";
import { logger } from "@/lib/logger";
import { isOutcome, mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationOutcome } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, operationIdentityOf } from "../../handler";
/** The store behind the service writes its documents through `node:fs`, so this handler runs on the Node runtime and never on the edge runtime. */
export const runtime = "nodejs";
/** The change resolves the development session and reads the scenario instant once per request, so no answer this route produces may be cached. */
export const dynamic = "force-dynamic";
// `POST` is the only method this module defines, and that absence is the safeguard: a link preview, a mail scanner or a plain page load cannot consume a cycle, because Next answers every other method with 405 for the route it never exported.
const MESSAGES = {
  referralRequired: "This change is missing the referral it belongs to, so reload the referral and try again.",
  referralTooLong: "A referral reference is at most 200 characters.",
  bodyUnreadable: "Send this change as a JSON object carrying operationId, scope, expectedRevision and payload, so it can be read before anything changes.",
} as const;
const MAX_REFERENCE_LENGTH = 200;
const MAX_OPERATION_ID_LENGTH = 64;
const MAX_SCOPE_ID_LENGTH = 128;
/** The authority a request that states no readable scope is logged under. */
const UNSTATED_SCOPE_ID = "unidentified-scope";
// The payload: one consumed cycle, and nothing that could change what a continuation means.  The key set is closed, not merely typed. Every other key — a deadline, a duration, a window kind, a policy, a consent, a notification, a task, a recipient — describes something a continuation never
// decides, so a strict object refuses each against the key that carried it rather than stripping it and silently agreeing to it, and the shared outcome mapping keys that refusal at the field a form must fix.
const continueReferralPayloadSchema = z.strictObject({ referralId: z.string({ error: MESSAGES.referralRequired }).trim().min(1, MESSAGES.referralRequired).max(MAX_REFERENCE_LENGTH, MESSAGES.referralTooLong) });
/** The whole body this route reads: the four-field mutation input wrapped around the continue payload. */
const continueReferralRequestSchema = mutationInputSchema(continueReferralPayloadSchema);
// The diagnostic line names the attempt and the authority the body claims. A body that states neither is still one request and one line: these markers say that nobody claimed them, rather than the line inventing an identifier or the request going unreported.
const claimedScopeIdSchema = z.string().min(1).max(MAX_SCOPE_ID_LENGTH);
const claimedScopeSchema = z.object({ scope: z.object({ organizationId: claimedScopeIdSchema, ministryId: claimedScopeIdSchema, supportSubjectId: claimedScopeIdSchema, principalId: claimedScopeIdSchema }) });
type LoggedScope = { readonly organizationId: string; readonly ministryId: string; readonly supportSubjectId: string; readonly principalId: string };
type RequestDiagnostic = { readonly operationId: string; readonly scope: LoggedScope; readonly startedAt: number };
const UNSTATED_SCOPE: LoggedScope = { organizationId: UNSTATED_SCOPE_ID, ministryId: UNSTATED_SCOPE_ID, supportSubjectId: UNSTATED_SCOPE_ID, principalId: UNSTATED_SCOPE_ID };
/** This path has always refused to echo a stated attempt id beyond the 64 characters its diagnostic line holds, answering under the placeholder instead, so that bound stays here; the rule that reads the claim is the shared one. */
function refusalIdentityOf(raw: unknown): string {
  const claimed = operationIdentityOf(raw);
  return claimed.length > MAX_OPERATION_ID_LENGTH ? UNIDENTIFIED_ATTEMPT : claimed;
}
function loggedScopeOf(body: unknown): LoggedScope {
  const claimed = claimedScopeSchema.safeParse(body);
  return claimed.success ? claimed.data.scope : UNSTATED_SCOPE;
}
/** The refusal a body that is not readable JSON earns: a schema fault against the field the caller fills. */
function unreadableBodyRefusal(operationId: string): MutationOutcome {
  return outcomeFromError(operationId, new z.ZodError([{ code: "custom", path: ["body"], message: MESSAGES.bodyUnreadable }]));
}
/** Answers whatever the work produced, after the one diagnostic line this request writes: exactly one of the eight outcomes reaches the shared ladder, and a value that is not one of them is answered … */
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
  if (raw === undefined) {
    // A parse fault would quote the text it rejected, which may carry the referral's identity, so the refusal is worded by `unreadableBodyRefusal` rather than echoing it.
    return answer(unreadableBodyRefusal(diagnostic.operationId), diagnostic);
  }
  const parsed = continueReferralRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return answer(outcomeFromError(diagnostic.operationId, parsed.error), diagnostic);
  }
  try {
    // The one named change. Nothing here asks whether the cycle is ordinarily expired, whether the caller still holds it, whether a continuation policy exists or whether worker continuation is switched on, and nothing here retries or reserves the successor: those are the service's
    // answers, and a racing second Continue has to reach it to come back `unchanged` or `conflict`.
    return answer(await mutations.referrals.continueReferral(parsed.data), diagnostic);
  } catch (error) {
    // A throw is a defect rather than a presentation: the mutation answers refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known.
    return answer(outcomeFromError(diagnostic.operationId, error), diagnostic);
  }
}
