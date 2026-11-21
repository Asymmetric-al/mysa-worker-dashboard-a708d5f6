"use client";
/** The commitments list's own browser read: the controlled query state the list owns, the two pure URL helpers that keep that state across a commitment-detail visit, and the one TanStack Query hook … */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
import type { DeniedOutcome, InvalidOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";
// The read, and the two names its answer goes by
const COMMITMENTS_JOB = "commitments";

type CommitmentsRead = Awaited<ReturnType<typeof reads.support.readCommitments>>;
/** The one envelope this list reads: the page of commitments, its whole-result count, the page window and the two partitions the service states — the recurring outcome buckets and the. */
export type CommitmentsEnvelope = Extract<CommitmentsRead, { readonly kind: "envelope" }>["envelope"];
/** What a commitments read answers with: an envelope, a denial, or an unavailable source behind it. */
export type CommitmentsReadResult = CommitmentsRead;
// The list's controlled state
/** The page window this list states, in the read's own two members: a zero-based page index and a page size. */
export interface CommitmentsPage {
  readonly index: number;
  readonly size: number;
}
/** Everything the commitments list controls, and nothing more. */
export interface CommitmentsQuery {
  readonly showAdditionalTypes: boolean;
  readonly commitmentId?: string;
  readonly page: CommitmentsPage;
}
/** The page size a list states when the worker has not chosen one, and the largest one it may state. */
export const DEFAULT_COMMITMENTS_PAGE_SIZE = 50;
/** The largest page a list may state; the read clamps a larger one to this (AAP 0.8.7). */
export const MAX_COMMITMENTS_PAGE_SIZE = 200;
/** The list before anything is chosen: the first page at the default size, the offer unanswered. */
export const DEFAULT_COMMITMENTS_QUERY: CommitmentsQuery = { showAdditionalTypes: false, page: { index: 0, size: DEFAULT_COMMITMENTS_PAGE_SIZE } };
// The URL, which is where that state survives a detail visit
const PARAM_PAGE_INDEX = "page.index";
const PARAM_PAGE_SIZE = "page.size";
const PARAM_COMMITMENT_ID = "commitmentId";
const PARAM_SHOW_ADDITIONAL_TYPES = "showAdditionalTypes";

const FLAG_ON = "1";
const FLAG_OFF = "0";

const WHOLE_NUMBER = /^\d+$/u;

function normalisePage(page: CommitmentsPage): CommitmentsPage {
  const index = Number.isSafeInteger(page.index) && page.index >= 0 ? page.index : 0;
  const size = Number.isSafeInteger(page.size) && page.size >= 1 && page.size <= MAX_COMMITMENTS_PAGE_SIZE ? page.size : DEFAULT_COMMITMENTS_PAGE_SIZE;
  return { index, size };
}
function numberFrom(params: URLSearchParams, name: string): number {
  const raw = params.get(name);
  if (raw === null || !WHOLE_NUMBER.test(raw)) {
    return Number.NaN;
  }
  return Number.parseInt(raw, 10);
}
function idOrUndefined(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}
/** Encodes the list state as the request this hook makes: the page window, the offer as `1`/`0`, and the narrowed commitment when the detail route named one. */
export function toCommitmentsParams(query: CommitmentsQuery): URLSearchParams {
  const page = normalisePage(query.page);
  const params = new URLSearchParams();
  params.set(PARAM_PAGE_INDEX, String(page.index));
  params.set(PARAM_PAGE_SIZE, String(page.size));
  params.set(PARAM_SHOW_ADDITIONAL_TYPES, query.showAdditionalTypes ? FLAG_ON : FLAG_OFF);
  const commitmentId = idOrUndefined(query.commitmentId);
  if (commitmentId !== undefined) {
    params.set(PARAM_COMMITMENT_ID, commitmentId);
  }
  return params;
}
/** Reads the list state back from a URL, applying the same two page rules so a round trip through {@link toCommitmentsParams} returns an equal query. */
export function parseCommitmentsQuery(source: URLSearchParams | string): CommitmentsQuery {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  const page = normalisePage({ index: numberFrom(params, PARAM_PAGE_INDEX), size: numberFrom(params, PARAM_PAGE_SIZE) });
  const commitmentId = idOrUndefined(params.get(PARAM_COMMITMENT_ID));
  return { showAdditionalTypes: params.get(PARAM_SHOW_ADDITIONAL_TYPES) === FLAG_ON, page, ...(commitmentId === undefined ? {} : { commitmentId }) };
}
// Reading the wire answer back into the contract's three arms
const COMMITMENTS_ENDPOINT = "/api/support/commitments";

const ENVELOPE_STATUS = 200;
const DENIED_STATUS = 403;
/** A session that expired or could not be established answers 401 with the same denial, which is a session fault rather than a permission refusal. */
const SESSION_FAULT_STATUS = 401;
const UNAVAILABLE_STATUS = 503;
/** A query this list does not admit answers 422 with the field-keyed refusal, which is the request's own fault and not a source that did not answer. */
const REFUSED_STATUS = 422;

function noAnswer(path: string, status: number, detail: string): Error {
  return new Error(`${path} answered ${status} with ${detail}, so the commitment read has no answer to state.`);
}
async function readJsonBody(path: string, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw noAnswer(path, response.status, "a body that is not JSON");
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCommitmentsEnvelope(value: unknown): value is CommitmentsEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  const { data, scope, coverage, valueStates, actions, asOf, revision } = value;
  return isRecord(data) && Array.isArray(data.commitments) && typeof data.total === "number" && isRecord(data.page) && isRecord(scope) && isRecord(coverage) && isRecord(valueStates) && Array.isArray(actions) && typeof asOf === "string" && typeof revision === "string";
}
function isDeniedBody(value: unknown): value is DeniedOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return value.outcome === "denied" && typeof value.operationId === "string" && typeof value.reasonCode === "string";
}
function isUnavailableBody(value: unknown): value is UnavailableOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const source = value.source;
  return value.outcome === "unavailable" && typeof value.operationId === "string" && typeof value.guidance === "string" && isRecord(source) && typeof source.system === "string" && typeof source.reference === "string";
}
function isRefusedBody(value: unknown): value is InvalidOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return value.outcome === "invalid" && typeof value.operationId === "string" && isRecord(value.fields);
}
async function fetchCommitments(query: CommitmentsQuery): Promise<CommitmentsReadResult> {
  const queryString = toCommitmentsParams(query).toString();
  const path = queryString.length === 0 ? COMMITMENTS_ENDPOINT : `${COMMITMENTS_ENDPOINT}?${queryString}`;
  const response = await fetch(path, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin" });
  const body = await readJsonBody(path, response);
  switch (response.status) {
    case ENVELOPE_STATUS:
      if (!isCommitmentsEnvelope(body)) {
        throw noAnswer(path, response.status, "a body that is not a commitments envelope");
      }
      return { kind: "envelope", envelope: body };
    case DENIED_STATUS:
    case SESSION_FAULT_STATUS:
      if (!isDeniedBody(body)) {
        throw noAnswer(path, response.status, "a body that is not a denial");
      }
      return { kind: "denied", denied: body };
    case UNAVAILABLE_STATUS:
      if (!isUnavailableBody(body)) {
        throw noAnswer(path, response.status, "a body that is not an unavailable source");
      }
      return { kind: "unavailable", unavailable: body };
    case REFUSED_STATUS:
      if (!isRefusedBody(body)) {
        throw noAnswer(path, response.status, "a body that is not a refused request");
      }
      return { kind: "refused", refused: body };
    default:
      throw noAnswer(path, response.status, "a status this read does not answer with");
  }
}
// The hook
const COMMITMENTS_STALE_TIME_MS = 30_000;
/** The seed a server render may hand the cache: the envelope it already read, and the instant that envelope says it was evaluated at — never the moment this process happened to run. */
export interface CommitmentsSeed {
  readonly initialData: CommitmentsReadResult;
  readonly initialDataUpdatedAt: number;
}
/** What {@link useCommitments} is given: the context it reads in, the list state, and any seed. */
export interface UseCommitmentsInput {
  readonly scope: Scope;
  readonly query: CommitmentsQuery;
  readonly initialEnvelope?: CommitmentsEnvelope;
}
/** The query state a caller renders: loading, error, or one of the read's three arms in `data`. */
export type CommitmentsQueryState = UseQueryResult<CommitmentsReadResult, Error>;

function statedInstantOf(asOf: string): number {
  const parsed = Date.parse(asOf);
  return Number.isFinite(parsed) ? parsed : 0;
}
/** Reads the commitments in one scope: wraps `readCommitments` through `GET /api/support/commitments`, which answers with an envelope, a denial or an unavailable source. */
export function useCommitments({ scope, query, initialEnvelope }: UseCommitmentsInput): CommitmentsQueryState {
  const seeded: CommitmentsSeed | undefined = initialEnvelope === undefined ? undefined : { initialData: { kind: "envelope", envelope: initialEnvelope }, initialDataUpdatedAt: statedInstantOf(initialEnvelope.asOf) };
  return useQuery<CommitmentsReadResult, Error>({ queryKey: [...scopeKey(scope), COMMITMENTS_JOB, query], queryFn: () => fetchCommitments(query), staleTime: COMMITMENTS_STALE_TIME_MS, ...seeded });
}
