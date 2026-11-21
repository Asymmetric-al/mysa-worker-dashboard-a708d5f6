"use client";
/**
 * The Partners roster's browser data layer: its controlled query state, owned by the URL, and the three named reads
 * that describe that state — the whole-dataset roster, the facet set it is filtered by, and the caller's saved views.
 *
 * The URL owns the query so that opening a record and coming back re-issues the identical request: the state is parsed
 * from the query string during render (never mirrored into component state, never fetched from an effect), and every
 * change writes a canonical query string back with `replace`, so the browser's own back navigation restores the list
 * URL and its scroll position together.
 *
 * The service does every piece of work this state describes. Nothing here filters, sorts, pages, matches or totals a
 * record: the whole-result count, the admitted facet set, the available actions and every value state come from the
 * envelope and are handed on untouched.
 */
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { PARTNER_KEY, PartnerReadTransportError, fetchPartnerRead } from "./use-partner-mutations";

// The address, and the jobs it answers
/** The one address the roster's three reads are served from, kept here so a path correction is a single edit. */
export const PARTNERS_READ_PATH = "/api/partners";

/** The query-string parameter the handler dispatches a read job on. */
export const ROSTER_QUERY_PARAM = "job";

/**
 * The three named reads this file issues, each a closed literal that dispatches to exactly one service read: the
 * roster itself, the facet set describing it, and the caller's own saved views. This is a read job per name, not a
 * command dispatcher — a fourth read is a fourth literal and a fourth call site.
 */
export const ROSTER_READ_JOB = { roster: "roster", facets: "facets", savedViews: "saved-views" } as const;

/** One of the three read jobs above. */
export type RosterReadJob = (typeof ROSTER_READ_JOB)[keyof typeof ROSTER_READ_JOB];

/** How many rows one page of the roster states unless the caller asks otherwise. */
export const ROSTER_PAGE_SIZE_DEFAULT = 50;

/** The largest page the roster serves: a request above it is clamped to it, and the whole-result total is unaffected. */
export const ROSTER_PAGE_SIZE_CAP = 200;

// The two grammars: the request the read is asked with, and the URL that state is kept in
/** The parameter names `GET /api/partners` parses, taken from the handler's own grammar rather than invented. */
const READ_PARAM = { search: "search", facet: "facet", sort: "sort", direction: "direction", page: "page", pageSize: "pageSize" } as const;

/** The parameter names this surface keeps its state in. A query change is a URL change, so they are part of the address. */
const URL_PARAM = { search: "q", facet: "facet", sort: "sort", page: "page", size: "size", columns: "columns" } as const;

/** The page a query shows when it names none, and the smallest page either grammar states. */
const FIRST_PAGE = 1;

/** The two sort directions the read admits. */
const SORT_DIRECTIONS = ["asc", "desc"] as const;

/** The separators and markers of the compound URL values: `facetId:value`, `field:direction` and `columnId:1`. */
const VALUE_SEPARATOR = ":";
const LIST_SEPARATOR = ",";
const COLUMN_SHOWN = "1";
const COLUMN_HIDDEN = "0";

// The state
/** The values selected inside one facet, keyed by the facet's own identifier. Facets combine with AND; the values of one facet combine with OR. */
export type RosterFacetSelection = Readonly<Record<string, readonly string[]>>;

/** The ordering the read is asked for: a field the service sorts on, and the direction it sorts it in. */
export type RosterSort = { readonly field: string; readonly direction: "asc" | "desc" };

/** Everything the roster's query states: what is searched, filtered, ordered, paged and shown. */
export interface RosterQueryState {
  readonly search: string;
  readonly facets: RosterFacetSelection;
  readonly sort: RosterSort | null;
  /** The page on screen, counted from one, as the caller reads it. */
  readonly page: number;
  readonly pageSize: number;
  readonly columnVisibility: Readonly<Record<string, boolean>>;
}

