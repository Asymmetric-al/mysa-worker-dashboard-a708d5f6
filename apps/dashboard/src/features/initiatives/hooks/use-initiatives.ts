"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { RecordListQueryState } from "@/components/record-list";
import type { ReadEnvelope, ReadResult } from "@/modules/data-service";
import type { InitiativeState } from "@/modules/data-service/envelope";
import { INITIATIVE_API, readEnvelope } from "../api-client";
/** The two filters the list surface states and the read applies: the whole-dataset search over an initiative's name and purpose, and the initiative state. */ export type InitiativesFilters = { readonly search?: string; readonly state?: InitiativeState };
/** The envelope arm of a read: what a Server Component holds once `readInitiatives` answered with the list, and the seed this hook starts from. */ export type InitiativesEnvelope<D> = Extract<ReadResult<ReadEnvelope<D>>, { readonly kind: "envelope" }>;
/** The one shape a caller branches on: the list is still arriving, or the read answered with its envelope, a denial or an unavailable source — passed through as it stands. */
export type InitiativesQuery<D> = { readonly status: "loading"; readonly isFetching: true } | { readonly status: "ready"; readonly result: ReadResult<ReadEnvelope<D>>; readonly isFetching: boolean };
const filtersOf = (filters: InitiativesFilters): InitiativesFilters => ({ ...(filters.search === undefined || filters.search === "" ? {} : { search: filters.search }), ...(filters.state === undefined ? {} : { state: filters.state }) });
function paramsOf(queryState: RecordListQueryState, filters: InitiativesFilters): Readonly<Record<string, string | number | undefined>> {
  const [order] = queryState.sort;
  return { ...(order === undefined ? {} : { sort: order.id }), ...filters, page: queryState.page, pageSize: queryState.pageSize };
}
function requestOf(queryState: RecordListQueryState, filters: InitiativesFilters): string {
  const params = paramsOf(queryState, filters);
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${String(params[key] ?? "")}`)
    .join("&");
}
/** Drives `readInitiatives` (GET /api/initiatives) under the given filters; yields an envelope, `denied` or `unavailable`. */ export function useInitiatives<D>(queryState: RecordListQueryState, initialEnvelope: InitiativesEnvelope<D>, filters: InitiativesFilters = {}): InitiativesQuery<D> {
  const stated = filtersOf(filters);
  const request = requestOf(queryState, stated);
  const [mountedWith] = useState(request);
  const seed = request === mountedWith ? initialEnvelope : undefined;
  const read = useQuery<ReadResult<ReadEnvelope<D>>, Error>({
    queryKey: [...scopeKey(initialEnvelope.envelope.scope), "initiatives", stated, queryState],
    queryFn: async () => readEnvelope<ReadEnvelope<D>>(INITIATIVE_API.initiatives, paramsOf(queryState, stated)),
    ...(seed === undefined ? {} : { initialData: seed }),
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const result: ReadResult<ReadEnvelope<D>> | undefined = read.data;
  return result === undefined ? { status: "loading", isFetching: true } : { status: "ready", result, isFetching: read.isFetching };
}
