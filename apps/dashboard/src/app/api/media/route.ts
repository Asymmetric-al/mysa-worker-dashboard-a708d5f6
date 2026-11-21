/**
 * `POST /api/media` — the browser transport for media registration and placement inside a draft.
 *
 * One request reaches exactly one named media mutation — `registerMediaAsset`, `replacePlacement` or
 * `removePlacement` — chosen by `payload.operation`, and is answered with one outcome from the closed
 * set: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown`. The API specification's media row (AAP 0.6.3) gives this path and the named inventory's
 * "Attach media" row (AAP 0.7.1) fixes those three writes and no others.
 *
 * Two prohibitions hold here, and neither is a matter of taste:
 *
 * - **No processing.** The image and video profiles (AAP 0.8.6), the fixed limits (AAP 0.8.7) and
 *   the whole preparation pipeline live behind the mutation, in `modules/media`: magic-byte typing so
 *   a name or extension never establishes type, the image path (metadata, orient, bounded resize,
 *   re-encode, then a check that no descriptive tag or source-filename trace survives) and the video
 *   path (container inspection, tag-free remux, then a post-remux check that rejects a rendition still
 *   reporting a descriptive tag). This file decodes nothing, measures nothing and admits nothing.
 * - **No store access.** Data crosses only through `@/modules/data-service`, which re-derives scope
 *   from the development-session cookie and re-verifies the claimed scope on every request.
 *
 * Rendition bytes have exactly one address — `GET /api/media/[assetId]/[rendition]`, which re-checks
 * scope per request, byte ranges included. This path therefore exports no read: a GET here is the
 * framework's own 405 rather than a second serving implementation that could skip that check.
 */
import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
// The store writes through node:fs and the preparation pipeline loads Node-API native bindings, so
// this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every request resolves the development session and re-evaluates the scenario clock afresh, and a
// prepared, restricted or unavailable asset must never be answered from a cached response.
export const dynamic = "force-dynamic";

/** The operation identity a refusal reports when the request's own body could not be read to name one. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: registerMediaAsset, replacePlacement or removePlacement.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  bodyUnreadable: "This request's body could not be read as UTF-8 JSON, so nothing was changed. Send the change again as a JSON object carrying operationId, scope, expectedRevision and payload.",
  // The image profile's own rule, stated in the same words the mutation states it, so the same fault
  // reads the same way whether the boundary or the service catches it.
  altTextRequired: "An image needs alternative text describing what it shows before it can be placed, so describe it and choose the file again.",
} as const;
// The transport bound, which is not a product limit
const BYTES_PER_MEBIBYTE = 1024 * 1024;
// The largest registration the profiles admit is a 100 MiB video, which JSON states as roughly
// 133 MiB of base64 text; its poster adds at most about 13 MiB and a caption track and transcript add
// text. 192 MiB therefore represents every legal image and video with headroom, and a request past it
// is refused with a readable reason instead of being read into memory and decoded. The image's 10 MiB
// and 8,000-pixel ceiling, the video's 100 MiB, 180-second and 1920x1080 ceiling, and the exactly-at
// -limit acceptance of each belong to the service, which measures real content rather than a claim.
//
// The same bound reaches the framework from one place: `next.config.ts` raises Next's proxy ceiling
// for request bodies to this 192 MiB through `experimental.proxyClientMaxBodySize`, which repeats
// the figure rather than deriving it. That key is global, so every path in this application is
// admitted up to the ceiling and not only this route: the bound below is the only bound on a media
// registration, and each other handler's own declared size is the only bound on its request body.
// The number is derived once, here, because this route's base64-carried 100 MiB video is the one
// request that legitimately needs it. The key is experimental, so a framework version change must
// re-check that the ceiling still applies before this handler sees the body: a proxy that fell back
// to its own 10 MB default would cut a legal registration off before `readBody` could measure it,
// leaving the constant below describing a bound nothing enforced.
const MAX_REQUEST_BYTES = 192 * BYTES_PER_MEBIBYTE;
/** States the transport bound in the words a caller reads when its request is past it. */
function requestTooLarge(): string {
  const mebibytes = MAX_REQUEST_BYTES / BYTES_PER_MEBIBYTE;
  return `This request is larger than the ${mebibytes} MiB a media registration may carry as JSON text. A 100 MiB video states as roughly 133 MiB of base64 before its poster and caption track are counted, so anything past this bound is refused here rather than decoded. Choose a smaller file, or prepare the video outside this application.`;
}
// One payload schema per mutation: what this boundary owns of that request
//
// The four-field envelope is the one shape guard every mutation runs, and each schema below is
// composed with it. A payload schema here is deliberately `loose`: it answers for the members this
// boundary acts on — the operation the body names, the kind of file, whether bytes are present, the
// identity of the placement — and forwards every other member untouched. The descriptor's closed
// field set, the length of each text, the profile limits and the tag check are declared once, in the
// mutation's own schema, which validates the payload again before any state change. A second full copy
// here would be a second declaration that drifts: one side would gain a field the other refused, and a
// caller would meet a boundary that contradicts the service. Each schema still validates its own
// `operation` literal, so a body serves exactly one mutation and no field map is ever posted through.
type RegisterMediaAssetPayload = Parameters<typeof mutations.media.registerMediaAsset>[1]["payload"];

