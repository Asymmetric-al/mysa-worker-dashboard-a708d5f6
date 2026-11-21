/**
 * The Coaching family's check-in payload schemas — `saveCheckIn` (private autosave), `shareCheckIn`,
 * `updateSharedCheckIn` and `withdrawCheckIn` — together with the one limits refinement the three
 * body-bearing ones share.
 *
 * Plan items that put this file in scope:
 * - AAP 0.11.1 deliverable row `apps/dashboard/src/features/coaching/**`: the Coaching family's Zod
 *   schemas for the invitation, module, target, check-in, task-share and stop payloads.
 * - AAP 0.6.1 "Mutations: coaching" and AAP 0.6.3 `POST /api/coaching/checkins`, whose four check-in
 *   mutations are the four schemas below.
 * - AAP 0.8.4 coaching rule row on check-ins (plain text, a captured question set, private autosave
 *   visibly separate from Share, a shared check-in changed only by its own update, withdrawal that
 *   works despite an invalid draft) and AAP 0.8.7's check-in limits, which are imported here and
 *   never restated.
 * - Acceptance criterion 16, whose check-in half is proven by `tests/domain/coaching-limits.test.ts`
 *   and the `coaching-share-revoke` browser journey; this file is the pre-submit guard those
 *   journeys pass through on their way to the service.
 *
 * One schema per named mutation, and nothing shared between them beyond one refinement, one
 * identifier shape and one text shape. A body can therefore only ever mean one thing: there is no
 * generic field bag, no create-or-update form and no universal command shape, which is the dispatcher
 * this application deliberately does not have, and no `payloadSchema(fields)` factory either.
 *
 * A schema here validates the **payload alone**. The four-field mutation input — operation identity,
 * selected context, expected revision and the payload — is composed once in
 * `../hooks/use-coaching-mutations.ts`, so nothing below declares an operation id, a scope or an
 * expected revision, reads a clock, or compares a revision. Each object is strict, so an envelope
 * field smuggled into a payload is refused rather than trusted.
 *
 * The limits are refused, never fitted. An answer above its scalar limit is refused with the count it
 * measured, a question set above its count is refused as that count, and a payload above the request
 * ceiling is refused with its byte size. Nothing here trims, slices, pads or coerces a value to make
 * it fit: an answer cut down to size is no longer the answer the worker wrote, so every refusal keeps
 * the text exactly as it arrived and leaves the choice of what to shorten with the person who wrote
 * it. No refusal message ever says that something was shortened.
 *
 * This is the client's mirror, never the authority. `validateCheckInRequest` and `captureQuestions` in
 * `@/modules/coaching/checkin.ts` re-measure every payload, and the per-mutation schemas in
 * `@/modules/data-service/mutations/coaching.ts` are the ones the service answers with; the closed
 * outcome set — `invalid` with per-field messages, `conflict` on a stale revision, `denied` on a
 * refused scope — is rendered from what the service returns, never inferred from a parse here.
 *
 * What is deliberately absent: no React, hook, component or JSX; no `fetch`, transport or store; no
 * clock read and no timezone arithmetic; no module belonging to another feature; no `@ui-sdk/*` or
 * `@base-ui/react`; and no limit written as a numeral, because every bound arrives from the domain
 * module that enforces it.
 */

import { z } from "zod";

import {
  CHECKIN_MAX_ANSWER_SCALARS,
  CHECKIN_MAX_QUESTION_SCALARS,
  CHECKIN_MAX_QUESTIONS,
  CHECKIN_MAX_REQUEST_BYTES,
} from "@/modules/coaching/checkin";

import { LIMIT_COPY } from "../copy";

// ---------------------------------------------------------------------------------------------
// Wording this schema set needs and the family's copy module does not hold yet
// ---------------------------------------------------------------------------------------------

