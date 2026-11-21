"use client";
/**
 * The series detail as one browser read: the service's `reads.series.readSeries`, fetched through the
 * series handler and cached under the scope-led key the context fence clears.
 *
 * **What it carries.** The next-three-date preview with each disclosed last-day-of-month resolution, the
 * single actionable occurrence, the three resolutions a plan that needs review offers, and the state that
 * plan is in all arrive inside the envelope: the rule, the session scope and the scenario clock derive
 * them inside the service (AAP 0.8.2, AAP 0.8.7). This hook therefore computes nothing about recurrence —
 * no date arithmetic, no "is this date missed" test, no counting of previews, no clock read — because a
 * second computation here is how a series view starts disagreeing with the tasks beside it. A caller that
 * needs "now" reads `asOf` from the envelope.
 *
 * **Why the wire decodes the three arms instead of asserting one.** `toResponse` puts a read's `kind` on
 * the status rather than in the body: 200 carries the envelope itself with no `kind` wrapper, 403 the
 * denial and 503 the outage. Asserting a body as `SeriesResult` would therefore hand a caller an envelope
 * whose `kind` is `undefined`, so a denial or an outage would render as a series with no title — exactly
 * the flattening Rule 1 clause 3 forbids. The arms are rebuilt here from the status, and a status or body
 * this read does not answer with is thrown as the fault it is rather than invented as an empty series.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
// Type-only, like every data-service import here: these are the read's own contract, taken without
// loading the modules that produce it (`index.ts` reaches the store, `outcome.ts` reaches `next/server`).
import type { Scope, reads } from "@/modules/data-service";
import type { DeniedOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";

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

const UNAVAILABLE_STATUS = 503;

/**
 * The request path for one series, with the identifier encoded so an opaque id cannot add a parameter of
 * its own. It states `seriesId` and nothing else: a preview date, a "from" date, an `asOf` instant or a
 * scope override is refused by the handler rather than normalised, because every date and every boundary
 * this read reports is derived from the session and the scenario clock.
 */
function seriesEndpointFor(seriesId: string): string {
  const search = new URLSearchParams();
  search.set(SERIES_ID_PARAM, seriesId);
  return `${SERIES_ENDPOINT}?${search.toString()}`;
}

function noAnswer(path: string, status: number, detail: string): Error {
  return new Error(`${path} answered ${status} with ${detail}, so this series has no answer to show.`);
}

/**
 * Reads the wire's answer back into the read's own three arms.
 *
 * The status names the arm, because `toResponse` flattened the read's `kind` onto it, and each body is
 * cast to the arm that produced it: that function is the declared producer of all three, which is why this
 * module keeps no second copy of the envelope or outcome contract. A status outside the three, or a body
 * that is not a JSON object, is a fault rather than a fourth kind of answer, so it never becomes a series
 * a view would render as empty.
 */
function seriesResultOf(path: string, status: number, body: unknown): SeriesResult {
  if (typeof body !== "object" || body === null) {
    throw noAnswer(path, status, "a body that is not a JSON object");
  }
  switch (status) {
    case ENVELOPE_STATUS:
      return { kind: "envelope", envelope: body as SeriesEnvelope };
    case DENIED_STATUS:
      return { kind: "denied", denied: body as DeniedOutcome };
    case UNAVAILABLE_STATUS:
      return { kind: "unavailable", unavailable: body as UnavailableOutcome };
    default:
      throw noAnswer(path, status, "a status this read does not answer with");
  }
}

/**
 * Asks the series handler for one series and answers the read's own result.
 *
 * The identifier is the whole request: the handler resolves the session's scope and the instant itself,
 * so nothing the cache key holds is missing from the request, and nothing the request cannot state is
 * invented here.
 */
async function getSeriesRead(seriesId: string, signal: AbortSignal): Promise<SeriesResult> {
  // The read's own parameter type, built from the one identifier the caller holds: a field the service
  // does not take cannot be sent, and a member it starts to require fails to compile here.
  const query: SeriesQuery = { seriesId };
  const path = seriesEndpointFor(query.seriesId);
  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      signal,
    });
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

/**
 * Reads one recurring series in the given scope: `reads.series.readSeries` over `GET /api/series`,
 * returning the read's `envelope | denied | unavailable` unchanged so a caller narrows on it.
 *
 * Every recurring-task fact — the preview dates and their count, the resolved month days, the one
 * actionable occurrence, `planReview` with its resolutions, `leftBehind` and `asOf` — comes from the
 * envelope, so a preview stays a preview, a paused series stays paused and a denial stays a denial rather
 * than an empty series. An absent id names no series, so no request is issued for one.
 */
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
