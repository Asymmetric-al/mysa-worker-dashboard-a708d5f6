/**
 * `/coaching/coach` — the coach's read-only portfolio (AAP 0.9.1, 0.10.1 Coaching, and the 0.7.1 "Read as a coach" job).
 *
 * **What this route is.** Composition, nothing else. One `reads.coach.readCoachPortfolio()` call resolves the
 * relationships the coach's grants actually admit, and the family's own surfaces render the listing and the
 * deliberate-acceptance step. No relationship is filtered, counted, ordered or authorised here, the paging the surface
 * starts on only opens the window a visit names, and no monetary, timing or cutoff value is stated or derived here.
 *
 * **Why the reads are called directly.** The session, the grant and the frozen cutoff are resolved from the
 * development-session cookie inside the service, so a Server Component calls it rather than fetching the
 * application's own handler; the family's surfaces keep their browser transport for the reads they own.
 *
 * **What this route never offers.** The coach identity holds exactly two writes in the whole application —
 * `acceptInvitation` and `leaveCoaching` — and this page exposes neither as a control of its own: no edit, comment,
 * assign, remind, complete, reopen, impersonate or export action belongs here. Departure is offered on the
 * relationship's own route, and acceptance is hosted by the shared step below rather than by a control written here.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";

import type { RecordListQueryState } from "@/components/record-list";
import StateNotice from "@/components/state-notice";
import CoachAcceptance from "@/features/coaching/components/coach-acceptance";
import CoachPortfolio from "@/features/coaching/components/coach-portfolio";
import type { SharingOutcomeSet } from "@/features/coaching/components/sharing-summary";
import { COACHING_COPY } from "@/features/coaching/copy";
import { assertNever } from "@/lib/result";
import { reads, type ReadAction } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** Everything the portfolio read can answer, taken from the read itself so a renamed arm fails to compile here. */
type PortfolioResult = Awaited<ReturnType<typeof reads.coach.readCoachPortfolio>>;

/** The one arm that carries data: the granted relationships, the authority they were read under and the actions they support. */
type PortfolioEnvelope = Extract<PortfolioResult, { readonly kind: "envelope" }>["envelope"];

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The page's title, from the family copy's own heading for this surface: this file states no workflow wording of its own. */
const PAGE_TITLE = COACHING_COPY.coachPortfolio.heading;

/** The document title, which the root layout's template extends with the application name. */
export const metadata: Metadata = { title: PAGE_TITLE };

/** The interface locale the composed surface is stated in. Direction inside the surface follows its own content, not this value. */
const INTERFACE_LOCALE = "en-GB";

/** This surface's own address, which a retry re-requests. */
const COACH_HREF = "/coaching/coach";

/** The coaching family's documented list window: a page of 25 rows by default, and the surface's own cap of 100 beside it. */
const DEFAULT_PAGE_SIZE = 25;

/** The first page of the surface's own paging, which is the window it opens on. */
const FIRST_PAGE = 1;

/** The two search parameters this route reads, so a visit can open the list on a page it names. */
const PAGE_PARAM = "page";

const PAGE_SIZE_PARAM = "pageSize";

/** The one read action that reports an invitation addressed to this coach and awaiting acceptance. */
const ACCEPT_INVITATION_ACTION = "acceptInvitation";

const RETRY_LABEL = "Try this read again";

/**
 * The four sharing outcomes this route's reads establish: none of them. The portfolio read reports granted
 * relationships and the acceptance action, and never delivery, identity verification or access, so the acceptance
 * step is handed `unknown` for each rather than a claim this route cannot support.
 */
const UNSTATED_OUTCOMES: SharingOutcomeSet = { delivery: "unknown", identityVerification: "unknown", acceptance: "unknown", access: "unknown" };

// ---------------------------------------------------------------------------------------------
// The window the surface opens on
// ---------------------------------------------------------------------------------------------

