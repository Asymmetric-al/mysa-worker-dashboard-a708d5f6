/**
 * The limits and revision identity of the coaching share surfaces — success criterion 16's final
 * clause, "check-in limits are enforced without truncation".
 *
 * Five bounds decide what a worker may share and what a named coach may read, and each is asserted at
 * its exact value on both sides, because a one-sided case cannot tell a limit from an off-by-one:
 *
 * - a question set of at most 5 questions;
 * - each question of at most 500 Unicode scalars;
 * - each answer of at most 4,000 Unicode scalars;
 * - a check-in request of at most 256 KiB (262,144 bytes);
 * - a reviewed shared-task description of at most 240 Unicode code points.
 *
 * Every limit counts Unicode scalar values, never UTF-16 code units and never bytes: an astral
 * character is one scalar and two UTF-16 units, so the 500-scalar question, the 4,000-scalar answer and
 * the 240-code-point description below are built from astral characters. A limit measured in `.length`
 * would refuse values this file proves are accepted.
 *
 * A refusal is never a truncation. An over-limit value is refused with its measured length named, and
 * the stored record still carries the last accepted value: nothing was written, and nothing was cut
 * down to fit the limit. Truncating an answer would misstate what the worker wrote, and a shortened
 * question would change what the worker asked.
 *
 * Divergences from the assigned dependency list, recorded because they change how the rules are
 * reached rather than what they assert:
 *
 * - `reads.readCheckIns` and `reads.readTaskShares` take no session source, so a framework-free test —
 *   which has no request cookie — would only ever receive their cookie-less refusal. The worker-side
 *   observations this file needs therefore come from the service mutations' outcomes and from the
 *   session document a mutation wrote, read through the store's own `readSession`. The coach-side
 *   observation comes from `reads.readCoachSubject`, and the paged list from `reads.readTargets`; both
 *   take a source, so the coach read and the target list asserted here are the real ones.
 * - The rules that belong to a module rather than to the service are asserted against that module —
 *   `captureQuestions` and the three check-in states, `safeTaskSummary` and the share read states, the
 *   target version resolution — and the rules that belong to the service are asserted through
 *   `mutations.coaching.*` and `mutations.coach.*`. No rule is computed in this file that either of
 *   them owns.
 * - No service mutation lays a session down — the seed builds its documents in memory — so the sessions
 *   this file owns are written with the store's `resetSession` and removed again in `afterAll`. Each
 *   carries this file's own id, so no other suite's records are touched, and no seeded session is read
 *   or written by this file.
 * - The coach's session is handed the record set the worker's session holds, which is how the seed
 *   itself models the relationship: its coach workspace carries the same coaching records as the
 *   worker's. That is what lets the coach read be asked about the check-in and the summary this file
 *   has just changed.
 * - A check-in's shared revision is one slot. `coaching/checkin.ts` keeps that slot's `revisionId`
 *   stable across an explicit update and advances the check-in's own revision with the answers, so this
 *   file asserts that contract — the slot's identity stays, its answers and the record's revision move —
 *   rather than a second shared identity the module never mints.
 * - The scenario clock is never moved. Every seeded timestamp and every boundary stands at the seed
 *   instant, which the literals below state so this file consults no clock at all.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import {
  CHECKIN_MAX_ANSWER_SCALARS,
  CHECKIN_MAX_QUESTION_SCALARS,
  CHECKIN_MAX_QUESTIONS,
  CHECKIN_MAX_REQUEST_BYTES,
  captureQuestions,
  checkInReadState,
  savePrivateDraft,
  shareCheckIn as openSharedCheckIn,
  validateCheckInRequest,
  withdrawSharedCheckIn,
  type CheckIn,
  type CheckInPayload,
  type CheckInQuestion,
} from "@/modules/coaching/checkin";
import {
  TASK_SUMMARY_MAX_CODE_POINTS,
  reviewTaskSummary,
  safeTaskSummary,
  selectSuccessorForSharing,
  stopTaskShare as stopModelledTaskShare,
  taskShareReadState,
  type SafeTaskSummaryInput,
  type TaskShare,
  type TaskSummaryDueDate,
} from "@/modules/coaching/taskshare";
import {
  resolvePeriodContaining,
  resolveTargetVersion,
  startProspectiveVersion,
  workerTargetProgress,
  type PeriodAnchor,
  type ResolvedPeriod,
  type TargetPeriod,
  type TargetRecord,
  type TargetVersion,
  type TargetVersionChange,
} from "@/modules/coaching/target";
import { mutations, reads, type CoachingCheckInRecord, type CoachingTargetRecord, type Scope } from "@/modules/data-service";
import { resolveSession, type SessionSource } from "@/modules/data-service/authorize";
import { isOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { DEFAULT_SESSION_ID, SEEDED_PERSONAS, seed, type SeededSessionDocuments, type SeededSessionWithDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { readSession, resetSession } from "@/modules/store/repository";
// The sessions this file owns, and the world each starts from
const WORKER_SESSION = "domain-coaching-limits";

const COACH_SESSION = "domain-coaching-limits-coach";
/** The paging case's own session: the seeded world's documents, with a target history longer than either page bound. */
const PAGING_SESSION = `${WORKER_SESSION}-paging`;

const SEEDED_COACH_SESSION = "coach";

const WORKER: SessionSource = { sessionId: WORKER_SESSION };

const COACH: SessionSource = { sessionId: COACH_SESSION };

const PAGING: SessionSource = { sessionId: PAGING_SESSION };
/** The grant the seeded worker holds with the seeded coach: active, sharing targets and check-ins. */
const ACTIVE_GRANT = "grant-established-coach";
/** A task that does not recur, so its one occurrence is the task itself. */
const PLAIN_TASK = "task-care-jo";
/** A task that does recur, whose next occurrence is shared only once the worker selects it. */
const RECURRING_TASK = "task-series-weekly-call";
/** The revision every seeded record stands at. */
const FIRST_REVISION = "rev-1";
/** The display zone the task list is read in; it is stated rather than assumed, as every zone is. */
const DISPLAY_ZONE = "Europe/London";
/** The seed's own instant (2026-11-20T00:00:00Z), stated here so this file reads no clock. */
const SEEDED_AT = Temporal.Instant.from("2026-11-20T00:00:00Z");
/** 256 KiB in bytes, the ceiling the serialised check-in request is measured against. */
const REQUEST_CEILING_BYTES = 262_144;
/** AAP 0.8.7's coaching list page size: 25 rows by default, clamped to 100 at most. */
const PAGE_SIZE_DEFAULT = 25;

const PAGE_SIZE_CAP = 100;
/** The length the paging session's history is made: past the 25-row default and past the 100-row cap. */
const PAGING_HISTORY_LENGTH = 103;
// The narrowed result shapes the domain modules answer with
interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

interface Refused<E> {
  readonly ok: false;
  readonly error: E;
}

function valueOf<T, E>(result: Ok<T> | Refused<E>, what: string): T {
  if (!result.ok) {
    throw new Error(`${what} was refused: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function refusalOf<T, E>(result: Ok<T> | Refused<E>, what: string): E {
  if (result.ok) {
    throw new Error(`${what} was accepted, and this case needs the refusal it should have received`);
  }
  return result.error;
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} is missing, so this case has nothing to assert against`);
  }
  return value;
}
/**
 * How many Unicode scalar values `text` holds — the unit every limit in this file counts. Iterating a
 * string yields code points, so this counts scalars rather than UTF-16 units.
 */
