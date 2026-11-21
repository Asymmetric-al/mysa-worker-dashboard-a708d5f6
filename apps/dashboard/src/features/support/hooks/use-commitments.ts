"use client";

/**
 * The commitments list's own browser read: the controlled query state the list owns, the two pure URL
 * helpers that keep that state across a commitment-detail visit, and the one TanStack Query hook that
 * wraps the service's `readCommitments`.
 *
 * Plan items that put this file in scope: AAP 0.6.3 (`GET /api/support/commitments` →
 * `reads.readCommitments`), 0.7.1 (the job group "Understand support"), 0.9.1 and 0.11.1
 * (`features/support/**` with the two commitment routes), 0.10.1 family 7, and criterion 6 — a
 * commitment is never received money, and the five recurring outcome buckets plus `outside-partition`
 * are never merged, re-ordered or relabelled on the way to a screen.
 *
 * One read, and no second one. The closed service inventory has `readCommitments` and no
 * `readCommitment`, so the detail route is this same read narrowed by `commitmentId` rather than a
 * bespoke read of its own. This file therefore holds no record, no count and no bucket: every figure
 * it serves arrives in the envelope, which is the only thing permitted to decide what a commitment's
 * bucket is (`modules/support/buckets`'s `bucketFor`) and what a monthly equivalent is (the source's
 * own qualified figure). Nothing here sums, averages, divides a cadence or derives a total, because a
 * derived figure would be a second financial statement beside the one the service made.
 *
 * What the query state carries, and what the read consumes. `page.index` and `page.size` are the
 * window `readCommitments` accepts, and they are the only two members it reads. `commitmentId`
 * narrows the list to the detail route's row, and `showAdditionalTypes` is the list's offer to show
 * additional source-supplied commitment types — an offer the envelope alone admits and one this file
 * never applies. Both travel in the URL so that a detail visit and Back, and a reload, restore the
 * list exactly as it stood; they are the list's own state, and the read neither filters nor narrows on
 * them.
 *
 * Imports are type-only wherever the target reaches the server. `modules/data-service` re-exports the
 * outcome module, which imports `next/server` for its response mapping, so a value import from either
 * would pull server code into the browser bundle: the read's own signature is reached through
 * `typeof reads.support.readCommitments`, and the two failure arms are decoded here from the wire.
 *
 * Failure handling. A transport error, a status this read does not answer with, or a body that is not
 * one of the three arms produces a plain `Error` naming `/api/support/commitments`, which the caller
 * renders as an unavailable state. No read result is ever assembled by hand, no source identity is
 * invented, and an absent answer is never presented as "no commitments": a denial stays a denial and
 * an outage stays an outage, so a surface can say which source is down instead of showing a zero.
 *
 * No clock and no money. Nothing here reads the host clock (AAP 0.7.2, assumption A12): the only
 * instant this file touches is the one the envelope states, `asOf`. No amount is compared, rounded or
 * formatted.
 *
 * Rule 1: clause 1 is why the hook wraps this one read and adds no capability — no retry, no pause, no
 * correction and no other financial action, none of which exists in this release; clause 2 is why
 * TanStack Query is the only remote-result state, `scopeKey` the only key builder and the query object
 * the single owner of list state, with no wrapper and no second cache; clause 3 is why the buckets and
 * kinds pass through untouched and a commitment is never presented as received money.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { scopeKey } from "@/components/context-switch-guard";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
import type { DeniedOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";

// ---------------------------------------------------------------------------------------------
// The read, and the two names its answer goes by
// ---------------------------------------------------------------------------------------------

/** The job segment of this list's cache entry, after the scope segments every read starts with. */
const COMMITMENTS_JOB = "commitments";

/**
 * The commitments read exactly as the data service declares it.
 *
 * Derived rather than restated: a parameter the read gains, a figure it adds to its data or an arm its
 * result gains reaches this file by compilation instead of leaving a hand-written copy to drift.
 */
type CommitmentsRead = Awaited<ReturnType<typeof reads.support.readCommitments>>;

/**
 * The one envelope this list reads: the page of commitments, its whole-result count, the page window
 * and the two partitions the service states — the recurring outcome buckets and the commitment kinds.
 */
export type CommitmentsEnvelope = Extract<
  CommitmentsRead,
  { readonly kind: "envelope" }
>["envelope"];

/** What a commitments read answers with: an envelope, a denial, or an unavailable source behind it. */
export type CommitmentsReadResult = CommitmentsRead;

