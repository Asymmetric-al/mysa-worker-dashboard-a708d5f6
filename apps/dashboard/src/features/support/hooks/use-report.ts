"use client";

/**
 * The browser read behind this application's four fixed reports: one query, one snapshot identity,
 * one `ReportResult`, taken from `POST /api/report`.
 *
 * Why one hook serves all four reports. The on-screen total, the chart series, the table rows, the
 * drilldown, the CSV file and the print view must agree in count and in minor-unit sums per currency
 * (AAP 0.8.8; criterion 1, the decisive one), and they agree because they read one result computed
 * once on the server. This module is the browser's only path to that result: it wraps
 * `reads.support.readReport` and returns exactly the read union the service answered with, so no
 * second fetch, no second aggregation and no second cache of a total can appear beside it.
 *
 * Why the query travels as a request body. The query is a period, a currency, an amount range, an
 * attribution, a designation, a search term, a sort and a page window. In a URL it would be
 * hand-editable, truncatable on the way and easy to disagree with what the screen shows; as a body it
 * is the very object the cache key carries, so the key cannot omit a field the request sends.
 *
 * Why the HTTP status is read first. `toResponse` in `modules/data-service/outcome` flattens the
 * in-process read union onto the wire: 200 carries the envelope itself, 403 the denial and 503 the
 * outage. {@link requestReport} therefore rebuilds the union's `kind` from the status the service
 * documented. Every branch it returns is built from a body the service sent; a transport failure, an
 * unexpected status or a body that is not what its status promises rejects the query, because an
 * absent answer is never a report of nothing.
 *
 * What it does not do. It computes nothing — no sum, percentage, sort, page or date arithmetic — it
 * fills no missing period, it reads no clock and it stores no result: TanStack Query is the only
 * remote-result state here. `asOf`, `coverage` and `valueStates` are the service's and are passed
 * through untouched, which is what lets every surface state that a subtotal is incomplete rather
 * than whole.
 *
 * Plan items: AAP 0.6.3 (`POST /api/report` → `readReport`), 0.7.1's "Understand support" job,
 * 0.9.1/0.11.1 (`features/support/**`), 0.10.1 families 7 and 8, and criterion 1. Rule 1 clause 2 is
 * why the report computation stays in `modules/support/report` and the snapshot identity is minted
 * once, here, for the screen and the export beside it to share.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
import { isOutcome } from "@/modules/data-service/outcome";

/** Where one report query is posted. Relative, so the `httpOnly` session cookie travels with it. */
const REPORT_ENDPOINT = "/api/report";

/** The job segment of a report's cache key, beside the scope, so it cannot collide with another read. */
const REPORT_JOB = "report";

/** The prefix that marks a request identity as a report's rather than a record's. */
const SNAPSHOT_ID_PREFIX = "report-";

/** FNV-1a's 32-bit offset basis and prime, named once for {@link fnv1a32}. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// ---------------------------------------------------------------------------------------------
// What the service answers with, derived from the service
// ---------------------------------------------------------------------------------------------

/**
 * What a report read answers with, derived from `readReport`'s own return type.
 *
 * Derived rather than restated: the hook has to hand back the same union the service produces, and a
 * second declaration of that union could quietly describe a contract the route no longer returns.
 */
export type ReportReadResult = Awaited<ReturnType<typeof reads.support.readReport>>;

/** The envelope branch of that answer: the eight members the five financial surfaces read. */
export type ReportEnvelope = Extract<ReportReadResult, { readonly kind: "envelope" }>["envelope"];

/** The bounded filter set `readReport` accepts, taken from its signature rather than copied. */
export type ReportFilters = NonNullable<Parameters<typeof reads.support.readReport>[1]>;

/** Which of the four reports is read: the engine identity `REPORT_CATALOG[...].queryId` carries. */
export type ReportIdentity = Parameters<typeof reads.support.readReport>[0];

/**
 * One report request: which report, and the filters it is computed under.
 *
 * The report's identity travels inside the query because `readReport` takes it beside the filters,
 * and because a body whose query names the report is a body a cache key built from that query fully
 * describes. Nothing else is added here: the filters are the service's own type.
 */
