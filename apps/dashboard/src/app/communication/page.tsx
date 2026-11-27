import type { Metadata } from "next";
import type { ReactElement } from "react";
import UpdatesList from "@/features/updates/components/updates-list";
import { rosterOf } from "@/features/updates/roster";
import { reads } from "@/modules/data-service";
import { ReadNotices, paramOf, wireFormOf, type ReadNoticeCopy, type SearchParams } from "../page-frame";
export const metadata: Metadata = { title: "Updates" };
type RosterRead = typeof reads.updates.findContentDocuments;
const UPDATE_FAMILY = ["update"] as const;
const PAGE_HEADING_LEVEL = 1;
const PAGE_COPY = {
  denied: {
    title: "Updates aren’t available in this ministry context",
    description: "Your current session doesn’t have permission to view updates here. Switch ministry context from the sidebar if you have access to another one.",
  },
  unavailable: { title: "Couldn’t load Updates", retry: "Try again" },
  refused: {
    title: "Couldn’t load Updates",
    description: "The page parameters weren’t accepted. Return to Updates to start from page 1.",
  },
} as const;
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: PAGE_HEADING_LEVEL,
  denied: { title: PAGE_COPY.denied.title, body: PAGE_COPY.denied.description },
  unavailable: { title: PAGE_COPY.unavailable.title, action: { label: PAGE_COPY.unavailable.retry, href: "/communication" } },
  refused: { title: PAGE_COPY.refused.title, body: PAGE_COPY.refused.description },
};
const RosterNotice = ({ result }: { readonly result: Exclude<Awaited<ReturnType<RosterRead>>, { readonly kind: "envelope" }> }): ReactElement => <ReadNotices failure={result} copy={NOTICE_COPY} />;
/** The first page of the roster, stated rather than left out because the read answers a page only where one is named: without it the answer would be the whole collection, and the surface would be handed every row of it — the client-side window this route exists to remove. */ const FIRST_PAGE = 1;
/** The two parameters this route forwards: the paging window the read declares, and nothing besides them. */ const PARAM = { page: "page", pageSize: "pageSize" } as const;
/** The query the roster read accepts, in the read's own vocabulary. The surface keeps its page window in the address, so the window read here is the one the surface opens on: the page and row size the address states are what the server paints, and no second request replaces them. Nothing is defaulted, clamped, validated or dropped here — the service derives the window (a page below the first is the first page; the size is the documented 50 with its 200 cap) and owns the whole-result counts beside these rows. */
function rosterQueryOf(searchParams: SearchParams): NonNullable<Parameters<RosterRead>[0]> {
  const page = paramOf(searchParams, PARAM.page);
  const pageSize = paramOf(searchParams, PARAM.pageSize);
  return { families: UPDATE_FAMILY, ...(page === undefined ? { page: FIRST_PAGE } : { page: Number(page) }), ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }) };
}
/** The route's props: the address a reader followed, whose window is the one the surface opens on. */ export interface CommunicationPageProps {
  readonly searchParams: Promise<SearchParams>;
}
/** The Ministry Updates roster: one page under the session's own scope, and the arm its result names. */ export default async function CommunicationPage({ searchParams }: CommunicationPageProps): Promise<ReactElement> {
  const result = await reads.updates.findContentDocuments(rosterQueryOf(await searchParams));
  if (result.kind !== "envelope") return <RosterNotice result={result} />;
  return <UpdatesList roster={rosterOf(result.envelope)} initialResult={{ kind: "envelope", envelope: wireFormOf(result.envelope) }} headingLevel={PAGE_HEADING_LEVEL} />;
}
