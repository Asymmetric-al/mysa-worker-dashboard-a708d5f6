/**
 * The initiative list's URL grammar: the one reading and writing of the view state `/partners/initiatives` keeps in its address — the parameter names, how the state filter, the order, the page window and the hidden columns are written, and the read query that state resolves to.
 *
 * It is deliberately not a client module: the Server Component route reads the address with these functions and asks the service for exactly the view they describe, and the browser list parses and writes the same address with them, so one view is one grammar rather than a copy on each side of the server boundary. Nothing here touches React, a hook, the network or the session: every export is a pure rule over the address.
 */
import type { reads } from "@/modules/data-service";
import { INITIATIVE_STATES, type InitiativeState } from "@/modules/data-service/envelope";
import { clampPageSize } from "@/modules/support/report";
/** The initiative list read's own query, taken from the read rather than restated. */
export type InitiativesReadQuery = NonNullable<Parameters<typeof reads.outreach.readInitiatives>[0]>;
/** The orders the read admits, in the order this surface offers them: the read owns the direction of each, so no direction travels. */
export const INITIATIVE_ORDERS = ["name", "period-start", "state"] as const satisfies readonly NonNullable<InitiativesReadQuery["sort"]>[];
/** One order the list may be presented in. */
export type InitiativeOrder = (typeof INITIATIVE_ORDERS)[number];
/** The one state filter value that states no filter: either of the read's two states. */
export const STATE_ALL = "all";
/** The state filter a view may state: one of the read's two states, or either of them. */
export type InitiativeStateFilter = InitiativeState | typeof STATE_ALL;
/** The order a view states when it names none: the read's own default order. */
export const DEFAULT_ORDER: InitiativeOrder = "name";
/** The page a view states when it names none, counted from one as the list read counts pages. */
export const FIRST_PAGE = 1;
/** The parameters the view state travels as. */
const PARAM = { search: "search", state: "state", sort: "sort", page: "page", pageSize: "pageSize", hidden: "hidden" } as const;
const HIDDEN_SEPARATOR = ",";
/** The columns a reader may hide: the name column carries the row's link, so it is never one of them. */
const HIDEABLE_COLUMN_IDS = ["purpose", "responsible", "period", "state", "members"] as const;
/** One column-visibility set, keyed by column identifier. */
type ColumnVisibility = Readonly<Record<string, boolean>>;
/** Everything the list's view states: the search text, the state filter, the order, the page window and the columns a reader has hidden. */
export interface InitiativesViewState {
  /** The whole-dataset search the read applies to an initiative's name and purpose; empty asks for nothing. */
  readonly search: string;
  readonly state: InitiativeStateFilter;
  readonly sort: InitiativeOrder;
  readonly page: number;
  /** The rows a page holds: as many as the address states within the read's 50-row default and 200-row ceiling. */
  readonly pageSize: number;
  readonly columnVisibility: ColumnVisibility;
}
/** Whether a value names one of the read's two states. */
export const isInitiativeState = (value: string | null): value is InitiativeState => value !== null && INITIATIVE_STATES.some((admitted) => admitted === value);
/** Whether a value names one of the three orders the read applies. */
export const isInitiativeOrder = (value: string | null): value is InitiativeOrder => value !== null && INITIATIVE_ORDERS.some((admitted) => admitted === value);
/** A whole count a view stated, or nothing at all. */
export function integerOf(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
/** A page the read can serve: a whole number counted from one, and the first page for anything else. */
export const pageNumberOf = (value: number): number => (Number.isSafeInteger(value) && value >= FIRST_PAGE ? value : FIRST_PAGE);
/** The columns a view has hidden, in the order they are written, so the same view always writes one string. */
const hiddenColumnIds = (visibility: ColumnVisibility): readonly string[] => HIDEABLE_COLUMN_IDS.filter((id) => visibility[id] === false);
function columnVisibilityOf(value: string | null): ColumnVisibility {
  const visibility: Record<string, boolean> = {};
  if (value === null) return visibility;
  for (const stated of value.split(HIDDEN_SEPARATOR)) if (HIDEABLE_COLUMN_IDS.some((admitted) => admitted === stated)) visibility[stated] = false;
  return visibility;
}
/** Reads the view state back from an address, applying the same rules the writer applies so a round trip returns an equal view. The page window is the service's own clamp, so no copy of it can drift from what is served. */
export function parseInitiativesQuery(source: URLSearchParams | string): InitiativesViewState {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  const statedState = params.get(PARAM.state);
  const statedSort = params.get(PARAM.sort);
  return {
    search: params.get(PARAM.search) ?? "",
    state: isInitiativeState(statedState) ? statedState : STATE_ALL,
    sort: isInitiativeOrder(statedSort) ? statedSort : DEFAULT_ORDER,
    page: pageNumberOf(integerOf(params.get(PARAM.page)) ?? FIRST_PAGE),
    pageSize: clampPageSize(integerOf(params.get(PARAM.pageSize))),
    columnVisibility: columnVisibilityOf(params.get(PARAM.hidden)),
  };
}
/** Writes the view state as URL parameters. */
export function toInitiativesParams(state: InitiativesViewState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search !== "") params.set(PARAM.search, state.search);
  if (state.state !== STATE_ALL) params.set(PARAM.state, state.state);
  if (state.sort !== DEFAULT_ORDER) params.set(PARAM.sort, state.sort);
  params.set(PARAM.page, String(pageNumberOf(state.page)));
  params.set(PARAM.pageSize, String(clampPageSize(state.pageSize)));
  const hidden = hiddenColumnIds(state.columnVisibility);
  if (hidden.length > 0) params.set(PARAM.hidden, hidden.join(HIDDEN_SEPARATOR));
  return params;
}
/** The initiative read's own query for one view state, so a Server Component asks the service for exactly the view its address describes: the search and the state filter only where they narrow something, the order only where it is not the read's own default, and the page window as the read counts it. */
export function initiativesReadQuery(view: InitiativesViewState): InitiativesReadQuery {
  return { ...(view.search === "" ? {} : { search: view.search }), ...(view.state === STATE_ALL ? {} : { state: view.state }), ...(view.sort === DEFAULT_ORDER ? {} : { sort: view.sort }), page: pageNumberOf(view.page), pageSize: clampPageSize(view.pageSize) };
}
