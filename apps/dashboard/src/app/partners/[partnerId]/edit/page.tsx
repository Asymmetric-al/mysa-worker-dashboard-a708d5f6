import Link from "next/link";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { buttonVariants } from "@/components/ui/button";
import PartnerEditForm from "@/features/partners/components/partner-edit-form";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY } from "@/features/partners/copy/states";
import { reads, type ReadAction } from "@/modules/data-service";
import { ReadNotices, type ReadNoticeCopy } from "../../../page-frame";
const ROSTER_HREF = "/partners";
const DETAIL_COPY = SURFACE_STATE_COPY["partner-detail"];
const RETURN_LABEL = "Return to this record";
const PAGE_COLUMN = "flex min-w-0 flex-col gap-6 text-start";
export const dynamic = "force-dynamic";
const recordHref = (partnerId: string): string => `${ROSTER_HREF}/${encodeURIComponent(partnerId)}`;
const editHref = (partnerId: string): string => `${recordHref(partnerId)}${"/edit"}`;
function editAdmission(actions: readonly ReadAction[]): { readonly admitted: boolean; readonly reason: string | null } {
  const action = actions.find((candidate) => candidate.name === "saveContactEdits");
  if (action === undefined || !action.available) {
    const reason = action?.reason?.trim();
    return { admitted: false, reason: reason === undefined || reason === "" ? null : reason };
  }
  return { admitted: true, reason: null };
}
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 1,
  denied: { title: DETAIL_COPY.denied.title, body: DETAIL_COPY.denied.body, action: { label: PARTNER_ACTION_LABELS.backToRoster, href: ROSTER_HREF } },
  unavailable: { title: DETAIL_COPY.unavailable.title, body: DETAIL_COPY.unavailable.body },
  refused: { title: DETAIL_COPY.refused.title, body: DETAIL_COPY.refused.body, action: { label: PARTNER_ACTION_LABELS.backToRoster, href: ROSTER_HREF } },
};
/** The permitted-field edit of one partner record, composed from the service's own read of that record. */
export default async function PartnerEditPage({ params }: { readonly params: Promise<{ partnerId: string }> }): Promise<ReactElement> {
  const { partnerId } = await params;
  const result = await reads.partners.readPartner(partnerId);
  if (result.kind !== "envelope") return <ReadNotices failure={result} copy={{ ...NOTICE_COPY, unavailable: { ...NOTICE_COPY.unavailable, action: { label: PARTNER_ACTION_LABELS.retry, href: editHref(partnerId) } } }} className={PAGE_COLUMN} />;
  const { envelope } = result;
  const admission = editAdmission(envelope.actions);
  if (!admission.admitted) return <StateNotice kind="denied" headingLevel={1} title={DETAIL_COPY.denied.title} description={admission.reason ?? DETAIL_COPY.denied.body} action={{ label: RETURN_LABEL, href: recordHref(partnerId) }} className={PAGE_COLUMN} />;
  const displayName = envelope.data.partner.displayName;
  return (
    <div className={PAGE_COLUMN}>
      <div className="flex min-w-0 flex-col gap-3">
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">
          {"Edit"} <bdi>{displayName}</bdi>
        </h1>
        <Link href={recordHref(partnerId)} className={`${buttonVariants({ variant: "outline", size: "sm" })} ${"min-h-target max-w-full self-start whitespace-normal"}`}>
          {RETURN_LABEL}
        </Link>
      </div>
      <PartnerEditForm partnerRef={partnerId} envelope={envelope} />
    </div>
  );
}
