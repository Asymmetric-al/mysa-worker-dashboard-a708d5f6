/**
 * The Work family's five task-mutation payload schemas: `createTask`, `editTask`, `completeTask`,
 * `reopenTask` and `cancelTask`.
 *
 * One schema per named mutation. Each names its own effect and its own field set, so a request body
 * can only ever mean one thing; there is no shared field bag and no generic create-or-update form,
 * which is the command dispatcher this application deliberately does not have.
 *
 * A schema here validates the **payload alone**. The four-field mutation input
 * `{ operationId, scope, expectedRevision, payload }` belongs to the read envelope, and
 * `../hooks/use-task-mutations.ts` composes the two and mints one operation identity per intent, so
 * no schema below declares `operationId`, `scope` or `expectedRevision`. Every payload object is a
 * strict object for the same reason: an envelope field smuggled into a payload — or any other stray
 * key — is refused here, by the rule the service's own strict payload schema applies, instead of
 * being dropped in the browser and answered `invalid` a round trip later.
 *
 * One member is not a task field. `operation` is the routing discriminant `POST /api/tasks` selects
 * the mutation by, and each schema below declares it as a defaulted literal because **the schema's
 * output is the wire payload**: a caller states the fields of the task and the request it composes
 * still names the change it makes. The handler strips the member again before the mutation's own
 * closed schema reads the payload, so `modules/data-service/mutations/tasks.ts` stays free of it and
 * the discriminant remains one routing fact rather than a second description of a task.
 *
 * These schemas decide shape, never admissibility. Whether a due date has passed, whether a linked
 * record still exists, whether the caller may change this task and whether a series admits one more
 * occurrence are all the service's questions, answered against the record as it stands and the
 * scenario clock. Nothing here reads a clock, compares a revision or asks a permission question.
 *
 * A civil date is read by the one civil-date implementation, `@/modules/time/civil`, and a planned
 * time stays a wall-clock reading beside the zone that discloses it. Neither is ever converted to an
 * instant here, so no zone lookup, DST resolution or offset arithmetic can happen in a form.
 *
 * Every message a worker can see comes from `../copy/task-status.ts`, and no schema below writes a
 * message literal of its own. The one exception is the small set that catalogue has no key for yet,
 * declared once in {@link TASK_SCHEMA_MESSAGES} with that file named as its home.
 *
 * Plan items: AAP 0.6.1 "Mutations: tasks and recurrence", AAP 0.6.3 `GET/POST /api/tasks`, the
 * AAP 0.9.1 tree row `features/work/**`, and the task rules in AAP 0.8.2.
 */

import { z } from "zod";

import { parseCivilDate } from "@/modules/time/civil";

import { TASK_FIELD_MESSAGES, type TaskKind } from "../copy/task-status";

// ---------------------------------------------------------------------------------------------
// Wording this schema set needs and the task catalogue does not hold yet
// ---------------------------------------------------------------------------------------------

/**
 * The messages this schema set needs that `../copy/task-status.ts` has no key for.
 *
 * That file is the Work family's one wording source, and these entries belong beside the five
 * messages it already words. They are declared here only so that no schema below states a message
 * literal inline, and they move into `../copy/task-status.ts` the moment that catalogue is next
 * edited. Each one describes the value that was refused and what to do about it, never the person
 * who typed it.
 */
export const TASK_SCHEMA_MESSAGES = {
  /** A mutation arrived without the task it applies to. */
  taskIdRequired: "This action applies to one task, so open the task again and retry.",
  /** An optional link to a partner or an initiative arrived as blank text. */
  linkInvalid:
    "Choose the linked record from the list, so a link names a record rather than a typed value.",
  /** A title longer than a list row can show. */
  titleTooLong: "Shorten the title to a phrase, so it reads at a glance in a list.",
  /** A category that arrived as something other than text. */
  categoryInvalid: "A category is text, so enter a short label or leave the field empty.",
  /** A kind value the task vocabulary has no name for. */
  taskKindInvalid: "Choose Task or Meeting as the kind of work.",
  /** A planned time that is not a date and a clock time together. */
  plannedTimeInvalid: "A planned time is a date and a clock time together, so enter both.",
  /** A timezone this device cannot resolve. */
  timeZoneInvalid:
    "Choose the timezone this time is stated in, so the time is never read in an assumed zone.",
  /** A note that arrived as something other than text. */
  noteInvalid: "A note is text, so write a reminder or leave the field empty.",
  /** A note longer than a reminder needs to be. */
  noteTooLong: "A note is a short reminder, so shorten this one.",
  /** A cancellation submitted without its confirmation step. */
  cancelConfirmationRequired:
    "Confirm the cancellation, because a cancelled task is not reopened from this form.",
} as const;

// ---------------------------------------------------------------------------------------------
// Lengths the composer and the schema share
// ---------------------------------------------------------------------------------------------

