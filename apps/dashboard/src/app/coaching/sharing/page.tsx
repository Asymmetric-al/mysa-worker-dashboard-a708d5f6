/**
 * `/coaching/sharing` — the worker's invitation and grant surface: every relationship the coaching read returns, each named by its own opaque grant and coach references, with the five modules and the state a coach meets in each, the duration and the cutoff frozen when it was accepted, the separately reviewed financial range, and the closed set of stop-type effects.
 *
 * One section per relationship, because one worker can hold more than one grant with the same coach in the same ministry: a surface that showed only the live grant it named first would leave a second grant — one a coach can still read through, and one nothing on the page had disclosed — standing after the first was revoked, so the page would read as if the revoke had changed nothing. Each section is built from its own relationship, with its own grant view, its own modules and its own stop controls, so no control on this page ever stands for another grant.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import FinancialRangeReview, { type SharedFinancialRange } from "@/features/coaching/components/financial-range-review";
import InvitationForm, { type InvitationFormProps } from "@/features/coaching/components/invitation-form";
import ModuleToggles, { type ModuleToggleEntry } from "@/features/coaching/components/module-toggles";
import SharingSummary, { type CoachingGrantView, type FinancialRange, type GrantDurationView, type ModuleRead, type SharingOutcome } from "@/features/coaching/components/sharing-summary";
import StopActions from "@/features/coaching/components/stop-actions";
import { COACHING_COPY, type StopEffect } from "@/features/coaching/copy";
import { reads } from "@/modules/data-service";
import { PageColumn, PageHeading, pageRefusalOf, type ReadNoticeCopy } from "../../page-frame";
type SharingEnvelope = Extract<Awaited<ReturnType<typeof reads.coaching.readCoachingOverview>>, { readonly kind: "envelope" }>["envelope"];
type SharingOverview = SharingEnvelope["data"];
type SharingRelationship = SharingOverview["relationships"][number];
type SharingScope = SharingEnvelope["scope"];
type SharingCandidates = InvitationFormProps["candidates"];
const INTERFACE_LOCALE = "en-GB";
/** One relationship's own section: its heading, the summary it states, and the controls that act on it alone. */
const RELATIONSHIP_CLASS = "flex min-w-0 flex-col gap-4";
const RELATIONSHIP_HEADING_CLASS = "text-lg font-semibold text-pretty wrap-anywhere";
/** An opaque reference is rendered as the read reports it, so a reader sees the identity a record carries. */
const IDENTIFIER_CLASS = "mono-identifier wrap-anywhere";
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: 1, denied: { title: COACHING_COPY.sharing.heading }, unavailable: { title: COACHING_COPY.sharing.heading, body: COACHING_COPY.sharing.unavailable }, refused: { title: COACHING_COPY.sharing.heading } };
const GRANT_LEVEL_STOP_EFFECTS = ["end-relationship", "revoke"] as const satisfies readonly StopEffect[];
const GRANT_LEVEL_STOP_MUTATION: Readonly<Record<(typeof GRANT_LEVEL_STOP_EFFECTS)[number], string>> = { "end-relationship": "endCoaching", revoke: "revokeGrant" };
const ACTING_ROLE = "worker";
export const metadata: Metadata = { title: COACHING_COPY.sharing.heading };
const outcomeOf = (reached: boolean): SharingOutcome => (reached ? "reached" : "not-reached");
function durationViewOf(duration: SharingRelationship["duration"]): GrantDurationView {
  if (duration.kind === "ongoing") return { kind: "ongoing" };
  if (duration.kind === "none") return { kind: "none" };
  return { kind: "through-date", throughDate: duration.shareThroughDate };
}
function grantViewOf(relationship: SharingRelationship): CoachingGrantView {
  const modules: readonly ModuleRead[] = relationship.admittedModules.map((admitted) => ({ key: admitted.module, readState: admitted.readState }));
  return {
    state: relationship.state,
    availability: relationship.availability,
    modules,
    duration: durationViewOf(relationship.duration),
    // The cutoff is displayed exactly as the read reports it, with the zone it was resolved in: an earlier source limit is shown as winning rather than recomputed, and a bound the read states none of stays empty.
    shareCutoff: { instant: relationship.duration.cutoffInstant ?? relationship.duration.boundInstant ?? "", zone: relationship.duration.frozenZone ?? "", sourceLimitWins: relationship.duration.boundedBy === "source" },
    financialRange: summaryRangeOf(relationship), // The range this relationship's record states, passed through as the read projected it: a period and currency nothing was reported for stays a period with no figure, and a record that states no range shares none.
    outcomes: { delivery: outcomeOf(relationship.outcomes.invitationIssued), identityVerification: outcomeOf(relationship.outcomes.identityVerified), acceptance: outcomeOf(relationship.outcomes.accepted), access: outcomeOf(relationship.outcomes.accessLive) },
  };
}
/** One relationship's reviewed range in the summary's own shape, with nothing derived here: the read computed the figure. */
const summaryRangeOf = (relationship: SharingRelationship): FinancialRange | null =>
  relationship.financialRange === null ? null : { from: relationship.financialRange.from, to: relationship.financialRange.to, currency: relationship.financialRange.currency, money: relationship.financialRange.money, valueState: relationship.financialRange.valueState };
