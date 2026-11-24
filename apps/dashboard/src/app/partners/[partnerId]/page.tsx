import type { Metadata } from "next";
import type { ReactElement } from "react";
import type { PartnerReadResult } from "@/features/partners/components/partner-detail-sections";
import PartnerRecordBody, { type PartnerRecordFacts } from "@/features/partners/components/partner-record-body";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY } from "@/features/partners/copy/states";
import { tagSuggestionsOf } from "@/features/partners/tag-suggestions";
import { reads, type ReadAction, type ReadEnvelope, type ReadResult } from "@/modules/data-service";
import PartnerIntroductionSection from "../partner-introduction-section";
import { pageRefusalOf, type ReadNoticeCopy } from "../../page-frame";
const ROSTER_HREF = "/partners";
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
const noticeCopyOf = (partnerId: string): ReadNoticeCopy => ({
  headingLevel: 1,
  denied: { title: DETAIL_COPY.denied.title, body: DETAIL_COPY.denied.body, action: { label: PARTNER_ACTION_LABELS.backToRoster, href: ROSTER_HREF } },
  unavailable: { title: DETAIL_COPY.unavailable.title, body: DETAIL_COPY.unavailable.body, action: { label: PARTNER_ACTION_LABELS.retry, href: partnerHref(partnerId, "") } },
  refused: { title: DETAIL_COPY.refused.title, body: DETAIL_COPY.refused.body, action: { label: PARTNER_ACTION_LABELS.backToRoster, href: ROSTER_HREF } },
});
/** One partner's record: identity, permitted contact methods, restrictions, relationship context, real activity, private notes, open work and authorised support history. */ export default async function PartnerDetailPage({ params }: { readonly params: Promise<{ partnerId: string }> }): Promise<ReactElement> {
  const { partnerId } = await params;
  const result = await reads.partners.readPartner(partnerId);
  if (result.kind !== "envelope") return pageRefusalOf(result, noticeCopyOf(partnerId), 4);
  const { envelope } = result;
  const logInteractionAdmitted = admitted(envelope.actions, "logInteraction");
  const privateNoteAdmitted = admitted(envelope.actions, "savePrivateNote");
  const filingAdmitted = admitted(envelope.actions, "setTag") && admitted(envelope.actions, "setFavourite"); // Personal tags and the favourite mark are one filing surface, so it is read only where the read admits both halves of it.
  const interactions = logInteractionAdmitted ? await reads.interactions.readInteractions({ partnerId }) : null; // The two further reads are issued only for the sections this record admits, and each arrives in the body's own vocabulary: a source that fails here costs its section, never the whole record.
  const privatePreparation = privateNoteAdmitted ? await reads.partners.readPrivatePreparation({ partnerId }) : null;
  const facets = filingAdmitted ? await reads.partners.readFacets() : null; // The vocabulary the record is filed against is the roster's own tag facet, read only where the record admits filing: a facet read that refuses or does not answer costs the suggestions, never the record.
  const tagSuggestions = tagSuggestionsOf(facets !== null && facets.kind === "envelope" ? facets.envelope.data : null);
  const { partner } = envelope.data;
  // Archive and restore are the worker's own preparation's lifecycle, so they are offered only where the private read answered with that record: every other record carries no such control.
  const preparation = privatePreparation !== null && privatePreparation.kind === "envelope" ? privatePreparation.envelope.data.preparation : undefined;
  // Every fact the record's own actions are derived from, taken from the read this page made: the body states these and no member of its own.
  const facts: PartnerRecordFacts = {
    scope: envelope.scope,
    revision: envelope.revision,
    actions: envelope.actions,
    partner: { partnerId: partner.partnerId, kind: partner.kind, displayName: partner.displayName, tags: partner.tags, favourite: partner.favourite },
    tagSuggestions,
    ...(preparation === undefined ? {} : { preparationArchived: preparation.archived }),
  };
  // The body lays out the record's own stack and the introduction section it is handed, so the route states the record and no second wrapper around it.
  return (
    <PartnerRecordBody
      partner={detailRead(result, (data) => data)}
      layout="page"
      locale="en-GB"
      breadcrumb={[{ label: "Partners", href: ROSTER_HREF }]}
      facts={facts}
      introduction={<PartnerIntroductionSection />}
      {...(interactions === null ? {} : { interactions: detailRead(interactions, (page) => page.interactions) })}
      {...(privatePreparation === null ? {} : { privatePreparation: detailRead(privatePreparation, (data) => data) })}
    />
  );
}
