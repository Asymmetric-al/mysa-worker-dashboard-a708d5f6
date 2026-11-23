"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { fetchRead } from "@/lib/read-transport";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
type CommitmentsRead = Awaited<ReturnType<typeof reads.support.readCommitments>>;
export type CommitmentsEnvelope = Extract<CommitmentsRead, { readonly kind: "envelope" }>["envelope"];
export type CommitmentsReadResult = CommitmentsRead;
export type CommitmentsPage = { readonly index: number; readonly size: number };
export type CommitmentsQuery = { readonly commitmentId?: string; readonly page: CommitmentsPage };
export const DEFAULT_COMMITMENTS_PAGE_SIZE = 50;
export const MAX_COMMITMENTS_PAGE_SIZE = 200;
const PARAM = { pageIndex: "page.index", pageSize: "page.size", commitmentId: "commitmentId" } as const;
const WHOLE_NUMBER = /^\d+$/u;
function normalisePage(page: CommitmentsPage): CommitmentsPage {
  const index = Number.isSafeInteger(page.index) && page.index >= 0 ? page.index : 0;
  const size = Number.isSafeInteger(page.size) && page.size >= 1 && page.size <= MAX_COMMITMENTS_PAGE_SIZE ? page.size : DEFAULT_COMMITMENTS_PAGE_SIZE;
  return { index, size };
}
function numberFrom(params: URLSearchParams, name: string): number {
  const raw = params.get(name);
  return raw === null || !WHOLE_NUMBER.test(raw) ? Number.NaN : Number.parseInt(raw, 10);
}
const idOrUndefined = (value: string | null | undefined): string | undefined => (value === undefined || value === null || value.length === 0 ? undefined : value);
/** Encodes the list state as the request this hook makes: the page window and the narrowed commitment when the detail route named one. */ export function toCommitmentsParams(query: CommitmentsQuery): URLSearchParams {
  const page = normalisePage(query.page);
  const params = new URLSearchParams();
  params.set(PARAM.pageIndex, String(page.index));
  params.set(PARAM.pageSize, String(page.size));
  const commitmentId = idOrUndefined(query.commitmentId);
  if (commitmentId !== undefined) params.set(PARAM.commitmentId, commitmentId);
  return params;
}
/** Reads the list state back from a URL, applying the same page rules so a round trip through {@link toCommitmentsParams} returns an equal query. */ export function parseCommitmentsQuery(source: URLSearchParams | string): CommitmentsQuery {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  const page = normalisePage({ index: numberFrom(params, PARAM.pageIndex), size: numberFrom(params, PARAM.pageSize) });
  const commitmentId = idOrUndefined(params.get(PARAM.commitmentId));
  return { page, ...(commitmentId === undefined ? {} : { commitmentId }) };
}
const COMMITMENTS_ENDPOINT = "/api/support/commitments";
const COMMITMENTS_STALE_TIME_MS = 30_000;
const isCommitmentsData = (value: unknown): boolean => isRecord(value) && Array.isArray(value.commitments) && typeof value.total === "number" && isRecord(value.page);
export type CommitmentsSeed = { readonly initialData: CommitmentsReadResult; readonly initialDataUpdatedAt: number };
export type UseCommitmentsInput = { readonly scope: Scope; readonly query: CommitmentsQuery; readonly initialEnvelope?: CommitmentsEnvelope };
export type CommitmentsQueryState = UseQueryResult<CommitmentsReadResult, Error>;
const statedInstantOf = (asOf: string): number => {
  const parsed = Date.parse(asOf);
  return Number.isFinite(parsed) ? parsed : 0;
}; /** Reads the commitments in one scope: wraps `readCommitments` through `GET /api/support/commitments`, which answers with an envelope, a denial or an unavailable source. */
export function useCommitments({ scope, query, initialEnvelope }: UseCommitmentsInput): CommitmentsQueryState {
  const seeded: CommitmentsSeed | undefined = initialEnvelope === undefined ? undefined : { initialData: { kind: "envelope", envelope: initialEnvelope }, initialDataUpdatedAt: statedInstantOf(initialEnvelope.asOf) };
  const queryString = toCommitmentsParams(query).toString();
  return useQuery<CommitmentsReadResult, Error>({
    queryKey: [...scopeKey(scope), "commitments", query],
    queryFn: () => fetchRead<CommitmentsEnvelope["data"], CommitmentsEnvelope["coverage"]>({ url: queryString.length === 0 ? COMMITMENTS_ENDPOINT : `${COMMITMENTS_ENDPOINT}?${queryString}`, admits: isCommitmentsData }),
    staleTime: COMMITMENTS_STALE_TIME_MS,
    ...seeded,
  });
}
