/** `/partners/[partnerId]` — one partner's record, composed from the service's own reads into the application's single detail body. */
import Link from "next/link";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { buttonVariants } from "@/components/ui/button";
import PartnerDetailSections, { type PartnerDetailLinks, type PartnerReadResult } from "@/features/partners/components/partner-detail-sections";
import PrivateNoteComposer from "@/features/partners/components/private-note-composer";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY } from "@/features/partners/copy/states";
import { reads, type ReadAction, type ReadEnvelope, type ReadResult } from "@/modules/data-service";
const ROSTER_HREF = "/partners";
const WORK_PATH = "/work";
const EDIT_SUFFIX = "/edit";
const NEW_INTERACTION_SUFFIX = "/interactions/new";
const ROSTER_CRUMB_LABEL = "Partners";
const EDIT_LABEL = "Edit permitted fields";
const DETAIL_COPY = SURFACE_STATE_COPY["partner-detail"];
const INTERFACE_LOCALE = "en-GB";
/** Props of {@link PartnerDetailPage}. */
export interface PartnerDetailPageProps {
  readonly params: Promise<{ partnerId: string }>;
}
/** A record belongs to one session's context, so no rendered page may be cached across a context switch or a restriction. */
export const dynamic = "force-dynamic";
function detailRead<Data, Shown>(result: ReadResult<ReadEnvelope<Data>>, select: (data: Data) => Shown): PartnerReadResult<Shown> {
  switch (result.kind) {
    case "envelope":
      return { kind: "read", envelope: { ...result.envelope, data: select(result.envelope.data) } };
    case "denied":
      // The closed reason code is the whole answer a refusal carries: no record, count, title or size travels with it, so nothing here can hint at what the caller may not read.
      return { kind: "denied", reasonCode: result.denied.reasonCode };
    case "unavailable":
      return { kind: "unavailable", source: result.unavailable.source };
    case "refused":
      // The identifier this record was asked for is not one the partner read admits: each section states the refusal in its own words rather than reporting the partner source as down.
      return { kind: "refused", fields: result.refused.fields };
  }
}
function admitted(actions: readonly ReadAction[], name: string): boolean {
  return actions.some((action) => action.name === name && action.available);
}
/** The address of one record's own destination, from its opaque identifier and never from its details. */
function partnerHref(partnerId: string, suffix: string): string {
  return `${ROSTER_HREF}/${encodeURIComponent(partnerId)}${suffix}`;
}
function workHref(partnerId: string): string {
  return `${WORK_PATH}?partnerId=${encodeURIComponent(partnerId)}`;
}
interface RecordActionsProps {
  readonly partnerId: string;
  readonly contactEditsAdmitted: boolean;
  readonly logInteractionAdmitted: boolean;
  readonly createTaskAdmitted: boolean;
}
function RecordActions({ partnerId, contactEditsAdmitted, logInteractionAdmitted, createTaskAdmitted }: RecordActionsProps): ReactElement | null {
  const actionClass = buttonVariants({ variant: "outline" });
  const actions: ReactElement[] = [];
  if (contactEditsAdmitted) {
    actions.push(
      <Link key="contact-edits" className={actionClass} href={partnerHref(partnerId, EDIT_SUFFIX)}>
        {EDIT_LABEL}
      </Link>,
    );
  }
  if (logInteractionAdmitted) {
    actions.push(
      <Link key="log-interaction" className={actionClass} href={partnerHref(partnerId, NEW_INTERACTION_SUFFIX)}>
        {PARTNER_ACTION_LABELS.logInteraction}
      </Link>,
    );
  }
  if (createTaskAdmitted) {
    actions.push(
      <Link key="create-task" className={actionClass} href={workHref(partnerId)}>
        {PARTNER_ACTION_LABELS.createFollowUpTask}
      </Link>,
    );
  }
  return actions.length === 0 ? null : <>{actions}</>;
}
/** One partner's record: identity, permitted contact methods, restrictions, relationship context, real activity, private notes, open work and authorised support history. */
export default async function PartnerDetailPage({ params }: PartnerDetailPageProps): Promise<ReactElement> {
  const { partnerId } = await params;
  // The organisation, ministry, support subject and principal are derived by the service from this session. The route supplies the record's opaque identifier and nothing that could invent authority.
  const result = await reads.partners.readPartner(partnerId);
  if (result.kind === "denied") {
    return (
      <div className="flex min-w-0 flex-col gap-4 text-start">
        {/* A refusal shows no part of a record. The shell owns the context switch, so the recovery this
            route can offer is the roster the reader came from. */}
        <StateNotice kind="denied" headingLevel={1} title={DETAIL_COPY.denied.title} description={DETAIL_COPY.denied.body} reasonCode={result.denied.reasonCode} action={{ label: PARTNER_ACTION_LABELS.backToRoster, href: ROSTER_HREF }} />
      </div>
    );
  }
  if (result.kind === "unavailable") {
    return (
      <div className="flex min-w-0 flex-col gap-4 text-start">
        {/* The source behind this record did not answer, so the record is reported as unavailable and
            never as an empty one. Retrying re-requests this same read. */}
        <StateNotice kind="unavailable" headingLevel={1} title={DETAIL_COPY.unavailable.title} description={DETAIL_COPY.unavailable.body} source={result.unavailable.source} action={{ label: PARTNER_ACTION_LABELS.retry, href: partnerHref(partnerId, "") }} />
      </div>
    );
  }
  if (result.kind === "refused") {
    // The record this address names is not one the read admits, so nothing was read and the partner source did not fail. The refusal the route would have rendered is stated here instead of thrown.
    return (
      <div className="flex min-w-0 flex-col gap-4 text-start">
        <StateNotice kind="refused" headingLevel={1} title={DETAIL_COPY.refused.title} description={DETAIL_COPY.refused.body} action={{ label: PARTNER_ACTION_LABELS.backToRoster, href: ROSTER_HREF }} />
      </div>
    );
  }
  const { envelope } = result;
  const contactEditsAdmitted = admitted(envelope.actions, "saveContactEdits");
  const logInteractionAdmitted = admitted(envelope.actions, "logInteraction");
  const privateNoteAdmitted = admitted(envelope.actions, "savePrivateNote");
  const createTaskAdmitted = admitted(envelope.actions, "createTask");
  // The two further reads are issued only for the sections this record admits, and each arrives in the body's own vocabulary: a source that fails here costs its section, never the whole record.
  const interactions = logInteractionAdmitted ? await reads.interactions.readInteractions({ partnerId }) : null;
  const privatePreparation = privateNoteAdmitted ? await reads.partners.readPrivatePreparation({ partnerId }) : null;
  const links: PartnerDetailLinks = { ...(logInteractionAdmitted ? { logInteraction: partnerHref(partnerId, NEW_INTERACTION_SUFFIX) } : {}), ...(createTaskAdmitted ? { createTask: workHref(partnerId) } : {}), addPreparation: ROSTER_HREF };
  return (
    <PartnerDetailSections
      partner={detailRead(result, (data) => data)}
      layout="page"
      locale={INTERFACE_LOCALE}
      breadcrumb={[{ label: ROSTER_CRUMB_LABEL, href: ROSTER_HREF }]}
      links={links}
      actions={{
        bar: <RecordActions partnerId={partnerId} contactEditsAdmitted={contactEditsAdmitted} logInteractionAdmitted={logInteractionAdmitted} createTaskAdmitted={createTaskAdmitted} />,
        // The note composer is placed only for a record whose read admits `savePrivateNote`, and it is
        // handed the revision this page read, which its receipt then reports as the revision the record
        // now holds.
        ...(privateNoteAdmitted ? { privateNote: <PrivateNoteComposer scope={envelope.scope} partnerId={partnerId} expectedRevision={envelope.revision} /> } : {}),
      }}
      {...(interactions === null ? {} : { interactions: detailRead(interactions, (page) => page.interactions) })}
      {...(privatePreparation === null ? {} : { privatePreparation: detailRead(privatePreparation, (data) => data) })}
    />
  );
}