/** What one roster read is asked with: the parameters the handler parses, and nothing it would silently ignore. */
export interface RosterRequestParams {
  readonly search?: string;
  /** One `facetId:value` expression per selected value, ordered so two equal selections produce one request. */
  readonly facet?: readonly string[];
  readonly sort?: string;
  readonly direction?: (typeof SORT_DIRECTIONS)[number];
  /** The page as the read counts it: a zero-based index of the page window. */
  readonly page: number;
  readonly pageSize: number;
}

// The payloads, as this file reads them
/**
 * One page of the roster, mirroring the `data` of the roster read: its rows, its whole-result total and the window
 * they are a page of. `total` is the read's own count of the whole authorised result — never the length of `rows` —
 * and is answered as `rowCount` by {@link useRosterQuery}. The rows are passed through untouched and typed by the
 * component that renders them, because this hook never reads one.
 */
export interface RosterPageWindow<TRow = unknown> {
  readonly rows: readonly TRow[];
  readonly total: number;
  readonly page: { readonly index: number; readonly size: number };
}

/** One value a facet offers, as the read states it: the identifier a selection carries, and the count with the state that count is in. */
export interface RosterFacetValueSummary {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly countState: ValueState;
}

/**
 * One facet, as this file reads it: the identifier a selection is keyed by, the state the read reported for it and the
 * values it admits. It mirrors the read's own facet record, so a surface can render the filter it was admitted without
 * restating the shape or casting it.
 */
export interface RosterFacetSummary {
  readonly id: string;
  readonly labelKey: string;
  readonly operator: "OR";
  readonly multi: boolean;
  readonly state: "available" | "unavailable";
  readonly options: readonly RosterFacetValueSummary[];
  readonly disabledReason?: string;
  /** The source a giving facet could not be read from, when that source is reported unavailable. */
  readonly source?: { readonly system: string; readonly reference: string };
}

/** One saved view, mirroring the `data` of the saved-view read: the choices it stores and the drift they now carry. */
export interface RosterSavedViewSummary {
  readonly id: string;
  readonly name: string;
  readonly query: { readonly search: string; readonly applied: Readonly<Record<string, readonly string[]>>; readonly columnVisibility?: Readonly<Record<string, boolean>> };
  readonly revision?: string;
  readonly drift?: { readonly drifted: boolean; readonly missing: readonly string[] };
}

/** The envelope the roster read answers with, over the row type the surface renders. */
export type RosterEnvelope<TRow = unknown> = ReadEnvelope<RosterPageWindow<TRow>>;

/** The envelope the facet read answers with. */
export type RosterFacetsEnvelope = ReadEnvelope<readonly RosterFacetSummary[]>;

/** The envelope the saved-view read answers with. */
export type RosterSavedViewsEnvelope = ReadEnvelope<readonly RosterSavedViewSummary[]>;

/** The readonly view of a query string this file parses: the two members `useSearchParams()` answers with. */
export type RosterSearchParams = Pick<URLSearchParams, "get" | "getAll">;

/** What a caller may state about the surface it is reading the roster for. */
export interface RosterQueryOptions {
  /** The columns this surface offers, so a stale URL or saved view cannot carry a column that does not exist here. */
  readonly admittedColumnKeys?: readonly string[];
}

/** Everything the roster surface needs from this hook: its query state, the four ways to change it, and the three reads. */
export interface RosterQueryResult<TRow = unknown> {
  /** The query state parsed from the URL, clamped to what the read admits. */
  readonly query: RosterQueryState;
  /** Merges a change into the query state, resets the page when the change is a new query, and writes the URL. */
  readonly setQuery: (patch: Partial<RosterQueryState>) => void;
  /** Removes one value from one facet, so an active filter is always individually clearable. */
  readonly clearFacetValue: (facetKey: string, value: string) => void;
  /** Clears the search and every facet selection, leaving the ordering, page size and columns as they are. */
  readonly clearAll: () => void;
  /** The canonical form of the query state, for the returning-list assertion and for saved-view drift. */
  readonly signature: string;
  /** The roster read: the rows of the current page beside the whole-result total. */
  readonly roster: UseQueryResult<ReadResult<RosterEnvelope<TRow>>>;
  /** The facet set the read admitted for this caller, with the values and counts each facet offers. */
  readonly facets: UseQueryResult<ReadResult<RosterFacetsEnvelope>>;
  /** The saved views this caller owns, each with the drift the read reported for it. */
  readonly savedViews: UseQueryResult<ReadResult<RosterSavedViewsEnvelope>>;
  /** The whole-result total, aliased from the roster read's own count; `null` until an envelope exists, so a list that has not loaded is not a list of none. */
  readonly rowCount: number | null;
  /** The facet identifiers the read admitted, and nothing else — the only filters the toolbar may offer. */
  readonly admittedFacetKeys: readonly string[];
  /** The selected facet keys the read does not admit, so a saved view that drifted is repaired rather than silently dead. */
  readonly unadmittedFacetKeys: readonly string[];
}

