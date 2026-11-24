import type { TaskRecordStatus as TaskStatus } from "@/modules/data-service/envelope";
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { open: "Open", completed: "Completed", reopened: "Reopened", cancelled: "Cancelled" };
export const TASK_STATUS_ORDER = ["open", "completed", "reopened", "cancelled"] as const satisfies readonly TaskStatus[];
export const TASK_STATUS_ORDER_IS_COMPLETE: Exclude<TaskStatus, (typeof TASK_STATUS_ORDER)[number]> extends never ? true : false = true;
export type TaskListKey = "today" | "upcoming" | "overdue" | "all" | "undated";
export const TASK_LIST_KEYS = ["today", "upcoming", "overdue", "all", "undated"] as const satisfies readonly TaskListKey[];
export const TASK_LIST_KEYS_ARE_COMPLETE: Exclude<TaskListKey, (typeof TASK_LIST_KEYS)[number]> extends never ? true : false = true;
export const TASK_LIST_LABELS: Record<TaskListKey, string> = { today: "Today", upcoming: "Upcoming", overdue: "Overdue", all: "All", undated: "Undated" };
export type TaskKind = "default" | "meeting";
export const TASK_KIND_LABELS: Record<TaskKind, string> = { default: "Task", meeting: "Meeting" };
export const PLANNED_TIME_LABEL = "Planned time";
export const PLANNED_TIME_ZONE_LABEL = "Timezone for this time";
export const PLANNED_MEETING_LABEL = "Planned";
export const PLANNED_VERSUS_HELD_NOTE = "A planned time is a plan, and a meeting counts as held only once an interaction records that it happened.";
export const COMPLETION_MEANS_NOTHING_NOTE = "Completing or reopening a task records no contact, payment, fulfilment or message.";
export const CATEGORY_LABEL = "Category";
export const CATEGORY_HINT = "Your own short label for finding similar tasks; it is not a shared taxonomy and not a stage.";
export type TaskCategorisationState = "categorised" | "uncategorised";
export const CATEGORY_STATE_LABELS: Record<TaskCategorisationState, string> = { categorised: "Categorised", uncategorised: "No category" };
export const DUE_DATE_LABEL = "Due date";
export const UNDATED_LABEL = "No due date";
export const TASK_FIELD_MESSAGES = {
  titleRequired: "A task needs a title. Every other field is optional.",
  categoryTooLong: "A category is a short label, so shorten this one to a few words.",
  dueDateInvalid: "A due date is a calendar date, so choose a real date or leave the field empty.",
  plannedTimeRequiresTimeZone: "A planned time needs the timezone it is stated in, so the time is never read as one in an assumed zone.",
  plannedTimeOnlyForMeeting: "Only a meeting task carries a planned time, so choose Meeting as the kind or remove the time.",
} as const;
