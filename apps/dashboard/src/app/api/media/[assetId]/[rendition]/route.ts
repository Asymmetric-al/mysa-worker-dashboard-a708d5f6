/**
 * `GET /api/media/[assetId]/[rendition]` — the only address a rendition has.
 *
 * **What it serves.** One rendition of one asset: an image's display still, or a video's playback
 * stream, poster, caption track or transcript. The second segment is either one of those five purposes
 * or a rendition's opaque identity, and `reads.media.readMediaAsset` resolves it against the asset's own
 * records — matching a purpose exactly and a rendition identity only within this asset, so one asset's
 * identity cannot address another's bytes. Nothing is parsed, repaired or case-folded here.
 *
 * **Who authorises.** The read does, on every request, in this order: the session, the asset, the
 * asset's own recorded scope through the one permission question, the requested segment, and only then
 * the serving decision, which receives the `Range` header verbatim or `null`. Playback, poster, captions,
 * transcript and every byte range are one decision made afresh, so a restricted asset stops being served
 * on the very next read. This file adds no check, caches no decision and knows no asset, scope or file:
 * a refused request and an absent asset answer identically, carrying no count, title, size, media type or
 * existence flag.
 *
 * **The success branch is bytes, not an envelope.** This is the one documented exception to the read
 * envelope contract: a byte stream carries no per-field states, no period statement and no available
 * actions. The response is assembled from the read's own answer and nothing else — its `bytes` as the
 * body, its `status` (200 for the whole entity, 206 for the requested window, 416 for an *authorised*
 * reader whose range names no byte) and its complete `headers` set (the cache policy, the media type, the
 * body's length, `accept-ranges` and the `content-range` of a partial or unsatisfiable response). Nothing
 * is JSON-wrapped, re-derived, truncated or re-authorised, because the read already authorised this
 * request, range included, and computed those facts.
 *
 * **The failure branches are the ordinary ones.** A denial and an unavailable source are not byte
 * responses at all: they are the read's own `denied` and `unavailable` results, and they leave through
 * `toResponse` unchanged, so a 403 carries no size and a 503 names the source that could not answer
 * rather than a zero-length body. A thrown fault is answered the same way, with the `"read"` attempt
 * marker, since a read has no effect to replay.
 *
 * **What it never does.** It never echoes a file name, a `bytesRef` or a path, never serves the uploaded
 * original — only renditions have an address — and never claims that serving these bytes released,
 * delivered or read anything. It sets no header of its own, so no second statement of the cache policy
 * can drift from the media module's.
 *
 * **Layering.** `app/api → modules/data-service`. This file imports the service package root and nothing
 * deeper: never the synthetic store, never the media module, never a component or a feature.
 */

import { outcomeFromError, reads, toResponse } from "@/modules/data-service";

// A rendition's bytes are read through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every request re-authorises against the current session, scenario and scenario clock.
export const dynamic = "force-dynamic";

/**
 * The marker a refusal from this route carries where a mutation would carry its operation id.
 *
 * A `GET` performs no effect, so it has no operation to name and mints no identifier of its own.
 * `"read"` is the non-unique attempt marker every read result in the service already carries, which is
 * what keeps a failed read from being mistaken for a change someone could replay.
 */
const READ_ATTEMPT_ID = "read";

/** The two segments the rendition address carries, exactly as the request stated them. */
interface MediaRenditionParams {
  readonly assetId: string;
  readonly rendition: string;
}

/**
 * The body to hand the response: the read's own view wherever its bytes sit in an `ArrayBuffer`, which is
 * every case this runtime produces, and a copy otherwise.
 *
 * The copy is not a transformation. A `SharedArrayBuffer`-backed view cannot be a response body, so it is
 * copied to send it; nothing else about the bytes changes, and no path takes a copy on the ordinary one.
 * The read already narrowed these bytes to the requested window and stated that window's length in the
 * headers, so no length is recomputed here.
 */
function sendableBody(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = bytes.buffer;
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength);
  }
  return bytes.slice();
}

/**
 * Serves one authorised rendition to the caller entitled to it right now.
 *
 * The `Range` header travels exactly as it arrived: a malformed or unit-less one is not an error — RFC
 * 9110 permits a server to ignore it, and the repository's one parser does — so such a request is served
 * whole rather than truncated. An unsatisfiable range on an authorised entity answers 416 with no body
 * and the entity's size in its own content range, which is not a refusal: the reader may have these
 * bytes and the source is up.
 */
export async function GET(
  request: Request,
  context: { params: Promise<MediaRenditionParams> },
): Promise<Response> {
  try {
    // Next 16 hands the dynamic segments as a promise, so they are awaited before the read sees them.
    const { assetId, rendition } = await context.params;
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
