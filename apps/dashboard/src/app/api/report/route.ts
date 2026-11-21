/** `POST /api/report` — one of the four fixed reports, in JSON, from one query and one snapshot. */
import type { NextRequest } from "next/server";
import { outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
// The report and the export post bodies share one grammar, so the two artifacts of a query can only be produced from the same reading of it.
import { reportRequestSchema, supportQueryOf } from "../support/query";
import { jsonBodyOf } from "../handler";
/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";
const READ_ATTEMPT_MARKER = "read";
/** The body of either documented shape: the `{ query, snapshotId }` wrapper the report hook sends, or the bare query a direct caller sends. */
function requestBodyOf(body: unknown): unknown {
  if (typeof body === "object" && body !== null && !Array.isArray(body) && Object.hasOwn(body, "query")) {
    return body;
  }
  return { query: body };
}
/** Computes one of the four fixed reports for the query the body states. */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = reportRequestSchema.safeParse(requestBodyOf(body));
  if (!parsed.success) {
    // A body the grammar refuses is the request's own fault, not a source that did not answer: it is answered as the read's refused request, which carries the same field-keyed `invalid` body a mutation's malformed payload earns.
    return toResponse(refusedRead(READ_ATTEMPT_MARKER, parsed.error));
  }
  const { reportId } = parsed.data.query;
  try {
    return toResponse(await reads.support.readReport(reportId, supportQueryOf(parsed.data.query)));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
