/**
 * `/communication/review/[candidateId]` — the one-step review of one frozen Update candidate.
 *
 * **One read, one branch, one surface.** The review surface itself is `components/review-panel`, the
 * single implementation both content families use. This route composes it: it resolves the session's
 * scope and the frozen revision through `reads.updates.readCandidate` and renders what the read
 * answered. It computes no count, no revision, no checksum, no eligibility and no permission, and it
 * holds no state — every value the panel shows comes from the envelope, including the edition's
 * lifecycle word, which is derived from the records the same envelope carried by the one implementation
 * of that derivation rather than stated here.
 *
 * **Why the panel is reached through the family module.** The panel takes the reviewer's decision as
 * a function, and a function cannot cross from a Server Component to a client component. Server
 * Actions are not this application's second mutation transport, so the family supplies the one
 * transport instead, in `features/updates/components/review-surface.tsx`. This file therefore stays a
 * Server Component that passes plain, serialisable facts down.
 *
 * **What this route does not do.** Review is not release and approval is not notification: publishing
 * and notice submission stay on the Update's own surface, and neither appears here. Nothing on this
 * route is an editor: the panel shows the revision the reviewer is answering exactly as the read
 * rendered it.
 *
 * **Why a refusal names nothing.** `readCandidate` authorises before it enumerates, so a session that
 * may not read this candidate is refused without a title, an edition, a revision, a checksum or any
 * hint that something exists here. That refusal is passed to the notice exactly as received, and this
 * file adds no detail to it.
 */
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
/**
 * The level this route's one heading occupies.
 *
 * Every arm of this page states exactly one top-level heading and nothing above it: the shell renders
 * no `h1`, so level 1 is this screen's own title — the panel's, or the notice's — and the panel steps
 * its own sections down from there. A sibling route states its `h1` itself and asks the panel for
 * level 2 instead, which is why the level is a prop of the shared panel rather than a constant in it.
 */
const PAGE_HEADING_LEVEL = 1;

/** The title of the refusal, which states the condition and nothing about what may exist here. */
const DENIED_TITLE = "This review is not available in this session";

/** The title of an outage: the candidate could not be read, which is not the same as there being none. */
const UNAVAILABLE_TITLE = "The frozen revision could not be read";

const UNAVAILABLE_DESCRIPTION =
  "The records behind this candidate could not be read, so nothing is shown here in place of them. " +
  "No decision is offered until the read succeeds: an empty review would state that nothing is " +
  "frozen, which this read does not say.";

/** The title of a frozen revision whose body cannot be shown as the content profile requires. */
const UNRENDERABLE_TITLE = "The frozen revision cannot be shown";

const UNRENDERABLE_DESCRIPTION =
  "This edition's frozen revision cannot be read as the content profile requires, so no reviewer can " +
  "be asked to approve it. Nothing has been approved, nothing has been released, and the revision " +
  "keeps its identity until the author submits one that can be shown.";

const NO_CANDIDATES: readonly CandidateView[] = [];

/**
 * Whether the author asked for notices alongside the release.
 *
 * The review read states the frozen revision, its rendered body and the single review step it may
 * receive; it does not carry the release mode recorded with the submission. A submission that names
 * no mode is recorded as publish-only, so that is the mode stated here rather than a choice inferred
 * from nothing — and the decision itself re-checks the recorded mode and refuses any attempt to change
 * it, so this label can never turn a release into a notification request.
 */
const RELEASE_MODE_STATED = false;

/** The empty identity a surface with no frozen candidate carries: no decision is offered, so none is named. */
const NO_CANDIDATE_ID = "";
// The envelope, mapped onto the panel's view of one candidate
/**
 * The frozen candidate as the panel shows it: the exact revision and checksum the reviewer answers,
 * the body rendered by the read, the renditions this read was admitted to serve, and the decision on
 * record when there is one.
 *
 * Every field is copied from the read, with one exception that is not a value but a word: the edition's
 * lifecycle state, derived from the records the same read returned through the application's one
 * lifecycle implementation. The route derives it rather than the panel, because the panel is given one
 * candidate and the release head is what decides whether a decided edition still says it published.
 */
function candidateViewOf(data: ReviewableCandidate): CandidateView {
  return {
    variantId: data.variant.variantId,
    audience: data.audience,
    locale: data.locale,
    revisionId: data.candidate.revisionId,
    contentChecksum: data.candidate.contentChecksum,
    renderedHtml: data.renderedHtml,
    mediaRenditions: data.placements.flatMap((placement) =>
      placement.renditions.map((rendition) => ({ purpose: rendition.purpose, url: rendition.path })),
    ),
    lifecycle: lifecycleOf(data.variant, data.headRelease ?? undefined),
    decisionRecord: data.review.recorded,
  };
}
/**
 * Answers for a read member this file does not handle.
 *
 * Unreachable: a read answers with an envelope, a denial or an outage, and each is handled at its call
 * site. It exists so a fourth member fails to compile there instead of being rendered as a generic
 * empty surface that would state nothing was found.
 */
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
          // A frozen candidate exists because the author submitted it for review, so review is the
          // path this edition is on: the panel offers its one decision rather than claiming none is
          // required.
          policyRequiresReview
          notifyRequestedByAuthor={RELEASE_MODE_STATED}
          headingLevel={PAGE_HEADING_LEVEL}
        />
      );
    case "none":
      // The edition is readable and holds no frozen candidate. The panel states exactly that, offers no
      // decision, and no identity is named for one.
      return (
        <UpdateReviewSurface
          candidates={NO_CANDIDATES}
          activeVariantId={data.variant.variantId}
          candidateId={NO_CANDIDATE_ID}
          scope={envelope.scope}
          expectedRevision={envelope.revision}
          policyRequiresReview={false}
          notifyRequestedByAuthor={RELEASE_MODE_STATED}
          headingLevel={PAGE_HEADING_LEVEL}
        />
      );
    case "invalid":
      // The revision exists and its body cannot be shown. Offering a decision on a body no reviewer can
      // read would be an approval of something unseen, so the surface reports the condition instead.
      return (
        <StateNotice
          kind="unavailable"
          headingLevel={PAGE_HEADING_LEVEL}
          title={UNRENDERABLE_TITLE}
          description={UNRENDERABLE_DESCRIPTION}
          source={envelope.source}
        />
      );
    case "unavailable":
      return (
        <StateNotice
          kind="unavailable"
          headingLevel={PAGE_HEADING_LEVEL}
          title={UNRENDERABLE_TITLE}
          description={data.reason}
          source={envelope.source}
        />
      );
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
  // The segment is passed through as the opaque identity the read resolves: it is never parsed,
  // case-folded, trimmed to parts or compared with anything this file can see.
  const result = await reads.updates.readCandidate({ variantId: candidateId });
  switch (result.kind) {
    case "envelope":
      return surfaceOf(result.envelope);
    case "denied":
      return <StateNotice kind="denied" headingLevel={PAGE_HEADING_LEVEL} title={DENIED_TITLE} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return (
        <StateNotice
          kind="unavailable"
          headingLevel={PAGE_HEADING_LEVEL}
          title={UNAVAILABLE_TITLE}
          description={UNAVAILABLE_DESCRIPTION}
          source={result.unavailable.source}
        />
      );
  }
  return unhandledAnswer(result);
}
