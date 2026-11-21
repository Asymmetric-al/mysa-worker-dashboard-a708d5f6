/**
 * The coaching grant: the one implementation of a coaching relationship's episode and of what an
 * admitted coach may read.
 *
 * A grant is an invitation from a worker to one named coach, over named ministries, for a chosen
 * duration and an independently selected set of five modules. This module owns the episode's
 * lifecycle, the share cutoff that bounds it, the module admission every coach-facing read passes
 * through, the five states a module can be in, and the reviewed financial range a grant may disclose.
 * Nothing here reads or changes worker-owned work: the coach's only writes remain accepting an
 * invitation and leaving, and both are pure transitions returning the next grant.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Coaching module" row: location `src/modules/coaching/*`, with the key interfaces
 *   `activeGrant()` and `admittedModules()` fixed here.
 * - AAP 0.3.4 concern "Coaching grant and disclosure → `src/modules/coaching/*`": the one
 *   implementation of this concern; the data-service reads and mutations, the coaching feature and
 *   the development-runtime seed consume it and re-derive none of its rules.
 * - AAP 0.6.2 "Coaching grant" record: `grantId`, `workerPrincipalId`, `coachPrincipalId`,
 *   `ministryIds`, `modules` (five independent flags, unselected on invitation), `duration` (with a
 *   cutoff frozen at acceptance), `financialRange`, `state`, `invitation {issuedAt, expiresAt,
 *   supersededBy}` and `revision`. This file's field names mirror those so the service maps the
 *   persisted record without a translation table.
 * - AAP 0.8.4 coaching rules: the four separate facts, the frozen exclusive cutoff, modules starting
 *   unselected, the five module read states, the reviewed fixed financial range with no combined
 *   total, and the six stop-type effects kept apart.
 * - AAP 0.8.7 "Fixed values and Boundary semantics", the coaching share-cutoff row: the exclusive
 *   start of the civil day after the chosen Share-through date, in the source-approved zone, frozen
 *   at acceptance, never recomputed and never widened.
 * - AAP 0.9.1 tree, the AAP 0.11.1 deliverable row
 *   `modules/coaching/{grant,target,checkin,taskshare}.ts`, and acceptance criterion 16.
 *
 * Four facts that never imply one another. An invitation being issued, the coach's identity being
 * verified, the coach deliberately accepting, and access being live are recorded separately, and only
 * all of them together make a module readable. An address that matches, an existing relationship, a
 * staff title or participation in a project grants nothing: a grant binds by principal identifier
 * plus ministry identifier, never by a name, an email address or a postal address, and nothing here
 * joins on one.
 *
 * Authorisation precedes enumeration. A module the worker never switched on produces no state at
 * all — not an empty one, not a withheld one and not a count of what is missing — so a coach cannot
 * learn from this module that an unshared module exists, and every refusal it returns is a reason
 * code with generic wording that names no record, count, title or size.
 *
 * The share cutoff is calendar-day arithmetic, delegated to `time/shareCutoff` and never
 * approximated with elapsed hours. Acceptance freezes it: the resolved instant is carried forward and
 * is never recomputed on a later read, so travel, a display-timezone change or a later settings
 * change cannot move it. Expiry denies new reads at the cutoff even when a stored status row still
 * says the episode is live, and it never claims that a figure a coach already saw was recalled.
 *
 * Six stop-type effects stay distinct in the coaching module — a module stopped, a check-in
 * withdrawn, a task share removed, the relationship ended, the coach leaving, and the grant revoked.
 * This file owns the last three and keeps them apart in lifecycle state, in refusal reason and in
 * wording.
 *
 * Leaf-module import rule: the data service and the development runtime import this module, so it may
 * import only downward — the time windows, the civil-date vocabulary, the money formatter and the
 * result helpers — and never the store, the data service (not even for a type), another domain
 * module, a feature, a component or a route. It reads no clock: `now` is a parameter of every
 * time-dependent export, so a call site that omits it does not compile. It performs no I/O, schedules
 * nothing and notifies nobody, and it never states that a message left this application.
 */
import { Temporal } from "temporal-polyfill";

import { assertNever, err, ok, type Result } from "@/lib/result";
import type { Money } from "@/modules/money/amount";
import { exponentOf } from "@/modules/money/currency";
import { formatMinor, type MinorFormatting } from "@/modules/money/format";
import {
  civilDateAt,
  serialiseCivilDate,
  startOfCivilDay,
  type CivilDate,
} from "@/modules/time/civil";
import { shareCutoff, type MidnightResolution } from "@/modules/time/window";

// ---------------------------------------------------------------------------------------------
// The episode's lifecycle, and why a request against it was refused
// ---------------------------------------------------------------------------------------------

/**
 * Every state a coaching episode can be stored in.
 *
 * `accepted` and `active` are both past acceptance: `accepted` records a deliberate acceptance whose
 * access has not yet been confirmed, `active` an episode whose access is live. `revoked`, `ended` and
 * `left` are three different closures — the worker revoked the grant, the worker ended the
 * relationship, the coach left — and a closed episode is never reopened by a later action. `expired`
 * is a closure reached at the frozen cutoff, and `superseded` an invitation replaced by a newer one
 * before it was accepted.
 *
 * `left` is a member because the module keeps the three closures apart in state and not only in
 * wording: collapsing a coach leaving into the relationship ending would report an ending the worker
 * never chose.
 */
export const GRANT_LIFECYCLE_STATES = [
  "invited",
  "accepted",
  "active",
  "revoked",
  "expired",
  "ended",
  "left",
  "superseded",
] as const;

/** One stored lifecycle state, derived from {@link GRANT_LIFECYCLE_STATES}. */
export type GrantLifecycleState = (typeof GRANT_LIFECYCLE_STATES)[number];

