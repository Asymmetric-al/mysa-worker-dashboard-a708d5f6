"use client";
/** The series detail as one browser read: the service's `reads.series.readSeries`, fetched through the series handler and cached under the scope-led key the context fence clears. **What it carries.** … */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
// Type-only, like every data-service import here: these are the read's own contract, taken without
// loading the modules that produce it (`index.ts` reaches the store, `outcome.ts` reaches `next/server`).
import type { Scope, reads } from "@/modules/data-service";
import type { DeniedOutcome, InvalidOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";

// ---------------------------------------------------------------------------------------------
// The read's own contract, derived rather than restated
// ---------------------------------------------------------------------------------------------

/** What a caller asks one series for — `reads.series.readSeries`'s own parameter, so the query cannot drift from the service's. */
export type SeriesQuery = Parameters<typeof reads.series.readSeries>[0];

/** What `reads.series.readSeries` answers: the scoped envelope, or the reason it could not be built, handed on unwrapped. */
export type SeriesResult = Awaited<ReturnType<typeof reads.series.readSeries>>;

/** The envelope arm alone, which is the one shape a successful answer carries. */
type SeriesEnvelope = Extract<SeriesResult, { readonly kind: "envelope" }>["envelope"];

// ---------------------------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------------------------

/** The series handler's path (AAP 0.6.3): relative, because the browser transport is this application's own origin. */
const SERIES_ENDPOINT = "/api/series";

/** The one query member this read takes, named as the handler names it. The handler refuses any other key. */
const SERIES_ID_PARAM = "seriesId";

const ENVELOPE_STATUS = 200;

const DENIED_STATUS = 403;

/** A session that expired or could not be established answers 401 with the same denial, which is a session fault rather than a permission refusal. */
const SESSION_FAULT_STATUS = 401;

const UNAVAILABLE_STATUS = 503;

/** A wealth of parameters this read does not admit answers 422 with the field-keyed refusal, which is the request's own fault and not a source that did not answer. */
const REFUSED_STATUS = 422;

/** The request path for one series, with the identifier encoded so an opaque id cannot add a parameter of its own. */
function seriesEndpointFor(seriesId: string): string {
  const search = new URLSearchParams();
  search.set(SERIES_ID_PARAM, seriesId);
  return `${SERIES_ENDPOINT}?${search.toString()}`;
}

function noAnswer(path: string, status: number, detail: string): Error {
  return new Error(`${path} answered ${status} with ${detail}, so this series has no answer to show.`);
}

/** Reads the wire's answer back into the read's own four arms. */
function seriesResultOf(path: string, status: number, body: unknown): SeriesResult {
  if (typeof body !== "object" || body === null) {
    throw noAnswer(path, status, "a body that is not a JSON object");
  }
  switch (status) {
    case ENVELOPE_STATUS:
      return { kind: "envelope", envelope: body as SeriesEnvelope };
    case DENIED_STATUS:
    case SESSION_FAULT_STATUS:
      return { kind: "denied", denied: body as DeniedOutcome };
    case UNAVAILABLE_STATUS:
      return { kind: "unavailable", unavailable: body as UnavailableOutcome };
    case REFUSED_STATUS:
      // The request named something this read does not admit, so the caller is handed the field-keyed
      // refusal to correct rather than an outage of a source that answered perfectly well.
      return { kind: "refused", refused: body as InvalidOutcome };
    default:
      throw noAnswer(path, status, "a status this read does not answer with");
  }
}

/** Asks the series handler for one series and answers the read's own result. */
async function getSeriesRead(seriesId: string, signal: AbortSignal): Promise<SeriesResult> {
  // The read's own parameter type, built from the one identifier the caller holds: a field the service
  // does not take cannot be sent, and a member it starts to require fails to compile here.
  const query: SeriesQuery = { seriesId };
  const path = seriesEndpointFor(query.seriesId);
  let response: Response;
  try {
    response = await fetch(path, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", signal });
  } catch (cause) {
    throw new Error(`GET ${SERIES_ENDPOINT} could not be completed, so this series has no answer to show.`, { cause });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error(`GET ${SERIES_ENDPOINT} answered ${response.status} with a body that is not JSON, so this series has no answer to show.`, { cause });
  }
  return seriesResultOf(path, response.status, payload);
}

// ---------------------------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------------------------

/** Reads one recurring series in the given scope: */
export function useSeries(scope: Scope, seriesId: string): UseQueryResult<SeriesResult, Error> {
  return useQuery<SeriesResult, Error>({
    // The id is its own key segment beside the scope segments and the job, so two series never share one
    // entry, while the context fence's `clear()` and the task mutations' `series` invalidation both still
    // reach this read. The scope segments come from the one builder the fence clears, so a switch cannot
    // leave a previous ministry's series in reach.
    queryKey: [...scopeKey(scope), "series", seriesId],
    // The signal is forwarded, which is what lets the context fence's `cancelQueries()` abort a read that
    // was issued under the context the worker has just left.
    queryFn: ({ signal }) => getSeriesRead(seriesId, signal),
    // An absent id fabricates nothing: no request is issued and no envelope is invented for it.
    enabled: seriesId.length > 0,
  });
}
