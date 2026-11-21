/**
 * `POST /api/export` — the whole query as a CSV file, plus the print model of the same result.
 *
 * **What it serves.** `reads.export.readExport` runs the same `runReport` the screen ran, for the same
 * filters, and writes the whole authorised row set with the application's one CSV writer and one print
 * model. The envelope's `data` therefore carries the file text, its suggested filename, its row count,
 * the snapshot facts and the print model — all produced on the server — so the browser downloads text
 * it did not assemble and states metadata it did not derive. A file holding only the loaded page would
 * answer a different question from the screen it was taken from, which is why the page window is not
 * applied here even though the report body may carry one.
 *
 * **The body is the report body.** `{ query, snapshotId }`, the same object `POST /api/report` reads,
 * reduced by the same helper, so the two paths cannot drift into two descriptions of one query. The
 * export transport posts the snapshot query it is exporting, and that query repeats two members no
 * export reads: `reportId` and `scope`. Both are accepted and neither is forwarded — an export is the
 * whole-query file of one ledger query rather than one of the four fixed reports, so the read selects
 * its own identity, and the scope is the service's to derive from the development session. `snapshotId`
 * is the caller's own cache discriminator and is dropped for the same reason the report path drops it:
 * the snapshot a response states is the one the service computed.
 *
 * **Nothing is assembled here.** No row is re-ordered, no cell re-quoted, no byte-order mark added and
 * no row count computed: the writer owns the quoting, the tab prefix that neutralises a
 * formula-leading cell, and the grain, basis, currency, period, coverage and snapshot header rows. A
 * second pass over that text in a transport would either double-prefix a cell or silently change what
 * the file means.
 *
 * **Who authorises, and what a refusal discloses.** Export permission is re-checked inside the read
 * before any record is opened, so a caller without it receives a denial (403) with no count and no
 * total and learns nothing about what the query would hold. Withheld values never reach the file,
 * directly or by subtraction, and an unknown or incomplete amount keeps its own wording rather than
 * becoming a zero or an empty cell.
 *
 * Layering: `app/api → modules/data-service`. The body grammar and the filter reduction are the two
 * helpers the Support family shares (`../support/query`); no store, no report engine, no CSV writer, no
 * component and no feature module is imported here, and there is no second transport.
 */

import type { NextRequest } from "next/server";

import { outcomeFromError, reads, toResponse } from "@/modules/data-service";

import { exportRequestSchema, supportQueryOf } from "../support/query";

/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";

/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";

/**
 * The marker a refusal from this route carries where a mutation would carry its operation id.
 *
 * This `POST` performs no state change, so it has no attempt identity and mints none. `"read"` is the
 * non-unique marker every read result in the service already carries, which keeps a failed export from
 * being mistaken for a change someone could replay — and a repeated request is not a second effect
 * either, but the same file from the same query.
 */
const READ_ATTEMPT_MARKER = "read";

/**
 * Takes the query the body states out of the application as a CSV file.
 *
 * Outcome set: `envelope` (200, carrying the file text, the filename, the row count, the snapshot
 * metadata and the print model), `denied` (403, export permission absent, with no count and no total)
 * and `unavailable` (503) exactly as the read answered, and `invalid` (422) for a body the grammar
 * refuses, keyed by the field path that carried it.
 *
 * A thrown fault is mapped by the service's own error handling rather than escaping as a framework
 * error page: a store or medium fault becomes `unavailable` naming the source and its safe retry, and
 * anything unrecognised becomes `unknown` carrying only the attempt marker. No fault is answered with
 * an empty file, a zero row count or a partially written export.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = exportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, parsed.error));
  }

  try {
    return toResponse(await reads.export.readExport(supportQueryOf(parsed.data.query)));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a
    // throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