function scalarsOf(text: string): number {
  return Array.from(text).reduce((total) => total + 1, 0);
}
/**
 * Builds a string of exactly `count` code points. An astral character is one code point and two UTF-16
 * units, so `codePoints(500)` is within a 500-scalar limit and far outside a 500-unit one — which is
 * the difference every limit in this file rests on, and the only place `.length` is consulted.
 */
function codePoints(count: number, character = "\u{1D4B3}"): string {
  const text = character.repeat(count);
  const units = text.length;
  if (scalarsOf(text) !== count) {
    throw new RangeError(`codePoints(${String(count)}) built ${String(scalarsOf(text))} code points`);
  }
  // `"𝒳".length` is 2, so an astral string's length is twice its code points: a limit measured in
  // `.length` would refuse a value that a scalar-counted limit accepts.
  if (character.length > 1 && units !== count * character.length) {
    throw new RangeError(`codePoints(${String(count)}) built ${String(units)} UTF-16 units, not ${String(count * character.length)}`);
  }
  return text;
}
const UTF8 = new TextEncoder();

function bytesOf(value: unknown): number {
  return UTF8.encode(JSON.stringify(value)).byteLength;
}
/**
 * A check-in payload whose serialised form is exactly `targetBytes` long. The ceiling is measured on
 * the serialised `{questions, answers}` body rather than on the answer text, so a case that only made
 * one answer long would silently re-test the answer limit instead of the request limit.
 */
function payloadOfBytes(targetBytes: number): CheckInPayload {
  const texts: string[] = [];
  const payloadWith = (candidate: readonly string[]): CheckInPayload => ({
    questions: [],
    answers: candidate.map((text) => ({ questionOrder: null, text })),
  });
  while (bytesOf(payloadWith(texts)) < targetBytes) {
    const current = bytesOf(payloadWith(texts));
    const overhead = bytesOf(payloadWith([...texts, ""])) - current;
    const shortfall = targetBytes - current;
    if (shortfall <= overhead) {
      throw new RangeError(`A ${String(targetBytes)}-byte payload cannot be built from whole answers`);
    }
    texts.push(codePoints(Math.min(CHECKIN_MAX_ANSWER_SCALARS, shortfall - overhead), "a"));
  }
  const payload = payloadWith(texts);
  if (bytesOf(payload) !== targetBytes) {
    throw new RangeError(`The payload is ${String(bytesOf(payload))} bytes, not ${String(targetBytes)}`);
  }
  return payload;
}
// The seeded world, and the two sessions this file lays down
let world: { readonly worker: SeededSessionDocuments; readonly coach: SeededSessionDocuments };

let scope: Scope;

function documentsOf(sessions: readonly SeededSessionWithDocuments[], sessionId: string): SeededSessionDocuments {
  const session = sessions.find((candidate) => candidate.sessionId === sessionId);
  if (session === undefined) {
    throw new Error(`The seed lays down no "${sessionId}" session, so this file has no world to start from`);
  }
  return session.documents;
}

async function layDownWorkerWorld(): Promise<void> {
  const { state, operations, meta } = world.worker;
  await resetSession(WORKER_SESSION, {
    meta,
    operations,
    // A record set states the session that owns it, so the private session's own id is written into the
    // document it holds rather than naming a session that is not the one reading it.
    state: { ...state, context: { ...state.context, sessionId: WORKER_SESSION } },
  });
}

async function scopeOf(source: SessionSource): Promise<Scope> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    throw new Error(`The session "${source.sessionId}" could not be resolved, so no coaching case can act in it`);
  }
  const selected = resolved.session.selected;
  if (selected === null) {
    throw new Error(`The session "${source.sessionId}" has selected no context, so it holds no scope to share in`);
  }
  return selected;
}
// The two rosters the world is read back from
async function storedState(): Promise<SessionStateDocument> {
  const documents = await readSession(WORKER_SESSION);
  if (documents === undefined) {
    throw new Error(`The session "${WORKER_SESSION}" holds no documents, so nothing it accepted can be read back`);
  }
  return documents.state as SessionStateDocument;
}

async function storedCheckIn(checkInId: string): Promise<CoachingCheckInRecord> {
  const record = (await storedState()).coachingCheckIns.find((candidate) => candidate.checkInId === checkInId);
  if (record === undefined) {
    throw new Error(`The session holds no check-in "${checkInId}"`);
  }
  return record;
}

async function storedCheckInIds(): Promise<readonly string[]> {
  return (await storedState()).coachingCheckIns.map((checkIn) => checkIn.checkInId);
}

// The mutation outcomes, narrowed by name
type OutcomeNamed<K extends MutationOutcome["outcome"]> = Extract<MutationOutcome, { readonly outcome: K }>;

function outcomeNamed<K extends MutationOutcome["outcome"]>(outcome: MutationOutcome, name: K, what: string): OutcomeNamed<K> {
  // The guard is asked as well as the discriminant, so a value that reached this test through JSON is
  // narrowed by the same check the Route Handlers use rather than by a cast.
  if (!isOutcome(outcome) || outcome.outcome !== name) {
    throw new Error(`${what} answered ${JSON.stringify(outcome)} instead of "${name}"`);
  }
  return outcome as OutcomeNamed<K>;
}

function firstCreated(outcome: { readonly created?: readonly string[] }, what: string): string {
  return required(outcome.created?.at(0), `${what}'s created identifier`);
}
// The check-in mutations, each carrying its own attempt identity
type CheckInAttempt<P> = { readonly operationId: string; readonly scope: Scope; readonly expectedRevision: string; readonly payload: P };

function attempt<P>(payload: P, expectedRevision: string): CheckInAttempt<P> {
  return { operationId: newOperationId(), scope, expectedRevision, payload };
}

async function saveCheckIn(
  payload: { readonly checkInId?: string; readonly questions?: readonly string[]; readonly answers: readonly string[] },
  expectedRevision: string = FIRST_REVISION,
): Promise<MutationOutcome> {
  return mutations.coaching.saveCheckIn(
    attempt(
      {
        ...(payload.checkInId === undefined ? {} : { checkInId: payload.checkInId }),
        ...(payload.questions === undefined ? {} : { questions: [...payload.questions] }),
        answers: [...payload.answers],
      },
      expectedRevision,
    ),
    WORKER,
  );
}

async function shareCheckIn(checkInId: string, expectedRevision: string): Promise<MutationOutcome> {
  return mutations.coaching.shareCheckIn(attempt({ checkInId }, expectedRevision), WORKER);
}

async function updateSharedCheckIn(checkInId: string, answers: readonly string[], expectedRevision: string): Promise<MutationOutcome> {
  return mutations.coaching.updateSharedCheckIn(attempt({ checkInId, answers: [...answers] }, expectedRevision), WORKER);
}

async function withdrawCheckIn(checkInId: string, expectedRevision: string): Promise<MutationOutcome> {
  return mutations.coaching.withdrawCheckIn(attempt({ checkInId }, expectedRevision), WORKER);
}

async function setModule(moduleKey: "task-summaries" | "check-ins", enabled: boolean, expectedRevision: string = FIRST_REVISION): Promise<MutationOutcome> {
  return mutations.coaching.setModule(attempt({ grantId: ACTIVE_GRANT, moduleKey, enabled }, expectedRevision), WORKER);
}

async function shareTaskSummary(taskId: string, safeDescription: string, expectedRevision: string): Promise<MutationOutcome> {
  return mutations.coaching.shareTaskSummary(attempt({ taskId, safeDescription }, expectedRevision), WORKER);
}

