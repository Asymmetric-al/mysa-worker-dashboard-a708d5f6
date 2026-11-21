/**
 * The closed repeat rule behind recurring tasks: five profiles, one monthly day resolver, one
 * successor admission — all computed in civil dates inside the series' own planning time zone.
 *
 * Nothing here reads a clock, and nothing here schedules: an occurrence is admitted when a read or
 * a command asks for it, so a series is evaluated at the moment it matters rather than by a timer.
 * A due date stays a civil date from end to end — a display-zone change, a traveller's shift or a
 * timezone-database update never rebases a series — which is why `now` arrives as a parameter and
 * `clock.ts` is never imported.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Time modules" row, which fixes the exported names `nextOccurrences()` and
 *   `monthlyOnDay()`, and the AAP 0.9.1 / 0.11.1 rows for
 *   `modules/time/{clock,civil,window,recurrence}.ts`.
 * - AAP 0.8.2 (work, interactions and recurrence): the closed five-profile set; a first due
 *   date and a planning time zone are required; an end date or count is required unless the
 *   qualified ongoing-personal-series policy is on; "A missing monthly day resolves to the final
 *   day of that month and the resolution is disclosed"; "Only one occurrence is actionable;
 *   future dates are previews; complete or skip admits at most one successor"; "Several missed
 *   dates produce Plan needs review with Keep this occurrence, Move the next date forward and
 *   Stop series — never an overdue stack and never a fabricated conversation"; and
 *   "This-occurrence and this-and-future edits are prospective: this-and-future creates a rule
 *   revision with an explicit effective boundary and leaves completed history intact; pause
 *   stops future admission; stop explains the fate of unfinished work; a stale action cannot
 *   undo a later Stop."
 * - AAP 0.8.7 fixed values: "Monthly recurrence on a missing day → Final day of that month" and
 *   "Recurring successors → At most one per completed or skipped occurrence — a second
 *   completion or a stale action yields `unchanged` or `conflict`, never a second successor".
 * - AAP 0.6.2 `TaskSeries`, whose fields these types mirror, and criterion 13, whose domain test is
 *   `tests/domain/recurrence.test.ts`.
 *
 * The repeat rule is closed, and only one occurrence is ever actionable.
 *
 * Layering: a framework-free domain module, importable from either side of the data service. It
 * imports only the default `temporal-polyfill` entrypoint and the sibling `civil.ts`; it reads no
 * clock, no store, no file and no environment, holds no state and produces no display text.
 */
import { Temporal } from "temporal-polyfill";

import { todayInZone, type CivilDate } from "./civil";

/**
 * The closed profile set: does not repeat, weekly, every N weeks, monthly on day N, every N months.
 *
 * A closed set is the point of the rule: an unknown profile is refused by `validateSeriesRule`
 * rather than coerced to a default, so nothing can repeat more often than its author asked. The list
 * is also the set's one runtime form, so a stored series rule derives its schema from this
 * declaration instead of restating the profiles.
 */
export const REPEAT_PROFILES = [
  "none",
  "weekly",
  "everyNWeeks",
  "monthlyOnDay",
  "everyNMonths",
] as const;

/** One repeat profile, derived from {@link REPEAT_PROFILES}. */
export type RepeatProfile = (typeof REPEAT_PROFILES)[number];

/**
 * How a series ends: on a date, after a number of occurrences, or — only under the qualified
 * ongoing-personal-series policy — not at all.
 *
 * The three kinds are the whole contract. An end date is inclusive, a count counts occurrences from
 * the first due date, and "ongoing" is a policy the worker switched on rather than a missing value,
 * which is why it has its own kind instead of an absent end.
 */
export type SeriesEnd =
  | { kind: "on-date"; on: CivilDate }
  | { kind: "after-count"; count: number }
  | { kind: "ongoing-personal-policy" };

/**
 * One effective repeat rule.
 *
 * `interval` is read only by `everyNWeeks` and `everyNMonths`; `dayOfMonth` only by `monthlyOnDay`
 * and `everyNMonths`. `firstDueOn` is the date the worker chose for the first occurrence — it
 * is never recomputed from the rule — and `planningTimeZone` is the series' own zone, so the
 * dates this rule produces are the same dates whatever zone the reader's screen is set to.
 */
