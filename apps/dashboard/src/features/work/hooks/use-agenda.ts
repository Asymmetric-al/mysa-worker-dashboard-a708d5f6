"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { fetchRead } from "@/lib/read-transport";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
export type AgendaQuery = Parameters<typeof reads.work.readAgenda>[0];
export type AgendaResult = Awaited<ReturnType<typeof reads.work.readAgenda>>;
type AgendaEnvelope = Extract<AgendaResult, { readonly kind: "envelope" }>["envelope"];
function agendaParams(query: AgendaQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("read", "readAgenda");
  const stated: Readonly<Record<string, unknown>> = { ...query };
  for (const [name, value] of Object.entries(stated)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      params.set(name, String(value));
      continue;
    }
    const encoded = JSON.stringify(value);
    if (encoded !== undefined) params.set(name, encoded);
  }
  return params;
}
const isAgendaData = (value: unknown): boolean => isRecord(value);
async function getAgendaRead(query: AgendaQuery, signal: AbortSignal): Promise<AgendaResult> {
  return fetchRead<AgendaEnvelope["data"], AgendaEnvelope["coverage"]>({ url: `/api/tasks?${agendaParams(query).toString()}`, admits: isAgendaData, signal });
} /** Reads the dated agenda for one scope and one query state, returning the read's envelope, `denied`, `unavailable` and `refused` arms unchanged. */
export const useAgenda = (scope: Scope, query: AgendaQuery): UseQueryResult<AgendaResult, Error> => useQuery<AgendaResult, Error>({ queryKey: [...scopeKey(scope), "agenda", query], queryFn: ({ signal }) => getAgendaRead(query, signal) });
