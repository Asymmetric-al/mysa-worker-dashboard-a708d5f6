/**
 * The Worker and Project Pages family's media payload schemas: `registerMediaAsset`,
 * `replacePlacement` and `removePlacement`, together with the placement descriptor all three read.
 */
import { z } from "zod";
// The `@/modules/data-service` barrel re-exports this same function, but it also pulls the named
// reads, which reach `node:fs`; the picker's client form imports this file, so the export is taken
// from the module that declares it.
import { mutationInputSchema, type MutationInput } from "@/modules/data-service/envelope";
// The annotation types are imported with `import type`, which the compiler erases: they hold the
// payload schemas below to the service's own types without pulling the mutation bodies, the store or
// `node:fs` into a client bundle.
import type { PlacementTargetPayload as ServicePlacementTargetPayload, RegisterMediaAssetPayload as ServiceRegisterMediaAssetPayload } from "@/modules/data-service/mutations/content";
// Opaque references: an identifier names a record, never a file or a link
const ORIGIN_PREFIXES = ["data:", "blob:", "http:", "https:"] as const;

const ASSET_REFERENCE_MESSAGE = "Use the prepared asset, not a file path or a link.";

const RECORD_REFERENCE_MESSAGE = "Use the record's own identity, not a file path or a link.";

function carriesAddress(value: string): boolean {
  const lowered = value.toLowerCase();
  return ORIGIN_PREFIXES.some((prefix) => lowered.startsWith(prefix)) || value.includes("/") || value.includes("\\") || value.includes("..");
}
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
// The two kinds one registration names
const KINDS = ["image", "video"] as const;
// The service's own bounds and vocabularies, repeated here because it declares them privately
const PLACEMENT_TEXT_MAX_CHARS = 4_000;

const UPLOAD_NAME_MAX_CHARS = 255;

const CAPTION_LABEL_MAX_CHARS = 120;

const localeTagSchema = z
  .string({ error: "State the content locale this media is in." })
  .trim()
  .min(2, "Use a content-locale tag such as en, fr or ar-EG.")
  .max(35, "Use a content-locale tag of at most 35 characters, such as ar-EG.")
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u, "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated subtags.");
const optionalPlacementTextSchema = z
  .string({ error: "State this as text, or leave it out." })
  .trim()
  .max(PLACEMENT_TEXT_MAX_CHARS, `A placement field holds at most ${PLACEMENT_TEXT_MAX_CHARS} characters, so shorten it.`)
  .optional();
const optionalAltTextSchema = z
  .string({ error: "Describe what this image or video shows." })
  .trim()
  .min(1, "Describe what this image or video shows.")
  .max(PLACEMENT_TEXT_MAX_CHARS, "Shorten the alternative text for this placement.")
  .optional();
// The placement descriptor: what a reader is told about the media
/** What one placement says about the media it shows, as both placement mutations state it. */
export const placementSchema = z.strictObject({
  altText: optionalAltTextSchema,
  caption: optionalPlacementTextSchema,
  credit: optionalPlacementTextSchema,
});
// registerMediaAsset
const uploadBytesSchema = z.strictObject({
  bytesBase64: z.string({ error: "Choose a file to upload." }).min(1, "Choose a file to upload."),
  name: z
    .string({ error: "State the file's name as text, or leave it out." })
    .min(1, "State the file's name as text, or leave it out.")
    .max(UPLOAD_NAME_MAX_CHARS, `A file name holds at most ${UPLOAD_NAME_MAX_CHARS} characters.`)
    .optional(),
});
/** Feeds `registerMediaAsset`: one file to prepare, the kind the caller says it is, and the description its placement will carry. */
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
        name: z
          .string({ error: "State the file's name as text, or leave it out." })
          .min(1, "State the file's name as text, or leave it out.")
          .max(UPLOAD_NAME_MAX_CHARS, `A file name holds at most ${UPLOAD_NAME_MAX_CHARS} characters.`)
          .optional(),
        altText: optionalAltTextSchema,
      })
      .optional(),
    captions: z
      .strictObject({
        vtt: z.string({ error: "Choose a WebVTT caption file." }).min(1, "Choose a WebVTT caption file."),
        language: localeTagSchema,
        label: z
          .string({ error: "State the track's label as text, or leave it out." })
          .trim()
          .min(1, "State the track's label as text, or leave it out.")
          .max(CAPTION_LABEL_MAX_CHARS, `A track label holds at most ${CAPTION_LABEL_MAX_CHARS} characters.`)
          .optional(),
      })
      .optional(),
    transcript: z
      .strictObject({
        text: z.string({ error: "State the transcript, or leave it out." }).min(1, "State the transcript, or leave it out."),
      })
      .optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.kind === "image" && (payload.altText ?? payload.placement?.altText) === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["altText"],
        message: "An image needs alternative text describing what it shows before it can be placed, so describe it and choose the file again.",
      });
    }
    if (payload.kind === "image" && payload.captions !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["captions"],
        message: "A caption track belongs to a video, so an image carries none.",
      });
    }
    if (payload.poster !== undefined && payload.kind !== "video") {
      ctx.addIssue({
        code: "custom",
        path: ["poster"],
        message: "A poster belongs to a video, so an image carries none.",
      });
    }
  });
