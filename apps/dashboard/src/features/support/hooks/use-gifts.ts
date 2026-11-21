"use client";

/**
 * The Gifts ledger's browser read: its controlled query state, the two pure helpers that carry that
 * state through a URL, and the one hook that reads it through `reads.readGifts`.
 *
 * Why the state and its transport live together here. Criterion 1 — the decisive one — is whole-query
 * agreement between the on-screen total, the chart series, the table rows, a drilldown, the CSV and
 * the print view, and it is demonstrated by returning to the ledger with its filters, sort and page
 * intact. That return is a property of these URL helpers rather than of a component: losing `page` or
 * `sort` on the way back breaks the criterion even while every figure is right. So the ledger holds
 * one {@link GiftsQuery}, the URL is its exact transport, and {@link toGiftsParams} with
 * {@link parseGiftsQuery} are the only two places that vocabulary is written down.
 *
 * What this file deliberately does not do. It computes nothing: the service owns every filter, sort,
 * page, count and sum over the whole authorised dataset (`readGifts` runs the report engine), so the
 * only page this hook hands on is the page the service returned. A total, a percentage, a re-sorted
 * row set or a second copy of a row would each be a second authority for a figure the engine already
 * answers once.
 * It also invents no facet vocabulary — the period presets, the sort fields, the currencies, the
 * designations and the giving methods are admitted by the service and reported by the envelope, so
 * each travels here as an opaque string. And it reads no clock: nothing below derives a default from
 * the current time, because a query that changed meaning between two reads would make the snapshot
 * identity the six artifacts share impossible to state (AAP 0.8.8, assumption A12).
 *
 * The one rule made unrepresentable. An amount range compares minor units, so it is meaningful under
 * exactly one selected currency and meaningless beside "all currencies". {@link GiftCurrencyQuery}
 * states the range inside its single-currency member only, so this invalid request cannot be built,
 * serialised or parsed into existence — while nothing here silently widens or drops a filter the
 * worker chose: a range is emitted only beside its currency, and a stated range is never cleared.
 *
 * The wire vocabulary (mirrored by the gifts Route Handler, which is this file's only peer):
 * `period` (an admitted preset, opaque here) or `from` + `to` (civil dates, inclusive); `currency`
 * plus `amountMin`/`amountMax` (integers in that currency's minor units); `recipient` (`partner`
 * with `partnerId`, `anonymous`, or `unresolved`; absent means every attribution); `designation`;
 * `method`; `search`; `sortField` + `sortDirection`; `page` (0-based index); `pageSize`; and
 * `giftId`, which is the detail narrowing rather than a second read.
 *
 * The answer is read the way the handler writes it. `toResponse` flattens a read result onto the
 * status, so `200` carries the envelope object itself, `403` the denial and `503` the outage, and no
 * `kind` member wraps any of them — that wrapper is the in-process value this hook answers with, not
 * the wire shape. The status is therefore read first and the body is checked against the arm the
 * status names.
 *
 * The gift detail is this read narrowed by `giftId`. The named inventory has no `readGift`, so the
 * detail route asks the ledger for one gift's row inside the filters it came from, which is also why
 * the narrowing is a field of the query rather than a separate request shape.
 *
 * Layering: a feature hook above the shared component layer and the data-service contracts, and below
 * nothing but the family's own components. It imports `scopeKey` as the only scope-key builder in the
 * application (so the context fence can clear this read with every other), the read-result contract as
 * a type, the envelope's `Scope`, and the money module's `minorUnitsOf`, whose validation is the only
 * way a stated range bound becomes a `MinorUnits` value; no money arithmetic happens here. It reaches
 * no store, no report engine, no Route
 * Handler and no second router; the relative same-origin `fetch` below keeps the session cookie
 * travelling and keeps the server from calling its own HTTP surface.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import type { reads } from "@/modules/data-service";
import type { FinancialCoverage, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { DeniedOutcome, ReadResult, UnavailableOutcome } from "@/modules/data-service/outcome";
import { minorUnitsOf, type MinorUnits } from "@/modules/money/amount";

// ---------------------------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------------------------

/**
 * The number of rows the gifts ledger shows unless the caller states a size.
 *
 * Declared here rather than imported from `@/modules/support/report`, which owns `PAGE_SIZE_DEFAULT`:
 * that module is the report engine, and a runtime import of it would pull the whole engine — and the
 * store projections behind it — into the browser bundle. Mirroring the number is the honest cost of
 * keeping the engine server-side; AAP 0.8.7 is its source, and the service clamps to the cap below
 * whatever a URL states.
 */
