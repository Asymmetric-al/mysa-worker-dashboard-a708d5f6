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
import { useCallback, useMemo, useState } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { mergeRosterQuery, parseRosterQuery, rosterQuerySearch, rosterQuerySignature, rosterRequestParams, type RosterQueryState, type RosterRequestParams } from "../query/roster-query";
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

// The URL grammar, which this surface's server render parses too
//
// The grammar itself is one non-client module, so the Server Component route that asks the service for this view and the
// hook below that asks the route handler for it parse and write one address rather than a copy each. It is re-exported
// here because this hook is where the family's surfaces reach for it.
export { ROSTER_PAGE_SIZE_CAP, ROSTER_PAGE_SIZE_DEFAULT, clampRosterQuery, parseRosterQuery, rosterQuerySearch, rosterQuerySignature, rosterRequestParams } from "../query/roster-query";
export type { RosterFacetSelection, RosterQueryState, RosterRequestParams, RosterSearchParams, RosterSort } from "../query/roster-query";

/** The parameter names `GET /api/partners` parses, taken from the handler's own grammar rather than invented. */
const READ_PARAM = { search: "search", facet: "facet", sort: "sort", direction: "direction", page: "page", pageSize: "pageSize" } as const;

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

// The answer a server render already read
/** Whether two requests ask the read for the same answer: every member compared, so the search, a selected value, the ordering and the page window are the same question rather than two. */
function sameRequest(left: RosterRequestParams, right: RosterRequestParams): boolean {
  const leftFacets = left.facet ?? [];
  const rightFacets = right.facet ?? [];
  const sameFacets = leftFacets.length === rightFacets.length && leftFacets.every((expression, index) => expression === rightFacets[index]);
  return sameFacets && left.page === right.page && left.pageSize === right.pageSize && (left.search ?? "") === (right.search ?? "") && (left.sort ?? "") === (right.sort ?? "") && (left.direction ?? "") === (right.direction ?? "");
}

/** Whether two scopes are the same authority: the four identifiers the read runs under, compared one by one. */
function sameScope(left: Scope, right: Scope): boolean {
  return left.organizationId === right.organizationId && left.ministryId === right.ministryId && left.supportSubjectId === right.supportSubjectId && left.principalId === right.principalId;
}

/**
 * The roster read a server render already answered, when it is the answer this surface is about to ask for, and
 * nothing otherwise.
 *
 * A seed makes the first paint state the rows and the whole-result count the route read instead of a loading notice,
 * and lets the mount issue no identical request. It is used only where three things agree: the surface still asks the
 * question the server answered (`asked` — the request this surface first rendered with, because the address moves on as
 * the worker searches and pages and a seed must never follow it), the window the payload itself echoes is the window
 * being asked for, and the envelope ran under the authority this surface reads in. The roster payload echoes no search,
 * selection or ordering, so the window alone cannot tell one view of a first page from another; a seed that described a
 * different question would paint one view's rows and count under another view's heading, and a refusal is never seeded
 * at all, so a denial or an outage keeps its own arm.
 */
function seedOf<TRow>(initialResult: ReadResult<RosterEnvelope<TRow>> | undefined, asked: RosterRequestParams | null, request: RosterRequestParams, scope: Scope): ReadResult<RosterEnvelope<TRow>> | undefined {
  if (initialResult === undefined || initialResult.kind !== "envelope" || asked === null) {
    return undefined;
  }
  const { envelope } = initialResult;
  const agrees = sameRequest(asked, request) && sameScope(envelope.scope, scope) && envelope.data.page.index === request.page && envelope.data.page.size === request.pageSize;
  return agrees ? initialResult : undefined;
}
// The hook
/**
 * Reads the partner roster under one scope, with the query state its URL holds: the rows of the current page beside the
 * whole-result total, the facet set that describes it, and the caller's own saved views. Every change writes the URL
 * back, so opening a record and returning re-issues the identical query and the browser restores the list as it was.
 * Each read answers its own result unchanged — `envelope`, `denied`, `unavailable` or `refused` — so a refusal never
 * degrades into an empty list and a value state is read where the envelope states it.
 *
 * `initialResult` is the answer a server render already read for this same scope and view, when the composing route has
 * one: it seeds the roster read, so the first paint states exactly the rows and the whole-result count the server
 * painted and no identical request repeats that read on mount. An answer that does not describe the view being asked
 * for is dropped and the read is made instead, so a later page, search, selection or sort still reads and still shows
 * the previous page while the next one lands.
 */
export function useRosterQuery<TRow = unknown>(scope: Scope, options: RosterQueryOptions = {}, initialResult?: ReadResult<RosterEnvelope<TRow>>): RosterQueryResult<TRow> {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const admittedColumnKeys = options.admittedColumnKeys;
  // Parsed during render from the address itself: the URL is the state, so a reload, a deep link and the browser's own
  // back navigation all show one query rather than a copy that could disagree with it.
  const query = useMemo(() => parseRosterQuery(searchParams, admittedColumnKeys), [searchParams, admittedColumnKeys]);
  const signature = useMemo(() => rosterQuerySignature(query), [query]);
  const request = useMemo(() => rosterRequestParams(query), [query]);
  // The request this surface was first asked for, which is the one a seed answers: the address moves on as the worker
  // searches, filters, sorts and pages, and the roster payload echoes no search, selection or ordering, so the window it
  // states cannot on its own tell two views of one page apart. Held for the surface's lifetime, so a seed only ever
  // stands for the question the server read it with.
  const [asked] = useState<RosterRequestParams | null>(() => (initialResult === undefined ? null : request));
  const seed = seedOf(initialResult, asked, request, scope);
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
    // The route's own answer for this exact view stands on the first paint, and the mount repeats no identical read for
    // it; a view no seed answers is read on mount exactly as before.
    initialData: seed,
    refetchOnMount: seed === undefined,
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
