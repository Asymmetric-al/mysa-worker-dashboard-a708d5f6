import type { Metadata } from "next";
import type { ReactElement } from "react";
import { ReferralIntroductionComposer, type ReferralIntroductionCandidates } from "@/features/referrals/components/referral-introduction-composer";
import { ReferralList } from "@/features/referrals/components/referral-list";
import { LIST_COPY } from "@/features/referrals/copy";
import { DEFAULT_REFERRAL_PAGE_SIZE, DEFAULT_REFERRAL_VIEW, parseReferralListQuery, type ReferralListQuery } from "@/features/referrals/schemas";
import { reads } from "@/modules/data-service";
import { PageColumn, PageHeading, pageRefusalOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: LIST_COPY.heading };
const FIRST_PAGE = 1;
const DEFAULT_LIST_QUERY: ReferralListQuery = { list: DEFAULT_REFERRAL_VIEW, search: "", page: FIRST_PAGE, pageSize: DEFAULT_REFERRAL_PAGE_SIZE };
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: 1, denied: { title: LIST_COPY.heading }, unavailable: { title: LIST_COPY.heading }, refused: { title: LIST_COPY.heading } };
/** The partner roster's first page. This read counts pages from zero, so the first page is page `0`. */ const CANDIDATE_PAGE_INDEX = 0;
/** The roster's documented page ceiling (AAP 0.8.7): the most one read returns, so the most this page can enumerate. */ const CANDIDATE_PAGE_SIZE = 200;
/** The answer this page gives the introduction composer when it cannot hand it a whole eligible set: it names the composition itself as the source, exactly as the initiative detail does when no read supplies a candidate set at all. A partial set is never passed off as the eligible set: a partner left out of it would be a partner the surface silently could not record an introduction against. */
const CANDIDATES_UNCOMPOSED: ReferralIntroductionCandidates = { state: "unavailable", source: { system: "page-composition", reference: "eligible-partner-candidates" } };
/** The introduction composer starts with the first page of readable shared partners and can search or page through the rest. */
async function introductionCandidatesOf(): Promise<ReferralIntroductionCandidates> {
  const roster = await reads.partners.findPartners({ applied: { "preparation-state": ["shared"] }, page: { index: CANDIDATE_PAGE_INDEX, size: CANDIDATE_PAGE_SIZE } });
  // The source did not answer, so its own identity travels to the composer's notice: never an empty partner set and never a count of zero. A denied or refused roster read reveals nothing about any partner, so the composer is told it has no answer rather than being handed an empty set that would read as "no partner may be recorded against".
  if (roster.kind === "unavailable") return { state: "unavailable", source: roster.unavailable.source };
  if (roster.kind !== "envelope") return CANDIDATES_UNCOMPOSED;
  const { rows, total } = roster.envelope.data;
  const partners = rows.filter((row) => row.partner.audience === "shared").map((row) => ({ partnerId: row.partner.partnerId, displayName: row.partner.displayName }));
  return { state: "available", partners, total, paged: rows.length < total };
}
/** The referral lists: the three lists answer three different questions and are never one filtered list, and the view switch, the search and the page live in the address, which is what lets a detail visit return to the same list in the same state. */
export default async function ReferralsPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const parsed = parseReferralListQuery(await searchParams);
  const result = await reads.referrals.readReferrals(parsed.ok ? parsed.query : DEFAULT_LIST_QUERY);
  if (result.kind !== "envelope") return pageRefusalOf(result, NOTICE_COPY, 4, { title: LIST_COPY.heading });
  const candidates = await introductionCandidatesOf(); // The composer needs a partner to offer, so this read is made only once the list itself was readable: a refusal costs no further read.
  return (
    <PageColumn gap={4}>
      <PageHeading title={LIST_COPY.heading} />
      {/* The list re-reads the same service from the browser under the scope this read ran in — never a scope parsed from the address — and is seeded with this read's own answer, so the first paint states these rows and this whole-result count rather than a loading notice. */}
      <ReferralList scope={result.envelope.scope} initialResult={result} />
      {/* The one control that records an introduction, below the lists it fills. It presents the revision this view read (AAP 0.7.1), so a collection that changed since is answered as a conflict rather than overwritten. */}
      <ReferralIntroductionComposer scope={result.envelope.scope} expectedRevision={result.envelope.revision} candidates={candidates} />
    </PageColumn>
  );
}
