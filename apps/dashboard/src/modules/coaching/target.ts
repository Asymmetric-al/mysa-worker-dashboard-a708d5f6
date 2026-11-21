/**
 * The coaching target — the one activity counter and the one target-version model of the
 * application.
 *
 * A target names what the worker is tracking (calls made, personal messages, conversations and
 * meetings held), how many, over which period, and since when. Everything here is a pure function of
 * its arguments: no clock read (`now` arrives as a parameter), no store, no I/O and no framework.
 * Counts come only from activity records the caller has already authorised and handed in, are
 * bucketed by the record's own civil occurrence date, and are credited once.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Coaching module" row: `src/modules/coaching/*` with the key interfaces `activeGrant()`,
 *   `admittedModules()`, `measureFor()`, `captureQuestions()` and `safeTaskSummary()`. `measureFor()`
 *   is here; the grant, check-in and task-share halves are the sibling files.
 * - AAP 0.6.2 "Target and check-in" record, target half: `privateLabel`, `measure`, `quantity`,
 *   `period`, `calendarStart`, `homePlacement`, `state` and `versions[]` of
 *   `{revisionId, effectiveFrom, effectiveTo?, quantity, measure, calendarStart}`.
 * - AAP 0.8.4 coaching rules rows 4-5: four canonical measures counted only from actual activity
 *   records, credited once, bucketed by actual occurrence date, over Weekly (default), Monthly or a
 *   one-off Custom period; a change to quantity, measure or calendar start begins a prospective
 *   version, a closed period keeps the version it was measured against, and five calls containing
 *   two conversations remain five and two.
 * - AAP 0.8.7 boundary facts and the calendar-day semantics the periods obey: a weekly or monthly
 *   boundary is a civil date, and a missing monthly day resolves to the final day of that month and
 *   the resolution is disclosed.
 * - AAP 0.9.1 repository tree, the AAP 0.11.1 deliverable row
 *   `modules/coaching/{grant,target,checkin,taskshare}.ts`, and acceptance criterion 16.
 *
 * Leaf-module import rule: the data service and the development runtime import this module, so it may
 * import only downward — the civil-date vocabulary in `time` and the result helpers in `lib` — and never
 * the store, another domain module, a feature, a component or a route. Its single package import is
 * `temporal-polyfill`, which supplies the `Instant` type and the civil-date comparison that
 * `time/civil.ts` exposes no helper for. No activity count, no ratio and no money amount is produced
 * anywhere else.
 */
import { Temporal } from "temporal-polyfill";

import { assertNever, err, ok, type Result } from "../../lib/result";
import { type CivilDate, type DatePrecision, todayInZone } from "../time/civil";

// ---------------------------------------------------------------------------------------------
// The four measures
// ---------------------------------------------------------------------------------------------

/**
 * The four measures a target may count, in the order a surface lists them: calls made, personal
 * messages, conversations and meetings held. Closed on purpose — a fifth measure is a product change,
 * not a configuration value.
 */
export const TARGET_MEASURES = [
  "calls-made",
  "personal-messages",
  "conversations",
  "meetings-held",
] as const;

/** One of the four canonical target measures, derived from {@link TARGET_MEASURES}. */
export type TargetMeasure = (typeof TARGET_MEASURES)[number];

// ---------------------------------------------------------------------------------------------
// What an activity record may credit
// ---------------------------------------------------------------------------------------------

/**
 * Every kind of event a target count may be offered, closed and named: the four that are an actual
 * exchange, and the nine that are not one and therefore credit nothing. The non-crediting kinds are
 * declared rather than merely rejected so that the refusal is a named decision in this table instead
 * of an absence somewhere else.
 */
export const ACTIVITY_EVENT_KINDS = [
  "call",
  "personal-message",
  "conversation",
  "meeting-held",
  "meeting-planned",
  "task-completed",
  "dialer-opened",
  "mail-opened",
  "no-show",
  "broadcast",
  "automated-reply",
  "message-opened",
  "link-clicked",
] as const;

/** One kind of event this counter can be handed, derived from {@link ACTIVITY_EVENT_KINDS}. */
export type ActivityEventKind = (typeof ACTIVITY_EVENT_KINDS)[number];

