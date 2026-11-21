/**
 * Check-ins: the one capture, limit and revision model behind a worker's private check-in and the
 * shared revision a named coach may read.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Coaching module" row: `modules/coaching/{grant,target,checkin,taskshare}.ts`, whose
 *   key interface for this file is `captureQuestions()`.
 * - AAP 0.6.2 "Target and check-in" record, check-in half: `questions[]` captured with wording and
 *   order, `answers[]` of at most 4,000 Unicode scalars each, a 256 KiB request ceiling,
 *   `sharedRevisionId`, `recipients`, `duration` and `revision`.
 * - AAP 0.8.4 coaching rule row 5: plain-text answers; a question set captured with its wording and
 *   order at editor start; private autosave visibly separate from Share; a shared check-in that
 *   changes only on Update shared check-in.
 * - AAP 0.8.7 fixed values "Check-in question set" (5 questions of 500 Unicode scalars each),
 *   "Check-in answer" (4,000 Unicode scalars) and "Check-in request" (256 KiB), each with its exact
 *   boundary: a value exactly at the limit is accepted, and one more is refused.
 * - AAP 0.9.1 repository tree and the 0.11.1 File Creation Plan row for
 *   `modules/coaching/checkin.ts`.
 * - Acceptance criterion 16, whose check-in half is proven by `tests/domain/coaching-limits.test.ts`
 *   and `e2e/coaching-share-revoke.spec.ts`.
 *
 * The limits are refused, never fitted. An answer of 4,001 scalars is refused with its measured
 * count, a sixth question is refused as a sixth question, and a request of 262,145 bytes is refused
 * with its measured size. No input is ever made to fit a limit, because an answer cut down to size
 * is no longer the answer the worker wrote, and a stored value that quietly differs from what was
 * typed is a false record of what the worker said.
 *
 * Layering: a framework-free domain module. It reads no clock (every instant arrives as a
 * parameter), touches no store, imports no data-service, money, audience, feature or component
 * module, and returns every expected refusal as a value instead of throwing. Admission — whether a
 * coach may read a shared revision, per grant and per module — belongs to `grant.ts` and the
 * service. This file records that a revision was shared and that it was withdrawn, and settles
 * neither question.
 */
import type { CivilDate, CivilDayStart } from "../time/civil";
import { err, ok, type Result } from "../../lib/result";

// ---------------------------------------------------------------------------------------------
// The four limits, declared once
// ---------------------------------------------------------------------------------------------

/** Most questions one check-in may carry: five questions are accepted and a sixth is refused. */
export const CHECKIN_MAX_QUESTIONS = 5;

/** Longest question text, in Unicode scalar values: 500 are accepted and 501 are refused. */
export const CHECKIN_MAX_QUESTION_SCALARS = 500;

/** Longest answer text, in Unicode scalar values: 4,000 are accepted and 4,001 are refused. */
export const CHECKIN_MAX_ANSWER_SCALARS = 4000;

/** Largest check-in request, in bytes of its serialised JSON: 262,144 are accepted, 262,145 refused. */
export const CHECKIN_MAX_REQUEST_BYTES = 262144;

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

/**
 * The instant type every recorded check-in timestamp uses: the resolved instant carried by
 * `time/civil`'s day-start result, so the application has one instant type and this module needs no
 * date library of its own.
 */
export type CheckInInstant = Extract<CivilDayStart, { readonly status: "resolved" }>["instant"];

/** One question in a check-in's question set, exactly as the worker worded it. */
export interface CheckInQuestion {
  /** The wording the worker wrote: plain text, never markup and never rewritten. */
  readonly wording: string;
  /** The question's position, assigned by the editor and the key an answer uses to name its prompt. */
  readonly order: number;
}

