/**
 * `GET /api/media/[assetId]/[rendition]` — the only address a rendition has, and the only path by which a
 * media byte reaches a browser: the whole rendition or the requested range as 200, 206 or 416, and otherwise
 * the shared mapper's one refusal or outage, carrying no byte of the asset.
 */
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
// A rendition's bytes are read through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every request re-authorises against the current session, scenario and scenario clock.
export const dynamic = "force-dynamic";

const READ_ATTEMPT_ID = "read";

interface MediaRenditionParams {
  readonly assetId: string;
  readonly rendition: string;
}
function sendableBody(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = bytes.buffer;
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength);
  }
  return bytes.slice();
}
/** Serves one authorised rendition to the caller entitled to it right now. */
export async function GET(request: Request, context: { params: Promise<MediaRenditionParams> }): Promise<Response> {
  try {
    // Next 16 hands the dynamic segments as a promise, so they are awaited before the read sees them.
    const { assetId, rendition } = await context.params;
    // The second segment reaches the read unresolved on purpose. The application publishes a rendition's own
    // identity at this address (`/api/media/<assetId>/<renditionId>`, e.g. `rendition-video-welcome-captions`),
    // and a bare purpose resolves here too; the read owns that closed set and answers anything outside it with
    // the same refusal it gives an unreadable asset. An allow-list of purpose names in this handler would break
    // every playback, poster and caption address the application itself emits, and would put a second authority
    // in front of a decision the read already makes uniformly.
    const result = await reads.media.readMediaAsset({
      assetId,
      rendition,
      rangeHeader: request.headers.get("range"),
    });
    if (result.kind !== "envelope") {
      return toResponse(result);
    }
    // The read's own status and complete header set, carried rather than derived: it owns the one cache
    // policy this application sets and the content range of a partial response. The bytes and those wire
    // facts sit in the envelope's `data`, because every read here answers with the one envelope shape.
    const served = result.envelope.data;
    return new Response(sendableBody(served.bytes), {
      status: served.status,
      headers: served.headers,
    });
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
