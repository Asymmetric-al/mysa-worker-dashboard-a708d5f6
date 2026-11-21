/**
 * The Work family's only task-status, task-list and task-vocabulary wording.
 *
 * Everything a task surface says about where a task stands, which list it lives in, what kind of work
 * it is, whether its time is planned or held, whether it carries a category, whether it has a date,
 * and what a form says when one of those is wrong, is declared here once. The lists, the composer, the
 * row actions, the agenda and the task schema import these names rather than writing their own, so a
 * status reads the same in the row, the filter, the empty state and the error message.
 *
 * Three distinctions the wording must keep visible, because collapsing any of them would tell a worker
 * something untrue:
 *
 * - Completing or reopening a task records no contact, payment, fulfilment or message. Only an
 *   interaction records something that happened.
 * - A planned time is a plan. A meeting is held when an interaction records that it happened, not
 *   when a date passes or a task is completed.
 * - A category is the worker's own short label, not a controlled taxonomy and not a stage; a task
 *   without one is a valid task, never an error and never filtered out of a list.
 *
 * It likewise keeps four statuses four: open, completed, reopened and cancelled are different fates,
 * and a task with no due date is not overdue.
 *
 * This module declares text only. It formats nothing, parses no date, computes nothing, renders
 * nothing and holds no state; a due date reaches the screen through `@/modules/time/civil` in the
 * consuming component. The badge itself belongs to the shared status-badge component, which is the only
 * badge implementation, so this file never restates a membership, send, reach, grant or value-state
 * vocabulary and never styles anything. Its single import is a type, taken from the read-envelope
 * module that owns the closed status union.
 */

import type { TaskRecordStatus as TaskStatus } from "@/modules/data-service/envelope";

// ---------------------------------------------------------------------------------------------
// Where a task stands
// ---------------------------------------------------------------------------------------------

/**
 * The four states a task can be in, worded once for every surface that shows one.
 *
 * The map is exhaustive by construction: `TaskStatus` is the stored record's own union, so a fifth
 * status cannot reach a screen without this map failing to compile. `completed` and `cancelled` are
 * different fates and are worded apart, and `reopened` says that open work came back rather than that
 * it was never finished.
 */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  completed: "Completed",
  reopened: "Reopened",
  cancelled: "Cancelled",
};

/**
 * The order a status filter and a status selector offer the four states in.
 *
 * The order is a product decision rather than the key order of the map above: open work is what a
 * worker looks for first, and the three settled fates follow it.
 */
export const TASK_STATUS_ORDER = [
  "open",
  "completed",
  "reopened",
  "cancelled",
] as const satisfies readonly TaskStatus[];

/** Every status the order above leaves out, which is none of them while the order is complete. */
type UnlistedTaskStatus = Exclude<TaskStatus, (typeof TASK_STATUS_ORDER)[number]>;

/**
 * A compile-time guard rather than a runtime switch: this constant only type-checks while
 * `UnlistedTaskStatus` is `never`.
 *
 * A fifth status added to the record leaves it unlisted above, `UnlistedTaskStatus` stops being
 * `never`, and this line stops compiling until the status is listed in the order and worded in the
 * labels. That is the whole point of the constant; the value it carries means nothing.
 */
export const TASK_STATUS_ORDER_IS_COMPLETE: UnlistedTaskStatus extends never ? true : false = true;

// ---------------------------------------------------------------------------------------------
// The five lists
// ---------------------------------------------------------------------------------------------

/**
 * The five lists the Work surface offers.
 *
 * The keys are display names rather than a data contract: the mapping from one of them to the
 * `listTasks` parameter belongs to the hook that reads the service, so a change of service parameter
 * never changes a word here.
 */
export type TaskListKey = "today" | "upcoming" | "overdue" | "all" | "undated";

export const TASK_LIST_KEYS = [
  "today",
  "upcoming",
  "overdue",
  "all",
  "undated",
] as const satisfies readonly TaskListKey[];

/** Every list the keys above leave out, which is none of them while the list is complete. */
type UnlistedTaskListKey = Exclude<TaskListKey, (typeof TASK_LIST_KEYS)[number]>;

