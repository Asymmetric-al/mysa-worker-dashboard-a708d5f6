import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { routeMethods } from "@/app/api/methods";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT, claimedBodyRoute, dispatch, readRequestBody, type ClaimedWrite } from "../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: registerMediaAsset, replacePlacement or removePlacement.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  bodyUnreadable: "This request's body could not be read as UTF-8 JSON, so nothing was changed. Send the change again as a JSON object carrying operationId, scope, expectedRevision and payload.",
  altTextRequired: "An image needs alternative text describing what it shows before it can be placed, so describe it and choose the file again.",
  sectionRequired: "State the section this media is placed in.",
} as const;
const BYTES_PER_MEBIBYTE = 1024 * 1024;
const MAX_REQUEST_MIB = 192;
const MAX_REQUEST_BYTES = MAX_REQUEST_MIB * BYTES_PER_MEBIBYTE;
const OVERSIZED_MESSAGE = `This request is larger than the ${MAX_REQUEST_MIB} MiB a media registration may carry as JSON text. A 100 MiB video states as roughly 133 MiB of base64 before its poster and caption track are counted, so anything past this bound is refused here rather than decoded. Choose a smaller file, or prepare the video outside this application.`;
type RegisterMediaAssetPayload = Parameters<typeof mutations.media.registerMediaAsset>[1]["payload"];
type PlacementTargetPayload = Parameters<typeof mutations.media.replacePlacement>[1]["payload"];
type RegisterMediaAssetRequest = RegisterMediaAssetPayload & { readonly operation: "registerMediaAsset" };
type ReplacePlacementRequest = PlacementTargetPayload & { readonly operation: "replacePlacement" };
type RemovePlacementRequest = PlacementTargetPayload & { readonly operation: "removePlacement" };
const MEDIA_KINDS = ["image", "video"] as const satisfies readonly RegisterMediaAssetPayload["kind"][];
const MEDIA_OPERATIONS = ["registerMediaAsset", "replacePlacement", "removePlacement"] as const;
type MediaOperation = (typeof MEDIA_OPERATIONS)[number];
const uploadBytesSchema = z.looseObject({ bytesBase64: z.string({ error: "Choose a file to upload." }).min(1, "Choose a file to upload.") });
const altTextFieldSchema = z.string({ error: MESSAGES.altTextRequired }).optional();
const placementDescriptorSchema = z.looseObject({ altText: altTextFieldSchema }).optional();
// The section a registration binds its asset into: a Page composes media into a section, so the request names the draft edition and the catalogue element that section is read by, and the service judges the binding itself.
const sectionPlacementSchema = z.looseObject({ sectionElement: z.string({ error: MESSAGES.sectionRequired }).min(1, MESSAGES.sectionRequired), draftRevisionId: z.string().min(1).optional(), variantId: z.string().min(1).optional(), position: z.int().optional() }).optional();
const registerMediaAssetPayloadSchema: z.ZodType<RegisterMediaAssetRequest> = z
  .looseObject({
    operation: z.literal("registerMediaAsset", { error: MESSAGES.operationRequired }),
    kind: z.enum(MEDIA_KINDS, { error: "Choose whether this file is an image or a video." }),
    source: uploadBytesSchema,
    altText: altTextFieldSchema,
    placement: placementDescriptorSchema,
    sectionPlacement: sectionPlacementSchema,
  })
  .superRefine((payload, ctx) => {
    if (payload.kind === "image" && (payload.altText ?? payload.placement?.altText) === undefined) ctx.addIssue({ code: "custom", path: ["altText"], message: MESSAGES.altTextRequired });
  });
const placementTargetShape = {
  placementId: z.string({ error: "Name the placement this change acts on, so the draft's own placement list settles which one moves." }).min(1, "Name the placement this change acts on."),
  draftRevisionId: z.string().min(1, "Name the draft revision this change edits.").optional(),
  variantId: z.string().min(1, "Name the variant whose draft this change edits.").optional(),
} as const;
const replacePlacementPayloadSchema: z.ZodType<ReplacePlacementRequest> = z.looseObject({
  operation: z.literal("replacePlacement", { error: MESSAGES.operationRequired }),
  ...placementTargetShape,
  assetId: z.string().min(1, "Name the asset that replaces this placement's media.").optional(),
  placement: placementDescriptorSchema,
});
const removePlacementPayloadSchema: z.ZodType<RemovePlacementRequest> = z.looseObject({ operation: z.literal("removePlacement", { error: MESSAGES.operationRequired }), ...placementTargetShape });
const registerMediaAssetBodySchema = mutationInputSchema(registerMediaAssetPayloadSchema);
const replacePlacementBodySchema = mutationInputSchema(replacePlacementPayloadSchema);
const removePlacementBodySchema = mutationInputSchema(removePlacementPayloadSchema);
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(MEDIA_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
const refuseBody = (operationId: string, message: string): Response => toResponse(outcomeFromError(operationId, new ZodError([{ code: "custom", path: [], message, input: undefined }])));
const MEDIA_WRITES = {
  registerMediaAsset: (raw, { operationId, sessionId }) => dispatch(registerMediaAssetBodySchema, raw, operationId, "operation", (input) => mutations.media.registerMediaAsset(sessionId, input)),
  replacePlacement: (raw, { operationId, sessionId }) => dispatch(replacePlacementBodySchema, raw, operationId, "operation", (input) => mutations.media.replacePlacement(sessionId, input)),
  removePlacement: (raw, { operationId, sessionId }) => dispatch(removePlacementBodySchema, raw, operationId, "operation", (input) => mutations.media.removePlacement(sessionId, input)),
} satisfies Readonly<Record<MediaOperation, ClaimedWrite>>;
/** Applies one named media mutation — `registerMediaAsset`, `replacePlacement` or `removePlacement` — and answers with one outcome of the closed eight. The body is read under this transport's own ceiling and as valid UTF-8 only, because a base64 document this large is never carried as anything else. */
async function changeMedia(request: NextRequest): Promise<Response> {
  const body = await readRequestBody(request, MAX_REQUEST_BYTES, true);
  if (body.kind === "oversized") return refuseBody(UNIDENTIFIED_ATTEMPT, OVERSIZED_MESSAGE);
  if (body.kind === "unreadable") return refuseBody(UNIDENTIFIED_ATTEMPT, MESSAGES.bodyUnreadable);
  return claimedBodyRoute(request, body.value, discriminantSchema, (claim) => claim.payload.operation, MEDIA_WRITES);
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: changeMedia });