/** The same range for the review card, which also states the coverage its figure was reported over and the instant it was read at. The coverage travels with the figure from the projection behind it, so a partial subtotal is never presented as a complete one; both values are the read's own and neither is recomputed here. */
const reviewedRangeOf = (relationship: SharingRelationship, asOf: string): SharedFinancialRange | null =>
  relationship.financialRange === null
    ? null
    : { from: relationship.financialRange.from, to: relationship.financialRange.to, currency: relationship.financialRange.currency, money: relationship.financialRange.money, valueState: relationship.financialRange.valueState, coverage: relationship.financialRange.coverage, asOf };
function moduleEntriesOf(relationship: SharingRelationship): readonly ModuleToggleEntry[] {
  const admitted = new Map(relationship.admittedModules.map((entry) => [entry.module, entry.readState] as const));
  // The read's own answer is passed through untouched: `moduleReadState` reports `null` for a shared module whose record could not be read, so a module is never claimed as readable or unreadable here.
  return relationship.modules.map((module) => ({ key: module.module, enabled: module.selected, readState: admitted.get(module.module) ?? null }));
}
const grantLevelStopEffectsOf = (actions: SharingEnvelope["actions"]): readonly StopEffect[] => GRANT_LEVEL_STOP_EFFECTS.filter((effect) => actions.some((action) => action.name === GRANT_LEVEL_STOP_MUTATION[effect] && action.available));
/** The three closed choices one invitation offers. The admitted contexts come from the read whose job is to enumerate them, and the people come from the overview this page composes: that read projects the service's own session records, so the roster is an identity fact the service holds rather than the development runtime's persona catalogue, which belongs to the preview switcher alone. A context source that cannot answer leaves its own list empty, and the form states the missing choice rather than this route inventing a candidate an invitation could then be recorded against. */
async function readInvitationCandidates(invitableCoaches: SharingOverview["invitableCoaches"]): Promise<SharingCandidates> {
  const chooser = await reads.context.readContextChooser();
  const groups = chooser.kind === "envelope" ? chooser.envelope.data.groups : [];
  return {
    recipients: invitableCoaches, // The roster exactly as the overview projected it: the person acting is already left out of it, and the name it states is the opaque reference the source of record holds for that principal, so nothing here resolves one.
    // A blank label means the source of record named no name for that context, so the opaque reference is shown rather than a blank presented as a name: the name is never derived here.
    organizations: groups.map((group) => ({ organizationId: group.organizationId, displayName: group.organizationLabel === "" ? group.organizationId : group.organizationLabel })),
    ministries: groups.flatMap((group) => group.ministries.map((ministry) => ({ ministryId: ministry.ministryId, displayName: ministry.ministryLabel === "" ? ministry.ministryId : ministry.ministryLabel }))),
  };
}
/** What one relationship's section is built from: the relationship itself, its place in the read, and the envelope it was read in. */
interface RelationshipSectionProps {
  readonly relationship: SharingRelationship;
  readonly index: number;
  readonly scope: SharingScope;
  /** The instant the envelope was read at, which the range review states beside the figure it was read with. */
  readonly asOf: string;
  /** The grant-level effects the envelope published as available, offered on this relationship alone. */
  readonly grantLevelEffects: readonly StopEffect[];
}
/** One relationship, disclosed in full and stoppable on its own: the grant and coach references it is known by, the state and duration it currently stands in, the reviewed financial range its own record states, the five modules with the state a coach meets in each, and the grant-level stop-type effects that act on this grant and no other. A relationship the read refused — a revoked, ended, expired or out-of-scope episode — states that refusal in the read's own words and offers neither a module switch nor a stop effect, because offering either would present a control the service refuses. */
function RelationshipSection({ relationship, index, scope, asOf, grantLevelEffects }: RelationshipSectionProps): ReactElement {
  const headingId = `coaching-relationship-${String(index)}`; // The heading's identity is this section's own, so several relationships on one page keep distinct sections for a screen reader's outline rather than sharing one label.
  const refusal = relationship.readRefusal; // The read's own refusal for this relationship, or `null` when it admitted the episode: the one fact that decides whether there is anything to switch or stop here at all.
  return (
    <section data-slot="coaching-relationship" data-grant={relationship.grantId} data-state={relationship.state} aria-labelledby={headingId} className={RELATIONSHIP_CLASS}>
      {/* Both references are opaque and are shown exactly as the read reports them: the grant a stop-type effect names, and the principal the coach acts as. Neither is parsed, shortened or resolved to a name here. */}
      <h2 id={headingId} className={RELATIONSHIP_HEADING_CLASS}>
        Sharing with <bdi className={IDENTIFIER_CLASS}>{relationship.recipientPrincipalId}</bdi> under <bdi className={IDENTIFIER_CLASS}>{relationship.grantId}</bdi>
      </h2>
      <SharingSummary grant={grantViewOf(relationship)} locale={INTERFACE_LOCALE} />
      {/* The range this relationship's own record states, with the figure a coach reads for it and the coverage that figure was reported over. A record that states no range renders the review's own "not shared" statement here, in this relationship's section, so the page never speaks for another grant's range. */}
      <FinancialRangeReview range={reviewedRangeOf(relationship, asOf)} reviewedAt={relationship.invitation.issuedAt} reviewedByRole={ACTING_ROLE} locale={INTERFACE_LOCALE} />
      {refusal === null ? (
        <ModuleToggles grantId={relationship.grantId} modules={moduleEntriesOf(relationship)} scope={scope} expectedRevision={relationship.revision} grantState={relationship.state} cutoffInstant={relationship.duration.cutoffInstant ?? relationship.duration.boundInstant} headingLevel={2} />
      ) : (
        // A relationship the read refused states that refusal in the read's own words and offers no module switch: a module row there would describe sharing the read has already ended, and a switch the service refuses is not a control.
        <StateNotice kind="denied" headingLevel={3} title={COACHING_COPY.sharing.heading} description={refusal.message} />
      )}
      {/* The stop-type effects stay composed for every relationship, because this is the surface that states them: on a closed episode each effect is a statement rather than a control, and the record of a change the worker has just made stays beside the state that change produced. A refused relationship is offered no effect at all, since the read admitted none for it. */}
      <StopActions available={refusal === null ? grantLevelEffects : []} target={{ grantId: relationship.grantId, episodeState: relationship.state }} scope={scope} expectedRevision={relationship.revision} role={ACTING_ROLE} headingLevel={2} />
    </section>
  );
}
/** The worker's invitation and grant surface: every relationship the read returns, each disclosed and stoppable on its own, and the one form that records a new invitation. */
export default async function CoachingSharingPage(): Promise<ReactElement> {
  const result = await reads.coaching.readCoachingOverview();
  if (result.kind !== "envelope") return pageRefusalOf(result, NOTICE_COPY);
  const envelope = result.envelope;
  const grantLevelEffects = grantLevelStopEffectsOf(envelope.actions);
  const candidates = await readInvitationCandidates(envelope.data.invitableCoaches);
  return (
    <PageColumn>
      {/* The one h1: every relationship below opens its own section at level two, and the cards and stop controls inside a section state their own headings beneath that. */}
      <PageHeading title={COACHING_COPY.sharing.heading} />
      {/* Every relationship the read returned is disclosed, including one this page would have called "the" relationship before: the read carries each grant separately, and a surface that showed one of them would leave the others — and the access a coach still holds through them — unnamed and unstoppable. */}
      {envelope.data.relationships.length === 0 ? <SharingSummary grant={null} locale={INTERFACE_LOCALE} /> : null}
      {envelope.data.relationships.map((relationship, index) => (
        <RelationshipSection key={relationship.grantId} relationship={relationship} index={index} scope={envelope.scope} asOf={envelope.asOf} grantLevelEffects={grantLevelEffects} />
      ))}
      {/* The duration control is composed inside this form, which owns the value it edits: it is a controlled input, so a route that renders on the server cannot hand it the change handler its state would need. The cutoff that the chosen duration produces is stated by the summary in each relationship's section. */}
      <InvitationForm candidates={candidates} rangeCurrencies={envelope.data.reviewedRangeCurrencies} scope={envelope.scope} expectedRevision={envelope.revision} locale={INTERFACE_LOCALE} />
    </PageColumn>
  );
}
