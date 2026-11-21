/**
 * The fixed time boundaries of the worker dashboard: the referral New window, the referral
 * continuation window, the coaching share cutoff, the notification usefulness window and the
 * confirmation window. Every boundary is a pure function of `(input, now)`, evaluated at read or
 * command time; there is no scheduler.
 */
import { Temporal } from "temporal-polyfill";
import { type CivilDate, type CivilDayStart, type DatePrecision, civilDateAt, isPreciseDate, startOfCivilDay } from "./civil";
/** How long an immediate notification stays useful after the instant it was intended for: a whole number of elapsed hours. */
export const NOTIFICATION_USEFULNESS_HOURS = 24;
/** How long an accepted membership confirmation stays open: a whole number of elapsed hours, one week. */
export const CONFIRMATION_WINDOW_HOURS = 168;

const SECONDS_PER_DAY = 86_400;
/** How a resolved civil midnight is reported, taken from the civil module's own union so this declaration cannot drift from the one that produces it. */
export type MidnightResolution = Extract<CivilDayStart, { status: "resolved" }>["resolution"];
/** Why a boundary could not be computed. */
export type WindowRefusalReason = "invalid-days" | "invalid-zone" | "invalid-date";

const MONTH_NAMES = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December",
} as const;
type MonthNumber = keyof typeof MONTH_NAMES;

