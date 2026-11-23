"use client";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { isStale, queryKey, type QueryParams, type ScopedQueryKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { fetchReadOrOutage, handlerSource } from "@/lib/read-transport";
import type { Coverage, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import type { AudienceQuery, DiscoveryIndexQuery, InboxQuery, ReceivingListQuery, ReceivingPageQuery, ReceivingPostQuery, readAudience, readDiscoveryIndex, readInbox, readReceivingList, readReceivingPage, readReceivingPost } from "@/modules/data-service/reads/audience";
const AUDIENCE_JOB = "audience";
const INBOX_JOB = "inbox";
const RECEIVING_LIST_JOB = "receiving-list";
const RECEIVING_POST_JOB = "receiving-post";
const DISCOVERY_INDEX_JOB = "discovery-index";
const RECEIVING_PAGE_JOB = "receiving-page";
/** Every job segment this family keys under, in the order AAP 0.7.1 lists the reads. */ export const AUDIENCE_JOB_SEGMENTS = [AUDIENCE_JOB, "preferences", INBOX_JOB, RECEIVING_LIST_JOB, RECEIVING_POST_JOB, DISCOVERY_INDEX_JOB, RECEIVING_PAGE_JOB] as const;
type ReadOf<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;
type EnvelopeOf<R> = R extends { readonly kind: "envelope"; readonly envelope: infer E } ? E : never;
export type AudienceEnvelope = EnvelopeOf<ReadOf<typeof readAudience>>;
export type InboxEnvelope = EnvelopeOf<ReadOf<typeof readInbox>>;
export type ReceivingListEnvelope = EnvelopeOf<ReadOf<typeof readReceivingList>>;
export type ReceivingPostEnvelope = EnvelopeOf<ReadOf<typeof readReceivingPost>>;
export type DiscoveryIndexEnvelope = EnvelopeOf<ReadOf<typeof readDiscoveryIndex>>;
export type ReceivingPageEnvelope = EnvelopeOf<ReadOf<typeof readReceivingPage>>;
const READ_STALE_TIME_MS = 5_000;
const TRANSPORT_GUIDANCE = "The request did not complete, so this read has no answer and is reported unavailable rather than empty. Request it again: nothing was changed, and a source that could not be read is not a source with nothing in it.";
const pageParams = (query: { readonly page?: number; readonly pageSize?: number }): QueryParams => ({ ...(query.page === undefined ? {} : { page: query.page }), ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }) });
function searchOf(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const name of Object.keys(params).sort()) {
    const value = params[name];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") search.set(name, String(value));
  }
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}
const staleTimeOf = (result: ReadResult<unknown> | undefined): number => (result?.kind === "envelope" ? READ_STALE_TIME_MS : 0);
async function readOnce<TData, TCoverage extends Coverage = Coverage>(endpoint: string, params: QueryParams): Promise<ReadResult<ReadEnvelope<TData, TCoverage>>> {
  return fetchReadOrOutage<TData, TCoverage>({ url: `${endpoint}${searchOf(params)}`, admits: isRecord, source: handlerSource(endpoint), guidance: TRANSPORT_GUIDANCE });
} /** What {@link useAudience} needs: the authority to read under, and the read's own paging state. */
export type UseAudienceParams = { readonly scope: Scope; readonly query?: AudienceQuery };
/** Reads the publisher's audience for the one purpose this release keeps memberships for. Answers `envelope`, `denied` or `unavailable`, unchanged. */ export function useAudience({ scope, query = {} }: UseAudienceParams): UseQueryResult<ReadResult<AudienceEnvelope>> {
  const params: QueryParams = { ...(query.publisherId === undefined ? {} : { publisherId: query.publisherId }), ...pageParams(query) };
  return useQuery<ReadResult<AudienceEnvelope>>({ queryKey: queryKey(scope, AUDIENCE_JOB, params), queryFn: () => readOnce<AudienceEnvelope["data"], AudienceEnvelope["coverage"]>("/api/audience", params), retry: false, staleTime: (entry) => staleTimeOf(entry.state.data) });
}
/** What {@link useInbox} needs: the authority to read under, and the read's own paging state. */ export type UseInboxParams = { readonly scope: Scope; readonly query?: InboxQuery };
/** Reads one page of this reader's synthetic inbox: one message per recipient and notification intent, each with its HTML and plain text. Answers `envelope`, `denied` or `unavailable`, unchanged. */ export function useInbox({ scope, query = {} }: UseInboxParams): UseQueryResult<ReadResult<InboxEnvelope>> {
  const params = pageParams(query);
  return useQuery<ReadResult<InboxEnvelope>>({ queryKey: queryKey(scope, INBOX_JOB, params), queryFn: () => readOnce<InboxEnvelope["data"], InboxEnvelope["coverage"]>("/api/inbox", params), retry: false, staleTime: (entry) => staleTimeOf(entry.state.data) });
}
/** What a route-envelope read hands its component: the union the server produced, a request for the server to check the route again, and the hook's busy state. */ export type RouteEnvelope<T> = { readonly result: ReadResult<T>; readonly refresh: () => void; readonly isFetching: boolean };
function useRouteEnvelope<T extends { readonly scope: Scope }>(scope: Scope, key: ScopedQueryKey, initialEnvelope: ReadResult<T>): RouteEnvelope<T> {
  const queryClient = useQueryClient();
  const router = useRouter();
  const entry = useQuery<ReadResult<T>>({ queryKey: key, queryFn: () => Promise.resolve(initialEnvelope), initialData: initialEnvelope, enabled: false, retry: false, staleTime: READ_STALE_TIME_MS });
  useEffect(() => {
    if (initialEnvelope.kind === "envelope" && isStale(initialEnvelope.envelope.scope, scope)) return;
    if (queryClient.getQueryData<ReadResult<T>>(key) === initialEnvelope) return;
    queryClient.setQueryData<ReadResult<T>>(key, initialEnvelope);
  }, [queryClient, key, scope, initialEnvelope]);
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);
  return { result: entry.data ?? initialEnvelope, refresh, isFetching: entry.isFetching };
}
/** What {@link useReceivingList} needs: the authority to read under, the params the entry is keyed by (omitted because the read itself defaults its query), and the envelope the Server Component read. */
export type UseReceivingListParams = { readonly scope: Scope; readonly params?: ReceivingListQuery; readonly initialEnvelope: ReadResult<ReceivingListEnvelope> };
/** Renders the Updates a reader may open now, as the server authorised them. Answers `envelope`, `denied` or `unavailable`, exactly as the server produced it; `refresh()` asks the server again. */
export const useReceivingList = ({ scope, params = {}, initialEnvelope }: UseReceivingListParams): RouteEnvelope<ReceivingListEnvelope> => useRouteEnvelope(scope, queryKey(scope, RECEIVING_LIST_JOB, { ...(params.locale === undefined ? {} : { locale: params.locale }), ...pageParams(params) }), initialEnvelope);
/** What {@link useReceivingPost} needs. */ export type UseReceivingPostParams = { readonly scope: Scope; readonly params: ReceivingPostQuery; readonly initialEnvelope: ReadResult<ReceivingPostEnvelope> };
/** Renders one Update at its exact post, re-authorised by the server on every open. Answers `envelope`, `denied` or `unavailable`, exactly as the server produced it; `refresh()` asks the server again. */
export const useReceivingPost = ({ scope, params, initialEnvelope }: UseReceivingPostParams): RouteEnvelope<ReceivingPostEnvelope> =>
  useRouteEnvelope(scope, queryKey(scope, RECEIVING_POST_JOB, { updateId: params.updateId, ...(params.locale === undefined ? {} : { locale: params.locale }), ...(params.variant === undefined ? {} : { variant: params.variant }) }), initialEnvelope);
