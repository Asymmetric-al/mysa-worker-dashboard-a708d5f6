/** `POST /api/media` — the browser transport for media registration and placement inside a draft. */
import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
import { UNIDENTIFIED_ATTEMPT, dispatch, operationIdentityOf } from "../handler";
// The store writes through node:fs and the preparation pipeline loads Node-API native bindings, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every request resolves the development session and re-evaluates the scenario clock afresh, and a prepared, restricted or unavailable asset must never be answered from a cached response.
export const dynamic = "force-dynamic";
const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: registerMediaAsset, replacePlacement or removePlacement.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  bodyUnreadable: "This request's body could not be read as UTF-8 JSON, so nothing was changed. Send the change again as a JSON object carrying operationId, scope, expectedRevision and payload.",
  // The image profile's own rule, stated in the same words the mutation states it, so the same fault reads the same way whether the boundary or the service catches it.
  altTextRequired: "An image needs alternative text describing what it shows before it can be placed, so describe it and choose the file again.",
} as const;
// The transport bound, which is not a product limit
const BYTES_PER_MEBIBYTE = 1024 * 1024;
// The largest registration the profiles admit is a 100 MiB video, which JSON states as roughly 133 MiB of base64 text; its poster adds at most about 13 MiB and a caption track and transcript add text. 192 MiB therefore represents every legal image and video with headroom, and a request past it
// is refused with a readable reason instead of being read into memory and decoded. The image's 10 MiB and 8,000-pixel ceiling, the video's 100 MiB, 180-second and 1920x1080 ceiling, and the exactly-at -limit acceptance of each belong to the service, which measures real content rather than a claim.
// The same bound reaches the framework from one place: `next.config.ts` raises Next's proxy ceiling for request bodies to this 192 MiB through `experimental.proxyClientMaxBodySize`, which repeats the figure rather than deriving it. That key is global, so every path in this application is
// admitted up to the ceiling and not only this route: the bound below is the only bound on a media registration, and each other handler's own declared size is the only bound on its request body. The number is derived once, here, because this route's base64-carried 100 MiB video is the one
// request that legitimately needs it. The key is experimental, so a framework version change must re-check that the ceiling still applies before this handler sees the body: a proxy that fell back to its own 10 MB default would cut a legal registration off before `readBody` could measure it,
// leaving the constant below describing a bound nothing enforced.
const MAX_REQUEST_BYTES = 192 * BYTES_PER_MEBIBYTE;
function requestTooLarge(): string {
  const mebibytes = MAX_REQUEST_BYTES / BYTES_PER_MEBIBYTE;
  return `This request is larger than the ${mebibytes} MiB a media registration may carry as JSON text. A 100 MiB video states as roughly 133 MiB of base64 before its poster and caption track are counted, so anything past this bound is refused here rather than decoded. Choose a smaller file, or prepare the video outside this application.`;
}
// One payload schema per mutation: what this boundary owns of that request  The four-field envelope is the one shape guard every mutation runs, and each schema below is composed with it. A payload schema here is deliberately `loose`: it answers for the members this
// boundary acts on — the operation the body names, the kind of file, whether bytes are present, the identity of the placement — and forwards every other member untouched. The descriptor's closed field set, the length of each text, the profile limits and the tag check are declared once, in the
// mutation's own schema, which validates the payload again before any state change. A second full copy here would be a second declaration that drifts: one side would gain a field the other refused, and a caller would meet a boundary that contradicts the service. Each schema still validates its own
// `operation` literal, so a body serves exactly one mutation and no field map is ever posted through.
type RegisterMediaAssetPayload = Parameters<typeof mutations.media.registerMediaAsset>[1]["payload"];
type PlacementTargetPayload = Parameters<typeof mutations.media.replacePlacement>[1]["payload"];
type RegisterMediaAssetRequest = RegisterMediaAssetPayload & { readonly operation: "registerMediaAsset" };
type ReplacePlacementRequest = PlacementTargetPayload & { readonly operation: "replacePlacement" };
type RemovePlacementRequest = PlacementTargetPayload & { readonly operation: "removePlacement" };
// The kinds one registration may name, tied to the kinds the media module accepts so a kind added there fails this file's compilation instead of becoming unregisterable here.
const MEDIA_KINDS = ["image", "video"] as const satisfies readonly RegisterMediaAssetPayload["kind"][];
const MEDIA_OPERATIONS = ["registerMediaAsset", "replacePlacement", "removePlacement"] as const;
const uploadBytesSchema = z.looseObject({ bytesBase64: z.string({ error: "Choose a file to upload." }).min(1, "Choose a file to upload.") });
const altTextFieldSchema = z.string({ error: MESSAGES.altTextRequired }).optional();
const placementDescriptorSchema = z.looseObject({ altText: altTextFieldSchema }).optional();
const registerMediaAssetPayloadSchema: z.ZodType<RegisterMediaAssetRequest> = z
  .looseObject({ operation: z.literal("registerMediaAsset", { error: MESSAGES.operationRequired }), kind: z.enum(MEDIA_KINDS, { error: "Choose whether this file is an image or a video." }), source: uploadBytesSchema, altText: altTextFieldSchema, placement: placementDescriptorSchema })
  .superRefine((payload, ctx) => {
    // Alternative text is a property of the image profile rather than of one screen, and it may be stated either with the file or on the placement the file fills. A video's credit and language are attributes an author may leave unstated, so they are not required here: the media picker
    // admits them as optional and the mutation accepts them as optional, and a boundary that demanded them would refuse a placement the rest of this application can make.
    const altText = payload.altText ?? payload.placement?.altText;
    if (payload.kind === "image" && altText === undefined) ctx.addIssue({ code: "custom", path: ["altText"], message: MESSAGES.altTextRequired });
  });
