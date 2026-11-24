"use client";
/** The Partners roster's browser data layer: its controlled query state, owned by the URL, and the three named reads that describe it — the whole-dataset roster, the facet set it is filtered by, and the caller's saved views. The service does every piece of work the state describes, and nothing here filters, sorts, pages or totals a record. */
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { fetchRead, envelopeIn } from "@/lib/read-transport";
import { mergeRosterQuery, parseRosterQuery, rosterQuerySearch, rosterQuerySignature, rosterRequestParams, type RosterQueryState, type RosterRequestParams } from "../query/roster-query";
import { PARTNER_KEY } from "./use-partner-mutations";
// The grammar is one non-client module, so the Server Component route and this hook parse and write one address rather than a copy each; it is re-exported here because this hook is where the family's surfaces reach for it.
export { ROSTER_PAGE_SIZE_CAP, ROSTER_PAGE_SIZE_DEFAULT, clampRosterQuery, parseRosterQuery, rosterQuerySearch, rosterQuerySignature, rosterRequestParams } from "../query/roster-query";
export type { RosterFacetSelection, RosterQueryState, RosterRequestParams, RosterSearchParams, RosterSort } from "../query/roster-query";
export const PARTNERS_READ_PATH = "/api/partners";
export const ROSTER_QUERY_PARAM = "job";
/** The three named reads this file issues, each a closed literal that dispatches to exactly one service read. */
export const ROSTER_READ_JOB = { roster: "roster", facets: "facets", savedViews: "saved-views" } as const;
export type RosterReadJob = (typeof ROSTER_READ_JOB)[keyof typeof ROSTER_READ_JOB];
const READ_PARAM = { search: "search", facet: "facet", sort: "sort", direction: "direction", page: "page", pageSize: "pageSize", currency: "currency", from: "from", to: "to", timeZone: "timeZone" } as const;
/** One page of the roster, mirroring the `data` of the roster read: its rows, the read's own whole-result count, and the window they are a page of. */
export type RosterPageWindow<TRow = unknown> = { readonly rows: readonly TRow[]; readonly total: number; readonly page: { readonly index: number; readonly size: number } };
export type RosterFacetValueSummary = { readonly id: string; readonly label: string; readonly count: number; readonly countState: ValueState };
export type RosterFacetSummary = {
  readonly id: string;
  readonly labelKey: string;
  readonly operator: "OR";
  readonly multi: boolean;
  readonly state: "available" | "unavailable";
  readonly options: readonly RosterFacetValueSummary[];
  readonly disabledReason?: string;
  readonly source?: { readonly system: string; readonly reference: string };
};
export type RosterSavedViewSummary = {
  readonly id: string;
  readonly name: string;
  readonly query: { readonly search: string; readonly applied: Readonly<Record<string, readonly string[]>>; readonly columnVisibility?: Readonly<Record<string, boolean>>; readonly sort?: { readonly field: string; readonly direction: "asc" | "desc" }; readonly pageSize?: number };
  readonly revision?: string;
  readonly drift?: { readonly drifted: boolean; readonly missing: readonly string[] };
};
export type RosterEnvelope<TRow = unknown> = ReadEnvelope<RosterPageWindow<TRow>>;
export type RosterFacetsEnvelope = ReadEnvelope<readonly RosterFacetSummary[]>;
export type RosterSavedViewsEnvelope = ReadEnvelope<readonly RosterSavedViewSummary[]>;
export type RosterQueryOptions = { readonly admittedColumnKeys?: readonly string[] };
export type RosterQueryResult<TRow = unknown> = {
  readonly query: RosterQueryState;
  readonly setQuery: (patch: Partial<RosterQueryState>) => void;
  readonly clearFacetValue: (facetKey: string, value: string) => void;
  readonly clearAll: () => void;
  readonly signature: string;
  readonly roster: UseQueryResult<ReadResult<RosterEnvelope<TRow>>>;
  readonly facets: UseQueryResult<ReadResult<RosterFacetsEnvelope>>;
  readonly savedViews: UseQueryResult<ReadResult<RosterSavedViewsEnvelope>>;
  readonly rowCount: number | null;
  readonly admittedFacetKeys: readonly string[];
  readonly unadmittedFacetKeys: readonly string[];
};
const isRecordValue = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isRosterPageWindow = (value: unknown): boolean => isRecordValue(value) && Array.isArray(value["rows"]) && typeof value["total"] === "number" && isRecordValue(value["page"]) && typeof value["page"]["index"] === "number" && typeof value["page"]["size"] === "number";
const isFacetList = (value: unknown): boolean => Array.isArray(value) && value.every((facet: unknown) => isRecordValue(facet) && typeof facet["id"] === "string" && typeof facet["state"] === "string" && Array.isArray(facet["options"]));
const isSavedViewList = (value: unknown): boolean => Array.isArray(value) && value.every((view: unknown) => isRecordValue(view) && typeof view["id"] === "string" && typeof view["name"] === "string");
/** The giving scope a read is asked with, as the four members the wire names: an absent end or zone is held as nothing and written as nothing, so a read that asks for no scope is asked for the read's own default rather than one nobody chose. */
type GivingScope = Readonly<Record<"currency" | "from" | "to" | "timeZone", string>>;
const givingScopeOf = (request: RosterRequestParams): GivingScope => ({ currency: request.currency ?? "", from: request.from ?? "", to: request.to ?? "", timeZone: request.timeZone ?? "" });
/** Writes a giving scope into an address, stating only the members it holds: the read admits a period of two days, so a half scope is never sent as one it would refuse. */
function writeGivingScope(search: URLSearchParams, scope: GivingScope): void {
  if (scope.currency !== "") search.set(READ_PARAM.currency, scope.currency);
  if (scope.from !== "" && scope.to !== "") {
    search.set(READ_PARAM.from, scope.from);
    search.set(READ_PARAM.to, scope.to);
  }
  if (scope.timeZone !== "") search.set(READ_PARAM.timeZone, scope.timeZone);
}
/** The address of one roster read job: the job's own name, the parameters only the roster job is asked with, and the giving scope its giving figures and its filter counts are read over. */
function readUrl(job: RosterReadJob, params: RosterRequestParams | null): string {
  const search = new URLSearchParams();
  search.set(ROSTER_QUERY_PARAM, job);
  if (params !== null) {
    if (params.search !== undefined) search.set(READ_PARAM.search, params.search);
    for (const expression of params.facet ?? []) search.append(READ_PARAM.facet, expression);
    if (params.sort !== undefined && params.direction !== undefined) {
      search.set(READ_PARAM.sort, params.sort);
      search.set(READ_PARAM.direction, params.direction);
    }
    search.set(READ_PARAM.page, String(params.page));
    search.set(READ_PARAM.pageSize, String(params.pageSize));
    writeGivingScope(search, givingScopeOf(params));
  }
  return `${PARTNERS_READ_PATH}?${search.toString()}`;
}
/** The facet set's own address: the facets job asked with the giving scope and nothing else, because the set describes every record that scope admits rather than the page, search or filter the roster happens to be showing. */
function facetsUrl(scope: GivingScope): string {
  const search = new URLSearchParams();
  search.set(ROSTER_QUERY_PARAM, ROSTER_READ_JOB.facets);
  writeGivingScope(search, scope);
  return `${PARTNERS_READ_PATH}?${search.toString()}`;
}
const wholeResultTotal = (page: RosterPageWindow<unknown>): number | null => (Number.isFinite(page.total) ? page.total : null);
const scopeIsResolved = (scope: Scope): boolean => [scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId].every((identifier) => typeof identifier === "string" && identifier !== "");
/** Whether two scopes are the same authority: the four identifiers the read runs under, compared one by one. */
const sameScope = (left: Scope, right: Scope): boolean => left.organizationId === right.organizationId && left.ministryId === right.ministryId && left.supportSubjectId === right.supportSubjectId && left.principalId === right.principalId;
/** Whether two requests ask the read for the same answer: every member compared, so the search, a selection, the ordering, the page window and the giving scope are one question rather than two. */
function sameRequest(left: RosterRequestParams, right: RosterRequestParams): boolean {
  const leftFacets = left.facet ?? [];
  const rightFacets = right.facet ?? [];
  return (
    leftFacets.length === rightFacets.length &&
    leftFacets.every((expression, index) => expression === rightFacets[index]) &&
    left.page === right.page &&
    left.pageSize === right.pageSize &&
    (left.search ?? "") === (right.search ?? "") &&
    (left.sort ?? "") === (right.sort ?? "") &&
    (left.direction ?? "") === (right.direction ?? "") &&
    (left.currency ?? "") === (right.currency ?? "") &&
    (left.from ?? "") === (right.from ?? "") &&
    (left.to ?? "") === (right.to ?? "") &&
    (left.timeZone ?? "") === (right.timeZone ?? "")
  );
}
/** The roster read a server render already answered, when it is the answer this surface is about to ask for: the surface must still ask the question the server answered, the window the payload echoes must be the one being asked for, and the envelope must have run under this authority. A denial, an outage and a refusal are never seeded, so each keeps its own arm. */
function seedOf<TRow>(initialResult: ReadResult<RosterEnvelope<TRow>> | undefined, asked: RosterRequestParams | null, request: RosterRequestParams, scope: Scope): ReadResult<RosterEnvelope<TRow>> | undefined {
  if (initialResult === undefined || initialResult.kind !== "envelope" || asked === null) return undefined;
  const { envelope } = initialResult;
  return sameRequest(asked, request) && sameScope(envelope.scope, scope) && envelope.data.page.index === request.page && envelope.data.page.size === request.pageSize ? initialResult : undefined;
}
/** Reads the partner roster under one scope with the query state its URL holds, the giving scope included, so every figure on screen is read over the currency and period the address states. Every change writes the URL back, so opening a record and returning re-issues the identical read; `initialResult` is the answer a server render already read for this same view, so the first paint states those rows and that count and the mount repeats no identical request. */
export function useRosterQuery<TRow = unknown>(scope: Scope, options: RosterQueryOptions = {}, initialResult?: ReadResult<RosterEnvelope<TRow>>): RosterQueryResult<TRow> {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const admittedColumnKeys = options.admittedColumnKeys;
  const query = useMemo(() => parseRosterQuery(searchParams, admittedColumnKeys), [searchParams, admittedColumnKeys]);
  const signature = useMemo(() => rosterQuerySignature(query), [query]);
  const request = useMemo(() => rosterRequestParams(query), [query]);
  // The giving scope the facet set is read over, stated once: a currency, period or zone the address states re-reads the set, where a search, a filter, an ordering or a page change leaves it as it is.
  const givingScope = useMemo(() => givingScopeOf(request), [request]);
  // The request this surface was first asked for. The address moves on as the worker searches, filters, sorts and pages, and the payload echoes no search or selection, so a seed only ever stands for the question the server read it with.
  const [asked] = useState<RosterRequestParams | null>(() => (initialResult === undefined ? null : request));
  const seed = seedOf(initialResult, asked, request, scope);
  const commit = useCallback(
    (next: RosterQueryState) => {
      const search = rosterQuerySearch(next);
      router.replace(search === "" ? pathname : `${pathname}?${search}`, { scroll: false });
    },
    [pathname, router],
  );
  const setQuery = useCallback((patch: Partial<RosterQueryState>) => commit(mergeRosterQuery(query, patch)), [commit, query]);
  const clearFacetValue = useCallback(
    (facetKey: string, value: string) => {
      const selected = query.facets[facetKey];
      if (selected === undefined) return;
      const remaining = selected.filter((entry) => entry !== value);
      const facets: Record<string, readonly string[]> = { ...query.facets };
      if (remaining.length === 0) delete facets[facetKey];
      else facets[facetKey] = remaining;
      commit(mergeRosterQuery(query, { facets }));
    },
    [commit, query],
  );
  const clearAll = useCallback(() => commit(mergeRosterQuery(query, { search: "", facets: {} })), [commit, query]);
  const enabled = scopeIsResolved(scope);
  const roster = useQuery<ReadResult<RosterEnvelope<TRow>>>({
    queryKey: [...scopeKey(scope), PARTNER_KEY.roster, request],
    queryFn: () => fetchRead<RosterPageWindow<TRow>>({ url: readUrl(ROSTER_READ_JOB.roster, request), admits: isRosterPageWindow }),
    placeholderData: keepPreviousData,
    initialData: seed,
    refetchOnMount: seed === undefined,
    enabled,
  });
  const facets = useQuery<ReadResult<RosterFacetsEnvelope>>({ queryKey: [...scopeKey(scope), PARTNER_KEY.facets, givingScope], queryFn: () => fetchRead<readonly RosterFacetSummary[]>({ url: facetsUrl(givingScope), admits: isFacetList }), enabled });
  const savedViews = useQuery<ReadResult<RosterSavedViewsEnvelope>>({ queryKey: [...scopeKey(scope), PARTNER_KEY.savedViews], queryFn: () => fetchRead<readonly RosterSavedViewSummary[]>({ url: readUrl(ROSTER_READ_JOB.savedViews, null), admits: isSavedViewList }), enabled });
  const rosterEnvelope = envelopeIn(roster.data);
  const facetsEnvelope = envelopeIn(facets.data);
  const admittedFacetKeys = facetsEnvelope === null ? [] : facetsEnvelope.data.map((facet) => facet.id);
  const admitted = new Set(admittedFacetKeys);
  const unadmittedFacetKeys = facetsEnvelope === null ? [] : Object.keys(query.facets).filter((facetKey) => !admitted.has(facetKey));
  return { query, setQuery, clearFacetValue, clearAll, signature, roster, facets, savedViews, rowCount: rosterEnvelope === null ? null : wholeResultTotal(rosterEnvelope.data), admittedFacetKeys, unadmittedFacetKeys };
}
