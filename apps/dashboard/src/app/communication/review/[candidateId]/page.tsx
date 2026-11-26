import type { Metadata } from "next";
import type { ReactElement } from "react";
import { lifecycleOf } from "@/components/draft-status";
import type { CandidateView } from "@/components/review-panel";
import StateNotice from "@/components/state-notice";
import { UpdateReviewSurface } from "@/features/updates/components/review-surface";
import { reads } from "@/modules/data-service";
import { ReadNotices, type ReadNoticeCopy } from "../../../page-frame";
export const metadata: Metadata = { title: "Review" };
type CandidateEnvelope = Extract<Awaited<ReturnType<typeof reads.updates.readCandidate>>, { kind: "envelope" }>["envelope"];
type ReviewableCandidate = Extract<CandidateEnvelope["data"], { status: "reviewable" }>;
const PAGE_HEADING_LEVEL = 1;
const UNRENDERABLE_TITLE = "Submitted copy can’t be displayed";
const UNRENDERABLE_DESCRIPTION = "This submission doesn’t meet content requirements and can’t be reviewed yet. Nothing has been approved or published.";
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: PAGE_HEADING_LEVEL,
  denied: { title: "This review isn’t available in this session" },
  unavailable: { title: "Couldn’t load review submission", body: "Couldn’t reach the content service right now. Try again before making a review decision." },
  refused: { title: "Couldn’t open this review" },
};
const NO_CANDIDATES: readonly CandidateView[] = [];
/** The release mode that asks for notices, in the vocabulary the review record stores rather than the family's client spelling: this route states only what it read. */ const NOTIFY_NOW_RELEASE_MODE = "publish-and-notify" satisfies ReviewableCandidate["review"]["notifyMode"];
const candidateViewOf = (data: ReviewableCandidate): CandidateView => ({
  variantId: data.variant.variantId,
  audience: data.audience,
  locale: data.locale,
  revisionId: data.candidate.revisionId,
  contentChecksum: data.candidate.contentChecksum,
  renderedHtml: data.renderedHtml,
  mediaRenditions: data.placements.flatMap((placement) => placement.renditions.map((rendition) => ({ purpose: rendition.purpose, url: rendition.path }))),
  lifecycle: lifecycleOf(data.variant, data.headRelease ?? undefined, { reviewDecision: data.review.decision }),
  decisionRecord: data.review.recorded,
  reviewedByAuthor: data.review.reviewedByAuthor,
});
function unhandledAnswer(answer: never): never {
  throw new Error(`Unhandled read result: ${JSON.stringify(answer)}`);
}
function surfaceOf(envelope: CandidateEnvelope): ReactElement {
  const { data } = envelope;
  switch (data.status) {
    case "reviewable":
      return (
        <UpdateReviewSurface
          candidates={[candidateViewOf(data)]}
          activeVariantId={data.variant.variantId}
          candidateId={data.candidate.candidateId}
          scope={envelope.scope}
          expectedRevision={envelope.revision}
          policyRequiresReview
          notifyRequestedByAuthor={data.review.notifyMode === NOTIFY_NOW_RELEASE_MODE}
          headingLevel={PAGE_HEADING_LEVEL}
        />
      );
    case "none":
      return <UpdateReviewSurface candidates={NO_CANDIDATES} activeVariantId={data.variant.variantId} candidateId="" scope={envelope.scope} expectedRevision={envelope.revision} policyRequiresReview={false} notifyRequestedByAuthor={false} headingLevel={PAGE_HEADING_LEVEL} />;
    case "invalid":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNRENDERABLE_TITLE} description={UNRENDERABLE_DESCRIPTION} source={envelope.source} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNRENDERABLE_TITLE} description={data.reason} source={envelope.source} />;
  }
  return unhandledAnswer(data);
}
/** The review surface of one frozen Update candidate. */ export default async function CommunicationReviewPage({ params }: { readonly params: Promise<{ candidateId: string }> }): Promise<ReactElement> {
  const { candidateId } = await params;
  const result = await reads.updates.readCandidate({ variantId: candidateId });
  return result.kind === "envelope" ? surfaceOf(result.envelope) : <ReadNotices failure={result} copy={NOTICE_COPY} />;
}