/**
 * What an event credits: one of the four measures, or `"none"` for an event that is not a record of
 * an actual exchange.
 */
export type ActivityCredit = TargetMeasure | "none";

/** The recorded precisions that name a day: every {@link DatePrecision} except `"unknown"`. */
type PlacedDatePrecision = Exclude<DatePrecision, "unknown">;

/**
 * When an activity actually happened, as the interaction record states it: a civil date with the
 * precision the record carries, or an honest `"unknown"` that names no day at all. A precision of
 * `"unknown"` carries no date field, so a fabricated day cannot be supplied for it.
 */
export type ActivityOccurrence =
  | { readonly precision: PlacedDatePrecision; readonly date: CivilDate }
  | { readonly precision: "unknown" };

/**
 * One activity record offered to the counter: its identity (which is what makes a credit unique), the
 * kind of event it records, and when it happened. The data service maps the persisted interaction
 * record onto this shape; this module never reads persistence.
 */
export interface ActivityEvent {
  readonly activityId: string;
  readonly kind: ActivityEventKind;
  readonly occurrence: ActivityOccurrence;
}

/**
 * What each event kind credits. Keyed by the closed kind set, so a new kind cannot be added without a
 * decision here, and only the four actual exchanges credit anything.
 */
const CREDIT_BY_KIND: Readonly<Record<ActivityEventKind, ActivityCredit>> = {
  call: "calls-made",
  "personal-message": "personal-messages",
  conversation: "conversations",
  "meeting-held": "meetings-held",
  "meeting-planned": "none",
  "task-completed": "none",
  "dialer-opened": "none",
  "mail-opened": "none",
  "no-show": "none",
  broadcast: "none",
  "automated-reply": "none",
  "message-opened": "none",
  "link-clicked": "none",
};

/**
 * The credit an event kind earns: one of the four measures for an actual exchange, `"none"` for a
 * planned meeting, a completed task, an opened application, a no-show, a broadcast, an automated
 * reply, an open or a click. It answers about the kind only; whether the record names a day that falls
 * in the period is decided by {@link measureFor}.
 */
export function classifyActivity(event: ActivityEvent): ActivityCredit {
  return CREDIT_BY_KIND[event.kind];
}

// ---------------------------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------------------------

/**
 * The calendar a target is measured over: weekly (the default), monthly, or a one-off custom range
 * with an explicit first and last day. A custom range never recurs, so it is one period and not a
 * profile.
 */
export type TargetPeriod =
  | { readonly kind: "weekly" }
  | { readonly kind: "monthly" }
  | { readonly kind: "custom"; readonly start: CivilDate; readonly end: CivilDate };

/** Weekly, the default period of a new target. */
export const DEFAULT_TARGET_PERIOD: TargetPeriod = { kind: "weekly" };

/**
 * A target's period together with the civil date its calendar is anchored to: the weekday a weekly
 * period begins on, or the day of the month a monthly period begins on. The calendar start is ignored
 * by a custom range, which names its own days.
 */
export interface PeriodAnchor {
  readonly period: TargetPeriod;
  readonly calendarStart: CivilDate;
}

/**
 * How a resolved period boundary landed: on the calendar day the anchor named, or on the final day of
 * a month too short to hold it.
 */
export type PeriodBoundaryResolution = "aligned" | "final-day-of-month";

/**
 * One period of a target's calendar: its first and last included civil dates, plus the exclusive
 * endpoint a caller compares against so it never adds a day itself. No instant, no midnight and no
 * displayed timezone is involved.
 */
export interface ResolvedPeriod {
  readonly period: TargetPeriod;
  readonly start: CivilDate;
  readonly endInclusive: CivilDate;
  readonly exclusiveEnd: CivilDate;
  /** How the anchoring calendar day of `start` resolved. */
  readonly startResolution: PeriodBoundaryResolution;
  /** How the calendar day that closes the period — the next anchored day — resolved. */
  readonly exclusiveEndResolution: PeriodBoundaryResolution;
}