// The one clamp every path applies
/** A sort that can be sent: a field and a direction, or nothing at all when either is missing. */
function usableSort(sort: RosterSort | null): RosterSort | null {
  if (sort === null || sort.field.trim() === "") {
    return null;
  }
  return { field: sort.field, direction: isSortDirection(sort.direction) ? sort.direction : "asc" };
}

/** Whether a value names one of the two directions the read admits. */
function isSortDirection(value: string): value is RosterSort["direction"] {
  return SORT_DIRECTIONS.some((direction) => direction === value);
}

/** A page the read can serve: a whole number counted from one, and the first page for anything else. */
function usablePage(page: number): number {
  return Number.isSafeInteger(page) && page >= FIRST_PAGE ? page : FIRST_PAGE;
}

/** A page size the read serves: a whole number within the stated cap, and the default for a size that is not one. */
function usablePageSize(pageSize: number): number {
  if (!Number.isSafeInteger(pageSize)) {
    return ROSTER_PAGE_SIZE_DEFAULT;
  }
  return Math.min(ROSTER_PAGE_SIZE_CAP, Math.max(1, pageSize));
}

/**
 * Normalises a query state into the one form the read is asked with and the URL states: the search as typed or empty,
 * facet keys and their values in one order with duplicates and blanks removed, an ordering that is either complete or
 * absent, a page counted from one, a page size within the cap, and the columns in one order. This is the visible
 * behaviour behind the URL, not a guard that quietly reinterprets what a caller asked for: every change it makes is
 * one the read would otherwise refuse or answer differently on each request.
 */
export function clampRosterQuery(state: RosterQueryState): RosterQueryState {
  const facets: Record<string, readonly string[]> = {};
  for (const facetKey of Object.keys(state.facets).sort()) {
    const selected = state.facets[facetKey];
    if (selected === undefined) {
      continue;
    }
    const kept: string[] = [];
    for (const value of selected) {
      if (value !== "" && !kept.includes(value)) {
        kept.push(value);
      }
    }
    if (kept.length > 0) {
      facets[facetKey] = kept.sort();
    }
  }
  const columnVisibility: Record<string, boolean> = {};
  for (const columnKey of Object.keys(state.columnVisibility).sort()) {
    const visible = state.columnVisibility[columnKey];
    if (visible !== undefined) {
      columnVisibility[columnKey] = visible;
    }
  }
  return Object.freeze({ search: state.search.trim(), facets: Object.freeze(facets), sort: usableSort(state.sort), page: usablePage(state.page), pageSize: usablePageSize(state.pageSize), columnVisibility: Object.freeze(columnVisibility) });
}

// Reading the state back out of the URL
/** A whole number a URL stated, or nothing at all — a parameter that is not one states no page rather than page one. */
function wholeNumber(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/.test(value)) {
    return null;
  }
  return Number(value);
}

/** The facet selection a URL states: every `facetId:value` pair, with a malformed pair carrying no facet or no value dropped. */
function facetSelectionOf(expressions: readonly string[]): RosterFacetSelection {
  const selection: Record<string, readonly string[]> = {};
  for (const expression of expressions) {
    const separator = expression.indexOf(VALUE_SEPARATOR);
    if (separator < 1 || separator === expression.length - 1) {
      continue;
    }
    const facetKey = expression.slice(0, separator);
    const value = expression.slice(separator + 1);
    const selected = selection[facetKey];
    selection[facetKey] = selected === undefined ? [value] : [...selected, value];
  }
  return selection;
}