/** One search parameter's first value: a repeated parameter is read once, and no list is treated as a decision. */
function paramOf(searchParams: SearchParams, name: string): string | undefined {
  const value = searchParams[name];
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return undefined;
  const trimmed = first.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A stated page or row size, read as a whole number at or above the first page: anything else is the documented default rather than a silently clamped value. */
function wholeNumberFromFirst(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= FIRST_PAGE ? parsed : undefined;
}

/**
 * The list window this route hands the surface as its starting state. The read applies its own ordering and takes no
 * sort parameter, so no ordering is stated; the row size stays the family's own to clamp, and the surface keeps the
 * window it is given rather than the page re-deriving one.
 */
function initialQueryOf(searchParams: SearchParams): RecordListQueryState {
  return { sort: [], page: wholeNumberFromFirst(paramOf(searchParams, PAGE_PARAM)) ?? FIRST_PAGE, pageSize: wholeNumberFromFirst(paramOf(searchParams, PAGE_SIZE_PARAM)) ?? DEFAULT_PAGE_SIZE, columnVisibility: {} };
}

// ---------------------------------------------------------------------------------------------
// What the read says about acceptance
// ---------------------------------------------------------------------------------------------

/**
 * Whether the read itself reports an invitation addressed to this coach and awaiting acceptance. This decides only
 * which true statement the acceptance step can make — never whether a write is permitted, which the service
 * re-checks on submit.
 */
function invitationAwaits(actions: readonly ReadAction[]): boolean {
  return actions.some((action) => action.name === ACCEPT_INVITATION_ACTION && action.available);
}

// ---------------------------------------------------------------------------------------------
// The surfaces
// ---------------------------------------------------------------------------------------------

/** The one `<h1>` on this page. Every surface below opens its own card at level two, so the outline starts here. */
function PageHeading(): ReactElement {
  return <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>;
}

/** The portfolio as the read answered it, with the acceptance step in the one state this route's reads support. */
function GrantedPortfolio({ envelope, query }: { readonly envelope: PortfolioEnvelope; readonly query: RecordListQueryState }): ReactElement {
  return (
    <>
      <PageHeading />
      {/* The listing authorises before it enumerates, so a relationship this coach does not hold never reaches it; it re-reads the same read through the family's transport and formats every value itself. */}
      <CoachPortfolio initialQuery={query} scope={envelope.scope} locale={INTERFACE_LOCALE} />
      {/*
       * The deliberate-acceptance step states what this read can establish: that no invitation addressed to this
       * account is awaiting acceptance. When the read reports one awaiting, that invitation is named by the
       * relationship it belongs to — the recipient, organization, ministry, modules and duration the grant holds,
       * submitted against that single grant's revision — and the portfolio read reports none of those facts, so the
       * step stays absent rather than claiming there is no invitation. Its revision is the collection's own, which
       * an acceptance submitted here would present as the invitation's, so nothing is submitted while no invitation
       * is named.
       */}
      {invitationAwaits(envelope.actions) ? null : <CoachAcceptance invitation={null} outcomes={UNSTATED_OUTCOMES} scope={envelope.scope} expectedRevision={envelope.revision} />}
    </>
  );
}

/**
 * The page body for whatever the read answered, one arm per arm of its closed result set. A refusal is never shown as
 * an empty portfolio and an outage is never shown as zero.
 */
function bodyOf(result: PortfolioResult, query: RecordListQueryState): ReactElement {
  switch (result.kind) {
    case "envelope":
      return <GrantedPortfolio envelope={result.envelope} query={query} />;
    case "denied":
      // Authorisation precedes enumeration: the notice carries the read's own reason and nothing it withheld — no count, no identity, no ministry, no size and no hint that a relationship exists.
      return <StateNotice kind="denied" headingLevel={1} title={PAGE_TITLE} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      // The outage names the source that failed and offers the same read again; it is never rendered as a portfolio holding nothing.
      return <StateNotice kind="unavailable" headingLevel={1} title={PAGE_TITLE} description={COACHING_COPY.coachPortfolio.unavailable} source={result.unavailable.source} action={{ label: RETRY_LABEL, href: COACH_HREF }} />;
    case "refused":
      // This route calls the read with no argument at all, so a request-shaped refusal cannot arise from it; the arm is still stated like every other rather than thrown, and the source behind it did not fail.
      return <StateNotice kind="refused" headingLevel={1} title={PAGE_TITLE} />;
    default:
      return assertNever(result, "Unhandled coach portfolio read result");
  }
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

export interface CoachingCoachPageProps {
  readonly searchParams: Promise<SearchParams>;
}

/** The coach's read-only portfolio: one read, one snapshot, and the family's own surfaces rendering it. */
export default async function CoachingCoachPage({ searchParams }: CoachingCoachPageProps): Promise<ReactElement> {
  // Next 16 hands the search parameters as a promise, so the window is read before the read that fills it.
  const stated = await searchParams;
  const result = await reads.coach.readCoachPortfolio();
  return <div className="flex min-w-0 flex-col gap-6 text-start">{bodyOf(result, initialQueryOf(stated))}</div>;
}
