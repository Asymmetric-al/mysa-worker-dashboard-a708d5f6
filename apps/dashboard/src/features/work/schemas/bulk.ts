/**
 * The Work family's four bulk-action payload schemas: `bulkApplyTag`, `bulkRemoveTag`,
 * `bulkCreateTasks` and `bulkCompleteTasks`.
 */
import { z } from "zod";
import { BULK_FIELD_MESSAGES, BULK_ITEM_RESULT_STATES } from "../copy/bulk-actions";
import { civilDateSchema, taskCategorySchema, taskIdSchema, taskNoteSchema, taskTitleSchema } from "./task";
// Wording this schema set needs and the bulk-action catalogue does not hold yet
/** The messages this schema set needs that `../copy/bulk-actions.ts` has no key for. */
export const BULK_SCHEMA_MESSAGES = {
  duplicateSelection: "Each row appears once in a selection, so remove the repeated row and submit again.",
  tagTooLong: "A private tag is a short label, so shorten this one to a few words.",
} as const;
// The length the bulk-action bar and the schema share
/** The longest private tag this schema accepts, counted in Unicode code points. */
export const PRIVATE_TAG_MAX_LENGTH = 60;
// The selection, the tag and the per-item result state every bulk payload shares
/** The rows a bulk action applies to: an **explicit** selection of task identifiers. */
export const selectedTaskIdsSchema = z
  .array(taskIdSchema, { error: BULK_FIELD_MESSAGES.emptySelection })
  .min(1, BULK_FIELD_MESSAGES.emptySelection)
  .superRefine((ids, ctx) => {
    const seen = new Set<string>();
    let repeated = false;
    for (const id of ids) {
      if (seen.has(id)) {
        repeated = true;
        break;
      }
      seen.add(id);
    }
    if (repeated) {
      ctx.addIssue({ code: "custom", message: BULK_SCHEMA_MESSAGES.duplicateSelection });
    }
  });
/** A private tag: the worker's own short label, visible to them alone. */
export const privateTagSchema = z
  .string({ error: BULK_FIELD_MESSAGES.tagRequired })
  .trim()
  .superRefine((value, ctx) => {
    const length = Array.from(value).length;
    if (length === 0) {
      ctx.addIssue({ code: "custom", message: BULK_FIELD_MESSAGES.tagRequired });
    } else if (length > PRIVATE_TAG_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: BULK_SCHEMA_MESSAGES.tagTooLong });
    }
  });
/** One row's result from a bulk action, derived from the canonical vocabulary. */
export const bulkItemResultStateSchema = z.enum(BULK_ITEM_RESULT_STATES);
/** The validated per-item result state: the same four words the bulk-action catalogue names. */
export type BulkItemResultState = z.infer<typeof bulkItemResultStateSchema>;
// The follow-up task template the create action repeats per row
/** The task a bulk create writes once for each selected row: an **ordinary** follow-up task. */
export const followUpTaskTemplateSchema = z.strictObject({
  title: taskTitleSchema,
  category: taskCategorySchema,
  dueOn: civilDateSchema.optional(),
  note: taskNoteSchema,
});
/** The validated follow-up task template; `bulkCreateTasksSchema` repeats it once per selected row. */
export type FollowUpTaskTemplate = z.infer<typeof followUpTaskTemplateSchema>;
// bulkApplyTag
/** Validates the `bulkApplyTag` payload before `../hooks/use-bulk-task-mutations.ts` submits it as the payload of the four-field mutation input. */
export const bulkApplyTagSchema = z.strictObject({
  taskIds: selectedTaskIdsSchema,
  tag: privateTagSchema,
});
/** The validated `bulkApplyTag` payload. */
export type BulkApplyTagPayload = z.infer<typeof bulkApplyTagSchema>;
// bulkRemoveTag
/** Validates the `bulkRemoveTag` payload before `../hooks/use-bulk-task-mutations.ts` submits it as the payload of the four-field mutation input. */
export const bulkRemoveTagSchema = z.strictObject({
  taskIds: selectedTaskIdsSchema,
  tag: privateTagSchema,
});
/** The validated `bulkRemoveTag` payload. */
export type BulkRemoveTagPayload = z.infer<typeof bulkRemoveTagSchema>;
// bulkCreateTasks
/** Validates the `bulkCreateTasks` payload before `../hooks/use-bulk-task-mutations.ts` submits it as the payload of the four-field mutation input. */
export const bulkCreateTasksSchema = z.strictObject({
  taskIds: selectedTaskIdsSchema,
  template: followUpTaskTemplateSchema,
});
/** The validated `bulkCreateTasks` payload. */
export type BulkCreateTasksPayload = z.infer<typeof bulkCreateTasksSchema>;
// bulkCompleteTasks
/** Validates the `bulkCompleteTasks` payload before `../hooks/use-bulk-task-mutations.ts` submits it as the payload of the four-field mutation input. */
export const bulkCompleteTasksSchema = z.strictObject({
  taskIds: selectedTaskIdsSchema,
});
/** The validated `bulkCompleteTasks` payload. */
export type BulkCompleteTasksPayload = z.infer<typeof bulkCompleteTasksSchema>;