/**
 * The shape messages this schema set needs that `../copy.ts` owns no key for yet: the two "which
 * record" refusals and the two plain-text refusals.
 *
 * `LIMIT_COPY` words every limit the domain enforces, and a missing identifier or a non-text entry is
 * not a limit — it is a shape the form should never build — so these four are declared here rather
 * than as limit builders. They belong in `../copy.ts` beside the family's other schema wording the
 * moment that catalogue is next edited, and they are gathered here so that no schema below carries a
 * message literal inline.
 */
const CHECKIN_SCHEMA_MESSAGES = {
  missingCheckIn:
    "This change belongs to one check-in, so reopen the check-in from its list and try again.",
  missingSharedRevision:
    "This change belongs to one shared revision, so reopen the check-in and try again.",
  questionNotText:
    "A question is plain text, so take out anything that is not text and save again.",
  answerNotText: "An answer is plain text, so take out anything that is not text and save again.",
} as const;

/**
 * The one refusal `../copy.ts` has no builder for: a check-in whose answers no longer line up with
 * the questions it carries.
 *
 * It is a pairing failure rather than a size refusal, so the sentence names both counts instead of a
 * measured value beside a limit. Everything else a refusal can say in this file is built by
 * `LIMIT_COPY` from the constants the domain enforces.
 */
function answersMisaligned(answers: number, questions: number): string {
  return (
    `This check-in carries ${answers} answers and ${questions} questions. ` +
    "Nothing was padded or dropped: give each question one answer and save again."
  );
}

// ---------------------------------------------------------------------------------------------
// The identifier and text shapes all four payloads share
// ---------------------------------------------------------------------------------------------

/**
 * A check-in reference, and the shared-revision reference beside it: opaque, non-empty, carried
 * exactly as it arrived.
 *
 * An identifier is never parsed, trimmed, case-folded or compared with a name, an email address or a
 * numeric fragment of another system's id — equal-looking identifiers establish neither identity nor
 * authority (AAP 0.7.1). Rewriting one would change which record the change applies to, so the only
 * thing checked is that the caller sent something rather than nothing. No upper bound is imposed: the
 * domain fixes none, and a maximum invented here would refuse a record the service accepts.
 */
const checkInIdSchema = z
  .string({ error: CHECKIN_SCHEMA_MESSAGES.missingCheckIn })
  .min(1, CHECKIN_SCHEMA_MESSAGES.missingCheckIn);

/** The shared revision a change replaces or a withdrawal ends: its identity is part of the intent. */
const sharedRevisionIdSchema = z
  .string({ error: CHECKIN_SCHEMA_MESSAGES.missingSharedRevision })
  .min(1, CHECKIN_SCHEMA_MESSAGES.missingSharedRevision);

/**
 * The question set as the editor holds it: one plain-text entry per prompt, in the order shown.
 *
 * An empty array is the legal "no questions" form — the question set is optional — and the count and
 * each entry's length are measured by {@link applyCheckInLimits}, not by a bound declared here.
 */
const questionsSchema = z.array(z.string({ error: CHECKIN_SCHEMA_MESSAGES.questionNotText }), {
  error: CHECKIN_SCHEMA_MESSAGES.questionNotText,
});

/**
 * One plain-text answer per captured question, in the same order.
 *
 * Plain text is the whole format: a check-in carries no markup, no attachment and no structured
 * field, so an answer is a string and nothing else. Alignment with the questions, the count and each
 * answer's length are measured by {@link applyCheckInLimits}.
 */
const answersSchema = z.array(z.string({ error: CHECKIN_SCHEMA_MESSAGES.answerNotText }), {
  error: CHECKIN_SCHEMA_MESSAGES.answerNotText,
});

// ---------------------------------------------------------------------------------------------
// The one limits refinement the body-bearing payloads share
// ---------------------------------------------------------------------------------------------

/** The body three of these payloads carry: the questions as worded, and one answer per question. */
interface CheckInBody {
  readonly questions: readonly string[];
  readonly answers: readonly string[];
}