// ---------------------------------------------------------------------------------------------
// The list's controlled state
// ---------------------------------------------------------------------------------------------

/**
 * The page window this list states, in the read's own two members: a zero-based page index and a page
 * size. Both are held here rather than inferred from what arrived, so the window a reader chose
 * survives a detail visit and a reload as the same two numbers.
 */
export interface CommitmentsPage {
  readonly index: number;
  readonly size: number;
}

/**
 * Everything the commitments list controls, and nothing more.
 *
 * `showAdditionalTypes` is carried, never applied: whether a source supplies commitment types beyond
 * the three this projection states is the envelope's answer (`commitmentKinds`, and the `actions` it
 * publishes), so the screen decides whether to offer the control at all and this state only records
 * what the worker chose. `commitmentId` is the detail route's narrowing. Neither is a service filter,
 * and adding one here — a bucket selector, a period, a "paused only" switch — would state a filter the
 * read does not accept.
 */
export interface CommitmentsQuery {
  /** Whether the worker asked to see additional source-supplied commitment types. */
  readonly showAdditionalTypes: boolean;
  /** The commitment the detail route is showing, carried so returning to the list restores it. */
  readonly commitmentId?: string;
  /** The page window, in the read's own `page.index`/`page.size` members. */
  readonly page: CommitmentsPage;
}

/**
 * The page size a list states when the worker has not chosen one, and the largest one it may state.
 *
 * Mirrored from the report engine rather than imported: `modules/support/report` holds the one
 * calculation behind every financial surface and must never reach the browser, so the two documented
 * values of AAP 0.8.7 — 50 rows by default, 200 at most — are repeated here with their provenance. The
 * read applies them itself, so a query that states nothing else still pages at 50 and is refused
 * nothing.
 */
export const DEFAULT_COMMITMENTS_PAGE_SIZE = 50;

/** The largest page a list may state; the read clamps a larger one to this (AAP 0.8.7). */
export const MAX_COMMITMENTS_PAGE_SIZE = 200;

/** The list before anything is chosen: the first page at the default size, the offer unanswered. */
export const DEFAULT_COMMITMENTS_QUERY: CommitmentsQuery = {
  showAdditionalTypes: false,
  page: { index: 0, size: DEFAULT_COMMITMENTS_PAGE_SIZE },
};

// ---------------------------------------------------------------------------------------------
// The URL, which is where that state survives a detail visit
// ---------------------------------------------------------------------------------------------

/**
 * The parameter names, which mirror the read's own member paths (`SupportPageInput.page.index` and
 * `.size`) so a handler maps them onto its argument without a translation table of its own. The
 * identifier and the offer are named as the query names them.
 */
const PARAM_PAGE_INDEX = "page.index";
const PARAM_PAGE_SIZE = "page.size";
const PARAM_COMMITMENT_ID = "commitmentId";
const PARAM_SHOW_ADDITIONAL_TYPES = "showAdditionalTypes";

/** The two values the offer is written as, so "on" and "off" have one spelling each. */
const FLAG_ON = "1";
const FLAG_OFF = "0";

/** A whole count as a URL may carry it: digits only, with no sign, separator or fraction. */
const WHOLE_NUMBER = /^\d+$/u;

/**
 * The one normalisation of a page window, applied in both directions.
 *
 * A page index that is not a whole number at or after zero is the first page, and a size that is not a
 * whole number between one and the cap is the documented default. Encoding applies it so the URL only
 * ever states a window the read would actually apply, and decoding applies it so a hand-edited or
 * truncated value falls back to a real page instead of a guess that throws.
 */
function normalisePage(page: CommitmentsPage): CommitmentsPage {
  const index = Number.isSafeInteger(page.index) && page.index >= 0 ? page.index : 0;
  const size =
    Number.isSafeInteger(page.size) && page.size >= 1 && page.size <= MAX_COMMITMENTS_PAGE_SIZE
      ? page.size
      : DEFAULT_COMMITMENTS_PAGE_SIZE;
  return { index, size };
}

/**
 * A whole number a URL stated, or `NaN` when it stated none or stated something that is not one.
 *
 * `NaN` is the signal {@link normalisePage} reads as "not a page value", which is why nothing here
 * substitutes a default itself: one place decides, and a malformed value never becomes a filter.
 */
function numberFrom(params: URLSearchParams, name: string): number {
  const raw = params.get(name);
  if (raw === null || !WHOLE_NUMBER.test(raw)) {
    return Number.NaN;
  }
  return Number.parseInt(raw, 10);
}

