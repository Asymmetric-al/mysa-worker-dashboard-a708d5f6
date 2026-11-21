/**
 * The fixed time boundaries of the worker dashboard: the referral New window, the referral
 * continuation window, the coaching share cutoff, the notification usefulness window and the
 * confirmation window. Every boundary is a pure function of `(input, now)`, evaluated at read or
 * command time; there is no scheduler.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Time modules" fixes the exported names `newWindowEnd`, `continuedWindowEnd`,
 *   `shareCutoff`, `notificationDeadline` and `confirmationDeadline`, and AAP 0.9.2 names this file
 *   as the four window functions whose boundary semantics 0.8.7 fixes.
 * - AAP 0.7.2 "The controllable local clock": the referral New-window end and the Active/Expired
 *   judgement are evaluated at every referral read and every referral command, the continuation end
 *   at the Continue command and later referral reads, the coaching share cutoff at every coach read
 *   and every module mutation, the notification usefulness window at the notification request and
 *   any retry attempt, and the confirmation window at the confirmation command. Nothing observes
 *   the clock in the background, which is what makes each boundary assertable at exact equality.
 * - AAP 0.8.7 "Fixed values and Boundary semantics" is the authoritative table for every quantity
 *   and equality rule stated below.
 * - AAP 0.8.3 (referral New and Continued windows), 0.8.4 (coaching share cutoff), 0.8.5
 *   (notification and confirmation), criterion 15 (a DST case, the exclusive endpoint at the exact
 *   instant, the racing second Continue) and criterion 10 (both elapsed windows at exact equality).
 *
 * Layering: a framework-free domain module, importable from either side of the data service. Its
 * only imports are the default `temporal-polyfill` entrypoint and the sibling civil-date
 * vocabulary, so it reaches no store, data service, component, feature or clock. `now` is always a
 * parameter: a call site that omits it does not compile, and this module therefore cannot read a
 * clock of its own. Every zone arrives explicitly, so nothing here depends on the machine's default
 * zone, nothing is random, nothing does I/O, and no stored value is formatted for a reader —
 * rendering a boundary for a person belongs to the component layer.
 */
import { Temporal } from "temporal-polyfill";
import {
  type CivilDate,
  type CivilDayStart,
  type DatePrecision,
  isPreciseDate,
  startOfCivilDay,
} from "./civil";

/**
 * How long an immediate notification stays useful after the instant it was intended for: a whole
 * number of elapsed hours. This is the single declaration of that quantity, so no surface, retry
 * path or message copy carries its own copy of it.
 */
export const NOTIFICATION_USEFULNESS_HOURS = 24;

/**
 * How long an accepted membership confirmation stays open: a whole number of elapsed hours, one
 * week. This is the single declaration of that quantity, so no surface, resend path or message copy
 * carries its own copy of it.
 */
export const CONFIRMATION_WINDOW_HOURS = 168;

/**
 * Seconds in one elapsed day, used only as the multiplier that turns a continuation's days into
 * elapsed seconds.
 *
 * Internal rather than exported, and never used to move a civil date or a zoned wall clock: a day
 * is this many seconds only in elapsed time, while a calendar day in a zone is sometimes an hour
 * shorter or longer. Keeping it unexported stops a caller reaching for it as a calendar-day length.
 */
const SECONDS_PER_DAY = 86_400;

/**
 * How a resolved civil midnight is reported, taken from the civil module's own union so this
 * declaration cannot drift from the one that produces it.
 */
export type MidnightResolution = Extract<CivilDayStart, { status: "resolved" }>["resolution"];

/**
 * Why a boundary could not be computed. A refusal is a value, never an exception: the caller
 * presents the reason instead of catching a thrown error, and no boundary is ever guessed in place
 * of the one that could not be computed.
 *
 * - `invalid-days`: the duration is not a positive whole number of days, or the instant it implies
 *   is outside the representable range.
 * - `invalid-zone`: a zone identifier Temporal cannot resolve.
 * - `invalid-date`: the civil-date arithmetic leaves the representable calendar, which only an
 *   absurd stored date can reach.
 */
export type WindowRefusalReason = "invalid-days" | "invalid-zone" | "invalid-date";

