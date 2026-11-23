import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { PreviewFrame } from "@/features/updates/components/preview-frame";
import { reads, type DenialReason } from "@/modules/data-service";
type OverviewResult = Awaited<ReturnType<typeof reads.updates.readVariantOverview>>;
type Editions = Extract<OverviewResult, { kind: "envelope" }>["envelope"]["data"]["editions"];
type Edition = Editions[number];
type UnavailableSource = Extract<OverviewResult, { kind: "unavailable" }>["unavailable"]["source"];
const SURFACE_HEADING_LEVEL = 1;
const NOT_AN_EDITION_DESCRIPTION = "The address names an edition this Update does not hold, so nothing is rendered and no other edition is shown in its place.";
const NOT_AN_UPDATE_DESCRIPTION = "The address names a document that is not an Update, so this surface has nothing to show for it. A Page edition is previewed from its own route, where its own audience and give placement are stated.";
const REFUSED_REQUEST_DESCRIPTION = "The request this preview would authorise was refused, so nothing is rendered and no other edition or revision is shown in its place. Opening the same address again is the only way to ask for this revision.";
const PREVIEW_GUIDANCE_FALLBACK = "The records behind this edition could not be read, so nothing is shown in their place. An outage is not an edition with nothing to preview.";
const editionOf = (editions: Editions, variantId: string): Edition | undefined => editions.find((edition) => edition.variantId === variantId);
const acknowledgedRevisionOf = (edition: Edition): string | undefined => edition.draftRevisionId ?? edition.headRelease?.revisionId;
const frozenCandidateOf = (edition: Edition, revisionId: string): string | undefined => (edition.candidateId !== null && edition.candidateId === revisionId ? edition.candidateId : undefined);
const deniedNotice = (reasonCode: DenialReason): ReactElement => <StateNotice kind="denied" headingLevel={SURFACE_HEADING_LEVEL} title="This preview is not available in this session" reasonCode={reasonCode} />;
function unavailableNotice(source: UnavailableSource, guidance: string): ReactElement {
  const stated = guidance.trim();
  return <StateNotice kind="unavailable" headingLevel={SURFACE_HEADING_LEVEL} title="This preview could not be read" description={stated.length === 0 ? PREVIEW_GUIDANCE_FALLBACK : stated} source={source} />;
}
const refusedNotice = (description: string): ReactElement => <StateNotice kind="refused" headingLevel={SURFACE_HEADING_LEVEL} title="This preview's address was refused" description={description} />;
const emptyNotice = (): ReactElement => (
  <StateNotice
    kind="empty"
    headingLevel={SURFACE_HEADING_LEVEL}
    title="This edition has no revision to preview"
    description="Nothing is saved and nothing is released for this edition yet, so there is no exact revision to render. A preview shows a revision that exists rather than an empty frame, and it never renders a sibling edition or a newer draft in its place."
  />
);
async function previewOf(editions: Editions, variantId: string): Promise<ReactElement> {
  const edition = editionOf(editions, variantId);
  if (edition === undefined) return refusedNotice(NOT_AN_EDITION_DESCRIPTION);
  const revisionId = acknowledgedRevisionOf(edition);
  if (revisionId === undefined) return emptyNotice();
  const candidateId = frozenCandidateOf(edition, revisionId);
  const result = await reads.updates.readPreview({ variantId: edition.variantId, revisionId, ...(candidateId === undefined ? {} : { candidateId }) });
  switch (result.kind) {
    case "envelope":
      return <PreviewFrame headingLevel={SURFACE_HEADING_LEVEL} preview={result.envelope.data} />;
    case "denied":
      return deniedNotice(result.denied.reasonCode);
    case "unavailable":
      return unavailableNotice(result.unavailable.source, result.unavailable.guidance);
    case "refused":
      return refusedNotice(REFUSED_REQUEST_DESCRIPTION);
  }
}
/** The exact, currently authorised, inert preview of one Update edition. */
export default async function CommunicationVariantPreviewPage({ params }: { readonly params: Promise<{ updateId: string; variantId: string }> }): Promise<ReactElement> {
  const { updateId, variantId } = await params;
  const overview = await reads.updates.readVariantOverview({ documentId: updateId });
  switch (overview.kind) {
    case "envelope":
      if (overview.envelope.data.document.family !== "update") return refusedNotice(NOT_AN_UPDATE_DESCRIPTION);
      return previewOf(overview.envelope.data.editions, variantId);
    case "denied":
      return deniedNotice(overview.denied.reasonCode);
    case "unavailable":
      return unavailableNotice(overview.unavailable.source, overview.unavailable.guidance);
    case "refused":
      return refusedNotice(REFUSED_REQUEST_DESCRIPTION);
  }
}
