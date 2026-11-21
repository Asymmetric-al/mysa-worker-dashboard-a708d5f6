/**
 * The Work family's five task-mutation payload schemas: `createTask`, `editTask`, `completeTask`,
 * `reopenTask` and `cancelTask`.
 */
import { z } from "zod";
import { parseCivilDate } from "@/modules/time/civil";
import { TASK_FIELD_MESSAGES, type TaskKind } from "../copy/task-status";
// Wording this schema set needs and the task catalogue does not hold yet
/** The messages this schema set needs that `../copy/task-status.ts` has no key for. */
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
// Lengths the composer and the schema share
/** The longest task title this schema accepts, counted in Unicode code points. */
export const TASK_TITLE_MAX_LENGTH = 200;
/** The longest category label this schema accepts, counted in Unicode code points. */
export const TASK_CATEGORY_MAX_LENGTH = 60;
/** The longest task note this schema accepts, counted in Unicode code points. */
export const TASK_NOTE_MAX_LENGTH = 2000;

function codePointLength(value: string): number {
  return Array.from(value).length;
}
// Field primitives the whole folder shares
/** An opaque record identifier. */
export const taskIdSchema = z.string({ error: TASK_SCHEMA_MESSAGES.taskIdRequired }).trim().min(1, TASK_SCHEMA_MESSAGES.taskIdRequired);

const linkIdSchema = z.string({ error: TASK_SCHEMA_MESSAGES.linkInvalid }).trim().min(1, TASK_SCHEMA_MESSAGES.linkInvalid);
/** A civil date carried as `YYYY-MM-DD` and read by `@/modules/time/civil`. */
export const civilDateSchema = z
  .string({ error: TASK_FIELD_MESSAGES.dueDateInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom", message: TASK_FIELD_MESSAGES.dueDateInvalid });
    }
  });
const PLANNED_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/u;
/** A meeting's planned wall-clock time, checked by shape alone. */
export const plannedTimeSchema = z.string({ error: TASK_SCHEMA_MESSAGES.plannedTimeInvalid }).trim().regex(PLANNED_TIME_PATTERN, TASK_SCHEMA_MESSAGES.plannedTimeInvalid);

function isResolvableTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
/** The zone a planned time is stated in. */
export const timeZoneSchema = z.string({ error: TASK_SCHEMA_MESSAGES.timeZoneInvalid }).trim().refine(isResolvableTimeZone, TASK_SCHEMA_MESSAGES.timeZoneInvalid);
/** A task title: the one field a task cannot do without. */
export const taskTitleSchema = z
  .string({ error: TASK_FIELD_MESSAGES.titleRequired })
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointLength(value);
    if (length === 0) {
      ctx.addIssue({ code: "custom", message: TASK_FIELD_MESSAGES.titleRequired });
    } else if (length > TASK_TITLE_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: TASK_SCHEMA_MESSAGES.titleTooLong });
    }
  });
