import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";
import { PageColumn, PageHeading, pageRefusalOf, wireFormOf, type ReadNoticeCopy, type ReadRefusal } from "../../../page-frame";
import EditorSurface, { PAGE_TITLE } from "./editor-surface";
export const metadata: Metadata = { title: "Edition" };
/** The level a notice nests at beneath the page's own title — the one the editor states above the revision it renders — so no refusal arm leaves a notice standing in for that heading. */ const NESTED_NOTICE_LEVEL = 2;
const DENIED_DESCRIPTION = "This session may not write this edition in the context it is working in, so no title, revision, placement or release " + "is stated here. A refusal is not an edition with nothing written.";
const UNAVAILABLE_TITLE = "This edition could not be read";
const UNAVAILABLE_FALLBACK = "The records behind this edition could not be read, so no editor, revision or placement is shown in their place. Retry " + "the same read: an outage is never presented as an empty draft.";
const REFUSED_TITLE = "This editor's address was refused";
const REFUSED_REQUEST_DESCRIPTION = "The request this editor would make is not one the read admits, so nothing was read and nothing is written. Open the " + "Update from its list and choose the edition again.";
const NOT_AN_UPDATE_DESCRIPTION = "The edition this address names belongs to a Page rather than an Update, so it is composed from the Page builder, where " + "its sections and its locale editions are stated. Nothing is rendered here in its place.";
const UNPAIRED_ADDRESS_DESCRIPTION = "The edition this address names belongs to a different document, so the pair is not one this route can open. Open the " + "Update from its list and choose the edition from the editions it holds.";
/** The page's words for each arm of the one read it makes, so a refusal states what could not be read in the page's own terms under the page's own title. */
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: NESTED_NOTICE_LEVEL, denied: { title: "This edition is not available in this session", body: DENIED_DESCRIPTION }, unavailable: { title: UNAVAILABLE_TITLE }, refused: { title: REFUSED_TITLE, body: REFUSED_REQUEST_DESCRIPTION } };
/** An outage behind this edition, stated under the page's own title: the service's guidance is the sentence unless it stated none, and the page's own words stand in only then. */ function unavailableRefusal(result: ReadRefusal, guidance: string): ReactElement {
  const stated = guidance.trim();
  return pageRefusalOf(result, stated === "" ? { ...NOTICE_COPY, unavailable: { title: UNAVAILABLE_TITLE, body: UNAVAILABLE_FALLBACK } } : NOTICE_COPY, 6, { title: PAGE_TITLE });
}
/** A request this route does not serve — an edition of another family, or one this address does not pair — stated under the page's own title rather than as a heading of its own, because the route keeps one heading and states the refusal beneath it. */ const routeRefusal = (description: string): ReactElement => (
  <PageColumn>
    <PageHeading title={PAGE_TITLE} />
    <StateNotice kind="refused" headingLevel={NESTED_NOTICE_LEVEL} title={REFUSED_TITLE} description={description} />
  </PageColumn>
);
/** The one editor of one Update edition: one read, one envelope, and an honest notice in place of the editor when the read answers with none. */ export default async function CommunicationVariantEditorPage({ params }: { params: Promise<{ updateId: string; variantId: string }> }): Promise<ReactElement> {
  const { updateId, variantId } = await params;
  const result = await reads.updates.readDraft({ variantId });
  switch (result.kind) {
    case "envelope": {
      const { data } = result.envelope;
      if (data.document.family !== "update") return routeRefusal(NOT_AN_UPDATE_DESCRIPTION);
      if (data.variant.documentId !== updateId) return routeRefusal(UNPAIRED_ADDRESS_DESCRIPTION);
      return <EditorSurface updateId={updateId} envelope={wireFormOf(result.envelope)} />;
    }
    case "denied":
      return pageRefusalOf(result, NOTICE_COPY, 6, { title: PAGE_TITLE });
    case "unavailable":
      return unavailableRefusal(result, result.unavailable.guidance);
    case "refused":
      return pageRefusalOf(result, NOTICE_COPY, 6, { title: PAGE_TITLE });
    default:
      return assertNever(result, "Unhandled draft read result");
  }
}
