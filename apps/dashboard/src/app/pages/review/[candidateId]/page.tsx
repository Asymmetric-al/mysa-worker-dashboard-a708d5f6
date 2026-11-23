import type { ReactElement } from "react";
import { lifecycleOf } from "@/components/draft-status";
import StateNotice from "@/components/state-notice";
import { PageReviewSurface, type ReviewDocumentView, type ReviewEditionView } from "@/features/ministry-pages/components/page-review-surface";
import { reads, type ReadResult } from "@/modules/data-service";
import { PageSurface, ReadNotices, type ReadNoticeCopy } from "../../../page-frame";
type CandidateEnvelope = Extract<Awaited<ReturnType<typeof reads.updates.readCandidate>>, { kind: "envelope" }>["envelope"];
type CandidateData = CandidateEnvelope["data"];
type ReviewableCandidate = Extract<CandidateData, { status: "reviewable" }>;
type PageLocalesEnvelope = Extract<Awaited<ReturnType<typeof reads.pages.readPageLocales>>, { kind: "envelope" }>["envelope"];
type EditionView = PageLocalesEnvelope["data"]["editions"][number];
type FailedRead = Exclude<ReadResult<never>, { kind: "envelope" }>;
const PAGE_HEADING_LEVEL = 1;
const NO_CANDIDATE_ID = "";
const REFUSED_TITLE = "This review's request was refused";
const UNRENDERABLE_TITLE = "The frozen revision cannot be shown";
const UNRENDERABLE_DESCRIPTION = "This edition's frozen revision cannot be read as the content profile requires, so no reviewer can be asked to " + "approve it. Nothing has been approved, nothing has been released, and the revision keeps its identity until the " + "author submits one that can be shown.";
type ReviewedCandidate = {
  readonly variantId: string;
  readonly candidateId: string;
  readonly revisionId: string;
  readonly contentChecksum: string;
  readonly renderedHtml: string;
  readonly mediaRenditions: NonNullable<ReviewEditionView["mediaRenditions"]>;
  readonly decisionRecord: NonNullable<ReviewEditionView["decisionRecord"]> | null;
  /** Whether the principal reading this page wrote the frozen revision, as the candidate read states it. */
  readonly reviewedByAuthor: boolean;
  readonly headRelease: ReviewableCandidate["headRelease"];
};
function variantRecordOf(documentId: string, edition: EditionView): Parameters<typeof lifecycleOf>[0] {
  return {
    variantId: edition.variantId,
    documentId,
    audience: edition.audience,
    locale: edition.locale,
    ...(edition.draftRevisionId === null ? {} : { draftRevisionId: edition.draftRevisionId }),
    ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
    ...(edition.releaseHeadId === null ? {} : { releaseHeadId: edition.releaseHeadId }),
  };
}
function lifecycleOfEdition(documentId: string, edition: EditionView): ReviewEditionView["lifecycle"] {
  const derived = lifecycleOf(variantRecordOf(documentId, edition), edition.headRelease ?? undefined);
  return edition.translation.status === "stale" && (derived === "draft" || derived === "not-started") ? "stale-translation" : derived;
}
const pageFamilyOf = (family: PageLocalesEnvelope["data"]["document"]["family"]): ReviewDocumentView["family"] | undefined => (family === "worker-page" || family === "project-page" ? family : undefined);
function reviewedOf(data: ReviewableCandidate): ReviewedCandidate {
  return {
    variantId: data.variant.variantId,
    candidateId: data.candidate.candidateId,
    revisionId: data.candidate.revisionId,
    contentChecksum: data.candidate.contentChecksum,
    renderedHtml: data.renderedHtml,
    mediaRenditions: data.placements.flatMap((placement) => placement.renditions.map((rendition) => ({ purpose: rendition.purpose, url: rendition.path }))),
    decisionRecord: data.review.recorded,
    reviewedByAuthor: data.review.reviewedByAuthor,
    headRelease: data.headRelease,
  };
}
function editionViewOf(edition: EditionView, documentId: string, reviewed: ReviewedCandidate | undefined): ReviewEditionView {
  const stated = { variantId: edition.variantId, locale: edition.locale, lifecycle: lifecycleOfEdition(documentId, edition), ...(edition.translation.status === "stale" ? { staleTranslation: true } : {}) };
  if (reviewed !== undefined && reviewed.variantId === edition.variantId)
    return { ...stated, candidateId: reviewed.candidateId, revisionId: reviewed.revisionId, contentChecksum: reviewed.contentChecksum, renderedHtml: reviewed.renderedHtml, mediaRenditions: reviewed.mediaRenditions, decisionRecord: reviewed.decisionRecord, reviewedByAuthor: reviewed.reviewedByAuthor };
  return edition.candidateId === null ? stated : { ...stated, candidateId: edition.candidateId };
}
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: PAGE_HEADING_LEVEL,
  denied: { title: "This review is not available in this session" },
  unavailable: { title: "The review could not be read", body: "The records behind this review could not be read, so nothing is shown here in place of them. " + "No decision is offered until the read succeeds: an empty review would state that nothing is frozen, " + "which this read does not say." },
  refused: { title: REFUSED_TITLE },
};
const failureNoticeOf = (result: FailedRead): ReactElement => <ReadNotices failure={result} copy={NOTICE_COPY} />;
async function pageReviewOf(envelope: CandidateEnvelope, reviewed: ReviewedCandidate | undefined): Promise<ReactElement> {
  const { documentId } = envelope.data.document;
  const locales = await reads.pages.readPageLocales({ pageId: documentId });
  if (locales.kind !== "envelope") return failureNoticeOf(locales);
  const page = locales.envelope.data;
  const family = pageFamilyOf(page.document.family);
  if (family === undefined) return <StateNotice kind="refused" headingLevel={PAGE_HEADING_LEVEL} title={REFUSED_TITLE} />;
  const headReleaseId = reviewed?.headRelease?.releaseId ?? "";
  const giving = await reads.pages.readGivingBinding({ documentId, ...(headReleaseId === "" ? {} : { releaseId: headReleaseId }) });
  if (giving.kind !== "envelope") return failureNoticeOf(giving);
  const givingBinding = giving.envelope.data.binding;
  const reach = reviewed?.headRelease?.reach;
  const document: ReviewDocumentView = { documentId, family, recordRevision: page.document.recordRevision, editions: page.editions.map((edition) => editionViewOf(edition, documentId, reviewed)) };
  return (
    <PageSurface headingId="page-review-heading" title="Page review">
      <PageReviewSurface document={document} candidateId={reviewed === undefined ? NO_CANDIDATE_ID : reviewed.candidateId} expectedRevision={envelope.revision} scope={envelope.scope} givingBinding={givingBinding} {...(reach === undefined ? {} : { reach })} />
    </PageSurface>
  );
}
async function reviewOf(envelope: CandidateEnvelope): Promise<ReactElement> {
  const { data } = envelope;
  switch (data.status) {
    case "reviewable":
      return pageReviewOf(envelope, reviewedOf(data));
    case "none":
      return pageReviewOf(envelope, undefined);
    case "invalid":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNRENDERABLE_TITLE} description={UNRENDERABLE_DESCRIPTION} source={envelope.source} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={UNRENDERABLE_TITLE} description={data.reason} source={envelope.source} />;
  }
}
/** The review of one frozen Page candidate: one read, one branch, one surface. */
export default async function PageReviewCandidatePage({ params }: { readonly params: Promise<{ candidateId: string }> }): Promise<ReactElement> {
  const { candidateId } = await params;
  const result = await reads.updates.readCandidate({ variantId: candidateId });
  return result.kind === "envelope" ? reviewOf(result.envelope) : <ReadNotices failure={result} copy={NOTICE_COPY} />;
}