type PlacementTargetPayload = Parameters<typeof mutations.media.replacePlacement>[1]["payload"];

type RegisterMediaAssetRequest = RegisterMediaAssetPayload & { readonly operation: "registerMediaAsset" };

type ReplacePlacementRequest = PlacementTargetPayload & { readonly operation: "replacePlacement" };

type RemovePlacementRequest = PlacementTargetPayload & { readonly operation: "removePlacement" };
// The kinds one registration may name, tied to the kinds the media module accepts so a kind added
// there fails this file's compilation instead of becoming unregisterable here.
const MEDIA_KINDS = ["image", "video"] as const satisfies readonly RegisterMediaAssetPayload["kind"][];

const MEDIA_OPERATIONS = ["registerMediaAsset", "replacePlacement", "removePlacement"] as const;

const uploadBytesSchema = z.looseObject({
  bytesBase64: z.string({ error: "Choose a file to upload." }).min(1, "Choose a file to upload."),
});

const altTextFieldSchema = z.string({ error: MESSAGES.altTextRequired }).optional();

const placementDescriptorSchema = z.looseObject({ altText: altTextFieldSchema }).optional();

const registerMediaAssetPayloadSchema: z.ZodType<RegisterMediaAssetRequest> = z
  .looseObject({
    operation: z.literal("registerMediaAsset", { error: MESSAGES.operationRequired }),
    kind: z.enum(MEDIA_KINDS, { error: "Choose whether this file is an image or a video." }),
    source: uploadBytesSchema,
    altText: altTextFieldSchema,
    placement: placementDescriptorSchema,
  })
  .superRefine((payload, ctx) => {
    // Alternative text is a property of the image profile rather than of one screen, and it may be
    // stated either with the file or on the placement the file fills. A video's credit and language
    // are attributes an author may leave unstated, so they are not required here: the media picker
    // admits them as optional and the mutation accepts them as optional, and a boundary that demanded
    // them would refuse a placement the rest of this application can make.
    const altText = payload.altText ?? payload.placement?.altText;
    if (payload.kind === "image" && altText === undefined) {
      ctx.addIssue({ code: "custom", path: ["altText"], message: MESSAGES.altTextRequired });
    }
  });
// A placement change names the draft revision it edits, and the placement it acts on
const placementTargetShape = {
  placementId: z.string({ error: "Name the placement this change acts on, so the draft's own placement list settles which one moves." }).min(1, "Name the placement this change acts on."),
  draftRevisionId: z.string().min(1, "Name the draft revision this change edits.").optional(),
  variantId: z.string().min(1, "Name the variant whose draft this change edits.").optional(),
} as const;