/** Compares two civil dates in ISO calendar order, delegating so the ordering is Temporal's. */
function compareCivil(one: CivilDate, two: CivilDate): number {
  return Temporal.PlainDate.compare(one, two);
}

/** The civil day after `date`. */
function nextDay(date: CivilDate): CivilDate {
  return date.add({ days: 1 });
}

/** The civil day before `date`. */
function previousDay(date: CivilDate): CivilDate {
  return date.subtract({ days: 1 });
}

/**
 * The day `anchorDay` names inside `monthStart`'s month, moved back to the final day of a month too
 * short to hold it, with the resolution reported so the surface can disclose it.
 */
function anchoredDayOfMonth(
  monthStart: CivilDate,
  anchorDay: number,
): { readonly date: CivilDate; readonly resolution: PeriodBoundaryResolution } {
  const day = Math.min(anchorDay, monthStart.daysInMonth);
  return {
    date: monthStart.with({ day }),
    resolution: day === anchorDay ? "aligned" : "final-day-of-month",
  };
}

/** The seven-day period of `anchor`'s calendar that contains `date`, aligned on its anchor weekday. */
function resolveWeeklyPeriod(anchor: PeriodAnchor, date: CivilDate): ResolvedPeriod {
  const offset = (date.dayOfWeek - anchor.calendarStart.dayOfWeek + 7) % 7;
  const start = date.subtract({ days: offset });
  const endInclusive = start.add({ days: 6 });
  return {
    period: anchor.period,
    start,
    endInclusive,
    exclusiveEnd: nextDay(endInclusive),
    startResolution: "aligned",
    exclusiveEndResolution: "aligned",
  };
}

/**
 * The monthly period of `anchor`'s calendar that contains `date`, beginning on the anchored day of its
 * month and ending the day before the next anchored day. Months too short for the anchored day begin —
 * and close the previous period — on their final day, which both resolutions disclose.
 */
function resolveMonthlyPeriod(anchor: PeriodAnchor, date: CivilDate): ResolvedPeriod {
  const anchorDay = anchor.calendarStart.day;
  const monthStart = date.with({ day: 1 });
  const thisMonth = anchoredDayOfMonth(monthStart, anchorDay);

  if (compareCivil(date, thisMonth.date) >= 0) {
    const nextMonth = anchoredDayOfMonth(monthStart.add({ months: 1 }), anchorDay);
    return {
      period: anchor.period,
      start: thisMonth.date,
      endInclusive: previousDay(nextMonth.date),
      exclusiveEnd: nextMonth.date,
      startResolution: thisMonth.resolution,
      exclusiveEndResolution: nextMonth.resolution,
    };
  }

  const previousMonth = anchoredDayOfMonth(monthStart.subtract({ months: 1 }), anchorDay);
  return {
    period: anchor.period,
    start: previousMonth.date,
    endInclusive: previousDay(thisMonth.date),
    exclusiveEnd: thisMonth.date,
    startResolution: previousMonth.resolution,
    exclusiveEndResolution: thisMonth.resolution,
  };
}

/**
 * The one-off custom range, which is its own single period: resolved only for a date inside it, and
 * refused as `"invalid-period"` when its last day precedes its first so nothing silently swaps the
 * ends. A range of one day is valid; a range with no day in it is not.
 */
function resolveCustomPeriod(
  period: Extract<TargetPeriod, { readonly kind: "custom" }>,
  date: CivilDate,
): Result<ResolvedPeriod, TargetRefusalReason> {
  if (compareCivil(period.end, period.start) < 0) {
    return err("invalid-period");
  }
  if (compareCivil(date, period.start) < 0 || compareCivil(date, period.end) > 0) {
    return err("no-period");
  }
  return ok({
    period,
    start: period.start,
    endInclusive: period.end,
    exclusiveEnd: nextDay(period.end),
    startResolution: "aligned",
    exclusiveEndResolution: "aligned",
  });
}

/**
 * The period of `anchor`'s calendar that contains `date`, or `"invalid-period"` for an inverted custom
 * range and `"no-period"` for a date outside a one-off custom range. The only period resolver a caller
 * needs; it is where every civil-date boundary is computed.
 */
