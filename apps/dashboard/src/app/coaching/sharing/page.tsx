/**
 * `/coaching/sharing` — the worker's invitation and grant surface: every relationship the coaching read
 * returns, each named by its own opaque grant and coach references, with the five modules and the state a
 * coach meets in each, the duration and the cutoff frozen when it was accepted, the separately reviewed
 * financial range, and the closed set of stop-type effects.
 *
 * One section per relationship, because one worker can hold more than one grant with the same coach in the
 * same ministry: a surface that showed only the live grant it named first would leave a second grant — one a
 * coach can still read through, and one nothing on the page had disclosed — standing after the first was
 * revoked, so the page would read as if the revoke had changed nothing. Each section is built from its own
 * relationship, with its own grant view, its own modules and its own stop controls, so no control on this
 * page ever stands for another grant.
 *
 * The read is the authority for every fact here: this route composes the family's own components with the
 * envelope and derives nothing — no permission, no cutoff, no elapsed judgement and no count. A denial, an
 * outage and a refused request each render their own notice instead of an empty envelope, so a page that
 * could read nothing never looks like a page with nothing to show.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import FinancialRangeReview, { type SharedFinancialRange } from "@/features/coaching/components/financial-range-review";
import InvitationForm, { type InvitationFormProps } from "@/features/coaching/components/invitation-form";
import ModuleToggles, { type ModuleToggleEntry } from "@/features/coaching/components/module-toggles";
import SharingSummary, { type CoachingGrantView, type FinancialRange, type GrantDurationView, type ModuleRead, type SharingOutcome } from "@/features/coaching/components/sharing-summary";
import StopActions from "@/features/coaching/components/stop-actions";
import { COACHING_COPY, type StopEffect } from "@/features/coaching/copy";
import { reads } from "@/modules/data-service";

/** The read's own members, taken from the service so a change to the envelope fails to compile here rather than drifting. */
type SharingResult = Awaited<ReturnType<typeof reads.coaching.readCoachingOverview>>;
type SharingEnvelope = Extract<SharingResult, { readonly kind: "envelope" }>["envelope"];
type SharingOverview = SharingEnvelope["data"];
type SharingRelationship = SharingOverview["relationships"][number];
type SharingScope = SharingEnvelope["scope"];
type SharingCandidates = InvitationFormProps["candidates"];

/** The interface language this route hands the client surfaces that format amounts and calendar dates. */
const INTERFACE_LOCALE = "en-GB";
const PAGE_CLASS = "flex min-w-0 flex-col gap-6 text-start";
const PAGE_HEADING_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";
/** One relationship's own section: its heading, the summary it states, and the controls that act on it alone. */
const RELATIONSHIP_CLASS = "flex min-w-0 flex-col gap-4";
const RELATIONSHIP_HEADING_CLASS = "text-lg font-semibold text-pretty wrap-anywhere";
/** An opaque reference is rendered as the read reports it, so a reader sees the identity a record carries. */
const IDENTIFIER_CLASS = "mono-identifier wrap-anywhere";

/**
 * The stop-type effects a surface that names no module, check-in or task summary can apply. Switching a
 * module off belongs to its own row in `ModuleToggles`, and the three effects that name a check-in or a
 * task summary act on a record this page does not select, so only the two grant-level effects are offered
 * here — each while the envelope's advisory actions still publish the mutation behind it, which the
 * service re-checks on submit anyway.
 */
const GRANT_LEVEL_STOP_EFFECTS = ["end-relationship", "revoke"] as const satisfies readonly StopEffect[];
const GRANT_LEVEL_STOP_MUTATION: Readonly<Record<(typeof GRANT_LEVEL_STOP_EFFECTS)[number], string>> = { "end-relationship": "endCoaching", revoke: "revokeGrant" };
/** The identity acting on every effect here: the coach's own surface is `/coaching/coach`, never this one. */
const ACTING_ROLE = "worker";

export const metadata: Metadata = { title: COACHING_COPY.sharing.heading };

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

/**
 * One relationship, disclosed in full and stoppable on its own: the grant and coach references it is known
 * by, the state and duration it currently stands in, the reviewed financial range its own record states, the
 * five modules with the state a coach meets in each, and the grant-level stop-type effects that act on this
 * grant and no other.
 *
 * Every fact here comes from this relationship alone, so a worker who holds two grants with one coach reads
 * each of them and can stop either; revoking one can never be mistaken for stopping the other. The reviewed
 * range is one of those facts: it belongs to the grant that recorded it, so a relationship whose record states
 * no range says so in its own section rather than standing for every relationship on the page.
 *
 * A relationship the read refused — a revoked, ended, expired or out-of-scope episode — states that refusal in
 * the read's own words and offers neither a module switch nor a stop effect. Offering either would present a
 * control the service refuses, and a module row there would describe sharing the read has already ended: a
 * revoked grant whose rows still read "Shared" would claim an access the same section says has stopped.
 */
