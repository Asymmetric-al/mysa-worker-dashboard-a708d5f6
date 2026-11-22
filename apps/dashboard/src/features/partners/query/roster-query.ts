/**
 * The roster's URL grammar: the one reading and writing of the query state `/partners` keeps in its address — the
 * parameter names it uses, how a facet selection and an ordering are written, how a page and a page size resolve, and
 * the canonical query string and read query that state produces.
 *
 * It is deliberately not a client module. The Server Component route parses the address with these functions before it
 * asks the service, and the browser hook parses and writes the same address with them, so one view is one grammar
 * rather than a copy on each side of the server boundary (AAP 0.3.4; Rule 1 clause 2). Nothing here touches React, a
 * hook, the network or the session: every export is a pure rule over the address.
 */
import type { reads } from "@/modules/data-service";
import { PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT, clampPageSize } from "@/modules/support/report";

// ---------------------------------------------------------------------------------------------
// The window, the vocabulary and the separators the address is written with
// ---------------------------------------------------------------------------------------------

/** The roster's 50-row default and 200-row ceiling, named from the window the service itself applies (AAP 0.8.7), so the pager offers the sizes the read serves. */
export { PAGE_SIZE_CAP as ROSTER_PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT as ROSTER_PAGE_SIZE_DEFAULT };

/** The roster read's own query, taken from the read rather than restated. */
export type RosterReadQuery = NonNullable<Parameters<typeof reads.partners.findPartners>[0]>;

/** One ordering the roster read executes. */
type RosterReadSort = NonNullable<RosterReadQuery["sort"]>;

/** The parameter names this surface keeps its state in. A query change is a URL change, so they are part of the address. */
const URL_PARAM = { search: "q", facet: "facet", sort: "sort", page: "page", size: "size", columns: "columns" } as const;

/** The page a query shows when it names none, and the smallest page either grammar states. */
const FIRST_PAGE = 1;

/** The two sort directions the read admits. */
const SORT_DIRECTIONS = ["asc", "desc"] as const;

/** The fields the roster read orders by, stated from its own vocabulary: an ordering it does not name is left to the read's own default rather than sent as one it would refuse. */
const ROSTER_SORT_FIELDS = ["displayName", "kind", "stage", "favourite", "lastActivityOn"] as const satisfies readonly RosterReadSort["field"][];

/** The separators and markers of the compound URL values: `facetId:value`, `field:direction` and `columnId:1`. */
const VALUE_SEPARATOR = ":";
const LIST_SEPARATOR = ",";
const COLUMN_SHOWN = "1";
const COLUMN_HIDDEN = "0";

// ---------------------------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------------------------

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

/** The address this grammar parses: the two members `useSearchParams()` and a `URLSearchParams` both answer with. */
export type RosterSearchParams = Pick<URLSearchParams, "get" | "getAll">;

// ---------------------------------------------------------------------------------------------
// The one clamp every path applies
// ---------------------------------------------------------------------------------------------

/** Whether a value names one of the two directions the read admits. */
function isSortDirection(value: string): value is RosterSort["direction"] {
  return SORT_DIRECTIONS.some((direction) => direction === value);
}

/** The ordering as the read states it, or nothing at all when its field or its direction is one the read does not admit. */
function readSortOf(sort: RosterSort | null): RosterReadSort | null {
  if (sort === null) {
    return null;
  }
  const field = ROSTER_SORT_FIELDS.find((admitted) => admitted === sort.field);
  const direction = SORT_DIRECTIONS.find((admitted) => admitted === sort.direction);
  if (field === undefined || direction === undefined) {
    return null;
  }
  return { field, direction };
}

/** A sort that can be sent: a field and a direction the read admits together, or nothing at all. */
function usableSort(sort: RosterSort | null): RosterSort | null {
  const admitted = readSortOf(sort);
  return admitted === null ? null : { field: admitted.field, direction: admitted.direction };
}

/** A page the read can serve: a whole number counted from one, and the first page for anything else. */
function usablePage(page: number): number {
  return Number.isSafeInteger(page) && page >= FIRST_PAGE ? page : FIRST_PAGE;
}

