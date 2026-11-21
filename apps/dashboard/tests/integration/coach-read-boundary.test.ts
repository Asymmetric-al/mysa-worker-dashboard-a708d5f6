/**
 * Success criteria 16 and 19 at the store boundary: a coach's read authorises before it enumerates, and
 * a read from another scope retrieves nothing.
 *
 * Criterion 16 requires that a coach never sees an unshared module, a raw gift row or a private target
 * label; that no coach write beyond the two the identity holds succeeds; that reads are denied after a
 * revocation and at the frozen exclusive cutoff; that the worker's own work is unchanged; and that one
 * unavailable module leaves the others usable. Criterion 19 requires that a second worker calling the
 * data service directly retrieves nothing another scope holds. Both are properties of the service
 * rather than of a screen, so every assertion below drives the real reads and mutations over the real
 * file-backed store: no DOM, no browser, no `fetch` and no substituted store. Every session here is the
 * development seed's own synthetic data in this file's private sessions, so nothing asserted below is a
 * production path, and every effect the service records is the application's own.
 *
 * The rules under test, and where each comes from:
 *
 * - Authorisation precedes enumeration (AAP 0.8.4). A refusal is the closed `denied` outcome, and it
 *   carries no count, no subject identity, no title and no existence flag — checked against the whole
 *   `DENIAL_VALUE_KEYS` set rather than field by field. A caller who coaches nothing is told its own
 *   listing is empty, never that someone else's grant exists.
 * - The grant is the only source of a coach's reach (AAP 0.8.4). Modules start unselected, only the
 *   flags the worker switched on appear, and the names of the others occur nowhere in the envelope or
 *   in the portfolio listing.
 * - A disclosed figure is reviewed rather than derived (AAP 0.8.4). There is no gift row, no
 *   commitment row, no donor identity, no private label and no reconstructing total, and no value
 *   without a datum is ever stated as zero.
 * - The cutoff is frozen at acceptance and exclusive (AAP 0.8.7). A read one instant before it is
 *   admitted, a read at it is denied, and the denial leaves the stored grant stating `active`.
 * - A coach read is read-only (AAP 0.8.4). The session's records are identical afterwards, and the
 *   worker's work is untouched by a revocation, an expiry or a stale action attempted later.
 *
 * Divergences from the planned dependency list, recorded because they change how these rules are
 * reached rather than what they assert:
 *
 * - `readCoachPortfolio` took no session source, so a framework-free suite could not read a coach's
 *   listing at all. It now takes the optional `source` its sibling `readCoachSubject` already took, and
 *   every existing caller is unchanged.
 * - The store (`readSession`, `transact`, `resetSession`) is imported as fixture plumbing: no named
 *   mutation lays a session down, and two of the rules are about the stored document itself — that a
 *   denial did not rewrite the grant, and that a read wrote nothing. The seed builds one session per
 *   identity, so the worker's accepted changes are carried into the coach's own session document
 *   between reads, exactly as the seed builds both views from the one `coachingShare` builder.
 * - `newOperationId` from `@/lib/ids` mints each attempt's identity, as every other store-backed suite
 *   in this repository does.
 * - The coach's own scenario clock is moved through `setClock`, the store-level control the development
 *   mutation wraps: a coach holds no membership, and a development mutation states the scope it acts
 *   in, so the coach's session cannot authenticate one.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { DENIAL_VALUE_KEYS } from "@/lib/redaction";
import { mutations, reads, type CoachingGrantRecord, type MutationInput, type Scope } from "@/modules/data-service";
import { resolveSession, type SessionSource } from "@/modules/data-service/authorize";
import {
  ministryIdSchema,
  organizationIdSchema,
  principalIdSchema,
  scopeSchema,
  supportSubjectIdSchema,
  type SessionContextRecord,
} from "@/modules/data-service/envelope";
import { DENIAL_REASONS, isOutcome, isReadResult, type ConflictOutcome, type DeniedOutcome, type MutationOutcome, type ReadResult } from "@/modules/data-service/outcome";
import { GRANT_LIFECYCLE_STATES, MODULE_KEYS, NO_MODULES_SELECTED, type ModuleKey } from "@/modules/coaching/grant";
import { setFailurePlan, type FailurePlanDocument } from "@/modules/dev-runtime/failures";
import { buildSessionMeta, setClock, type AdmittedMembership, type ScenarioId, type SessionMetaDocument } from "@/modules/dev-runtime/scenario";
import { SEEDED_PERSONAS, findSeededSession, seed, type SeededSession, type SeededSessionDocuments, type SeededSessionWithDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { readSession, resetSession, transact } from "@/modules/store/repository";
import { SEED_INSTANT } from "@/modules/time/clock";
import { shareCutoff, shareThroughDateOfCutoff } from "@/modules/time/window";
// The world each case starts from: sessions of this file's own, never a shared seeded id
const COACH_SESSION = "it-coach-boundary";

const WORKER_SESSION = "it-coach-boundary-worker";

const SECOND_WORKER_SESSION = "it-coach-boundary-second";

const COACH_SOURCE: SessionSource = { sessionId: COACH_SESSION };

const WORKER_SOURCE: SessionSource = { sessionId: WORKER_SESSION };

const SECOND_WORKER_SOURCE: SessionSource = { sessionId: SECOND_WORKER_SESSION };
/** The workspace the coach's and the worker's sessions are laid down from: the seeded world holding the grant, the worker's work and the one support projection. */
const WORKER_WORKSPACE = "established-worker";
/** The workspace with the coaching families alone and no support projection: the world in which a shared financial module's source is genuinely down. */
const COACHING_ONLY_WORKSPACE = "coach";
// The three grants the seeded world states, one per lifecycle state a coach read distinguishes
const ACTIVE_GRANT_ID = "grant-established-coach";

