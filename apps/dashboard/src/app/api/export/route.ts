/** `POST /api/export` — the whole query as a CSV file, plus the print model of the same result. */
import type { NextRequest } from "next/server";
import { outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { exportRequestSchema, supportQueryOf } from "../support/query";
import { jsonBodyOf } from "../handler";
/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";
const READ_ATTEMPT_MARKER = "read";
/** Takes the query the body states out of the application as a CSV file: answers `envelope` with it, or `invalid`, `denied`, `unavailable` or `unknown`, and writes no record. */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = exportRequestSchema.safeParse(body);
  if (!parsed.success) {
    // A body the grammar refuses is the request's own fault, not a source that did not answer: it is answered as the read's refused request, which carries the same field-keyed `invalid` body a mutation's malformed payload earns.
    return toResponse(refusedRead(READ_ATTEMPT_MARKER, parsed.error));
  }
  // The report body's page window is accepted so one body serves both posts, and never forwarded: an export is the whole query, and a forwarded window would quietly make the file one page of it.
  const unpaged = { ...parsed.data.query, page: undefined };
  try {
    return toResponse(await reads.export.readExport(supportQueryOf(unpaged)));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
