"use client";
/** The gifts ledger: the bounded filter set beside the one table preset, the paging that preset owns, the snapshot statement the whole-query agreement is read against, and row activation into the … */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import RecordList, { type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import StateNotice from "@/components/state-notice";
import { refusalSummary } from "@/components/form-field";
import QueryToolbar, { type FacetSpec, type FacetValueSpec } from "@/components/query-toolbar";
import { cn } from "@/lib/cn";
import type { ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type MinorUnits, type Money } from "@/modules/money/amount";
import type { CivilDate } from "@/modules/time/civil";
import { EMPTY_STATES, VALUE_STATE_MEANING } from "../copy";
import { reportHref } from "../report-catalog";
import { GIFTS_PAGE_SIZE_CAP, GIFTS_PAGE_SIZE_DEFAULT, parseGiftsQuery, toGiftsParams, useGifts, type GiftCurrencyQuery, type GiftPeriodQuery, type GiftRecipientQuery, type GiftsEnvelope, type GiftsQuery } from "../hooks/use-gifts";
import AmountValue from "./amount-value";
import SnapshotStatement from "./snapshot-statement";
// The contract
/** Props of {@link GiftsLedger}. */
export type GiftsLedgerProps = {
  /** The exact authority this ledger is read under; the service re-derives scope from it on every read. */
  readonly scope: Scope;
  /** The locale amounts and numerals are formatted for. */
  readonly locale: string;
  /** The surface's writing direction: a property of the content, never of the styling. */
  readonly dir?: "ltr" | "rtl";
  /** The envelope a Server Component already read for this URL, offered to the read as its initial data. */
  readonly initialEnvelope?: ReadEnvelope<unknown>;
  /** A query a Server Component resolved, used only while the URL states no query at all. */
  readonly initialQuery?: GiftsQuery;
  readonly className?: string;
};
/** One row of the ledger, taken from the read's own data rather than restated here. */
type GiftLedgerRow = GiftsEnvelope["data"]["report"]["rows"][number];
/** The report the ledger reads. */
type GiftReport = GiftsEnvelope["data"]["report"];
/** One currency's part of the whole result, exactly as the read states it. */
type CurrencySummaryView = GiftReport["summary"][number];
/** One currency's received support, with the state the read recorded for it. */
type StatedAmount = CurrencySummaryView["received"];
/** One exact amount range, both bounds stated: a half-stated range compares nothing. */
interface ExactRange {
  readonly minMinor: MinorUnits;
  readonly maxMinor: MinorUnits;
}
/** The query fields a single change patches; an absent field is unchanged and `null` removes it. */
interface GiftsQueryPatch {
  readonly period?: GiftPeriodQuery;
  readonly currency?: GiftCurrencyQuery;
  readonly recipient?: GiftRecipientQuery;
  readonly designation?: string | null;
  readonly method?: string | null;
  readonly search?: string | null;
  readonly sort?: { readonly key: string; readonly direction: "asc" | "desc" } | null;
  readonly page?: number;
  readonly pageSize?: number;
}
// The facet identities this ledger states, in the one order the toolbar shows them
const PERIOD_FACET = "period";

const CURRENCY_FACET = "currency";

const AMOUNT_RANGE_FACET = "amount-range";

const RECIPIENT_FACET = "attribution";

const DESIGNATION_FACET = "designation";

const METHOD_FACET = "giving-method";

const CUSTOM_PERIOD_PREFIX = "custom";

const FACET_VALUE_SEPARATOR = ":";

const PARTNER_PREFIX = "partner";

const RECIPIENT_ANONYMOUS = "anonymous";

const RECIPIENT_UNRESOLVED = "unresolved";
/** The period a URL states nothing about: no period parameter is sent, so the read's own default period governs. */
const UNSTATED_PERIOD = "";

const FIRST_PAGE = 0;

const GIFT_ROUTE_PREFIX = "/support/gifts";
/** The only fields the report engine orders by, which are also the only sortable column ids. */
const SORTABLE_FIELDS: readonly string[] = ["originalGiftOn", "amountMinor", "designation"];

const PAGE_SIZE_OPTIONS: readonly number[] = [GIFTS_PAGE_SIZE_DEFAULT, GIFTS_PAGE_SIZE_CAP];
/** The amount bands a range is offered in, stated in whole major units and converted with the read's own exponent. */
const AMOUNT_BAND_EDGES: readonly number[] = [100, 500, 1000, 5000];

const AMOUNT_BAND_PREFIX = "band";
/** The widest bound a safe integer count of minor units can state, for the open-ended band. */
const OPEN_BAND_MAX_MINOR = Number.MAX_SAFE_INTEGER;

const DIGITS_PATTERN = /^\d{1,16}$/;
/** The state a row's amount path records, as the read keys it. */
const ROW_STATE_PREFIX = "rows.";
/** The states that need explaining on screen, in the order the legend lists them. */
const LEGEND_STATE_ORDER: readonly ValueState[] = ["incomplete-subtotal", "unknown", "withheld", "unavailable"];
/** The word each value state is named by, so a state is never carried by colour or position alone. */
const STATE_WORDS: Readonly<Record<ValueState, string>> = { value: "Amount recorded", zero: "Zero", unknown: "Unknown amount", withheld: "Withheld", unavailable: "Source unavailable", "incomplete-subtotal": "Incomplete subtotal" };
/** The one word each gift-count state adds beside its number, keyed by the envelope's union so a state is never invented and never left unworded. */
const COUNT_STATE_NOTE: Readonly<Record<ValueState, string | null>> = { value: null, zero: "a recorded zero", unknown: "unknown", withheld: "withheld", unavailable: "source unavailable", "incomplete-subtotal": "counted over partial coverage" };
// Wording
const LEDGER_COPY = {
  filters: "Gift filters",
  search: "Search this ledger",
  period: "Period",
  currency: "Currency",
  amountRange: "Amount range",
  attribution: "Attribution",
  designation: "Designation",
  method: "Giving method",
  table: "Received gifts",
  itemNoun: "gifts",
  giftColumn: "Gift",
  dateColumn: "Gift date",
  amountColumn: "Amount",
  currencyColumn: "Currency",
  designationColumn: "Designation",
  attributionColumn: "Attribution",
  grainColumn: "Grain and correction",
  legendTitle: "How an amount on this page is stated",
  wholeResultTitle: "Whole-result support, by currency",
  wholeResultBody: "These figures are the whole result these filters match, not the rows on this page. Each currency is stated on its own: nothing here is added across currencies and no combined total is stated.",
  wholeResultNoCurrency: "This result states no currency, so there is no whole-result figure to state here. That is not a zero.",
  wholeResultReceived: "received",
  wholeResultGiftCount: (count: string, one: boolean): string => `and ${count} ${one ? "gift" : "gifts"}`,
  amountRangeSingleCurrency: "Amounts in different currencies are not compared, so this range is applied only within one selected currency. Select one currency to compare amounts: a range spans one currency's minor units.",
  amountRangeNoExponent: (currency: string): string => `The source states no exponent for ${currency}, so no amount band can be compared in its minor units.`,
  loadingTitle: "Reading this ledger",
  loadingBody: "The read is in progress. No count, total or empty result is shown until it answers.",
  deniedTitle: "This ledger is not available in the context you are working in",
  unavailableTitle: "The gifts ledger could not be read",
  unavailableBody: "The source behind these gifts answered nothing this surface can state, so the outage is reported rather than an empty ledger or a zero. Nothing was changed; try again in a moment.",
  refusedTitle: "This ledger's request was refused",
  retry: "Try again",
  exportBody: "The received-support report states this same filter set with the CSV download and the printed page, so opening it carries the query you investigated rather than the page on screen.",
  exportLink: "Open the received-support report for this query",
  anonymous: "Anonymous support",
  unattributed: "Unattributed source support",
  partnerReference: "Partner reference",
  notDesignated: "No designation stated",
  wholeGift: "Whole gift",
  allocation: "One allocation of a split gift",
  refund: "A refund of",
  refundAllocation: "A refund allocation of",
  dateNotStated: "The source states no gift date",
  approximateDate: "approximate date",
  unknownDate: "date not stated",
  minorUnits: "minor units",
  openGift: (reference: string): string => `Open gift ${reference}`,
} as const;
/** The service's five admitted period presets. A sixth name is refused by the read, which states the refusal rather than substituting a period. */
const PERIOD_PRESET_VALUES: readonly FacetValueSpec[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-year", label: "This year" },
  { id: "last-year", label: "Last year" },
  { id: "year-to-date", label: "Year to date" },
];
// Readers and guards
function isStatedRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Reads the shape this surface needs out of a server-rendered seed. */
function isGiftsEnvelope(value: ReadEnvelope<unknown>): value is GiftsEnvelope {
  const data: unknown = value.data;
  if (!isStatedRecord(data)) {
    return false;
  }
  const report: unknown = data.report;
  if (!isStatedRecord(report)) {
    return false;
  }
  const snapshot: unknown = report.snapshot;
  if (!Array.isArray(report.rows) || typeof report.total !== "number" || !Array.isArray(report.summary) || !isStatedRecord(snapshot)) {
    return false;
  }
  return isStatedRecord(value.scope) && isStatedRecord(value.coverage) && isStatedRecord(value.valueStates) && typeof value.asOf === "string" && typeof value.revision === "string" && Array.isArray(value.actions);
}
function giftsEnvelopeOf(value: ReadEnvelope<unknown> | undefined): GiftsEnvelope | undefined {
  return value !== undefined && isGiftsEnvelope(value) ? value : undefined;
}
/** A civil date as the ISO day the source stated: no zone, no midnight and no locale-dependent reformatting. */
function civilDateText(date: CivilDate): string {
  return date.toString();
}
/** The word that keeps a non-exact date from reading as an exact one, or `null` for an exact date. */
function datePrecisionWord(precision: string): string | null {
  switch (precision) {
    case "date":
      return null;
    case "approximate":
      return LEDGER_COPY.approximateDate;
    case "unknown":
      return LEDGER_COPY.unknownDate;
    default:
      return LEDGER_COPY.unknownDate;
  }
}
/** The minor-unit exponent the read states for one currency, or `undefined` when it states none. */
function exponentOf(report: GiftReport, currency: string): number | undefined {
  for (const entry of report.summary) {
    if (entry.currency === currency) {
      return entry.exponent;
    }
  }
  return undefined;
}
/** How many minor units one major unit of a currency holds, from the exponent the read stated. */
function minorScale(exponent: number): number | undefined {
  const scale = 10 ** exponent;
  return Number.isSafeInteger(scale) && scale > 0 ? scale : undefined;
}
function bandId(minMinor: MinorUnits, maxMinor: MinorUnits): string {
  return `${AMOUNT_BAND_PREFIX}${FACET_VALUE_SEPARATOR}${minMinor}${FACET_VALUE_SEPARATOR}${maxMinor}`;
}
function wholeMinorUnits(value: string): MinorUnits | undefined {
  if (!DIGITS_PATTERN.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? minorUnitsOf(parsed) : undefined;
}
/** The two bounds a band value states, read back from its own id so a range survives a reload without the read's exponent. */
function boundsOfBand(value: string): ExactRange | undefined {
  const parts = value.split(FACET_VALUE_SEPARATOR);
  if (parts.length !== 3 || parts[0] !== AMOUNT_BAND_PREFIX) {
    return undefined;
  }
  const [, minText, maxText] = parts;
  if (minText === undefined || maxText === undefined) {
    return undefined;
  }
  const minMinor = wholeMinorUnits(minText);
  const maxMinor = wholeMinorUnits(maxText);
  if (minMinor === undefined || maxMinor === undefined || minMinor > maxMinor) {
    return undefined;
  }
  return { minMinor, maxMinor };
}
/** The amount bands offered for one selected currency. */
function amountBands(currency: string, exponent: number, formatNumber: (value: number) => string): readonly FacetValueSpec[] {
  const scale = minorScale(exponent);
  if (scale === undefined) {
    return [];
  }
  const values: FacetValueSpec[] = [];
  let lowerMajor = 0;
  for (const upperMajor of AMOUNT_BAND_EDGES) {
    const label = lowerMajor === 0 ? `Under ${formatNumber(upperMajor)} ${currency}` : `${formatNumber(lowerMajor)} to under ${formatNumber(upperMajor)} ${currency}`;
    values.push({ id: bandId(minorUnitsOf(lowerMajor * scale), minorUnitsOf(upperMajor * scale - 1)), label });
    lowerMajor = upperMajor;
  }
  values.push({ id: bandId(minorUnitsOf(lowerMajor * scale), minorUnitsOf(OPEN_BAND_MAX_MINOR)), label: `${formatNumber(lowerMajor)} and over ${currency}` });
  return values;
}
/** A range whose bounds the read does not let this surface restate in major units, stated as the minor units it is, with the currency it belongs to. */
function minorRangeLabel(range: ExactRange, currency: string, formatNumber: (value: number) => string): string {
  return `${formatNumber(range.minMinor)} ${LEDGER_COPY.minorUnits} to ${formatNumber(range.maxMinor)} ${LEDGER_COPY.minorUnits} ${currency}`;
}
function numberFormatOf(locale: string): (value: number) => string {
  try {
    const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    return (value: number): string => formatter.format(value);
  } catch {
    return (value: number): string => String(value);
  }
}
/** The page size the ledger reads at: the two sizes the pager offers, with the cap as the largest. */
function pageSizeOf(size: number): number {
  if (!Number.isSafeInteger(size) || size <= 0) {
    return GIFTS_PAGE_SIZE_DEFAULT;
  }
  return size >= GIFTS_PAGE_SIZE_CAP ? GIFTS_PAGE_SIZE_CAP : GIFTS_PAGE_SIZE_DEFAULT;
}
// The query state
function completeRange(currency: GiftCurrencyQuery): ExactRange | undefined {
  if (currency.kind !== "one" || currency.amountRange === undefined) {
    return undefined;
  }
  const { minMinor, maxMinor } = currency.amountRange;
  return minMinor === undefined || maxMinor === undefined ? undefined : { minMinor, maxMinor };
}
/** Keeps a stated amount range inside one currency and one of the two page sizes, and drops a range that names no currency: two currencies have no ordering here, so a cross-currency range is never … */
function normalisedQuery(query: GiftsQuery): GiftsQuery {
  const range = completeRange(query.currency);
  const currency: GiftCurrencyQuery = query.currency.kind === "one" ? { kind: "one", currency: query.currency.currency, ...(range === undefined ? {} : { amountRange: range }) } : { kind: "all" };
  return patchGiftsQuery(query, { currency, pageSize: pageSizeOf(query.pageSize), page: query.page < FIRST_PAGE ? FIRST_PAGE : query.page });
}
function patchGiftsQuery(query: GiftsQuery, patch: GiftsQueryPatch): GiftsQuery {
  const designation = patch.designation === undefined ? query.designation : (patch.designation ?? undefined);
  const method = patch.method === undefined ? query.method : (patch.method ?? undefined);
  const search = patch.search === undefined ? query.search : (patch.search ?? undefined);
  const sort = patch.sort === undefined ? query.sort : (patch.sort ?? undefined);
  return {
    period: patch.period ?? query.period,
    currency: patch.currency ?? query.currency,
    recipient: patch.recipient ?? query.recipient,
    ...(designation === undefined ? {} : { designation }),
    ...(method === undefined ? {} : { method }),
    ...(search === undefined ? {} : { search }),
    ...(sort === undefined ? {} : { sort }),
    page: patch.page ?? query.page,
    pageSize: patch.pageSize ?? query.pageSize,
  };
}
/** The facet value a stated period is carried as; a period the URL does not state has no value at all. */
function periodValueOf(period: GiftPeriodQuery): string | undefined {
  if (period.kind === "custom") {
    return `${CUSTOM_PERIOD_PREFIX}${FACET_VALUE_SEPARATOR}${period.from}${FACET_VALUE_SEPARATOR}${period.to}`;
  }
  return period.preset === UNSTATED_PERIOD ? undefined : period.preset;
}
function periodFromValue(value: string | undefined): GiftPeriodQuery {
  if (value === undefined) {
    return { kind: "preset", preset: UNSTATED_PERIOD };
  }
  const parts = value.split(FACET_VALUE_SEPARATOR);
  if (parts.length === 3 && parts[0] === CUSTOM_PERIOD_PREFIX) {
    const [, from, to] = parts;
    if (from !== undefined && to !== undefined && from !== "" && to !== "") {
      return { kind: "custom", from, to };
    }
  }
  return { kind: "preset", preset: value };
}
function partnerIdOf(value: string): string | undefined {
  const prefix = `${PARTNER_PREFIX}${FACET_VALUE_SEPARATOR}`;
  if (!value.startsWith(prefix)) {
    return undefined;
  }
  const partnerId = value.slice(prefix.length);
  return partnerId === "" ? undefined : partnerId;
}
function recipientValueOf(recipient: GiftRecipientQuery): string | undefined {
  switch (recipient.kind) {
    case "partner":
      return `${PARTNER_PREFIX}${FACET_VALUE_SEPARATOR}${recipient.partnerId}`;
    case "anonymous":
      return RECIPIENT_ANONYMOUS;
    case "unresolved":
      return RECIPIENT_UNRESOLVED;
    case "any":
      return undefined;
  }
}
function recipientFromValue(value: string | undefined): GiftRecipientQuery {
  if (value === undefined) {
    return { kind: "any" };
  }
  if (value === RECIPIENT_ANONYMOUS) {
    return { kind: "anonymous" };
  }
  if (value === RECIPIENT_UNRESOLVED) {
    return { kind: "unresolved" };
  }
  const partnerId = partnerIdOf(value);
  return partnerId === undefined ? { kind: "any" } : { kind: "partner", partnerId };
}
/** The currency a facet selection states. */
function currencyFromValue(current: GiftsQuery, currencyValue: string | undefined, rangeValue: string | undefined): GiftCurrencyQuery {
  if (currencyValue === undefined || currencyValue === "") {
    return { kind: "all" };
  }
  const keepsScale = current.currency.kind === "one" && current.currency.currency === currencyValue;
  const range = keepsScale && rangeValue !== undefined ? boundsOfBand(rangeValue) : undefined;
  return { kind: "one", currency: currencyValue, ...(range === undefined ? {} : { amountRange: range }) };
}
function firstApplied(applied: Readonly<Record<string, readonly string[]>>, facetId: string): string | undefined {
  const values = applied[facetId];
  if (values === undefined) {
    return undefined;
  }
  const [first] = values;
  return first;
}
/** The whole query one facet selection states, with the page reset because a narrowed result has a different first page. */
function queryFromApplied(current: GiftsQuery, applied: Readonly<Record<string, readonly string[]>>): GiftsQuery {
  return patchGiftsQuery(current, {
    period: periodFromValue(firstApplied(applied, PERIOD_FACET)),
    currency: currencyFromValue(current, firstApplied(applied, CURRENCY_FACET), firstApplied(applied, AMOUNT_RANGE_FACET)),
    recipient: recipientFromValue(firstApplied(applied, RECIPIENT_FACET)),
    designation: firstApplied(applied, DESIGNATION_FACET) ?? null,
    method: firstApplied(applied, METHOD_FACET) ?? null,
    page: FIRST_PAGE,
  });
}
/** The selection a stated query shows, so the toolbar's chips and its pickers describe the view actually read. */
function appliedOf(query: GiftsQuery): Readonly<Record<string, readonly string[]>> {
  const applied: Record<string, string[]> = {};
  const period = periodValueOf(query.period);
  if (period !== undefined) {
    applied[PERIOD_FACET] = [period];
  }
  if (query.currency.kind === "one") {
    applied[CURRENCY_FACET] = [query.currency.currency];
  }
  const range = completeRange(query.currency);
  if (range !== undefined) {
    applied[AMOUNT_RANGE_FACET] = [bandId(range.minMinor, range.maxMinor)];
  }
  const recipient = recipientValueOf(query.recipient);
  if (recipient !== undefined) {
    applied[RECIPIENT_FACET] = [recipient];
  }
  if (query.designation !== undefined) {
    applied[DESIGNATION_FACET] = [query.designation];
  }
  if (query.method !== undefined) {
    applied[METHOD_FACET] = [query.method];
  }
  return applied;
}
function activeFilterCount(query: GiftsQuery): number {
  let count = 0;
  if (periodValueOf(query.period) !== undefined) {
    count += 1;
  }
  if (query.currency.kind === "one") {
    count += 1;
  }
  if (completeRange(query.currency) !== undefined) {
    count += 1;
  }
  if (query.recipient.kind !== "any") {
    count += 1;
  }
  if (query.designation !== undefined) {
    count += 1;
  }
  if (query.method !== undefined) {
    count += 1;
  }
  if (query.search !== undefined && query.search !== "") {
    count += 1;
  }
  return count;
}
/** The reason the read itself states for a filter it does not admit, so a facet this read refuses says why in the read's own words. */
function unavailableReasonOf(envelope: GiftsEnvelope | undefined, actionName: string): string | undefined {
  if (envelope === undefined) {
    return undefined;
  }
  for (const action of envelope.actions) {
    if (action.name === actionName && !action.available) {
      const reason = action.reason;
      return reason === undefined || reason.trim() === "" ? undefined : reason;
    }
  }
  return undefined;
}
/** The amount one stated whole-result value is rendered from. */
function moneyOf(currency: string, stated: StatedAmount): Money {
  return { currency, minorUnits: stated.minorUnits ?? minorUnitsOf(0) };
}
/** The rule this ledger states for its own amount-range facet where the read states none: a range compares one currency's minor units, so it is never applied across currencies, and a currency the … */
function amountRangeRuleReason(query: GiftsQuery, report: GiftReport | undefined, exponent: number | undefined): string | undefined {
  if (query.currency.kind !== "one") {
    return LEDGER_COPY.amountRangeSingleCurrency;
  }
  if (report === undefined) {
    return undefined;
  }
  return exponent === undefined ? LEDGER_COPY.amountRangeNoExponent(query.currency.currency) : undefined;
}
/** The states present among the amounts the read keyed for the rows it returned, in the legend's fixed order. */
function legendStatesOf(valueStates: Readonly<Record<string, ValueState>>): readonly ValueState[] {
  const present = new Set<ValueState>();
  for (const [path, state] of Object.entries(valueStates)) {
    if (path.startsWith(ROW_STATE_PREFIX)) {
      present.add(state);
    }
  }
  return LEGEND_STATE_ORDER.filter((state) => present.has(state));
}
// The facet values
function periodValuesOf(query: GiftsQuery): readonly FacetValueSpec[] {
  const values: FacetValueSpec[] = [...PERIOD_PRESET_VALUES];
  const custom = periodValueOf(query.period);
  if (query.period.kind === "custom" && custom !== undefined) {
    values.push({ id: custom, label: `${query.period.from} to ${query.period.to}` });
  }
  return values;
}
/** The currencies the read's own result is stated in, with the whole-result gift count it states for each. */
function currencyValuesOf(query: GiftsQuery, report: GiftReport | undefined): readonly FacetValueSpec[] {
  if (report === undefined) {
    return [];
  }
  const counts = new Map<string, { readonly count: number; readonly countState: ValueState }>();
  for (const entry of report.summary) {
    counts.set(entry.currency, { count: entry.giftCount.count, countState: entry.giftCount.valueState });
  }
  const currencies: string[] = [];
  for (const currency of [...report.snapshot.currencies, ...report.summary.map((entry) => entry.currency)]) {
    if (!currencies.includes(currency)) {
      currencies.push(currency);
    }
  }
  const applied = query.currency.kind === "one" ? query.currency.currency : undefined;
  if (applied !== undefined && !currencies.includes(applied)) {
    currencies.push(applied);
  }
  return currencies.map((currency) => {
    const entry = counts.get(currency);
    return entry === undefined ? { id: currency, label: currency } : { id: currency, label: currency, count: entry.count, countState: entry.countState };
  });
}
/** The amount range's values: the bands one selected currency admits, plus any applied range the read no longer lets this surface restate in whole units. */
function amountRangeValuesOf(query: GiftsQuery, selected: string | undefined, exponent: number | undefined, formatNumber: (value: number) => string): readonly FacetValueSpec[] {
  const range = completeRange(query.currency);
  const applied = range === undefined || selected === undefined ? undefined : bandId(range.minMinor, range.maxMinor);
  const bands = selected === undefined || exponent === undefined ? [] : amountBands(selected, exponent, formatNumber);
  const values: FacetValueSpec[] = [];
  if (range !== undefined && applied !== undefined && selected !== undefined) {
    const matching = bands.find((band) => band.id === applied);
    values.push({ id: applied, label: matching?.label ?? minorRangeLabel(range, selected, formatNumber) });
  }
  for (const band of bands) {
    if (band.id !== applied) {
      values.push(band);
    }
  }
  return values;
}
/** The attributions this read admits, with the partner reference a link stated kept visible and clearable. */
function recipientValuesOf(query: GiftsQuery): readonly FacetValueSpec[] {
  const values: FacetValueSpec[] = [];
  if (query.recipient.kind === "partner") {
    values.push({ id: `${PARTNER_PREFIX}${FACET_VALUE_SEPARATOR}${query.recipient.partnerId}`, label: query.recipient.partnerId });
  }
  values.push({ id: RECIPIENT_ANONYMOUS, label: LEDGER_COPY.anonymous }, { id: RECIPIENT_UNRESOLVED, label: LEDGER_COPY.unattributed });
  return values;
}
/** The designation facet offers the designation the query states and nothing else: the read states no vocabulary of designations for this subject, so a list built here would either be the loaded … */
function designationValuesOf(query: GiftsQuery): readonly FacetValueSpec[] {
  return query.designation === undefined ? [] : [{ id: query.designation, label: query.designation }];
}
function methodValuesOf(query: GiftsQuery): readonly FacetValueSpec[] {
  return query.method === undefined ? [] : [{ id: query.method, label: query.method }];
}
function facetsOf(query: GiftsQuery, envelope: GiftsEnvelope | undefined, locale: string): readonly FacetSpec[] {
  const report = envelope?.data.report;
  const selected = query.currency.kind === "one" ? query.currency.currency : undefined;
  const exponent = report === undefined || selected === undefined ? undefined : exponentOf(report, selected);
  const formatNumber = numberFormatOf(locale);
  // The read's own reason wins; where it states none, the rule this ledger applies to the range is
  // stated instead, so a facet with no usable values is never silent about why it has none.
  const rangeReason = unavailableReasonOf(envelope, "filterByAmountRange") ?? amountRangeRuleReason(query, report, exponent);
  const methodReason = unavailableReasonOf(envelope, "filterByMethod");
  return [
    { id: PERIOD_FACET, label: LEDGER_COPY.period, multi: false, values: periodValuesOf(query) },
    { id: CURRENCY_FACET, label: LEDGER_COPY.currency, multi: false, values: currencyValuesOf(query, report) },
    { id: AMOUNT_RANGE_FACET, label: LEDGER_COPY.amountRange, multi: false, values: amountRangeValuesOf(query, selected, exponent, formatNumber), ...(rangeReason === undefined ? {} : { disabledReason: rangeReason }) },
    { id: RECIPIENT_FACET, label: LEDGER_COPY.attribution, multi: false, values: recipientValuesOf(query) },
    { id: DESIGNATION_FACET, label: LEDGER_COPY.designation, multi: false, values: designationValuesOf(query) },
    { id: METHOD_FACET, label: LEDGER_COPY.method, multi: false, values: methodValuesOf(query), ...(methodReason === undefined ? {} : { disabledReason: methodReason }) },
  ];
}
// The cells
const ROW_LINK_CLASS = "rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** The one report that carries this ledger's query out of the application as a CSV file and a printed page. */
const EXPORT_REPORT_HREF = reportHref("received");
/** The parameters that state a window over a result rather than the query itself: the export is the whole query, so they are not carried. */
const PAGE_PARAMS = ["page", "pageSize"] as const;
/** The giving-method facet is this ledger's own vocabulary, and the financial source carries no such field, so the report would refuse a query that named it. */
const METHOD_PARAM = "method";

const MUTED_TEXT_CLASS = "text-muted-foreground";
/** The gift's own date, with the word that keeps an approximate or unstated date from reading as an exact one. */
function GiftDateCell({ row }: { readonly row: GiftLedgerRow }): ReactElement {
  const date = row.originalGiftOn;
  if (date === undefined) {
    return <span className={MUTED_TEXT_CLASS}>{LEDGER_COPY.dateNotStated}</span>;
  }
  const precision = datePrecisionWord(row.datePrecision);
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <bdi className="tabular-figures">{civilDateText(date)}</bdi>
      {precision === null ? null : <span className={cn("text-xs", MUTED_TEXT_CLASS)}>({precision})</span>}
    </span>
  );
}
/** Who a row is attributed to: a partner's own reference, anonymous support, or support the source did not attribute. */
function AttributionCell({ attribution }: { readonly attribution: GiftLedgerRow["attribution"] }): ReactElement {
  switch (attribution.kind) {
    case "partner":
      return (
        <span className="flex flex-col">
          <span className="sr-only">{LEDGER_COPY.partnerReference}</span>
          <bdi className="mono-identifier">{attribution.partnerId}</bdi>
        </span>
      );
    case "anonymous":
      return <span>{LEDGER_COPY.anonymous}</span>;
    case "unresolved":
      return <span>{LEDGER_COPY.unattributed}</span>;
  }
}
/** The row's grain and its correction, explained rather than left to a total: an allocation is part of a split gift, and a refund says which gift it corrects. */
function GrainCell({ row }: { readonly row: GiftLedgerRow }): ReactElement {
  const isAllocation = row.allocationId !== undefined;
  const refundOf = row.refundOf;
  if (refundOf === undefined) {
    return <span>{isAllocation ? LEDGER_COPY.allocation : LEDGER_COPY.wholeGift}</span>;
  }
  return (
    <span className="flex flex-wrap items-baseline gap-x-1">
      <span>{isAllocation ? LEDGER_COPY.refundAllocation : LEDGER_COPY.refund}</span>
      <bdi className="mono-identifier">{refundOf}</bdi>
    </span>
  );
}
/** The states the amounts on this page are stated in, explained in the family's own words. */
function ValueStateLegend({ states }: { readonly states: readonly ValueState[] }): ReactElement | null {
  if (states.length === 0) {
    return null;
  }
  return (
    <div data-slot="value-state-legend" className={cn("flex flex-col gap-1 text-xs", MUTED_TEXT_CLASS)}>
      <h2 className="text-sm font-medium text-foreground">{LEDGER_COPY.legendTitle}</h2>
      <ul className="flex flex-col gap-1">
        {states.map((state) => (
          <li key={state}>
            <span className="font-medium text-foreground">
              <bdi>{STATE_WORDS[state]}</bdi>
            </span>
            {` — ${VALUE_STATE_MEANING[state]}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
/** The whole-result support this query matches, stated once immediately after the snapshot statement: one line per currency, each carrying the read's own received amount and gift count with the state … */
function WholeResultSummary({ summary, locale }: { readonly summary: GiftReport["summary"]; readonly locale: string }): ReactElement {
  const formatNumber = numberFormatOf(locale);
  return (
    <div data-slot="whole-result-summary" className={cn("flex flex-col gap-1 text-xs", MUTED_TEXT_CLASS)}>
      <h2 className="text-sm font-medium text-foreground">{LEDGER_COPY.wholeResultTitle}</h2>
      <p className="leading-snug">{LEDGER_COPY.wholeResultBody}</p>
      {summary.length === 0 ? (
        <p className="leading-snug">{LEDGER_COPY.wholeResultNoCurrency}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {summary.map((entry) => {
            const countNote = COUNT_STATE_NOTE[entry.giftCount.valueState];
            return (
              <li key={entry.currency} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-medium text-foreground">
                  <bdi className="mono-identifier">{entry.currency}</bdi>
                </span>
                <span>{LEDGER_COPY.wholeResultReceived}</span>
                <AmountValue money={moneyOf(entry.currency, entry.received)} valueState={entry.received.valueState} locale={locale} />
                <span>{LEDGER_COPY.wholeResultGiftCount(formatNumber(entry.giftCount.count), entry.giftCount.count === 1)}</span>
                {countNote === null ? null : <span>{`(${countNote})`}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
/** The `/support/gifts` surface: one whole-query ledger over the bounded filter set, with the query kept in the URL. */
export function GiftsLedger({ scope, locale, dir, initialEnvelope, initialQuery, className }: GiftsLedgerProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The URL is the query state: a facet change, a drilldown, a detail visit and the browser's Back
  // button all arrive as the same string, and no local copy of the query is kept beside it. A query a
  // Server Component resolved is used only while the URL states nothing at all.
  const query = useMemo<GiftsQuery>(() => {
    const parsed = parseGiftsQuery(searchParams);
    return normalisedQuery(searchParams.toString() === "" && initialQuery !== undefined ? initialQuery : parsed);
  }, [initialQuery, searchParams]);
  // The URL this component mounted with. React Query supplies `initialData` to every key that holds no
  // data, so an unconditional seed would present the previous view's snapshot as the next view's
  // result; the seed is therefore offered for the mount query only, and every other query is read.
  const [mountParams] = useState<string>(() => toGiftsParams(query).toString());
  const seed = useMemo<GiftsEnvelope | undefined>(() => giftsEnvelopeOf(initialEnvelope), [initialEnvelope]);
  const initialData = seed !== undefined && toGiftsParams(query).toString() === mountParams ? seed : undefined;
  const gifts = useGifts({ scope, query, ...(initialData === undefined ? {} : { initialEnvelope: initialData }) });
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>({});
  // The latest query this component dispatched, so two changes raised in one event — the toolbar
  // clearing the search and then the filters — compose into one view instead of the second overwriting
  // the first from a stale prop.
  const latestQuery = useRef<GiftsQuery>(query);
  useEffect(() => {
    latestQuery.current = query;
  }, [query]);
  const commit = useCallback(
    (next: GiftsQuery) => {
      latestQuery.current = next;
      router.replace(`${pathname}?${toGiftsParams(next).toString()}`, { scroll: false });
    },
    [pathname, router],
  );
  const read = gifts.data;
  const envelope = read !== undefined && read.kind === "envelope" ? read.envelope : undefined;
  // The report this ledger's query is exported from: the same filter set in the same names, with the page window
  // left behind, because an export is the whole query rather than the rows on this page.
  const exportHref = useMemo<string>(() => {
    const params = toGiftsParams(query);
    for (const name of PAGE_PARAMS) {
      params.delete(name);
    }
    params.delete(METHOD_PARAM);
    const stated = params.toString();
    return stated === "" ? EXPORT_REPORT_HREF : `${EXPORT_REPORT_HREF}?${stated}`;
  }, [query]);
  const report = envelope?.data.report;
  const facets = useMemo<readonly FacetSpec[]>(() => facetsOf(query, envelope, locale), [envelope, locale, query]);
  const applied = useMemo<Readonly<Record<string, readonly string[]>>>(() => appliedOf(query), [query]);
  const activeFilters = activeFilterCount(query);
  const handleSearchChange = useCallback(
    (value: string) => {
      commit(patchGiftsQuery(latestQuery.current, { search: value === "" ? null : value, page: FIRST_PAGE }));
    },
    [commit],
  );
  const handleAppliedChange = useCallback(
    (next: Readonly<Record<string, readonly string[]>>) => {
      commit(queryFromApplied(latestQuery.current, next));
    },
    [commit],
  );
  const handleClearFilters = useCallback(() => {
    commit(patchGiftsQuery(latestQuery.current, { period: { kind: "preset", preset: UNSTATED_PERIOD }, currency: { kind: "all" }, recipient: { kind: "any" }, designation: null, method: null, search: null, sort: null, page: FIRST_PAGE }));
  }, [commit]);
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState) => {
      setColumnVisibility(next.columnVisibility);
      const [first] = next.sort;
      const sort: { readonly key: string; readonly direction: "asc" | "desc" } | null = first === undefined || !SORTABLE_FIELDS.includes(first.id) ? null : { key: first.id, direction: first.desc ? "desc" : "asc" };
      commit(patchGiftsQuery(latestQuery.current, { sort, page: Math.max(next.page - 1, FIRST_PAGE), pageSize: pageSizeOf(next.pageSize) }));
    },
    [commit],
  );
  // A page the read states past its own last page — a hand-edited URL, or a result that shrank — is
  // corrected to the last page the read states, so the pager's count and the rows always describe the
  // same window. The page count is the read's own, never a count taken here.
  const statedPage = report?.page;
  useEffect(() => {
    if (statedPage === undefined || statedPage.totalPages <= 0 || statedPage.index < statedPage.totalPages) {
      return;
    }
    commit(patchGiftsQuery(latestQuery.current, { page: statedPage.totalPages - 1 }));
  }, [commit, statedPage]);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<GiftLedgerRow>>>(() => {
    const giftHref = (giftId: string): string => `${GIFT_ROUTE_PREFIX}/${encodeURIComponent(giftId)}?${toGiftsParams(query).toString()}`;
    // The read keys a value state per row path, so an amount is rendered from the state the read
    // recorded for it. A path the read did not key states nothing this surface may show as a number.
    const stateOf = (index: number): ValueState => envelope?.valueStates[`${ROW_STATE_PREFIX}${index}.amount`] ?? "unknown";
    return [
      {
        id: "gift",
        header: LEDGER_COPY.giftColumn,
        enableSorting: false,
        enableHiding: false,
        cell: (context) => (
          <Link href={giftHref(context.row.original.giftId)} aria-label={LEDGER_COPY.openGift(context.row.original.giftId)} className={ROW_LINK_CLASS}>
            <bdi className="mono-identifier">{context.row.original.giftId}</bdi>
          </Link>
        ),
      },
      {
        id: "originalGiftOn",
        header: LEDGER_COPY.dateColumn,
        enableSorting: true,
        // The preset offers a sort control only for a column that states an accessor, and the order
        // itself stays the service's: the accessor reads the value the report engine orders by, so the
        // heading can offer the sort this read already honours. `cell` below keeps the rendering.
        accessorFn: (row) => (row.originalGiftOn === undefined ? "" : civilDateText(row.originalGiftOn)),
        cell: (context) => <GiftDateCell row={context.row.original} />,
      },
      {
        id: "amountMinor",
        header: LEDGER_COPY.amountColumn,
        enableSorting: true,
        accessorFn: (row) => row.amount.minorUnits,
        // A numeric accessor would otherwise cycle to the descending order first, so the heading would
        // start at the largest amount while its two neighbours start at the smallest. The ascending
        // order is the one this heading states first, and the read is what applies it.
        sortDescFirst: false,
        cell: (context) => <AmountValue money={context.row.original.amount} valueState={stateOf(context.row.index)} locale={locale} />,
      },
      { id: "currency", header: LEDGER_COPY.currencyColumn, enableSorting: false, cell: (context) => <bdi className="mono-identifier">{context.row.original.amount.currency}</bdi> },
      {
        id: "designation",
        header: LEDGER_COPY.designationColumn,
        enableSorting: true,
        // An absent designation is the empty string, which is how the read orders a gift the source
        // stated no designation for, so the heading's sort and the read's order describe one result.
        accessorFn: (row) => row.designation ?? "",
        cell: (context) => {
          const designation = context.row.original.designation;
          return designation === undefined ? <span className={MUTED_TEXT_CLASS}>{LEDGER_COPY.notDesignated}</span> : <bdi>{designation}</bdi>;
        },
      },
      { id: "attribution", header: LEDGER_COPY.attributionColumn, enableSorting: false, cell: (context) => <AttributionCell attribution={context.row.original.attribution} /> },
      { id: "grain", header: LEDGER_COPY.grainColumn, enableSorting: false, cell: (context) => <GrainCell row={context.row.original} /> },
    ];
  }, [envelope, locale, query]);
  const listState: RecordListQueryState = { sort: query.sort === undefined ? [] : [{ id: query.sort.key, desc: query.sort.direction === "desc" }], page: query.page + 1, pageSize: query.pageSize, columnVisibility };
  const retry = {
    label: LEDGER_COPY.retry,
    onClick: () => {
      void gifts.refetch();
    },
  };
  let content: ReactElement | null;
  if (gifts.isPending) {
    // The read has not answered yet, so nothing is counted and no empty result is implied. The
    // preset's own empty notice would print "No gifts" beside its skeletons, so the honest loading
    // surface is the shared one.
    content = <StateNotice kind="loading" title={LEDGER_COPY.loadingTitle} description={LEDGER_COPY.loadingBody} headingLevel={2} loadingLines={6} />;
  } else if (read === undefined) {
    content = <StateNotice kind="unavailable" title={LEDGER_COPY.unavailableTitle} description={LEDGER_COPY.unavailableBody} retry={retry} headingLevel={2} />;
  } else if (read.kind === "denied") {
    // A denial states no count, title or size: the answer is the same whether or not anything exists
    // in the scope this session may not read.
    content = <StateNotice kind="denied" title={LEDGER_COPY.deniedTitle} reasonCode={read.denied.reasonCode} headingLevel={2} />;
  } else if (read.kind === "unavailable") {
    content = <StateNotice kind="unavailable" title={LEDGER_COPY.unavailableTitle} description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={2} />;
  } else if (read.kind === "refused") {
    // The filters this ledger sent are not ones the read admits: the refusal names them, and the source
    // behind the gifts answered without failing.
    content = <StateNotice kind="refused" title={LEDGER_COPY.refusedTitle} description={refusalSummary(read.refused)} headingLevel={2} />;
  } else {
    const ledger = read.envelope.data.report;
    const snapshot = ledger.snapshot;
    content = (
      <>
        {/* One statement of the grain, basis, currency partition, period, coverage and as-of the whole
            query was read at, so the screen artifact carries the identity criterion 1 compares. */}
        <SnapshotStatement basis={snapshot.basis} currencies={snapshot.currencies} period={{ from: civilDateText(snapshot.period.from), to: civilDateText(snapshot.period.to) }} coverage={read.envelope.coverage} asOf={read.envelope.asOf} isCurrentPeriod={snapshot.period.state === "in-progress"} locale={locale} />
        {/* The whole-result figures the read states for this query, so the total behind the loaded page
            and its page size are stated on the screen rather than only in the pager's count. */}
        <WholeResultSummary summary={ledger.summary} locale={locale} />
        <ValueStateLegend states={legendStatesOf(read.envelope.valueStates)} />
        {ledger.total === 0 && activeFilters === 0 ? (
          <StateNotice kind="empty" title={EMPTY_STATES.gifts.title} description={EMPTY_STATES.gifts.body} action={EMPTY_STATES.gifts.action} headingLevel={2} />
        ) : (
          <RecordList
            label={LEDGER_COPY.table}
            columns={columns}
            rows={ledger.rows}
            rowCount={ledger.total}
            queryState={listState}
            onQueryStateChange={handleQueryStateChange}
            getRowId={(row) => row.giftRowId}
            itemNoun={LEDGER_COPY.itemNoun}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            hasActiveFilters={activeFilters > 0}
            onClearFilters={handleClearFilters}
          />
        )}
      </>
    );
  }
  return (
    <div data-slot="gifts-ledger" dir={dir} className={cn("flex flex-col gap-4", className)}>
      <QueryToolbar
        label={LEDGER_COPY.filters}
        search={{ value: query.search ?? "", onChange: handleSearchChange, placeholder: LEDGER_COPY.search }}
        facets={facets}
        applied={applied}
        onAppliedChange={handleAppliedChange}
        amountRange={{ facetId: AMOUNT_RANGE_FACET, currencyFacetId: CURRENCY_FACET }}
        pending={gifts.isFetching}
      />
      {/* Where the whole query leaves the application: the report surface states this same filter set, its CSV
          download and its printed page, so the query a worker investigated here is the query those artifacts
          carry rather than the page on screen. */}
      <p data-slot="gifts-export-href" className={cn("max-w-prose text-sm text-balance text-muted-foreground md:text-pretty")}>
        {LEDGER_COPY.exportBody}{" "}
        <Link href={exportHref} className={ROW_LINK_CLASS}>
          {LEDGER_COPY.exportLink}
        </Link>
      </p>
      {content}
    </div>
  );
}
export default GiftsLedger;