export function resolvePeriodContaining(
  anchor: PeriodAnchor,
  date: CivilDate,
): Result<ResolvedPeriod, TargetRefusalReason> {
  const period = anchor.period;
  switch (period.kind) {
    case "weekly":
      return ok(resolveWeeklyPeriod(anchor, date));
    case "monthly":
      return ok(resolveMonthlyPeriod(anchor, date));
    case "custom":
      return resolveCustomPeriod(period, date);
    default:
      return assertNever(period, "Unhandled target period");
  }
}

/**
 * The period that `now` falls in, read as a civil date in the declared zone before the calendar is
 * resolved — so a monthly or weekly boundary is a civil-date boundary and never an elapsed-hours one.
 * Refuses as `"invalid-zone"` when the zone cannot be resolved, and as {@link
 * resolvePeriodContaining} does otherwise.
 */
export function resolveCurrentPeriod(
  anchor: PeriodAnchor,
  zone: string,
  now: Temporal.Instant,
): Result<ResolvedPeriod, TargetRefusalReason> {
  const today = todayInZone(zone, now);
  if (today.status === "refused") {
    return err("invalid-zone");
  }
  return resolvePeriodContaining(anchor, today.date);
}

// ---------------------------------------------------------------------------------------------
// Target versions
// ---------------------------------------------------------------------------------------------

/**
 * One version of a target's plan: the quantity, measure and calendar start in force from
 * `effectiveFrom` up to `effectiveTo` inclusive, or indefinitely when `effectiveTo` is absent. Two
 * versions never overlap and nothing is prorated, so a period falls inside exactly one of them.
 */
export interface TargetVersion {
  readonly revisionId: string;
  readonly effectiveFrom: CivilDate;
  readonly effectiveTo?: CivilDate;
  readonly quantity: number;
  readonly measure: TargetMeasure;
  readonly calendarStart: CivilDate;
}

/**
 * The lifecycle of a target — active, paused or ended. Pausing and ending are states of the target and
 * never versions of it, so neither rewrites the plan history a closed period was measured against.
 */
export type TargetLifecycleState = "active" | "paused" | "ended";

/**
 * Whether the worker placed the target on Home. It changes only where the worker sees the target and
 * carries no commitment, reminder or notification, so it is absent from everything a coach reads.
 */
export type TargetHomePlacement = "placed" | "unplaced";

/**
 * A target as the worker's own surface reads it: the private label, the current plan in force, the
 * period, the lifecycle and the full version history the closed periods resolve against.
 */
export interface TargetRecord {
  readonly targetId: string;
  readonly privateLabel: string;
  readonly measure: TargetMeasure;
  readonly quantity: number;
  readonly period: TargetPeriod;
  readonly calendarStart: CivilDate;
  readonly homePlacement: TargetHomePlacement;
  readonly state: TargetLifecycleState;
  readonly versions: readonly TargetVersion[];
}

/** The plan facts a prospective version carries; the period is not versioned. */
export interface TargetVersionChange {
  readonly revisionId: string;
  readonly quantity: number;
  readonly measure: TargetMeasure;
  readonly calendarStart: CivilDate;
}

/** What a prospective version is decided from: the history, the calendar in force, and the change. */
export interface TargetVersionPlanInput {
  readonly versions: readonly TargetVersion[];
  /** The calendar in force up to the boundary; its anchor decides which days may begin a version. */
  readonly anchor: PeriodAnchor;
  readonly change: TargetVersionChange;
  readonly effectiveFrom: CivilDate;
}

/** Every refusal a target computation can answer with, each carrying one machine-readable meaning. */
export type TargetRefusalReason =
  /** A custom range whose last day precedes its first: refused, never silently swapped. */
  | "invalid-period"
  /** The zone a period was to be read in cannot be resolved. */
  | "invalid-zone"
  /** A quantity that is not a positive whole count. */
  | "invalid-quantity"
  /** The date asked about lies outside a one-off custom range, which has no other period. */
  | "no-period"
  /** No version of the target covers the period, so there is nothing to measure it against. */
  | "no-version"
  /** Two versions cover the same period: refused rather than resolved to one of them. */
  | "overlapping-versions"
  /** The requested version repeats the current quantity, measure and calendar start. */
  | "no-change"
  /** The requested boundary does not lie after the version it would follow. */
  | "not-prospective"
  /** The requested boundary is not the first day of a period of the calendar in force. */
  | "misaligned-boundary";