/** One answer, as plain text, either answering one captured question or standing on its own. */
export interface CheckInAnswer {
  /**
   * The `order` of the captured question this text answers, or `null` for prose that answers no
   * question — the form an optional question set leaves available, so a check-in stays writable
   * when the worker asked no prompts.
   */
  readonly questionOrder: number | null;
  /** The answer exactly as the worker wrote it: never trimmed, shortened or reworded. */
  readonly text: string;
}

/** The check-in content a save or an update carries. */
export interface CheckInPayload {
  /** The question set as the editor holds it now; an empty array is the legal "no questions" form. */
  readonly questions: readonly CheckInQuestion[];
  readonly answers: readonly CheckInAnswer[];
}

/** The question set frozen at editor start, with the instant it was captured. */
export interface CapturedQuestionSet {
  readonly questions: readonly CheckInQuestion[];
  readonly capturedAt: CheckInInstant;
}

/**
 * The share duration recorded on a shared check-in, as supplied by the grant at share time.
 *
 * It is a recorded value and nothing more: no cutoff is resolved here, because the exclusive cutoff
 * is the grant's, evaluated at read time by the service with `time`. Recording the civil through-date
 * keeps a later travel, settings or timezone-data change from moving a date already shared.
 */
export type CheckInShareDuration =
  | { readonly kind: "ongoing" }
  | { readonly kind: "through-date"; readonly throughOn: CivilDate };

/** The worker's own working revision: autosaved, never readable by a coach on its own. */
export interface CheckInPrivateDraftRevision {
  readonly revisionId: string;
  readonly captured: CapturedQuestionSet;
  readonly answers: readonly CheckInAnswer[];
  readonly savedAt: CheckInInstant;
}

/** The shared revision a named coach may read, created from a private draft by an explicit Share. */
export interface CheckInSharedRevision {
  readonly revisionId: string;
  /** The question set frozen at capture: a coach renders this wording, not the editor's current one. */
  readonly captured: CapturedQuestionSet;
  readonly answers: readonly CheckInAnswer[];
  /** Coach identifiers inside the authorised scope: an opaque id, never a name or an address. */
  readonly recipients: readonly string[];
  readonly duration: CheckInShareDuration;
  readonly sharedAt: CheckInInstant;
  readonly updatedAt: CheckInInstant;
  /** When the share was withdrawn; the shared revision is kept as the record of what was shared. */
  readonly withdrawnAt?: CheckInInstant;
}

/** One check-in: private revisions of the worker's own, and at most one shared revision. */
export interface CheckIn {
  readonly checkInId: string;
  /** Optimistic-concurrency revision of the record itself; every change presents the one it saw. */
  readonly revision: number;
  readonly privateDraft?: CheckInPrivateDraftRevision;
  readonly shared?: CheckInSharedRevision;
}

/** The revision identities a service record carries, projected from the revisions above. */
export interface CheckInRevisions {
  readonly privateDraftRevisionId?: string;
  readonly sharedRevisionId?: string;
  readonly sharedRevisionWithdrawnAt?: CheckInInstant;
}

/**
 * The four states a check-in can be read in. Closed on purpose: "not shared yet", "shared",
 * "withdrawn" and "source unavailable" are different answers, and none of them may be rendered as
 * an empty check-in.
 */
export type CheckInState = "private-draft" | "shared" | "withdrawn" | "unavailable";

/** Whether the check-in's source can be read right now, which decides the `unavailable` state. */
export type CheckInSourceAvailability = "available" | "unavailable";

