/**
 * `/pages/review/[candidateId]` — the one-step review of one frozen Worker or Project Page candidate.
 *
 * **What this route is.** Composition, and nothing else. It reads the candidate the address names, reads the language
 * editions of the Page that candidate belongs to, and reads the giving binding those editions release against; then it
 * hands those answers to this family's review surface. The surface states the exact frozen revision, the Page's reach
 * and giving context, and the single decision a reviewer gives, so the Update family's review route and this one reach
 * one implementation of the review step rather than two.
 *
 * **Why the decision itself lives in the surface.** This file performs no change and renders no action control. The
 * Pages release verbs leave the surface through the family's own hooks, each attempt carrying one operation id, the
 * scope it was read in and the revision it saw, so a replay returns its recorded result instead of answering a
 * candidate twice. A Page release sends no message to anyone, which is why this family offers no such option at all:
 * the surface says that a reviewer cannot change what a release will do, and this route states no wording of its own
 * about it.
 *
 * **What a refusal states.** A denial, an outage and a refused request each render the single notice that belongs to
 * them, carrying no title, revision, checksum, count or existence hint: a candidate the read cannot resolve answers
 * exactly as one the caller may not read. An outage is never rendered as an empty review, because an empty review would
 * assert that nothing is frozen, which a failed read does not say.
 */
import type { ReactElement } from "react";
import { lifecycleOf } from "@/components/draft-status";
import StateNotice from "@/components/state-notice";
import { PageReviewSurface, type ReviewDocumentView, type ReviewEditionView } from "@/features/ministry-pages/components/page-review-surface";
import { reads, type ReadResult } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// The reads' own shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** What the one candidate read answers, and the envelope within it. */
type CandidateResult = Awaited<ReturnType<typeof reads.updates.readCandidate>>;
type CandidateEnvelope = Extract<CandidateResult, { kind: "envelope" }>["envelope"];
type CandidateData = CandidateEnvelope["data"];
/** The candidate the reviewer answers: frozen, rendered by the read, and still awaiting its one decision. */
type ReviewableCandidate = Extract<CandidateData, { status: "reviewable" }>;

/** What the Page's language editions read answers. */
type PageLocalesEnvelope = Extract<Awaited<ReturnType<typeof reads.pages.readPageLocales>>, { kind: "envelope" }>["envelope"];
type EditionView = PageLocalesEnvelope["data"]["editions"][number];

/** A read that produced no record: the denial, the outage and the refused request, none of which carries a record. */
type FailedRead = Exclude<ReadResult<never>, { kind: "envelope" }>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The level this route's one heading occupies; the surface opens its own sections at level two. */
const PAGE_HEADING_LEVEL = 1;

/** The surface's own name, which states the job and no record. */
const SURFACE_TITLE = "Page review";

const HEADING_ID = "page-review-heading";

const WRAPPER_CLASS = "flex min-w-0 flex-col gap-6 text-start";

const H1_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";

/**
 * The identity a surface with no frozen candidate carries. The edition holds nothing to answer, so no decision is
 * offered and none is named: an identifier here would be one this route invented.
 */
const NO_CANDIDATE_ID = "";

/** The refusal of an answer this session may not see, which states the condition and nothing about what may exist. */
const DENIED_TITLE = "This review is not available in this session";

/** The refusal of a request this read does not admit: the address is the answer, and no record was read. */
const REFUSED_TITLE = "This review's request was refused";

/** The outage of the read itself, which is never the same fact as there being nothing to review. */
const UNAVAILABLE_TITLE = "The review could not be read";

const UNAVAILABLE_DESCRIPTION = "The records behind this review could not be read, so nothing is shown here in place of them. " + "No decision is offered until the read succeeds: an empty review would state that nothing is frozen, " + "which this read does not say.";

/** The one frozen revision the one renderer cannot read: an approval of it would be an approval of something unseen. */
const UNRENDERABLE_TITLE = "The frozen revision cannot be shown";

const UNRENDERABLE_DESCRIPTION = "This edition's frozen revision cannot be read as the content profile requires, so no reviewer can be asked to " + "approve it. Nothing has been approved, nothing has been released, and the revision keeps its identity until the " + "author submits one that can be shown.";

// ---------------------------------------------------------------------------------------------
// What the envelope states, read onto the surface's contract
// ---------------------------------------------------------------------------------------------

/** The candidate this route answers, as the surface reads a reviewed edition. */
interface ReviewedCandidate {
  /** The edition that froze it. The review names one edition, and approving it approves no other. */
  readonly variantId: string;
  readonly candidateId: string;
  readonly revisionId: string;
  readonly contentChecksum: string;
  readonly renderedHtml: string;
  readonly mediaRenditions: NonNullable<ReviewEditionView["mediaRenditions"]>;
  readonly decisionRecord: NonNullable<ReviewEditionView["decisionRecord"]> | null;
  /** The release standing at this edition's head, or `null` when the edition has published nothing to reach anyone. */
  readonly headRelease: ReviewableCandidate["headRelease"];
}