/** Whether a version's own `[effectiveFrom, effectiveTo]` holds the whole period. */
function coversPeriod(version: TargetVersion, period: ResolvedPeriod): boolean {
  if (compareCivil(version.effectiveFrom, period.start) > 0) {
    return false;
  }
  if (version.effectiveTo === undefined) {
    return true;
  }
  return compareCivil(version.effectiveTo, period.endInclusive) >= 0;
}

/**
 * The version a period is measured against: the one whose `[effectiveFrom, effectiveTo]` contains the
 * whole period, so a later change never re-renders a closed period against the current plan. Refuses
 * as `"no-version"` when none contains it and `"overlapping-versions"` when more than one does.
 */
export function resolveTargetVersion(
  versions: readonly TargetVersion[],
  period: ResolvedPeriod,
): Result<TargetVersion, TargetRefusalReason> {
  const covering = versions.filter((version) => coversPeriod(version, period));
  const [first, ...rest] = covering;
  if (first === undefined) {
    return err("no-version");
  }
  if (rest.length > 0) {
    return err("overlapping-versions");
  }
  return ok(first);
}

/** The version that starts last, refusing an empty history and a history that starts twice at once. */
function findLatestVersion(
  versions: readonly TargetVersion[],
): Result<TargetVersion, TargetRefusalReason> {
  let latest: TargetVersion | undefined;
  let latestCount = 0;

  for (const version of versions) {
    if (latest === undefined) {
      latest = version;
      latestCount = 1;
      continue;
    }
    const order = compareCivil(version.effectiveFrom, latest.effectiveFrom);
    if (order > 0) {
      latest = version;
      latestCount = 1;
    } else if (order === 0) {
      latestCount += 1;
    }
  }

  if (latest === undefined) {
    return err("no-version");
  }
  if (latestCount > 1) {
    return err("overlapping-versions");
  }
  return ok(latest);
}

/** The history in `effectiveFrom` order, so the newest version is the last one and no date repeats. */
function sortedByEffectiveFrom(versions: readonly TargetVersion[]): readonly TargetVersion[] {
  return versions.toSorted((one, two) => compareCivil(one.effectiveFrom, two.effectiveFrom));
}

/** Whether a change repeats the plan the version already carries, which would create no new version. */
function repeatsPlan(version: TargetVersion, change: TargetVersionChange): boolean {
  return (
    version.quantity === change.quantity &&
    version.measure === change.measure &&
    version.calendarStart.equals(change.calendarStart)
  );
}

/**
 * The history with one prospective version appended, the version it follows closed the day before that
 * boundary — `"invalid-quantity"`, `"no-version"`, `"overlapping-versions"`, `"not-prospective"`,
 * `"no-change"` or `"misaligned-boundary"` when it cannot be opened. The boundary must be a first day
 * of the calendar in force, which is what keeps every period inside exactly one version: no overlap,
 * no proration, no split period.
 */
export function startProspectiveVersion(
  input: TargetVersionPlanInput,
): Result<readonly TargetVersion[], TargetRefusalReason> {
  if (!Number.isSafeInteger(input.change.quantity) || input.change.quantity <= 0) {
    return err("invalid-quantity");
  }

  const latest = findLatestVersion(input.versions);
  if (!latest.ok) {
    return latest;
  }

  if (compareCivil(input.effectiveFrom, latest.value.effectiveFrom) <= 0) {
    return err("not-prospective");
  }

  if (repeatsPlan(latest.value, input.change)) {
    return err("no-change");
  }

  const boundary = resolvePeriodContaining(input.anchor, input.effectiveFrom);
  if (!boundary.ok || compareCivil(boundary.value.start, input.effectiveFrom) !== 0) {
    return err("misaligned-boundary");
  }

  const closedVersion: TargetVersion = {
    ...latest.value,
    effectiveTo: previousDay(input.effectiveFrom),
  };
  const openedVersion: TargetVersion = {
    revisionId: input.change.revisionId,
    effectiveFrom: input.effectiveFrom,
    quantity: input.change.quantity,
    measure: input.change.measure,
    calendarStart: input.change.calendarStart,
  };

  const history = input.versions.map((version) =>
    version === latest.value ? closedVersion : version,
  );
  return ok(sortedByEffectiveFrom([...history, openedVersion]));
}

