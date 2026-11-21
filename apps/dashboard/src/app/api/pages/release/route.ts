/** `POST /api/pages/release` — the four writes that carry one page edition from a frozen candidate to a released edition: */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { sessionIdOf } from "../../session-cookie";
import { dispatch, jsonBodyOf, operationIdentityOf } from "../../handler";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every mutation resolves the development session and the scenario clock per request.
export const dynamic = "force-dynamic";
const MESSAGES = { operationRequired: "State which step this request takes as payload.operation: submitForReview, approveCandidate, requestChanges or publishVariants.", bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload." } as const;
type SubmitForReviewPayload = Parameters<typeof mutations.pages.submitForReview>[1]["payload"];
type ApproveCandidatePayload = Parameters<typeof mutations.pages.approveCandidate>[1]["payload"];
type RequestChangesPayload = Parameters<typeof mutations.pages.requestChanges>[1]["payload"];
type PublishVariantsPayload = Parameters<typeof mutations.pages.publishVariants>[1]["payload"];
type Routed<P> = P & { readonly operation: string };
const submitForReviewBodySchema = mutationInputSchema(z.custom<Routed<SubmitForReviewPayload>>());
const approveCandidateBodySchema = mutationInputSchema(z.custom<Routed<ApproveCandidatePayload>>());
const requestChangesBodySchema = mutationInputSchema(z.custom<Routed<RequestChangesPayload>>());
const publishVariantsBodySchema = mutationInputSchema(z.custom<Routed<PublishVariantsPayload>>());
const RELEASE_OPERATIONS = ["submitForReview", "approveCandidate", "requestChanges", "publishVariants"] as const;
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(RELEASE_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
/** One step of the page release ladder, selected by `payload.operation`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const sessionId = sessionIdOf(request);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) return toResponse(outcomeFromError(operationId, claimed.error));
  switch (claimed.data.payload.operation) {
    case "submitForReview":
      return dispatch(submitForReviewBodySchema, raw, operationId, "operation", (input) => mutations.pages.submitForReview(sessionId, input));
    case "approveCandidate":
      return dispatch(approveCandidateBodySchema, raw, operationId, "operation", (input) => mutations.pages.approveCandidate(sessionId, input));
    case "requestChanges":
      return dispatch(requestChangesBodySchema, raw, operationId, "operation", (input) => mutations.pages.requestChanges(sessionId, input));
    case "publishVariants":
      return dispatch(publishVariantsBodySchema, raw, operationId, "operation", (input) => mutations.pages.publishVariants(sessionId, input));
    default:
      // Unreachable: the four steps above are the closed set the discriminant schema admits, so a fifth mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page release mutation");
  }
}
