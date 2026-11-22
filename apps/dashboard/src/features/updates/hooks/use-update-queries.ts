"use client";
/** The Ministry Updates family's browser read plumbing: exactly eight hooks, one per named read, on the one scope-led query key the rest of the family reuses. **What it caches.** … */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKey, type QueryParams, type ScopedQueryKey } from "@/components/context-switch-guard";
import type { ReadEnvelope, Scope, reads } from "@/modules/data-service";
import { sameScope } from "@/modules/data-service/envelope";
import { isOutcome, isReadResult, unavailable, type ReadResult } from "@/modules/data-service/outcome";

// ---------------------------------------------------------------------------------------------
// The closed set of jobs, and the handler each one rides
// ---------------------------------------------------------------------------------------------

/** The eight reads this family exercises, listed once so the closed set has a runtime form as well as a type. */
export const UPDATES_READ_JOBS = ["roster", "variant-overview", "draft", "candidate", "release", "preview", "share-presentation", "send-result"] as const;

/** One named read of the Ministry Updates family. No ninth job belongs here: a surface that seems to need one is a component defect, not a hook to add. */
export type UpdatesReadJob = (typeof UPDATES_READ_JOBS)[number];

/** The handler that answers each job, keyed by the job's name. */
export const UPDATES_READ_ENDPOINTS = { roster: "/api/updates", "variant-overview": "/api/updates", draft: "/api/drafts", candidate: "/api/review", release: "/api/variants", preview: "/api/pages/preview", "share-presentation": "/api/variants", "send-result": "/api/notify" } as const satisfies Readonly<
  Record<UpdatesReadJob, string>
>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** How long an envelope read here stays fresh: long enough that moving between an edition and its preview issues no second request, short enough that a release or a withdrawal shows on the next visit. */
const UPDATES_STALE_TIME_MS = 30_000;

/** How long a notice's recipient ceiling stays fresh. Shorter than an envelope, because eligibility moves as people confirm, unsubscribe or sign up, and a review must not acknowledge a count the service has already moved past. */
const UPDATES_STALE_TIME_CEILING_MS = 10_000;

/** The status the one response mapper gives an envelope; the other answers carry their outcome's own status. */
const ENVELOPE_STATUS = 200;

/** The source system an outage built here names. It is the handler rather than the local store, because a request can fail before the service runs and naming the store would claim knowledge of where the fault was. An opaque reference only: it is displayed as text and never parsed. */
const HANDLER_SOURCE_SYSTEM = "data-service";

/** The marker a failed read carries where a mutation carries its operation id: a `GET` performs no effect, so it mints no identity and must not be mistaken for a change someone could replay. */
const READ_ATTEMPT = "read";

/** The query names the handlers read, stated once so a request carries the vocabulary each grammar declares and nothing beside it. */
const QUERY_PARAM = { documentId: "documentId", variantId: "variantId", revisionId: "revisionId", candidateId: "candidateId", requestedLocale: "requestedLocale", intentId: "intentId", page: "page", pageSize: "pageSize", view: "view" } as const;

/** The two views `/api/variants` selects between. */
const VARIANT_VIEW = { release: "release", share: "share" } as const;

/** The one view `/api/drafts` reads a working edition through; its other view is the frozen candidate, which this family reads from `/api/review`. */
const DRAFT_VIEW = "draft";