const REVOKED_GRANT_ID = "grant-revoked-coach";

const ENDED_GRANT_ID = "grant-ended-coach";
// The identities, read from the seed's own roster
const COACH_PRINCIPAL = SEEDED_PERSONAS.coach.principalId;

const WORKER_PRINCIPAL = SEEDED_PERSONAS["established-worker"].principalId;

const SECOND_WORKER_PRINCIPAL = SEEDED_PERSONAS["second-worker"].principalId;
/** The Share-through date an invitation in this file chooses: the cutoff it freezes is the first instant of the day after it. */
const INVITED_SHARE_THROUGH = "2026-12-31";
/**
 * The revision a creation presents, since the record it creates does not exist yet. Every change to an
 * existing grant presents the revision that record stands at, read back from the store before the write.
 */
const STATED_REVISION = "rev-1";

/** The smallest step the scenario clock takes, so the two sides of a boundary sit one millisecond apart. */
const ONE_MILLISECOND = 1;

function seededSession(sessionId: string): SeededSession {
  const found = findSeededSession(sessionId);
  if (found === undefined) {
    throw new Error(`The seed states no session ${JSON.stringify(sessionId)}, so this file has no world to lay its own sessions down from.`);
  }
  return found;
}
const WORKER_ROW = seededSession("established-worker");

const SECOND_WORKER_ROW = seededSession("second-worker");
/** The one ministry both the worker's session and the seeded grant are admitted to. */
const YOUTH = admissionIn(WORKER_ROW, "min-harbour-youth");

function admissionIn(row: SeededSession, ministryId: string): AdmittedMembership {
  const found = row.admittedMemberships.find((membership) => membership.ministryId === ministryId);
  if (found === undefined) {
    throw new Error(`The seeded ${JSON.stringify(row.sessionId)} session is admitted to no ministry ${JSON.stringify(ministryId)}, so no case here has a context to invite a coach in.`);
  }
  return found;
}
// The documents of the seeded world this file lays its sessions down from
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
  if (template === undefined) {
    throw new Error(`The seed lays down no ${JSON.stringify(workspace)} workspace, so no case in this file has a world to start from.`);
  }
  return template.documents;
}
// The session documents, laid down through the store's one creating path
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
  await resetSession(sessionId, {
    state: { ...state, context: contextOf(state, sessionId, meta) },
    operations: structuredClone(template.operations),
    meta,
  });
}
/** The state document a session holds, read back through the store: the evidence a read wrote nothing and a denial rewrote nothing. */
async function stateOf(sessionId: string): Promise<SessionStateDocument> {
  const documents = await readSession(sessionId);
  if (documents === undefined) {
    throw new Error(`The store holds no session ${JSON.stringify(sessionId)}, so no case here can read the world it asserts about.`);
  }
  // The store keeps a session's documents opaque on purpose, so this file names the shape the seed wrote.
  return documents.state as SessionStateDocument;
}

