"use client";
/**
 * The Audience family's seven browser reads, and the cache keys its writes invalidate.
 *
 * **Authority.** This is the one place the audience family reads from the browser. AAP 0.15.1 "Data
 * access" splits the two paths — a Server Component calls the service directly, a client interaction
 * calls a Route Handler — and these are the client path for AAP 0.7.1's "Reach readers" row of named
 * reads: `readAudience`, `readPreferences`, `readInbox`, `readReceivingList`, `readReceivingPost`,
 * `readDiscoveryIndex` and `readReceivingPage`. That is all seven and no more: `readSendResult`
 * belongs to the Updates delivery screen and is deliberately absent, because a name the row does not
 * give this family would be a feature this scope did not agree. The folder is the one AAP 0.9.1 and
 * the AAP 0.11.1 row `apps/dashboard/src/features/audience/**` describe, the family is AAP 0.10.1
 * family 10 (criteria 10, 12, 17 and 19), and TanStack Query is the one asynchronous-result cache
 * (AAP 0.3.4), so nothing here keeps a second copy of a result.
 *
 * **Three transport shapes, and why each is the one it is.**
 *
 * 1. `useAudience`, `usePreferences` and `useInbox` fetch a read handler. `usePreferences` sends no
 *    query string at all: the preferences read declares no parameter and `GET /api/preferences`
 *    refuses every one it is given, because a reader's preference is the session's own and is never
 *    selected by a request.
 * 2. `useReceivingList`, `useReceivingPost`, `useDiscoveryIndex` and `useReceivingPage` make no
 *    request. Those four views are Server Components under `src/app/preview/**`, and access is
 *    rechecked on the server every time the route opens; an endpoint of their own would let a client
 *    cache answer a question only the server may answer. Each adopts the envelope its Server
 *    Component produced, replaces it when a new one arrives (a refresh is authoritative), and exposes
 *    `refresh()` for the component to call once a persona or edition change is committed.
 * 3. No context-switch transport lives here. The predicate that decides an answer belongs to a
 *    context this view has left is imported from `@/components/context-switch-guard` — the one
 *    definition of it — and compared with the scope the caller is rendering. Performing the switch
 *    itself is the shell's job: a dispatch built here would be a second transport to the same route.
 *
 * **What the wire carries.** `modules/data-service/response.ts` flattens a read result onto the body:
 * an envelope arrives as the envelope itself, a denial as the denied outcome, an outage as the
 * unavailable outcome. This module therefore parses the body rather than the status, and turns a body
 * it cannot read into `unavailable` — a read is never rendered as empty, as zero, or as a denial it
 * did not receive.
 *
 * **Product rules held here, not computed here** (AAP 0.8.5, 0.8.6, 0.8.7). Off and Immediate are the
 * two choices and this module carries no preference logic. A reading language is separate from consent
 * and travels exactly as the envelope returns it. The confirmation window (168 elapsed hours) and the
 * notification usefulness window (24 hours) are the service's, so no deadline, no window and no clock
 * read appears in this file. The discovery index enumerates only the editions the service decided are
 * listed, and the public reading route's reach decision, `noindex` and tombstone are returned as the
 * service produced them. Counts and `valueStates` are never re-counted, re-shaped or inferred.
 */
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { isStale, queryKey, type QueryParams, type ScopedQueryKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import type { Scope } from "@/modules/data-service/envelope";
import { isOutcome, isReadResult, unavailable, type ReadResult } from "@/modules/data-service/outcome";
import type {
  AudienceQuery,
  DiscoveryIndexQuery,
  InboxQuery,
  ReceivingListQuery,
  ReceivingPageQuery,
  ReceivingPostQuery,
  readAudience,
  readDiscoveryIndex,
  readInbox,
  readPreferences,
  readReceivingList,
  readReceivingPage,
  readReceivingPost,
} from "@/modules/data-service/reads/audience";
// The seven jobs of this family's read row, named once
/** The publisher's audience view for the one purpose this release keeps memberships for. */
const AUDIENCE_JOB = "audience";
const PREFERENCES_JOB = "preferences";
const INBOX_JOB = "inbox";
const RECEIVING_LIST_JOB = "receiving-list";
const RECEIVING_POST_JOB = "receiving-post";
const DISCOVERY_INDEX_JOB = "discovery-index";
const RECEIVING_PAGE_JOB = "receiving-page";
/**
 * Every job segment this family keys under, in the order AAP 0.7.1 lists the reads. A writer that
 * invalidates this family's entries iterates the tuple rather than restating a segment, and the caches
 * are keyed `[...scopeKey(scope), segment, params]`, so the segment alone is a prefix that matches
 * every parameter set of its job.
 */
export const AUDIENCE_JOB_SEGMENTS = [AUDIENCE_JOB, PREFERENCES_JOB, INBOX_JOB, RECEIVING_LIST_JOB, RECEIVING_POST_JOB, DISCOVERY_INDEX_JOB, RECEIVING_PAGE_JOB] as const;
/** One job segment of this family's read row. */
export type AudienceJob = (typeof AUDIENCE_JOB_SEGMENTS)[number];
// What each read answers with, taken from the read rather than restated
/** What a read answered, whether it answered directly or through a promise. */
type ReadOf<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;
/**
 * The scoped envelope a read answered with: the envelope arm of its result union, and `never` for a read that
 * could only refuse. The result type is resolved before it is matched, because a conditional written over a
 * still-generic function type is deferred as a whole and would collapse every alias below to `never`.
 */
type EnvelopeOf<R> = R extends { readonly kind: "envelope"; readonly envelope: infer E } ? E : never;
/** The publisher's audience: four membership states, eligible and excluded counts, one page of members. */
export type AudienceEnvelope = EnvelopeOf<ReadOf<typeof readAudience>>;
/** A reader's own Off or Immediate choice, reading language, membership state and proof state. */
export type PreferencesEnvelope = EnvelopeOf<ReadOf<typeof readPreferences>>;
/** One reader's synthetic inbox: one message per recipient and notification intent. */
export type InboxEnvelope = EnvelopeOf<ReadOf<typeof readInbox>>;
/** The Updates a reader may open now, re-authorised at the read's instant. */
export type ReceivingListEnvelope = EnvelopeOf<ReadOf<typeof readReceivingList>>;
/** One Update at its exact post, re-authorised on every open. */
export type ReceivingPostEnvelope = EnvelopeOf<ReadOf<typeof readReceivingPost>>;
/** The page editions that reach a public listing, and nothing else. */
export type DiscoveryIndexEnvelope = EnvelopeOf<ReadOf<typeof readDiscoveryIndex>>;
/** One page edition served by direct link, with its reach decision and tombstone. */
export type ReceivingPageEnvelope = EnvelopeOf<ReadOf<typeof readReceivingPage>>;
// Fixed values
/** The attempt a read reports under: a read mints no operation identity, so it names the marker every read transport names. */
const READ_ATTEMPT_ID = "read";
/** The source behind a request that produced no usable answer — the response boundary, named as a source so an outage names something a person can act on and never a record. */
const HANDLER_SOURCE_SYSTEM = "data-service";
const AUDIENCE_ENDPOINT = "/api/audience";
const PREFERENCES_ENDPOINT = "/api/preferences";
const INBOX_ENDPOINT = "/api/inbox";
/** How long an envelope stays fresh. Short on purpose: a persona switch, a consent change or a clock step must reach the next read rather than hide behind a cache. */
const READ_STALE_TIME_MS = 5_000;
/** The parameters of a read that declares none, so its key still states a params member rather than a shorter key shape. */
const NO_PARAMS: QueryParams = Object.freeze({});

const TRANSPORT_GUIDANCE =
  "The request did not complete, so this read has no answer and is reported unavailable rather than empty. Request it again: nothing was changed, and a source that could not be read is not a source with nothing in it.";

const UNREADABLE_GUIDANCE =
  "The request was answered with a body this read does not recognise, so the result is reported unavailable rather than shown as empty. Request it again; if it keeps happening the response boundary is faulty rather than the records.";
// The parameters each read takes, as both the cache key and the request carry them
/**
 * The paging window a list read declares, with an absent value omitted rather than stated as a value
 * the read would have to interpret.
 */
function pageParams(query: { readonly page?: number; readonly pageSize?: number }): QueryParams {
  return {
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
  };
}
function audienceParams(query: AudienceQuery): QueryParams {
  return {
    ...(query.publisherId === undefined ? {} : { publisherId: query.publisherId }),
    ...pageParams(query),
  };
}
function inboxParams(query: InboxQuery): QueryParams {
  return pageParams(query);
}
function receivingListParams(query: ReceivingListQuery): QueryParams {
  return {
    ...(query.locale === undefined ? {} : { locale: query.locale }),
    ...pageParams(query),
  };
}
function receivingPostParams(query: ReceivingPostQuery): QueryParams {
  return {
    updateId: query.updateId,
    ...(query.locale === undefined ? {} : { locale: query.locale }),
  };
}
function discoveryIndexParams(query: DiscoveryIndexQuery): QueryParams {
  return pageParams(query);
}
function receivingPageParams(query: ReceivingPageQuery): QueryParams {
  return {
    pageId: query.pageId,
    ...(query.locale === undefined ? {} : { locale: query.locale }),
  };
}
/**
 * The query string one request carries, built from the same params object the key holds, so a key and
 * its request cannot drift apart. Every parameter these hooks build is a string, number or boolean; a
 * structured value has no query-string form and is therefore not a value these reads take.
 */
function searchOf(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const name of Object.keys(params).sort()) {
    const value = params[name];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      search.set(name, String(value));
    }
  }
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}
// The cache keys, one per job
/** The key of the publisher's audience read. A writer invalidating this job instead of one parameter set uses `[...scopeKey(scope), 'audience']`. */
export function audienceKey(scope: Scope, params: QueryParams): ScopedQueryKey {
  return queryKey(scope, AUDIENCE_JOB, params);
}
/** The key of the reader's own preference read. It admits no parameter, so the key states the job and an empty params member. */
export function preferencesKey(scope: Scope): ScopedQueryKey {
  return queryKey(scope, PREFERENCES_JOB, NO_PARAMS);
}
/** The key of the synthetic inbox read. */
export function inboxKey(scope: Scope, params: QueryParams): ScopedQueryKey {
  return queryKey(scope, INBOX_JOB, params);
}
/** The key of the receiving list read: the Updates one reader may open now. */
export function receivingListKey(scope: Scope, params: QueryParams): ScopedQueryKey {
  return queryKey(scope, RECEIVING_LIST_JOB, params);
}
/** The key of the exact-post read: one Update, at the revision the service admits for this reader. */
export function receivingPostKey(scope: Scope, params: QueryParams): ScopedQueryKey {
  return queryKey(scope, RECEIVING_POST_JOB, params);
}
/** The key of the discovery index read: the page editions listed publicly. */
export function discoveryIndexKey(scope: Scope, params: QueryParams): ScopedQueryKey {
  return queryKey(scope, DISCOVERY_INDEX_JOB, params);
}
/** The key of the public reading view: one page edition, reached by direct link. */
export function receivingPageKey(scope: Scope, params: QueryParams): ScopedQueryKey {
  return queryKey(scope, RECEIVING_PAGE_JOB, params);
}