export type SeriesRule = {
  profile: RepeatProfile;
  interval: number;
  dayOfMonth?: number;
  firstDueOn: CivilDate;
  planningTimeZone: string;
  end: SeriesEnd;
};

/**
 * Where a series stands: admitting new occurrences, paused from admitting them, or stopped.
 *
 * Paused and stopped are different states, not two names for one: a pause can be resumed and leaves
 * the plan intact, while a stop closes the series and explains the fate of its unfinished work.
 */
export const SERIES_STATES = ["active", "paused", "stopped"] as const;

/** One series state, derived from {@link SERIES_STATES}. */
export type SeriesState = (typeof SERIES_STATES)[number];

/** The closed set as a lookup, so an unrecognised profile can never be coerced to a default. */
const KNOWN_PROFILES: ReadonlySet<string> = new Set<string>(REPEAT_PROFILES);

/**
 * The next-three-date preview is the default because it is the one the series editor shows: three
 * dates are enough to see the shape of a repeat and few enough to read on a phone.
 */
const DEFAULT_PREVIEW_COUNT = 3;

/** A preview of nothing is not a preview, and a preview longer than a screen is not a preview. */
const MIN_PREVIEW_COUNT = 1;
const MAX_PREVIEW_COUNT = 12;

/**
 * A ceiling on how far the occurrence walk will step while looking for dates after a given date.
 *
 * The closed profiles make a legitimate span short — 20,000 periods is 384 years of weekly dates
 * and more than 1,600 years of monthly ones — so hitting the ceiling means the rule is malformed
 * or the date asked about is absurd, and the walk refuses rather than spinning. It guards against
 * a malformed rule, not a scale limit: no retained workflow walks anywhere near it.
 */
const ITERATION_CEILING = 20_000;

/**
 * A civil date is stored as `YYYY-MM-DD`, so a year outside four digits has no stored form and is
 * refused rather than written in a shape nothing else in the application reads.
 */
const MIN_STORED_YEAR = 1;
const MAX_STORED_YEAR = 9999;

/**
 * How many missed due dates turn a plan into a review.
 *
 * One late date is lateness; several are a signal that the plan itself needs attention, so at the
 * threshold the answer changes shape instead of growing. The threshold is named here because it is
 * the only place the count is decided.
 */
const MISSED_DATES_REVIEW_THRESHOLD = 3;

/** The stored shape of a civil date. This recognises a value's form; it never parses a string. */
const STORED_DATE_FORM = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Whether a value really is a civil date.
 *
 * The `instanceof` test covers the polyfill this module imports. The stored-shape test covers a
 * `PlainDate` built by another copy of it, which a class check would reject even though the value
 * is a date; and because a string is not an object, it never lets a raw `"2026-01-31"` pass.
 * `civil.ts` remains the one place a stored date string is parsed.
 */
function isCivilDate(value: unknown): value is CivilDate {
  if (value instanceof Temporal.PlainDate) {
    return true;
  }
  return typeof value === "object" && value !== null && STORED_DATE_FORM.test(String(value));
}

/**
 * Whether an identifier names a zone this calendar can resolve.
 *
 * The check is Temporal's own: a zone it cannot resolve is exactly the zone every date operation
 * would refuse, so a separate allow-list could only drift from the truth. An empty or non-string
 * value is refused rather than handed to the calendar.
 */
function isKnownTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || timeZone.length === 0) {
    return false;
  }
  try {
    Temporal.ZonedDateTime.from({ timeZone, year: 2000, month: 1, day: 1 });
    return true;
  } catch {
    return false;
  }
}

/** Whether a profile resolves a day of the month: the two monthly profiles, and only those. */
function takesDayOfMonth(profile: RepeatProfile): boolean {
  return profile === "monthlyOnDay" || profile === "everyNMonths";
}

/** Whether a profile repeats at an interval: the two "every N" profiles, and only those. */
function takesInterval(profile: RepeatProfile): boolean {
  return profile === "everyNWeeks" || profile === "everyNMonths";
}