/** A category: the worker's own short label, or no label at all. */
export const taskCategorySchema = z
  .string({ error: TASK_SCHEMA_MESSAGES.categoryInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > TASK_CATEGORY_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: TASK_FIELD_MESSAGES.categoryTooLong });
    }
  })
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? undefined : value));
/** The note attached to a task, or no note. */
export const taskNoteSchema = z
  .string({ error: TASK_SCHEMA_MESSAGES.noteInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > TASK_NOTE_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: TASK_SCHEMA_MESSAGES.noteTooLong });
    }
  })
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? undefined : value));
const TASK_KIND_VALUES = ["default", "meeting"] as const satisfies readonly TaskKind[];
/** Whether a task is ordinary work or a meeting that may carry a planned time. */
export const taskKindSchema = z.enum(TASK_KIND_VALUES, {
  error: TASK_SCHEMA_MESSAGES.taskKindInvalid,
});
// The planned-time rule every task payload shares
type PlannedTimePairing = {
  readonly kind: TaskKind;
  readonly plannedTime?: string | undefined;
  readonly timeZone?: string | undefined;
};
/** The one planned-time rule: a schedule belongs to a meeting, and a time is always stated in a zone. */
export function refinePlannedTimePairing(value: PlannedTimePairing, ctx: z.RefinementCtx): void {
  const hasTime = value.plannedTime !== undefined;
  const hasZone = value.timeZone !== undefined;
  if (value.kind === "default") {
    if (hasTime || hasZone) {
      ctx.addIssue({
        code: "custom",
        message: TASK_FIELD_MESSAGES.plannedTimeOnlyForMeeting,
        path: ["plannedTime"],
      });
    }
    return;
  }
  if (hasTime && !hasZone) {
    ctx.addIssue({
      code: "custom",
      message: TASK_FIELD_MESSAGES.plannedTimeRequiresTimeZone,
      path: ["timeZone"],
    });
  } else if (!hasTime && hasZone) {
    ctx.addIssue({
      code: "custom",
      message: TASK_FIELD_MESSAGES.plannedTimeRequiresTimeZone,
      path: ["plannedTime"],
    });
  }
}
// createTask
/** Validates the `createTask` payload before `../hooks/use-task-mutations.ts` submits it as the payload of the four-field mutation input. */
export const createTaskSchema = z
  .strictObject({
    operation: z.literal("createTask").default("createTask"),
    title: taskTitleSchema,
    category: taskCategorySchema,
    dueOn: civilDateSchema.optional(),
    kind: taskKindSchema.default("default"),
    plannedTime: plannedTimeSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    note: taskNoteSchema,
    partnerId: linkIdSchema.optional(),
    initiativeId: linkIdSchema.optional(),
  })
  .superRefine(refinePlannedTimePairing);
/** The validated `createTask` payload. */
export type CreateTaskPayload = z.infer<typeof createTaskSchema>;
// editTask
/** Validates the `editTask` payload before `../hooks/use-task-mutations.ts` submits it as the payload of the four-field mutation input. */
export const editTaskSchema = z
  .strictObject({
    operation: z.literal("editTask").default("editTask"),
    taskId: taskIdSchema,
    title: taskTitleSchema,
    category: taskCategorySchema,
    dueOn: civilDateSchema.optional(),
    kind: taskKindSchema,
    plannedTime: plannedTimeSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    note: taskNoteSchema,
    partnerId: linkIdSchema.optional(),
    initiativeId: linkIdSchema.optional(),
  })
  .superRefine(refinePlannedTimePairing);
/** The validated `editTask` payload. */
export type EditTaskPayload = z.infer<typeof editTaskSchema>;
// completeTask
/** Validates the `completeTask` payload before `../hooks/use-task-mutations.ts` submits it as the payload of the four-field mutation input. */
export const completeTaskSchema = z.strictObject({
  operation: z.literal("completeTask").default("completeTask"),
  taskId: taskIdSchema,
});
/** The validated `completeTask` payload. */
export type CompleteTaskPayload = z.infer<typeof completeTaskSchema>;
// reopenTask
/** Validates the `reopenTask` payload before `../hooks/use-task-mutations.ts` submits it as the payload of the four-field mutation input. */
export const reopenTaskSchema = z.strictObject({
  operation: z.literal("reopenTask").default("reopenTask"),
  taskId: taskIdSchema,
});
/** The validated `reopenTask` payload. */
export type ReopenTaskPayload = z.infer<typeof reopenTaskSchema>;
// cancelTask
/** Validates the `cancelTask` payload before `../hooks/use-task-mutations.ts` submits it as the payload of the four-field mutation input. */
export const cancelTaskSchema = z.strictObject({
  operation: z.literal("cancelTask").default("cancelTask"),
  taskId: taskIdSchema,
  confirmed: z.literal(true, { error: TASK_SCHEMA_MESSAGES.cancelConfirmationRequired }),
});
/** The validated `cancelTask` payload. */
export type CancelTaskPayload = z.infer<typeof cancelTaskSchema>;