async function stopTaskShare(shareId: string, expectedRevision: string): Promise<MutationOutcome> {
  return mutations.coaching.stopTaskShare(attempt({ shareId }, expectedRevision), WORKER);
}
/** A check-in whose answers are already stored, so a later case has a last-accepted value to compare against. */
interface StoredDraft {
  readonly checkInId: string;
  readonly revision: string;
  readonly answers: readonly string[];
}

async function draftWith(answers: readonly string[], questions: readonly string[] = []): Promise<StoredDraft> {
  const accepted = outcomeNamed(await saveCheckIn({ ...(questions.at(0) === undefined ? {} : { questions }), answers }), "accepted", "saveCheckIn");
  const checkInId = firstCreated(accepted, "saveCheckIn");
  const stored = await storedCheckIn(checkInId);
  const draft = stored.privateDraft;
  if (draft === null) {
    throw new Error(`The check-in "${checkInId}" was accepted with no private draft, so nothing can be compared`);
  }
  return { checkInId, revision: accepted.revision, answers: draft.answers.map((answer) => answer.text) };
}
// The coach read, from the coach's own session
type CoachReadResult = Awaited<ReturnType<typeof reads.coach.readCoachSubject>>;

type CoachEnvelope = Extract<CoachReadResult, { readonly kind: "envelope" }>["envelope"];

type CoachModule = CoachEnvelope["data"]["modules"][number];

type CheckInsModule = Extract<CoachModule, { readonly module: "check-ins" }>;

type SummariesModule = Extract<CoachModule, { readonly module: "task-summaries" }>;

/**
 * Hands the coach's session the record set the worker's session now holds and reads the granted subject
 * through the real coach read. The exchange is how the seed models the relationship — the coach's
 * workspace carries the worker's coaching records — so the read is asked about the records this file
 * has just changed rather than about a copy nothing has touched.
 */
async function coachSubject(): Promise<CoachEnvelope> {
  const workerDocuments = await readSession(WORKER_SESSION);
  if (workerDocuments === undefined) {
    throw new Error(`The session "${WORKER_SESSION}" holds no documents, so the coach has nothing to read`);
  }
  await resetSession(COACH_SESSION, {
    meta: world.coach.meta,
    operations: world.coach.operations,
    state: workerDocuments.state,
  });
  const result = await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT }, COACH);
  if (result.kind !== "envelope") {
    throw new Error(`The coach read answered "${result.kind}" instead of an admitted subject`);
  }
  return result.envelope;
}

function checkInsModuleOf(envelope: CoachEnvelope): CheckInsModule | undefined {
  return envelope.data.modules.find((view): view is CheckInsModule => view.module === "check-ins");
}

function summariesModuleOf(envelope: CoachEnvelope): SummariesModule | undefined {
  return envelope.data.modules.find((view): view is SummariesModule => view.module === "task-summaries");
}
// The worker's own task list, read through the named read that takes a session
type TaskListData = Extract<Awaited<ReturnType<typeof reads.work.listTasks>>, { readonly kind: "envelope" }>["envelope"]["data"];

type TaskRow = TaskListData["tasks"][number];

async function taskRow(taskId: string): Promise<TaskRow> {
  const result = await reads.work.listTasks({ list: "all", displayTimeZone: DISPLAY_ZONE }, WORKER);
  if (result.kind !== "envelope") {
    throw new Error(`The task list answered "${result.kind}" instead of an envelope`);
  }
  const row = result.envelope.data.tasks.find((candidate) => candidate.taskId === taskId);
  if (row === undefined) {
    throw new Error(`The task list holds no task "${taskId}"`);
  }
  return row;
}
// The world every case starts from
beforeAll(async () => {
  const sessions = await seed();
  world = {
    worker: documentsOf(sessions, DEFAULT_SESSION_ID),
    coach: documentsOf(sessions, SEEDED_COACH_SESSION),
  };
});

beforeEach(async () => {
  await layDownWorkerWorld();
  scope = await scopeOf(WORKER);
});

afterAll(async () => {
  // Every session this file writes is its own, so the store is left holding none of its fixtures.
  await resetSession(WORKER_SESSION);
  await resetSession(COACH_SESSION);
  await resetSession(PAGING_SESSION);
});
// The module's own payload shape, for the cases that assert a property of the module itself
function questionsOf(wordings: readonly string[]): readonly CheckInQuestion[] {
  return wordings.map((wording, order) => ({ wording, order }));
}

function modulePayload(questions: readonly string[], answers: readonly string[]): CheckInPayload {
  // With no captured question, every answer stands on its own and the module records no question order.
  const standAlone = questions.at(0) === undefined;
  return {
    questions: questions.map((wording, index) => ({ wording, order: index })),
    answers: answers.map((text, index) => ({ questionOrder: standAlone ? null : index, text })),
  };
}

describe("the limits the release fixes", () => {
  it("states the five fixed limits in code points and bytes", () => {
    expect(CHECKIN_MAX_QUESTIONS).toBe(5);
    expect(CHECKIN_MAX_QUESTION_SCALARS).toBe(500);
    expect(CHECKIN_MAX_ANSWER_SCALARS).toBe(4000);
    // 256 KiB, the ceiling measured on the serialised request rather than on an answer.
    expect(CHECKIN_MAX_REQUEST_BYTES).toBe(REQUEST_CEILING_BYTES);
    expect(TASK_SUMMARY_MAX_CODE_POINTS).toBe(240);
  });
});
// The target list's paging, read through the one read that answers it
type TargetsData = Extract<Awaited<ReturnType<typeof reads.coaching.readTargets>>, { readonly kind: "envelope" }>["envelope"]["data"];

/**
 * Lays down the paging session: the seeded world's own documents with a target history long enough to cross
 * both page bounds. The clones are synthetic repetitions of one seeded shape — a private label, a measure and
 * a weekly period the worker already set — added only so a page boundary falls inside the history; each takes
 * its own `targetId` and its own version `revisionId`, because the read names a target and its plan by those
 * ids. They keep the seeded principal, so the read counts them as that worker's own history and no other
 * principal's.
 */
async function layDownPagingWorld(): Promise<void> {
  const { state, operations, meta } = world.worker;
  const shape = required(state.coachingTargets.at(0), "the seeded target the paging history repeats");
  const eligible = state.coachingTargets.filter((record) => record.workerPrincipalId === shape.workerPrincipalId).length;
  const clones = Array.from({ length: Math.max(0, PAGING_HISTORY_LENGTH - eligible) }, (_, index) => ({
    ...shape,
    targetId: `${shape.targetId}-paging-${String(index)}`,
    versions: shape.versions.map((version) => ({ ...version, revisionId: `${version.revisionId}-paging-${String(index)}` })),
  }));
  await resetSession(PAGING_SESSION, {
    meta,
    operations,
    // As in the worker's session, the record set states the session that owns it rather than naming another.
    state: {
      ...state,
      context: { ...state.context, sessionId: PAGING_SESSION },
      coachingTargets: [...state.coachingTargets, ...clones],
    },
  });
}
/**
 * Every target id the paging session holds for the principal the read serves — the whole eligible history,
 * which `page.total` must count and which walking the pages must reach exactly.
 */
async function pagingHistory(): Promise<readonly string[]> {
  const resolution = await resolveSession(PAGING);
  if (!resolution.ok) {
    throw new Error(`The session "${PAGING_SESSION}" could not be resolved, so it holds no history to page`);
  }
  const documents = await readSession(PAGING_SESSION);
  if (documents === undefined) {
    throw new Error(`The session "${PAGING_SESSION}" holds no documents, so it holds no history to page`);
  }
  const { coachingTargets } = documents.state as SessionStateDocument;
  const history = coachingTargets.filter((record) => record.workerPrincipalId === resolution.session.principalId);
  return history.map((record) => record.targetId);
}