/** What {@link useDiscoveryIndex} needs. */ export type UseDiscoveryIndexParams = { readonly scope: Scope; readonly params?: DiscoveryIndexQuery; readonly initialEnvelope: ReadResult<DiscoveryIndexEnvelope> };
/** Renders the page editions that reach a public listing, and nothing else: the service decided which they are. Answers `envelope`, `denied` or `unavailable`, exactly as the server produced it; `refresh()` asks the server again. */
export const useDiscoveryIndex = ({ scope, params = {}, initialEnvelope }: UseDiscoveryIndexParams): RouteEnvelope<DiscoveryIndexEnvelope> => useRouteEnvelope(scope, queryKey(scope, DISCOVERY_INDEX_JOB, pageParams(params)), initialEnvelope);
/** What {@link useReceivingPage} needs. */ export type UseReceivingPageParams = { readonly scope: Scope; readonly params: ReceivingPageQuery; readonly initialEnvelope: ReadResult<ReceivingPageEnvelope> };
/** Renders one page edition reached by direct link, with the reach decision, `noindex` metadata and tombstone the service produced. Answers `envelope`, `denied` or `unavailable`, exactly as the server produced it; `refresh()` asks the server again. */
export const useReceivingPage = ({ scope, params, initialEnvelope }: UseReceivingPageParams): RouteEnvelope<ReceivingPageEnvelope> => useRouteEnvelope(scope, queryKey(scope, RECEIVING_PAGE_JOB, { pageId: params.pageId, ...(params.locale === undefined ? {} : { locale: params.locale }) }), initialEnvelope);
