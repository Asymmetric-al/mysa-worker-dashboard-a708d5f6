"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import RecordList, { type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import StateNotice from "@/components/state-notice";
import { refusalSummary } from "@/components/form-field";
import QueryToolbar, { type FacetSpec, type FacetValueSpec } from "@/components/query-toolbar";
import { cn } from "@/lib/cn";
import { countTextOf } from "@/lib/count-format";
import { isRecord } from "@/lib/guards";
import type { GiftAttribution, ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type MinorUnits } from "@/modules/money/amount";
import type { ReportFacets } from "@/modules/support/report";
import type { CivilDate } from "@/modules/time/civil";
import { COUNT_STATE_NOTE, EMPTY_STATES, VALUE_STATE_MEANING } from "../copy";
import { reportHref } from "../report-catalog";
import { GIFTS_DEFAULT_PERIOD_PRESET, GIFTS_PAGE_SIZE_CAP, GIFTS_PAGE_SIZE_DEFAULT, parseGiftsQuery, toGiftsParams, useGifts, type GiftCurrencyQuery, type GiftPeriodQuery, type GiftRecipientQuery, type GiftsEnvelope, type GiftsQuery } from "../hooks/use-gifts";
import AmountValue from "./amount-value";
import SnapshotStatement from "./snapshot-statement";
export type GiftsLedgerProps = { readonly scope: Scope; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly initialEnvelope?: ReadEnvelope<unknown>; readonly initialQuery?: GiftsQuery; readonly className?: string };
type GiftLedgerRow = GiftsEnvelope["data"]["report"]["rows"][number];
type GiftReport = GiftsEnvelope["data"]["report"];
type ExactRange = { readonly minMinor: MinorUnits; readonly maxMinor: MinorUnits };
const giftRowIdOf = (row: GiftLedgerRow): string => row.giftRowId;
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
const FACETS = { period: "period", currency: "currency", amountRange: "amount-range", attribution: "attribution", designation: "designation", method: "giving-method" } as const;
const SEPARATOR = ":";
const CUSTOM_PERIOD_PREFIX = "custom";
const PARTNER_PREFIX = "partner";
const FIRST_PAGE = 0;
const SORTABLE_FIELDS: readonly string[] = ["originalGiftOn", "amountMinor", "designation"];
const PAGE_SIZE_OPTIONS: readonly number[] = [GIFTS_PAGE_SIZE_DEFAULT, GIFTS_PAGE_SIZE_CAP]; /** The one report that carries this ledger's query out of the application as a CSV file and a printed page. */
/** The parameters that state a window over a result rather than the query itself: an export is the whole query, so they are left behind. */ const PAGE_PARAMS: readonly string[] = ["page", "pageSize"];
/** The giving-method facet is this ledger's own vocabulary and the financial source carries no such field, so the report would refuse a query that named it. */ const METHOD_PARAM = "method";
const AMOUNT_BAND_EDGES: readonly number[] = [100, 500, 1000, 5000];
const AMOUNT_BAND_PREFIX = "band";
const ROW_STATE_PREFIX = "rows.";
const LEGEND_STATE_ORDER: readonly ValueState[] = ["incomplete-subtotal", "unknown", "withheld", "unavailable"];
const STATE_WORDS: Readonly<Record<ValueState, string>> = { value: "Amount recorded", zero: "Zero", unknown: "Unknown amount", withheld: "Withheld", unavailable: "Source unavailable", "incomplete-subtotal": "Incomplete subtotal" };
const DATE_PRECISION_WORD: Readonly<Record<string, string>> = { approximate: "approximate date", unknown: "date not stated" };
const MUTED_TEXT_CLASS = "text-muted-foreground";
const PERIOD_PRESET_VALUES: readonly FacetValueSpec[] = [
  { id: GIFTS_DEFAULT_PERIOD_PRESET, label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-year", label: "This year" },
  { id: "last-year", label: "Last year" },
  { id: "year-to-date", label: "Year to date" },
];
/** The one notice this ledger states for a period with no gift in it: a period the source does not cover is a gap rather than a zero, and widening the period is the first action a reader actually has, because the ledger always reads one period at a time. */
const GIFTS_EMPTY_DESCRIPTION = "This ledger reads one period at a time, and a period the source does not cover is a gap rather than a zero: a period with no gift in it and a query that selects nothing look the same here and mean different things. Widen the period to read more of the ledger.";
const GIFTS_EMPTY_STATE = <StateNotice kind="empty" title={EMPTY_STATES.gifts.title} description={GIFTS_EMPTY_DESCRIPTION} action={{ label: "Read this year's gifts", href: "/support/gifts?period=this-year" }} headingLevel={2} />;
function isGiftsEnvelope(value: ReadEnvelope<unknown>): value is GiftsEnvelope {
  const data: unknown = value.data;
  if (!isRecord(data)) return false;
  const { report } = data;
  if (!isRecord(report)) return false;
  if (!Array.isArray(report.rows) || typeof report.total !== "number" || !Array.isArray(report.summary) || !isRecord(report.snapshot)) return false;
  const facets: unknown = data.facets; // The facet values this ledger's filters offer are part of the read, so an envelope that states none is not one this ledger can render.
  if (!isRecord(facets) || !Array.isArray(facets.designations) || !Array.isArray(facets.attributions)) return false;
  return isRecord(value.scope) && isRecord(value.coverage) && isRecord(value.valueStates) && typeof value.asOf === "string" && typeof value.revision === "string" && Array.isArray(value.actions);
}
const civilDateText = (date: CivilDate): string => date.toString();
function minorScale(exponent: number): number | undefined {
  const scale = 10 ** exponent;
  return Number.isSafeInteger(scale) && scale > 0 ? scale : undefined;
}
const bandId = (minMinor: MinorUnits, maxMinor: MinorUnits): string => `${AMOUNT_BAND_PREFIX}${SEPARATOR}${minMinor}${SEPARATOR}${maxMinor}`;
function wholeMinorUnits(value: string): MinorUnits | undefined {
  if (!/^\d{1,16}$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? minorUnitsOf(parsed) : undefined;
}
function boundsOfBand(value: string): ExactRange | undefined {
  const [prefix, minText, maxText, ...rest] = value.split(SEPARATOR);
  if (prefix !== AMOUNT_BAND_PREFIX || minText === undefined || maxText === undefined || rest.length > 0) return undefined;
  const minMinor = wholeMinorUnits(minText);
  const maxMinor = wholeMinorUnits(maxText);
  return minMinor === undefined || maxMinor === undefined || minMinor > maxMinor ? undefined : { minMinor, maxMinor };
}
function amountBands(currency: string, exponent: number, formatNumber: (value: number) => string): readonly FacetValueSpec[] {
  const scale = minorScale(exponent);
  if (scale === undefined) return [];
  return [0, ...AMOUNT_BAND_EDGES].map((lowerMajor, index) => {
    const upperMajor = AMOUNT_BAND_EDGES[index];
    const label = upperMajor === undefined ? `${formatNumber(lowerMajor)} and over ${currency}` : lowerMajor === 0 ? `Under ${formatNumber(upperMajor)} ${currency}` : `${formatNumber(lowerMajor)} to under ${formatNumber(upperMajor)} ${currency}`;
    const maxMinor = upperMajor === undefined ? Number.MAX_SAFE_INTEGER : upperMajor * scale - 1;
    return { id: bandId(minorUnitsOf(lowerMajor * scale), minorUnitsOf(maxMinor)), label };
  });
}
const pageSizeOf = (size: number): number => (!Number.isSafeInteger(size) || size <= 0 ? GIFTS_PAGE_SIZE_DEFAULT : size >= GIFTS_PAGE_SIZE_CAP ? GIFTS_PAGE_SIZE_CAP : GIFTS_PAGE_SIZE_DEFAULT);
const completeRange = (currency: GiftCurrencyQuery): ExactRange | undefined => {
  if (currency.kind !== "one" || currency.amountRange === undefined) return undefined;
  const { minMinor, maxMinor } = currency.amountRange;
  return minMinor === undefined || maxMinor === undefined ? undefined : { minMinor, maxMinor };
};
function normalisedQuery(query: GiftsQuery): GiftsQuery {
  const range = completeRange(query.currency);
  const currency: GiftCurrencyQuery = query.currency.kind === "one" ? { kind: "one", currency: query.currency.currency, ...(range === undefined ? {} : { amountRange: range }) } : { kind: "all" };
  const period: GiftPeriodQuery = query.period.kind === "preset" && query.period.preset === "" ? { kind: "preset", preset: GIFTS_DEFAULT_PERIOD_PRESET } : query.period; // A period stated as empty is the default this ledger and the read both apply, so no query reaches the read with no period in it.
  return patchGiftsQuery(query, { period, currency, pageSize: pageSizeOf(query.pageSize), page: query.page < FIRST_PAGE ? FIRST_PAGE : query.page });
}
const stated = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, member]) => member !== undefined)) as T;
const kept = <T,>(next: T | null | undefined, current: T | undefined): T | undefined => (next === undefined ? current : (next ?? undefined));
function patchGiftsQuery(query: GiftsQuery, patch: GiftsQueryPatch): GiftsQuery {
  return stated({
    period: patch.period ?? query.period,
    currency: patch.currency ?? query.currency,
    recipient: patch.recipient ?? query.recipient,
    designation: kept(patch.designation, query.designation),
    method: kept(patch.method, query.method),
    search: kept(patch.search, query.search),
    sort: kept(patch.sort, query.sort),
    page: patch.page ?? query.page,
    pageSize: patch.pageSize ?? query.pageSize,
  });
}
const periodValueOf = (period: GiftPeriodQuery): string => (period.kind === "custom" ? `${CUSTOM_PERIOD_PREFIX}${SEPARATOR}${period.from}${SEPARATOR}${period.to}` : period.preset);
function periodFromValue(value: string | undefined): GiftPeriodQuery {
  if (value === undefined || value === "") return { kind: "preset", preset: GIFTS_DEFAULT_PERIOD_PRESET };
  const [prefix, from, to, ...rest] = value.split(SEPARATOR);
  return prefix === CUSTOM_PERIOD_PREFIX && from !== undefined && to !== undefined && from !== "" && to !== "" && rest.length === 0 ? { kind: "custom", from, to } : { kind: "preset", preset: value };
}
const partnerIdOf = (value: string): string | undefined => {
  const prefix = `${PARTNER_PREFIX}${SEPARATOR}`;
  if (!value.startsWith(prefix)) return undefined;
  const partnerId = value.slice(prefix.length);
  return partnerId === "" ? undefined : partnerId;
};
/** The facet value one attribution is offered and applied under: the partner's own opaque reference, or the kind when no partner is named. */
const attributionValueOf = (attribution: GiftAttribution): string => (attribution.kind === "partner" ? `${PARTNER_PREFIX}${SEPARATOR}${attribution.partnerId}` : attribution.kind);
function recipientFromValue(value: string | undefined): GiftRecipientQuery {
  if (value === undefined) return { kind: "any" };
  if (value === "anonymous") return { kind: "anonymous" };
  if (value === "unresolved") return { kind: "unresolved" };
  const partnerId = partnerIdOf(value);
  return partnerId === undefined ? { kind: "any" } : { kind: "partner", partnerId };
}
function currencyFromValue(current: GiftsQuery, currencyValue: string | undefined, rangeValue: string | undefined): GiftCurrencyQuery {
  if (currencyValue === undefined || currencyValue === "") return { kind: "all" };
  const range = current.currency.kind === "one" && current.currency.currency === currencyValue && rangeValue !== undefined ? boundsOfBand(rangeValue) : undefined;
  return { kind: "one", currency: currencyValue, ...(range === undefined ? {} : { amountRange: range }) };
}
const firstApplied = (applied: Readonly<Record<string, readonly string[]>>, facetId: string): string | undefined => applied[facetId]?.[0];
const queryFromApplied = (current: GiftsQuery, applied: Readonly<Record<string, readonly string[]>>): GiftsQuery =>
  patchGiftsQuery(current, {
    period: periodFromValue(firstApplied(applied, FACETS.period)),
    currency: currencyFromValue(current, firstApplied(applied, FACETS.currency), firstApplied(applied, FACETS.amountRange)),
    recipient: recipientFromValue(firstApplied(applied, FACETS.attribution)),
    designation: firstApplied(applied, FACETS.designation) ?? null,
    method: firstApplied(applied, FACETS.method) ?? null,
    page: FIRST_PAGE,
  });
