/**
 * The Work family's only wording for a series whose plan needs review, and for the three resolutions
 * that review offers.
 */
import type { PlanResolutions, SeriesState } from "@/modules/time/recurrence";
/** One of the three resolutions a plan in review offers. */
export type MissedPlanResolution = PlanResolutions[number];
/** The heading for several missed dates. */
export const PLAN_NEEDS_REVIEW_HEADING = "Plan needs review";
/** What the heading means, in the panel's own words: dates passed without an action, nothing is overdue, no conversation or contact is assumed, and the worker decides how the series goes on. */
export const PLAN_NEEDS_REVIEW_EXPLANATION =
  "Several dates on this series passed without an action, so it is the plan that needs a decision rather than a backlog to clear: no date listed here is overdue, and nothing here says a conversation or a contact happened. You choose how the series continues.";
/** The three resolutions as the panel offers them, worded exactly as the rules fix them. */
export const MISSED_PLAN_RESOLUTION_LABELS: Record<MissedPlanResolution, string> = {
  "keep-this-occurrence": "Keep this occurrence",
  "move-next-date-forward": "Move the next date forward",
  "stop-series": "Stop series",
};
/** The three resolutions in the order the panel offers them, and no fourth option. */
export const MISSED_PLAN_RESOLUTION_ORDER: readonly MissedPlanResolution[] = ["keep-this-occurrence", "move-next-date-forward", "stop-series"] as const satisfies PlanResolutions;
/** One sentence per resolution, stating what it does and what it deliberately leaves alone. */
export const MISSED_PLAN_RESOLUTION_DESCRIPTIONS: Record<MissedPlanResolution, string> = {
  "keep-this-occurrence": "Keeps the occurrence you are working with as the one actionable date; completing or skipping it admits at most one next date, and nothing is recorded as contact.",
  "move-next-date-forward": "Keeps the series running and sets its next upcoming date; the dates that already passed stay unperformed and gain no successor.",
  "stop-series": "Admits no further dates; the work already on the series stays exactly where it is and nothing is completed on your behalf.",
};
/** Only one occurrence is ever actionable, so a series never offers several dates at once. */
export const ONE_SUCCESSOR_NOTE = "Completing or skipping an occurrence admits at most one next date, so the series never offers more than one actionable date.";
/** Skipping answers the date, it does not do the work: the two outcomes never read as one. */
export const SKIPPED_MEANS_NOT_PERFORMED_NOTE = "A skipped occurrence was not performed: skipping is not completing, and it records no contact.";
/** The three states a series can hold, worded so paused and stopped never read as one. */
export const SERIES_STATE_LABELS: Record<SeriesState, string> = {
  active: "Active",
  paused: "Paused",
  stopped: "Stopped",
};
/** A pause holds the plan and completes nothing; it is not a stop and it can be resumed. */
export const PAUSED_NOTE = "While the series is paused no new dates are admitted, and pausing completes nothing: the plan is held rather than closed, and it can be resumed.";
/** A stop ends the series; unfinished work is left where it is rather than resolved silently. */
export const STOPPED_NOTE = "A stopped series admits no further dates, and its unfinished work stays exactly where it is.";
/** Shown when a series change comes back `conflict` or `unchanged` because the series moved on while the change was in flight — a later Stop is never undone by an earlier action. */
export const STALE_SERIES_ACTION_MESSAGE = "This series was stopped after your change started, so nothing from that change was applied.";
/** How the worker sees the current state before deciding what the work needs next. */
export const STALE_SERIES_ACTION_RECOVERY = "Open the series to see its current state, then decide what the work needs now.";
/** The one required-choice message the occurrence schema and the panel share instead of writing inline. */
export const MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE = "Choose how the plan continues — one of the three resolutions — before you apply the change.";
