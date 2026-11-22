"use client";
/** The initiative detail's browser read: the one cache entry for `readInitiative`, seeded by the envelope the Server Component already read and refetched only once that entry is invalidated. */
import { useQuery } from "@tanstack/react-query";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, ReadResult } from "@/modules/data-service";
import { INITIATIVE_API, readEnvelope } from "../api-client";
const INITIATIVE_JOB = "initiative";
type InitiativeQueryKey = readonly [...ScopeKey, typeof INITIATIVE_JOB, string, string];
export type InitiativeEnvelope<D> = Extract<ReadResult<ReadEnvelope<D>>, { readonly kind: "envelope" }>["envelope"];
export type InitiativeQuery<D> = { readonly status: "loading"; readonly isFetching: true } | { readonly status: "ready"; readonly result: ReadResult<ReadEnvelope<D>>; readonly isFetching: boolean };
/** The page windows a surface states for the lists one initiative's detail carries, in the read's own parameter names. Each list is windowed on its own, so paging one of them never moves another. */
export interface InitiativeReadWindow {
  readonly requestsPage?: number;
  readonly requestsPageSize?: number;
  readonly nextWorkPage?: number;
  readonly nextWorkPageSize?: number;
}
// The window's members in one place, so the segment a page is keyed under and the parameters it is asked for are stated once: a request can never be keyed under one window and sent with another.
const WINDOW_PARAMS = ["requestsPage", "requestsPageSize", "nextWorkPage", "nextWorkPageSize"] as const satisfies readonly (keyof InitiativeReadWindow)[];
interface StatedWindow {
  /** One comparable segment of the query key: empty when the surface states no window, which is the read's own first page of every list. */
  readonly segment: string;
  /** The parameters the request carries, with an unstated half left unstated rather than defaulted here. */
  readonly params: Readonly<Record<string, number>>;
}
function windowOf(statedWindow: InitiativeReadWindow | undefined): StatedWindow {
  const params: Record<string, number> = {};
  for (const name of WINDOW_PARAMS) {
    const value = statedWindow?.[name];
    if (value !== undefined) {
      params[name] = value;
    }
  }
  return {
    segment: Object.entries(params)
      .map(([name, value]) => `${name}=${String(value)}`)
      .join("&"),
    params,
  };
}
/**
 * Reads one initiative through `GET /api/initiatives?initiativeId=…`, which answers with `readInitiative`'s envelope or
 * with that read's own `denied` / `unavailable` refusal. A stated window is part of the key, so every page of every list
 * is its own entry and a page change asks the service for that page rather than re-windowing an answer already held.
 *
 * `seededWindow` is the window the Server Component's envelope was actually read under. That envelope may seed only the
 * entry keyed by that same window: seeding it under another page's key would answer a page the reader asked for with the
 * page the server had already sent, and `refetchOnMount: false` would then keep presenting it without a request. Every
 * other window is fetched.
 */
export function useInitiative<D>(initiativeId: string, initialEnvelope: InitiativeEnvelope<D>, listWindow?: InitiativeReadWindow, seededWindow?: InitiativeReadWindow): InitiativeQuery<D> {
  const scope = initialEnvelope.scope;
  const stated = windowOf(listWindow);
  const seeded = windowOf(seededWindow).segment === stated.segment;
  const queryKey: InitiativeQueryKey = [...scopeKey(scope), INITIATIVE_JOB, initiativeId, stated.segment];
  const query = useQuery<ReadResult<ReadEnvelope<D>>, Error, ReadResult<ReadEnvelope<D>>, InitiativeQueryKey>({
    queryKey,
    queryFn: () => readEnvelope<ReadEnvelope<D>>(INITIATIVE_API.initiatives, { initiativeId, ...stated.params }),
    ...(seeded ? { initialData: { kind: "envelope", envelope: initialEnvelope } as ReadResult<ReadEnvelope<D>> } : {}),
    // v5 subjects `initialData` to `staleTime`, so these three settings are what keep the first paint
    // free of a request; an invalidation still refetches an active query, which is what recovers this
    // view after a sibling mutation. The read is never retried: its own envelope states a refusal.
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const result: ReadResult<ReadEnvelope<D>> | undefined = query.data;
  if (result === undefined) {
    return { status: "loading", isFetching: true };
  }
  return { status: "ready", result, isFetching: query.isFetching };
}