function appliedOf(query: GiftsQuery): Readonly<Record<string, readonly string[]>> {
  const range = completeRange(query.currency);
  const recipient = query.recipient.kind === "any" ? undefined : attributionValueOf(query.recipient);
  return {
    [FACETS.period]: [periodValueOf(query.period)],
    ...(query.currency.kind === "one" ? { [FACETS.currency]: [query.currency.currency] } : {}),
    ...(range === undefined ? {} : { [FACETS.amountRange]: [bandId(range.minMinor, range.maxMinor)] }),
    ...(recipient === undefined ? {} : { [FACETS.attribution]: [recipient] }),
    ...(query.designation === undefined ? {} : { [FACETS.designation]: [query.designation] }),
    ...(query.method === undefined ? {} : { [FACETS.method]: [query.method] }),
  };
}
/** How many filters the query states: the period is in force on every query — the read applies it when the address states none — so it is counted rather than presented as no filter at all. */
const PERIOD_FILTER_COUNT = 1;
const activeFilterCount = (query: GiftsQuery): number =>
  [query.currency.kind === "one", completeRange(query.currency) !== undefined, query.recipient.kind !== "any", query.designation !== undefined, query.method !== undefined, query.search !== undefined && query.search !== ""].filter(Boolean).length + PERIOD_FILTER_COUNT;
