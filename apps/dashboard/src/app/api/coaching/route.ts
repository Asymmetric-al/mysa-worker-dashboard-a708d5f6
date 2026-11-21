/**
 * `GET /api/coaching` — the worker's own coaching overview, in the one read envelope.
 *
 * **Why a route exists at all.** `/coaching` renders this read on the server, and a Server Component
 * may not fetch the application's own endpoint to re-read what it can already reach in process. This
 * handler is the browser's transport for the same answer: a client that has to know its sharing state
 * after a mutation settled, after a development control moved the scenario, or after a reload asks for
 * the envelope the page rendered, and gets it without a second implementation of it.
 *
 * **One read, one mapper.** `reads.coaching.readCoachingOverview()` resolves the development-session
 * cookie itself, derives the scope, applies the per-module authorisation and reports each
 * relationship's own refusal; `toResponse` is the application's only status ladder. So the envelope
 * reaches a browser as 200, a relationship the caller cannot read as the denial its closed reason code
 * names (403), and a store that did not answer as `unavailable` (503) naming the source and the safe
 * retry. This file states no scope, tests no membership, reads no clock and formats nothing: no field
 * is added, removed, recomputed or normalised on the way out, and no status is chosen here.
 *
 * **No write path, deliberately.** Every one of the fifteen named coaching mutations has a more
 * specific home on this segment — the grant lifecycle and the coach's two writes on `/grants`, the
 * module toggles on `/modules`, the target lifecycle on `/targets`, the check-in and its sharing on
 * `/checkins`, the task summaries on `/taskshare` — so a `POST` here would have to mean one of them
 * without a path that names it. Only `GET` is exported and every other method answers 405 from the
 * framework. Nothing in the request selects who the caller is either: the read takes no query, no
 * route parameters and no body, so no URL can name a principal, a ministry or a grant.
 *
 * **Layering.** `app/api → modules/data-service`. This file imports the service package root and
 * nothing deeper: never the synthetic store, never a read module's own path, never a feature module.
 */

import { outcomeFromError, reads, toResponse } from "@/modules/data-service";

/** The store reads and writes session documents through `node:fs`, so this handler is never an edge one. */
export const runtime = "nodejs";

/** The read resolves the development session and evaluates the scenario clock once per request. */
export const dynamic = "force-dynamic";

/**
 * The marker a refusal from this route carries where a mutation would carry its operation id.
 *
 * A `GET` performs no effect, so it has no attempt to name; `"read"` is the non-unique marker every
 * read result in the service already carries, which is what keeps a failed read from looking like a
 * change someone could replay.
 */
const READ_ATTEMPT_ID = "read";

/**
 * Answers with the worker's coaching overview: private preparation as its own record class, every
 * relationship with its five independent module switches, its duration as a separate fact, its four
 * acceptance outcomes apart and its own refusal when the episode is not open, inside the envelope that
 * also states scope, source, revision, as-of instant, coverage, value states and available actions.
 *
 * A thrown fault is converted through the service's own error mapping rather than surfacing as a
 * framework error page: a store fault becomes `unavailable` naming the source, a session that cannot
 * be established becomes `denied`, and anything unrecognised becomes `unknown` carrying only the
 * attempt marker. No fault is answered with seeded data, an empty relationship list or a zero.
 */
export async function GET(): Promise<Response> {
  try {
    return toResponse(await reads.coaching.readCoachingOverview());
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
