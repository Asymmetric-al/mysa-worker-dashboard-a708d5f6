"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { fetchRead } from "@/lib/read-transport";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
const REPORT_JOB = "report";
export type ReportReadResult = Awaited<ReturnType<typeof reads.support.readReport>>;
export type ReportEnvelope = Extract<ReportReadResult, { readonly kind: "envelope" }>["envelope"];
export type ReportFilters = NonNullable<Parameters<typeof reads.support.readReport>[1]>;
export type ReportIdentity = Parameters<typeof reads.support.readReport>[0];
export type ReportRequestQuery = ReportFilters & { readonly reportId: ReportIdentity };
export type UseReportOptions = { readonly scope: Scope; readonly query: ReportRequestQuery; readonly snapshotId?: string; readonly enabled?: boolean };
type ReportQueryKey = readonly [...ScopeKey, typeof REPORT_JOB, ReportRequestQuery];
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return `[${items.map(canonicalJson).join(",")}]`;
  }
  if (!isRecord(value)) throw new TypeError("A report query must be plain JSON, so it can be identified by its content.");
  const members: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const member = value[key];
    if (member !== undefined) members.push(`${JSON.stringify(key)}:${canonicalJson(member)}`);
  }
  return `{${members.join(",")}}`;
}
/** A pure, deterministic identity for one report request: equal queries give equal ids on every render, in every component and in the export call, and two distinct queries can never share one. */ export const reportSnapshotId = (query: ReportRequestQuery): string => `report-${canonicalJson(query)}`;
/** How long an answered report is held fresh: everything that changes the answer arrives as a new query, an accepted goal save invalidates the `report` job, and a failed read keeps the frame's own retry. */ const REPORT_STALE_TIME_MS = 30_000;
/** Reads one of the four fixed reports through `reads.support.readReport`, answering with the read union unchanged — `envelope | denied | unavailable | refused` — cached under the context and the whole request. */
export function useReport({ scope, query, snapshotId, enabled }: UseReportOptions): UseQueryResult<ReportReadResult, Error> {
  const identity = snapshotId ?? reportSnapshotId(query);
  const key: ReportQueryKey = [...scopeKey(scope), REPORT_JOB, query];
  return useQuery({ queryKey: key, queryFn: ({ signal }) => fetchRead<ReportEnvelope["data"], ReportEnvelope["coverage"]>({ url: "/api/report", body: { query, snapshotId: identity }, admits: isRecord, signal }), enabled, staleTime: REPORT_STALE_TIME_MS, refetchOnWindowFocus: false });
}
