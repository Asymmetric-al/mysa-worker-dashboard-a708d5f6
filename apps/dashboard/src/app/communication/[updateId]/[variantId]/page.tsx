/**
 * `/communication/[updateId]/[variantId]` — the one editor of one Update edition (AAP 0.9.1, "One editor, bounded toolbar,
 * media placements"). This file composes and decides nothing: `EditorShell` arranges the prose, the media placements, the
 * save state and the single review step over the family's own reads, so no lifecycle word, revision, language, count or
 * permission is stated here. One service read seeds that surface, and every other answer is an honest notice.
 *
 * The editing surface itself is `./editor-surface`, the one client bridge of this route: a feature may not reach another
 * feature's provider, so that module states the browser's publishing preference — the release mode a new submission asks
 * for — and hands it to `EditorShell`, which this file neither holds nor edits.
 */
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import { assertNever } from "@/lib/result";
import { reads, type DenialReason } from "@/modules/data-service";
import EditorSurface from "./editor-surface";

// ---------------------------------------------------------------------------------------------
// The read's own shapes, taken from its signature rather than restated
// ---------------------------------------------------------------------------------------------

/** What `readDraft` answers with: the envelope, a denial, an outage behind the records, or a refused request. */
type DraftResult = Awaited<ReturnType<typeof reads.updates.readDraft>>;

/** The envelope arm, narrowed once so the surface below reads the scope, the payload and the edition from one shape. */
type DraftEnvelope = Extract<DraftResult, { readonly kind: "envelope" }>["envelope"];

/** The source identity an outage carries, so the notice names what did not answer. */
type UnavailableSource = Extract<DraftResult, { readonly kind: "unavailable" }>["unavailable"]["source"];

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The level a notice occupies when it stands in for the editor, so every answer from this route still states one `h1`. */
const NOTICE_HEADING_LEVEL = 1;

/** The page column a notice stands in, which `./editor-surface` states for the editor too, so a notice occupies the place the editor would. */
const ROOT_CLASS = "flex min-w-0 flex-col gap-6 text-start";

/** A refusal: the condition, and nothing about what may or may not exist, because the answer is identical either way. */
const DENIED_TITLE = "This edition is not available in this session";
const DENIED_DESCRIPTION = "This session may not write this edition in the context it is working in, so no title, revision, placement or release " + "is stated here. A refusal is not an edition with nothing written.";

/** An outage: the source did not answer, which is neither an empty draft nor a hidden one. */
const UNAVAILABLE_TITLE = "This edition could not be read";
const UNAVAILABLE_FALLBACK = "The records behind this edition could not be read, so no editor, revision or placement is shown in their place. Retry " + "the same read: an outage is never presented as an empty draft.";

/** A refused request, which this route states rather than throws because it calls the read directly. */
const REFUSED_TITLE = "This editor's address was refused";
const REFUSED_REQUEST_DESCRIPTION = "The request this editor would make is not one the read admits, so nothing was read and nothing is written. Open the " + "Update from its list and choose the edition again.";

/**
 * The address names an edition of a Page. A Page's editions are composed in the Page builder, where their sections, their
 * locale editions and their one give placement are stated, so presenting one under this route's wording would describe an
 * axis the document does not have.
 */
const NOT_AN_UPDATE_DESCRIPTION = "The edition this address names belongs to a Page rather than an Update, so it is composed from the Page builder, where " + "its sections and its locale editions are stated. Nothing is rendered here in its place.";

/**
 * The address pairs an edition with a document that does not hold it: two opaque identities that resolve separately but
 * not together, so this route opens neither in place of the pair.
 */
const UNPAIRED_ADDRESS_DESCRIPTION = "The edition this address names belongs to a different document, so the pair is not one this route can open. Open the " + "Update from its list and choose the edition from the editions it holds.";

// ---------------------------------------------------------------------------------------------
// The honest answers this route renders in place of the editor
// ---------------------------------------------------------------------------------------------

function deniedNotice(reasonCode: DenialReason): ReactElement {
  return <StateNotice kind="denied" headingLevel={NOTICE_HEADING_LEVEL} title={DENIED_TITLE} description={DENIED_DESCRIPTION} reasonCode={reasonCode} />;
}

function unavailableNotice(source: UnavailableSource, guidance: string): ReactElement {
  const stated = guidance.trim();
  return <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title={UNAVAILABLE_TITLE} description={stated === "" ? UNAVAILABLE_FALLBACK : stated} source={source} />;
}

function refusedNotice(description: string): ReactElement {
  return <StateNotice kind="refused" headingLevel={NOTICE_HEADING_LEVEL} title={REFUSED_TITLE} description={description} />;
}

// ---------------------------------------------------------------------------------------------
// The envelope in the encoding a Client Component may receive
// ---------------------------------------------------------------------------------------------

/**
 * The envelope as the browser handler would have answered with. The read states a revision's creation instant as a
 * `Temporal.Instant`, and a Client Component accepts only plain values, so this hands over the exact bytes the transport
 * carries: the same facts the render already holds, re-encoded into nothing. `./editor-surface` receives the result.
 */
function wireFormOf(envelope: DraftEnvelope): DraftEnvelope {
  const wire: unknown = JSON.parse(JSON.stringify(envelope));
  return wire as DraftEnvelope;
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** The one editor of one Update edition: one read, one envelope, and an honest notice in place of the editor when the read answers with none. */
export default async function CommunicationVariantEditorPage({ params }: { params: Promise<{ updateId: string; variantId: string }> }): Promise<ReactElement> {
  const { updateId, variantId } = await params;
  // Both segments travel as the opaque identities they are: neither is parsed, case-folded, trimmed into parts, templated
  // into a path or logged. The edition is the only identifier this read resolves, and an identity it does not hold comes
  // back as the read's own denial rather than as a page that says "not found", so nothing here reveals what exists.
  const result = await reads.updates.readDraft({ variantId });
  switch (result.kind) {
    case "envelope": {
      const { data } = result.envelope;
      // Two comparisons on facts the read states, taken as a routing decision: the pair the address names either resolves
      // here or it does not. Neither comparison derives an identity nor carries authority, which stays with the read.
      if (data.document.family !== "update") {
        return <div className={ROOT_CLASS}>{refusedNotice(NOT_AN_UPDATE_DESCRIPTION)}</div>;
      }
      if (data.variant.documentId !== updateId) {
        return <div className={ROOT_CLASS}>{refusedNotice(UNPAIRED_ADDRESS_DESCRIPTION)}</div>;
      }
      return <EditorSurface updateId={updateId} envelope={wireFormOf(result.envelope)} />;
    }
    case "denied":
      // The closed reason code is the whole answer: no title, no revision, no placement and no hint that an edition exists.
      return <div className={ROOT_CLASS}>{deniedNotice(result.denied.reasonCode)}</div>;
    case "unavailable":
      // An outage is reported as one, never as an empty editor.
      return <div className={ROOT_CLASS}>{unavailableNotice(result.unavailable.source, result.unavailable.guidance)}</div>;
    case "refused":
      // This route calls the read directly, so a refusal is its own request's and is stated rather than blamed on the source.
      return <div className={ROOT_CLASS}>{refusedNotice(REFUSED_REQUEST_DESCRIPTION)}</div>;
    default:
      return assertNever(result, "Unhandled draft read result");
  }
}
