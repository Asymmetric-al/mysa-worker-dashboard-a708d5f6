import { type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { fetchReadOrOutage, useReadQuery } from "@/lib/read-transport";
import type { ReadEnvelope, ReadResult, Scope, reads } from "@/modules/data-service";
import type { ReferralListQuery } from "../schemas";
export const REFERRALS_ENDPOINT = "/api/referrals";
const WIRE = { list: "list", search: "search", page: "page", pageSize: "pageSize" } as const;
const REFERRALS_SOURCE = { system: "local-store", reference: "outreach" } as const;
export type ReferralListReadResult = Awaited<ReturnType<typeof reads.referrals.readReferrals>>;
export type ReferralListEnvelope = Extract<ReferralListReadResult, { readonly kind: "envelope" }>["envelope"];
export type ReferralListPage = ReferralListEnvelope["data"];
/** The folder's only GET transport: the read result, or an `unavailable` outcome naming the source behind the lists — never an empty envelope and never an empty list. */
export const fetchReferralRead = async <TData>(path: string): Promise<ReadResult<ReadEnvelope<TData>>> =>
  fetchReadOrOutage<TData>({ url: path, admits: isRecord, source: REFERRALS_SOURCE, guidance: "The referral lists could not be read, because this request left the browser and no read result came back. Retry this view: nothing was changed, and a list that could not be read is not an empty list." });
function referralsListPath(query: ReferralListQuery): string {
  const params = new URLSearchParams();
  params.set(WIRE.list, query.list);
  if (query.search !== "") params.set(WIRE.search, query.search);
  params.set(WIRE.page, String(query.page));
  params.set(WIRE.pageSize, String(query.pageSize));
  return `${REFERRALS_ENDPOINT}?${params.toString()}`;
}
export type UseReferralsOptions = { readonly scope: Scope; readonly query: ReferralListQuery; readonly initialResult?: ReferralListReadResult };
/** Whether two list queries ask the read for the same answer: the list, the search and the page window, compared one by one. */
const sameQuery = (left: ReferralListQuery, right: ReferralListQuery): boolean => left.list === right.list && left.search === right.search && left.page === right.page && left.pageSize === right.pageSize;
/** Whether two scopes are the same authority: the four identifiers the read runs under, compared one by one. */
const sameScope = (left: Scope, right: Scope): boolean => left.organizationId === right.organizationId && left.ministryId === right.ministryId && left.supportSubjectId === right.supportSubjectId && left.principalId === right.principalId;
/** The list read a server render already answered, when it is the answer this surface is about to ask for: the surface must still ask the query the server answered, the list and window the payload echoes must be the ones being asked for, and the envelope must have run under this authority. No refusal is ever seeded, so a denial, an outage and a refused request keep their own arm. */
function seedOf(initialResult: ReferralListReadResult | undefined, asked: ReferralListQuery | null, query: ReferralListQuery, scope: Scope): ReferralListReadResult | undefined {
  if (initialResult === undefined || initialResult.kind !== "envelope" || asked === null) return undefined;
  const { envelope } = initialResult;
  const { list, page, pageSize } = envelope.data;
  return sameQuery(asked, query) && sameScope(envelope.scope, scope) && list === query.list && page === query.page && pageSize === query.pageSize ? initialResult : undefined;
}
/** Reads one page of one referral list under `scope`, keyed by the scope segments and the whole query, and answers the read union unchanged — `envelope | denied | unavailable`; an `initialResult` for this same query seeds the first paint, so the rows and the count the server read stand on the mount and no identical request repeats that read. */
export function useReferrals({ scope, query, initialResult }: UseReferralsOptions): UseQueryResult<ReferralListReadResult, Error> {
  // The query this list was first asked for, which is the one a seed answers: the address moves on as the worker switches list, searches and pages, and the payload echoes no search, so the window it states cannot tell two views of one page apart.
  const [asked] = useState<ReferralListQuery | null>(() => (initialResult === undefined ? null : query));
  const seed = seedOf(initialResult, asked, query, scope);
  return useReadQuery({ key: scopeKey(scope), job: "referrals", segment: [query], read: () => fetchReferralRead<ReferralListPage>(referralsListPath(query)), keepPrevious: true, initialAnswer: seed, refetchOnMount: seed === undefined });
}
