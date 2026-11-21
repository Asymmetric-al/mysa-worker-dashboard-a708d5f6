/**
 * `POST /api/export` — the whole query as a CSV file, plus the print model of the same result.
 */
import type { NextRequest } from "next/server";
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { exportRequestSchema, supportQueryOf } from "../support/query";
/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";

const READ_ATTEMPT_MARKER = "read";
/** Takes the query the body states out of the application as a CSV file. */
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
