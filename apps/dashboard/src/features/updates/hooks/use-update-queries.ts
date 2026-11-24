"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKey, type QueryParams, type ScopedQueryKey } from "@/components/context-switch-guard";
import { fetchReadOrOutage, handlerSource } from "@/lib/read-transport";
import type { ReadEnvelope, Scope, reads } from "@/modules/data-service";
import { sameScope } from "@/modules/data-service/envelope";
import { unavailable, type ReadResult } from "@/modules/data-service/outcome";
export const UPDATES_READ_JOBS = ["roster", "variant-overview", "draft", "candidate", "release", "share-presentation", "send-result"] as const;
export type UpdatesReadJob = (typeof UPDATES_READ_JOBS)[number];
export const UPDATES_READ_ENDPOINTS = { roster: "/api/updates", "variant-overview": "/api/updates", draft: "/api/drafts", candidate: "/api/review", release: "/api/variants", "share-presentation": "/api/variants", "send-result": "/api/notify" } as const satisfies Readonly<Record<UpdatesReadJob, string>>;
const READ_VIEW: Partial<Record<UpdatesReadJob, string>> = { draft: "draft", release: "release", "share-presentation": "share" };
const QUERY_PARAM = { documentId: "documentId", variantId: "variantId", revisionId: "revisionId", candidateId: "candidateId", requestedLocale: "requestedLocale", intentId: "intentId", page: "page", pageSize: "pageSize" } as const;
const TRANSPORT_GUIDANCE: Readonly<Record<UpdatesReadJob, string>> = {
  roster: "The ministry's Updates could not be read, so this list states no count, no title and no edition. Retry the same read: an outage is never presented as a ministry that has written nothing.",
  "variant-overview": "The Update's editions could not be read, so this update has no variant matrix, no per-edition draft state and no release head to show. Retry the same read: an outage is never presented as an Update with no editions.",
  draft: "This edition's draft could not be read, so the editor has no revision, no autosave token and no media placement to restore. Retry the same read: an outage is never presented as an empty draft.",
  candidate: "The frozen candidate could not be read, so this review has no exact revision to approve or return. Retry the same read: a candidate is never inferred from the draft that now stands.",
  release: "The release standing at this edition's head could not be read, so the surface states nothing about what is published. Retry the same read: an outage is neither a withdrawal nor a released revision.",
  "share-presentation": "The notice's recipient ceiling and per-edition presentation could not be read, so no notice may be submitted from this screen. Retry the same read: the ceiling it returns is the number the review shows, and it is never estimated here.",
  "send-result": "The per-recipient results of this notice could not be read, so this screen states no acceptance, failure or unknown outcome for anyone. Retry the same read: an outage is not a send that failed and not one that succeeded.",
};
type PayloadOf<Answer> = Answer extends { readonly envelope: { readonly data: infer TPayload } } ? TPayload : never;
/** One page of the ministry's Updates roster: every Update of the listed families with the editions that page carries, and the window it occupies in the whole authorised result. */ export type UpdatesRosterData = PayloadOf<Awaited<ReturnType<typeof reads.updates.findContentDocuments>>>;
/** The variant matrix of one Update, with a draft, a candidate and a release pointer per edition. */ export type VariantOverviewData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readVariantOverview>>>;
export type UpdateDraftData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readDraft>>>;
export type UpdateCandidateData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readCandidate>>>;
export type UpdateReleaseData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readRelease>>>;
export type SharePresentationData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readSharePresentation>>>;
export type SendResultData = PayloadOf<Awaited<ReturnType<typeof reads.audience.readSendResult>>>;
export type UpdatesRosterReadResult = ReadResult<ReadEnvelope<UpdatesRosterData>>;
export type VariantOverviewReadResult = ReadResult<ReadEnvelope<VariantOverviewData>>;
export type UpdateDraftReadResult = ReadResult<ReadEnvelope<UpdateDraftData>>;
export type UpdateReleaseReadResult = ReadResult<ReadEnvelope<UpdateReleaseData>>;
export type SendResultReadResult = ReadResult<ReadEnvelope<SendResultData>>;
/** One Updates read as a surface holds it. `refetch` asks for a fresh answer without waiting for it; `readNow` asks for one and answers with it, so an action that judges something on this read's envelope awaits the answer instead of reading whatever the surface happened to have received by then. */
export type UpdatesQueryState<T> = {
  readonly result: ReadResult<ReadEnvelope<T>> | undefined;
  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly isStale: (result: ReadResult<ReadEnvelope<T>>) => boolean;
  readonly refetch: () => void;
  readonly readNow: () => Promise<ReadResult<ReadEnvelope<T>> | undefined>;
};
export type UpdatesQueryOptions<T> = { readonly initialData?: ReadResult<ReadEnvelope<T>>; readonly initialDataUpdatedAt?: number };
export const updateQueryKey = (scope: Scope, job: UpdatesReadJob, params: QueryParams = {}): ScopedQueryKey => queryKey(scope, job, params);
const isObjectBody = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const outage = <TPayload>(job: UpdatesReadJob): ReadResult<ReadEnvelope<TPayload>> => ({ kind: "unavailable", unavailable: unavailable({ operationId: "read", source: handlerSource(UPDATES_READ_ENDPOINTS[job]), guidance: TRANSPORT_GUIDANCE[job] }) });
const readThrough = <TPayload>(job: UpdatesReadJob, url: string): Promise<ReadResult<ReadEnvelope<TPayload>>> => fetchReadOrOutage<TPayload>({ url, admits: isObjectBody, source: handlerSource(UPDATES_READ_ENDPOINTS[job]), guidance: TRANSPORT_GUIDANCE[job] });
function urlWith(endpoint: string, params: Readonly<Record<string, JsonParam>>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) query.set(name, String(value));
  return `${endpoint}?${query.toString()}`;
}
type JsonParam = string | number;
function statedParams(params: Readonly<Record<string, JsonParam | undefined>>): Record<string, JsonParam> {
  const stated: Record<string, JsonParam> = {};
  for (const [name, value] of Object.entries(params)) if (value !== undefined) stated[name] = value;
  return stated;
}
function urlOf(job: UpdatesReadJob, params: Readonly<Record<string, JsonParam>>): string {
  const view = READ_VIEW[job];
  return urlWith(UPDATES_READ_ENDPOINTS[job], view === undefined ? params : { view, ...params });
}
const statedId = (value: string | undefined): string => value?.trim() ?? "";
function seedOf<T>(options: UpdatesQueryOptions<T>): UpdatesQueryOptions<T> {
  if (options.initialData === undefined) return {};
  return options.initialDataUpdatedAt === undefined ? { initialData: options.initialData } : { initialData: options.initialData, initialDataUpdatedAt: options.initialDataUpdatedAt };
}
function queryStateOf<T>(query: UseQueryResult<ReadResult<ReadEnvelope<T>>, never>, scope: Scope): UpdatesQueryState<T> {
  return {
    result: query.data,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isStale: (result) => result.kind === "envelope" && !sameScope(result.envelope.scope, scope),
    refetch: () => {
      void query.refetch();
    },
    readNow: async () => {
      const answered = await query.refetch();
      return answered.data ?? query.data;
    },
  };
}
function useUpdatesRead<T>(options: UpdatesQueryOptions<T>, scope: Scope, job: UpdatesReadJob, asked: Readonly<Record<string, JsonParam | undefined>>, staleTime: number = 30_000): UpdatesQueryState<T> {
  const params = statedParams(asked);
  const enabled = Object.values(params).every((value) => value !== "");
  const url = urlOf(job, params);
  const query = useQuery<ReadResult<ReadEnvelope<T>>, never>({ queryKey: updateQueryKey(scope, job, params), queryFn: () => (enabled ? readThrough<T>(job, url) : Promise.resolve(outage<T>(job))), enabled, retry: false, staleTime, ...seedOf(options), refetchOnMount: options.initialData === undefined });
  return queryStateOf(query, scope);
}
/** A page of listed rows, one row per edition; both numbers are left unstated by a surface that pages nothing, which asks for the whole collection the read holds. The service keeps its own 50-row default and 200-row ceiling, so nothing is clamped here. */
export type RosterParams = { readonly scope: Scope; readonly page?: number; readonly pageSize?: number };
/** Drives `reads.updates.findContentDocuments` — every Update this ministry's content holds with the editions of each, one page at a time beside the whole-result total the service measured. */
export const useUpdatesRoster = (params: RosterParams, options: UpdatesQueryOptions<UpdatesRosterData> = {}): UpdatesQueryState<UpdatesRosterData> => useUpdatesRead(options, params.scope, "roster", { [QUERY_PARAM.page]: params.page, [QUERY_PARAM.pageSize]: params.pageSize });
export type VariantOverviewParams = { readonly scope: Scope; readonly documentId?: string };
/** Drives `reads.updates.readVariantOverview` — one Update's editions, each with its own draft, candidate and release pointer. */
export const useVariantOverview = (params: VariantOverviewParams, options: UpdatesQueryOptions<VariantOverviewData> = {}): UpdatesQueryState<VariantOverviewData> => useUpdatesRead(options, params.scope, "variant-overview", { [QUERY_PARAM.documentId]: statedId(params.documentId) });
export type DraftParams = { readonly scope: Scope; readonly variantId?: string };
export const useDraft = (params: DraftParams, options: UpdatesQueryOptions<UpdateDraftData> = {}): UpdatesQueryState<UpdateDraftData> => useUpdatesRead(options, params.scope, "draft", { [QUERY_PARAM.variantId]: statedId(params.variantId) });
export type CandidateParams = { readonly scope: Scope; readonly variantId?: string };
export const useCandidate = (params: CandidateParams, options: UpdatesQueryOptions<UpdateCandidateData> = {}): UpdatesQueryState<UpdateCandidateData> => useUpdatesRead(options, params.scope, "candidate", { [QUERY_PARAM.variantId]: statedId(params.variantId) });
export type ReleaseParams = { readonly scope: Scope; readonly variantId?: string };
export const useRelease = (params: ReleaseParams, options: UpdatesQueryOptions<UpdateReleaseData> = {}): UpdatesQueryState<UpdateReleaseData> => useUpdatesRead(options, params.scope, "release", { [QUERY_PARAM.variantId]: statedId(params.variantId) });
export type SharePresentationParams = { readonly scope: Scope; readonly variantId?: string };
export const useSharePresentation = (params: SharePresentationParams, options: UpdatesQueryOptions<SharePresentationData> = {}): UpdatesQueryState<SharePresentationData> => useUpdatesRead(options, params.scope, "share-presentation", { [QUERY_PARAM.variantId]: statedId(params.variantId) }, 10_000);
export type SendResultParams = { readonly scope: Scope; readonly intentId?: string; readonly page?: number; readonly pageSize?: number };
export const useSendResult = (params: SendResultParams, options: UpdatesQueryOptions<SendResultData> = {}): UpdatesQueryState<SendResultData> =>
  useUpdatesRead(options, params.scope, "send-result", { [QUERY_PARAM.intentId]: statedId(params.intentId), [QUERY_PARAM.page]: params.page, [QUERY_PARAM.pageSize]: params.pageSize });
