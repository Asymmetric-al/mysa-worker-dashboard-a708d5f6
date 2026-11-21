"use client";

/**
 * This session's development runtime, as one TanStack Query read.
 *
 * AAP 0.7.2 makes the development panel's honesty depend on reading the state the service actually
 * holds — the scenario, the clock offset with the instant it derives, the one armed failure, the seeded
 * personas and whether a reset is available — rather than a copy of what was clicked. So the state is a
 * remote result like any other: it is fetched from the namespaced handler, cached under a key that
 * leads with the scope (AAP 0.15.1), and invalidated after a control changes it.
 *
 * The key is scope-led because the answer is: two sessions can sit in different scenarios at once, and
 * a context switch has to clear this entry with the rest of the cache (AAP 0.7.2, and the fence in
 * `components/context-switch-guard`). `staleTime: 0` is deliberate: the revision this read reports is
 * the `expectedRevision` the panel's next control must present, so a stale copy would produce a
 * conflict that is this hook's fault rather than the person's. Explicit refetching only — no interval,
 * no polling, because nothing in this release observes the runtime in the background (assumption A12).
 *
 * `enabled` is the caller's environment gate: in a build without the development runtime the query is
 * never sent, so a production page makes no request to a handler that would refuse it.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { scopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { DevState } from "@/modules/data-service/reads/dev";
import type { ReadResult } from "@/modules/data-service";

import { readDevState } from "../api-client";

/**
 * The job segment of this read's key.
 *
 * It names the read the way the service names it, so a second development read could never collide with
 * this one, and the fence's scope prefix stays the only place authority enters a key.
 */
export const DEV_STATE_JOB = "dev";

/** What this read answers: the development envelope, a denial, or an outage. */
export type DevStateReadResult = ReadResult<ReadEnvelope<DevState>>;

/** The read's own query key, exposed so a settled control can invalidate exactly this entry. */
export function devStateQueryKey(scope: Scope) {
  return [...scopeKey(scope), DEV_STATE_JOB] as const;
}

/**
 * Reads the development runtime for the session acting in `scope`.
 *
 * `enabled` false leaves the query idle and unsent, which is how a production build renders no
 * development control and also asks the server for nothing.
 */
export function useDevState(
  scope: Scope,
  enabled: boolean,
): UseQueryResult<DevStateReadResult, Error> {
  return useQuery<DevStateReadResult, Error>({
    queryKey: devStateQueryKey(scope),
    queryFn: readDevState,
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
