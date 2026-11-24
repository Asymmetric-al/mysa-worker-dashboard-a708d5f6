import { Temporal } from "temporal-polyfill";
import { civilDateAt, isPreciseDate, startOfCivilDay, type CivilDate, type CivilDayStart, type DatePrecision } from "./civil";
export const NOTIFICATION_USEFULNESS_HOURS = 24;
export const CONFIRMATION_WINDOW_HOURS = 168;
/** The accepted source zone every referral window is resolved in: an introduction date is a calendar date in one declared zone, so the endpoint the New window expires at resolves the same way whoever reads it, and the seed and the surfaces that record an introduction read it from here rather than stating a second copy. */
export const REFERRAL_SOURCE_ZONE = "Europe/London";
const SECONDS_PER_DAY = 86_400;
export type MidnightResolution = Extract<CivilDayStart, { status: "resolved" }>["resolution"];
export type WindowRefusalReason = "invalid-days" | "invalid-zone" | "invalid-date";
const MONTH_NAMES = { 1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June", 7: "July", 8: "August", 9: "September", 10: "October", 11: "November", 12: "December" } as const;
type MonthNumber = keyof typeof MONTH_NAMES;
function nominalWordingFor(date: CivilDate): string {
  const isoDate = date.withCalendar("iso8601");
  return `Active through ${isoDate.day} ${MONTH_NAMES[isoDate.month as MonthNumber]} ${isoDate.year}`;
}
const isStrictlyBefore = (now: Temporal.Instant, boundary: Temporal.Instant): boolean => Temporal.Instant.compare(now, boundary) < 0;
type ElapsedDeadline = { deadlineInstant: Temporal.Instant; within: boolean; remainingMilliseconds: number };
function elapsedDeadlineAt(anchor: Temporal.Instant, hours: number, now: Temporal.Instant): ElapsedDeadline {
  const deadlineInstant = anchor.add({ hours });
  return !isStrictlyBefore(now, deadlineInstant) ? { deadlineInstant, within: false, remainingMilliseconds: 0 } : { deadlineInstant, within: true, remainingMilliseconds: deadlineInstant.epochMilliseconds - now.epochMilliseconds };
}
function addCivilDays(date: CivilDate, days: number): CivilDate | undefined {
  try {
    return date.withCalendar("iso8601").add({ days });
  } catch {
    return undefined;
  }
}
export type BoundedNewWindow = { status: "bounded"; nominalLastIncludedOn: CivilDate; nominalWording: string; resolvedEndInstant: Temporal.Instant; resolution: MidnightResolution; nominalDisagreesWithResolved: boolean };
export type NewWindowEnd = BoundedNewWindow | { status: "no-deadline"; reason: "imprecise-date" } | { status: "refused"; reason: WindowRefusalReason };
/** Resolves a referral's New window: `N` calendar days counted from the original introduction date in the accepted source zone. */
export function newWindowEnd(input: { originalIntroductionOn: CivilDate; datePrecision: DatePrecision; sourceZone: string; days: number }): NewWindowEnd {
  const { originalIntroductionOn, datePrecision, sourceZone, days } = input;
  if (!isPreciseDate(datePrecision)) return { status: "no-deadline", reason: "imprecise-date" };
  if (!Number.isSafeInteger(days) || days <= 0) return { status: "refused", reason: "invalid-days" };
  const nominalLastIncludedOn = addCivilDays(originalIntroductionOn, days - 1);
  const exclusiveEndpointDate = addCivilDays(originalIntroductionOn, days);
  if (nominalLastIncludedOn === undefined || exclusiveEndpointDate === undefined) return { status: "refused", reason: "invalid-date" };
  const endpoint = startOfCivilDay(exclusiveEndpointDate, sourceZone);
  if (endpoint.status === "refused") return { status: "refused", reason: "invalid-zone" };
  return {
    status: "bounded",
    nominalLastIncludedOn,
    nominalWording: nominalWordingFor(nominalLastIncludedOn),
    resolvedEndInstant: endpoint.instant,
    resolution: endpoint.resolution,
    nominalDisagreesWithResolved: Temporal.PlainDateTime.compare(endpoint.instant.toZonedDateTimeISO(sourceZone).toPlainDateTime(), exclusiveEndpointDate.toPlainDateTime(Temporal.PlainTime.from("00:00"))) !== 0,
  };
}
export type ReferralWindowStatus = { status: "active" } | { status: "expired" } | { status: "no-deadline" } | { status: "refused"; reason: WindowRefusalReason };
/** Where a referral stands at one instant: */
export function referralWindowState(input: { windowEnd: Temporal.Instant | undefined; now: Temporal.Instant }): ReferralWindowStatus {
  const { windowEnd, now } = input;
  return windowEnd === undefined ? { status: "no-deadline" } : isStrictlyBefore(now, windowEnd) ? { status: "active" } : { status: "expired" };
}
export type ReferralCycleState = { consumed: boolean; predecessorId?: string; successorId?: string };
export type ContinuedWindowEnd = { status: "bounded"; endInstant: Temporal.Instant; elapsedSeconds: number } | { status: "refused"; reason: "invalid-days" | "already-consumed" };
/** Resolves a referral continuation: the acceptance instant plus `N` days of elapsed seconds. */ export function continuedWindowEnd(input: { acceptedAt: Temporal.Instant; days: number; cycle: ReferralCycleState }): ContinuedWindowEnd {
  const { acceptedAt, days, cycle } = input;
  if (!Number.isSafeInteger(days) || days <= 0) return { status: "refused", reason: "invalid-days" };
  if (cycle.consumed || cycle.successorId !== undefined) return { status: "refused", reason: "already-consumed" };
  const elapsedSeconds = days * SECONDS_PER_DAY;
  if (!Number.isSafeInteger(elapsedSeconds)) return { status: "refused", reason: "invalid-days" };
  try {
    return { status: "bounded", endInstant: acceptedAt.add({ seconds: elapsedSeconds }), elapsedSeconds };
  } catch {
    return { status: "refused", reason: "invalid-days" };
  }
}
export type ShareCutoff =
  | { status: "bounded"; cutoffInstant: Temporal.Instant; limitedBy: "source"; sourceLimitInstant: Temporal.Instant; shareThroughCutoffInstant: Temporal.Instant }
  | { status: "bounded"; cutoffInstant: Temporal.Instant; limitedBy: "share-through" }
  | { status: "refused"; reason: WindowRefusalReason };
/** Resolves a coaching share cutoff: the exclusive start of the civil day after the chosen Share-through date, in the source-approved zone. */
export function shareCutoff(input: { shareThroughDate: CivilDate; frozenZone: string; sourceLimit?: Temporal.Instant }): ShareCutoff {
  const { shareThroughDate, frozenZone, sourceLimit } = input;
  const dayAfterSharedDate = addCivilDays(shareThroughDate, 1);
  if (dayAfterSharedDate === undefined) return { status: "refused", reason: "invalid-date" };
  const shareThroughCutoff = startOfCivilDay(dayAfterSharedDate, frozenZone);
  if (shareThroughCutoff.status === "refused") return { status: "refused", reason: "invalid-zone" };
  const cutoffInstant = shareThroughCutoff.instant;
  if (sourceLimit !== undefined && Temporal.Instant.compare(sourceLimit, cutoffInstant) < 0) return { status: "bounded", cutoffInstant: sourceLimit, limitedBy: "source", sourceLimitInstant: sourceLimit, shareThroughCutoffInstant: cutoffInstant };
  return { status: "bounded", cutoffInstant, limitedBy: "share-through" };
}
/** Reads back the Share-through civil day a frozen coaching cutoff implies, in the zone it was frozen in: the inverse of {@link shareCutoff}. */
export function shareThroughDateOfCutoff(input: { cutoffInstant: Temporal.Instant; frozenZone: string }): CivilDate | null {
  const dayOfCutoff = civilDateAt(input.cutoffInstant, input.frozenZone);
  return dayOfCutoff.status === "refused" ? null : (addCivilDays(dayOfCutoff.date, -1) ?? null);
}
export type ShareWindowStatus = { status: "open" } | { status: "closed"; reason: "cutoff-reached" };
export const shareWindowOpenAt = (input: { cutoffInstant: Temporal.Instant; now: Temporal.Instant }): ShareWindowStatus => (isStrictlyBefore(input.now, input.cutoffInstant) ? { status: "open" } : { status: "closed", reason: "cutoff-reached" });
export type NotificationDeadlineResult = { status: "within-usefulness"; deadlineInstant: Temporal.Instant; remainingMilliseconds: number } | { status: "past-usefulness"; deadlineInstant: Temporal.Instant };
/** Checks whether an immediate notification request is still useful at `now`, counted in elapsed hours from the instant it was intended for (`NOTIFICATION_USEFULNESS_HOURS`). */
export function notificationDeadline(input: { intendedAt: Temporal.Instant; now: Temporal.Instant }): NotificationDeadlineResult {
  const deadline = elapsedDeadlineAt(input.intendedAt, NOTIFICATION_USEFULNESS_HOURS, input.now);
  return deadline.within ? { status: "within-usefulness", deadlineInstant: deadline.deadlineInstant, remainingMilliseconds: deadline.remainingMilliseconds } : { status: "past-usefulness", deadlineInstant: deadline.deadlineInstant };
}
export type ConfirmationDeadlineResult = { status: "within-window"; deadlineInstant: Temporal.Instant; remainingMilliseconds: number } | { status: "expired"; deadlineInstant: Temporal.Instant };
/** Checks whether an accepted membership confirmation is still open at `now`, counted in elapsed hours from the acceptance instant (`CONFIRMATION_WINDOW_HOURS`). */
export function confirmationDeadline(input: { acceptedAt: Temporal.Instant; now: Temporal.Instant }): ConfirmationDeadlineResult {
  const deadline = elapsedDeadlineAt(input.acceptedAt, CONFIRMATION_WINDOW_HOURS, input.now);
  return deadline.within ? { status: "within-window", deadlineInstant: deadline.deadlineInstant, remainingMilliseconds: deadline.remainingMilliseconds } : { status: "expired", deadlineInstant: deadline.deadlineInstant };
}