async function pagingPage(query: { readonly page?: number; readonly pageSize?: number }): Promise<TargetsData> {
  const result = await reads.coaching.readTargets(query, PAGING);
  if (result.kind !== "envelope") {
    throw new Error(`The targets read answered "${result.kind}" instead of an envelope`);
  }
  return result.envelope.data;
}
/**
 * AAP 0.8.7 fixes the coaching list page size at 25 rows by default with a 100-row cap, and states that
 * "eligible history is never truncated by the cap"; that is the value Criterion 16 rests on. The clauses are
 * asserted against the read that produces them rather than against the constants, because a constant copied
 * into a test proves only that the constant was copied. The session below holds a history longer than both
 * bounds, so the short default page, the full capped page and the walk across every page are all observed.
 */
describe("the list page size", () => {
  beforeAll(async () => {
    await layDownPagingWorld();
  });

  it("pages 25 rows by default, clamps a larger request to 100, and loses no target to the cap", async () => {
    const history = await pagingHistory();
    // The history has to cross both bounds for either clause to mean anything: past the 25-row default, and
    // past the 100-row cap, so the capped request is answered with a full page of the same history.
    expect(history.length).toBeGreaterThan(PAGE_SIZE_CAP);
    expect(new Set(history).size).toBe(history.length);

    // The default: 25 rows, the cap named at 100, and a total that counts the whole eligible history rather
    // than the page in hand. AAP 0.8.7 fixes the 25 and the 100.
    const first = await pagingPage({});
    expect(first.page.index).toBe(0);
    expect(first.page.size).toBe(PAGE_SIZE_DEFAULT);
    expect(first.targets.length).toBe(PAGE_SIZE_DEFAULT);
    expect(first.page.cappedAt).toBe(PAGE_SIZE_CAP);
    expect(first.page.total).toBe(history.length);
    expect(first.page.totalPages).toBe(Math.ceil(history.length / PAGE_SIZE_DEFAULT));
    // A page is a window on 25 distinct targets, never one target repeated to fill the rows.
    expect(new Set(first.targets.map((target) => target.targetId)).size).toBe(PAGE_SIZE_DEFAULT);

    // The cap: a request for 500 rows is clamped to 100. The clamp bounds one page only — the total still
    // counts every eligible target — which is "never truncated by the cap" read at its source.
    const capped = await pagingPage({ pageSize: 500 });
    expect(capped.page.size).toBe(PAGE_SIZE_CAP);
    expect(capped.targets.length).toBe(PAGE_SIZE_CAP);
    expect(capped.page.total).toBe(history.length);
    expect(capped.page.totalPages).toBe(Math.ceil(history.length / PAGE_SIZE_CAP));

    // The history: walking every index the default size produces yields each eligible target exactly once,
    // with none missing, so nothing falls off the end of the list however long it grows.
    const walked: string[] = [];
    for (let index = 0; index < first.page.totalPages; index += 1) {
      const page = await pagingPage({ page: index });
      walked.push(...page.targets.map((target) => target.targetId));
    }
    expect(walked.length).toBe(history.length);
    expect(new Set(walked).size).toBe(history.length);
    expect(new Set(walked)).toEqual(new Set(history));

    // The page size is validated rather than trusted: zero and a fractional request each fall back to the
    // 25-row default, so a malformed request reads a page instead of a zero-length one.
    for (const pageSize of [0, 2.5]) {
      const held = await pagingPage({ pageSize });
      expect(held.page.size).toBe(PAGE_SIZE_DEFAULT);
      expect(held.targets.length).toBe(PAGE_SIZE_DEFAULT);
    }
  });
});

describe("the question set", () => {
  it("captures the wording and the order at editor start, and a later edit of the list never rewrites the capture", () => {
    const questions: CheckInQuestion[] = [
      { wording: "How did the week go?", order: 0 },
      { wording: "What would help next week?", order: 1 },
      { wording: "What will you leave undone?", order: 2 },
    ];
    const captured = valueOf(captureQuestions(questions, SEEDED_AT), "captureQuestions");
    // The editor is open: the worker reworders one question and adds another, after the capture.
    questions[1] = { wording: "Reworded after the editor opened", order: 1 };
    questions.push({ wording: "Added after the editor opened", order: 3 });
    expect(captured.questions.map((question) => question.wording)).toEqual(["How did the week go?", "What would help next week?", "What will you leave undone?"]);
    expect(captured.questions.map((question) => question.order)).toEqual([0, 1, 2]);
    expect(captured.capturedAt.toString()).toBe(SEEDED_AT.toString());
  });

  it("accepts five questions and refuses a sixth by naming the limit, storing neither the sixth nor a shortened set", async () => {
    const five = questionsOf(["How did the week go?", "What would help next week?", "What encouraged you?", "What was hard?", "What will you leave undone?"]);
    const captured = valueOf(captureQuestions(five, SEEDED_AT), "captureQuestions at five questions");
    expect(captured.questions).toHaveLength(5);

    const six = questionsOf([...five.map((question) => question.wording), "A sixth question"]);
    const sixRefusal = refusalOf(captureQuestions(six, SEEDED_AT), "captureQuestions at six questions");
    const violation = required(sixRefusal.violations.at(0), "the question-count violation");
    expect(violation.reason).toBe("too-many-questions");
    expect(violation.measured).toBe(6);
    expect(violation.limit).toBe(5);

    const drafted = await draftWith(
      ["Five.", "Five.", "Five.", "Five.", "Five."],
      five.map((question) => question.wording),
    );
    const refused = outcomeNamed(
      await saveCheckIn({ checkInId: drafted.checkInId, questions: six.map((question) => question.wording), answers: ["Six.", "Six.", "Six.", "Six.", "Six.", "Six."] }, drafted.revision),
      "invalid",
      "the sixth question",
    );
    const message = required(refused.fields.questions?.at(0), "the question-count refusal message");
    expect(message).toContain("6");
    expect(message).toContain("5");

    // Nothing the refused save carried reached the record: the stored set is the five that were accepted.
    const after = await storedCheckIn(drafted.checkInId);
    expect(after.revision).toBe(drafted.revision);
    expect(after.privateDraft?.questions.map((question) => question.wording)).toEqual(five.map((question) => question.wording));
  });

  it("accepts a 500-scalar question built from astral characters and refuses 501 with the count shown", async () => {
    const atLimit = codePoints(CHECKIN_MAX_QUESTION_SCALARS);
    expect(Array.from(atLimit)).toHaveLength(CHECKIN_MAX_QUESTION_SCALARS);
    const captured = valueOf(captureQuestions(questionsOf([atLimit]), SEEDED_AT), "captureQuestions at 500 scalars");
    expect(required(captured.questions.at(0), "the captured question").wording).toBe(atLimit);

    const drafted = await draftWith(["It went well."], [atLimit]);
    expect(required(drafted.answers.at(0), "the stored answer")).toBe("It went well.");
    const stored = await storedCheckIn(drafted.checkInId);
    expect(required(stored.privateDraft?.questions.at(0), "the stored question").wording).toBe(atLimit);

    const over = codePoints(CHECKIN_MAX_QUESTION_SCALARS + 1);
    const overRefusal = refusalOf(captureQuestions(questionsOf([over]), SEEDED_AT), "captureQuestions at 501 scalars");
    const violation = required(overRefusal.violations.at(0), "the question-length violation");
    expect(violation.reason).toBe("question-too-long");
    expect(violation.measured).toBe(501);
    expect(violation.limit).toBe(500);

    const refused = outcomeNamed(await saveCheckIn({ checkInId: drafted.checkInId, questions: [over], answers: ["It went well."] }, drafted.revision), "invalid", "the 501-scalar question");
    const message = required(refused.fields["questions[0].wording"]?.at(0), "the question-length refusal message");
    expect(message).toContain("501");
    expect(message).toContain("500");
    // The accepted question is untouched by the refusal: a refused question is never shortened into place.
    const after = await storedCheckIn(drafted.checkInId);
    expect(required(after.privateDraft?.questions.at(0), "the stored question after the refusal").wording).toBe(atLimit);
  });
});

