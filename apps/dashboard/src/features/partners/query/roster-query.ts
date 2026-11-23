/** The roster's URL grammar: the one reading and writing of the query state `/partners` keeps in its address, shared by the Server Component route and the browser hook so one view is one grammar rather than a copy on each side of the boundary. Every export here is a pure rule over the address. */
import type { reads } from "@/modules/data-service";
import { PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT, clampPageSize } from "@/modules/support/report";
/** The roster's 50-row default and 200-row ceiling, named from the window the service itself applies, so the pager offers the sizes the read serves. */
export { PAGE_SIZE_CAP as ROSTER_PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT as ROSTER_PAGE_SIZE_DEFAULT };
type RosterReadQuery = NonNullable<Parameters<typeof reads.partners.findPartners>[0]>;
type RosterReadSort = NonNullable<RosterReadQuery["sort"]>;
const URL_PARAM = { search: "q", facet: "facet", sort: "sort", page: "page", size: "size", columns: "columns" } as const;
const FIRST_PAGE = 1;
const SORT_DIRECTIONS = ["asc", "desc"] as const;
const VALUE_SEPARATOR = ":";
const LIST_SEPARATOR = ",";
const COLUMN_SHOWN = "1";
const COLUMN_HIDDEN = "0";
/** The orderings the read executes, stated from its own vocabulary: any other ordering is left to the read's own default rather than sent as one it would refuse. */
const ROSTER_SORT_FIELDS = ["displayName", "kind", "stage", "favourite", "lastActivityOn"] as const satisfies readonly RosterReadSort["field"][];
/** The values selected inside one facet, keyed by the facet's identifier: facets combine with AND and the values of one facet with OR. */
export type RosterFacetSelection = Readonly<Record<string, readonly string[]>>;
export type RosterSort = { readonly field: string; readonly direction: "asc" | "desc" };
export type RosterQueryState = { readonly search: string; readonly facets: RosterFacetSelection; readonly sort: RosterSort | null; readonly page: number; readonly pageSize: number; readonly columnVisibility: Readonly<Record<string, boolean>> };
export type RosterRequestParams = { readonly search?: string; readonly facet?: readonly string[]; readonly sort?: string; readonly direction?: (typeof SORT_DIRECTIONS)[number]; readonly page: number; readonly pageSize: number };
export type RosterSearchParams = Pick<URLSearchParams, "get" | "getAll">;
const isSortDirection = (value: string): value is RosterSort["direction"] => SORT_DIRECTIONS.some((direction) => direction === value);
/** The ordering as the read states it, or nothing at all when its field or its direction is one the read does not admit. */
function readSortOf(sort: RosterSort | null): RosterReadSort | null {
  const field = ROSTER_SORT_FIELDS.find((admitted) => admitted === sort?.field);
  const direction = SORT_DIRECTIONS.find((admitted) => admitted === sort?.direction);
  return field === undefined || direction === undefined ? null : { field, direction };
}
const usablePage = (page: number): number => (Number.isSafeInteger(page) && page >= FIRST_PAGE ? page : FIRST_PAGE);
const facetExpressionsOf = (facets: RosterFacetSelection): string[] => Object.keys(facets).flatMap((facetKey) => (facets[facetKey] ?? []).map((value) => `${facetKey}${VALUE_SEPARATOR}${value}`));
/** Normalises a query state into the one form the read is asked with and the URL states: values ordered with duplicates and blanks removed, an ordering the read admits, a page counted from one, and a size the service's own window resolves. */
export function clampRosterQuery(state: RosterQueryState): RosterQueryState {
  const facets: Record<string, readonly string[]> = {};
  for (const facetKey of Object.keys(state.facets).sort()) {
    const kept = [...new Set((state.facets[facetKey] ?? []).filter((value) => value !== ""))].sort();
    if (kept.length > 0) facets[facetKey] = kept;
  }
  const columnVisibility: Record<string, boolean> = {};
  for (const columnKey of Object.keys(state.columnVisibility).sort()) {
    const visible = state.columnVisibility[columnKey];
    if (visible !== undefined) columnVisibility[columnKey] = visible;
  }
  return Object.freeze({ search: state.search.trim(), facets: Object.freeze(facets), sort: readSortOf(state.sort), page: usablePage(state.page), pageSize: clampPageSize(state.pageSize), columnVisibility: Object.freeze(columnVisibility) });
}
/** A whole number a URL stated, or nothing at all — a parameter that is not one states no page rather than page one. */
const wholeNumber = (value: string | null): number | null => (value === null || !/^\d{1,9}$/u.test(value) ? null : Number(value));
/** The facet selection a URL states: every `facetId:value` pair, with a malformed pair carrying no facet or no value dropped. */
function facetSelectionOf(expressions: readonly string[]): RosterFacetSelection {
  const selection: Record<string, readonly string[]> = {};
  for (const expression of expressions) {
    const separator = expression.indexOf(VALUE_SEPARATOR);
    if (separator < 1 || separator === expression.length - 1) continue;
    const facetKey = expression.slice(0, separator);
    const value = expression.slice(separator + 1);
    const selected = selection[facetKey];
    selection[facetKey] = selected === undefined ? [value] : [...selected, value];
  }
  return selection;
}
/** The ordering a URL states: a field and its direction together, or nothing — the read refuses either one alone. */
function sortOf(value: string | null): RosterSort | null {
  const separator = value === null ? -1 : value.indexOf(VALUE_SEPARATOR);
  if (separator < 1 || separator === (value ?? "").length - 1) return null;
  const field = (value ?? "").slice(0, separator);
  const direction = (value ?? "").slice(separator + 1);
  return isSortDirection(direction) ? { field, direction } : null;
}
/** The column visibility a URL states, kept only for the columns this surface offers when it names them. */
function columnVisibilityOf(value: string | null, admittedColumnKeys?: readonly string[]): Readonly<Record<string, boolean>> {
  if (value === null || value === "") return {};
  const admitted = admittedColumnKeys === undefined ? null : new Set(admittedColumnKeys);
  const columnVisibility: Record<string, boolean> = {};
  for (const entry of value.split(LIST_SEPARATOR)) {
    const separator = entry.indexOf(VALUE_SEPARATOR);
    if (separator < 1 || separator === entry.length - 1) continue;
    const columnKey = entry.slice(0, separator);
    const marker = entry.slice(separator + 1);
    if (marker !== COLUMN_SHOWN && marker !== COLUMN_HIDDEN) continue;
    if (admitted !== null && !admitted.has(columnKey)) continue;
    columnVisibility[columnKey] = marker === COLUMN_SHOWN;
  }
  return columnVisibility;
}
/** Reads the roster's query state out of the URL a surface is showing, so a deep link, a saved view and the browser's own back navigation all address one query. A facet key the read no longer admits is kept rather than dropped: reporting it is what lets a drifted saved view be repaired instead of silently losing a filter. */
export const parseRosterQuery = (params: RosterSearchParams, admittedColumnKeys?: readonly string[]): RosterQueryState =>
  clampRosterQuery({
    search: params.get(URL_PARAM.search) ?? "",
    facets: facetSelectionOf(params.getAll(URL_PARAM.facet)),
    sort: sortOf(params.get(URL_PARAM.sort)),
    page: wholeNumber(params.get(URL_PARAM.page)) ?? FIRST_PAGE,
    pageSize: wholeNumber(params.get(URL_PARAM.size)) ?? PAGE_SIZE_DEFAULT,
    columnVisibility: columnVisibilityOf(params.get(URL_PARAM.columns), admittedColumnKeys),
  });
