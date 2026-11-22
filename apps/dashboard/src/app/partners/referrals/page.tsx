/**
 * `/partners/referrals` — the referral lists (AAP 0.9.1; AAP 0.10.1 family "Referrals"; AAP 0.7.1 job "Act on an
 * introduction"): the Active list, the introductions whose date is not precise enough to carry a deadline, and the
 * narrow permitted Expired history.
 *
 * **What this file is.** Composition, nothing else: one read of the authorised list under the query the address
 * states, and the referral family's own list surface over the scope that read ran in. Every referral rule — the
 * New-window resolution, the Active or Expired judgement, the daylight-saving resolution, the narrow Expired
 * projection and the continuation arithmetic — is computed by `reads.referrals.readReferrals` from the scenario
 * clock and arrives already resolved in the envelope, so no date, deadline or permission is derived here.
 *
 * **Why the read happens here at all.** The family's list reads the same service again from the browser, and it is
 * handed the scope this read ran under rather than a scope taken from the address: scope is the authority every
 * later read and change is re-checked against. Reading once here also means a denial or an outage is stated before
 * any row exists, instead of being discovered by the browser after the page has claimed a list.
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
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      {/* The one h1 on this route: the family's own name for the surface, with the list's view heading one level below it. */}
      <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{LIST_COPY.heading}</h1>
      {/* The list reads the same service from the browser under the scope this read ran in — never a scope parsed from the address. */}
      <ReferralList scope={result.envelope.scope} />
    </div>
  );
}
