/**
 * `GET /api/support` — the Support overview, in the one read envelope.
 */
import type { NextRequest } from "next/server";
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { supportQueryFromSearch } from "./query";
/** The store behind the service reads and writes through `node:fs`, and media preparation loads Node-API native bindings, so this application runs on the Node runtime. */
export const runtime = "nodejs";
/** Admission, the selected context and the scenario clock are resolved per request, so the same URL answers differently for two sessions and must never be served as a cached static answer. */
export const dynamic = "force-dynamic";

const READ_ATTEMPT_MARKER = "read";
/** Answers with the Support overview for the period, currency and filters the caller stated. */
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