/** The variant record `lifecycleOf` evaluates: the read's own pointers, so a lifecycle word is derived and never written here. */
function variantRecordOf(documentId: string, edition: EditionView): Parameters<typeof lifecycleOf>[0] {
  return {
    variantId: edition.variantId,
    documentId,
    audience: edition.audience,
    locale: edition.locale,
    // Absent pointers are omitted rather than set to `undefined`, so the record states exactly what the read stated.
    ...(edition.draftRevisionId === null ? {} : { draftRevisionId: edition.draftRevisionId }),
    ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
    ...(edition.releaseHeadId === null ? {} : { releaseHeadId: edition.releaseHeadId }),
  };
}

/**
 * The lifecycle word of one edition. `lifecycleOf` owns the precedence between a withdrawal, a frozen candidate, a
 * release and a draft, so this function only feeds it the read's pointers. Staleness is the one state the evaluator
 * cannot reach without the source revision's body, and the locale read has already resolved it from that body, so the
 * read's own answer is used where the evaluator would otherwise report a plain draft or nothing written.
 */
function lifecycleOfEdition(documentId: string, edition: EditionView): ReviewEditionView["lifecycle"] {
  const derived = lifecycleOf(variantRecordOf(documentId, edition), edition.headRelease ?? undefined);
  return edition.translation.status === "stale" && (derived === "draft" || derived === "not-started") ? "stale-translation" : derived;
}

/** The Page family this review belongs to, or `undefined` for the Update family this route never answers. */
function pageFamilyOf(family: PageLocalesEnvelope["data"]["document"]["family"]): ReviewDocumentView["family"] | undefined {
  return family === "worker-page" || family === "project-page" ? family : undefined;
}

/** The reviewed candidate as the surface reads it, taken from the candidate read and from nothing else. */
function reviewedOf(data: ReviewableCandidate): ReviewedCandidate {
  return {
    variantId: data.variant.variantId,
    candidateId: data.candidate.candidateId,
    revisionId: data.candidate.revisionId,
    contentChecksum: data.candidate.contentChecksum,
    renderedHtml: data.renderedHtml,
    // Only the renditions this read was admitted to serve, behind their own scope-checked addresses: the source
    // original is not among them, and a placement whose rendition is unavailable contributes none.
    mediaRenditions: data.placements.flatMap((placement) => placement.renditions.map((rendition) => ({ purpose: rendition.purpose, url: rendition.path }))),
    decisionRecord: data.review.recorded,
    headRelease: data.headRelease,
  };
}

/**
 * One edition as the surface states it. The reviewed edition carries the exact revision and checksum it froze, so a
 * later draft of the same edition is a different revision and cannot alter what is being answered; every other edition
 * states its own lifecycle and whether it holds a frozen candidate, and none of them is answerable from this address.
 */
function editionViewOf(edition: EditionView, documentId: string, reviewed: ReviewedCandidate | undefined): ReviewEditionView {
  const stated = { variantId: edition.variantId, locale: edition.locale, lifecycle: lifecycleOfEdition(documentId, edition), ...(edition.translation.status === "stale" ? { staleTranslation: true } : {}) };
  if (reviewed !== undefined && reviewed.variantId === edition.variantId) {
    return { ...stated, candidateId: reviewed.candidateId, revisionId: reviewed.revisionId, contentChecksum: reviewed.contentChecksum, renderedHtml: reviewed.renderedHtml, mediaRenditions: reviewed.mediaRenditions, decisionRecord: reviewed.decisionRecord };
  }
  return edition.candidateId === null ? stated : { ...stated, candidateId: edition.candidateId };
}

// ---------------------------------------------------------------------------------------------
// The states that replace a review
// ---------------------------------------------------------------------------------------------

/** The one notice a read that produced no record answers with, carrying no record data in any arm. */
function failureNoticeOf(result: FailedRead): ReactElement {
  switch (result.kind) {
    case "denied":
      // The closed reason code is the whole answer a refusal carries: no record, count, title or size travels with it.
      return <StateNotice kind="denied" headingLevel={PAGE_HEADING_LEVEL} title={DENIED_TITLE} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNAVAILABLE_TITLE} description={UNAVAILABLE_DESCRIPTION} source={result.unavailable.source} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={PAGE_HEADING_LEVEL} title={REFUSED_TITLE} />;
  }
}

// ---------------------------------------------------------------------------------------------
// The composed route
// ---------------------------------------------------------------------------------------------