describe("the answer ceiling", () => {
  it("accepts exactly 4,000 scalars built from astral characters and stores the answer character for character", async () => {
    const answer = codePoints(CHECKIN_MAX_ANSWER_SCALARS);
    // 4,000 astral characters are 8,000 UTF-16 units: an answer within this limit is one a `.length`
    // check would have refused.
    expect(Array.from(answer)).toHaveLength(4000);
    const drafted = await draftWith([answer], ["How did the week go?"]);
    const stored = required(drafted.answers.at(0), "the stored 4,000-scalar answer");
    expect(stored).toBe(answer);
    expect(Array.from(stored)).toHaveLength(4000);
  });

  it("refuses 4,001 scalars with the count shown and writes nothing, rather than truncating the answer to 4,000", async () => {
    const acceptedAnswer = codePoints(CHECKIN_MAX_ANSWER_SCALARS, "a");
    const drafted = await draftWith([acceptedAnswer], ["How did the week go?"]);
    const over = codePoints(CHECKIN_MAX_ANSWER_SCALARS + 1);

    const violations = validateCheckInRequest(modulePayload(["How did the week go?"], [over]));
    expect(violations.map((violation) => violation.reason)).toEqual(["answer-too-long"]);
    const violation = required(violations.at(0), "the answer-length violation");
    expect(violation.measured).toBe(4001);
    expect(violation.limit).toBe(4000);

    const refused = outcomeNamed(await saveCheckIn({ checkInId: drafted.checkInId, questions: ["How did the week go?"], answers: [over] }, drafted.revision), "invalid", "the 4,001-scalar answer");
    const message = required(refused.fields["answers[0].text"]?.at(0), "the answer-length refusal message");
    expect(message).toContain("4001");
    expect(message).toContain("4000");

    // "Never truncated" is the absence of a stored over-limit value, not the length of a shortened one:
    // the record still holds the last accepted answer, and holds nothing resembling the refused text.
    const after = await storedCheckIn(drafted.checkInId);
    expect(after.revision).toBe(drafted.revision);
    const storedText = required(after.privateDraft?.answers.at(0), "the stored answer after the refusal").text;
    expect(storedText).toBe(acceptedAnswer);
    const truncated = Array.from(over).slice(0, CHECKIN_MAX_ANSWER_SCALARS).join("");
    expect(storedText).not.toBe(truncated);
  });
});

describe("the 256 KiB request ceiling", () => {
  it("accepts a request of exactly 256 KiB and refuses one byte more, naming the ceiling and the size", async () => {
    const atLimit = payloadOfBytes(REQUEST_CEILING_BYTES);
    expect(bytesOf(atLimit)).toBe(REQUEST_CEILING_BYTES);
    expect(validateCheckInRequest(atLimit)).toHaveLength(0);

    const drafted = await draftWith(atLimit.answers.map((answer) => answer.text));
    expect(drafted.answers).toEqual(atLimit.answers.map((answer) => answer.text));

    const beforeRefusal = await storedCheckInIds();
    const overLimit = payloadOfBytes(REQUEST_CEILING_BYTES + 1);
    expect(bytesOf(overLimit)).toBe(REQUEST_CEILING_BYTES + 1);
    const violations = validateCheckInRequest(overLimit);
    expect(violations.map((violation) => violation.reason)).toEqual(["request-too-large"]);
    expect(required(violations.at(0), "the request-size violation").measured).toBe(REQUEST_CEILING_BYTES + 1);

    const refused = outcomeNamed(await saveCheckIn({ answers: overLimit.answers.map((answer) => answer.text) }), "invalid", "the 256 KiB + 1 request");
    const message = required(refused.fields.request?.at(0), "the request-size refusal message");
    expect(message).toContain(String(REQUEST_CEILING_BYTES + 1));
    expect(message).toContain(String(REQUEST_CEILING_BYTES));
    // A refused request leaves no partial record: not a check-in, and not a shortened answer.
    expect(await storedCheckInIds()).toEqual(beforeRefusal);
  });

  it("refuses a 4,001-scalar answer by the answer rule, not by the request ceiling", async () => {
    const over = codePoints(CHECKIN_MAX_ANSWER_SCALARS + 1);
    const payload = modulePayload([], [over]);
    // The request is far inside the ceiling, so only the answer rule can refuse it.
    expect(bytesOf(payload)).toBeLessThan(REQUEST_CEILING_BYTES);
    const violations = validateCheckInRequest(payload);
    expect(violations.map((violation) => violation.reason)).toEqual(["answer-too-long"]);

    const refused = outcomeNamed(await saveCheckIn({ answers: [over] }), "invalid", "the 4,001-scalar answer");
    expect(Object.keys(refused.fields)).toEqual(["answers[0].text"]);
  });
});

// The reviewed-summary fixtures, built in the module's own vocabulary
const REVIEWED_FINGERPRINT = "task-fingerprint-as-reviewed";

const REVIEWED_DESCRIPTION = "Review the working list with Jo before the appeal starts";

function modelledShare(overrides: Partial<TaskShare> = {}): TaskShare {
  return {
    shareId: "coaching-task-share-fixture",
    occurrenceId: PLAIN_TASK,
    reviewedSummary: { description: REVIEWED_DESCRIPTION, codePoints: scalarsOf(REVIEWED_DESCRIPTION), reviewedAt: SEEDED_AT },
    reviewedFingerprint: REVIEWED_FINGERPRINT,
    state: "shared",
    revision: 1,
    ...overrides,
  };
}

const SUMMARY_DUE_DATE: TaskSummaryDueDate = { kind: "dated", date: Temporal.PlainDate.from("2026-11-24"), precision: "date" };

function summaryInput(overrides: Partial<SafeTaskSummaryInput> = {}): SafeTaskSummaryInput {
  return {
    state: "shared",
    description: codePoints(TASK_SUMMARY_MAX_CODE_POINTS),
    dueDate: SUMMARY_DUE_DATE,
    status: "open",
    reviewedFingerprint: REVIEWED_FINGERPRINT,
    currentFingerprint: REVIEWED_FINGERPRINT,
    sourceAvailable: true,
    ...overrides,
  };
}

