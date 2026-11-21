/** Success criteria 16 and 19 at the store boundary: a coach's read authorises before it enumerates, and a read from another scope retrieves nothing. */
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newOperationId } from "@/lib/ids";
import { DENIAL_VALUE_KEYS } from "@/lib/redaction";
import { mutations, reads, type CoachingGrantRecord, type MutationInput, type Scope } from "@/modules/data-service";
import { resolveSession, type SessionSource } from "@/modules/data-service/authorize";
import { ministryIdSchema, organizationIdSchema, principalIdSchema, scopeSchema, supportSubjectIdSchema, type SessionContextRecord } from "@/modules/data-service/envelope";
import { DENIAL_REASONS, isOutcome, isReadResult, type ConflictOutcome, type DeniedOutcome, type MutationOutcome, type ReadResult } from "@/modules/data-service/outcome";
import { GRANT_LIFECYCLE_STATES, MODULE_KEYS, NO_MODULES_SELECTED, type ModuleKey } from "@/modules/coaching/grant";
import { setFailurePlan, type FailurePlanDocument } from "@/modules/dev-runtime/failures";
import { buildSessionMeta, setClock, type AdmittedMembership, type ScenarioId, type SessionMetaDocument } from "@/modules/dev-runtime/scenario";
import { SEEDED_PERSONAS, findSeededSession, seed, type SeededSession, type SeededSessionDocuments, type SeededSessionWithDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { readSession, resetSession, transact } from "@/modules/store/repository";
import { SEED_INSTANT } from "@/modules/time/clock";
import { shareCutoff, shareThroughDateOfCutoff } from "@/modules/time/window";
const COACH_SESSION = "it-coach-boundary";
const WORKER_SESSION = "it-coach-boundary-worker";
const SECOND_WORKER_SESSION = "it-coach-boundary-second";
const COACH_SOURCE: SessionSource = { sessionId: COACH_SESSION };
const WORKER_SOURCE: SessionSource = { sessionId: WORKER_SESSION };
const SECOND_WORKER_SOURCE: SessionSource = { sessionId: SECOND_WORKER_SESSION };
const WORKER_WORKSPACE = "established-worker";
const COACH_SEAT_WORKSPACE = "coach";
const ACTIVE_GRANT_ID = "grant-established-coach";
const REVOKED_GRANT_ID = "grant-revoked-coach";
const ENDED_GRANT_ID = "grant-ended-coach";
const SUPPORT_SHARING_GRANT_ID = "grant-established-coach-support";
// The two seeded seats the scenario case reads: the coach's own seat in the unavailable-module world, and the
// baseline coach's seat as the control that the scenario is what changed rather than the world
const SEEDED_DOWN_MODULE_SESSION = "coach-coaching-module-unavailable";
const SEEDED_BASELINE_COACH_SESSION = "coach";
const COACH_PRINCIPAL = SEEDED_PERSONAS.coach.principalId;
const WORKER_PRINCIPAL = SEEDED_PERSONAS["established-worker"].principalId;
const SECOND_WORKER_PRINCIPAL = SEEDED_PERSONAS["second-worker"].principalId;
const INVITED_SHARE_THROUGH = "2026-12-31";
const STATED_REVISION = "rev-1";
/** The smallest step the scenario clock takes, so the two sides of a boundary sit one millisecond apart. */
const ONE_MILLISECOND = 1;
function seededSession(sessionId: string): SeededSession {
  const found = findSeededSession(sessionId);
  if (found === undefined) throw new Error(`The seed states no session ${JSON.stringify(sessionId)}, so this file has no world to lay its own sessions down from.`);
  return found;
}
const WORKER_ROW = seededSession("established-worker");
const SECOND_WORKER_ROW = seededSession("second-worker");
const YOUTH = admissionIn(WORKER_ROW, "min-harbour-youth");
function admissionIn(row: SeededSession, ministryId: string): AdmittedMembership {
  const found = row.admittedMemberships.find((membership) => membership.ministryId === ministryId);
  if (found === undefined) throw new Error(`The seeded ${JSON.stringify(row.sessionId)} session is admitted to no ministry ${JSON.stringify(ministryId)}, so no case here has a context to invite a coach in.`);
  return found;
}
let seededWorld: Promise<readonly SeededSessionWithDocuments[]> | undefined;
function seededSessions(): Promise<readonly SeededSessionWithDocuments[]> {
  // One build of the seeded world for the whole file: the documents are deterministic, so every case
  // laying its sessions down again starts from exactly the same bytes.
  seededWorld ??= seed();
  return seededWorld;
}
async function seededWorkspace(workspace: string): Promise<SeededSessionDocuments> {
  const sessions = await seededSessions();
  const template = sessions.find((session) => session.sessionId === workspace);
  if (template === undefined) throw new Error(`The seed lays down no ${JSON.stringify(workspace)} workspace, so no case in this file has a world to start from.`);
  return template.documents;
}
function contextOf(state: SessionStateDocument, sessionId: string, meta: SessionMetaDocument): SessionContextRecord {
  const selected = meta.selectedContext;
  return {
    // A record set states the session and the principal that own it, so the private session's own
    // identifiers are written into the document it holds rather than naming a session reading nothing.
    sessionId,
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
async function layDownSession(sessionId: string, meta: SessionMetaDocument, workspace: string): Promise<void> {
  const template = await seededWorkspace(workspace);
  const state = structuredClone(template.state);
  await resetSession(sessionId, { state: { ...state, context: contextOf(state, sessionId, meta) }, operations: structuredClone(template.operations), meta });
}
async function layDownSeededSession(sessionId: string): Promise<void> {
  const template = await seededWorkspace(sessionId);
  await resetSession(sessionId, { state: structuredClone(template.state), operations: structuredClone(template.operations), meta: structuredClone(template.meta) });
}
async function stateOf(sessionId: string): Promise<SessionStateDocument> {
  const documents = await readSession(sessionId);
  if (documents === undefined) throw new Error(`The store holds no session ${JSON.stringify(sessionId)}, so no case here can read the world it asserts about.`);
  // The store keeps a session's documents opaque on purpose, so this file names the shape the seed wrote.
  return documents.state as SessionStateDocument;
}
function grantRecord(state: SessionStateDocument, grantId: string): CoachingGrantRecord {
  const found = state.coachingGrants.find((grant) => grant.grantId === grantId);
  if (found === undefined) throw new Error(`The seeded world holds no coaching grant ${JSON.stringify(grantId)}, so the case that names it has nothing to assert about.`);
  return found;
}
async function carryState(from: string, to: string): Promise<void> {
  const documents = await readSession(from);
  if (documents === undefined) throw new Error(`The store holds no session ${JSON.stringify(from)}, so the world there is not the one to carry.`);
  const state = structuredClone(documents.state);
  await transact(to, (draft) => {
    draft.state = state;
  });
}
interface MetaOverrides {
  readonly scenarioId?: ScenarioId;
  readonly failurePlan?: FailurePlanDocument;
}
function workerMeta(overrides: MetaOverrides = {}): SessionMetaDocument {
  return buildSessionMeta({ principalId: WORKER_ROW.principalId, admittedMemberships: WORKER_ROW.admittedMemberships, selectedContext: WORKER_ROW.selectedContext, sessionState: "signed-in", ...overrides });
}
function coachMeta(overrides: MetaOverrides = {}): SessionMetaDocument {
  return buildSessionMeta({ principalId: COACH_PRINCIPAL, admittedMemberships: [], selectedContext: null, sessionState: "signed-in", ...overrides });
}
function secondWorkerMeta(): SessionMetaDocument {
  return buildSessionMeta({ principalId: SECOND_WORKER_ROW.principalId, admittedMemberships: SECOND_WORKER_ROW.admittedMemberships, selectedContext: SECOND_WORKER_ROW.selectedContext, sessionState: "signed-in" });
}
/** The one armed failure that names the read this file is about (AAP 0.12.5). */
function armedScopeDenial(): FailurePlanDocument {
  const plan = setFailurePlan(null, { mode: "denied", target: { kind: "read", name: "readCoachSubject" }, armedAt: SEED_INSTANT.toString() });
  if (!plan.ok) throw new Error(`The scope-denial plan the criterion 19 case arms was refused: ${plan.error.code}.`);
  return plan.value;
}
async function selectedScopeOf(source: SessionSource): Promise<Scope> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) throw new Error(`The session ${JSON.stringify(source.sessionId)} resolved to no principal, so no case here can act in it.`);
  const selected = resolved.session.selected;
  if (selected === null) throw new Error(`The session ${JSON.stringify(source.sessionId)} has selected no context, so no case here has a scope to act in.`);
  return selected;
}
/** The scope a coach's own write claims: it holds no membership, so its principal and the grant's ministry state the authority it acts under. */
function grantAuthorityScope(principalId: string, ministryId: string): Scope {
  return scopeSchema.parse({ organizationId: `grant-authority:${ministryId}`, ministryId, supportSubjectId: `grant-authority:${ministryId}`, principalId });
}
function attempt<P>(scope: Scope, payload: P, expectedRevision: string = STATED_REVISION): MutationInput<P> {
  return { operationId: newOperationId(), scope, expectedRevision, payload };
}
async function currentRevisionOf(sessionId: string, grantId: string): Promise<string> {
  return grantRecord(await stateOf(sessionId), grantId).revision;
}
function assertEnvelope<T>(result: ReadResult<T>): T {
  if (result.kind !== "envelope") throw new Error(`The read answered ${JSON.stringify(result.kind)} where an envelope was required: an admitted scope is answered with its data, not with a refusal.`);
  return result.envelope;
}
function assertDenied<T>(result: ReadResult<T>): DeniedOutcome {
  if (result.kind !== "denied") throw new Error(`The read answered ${JSON.stringify(result.kind)} where a denial was required: a scope that holds nothing is refused, never answered with an empty envelope.`);
  return result.denied;
}
function assertConflict(outcome: MutationOutcome): ConflictOutcome {
  if (outcome.outcome !== "conflict") throw new Error(`The mutation answered ${serialised(outcome)} where a conflict was required: a stale or closed change is refused, with the current standing beside the input it preserved.`);
  return outcome;
}
function expectAccepted(outcome: MutationOutcome): { readonly revision: string; readonly created: readonly string[] } {
  if (outcome.outcome !== "accepted") throw new Error(`The mutation answered ${serialised(outcome)} where an acceptance was required.`);
  return { revision: outcome.revision, created: outcome.created ?? [] };
}
async function shareModules(grantId: string, keys: readonly ModuleKey[]): Promise<void> {
  for (const key of keys) {
    // Each change presents the revision the record stands at, so a refusal here can only be the module's
    // own answer and never a stale token this file forgot to re-read.
    const alreadySelected = grantRecord(await stateOf(WORKER_SESSION), grantId).modules[key];
    const outcome = await mutations.coaching.setModule(attempt(workerScope, { grantId, moduleKey: key, enabled: true }, await currentRevisionOf(WORKER_SESSION, grantId)), WORKER_SOURCE);
    // The grant's own record states which answer is due: a module already switched on produces no change, so this separates "already selected" from "just selected".
    expect(outcome.outcome).toBe(alreadySelected ? "unchanged" : "accepted");
  }
}
async function sourceWorkOf(
  sessionId: string,
): Promise<{ readonly tasks: SessionStateDocument["tasks"]; readonly partners: SessionStateDocument["partners"]; readonly privateNotes: SessionStateDocument["privateNotes"]; readonly coachingTargets: SessionStateDocument["coachingTargets"]; readonly coachingCheckIns: SessionStateDocument["coachingCheckIns"] }> {
  const state = await stateOf(sessionId);
  return { tasks: state.tasks, partners: state.partners, privateNotes: state.privateNotes, coachingTargets: state.coachingTargets, coachingCheckIns: state.coachingCheckIns };
}
function serialised(value: unknown): string {
  return JSON.stringify(value);
}
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
  // The refusal states its own fields and nothing else, so the walk has to have found them: an empty walk
  // would make the whole check pass without looking at anything.
  expect(keys).toContain("reasonCode");
  for (const key of keys) {
    expect(DENIAL_VALUE_KEYS).not.toContain(key);
  }
  const text = serialised(result);
  for (const value of forbidden) {
    expect(text).not.toContain(value);
  }
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
  // The development controls and the named-session resolution are gated on `NODE_ENV`, so the run is put
  // in a development build and the environment it arrived with is restored in `afterAll`.
  vi.stubEnv("NODE_ENV", "development");
});