// ---------------------------------------------------------------------------------------------
// The one activity counter
// ---------------------------------------------------------------------------------------------

/** What a count is asked for: the measure, the period, the authorised records and what is spent. */
export interface MeasureQuery {
  readonly measure: TargetMeasure;
  readonly period: ResolvedPeriod;
  readonly activities: readonly ActivityEvent[];
  /** The activity identities already credited in this period, so a replay credits nothing twice. */
  readonly alreadyCredited: ReadonlySet<string>;
}

/**
 * One measure's count over one period, with the identities this call credited so the caller can carry
 * them forward. `count` is a whole number of records: a genuine zero is a real answer, and a source
 * that could not be read is never counted here at all.
 */
export interface MeasureCount {
  readonly measure: TargetMeasure;
  readonly period: ResolvedPeriod;
  readonly count: number;
  readonly creditedActivityIds: readonly string[];
}

/** Whether a recorded civil date falls inside the period's half-open `[start, exclusiveEnd)`. */
function occursIn(date: CivilDate, period: ResolvedPeriod): boolean {
  return compareCivil(date, period.start) >= 0 && compareCivil(date, period.exclusiveEnd) < 0;
}

/**
 * The count of one measure over one period — the only activity counter in the application.
 *
 * A record is credited once: an identity already credited in the period, or credited earlier in this
 * same call, is skipped, so re-reading, retrying and replaying a mutation can never double-count. A
 * record is bucketed by its own civil occurrence date, never by entry time, a task's due date or the
 * read's instant; a record whose date precision is `"unknown"` names no day, so it is credited to no
 * period rather than guessed into one. An event that credits nothing (a planned meeting, a completed
 * task, an opened dialer or mail application, a no-show, a broadcast, an automated reply, an open, a
 * click) is skipped by {@link classifyActivity} before any date is considered.
 *
 * Five calls that contained two conversations stay five calls and two conversations: the calls are
 * five `call` events and the conversations two `conversation` events of their own, so
 * `measureFor({ measure: "calls-made", … })` answers 5 and `measureFor({ measure: "conversations", … })`
 * answers 2. A conversation is never derived from a call count.
 */
export function measureFor(query: MeasureQuery): MeasureCount {
  const credited = new Set<string>(query.alreadyCredited);
  const creditedActivityIds: string[] = [];

  for (const activity of query.activities) {
    if (classifyActivity(activity) !== query.measure) {
      continue;
    }
    if (credited.has(activity.activityId)) {
      continue;
    }
    if (activity.occurrence.precision === "unknown") {
      continue;
    }
    if (!occursIn(activity.occurrence.date, query.period)) {
      continue;
    }
    credited.add(activity.activityId);
    creditedActivityIds.push(activity.activityId);
  }

  return {
    measure: query.measure,
    period: query.period,
    count: creditedActivityIds.length,
    creditedActivityIds,
  };
}

// ---------------------------------------------------------------------------------------------
// The state a surface renders
// ---------------------------------------------------------------------------------------------

/**
 * Every state a target surface may render, closed: no target at all, an active target with records, an
 * active target with none, a paused target, an ended target, an active target the worker has not placed
 * on Home, and a target whose source could not be read. `zero-recorded` states a count and never proves
 * no effort, and `unavailable` is never rendered as a zero or as an empty collection.
 */
export const TARGET_STATES = [
  "no-target",
  "active",
  "zero-recorded",
  "paused",
  "ended",
  "unplaced",
  "unavailable",
] as const;

/** One resolvable target state, derived from {@link TARGET_STATES}. */
export type TargetState = (typeof TARGET_STATES)[number];

