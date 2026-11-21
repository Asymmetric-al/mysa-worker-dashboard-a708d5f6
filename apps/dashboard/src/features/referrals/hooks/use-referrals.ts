/** The Referrals family's list read, and the one GET transport this folder's reads share. */
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isNonEmptyString, isRecord } from "@/lib/guards";
// The two guards read a body back off the wire and are needed as values, so they come from
// `outcome.ts` rather than from the service barrel: a value import of the barrel reaches every named
// read, every named mutation and the synthetic store behind them, which drags `node:fs` into the
// browser bundle the list surface is built into. The payload types stay on the barrel, type-only.
import { isOutcome, isReadResult } from "@/modules/data-service/outcome";
import type { ReadEnvelope, ReadResult, Scope, reads } from "@/modules/data-service";
import type { ReferralListQuery } from "../schemas";
// The address, and the grammar it parses
/** The one address this folder's reads are served from, kept in one constant so a path correction is a single edit. */
export const REFERRALS_ENDPOINT = "/api/referrals";

const REFERRALS_JOB = "referrals";
/** The four parameter names `GET /api/referrals` parses, taken from the route handler's own grammar. */
const WIRE = { list: "list", search: "search", page: "page", pageSize: "pageSize" } as const;
// The identity an answer carries when no read result came back
/** The attempt identity a read answers under. */
const READ_ATTEMPT_ID = "read";
/** The source behind the referral lists: the local synthetic store's outreach records, as the read that serves them states it. */
const REFERRALS_SOURCE = { system: "local-store", reference: "outreach" } as const;

const UNAVAILABLE_GUIDANCE = "The referral lists could not be read, because this request left the browser and no read result came back. Retry this view: nothing was changed, and a list that could not be read is not an empty list.";
// What the service read answers, derived from its own signature
/** What `readReferrals` answers: the scoped envelope, a denial, or an unavailable source. */
export type ReferralListReadResult = Awaited<ReturnType<typeof reads.referrals.readReferrals>>;
/** The envelope a list view renders once it has narrowed the result to `envelope`. */
export type ReferralListEnvelope = Extract<ReferralListReadResult, { readonly kind: "envelope" }>["envelope"];
/** One page of one referral list — the whole-result total beside the rows of the current page. */
export type ReferralListPage = ReferralListEnvelope["data"];
// The outage
/** The one answer this folder gives when no read result came back: an outage naming the source and the remedy, never an empty envelope, never an empty list and never a zero. */
function unavailableRead<TData>(): ReadResult<ReadEnvelope<TData>> {
  return { kind: "unavailable", unavailable: { outcome: "unavailable", operationId: READ_ATTEMPT_ID, source: REFERRALS_SOURCE, guidance: UNAVAILABLE_GUIDANCE } };
}
// The statuses the one response builder flattens a read result onto
/** The statuses `toResponse` gives the four read results. */
const ENVELOPE_STATUS = 200;

/** The two statuses a denial answers with: 403 for a refused authority, and 401 for a session that expired or could not be established. */
const DENIED_STATUSES: ReadonlySet<number> = new Set([401, 403]);

const UNAVAILABLE_STATUS = 503;