function nominalWordingFor(date: CivilDate): string {
  const isoDate = date.withCalendar("iso8601");
  // A Temporal plain date's ISO month is always 1..12, so the lookup cannot miss; the assertion
  // states that invariant instead of adding a fallback label that could never be the right month.
  const monthName = MONTH_NAMES[isoDate.month as MonthNumber];
  return `Active through ${isoDate.day} ${monthName} ${isoDate.year}`;
}
function isStrictlyBefore(now: Temporal.Instant, boundary: Temporal.Instant): boolean {
  return Temporal.Instant.compare(now, boundary) < 0;
}
type ElapsedDeadline = {
  deadlineInstant: Temporal.Instant;
  within: boolean;
  remainingMilliseconds: number;
};
function elapsedDeadlineAt(anchor: Temporal.Instant, hours: number, now: Temporal.Instant): ElapsedDeadline {
  const deadlineInstant = anchor.add({ hours });
  if (!isStrictlyBefore(now, deadlineInstant)) {
    return { deadlineInstant, within: false, remainingMilliseconds: 0 };
  }
  return {
    deadlineInstant,
    within: true,
    remainingMilliseconds: deadlineInstant.epochMilliseconds - now.epochMilliseconds,
  };
}
function addCivilDays(date: CivilDate, days: number): CivilDate | undefined {
  try {
    return date.withCalendar("iso8601").add({ days });
  } catch {
    return undefined;
  }
}
/** A referral New window that resolved to exactly one exclusive endpoint. */
export type BoundedNewWindow = {
  status: "bounded";
  nominalLastIncludedOn: CivilDate;
  nominalWording: string;
  resolvedEndInstant: Temporal.Instant;
  resolution: MidnightResolution;
  nominalDisagreesWithResolved: boolean;
};
/** The outcome of computing a referral New window: a resolved exclusive endpoint, no deadline at all, or a refusal with its reason. */
export type NewWindowEnd = BoundedNewWindow | { status: "no-deadline"; reason: "imprecise-date" } | { status: "refused"; reason: WindowRefusalReason };
/** Resolves a referral's New window: `N` calendar days counted from the original introduction date in the accepted source zone. */
export function newWindowEnd(input: { originalIntroductionOn: CivilDate; datePrecision: DatePrecision; sourceZone: string; days: number }): NewWindowEnd {
  const { originalIntroductionOn, datePrecision, sourceZone, days } = input;
  if (!isPreciseDate(datePrecision)) {
    return { status: "no-deadline", reason: "imprecise-date" };
  }
  if (!Number.isSafeInteger(days) || days <= 0) {
    return { status: "refused", reason: "invalid-days" };
  }
  const nominalLastIncludedOn = addCivilDays(originalIntroductionOn, days - 1);
  const exclusiveEndpointDate = addCivilDays(originalIntroductionOn, days);
  if (nominalLastIncludedOn === undefined || exclusiveEndpointDate === undefined) {
    return { status: "refused", reason: "invalid-date" };
  }
  const endpoint = startOfCivilDay(exclusiveEndpointDate, sourceZone);
  if (endpoint.status === "refused") {
    return { status: "refused", reason: "invalid-zone" };
  }
  const nominalMidnight = exclusiveEndpointDate.toPlainDateTime(Temporal.PlainTime.from("00:00"));
  const resolvedLocal = endpoint.instant.toZonedDateTimeISO(sourceZone).toPlainDateTime();
  return {
    status: "bounded",
    nominalLastIncludedOn,
    nominalWording: nominalWordingFor(nominalLastIncludedOn),
    resolvedEndInstant: endpoint.instant,
    resolution: endpoint.resolution,
    nominalDisagreesWithResolved: Temporal.PlainDateTime.compare(resolvedLocal, nominalMidnight) !== 0,
  };
}
/** Where a referral stands at one instant: Active, Expired, undecided because it has no deadline, or refused because the window it carries could not be evaluated. */
export type ReferralWindowStatus = { status: "active" } | { status: "expired" } | { status: "no-deadline" } | { status: "refused"; reason: WindowRefusalReason };
/** Judges a referral at `now`. */
export function referralWindowState(input: { windowEnd: Temporal.Instant | undefined; now: Temporal.Instant }): ReferralWindowStatus {
  const { windowEnd, now } = input;
  if (windowEnd === undefined) {
    return { status: "no-deadline" };
  }
  return isStrictlyBefore(now, windowEnd) ? { status: "active" } : { status: "expired" };
}
/** The consumed-cycle state a referral continuation is judged against. */
export type ReferralCycleState = {
  consumed: boolean;
  predecessorId?: string;
  successorId?: string;
};
/** The outcome of computing a referral continuation: a resolved endpoint, or a refusal. */
export type ContinuedWindowEnd = { status: "bounded"; endInstant: Temporal.Instant; elapsedSeconds: number } | { status: "refused"; reason: "invalid-days" | "already-consumed" };
/** Resolves a referral continuation: the acceptance instant plus `N` days of elapsed seconds. */
export function continuedWindowEnd(input: { acceptedAt: Temporal.Instant; days: number; cycle: ReferralCycleState }): ContinuedWindowEnd {
  const { acceptedAt, days, cycle } = input;
  if (!Number.isSafeInteger(days) || days <= 0) {
    return { status: "refused", reason: "invalid-days" };
  }
  if (cycle.consumed || cycle.successorId !== undefined) {
    return { status: "refused", reason: "already-consumed" };
  }
  const elapsedSeconds = days * SECONDS_PER_DAY;
  if (!Number.isSafeInteger(elapsedSeconds)) {
    return { status: "refused", reason: "invalid-days" };
  }
  try {
    const endInstant = acceptedAt.add({ seconds: elapsedSeconds });
    return { status: "bounded", endInstant, elapsedSeconds };
  } catch {
    // Only a duration beyond the representable instant range can reach this, which no stored policy
    // produces; it is refused rather than thrown so a caller still presents a value.
    return { status: "refused", reason: "invalid-days" };
  }
}
/** The outcome of computing a coaching share cutoff: the exclusive cutoff instant, or a refusal. */
export type ShareCutoff =
  | {
      status: "bounded";
      cutoffInstant: Temporal.Instant;
      limitedBy: "source";
      sourceLimitInstant: Temporal.Instant;
      shareThroughCutoffInstant: Temporal.Instant;
    }
  | { status: "bounded"; cutoffInstant: Temporal.Instant; limitedBy: "share-through" }
  | { status: "refused"; reason: WindowRefusalReason };