beforeEach(async () => {
  // Each case lays its own sessions down, so a sibling suite's global reset cannot strand it and no case
  // inherits a document another case wrote.
  await layDownSession(WORKER_SESSION, workerMeta(), WORKER_WORKSPACE);
  await layDownSession(COACH_SESSION, coachMeta(), WORKER_WORKSPACE);
  await layDownSession(SECOND_WORKER_SESSION, secondWorkerMeta(), SECOND_WORKER_ROW.workspace);
  workerScope = await selectedScopeOf(WORKER_SOURCE);
  await restoreClocks();
});

afterEach(async () => {
  await restoreClocks();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  // Every session here is this file's own, so the store is left holding none of its fixtures.
  for (const sessionId of [WORKER_SESSION, COACH_SESSION, SECOND_WORKER_SESSION]) {
    await resetSession(sessionId);
  }
});

describe("coach read boundary", () => {
  it("refuses a subject read to any principal the grant does not name, disclosing no count, identity or existence flag", async () => {
    // AAP 0.8.4 and criterion 19: authorisation happens before enumeration. The worker whose record the
    // grant shares holds no coach authority over it, and the second worker holds nothing at all; both
    // receive the one refusal, and it states none of the evidence the denial set withholds.
    const asWorker = await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, WORKER_SOURCE);
    expect(isReadResult(asWorker)).toBe(true);
    expect(DENIAL_REASONS).toContain(assertDenied(asWorker).reasonCode);
    expectDenialWithholds(asWorker, [ACTIVE_GRANT_ID, WORKER_PRINCIPAL, COACH_PRINCIPAL]);
    const asSecondWorker = await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, SECOND_WORKER_SOURCE);
    expect(assertDenied(asSecondWorker).reasonCode).toBe("no-permission");
    expectDenialWithholds(asSecondWorker, [ACTIVE_GRANT_ID, WORKER_PRINCIPAL, COACH_PRINCIPAL]);
    // The scope criterion 19 trusts is the resolver's own answer, and it covers neither party.
    const secondWorkerScope = await selectedScopeOf(SECOND_WORKER_SOURCE);
    expect(secondWorkerScope.principalId).toBe(SECOND_WORKER_PRINCIPAL);
    expect(secondWorkerScope.principalId).not.toBe(WORKER_PRINCIPAL);
    expect(grantRecord(await stateOf(WORKER_SESSION), ACTIVE_GRANT_ID).ministryIds).not.toContain(secondWorkerScope.ministryId);
    // The armed scope-denial mode (AAP 0.12.5) takes effect on the read it names, before the coaching
    // families are decoded, so nothing is enumerated, counted or projected first.
    await layDownSession(COACH_SESSION, coachMeta({ failurePlan: armedScopeDenial() }), WORKER_WORKSPACE);
    const armed = await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE);
    expect(assertDenied(armed).reasonCode).toBe("no-permission");
    expectDenialWithholds(armed, [ACTIVE_GRANT_ID, WORKER_PRINCIPAL, "target-calls-weekly"]);
    const listing = assertEnvelope(await reads.coach.readCoachPortfolio(SECOND_WORKER_SOURCE));
    expect(listing.data.subjects).toHaveLength(0);
    expect(listing.data.holdsNoSubjects).toBe(true);
    expect(serialised(listing)).not.toContain(ACTIVE_GRANT_ID);
    expect(serialised(listing)).not.toContain(WORKER_PRINCIPAL);
    // The coach's own listing is the one that names the grant, and only because it is theirs.
    const own = assertEnvelope(await reads.coach.readCoachPortfolio(COACH_SOURCE));
    expect(own.data.subjects.map((subject) => subject.grantId)).toContain(ACTIVE_GRANT_ID);
  });
  it("shares no module until the worker switches one on, and then only the modules switched on", async () => {
    const invitation = expectAccepted(await mutations.coaching.inviteCoach(attempt(workerScope, { coachPrincipalId: COACH_PRINCIPAL, organizationId: YOUTH.organizationId, ministryIds: [YOUTH.ministryId], duration: { kind: "through-date", shareThroughDate: INVITED_SHARE_THROUGH } }), WORKER_SOURCE));
    const grantId = invitation.created[0];
    if (grantId === undefined) throw new Error("The invitation was accepted without naming the grant it created, so no case can read it.");
    // A fresh invitation shares nothing: the five flags are all off, and the record says so.
    const invited = grantRecord(await stateOf(WORKER_SESSION), grantId);
    expect(invited.state).toBe("invited");
    expect(invited.modules).toEqual(NO_MODULES_SELECTED);
    expect(Object.keys(invited.modules).sort()).toEqual([...MODULE_KEYS].sort());
    await carryState(WORKER_SESSION, COACH_SESSION);
    // Acceptance is the coach's own deliberate write, and the service groups it — with the departure —
    // apart from the worker's coaching changes: the identity holds exactly these two.
    expectAccepted(await mutations.coach.acceptInvitation(attempt(grantAuthorityScope(COACH_PRINCIPAL, YOUTH.ministryId), { grantId }, await currentRevisionOf(COACH_SESSION, grantId)), COACH_SOURCE));
    const sharingNothing = assertEnvelope(await reads.coach.readCoachSubject({ grantId }, COACH_SOURCE));
    expect(sharingNothing.data.sharesNothing).toBe(true);
    expect(sharingNothing.data.modules).toHaveLength(0);
    expect(serialised(sharingNothing)).not.toContain("targets");
    await carryState(COACH_SESSION, WORKER_SESSION);
    const switchedOn: readonly ModuleKey[] = ["targets", "check-ins"];
    await shareModules(grantId, switchedOn);
    await carryState(WORKER_SESSION, COACH_SESSION);
    const envelope = assertEnvelope(await reads.coach.readCoachSubject({ grantId }, COACH_SOURCE));
    expect(envelope.data.sharesNothing).toBe(false);
    expect(envelope.data.modules.map((view) => view.module).sort()).toEqual([...switchedOn].sort());
    const stored = grantRecord(await stateOf(WORKER_SESSION), grantId);
    expect(envelope.data.modules.map((view) => view.module).sort()).toEqual(MODULE_KEYS.filter((key) => stored.modules[key]).sort());
    const text = serialised(envelope);
    for (const unadmitted of MODULE_KEYS.filter((key) => !switchedOn.includes(key))) {
      expect(text).not.toContain(unadmitted);
    }
  });
  it("carries no gift row, no commitment row, no donor and no private target label, even with every module shared", async () => {
    await shareModules(ACTIVE_GRANT_ID, MODULE_KEYS);
    await carryState(WORKER_SESSION, COACH_SESSION);
    const envelope = assertEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE));
    expect(envelope.data.modules).toHaveLength(MODULE_KEYS.length);
    const state = await stateOf(WORKER_SESSION);
    const text = serialised(envelope);
    // Every family below is held by the world this case reads, so no loop can be satisfied by an empty list.
    expect(state.gifts.length).toBeGreaterThan(0);
    expect(state.commitments.length).toBeGreaterThan(0);
    expect(state.partners.length).toBeGreaterThan(0);
    expect(state.privateNotes.length).toBeGreaterThan(0);
    expect(state.coachingTargets.length).toBeGreaterThan(0);
    for (const gift of state.gifts) {
      expect(text).not.toContain(gift.giftRowId);
      expect(text).not.toContain(gift.giftId);
      expect(text).not.toContain(gift.provenance.reference);
    }
    for (const commitment of state.commitments) {
      expect(text).not.toContain(commitment.commitmentRowId);
    }
    for (const partner of state.partners) {
      expect(text).not.toContain(partner.partnerId);
    }
    for (const note of state.privateNotes) {
      expect(text).not.toContain(note.body);
    }
    for (const target of state.coachingTargets) {
      expect(text).not.toContain(target.privateLabel);
    }
    expect(text).not.toContain("donor");
    // The one financial module that could state a figure states the reviewed range it was given, and this
    // grant was given none, so there is nothing to disclose and the module says so rather than showing zero.
    const results = envelope.data.modules.find((view) => view.module === "support-results");
    if (results === undefined || results.module !== "support-results") throw new Error("The shared support-results module was not enumerated at all, which would hide a refusal as an absence.");
    expect(results.range).toBeNull();
    expect(results.received).toHaveLength(0);
    expect(results.figureProblem).not.toBeNull();
    // No value is stated as a subtotal, and every value without a datum states that it has none rather
    // than stating zero (AAP 0.8.1: zero, unknown, withheld and unavailable stay distinguishable).
    const recorded = Object.entries(envelope.valueStates);
    expect(recorded.length).toBeGreaterThan(0);
    expect(Object.values(envelope.valueStates)).not.toContain("incomplete-subtotal");
    const withoutData = recorded.filter(([path]) => valueAtPath(envelope.data, path) === null);
    expect(withoutData.filter(([, state]) => state !== "unavailable" && state !== "unknown")).toEqual([]);
    const statedAsZero = recorded.filter(([, state]) => state === "zero");
    expect(statedAsZero.filter(([path]) => valueAtPath(envelope.data, path) !== 0)).toEqual([]);
    expect(envelope.coverage.state).not.toBe("partial");
  });
  it("denies a read at the frozen exclusive cutoff while the stored grant still stands active", async () => {
    const initial = grantRecord(await stateOf(COACH_SESSION), ACTIVE_GRANT_ID);
    expect(initial.state).toBe("active");
    const storedCutoff = initial.duration.cutoffInstant;
    if (storedCutoff === null) throw new Error("The seeded grant states no cutoff, so no case here has an exclusive endpoint to read at.");
    const cutoff = Temporal.Instant.from(storedCutoff);
    // The stored cutoff is the exclusive start of the civil day after the Share-through date the worker
    // chose, resolved by the application's one cutoff function rather than recomputed here.
    const shareThrough = shareThroughDateOfCutoff({ cutoffInstant: cutoff, frozenZone: initial.duration.frozenZone });
    if (shareThrough === null) throw new Error(`The stored cutoff ${storedCutoff} resolves to no Share-through date in ${initial.duration.frozenZone}.`);
    const resolved = shareCutoff({ shareThroughDate: shareThrough, frozenZone: initial.duration.frozenZone });
    if (resolved.status !== "bounded") throw new Error(`The cutoff for ${shareThrough.toString()} resolved to no instant: ${resolved.reason}.`);
    expect(resolved.cutoffInstant.toString()).toBe(storedCutoff);
    const offsetOf = (instant: Temporal.Instant): number => instant.epochMilliseconds - SEED_INSTANT.epochMilliseconds;
    const before = await setClock(COACH_SESSION, offsetOf(cutoff) - ONE_MILLISECOND);
    if (!before.ok) throw new Error(`The coach's clock could not be moved to one millisecond before the cutoff: ${before.error.code}.`);
    // One instant before the cutoff the same read is admitted, so both sides of the boundary are asserted.
    const open = assertEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE));
    expect(open.data.duration.cutoffInstant).toBe(storedCutoff);
    expect(open.data.duration.openAtRead).toBe(true);
    const at = await setClock(COACH_SESSION, offsetOf(cutoff));
    if (!at.ok) throw new Error(`The coach's clock could not be moved to the cutoff: ${at.error.code}.`);
    const closed = await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE);
    expect(assertDenied(closed).reasonCode).toBe("no-permission");
    expectDenialWithholds(closed, [ACTIVE_GRANT_ID, WORKER_PRINCIPAL]);
    const afterwards = grantRecord(await stateOf(COACH_SESSION), ACTIVE_GRANT_ID);
    expect(afterwards.state).toBe("active");
    expect(afterwards.revision).toBe(initial.revision);
    expect(afterwards.duration.cutoffInstant).toBe(storedCutoff);
  });
  it("writes nothing when a coach reads, and leaves the worker's own work untouched by a revocation", async () => {
    const coachDocumentBefore = serialised(await stateOf(COACH_SESSION));
    const coachWorkBefore = await sourceWorkOf(COACH_SESSION);
    assertEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE));
    assertEnvelope(await reads.coach.readCoachPortfolio(COACH_SOURCE));
    assertDenied(await reads.coach.readCoachSubject({ grantId: ENDED_GRANT_ID }, COACH_SOURCE));
    assertDenied(await reads.coach.readCoachSubject({ grantId: REVOKED_GRANT_ID }, COACH_SOURCE));
    expect(serialised(await stateOf(COACH_SESSION))).toBe(coachDocumentBefore);
    expect(await sourceWorkOf(COACH_SESSION)).toEqual(coachWorkBefore);
    const workerWorkBefore = await sourceWorkOf(WORKER_SESSION);
    expectAccepted(await mutations.coaching.revokeGrant(attempt(workerScope, { grantId: ACTIVE_GRANT_ID }, await currentRevisionOf(WORKER_SESSION, ACTIVE_GRANT_ID)), WORKER_SOURCE));
    expect(await sourceWorkOf(WORKER_SESSION)).toEqual(workerWorkBefore);
    await carryState(WORKER_SESSION, COACH_SESSION);
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission");
    expect(await sourceWorkOf(COACH_SESSION)).toEqual(coachWorkBefore);
    expect(grantRecord(await stateOf(WORKER_SESSION), ACTIVE_GRANT_ID).state).toBe("revoked");
  });
  it("keeps the stop types distinct and refuses a stale action on an episode that is already closed", async () => {
    expect(new Set(GRANT_LIFECYCLE_STATES).size).toBe(GRANT_LIFECYCLE_STATES.length);
    expect(GRANT_LIFECYCLE_STATES).toContain("revoked");
    expect(GRANT_LIFECYCLE_STATES).toContain("ended");
    expect(GRANT_LIFECYCLE_STATES).toContain("left");
    const seeded = await stateOf(WORKER_SESSION);
    const active = grantRecord(seeded, ACTIVE_GRANT_ID);
    const revokedState = grantRecord(seeded, REVOKED_GRANT_ID).state;
    const endedState = grantRecord(seeded, ENDED_GRANT_ID).state;
    expect(active.state).toBe("active");
    expect(revokedState).toBe("revoked");
    expect(endedState).toBe("ended");
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: ENDED_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission");
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: REVOKED_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission");
    const staleOnEnded = assertConflict(await mutations.coaching.setModule(attempt(workerScope, { grantId: ENDED_GRANT_ID, moduleKey: "targets", enabled: true }, await currentRevisionOf(WORKER_SESSION, ENDED_GRANT_ID)), WORKER_SOURCE));
    expect(staleOnEnded.reason).toBe("stale-revision");
    expect(serialised(staleOnEnded.current)).toContain("ended");
    expect(serialised(staleOnEnded.preservedInput)).toContain("targets");
    expect(grantRecord(await stateOf(WORKER_SESSION), ENDED_GRANT_ID).revision).toBe(grantRecord(seeded, ENDED_GRANT_ID).revision);
    const revocation = expectAccepted(await mutations.coaching.revokeGrant(attempt(workerScope, { grantId: ACTIVE_GRANT_ID }, await currentRevisionOf(WORKER_SESSION, ACTIVE_GRANT_ID)), WORKER_SOURCE));
    expect(revocation.revision).not.toBe(active.revision);
    const staleOnRevoked = assertConflict(await mutations.coaching.setModule(attempt(workerScope, { grantId: ACTIVE_GRANT_ID, moduleKey: "targets", enabled: true }, await currentRevisionOf(WORKER_SESSION, ACTIVE_GRANT_ID)), WORKER_SOURCE));
    expect(serialised(staleOnRevoked.current)).toContain("revoked");
    const afterStale = grantRecord(await stateOf(WORKER_SESSION), ACTIVE_GRANT_ID);
    expect(afterStale.state).toBe("revoked");
    expect(afterStale.revision).toBe(revocation.revision);
    const coachScope = grantAuthorityScope(COACH_PRINCIPAL, YOUTH.ministryId);
    const forbidden: readonly MutationOutcome[] = [
      await mutations.coaching.setModule(attempt(coachScope, { grantId: ACTIVE_GRANT_ID, moduleKey: "targets", enabled: true }), COACH_SOURCE),
      await mutations.coaching.revokeGrant(attempt(coachScope, { grantId: ACTIVE_GRANT_ID }), COACH_SOURCE),
      await mutations.coaching.endCoaching(attempt(coachScope, { grantId: ACTIVE_GRANT_ID }), COACH_SOURCE),
    ];
    for (const outcome of forbidden) {
      expect(isOutcome(outcome)).toBe(true);
      expect(outcome.outcome).toBe("denied");
    }
    const coachBefore = serialised(await stateOf(COACH_SESSION));
    expectAccepted(await mutations.coach.leaveCoaching(attempt(coachScope, { grantId: ACTIVE_GRANT_ID }, await currentRevisionOf(COACH_SESSION, ACTIVE_GRANT_ID)), COACH_SOURCE));
    const left = grantRecord(await stateOf(COACH_SESSION), ACTIVE_GRANT_ID);
    expect(left.state).toBe("left");
    expect(new Set([left.state, revokedState, endedState]).size).toBe(3);
    expect(serialised(await stateOf(COACH_SESSION))).not.toBe(coachBefore);
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission");
  });
  it("leaves the other admitted modules readable when one shared module's source is unavailable", async () => {
    // The coach's seat runs the unavailable-coaching-module scenario, so the module that reads the support
    // source reports unavailable, the modules that do not stay usable, and neither is presented as the other.
    await layDownSession(WORKER_SESSION, workerMeta(), COACH_SEAT_WORKSPACE);
    await layDownSession(COACH_SESSION, coachMeta({ scenarioId: "coaching-module-unavailable" }), COACH_SEAT_WORKSPACE);
    await shareModules(ACTIVE_GRANT_ID, ["support-goal"]);
    await carryState(WORKER_SESSION, COACH_SESSION);
    const envelope = assertEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE));
    expect(envelope.data.modules.map((view) => view.module).sort()).toEqual(["check-ins", "support-goal", "targets"]);
    const goal = envelope.data.modules.find((view) => view.module === "support-goal");
    expect(goal?.module).toBe("support-goal");
    expect(goal?.state).toBe("unavailable");
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
    // AAP 0.12.5 arms this failure with a seeded scenario flag rather than a hand-edited record, so the case
    // reads the seeded seats themselves: the coach's own seat in the scenario, and the baseline coach's seat
    // as the control proving the scenario is what changed the module rather than the world.
    await layDownSeededSession(SEEDED_DOWN_MODULE_SESSION);
    await layDownSeededSession(SEEDED_BASELINE_COACH_SESSION);
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
    // The module is still enumerated and usable — its content is complete, so it states no exception at all
    // — and the outage of its neighbour changed neither its state nor the reading it carries. This grant
    // shares no check-in of its own, so nothing is projected into it and nothing is claimed either.
    expect(checkIns.state).not.toBe("unavailable");
    expect(checkIns.unavailability).toBeNull();
    expect(checkIns.state).toBeNull();
    expect(checkIns.sharedCheckIns).toHaveLength(0);
    // The same read of the same grant through the baseline coach's seat. The source is there and holds the
    // goal the grant shares, so the module the scenario made unavailable reads as usable figures there.
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
