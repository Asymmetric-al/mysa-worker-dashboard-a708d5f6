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
export const MODULE_KEYS = ["support-goal", "support-results", "targets", "check-ins", "task-summaries"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export type ModuleSelection = Readonly<Record<ModuleKey, boolean>>;
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
const earlierOf = (first: Temporal.Instant | null, second: Temporal.Instant | null): Temporal.Instant | null => (first === null ? second : second === null ? first : Temporal.Instant.compare(first, second) <= 0 ? first : second);
const boundOf = (duration: GrantDuration): Temporal.Instant | null => earlierOf(duration.cutoffInstant, duration.sourceLimitInstant);
const reached = (bound: Temporal.Instant | null, now: Temporal.Instant): boolean => bound !== null && Temporal.Instant.compare(now, bound) >= 0;
const remainingUntil = (bound: Temporal.Instant | null, now: Temporal.Instant): number | null => (bound === null || reached(bound, now) ? null : bound.epochMilliseconds - now.epochMilliseconds);
const CLOSED_GRANT_REFUSALS: Readonly<Record<Exclude<GrantLifecycleState, "invited" | "accepted" | "active">, CoachingRefusal>> = {
  revoked: refusal("revoked", "This grant was revoked, so nothing is readable here."),
  expired: refusal("expired", "This share window expired, so nothing is readable here."),
  ended: refusal("ended", "This coaching relationship ended, so nothing is readable here."),
  left: refusal("left", "The coach left this coaching relationship, so nothing is readable here."),
  superseded: refusal("superseded", "This invitation was replaced by a newer one before it was accepted."),
};
const closedRefusal = (state: GrantLifecycleState): CoachingRefusal | null => (state === "invited" || state === "accepted" || state === "active" ? null : CLOSED_GRANT_REFUSALS[state]);
const holderRefusal = (grant: CoachingGrant, actorPrincipalId: string, role: CoachingActorRole): CoachingRefusal | null => (actorPrincipalId === (role === "coach" ? grant.coachPrincipalId : grant.workerPrincipalId) ? null : refusal("not-holder", "This action belongs to the other side of the coaching relationship."));
const refusalOfNotAccepted = (message: string): CoachingRefusal => refusal("not-accepted", message);
/** The closure every grant-ending action shares: the holder check, the state's own closure, and — where the action needs one — the acceptance a relationship requires. */
const closureBlockedBy = (grant: CoachingGrant, actorPrincipalId: string, role: CoachingActorRole, acceptedRefusal: string | null): CoachingRefusal | null =>
  holderRefusal(grant, actorPrincipalId, role) ?? closedRefusal(grant.state) ?? (acceptedRefusal === null || grant.acceptedAt !== null ? null : refusalOfNotAccepted(acceptedRefusal));
/** Every closure of a grant answers the same way: the refusal it found, or the record it changed. */
const grantTransition = (blocked: CoachingRefusal | null, apply: () => CoachingGrant): Result<CoachingGrant, CoachingRefusal> => (blocked === null ? ok(apply()) : err(blocked));
type Admission = { readonly admitted: true; readonly duration: GrantDuration } | { readonly admitted: false; readonly refusal: CoachingRefusal };
function admitToGrant(grant: CoachingGrant, context: CoachingAccessContext): Admission {
  const notHolder = holderRefusal(grant, context.actor.principalId, context.actor.role);
  if (notHolder !== null) return { admitted: false, refusal: notHolder };
  if (!grant.ministryIds.includes(context.ministryId)) return { admitted: false, refusal: refusal("ministry-not-admitted", "This grant does not cover the context this read is scoped to.") };
  if (grant.duration === null) return { admitted: false, refusal: refusal("missing-duration", "This grant states no duration, so nothing is shared: a missing duration is not permission.") };
  if (grant.acceptedAt === null) return { admitted: false, refusal: refusal("not-accepted", "This invitation has not been accepted, so nothing is shared yet.") };
  if (grant.identityVerification !== "verified") return { admitted: false, refusal: refusal("identity-not-verified", "The coach's identity is not verified, so access does not begin.") };
  return context.permissionHold === "temporary" ? { admitted: false, refusal: refusal("permission-hold", "Access is on a temporary hold. The relationship is not over, and nothing here reports it as one.") } : { admitted: true, duration: grant.duration };
}
const revisionRefusal = (grant: CoachingGrant, expectedRevision: number): CoachingRefusal | null => (expectedRevision === grant.revision ? null : refusal("stale-revision", `Revision ${String(expectedRevision)} was expected and the record is at ${String(grant.revision)}; nothing changed.`));
function openEpisodeRefusal(grant: CoachingGrant, now: Temporal.Instant): CoachingRefusal | null {
  const closed = closedRefusal(grant.state);
  if (closed !== null) return closed;
  if (grant.acceptedAt === null) return refusal("not-accepted", "This invitation has not been accepted, so nothing is shared yet.");
  return grant.duration === null ? refusal("missing-duration", "This grant states no duration, so nothing is shared: a missing duration is not permission.") : reached(boundOf(grant.duration), now) ? refusal("cutoff-reached", "This share window is closed at its frozen bound, so no new read is admitted.") : null;
}
const ONGOING_WORDING = "Open-ended, with no Share-through date of its own";
const shareThroughWording = (date: CivilDate): string => `Shared through ${serialiseCivilDate(date)}`;
const SOURCE_BOUND_SETTLEMENT: { readonly resolution: GrantDurationResolution; readonly disagrees: boolean } = { resolution: "not-a-civil-day-start", disagrees: true };
/** The members a duration states only once it is frozen or bounded; both builders below start from these. */
const DURATION_UNSETTLED: Omit<GrantDuration, "kind" | "frozenZone"> = { shareThroughDate: null, cutoffInstant: null, sourceLimitInstant: null, limitedBy: null, nominalWording: ONGOING_WORDING, resolution: null, nominalDisagreesWithResolved: false, settledAt: null };
const ongoingDuration = (frozenZone: string, sourceLimitInstant: Temporal.Instant | null, settledAt: Temporal.Instant): GrantDuration => ({
  ...DURATION_UNSETTLED,
  kind: "ongoing",
  frozenZone,
  sourceLimitInstant,
  limitedBy: sourceLimitInstant === null ? null : "source",
  nominalDisagreesWithResolved: sourceLimitInstant !== null,
  settledAt,
});
const pendingGrantDuration = (kind: GrantDuration["kind"], shareThroughDate: CivilDate | null, frozenZone: string): GrantDuration => ({ ...DURATION_UNSETTLED, kind, shareThroughDate, frozenZone, nominalWording: shareThroughDate === null ? ONGOING_WORDING : shareThroughWording(shareThroughDate) });
const throughDateDuration = (
  shareThroughDate: CivilDate,
  frozenZone: string,
  cutoffInstant: Temporal.Instant,
  sourceLimitInstant: Temporal.Instant | null,
  limitedBy: "share-through" | "source",
  settlement: { readonly resolution: GrantDurationResolution; readonly disagrees: boolean },
  settledAt: Temporal.Instant,
): GrantDuration => ({ kind: "through-date", shareThroughDate, frozenZone, cutoffInstant, sourceLimitInstant, limitedBy, nominalWording: shareThroughWording(shareThroughDate), resolution: settlement.resolution, nominalDisagreesWithResolved: settlement.disagrees, settledAt });
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
  if (duration.kind === "ongoing") return ok(ongoingDuration(duration.frozenZone, sourceLimit, acceptedAt));
  const cutoff = shareCutoff({ shareThroughDate: duration.shareThroughDate, frozenZone: duration.frozenZone, sourceLimit: sourceLimit ?? undefined });
  if (cutoff.status === "refused") return err(refusal("invalid-duration", "The chosen Share-through date and zone do not resolve to a cutoff, so no bound is stated."));
  if (cutoff.limitedBy === "source") return ok(throughDateDuration(duration.shareThroughDate, duration.frozenZone, cutoff.cutoffInstant, cutoff.sourceLimitInstant, "source", SOURCE_BOUND_SETTLEMENT, acceptedAt));
  return ok(throughDateDuration(duration.shareThroughDate, duration.frozenZone, cutoff.cutoffInstant, null, "share-through", settlementOf(cutoff.cutoffInstant, duration.frozenZone), acceptedAt));
}
const pendingDuration = (duration: ShareDuration): Result<GrantDuration, CoachingRefusal> =>
  duration.kind === "through-date" && shareCutoff({ shareThroughDate: duration.shareThroughDate, frozenZone: duration.frozenZone }).status === "refused"
    ? err(refusal("invalid-duration", "The chosen Share-through date and zone do not resolve to a cutoff, so this duration is refused."))
    : ok(pendingGrantDuration(duration.kind, duration.kind === "through-date" ? duration.shareThroughDate : null, duration.frozenZone));
