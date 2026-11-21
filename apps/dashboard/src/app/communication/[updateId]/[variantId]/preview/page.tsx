/** `/communication/[updateId]/[variantId]/preview` — the exact, currently authorised, inert preview of one Update edition. **One surface, one renderer.** The reading is the service's own preview at the revision the edition acknowledges, and `features/updates/components/preview-frame` places that answer unchanged: this file decides nothing about the content, draws no control and states no effect of its own. */
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { PreviewFrame } from "@/features/updates/components/preview-frame";
import { reads, type DenialReason } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// The reads' own shapes, taken from the service surface rather than restated
// ---------------------------------------------------------------------------------------------

type OverviewResult = Awaited<ReturnType<typeof reads.updates.readVariantOverview>>;
type Editions = Extract<OverviewResult, { kind: "envelope" }>["envelope"]["data"]["editions"];
type Edition = Editions[number];
type UnavailableSource = Extract<OverviewResult, { kind: "unavailable" }>["unavailable"]["source"];

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The level the surface's one heading occupies: the preview frame's own heading is the only h1 here, and every notice states itself at that same level. */
const SURFACE_HEADING_LEVEL = 1;
/** The title of a refusal: it states the condition and nothing about what may or may not exist here. */
const DENIED_TITLE = "This preview is not available in this session";
/** The title of an outage, which is neither an empty edition nor a hidden one. */
const UNAVAILABLE_TITLE = "This preview could not be read";
/** The title of a request these reads do not serve, where the address itself is the answer. */
const REFUSED_TITLE = "This preview's address was refused";
/** The title of an edition that holds no revision at all yet: nothing saved and nothing released is neither a refusal nor an outage. */
const EMPTY_TITLE = "This edition has no revision to preview";
const EMPTY_DESCRIPTION =
  "Nothing is saved and nothing is released for this edition yet, so there is no exact revision to render. A preview shows a revision that exists rather than an empty frame, and it never renders a sibling edition or a newer draft in its place.";
const NOT_AN_EDITION_DESCRIPTION =
  "The address names an edition this Update does not hold, so nothing is rendered and no other edition is shown in its place.";
const NOT_AN_UPDATE_DESCRIPTION =
  "The address names a document that is not an Update, so this surface has nothing to show for it. A Page edition is previewed from its own route, where its own audience and give placement are stated.";
const REFUSED_REQUEST_DESCRIPTION =
  "The request this preview would authorise was refused, so nothing is rendered and no other edition or revision is shown in its place. Opening the same address again is the only way to ask for this revision.";
const PREVIEW_GUIDANCE_FALLBACK = "The records behind this edition could not be read, so nothing is shown in their place. An outage is not an edition with nothing to preview.";

// ---------------------------------------------------------------------------------------------
// What the address resolves to inside the edition it names
// ---------------------------------------------------------------------------------------------

/** The edition the address names, among the editions this read enumerated for the document it names. The comparison selects one of that document's own editions: it establishes no identity and carries no authority, which stays with the read below. */
function editionOf(editions: Editions, variantId: string): Edition | undefined {
  return editions.find((edition) => edition.variantId === variantId);
}

/**
 * The revision this edition acknowledges: the saved draft while the worker is composing, and otherwise the revision the edition's head release published — the same rule the service uses for an edition's current revision. A preview never advances to a newer revision of its own accord, and with neither of the two the edition has nothing to render.
 */
function acknowledgedRevisionOf(edition: Edition): string | undefined {
  return edition.draftRevisionId ?? edition.headRelease?.revisionId;
}

/** The frozen candidate's identity, when the revision being acknowledged is that frozen submission: naming it lets the read admit a reviewer of the exact revision as well as its author. */
function frozenCandidateOf(edition: Edition, revisionId: string): string | undefined {
  return edition.candidateId !== null && edition.candidateId === revisionId ? edition.candidateId : undefined;
}

// ---------------------------------------------------------------------------------------------
// The honest answers this route renders in place of a preview
// ---------------------------------------------------------------------------------------------