/** Every reason a check-in request is refused; each maps to one readable message and no side effect. */
export type CheckInRefusalReason =
  /** More than CHECKIN_MAX_QUESTIONS questions. */
  | "too-many-questions"
  /** A question wording above CHECKIN_MAX_QUESTION_SCALARS scalars. */
  | "question-too-long"
  /** An answer text above CHECKIN_MAX_ANSWER_SCALARS scalars. */
  | "answer-too-long"
  /** An answer naming a question order the captured set does not hold. */
  | "answer-without-question"
  /** A second answer for a question order already answered. */
  | "duplicate-answer"
  /** A serialised request above CHECKIN_MAX_REQUEST_BYTES bytes. */
  | "request-too-large"
  /** A share of a check-in that has no private draft to snapshot. */
  | "no-private-draft"
  /** A share naming no recipient, which would share with nobody. */
  | "no-recipients"
  /** A share of a check-in that already has a shared revision. */
  | "already-shared"
  /** A change to a shared revision that is not shared: never shared, or withdrawn. */
  | "not-shared"
  /** A change made against a revision the record has moved past. */
  | "stale-revision"
  /** The check-in source could not be read. */
  | "unavailable";

/** One limit violation, carrying the field path, the measured value and the limit it exceeded. */
export interface CheckInViolation {
  /** The field path the violation belongs to: `questions`, `questions[0].wording`, `answers[2].text`, `request`. */
  readonly path: string;
  readonly reason: CheckInRefusalReason;
  /** The value as measured: Unicode scalar values, a question order, a count, or bytes. */
  readonly measured: number;
  /** The limit that measured value was compared against, in the same unit. */
  readonly limit: number;
  /** Readable message naming both the measured value and the limit; it never quotes an answer. */
  readonly message: string;
}

/** A refused check-in request: returned as a value, so the caller keeps the text it already holds. */
export interface CheckInRefusal {
  readonly reason: CheckInRefusalReason;
  /** Readable message for the worker; it never repeats check-in text and never claims a delivery. */
  readonly message: string;
  /** Every limit violation found, in a fixed order; the first one's reason is the refusal's reason. */
  readonly violations: readonly CheckInViolation[];
  /** Present for `stale-revision`, so the caller can place its input beside the current value. */
  readonly revisionMismatch?: { readonly expected: number; readonly actual: number };
}

/** An applied check-in change, or an explicit statement that nothing changed. */
export interface CheckInMutationAccepted {
  /** The check-in as it now stands, immutable: the caller renders this, not a second copy. */
  readonly checkIn: CheckIn;
  /** The revision identities the record carries after the change. */
  readonly revisions: CheckInRevisions;
  readonly state: CheckInState;
  /** The record revision after the change; unchanged together with `changed: false`. */
  readonly revision: number;
  /** False when the payload would produce no change, which the service answers as `unchanged`. */
  readonly changed: boolean;
  /** Readable outcome for the worker, stating what was and was not effected. */
  readonly message: string;
}

/** The outcome of a check-in change: accepted with its revisions, or refused with its reason. */
export type CheckInMutation = Result<CheckInMutationAccepted, CheckInRefusal>;

// ---------------------------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------------------------

/**
 * The availability a command assumes about its own record: the caller loaded the check-in, so the
 * state reasoned about here is the record's own and not the source's. A read that has not loaded
 * the record reports availability itself.
 */
const AVAILABLE_SOURCE: CheckInSourceAvailability = "available";

/** UTF-8 encoder for the request ceiling, built once because it holds no state between calls. */
const UTF8_ENCODER = new TextEncoder();

/**
 * Length of a text in Unicode scalar values.
 *
 * Counted by iterating its code points, so an astral character counts once rather than as the two
 * UTF-16 units `String.prototype.length` reports, and a combining sequence counts each scalar it is
 * built from. Every limit in this file is measured with this one function, so no second counting
 * rule can disagree with it.
 */
function scalarLength(text: string): number {
  return Array.from(text).length;
}

/** Bytes of the serialised request, which is the number the transport itself measures. */
function requestByteLength(payload: CheckInPayload): number {
  return UTF8_ENCODER.encode(JSON.stringify(payload)).byteLength;
}

/** One violation, with the message that names both the measured value and the limit it exceeded. */
function violation(
  path: string,
  reason: CheckInRefusalReason,
  measured: number,
  limit: number,
  message: string,
): CheckInViolation {
  return { path, reason, measured, limit, message };
}

