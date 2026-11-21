/**
 * The coaching family's two task-sharing payload schemas: `shareTaskSummary` and `stopTaskShare`.
 *
 * A shared task summary is the only thing a coach ever learns about a task, and it is deliberately not
 * the task. The worker writes a short description for sharing and reviews it; the coach reads that
 * description beside the task's live due date and live status. The task's own title, its notes, who it
 * concerns, any financial figure, any file, any link and any record of earlier contact are never
 * shared, so the payload that creates a share cannot carry them at all.
 *
 * Structure, not redaction. A guard that strips private fields would have to know every private field
 * and would leak the day one was added; a strict object that names exactly the fields a share may
 * carry refuses anything else instead, so a later field cannot arrive without an edit here. That is
 * why both schemas below are strict and why neither has a catch-all member: the refusals are the
 * feature.
 *
 * Shape only. Each schema validates the **payload** of a mutation. The four-field input
 * `{ operationId, scope, expectedRevision, payload }` belongs to the service envelope and is composed
 * in `../hooks/`, so no schema here declares an envelope field and none reads a revision. What the
 * description means, whether the task changed after it was reviewed, and whether a recurring task's
 * successor was selected on purpose are decided by `@/modules/coaching/taskshare`, which is where the
 * fingerprint comparison and the successor rule already live.
 *
 * Layering. Plain TypeScript with text and types only: no JSX, no React, no store, no fetch, no clock
 * and no ambient date, so it loads unchanged in a Client Component, a Server Component and a unit
 * test. Every sentence a worker can see comes from the coaching copy catalogue at `../copy.ts`, apart
 * from the few this schema set needs and that catalogue does not word yet; those are declared once in
 * {@link TASK_SHARE_SCHEMA_MESSAGES} and belong beside the rest of the family's wording.
 */
import { z } from "zod";

import { TASK_SUMMARY_MAX_CODE_POINTS } from "@/modules/coaching/taskshare";

import { LIMIT_COPY } from "../copy";

/**
 * The wording this schema set needs and the coaching copy catalogue does not hold yet.
 *
 * Each sentence describes the value that was refused and what to do about it, never the person who
 * typed it, and none of them names a limit: the one limit a payload here enforces is worded by
 * {@link LIMIT_COPY}, which holds the number itself. These three move into `../copy.ts` the moment
 * that catalogue is next edited.
 */
export const TASK_SHARE_SCHEMA_MESSAGES = {
  /** The payload arrived without the task it means to share. */
  taskRequired:
    "This payload names no task, so reload the shared summaries and choose the task again.",
  /** The payload arrived without the occurrence it means to share. */
  occurrenceRequired:
    "This payload names no occurrence, so choose the occurrence you want to share and try again.",
  /** The payload arrived without the reviewed text it means to share. */
  descriptionRequired:
    "This payload carries no description, so write what you want your coach to read and review it before sharing.",
} as const;

/**
 * The reviewed description a worker wrote for sharing: a non-blank string of at most
 * {@link TASK_SUMMARY_MAX_CODE_POINTS} Unicode code points.
 *
 * Measured in code points with `Array.from`, because that is what an author sees: one Arabic letter,
 * one emoji and one Latin letter each count once, while a UTF-16 length would count an emoji twice and
 * refuse text the author could see was within the limit. Zod's own maximum is not used here, because
 * it measures UTF-16 units rather than the characters the limit is stated in.
 *
 * Validated and never adjusted. There is no clipping and no trimming to fit: text over the limit is
 * refused with the count it actually measured, and the worker decides what to take out, because a
 * description quietly shortened here would put words in front of a coach that the worker never
 * reviewed. Blank text is refused rather than stored, so a share never renders as a wordless summary.
 */
const safeDescriptionSchema = z.string().superRefine((description, ctx) => {
  if (description.trim() === "") {
    ctx.addIssue({ code: "custom", message: TASK_SHARE_SCHEMA_MESSAGES.descriptionRequired });
    return;
  }

  const codePoints = Array.from(description).length;
  if (codePoints > TASK_SUMMARY_MAX_CODE_POINTS) {
    ctx.addIssue({ code: "custom", message: LIMIT_COPY.taskDescriptionExceeded(codePoints) });
  }
});

/**
 * Validates the `shareTaskSummary` payload before `../hooks/` submits it as the payload of the
 * four-field mutation input.
 *
 * Four fields and no more, and the omissions are the rule rather than an unfinished list. A strict
 * object refuses every one of these, each of which a later editor might otherwise be tempted to add:
 * the task's title or name; its body or note text; the partner, donor or household it concerns; any
 * amount or currency; any attachment, image or media reference; any source system or source
 * reference; any link or URL; any private history or description of earlier activity; and the due date
 * and status, which the coach's view renders live from the record instead of reading from a payload
 * that would freeze them at submission time.
 */
export const taskSharePayloadSchema = z.strictObject({
  /** The task being shared. */
  taskId: z.string().trim().min(1, TASK_SHARE_SCHEMA_MESSAGES.taskRequired),
  /**
   * The occurrence being shared, and the reason it is explicit rather than inferred.
   *
   * A recurring task's next occurrence never inherits the predecessor's share: inheriting it would put
   * a summary in front of a coach for a piece of work nobody chose to share. The worker selects the
   * occurrence, so its identity travels in the payload. Omitting this field is how the surface says
   * the task does not recur; it is never how the surface says "whichever occurrence is current",
   * because that fallback is exactly the inheritance the rule forbids.
   */
  occurrenceId: z.string().trim().min(1, TASK_SHARE_SCHEMA_MESSAGES.occurrenceRequired).optional(),
  /**
   * The fingerprint of the exact task state the worker reviewed, and an opaque value here.
   *
   * `@/modules/coaching/taskshare` compares it with the fingerprint of the task as it stands when the
   * summary is read, and withholds the description as *needs review* when the two differ. This schema
   * neither parses it, derives it from the title, nor compares it, and no surface renders it: it is a
   * reference to a review, not a description of anything.
   */
  reviewedFingerprint: z
    .string()
    .trim()
    .min(
      1,
      "A shared summary records the review it belongs to, so review the description and share it again.",
    ),
  /** The reviewed text the worker wrote for a coach to read. */
  safeDescription: safeDescriptionSchema,
});

/** The validated `shareTaskSummary` payload. */
export type TaskSharePayload = z.infer<typeof taskSharePayloadSchema>;

/**
 * Validates the `stopTaskShare` payload before `../hooks/` submits it as the payload of the four-field
 * mutation input.
 *
 * A share identity and nothing else. Stopping must succeed while an unrelated draft elsewhere in the
 * application is invalid, so this payload carries nothing that body validation could refuse for
 * reasons of its own: no description, no reason text and no task fields. Stopping changes the share's
 * lifecycle only, and the task keeps its status, its due date and its existence.
 */
export const taskShareStopPayloadSchema = z.strictObject({
  /** The share being stopped. */
  taskShareId: z
    .string()
    .trim()
    .min(
      1,
      "This payload names no shared summary, so reload the shared summaries and stop it again.",
    ),
});

/** The validated `stopTaskShare` payload. */
export type TaskShareStopPayload = z.infer<typeof taskShareStopPayloadSchema>;
