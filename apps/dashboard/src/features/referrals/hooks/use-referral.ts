/**
 * The single-referral read a detail view opens: one cycle with the introduction it records, the window
 * the service resolved from that date, the disclosure that sits beside the resolved instant, where it
 * stands now, and the advisory actions available on it.
 *
 * Scope: AAP 0.9.1 `features/referrals/**`, AAP 0.11.1 "referral lists, detail and Continue", and the
 * named inventory row of AAP 0.6.1 / 0.7.1 "Act on an introduction" — the read `readReferral`, served to
 * the browser from `GET /api/referrals` (AAP 0.6.3), which carries both this family's lists and this one
 * cycle, discriminated by a single query parameter. This is the second of the folder's three hook files:
 * the detail read beside the list read and the two writes, sharing the one GET transport that
 * `use-referrals.ts` already owns so the read contract is parsed exactly once.
 *
 * Consumed by `features/referrals/components/referral-detail.tsx` in all three presentations of the
 * shared record-detail body — the direct route, the desktop side panel and the phone sheet — so one
 * hook serves every way a referral is opened.
 *
 * No client-boundary directive, deliberately: the component that consumes this hook declares that
 * boundary. Server Components never use it — `app/partners/referrals/[referralId]/page.tsx` calls
 * `reads.referrals.readReferral` directly, because no server path may fetch the application's own HTTP
 * endpoint to read the same source.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, ReadResult, Scope, reads } from "@/modules/data-service";
import { REFERRALS_ENDPOINT, fetchReferralRead } from "./use-referrals";
// The address, and the one parameter that names a cycle on it
/** The job this read is cached under, beside the scope segments and the cycle it names. */
const REFERRAL_JOB = "referral";
/**
 * The one query parameter `GET /api/referrals` reads a single cycle by. The route serves `readReferrals`
 * and `readReferral` on one address, so a detail is discriminated by this parameter rather than by a
 * path of its own, and the parameter name here is the route contract stated once.
 */
const REFERRAL_ID_PARAM = "referralId";
/**
 * What a read nobody asked for is keyed by. A detail with no identifier stays idle, so this value is
 * never requested and never cached as a referral: an empty segment is a key with nothing under it, not
 * another cycle's answer.
 */
const NO_REFERRAL = "";
/** The detail address of one cycle: the family's one endpoint, and the cycle's identifier encoded rather than interpolated raw. */
function referralDetailPath(referralId: string): string {
  return `${REFERRALS_ENDPOINT}?${REFERRAL_ID_PARAM}=${encodeURIComponent(referralId)}`;
}
// What the service read answers, derived from its own signature
/**
 * The one cycle as the read built it: the full detail, or the narrow permitted Expired projection the
 * service answers a closed cycle with. The service index does not re-export this payload type and no
 * referral shape may be restated here, so it is taken from `readReferral`'s own result — which is what
 * keeps the narrow projection and the full detail from drifting from the service's union.
 */
export type ReferralDetailData = Extract<Awaited<ReturnType<typeof reads.referrals.readReferral>>, { readonly kind: "envelope" }>["envelope"]["data"];
/** The scoped envelope a detail view renders once it has narrowed the result to `envelope`. */
export type ReferralDetailEnvelope = ReadEnvelope<ReferralDetailData>;
/** What this read answers for one cycle: that envelope, the denial it was given, or an unavailable source. */
export type ReferralDetailReadResult = ReadResult<ReferralDetailEnvelope>;
/** The exact cache key of one cycle's read in one context: the scope segments, the job, and the cycle. */
export type ReferralQueryKey = readonly [...ScopeKey, typeof REFERRAL_JOB, string];
/** What a caller supplies to read one referral. */
export interface UseReferralOptions {
  readonly scope: Scope;
  /**
   * The cycle's opaque identifier, taken from the route or from the list row that was opened. It is
   * never derived from a display name, an email address, a postal address or a source reference: equal
   * looking values establish neither identity nor authority, so only the identifier the service issued
   * may name a record. It is passed through unread — never parsed, split or read for meaning.
   */
  readonly referralId: string | null | undefined;
}
/**
 * Reads one referral under `scope`, keyed by the scope segments and the cycle, and answers the read
 * union unchanged — `envelope | denied | unavailable`, with the denial and the outage kept distinct so
 * a refusal can never be rendered as an empty record.
 */
export function useReferral({ scope, referralId }: UseReferralOptions): UseQueryResult<ReferralDetailReadResult, Error> {
  const requestedId = typeof referralId === "string" ? referralId : NO_REFERRAL;
  return useQuery<ReferralDetailReadResult, Error>({
    // The scope leads every key, so the context switch's fence clears this entry with the rest of the
    // previous context and no envelope can be served from another context's cache. A different cycle is
    // a different entry, so one record's introduction date, window or facts are never shown under
    // another record's route. No placeholder data is carried here for that same reason: a detail that
    // kept the previous answer while the next landed would render one referral's facts under the
    // heading of a referral it is not, which the list read may do and a record read must not.
    queryKey: [...scopeKey(scope), REFERRAL_JOB, requestedId],
    queryFn: () => fetchReferralRead<ReferralDetailData>(referralDetailPath(requestedId)),
    // A detail with no identifier invents nothing: the query stays idle, so no request is sent and no
    // cycle — and no list read standing in for one — is cached under an unnamed key. A blank identifier
    // is the same absence stated differently, and it is refused here rather than sent, because the route
    // reads a blank identifier as no cycle at all and would answer with a list this hook cannot place.
    enabled: typeof referralId === "string" && referralId.trim().length > 0,
    // One open issues exactly one request, and a source that is down reaches the honest `unavailable`
    // answer instead of being retried into repeated loads of the same outage.
    retry: false,
  });
}