/** Writes the query state back as the one canonical query string this surface uses: the same state always produces the same string, and defaults are left out of the address. */
export function rosterQuerySearch(state: RosterQueryState): string {
  const query = clampRosterQuery(state);
  const params = new URLSearchParams();
  if (query.search !== "") params.set(URL_PARAM.search, query.search);
  for (const expression of facetExpressionsOf(query.facets)) params.append(URL_PARAM.facet, expression);
  if (query.sort !== null) params.set(URL_PARAM.sort, `${query.sort.field}${VALUE_SEPARATOR}${query.sort.direction}`);
  if (query.page !== FIRST_PAGE) params.set(URL_PARAM.page, String(query.page));
  if (query.pageSize !== PAGE_SIZE_DEFAULT) params.set(URL_PARAM.size, String(query.pageSize));
  const columnKeys = Object.keys(query.columnVisibility);
  if (columnKeys.length > 0) params.set(URL_PARAM.columns, columnKeys.map((columnKey) => `${columnKey}${VALUE_SEPARATOR}${query.columnVisibility[columnKey] === true ? COLUMN_SHOWN : COLUMN_HIDDEN}`).join(LIST_SEPARATOR));
  return params.toString();
}
/** The parameters one roster read is asked with over the transport: the columns are absent because they decide what the surface shows, not which records the result holds, and the page travels as the read counts it, from zero. */
export function rosterRequestParams(state: RosterQueryState): RosterRequestParams {
  const query = clampRosterQuery(state);
  const facet = facetExpressionsOf(query.facets);
  const sort = query.sort;
  return { ...(query.search === "" ? {} : { search: query.search }), ...(facet.length === 0 ? {} : { facet }), ...(sort === null ? {} : { sort: sort.field, direction: sort.direction }), page: query.page - FIRST_PAGE, pageSize: query.pageSize };
}
/** The roster read's own query for one URL state, so a Server Component asks the service for the view its address describes without re-stating the grammar. */
export function rosterReadQuery(state: RosterQueryState): RosterReadQuery {
  const query = clampRosterQuery(state);
  const sort = readSortOf(query.sort);
  return { ...(query.search === "" ? {} : { search: query.search }), ...(Object.keys(query.facets).length === 0 ? {} : { applied: query.facets }), ...(sort === null ? {} : { sort }), page: { index: query.page - FIRST_PAGE, size: query.pageSize } };
}
/** The canonical form of a query state, columns included: two states that would ask the same question and show the same columns produce one string, and a saved view's drift is read from it. */
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
/** The state one change produces: the members the patch states are replaced, and the page returns to the first one when the change asks a different question, because a narrower result must not leave the caller beyond its last page. */
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
