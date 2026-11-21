/**
 * `runReport` — the one financial computation in this application, and the only place a
 * received-support figure is filtered, summed, bucketed, compared or paged.
 */
import { Temporal } from "temporal-polyfill";
import type { SourceReference } from "../../lib/ids";
import type { Coverage, GiftAttribution, SupportGoalRecord, ValueState } from "../data-service/envelope";
import { addMinor, compareMinor, minorUnitsOf, negateMinor, type MinorUnits, type Money } from "../money/amount";
import { exponentOf, isKnownCurrency } from "../money/currency";
import { parseCivilDate, serialiseCivilDate, todayInZone, type CivilDate, type DatePrecision } from "../time/civil";
import { SUPPORT_BASIS, assertSingleBasis, type GiftRow, type SupportBasis, type SupportProjection } from "./basis";
import { GOAL_MEASURE, goalProgress, type GoalProgress, type GoalRecord } from "./goal";
// Paging
/** Rows a list or a report shows per page when the caller states no size. */
export const PAGE_SIZE_DEFAULT = 50;
/** The largest page this application serves; a bigger request is clamped rather than honoured. */
export const PAGE_SIZE_CAP = 200;
/** Turns any requested page size into the one the service serves: the default when none was stated, the cap when more was asked for, and never fewer than one row. */
export function clampPageSize(size?: number): number {
  if (size === undefined || !Number.isFinite(size)) {
    return PAGE_SIZE_DEFAULT;
  }
  const whole = Math.trunc(size);
  if (whole < 1) {
    return 1;
  }
  if (whole > PAGE_SIZE_CAP) {
    return PAGE_SIZE_CAP;
  }
  return whole;
}
// The four reports
/** The four fixed reports of the first release, and the whole set: `./report` computes no fifth report and this application has no report designer, no scheduled report and no report builder. */
export type ReportId = "received-period-and-year-to-date" | "monthly-history" | "partner-month-matrix" | "period-comparison";
/** The four report identities in the order every surface lists them, so a fifth cannot appear unnoticed. */
export const REPORT_IDS = ["received-period-and-year-to-date", "monthly-history", "partner-month-matrix", "period-comparison"] as const satisfies readonly ReportId[];
// Periods, currencies, sorting and paging as the caller states them
/** The five periods a caller may name instead of giving two civil dates. */
export const PERIOD_PRESETS = ["this-month", "last-month", "this-year", "last-year", "year-to-date"] as const;
/** One named period, derived from {@link PERIOD_PRESETS} so a sixth cannot be added in one place only. */
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
/** The fields a Gifts result may be sorted by. */
export const SORT_FIELDS = ["originalGiftOn", "amountMinor", "designation"] as const;
/** One sortable field, derived from {@link SORT_FIELDS}. */
export type SortField = (typeof SORT_FIELDS)[number];
/** The two directions a sort may take. */
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
/** One sort direction, derived from {@link SORT_DIRECTIONS}. */
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
/** The exact authority a report is computed under: the four references that are separately owned and never interchangeable. */
export interface ReportScope {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
  readonly principalId: string;
}
/** Which currency's amounts a report states. */
export type CurrencySelection = { readonly kind: "all" } | { readonly kind: "one"; readonly currency: string };
/** The period a report covers. */
export type ReportPeriod =
  | { readonly kind: "preset"; readonly preset: PeriodPreset }
  | { readonly kind: "explicit"; readonly from: CivilDate; readonly to: CivilDate }
  | { readonly kind: "year"; readonly year: number };
/** Which attribution a result is restricted to. */
export type ReportPartnerSelection = { readonly kind: "partner"; readonly partnerId: string } | { readonly kind: "anonymous" } | { readonly kind: "unresolved" };
/** One report request: the fixed report, the authority it runs under, the period and the filters. */
export interface ReportQuery {
  readonly reportId: ReportId;
  readonly scope: ReportScope;
  readonly period: ReportPeriod;
  readonly currency: CurrencySelection;
  readonly amountRange?: { readonly minMinor: MinorUnits; readonly maxMinor: MinorUnits };
  readonly designation?: string;
  readonly partner?: ReportPartnerSelection;
  readonly method?: string;
  readonly search?: string;
  readonly sort?: { readonly field: SortField; readonly direction: SortDirection };
  readonly page?: { readonly index: number; readonly size?: number };
  readonly timeZone?: string;
}
/** One reason a report request was refused, keyed by the field it belongs to. */
export interface ReportQueryProblem {
  readonly field: string;
  readonly message: string;
}
const SCOPE_FIELDS = ["organizationId", "ministryId", "supportSubjectId", "principalId"] as const;
/** The zone a period preset resolves in when the caller states none, so no host zone is ever used. */
export const REPORT_DEFAULT_TIME_ZONE = "UTC";

const ZONE_PROBE_INSTANT = Temporal.Instant.fromEpochMilliseconds(0);

