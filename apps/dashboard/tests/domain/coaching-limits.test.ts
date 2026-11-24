/** The limits and revision identity of the coaching share surfaces — success criterion 16's final clause, "check-in limits are enforced without truncation". */ import { Temporal } from "temporal-polyfill";
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
import { TASK_SUMMARY_MAX_CODE_POINTS, reviewTaskSummary, safeTaskSummary, selectSuccessorForSharing, stopTaskShare as stopModelledTaskShare, taskShareReadState, type SafeTaskSummaryInput, type TaskShare, type TaskSummaryDueDate } from "@/modules/coaching/taskshare";
import { resolveTargetVersion, startProspectiveVersion, workerTargetProgress, type TargetVersionChange } from "@/modules/coaching/target";
import { mutations, reads, type CoachingCheckInRecord, type Scope } from "@/modules/data-service";
import type { SessionSource } from "@/modules/data-service/authorize";
import { isOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { DEFAULT_SESSION_ID, SEEDED_PERSONAS, seed, type SeededSessionDocuments, type SeededSessionWithDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { readSession, resetSession } from "@/modules/store/repository";
import { expectEnvelope, firstSaying, firstWhere, requiredSaying, throwing } from "../helpers/answers";
import { anchorOf, scopeOf, sessionOf, targetRecordOf, versionsOf, weekOf } from "../helpers/fixtures";
const WORKER_SESSION = "domain-coaching-limits";
const COACH_SESSION = "domain-coaching-limits-coach";
const PAGING_SESSION = `${WORKER_SESSION}-paging`;
const WORKER: SessionSource = { sessionId: WORKER_SESSION };
const COACH: SessionSource = { sessionId: COACH_SESSION };
const PAGING: SessionSource = { sessionId: PAGING_SESSION };
const ACTIVE_GRANT = "grant-established-coach";
/** A task that does not recur, so its one occurrence is the task itself. */ const PLAIN_TASK = "task-care-jo";
const RECURRING_TASK = "task-series-weekly-call";
const FIRST_REVISION = "rev-1";
/** The display zone the task list is read in; it is stated rather than assumed, as every zone is. */ const DISPLAY_ZONE = "Europe/London";
/** The seed's own instant (2026-11-20T00:00:00Z), stated here so this file reads no clock. */ const SEEDED_AT = Temporal.Instant.from("2026-11-20T00:00:00Z");
const REQUEST_CEILING_BYTES = 262_144;
/** AAP 0.8.7's coaching list page size: 25 rows by default, clamped to 100 at most. */ const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_CAP = 100;
type Ok<T> = { readonly ok: true; readonly value: T };
type Refused<E> = { readonly ok: false; readonly error: E };
const valueOf = <T, E>(result: Ok<T> | Refused<E>, what: string): T => (result.ok ? result.value : throwing(`${what} was refused: ${JSON.stringify(result.error)}`));
const refusalOf = <T, E>(result: Ok<T> | Refused<E>, what: string): E => (result.ok ? throwing(`${what} was accepted, and this case needs the refusal it should have received`) : result.error);
const required = <T>(value: T | null | undefined, what: string): T => (value === null || value === undefined ? throwing(`${what} is missing, so this case has nothing to assert against`) : value);
const scalarsOf = (text: string): number => Array.from(text).reduce((total) => total + 1, 0);
function codePoints(count: number, character = "\u{1D4B3}"): string {
  const text = character.repeat(count);
  const units = text.length;
  if (scalarsOf(text) !== count) throw new RangeError(`codePoints(${String(count)}) built ${String(scalarsOf(text))} code points`);
  // `"𝒳".length` is 2, so an astral string's length is twice its code points: a limit measured in `.length` would refuse a value that a scalar-counted limit accepts.
  if (character.length > 1 && units !== count * character.length) throw new RangeError(`codePoints(${String(count)}) built ${String(units)} UTF-16 units, not ${String(count * character.length)}`);
  return text;
}
const bytesOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function payloadOfBytes(targetBytes: number): CheckInPayload {
  const texts: string[] = [];
  const payloadWith = (candidate: readonly string[]): CheckInPayload => ({ questions: [], answers: candidate.map((text) => ({ questionOrder: null, text })) });
  while (bytesOf(payloadWith(texts)) < targetBytes) {
    const current = bytesOf(payloadWith(texts));
    const overhead = bytesOf(payloadWith([...texts, ""])) - current;
    const shortfall = targetBytes - current;
    if (shortfall <= overhead) throw new RangeError(`A ${String(targetBytes)}-byte payload cannot be built from whole answers`);
    texts.push(codePoints(Math.min(CHECKIN_MAX_ANSWER_SCALARS, shortfall - overhead), "a"));
  }
  const payload = payloadWith(texts);
  if (bytesOf(payload) !== targetBytes) throw new RangeError(`The payload is ${String(bytesOf(payload))} bytes, not ${String(targetBytes)}`);
  return payload;
}
let world: { readonly worker: SeededSessionDocuments; readonly coach: SeededSessionDocuments };
let scope: Scope;
const documentsOf = (sessions: readonly SeededSessionWithDocuments[], sessionId: string): SeededSessionDocuments => firstSaying(sessions, "sessionId", sessionId, `The seed lays down no "${sessionId}" session, so this file has no world to start from`).documents;
async function layDownWorkerWorld(): Promise<void> {
  const { state, operations, meta } = world.worker;
  await resetSession(WORKER_SESSION, {
    meta,
    operations,
    state: { ...state, context: { ...state.context, sessionId: WORKER_SESSION } }, // A record set states the session that owns it, so the private session's own id is written into the document it holds rather than naming a session that is not the one reading it.
  });
}
const storedState = async (): Promise<SessionStateDocument> => requiredSaying(await readSession(WORKER_SESSION), `The session "${WORKER_SESSION}" holds no documents, so nothing it accepted can be read back`).state as SessionStateDocument;
const storedCheckIn = async (checkInId: string): Promise<CoachingCheckInRecord> => firstSaying((await storedState()).coachingCheckIns, "checkInId", checkInId, `The session holds no check-in "${checkInId}"`);
const storedCheckInIds = async (): Promise<readonly string[]> => (await storedState()).coachingCheckIns.map((checkIn) => checkIn.checkInId);
type OutcomeNamed<K extends MutationOutcome["outcome"]> = Extract<MutationOutcome, { readonly outcome: K }>;
function outcomeNamed<K extends MutationOutcome["outcome"]>(outcome: MutationOutcome, name: K, what: string): OutcomeNamed<K> {
  if (!isOutcome(outcome) || outcome.outcome !== name) throw new Error(`${what} answered ${JSON.stringify(outcome)} instead of "${name}"`); // The guard is asked as well as the discriminant, so a value that reached this test through JSON is narrowed by the same check the Route Handlers use rather than by a cast.
  return outcome as OutcomeNamed<K>;
}
const firstCreated = (outcome: { readonly created?: readonly string[] }, what: string): string => required(outcome.created?.at(0), `${what}'s created identifier`);
type CheckInAttempt<P> = { readonly operationId: string; readonly scope: Scope; readonly expectedRevision: string; readonly payload: P };
const attempt = <P>(payload: P, expectedRevision: string): CheckInAttempt<P> => ({ operationId: newOperationId(), scope, expectedRevision, payload });
const saveCheckIn = async (payload: { readonly checkInId?: string; readonly questions?: readonly string[]; readonly answers: readonly string[] }, expectedRevision: string = FIRST_REVISION): Promise<MutationOutcome> =>
  mutations.coaching.saveCheckIn(attempt({ ...(payload.checkInId === undefined ? {} : { checkInId: payload.checkInId }), ...(payload.questions === undefined ? {} : { questions: [...payload.questions] }), answers: [...payload.answers] }, expectedRevision), WORKER);
const shareCheckIn = async (checkInId: string, expectedRevision: string): Promise<MutationOutcome> => mutations.coaching.shareCheckIn(attempt({ checkInId }, expectedRevision), WORKER);
const updateSharedCheckIn = async (checkInId: string, answers: readonly string[], expectedRevision: string): Promise<MutationOutcome> => mutations.coaching.updateSharedCheckIn(attempt({ checkInId, answers: [...answers] }, expectedRevision), WORKER);
const withdrawCheckIn = async (checkInId: string, expectedRevision: string): Promise<MutationOutcome> => mutations.coaching.withdrawCheckIn(attempt({ checkInId }, expectedRevision), WORKER);
const setModule = async (moduleKey: "task-summaries" | "check-ins", enabled: boolean, expectedRevision: string = FIRST_REVISION): Promise<MutationOutcome> => mutations.coaching.setModule(attempt({ grantId: ACTIVE_GRANT, moduleKey, enabled }, expectedRevision), WORKER);
const shareTaskSummary = async (taskId: string, safeDescription: string, expectedRevision: string): Promise<MutationOutcome> => mutations.coaching.shareTaskSummary(attempt({ taskId, safeDescription }, expectedRevision), WORKER);
const stopTaskShare = async (shareId: string, expectedRevision: string): Promise<MutationOutcome> => mutations.coaching.stopTaskShare(attempt({ shareId }, expectedRevision), WORKER);
/** A check-in whose answers are already stored, so a later case has a last-accepted value to compare against. */ type StoredDraft = { readonly checkInId: string; readonly revision: string; readonly answers: readonly string[] };
async function draftWith(answers: readonly string[], questions: readonly string[] = []): Promise<StoredDraft> {
  const accepted = outcomeNamed(await saveCheckIn({ ...(questions.at(0) === undefined ? {} : { questions }), answers }), "accepted", "saveCheckIn");
  const checkInId = firstCreated(accepted, "saveCheckIn");
  const stored = await storedCheckIn(checkInId);
  const draft = stored.privateDraft;
  if (draft === null) throw new Error(`The check-in "${checkInId}" was accepted with no private draft, so nothing can be compared`);
  return { checkInId, revision: accepted.revision, answers: draft.answers.map((answer) => answer.text) };
}
type CoachReadResult = Awaited<ReturnType<typeof reads.coach.readCoachSubject>>;
type CoachEnvelope = Extract<CoachReadResult, { readonly kind: "envelope" }>["envelope"];
type CoachModule = CoachEnvelope["data"]["modules"][number];
type CheckInsModule = Extract<CoachModule, { readonly module: "check-ins" }>;
type SummariesModule = Extract<CoachModule, { readonly module: "task-summaries" }>;
async function coachSubject(): Promise<CoachEnvelope> {
  // The coach's seat names this file's own worker session as the world its coaching records live in, and carries no coaching family of its own: a read through it therefore proves the worker's accepted writes are the ones a coach sees.
  await resetSession(COACH_SESSION, { meta: { ...world.coach.meta, coachingRecordsSessionId: WORKER_SESSION }, operations: world.coach.operations, state: world.coach.state });
  const result = expectEnvelope(await reads.coach.readCoachSubject({ grantId: ACTIVE_GRANT }, COACH), "the coach's subject read");
  return result;
}
const checkInsModuleOf = (envelope: CoachEnvelope): CheckInsModule | undefined => envelope.data.modules.find((view): view is CheckInsModule => view.module === "check-ins");
const summariesModuleOf = (envelope: CoachEnvelope): SummariesModule | undefined => envelope.data.modules.find((view): view is SummariesModule => view.module === "task-summaries");
type TaskListData = Extract<Awaited<ReturnType<typeof reads.work.listTasks>>, { readonly kind: "envelope" }>["envelope"]["data"];
type TaskRow = TaskListData["tasks"][number];
async function taskRow(taskId: string): Promise<TaskRow> {
  const result = expectEnvelope(await reads.work.listTasks({ list: "all", displayTimeZone: DISPLAY_ZONE }, WORKER), "the task list");
  const row = firstSaying(result.data.tasks, "taskId", taskId, `The task list holds no task "${taskId}"`);
  return row;
}
beforeAll(async () => {
  const sessions = await seed();
  world = { worker: documentsOf(sessions, DEFAULT_SESSION_ID), coach: documentsOf(sessions, "coach") };
});
beforeEach(async () => {
  await layDownWorkerWorld();
  scope = await scopeOf(WORKER);
});
afterAll(async () => {
  for (const sessionId of [WORKER_SESSION, COACH_SESSION, PAGING_SESSION]) await resetSession(sessionId); // Every session this file writes is its own, so the store is left holding none of its fixtures.
});
const questionsOf = (wordings: readonly string[]): readonly CheckInQuestion[] => wordings.map((wording, order) => ({ wording, order }));
const modulePayload = (questions: readonly string[], answers: readonly string[]): CheckInPayload => ({ questions: questions.map((wording, index) => ({ wording, order: index })), answers: answers.map((text, index) => ({ questionOrder: questions.at(0) === undefined ? null : index, text })) });
it("the limits the release fixes: states the five fixed limits in code points and bytes", () => {
  expect([CHECKIN_MAX_QUESTIONS, CHECKIN_MAX_QUESTION_SCALARS, CHECKIN_MAX_ANSWER_SCALARS]).toEqual([5, 500, 4000]);
  expect([CHECKIN_MAX_REQUEST_BYTES, TASK_SUMMARY_MAX_CODE_POINTS]).toEqual([REQUEST_CEILING_BYTES, 240]); // 256 KiB, the ceiling measured on the serialised request rather than on an answer.
});
type TargetsData = Extract<Awaited<ReturnType<typeof reads.coaching.readTargets>>, { readonly kind: "envelope" }>["envelope"]["data"];
async function layDownPagingWorld(): Promise<void> {
  const { state, operations, meta } = world.worker;
  const shape = required(state.coachingTargets.at(0), "the seeded target the paging history repeats");
  const eligible = state.coachingTargets.filter((record) => record.workerPrincipalId === shape.workerPrincipalId).length;
  const clones = Array.from({ length: Math.max(0, 103 - eligible) }, (_, index) => ({ ...shape, targetId: `${shape.targetId}-paging-${String(index)}`, versions: shape.versions.map((version) => ({ ...version, revisionId: `${version.revisionId}-paging-${String(index)}` })) }));
  await resetSession(PAGING_SESSION, {
    meta,
    operations,
    state: { ...state, context: { ...state.context, sessionId: PAGING_SESSION }, coachingTargets: [...state.coachingTargets, ...clones] }, // As in the worker's session, the record set states the session that owns it rather than naming another.
  });
}
async function pagingHistory(): Promise<readonly string[]> {
  const resolution = await sessionOf(PAGING);
  const documents = requiredSaying(await readSession(PAGING_SESSION), `The session "${PAGING_SESSION}" holds no documents, so it holds no history to page`);
  const { coachingTargets } = documents.state as SessionStateDocument;
  const history = coachingTargets.filter((record) => record.workerPrincipalId === resolution.principalId);
  return history.map((record) => record.targetId);
}
async function pagingPage(query: { readonly page?: number; readonly pageSize?: number }): Promise<TargetsData> {
  return expectEnvelope(await reads.coaching.readTargets(query, PAGING), "the targets read").data;
}
/** AAP 0.8.7 fixes the coaching list page size at 25 rows by default with a 100-row cap, and states that "eligible history is never truncated by the cap"; that is the value Criterion 16 rests on. */ describe("the list page size", () => {
  beforeAll(async () => await layDownPagingWorld());
  it("pages 25 rows by default, clamps a larger request to 100, and loses no target to the cap", async () => {
    const history = await pagingHistory();
    expect(history.length).toBeGreaterThan(PAGE_SIZE_CAP); // The history has to cross both bounds for either clause to mean anything: past the 25-row default, and past the 100-row cap, so the capped request is answered with a full page of the same history.
    expect(new Set(history).size).toBe(history.length);
    const first = await pagingPage({}); // The default: 25 rows, the cap named at 100, and a total that counts the whole eligible history rather than the page in hand. AAP 0.8.7 fixes the 25 and the 100.
    expect([first.page.index, first.page.size, first.targets.length, first.page.cappedAt, first.page.total, first.page.totalPages]).toEqual([0, PAGE_SIZE_DEFAULT, PAGE_SIZE_DEFAULT, PAGE_SIZE_CAP, history.length, Math.ceil(history.length / PAGE_SIZE_DEFAULT)]);
    expect(new Set(first.targets.map((target) => target.targetId)).size).toBe(PAGE_SIZE_DEFAULT);
    const capped = await pagingPage({ pageSize: 500 });
    expect([capped.page.size, capped.targets.length, capped.page.total, capped.page.totalPages]).toEqual([PAGE_SIZE_CAP, PAGE_SIZE_CAP, history.length, Math.ceil(history.length / PAGE_SIZE_CAP)]);
    const walked: string[] = []; // The history: walking every index the default size produces yields each eligible target exactly once, with none missing, so nothing falls off the end of the list however long it grows.
    for (let index = 0; index < first.page.totalPages; index += 1) {
      const page = await pagingPage({ page: index });
      walked.push(...page.targets.map((target) => target.targetId));
    }
    expect([[walked.length, new Set(walked).size], new Set(walked)]).toEqual([[history.length, history.length], new Set(history)]);
    // The page size is validated rather than trusted: zero and a fractional request each fall back to the 25-row default, so a malformed request reads a page instead of a zero-length one.
    for (const pageSize of [0, 2.5]) {
      const held = await pagingPage({ pageSize });
      expect([held.page.size, held.targets.length]).toEqual([PAGE_SIZE_DEFAULT, PAGE_SIZE_DEFAULT]);
    }
  });
});
it("the question set: captures the wording and the order at editor start, and a later edit of the list never rewrites the capture", () => {
  const questions: CheckInQuestion[] = [
    { wording: "How did the week go?", order: 0 },
    { wording: "What would help next week?", order: 1 },
    { wording: "What will you leave undone?", order: 2 },
  ];
  const captured = valueOf(captureQuestions(questions, SEEDED_AT), "captureQuestions");
  questions[1] = { wording: "Reworded after the editor opened", order: 1 };
  questions.push({ wording: "Added after the editor opened", order: 3 });
  expect([captured.questions.map((question) => question.wording), captured.questions.map((question) => question.order)]).toEqual([
    ["How did the week go?", "What would help next week?", "What will you leave undone?"],
    [0, 1, 2],
  ]);
  expect(captured.capturedAt.toString()).toBe(SEEDED_AT.toString());
});
it("the question set: accepts five questions and refuses a sixth by naming the limit, storing neither the sixth nor a shortened set", async () => {
  const five = questionsOf(["How did the week go?", "What would help next week?", "What encouraged you?", "What was hard?", "What will you leave undone?"]);
  const captured = valueOf(captureQuestions(five, SEEDED_AT), "captureQuestions at five questions");
  expect(captured.questions).toHaveLength(5);
  const six = questionsOf([...five.map((question) => question.wording), "A sixth question"]);
  const violation = required(refusalOf(captureQuestions(six, SEEDED_AT), "captureQuestions at six questions").violations.at(0), "the question-count violation");
  expect([violation.reason, violation.measured, violation.limit]).toEqual(["too-many-questions", 6, 5]);
  const drafted = await draftWith(
    ["Five.", "Five.", "Five.", "Five.", "Five."],
    five.map((question) => question.wording),
  );
  const refused = outcomeNamed(await saveCheckIn({ checkInId: drafted.checkInId, questions: six.map((question) => question.wording), answers: ["Six.", "Six.", "Six.", "Six.", "Six.", "Six."] }, drafted.revision), "invalid", "the sixth question");
  const message = required(refused.fields.questions?.at(0), "the question-count refusal message");
  for (const needle of ["6", "5"]) expect(message).toContain(needle);
  const after = await storedCheckIn(drafted.checkInId);
  expect(after.revision).toBe(drafted.revision);
  expect(after.privateDraft?.questions.map((question) => question.wording)).toEqual(five.map((question) => question.wording));
});
it("the question set: accepts a 500-scalar question built from astral characters and refuses 501 with the count shown", async () => {
  const atLimit = codePoints(CHECKIN_MAX_QUESTION_SCALARS);
  expect(Array.from(atLimit)).toHaveLength(CHECKIN_MAX_QUESTION_SCALARS);
  const captured = valueOf(captureQuestions(questionsOf([atLimit]), SEEDED_AT), "captureQuestions at 500 scalars");
  expect(required(captured.questions.at(0), "the captured question").wording).toBe(atLimit);
  const drafted = await draftWith(["It went well."], [atLimit]);
  expect(required(drafted.answers.at(0), "the stored answer")).toBe("It went well.");
  const stored = await storedCheckIn(drafted.checkInId);
  expect(required(stored.privateDraft?.questions.at(0), "the stored question").wording).toBe(atLimit);
  const over = codePoints(CHECKIN_MAX_QUESTION_SCALARS + 1);
  const violation = required(refusalOf(captureQuestions(questionsOf([over]), SEEDED_AT), "captureQuestions at 501 scalars").violations.at(0), "the question-length violation");
  expect([violation.reason, violation.measured, violation.limit]).toEqual(["question-too-long", 501, 500]);
  const refused = outcomeNamed(await saveCheckIn({ checkInId: drafted.checkInId, questions: [over], answers: ["It went well."] }, drafted.revision), "invalid", "the 501-scalar question");
  const message = required(refused.fields["questions[0].wording"]?.at(0), "the question-length refusal message");
  for (const needle of ["501", "500"]) expect(message).toContain(needle);
  const after = await storedCheckIn(drafted.checkInId);
  expect(required(after.privateDraft?.questions.at(0), "the stored question after the refusal").wording).toBe(atLimit);
});
it("the answer ceiling: accepts exactly 4,000 scalars built from astral characters and stores the answer character for character", async () => {
  const answer = codePoints(CHECKIN_MAX_ANSWER_SCALARS);
  expect(Array.from(answer)).toHaveLength(4000); // 4,000 astral characters are 8,000 UTF-16 units: an answer within this limit is one a `.length` check would have refused.
  const drafted = await draftWith([answer], ["How did the week go?"]);
  const stored = required(drafted.answers.at(0), "the stored 4,000-scalar answer");
  expect(stored).toBe(answer);
  expect(Array.from(stored)).toHaveLength(4000);
});
it("the answer ceiling: refuses 4,001 scalars with the count shown and writes nothing, rather than truncating the answer to 4,000", async () => {
  const acceptedAnswer = codePoints(CHECKIN_MAX_ANSWER_SCALARS, "a");
  const drafted = await draftWith([acceptedAnswer], ["How did the week go?"]);
  const over = codePoints(CHECKIN_MAX_ANSWER_SCALARS + 1);
  const violations = validateCheckInRequest(modulePayload(["How did the week go?"], [over]));
  expect(violations.map((violation) => violation.reason)).toEqual(["answer-too-long"]);
  const violation = required(violations.at(0), "the answer-length violation");
  expect([violation.measured, violation.limit]).toEqual([4001, 4000]);
  const refused = outcomeNamed(await saveCheckIn({ checkInId: drafted.checkInId, questions: ["How did the week go?"], answers: [over] }, drafted.revision), "invalid", "the 4,001-scalar answer");
  const message = required(refused.fields["answers[0].text"]?.at(0), "the answer-length refusal message");
  for (const needle of ["4001", "4000"]) expect(message).toContain(needle);
  const after = await storedCheckIn(drafted.checkInId);
  expect(after.revision).toBe(drafted.revision);
  const storedText = required(after.privateDraft?.answers.at(0), "the stored answer after the refusal").text;
  expect(storedText).toBe(acceptedAnswer);
  expect(storedText).not.toBe(Array.from(over).slice(0, CHECKIN_MAX_ANSWER_SCALARS).join(""));
});
it("the 256 KiB request ceiling: accepts a request of exactly 256 KiB and refuses one byte more, naming the ceiling and the size", async () => {
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
  for (const needle of [String(REQUEST_CEILING_BYTES + 1), String(REQUEST_CEILING_BYTES)]) expect(message).toContain(needle);
  expect(await storedCheckInIds()).toEqual(beforeRefusal);
});
it("the 256 KiB request ceiling: refuses a 4,001-scalar answer by the answer rule, not by the request ceiling", async () => {
  const over = codePoints(CHECKIN_MAX_ANSWER_SCALARS + 1);
  const payload = modulePayload([], [over]);
  expect(bytesOf(payload)).toBeLessThan(REQUEST_CEILING_BYTES); // The request is far inside the ceiling, so only the answer rule can refuse it.
  expect(validateCheckInRequest(payload).map((violation) => violation.reason)).toEqual(["answer-too-long"]);
  const refused = outcomeNamed(await saveCheckIn({ answers: [over] }), "invalid", "the 4,001-scalar answer");
  expect(Object.keys(refused.fields)).toEqual(["answers[0].text"]);
});
const REVIEWED_FINGERPRINT = "task-fingerprint-as-reviewed";
const REVIEWED_DESCRIPTION = "Review the working list with Jo before the appeal starts";
function modelledShare(overrides: Partial<TaskShare> = {}): TaskShare {
  return { shareId: "coaching-task-share-fixture", occurrenceId: PLAIN_TASK, reviewedSummary: { description: REVIEWED_DESCRIPTION, codePoints: scalarsOf(REVIEWED_DESCRIPTION), reviewedAt: SEEDED_AT }, reviewedFingerprint: REVIEWED_FINGERPRINT, state: "shared", revision: 1, ...overrides };
}
const SUMMARY_DUE_DATE: TaskSummaryDueDate = { kind: "dated", date: Temporal.PlainDate.from("2026-11-24"), precision: "date" };
function summaryInput(overrides: Partial<SafeTaskSummaryInput> = {}): SafeTaskSummaryInput {
  return { state: "shared", description: codePoints(TASK_SUMMARY_MAX_CODE_POINTS), dueDate: SUMMARY_DUE_DATE, status: "open", reviewedFingerprint: REVIEWED_FINGERPRINT, currentFingerprint: REVIEWED_FINGERPRINT, sourceAvailable: true, ...overrides };
}
it("the reviewed safe description: accepts exactly 240 code points built from astral characters and refuses 241 with the count shown", async () => {
  const atLimit = codePoints(TASK_SUMMARY_MAX_CODE_POINTS);
  expect(Array.from(atLimit)).toHaveLength(240);
  const reviewed = valueOf(reviewTaskSummary(atLimit, SEEDED_AT), "reviewTaskSummary at 240 code points");
  expect([reviewed.codePoints, reviewed.description]).toEqual([240, atLimit]);
  const over = codePoints(TASK_SUMMARY_MAX_CODE_POINTS + 1);
  const refusal = refusalOf(reviewTaskSummary(over, SEEDED_AT), "reviewTaskSummary at 241 code points");
  if (refusal.reason !== "description-too-long") throw new Error(`The 241-code-point description was refused as "${refusal.reason}" instead of by its length`);
  expect([refusal.codePoints, refusal.limit]).toEqual([241, 240]);
  outcomeNamed(await setModule("task-summaries", true), "accepted", "enabling the task-summaries module");
  const row = await taskRow(PLAIN_TASK);
  const beforeRefusal = requiredSaying(summariesModuleOf(await coachSubject()), "The coach read admitted no task-summaries module, so nothing can be asserted about what it shows");
  const refused = outcomeNamed(await shareTaskSummary(PLAIN_TASK, over, row.revision), "invalid", "the 241-code-point description");
  for (const needle of ["241", "240"]) expect(required(refused.fields.safeDescription?.at(0), "the description-length refusal message")).toContain(needle);
  const summaries = requiredSaying(summariesModuleOf(await coachSubject()), "The coach read admitted no task-summaries module, so nothing can be asserted about what it shows");
  expect(summaries, "The refused description wrote nothing: the module is the one the read stated before the attempt, so no summary was added and no summary already shared was replaced").toEqual(beforeRefusal);
});
it("the reviewed safe description: carries the reviewed description with the live due date and status, and nothing else of the task", () => {
  const summary = valueOf(safeTaskSummary(summaryInput()), "safeTaskSummary");
  if (summary.state !== "shared") throw new Error(`A summary whose reviewed wording still stands was withheld as "${summary.state}"`);
  expect(summary.description).toBe(codePoints(TASK_SUMMARY_MAX_CODE_POINTS));
  expect([summary.dueDate, summary.status]).toEqual([SUMMARY_DUE_DATE, "open"]);
  expect(Object.keys(summary).sort()).toEqual(["description", "dueDate", "state", "status"]); // The shape is the whole of what a coach may read, so the field list is asserted rather than sampled.
  const withheld: readonly string[] = ["title", "body", "note", "donor", "donorId", "amount", "money", "attachment", "attachmentId", "source", "sourceReference", "link", "url", "history", "privateHistory", "partnerId", "taskId"];
  for (const field of withheld) expect(field in summary).toBe(false);
});
it("the reviewed safe description: withholds the summary once the task's reviewed meaning changes, and returns it only on a fresh review", () => {
  const reviewed = summaryInput();
  expect(valueOf(safeTaskSummary(reviewed), "safeTaskSummary before the change").state).toBe("shared");
  const changed = valueOf(safeTaskSummary({ ...reviewed, currentFingerprint: `${REVIEWED_FINGERPRINT}-rewritten` }), "safeTaskSummary after the change");
  expect(changed.state).toBe("needs-review");
  expect(Object.keys(changed)).toEqual(["state"]);
  // A share whose reviewed or current fingerprint is missing has not been reviewed at all, which is a refusal rather than a withheld summary: those are different facts and a surface says which it has.
  expect(refusalOf(safeTaskSummary({ ...reviewed, reviewedFingerprint: undefined }), "safeTaskSummary without a review").reason).toBe("not-reviewed");
  const reReviewed = valueOf(safeTaskSummary({ ...reviewed, description: "A shorter description reviewed against the new wording", reviewedFingerprint: `${REVIEWED_FINGERPRINT}-rewritten`, currentFingerprint: `${REVIEWED_FINGERPRINT}-rewritten` }), "safeTaskSummary reviewed again");
  expect(reReviewed.state).toBe("shared");
  const shared = modelledShare();
  const states = [
    taskShareReadState({ share: shared, currentFingerprint: REVIEWED_FINGERPRINT, sourceAvailable: true }),
    taskShareReadState({ share: shared, currentFingerprint: `${REVIEWED_FINGERPRINT}-rewritten`, sourceAvailable: true }),
    taskShareReadState({ share: { ...shared, state: "removed" }, currentFingerprint: REVIEWED_FINGERPRINT, sourceAvailable: true }),
    taskShareReadState({ share: shared, currentFingerprint: REVIEWED_FINGERPRINT, sourceAvailable: false }),
  ];
  expect([states, new Set(states).size]).toEqual([["shared", "needs-review", "removed", "unavailable"], 4]);
});
it("the reviewed safe description: requires a fresh selection for a recurring successor, never the predecessor's description", async () => {
  const share = modelledShare();
  const refused = refusalOf(selectSuccessorForSharing({ share, occurrenceId: "occurrence-next-week", selectedOccurrenceId: undefined, expectedRevision: share.revision }), "a successor the worker never selected");
  expect(refused.reason).toBe("successor-needs-fresh-selection");
  const selected = valueOf(selectSuccessorForSharing({ share, occurrenceId: "occurrence-next-week", selectedOccurrenceId: "occurrence-next-week", expectedRevision: share.revision }), "a successor the worker selected");
  expect(selected.occurrenceId).toBe("occurrence-next-week");
  const row = await taskRow(RECURRING_TASK);
  expect(row.seriesId).not.toBeNull();
  expect(Object.keys(outcomeNamed(await shareTaskSummary(RECURRING_TASK, REVIEWED_DESCRIPTION, row.revision), "invalid", "the recurring task's share").fields)).toEqual(["occurrenceId"]);
});
it("the reviewed safe description: stops sharing a summary without changing the task, and the summary leaves the coach read", async () => {
  outcomeNamed(await setModule("task-summaries", true), "accepted", "enabling the task-summaries module");
  const description = codePoints(TASK_SUMMARY_MAX_CODE_POINTS);
  const row = await taskRow(PLAIN_TASK);
  const shared = outcomeNamed(await shareTaskSummary(PLAIN_TASK, description, row.revision), "accepted", "shareTaskSummary");
  const shareId = firstCreated(shared, "shareTaskSummary");
  const admitted = requiredSaying(summariesModuleOf(await coachSubject()), "The coach read admitted no task-summaries module, so nothing can be asserted about the summary");
  const visible = firstWhere(admitted.summaries, "shareId", shareId, "the shared summary in the coach read");
  expect([[visible.state, visible.description, visible.status], visible.dueDate]).toEqual([["shared", description, row.status], { kind: "dated", date: required(row.dueOn, "the task's due date"), precision: "date" }]);
  // The task's reviewed meaning changes, so the summary is withheld rather than shown against the new wording.
  const editedRow = outcomeNamed(await mutations.work.editTask(attempt({ taskId: PLAIN_TASK, title: "Follow up with Jo about the visit and the appeal" }, row.revision), { sessionId: WORKER_SESSION }), "accepted", "editTask");
  expect(editedRow.revision).not.toBe(row.revision);
  const withheld = firstWhere(summariesModuleOf(await coachSubject())?.summaries, "shareId", shareId, "the withheld summary in the coach read");
  expect(withheld.state).toBe("needs-review");
  expect(withheld.description).toBeNull();
  const beforeStop = await taskRow(PLAIN_TASK);
  outcomeNamed(await stopTaskShare(shareId, shared.revision), "accepted", "stopTaskShare");
  expect(summariesModuleOf(await coachSubject())?.summaries.some((summary) => summary.shareId === shareId)).toBe(false);
  const surviving = await taskRow(PLAIN_TASK);
  expect([surviving.title, surviving.status, surviving.dueOn, surviving.revision]).toEqual([beforeStop.title, beforeStop.status, beforeStop.dueOn, beforeStop.revision]);
});
it("the private draft and the shared revision: keeps them as two different identities, and changes the shared one only on an explicit update", async () => {
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
  const admissions = requiredSaying(checkInsModuleOf(await coachSubject()), "The coach read admitted no check-ins module, so nothing can be asserted about the shared revision");
  expect([firstWhere(admissions.sharedCheckIns, "revisionId", sharedRevisionId, "the shared check-in in the coach read").answers.map((answer) => answer.text), admissions.sharedCheckIns.some((checkIn) => checkIn.revisionId === privateRevisionId)]).toEqual([[draftText], false]);
  const updatedText = "Three good conversations, and the difficult one is planned for Tuesday.";
  const updated = outcomeNamed(await updateSharedCheckIn(drafted.checkInId, [updatedText], shared.revision), "accepted", "updateSharedCheckIn");
  expect(updated.revision).not.toBe(shared.revision);
  const afterUpdate = await storedCheckIn(drafted.checkInId);
  const changedShared = required(afterUpdate.shared, "the shared revision after the update");
  // The shared revision is one slot whose identity a coach's entitlement names, so an update replaces its answers and advances the check-in's own revision rather than minting a second shared revision beside it. What a coach reads is therefore always the one revision this worker shares.
  expect(changedShared.revisionId).toBe(sharedRevisionId);
  expect(changedShared.answers.map((answer) => answer.text)).toEqual([updatedText]);
  expect(afterUpdate.privateDraft?.revisionId).toBe(privateRevisionId);
  expect(afterUpdate.privateDraft?.answers.map((answer) => answer.text)).toEqual([draftText]);
  const privateText = "My own preparation: ask about the appeal on Tuesday.";
  outcomeNamed(await saveCheckIn({ checkInId: drafted.checkInId, answers: [privateText] }, updated.revision), "accepted", "the private autosave");
  const afterPrivateSave = await storedCheckIn(drafted.checkInId);
  expect(afterPrivateSave.shared?.revisionId).toBe(sharedRevisionId);
  expect(afterPrivateSave.shared?.answers.map((answer) => answer.text)).toEqual([updatedText]);
  expect(afterPrivateSave.privateDraft?.revisionId).not.toBe(privateRevisionId);
  expect(afterPrivateSave.privateDraft?.answers.map((answer) => answer.text)).toEqual([privateText]);
  const stillReadable = firstWhere(checkInsModuleOf(await coachSubject())?.sharedCheckIns, "revisionId", sharedRevisionId, "the shared check-in after a private save");
  expect(stillReadable.answers.map((answer) => answer.text)).toEqual([updatedText]);
  expect(stillReadable.answers.map((answer) => answer.text)).not.toContain(privateText);
});
it("the private draft and the shared revision: keeps private draft, shared revision and withdrawn as three distinct states", () => {
  const opened: CheckIn = { checkInId: "check-in-state-vocabulary", revision: 0 };
  const drafted = valueOf(savePrivateDraft(opened, modulePayload([], ["Two good conversations."]), 0, SEEDED_AT), "savePrivateDraft");
  const shared = valueOf(openSharedCheckIn(drafted.checkIn, drafted.checkIn.revision, [SEEDED_PERSONAS.coach.principalId], { kind: "ongoing" }, SEEDED_AT), "shareCheckIn");
  const withdrawn = valueOf(withdrawSharedCheckIn(shared.checkIn, shared.checkIn.revision, SEEDED_AT), "withdrawSharedCheckIn");
  const states = [checkInReadState(drafted.checkIn, "available"), checkInReadState(shared.checkIn, "available"), checkInReadState(withdrawn.checkIn, "available")];
  expect(states).toEqual(["private-draft", "shared", "withdrawn"]);
  expect([new Set(states).size, checkInReadState(drafted.checkIn, "unavailable")]).toEqual([3, "unavailable"]);
});
it("the private draft and the shared revision: keeps an answer that belongs to no question when a save carries a question set", async () => {
  const questionless = "Still deciding whether to raise the appeal.";
  const drafted = await draftWith([questionless]);
  expect((await storedCheckIn(drafted.checkInId)).privateDraft?.answers).toEqual([{ questionOrder: null, text: questionless }]);
  const positional = "Two good conversations and one difficult one.";
  const saved = outcomeNamed(await saveCheckIn({ checkInId: drafted.checkInId, questions: ["How did the week go?"], answers: [positional] }, drafted.revision), "accepted", "a save carrying a question set");
  expect(saved.revision).not.toBe(drafted.revision);
  const stored = required((await storedCheckIn(drafted.checkInId)).privateDraft, "the private draft after a positional save");
  // A save writes the answers that sit beside the questions it carries and keeps the ones that belong to no question, which a positional payload has nowhere to state: the answer written before the question set existed survives the save rather than being deleted to make the two lists agree.
  expect(stored.answers).toEqual([
    { questionOrder: 0, text: positional },
    { questionOrder: null, text: questionless },
  ]);
  expect(stored.questions.map((question) => question.wording)).toEqual(["How did the week go?"]);
});
it("the private draft and the shared revision: keeps the instant the question set was captured while a save leaves its wording and order as they stand", () => {
  const questions = ["How did the week go?", "What would help next week?"];
  const opened: CheckIn = { checkInId: "check-in-captured-instant", revision: 0 };
  const first = valueOf(savePrivateDraft(opened, modulePayload(questions, ["A shorter list on Monday."]), 0, SEEDED_AT), "savePrivateDraft");
  const later = SEEDED_AT.add({ hours: 5 });
  const second = valueOf(savePrivateDraft(first.checkIn, modulePayload(questions, ["A longer list on Monday."]), first.checkIn.revision, later), "savePrivateDraft");
  // A save writes the answers beside the questions it carries; it is not a new capture of the set the editor fixed when it started, so the day the surface states as the capture stays the day it was captured while the saved instant moves.
  expect([required(second.checkIn.privateDraft, "the private draft after the second save").captured.capturedAt.toString(), second.checkIn.privateDraft?.savedAt.toString()]).toEqual([SEEDED_AT.toString(), later.toString()]);
  const replaced = valueOf(savePrivateDraft(second.checkIn, modulePayload(["What changed this week?", "What would help next week?"], ["A longer list on Monday.", "A shorter list on Tuesday."]), second.checkIn.revision, later), "savePrivateDraft");
  expect(required(replaced.checkIn.privateDraft, "the private draft after the question set changed").captured.capturedAt.toString()).toBe(later.toString());
});
async function freshWorld(): Promise<void> {
  await layDownWorkerWorld();
  scope = await scopeOf(WORKER);
}
async function storedGrantState(): Promise<string> {
  const grant = (await storedState()).coachingGrants.find((candidate) => candidate.grantId === ACTIVE_GRANT);
  return required(grant, "the relationship the case closed").state;
}
it("withdrawal and the stop-type effects: withdraws a shared check-in while an unrelated draft is invalid, and contains it from the coach read", async () => {
  const drafted = await draftWith(["A short answer."]);
  const shared = outcomeNamed(await shareCheckIn(drafted.checkInId, drafted.revision), "accepted", "shareCheckIn");
  const beforeWithdrawal = await storedCheckIn(drafted.checkInId);
  const privateRevisionId = required(beforeWithdrawal.privateDraft?.revisionId, "the private draft's revision id");
  const sharedRevisionId = required(beforeWithdrawal.shared?.revisionId, "the shared revision id");
  outcomeNamed(await saveCheckIn({ answers: [codePoints(CHECKIN_MAX_ANSWER_SCALARS + 1)] }), "invalid", "the over-limit check-in draft");
  outcomeNamed(await shareTaskSummary(PLAIN_TASK, codePoints(TASK_SUMMARY_MAX_CODE_POINTS + 1), (await taskRow(PLAIN_TASK)).revision), "invalid", "the over-limit description");
  // Withdrawal is a containment act: like Stop showing me publicly, it never waits for another draft to be clean, because waiting would leave the shared text readable while the worker fixes something else.
  const withdrawn = outcomeNamed(await withdrawCheckIn(drafted.checkInId, shared.revision), "accepted", "withdrawCheckIn");
  expect(withdrawn.revision).not.toBe(shared.revision);
  const afterWithdrawal = await storedCheckIn(drafted.checkInId);
  expect([[required(afterWithdrawal.shared, "the withdrawn shared revision").withdrawnAt, afterWithdrawal.privateDraft?.revisionId], afterWithdrawal.privateDraft?.answers.map((answer) => answer.text)]).toEqual([[SEEDED_AT.toString(), privateRevisionId], ["A short answer."]]);
  const admissions = requiredSaying(checkInsModuleOf(await coachSubject()), "The coach read admitted no check-ins module, so nothing can be asserted about the withdrawal");
  expect([admissions.sharedCheckIns.some((checkIn) => checkIn.revisionId === sharedRevisionId), admissions.sharedCheckIns.some((checkIn) => checkIn.revisionId === "check-in-week-46-shared-1")]).toEqual([false, true]);
});
it("withdrawal and the stop-type effects: keeps the six stop-type effects distinct", async () => {
  const effects: string[] = [];
  await freshWorld();
  const enabled = outcomeNamed(await setModule("task-summaries", true), "accepted", "enabling a module");
  outcomeNamed(await setModule("task-summaries", false, enabled.revision), "accepted", "stopping a module");
  expect(summariesModuleOf(await coachSubject())).toBeUndefined();
  effects.push("not-admitted");
  const opened: CheckIn = { checkInId: "check-in-stop-effect", revision: 0 };
  const drafted = valueOf(savePrivateDraft(opened, modulePayload([], ["A short answer."]), 0, SEEDED_AT), "savePrivateDraft");
  const shared = valueOf(openSharedCheckIn(drafted.checkIn, drafted.checkIn.revision, [SEEDED_PERSONAS.coach.principalId], { kind: "ongoing" }, SEEDED_AT), "shareCheckIn");
  effects.push(checkInReadState(valueOf(withdrawSharedCheckIn(shared.checkIn, shared.checkIn.revision, SEEDED_AT), "withdrawSharedCheckIn").checkIn, "available"));
  effects.push(taskShareReadState({ share: valueOf(stopModelledTaskShare({ share: modelledShare(), expectedRevision: 1 }, SEEDED_AT), "stopTaskShare"), currentFingerprint: REVIEWED_FINGERPRINT, sourceAvailable: true }));
  await freshWorld();
  outcomeNamed(await mutations.coaching.endCoaching(attempt({ grantId: ACTIVE_GRANT }, FIRST_REVISION), WORKER), "accepted", "endCoaching");
  effects.push(await storedGrantState());
  await freshWorld();
  const coach = await coachSubject();
  outcomeNamed(await mutations.coach.leaveCoaching({ operationId: newOperationId(), scope: coach.scope, expectedRevision: FIRST_REVISION, payload: { grantId: ACTIVE_GRANT } }, COACH), "accepted", "leaveCoaching");
  effects.push(await storedGrantState()); // The coach's own departure is written to the worker's record, which is the one both identities address.
  await freshWorld();
  outcomeNamed(await mutations.coaching.revokeGrant(attempt({ grantId: ACTIVE_GRANT }, FIRST_REVISION), WORKER), "accepted", "revokeGrant");
  effects.push(await storedGrantState());
  expect(effects).toHaveLength(6);
  expect([new Set(effects).size, effects]).toEqual([6, ["not-admitted", "withdrawn", "removed", "ended", "left", "revoked"]]);
});
it("a closed target period: still renders against the version it was measured against after the quantity changes", () => {
  const record = firstWhere(world.worker.state.coachingTargets, "targetId", "target-conversations-weekly", "the seeded conversations target");
  const anchor = anchorOf(record);
  const versions = versionsOf(record);
  const closedWeek = weekOf(record, Temporal.PlainDate.from("2026-11-05"));
  const before = workerTargetProgress({ target: targetRecordOf(record), version: valueOf(resolveTargetVersion(versions, closedWeek), "resolveTargetVersion for the closed week"), period: closedWeek, count: 2 });
  const change: TargetVersionChange = { revisionId: "target-conversations-weekly-3", quantity: 7, measure: "conversations", calendarStart: anchor.calendarStart };
  const next = valueOf(startProspectiveVersion({ versions, anchor, change, effectiveFrom: Temporal.PlainDate.from("2026-11-16") }), "startProspectiveVersion");
  // `coaching-grant.test.ts` asserts the version history's adjacency — no gap and no overlap between the prospective versions. This file asserts the same rule from the rendering side: the closed week still resolves and renders against the plan it was measured against, so a later quantity never rewrites it.
  const after = workerTargetProgress({ target: targetRecordOf(record), version: valueOf(resolveTargetVersion(next, closedWeek), "resolveTargetVersion for the closed week after the change"), period: closedWeek, count: 2 });
  expect([after.revisionId, after.quantity]).toEqual([before.revisionId, before.quantity]);
  const openWeek = weekOf(record, Temporal.PlainDate.from("2026-11-19"));
  expect(workerTargetProgress({ target: targetRecordOf(record), version: valueOf(resolveTargetVersion(next, openWeek), "resolveTargetVersion for the open week"), period: openWeek, count: 2 }).quantity).toBe(7);
});