/**
 * Why a read or a transition was refused. A refusal is a value, never an exception, so a surface can
 * present the reason and keep the input the caller already holds.
 *
 * - `missing-duration`: the episode states no duration, and a missing duration is never permission.
 * - `identity-not-verified`: the coach's identity has not been verified, whatever else is recorded.
 * - `not-accepted`: the invitation was never deliberately accepted.
 * - `superseded`, `revoked`, `expired`, `ended`, `left`: the episode is closed, and the reason names
 *   which closure it was so the three stop-type effects stay distinguishable.
 * - `cutoff-reached`: the share window is closed at its frozen bound; a read at the bound is denied.
 * - `module-not-admitted`: the module is not one this episode shares. It names no other module.
 * - `permission-hold`: access is on a temporary hold. This is not an end and is never reported as one.
 * - `stale-action`: the action no longer applies to the current state and changes nothing.
 * - `stale-revision`: the change was made against a revision the record has moved past.
 * - `invalid-selection`: the invitation or change is not a coherent one (no ministry, no recipient, a
 *   worker coaching themselves, a range that runs backwards, a second figure in one currency).
 * - `invalid-duration`: the chosen duration cannot be resolved — an unknown zone or an unresolvable
 *   date — so no cutoff exists and none is invented.
 * - `not-holder`: the acting principal is not the holder this transition belongs to.
 * - `ministry-not-admitted`: the read is scoped to a ministry this grant does not cover.
 */
export const COACHING_REFUSAL_REASONS = [
  "missing-duration",
  "identity-not-verified",
  "not-accepted",
  "superseded",
  "revoked",
  "expired",
  "ended",
  "left",
  "cutoff-reached",
  "module-not-admitted",
  "permission-hold",
  "stale-action",
  "stale-revision",
  "invalid-selection",
  "invalid-duration",
  "not-holder",
  "ministry-not-admitted",
] as const;

/** One refusal reason, derived from {@link COACHING_REFUSAL_REASONS}. */
export type CoachingRefusalReason = (typeof COACHING_REFUSAL_REASONS)[number];

/**
 * A refused request: the machine-readable reason plus wording safe to show.
 *
 * The wording names no record, no count, no title and no size, and it never claims that a message
 * left this application, that a notice arrived, or that a coach saw what is being withheld.
 */
export interface CoachingRefusal {
  readonly reason: CoachingRefusalReason;
  readonly message: string;
}

/** The single way this module refuses: a reason and its generic wording, never a thrown error. */
function refusal(reason: CoachingRefusalReason, message: string): CoachingRefusal {
  return { reason, message };
}

// ---------------------------------------------------------------------------------------------
// The five modules a grant may admit
// ---------------------------------------------------------------------------------------------

/**
 * The five modules a grant may share, and the one declaration of them.
 *
 * Named assumption: the AAP fixes five independent modules without listing them. The tuple is derived
 * from the AAP's own distinctions — 0.8.4 keeps `goal shared` apart from `results shared`, and targets,
 * check-ins and task summaries are three further surfaces with their own disclosure rules — so the
 * five are the support goal, the support results, the targets, the check-ins and the task summaries.
 * A different product vocabulary changes this tuple and nothing else: no other list of module names
 * exists in the application, and no module key is written as a string literal outside this declaration
 * and the selection value the compiler checks against it.
 */
export const MODULE_KEYS = [
  "support-goal",
  "support-results",
  "targets",
  "check-ins",
  "task-summaries",
] as const;

/** One module a grant may share, derived from {@link MODULE_KEYS}. */
export type ModuleKey = (typeof MODULE_KEYS)[number];

/**
 * Which modules a grant shares: one independent flag per module, so switching one on or off says
 * nothing about the others.
 *
 * Every key of {@link MODULE_KEYS} and only those, so the annotated type makes a missing or an extra
 * key a compile error and the tuple stays the single list of modules.
 */
export type ModuleSelection = Readonly<Record<ModuleKey, boolean>>;

/** The invitation's selection: nothing shared until the worker switches a module on. */
export const NO_MODULES_SELECTED: ModuleSelection = {
  "support-goal": false,
  "support-results": false,
  targets: false,
  "check-ins": false,
  "task-summaries": false,
};

/**
 * The five states a module the coach is admitted to can be in, and nothing else.
 *
 * `empty` and `unavailable` stay distinct, because a module with nothing recorded is a different fact
 * from a module whose source cannot be read; `ended` and `unavailable` stay distinct, because a
 * closed episode is not a temporary outage; and `withheld` is reachable only for an admitted module
 * whose content is held until it is reviewed again.
 */
export const MODULE_READ_STATES = ["empty", "partial", "withheld", "unavailable", "ended"] as const;

/** One module read state, derived from {@link MODULE_READ_STATES}. */
export type ModuleReadState = (typeof MODULE_READ_STATES)[number];

/**
 * What a caller has observed inside one admitted module.
 *
 * `presence` states how much of the module's content exists and is current; it is an observation the
 * service makes, not a permission, and it is consulted only after the module has been admitted.
 * `withheldUntilReReviewed` records that the module's content is held because its reviewed meaning
 * changed, which is a disclosure fact rather than an absence of content.
 */
export interface ModuleObservation {
  readonly presence: ModuleContentPresence;
  readonly withheldUntilReReviewed: boolean;
}

/** How much of a module's content exists: none, some with stated partial coverage, or all of it. */
export type ModuleContentPresence = "none" | "partial" | "complete";

// ---------------------------------------------------------------------------------------------
// The duration and the cutoff it freezes
// ---------------------------------------------------------------------------------------------

/**
 * How long a worker chose to share: open-ended, or through one civil date in one named zone.
 *
 * A civil date rather than an instant, because the worker chooses a day a person would say; the zone
 * is stated by the choice rather than taken from the machine, so the cutoff is the same whoever runs
 * it. The zone is required for both kinds: an open-ended share still has to name the zone its source
 * limits are expressed in.
 */
export type ShareDuration =
  | { readonly kind: "ongoing"; readonly frozenZone: string }
  | {
      readonly kind: "through-date";
      readonly shareThroughDate: CivilDate;
      readonly frozenZone: string;
    };

/**
 * How a resolved cutoff's midnight settled in the frozen zone, taken from the window module's own
 * union so this declaration cannot drift from the resolution that produces it.
 *
 * `not-a-civil-day-start` covers the one case the window union does not describe: an earlier limit
 * the source imposes moved the cutoff to an instant that is not the start of any civil day at all.
 */
export type GrantDurationResolution = MidnightResolution | "not-a-civil-day-start";

