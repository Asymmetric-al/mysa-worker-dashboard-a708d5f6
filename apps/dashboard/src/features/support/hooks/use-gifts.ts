"use client";
/**
 * The Gifts ledger's browser read: its controlled query state, the two pure helpers that carry that
 * state through a URL, and the one hook that reads it through `reads.readGifts`.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import type { reads } from "@/modules/data-service";
import type { FinancialCoverage, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { DeniedOutcome, ReadResult, UnavailableOutcome } from "@/modules/data-service/outcome";
import { minorUnitsOf, type MinorUnits } from "@/modules/money/amount";
// Paging
/** The number of rows the gifts ledger shows unless the caller states a size. */
export const GIFTS_PAGE_SIZE_DEFAULT = 50;
/** The most rows one page of the ledger may hold, per AAP 0.8.7 (the service clamps to this). */
export const GIFTS_PAGE_SIZE_CAP = 200;
/** A page size the ledger's own control offers. */
export type GiftsPageSize = typeof GIFTS_PAGE_SIZE_DEFAULT | typeof GIFTS_PAGE_SIZE_CAP;
// The query state
/** The period a result is stated for: one of the service's admitted presets, carried opaquely, or two civil dates inclusive at both ends. */
export type GiftPeriodQuery = { readonly kind: "preset"; readonly preset: string } | { readonly kind: "custom"; readonly from: string; readonly to: string };
/** Which currency's amounts the ledger states, with the amount range only where it can mean something. */
export type GiftCurrencyQuery =
  | { readonly kind: "all" }
  | {
      readonly kind: "one";
      readonly currency: string;
      readonly amountRange?: { readonly minMinor?: MinorUnits; readonly maxMinor?: MinorUnits };
    };
/** Which attribution the result is restricted to. */
export type GiftRecipientQuery = { readonly kind: "any" } | { readonly kind: "partner"; readonly partnerId: string } | { readonly kind: "anonymous" } | { readonly kind: "unresolved" };
/** The gifts ledger's controlled state: the whole of it, in one value, so the URL, the hook key and the toolbar cannot hold three descriptions of the same view. */
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
  readonly giftId?: string;
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
  giftId: "giftId",
} as const;
const RECIPIENT_PARTNER = "partner";
const RECIPIENT_ANONYMOUS = "anonymous";
const RECIPIENT_UNRESOLVED = "unresolved";

const UNSTATED_PERIOD_PRESET = "";

