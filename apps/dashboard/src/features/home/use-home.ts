"use client";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, ReadResult, Scope } from "@/modules/data-service";
export type HomeParams = Readonly<Record<string, string | number | boolean>>;
export const EMPTY_HOME_PARAMS: HomeParams = Object.freeze({});
const HOME_GC_TIME_MS = 5 * 60_000;
const NO_STALENESS_ON_SERVER = (): false => false;
export function homeQueryKey(scope: Scope, params: HomeParams = EMPTY_HOME_PARAMS) {
  return [...scopeKey(scope), "home", params] as const;
}
export function useHome<TData>(input: { initial: ReadResult<ReadEnvelope<TData>>; scope: Scope; params?: HomeParams }): { result: ReadResult<ReadEnvelope<TData>> } {
  const { initial, scope, params = EMPTY_HOME_PARAMS } = input;
  // One memoised key per scope and parameter set, so an unrelated prop change is not a new cache entry.
  const key = useMemo(() => homeQueryKey(scope, params), [params, scope]);
  const query = useQuery({ queryKey: key, queryFn: skipToken, initialData: initial, staleTime: Infinity, gcTime: HOME_GC_TIME_MS, refetchOnWindowFocus: false });
  const queryClient = useQueryClient();
  const router = useRouter();
  const refreshRequested = useRef(false);
  // The scope-prefixed invalidation and the fence both reach this entry; subscribing is what notices it.
  const subscribeToCache = useCallback((onStoreChange: () => void) => queryClient.getQueryCache().subscribe(onStoreChange), [queryClient]);
  const readStaleness = useCallback(() => queryClient.getQueryState(key)?.isInvalidated === true, [key, queryClient]);
  const isStale = useSyncExternalStore(subscribeToCache, readStaleness, NO_STALENESS_ON_SERVER);
  // The server is the only author: initial data applies only while the key is empty, and the write ends the invalidation.
  useEffect(() => {
    if (queryClient.getQueryData(key) !== initial) queryClient.setQueryData(key, initial);
  }, [initial, key, queryClient]);
  // One refresh per staleness transition; the ref clears when the entry stops being invalidated.
  useEffect(() => {
    if (!isStale) {
      refreshRequested.current = false;
      return;
    }
    if (refreshRequested.current) return;
    refreshRequested.current = true;
    router.refresh();
  }, [isStale, router]);
  return { result: query.data ?? initial };
}