/** What a surface is told when a read produced no usable answer. */
const TRANSPORT_GUIDANCE: Readonly<Record<UpdatesReadJob, string>> = {
  roster: "The ministry's Updates could not be read, so this list states no count, no title and no edition. Retry the same read: an outage is never presented as a ministry that has written nothing.",
  "variant-overview": "The Update's editions could not be read, so this update has no variant matrix, no per-edition draft state and no release head to show. Retry the same read: an outage is never presented as an Update with no editions.",
  draft: "This edition's draft could not be read, so the editor has no revision, no autosave token and no media placement to restore. Retry the same read: an outage is never presented as an empty draft.",
  candidate: "The frozen candidate could not be read, so this review has no exact revision to approve or return. Retry the same read: a candidate is never inferred from the draft that now stands.",
  release: "The release standing at this edition's head could not be read, so the surface states nothing about what is published. Retry the same read: an outage is neither a withdrawal nor a released revision.",
  preview: "The preview could not be read, so this edition has no exact, authorised rendering to show. Retry the same read: a preview is authorised per request and never falls back to newer content or to another edition.",
  "share-presentation": "The notice's recipient ceiling and per-edition presentation could not be read, so no notice may be submitted from this screen. Retry the same read: the ceiling it returns is the number the review shows, and it is never estimated here.",
  "send-result": "The per-recipient results of this notice could not be read, so this screen states no acceptance, failure or unknown outcome for anyone. Retry the same read: an outage is not a send that failed and not one that succeeded.",
};

// ---------------------------------------------------------------------------------------------
// The payload each read answers with, taken from the read itself
// ---------------------------------------------------------------------------------------------

/** The payload one named read's envelope carries, taken from the read's own signature so a member the service adds, renames or withdraws reaches every consumer as a compile error rather than drifting into a second contract. A refusal member of the answer carries no envelope, so it contributes nothing. */
type PayloadOf<Answer> = Answer extends { readonly envelope: { readonly data: infer TPayload } } ? TPayload : never;

/** The variant matrix of one Update, with a draft, a candidate and a release pointer per edition. */
export type VariantOverviewData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readVariantOverview>>>;

/** One page of the ministry's Updates roster: every Update of the listed families with the editions that page carries, and the window it occupies in the whole authorised result. */
export type UpdatesRosterData = PayloadOf<Awaited<ReturnType<typeof reads.updates.findContentDocuments>>>;

/** One edition's working draft: the revision its editor autosaves against, its placements and its checks. */
export type UpdateDraftData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readDraft>>>;

/** One edition's frozen candidate: the exact revision one review step approves, returns or rejects. */
export type UpdateCandidateData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readCandidate>>>;

/** The release standing at one edition's head, including the head a sibling's failure preserved. */
export type UpdateReleaseData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readRelease>>>;

/** The exact, currently authorised, inert preview of one acknowledged revision. */
export type UpdatePreviewData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readPreview>>>;

/** One edition's notice presentation: the recipient ceiling and what each selected edition shows. */
export type SharePresentationData = PayloadOf<Awaited<ReturnType<typeof reads.updates.readSharePresentation>>>;

/** The per-recipient results of one notification intent, each recipient's pinned rendition included. */
export type SendResultData = PayloadOf<Awaited<ReturnType<typeof reads.audience.readSendResult>>>;

/** What the variant-overview read answers: its envelope, the denial it was given, or an unavailable source. */
export type VariantOverviewReadResult = ReadResult<ReadEnvelope<VariantOverviewData>>;

/** What the roster read answers: its envelope, the denial it was given, or an unavailable source. */
export type UpdatesRosterReadResult = ReadResult<ReadEnvelope<UpdatesRosterData>>;

/** What the draft read answers. */
export type UpdateDraftReadResult = ReadResult<ReadEnvelope<UpdateDraftData>>;

/** What the candidate read answers. */
export type UpdateCandidateReadResult = ReadResult<ReadEnvelope<UpdateCandidateData>>;

/** What the release read answers. */
export type UpdateReleaseReadResult = ReadResult<ReadEnvelope<UpdateReleaseData>>;

/** What the preview read answers. */
export type UpdatePreviewReadResult = ReadResult<ReadEnvelope<UpdatePreviewData>>;

/** What the share-presentation read answers. */
export type SharePresentationReadResult = ReadResult<ReadEnvelope<SharePresentationData>>;

/** What the send-result read answers. */
export type SendResultReadResult = ReadResult<ReadEnvelope<SendResultData>>;

