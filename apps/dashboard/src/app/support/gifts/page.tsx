import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import GiftsLedger from "@/features/support/components/gifts-ledger";
import { GIFTS_PARAM } from "@/features/support/gift-params";
import { reads } from "@/modules/data-service";
import { ROOT_FIELD_KEY } from "@/modules/data-service/outcome";
import type { PageWindow } from "@/modules/support/report";
import { supportQueryFromSearch } from "../../api/support/query";
import { PageColumn, PageHeading, ReadNotices, searchSuffixOf, wireFormOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gifts" };
const SUPPORT_HREF = "/support";
const LEDGER_HREF = "/support/gifts";
const FIRST_PAGE = 0;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_CAP = 200;
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
  firstPage: "Read the first page",
  lastPage: "Read the last page",
} as const;
type Problem = { readonly field: string; readonly message: string };
/** The problems a grammar refusal states, keyed by the field path its own issues carry, so a value the grammar cannot read is named by the parameter it was stated in. */
const problemsOfIssues = (issues: readonly { readonly path?: readonly PropertyKey[]; readonly message: string }[]): readonly Problem[] => issues.map((issue) => ({ field: issue.path === undefined || issue.path.length === 0 ? ROOT_FIELD_KEY : issue.path.map(String).join("."), message: issue.message }));
/** The problems a read's own refusal states, one entry per message the read keyed by one of its field paths. */ const problemsOfFields = (fields: Readonly<Record<string, readonly string[]>>): readonly Problem[] => Object.entries(fields).flatMap(([field, messages]) => messages.map((message) => ({ field, message })));
/** The problems as the one line a refusal notice shows: `field: message`, once per problem, in the order the refusal stated them. */ const problemTextOf = (problems: readonly Problem[]): string => problems.map((problem) => `${problem.field}: ${problem.message}`).join(" ");
/** The address's own parameters with the page a notice opens, so a way out of a page the result does not hold keeps the filters the reader stated. */ function hrefOfPage(stated: SearchParams, page: number): string {
  const params = new URLSearchParams(searchSuffixOf(stated));
  params.set(GIFTS_PARAM.page, String(page));
  return `${LEDGER_HREF}?${params.toString()}`;
}
/** The page window this route reads at: the index the address states, at the row counts the ledger itself offers — its default, or the cap when more was asked for — so the envelope this render seeds is the one the browser asks for next, and a pager that offers only those two counts never states a window the read did not serve. */
function windowOf(page: { readonly index?: number; readonly size?: number } | undefined): { readonly index: number; readonly size: number } {
  const size = page?.size;
  return { index: page?.index ?? FIRST_PAGE, size: size !== undefined && size >= PAGE_SIZE_CAP ? PAGE_SIZE_CAP : PAGE_SIZE_DEFAULT };
}
/** The page an address states and the result does not hold: the index it states, and how many pages the result it filtered does hold. A page beyond the last one is never answered with another page, because a page that is not the one asked for would be read as the one asked for. */
type AbsentPage = { readonly stated: number; readonly totalPages: number };
function absentPageOf(statedIndex: number | undefined, page: PageWindow | undefined): AbsentPage | undefined {
  // The first page of a result holding no rows exists and states the empty result, so only a page past the first one can be absent.
  if (statedIndex === undefined || statedIndex <= FIRST_PAGE || page === undefined) return undefined;
  return statedIndex >= page.totalPages ? { stated: statedIndex, totalPages: page.totalPages } : undefined;
}
/** What the notice states for a page the result does not hold, and the page that does exist for it to open. */ function absentPageNoticeOf(absent: AbsentPage, stated: SearchParams): { readonly description: string; readonly label: string; readonly href: string } {
  if (absent.totalPages === 0) return { description: `page: The address states page ${absent.stated}, and the filters it states match no row at all, so this result holds no page ${absent.stated}: an empty result is read on the first page.`, label: PAGE_COPY.firstPage, href: hrefOfPage(stated, FIRST_PAGE) };
  const pages = absent.totalPages === 1 ? "page" : "pages";
  return {
    description: `page: The address states page ${absent.stated}, and this result holds ${absent.totalPages} ${pages}, numbered from 0 to ${absent.totalPages - 1}. No other page is served in its place, because a page that is not the one asked for would be read as the one asked for.`,
    label: PAGE_COPY.lastPage,
    href: hrefOfPage(stated, absent.totalPages - 1),
  };
}
const noticeCopyOf = (ledgerHref: string, refusedBody: string | undefined): ReadNoticeCopy => ({
  headingLevel: 1,
  denied: { title: PAGE_COPY.denied.title, body: PAGE_COPY.denied.body, action: { label: PAGE_COPY.overview, href: SUPPORT_HREF } },
  unavailable: { title: PAGE_COPY.unavailable.title, action: { label: PAGE_COPY.retry, href: ledgerHref } },
  refused: { title: PAGE_COPY.refused.title, body: refusedBody, action: { label: PAGE_COPY.overview, href: SUPPORT_HREF } },
});
/** The gifts ledger: one read of the whole-dataset filter set the address states, and the family's own ledger seeded with it, so the browser neither requests figures this render already holds nor receives a value it could not have fetched itself. The address is judged by the transport's own grammar before any read runs, so a filter this route cannot apply is stated rather than dropped: whole-dataset figures under a filter that was never applied is the one thing a support surface must not show. */
export default async function GiftsLedgerPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const stated = await searchParams;
  const suffix = searchSuffixOf(stated);
  const judged = supportQueryFromSearch(new URLSearchParams(suffix));
  if (!judged.ok) {
    return (
      <PageColumn gap={4}>
        <StateNotice kind="refused" headingLevel={1} title={PAGE_COPY.refused.title} description={problemTextOf(problemsOfIssues(judged.error.issues))} action={{ label: PAGE_COPY.overview, href: SUPPORT_HREF }} />
      </PageColumn>
    );
  }
  const statedPage = judged.value.page;
  const result = await reads.support.readGifts({ ...judged.value, page: windowOf(statedPage) });
  if (result.kind !== "envelope") {
    const refusedBody = result.kind === "refused" ? problemTextOf(problemsOfFields(result.refused.fields)) : undefined;
    return (
      <PageColumn gap={4}>
        <ReadNotices failure={result} copy={noticeCopyOf(`${LEDGER_HREF}${suffix}`, refusedBody)} />
      </PageColumn>
    );
  }
  const { envelope } = result;
  const absent = absentPageOf(statedPage?.index, envelope.data.report.page);
  const absentNotice = absent === undefined ? undefined : absentPageNoticeOf(absent, stated);
  return (
    <PageColumn gap={6}>
      <PageHeading title={PAGE_COPY.title} />
      {absentNotice === undefined ? <GiftsLedger scope={envelope.scope} locale="en-GB" initialEnvelope={wireFormOf(envelope)} /> : <StateNotice kind="refused" headingLevel={2} title={PAGE_COPY.refused.title} description={absentNotice.description} action={{ label: absentNotice.label, href: absentNotice.href }} />}
    </PageColumn>
  );
}
