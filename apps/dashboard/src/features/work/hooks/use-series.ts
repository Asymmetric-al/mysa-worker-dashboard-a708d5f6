"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { fetchRead } from "@/lib/read-transport";
import type { Scope, reads } from "@/modules/data-service";
export type SeriesQuery = Parameters<typeof reads.series.readSeries>[0];
export type SeriesResult = Awaited<ReturnType<typeof reads.series.readSeries>>;
type SeriesEnvelope = Extract<SeriesResult, { readonly kind: "envelope" }>["envelope"];
function seriesEndpointFor(seriesId: string): string {
  const search = new URLSearchParams();
  search.set("seriesId", seriesId);
  return `/api/series?${search.toString()}`;
}
const isSeriesData = (value: unknown): boolean => isRecord(value);
async function getSeriesRead(seriesId: string, signal: AbortSignal): Promise<SeriesResult> {
  const query: SeriesQuery = { seriesId };
  return fetchRead<SeriesEnvelope["data"], SeriesEnvelope["coverage"]>({ url: seriesEndpointFor(query.seriesId), admits: isSeriesData, signal });
}
/** Reads one recurring series in the given scope. `initialResult` is the answer a server render already read for this same scope and plan: it seeds the cache, so the first browser paint states exactly what the server painted and no second request repeats that read on mount, while every accepted series mutation invalidates the `series` key and re-reads the plan regardless. */
export const useSeries = (scope: Scope, seriesId: string, initialResult?: SeriesResult): UseQueryResult<SeriesResult, Error> =>
  useQuery<SeriesResult, Error>({ queryKey: [...scopeKey(scope), "series", seriesId], queryFn: ({ signal }) => getSeriesRead(seriesId, signal), initialData: initialResult, refetchOnMount: initialResult === undefined, enabled: seriesId.length > 0 });
