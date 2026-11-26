import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";
import { PageColumn, PageHeading, pageRefusalOf, wireFormOf, type ReadNoticeCopy, type ReadRefusal } from "../../../page-frame";
import EditorSurface, { PAGE_TITLE } from "./editor-surface";
export const metadata: Metadata = { title: "Edition" };
/** The level a notice nests at beneath the page's own title — the one the editor states above the revision it renders — so no refusal arm leaves a notice standing in for that heading. */ const NESTED_NOTICE_LEVEL = 2;
const DENIED_DESCRIPTION = "Your current session doesn’t have permission to edit this update edition in this ministry context.";
const UNAVAILABLE_TITLE = "Couldn’t load this edition";
const UNAVAILABLE_FALLBACK = "Couldn’t load the draft right now. Your saved work is safe — try again in a moment.";
const REFUSED_TITLE = "Couldn’t open this edition";
const REFUSED_REQUEST_DESCRIPTION = "That edition address isn’t valid. Open an update from your Updates list and choose an edition.";
const NOT_AN_UPDATE_DESCRIPTION = "That address belongs to a Ministry page rather than an Update. Edit it from Ministry pages instead.";
const UNPAIRED_ADDRESS_DESCRIPTION = "That edition doesn’t belong to this update. Return to Updates and select the edition again.";
/** The page's words for each arm of the one read it makes, so a refusal states what could not be read in the page's own terms under the page's own title. */
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: NESTED_NOTICE_LEVEL, denied: { title: "This edition isn’t available in this session", body: DENIED_DESCRIPTION }, unavailable: { title: UNAVAILABLE_TITLE }, refused: { title: REFUSED_TITLE, body: REFUSED_REQUEST_DESCRIPTION } };
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