describe("the reviewed safe description", () => {
  it("accepts exactly 240 code points built from astral characters and refuses 241 with the count shown", async () => {
    const atLimit = codePoints(TASK_SUMMARY_MAX_CODE_POINTS);
    expect(Array.from(atLimit)).toHaveLength(240);
    const reviewed = valueOf(reviewTaskSummary(atLimit, SEEDED_AT), "reviewTaskSummary at 240 code points");
    expect(reviewed.codePoints).toBe(240);
    expect(reviewed.description).toBe(atLimit);

    const over = codePoints(TASK_SUMMARY_MAX_CODE_POINTS + 1);
    const refusal = refusalOf(reviewTaskSummary(over, SEEDED_AT), "reviewTaskSummary at 241 code points");
    if (refusal.reason !== "description-too-long") {
      throw new Error(`The 241-code-point description was refused as "${refusal.reason}" instead of by its length`);
    }
    expect(refusal.codePoints).toBe(241);
    expect(refusal.limit).toBe(240);

    // The relationship has to admit the module before the coach read can say anything about summaries.
    outcomeNamed(await setModule("task-summaries", true), "accepted", "enabling the task-summaries module");
    const row = await taskRow(PLAIN_TASK);
    const refused = outcomeNamed(await shareTaskSummary(PLAIN_TASK, over, row.revision), "invalid", "the 241-code-point description");
    const message = required(refused.fields.safeDescription?.at(0), "the description-length refusal message");
    expect(message).toContain("241");
    expect(message).toContain("240");

    const summaries = summariesModuleOf(await coachSubject());
    if (summaries === undefined) {
      throw new Error("The coach read admitted no task-summaries module, so nothing can be asserted about what it shows");
    }
    // A refused description shares nothing: the coach reads an empty list, not a shortened description.
    expect(summaries.summaries).toHaveLength(0);
  });

  it("carries the reviewed description with the live due date and status, and nothing else of the task", () => {
    const summary = valueOf(safeTaskSummary(summaryInput()), "safeTaskSummary");
    if (summary.state !== "shared") {
      throw new Error(`A summary whose reviewed wording still stands was withheld as "${summary.state}"`);
    }
    expect(summary.description).toBe(codePoints(TASK_SUMMARY_MAX_CODE_POINTS));
    expect(summary.dueDate).toEqual(SUMMARY_DUE_DATE);
    expect(summary.status).toBe("open");
    // The shape is the whole of what a coach may read, so the field list is asserted rather than sampled.
    expect(Object.keys(summary).sort()).toEqual(["description", "dueDate", "state", "status"]);
    const withheld: readonly string[] = [
      "title",
      "body",
      "note",
      "donor",
      "donorId",
      "amount",
      "money",
      "attachment",
      "attachmentId",
      "source",
      "sourceReference",
      "link",
      "url",
      "history",
      "privateHistory",
      "partnerId",
      "taskId",
    ];
    for (const field of withheld) {
      expect(field in summary).toBe(false);
    }
  });

  it("withholds the summary once the task's reviewed meaning changes, and returns it only on a fresh review", () => {
    const reviewed = summaryInput();
    expect(valueOf(safeTaskSummary(reviewed), "safeTaskSummary before the change").state).toBe("shared");

    const changed = valueOf(safeTaskSummary({ ...reviewed, currentFingerprint: `${REVIEWED_FINGERPRINT}-rewritten` }), "safeTaskSummary after the change");
    expect(changed.state).toBe("needs-review");
    expect(Object.keys(changed)).toEqual(["state"]);

    // A share whose reviewed or current fingerprint is missing has not been reviewed at all, which is a
    // refusal rather than a withheld summary: those are different facts and a surface says which it has.
    expect(refusalOf(safeTaskSummary({ ...reviewed, reviewedFingerprint: undefined }), "safeTaskSummary without a review").reason).toBe("not-reviewed");

    const reReviewed = valueOf(
      safeTaskSummary({
        ...reviewed,
        description: "A shorter description reviewed against the new wording",
        reviewedFingerprint: `${REVIEWED_FINGERPRINT}-rewritten`,
        currentFingerprint: `${REVIEWED_FINGERPRINT}-rewritten`,
      }),
      "safeTaskSummary reviewed again",
    );
    expect(reReviewed.state).toBe("shared");

    const shared = modelledShare();
    const states = [
      taskShareReadState({ share: shared, currentFingerprint: REVIEWED_FINGERPRINT, sourceAvailable: true }),
      taskShareReadState({ share: shared, currentFingerprint: `${REVIEWED_FINGERPRINT}-rewritten`, sourceAvailable: true }),
      taskShareReadState({ share: { ...shared, state: "removed" }, currentFingerprint: REVIEWED_FINGERPRINT, sourceAvailable: true }),
      taskShareReadState({ share: shared, currentFingerprint: REVIEWED_FINGERPRINT, sourceAvailable: false }),
    ];
    expect(states).toEqual(["shared", "needs-review", "removed", "unavailable"]);
    expect(new Set(states).size).toBe(4);
  });

  it("requires a fresh selection for a recurring successor, never the predecessor's description", async () => {
    const share = modelledShare();
    const refused = refusalOf(
      selectSuccessorForSharing({ share, occurrenceId: "occurrence-next-week", selectedOccurrenceId: undefined, expectedRevision: share.revision }),
      "a successor the worker never selected",
    );
    expect(refused.reason).toBe("successor-needs-fresh-selection");
    const selected = valueOf(
      selectSuccessorForSharing({ share, occurrenceId: "occurrence-next-week", selectedOccurrenceId: "occurrence-next-week", expectedRevision: share.revision }),
      "a successor the worker selected",
    );
    expect(selected.occurrenceId).toBe("occurrence-next-week");

    // The service refuses a recurring task's share until the occurrence it covers is named.
    const row = await taskRow(RECURRING_TASK);
    expect(row.seriesId).not.toBeNull();
    const serviceRefusal = outcomeNamed(await shareTaskSummary(RECURRING_TASK, REVIEWED_DESCRIPTION, row.revision), "invalid", "the recurring task's share");
    expect(Object.keys(serviceRefusal.fields)).toEqual(["occurrenceId"]);
  });

  it("stops sharing a summary without changing the task, and the summary leaves the coach read", async () => {
    outcomeNamed(await setModule("task-summaries", true), "accepted", "enabling the task-summaries module");
    const description = codePoints(TASK_SUMMARY_MAX_CODE_POINTS);
    const row = await taskRow(PLAIN_TASK);
    const shared = outcomeNamed(await shareTaskSummary(PLAIN_TASK, description, row.revision), "accepted", "shareTaskSummary");
    const shareId = firstCreated(shared, "shareTaskSummary");

    const admitted = summariesModuleOf(await coachSubject());
    if (admitted === undefined) {
      throw new Error("The coach read admitted no task-summaries module, so nothing can be asserted about the summary");
    }
    const visible = required(
      admitted.summaries.find((summary) => summary.shareId === shareId),
      "the shared summary in the coach read",
    );
    expect(visible.state).toBe("shared");
    expect(visible.description).toBe(description);
    expect(visible.status).toBe(row.status);
    expect(visible.dueDate).toEqual({ kind: "dated", date: required(row.dueOn, "the task's due date"), precision: "date" });

    // The task's reviewed meaning changes, so the summary is withheld rather than shown against the new wording.
    const editedRow = outcomeNamed(
      await mutations.work.editTask(attempt({ taskId: PLAIN_TASK, title: "Follow up with Jo about the visit and the appeal" }, row.revision), { sessionId: WORKER_SESSION }),
      "accepted",
      "editTask",
    );
    expect(editedRow.revision).not.toBe(row.revision);
    const withheld = required(
      summariesModuleOf(await coachSubject())?.summaries.find((summary) => summary.shareId === shareId),
      "the withheld summary in the coach read",
    );
    expect(withheld.state).toBe("needs-review");
    expect(withheld.description).toBeNull();

    const beforeStop = await taskRow(PLAIN_TASK);
    outcomeNamed(await stopTaskShare(shareId, shared.revision), "accepted", "stopTaskShare");
    const afterStop = summariesModuleOf(await coachSubject());
    expect(afterStop?.summaries.some((summary) => summary.shareId === shareId)).toBe(false);

    // Stopping the share leaves the task itself exactly as it was.
    const surviving = await taskRow(PLAIN_TASK);
    expect(surviving.title).toBe(beforeStop.title);
    expect(surviving.status).toBe(beforeStop.status);
    expect(surviving.dueOn).toBe(beforeStop.dueOn);
    expect(surviving.revision).toBe(beforeStop.revision);
  });
});