function grantRecord(state: SessionStateDocument, grantId: string): CoachingGrantRecord {
  const found = state.coachingGrants.find((grant) => grant.grantId === grantId);
  if (found === undefined) {
    throw new Error(`The seeded world holds no coaching grant ${JSON.stringify(grantId)}, so the case that names it has nothing to assert about.`);
  }
  return found;
}
/**
 * Carries the worker's accepted change into the coach's own session document. The store isolates a
 * session's documents, and the seed builds one session per identity from the one `coachingShare`
 * builder; a case that spans both identities carries the state between them rather than hand-writing a
 * grant no mutation produced.
 */
async function carryState(from: string, to: string): Promise<void> {
  const documents = await readSession(from);
  if (documents === undefined) {
    throw new Error(`The store holds no session ${JSON.stringify(from)}, so the world there is not the one to carry.`);
  }
  const state = structuredClone(documents.state);
  await transact(to, (draft) => {
    draft.state = state;
  });
}
// Session metadata: one identity per session, and the scenarios a case needs
/** The two things a case here changes about a session's own metadata: the scenario it runs in, and the failure it arms. */
interface MetaOverrides {
  readonly scenarioId?: ScenarioId;
  readonly failurePlan?: FailurePlanDocument;
}

function workerMeta(overrides: MetaOverrides = {}): SessionMetaDocument {
  return buildSessionMeta({
    principalId: WORKER_ROW.principalId,
    admittedMemberships: WORKER_ROW.admittedMemberships,
    selectedContext: WORKER_ROW.selectedContext,
    sessionState: "signed-in",
    ...overrides,
  });
}

function coachMeta(overrides: MetaOverrides = {}): SessionMetaDocument {
  return buildSessionMeta({
    principalId: COACH_PRINCIPAL,
    admittedMemberships: [],
    selectedContext: null,
    sessionState: "signed-in",
    ...overrides,
  });
}

function secondWorkerMeta(): SessionMetaDocument {
  return buildSessionMeta({
    principalId: SECOND_WORKER_ROW.principalId,
    admittedMemberships: SECOND_WORKER_ROW.admittedMemberships,
    selectedContext: SECOND_WORKER_ROW.selectedContext,
    sessionState: "signed-in",
  });
}
/** The one armed failure that names the read this file is about (AAP 0.12.5). */
function armedScopeDenial(): FailurePlanDocument {
  const plan = setFailurePlan(null, {
    mode: "denied",
    target: { kind: "read", name: "readCoachSubject" },
    armedAt: SEED_INSTANT.toString(),
  });
  if (!plan.ok) {
    throw new Error(`The scope-denial plan the criterion 19 case arms was refused: ${plan.error.code}.`);
  }
  return plan.value;
}
// Small readers over the service's own vocabulary
async function selectedScopeOf(source: SessionSource): Promise<Scope> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    throw new Error(`The session ${JSON.stringify(source.sessionId)} resolved to no principal, so no case here can act in it.`);
  }
  const selected = resolved.session.selected;
  if (selected === null) {
    throw new Error(`The session ${JSON.stringify(source.sessionId)} has selected no context, so no case here has a scope to act in.`);
  }
  return selected;
}
/** The scope a coach's own write claims: it holds no membership, so its principal and the grant's ministry state the authority it acts under. */
function grantAuthorityScope(principalId: string, ministryId: string): Scope {
  return scopeSchema.parse({
    organizationId: `grant-authority:${ministryId}`,
    ministryId,
    supportSubjectId: `grant-authority:${ministryId}`,
    principalId,
  });
}

function attempt<P>(scope: Scope, payload: P, expectedRevision: string = STATED_REVISION): MutationInput<P> {
  return { operationId: newOperationId(), scope, expectedRevision, payload };
}
/** The revision a grant stands at, read from the session that holds it: the token every later change must present. */
async function currentRevisionOf(sessionId: string, grantId: string): Promise<string> {
  return grantRecord(await stateOf(sessionId), grantId).revision;
}

function assertEnvelope<T>(result: ReadResult<T>): T {
  if (result.kind !== "envelope") {
    throw new Error(`The read answered ${JSON.stringify(result.kind)} where an envelope was required: an admitted scope is answered with its data, not with a refusal.`);
  }
  return result.envelope;
}

function assertDenied<T>(result: ReadResult<T>): DeniedOutcome {
  if (result.kind !== "denied") {
    throw new Error(`The read answered ${JSON.stringify(result.kind)} where a denial was required: a scope that holds nothing is refused, never answered with an empty envelope.`);
  }
  return result.denied;
}

