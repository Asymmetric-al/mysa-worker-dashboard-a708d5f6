import type { ReactElement } from "react";
import InitiativeList from "@/features/initiatives/components/initiative-list";
import { initiativesReadQuery, parseInitiativesQuery } from "@/features/initiatives/query/initiatives-query";
import { querySearchParamsOf } from "@/lib/query-params";
import { reads } from "@/modules/data-service";
import { ReadNotices, searchSuffixOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
export const dynamic = "force-dynamic";
/** This surface's own address, so a retry re-reads the view the reader was in rather than dropping it. */
const LIST_HREF = "/partners/initiatives";
/** This route's own wording for the three answers that are not the list. Not one of them states a count, a name, a working list or a size. */
const PAGE_COPY = {
  denied: { title: "Initiatives are not available in this context", body: "This session may not read initiatives in the context it is working in, so no initiative, working list or count is stated here — a refusal is not an empty list. Another context, if this session holds one, can be chosen from the shell." },
  unavailable: { title: "The initiative list could not be read", retry: "Try this read again" },
  refused: { title: "The initiative list's request was refused", body: "The address states a view the initiative read does not admit, so nothing was read and the source behind the list did not fail. State a view it admits and ask again." },
} as const;
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: 1, denied: { title: PAGE_COPY.denied.title, body: PAGE_COPY.denied.body }, unavailable: { title: PAGE_COPY.unavailable.title }, refused: { title: PAGE_COPY.refused.title, body: PAGE_COPY.refused.body } };
/** The initiative list: one whole-query read of the initiatives the admitted ministry permits, filtered, ordered and paged by the read itself, rendered by the family's own list body. */
export default async function InitiativesPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const stated = await searchParams;
  const query = initiativesReadQuery(parseInitiativesQuery(querySearchParamsOf(stated))); // The address is parsed by the one grammar the list surface writes its own address with, and the read is asked for exactly the view it describes.
  const result = await reads.outreach.readInitiatives(query);
  if (result.kind !== "envelope") return <ReadNotices failure={result} copy={{ ...NOTICE_COPY, unavailable: { ...NOTICE_COPY.unavailable, action: { label: PAGE_COPY.unavailable.retry, href: `${LIST_HREF}${searchSuffixOf(stated)}` } } }} />;
  return <InitiativeList initialEnvelope={result} headingLevel={1} />;
}