/** Reads the open episode of one grant at `now`, or the reason it is not open. */ export function activeGrant(grant: CoachingGrant, context: CoachingAccessContext, now: Temporal.Instant): Result<ActiveCoachingEpisode, CoachingRefusal> {
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
export const admittedModules = (grant: CoachingGrant, context: CoachingAccessContext, now: Temporal.Instant): Result<readonly ModuleKey[], CoachingRefusal> => {
  const episode = activeGrant(grant, context, now);
  return episode.ok ? ok(episode.value.admittedModules) : err(episode.error);
};
/** The single guard every coach-facing read of one module passes through. */
export function assertModuleAdmitted(grant: CoachingGrant, key: ModuleKey, context: CoachingAccessContext, now: Temporal.Instant): Result<ModuleKey, CoachingRefusal> {
  const episode = activeGrant(grant, context, now);
  return !episode.ok ? err(episode.error) : !grant.modules[key] ? err(refusal("module-not-admitted", "This grant does not share this module.")) : ok(key);
}
export function moduleReadState(grant: CoachingGrant, key: ModuleKey, context: CoachingAccessContext, now: Temporal.Instant, observation: ModuleObservation): Result<ModuleReadState | null, CoachingRefusal> {
  const admission = admitToGrant(grant, context);
  if (!admission.admitted) return err(admission.refusal);
  if (!grant.modules[key]) return err(refusal("module-not-admitted", "This grant does not share this module."));
  if (closedRefusal(grant.state) !== null || reached(boundOf(admission.duration), now)) return ok("ended");
  if (context.subjectAvailability === "unavailable") return ok("unavailable");
  return observation.withheldUntilReReviewed ? ok("withheld") : observation.presence === "none" ? ok("empty") : observation.presence === "partial" ? ok("partial") : observation.presence === "complete" ? ok(null) : assertNever(observation.presence, "module content presence");
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
  const currencies = financialRange.measures.map((measure) => measure.amount.currency);
  const repeated = currencies.find((currency, index) => currencies.indexOf(currency) !== index);
  return repeated === undefined ? null : refusal("invalid-selection", `The range states two figures in ${repeated}; one figure per currency keeps them apart.`);
}
/** Creates the invitation an episode begins with: nothing shared, no acceptance recorded. */ export function inviteGrant(input: GrantInvitation): Result<CoachingGrant, CoachingRefusal> {
  if (![input.grantId, input.workerPrincipalId, input.coachPrincipalId, ...input.ministryIds].every(isNonEmpty) || input.ministryIds.length === 0) return err(refusal("invalid-selection", "An invitation names a grant, the worker, one coach and at least one ministry, all by identifier."));
  if (input.workerPrincipalId === input.coachPrincipalId) return err(refusal("invalid-selection", "A worker cannot invite their own principal as coach."));
  if (new Set(input.ministryIds).size !== input.ministryIds.length) return err(refusal("invalid-selection", "An invitation names each ministry once."));
  if (Temporal.Instant.compare(input.issuedAt, input.expiresAt) >= 0) return err(refusal("invalid-selection", "An invitation must stop being acceptable after it is issued."));
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) return err(refusal("invalid-selection", "A new invitation starts from a whole revision number."));
  const rangeProblem = input.financialRange === null ? null : rangeRefusal(input.financialRange);
  if (rangeProblem !== null) return err(rangeProblem);
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
const chosenDuration = (duration: GrantDuration): ShareDuration | null => (duration.kind === "ongoing" ? { kind: "ongoing", frozenZone: duration.frozenZone } : duration.shareThroughDate === null ? null : { kind: "through-date", shareThroughDate: duration.shareThroughDate, frozenZone: duration.frozenZone });
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
  const frozen = freezeShareDuration(chosenDuration(grant.duration), now);
  return !frozen.ok ? err(frozen.error) : ok({ ...grant, duration: frozen.value, state: "active", identityVerification: "verified", acceptedAt: now, revision: grant.revision + 1 });
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
  return MODULE_KEYS.every((key) => input.selection[key] === grant.modules[key]) ? ok(grant) : ok({ ...grant, modules: { ...input.selection }, revision: grant.revision + 1 });
}
export type GrantRevocation = { readonly revokedBy: string; readonly expectedRevision: number };
/** Revokes a grant: the worker's own stop of the sharing, kept apart from ending the relationship. */
export const revokeGrant = (grant: CoachingGrant, input: GrantRevocation): Result<CoachingGrant, CoachingRefusal> => grantTransition(closureBlockedBy(grant, input.revokedBy, "worker", null) ?? revisionRefusal(grant, input.expectedRevision), () => ({ ...grant, state: "revoked", revision: grant.revision + 1 }));
export type GrantEnd = { readonly endedBy: string; readonly expectedRevision: number };
/** Ends the coaching relationship: the worker's closure of an accepted episode, kept apart from a revocation and from the coach leaving. */
export const endGrant = (grant: CoachingGrant, input: GrantEnd): Result<CoachingGrant, CoachingRefusal> =>
  grantTransition(closureBlockedBy(grant, input.endedBy, "worker", "This invitation was never accepted, so there is no relationship to end.") ?? revisionRefusal(grant, input.expectedRevision), () => ({ ...grant, state: "ended", revision: grant.revision + 1 }));