/**
 * The Page's editions, its giving context and the one review surface — or the refusal that replaces them.
 *
 * The two supporting reads run only once the candidate read has answered with an envelope, so every arm that states
 * nothing states it from the arm above rather than from a second probe. Each of them re-derives scope from the same
 * session, so a denial or an outage from either is answered as the read itself reported it.
 */
async function pageReviewOf(envelope: CandidateEnvelope, reviewed: ReviewedCandidate | undefined): Promise<ReactElement> {
  const { documentId } = envelope.data.document;
  const locales = await reads.pages.readPageLocales({ pageId: documentId });
  if (locales.kind !== "envelope") return failureNoticeOf(locales);
  const page = locales.envelope.data;
  const family = pageFamilyOf(page.document.family);
  // The locale read refuses an Update document, so this arm states the same refused request instead of guessing at a
  // family this route does not answer.
  if (family === undefined) return <StateNotice kind="refused" headingLevel={PAGE_HEADING_LEVEL} title={REFUSED_TITLE} />;
  const headReleaseId = reviewed?.headRelease?.releaseId ?? "";
  // The Designation belongs to the Page rather than to one edition, so the read is asked for the release the reviewed
  // edition published where it published one, and answers for the Page's newest release otherwise.
  const giving = await reads.pages.readGivingBinding({ documentId, ...(headReleaseId === "" ? {} : { releaseId: headReleaseId }) });
  if (giving.kind !== "envelope") return failureNoticeOf(giving);
  // The one approved Designation, or the reason giving is unavailable: stated as the read answered it, with no fallback
  // fund and no default destination standing in for an answer the source did not give.
  const givingBinding = giving.envelope.data.binding;
  // The reach control states the reach the release carries. Only an edition that published something has one to state,
  // so an unreleased edition is given none and the control states that reach is set when the edition is released.
  const reach = reviewed?.headRelease?.reach;
  const document: ReviewDocumentView = {
    documentId,
    family,
    // The document record's revision: a reach change belongs to the Page's releases rather than to one edition, so the
    // control presents this as the revision it read and a stale one is a conflict rather than an overwrite.
    recordRevision: page.document.recordRevision,
    editions: page.editions.map((edition) => editionViewOf(edition, documentId, reviewed)),
  };
  return (
    <section aria-labelledby={HEADING_ID} className={WRAPPER_CLASS}>
      {/* The one h1 on this route: the review surface opens its own sections at level two. */}
      <h1 id={HEADING_ID} className={H1_CLASS}>
        {SURFACE_TITLE}
      </h1>
      <PageReviewSurface document={document} candidateId={reviewed === undefined ? NO_CANDIDATE_ID : reviewed.candidateId} expectedRevision={envelope.revision} scope={envelope.scope} givingBinding={givingBinding} {...(reach === undefined ? {} : { reach })} />
    </section>
  );
}

/** What one candidate envelope composes: the family's review surface, or the honest state that replaces it. */
async function reviewOf(envelope: CandidateEnvelope): Promise<ReactElement> {
  const { data } = envelope;
  switch (data.status) {
    case "reviewable":
      return pageReviewOf(envelope, reviewedOf(data));
    case "none":
      // The edition is readable and holds no frozen candidate — an answer already given, or a revision never submitted.
      // The surface states exactly that, offers no decision, and no identity is named for one.
      return pageReviewOf(envelope, undefined);
    case "invalid":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNRENDERABLE_TITLE} description={UNRENDERABLE_DESCRIPTION} source={envelope.source} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNRENDERABLE_TITLE} description={data.reason} source={envelope.source} />;
  }
}

/** What this route receives: the segment naming the candidate to review, unresolved. */
export interface PageReviewCandidatePageProps {
  readonly params: Promise<{ candidateId: string }>;
}

/** The review of one frozen Page candidate: one read, one branch, one surface. */
export default async function PageReviewCandidatePage({ params }: PageReviewCandidatePageProps): Promise<ReactElement> {
  const { candidateId } = await params;
  // The segment is passed through as the opaque identity the read resolves: it is never parsed, case-folded, trimmed
  // into parts or compared with anything this file can see, and it is never rendered.
  const result = await reads.updates.readCandidate({ variantId: candidateId });
  switch (result.kind) {
    case "envelope":
      return reviewOf(result.envelope);
    case "denied":
      return <StateNotice kind="denied" headingLevel={PAGE_HEADING_LEVEL} title={DENIED_TITLE} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNAVAILABLE_TITLE} description={UNAVAILABLE_DESCRIPTION} source={result.unavailable.source} />;
    case "refused":
      // This route calls the read directly, so the request is its own and never one a handler refuses: the arm is stated
      // here rather than thrown, and the notice's own sentence says the request was refused rather than the source failing.
      return <StateNotice kind="refused" headingLevel={PAGE_HEADING_LEVEL} title={REFUSED_TITLE} />;
  }
}
