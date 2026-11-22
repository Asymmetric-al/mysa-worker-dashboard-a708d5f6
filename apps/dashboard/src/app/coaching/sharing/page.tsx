/**
 * `/coaching/sharing` — the worker's invitation and grant surface: the named coach, the ministry a share
 * is scoped to, the five modules with the state a coach meets in each, the duration and the cutoff frozen
 * when it was accepted, the separately reviewed financial range, and the closed set of stop-type effects.
 *
 * The read is the authority for every fact here: this route composes the family's own components with the
 * envelope and derives nothing — no permission, no cutoff, no elapsed judgement and no count. A denial, an
 * outage and a refused request each render their own notice instead of an empty envelope, so a page that
 * could read nothing never looks like a page with nothing to show.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Temporal } from "temporal-polyfill";
import StateNotice from "@/components/state-notice";
import FinancialRangeReview from "@/features/coaching/components/financial-range-review";
import InvitationForm, { type InvitationFormProps } from "@/features/coaching/components/invitation-form";
import ModuleToggles, { type ModuleToggleEntry } from "@/features/coaching/components/module-toggles";
import SharingSummary, { type CoachingGrantView, type GrantDurationView, type ModuleRead, type SharingOutcome } from "@/features/coaching/components/sharing-summary";
import StopActions from "@/features/coaching/components/stop-actions";
import { COACHING_COPY, type StopEffect } from "@/features/coaching/copy";
import { compareCodeUnits } from "@/lib/ordering";
import { reads } from "@/modules/data-service";

/** The read's own members, taken from the service so a change to the envelope fails to compile here rather than drifting. */
type SharingResult = Awaited<ReturnType<typeof reads.coaching.readCoachingOverview>>;
type SharingEnvelope = Extract<SharingResult, { readonly kind: "envelope" }>["envelope"];
type SharingOverview = SharingEnvelope["data"];
type SharingRelationship = SharingOverview["relationships"][number];
type SharingCandidates = InvitationFormProps["candidates"];

/** The interface language this route hands the client surfaces that format amounts and calendar dates. */
const INTERFACE_LOCALE = "en-GB";
const PAGE_CLASS = "flex min-w-0 flex-col gap-6 text-start";
const PAGE_HEADING_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";

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

/**
 * Orders two relationships newest invitation first: the later stated instant wins, and two invitations issued at the
 * same instant are resolved on the greater `grantId`, so the order is the same on every render. The read refuses a
 * record whose invitation instants cannot be parsed, so every relationship here states an instant this can compare.
 */
function byMostRecentlyInvited(one: SharingRelationship, two: SharingRelationship): number {
  const order = Temporal.Instant.compare(Temporal.Instant.from(two.invitation.issuedAt), Temporal.Instant.from(one.invitation.issuedAt));
  return order !== 0 ? order : compareCodeUnits(two.grantId, one.grantId);
}

/**
 * The relationship this surface manages: the live episode when there is one, and otherwise the one the worker most
 * recently began. The surface manages the relationship in use, so once none is live it manages the last one the
 * worker started rather than whichever record the read happens to sort first — an unrelated earlier episode is not
 * the relationship these controls are about. The read states when each relationship began in its own invitation, so
 * that instant decides and `null` is answered only when the read holds no relationship at all.
 */
function currentRelationshipOf(overview: SharingOverview): SharingRelationship | null {
  const live = overview.relationships.find((relationship) => relationship.grantId === overview.activeGrantId);
  if (live !== undefined) return live;
  return overview.relationships.toSorted(byMostRecentlyInvited)[0] ?? null;
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
    // The overview states no reviewed financial range for a relationship, so this summary claims none: a range
    // nothing stated is shown as not shared, never as a zero.
    financialRange: null,
    outcomes: { delivery: outcomeOf(relationship.outcomes.invitationIssued), identityVerification: outcomeOf(relationship.outcomes.identityVerified), acceptance: outcomeOf(relationship.outcomes.accepted), access: outcomeOf(relationship.outcomes.accessLive) },
  };
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
 * The three closed choices one invitation offers. The overview summarises the relationship it read and
 * carries no roster of people or contexts, so the admitted contexts come from the read whose job is to
 * enumerate them and the seeded principals from the one read that lists a roster. A source that cannot
 * answer leaves its own list empty, and the form states the missing choice rather than this route
 * inventing a candidate an invitation could then be recorded against.
 */
async function readInvitationCandidates(excludedPrincipalId: string): Promise<SharingCandidates> {
  const [chooser, roster] = await Promise.all([reads.context.readContextChooser(), reads.dev.readDevState()]);
  const groups = chooser.kind === "envelope" ? chooser.envelope.data.groups : [];
  const personas = roster.kind === "envelope" && roster.envelope.data.personaCatalogue.state === "persisted" ? roster.envelope.data.personaCatalogue.personas : [];
  return {
    // A worker cannot invite their own principal as coach, so the person acting is never offered to themselves.
    recipients: personas.filter((persona) => persona.kind === "coach" && persona.principalId !== excludedPrincipalId).map((persona) => ({ principalId: persona.principalId, displayName: persona.label })),
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
      const relationship = currentRelationshipOf(envelope.data);
      const candidates = await readInvitationCandidates(envelope.scope.principalId);
      return (
        <div className={PAGE_CLASS}>
          {/* The one h1: the composed surfaces below each open their own section at level two. */}
          <h1 className={PAGE_HEADING_CLASS}>{COACHING_COPY.sharing.heading}</h1>
          <SharingSummary grant={relationship === null ? null : grantViewOf(relationship)} locale={INTERFACE_LOCALE} />
          {/*
            The duration control is composed inside this form, which owns the value it edits: it is a
            controlled input, so a route that renders on the server cannot hand it the change handler its
            state would need. The cutoff that the chosen duration produces is stated by the summary above.
          */}
          <InvitationForm candidates={candidates} scope={envelope.scope} expectedRevision={envelope.revision} locale={INTERFACE_LOCALE} />
          {relationship === null ? null : (
            <ModuleToggles grantId={relationship.grantId} modules={moduleEntriesOf(relationship)} scope={envelope.scope} expectedRevision={relationship.revision} grantState={relationship.state} cutoffInstant={relationship.duration.cutoffInstant ?? relationship.duration.boundInstant} headingLevel={2} />
          )}
          {/* The read states no reviewed range, so the review states that none is shared rather than a figure. */}
          <FinancialRangeReview range={null} locale={INTERFACE_LOCALE} />
          {relationship === null ? null : <StopActions available={grantLevelStopEffectsOf(envelope.actions)} target={{ grantId: relationship.grantId, episodeState: relationship.state }} scope={envelope.scope} expectedRevision={relationship.revision} role={ACTING_ROLE} headingLevel={2} />}
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