/**
 * The duration as persisted, with the cutoff it froze.
 *
 * `cutoffInstant` is the exclusive bound: the whole Share-through date stays readable and a read at
 * the instant itself is denied. It is resolved once, at acceptance, and carried exactly as resolved
 * from then on, so a later settings, travel or timezone-data change cannot move it.
 *
 * `sourceLimitInstant` records an earlier limit the source itself imposes. It is kept for both kinds,
 * because an open-ended share is still bounded by it, and `limitedBy` says which limit decided so a
 * surface can show that rather than presenting the Share-through date as the reason.
 *
 * `nominalWording` is the statement of record in the chosen calendar terms and `resolution` says how
 * the instant settled; `nominalDisagreesWithResolved` is true when the two read differently, so both
 * can be disclosed instead of the resolved instant being presented as what was chosen.
 */
export interface GrantDuration {
  readonly kind: "ongoing" | "through-date";
  readonly shareThroughDate: CivilDate | null;
  readonly frozenZone: string;
  readonly cutoffInstant: Temporal.Instant | null;
  readonly sourceLimitInstant: Temporal.Instant | null;
  readonly limitedBy: "share-through" | "source" | null;
  readonly nominalWording: string;
  readonly resolution: GrantDurationResolution | null;
  readonly nominalDisagreesWithResolved: boolean;
  readonly settledAt: Temporal.Instant | null;
}

/**
 * Whether the coach's identity has been verified as its own separate fact.
 *
 * Verification is never inferred from an address, a relationship or a staff title, and it is not
 * implied by the invitation having been issued or by the coach having opened it.
 */
export type CoachIdentityVerification = "verified" | "unverified";

/** The invitation as issued, including the instant it stops being acceptable on its own. */
export interface CoachingInvitation {
  readonly issuedAt: Temporal.Instant;
  readonly expiresAt: Temporal.Instant;
  readonly supersededBy: string | null;
}

/**
 * The state a financial figure was read in, taken from the single formatter's own parameter.
 *
 * Declared here as a derivation rather than as a second union: `formatMinor`'s state type is declared
 * once in the read envelope, and re-declaring its members here would let the two drift. No state ever
 * becomes a zero or an empty string: each renders in its own words.
 */
export type AmountState = Parameters<typeof formatMinor>[1];

/** One reviewed figure: an exact amount and the state it was read in. */
export interface FinancialRangeMeasure {
  readonly amount: Money;
  readonly state: AmountState;
}

/**
 * The separately reviewed fixed date range a grant may disclose support figures over.
 *
 * The range is chosen and reviewed as one fixed period, and each figure in it is stated in its own
 * currency with its own state. There is deliberately no combined value: two currencies are never added
 * into one total, and no missing figure is turned into a zero that a total could absorb.
 */
export interface CoachingFinancialRange {
  readonly from: CivilDate;
  readonly to: CivilDate;
  readonly measures: readonly FinancialRangeMeasure[];
}

/**
 * One coaching relationship.
 *
 * `modules` starts fully unselected at invitation, and `duration` is null only for a record that
 * states none — which every read and every transition refuses, because a missing duration is not
 * permission. `acceptedAt` and `identityVerification` carry the acceptance facts; `revision` is the
 * optimistic-concurrency number every change presents the one it saw.
 */
export interface CoachingGrant {
  readonly grantId: string;
  readonly workerPrincipalId: string;
  readonly coachPrincipalId: string;
  readonly ministryIds: readonly string[];
  readonly modules: ModuleSelection;
  readonly duration: GrantDuration | null;
  readonly financialRange: CoachingFinancialRange | null;
  readonly state: GrantLifecycleState;
  readonly identityVerification: CoachIdentityVerification;
  readonly acceptedAt: Temporal.Instant | null;
  readonly invitation: CoachingInvitation;
  readonly revision: number;
}

// ---------------------------------------------------------------------------------------------
// The authority context the caller supplies
// ---------------------------------------------------------------------------------------------

/** Which side of the relationship is acting. The role decides which transitions are theirs. */
export type CoachingActorRole = "worker" | "coach";

/** Who is acting, by principal identifier — never by name, address or relationship. */
export interface CoachingActor {
  readonly role: CoachingActorRole;
  readonly principalId: string;
}

/**
 * Whether the source behind the subject is readable at this instant.
 *
 * An unavailable source leaves the episode open: it makes the modules that need it unreadable and
 * leaves the independent ones usable, which is why it is a dimension of the read and not a lifecycle
 * state a change could set.
 */
export type SubjectAvailability = "available" | "unavailable";

/**
 * A temporary permission hold on this read: `temporary` suspends access now without ending the
 * episode. It is deliberately not a lifecycle state, so a hold can never be recorded as an end and a
 * later re-enable is a hold being lifted rather than permission being granted.
 */
export type PermissionHold = "none" | "temporary";

/**
 * The already-resolved authority a read or a command was admitted under.
 *
 * The organisation is the frame the service resolved the ministry in — a ministry identifier is
 * meaningful only inside one organisation, and this module is handed the pair rather than deriving
 * it. The ministry is the one this module checks against the grant's own ministries, because a grant
 * records ministries and not organisations.
 */
export interface CoachingAccessContext {
  readonly actor: CoachingActor;
  readonly organizationId: string;
  readonly ministryId: string;
  readonly subjectAvailability: SubjectAvailability;
  readonly permissionHold: PermissionHold;
}

/**
 * The open episode a read runs under: what is admitted now, and how long it stays admitted.
 *
 * It carries the admitted modules at their grain and nothing about the ones that are not admitted, so
 * a surface built from it cannot render a count, a placeholder or a title for a module that was never
 * shared. `boundInstant` is the earlier of the frozen cutoff and any source limit, and
 * `remainingMilliseconds` is stated only while that bound is still ahead.
 */
export interface ActiveCoachingEpisode {
  readonly grantId: string;
  readonly workerPrincipalId: string;
  readonly coachPrincipalId: string;
  readonly ministryId: string;
  readonly admittedModules: readonly ModuleKey[];
  readonly duration: GrantDuration;
  readonly cutoffInstant: Temporal.Instant | null;
  readonly boundInstant: Temporal.Instant | null;
  readonly remainingMilliseconds: number | null;
  readonly financialRange: CoachingFinancialRange | null;
  readonly revision: number;
}

// ---------------------------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------------------------

/** Whether an identifier the caller supplied carries any content, trimmed. */
function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/** The modules a selection switches on, in the canonical order of {@link MODULE_KEYS}. */
function selectedKeys(selection: ModuleSelection): ModuleKey[] {
  return MODULE_KEYS.filter((key) => selection[key]);
}