/**
 * The English month names used to state a nominal boundary in words.
 *
 * A fixed table rather than a locale-aware formatter: this wording is the nominal statement of
 * record that a boundary read discloses alongside the resolved instant, so it must be identical on
 * every machine and in every process, and it must never consult the machine's locale. A reader's
 * own language renders `nominalLastIncludedOn` at the component layer instead.
 */
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

/** The twelve keys of the month table, so the lookup below is total rather than index-guarded. */
type MonthNumber = keyof typeof MONTH_NAMES;

/**
 * States a nominal boundary in words, including its year so a window that crosses a year boundary
 * is unambiguous.
 *
 * Plain text only, with no bidi control characters, so the same string is safe to show, store or
 * export in either writing direction.
 */
function nominalWordingFor(date: CivilDate): string {
  const isoDate = date.withCalendar("iso8601");
  // A Temporal plain date's ISO month is always 1..12, so the lookup cannot miss; the assertion
  // states that invariant instead of adding a fallback label that could never be the right month.
  const monthName = MONTH_NAMES[isoDate.month as MonthNumber];
  return `Active through ${isoDate.day} ${monthName} ${isoDate.year}`;
}

/**
 * Whether `now` has not yet reached `boundary`: the single comparison behind every equality rule in
 * this module.
 *
 * Strictly-before is stated once because each boundary closes at exact equality, and a second
 * comparison written elsewhere could quietly reopen one of them.
 */
function isStrictlyBefore(now: Temporal.Instant, boundary: Temporal.Instant): boolean {
  return Temporal.Instant.compare(now, boundary) < 0;
}

/** The one elapsed-deadline computation's outcome, before a caller gives it its own vocabulary. */
type ElapsedDeadline = {
  deadlineInstant: Temporal.Instant;
  within: boolean;
  remainingMilliseconds: number;
};

/**
 * The single elapsed-deadline computation, shared by the notification usefulness window and the
 * confirmation window.
 *
 * The deadline is an instant plus a whole number of hours. An instant carries no zone, so adding
 * hours is elapsed time by definition and never a calendar-day step that a DST change could make
 * an hour short or long. `remainingMilliseconds` is exact integer subtraction of two epoch
 * millisecond counts, and it is reported only while the deadline is still ahead, so a caller
 * cannot present a negative remainder as time left.
 */
function elapsedDeadlineAt(
  anchor: Temporal.Instant,
  hours: number,
  now: Temporal.Instant,
): ElapsedDeadline {
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

/**
 * Moves a civil date by a whole number of calendar days, refusing rather than throwing when the
 * result leaves the representable calendar.
 */
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
  /**
   * The last date the nominal rule includes: `D + N - 1` for an original date `D` and a period of
   * `N` calendar days, because `D` is day one.
   */
  nominalLastIncludedOn: CivilDate;
  /** The same statement in plain words, for disclosure next to the resolved instant. */
  nominalWording: string;
  /** The exclusive endpoint instant: the referral is expired from this instant onwards. */
  resolvedEndInstant: Temporal.Instant;
  /** How the endpoint's midnight resolved in the source zone. */
  resolution: MidnightResolution;
  /**
   * Whether the resolved instant's local wall-clock date and time differ from the nominal midnight.
   *
   * True when a gap moved the start of the day forward, or when the endpoint date itself does not
   * exist in the zone, so the caller can disclose both readings: the resolved instant is the
   * authority and the nominal wording is what a person would say.
   */
  nominalDisagreesWithResolved: boolean;
};

/**
 * The outcome of computing a referral New window: a resolved exclusive endpoint, no deadline at
 * all, or a refusal with its reason.
 */
export type NewWindowEnd =
  | BoundedNewWindow
  | { status: "no-deadline"; reason: "imprecise-date" }
  | { status: "refused"; reason: WindowRefusalReason };

