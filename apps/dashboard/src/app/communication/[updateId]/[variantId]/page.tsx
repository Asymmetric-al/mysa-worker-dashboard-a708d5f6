import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";
import { wireFormOf } from "../../../page-frame";
import EditorSurface from "./editor-surface";
type DraftResult = Awaited<ReturnType<typeof reads.updates.readDraft>>;
type UnavailableSource = Extract<DraftResult, { readonly kind: "unavailable" }>["unavailable"]["source"];
const NOTICE_HEADING_LEVEL = 1;
const ROOT_CLASS = "flex min-w-0 flex-col gap-6 text-start";
const DENIED_DESCRIPTION = "This session may not write this edition in the context it is working in, so no title, revision, placement or release " + "is stated here. A refusal is not an edition with nothing written.";
const UNAVAILABLE_FALLBACK = "The records behind this edition could not be read, so no editor, revision or placement is shown in their place. Retry " + "the same read: an outage is never presented as an empty draft.";
const REFUSED_REQUEST_DESCRIPTION = "The request this editor would make is not one the read admits, so nothing was read and nothing is written. Open the " + "Update from its list and choose the edition again.";
const NOT_AN_UPDATE_DESCRIPTION = "The edition this address names belongs to a Page rather than an Update, so it is composed from the Page builder, where " + "its sections and its locale editions are stated. Nothing is rendered here in its place.";
const UNPAIRED_ADDRESS_DESCRIPTION = "The edition this address names belongs to a different document, so the pair is not one this route can open. Open the " + "Update from its list and choose the edition from the editions it holds.";
function unavailableNotice(source: UnavailableSource, guidance: string): ReactElement {
  const stated = guidance.trim();
  return <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title="This edition could not be read" description={stated === "" ? UNAVAILABLE_FALLBACK : stated} source={source} />;
}
const refusedNotice = (description: string): ReactElement => <StateNotice kind="refused" headingLevel={NOTICE_HEADING_LEVEL} title="This editor's address was refused" description={description} />;
/** The one editor of one Update edition: one read, one envelope, and an honest notice in place of the editor when the read answers with none. */
export default async function CommunicationVariantEditorPage({ params }: { params: Promise<{ updateId: string; variantId: string }> }): Promise<ReactElement> {
  const { updateId, variantId } = await params;
  const result = await reads.updates.readDraft({ variantId });
  switch (result.kind) {
    case "envelope": {
      const { data } = result.envelope;
      if (data.document.family !== "update") return <div className={ROOT_CLASS}>{refusedNotice(NOT_AN_UPDATE_DESCRIPTION)}</div>;
      if (data.variant.documentId !== updateId) return <div className={ROOT_CLASS}>{refusedNotice(UNPAIRED_ADDRESS_DESCRIPTION)}</div>;
      return <EditorSurface updateId={updateId} envelope={wireFormOf(result.envelope)} />;
    }
    case "denied":
      return <StateNotice kind="denied" headingLevel={NOTICE_HEADING_LEVEL} title="This edition is not available in this session" description={DENIED_DESCRIPTION} reasonCode={result.denied.reasonCode} className={ROOT_CLASS} />;
    case "unavailable":
      return <div className={ROOT_CLASS}>{unavailableNotice(result.unavailable.source, result.unavailable.guidance)}</div>;
    case "refused":
      return <div className={ROOT_CLASS}>{refusedNotice(REFUSED_REQUEST_DESCRIPTION)}</div>;
    default:
      return assertNever(result, "Unhandled draft read result");
  }
}
