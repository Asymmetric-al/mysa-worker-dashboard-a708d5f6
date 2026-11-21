/** `GET /api/support/gifts` — the gifts ledger for one bounded filter set, in the one read envelope. */
import type { NextRequest } from "next/server";
import { outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { supportQueryFromSearch } from "../query";
/** The store behind the service reads and writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** The read resolves the development session, the selected context and the scenario instant per request, so the same URL answers differently for two sessions and is never cached. */
export const dynamic = "force-dynamic";
const READ_ATTEMPT_MARKER = "read";
/** Answers with one page of the gifts ledger for the filter set the caller stated. */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = supportQueryFromSearch(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return toResponse(refusedRead(READ_ATTEMPT_MARKER, parsed.error));
  }
  try {
    return toResponse(await reads.support.readGifts(parsed.value));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
