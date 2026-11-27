import type { Metadata } from "next";
import type { ReactElement } from "react";
import { GiftDetail } from "@/features/support/components/gift-detail";
import { reads } from "@/modules/data-service";
import { invalid } from "@/modules/data-service/outcome";
import { READ_ATTEMPT } from "../../../api/read";
import { supportQueryFromSearch } from "../../../api/support/query";
import { pageRefusalOf, searchSuffixOf, wireFormOf, type ReadNoticeCopy, type SearchParams } from "../../../page-frame";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gift" };
const LEDGER_HREF = "/support/gifts";
const RETURN_LABEL = "Back to Gifts";
/** The title this route states above its own notice, in the words the record itself reads at once the ledger answers, so a refusal keeps a page-level heading rather than reading as a paragraph. */ const noticeCopyOf = (giftId: string, carried: string): ReadNoticeCopy => ({
  headingLevel: 1,
  denied: {
    title: "This gift isn’t available in this context",
    body: "Your current session doesn’t have permission to view gift records here.",
    action: { label: RETURN_LABEL, href: `${LEDGER_HREF}${carried}` },
  },
  unavailable: { title: "Couldn’t load this gift", action: { label: "Try again", href: `${"/support/gifts/"}${encodeURIComponent(giftId)}${carried}` } },
  refused: { title: "Couldn’t open this gift", action: { label: RETURN_LABEL, href: `${LEDGER_HREF}${carried}` } },
});
/** One gift or allocation: the ledger read for the address's filter set and the record the address names, rendered by the detail component, or the read's own refusal stated as `denied`, `unavailable` or `refused`. */
export default async function GiftDetailPage({ params, searchParams }: { readonly params: Promise<{ readonly giftId: string }>; readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const { giftId } = await params;
  const stated = await searchParams;
  const carried = searchSuffixOf(stated);
  const notice = noticeCopyOf(giftId, carried);
  const heading = { title: "Gift details" };
  const query = supportQueryFromSearch(new URLSearchParams(carried));
  if (!query.ok) {
    const refused = invalid({ operationId: READ_ATTEMPT, fields: query.error });
    const body = Object.values(refused.fields).flat().join(" ");
    return pageRefusalOf({ kind: "refused", refused }, { ...notice, refused: { ...notice.refused, body } }, 4, heading);
  }
  const result = await reads.support.readGifts({ ...query.value, record: giftId });
  if (result.kind !== "envelope") return pageRefusalOf(result, notice, 4, heading);
  return <GiftDetail scope={result.envelope.scope} giftId={giftId} locale="en-GB" initialEnvelope={wireFormOf(result.envelope)} />;
}
