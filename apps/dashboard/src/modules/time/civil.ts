/**
 * Civil-date vocabulary for the worker dashboard: the single place a calendar date is named, parsed,
 * stored and converted, so a due date never becomes a fabricated midnight and a display-zone change
 * never rebases a stored date. Civil dates stay civil.
 */
import { Temporal } from "temporal-polyfill";
/** A single day in the ISO 8601 calendar, carrying no zone, no time of day and no instant behind it. */
export type CivilDate = Temporal.PlainDate;
/** How precisely a recorded date is known: the three precisions a referral introduction, a logged interaction and every other recorded date may carry. */
export const DATE_PRECISIONS = ["date", "approximate", "unknown"] as const;
/** One date precision, derived from {@link DATE_PRECISIONS}. */
export type DatePrecision = (typeof DATE_PRECISIONS)[number];
/** The outcome of reading a stored or source-supplied date string. */
export type ParsedCivilDate = { status: "parsed"; date: CivilDate } | { status: "refused"; reason: "invalid-date" };
/** The outcome of reading the calendar day an instant falls on in a named zone. */
export type ZonedCivilDate = { status: "resolved"; date: CivilDate } | { status: "refused"; reason: "invalid-zone" };
/** The outcome of resolving the first instant of a civil day in a named zone. */
export type CivilDayStart =
  | {
      status: "resolved";
      instant: Temporal.Instant;
      resolution: "aligned" | "gap-shifted" | "overlap-earlier";
    }
  | { status: "refused"; reason: "invalid-zone" };
const MIDNIGHT = Temporal.PlainTime.from("00:00");

const ZONE_PROBE_INSTANT: Temporal.Instant = Temporal.Instant.fromEpochMilliseconds(0);

const STORED_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
/** Whether a recorded precision is deadline-grade: true only for "date". */
export function isPreciseDate(precision: DatePrecision): boolean {
  return precision === "date";
}
/** Reads a stored or source-supplied `YYYY-MM-DD` value. */
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
/** Writes a civil date in the storage form: `YYYY-MM-DD`, no locale, no zone, no offset. */
export function serialiseCivilDate(date: CivilDate): string {
  return date.withCalendar("iso8601").toString();
}
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
/** Reads the calendar day an instant falls on in a named zone. */
export function civilDateAt(instant: Temporal.Instant, timeZone: string): ZonedCivilDate {
  return resolveCivilDateAt(instant, timeZone);
}
/** Reads "today" in a declared zone from the clock instant it is given. */
export function todayInZone(timeZone: string, now: Temporal.Instant): ZonedCivilDate {
  return resolveCivilDateAt(now, timeZone);
}
/** Whether this runtime resolves a time-zone identifier. */
export function isResolvableTimeZone(timeZone: string): boolean {
  return resolveCivilDateAt(ZONE_PROBE_INSTANT, timeZone).status === "resolved";
}
/** Resolves the first instant of a civil day in a named zone, disclosing how midnight resolved. */
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
