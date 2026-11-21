"use client";
/** The initiative detail's browser read: the one cache entry for `readInitiative`, seeded by the envelope the Server Component already read and refetched only once that entry is invalidated. */
import { useQuery } from "@tanstack/react-query";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, ReadResult } from "@/modules/data-service";
import { INITIATIVE_API, readEnvelope } from "../api-client";
const INITIATIVE_JOB = "initiative";
type InitiativeQueryKey = readonly [...ScopeKey, typeof INITIATIVE_JOB, string];
export type InitiativeEnvelope<D> = Extract<ReadResult<ReadEnvelope<D>>, { readonly kind: "envelope" }>["envelope"];
export type InitiativeQuery<D> = { readonly status: "loading"; readonly isFetching: true } | { readonly status: "ready"; readonly result: ReadResult<ReadEnvelope<D>>; readonly isFetching: boolean };
/** Reads one initiative through `GET /api/initiatives?initiativeId=…`, which answers with `readInitiative`'s envelope or with that read's own `denied` / `unavailable` refusal. */
export function useInitiative<D>(initiativeId: string, initialEnvelope: InitiativeEnvelope<D>): InitiativeQuery<D> {
  const scope = initialEnvelope.scope;
  const queryKey: InitiativeQueryKey = [...scopeKey(scope), INITIATIVE_JOB, initiativeId];
  const query = useQuery<ReadResult<ReadEnvelope<D>>, Error, ReadResult<ReadEnvelope<D>>, InitiativeQueryKey>({
    queryKey,
    queryFn: () => readEnvelope<ReadEnvelope<D>>(INITIATIVE_API.initiatives, { initiativeId }),
    initialData: { kind: "envelope", envelope: initialEnvelope },
    // v5 subjects `initialData` to `staleTime`, so these three settings are what keep the first paint
    // free of a request; an invalidation still refetches an active query, which is what recovers this
    // view after a sibling mutation. The read is never retried: its own envelope states a refusal.
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const result: ReadResult<ReadEnvelope<D>> | undefined = query.data;
  if (result === undefined) {
    return { status: "loading", isFetching: true };
  }
  return { status: "ready", result, isFetching: query.isFetching };
}