/** The earlier of two optional instants: the bound a share is actually held to. */
function earlierOf(
  first: Temporal.Instant | null,
  second: Temporal.Instant | null,
): Temporal.Instant | null {
  if (first === null) return second;
  if (second === null) return first;
  return Temporal.Instant.compare(first, second) <= 0 ? first : second;
}

/** The bound an episode is held to: its frozen cutoff and any earlier source limit, whichever first. */
function boundOf(duration: GrantDuration): Temporal.Instant | null {
  return earlierOf(duration.cutoffInstant, duration.sourceLimitInstant);
}

/** Whether a bound has been reached: strict at equality, so a read at the bound is denied. */
function reached(bound: Temporal.Instant | null, now: Temporal.Instant): boolean {
  return bound !== null && Temporal.Instant.compare(now, bound) >= 0;
}

/** Milliseconds left before a bound, stated only while the bound is still ahead. */
function remainingUntil(bound: Temporal.Instant | null, now: Temporal.Instant): number | null {
  if (bound === null || reached(bound, now)) return null;
  return bound.epochMilliseconds - now.epochMilliseconds;
}

/**
 * The refusal for a lifecycle state that has closed the episode, or `null` while it is still open.
 *
 * Each closure names itself, so the three stop-type effects this module owns — revoked, ended and
 * left — can never be presented as one another, and `superseded` and `expired` stay distinguishable
 * from all three.
 */
function closedRefusal(state: GrantLifecycleState): CoachingRefusal | null {
  switch (state) {
    case "invited":
    case "accepted":
    case "active":
      return null;
    case "revoked":
      return refusal("revoked", "This grant was revoked, so nothing is readable here.");
    case "expired":
      return refusal("expired", "This share window expired, so nothing is readable here.");
    case "ended":
      return refusal("ended", "This coaching relationship ended, so nothing is readable here.");
    case "left":
      return refusal(
        "left",
        "The coach left this coaching relationship, so nothing is readable here.",
      );
    case "superseded":
      return refusal(
        "superseded",
        "This invitation was replaced by a newer one before it was accepted.",
      );
    default:
      return assertNever(state, "coaching grant state");
  }
}

/** The refusal for an actor who is not the side of the relationship a command belongs to. */
function holderRefusal(
  grant: CoachingGrant,
  actorPrincipalId: string,
  role: CoachingActorRole,
): CoachingRefusal | null {
  const holder = role === "coach" ? grant.coachPrincipalId : grant.workerPrincipalId;
  return actorPrincipalId === holder
    ? null
    : refusal("not-holder", "This action belongs to the other side of the coaching relationship.");
}

/**
 * The admission decision behind every read: who is asking, in which context, and the duration the
 * read needs.
 *
 * These are the facts that precede both closure and enumeration, in one place, so a read cannot check
 * them in a different order from its sibling and cannot enumerate a module before it has authorised
 * the caller. The duration comes back with the decision because a read needs it and a second null
 * check at each call site could disagree with this one.
 */
type Admission =
  | { readonly admitted: true; readonly duration: GrantDuration }
  | { readonly admitted: false; readonly refusal: CoachingRefusal };

/** Decides admission to one grant: holder, ministry, duration, acceptance, identity, temporary hold. */
function admitToGrant(grant: CoachingGrant, context: CoachingAccessContext): Admission {
  const notHolder = holderRefusal(grant, context.actor.principalId, context.actor.role);
  if (notHolder !== null) return { admitted: false, refusal: notHolder };

  if (!grant.ministryIds.includes(context.ministryId)) {
    return {
      admitted: false,
      refusal: refusal(
        "ministry-not-admitted",
        "This grant does not cover the context this read is scoped to.",
      ),
    };
  }

  if (grant.duration === null) {
    return {
      admitted: false,
      refusal: refusal(
        "missing-duration",
        "This grant states no duration, so nothing is shared: a missing duration is not permission.",
      ),
    };
  }

  if (grant.acceptedAt === null) {
    return {
      admitted: false,
      refusal: refusal(
        "not-accepted",
        "This invitation has not been accepted, so nothing is shared yet.",
      ),
    };
  }

  if (grant.identityVerification !== "verified") {
    return {
      admitted: false,
      refusal: refusal(
        "identity-not-verified",
        "The coach's identity is not verified, so access does not begin.",
      ),
    };
  }

  if (context.permissionHold === "temporary") {
    return {
      admitted: false,
      refusal: refusal(
        "permission-hold",
        "Access is on a temporary hold. The relationship is not over, and nothing here reports it as one.",
      ),
    };
  }

  return { admitted: true, duration: grant.duration };
}

/** The refusal for a change made against a revision the record has moved past. */
function revisionRefusal(grant: CoachingGrant, expectedRevision: number): CoachingRefusal | null {
  if (expectedRevision === grant.revision) return null;
  const expected = String(expectedRevision);
  const actual = String(grant.revision);
  return refusal(
    "stale-revision",
    `Revision ${expected} was expected and the record is at ${actual}; nothing changed.`,
  );
}

/** The refusal for a change to a share that is no longer open, in the order that names the cause. */
function openEpisodeRefusal(grant: CoachingGrant, now: Temporal.Instant): CoachingRefusal | null {
  const closed = closedRefusal(grant.state);
  if (closed !== null) return closed;
  if (grant.acceptedAt === null) {
    return refusal(
      "not-accepted",
      "This invitation has not been accepted, so nothing is shared yet.",
    );
  }
  if (grant.duration === null) {
    return refusal(
      "missing-duration",
      "This grant states no duration, so nothing is shared: a missing duration is not permission.",
    );
  }
  if (reached(boundOf(grant.duration), now)) {
    return refusal(
      "cutoff-reached",
      "This share window is closed at its frozen bound, so no new read is admitted.",
    );
  }
  return null;
}

/** The statement of record for an open-ended share: it has no end date of its own. */
const ONGOING_WORDING = "Open-ended, with no Share-through date of its own";

/**
 * The wording of record for a Share-through choice, in the stored calendar form rather than a
 * locale-formatted date: the same arguments state the same boundary on every machine, and a reader's
 * own language renders it at the component layer.
 */