/** The outcome of resolving one day of one month to a date that exists. */
export type MonthDayResolution =
  | {
      status: "resolved";
      date: CivilDate;
      requestedDay: number;
      resolvedDay: number;
      lastDayOfMonthResolved: boolean;
    }
  | { status: "refused"; reason: "invalid-month" | "invalid-day" };

/**
 * Resolves a day of a month to a date that exists, disclosing any resolution it had to make.
 *
 * A day past the end of its month resolves to that month's final day and sets
 * `lastDayOfMonthResolved`, which is what lets the caller say so instead of silently moving a
 * worker's date: day 31 in February 2026 resolves to 2026-02-28, day 31 in February 2028 to
 * 2028-02-29 because 2028 is a leap year, day 31 in April to 2026-04-30, and day 31 in January 2026
 * to 2026-01-31 with `lastDayOfMonthResolved` false because nothing needed resolving.
 *
 * `month` is the ISO month, 1-12. A month outside that range and a year that cannot be stored as
 * four digits are refused with the month's reason, because the pair is the unit this resolver
 * takes; a day outside 1-31 takes the day's. None is clamped: a value the caller did not intend is
 * a defect to report, not a date to invent.
 */
export function monthlyOnDay(year: number, month: number, day: number): MonthDayResolution {
  if (!Number.isInteger(year) || year < MIN_STORED_YEAR || year > MAX_STORED_YEAR) {
    return { status: "refused", reason: "invalid-month" };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { status: "refused", reason: "invalid-month" };
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return { status: "refused", reason: "invalid-day" };
  }

  const monthOfYear = new Temporal.PlainYearMonth(year, month);
  const resolvedDay = Math.min(day, monthOfYear.daysInMonth);
  return {
    status: "resolved",
    date: monthOfYear.toPlainDate({ day: resolvedDay }),
    requestedDay: day,
    resolvedDay,
    lastDayOfMonthResolved: resolvedDay !== day,
  };
}

/** The outcome of checking a rule before it is stored, previewed or revised. */
export type SeriesRuleValidation =
  | { status: "valid" }
  | { status: "invalid"; fields: Record<string, string> };

/** The message for a rule whose profile is not one of the five, shared by every refusal of it. */
const PROFILE_REQUIRED_MESSAGE =
  "Choose a repeat profile: none, weekly, every N weeks, monthly on a day, every N months.";

/** The message for a rule with no end: the qualified ongoing policy is a policy, not a default. */
const END_REQUIRED_MESSAGE =
  "Choose an end date or a number of occurrences, or turn on the ongoing series policy.";

/**
 * The message for a rule's end, or `undefined` when the end is one this product admits.
 *
 * An end date is inclusive and must not precede the first due date; a count is a whole number of at
 * least one; the ongoing personal-series policy is admitted because it is a qualified policy the
 * worker switched on rather than a missing value.
 */
function endFieldMessage(rule: SeriesRule): string | undefined {
  const end: SeriesEnd | undefined = rule.end;
  if (end === undefined) {
    return END_REQUIRED_MESSAGE;
  }

  switch (end.kind) {
    case "on-date":
      if (!isCivilDate(end.on)) {
        return "Choose the end date.";
      }
      if (isCivilDate(rule.firstDueOn) && Temporal.PlainDate.compare(end.on, rule.firstDueOn) < 0) {
        return "Choose an end date on or after the first due date.";
      }
      return undefined;
    case "after-count":
      return Number.isInteger(end.count) && end.count >= 1
        ? undefined
        : "Choose how many occurrences, as a whole number of at least 1.";
    case "ongoing-personal-policy":
      return undefined;
    default:
      // An end kind outside the closed set is not an end this product admits, whatever it claims.
      return END_REQUIRED_MESSAGE;
  }
}

/** The message for a rule's interval, or `undefined` when the chosen profile does not read one. */
function intervalFieldMessage(
  profile: RepeatProfile | undefined,
  interval: number,
): string | undefined {
  if (profile === undefined || !takesInterval(profile)) {
    return undefined;
  }
  if (Number.isInteger(interval) && interval >= 1) {
    return undefined;
  }
  return profile === "everyNWeeks"
    ? "Choose how many weeks between occurrences, as a whole number of at least 1."
    : "Choose how many months between occurrences, as a whole number of at least 1.";
}

