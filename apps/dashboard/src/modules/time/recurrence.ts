/**
 * The closed repeat rule behind recurring tasks: five profiles, one monthly day resolver, one
 * successor admission — all computed in civil dates inside the series' own planning time zone.
 */
import { Temporal } from "temporal-polyfill";
import { todayInZone, type CivilDate } from "./civil";
/** The closed profile set: does not repeat, weekly, every N weeks, monthly on day N, every N months. */
export const REPEAT_PROFILES = ["none", "weekly", "everyNWeeks", "monthlyOnDay", "everyNMonths"] as const;
/** One repeat profile, derived from {@link REPEAT_PROFILES}. */
export type RepeatProfile = (typeof REPEAT_PROFILES)[number];
/** How a series ends: on a date, after a number of occurrences, or — only under the qualified ongoing-personal-series policy — not at all. */
export type SeriesEnd = { kind: "on-date"; on: CivilDate } | { kind: "after-count"; count: number } | { kind: "ongoing-personal-policy" };
/** One effective repeat rule. */
export type SeriesRule = {
  profile: RepeatProfile;
  interval: number;
  dayOfMonth?: number;
  firstDueOn: CivilDate;
  planningTimeZone: string;
  end: SeriesEnd;
};
/** Where a series stands: admitting new occurrences, paused from admitting them, or stopped. */
export const SERIES_STATES = ["active", "paused", "stopped"] as const;
/** One series state, derived from {@link SERIES_STATES}. */
export type SeriesState = (typeof SERIES_STATES)[number];

const KNOWN_PROFILES: ReadonlySet<string> = new Set<string>(REPEAT_PROFILES);

const DEFAULT_PREVIEW_COUNT = 3;

const MIN_PREVIEW_COUNT = 1;
const MAX_PREVIEW_COUNT = 12;

const ITERATION_CEILING = 20_000;

const MIN_STORED_YEAR = 1;
const MAX_STORED_YEAR = 9999;

const MISSED_DATES_REVIEW_THRESHOLD = 3;

const STORED_DATE_FORM = /^\d{4}-\d{2}-\d{2}$/u;

function isCivilDate(value: unknown): value is CivilDate {
  if (value instanceof Temporal.PlainDate) {
    return true;
  }
  return typeof value === "object" && value !== null && STORED_DATE_FORM.test(String(value));
}
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
function takesDayOfMonth(profile: RepeatProfile): boolean {
  return profile === "monthlyOnDay" || profile === "everyNMonths";
}
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
/** Resolves a day of a month to a date that exists, disclosing any resolution it had to make. */
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
export type SeriesRuleValidation = { status: "valid" } | { status: "invalid"; fields: Record<string, string> };

const PROFILE_REQUIRED_MESSAGE = "Choose a repeat profile: none, weekly, every N weeks, monthly on a day, every N months.";

const END_REQUIRED_MESSAGE = "Choose an end date or a number of occurrences, or turn on the ongoing series policy.";

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
      return Number.isInteger(end.count) && end.count >= 1 ? undefined : "Choose how many occurrences, as a whole number of at least 1.";
    case "ongoing-personal-policy":
      return undefined;
    default:
      // An end kind outside the closed set is not an end this product admits, whatever it claims.
      return END_REQUIRED_MESSAGE;
  }
}
function intervalFieldMessage(profile: RepeatProfile | undefined, interval: number): string | undefined {
  if (profile === undefined || !takesInterval(profile)) {
    return undefined;
  }
  if (Number.isInteger(interval) && interval >= 1) {
    return undefined;
  }
  return profile === "everyNWeeks" ? "Choose how many weeks between occurrences, as a whole number of at least 1." : "Choose how many months between occurrences, as a whole number of at least 1.";
}
function dayOfMonthFieldMessage(profile: RepeatProfile | undefined, dayOfMonth: number | undefined): string | undefined {
  if (profile === undefined) {
    return undefined;
  }
  if (!takesDayOfMonth(profile)) {
    return dayOfMonth === undefined ? undefined : "A day of the month applies only to the monthly repeat profiles.";
  }
  if (dayOfMonth === undefined) {
    return "Choose the day of the month, from 1 to 31.";
  }
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return "Choose a day of the month from 1 to 31.";
  }
  return undefined;
}
/** Checks a rule against the closed profile set and the fields the chosen profile reads, returning one readable message per field path. */
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
type WalkedOccurrence = { dueOn: CivilDate; resolution?: DisclosedMonthDayResolution };

