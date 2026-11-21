/**
 * The coaching family's two task-sharing payload schemas: `shareTaskSummary` and `stopTaskShare`.
 */
import { z } from "zod";
import { TASK_SUMMARY_MAX_CODE_POINTS } from "@/modules/coaching/taskshare";
import { LIMIT_COPY } from "../copy";
/** The wording this schema set needs and the coaching copy catalogue does not hold yet. */
export const TASK_SHARE_SCHEMA_MESSAGES = {
  taskRequired: "This payload names no task, so reload the shared summaries and choose the task again.",
  occurrenceRequired: "This payload names no occurrence, so choose the occurrence you want to share and try again.",
  descriptionRequired: "This payload carries no description, so write what you want your coach to read and review it before sharing.",
} as const;
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
/** Validates the `shareTaskSummary` payload before `../hooks/` submits it as the payload of the four-field mutation input. */
export const taskSharePayloadSchema = z.strictObject({
  taskId: z.string().trim().min(1, TASK_SHARE_SCHEMA_MESSAGES.taskRequired),
  occurrenceId: z.string().trim().min(1, TASK_SHARE_SCHEMA_MESSAGES.occurrenceRequired).optional(),
  reviewedFingerprint: z.string().trim().min(1, "A shared summary records the review it belongs to, so review the description and share it again."),
  safeDescription: safeDescriptionSchema,
});
/** The validated `shareTaskSummary` payload. */
export type TaskSharePayload = z.infer<typeof taskSharePayloadSchema>;
/** Validates the `stopTaskShare` payload before `../hooks/` submits it as the payload of the four-field mutation input. */
export const taskShareStopPayloadSchema = z.strictObject({
  taskShareId: z.string().trim().min(1, "This payload names no shared summary, so reload the shared summaries and stop it again."),
});
/** The validated `stopTaskShare` payload. */
export type TaskShareStopPayload = z.infer<typeof taskShareStopPayloadSchema>;