describe("the private draft and the shared revision", () => {
  it("keeps them as two different identities, and changes the shared one only on an explicit update", async () => {
    const draftText = "Two good conversations and one difficult one.";
    const drafted = await draftWith([draftText]);
    const firstSave = await storedCheckIn(drafted.checkInId);
    const privateRevisionId = required(firstSave.privateDraft?.revisionId, "the private draft's revision id");
    expect(firstSave.shared).toBeNull();

    const shared = outcomeNamed(await shareCheckIn(drafted.checkInId, drafted.revision), "accepted", "shareCheckIn");
    const afterShare = await storedCheckIn(drafted.checkInId);
    const sharedRevisionId = required(afterShare.shared?.revisionId, "the shared revision id");
    expect(sharedRevisionId).not.toBe(privateRevisionId);
    expect(afterShare.privateDraft?.revisionId).toBe(privateRevisionId);

    // The coach reads the shared revision; the private draft is not part of what a share publishes.
    const admissions = checkInsModuleOf(await coachSubject());
    if (admissions === undefined) {
      throw new Error("The coach read admitted no check-ins module, so nothing can be asserted about the shared revision");
    }
    const readable = required(
      admissions.sharedCheckIns.find((checkIn) => checkIn.revisionId === sharedRevisionId),
      "the shared check-in in the coach read",
    );
    expect(readable.answers.map((answer) => answer.text)).toEqual([draftText]);
    // The private draft is not one of the revisions a coach may read, not even as an empty entry.
    expect(admissions.sharedCheckIns.some((checkIn) => checkIn.revisionId === privateRevisionId)).toBe(false);

    // Only an explicit update changes the shared revision, and it leaves the private draft where it was.
    const updatedText = "Three good conversations, and the difficult one is planned for Tuesday.";
    const updated = outcomeNamed(await updateSharedCheckIn(drafted.checkInId, [updatedText], shared.revision), "accepted", "updateSharedCheckIn");
    expect(updated.revision).not.toBe(shared.revision);
    const afterUpdate = await storedCheckIn(drafted.checkInId);
    const changedShared = required(afterUpdate.shared, "the shared revision after the update");
    // The shared revision is one slot whose identity a coach's entitlement names, so an update replaces
    // its answers and advances the check-in's own revision rather than minting a second shared revision
    // beside it. What a coach reads is therefore always the one revision this worker shares.
    expect(changedShared.revisionId).toBe(sharedRevisionId);
    expect(changedShared.answers.map((answer) => answer.text)).toEqual([updatedText]);
    expect(afterUpdate.privateDraft?.revisionId).toBe(privateRevisionId);
    expect(afterUpdate.privateDraft?.answers.map((answer) => answer.text)).toEqual([draftText]);

    // A private autosave is the worker's own work: it moves the draft and leaves the shared revision as it stands.
    const privateText = "My own preparation: ask about the appeal on Tuesday.";
    outcomeNamed(await saveCheckIn({ checkInId: drafted.checkInId, answers: [privateText] }, updated.revision), "accepted", "the private autosave");
    const afterPrivateSave = await storedCheckIn(drafted.checkInId);
    expect(afterPrivateSave.shared?.revisionId).toBe(sharedRevisionId);
    expect(afterPrivateSave.shared?.answers.map((answer) => answer.text)).toEqual([updatedText]);
    expect(afterPrivateSave.privateDraft?.revisionId).not.toBe(privateRevisionId);
    expect(afterPrivateSave.privateDraft?.answers.map((answer) => answer.text)).toEqual([privateText]);

    const stillReadable = required(
      checkInsModuleOf(await coachSubject())?.sharedCheckIns.find((checkIn) => checkIn.revisionId === sharedRevisionId),
      "the shared check-in after a private save",
    );
    expect(stillReadable.answers.map((answer) => answer.text)).toEqual([updatedText]);
    expect(stillReadable.answers.map((answer) => answer.text)).not.toContain(privateText);
  });

  it("keeps private draft, shared revision and withdrawn as three distinct states", () => {
    const opened: CheckIn = { checkInId: "check-in-state-vocabulary", revision: 0 };
    const drafted = valueOf(savePrivateDraft(opened, modulePayload([], ["Two good conversations."]), 0, SEEDED_AT), "savePrivateDraft");
    const shared = valueOf(openSharedCheckIn(drafted.checkIn, drafted.checkIn.revision, [SEEDED_PERSONAS.coach.principalId], { kind: "ongoing" }, SEEDED_AT), "shareCheckIn");
    const withdrawn = valueOf(withdrawSharedCheckIn(shared.checkIn, shared.checkIn.revision, SEEDED_AT), "withdrawSharedCheckIn");
    const states = [checkInReadState(drafted.checkIn, "available"), checkInReadState(shared.checkIn, "available"), checkInReadState(withdrawn.checkIn, "available")];
    expect(states).toEqual(["private-draft", "shared", "withdrawn"]);
    expect(new Set(states).size).toBe(3);
    // A record that could not be read at all is its own state, never an empty check-in.
    expect(checkInReadState(drafted.checkIn, "unavailable")).toBe("unavailable");
  });
});

/** Returns the worker's session to the seeded world between the acts that each close one relationship. */
async function freshWorld(): Promise<void> {
  await layDownWorkerWorld();
  scope = await scopeOf(WORKER);
}

async function storedGrantState(): Promise<string> {
  const grant = (await storedState()).coachingGrants.find((candidate) => candidate.grantId === ACTIVE_GRANT);
  return required(grant, "the relationship the case closed").state;
}

async function coachGrantState(): Promise<string> {
  const documents = await readSession(COACH_SESSION);
  if (documents === undefined) {
    throw new Error(`The session "${COACH_SESSION}" holds no documents, so the coach's own act cannot be read back`);
  }
  const grant = (documents.state as SessionStateDocument).coachingGrants.find((candidate) => candidate.grantId === ACTIVE_GRANT);
  return required(grant, "the relationship the coach left").state;
}