/**
 * The message for a rule's day of the month, or `undefined` when the day it carries is admissible.
 *
 * A monthly profile must carry one from 1 to 31, and every other profile must carry none: a
 * day left behind by a profile change is a contradiction to report, not a value to ignore.
 */
function dayOfMonthFieldMessage(
  profile: RepeatProfile | undefined,
  dayOfMonth: number | undefined,
): string | undefined {
  if (profile === undefined) {
    return undefined;
  }
  if (!takesDayOfMonth(profile)) {
    return dayOfMonth === undefined
      ? undefined
      : "A day of the month applies only to the monthly repeat profiles.";
  }
  if (dayOfMonth === undefined) {
    return "Choose the day of the month, from 1 to 31.";
  }
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return "Choose a day of the month from 1 to 31.";
  }
  return undefined;
}

/**
 * Checks a rule against the closed profile set and the fields the chosen profile reads, returning
 * one readable message per field path.
 *
 * The end rule is the qualified one: an end date or a count is required unless the ongoing
 * personal-series policy is on, because a missing end is not permission. An unknown profile, a zone
 * the calendar cannot resolve, an interval below one on an "every N" profile and a day of the month
 * outside 1-31 are each refused with the field they belong to, so the editor can place the message
 * beside the control that produced it.
 */
export function validateSeriesRule(rule: SeriesRule): SeriesRuleValidation {
  const fields: Record<string, string> = {};
  const profile = KNOWN_PROFILES.has(rule.profile) ? rule.profile : undefined;

  if (profile === undefined) {
    fields.profile = PROFILE_REQUIRED_MESSAGE;
  }
  if (!isCivilDate(rule.firstDueOn)) {
    fields.firstDueOn = "Choose the first due date.";
  }
  if (!isKnownTimeZone(rule.planningTimeZone)) {
    fields.planningTimeZone = "Choose a planning time zone this calendar recognizes.";
  }

  const end = endFieldMessage(rule);
  if (end !== undefined) {
    fields.end = end;
  }
  const interval = intervalFieldMessage(profile, rule.interval);
  if (interval !== undefined) {
    fields.interval = interval;
  }
  const dayOfMonth = dayOfMonthFieldMessage(profile, rule.dayOfMonth);
  if (dayOfMonth !== undefined) {
    fields.dayOfMonth = dayOfMonth;
  }

  return Object.keys(fields).length === 0 ? { status: "valid" } : { status: "invalid", fields };
}

/** One date the walk produced, with the resolution the preview must disclose when there was one. */
type WalkedOccurrence = { dueOn: CivilDate; resolution?: DisclosedMonthDayResolution };

/** Either the dates the walk found, or the ceiling it reached before finding them. */
type OccurrenceWalk =
  | { status: "walked"; occurrences: WalkedOccurrence[] }
  | { status: "ceiling-reached" };

/**
 * The first occurrence of a series: the first due date the worker chose, never a date the rule
 * recomputes.
 *
 * A monthly rule can still disclose here. When the chosen first due date is its month's final day
 * and the rule asks for a later day of that month, that date is itself a resolution the worker has
 * not been told about, so it is disclosed exactly as `monthlyOnDay` discloses one.
 */
function firstOccurrenceOf(rule: SeriesRule): WalkedOccurrence {
  const day = rule.dayOfMonth;
  if (day === undefined || !takesDayOfMonth(rule.profile)) {
    return { dueOn: rule.firstDueOn };
  }

  const monthOfFirst = rule.firstDueOn.toPlainYearMonth();
  const isFinalDayOfMonth = rule.firstDueOn.day === monthOfFirst.daysInMonth;
  if (!isFinalDayOfMonth || day <= monthOfFirst.daysInMonth) {
    return { dueOn: rule.firstDueOn };
  }

  return {
    dueOn: rule.firstDueOn,
    resolution: {
      dueOn: rule.firstDueOn,
      requestedDay: day,
      resolvedDay: rule.firstDueOn.day,
    },
  };
}