/** The ordering a URL states: a field and its direction together, or nothing — the read refuses either one alone. */
function sortOf(value: string | null): RosterSort | null {
  if (value === null) {
    return null;
  }
  const separator = value.indexOf(VALUE_SEPARATOR);
  if (separator < 1 || separator === value.length - 1) {
    return null;
  }
  const field = value.slice(0, separator);
  const direction = value.slice(separator + 1);
  return isSortDirection(direction) ? { field, direction } : null;
}

/** The column visibility a URL states, kept only for the columns this surface offers when it names them. */
function columnVisibilityOf(value: string | null, admittedColumnKeys?: readonly string[]): Readonly<Record<string, boolean>> {
  if (value === null || value === "") {
    return {};
  }
  const admitted = admittedColumnKeys === undefined ? null : new Set(admittedColumnKeys);
  const columnVisibility: Record<string, boolean> = {};
  for (const entry of value.split(LIST_SEPARATOR)) {
    const separator = entry.indexOf(VALUE_SEPARATOR);
    if (separator < 1 || separator === entry.length - 1) {
      continue;
    }
    const columnKey = entry.slice(0, separator);
    const marker = entry.slice(separator + 1);
    if (marker !== COLUMN_SHOWN && marker !== COLUMN_HIDDEN) {
      continue;
    }
    if (admitted !== null && !admitted.has(columnKey)) {
      continue;
    }
    columnVisibility[columnKey] = marker === COLUMN_SHOWN;
  }
  return columnVisibility;
}

/**
 * Reads the roster's query state out of the URL this surface is showing, so a deep link, a saved view and the browser's
 * own back navigation all address the same query. A facet key the read no longer admits is kept rather than dropped:
 * the selection is the caller's, and reporting it is what lets a drifted saved view be repaired instead of silently
 * losing a filter.
 */
export function parseRosterQuery(params: RosterSearchParams, admittedColumnKeys?: readonly string[]): RosterQueryState {
  return clampRosterQuery({
    search: params.get(URL_PARAM.search) ?? "",
    facets: facetSelectionOf(params.getAll(URL_PARAM.facet)),
    sort: sortOf(params.get(URL_PARAM.sort)),
    page: wholeNumber(params.get(URL_PARAM.page)) ?? FIRST_PAGE,
    pageSize: wholeNumber(params.get(URL_PARAM.size)) ?? ROSTER_PAGE_SIZE_DEFAULT,
    columnVisibility: columnVisibilityOf(params.get(URL_PARAM.columns), admittedColumnKeys),
  });
}

/**
 * Writes the query state back as the one canonical query string this surface uses: the same state always produces the
 * same string, defaults are left out of the address, and a change of filters is a change of one URL rather than a
 * growing history of them.
 */
export function rosterQuerySearch(state: RosterQueryState): string {
  const query = clampRosterQuery(state);
  const params = new URLSearchParams();
  if (query.search !== "") {
    params.set(URL_PARAM.search, query.search);
  }
  for (const facetKey of Object.keys(query.facets)) {
    for (const value of query.facets[facetKey] ?? []) {
      params.append(URL_PARAM.facet, `${facetKey}${VALUE_SEPARATOR}${value}`);
    }
  }
  if (query.sort !== null) {
    params.set(URL_PARAM.sort, `${query.sort.field}${VALUE_SEPARATOR}${query.sort.direction}`);
  }
  if (query.page !== FIRST_PAGE) {
    params.set(URL_PARAM.page, String(query.page));
  }
  if (query.pageSize !== ROSTER_PAGE_SIZE_DEFAULT) {
    params.set(URL_PARAM.size, String(query.pageSize));
  }
  const columnKeys = Object.keys(query.columnVisibility);
  if (columnKeys.length > 0) {
    params.set(URL_PARAM.columns, columnKeys.map((columnKey) => `${columnKey}${VALUE_SEPARATOR}${query.columnVisibility[columnKey] === true ? COLUMN_SHOWN : COLUMN_HIDDEN}`).join(LIST_SEPARATOR));
  }
  return params.toString();
}

