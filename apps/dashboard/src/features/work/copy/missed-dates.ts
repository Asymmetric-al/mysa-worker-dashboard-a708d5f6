import type { PlanResolutions, SeriesState } from "@/modules/time/recurrence";
export type MissedPlanResolution = PlanResolutions[number];
export const PLAN_NEEDS_REVIEW_HEADING = "Plan needs review";
export const PLAN_NEEDS_REVIEW_EXPLANATION = "Several dates on this series passed without an action, so it is the plan that needs a decision rather than a backlog to clear: no date listed here is overdue, and nothing here says a conversation or a contact happened. You choose how the series continues.";
export const MISSED_PLAN_RESOLUTION_LABELS: Record<MissedPlanResolution, string> = { "keep-this-occurrence": "Keep this occurrence", "move-next-date-forward": "Move the next date forward", "stop-series": "Stop series" };
export const MISSED_PLAN_RESOLUTION_ORDER: readonly MissedPlanResolution[] = ["keep-this-occurrence", "move-next-date-forward", "stop-series"] as const satisfies PlanResolutions;
export const MISSED_PLAN_RESOLUTION_DESCRIPTIONS: Record<MissedPlanResolution, string> = {
  "keep-this-occurrence": "Keeps the occurrence you are working with as the one actionable date; completing or skipping it admits at most one next date, and nothing is recorded as contact.",
  "move-next-date-forward": "Keeps the series running and sets its next upcoming date; the dates that already passed stay unperformed and gain no successor.",
  "stop-series": "Admits no further dates; the work already on the series stays exactly where it is and nothing is completed on your behalf.",
};
export const ONE_SUCCESSOR_NOTE = "Completing or skipping an occurrence admits at most one next date, so the series never offers more than one actionable date.";
export const SKIPPED_MEANS_NOT_PERFORMED_NOTE = "A skipped occurrence was not performed: skipping is not completing, and it records no contact.";
export const SERIES_STATE_LABELS: Record<SeriesState, string> = { active: "Active", paused: "Paused", stopped: "Stopped" };
export const PAUSED_NOTE = "While the series is paused no new dates are admitted, and pausing completes nothing: the plan is held rather than closed, and it can be resumed.";
export const STOPPED_NOTE = "A stopped series admits no further dates, and its unfinished work stays exactly where it is.";
export const STALE_SERIES_ACTION_MESSAGE = "This series was stopped after your change started, so nothing from that change was applied.";
export const STALE_SERIES_ACTION_RECOVERY = "Open the series to see its current state, then decide what the work needs now.";
export const MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE = "Choose how the plan continues — one of the three resolutions — before you apply the change.";
