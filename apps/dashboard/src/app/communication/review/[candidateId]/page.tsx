/** `/communication/review/[candidateId]` — the one-step review of one frozen Update candidate. **One read, one branch, one surface.** The review surface itself is `components/review-panel`, the … */
import type { ReactElement } from "react";
import { lifecycleOf } from "@/components/draft-status";
import type { CandidateView } from "@/components/review-panel";
import StateNotice from "@/components/state-notice";
import { UpdateReviewSurface } from "@/features/updates/components/review-surface";
import { reads } from "@/modules/data-service";
// The read's own shape, taken from the read rather than restated
type CandidateResult = Awaited<ReturnType<typeof reads.updates.readCandidate>>;
type CandidateEnvelope = Extract<CandidateResult, { kind: "envelope" }>["envelope"];
type CandidateData = CandidateEnvelope["data"];
type ReviewableCandidate = Extract<CandidateData, { status: "reviewable" }>;
// Fixed values
/** The level this route's one heading occupies. */
const PAGE_HEADING_LEVEL = 1;
/** The title of the refusal, which states the condition and nothing about what may exist here. */
const DENIED_TITLE = "This review is not available in this session";
/** The title of a refused request: the address named something the read does not admit, and nothing was read. */
const REFUSED_TITLE = "This review's request was refused";
/** The title of an outage: the candidate could not be read, which is not the same as there being none. */
const UNAVAILABLE_TITLE = "The frozen revision could not be read";
const UNAVAILABLE_DESCRIPTION = "The records behind this candidate could not be read, so nothing is shown here in place of them. " + "No decision is offered until the read succeeds: an empty review would state that nothing is " + "frozen, which this read does not say.";
/** The title of a frozen revision whose body cannot be shown as the content profile requires. */
const UNRENDERABLE_TITLE = "The frozen revision cannot be shown";
const UNRENDERABLE_DESCRIPTION = "This edition's frozen revision cannot be read as the content profile requires, so no reviewer can " + "be asked to approve it. Nothing has been approved, nothing has been released, and the revision " + "keeps its identity until the author submits one that can be shown.";
const NO_CANDIDATES: readonly CandidateView[] = [];
/** The release mode that asks for notices, in the vocabulary the review record stores rather than the family's client spelling: this route states only what it read. */
const NOTIFY_NOW_RELEASE_MODE = "publish-and-notify" satisfies ReviewableCandidate["review"]["notifyMode"];
/** The empty identity a surface with no frozen candidate carries: no decision is offered, so none is named. */
const NO_CANDIDATE_ID = "";
// The envelope, mapped onto the panel's view of one candidate
/** The frozen candidate as the panel shows it: the exact revision and checksum the reviewer answers, the body rendered by the read, the renditions this read was admitted to serve, and the decision on … */
function candidateViewOf(data: ReviewableCandidate): CandidateView {
  return {
    variantId: data.variant.variantId,
    audience: data.audience,
    locale: data.locale,
    revisionId: data.candidate.revisionId,
    contentChecksum: data.candidate.contentChecksum,
    renderedHtml: data.renderedHtml,
    mediaRenditions: data.placements.flatMap((placement) => placement.renditions.map((rendition) => ({ purpose: rendition.purpose, url: rendition.path }))),
    lifecycle: lifecycleOf(data.variant, data.headRelease ?? undefined),
    decisionRecord: data.review.recorded,
    reviewedByAuthor: data.review.reviewedByAuthor,
  };
}
/** Answers for a read member this file does not handle. */
function unhandledAnswer(answer: never): never {
  throw new Error(`Unhandled read result: ${JSON.stringify(answer)}`);
}
/** What one envelope's candidate data composes: the panel, or the honest state that replaces it. */
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
          // A frozen candidate exists because the author submitted it for review, so review is the path this edition is on: the panel offers its one decision rather than claiming none is required.
          policyRequiresReview
          // The mode that submission recorded, read from the candidate's own review record: the panel states the notice it asked for, and never a choice this route made up.
          notifyRequestedByAuthor={data.review.notifyMode === NOTIFY_NOW_RELEASE_MODE}
          headingLevel={PAGE_HEADING_LEVEL}
        />
      );
    case "none":
      // The edition is readable and holds no frozen candidate. The panel states exactly that, offers no decision, and no identity is named for one. No submission exists, so no notice was asked for: the publish-only default is the whole of what this arm can truthfully state.
      return <UpdateReviewSurface candidates={NO_CANDIDATES} activeVariantId={data.variant.variantId} candidateId={NO_CANDIDATE_ID} scope={envelope.scope} expectedRevision={envelope.revision} policyRequiresReview={false} notifyRequestedByAuthor={false} headingLevel={PAGE_HEADING_LEVEL} />;
    case "invalid":
      // The revision exists and its body cannot be shown. Offering a decision on a body no reviewer can read would be an approval of something unseen, so the surface reports the condition instead.
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNRENDERABLE_TITLE} description={UNRENDERABLE_DESCRIPTION} source={envelope.source} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNRENDERABLE_TITLE} description={data.reason} source={envelope.source} />;
  }
  return unhandledAnswer(data);
}
/** What this route receives: the segment naming the candidate to review, unresolved. */
export interface CommunicationReviewPageProps {
  readonly params: Promise<{ candidateId: string }>;
}
/** The review surface of one frozen Update candidate. */
export default async function CommunicationReviewPage({ params }: CommunicationReviewPageProps): Promise<ReactElement> {
  const { candidateId } = await params;
  // The segment is passed through as the opaque identity the read resolves: it is never parsed, case-folded, trimmed to parts or compared with anything this file can see.
  const result = await reads.updates.readCandidate({ variantId: candidateId });
  switch (result.kind) {
    case "envelope":
      return surfaceOf(result.envelope);
    case "denied":
      return <StateNotice kind="denied" headingLevel={PAGE_HEADING_LEVEL} title={DENIED_TITLE} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNAVAILABLE_TITLE} description={UNAVAILABLE_DESCRIPTION} source={result.unavailable.source} />;
    case "refused":
      // This route calls the read directly, so the request is its own and never one a handler refuses: the arm is stated here rather than thrown, and the notice's own sentence says the request was refused rather than the source failing.
      return <StateNotice kind="refused" headingLevel={PAGE_HEADING_LEVEL} title={REFUSED_TITLE} />;
  }
  return unhandledAnswer(result);
}
