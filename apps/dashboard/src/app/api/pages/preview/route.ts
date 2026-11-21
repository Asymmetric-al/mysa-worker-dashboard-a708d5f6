/**
 * `GET /api/pages/preview` — the exact, currently authorised, inert preview of one acknowledged page
 * edition revision.
 */
import type { NextRequest } from "next/server";
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
// The store writes through node:fs and a preview resolves renditions from it, so this is never the edge
// runtime.
export const runtime = "nodejs";
// The read resolves the development session, the scenario clock and the edition's current pointers per
// request; a cached answer would outlive the revision it rendered.
export const dynamic = "force-dynamic";

const READ_ATTEMPT_ID = "read";

type PreviewQuery = Parameters<typeof reads.pages.readPreview>[0];

function previewQueryOf(params: URLSearchParams): PreviewQuery {
  return {
    variantId: params.get("variantId") ?? "",
    revisionId: params.get("revisionId") ?? "",
    candidateId: params.get("candidateId") ?? undefined,
    requestedLocale: params.get("requestedLocale") ?? undefined,
  };
}
/** The preview this session is authorised to see, or the refusal it is entitled to. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    return toResponse(await reads.pages.readPreview(previewQueryOf(new URL(request.url).searchParams)));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and
    // a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