export type ReportRequestQuery = ReportFilters & { readonly reportId: ReportIdentity };

/** How one report read is asked for. */
export interface UseReportOptions {
  /** The context the report is read in; its three identifiers lead the cache key. */
  readonly scope: Scope;
  /** Which report, and the filters it is computed under. Every field is part of the cache key. */
  readonly query: ReportRequestQuery;
  /**
   * The request identity to send in place of the derived one. Supplied only by a surface that already
   * holds the identity of this same query — the CSV export beside the screen — so both carry one
   * snapshot statement. It is never a way to name a different query: it does not enter the cache key,
   * and the derived identity is what a query is otherwise identified by.
   */
  readonly snapshotId?: string;
  /**
   * Defers a query the caller has not finalised yet, and nothing else. It is never set to hide an
   * outage: a read that cannot answer has to arrive as `unavailable`, not as a report left blank.
   */
  readonly enabled?: boolean;
}

/**
 * The key one report read is cached under: the context, this job, and the whole query.
 *
 * The query object is the last segment on purpose. TanStack Query hashes object members in a stable
 * order and ignores their declaration order, so two reads that differ in any field the request sends
 * are two entries — and the entry's own identity is the query `readReport` was asked for.
 */
type ReportQueryKey = readonly [...ScopeKey, typeof REPORT_JOB, ReportRequestQuery];

// ---------------------------------------------------------------------------------------------
// The request identity
// ---------------------------------------------------------------------------------------------

/**
 * Whether a value is a plain JSON object: an object that is neither `null` nor an array.
 *
 * Written here rather than imported so this module reaches nothing beyond the contracts it consumes;
 * it is the one narrowing both the canonicaliser and the envelope check need.
 */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A canonical string for a JSON value: object members in ascending key order, arrays in their own
 * order, `undefined` members left out entirely.
 *
 * The last rule is what makes an explicitly-undefined field and an omitted field the same query,
 * which they are to the service. Strings are quoted and escaped, so a value containing a key
 * separator cannot make two different queries produce one string.
 */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return `[${items.map(canonicalJson).join(",")}]`;
  }
  if (!isPlainObject(value)) {
    /*
     * A function, a symbol or a bigint is not a value a report query can hold. Refusing is the honest
     * answer: encoding it as nothing would let two different queries share one identity.
     */
    throw new TypeError(
      "A report query must be plain JSON, so it can be identified by its content.",
    );
  }
  const members: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const member = value[key];
    if (member === undefined) {
      continue;
    }
    members.push(`${JSON.stringify(key)}:${canonicalJson(member)}`);
  }
  return `{${members.join(",")}}`;
}

/**
 * The FNV-1a 32-bit hash of a string's UTF-8 bytes, as eight lowercase hex characters.
 *
 * FNV-1a is a pure function of its input with no state, table or seed to carry between runs, and
 * `Math.imul` is the exact 32-bit multiply it needs. Hashing UTF-8 bytes rather than UTF-16 code
 * units is what keeps an accented or right-to-left query value's identity the same in the browser, in
 * Node and in a test. Being 32 bits wide, two different queries could in principle collide; the
 * identity distinguishes the queries one surface asks, and it is not an authority or a secret.
 */
function fnv1a32(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * A pure, deterministic identity for one report request: equal queries give equal ids on every
 * render, in every component and in the export call, and different queries give different ones.
 * Derived from the canonical serialisation of the query and hashed with FNV-1a 32; it reads no clock,
 * no random source and no counter, so the same query identifies itself identically across a reload,
 * a process and a machine. The export mints it from the same query the screen used, which is how the
 * downloaded file and the page it came from are known to answer one question; the `asOf`, the
 * coverage and every computed number remain the service's.
 */
export function reportSnapshotId(query: ReportRequestQuery): string {
  return `${SNAPSHOT_ID_PREFIX}${fnv1a32(canonicalJson(query))}`;
}

// ---------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------

/**
 * Whether a 200 body carries a read envelope: the envelope's eight members, by kind.
 *
 * This is the branch check a status code cannot make on its own. It stops at the envelope's own
 * members on purpose — the service built and froze the `ReportResult` inside it, and re-validating
 * that here would be a second copy of a contract `modules/support/report` owns.
 */
function isWireEnvelope(value: unknown): value is ReportEnvelope {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    "data" in value &&
    isPlainObject(value.scope) &&
    isPlainObject(value.source) &&
    typeof value.revision === "string" &&
    typeof value.asOf === "string" &&
    isPlainObject(value.coverage) &&
    isPlainObject(value.valueStates) &&
    Array.isArray(value.actions)
  );
}