/** Resolves a coaching share cutoff: the exclusive start of the civil day after the chosen Share-through date, in the source-approved zone. */
export function shareCutoff(input: { shareThroughDate: CivilDate; frozenZone: string; sourceLimit?: Temporal.Instant }): ShareCutoff {
  const { shareThroughDate, frozenZone, sourceLimit } = input;
  const dayAfterSharedDate = addCivilDays(shareThroughDate, 1);
  if (dayAfterSharedDate === undefined) {
    return { status: "refused", reason: "invalid-date" };
  }
  const shareThroughCutoff = startOfCivilDay(dayAfterSharedDate, frozenZone);
  if (shareThroughCutoff.status === "refused") {
    return { status: "refused", reason: "invalid-zone" };
  }
  const cutoffInstant = shareThroughCutoff.instant;
  if (sourceLimit !== undefined && Temporal.Instant.compare(sourceLimit, cutoffInstant) < 0) {
    return {
      status: "bounded",
      cutoffInstant: sourceLimit,
      limitedBy: "source",
      sourceLimitInstant: sourceLimit,
      shareThroughCutoffInstant: cutoffInstant,
    };
  }
  return { status: "bounded", cutoffInstant, limitedBy: "share-through" };
}
/** Reads back the Share-through civil day a frozen coaching cutoff implies, in the zone it was frozen in: the inverse of {@link shareCutoff}. */
export function shareThroughDateOfCutoff(input: { cutoffInstant: Temporal.Instant; frozenZone: string }): CivilDate | null {
  const dayOfCutoff = civilDateAt(input.cutoffInstant, input.frozenZone);
  if (dayOfCutoff.status === "refused") {
    return null;
  }
  return addCivilDays(dayOfCutoff.date, -1) ?? null;
}
/** Whether a coach's read inside an admitted module is open at one instant. */
export type ShareWindowStatus = { status: "open" } | { status: "closed"; reason: "cutoff-reached" };
/** Judges whether a share window is open at `now`: open while `now` is strictly before the cutoff, and closed from the cutoff instant onwards, because a read at the cutoff is denied. */
export function shareWindowOpenAt(input: { cutoffInstant: Temporal.Instant; now: Temporal.Instant }): ShareWindowStatus {
  return isStrictlyBefore(input.now, input.cutoffInstant) ? { status: "open" } : { status: "closed", reason: "cutoff-reached" };
}
/** The outcome of checking the notification usefulness window at one instant. */
export type NotificationDeadlineResult =
  | {
      status: "within-usefulness";
      deadlineInstant: Temporal.Instant;
      remainingMilliseconds: number;
    }
  | { status: "past-usefulness"; deadlineInstant: Temporal.Instant };
/** Checks whether an immediate notification request is still useful at `now`, counted in elapsed hours from the instant it was intended for (`NOTIFICATION_USEFULNESS_HOURS`). */
export function notificationDeadline(input: { intendedAt: Temporal.Instant; now: Temporal.Instant }): NotificationDeadlineResult {
  const deadline = elapsedDeadlineAt(input.intendedAt, NOTIFICATION_USEFULNESS_HOURS, input.now);
  return deadline.within
    ? {
        status: "within-usefulness",
        deadlineInstant: deadline.deadlineInstant,
        remainingMilliseconds: deadline.remainingMilliseconds,
      }
    : { status: "past-usefulness", deadlineInstant: deadline.deadlineInstant };
}
/** The outcome of checking the confirmation window at one instant. */
export type ConfirmationDeadlineResult = { status: "within-window"; deadlineInstant: Temporal.Instant; remainingMilliseconds: number } | { status: "expired"; deadlineInstant: Temporal.Instant };
/** Checks whether an accepted membership confirmation is still open at `now`, counted in elapsed hours from the acceptance instant (`CONFIRMATION_WINDOW_HOURS`). */
export function confirmationDeadline(input: { acceptedAt: Temporal.Instant; now: Temporal.Instant }): ConfirmationDeadlineResult {
  const deadline = elapsedDeadlineAt(input.acceptedAt, CONFIRMATION_WINDOW_HOURS, input.now);
  return deadline.within
    ? {
        status: "within-window",
        deadlineInstant: deadline.deadlineInstant,
        remainingMilliseconds: deadline.remainingMilliseconds,
      }
    : { status: "expired", deadlineInstant: deadline.deadlineInstant };
}
