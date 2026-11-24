import { z } from "zod";
import { BULK_FIELD_MESSAGES, BULK_ITEM_RESULT_STATES } from "../copy/bulk-actions";
import { civilDateSchema, taskCategorySchema, taskIdSchema, taskNoteSchema, taskTitleSchema } from "./task";
export const BULK_SCHEMA_MESSAGES = { duplicateSelection: "Each row appears once in a selection, so remove the repeated row and submit again.", tagTooLong: "A private tag is a short label, so shorten this one to a few words." } as const;
export const PRIVATE_TAG_MAX_LENGTH = 60;
export const selectedTaskIdsSchema = z
  .array(taskIdSchema, { error: BULK_FIELD_MESSAGES.emptySelection })
  .min(1, BULK_FIELD_MESSAGES.emptySelection)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: BULK_SCHEMA_MESSAGES.duplicateSelection });
  });
export const privateTagSchema = z
  .string({ error: BULK_FIELD_MESSAGES.tagRequired })
  .trim()
  .superRefine((value, ctx) => {
    const length = Array.from(value).length;
    if (length === 0) ctx.addIssue({ code: "custom", message: BULK_FIELD_MESSAGES.tagRequired });
    else if (length > PRIVATE_TAG_MAX_LENGTH) ctx.addIssue({ code: "custom", message: BULK_SCHEMA_MESSAGES.tagTooLong });
  });
export const bulkItemResultStateSchema = z.enum(BULK_ITEM_RESULT_STATES);
export type BulkItemResultState = z.infer<typeof bulkItemResultStateSchema>;
export const followUpTaskTemplateSchema = z.strictObject({ title: taskTitleSchema, category: taskCategorySchema, dueOn: civilDateSchema.optional(), note: taskNoteSchema });
export type FollowUpTaskTemplate = z.infer<typeof followUpTaskTemplateSchema>;
export const bulkApplyTagSchema = z.strictObject({ taskIds: selectedTaskIdsSchema, tag: privateTagSchema });
export type BulkApplyTagPayload = z.infer<typeof bulkApplyTagSchema>;
export const bulkRemoveTagSchema = z.strictObject({ taskIds: selectedTaskIdsSchema, tag: privateTagSchema });
export type BulkRemoveTagPayload = z.infer<typeof bulkRemoveTagSchema>;
export const bulkCreateTasksSchema = z.strictObject({ taskIds: selectedTaskIdsSchema, template: followUpTaskTemplateSchema });
export type BulkCreateTasksPayload = z.infer<typeof bulkCreateTasksSchema>;
export const bulkCompleteTasksSchema = z.strictObject({ taskIds: selectedTaskIdsSchema });
export type BulkCompleteTasksPayload = z.infer<typeof bulkCompleteTasksSchema>;
