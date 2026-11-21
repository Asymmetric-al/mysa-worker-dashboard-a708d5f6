/** The coaching grant: the one implementation of a coaching relationship's episode and of what an admitted coach may read. */
import { Temporal } from "temporal-polyfill";
import { assertNever, err, ok, type Result } from "@/lib/result";
import type { Money } from "@/modules/money/amount";
import { exponentOf } from "@/modules/money/currency";
import { formatMinor, type MinorFormatting } from "@/modules/money/format";
import { civilDateAt, serialiseCivilDate, startOfCivilDay, type CivilDate } from "@/modules/time/civil";
import { shareCutoff, type MidnightResolution } from "@/modules/time/window";
export const GRANT_LIFECYCLE_STATES = ["invited", "accepted", "active", "revoked", "expired", "ended", "left", "superseded"] as const;
export type GrantLifecycleState = (typeof GRANT_LIFECYCLE_STATES)[number];
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
export type CoachingRefusalReason = (typeof COACHING_REFUSAL_REASONS)[number];
export type CoachingRefusal = { readonly reason: CoachingRefusalReason; readonly message: string };
const refusal = (reason: CoachingRefusalReason, message: string): CoachingRefusal => ({ reason, message });
/** The five modules a grant may share, and the one declaration of them. */
export const MODULE_KEYS = ["support-goal", "support-results", "targets", "check-ins", "task-summaries"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export type ModuleSelection = Readonly<Record<ModuleKey, boolean>>;
/** The invitation's selection: nothing shared until the worker switches a module on. */
export const NO_MODULES_SELECTED: ModuleSelection = { "support-goal": false, "support-results": false, targets: false, "check-ins": false, "task-summaries": false };
export const MODULE_READ_STATES = ["empty", "partial", "withheld", "unavailable", "ended"] as const;
export type ModuleReadState = (typeof MODULE_READ_STATES)[number];
export type ModuleObservation = { readonly presence: ModuleContentPresence; readonly withheldUntilReReviewed: boolean };
export type ModuleContentPresence = "none" | "partial" | "complete";
export type ShareDuration = { readonly kind: "ongoing"; readonly frozenZone: string } | { readonly kind: "through-date"; readonly shareThroughDate: CivilDate; readonly frozenZone: string };
export type GrantDurationResolution = MidnightResolution | "not-a-civil-day-start";
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
export type CoachIdentityVerification = "verified" | "unverified";
export type CoachingInvitation = { readonly issuedAt: Temporal.Instant; readonly expiresAt: Temporal.Instant; readonly supersededBy: string | null };
export type AmountState = Parameters<typeof formatMinor>[1];
export type FinancialRangeMeasure = { readonly amount: Money; readonly state: AmountState };
export type CoachingFinancialRange = { readonly from: CivilDate; readonly to: CivilDate; readonly measures: readonly FinancialRangeMeasure[] };
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
export type CoachingActorRole = "worker" | "coach";
export type CoachingActor = { readonly role: CoachingActorRole; readonly principalId: string };
export type SubjectAvailability = "available" | "unavailable";
export type PermissionHold = "none" | "temporary";
export type CoachingAccessContext = { readonly actor: CoachingActor; readonly organizationId: string; readonly ministryId: string; readonly subjectAvailability: SubjectAvailability; readonly permissionHold: PermissionHold };
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
const isNonEmpty = (value: string): boolean => value.trim().length > 0;
const selectedKeys = (selection: ModuleSelection): ModuleKey[] => MODULE_KEYS.filter((key) => selection[key]);
function earlierOf(first: Temporal.Instant | null, second: Temporal.Instant | null): Temporal.Instant | null {
  if (first === null) return second;
  if (second === null) return first;
  return Temporal.Instant.compare(first, second) <= 0 ? first : second;
}
const boundOf = (duration: GrantDuration): Temporal.Instant | null => earlierOf(duration.cutoffInstant, duration.sourceLimitInstant);
const reached = (bound: Temporal.Instant | null, now: Temporal.Instant): boolean => bound !== null && Temporal.Instant.compare(now, bound) >= 0;
function remainingUntil(bound: Temporal.Instant | null, now: Temporal.Instant): number | null {
  if (bound === null || reached(bound, now)) return null;
  return bound.epochMilliseconds - now.epochMilliseconds;
}
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
      return refusal("left", "The coach left this coaching relationship, so nothing is readable here.");
    case "superseded":
      return refusal("superseded", "This invitation was replaced by a newer one before it was accepted.");
    default:
      return assertNever(state, "coaching grant state");
  }
}
function holderRefusal(grant: CoachingGrant, actorPrincipalId: string, role: CoachingActorRole): CoachingRefusal | null {
  const holder = role === "coach" ? grant.coachPrincipalId : grant.workerPrincipalId;
  return actorPrincipalId === holder ? null : refusal("not-holder", "This action belongs to the other side of the coaching relationship.");
}
type Admission = { readonly admitted: true; readonly duration: GrantDuration } | { readonly admitted: false; readonly refusal: CoachingRefusal };