export const GIFTS_PAGE_SIZE_DEFAULT = 50;

/** The most rows one page of the ledger may hold, per AAP 0.8.7 (the service clamps to this). */
export const GIFTS_PAGE_SIZE_CAP = 200;

/** A page size the ledger's own control offers. Another well-formed size may still arrive by URL. */
export type GiftsPageSize = typeof GIFTS_PAGE_SIZE_DEFAULT | typeof GIFTS_PAGE_SIZE_CAP;

// ---------------------------------------------------------------------------------------------
// The query state
// ---------------------------------------------------------------------------------------------

/**
 * The period a result is stated for: one of the service's admitted presets, carried opaquely, or two
 * civil dates inclusive at both ends.
 *
 * Presets are not enumerated here because the report engine declares them; a preset this build does
 * not know is one the service refuses with its own message. The range is a pair of civil-date strings
 * rather than `Date` objects, because a report period is a calendar span and never an instant, and no
 * arithmetic is performed on either boundary here.
 */
export type GiftPeriodQuery =
  | { readonly kind: "preset"; readonly preset: string }
  | { readonly kind: "custom"; readonly from: string; readonly to: string };

/**
 * Which currency's amounts the ledger states, with the amount range only where it can mean something.
 *
 * `all` reads every currency present as a partition — never one combined total, because this
 * application holds no exchange rate. `one` states the code, and only that member carries an amount
 * range: a range compares minor units, so it cannot be applied across codes.
 */
export type GiftCurrencyQuery =
  | { readonly kind: "all" }
  | {
      readonly kind: "one";
      readonly currency: string;
      readonly amountRange?: { readonly minMinor?: MinorUnits; readonly maxMinor?: MinorUnits };
    };

/**
 * Which attribution the result is restricted to.
 *
 * The read selects one attribution at a time, so the three the service admits are the three this
 * state can hold — a named partner, anonymous support, and support that supplied no attribution —
 * and each is a complete filter on its own. Anonymous support is a supporter who chose not to be
 * identified and unresolved support is a source row that supplied no attribution at all: two
 * distinct facts, neither of them a missing partner, and neither borrowing a partner's identity in
 * order to be filterable.
 */
export type GiftRecipientQuery =
  | { readonly kind: "any" }
  | { readonly kind: "partner"; readonly partnerId: string }
  | { readonly kind: "anonymous" }
  | { readonly kind: "unresolved" };

/**
 * The gifts ledger's controlled state: the whole of it, in one value, so the URL, the hook key and
 * the toolbar cannot hold three descriptions of the same view.
 *
 * Every faceted member is optional and stated in the service's own vocabulary, because the envelope
 * decides which of them a caller may use and a facet the read did not offer is never invented here.
 * `giftId` narrows the same read to one row for the detail route; it is not a filter and it is not a
 * `readGift`.
 *
 * `pageSize` is the positive integer the view states rather than one of the two sizes the ledger's
 * control offers: the ledger shows 50 rows by default and caps at 200 (AAP 0.6.3, 0.8.1), and any
 * other positive integer a URL or a caller states travels through unchanged, because clamping to the
 * cap is the service's decision and not this module's (AAP 0.8.7).
 */
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

/** The one spelling of every parameter this ledger's URL carries, used for writing and reading. */
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

/**
 * The three attribution kinds a URL distinguishes, in the vocabulary the read accepts.
 *
 * `any` states no restriction and is never emitted, and the other three are the service's own member
 * names — `partner` beside its identifier, `anonymous`, and `unresolved` — because a value the read
 * does not know is a filter the handler refuses rather than one it drops.
 */
const RECIPIENT_PARTNER = "partner";
const RECIPIENT_ANONYMOUS = "anonymous";
const RECIPIENT_UNRESOLVED = "unresolved";

/**
 * What a period reads as when the URL states none.
 *
 * It is the empty preset, not an admitted one: a hand-written or truncated URL must not be turned
 * into a period the worker never chose, and the report gate refuses an unknown preset in words that
 * say no period was assumed in its place. The ledger always states the period it holds, so this
 * sentinel is reachable only from a link that states nothing.
 */
const UNSTATED_PERIOD_PRESET = "";

/** The leading segment of every page index: the ledger's first page. */
const FIRST_PAGE = 0;

// ---------------------------------------------------------------------------------------------
// URL transport
// ---------------------------------------------------------------------------------------------

/**
 * Writes a ledger query as URL parameters, in the service's vocabulary, so a detail visit, a drilldown
 * and a browser Back all restore the exact view the worker left.
 */
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

