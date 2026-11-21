/** Check-ins: the one capture, limit and revision model behind a worker's private check-in and the shared revision a named coach may read. */
import type { CivilDate, CivilDayStart } from "../time/civil";
import { err, ok, type Result } from "../../lib/result";
/** Most questions one check-in may carry: five questions are accepted and a sixth is refused. */
export const CHECKIN_MAX_QUESTIONS = 5;
/** Longest question text, in Unicode scalar values: 500 are accepted and 501 are refused. */
export const CHECKIN_MAX_QUESTION_SCALARS = 500;
/** Longest answer text, in Unicode scalar values: 4,000 are accepted and 4,001 are refused. */
export const CHECKIN_MAX_ANSWER_SCALARS = 4000;
/** Largest check-in request, in bytes of its serialised JSON: 262,144 are accepted, 262,145 refused. */
export const CHECKIN_MAX_REQUEST_BYTES = 262144;
export type CheckInInstant = Extract<CivilDayStart, { readonly status: "resolved" }>["instant"];
export type CheckInQuestion = { readonly wording: string; readonly order: number };
export type CheckInAnswer = { readonly questionOrder: number | null; readonly text: string };
export type CheckInPayload = { readonly questions: readonly CheckInQuestion[]; readonly answers: readonly CheckInAnswer[] };
export type CapturedQuestionSet = { readonly questions: readonly CheckInQuestion[]; readonly capturedAt: CheckInInstant };
export type CheckInShareDuration = { readonly kind: "ongoing" } | { readonly kind: "through-date"; readonly throughOn: CivilDate };
export type CheckInPrivateDraftRevision = { readonly revisionId: string; readonly captured: CapturedQuestionSet; readonly answers: readonly CheckInAnswer[]; readonly savedAt: CheckInInstant };
export interface CheckInSharedRevision {
  readonly revisionId: string;
  readonly captured: CapturedQuestionSet;
  readonly answers: readonly CheckInAnswer[];
  readonly recipients: readonly string[];
  readonly duration: CheckInShareDuration;
  readonly sharedAt: CheckInInstant;
  readonly updatedAt: CheckInInstant;
  readonly withdrawnAt?: CheckInInstant;
}
export type CheckIn = { readonly checkInId: string; readonly revision: number; readonly privateDraft?: CheckInPrivateDraftRevision; readonly shared?: CheckInSharedRevision };
export type CheckInRevisions = { readonly privateDraftRevisionId?: string; readonly sharedRevisionId?: string; readonly sharedRevisionWithdrawnAt?: CheckInInstant };
export type CheckInState = "private-draft" | "shared" | "withdrawn" | "unavailable";
export type CheckInSourceAvailability = "available" | "unavailable";
export type CheckInRefusalReason = "too-many-questions" | "question-too-long" | "answer-too-long" | "answer-without-question" | "duplicate-answer" | "request-too-large" | "no-private-draft" | "no-recipients" | "already-shared" | "not-shared" | "stale-revision" | "unavailable";
export type CheckInViolation = { readonly path: string; readonly reason: CheckInRefusalReason; readonly measured: number; readonly limit: number; readonly message: string };
export type CheckInRefusal = { readonly reason: CheckInRefusalReason; readonly message: string; readonly violations: readonly CheckInViolation[]; readonly revisionMismatch?: { readonly expected: number; readonly actual: number } };
export type CheckInMutationAccepted = { readonly checkIn: CheckIn; readonly revisions: CheckInRevisions; readonly state: CheckInState; readonly revision: number; readonly changed: boolean; readonly message: string };
export type CheckInMutation = Result<CheckInMutationAccepted, CheckInRefusal>;
const AVAILABLE_SOURCE: CheckInSourceAvailability = "available";
const UTF8_ENCODER = new TextEncoder();
const scalarLength = (text: string): number => Array.from(text).length;
const requestByteLength = (payload: CheckInPayload): number => UTF8_ENCODER.encode(JSON.stringify(payload)).byteLength;
const violation = (path: string, reason: CheckInRefusalReason, measured: number, limit: number, message: string): CheckInViolation => ({ path, reason, measured, limit, message });
const refusal = (reason: CheckInRefusalReason, message: string, violations: readonly CheckInViolation[] = [], revisionMismatch?: { readonly expected: number; readonly actual: number }): CheckInRefusal => ({ reason, message, violations, revisionMismatch });
function questionSetViolations(questions: readonly CheckInQuestion[]): CheckInViolation[] {
  const violations: CheckInViolation[] = [];
  if (questions.length > CHECKIN_MAX_QUESTIONS) violations.push(violation("questions", "too-many-questions", questions.length, CHECKIN_MAX_QUESTIONS, `This check-in carries ${questions.length} of ${CHECKIN_MAX_QUESTIONS} questions; a check-in carries at most ${CHECKIN_MAX_QUESTIONS} questions.`));
  questions.forEach((question, index) => {
    const length = scalarLength(question.wording);
    if (length <= CHECKIN_MAX_QUESTION_SCALARS) return;
    violations.push(violation(`questions[${index}].wording`, "question-too-long", length, CHECKIN_MAX_QUESTION_SCALARS, `Question ${index + 1} is ${length} of ${CHECKIN_MAX_QUESTION_SCALARS} characters; it is refused rather than shortened.`));
  });
  return violations;
}
function answerViolations(questions: readonly CheckInQuestion[], answers: readonly CheckInAnswer[]): CheckInViolation[] {
  const violations: CheckInViolation[] = [];
  const capturedOrders = new Set(questions.map((question) => question.order));
  const answerCounts = new Map<number, number>();
  for (const answer of answers) {
    const order = answer.questionOrder;
    if (order === null) continue;
    answerCounts.set(order, (answerCounts.get(order) ?? 0) + 1);
  }
  const reportedDuplicates = new Set<number>();
  answers.forEach((answer, index) => {
    const order = answer.questionOrder;
    if (order !== null && !capturedOrders.has(order)) violations.push(violation(`answers[${index}].questionOrder`, "answer-without-question", order, questions.length, `Answer ${index + 1} answers question ${order}, and the captured question set holds no question at that order (${questions.length} captured).`));
    if (order !== null && capturedOrders.has(order)) {
      const count = answerCounts.get(order) ?? 1;
      // Reported once per question rather than once per extra answer, so one duplicated question reads as one problem instead of a growing list.
      if (count > 1 && !reportedDuplicates.has(order)) {
        reportedDuplicates.add(order);
        violations.push(violation(`answers[${index}].questionOrder`, "duplicate-answer", count, 1, `Question ${order} has ${count} of 1 answers; a check-in answers each captured question at most once.`));
      }
    }
    const length = scalarLength(answer.text);
    if (length <= CHECKIN_MAX_ANSWER_SCALARS) return;
    violations.push(violation(`answers[${index}].text`, "answer-too-long", length, CHECKIN_MAX_ANSWER_SCALARS, `Answer ${index + 1} is ${length} of ${CHECKIN_MAX_ANSWER_SCALARS} characters; it is refused rather than shortened.`));
  });
  return violations;
}
function violationsRefusal(violations: readonly CheckInViolation[]): CheckInRefusal | null {
  const [first, ...rest] = violations;
  if (first === undefined) return null;
  const message = rest.length === 0 ? first.message : `${first.message} ${rest.length} further ${rest.length === 1 ? "issue is" : "issues are"} present in the same request.`;
  return refusal(first.reason, message, violations);
}
function admittedPayload(payload: CheckInPayload): Result<CheckInPayload, CheckInRefusal> {
  const limitRefusal = violationsRefusal(validateCheckInRequest(payload));
  return limitRefusal === null ? ok(payload) : err(limitRefusal);
}
function staleRevisionRefusal(checkIn: CheckIn, expectedRevision: number): CheckInRefusal | null {
  if (checkIn.revision === expectedRevision) return null;
  return refusal("stale-revision", `This check-in changed while you were working: it is now at revision ${checkIn.revision} and this change was made against revision ${expectedRevision}. Nothing was written.`, [], { expected: expectedRevision, actual: checkIn.revision });
}
const NON_SHARED_REFUSALS: Readonly<Record<Exclude<CheckInState, "shared">, CheckInRefusal>> = {
  "private-draft": refusal("not-shared", "This check-in has not been shared with a coach yet, so there is no shared revision to change. Share it first."),
  withdrawn: refusal("not-shared", "This check-in was withdrawn, so a coach can no longer read it and its shared revision is not changed. Write a new check-in instead."),
  unavailable: refusal("unavailable", "The check-in source is unavailable right now, so nothing was read or written. Try again when the source is available."),
};
function sharedRevisionOf(checkIn: CheckIn): Result<CheckInSharedRevision, CheckInRefusal> {
  const state = checkInReadState(checkIn, AVAILABLE_SOURCE);
  if (state !== "shared") return err(NON_SHARED_REFUSALS[state]);
  const { shared } = checkIn;
  // "shared" is derived from this field, so a shared state always carries it; the guard states the invariant rather than asserting it away.
  if (shared === undefined) return err(NON_SHARED_REFUSALS["private-draft"]);
  return ok(shared);
}
function revisionsOf(checkIn: CheckIn): CheckInRevisions {
  const { privateDraft, shared } = checkIn;
  return { privateDraftRevisionId: privateDraft?.revisionId, sharedRevisionId: shared?.revisionId, sharedRevisionWithdrawnAt: shared?.withdrawnAt };
}
const accepted = (checkIn: CheckIn, changed: boolean, message: string): CheckInMutationAccepted => ({ checkIn, revisions: revisionsOf(checkIn), state: checkInReadState(checkIn, AVAILABLE_SOURCE), revision: checkIn.revision, changed, message });
const freezeAnswers = (answers: readonly CheckInAnswer[]): readonly CheckInAnswer[] => Object.freeze(answers.map((answer) => Object.freeze({ questionOrder: answer.questionOrder, text: answer.text })));
function sameQuestions(left: readonly CheckInQuestion[], right: readonly CheckInQuestion[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((question, index) => {
    const other = right[index];
    return other !== undefined && other.order === question.order && other.wording === question.wording;
  });
}
function sameAnswers(left: readonly CheckInAnswer[], right: readonly CheckInAnswer[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((answer, index) => {
    const other = right[index];
    return other !== undefined && other.questionOrder === answer.questionOrder && other.text === answer.text;
  });
}
function namedRecipients(recipients: readonly string[]): readonly string[] {
  const named: string[] = [];
  for (const recipient of recipients) {
    if (recipient.trim().length === 0) continue;
    if (!named.includes(recipient)) named.push(recipient);
  }
  return Object.freeze(named);
}
const privateRevisionId = (checkInId: string, revision: number): string => `${checkInId}:private:${revision}`;
const sharedRevisionId = (checkInId: string, revision: number): string => `${checkInId}:shared:${revision}`;
/** Resolves the state a check-in is read in — `private-draft`, `shared`, `withdrawn` or `unavailable` — so "not shared yet", "shared", "withdrawn" and "the source could not be read" stay four. */
export function checkInReadState(checkIn: CheckIn | null, sourceAvailability: CheckInSourceAvailability): CheckInState {
  if (sourceAvailability === "unavailable") return "unavailable";
  // A record that could not be loaded is a source that could not be read, never a check-in holding nothing: those are different facts and a surface has to say which one it has.
  if (checkIn === null) return "unavailable";
  const { shared } = checkIn;
  if (shared === undefined) return "private-draft";
  return shared.withdrawnAt === undefined ? "shared" : "withdrawn";
}
/** Captures an optional question set — at most five questions of at most 500 scalars each — as a frozen deep copy stamped with the instant the editor opened; returns the captured set, or the. */
export function captureQuestions(questions: readonly CheckInQuestion[], capturedAt: CheckInInstant): Result<CapturedQuestionSet, CheckInRefusal> {
  const captureRefusal = violationsRefusal(questionSetViolations(questions));
  if (captureRefusal !== null) return err(captureRefusal);
  const captured: readonly CheckInQuestion[] = Object.freeze(questions.map((question) => Object.freeze({ wording: question.wording, order: question.order })));
  return ok(Object.freeze({ questions: captured, capturedAt }));
}
/** The one limit check for a check-in request: question count, each question's scalars, at most one answer per captured question, each answer's scalars, and the serialised request's bytes. */
export function validateCheckInRequest(payload: CheckInPayload): readonly CheckInViolation[] {
  const violations: CheckInViolation[] = [];
  const requestBytes = requestByteLength(payload);
  if (requestBytes > CHECKIN_MAX_REQUEST_BYTES) violations.push(violation("request", "request-too-large", requestBytes, CHECKIN_MAX_REQUEST_BYTES, `This check-in request is ${requestBytes} of ${CHECKIN_MAX_REQUEST_BYTES} bytes; it is refused rather than shortened.`));
  violations.push(...questionSetViolations(payload.questions));
  violations.push(...answerViolations(payload.questions, payload.answers));
  return violations;
}
/** Saves the worker's private draft — the only revision an autosave touches, so nothing becomes readable by a coach here; returns the saved record, or the refusal (a stale revision, or the. */
export function savePrivateDraft(checkIn: CheckIn, payload: CheckInPayload, expectedRevision: number, now: CheckInInstant): CheckInMutation {
  const stale = staleRevisionRefusal(checkIn, expectedRevision);
  if (stale !== null) return err(stale);
  const admitted = admittedPayload(payload);
  if (!admitted.ok) return err(admitted.error);
  const captured = captureQuestions(payload.questions, now);
  if (!captured.ok) return err(captured.error);
  const answers = freezeAnswers(payload.answers);
  const existing = checkIn.privateDraft;
  if (existing !== undefined && sameQuestions(existing.captured.questions, captured.value.questions) && sameAnswers(existing.answers, answers)) return ok(accepted(checkIn, false, "This private draft already holds that text, so nothing changed."));
  const revision = checkIn.revision + 1;
  const next: CheckIn = { ...checkIn, revision, privateDraft: { revisionId: privateRevisionId(checkIn.checkInId, revision), captured: captured.value, answers, savedAt: now } };
  return ok(accepted(next, true, "The private draft is saved. It stays your own working text: a coach sees nothing until you share this check-in."));
}
/** Shares the saved private draft by creating the shared revision a named coach may read, recording the recipients and the share duration; returns the shared record, or the refusal (a stale. */
export function shareCheckIn(checkIn: CheckIn, expectedRevision: number, recipients: readonly string[], duration: CheckInShareDuration, now: CheckInInstant): CheckInMutation {
  const stale = staleRevisionRefusal(checkIn, expectedRevision);
  if (stale !== null) return err(stale);
  if (checkIn.shared !== undefined) return err(refusal("already-shared", "This check-in already has a shared revision. Update the shared check-in to change what a coach reads; sharing it again would create a second revision of the same check-in."));
  const draft = checkIn.privateDraft;
  if (draft === undefined) return err(refusal("no-private-draft", "There is no private draft to share yet. Save the draft, then share it."));
  const named = namedRecipients(recipients);
  if (named.length === 0) return err(refusal("no-recipients", "Name the coach who may read this check-in. A share that names nobody shares nothing."));
  // The snapshot is measured again on its way out, so a draft stored before a limit was in force cannot become readable by a coach while it is over a limit.
  const admitted = admittedPayload({ questions: draft.captured.questions, answers: draft.answers });
  if (!admitted.ok) return err(admitted.error);
  // The shared revision holds its own frozen copy rather than an alias of the private draft, so no later private save can reach the snapshot through the object the draft still references.
  const snapshot = captureQuestions(draft.captured.questions, draft.captured.capturedAt);
  if (!snapshot.ok) return err(snapshot.error);
  const revision = checkIn.revision + 1;
  const next: CheckIn = { ...checkIn, revision, shared: { revisionId: sharedRevisionId(checkIn.checkInId, revision), captured: snapshot.value, answers: freezeAnswers(draft.answers), recipients: named, duration, sharedAt: now, updatedAt: now } };
  return ok(accepted(next, true, "This check-in is shared with the named coach for the recorded duration. Sharing sends no notification and creates no task; it makes the saved private revision readable."));
}
/** Changes the shared revision, which no other operation may, by replacing its answers; returns the updated record, or the refusal (a stale revision, not shared, or the violations that stopped. */
export function updateSharedCheckIn(checkIn: CheckIn, payload: CheckInPayload, expectedRevision: number, now: CheckInInstant): CheckInMutation {
  const stale = staleRevisionRefusal(checkIn, expectedRevision);
  if (stale !== null) return err(stale);
  const shared = sharedRevisionOf(checkIn);
  if (!shared.ok) return err(shared.error);
  const current = shared.value;
  const admitted = admittedPayload({ questions: current.captured.questions, answers: payload.answers });
  if (!admitted.ok) return err(admitted.error);
  const answers = freezeAnswers(payload.answers);
  if (sameAnswers(current.answers, answers)) return ok(accepted(checkIn, false, "The shared check-in already holds these answers, so nothing changed."));
  const revision = checkIn.revision + 1;
  const next: CheckIn = { ...checkIn, revision, shared: { ...current, answers, updatedAt: now } };
  return ok(accepted(next, true, "The shared check-in now holds these answers, so a coach reading it sees the updated revision."));
}
/** Withdraws the shared revision, so a coach can no longer read it; returns the withdrawn record, or the refusal (a stale revision, or nothing shared to withdraw). */
export function withdrawSharedCheckIn(checkIn: CheckIn, expectedRevision: number, now: CheckInInstant): CheckInMutation {
  const stale = staleRevisionRefusal(checkIn, expectedRevision);
  if (stale !== null) return err(stale);
  // Withdrawing what is already withdrawn changes nothing, and saying so is more useful than a refusal: the intent is already satisfied.
  if (checkInReadState(checkIn, AVAILABLE_SOURCE) === "withdrawn") return ok(accepted(checkIn, false, "This check-in is already withdrawn, so nothing changed."));
  const shared = sharedRevisionOf(checkIn);
  if (!shared.ok) return err(shared.error);
  const revision = checkIn.revision + 1;
  const next: CheckIn = { ...checkIn, revision, shared: { ...shared.value, withdrawnAt: now } };
  return ok(accepted(next, true, "This check-in is withdrawn from now on: a coach can no longer open it. Withdrawal removes access from this moment; it does not take back anything a coach has already read."));
}
