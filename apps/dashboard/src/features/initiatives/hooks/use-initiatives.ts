"use client";
/** The initiative list's one browser read: drives `readInitiatives` over the family's transport, in the scope the server render already read the list in and under the search and state filter the list … */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { RecordListQueryState } from "@/components/record-list";
import type { ReadEnvelope, ReadResult, Scope } from "@/modules/data-service";
import type { InitiativeState } from "@/modules/data-service/envelope";
import { INITIATIVE_API, readEnvelope } from "../api-client";
/** The job segment this hook's cache keys carry, beside the scope they were read under. */
const INITIATIVES_JOB = "initiatives";
/** The two filters the list surface states and the read applies: the whole-dataset search over an initiative's name and purpose, and the initiative state. */
export interface InitiativesFilters {
  readonly search?: string;
  readonly state?: InitiativeState;
}
/** The envelope arm of a read: what a Server Component holds once `readInitiatives` answered with the list, and the seed this hook starts from. */
export type InitiativesEnvelope<D> = Extract<ReadResult<ReadEnvelope<D>>, { readonly kind: "envelope" }>;
/** The one shape a caller branches on: the list is still arriving, or the read answered with its envelope, a denial or an unavailable source — passed through as it stands. */
export type InitiativesQuery<D> = { readonly status: "loading"; readonly isFetching: true } | { readonly status: "ready"; readonly result: ReadResult<ReadEnvelope<D>>; readonly isFetching: boolean };
/** The filters as the read takes them: a blank search and an absent state ask for nothing, so neither travels nor splits the cache. */
function filtersOf(filters: InitiativesFilters): InitiativesFilters {
  return { ...(filters.search === undefined || filters.search === "" ? {} : { search: filters.search }), ...(filters.state === undefined ? {} : { state: filters.state }) };
}
/** Everything this read asks the service for, in the read's own vocabulary: the order the list is presented in, the two filters and the page window. Visible columns are presentation, so they stay in the cache key and never in the request. */
function paramsOf(queryState: RecordListQueryState, filters: InitiativesFilters): Readonly<Record<string, string | number | undefined>> {
  const [order] = queryState.sort;
  return {
    // The read names one order at a time and owns the direction of each, so only the leading column's id
    // travels; the route refuses a column id the read does not admit, keyed at this field, so a table
    // must offer only the orders the read itself names.
    ...(order === undefined ? {} : { sort: order.id }),
    ...filters,
    page: queryState.page,
    pageSize: queryState.pageSize,
  };
}
/** The request one cache entry answers, as one string: the order, both filters and the page window — everything the read is asked, and nothing that is only presentation. */
function requestOf(queryState: RecordListQueryState, filters: InitiativesFilters): string {
  const params = paramsOf(queryState, filters);
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${String(params[key] ?? "")}`)
    .join("&");
}
/** Drives `readInitiatives` (GET /api/initiatives) under the given filters; yields an envelope, `denied` or `unavailable`. */
export function useInitiatives<D>(queryState: RecordListQueryState, initialEnvelope: InitiativesEnvelope<D>, filters: InitiativesFilters = {}): InitiativesQuery<D> {
  const scope: Scope = initialEnvelope.envelope.scope;
  const stated = filtersOf(filters);
  const request = requestOf(queryState, stated);
  // The envelope belongs to the request the Server Component answered. React Query offers `initialData`
  // to any key that holds no answer yet, and refuses to refetch a key that already holds one, so an
  // ungated seed would answer a narrowed view with the first view's page and keep that answer. The seed
  // is therefore offered to the request this hook mounted with, and every other request is read.
  const [mountedWith] = useState(request);
  const seed = request === mountedWith ? initialEnvelope : undefined;
  const read = useQuery<ReadResult<ReadEnvelope<D>>, Error>({
    queryKey: [...scopeKey(scope), INITIATIVES_JOB, stated, queryState],
    queryFn: async () => readEnvelope<ReadEnvelope<D>>(INITIATIVE_API.initiatives, paramsOf(queryState, stated)),
    // The server render already read this list, so mounting must not read it again: `initialData` is
    // subject to `staleTime` in v5, and these two flags are what hold the first paint to zero requests
    // while `invalidateQueries` still refetches this active query after a change.
    ...(seed === undefined ? {} : { initialData: seed }),
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  // Widened deliberately: a changed `queryState` reaches a cache entry that has no answer yet, and the
  // returned union says so rather than presenting the previous view as the current one.
  const result: ReadResult<ReadEnvelope<D>> | undefined = read.data;
  if (result === undefined) {
    return { status: "loading", isFetching: true };
  }
  return { status: "ready", result, isFetching: read.isFetching };
}
