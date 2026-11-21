"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactElement } from "react";
import ReviewPanel, { type CandidateView, type ReviewDecisionPayload } from "@/components/review-panel";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { isOutcome, unavailable, unknown, type MutationOutcome } from "@/modules/data-service/outcome";
const REVIEW_ENDPOINT = "/api/review";
const HANDLER_SYSTEM = "data-service";
const TRANSPORT_GUIDANCE = "The review request did not complete, so this decision is reported as neither applied nor refused. " + "Retry it as the same attempt: a replay returns the result recorded for it instead of answering the " + "candidate twice.";
export interface UpdateReviewSurfaceProps {
  readonly candidates: readonly CandidateView[];
  readonly activeVariantId: string;
  readonly candidateId: string;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly policyRequiresReview: boolean;
  readonly notifyRequestedByAuthor: boolean;
  readonly headingLevel: 1 | 2 | 3;
}
interface ReviewAnswerPayload {
  readonly operation: "approveCandidate" | "requestChanges" | "rejectCandidate";
  readonly candidateId: string;
  readonly note?: string;
}
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
      // The answer is derived from this session's cookie and the scenario clock on every request, so a
      // stored copy would report another session's decision.
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
  if (isOutcome(body)) {
    return body;
  }
  if (answer.status === 404 || answer.status === 405) {
    // No handler answered this path, so the request never reached the review mutations and nothing was
    // applied. That is an outage of the handler, not an outcome whose fate is unknown.
    return unavailable({ operationId: input.operationId, source: { system: HANDLER_SYSTEM, reference: REVIEW_ENDPOINT }, guidance: TRANSPORT_GUIDANCE });
  }
  // Any other body states nothing about what happened, so the attempt's identity is reported as
  // unconfirmed: success and failure would both be claims this surface cannot support, and only a
  // check under that identity can tell them apart.
  return unknown({ operationId: input.operationId });
}
export function UpdateReviewSurface({ candidates, activeVariantId, candidateId, scope, expectedRevision, policyRequiresReview, notifyRequestedByAuthor, headingLevel }: UpdateReviewSurfaceProps): ReactElement {
  const [onScreenVariantId, setOnScreenVariantId] = useState(activeVariantId);
  const router = useRouter();
  const decide = useCallback(
    async (input: MutationInput<ReviewDecisionPayload>): Promise<MutationOutcome> => {
      const outcome = await postReviewAnswer(input, candidateId);
      // Every answer that resolved changes what the read states about this candidate — the decision on
      // record with the principal and instant that gave it, the release actions that open, and the
      // edition's own lifecycle word — so the page re-reads it through the router rather than this
      // surface guessing the new state. The read resolves an answered candidate through that
      // candidate's own review record, so the identity this route was opened on still resolves after a
      // requested change or a rejection: the answer re-reads as the decision on record, never as a
      // refusal. A refusal or an unconfirmed attempt changed nothing to re-read.
      const resolved = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
      if (resolved) {
        router.refresh();
      }
      return outcome;
    },
    [candidateId, router],
  );
  return (
    <ReviewPanel family="update" candidates={candidates} activeVariantId={onScreenVariantId} onSelect={setOnScreenVariantId} policyRequiresReview={policyRequiresReview} notifyRequestedByAuthor={notifyRequestedByAuthor} scope={scope} expectedRevision={expectedRevision} onDecide={decide} headingLevel={headingLevel} />
  );
}
export default UpdateReviewSurface;
