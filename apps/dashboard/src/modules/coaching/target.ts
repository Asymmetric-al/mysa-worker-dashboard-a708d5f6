/** The coaching target — the one activity counter and the one target-version model of the application. */
import { Temporal } from "temporal-polyfill";
import { assertNever, err, ok, type Result } from "../../lib/result";
import { type CivilDate, type DatePrecision, todayInZone } from "../time/civil";
export const TARGET_MEASURES = ["calls-made", "personal-messages", "conversations", "meetings-held"] as const;
export type TargetMeasure = (typeof TARGET_MEASURES)[number];
/** Every kind of event a target count may be offered, closed and named: the four that are an actual exchange, and the nine that are not one and therefore credit nothing. */
export const ACTIVITY_EVENT_KINDS = ["call", "personal-message", "conversation", "meeting-held", "meeting-planned", "task-completed", "dialer-opened", "mail-opened", "no-show", "broadcast", "automated-reply", "message-opened", "link-clicked"] as const;
export type ActivityEventKind = (typeof ACTIVITY_EVENT_KINDS)[number];
export type ActivityCredit = TargetMeasure | "none";
type PlacedDatePrecision = Exclude<DatePrecision, "unknown">;
export type ActivityOccurrence = { readonly precision: PlacedDatePrecision; readonly date: CivilDate } | { readonly precision: "unknown" };
export type ActivityEvent = { readonly activityId: string; readonly kind: ActivityEventKind; readonly occurrence: ActivityOccurrence };
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
/** The credit an event kind earns: one of the four measures for an actual exchange, `"none"` for a planned meeting, a completed task, an opened application, a no-show, a broadcast, an. */
export const classifyActivity = (event: ActivityEvent): ActivityCredit => CREDIT_BY_KIND[event.kind];
export type TargetPeriod = { readonly kind: "weekly" } | { readonly kind: "monthly" } | { readonly kind: "custom"; readonly start: CivilDate; readonly end: CivilDate };
export const DEFAULT_TARGET_PERIOD: TargetPeriod = { kind: "weekly" };
export type PeriodAnchor = { readonly period: TargetPeriod; readonly calendarStart: CivilDate };
export type PeriodBoundaryResolution = "aligned" | "final-day-of-month";
export type ResolvedPeriod = { readonly period: TargetPeriod; readonly start: CivilDate; readonly endInclusive: CivilDate; readonly exclusiveEnd: CivilDate; readonly startResolution: PeriodBoundaryResolution; readonly exclusiveEndResolution: PeriodBoundaryResolution };
const compareCivil = (one: CivilDate, two: CivilDate): number => Temporal.PlainDate.compare(one, two);
const nextDay = (date: CivilDate): CivilDate => date.add({ days: 1 });
const previousDay = (date: CivilDate): CivilDate => date.subtract({ days: 1 });
function anchoredDayOfMonth(monthStart: CivilDate, anchorDay: number): { readonly date: CivilDate; readonly resolution: PeriodBoundaryResolution } {
  const day = Math.min(anchorDay, monthStart.daysInMonth);
  return { date: monthStart.with({ day }), resolution: day === anchorDay ? "aligned" : "final-day-of-month" };
}
function resolveWeeklyPeriod(anchor: PeriodAnchor, date: CivilDate): ResolvedPeriod {
  const offset = (date.dayOfWeek - anchor.calendarStart.dayOfWeek + 7) % 7;
  const start = date.subtract({ days: offset });
  const endInclusive = start.add({ days: 6 });
  return { period: anchor.period, start, endInclusive, exclusiveEnd: nextDay(endInclusive), startResolution: "aligned", exclusiveEndResolution: "aligned" };
}
function resolveMonthlyPeriod(anchor: PeriodAnchor, date: CivilDate): ResolvedPeriod {
  const anchorDay = anchor.calendarStart.day;
  const monthStart = date.with({ day: 1 });
  const thisMonth = anchoredDayOfMonth(monthStart, anchorDay);
  if (compareCivil(date, thisMonth.date) >= 0) {
    const nextMonth = anchoredDayOfMonth(monthStart.add({ months: 1 }), anchorDay);
    return { period: anchor.period, start: thisMonth.date, endInclusive: previousDay(nextMonth.date), exclusiveEnd: nextMonth.date, startResolution: thisMonth.resolution, exclusiveEndResolution: nextMonth.resolution };
  }
  const previousMonth = anchoredDayOfMonth(monthStart.subtract({ months: 1 }), anchorDay);
  return { period: anchor.period, start: previousMonth.date, endInclusive: previousDay(thisMonth.date), exclusiveEnd: thisMonth.date, startResolution: previousMonth.resolution, exclusiveEndResolution: thisMonth.resolution };
}
function resolveCustomPeriod(period: Extract<TargetPeriod, { readonly kind: "custom" }>, date: CivilDate): Result<ResolvedPeriod, TargetRefusalReason> {
  if (compareCivil(period.end, period.start) < 0) return err("invalid-period");
  if (compareCivil(date, period.start) < 0 || compareCivil(date, period.end) > 0) return err("no-period");
  return ok({ period, start: period.start, endInclusive: period.end, exclusiveEnd: nextDay(period.end), startResolution: "aligned", exclusiveEndResolution: "aligned" });
}
/** The period of `anchor`'s calendar that contains `date`, or `"invalid-period"` for an inverted custom range and `"no-period"` for a date outside a one-off custom range. */
export function resolvePeriodContaining(anchor: PeriodAnchor, date: CivilDate): Result<ResolvedPeriod, TargetRefusalReason> {
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
/** The period that `now` falls in, read as a civil date in the declared zone before the calendar is resolved — so a monthly or weekly boundary is a civil-date boundary and never an. */
export function resolveCurrentPeriod(anchor: PeriodAnchor, zone: string, now: Temporal.Instant): Result<ResolvedPeriod, TargetRefusalReason> {
  const today = todayInZone(zone, now);
  if (today.status === "refused") return err("invalid-zone");
  return resolvePeriodContaining(anchor, today.date);
}
export type TargetVersion = { readonly revisionId: string; readonly effectiveFrom: CivilDate; readonly effectiveTo?: CivilDate; readonly quantity: number; readonly measure: TargetMeasure; readonly calendarStart: CivilDate };
export type TargetLifecycleState = "active" | "paused" | "ended";
export type TargetHomePlacement = "placed" | "unplaced";
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
export type TargetVersionChange = { readonly revisionId: string; readonly quantity: number; readonly measure: TargetMeasure; readonly calendarStart: CivilDate };
export type TargetVersionPlanInput = { readonly versions: readonly TargetVersion[]; readonly anchor: PeriodAnchor; readonly change: TargetVersionChange; readonly effectiveFrom: CivilDate };
export type TargetRefusalReason = "invalid-period" | "invalid-zone" | "invalid-quantity" | "no-period" | "no-version" | "overlapping-versions" | "no-change" | "not-prospective" | "misaligned-boundary";
function coversPeriod(version: TargetVersion, period: ResolvedPeriod): boolean {
  if (compareCivil(version.effectiveFrom, period.start) > 0) return false;
  if (version.effectiveTo === undefined) return true;
  return compareCivil(version.effectiveTo, period.endInclusive) >= 0;
}
/** The version a period is measured against: the one whose `[effectiveFrom, effectiveTo]` contains the whole period, so a later change never re-renders a closed period against the current plan. */
export function resolveTargetVersion(versions: readonly TargetVersion[], period: ResolvedPeriod): Result<TargetVersion, TargetRefusalReason> {
  const covering = versions.filter((version) => coversPeriod(version, period));
  const [first, ...rest] = covering;
  if (first === undefined) return err("no-version");
  if (rest.length > 0) return err("overlapping-versions");
  return ok(first);
}
function findLatestVersion(versions: readonly TargetVersion[]): Result<TargetVersion, TargetRefusalReason> {
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
    } else if (order === 0) latestCount += 1;
  }
  if (latest === undefined) return err("no-version");
  if (latestCount > 1) return err("overlapping-versions");
  return ok(latest);
}
const sortedByEffectiveFrom = (versions: readonly TargetVersion[]): readonly TargetVersion[] => versions.toSorted((one, two) => compareCivil(one.effectiveFrom, two.effectiveFrom));
const repeatsPlan = (version: TargetVersion, change: TargetVersionChange): boolean => version.quantity === change.quantity && version.measure === change.measure && version.calendarStart.equals(change.calendarStart);
/** The history with one prospective version appended, the version it follows closed the day before that boundary — `"invalid-quantity"`, `"no-version"`, `"overlapping-versions"`. */
export function startProspectiveVersion(input: TargetVersionPlanInput): Result<readonly TargetVersion[], TargetRefusalReason> {
  if (!Number.isSafeInteger(input.change.quantity) || input.change.quantity <= 0) return err("invalid-quantity");
  const latest = findLatestVersion(input.versions);
  if (!latest.ok) return latest;
  if (compareCivil(input.effectiveFrom, latest.value.effectiveFrom) <= 0) return err("not-prospective");
  if (repeatsPlan(latest.value, input.change)) return err("no-change");
  const boundary = resolvePeriodContaining(input.anchor, input.effectiveFrom);
  if (!boundary.ok || compareCivil(boundary.value.start, input.effectiveFrom) !== 0) return err("misaligned-boundary");
  const closedVersion: TargetVersion = { ...latest.value, effectiveTo: previousDay(input.effectiveFrom) };
  const openedVersion: TargetVersion = { revisionId: input.change.revisionId, effectiveFrom: input.effectiveFrom, quantity: input.change.quantity, measure: input.change.measure, calendarStart: input.change.calendarStart };
  const history = input.versions.map((version) => (version === latest.value ? closedVersion : version));
  return ok(sortedByEffectiveFrom([...history, openedVersion]));
}
export type MeasureQuery = { readonly measure: TargetMeasure; readonly period: ResolvedPeriod; readonly activities: readonly ActivityEvent[]; readonly alreadyCredited: ReadonlySet<string> };
export type MeasureCount = { readonly measure: TargetMeasure; readonly period: ResolvedPeriod; readonly count: number; readonly creditedActivityIds: readonly string[] };
const occursIn = (date: CivilDate, period: ResolvedPeriod): boolean => compareCivil(date, period.start) >= 0 && compareCivil(date, period.exclusiveEnd) < 0;
/** The count of one measure over one period — the only activity counter in the application. */
export function measureFor(query: MeasureQuery): MeasureCount {
  const credited = new Set<string>(query.alreadyCredited);
  const creditedActivityIds: string[] = [];
  for (const activity of query.activities) {
    if (classifyActivity(activity) !== query.measure) continue;
    if (credited.has(activity.activityId)) continue;
    if (activity.occurrence.precision === "unknown") continue;
    if (!occursIn(activity.occurrence.date, query.period)) continue;
    credited.add(activity.activityId);
    creditedActivityIds.push(activity.activityId);
  }
  return { measure: query.measure, period: query.period, count: creditedActivityIds.length, creditedActivityIds };
}
/** Every state a target surface may render, closed: no target at all, an active target with records, an active target with none, a paused target, an ended target, an active target the worker. */
export const TARGET_STATES = ["no-target", "active", "zero-recorded", "paused", "ended", "unplaced", "unavailable"] as const;
export type TargetState = (typeof TARGET_STATES)[number];
export type PlacementDisclosure = "placed" | "unplaced" | "not-disclosed";
export type TargetStateInput = { readonly target: TargetRecord | undefined; readonly recorded: number | null; readonly placement: PlacementDisclosure };
function resolveActiveState(recorded: number, placement: PlacementDisclosure): TargetState {
  if (placement === "unplaced") return "unplaced";
  return recorded === 0 ? "zero-recorded" : "active";
}
/** The one state a surface renders, resolved in one fixed order — `unavailable` when the count could not be read, `no-target` when there is no target, then the lifecycle (`ended`, `paused`). */
export function resolveTargetState(input: TargetStateInput): TargetState {
  if (input.recorded === null) return "unavailable";
  const target = input.target;
  if (target === undefined) return "no-target";
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
export type TargetProgressInput = { readonly target: TargetRecord; readonly version: TargetVersion; readonly period: ResolvedPeriod; readonly count: number | null };
export type WorkerTargetProgress = { readonly revisionId: string; readonly privateLabel: string; readonly measure: TargetMeasure; readonly quantity: number; readonly period: ResolvedPeriod; readonly count: number | null; readonly state: TargetState; readonly homePlacement: TargetHomePlacement };
export type CoachTargetProgress = { readonly revisionId: string; readonly measure: TargetMeasure; readonly quantity: number; readonly period: ResolvedPeriod; readonly count: number | null; readonly state: TargetState };
/** The worker's progress for one period of one target, resolved against the version that period was measured under and disclosing placement to the worker's own surface. */
export function workerTargetProgress(input: TargetProgressInput): WorkerTargetProgress {
  return {
    revisionId: input.version.revisionId,
    privateLabel: input.target.privateLabel,
    measure: input.version.measure,
    quantity: input.version.quantity,
    period: input.period,
    count: input.count,
    state: resolveTargetState({ target: input.target, recorded: input.count, placement: input.target.homePlacement }),
    homePlacement: input.target.homePlacement,
  };
}
/** The coach's progress for one period of one target, resolved without consulting Home placement so a coach can neither read it nor learn that it exists. */
export function coachTargetProgress(input: TargetProgressInput): CoachTargetProgress {
  return { revisionId: input.version.revisionId, measure: input.version.measure, quantity: input.version.quantity, period: input.period, count: input.count, state: resolveTargetState({ target: input.target, recorded: input.count, placement: "not-disclosed" }) };
}
