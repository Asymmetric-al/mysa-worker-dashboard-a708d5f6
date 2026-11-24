"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { asOfInstant, fetchRead } from "@/lib/read-transport";
import type { reads } from "@/modules/data-service";
import type { FinancialCoverage, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { minorUnitsOf, type MinorUnits } from "@/modules/money/amount";
export const GIFTS_PAGE_SIZE_DEFAULT = 50;
export const GIFTS_PAGE_SIZE_CAP = 200;
export type GiftPeriodQuery = { readonly kind: "preset"; readonly preset: string } | { readonly kind: "custom"; readonly from: string; readonly to: string };
export type GiftCurrencyQuery = { readonly kind: "all" } | { readonly kind: "one"; readonly currency: string; readonly amountRange?: { readonly minMinor?: MinorUnits; readonly maxMinor?: MinorUnits } };
export type GiftRecipientQuery = { readonly kind: "any" } | { readonly kind: "partner"; readonly partnerId: string } | { readonly kind: "anonymous" } | { readonly kind: "unresolved" };
export interface GiftsQuery {
  readonly period: GiftPeriodQuery;
  readonly currency: GiftCurrencyQuery;
  readonly recipient: GiftRecipientQuery;
  readonly designation?: string;
  readonly method?: string;
  readonly search?: string;
  readonly sort?: { readonly key: string; readonly direction: "asc" | "desc" };
  readonly page: number;
  readonly pageSize: number;
}
const PARAM = {
  period: "period",
  from: "from",
  to: "to",
  currency: "currency",
  amountMin: "amountMin",
  amountMax: "amountMax",
  recipient: "recipient",
  partnerId: "partnerId",
  designation: "designation",
  method: "method",
  search: "search",
  sortField: "sortField",
  sortDirection: "sortDirection",
  page: "page",
  pageSize: "pageSize",
  record: "record",
} as const;
/** The preset this ledger's query states when the address states no period: the same default `readGifts` applies from `DEFAULT_PERIOD` in `modules/data-service/reads/support.ts`, so the period the read is narrowed to is the period the query states. */
export const GIFTS_DEFAULT_PERIOD_PRESET = "this-month";
const FIRST_PAGE = 0;
const SIGNED_INTEGER_PATTERN = /^-?\d+$/;
/** Writes a ledger query as URL parameters, in the service's vocabulary, so a detail visit, a drilldown and a browser Back all restore the exact view the worker left. */ export function toGiftsParams(query: GiftsQuery): URLSearchParams {
  const { period, currency, recipient, sort } = query;
  const range = currency.kind === "one" ? currency.amountRange : undefined;
  const stated: readonly (readonly [string, string | undefined])[] = [
    [PARAM.period, period.kind === "custom" ? undefined : period.preset],
    [PARAM.from, period.kind === "custom" ? period.from : undefined],
    [PARAM.to, period.kind === "custom" ? period.to : undefined],
    [PARAM.currency, currency.kind === "one" ? currency.currency : undefined],
    [PARAM.amountMin, range?.minMinor === undefined ? undefined : String(range.minMinor)],
    [PARAM.amountMax, range?.maxMinor === undefined ? undefined : String(range.maxMinor)],
    [PARAM.recipient, recipient.kind === "any" ? undefined : recipient.kind],
    [PARAM.partnerId, recipient.kind === "partner" ? recipient.partnerId : undefined],
    [PARAM.designation, query.designation],
    [PARAM.method, query.method],
    [PARAM.search, query.search],
    [PARAM.sortField, sort?.key],
    [PARAM.sortDirection, sort?.direction],
    [PARAM.page, String(query.page)],
    [PARAM.pageSize, String(query.pageSize)],
  ];
  const params = new URLSearchParams();
  for (const [key, value] of stated) if (value !== undefined) params.set(key, value);
  return params;
} /** Reads a query string back into the ledger's state, omitting every facet it cannot read rather than guessing at one — while the page index, the page size and the preset of a period the URL states nothing about fall back to their own defaults. */
export function parseGiftsQuery(source: URLSearchParams | string): GiftsQuery {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  const from = params.get(PARAM.from);
  const to = params.get(PARAM.to);
  const statedPreset = params.get(PARAM.period); // A preset the address states nothing about, or states as empty, is the default this ledger and the read both apply: no address leaves the period unstated.
  const period: GiftPeriodQuery = from !== null && to !== null ? { kind: "custom", from, to } : { kind: "preset", preset: statedPreset === null || statedPreset === "" ? GIFTS_DEFAULT_PERIOD_PRESET : statedPreset };
  const currencyCode = params.get(PARAM.currency);
  const range = amountRangeOf(params);
  const statedRecipient = params.get(PARAM.recipient);
  const partnerId = params.get(PARAM.partnerId);
  const recipient: GiftRecipientQuery = statedRecipient === "partner" && partnerId !== null ? { kind: "partner", partnerId } : statedRecipient === "anonymous" ? { kind: "anonymous" } : statedRecipient === "unresolved" ? { kind: "unresolved" } : { kind: "any" };
  const sortField = params.get(PARAM.sortField);
  const sortDirection = params.get(PARAM.sortDirection);
  const designation = params.get(PARAM.designation);
  const method = params.get(PARAM.method);
  const search = params.get(PARAM.search);
  return {
    period,
    currency: currencyCode === null ? { kind: "all" } : { kind: "one", currency: currencyCode, ...(range === undefined ? {} : { amountRange: range }) },
    recipient,
    ...(designation === null ? {} : { designation }),
    ...(method === null ? {} : { method }),
    ...(search === null ? {} : { search }),
    ...(sortField === null || (sortDirection !== "asc" && sortDirection !== "desc") ? {} : { sort: { key: sortField, direction: sortDirection } }),
    page: nonNegativeIntegerOf(params.get(PARAM.page)) ?? FIRST_PAGE,
    pageSize: statedPageSize(params.get(PARAM.pageSize)),
  };
}
function amountRangeOf(params: URLSearchParams): { readonly minMinor?: MinorUnits; readonly maxMinor?: MinorUnits } | undefined {
  const minMinor = statedMinorUnitsOf(params.get(PARAM.amountMin));
  const maxMinor = statedMinorUnitsOf(params.get(PARAM.amountMax));
  return minMinor === undefined && maxMinor === undefined ? undefined : { ...(minMinor === undefined ? {} : { minMinor }), ...(maxMinor === undefined ? {} : { maxMinor }) };
}
function integerOf(value: string | null): number | undefined {
  if (value === null || !SIGNED_INTEGER_PATTERN.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
const statedPageSize = (value: string | null): number => {
  const parsed = integerOf(value);
  return parsed === undefined || parsed <= FIRST_PAGE ? GIFTS_PAGE_SIZE_DEFAULT : parsed;
};
const statedMinorUnitsOf = (value: string | null): MinorUnits | undefined => {
  const parsed = integerOf(value);
  return parsed === undefined ? undefined : minorUnitsOf(parsed === 0 ? 0 : parsed);
};
const nonNegativeIntegerOf = (value: string | null): number | undefined => {
  const parsed = integerOf(value);
  return parsed === undefined || parsed < FIRST_PAGE ? undefined : parsed;
};
export const GIFTS_STALE_TIME_MS = 60_000;
type GiftsLedgerData = Extract<Awaited<ReturnType<typeof reads.support.readGifts>>, { kind: "envelope" }>["envelope"]["data"];
export type GiftsEnvelope = ReadEnvelope<GiftsLedgerData, FinancialCoverage>;
export type GiftsReadResult = ReadResult<GiftsEnvelope>;
export type UseGiftsOptions = { readonly scope: Scope; readonly query: GiftsQuery; readonly record?: string; readonly initialEnvelope?: GiftsEnvelope };
const isFacetProjection = (value: unknown): boolean => isRecord(value) && Array.isArray(value.designations) && Array.isArray(value.attributions);
const isGiftsLedgerData = (value: unknown): boolean => isRecord(value) && isRecord(value.report) && typeof value.grain === "string" && isFacetProjection(value.facets);
/** Reads `readGifts` for one ledger query in one scope, and for the one record the address names where it names one: the result is `envelope | denied | unavailable | refused` as the contract states those four answers, handed on unwrapped so the caller narrows it. */ export function useGifts(
  options: UseGiftsOptions,
): UseQueryResult<GiftsReadResult, Error> {
  const { scope, query, record, initialEnvelope } = options;
  return useQuery<GiftsReadResult, Error>({
    queryKey: [...scopeKey(scope), "gifts", record ?? null, query],
    // The record an address names is not part of the ledger's own state, so the ledger's parameters carry it on the one request that asks for that record and on no other.
    queryFn: () => {
      const params = toGiftsParams(query);
      if (record !== undefined) params.set(PARAM.record, record);
      return fetchRead<GiftsLedgerData, FinancialCoverage>({ url: `/api/support/gifts?${params.toString()}`, admits: isGiftsLedgerData });
    },
    staleTime: GIFTS_STALE_TIME_MS,
    ...(initialEnvelope === undefined ? {} : { initialData: (): GiftsReadResult => ({ kind: "envelope", envelope: initialEnvelope }), initialDataUpdatedAt: asOfInstant(initialEnvelope.asOf) }),
  });
}