/**
 * The occurrence `monthsAfterFirst` months after the first due date's month, on the rule's day.
 *
 * The arithmetic is on the year-month rather than on the date. Adding a month to 31 January clamps
 * it to 28 February, and a walk that kept stepping from the clamped date would stay on the 28th for
 * ever; resolving the day separately in each month keeps every later month on the day the worker
 * asked for, and discloses only the months where that day does not exist.
 */
function monthlyStepOf(rule: SeriesRule, monthsAfterFirst: number): WalkedOccurrence | undefined {
  const day = rule.dayOfMonth;
  if (day === undefined) {
    return undefined;
  }

  const monthOfYear = rule.firstDueOn.toPlainYearMonth().add({ months: monthsAfterFirst });
  const resolved = monthlyOnDay(monthOfYear.year, monthOfYear.month, day);
  if (resolved.status === "refused") {
    return undefined;
  }
  if (!resolved.lastDayOfMonthResolved) {
    return { dueOn: resolved.date };
  }

  return {
    dueOn: resolved.date,
    resolution: {
      dueOn: resolved.date,
      requestedDay: resolved.requestedDay,
      resolvedDay: resolved.resolvedDay,
    },
  };
}

/**
 * The date `step` occurrences after the series' start, where step 0 is the first due date.
 *
 * `undefined` means the rule's plan has no such occurrence: a series that does not repeat has
 * exactly one, and a monthly rule whose day cannot be resolved stops rather than guessing.
 */
function occurrenceAtStep(rule: SeriesRule, step: number): WalkedOccurrence | undefined {
  if (step === 0) {
    return firstOccurrenceOf(rule);
  }

  switch (rule.profile) {
    case "none":
      return undefined;
    case "weekly":
      return { dueOn: rule.firstDueOn.add({ weeks: step }) };
    case "everyNWeeks":
      return { dueOn: rule.firstDueOn.add({ weeks: step * rule.interval }) };
    case "monthlyOnDay":
      return monthlyStepOf(rule, step);
    case "everyNMonths":
      return monthlyStepOf(rule, step * rule.interval);
  }
}

/** Whether an occurrence is past the end: an end date is inclusive, a count is an ordinal. */
function pastEndOfSeries(end: SeriesEnd, dueOn: CivilDate, ordinal: number): boolean {
  switch (end.kind) {
    case "on-date":
      return Temporal.PlainDate.compare(dueOn, end.on) > 0;
    case "after-count":
      return ordinal > end.count;
    case "ongoing-personal-policy":
      return false;
  }
}

/**
 * Walks the rule's occurrences and collects the first `wanted` that fall strictly after `from`.
 *
 * The walk always begins at the first due date, because a count-limited end is an ordinal counted
 * from the start of the series and skipping ahead would miscount it. Dates at or before `from` are
 * walked over, not collected: a later date is a preview, and only one occurrence is actionable.
 */
function occurrencesAfter(rule: SeriesRule, from: CivilDate, wanted: number): OccurrenceWalk {
  const collected: WalkedOccurrence[] = [];
  for (let step = 0; step < ITERATION_CEILING; step += 1) {
    const occurrence = occurrenceAtStep(rule, step);
    if (occurrence === undefined) {
      return { status: "walked", occurrences: collected };
    }
    if (pastEndOfSeries(rule.end, occurrence.dueOn, step + 1)) {
      return { status: "walked", occurrences: collected };
    }
    if (Temporal.PlainDate.compare(occurrence.dueOn, from) > 0) {
      collected.push(occurrence);
      if (collected.length === wanted) {
        return { status: "walked", occurrences: collected };
      }
    }
  }
  return { status: "ceiling-reached" };
}

/** The preview count a caller asked for, kept inside the 1-12 dates a preview can show. */
function previewCountOf(count: number): number {
  if (!Number.isFinite(count)) {
    return DEFAULT_PREVIEW_COUNT;
  }
  return Math.min(MAX_PREVIEW_COUNT, Math.max(MIN_PREVIEW_COUNT, Math.trunc(count)));
}

/**
 * A month-day resolution the preview must disclose, because the date the plan will use is not the
 * day the rule asked for.
 */
export type DisclosedMonthDayResolution = {
  dueOn: CivilDate;
  requestedDay: number;
  resolvedDay: number;
};

