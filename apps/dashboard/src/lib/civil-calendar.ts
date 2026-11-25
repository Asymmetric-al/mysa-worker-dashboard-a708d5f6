import { Temporal } from "temporal-polyfill";

/** Pure civil-date calendar utilities built on `Temporal.PlainDate` so Date Selector and Agenda Calendar share one timezone-exact model. */

export type CivilMonth = {
  readonly year: number;
  readonly month: number; // 1-12
};

export type CalendarDayCell = {
  readonly iso: string;
  readonly day: number;
  readonly inMonth: boolean;
  readonly year: number;
  readonly month: number;
};

export type CivilDateRange = {
  readonly from: string;
  readonly to: string;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

/** Parses an ISO civil date (`YYYY-MM-DD`) strictly, returning `null` for non-existent dates like Feb 30. */
export function parseIsoCivilDate(value: string): Temporal.PlainDate | null {
  const trimmed = value.trim();
  if (!ISO_DATE_RE.test(trimmed)) return null;
  try {
    const parsed = Temporal.PlainDate.from(trimmed);
    return parsed.withCalendar("iso8601").toString() === trimmed ? parsed : null;
  } catch {
    return null;
  }
}

/** Validates a pair of civil dates (`from <= to`), returning structured error text when invalid. */
export function validateCivilDateRange(fromText: string, toText: string): { readonly ok: true; readonly range: CivilDateRange } | { readonly ok: false; readonly message: string } {
  const from = parseIsoCivilDate(fromText);
  const to = parseIsoCivilDate(toText);
  if (from === null || to === null) {
    return { ok: false, message: "Enter both start and end dates in YYYY-MM-DD format." };
  }
  if (Temporal.PlainDate.compare(from, to) > 0) {
    return { ok: false, message: "The start date must be on or before the end date." };
  }
  return { ok: true, range: { from: from.toString(), to: to.toString() } };
}

/** Shifts a civil month by `deltaMonths` (positive or negative). */
export function shiftCivilMonth(month: CivilMonth, deltaMonths: number): CivilMonth {
  const first = Temporal.PlainDate.from({ year: month.year, month: month.month, day: 1 });
  const moved = first.add({ months: deltaMonths });
  return { year: moved.year, month: moved.month };
}

/** Extracts the `CivilMonth` containing an ISO civil date string, or falls back to a safe reference month. */
export function monthFromIsoDate(iso: string | undefined, fallback: CivilMonth): CivilMonth {
  if (iso === undefined) return fallback;
  const parsed = parseIsoCivilDate(iso);
  return parsed === null ? fallback : { year: parsed.year, month: parsed.month };
}

/**
 * Builds a 42-day (6-week) civil calendar grid starting on Monday (ISO weekday 1) or Sunday (7).
 * Every cell holds a real `Temporal.PlainDate` ISO string with zero local-timezone conversion.
 */
export function buildCivilMonthGrid(month: CivilMonth, weekStartsOn: "monday" | "sunday" = "sunday"): readonly CalendarDayCell[] {
  const firstOfMonth = Temporal.PlainDate.from({ year: month.year, month: month.month, day: 1 });
  // Temporal dayOfWeek: 1 = Monday .. 7 = Sunday
  const offset = weekStartsOn === "monday" ? firstOfMonth.dayOfWeek - 1 : firstOfMonth.dayOfWeek % 7;
  const gridStart = firstOfMonth.subtract({ days: offset });
  const cells: CalendarDayCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const current = gridStart.add({ days: index });
    cells.push({
      iso: current.toString(),
      day: current.day,
      inMonth: current.year === month.year && current.month === month.month,
      year: current.year,
      month: current.month,
    });
  }
  return cells;
}

/** Localized month + year label formatted in UTC noon so the civil month never shifts across zones. */
export function formatCivilMonthTitle(month: CivilMonth, locale?: string): string {
  try {
    const sample = new Date(Date.UTC(month.year, month.month - 1, 15, 12, 0, 0));
    return new Intl.DateTimeFormat(locale || "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(sample);
  } catch {
    return `${String(month.year)}-${String(month.month).padStart(2, "0")}`;
  }
}

/** Localized short weekday headings matching `buildCivilMonthGrid`. */
export function weekdayLabels(locale?: string, weekStartsOn: "monday" | "sunday" = "sunday"): readonly string[] {
  // 2024-01-07 is a Sunday; 2024-01-08 is a Monday.
  const baseDay = weekStartsOn === "sunday" ? 7 : 8;
  try {
    const formatter = new Intl.DateTimeFormat(locale || "en-US", { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(Date.UTC(2024, 0, baseDay + index, 12, 0, 0))));
  } catch {
    return weekStartsOn === "sunday" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  }
}

/** Whether `iso` lies inclusively within `[from, to]`. */
export function isDateInRange(iso: string, from: string | null, to: string | null): boolean {
  if (from === null || to === null) return false;
  return iso >= from && iso <= to;
}
