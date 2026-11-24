import { Temporal } from "temporal-polyfill";
import { assertNever, err, ok, type Result } from "../../lib/result";
import { todayInZone, type CivilDate, type DatePrecision } from "../time/civil";
export const TARGET_MEASURES = ["calls-made", "personal-messages", "conversations", "meetings-held"] as const;
export type TargetMeasure = (typeof TARGET_MEASURES)[number];
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
  const start = date.subtract({ days: (date.dayOfWeek - anchor.calendarStart.dayOfWeek + 7) % 7 });
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
  return compareCivil(date, period.start) < 0 || compareCivil(date, period.end) > 0 ? err("no-period") : ok({ period, start: period.start, endInclusive: period.end, exclusiveEnd: nextDay(period.end), startResolution: "aligned", exclusiveEndResolution: "aligned" });
}
/** The period of `anchor`'s calendar that contains `date`, or `"invalid-period"` for an inverted custom range and `"no-period"` for a date outside a one-off custom range. */
export const resolvePeriodContaining = (anchor: PeriodAnchor, date: CivilDate): Result<ResolvedPeriod, TargetRefusalReason> =>
  anchor.period.kind === "weekly" ? ok(resolveWeeklyPeriod(anchor, date)) : anchor.period.kind === "monthly" ? ok(resolveMonthlyPeriod(anchor, date)) : anchor.period.kind === "custom" ? resolveCustomPeriod(anchor.period, date) : assertNever(anchor.period, "Unhandled target period");
/** The period that `now` falls in, read as a civil date in the declared zone before the calendar is resolved — so a monthly or weekly boundary is a civil-date boundary and never an elapsed-hour one. */
export function resolveCurrentPeriod(anchor: PeriodAnchor, zone: string, now: Temporal.Instant): Result<ResolvedPeriod, TargetRefusalReason> {
  const today = todayInZone(zone, now);
  return today.status === "refused" ? err("invalid-zone") : resolvePeriodContaining(anchor, today.date);
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
const coversPeriod = (version: TargetVersion, period: ResolvedPeriod): boolean => compareCivil(version.effectiveFrom, period.start) <= 0 && (version.effectiveTo === undefined || compareCivil(version.effectiveTo, period.endInclusive) >= 0);
/** The version a period is measured against: the one whose `[effectiveFrom, effectiveTo]` contains the whole period, so a later change never re-renders a closed period against the current plan. */
export function resolveTargetVersion(versions: readonly TargetVersion[], period: ResolvedPeriod): Result<TargetVersion, TargetRefusalReason> {
  const covering = versions.filter((version) => coversPeriod(version, period));
  const [first] = covering;
  return first === undefined ? err("no-version") : covering.length > 1 ? err("overlapping-versions") : ok(first);
}
function findLatestVersion(versions: readonly TargetVersion[]): Result<TargetVersion, TargetRefusalReason> {
  const latest = versions.reduce<TargetVersion | undefined>((best, version) => (best === undefined || compareCivil(version.effectiveFrom, best.effectiveFrom) > 0 ? version : best), undefined);
  return latest === undefined ? err("no-version") : versions.filter((version) => compareCivil(version.effectiveFrom, latest.effectiveFrom) === 0).length > 1 ? err("overlapping-versions") : ok(latest);
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
  const history = input.versions.map((version) => (version === latest.value ? { ...latest.value, effectiveTo: previousDay(input.effectiveFrom) } : version));
  return ok(sortedByEffectiveFrom([...history, { revisionId: input.change.revisionId, effectiveFrom: input.effectiveFrom, quantity: input.change.quantity, measure: input.change.measure, calendarStart: input.change.calendarStart }]));
}
export type MeasureQuery = { readonly measure: TargetMeasure; readonly period: ResolvedPeriod; readonly activities: readonly ActivityEvent[]; readonly alreadyCredited: ReadonlySet<string> };
export type MeasureCount = { readonly measure: TargetMeasure; readonly period: ResolvedPeriod; readonly count: number; readonly creditedActivityIds: readonly string[] };
const occursIn = (date: CivilDate, period: ResolvedPeriod): boolean => compareCivil(date, period.start) >= 0 && compareCivil(date, period.exclusiveEnd) < 0;
/** The count of one measure over one period — the only activity counter in the application. */ export function measureFor(query: MeasureQuery): MeasureCount {
  const credited = new Set<string>(query.alreadyCredited);
  const creditedActivityIds: string[] = [];
  for (const activity of query.activities) {
    if (classifyActivity(activity) !== query.measure || activity.occurrence.precision === "unknown" || credited.has(activity.activityId) || !occursIn(activity.occurrence.date, query.period)) continue;
    credited.add(activity.activityId);
    creditedActivityIds.push(activity.activityId);
  }
  return { measure: query.measure, period: query.period, count: creditedActivityIds.length, creditedActivityIds };
}
export const TARGET_STATES = ["no-target", "active", "zero-recorded", "paused", "ended", "unplaced", "unavailable"] as const;
export type TargetState = (typeof TARGET_STATES)[number];
export type PlacementDisclosure = "placed" | "unplaced" | "not-disclosed";
export type TargetStateInput = { readonly target: TargetRecord | undefined; readonly recorded: number | null; readonly placement: PlacementDisclosure };
const resolveActiveState = (recorded: number, placement: PlacementDisclosure): TargetState => (placement === "unplaced" ? "unplaced" : recorded === 0 ? "zero-recorded" : "active");
const LIFECYCLE_STATES: Readonly<Record<TargetLifecycleState, (input: TargetStateInput) => TargetState>> = { ended: () => "ended", paused: () => "paused", active: (input) => resolveActiveState(input.recorded ?? 0, input.placement) };
/** The one state a surface renders, resolved in one fixed order — `unavailable` when the count could not be read, `no-target` when there is no target, then the lifecycle (`ended`, `paused`). */
export const resolveTargetState = (input: TargetStateInput): TargetState => (input.recorded === null ? "unavailable" : input.target === undefined ? "no-target" : LIFECYCLE_STATES[input.target.state](input));
export type TargetProgressInput = { readonly target: TargetRecord; readonly version: TargetVersion; readonly period: ResolvedPeriod; readonly count: number | null };
export type WorkerTargetProgress = { readonly revisionId: string; readonly privateLabel: string; readonly measure: TargetMeasure; readonly quantity: number; readonly period: ResolvedPeriod; readonly count: number | null; readonly state: TargetState; readonly homePlacement: TargetHomePlacement };
export type CoachTargetProgress = { readonly revisionId: string; readonly measure: TargetMeasure; readonly quantity: number; readonly period: ResolvedPeriod; readonly count: number | null; readonly state: TargetState };
/** The worker's progress for one period of one target, resolved against the version that period was measured under and disclosing placement to the worker's own surface. */
export function workerTargetProgress({ target, version, period, count }: TargetProgressInput): WorkerTargetProgress {
  return { revisionId: version.revisionId, privateLabel: target.privateLabel, measure: version.measure, quantity: version.quantity, period, count, state: resolveTargetState({ target, recorded: count, placement: target.homePlacement }), homePlacement: target.homePlacement };
}
/** The coach's progress for one period of one target, resolved without consulting Home placement so a coach can neither read it nor learn that it exists. */
export const coachTargetProgress = (input: TargetProgressInput): CoachTargetProgress => ({
  revisionId: input.version.revisionId,
  measure: input.version.measure,
  quantity: input.version.quantity,
  period: input.period,
  count: input.count,
  state: resolveTargetState({ target: input.target, recorded: input.count, placement: "not-disclosed" }),
});
