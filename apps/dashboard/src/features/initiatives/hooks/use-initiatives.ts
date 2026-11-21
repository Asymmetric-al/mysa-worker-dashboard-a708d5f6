"use client";
/**
 * The initiative list's one browser read: drives `readInitiatives` over the family's transport, in the
 * scope the server render already read the list in, and hands back the read's own answer — its
 * envelope, a denial, or an unavailable source — without ever deciding what any of them means.
 */
import { useQuery } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { RecordListQueryState } from "@/components/record-list";
import type { ReadEnvelope, ReadResult, Scope } from "@/modules/data-service";
import { INITIATIVE_API, readEnvelope } from "../api-client";
/** The job segment this hook's cache keys carry, beside the scope they were read under. */
const INITIATIVES_JOB = "initiatives";
/** The envelope arm of a read: what a Server Component holds once `readInitiatives` answered with the list, and the seed this hook starts from. */
export type InitiativesEnvelope<D> = Extract<ReadResult<ReadEnvelope<D>>, { readonly kind: "envelope" }>;
/** The one shape a caller branches on: the list is still arriving, or the read answered with its envelope, a denial or an unavailable source — passed through as it stands. */
export type InitiativesQuery<D> = { readonly status: "loading"; readonly isFetching: true } | { readonly status: "ready"; readonly result: ReadResult<ReadEnvelope<D>>; readonly isFetching: boolean };
/** Everything this read asks the service for, in the read's own vocabulary: the order the list is presented in and the page window. Visible columns are presentation, so they stay in the cache key and never in the request. */
function paramsOf(queryState: RecordListQueryState): Readonly<Record<string, string | number | undefined>> {
  const [order] = queryState.sort;
  return {
    // The read names one order at a time and owns the direction of each, so only the leading column's id
    // travels; a column id the read does not admit is dropped by the route rather than refused here.
    ...(order === undefined ? {} : { sort: order.id }),
    page: queryState.page,
    pageSize: queryState.pageSize,
  };
}
/** Drives `readInitiatives` (GET /api/initiatives); yields an envelope, `denied` or `unavailable`. */
export function useInitiatives<D>(queryState: RecordListQueryState, initialEnvelope: InitiativesEnvelope<D>): InitiativesQuery<D> {
  const scope: Scope = initialEnvelope.envelope.scope;
  const read = useQuery<ReadResult<ReadEnvelope<D>>, Error>({
    queryKey: [...scopeKey(scope), INITIATIVES_JOB, queryState],
    queryFn: async () => readEnvelope<ReadEnvelope<D>>(INITIATIVE_API.initiatives, paramsOf(queryState)),
    initialData: initialEnvelope,
    // The server render already read this list, so mounting must not read it again: `initialData` is
    // subject to `staleTime` in v5, and these two flags are what hold the first paint to zero requests
    // while `invalidateQueries` still refetches this active query after a change.
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
