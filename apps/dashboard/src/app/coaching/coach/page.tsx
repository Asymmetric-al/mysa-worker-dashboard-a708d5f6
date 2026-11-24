import type { Metadata } from "next";
import type { ReactElement } from "react";
import type { RecordListQueryState } from "@/components/record-list";
import CoachAcceptance from "@/features/coaching/components/coach-acceptance";
import CoachPortfolio from "@/features/coaching/components/coach-portfolio";
import type { SharingOutcomeSet } from "@/features/coaching/components/sharing-summary";
import { COACHING_COPY } from "@/features/coaching/copy";
import { reads } from "@/modules/data-service";
import { PageColumn, PageHeading, ReadNotices, paramOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
type PortfolioResult = Awaited<ReturnType<typeof reads.coach.readCoachPortfolio>>;
type PortfolioEnvelope = Extract<PortfolioResult, { readonly kind: "envelope" }>["envelope"];
const PAGE_TITLE = COACHING_COPY.coachPortfolio.heading;
export const metadata: Metadata = { title: PAGE_TITLE };
const DEFAULT_PAGE_SIZE = 25;
const FIRST_PAGE = 1;
const UNSTATED_OUTCOMES: SharingOutcomeSet = { delivery: "unknown", identityVerification: "unknown", acceptance: "unknown", access: "unknown" };
// An invitation this page renders is one the read itself reports, so delivery is reached; the grant record carries no identity-verification fact before acceptance, so the page claims neither way; nothing is accepted yet; and nothing is readable yet.
const PENDING_OUTCOMES: SharingOutcomeSet = { delivery: "reached", identityVerification: "unknown", acceptance: "not-reached", access: "not-reached" };
function wholeNumberFromFirst(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= FIRST_PAGE ? parsed : undefined;
}
const initialQueryOf = (searchParams: SearchParams): RecordListQueryState => ({ sort: [], page: wholeNumberFromFirst(paramOf(searchParams, "page")) ?? FIRST_PAGE, pageSize: wholeNumberFromFirst(paramOf(searchParams, "pageSize")) ?? DEFAULT_PAGE_SIZE, columnVisibility: {} });
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: 1, denied: { title: PAGE_TITLE }, unavailable: { title: PAGE_TITLE, body: COACHING_COPY.coachPortfolio.unavailable, action: { label: "Try this read again", href: "/coaching/coach" } }, refused: { title: PAGE_TITLE } };
const GrantedPortfolio = ({ envelope, query }: { readonly envelope: PortfolioEnvelope; readonly query: RecordListQueryState }): ReactElement => {
  // Every invitation the read reports awaits this coach's own decision, so each is rendered with the facts it carries and against its own grant revision; the statement about a pending invitation is kept for the case where none awaits, because that is what the page says when there is nothing to accept. The portfolio card above still states the emptiness of what is shared.
  const { pendingInvitations } = envelope.data;
  return (
    <>
      <PageHeading title={PAGE_TITLE} />
      <CoachPortfolio initialQuery={query} scope={envelope.scope} locale="en-GB" />
      {pendingInvitations.length === 0 ? (
        <CoachAcceptance invitation={null} outcomes={UNSTATED_OUTCOMES} scope={envelope.scope} expectedRevision={envelope.revision} holdsNoSubjects={envelope.data.holdsNoSubjects} />
      ) : (
        pendingInvitations.map((invitation) => <CoachAcceptance key={invitation.grantId} invitation={invitation} outcomes={PENDING_OUTCOMES} scope={envelope.scope} expectedRevision={invitation.revision} holdsNoSubjects={envelope.data.holdsNoSubjects} />)
      )}
    </>
  );
};
const bodyOf = (result: PortfolioResult, query: RecordListQueryState): ReactElement => (result.kind === "envelope" ? <GrantedPortfolio envelope={result.envelope} query={query} /> : <ReadNotices failure={result} copy={NOTICE_COPY} />);
/** The coach's read-only portfolio: one read, one snapshot, and the family's own surfaces rendering it. */ export default async function CoachingCoachPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const stated = await searchParams;
  return <PageColumn>{bodyOf(await reads.coach.readCoachPortfolio(), initialQueryOf(stated))}</PageColumn>;
}
