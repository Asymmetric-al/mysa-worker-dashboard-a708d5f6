"use client";

/**
 * Home's one client hook: the scope-first cache key, the seeded envelope, and the refresh that keeps
 * Home from ever showing another context's work.
 *
 * Home is a Server Component. `src/app/page.tsx` calls `reads.context.readHome()` from
 * `@/modules/data-service` directly and hands the resulting envelope down, which is the only data
 * path Home has. The application declares no route handler for Home at all, no Server Action and no
 * second transport, so this hook has no read to perform — and three real jobs to do:
 *
 * (a) Own the cache key. {@link homeQueryKey} is the one place Home's key is built and it composes
 *     {@link scopeKey}, so Home's entry sits inside the same `["scope", organizationId, ministryId,
 *     supportSubjectId, job, params]` hierarchy as every other read. A key built anywhere else could
 *     not be cancelled, invalidated or cleared together with the rest of a context.
 *
 * (b) Seed the server-rendered envelope into the TanStack Query cache under that key, and keep the
 *     cache to what the server last stated. The cache is then the single place a scope's Home
 *     envelope lives in the browser, so the context fence's `queryClient.clear()` and any
 *     scope-prefixed invalidation act on Home exactly as they act on every other surface. Nothing
 *     here holds a second copy of the envelope in component state.
 *
 * (c) Re-render the Server Component when that envelope becomes stale, once per transition, so a
 *     Home that was invalidated (after a task was completed elsewhere, say) is re-read rather than
 *     left displaying what it held before. `router.refresh()` is the sanctioned way for a client
 *     component to ask Next 16 to re-render the Server Component above it; there is no fetch of the
 *     application's own HTTP endpoint anywhere in this file.
 *
 * Why `skipToken` is correct, stated once so it is not "fixed" later: `queryFn: skipToken` is the
 * library's own way of declaring a query with no transport. Home deliberately has none — inventing
 * a `queryFn` that called an application route would add the second data path the specification
 * rules out, would duplicate a read the server already performed, and would make the server pay a
 * round trip for data it can read in process. The query therefore never fetches, never retries and
 * never reports a loading or error state of its own; it is a typed handle on one cache entry whose
 * content arrives as `initial`, from the server, and changes only when the server states something
 * new.
 *
 * Why staleness is read from the cache and not from the observer. `skipToken` makes a query
 * permanently disabled (`enabled: false`), and a disabled observer reports `isStale === false`
 * however invalidated its entry is, so `query.isStale` here is a constant `false` and a refresh
 * driven by it would never happen. The cache entry's own `isInvalidated` flag is the honest signal
 * that a scope-prefixed invalidation has overtaken what Home holds, so that flag is what this hook
 * subscribes to — one cache, one flag, one refresh.
 *
 * Two effects, one job each. The first writes a freshly delivered server payload into the same key,
 * because `initialData` is consulted only while a key has no entry: after an invalidation and a
 * refresh the cache would otherwise keep answering with the envelope it already holds and (c) would
 * be inert. Writing the new payload also clears the invalidation that asked for the refresh, so the
 * invalidation → refresh → new payload cycle terminates instead of repeating. The second is (c)
 * itself, guarded by a ref so one staleness transition produces one refresh.
 *
 * What this file does not do, deliberately: it computes nothing (no count, total, percentage,
 * deadline or next occurrence — the envelope already carries every value and its `valueStates`), it
 * reads no clock, it imports no store and no other feature, it retries nothing (a denied or
 * unavailable read stays denied or unavailable instead of being retried into an invented success),
 * and it keeps no browser storage of its own and no second cache.
 *
 * Layering: a feature hook, so `app → features → components → modules/data-service`. It reaches the
 * shared component layer for {@link scopeKey} and the service root for types only; the service is
 * never imported at runtime here, because it touches the store and is server-only.
 */

import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { scopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, ReadResult, Scope } from "@/modules/data-service";

/**
 * Everything Home's read varies by.
 *
 * Home is a partition of what needs attention today, not a filtered list, so it has no filter, sort,
 * page or period state and this record is empty in practice. It exists so the shape every scoped key
 * uses — scope, job, then this job's parameters — is stable: a future parameter takes a place in the
 * key instead of changing the key contract, which is what keeps one cache entry per distinct Home
 * read.
 */
export type HomeParams = Readonly<Record<string, string | number | boolean>>;