/** The one shape every hook in this family answers with: the cached result, the query's own flags, the fence that says whether a result still describes the current context, and a way to ask again. */
export interface UpdatesQueryState<T> {
  /** The envelope, the denial or the outage — or `undefined` while nothing has been read yet, never an empty envelope standing in for one. */
  readonly result: ReadResult<ReadEnvelope<T>> | undefined;
  /** Whether no answer has arrived yet; a surface shows its own loading state from this and never renders it as empty. A query given no identifier is idle as well as pending — it has no result and never fetches — so a surface that has not been handed a record yet renders its own "nothing opened yet" state from that, rather than a spinner that would never end. */
  readonly isPending: boolean;
  /** Whether a request is in flight, including a refetch that is replacing an answer already on screen. */
  readonly isFetching: boolean;
  /** Whether a result was read under a context this component no longer shows, so the surface can drop it instead of presenting the previous context's authority as the current one. */
  readonly isStale: (result: ReadResult<ReadEnvelope<T>>) => boolean;
  /** Asks the same read again under this hook's own key, for the recovery action a refusal or an outage offers. */
  readonly refetch: () => void;
}

/** What a caller may seed a read with: the answer its Server Component already read, and when that answer was produced. */
export interface UpdatesQueryOptions<T> {
  /** The result a server render already produced. Given it, the hook does not refetch on mount and the browser issues no duplicate request for what it was handed. */
  readonly initialData?: ReadResult<ReadEnvelope<T>>;
  /** When that answer was produced, so the cache treats the seed as the age it is rather than as brand new. */
  readonly initialDataUpdatedAt?: number;
}

// ---------------------------------------------------------------------------------------------
// The one key builder this family composes a key with
// ---------------------------------------------------------------------------------------------

/** Keys one job of this family in one scope: the scope the read ran in, the job, then that job's parameters. */
export function updateQueryKey(scope: Scope, job: UpdatesReadJob, params: QueryParams = {}): ScopedQueryKey {
  return queryKey(scope, job, params);
}

// ---------------------------------------------------------------------------------------------
// The transport: one request path, one answer reading
// ---------------------------------------------------------------------------------------------

/** The parsed JSON body, or `undefined` when the answer carried none: an HTML error page is not a read result. */
async function jsonBodyOf(answer: Response): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return undefined;
  }
}