/** A refusal carrying its reason, its readable message and any violations found. */
function refusal(
  reason: CheckInRefusalReason,
  message: string,
  violations: readonly CheckInViolation[] = [],
  revisionMismatch?: { readonly expected: number; readonly actual: number },
): CheckInRefusal {
  return { reason, message, violations, revisionMismatch };
}

/** The question-set violations: the count limit, then each question's own scalar limit. */
function questionSetViolations(questions: readonly CheckInQuestion[]): CheckInViolation[] {
  const violations: CheckInViolation[] = [];

  if (questions.length > CHECKIN_MAX_QUESTIONS) {
    violations.push(
      violation(
        "questions",
        "too-many-questions",
        questions.length,
        CHECKIN_MAX_QUESTIONS,
        `This check-in carries ${questions.length} of ${CHECKIN_MAX_QUESTIONS} questions; a check-in carries at most ${CHECKIN_MAX_QUESTIONS} questions.`,
      ),
    );
  }

  questions.forEach((question, index) => {
    const length = scalarLength(question.wording);
    if (length <= CHECKIN_MAX_QUESTION_SCALARS) return;
    violations.push(
      violation(
        `questions[${index}].wording`,
        "question-too-long",
        length,
        CHECKIN_MAX_QUESTION_SCALARS,
        `Question ${index + 1} is ${length} of ${CHECKIN_MAX_QUESTION_SCALARS} characters; it is refused rather than shortened.`,
      ),
    );
  });

  return violations;
}

/**
 * The answer violations: an answer naming a question the captured set does not hold, a second
 * answer for one question, then each answer's own scalar limit.
 *
 * Answers are measured against the captured set the payload carries, because that set is the one
 * `captureQuestions` freezes; an answer whose prompt the worker never asked is refused rather than
 * attached to a neighbouring question.
 */
function answerViolations(
  questions: readonly CheckInQuestion[],
  answers: readonly CheckInAnswer[],
): CheckInViolation[] {
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

    if (order !== null && !capturedOrders.has(order)) {
      violations.push(
        violation(
          `answers[${index}].questionOrder`,
          "answer-without-question",
          order,
          questions.length,
          `Answer ${index + 1} answers question ${order}, and the captured question set holds no question at that order (${questions.length} captured).`,
        ),
      );
    }

    if (order !== null && capturedOrders.has(order)) {
      const count = answerCounts.get(order) ?? 1;
      // Reported once per question rather than once per extra answer, so one duplicated question
      // reads as one problem instead of a growing list.
      if (count > 1 && !reportedDuplicates.has(order)) {
        reportedDuplicates.add(order);
        violations.push(
          violation(
            `answers[${index}].questionOrder`,
            "duplicate-answer",
            count,
            1,
            `Question ${order} has ${count} of 1 answers; a check-in answers each captured question at most once.`,
          ),
        );
      }
    }

    const length = scalarLength(answer.text);
    if (length <= CHECKIN_MAX_ANSWER_SCALARS) return;
    violations.push(
      violation(
        `answers[${index}].text`,
        "answer-too-long",
        length,
        CHECKIN_MAX_ANSWER_SCALARS,
        `Answer ${index + 1} is ${length} of ${CHECKIN_MAX_ANSWER_SCALARS} characters; it is refused rather than shortened.`,
      ),
    );
  });

  return violations;
}

/** The refusal a non-empty violation list earns, or null when there is nothing to refuse. */
function violationsRefusal(violations: readonly CheckInViolation[]): CheckInRefusal | null {
  const [first, ...rest] = violations;
  if (first === undefined) return null;
  const message =
    rest.length === 0
      ? first.message
      : `${first.message} ${rest.length} further ${
          rest.length === 1 ? "issue is" : "issues are"
        } present in the same request.`;
  return refusal(first.reason, message, violations);
}

