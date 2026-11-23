"use client";
import { useQuery } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, ReadResult } from "@/modules/data-service";
import { INITIATIVE_API, readEnvelope } from "../api-client";
const INITIATIVE_RESULTS_JOB = "initiative-results";
/** The envelope member of `ReadResult<ReadEnvelope<D>>`: what the Server Component hands over, and what this read's `initialData` carries. */
export type InitiativeResultsEnvelope<D> = Extract<ReadResult<ReadEnvelope<D>>, { kind: "envelope" }>;
/** What this read answers: the first answer is still awaited, or the read's own result — the scoped envelope, a denial carrying nothing about the record, or an unavailable source. */
export type InitiativeResultsQuery<D> = { readonly status: "loading"; readonly isFetching: true } | { readonly status: "ready"; readonly result: ReadResult<ReadEnvelope<D>>; readonly isFetching: boolean };
/**
 * Drives `readInitiativeResults` for one initiative in one context: the result is the read's own `envelope | denied | unavailable | refused`, unwrapped, so the caller narrows it, and every count it carries is stated over the initiative's whole working list.
 *
 * The read answers whole-initiative counts, which the surface paginates locally in its own tables, so the key states exactly what the request states: the scope, this job and the initiative id. `GET /api/initiatives/requests` admits `initiativeId` and nothing else, so a page window belongs to the surface and never to this read; keying on one would mint a second cache entry for a byte-identical request.
 */
export function useInitiativeResults<D>(initiativeId: string, initialEnvelope: InitiativeResultsEnvelope<D>): InitiativeResultsQuery<D> {
  const { data, isFetching } = useQuery<ReadResult<ReadEnvelope<D>>, Error>({
    queryKey: [...scopeKey(initialEnvelope.envelope.scope), INITIATIVE_RESULTS_JOB, initiativeId],
    queryFn: () => readEnvelope<ReadEnvelope<D>>(INITIATIVE_API.requests, { initiativeId }),
    initialData: initialEnvelope,
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const result: ReadResult<ReadEnvelope<D>> | undefined = data;
  if (result === undefined) return { status: "loading", isFetching: true };
  return { status: "ready", result, isFetching };
}
