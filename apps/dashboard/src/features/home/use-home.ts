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
export const homeQueryKey = (scope: Scope, params: HomeParams = EMPTY_HOME_PARAMS) => [...scopeKey(scope), "home", params] as const;
export function useHome<TData>(input: { initial: ReadResult<ReadEnvelope<TData>>; scope: Scope; params?: HomeParams }): { result: ReadResult<ReadEnvelope<TData>> } {
  const { initial, scope, params = EMPTY_HOME_PARAMS } = input;
  const key = useMemo(() => homeQueryKey(scope, params), [params, scope]);
  const query = useQuery({ queryKey: key, queryFn: skipToken, initialData: initial, staleTime: Infinity, gcTime: HOME_GC_TIME_MS, refetchOnWindowFocus: false });
  const queryClient = useQueryClient();
  const router = useRouter();
  const refreshRequested = useRef(false);
  const subscribeToCache = useCallback((onStoreChange: () => void) => queryClient.getQueryCache().subscribe(onStoreChange), [queryClient]);
  const readStaleness = useCallback(() => queryClient.getQueryState(key)?.isInvalidated === true, [key, queryClient]);
  const isStale = useSyncExternalStore(subscribeToCache, readStaleness, NO_STALENESS_ON_SERVER);
  useEffect(() => {
    if (queryClient.getQueryData(key) !== initial) queryClient.setQueryData(key, initial);
  }, [initial, key, queryClient]);
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