/** Whether a value is a JSON object this module can read a member from. */
function isObjectBody(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a body is a read envelope: the eight facts every envelope carries, checked for shape only, because the service owns every value inside them. */
function isEnvelopeOf<TPayload>(value: unknown): value is ReadEnvelope<TPayload> {
  if (!isObjectBody(value)) {
    return false;
  }
  return "data" in value && typeof value.revision === "string" && typeof value.asOf === "string" && isObjectBody(value.scope) && isObjectBody(value.source) && isObjectBody(value.coverage) && isObjectBody(value.valueStates) && Array.isArray(value.actions);
}

/** The one outage this module states for a read that produced no usable answer: no count, no empty collection and no record. */
function outage<TPayload>(job: UpdatesReadJob): ReadResult<ReadEnvelope<TPayload>> {
  return { kind: "unavailable", unavailable: unavailable({ operationId: READ_ATTEMPT, source: { system: HANDLER_SOURCE_SYSTEM, reference: UPDATES_READ_ENDPOINTS[job] }, guidance: TRANSPORT_GUIDANCE[job] }) };
}

/** The result a body already is when a handler passed the service's own `ReadResult` on unchanged; `undefined` when it is not one. */
function wrappedResultOf<TPayload>(body: unknown): ReadResult<ReadEnvelope<TPayload>> | undefined {
  if (!isReadResult(body)) {
    return undefined;
  }
  switch (body.kind) {
    case "envelope":
      return isEnvelopeOf<TPayload>(body.envelope) ? { kind: "envelope", envelope: body.envelope } : undefined;
    case "denied":
      return { kind: "denied", denied: body.denied };
    case "unavailable":
      return { kind: "unavailable", unavailable: body.unavailable };
    case "refused":
      return { kind: "refused", refused: body.refused };
  }
}

/** Reads one named read's answer as the three results it can be, never inventing a fourth. */
async function answerToResult<TPayload>(job: UpdatesReadJob, answer: Response): Promise<ReadResult<ReadEnvelope<TPayload>>> {
  const body = await jsonBodyOf(answer);
  const wrapped = wrappedResultOf<TPayload>(body);
  if (wrapped !== undefined) {
    return wrapped;
  }
  if (isOutcome(body)) {
    switch (body.outcome) {
      case "denied":
        // A denial is a legitimate answer, returned as the service sent it: it names a reason and nothing about a
        // record, so no surface here can turn it into a hint about what exists.
        return { kind: "denied", denied: body };
      case "unavailable":
        return { kind: "unavailable", unavailable: body };
      case "invalid":
        // The request this read was asked to serve is not one a handler admits, so the caller is handed
        // the field-keyed refusal to correct: the source behind the read answered, and calling it an
        // outage would say the opposite.
        return { kind: "refused", refused: body };
      default:
        // Every other outcome answers a mutation and states nothing about the records, so the surface is
        // told the read did not complete rather than shown a success it never had or a refusal the
        // service did not make.
        return outage<TPayload>(job);
    }
  }
  if (answer.status === ENVELOPE_STATUS && isEnvelopeOf<TPayload>(body)) {
    return { kind: "envelope", envelope: body };
  }
  return outage<TPayload>(job);
}

/** Issues one read and answers with what it stated. */
async function readThrough<TPayload>(job: UpdatesReadJob, path: string, signal: AbortSignal): Promise<ReadResult<ReadEnvelope<TPayload>>> {
  let answer: Response;
  try {
    answer = await fetch(path, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal });
  } catch {
    // A transport fault states nothing about the records — and neither does the abort a context switch issues,
    // whose answer TanStack discards because the query it belonged to was cancelled.
    return outage<TPayload>(job);
  }
  return answerToResult<TPayload>(job, answer);
}

// ---------------------------------------------------------------------------------------------
// The request path each read issues
// ---------------------------------------------------------------------------------------------

/** One endpoint with its stated parameters, percent-encoded, so an identifier or a language tag that carries a separator reaches the read as itself. */
function urlWith(endpoint: string, params: Readonly<Record<string, string>>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    query.set(name, value);
  }
  return `${endpoint}?${query.toString()}`;
}

/** The identifier a request can actually carry: the value the caller stated, trimmed, or the empty string that keeps a key stable and a query idle. */
function statedId(value: string | undefined): string {
  return value?.trim() ?? "";
}

function rosterPath(page: number | undefined, pageSize: number | undefined): string {
  return urlWith(UPDATES_READ_ENDPOINTS.roster, { ...(page === undefined ? {} : { [QUERY_PARAM.page]: String(page) }), ...(pageSize === undefined ? {} : { [QUERY_PARAM.pageSize]: String(pageSize) }) });
}

function variantOverviewPath(documentId: string): string {
  return urlWith(UPDATES_READ_ENDPOINTS["variant-overview"], { [QUERY_PARAM.documentId]: documentId });
}

function draftPath(variantId: string): string {
  return urlWith(UPDATES_READ_ENDPOINTS.draft, { [QUERY_PARAM.view]: DRAFT_VIEW, [QUERY_PARAM.variantId]: variantId });
}

function candidatePath(variantId: string): string {
  return urlWith(UPDATES_READ_ENDPOINTS.candidate, { [QUERY_PARAM.variantId]: variantId });
}

function releasePath(variantId: string): string {
  return urlWith(UPDATES_READ_ENDPOINTS.release, { [QUERY_PARAM.view]: VARIANT_VIEW.release, [QUERY_PARAM.variantId]: variantId });
}