function admitToGrant(grant: CoachingGrant, context: CoachingAccessContext): Admission {
  const notHolder = holderRefusal(grant, context.actor.principalId, context.actor.role);
  if (notHolder !== null) return { admitted: false, refusal: notHolder };
  if (!grant.ministryIds.includes(context.ministryId)) return { admitted: false, refusal: refusal("ministry-not-admitted", "This grant does not cover the context this read is scoped to.") };
  if (grant.duration === null) return { admitted: false, refusal: refusal("missing-duration", "This grant states no duration, so nothing is shared: a missing duration is not permission.") };
  if (grant.acceptedAt === null) return { admitted: false, refusal: refusal("not-accepted", "This invitation has not been accepted, so nothing is shared yet.") };
  if (grant.identityVerification !== "verified") return { admitted: false, refusal: refusal("identity-not-verified", "The coach's identity is not verified, so access does not begin.") };
  if (context.permissionHold === "temporary") return { admitted: false, refusal: refusal("permission-hold", "Access is on a temporary hold. The relationship is not over, and nothing here reports it as one.") };
  return { admitted: true, duration: grant.duration };
}
function revisionRefusal(grant: CoachingGrant, expectedRevision: number): CoachingRefusal | null {
  if (expectedRevision === grant.revision) return null;
  const expected = String(expectedRevision);
  const actual = String(grant.revision);
  return refusal("stale-revision", `Revision ${expected} was expected and the record is at ${actual}; nothing changed.`);
}
function openEpisodeRefusal(grant: CoachingGrant, now: Temporal.Instant): CoachingRefusal | null {
  const closed = closedRefusal(grant.state);
  if (closed !== null) return closed;
  if (grant.acceptedAt === null) return refusal("not-accepted", "This invitation has not been accepted, so nothing is shared yet.");
  if (grant.duration === null) return refusal("missing-duration", "This grant states no duration, so nothing is shared: a missing duration is not permission.");
  if (reached(boundOf(grant.duration), now)) return refusal("cutoff-reached", "This share window is closed at its frozen bound, so no new read is admitted.");
  return null;
}
const ONGOING_WORDING = "Open-ended, with no Share-through date of its own";
const shareThroughWording = (date: CivilDate): string => `Shared through ${serialiseCivilDate(date)}`;
function settlementOf(cutoffInstant: Temporal.Instant, frozenZone: string): { readonly resolution: GrantDurationResolution; readonly disagrees: boolean } {
  const localDay = civilDateAt(cutoffInstant, frozenZone);
  if (localDay.status === "refused") return { resolution: "not-a-civil-day-start", disagrees: true };
  const start = startOfCivilDay(localDay.date, frozenZone);
  if (start.status === "refused") return { resolution: "not-a-civil-day-start", disagrees: true };
  const aligned = Temporal.Instant.compare(start.instant, cutoffInstant) === 0;
  return { resolution: aligned ? start.resolution : "not-a-civil-day-start", disagrees: !aligned || start.resolution !== "aligned" };
}
/** Freezes a chosen duration into the persisted one at the acceptance instant. */
export function freezeShareDuration(duration: ShareDuration | null, acceptedAt: Temporal.Instant, options?: { readonly sourceLimit?: Temporal.Instant }): Result<GrantDuration, CoachingRefusal> {
  if (duration === null) return err(refusal("missing-duration", "This grant states no duration, so nothing is shared: a missing duration is not permission."));
  if (!isNonEmpty(duration.frozenZone)) return err(refusal("invalid-duration", "The chosen duration names no zone, so no cutoff can be resolved."));
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
  const cutoff = shareCutoff({ shareThroughDate: duration.shareThroughDate, frozenZone: duration.frozenZone, sourceLimit: sourceLimit ?? undefined });
  if (cutoff.status === "refused") return err(refusal("invalid-duration", "The chosen Share-through date and zone do not resolve to a cutoff, so no bound is stated."));
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
function pendingDuration(duration: ShareDuration): Result<GrantDuration, CoachingRefusal> {
  if (duration.kind === "through-date") {
    const probe = shareCutoff({ shareThroughDate: duration.shareThroughDate, frozenZone: duration.frozenZone });
    if (probe.status === "refused") return err(refusal("invalid-duration", "The chosen Share-through date and zone do not resolve to a cutoff, so this duration is refused."));
  }
  return ok({
    kind: duration.kind,
    shareThroughDate: duration.kind === "through-date" ? duration.shareThroughDate : null,
    frozenZone: duration.frozenZone,
    cutoffInstant: null,
    sourceLimitInstant: null,
    limitedBy: null,
    nominalWording: duration.kind === "through-date" ? shareThroughWording(duration.shareThroughDate) : ONGOING_WORDING,
    resolution: null,
    nominalDisagreesWithResolved: false,
    settledAt: null,
  });
}
/** Reads the open episode of one grant at `now`, or the reason it is not open. */
export function activeGrant(grant: CoachingGrant, context: CoachingAccessContext, now: Temporal.Instant): Result<ActiveCoachingEpisode, CoachingRefusal> {
  const admission = admitToGrant(grant, context);
  if (!admission.admitted) return err(admission.refusal);
  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);
  const bound = boundOf(admission.duration);
  if (reached(bound, now)) return err(refusal("cutoff-reached", "This share window is closed at its frozen bound, so no new read is admitted."));
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
export function admittedModules(grant: CoachingGrant, context: CoachingAccessContext, now: Temporal.Instant): Result<readonly ModuleKey[], CoachingRefusal> {
  const episode = activeGrant(grant, context, now);
  return episode.ok ? ok(episode.value.admittedModules) : err(episode.error);
}
/** The single guard every coach-facing read of one module passes through. */
export function assertModuleAdmitted(grant: CoachingGrant, key: ModuleKey, context: CoachingAccessContext, now: Temporal.Instant): Result<ModuleKey, CoachingRefusal> {
  const episode = activeGrant(grant, context, now);
  if (!episode.ok) return err(episode.error);
  if (!grant.modules[key]) return err(refusal("module-not-admitted", "This grant does not share this module."));
  return ok(key);
}
export function moduleReadState(grant: CoachingGrant, key: ModuleKey, context: CoachingAccessContext, now: Temporal.Instant, observation: ModuleObservation): Result<ModuleReadState | null, CoachingRefusal> {
  const admission = admitToGrant(grant, context);
  if (!admission.admitted) return err(admission.refusal);
  if (!grant.modules[key]) return err(refusal("module-not-admitted", "This grant does not share this module."));
  if (closedRefusal(grant.state) !== null || reached(boundOf(admission.duration), now)) return ok("ended");
  if (context.subjectAvailability === "unavailable") return ok("unavailable");
  if (observation.withheldUntilReReviewed) return ok("withheld");
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
function rangeRefusal(financialRange: CoachingFinancialRange): CoachingRefusal | null {
  if (Temporal.PlainDate.compare(financialRange.from, financialRange.to) > 0) return refusal("invalid-selection", "The reviewed range ends before it starts, so no figure is stated for it.");
  if (financialRange.measures.length === 0) return refusal("invalid-selection", "No reviewed figure is recorded for this range, so nothing is shown rather than a zero.");
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
/** Creates the invitation an episode begins with: nothing shared, no acceptance recorded. */
export function inviteGrant(input: GrantInvitation): Result<CoachingGrant, CoachingRefusal> {
  const identifiers = [input.grantId, input.workerPrincipalId, input.coachPrincipalId, ...input.ministryIds];
  if (!identifiers.every(isNonEmpty) || input.ministryIds.length === 0) return err(refusal("invalid-selection", "An invitation names a grant, the worker, one coach and at least one ministry, all by identifier."));
  if (input.workerPrincipalId === input.coachPrincipalId) return err(refusal("invalid-selection", "A worker cannot invite their own principal as coach."));
  if (new Set(input.ministryIds).size !== input.ministryIds.length) return err(refusal("invalid-selection", "An invitation names each ministry once."));
  if (Temporal.Instant.compare(input.issuedAt, input.expiresAt) >= 0) return err(refusal("invalid-selection", "An invitation must stop being acceptable after it is issued."));
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) return err(refusal("invalid-selection", "A new invitation starts from a whole revision number."));
  if (input.financialRange !== null) {
    const rangeProblem = rangeRefusal(input.financialRange);
    if (rangeProblem !== null) return err(rangeProblem);
  }
  if (input.duration === null) return err(refusal("missing-duration", "An invitation names a duration: a missing duration is not permission."));
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
    invitation: { issuedAt: input.issuedAt, expiresAt: input.expiresAt, supersededBy: null },
    revision: input.revision,
  });
}
export type GrantAcceptance = { readonly acceptedBy: string; readonly identityVerification: CoachIdentityVerification; readonly expectedRevision: number };
function chosenDuration(duration: GrantDuration): ShareDuration | null {
  if (duration.kind === "ongoing") return { kind: "ongoing", frozenZone: duration.frozenZone };
  return duration.shareThroughDate === null ? null : { kind: "through-date", shareThroughDate: duration.shareThroughDate, frozenZone: duration.frozenZone };
}
/** Accepts an invitation: the coach's deliberate acceptance, verified identity and a frozen cutoff. */
export function acceptGrant(grant: CoachingGrant, input: GrantAcceptance, now: Temporal.Instant): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.acceptedBy, "coach");
  if (notHolder !== null) return err(notHolder);
  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);
  if (grant.state === "accepted" || grant.state === "active") return err(refusal("stale-action", "This invitation was already accepted, and accepting it again changes nothing."));
  if (Temporal.Instant.compare(now, grant.invitation.expiresAt) >= 0) return err(refusal("expired", "The invitation's own window closed before it was accepted."));
  if (input.identityVerification !== "verified") return err(refusal("identity-not-verified", "Acceptance needs a verified identity; a matching address or an existing relationship verifies none."));
  if (grant.duration === null) return err(refusal("missing-duration", "This grant states no duration, so accepting it shares nothing."));
  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);
  const chosen = chosenDuration(grant.duration);
  const frozen = freezeShareDuration(chosen, now);
  if (!frozen.ok) return err(frozen.error);
  return ok({ ...grant, duration: frozen.value, state: "active", identityVerification: "verified", acceptedAt: now, revision: grant.revision + 1 });
}
export type ModuleSelectionChange = { readonly changedBy: string; readonly selection: ModuleSelection; readonly expectedRevision: number };
/** Replaces the module selection of an open episode: the only way a module starts being shared. */
export function setModuleSelection(grant: CoachingGrant, input: ModuleSelectionChange, now: Temporal.Instant): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.changedBy, "worker");
  if (notHolder !== null) return err(notHolder);
  const notOpen = openEpisodeRefusal(grant, now);
  if (notOpen !== null) return err(notOpen);
  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);
  const unchanged = MODULE_KEYS.every((key) => input.selection[key] === grant.modules[key]);
  if (unchanged) return ok(grant);
  return ok({ ...grant, modules: { ...input.selection }, revision: grant.revision + 1 });
}
export type GrantRevocation = { readonly revokedBy: string; readonly expectedRevision: number };
/** Revokes a grant: the worker's own stop of the sharing, kept apart from ending the relationship. */
export function revokeGrant(grant: CoachingGrant, input: GrantRevocation): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.revokedBy, "worker");
  if (notHolder !== null) return err(notHolder);
  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);
  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);
  return ok({ ...grant, state: "revoked", revision: grant.revision + 1 });
}
export type GrantEnd = { readonly endedBy: string; readonly expectedRevision: number };
/** Ends the coaching relationship: the worker's closure of an accepted episode, kept apart from a revocation and from the coach leaving. */
export function endGrant(grant: CoachingGrant, input: GrantEnd): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.endedBy, "worker");
  if (notHolder !== null) return err(notHolder);
  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);
  if (grant.acceptedAt === null) return err(refusal("not-accepted", "This invitation was never accepted, so there is no relationship to end."));
  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);
  return ok({ ...grant, state: "ended", revision: grant.revision + 1 });
}
export type GrantDeparture = { readonly leftBy: string; readonly expectedRevision: number };
/** Records that the coach left: the coach's own closure, which is neither a revocation nor the worker ending the relationship. */
export function leaveGrant(grant: CoachingGrant, input: GrantDeparture): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.leftBy, "coach");
  if (notHolder !== null) return err(notHolder);
  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);
  if (grant.acceptedAt === null) return err(refusal("not-accepted", "This invitation was never accepted, so the coach has nothing to leave."));
  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);
  return ok({ ...grant, state: "left", revision: grant.revision + 1 });
}
export type GrantSupersession = { readonly changedBy: string; readonly supersededBy: string; readonly expectedRevision: number };
/** Supersedes an unaccepted invitation by naming the newer one that replaces it. */
export function supersedeGrant(grant: CoachingGrant, input: GrantSupersession): Result<CoachingGrant, CoachingRefusal> {
  const notHolder = holderRefusal(grant, input.changedBy, "worker");
  if (notHolder !== null) return err(notHolder);
  if (!isNonEmpty(input.supersededBy)) return err(refusal("invalid-selection", "A supersession names the newer invitation that replaces this one."));
  const closed = closedRefusal(grant.state);
  if (closed !== null) return err(closed);
  if (grant.state !== "invited") return err(refusal("stale-action", "This invitation was accepted: revoke the grant or end the relationship instead of replacing it."));
  const revisionProblem = revisionRefusal(grant, input.expectedRevision);
  if (revisionProblem !== null) return err(revisionProblem);
  return ok({ ...grant, state: "superseded", invitation: { ...grant.invitation, supersededBy: input.supersededBy }, revision: grant.revision + 1 });
}
export type FinancialRangeEntry = { readonly currency: string; readonly exponent: number | null; readonly state: AmountState; readonly formatting: MinorFormatting };
export type FinancialRangeDescription = { readonly from: string; readonly to: string; readonly entries: readonly FinancialRangeEntry[] };
/** Formats the separately reviewed fixed range and each figure in it, one entry per currency. */
export function describeFinancialRange(financialRange: CoachingFinancialRange, locale: string): Result<FinancialRangeDescription, CoachingRefusal> {
  const rangeProblem = rangeRefusal(financialRange);
  if (rangeProblem !== null) return err(rangeProblem);
  const entries: FinancialRangeEntry[] = financialRange.measures.map((measure) => ({ currency: measure.amount.currency, exponent: exponentOf(measure.amount.currency) ?? null, state: measure.state, formatting: formatMinor(measure.amount, measure.state, locale) }));
  return ok({ from: serialiseCivilDate(financialRange.from), to: serialiseCivilDate(financialRange.to), entries });
}