/**
 * A commitment's identity, or `undefined` when none was stated.
 *
 * The reference is opaque, so it is neither trimmed, parsed nor re-cased: a leading zero that survives
 * encoding survives decoding untouched, and only an empty value counts as absent.
 */
function idOrUndefined(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

/**
 * Encodes the list state as the request this hook makes: the page window, the offer as `1`/`0`, and the
 * narrowed commitment when the detail route named one. Pure, so a caller may build a link from it.
 */
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

/**
 * Reads the list state back from a URL, applying the same two page rules so a round trip through
 * {@link toCommitmentsParams} returns an equal query. Anything a URL states that the list does not
 * know — an unreadable index or size, a blank identifier — is omitted rather than guessed at.
 */
export function parseCommitmentsQuery(source: URLSearchParams | string): CommitmentsQuery {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  const page = normalisePage({
    index: numberFrom(params, PARAM_PAGE_INDEX),
    size: numberFrom(params, PARAM_PAGE_SIZE),
  });
  const commitmentId = idOrUndefined(params.get(PARAM_COMMITMENT_ID));
  return {
    showAdditionalTypes: params.get(PARAM_SHOW_ADDITIONAL_TYPES) === FLAG_ON,
    page,
    ...(commitmentId === undefined ? {} : { commitmentId }),
  };
}

// ---------------------------------------------------------------------------------------------
// Reading the wire answer back into the contract's three arms
// ---------------------------------------------------------------------------------------------

/**
 * The one endpoint this hook reads, stated once so every failure names the request that failed and no
 * second path can appear beside it. Relative and same-origin, so the development session cookie — the
 * only admission this application has — travels with it.
 */
const COMMITMENTS_ENDPOINT = "/api/support/commitments";

/** The three statuses a commitments read answers with: the envelope, a denial and an outage. */
const ENVELOPE_STATUS = 200;
const DENIED_STATUS = 403;
const UNAVAILABLE_STATUS = 503;

/**
 * The one error this file raises: an answer no contract describes, named by the request and the status
 * that produced it. It is a plain `Error` on purpose — the caller renders an unavailable state from it,
 * and nothing in the read contract can be inferred from a response that does not match the contract.
 */
function noAnswer(path: string, status: number, detail: string): Error {
  return new Error(
    `${path} answered ${status} with ${detail}, so the commitment read has no answer to state.`,
  );
}

/**
 * The body of a response, or the error above when it is not JSON.
 *
 * A page that answers with an HTML error document has no contract answer at all, so this never
 * substitutes an empty object for a body it could not read.
 */
async function readJsonBody(path: string, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw noAnswer(path, response.status, "a body that is not JSON");
  }
}

/** Whether a decoded value is a JSON object rather than an array, `null` or a scalar. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a decoded body is the envelope `readCommitments` states: the eight members the read envelope
 * carries, with the data this list reads present and of the shape it reads it in.
 *
 * The check stops at what a surface would otherwise trip over — the page of commitments, the
 * whole-result count, the page window, the scope, the coverage, the value states, the actions, the
 * instant and the revision — because a body that lacks one of them is a truncated or foreign answer,
 * not a read that found nothing. It is deliberately not a second schema for the data the service owns:
 * the figures inside are the service's.
 */
function isCommitmentsEnvelope(value: unknown): value is CommitmentsEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  const { data, scope, coverage, valueStates, actions, asOf, revision } = value;
  return (
    isRecord(data) &&
    Array.isArray(data.commitments) &&
    typeof data.total === "number" &&
    isRecord(data.page) &&
    isRecord(scope) &&
    isRecord(coverage) &&
    isRecord(valueStates) &&
    Array.isArray(actions) &&
    typeof asOf === "string" &&
    typeof revision === "string"
  );
}

/**
 * Whether a decoded body is the denial a 403 carries. The reason code describes the caller's
 * relationship to the request, never a record, so nothing here can be read as an existence flag.
 */
function isDeniedBody(value: unknown): value is DeniedOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.outcome === "denied" &&
    typeof value.operationId === "string" &&
    typeof value.reasonCode === "string"
  );
}

/**
 * Whether a decoded body is the outage a 503 carries: the source identity and the guidance, both of
 * which a surface states instead of showing an empty list or a zero.
 */
function isUnavailableBody(value: unknown): value is UnavailableOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const source = value.source;
  return (
    value.outcome === "unavailable" &&
    typeof value.operationId === "string" &&
    typeof value.guidance === "string" &&
    isRecord(source) &&
    typeof source.system === "string" &&
    typeof source.reference === "string"
  );
}