/**
 * Length of a text in Unicode scalar values.
 *
 * Counted by iterating code points with `Array.from`, so a supplementary-plane character counts once
 * rather than as the two UTF-16 units `String.prototype.length` reports, and a check-in that is
 * within its limit is never refused for containing an emoji. The domain measures with the same rule,
 * which is why `z.string().max()` is not used for either text limit: that would count UTF-16 units and
 * refuse text the service accepts.
 */
function scalarLength(text: string): number {
  return Array.from(text).length;
}

/** UTF-8 encoder for the byte measurement, built once because it holds no state between calls. */
const UTF8_ENCODER = new TextEncoder();

/**
 * Bytes of the serialised payload, which is the unit the request ceiling is stated in.
 *
 * Encoded rather than counted in characters, because a worker writing in a non-Latin script reaches a
 * byte ceiling at a third of the characters a Latin-script worker does, and `JSON.stringify(...).length`
 * would let that payload through only for the transport to refuse it.
 */
function payloadByteLength(payload: CheckInBody): number {
  return UTF8_ENCODER.encode(JSON.stringify(payload)).byteLength;
}

/**
 * The one limits refinement the body-bearing check-in payloads share: every violation, with its own
 * field path, so a form can mark each question and each answer rather than reporting one failure at a
 * time.
 *
 * It reports all of them and stops at none — no early `return` — because a worker who submits one
 * over-long answer and one over-long question should be told about both now, not in two round trips.
 *
 * The question count is checked here rather than with `.max()` on the array, and that is deliberate:
 * Zod skips an object-level refinement once a field's own check has failed, so a count bound on the
 * field would suppress every question and answer violation in the same payload and would answer with
 * a sentence that is not `LIMIT_COPY`'s. Checking the count in this pass keeps one submit reporting
 * every violation at once, each in the catalogue's wording with the value it measured.
 *
 * The byte measurement is a fast pre-submit guard on the **serialised payload**. The ceiling itself is
 * stated against the whole serialised request, and `validateCheckInRequest` in
 * `@/modules/coaching/checkin.ts` is authoritative: it re-measures the full
 * `{ operationId, scope, expectedRevision, payload }` request against the same constant. Nothing here
 * subtracts an allowance for the envelope — an invented overhead would be a second, wrong limit — and
 * a payload that passes this refinement has not been accepted by anything: acceptance is the service's
 * answer, and only that answer is reported to the worker.
 */
function applyCheckInLimits(payload: CheckInBody, context: z.RefinementCtx): void {
  const { questions, answers } = payload;

  if (questions.length > CHECKIN_MAX_QUESTIONS) {
    context.addIssue({
      code: "custom",
      path: ["questions"],
      message: LIMIT_COPY.questionSetExceeded(questions.length),
    });
  }

  for (let index = 0; index < questions.length; index += 1) {
    const wording = questions[index];
    if (wording === undefined) continue;
    const scalars = scalarLength(wording);
    if (scalars <= CHECKIN_MAX_QUESTION_SCALARS) continue;
    context.addIssue({
      code: "custom",
      path: ["questions", index],
      // The catalogue counts a question's position from one, which is the number the form shows.
      message: LIMIT_COPY.questionTextExceeded(index + 1, scalars),
    });
  }

  // Answers pair with questions by position, so a list that no longer lines up is refused rather than
  // padded with empty text or matched by guesswork: a padded answer would read as an answer the worker
  // never wrote.
  if (answers.length !== questions.length) {
    context.addIssue({
      code: "custom",
      path: ["answers"],
      message: answersMisaligned(answers.length, questions.length),
    });
  }

  for (let index = 0; index < answers.length; index += 1) {
    const text = answers[index];
    if (text === undefined) continue;
    const scalars = scalarLength(text);
    if (scalars <= CHECKIN_MAX_ANSWER_SCALARS) continue;
    context.addIssue({
      code: "custom",
      path: ["answers", index],
      message: LIMIT_COPY.answerTextExceeded(index + 1, scalars),
    });
  }

  const bytes = payloadByteLength(payload);
  if (bytes > CHECKIN_MAX_REQUEST_BYTES) {
    // No path: the ceiling belongs to the request as a whole, so the issue is raised against the form
    // rather than against a field that does not exist.
    context.addIssue({ code: "custom", message: LIMIT_COPY.requestSizeExceeded(bytes) });
  }
}