/**
 * The parameters one roster read is asked with: the search, the facet expressions, the ordering and the page window the
 * state names. The columns are deliberately absent — they decide what the surface shows of the result, not which
 * records the result holds, so they are carried in the URL and in a saved view and never sent to the read.
 */
export function rosterRequestParams(state: RosterQueryState): RosterRequestParams {
  const query = clampRosterQuery(state);
  const facet: string[] = [];
  for (const facetKey of Object.keys(query.facets)) {
    for (const value of query.facets[facetKey] ?? []) {
      facet.push(`${facetKey}${VALUE_SEPARATOR}${value}`);
    }
  }
  const sort = query.sort;
  return {
    ...(query.search === "" ? {} : { search: query.search }),
    ...(facet.length === 0 ? {} : { facet }),
    // A field and its direction travel together, because the read refuses either one alone.
    ...(sort === null ? {} : { sort: sort.field, direction: sort.direction }),
    // The read counts pages from zero and the caller from one, so the offset is stated here, once.
    page: query.page - FIRST_PAGE,
    pageSize: query.pageSize,
  };
}

/**
 * The canonical form of a query state, columns included: two states that would ask the same question and show the same
 * columns produce one string, and two that differ in anything the surface shows produce different ones. The returning
 * list is asserted against it, and a saved view's drift is read from it rather than from a comparison of object shapes.
 */
export function rosterQuerySignature(state: RosterQueryState): string {
  const query = clampRosterQuery(state);
  const facets = Object.keys(query.facets)
    .map((facetKey) => `${facetKey}=${(query.facets[facetKey] ?? []).join("|")}`)
    .join(";");
  const columns = Object.keys(query.columnVisibility)
    .map((columnKey) => `${columnKey}=${query.columnVisibility[columnKey] === true ? COLUMN_SHOWN : COLUMN_HIDDEN}`)
    .join(";");
  const sort = query.sort === null ? "" : `${query.sort.field}${VALUE_SEPARATOR}${query.sort.direction}`;
  return `search=${query.search};facets=${facets};sort=${sort};page=${query.page};pageSize=${query.pageSize};columns=${columns}`;
}

// The wire: one address per read job, and the payload each answers with
/** Whether a value is a record this file can read a member off; the one shape test the payload checks below are built from. */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a roster payload is the page window this file documents: its rows, its whole-result total and the window they are a page of. */
function isRosterPageWindow(value: unknown): boolean {
  if (!isRecordValue(value)) {
    return false;
  }
  const page = value["page"];
  return Array.isArray(value["rows"]) && typeof value["total"] === "number" && isRecordValue(page) && typeof page["index"] === "number" && typeof page["size"] === "number";
}

/** Whether a facet payload is the list of facets this file documents: each one named, in a state, with the values it admits. */
function isFacetList(value: unknown): boolean {
  return Array.isArray(value) && value.every((facet: unknown) => isRecordValue(facet) && typeof facet["id"] === "string" && typeof facet["state"] === "string" && Array.isArray(facet["options"]));
}

/** Whether a saved-view payload is the list of views this file documents: each one named and identified. */
function isSavedViewList(value: unknown): boolean {
  return Array.isArray(value) && value.every((view: unknown) => isRecordValue(view) && typeof view["id"] === "string" && typeof view["name"] === "string");
}

/**
 * Reads one of the roster's three jobs and hands its result on unchanged, unless the envelope carries a payload of
 * another member. The shared transport has already checked the envelope's own frame, so the payload is the one member
 * left to state; a body that is not it is a fault of the response boundary rather than a state of the records, and it
 * reaches the query's error state instead of rendering as an empty list, a zero or a missing filter.
 */
