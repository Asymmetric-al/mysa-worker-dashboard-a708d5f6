/** Success criteria 16 and 19 at the store boundary: a coach's read authorises before it enumerates, and a read from another scope retrieves nothing. */
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newOperationId } from "@/lib/ids";
import { DENIAL_VALUE_KEYS } from "@/lib/redaction";
import { mutations, reads, type CoachingGrantRecord, type MutationInput, type Scope } from "@/modules/data-service";
import type { SessionSource } from "@/modules/data-service/authorize";
import { ministryIdSchema, organizationIdSchema, principalIdSchema, scopeSchema, supportSubjectIdSchema, type SessionContextRecord } from "@/modules/data-service/envelope";
import { DENIAL_REASONS, isOutcome, isReadResult, type ConflictOutcome, type DeniedOutcome, type MutationOutcome, type ReadResult } from "@/modules/data-service/outcome";
import { GRANT_LIFECYCLE_STATES, MODULE_KEYS, NO_MODULES_SELECTED, type ModuleKey } from "@/modules/coaching/grant";
import { setFailurePlan, type FailurePlanDocument } from "@/modules/dev-runtime/failures";
import { buildSessionMeta, setClock, type AdmittedMembership, type ScenarioId, type SessionMetaDocument } from "@/modules/dev-runtime/scenario";
import { SEEDED_PERSONAS, findSeededSession, type SeededSession, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { resetSession } from "@/modules/store/repository";
import { SEED_INSTANT } from "@/modules/time/clock";
import { shareCutoff, shareThroughDateOfCutoff } from "@/modules/time/window";
import { firstSaying, requiredSaying, throwing } from "../helpers/answers";
import { scopeOf, seededDocuments, sessionOf, storedStateOf } from "../helpers/fixtures";
const COACH_SESSION = "it-coach-boundary";
const WORKER_SESSION = "it-coach-boundary-worker";
const SECOND_WORKER_SESSION = "it-coach-boundary-second";
const COACH_SOURCE: SessionSource = { sessionId: COACH_SESSION };
const WORKER_SOURCE: SessionSource = { sessionId: WORKER_SESSION };
const SECOND_WORKER_SOURCE: SessionSource = { sessionId: SECOND_WORKER_SESSION };
const WORKER_SEED = "established-worker"; // The seeded session whose own world the worker seat holds in every case, laid down here under this file's own session id.
const COACH_SEAT_SEED = "reader-public"; // A seeded session whose world holds no records at all: the coach's seat starts from that empty world, so nothing below can be answered from a copy of the worker's.
const ACTIVE_GRANT_ID = "grant-established-coach";
const REVOKED_GRANT_ID = "grant-revoked-coach";
const ENDED_GRANT_ID = "grant-ended-coach";
const SUPPORT_SHARING_GRANT_ID = "grant-established-coach-support";
const SEEDED_DOWN_MODULE_SESSION = "coach-coaching-module-unavailable"; // The two seeded seats the scenario case reads: the coach's own seat in the unavailable-module world, and the baseline coach's seat as the control that the scenario is what changed rather than the world
const SEEDED_DOWN_MODULE_WORLD = "established-worker-coaching-unavailable"; // The two worlds those seats are seated in, laid down from the seed's own documents so the case reads the seeded world itself rather than a copy of it.
const SEEDED_BASELINE_COACH_SESSION = "coach";
const SEEDED_BASELINE_WORLD = "established-worker";
const COACH_PRINCIPAL = SEEDED_PERSONAS.coach.principalId;
const WORKER_PRINCIPAL = SEEDED_PERSONAS["established-worker"].principalId;
const SECOND_WORKER_PRINCIPAL = SEEDED_PERSONAS["second-worker"].principalId;
/** The smallest step the scenario clock takes, so the two sides of a boundary sit one millisecond apart. */
const seededSession = (sessionId: string): SeededSession => requiredSaying(findSeededSession(sessionId), `The seed states no session ${JSON.stringify(sessionId)}, so this file has no world to lay its own sessions down from.`);
const WORKER_ROW = seededSession("established-worker");
const SECOND_WORKER_ROW = seededSession("second-worker");
const YOUTH = admissionIn(WORKER_ROW, "min-harbour-youth");
function admissionIn(row: SeededSession, ministryId: string): AdmittedMembership {
  const found = row.admittedMemberships.find((membership) => membership.ministryId === ministryId) ?? throwing(`The seeded ${JSON.stringify(row.sessionId)} session is admitted to no ministry ${JSON.stringify(ministryId)}, so no case here has a context to invite a coach in.`);
  return found;
}
function contextOf(state: SessionStateDocument, sessionId: string, meta: SessionMetaDocument): SessionContextRecord {
  const selected = meta.selectedContext;
  return {
    sessionId, // A record set states the session and the principal that own it, so the private session's own identifiers are written into the document it holds rather than naming a session reading nothing.
    principalId: principalIdSchema.parse(meta.principalId),
    admittedMemberships: [...meta.admittedMemberships],
    selectedOrganizationId: selected === null ? null : organizationIdSchema.parse(selected.organizationId),
    selectedMinistryId: selected === null ? null : ministryIdSchema.parse(selected.ministryId),
    selectedSupportSubjectId: selected === null ? null : supportSubjectIdSchema.parse(selected.supportSubjectId),
    sessionState: meta.sessionState,
    scenarioId: meta.scenarioId,
    clockOffset: { milliseconds: meta.clockOffsetMs },
    revision: state.context.revision,
  };
}
/** Lays one seat's documents down under this file's own session id: the records of the seeded session it starts from, and the meta that states which world its coaching records live in. */
async function layDownSession(sessionId: string, meta: SessionMetaDocument, seedId: string): Promise<void> {
  const template = await seededDocuments(seedId);
  const state = structuredClone(template.state);
  await resetSession(sessionId, { state: { ...state, context: contextOf(state, sessionId, meta) }, operations: structuredClone(template.operations), meta });
}
async function layDownSeededSession(sessionId: string): Promise<void> {
  const template = await seededDocuments(sessionId);
  await resetSession(sessionId, { state: structuredClone(template.state), operations: structuredClone(template.operations), meta: structuredClone(template.meta) });
}
const grantRecord = (state: SessionStateDocument, grantId: string): CoachingGrantRecord => firstSaying(state.coachingGrants, "grantId", grantId, `The seeded world holds no coaching grant ${JSON.stringify(grantId)}, so the case that names it has nothing to assert about.`);
type MetaOverrides = { readonly scenarioId?: ScenarioId; readonly failurePlan?: FailurePlanDocument; readonly coachingRecordsSessionId?: string | null };
const workerMeta = (overrides: MetaOverrides = {}): SessionMetaDocument => buildSessionMeta({ principalId: WORKER_ROW.principalId, admittedMemberships: WORKER_ROW.admittedMemberships, selectedContext: WORKER_ROW.selectedContext, sessionState: "signed-in", ...overrides });
const coachMeta = (overrides: MetaOverrides = {}): SessionMetaDocument => buildSessionMeta({ principalId: COACH_PRINCIPAL, admittedMemberships: [], selectedContext: null, sessionState: "signed-in", coachingRecordsSessionId: WORKER_SESSION, ...overrides });
const secondWorkerMeta = (): SessionMetaDocument => buildSessionMeta({ principalId: SECOND_WORKER_ROW.principalId, admittedMemberships: SECOND_WORKER_ROW.admittedMemberships, selectedContext: SECOND_WORKER_ROW.selectedContext, sessionState: "signed-in" });
/** The one armed failure that names the read this file is about (AAP 0.12.5). */
function armedScopeDenial(): FailurePlanDocument {
  const plan = setFailurePlan(null, { mode: "denied", target: { kind: "read", name: "readCoachSubject" }, armedAt: SEED_INSTANT.toString() });
  if (!plan.ok) throw new Error(`The scope-denial plan the criterion 19 case arms was refused: ${plan.error.code}.`);
  return plan.value;
}
async function selectedScopeOf(source: SessionSource): Promise<Scope> {
  const resolved = await sessionOf(source);
  const selected = resolved.selected;
  if (selected === null) throw new Error(`The session ${JSON.stringify(source.sessionId)} has selected no context, so no case here has a scope to act in.`);
  return selected;
}
/** The scope a coach's own write claims: it holds no membership, so its principal and the grant's ministry state the authority it acts under. */
const grantAuthorityScope = (principalId: string, ministryId: string): Scope => scopeSchema.parse({ organizationId: `grant-authority:${ministryId}`, ministryId, supportSubjectId: `grant-authority:${ministryId}`, principalId });
const attempt = <P>(scope: Scope, payload: P, expectedRevision: string = "rev-1"): MutationInput<P> => ({ operationId: newOperationId(), scope, expectedRevision, payload });
const currentRevisionOf = async (sessionId: string, grantId: string): Promise<string> => grantRecord(await storedStateOf(sessionId), grantId).revision;
const assertEnvelope = <T>(result: ReadResult<T>): T => (result.kind !== "envelope" ? throwing(`The read answered ${JSON.stringify(result.kind)} where an envelope was required: an admitted scope is answered with its data, not with a refusal.`) : result.envelope);
const assertDenied = <T>(result: ReadResult<T>): DeniedOutcome => (result.kind !== "denied" ? throwing(`The read answered ${JSON.stringify(result.kind)} where a denial was required: a scope that holds nothing is refused, never answered with an empty envelope.`) : result.denied);
const assertConflict = (outcome: MutationOutcome): ConflictOutcome => (outcome.outcome !== "conflict" ? throwing(`The mutation answered ${serialised(outcome)} where a conflict was required: a stale or closed change is refused, with the current standing beside the input it preserved.`) : outcome);
function expectAccepted(outcome: MutationOutcome): { readonly revision: string; readonly created: readonly string[] } {
  if (outcome.outcome !== "accepted") throw new Error(`The mutation answered ${serialised(outcome)} where an acceptance was required.`);
  return { revision: outcome.revision, created: outcome.created ?? [] };
}
async function shareModules(grantId: string, keys: readonly ModuleKey[]): Promise<void> {
  for (const key of keys) {
    const alreadySelected = grantRecord(await storedStateOf(WORKER_SESSION), grantId).modules[key]; // Each change presents the revision the record stands at, so a refusal here can only be the module's own answer and never a stale token this file forgot to re-read.
    const outcome = await mutations.coaching.setModule(attempt(workerScope, { grantId, moduleKey: key, enabled: true }, await currentRevisionOf(WORKER_SESSION, grantId)), WORKER_SOURCE);
    expect(outcome.outcome).toBe(alreadySelected ? "unchanged" : "accepted"); // The grant's own record states which answer is due: a module already switched on produces no change, so this separates "already selected" from "just selected".
  }
}
async function sourceWorkOf(
  sessionId: string,
): Promise<{ readonly tasks: SessionStateDocument["tasks"]; readonly partners: SessionStateDocument["partners"]; readonly privateNotes: SessionStateDocument["privateNotes"]; readonly coachingTargets: SessionStateDocument["coachingTargets"]; readonly coachingCheckIns: SessionStateDocument["coachingCheckIns"] }> {
  const state = await storedStateOf(sessionId);
  return { tasks: state.tasks, partners: state.partners, privateNotes: state.privateNotes, coachingTargets: state.coachingTargets, coachingCheckIns: state.coachingCheckIns };
}
const serialised = (value: unknown): string => JSON.stringify(value);
/** Every key name a value carries at any depth, so a denial is inspected as a whole rather than one field at a time. */
function keysOf(value: unknown): readonly string[] {
  const collected = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, member] of Object.entries(node)) {
      collected.add(key);
      walk(member);
    }
  };
  walk(value);
  return [...collected];
}
/** The value an envelope's `valueStates` path names, so a state is judged against the datum it belongs to. */
function valueAtPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isSafeInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, segment);
  }
  return current;
}
function expectDenialWithholds(result: ReadResult<unknown>, forbidden: readonly string[]): void {
  const keys = keysOf(result);
  expect(keys).toContain("reasonCode"); // The refusal states its own fields and nothing else, so the walk has to have found them: an empty walk would make the whole check pass without looking at anything.
  for (const key of keys) expect(DENIAL_VALUE_KEYS).not.toContain(key);
  const text = serialised(result);
  for (const value of forbidden) expect(text).not.toContain(value);
}
/** Returns every session's scenario clock to the seed instant, so the next case starts where the last one began. */
async function restoreClocks(): Promise<void> {
  for (const sessionId of [WORKER_SESSION, COACH_SESSION, SECOND_WORKER_SESSION]) {
    const restored = await setClock(sessionId, 0);
    if (!restored.ok) throw new Error(`The scenario clock of ${JSON.stringify(sessionId)} could not be returned to the seed instant: ${restored.error.code}.`);
  }
}
let workerScope: Scope;
beforeAll(() => {
  vi.stubEnv("NODE_ENV", "development"); // The development controls and the named-session resolution are gated on `NODE_ENV`, so the run is put in a development build and the environment it arrived with is restored in `afterAll`.
});
beforeEach(async () => {
  await layDownSession(WORKER_SESSION, workerMeta(), WORKER_SEED); // Each case lays its own sessions down, so a sibling suite's global reset cannot strand it and no case inherits a document another case wrote.
  await layDownSession(COACH_SESSION, coachMeta(), COACH_SEAT_SEED); // The coach's own world carries no coaching record, so nothing below can be answered from a copy of the worker's.
  await layDownSession(SECOND_WORKER_SESSION, secondWorkerMeta(), SECOND_WORKER_ROW.sessionId);
  workerScope = await scopeOf(WORKER_SOURCE);
  await restoreClocks();
});
afterEach(async () => await restoreClocks());
afterAll(async () => {
  vi.unstubAllEnvs();
  for (const sessionId of [WORKER_SESSION, COACH_SESSION, SECOND_WORKER_SESSION]) await resetSession(sessionId); // Every session here is this file's own, so the store is left holding none of its fixtures.
});
describe("coach read boundary", () => {
  it("refuses a subject read to any principal the grant does not name, disclosing no count, identity or existence flag", async () => {
    // AAP 0.8.4 and criterion 19: authorisation happens before enumeration. The worker whose record the grant shares holds no coach authority over it, and the second worker holds nothing at all; both receive the one refusal, and it states none of the evidence the denial set withholds.
    const asWorker = await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, WORKER_SOURCE);
    expect(isReadResult(asWorker)).toBe(true);
    expect(DENIAL_REASONS).toContain(assertDenied(asWorker).reasonCode);
    expectDenialWithholds(asWorker, [ACTIVE_GRANT_ID, WORKER_PRINCIPAL, COACH_PRINCIPAL]);
    const asSecondWorker = await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, SECOND_WORKER_SOURCE);
    expect(assertDenied(asSecondWorker).reasonCode).toBe("no-permission");
    expectDenialWithholds(asSecondWorker, [ACTIVE_GRANT_ID, WORKER_PRINCIPAL, COACH_PRINCIPAL]);
    const secondWorkerScope = await selectedScopeOf(SECOND_WORKER_SOURCE); // The scope criterion 19 trusts is the resolver's own answer, and it covers neither party.
    expect(secondWorkerScope.principalId).toBe(SECOND_WORKER_PRINCIPAL);
    expect(secondWorkerScope.principalId).not.toBe(WORKER_PRINCIPAL);
    expect(grantRecord(await storedStateOf(WORKER_SESSION), ACTIVE_GRANT_ID).ministryIds).not.toContain(secondWorkerScope.ministryId);
    await layDownSession(COACH_SESSION, coachMeta({ failurePlan: armedScopeDenial() }), COACH_SEAT_SEED); // The armed scope-denial mode (AAP 0.12.5) is armed on the seat and takes effect on the read it names, before the coaching families are decoded, so nothing is enumerated, counted or projected first.
    const armed = await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE);
    expect(assertDenied(armed).reasonCode).toBe("no-permission");
    expectDenialWithholds(armed, [ACTIVE_GRANT_ID, WORKER_PRINCIPAL, "target-calls-weekly"]);
    const listing = assertEnvelope(await reads.coach.readCoachPortfolio(SECOND_WORKER_SOURCE));
    expect(listing.data.subjects).toHaveLength(0);
    expect(listing.data.holdsNoSubjects).toBe(true);
    for (const expected of [ACTIVE_GRANT_ID, WORKER_PRINCIPAL]) expect(serialised(listing)).not.toContain(expected);
    const own = assertEnvelope(await reads.coach.readCoachPortfolio(COACH_SOURCE)); // The coach's own listing is the one that names the grant, and only because it is theirs.
    expect(own.data.subjects.map((subject) => subject.grantId)).toContain(ACTIVE_GRANT_ID);
  });
  it("shares no module until the worker switches one on, and then only the modules switched on", async () => {
    const invitation = expectAccepted(await mutations.coaching.inviteCoach(attempt(workerScope, { coachPrincipalId: COACH_PRINCIPAL, organizationId: YOUTH.organizationId, ministryIds: [YOUTH.ministryId], duration: { kind: "through-date", shareThroughDate: "2026-12-31" } }), WORKER_SOURCE));
    const grantId = requiredSaying(invitation.created[0], "The invitation was accepted without naming the grant it created, so no case can read it.");
    const invited = grantRecord(await storedStateOf(WORKER_SESSION), grantId); // A fresh invitation shares nothing: the five flags are all off, and the record says so.
    expect(invited.state).toBe("invited");
    expect([invited.modules, Object.keys(invited.modules).sort()]).toEqual([NO_MODULES_SELECTED, [...MODULE_KEYS].sort()]);
    // Acceptance is the coach's own deliberate write, and the service groups it — with the departure — apart from the worker's coaching changes: the identity holds exactly these two.
    expectAccepted(await mutations.coach.acceptInvitation(attempt(grantAuthorityScope(COACH_PRINCIPAL, YOUTH.ministryId), { grantId }, await currentRevisionOf(WORKER_SESSION, grantId)), COACH_SOURCE));
    const sharingNothing = assertEnvelope(await reads.coach.readCoachSubject({ grantId }, COACH_SOURCE));
    expect(sharingNothing.data.sharesNothing).toBe(true);
    expect(sharingNothing.data.modules).toHaveLength(0);
    expect(serialised(sharingNothing)).not.toContain("targets");
    const switchedOn: readonly ModuleKey[] = ["targets", "check-ins"];
    await shareModules(grantId, switchedOn);
    const envelope = assertEnvelope(await reads.coach.readCoachSubject({ grantId }, COACH_SOURCE));
    expect([envelope.data.sharesNothing, envelope.data.modules.map((view) => view.module).sort()]).toEqual([false, [...switchedOn].sort()]);
    const modulesInForce = grantRecord(await storedStateOf(WORKER_SESSION), grantId);
    expect(envelope.data.modules.map((view) => view.module).sort()).toEqual(MODULE_KEYS.filter((key) => modulesInForce.modules[key]).sort());
    const text = serialised(envelope);
    for (const unadmitted of MODULE_KEYS.filter((key) => !switchedOn.includes(key))) expect(text).not.toContain(unadmitted);
  });
  it("carries no gift row, no commitment row, no donor and no private target label, even with every module shared", async () => {
    await shareModules(ACTIVE_GRANT_ID, MODULE_KEYS);
    const envelope = assertEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE));
    expect(envelope.data.modules).toHaveLength(MODULE_KEYS.length);
    const state = await storedStateOf(WORKER_SESSION);
    const text = serialised(envelope);
    for (const value of [state.gifts.length, state.commitments.length, state.partners.length, state.privateNotes.length, state.coachingTargets.length]) expect(value).toBeGreaterThan(0); // Every family below is held by the world this case reads, so no loop can be satisfied by an empty list.
    for (const gift of state.gifts) for (const expected of [gift.giftRowId, gift.giftId, gift.provenance.reference]) expect(text).not.toContain(expected);
    for (const commitment of state.commitments) expect(text).not.toContain(commitment.commitmentRowId);
    for (const partner of state.partners) expect(text).not.toContain(partner.partnerId);
    for (const note of state.privateNotes) expect(text).not.toContain(note.body);
    for (const target of state.coachingTargets) expect(text).not.toContain(target.privateLabel);
    expect(text).not.toContain("donor");
    const results = envelope.data.modules.find((view) => view.module === "support-results"); // The one financial module that could state a figure states the reviewed range it was given, and this grant was given none, so there is nothing to disclose and the module says so rather than showing zero.
    if (results === undefined || results.module !== "support-results") throw new Error("The shared support-results module was not enumerated at all, which would hide a refusal as an absence.");
    expect(results.range).toBeNull();
    expect(results.received).toHaveLength(0);
    expect(results.figureProblem).not.toBeNull();
    const recorded = Object.entries(envelope.valueStates); // No value is stated as a subtotal, and every value without a datum states that it has none rather than stating zero (AAP 0.8.1: zero, unknown, withheld and unavailable stay distinguishable).
    expect(recorded.length).toBeGreaterThan(0);
    expect(Object.values(envelope.valueStates)).not.toContain("incomplete-subtotal");
    const withoutData = recorded.filter(([path]) => valueAtPath(envelope.data, path) === null);
    expect(withoutData.filter(([, state]) => state !== "unavailable" && state !== "unknown")).toEqual([]);
    const statedAsZero = recorded.filter(([, state]) => state === "zero");
    expect(statedAsZero.filter(([path]) => valueAtPath(envelope.data, path) !== 0)).toEqual([]);
    expect(envelope.coverage.state).not.toBe("partial");
  });
  it("denies a read at the frozen exclusive cutoff while the stored grant still stands active", async () => {
    const initial = grantRecord(await storedStateOf(WORKER_SESSION), ACTIVE_GRANT_ID);
    expect(initial.state).toBe("active");
    const storedCutoff = initial.duration.cutoffInstant;
    if (storedCutoff === null) throw new Error("The seeded grant states no cutoff, so no case here has an exclusive endpoint to read at.");
    const cutoff = Temporal.Instant.from(storedCutoff);
    const shareThrough = shareThroughDateOfCutoff({ cutoffInstant: cutoff, frozenZone: initial.duration.frozenZone }); // The stored cutoff is the exclusive start of the civil day after the Share-through date the worker chose, resolved by the application's one cutoff function rather than recomputed here.
    if (shareThrough === null) throw new Error(`The stored cutoff ${storedCutoff} resolves to no Share-through date in ${initial.duration.frozenZone}.`);
    const resolved = shareCutoff({ shareThroughDate: shareThrough, frozenZone: initial.duration.frozenZone });
    if (resolved.status !== "bounded") throw new Error(`The cutoff for ${shareThrough.toString()} resolved to no instant: ${resolved.reason}.`);
    expect(resolved.cutoffInstant.toString()).toBe(storedCutoff);
    const offsetOf = (instant: Temporal.Instant): number => instant.epochMilliseconds - SEED_INSTANT.epochMilliseconds;
    const before = await setClock(COACH_SESSION, offsetOf(cutoff) - 1);
    if (!before.ok) throw new Error(`The coach's clock could not be moved to one millisecond before the cutoff: ${before.error.code}.`);
    const open = assertEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE)); // One instant before the cutoff the same read is admitted, so both sides of the boundary are asserted.
    expect([open.data.duration.cutoffInstant, open.data.duration.openAtRead]).toEqual([storedCutoff, true]);
    const at = await setClock(COACH_SESSION, offsetOf(cutoff));
    if (!at.ok) throw new Error(`The coach's clock could not be moved to the cutoff: ${at.error.code}.`);
    const closed = await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE);
    expect(assertDenied(closed).reasonCode).toBe("no-permission");
    expectDenialWithholds(closed, [ACTIVE_GRANT_ID, WORKER_PRINCIPAL]);
    const afterwards = grantRecord(await storedStateOf(WORKER_SESSION), ACTIVE_GRANT_ID);
    expect([afterwards.state, afterwards.revision, afterwards.duration.cutoffInstant]).toEqual(["active", initial.revision, storedCutoff]);
  });
  it("writes nothing when a coach reads, and leaves the worker's own work untouched by a revocation", async () => {
    const coachDocumentBefore = serialised(await storedStateOf(COACH_SESSION));
    const recordsDocumentBefore = serialised(await storedStateOf(WORKER_SESSION)); // The document a coach's reads reach is the worker's own, so an enumeration that wrote anything would land there.
    const coachWorkBefore = await sourceWorkOf(COACH_SESSION);
    assertEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE));
    assertEnvelope(await reads.coach.readCoachPortfolio(COACH_SOURCE));
    assertDenied(await reads.coach.readCoachSubject({ grantId: ENDED_GRANT_ID }, COACH_SOURCE));
    assertDenied(await reads.coach.readCoachSubject({ grantId: REVOKED_GRANT_ID }, COACH_SOURCE));
    expect(serialised(await storedStateOf(COACH_SESSION))).toBe(coachDocumentBefore);
    expect(serialised(await storedStateOf(WORKER_SESSION))).toBe(recordsDocumentBefore);
    expect(await sourceWorkOf(COACH_SESSION)).toEqual(coachWorkBefore);
    const workerWorkBefore = await sourceWorkOf(WORKER_SESSION);
    expectAccepted(await mutations.coaching.revokeGrant(attempt(workerScope, { grantId: ACTIVE_GRANT_ID }, await currentRevisionOf(WORKER_SESSION, ACTIVE_GRANT_ID)), WORKER_SOURCE));
    expect(await sourceWorkOf(WORKER_SESSION)).toEqual(workerWorkBefore);
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission"); // The worker's accepted revocation reaches the coach with nothing copied between the two documents.
    expect([await sourceWorkOf(COACH_SESSION), grantRecord(await storedStateOf(WORKER_SESSION), ACTIVE_GRANT_ID).state]).toEqual([coachWorkBefore, "revoked"]);
  });
  it("keeps the stop types distinct and refuses a stale action on an episode that is already closed", async () => {
    expect(new Set(GRANT_LIFECYCLE_STATES).size).toBe(GRANT_LIFECYCLE_STATES.length);
    for (const needle of ["revoked", "ended", "left"]) expect(GRANT_LIFECYCLE_STATES).toContain(needle);
    const seeded = await storedStateOf(WORKER_SESSION);
    const active = grantRecord(seeded, ACTIVE_GRANT_ID);
    const revokedState = grantRecord(seeded, REVOKED_GRANT_ID).state;
    const endedState = grantRecord(seeded, ENDED_GRANT_ID).state;
    expect([active.state, revokedState, endedState, assertDenied(await reads.coach.readCoachSubject({ grantId: ENDED_GRANT_ID }, COACH_SOURCE)).reasonCode]).toEqual(["active", "revoked", "ended", "no-permission"]);
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: REVOKED_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission");
    const staleOnEnded = assertConflict(await mutations.coaching.setModule(attempt(workerScope, { grantId: ENDED_GRANT_ID, moduleKey: "targets", enabled: true }, await currentRevisionOf(WORKER_SESSION, ENDED_GRANT_ID)), WORKER_SOURCE));
    expect(staleOnEnded.reason).toBe("stale-revision");
    expect(serialised(staleOnEnded.current)).toContain("ended");
    expect(serialised(staleOnEnded.preservedInput)).toContain("targets");
    expect(grantRecord(await storedStateOf(WORKER_SESSION), ENDED_GRANT_ID).revision).toBe(grantRecord(seeded, ENDED_GRANT_ID).revision);
    const revocation = expectAccepted(await mutations.coaching.revokeGrant(attempt(workerScope, { grantId: ACTIVE_GRANT_ID }, await currentRevisionOf(WORKER_SESSION, ACTIVE_GRANT_ID)), WORKER_SOURCE));
    expect(revocation.revision).not.toBe(active.revision);
    const staleOnRevoked = assertConflict(await mutations.coaching.setModule(attempt(workerScope, { grantId: ACTIVE_GRANT_ID, moduleKey: "targets", enabled: true }, await currentRevisionOf(WORKER_SESSION, ACTIVE_GRANT_ID)), WORKER_SOURCE));
    expect(serialised(staleOnRevoked.current)).toContain("revoked");
    const afterStale = grantRecord(await storedStateOf(WORKER_SESSION), ACTIVE_GRANT_ID);
    expect([afterStale.state, afterStale.revision]).toEqual(["revoked", revocation.revision]);
    const coachScope = grantAuthorityScope(COACH_PRINCIPAL, YOUTH.ministryId);
    const forbidden: readonly MutationOutcome[] = [
      await mutations.coaching.setModule(attempt(coachScope, { grantId: ACTIVE_GRANT_ID, moduleKey: "targets", enabled: true }), COACH_SOURCE),
      await mutations.coaching.revokeGrant(attempt(coachScope, { grantId: ACTIVE_GRANT_ID }), COACH_SOURCE),
      await mutations.coaching.endCoaching(attempt(coachScope, { grantId: ACTIVE_GRANT_ID }), COACH_SOURCE),
    ];
    for (const outcome of forbidden) expect([isOutcome(outcome), outcome.outcome]).toEqual([true, "denied"]);
    const recordsBefore = serialised(await storedStateOf(WORKER_SESSION));
    // The grant this case revoked is closed, so the coach's own departure is asserted on the relationship that is still live: both writes address the worker's one record, and each produces its own stop type.
    expectAccepted(await mutations.coach.leaveCoaching(attempt(coachScope, { grantId: SUPPORT_SHARING_GRANT_ID }, await currentRevisionOf(WORKER_SESSION, SUPPORT_SHARING_GRANT_ID)), COACH_SOURCE));
    const left = grantRecord(await storedStateOf(WORKER_SESSION), SUPPORT_SHARING_GRANT_ID);
    expect([left.state, new Set([left.state, revokedState, endedState]).size]).toEqual(["left", 3]);
    expect(serialised(await storedStateOf(WORKER_SESSION))).not.toBe(recordsBefore); // The coach's own accepted departure is written to the one record both identities address, so the change is visible there and nowhere else.
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission");
  });
  it("leaves the other admitted modules readable when one shared module's source is unavailable", async () => {
    await layDownSession(COACH_SESSION, coachMeta({ scenarioId: "coaching-module-unavailable" }), COACH_SEAT_SEED); // The coach's seat runs the unavailable-coaching-module scenario, so the module that reads the support source reports unavailable, the modules that do not stay usable, and neither is presented as the other.
    await shareModules(ACTIVE_GRANT_ID, ["support-goal"]);
    const envelope = assertEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE));
    expect(envelope.data.modules.map((view) => view.module).sort()).toEqual(["check-ins", "support-goal", "targets"]);
    const goal = envelope.data.modules.find((view) => view.module === "support-goal");
    expect([goal?.module, goal?.state]).toEqual(["support-goal", "unavailable"]);
    expect(goal?.unavailability).not.toBeNull();
    const targets = envelope.data.modules.find((view) => view.module === "targets");
    if (targets === undefined || targets.module !== "targets") throw new Error("The targets module is shared and was not enumerated, which would blank the whole surface for one module's outage.");
    expect(targets.state).not.toBe("unavailable");
    expect(targets.progress.length).toBeGreaterThan(0);
    const checkIns = envelope.data.modules.find((view) => view.module === "check-ins");
    if (checkIns === undefined || checkIns.module !== "check-ins") throw new Error("The check-ins module is shared and was not enumerated, which would blank the whole surface for one module's outage.");
    expect(checkIns.state).not.toBe("unavailable");
    expect(checkIns.sharedCheckIns.length).toBeGreaterThan(0);
  });
  it("reports one admitted coaching module unavailable in the seeded scenario while the others stay usable", async () => {
    // AAP 0.12.5 arms this failure with a seeded scenario flag rather than a hand-edited record, so the case reads the seeded seats themselves: the coach's own seat in the scenario, and the baseline coach's seat as the control proving the scenario is what changed the module rather than the world.
    await layDownSeededSession(SEEDED_DOWN_MODULE_SESSION); // Each seat is laid down with the world it is seated in, so the coaching record it reads is that world's own rather than a copy the case had to carry across.
    await layDownSeededSession(SEEDED_DOWN_MODULE_WORLD);
    await layDownSeededSession(SEEDED_BASELINE_COACH_SESSION);
    await layDownSeededSession(SEEDED_BASELINE_WORLD);
    const down = assertEnvelope(await reads.coach.readCoachSubject({ grantId: SUPPORT_SHARING_GRANT_ID }, { sessionId: SEEDED_DOWN_MODULE_SESSION }));
    expect(down.data.modules.map((view) => view.module).sort()).toEqual(["check-ins", "support-goal", "targets"]);
    const goal = down.data.modules.find((view) => view.module === "support-goal");
    if (goal === undefined || goal.module !== "support-goal") throw new Error("The shared support-goal module was not enumerated at all, which would hide the outage as an absence.");
    expect(goal.state).toBe("unavailable");
    expect(goal.unavailability).not.toBeNull();
    expect(goal.goal).toBeNull();
    const targets = down.data.modules.find((view) => view.module === "targets");
    if (targets === undefined || targets.module !== "targets") throw new Error("The targets module is shared and was not enumerated, which would blank the whole surface for one module's outage.");
    expect(targets.state).not.toBe("unavailable");
    expect(targets.unavailability).toBeNull();
    expect(targets.progress.length).toBeGreaterThan(0);
    const checkIns = down.data.modules.find((view) => view.module === "check-ins");
    if (checkIns === undefined || checkIns.module !== "check-ins") throw new Error("The check-ins module is shared and was not enumerated, which would blank the whole surface for one module's outage.");
    // The module is still enumerated and usable, and the outage of its neighbour changed neither its state nor the reading it carries. This grant shares no check-in of its own, so the module states the empty period it holds: an empty module is its own state, never the neighbour's outage and never a complete share this relationship does not have.
    expect(checkIns.state).not.toBe("unavailable");
    expect(checkIns.unavailability).toBeNull();
    expect(checkIns.state).toBe("empty");
    expect(checkIns.sharedCheckIns).toHaveLength(0);
    // The same read of the same grant through the baseline coach's seat. The source is there and holds the goal the grant shares, so the module the scenario made unavailable reads as usable figures there.
    const baseline = assertEnvelope(await reads.coach.readCoachSubject({ grantId: SUPPORT_SHARING_GRANT_ID }, { sessionId: SEEDED_BASELINE_COACH_SESSION }));
    expect(baseline.data.modules.map((view) => view.module).sort()).toEqual(["check-ins", "support-goal", "targets"]);
    const baselineGoal = baseline.data.modules.find((view) => view.module === "support-goal");
    if (baselineGoal === undefined || baselineGoal.module !== "support-goal") throw new Error("The baseline coach's read enumerated no support-goal module, so it cannot stand as the control.");
    expect(baselineGoal.state).not.toBe("unavailable");
    expect(baselineGoal.goal).not.toBeNull();
    const baselineTargets = baseline.data.modules.find((view) => view.module === "targets");
    if (baselineTargets === undefined || baselineTargets.module !== "targets") throw new Error("The baseline coach's read enumerated no targets module, so it cannot stand as the control.");
    expect(baselineTargets.state).not.toBe("unavailable");
  });
});
