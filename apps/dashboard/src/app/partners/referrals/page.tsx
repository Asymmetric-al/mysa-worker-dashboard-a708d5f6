/**
 * `/partners/referrals` — the referral lists (AAP 0.9.1; AAP 0.10.1 family "Referrals"; AAP 0.7.1 job "Act on an
 * introduction"): the Active list, the introductions whose date is not precise enough to carry a deadline, and the
 * narrow permitted Expired history.
 *
 * **What this file is.** Composition, nothing else: one read of the authorised list under the query the address
 * states, the referral family's own list surface over the scope that read ran in, and the introduction composer below it,
 * over the eligible-partner set this page composes and the revision the list read answered. Every referral rule — the
 * New-window resolution, the Active or Expired judgement, the daylight-saving resolution, the narrow Expired
 * projection and the continuation arithmetic — is computed by `reads.referrals.readReferrals` from the scenario
 * clock and arrives already resolved in the envelope, so no date, deadline or permission is derived here.
 *
 * **Why the read happens here at all.** The family's list re-reads the same service from the browser for every later
 * view, and it is handed the scope this read ran under rather than a scope taken from the address: scope is the
 * authority every later read and change is re-checked against. Reading once here also means a denial or an outage is
 * stated before any row exists, instead of being discovered by the browser after the page has claimed a list — and the
 * answer travels to the surface as its seed, so the rows and the whole-result count this read stated are what the first
 * paint states, with no identical read repeated on mount.
 *
 * **Why the roster is read here too.** An introduction names the partner it happened with, so the composer has to be
 * offered a partner to choose, and the partner roster is the one read whose job is to enumerate those. It is composed
 * here, exactly as the initiative detail composes the set its working-list picker offers: whole, or an honest statement
 * that no set could be enumerated.
 *
 * **Read in process, never over HTTP.** A Server Component must not reach the application's own route handler, so
 * the read is called directly; `GET /api/referrals` stays the browser's transport for that same read.
 *
 * **Every arm is honest.** A denial states its closed reason code and no count, name or size; an outage states the
 * source that could not be read and is never shown as an empty list or a zero; a refused request says that this
 * view's own request was refused while the source answered. The genuine empty list, like the searched-empty one,
 * belongs to the family's own surface, so no notice here stands in for one — and the shell owns the single `main`
 * landmark and the persistent Development data label, so neither is repeated.
 *
 * **Freshness.** `dynamic = "force-dynamic"`: the read resolves the session, the selected context and the scenario
 * instant per request, so a cached render would answer for a context or an instant that has moved.
 */
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import { ReferralIntroductionComposer, type ReferralIntroductionCandidates } from "@/features/referrals/components/referral-introduction-composer";
import { ReferralList } from "@/features/referrals/components/referral-list";
import { LIST_COPY } from "@/features/referrals/copy";
import { DEFAULT_REFERRAL_PAGE_SIZE, DEFAULT_REFERRAL_VIEW, parseReferralListQuery, type ReferralListQuery } from "@/features/referrals/schemas";
import { reads } from "@/modules/data-service";

/** The read resolves the session, the selected context and the scenario instant per request, so nothing on this route may be cached across a context switch or a persona change. */
export const dynamic = "force-dynamic";

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

/** What the referral list read answers: the scoped envelope, or the refusal that stood in its place. */
type ReferralListReadResult = Awaited<ReturnType<typeof reads.referrals.readReferrals>>;

/** A read that never became a list: a denial, an outage or a refused request. */
type FailedReferralListRead = Exclude<ReferralListReadResult, { readonly kind: "envelope" }>;

/** The page the family's read counts from: the read slices from `(page - 1) * pageSize`, so pages start at one. */
const FIRST_PAGE = 1;

/**
 * The query an address this surface cannot honour is read with: the family's default list, its default page size
 * and the first page. A refused address never invents a view out of the parts that parsed, and the family's own
 * surface reads exactly this query in the same situation, so the server render and the browser read agree on the
 * view being shown.
 */
const DEFAULT_LIST_QUERY: ReferralListQuery = { list: DEFAULT_REFERRAL_VIEW, search: "", page: FIRST_PAGE, pageSize: DEFAULT_REFERRAL_PAGE_SIZE };

// ---------------------------------------------------------------------------------------------
// The eligible-partner set the introduction composer offers
// ---------------------------------------------------------------------------------------------

/** The partner roster's first page. This read counts pages from zero, so the first page is page `0`. */
const CANDIDATE_PAGE_INDEX = 0;

/** The roster's documented page ceiling (AAP 0.8.7): the most one read returns, so the most this page can enumerate. */
const CANDIDATE_PAGE_SIZE = 200;

/**
 * The answer this page gives the introduction composer when it cannot hand it a whole eligible set.
 *
 * It names the composition itself as the source, exactly as the initiative detail does when no read supplies a candidate
 * set at all. A partial set is never passed off as the eligible set: a partner left out of it would be a partner the
 * surface silently could not record an introduction against.
 */
const CANDIDATES_UNCOMPOSED: ReferralIntroductionCandidates = { state: "unavailable", source: { system: "page-composition", reference: "eligible-partner-candidates" } };

