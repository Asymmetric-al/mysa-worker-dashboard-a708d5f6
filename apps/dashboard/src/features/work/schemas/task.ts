import { z } from "zod";
import { parseCivilDate } from "@/modules/time/civil";
import { TASK_FIELD_MESSAGES, type TaskKind } from "../copy/task-status";
export const TASK_SCHEMA_MESSAGES = {
  taskIdRequired: "This action applies to one task, so open the task again and retry.",
  linkInvalid: "Choose the linked record from the list, so a link names a record rather than a typed value.",
  titleTooLong: "Shorten the title to a phrase, so it reads at a glance in a list.",
  categoryInvalid: "A category is text, so enter a short label or leave the field empty.",
  taskKindInvalid: "Choose Task or Meeting as the kind of work.",
  plannedTimeInvalid: "A planned time is a date and a clock time together, so enter both.",
  timeZoneInvalid: "Choose the timezone this time is stated in, so the time is never read in an assumed zone.",
  noteInvalid: "A note is text, so write a reminder or leave the field empty.",
  noteTooLong: "A note is a short reminder, so shorten this one.",
  cancelConfirmationRequired: "Confirm the cancellation, because a cancelled task is not reopened from this form.",
} as const;
export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_CATEGORY_MAX_LENGTH = 60;
export const TASK_NOTE_MAX_LENGTH = 2000;
const codePointLength = (value: string): number => Array.from(value).length;
export const taskIdSchema = z.string({ error: TASK_SCHEMA_MESSAGES.taskIdRequired }).trim().min(1, TASK_SCHEMA_MESSAGES.taskIdRequired);
const linkIdSchema = z.string({ error: TASK_SCHEMA_MESSAGES.linkInvalid }).trim().min(1, TASK_SCHEMA_MESSAGES.linkInvalid);
export const civilDateSchema = z
  .string({ error: TASK_FIELD_MESSAGES.dueDateInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") ctx.addIssue({ code: "custom", message: TASK_FIELD_MESSAGES.dueDateInvalid });
  });
const PLANNED_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/u;
export const plannedTimeSchema = z.string({ error: TASK_SCHEMA_MESSAGES.plannedTimeInvalid }).trim().regex(PLANNED_TIME_PATTERN, TASK_SCHEMA_MESSAGES.plannedTimeInvalid);
function isResolvableTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
export const timeZoneSchema = z.string({ error: TASK_SCHEMA_MESSAGES.timeZoneInvalid }).trim().refine(isResolvableTimeZone, TASK_SCHEMA_MESSAGES.timeZoneInvalid);
export const taskTitleSchema = z
  .string({ error: TASK_FIELD_MESSAGES.titleRequired })
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointLength(value);
    if (length === 0) ctx.addIssue({ code: "custom", message: TASK_FIELD_MESSAGES.titleRequired });
    else if (length > TASK_TITLE_MAX_LENGTH) ctx.addIssue({ code: "custom", message: TASK_SCHEMA_MESSAGES.titleTooLong });
  });
export const taskCategorySchema = z
  .string({ error: TASK_SCHEMA_MESSAGES.categoryInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > TASK_CATEGORY_MAX_LENGTH) ctx.addIssue({ code: "custom", message: TASK_FIELD_MESSAGES.categoryTooLong });
  })
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? undefined : value));
export const taskNoteSchema = z
  .string({ error: TASK_SCHEMA_MESSAGES.noteInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > TASK_NOTE_MAX_LENGTH) ctx.addIssue({ code: "custom", message: TASK_SCHEMA_MESSAGES.noteTooLong });
  })
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? undefined : value));
const TASK_KIND_VALUES = ["default", "meeting"] as const satisfies readonly TaskKind[];
export const taskKindSchema = z.enum(TASK_KIND_VALUES, { error: TASK_SCHEMA_MESSAGES.taskKindInvalid });
type PlannedTimePairing = { readonly kind: TaskKind; readonly plannedTime?: string | null | undefined; readonly timeZone?: string | null | undefined }; /** The one planned-time rule: a schedule belongs to a meeting, and a time is always stated in a zone. A null member is a cleared one, so it states no schedule. */
export function refinePlannedTimePairing(value: PlannedTimePairing, ctx: z.RefinementCtx): void {
  const hasTime = value.plannedTime !== undefined && value.plannedTime !== null;
  const hasZone = value.timeZone !== undefined && value.timeZone !== null;
  if (value.kind === "default") {
    if (hasTime || hasZone) ctx.addIssue({ code: "custom", message: TASK_FIELD_MESSAGES.plannedTimeOnlyForMeeting, path: ["plannedTime"] });
    return;
  }
  if (hasTime && !hasZone) {
    ctx.addIssue({ code: "custom", message: TASK_FIELD_MESSAGES.plannedTimeRequiresTimeZone, path: ["timeZone"] });
  } else if (!hasTime && hasZone) {
    ctx.addIssue({ code: "custom", message: TASK_FIELD_MESSAGES.plannedTimeRequiresTimeZone, path: ["plannedTime"] });
  }
}
const COMPOSED_TASK_FIELDS = { title: taskTitleSchema, category: taskCategorySchema, dueOn: civilDateSchema.optional(), plannedTime: plannedTimeSchema.optional(), timeZone: timeZoneSchema.optional(), note: taskNoteSchema, partnerId: linkIdSchema.optional(), initiativeId: linkIdSchema.optional() };
/** An optional member of an edit. The handler clears a field it receives as null and leaves a field it does not receive as it is, so this set is the one the client composes an edit against. */
const nullableMember = <T extends z.ZodType>(field: T) => z.union([field, z.null()]).optional();
const EDITED_TASK_FIELDS = {
  title: taskTitleSchema,
  category: nullableMember(taskCategorySchema),
  dueOn: nullableMember(civilDateSchema),
  plannedTime: nullableMember(plannedTimeSchema),
  timeZone: nullableMember(timeZoneSchema),
  note: nullableMember(taskNoteSchema),
  partnerId: nullableMember(linkIdSchema),
  initiativeId: nullableMember(linkIdSchema),
};
export const createTaskSchema = z.strictObject({ operation: z.literal("createTask").default("createTask"), ...COMPOSED_TASK_FIELDS, kind: taskKindSchema.default("default") }).superRefine(refinePlannedTimePairing);
export type CreateTaskPayload = z.infer<typeof createTaskSchema>;
export const editTaskSchema = z.strictObject({ operation: z.literal("editTask").default("editTask"), taskId: taskIdSchema, ...EDITED_TASK_FIELDS, kind: taskKindSchema }).superRefine(refinePlannedTimePairing);
export type EditTaskPayload = z.infer<typeof editTaskSchema>;
export const completeTaskSchema = z.strictObject({ operation: z.literal("completeTask").default("completeTask"), taskId: taskIdSchema });
export type CompleteTaskPayload = z.infer<typeof completeTaskSchema>;
export const reopenTaskSchema = z.strictObject({ operation: z.literal("reopenTask").default("reopenTask"), taskId: taskIdSchema });
export type ReopenTaskPayload = z.infer<typeof reopenTaskSchema>;
export const cancelTaskSchema = z.strictObject({ operation: z.literal("cancelTask").default("cancelTask"), taskId: taskIdSchema, confirmed: z.literal(true, { error: TASK_SCHEMA_MESSAGES.cancelConfirmationRequired }) });
export type CancelTaskPayload = z.infer<typeof cancelTaskSchema>;