async function readNarrowed<TPayload>(url: string, accepts: (payload: unknown) => boolean): Promise<ReadResult<ReadEnvelope<TPayload>>> {
  const result = await fetchPartnerRead<TPayload>(url);
  if (result.kind !== "envelope" || accepts(result.envelope.data)) {
    return result;
  }
  throw new PartnerReadTransportError(url, undefined, "an envelope whose payload is not the member this read documents");
}

/** The address of one roster read job: the job's own name, beside the parameters only the roster job is asked with. */
function readUrl(job: RosterReadJob, params: RosterRequestParams | null): string {
  const search = new URLSearchParams();
  search.set(ROSTER_QUERY_PARAM, job);
  if (params !== null) {
    if (params.search !== undefined) {
      search.set(READ_PARAM.search, params.search);
    }
    for (const expression of params.facet ?? []) {
      search.append(READ_PARAM.facet, expression);
    }
    if (params.sort !== undefined && params.direction !== undefined) {
      search.set(READ_PARAM.sort, params.sort);
      search.set(READ_PARAM.direction, params.direction);
    }
    search.set(READ_PARAM.page, String(params.page));
    search.set(READ_PARAM.pageSize, String(params.pageSize));
  }
  return `${PARTNERS_READ_PATH}?${search.toString()}`;
}

/** The envelope a settled result carries, or `null` while there is none: a denial and an outage carry no envelope, and a query that has not answered carries no result. */
function envelopeIn<T>(result: ReadResult<ReadEnvelope<T>> | undefined): ReadEnvelope<T> | null {
  return result !== undefined && result.kind === "envelope" ? result.envelope : null;
}

/** The whole-result count a roster page states, or `null` when the page states no count at all: a list that cannot say how many it holds is not a list of none. */
function wholeResultTotal(page: RosterPageWindow<unknown>): number | null {
  return Number.isFinite(page.total) ? page.total : null;
}

/** Whether the scope carries the identifiers a read runs under, so a read with none is never issued. */
function scopeIsResolved(scope: Scope): boolean {
  return [scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId].every((identifier) => typeof identifier === "string" && identifier !== "");
}

// The change
/**
 * The state one change produces: the members the patch states are replaced, and the page returns to the first one when
 * the change is a different question — a new search, a different selection, a different ordering or a different page
 * size — because a narrower result must not leave the caller beyond its last page. A change of the page itself, or of
 * the visible columns, keeps the page it was made on.
 */
function mergeRosterQuery(current: RosterQueryState, patch: Partial<RosterQueryState>): RosterQueryState {
  const asksAnotherQuestion = patch.search !== undefined || patch.facets !== undefined || patch.sort !== undefined || patch.pageSize !== undefined;
  return clampRosterQuery({
    search: patch.search ?? current.search,
    facets: patch.facets ?? current.facets,
    sort: patch.sort === undefined ? current.sort : patch.sort,
    page: patch.page ?? (asksAnotherQuestion ? FIRST_PAGE : current.page),
    pageSize: patch.pageSize ?? current.pageSize,
    columnVisibility: patch.columnVisibility ?? current.columnVisibility,
  });
}

// The hook
/**
 * Reads the partner roster under one scope, with the query state its URL holds: the rows of the current page beside the
 * whole-result total, the facet set that describes it, and the caller's own saved views. Every change writes the URL
 * back, so opening a record and returning re-issues the identical query and the browser restores the list as it was.
 * Each read answers its own result unchanged — `envelope`, `denied`, `unavailable` or `refused` — so a refusal never
 * degrades into an empty list and a value state is read where the envelope states it.
 */