/** The outcome of asking a rule for its next due dates. */
export type OccurrencePreview =
  | { status: "preview"; dates: CivilDate[]; monthDayResolutions: DisclosedMonthDayResolution[] }
  | { status: "refused"; reason: "invalid-rule" | "end-reached" | "unbounded" };

/**
 * The next due dates strictly after `from` — three by default, clamped to 1-12 — as a preview.
 *
 * A preview is not a set of occurrences: the dates are what the rule would produce, and only one
 * occurrence of a series is ever actionable. An end date and an occurrence count are hard limits,
 * so a rule with two occurrences left yields two dates and then `end-reached`.
 * `monthDayResolutions` lists the dates whose day had to be resolved to that month's final day, so
 * the editor can say so rather than moving a worker's dates silently.
 *
 * A rule that fails `validateSeriesRule` is `invalid-rule`, and a span too long to walk is
 * `unbounded` rather than a partial answer presented as complete.
 */
export function nextOccurrences(
  rule: SeriesRule,
  from: CivilDate,
  count: number = DEFAULT_PREVIEW_COUNT,
): OccurrencePreview {
  const validation = validateSeriesRule(rule);
  if (validation.status === "invalid") {
    return { status: "refused", reason: "invalid-rule" };
  }

  const walk = occurrencesAfter(rule, from, previewCountOf(count));
  if (walk.status === "ceiling-reached") {
    return { status: "refused", reason: "unbounded" };
  }
  if (walk.occurrences.length === 0) {
    return { status: "refused", reason: "end-reached" };
  }

  return {
    status: "preview",
    dates: walk.occurrences.map((occurrence) => occurrence.dueOn),
    monthDayResolutions: walk.occurrences.flatMap((occurrence) =>
      occurrence.resolution === undefined ? [] : [occurrence.resolution],
    ),
  };
}

/** What admitting a successor needs to know about the occurrence being completed or skipped. */
export type SuccessorRequest = {
  rule: SeriesRule;
  occurrence: CivilDate;
  /** The successor this occurrence already has, when the caller knows of one. */
  existingSuccessorDueOn?: CivilDate;
  /**
   * The series' state, so a paused or stopped series refuses without the caller checking first.
   * Absent means active: a series is admitting occurrences until something says otherwise.
   */
  state?: SeriesState;
};

/** The outcome of admitting a successor for a completed or skipped occurrence. */
export type SuccessorAdmission =
  | { status: "admitted"; nextDueOn: CivilDate }
  | {
      status: "refused";
      reason: "successor-already-admitted" | "series-ended" | "series-stopped" | "series-paused";
    };

/**
 * Admits one successor for a completed or skipped occurrence, and never more than one.
 *
 * This is the guard the rule requires: a second attempt for the same occurrence — one that knows
 * a successor already exists — is refused rather than cascading into a second date, so a replay,
 * a double submit or a stale action can never double a series. The caller maps that refusal to
 * `unchanged` or `conflict`; nothing here creates the task, sends anything or records an
 * interaction, because completing or skipping a recurring reminder proves nothing about contact,
 * payment or fulfilment.
 *
 * A paused series admits nothing while it is paused and a stopped series admits nothing ever, so an
 * action composed before a pause or a Stop fails here without the caller having to know. Pause has
 * its own reason rather than borrowing the Stop's: the two are different states a worker chooses
 * between, and resuming a paused series is possible where reviving a stopped one is not.
 *
 * A rule that fails `validateSeriesRule` is a caller defect — every stored rule was validated
 * before it was saved — so it throws a `RangeError` rather than inventing a refusal that would
 * hide the defect. No user input reaches that path.
 */