/**
 * The single gate every save, share and update passes: the payload unchanged when it is within every
 * limit, or the refusal naming every violation when it is not. Nothing is ever adjusted to fit.
 */
function admittedPayload(payload: CheckInPayload): Result<CheckInPayload, CheckInRefusal> {
  const limitRefusal = violationsRefusal(validateCheckInRequest(payload));
  return limitRefusal === null ? ok(payload) : err(limitRefusal);
}

/** The refusal for a change made against a revision the record has moved past, or null when current. */
function staleRevisionRefusal(checkIn: CheckIn, expectedRevision: number): CheckInRefusal | null {
  if (checkIn.revision === expectedRevision) return null;
  return refusal(
    "stale-revision",
    `This check-in changed while you were working: it is now at revision ${checkIn.revision} and this change was made against revision ${expectedRevision}. Nothing was written.`,
    [],
    { expected: expectedRevision, actual: checkIn.revision },
  );
}

/**
 * The refusal each non-shared state earns when a change needs a shared revision.
 *
 * Typed over `Exclude<CheckInState, "shared">`, so a fifth read state cannot be added to the closed
 * union without deciding here what a change to it means.
 */
const NON_SHARED_REFUSALS: Readonly<Record<Exclude<CheckInState, "shared">, CheckInRefusal>> = {
  "private-draft": refusal(
    "not-shared",
    "This check-in has not been shared with a coach yet, so there is no shared revision to change. Share it first.",
  ),
  withdrawn: refusal(
    "not-shared",
    "This check-in was withdrawn, so a coach can no longer read it and its shared revision is not changed. Write a new check-in instead.",
  ),
  unavailable: refusal(
    "unavailable",
    "The check-in source is unavailable right now, so nothing was read or written. Try again when the source is available.",
  ),
};

/** The shared revision a change may act on, or the refusal that says why there is none. */
function sharedRevisionOf(checkIn: CheckIn): Result<CheckInSharedRevision, CheckInRefusal> {
  const state = checkInReadState(checkIn, AVAILABLE_SOURCE);
  if (state !== "shared") return err(NON_SHARED_REFUSALS[state]);
  const { shared } = checkIn;
  // "shared" is derived from this field, so a shared state always carries it; the guard states the
  // invariant rather than asserting it away.
  if (shared === undefined) return err(NON_SHARED_REFUSALS["private-draft"]);
  return ok(shared);
}

/** The revision identities a record carries, projected for the service record. */
function revisionsOf(checkIn: CheckIn): CheckInRevisions {
  const { privateDraft, shared } = checkIn;
  return {
    privateDraftRevisionId: privateDraft?.revisionId,
    sharedRevisionId: shared?.revisionId,
    sharedRevisionWithdrawnAt: shared?.withdrawnAt,
  };
}

/** An applied change, or the explicit statement that the payload produced none. */
function accepted(checkIn: CheckIn, changed: boolean, message: string): CheckInMutationAccepted {
  return {
    checkIn,
    revisions: revisionsOf(checkIn),
    state: checkInReadState(checkIn, AVAILABLE_SOURCE),
    revision: checkIn.revision,
    changed,
    message,
  };
}

/** A frozen copy of the answers supplied, so no caller's array can reach into a stored revision. */
function freezeAnswers(answers: readonly CheckInAnswer[]): readonly CheckInAnswer[] {
  return Object.freeze(
    answers.map((answer) =>
      Object.freeze({ questionOrder: answer.questionOrder, text: answer.text }),
    ),
  );
}