// Reading an answer
/**
 * Reports whether a body carries the facts every envelope carries. This checks the envelope's own
 * members and never the payload's fields: the payload's shape belongs to the read that built it, so a
 * browser re-describing it would be a second owner of a contract it does not hold.
 */
function isEnvelopeBody(value: unknown): boolean {
  return isRecord(value) && "data" in value && isRecord(value.scope) && isRecord(value.valueStates) && typeof value.asOf === "string" && typeof value.revision === "string";
}
/** The outage a read answers with when its request produced no answer it can state: the handler is the source, and no record, count or title is named. */
function outage<T>(endpoint: string, guidance: string): ReadResult<T> {
  return {
    kind: "unavailable",
    unavailable: unavailable({
      operationId: READ_ATTEMPT_ID,
      source: { system: HANDLER_SOURCE_SYSTEM, reference: endpoint },
      guidance,
    }),
  };
}
/**
 * The read result one body states: the envelope the handler sent, the denial or the outage it sent, and
 * `unavailable` for a body that is none of them. `denied` and `unavailable` are the only two refusals a
 * read may carry (AAP 0.7.1), so a body this module cannot read becomes an outage rather than an
 * invented outcome or an empty result.
 */
function readResultOf<T>(body: unknown, endpoint: string): ReadResult<T> {
  if (isReadResult(body)) {
    return body as ReadResult<T>;
  }
  if (isOutcome(body) && body.outcome === "denied") {
    return { kind: "denied", denied: body };
  }
  if (isOutcome(body) && body.outcome === "unavailable") {
    return { kind: "unavailable", unavailable: body };
  }
  if (isEnvelopeBody(body)) {
    return { kind: "envelope", envelope: body as T };
  }
  return outage<T>(endpoint, UNREADABLE_GUIDANCE);
}
/** How fresh one cached answer is: five seconds for an envelope and none at all for a refusal, so a denial or an outage is never cached as though it were data. */
function staleTimeOf(result: ReadResult<unknown> | undefined): number {
  return result?.kind === "envelope" ? READ_STALE_TIME_MS : 0;
}
/**
 * One GET of one read handler, answered as a read result. The three endpoints this module serves are
 * the ones its own hooks name — there is no dispatcher here, no caller-supplied path and no second
 * transport. Nothing is thrown: a request that did not complete and a body that cannot be read are both
 * outages, which is what the surface shows beside its own retry.
 */
