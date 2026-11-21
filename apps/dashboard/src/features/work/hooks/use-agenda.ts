"use client";
/** The dated agenda as one browser read: the service's `readAgenda`, fetched through the task handler and cached under the scope-led key the context fence clears. */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { scopeKey } from "@/components/context-switch-guard";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
import type { DeniedOutcome, InvalidOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";

/** What a caller asks the dated agenda for: the read's own parameter type, so no second copy of the query contract exists. */
export type AgendaQuery = Parameters<typeof reads.work.readAgenda>[0];

/** What the agenda read answers: the scoped envelope, or the read's own `denied` and `unavailable` refusals, unchanged. */
export type AgendaResult = Awaited<ReturnType<typeof reads.work.readAgenda>>;

/** The envelope arm taken from the read's own result type, so the wire's 200 body is typed rather than restated. */
type AgendaEnvelope = Extract<AgendaResult, { readonly kind: "envelope" }>["envelope"];

/** The read this transport asks for on the shared task path, beside the five task lists. */
const AGENDA_READ = "readAgenda";

const READ_PARAM = "read";

const AGENDA_ENDPOINT = "/api/tasks";

const ENVELOPE_STATUS = 200;

const DENIED_STATUS = 403;

/** A session that expired or could not be established answers 401 with the same denial, which is a session fault rather than a permission refusal. */
const SESSION_FAULT_STATUS = 401;

const UNAVAILABLE_STATUS = 503;

/** A parameter this read does not admit answers 422 with the field-keyed refusal, which is the request's own fault and not a source that did not answer. */
const REFUSED_STATUS = 422;

/** Encodes the caller's whole query into the request, so nothing the cache key holds is missing from it. */
function agendaParams(query: AgendaQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set(READ_PARAM, AGENDA_READ);
  const stated: Readonly<Record<string, unknown>> = { ...query };
  for (const [name, value] of Object.entries(stated)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      params.set(name, String(value));
      continue;
    }
    const encoded = JSON.stringify(value);
    if (encoded !== undefined) {
      params.set(name, encoded);
    }
  }
  return params;
}

/** Reads the wire's answer back into the read's own four arms. */
function agendaResultOf(status: number, body: unknown, path: string): AgendaResult {
  switch (status) {
    case ENVELOPE_STATUS:
      return { kind: "envelope", envelope: body as AgendaEnvelope };
    case DENIED_STATUS:
    case SESSION_FAULT_STATUS:
      return { kind: "denied", denied: body as DeniedOutcome };
    case UNAVAILABLE_STATUS:
      return { kind: "unavailable", unavailable: body as UnavailableOutcome };
    case REFUSED_STATUS:
      // The request stated something this read does not admit: the caller is handed the field-keyed
      // refusal to correct rather than an outage of a source that never failed.
      return { kind: "refused", refused: body as InvalidOutcome };
    default:
      throw new Error(`${path} answered ${status}, which is not one of the agenda read's answers, so this view has no result to state.`);
  }
}

/** Asks the task handler for one page of the dated agenda, in the session's scope and under the query the caller states. */
async function getAgendaRead(query: AgendaQuery, signal: AbortSignal): Promise<AgendaResult> {
  const path = `${AGENDA_ENDPOINT}?${agendaParams(query).toString()}`;
  const response = await fetch(path, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", signal });
  const body: unknown = await response.json();
  return agendaResultOf(response.status, body, path);
}

/** Reads the dated agenda for one scope and one query state, returning the read's envelope, `denied`, `unavailable` and `refused` arms unchanged. */
export function useAgenda(scope: Scope, query: AgendaQuery): UseQueryResult<AgendaResult, Error> {
  return useQuery<AgendaResult, Error>({ queryKey: [...scopeKey(scope), "agenda", query], queryFn: ({ signal }) => getAgendaRead(query, signal) });
}