/** Whether two question sets hold the same wording in the same order; the capture instant is not a change. */
function sameQuestions(
  left: readonly CheckInQuestion[],
  right: readonly CheckInQuestion[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((question, index) => {
    const other = right[index];
    return (
      other !== undefined && other.order === question.order && other.wording === question.wording
    );
  });
}

/** Whether two answer lists hold the same text against the same questions, in the same order. */
function sameAnswers(left: readonly CheckInAnswer[], right: readonly CheckInAnswer[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((answer, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      other.questionOrder === answer.questionOrder &&
      other.text === answer.text
    );
  });
}

/**
 * The coaches a share names, as they were supplied.
 *
 * An identifier is opaque and is kept exactly, because reinterpreting or rewriting one would change
 * who it names. A blank entry names nobody and is not recorded, and a repeated identifier is
 * recorded once so one coach cannot hold two places in one share.
 */
function namedRecipients(recipients: readonly string[]): readonly string[] {
  const named: string[] = [];
  for (const recipient of recipients) {
    if (recipient.trim().length === 0) continue;
    if (!named.includes(recipient)) named.push(recipient);
  }
  return Object.freeze(named);
}

// ---------------------------------------------------------------------------------------------
// Derived revision identity
// ---------------------------------------------------------------------------------------------

/** The revision id of a private draft saved at a stated record revision: derived, never random. */
function privateRevisionId(checkInId: string, revision: number): string {
  return `${checkInId}:private:${revision}`;
}

/** The revision id of a shared revision created at a stated record revision: derived, never random. */
function sharedRevisionId(checkInId: string, revision: number): string {
  return `${checkInId}:shared:${revision}`;
}

// ---------------------------------------------------------------------------------------------
// Reads: the state a check-in is in
// ---------------------------------------------------------------------------------------------

/**
 * Resolves the state a check-in is read in — `private-draft`, `shared`, `withdrawn` or `unavailable`
 * — so "not shared yet", "shared", "withdrawn" and "the source could not be read" stay four separate
 * answers, and never an empty check-in.
 */
export function checkInReadState(
  checkIn: CheckIn | null,
  sourceAvailability: CheckInSourceAvailability,
): CheckInState {
  if (sourceAvailability === "unavailable") return "unavailable";
  // A record that could not be loaded is a source that could not be read, never a check-in holding
  // nothing: those are different facts and a surface has to say which one it has.
  if (checkIn === null) return "unavailable";
  const { shared } = checkIn;
  if (shared === undefined) return "private-draft";
  return shared.withdrawnAt === undefined ? "shared" : "withdrawn";
}

// ---------------------------------------------------------------------------------------------
// Capture and limits
// ---------------------------------------------------------------------------------------------

/**
 * Captures an optional question set — at most five questions of at most 500 scalars each — as a
 * frozen deep copy stamped with the instant the editor opened; returns the captured set, or the
 * refusal naming every violation rather than a set with the extra questions left out.
 *
 * Later edits to the caller's array reach nothing already captured, so a shared check-in renders the
 * wording that was captured and not the set as it stands today.
 */
export function captureQuestions(
  questions: readonly CheckInQuestion[],
  capturedAt: CheckInInstant,
): Result<CapturedQuestionSet, CheckInRefusal> {
  const captureRefusal = violationsRefusal(questionSetViolations(questions));
  if (captureRefusal !== null) return err(captureRefusal);

  const captured: readonly CheckInQuestion[] = Object.freeze(
    questions.map((question) =>
      Object.freeze({ wording: question.wording, order: question.order }),
    ),
  );

  return ok(Object.freeze({ questions: captured, capturedAt }));
}

/**
 * The one limit check for a check-in request: question count, each question's scalars, at most one
 * answer per captured question, each answer's scalars, and the serialised request's bytes; returns
 * every violation with its field path, measured value and limit, and neither changes the payload nor
 * makes any value fit a limit.
 */
export function validateCheckInRequest(payload: CheckInPayload): readonly CheckInViolation[] {
  const violations: CheckInViolation[] = [];

  const requestBytes = requestByteLength(payload);
  if (requestBytes > CHECKIN_MAX_REQUEST_BYTES) {
    violations.push(
      violation(
        "request",
        "request-too-large",
        requestBytes,
        CHECKIN_MAX_REQUEST_BYTES,
        `This check-in request is ${requestBytes} of ${CHECKIN_MAX_REQUEST_BYTES} bytes; it is refused rather than shortened.`,
      ),
    );
  }

  violations.push(...questionSetViolations(payload.questions));
  violations.push(...answerViolations(payload.questions, payload.answers));

  return violations;
}

// ---------------------------------------------------------------------------------------------
// The private draft: autosave, which shares nothing
// ---------------------------------------------------------------------------------------------

/**
 * Saves the worker's private draft — the only revision an autosave touches, so nothing becomes
 * readable by a coach here; returns the saved record, or the refusal (a stale revision, or the
 * violations that stopped it). Text identical to the stored draft is accepted with `changed: false`
 * and no new revision.
 */
export function savePrivateDraft(
  checkIn: CheckIn,
  payload: CheckInPayload,
  expectedRevision: number,
  now: CheckInInstant,
): CheckInMutation {
  const stale = staleRevisionRefusal(checkIn, expectedRevision);
  if (stale !== null) return err(stale);

  const admitted = admittedPayload(payload);
  if (!admitted.ok) return err(admitted.error);

  const captured = captureQuestions(payload.questions, now);
  if (!captured.ok) return err(captured.error);

  const answers = freezeAnswers(payload.answers);
  const existing = checkIn.privateDraft;
  if (
    existing !== undefined &&
    sameQuestions(existing.captured.questions, captured.value.questions) &&
    sameAnswers(existing.answers, answers)
  ) {
    return ok(
      accepted(checkIn, false, "This private draft already holds that text, so nothing changed."),
    );
  }

  const revision = checkIn.revision + 1;
  const next: CheckIn = {
    ...checkIn,
    revision,
    privateDraft: {
      revisionId: privateRevisionId(checkIn.checkInId, revision),
      captured: captured.value,
      answers,
      savedAt: now,
    },
  };

  return ok(
    accepted(
      next,
      true,
      "The private draft is saved. It stays your own working text: a coach sees nothing until you share this check-in.",
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Sharing: one shared revision, changed only by an explicit update
// ---------------------------------------------------------------------------------------------

/**
 * Shares the saved private draft by creating the shared revision a named coach may read, recording
 * the recipients and the share duration; returns the shared record, or the refusal (a stale
 * revision, no draft to share, no named recipient, an earlier share, or the violations that stopped
 * it).
 *
 * Sharing notifies nobody, records no consent for any purpose, logs no interaction and creates no
 * task: it makes a revision the worker already wrote readable, and nothing more.
 */
export function shareCheckIn(
  checkIn: CheckIn,
  expectedRevision: number,
  recipients: readonly string[],
  duration: CheckInShareDuration,
  now: CheckInInstant,
): CheckInMutation {
  const stale = staleRevisionRefusal(checkIn, expectedRevision);
  if (stale !== null) return err(stale);

  if (checkIn.shared !== undefined) {
    return err(
      refusal(
        "already-shared",
        "This check-in already has a shared revision. Update the shared check-in to change what a coach reads; sharing it again would create a second revision of the same check-in.",
      ),
    );
  }

  const draft = checkIn.privateDraft;
  if (draft === undefined) {
    return err(
      refusal(
        "no-private-draft",
        "There is no private draft to share yet. Save the draft, then share it.",
      ),
    );
  }

  const named = namedRecipients(recipients);
  if (named.length === 0) {
    return err(
      refusal(
        "no-recipients",
        "Name the coach who may read this check-in. A share that names nobody shares nothing.",
      ),
    );
  }

  // The snapshot is measured again on its way out, so a draft stored before a limit was in force
  // cannot become readable by a coach while it is over a limit.
  const admitted = admittedPayload({ questions: draft.captured.questions, answers: draft.answers });
  if (!admitted.ok) return err(admitted.error);

  // The shared revision holds its own frozen copy rather than an alias of the private draft, so no
  // later private save can reach the snapshot through the object the draft still references.
  const snapshot = captureQuestions(draft.captured.questions, draft.captured.capturedAt);
  if (!snapshot.ok) return err(snapshot.error);

  const revision = checkIn.revision + 1;
  const next: CheckIn = {
    ...checkIn,
    revision,
    shared: {
      revisionId: sharedRevisionId(checkIn.checkInId, revision),
      captured: snapshot.value,
      answers: freezeAnswers(draft.answers),
      recipients: named,
      duration,
      sharedAt: now,
      updatedAt: now,
    },
  };

  return ok(
    accepted(
      next,
      true,
      "This check-in is shared with the named coach for the recorded duration. Sharing sends no notification and creates no task; it makes the saved private revision readable.",
    ),
  );
}

/**
 * Changes the shared revision, which no other operation may, by replacing its answers; returns the
 * updated record, or the refusal (a stale revision, not shared, or the violations that stopped it).
 *
 * The captured question set of the shared revision governs and the payload's question wordings are
 * not stored, so a coach renders the wording that was captured and the prompts cannot change behind
 * an update. An answer for a question outside that set is refused rather than attached to it.
 */
export function updateSharedCheckIn(
  checkIn: CheckIn,
  payload: CheckInPayload,
  expectedRevision: number,
  now: CheckInInstant,
): CheckInMutation {
  const stale = staleRevisionRefusal(checkIn, expectedRevision);
  if (stale !== null) return err(stale);

  const shared = sharedRevisionOf(checkIn);
  if (!shared.ok) return err(shared.error);
  const current = shared.value;

  const admitted = admittedPayload({
    questions: current.captured.questions,
    answers: payload.answers,
  });
  if (!admitted.ok) return err(admitted.error);

  const answers = freezeAnswers(payload.answers);
  if (sameAnswers(current.answers, answers)) {
    return ok(
      accepted(
        checkIn,
        false,
        "The shared check-in already holds these answers, so nothing changed.",
      ),
    );
  }

  const revision = checkIn.revision + 1;
  const next: CheckIn = {
    ...checkIn,
    revision,
    shared: { ...current, answers, updatedAt: now },
  };

  return ok(
    accepted(
      next,
      true,
      "The shared check-in now holds these answers, so a coach reading it sees the updated revision.",
    ),
  );
}

/**
 * Withdraws the shared revision, so a coach can no longer read it; returns the withdrawn record, or
 * the refusal (a stale revision, or nothing shared to withdraw).
 *
 * This function reads only this check-in's revision and shared state and validates no content at
 * all, so a draft that is invalid anywhere else in the application cannot block containment. The
 * message it returns claims no recall: withdrawal removes access from this moment and cannot take
 * back what a coach has already read.
 */
export function withdrawSharedCheckIn(
  checkIn: CheckIn,
  expectedRevision: number,
  now: CheckInInstant,
): CheckInMutation {
  const stale = staleRevisionRefusal(checkIn, expectedRevision);
  if (stale !== null) return err(stale);

  // Withdrawing what is already withdrawn changes nothing, and saying so is more useful than a
  // refusal: the intent is already satisfied.
  if (checkInReadState(checkIn, AVAILABLE_SOURCE) === "withdrawn") {
    return ok(accepted(checkIn, false, "This check-in is already withdrawn, so nothing changed."));
  }

  const shared = sharedRevisionOf(checkIn);
  if (!shared.ok) return err(shared.error);

  const revision = checkIn.revision + 1;
  const next: CheckIn = {
    ...checkIn,
    revision,
    shared: { ...shared.value, withdrawnAt: now },
  };

  return ok(
    accepted(
      next,
      true,
      "This check-in is withdrawn from now on: a coach can no longer open it. Withdrawal removes access from this moment; it does not take back anything a coach has already read.",
    ),
  );
}
