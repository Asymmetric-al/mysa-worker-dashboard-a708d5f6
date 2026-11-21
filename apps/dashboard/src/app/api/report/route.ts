/**
 * `POST /api/report` — one of the four fixed reports, in JSON, from one query and one snapshot.
 *
 * **Why this is a `POST` and a read.** The query is a period, a currency, an amount range, an
 * attribution, a designation, a search term, a sort and a page window. In a URL it would be
 * hand-editable and truncatable on the way, and it would be a second copy of the state the screen
 * already holds; as a body it is the very object the client's cache key carries, so the key cannot
 * omit a field the request sends. It performs no state change, so it states no `operationId` and
 * mints none: there is nothing to replay and no effect whose fate could be uncertain.
 *
 * **Which report, and no substitution.** The body is `{ query: { reportId, ...filters }, snapshotId }`.
 * `reportId` is one of the four identities this application computes, validated here against the
 * closed list, and it is split out of the query because `reads.support.readReport` takes it as its
 * own parameter. An identity outside the four is refused as `invalid` with the field path that
 * carried it — never replaced by another report, because substituting one report for a name the
 * caller typed would answer a question nobody asked, with figures that look like the answer. The
 * query may also repeat the four references of the scope it was computed under, which the grammar
 * accepts and never forwards: the service derives the scope from the development session, so no
 * caller names a context by writing one here.
 *
 * **The snapshot.** The response states the snapshot the service computed: the query it resolved, the
 * scope, the currencies, the period, the one named basis, the coverage and the as-of instant. That is
 * what the chart, the table, the drilldown, the CSV and the print view all read, which is why they
 * agree structurally rather than by careful copying. The body's `snapshotId` is the caller's own cache
 * discriminator for the query it is sending — the handle the screen and the download beside it share —
 * so it is accepted and never forwarded: the identity a response carries is the service's own.
 *
 * **What it never does.** It chooses no status (`toResponse` is the only ladder), wraps no body,
 * computes no summary, series, cell, percentage or total, fills no missing period with a zero, clamps
 * no page and defaults no period. A report the engine refuses to compute becomes `unavailable` with
 * the source identity the service states, and a filter the engine could not apply is stated in the
 * envelope's `actions` with its reason rather than dropped. A body field this transport cannot read as
 * the read's own type is refused with the field path that carried it.
 *
 * **Who authorises.** The service: `readReport` re-derives the scope from the development-session
 * cookie on every request and decides what this caller may read, so no scope in the body selects a
 * record. A denial (403) carries no count, title, size or existence flag — never an empty report.
 *
 * Layering: `app/api → modules/data-service`. The body grammar and the filter reduction are the two
 * helpers the Support family shares (`../support/query`), imported rather than restated so the report
 * body and the export body cannot drift into two descriptions of one query. No store, no report
 * engine, no component and no feature module is imported, and there is no second transport.
 */

import type { NextRequest } from "next/server";

import { outcomeFromError, reads, toResponse } from "@/modules/data-service";

import { reportRequestSchema, supportQueryOf } from "../support/query";

/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";

/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";

/**
 * The marker a refusal from this route carries where a mutation would carry its operation id.
 *
 * This `POST` reads; it changes nothing, so it has no attempt identity of its own and mints none.
 * `"read"` is the non-unique marker every read result in the service already carries, which keeps a
 * failed read from being mistaken for a change someone could replay.
 */
const READ_ATTEMPT_MARKER = "read";

/**
 * Computes one of the four fixed reports for the query the body states.
 *
 * Outcome set: `envelope` (200, the `ReportResult` inside the read envelope, with its snapshot, scope,
 * coverage, value states and offered actions), `denied` (403) and `unavailable` (503) exactly as the
 * read answered, and `invalid` (422) for a body the grammar refuses — a foreign report identity, a
 * period without both ends, a currency that is neither a code nor a selection — keyed by the field
 * path that carried it.
 *
 * A thrown fault is mapped by the service's own error handling rather than escaping as a framework
 * error page: a store or medium fault becomes `unavailable` naming the source and the retry that is
 * safe, and anything unrecognised becomes `unknown` carrying only the attempt marker. No fault is
 * answered with an empty report, a zero or a figure this file invented.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = reportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, parsed.error));
  }

  const { reportId } = parsed.data.query;

  try {
    return toResponse(await reads.support.readReport(reportId, supportQueryOf(parsed.data.query)));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a
    // throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
