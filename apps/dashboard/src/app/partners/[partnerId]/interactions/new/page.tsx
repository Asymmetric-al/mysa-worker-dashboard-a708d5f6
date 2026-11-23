import Link from "next/link";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import InteractionForm from "@/features/partners/components/interaction-form";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY } from "@/features/partners/copy/states";
import { reads, type ReadAction } from "@/modules/data-service";
import { ReadNotices, type ReadNoticeCopy } from "../../../../page-frame";
const PARTNERS_PATH = "/partners";
const LOG_INTERACTION_ACTION = "logInteraction";
const SURFACE_COPY = SURFACE_STATE_COPY.interactions;
const RECORD_REFUSED_COPY = SURFACE_STATE_COPY["partner-detail"].refused;
const RETURN_LABEL = "Back to the record";
const NOTICE_CLASS = "flex min-w-0 flex-col gap-4 text-start";
const recordHref = (partnerId: string): string => `${PARTNERS_PATH}/${encodeURIComponent(partnerId)}`;
const formHref = (partnerId: string): string => `${recordHref(partnerId)}${"/interactions/new"}`;
const advertised = (actions: readonly ReadAction[], name: string): boolean => actions.some((action) => action.name === name && action.available);
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 1,
  denied: { title: SURFACE_COPY.denied.title, body: SURFACE_COPY.denied.body, action: { label: PARTNER_ACTION_LABELS.backToRoster, href: PARTNERS_PATH } },
  unavailable: { title: SURFACE_COPY.unavailable.title, body: SURFACE_COPY.unavailable.body },
  refused: { title: RECORD_REFUSED_COPY.title, body: RECORD_REFUSED_COPY.body, action: { label: PARTNER_ACTION_LABELS.backToRoster, href: PARTNERS_PATH } },
};
export const dynamic = "force-dynamic";
/** Everything that actually happened between the worker and one record: the entry itself, with the optional next task saved as a second change. */
export default async function NewInteractionPage({ params }: { readonly params: Promise<{ partnerId: string }> }): Promise<ReactElement> {
  const { partnerId } = await params;
  const result = await reads.partners.readPartner(partnerId);
  if (result.kind !== "envelope") return <ReadNotices failure={result} copy={{ ...NOTICE_COPY, unavailable: { ...NOTICE_COPY.unavailable, action: { label: PARTNER_ACTION_LABELS.retry, href: formHref(partnerId) } } }} className={NOTICE_CLASS} />;
  const { envelope } = result;
  const { partner } = envelope.data;
  const record = recordHref(partner.partnerId);
  if (!advertised(envelope.actions, LOG_INTERACTION_ACTION)) return <StateNotice kind="denied" headingLevel={1} title={SURFACE_COPY.denied.title} description={SURFACE_COPY.denied.body} action={{ label: RETURN_LABEL, href: record }} className={NOTICE_CLASS} />;
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">
          {"Log an interaction with"} <bdi>{partner.displayName}</bdi>
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {"What you record here is a contact that actually happened, with the day it happened or the precision you honestly have. A follow-up task is optional and is saved as a separate change with its own identity, so a task that fails never sends the interaction again."}
        </p>
      </div>
      <InteractionForm scope={envelope.scope} partnerId={partner.partnerId} expectedRevision={envelope.revision} subject={{ partnerId: partner.partnerId, kind: partner.kind, displayName: partner.displayName, source: envelope.source }} />
      <p className="min-w-0">
        <Link href={record} className="inline-flex min-h-6 items-center rounded-sm font-medium underline underline-offset-4">
          {RETURN_LABEL}
        </Link>
      </p>
    </div>
  );
}