function sharePresentationPath(variantId: string): string {
  return urlWith(UPDATES_READ_ENDPOINTS["share-presentation"], { [QUERY_PARAM.view]: VARIANT_VIEW.share, [QUERY_PARAM.variantId]: variantId });
}

/** A preview request the transport can carry: the edition, the acknowledged revision and the language asked for are all stated. */
interface RequestablePreview {
  readonly variantId: string;
  readonly revisionId: string;
  readonly candidateId?: string;
  readonly locale: string;
}

function previewPath(request: RequestablePreview): string {
  return urlWith(UPDATES_READ_ENDPOINTS.preview, { [QUERY_PARAM.variantId]: request.variantId, [QUERY_PARAM.revisionId]: request.revisionId, ...(request.candidateId === undefined ? {} : { [QUERY_PARAM.candidateId]: request.candidateId }), [QUERY_PARAM.requestedLocale]: request.locale });
}

function previewKeyParams(request: RequestablePreview): QueryParams {
  return { [QUERY_PARAM.variantId]: request.variantId, [QUERY_PARAM.revisionId]: request.revisionId, [QUERY_PARAM.requestedLocale]: request.locale, ...(request.candidateId === undefined ? {} : { [QUERY_PARAM.candidateId]: request.candidateId }) };
}

function sendResultPath(intentId: string, page: number | undefined, pageSize: number | undefined): string {
  return urlWith(UPDATES_READ_ENDPOINTS["send-result"], { [QUERY_PARAM.intentId]: intentId, ...(page === undefined ? {} : { [QUERY_PARAM.page]: String(page) }), ...(pageSize === undefined ? {} : { [QUERY_PARAM.pageSize]: String(pageSize) }) });
}

function sendResultKeyParams(intentId: string, page: number | undefined, pageSize: number | undefined): QueryParams {
  return { [QUERY_PARAM.intentId]: intentId, ...(page === undefined ? {} : { [QUERY_PARAM.page]: page }), ...(pageSize === undefined ? {} : { [QUERY_PARAM.pageSize]: pageSize }) };
}

// ---------------------------------------------------------------------------------------------
// What every hook in this family shares
// ---------------------------------------------------------------------------------------------

/** The seed options a Server Component's answer adds to a query. */
function seedOf<T>(options: UpdatesQueryOptions<T>): UpdatesQueryOptions<T> {
  if (options.initialData === undefined) {
    return {};
  }
  return options.initialDataUpdatedAt === undefined ? { initialData: options.initialData } : { initialData: options.initialData, initialDataUpdatedAt: options.initialDataUpdatedAt };
}