/**
 * Normalises a query state into the one form the read is asked with and the URL states: the search as typed or empty,
 * facet keys and their values in one order with duplicates and blanks removed, an ordering the read admits or none at
 * all, a page counted from one, a page size resolved by the service's own window, and the columns in one order. This
 * is the visible behaviour behind the URL, not a guard that quietly reinterprets what a caller asked for: every change
 * it makes is one the read would otherwise refuse or answer differently on each request.
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
  return Object.freeze({ search: state.search.trim(), facets: Object.freeze(facets), sort: usableSort(state.sort), page: usablePage(state.page), pageSize: clampPageSize(state.pageSize), columnVisibility: Object.freeze(columnVisibility) });
}

// ---------------------------------------------------------------------------------------------
// Reading the state back out of the URL
// ---------------------------------------------------------------------------------------------

/** A whole number a URL stated, or nothing at all — a parameter that is not one states no page rather than page one. */
function wholeNumber(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/u.test(value)) {
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
 * Reads the roster's query state out of the URL a surface is showing, so a deep link, a saved view and the browser's
 * own back navigation all address the same query, on the server render and in the browser alike. A facet key the read
 * no longer admits is kept rather than dropped: the selection is the caller's, and reporting it is what lets a drifted
 * saved view be repaired instead of silently losing a filter.
 */
export function parseRosterQuery(params: RosterSearchParams, admittedColumnKeys?: readonly string[]): RosterQueryState {
  return clampRosterQuery({
    search: params.get(URL_PARAM.search) ?? "",
    facets: facetSelectionOf(params.getAll(URL_PARAM.facet)),
    sort: sortOf(params.get(URL_PARAM.sort)),
    page: wholeNumber(params.get(URL_PARAM.page)) ?? FIRST_PAGE,
    pageSize: wholeNumber(params.get(URL_PARAM.size)) ?? PAGE_SIZE_DEFAULT,
    columnVisibility: columnVisibilityOf(params.get(URL_PARAM.columns), admittedColumnKeys),
  });
}

// ---------------------------------------------------------------------------------------------
// Writing the state back out
// ---------------------------------------------------------------------------------------------

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
  if (query.pageSize !== PAGE_SIZE_DEFAULT) {
    params.set(URL_PARAM.size, String(query.pageSize));
  }
  const columnKeys = Object.keys(query.columnVisibility);
  if (columnKeys.length > 0) {
    params.set(URL_PARAM.columns, columnKeys.map((columnKey) => `${columnKey}${VALUE_SEPARATOR}${query.columnVisibility[columnKey] === true ? COLUMN_SHOWN : COLUMN_HIDDEN}`).join(LIST_SEPARATOR));
  }
  return params.toString();
}

/**
 * The parameters one roster read is asked with over the transport: the search, the facet expressions, the ordering and
 * the page window the state names. The columns are deliberately absent — they decide what the surface shows of the
 * result, not which records the result holds, so they are carried in the URL and in a saved view and never sent.
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
    // The read counts pages from zero and the address from one, so the offset is stated here, once.
    page: query.page - FIRST_PAGE,
    pageSize: query.pageSize,
  };
}

/**
 * The roster read's own query for one URL state, so a Server Component asks the service for the view its address
 * describes without re-stating the grammar: the search and the facet selection only where they narrow something, the
 * ordering as the read's own field and direction, and the page window counted from zero as the read counts it, while
 * the address states pages from one.
 */
export function rosterReadQuery(state: RosterQueryState): RosterReadQuery {
  const query = clampRosterQuery(state);
  const sort = readSortOf(query.sort);
  return { ...(query.search === "" ? {} : { search: query.search }), ...(Object.keys(query.facets).length === 0 ? {} : { applied: query.facets }), ...(sort === null ? {} : { sort: { field: sort.field, direction: sort.direction } }), page: { index: query.page - FIRST_PAGE, size: query.pageSize } };
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

// ---------------------------------------------------------------------------------------------
// The change
// ---------------------------------------------------------------------------------------------

/**
 * The state one change produces: the members the patch states are replaced, and the page returns to the first one when
 * the change is a different question — a new search, a different selection, a different ordering or a different page
 * size — because a narrower result must not leave the caller beyond its last page. A change of the page itself, or of
 * the visible columns, keeps the page it was made on.
 */
export function mergeRosterQuery(current: RosterQueryState, patch: Partial<RosterQueryState>): RosterQueryState {
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
