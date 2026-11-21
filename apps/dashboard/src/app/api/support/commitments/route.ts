/** `GET /api/support/commitments` — every commitment the source reports, in the one read envelope. */
import type { NextRequest } from "next/server";
import { outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { supportPageFromSearch } from "../query";
/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";
const READ_ATTEMPT_MARKER = "read";
/** Answers with one page of the subject's commitments and the partitions the read states beside it. */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = supportPageFromSearch(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return toResponse(refusedRead(READ_ATTEMPT_MARKER, parsed.error));
  }
  try {
    return toResponse(await reads.support.readCommitments(parsed.value));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
