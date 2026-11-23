import type { ReactElement } from "react";
import { ReferralDetail } from "@/features/referrals/components/referral-detail";
import { LIST_COPY } from "@/features/referrals/copy";
import { reads } from "@/modules/data-service";
import { ReadNotices, type ReadNoticeCopy } from "../../../page-frame";
export const dynamic = "force-dynamic";
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: 1, denied: { title: LIST_COPY.heading }, unavailable: { title: LIST_COPY.heading }, refused: { title: LIST_COPY.heading } };
/** One referral cycle: the introduction with its precision, the window resolved from that date, where the cycle stands now and whether the one continuation it can hold is on offer. */
export default async function ReferralDetailPage({ params }: { readonly params: Promise<{ readonly referralId: string }> }): Promise<ReactElement> {
  const { referralId } = await params;
  const result = await reads.referrals.readReferral(referralId);
  return result.kind === "envelope" ? <ReferralDetail scope={result.envelope.scope} referralId={referralId} layout="page" /> : <ReadNotices failure={result} copy={NOTICE_COPY} />;
}