const FIRST_PAGE = 0;
// URL transport
/** Writes a ledger query as URL parameters, in the service's vocabulary, so a detail visit, a drilldown and a browser Back all restore the exact view the worker left. */
export function toGiftsParams(query: GiftsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.period.kind === "preset") {
    if (query.period.preset !== UNSTATED_PERIOD_PRESET) {
      params.set(PARAM.period, query.period.preset);
    }
  } else {
    params.set(PARAM.from, query.period.from);
    params.set(PARAM.to, query.period.to);
  }
  if (query.currency.kind === "one") {
    params.set(PARAM.currency, query.currency.currency);
    const range = query.currency.amountRange;
    if (range?.minMinor !== undefined) {
      params.set(PARAM.amountMin, String(range.minMinor));
    }
    if (range?.maxMinor !== undefined) {
      params.set(PARAM.amountMax, String(range.maxMinor));
    }
  }
  if (query.recipient.kind === RECIPIENT_PARTNER) {
    params.set(PARAM.recipient, RECIPIENT_PARTNER);
    params.set(PARAM.partnerId, query.recipient.partnerId);
  } else if (query.recipient.kind === RECIPIENT_ANONYMOUS) {
    params.set(PARAM.recipient, RECIPIENT_ANONYMOUS);
  } else if (query.recipient.kind === RECIPIENT_UNRESOLVED) {
    params.set(PARAM.recipient, RECIPIENT_UNRESOLVED);
  }
  if (query.designation !== undefined) {
    params.set(PARAM.designation, query.designation);
  }
  if (query.method !== undefined) {
    params.set(PARAM.method, query.method);
  }
  if (query.search !== undefined) {
    params.set(PARAM.search, query.search);
  }
  if (query.sort !== undefined) {
    params.set(PARAM.sortField, query.sort.key);
    params.set(PARAM.sortDirection, query.sort.direction);
  }
  params.set(PARAM.page, String(query.page));
  params.set(PARAM.pageSize, String(query.pageSize));
  if (query.giftId !== undefined) {
    params.set(PARAM.giftId, query.giftId);
  }
  return params;
}
/** Reads a query string back into the ledger's state, omitting every facet it cannot read rather than guessing at one — while the page index, the page size and the preset of a period the URL. */
export function parseGiftsQuery(source: URLSearchParams | string): GiftsQuery {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  const from = params.get(PARAM.from);
  const to = params.get(PARAM.to);
  const statedPreset = params.get(PARAM.period);
  const period: GiftPeriodQuery = from !== null && to !== null ? { kind: "custom", from, to } : { kind: "preset", preset: statedPreset ?? UNSTATED_PERIOD_PRESET };
  const currencyCode = params.get(PARAM.currency);
  const range = amountRangeOf(params);
  const currency: GiftCurrencyQuery =
    currencyCode === null
      ? { kind: "all" }
      : {
          kind: "one",
          currency: currencyCode,
          ...(range === undefined ? {} : { amountRange: range }),
        };
  const statedRecipient = params.get(PARAM.recipient);
  const partnerId = params.get(PARAM.partnerId);
  let recipient: GiftRecipientQuery = { kind: "any" };
  if (statedRecipient === RECIPIENT_PARTNER && partnerId !== null) {
    recipient = { kind: "partner", partnerId };
  } else if (statedRecipient === RECIPIENT_ANONYMOUS) {
    recipient = { kind: "anonymous" };
  } else if (statedRecipient === RECIPIENT_UNRESOLVED) {
    recipient = { kind: "unresolved" };
  }
  const sortField = params.get(PARAM.sortField);
  const sortDirection = params.get(PARAM.sortDirection);
  let sort: GiftsQuery["sort"];
  if (sortField !== null && (sortDirection === "asc" || sortDirection === "desc")) {
    sort = { key: sortField, direction: sortDirection };
  }
  const designation = params.get(PARAM.designation);
  const method = params.get(PARAM.method);
  const search = params.get(PARAM.search);
  const giftId = params.get(PARAM.giftId);
  return {
    period,
    currency,
    recipient,
    ...(designation === null ? {} : { designation }),
    ...(method === null ? {} : { method }),
    ...(search === null ? {} : { search }),
    ...(sort === undefined ? {} : { sort }),
    page: nonNegativeIntegerOf(params.get(PARAM.page)) ?? FIRST_PAGE,
    pageSize: statedPageSize(params.get(PARAM.pageSize)),
    ...(giftId === null ? {} : { giftId }),
  };
}
function amountRangeOf(params: URLSearchParams): { readonly minMinor?: MinorUnits; readonly maxMinor?: MinorUnits } | undefined {
  const minMinor = statedMinorUnitsOf(params.get(PARAM.amountMin));
  const maxMinor = statedMinorUnitsOf(params.get(PARAM.amountMax));
  if (minMinor === undefined && maxMinor === undefined) {
    return undefined;
  }
  return {
    ...(minMinor === undefined ? {} : { minMinor }),
    ...(maxMinor === undefined ? {} : { maxMinor }),
  };
}
const SIGNED_INTEGER_PATTERN = /^-?\d+$/;