// ---------------------------------------------------------------------------------------------
// Private autosave, and the share that makes the saved revision readable
// ---------------------------------------------------------------------------------------------

/**
 * `saveCheckIn` — the private autosave.
 *
 * `checkInId` is absent when the worker starts a check-in and present once a private draft exists, so
 * one schema covers the first save and every autosave after it. Saving changes the private draft and
 * nothing else: this payload cannot express recipients, a duration or a shared revision, because an
 * autosave shares nothing with anyone and must not be able to say that it did.
 */
export const saveCheckInPayloadSchema = z
  .strictObject({
    checkInId: checkInIdSchema.optional(),
    questions: questionsSchema,
    answers: answersSchema,
  })
  .superRefine(applyCheckInLimits);

/** The validated body of a `saveCheckIn` request: private working text, and the draft it extends. */
export type CheckInSavePayload = z.infer<typeof saveCheckInPayloadSchema>;

/**
 * `shareCheckIn` — the one act that makes a revision readable by a named coach.
 *
 * The payload carries the question set as it is on screen, because the shared revision is created
 * from the captured set this body holds: the coach then reads exactly the wording the worker was
 * looking at when they shared it, and a later edit to the draft cannot reach it. `checkInId` is
 * required here — a share always names the check-in it shares, never "the one being edited" — and the
 * recipients and the duration are part of the mutation, recorded by the service from the grant.
 */
export const shareCheckInPayloadSchema = z
  .strictObject({
    checkInId: checkInIdSchema,
    questions: questionsSchema,
    answers: answersSchema,
  })
  .superRefine(applyCheckInLimits);

/** The validated body of a `shareCheckIn` request: the check-in, and the text a coach begins to read. */
export type CheckInSharePayload = z.infer<typeof shareCheckInPayloadSchema>;

// ---------------------------------------------------------------------------------------------
// Changing what a coach reads, and ending it
// ---------------------------------------------------------------------------------------------

/**
 * `updateSharedCheckIn` — the only way a shared revision changes.
 *
 * `sharedRevisionId` is required because the identity of the revision being replaced is part of the
 * intent: an update that named no revision could replace one the worker had not read. The body is
 * submitted with the captured questions in front of it, so the same limits and the same alignment rule
 * are measured here as at share time — while the captured set, not this array, remains what the coach
 * renders and the domain stores.
 */
export const updateSharedCheckInPayloadSchema = z
  .strictObject({
    checkInId: checkInIdSchema,
    sharedRevisionId: sharedRevisionIdSchema,
    questions: questionsSchema,
    answers: answersSchema,
  })
  .superRefine(applyCheckInLimits);

/** The validated body of an `updateSharedCheckIn` request: which shared revision, and the new answers. */
export type CheckInUpdateSharedPayload = z.infer<typeof updateSharedCheckInPayloadSchema>;

/**
 * `withdrawCheckIn` — ending a coach's access to the shared revision.
 *
 * It deliberately carries **no** question or answer body, and no refinement is attached. Withdrawal must
 * succeed while the draft body is invalid (AAP 0.8.4): it ends access and deletes nothing, so a body in
 * this payload would let a text validation error block a stop-type effect the worker is entitled to
 * perform at any moment — the one moment they are most likely to want it. The two references are all
 * that is needed to know which shared revision to close.
 */
export const withdrawCheckInPayloadSchema = z.strictObject({
  checkInId: checkInIdSchema,
  sharedRevisionId: sharedRevisionIdSchema,
});

/** The validated body of a `withdrawCheckIn` request: which check-in, and which shared revision. */
export type CheckInWithdrawPayload = z.infer<typeof withdrawCheckInPayloadSchema>;