/**
 * The parameters of a Home read with no narrowing applied — the only value Home passes today.
 *
 * Frozen and shared rather than rebuilt per render, so the key's last segment is one stable value
 * and the `params` argument can default to it without giving every render a new identity.
 */
export const EMPTY_HOME_PARAMS: HomeParams = Object.freeze({});

/**
 * The number of milliseconds a Home entry may stay in the cache unused.
 *
 * Five minutes: long enough that returning to Home from a partner or a gift does not re-read the
 * server, short enough that a closed tab's entry is collected rather than carried for the session.
 */
const HOME_GC_TIME_MS = 5 * 60_000;

/**
 * The staleness a server render reports: none.
 *
 * A cache belongs to one browser, so during the server render there is no entry that could be
 * invalidated. React requires this snapshot because a client component is also rendered on the
 * server, and answering `false` keeps the two renders identical for hydration.
 */
const NO_STALENESS_ON_SERVER = (): false => false;

/**
 * Home's cache key: the scope segments, the `home` job, and the parameters.
 *
 * The leading four segments come from `scopeKey` in `@/components/context-switch-guard` and are
 * never re-derived here — that module owns the only spelling of a scope key and the only
 * `queryClient.clear()` in the application, so a key composed anywhere else would survive the fence
 * that is supposed to drop it. The result is exactly
 * `["scope", organizationId, ministryId, supportSubjectId, "home", params]`.
 */
export function homeQueryKey(scope: Scope, params: HomeParams = EMPTY_HOME_PARAMS) {
  return [...scopeKey(scope), "home", params] as const;
}

/**
 * Reads Home through the cache the server already filled.
 *
 * `initial` is the envelope `readHome` produced during this server render, `scope` is the authority
 * it was read under, and `params` is Home's (empty) parameter record. `scope` must be the envelope's
 * own `scope` and never a scope assembled in the browser, so the key and the envelope it caches can
 * never describe two different authorities. The returned `result` is the same `ReadResult` the
 * server stated — an envelope, a denial or an unavailable source — with no reshaped success, so a
 * refusal cannot be rendered as an empty morning.
 */
export function useHome<TData>(input: {
  initial: ReadResult<ReadEnvelope<TData>>;
  scope: Scope;
  params?: HomeParams;
}): { result: ReadResult<ReadEnvelope<TData>> } {
  const { initial, scope, params = EMPTY_HOME_PARAMS } = input;

  // One key per scope and parameter set. Memoised so the query and the effects below share a stable
  // reference: an unrelated prop changing must not present the same read as a different cache entry.
  const key = useMemo(() => homeQueryKey(scope, params), [params, scope]);

  const query = useQuery({
    queryKey: key,
    queryFn: skipToken,
    initialData: initial,
    staleTime: Infinity,
    gcTime: HOME_GC_TIME_MS,
    refetchOnWindowFocus: false,
  });

  const queryClient = useQueryClient();
  const router = useRouter();
  const refreshRequested = useRef(false);

  // The cache entry is invalidated by the same scope-prefixed invalidation that reaches every other
  // surface, and the fence clears it outright. Subscribing to the cache is what lets this component
  // notice either without a second store and without re-reading anything.
  const subscribeToCache = useCallback(
    (onStoreChange: () => void) => queryClient.getQueryCache().subscribe(onStoreChange),
    [queryClient],
  );
  const readStaleness = useCallback(
    () => queryClient.getQueryState(key)?.isInvalidated === true,
    [key, queryClient],
  );
  const isStale = useSyncExternalStore(subscribeToCache, readStaleness, NO_STALENESS_ON_SERVER);

  // The server remains the only author of a Home envelope, including after a refresh. `initialData`
  // is applied only while the key has no entry, so a payload delivered after a refresh has to be
  // written where the query reads from; the write also clears the invalidation that asked for it.
  useEffect(() => {
    if (queryClient.getQueryData(key) !== initial) {
      queryClient.setQueryData(key, initial);
    }
  }, [initial, key, queryClient]);

  // One refresh per staleness transition: ask the Server Component to re-read, and let the effect
  // above land its answer. The ref is cleared as soon as the entry stops being invalidated, so a
  // later invalidation is a new transition and gets its own refresh rather than being suppressed.
  useEffect(() => {
    if (!isStale) {
      refreshRequested.current = false;
      return;
    }
    if (refreshRequested.current) {
      return;
    }
    refreshRequested.current = true;
    router.refresh();
  }, [isStale, router]);

  return { result: query.data ?? initial };
}
