/**
 * The grant half of success criterion 16: the coaching episode, its frozen exclusive cutoff, the five
 * independent module flags that start unselected, the ended-then-stale-action refusal, and the four
 * canonical measures counted only from activity that actually happened.
 *
 * The central claim is authorisation: the coach's projection authorises before it enumerates, so a
 * coach never learns that an unshared module exists, never receives a gift row, a private target label
 * or a reconstructing total, and never sees a missing value rendered as zero.
 *
 * Divergences from the planned dependency list, recorded here because they change how the rules below
 * are reached rather than what they assert:
 *
 * - The store-backed wrappers the plan names — `mutations.coaching.*`, `reads.coaching.*`,
 *   `mutations.coach.*` — resolve a persisted session from the store, and `readCoachingOverview` and
 *   `readCoachPortfolio` take no session source at all, so a framework-free domain test (no store on
 *   disk, no request cookie) cannot drive them. Each rule is therefore asserted against the function
 *   the service calls: `coaching/grant.ts`, `coaching/target.ts` and `time/window.ts` for the domain
 *   contract, and `data-service/authorize.ts` — the one layer every coach read runs through — for the
 *   refusal that happens before any record is enumerated. The persisted boundary belongs to
 *   `tests/integration/coach-read-boundary.test.ts`, not to this file.
 * - The scenario clock is moved through the two functions the store-backed controls wrap,
 *   `buildSessionMeta` and `applySessionClock`, and restored in `afterEach`; `now()` from `time/clock`
 *   remains the only source of the instant.
 * - No mutation is issued, so `newOperationId` is not imported: there is no attempt identity to mint.
 */
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
// The identities this file acts as, taken from the seeded roster so no principal is invented here
const WORKER = SEEDED_PERSONAS["established-worker"].principalId;

const COACH = SEEDED_PERSONAS.coach.principalId;

const OUTSIDER = SEEDED_PERSONAS.subscriber.principalId;
// The seeded coaching relationship's own facts
const SHARE_THROUGH = Temporal.PlainDate.from("2026-12-30");

const ISSUED_AT = SEED_INSTANT;

const INVITATION_EXPIRES_AT = SEED_INSTANT.add({ hours: 168 });

const ACCEPTED_AT = SEED_INSTANT;

const STORED_CUTOFF = "2026-12-31T00:00:00Z";

const GRANT_ID = "grant-domain-fixture";
// The two non-financial modules the seed shares: every other module stays off until it is switched on
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
  if (session === undefined) {
    throw new Error(`The seed lays down no session ${JSON.stringify(sessionId)}, so the coaching fixtures this file needs are absent.`);
  }
  return session.documents.state;
}

function grantIn(document: SessionStateDocument, state: CoachingGrantRecord["state"]): CoachingGrantRecord {
  const record = document.coachingGrants.find((candidate) => candidate.state === state);
  if (record === undefined) {
    throw new Error(`The seeded coaching share holds no ${state} relationship, so this case's fixture is no longer seeded.`);
  }
  return record;
}

function targetIn(document: SessionStateDocument, measure: TargetMeasure): CoachingTargetRecord {
  const record = document.coachingTargets.find((candidate) => candidate.measure === measure);
  if (record === undefined) {
    throw new Error(`The seeded coaching share states no target measured in ${measure}.`);
  }
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
  if (contextMinistry === undefined || otherMinistry === undefined || selectedOrganizationId === null || selectedSupportSubjectId === null) {
    throw new Error("The seeded session selects no organization or support subject, or its relationship states no ministry, so no scope can be named.");
  }
  return {
    organizationId: selectedOrganizationId,
    ministryId: contextMinistry,
    otherMinistryId: otherMinistry,
    supportSubjectId: selectedSupportSubjectId,
    frozenZone: active.duration.frozenZone,
    activeGrant: active,
    revokedGrant: revoked,
    conversationsTarget: targetIn(worker, "conversations"),
  };
}