/**
 * The longest task title this schema accepts, counted in Unicode code points.
 *
 * A UI-level guard the specification does not fix a number for: the composer's `maxLength` and this
 * schema read the same constant, so a worker is never shown one limit and refused by another. The
 * service still decides what it admits.
 */
export const TASK_TITLE_MAX_LENGTH = 200;

/**
 * The longest category label this schema accepts, counted in Unicode code points.
 *
 * The same UI-level guard as the title: a short label is the point of a category, and `bulk.ts`
 * applies this constant too so a label typed in one place is not refused in another.
 */
export const TASK_CATEGORY_MAX_LENGTH = 60;

/**
 * The longest task note this schema accepts, counted in Unicode code points.
 *
 * The same UI-level guard, shared with `bulk.ts`: a note is a reminder about the work rather than a
 * place to keep a record of it.
 */
export const TASK_NOTE_MAX_LENGTH = 2000;

/**
 * Counts a value in Unicode code points, so a script outside the Basic Multilingual Plane counts
 * once.
 *
 * `String.prototype.length` counts UTF-16 code units, which would refuse a title a worker can read
 * and the service accepts.
 */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

// ---------------------------------------------------------------------------------------------
// Field primitives the whole folder shares
// ---------------------------------------------------------------------------------------------

/**
 * An opaque record identifier.
 *
 * Never parsed for meaning, split into parts or compared with a name or an email address: an
 * identifier is a handle to one record inside one scope, and equal-looking values establish neither
 * identity nor authority.
 */
export const taskIdSchema = z
  .string({ error: TASK_SCHEMA_MESSAGES.taskIdRequired })
  .trim()
  .min(1, TASK_SCHEMA_MESSAGES.taskIdRequired);

/**
 * An optional link to another record, chosen from the options a read envelope admitted.
 *
 * Whether the linked record still exists, and whether this caller may link to it, are the service's
 * questions; a blank value is refused here because an empty link would name nothing at all.
 */
const linkIdSchema = z
  .string({ error: TASK_SCHEMA_MESSAGES.linkInvalid })
  .trim()
  .min(1, TASK_SCHEMA_MESSAGES.linkInvalid);

/**
 * A civil date carried as `YYYY-MM-DD` and read by `@/modules/time/civil`.
 *
 * Shape and calendar only: a day past the end of its month is refused rather than rolled forward,
 * and no time of day, zone or instant is invented for it. So a due date stays the day the worker
 * chose, and a change of display zone never rebases it.
 */
export const civilDateSchema = z
  .string({ error: TASK_FIELD_MESSAGES.dueDateInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom", message: TASK_FIELD_MESSAGES.dueDateInvalid });
    }
  });

/**
 * The accepted shape of a planned wall-clock time: a date, a `T` and a 24-hour clock time, with
 * optional seconds — the value a date-and-time control produces.
 */
const PLANNED_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/u;

/**
 * A meeting's planned wall-clock time, checked by shape alone.
 *
 * It is never converted to an instant and never re-zoned, because the zone is a separate field the
 * worker discloses: `plannedTime` says what the clock will read, and `timeZone` says where that
 * clock is read. The stored record keeps that clock beside the civil due date and the disclosed
 * zone, and splitting the planned moment into those stored fields is the service's work — so the day
 * a time belongs to cannot quietly be dropped here, and a plan never becomes something that already
 * happened.
 */
export const plannedTimeSchema = z
  .string({ error: TASK_SCHEMA_MESSAGES.plannedTimeInvalid })
  .trim()
  .regex(PLANNED_TIME_PATTERN, TASK_SCHEMA_MESSAGES.plannedTimeInvalid);

/**
 * Whether this runtime can resolve a zone identifier.
 *
 * Asking the platform is the only honest test: the build ships its own timezone data, so a list of
 * names written here would be a second and staler source. No date is constructed and no offset is
 * compared; the question is only whether the identifier resolves.
 */
function isResolvableTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone a planned time is stated in.
 *
 * Required wherever a planned time is given, because a wall-clock reading without its zone is a time
 * in an assumed zone, and the assumption is invisible to the worker who made it.
 */
export const timeZoneSchema = z
  .string({ error: TASK_SCHEMA_MESSAGES.timeZoneInvalid })
  .trim()
  .refine(isResolvableTimeZone, TASK_SCHEMA_MESSAGES.timeZoneInvalid);

/**
 * A task title: the one field a task cannot do without.
 *
 * Trimmed, non-empty and bounded in code points. Nothing else is asked of it, so a reminder written
 * as three words is a complete task.
 */
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

/**
 * A category: the worker's own short label, or no label at all.
 *
 * Not an enum, not a taxonomy and not a stage, so there is no allowed-values list to keep in step
 * with anything. Blank text becomes `undefined` because an uncategorised task is a complete state
 * rather than a missing value: no list excludes it and no form reports it as an error.
 */
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

