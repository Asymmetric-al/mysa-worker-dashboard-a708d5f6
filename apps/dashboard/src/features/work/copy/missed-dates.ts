import type { PlanResolutions, SeriesState } from "@/modules/time/recurrence";
export type MissedPlanResolution = PlanResolutions[number];
export const PLAN_NEEDS_REVIEW_HEADING = "Plan needs review";
export const PLAN_NEEDS_REVIEW_EXPLANATION = "Several dates on this repeating plan passed without action. Instead of stacking overdue tasks, choose how you’d like this plan to continue.";
export const MISSED_PLAN_RESOLUTION_LABELS: Record<MissedPlanResolution, string> = { "keep-this-occurrence": "Keep this occurrence", "move-next-date-forward": "Move next date forward", "stop-series": "Stop plan" };
export const MISSED_PLAN_RESOLUTION_ORDER: readonly MissedPlanResolution[] = ["keep-this-occurrence", "move-next-date-forward", "stop-series"] as const satisfies PlanResolutions;
export const MISSED_PLAN_RESOLUTION_DESCRIPTIONS: Record<MissedPlanResolution, string> = {
  "keep-this-occurrence": "Keep the current task active. Completing or skipping it schedules the next date.",
  "move-next-date-forward": "Keep the plan active and jump ahead to the next upcoming date. Missed dates stay skipped.",
  "stop-series": "End the repeating plan permanently. Existing tasks stay untouched.",
};
export const ONE_SUCCESSOR_NOTE = "Completing or skipping an occurrence schedules only one next date at a time.";
export const SKIPPED_MEANS_NOT_PERFORMED_NOTE = "Skipping moves to the next date without marking the task completed or logging activity.";
export const SERIES_STATE_LABELS: Record<SeriesState, string> = { active: "Active", paused: "Paused", stopped: "Stopped" };
export const PAUSED_NOTE = "Paused — no new dates will be scheduled until you resume this plan.";
export const UNFINISHED_WORK_VALUES = ["keep", "cancel"] as const;
export type UnfinishedWork = (typeof UNFINISHED_WORK_VALUES)[number];
export const UNFINISHED_WORK_LEGEND = "What should happen to open tasks?";
export const UNFINISHED_WORK_LABELS: Record<UnfinishedWork, string> = { keep: "Keep open tasks", cancel: "Cancel open tasks" };
export const UNFINISHED_WORK_HINTS: Record<UnfinishedWork, string> = {
  keep: "Leave open tasks in your task list as one-off tasks. No new dates will be scheduled.",
  cancel: "Cancel any remaining open occurrences. Completed history stays intact.",
};
export const STOP_REVIEW_CHOICE_SENTENCE = "Stopping ends this repeating plan without completing any open tasks. Choose what should happen to open tasks below.";
export const STOP_REVIEW_NOT_RESUMABLE_SENTENCE = "A stopped plan cannot be resumed — pause it instead if you may want to restart later.";
export const STOPPED_NOTE = "Stopped — no future dates will be scheduled. Open tasks were kept or cancelled as chosen when stopped.";
export const STALE_SERIES_ACTION_MESSAGE = "This repeating plan was stopped after you opened it, so your change wasn’t applied.";
export const STALE_SERIES_ACTION_RECOVERY = "Refresh the plan to check its current status.";
export const MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE = "Choose one of the three options below to continue.";
