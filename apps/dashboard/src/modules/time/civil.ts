/**
 * Civil-date vocabulary for the worker dashboard: the single place a calendar date is named,
 * parsed, stored and converted, so a due date never becomes a fabricated midnight and a
 * display-zone change never rebases a stored date. Civil dates stay civil.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Time modules" row (location `src/modules/time/*`), the 0.9.1 tree, and the 0.11.1
 *   row `modules/time/{clock,civil,window,recurrence}.ts`.
 * - AAP 0.8.2: "due dates are civil dates, not fabricated midnights"; due dates "remain civil
 *   dates and display-zone changes never rebase a series".
 * - AAP 0.8.3: a referral records its original introduction date with `datePrecision` of `date`,
 *   `approximate` or `unknown`, and unknown or approximate evidence produces no deadline, no
 *   Active/Expired judgement and no Continue action.
 * - AAP 0.6.2 record fields this vocabulary types: `TaskRecord.dueOn` with `plannedTime` and
 *   `timeZone`, `InteractionRecord.occurredOn` with `precision`, and
 *   `ReferralCycle.originalIntroductionOn` with `datePrecision` and `sourceZone`.
 * - AAP 0.8.6 direction rules: direction is a document property, mixed-direction values are
 *   isolated at the component layer, and no bidi control character is ever saved into content.
 *
 * This module is framework-free: it reads no clock and never imports one (the instant arrives as a
 * parameter), imports no store, data service, component or feature, and produces no display text.
 */
import { Temporal } from "temporal-polyfill";

/**
 * A single day in the ISO 8601 calendar, carrying no zone, no time of day and no instant behind it.
 *
 * A civil date becomes an instant only through `startOfCivilDay`, and only at the two places the
 * domain genuinely persists one: the referral window endpoint and the coaching share cutoff.
 */
export type CivilDate = Temporal.PlainDate;

/**
 * How precisely a recorded date is known: the three precisions a referral introduction, a logged
 * interaction and every other recorded date may carry. Declared here and nowhere else, so a second
 * precision union cannot drift from this one — and declared in a runtime form, so a stored record's
 * schema is derived from this list instead of restating its members.
 */
export const DATE_PRECISIONS = ["date", "approximate", "unknown"] as const;

/** One date precision, derived from {@link DATE_PRECISIONS}. */
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/** The outcome of reading a stored or source-supplied date string. */
export type ParsedCivilDate =
  | { status: "parsed"; date: CivilDate }
  | { status: "refused"; reason: "invalid-date" };

/** The outcome of reading the calendar day an instant falls on in a named zone. */
export type ZonedCivilDate =
  | { status: "resolved"; date: CivilDate }
  | { status: "refused"; reason: "invalid-zone" };

/** The outcome of resolving the first instant of a civil day in a named zone. */
export type CivilDayStart =
  | {
      status: "resolved";
      instant: Temporal.Instant;
      resolution: "aligned" | "gap-shifted" | "overlap-earlier";
    }
  | { status: "refused"; reason: "invalid-zone" };

/** Midnight as a plain time: the wall time `startOfCivilDay` resolves, never a stored value. */
const MIDNIGHT = Temporal.PlainTime.from("00:00");

/**
 * The instant the zone-resolvability probe converts.
 *
 * Whether an identifier names a time zone does not depend on the instant it is resolved at, so the
 * probe uses the epoch rather than reading a clock this module must never read.
 */
const ZONE_PROBE_INSTANT: Temporal.Instant = Temporal.Instant.fromEpochMilliseconds(0);

/**
 * The one accepted storage form: four-digit year, two-digit month, two-digit day, nothing else.
 *
 * A pattern rather than the parser alone, because Temporal's date parser also accepts a date-time
 * string without an offset, a basic-format date and an expanded-year date — each of which would
 * lose or invent the precision this module exists to keep.
 */
const STORED_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Whether a recorded precision is deadline-grade: true only for "date".
 *
 * "approximate" and "unknown" produce no deadline, no Active/Expired judgement and no Continue
 * action anywhere, so every consumer of a recorded date consults this gate before computing a
 * window. A referral introduced on an approximate or unknown date stays undecided rather than
 * acquiring a boundary it never earned.
 */
export function isPreciseDate(precision: DatePrecision): boolean {
  return precision === "date";
}

/**
 * Reads a stored or source-supplied `YYYY-MM-DD` value.
 *
 * Refuses rather than throws, because the value is untrusted source data and the service maps a
 * refusal to the `invalid` outcome. A date-time string is refused rather than truncated: precision
 * is the point, so a time part is never dropped silently.
 */
export function parseCivilDate(value: string): ParsedCivilDate {
  if (!STORED_DATE_PATTERN.test(value)) {
    return { status: "refused", reason: "invalid-date" };
  }

  try {
    const date = Temporal.PlainDate.from(value);
    // A day past the end of its month would be adjusted by the calendar, so the value read back
    // would not be the value supplied; refusing keeps the reading honest.
    if (serialiseCivilDate(date) !== value) {
      return { status: "refused", reason: "invalid-date" };
    }
    return { status: "parsed", date };
  } catch {
    return { status: "refused", reason: "invalid-date" };
  }
}

