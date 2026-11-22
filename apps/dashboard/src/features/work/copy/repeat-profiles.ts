import type { RepeatProfile, SeriesEnd } from "@/modules/time/recurrence";
export const REPEAT_PROFILE_LABELS: Record<RepeatProfile, string> = { none: "Does not repeat", weekly: "Weekly", everyNWeeks: "Every N weeks", monthlyOnDay: "Monthly on day N", everyNMonths: "Every N months on day N" };
export const REPEAT_PROFILE_ORDER = ["none", "weekly", "everyNWeeks", "monthlyOnDay", "everyNMonths"] as const satisfies readonly RepeatProfile[];
type UnlistedRepeatProfile = Exclude<RepeatProfile, (typeof REPEAT_PROFILE_ORDER)[number]>;
export const REPEAT_PROFILE_ORDER_IS_COMPLETE: UnlistedRepeatProfile extends never ? true : false = true;
export type RepeatProfileField = "interval" | "dayOfMonth";
export const REPEAT_PROFILE_FIELDS: Record<RepeatProfile, readonly RepeatProfileField[]> = { none: [], weekly: [], everyNWeeks: ["interval"], monthlyOnDay: ["dayOfMonth"], everyNMonths: ["interval", "dayOfMonth"] };
export const REPEAT_PROFILE_DESCRIPTIONS: Record<RepeatProfile, string> = {
  none: "The task has the one date you choose and does not repeat.",
  weekly: "The task returns on the same day each week, starting from the first due date.",
  everyNWeeks: "The task returns on the same day every N weeks, counted from the first due date.",
  monthlyOnDay: "The task returns each month on the day you choose, using the final day of any month that is shorter.",
  everyNMonths: "The task returns every N months on the day you choose, using the final day of any month that is shorter.",
};
export const FIRST_DUE_DATE_LABEL = "First due date";
export const FIRST_DUE_DATE_HINT = "A first due date is required. It is a calendar date, so it stays that date wherever you are.";
export const PLANNING_TIME_ZONE_LABEL = "Planning timezone";
/** Why the zone is asked for at all: a due date and the day a series is judged against are civil dates in the series' own zone, so a display change cannot move them. */
export const PLANNING_TIME_ZONE_NOTE = "The series is planned in the timezone you choose here, so changing your device or display timezone does not move any of its dates.";
export const INTERVAL_LABEL = "Repeat every";
export const INTERVAL_UNIT_LABELS: Record<"weeks" | "months", string> = { weeks: "weeks", months: "months" };
export const DAY_OF_MONTH_LABEL = "Day of the month";
export const MISSING_MONTHLY_DAY_DISCLOSURE = "For missing monthly dates, use and disclose the final day of that month.";
export const LAST_DAY_OF_MONTH_RESOLUTION_TEMPLATE = "Day {day} does not exist in {month}, so the final day of that month is used, and that resolution is disclosed with the date.";
export const END_CONDITION_LABELS: Record<SeriesEnd["kind"], string> = { "on-date": "End on a date", "after-count": "End after a number of occurrences", "ongoing-personal-policy": "Continue until I stop the series" };
export const END_DATE_LABEL = "End date";
export const END_COUNT_LABEL = "Number of occurrences";
export const ONGOING_POLICY_LABEL = "Allow a series to continue until I stop it";
/** Why the third end condition is conditional: it exists only where the qualified ongoing-personal-series policy applies, and without it an end date or a count is required because a missing. */
export const ONGOING_POLICY_NOTE = "This choice appears only when the ongoing personal series policy applies to you. Otherwise a series needs an end date or a number of occurrences, because a missing end is not permission to keep planning it.";
export const ONGOING_POLICY_END_STATEMENT = "Nothing ends this plan: it has no end date and no number of occurrences, and it continues under the ongoing personal series policy until you stop it.";
export const NEXT_DATES_PREVIEW_HEADING = "Next three dates";
export const SINGLE_ACTIONABLE_OCCURRENCE_NOTE = "Only one date is actionable at a time. The other dates are previews of what the rule produces, and nothing happens on them until they become the next date.";
export const SERIES_FIELD_MESSAGES = {
  firstDueDateRequired: "Choose the first due date this series counts from.",
  planningTimeZoneRequired: "Choose the planning timezone this series is planned in.",
  intervalRequired: "Choose a whole number of at least 1 for how often this series repeats.",
  dayOfMonthRequired: "Choose the day of the month, from 1 to 31.",
  endRequired: "Choose an end date or a number of occurrences, or turn on the ongoing personal series policy.",
} as const;
/** The Work surface's create-a-plan section: the host states what the section is for, and the editor states the form itself. */
export const CREATE_PLAN_HEADING = "Plan work that repeats";
export const CREATE_PLAN_NOTE =
  "A plan that repeats is stated here and then opens on its own page. State the work, the first due date, the timezone its dates are planned in and when it ends; the dates already planned keep the rule they were planned under, so a later change shapes only the dates from its own boundary onward.";
export const NEW_PLAN_LABEL = "New repeating plan";
/**
 * What a plan's own surface states when its re-read no longer answers with the plan.
 *
 * A plan is re-read after every settled change to it, so these arms describe a read that answered after the
 * first paint rather than the page that was requested: the plan itself is never painted over by a stale answer.
 */
export const SERIES_REREAD_DENIED_TITLE = "This repeating plan is no longer available";
export const SERIES_REREAD_DENIED_BODY = "This session may not read that plan now, so no rule, date, occurrence or count is stated here — a refusal discloses nothing about whether the plan exists. Another plan, or another context, can be read from the Work lists.";
export const SERIES_REREAD_UNAVAILABLE_TITLE = "This repeating plan could not be read";
export const SERIES_REREAD_UNAVAILABLE_RETRY = "Try this read again";
export const SERIES_REREAD_REFUSED_TITLE = "This plan's request was refused";
export const SERIES_REREAD_REFUSED_BODY = "The request behind this plan is not one the series read admits, so the refusal is stated here rather than thrown and nothing stands in place of the plan.";
export const SERIES_REREAD_FAILED_BODY = "This plan's own read did not answer, so the rule and the dates on screen would be the ones it held before the last change. Try the read again, and reset the development data if it keeps failing.";
export const SERIES_REREAD_BACK_LABEL = "Read the Work lists";