/**
 * Whether the Home-placement fact may inform the state: the worker's own surface discloses it, a coach
 * reads `"not-disclosed"`, and nothing else. It is a parameter rather than a reading of the record so a
 * coach-facing path cannot consult placement by leaving a flag alone.
 */
export type PlacementDisclosure = "placed" | "unplaced" | "not-disclosed";

/** What a target's state is resolved from: the target, the period's count and the placement disclosure. */
export interface TargetStateInput {
  readonly target: TargetRecord | undefined;
  /** The period's recorded count, or `null` when the source behind it could not be read at all. */
  readonly recorded: number | null;
  readonly placement: PlacementDisclosure;
}

/** The state of an active target: placement first for the worker's surface, then the recorded count. */
function resolveActiveState(recorded: number, placement: PlacementDisclosure): TargetState {
  if (placement === "unplaced") {
    return "unplaced";
  }
  return recorded === 0 ? "zero-recorded" : "active";
}

/**
 * The one state a surface renders, resolved in one fixed order — `unavailable` when the count could not
 * be read, `no-target` when there is no target, then the lifecycle (`ended`, `paused`), then `unplaced`
 * for a surface allowed to disclose placement, then `zero-recorded` for a genuine zero, then `active`.
 */
export function resolveTargetState(input: TargetStateInput): TargetState {
  if (input.recorded === null) {
    return "unavailable";
  }

  const target = input.target;
  if (target === undefined) {
    return "no-target";
  }

  switch (target.state) {
    case "ended":
      return "ended";
    case "paused":
      return "paused";
    case "active":
      return resolveActiveState(input.recorded, input.placement);
    default:
      return assertNever(target.state, "Unhandled target lifecycle state");
  }
}

/**
 * What a progress projection is built from: the target, the version the period is measured against, the
 * resolved period, and that period's count — or `null` when the source could not be read.
 */
export interface TargetProgressInput {
  readonly target: TargetRecord;
  readonly version: TargetVersion;
  readonly period: ResolvedPeriod;
  readonly count: number | null;
}

/**
 * A target's progress as the worker sees it: the private label, the plan the period was measured
 * against, the count and the state, plus the Home placement that is the worker's own arrangement.
 */
export interface WorkerTargetProgress {
  readonly revisionId: string;
  readonly privateLabel: string;
  readonly measure: TargetMeasure;
  readonly quantity: number;
  readonly period: ResolvedPeriod;
  readonly count: number | null;
  readonly state: TargetState;
  readonly homePlacement: TargetHomePlacement;
}

/**
 * A target's progress as a coach reads it: the plan the period was measured against, the count and the
 * state — and by its shape no label, no Home placement, no donor, no gift row, no money amount and no
 * note, because the omissions are the fields the type never declares.
 */
export interface CoachTargetProgress {
  readonly revisionId: string;
  readonly measure: TargetMeasure;
  readonly quantity: number;
  readonly period: ResolvedPeriod;
  readonly count: number | null;
  readonly state: TargetState;
}

/**
 * The worker's progress for one period of one target, resolved against the version that period was
 * measured under and disclosing placement to the worker's own surface.
 */
export function workerTargetProgress(input: TargetProgressInput): WorkerTargetProgress {
  return {
    revisionId: input.version.revisionId,
    privateLabel: input.target.privateLabel,
    measure: input.version.measure,
    quantity: input.version.quantity,
    period: input.period,
    count: input.count,
    state: resolveTargetState({
      target: input.target,
      recorded: input.count,
      placement: input.target.homePlacement,
    }),
    homePlacement: input.target.homePlacement,
  };
}

/**
 * The coach's progress for one period of one target, resolved without consulting Home placement so a
 * coach can neither read it nor learn that it exists.
 */
export function coachTargetProgress(input: TargetProgressInput): CoachTargetProgress {
  return {
    revisionId: input.version.revisionId,
    measure: input.version.measure,
    quantity: input.version.quantity,
    period: input.period,
    count: input.count,
    state: resolveTargetState({
      target: input.target,
      recorded: input.count,
      placement: "not-disclosed",
    }),
  };
}