async function readOnce<T>(endpoint: string, params: QueryParams): Promise<ReadResult<T>> {
  let answer: Response;
  try {
    answer = await fetch(`${endpoint}${searchOf(params)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return outage<T>(endpoint, TRANSPORT_GUIDANCE);
  }
  let body: unknown;
  try {
    body = await answer.json();
  } catch {
    return outage<T>(endpoint, TRANSPORT_GUIDANCE);
  }
  return readResultOf<T>(body, endpoint);
}
// The three reads that have a handler
/** What {@link useAudience} needs: the authority to read under, and the read's own paging state. */
export interface UseAudienceParams {
  readonly scope: Scope;
  /** The read's own query, passed straight through: this hook defaults nothing the service would default and validates nothing the service would refuse. */
  readonly query?: AudienceQuery;
}
/** Reads the publisher's audience for the one purpose this release keeps memberships for. Answers `envelope`, `denied` or `unavailable`, unchanged. */
export function useAudience({ scope, query = {} }: UseAudienceParams): UseQueryResult<ReadResult<AudienceEnvelope>> {
  const params = audienceParams(query);
  return useQuery<ReadResult<AudienceEnvelope>>({
    queryKey: audienceKey(scope, params),
    queryFn: () => readOnce<AudienceEnvelope>(AUDIENCE_ENDPOINT, params),
    // A refusal is the source's answer, so it is never retried behind the worker's back: the surface
    // offers the refetch and says what happened.
    retry: false,
    staleTime: (entry) => staleTimeOf(entry.state.data),
  });
}
/** What {@link usePreferences} needs. The preferences read declares no parameter and its handler refuses every one it is given, so there is no query to pass. */
export interface UsePreferencesParams {
  readonly scope: Scope;
  readonly query?: undefined;
}
/** Reads the reader's own Off or Immediate choice, reading language, membership state and proof state as four separate facts. Answers `envelope`, `denied` or `unavailable`, unchanged. */
export function usePreferences({ scope }: UsePreferencesParams): UseQueryResult<ReadResult<PreferencesEnvelope>> {
  return useQuery<ReadResult<PreferencesEnvelope>>({
    queryKey: preferencesKey(scope),
    queryFn: () => readOnce<PreferencesEnvelope>(PREFERENCES_ENDPOINT, NO_PARAMS),
    retry: false,
    staleTime: (entry) => staleTimeOf(entry.state.data),
  });
}
/** What {@link useInbox} needs: the authority to read under, and the read's own paging state. */
export interface UseInboxParams {
  readonly scope: Scope;
  readonly query?: InboxQuery;
}
/** Reads one page of this reader's synthetic inbox: one message per recipient and notification intent, each with its HTML and plain text. Answers `envelope`, `denied` or `unavailable`, unchanged. */
export function useInbox({ scope, query = {} }: UseInboxParams): UseQueryResult<ReadResult<InboxEnvelope>> {
  const params = inboxParams(query);
  return useQuery<ReadResult<InboxEnvelope>>({
    queryKey: inboxKey(scope, params),
    queryFn: () => readOnce<InboxEnvelope>(INBOX_ENDPOINT, params),
    retry: false,
    staleTime: (entry) => staleTimeOf(entry.state.data),
  });
}

// The four reads that arrive with their route
/** What a route-envelope read hands its component: the union the server produced, a request for the server to check the route again, and the hook's busy state. */
export interface RouteEnvelope<T> {
  readonly result: ReadResult<T>;
  /** Asks the server for the current route again, so the read that answered it is authorised once more. */
  readonly refresh: () => void;
  readonly isFetching: boolean;
}
/**
 * The one mechanism behind the four views that arrive with their route. It never fetches: no handler
 * exists for these reads, and `enabled` is false, so the only ways an answer changes are a new envelope
 * from a server render and the component's own `refresh()` — which is what keeps access rechecked on the
 * server on every open (criteria 12, 17 and 19).
 */
function useRouteEnvelope<T extends { readonly scope: Scope }>(scope: Scope, key: ScopedQueryKey, initialEnvelope: ReadResult<T>): RouteEnvelope<T> {
  const queryClient = useQueryClient();
  const router = useRouter();
  const entry = useQuery<ReadResult<T>>({
    queryKey: key,
    // Never called: this read has no handler and `enabled` is false. The query function states what an
    // answer would be if it ever ran, rather than inventing a transport that does not exist.
    queryFn: () => Promise.resolve(initialEnvelope),
    initialData: initialEnvelope,
    enabled: false,
    retry: false,
    // Staleness cannot cause a fetch here because the query is disabled; the value is stated so the
    // entry is not marked stale the moment the server's answer is adopted.
    staleTime: READ_STALE_TIME_MS,
  });
  useEffect(() => {
    // `key` is a fresh array each render, so this effect runs after each one and returns at the guards
    // below as soon as the cache already holds the arriving answer: the comparison is against the
    // arrival itself, so an unchanged envelope is never written a second time.
    if (initialEnvelope.kind === "envelope" && isStale(initialEnvelope.envelope.scope, scope)) {
      // A late answer from a context this view has left is dropped rather than written: an envelope
      // read in another context's authority may never answer for this one.
      return;
    }
    if (queryClient.getQueryData<ReadResult<T>>(key) === initialEnvelope) {
      return;
    }
    // Replace, never merge: the newest server render is authoritative, so an edition withdrawn or a
    // grant revoked since the previous read cannot survive inside a cached envelope.
    queryClient.setQueryData<ReadResult<T>>(key, initialEnvelope);
  }, [queryClient, key, scope, initialEnvelope]);
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);
  return { result: entry.data ?? initialEnvelope, refresh, isFetching: entry.isFetching };
}
/** What {@link useReceivingList} needs: the authority to read under, the params the entry is keyed by (omitted because the read itself defaults its query), and the envelope the Server Component read. */
export interface UseReceivingListParams {
  readonly scope: Scope;
  readonly params?: ReceivingListQuery;
  readonly initialEnvelope: ReadResult<ReceivingListEnvelope>;
}
/** Renders the Updates a reader may open now, as the server authorised them. Answers `envelope`, `denied` or `unavailable`, exactly as the server produced it; `refresh()` asks the server again. */
export function useReceivingList({ scope, params = {}, initialEnvelope }: UseReceivingListParams): RouteEnvelope<ReceivingListEnvelope> {
  return useRouteEnvelope(scope, receivingListKey(scope, receivingListParams(params)), initialEnvelope);
}
/** What {@link useReceivingPost} needs. */
export interface UseReceivingPostParams {
  readonly scope: Scope;
  readonly params: ReceivingPostQuery;
  readonly initialEnvelope: ReadResult<ReceivingPostEnvelope>;
}
/** Renders one Update at its exact post, re-authorised by the server on every open. Answers `envelope`, `denied` or `unavailable`, exactly as the server produced it; `refresh()` asks the server again. */
export function useReceivingPost({ scope, params, initialEnvelope }: UseReceivingPostParams): RouteEnvelope<ReceivingPostEnvelope> {
  return useRouteEnvelope(scope, receivingPostKey(scope, receivingPostParams(params)), initialEnvelope);
}
/** What {@link useDiscoveryIndex} needs. */
export interface UseDiscoveryIndexParams {
  readonly scope: Scope;
  readonly params?: DiscoveryIndexQuery;
  readonly initialEnvelope: ReadResult<DiscoveryIndexEnvelope>;
}
/** Renders the page editions that reach a public listing, and nothing else: the service decided which they are. Answers `envelope`, `denied` or `unavailable`, exactly as the server produced it; `refresh()` asks the server again. */
export function useDiscoveryIndex({ scope, params = {}, initialEnvelope }: UseDiscoveryIndexParams): RouteEnvelope<DiscoveryIndexEnvelope> {
  return useRouteEnvelope(scope, discoveryIndexKey(scope, discoveryIndexParams(params)), initialEnvelope);
}
/** What {@link useReceivingPage} needs. */
export interface UseReceivingPageParams {
  readonly scope: Scope;
  readonly params: ReceivingPageQuery;
  readonly initialEnvelope: ReadResult<ReceivingPageEnvelope>;
}
/** Renders one page edition reached by direct link, with the reach decision, `noindex` metadata and tombstone the service produced. Answers `envelope`, `denied` or `unavailable`, exactly as the server produced it; `refresh()` asks the server again. */
export function useReceivingPage({ scope, params, initialEnvelope }: UseReceivingPageParams): RouteEnvelope<ReceivingPageEnvelope> {
  return useRouteEnvelope(scope, receivingPageKey(scope, receivingPageParams(params)), initialEnvelope);
}
