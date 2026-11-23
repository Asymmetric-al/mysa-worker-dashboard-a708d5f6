"use client";
import { useQuery } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { RecordListQueryState } from "@/components/record-list";
import type { ReadEnvelope, ReadResult } from "@/modules/data-service";
import { INITIATIVE_API, readEnvelope } from "../api-client";
const INITIATIVE_RESULTS_JOB = "initiative-results";
/** The envelope member of `ReadResult<ReadEnvelope<D>>`: what the Server Component hands over, and what this read's `initialData` carries. */
export type InitiativeResultsEnvelope<D> = Extract<ReadResult<ReadEnvelope<D>>, { kind: "envelope" }>;
/** What this read answers: the first answer is still awaited, or the read's own result — the scoped envelope, a denial carrying nothing about the record, or an unavailable source. */
export type InitiativeResultsQuery<D> = { readonly status: "loading"; readonly isFetching: true } | { readonly status: "ready"; readonly result: ReadResult<ReadEnvelope<D>>; readonly isFetching: boolean };
/** Drives `readInitiativeResults` for one initiative in one context: the result is the read's own `envelope | denied | unavailable | refused`, unwrapped, so the caller narrows it — and each count … */
export function useInitiativeResults<D>(initiativeId: string, queryState: RecordListQueryState, initialEnvelope: InitiativeResultsEnvelope<D>): InitiativeResultsQuery<D> {
  const { data, isFetching } = useQuery<ReadResult<ReadEnvelope<D>>, Error>({
    queryKey: [...scopeKey(initialEnvelope.envelope.scope), INITIATIVE_RESULTS_JOB, initiativeId, queryState],
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