/** The one shape every hook answers with, built from the query it wraps and the scope it ran in. */
function queryStateOf<T>(query: UseQueryResult<ReadResult<ReadEnvelope<T>>, never>, scope: Scope): UpdatesQueryState<T> {
  return {
    result: query.data,
    isPending: query.isPending,
    isFetching: query.isFetching,
    // A refusal carries no scope, so it is never stale: it states nothing the previous context authorised, and
    // there is no context-bound record in it to drop. An envelope is compared with the scope this hook was given,
    // through the one equality the envelope module owns, so a persona switch counts as a change of context too.
    isStale: (result) => result.kind === "envelope" && !sameScope(result.envelope.scope, scope),
    refetch: () => {
      void query.refetch();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The eight reads
// ---------------------------------------------------------------------------------------------

/** What a surface supplies to read the ministry's Updates roster. */
export interface RosterParams {
  readonly scope: Scope;
  /** The page of listed rows this surface shows — one row per edition. Left unstated, the read answers the whole collection it holds, which is what a surface that pages nothing asks for. */
  readonly page?: number;
  /** The rows per page to request. The service keeps its own 50-row default and 200-row ceiling, so nothing is clamped here. */
  readonly pageSize?: number;
}

/** Drives `reads.updates.findContentDocuments` — every Update this ministry's content holds with the editions of each, one page of listed rows at a time, beside the whole-result total the service measured. Answers an envelope, a `denied` outcome or an `unavailable` one. */
export function useUpdatesRoster(params: RosterParams, options: UpdatesQueryOptions<UpdatesRosterData> = {}): UpdatesQueryState<UpdatesRosterData> {
  const { scope } = params;
  const query = useQuery<UpdatesRosterReadResult, never>({
    // The key names the window, so every page is its own entry and a page change asks the service for that page rather than re-windowing an answer already held.
    queryKey: updateQueryKey(scope, "roster", { ...(params.page === undefined ? {} : { [QUERY_PARAM.page]: params.page }), ...(params.pageSize === undefined ? {} : { [QUERY_PARAM.pageSize]: params.pageSize }) }),
    queryFn: ({ signal }) => readThrough<UpdatesRosterData>("roster", rosterPath(params.page, params.pageSize), signal),
    // A list is always readable under the scope this hook was handed, so nothing is disabled and nothing is retried: a refusal is an answer, and a second attempt could only ask again for what the read has already refused.
    retry: false,
    staleTime: UPDATES_STALE_TIME_MS,
    ...seedOf(options),
    refetchOnMount: options.initialData === undefined,
  });
  return queryStateOf(query, scope);
}

/** What a surface supplies to read one Update's variant matrix. */
export interface VariantOverviewParams {
  readonly scope: Scope;
  /** The Update whose editions are listed. Absent until a route resolves one, so the query stays idle rather than asking about a document nobody named. */
  readonly documentId?: string;
}

/** Drives `reads.updates.readVariantOverview` — one Update's editions, each with its own draft, candidate and release pointer. Answers an envelope, a `denied` outcome or an `unavailable` one. */
export function useVariantOverview(params: VariantOverviewParams, options: UpdatesQueryOptions<VariantOverviewData> = {}): UpdatesQueryState<VariantOverviewData> {
  const { scope } = params;
  const documentId = statedId(params.documentId);
  const query = useQuery<VariantOverviewReadResult, never>({
    queryKey: updateQueryKey(scope, "variant-overview", { [QUERY_PARAM.documentId]: documentId }),
    queryFn: ({ signal }) => readThrough<VariantOverviewData>("variant-overview", variantOverviewPath(documentId), signal),
    enabled: documentId !== "",
    // A refusal is an answer, so nothing is retried: a second attempt at a denial or a withdrawn edition could only
    // ask again for what the read has already refused.
    retry: false,
    staleTime: UPDATES_STALE_TIME_MS,
    ...seedOf(options),
    refetchOnMount: options.initialData === undefined,
  });
  return queryStateOf(query, scope);
}

/** What a surface supplies to read one edition's working draft. */
export interface DraftParams {
  readonly scope: Scope;
  /** The edition being edited. Two editions of one Update are two drafts, so the edition — never the document — is the identifier. */
  readonly variantId?: string;
}

/** Drives `reads.updates.readDraft` — one edition's working revision and the placements it holds. Answers an envelope, a `denied` outcome or an `unavailable` one. */
export function useDraft(params: DraftParams, options: UpdatesQueryOptions<UpdateDraftData> = {}): UpdatesQueryState<UpdateDraftData> {
  const { scope } = params;
  const variantId = statedId(params.variantId);
  const query = useQuery<UpdateDraftReadResult, never>({
    queryKey: updateQueryKey(scope, "draft", { [QUERY_PARAM.variantId]: variantId }),
    queryFn: ({ signal }) => readThrough<UpdateDraftData>("draft", draftPath(variantId), signal),
    enabled: variantId !== "",
    retry: false,
    staleTime: UPDATES_STALE_TIME_MS,
    ...seedOf(options),
    refetchOnMount: options.initialData === undefined,
  });
  return queryStateOf(query, scope);
}

/** What a surface supplies to read one edition's frozen candidate. */
export interface CandidateParams {
  readonly scope: Scope;
  /** The edition that holds the candidate: a candidate is read through the edition that froze it, so one identity serves both states. */
  readonly variantId?: string;
}

/** Drives `reads.updates.readCandidate` — the exact revision one review step approves, returns or rejects. Answers an envelope, a `denied` outcome or an `unavailable` one. */
export function useCandidate(params: CandidateParams, options: UpdatesQueryOptions<UpdateCandidateData> = {}): UpdatesQueryState<UpdateCandidateData> {
  const { scope } = params;
  const variantId = statedId(params.variantId);
  const query = useQuery<UpdateCandidateReadResult, never>({
    queryKey: updateQueryKey(scope, "candidate", { [QUERY_PARAM.variantId]: variantId }),
    queryFn: ({ signal }) => readThrough<UpdateCandidateData>("candidate", candidatePath(variantId), signal),
    enabled: variantId !== "",
    retry: false,
    staleTime: UPDATES_STALE_TIME_MS,
    ...seedOf(options),
    refetchOnMount: options.initialData === undefined,
  });
  return queryStateOf(query, scope);
}

/** What a surface supplies to read the release standing at one edition's head. */
export interface ReleaseParams {
  readonly scope: Scope;
  /** The edition whose current release head is read — one release per edition, independent of its siblings. */
  readonly variantId?: string;
}

/** Drives `reads.updates.readRelease` — the revision standing at one edition's head, including the prior-good head a sibling's failure preserved. Answers an envelope, a `denied` outcome or an `unavailable` one. */
export function useRelease(params: ReleaseParams, options: UpdatesQueryOptions<UpdateReleaseData> = {}): UpdatesQueryState<UpdateReleaseData> {
  const { scope } = params;
  const variantId = statedId(params.variantId);
  const query = useQuery<UpdateReleaseReadResult, never>({
    queryKey: updateQueryKey(scope, "release", { [QUERY_PARAM.variantId]: variantId }),
    queryFn: ({ signal }) => readThrough<UpdateReleaseData>("release", releasePath(variantId), signal),
    enabled: variantId !== "",
    retry: false,
    staleTime: UPDATES_STALE_TIME_MS,
    ...seedOf(options),
    refetchOnMount: options.initialData === undefined,
  });
  return queryStateOf(query, scope);
}

/** What a surface supplies to preview one acknowledged revision of one edition. */
export interface PreviewParams {
  readonly scope: Scope;
  /** The edition being previewed — the edition, not the language: two editions of one Update are two previews. */
  readonly variantId?: string;
  /** The revision the surface has on screen. Leaving it out states no acknowledgement, so no preview is requested rather than a newer revision being shown. */
  readonly revisionId?: string;
  /** The frozen candidate a reviewer previews, when the surface holds one: a reviewer's preview of a submitted candidate names both the revision and the candidate that froze it. */
  readonly candidateId?: string;
  /** The language the preview is read in, sent as the read's `requestedLocale`. A tag the edition does not serve is answered as a denial rather than as another edition's content. */
  readonly locale?: string;
}

/** The preview request stated as its four read parameters, with an unstated candidate omitted rather than sent empty. */
function statedPreview(variantId: string, revisionId: string, candidateId: string, locale: string): RequestablePreview {
  return { variantId, revisionId, locale, ...(candidateId === "" ? {} : { candidateId }) };
}

/** Drives `reads.updates.readPreview` — the exact, authorised, inert rendering of one acknowledged revision. Answers an envelope, a `denied` outcome or an `unavailable` one. */
export function usePreview(params: PreviewParams, options: UpdatesQueryOptions<UpdatePreviewData> = {}): UpdatesQueryState<UpdatePreviewData> {
  const { scope } = params;
  const variantId = statedId(params.variantId);
  const revisionId = statedId(params.revisionId);
  const locale = statedId(params.locale);
  const candidateId = statedId(params.candidateId);
  const stated = statedPreview(variantId, revisionId, candidateId, locale);
  const requestable = variantId !== "" && revisionId !== "" && locale !== "" ? stated : undefined;
  const query = useQuery<UpdatePreviewReadResult, never>({
    // The key names every variable the request reads, so two revisions, two languages and a reviewer's frozen
    // candidate beside the author's live revision stay four cache entries and none answers another.
    queryKey: updateQueryKey(scope, "preview", previewKeyParams(stated)),
    queryFn: ({ signal }) => (requestable === undefined ? Promise.resolve(outage<UpdatePreviewData>("preview")) : readThrough<UpdatePreviewData>("preview", previewPath(requestable), signal)),
    // Nothing is requested until the acknowledgement is complete: a preview that was not asked for is not a preview
    // of anything, and the transport's refusal of a half-stated request would otherwise be reported as an outage.
    enabled: requestable !== undefined,
    retry: false,
    staleTime: UPDATES_STALE_TIME_MS,
    ...seedOf(options),
    refetchOnMount: options.initialData === undefined,
  });
  return queryStateOf(query, scope);
}

/** What a surface supplies to read one edition's notice presentation. */
export interface SharePresentationParams {
  readonly scope: Scope;
  /** The edition a notice would be submitted for. The ceiling belongs to this edition's publication intent, so the edition — not the document — is the identifier. */
  readonly variantId?: string;
}

/** Drives `reads.updates.readSharePresentation` — the eligible-recipient ceiling and what this edition shows each audience. Answers an envelope, a `denied` outcome or an `unavailable` one. */
export function useSharePresentation(params: SharePresentationParams, options: UpdatesQueryOptions<SharePresentationData> = {}): UpdatesQueryState<SharePresentationData> {
  const { scope } = params;
  const variantId = statedId(params.variantId);
  const query = useQuery<SharePresentationReadResult, never>({
    queryKey: updateQueryKey(scope, "share-presentation", { [QUERY_PARAM.variantId]: variantId }),
    queryFn: ({ signal }) => readThrough<SharePresentationData>("share-presentation", sharePresentationPath(variantId), signal),
    enabled: variantId !== "",
    retry: false,
    staleTime: UPDATES_STALE_TIME_CEILING_MS,
    ...seedOf(options),
    refetchOnMount: options.initialData === undefined,
  });
  return queryStateOf(query, scope);
}

/** What a surface supplies to read the per-recipient results of one notification intent. */
export interface SendResultParams {
  readonly scope: Scope;
  /** The notification intent whose results are read. Absent before any notice was submitted, so the query stays idle rather than reporting whichever notice came last. */
  readonly intentId?: string;
  /** The page of results to read. The service applies its own window to an absent or out-of-bounds value, so a page stated here is a request and never a filter. */
  readonly page?: number;
  /** The page size to request. The service keeps its own cap, so nothing is clamped here. */
  readonly pageSize?: number;
}

/** Drives `reads.audience.readSendResult` — one row per recipient of one intent, each with the single rendition it was pinned to. Answers an envelope, a `denied` outcome or an `unavailable` one. */
export function useSendResult(params: SendResultParams, options: UpdatesQueryOptions<SendResultData> = {}): UpdatesQueryState<SendResultData> {
  const { scope } = params;
  const intentId = statedId(params.intentId);
  const query = useQuery<SendResultReadResult, never>({
    queryKey: updateQueryKey(scope, "send-result", sendResultKeyParams(intentId, params.page, params.pageSize)),
    queryFn: ({ signal }) => readThrough<SendResultData>("send-result", sendResultPath(intentId, params.page, params.pageSize), signal),
    enabled: intentId !== "",
    retry: false,
    staleTime: UPDATES_STALE_TIME_MS,
    ...seedOf(options),
    refetchOnMount: options.initialData === undefined,
  });
  return queryStateOf(query, scope);
}