function shareThroughWording(date: CivilDate): string {
  return `Shared through ${serialiseCivilDate(date)}`;
}

/**
 * How a resolved cutoff settled against the midnight of the civil day it sits in.
 *
 * `civilDateAt` reads the local day the frozen instant falls on and `startOfCivilDay` resolves that
 * day's midnight again, so the comparison uses the civil vocabulary's own single DST rule instead of
 * a second one written here. An unresolvable zone or day cannot be proven aligned, so it is reported
 * as a disagreement rather than presented as a plain midnight.
 */
function settlementOf(
  cutoffInstant: Temporal.Instant,
  frozenZone: string,
): { readonly resolution: GrantDurationResolution; readonly disagrees: boolean } {
  const localDay = civilDateAt(cutoffInstant, frozenZone);
  if (localDay.status === "refused") {
    return { resolution: "not-a-civil-day-start", disagrees: true };
  }
  const start = startOfCivilDay(localDay.date, frozenZone);
  if (start.status === "refused") {
    return { resolution: "not-a-civil-day-start", disagrees: true };
  }
  const aligned = Temporal.Instant.compare(start.instant, cutoffInstant) === 0;
  return {
    resolution: aligned ? start.resolution : "not-a-civil-day-start",
    disagrees: !aligned || start.resolution !== "aligned",
  };
}

/**
 * Freezes a chosen duration into the persisted one at the acceptance instant.
 *
 * The cutoff is the exclusive start of the civil day after the chosen Share-through date, resolved in
 * the duration's own zone through `time/shareCutoff`. Worked example: Share-through 2026-11-30 in
 * `Europe/London` freezes the cutoff at `2026-12-01T00:00:00Z`, so `2026-11-30T23:59:59.999Z` is still
 * readable, the whole of 30 November stays readable, and a read at `2026-12-01T00:00:00Z` is denied.
 *
 * Outcomes: the persisted duration carrying the frozen instant, the statement of record, how the
 * midnight settled and whether the two read differently; or a refusal (`missing-duration` when no
 * duration was chosen, `invalid-duration` when the zone or date cannot be resolved).
 *
 * An earlier limit the source imposes wins and is kept, with `limitedBy: "source"`, so the surface can
 * show which limit produced the cutoff. An open-ended share freezes no cutoff of its own but still
 * records the source limit, because an open-ended share is not an unbounded one.
 */
export function freezeShareDuration(
  duration: ShareDuration | null,
  acceptedAt: Temporal.Instant,
  options?: { readonly sourceLimit?: Temporal.Instant },
): Result<GrantDuration, CoachingRefusal> {
  if (duration === null) {
    return err(
      refusal(
        "missing-duration",
        "This grant states no duration, so nothing is shared: a missing duration is not permission.",
      ),
    );
  }

  if (!isNonEmpty(duration.frozenZone)) {
    return err(
      refusal(
        "invalid-duration",
        "The chosen duration names no zone, so no cutoff can be resolved.",
      ),
    );
  }

  const sourceLimit = options?.sourceLimit ?? null;

  if (duration.kind === "ongoing") {
    return ok({
      kind: "ongoing",
      shareThroughDate: null,
      frozenZone: duration.frozenZone,
      cutoffInstant: null,
      sourceLimitInstant: sourceLimit,
      limitedBy: sourceLimit === null ? null : "source",
      nominalWording: ONGOING_WORDING,
      resolution: null,
      nominalDisagreesWithResolved: sourceLimit !== null,
      settledAt: acceptedAt,
    });
  }

  const cutoff = shareCutoff({
    shareThroughDate: duration.shareThroughDate,
    frozenZone: duration.frozenZone,
    sourceLimit: sourceLimit ?? undefined,
  });

  if (cutoff.status === "refused") {
    return err(
      refusal(
        "invalid-duration",
        "The chosen Share-through date and zone do not resolve to a cutoff, so no bound is stated.",
      ),
    );
  }

  if (cutoff.limitedBy === "source") {
    return ok({
      kind: "through-date",
      shareThroughDate: duration.shareThroughDate,
      frozenZone: duration.frozenZone,
      cutoffInstant: cutoff.cutoffInstant,
      sourceLimitInstant: cutoff.sourceLimitInstant,
      limitedBy: "source",
      nominalWording: shareThroughWording(duration.shareThroughDate),
      resolution: "not-a-civil-day-start",
      nominalDisagreesWithResolved: true,
      settledAt: acceptedAt,
    });
  }

  const settlement = settlementOf(cutoff.cutoffInstant, duration.frozenZone);
  return ok({
    kind: "through-date",
    shareThroughDate: duration.shareThroughDate,
    frozenZone: duration.frozenZone,
    cutoffInstant: cutoff.cutoffInstant,
    sourceLimitInstant: null,
    limitedBy: "share-through",
    nominalWording: shareThroughWording(duration.shareThroughDate),
    resolution: settlement.resolution,
    nominalDisagreesWithResolved: settlement.disagrees,
    settledAt: acceptedAt,
  });
}

/**
 * The duration an invitation records before acceptance: the choice as made, with no cutoff yet.
 *
 * The zone and date are resolved here only as a check, so an unresolvable duration is refused where
 * it is chosen instead of surfacing at acceptance; the instant that check computes is discarded,
 * because the cutoff freezes at acceptance and at no earlier point.
 *
 * Outcomes: the unsettled duration, or a refusal (`invalid-duration`).
 */
function pendingDuration(duration: ShareDuration): Result<GrantDuration, CoachingRefusal> {
  if (duration.kind === "through-date") {
    const probe = shareCutoff({
      shareThroughDate: duration.shareThroughDate,
      frozenZone: duration.frozenZone,
    });
    if (probe.status === "refused") {
      return err(
        refusal(
          "invalid-duration",
          "The chosen Share-through date and zone do not resolve to a cutoff, so this duration is refused.",
        ),
      );
    }
  }

  return ok({
    kind: duration.kind,
    shareThroughDate: duration.kind === "through-date" ? duration.shareThroughDate : null,
    frozenZone: duration.frozenZone,
    cutoffInstant: null,
    sourceLimitInstant: null,
    limitedBy: null,
    nominalWording:
      duration.kind === "through-date"
        ? shareThroughWording(duration.shareThroughDate)
        : ONGOING_WORDING,
    resolution: null,
    nominalDisagreesWithResolved: false,
    settledAt: null,
  });
}

