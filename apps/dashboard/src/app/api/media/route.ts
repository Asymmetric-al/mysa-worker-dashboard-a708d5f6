import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { routeMethods } from "@/app/api/methods";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { altTextRequired } from "@/modules/media/profile";
import { UNIDENTIFIED_ATTEMPT, claimedBodyRoute, dispatch, readRequestBody, type ClaimedWrite } from "../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: registerMediaAsset, replacePlacement or removePlacement.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  bodyUnreadable: "This request's body could not be read as UTF-8 JSON, so nothing was changed. Send the change again as a JSON object carrying operationId, scope, expectedRevision and payload.",
  altTextNotText: "State the alternative text as text, so it can be read in place of the media.",
  sectionRequired: "State the section this media is placed in.",
} as const;
const BYTES_PER_MEBIBYTE = 1024 * 1024;
const MAX_REQUEST_MIB = 192;
const MAX_REQUEST_BYTES = MAX_REQUEST_MIB * BYTES_PER_MEBIBYTE;
const OVERSIZED_MESSAGE = `This request is larger than the ${MAX_REQUEST_MIB} MiB a media registration may carry as JSON text. A 100 MiB video states as roughly 133 MiB of base64 before its poster and caption track are counted, so anything past this bound is refused here rather than decoded. Choose a smaller file, or prepare the video outside this application.`;
type RegisterMediaAssetPayload = Parameters<typeof mutations.media.registerMediaAsset>[1]["payload"];
type PlacementTargetPayload = Parameters<typeof mutations.media.replacePlacement>[1]["payload"];
const MEDIA_KINDS = ["image", "video"] as const satisfies readonly RegisterMediaAssetPayload["kind"][];
const MEDIA_OPERATIONS = ["registerMediaAsset", "replacePlacement", "removePlacement"] as const;
const uploadBytesSchema = z.looseObject({ bytesBase64: z.string({ error: "Choose a file to upload." }).min(1, "Choose a file to upload.") });
const altTextFieldSchema = z.string({ error: MESSAGES.altTextNotText }).trim().optional();
// A registration states the alternative text it is placing, and a stated null states none: the value is judged where the kind is known, so the refusal names the medium it is about rather than a type.
const registeredAltTextFieldSchema = z.string({ error: MESSAGES.altTextNotText }).trim().nullable().optional();
const placementDescriptorSchema = z.looseObject({ altText: altTextFieldSchema }).optional();
const registeredPlacementDescriptorSchema = z.looseObject({ altText: registeredAltTextFieldSchema }).optional();
// The section a registration binds its asset into: a Page composes media into a section, so the request names the draft edition and the catalogue element that section is read by, and the service judges the binding itself.
const sectionPlacementSchema = z.looseObject({ sectionElement: z.string({ error: MESSAGES.sectionRequired }).min(1, MESSAGES.sectionRequired), draftRevisionId: z.string().min(1).optional(), variantId: z.string().min(1).optional(), position: z.int().optional() }).optional();
const registerMediaAssetPayloadSchema: z.ZodType<RegisterMediaAssetPayload & { readonly operation: "registerMediaAsset" }> = z
  .looseObject({
    operation: z.literal("registerMediaAsset", { error: MESSAGES.operationRequired }),
    kind: z.enum(MEDIA_KINDS, { error: "Choose whether this file is an image or a video." }),
    source: uploadBytesSchema,
    altText: registeredAltTextFieldSchema,
    placement: registeredPlacementDescriptorSchema,
    sectionPlacement: sectionPlacementSchema,
  })
  .superRefine((payload, ctx) => {
    const altText = payload.altText ?? payload.placement?.altText ?? ""; // A stated null states none, so it is judged as absent rather than as a value of its own.
    if (altText === "") ctx.addIssue({ code: "custom", path: ["altText"], message: altTextRequired(payload.kind) });
  });
const placementTargetShape = {
  placementId: z.string({ error: "Name the placement this change acts on, so the draft's own placement list settles which one moves." }).min(1, "Name the placement this change acts on."),
  draftRevisionId: z.string().min(1, "Name the draft revision this change edits.").optional(),
  variantId: z.string().min(1, "Name the variant whose draft this change edits.").optional(),
} as const;
const replacePlacementPayloadSchema: z.ZodType<PlacementTargetPayload & { readonly operation: "replacePlacement" }> = z.looseObject({
  operation: z.literal("replacePlacement", { error: MESSAGES.operationRequired }),
  ...placementTargetShape,
  assetId: z.string().min(1, "Name the asset that replaces this placement's media.").optional(),
  placement: placementDescriptorSchema,
});
const removePlacementPayloadSchema: z.ZodType<PlacementTargetPayload & { readonly operation: "removePlacement" }> = z.looseObject({ operation: z.literal("removePlacement", { error: MESSAGES.operationRequired }), ...placementTargetShape });
const registerMediaAssetBodySchema = mutationInputSchema(registerMediaAssetPayloadSchema);
const replacePlacementBodySchema = mutationInputSchema(replacePlacementPayloadSchema);
const removePlacementBodySchema = mutationInputSchema(removePlacementPayloadSchema);
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(MEDIA_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
const refuseBody = (operationId: string, message: string): Response => toResponse(outcomeFromError(operationId, new ZodError([{ code: "custom", path: [], message, input: undefined }])));
// The three media writes this path admits, built per request so the one that prepares and stores bytes is told when the caller has stopped waiting: a stopped registration then writes nothing at all.
const mediaWrites = (signal: AbortSignal): Readonly<Record<(typeof MEDIA_OPERATIONS)[number], ClaimedWrite>> => ({
  registerMediaAsset: (raw, { operationId, sessionId }) => dispatch(registerMediaAssetBodySchema, raw, operationId, "operation", (input) => mutations.media.registerMediaAsset(sessionId, input, { signal })),
  replacePlacement: (raw, { operationId, sessionId }) => dispatch(replacePlacementBodySchema, raw, operationId, "operation", (input) => mutations.media.replacePlacement(sessionId, input)),
  removePlacement: (raw, { operationId, sessionId }) => dispatch(removePlacementBodySchema, raw, operationId, "operation", (input) => mutations.media.removePlacement(sessionId, input)),
});
/** Applies one named media mutation — `registerMediaAsset`, `replacePlacement` or `removePlacement` — and answers with one outcome of the closed eight. The body is read under this transport's own ceiling and as valid UTF-8 only, because a base64 document this large is never carried as anything else. */
async function changeMedia(request: NextRequest): Promise<Response> {
  const body = await readRequestBody(request, MAX_REQUEST_BYTES, true);
  if (body.kind === "oversized") return refuseBody(UNIDENTIFIED_ATTEMPT, OVERSIZED_MESSAGE);
  if (body.kind === "unreadable") return refuseBody(UNIDENTIFIED_ATTEMPT, MESSAGES.bodyUnreadable);
  return claimedBodyRoute(request, body.value, discriminantSchema, (claim) => claim.payload.operation, mediaWrites(request.signal));
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: changeMedia });