/**
 * Resolves a referral's New window: `N` calendar days counted from the original introduction date
 * in the accepted source zone.
 *
 * The rule, in the AAP's own terms: `D` is day one, so the last nominal included date is
 * `D + N - 1` and the endpoint is exclusive — the first valid instant starting `D + N`. At that
 * instant the referral is expired, not active. Midnight resolves through the civil module, which
 * applies the one DST rule set: a missing midnight uses the first valid instant after the gap, a
 * repeated midnight uses the earlier offset, and a skipped date uses the next existing date.
 *
 * An approximate or unknown introduction date produces no deadline and no Active/Expired judgement
 * at all, so no consumer can derive one from a date the evidence never earned.
 *
 * The caller **persists `resolvedEndInstant`**: this function is evaluated once, when the window is
 * recorded, and the stored instant is never recomputed, so later travel, display-settings or
 * timezone-data changes cannot move a deadline that has already been resolved.
 *
 * Verified vectors, asserted by the domain tests:
 * - gap: `America/Santiago`, endpoint date 2026-09-06 — midnight is skipped and the clock resumes
 *   at 01:00 -03:00, resolving to `2026-09-06T04:00:00Z` with `resolution: "gap-shifted"`.
 * - repeated midnight: `America/Havana`, endpoint date 2026-11-01 — midnight occurs at -04:00 and
 *   repeats at -05:00, resolving to `2026-11-01T04:00:00Z` with `resolution: "overlap-earlier"`.
 * - skipped date: `Pacific/Apia`, endpoint date 2011-12-30 — the date does not exist in the zone,
 *   resolving to the start of the next existing date, `2011-12-30T10:00:00Z`.
 * - plain: original date 2026-11-20, `N = 14`, `UTC` — last nominal included date 2026-12-03 and
 *   endpoint `2026-12-04T00:00:00Z`, with `nominalDisagreesWithResolved: false`.
 */
export function newWindowEnd(input: {
  originalIntroductionOn: CivilDate;
  datePrecision: DatePrecision;
  sourceZone: string;
  days: number;
}): NewWindowEnd {
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
    nominalDisagreesWithResolved:
      Temporal.PlainDateTime.compare(resolvedLocal, nominalMidnight) !== 0,
  };
}

/**
 * Where a referral stands at one instant: Active, Expired, undecided because it has no deadline, or
 * refused because the window it carries could not be evaluated.
 */
export type ReferralWindowStatus =
  | { status: "active" }
  | { status: "expired" }
  | { status: "no-deadline" }
  | { status: "refused"; reason: WindowRefusalReason };

/**
 * Judges a referral at `now`.
 *
 * Active while `now` is strictly before the endpoint and Expired from the endpoint onwards: at the
 * endpoint instant itself the referral is expired, not active. A referral without a deadline can
 * never be judged, so no feature or reader computes this itself.
 *
 * `windowEnd` is the referral's resolved exclusive endpoint, or `undefined` when it has no deadline
 * — which is what an approximate or unknown introduction date leaves behind, and also what a
 * refused `newWindowEnd` leaves behind once its caller has presented that refusal. A command path
 * narrows its resolution and forwards the endpoint, passing `undefined` in place of that refusal.
 */
export function referralWindowState(input: {
  windowEnd: Temporal.Instant | undefined;
  now: Temporal.Instant;
}): ReferralWindowStatus {
  const { windowEnd, now } = input;
  if (windowEnd === undefined) {
    return { status: "no-deadline" };
  }
  return isStrictlyBefore(now, windowEnd) ? { status: "active" } : { status: "expired" };
}

/**
 * The consumed-cycle state a referral continuation is judged against.
 *
 * `predecessorId` names the cycle this one continues and `successorId` names the cycle it produced,
 * so one cycle can be shown both as continuing something and as already continued.
 */
export type ReferralCycleState = {
  consumed: boolean;
  predecessorId?: string;
  successorId?: string;
};

/** The outcome of computing a referral continuation: a resolved endpoint, or a refusal. */
export type ContinuedWindowEnd =
  | { status: "bounded"; endInstant: Temporal.Instant; elapsedSeconds: number }
  | { status: "refused"; reason: "invalid-days" | "already-consumed" };

/**
 * Resolves a referral continuation: the acceptance instant plus `N` days of elapsed seconds.
 *
 * Elapsed seconds, never calendar days: the endpoint is counted from the instant the continuation
 * was accepted, so a DST change inside the continuation cannot make it an hour short or long. That
 * is why the addition is an instant addition — adding days to a zoned date-time would be 23 or 25
 * hours across a transition.
 *
 * At most one successor exists per consumed cycle, even under a race: a cycle already marked
 * consumed, or already naming its successor, is refused, so two racing Continue actions cannot
 * produce two successors. A continuation also only ever begins with a deliberate Continue, so
 * re-enabling the continuation policy never auto-renews an expired cycle.
 */
