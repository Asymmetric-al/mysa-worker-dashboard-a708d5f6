"use client";
/** One partner record's detail body, composed once for every presentation it appears in: the record's own route states it as the page, and the record opened beside the roster renders it in the panel and in the phone sheet. The sections, the action row, the change surfaces and the empty states' destinations are all derived here from the facts the record's read published, so the three presentations offer the same jobs against the same revision instead of a second copy of any of them. */
import type { ReactElement } from "react";
import type { ReviewHeadingLevel } from "@/components/action-review";
import type { RecordDetailBreadcrumbEntry, RecordDetailLayout } from "@/components/record-detail";
import type { InteractionRecord, PartnerKind, ReadAction, Scope } from "@/modules/data-service/envelope";
import PartnerDetailSections, { type PartnerDetailActions, type PartnerDetailData, type PartnerDetailLinks, type PartnerPrivateData, type PartnerReadResult } from "./partner-detail-sections";
import { PartnerFilingSurface, PartnerPreparationSurface, PartnerRecordActionBar, PARTNER_RECORD_PATHS } from "./partner-record-actions";
import PrivateNoteComposer from "./private-note-composer";
type SurfaceHeadingLevels = { readonly note: 3 | 4; readonly filing: ReviewHeadingLevel };
/** The level each surface the body adds lands at: the record's route titles the record at the page's h1 and its sections at h2, where the panel and the sheet state the record name at h2 and the sections at h3, so a surface added here takes the same step below the sections in each presentation. */
const SURFACE_HEADINGS: Readonly<Record<RecordDetailLayout, SurfaceHeadingLevels>> = { page: { note: 3, filing: 2 }, panel: { note: 4, filing: 3 }, sheet: { note: 4, filing: 3 } };
/** The record the action surfaces act on: the revision and scope a change states, the advisory actions the read published, the fields its filing surface names, the labels its ministry already files under, and whether the worker's own preparation is archived. */
export type PartnerRecordFacts = {
  readonly scope: Scope;
  readonly revision: string;
  readonly actions: readonly ReadAction[];
  readonly partner: { readonly partnerId: string; readonly kind: PartnerKind; readonly displayName: string; readonly tags: readonly string[]; readonly favourite: boolean };
  readonly tagSuggestions: readonly string[];
  readonly preparationArchived?: boolean;
};
export type PartnerRecordBodyProps = {
  readonly partner: PartnerReadResult<PartnerDetailData>;
  readonly privatePreparation?: PartnerReadResult<PartnerPrivateData>;
  readonly interactions?: PartnerReadResult<readonly InteractionRecord[]>;
  readonly layout: RecordDetailLayout;
  readonly locale: string;
  readonly breadcrumb?: readonly RecordDetailBreadcrumbEntry[];
  /** The facts the record's own actions are derived from: a record whose read has not answered states none, so no action is offered against a revision this body has not read. */
  readonly facts?: PartnerRecordFacts;
};
const admitted = (actions: readonly ReadAction[], name: string): boolean => actions.some((action) => action.name === name && action.available);
/** The whole of the body's action surface, derived from the one facts record so no presentation states an action, a destination or a revision of its own. */
function surfacesOf(facts: PartnerRecordFacts | undefined, headings: SurfaceHeadingLevels): { readonly actions?: PartnerDetailActions; readonly links: PartnerDetailLinks } {
  if (facts === undefined) return { links: {} };
  const { partnerId, kind, displayName, tags, favourite } = facts.partner;
  const logInteractionAdmitted = admitted(facts.actions, "logInteraction");
  const createTaskAdmitted = admitted(facts.actions, "createTask");
  const filingAdmitted = admitted(facts.actions, "setTag") && admitted(facts.actions, "setFavourite"); // Personal tags and the favourite mark are one filing surface, so it is mounted only where the read admits both halves of it.
  const preparationArchived = facts.preparationArchived;
  const actions: PartnerDetailActions = {
    bar: <PartnerRecordActionBar partnerId={partnerId} contactEditsAdmitted={admitted(facts.actions, "saveContactEdits")} logInteractionAdmitted={logInteractionAdmitted} createTaskAdmitted={createTaskAdmitted} />,
    ...(admitted(facts.actions, "savePrivateNote") ? { privateNote: <PrivateNoteComposer scope={facts.scope} partnerId={partnerId} expectedRevision={facts.revision} headingLevel={headings.note} /> } : {}),
    // The record files under the worker's own labels in the body it already opens, so the roster's tag and favourite facets filter values a control on the record can set.
    ...(filingAdmitted ? { filing: <PartnerFilingSurface scope={facts.scope} target={{ partnerRef: { partnerId, expectedRevision: facts.revision, displayName, tags, favourite } }} tagSuggestions={facts.tagSuggestions} headingLevel={headings.filing} /> } : {}),
    // The preparation lifecycle is handed the revision and the advisory actions the record's read published, so a change presents the revision it was read at and the service still re-checks the record on submit. Archive and restore are the worker's own preparation's lifecycle, so they appear only where the private read answered with that record.
    ...(preparationArchived === undefined ? {} : { preparation: <PartnerPreparationSurface partnerId={partnerId} kind={kind} archived={preparationArchived} expectedRevision={facts.revision} scope={facts.scope} availableActions={facts.actions} /> }),
  };
  const links: PartnerDetailLinks = { ...(logInteractionAdmitted ? { logInteraction: PARTNER_RECORD_PATHS.newInteraction(partnerId) } : {}), ...(createTaskAdmitted ? { createTask: PARTNER_RECORD_PATHS.work(partnerId) } : {}), addPreparation: PARTNER_RECORD_PATHS.roster };
  return { actions, links };
}
export default function PartnerRecordBody({ partner, privatePreparation, interactions, layout, locale, breadcrumb, facts }: PartnerRecordBodyProps): ReactElement {
  const { actions, links } = surfacesOf(facts, SURFACE_HEADINGS[layout]);
  return <PartnerDetailSections partner={partner} layout={layout} locale={locale} {...(breadcrumb === undefined ? {} : { breadcrumb })} links={links} actions={actions} {...(interactions === undefined ? {} : { interactions })} {...(privatePreparation === undefined ? {} : { privatePreparation })} />;
}
