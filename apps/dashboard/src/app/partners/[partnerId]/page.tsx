import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { buttonVariants } from "@/components/ui/button";
import PartnerDetailSections, { type PartnerDetailLinks, type PartnerReadResult } from "@/features/partners/components/partner-detail-sections";
import { PartnerFilingSurface, PartnerPreparationSurface } from "@/features/partners/components/partner-record-actions";
import PrivateNoteComposer from "@/features/partners/components/private-note-composer";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY } from "@/features/partners/copy/states";
import ReferralIntroductionForm from "@/features/referrals/components/referral-introduction-form";
import { reads, type ReadAction, type ReadEnvelope, type ReadResult } from "@/modules/data-service";
import { pageRefusalOf, type ReadNoticeCopy } from "../../page-frame";
const ROSTER_HREF = "/partners";
/** The action a record states when an introduction may be recorded against it. */
const RECORD_INTRODUCTION_ACTION = "recordIntroduction";
const EDIT_SUFFIX = "/edit";
const NEW_INTERACTION_SUFFIX = "/interactions/new";
const DETAIL_COPY = SURFACE_STATE_COPY["partner-detail"];
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Partner" };
function detailRead<Data, Shown>(result: ReadResult<ReadEnvelope<Data>>, select: (data: Data) => Shown): PartnerReadResult<Shown> {
  switch (result.kind) {
    case "envelope":
      return { kind: "read", envelope: { ...result.envelope, data: select(result.envelope.data) } };
    case "denied":
      return { kind: "denied", reasonCode: result.denied.reasonCode };
    case "unavailable":
      return { kind: "unavailable", source: result.unavailable.source };
    case "refused":
      return { kind: "refused", fields: result.refused.fields };
  }
}
const admitted = (actions: readonly ReadAction[], name: string): boolean => actions.some((action) => action.name === name && action.available);
const partnerHref = (partnerId: string, suffix: string): string => `${ROSTER_HREF}/${encodeURIComponent(partnerId)}${suffix}`;
const workHref = (partnerId: string): string => `${"/work"}?partnerId=${encodeURIComponent(partnerId)}`;
type RecordActionsProps = { readonly partnerId: string; readonly contactEditsAdmitted: boolean; readonly logInteractionAdmitted: boolean; readonly createTaskAdmitted: boolean };
function RecordActions({ partnerId, contactEditsAdmitted, logInteractionAdmitted, createTaskAdmitted }: RecordActionsProps): ReactElement | null {
  const actionClass = buttonVariants({ variant: "outline" });
  const actions: ReactElement[] = [];
  if (contactEditsAdmitted) {
    actions.push(
      <Link key="contact-edits" data-slot="button" className={actionClass} href={partnerHref(partnerId, EDIT_SUFFIX)}>
        {"Edit permitted fields"}
      </Link>,
    );
  }
  if (logInteractionAdmitted) {
    actions.push(
      <Link key="log-interaction" data-slot="button" className={actionClass} href={partnerHref(partnerId, NEW_INTERACTION_SUFFIX)}>
        {PARTNER_ACTION_LABELS.logInteraction}
      </Link>,
    );
  }
  if (createTaskAdmitted) {
    actions.push(
      <Link key="create-task" data-slot="button" className={actionClass} href={workHref(partnerId)}>
        {PARTNER_ACTION_LABELS.createFollowUpTask}
      </Link>,
    );
  }
  return actions.length === 0 ? null : <>{actions}</>;
}
const noticeCopyOf = (partnerId: string): ReadNoticeCopy => ({
  headingLevel: 1,
  denied: { title: DETAIL_COPY.denied.title, body: DETAIL_COPY.denied.body, action: { label: PARTNER_ACTION_LABELS.backToRoster, href: ROSTER_HREF } },
  unavailable: { title: DETAIL_COPY.unavailable.title, body: DETAIL_COPY.unavailable.body, action: { label: PARTNER_ACTION_LABELS.retry, href: partnerHref(partnerId, "") } },
  refused: { title: DETAIL_COPY.refused.title, body: DETAIL_COPY.refused.body, action: { label: PARTNER_ACTION_LABELS.backToRoster, href: ROSTER_HREF } },
});
/** One partner's record: identity, permitted contact methods, restrictions, relationship context, real activity, private notes, open work and authorised support history. */
export default async function PartnerDetailPage({ params }: { readonly params: Promise<{ partnerId: string }> }): Promise<ReactElement> {
  const { partnerId } = await params;
  const result = await reads.partners.readPartner(partnerId);
  if (result.kind !== "envelope") return pageRefusalOf(result, noticeCopyOf(partnerId), 4);
  const { envelope } = result;
  const contactEditsAdmitted = admitted(envelope.actions, "saveContactEdits");
  const logInteractionAdmitted = admitted(envelope.actions, "logInteraction");
  const privateNoteAdmitted = admitted(envelope.actions, "savePrivateNote");
  const createTaskAdmitted = admitted(envelope.actions, "createTask");
  const filingAdmitted = admitted(envelope.actions, "setTag") && admitted(envelope.actions, "setFavourite"); // Personal tags and the favourite mark are one filing surface, so it is mounted only where the read admits both halves of it.
  const recordIntroductionAdmitted = admitted(envelope.actions, RECORD_INTRODUCTION_ACTION);
  const interactions = logInteractionAdmitted ? await reads.interactions.readInteractions({ partnerId }) : null; // The two further reads are issued only for the sections this record admits, and each arrives in the body's own vocabulary: a source that fails here costs its section, never the whole record.
  const privatePreparation = privateNoteAdmitted ? await reads.partners.readPrivatePreparation({ partnerId }) : null;
  const facets = filingAdmitted ? await reads.partners.readFacets() : null; // The vocabulary the record is filed against is the roster's own tag facet, read only where the record admits filing: a facet read that refuses or does not answer costs the suggestions, never the record.
  const tagSuggestions = facets !== null && facets.kind === "envelope" ? (facets.envelope.data.find((facet) => facet.id === "tag")?.options.map((option) => option.label) ?? []) : [];
  const { partner } = envelope.data;
  // Archive and restore are the worker's own preparation's lifecycle, so they are offered only where the private read answered with that record: every other record carries no such control.
  const preparation = privatePreparation !== null && privatePreparation.kind === "envelope" ? privatePreparation.envelope.data.preparation : undefined;
  const links: PartnerDetailLinks = { ...(logInteractionAdmitted ? { logInteraction: partnerHref(partnerId, NEW_INTERACTION_SUFFIX) } : {}), ...(createTaskAdmitted ? { createTask: workHref(partnerId) } : {}), addPreparation: ROSTER_HREF };
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <PartnerDetailSections
        partner={detailRead(result, (data) => data)}
        layout="page"
        locale="en-GB"
        breadcrumb={[{ label: "Partners", href: ROSTER_HREF }]}
        links={links}
        actions={{
          bar: <RecordActions partnerId={partnerId} contactEditsAdmitted={contactEditsAdmitted} logInteractionAdmitted={logInteractionAdmitted} createTaskAdmitted={createTaskAdmitted} />,
          ...(privateNoteAdmitted ? { privateNote: <PrivateNoteComposer scope={envelope.scope} partnerId={partnerId} expectedRevision={envelope.revision} /> } : {}),
          // The record files under the worker's own labels in the body it already opens, so the roster's tag and favourite facets filter values a control on the record can set.
          ...(filingAdmitted ? { filing: <PartnerFilingSurface scope={envelope.scope} target={{ partnerRef: { partnerId, expectedRevision: envelope.revision, displayName: partner.displayName, tags: partner.tags, favourite: partner.favourite } }} tagSuggestions={tagSuggestions} /> } : {}),
          // The preparation lifecycle is handed the revision and the advisory actions this route read, so a change presents the revision it was read at and the service still re-checks the record on submit.
          ...(preparation === undefined ? {} : { preparation: <PartnerPreparationSurface partnerId={partnerId} kind={partner.kind} archived={preparation.archived} expectedRevision={envelope.revision} scope={envelope.scope} availableActions={envelope.actions} /> }),
        }}
        {...(interactions === null ? {} : { interactions: detailRead(interactions, (page) => page.interactions) })}
        {...(privatePreparation === null ? {} : { privatePreparation: detailRead(privatePreparation, (data) => data) })}
      />
      {/* The introduction that brought this person here is recorded against this record and nowhere else: the referral list states the same thing in its own words, because a list has no partner identity, revision or source to hand a form. Every fact below is the read's own — the record's identity, the revision this page read, the source that answered, and the accepted source zone the read states — so the route states none of them itself and the window the introduction opens is counted in the one zone the referral rules declare. */}
      {recordIntroductionAdmitted ? <ReferralIntroductionForm scope={envelope.scope} partnerId={partner.partnerId} expectedRevision={envelope.revision} sourceReference={envelope.source} sourceZone={envelope.data.referralSourceZone} /> : null}
    </div>
  );
}