export type GrantDeparture = { readonly leftBy: string; readonly expectedRevision: number };
/** Records that the coach left: the coach's own closure, which is neither a revocation nor the worker ending the relationship. */
export const leaveGrant = (grant: CoachingGrant, input: GrantDeparture): Result<CoachingGrant, CoachingRefusal> =>
  grantTransition(closureBlockedBy(grant, input.leftBy, "coach", "This invitation was never accepted, so the coach has nothing to leave.") ?? revisionRefusal(grant, input.expectedRevision), () => ({ ...grant, state: "left", revision: grant.revision + 1 }));
export type GrantSupersession = { readonly changedBy: string; readonly supersededBy: string; readonly expectedRevision: number };
/** Supersedes an unaccepted invitation by naming the newer one that replaces it. */ export const supersedeGrant = (grant: CoachingGrant, input: GrantSupersession): Result<CoachingGrant, CoachingRefusal> =>
  grantTransition(
    holderRefusal(grant, input.changedBy, "worker") ??
      (isNonEmpty(input.supersededBy) ? null : refusal("invalid-selection", "A supersession names the newer invitation that replaces this one.")) ??
      closedRefusal(grant.state) ??
      (grant.state === "invited" ? null : refusal("stale-action", "This invitation was accepted: revoke the grant or end the relationship instead of replacing it.")) ??
      revisionRefusal(grant, input.expectedRevision),
    () => ({ ...grant, state: "superseded", invitation: { ...grant.invitation, supersededBy: input.supersededBy }, revision: grant.revision + 1 }),
  );
export type FinancialRangeEntry = { readonly currency: string; readonly exponent: number | null; readonly state: AmountState; readonly formatting: MinorFormatting };
export type FinancialRangeDescription = { readonly from: string; readonly to: string; readonly entries: readonly FinancialRangeEntry[] };
/** Formats the separately reviewed fixed range and each figure in it, one entry per currency. */
export function describeFinancialRange(financialRange: CoachingFinancialRange, locale: string): Result<FinancialRangeDescription, CoachingRefusal> {
  const rangeProblem = rangeRefusal(financialRange);
  if (rangeProblem !== null) return err(rangeProblem);
  const entries: FinancialRangeEntry[] = financialRange.measures.map((measure) => ({ currency: measure.amount.currency, exponent: exponentOf(measure.amount.currency) ?? null, state: measure.state, formatting: formatMinor(measure.amount, measure.state, locale) }));
  return ok({ from: serialiseCivilDate(financialRange.from), to: serialiseCivilDate(financialRange.to), entries });
}
