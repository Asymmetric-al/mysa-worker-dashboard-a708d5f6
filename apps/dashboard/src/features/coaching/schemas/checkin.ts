/**
 * The Coaching family's check-in payload schemas — `saveCheckIn` (private autosave), `shareCheckIn`,
 * `updateSharedCheckIn` and `withdrawCheckIn` — together with the one limits refinement the three
 * body-bearing ones share.
 */
import { z } from "zod";
import { CHECKIN_MAX_ANSWER_SCALARS, CHECKIN_MAX_QUESTION_SCALARS, CHECKIN_MAX_QUESTIONS, CHECKIN_MAX_REQUEST_BYTES } from "@/modules/coaching/checkin";
import { LIMIT_COPY } from "../copy";
// Wording this schema set needs and the family's copy module does not hold yet
const CHECKIN_SCHEMA_MESSAGES = {
  missingCheckIn: "This change belongs to one check-in, so reopen the check-in from its list and try again.",
  missingSharedRevision: "This change belongs to one shared revision, so reopen the check-in and try again.",
  questionNotText: "A question is plain text, so take out anything that is not text and save again.",
  answerNotText: "An answer is plain text, so take out anything that is not text and save again.",
} as const;
function answersMisaligned(answers: number, questions: number): string {
  return `This check-in carries ${answers} answers and ${questions} questions. ` + "Nothing was padded or dropped: give each question one answer and save again.";
}
// The identifier and text shapes all four payloads share
const checkInIdSchema = z.string({ error: CHECKIN_SCHEMA_MESSAGES.missingCheckIn }).min(1, CHECKIN_SCHEMA_MESSAGES.missingCheckIn);

const sharedRevisionIdSchema = z.string({ error: CHECKIN_SCHEMA_MESSAGES.missingSharedRevision }).min(1, CHECKIN_SCHEMA_MESSAGES.missingSharedRevision);

const questionsSchema = z.array(z.string({ error: CHECKIN_SCHEMA_MESSAGES.questionNotText }), {
  error: CHECKIN_SCHEMA_MESSAGES.questionNotText,
});
const answersSchema = z.array(z.string({ error: CHECKIN_SCHEMA_MESSAGES.answerNotText }), {
  error: CHECKIN_SCHEMA_MESSAGES.answerNotText,
});
// The one limits refinement the body-bearing payloads share
interface CheckInBody {
  readonly questions: readonly string[];
  readonly answers: readonly string[];
}
function scalarLength(text: string): number {
  return Array.from(text).length;
}
const UTF8_ENCODER = new TextEncoder();

function payloadByteLength(payload: CheckInBody): number {
  return UTF8_ENCODER.encode(JSON.stringify(payload)).byteLength;
}
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
// Private autosave, and the share that makes the saved revision readable
/** `saveCheckIn` — the private autosave. */
export const saveCheckInPayloadSchema = z
  .strictObject({
    checkInId: checkInIdSchema.optional(),
    questions: questionsSchema,
    answers: answersSchema,
  })
  .superRefine(applyCheckInLimits);
/** The validated body of a `saveCheckIn` request: private working text, and the draft it extends. */
export type CheckInSavePayload = z.infer<typeof saveCheckInPayloadSchema>;
/** `shareCheckIn` — the one act that makes a revision readable by a named coach. */
export const shareCheckInPayloadSchema = z
  .strictObject({
    checkInId: checkInIdSchema,
    questions: questionsSchema,
    answers: answersSchema,
  })
  .superRefine(applyCheckInLimits);
/** The validated body of a `shareCheckIn` request: the check-in, and the text a coach begins to read. */
export type CheckInSharePayload = z.infer<typeof shareCheckInPayloadSchema>;
// Changing what a coach reads, and ending it
/** `updateSharedCheckIn` — the only way a shared revision changes. */
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
/** `withdrawCheckIn` — ending a coach's access to the shared revision. */
export const withdrawCheckInPayloadSchema = z.strictObject({
  checkInId: checkInIdSchema,
  sharedRevisionId: sharedRevisionIdSchema,
});
/** The validated body of a `withdrawCheckIn` request: which check-in, and which shared revision. */
export type CheckInWithdrawPayload = z.infer<typeof withdrawCheckInPayloadSchema>;
