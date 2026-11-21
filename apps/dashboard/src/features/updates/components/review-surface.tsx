"use client";
/**
 * The Ministry Updates family's composition of the one review panel.
 *
 * `ReviewPanel` renders the frozen revision and the single decision, and it takes that decision's
 * transport as a prop. A function cannot cross from a Server Component to a client component, so the
 * route cannot supply it: this module is where the family does. It holds which edition is on screen
 * and carries the reviewer's answer to `POST /api/review`, the handler `features/updates/schemas/
 * review.ts` documents for the review mutations.
 *
 * The answer is built from the service's own contract rather than the panel's, because the two answer
 * different questions: the panel states the frozen identity a decision names (edition, revision and
 * checksum) so the reviewer can see what they are answering, while `approveCandidate`,
 * `requestChanges` and `rejectCandidate` take the candidate identity and nothing else. The extra
 * identity is not forwarded: the service validates a strict payload, and the edition and revision it
 * derives itself are the ones that decide whether the answer applies.
 */
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactElement } from "react";
import ReviewPanel, { type CandidateView, type ReviewDecisionPayload } from "@/components/review-panel";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { isOutcome, unavailable, unknown, type MutationOutcome } from "@/modules/data-service/outcome";
/** The handler the family's review mutations are reached through. */
const REVIEW_ENDPOINT = "/api/review";

/** The source named when the request never reached that handler. */
const HANDLER_SYSTEM = "data-service";

const TRANSPORT_GUIDANCE =
  "The review request did not complete, so this decision is reported as neither applied nor refused. " +
  "Retry it as the same attempt: a replay returns the result recorded for it instead of answering the " +
  "candidate twice.";
/** Props of {@link UpdateReviewSurface}: the read's own facts, and none of them inferred here. */
export interface UpdateReviewSurfaceProps {
  /** The frozen candidates this route read, mapped to what the panel shows. Empty when none is frozen. */
  readonly candidates: readonly CandidateView[];
  /** The edition to open on, as the read named it. */
  readonly activeVariantId: string;
  /**
   * The frozen candidate a decision answers.
   *
   * Empty when no revision is frozen: the panel then offers no decision at all, so no identity is
   * named rather than one being guessed.
   */
  readonly candidateId: string;
  /** The authority this read ran under, which every decision presents unchanged. */
  readonly scope: Scope;
  /** The revision the read reported, which a decision presents as the revision it expected. */
  readonly expectedRevision: string;
  /** Whether contributor policy puts this edition through review, as the submission itself records. */
  readonly policyRequiresReview: boolean;
  /** Whether the author's submission asked for notices as well as a release. */
  readonly notifyRequestedByAuthor: boolean;
}
/**
 * One named review mutation, as `POST /api/review` dispatches it on `payload.operation`.
 *
 * Only members the review payload schema declares appear here: the note is the reviewer's own words
 * for the two decisions that ask the author to act, and an approval carries none.
 */
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
      body: JSON.stringify({
        operationId: input.operationId,
        scope: input.scope,
        expectedRevision: input.expectedRevision,
        payload: answerOf(input.payload, candidateId),
      }),
    });
  } catch {
    return unavailable({
      operationId: input.operationId,
      source: { system: HANDLER_SYSTEM, reference: REVIEW_ENDPOINT },
      guidance: TRANSPORT_GUIDANCE,
    });
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
    return unavailable({
      operationId: input.operationId,
      source: { system: HANDLER_SYSTEM, reference: REVIEW_ENDPOINT },
      guidance: TRANSPORT_GUIDANCE,
    });
  }
  // Any other body states nothing about what happened, so the attempt's identity is reported as
  // unconfirmed: success and failure would both be claims this surface cannot support, and only a
  // check under that identity can tell them apart.
  return unknown({ operationId: input.operationId });
}
/** The Update review surface: the shared panel, wired to this family's one review transport. */
export function UpdateReviewSurface({
  candidates,
  activeVariantId,
  candidateId,
  scope,
  expectedRevision,
  policyRequiresReview,
  notifyRequestedByAuthor,
}: UpdateReviewSurfaceProps): ReactElement {
  const [onScreenVariantId, setOnScreenVariantId] = useState(activeVariantId);
  const router = useRouter();
  const decide = useCallback(
    async (input: MutationInput<ReviewDecisionPayload>): Promise<MutationOutcome> => {
      const outcome = await postReviewAnswer(input, candidateId);
      // An approval that resolved changes what the read states about this candidate — the decision on
      // record, the release actions that open and the edition's own lifecycle word — so the page re-reads
      // it through the router rather than this surface guessing the new state. Approval is the one answer
      // that leaves the frozen candidate in place, which is why the route can resolve it again.
      //
      // A request for changes and a rejection clear the edition's candidate, so the identity this route
      // was opened on no longer resolves: re-reading would replace the accepted outcome and its recovery
      // with the read's own refusal. Those two therefore leave the result in place, on the receipt this
      // step holds. A refusal or an unconfirmed attempt changed nothing to re-read either.
      const resolved = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
      if (resolved && input.payload.decision === "approved") {
        router.refresh();
      }
      return outcome;
    },
    [candidateId, router],
  );
  return (
    <ReviewPanel
      family="update"
      candidates={candidates}
      activeVariantId={onScreenVariantId}
      onSelect={setOnScreenVariantId}
      policyRequiresReview={policyRequiresReview}
      notifyRequestedByAuthor={notifyRequestedByAuthor}
      scope={scope}
      expectedRevision={expectedRevision}
      onDecide={decide}
    />
  );
}
export default UpdateReviewSurface;
