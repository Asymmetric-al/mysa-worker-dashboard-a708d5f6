/** The grant half of success criterion 16: the coaching episode, its frozen exclusive cutoff, the five independent module flags that start unselected, the ended-then-stale-action refusal. */
import { Temporal } from "temporal-polyfill";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { CoachingGrantRecord, CoachingTargetRecord, Scope } from "@/modules/data-service";
import { assertScopeUnder, canEdit, canExport, canView, type ResolvedSession } from "@/modules/data-service/authorize";
import { isOutcome } from "@/modules/data-service/outcome";
import {
  GRANT_LIFECYCLE_STATES,
  MODULE_KEYS,
  MODULE_READ_STATES,
  NO_MODULES_SELECTED,
  acceptGrant,
  activeGrant,
  admittedModules,
  assertModuleAdmitted,
  describeFinancialRange,
  endGrant,
  freezeShareDuration,
  inviteGrant,
  leaveGrant,
  moduleReadState,
  revokeGrant,
  setModuleSelection,
  supersedeGrant,
  type CoachingAccessContext,
  type CoachingActorRole,
  type CoachingGrant,
  type CoachingRefusal,
  type GrantDuration,
  type GrantLifecycleState,
  type ModuleKey,
  type ModuleSelection,
  type PermissionHold,
  type ShareDuration,
  type SubjectAvailability,
} from "@/modules/coaching/grant";
import {
  ACTIVITY_EVENT_KINDS,
  DEFAULT_TARGET_PERIOD,
  TARGET_MEASURES,
  TARGET_STATES,
  classifyActivity,
  coachTargetProgress,
  measureFor,
  resolvePeriodContaining,
  resolveTargetState,
  resolveTargetVersion,
  startProspectiveVersion,
  workerTargetProgress,
  type ActivityEvent,
  type ActivityEventKind,
  type PeriodAnchor,
  type ResolvedPeriod,
  type TargetMeasure,
  type TargetPeriod,
  type TargetRecord,
  type TargetVersion,
  type TargetVersionChange,
} from "@/modules/coaching/target";
import { SEED_INSTANT, now } from "@/modules/time/clock";
import { shareCutoff, shareThroughDateOfCutoff, shareWindowOpenAt } from "@/modules/time/window";
import { SEEDED_PERSONAS, seed, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { applySessionClock, buildSessionMeta, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
const WORKER = SEEDED_PERSONAS["established-worker"].principalId;
const COACH = SEEDED_PERSONAS.coach.principalId;
const OUTSIDER = SEEDED_PERSONAS.subscriber.principalId;
const SHARE_THROUGH = Temporal.PlainDate.from("2026-12-30");
const ISSUED_AT = SEED_INSTANT;
const INVITATION_EXPIRES_AT = SEED_INSTANT.add({ hours: 168 });
const ACCEPTED_AT = SEED_INSTANT;
const STORED_CUTOFF = "2026-12-31T00:00:00Z";
const GRANT_ID = "grant-domain-fixture";
const SHARED_MODULES: readonly ModuleKey[] = ["targets", "check-ins"];
const OPENING_WEEK_START = Temporal.PlainDate.from("2026-11-02");
interface SeededCoaching {
  readonly organizationId: Scope["organizationId"];
  readonly ministryId: string;
  readonly supportSubjectId: Scope["supportSubjectId"];
  readonly otherMinistryId: string;
  readonly frozenZone: string;
  readonly activeGrant: CoachingGrantRecord;
  readonly revokedGrant: CoachingGrantRecord;
  readonly conversationsTarget: CoachingTargetRecord;
}
let seeded: SeededCoaching;
function sessionDocumentOf(sessions: Awaited<ReturnType<typeof seed>>, sessionId: string): SessionStateDocument {
  const session = sessions.find((candidate) => candidate.sessionId === sessionId);
  if (session === undefined) throw new Error(`The seed lays down no session ${JSON.stringify(sessionId)}, so the coaching fixtures this file needs are absent.`);
  return session.documents.state;
}
function grantIn(document: SessionStateDocument, state: CoachingGrantRecord["state"]): CoachingGrantRecord {
  const record = document.coachingGrants.find((candidate) => candidate.state === state);
  if (record === undefined) throw new Error(`The seeded coaching share holds no ${state} relationship, so this case's fixture is no longer seeded.`);
  return record;
}
function targetIn(document: SessionStateDocument, measure: TargetMeasure): CoachingTargetRecord {
  const record = document.coachingTargets.find((candidate) => candidate.measure === measure);
  if (record === undefined) throw new Error(`The seeded coaching share states no target measured in ${measure}.`);
  return record;
}
async function loadSeededCoaching(): Promise<SeededCoaching> {
  const sessions = await seed();
  const worker = sessionDocumentOf(sessions, SEEDED_PERSONAS["established-worker"].defaultSessionId);
  const active = grantIn(worker, "active");
  const revoked = grantIn(worker, "revoked");
  const [contextMinistry] = active.ministryIds;
  const [otherMinistry] = revoked.ministryIds;
  const { selectedOrganizationId, selectedSupportSubjectId } = worker.context;
  if (contextMinistry === undefined || otherMinistry === undefined || selectedOrganizationId === null || selectedSupportSubjectId === null) throw new Error("The seeded session selects no organization or support subject, or its relationship states no ministry, so no scope can be named.");
  return { organizationId: selectedOrganizationId, ministryId: contextMinistry, otherMinistryId: otherMinistry, supportSubjectId: selectedSupportSubjectId, frozenZone: active.duration.frozenZone, activeGrant: active, revokedGrant: revoked, conversationsTarget: targetIn(worker, "conversations") };
}
beforeAll(async () => {
  seeded = await loadSeededCoaching();
});
function sessionMetaAt(offsetMilliseconds: number) {
  return buildSessionMeta({ principalId: WORKER, admittedMemberships: [], sessionState: "signed-in", clockOffsetMs: offsetMilliseconds });
}
function clockAt(offsetMilliseconds: number): Temporal.Instant {
  applySessionClock(sessionMetaAt(offsetMilliseconds));
  return now();
}
function offsetOf(instant: Temporal.Instant): number {
  return instant.epochMilliseconds - SEED_INSTANT.epochMilliseconds;
}
afterEach(() => {
  applySessionClock(sessionMetaAt(0));
});
interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}
interface Refused<E> {
  readonly ok: false;
  readonly error: E;
}
function valueOf<T, E>(result: Ok<T> | Refused<E>, label: string): T {
  if (!result.ok) throw new Error(`${label} was refused: ${JSON.stringify(result.error)}`);
  return result.value;
}
function refusalOf<T, E>(result: Ok<T> | Refused<E>, label: string): E {
  if (result.ok) throw new Error(`${label} was accepted, and this case needs its refusal`);
  return result.error;
}
function selectionWith(on: readonly ModuleKey[]): ModuleSelection {
  const selection: Record<ModuleKey, boolean> = { ...NO_MODULES_SELECTED };
  for (const key of MODULE_KEYS) {
    selection[key] = on.includes(key);
  }
  return selection;
}
function invitationOf(overrides: { readonly shareThroughDate?: Temporal.PlainDate | null } = {}): CoachingGrant {
  const shareThroughDate = overrides.shareThroughDate === undefined ? SHARE_THROUGH : overrides.shareThroughDate;
  const duration: ShareDuration = shareThroughDate === null ? { kind: "ongoing", frozenZone: seeded.frozenZone } : { kind: "through-date", shareThroughDate, frozenZone: seeded.frozenZone };
  return valueOf(inviteGrant({ grantId: GRANT_ID, workerPrincipalId: WORKER, coachPrincipalId: COACH, ministryIds: [seeded.ministryId], duration, financialRange: null, issuedAt: ISSUED_AT, expiresAt: INVITATION_EXPIRES_AT, revision: 0 }), "inviteGrant");
}
function acceptedFrom(invited: CoachingGrant, acceptedAt: Temporal.Instant): CoachingGrant {
  return valueOf(acceptGrant(invited, { acceptedBy: COACH, identityVerification: "verified", expectedRevision: invited.revision }, acceptedAt), "acceptGrant");
}
function grantOf(overrides: { readonly modules?: readonly ModuleKey[]; readonly shareThroughDate?: Temporal.PlainDate | null } = {}): CoachingGrant {
  const accepted = acceptedFrom(invitationOf(overrides), ACCEPTED_AT);
  return valueOf(setModuleSelection(accepted, { changedBy: WORKER, selection: selectionWith(overrides.modules ?? SHARED_MODULES), expectedRevision: accepted.revision }, ACCEPTED_AT), "setModuleSelection");
}
function grantUnderSourceLimit(sourceLimit: Temporal.Instant): CoachingGrant {
  const accepted = acceptedFrom(invitationOf(), ACCEPTED_AT);
  const duration: GrantDuration = valueOf(freezeShareDuration({ kind: "through-date", shareThroughDate: SHARE_THROUGH, frozenZone: seeded.frozenZone }, ACCEPTED_AT, { sourceLimit }), "freezeShareDuration");
  return { ...accepted, duration };
}
function frozenCutoffOf(grant: CoachingGrant): Temporal.Instant {
  const duration = grant.duration;
  if (duration === null || duration.cutoffInstant === null) throw new Error("This fixture grant states no cutoff, so the boundary it was built for does not exist.");
  return duration.cutoffInstant;
}
function boundedCutoff(result: ReturnType<typeof shareCutoff>, label: string): Temporal.Instant {
  if (result.status !== "bounded") throw new Error(`${label} was refused: ${result.reason}`);
  return result.cutoffInstant;
}
function contextFor(role: CoachingActorRole, principalId: string, overrides: { readonly ministryId?: string; readonly availability?: SubjectAvailability; readonly hold?: PermissionHold } = {}): CoachingAccessContext {
  return { actor: { role, principalId }, organizationId: seeded.organizationId, ministryId: overrides.ministryId ?? seeded.ministryId, subjectAvailability: overrides.availability ?? "available", permissionHold: overrides.hold ?? "none" };
}
function resolvedSessionOf(principalId: string): ResolvedSession {
  return { sessionId: `domain-coaching-grant-${principalId}`, principalId: principalId as ResolvedSession["principalId"], sessionState: "signed-in", admittedMemberships: [], selected: null, capabilities: [], scenarioId: "baseline", clockOffsetMs: 0 };
}
function storedGrantOf(overrides: { readonly state?: CoachingGrantRecord["state"]; readonly modules?: readonly ModuleKey[]; readonly cutoffInstant?: string | null } = {}): CoachingGrantRecord {
  const cutoffInstant = overrides.cutoffInstant === undefined ? STORED_CUTOFF : overrides.cutoffInstant;
  return {
    grantId: `${GRANT_ID}-stored`,
    workerPrincipalId: WORKER as CoachingGrantRecord["workerPrincipalId"],
    coachPrincipalId: COACH as CoachingGrantRecord["coachPrincipalId"],
    ministryIds: [seeded.ministryId as CoachingGrantRecord["ministryIds"][number]],
    modules: selectionWith(overrides.modules ?? SHARED_MODULES),
    duration: { kind: cutoffInstant === null ? "ongoing" : "through-date", cutoffInstant, frozenZone: seeded.frozenZone },
    financialRange: null,
    state: overrides.state ?? "active",
    invitation: { issuedAt: ISSUED_AT.toString(), expiresAt: INVITATION_EXPIRES_AT.toString(), supersededBy: null },
    revision: "rev-1",
  };
}
function periodOf(record: CoachingTargetRecord): TargetPeriod {
  switch (record.period.kind) {
    case "weekly":
      return DEFAULT_TARGET_PERIOD;
    case "monthly":
      return { kind: "monthly" };
    case "custom":
      if (record.period.from === null || record.period.to === null) throw new Error("A seeded one-off custom period states both its first and its last day.");
      return { kind: "custom", start: Temporal.PlainDate.from(record.period.from), end: Temporal.PlainDate.from(record.period.to) };
    default:
      throw new Error(`The seeded target states a period this file does not know: ${String(record.period.kind)}`);
  }
}
function anchorOf(record: CoachingTargetRecord): PeriodAnchor {
  return { period: periodOf(record), calendarStart: Temporal.PlainDate.from(record.calendarStart) };
}
function versionsOf(record: CoachingTargetRecord): readonly TargetVersion[] {
  return record.versions.map((version) => ({
    revisionId: version.revisionId,
    effectiveFrom: Temporal.PlainDate.from(version.effectiveFrom),
    ...(version.effectiveTo === null ? {} : { effectiveTo: Temporal.PlainDate.from(version.effectiveTo) }),
    quantity: version.quantity,
    measure: version.measure,
    calendarStart: Temporal.PlainDate.from(version.calendarStart),
  }));
}
function targetRecordOf(record: CoachingTargetRecord): TargetRecord {
  return { targetId: record.targetId, privateLabel: record.privateLabel, measure: record.measure, quantity: record.quantity, period: periodOf(record), calendarStart: Temporal.PlainDate.from(record.calendarStart), homePlacement: record.homePlacement, state: record.state, versions: versionsOf(record) };
}
function weekOf(record: CoachingTargetRecord, date: Temporal.PlainDate): ResolvedPeriod {
  return valueOf(resolvePeriodContaining(anchorOf(record), date), "resolvePeriodContaining");
}
function eventOf(kind: ActivityEventKind, date: Temporal.PlainDate): ActivityEvent {
  return { activityId: `activity-${kind}-on-${date.toString()}`, kind, occurrence: { precision: "date", date } };
}
function eventsOf(kind: ActivityEventKind, count: number, start: Temporal.PlainDate, cohort = ""): readonly ActivityEvent[] {
  const marker = cohort === "" ? "" : `-${cohort}`;
  return Array.from({ length: count }, (_unused, index) => ({ activityId: `activity-${kind}${marker}-${String(index)}`, kind, occurrence: { precision: "date", date: start.add({ days: index % 7 }) } }));
}
function countOf(measure: TargetMeasure, activities: readonly ActivityEvent[], period: ResolvedPeriod, alreadyCredited: ReadonlySet<string> = new Set<string>()): number {
  return measureFor({ measure, period, activities, alreadyCredited }).count;
}

describe("A — an invitation names everything, and the five modules start unselected", () => {
  it("names the recipient, the ministries and the duration, with exactly five module flags all off", () => {
    const invited = invitationOf();
    expect(invited.state).toBe("invited");
    expect(invited.identityVerification).toBe("unverified");
    expect(invited.acceptedAt).toBeNull();
    expect(invited.coachPrincipalId).toBe(COACH);
    expect(invited.coachPrincipalId).not.toBe(invited.workerPrincipalId);
    expect(invited.ministryIds).toEqual([seeded.ministryId]);
    expect(invited.duration?.kind).toBe("through-date");
    expect(Object.keys(invited.modules)).toHaveLength(5);
    expect(Object.keys(invited.modules).sort()).toEqual([...MODULE_KEYS].sort());
    for (const key of MODULE_KEYS) {
      expect(invited.modules[key]).toBe(false);
    }
    expect(invited.modules).toEqual(NO_MODULES_SELECTED);
  });
  it("keeps the organisation, the ministry and the principal as three separate references", () => {
    const context = contextFor("coach", COACH);
    expect(context.organizationId).not.toBe(context.ministryId);
    expect(context.ministryId).not.toBe(context.actor.principalId);
    expect(context.organizationId).not.toBe(context.actor.principalId);
    expect(Object.keys(context).sort()).toEqual(["actor", "ministryId", "organizationId", "permissionHold", "subjectAvailability"]);
  });
  it("refuses an invitation that states no duration: a missing duration is not permission", () => {
    const refused = refusalOf(inviteGrant({ grantId: GRANT_ID, workerPrincipalId: WORKER, coachPrincipalId: COACH, ministryIds: [seeded.ministryId], duration: null, financialRange: null, issuedAt: ISSUED_AT, expiresAt: INVITATION_EXPIRES_AT, revision: 0 }), "inviteGrant");
    expect(refused.reason).toBe("missing-duration");
    expect(Object.keys(refused).sort()).toEqual(["message", "reason"]);
    expect("grantId" in refused).toBe(false);
    expect("workerPrincipalId" in refused).toBe(false);
  });
  it("holds delivery, identity verification, acceptance and live access apart", () => {
    const invited = invitationOf();
    expect(refusalOf(activeGrant(invited, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("not-accepted");
    const unverified = refusalOf(acceptGrant(invited, { acceptedBy: COACH, identityVerification: "unverified", expectedRevision: invited.revision }, ACCEPTED_AT), "acceptGrant");
    expect(unverified.reason).toBe("identity-not-verified");
    expect(invited.state).toBe("invited");
    const accepted = acceptedFrom(invited, ACCEPTED_AT);
    expect(accepted.state).toBe("active");
    expect(accepted.acceptedAt?.toString()).toBe(ACCEPTED_AT.toString());
    const held = refusalOf(activeGrant(accepted, contextFor("coach", COACH, { hold: "temporary" }), clockAt(0)), "activeGrant");
    expect(held.reason).toBe("permission-hold");
    expect(held.reason).not.toBe("ended");
    expect(accepted.state).toBe("active");
    const unavailableSubject = valueOf(moduleReadState(grantOf(), "targets", contextFor("coach", COACH, { availability: "unavailable" }), clockAt(0), { presence: "complete", withheldUntilReReviewed: false }), "moduleReadState");
    expect(unavailableSubject).toBe("unavailable");
    expect(unavailableSubject).not.toBe("empty");
    expect(GRANT_LIFECYCLE_STATES).toEqual(expect.arrayContaining(["invited", "accepted", "active", "revoked", "expired", "ended"]));
    expect(new Set<GrantLifecycleState>(GRANT_LIFECYCLE_STATES).size).toBe(GRANT_LIFECYCLE_STATES.length);
  });
  it("decides the holder by principal, so a nearby relationship or another identity grants nothing", () => {
    const granted = grantOf();
    expect(activeGrant(granted, contextFor("coach", COACH), clockAt(0)).ok).toBe(true);
    expect(refusalOf(activeGrant(granted, contextFor("coach", OUTSIDER), clockAt(0)), "activeGrant").reason).toBe("not-holder");
    expect(refusalOf(activeGrant(granted, contextFor("coach", WORKER), clockAt(0)), "activeGrant").reason).toBe("not-holder");
    const elsewhere = contextFor("coach", COACH, { ministryId: seeded.otherMinistryId });
    expect(refusalOf(activeGrant(granted, elsewhere, clockAt(0)), "activeGrant").reason).toBe("ministry-not-admitted");
    expect(seeded.activeGrant.ministryIds).toEqual([seeded.ministryId]);
    expect(seeded.revokedGrant.ministryIds).toEqual([seeded.otherMinistryId]);
    expect(seeded.activeGrant.grantId).not.toBe(seeded.revokedGrant.grantId);
  });
});

describe("B — the cutoff is exclusive, frozen at acceptance, and bounded by the earlier limit", () => {
  it("closes at the exclusive start of the civil day after the Share-through date, and not one millisecond earlier", () => {
    const granted = grantOf();
    const cutoff = frozenCutoffOf(granted);
    const expected = SHARE_THROUGH.add({ days: 1 }).toZonedDateTime(seeded.frozenZone).toInstant();
    expect(cutoff.toString()).toBe(expected.toString());
    const openAt = clockAt(offsetOf(cutoff.subtract({ milliseconds: 1 })));
    expect(openAt.toString()).toBe(cutoff.subtract({ milliseconds: 1 }).toString());
    expect(activeGrant(granted, contextFor("coach", COACH), openAt).ok).toBe(true);
    expect(shareWindowOpenAt({ cutoffInstant: cutoff, now: openAt }).status).toBe("open");
    // ... and exactly at the cutoff it is denied, with the boundary at equality and not a day later
    const closedAt = clockAt(offsetOf(cutoff));
    expect(closedAt.toString()).toBe(cutoff.toString());
    expect(refusalOf(activeGrant(granted, contextFor("coach", COACH), closedAt), "activeGrant").reason).toBe("cutoff-reached");
    expect(shareWindowOpenAt({ cutoffInstant: cutoff, now: closedAt }).status).toBe("closed");
    expect(refusalOf(assertModuleAdmitted(granted, "targets", contextFor("coach", COACH), closedAt), "assertModuleAdmitted").reason).toBe("cutoff-reached");
    expect(shareThroughDateOfCutoff({ cutoffInstant: cutoff, frozenZone: seeded.frozenZone })?.toString()).toBe(SHARE_THROUGH.toString());
  });
  it("freezes the cutoff at acceptance, so travelling the clock moves no instant", () => {
    const invited = invitationOf();
    expect(invited.duration?.cutoffInstant).toBeNull();
    expect(invited.duration?.settledAt).toBeNull();
    const accepted = acceptedFrom(invited, ACCEPTED_AT);
    const frozen = frozenCutoffOf(accepted);
    expect(accepted.duration?.settledAt?.toString()).toBe(ACCEPTED_AT.toString());
    expect(accepted.duration?.frozenZone).toBe(seeded.frozenZone);
    const travelled = clockAt(offsetOf(Temporal.Instant.from("2027-03-01T00:00:00Z")));
    expect(travelled.toString()).toBe("2027-03-01T00:00:00Z");
    expect(frozenCutoffOf(accepted).toString()).toBe(frozen.toString());
    const recomputed = boundedCutoff(shareCutoff({ shareThroughDate: SHARE_THROUGH, frozenZone: seeded.frozenZone }), "shareCutoff");
    expect(recomputed.toString()).toBe(frozen.toString());
    expect(refusalOf(activeGrant(accepted, contextFor("coach", COACH), travelled), "activeGrant").reason).toBe("cutoff-reached");
    expect(accepted.state).toBe("active");
  });
  it("freezes in the source zone, so the same date elsewhere is a different instant", () => {
    const summer = Temporal.PlainDate.from("2026-07-01");
    const inSourceZone = boundedCutoff(shareCutoff({ shareThroughDate: summer, frozenZone: seeded.frozenZone }), "shareCutoff");
    const asUtc = boundedCutoff(shareCutoff({ shareThroughDate: summer, frozenZone: "UTC" }), "shareCutoff");
    expect(inSourceZone.toString()).toBe(summer.add({ days: 1 }).toZonedDateTime(seeded.frozenZone).toInstant().toString());
    expect(inSourceZone.toString()).not.toBe(asUtc.toString());
    expect(shareThroughDateOfCutoff({ cutoffInstant: inSourceZone, frozenZone: seeded.frozenZone })?.toString()).toBe(summer.toString());
    expect(shareThroughDateOfCutoff({ cutoffInstant: asUtc, frozenZone: "UTC" })?.toString()).toBe(summer.toString());
  });
  it("lets an earlier source limit win, and reports that it did", () => {
    const sourceLimit = Temporal.Instant.from("2026-12-10T00:00:00Z");
    const frozen = valueOf(freezeShareDuration({ kind: "through-date", shareThroughDate: SHARE_THROUGH, frozenZone: seeded.frozenZone }, ACCEPTED_AT, { sourceLimit }), "freezeShareDuration");
    expect(frozen.cutoffInstant?.toString()).toBe(sourceLimit.toString());
    expect(frozen.limitedBy).toBe("source");
    expect(frozen.sourceLimitInstant?.toString()).toBe(sourceLimit.toString());
    expect(frozen.nominalDisagreesWithResolved).toBe(true);
    expect(frozen.nominalWording).toBe(`Shared through ${SHARE_THROUGH.toString()}`);
    const limited = shareCutoff({ shareThroughDate: SHARE_THROUGH, frozenZone: seeded.frozenZone, sourceLimit });
    if (limited.status !== "bounded" || limited.limitedBy !== "source") throw new Error(`A source-limited cutoff must report the earlier limit, and this one returned ${limited.status}`);
    expect(limited.cutoffInstant.toString()).toBe(sourceLimit.toString());
    expect(limited.shareThroughCutoffInstant.toString()).toBe(SHARE_THROUGH.add({ days: 1 }).toZonedDateTime(seeded.frozenZone).toInstant().toString());
    const granted = grantUnderSourceLimit(sourceLimit);
    expect(refusalOf(activeGrant(granted, contextFor("coach", COACH), clockAt(offsetOf(sourceLimit))), "activeGrant").reason).toBe("cutoff-reached");
    expect(activeGrant(granted, contextFor("coach", COACH), clockAt(offsetOf(sourceLimit.subtract({ milliseconds: 1 })))).ok).toBe(true);
  });
  it("treats an unstated duration as no permission, and an open-ended one as a stated choice", () => {
    expect(refusalOf(freezeShareDuration(null, ACCEPTED_AT), "freezeShareDuration").reason).toBe("missing-duration");
    const accepted = acceptedFrom(invitationOf(), ACCEPTED_AT);
    const durationless: CoachingGrant = { ...accepted, duration: null };
    expect(refusalOf(activeGrant(durationless, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("missing-duration");
    const ongoing = acceptedFrom(invitationOf({ shareThroughDate: null }), ACCEPTED_AT);
    expect(ongoing.duration?.kind).toBe("ongoing");
    expect(ongoing.duration?.cutoffInstant).toBeNull();
    expect(ongoing.duration?.limitedBy).toBeNull();
    expect(activeGrant(ongoing, contextFor("coach", COACH), clockAt(0)).ok).toBe(true);
  });
});

describe("C — an ended episode is ended, and a stale action cannot revive it", () => {
  it("denies a coach read after the relationship ended, before the cutoff, with nothing enumerable", () => {
    const active = grantOf();
    const ended = valueOf(endGrant(active, { endedBy: WORKER, expectedRevision: active.revision }), "endGrant");
    expect(ended.state).toBe("ended");
    const at = clockAt(0);
    expect(Temporal.Instant.compare(at, frozenCutoffOf(ended))).toBeLessThan(0);
    const refusal = refusalOf(activeGrant(ended, contextFor("coach", COACH), at), "activeGrant");
    expect(refusal.reason).toBe("ended");
    expect(Object.keys(refusal).sort()).toEqual(["message", "reason"]);
    expect(Object.keys(refusal)).not.toEqual(expect.arrayContaining(["count", "total", "title", "label", "exists", "records", "items", "ids", "grantId"]));
    expect(refusalOf(assertModuleAdmitted(ended, "targets", contextFor("coach", COACH), at), "assertModuleAdmitted").reason).toBe("ended");
  });
  it("refuses a save carrying a revision captured before the end, and leaves the episode ended", () => {
    const active = grantOf();
    const revisionBeforeEnd = active.revision;
    const ended = valueOf(endGrant(active, { endedBy: WORKER, expectedRevision: revisionBeforeEnd }), "endGrant");
    const stale = refusalOf(setModuleSelection(ended, { changedBy: WORKER, selection: selectionWith([...MODULE_KEYS]), expectedRevision: revisionBeforeEnd }, clockAt(0)), "setModuleSelection");
    expect(stale.reason).toBe("ended");
    expect(stale.reason).not.toBe("stale-revision");
    expect(ended.state).toBe("ended");
    expect(refusalOf(activeGrant(ended, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("ended");
    expect(refusalOf(endGrant(ended, { endedBy: WORKER, expectedRevision: ended.revision }), "endGrant").reason).toBe("ended");
    expect(refusalOf(revokeGrant(ended, { revokedBy: WORKER, expectedRevision: ended.revision }), "revokeGrant").reason).toBe("ended");
    expect(refusalOf(supersedeGrant(ended, { changedBy: WORKER, supersededBy: "grant-newer", expectedRevision: ended.revision }), "supersedeGrant").reason).toBe("ended");
    expect(refusalOf(leaveGrant(ended, { leftBy: COACH, expectedRevision: ended.revision }), "leaveGrant").reason).toBe("ended");
    const open = grantOf();
    const staleRevision = refusalOf(setModuleSelection(open, { changedBy: WORKER, selection: selectionWith(["targets"]), expectedRevision: open.revision + 7 }, clockAt(0)), "setModuleSelection");
    expect(staleRevision.reason).toBe("stale-revision");
  });
  it("keeps revoked, expired and ended apart, and revives none of them", () => {
    const active = grantOf();
    const revoked = valueOf(revokeGrant(active, { revokedBy: WORKER, expectedRevision: active.revision }), "revokeGrant");
    expect(revoked.state).toBe("revoked");
    const revokedReason = refusalOf(activeGrant(revoked, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason;
    expect(refusalOf(setModuleSelection(revoked, { changedBy: WORKER, selection: selectionWith(["targets"]), expectedRevision: active.revision }, clockAt(0)), "setModuleSelection").reason).toBe("revoked");
    const late = invitationOf();
    const expiredReason = refusalOf(acceptGrant(late, { acceptedBy: COACH, identityVerification: "verified", expectedRevision: late.revision }, INVITATION_EXPIRES_AT), "acceptGrant").reason;
    const expired: CoachingGrant = { ...acceptedFrom(invitationOf(), ACCEPTED_AT), state: "expired" };
    expect(refusalOf(activeGrant(expired, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("expired");
    const endedSource = grantOf();
    const ended = valueOf(endGrant(endedSource, { endedBy: WORKER, expectedRevision: endedSource.revision }), "endGrant");
    const endedReason = refusalOf(activeGrant(ended, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason;
    expect(new Set([revokedReason, expiredReason, endedReason]).size).toBe(3);
    for (const reason of [revokedReason, expiredReason, endedReason]) {
      expect(GRANT_LIFECYCLE_STATES).toContain(reason);
    }
  });
  it("closes an unaccepted invitation by replacement, and refuses to replace one that was accepted", () => {
    const replaced = valueOf(supersedeGrant(invitationOf(), { changedBy: WORKER, supersededBy: "grant-newer", expectedRevision: 0 }), "supersedeGrant");
    expect(replaced.state).toBe("superseded");
    expect(replaced.invitation.supersededBy).toBe("grant-newer");
    const lateAccept = refusalOf(acceptGrant(replaced, { acceptedBy: COACH, identityVerification: "verified", expectedRevision: replaced.revision }, ACCEPTED_AT), "acceptGrant");
    expect(lateAccept.reason).toBe("superseded");
    expect(refusalOf(activeGrant(replaced, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("not-accepted");
    const accepted = acceptedFrom(invitationOf(), ACCEPTED_AT);
    const refused = refusalOf(supersedeGrant(accepted, { changedBy: WORKER, supersededBy: "grant-newer", expectedRevision: accepted.revision }), "supersedeGrant");
    expect(refused.reason).toBe("stale-action");
    expect(accepted.state).toBe("active");
  });
  it("gives the coach exactly two writes: accepting the invitation and leaving", () => {
    const invited = invitationOf();
    const accepted = valueOf(acceptGrant(invited, { acceptedBy: COACH, identityVerification: "verified", expectedRevision: invited.revision }, ACCEPTED_AT), "acceptGrant");
    expect(accepted.state).toBe("active");
    const selected = valueOf(setModuleSelection(accepted, { changedBy: WORKER, selection: selectionWith(SHARED_MODULES), expectedRevision: accepted.revision }, ACCEPTED_AT), "setModuleSelection");
    const left = valueOf(leaveGrant(selected, { leftBy: COACH, expectedRevision: selected.revision }), "leaveGrant");
    expect(left.state).toBe("left");
    expect(refusalOf(activeGrant(left, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("left");
    const refusals: readonly (readonly [string, CoachingRefusal])[] = [
      ["setModuleSelection", refusalOf(setModuleSelection(selected, { changedBy: COACH, selection: selectionWith([...MODULE_KEYS]), expectedRevision: selected.revision }, clockAt(0)), "setModuleSelection")],
      ["revokeGrant", refusalOf(revokeGrant(selected, { revokedBy: COACH, expectedRevision: selected.revision }), "revokeGrant")],
      ["endGrant", refusalOf(endGrant(selected, { endedBy: COACH, expectedRevision: selected.revision }), "endGrant")],
      ["supersedeGrant", refusalOf(supersedeGrant(selected, { changedBy: COACH, supersededBy: "grant-newer", expectedRevision: selected.revision }), "supersedeGrant")],
    ];
    expect(Object.fromEntries(refusals.map(([label, refusal]) => [label, refusal.reason]))).toEqual({ setModuleSelection: "not-holder", revokeGrant: "not-holder", endGrant: "not-holder", supersedeGrant: "not-holder" }); // and the worker cannot leave on the coach's behalf
    expect(refusalOf(leaveGrant(selected, { leftBy: WORKER, expectedRevision: selected.revision }), "leaveGrant").reason).toBe("not-holder");
  });
});

describe("D — the coach projection authorises before it enumerates", () => {
  it("admits exactly the modules that were switched on, and answers for the others without a state", () => {
    const granted = grantOf({ modules: SHARED_MODULES });
    const admitted = valueOf(admittedModules(granted, contextFor("coach", COACH), clockAt(0)), "admittedModules");
    expect(admitted).toEqual(["targets", "check-ins"]);
    expect(admitted).toHaveLength(2);
    const unshared: readonly ModuleKey[] = ["support-goal", "support-results", "task-summaries"];
    const answers = unshared.map((key) => {
      const refusal = refusalOf(assertModuleAdmitted(granted, key, contextFor("coach", COACH), clockAt(0)), "assertModuleAdmitted");
      const read = moduleReadState(granted, key, contextFor("coach", COACH), clockAt(0), { presence: "complete", withheldUntilReReviewed: false });
      return [key, { reason: refusal.reason, refusalKeys: Object.keys(refusal).sort(), stateOffered: read.ok, switchedOn: granted.modules[key] }] as const;
    });
    expect(Object.fromEntries(answers)).toEqual({
      "support-goal": { reason: "module-not-admitted", refusalKeys: ["message", "reason"], stateOffered: false, switchedOn: false },
      "support-results": { reason: "module-not-admitted", refusalKeys: ["message", "reason"], stateOffered: false, switchedOn: false },
      "task-summaries": { reason: "module-not-admitted", refusalKeys: ["message", "reason"], stateOffered: false, switchedOn: false },
    });
  });
  it("keeps a shared goal from sharing results, because the five switches are independent", () => {
    expect(seeded.activeGrant.modules["support-goal"]).toBe(false);
    expect(seeded.activeGrant.modules["support-results"]).toBe(false);
    expect(seeded.activeGrant.financialRange).toBeNull();
    const goalOnly = grantOf({ modules: ["support-goal"] });
    expect(valueOf(admittedModules(goalOnly, contextFor("coach", COACH), clockAt(0)), "admittedModules")).toEqual(["support-goal"]);
    expect(goalOnly.modules["support-results"]).toBe(false);
    expect(refusalOf(assertModuleAdmitted(goalOnly, "support-results", contextFor("coach", COACH), clockAt(0)), "assertModuleAdmitted").reason).toBe("module-not-admitted");
    const both = valueOf(setModuleSelection(goalOnly, { changedBy: WORKER, selection: selectionWith(["support-goal", "support-results"]), expectedRevision: goalOnly.revision }, clockAt(0)), "setModuleSelection");
    expect(both.modules).toEqual(selectionWith(["support-goal", "support-results"]));
    expect(both.revision).toBe(goalOnly.revision + 1);
  });
  it("refuses an unshared module in the authorisation layer and allows a shared one", () => {
    const coachSession = resolvedSessionOf(COACH);
    const record = storedGrantOf({ modules: SHARED_MODULES });
    const at = clockAt(0);
    expect(canView(coachSession, { kind: "cohort-subject", grant: record, module: "targets", now: at }).allowed).toBe(true);
    const refusedModule = canView(coachSession, { kind: "cohort-subject", grant: record, module: "task-summaries", now: at });
    expect(refusedModule.allowed).toBe(false);
    if (refusedModule.allowed) throw new Error("An unshared module must not be readable");
    expect(refusedModule.denial.reasonCode).toBe("no-permission");
    expect(isOutcome(refusedModule.denial)).toBe(true);
    expect(Object.keys(refusedModule.denial).sort()).toEqual(["operationId", "outcome", "reasonCode"]);
    expect(canEdit(coachSession, { kind: "cohort-subject", grant: record, module: "targets", now: at }).allowed).toBe(false);
    expect(canView(resolvedSessionOf(OUTSIDER), { kind: "cohort-subject", grant: record, module: "targets", now: at }).allowed).toBe(false);
  });
  it("refuses a coach read once the relationship ended or its cutoff was reached, even on a stale active row", () => {
    const coachSession = resolvedSessionOf(COACH);
    const at = clockAt(0);
    const ended = storedGrantOf({ state: "ended" });
    const staleActive = storedGrantOf({ state: "active", cutoffInstant: "2026-11-01T00:00:00Z" });
    expect(canView(coachSession, { kind: "cohort-subject", grant: ended, module: "targets", now: at }).allowed).toBe(false);
    expect(canView(coachSession, { kind: "cohort-subject", grant: staleActive, module: "targets", now: at }).allowed).toBe(false);
    const workerSession = resolvedSessionOf(WORKER);
    expect(canView(workerSession, { kind: "coaching-grant", grant: ended, now: at }).allowed).toBe(true);
    expect(canEdit(workerSession, { kind: "coaching-grant", grant: ended, now: at }).allowed).toBe(false);
    expect(canEdit(workerSession, { kind: "coaching-grant", grant: storedGrantOf(), now: at }).allowed).toBe(true);
  });
  it("gives the coach no gift row, no private label, no total and no ranking", () => {
    const target = targetRecordOf(seeded.conversationsTarget);
    const period = weekOf(seeded.conversationsTarget, Temporal.PlainDate.from("2026-11-04"));
    const version = valueOf(resolveTargetVersion(versionsOf(seeded.conversationsTarget), period), "resolveTargetVersion");
    const coachProgress = coachTargetProgress({ target, version, period, count: 2 });
    expect(Object.keys(coachProgress).sort()).toEqual(["count", "measure", "period", "quantity", "revisionId", "state"]);
    const forbidden: readonly string[] = ["privateLabel", "homePlacement", "note", "notes", "donor", "donors", "gift", "gifts", "amount", "amounts", "money", "currency", "total", "totals", "sum", "ranking", "rank", "score"];
    expect(Object.keys(coachProgress).filter((field) => forbidden.includes(field))).toEqual([]);
    const workerProgress = workerTargetProgress({ target, version, period, count: 2 });
    expect(workerProgress.privateLabel).toBe(seeded.conversationsTarget.privateLabel);
    expect(workerProgress.revisionId).toBe(coachProgress.revisionId);
    expect(workerProgress.measure).toBe(coachProgress.measure);
    const second = coachTargetProgress({ target, version, period, count: 5 });
    expect(second.count).toBe(5);
    expect(coachProgress.count).toBe(2);
    expect(Object.keys(second).sort()).toEqual(Object.keys(coachProgress).sort());
  });
  it("never renders a missing value as zero", () => {
    const target = targetRecordOf(seeded.conversationsTarget);
    const period = weekOf(seeded.conversationsTarget, Temporal.PlainDate.from("2026-11-04"));
    const version = valueOf(resolveTargetVersion(versionsOf(seeded.conversationsTarget), period), "resolveTargetVersion");
    const unread = coachTargetProgress({ target, version, period, count: null });
    expect(unread.count).toBeNull();
    expect(unread.count).not.toBe(0);
    expect(unread.state).toBe("unavailable");
    expect(resolveTargetState({ target: undefined, recorded: 0, placement: "placed" })).toBe("no-target");
    expect(resolveTargetState({ target, recorded: 0, placement: "placed" })).toBe("zero-recorded");
    expect(resolveTargetState({ target, recorded: null, placement: "placed" })).toBe("unavailable");
    expect(resolveTargetState({ target, recorded: 3, placement: "placed" })).toBe("active");
    expect(resolveTargetState({ target: { ...target, state: "paused" }, recorded: 3, placement: "placed" })).toBe("paused");
    expect(resolveTargetState({ target: { ...target, state: "ended" }, recorded: 3, placement: "placed" })).toBe("ended");
    expect(resolveTargetState({ target, recorded: 3, placement: "not-disclosed" })).toBe("active");
    expect(TARGET_STATES).toEqual(["no-target", "active", "zero-recorded", "paused", "ended", "unplaced", "unavailable"]);
    const emptyRange = refusalOf(describeFinancialRange({ from: OPENING_WEEK_START, to: OPENING_WEEK_START.add({ days: 6 }), measures: [] }, "en-GB"), "describeFinancialRange");
    expect(emptyRange.reason).toBe("invalid-selection");
    expect(emptyRange.message).toContain("rather than a zero");
  });
  it("leaves the other admitted modules usable when one module's source is down", () => {
    const flags = scenarioFlagsFor("coaching-module-unavailable");
    expect(flags.coachingModule).toBe("unavailable");
    expect(scenarioFlagsFor("baseline").coachingModule).toBe("available");
    const granted = grantOf({ modules: ["support-results", "targets", "check-ins"] });
    const at = clockAt(0);
    const complete = { presence: "complete", withheldUntilReReviewed: false } as const;
    const down = contextFor("coach", COACH, { availability: flags.coachingModule === "unavailable" ? "unavailable" : "available" });
    const unavailableModule = valueOf(moduleReadState(granted, "support-results", down, at, complete), "moduleReadState");
    expect(unavailableModule).toBe("unavailable");
    expect(unavailableModule).not.toBe("empty");
    const usable = contextFor("coach", COACH);
    expect(valueOf(moduleReadState(granted, "targets", usable, at, { presence: "partial", withheldUntilReReviewed: false }), "moduleReadState")).toBe("partial");
    expect(valueOf(moduleReadState(granted, "check-ins", usable, at, { presence: "none", withheldUntilReReviewed: false }), "moduleReadState")).toBe("empty");
    expect(valueOf(moduleReadState(granted, "check-ins", usable, at, complete), "moduleReadState")).toBeNull();
    expect(MODULE_READ_STATES).toEqual(["empty", "partial", "withheld", "unavailable", "ended"]);
  });
  it("keeps a temporary hold apart from an end, and one withheld module apart from the others", () => {
    const granted = grantOf();
    const at = clockAt(0);
    const held = refusalOf(activeGrant(granted, contextFor("coach", COACH, { hold: "temporary" }), at), "activeGrant");
    expect(held.reason).toBe("permission-hold");
    const heldModule = refusalOf(moduleReadState(granted, "targets", contextFor("coach", COACH, { hold: "temporary" }), at, { presence: "complete", withheldUntilReReviewed: false }), "moduleReadState");
    expect(heldModule.reason).toBe("permission-hold");
    expect(valueOf(moduleReadState(granted, "targets", contextFor("coach", COACH), at, { presence: "complete", withheldUntilReReviewed: true }), "moduleReadState")).toBe("withheld");
    expect(valueOf(moduleReadState(granted, "check-ins", contextFor("coach", COACH), at, { presence: "complete", withheldUntilReReviewed: false }), "moduleReadState")).toBeNull();
    const closedAt = clockAt(offsetOf(frozenCutoffOf(granted)));
    expect(valueOf(moduleReadState(granted, "targets", contextFor("coach", COACH), closedAt, { presence: "complete", withheldUntilReReviewed: true }), "moduleReadState")).toBe("ended");
  });
  it("authorises the coach by grant, and gives them no export of anyone's support", () => {
    const coachSession = resolvedSessionOf(COACH);
    const scope: Scope = { organizationId: seeded.organizationId, ministryId: seeded.ministryId as Scope["ministryId"], supportSubjectId: seeded.supportSubjectId, principalId: COACH as Scope["principalId"] };
    // the coach holds no membership of the ministry, so membership authority is refused and the grant is
    // the only thing that admits them
    expect(assertScopeUnder(coachSession, scope, "membership").ok).toBe(false);
    expect(assertScopeUnder(coachSession, scope, "grant").ok).toBe(true);
    const exportDecision = canExport(coachSession, scope);
    expect(exportDecision.allowed).toBe(false);
    if (exportDecision.allowed) throw new Error("A coach must hold no export");
    expect(exportDecision.denial.reasonCode).toBe("no-export-permission");
    expect(Object.keys(exportDecision.denial).sort()).toEqual(["operationId", "outcome", "reasonCode"]);
  });
});

describe("E — four measures, credited once, from activity that actually happened", () => {
  it("counts exactly four measures, and names the credit of every event kind", () => {
    expect(TARGET_MEASURES).toEqual(["calls-made", "personal-messages", "conversations", "meetings-held"]);
    expect(TARGET_MEASURES).toHaveLength(4);
    const crediting = ACTIVITY_EVENT_KINDS.filter((kind) => classifyActivity(eventOf(kind, OPENING_WEEK_START)) !== "none");
    expect(crediting).toEqual(["call", "personal-message", "conversation", "meeting-held"]);
    expect(classifyActivity(eventOf("personal-message", OPENING_WEEK_START))).toBe("personal-messages");
    expect(classifyActivity(eventOf("meeting-held", OPENING_WEEK_START))).toBe("meetings-held");
    const credits = new Set(ACTIVITY_EVENT_KINDS.map((kind) => classifyActivity(eventOf(kind, OPENING_WEEK_START))));
    expect(credits.size).toBe(TARGET_MEASURES.length + 1);
  });
  it("keeps five calls containing two conversations at five and two", () => {
    const week = weekOf(seeded.conversationsTarget, OPENING_WEEK_START.add({ days: 2 }));
    const calls = eventsOf("call", 5, week.start);
    const conversations = eventsOf("conversation", 2, week.start);
    const both = [...calls, ...conversations];
    expect(countOf("calls-made", both, week)).toBe(5);
    expect(countOf("conversations", both, week)).toBe(2);
    expect(countOf("calls-made", conversations, week)).toBe(0);
    expect(countOf("conversations", calls, week)).toBe(0);
    expect(seeded.conversationsTarget.quantity).toBe(3);
    expect(countOf("conversations", both, week)).not.toBe(seeded.conversationsTarget.quantity);
  });
  it("counts nothing for a planned meeting, a no-show, a broadcast, an automated reply, an open or a click", () => {
    const week = weekOf(seeded.conversationsTarget, OPENING_WEEK_START.add({ days: 2 }));
    const calls = eventsOf("call", 5, week.start);
    const nonActivities: readonly ActivityEventKind[] = ["meeting-planned", "task-completed", "dialer-opened", "mail-opened", "no-show", "broadcast", "automated-reply", "message-opened", "link-clicked"];
    const table = nonActivities.map((kind) => {
      const event = eventOf(kind, week.start);
      const counts = TARGET_MEASURES.map((measure) => countOf(measure, [event], week));
      return [kind, { credit: classifyActivity(event), counts, withTheFiveCalls: countOf("calls-made", [...calls, event], week) }] as const;
    });
    expect(Object.fromEntries(table)).toEqual({
      "meeting-planned": { credit: "none", counts: [0, 0, 0, 0], withTheFiveCalls: 5 },
      "task-completed": { credit: "none", counts: [0, 0, 0, 0], withTheFiveCalls: 5 },
      "dialer-opened": { credit: "none", counts: [0, 0, 0, 0], withTheFiveCalls: 5 },
      "mail-opened": { credit: "none", counts: [0, 0, 0, 0], withTheFiveCalls: 5 },
      "no-show": { credit: "none", counts: [0, 0, 0, 0], withTheFiveCalls: 5 },
      broadcast: { credit: "none", counts: [0, 0, 0, 0], withTheFiveCalls: 5 },
      "automated-reply": { credit: "none", counts: [0, 0, 0, 0], withTheFiveCalls: 5 },
      "message-opened": { credit: "none", counts: [0, 0, 0, 0], withTheFiveCalls: 5 },
      "link-clicked": { credit: "none", counts: [0, 0, 0, 0], withTheFiveCalls: 5 },
    });
  });
  it("credits each activity once, and buckets it by the day it happened", () => {
    const week = weekOf(seeded.conversationsTarget, OPENING_WEEK_START.add({ days: 2 }));
    const calls = eventsOf("call", 5, week.start);
    const [firstCall] = calls;
    if (firstCall === undefined) throw new Error("The five-call fixture produced no activity at all.");
    expect(countOf("calls-made", [...calls, firstCall], week)).toBe(5);
    const alreadyCredited = new Set(calls.map((call) => call.activityId));
    expect(countOf("calls-made", calls, week, alreadyCredited)).toBe(0);
    expect(countOf("calls-made", [...calls, ...eventsOf("call", 2, week.start, "later")], week, alreadyCredited)).toBe(2);
    expect(countOf("calls-made", [eventOf("call", week.endInclusive)], week)).toBe(1);
    expect(countOf("calls-made", [eventOf("call", week.exclusiveEnd)], week)).toBe(0);
    expect(countOf("calls-made", [eventOf("call", week.start)], week)).toBe(1);
    const undated: ActivityEvent = { activityId: "activity-undated", kind: "call", occurrence: { precision: "unknown" } };
    expect(countOf("calls-made", [undated], week)).toBe(0);
    expect(measureFor({ measure: "calls-made", period: week, activities: [undated], alreadyCredited: new Set() }).creditedActivityIds).toEqual([]);
    const approximate: ActivityEvent = { activityId: "activity-approximate", kind: "call", occurrence: { precision: "approximate", date: week.start } };
    expect(countOf("calls-made", [approximate], week)).toBe(1);
    const counted = measureFor({ measure: "calls-made", period: week, activities: calls, alreadyCredited: new Set() });
    expect(counted.creditedActivityIds).toHaveLength(5);
    expect(countOf("calls-made", calls, week, new Set(counted.creditedActivityIds))).toBe(0);
  });
});

describe("F — a plan change begins a prospective version, and a closed period keeps its own", () => {
  const CHANGE: TargetVersionChange = { revisionId: "target-conversations-weekly-3", quantity: 6, measure: "conversations", calendarStart: OPENING_WEEK_START };
  const EFFECTIVE_FROM = Temporal.PlainDate.from("2026-11-16");
  it("closes one version the day before the next begins, with no gap, no overlap and no bridge", () => {
    const record = seeded.conversationsTarget;
    const anchor = anchorOf(record);
    const versions = versionsOf(record);
    const next = valueOf(startProspectiveVersion({ versions, anchor, change: CHANGE, effectiveFrom: EFFECTIVE_FROM }), "startProspectiveVersion");
    expect(next).toHaveLength(versions.length + 1);
    for (let index = 0; index < next.length - 1; index += 1) {
      const current = next[index];
      const following = next[index + 1];
      if (current === undefined || following === undefined) throw new Error(`The prospective history has no version at position ${String(index)}.`);
      const closesOn = current.effectiveTo;
      if (closesOn === undefined) throw new Error(`Version ${current.revisionId} never closes, so nothing can follow it.`);
      expect(closesOn.add({ days: 1 }).equals(following.effectiveFrom), `${current.revisionId} then ${following.revisionId}`).toBe(true);
      expect(Temporal.PlainDate.compare(closesOn, following.effectiveFrom), `${current.revisionId} -> ${following.revisionId}`).toBeLessThan(0);
    }
    const last = next.at(-1);
    if (last === undefined) throw new Error("The prospective history is empty.");
    expect(last.effectiveTo).toBeUndefined();
    expect(last.revisionId).toBe(CHANGE.revisionId);
    expect(last.quantity).toBe(6);
    const boundaries = next.map((version) => ({
      revisionId: version.revisionId,
      startsOnAPeriodStart: valueOf(resolvePeriodContaining(anchor, version.effectiveFrom), "resolvePeriodContaining").start.equals(version.effectiveFrom),
      endsOnAPeriodEnd: version.effectiveTo === undefined ? null : valueOf(resolvePeriodContaining(anchor, version.effectiveTo), "resolvePeriodContaining").endInclusive.equals(version.effectiveTo),
      wholeQuantity: Number.isInteger(version.quantity) && version.quantity > 0,
    }));
    expect(boundaries).toEqual([
      { revisionId: "target-conversations-weekly-1", startsOnAPeriodStart: true, endsOnAPeriodEnd: true, wholeQuantity: true },
      { revisionId: "target-conversations-weekly-2", startsOnAPeriodStart: true, endsOnAPeriodEnd: true, wholeQuantity: true },
      { revisionId: "target-conversations-weekly-3", startsOnAPeriodStart: true, endsOnAPeriodEnd: null, wholeQuantity: true },
    ]);
    const previous = next[1];
    if (previous === undefined) throw new Error("The change closed no version.");
    expect(previous.revisionId).toBe("target-conversations-weekly-2");
    expect(previous.effectiveTo?.toString()).toBe(EFFECTIVE_FROM.subtract({ days: 1 }).toString());
  });
  it("keeps a closed period on the version it was measured against", () => {
    const record = seeded.conversationsTarget;
    const anchor = anchorOf(record);
    const closedPeriod = weekOf(record, Temporal.PlainDate.from("2026-11-05"));
    const beforeChange = valueOf(resolveTargetVersion(versionsOf(record), closedPeriod), "resolveTargetVersion");
    expect(beforeChange.revisionId).toBe("target-conversations-weekly-1");
    expect(beforeChange.quantity).toBe(2);
    const next = valueOf(startProspectiveVersion({ versions: versionsOf(record), anchor, change: CHANGE, effectiveFrom: EFFECTIVE_FROM }), "startProspectiveVersion");
    const afterChange = valueOf(resolveTargetVersion(next, closedPeriod), "resolveTargetVersion");
    expect(afterChange.revisionId).toBe(beforeChange.revisionId);
    expect(afterChange.quantity).toBe(2);
    const previousPeriod = weekOf(record, Temporal.PlainDate.from("2026-11-12"));
    const previousVersion = valueOf(resolveTargetVersion(next, previousPeriod), "resolveTargetVersion");
    expect(previousVersion.revisionId).toBe("target-conversations-weekly-2");
    expect(previousVersion.quantity).toBe(3);
    const newPeriod = weekOf(record, Temporal.PlainDate.from("2026-11-19"));
    const applied = valueOf(resolveTargetVersion(next, newPeriod), "resolveTargetVersion");
    expect(applied.revisionId).toBe(CHANGE.revisionId);
    expect(applied.quantity).toBe(6);
    const changedTarget: TargetRecord = { ...targetRecordOf(record), versions: next };
    const openProgress = coachTargetProgress({ target: changedTarget, version: applied, period: newPeriod, count: 4 });
    expect(openProgress.revisionId).toBe(CHANGE.revisionId);
    expect(openProgress.quantity).toBe(6);
    const closedProgress = coachTargetProgress({ target: changedTarget, version: afterChange, period: closedPeriod, count: 2 });
    expect(closedProgress.revisionId).toBe("target-conversations-weekly-1");
    expect(closedProgress.quantity).toBe(2);
    expect(closedProgress.count).toBe(2);
  });
  it("refuses a change that repeats the plan, splits a period, moves backwards or states no quantity", () => {
    const record = seeded.conversationsTarget;
    const anchor = anchorOf(record);
    const versions = versionsOf(record);
    expect(refusalOf(startProspectiveVersion({ versions, anchor, change: { ...CHANGE, quantity: 3 }, effectiveFrom: EFFECTIVE_FROM }), "startProspectiveVersion")).toBe("no-change");
    expect(refusalOf(startProspectiveVersion({ versions, anchor, change: CHANGE, effectiveFrom: Temporal.PlainDate.from("2026-11-18") }), "startProspectiveVersion")).toBe("misaligned-boundary");
    expect(refusalOf(startProspectiveVersion({ versions, anchor, change: CHANGE, effectiveFrom: OPENING_WEEK_START }), "startProspectiveVersion")).toBe("not-prospective");
    expect(refusalOf(startProspectiveVersion({ versions, anchor, change: { ...CHANGE, quantity: 0 }, effectiveFrom: EFFECTIVE_FROM }), "startProspectiveVersion")).toBe("invalid-quantity");
  });
  it("refuses a period two versions claim, and one no version covers", () => {
    const record = seeded.conversationsTarget;
    const versions = versionsOf(record);
    const [firstVersion] = versions;
    if (firstVersion === undefined) throw new Error("The seeded target states no version, so no period can be resolved against it.");
    const covered = weekOf(record, Temporal.PlainDate.from("2026-11-05"));
    const duplicated = [...versions, { ...firstVersion, revisionId: "target-conversations-weekly-duplicate" }];
    expect(refusalOf(resolveTargetVersion(duplicated, covered), "resolveTargetVersion")).toBe("overlapping-versions");
    const before = weekOf(record, Temporal.PlainDate.from("2026-10-29"));
    expect(refusalOf(resolveTargetVersion(versions, before), "resolveTargetVersion")).toBe("no-version");
  });
});
