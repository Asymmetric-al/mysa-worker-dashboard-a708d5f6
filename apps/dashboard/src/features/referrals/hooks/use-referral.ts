import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, ReadResult, Scope, reads } from "@/modules/data-service";
import { REFERRALS_ENDPOINT, fetchReferralRead } from "./use-referrals";
// The address, and the one parameter that names a cycle on it
const REFERRAL_JOB = "referral";
const REFERRAL_ID_PARAM = "referralId";
const NO_REFERRAL = "";
function referralDetailPath(referralId: string): string {
  return `${REFERRALS_ENDPOINT}?${REFERRAL_ID_PARAM}=${encodeURIComponent(referralId)}`;
}
// What the service read answers, derived from its own signature
export type ReferralDetailData = Extract<Awaited<ReturnType<typeof reads.referrals.readReferral>>, { readonly kind: "envelope" }>["envelope"]["data"];
export type ReferralDetailEnvelope = ReadEnvelope<ReferralDetailData>;
export type ReferralDetailReadResult = ReadResult<ReferralDetailEnvelope>;
export type ReferralQueryKey = readonly [...ScopeKey, typeof REFERRAL_JOB, string];
export interface UseReferralOptions {
  readonly scope: Scope;
  /** The cycle's opaque identifier, taken from the route or from the list row that was opened. */
  readonly referralId: string | null | undefined;
}
/** Reads one referral under `scope`, keyed by the scope segments and the cycle, and answers the read union unchanged — `envelope | denied | unavailable`, with the denial and the outage kept distinct … */
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