/** The same compile-time guard as the status one: it only type-checks while nothing is missing. */
export const TASK_LIST_KEYS_ARE_COMPLETE: UnlistedTaskListKey extends never ? true : false = true;

/**
 * The five names as the list bar shows them, in the order above.
 *
 * Five names answer five different questions: what is due today, what is coming up, what has gone past
 * its date, everything, and the work that carries no date at all. The work with no date is a list of
 * its own and is never swept into the past-due one, so nothing here is named as lateness.
 */
export const TASK_LIST_LABELS: Record<TaskListKey, string> = {
  today: "Today",
  upcoming: "Upcoming",
  overdue: "Overdue",
  all: "All",
  undated: "Undated",
};

// ---------------------------------------------------------------------------------------------
// What kind of work it is
// ---------------------------------------------------------------------------------------------

/**
 * The two kinds of work: an ordinary task, and a meeting that may carry a planned time.
 *
 * Declared locally because the words "Task" and "Meeting" are a display vocabulary rather than a
 * service parameter; the members mirror the stored record's own kind.
 */
export type TaskKind = "default" | "meeting";

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  default: "Task",
  meeting: "Meeting",
};

// ---------------------------------------------------------------------------------------------
// Planned, and held
// ---------------------------------------------------------------------------------------------

export const PLANNED_TIME_LABEL = "Planned time";

/** The input label that makes the zone part of the time rather than an assumption beside it. */
export const PLANNED_TIME_ZONE_LABEL = "Timezone for this time";

/** The two states a meeting row can show, so a plan never reads as something that already happened. */
export const PLANNED_MEETING_LABEL = "Planned";

export const HELD_MEETING_LABEL = "Held";

/** What separates the two states above, stated wherever a planned time is entered or shown. */
export const PLANNED_VERSUS_HELD_NOTE =
  "A planned time is a plan, and a meeting counts as held only once an interaction records that it happened.";

/** What completing or reopening a task does not record, stated beside both actions. */
export const COMPLETION_MEANS_NOTHING_NOTE =
  "Completing or reopening a task records no contact, payment, fulfilment or message.";

// ---------------------------------------------------------------------------------------------
// Categorised, and uncategorised
// ---------------------------------------------------------------------------------------------

export const CATEGORY_LABEL = "Category";

/** What the category field is, and the two things it is not. */
export const CATEGORY_HINT =
  "Your own short label for finding similar tasks; it is not a shared taxonomy and not a stage.";

/** The two states a task's category can be in. Neither is an error, and neither hides a task. */
export type TaskCategorisationState = "categorised" | "uncategorised";

/**
 * The two states, worded so an uncategorised task reads as a valid task with no label rather than as
 * something missing. No list filters an uncategorised task out, and no form reports one as invalid.
 */
export const CATEGORY_STATE_LABELS: Record<TaskCategorisationState, string> = {
  categorised: "Categorised",
  uncategorised: "No category",
};

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

export const DUE_DATE_LABEL = "Due date";

/**
 * The honest name for a task with no due date: it is undated, which is a complete state and not an
 * empty one. The consumer substitutes nothing here — there is no date to format in this module.
 */
export const UNDATED_LABEL = "No due date";

// ---------------------------------------------------------------------------------------------
// The closed field-message set
// ---------------------------------------------------------------------------------------------

/**
 * The closed message set the task schema and the task composer reuse instead of writing their own.
 *
 * Each message states the rule in the worker's terms and says what to do about it, so a rejection
 * describes the task and never the person. A form places the message beside the control that produced
 * it, keyed by the field path the schema reports.
 */
export const TASK_FIELD_MESSAGES = {
  titleRequired: "A task needs a title. Every other field is optional.",
  // No count appears here on purpose: the limit belongs to the schema that enforces it, and a number
  // repeated in this sentence would be a second source for the same rule that silently drifts.
  categoryTooLong: "A category is a short label, so shorten this one to a few words.",
  dueDateInvalid: "A due date is a calendar date, so choose a real date or leave the field empty.",
  plannedTimeRequiresTimeZone:
    "A planned time needs the timezone it is stated in, so the time is never read as one in an assumed zone.",
  plannedTimeOnlyForMeeting:
    "Only a meeting task carries a planned time, so choose Meeting as the kind or remove the time.",
} as const;