/** A query this list does not admit answers 422 with the field-keyed refusal, which is the request's own fault and not a source that did not answer. */
const REFUSED_STATUS = 422;
// The wire's own shapes
/** Reports whether a parsed value is a read envelope: the frame every read promises — its payload, the scope it ran in, its source, revision, as-of instant, coverage, value states and actions. */
function isReadEnvelope(value: unknown): value is ReadEnvelope<unknown> {
  if (!isRecord(value)) {
    return false;
  }
  return "data" in value && isRecord(value["scope"]) && isRecord(value["source"]) && isNonEmptyString(value["revision"]) && isNonEmptyString(value["asOf"]) && isRecord(value["coverage"]) && isRecord(value["valueStates"]) && Array.isArray(value["actions"]);
}
// The folder's transport
/** Turns whatever came back into this folder's own answer: a `kind`-wrapped read result exactly as it arrived, the flat form the handler actually writes onto the status, and an outage for everything … */
function asReferralRead<TData>(body: unknown, status: number): ReadResult<ReadEnvelope<TData>> {
  if (isReadResult(body)) {
    switch (body.kind) {
      case "denied":
        // A denial is handed on as itself. It is never widened into an empty list, because a caller
        // without authority must not learn anything about what it may not see.
        return { kind: "denied", denied: body.denied };
      case "unavailable":
        return { kind: "unavailable", unavailable: body.unavailable };
      case "refused":
        return { kind: "refused", refused: body.refused };
      case "envelope":
        // `isReadResult` checks the four arms and the outcome each refusal carries, but not the payload
        // inside an envelope. This assertion is the one place the folder states that payload type, and
        // the envelope it asserts came from this service read, whose payload type it names.
        return { kind: "envelope", envelope: body.envelope as ReadEnvelope<TData> };
    }
  }
  if (status === ENVELOPE_STATUS && isReadEnvelope(body)) {
    // The flat form: the whole body is the envelope this read answers with, and its payload is the
    // reading hook's own type.
    return { kind: "envelope", envelope: body as ReadEnvelope<TData> };
  }
  if (DENIED_STATUSES.has(status) && isOutcome(body) && body.outcome === "denied") {
    // Only a denial the service itself built is read as one; a body this folder cannot place is an
    // outage, so a refusal never becomes a claim about the records.
    return { kind: "denied", denied: body };
  }
  if (status === UNAVAILABLE_STATUS && isOutcome(body) && body.outcome === "unavailable") {
    return { kind: "unavailable", unavailable: body };
  }
  if (status === REFUSED_STATUS && isOutcome(body) && body.outcome === "invalid") {
    // The list query this request stated is one the read does not admit: the field-keyed refusal is the
    // answer, because the source behind the list answered and only the request was wrong. Reading it as
    // an outage would tell the worker the referral records failed to arrive.
    return { kind: "refused", refused: body };
  }
  return unavailableRead<TData>();
}
/** The folder's only GET transport: returns the read result, or an `unavailable` outcome, and never an empty envelope. */
export async function fetchReferralRead<TData>(path: string): Promise<ReadResult<ReadEnvelope<TData>>> {
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(path, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    // A body that is not JSON throws here and is caught below: the read's source did not answer, which
    // is an outage rather than a refusal. The status travels with the body because the handler states
    // which read result it answered with there.
    body = await response.json();
  } catch {
    return unavailableRead<TData>();
  }
  return asReferralRead<TData>(body, response.status);
}
// The list address for one query
/** The list address for one query: the four parameters the route parses, and nothing it would silently ignore. */
function referralsListPath(query: ReferralListQuery): string {
  const params = new URLSearchParams();
  params.set(WIRE.list, query.list);
  if (query.search !== "") {
    params.set(WIRE.search, query.search);
  }
  // The page and its size travel as stated: the schema owns the default and the ceiling, and the read
  // owns the whole-result total, so neither is computed here.
  params.set(WIRE.page, String(query.page));
  params.set(WIRE.pageSize, String(query.pageSize));
  // The read owns the ordering: every list it answers is presented newest endpoint first, and it takes
  // no ordering parameter at all, so none travels here.
  return `${REFERRALS_ENDPOINT}?${params.toString()}`;
}
// The read
/** What a caller supplies to read one referral list. */
export interface UseReferralsOptions {
  readonly scope: Scope;
  readonly query: ReferralListQuery;
}
/** Reads one page of one referral list under `scope`, keyed by the scope segments and the whole query, and answers the read union unchanged — `envelope | denied | unavailable`. */
export function useReferrals({ scope, query }: UseReferralsOptions): UseQueryResult<ReferralListReadResult, Error> {
  return useQuery<ReferralListReadResult, Error>({
    // The scope leads every key, so the context switch's fence clears this entry with the rest of the
    // previous context and no envelope can be served from another context's cache. The query state is
    // in the key verbatim, so two lists, two searches or two pages are two entries.
    queryKey: [...scopeKey(scope), REFERRALS_JOB, query],
    queryFn: () => fetchReferralRead<ReferralListPage>(referralsListPath(query)),
    // The previous page stays visible while the next one lands, so a pending read never renders as an
    // empty list. The loading signal is therefore `isFetching`/`isPlaceholderData`, not absent data.
    placeholderData: keepPreviousData,
    // One query change issues exactly one request, and a source that is down reaches the honest
    // `unavailable` answer instead of being retried into repeated loads.
    retry: false,
  });
}
