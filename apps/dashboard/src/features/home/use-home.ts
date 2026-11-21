"use client";
/**
 * Home's one client hook: the scope-first cache key, the seeded envelope, and the refresh that keeps
 * Home from ever showing another context's work.
 */
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, ReadResult, Scope } from "@/modules/data-service";
/** Everything Home's read varies by. */
export type HomeParams = Readonly<Record<string, string | number | boolean>>;
/** The parameters of a Home read with no narrowing applied — the only value Home passes today. */
export const EMPTY_HOME_PARAMS: HomeParams = Object.freeze({});

const HOME_GC_TIME_MS = 5 * 60_000;

const NO_STALENESS_ON_SERVER = (): false => false;
/** Home's cache key: the scope segments, the `home` job, and the parameters. */
export function homeQueryKey(scope: Scope, params: HomeParams = EMPTY_HOME_PARAMS) {
  return [...scopeKey(scope), "home", params] as const;
}
/** Reads Home through the cache the server already filled. */
export function useHome<TData>(input: { initial: ReadResult<ReadEnvelope<TData>>; scope: Scope; params?: HomeParams }): { result: ReadResult<ReadEnvelope<TData>> } {
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
  const subscribeToCache = useCallback((onStoreChange: () => void) => queryClient.getQueryCache().subscribe(onStoreChange), [queryClient]);
  const readStaleness = useCallback(() => queryClient.getQueryState(key)?.isInvalidated === true, [key, queryClient]);
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