/**
 * Reads a query string back into the ledger's state, omitting every facet it cannot read rather than
 * guessing at one — while the page index, the page size and the preset of a period the URL never
 * stated fall back to the documented values so the ledger always has a real first view.
 *
 * The argument is a query string with or without its leading `?`, never a URL path. A malformed
 * integer facet is omitted: `page` then falls back to the first page, a stated `pageSize` falls back
 * to the default, and a stated size above the cap is carried through unchanged because clamping is
 * the service's decision and not this module's. Nothing here compares, sorts, counts or filters.
 */
export function parseGiftsQuery(source: URLSearchParams | string): GiftsQuery {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;

  const from = params.get(PARAM.from);
  const to = params.get(PARAM.to);
  const statedPreset = params.get(PARAM.period);
  const period: GiftPeriodQuery =
    from !== null && to !== null
      ? { kind: "custom", from, to }
      : { kind: "preset", preset: statedPreset ?? UNSTATED_PERIOD_PRESET };

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
  /* A sort is carried only as a pair: a field whose direction was not stated orders nothing, and a
   * direction with no field would be a sort the worker never chose. */
  let sort: GiftsQuery["sort"];
  if (sortField !== null && (sortDirection === "asc" || sortDirection === "desc")) {
    sort = { key: sortField, direction: sortDirection };
  }

  /* Each text facet below is carried when its parameter is present, so a facet stated as empty text
   * and a facet the URL omits stay two different things when the URL is read back. */
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

/** The amount range a URL states, or `undefined` when it states no bound at all. */
function amountRangeOf(
  params: URLSearchParams,
): { readonly minMinor?: MinorUnits; readonly maxMinor?: MinorUnits } | undefined {
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

/** Digits with an optional leading sign: the only text this module reads as an integer. */
const SIGNED_INTEGER_PATTERN = /^-?\d+$/;

/**
 * The page size a URL states, read as the ledger will send it.
 *
 * The two sizes the ledger's control offers are the documented default and cap, and a link or a
 * restored URL may state any positive integer beside them. An absent, malformed or non-positive value
 * falls back to the default so the ledger always has a real first view, while a stated size above the
 * cap is carried through as given: AAP 0.8.7 makes clamping the service's decision, so substituting
 * the default here would change the request the worker's own link expressed.
 */
function statedPageSize(value: string | null): number {
  const parsed = integerOf(value);
  if (parsed === undefined || parsed <= FIRST_PAGE) {
    return GIFTS_PAGE_SIZE_DEFAULT;
  }
  return parsed;
}

/**
 * A stated amount bound in minor units; a fractional, unsafe or non-numeric bound is omitted.
 *
 * The bound is built by the money module's own constructor rather than asserted into the brand, so it
 * is the same validated value every other amount in the application is. `integerOf` has already
 * refused everything that is not a safe integer, and a stated negative zero is carried as the zero it
 * means, because refusing it would drop a bound the worker's own link expressed.
 */
function statedMinorUnitsOf(value: string | null): MinorUnits | undefined {
  const parsed = integerOf(value);
  if (parsed === undefined) {
    return undefined;
  }
  return minorUnitsOf(parsed === 0 ? 0 : parsed);
}

/** A signed integer exactly as written, or `undefined` — no rounding, truncation or float parsing. */
function integerOf(value: string | null): number | undefined {
  if (value === null || !SIGNED_INTEGER_PATTERN.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** A page index: an integer that is not negative, or `undefined` so the caller's default applies. */
function nonNegativeIntegerOf(value: string | null): number | undefined {
  const parsed = integerOf(value);
  return parsed === undefined || parsed < FIRST_PAGE ? undefined : parsed;
}

// ---------------------------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------------------------

/** The job segment of this read's cache key, beside the scope `scopeKey` leads with. */
const GIFTS_JOB = "gifts";

/** The one endpoint this ledger reads, relative so the development session cookie travels with it. */
const GIFTS_ENDPOINT = "/api/support/gifts";

/** The three statuses a gifts read answers with: the envelope, a denial and an outage. */
const ENVELOPE_STATUS = 200;
const DENIED_STATUS = 403;
const UNAVAILABLE_STATUS = 503;

/**
 * How long a gifts envelope is treated as fresh.
 *
 * The synthetic store changes only through this application's own mutations, which invalidate the
 * scope's keys, so a short window keeps a drilldown or a return to the ledger from re-running a report
 * nothing has touched. It is a constant and never a clock reading.
 */
export const GIFTS_STALE_TIME_MS = 60_000;

/** What the service answers for a ledger query, as the service itself states it. */
type GiftsServiceResult = Awaited<ReturnType<typeof reads.support.readGifts>>;

/** The data the gifts envelope carries: the one report result for one query and snapshot. */
type GiftsLedgerData = Extract<GiftsServiceResult, { kind: "envelope" }>["envelope"]["data"];

/** The scoped envelope a ledger view renders once it has narrowed the result to `envelope`. */
export type GiftsEnvelope = ReadEnvelope<GiftsLedgerData, FinancialCoverage>;

/** What `readGifts` answers for this ledger: an envelope, a denial, or an unavailable source. */
export type GiftsReadResult = ReadResult<GiftsEnvelope>;

/** What a caller supplies to read the ledger: the authority, the query, and any server-rendered seed. */
export interface UseGiftsOptions {
  /** The exact authority the read runs under; its three key segments lead the cache key. */
  readonly scope: Scope;
  /** The whole controlled state, so every variable the request reads is part of the cache key. */
  readonly query: GiftsQuery;
  /** An envelope the server already rendered for this same query and scope, if the caller has one. */
  readonly initialEnvelope?: GiftsEnvelope;
}

/**
 * Reads `readGifts` for one ledger query in one scope: the result is `envelope | denied | unavailable`
 * as the contract states those three answers, handed on unwrapped so the caller narrows it with
 * `isReadResult`.
 */
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

/**
 * The one error this file raises: an answer no contract describes, named by the request and the
 * status that produced it.
 *
 * It is a plain `Error` on purpose, because the caller renders the query's own error state from it.
 * It is raised rather than answered with a read result: a transport fault and an unrecognised body
 * produced no contract answer at all, and the outage arm this file would otherwise build would have
 * to invent the source identity that arm's honesty depends on.
 */
function noAnswer(status: number, detail: string): Error {
  return new Error(
    `${GIFTS_ENDPOINT} answered ${status} with ${detail}, so this ledger's rows are unavailable.`,
  );
}

/**
 * The body of a response, or the error above when it is not JSON.
 *
 * A page that answers with an HTML error document has no contract answer at all, so this never
 * substitutes an empty object for a body it could not read.
 */
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw noAnswer(response.status, "a body that is not JSON");
  }
}

/**
 * Asks the gifts endpoint for one query's envelope.
 *
 * The status decides which arm the body is, because the handler flattens the read result onto the
 * status and writes that arm's object itself as the body — `200` the envelope, `403` the denial,
 * `503` the outage, with no `kind` member around any of them. A denial and an outage are contract
 * answers and are returned as the arms they are: the surface renders the denial or the outage they
 * state, and neither is ever turned into an empty list or a zero.
 *
 * A status this read does not answer with, or a body that is not the arm its status names, means no
 * contract answer was produced, so the promise rejects and the caller shows the query's own error
 * state as an unavailable read.
 */
async function fetchGifts(query: GiftsQuery): Promise<GiftsReadResult> {
  /* The parameters always state at least a page and a size, so the query string is never empty and the
   * request is always the endpoint's own route rather than a bare path. */
  const stated = toGiftsParams(query).toString();
  const response = await fetch(`${GIFTS_ENDPOINT}?${stated}`, {
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

/**
 * Whether a decoded body is the envelope `readGifts` states: the eight members every read envelope
 * carries, with the ledger's own data — the report and the grain it is stated at — present and of the
 * shape the surface renders it in.
 *
 * The check stops at what a surface would otherwise trip over, because a body missing one of them is a
 * truncated or foreign answer rather than a ledger that found no rows. It is deliberately not a second
 * schema for the figures inside: the data service validated what it wrote, so every row, total and
 * sum here is the service's own.
 */
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

/**
 * Whether a decoded body is the denial a `403` carries. The reason code describes the caller's
 * relationship to the request, never a record, so nothing here can be read as an existence flag.
 */
function isDeniedBody(value: unknown): value is DeniedOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.outcome === "denied" &&
    typeof value.operationId === "string" &&
    typeof value.reasonCode === "string"
  );
}

/**
 * Whether a decoded body is the outage a `503` carries: the source identity and the guidance, both of
 * which a surface states instead of showing an empty ledger or a zero.
 */
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

/**
 * The scenario instant an envelope was evaluated at, in milliseconds, for React Query's
 * `initialDataUpdatedAt`: the seeded data is dated by the read's own `asOf` rather than by now, and an
 * instant that cannot be parsed leaves the seed undated instead of inventing a timestamp.
 */
function asOfInstant(asOf: string): number | undefined {
  const instant = Date.parse(asOf);
  return Number.isFinite(instant) ? instant : undefined;
}
