"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactElement } from "react";
import ReviewPanel, { type CandidateView, type ReviewDecisionPayload } from "@/components/review-panel";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { isOutcome, unavailable, unknown, type MutationOutcome } from "@/modules/data-service/outcome";
const REVIEW_ENDPOINT = "/api/review";
const HANDLER_SYSTEM = "data-service";
const TRANSPORT_GUIDANCE = "The review request did not complete, so this decision is reported as neither applied nor refused. Retry it as the same attempt: a replay returns the result recorded for it instead of answering the candidate twice.";
export type UpdateReviewSurfaceProps = {
  readonly candidates: readonly CandidateView[];
  readonly activeVariantId: string;
  readonly candidateId: string;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly policyRequiresReview: boolean;
  readonly notifyRequestedByAuthor: boolean;
  readonly headingLevel: 1 | 2 | 3;
};
type ReviewAnswerPayload = { readonly operation: "approveCandidate" | "requestChanges" | "rejectCandidate"; readonly candidateId: string; readonly note?: string };
function answerOf(decision: ReviewDecisionPayload, candidateId: string): ReviewAnswerPayload {
  switch (decision.decision) {
    case "approved":
      return { operation: "approveCandidate", candidateId };
    case "changes-requested":
      return { operation: "requestChanges", candidateId, note: decision.note };
    case "rejected":
      return { operation: "rejectCandidate", candidateId, note: decision.note };
  }
}
async function postReviewAnswer(input: MutationInput<ReviewDecisionPayload>, candidateId: string): Promise<MutationOutcome> {
  let answer: Response;
  try {
    answer = await fetch(REVIEW_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: answerOf(input.payload, candidateId) }),
    });
  } catch {
    return unavailable({ operationId: input.operationId, source: { system: HANDLER_SYSTEM, reference: REVIEW_ENDPOINT }, guidance: TRANSPORT_GUIDANCE });
  }
  let body: unknown;
  try {
    body = await answer.json();
  } catch {
    body = undefined;
  }
  return isOutcome(body) ? body : answer.status === 404 || answer.status === 405 ? unavailable({ operationId: input.operationId, source: { system: HANDLER_SYSTEM, reference: REVIEW_ENDPOINT }, guidance: TRANSPORT_GUIDANCE }) : unknown({ operationId: input.operationId });
}
export function UpdateReviewSurface({ candidates, activeVariantId, candidateId, scope, expectedRevision, policyRequiresReview, notifyRequestedByAuthor, headingLevel }: UpdateReviewSurfaceProps): ReactElement {
  const [onScreenVariantId, setOnScreenVariantId] = useState(activeVariantId);
  const router = useRouter();
  const decide = useCallback(
    async (input: MutationInput<ReviewDecisionPayload>): Promise<MutationOutcome> => {
      const outcome = await postReviewAnswer(input, candidateId);
      if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") router.refresh();
      return outcome;
    },
    [candidateId, router],
  );
  return (
    <ReviewPanel family="update" candidates={candidates} activeVariantId={onScreenVariantId} onSelect={setOnScreenVariantId} policyRequiresReview={policyRequiresReview} notifyRequestedByAuthor={notifyRequestedByAuthor} scope={scope} expectedRevision={expectedRevision} onDecide={decide} headingLevel={headingLevel} />
  );
}
export default UpdateReviewSurface;