// ---------------------------------------------------------------------------------------------
// Reading an episode
// ---------------------------------------------------------------------------------------------

/**
 * Reads the open episode of one grant at `now`, or the reason it is not open.
 *
 * Denied when the acting principal is not the holder for its role, when the read is scoped to a
 * ministry the grant does not cover, when the episode is closed (naming which closure), when no
 * duration is stated, when the invitation was never deliberately accepted, when the coach's identity
 * is not verified, when access is on a temporary hold, and at or after the frozen bound. A temporary
 * hold is denied here without being reported as an end.
 *
 * Outcomes: the open episode with its admitted modules and remaining time, or a `CoachingRefusal`.
 * The refusal names no record, count, title or size, and this is only ever called for a grant the
 * service has already decided the caller may see.
 */
export function activeGrant(
  grant: CoachingGrant,
  context: CoachingAccessContext,
  now: Temporal.Instant,
): Result<ActiveCoachingEpisode, CoachingRefusal> {
  const admission = admitToGrant(grant, context);
  if (!admission.admitted) return err(admission.refusal);

  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);

  const bound = boundOf(admission.duration);
  if (reached(bound, now)) {
    return err(
      refusal(
        "cutoff-reached",
        "This share window is closed at its frozen bound, so no new read is admitted.",
      ),
    );
  }

  return ok({
    grantId: grant.grantId,
    workerPrincipalId: grant.workerPrincipalId,
    coachPrincipalId: grant.coachPrincipalId,
    ministryId: context.ministryId,
    admittedModules: selectedKeys(grant.modules),
    duration: admission.duration,
    cutoffInstant: admission.duration.cutoffInstant,
    boundInstant: bound,
    remainingMilliseconds: remainingUntil(bound, now),
    financialRange: grant.financialRange,
    revision: grant.revision,
  });
}

/**
 * The modules this episode actually admits at `now`: switched on and reachable under the open episode.
 *
 * Outcomes: the admitted keys in the canonical module order, or the refusal that keeps the episode
 * from being open. It returns no total, no count of what is not shared and no withheld list, so an
 * unshared module is absent rather than empty.
 */
export function admittedModules(
  grant: CoachingGrant,
  context: CoachingAccessContext,
  now: Temporal.Instant,
): Result<readonly ModuleKey[], CoachingRefusal> {
  const episode = activeGrant(grant, context, now);
  return episode.ok ? ok(episode.value.admittedModules) : err(episode.error);
}

/**
 * The single guard every coach-facing read of one module passes through.
 *
 * Outcomes: the key it admitted, or a `CoachingRefusal` — `module-not-admitted` when this episode does
 * not share that module, otherwise the reason the episode is not open. The refusal names no other
 * module and no count.
 */
export function assertModuleAdmitted(
  grant: CoachingGrant,
  key: ModuleKey,
  context: CoachingAccessContext,
  now: Temporal.Instant,
): Result<ModuleKey, CoachingRefusal> {
  const episode = activeGrant(grant, context, now);
  if (!episode.ok) return err(episode.error);
  if (!grant.modules[key]) {
    return err(refusal("module-not-admitted", "This grant does not share this module."));
  }
  return ok(key);
}

/**
 * Maps one module's observation to the single state a coach is shown for it.
 *
 * The caller is authorised before anything is enumerated: a principal who is not admissible to the
 * grant gets that refusal and learns nothing about the selection, and only then does a module this
 * grant never switched on produce no state at all — refused as `module-not-admitted`, so a caller
 * omits it and cannot render a placeholder, a count or a title for it.
 *
 * For an admitted module the outcomes are exactly one of the five states, or `null` when the module is
 * open, its source is available, its content needs no further review and it is complete, so nothing
 * stands beside the content. `ended` and `unavailable` stay distinct, a temporary hold is refused as
 * itself rather than reported as an end, and `empty` is never used for a source that could not be read.
 */
export function moduleReadState(
  grant: CoachingGrant,
  key: ModuleKey,
  context: CoachingAccessContext,
  now: Temporal.Instant,
  observation: ModuleObservation,
): Result<ModuleReadState | null, CoachingRefusal> {
  const admission = admitToGrant(grant, context);
  if (!admission.admitted) return err(admission.refusal);

  if (!grant.modules[key]) {
    return err(refusal("module-not-admitted", "This grant does not share this module."));
  }

  if (closedRefusal(grant.state) !== null || reached(boundOf(admission.duration), now)) {
    return ok("ended");
  }

  if (context.subjectAvailability === "unavailable") {
    return ok("unavailable");
  }

  if (observation.withheldUntilReReviewed) {
    return ok("withheld");
  }

  switch (observation.presence) {
    case "none":
      return ok("empty");
    case "partial":
      return ok("partial");
    case "complete":
      return ok(null);
    default:
      return assertNever(observation.presence, "module content presence");
  }
}

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------

/** What a worker supplies to invite one named coach over named ministries. */
export interface GrantInvitation {
  readonly grantId: string;
  readonly workerPrincipalId: string;
  readonly coachPrincipalId: string;
  readonly ministryIds: readonly string[];
  readonly duration: ShareDuration | null;
  readonly financialRange: CoachingFinancialRange | null;
  readonly issuedAt: Temporal.Instant;
  readonly expiresAt: Temporal.Instant;
  readonly revision: number;
}

/** The refusal for a reviewed financial range that is not a coherent one, or `null` when it is. */
function rangeRefusal(financialRange: CoachingFinancialRange): CoachingRefusal | null {
  if (Temporal.PlainDate.compare(financialRange.from, financialRange.to) > 0) {
    return refusal(
      "invalid-selection",
      "The reviewed range ends before it starts, so no figure is stated for it.",
    );
  }

  if (financialRange.measures.length === 0) {
    return refusal(
      "invalid-selection",
      "No reviewed figure is recorded for this range, so nothing is shown rather than a zero.",
    );
  }

  const currencies = new Set<string>();
  for (const measure of financialRange.measures) {
    const currency = measure.amount.currency;
    if (currencies.has(currency)) {
      const message = `The range states two figures in ${currency}; one figure per currency keeps them apart.`;
      return refusal("invalid-selection", message);
    }
    currencies.add(currency);
  }

  return null;
}