export function admitSuccessor(request: SuccessorRequest): SuccessorAdmission {
  const state = request.state ?? "active";
  if (state === "stopped") {
    return { status: "refused", reason: "series-stopped" };
  }
  if (state === "paused") {
    return { status: "refused", reason: "series-paused" };
  }
  if (request.existingSuccessorDueOn !== undefined) {
    return { status: "refused", reason: "successor-already-admitted" };
  }

  const preview = nextOccurrences(request.rule, request.occurrence, 1);
  if (preview.status === "refused") {
    if (preview.reason === "end-reached") {
      return { status: "refused", reason: "series-ended" };
    }
    throw new RangeError(
      preview.reason === "invalid-rule"
        ? "A successor needs a rule that passes validateSeriesRule"
        : "A successor cannot be read: this occurrence lies beyond the rule's readable span",
    );
  }

  const [nextDueOn] = preview.dates;
  if (nextDueOn === undefined) {
    return { status: "refused", reason: "series-ended" };
  }
  return { status: "admitted", nextDueOn };
}

/** What asking whether a series admits an occurrence at a date needs to know. */
export type SeriesAdmissionQuestion = { state: SeriesState; at: CivilDate };

/** The outcome of asking a series whether it admits an occurrence. */
export type SeriesAdmission =
  | { status: "admits"; evaluatedOn: CivilDate }
  | { status: "refused"; reason: "paused" | "stopped" };

/**
 * Whether the series admits an occurrence at `at`, evaluated at read or command time.
 *
 * Pause stops future admission without ending the series; a Stop closes it for good, so a stopped
 * series refuses every later action including one composed before the Stop. The date the question
 * was asked for is returned with an admitting answer, so the caller records the date admission was
 * decided on rather than letting a timer imply one.
 */
export function seriesAdmitsAt(question: SeriesAdmissionQuestion): SeriesAdmission {
  if (question.state === "stopped") {
    return { status: "refused", reason: "stopped" };
  }
  if (question.state === "paused") {
    return { status: "refused", reason: "paused" };
  }
  return { status: "admits", evaluatedOn: question.at };
}

/** The states an occurrence can hold while its series' plan is judged. */
export type SeriesOccurrenceState = "open" | "completed" | "reopened" | "skipped" | "cancelled";

/** One occurrence of a series, as the plan review reads it. */
export type SeriesOccurrence = { dueOn: CivilDate; status: SeriesOccurrenceState };

/** The three resolutions a plan in review offers, and no other: keep, move forward, or stop. */
export type PlanResolutions = readonly [
  "keep-this-occurrence",
  "move-next-date-forward",
  "stop-series",
];

/** The outcome of reviewing a series' plan against its due dates. */
export type PlanReview =
  | { state: "on-track" }
  | { state: "planNeedsReview"; missedDates: CivilDate[]; resolutions: PlanResolutions };

/** What reviewing a plan needs: the rule's zone, its occurrences, and the scenario instant. */
export type MissedPlanQuestion = {
  rule: SeriesRule;
  occurrences: readonly SeriesOccurrence[];
  now: Temporal.Instant;
};

/** The resolutions a plan in review offers, declared once so the type and the value agree. */
const PLAN_RESOLUTIONS: PlanResolutions = [
  "keep-this-occurrence",
  "move-next-date-forward",
  "stop-series",
];

/** Whether an occurrence still expects an action, which is what makes a past date missed. */
function isAwaitingAction(status: SeriesOccurrenceState): boolean {
  return status === "open" || status === "reopened";
}

/**
 * Reviews a series' plan against "today" in the series' own planning zone.
 *
 * Three or more due dates that are past and still awaiting an action produce `planNeedsReview`
 * with those dates and exactly the three resolutions — Keep this occurrence, Move the next date
 * forward, Stop series — instead of an overdue stack, and the review never claims a conversation
 * happened. Fewer than three is `on-track`: one late date is lateness, not a plan that needs
 * rethinking.
 *
 * "Today" comes from the planning zone and the `now` argument the caller supplies, never from the
 * machine clock. A series whose zone cannot be resolved claims no missed date at all rather than
 * judging dates against a clock the worker never chose; the rule editor refuses that zone before a
 * series can be saved with it.
 */
export function missedPlan(question: MissedPlanQuestion): PlanReview {
  const today = todayInZone(question.rule.planningTimeZone, question.now);
  if (today.status === "refused") {
    return { state: "on-track" };
  }

  const missedDates = question.occurrences
    .filter((occurrence) => isAwaitingAction(occurrence.status))
    .map((occurrence) => occurrence.dueOn)
    .filter((dueOn) => Temporal.PlainDate.compare(dueOn, today.date) < 0)
    .toSorted(Temporal.PlainDate.compare);

  if (missedDates.length < MISSED_DATES_REVIEW_THRESHOLD) {
    return { state: "on-track" };
  }
  return { state: "planNeedsReview", missedDates, resolutions: PLAN_RESOLUTIONS };
}

