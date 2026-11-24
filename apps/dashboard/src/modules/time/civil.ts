import { Temporal } from "temporal-polyfill";
export type CivilDate = Temporal.PlainDate;
export const DATE_PRECISIONS = ["date", "approximate", "unknown"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];
export type ParsedCivilDate = { status: "parsed"; date: CivilDate } | { status: "refused"; reason: "invalid-date" };
export type ZonedCivilDate = { status: "resolved"; date: CivilDate } | { status: "refused"; reason: "invalid-zone" };
export type CivilDayStart = { status: "resolved"; instant: Temporal.Instant; resolution: "aligned" | "gap-shifted" | "overlap-earlier" } | { status: "refused"; reason: "invalid-zone" };
const MIDNIGHT = Temporal.PlainTime.from("00:00");
const ZONE_PROBE_INSTANT: Temporal.Instant = Temporal.Instant.fromEpochMilliseconds(0);
const STORED_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
export const isPreciseDate = (precision: DatePrecision): boolean => precision === "date";
export function parseCivilDate(value: string): ParsedCivilDate {
  if (!STORED_DATE_PATTERN.test(value)) return { status: "refused", reason: "invalid-date" };
  try {
    const date = Temporal.PlainDate.from(value);
    return serialiseCivilDate(date) !== value ? { status: "refused", reason: "invalid-date" } : { status: "parsed", date };
  } catch {
    return { status: "refused", reason: "invalid-date" };
  }
}
export const serialiseCivilDate = (date: CivilDate): string => date.withCalendar("iso8601").toString();
export function civilDateAt(instant: Temporal.Instant, timeZone: string): ZonedCivilDate {
  try {
    const date = instant.toZonedDateTimeISO(timeZone).toPlainDate();
    return { status: "resolved", date };
  } catch {
    return { status: "refused", reason: "invalid-zone" };
  }
}
export const todayInZone = (timeZone: string, now: Temporal.Instant): ZonedCivilDate => civilDateAt(now, timeZone);
export const isResolvableTimeZone = (timeZone: string): boolean => civilDateAt(ZONE_PROBE_INSTANT, timeZone).status === "resolved";
/** Resolves the first instant of a civil day in a named zone, disclosing how midnight resolved. */ export function startOfCivilDay(date: CivilDate, timeZone: string): CivilDayStart {
  const midnight = date.withCalendar("iso8601").toPlainDateTime(MIDNIGHT);
  let earlier: Temporal.ZonedDateTime;
  let later: Temporal.ZonedDateTime;
  try {
    earlier = midnight.toZonedDateTime(timeZone, { disambiguation: "earlier" });
    later = midnight.toZonedDateTime(timeZone, { disambiguation: "later" });
  } catch {
    return { status: "refused", reason: "invalid-zone" };
  }
  if (Temporal.PlainDateTime.compare(earlier.toPlainDateTime(), midnight) !== 0) return { status: "resolved", instant: later.toInstant(), resolution: "gap-shifted" };
  return Temporal.Instant.compare(earlier.toInstant(), later.toInstant()) !== 0 ? { status: "resolved", instant: earlier.toInstant(), resolution: "overlap-earlier" } : { status: "resolved", instant: earlier.toInstant(), resolution: "aligned" };
}