/**
 * Creates the invitation an episode begins with: nothing shared, no acceptance recorded.
 *
 * Outcomes: the invited grant with every module unselected and no cutoff yet, or a `CoachingRefusal` —
 * `invalid-selection` for a missing identifier, no ministry, a worker inviting themselves or an
 * invitation that expires before it is issued, `missing-duration` when no duration is named (an
 * invitation names one), `invalid-duration` when the zone or date cannot be resolved, and
 * `invalid-selection` for an incoherent reviewed range.
 */
export function inviteGrant(input: GrantInvitation): Result<CoachingGrant, CoachingRefusal> {
  const identifiers = [
    input.grantId,
    input.workerPrincipalId,
    input.coachPrincipalId,
    ...input.ministryIds,
  ];
  if (!identifiers.every(isNonEmpty) || input.ministryIds.length === 0) {
    return err(
      refusal(
        "invalid-selection",
        "An invitation names a grant, the worker, one coach and at least one ministry, all by identifier.",
      ),
    );
  }

  if (input.workerPrincipalId === input.coachPrincipalId) {
    return err(
      refusal("invalid-selection", "A worker cannot invite their own principal as coach."),
    );
  }

  if (new Set(input.ministryIds).size !== input.ministryIds.length) {
    return err(refusal("invalid-selection", "An invitation names each ministry once."));
  }

  if (Temporal.Instant.compare(input.issuedAt, input.expiresAt) >= 0) {
    return err(
      refusal("invalid-selection", "An invitation must stop being acceptable after it is issued."),
    );
  }

  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    return err(
      refusal("invalid-selection", "A new invitation starts from a whole revision number."),
    );
  }

  if (input.financialRange !== null) {
    const rangeProblem = rangeRefusal(input.financialRange);
    if (rangeProblem !== null) return err(rangeProblem);
  }

  if (input.duration === null) {
    return err(
      refusal(
        "missing-duration",
        "An invitation names a duration: a missing duration is not permission.",
      ),
    );
  }

  const duration = pendingDuration(input.duration);
  if (!duration.ok) return err(duration.error);

  return ok({
    grantId: input.grantId,
    workerPrincipalId: input.workerPrincipalId,
    coachPrincipalId: input.coachPrincipalId,
    ministryIds: [...input.ministryIds],
    modules: { ...NO_MODULES_SELECTED },
    duration: duration.value,
    financialRange: input.financialRange,
    state: "invited",
    identityVerification: "unverified",
    acceptedAt: null,
    invitation: {
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      supersededBy: null,
    },
    revision: input.revision,
  });
}

/** What a coach supplies to accept an invitation deliberately, with a verified identity. */
export interface GrantAcceptance {
  readonly acceptedBy: string;
  readonly identityVerification: CoachIdentityVerification;
  readonly expectedRevision: number;
}

/** The chosen duration a persisted one records, so acceptance can freeze it again from its own terms. */
function chosenDuration(duration: GrantDuration): ShareDuration | null {
  if (duration.kind === "ongoing") {
    return { kind: "ongoing", frozenZone: duration.frozenZone };
  }
  return duration.shareThroughDate === null
    ? null
    : {
        kind: "through-date",
        shareThroughDate: duration.shareThroughDate,
        frozenZone: duration.frozenZone,
      };
}

/**
 * Accepts an invitation: the coach's deliberate acceptance, verified identity and a frozen cutoff.
 *
 * Outcomes: the accepted episode with its cutoff frozen at `now`, or a `CoachingRefusal` — the
 * closure that already ended it (`superseded`, `revoked`, `expired`, `ended`, `left`), `stale-action`
 * when it was already accepted, `not-holder` for any principal but the named coach, `expired` once the
 * invitation's own window has closed, `identity-not-verified`, `missing-duration`, `stale-revision`
 * and `invalid-duration`.
 *
 * A Share-through date that has already passed is accepted and freezes a cutoff in the past, so the
 * first read is denied rather than the acceptance being silently rewritten.
 */
export function acceptGrant(
  grant: CoachingGrant,
  input: GrantAcceptance,
  now: Temporal.Instant,
): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.acceptedBy, "coach");
  if (notHolder !== null) return err(notHolder);

  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);

  if (grant.state === "accepted" || grant.state === "active") {
    return err(
      refusal(
        "stale-action",
        "This invitation was already accepted, and accepting it again changes nothing.",
      ),
    );
  }

  if (Temporal.Instant.compare(now, grant.invitation.expiresAt) >= 0) {
    return err(refusal("expired", "The invitation's own window closed before it was accepted."));
  }

  if (input.identityVerification !== "verified") {
    return err(
      refusal(
        "identity-not-verified",
        "Acceptance needs a verified identity; a matching address or an existing relationship verifies none.",
      ),
    );
  }

  if (grant.duration === null) {
    return err(
      refusal("missing-duration", "This grant states no duration, so accepting it shares nothing."),
    );
  }

  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);

  const chosen = chosenDuration(grant.duration);
  const frozen = freezeShareDuration(chosen, now);
  if (!frozen.ok) return err(frozen.error);

  return ok({
    ...grant,
    duration: frozen.value,
    state: "active",
    identityVerification: "verified",
    acceptedAt: now,
    revision: grant.revision + 1,
  });
}

/** What a worker supplies to switch one or more modules on or off. */
export interface ModuleSelectionChange {
  readonly changedBy: string;
  readonly selection: ModuleSelection;
  readonly expectedRevision: number;
}

/**
 * Replaces the module selection of an open episode: the only way a module starts being shared.
 *
 * Outcomes: the grant with its new selection and revision, the same grant unchanged when the selection
 * already matched (the service answers `unchanged`), or a `CoachingRefusal` — `not-holder` for a
 * principal that is not the worker, the closure that ended the share, `not-accepted`,
 * `missing-duration`, `cutoff-reached` and `stale-revision`.
 *
 * Switching a module off stops it; switching it back on never restores what was shared before, because
 * nothing in this module keeps a copy of content a module's source owns.
 */
