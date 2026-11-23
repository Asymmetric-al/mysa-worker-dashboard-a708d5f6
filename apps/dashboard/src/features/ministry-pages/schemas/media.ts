import { z } from "zod";
import { mutationInputSchema } from "@/modules/data-service/envelope";
import type { PlacementTargetPayload as ServicePlacementTargetPayload, RegisterMediaAssetPayload as ServiceRegisterMediaAssetPayload } from "@/modules/data-service/mutations/content";
const ORIGIN_PREFIXES = ["data:", "blob:", "http:", "https:"] as const;
const RECORD_REFERENCE_MESSAGE = "Use the record's own identity, not a file path or a link.";
const carriesAddress = (value: string): boolean => ORIGIN_PREFIXES.some((prefix) => value.toLowerCase().startsWith(prefix)) || value.includes("/") || value.includes("\\") || value.includes("..");
function opaqueReference(message: string) {
  return z
    .string({ error: message })
    .trim()
    .min(1, message)
    .superRefine((value, ctx) => {
      if (!carriesAddress(value)) return;
      ctx.addIssue({ code: "custom", message });
    });
}
const KINDS = ["image", "video"] as const;
const PLACEMENT_TEXT_MAX_CHARS = 4_000;
const UPLOAD_NAME_MAX_CHARS = 255;
const CAPTION_LABEL_MAX_CHARS = 120;
const localeTagSchema = z
  .string({ error: "State the content locale this media is in." })
  .trim()
  .min(2, "Use a content-locale tag such as en, fr or ar-EG.")
  .max(35, "Use a content-locale tag of at most 35 characters, such as ar-EG.")
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u, "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated subtags.");
const optionalPlacementTextSchema = z.string({ error: "State this as text, or leave it out." }).trim().max(PLACEMENT_TEXT_MAX_CHARS, `A placement field holds at most ${PLACEMENT_TEXT_MAX_CHARS} characters, so shorten it.`).optional();
const optionalAltTextSchema = z.string({ error: "Describe what this image or video shows." }).trim().min(1, "Describe what this image or video shows.").max(PLACEMENT_TEXT_MAX_CHARS, "Shorten the alternative text for this placement.").optional();
export const placementSchema = z.strictObject({ altText: optionalAltTextSchema, caption: optionalPlacementTextSchema, credit: optionalPlacementTextSchema });
const uploadBytesSchema = z.strictObject({
  bytesBase64: z.string({ error: "Choose a file to upload." }).min(1, "Choose a file to upload."),
  name: z.string({ error: "State the file's name as text, or leave it out." }).min(1, "State the file's name as text, or leave it out.").max(UPLOAD_NAME_MAX_CHARS, `A file name holds at most ${UPLOAD_NAME_MAX_CHARS} characters.`).optional(),
});
const draftTargetFields = { draftRevisionId: opaqueReference(RECORD_REFERENCE_MESSAGE).optional(), variantId: opaqueReference(RECORD_REFERENCE_MESSAGE).optional() } as const;
function refuseMissingDraftTarget(payload: { readonly draftRevisionId?: string; readonly variantId?: string }, ctx: z.RefinementCtx): void {
  if (payload.draftRevisionId !== undefined || payload.variantId !== undefined) return;
  ctx.addIssue({ code: "custom", path: ["draftRevisionId"], message: "Open the page's draft first: a section change names the draft revision it edits." });
}
const sectionPlacementSchema = z
  .strictObject({
    ...draftTargetFields,
    sectionElement: z.string({ error: "State the section this media is placed in." }).trim().min(1, "State the section this media is placed in."),
    position: z.int({ error: "State the position this placement takes as a whole number." }).nonnegative("A position is zero or more, counting from the first placement.").optional(),
  })
  .superRefine(refuseMissingDraftTarget)
  .optional();
export const registerMediaAssetPayloadSchema: z.ZodType<ServiceRegisterMediaAssetPayload> = z
  .strictObject({
    kind: z.enum(KINDS, { error: "Choose whether this file is an image or a video." }),
    source: uploadBytesSchema,
    altText: optionalAltTextSchema,
    caption: optionalPlacementTextSchema,
    credit: optionalPlacementTextSchema,
    language: localeTagSchema.optional(),
    placement: placementSchema.extend({ language: localeTagSchema.optional() }).optional(),
    poster: z
      .strictObject({
        bytesBase64: z.string({ error: "Choose a poster image for this video." }).min(1, "Choose a poster image for this video."),
        name: z.string({ error: "State the file's name as text, or leave it out." }).min(1, "State the file's name as text, or leave it out.").max(UPLOAD_NAME_MAX_CHARS, `A file name holds at most ${UPLOAD_NAME_MAX_CHARS} characters.`).optional(),
        altText: optionalAltTextSchema,
      })
      .optional(),
    captions: z
      .strictObject({
        vtt: z.string({ error: "Choose a WebVTT caption file." }).min(1, "Choose a WebVTT caption file."),
        language: localeTagSchema,
        label: z.string({ error: "State the track's label as text, or leave it out." }).trim().min(1, "State the track's label as text, or leave it out.").max(CAPTION_LABEL_MAX_CHARS, `A track label holds at most ${CAPTION_LABEL_MAX_CHARS} characters.`).optional(),
      })
      .optional(),
    transcript: z.strictObject({ text: z.string({ error: "State the transcript, or leave it out." }).min(1, "State the transcript, or leave it out.") }).optional(),
    sectionPlacement: sectionPlacementSchema,
  })
  .superRefine((payload, ctx) => {
    if (payload.kind === "image" && (payload.altText ?? payload.placement?.altText) === undefined) ctx.addIssue({ code: "custom", path: ["altText"], message: "An image needs alternative text describing what it shows before it can be placed, so describe it and choose the file again." });
    if (payload.kind === "image" && payload.captions !== undefined) ctx.addIssue({ code: "custom", path: ["captions"], message: "A caption track belongs to a video, so an image carries none." });
    if (payload.poster !== undefined && payload.kind !== "video") ctx.addIssue({ code: "custom", path: ["poster"], message: "A poster belongs to a video, so an image carries none." });
  });
export const registerMediaAssetInputSchema = mutationInputSchema(registerMediaAssetPayloadSchema);
export type Placement = z.infer<typeof placementSchema>;
export type RegisterMediaAssetPayload = z.infer<typeof registerMediaAssetPayloadSchema>;
const placementTargetPayloadSchema: z.ZodType<ServicePlacementTargetPayload> = z
  .strictObject({ ...draftTargetFields, placementId: opaqueReference(RECORD_REFERENCE_MESSAGE), assetId: opaqueReference("Use the prepared asset, not a file path or a link.").optional(), placement: placementSchema.optional() })
  .superRefine(refuseMissingDraftTarget);
export const removePlacementPayloadSchema = placementTargetPayloadSchema;
export const removePlacementInputSchema = mutationInputSchema(removePlacementPayloadSchema);
export type RemovePlacementPayload = z.infer<typeof removePlacementPayloadSchema>;
