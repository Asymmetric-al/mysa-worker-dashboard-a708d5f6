/**
 * The Work family's only wording for the closed repeat rule: the five profile names in their fixed
 * order, the fields each profile reads, the three ways a series can end, and the disclosures that keep
 * a planned date honest.
 */
import type { RepeatProfile, SeriesEnd } from "@/modules/time/recurrence";
/** The five profile names, each verbatim as the rule fixes it and in the rule's own order. */
export const REPEAT_PROFILE_LABELS: Record<RepeatProfile, string> = {
  none: "Does not repeat",
  weekly: "Weekly",
  everyNWeeks: "Every N weeks",
  monthlyOnDay: "Monthly on day N",
  everyNMonths: "Every N months on day N",
};
/** The same five in the same order, for the selector that offers them. */
export const REPEAT_PROFILE_ORDER = ["none", "weekly", "everyNWeeks", "monthlyOnDay", "everyNMonths"] as const satisfies readonly RepeatProfile[];

type UnlistedRepeatProfile = Exclude<RepeatProfile, (typeof REPEAT_PROFILE_ORDER)[number]>;
/** A compile-time guard rather than a runtime switch: this constant only type-checks while `UnlistedRepeatProfile` is `never`. */
export const REPEAT_PROFILE_ORDER_IS_COMPLETE: UnlistedRepeatProfile extends never ? true : false = true;
/** The two inputs the "every N" and monthly profiles read, and the only two that vary by profile. */
export type RepeatProfileField = "interval" | "dayOfMonth";
/** Which of those inputs each profile reads, declared once so no component writes the conditional. */
export const REPEAT_PROFILE_FIELDS: Record<RepeatProfile, readonly RepeatProfileField[]> = {
  none: [],
  weekly: [],
  everyNWeeks: ["interval"],
  monthlyOnDay: ["dayOfMonth"],
  everyNMonths: ["interval", "dayOfMonth"],
};
/** One sentence per profile saying what it produces. */
export const REPEAT_PROFILE_DESCRIPTIONS: Record<RepeatProfile, string> = {
  none: "The task has the one date you choose and does not repeat.",
  weekly: "The task returns on the same day each week, starting from the first due date.",
  everyNWeeks: "The task returns on the same day every N weeks, counted from the first due date.",
  monthlyOnDay: "The task returns each month on the day you choose, using the final day of any month that is shorter.",
  everyNMonths: "The task returns every N months on the day you choose, using the final day of any month that is shorter.",
};
export const FIRST_DUE_DATE_LABEL = "First due date";
/** Stated beside the field, because the date the series counts from is the worker's choice. */
export const FIRST_DUE_DATE_HINT = "A first due date is required. It is a calendar date, so it stays that date wherever you are.";

export const PLANNING_TIME_ZONE_LABEL = "Planning timezone";
/** Why the zone is asked for at all: a due date and the day a series is judged against are civil dates in the series' own zone, so a display change cannot move them. */
export const PLANNING_TIME_ZONE_NOTE = "The series is planned in the timezone you choose here, so changing your device or display timezone does not move any of its dates.";

export const INTERVAL_LABEL = "Repeat every";
/** The unit words for the interval, read after the interval number and its label. */
export const INTERVAL_UNIT_LABELS: Record<"weeks" | "months", string> = {
  weeks: "weeks",
  months: "months",
};
export const DAY_OF_MONTH_LABEL = "Day of the month";
/** The rule the monthly profiles follow when the chosen day does not exist in a month, stated exactly as the specification fixes it. */
export const MISSING_MONTHLY_DAY_DISCLOSURE = "For missing monthly dates, use and disclose the final day of that month.";
/** The same resolution said to the worker about one date. */
export const LAST_DAY_OF_MONTH_RESOLUTION_TEMPLATE = "Day {day} does not exist in {month}, so the final day of that month is used, and that resolution is disclosed with the date.";
/** The three ways a series can end, keyed by the domain module's own end kinds. */
export const END_CONDITION_LABELS: Record<SeriesEnd["kind"], string> = {
  "on-date": "End on a date",
  "after-count": "End after a number of occurrences",
  "ongoing-personal-policy": "Continue until I stop the series",
};
export const END_DATE_LABEL = "End date";

export const END_COUNT_LABEL = "Number of occurrences";

export const ONGOING_POLICY_LABEL = "Allow a series to continue until I stop it";
/** Why the third end condition is conditional: it exists only where the qualified ongoing-personal-series policy applies, and without it an end date or a count is required because a missing. */
export const ONGOING_POLICY_NOTE =
  "This choice appears only when the ongoing personal series policy applies to you. Otherwise a series needs an end date or a number of occurrences, because a missing end is not permission to keep planning it.";
export const NEXT_DATES_PREVIEW_HEADING = "Next three dates";
/** What a preview is: the dates the rule would produce, all but the next one shown for orientation. */
export const SINGLE_ACTIONABLE_OCCURRENCE_NOTE =
  "Only one date is actionable at a time. The other dates are previews of what the rule produces, and nothing happens on them until they become the next date.";
/** The closed message set the series schema and the series editor reuse instead of writing their own. */
export const SERIES_FIELD_MESSAGES = {
  firstDueDateRequired: "Choose the first due date this series counts from.",
  planningTimeZoneRequired: "Choose the planning timezone this series is planned in.",
  intervalRequired: "Choose a whole number of at least 1 for how often this series repeats.",
  dayOfMonthRequired: "Choose the day of the month, from 1 to 31.",
  endRequired: "Choose an end date or a number of occurrences, or turn on the ongoing personal series policy.",
} as const;