/**
 * One requests-and-reads pass: asks the endpoint for the stated window and returns whichever of the
 * three arms the answer carries, or throws when the answer is none of them.
 */
async function fetchCommitments(query: CommitmentsQuery): Promise<CommitmentsReadResult> {
  const queryString = toCommitmentsParams(query).toString();
  const path =
    queryString.length === 0 ? COMMITMENTS_ENDPOINT : `${COMMITMENTS_ENDPOINT}?${queryString}`;
  const response = await fetch(path, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  const body = await readJsonBody(path, response);

  switch (response.status) {
    case ENVELOPE_STATUS:
      if (!isCommitmentsEnvelope(body)) {
        throw noAnswer(path, response.status, "a body that is not a commitments envelope");
      }
      return { kind: "envelope", envelope: body };
    case DENIED_STATUS:
      if (!isDeniedBody(body)) {
        throw noAnswer(path, response.status, "a body that is not a denial");
      }
      return { kind: "denied", denied: body };
    case UNAVAILABLE_STATUS:
      if (!isUnavailableBody(body)) {
        throw noAnswer(path, response.status, "a body that is not an unavailable source");
      }
      return { kind: "unavailable", unavailable: body };
    default:
      throw noAnswer(path, response.status, "a status this read does not answer with");
  }
}

// ---------------------------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------------------------

/**
 * How long a commitments envelope is treated as current.
 *
 * A commitment is the source's standing at an instant rather than a stream of events, so half a minute
 * is long enough that a detail visit and Back do not refetch the same page into a flicker, and short
 * enough that a return to the list after real work reads the source again. It is a stated constant
 * rather than a clock reading: nothing here decides freshness from the host's time.
 */
const COMMITMENTS_STALE_TIME_MS = 30_000;

/**
 * The seed a server render may hand the cache: the envelope it already read, and the instant that
 * envelope says it was evaluated at — never the moment this process happened to run.
 */
export interface CommitmentsSeed {
  readonly initialData: CommitmentsReadResult;
  readonly initialDataUpdatedAt: number;
}

/** What {@link useCommitments} is given: the context it reads in, the list state, and any seed. */
export interface UseCommitmentsInput {
  /** The authority the read runs under; the cache key starts from it, so a switch cannot mix them. */
  readonly scope: Scope;
  /** The list state: the page window, the narrowed commitment and the offer. */
  readonly query: CommitmentsQuery;
  /** An envelope a server render already read in this scope, so the first paint is not empty. */
  readonly initialEnvelope?: CommitmentsEnvelope;
}

/** The query state a caller renders: loading, error, or one of the read's three arms in `data`. */
export type CommitmentsQueryState = UseQueryResult<CommitmentsReadResult, Error>;

/**
 * The instant an envelope states, as the cache's read time.
 *
 * `Date.parse` reads the instant the envelope carries rather than the host clock (AAP 0.7.2, A12), so a
 * seeded scenario's time is what the cache compares. An instant that cannot be read is treated as the
 * epoch, which makes the seed immediately stale and refetches: a freshness claim this file cannot
 * corroborate is never made on the worker's behalf.
 */
function statedInstantOf(asOf: string): number {
  const parsed = Date.parse(asOf);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reads the commitments in one scope: wraps `readCommitments` through `GET /api/support/commitments`,
 * which answers with an envelope, a denial or an unavailable source.
 *
 * The query key is the scope segments followed by the job and the whole query object, so every value
 * the request varies by is keyed and a context switch cannot answer from the previous scope's cache.
 * The result is returned as it stands: callers narrow `data` with `isReadResult` and render the denial
 * or the outage as the distinct facts they are — never as an empty list, a zero or a default page.
 */
export function useCommitments({
  scope,
  query,
  initialEnvelope,
}: UseCommitmentsInput): CommitmentsQueryState {
  const seeded: CommitmentsSeed | undefined =
    initialEnvelope === undefined
      ? undefined
      : {
          initialData: { kind: "envelope", envelope: initialEnvelope },
          initialDataUpdatedAt: statedInstantOf(initialEnvelope.asOf),
        };

  return useQuery<CommitmentsReadResult, Error>({
    queryKey: [...scopeKey(scope), COMMITMENTS_JOB, query],
    queryFn: () => fetchCommitments(query),
    staleTime: COMMITMENTS_STALE_TIME_MS,
    ...seeded,
  });
}