function isResolvableZone(timeZone: string): boolean {
  return todayInZone(timeZone, ZONE_PROBE_INSTANT).status === "resolved";
}
/** Checks one report request and returns every problem it has, or an empty list when it is acceptable. */
export function validateReportQuery(query: ReportQuery): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  if (!REPORT_IDS.includes(query.reportId)) {
    problems.push({
      field: "reportId",
      message: "This application reports received support in four fixed ways. Choose one of the four identities; no other report is computed and none is substituted for an unrecognised one.",
    });
  }
  // The three structures below are checked for presence before they are read, so a request body that
  // failed to decode is answered with per-field problems rather than with a thrown fault.
  const scope: ReportScope | undefined = query.scope;
  if (typeof scope !== "object" || scope === null) {
    problems.push({
      field: "scope",
      message: "Every report runs under the four references that state its authority, and this request states none. No report is computed under an assumed context.",
    });
  } else {
    for (const field of SCOPE_FIELDS) {
      const value: string = scope[field];
      if (typeof value !== "string" || value.trim() === "") {
        problems.push({
          field: `scope.${field}`,
          message: "Every report runs under the four references that state its authority. This one is missing, and a report is never computed under an assumed context.",
        });
      }
    }
  }
  const period: ReportPeriod | undefined = query.period;
  if (typeof period !== "object" || period === null) {
    problems.push({
      field: "period",
      message: "A report covers a period, and this request states none. No period is assumed in its place.",
    });
  } else {
    problems.push(...validatePeriod(period));
  }
  const currency: CurrencySelection | undefined = query.currency;
  if (typeof currency !== "object" || currency === null) {
    problems.push({
      field: "currency",
      message: "A report states the currency or currencies its figures are in, and this request states none. No currency is assumed in its place.",
    });
  } else {
    problems.push(...validateCurrency(query));
  }
  problems.push(...validateFilters(query));
  problems.push(...validateSort(query.sort));
  problems.push(...validatePage(query.page));
  if (query.timeZone !== undefined && !isResolvableZone(query.timeZone)) {
    problems.push({
      field: "timeZone",
      message: "A period preset resolves in the zone the query names, and this zone cannot be resolved. Choose a tz database identifier; the application never substitutes the host's zone.",
    });
  }
  return problems;
}
function validatePeriod(period: ReportPeriod): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  switch (period.kind) {
    case "preset":
      if (!PERIOD_PRESETS.includes(period.preset)) {
        problems.push({
          field: "period.preset",
          message: "A preset period is one of the five this application offers. Name one of them, or state two civil dates instead.",
        });
      }
      return problems;
    case "explicit": {
      if (!isCivilDate(period.from) || !isCivilDate(period.to)) {
        problems.push({
          field: "period",
          message:
            "An explicit period is two civil dates, each a calendar day with no time of day. A date-time string is refused rather than truncated, because a truncated time would move the period's boundary.",
        });
        return problems;
      }
      if (Temporal.PlainDate.compare(period.from, period.to) > 0) {
        problems.push({
          field: "period",
          message: "The period starts after it ends, so it covers no day at all. State the earlier date first; the range is inclusive at both ends.",
        });
      }
      return problems;
    }
    case "year": {
      const year: number = period.year;
      if (!Number.isSafeInteger(year) || year < 1 || year > 9999) {
        problems.push({
          field: "period.year",
          message: "A calendar year is stated as a whole four-digit year. This value is not one, so no year's months are computed for it.",
        });
      }
      return problems;
    }
    default:
      problems.push({
        field: "period.kind",
        message: "A period is a preset, two civil dates or a calendar year. This one is none of those, so no period is assumed for it.",
      });
      return problems;
  }
}
function validateCurrency(query: ReportQuery): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  const selection: CurrencySelection = query.currency;
  const range = query.amountRange;
  if (selection.kind === "all") {
    if (range !== undefined) {
      problems.push({
        field: "amountRange",
        message:
          "An amount range compares one currency's amounts, so it needs a single selected currency. Clear the range or choose one currency; a range across currencies would compare amounts that have no ordering.",
      });
    }
    return problems;
  }
  if (selection.kind === "one") {
    if (typeof selection.currency !== "string" || selection.currency.trim() === "") {
      problems.push({
        field: "currency.currency",
        message: "A single-currency selection states the currency code. This one is empty, and no currency is assumed in its place.",
      });
    }
    if (range !== undefined) {
      if (!Number.isSafeInteger(range.minMinor) || !Number.isSafeInteger(range.maxMinor)) {
        problems.push({
          field: "amountRange",
          message:
            "An amount range states whole counts of the selected currency's minor units. A fractional or non-finite bound is refused rather than rounded, because rounding would change which rows match.",
        });
      } else if (range.minMinor > range.maxMinor) {
        problems.push({
          field: "amountRange",
          message: "The amount range starts above where it ends, so it matches nothing. State the lower bound first; both bounds are inclusive.",
        });
      }
    }
    return problems;
  }
  problems.push({
    field: "currency.kind",
    message: "A currency selection is either every currency present or one named currency. This one is neither, so no partition is assumed for it.",
  });
  return problems;
}
function validateFilters(query: ReportQuery): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  if (query.partner !== undefined) {
    const partner = query.partner;
    if (partner.kind === "partner") {
      if (typeof partner.partnerId !== "string" || partner.partnerId.trim() === "") {
        problems.push({
          field: "partner.partnerId",
          message: "A partner filter states the partner's own reference. This one is empty, and no partner is assumed in its place.",
        });
      }
    } else if (partner.kind !== "anonymous" && partner.kind !== "unresolved") {
      problems.push({
        field: "partner.kind",
        message: "An attribution filter is a partner reference, anonymous support or unattributed support. This one is none of those.",
      });
    }
  }
  if (query.designation !== undefined && query.designation.trim() === "") {
    problems.push({
      field: "designation",
      message: "A designation filter states the source's own designation. An empty one selects nothing rather than everything, so it is refused; omit the filter to read every designation.",
    });
  }
  if (query.method !== undefined) {
    problems.push({
      field: "method",
      message:
        "The support projection carries no giving-method or classification field, so a method facet cannot be applied to it. The filter is refused rather than quietly ignored, because a result that was never filtered must not be presented as a filtered one.",
    });
  }
  if (query.search !== undefined && query.search.trim() === "") {
    problems.push({
      field: "search",
      message: "A search term states the text to look for. An empty term matches every row rather than none, so it is refused; omit the search to read the whole result.",
    });
  }
  return problems;
}
function validateSort(sort: ReportQuery["sort"]): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  if (sort === undefined) {
    return problems;
  }
  if (!SORT_FIELDS.includes(sort.field)) {
    problems.push({
      field: "sort.field",
      message: "A result is sorted by the gift's own date, its amount or its designation. This field is not one of those, and no other ordering is invented for it.",
    });
  }
  if (!SORT_DIRECTIONS.includes(sort.direction)) {
    problems.push({
      field: "sort.direction",
      message: "A sort runs ascending or descending. This direction is neither, so no order is assumed.",
    });
  }
  return problems;
}
function validatePage(page: ReportQuery["page"]): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  if (page === undefined) {
    return problems;
  }
  if (!Number.isSafeInteger(page.index) || page.index < 0) {
    problems.push({
      field: "page.index",
      message: "A page index is a whole number of pages from zero. This value is not one, so no page is assumed for it.",
    });
  }
  if (page.size !== undefined && !Number.isFinite(page.size)) {
    problems.push({
      field: "page.size",
      message: "A page size is a finite number of rows. This one is not, and the default page size is not substituted for a stated one that cannot be read.",
    });
  }
  return problems;
}
/** Builds the query a report is computed from, refusing one that could produce a dishonest total. */
export function buildReportQuery(input: ReportQuery): { ok: true; query: ReportQuery } | { ok: false; problems: ReportQueryProblem[] } {
  const normalised = trimOptionalFields(input);
  const problems = validateReportQuery(normalised);
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, query: normalisePeriod(normalised) };
}
function trimOptionalFields(input: ReportQuery): ReportQuery {
  const page = input.page;
  const designation = blankToUndefined(input.designation);
  const search = blankToUndefined(input.search);
  const method = blankToUndefined(input.method);
  const timeZone = blankToUndefined(input.timeZone);
  const partner: ReportPartnerSelection | undefined =
    input.partner === undefined || input.partner === null ? undefined : input.partner.kind === "partner" ? { kind: "partner", partnerId: trimmedText(input.partner.partnerId) } : input.partner;
  return {
    reportId: input.reportId,
    scope: trimScope(input.scope),
    period: input.period,
    currency: trimCurrency(input.currency),
    ...(designation === undefined ? {} : { designation }),
    ...(search === undefined ? {} : { search }),
    ...(method === undefined ? {} : { method }),
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(partner === undefined ? {} : { partner }),
    ...(input.amountRange === undefined ? {} : { amountRange: input.amountRange }),
    ...(input.sort === undefined ? {} : { sort: input.sort }),
    ...(page === undefined || page === null ? {} : { page: { index: page.index, size: clampPageSize(page.size) } }),
  };
}
function trimmedText(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = trimmedText(value);
  return trimmed === "" ? undefined : trimmed;
}
function trimScope(scope: ReportScope): ReportScope {
  // Widened on purpose: this value arrives from a request body, so what actually arrived is compared
  // rather than the type it was declared with.
  const arrived: unknown = scope;
  if (typeof arrived !== "object" || arrived === null) {
    return scope;
  }
  return {
    organizationId: trimmedText(scope.organizationId),
    ministryId: trimmedText(scope.ministryId),
    supportSubjectId: trimmedText(scope.supportSubjectId),
    principalId: trimmedText(scope.principalId),
  };
}
function trimCurrency(currency: CurrencySelection): CurrencySelection {
  const arrived: unknown = currency;
  if (typeof arrived !== "object" || arrived === null || currency.kind !== "one") {
    return currency;
  }
  return { kind: "one", currency: trimmedText(currency.currency) };
}
function normalisePeriod(input: ReportQuery): ReportQuery {
  const period = input.period;
  if (period.kind !== "year") {
    return input;
  }
  return {
    ...input,
    period: {
      kind: "explicit",
      from: Temporal.PlainDate.from({ year: period.year, month: 1, day: 1 }),
      to: Temporal.PlainDate.from({ year: period.year, month: 12, day: 31 }),
    },
  };
}
function isCivilDate(value: unknown): value is CivilDate {
  return value instanceof Temporal.PlainDate;
}
// What a report answers
/** Whether the period a report covers has closed. */
export type PeriodState = "complete" | "in-progress";
/** One stated amount: the exact minor units and the state that says what kind of value it is. */
export interface StatedValue {
  readonly minorUnits: MinorUnits | null;
  readonly valueState: ValueState;
}
/** One stated count: how many rows there are, and the state that says what the count is a count of. */
export interface StatedCount {
  readonly count: number;
  readonly valueState: ValueState;
}
/** One currency's part of the result: its received support and its three counts, at their own grains. */
export interface CurrencySummary {
  readonly currency: string;
  readonly exponent: number | undefined;
  readonly received: StatedValue;
  readonly giftCount: StatedCount;
  readonly allocationCount: StatedCount;
  readonly donorCount: StatedCount;
}
/** One point of a currency's series: the amount the source recorded in one month bucket. */
export interface SeriesPoint {
  readonly bucketStart: CivilDate;
  readonly bucketEnd: CivilDate;
  readonly currency: string;
  readonly value: StatedValue;
  readonly gap: boolean;
}
/** One authorised allocation at its own grain, as the rows of a result. */
export interface ReportRow {
  readonly giftRowId: string;
  readonly giftId: string;
  readonly allocationId?: string;
  readonly amount: Money;
  readonly originalGiftOn?: CivilDate;
  readonly datePrecision: DatePrecision;
  readonly designation?: string;
  readonly attribution: GiftAttribution;
  readonly refundOf?: string;
  readonly provenance: SourceReference;
  readonly entryOn: CivilDate;
}
/** One cell of the partner-by-month matrix: a partner's amount in one month of one currency. */
export interface MatrixCell {
  readonly bucketStart: CivilDate;
  readonly bucketEnd: CivilDate;
  readonly currency: string;
  readonly value: StatedValue;
  readonly gap: boolean;
  readonly drilldown: ReportQuery;
}
/** One matrix row: one attribution across every month of the matrix. */
export interface MatrixRow {
  readonly partnerId?: string;
  readonly attribution: GiftAttribution;
  readonly label: string;
  readonly cells: readonly MatrixCell[];
}
/** The partner-by-month matrix: the months it covers, the currencies it is stated in and one row per attribution. */
export interface Matrix {
  readonly currencies: readonly string[];
  readonly months: readonly { readonly start: CivilDate; readonly end: CivilDate }[];
  readonly rows: readonly MatrixRow[];
}
/** One contributor's change between the two periods of a comparison. */
export interface ContributorDelta {
  readonly partnerId?: string;
  readonly attribution?: GiftAttribution;
  readonly currency: string;
  readonly minorUnits: MinorUnits;
}
/** Two periods compared, per currency, as a signed difference with the contributor changes that reconcile it. */
export interface ReportComparison {
  readonly current: { readonly from: CivilDate; readonly to: CivilDate };
  readonly baseline: { readonly from: CivilDate; readonly to: CivilDate };
  readonly equalElapsed: boolean;
  readonly perCurrency: readonly {
    readonly currency: string;
    readonly currentMinor: MinorUnits;
    readonly baselineMinor: MinorUnits;
    readonly differenceMinor: MinorUnits;
    readonly direction: "increase" | "decrease" | "unchanged";
    readonly valueState: ValueState;
  }[];
  readonly contributorDeltas: readonly ContributorDelta[];
  readonly reconciles: boolean;
}
/** The identity of the result: the query, the authority, the period, the coverage and the instant. */
export interface Snapshot {
  readonly query: ReportQuery;
  readonly scope: ReportScope;
  readonly basis: SupportBasis;
  readonly currencies: readonly string[];
  readonly period: {
    readonly from: CivilDate;
    readonly to: CivilDate;
    readonly state: PeriodState;
  };
  readonly coverage: Coverage;
  readonly asOf: string;
  readonly lastSourceUpdate: string;
  readonly source: SourceReference;
}
/** Everything one report answers for one query and one snapshot. */
export interface ReportResult {
  readonly snapshot: Snapshot;
  readonly summary: readonly CurrencySummary[];
  readonly series: readonly SeriesPoint[];
  readonly rows: readonly ReportRow[];
  readonly total: number;
  readonly page?: { readonly index: number; readonly size: number; readonly totalPages: number };
  readonly comparison?: ReportComparison;
  readonly matrix?: Matrix;
  readonly goal?: GoalProgress;
  readonly valueStates: Readonly<Record<string, ValueState>>;
}
// The computation
interface PeriodRange {
  readonly from: CivilDate;
  readonly to: CivilDate;
}
interface ResolvedPeriod extends PeriodRange {
  readonly state: PeriodState;
}
interface MonthBucket {
  readonly start: CivilDate;
  readonly end: CivilDate;
}
interface WindowedRows {
  readonly rows: readonly ReportRow[];
  readonly page?: { readonly index: number; readonly size: number; readonly totalPages: number };
}
/** Computes one report from one query and one projection — the single computation behind every financial surface in this application. */
export function runReport(query: ReportQuery, projection: SupportProjection): ReportResult {
  assertQueryGate(query);
  assertSingleBasis(projection);
  const basis: SupportBasis = SUPPORT_BASIS;
  const asOf = instantOf(projection.asOf);
  const timeZone = query.timeZone ?? REPORT_DEFAULT_TIME_ZONE;
  const today = civilTodayIn(timeZone, asOf);
  const period = resolvePeriod(query.period, today);
  const baseline = needsComparison(query.reportId) ? precedingEqualElapsed(period) : undefined;
  // One filtering pass over every authorised row, then one de-duplication at the grain. Both artifacts
  // below are derived from this same set, so a filter can never apply to one surface and not another.
  // Each surviving row's calendar day and month are then read once, because a whole-result read compares
  // a row's day on every filter and orders it on every sort comparison, and a `Temporal` date's fields
  // are not free to read.
  const searchTerm = query.search === undefined ? undefined : query.search.toLowerCase();
  const prepared = prepareRows(deduplicateAtGrain(projection.gifts.filter((row) => matchesNonDateFilters(row, query, searchTerm))), period.from);
  const current = sortPreparedRows(
    prepared.filter((row) => isWithin(row, dayKeyOf(period.from), dayKeyOf(period.to))),
    query.sort,
  );
  const baselineRows = baseline === undefined ? [] : prepared.filter((row) => isWithin(row, dayKeyOf(baseline.from), dayKeyOf(baseline.to)));
  const currencies = currenciesOf(current, query.currency);
  const summary = summarise(current, currencies, projection.coverage);
  const buckets = monthBuckets(period.from, period.to);
  const series = buildSeries(current, buckets, currencies, projection.coverage);
  const windowed = windowRows(
    current.map((row) => toReportRow(row.row)),
    query.page,
  );
  const comparison = baseline === undefined ? undefined : buildComparison({ period, baseline, coverage: projection.coverage, current, baselineRows });
  const matrix =
    query.reportId === "partner-month-matrix"
      ? buildMatrix({
          query,
          buckets,
          currencies,
          rows: current,
          coverage: projection.coverage,
        })
      : undefined;
  const goal = projection.goal === undefined ? undefined : buildGoal(projection.goal, summary, query.currency, projection.coverage);
  return {
    snapshot: {
      query,
      scope: query.scope,
      basis,
      currencies,
      period: { from: period.from, to: period.to, state: period.state },
      coverage: projection.coverage,
      asOf: projection.asOf,
      lastSourceUpdate: projection.lastSourceUpdate,
      source: projection.source,
    },
    summary,
    series,
    rows: windowed.rows,
    total: current.length,
    ...(windowed.page === undefined ? {} : { page: windowed.page }),
    ...(comparison === undefined ? {} : { comparison }),
    ...(matrix === undefined ? {} : { matrix }),
    ...(goal === undefined ? {} : { goal }),
    valueStates: collectValueStates({
      summary,
      series,
      rows: windowed.rows,
      ...(comparison === undefined ? {} : { comparison }),
      ...(matrix === undefined ? {} : { matrix }),
    }),
  };
}
function assertQueryGate(query: ReportQuery): void {
  const problems = validateReportQuery(query);
  if (problems.length === 0) {
    return;
  }
  const stated = problems.map((problem) => `${problem.field}: ${problem.message}`).join(" ");
  throw new TypeError(`runReport refuses a report query that did not pass buildReportQuery. ${stated}`);
}
function instantOf(asOf: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(asOf);
  } catch {
    throw new TypeError(`Support projection as-of value "${asOf}" is not an ISO instant, so no period can be resolved against it. The value is refused rather than replaced by a clock reading.`);
  }
}
function civilTodayIn(timeZone: string, asOf: Temporal.Instant): CivilDate {
  const resolved = todayInZone(timeZone, asOf);
  if (resolved.status === "refused") {
    throw new TypeError(`The zone "${timeZone}" cannot be resolved, so the report's period has no civil dates. The zone is refused rather than replaced by the host's.`);
  }
  return resolved.date;
}
function needsComparison(reportId: ReportId): boolean {
  return reportId === "received-period-and-year-to-date" || reportId === "period-comparison";
}
function resolvePeriod(period: ReportPeriod, today: CivilDate): ResolvedPeriod {
  const range = periodRangeOf(period, today);
  const state: PeriodState = Temporal.PlainDate.compare(range.to, today) >= 0 ? "in-progress" : "complete";
  return { from: range.from, to: range.to, state };
}
function periodRangeOf(period: ReportPeriod, today: CivilDate): PeriodRange {
  switch (period.kind) {
    case "explicit":
      return { from: period.from, to: period.to };
    case "year":
      return yearRange(period.year);
    case "preset":
      return presetRange(period.preset, today);
    default:
      throw new TypeError("The report's period is a preset, two civil dates or a calendar year, and this value is none of those. No period is assumed for it.");
  }
}
function presetRange(preset: PeriodPreset, today: CivilDate): PeriodRange {
  const monthStart = today.with({ day: 1 });
  switch (preset) {
    case "this-month":
      return { from: monthStart, to: monthStart.add({ months: 1 }).subtract({ days: 1 }) };
    case "last-month": {
      const end = monthStart.subtract({ days: 1 });
      return { from: end.with({ day: 1 }), to: end };
    }
    case "this-year":
      return yearRange(today.year);
    case "last-year":
      return yearRange(today.year - 1);
    case "year-to-date":
      return { from: yearRange(today.year).from, to: today };
    default:
      throw new TypeError(`"${String(preset)}" is not one of the five preset periods this application offers, so no period is assumed for it.`);
  }
}
function yearRange(year: number): PeriodRange {
  return {
    from: Temporal.PlainDate.from({ year, month: 1, day: 1 }),
    to: Temporal.PlainDate.from({ year, month: 12, day: 31 }),
  };
}
function precedingEqualElapsed(period: PeriodRange): PeriodRange {
  const days = daysInclusive(period.from, period.to);
  const to = period.from.subtract({ days: 1 });
  return { from: to.subtract({ days: days - 1 }), to };
}
function daysInclusive(from: CivilDate, to: CivilDate): number {
  return from.until(to, { largestUnit: "days" }).days + 1;
}
function monthBuckets(from: CivilDate, to: CivilDate): readonly MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const lastMonthStart = to.with({ day: 1 });
  let monthStart = from.with({ day: 1 });
  while (Temporal.PlainDate.compare(monthStart, lastMonthStart) <= 0) {
    const monthEnd = monthStart.add({ months: 1 }).subtract({ days: 1 });
    buckets.push({
      start: Temporal.PlainDate.compare(monthStart, from) < 0 ? from : monthStart,
      end: Temporal.PlainDate.compare(monthEnd, to) > 0 ? to : monthEnd,
    });
    monthStart = monthStart.add({ months: 1 });
  }
  return buckets;
}
function monthOffset(date: CivilDate, origin: CivilDate): number {
  return (date.year - origin.year) * 12 + (date.month - origin.month);
}
interface PreparedRow {
  readonly row: GiftRow;
  readonly dayKey: number;
  readonly monthIndex: number;
}
function dayKeyOf(date: CivilDate): number {
  return date.year * 10_000 + date.month * 100 + date.day;
}
function prepareRows(rows: readonly GiftRow[], originMonth: CivilDate): readonly PreparedRow[] {
  const prepared: PreparedRow[] = [];
  for (const row of rows) {
    const date = row.originalGiftOn;
    if (date === undefined) {
      continue;
    }
    prepared.push({ row, dayKey: dayKeyOf(date), monthIndex: monthOffset(date, originMonth) });
  }
  return prepared;
}
function isWithin(row: PreparedRow, fromKey: number, toKey: number): boolean {
  return row.dayKey >= fromKey && row.dayKey <= toKey;
}
function matchesNonDateFilters(row: GiftRow, query: ReportQuery, searchTerm: string | undefined): boolean {
  if (query.currency.kind === "one" && row.amount.currency !== query.currency.currency) {
    return false;
  }
  const range = query.amountRange;
  if (range !== undefined) {
    const amount: number = row.amount.minorUnits;
    if (amount < range.minMinor || amount > range.maxMinor) {
      return false;
    }
  }
  if (query.designation !== undefined && row.designation !== query.designation) {
    return false;
  }
  const partner = query.partner;
  if (partner !== undefined) {
    if (partner.kind === "partner") {
      if (row.attribution.kind !== "partner" || row.attribution.partnerId !== partner.partnerId) {
        return false;
      }
    } else if (row.attribution.kind !== partner.kind) {
      return false;
    }
  }
  if (searchTerm !== undefined && !matchesSearch(row, searchTerm)) {
    return false;
  }
  return true;
}
function matchesSearch(row: GiftRow, needle: string): boolean {
  const fields: readonly (string | undefined)[] = [
    row.designation,
    row.giftId,
    row.giftRowId,
    row.allocationId,
    row.provenance.system,
    row.provenance.reference,
    row.attribution.kind === "partner" ? row.attribution.partnerId : undefined,
  ];
  return fields.some((field) => field !== undefined && field.toLowerCase().includes(needle));
}
function deduplicateAtGrain(rows: readonly GiftRow[]): readonly GiftRow[] {
  const giftsWithAllocations = new Set<string>();
  for (const row of rows) {
    if (row.allocationId !== undefined) {
      giftsWithAllocations.add(row.giftId);
    }
  }
  const seen = new Set<string>();
  const kept: GiftRow[] = [];
  for (const row of rows) {
    if (seen.has(row.giftRowId)) {
      continue;
    }
    const isGiftGrainRow = row.allocationId === undefined;
    const isCorrection = row.refundOf !== undefined;
    if (isGiftGrainRow && !isCorrection && giftsWithAllocations.has(row.giftId)) {
      continue;
    }
    seen.add(row.giftRowId);
    kept.push(row);
  }
  return kept;
}
function sortPreparedRows(rows: readonly PreparedRow[], sort: ReportQuery["sort"]): readonly PreparedRow[] {
  return [...rows].sort((left, right) => compareRows(left, right, sort));
}
function compareRows(left: PreparedRow, right: PreparedRow, sort: ReportQuery["sort"]): number {
  if (sort === undefined) {
    const byDay = right.dayKey - left.dayKey;
    return byDay === 0 ? compareIdentifiers(left.row.giftRowId, right.row.giftRowId) : byDay;
  }
  const descending = sort.direction === "desc";
  const primary =
    sort.field === "originalGiftOn"
      ? signOf(left.dayKey - right.dayKey, descending)
      : sort.field === "amountMinor"
        ? signOf(compareAmounts(left.row.amount, right.row.amount), descending)
        : compareText(left.row.designation, right.row.designation, descending);
  return primary === 0 ? compareIdentifiers(left.row.giftRowId, right.row.giftRowId) : primary;
}
function compareText(left: string | undefined, right: string | undefined, descending: boolean): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return signOf(compareIdentifiers(left, right), descending);
}
function compareAmounts(left: Money, right: Money): number {
  if (left.currency !== right.currency) {
    return compareIdentifiers(left.currency, right.currency);
  }
  if (isKnownCurrency(left.currency)) {
    return compareMinor(left, right);
  }
  const leftUnits: number = left.minorUnits;
  const rightUnits: number = right.minorUnits;
  if (leftUnits === rightUnits) {
    return 0;
  }
  return leftUnits < rightUnits ? -1 : 1;
}
function signOf(order: number, descending: boolean): number {
  return descending ? -order : order;
}
function compareIdentifiers(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
// Aggregation
interface CurrencyAggregate {
  total: Money | undefined;
  readonly giftIds: Set<string>;
  allocationCount: number;
  readonly donorIds: Set<string>;
}
function currenciesOf(rows: readonly PreparedRow[], selection: CurrencySelection): readonly string[] {
  const codes = new Set<string>();
  for (const { row } of rows) {
    codes.add(row.amount.currency);
  }
  if (selection.kind === "one") {
    codes.add(selection.currency);
  }
  return [...codes].sort(compareIdentifiers);
}
function summarise(rows: readonly PreparedRow[], currencies: readonly string[], coverage: Coverage): readonly CurrencySummary[] {
  const aggregates = new Map<string, CurrencyAggregate>();
  for (const { row } of rows) {
    const currency = row.amount.currency;
    const aggregate = aggregateFor(aggregates, currency);
    if (row.allocationId !== undefined) {
      aggregate.allocationCount += 1;
    }
    aggregate.giftIds.add(row.giftId);
    if (row.attribution.kind === "partner") {
      aggregate.donorIds.add(row.attribution.partnerId);
    }
    if (isKnownCurrency(currency)) {
      aggregate.total = aggregate.total === undefined ? row.amount : addMinor(aggregate.total, row.amount);
    }
  }
  return currencies.map((currency) => {
    const aggregate = aggregates.get(currency);
    const receivedMinor: MinorUnits | null = isKnownCurrency(currency) ? (aggregate?.total?.minorUnits ?? minorUnitsOf(0)) : null;
    return {
      currency,
      exponent: exponentOf(currency),
      received: statedValue(receivedMinor, coverage),
      giftCount: statedCount(aggregate?.giftIds.size ?? 0, coverage),
      allocationCount: statedCount(aggregate?.allocationCount ?? 0, coverage),
      donorCount: statedCount(aggregate?.donorIds.size ?? 0, coverage),
    };
  });
}
function aggregateFor(aggregates: Map<string, CurrencyAggregate>, currency: string): CurrencyAggregate {
  const existing = aggregates.get(currency);
  if (existing !== undefined) {
    return existing;
  }
  const created: CurrencyAggregate = {
    total: undefined,
    giftIds: new Set<string>(),
    allocationCount: 0,
    donorIds: new Set<string>(),
  };
  aggregates.set(currency, created);
  return created;
}
function statedValue(minorUnits: MinorUnits | null, coverage: Coverage): StatedValue {
  if (minorUnits === null || coverage.state === "unknown") {
    return { minorUnits: null, valueState: "unknown" };
  }
  if (coverage.state === "partial") {
    return { minorUnits, valueState: "incomplete-subtotal" };
  }
  return minorUnits === 0 ? { minorUnits, valueState: "zero" } : { minorUnits, valueState: "value" };
}
function statedCount(count: number, coverage: Coverage): StatedCount {
  if (coverage.state === "unknown") {
    return { count, valueState: "unknown" };
  }
  if (coverage.state === "partial") {
    return { count, valueState: "incomplete-subtotal" };
  }
  return count === 0 ? { count, valueState: "zero" } : { count, valueState: "value" };
}
function zeroMoney(currency: string): Money {
  return { currency, minorUnits: minorUnitsOf(0) };
}
interface CurrencySeries {
  readonly totals: Money[];
  readonly counts: number[];
}
function buildSeries(rows: readonly PreparedRow[], buckets: readonly MonthBucket[], currencies: readonly string[], coverage: Coverage): readonly SeriesPoint[] {
  const series = new Map<string, CurrencySeries>();
  for (const currency of currencies) {
    if (!isKnownCurrency(currency)) {
      continue;
    }
    series.set(currency, {
      totals: buckets.map(() => zeroMoney(currency)),
      counts: buckets.map(() => 0),
    });
  }
  for (const prepared of rows) {
    const currencySeries = series.get(prepared.row.amount.currency);
    const index = prepared.monthIndex;
    if (currencySeries === undefined) {
      continue;
    }
    const total = currencySeries.totals[index];
    if (total === undefined) {
      continue;
    }
    currencySeries.totals[index] = addMinor(total, prepared.row.amount);
    currencySeries.counts[index] = (currencySeries.counts[index] ?? 0) + 1;
  }
  const points: SeriesPoint[] = [];
  for (const currency of currencies) {
    const currencySeries = series.get(currency);
    if (currencySeries === undefined) {
      continue;
    }
    for (const [index, bucket] of buckets.entries()) {
      const count = currencySeries.counts[index] ?? 0;
      const total = currencySeries.totals[index];
      const recorded = count > 0 && total !== undefined;
      points.push({
        bucketStart: bucket.start,
        bucketEnd: bucket.end,
        currency,
        value: recorded ? statedValue(total.minorUnits, coverage) : { minorUnits: null, valueState: "unknown" },
        gap: !recorded,
      });
    }
  }
  return points;
}
function windowRows(rows: readonly ReportRow[], page: ReportQuery["page"]): WindowedRows {
  if (page === undefined) {
    return { rows };
  }
  const size = clampPageSize(page.size);
  const totalPages = rows.length === 0 ? 0 : Math.ceil(rows.length / size);
  const start = page.index * size;
  return { rows: rows.slice(start, start + size), page: { index: page.index, size, totalPages } };
}
function toReportRow(row: GiftRow): ReportRow {
  return {
    giftRowId: row.giftRowId,
    giftId: row.giftId,
    amount: row.amount,
    datePrecision: row.datePrecision,
    attribution: row.attribution,
    provenance: row.provenance,
    entryOn: row.entryOn,
    ...(row.allocationId === undefined ? {} : { allocationId: row.allocationId }),
    ...(row.originalGiftOn === undefined ? {} : { originalGiftOn: row.originalGiftOn }),
    ...(row.designation === undefined ? {} : { designation: row.designation }),
    ...(row.refundOf === undefined ? {} : { refundOf: row.refundOf }),
  };
}
// The comparison
interface ComparisonInput {
  readonly period: PeriodRange;
  readonly baseline: PeriodRange;
  readonly coverage: Coverage;
  readonly current: readonly PreparedRow[];
  readonly baselineRows: readonly PreparedRow[];
}
function buildComparison(input: ComparisonInput): ReportComparison {
  const current = sumKnownByCurrency(input.current);
  const baseline = sumKnownByCurrency(input.baselineRows);
  const currencies = [...new Set([...current.keys(), ...baseline.keys()])].sort(compareIdentifiers);
  const perCurrency = currencies.map((currency) => {
    const currentMoney = current.get(currency) ?? zeroMoney(currency);
    const baselineMoney = baseline.get(currency) ?? zeroMoney(currency);
    const difference = addMinor(currentMoney, negateMinor(baselineMoney));
    return {
      currency,
      currentMinor: currentMoney.minorUnits,
      baselineMinor: baselineMoney.minorUnits,
      differenceMinor: difference.minorUnits,
      direction: directionOf(difference.minorUnits),
      valueState: comparisonValueState(currentMoney, baselineMoney, input.coverage),
    };
  });
  const contributorDeltas = buildContributorDeltas(input.current, input.baselineRows);
  return {
    current: { from: input.period.from, to: input.period.to },
    baseline: { from: input.baseline.from, to: input.baseline.to },
    equalElapsed: daysInclusive(input.period.from, input.period.to) === daysInclusive(input.baseline.from, input.baseline.to),
    perCurrency,
    contributorDeltas,
    reconciles: reconciles(perCurrency, contributorDeltas),
  };
}
function sumKnownByCurrency(rows: readonly PreparedRow[]): Map<string, Money> {
  const totals = new Map<string, Money>();
  for (const { row } of rows) {
    const currency = row.amount.currency;
    if (!isKnownCurrency(currency)) {
      continue;
    }
    const current = totals.get(currency);
    totals.set(currency, current === undefined ? row.amount : addMinor(current, row.amount));
  }
  return totals;
}
function directionOf(minorUnits: MinorUnits): "increase" | "decrease" | "unchanged" {
  const units: number = minorUnits;
  if (units > 0) {
    return "increase";
  }
  return units < 0 ? "decrease" : "unchanged";
}
function comparisonValueState(current: Money, baseline: Money, coverage: Coverage): ValueState {
  if (coverage.state === "unknown") {
    return "unknown";
  }
  if (coverage.state === "partial") {
    return "incomplete-subtotal";
  }
  return compareMinor(current, zeroMoney(current.currency)) === 0 && compareMinor(baseline, zeroMoney(baseline.currency)) === 0 ? "zero" : "value";
}
interface ContributorAccumulator {
  readonly attribution: GiftAttribution;
  readonly current: Map<string, Money>;
  readonly baseline: Map<string, Money>;
}
const ATTRIBUTION_ORDER = ["partner", "anonymous", "unresolved"] as const satisfies readonly GiftAttribution["kind"][];

function buildContributorDeltas(current: readonly PreparedRow[], baselineRows: readonly PreparedRow[]): readonly ContributorDelta[] {
  const accumulators = new Map<string, ContributorAccumulator>();
  for (const row of current) {
    accumulateContributor(accumulators, row, "current");
  }
  for (const row of baselineRows) {
    accumulateContributor(accumulators, row, "baseline");
  }
  const deltas: ContributorDelta[] = [];
  for (const accumulator of accumulators.values()) {
    const currencies = [...new Set([...accumulator.current.keys(), ...accumulator.baseline.keys()])].sort(compareIdentifiers);
    for (const currency of currencies) {
      const currentMoney = accumulator.current.get(currency) ?? zeroMoney(currency);
      const baselineMoney = accumulator.baseline.get(currency) ?? zeroMoney(currency);
      const difference = addMinor(currentMoney, negateMinor(baselineMoney));
      if (difference.minorUnits === 0) {
        continue;
      }
      deltas.push({
        currency,
        minorUnits: difference.minorUnits,
        attribution: accumulator.attribution,
        ...(accumulator.attribution.kind === "partner" ? { partnerId: accumulator.attribution.partnerId } : {}),
      });
    }
  }
  return deltas.sort(compareContributorDeltas);
}
function accumulateContributor(accumulators: Map<string, ContributorAccumulator>, prepared: PreparedRow, slot: "current" | "baseline"): void {
  const row = prepared.row;
  const currency = row.amount.currency;
  if (!isKnownCurrency(currency)) {
    return;
  }
  const accumulator = contributorFor(accumulators, row.attribution);
  const totals = slot === "current" ? accumulator.current : accumulator.baseline;
  const running = totals.get(currency);
  totals.set(currency, running === undefined ? row.amount : addMinor(running, row.amount));
}
function contributorFor(accumulators: Map<string, ContributorAccumulator>, attribution: GiftAttribution): ContributorAccumulator {
  const key = attributionKey(attribution);
  const existing = accumulators.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created: ContributorAccumulator = {
    attribution,
    current: new Map<string, Money>(),
    baseline: new Map<string, Money>(),
  };
  accumulators.set(key, created);
  return created;
}
function compareContributorDeltas(left: ContributorDelta, right: ContributorDelta): number {
  const byCurrency = compareIdentifiers(left.currency, right.currency);
  if (byCurrency !== 0) {
    return byCurrency;
  }
  const leftKind = left.attribution?.kind ?? "partner";
  const rightKind = right.attribution?.kind ?? "partner";
  const byKind = ATTRIBUTION_ORDER.indexOf(leftKind) - ATTRIBUTION_ORDER.indexOf(rightKind);
  if (byKind !== 0) {
    return byKind;
  }
  return compareIdentifiers(left.partnerId ?? "", right.partnerId ?? "");
}
function reconciles(perCurrency: ReportComparison["perCurrency"], deltas: readonly ContributorDelta[]): boolean {
  for (const entry of perCurrency) {
    let total = zeroMoney(entry.currency);
    for (const delta of deltas) {
      if (delta.currency !== entry.currency) {
        continue;
      }
      total = addMinor(total, { currency: delta.currency, minorUnits: delta.minorUnits });
    }
    if (compareMinor(total, { currency: entry.currency, minorUnits: entry.differenceMinor }) !== 0) {
      return false;
    }
  }
  return true;
}
// The matrix
interface MatrixInput {
  readonly query: ReportQuery;
  readonly buckets: readonly MonthBucket[];
  readonly currencies: readonly string[];
  readonly rows: readonly PreparedRow[];
  readonly coverage: Coverage;
}
interface MatrixAccumulator {
  readonly attribution: GiftAttribution;
  readonly totals: Map<string, (Money | undefined)[]>;
  readonly counts: Map<string, number[]>;
}
const ANONYMOUS_LABEL = "Anonymous support";

const UNRESOLVED_LABEL = "Unattributed support";

function buildMatrix(input: MatrixInput): Matrix {
  const accumulators = new Map<string, MatrixAccumulator>();
  const bucketCount = input.buckets.length;
  for (const prepared of input.rows) {
    const row = prepared.row;
    const accumulator = matrixAccumulatorFor(accumulators, row.attribution);
    const currency = row.amount.currency;
    const index = prepared.monthIndex;
    if (index < 0 || index >= bucketCount) {
      continue;
    }
    const counts = bucketCountsFor(accumulator.counts, currency, bucketCount);
    counts[index] = (counts[index] ?? 0) + 1;
    if (!isKnownCurrency(currency)) {
      continue;
    }
    const totals = bucketTotalsFor(accumulator.totals, currency, bucketCount);
    const running = totals[index];
    totals[index] = running === undefined ? row.amount : addMinor(running, row.amount);
  }
  const rows = [...accumulators.values()]
    .map((accumulator) => ({
      ...(accumulator.attribution.kind === "partner" ? { partnerId: accumulator.attribution.partnerId } : {}),
      attribution: accumulator.attribution,
      label: labelOf(accumulator.attribution),
      cells: buildMatrixCells(accumulator, input),
    }))
    .sort(compareMatrixRows);
  return {
    currencies: input.currencies,
    months: input.buckets.map((bucket) => ({ start: bucket.start, end: bucket.end })),
    rows,
  };
}
function matrixAccumulatorFor(accumulators: Map<string, MatrixAccumulator>, attribution: GiftAttribution): MatrixAccumulator {
  const key = attributionKey(attribution);
  const existing = accumulators.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created: MatrixAccumulator = {
    attribution,
    totals: new Map<string, (Money | undefined)[]>(),
    counts: new Map<string, number[]>(),
  };
  accumulators.set(key, created);
  return created;
}
function bucketTotalsFor(totals: Map<string, (Money | undefined)[]>, currency: string, bucketCount: number): (Money | undefined)[] {
  const existing = totals.get(currency);
  if (existing !== undefined) {
    return existing;
  }
  const created = Array.from({ length: bucketCount }, (): Money | undefined => undefined);
  totals.set(currency, created);
  return created;
}
function bucketCountsFor(counts: Map<string, number[]>, currency: string, bucketCount: number): number[] {
  const existing = counts.get(currency);
  if (existing !== undefined) {
    return existing;
  }
  const created = Array.from({ length: bucketCount }, () => 0);
  counts.set(currency, created);
  return created;
}
function buildMatrixCells(accumulator: MatrixAccumulator, input: MatrixInput): readonly MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const currency of input.currencies) {
    const counts = accumulator.counts.get(currency);
    const totals = accumulator.totals.get(currency);
    for (const [index, bucket] of input.buckets.entries()) {
      const count = counts?.[index] ?? 0;
      const total = totals?.[index];
      const recorded = count > 0 && total !== undefined;
      cells.push({
        bucketStart: bucket.start,
        bucketEnd: bucket.end,
        currency,
        value: recorded ? statedValue(total.minorUnits, input.coverage) : { minorUnits: null, valueState: "unknown" },
        gap: !recorded,
        drilldown: {
          ...input.query,
          period: { kind: "explicit", from: bucket.start, to: bucket.end },
          partner: accumulator.attribution,
          currency: { kind: "one", currency },
          page: undefined,
        },
      });
    }
  }
  return cells;
}
function attributionKey(attribution: GiftAttribution): string {
  return attribution.kind === "partner" ? `partner:${attribution.partnerId}` : attribution.kind;
}
function labelOf(attribution: GiftAttribution): string {
  switch (attribution.kind) {
    case "partner":
      return attribution.partnerId;
    case "anonymous":
      return ANONYMOUS_LABEL;
    default:
      return UNRESOLVED_LABEL;
  }
}
function compareMatrixRows(left: MatrixRow, right: MatrixRow): number {
  const byKind = ATTRIBUTION_ORDER.indexOf(left.attribution.kind) - ATTRIBUTION_ORDER.indexOf(right.attribution.kind);
  if (byKind !== 0) {
    return byKind;
  }
  return compareIdentifiers(left.partnerId ?? "", right.partnerId ?? "");
}
// The goal
function buildGoal(goal: SupportGoalRecord, summary: readonly CurrencySummary[], selection: CurrencySelection, coverage: Coverage): GoalProgress {
  const record = goalRecordOf(goal);
  const entry = summary.find((candidate) => candidate.currency === record.currency);
  const currencySelected = selection.kind === "all" || selection.currency === record.currency;
  let numerator: MinorUnits | undefined;
  if (currencySelected) {
    const received = entry?.received;
    if (received !== undefined) {
      numerator = received.minorUnits ?? undefined;
    } else if (coverage.state === "complete") {
      numerator = minorUnitsOf(0);
    }
  }
  return goalProgress({
    goal: record,
    measureCompatible: currencySelected,
    ...(numerator === undefined ? {} : { numeratorMinor: numerator }),
  });
}
function goalRecordOf(goal: SupportGoalRecord): GoalRecord {
  const effectiveFrom = parseCivilDate(goal.effectiveFrom);
  if (effectiveFrom.status === "refused") {
    throw new TypeError(
      `Support goal effective date "${goal.effectiveFrom}" is not a civil date, so the goal cannot be measured against a period. The value is refused rather than replaced by today.`,
    );
  }
  const revision = Number(goal.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new TypeError(`Support goal revision "${goal.revision}" is not a positive whole revision, so no goal is presented against a revision nobody read.`);
  }
  return {
    minorUnits: goal.amount.minorUnits,
    currency: goal.amount.currency,
    measure: GOAL_MEASURE,
    effectiveFrom: effectiveFrom.date,
    revision,
  };
}
// The value-state map
interface ValueStateInput {
  readonly summary: readonly CurrencySummary[];
  readonly series: readonly SeriesPoint[];
  readonly rows: readonly ReportRow[];
  readonly comparison?: ReportComparison;
  readonly matrix?: Matrix;
}
function collectValueStates(input: ValueStateInput): Readonly<Record<string, ValueState>> {
  const states: Record<string, ValueState> = {};
  for (const entry of input.summary) {
    states[`summary.${entry.currency}.received`] = entry.received.valueState;
    states[`summary.${entry.currency}.giftCount`] = entry.giftCount.valueState;
    states[`summary.${entry.currency}.allocationCount`] = entry.allocationCount.valueState;
    states[`summary.${entry.currency}.donorCount`] = entry.donorCount.valueState;
  }
  for (const point of input.series) {
    states[`series.${point.currency}.${serialiseCivilDate(point.bucketStart)}`] = point.value.valueState;
  }
  input.rows.forEach((row, index) => {
    states[`rows.${index}.amount`] = row.amount.minorUnits === 0 ? "zero" : "value";
  });
  const comparison = input.comparison;
  if (comparison !== undefined) {
    for (const entry of comparison.perCurrency) {
      states[`comparison.${entry.currency}.current`] = entry.valueState;
      states[`comparison.${entry.currency}.baseline`] = entry.valueState;
      states[`comparison.${entry.currency}.difference`] = entry.valueState;
    }
  }
  const matrix = input.matrix;
  if (matrix !== undefined) {
    for (const row of matrix.rows) {
      const key = row.partnerId ?? row.attribution.kind;
      for (const cell of row.cells) {
        states[`matrix.${key}.${cell.currency}.${serialiseCivilDate(cell.bucketStart)}`] = cell.value.valueState;
      }
    }
  }
  return states;
}
