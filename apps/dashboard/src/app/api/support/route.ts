/**
 * `GET /api/support` — the Support overview, in the one read envelope.
 *
 * **What it serves, and why a route exists for it.** The overview is the cash-first statement of one
 * period with the non-cash measures kept visibly apart beside it: recurring collection outcomes in
 * their five buckets plus whatever the source could not place, commitments counted by kind, and the
 * monthly equivalent the source itself qualified. A Server Component reads exactly that by calling
 * `reads.support.readSupportOverview` in process, and this handler is the browser's transport for
 * the same read — mounted, refetched after a save, or re-read after a context switch — so the client
 * hook that renders the overview (`features/support/hooks/use-support-overview.ts`) never needs a
 * second implementation of it.
 *
 * **One read, one mapper.** The read resolves the development session, derives the scope, builds the
 * report query, runs the one financial computation and builds the envelope; `toResponse` is the
 * application's only status ladder. So a figure reaches a browser as 200 with the envelope beside it,
 * a session or scope that grants nothing as the denial its closed reason code names (403), and a
 * financial source that did not answer as `unavailable` (503) carrying the source identity and the
 * retry that is safe. Nothing here sums, averages, percentages, paginates, defaults a period or
 * relabels a value: a second answer at the boundary would eventually disagree with the one the
 * report engine states, and the envelope's `valueStates` is what keeps a genuine zero, an unknown, a
 * withheld value and an unavailable source four different renderings.
 *
 * **The query it forwards.** The four Support reads share one search grammar, declared once in
 * `./query` from the field names the Support transports actually send. This handler reads it and
 * passes the result through untouched: the read owns the presets, the currencies, the amount range's
 * single-currency rule, the sortable fields, the default period and the page cap, and it reports the
 * filters it could not apply in the envelope's `actions` rather than dropping one silently. A
 * parameter the grammar cannot read as the read's own type is refused with the field path that
 * carried it, because the closed read result has no "your request was invalid" branch.
 *
 * **Who authorises, and what a refusal discloses.** Nobody here: scope is derived inside the service
 * from the `httpOnly` development-session cookie on every call, so no path, query string or body can
 * name a context the caller is not admitted to. A denial is answered as the denial the read produced,
 * never as an empty overview or a zero, and it carries no count, title, size or existence flag.
 *
 * Layering: `app/api → modules/data-service`. This file imports the service package root and nothing
 * deeper — never the synthetic store, never the report engine, never a component or a feature — and
 * it reaches no second transport.
 */

import type { NextRequest } from "next/server";

import { outcomeFromError, reads, toResponse } from "@/modules/data-service";

import { supportQueryFromSearch } from "./query";

/**
 * The store behind the service reads and writes through `node:fs`, and media preparation loads
 * Node-API native bindings, so this application runs on the Node runtime. Declaring it makes the
 * requirement unmissable: the edge runtime is not a supported execution model here.
 */
export const runtime = "nodejs";

/**
 * Admission, the selected context and the scenario clock are resolved per request, so the same URL
 * answers differently for two sessions and must never be served as a cached static answer.
 */
export const dynamic = "force-dynamic";

/**
 * The marker a refusal from this route carries where a mutation would carry its operation id.
 *
 * A `GET` performs no effect, so it has no operation to name and mints no identifier of its own.
 * `"read"` is the non-unique attempt marker every read result in the service already carries, which
 * is what keeps a failed read from being mistaken for a change someone could replay.
 */
const READ_ATTEMPT_MARKER = "read";

/**
 * Answers with the Support overview for the period, currency and filters the caller stated.
 *
 * Outcome set: `envelope` (200, the overview with its scope, source, revision, as-of instant,
 * coverage, value states and offered actions), `denied` (403, no admission or no context),
 * `unavailable` (503, the financial source did not answer) and — for a search parameter the shared
 * grammar cannot read — `invalid` (422) with a message keyed by the field path that carried it.
 *
 * A thrown fault is converted through the service's own error mapping rather than surfacing as a
 * framework error page: a store or medium fault becomes `unavailable` naming the source and the retry
 * that is safe, an unrecognised failure becomes `unknown` carrying only the attempt marker, and no
 * fault is answered with seeded data, a zero or a figure this file invented.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = supportQueryFromSearch(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, parsed.error));
  }

  try {
    return toResponse(await reads.support.readSupportOverview(parsed.value));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a
    // throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