beforeAll(async () => {
  seeded = await loadSeededCoaching();
});
// The scenario clock: the two functions the store-backed controls wrap, with no store involved
function sessionMetaAt(offsetMilliseconds: number) {
  return buildSessionMeta({
    principalId: WORKER,
    admittedMemberships: [],
    sessionState: "signed-in",
    clockOffsetMs: offsetMilliseconds,
  });
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
// Narrowing the two result branches without a second result vocabulary
interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

interface Refused<E> {
  readonly ok: false;
  readonly error: E;
}

function valueOf<T, E>(result: Ok<T> | Refused<E>, label: string): T {
  if (!result.ok) {
    throw new Error(`${label} was refused: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function refusalOf<T, E>(result: Ok<T> | Refused<E>, label: string): E {
  if (result.ok) {
    throw new Error(`${label} was accepted, and this case needs its refusal`);
  }
  return result.error;
}
// The fixture grants, built through the real invitation, acceptance and module transitions
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
  return valueOf(
    inviteGrant({
      grantId: GRANT_ID,
      workerPrincipalId: WORKER,
      coachPrincipalId: COACH,
      ministryIds: [seeded.ministryId],
      duration,
      financialRange: null,
      issuedAt: ISSUED_AT,
      expiresAt: INVITATION_EXPIRES_AT,
      revision: 0,
    }),
    "inviteGrant",
  );
}

function acceptedFrom(invited: CoachingGrant, acceptedAt: Temporal.Instant): CoachingGrant {
  return valueOf(acceptGrant(invited, { acceptedBy: COACH, identityVerification: "verified", expectedRevision: invited.revision }, acceptedAt), "acceptGrant");
}

function grantOf(overrides: { readonly modules?: readonly ModuleKey[]; readonly shareThroughDate?: Temporal.PlainDate | null } = {}): CoachingGrant {
  const accepted = acceptedFrom(invitationOf(overrides), ACCEPTED_AT);
  return valueOf(
    setModuleSelection(accepted, { changedBy: WORKER, selection: selectionWith(overrides.modules ?? SHARED_MODULES), expectedRevision: accepted.revision }, ACCEPTED_AT),
    "setModuleSelection",
  );
}

function grantUnderSourceLimit(sourceLimit: Temporal.Instant): CoachingGrant {
  const accepted = acceptedFrom(invitationOf(), ACCEPTED_AT);
  const duration: GrantDuration = valueOf(
    freezeShareDuration({ kind: "through-date", shareThroughDate: SHARE_THROUGH, frozenZone: seeded.frozenZone }, ACCEPTED_AT, { sourceLimit }),
    "freezeShareDuration",
  );
  return { ...accepted, duration };
}

function frozenCutoffOf(grant: CoachingGrant): Temporal.Instant {
  const duration = grant.duration;
  if (duration === null || duration.cutoffInstant === null) {
    throw new Error("This fixture grant states no cutoff, so the boundary it was built for does not exist.");
  }
  return duration.cutoffInstant;
}

function boundedCutoff(result: ReturnType<typeof shareCutoff>, label: string): Temporal.Instant {
  if (result.status !== "bounded") {
    throw new Error(`${label} was refused: ${result.reason}`);
  }
  return result.cutoffInstant;
}
// The authority a read runs under: the acting side, the two context references, and the two facts that
// suspend access without ending it
function contextFor(
  role: CoachingActorRole,
  principalId: string,
  overrides: { readonly ministryId?: string; readonly availability?: SubjectAvailability; readonly hold?: PermissionHold } = {},
): CoachingAccessContext {
  return {
    actor: { role, principalId },
    organizationId: seeded.organizationId,
    ministryId: overrides.ministryId ?? seeded.ministryId,
    subjectAvailability: overrides.availability ?? "available",
    permissionHold: overrides.hold ?? "none",
  };
}
// The stored form the authorisation layer reads, and the projections the seed's records resolve to
function resolvedSessionOf(principalId: string): ResolvedSession {
  return {
    sessionId: `domain-coaching-grant-${principalId}`,
    principalId: principalId as ResolvedSession["principalId"],
    sessionState: "signed-in",
    admittedMemberships: [],
    selected: null,
    capabilities: [],
    scenarioId: "baseline",
    clockOffsetMs: 0,
  };
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
      if (record.period.from === null || record.period.to === null) {
        throw new Error("A seeded one-off custom period states both its first and its last day.");
      }
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
  return {
    targetId: record.targetId,
    privateLabel: record.privateLabel,
    measure: record.measure,
    quantity: record.quantity,
    period: periodOf(record),
    calendarStart: Temporal.PlainDate.from(record.calendarStart),
    homePlacement: record.homePlacement,
    state: record.state,
    versions: versionsOf(record),
  };
}

function weekOf(record: CoachingTargetRecord, date: Temporal.PlainDate): ResolvedPeriod {
  return valueOf(resolvePeriodContaining(anchorOf(record), date), "resolvePeriodContaining");
}
// Activity records and the one counter that counts them
function eventOf(kind: ActivityEventKind, date: Temporal.PlainDate): ActivityEvent {
  return { activityId: `activity-${kind}-on-${date.toString()}`, kind, occurrence: { precision: "date", date } };
}

function eventsOf(kind: ActivityEventKind, count: number, start: Temporal.PlainDate, cohort = ""): readonly ActivityEvent[] {
  const marker = cohort === "" ? "" : `-${cohort}`;
  return Array.from({ length: count }, (_unused, index) => ({
    activityId: `activity-${kind}${marker}-${String(index)}`,
    kind,
    occurrence: { precision: "date", date: start.add({ days: index % 7 }) },
  }));
}

function countOf(measure: TargetMeasure, activities: readonly ActivityEvent[], period: ResolvedPeriod, alreadyCredited: ReadonlySet<string> = new Set<string>()): number {
  return measureFor({ measure, period, activities, alreadyCredited }).count;
}

describe("A — an invitation names everything, and the five modules start unselected", () => {
  it("names the recipient, the ministries and the duration, with exactly five module flags all off", () => {
    const invited = invitationOf();
    // the invitation itself: nothing verified, nothing accepted, nothing in force
    expect(invited.state).toBe("invited");
    expect(invited.identityVerification).toBe("unverified");
    expect(invited.acceptedAt).toBeNull();
    // the recipient is named by principal, and it is never the worker's own principal
    expect(invited.coachPrincipalId).toBe(COACH);
    expect(invited.coachPrincipalId).not.toBe(invited.workerPrincipalId);
    // the ministry it is made in, and the duration it will freeze on acceptance
    expect(invited.ministryIds).toEqual([seeded.ministryId]);
    expect(invited.duration?.kind).toBe("through-date");
    // the five switches, each independent, each starting off
    expect(Object.keys(invited.modules)).toHaveLength(5);
    expect(Object.keys(invited.modules).sort()).toEqual([...MODULE_KEYS].sort());
    for (const key of MODULE_KEYS) {
      expect(invited.modules[key]).toBe(false);
    }
    expect(invited.modules).toEqual(NO_MODULES_SELECTED);
  });

  it("keeps the organisation, the ministry and the principal as three separate references", () => {
    const context = contextFor("coach", COACH);
    // one equal-looking identifier never stands in for another: the authority a coaching read runs
    // under names the organisation, the ministry that authorises it and the acting principal apart
    expect(context.organizationId).not.toBe(context.ministryId);
    expect(context.ministryId).not.toBe(context.actor.principalId);
    expect(context.organizationId).not.toBe(context.actor.principalId);
    expect(Object.keys(context).sort()).toEqual(["actor", "ministryId", "organizationId", "permissionHold", "subjectAvailability"]);
  });

  it("refuses an invitation that states no duration: a missing duration is not permission", () => {
    const refused = refusalOf(
      inviteGrant({
        grantId: GRANT_ID,
        workerPrincipalId: WORKER,
        coachPrincipalId: COACH,
        ministryIds: [seeded.ministryId],
        duration: null,
        financialRange: null,
        issuedAt: ISSUED_AT,
        expiresAt: INVITATION_EXPIRES_AT,
        revision: 0,
      }),
      "inviteGrant",
    );
    expect(refused.reason).toBe("missing-duration");
    // no grant was created: the refusal carries a reason and wording, and no record identity
    expect(Object.keys(refused).sort()).toEqual(["message", "reason"]);
    expect("grantId" in refused).toBe(false);
    expect("workerPrincipalId" in refused).toBe(false);
  });

  it("holds delivery, identity verification, acceptance and live access apart", () => {
    const invited = invitationOf();
    // an invitation is not an accepted relationship: no read is admitted yet
    expect(refusalOf(activeGrant(invited, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("not-accepted");
    // acceptance needs a verified identity, so accepting an unverified one opens nothing
    const unverified = refusalOf(acceptGrant(invited, { acceptedBy: COACH, identityVerification: "unverified", expectedRevision: invited.revision }, ACCEPTED_AT), "acceptGrant");
    expect(unverified.reason).toBe("identity-not-verified");
    expect(invited.state).toBe("invited");
    // deliberate acceptance is the coach's own step, and it opens the episode
    const accepted = acceptedFrom(invited, ACCEPTED_AT);
    expect(accepted.state).toBe("active");
    expect(accepted.acceptedAt?.toString()).toBe(ACCEPTED_AT.toString());
    // live access is a separate fact again: the same accepted, verified relationship reads nothing
    // while a temporary hold is in force, and a hold is not an end
    const held = refusalOf(activeGrant(accepted, contextFor("coach", COACH, { hold: "temporary" }), clockAt(0)), "activeGrant");
    expect(held.reason).toBe("permission-hold");
    expect(held.reason).not.toBe("ended");
    expect(accepted.state).toBe("active");
    // an accepted relationship whose source cannot be read is not live content either: the module
    // reports unavailable, which is neither empty nor a completed read
    const unavailableSubject = valueOf(
      moduleReadState(grantOf(), "targets", contextFor("coach", COACH, { availability: "unavailable" }), clockAt(0), {
        presence: "complete",
        withheldUntilReReviewed: false,
      }),
      "moduleReadState",
    );
    expect(unavailableSubject).toBe("unavailable");
    expect(unavailableSubject).not.toBe("empty");
    // the stored vocabulary is closed and its members are distinct
    expect(GRANT_LIFECYCLE_STATES).toEqual(expect.arrayContaining(["invited", "accepted", "active", "revoked", "expired", "ended"]));
    expect(new Set<GrantLifecycleState>(GRANT_LIFECYCLE_STATES).size).toBe(GRANT_LIFECYCLE_STATES.length);
  });

  it("decides the holder by principal, so a nearby relationship or another identity grants nothing", () => {
    const granted = grantOf();
    // the named coach is the holder
    expect(activeGrant(granted, contextFor("coach", COACH), clockAt(0)).ok).toBe(true);
    // another signed-in principal is refused: no address, name or relationship is consulted
    expect(refusalOf(activeGrant(granted, contextFor("coach", OUTSIDER), clockAt(0)), "activeGrant").reason).toBe("not-holder");
    // the worker cannot read their own grant as the coach of it
    expect(refusalOf(activeGrant(granted, contextFor("coach", WORKER), clockAt(0)), "activeGrant").reason).toBe("not-holder");
    // nor does a relationship in another ministry authorise anything here
    const elsewhere = contextFor("coach", COACH, { ministryId: seeded.otherMinistryId });
    expect(refusalOf(activeGrant(granted, elsewhere, clockAt(0)), "activeGrant").reason).toBe("ministry-not-admitted");
    // the seeded share carries two separate episodes in two separate ministries
    expect(seeded.activeGrant.ministryIds).toEqual([seeded.ministryId]);
    expect(seeded.revokedGrant.ministryIds).toEqual([seeded.otherMinistryId]);
    expect(seeded.activeGrant.grantId).not.toBe(seeded.revokedGrant.grantId);
  });
});

describe("B — the cutoff is exclusive, frozen at acceptance, and bounded by the earlier limit", () => {
  it("closes at the exclusive start of the civil day after the Share-through date, and not one millisecond earlier", () => {
    const granted = grantOf();
    const cutoff = frozenCutoffOf(granted);
    // the chosen date is day zero: the share closes at the first instant of the day after it
    const expected = SHARE_THROUGH.add({ days: 1 }).toZonedDateTime(seeded.frozenZone).toInstant();
    expect(cutoff.toString()).toBe(expected.toString());
    // one millisecond before the cutoff a read is admitted ...
    const openAt = clockAt(offsetOf(cutoff.subtract({ milliseconds: 1 })));
    expect(openAt.toString()).toBe(cutoff.subtract({ milliseconds: 1 }).toString());
    expect(activeGrant(granted, contextFor("coach", COACH), openAt).ok).toBe(true);
    expect(shareWindowOpenAt({ cutoffInstant: cutoff, now: openAt }).status).toBe("open");
    // ... and exactly at the cutoff it is denied, with the boundary at equality and not a day later
    const closedAt = clockAt(offsetOf(cutoff));
    expect(closedAt.toString()).toBe(cutoff.toString());
    expect(refusalOf(activeGrant(granted, contextFor("coach", COACH), closedAt), "activeGrant").reason).toBe("cutoff-reached");
    expect(shareWindowOpenAt({ cutoffInstant: cutoff, now: closedAt }).status).toBe("closed");
    // the module gate refuses the same way rather than reporting an empty module
    expect(refusalOf(assertModuleAdmitted(granted, "targets", contextFor("coach", COACH), closedAt), "assertModuleAdmitted").reason).toBe("cutoff-reached");
    // the chosen date is readable back out of the frozen instant, in the zone it was frozen in
    expect(shareThroughDateOfCutoff({ cutoffInstant: cutoff, frozenZone: seeded.frozenZone })?.toString()).toBe(SHARE_THROUGH.toString());
  });

  it("freezes the cutoff at acceptance, so travelling the clock moves no instant", () => {
    const invited = invitationOf();
    // nothing is settled before acceptance
    expect(invited.duration?.cutoffInstant).toBeNull();
    expect(invited.duration?.settledAt).toBeNull();
    const accepted = acceptedFrom(invited, ACCEPTED_AT);
    const frozen = frozenCutoffOf(accepted);
    expect(accepted.duration?.settledAt?.toString()).toBe(ACCEPTED_AT.toString());
    expect(accepted.duration?.frozenZone).toBe(seeded.frozenZone);
    // travel well past the cutoff and read the same relationship: the instant is the one it froze
    const travelled = clockAt(offsetOf(Temporal.Instant.from("2027-03-01T00:00:00Z")));
    expect(travelled.toString()).toBe("2027-03-01T00:00:00Z");
    expect(frozenCutoffOf(accepted).toString()).toBe(frozen.toString());
    // recomputing the same choice does not consult the clock either
    const recomputed = boundedCutoff(shareCutoff({ shareThroughDate: SHARE_THROUGH, frozenZone: seeded.frozenZone }), "shareCutoff");
    expect(recomputed.toString()).toBe(frozen.toString());
    // the read is closed at the travelled instant although the stored status still says active, so a
    // stale status row cannot reopen a window that has run out
    expect(refusalOf(activeGrant(accepted, contextFor("coach", COACH), travelled), "activeGrant").reason).toBe("cutoff-reached");
    expect(accepted.state).toBe("active");
  });

  it("freezes in the source zone, so the same date elsewhere is a different instant", () => {
    const summer = Temporal.PlainDate.from("2026-07-01");
    const inSourceZone = boundedCutoff(shareCutoff({ shareThroughDate: summer, frozenZone: seeded.frozenZone }), "shareCutoff");
    const asUtc = boundedCutoff(shareCutoff({ shareThroughDate: summer, frozenZone: "UTC" }), "shareCutoff");
    // midnight after the chosen date, where the share was made
    expect(inSourceZone.toString()).toBe(summer.add({ days: 1 }).toZonedDateTime(seeded.frozenZone).toInstant().toString());
    // a display zone is not the source zone: the same date resolves to a different instant there, and
    // a display change cannot move the instant a stored grant froze
    expect(inSourceZone.toString()).not.toBe(asUtc.toString());
    expect(shareThroughDateOfCutoff({ cutoffInstant: inSourceZone, frozenZone: seeded.frozenZone })?.toString()).toBe(summer.toString());
    expect(shareThroughDateOfCutoff({ cutoffInstant: asUtc, frozenZone: "UTC" })?.toString()).toBe(summer.toString());
  });

  it("lets an earlier source limit win, and reports that it did", () => {
    const sourceLimit = Temporal.Instant.from("2026-12-10T00:00:00Z");
    const frozen = valueOf(freezeShareDuration({ kind: "through-date", shareThroughDate: SHARE_THROUGH, frozenZone: seeded.frozenZone }, ACCEPTED_AT, { sourceLimit }), "freezeShareDuration");
    // the effective bound is the earlier limit, and the result states which bound it used
    expect(frozen.cutoffInstant?.toString()).toBe(sourceLimit.toString());
    expect(frozen.limitedBy).toBe("source");
    expect(frozen.sourceLimitInstant?.toString()).toBe(sourceLimit.toString());
    expect(frozen.nominalDisagreesWithResolved).toBe(true);
    expect(frozen.nominalWording).toBe(`Shared through ${SHARE_THROUGH.toString()}`);
    // the window function reports both instants, so the wording and the resolved bound stay distinct
    const limited = shareCutoff({ shareThroughDate: SHARE_THROUGH, frozenZone: seeded.frozenZone, sourceLimit });
    if (limited.status !== "bounded" || limited.limitedBy !== "source") {
      throw new Error(`A source-limited cutoff must report the earlier limit, and this one returned ${limited.status}`);
    }
    expect(limited.cutoffInstant.toString()).toBe(sourceLimit.toString());
    expect(limited.shareThroughCutoffInstant.toString()).toBe(SHARE_THROUGH.add({ days: 1 }).toZonedDateTime(seeded.frozenZone).toInstant().toString());
    // the read is denied at the earlier bound, and admitted one millisecond before it
    const granted = grantUnderSourceLimit(sourceLimit);
    expect(refusalOf(activeGrant(granted, contextFor("coach", COACH), clockAt(offsetOf(sourceLimit))), "activeGrant").reason).toBe("cutoff-reached");
    expect(activeGrant(granted, contextFor("coach", COACH), clockAt(offsetOf(sourceLimit.subtract({ milliseconds: 1 })))).ok).toBe(true);
  });

  it("treats an unstated duration as no permission, and an open-ended one as a stated choice", () => {
    // a duration that was never stated freezes nothing at all
    expect(refusalOf(freezeShareDuration(null, ACCEPTED_AT), "freezeShareDuration").reason).toBe("missing-duration");
    const accepted = acceptedFrom(invitationOf(), ACCEPTED_AT);
    const durationless: CoachingGrant = { ...accepted, duration: null };
    expect(refusalOf(activeGrant(durationless, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("missing-duration");
    // an open-ended share is the opposite fact: it is stated, so it resolves to no cutoff rather than
    // to an unknown one, and the episode opens
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
    // the cutoff is still ahead, so the refusal comes from the end of the relationship and not from time
    const at = clockAt(0);
    expect(Temporal.Instant.compare(at, frozenCutoffOf(ended))).toBeLessThan(0);
    const refusal = refusalOf(activeGrant(ended, contextFor("coach", COACH), at), "activeGrant");
    expect(refusal.reason).toBe("ended");
    // nothing enumerable came back: no count, no title and no existence flag
    expect(Object.keys(refusal).sort()).toEqual(["message", "reason"]);
    expect(Object.keys(refusal)).not.toEqual(expect.arrayContaining(["count", "total", "title", "label", "exists", "records", "items", "ids", "grantId"]));
    // the module gate answers with the same fact
    expect(refusalOf(assertModuleAdmitted(ended, "targets", contextFor("coach", COACH), at), "assertModuleAdmitted").reason).toBe("ended");
  });

  it("refuses a save carrying a revision captured before the end, and leaves the episode ended", () => {
    const active = grantOf();
    const revisionBeforeEnd = active.revision;
    const ended = valueOf(endGrant(active, { endedBy: WORKER, expectedRevision: revisionBeforeEnd }), "endGrant");
    // the stale action: the worker's own interface, the revision it read before the end, every module on
    const stale = refusalOf(setModuleSelection(ended, { changedBy: WORKER, selection: selectionWith([...MODULE_KEYS]), expectedRevision: revisionBeforeEnd }, clockAt(0)), "setModuleSelection");
    expect(stale.reason).toBe("ended");
    expect(stale.reason).not.toBe("stale-revision");
    // the state after: still ended, and every later attempt answers on the same fact
    expect(ended.state).toBe("ended");
    expect(refusalOf(activeGrant(ended, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("ended");
    expect(refusalOf(endGrant(ended, { endedBy: WORKER, expectedRevision: ended.revision }), "endGrant").reason).toBe("ended");
    expect(refusalOf(revokeGrant(ended, { revokedBy: WORKER, expectedRevision: ended.revision }), "revokeGrant").reason).toBe("ended");
    expect(refusalOf(supersedeGrant(ended, { changedBy: WORKER, supersededBy: "grant-newer", expectedRevision: ended.revision }), "supersedeGrant").reason).toBe("ended");
    expect(refusalOf(leaveGrant(ended, { leftBy: COACH, expectedRevision: ended.revision }), "leaveGrant").reason).toBe("ended");
    // a stale revision on an open episode is the other refusal: the record moved, the episode did not end
    const open = grantOf();
    const staleRevision = refusalOf(setModuleSelection(open, { changedBy: WORKER, selection: selectionWith(["targets"]), expectedRevision: open.revision + 7 }, clockAt(0)), "setModuleSelection");
    expect(staleRevision.reason).toBe("stale-revision");
  });

  it("keeps revoked, expired and ended apart, and revives none of them", () => {
    const active = grantOf();
    const revoked = valueOf(revokeGrant(active, { revokedBy: WORKER, expectedRevision: active.revision }), "revokeGrant");
    expect(revoked.state).toBe("revoked");
    const revokedReason = refusalOf(activeGrant(revoked, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason;
    // a revocation is not undone by a module save either
    expect(refusalOf(setModuleSelection(revoked, { changedBy: WORKER, selection: selectionWith(["targets"]), expectedRevision: active.revision }, clockAt(0)), "setModuleSelection").reason).toBe(
      "revoked",
    );
    // expired is the invitation's own window, and it is closed at its endpoint rather than after it
    const late = invitationOf();
    const expiredReason = refusalOf(acceptGrant(late, { acceptedBy: COACH, identityVerification: "verified", expectedRevision: late.revision }, INVITATION_EXPIRES_AT), "acceptGrant").reason;
    const expired: CoachingGrant = { ...acceptedFrom(invitationOf(), ACCEPTED_AT), state: "expired" };
    expect(refusalOf(activeGrant(expired, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("expired");
    // ended is its own fact
    const endedSource = grantOf();
    const ended = valueOf(endGrant(endedSource, { endedBy: WORKER, expectedRevision: endedSource.revision }), "endGrant");
    const endedReason = refusalOf(activeGrant(ended, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason;
    // three closures, three answers: none of them can be read as another
    expect(new Set([revokedReason, expiredReason, endedReason]).size).toBe(3);
    for (const reason of [revokedReason, expiredReason, endedReason]) {
      expect(GRANT_LIFECYCLE_STATES).toContain(reason);
    }
  });

  it("closes an unaccepted invitation by replacement, and refuses to replace one that was accepted", () => {
    const replaced = valueOf(supersedeGrant(invitationOf(), { changedBy: WORKER, supersededBy: "grant-newer", expectedRevision: 0 }), "supersedeGrant");
    expect(replaced.state).toBe("superseded");
    expect(replaced.invitation.supersededBy).toBe("grant-newer");
    // a replaced invitation can no longer be accepted
    const lateAccept = refusalOf(acceptGrant(replaced, { acceptedBy: COACH, identityVerification: "verified", expectedRevision: replaced.revision }, ACCEPTED_AT), "acceptGrant");
    expect(lateAccept.reason).toBe("superseded");
    // and it admits no read: nothing was ever accepted under it, which is the fact the read answers with
    expect(refusalOf(activeGrant(replaced, contextFor("coach", COACH), clockAt(0)), "activeGrant").reason).toBe("not-accepted");
    // once accepted, replacing the invitation is not the way out: the relationship has to be revoked or ended
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
    // every other transition in this job refuses the coach as the wrong side of the relationship
    const refusals: readonly (readonly [string, CoachingRefusal])[] = [
      [
        "setModuleSelection",
        refusalOf(setModuleSelection(selected, { changedBy: COACH, selection: selectionWith([...MODULE_KEYS]), expectedRevision: selected.revision }, clockAt(0)), "setModuleSelection"),
      ],
      ["revokeGrant", refusalOf(revokeGrant(selected, { revokedBy: COACH, expectedRevision: selected.revision }), "revokeGrant")],
      ["endGrant", refusalOf(endGrant(selected, { endedBy: COACH, expectedRevision: selected.revision }), "endGrant")],
      ["supersedeGrant", refusalOf(supersedeGrant(selected, { changedBy: COACH, supersededBy: "grant-newer", expectedRevision: selected.revision }), "supersedeGrant")],
    ];
    // every worker-only transition refuses the coach as the wrong side of the relationship
    expect(Object.fromEntries(refusals.map(([label, refusal]) => [label, refusal.reason]))).toEqual({
      setModuleSelection: "not-holder",
      revokeGrant: "not-holder",
      endGrant: "not-holder",
      supersedeGrant: "not-holder",
    }); // and the worker cannot leave on the coach's behalf
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
      // no state came back either, so nothing tells the coach whether that module is empty or withheld
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
    // the seeded relationship shares neither financial module, so it discloses no figure at all
    expect(seeded.activeGrant.modules["support-goal"]).toBe(false);
    expect(seeded.activeGrant.modules["support-results"]).toBe(false);
    expect(seeded.activeGrant.financialRange).toBeNull();
    const goalOnly = grantOf({ modules: ["support-goal"] });
    expect(valueOf(admittedModules(goalOnly, contextFor("coach", COACH), clockAt(0)), "admittedModules")).toEqual(["support-goal"]);
    // a shared goal shares no results: the second financial module is a separate switch, still off
    expect(goalOnly.modules["support-results"]).toBe(false);
    expect(refusalOf(assertModuleAdmitted(goalOnly, "support-results", contextFor("coach", COACH), clockAt(0)), "assertModuleAdmitted").reason).toBe("module-not-admitted");
    // switching the second one on is a deliberate second act that moves no other switch
    const both = valueOf(
      setModuleSelection(goalOnly, { changedBy: WORKER, selection: selectionWith(["support-goal", "support-results"]), expectedRevision: goalOnly.revision }, clockAt(0)),
      "setModuleSelection",
    );
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
    if (refusedModule.allowed) {
      throw new Error("An unshared module must not be readable");
    }
    expect(refusedModule.denial.reasonCode).toBe("no-permission");
    expect(isOutcome(refusedModule.denial)).toBe(true);
    // nothing enumerable: no count, no title, no existence flag and no record list
    expect(Object.keys(refusedModule.denial).sort()).toEqual(["operationId", "outcome", "reasonCode"]);
    // a coach reads and never writes, whatever the surface offers
    expect(canEdit(coachSession, { kind: "cohort-subject", grant: record, module: "targets", now: at }).allowed).toBe(false);
    // nor may anyone else read a subject they do not hold
    expect(canView(resolvedSessionOf(OUTSIDER), { kind: "cohort-subject", grant: record, module: "targets", now: at }).allowed).toBe(false);
  });

  it("refuses a coach read once the relationship ended or its cutoff was reached, even on a stale active row", () => {
    const coachSession = resolvedSessionOf(COACH);
    const at = clockAt(0);
    const ended = storedGrantOf({ state: "ended" });
    const staleActive = storedGrantOf({ state: "active", cutoffInstant: "2026-11-01T00:00:00Z" });
    expect(canView(coachSession, { kind: "cohort-subject", grant: ended, module: "targets", now: at }).allowed).toBe(false);
    expect(canView(coachSession, { kind: "cohort-subject", grant: staleActive, module: "targets", now: at }).allowed).toBe(false);
    // the worker still reads the history of what they shared, and may act on it only while it is live
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
    // the coach's projection is exactly these six facts
    expect(Object.keys(coachProgress).sort()).toEqual(["count", "measure", "period", "quantity", "revisionId", "state"]);
    // named one by one, because each is a field the coach envelope must not carry
    const forbidden: readonly string[] = [
      "privateLabel",
      "homePlacement",
      "note",
      "notes",
      "donor",
      "donors",
      "gift",
      "gifts",
      "amount",
      "amounts",
      "money",
      "currency",
      "total",
      "totals",
      "sum",
      "ranking",
      "rank",
      "score",
    ];
    expect(Object.keys(coachProgress).filter((field) => forbidden.includes(field))).toEqual([]);
    // the worker's own projection carries the label, so the difference is the projection and not the data
    const workerProgress = workerTargetProgress({ target, version, period, count: 2 });
    expect(workerProgress.privateLabel).toBe(seeded.conversationsTarget.privateLabel);
    expect(workerProgress.revisionId).toBe(coachProgress.revisionId);
    expect(workerProgress.measure).toBe(coachProgress.measure);
    // two targets are two projections of the same shape: nothing joins them into one portfolio figure
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
    // a genuine zero, an unread source and no target at all stay three different renderings
    expect(resolveTargetState({ target: undefined, recorded: 0, placement: "placed" })).toBe("no-target");
    expect(resolveTargetState({ target, recorded: 0, placement: "placed" })).toBe("zero-recorded");
    expect(resolveTargetState({ target, recorded: null, placement: "placed" })).toBe("unavailable");
    expect(resolveTargetState({ target, recorded: 3, placement: "placed" })).toBe("active");
    // paused and ended are their own states, and a Home placement the coach cannot see changes none of them
    expect(resolveTargetState({ target: { ...target, state: "paused" }, recorded: 3, placement: "placed" })).toBe("paused");
    expect(resolveTargetState({ target: { ...target, state: "ended" }, recorded: 3, placement: "placed" })).toBe("ended");
    expect(resolveTargetState({ target, recorded: 3, placement: "not-disclosed" })).toBe("active");
    expect(TARGET_STATES).toEqual(["no-target", "active", "zero-recorded", "paused", "ended", "unplaced", "unavailable"]);
    // a reviewed range with no figure states nothing rather than a zero
    const emptyRange = refusalOf(describeFinancialRange({ from: OPENING_WEEK_START, to: OPENING_WEEK_START.add({ days: 6 }), measures: [] }, "en-GB"), "describeFinancialRange");
    expect(emptyRange.reason).toBe("invalid-selection");
    expect(emptyRange.message).toContain("rather than a zero");
  });

  it("leaves the other admitted modules usable when one module's source is down", () => {
    const flags = scenarioFlagsFor("coaching-module-unavailable");
    // the registry names this world: one admitted coaching module's source is down
    expect(flags.coachingModule).toBe("unavailable");
    expect(scenarioFlagsFor("baseline").coachingModule).toBe("available");
    const granted = grantOf({ modules: ["support-results", "targets", "check-ins"] });
    const at = clockAt(0);
    const complete = { presence: "complete", withheldUntilReReviewed: false } as const;
    // the down fact travels per module, inside the authority each module read runs under, so it reaches
    // one module and no other: that is what keeps a single outage from blanking the whole relationship
    const down = contextFor("coach", COACH, { availability: flags.coachingModule === "unavailable" ? "unavailable" : "available" });
    // the module whose source is down reports unavailable, and never empty
    const unavailableModule = valueOf(moduleReadState(granted, "support-results", down, at, complete), "moduleReadState");
    expect(unavailableModule).toBe("unavailable");
    expect(unavailableModule).not.toBe("empty");
    // the modules whose sources are up keep returning their own readings
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
    const heldModule = refusalOf(
      moduleReadState(granted, "targets", contextFor("coach", COACH, { hold: "temporary" }), at, { presence: "complete", withheldUntilReReviewed: false }),
      "moduleReadState",
    );
    expect(heldModule.reason).toBe("permission-hold");
    // a summary withdrawn for review is withheld rather than empty, and its neighbour is unaffected
    expect(valueOf(moduleReadState(granted, "targets", contextFor("coach", COACH), at, { presence: "complete", withheldUntilReReviewed: true }), "moduleReadState")).toBe("withheld");
    expect(valueOf(moduleReadState(granted, "check-ins", contextFor("coach", COACH), at, { presence: "complete", withheldUntilReReviewed: false }), "moduleReadState")).toBeNull();
    // at the cutoff the same module reports ended, which is neither withheld nor empty
    const closedAt = clockAt(offsetOf(frozenCutoffOf(granted)));
    expect(valueOf(moduleReadState(granted, "targets", contextFor("coach", COACH), closedAt, { presence: "complete", withheldUntilReReviewed: true }), "moduleReadState")).toBe("ended");
  });

  it("authorises the coach by grant, and gives them no export of anyone's support", () => {
    const coachSession = resolvedSessionOf(COACH);
    const scope: Scope = {
      organizationId: seeded.organizationId,
      ministryId: seeded.ministryId as Scope["ministryId"],
      supportSubjectId: seeded.supportSubjectId,
      principalId: COACH as Scope["principalId"],
    };
    // the coach holds no membership of the ministry, so membership authority is refused and the grant is
    // the only thing that admits them
    expect(assertScopeUnder(coachSession, scope, "membership").ok).toBe(false);
    expect(assertScopeUnder(coachSession, scope, "grant").ok).toBe(true);
    // and there is no export of a coach's view
    const exportDecision = canExport(coachSession, scope);
    expect(exportDecision.allowed).toBe(false);
    if (exportDecision.allowed) {
      throw new Error("A coach must hold no export");
    }
    expect(exportDecision.denial.reasonCode).toBe("no-export-permission");
    expect(Object.keys(exportDecision.denial).sort()).toEqual(["operationId", "outcome", "reasonCode"]);
  });
});

describe("E — four measures, credited once, from activity that actually happened", () => {
  it("counts exactly four measures, and names the credit of every event kind", () => {
    expect(TARGET_MEASURES).toEqual(["calls-made", "personal-messages", "conversations", "meetings-held"]);
    expect(TARGET_MEASURES).toHaveLength(4);
    // only an actual exchange earns a measure, and each of the four has exactly one source kind
    const crediting = ACTIVITY_EVENT_KINDS.filter((kind) => classifyActivity(eventOf(kind, OPENING_WEEK_START)) !== "none");
    expect(crediting).toEqual(["call", "personal-message", "conversation", "meeting-held"]);
    expect(classifyActivity(eventOf("personal-message", OPENING_WEEK_START))).toBe("personal-messages");
    expect(classifyActivity(eventOf("meeting-held", OPENING_WEEK_START))).toBe("meetings-held");
    // every event kind is classified: four measures and the abstention, and nothing uncategorised
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
    // neither number is derived from the other: each measure counts only its own kind of record
    expect(countOf("calls-made", conversations, week)).toBe(0);
    expect(countOf("conversations", calls, week)).toBe(0);
    // and the plan in force is a third number again, because a plan is not a count
    expect(seeded.conversationsTarget.quantity).toBe(3);
    expect(countOf("conversations", both, week)).not.toBe(seeded.conversationsTarget.quantity);
  });

  it("counts nothing for a planned meeting, a no-show, a broadcast, an automated reply, an open or a click", () => {
    const week = weekOf(seeded.conversationsTarget, OPENING_WEEK_START.add({ days: 2 }));
    const calls = eventsOf("call", 5, week.start);
    const nonActivities: readonly ActivityEventKind[] = [
      "meeting-planned",
      "task-completed",
      "dialer-opened",
      "mail-opened",
      "no-show",
      "broadcast",
      "automated-reply",
      "message-opened",
      "link-clicked",
    ];
    const table = nonActivities.map((kind) => {
      const event = eventOf(kind, week.start);
      const counts = TARGET_MEASURES.map((measure) => countOf(measure, [event], week));
      // nor does any of them disturb the five calls already counted
      return [kind, { credit: classifyActivity(event), counts, withTheFiveCalls: countOf("calls-made", [...calls, event], week) }] as const;
    });
    // every one of them credits nothing on every measure, and leaves the five calls where they were
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
    if (firstCall === undefined) {
      throw new Error("The five-call fixture produced no activity at all.");
    }
    // the same record offered twice is one call, not two
    expect(countOf("calls-made", [...calls, firstCall], week)).toBe(5);
    // an identity already credited by an earlier read is never credited again
    const alreadyCredited = new Set(calls.map((call) => call.activityId));
    expect(countOf("calls-made", calls, week, alreadyCredited)).toBe(0);
    expect(countOf("calls-made", [...calls, ...eventsOf("call", 2, week.start, "later")], week, alreadyCredited)).toBe(2);
    // the day it happened decides the bucket: the last included day counts, the exclusive end does not
    expect(countOf("calls-made", [eventOf("call", week.endInclusive)], week)).toBe(1);
    expect(countOf("calls-made", [eventOf("call", week.exclusiveEnd)], week)).toBe(0);
    expect(countOf("calls-made", [eventOf("call", week.start)], week)).toBe(1);
    // an occurrence that names no day falls in no bucket, rather than in today's
    const undated: ActivityEvent = { activityId: "activity-undated", kind: "call", occurrence: { precision: "unknown" } };
    expect(countOf("calls-made", [undated], week)).toBe(0);
    expect(measureFor({ measure: "calls-made", period: week, activities: [undated], alreadyCredited: new Set() }).creditedActivityIds).toEqual([]);
    // an approximate date is still a date, and it is bucketed where the record places it
    const approximate: ActivityEvent = { activityId: "activity-approximate", kind: "call", occurrence: { precision: "approximate", date: week.start } };
    expect(countOf("calls-made", [approximate], week)).toBe(1);
    // the count reports the identities it credited, so a caller can carry them forward
    const counted = measureFor({ measure: "calls-made", period: week, activities: calls, alreadyCredited: new Set() });
    expect(counted.creditedActivityIds).toHaveLength(5);
    expect(countOf("calls-made", calls, week, new Set(counted.creditedActivityIds))).toBe(0);
  });
});

describe("F — a plan change begins a prospective version, and a closed period keeps its own", () => {
  const CHANGE: TargetVersionChange = {
    revisionId: "target-conversations-weekly-3",
    quantity: 6,
    measure: "conversations",
    calendarStart: OPENING_WEEK_START,
  };

  const EFFECTIVE_FROM = Temporal.PlainDate.from("2026-11-16");

  it("closes one version the day before the next begins, with no gap, no overlap and no bridge", () => {
    const record = seeded.conversationsTarget;
    const anchor = anchorOf(record);
    const versions = versionsOf(record);
    const next = valueOf(startProspectiveVersion({ versions, anchor, change: CHANGE, effectiveFrom: EFFECTIVE_FROM }), "startProspectiveVersion");
    expect(next).toHaveLength(versions.length + 1);
    // read in order, each version ends the day before the next begins: adjacent, and never overlapping
    for (let index = 0; index < next.length - 1; index += 1) {
      const current = next[index];
      const following = next[index + 1];
      if (current === undefined || following === undefined) {
        throw new Error(`The prospective history has no version at position ${String(index)}.`);
      }
      const closesOn = current.effectiveTo;
      if (closesOn === undefined) {
        throw new Error(`Version ${current.revisionId} never closes, so nothing can follow it.`);
      }
      expect(closesOn.add({ days: 1 }).equals(following.effectiveFrom), `${current.revisionId} then ${following.revisionId}`).toBe(true);
      expect(Temporal.PlainDate.compare(closesOn, following.effectiveFrom), `${current.revisionId} -> ${following.revisionId}`).toBeLessThan(0);
    }
    const last = next.at(-1);
    if (last === undefined) {
      throw new Error("The prospective history is empty.");
    }
    expect(last.effectiveTo).toBeUndefined();
    expect(last.revisionId).toBe(CHANGE.revisionId);
    expect(last.quantity).toBe(6);
    // every boundary falls on a calendar start, so no period is split and no prorated bridge exists
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
    // the version that was open before the change is the one that closed
    const previous = next[1];
    if (previous === undefined) {
      throw new Error("The change closed no version.");
    }
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
    // the closed week resolves to the same plan by identity, not merely to the same number
    const afterChange = valueOf(resolveTargetVersion(next, closedPeriod), "resolveTargetVersion");
    expect(afterChange.revisionId).toBe(beforeChange.revisionId);
    expect(afterChange.quantity).toBe(2);
    // the week that closed when the change began keeps its own version too
    const previousPeriod = weekOf(record, Temporal.PlainDate.from("2026-11-12"));
    const previousVersion = valueOf(resolveTargetVersion(next, previousPeriod), "resolveTargetVersion");
    expect(previousVersion.revisionId).toBe("target-conversations-weekly-2");
    expect(previousVersion.quantity).toBe(3);
    // the period after the boundary reads the new plan
    const newPeriod = weekOf(record, Temporal.PlainDate.from("2026-11-19"));
    const applied = valueOf(resolveTargetVersion(next, newPeriod), "resolveTargetVersion");
    expect(applied.revisionId).toBe(CHANGE.revisionId);
    expect(applied.quantity).toBe(6);
    // and a coach reading either period is told which plan that period was measured against
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
    // restating the plan in force creates no version, because nothing would change
    expect(refusalOf(startProspectiveVersion({ versions, anchor, change: { ...CHANGE, quantity: 3 }, effectiveFrom: EFFECTIVE_FROM }), "startProspectiveVersion")).toBe("no-change");
    // a boundary inside a period would prorate it, so it is refused rather than averaged
    expect(refusalOf(startProspectiveVersion({ versions, anchor, change: CHANGE, effectiveFrom: Temporal.PlainDate.from("2026-11-18") }), "startProspectiveVersion")).toBe("misaligned-boundary");
    // a version that starts at or before the latest one would rewrite history
    expect(refusalOf(startProspectiveVersion({ versions, anchor, change: CHANGE, effectiveFrom: OPENING_WEEK_START }), "startProspectiveVersion")).toBe("not-prospective");
    // a quantity no target can hold
    expect(refusalOf(startProspectiveVersion({ versions, anchor, change: { ...CHANGE, quantity: 0 }, effectiveFrom: EFFECTIVE_FROM }), "startProspectiveVersion")).toBe("invalid-quantity");
  });

  it("refuses a period two versions claim, and one no version covers", () => {
    const record = seeded.conversationsTarget;
    const versions = versionsOf(record);
    const [firstVersion] = versions;
    if (firstVersion === undefined) {
      throw new Error("The seeded target states no version, so no period can be resolved against it.");
    }
    const covered = weekOf(record, Temporal.PlainDate.from("2026-11-05"));
    // two plans for one period is a contradiction, not an average
    const duplicated = [...versions, { ...firstVersion, revisionId: "target-conversations-weekly-duplicate" }];
    expect(refusalOf(resolveTargetVersion(duplicated, covered), "resolveTargetVersion")).toBe("overlapping-versions");
    // a period the plan never covered has no version at all
    const before = weekOf(record, Temporal.PlainDate.from("2026-10-29"));
    expect(refusalOf(resolveTargetVersion(versions, before), "resolveTargetVersion")).toBe("no-version");
  });
});
