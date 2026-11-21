/**
 * The Work family's only wording for the closed repeat rule: the five profile names in their
 * fixed order, the fields each profile reads, the three ways a series can end, and the
 * disclosures that keep a planned date honest.
 *
 * The rule this module states is fixed elsewhere as a rule and here as words. AAP 0.8.2 closes
 * the set of profiles at exactly five: no repeat, a weekly repeat, an every-N-weeks repeat, a
 * monthly repeat on a day, and an every-N-months repeat on a day. It requires a first due date and
 * a planning timezone; requires an end date or a count unless the qualified ongoing-personal-series
 * policy is on; and holds that only one occurrence is actionable while the future dates are
 * previews. AAP 0.8.7 fixes the missing-day resolution that must be disclosed: day 31 in February
 * resolves to the 28th or the 29th.
 *
 * Text only. No JSX, no styling, no formatter, no date arithmetic and no recurrence evaluation:
 * the dates themselves come from `@/modules/time/recurrence`, which owns the profile set as a
 * type, the monthly day resolver and successor admission. Restating that rule here would be a
 * second implementation of it, so this module names things and explains them instead. Every map
 * whose key is a union member is typed against that union and imported as a type only, so a sixth
 * profile or a fourth end kind cannot be added to the domain module without this file failing to
 * compile until it is worded.
 */

import type { RepeatProfile, SeriesEnd } from "@/modules/time/recurrence";

/**
 * The five profile names, each verbatim as the rule fixes it and in the rule's own order.
 *
 * Nothing here abbreviates a name: the every-N-months profile names both the interval and the day
 * of the month, so a worker choosing it learns that both are part of the plan.
 */
export const REPEAT_PROFILE_LABELS: Record<RepeatProfile, string> = {
  none: "Does not repeat",
  weekly: "Weekly",
  everyNWeeks: "Every N weeks",
  monthlyOnDay: "Monthly on day N",
  everyNMonths: "Every N months on day N",
};

/**
 * The same five in the same order, for the selector that offers them.
 *
 * The order is fixed here rather than derived from the key order of the map above, because the
 * selector's order is a product decision: a task with no repeat is the default a worker starts
 * from, so it reads first.
 */
export const REPEAT_PROFILE_ORDER = [
  "none",
  "weekly",
  "everyNWeeks",
  "monthlyOnDay",
  "everyNMonths",
] as const satisfies readonly RepeatProfile[];

/** Every profile the order above leaves out, which is none of them while the order is complete. */
type UnlistedRepeatProfile = Exclude<RepeatProfile, (typeof REPEAT_PROFILE_ORDER)[number]>;

/**
 * A compile-time guard rather than a runtime switch: this constant only type-checks while
 * `UnlistedRepeatProfile` is `never`.
 *
 * Adding a sixth profile to `RepeatProfile` leaves it unlisted above, `UnlistedRepeatProfile` stops
 * being `never`, and this line stops compiling until the profile is listed in the order and worded
 * in the labels. That is the whole point of the constant; the value it carries means nothing.
 */
export const REPEAT_PROFILE_ORDER_IS_COMPLETE: UnlistedRepeatProfile extends never ? true : false =
  true;

/** The two inputs the "every N" and monthly profiles read, and the only two that vary by profile. */
export type RepeatProfileField = "interval" | "dayOfMonth";

/**
 * Which of those inputs each profile reads, declared once so no component writes the conditional.
 *
 * The first due date, the planning timezone and the end apply to every profile and are therefore
 * not listed. An empty list is a complete answer, not a missing one: a profile that reads neither
 * input shows neither control.
 */
export const REPEAT_PROFILE_FIELDS: Record<RepeatProfile, readonly RepeatProfileField[]> = {
  none: [],
  weekly: [],
  everyNWeeks: ["interval"],
  monthlyOnDay: ["dayOfMonth"],
  everyNMonths: ["interval", "dayOfMonth"],
};

/**
 * One sentence per profile saying what it produces.
 *
 * Each sentence names dates and nothing else. A repeated reminder is not a booking, a send or
 * evidence that anyone was reached, and these descriptions must never suggest otherwise.
 */