/**
 * Writes a civil date in the storage form: `YYYY-MM-DD`, no locale, no zone, no offset.
 *
 * This is a storage form, not a display format; rendering a date for a reader belongs to the
 * component layer. A calendar annotation is dropped, because the stored value carries a day, not a
 * calendar system.
 */
export function serialiseCivilDate(date: CivilDate): string {
  return date.withCalendar("iso8601").toString();
}

/** The one conversion both exported readers share: an instant to its day in a named zone. */
function resolveCivilDateAt(instant: Temporal.Instant, timeZone: string): ZonedCivilDate {
  try {
    const date = instant.toZonedDateTimeISO(timeZone).toPlainDate();
    return { status: "resolved", date };
  } catch {
    // A zone identifier Temporal cannot resolve is the only refusal this conversion has, since the
    // instant is already valid and resolving it has no other failure mode.
    return { status: "refused", reason: "invalid-zone" };
  }
}

/**
 * Reads the calendar day an instant falls on in a named zone.
 *
 * Used only where the domain genuinely holds an instant — a recorded activity, an already resolved
 * window endpoint — never to give a stored civil date a time.
 */
export function civilDateAt(instant: Temporal.Instant, timeZone: string): ZonedCivilDate {
  return resolveCivilDateAt(instant, timeZone);
}

/**
 * Reads "today" in a declared zone from the clock instant it is given.
 *
 * The instant is a parameter on purpose: only the clock module may read a clock, so naming this
 * case here keeps every call site unable to read one itself while sharing `civilDateAt`'s
 * resolution.
 */
export function todayInZone(timeZone: string, now: Temporal.Instant): ZonedCivilDate {
  return resolveCivilDateAt(now, timeZone);
}

/**
 * Whether this runtime resolves a time-zone identifier.
 *
 * A request that names a zone this runtime cannot resolve is a request-level defect, not an outage:
 * the browser transport asks this question and refuses the request by field before any read runs, so
 * a read is never left judging a day in a zone the caller did not ask for. The question is put to the
 * one conversion every reader uses, so this answer cannot disagree with the one a read would get.
 */
export function isResolvableTimeZone(timeZone: string): boolean {
  return resolveCivilDateAt(ZONE_PROBE_INSTANT, timeZone).status === "resolved";
}

/**
 * Resolves the first instant of a civil day in a named zone, disclosing how midnight resolved.
 *
 * A missing midnight moves forward to the first valid instant after the gap ("gap-shifted"), and a
 * repeated midnight takes the earlier offset ("overlap-earlier"), so a caller can show the instant
 * it actually got instead of the one it assumed. Verified vectors:
 * - gap: America/Santiago, 2026-09-06 — midnight is skipped and the clock resumes at 01:00, so the
 *   day starts at 2026-09-06T04:00:00Z, reported as "gap-shifted".
 * - overlap: America/Havana, 2026-11-01 — midnight occurs at -04:00 and repeats at -05:00, so the
 *   day starts at 2026-11-01T04:00:00Z, reported as "overlap-earlier".
 *
 * This function exists for exactly the two places the domain stores an instant derived from a civil
 * date — the referral window endpoint and the coaching share cutoff — and both persist the resolved
 * instant rather than recomputing it, so a later settings, travel or timezone-data change cannot
 * move an endpoint that was already recorded.
 */
export function startOfCivilDay(date: CivilDate, timeZone: string): CivilDayStart {
  const midnight = date.withCalendar("iso8601").toPlainDateTime(MIDNIGHT);
  let earlier: Temporal.ZonedDateTime;
  let later: Temporal.ZonedDateTime;
  try {
    earlier = midnight.toZonedDateTime(timeZone, { disambiguation: "earlier" });
    later = midnight.toZonedDateTime(timeZone, { disambiguation: "later" });
  } catch {
    return { status: "refused", reason: "invalid-zone" };
  }

  // A skipped wall time reads back as a different wall time, which is what a gap looks like here;
  // the day then starts at the first valid instant after it, the later of the two readings.
  if (Temporal.PlainDateTime.compare(earlier.toPlainDateTime(), midnight) !== 0) {
    return { status: "resolved", instant: later.toInstant(), resolution: "gap-shifted" };
  }

  // A repeated wall time reads back unchanged yet lands on two instants; the earlier offset is the
  // start of the day, and the second occurrence is not a second start.
  if (Temporal.Instant.compare(earlier.toInstant(), later.toInstant()) !== 0) {
    return { status: "resolved", instant: earlier.toInstant(), resolution: "overlap-earlier" };
  }

  return { status: "resolved", instant: earlier.toInstant(), resolution: "aligned" };
}