function RelationshipSection({ relationship, index, scope, asOf, grantLevelEffects }: RelationshipSectionProps): ReactElement {
  // The heading's identity is this section's own, so several relationships on one page keep distinct sections
  // for a screen reader's outline rather than sharing one label.
  const headingId = `coaching-relationship-${String(index)}`;
  // The read's own refusal for this relationship, or `null` when it admitted the episode: the one fact that
  // decides whether there is anything to switch or stop here at all.
  const refusal = relationship.readRefusal;
  return (
    <section data-slot="coaching-relationship" data-grant={relationship.grantId} data-state={relationship.state} aria-labelledby={headingId} className={RELATIONSHIP_CLASS}>
      {/*
        Both references are opaque and are shown exactly as the read reports them: the grant a stop-type effect
        names, and the principal the coach acts as. Neither is parsed, shortened or resolved to a name here.
      */}
      <h2 id={headingId} className={RELATIONSHIP_HEADING_CLASS}>
        Sharing with <bdi className={IDENTIFIER_CLASS}>{relationship.recipientPrincipalId}</bdi> under <bdi className={IDENTIFIER_CLASS}>{relationship.grantId}</bdi>
      </h2>
      <SharingSummary grant={grantViewOf(relationship)} locale={INTERFACE_LOCALE} />
      {/*
        The range this relationship's own record states, with the figure a coach reads for it and the coverage that
        figure was reported over. A record that states no range renders the review's own "not shared" statement here,
        in this relationship's section, so the page never speaks for another grant's range.
      */}
      <FinancialRangeReview range={reviewedRangeOf(relationship, asOf)} reviewedAt={relationship.invitation.issuedAt} reviewedByRole={ACTING_ROLE} locale={INTERFACE_LOCALE} />
      {/*
        A relationship the read refused states that refusal in the read's own words and offers no module switch: a module
        row there would describe sharing the read has already ended, and a switch the service refuses is not a control.
      */}
      {refusal === null ? (
        <ModuleToggles grantId={relationship.grantId} modules={moduleEntriesOf(relationship)} scope={scope} expectedRevision={relationship.revision} grantState={relationship.state} cutoffInstant={relationship.duration.cutoffInstant ?? relationship.duration.boundInstant} headingLevel={2} />
      ) : (
        <StateNotice kind="denied" headingLevel={3} title={COACHING_COPY.sharing.heading} description={refusal.message} />
      )}
      {/*
        The stop-type effects stay composed for every relationship, because this is the surface that states them: on a
        closed episode each effect is a statement rather than a control, and the record of a change the worker has just
        made stays beside the state that change produced. A refused relationship is offered no effect at all, since the
        read admitted none for it.
      */}
      <StopActions available={refusal === null ? grantLevelEffects : []} target={{ grantId: relationship.grantId, episodeState: relationship.state }} scope={scope} expectedRevision={relationship.revision} role={ACTING_ROLE} headingLevel={2} />
    </section>
  );
}

/** Four outcomes never collapse into one: a recorded invitation is not delivery, verification, acceptance or live access. */
function outcomeOf(reached: boolean): SharingOutcome {
  return reached ? "reached" : "not-reached";
}

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
    // The cutoff is displayed exactly as the read reports it, with the zone it was resolved in: an earlier
    // source limit is shown as winning rather than recomputed, and a bound the read states none of stays empty.
    shareCutoff: { instant: relationship.duration.cutoffInstant ?? relationship.duration.boundInstant ?? "", zone: relationship.duration.frozenZone ?? "", sourceLimitWins: relationship.duration.boundedBy === "source" },
    // The range this relationship's record states, passed through as the read projected it: a period and currency
    // nothing was reported for stays a period with no figure, and a record that states no range shares none.
    financialRange: summaryRangeOf(relationship),
    outcomes: { delivery: outcomeOf(relationship.outcomes.invitationIssued), identityVerification: outcomeOf(relationship.outcomes.identityVerified), acceptance: outcomeOf(relationship.outcomes.accepted), access: outcomeOf(relationship.outcomes.accessLive) },
  };
}

/** One relationship's reviewed range in the summary's own shape, with nothing derived here: the read computed the figure. */
function summaryRangeOf(relationship: SharingRelationship): FinancialRange | null {
  const range = relationship.financialRange;
  return range === null ? null : { from: range.from, to: range.to, currency: range.currency, money: range.money, valueState: range.valueState };
}

/**
 * The same range for the review card, which also states the coverage its figure was reported over and the instant it
 * was read at. The coverage travels with the figure from the projection behind it, so a partial subtotal is never
 * presented as a complete one; both values are the read's own and neither is recomputed here.
 */
function reviewedRangeOf(relationship: SharingRelationship, asOf: string): SharedFinancialRange | null {
  const range = relationship.financialRange;
  return range === null ? null : { from: range.from, to: range.to, currency: range.currency, money: range.money, valueState: range.valueState, coverage: range.coverage, asOf };
}

