import type { Metadata } from "next";
import type { ReactElement } from "react";
import GiftsLedger from "@/features/support/components/gifts-ledger";
import { reads } from "@/modules/data-service";
import { paramOf, readPageOf, searchSuffixOf, wholeNumberOf, wireFormOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
import { GIFTS_PARAM, giftQueryOf, type GiftsPageInput } from "./gifts-query";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gifts" };
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_CAP = 200;
const FIRST_PAGE = 0;
const NO_ROWS = 0;
const PAGE_COPY = {
  title: "Received gifts",
  denied: {
    title: "The gifts ledger is not available in this context",
    body: "This session may not read received support in the context it is working in, so no row, count, " + "total or coverage is stated here — a refusal is not an empty ledger. Another context, if this " + "session holds one, can be chosen from the shell.",
  },
  unavailable: { title: "The gifts ledger could not be read" },
  refused: { title: "The gifts ledger's request was refused" },
  retry: "Try this read again",
  overview: "Read the support overview",
} as const;
function pageWindowOf(stated: SearchParams): GiftsPageInput {
  const size = wholeNumberOf(paramOf(stated, GIFTS_PARAM.pageSize));
  return { index: wholeNumberOf(paramOf(stated, GIFTS_PARAM.page)) ?? FIRST_PAGE, size: size === undefined || size <= NO_ROWS ? PAGE_SIZE_DEFAULT : size >= PAGE_SIZE_CAP ? PAGE_SIZE_CAP : PAGE_SIZE_DEFAULT };
}
const noticeCopyOf = (stated: SearchParams): ReadNoticeCopy => {
  const ledgerHref = `${"/support/gifts"}${searchSuffixOf(stated)}`;
  return {
    headingLevel: 1,
    denied: { title: PAGE_COPY.denied.title, body: PAGE_COPY.denied.body, action: { label: PAGE_COPY.overview, href: "/support" } },
    unavailable: { title: PAGE_COPY.unavailable.title, action: { label: PAGE_COPY.retry, href: ledgerHref } },
    refused: { title: PAGE_COPY.refused.title, action: { label: PAGE_COPY.retry, href: ledgerHref } },
  };
};
/** The gifts ledger: one read of the whole-dataset filter set the address states, and the family's own ledger seeded with it, so the browser neither requests figures this render already holds nor receives a value it could not have fetched itself. */
export default async function GiftsLedgerPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const stated = await searchParams;
  return readPageOf(
    () => reads.support.readGifts(giftQueryOf(stated, pageWindowOf(stated))),
    { notice: noticeCopyOf(stated), heading: { title: PAGE_COPY.title } },
    (answered) => <GiftsLedger scope={answered.envelope.scope} locale="en-GB" initialEnvelope={wireFormOf(answered.envelope)} />,
  );
}