type OccurrenceWalk = { status: "walked"; occurrences: WalkedOccurrence[] } | { status: "ceiling-reached" };

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
function previewCountOf(count: number): number {
  if (!Number.isFinite(count)) {
    return DEFAULT_PREVIEW_COUNT;
  }
  return Math.min(MAX_PREVIEW_COUNT, Math.max(MIN_PREVIEW_COUNT, Math.trunc(count)));
}
/** A month-day resolution the preview must disclose, because the date the plan will use is not the day the rule asked for. */
export type DisclosedMonthDayResolution = {
  dueOn: CivilDate;
  requestedDay: number;
  resolvedDay: number;
};
/** The outcome of asking a rule for its next due dates. */
export type OccurrencePreview =
  | { status: "preview"; dates: CivilDate[]; monthDayResolutions: DisclosedMonthDayResolution[] }
  | { status: "refused"; reason: "invalid-rule" | "end-reached" | "unbounded" };
/** The next due dates strictly after `from` — three by default, clamped to 1-12 — as a preview. */
export function nextOccurrences(rule: SeriesRule, from: CivilDate, count: number = DEFAULT_PREVIEW_COUNT): OccurrencePreview {
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
    monthDayResolutions: walk.occurrences.flatMap((occurrence) => (occurrence.resolution === undefined ? [] : [occurrence.resolution])),
  };
}
/** What admitting a successor needs to know about the occurrence being completed or skipped. */
export type SuccessorRequest = {
  rule: SeriesRule;
  occurrence: CivilDate;
  existingSuccessorDueOn?: CivilDate;
  state?: SeriesState;
};
/** The outcome of admitting a successor for a completed or skipped occurrence. */
export type SuccessorAdmission =
  | { status: "admitted"; nextDueOn: CivilDate }
  | {
      status: "refused";
      reason: "successor-already-admitted" | "series-ended" | "series-stopped" | "series-paused";
    };
/** Admits one successor for a completed or skipped occurrence, and never more than one. */
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
      preview.reason === "invalid-rule" ? "A successor needs a rule that passes validateSeriesRule" : "A successor cannot be read: this occurrence lies beyond the rule's readable span",
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
export type SeriesAdmission = { status: "admits"; evaluatedOn: CivilDate } | { status: "refused"; reason: "paused" | "stopped" };
/** Whether the series admits an occurrence at `at`, evaluated at read or command time. */
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
export type PlanResolutions = readonly ["keep-this-occurrence", "move-next-date-forward", "stop-series"];
/** The outcome of reviewing a series' plan against its due dates. */
export type PlanReview = { state: "on-track" } | { state: "planNeedsReview"; missedDates: CivilDate[]; resolutions: PlanResolutions };
/** What reviewing a plan needs: the rule's zone, its occurrences, and the scenario instant. */
export type MissedPlanQuestion = {
  rule: SeriesRule;
  occurrences: readonly SeriesOccurrence[];
  now: Temporal.Instant;
};
const PLAN_RESOLUTIONS: PlanResolutions = ["keep-this-occurrence", "move-next-date-forward", "stop-series"];

function isAwaitingAction(status: SeriesOccurrenceState): boolean {
  return status === "open" || status === "reopened";
}
/** Reviews a series' plan against "today" in the series' own planning zone. */
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
  revisions: readonly RuleRevision[];
  from: CivilDate;
  patch: SeriesRulePatch;
  lastCompletedOn?: CivilDate;
  stoppedOn?: CivilDate;
};
/** The outcome of a this-and-future edit. */
export type RuleRevisionResult = { status: "revisioned"; revision: RuleRevision } | { status: "refused"; reason: "not-prospective" | "stale" };

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
/** Creates a prospective rule revision for a this-and-future edit, leaving completed history alone. */
export function applyThisAndFuture(edit: ThisAndFutureEdit): RuleRevisionResult {
  if (edit.stoppedOn !== undefined) {
    return { status: "refused", reason: "stale" };
  }
  const latest = edit.revisions.at(-1);
  if (latest === undefined) {
    return { status: "refused", reason: "not-prospective" };
  }
  if (edit.lastCompletedOn !== undefined && Temporal.PlainDate.compare(edit.from, edit.lastCompletedOn) <= 0) {
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