export const REPEAT_PROFILE_DESCRIPTIONS: Record<RepeatProfile, string> = {
  none: "The task has the one date you choose and does not repeat.",
  weekly: "The task returns on the same day each week, starting from the first due date.",
  everyNWeeks: "The task returns on the same day every N weeks, counted from the first due date.",
  monthlyOnDay:
    "The task returns each month on the day you choose, using the final day of any month that is shorter.",
  everyNMonths:
    "The task returns every N months on the day you choose, using the final day of any month that is shorter.",
};

export const FIRST_DUE_DATE_LABEL = "First due date";

/** Stated beside the field, because the date the series counts from is the worker's choice. */
export const FIRST_DUE_DATE_HINT =
  "A first due date is required. It is a calendar date, so it stays that date wherever you are.";

export const PLANNING_TIME_ZONE_LABEL = "Planning timezone";

/**
 * Why the zone is asked for at all: a due date and the day a series is judged against are civil
 * dates in the series' own zone, so a display change cannot move them.
 */
export const PLANNING_TIME_ZONE_NOTE =
  "The series is planned in the timezone you choose here, so changing your device or display timezone does not move any of its dates.";

export const INTERVAL_LABEL = "Repeat every";

/** The unit words for the interval, read after the interval number and its label. */
export const INTERVAL_UNIT_LABELS: Record<"weeks" | "months", string> = {
  weeks: "weeks",
  months: "months",
};

export const DAY_OF_MONTH_LABEL = "Day of the month";

/**
 * The rule the monthly profiles follow when the chosen day does not exist in a month, stated
 * exactly as the specification fixes it.
 */
export const MISSING_MONTHLY_DAY_DISCLOSURE =
  "For missing monthly dates, use and disclose the final day of that month.";

/**
 * The same resolution said to the worker about one date.
 *
 * The consumer substitutes the chosen day for `{day}` and the month's name for `{month}`, so this
 * module formats nothing and the sentence still reads correctly in any month. It appears beside the
 * date the plan actually produced, which is what makes the resolution disclosed rather than silent.
 */
export const LAST_DAY_OF_MONTH_RESOLUTION_TEMPLATE =
  "Day {day} does not exist in {month}, so the final day of that month is used, and that resolution is disclosed with the date.";

/**
 * The three ways a series can end, keyed by the domain module's own end kinds.
 *
 * The third is a policy the worker switched on rather than an absent end, which is why it is
 * named as a choice rather than as "no end".
 */
export const END_CONDITION_LABELS: Record<SeriesEnd["kind"], string> = {
  "on-date": "End on a date",
  "after-count": "End after a number of occurrences",
  "ongoing-personal-policy": "Continue until I stop the series",
};

export const END_DATE_LABEL = "End date";

export const END_COUNT_LABEL = "Number of occurrences";

export const ONGOING_POLICY_LABEL = "Allow a series to continue until I stop it";

/**
 * Why the third end condition is conditional: it exists only where the qualified
 * ongoing-personal-series policy applies, and without it an end date or a count is required
 * because a missing end is not permission to keep scheduling.
 */
export const ONGOING_POLICY_NOTE =
  "This choice appears only when the ongoing personal series policy applies to you. Otherwise a series needs an end date or a number of occurrences, because a missing end is not permission to keep planning it.";

export const NEXT_DATES_PREVIEW_HEADING = "Next three dates";

/**
 * What a preview is: the dates the rule would produce, all but the next one shown for orientation.
 * Only one occurrence of a series is ever actionable, so these dates change nothing until they
 * arrive.
 */
export const SINGLE_ACTIONABLE_OCCURRENCE_NOTE =
  "Only one date is actionable at a time. The other dates are previews of what the rule produces, and nothing happens on them until they become the next date.";

/**
 * The closed message set the series schema and the series editor reuse instead of writing their
 * own.
 *
 * Each key names the field path the rule validation reports, so a form can place the message beside
 * the control that produced it: `firstDueOn`, `planningTimeZone`, `interval`, `dayOfMonth` and
 * `end`. The domain validator carries its own messages for the same fields; these are the form's,
 * stating the same requirement in the worker's terms.
 */
export const SERIES_FIELD_MESSAGES = {
  firstDueDateRequired: "Choose the first due date this series counts from.",
  planningTimeZoneRequired: "Choose the planning timezone this series is planned in.",
  intervalRequired: "Choose a whole number of at least 1 for how often this series repeats.",
  dayOfMonthRequired: "Choose the day of the month, from 1 to 31.",
  endRequired:
    "Choose an end date or a number of occurrences, or turn on the ongoing personal series policy.",
} as const;
