"use client";
/** The browser read behind this application's four fixed reports: one query, one snapshot identity, one `ReportResult`, taken from `POST /api/report`. */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
import { isOutcome } from "@/modules/data-service/outcome";
const REPORT_ENDPOINT = "/api/report";
const REPORT_JOB = "report";
const SNAPSHOT_ID_PREFIX = "report-";
// How long an answered report is held fresh, the same window the overview, commitments and goal reads use on the
// snapshot this report shares. Everything that changes the answer arrives as a new query: a filter or a year is a
// new key, an accepted goal save invalidates the `report` job, and a failed read keeps the frame's own retry.
const REPORT_STALE_TIME_MS = 30_000;
// What the service answers with, derived from the service
export type ReportReadResult = Awaited<ReturnType<typeof reads.support.readReport>>;
export type ReportEnvelope = Extract<ReportReadResult, { readonly kind: "envelope" }>["envelope"];
export type ReportFilters = NonNullable<Parameters<typeof reads.support.readReport>[1]>;
export type ReportIdentity = Parameters<typeof reads.support.readReport>[0];
export type ReportRequestQuery = ReportFilters & { readonly reportId: ReportIdentity };
export interface UseReportOptions {
  readonly scope: Scope;
  readonly query: ReportRequestQuery;
  readonly snapshotId?: string;
  readonly enabled?: boolean;
}
type ReportQueryKey = readonly [...ScopeKey, typeof REPORT_JOB, ReportRequestQuery];
// The request identity
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
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
    throw new TypeError("A report query must be plain JSON, so it can be identified by its content.");
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
/** A pure, deterministic identity for one report request: equal queries give equal ids on every render, in every component and in the export call, and two distinct queries can never share one. */
export function reportSnapshotId(query: ReportRequestQuery): string {
  return `${SNAPSHOT_ID_PREFIX}${canonicalJson(query)}`;
}
// The request
function isWireEnvelope(value: unknown): value is ReportEnvelope {
  if (!isPlainObject(value)) {
    return false;
  }
  return "data" in value && isPlainObject(value.scope) && isPlainObject(value.source) && typeof value.revision === "string" && typeof value.asOf === "string" && isPlainObject(value.coverage) && isPlainObject(value.valueStates) && Array.isArray(value.actions);
}
function transportFailure(error: unknown, signal: AbortSignal | undefined): Error {
  if (signal?.aborted === true) {
    return error instanceof Error ? error : new Error(`${REPORT_ENDPOINT} was cancelled.`);
  }
  const detail = error instanceof Error ? error.message : "the request failed";
  return new Error(`${REPORT_ENDPOINT} could not be reached: ${detail}`, { cause: error });
}
async function requestReport(query: ReportRequestQuery, snapshotId: string, signal: AbortSignal | undefined): Promise<ReportReadResult> {
  let response: Response;
  try {
    response = await fetch(REPORT_ENDPOINT, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "same-origin", body: JSON.stringify({ query, snapshotId }), signal });
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
    // A session that expired or could not be established answers 401 with the same denial a refusal carries.
    case 401:
    case 403:
      if (!isOutcome(body) || body.outcome !== "denied") {
        throw new Error(`${REPORT_ENDPOINT} answered ${response.status} without a denial.`);
      }
      return { kind: "denied", denied: body };
    case 503:
      if (!isOutcome(body) || body.outcome !== "unavailable") {
        throw new Error(`${REPORT_ENDPOINT} answered 503 without an unavailable outcome.`);
      }
      return { kind: "unavailable", unavailable: body };
    case 422:
      // The body states the report this read does not admit: the field-keyed refusal is the caller's to
      // correct, and no source behind the report failed.
      if (!isOutcome(body) || body.outcome !== "invalid") {
        throw new Error(`${REPORT_ENDPOINT} answered 422 without a refusal of the request.`);
      }
      return { kind: "refused", refused: body };
    default:
      throw new Error(`${REPORT_ENDPOINT} answered ${response.status}, which states no read result.`);
  }
}
// The hook
/** Reads one of the four fixed reports through `reads.support.readReport`, answering with the read union unchanged — `envelope | denied | unavailable | refused` — cached under the context and the whole. */
export function useReport({ scope, query, snapshotId, enabled }: UseReportOptions): UseQueryResult<ReportReadResult, Error> {
  const identity = snapshotId ?? reportSnapshotId(query);
  const key: ReportQueryKey = [...scopeKey(scope), REPORT_JOB, query];
  return useQuery({ queryKey: key, queryFn: ({ signal }) => requestReport(query, identity, signal), enabled, staleTime: REPORT_STALE_TIME_MS, refetchOnWindowFocus: false });
}
