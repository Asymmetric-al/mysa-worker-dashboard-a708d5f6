/**
 * `POST /api/export` — the whole query as a CSV file, plus the print model of the same result.
 *
 * `reads.export.readExport` computes the same report the screen rendered, so the file holds every
 * authorised row rather than the page on screen, and it carries the grain, basis, currency, period,
 * coverage and snapshot records the one CSV writer states for itself. The body is the report body,
 * read by the same grammar and reduced by the same helper (`../support/query`), so the two artifacts
 * of a query can only be produced from one reading of it.
 *
 * The file travels inside the read's envelope rather than as a `text/csv` response body: the browser
 * saves the service's own text under the filename the service chose, and every answer — the file, a
 * denial, an unavailable source, a refused body — crosses the one `toResponse` mapper. That is what
 * keeps a refusal from arriving as an empty or header-only file, which a reader would take for a zero.
 *
 * Answers `envelope` with the file; `invalid` with per-field messages for a body the grammar refused;
 * `denied`, with no count and no total, when the caller holds no export permission for the context;
 * `unavailable` when the source cannot be read; `unknown` when a fault's fate is not known. Nothing is
 * written, so no operation identity is minted and none is expected.
 */
import type { NextRequest } from "next/server";
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { exportRequestSchema, supportQueryOf } from "../support/query";
/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";

const READ_ATTEMPT_MARKER = "read";
/** Takes the query the body states out of the application as a CSV file: answers `envelope` with it, or `invalid`, `denied`, `unavailable` or `unknown`, and writes no record. */
export async function POST(request: NextRequest): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = exportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, parsed.error));
  }
  // The report body's page window is accepted so one body serves both posts, and never forwarded: an
  // export is the whole query, and a forwarded window would quietly make the file one page of it.
  const unpaged = { ...parsed.data.query, page: undefined };
  try {
    return toResponse(await reads.export.readExport(supportQueryOf(unpaged)));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a
    // throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