function deniedNotice(reasonCode: DenialReason): ReactElement {
  return <StateNotice kind="denied" headingLevel={SURFACE_HEADING_LEVEL} title={DENIED_TITLE} reasonCode={reasonCode} />;
}

function unavailableNotice(source: UnavailableSource, guidance: string): ReactElement {
  const stated = guidance.trim();
  return <StateNotice kind="unavailable" headingLevel={SURFACE_HEADING_LEVEL} title={UNAVAILABLE_TITLE} description={stated.length === 0 ? PREVIEW_GUIDANCE_FALLBACK : stated} source={source} />;
}

function refusedNotice(description: string): ReactElement {
  return <StateNotice kind="refused" headingLevel={SURFACE_HEADING_LEVEL} title={REFUSED_TITLE} description={description} />;
}

function emptyNotice(): ReactElement {
  return <StateNotice kind="empty" headingLevel={SURFACE_HEADING_LEVEL} title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} />;
}

// ---------------------------------------------------------------------------------------------
// The preview, once the edition and its acknowledged revision are known
// ---------------------------------------------------------------------------------------------

async function previewOf(editions: Editions, variantId: string): Promise<ReactElement> {
  const edition = editionOf(editions, variantId);
  if (edition === undefined) return refusedNotice(NOT_AN_EDITION_DESCRIPTION);
  const revisionId = acknowledgedRevisionOf(edition);
  if (revisionId === undefined) return emptyNotice();
  const candidateId = frozenCandidateOf(edition, revisionId);
  // The edition's own language is never asked for here: no language is named by this address, so the read serves the locale the edition is written in and no fallback is disclosed or concealed by this file.
  const result = await reads.updates.readPreview({ variantId: edition.variantId, revisionId, ...(candidateId === undefined ? {} : { candidateId }) });
  switch (result.kind) {
    case "envelope":
      // The read's own payload is the frame's view: one renderer's output for this revision, its audience and language, and the statement of everything a preview cannot do.
      return <PreviewFrame headingLevel={SURFACE_HEADING_LEVEL} preview={result.envelope.data} />;
    case "denied":
      return deniedNotice(result.denied.reasonCode);
    case "unavailable":
      return unavailableNotice(result.unavailable.source, result.unavailable.guidance);
    case "refused":
      // The revision this route resolved is one the read does not admit, which is a request to reconsider rather than an outage or a hidden record.
      return refusedNotice(REFUSED_REQUEST_DESCRIPTION);
  }
}

/** What this route receives: the two opaque segments naming the Update and the edition to preview, unresolved. */
export interface CommunicationVariantPreviewPageProps {
  readonly params: Promise<{ updateId: string; variantId: string }>;
}

/** The exact, currently authorised, inert preview of one Update edition. */
export default async function CommunicationVariantPreviewPage({ params }: CommunicationVariantPreviewPageProps): Promise<ReactElement> {
  const { updateId, variantId } = await params;
  // Both segments travel to the read as the opaque identities they are: neither is parsed, case-folded or trimmed into parts, and neither is used to derive any fact beyond the edition it names.
  const overview = await reads.updates.readVariantOverview({ documentId: updateId });
  switch (overview.kind) {
    case "envelope":
      // A preview of an Update edition is this family's surface, so a document of another family is a request this route does not serve rather than one it renders under Update wording.
      if (overview.envelope.data.document.family !== "update") return refusedNotice(NOT_AN_UPDATE_DESCRIPTION);
      return previewOf(overview.envelope.data.editions, variantId);
    case "denied":
      return deniedNotice(overview.denied.reasonCode);
    case "unavailable":
      return unavailableNotice(overview.unavailable.source, overview.unavailable.guidance);
    case "refused":
      // This route calls the read directly, so the request is its own and never one a transport refused: the arm is stated rather than thrown, and the notice names the request rather than the source.
      return refusedNotice(REFUSED_REQUEST_DESCRIPTION);
  }
}