/**
 * The eligible-partner set this page composes for the introduction composer.
 *
 * An introduction names the partner it happened with, so the composer needs the whole set it may offer, and the partner
 * roster is the one read whose job is to enumerate readable partners. A worker-private preparation record is a different
 * record class from a shared relationship — the service refuses one as the subject of a referral — so the private records
 * a readable roster also carries are left out here rather than offered and then refused.
 *
 * The set is passed whole or not at all: a roster larger than one page is not enumerable here, so the composer is told it
 * holds no answer instead of being handed the first page as though it were the set.
 */
async function introductionCandidatesOf(): Promise<ReferralIntroductionCandidates> {
  const roster = await reads.partners.findPartners({ page: { index: CANDIDATE_PAGE_INDEX, size: CANDIDATE_PAGE_SIZE } });
  if (roster.kind === "unavailable") {
    // The source did not answer, so its own identity and guidance travel to the composer's notice: never an empty
    // partner set and never a count of zero.
    return { state: "unavailable", source: roster.unavailable.source };
  }
  if (roster.kind !== "envelope") {
    // A denied or refused roster read reveals nothing about any partner, so the composer is told it has no answer rather
    // than being handed an empty set that would read as "no partner may be recorded against".
    return CANDIDATES_UNCOMPOSED;
  }
  const { rows, total } = roster.envelope.data;
  if (rows.length < total) {
    return CANDIDATES_UNCOMPOSED;
  }
  return { state: "available", partners: rows.filter((row) => row.partner.audience === "shared").map((row) => ({ partnerId: row.partner.partnerId, displayName: row.partner.displayName })) };
}

/**
 * The notice a read that never became a list is stated with: the page's one heading, and the reason this arm is
 * true of — a closed reason code, the source that could not be read, or the request itself. None of them states a
 * count, a name, a window or a size, and none of them stands in for an empty list.
 */
function ReferralListNotice({ failure }: { readonly failure: FailedReferralListRead }): ReactElement {
  switch (failure.kind) {
    case "denied":
      // A refusal reads the same whether or not a referral exists in the scope this session may not read.
      return <StateNotice kind="denied" headingLevel={1} title={LIST_COPY.heading} reasonCode={failure.denied.reasonCode} />;
    case "unavailable":
      // The source did not answer, so the lists are unavailable rather than empty or zero, and the outcome names the source, its guidance and the remedy.
      return <StateNotice kind="unavailable" headingLevel={1} title={LIST_COPY.heading} description={failure.unavailable.guidance} source={failure.unavailable.source} />;
    case "refused":
      // This route's own request was refused, so nothing was read and no source failed.
      return <StateNotice kind="refused" headingLevel={1} title={LIST_COPY.heading} />;
  }
}

/** What this route receives: Next 16 hands `searchParams` as a promise, resolved before any read. */
export interface ReferralsPageProps {
  readonly searchParams: Promise<SearchParams>;
}

/**
 * The referral lists: the Active list, the incomplete-date list and the permitted Expired history, read once under
 * the query the address states and rendered by the family's own surface. The three lists answer three different
 * questions and are never one filtered list; the view switch, the search and the page live in the address, which is
 * what lets a detail visit return to the same list in the same state.
 */
export default async function ReferralsPage({ searchParams }: ReferralsPageProps): Promise<ReactElement> {
  const stated = await searchParams;
  // One grammar parses this address here and in the family's browser read, so the query state, the 50-row default
  // and the 200-row ceiling exist once. A request that names no list opens on Active through that parser's own
  // `DEFAULT_REFERRAL_VIEW` rather than through a default decided a second time in this file.
  const parsed = parseReferralListQuery(stated);
  const query: ReferralListQuery = parsed.ok ? parsed.query : DEFAULT_LIST_QUERY;
  // Act on an introduction — the job this route serves: the whole authorised result, narrowed, ordered and paged by
  // the read itself, which also states the whole-result total beside the rows of this one page.
  const result = await reads.referrals.readReferrals(query);
  if (result.kind !== "envelope") {
    return (
      <div className="flex min-w-0 flex-col gap-4 text-start">
        <ReferralListNotice failure={result} />
      </div>
    );
  }
  // The composer needs a partner to offer, so this read is made only once the list itself was readable: a refusal costs
  // no further read.
  const candidates = await introductionCandidatesOf();
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      {/* The one h1 on this route: the family's own name for the surface, with the list's view heading one level below it. */}
      <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{LIST_COPY.heading}</h1>
      {/* The list reads the same service from the browser under the scope this read ran in — never a scope parsed from the
          address — and is seeded with this read's own answer, so the first paint states these rows and this whole-result
          count rather than a loading notice. */}
      <ReferralList scope={result.envelope.scope} initialResult={result} />
      {/* The one control that records an introduction, below the lists it fills. It presents the revision this view read
          (AAP 0.7.1), so a collection that changed since is answered as a conflict rather than overwritten. */}
      <ReferralIntroductionComposer scope={result.envelope.scope} expectedRevision={result.envelope.revision} candidates={candidates} />
    </div>
  );
}
