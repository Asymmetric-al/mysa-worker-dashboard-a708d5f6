/**
 * `POST /api/report` — one of the four fixed reports, in JSON, from one query and one snapshot.
 */
import type { NextRequest } from "next/server";
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { reportRequestSchema, supportQueryOf } from "../support/query";
/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";

const READ_ATTEMPT_MARKER = "read";
/** Computes one of the four fixed reports for the query the body states. */
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