const replacePlacementPayloadSchema: z.ZodType<ReplacePlacementRequest> = z.looseObject({
  operation: z.literal("replacePlacement", { error: MESSAGES.operationRequired }),
  ...placementTargetShape,
  // The prepared asset that now fills the placement. An omitted asset keeps the one the placement
  // already shows, which is how a description is corrected without moving the media.
  assetId: z.string().min(1, "Name the asset that replaces this placement's media.").optional(),
  placement: placementDescriptorSchema,
});
// A removal detaches one placement from one draft. It states no asset identity, because no request on
// this path deletes an asset: an asset a release still references stays addressable through the
// rendition route, and a removal is not a withdrawal of anything published.
const removePlacementPayloadSchema: z.ZodType<RemovePlacementRequest> = z.looseObject({
  operation: z.literal("removePlacement", { error: MESSAGES.operationRequired }),
  ...placementTargetShape,
});

const registerMediaAssetBodySchema = mutationInputSchema(registerMediaAssetPayloadSchema);

const replacePlacementBodySchema = mutationInputSchema(replacePlacementPayloadSchema);

const removePlacementBodySchema = mutationInputSchema(removePlacementPayloadSchema);
// Reading the request
const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(MEDIA_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
  },
  { error: MESSAGES.bodyNotJson },
);

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
/**
 * Reads one request's body, stopping at the transport bound instead of buffering whatever arrives.
 *
 * A declared length over the bound is refused before a byte is read, and a request that declares no
 * length (or understates it) is counted as it streams and cancelled the moment it crosses the bound,
 * so an oversized registration costs a refusal rather than the memory and time to hold it. Nothing
 * here throws: every way the body can fail to become a parsed JSON value is one of the two refusals.
 */
async function readBody(request: NextRequest): Promise<RequestBody> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const declaredBytes = Number(declaredLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_REQUEST_BYTES) {
      return { kind: "oversized" };
    }
  }
  const stream = request.body;
  if (stream === null) {
    return { kind: "unreadable" };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
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
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
/** Refuses a request whose body never became a value, through the one mapper every answer crosses. */
function refuseBody(operationId: string, message: string): Response {
  return toResponse(outcomeFromError(operationId, new ZodError([{ code: "custom", path: [], message, input: undefined }])));
}
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}
async function dispatch<P extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<P>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<P, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    // The validated envelope travels as it arrived: scope is a claim the service verifies against the
    // session's admitted memberships, and `expectedRevision` the revision the caller actually read, so
    // neither is re-derived, widened or defaulted here.
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    // An exception here is a defect rather than a presentation: the service answers every refusal as an
    // outcome, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(operationId, error));
  }
}
/**
 * Applies one named media mutation — `registerMediaAsset`, `replacePlacement` or `removePlacement` —
 * and answers with one outcome of the closed eight. A failed image or video changes nothing, so the
 * draft's prose and its successful placements stand as they were.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await readBody(request);
  if (body.kind === "oversized") {
    return refuseBody(UNIDENTIFIED_ATTEMPT, requestTooLarge());
  }
  if (body.kind === "unreadable") {
    return refuseBody(UNIDENTIFIED_ATTEMPT, MESSAGES.bodyUnreadable);
  }
  const raw = body.value;
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  const sessionId = sessionIdOf(request);
  switch (claimed.data.payload.operation) {
    case "registerMediaAsset":
      return dispatch(registerMediaAssetBodySchema, raw, operationId, (input) => mutations.media.registerMediaAsset(sessionId, input));
    case "replacePlacement":
      return dispatch(replacePlacementBodySchema, raw, operationId, (input) => mutations.media.replacePlacement(sessionId, input));
    case "removePlacement":
      return dispatch(removePlacementBodySchema, raw, operationId, (input) => mutations.media.removePlacement(sessionId, input));
    default:
      // Unreachable: the three names above are the closed set the discriminant schema admits, so a
      // fourth media mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled media mutation");
  }
}