/** The fields a this-and-future edit may set: every rule field except the first due date. */
export type SeriesRulePatch = Partial<Omit<SeriesRule, "firstDueOn">>;

/** One effective rule and the date it takes effect from. */
export type RuleRevision = { effectiveFrom: CivilDate; rule: SeriesRule };

/** What a this-and-future edit needs to know about the series it revises. */
export type ThisAndFutureEdit = {
  /** Every effective revision, oldest first; the newest is the rule the patch merges into. */
  revisions: readonly RuleRevision[];
  /** The date the new revision takes effect from, which must be prospective. */
  from: CivilDate;
  patch: SeriesRulePatch;
  /** The last occurrence already completed, which the boundary must fall after when known. */
  lastCompletedOn?: CivilDate;
  /** When the series was stopped, which makes a later edit stale rather than prospective. */
  stoppedOn?: CivilDate;
};

/** The outcome of a this-and-future edit. */
export type RuleRevisionResult =
  | { status: "revisioned"; revision: RuleRevision }
  | { status: "refused"; reason: "not-prospective" | "stale" };

/**
 * Merges a patch into a copy of the latest rule, dropping a day of the month the patched profile no
 * longer reads so a profile change cannot leave a contradictory rule behind.
 *
 * The first due date is never taken from the patch: it anchors the series, and a revision changes
 * the plan forward from its boundary rather than re-basing what already happened.
 */
function applyPatch(base: SeriesRule, patch: SeriesRulePatch): SeriesRule {
  const profile = patch.profile ?? base.profile;
  const rule: SeriesRule = {
    profile,
    interval: patch.interval ?? base.interval,
    firstDueOn: base.firstDueOn,
    planningTimeZone: patch.planningTimeZone ?? base.planningTimeZone,
    end: patch.end ?? base.end,
  };
  const dayOfMonth = takesDayOfMonth(profile) ? (patch.dayOfMonth ?? base.dayOfMonth) : undefined;
  if (dayOfMonth !== undefined) {
    rule.dayOfMonth = dayOfMonth;
  }
  return rule;
}

/**
 * Creates a prospective rule revision for a this-and-future edit, leaving completed history alone.
 *
 * The revision carries an explicit effective boundary (`from`) and the merged rule, and every
 * earlier revision is returned untouched: a this-and-future edit changes the plan forward from the
 * boundary and never rewrites what happened. `from` must fall after the last completed occurrence
 * and no earlier than the latest revision's boundary, or the edit would rewrite history and is
 * refused as `not-prospective`. A series with no revision yet has no plan to revise and is refused
 * the same way.
 *
 * A Stop that landed after the caller read the series makes the edit `stale`: a stale action cannot
 * undo a later Stop, and a stopped series takes no further revision. That check comes first, so a
 * stale edit is never reported as a boundary problem the worker could fix.
 *
 * The merged rule is returned for the caller to validate with `validateSeriesRule` before saving,
 * exactly as every other rule path does: this function judges the boundary, not the fields.
 */
export function applyThisAndFuture(edit: ThisAndFutureEdit): RuleRevisionResult {
  if (edit.stoppedOn !== undefined) {
    return { status: "refused", reason: "stale" };
  }

  const latest = edit.revisions.at(-1);
  if (latest === undefined) {
    return { status: "refused", reason: "not-prospective" };
  }

  if (
    edit.lastCompletedOn !== undefined &&
    Temporal.PlainDate.compare(edit.from, edit.lastCompletedOn) <= 0
  ) {
    return { status: "refused", reason: "not-prospective" };
  }

  if (Temporal.PlainDate.compare(edit.from, latest.effectiveFrom) < 0) {
    return { status: "refused", reason: "not-prospective" };
  }

  return {
    status: "revisioned",
    revision: { effectiveFrom: edit.from, rule: applyPatch(latest.rule, edit.patch) },
  };
}