function unavailableReasonOf(envelope: GiftsEnvelope | undefined, actionName: string): string | undefined {
  const action = envelope?.actions.find((candidate) => candidate.name === actionName);
  return action === undefined || action.available ? undefined : action.reason === undefined || action.reason.trim() === "" ? undefined : action.reason;
}
function amountRangeRuleReason(query: GiftsQuery, report: GiftReport | undefined, exponent: number | undefined): string | undefined {
  if (query.currency.kind !== "one") return "Amounts in different currencies are not compared, so this range is applied only within one selected currency. Select one currency to compare amounts: a range spans one currency's minor units.";
  return report === undefined ? undefined : exponent === undefined ? `The source states no exponent for ${query.currency.currency}, so no amount band can be compared in its minor units.` : undefined;
}
const legendStatesOf = (valueStates: Readonly<Record<string, ValueState>>): readonly ValueState[] => {
  const paths = Object.entries(valueStates).filter(([path]) => path.startsWith(ROW_STATE_PREFIX));
  return LEGEND_STATE_ORDER.filter((state) => paths.some(([, recorded]) => recorded === state));
};
function periodValuesOf(query: GiftsQuery): readonly FacetValueSpec[] {
  const { period } = query;
  return period.kind === "custom" ? [...PERIOD_PRESET_VALUES, { id: periodValueOf(period), label: `${period.from} to ${period.to}` }] : [...PERIOD_PRESET_VALUES];
}
function currencyValuesOf(query: GiftsQuery, report: GiftReport | undefined): readonly FacetValueSpec[] {
  if (report === undefined) return [];
  const counts = new Map(report.summary.map((entry): [string, { readonly count: number; readonly countState: ValueState }] => [entry.currency, { count: entry.giftCount.count, countState: entry.giftCount.valueState }]));
  const currencies = [...new Set([...report.snapshot.currencies, ...report.summary.map((entry) => entry.currency), ...(query.currency.kind === "one" ? [query.currency.currency] : [])])];
  return currencies.map((currency) => {
    const entry = counts.get(currency);
    return entry === undefined ? { id: currency, label: currency } : { id: currency, label: currency, count: entry.count, countState: entry.countState };
  });
}
function amountRangeValuesOf(query: GiftsQuery, selected: string | undefined, exponent: number | undefined, formatNumber: (value: number) => string): readonly FacetValueSpec[] {
  const range = completeRange(query.currency);
  const applied = range === undefined || selected === undefined ? undefined : bandId(range.minMinor, range.maxMinor);
  const bands = selected === undefined || exponent === undefined ? [] : amountBands(selected, exponent, formatNumber);
  const restated = range === undefined || applied === undefined || selected === undefined ? [] : [{ id: applied, label: bands.find((band) => band.id === applied)?.label ?? `${formatNumber(range.minMinor)} minor units to ${formatNumber(range.maxMinor)} minor units ${selected}` }];
  return [...restated, ...bands.filter((band) => band.id !== applied)];
}
/** One offered value with the count the read states for it, so a filter states how many rows each value stands for rather than only naming it; a value the read states no count for is offered without one rather than with an invented zero. */
const faceted = (id: string, label: string, counted: { readonly count: number; readonly valueState: ValueState } | undefined): FacetValueSpec => (counted === undefined ? { id, label } : { id, label, count: counted.count, countState: counted.valueState });
const UNNAMED_ATTRIBUTIONS: readonly GiftAttribution[] = [{ kind: "anonymous" }, { kind: "unresolved" }];
const attributionLabelOf = (attribution: GiftAttribution): string => (attribution.kind === "partner" ? attribution.partnerId : attribution.kind === "anonymous" ? "Anonymous support" : "Unattributed source support");
/** The attributions the whole filtered result carries — read from the envelope, never from the rows on this page — each partner named by its own opaque reference with no name looked up for it, with anonymous and unattributed support always offered and a value the address already applies kept even when no row matches it. */
function recipientValuesOf(query: GiftsQuery, facets: ReportFacets | undefined): readonly FacetValueSpec[] {
  const counted = new Map((facets?.attributions ?? []).map((value) => [attributionValueOf(value.attribution), value]));
  const offered = (facets?.attributions ?? []).map((value) => value.attribution);
  const applied: readonly GiftAttribution[] = query.recipient.kind === "any" ? [] : [query.recipient];
  for (const attribution of [...UNNAMED_ATTRIBUTIONS, ...applied]) if (!offered.some((listed) => attributionValueOf(listed) === attributionValueOf(attribution))) offered.push(attribution);
  return offered.map((attribution) => faceted(attributionValueOf(attribution), attributionLabelOf(attribution), counted.get(attributionValueOf(attribution))));
}
/** The designations the whole filtered result carries — read from the envelope, never from the rows on this page — with the value the address already applies kept even when no row matches it. */
function designationValuesOf(query: GiftsQuery, facets: ReportFacets | undefined): readonly FacetValueSpec[] {
  const offered = (facets?.designations ?? []).map((value) => faceted(value.designation, value.designation, value));
  const applied = query.designation;
  return applied === undefined || offered.some((value) => value.id === applied) ? offered : [faceted(applied, applied, undefined), ...offered];
}
function facetsOf(query: GiftsQuery, envelope: GiftsEnvelope | undefined, locale: string): readonly FacetSpec[] {
  const report = envelope?.data.report;
  const selected = query.currency.kind === "one" ? query.currency.currency : undefined;
  const exponent = report === undefined || selected === undefined ? undefined : report.summary.find((entry) => entry.currency === selected)?.exponent;
  const rangeReason = unavailableReasonOf(envelope, "filterByAmountRange") ?? amountRangeRuleReason(query, report, exponent);
  const methodReason = unavailableReasonOf(envelope, "filterByMethod");
  return [
    { id: FACETS.period, label: "Period", multi: false, values: periodValuesOf(query) },
    { id: FACETS.currency, label: "Currency", multi: false, values: currencyValuesOf(query, report) },
    { id: FACETS.amountRange, label: "Amount range", multi: false, values: amountRangeValuesOf(query, selected, exponent, (value: number): string => countTextOf(value, locale)), ...(rangeReason === undefined ? {} : { disabledReason: rangeReason }) },
    { id: FACETS.attribution, label: "Attribution", multi: false, values: recipientValuesOf(query, envelope?.data.facets) },
    { id: FACETS.designation, label: "Designation", multi: false, values: designationValuesOf(query, envelope?.data.facets) },
    { id: FACETS.method, label: "Giving method", multi: false, values: query.method === undefined ? [] : [{ id: query.method, label: query.method }], ...(methodReason === undefined ? {} : { disabledReason: methodReason }) },
  ];
}
function GiftDateCell({ row }: { readonly row: GiftLedgerRow }): ReactElement {
  const date = row.originalGiftOn;
  if (date === undefined) return <span className={MUTED_TEXT_CLASS}>{"The source states no gift date"}</span>;
  const precision = row.datePrecision === "date" ? null : (DATE_PRECISION_WORD[row.datePrecision] ?? "date not stated");
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <bdi className="tabular-figures">{civilDateText(date)}</bdi>
      {precision === null ? null : <span className={cn("text-xs", MUTED_TEXT_CLASS)}>({precision})</span>}
    </span>
  );
}
function AttributionCell({ attribution }: { readonly attribution: GiftLedgerRow["attribution"] }): ReactElement {
  if (attribution.kind === "partner") {
    return (
      <span className="flex flex-col">
        <span className="sr-only">{"Partner reference"}</span>
        <bdi className="mono-identifier">{attribution.partnerId}</bdi>
      </span>
    );
  }
  return <span>{attribution.kind === "anonymous" ? "Anonymous support" : "Unattributed source support"}</span>;
}
function GrainCell({ row }: { readonly row: GiftLedgerRow }): ReactElement {
  const isAllocation = row.allocationId !== undefined;
  const refundOf = row.refundOf;
  if (refundOf === undefined) return <span>{isAllocation ? "One allocation of a split gift" : "Whole gift"}</span>;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1">
      <span>{isAllocation ? "A refund allocation of" : "A refund of"}</span>
      <bdi className="mono-identifier">{refundOf}</bdi>
    </span>
  );
}
function ValueStateLegend({ states }: { readonly states: readonly ValueState[] }): ReactElement | null {
  if (states.length === 0) return null;
  return (
    <div data-slot="value-state-legend" className={cn("flex flex-col gap-1 text-xs", MUTED_TEXT_CLASS)}>
      <h2 className="type-section-title text-foreground">{"How an amount on this page is stated"}</h2>
      <ul className="flex flex-col gap-1">
        {states.map((state) => (
          <li key={state}>
            <bdi className="font-medium text-foreground">{STATE_WORDS[state]}</bdi>
            {` — ${VALUE_STATE_MEANING[state]}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
const WholeResultSummary = ({ summary, locale }: { readonly summary: GiftReport["summary"]; readonly locale: string }): ReactElement => (
  <div data-slot="whole-result-summary" className={cn("flex flex-col gap-1 text-xs", MUTED_TEXT_CLASS)}>
    <h2 className="type-section-title text-foreground">{"Whole-result support, by currency"}</h2>
    <p className="type-supporting">{"These figures are the whole result these filters match, not the rows on this page. Each currency is stated on its own: nothing here is added across currencies and no combined total is stated."}</p>
    {summary.length === 0 ? (
      <p className="type-supporting">{"This result states no currency, so there is no whole-result figure to state here. That is not a zero."}</p>
    ) : (
      <ul className="flex flex-col gap-1">
        {summary.map((entry) => {
          const countNote = COUNT_STATE_NOTE[entry.giftCount.valueState];
          return (
            <li key={entry.currency} className="flex flex-wrap items-baseline gap-x-1.5">
              <bdi className="mono-identifier font-medium text-foreground">{entry.currency}</bdi>
              <span>received</span>
              <AmountValue money={{ currency: entry.currency, minorUnits: entry.received.minorUnits ?? minorUnitsOf(0) }} valueState={entry.received.valueState} locale={locale} />
              <span>{`and ${countTextOf(entry.giftCount.count, locale)} ${entry.giftCount.count === 1 ? "gift" : "gifts"}`}</span>
              {countNote === null ? null : <span>{`(${countNote})`}</span>}
            </li>
          );
        })}
      </ul>
    )}
  </div>
);
/** The `/support/gifts` surface: one whole-query ledger over the bounded filter set, with the query kept in the URL. */ export function GiftsLedger({ scope, locale, dir, initialEnvelope, initialQuery, className }: GiftsLedgerProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo<GiftsQuery>(() => normalisedQuery(searchParams.toString() === "" && initialQuery !== undefined ? initialQuery : parseGiftsQuery(searchParams)), [initialQuery, searchParams]);
  const [mountParams] = useState<string>(() => toGiftsParams(query).toString());
  const seed = useMemo<GiftsEnvelope | undefined>(() => (initialEnvelope !== undefined && isGiftsEnvelope(initialEnvelope) ? initialEnvelope : undefined), [initialEnvelope]);
  const initialData = seed !== undefined && toGiftsParams(query).toString() === mountParams ? seed : undefined;
  const gifts = useGifts({ scope, query, ...(initialData === undefined ? {} : { initialEnvelope: initialData }) });
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>({});
  const latestQuery = useRef<GiftsQuery>(query);
  useEffect(() => {
    latestQuery.current = query;
  }, [query]);
  const commit = useCallback(
    (next: GiftsQuery): void => {
      latestQuery.current = next;
      router.replace(`${pathname}?${toGiftsParams(next).toString()}`, { scroll: false });
    },
    [pathname, router],
  );
  const read = gifts.data;
  const envelope = read !== undefined && read.kind === "envelope" ? read.envelope : undefined;
  const report = envelope?.data.report;
  const facets = useMemo<readonly FacetSpec[]>(() => facetsOf(query, envelope, locale), [envelope, locale, query]);
  const applied = useMemo<Readonly<Record<string, readonly string[]>>>(() => appliedOf(query), [query]);
  // The report this ledger's query is exported from: the same filter set in the same names, with the page window and the
  // ledger-only method facet left behind, because an export is the whole query rather than the rows on this page.
  const exportHref = useMemo<string>(() => {
    const params = toGiftsParams(query);
    for (const name of PAGE_PARAMS) params.delete(name);
    params.delete(METHOD_PARAM);
    const stated = params.toString();
    return stated === "" ? reportHref("received") : `${reportHref("received")}?${stated}`;
  }, [query]);
  const activeFilters = activeFilterCount(query);
  // The period is in force on every query, so only a filter beyond the ledger's own default period narrows the result: an empty default view is an empty period, not a query the reader narrowed.
  const narrowedBeyondDefault = activeFilters > PERIOD_FILTER_COUNT;
  const handleSearchChange = useCallback((value: string): void => commit(patchGiftsQuery(latestQuery.current, { search: value === "" ? null : value, page: FIRST_PAGE })), [commit]);
  const handleAppliedChange = useCallback((next: Readonly<Record<string, readonly string[]>>): void => commit(queryFromApplied(latestQuery.current, next)), [commit]);
  const handleClearFilters = useCallback((): void => commit(patchGiftsQuery(latestQuery.current, { period: { kind: "preset", preset: GIFTS_DEFAULT_PERIOD_PRESET }, currency: { kind: "all" }, recipient: { kind: "any" }, designation: null, method: null, search: null, sort: null, page: FIRST_PAGE })), [commit]);
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState): void => {
      setColumnVisibility(next.columnVisibility);
      const [first] = next.sort;
      const sort: { readonly key: string; readonly direction: "asc" | "desc" } | null = first === undefined || !SORTABLE_FIELDS.includes(first.id) ? null : { key: first.id, direction: first.desc ? "desc" : "asc" };
      commit(patchGiftsQuery(latestQuery.current, { sort, page: Math.max(next.page - 1, FIRST_PAGE), pageSize: pageSizeOf(next.pageSize) }));
    },
    [commit],
  );
  const statedPage = report?.page;
  useEffect(() => {
    if (statedPage === undefined || statedPage.totalPages <= 0 || statedPage.index < statedPage.totalPages) return;
    commit(patchGiftsQuery(latestQuery.current, { page: statedPage.totalPages - 1 }));
  }, [commit, statedPage]);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<GiftLedgerRow>>>(() => {
    const giftHref = (giftId: string): string => `/support/gifts/${encodeURIComponent(giftId)}?${toGiftsParams(query).toString()}`;
    const stateOf = (index: number): ValueState => envelope?.valueStates[`${ROW_STATE_PREFIX}${index}.amount`] ?? "unknown";
    return [
      {
        id: "gift",
        header: "Gift",
        enableSorting: false,
        enableHiding: false,
        cell: (context) => (
          <Link href={giftHref(context.row.original.giftId)} aria-label={`Open gift ${context.row.original.giftId}`} className="inline-flex min-h-6 items-center inline-link rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <bdi className="mono-identifier">{context.row.original.giftId}</bdi>
          </Link>
        ),
      },
      { id: "originalGiftOn", header: "Gift date", enableSorting: true, accessorFn: (row) => (row.originalGiftOn === undefined ? "" : civilDateText(row.originalGiftOn)), cell: (context) => <GiftDateCell row={context.row.original} /> },
      { id: "amountMinor", header: "Amount", enableSorting: true, accessorFn: (row) => row.amount.minorUnits, sortDescFirst: false, cell: (context) => <AmountValue money={context.row.original.amount} valueState={stateOf(context.row.index)} locale={locale} /> },
      { id: "currency", header: "Currency", enableSorting: false, cell: (context) => <bdi className="mono-identifier">{context.row.original.amount.currency}</bdi> },
      { id: "designation", header: "Designation", enableSorting: true, accessorFn: (row) => row.designation ?? "", cell: (context) => (context.row.original.designation === undefined ? <span className={MUTED_TEXT_CLASS}>{"No designation stated"}</span> : <bdi>{context.row.original.designation}</bdi>) },
      { id: "attribution", header: "Attribution", enableSorting: false, cell: (context) => <AttributionCell attribution={context.row.original.attribution} /> },
      { id: "grain", header: "Grain and correction", enableSorting: false, cell: (context) => <GrainCell row={context.row.original} /> },
    ];
  }, [envelope, locale, query]);
  const listState: RecordListQueryState = { sort: query.sort === undefined ? [] : [{ id: query.sort.key, desc: query.sort.direction === "desc" }], page: query.page + 1, pageSize: query.pageSize, columnVisibility };
  const filtersApplied = { hasActiveFilters: narrowedBeyondDefault, onClearFilters: handleClearFilters };
  const retry = { label: "Try again", onClick: (): void => void gifts.refetch() };
  let content: ReactElement | null;
  if (gifts.isPending) {
    content = <StateNotice kind="loading" title="Reading this ledger" description="The read is in progress. No count, total or empty result is shown until it answers." headingLevel={2} loadingLines={6} />;
  } else if (read === undefined) {
    content = <StateNotice kind="unavailable" title="The gifts ledger could not be read" description="The source behind these gifts answered nothing this surface can state, so the outage is reported rather than an empty ledger or a zero. Nothing was changed; try again in a moment." retry={retry} headingLevel={2} />;
  } else if (read.kind === "denied") {
    content = <StateNotice kind="denied" title="This ledger is not available in the context you are working in" reasonCode={read.denied.reasonCode} headingLevel={2} />;
  } else if (read.kind === "unavailable") {
    content = <StateNotice kind="unavailable" title="The gifts ledger could not be read" description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={2} />;
  } else if (read.kind === "refused") {
    content = <StateNotice kind="refused" title="This ledger's request was refused" description={refusalSummary(read.refused)} headingLevel={2} />;
  } else {
    const ledger = read.envelope.data.report;
    const snapshot = ledger.snapshot;
    content = (
      <>
        <SnapshotStatement basis={snapshot.basis} currencies={snapshot.currencies} period={{ from: civilDateText(snapshot.period.from), to: civilDateText(snapshot.period.to) }} coverage={read.envelope.coverage} asOf={read.envelope.asOf} isCurrentPeriod={snapshot.period.state === "in-progress"} locale={locale} />
        <WholeResultSummary summary={ledger.summary} locale={locale} />
        <ValueStateLegend states={legendStatesOf(read.envelope.valueStates)} />
        <RecordList {...filtersApplied} label="Received gifts" columns={columns} rows={ledger.rows} rowCount={ledger.total} queryState={listState} onQueryStateChange={handleQueryStateChange} getRowId={giftRowIdOf} itemNoun="gifts" locale={locale} pageSizeOptions={PAGE_SIZE_OPTIONS} emptyState={GIFTS_EMPTY_STATE} />
      </>
    );
  }
  const searchFacet = { value: query.search ?? "", onChange: handleSearchChange, placeholder: "Search this ledger" };
  return (
    <div data-slot="gifts-ledger" dir={dir} className={cn("flex flex-col gap-4", className)}>
      <QueryToolbar label="Gift filters" search={searchFacet} facets={facets} applied={applied} onAppliedChange={handleAppliedChange} amountRange={{ facetId: FACETS.amountRange, currencyFacetId: FACETS.currency }} pending={gifts.isFetching} locale={locale} />
      {/* Where the whole query leaves the application: the report states this same filter set with its CSV download and
          its printed page, so the query a worker investigated here is the query those artifacts carry. */}
      <p data-slot="gifts-export-href" className={cn("type-supporting max-w-prose text-balance md:text-pretty")}>
        {"The received-support report states this same filter set with the CSV download and the printed page, so opening it carries the query you investigated rather than the page on screen. "}
        <Link {...{ href: exportHref, className: "inline-link rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" }}>{"Open the received-support report for this query"}</Link>
      </p>
      {content}
    </div>
  );
}
export default GiftsLedger;