/** The whole request `registerMediaAsset` receives: the registration payload with the operation identity, the selected context and the revision the caller saw. */
export const registerMediaAssetInputSchema = mutationInputSchema(registerMediaAssetPayloadSchema);
/** The descriptor one media placement carries, inferred so the builder and the picker read one shape. */
export type Placement = z.infer<typeof placementSchema>;
/** The payload `registerMediaAsset` accepts, inferred so its form and its transport cannot drift apart. */
export type RegisterMediaAssetPayload = z.infer<typeof registerMediaAssetPayloadSchema>;
/** The input `registerMediaAsset` accepts, so no caller assembles the envelope by hand. */
export type RegisterMediaAssetInput = MutationInput<RegisterMediaAssetPayload>;
// The draft target both placement mutations name
const draftTargetFields = {
  draftRevisionId: opaqueReference(RECORD_REFERENCE_MESSAGE).optional(),
  variantId: opaqueReference(RECORD_REFERENCE_MESSAGE).optional(),
} as const;
const NO_DRAFT_TARGET_MESSAGE = "Open the page's draft first: a section change names the draft revision it edits.";

function refuseMissingDraftTarget(payload: { readonly draftRevisionId?: string; readonly variantId?: string }, ctx: z.RefinementCtx): void {
  if (payload.draftRevisionId !== undefined || payload.variantId !== undefined) return;
  ctx.addIssue({ code: "custom", path: ["draftRevisionId"], message: NO_DRAFT_TARGET_MESSAGE });
}
const placementTargetPayloadSchema: z.ZodType<ServicePlacementTargetPayload> = z
  .strictObject({
    ...draftTargetFields,
    placementId: opaqueReference(RECORD_REFERENCE_MESSAGE),
    assetId: opaqueReference(ASSET_REFERENCE_MESSAGE).optional(),
    placement: placementSchema.optional(),
  })
  .superRefine(refuseMissingDraftTarget);
// replacePlacement
/** Feeds `replacePlacement`: one draft, one existing placement, the prepared asset that now fills it, and the description that placement states from now on. */
export const replacePlacementPayloadSchema = placementTargetPayloadSchema;
/** The whole request `replacePlacement` receives: the replacement with its operation identity, context and expected revision. */
export const replacePlacementInputSchema = mutationInputSchema(replacePlacementPayloadSchema);
/** The payload `replacePlacement` accepts, inferred so a replacement cannot restate a bare file. */
export type ReplacePlacementPayload = z.infer<typeof replacePlacementPayloadSchema>;
/** The input `replacePlacement` accepts, so every replacement is one identifiable attempt. */
export type ReplacePlacementInput = MutationInput<ReplacePlacementPayload>;
// removePlacement
/** Feeds `removePlacement`: one draft and one existing placement, and nothing a removal cannot mean. */
export const removePlacementPayloadSchema = placementTargetPayloadSchema;
/** The whole request `removePlacement` receives: the placement and its four-field envelope. */
export const removePlacementInputSchema = mutationInputSchema(removePlacementPayloadSchema);
/** The payload `removePlacement` accepts, inferred so a removal carries nothing a removal cannot mean. */
export type RemovePlacementPayload = z.infer<typeof removePlacementPayloadSchema>;
/** The input `removePlacement` accepts, so a removal is recoverable by its operation identity. */
export type RemovePlacementInput = MutationInput<RemovePlacementPayload>;
