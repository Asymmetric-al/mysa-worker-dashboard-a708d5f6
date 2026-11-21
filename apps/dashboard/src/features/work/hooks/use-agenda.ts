"use client";
/**
 * The dated agenda as one browser read: the service's `readAgenda`, fetched through the task handler and
 * cached under the scope-led key the context fence clears.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { scopeKey } from "@/components/context-switch-guard";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
import type { DeniedOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";

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

const UNAVAILABLE_STATUS = 503;

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

/**
 * Reads the wire's answer back into the read's own three arms.
 *
 * The handler answers 200 with the envelope itself, 403 with the denial and 503 with the outage — no `kind`
 * wrapper — so the status names the arm and each body is cast to the arm that produced it. The cast is safe
 * because the handler's `toResponse` is the declared producer of both shapes, which is why this module keeps
 * no second copy of the envelope or outcome contract; a status outside the three is a fault rather than a
 * fourth kind of answer, so it never becomes an outcome this view would render as success or as empty.
 */
function agendaResultOf(status: number, body: unknown, path: string): AgendaResult {
  switch (status) {
    case ENVELOPE_STATUS:
      return { kind: "envelope", envelope: body as AgendaEnvelope };
    case DENIED_STATUS:
      return { kind: "denied", denied: body as DeniedOutcome };
    case UNAVAILABLE_STATUS:
      return { kind: "unavailable", unavailable: body as UnavailableOutcome };
    default:
      throw new Error(`${path} answered ${status}, which is not one of the agenda read's three answers, so this view has no result to state.`);
  }
}

/** Asks the task handler for one page of the dated agenda, in the session's scope and under the query the caller states. */
async function getAgendaRead(query: AgendaQuery, signal: AbortSignal): Promise<AgendaResult> {
  const path = `${AGENDA_ENDPOINT}?${agendaParams(query).toString()}`;
  const response = await fetch(path, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "same-origin",
    signal,
  });
  const body: unknown = await response.json();
  return agendaResultOf(response.status, body, path);
}

/** Reads the dated agenda for one scope and one query state, returning the read's envelope, `denied` and `unavailable` arms unchanged. */
export function useAgenda(scope: Scope, query: AgendaQuery): UseQueryResult<AgendaResult, Error> {
  return useQuery<AgendaResult, Error>({
    queryKey: [...scopeKey(scope), "agenda", query],
    queryFn: ({ signal }) => getAgendaRead(query, signal),
  });
}