export function setModuleSelection(
  grant: CoachingGrant,
  input: ModuleSelectionChange,
  now: Temporal.Instant,
): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.changedBy, "worker");
  if (notHolder !== null) return err(notHolder);

  const notOpen = openEpisodeRefusal(grant, now);
  if (notOpen !== null) return err(notOpen);

  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);

  const unchanged = MODULE_KEYS.every((key) => input.selection[key] === grant.modules[key]);
  if (unchanged) return ok(grant);

  return ok({
    ...grant,
    modules: { ...input.selection },
    revision: grant.revision + 1,
  });
}

/** What a worker supplies to revoke a grant. */
export interface GrantRevocation {
  readonly revokedBy: string;
  readonly expectedRevision: number;
}

/**
 * Revokes a grant: the worker's own stop of the sharing, kept apart from ending the relationship.
 *
 * Outcomes: the revoked grant, or a `CoachingRefusal` — `not-holder` for a principal that is not the
 * worker, the closure that already ended it, and `stale-revision`.
 *
 * Revocation removes access from now on. It keeps the record of what was shared and never claims that
 * a figure a coach already saw was recalled.
 */
export function revokeGrant(
  grant: CoachingGrant,
  input: GrantRevocation,
): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.revokedBy, "worker");
  if (notHolder !== null) return err(notHolder);

  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);

  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);

  return ok({ ...grant, state: "revoked", revision: grant.revision + 1 });
}

/** What a worker supplies to end the coaching relationship. */
export interface GrantEnd {
  readonly endedBy: string;
  readonly expectedRevision: number;
}

/**
 * Ends the coaching relationship: the worker's closure of an accepted episode, kept apart from a
 * revocation and from the coach leaving.
 *
 * Outcomes: the ended grant, or a `CoachingRefusal` — `not-holder` for a principal that is not the
 * worker, the closure that already ended it, `not-accepted` for an invitation nobody accepted, and
 * `stale-revision`.
 */
export function endGrant(
  grant: CoachingGrant,
  input: GrantEnd,
): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.endedBy, "worker");
  if (notHolder !== null) return err(notHolder);

  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);

  if (grant.acceptedAt === null) {
    return err(
      refusal(
        "not-accepted",
        "This invitation was never accepted, so there is no relationship to end.",
      ),
    );
  }

  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);

  return ok({ ...grant, state: "ended", revision: grant.revision + 1 });
}

/** What a coach supplies to leave a coaching relationship. */
export interface GrantDeparture {
  readonly leftBy: string;
  readonly expectedRevision: number;
}

/**
 * Records that the coach left: the coach's own closure, which is neither a revocation nor the worker
 * ending the relationship.
 *
 * Outcomes: the grant in its `left` state, or a `CoachingRefusal` — `not-holder` for a principal that
 * is not the named coach, the closure that already ended it, `not-accepted`, and `stale-revision`.
 */
export function leaveGrant(
  grant: CoachingGrant,
  input: GrantDeparture,
): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.leftBy, "coach");
  if (notHolder !== null) return err(notHolder);

  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);

  if (grant.acceptedAt === null) {
    return err(
      refusal(
        "not-accepted",
        "This invitation was never accepted, so the coach has nothing to leave.",
      ),
    );
  }

  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);

  return ok({ ...grant, state: "left", revision: grant.revision + 1 });
}

/** What a worker supplies to replace an invitation with a newer one. */
export interface GrantSupersession {
  readonly changedBy: string;
  readonly supersededBy: string;
  readonly expectedRevision: number;
}

/**
 * Supersedes an unaccepted invitation by naming the newer one that replaces it.
 *
 * Outcomes: the superseded grant, or a `CoachingRefusal` — `invalid-selection` when the replacement is
 * not named, `not-holder` for a principal that is not the worker, the closure that already ended it,
 * `stale-revision`, and `stale-action` once the invitation was accepted: an accepted episode is closed
 * by revocation or by ending it, never silently by a newer invitation.
 */
export function supersedeGrant(
  grant: CoachingGrant,
  input: GrantSupersession,
): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.changedBy, "worker");
  if (notHolder !== null) return err(notHolder);

  if (!isNonEmpty(input.supersededBy)) {
    return err(
      refusal(
        "invalid-selection",
        "A supersession names the newer invitation that replaces this one.",
      ),
    );
  }

  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);

  if (grant.state !== "invited") {
    return err(
      refusal(
        "stale-action",
        "This invitation was accepted: revoke the grant or end the relationship instead of replacing it.",
      ),
    );
  }

  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);

  return ok({
    ...grant,
    state: "superseded",
    invitation: { ...grant.invitation, supersededBy: input.supersededBy },
    revision: grant.revision + 1,
  });
}

// ---------------------------------------------------------------------------------------------
// The reviewed financial range
// ---------------------------------------------------------------------------------------------

/** One reviewed figure, formatted for its own currency with the state it was read in. */
export interface FinancialRangeEntry {
  readonly currency: string;
  /** The currency's exponent, or `null` for a code the currency table does not hold. */
  readonly exponent: number | null;
  readonly state: AmountState;
  readonly formatting: MinorFormatting;
}

/** The reviewed range as a surface presents it: the period, and one entry per currency. */
export interface FinancialRangeDescription {
  readonly from: string;
  readonly to: string;
  readonly entries: readonly FinancialRangeEntry[];
}

/**
 * Formats the separately reviewed fixed range and each figure in it, one entry per currency.
 *
 * Outcomes: the period in the stored calendar form plus one formatted entry per currency with its own
 * state and exponent, or a `CoachingRefusal` (`invalid-selection`) for a range that ends before it
 * starts, states no figure, or states two figures in one currency.
 *
 * There is deliberately no combined value and no drilldown: a figure carries its own state, a missing
 * or unknown one keeps its own words instead of becoming a zero, and two currencies are never added
 * into a total nobody reviewed.
 */
export function describeFinancialRange(
  financialRange: CoachingFinancialRange,
  locale: string,
): Result<FinancialRangeDescription, CoachingRefusal> {
  const rangeProblem = rangeRefusal(financialRange);
  if (rangeProblem !== null) return err(rangeProblem);

  const entries: FinancialRangeEntry[] = financialRange.measures.map((measure) => ({
    currency: measure.amount.currency,
    exponent: exponentOf(measure.amount.currency) ?? null,
    state: measure.state,
    formatting: formatMinor(measure.amount, measure.state, locale),
  }));

  return ok({
    from: serialiseCivilDate(financialRange.from),
    to: serialiseCivilDate(financialRange.to),
    entries,
  });
}
