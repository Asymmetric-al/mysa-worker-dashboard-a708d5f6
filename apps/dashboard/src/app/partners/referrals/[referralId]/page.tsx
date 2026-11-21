/** `/partners/referrals/[referralId]` — one referral cycle, read once on the server and presented entirely by the referral family's detail body. */
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { ReferralDetail } from "@/features/referrals/components/referral-detail";
import { LIST_COPY } from "@/features/referrals/copy";
import { reads } from "@/modules/data-service";

/** Props of {@link ReferralDetailPage}: Next 16 hands a route its segment parameters as a promise, so they are awaited before any read. */
export type ReferralDetailPageProps = { readonly params: Promise<{ readonly referralId: string }> };

/**
 * The read resolves the development session and the scenario clock per request, so no rendered cycle may be
 * cached: a restriction, a persona change or a context switch has to change the answer this address gives.
 */
export const dynamic = "force-dynamic";

/**
 * One referral cycle: the introduction with its precision, the window resolved from that date, where the cycle
 * stands now and whether the one continuation it can hold is on offer. The route supplies the opaque identifier
 * and nothing that could invent authority — scope is derived by the service from this session, and every
 * window, deadline and permission arrives resolved in the envelope.
 */
export default async function ReferralDetailPage({ params }: ReferralDetailPageProps): Promise<ReactElement> {
  const { referralId } = await params;
  const result = await reads.referrals.readReferral(referralId);
  switch (result.kind) {
    case "envelope":
      // The body re-reads this cycle under the scope it was answered with, so the page passes no record of its own.
      return <ReferralDetail scope={result.envelope.scope} referralId={referralId} layout="page" />;
    case "denied":
      // A refusal states no count, title, date or existence flag, so it reads the same whether or not a cycle holds this identifier.
      return <StateNotice kind="denied" title={LIST_COPY.heading} headingLevel={1} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      // The source did not answer: the cycle is unavailable rather than absent, empty or zero, and the outcome names what failed.
      return <StateNotice kind="unavailable" title={LIST_COPY.heading} headingLevel={1} description={result.unavailable.guidance} source={result.unavailable.source} />;
    case "refused":
      // This route's own request was refused, so nothing was read and no source failed.
      return <StateNotice kind="refused" title={LIST_COPY.heading} headingLevel={1} />;
  }
}
