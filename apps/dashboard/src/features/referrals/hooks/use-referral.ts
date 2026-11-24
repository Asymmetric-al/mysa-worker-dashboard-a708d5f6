import { type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { useReadQuery } from "@/lib/read-transport";
import type { ReadEnvelope, ReadResult, Scope, reads } from "@/modules/data-service";
import { REFERRALS_ENDPOINT, fetchReferralRead } from "./use-referrals";
const referralDetailPath = (referralId: string): string => `${REFERRALS_ENDPOINT}?referralId=${encodeURIComponent(referralId)}`;
export type ReferralDetailData = Extract<Awaited<ReturnType<typeof reads.referrals.readReferral>>, { readonly kind: "envelope" }>["envelope"]["data"];
export type ReferralDetailEnvelope = ReadEnvelope<ReferralDetailData>;
export type ReferralDetailReadResult = ReadResult<ReferralDetailEnvelope>;
export type UseReferralOptions = { readonly scope: Scope; readonly referralId: string | null | undefined };
/** Reads one referral under `scope`, keyed by the scope segments and the cycle, and answers the read union unchanged — `envelope | denied | unavailable`, with the denial and the outage kept distinct …. */
export function useReferral({ scope, referralId }: UseReferralOptions): UseQueryResult<ReferralDetailReadResult, Error> {
  const requestedId = typeof referralId === "string" ? referralId : "";
  return useReadQuery({ key: scopeKey(scope), job: "referral", segment: [requestedId], read: () => fetchReferralRead<ReferralDetailData>(referralDetailPath(requestedId)), enabled: typeof referralId === "string" && referralId.trim().length > 0 });
}
