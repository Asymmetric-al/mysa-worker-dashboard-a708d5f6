"use client";
/**
 * The browser read behind one initiative's results: every count the service recorded, each stated over
 * the base it is measured against (`readInitiativeResults`, AAP 0.7.1 "Coordinate outreach").
 *
 * **Why the hook carries no arithmetic.** AAP 0.8.3 requires results to state their denominator, and
 * the honesty of that surface depends on this file never dividing. A zero base must never become a zero
 * percentage or `NaN`: the service already omits `percentage` when a base is zero or absent, so the
 * denominator arrives here beside each count and the surface states it in words. This hook therefore
 * returns the read's own result untouched — no share, ratio, ranking, combined total, added field or
 * reformatted number — and a value the envelope withholds stays withheld rather than being
 * reconstructed by subtraction.
 *
 * **Which path it reads, and with what.** The results read travels on `INITIATIVE_API.requests`: the
 * `GET` handler on that path is the results read, and it parses its query with a strict schema admitting
 * exactly one parameter, `initiativeId`. So the request carries that identifier and nothing else; the
 * surface's paging, sorting and column state still enters the cache key, so two view states never share
 * one entry, but it is not transported — this read answers with whole-initiative counts rather than a
 * page of rows, and an extra parameter would fail the handler's strict parse and be reported as an
 * outage that is not one.
 *
 * **Why these freshness flags.** The Server Component has already answered once under this exact scope,
 * initiative and query state, so the table paints from `initialData` with no `GET` on first paint;
 * `staleTime: 0` keeps that answer stale while `refetchOnMount: false` and `refetchOnWindowFocus: false`
 * prevent a background read, and `invalidateQueries` refetches an active query regardless of those flags,
 * so one accepted response change produces exactly one read of this job.
 *
 * **Layering.** This family's hook → the shared components it names → the data-service types; the read
 * travels through the family's one transport rather than a request of its own.
 */
import { useQuery } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { RecordListQueryState } from "@/components/record-list";
import type { ReadEnvelope, ReadResult, Scope } from "@/modules/data-service";
import { INITIATIVE_API, readEnvelope } from "../api-client";
/** The job segment of this read's key, named the way the service names the read, so the fence's scope prefix stays the only place authority enters a key. */
const INITIATIVE_RESULTS_JOB = "initiative-results";
/** The envelope member of `ReadResult<ReadEnvelope<D>>`: what the Server Component hands over, and what this read's `initialData` carries. */
export type InitiativeResultsEnvelope<D> = Extract<ReadResult<ReadEnvelope<D>>, { kind: "envelope" }>;
/**
 * What this read answers: the first answer is still awaited, or the read's own result — the scoped
 * envelope, a denial carrying nothing about the record, or an unavailable source.
 */
export type InitiativeResultsQuery<D> =
  | { readonly status: "loading"; readonly isFetching: true }
  | { readonly status: "ready"; readonly result: ReadResult<ReadEnvelope<D>>; readonly isFetching: boolean };
/**
 * Drives `readInitiativeResults` for one initiative in one context: the result is the read's own
 * `envelope | denied | unavailable`, unwrapped, so the caller narrows it — and each count arrives with
 * the denominator it is stated over, which the caller renders in words rather than dividing here.
 */
export function useInitiativeResults<D>(initiativeId: string, queryState: RecordListQueryState, initialEnvelope: InitiativeResultsEnvelope<D>): InitiativeResultsQuery<D> {
  // The scope is the authority the Server Component's read ran under: the key leads with it, so a
  // context switch clears this entry with the rest of the cache and a stale scope can never render
  // these counts as if they belonged to the context on screen.
  const scope: Scope = initialEnvelope.envelope.scope;
  const { data, isFetching } = useQuery<ReadResult<ReadEnvelope<D>>, Error>({
    queryKey: [...scopeKey(scope), INITIATIVE_RESULTS_JOB, initiativeId, queryState],
    // The one parameter the results handler admits, read from the family's own closed path set.
    queryFn: () => readEnvelope<ReadEnvelope<D>>(INITIATIVE_API.requests, { initiativeId }),
    initialData: initialEnvelope,
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // A read has no effect to repeat, and the family transport already answers a failed request with
    // the honest `unavailable` result, so a retry would only ask the same question twice.
    retry: false,
  });
  const result: ReadResult<ReadEnvelope<D>> | undefined = data;
  if (result === undefined) {
    // `initialData` is always supplied, so this is the union's completeness path: a query holding no
    // answer yet is by definition still awaiting its first one.
    return { status: "loading", isFetching: true };
  }
  return { status: "ready", result, isFetching };
}