function assertConflict(outcome: MutationOutcome): ConflictOutcome {
  if (outcome.outcome !== "conflict") {
    throw new Error(`The mutation answered ${serialised(outcome)} where a conflict was required: a stale or closed change is refused, with the current standing beside the input it preserved.`);
  }
  return outcome;
}

function expectAccepted(outcome: MutationOutcome): { readonly revision: string; readonly created: readonly string[] } {
  if (outcome.outcome !== "accepted") {
    throw new Error(`The mutation answered ${serialised(outcome)} where an acceptance was required.`);
  }
  return { revision: outcome.revision, created: outcome.created ?? [] };
}
/** Switches the named modules on, as the worker, for the grant it owns. */
async function shareModules(grantId: string, keys: readonly ModuleKey[]): Promise<void> {
  for (const key of keys) {
    // Each change presents the revision the record stands at, so a refusal here can only be the module's
    // own answer and never a stale token this file forgot to re-read.
    const outcome = await mutations.coaching.setModule(attempt(workerScope, { grantId, moduleKey: key, enabled: true }, await currentRevisionOf(WORKER_SESSION, grantId)), WORKER_SOURCE);
    // A module already switched on answers `unchanged`: the selection is the same, so nothing is written.
    expect(["accepted", "unchanged"]).toContain(outcome.outcome);
  }
}
/** The families a coach read must never touch: the worker's own work, not the relationship it shares. */
async function sourceWorkOf(sessionId: string): Promise<{
  readonly tasks: SessionStateDocument["tasks"];
  readonly partners: SessionStateDocument["partners"];
  readonly privateNotes: SessionStateDocument["privateNotes"];
  readonly coachingTargets: SessionStateDocument["coachingTargets"];
  readonly coachingCheckIns: SessionStateDocument["coachingCheckIns"];
}> {
  const state = await stateOf(sessionId);
  return {
    tasks: state.tasks,
    partners: state.partners,
    privateNotes: state.privateNotes,
    coachingTargets: state.coachingTargets,
    coachingCheckIns: state.coachingCheckIns,
  };
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
/** A refusal must carry none of the evidence the denial set withholds, and no identifier of what it refused. */
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
    if (!restored.ok) {
      throw new Error(`The scenario clock of ${JSON.stringify(sessionId)} could not be returned to the seed instant: ${restored.error.code}.`);
    }
  }
}

let workerScope: Scope;

let previousNodeEnv: string | undefined;