function statedPageSize(value: string | null): number {
  const parsed = integerOf(value);
  if (parsed === undefined || parsed <= FIRST_PAGE) {
    return GIFTS_PAGE_SIZE_DEFAULT;
  }
  return parsed;
}
function statedMinorUnitsOf(value: string | null): MinorUnits | undefined {
  const parsed = integerOf(value);
  if (parsed === undefined) {
    return undefined;
  }
  return minorUnitsOf(parsed === 0 ? 0 : parsed);
}
function integerOf(value: string | null): number | undefined {
  if (value === null || !SIGNED_INTEGER_PATTERN.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
function nonNegativeIntegerOf(value: string | null): number | undefined {
  const parsed = integerOf(value);
  return parsed === undefined || parsed < FIRST_PAGE ? undefined : parsed;
}
// The read
const GIFTS_JOB = "gifts";

const GIFTS_ENDPOINT = "/api/support/gifts";

const ENVELOPE_STATUS = 200;
const DENIED_STATUS = 403;
const UNAVAILABLE_STATUS = 503;
/** How long a gifts envelope is treated as fresh. */
export const GIFTS_STALE_TIME_MS = 60_000;

type GiftsServiceResult = Awaited<ReturnType<typeof reads.support.readGifts>>;

type GiftsLedgerData = Extract<GiftsServiceResult, { kind: "envelope" }>["envelope"]["data"];
/** The scoped envelope a ledger view renders once it has narrowed the result to `envelope`. */
export type GiftsEnvelope = ReadEnvelope<GiftsLedgerData, FinancialCoverage>;
/** What `readGifts` answers for this ledger: an envelope, a denial, or an unavailable source. */
export type GiftsReadResult = ReadResult<GiftsEnvelope>;
/** What a caller supplies to read the ledger: the authority, the query, and any server-rendered seed. */
export interface UseGiftsOptions {
  readonly scope: Scope;
  readonly query: GiftsQuery;
  readonly initialEnvelope?: GiftsEnvelope;
}
/** Reads `readGifts` for one ledger query in one scope: the result is `envelope | denied | unavailable` as the contract states those three answers, handed on unwrapped so the caller narrows it. */
export function useGifts(options: UseGiftsOptions): UseQueryResult<GiftsReadResult, Error> {
  const { scope, query, initialEnvelope } = options;
  return useQuery<GiftsReadResult, Error>({
    queryKey: [...scopeKey(scope), GIFTS_JOB, query],
    queryFn: () => fetchGifts(query),
    staleTime: GIFTS_STALE_TIME_MS,
    ...(initialEnvelope === undefined
      ? {}
      : {
          initialData: (): GiftsReadResult => ({ kind: "envelope", envelope: initialEnvelope }),
          initialDataUpdatedAt: asOfInstant(initialEnvelope.asOf),
        }),
  });
}
function noAnswer(status: number, detail: string): Error {
  return new Error(`${GIFTS_ENDPOINT} answered ${status} with ${detail}, so this ledger's rows are unavailable.`);
}
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw noAnswer(response.status, "a body that is not JSON");
  }
}
async function fetchGifts(query: GiftsQuery): Promise<GiftsReadResult> {
  // The URL carries the list state; this request states only the filter set the read accepts, so the row a
  // detail surface locates by `giftId` stays in the address bar rather than travelling as a filter the
  // read does not declare.
  const requested = toGiftsParams(query);
  requested.delete(PARAM.giftId);
  const response = await fetch(`${GIFTS_ENDPOINT}?${requested.toString()}`, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  const body = await readJsonBody(response);
  switch (response.status) {
    case ENVELOPE_STATUS:
      if (!isGiftsEnvelope(body)) {
        throw noAnswer(response.status, "a body that is not a gifts envelope");
      }
      return { kind: "envelope", envelope: body };
    case DENIED_STATUS:
      if (!isDeniedBody(body)) {
        throw noAnswer(response.status, "a body that is not a denial");
      }
      return { kind: "denied", denied: body };
    case UNAVAILABLE_STATUS:
      if (!isUnavailableBody(body)) {
        throw noAnswer(response.status, "a body that is not an unavailable source");
      }
      return { kind: "unavailable", unavailable: body };
    default:
      throw noAnswer(response.status, "a status this read does not answer with");
  }
}
function isGiftsEnvelope(value: unknown): value is GiftsEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  const { data, scope, coverage, valueStates, actions, asOf, revision } = value;
  return (
    isRecord(data) &&
    isRecord(data.report) &&
    typeof data.grain === "string" &&
    isRecord(scope) &&
    isRecord(coverage) &&
    isRecord(valueStates) &&
    Array.isArray(actions) &&
    typeof asOf === "string" &&
    typeof revision === "string"
  );
}
function isDeniedBody(value: unknown): value is DeniedOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return value.outcome === "denied" && typeof value.operationId === "string" && typeof value.reasonCode === "string";
}
function isUnavailableBody(value: unknown): value is UnavailableOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const source = value.source;
  return (
    value.outcome === "unavailable" &&
    typeof value.operationId === "string" &&
    typeof value.guidance === "string" &&
    isRecord(source) &&
    typeof source.system === "string" &&
    typeof source.reference === "string"
  );
}
function asOfInstant(asOf: string): number | undefined {
  const instant = Date.parse(asOf);
  return Number.isFinite(instant) ? instant : undefined;
}