export function continuedWindowEnd(input: {
  acceptedAt: Temporal.Instant;
  days: number;
  cycle: ReferralCycleState;
}): ContinuedWindowEnd {
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

/**
 * The outcome of computing a coaching share cutoff: the exclusive cutoff instant, or a refusal.
 *
 * When the source imposes an earlier limit than the Share-through date does, `limitedBy` is
 * `"source"` and both instants are returned, so the surface can show which limit produced the
 * cutoff. Otherwise `limitedBy` is `"share-through"` and the cutoff is the Share-through date's own
 * day-after start.
 */
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

/**
 * Resolves a coaching share cutoff: the exclusive start of the civil day after the chosen
 * Share-through date, in the source-approved zone.
 *
 * The cutoff is exclusive, so the whole Share-through date stays readable and a read at the cutoff
 * instant is denied. It is frozen at acceptance — the caller persists `cutoffInstant` and never
 * recomputes it — so travel, a display-timezone change or a later settings change cannot move it,
 * and expiry denies new reads at the cutoff even if a stored status row still says active.
 *
 * An earlier limit the source itself imposes wins, and is returned alongside the Share-through
 * cutoff so the surface can show which limit decided instead of presenting the date as the reason.
 */
export function shareCutoff(input: {
  shareThroughDate: CivilDate;
  frozenZone: string;
  sourceLimit?: Temporal.Instant;
}): ShareCutoff {
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

/** Whether a coach's read inside an admitted module is open at one instant. */
export type ShareWindowStatus = { status: "open" } | { status: "closed"; reason: "cutoff-reached" };

/**
 * Judges whether a share window is open at `now`: open while `now` is strictly before the cutoff,
 * and closed from the cutoff instant onwards, because a read at the cutoff is denied.
 *
 * Closed denies new reads; it never claims that information a coach already read was recalled.
 */
export function shareWindowOpenAt(input: {
  cutoffInstant: Temporal.Instant;
  now: Temporal.Instant;
}): ShareWindowStatus {
  return isStrictlyBefore(input.now, input.cutoffInstant)
    ? { status: "open" }
    : { status: "closed", reason: "cutoff-reached" };
}

/** The outcome of checking the notification usefulness window at one instant. */
export type NotificationDeadlineResult =
  | {
      status: "within-usefulness";
      deadlineInstant: Temporal.Instant;
      remainingMilliseconds: number;
    }
  | { status: "past-usefulness"; deadlineInstant: Temporal.Instant };

/**
 * Checks whether an immediate notification request is still useful at `now`, counted in elapsed
 * hours from the instant it was intended for (`NOTIFICATION_USEFULNESS_HOURS`).
 *
 * Strict at equality: a request at exactly the deadline is past usefulness, so it is rejected and
 * cannot be revived as a fresh attempt; only a request strictly before the deadline is within
 * usefulness, and `remainingMilliseconds` states how much of the window is left. The deadline is a
 * function of `intendedAt` alone, so a retry, a reload or a second submit never extends it, and an
 * accepted or possibly accepted attempt is never treated as needing a new key.
 */
export function notificationDeadline(input: {
  intendedAt: Temporal.Instant;
  now: Temporal.Instant;
}): NotificationDeadlineResult {
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
export type ConfirmationDeadlineResult =
  | { status: "within-window"; deadlineInstant: Temporal.Instant; remainingMilliseconds: number }
  | { status: "expired"; deadlineInstant: Temporal.Instant };

/**
 * Checks whether an accepted membership confirmation is still open at `now`, counted in elapsed
 * hours from the acceptance instant (`CONFIRMATION_WINDOW_HOURS`).
 *
 * Strict at equality: a confirmation one millisecond before the deadline succeeds and one exactly
 * at the deadline fails, because the window is closed from the deadline instant onwards. Reloading,
 * retrying and resending never extend it, since the deadline is a function of the recorded
 * acceptance instant alone and not of the attempt.
 */
export function confirmationDeadline(input: {
  acceptedAt: Temporal.Instant;
  now: Temporal.Instant;
}): ConfirmationDeadlineResult {
  const deadline = elapsedDeadlineAt(input.acceptedAt, CONFIRMATION_WINDOW_HOURS, input.now);
  return deadline.within
    ? {
        status: "within-window",
        deadlineInstant: deadline.deadlineInstant,
        remainingMilliseconds: deadline.remainingMilliseconds,
      }
    : { status: "expired", deadlineInstant: deadline.deadlineInstant };
}
