import type { RepeatProfile, SeriesEnd } from "@/modules/time/recurrence";
export const REPEAT_PROFILE_LABELS: Record<RepeatProfile, string> = { none: "Does not repeat", weekly: "Weekly", everyNWeeks: "Every few weeks", monthlyOnDay: "Monthly on a set day", everyNMonths: "Every few months" };
export type RepeatRuleFacts = { readonly profile: RepeatProfile; readonly interval: number; readonly dayOfMonth: number | null };
type IntervalUnit = "week" | "month"; /** Formats an interval cleanly so 1 reads "Every week" rather than "Every 1 weeks". */
const everyInterval = (interval: number, unit: IntervalUnit): string => (interval === 1 ? `Every ${unit}` : `Every ${String(interval)} ${unit}s`);
/** Human-readable summary of a concrete repeat rule with its exact numbers. */ export function repeatRuleLabel(rule: RepeatRuleFacts): string {
  switch (rule.profile) {
    case "none":
      return REPEAT_PROFILE_LABELS.none;
    case "weekly":
      return REPEAT_PROFILE_LABELS.weekly;
    case "everyNWeeks":
      return everyInterval(rule.interval, "week");
    case "monthlyOnDay":
      return rule.dayOfMonth === null ? "Monthly" : `Monthly on day ${String(rule.dayOfMonth)}`;
    case "everyNMonths":
      return rule.dayOfMonth === null ? everyInterval(rule.interval, "month") : `${everyInterval(rule.interval, "month")} on day ${String(rule.dayOfMonth)}`;
  }
}
export const REPEAT_PROFILE_ORDER = ["none", "weekly", "everyNWeeks", "monthlyOnDay", "everyNMonths"] as const satisfies readonly RepeatProfile[];
export const REPEAT_PROFILE_ORDER_IS_COMPLETE: Exclude<RepeatProfile, (typeof REPEAT_PROFILE_ORDER)[number]> extends never ? true : false = true;
export type RepeatProfileField = "interval" | "dayOfMonth";
export const REPEAT_PROFILE_FIELDS: Record<RepeatProfile, readonly RepeatProfileField[]> = { none: [], weekly: [], everyNWeeks: ["interval"], monthlyOnDay: ["dayOfMonth"], everyNMonths: ["interval", "dayOfMonth"] };
export const REPEAT_PROFILE_DESCRIPTIONS: Record<RepeatProfile, string> = {
  none: "Occurs once on the due date and doesn’t repeat.",
  weekly: "Repeats on the same weekday every week.",
  everyNWeeks: "Repeats on the same weekday every few weeks (choose how many weeks).",
  monthlyOnDay: "Repeats every month on the day you choose (uses the last day of shorter months).",
  everyNMonths: "Repeats every few months on the day you choose (uses the last day of shorter months).",
};
export const FIRST_DUE_DATE_LABEL = "First due date";
export const FIRST_DUE_DATE_HINT = "Calendar date for the first task — stays the same day wherever you travel.";
export const PLANNING_TIME_ZONE_LABEL = "Planning time zone";
export const PLANNING_TIME_ZONE_NOTE = "Anchors this repeating schedule so changing your display time zone won’t shift its dates.";
export const INTERVAL_LABEL = "Repeat every";
export const INTERVAL_UNIT_LABELS: Record<"weeks" | "months", string> = { weeks: "weeks", months: "months" };
export const DAY_OF_MONTH_LABEL = "Day of the month";
export const MISSING_MONTHLY_DAY_DISCLOSURE = "In shorter months (like February), the last day of the month is used and noted clearly.";
export const LAST_DAY_OF_MONTH_RESOLUTION_TEMPLATE = "Day {day} doesn’t exist in {month}, so the last day of the month is used.";
export const END_CONDITION_LABELS: Record<SeriesEnd["kind"], string> = { "on-date": "End on a specific date", "after-count": "End after a set number of times", "ongoing-personal-policy": "Keep repeating until I stop it" };
export const END_DATE_LABEL = "End date";
export const END_COUNT_LABEL = "Number of occurrences";
export const ONGOING_POLICY_NOTE = "Ongoing plans are available for personal follow-up plans; otherwise pick an end date or count.";
export const ONGOING_POLICY_END_STATEMENT = "Repeats ongoing until you stop it.";
export const NEXT_DATES_PREVIEW_HEADING = "Next three scheduled dates";
export const SINGLE_ACTIONABLE_OCCURRENCE_NOTE = "Only one date is active at a time — future dates are shown as a preview so overdue tasks don’t pile up.";
export const SERIES_FIELD_MESSAGES = {
  firstDueDateRequired: "Choose a first due date.",
  planningTimeZoneRequired: "Choose a planning time zone.",
  intervalRequired: "Enter a whole number of 1 or more.",
  dayOfMonthRequired: "Enter a day of the month from 1 to 31.",
  endRequired: "Choose when this plan ends.",
} as const;
/** Section copy for creating a repeating plan on the Tasks screen. */ export const CREATE_PLAN_HEADING = "Repeating follow-up plans";
export const CREATE_PLAN_NOTE = "Set up recurring reminders (like monthly partner check-ins or quarterly thank-yous). Editing a plan later updates future dates while keeping your completed history.";
export const NEW_PLAN_LABEL = "New repeating plan";
/** Notices when a repeating plan re-read fails or is denied. */ export const SERIES_REREAD_DENIED_TITLE = "This repeating plan isn’t available";
export const SERIES_REREAD_DENIED_BODY = "Your current session no longer has access to this plan. Return to Tasks to view plans in your current ministry.";
export const SERIES_REREAD_UNAVAILABLE_TITLE = "Couldn’t load this repeating plan";
export const SERIES_REREAD_UNAVAILABLE_RETRY = "Try again";
export const SERIES_REREAD_REFUSED_TITLE = "Couldn’t load repeating plan";
export const SERIES_REREAD_REFUSED_BODY = "This plan couldn’t be loaded with the current request.";
export const SERIES_REREAD_FAILED_BODY = "Couldn’t refresh this plan after your last change. Try again to see the latest schedule.";
export const SERIES_REREAD_BACK_LABEL = "Back to Tasks";
