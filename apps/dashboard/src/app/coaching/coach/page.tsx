import type { Metadata } from "next";
import type { ReactElement } from "react";
import type { RecordListQueryState } from "@/components/record-list";
import CoachAcceptance from "@/features/coaching/components/coach-acceptance";
import CoachPortfolio from "@/features/coaching/components/coach-portfolio";
import type { SharingOutcomeSet } from "@/features/coaching/components/sharing-summary";
import { COACHING_COPY } from "@/features/coaching/copy";
import { reads, type ReadAction } from "@/modules/data-service";
import { PageColumn, PageHeading, ReadNotices, paramOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
type PortfolioResult = Awaited<ReturnType<typeof reads.coach.readCoachPortfolio>>;
type PortfolioEnvelope = Extract<PortfolioResult, { readonly kind: "envelope" }>["envelope"];
const PAGE_TITLE = COACHING_COPY.coachPortfolio.heading;
export const metadata: Metadata = { title: PAGE_TITLE };
const DEFAULT_PAGE_SIZE = 25;
const FIRST_PAGE = 1;
const PAGE_PARAM = "page";
const PAGE_SIZE_PARAM = "pageSize";
const UNSTATED_OUTCOMES: SharingOutcomeSet = { delivery: "unknown", identityVerification: "unknown", acceptance: "unknown", access: "unknown" };
function wholeNumberFromFirst(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= FIRST_PAGE ? parsed : undefined;
}
const initialQueryOf = (searchParams: SearchParams): RecordListQueryState => ({ sort: [], page: wholeNumberFromFirst(paramOf(searchParams, PAGE_PARAM)) ?? FIRST_PAGE, pageSize: wholeNumberFromFirst(paramOf(searchParams, PAGE_SIZE_PARAM)) ?? DEFAULT_PAGE_SIZE, columnVisibility: {} });
const invitationAwaits = (actions: readonly ReadAction[]): boolean => actions.some((action) => action.name === "acceptInvitation" && action.available);
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: 1, denied: { title: PAGE_TITLE }, unavailable: { title: PAGE_TITLE, body: COACHING_COPY.coachPortfolio.unavailable, action: { label: "Try this read again", href: "/coaching/coach" } }, refused: { title: PAGE_TITLE } };
const GrantedPortfolio = ({ envelope, query }: { readonly envelope: PortfolioEnvelope; readonly query: RecordListQueryState }): ReactElement => {
  // One fact is stated once: when the portfolio card's own notice already says that nothing is shared, the page does not repeat it, and the read's holdsNoSubjects flag decides which surface states it. The acceptance block is therefore rendered only where relationships exist and no invitation awaits, and it is handed the same flag so its own copy can never claim an emptiness the read did not report.
  const showsNoInvitationNotice = !invitationAwaits(envelope.actions) && !envelope.data.holdsNoSubjects;
  return (
    <>
      <PageHeading title={PAGE_TITLE} />
      <CoachPortfolio initialQuery={query} scope={envelope.scope} locale="en-GB" />
      {showsNoInvitationNotice ? <CoachAcceptance invitation={null} outcomes={UNSTATED_OUTCOMES} scope={envelope.scope} expectedRevision={envelope.revision} holdsNoSubjects={envelope.data.holdsNoSubjects} /> : null}
    </>
  );
};
const bodyOf = (result: PortfolioResult, query: RecordListQueryState): ReactElement => (result.kind === "envelope" ? <GrantedPortfolio envelope={result.envelope} query={query} /> : <ReadNotices failure={result} copy={NOTICE_COPY} />);
/** The coach's read-only portfolio: one read, one snapshot, and the family's own surfaces rendering it. */
export default async function CoachingCoachPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const stated = await searchParams;
  const result = await reads.coach.readCoachPortfolio();
  return <PageColumn>{bodyOf(result, initialQueryOf(stated))}</PageColumn>;
}