const placementTargetShape = {
  placementId: z.string({ error: "Name the placement this change acts on, so the draft's own placement list settles which one moves." }).min(1, "Name the placement this change acts on."),
  draftRevisionId: z.string().min(1, "Name the draft revision this change edits.").optional(),
  variantId: z.string().min(1, "Name the variant whose draft this change edits.").optional(),
} as const;
const replacePlacementPayloadSchema: z.ZodType<ReplacePlacementRequest> = z.looseObject({
  operation: z.literal("replacePlacement", { error: MESSAGES.operationRequired }),
  ...placementTargetShape,
  // The prepared asset that now fills the placement. An omitted asset keeps the one the placement already shows, which is how a description is corrected without moving the media.
  assetId: z.string().min(1, "Name the asset that replaces this placement's media.").optional(),
  placement: placementDescriptorSchema,
});
// A removal detaches one placement from one draft. It states no asset identity, because no request on this path deletes an asset: an asset a release still references stays addressable through the rendition route, and a removal is not a withdrawal of anything published.
const removePlacementPayloadSchema: z.ZodType<RemovePlacementRequest> = z.looseObject({ operation: z.literal("removePlacement", { error: MESSAGES.operationRequired }), ...placementTargetShape });
const registerMediaAssetBodySchema = mutationInputSchema(registerMediaAssetPayloadSchema);
const replacePlacementBodySchema = mutationInputSchema(replacePlacementPayloadSchema);
const removePlacementBodySchema = mutationInputSchema(removePlacementPayloadSchema);
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(MEDIA_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
/** What reading one request's body produced: the parsed value, or the reason there is none. */
type RequestBody = { readonly kind: "parsed"; readonly value: unknown } | { readonly kind: "oversized" } | { readonly kind: "unreadable" };
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
function joinChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
/** Reads one request's body, stopping at the transport bound instead of buffering whatever arrives. */
async function readBody(request: NextRequest): Promise<RequestBody> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const declaredBytes = Number(declaredLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_REQUEST_BYTES) return { kind: "oversized" };
  }
  const stream = request.body;
  if (stream === null) return { kind: "unreadable" };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { kind: "oversized" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "unreadable" };
  }
  try {
    const decoded: unknown = JSON.parse(utf8Decoder.decode(joinChunks(chunks, receivedBytes)));
    return { kind: "parsed", value: decoded };
  } catch {
    return { kind: "unreadable" };
  }
}
/** Refuses a request whose body never became a value, through the one mapper every answer crosses. */
function refuseBody(operationId: string, message: string): Response {
  return toResponse(outcomeFromError(operationId, new ZodError([{ code: "custom", path: [], message, input: undefined }])));
}
/** Applies one named media mutation — `registerMediaAsset`, `replacePlacement` or `removePlacement` — and answers with one outcome of the closed eight. */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await readBody(request);
  if (body.kind === "oversized") return refuseBody(UNIDENTIFIED_ATTEMPT, requestTooLarge());
  if (body.kind === "unreadable") return refuseBody(UNIDENTIFIED_ATTEMPT, MESSAGES.bodyUnreadable);
  const raw = body.value;
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) return toResponse(outcomeFromError(operationId, claimed.error));
  const sessionId = sessionIdOf(request);
  switch (claimed.data.payload.operation) {
    case "registerMediaAsset":
      return dispatch(registerMediaAssetBodySchema, raw, operationId, "operation", (input) => mutations.media.registerMediaAsset(sessionId, input));
    case "replacePlacement":
      return dispatch(replacePlacementBodySchema, raw, operationId, "operation", (input) => mutations.media.replacePlacement(sessionId, input));
    case "removePlacement":
      return dispatch(removePlacementBodySchema, raw, operationId, "operation", (input) => mutations.media.removePlacement(sessionId, input));
    default:
      // Unreachable: the three names above are the closed set the discriminant schema admits, so a fourth media mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled media mutation");
  }
}
