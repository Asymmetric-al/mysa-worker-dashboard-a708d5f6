/**
 * The Work family's only task-status, task-list and task-vocabulary wording.
 */
import type { TaskRecordStatus as TaskStatus } from "@/modules/data-service/envelope";
// Where a task stands
/** The four states a task can be in, worded once for every surface that shows one. */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  completed: "Completed",
  reopened: "Reopened",
  cancelled: "Cancelled",
};
/** The order a status filter and a status selector offer the four states in. */
export const TASK_STATUS_ORDER = ["open", "completed", "reopened", "cancelled"] as const satisfies readonly TaskStatus[];

type UnlistedTaskStatus = Exclude<TaskStatus, (typeof TASK_STATUS_ORDER)[number]>;
/** A compile-time guard rather than a runtime switch: this constant only type-checks while `UnlistedTaskStatus` is `never`. */
export const TASK_STATUS_ORDER_IS_COMPLETE: UnlistedTaskStatus extends never ? true : false = true;
// The five lists
/** The five lists the Work surface offers. */
export type TaskListKey = "today" | "upcoming" | "overdue" | "all" | "undated";

export const TASK_LIST_KEYS = ["today", "upcoming", "overdue", "all", "undated"] as const satisfies readonly TaskListKey[];

type UnlistedTaskListKey = Exclude<TaskListKey, (typeof TASK_LIST_KEYS)[number]>;
/** The same compile-time guard as the status one: it only type-checks while nothing is missing. */
export const TASK_LIST_KEYS_ARE_COMPLETE: UnlistedTaskListKey extends never ? true : false = true;
/** The five names as the list bar shows them, in the order above. */
export const TASK_LIST_LABELS: Record<TaskListKey, string> = {
  today: "Today",
  upcoming: "Upcoming",
  overdue: "Overdue",
  all: "All",
  undated: "Undated",
};
// What kind of work it is
/** The two kinds of work: an ordinary task, and a meeting that may carry a planned time. */
export type TaskKind = "default" | "meeting";

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  default: "Task",
  meeting: "Meeting",
};
// Planned, and held
export const PLANNED_TIME_LABEL = "Planned time";
/** The input label that makes the zone part of the time rather than an assumption beside it. */
export const PLANNED_TIME_ZONE_LABEL = "Timezone for this time";
/** The two states a meeting row can show, so a plan never reads as something that already happened. */
export const PLANNED_MEETING_LABEL = "Planned";

export const HELD_MEETING_LABEL = "Held";
/** What separates the two states above, stated wherever a planned time is entered or shown. */
export const PLANNED_VERSUS_HELD_NOTE = "A planned time is a plan, and a meeting counts as held only once an interaction records that it happened.";
/** What completing or reopening a task does not record, stated beside both actions. */
export const COMPLETION_MEANS_NOTHING_NOTE = "Completing or reopening a task records no contact, payment, fulfilment or message.";
// Categorised, and uncategorised
export const CATEGORY_LABEL = "Category";
/** What the category field is, and the two things it is not. */
export const CATEGORY_HINT = "Your own short label for finding similar tasks; it is not a shared taxonomy and not a stage.";
/** The two states a task's category can be in. */
export type TaskCategorisationState = "categorised" | "uncategorised";
/** The two states, worded so an uncategorised task reads as a valid task with no label rather than as something missing. */
export const CATEGORY_STATE_LABELS: Record<TaskCategorisationState, string> = {
  categorised: "Categorised",
  uncategorised: "No category",
};
// Dates
export const DUE_DATE_LABEL = "Due date";
/** The honest name for a task with no due date: it is undated, which is a complete state and not an empty one. */
export const UNDATED_LABEL = "No due date";
// The closed field-message set
/** The closed message set the task schema and the task composer reuse instead of writing their own. */
export const TASK_FIELD_MESSAGES = {
  titleRequired: "A task needs a title. Every other field is optional.",
  // No count appears here on purpose: the limit belongs to the schema that enforces it, and a number
  // repeated in this sentence would be a second source for the same rule that silently drifts.
  categoryTooLong: "A category is a short label, so shorten this one to a few words.",
  dueDateInvalid: "A due date is a calendar date, so choose a real date or leave the field empty.",
  plannedTimeRequiresTimeZone: "A planned time needs the timezone it is stated in, so the time is never read as one in an assumed zone.",
  plannedTimeOnlyForMeeting: "Only a meeting task carries a planned time, so choose Meeting as the kind or remove the time.",
} as const;