/**
 * The note attached to a task, or no note.
 *
 * Private preparation about the work rather than a record of it: a note states what the worker wants
 * to remember, so it creates no interaction and proves nothing happened. Blank text becomes
 * `undefined`, the state of a task with no note.
 */
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

/**
 * The two kinds of work, listed against the task vocabulary's own union so a kind that union names
 * cannot be missing here without failing to compile.
 */
const TASK_KIND_VALUES = ["default", "meeting"] as const satisfies readonly TaskKind[];

/**
 * Whether a task is ordinary work or a meeting that may carry a planned time.
 *
 * The two kinds are the task vocabulary's own: ordinary work needs no schedule, and a meeting may
 * state one without the plan ever reading as something that was held.
 */
export const taskKindSchema = z.enum(TASK_KIND_VALUES, {
  error: TASK_SCHEMA_MESSAGES.taskKindInvalid,
});

// ---------------------------------------------------------------------------------------------
// The planned-time rule every task payload shares
// ---------------------------------------------------------------------------------------------

/** The three fields the planned-time rule reads, present on every payload that can carry a schedule. */
type PlannedTimePairing = {
  readonly kind: TaskKind;
  readonly plannedTime?: string | undefined;
  readonly timeZone?: string | undefined;
};

/**
 * The one planned-time rule: a schedule belongs to a meeting, and a time is always stated in a zone.
 *
 * A callback rather than a schema factory, so the create, edit and occurrence payloads share one
 * implementation without any of them wrapping another. Three cases are refused and two are honest:
 *
 * - an ordinary task carrying a planned time or a zone, because a task with a schedule would read as
 *   an appointment the worker never made;
 * - a planned time with no zone, and a zone with no planned time, because either one alone states
 *   half of when the meeting is;
 * - a meeting stating both, and a meeting stating neither, which are both complete: a plan may exist
 *   without a time, and a meeting without a time is still a meeting.
 */
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

// ---------------------------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `createTask` payload before `../hooks/use-task-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * `title` is the only required field, because a task is useful the moment it names itself; every
 * other field is optional and `kind` defaults to `'default'`, so an ordinary reminder needs no
 * choice at all. `partnerId` and `initiativeId` are links chosen from the options a read envelope
 * admitted, and the service checks that the linked record still exists and is still visible. No
 * `seriesId` and no parent task appear: a repeated task is created through `createSeries`, never by
 * pointing one task at another.
 */
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

// ---------------------------------------------------------------------------------------------
// editTask
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `editTask` payload before `../hooks/use-task-mutations.ts` submits it as the payload
 * of the four-field mutation input.
 *
 * It carries the whole editable state rather than a partial patch. A patch could not express the
 * planned-time rule — removing a time and removing the zone it was stated in are one edit, and a
 * patch would let either arrive alone — and it would turn this schema into the field bag the folder
 * forbids. So every editable field is stated, `kind` included, and the service decides whether the
 * result actually differs from the record before it writes anything.
 */
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

// ---------------------------------------------------------------------------------------------
// completeTask
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `completeTask` payload before `../hooks/use-task-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * A task identifier and nothing else. There is no completion date, outcome, note or contact flag,
 * because completing a task records that the worker finished it and proves nothing about contact,
 * payment or fulfilment — so the payload holds no field in which such a claim could travel. A
 * meeting counts as held only when an interaction records that it happened.
 */
export const completeTaskSchema = z.strictObject({
  operation: z.literal("completeTask").default("completeTask"),
  taskId: taskIdSchema,
});

/** The validated `completeTask` payload. */
export type CompleteTaskPayload = z.infer<typeof completeTaskSchema>;

// ---------------------------------------------------------------------------------------------
// reopenTask
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `reopenTask` payload before `../hooks/use-task-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * The same identifier and nothing else, for the same reason: reopening says the work is open again,
 * and neither states anything about who was contacted or what was given.
 */
export const reopenTaskSchema = z.strictObject({
  operation: z.literal("reopenTask").default("reopenTask"),
  taskId: taskIdSchema,
});

/** The validated `reopenTask` payload. */
export type ReopenTaskPayload = z.infer<typeof reopenTaskSchema>;

// ---------------------------------------------------------------------------------------------
// cancelTask
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `cancelTask` payload before `../hooks/use-task-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * Cancelling is deliberate, so the payload carries the literal `true` that the composer's
 * confirmation step produces, and no reason: a free-text reason would become a hidden note that
 * later reads as history, and the task record has no field for one.
 */
export const cancelTaskSchema = z.strictObject({
  operation: z.literal("cancelTask").default("cancelTask"),
  taskId: taskIdSchema,
  confirmed: z.literal(true, { error: TASK_SCHEMA_MESSAGES.cancelConfirmationRequired }),
});

/** The validated `cancelTask` payload. */
export type CancelTaskPayload = z.infer<typeof cancelTaskSchema>;
