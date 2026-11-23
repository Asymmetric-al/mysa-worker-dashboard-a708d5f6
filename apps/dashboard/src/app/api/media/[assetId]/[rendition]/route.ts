import { routeMethods } from "@/app/api/methods";
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { READ_ATTEMPT } from "../../../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type MediaRenditionParams = { readonly assetId: string; readonly rendition: string };
const sendableBody = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => (bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes.slice());
/** Serves one authorised rendition to the caller entitled to it right now. */
async function readRendition(request: Request, context: { params: Promise<MediaRenditionParams> }): Promise<Response> {
  const { assetId, rendition } = await context.params;
  try {
    const result = await reads.media.readMediaAsset({ assetId, rendition, rangeHeader: request.headers.get("range") });
    if (result.kind !== "envelope") return toResponse(result);
    const served = result.envelope.data;
    return new Response(sendableBody(served.bytes), { status: served.status, headers: served.headers });
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT, error));
  }
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readRendition });
