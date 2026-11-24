import type { Metadata } from "next";
import type { ReactElement } from "react";
import { GiftDetail } from "@/features/support/components/gift-detail";
import { reads } from "@/modules/data-service";
import { pageRefusalOf, searchSuffixOf, type ReadNoticeCopy, type SearchParams } from "../../../page-frame";
import { giftQueryOf, statedPageOf } from "../gifts-query";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gift" };
const LEDGER_HREF = "/support/gifts";
const RETURN_LABEL = "Back to the gifts ledger";
/** The title this route states above its own notice, in the words the record itself reads at once the ledger answers, so a refusal keeps a page-level heading rather than reading as a paragraph. */
const noticeCopyOf = (giftId: string, carried: string): ReadNoticeCopy => ({
  headingLevel: 1,
  denied: {
    title: "This gift is not shown in this context",
    body: "The gifts read was refused for the context this session is admitted to, before it enumerated anything. Nothing here states whether a gift carries that identifier, what such a gift would hold, who it is attributed to or how large it is, so a refusal is not an empty record.",
    action: { label: RETURN_LABEL, href: `${LEDGER_HREF}${carried}` },
  },
  unavailable: { title: "The gift could not be read", action: { label: "Read this gift again", href: `${"/support/gifts/"}${encodeURIComponent(giftId)}${carried}` } },
  refused: { title: "This gift's request was refused", action: { label: RETURN_LABEL, href: `${LEDGER_HREF}${carried}` } },
});
/** One gift or allocation: the ledger read for the address's filter set and the record the address names, rendered by the detail component, or the read's own refusal stated as `denied`, `unavailable` or `refused`. */
export default async function GiftDetailPage({ params, searchParams }: { readonly params: Promise<{ readonly giftId: string }>; readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const { giftId } = await params;
  const stated = await searchParams;
  const carried = searchSuffixOf(stated);
  const result = await reads.support.readGifts({ ...giftQueryOf(stated, statedPageOf(stated)), record: giftId });
  if (result.kind !== "envelope") return pageRefusalOf(result, noticeCopyOf(giftId, carried), 4, { title: "Gift record" });
  return <GiftDetail scope={result.envelope.scope} giftId={giftId} locale="en-GB" />;
}
