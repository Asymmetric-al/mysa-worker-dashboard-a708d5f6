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
export const PLANNED_TIME_LABEL = "Scheduled time";
export const PLANNED_TIME_ZONE_LABEL = "Time zone";
export const PLANNED_MEETING_LABEL = "Scheduled";
export const PLANNED_VERSUS_HELD_NOTE = "A scheduled meeting time is a reminder only — log an activity once the meeting actually happens.";
export const COMPLETION_MEANS_NOTHING_NOTE = "Completing a task marks the reminder done without logging an interaction, gift, or email.";
export const CATEGORY_LABEL = "Category";
export const CATEGORY_HINT = "Your own short label for grouping similar tasks (for example, Thank-you or Follow-up).";
export type TaskCategorisationState = "categorised" | "uncategorised";
export const CATEGORY_STATE_LABELS: Record<TaskCategorisationState, string> = { categorised: "Categorized", uncategorised: "None" };
export const DUE_DATE_LABEL = "Due date";
export const UNDATED_LABEL = "No due date";
export const TASK_FIELD_MESSAGES = {
  titleRequired: "Give your task a title.",
  categoryTooLong: "Shorten this category label to a few words.",
  dueDateInvalid: "Enter a valid calendar date or leave this blank.",
  plannedTimeRequiresTimeZone: "Choose a time zone for this scheduled meeting time.",
  plannedTimeOnlyForMeeting: "Choose Meeting as the type to set a scheduled time, or clear the time.",
} as const;
