import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { PreviewFrame } from "@/features/updates/components/preview-frame";
import { reads, type DenialReason } from "@/modules/data-service";
export const metadata: Metadata = { title: "Preview" };
type OverviewResult = Awaited<ReturnType<typeof reads.updates.readVariantOverview>>;
type Editions = Extract<OverviewResult, { kind: "envelope" }>["envelope"]["data"]["editions"];
type Edition = Editions[number];
type UnavailableSource = Extract<OverviewResult, { kind: "unavailable" }>["unavailable"]["source"];
const SURFACE_HEADING_LEVEL = 1;
const REFUSED_REQUEST_DESCRIPTION = "This preview link couldn’t be opened. Reopen preview from the update edition.";
const PREVIEW_GUIDANCE_FALLBACK = "Couldn’t load this preview right now. Try again in a moment.";
const editionOf = (editions: Editions, variantId: string): Edition | undefined => editions.find((edition) => edition.variantId === variantId);
const acknowledgedRevisionOf = (edition: Edition): string | undefined => edition.draftRevisionId ?? edition.headRelease?.revisionId;
const frozenCandidateOf = (edition: Edition, revisionId: string): string | undefined => (edition.candidateId !== null && edition.candidateId === revisionId ? edition.candidateId : undefined);
const deniedNotice = (reasonCode: DenialReason): ReactElement => <StateNotice kind="denied" headingLevel={SURFACE_HEADING_LEVEL} title="Preview isn’t available in this session" reasonCode={reasonCode} />;
function unavailableNotice(source: UnavailableSource, guidance: string): ReactElement {
  const stated = guidance.trim();
  return <StateNotice kind="unavailable" headingLevel={SURFACE_HEADING_LEVEL} title="Couldn’t load preview" description={stated.length === 0 ? PREVIEW_GUIDANCE_FALLBACK : stated} source={source} />;
}
const refusedNotice = (description: string): ReactElement => <StateNotice kind="refused" headingLevel={SURFACE_HEADING_LEVEL} title="Couldn’t open preview" description={description} />;
const emptyNotice = (): ReactElement => (
  <StateNotice
    kind="empty"
    headingLevel={SURFACE_HEADING_LEVEL}
    title="Nothing to preview yet"
    description="Save a draft or publish this edition first before previewing it."
  />
);
async function previewOf(editions: Editions, variantId: string): Promise<ReactElement> {
  const edition = editionOf(editions, variantId);
  if (edition === undefined) return refusedNotice("That edition doesn’t belong to this update.");
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
/** The exact, currently authorised, inert preview of one Update edition. */ export default async function CommunicationVariantPreviewPage({ params }: { readonly params: Promise<{ updateId: string; variantId: string }> }): Promise<ReactElement> {
  const { updateId, variantId } = await params;
  const overview = await reads.updates.readVariantOverview({ documentId: updateId });
  switch (overview.kind) {
    case "envelope":
      if (overview.envelope.data.document.family !== "update") return refusedNotice("That address belongs to a Ministry page rather than an Update. Preview it from Ministry pages instead.");
      return previewOf(overview.envelope.data.editions, variantId);
    case "denied":
      return deniedNotice(overview.denied.reasonCode);
    case "unavailable":
      return unavailableNotice(overview.unavailable.source, overview.unavailable.guidance);
    case "refused":
      return refusedNotice(REFUSED_REQUEST_DESCRIPTION);
  }
}
