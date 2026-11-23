/** `runReport` — the one financial computation in this application, and the only place a received-support figure is filtered, summed, bucketed, compared or paged. */
import { Temporal } from "temporal-polyfill";
import type { SourceReference } from "../../lib/ids";
import type { Coverage, GiftAttribution, SupportGoalRecord, ValueState } from "../data-service/envelope";
import { addMinor, compareMinor, minorUnitsOf, negateMinor, type MinorUnits, type Money } from "../money/amount";
import { exponentOf, isKnownCurrency } from "../money/currency";
import { parseCivilDate, serialiseCivilDate, todayInZone, type CivilDate } from "../time/civil";
import { SUPPORT_BASIS, assertSingleBasis, type GiftRow, type SupportBasis, type SupportProjection } from "./basis";
import { GOAL_MEASURE, goalProgress, type GoalProgress, type GoalRecord } from "./goal";
export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_CAP = 200;
/** Turns any requested page size into the one the service serves: the default when none was stated, the cap when more was asked for, and never fewer than one row. */
export function clampPageSize(size?: number): number {
  if (size === undefined || !Number.isFinite(size)) return PAGE_SIZE_DEFAULT;
  const whole = Math.trunc(size);
  return whole < 1 ? 1 : whole > PAGE_SIZE_CAP ? PAGE_SIZE_CAP : whole;
}
export type ReportId = "received-period-and-year-to-date" | "monthly-history" | "partner-month-matrix" | "period-comparison";
export const REPORT_IDS = ["received-period-and-year-to-date", "monthly-history", "partner-month-matrix", "period-comparison"] as const satisfies readonly ReportId[];
export const PERIOD_PRESETS = ["this-month", "last-month", "this-year", "last-year", "year-to-date"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const SORT_FIELDS = ["originalGiftOn", "amountMinor", "designation"] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
/** The exact authority a report is computed under: the four references that are separately owned and never interchangeable. */
export type ReportScope = { readonly organizationId: string; readonly ministryId: string; readonly supportSubjectId: string; readonly principalId: string };
export type CurrencySelection = { readonly kind: "all" } | { readonly kind: "one"; readonly currency: string };
export type ReportPeriod = { readonly kind: "preset"; readonly preset: PeriodPreset } | { readonly kind: "explicit"; readonly from: CivilDate; readonly to: CivilDate } | { readonly kind: "year"; readonly year: number };
export type ReportPartnerSelection = { readonly kind: "partner"; readonly partnerId: string } | { readonly kind: "anonymous" } | { readonly kind: "unresolved" };
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
export type ReportQueryProblem = { readonly field: string; readonly message: string };
const SCOPE_FIELDS = ["organizationId", "ministryId", "supportSubjectId", "principalId"] as const;
/** The zone a period preset resolves in when the caller states none, so no host zone is ever used. */
export const REPORT_DEFAULT_TIME_ZONE = "UTC";
const ZONE_PROBE_INSTANT = Temporal.Instant.fromEpochMilliseconds(0);
const isResolvableZone = (timeZone: string): boolean => todayInZone(timeZone, ZONE_PROBE_INSTANT).status === "resolved";
export function validateReportQuery(query: ReportQuery): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  if (!REPORT_IDS.includes(query.reportId)) problems.push({ field: "reportId", message: "This application reports received support in four fixed ways. Choose one of the four identities; no other report is computed and none is substituted for an unrecognised one." });
  const scope: ReportScope | undefined = query.scope; // The three structures below are checked for presence before they are read, so a request body that failed to decode is answered with per-field problems rather than with a thrown fault.
  if (typeof scope !== "object" || scope === null) {
    problems.push({ field: "scope", message: "Every report runs under the four references that state its authority, and this request states none. No report is computed under an assumed context." });
  } else {
    for (const field of SCOPE_FIELDS) {
      const value: string = scope[field];
      if (typeof value !== "string" || value.trim() === "") problems.push({ field: `scope.${field}`, message: "Every report runs under the four references that state its authority. This one is missing, and a report is never computed under an assumed context." });
    }
  }
  const period: ReportPeriod | undefined = query.period;
  if (typeof period !== "object" || period === null) {
    problems.push({ field: "period", message: "A report covers a period, and this request states none. No period is assumed in its place." });
  } else problems.push(...validatePeriod(period));
  const currency: CurrencySelection | undefined = query.currency;
  if (typeof currency !== "object" || currency === null) {
    problems.push({ field: "currency", message: "A report states the currency or currencies its figures are in, and this request states none. No currency is assumed in its place." });
  } else problems.push(...validateCurrency(query));
  problems.push(...validateFilters(query));
  problems.push(...validateSort(query.sort));
  problems.push(...validatePage(query.page));
  if (query.timeZone !== undefined && !isResolvableZone(query.timeZone)) problems.push({ field: "timeZone", message: "A period preset resolves in the zone the query names, and this zone cannot be resolved. Choose a tz database identifier; the application never substitutes the host's zone." });
  return problems;
}
function validatePeriod(period: ReportPeriod): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  switch (period.kind) {
    case "preset":
      if (!PERIOD_PRESETS.includes(period.preset)) problems.push({ field: "period.preset", message: "A preset period is one of the five this application offers. Name one of them, or state two civil dates instead." });
      return problems;
    case "explicit": {
      if (!isCivilDate(period.from) || !isCivilDate(period.to)) {
        problems.push({ field: "period", message: "An explicit period is two civil dates, each a calendar day with no time of day. A date-time string is refused rather than truncated, because a truncated time would move the period's boundary." });
        return problems;
      }
      if (Temporal.PlainDate.compare(period.from, period.to) > 0) problems.push({ field: "period", message: "The period starts after it ends, so it covers no day at all. State the earlier date first; the range is inclusive at both ends." });
      return problems;
    }
    case "year": {
      const year: number = period.year;
      if (!Number.isSafeInteger(year) || year < 1 || year > 9999) problems.push({ field: "period.year", message: "A calendar year is stated as a whole four-digit year. This value is not one, so no year's months are computed for it." });
      return problems;
    }
    default:
      problems.push({ field: "period.kind", message: "A period is a preset, two civil dates or a calendar year. This one is none of those, so no period is assumed for it." });
      return problems;
  }
}
function validateCurrency(query: ReportQuery): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  const selection: CurrencySelection = query.currency;
  const range = query.amountRange;
  if (selection.kind === "all") {
    if (range !== undefined) problems.push({ field: "amountRange", message: "An amount range compares one currency's amounts, so it needs a single selected currency. Clear the range or choose one currency; a range across currencies would compare amounts that have no ordering." });
    return problems;
  }
  if (selection.kind === "one") {
    if (typeof selection.currency !== "string" || selection.currency.trim() === "") problems.push({ field: "currency.currency", message: "A single-currency selection states the currency code. This one is empty, and no currency is assumed in its place." });
    if (range !== undefined) {
      if (!Number.isSafeInteger(range.minMinor) || !Number.isSafeInteger(range.maxMinor)) {
        problems.push({ field: "amountRange", message: "An amount range states whole counts of the selected currency's minor units. A fractional or non-finite bound is refused rather than rounded, because rounding would change which rows match." });
      } else if (range.minMinor > range.maxMinor) problems.push({ field: "amountRange", message: "The amount range starts above where it ends, so it matches nothing. State the lower bound first; both bounds are inclusive." });
    }
    return problems;
  }
  problems.push({ field: "currency.kind", message: "A currency selection is either every currency present or one named currency. This one is neither, so no partition is assumed for it." });
  return problems;
}
function validateFilters(query: ReportQuery): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  if (query.partner !== undefined) {
    const partner = query.partner;
    if (partner.kind === "partner") {
      if (typeof partner.partnerId !== "string" || partner.partnerId.trim() === "") problems.push({ field: "partner.partnerId", message: "A partner filter states the partner's own reference. This one is empty, and no partner is assumed in its place." });
    } else if (partner.kind !== "anonymous" && partner.kind !== "unresolved") problems.push({ field: "partner.kind", message: "An attribution filter is a partner reference, anonymous support or unattributed support. This one is none of those." });
  }
  if (query.designation !== undefined && query.designation.trim() === "") problems.push({ field: "designation", message: "A designation filter states the source's own designation. An empty one selects nothing rather than everything, so it is refused; omit the filter to read every designation." });
  if (query.method !== undefined) {
    problems.push({ field: "method", message: "The support projection carries no giving-method or classification field, so a method facet cannot be applied to it. The filter is refused rather than quietly ignored, because a result that was never filtered must not be presented as a filtered one." });
  }
  if (query.search !== undefined && query.search.trim() === "") problems.push({ field: "search", message: "A search term states the text to look for. An empty term matches every row rather than none, so it is refused; omit the search to read the whole result." });
  return problems;
}
function validateSort(sort: ReportQuery["sort"]): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  if (sort === undefined) return problems;
  if (!SORT_FIELDS.includes(sort.field)) problems.push({ field: "sort.field", message: "A result is sorted by the gift's own date, its amount or its designation. This field is not one of those, and no other ordering is invented for it." });
  if (!SORT_DIRECTIONS.includes(sort.direction)) problems.push({ field: "sort.direction", message: "A sort runs ascending or descending. This direction is neither, so no order is assumed." });
  return problems;
}
function validatePage(page: ReportQuery["page"]): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  if (page === undefined) return problems;
  if (!Number.isSafeInteger(page.index) || page.index < 0) problems.push({ field: "page.index", message: "A page index is a whole number of pages from zero. This value is not one, so no page is assumed for it." });
  if (page.size !== undefined && !Number.isFinite(page.size)) problems.push({ field: "page.size", message: "A page size is a finite number of rows. This one is not, and the default page size is not substituted for a stated one that cannot be read." });
  return problems;
}
/** Builds the query a report is computed from, refusing one that could produce a dishonest total. */
export function buildReportQuery(input: ReportQuery): { ok: true; query: ReportQuery } | { ok: false; problems: ReportQueryProblem[] } {
  const normalised = trimOptionalFields(input);
  const problems = validateReportQuery(normalised);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, query: normalisePeriod(normalised) };
}
function trimOptionalFields(input: ReportQuery): ReportQuery {
  const page = input.page;
  const partner: ReportPartnerSelection | undefined = input.partner === undefined || input.partner === null ? undefined : input.partner.kind === "partner" ? { kind: "partner", partnerId: trimmedText(input.partner.partnerId) } : input.partner;
  // Every member a caller may omit is trimmed once here, and a member that says nothing is left out rather than stated as empty.
  const given = {
    designation: blankToUndefined(input.designation),
    search: blankToUndefined(input.search),
    method: blankToUndefined(input.method),
    timeZone: blankToUndefined(input.timeZone),
    partner,
    amountRange: input.amountRange,
    sort: input.sort,
    page: page === undefined || page === null ? undefined : { index: page.index, size: clampPageSize(page.size) },
  };
  return { reportId: input.reportId, scope: trimScope(input.scope), period: input.period, currency: trimCurrency(input.currency), ...Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)) } as ReportQuery;
}
const trimmedText = (value: string | undefined): string => (typeof value === "string" ? value.trim() : "");
function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = trimmedText(value);
  return trimmed === "" ? undefined : trimmed;
}
function trimScope(scope: ReportScope): ReportScope {
  const arrived: unknown = scope; // Widened on purpose: this value arrives from a request body, so what actually arrived is compared rather than the type it was declared with.
  if (typeof arrived !== "object" || arrived === null) return scope;
  return { organizationId: trimmedText(scope.organizationId), ministryId: trimmedText(scope.ministryId), supportSubjectId: trimmedText(scope.supportSubjectId), principalId: trimmedText(scope.principalId) };
}
function trimCurrency(currency: CurrencySelection): CurrencySelection {
  const arrived: unknown = currency;
  if (typeof arrived !== "object" || arrived === null || currency.kind !== "one") return currency;
  return { kind: "one", currency: trimmedText(currency.currency) };
}
function normalisePeriod(input: ReportQuery): ReportQuery {
  const period = input.period;
  if (period.kind !== "year") return input;
  return { ...input, period: { kind: "explicit", from: Temporal.PlainDate.from({ year: period.year, month: 1, day: 1 }), to: Temporal.PlainDate.from({ year: period.year, month: 12, day: 31 }) } };
}
const isCivilDate = (value: unknown): value is CivilDate => value instanceof Temporal.PlainDate;
export type PeriodState = "complete" | "in-progress";
export type StatedValue = { readonly minorUnits: MinorUnits | null; readonly valueState: ValueState };
export type StatedCount = { readonly count: number; readonly valueState: ValueState };
export type CurrencySummary = { readonly currency: string; readonly exponent: number | undefined; readonly received: StatedValue; readonly giftCount: StatedCount; readonly allocationCount: StatedCount; readonly donorCount: StatedCount };
export type SeriesPoint = { readonly bucketStart: CivilDate; readonly bucketEnd: CivilDate; readonly currency: string; readonly value: StatedValue; readonly gap: boolean };
export type ReportRow = GiftRow;
export type MatrixCell = { readonly bucketStart: CivilDate; readonly bucketEnd: CivilDate; readonly currency: string; readonly value: StatedValue; readonly gap: boolean };
export type MatrixRow = { readonly partnerId?: string; readonly attribution: GiftAttribution; readonly label: string; readonly cells: readonly MatrixCell[] };
/** One partner-by-month matrix: the whole-result row total, the window of rows this read serves, and the cells of exactly those rows. */
export type Matrix = { readonly currencies: readonly string[]; readonly months: readonly { readonly start: CivilDate; readonly end: CivilDate }[]; readonly rows: readonly MatrixRow[]; readonly total: number; readonly page: PageWindow };
export type ContributorDelta = { readonly partnerId?: string; readonly attribution?: GiftAttribution; readonly currency: string; readonly minorUnits: MinorUnits };
export interface ReportComparison {
  readonly current: { readonly from: CivilDate; readonly to: CivilDate };
  readonly baseline: { readonly from: CivilDate; readonly to: CivilDate };
  readonly equalElapsed: boolean;
  readonly perCurrency: readonly { readonly currency: string; readonly currentMinor: MinorUnits; readonly baselineMinor: MinorUnits; readonly differenceMinor: MinorUnits; readonly direction: "increase" | "decrease" | "unchanged"; readonly valueState: ValueState }[];
  readonly contributorDeltas: readonly ContributorDelta[];
  /** Every contributor change the comparison counted in each currency, before the stated list is bounded. */
  readonly contributorDeltaCounts: Readonly<Record<string, number>>;
  readonly reconciles: boolean;
}
export interface Snapshot {
  readonly query: ReportQuery;
  readonly scope: ReportScope;
  readonly basis: SupportBasis;
  readonly currencies: readonly string[];
  readonly period: { readonly from: CivilDate; readonly to: CivilDate; readonly state: PeriodState };
  readonly coverage: Coverage;
  readonly asOf: string;
  readonly lastSourceUpdate: string;
  readonly source: SourceReference;
}
/** The window a paged collection serves: the page the read answered with, the row count served, and how many pages the whole result fills. */
export type PageWindow = { readonly index: number; readonly size: number; readonly totalPages: number };
/** One designation the whole filtered result carries, with the state the count of its rows is stated in. */
export type DesignationFacetValue = { readonly designation: string } & StatedCount;
/** One attribution the whole filtered result carries: a partner's own reference, or the kind when no partner is named, with the state the count of its rows is stated in. */
export type AttributionFacetValue = { readonly attribution: GiftAttribution } & StatedCount;
/** The values the whole filtered result contains, stated so a filter offers every value that result holds rather than the values one page happens to show. */
export interface ReportFacets {
  readonly designations: readonly DesignationFacetValue[];
  readonly attributions: readonly AttributionFacetValue[];
}
/** The result of a run that requested the facet projection: the same figures every surface reads, with the values the ledger's filters can offer. */
export type FacetsReportResult = ReportResult & { readonly facets: ReportFacets };
export interface ReportResult {
  readonly snapshot: Snapshot;
  readonly summary: readonly CurrencySummary[];
  readonly series: readonly SeriesPoint[];
  readonly rows: readonly ReportRow[];
  readonly total: number;
  readonly page?: PageWindow;
  readonly comparison?: ReportComparison;
  readonly matrix?: Matrix;
  readonly goal?: GoalProgress;
  readonly facets?: ReportFacets;
  readonly valueStates: Readonly<Record<string, ValueState>>;
}
type PeriodRange = { readonly from: CivilDate; readonly to: CivilDate };
type ResolvedPeriod = PeriodRange & { readonly state: PeriodState };
type MonthBucket = { readonly start: CivilDate; readonly end: CivilDate };
type Windowed<T> = { readonly items: readonly T[]; readonly page?: PageWindow };
/** How many pages a whole-result count fills at a stated row count; a result that matched nothing fills none. */
const totalPagesOf = (total: number, size: number): number => (total === 0 ? 0 : Math.ceil(total / size));
/** The sections one computation builds: the equal-elapsed comparison a report renders, and the facet values the gifts ledger's filters offer. A member is built only when its caller asks for it, so a surface that renders neither pays for neither. */
export type ReportSections = { readonly comparison?: boolean; readonly facets?: boolean };
/** The one report computation: it filters, sums, buckets, compares and pages the whole authorised result, and builds only the sections its trailing request states a caller renders. The plain signature is declared last so `ReturnType<typeof runReport>` stays the result every surface reads; only the gifts ledger asks for the facet projection, so every other report, the CSV writer and the print model read the same result they read before. */
export function runReport(query: ReportQuery, projection: SupportProjection, sections: ReportSections & { readonly facets: true }): FacetsReportResult;
export function runReport(query: ReportQuery, projection: SupportProjection, sections?: ReportSections): ReportResult;
export function runReport(query: ReportQuery, projection: SupportProjection, sections: ReportSections = {}): ReportResult {
  assertQueryGate(query);
  assertSingleBasis(projection);
  const basis: SupportBasis = SUPPORT_BASIS;
  const asOf = instantOf(projection.asOf);
  const timeZone = query.timeZone ?? REPORT_DEFAULT_TIME_ZONE;
  const today = civilTodayIn(timeZone, asOf);
  const period = resolvePeriod(query.period, today);
  // A read whose surface renders no comparison asks for its projection without one: the preceding window is never resolved, no row is measured against it and no per-contributor delta is built for a caller that would show none. The default states the equal-elapsed comparison every report read renders.
  const withComparison = needsComparison(query.reportId) && sections.comparison !== false;
  const baseline = withComparison ? precedingEqualElapsed(period) : undefined;
  const searchTerm = query.search === undefined ? undefined : query.search.toLowerCase(); // One filtering pass over every authorised row, then one de-duplication at the grain. Both artifacts below are derived from this same set, so a filter can never apply to one surface and not another.
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
  // The page window is taken over the matched rows before anything is projected, so a page costs the rows it serves rather than every row the query matched. The whole-result count comes from the same set the window was taken over, so the page and the total can never describe different results.
  const windowed = windowRows(current, query.page);
  const rows = windowed.items.map((prepared) => prepared.row);
  const comparison = baseline === undefined ? undefined : buildComparison({ period, baseline, coverage: projection.coverage, current, baselineRows });
  const matrix = query.reportId === "partner-month-matrix" ? buildMatrix({ query, buckets, currencies, rows: current, coverage: projection.coverage }) : undefined;
  const goal = projection.goal === undefined ? undefined : buildGoal(projection.goal, summary, query.currency, projection.coverage);
  // The facet values are counted over the same matched rows the summary and the total come from, before the page window, and only for a caller that asks for them: a page of rows never limits the values a filter can name.
  const facets = sections.facets === true ? buildFacets(current, projection.coverage) : undefined;
  const snapshotCurrencies = statedCurrenciesOf(query.reportId, currencies, comparison);
  return {
    snapshot: { query, scope: query.scope, basis, currencies: snapshotCurrencies, period: { from: period.from, to: period.to, state: period.state }, coverage: projection.coverage, asOf: projection.asOf, lastSourceUpdate: projection.lastSourceUpdate, source: projection.source },
    summary,
    series,
    rows,
    total: current.length,
    ...(windowed.page === undefined ? {} : { page: windowed.page }),
    ...(comparison === undefined ? {} : { comparison }),
    ...(matrix === undefined ? {} : { matrix }),
    ...(goal === undefined ? {} : { goal }),
    ...(facets === undefined ? {} : { facets }),
    valueStates: collectValueStates({ summary, series, rows, ...(comparison === undefined ? {} : { comparison }) }),
  };
}
function assertQueryGate(query: ReportQuery): void {
  const problems = validateReportQuery(query);
  if (problems.length === 0) return;
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
  if (resolved.status === "refused") throw new TypeError(`The zone "${timeZone}" cannot be resolved, so the report's period has no civil dates. The zone is refused rather than replaced by the host's.`);
  return resolved.date;
}
const needsComparison = (reportId: ReportId): boolean => reportId === "received-period-and-year-to-date" || reportId === "period-comparison";
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
const yearRange = (year: number): PeriodRange => ({ from: Temporal.PlainDate.from({ year, month: 1, day: 1 }), to: Temporal.PlainDate.from({ year, month: 12, day: 31 }) });
function precedingEqualElapsed(period: PeriodRange): PeriodRange {
  const days = daysInclusive(period.from, period.to);
  const to = period.from.subtract({ days: 1 });
  return { from: to.subtract({ days: days - 1 }), to };
}
const daysInclusive = (from: CivilDate, to: CivilDate): number => from.until(to, { largestUnit: "days" }).days + 1;
function monthBuckets(from: CivilDate, to: CivilDate): readonly MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const lastMonthStart = to.with({ day: 1 });
  let monthStart = from.with({ day: 1 });
  while (Temporal.PlainDate.compare(monthStart, lastMonthStart) <= 0) {
    const monthEnd = monthStart.add({ months: 1 }).subtract({ days: 1 });
    buckets.push({ start: Temporal.PlainDate.compare(monthStart, from) < 0 ? from : monthStart, end: Temporal.PlainDate.compare(monthEnd, to) > 0 ? to : monthEnd });
    monthStart = monthStart.add({ months: 1 });
  }
  return buckets;
}
const monthOffset = (date: CivilDate, origin: CivilDate): number => (date.year - origin.year) * 12 + (date.month - origin.month);
type PreparedRow = { readonly row: GiftRow; readonly dayKey: number; readonly monthIndex: number };
const dayKeyOf = (date: CivilDate): number => date.year * 10_000 + date.month * 100 + date.day;
function prepareRows(rows: readonly GiftRow[], originMonth: CivilDate): readonly PreparedRow[] {
  const prepared: PreparedRow[] = [];
  for (const row of rows) {
    const date = row.originalGiftOn;
    if (date === undefined) continue;
    prepared.push({ row, dayKey: dayKeyOf(date), monthIndex: monthOffset(date, originMonth) });
  }
  return prepared;
}
const isWithin = (row: PreparedRow, fromKey: number, toKey: number): boolean => row.dayKey >= fromKey && row.dayKey <= toKey;
function matchesNonDateFilters(row: GiftRow, query: ReportQuery, searchTerm: string | undefined): boolean {
  if (query.currency.kind === "one" && row.amount.currency !== query.currency.currency) return false;
  const range = query.amountRange;
  if (range !== undefined) {
    const amount: number = row.amount.minorUnits;
    if (amount < range.minMinor || amount > range.maxMinor) return false;
  }
  if (query.designation !== undefined && row.designation !== query.designation) return false;
  const partner = query.partner;
  if (partner !== undefined) {
    if (partner.kind === "partner") {
      if (row.attribution.kind !== "partner" || row.attribution.partnerId !== partner.partnerId) return false;
    } else if (row.attribution.kind !== partner.kind) return false;
  }
  return searchTerm !== undefined && !matchesSearch(row, searchTerm) ? false : true;
}
function matchesSearch(row: GiftRow, needle: string): boolean {
  const fields: readonly (string | undefined)[] = [row.designation, row.giftId, row.giftRowId, row.allocationId, row.provenance.system, row.provenance.reference, row.attribution.kind === "partner" ? row.attribution.partnerId : undefined];
  return fields.some((field) => field !== undefined && field.toLowerCase().includes(needle));
}
function deduplicateAtGrain(rows: readonly GiftRow[]): readonly GiftRow[] {
  const giftsWithAllocations = new Set<string>();
  for (const row of rows) if (row.allocationId !== undefined) giftsWithAllocations.add(row.giftId);
  const seen = new Set<string>();
  const kept: GiftRow[] = [];
  for (const row of rows) {
    if (seen.has(row.giftRowId)) continue;
    const isGiftGrainRow = row.allocationId === undefined;
    const isCorrection = row.refundOf !== undefined;
    if (isGiftGrainRow && !isCorrection && giftsWithAllocations.has(row.giftId)) continue;
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
  const primary = sort.field === "originalGiftOn" ? signOf(left.dayKey - right.dayKey, descending) : sort.field === "amountMinor" ? signOf(compareAmounts(left.row.amount, right.row.amount), descending) : compareText(left.row.designation, right.row.designation, descending);
  return primary === 0 ? compareIdentifiers(left.row.giftRowId, right.row.giftRowId) : primary;
}
function compareText(left: string | undefined, right: string | undefined, descending: boolean): number {
  return left === undefined && right === undefined ? 0 : left === undefined ? 1 : right === undefined ? -1 : signOf(compareIdentifiers(left, right), descending);
}
function compareAmounts(left: Money, right: Money): number {
  if (left.currency !== right.currency) return compareIdentifiers(left.currency, right.currency);
  if (isKnownCurrency(left.currency)) return compareMinor(left, right);
  const leftUnits: number = left.minorUnits;
  const rightUnits: number = right.minorUnits;
  return leftUnits === rightUnits ? 0 : leftUnits < rightUnits ? -1 : 1;
}
const signOf = (order: number, descending: boolean): number => (descending ? -order : order);
function compareIdentifiers(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
type CurrencyAggregate = { total: Money | undefined; readonly giftIds: Set<string>; allocationCount: number; readonly donorIds: Set<string> };
function currenciesOf(rows: readonly PreparedRow[], selection: CurrencySelection): readonly string[] {
  const codes = new Set<string>();
  for (const { row } of rows) codes.add(row.amount.currency);
  if (selection.kind === "one") codes.add(selection.currency);
  return [...codes].sort(compareIdentifiers);
}
/** The currencies the snapshot states: a report states the partition it sums, and the period comparison also states the partition of the earlier period it sets against it, so a currency that appears only in that earlier period is stated rather than left out of the fact the surface prints beside its figures (AAP 0.8.8 — every surface says what the result covers). */
function statedCurrenciesOf(reportId: ReportId, currencies: readonly string[], comparison: ReportComparison | undefined): readonly string[] {
  if (reportId !== "period-comparison" || comparison === undefined) return currencies;
  return [...new Set([...currencies, ...comparison.perCurrency.map((entry) => entry.currency)])].sort(compareIdentifiers);
}
function summarise(rows: readonly PreparedRow[], currencies: readonly string[], coverage: Coverage): readonly CurrencySummary[] {
  const aggregates = new Map<string, CurrencyAggregate>();
  for (const { row } of rows) {
    const currency = row.amount.currency;
    const aggregate = aggregateFor(aggregates, currency);
    if (row.allocationId !== undefined) aggregate.allocationCount += 1;
    aggregate.giftIds.add(row.giftId);
    if (row.attribution.kind === "partner") aggregate.donorIds.add(row.attribution.partnerId);
    if (isKnownCurrency(currency)) aggregate.total = aggregate.total === undefined ? row.amount : addMinor(aggregate.total, row.amount);
  }
  return currencies.map((currency) => {
    const aggregate = aggregates.get(currency);
    const receivedMinor: MinorUnits | null = isKnownCurrency(currency) ? (aggregate?.total?.minorUnits ?? minorUnitsOf(0)) : null;
    return { currency, exponent: exponentOf(currency), received: statedValue(receivedMinor, coverage), giftCount: statedCount(aggregate?.giftIds.size ?? 0, coverage), allocationCount: statedCount(aggregate?.allocationCount ?? 0, coverage), donorCount: statedCount(aggregate?.donorIds.size ?? 0, coverage) };
  });
}
function aggregateFor(aggregates: Map<string, CurrencyAggregate>, currency: string): CurrencyAggregate {
  const existing = aggregates.get(currency);
  if (existing !== undefined) return existing;
  const created: CurrencyAggregate = { total: undefined, giftIds: new Set<string>(), allocationCount: 0, donorIds: new Set<string>() };
  aggregates.set(currency, created);
  return created;
}
const measuredState = (zero: boolean, coverage: Coverage): ValueState => (coverage.state === "partial" ? "incomplete-subtotal" : zero ? "zero" : "value"); // The state a measured figure carries: a partial period states a subtotal, and a complete one keeps zero distinct from a value.
const statedValue = (minorUnits: MinorUnits | null, coverage: Coverage): StatedValue => (minorUnits === null || coverage.state === "unknown" ? { minorUnits: null, valueState: "unknown" } : { minorUnits, valueState: measuredState(minorUnits === 0, coverage) });
const statedCount = (count: number, coverage: Coverage): StatedCount => ({ count, valueState: coverage.state === "unknown" ? "unknown" : measuredState(count === 0, coverage) });
// One bucket's figure as every surface states it: a bucket with no recorded row is a gap rather than a zero.
const statedPoint = (bucket: MonthBucket, currency: string, count: number, total: Money | undefined, coverage: Coverage): SeriesPoint => ({
  bucketStart: bucket.start,
  bucketEnd: bucket.end,
  currency,
  value: count > 0 && total !== undefined ? statedValue(total.minorUnits, coverage) : { minorUnits: null, valueState: "unknown" },
  gap: !(count > 0 && total !== undefined),
});
const zeroMoney = (currency: string): Money => ({ currency, minorUnits: minorUnitsOf(0) });
type CurrencySeries = { readonly totals: Money[]; readonly counts: number[] };
function buildSeries(rows: readonly PreparedRow[], buckets: readonly MonthBucket[], currencies: readonly string[], coverage: Coverage): readonly SeriesPoint[] {
  const series = new Map<string, CurrencySeries>();
  for (const currency of currencies) {
    if (!isKnownCurrency(currency)) continue;
    series.set(currency, { totals: buckets.map(() => zeroMoney(currency)), counts: buckets.map(() => 0) });
  }
  for (const prepared of rows) {
    const currencySeries = series.get(prepared.row.amount.currency);
    const index = prepared.monthIndex;
    if (currencySeries === undefined) continue;
    const total = currencySeries.totals[index];
    if (total === undefined) continue;
    currencySeries.totals[index] = addMinor(total, prepared.row.amount);
    currencySeries.counts[index] = (currencySeries.counts[index] ?? 0) + 1;
  }
  const points: SeriesPoint[] = [];
  for (const currency of currencies) {
    const currencySeries = series.get(currency);
    if (currencySeries === undefined) continue;
    for (const [index, bucket] of buckets.entries()) points.push(statedPoint(bucket, currency, currencySeries.counts[index] ?? 0, currencySeries.totals[index], coverage));
  }
  return points;
}
/** The items a stated page window covers, taken from the whole collection: no page states the whole collection, a stated page serves only its own rows, and an index past the pages the collection fills is clamped onto the last one, so the window never states a page the result does not have. */
function windowRows<T>(items: readonly T[], page: ReportQuery["page"]): Windowed<T> {
  if (page === undefined) return { items };
  const size = clampPageSize(page.size);
  const totalPages = totalPagesOf(items.length, size);
  const index = totalPages === 0 ? 0 : Math.min(Math.max(0, page.index), totalPages - 1);
  const start = index * size;
  return { items: items.slice(start, start + size), page: { index, size, totalPages } };
}
type ComparisonInput = { readonly period: PeriodRange; readonly baseline: PeriodRange; readonly coverage: Coverage; readonly current: readonly PreparedRow[]; readonly baselineRows: readonly PreparedRow[] };
/** How many contributor changes of one currency a comparison states: the whole count and the reconciliation are computed over every change, while only the largest are stated, because an unbounded list made one report page tens of megabytes. */
export const CONTRIBUTOR_DELTA_LIMIT = 25;
function buildComparison(input: ComparisonInput): ReportComparison {
  const current = sumKnownByCurrency(input.current);
  const baseline = sumKnownByCurrency(input.baselineRows);
  const currencies = [...new Set([...current.keys(), ...baseline.keys()])].sort(compareIdentifiers);
  const perCurrency = currencies.map((currency) => {
    const currentMoney = current.get(currency) ?? zeroMoney(currency);
    const baselineMoney = baseline.get(currency) ?? zeroMoney(currency);
    const difference = addMinor(currentMoney, negateMinor(baselineMoney));
    return { currency, currentMinor: currentMoney.minorUnits, baselineMinor: baselineMoney.minorUnits, differenceMinor: difference.minorUnits, direction: directionOf(difference.minorUnits), valueState: comparisonValueState(currentMoney, baselineMoney, input.coverage) };
  });
  const everyDelta = buildContributorDeltas(input.current, input.baselineRows); // The whole set stays the basis of the stated count and of the reconciliation; only the list the document carries is bounded.
  return {
    current: { from: input.period.from, to: input.period.to },
    baseline: { from: input.baseline.from, to: input.baseline.to },
    equalElapsed: daysInclusive(input.period.from, input.period.to) === daysInclusive(input.baseline.from, input.baseline.to),
    perCurrency,
    contributorDeltas: statedContributorDeltas(everyDelta),
    contributorDeltaCounts: contributorDeltaCountsOf(everyDelta),
    reconciles: reconciles(perCurrency, everyDelta),
  };
}
function sumKnownByCurrency(rows: readonly PreparedRow[]): Map<string, Money> {
  const totals = new Map<string, Money>();
  for (const { row } of rows) {
    const currency = row.amount.currency;
    if (!isKnownCurrency(currency)) continue;
    const current = totals.get(currency);
    totals.set(currency, current === undefined ? row.amount : addMinor(current, row.amount));
  }
  return totals;
}
const directionOf = (minorUnits: MinorUnits): "increase" | "decrease" | "unchanged" => (minorUnits > 0 ? "increase" : minorUnits < 0 ? "decrease" : "unchanged");
function comparisonValueState(current: Money, baseline: Money, coverage: Coverage): ValueState {
  return coverage.state === "unknown" ? "unknown" : coverage.state === "partial" ? "incomplete-subtotal" : compareMinor(current, zeroMoney(current.currency)) === 0 && compareMinor(baseline, zeroMoney(baseline.currency)) === 0 ? "zero" : "value";
}
type ContributorAccumulator = { readonly attribution: GiftAttribution; readonly current: Map<string, Money>; readonly baseline: Map<string, Money> };
const ATTRIBUTION_ORDER = ["partner", "anonymous", "unresolved"] as const satisfies readonly GiftAttribution["kind"][];
function buildContributorDeltas(current: readonly PreparedRow[], baselineRows: readonly PreparedRow[]): readonly ContributorDelta[] {
  const accumulators = new Map<string, ContributorAccumulator>();
  for (const row of current) accumulateContributor(accumulators, row, "current");
  for (const row of baselineRows) accumulateContributor(accumulators, row, "baseline");
  const deltas: ContributorDelta[] = [];
  for (const accumulator of accumulators.values()) {
    const currencies = [...new Set([...accumulator.current.keys(), ...accumulator.baseline.keys()])].sort(compareIdentifiers);
    for (const currency of currencies) {
      const currentMoney = accumulator.current.get(currency) ?? zeroMoney(currency);
      const baselineMoney = accumulator.baseline.get(currency) ?? zeroMoney(currency);
      const difference = addMinor(currentMoney, negateMinor(baselineMoney));
      if (difference.minorUnits === 0) continue;
      deltas.push({ currency, minorUnits: difference.minorUnits, attribution: accumulator.attribution, ...(accumulator.attribution.kind === "partner" ? { partnerId: accumulator.attribution.partnerId } : {}) });
    }
  }
  return deltas.sort(compareContributorDeltas);
}
function accumulateContributor(accumulators: Map<string, ContributorAccumulator>, prepared: PreparedRow, slot: "current" | "baseline"): void {
  const row = prepared.row;
  const currency = row.amount.currency;
  if (!isKnownCurrency(currency)) return;
  const accumulator = contributorFor(accumulators, row.attribution);
  const totals = slot === "current" ? accumulator.current : accumulator.baseline;
  const running = totals.get(currency);
  totals.set(currency, running === undefined ? row.amount : addMinor(running, row.amount));
}
const contributorFor = (accumulators: Map<string, ContributorAccumulator>, attribution: GiftAttribution): ContributorAccumulator => forKey(accumulators, attributionKey(attribution), () => ({ attribution, current: new Map<string, Money>(), baseline: new Map<string, Money>() }));
/** The value a map holds for one key, built by the caller's own factory the first time it is asked for: a currency, bucket or contributor tally is created once per read. */
function forKey<Value>(map: Map<string, Value>, key: string, create: () => Value): Value {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = create();
  map.set(key, created);
  return created;
}
function compareContributorDeltas(left: ContributorDelta, right: ContributorDelta): number {
  const byCurrency = compareIdentifiers(left.currency, right.currency);
  if (byCurrency !== 0) return byCurrency;
  const leftKind = left.attribution?.kind ?? "partner";
  const rightKind = right.attribution?.kind ?? "partner";
  const byKind = ATTRIBUTION_ORDER.indexOf(leftKind) - ATTRIBUTION_ORDER.indexOf(rightKind);
  return byKind !== 0 ? byKind : compareIdentifiers(left.partnerId ?? "", right.partnerId ?? "");
}
/** The whole number of contributor changes the comparison counted in each currency, whatever the stated list holds, so a surface can state how many changes it is not listing. */
function contributorDeltaCountsOf(deltas: readonly ContributorDelta[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const delta of deltas) counts[delta.currency] = (counts[delta.currency] ?? 0) + 1;
  return counts;
}
/** The contributor changes a comparison states: in each currency the largest by absolute minor units, ties broken the way the report's own order breaks them, with every stated change returned in that same order so a bounded list still ranks nobody. */
function statedContributorDeltas(deltas: readonly ContributorDelta[]): readonly ContributorDelta[] {
  const byCurrency = new Map<string, ContributorDelta[]>();
  for (const delta of deltas) {
    const listed = byCurrency.get(delta.currency);
    if (listed === undefined) byCurrency.set(delta.currency, [delta]);
    else listed.push(delta);
  }
  const stated: ContributorDelta[] = [];
  for (const listed of byCurrency.values()) stated.push(...largestContributorDeltas(listed));
  return stated.sort(compareContributorDeltas);
}
/** One currency's stated contributor changes: every change when the currency holds no more than the limit, otherwise the largest by absolute minor units taken from a list already in the report's own order, so equal sizes keep it. */
function largestContributorDeltas(deltas: readonly ContributorDelta[]): readonly ContributorDelta[] {
  if (deltas.length <= CONTRIBUTOR_DELTA_LIMIT) return deltas;
  return [...deltas].sort(compareContributorMagnitude).slice(0, CONTRIBUTOR_DELTA_LIMIT);
}
function compareContributorMagnitude(left: ContributorDelta, right: ContributorDelta): number {
  const bySize = Math.abs(right.minorUnits) - Math.abs(left.minorUnits);
  return bySize === 0 ? compareContributorDeltas(left, right) : bySize;
}
function reconciles(perCurrency: ReportComparison["perCurrency"], deltas: readonly ContributorDelta[]): boolean {
  for (const entry of perCurrency) {
    let total = zeroMoney(entry.currency);
    for (const delta of deltas) {
      if (delta.currency !== entry.currency) continue;
      total = addMinor(total, { currency: delta.currency, minorUnits: delta.minorUnits });
    }
    if (compareMinor(total, { currency: entry.currency, minorUnits: entry.differenceMinor }) !== 0) return false;
  }
  return true;
}
type MatrixInput = { readonly query: ReportQuery; readonly buckets: readonly MonthBucket[]; readonly currencies: readonly string[]; readonly rows: readonly PreparedRow[]; readonly coverage: Coverage };
type MatrixAccumulator = { readonly attribution: GiftAttribution; readonly totals: Map<string, (Money | undefined)[]>; readonly counts: Map<string, number[]> };
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
    if (index < 0 || index >= bucketCount) continue;
    const counts = bucketCountsFor(accumulator.counts, currency, bucketCount);
    counts[index] = (counts[index] ?? 0) + 1;
    if (!isKnownCurrency(currency)) continue;
    const totals = bucketTotalsFor(accumulator.totals, currency, bucketCount);
    const running = totals[index];
    totals[index] = running === undefined ? row.amount : addMinor(running, row.amount);
  }
  // The rows are ordered over the whole result before the page window is taken, so the total is the whole result's row count and the served rows sit at the position the whole result holds them at.
  const ordered = [...accumulators.values()].sort((left, right) => compareAttributions(left.attribution, right.attribution));
  const served = matrixWindowOf(ordered.length, input.query.page);
  const rows = ordered.slice(served.start, served.start + served.size).map((accumulator) => matrixRowOf(accumulator, input));
  return { currencies: input.currencies, months: input.buckets.map((bucket) => ({ start: bucket.start, end: bucket.end })), rows, total: ordered.length, page: served.page };
}
/** The row window a matrix serves: the page grammar every list serves, with a stated index clamped into the pages the whole result has, so a stale address states a page rather than an empty matrix. */
function matrixWindowOf(total: number, page: ReportQuery["page"]): { readonly start: number; readonly size: number; readonly page: PageWindow } {
  const size = clampPageSize(page?.size);
  const totalPages = totalPagesOf(total, size);
  const index = totalPages === 0 ? 0 : Math.min(Math.max(0, page?.index ?? 0), totalPages - 1);
  return { start: index * size, size, page: { index, size, totalPages } };
}
function matrixRowOf(accumulator: MatrixAccumulator, input: MatrixInput): MatrixRow {
  return { ...(accumulator.attribution.kind === "partner" ? { partnerId: accumulator.attribution.partnerId } : {}), attribution: accumulator.attribution, label: labelOf(accumulator.attribution), cells: buildMatrixCells(accumulator, input) };
}
const matrixAccumulatorFor = (accumulators: Map<string, MatrixAccumulator>, attribution: GiftAttribution): MatrixAccumulator => forKey(accumulators, attributionKey(attribution), () => ({ attribution, totals: new Map<string, (Money | undefined)[]>(), counts: new Map<string, number[]>() }));
const bucketTotalsFor = (totals: Map<string, (Money | undefined)[]>, currency: string, bucketCount: number): (Money | undefined)[] => forKey(totals, currency, () => Array.from({ length: bucketCount }, (): Money | undefined => undefined));
const bucketCountsFor = (counts: Map<string, number[]>, currency: string, bucketCount: number): number[] => forKey(counts, currency, () => Array.from({ length: bucketCount }, () => 0));
function buildMatrixCells(accumulator: MatrixAccumulator, input: MatrixInput): readonly MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const currency of input.currencies) {
    const counts = accumulator.counts.get(currency);
    const totals = accumulator.totals.get(currency);
    for (const [index, bucket] of input.buckets.entries()) cells.push(statedPoint(bucket, currency, counts?.[index] ?? 0, totals?.[index], input.coverage));
  }
  return cells;
}
/** The query a matrix cell stands for: the result's own query narrowed to that cell's month, attribution and currency, carrying no page window, so the rows it reads are a subset of the result's rows and their sums add to the cell. */
export function matrixDrilldownQuery(query: ReportQuery, attribution: GiftAttribution, currency: string, bucketStart: CivilDate, bucketEnd: CivilDate): ReportQuery {
  return { ...query, period: { kind: "explicit", from: bucketStart, to: bucketEnd }, partner: attribution, currency: { kind: "one", currency }, page: undefined };
}
const attributionKey = (attribution: GiftAttribution): string => (attribution.kind === "partner" ? `partner:${attribution.partnerId}` : attribution.kind);
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
/** The matrix's one order — partners by their own reference, then the two unnamed attributions — taken over the whole result so a served page is a slice of that one ordering. */
function compareAttributions(left: GiftAttribution, right: GiftAttribution): number {
  const byKind = ATTRIBUTION_ORDER.indexOf(left.kind) - ATTRIBUTION_ORDER.indexOf(right.kind);
  return byKind !== 0 ? byKind : compareIdentifiers(left.kind === "partner" ? left.partnerId : "", right.kind === "partner" ? right.partnerId : "");
}
function buildGoal(goal: SupportGoalRecord, summary: readonly CurrencySummary[], selection: CurrencySelection, coverage: Coverage): GoalProgress {
  const record = goalRecordOf(goal);
  const entry = summary.find((candidate) => candidate.currency === record.currency);
  const currencySelected = selection.kind === "all" || selection.currency === record.currency;
  let numerator: MinorUnits | undefined;
  if (currencySelected) {
    const received = entry?.received;
    if (received !== undefined) {
      numerator = received.minorUnits ?? undefined;
    } else if (coverage.state === "complete") numerator = minorUnitsOf(0);
  }
  return goalProgress({ goal: record, measureCompatible: currencySelected, ...(numerator === undefined ? {} : { numeratorMinor: numerator }) });
}
function goalRecordOf(goal: SupportGoalRecord): GoalRecord {
  const effectiveFrom = parseCivilDate(goal.effectiveFrom);
  if (effectiveFrom.status === "refused") throw new TypeError(`Support goal effective date "${goal.effectiveFrom}" is not a civil date, so the goal cannot be measured against a period. The value is refused rather than replaced by today.`);
  const revision = Number(goal.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError(`Support goal revision "${goal.revision}" is not a positive whole revision, so no goal is presented against a revision nobody read.`);
  return { minorUnits: goal.amount.minorUnits, currency: goal.amount.currency, measure: GOAL_MEASURE, effectiveFrom: effectiveFrom.date, revision };
}
type ValueStateInput = { readonly summary: readonly CurrencySummary[]; readonly series: readonly SeriesPoint[]; readonly rows: readonly ReportRow[]; readonly comparison?: ReportComparison };
function collectValueStates(input: ValueStateInput): Readonly<Record<string, ValueState>> {
  const states: Record<string, ValueState> = {};
  for (const entry of input.summary) {
    states[`summary.${entry.currency}.received`] = entry.received.valueState;
    states[`summary.${entry.currency}.giftCount`] = entry.giftCount.valueState;
    states[`summary.${entry.currency}.allocationCount`] = entry.allocationCount.valueState;
    states[`summary.${entry.currency}.donorCount`] = entry.donorCount.valueState;
  }
  for (const point of input.series) states[`series.${point.currency}.${serialiseCivilDate(point.bucketStart)}`] = point.value.valueState;
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
  return states;
}
type AttributionCount = { readonly attribution: GiftAttribution; count: number };
/** The values one filtered result holds, counted over the same rows its summary is computed from: a designation its rows carry and an attribution they name, each with the state its count is stated in. */
function buildFacets(rows: readonly PreparedRow[], coverage: Coverage): ReportFacets {
  const designations = new Map<string, number>();
  const attributions = new Map<string, AttributionCount>();
  for (const { row } of rows) {
    if (row.designation !== undefined) designations.set(row.designation, (designations.get(row.designation) ?? 0) + 1);
    const counted = forKey(attributions, attributionKey(row.attribution), () => ({ attribution: row.attribution, count: 0 }));
    counted.count += 1;
  }
  return {
    designations: [...designations.entries()].sort(([left], [right]) => compareIdentifiers(left, right)).map(([designation, count]) => ({ designation, ...statedCount(count, coverage) })),
    attributions: [...attributions.values()].sort((left, right) => compareAttributions(left.attribution, right.attribution)).map((counted) => ({ attribution: counted.attribution, ...statedCount(counted.count, coverage) })),
  };
}