describe("withdrawal and the stop-type effects", () => {
  it("withdraws a shared check-in while an unrelated draft is invalid, and contains it from the coach read", async () => {
    const drafted = await draftWith(["A short answer."]);
    const shared = outcomeNamed(await shareCheckIn(drafted.checkInId, drafted.revision), "accepted", "shareCheckIn");
    const beforeWithdrawal = await storedCheckIn(drafted.checkInId);
    const privateRevisionId = required(beforeWithdrawal.privateDraft?.revisionId, "the private draft's revision id");
    const sharedRevisionId = required(beforeWithdrawal.shared?.revisionId, "the shared revision id");

    // Two unrelated drafts are invalid: an over-limit answer in another check-in, and an over-limit shared
    // description. Neither was stored, and neither is a precondition for withdrawing the shared revision.
    outcomeNamed(await saveCheckIn({ answers: [codePoints(CHECKIN_MAX_ANSWER_SCALARS + 1)] }), "invalid", "the over-limit check-in draft");
    outcomeNamed(await shareTaskSummary(PLAIN_TASK, codePoints(TASK_SUMMARY_MAX_CODE_POINTS + 1), (await taskRow(PLAIN_TASK)).revision), "invalid", "the over-limit description");

    // Withdrawal is a containment act: like Stop showing me publicly, it never waits for another draft to
    // be clean, because waiting would leave the shared text readable while the worker fixes something else.
    const withdrawn = outcomeNamed(await withdrawCheckIn(drafted.checkInId, shared.revision), "accepted", "withdrawCheckIn");
    expect(withdrawn.revision).not.toBe(shared.revision);

    const afterWithdrawal = await storedCheckIn(drafted.checkInId);
    expect(required(afterWithdrawal.shared, "the withdrawn shared revision").withdrawnAt).toBe(SEEDED_AT.toString());
    // The worker's own record survives the withdrawal: withdrawal ends access, it does not delete work.
    expect(afterWithdrawal.privateDraft?.revisionId).toBe(privateRevisionId);
    expect(afterWithdrawal.privateDraft?.answers.map((answer) => answer.text)).toEqual(["A short answer."]);

    const admissions = checkInsModuleOf(await coachSubject());
    if (admissions === undefined) {
      throw new Error("The coach read admitted no check-ins module, so nothing can be asserted about the withdrawal");
    }
    expect(admissions.sharedCheckIns.some((checkIn) => checkIn.revisionId === sharedRevisionId)).toBe(false);
    // The read still works: the seeded check-in that was not withdrawn is still listed beside it.
    expect(admissions.sharedCheckIns.some((checkIn) => checkIn.revisionId === "check-in-week-46-shared-1")).toBe(true);
  });

  it("keeps the six stop-type effects distinct", async () => {
    const effects: string[] = [];

    // A stopped module leaves the coach's admitted set altogether: it is not partial, empty or unavailable.
    await freshWorld();
    const enabled = outcomeNamed(await setModule("task-summaries", true), "accepted", "enabling a module");
    outcomeNamed(await setModule("task-summaries", false, enabled.revision), "accepted", "stopping a module");
    expect(summariesModuleOf(await coachSubject())).toBeUndefined();
    effects.push("not-admitted");

    // A withdrawn check-in keeps its shared revision on record and leaves a coach's read.
    const opened: CheckIn = { checkInId: "check-in-stop-effect", revision: 0 };
    const drafted = valueOf(savePrivateDraft(opened, modulePayload([], ["A short answer."]), 0, SEEDED_AT), "savePrivateDraft");
    const shared = valueOf(openSharedCheckIn(drafted.checkIn, drafted.checkIn.revision, [SEEDED_PERSONAS.coach.principalId], { kind: "ongoing" }, SEEDED_AT), "shareCheckIn");
    effects.push(checkInReadState(valueOf(withdrawSharedCheckIn(shared.checkIn, shared.checkIn.revision, SEEDED_AT), "withdrawSharedCheckIn").checkIn, "available"));

    // A removed task share takes the summary away and leaves the task.
    const removedShare = valueOf(stopModelledTaskShare({ share: modelledShare(), expectedRevision: 1 }, SEEDED_AT), "stopTaskShare");
    effects.push(taskShareReadState({ share: removedShare, currentFingerprint: REVIEWED_FINGERPRINT, sourceAvailable: true }));

    // The worker ends the relationship.
    await freshWorld();
    outcomeNamed(await mutations.coaching.endCoaching(attempt({ grantId: ACTIVE_GRANT }, FIRST_REVISION), WORKER), "accepted", "endCoaching");
    effects.push(await storedGrantState());

    // The coach leaves it, which is the second and last write the coach identity holds.
    await freshWorld();
    const coach = await coachSubject();
    outcomeNamed(
      await mutations.coach.leaveCoaching({ operationId: newOperationId(), scope: coach.scope, expectedRevision: FIRST_REVISION, payload: { grantId: ACTIVE_GRANT } }, COACH),
      "accepted",
      "leaveCoaching",
    );
    effects.push(await coachGrantState());

    // The worker revokes the sharing, which is its own act and not an ending.
    await freshWorld();
    outcomeNamed(await mutations.coaching.revokeGrant(attempt({ grantId: ACTIVE_GRANT }, FIRST_REVISION), WORKER), "accepted", "revokeGrant");
    effects.push(await storedGrantState());

    expect(effects).toHaveLength(6);
    expect(new Set(effects).size).toBe(6);
    expect(effects).toEqual(["not-admitted", "withdrawn", "removed", "ended", "left", "revoked"]);
  });
});
// The seeded target, in the domain module's own shapes
function targetPeriodOf(record: CoachingTargetRecord): TargetPeriod {
  const { period } = record;
  switch (period.kind) {
    case "weekly":
      return { kind: "weekly" };
    case "monthly":
      return { kind: "monthly" };
    case "custom":
      return {
        kind: "custom",
        start: Temporal.PlainDate.from(required(period.from ?? undefined, "the custom period's first day")),
        end: Temporal.PlainDate.from(required(period.to ?? undefined, "the custom period's last day")),
      };
    default:
      throw new Error(`The stored target period "${String(period.kind)}" is not one this file converts`);
  }
}

function anchorOf(record: CoachingTargetRecord): PeriodAnchor {
  return { period: targetPeriodOf(record), calendarStart: Temporal.PlainDate.from(record.calendarStart) };
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
    period: targetPeriodOf(record),
    calendarStart: Temporal.PlainDate.from(record.calendarStart),
    homePlacement: record.homePlacement,
    state: record.state,
    versions: versionsOf(record),
  };
}

function weekOf(anchor: PeriodAnchor, day: Temporal.PlainDate): ResolvedPeriod {
  const period = resolvePeriodContaining(anchor, day);
  if (!period.ok) {
    throw new Error(`The period containing ${day.toString()} did not resolve: ${period.error}`);
  }
  return period.value;
}

describe("a closed target period", () => {
  it("still renders against the version it was measured against after the quantity changes", () => {
    const record = required(
      world.worker.state.coachingTargets.find((target) => target.targetId === "target-conversations-weekly"),
      "the seeded conversations target",
    );
    const anchor = anchorOf(record);
    const versions = versionsOf(record);
    const closedWeek = weekOf(anchor, Temporal.PlainDate.from("2026-11-05"));
    const measuredUnder = valueOf(resolveTargetVersion(versions, closedWeek), "resolveTargetVersion for the closed week");
    const before = workerTargetProgress({ target: targetRecordOf(record), version: measuredUnder, period: closedWeek, count: 2 });

    const change: TargetVersionChange = {
      revisionId: "target-conversations-weekly-3",
      quantity: 7,
      measure: "conversations",
      calendarStart: anchor.calendarStart,
    };
    const next = valueOf(startProspectiveVersion({ versions, anchor, change, effectiveFrom: Temporal.PlainDate.from("2026-11-16") }), "startProspectiveVersion");

    // `coaching-grant.test.ts` asserts the version history's adjacency — no gap and no overlap between the
    // prospective versions. This file asserts the same rule from the rendering side: the closed week still
    // resolves and renders against the plan it was measured against, so a later quantity never rewrites it.
    const after = workerTargetProgress({
      target: targetRecordOf(record),
      version: valueOf(resolveTargetVersion(next, closedWeek), "resolveTargetVersion for the closed week after the change"),
      period: closedWeek,
      count: 2,
    });
    expect(after.revisionId).toBe(before.revisionId);
    expect(after.quantity).toBe(before.quantity);

    // The change did take effect: the week that is still open renders the new plan.
    const openWeek = weekOf(anchor, Temporal.PlainDate.from("2026-11-19"));
    const openUnder = valueOf(resolveTargetVersion(next, openWeek), "resolveTargetVersion for the open week");
    expect(workerTargetProgress({ target: targetRecordOf(record), version: openUnder, period: openWeek, count: 2 }).quantity).toBe(7);
  });
});
