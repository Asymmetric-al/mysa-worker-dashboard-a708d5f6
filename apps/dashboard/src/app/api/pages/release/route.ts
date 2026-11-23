import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations } from "@/modules/data-service";
import { claimedWriteRoute, dispatch, type ClaimedWrite } from "../../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
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
type ReleaseOperation = (typeof RELEASE_OPERATIONS)[number];
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(RELEASE_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
const WRITES = {
  submitForReview: (raw, { operationId, sessionId }) => dispatch(submitForReviewBodySchema, raw, operationId, "operation", (input) => mutations.pages.submitForReview(sessionId, input)),
  approveCandidate: (raw, { operationId, sessionId }) => dispatch(approveCandidateBodySchema, raw, operationId, "operation", (input) => mutations.pages.approveCandidate(sessionId, input)),
  requestChanges: (raw, { operationId, sessionId }) => dispatch(requestChangesBodySchema, raw, operationId, "operation", (input) => mutations.pages.requestChanges(sessionId, input)),
  publishVariants: (raw, { operationId, sessionId }) => dispatch(publishVariantsBodySchema, raw, operationId, "operation", (input) => mutations.pages.publishVariants(sessionId, input)),
} satisfies Readonly<Record<ReleaseOperation, ClaimedWrite>>;
/** One step of the page release ladder, selected by `payload.operation`. */
const advanceRelease = (request: NextRequest): Promise<Response> => claimedWriteRoute(request, discriminantSchema, (claim) => claim.payload.operation, WRITES);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: advanceRelease });
