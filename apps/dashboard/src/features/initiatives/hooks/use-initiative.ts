"use client";
/**
 * The initiative detail's browser read: the one cache entry for `readInitiative`, seeded by the
 * envelope the Server Component already read and refetched only once that entry is invalidated.
 */
import { useQuery } from "@tanstack/react-query";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, ReadResult } from "@/modules/data-service";
import { INITIATIVE_API, readEnvelope } from "../api-client";
/** The job this read is cached under, beside the scope segments and the initiative it names. */
const INITIATIVE_JOB = "initiative";
/** One initiative's detail cache key: the scope, the job and the initiative, so two initiatives are two entries and a context switch clears both. */
type InitiativeQueryKey = readonly [...ScopeKey, typeof INITIATIVE_JOB, string];
/** The detail data as the service answers it: the envelope member of `readInitiative`'s result union. */
export type InitiativeEnvelope<D> = Extract<ReadResult<ReadEnvelope<D>>, { readonly kind: "envelope" }>["envelope"];
/** What {@link useInitiative} presents: the read has no answer yet, or its answer — envelope, `denied` or `unavailable` — with whether a refetch is in flight. */
export type InitiativeQuery<D> = { readonly status: "loading"; readonly isFetching: true } | { readonly status: "ready"; readonly result: ReadResult<ReadEnvelope<D>>; readonly isFetching: boolean };
/**
 * Reads one initiative through `GET /api/initiatives?initiativeId=…`, which answers with
 * `readInitiative`'s envelope or with that read's own `denied` / `unavailable` refusal.
 *
 * The transport's closed path set carries no per-record detail path, so the identifier travels as the
 * query key the list path reads. Nothing is computed here: the working list's three membership states,
 * the eligible candidate set, the terms versions, the denominators and the owned work all arrive
 * resolved in the envelope, and the advisory `actions` are handed on untouched so the service
 * re-checks every submit.
 */
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