function moduleEntriesOf(relationship: SharingRelationship): readonly ModuleToggleEntry[] {
  const admitted = new Map(relationship.admittedModules.map((entry) => [entry.module, entry.readState] as const));
  // The read's own answer is passed through untouched: `moduleReadState` reports `null` for a shared module whose
  // content is complete — nothing held, missing or unavailable — and a module the grant does not share is absent
  // from `admittedModules` altogether, so it arrives as `null` too rather than as an invented state.
  return relationship.modules.map((module) => ({ key: module.module, enabled: module.selected, readState: admitted.get(module.module) ?? null }));
}

function grantLevelStopEffectsOf(actions: SharingEnvelope["actions"]): readonly StopEffect[] {
  return GRANT_LEVEL_STOP_EFFECTS.filter((effect) => actions.some((action) => action.name === GRANT_LEVEL_STOP_MUTATION[effect] && action.available));
}

/**
 * The three closed choices one invitation offers. The admitted contexts come from the read whose job is to enumerate
 * them, and the people come from the overview this page composes: that read projects the service's own session
 * records, so the roster is an identity fact the service holds rather than the development runtime's persona
 * catalogue, which belongs to the preview switcher alone. A context source that cannot answer leaves its own list
 * empty, and the form states the missing choice rather than this route inventing a candidate an invitation could then
 * be recorded against.
 */
async function readInvitationCandidates(invitableCoaches: SharingOverview["invitableCoaches"]): Promise<SharingCandidates> {
  const chooser = await reads.context.readContextChooser();
  const groups = chooser.kind === "envelope" ? chooser.envelope.data.groups : [];
  return {
    // The roster exactly as the overview projected it: the person acting is already left out of it, and the name it
    // states is the opaque reference the source of record holds for that principal, so nothing here resolves one.
    recipients: invitableCoaches,
    // A blank label means the source of record named no name for that context, so the opaque reference is shown
    // rather than a blank presented as a name: the name is never derived here.
    organizations: groups.map((group) => ({ organizationId: group.organizationId, displayName: group.organizationLabel === "" ? group.organizationId : group.organizationLabel })),
    ministries: groups.flatMap((group) => group.ministries.map((ministry) => ({ ministryId: ministry.ministryId, displayName: ministry.ministryLabel === "" ? ministry.ministryId : ministry.ministryLabel }))),
  };
}

/** The worker's invitation and grant surface. */
export default async function CoachingSharingPage(): Promise<ReactElement> {
  const result = await reads.coaching.readCoachingOverview();
  switch (result.kind) {
    case "denied":
      // A denial answers identically whether or not anything exists here, so it states the refusal and its own
      // recovery and nothing it could not show: no coach, ministry, module, cutoff or count.
      return (
        <div className={PAGE_CLASS}>
          <StateNotice kind="denied" headingLevel={1} title={COACHING_COPY.sharing.heading} reasonCode={result.denied.reasonCode} />
        </div>
      );
    case "unavailable":
      // An outage is never an empty surface and never a zero, and the source that could not be read is named.
      return (
        <div className={PAGE_CLASS}>
          <StateNotice kind="unavailable" headingLevel={1} title={COACHING_COPY.sharing.heading} description={COACHING_COPY.sharing.unavailable} source={result.unavailable.source} />
        </div>
      );
    case "refused":
      // This route states its own request and sends no query, so the arm is a statement rather than a thrown defect.
      return (
        <div className={PAGE_CLASS}>
          <StateNotice kind="refused" headingLevel={1} title={COACHING_COPY.sharing.heading} />
        </div>
      );
    case "envelope": {
      const envelope = result.envelope;
      const grantLevelEffects = grantLevelStopEffectsOf(envelope.actions);
      const candidates = await readInvitationCandidates(envelope.data.invitableCoaches);
      return (
        <div className={PAGE_CLASS}>
          {/* The one h1: every relationship below opens its own section at level two, and the cards and stop controls inside a section state their own headings beneath that. */}
          <h1 className={PAGE_HEADING_CLASS}>{COACHING_COPY.sharing.heading}</h1>
          {/*
            Every relationship the read returned is disclosed, including one this page would have called "the"
            relationship before: the read carries each grant separately, and a surface that showed one of them
            would leave the others — and the access a coach still holds through them — unnamed and unstoppable.
          */}
          {envelope.data.relationships.length === 0 ? <SharingSummary grant={null} locale={INTERFACE_LOCALE} /> : null}
          {envelope.data.relationships.map((relationship, index) => (
            <RelationshipSection key={relationship.grantId} relationship={relationship} index={index} scope={envelope.scope} asOf={envelope.asOf} grantLevelEffects={grantLevelEffects} />
          ))}
          {/*
            The duration control is composed inside this form, which owns the value it edits: it is a
            controlled input, so a route that renders on the server cannot hand it the change handler its
            state would need. The cutoff that the chosen duration produces is stated by the summary above.
          */}
          <InvitationForm candidates={candidates} rangeCurrencies={envelope.data.reviewedRangeCurrencies} scope={envelope.scope} expectedRevision={envelope.revision} locale={INTERFACE_LOCALE} />
        </div>
      );
    }
    default: {
      // Every member of the read's closed result is handled above; if the service ever adds one, this
      // assignment stops compiling rather than the new state being dropped from the surface.
      const unhandled: never = result;
      return unhandled;
    }
  }
}
