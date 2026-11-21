"use client";

/** This session's development runtime, as one TanStack Query read. */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { scopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { DevState } from "@/modules/data-service/reads/dev";
import type { ReadResult } from "@/modules/data-service";

import { readDevState } from "../api-client";

export const DEV_STATE_JOB = "dev";

export type DevStateReadResult = ReadResult<ReadEnvelope<DevState>>;

/** The read's own query key, exposed so a settled control can invalidate exactly this entry. */
export function devStateQueryKey(scope: Scope) {
  return [...scopeKey(scope), DEV_STATE_JOB] as const;
}

/** Reads the development runtime for the session acting in `scope`. */
export function useDevState(scope: Scope, enabled: boolean): UseQueryResult<DevStateReadResult, Error> {
  return useQuery<DevStateReadResult, Error>({ queryKey: devStateQueryKey(scope), queryFn: readDevState, enabled, staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
}