/**
 * The error a transport fault becomes: the endpoint that failed, and what went wrong.
 *
 * A cancellation is returned untouched. TanStack Query aborts this query's signal when the read is
 * superseded — a context switch cancels everything in flight — and it has to see its own abort
 * rather than a report saying the source is down.
 */
function transportFailure(error: unknown, signal: AbortSignal | undefined): Error {
  if (signal?.aborted === true) {
    return error instanceof Error ? error : new Error(`${REPORT_ENDPOINT} was cancelled.`);
  }
  const detail = error instanceof Error ? error.message : "the request failed";
  return new Error(`${REPORT_ENDPOINT} could not be reached: ${detail}`, { cause: error });
}

/**
 * Asks the service for one report and rebuilds the read union from the answer it documented.
 *
 * The status is the discriminator because `toResponse` states the union that way: 200 carries the
 * envelope, 403 the denial and 503 the outage. Every branch returned is the body the service sent,
 * so a denial stays a denial with its reason code and an outage stays an outage with its source;
 * neither is unwrapped into an empty report, and no missing period is filled. A body that is not what
 * its status promises is a protocol fault and rejects the query, which is the only honest answer when
 * no contract answer exists at all.
 */
async function requestReport(
  query: ReportRequestQuery,
  snapshotId: string,
  signal: AbortSignal | undefined,
): Promise<ReportReadResult> {
  let response: Response;
  try {
    response = await fetch(REPORT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query, snapshotId }),
      signal,
    });
  } catch (error) {
    throw transportFailure(error, signal);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    throw new Error(`${REPORT_ENDPOINT} answered ${response.status} with a body that is not JSON.`);
  }

  switch (response.status) {
    case 200:
      if (!isWireEnvelope(body)) {
        throw new Error(`${REPORT_ENDPOINT} answered 200 with a body that is not a read envelope.`);
      }
      return { kind: "envelope", envelope: body };
    case 403:
      if (!isOutcome(body) || body.outcome !== "denied") {
        throw new Error(`${REPORT_ENDPOINT} answered 403 without a denial.`);
      }
      return { kind: "denied", denied: body };
    case 503:
      if (!isOutcome(body) || body.outcome !== "unavailable") {
        throw new Error(`${REPORT_ENDPOINT} answered 503 without an unavailable outcome.`);
      }
      return { kind: "unavailable", unavailable: body };
    default:
      throw new Error(
        `${REPORT_ENDPOINT} answered ${response.status}, which states no read result.`,
      );
  }
}

// ---------------------------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------------------------

/**
 * Reads one of the four fixed reports through `reads.support.readReport`, answering with the read
 * union unchanged — `envelope | denied | unavailable` — cached under the context and the whole query.
 *
 * One call per query is the point: two surfaces that must agree are two consumers of this one
 * cache entry for one query, never two requests that happen to have been sent together. Reads are
 * idempotent, so the default retry is kept; a caller that renders `denied` or `unavailable` reports
 * what the service said, and a caller that renders nothing until the query settles shows a busy state
 * rather than an empty report.
 */
export function useReport({
  scope,
  query,
  snapshotId,
  enabled,
}: UseReportOptions): UseQueryResult<ReportReadResult, Error> {
  const identity = snapshotId ?? reportSnapshotId(query);
  const key: ReportQueryKey = [...scopeKey(scope), REPORT_JOB, query];

  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => requestReport(query, identity, signal),
    enabled,
  });
}