beforeAll(() => {
  // The development controls and the named-session resolution are gated on `NODE_ENV`, so the run is put
  // in a development build and the environment it arrived with is restored in `afterAll`. The runtime
  // declares `NODE_ENV` read-only, so the value is written through the environment object itself.
  previousNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "development");
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
  if (previousNodeEnv === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
  } else {
    Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
  }
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

    // A caller who coaches nothing is told its own listing is empty — never that another's grant exists.
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
    const invitation = expectAccepted(
      await mutations.coaching.inviteCoach(
        attempt(workerScope, {
          coachPrincipalId: COACH_PRINCIPAL,
          organizationId: YOUTH.organizationId,
          ministryIds: [YOUTH.ministryId],
          duration: { kind: "through-date", shareThroughDate: INVITED_SHARE_THROUGH },
        }),
        WORKER_SOURCE,
      ),
    );
    const grantId = invitation.created[0];
    if (grantId === undefined) {
      throw new Error("The invitation was accepted without naming the grant it created, so no case can read it.");
    }
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
    // An unshared module is not named, counted or hinted at anywhere in the envelope.
    expect(serialised(sharingNothing)).not.toContain("targets");

    await carryState(COACH_SESSION, WORKER_SESSION);
    const switchedOn: readonly ModuleKey[] = ["targets", "check-ins"];
    await shareModules(grantId, switchedOn);
    await carryState(WORKER_SESSION, COACH_SESSION);

    const envelope = assertEnvelope(await reads.coach.readCoachSubject({ grantId }, COACH_SOURCE));
    expect(envelope.data.sharesNothing).toBe(false);
    expect(envelope.data.modules.map((view) => view.module).sort()).toEqual([...switchedOn].sort());
    // Cross-checked against the record the worker's own changes produced: the envelope admits exactly the
    // flags that stand switched on, and the episode's admission is the domain's answer, not this file's.
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
    if (results === undefined || results.module !== "support-results") {
      throw new Error("The shared support-results module was not enumerated at all, which would hide a refusal as an absence.");
    }
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
    if (storedCutoff === null) {
      throw new Error("The seeded grant states no cutoff, so no case here has an exclusive endpoint to read at.");
    }
    const cutoff = Temporal.Instant.from(storedCutoff);
    // The stored cutoff is the exclusive start of the civil day after the Share-through date the worker
    // chose, resolved by the application's one cutoff function rather than recomputed here.
    const shareThrough = shareThroughDateOfCutoff({ cutoffInstant: cutoff, frozenZone: initial.duration.frozenZone });
    if (shareThrough === null) {
      throw new Error(`The stored cutoff ${storedCutoff} resolves to no Share-through date in ${initial.duration.frozenZone}.`);
    }
    const resolved = shareCutoff({ shareThroughDate: shareThrough, frozenZone: initial.duration.frozenZone });
    if (resolved.status !== "bounded") {
      throw new Error(`The cutoff for ${shareThrough.toString()} resolved to no instant: ${resolved.reason}.`);
    }
    expect(resolved.cutoffInstant.toString()).toBe(storedCutoff);

    const offsetOf = (instant: Temporal.Instant): number => instant.epochMilliseconds - SEED_INSTANT.epochMilliseconds;
    const before = await setClock(COACH_SESSION, offsetOf(cutoff) - ONE_MILLISECOND);
    if (!before.ok) {
      throw new Error(`The coach's clock could not be moved to one millisecond before the cutoff: ${before.error.code}.`);
    }
    // One instant before the cutoff the same read is admitted, so both sides of the boundary are asserted.
    const open = assertEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE));
    expect(open.data.duration.cutoffInstant).toBe(storedCutoff);
    expect(open.data.duration.openAtRead).toBe(true);

    const at = await setClock(COACH_SESSION, offsetOf(cutoff));
    if (!at.ok) {
      throw new Error(`The coach's clock could not be moved to the cutoff: ${at.error.code}.`);
    }
    const closed = await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE);
    expect(assertDenied(closed).reasonCode).toBe("no-permission");
    expectDenialWithholds(closed, [ACTIVE_GRANT_ID, WORKER_PRINCIPAL]);

    // The refusal is the window's, not a rewrite: the stored grant still stands active, at the same
    // revision, and still states the cutoff it was accepted with.
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
    // One admitted read, one listing and two refusals: the session's records are exactly what they were.
    expect(serialised(await stateOf(COACH_SESSION))).toBe(coachDocumentBefore);
    expect(await sourceWorkOf(COACH_SESSION)).toEqual(coachWorkBefore);

    // The worker's own work is a different record class from the relationship: a revocation closes the
    // sharing and annotates no task, rewrites no partner, edits no private note and revises no target.
    const workerWorkBefore = await sourceWorkOf(WORKER_SESSION);
    expectAccepted(await mutations.coaching.revokeGrant(attempt(workerScope, { grantId: ACTIVE_GRANT_ID }, await currentRevisionOf(WORKER_SESSION, ACTIVE_GRANT_ID)), WORKER_SOURCE));
    expect(await sourceWorkOf(WORKER_SESSION)).toEqual(workerWorkBefore);

    // Once the closed relationship reaches the coach's own session the read is denied there too, and the
    // worker's work the coach's document holds is still exactly what it was.
    await carryState(WORKER_SESSION, COACH_SESSION);
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission");
    expect(await sourceWorkOf(COACH_SESSION)).toEqual(coachWorkBefore);
    expect(grantRecord(await stateOf(WORKER_SESSION), ACTIVE_GRANT_ID).state).toBe("revoked");
  });

  it("keeps the stop types distinct and refuses a stale action on an episode that is already closed", async () => {
    // The lifecycle states are a closed set with no shared member: revoked, ended and left are three
    // different facts about a relationship, and no surface may present one as another.
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

    // A closed episode is refused on both sides: its read is denied, and a stale module change answers as
    // stale — never as accepted — with the current standing stated beside the caller's preserved input.
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: ENDED_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission");
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: REVOKED_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission");
    const staleOnEnded = assertConflict(await mutations.coaching.setModule(attempt(workerScope, { grantId: ENDED_GRANT_ID, moduleKey: "targets", enabled: true }, await currentRevisionOf(WORKER_SESSION, ENDED_GRANT_ID)), WORKER_SOURCE));
    expect(staleOnEnded.reason).toBe("stale-revision");
    expect(serialised(staleOnEnded.current)).toContain("ended");
    expect(serialised(staleOnEnded.preservedInput)).toContain("targets");
    expect(grantRecord(await stateOf(WORKER_SESSION), ENDED_GRANT_ID).revision).toBe(grantRecord(seeded, ENDED_GRANT_ID).revision);

    // Revoking the open episode and repeating the same stale change leaves it revoked, at the revision the
    // revocation produced: the stale action wrote nothing.
    const revocation = expectAccepted(await mutations.coaching.revokeGrant(attempt(workerScope, { grantId: ACTIVE_GRANT_ID }, await currentRevisionOf(WORKER_SESSION, ACTIVE_GRANT_ID)), WORKER_SOURCE));
    expect(revocation.revision).not.toBe(active.revision);
    const staleOnRevoked = assertConflict(await mutations.coaching.setModule(attempt(workerScope, { grantId: ACTIVE_GRANT_ID, moduleKey: "targets", enabled: true }, await currentRevisionOf(WORKER_SESSION, ACTIVE_GRANT_ID)), WORKER_SOURCE));
    expect(serialised(staleOnRevoked.current)).toContain("revoked");
    const afterStale = grantRecord(await stateOf(WORKER_SESSION), ACTIVE_GRANT_ID);
    expect(afterStale.state).toBe("revoked");
    expect(afterStale.revision).toBe(revocation.revision);

    // No coach write beyond the two the identity holds reaches a record: the membership-scoped mutations
    // refuse it before they read the grant at all.
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

    // The coach's own second write records `left`: its own member of the closed set, which is neither a
    // revocation nor the worker ending the relationship, and which ends the reads.
    expectAccepted(await mutations.coach.leaveCoaching(attempt(coachScope, { grantId: ACTIVE_GRANT_ID }, await currentRevisionOf(COACH_SESSION, ACTIVE_GRANT_ID)), COACH_SOURCE));
    const left = grantRecord(await stateOf(COACH_SESSION), ACTIVE_GRANT_ID);
    expect(left.state).toBe("left");
    expect(new Set([left.state, revokedState, endedState]).size).toBe(3);
    expect(serialised(await stateOf(COACH_SESSION))).not.toBe(coachBefore);
    expect(assertDenied(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE)).reasonCode).toBe("no-permission");
  });

  it("leaves the other admitted modules readable when one shared module's source is unavailable", async () => {
    // The seed pairs the unavailable-coaching-module scenario with a world that holds no support source.
    // Laid down here, the module that needs that source reports unavailable, the modules that do not stay
    // usable, and neither is presented as the other.
    await layDownSession(WORKER_SESSION, workerMeta(), COACHING_ONLY_WORKSPACE);
    await layDownSession(COACH_SESSION, coachMeta({ scenarioId: "coaching-module-unavailable" }), COACHING_ONLY_WORKSPACE);
    await shareModules(ACTIVE_GRANT_ID, ["support-goal"]);
    await carryState(WORKER_SESSION, COACH_SESSION);

    const envelope = assertEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT_ID }, COACH_SOURCE));
    expect(envelope.data.modules.map((view) => view.module).sort()).toEqual(["check-ins", "support-goal", "targets"]);
    const goal = envelope.data.modules.find((view) => view.module === "support-goal");
    expect(goal?.module).toBe("support-goal");
    expect(goal?.state).toBe("unavailable");
    expect(goal?.unavailability).not.toBeNull();

    const targets = envelope.data.modules.find((view) => view.module === "targets");
    if (targets === undefined || targets.module !== "targets") {
      throw new Error("The targets module is shared and was not enumerated, which would blank the whole surface for one module's outage.");
    }
    expect(targets.state).not.toBe("unavailable");
    expect(targets.progress.length).toBeGreaterThan(0);

    const checkIns = envelope.data.modules.find((view) => view.module === "check-ins");
    if (checkIns === undefined || checkIns.module !== "check-ins") {
      throw new Error("The check-ins module is shared and was not enumerated, which would blank the whole surface for one module's outage.");
    }
    expect(checkIns.state).not.toBe("unavailable");
    expect(checkIns.sharedCheckIns.length).toBeGreaterThan(0);
  });
});


