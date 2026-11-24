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
export const UNFINISHED_WORK_VALUES = ["keep", "cancel"] as const;
export type UnfinishedWork = (typeof UNFINISHED_WORK_VALUES)[number];
export const UNFINISHED_WORK_LEGEND = "Unfinished work";
export const UNFINISHED_WORK_LABELS: Record<UnfinishedWork, string> = { keep: "Keep the unfinished dates", cancel: "Cancel the unfinished dates" };
export const UNFINISHED_WORK_HINTS: Record<UnfinishedWork, string> = {
  keep: "The dates stay exactly where they are, as ordinary work: this series admits no further dates, and every date it already holds keeps the state it is in now.",
  cancel: "Every date still awaiting an answer is cancelled with the series. Completed history is untouched, and nothing is recorded as contact.",
};
export const STOP_REVIEW_CHOICE_SENTENCE = "Stopping admits no further dates, and it completes nothing on your behalf: what happens to the dates already on the series is the choice below, and stopping records no contact either way.";
export const STOP_REVIEW_NOT_RESUMABLE_SENTENCE = "A stopped series is not paused and cannot be resumed, so plan anything still needed after this as new work.";
export const STOPPED_NOTE = "A stopped series admits no further dates, and stopping completed none of the dates it left behind: each unfinished date is either kept as ordinary work or cancelled with the series, exactly as the stop recorded it.";
export const STALE_SERIES_ACTION_MESSAGE = "This series was stopped after your change started, so nothing from that change was applied.";
export const STALE_SERIES_ACTION_RECOVERY = "Open the series to see its current state, then decide what the work needs now.";
export const MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE = "Choose how the plan continues — one of the three resolutions — before you apply the change.";