export function useRosterQuery<TRow = unknown>(scope: Scope, options: RosterQueryOptions = {}): RosterQueryResult<TRow> {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const admittedColumnKeys = options.admittedColumnKeys;
  // Parsed during render from the address itself: the URL is the state, so a reload, a deep link and the browser's own
  // back navigation all show one query rather than a copy that could disagree with it.
  const query = useMemo(() => parseRosterQuery(searchParams, admittedColumnKeys), [searchParams, admittedColumnKeys]);
  const signature = useMemo(() => rosterQuerySignature(query), [query]);
  const request = useMemo(() => rosterRequestParams(query), [query]);
  const commit = useCallback(
    (next: RosterQueryState) => {
      const search = rosterQuerySearch(next);
      // Replace, never push: a filter change is not a new place to come back to, and the address it leaves behind is
      // what the browser's back button returns to with the scroll position the list had.
      router.replace(search === "" ? pathname : `${pathname}?${search}`, { scroll: false });
    },
    [pathname, router],
  );
  const setQuery = useCallback(
    (patch: Partial<RosterQueryState>) => {
      commit(mergeRosterQuery(query, patch));
    },
    [commit, query],
  );
  const clearFacetValue = useCallback(
    (facetKey: string, value: string) => {
      const selected = query.facets[facetKey];
      if (selected === undefined) {
        return;
      }
      const remaining = selected.filter((entry) => entry !== value);
      const facets: Record<string, readonly string[]> = { ...query.facets };
      if (remaining.length === 0) {
        delete facets[facetKey];
      } else {
        facets[facetKey] = remaining;
      }
      commit(mergeRosterQuery(query, { facets }));
    },
    [commit, query],
  );
  const clearAll = useCallback(() => {
    commit(mergeRosterQuery(query, { search: "", facets: {} }));
  }, [commit, query]);
  const enabled = scopeIsResolved(scope);
  const roster = useQuery<ReadResult<RosterEnvelope<TRow>>>({
    // The scope leads the key, so the context switch's fence clears this entry with the rest of the previous context,
    // and the request's own parameters sit in it verbatim, so two pages or two selections are two entries.
    queryKey: [...scopeKey(scope), PARTNER_KEY.roster, request],
    queryFn: () => readNarrowed<RosterPageWindow<TRow>>(readUrl(ROSTER_READ_JOB.roster, request), isRosterPageWindow),
    // The page on screen stays while the next one lands, so a pending read is a busy list and never an empty one. The
    // busy signal is therefore `isFetching`/`isPlaceholderData`, not absent data.
    placeholderData: keepPreviousData,
    enabled,
  });
  const facets = useQuery<ReadResult<RosterFacetsEnvelope>>({
    // The facet set describes the result rather than one page of it, so it is keyed by the job alone and read once for
    // the context; the read's own counts do not depend on the search or the selection.
    queryKey: [...scopeKey(scope), PARTNER_KEY.facets],
    queryFn: () => readNarrowed<readonly RosterFacetSummary[]>(readUrl(ROSTER_READ_JOB.facets, null), isFacetList),
    enabled,
  });
  const savedViews = useQuery<ReadResult<RosterSavedViewsEnvelope>>({ queryKey: [...scopeKey(scope), PARTNER_KEY.savedViews], queryFn: () => readNarrowed<readonly RosterSavedViewSummary[]>(readUrl(ROSTER_READ_JOB.savedViews, null), isSavedViewList), enabled });
  const rosterEnvelope = envelopeIn(roster.data);
  const facetsEnvelope = envelopeIn(facets.data);
  // Every facet the read admitted, including one whose source it reported unavailable: that facet is admitted and
  // disabled with the read's own reason, so hiding it would leave a filter the toolbar cannot explain.
  const admittedFacetKeys = facetsEnvelope === null ? [] : facetsEnvelope.data.map((facet) => facet.id);
  const admitted = new Set(admittedFacetKeys);
  // Until the facet set is read, no selection is known to be unadmitted, so a surface is not told to repair a view
  // against a set it has not received yet.
  const unadmittedFacetKeys = facetsEnvelope === null ? [] : Object.keys(query.facets).filter((facetKey) => !admitted.has(facetKey));
  return { query, setQuery, clearFacetValue, clearAll, signature, roster, facets, savedViews, rowCount: rosterEnvelope === null ? null : wholeResultTotal(rosterEnvelope.data), admittedFacetKeys, unadmittedFacetKeys };
}
