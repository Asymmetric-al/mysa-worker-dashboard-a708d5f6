/**
 * The Ministry Updates family's draft-side payload schemas — `createVariant`, `saveDraft` and
 * `submitForReview` — together with the five primitives the rest of this schema folder imports.
 */
import { z } from "zod";
import { parseDocument } from "@/modules/content/document";
import { variantKeyAllowed, type ContentVariant, type VariantAudience, type VariantFamily } from "@/modules/content/variant";
import type { MediaRenditionPurpose } from "@/modules/media/asset";
import { VARIANT_AXIS_NOTE } from "../copy/updates-copy";
// Shared primitives: one identifier shape, one family, one audience axis, one locale, one placement
/** The content family every payload in this file submits for. */
export const UPDATE_FAMILY = "update" as const satisfies VariantFamily;
/** The one identifier shape for every record reference this family sends: `createVariant`'s document, `saveDraft`'s variant, `submitForReview`'s variant and revision, and a placement's asset. */
export const contentIdSchema = z
  .string({ error: "This action applies to one record, so open the record again and retry." })
  .trim()
  .min(1, "This action applies to one record, so open the record again and retry.")
  .max(128, "That reference is too long to be one record identity, so open the record from its list rather " + "than pasting an address.");
const AUDIENCE_AXIS = {
  public: "public",
  "approved-supporter": "approved-supporter",
} as const satisfies Readonly<Record<ContentVariant["audience"], VariantAudience>>;
/** The audience one variant serves: public, or approved supporters. */
export const audienceSchema = z.enum(Object.values(AUDIENCE_AXIS), {
  error: "Choose the audience this edition serves: public or approved supporters.",
});
/** A content-locale tag: the exact language an edition is written in, such as `en`, `fr` or `ar-EG`. */
export const localeTagSchema = z
  .string({ error: "State the content locale this edition is written in." })
  .trim()
  .min(2, "Use a content-locale tag such as en, fr or ar-EG.")
  .max(35, "Use a content-locale tag of at most 35 characters, such as ar-EG.")
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/, "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated " + "subtags.");
const PLACEABLE_RENDITION_PURPOSES = {
  display: "display",
  playback: "playback",
  poster: "poster",
  captions: "captions",
  transcript: "transcript",
} as const satisfies Readonly<Record<MediaRenditionPurpose, MediaRenditionPurpose>>;
/** A draft's reference to one already-registered media asset, for one rendition purpose. */
export const mediaPlacementRefSchema = z.strictObject({
  assetId: contentIdSchema,
  purpose: z.enum(Object.values(PLACEABLE_RENDITION_PURPOSES), {
    error: "Choose the rendition this placement uses: display, playback, poster, captions or transcript.",
  }),
});
// The three mutation payloads
/** Feeds `createVariant`: one document, one permitted audience, one exact content locale. */
export const createVariantSchema = z
  .strictObject({
    documentId: contentIdSchema,
    audience: audienceSchema,
    locale: localeTagSchema,
  })
  .superRefine((payload, ctx) => {
    if (!variantKeyAllowed(UPDATE_FAMILY, payload.audience)) {
      ctx.addIssue({ code: "custom", path: ["audience"], message: VARIANT_AXIS_NOTE });
    }
  });
function bodyFieldPath(documentPath: string): (string | number)[] {
  const segments: (string | number)[] = ["body"];
  for (const segment of documentPath.split(".")) {
    if (segment.length === 0) {
      continue;
    }
    segments.push(/^\d+$/.test(segment) ? Number(segment) : segment);
  }
  return segments;
}
/** Feeds `saveDraft`: the working revision of one variant, which moves the draft pointer and nothing else — no candidate and no release changes because a draft was saved. */
export const saveDraftSchema = z
  .strictObject({
    variantId: contentIdSchema,
    body: z.unknown(),
    contentChecksum: z
      .string({ error: "A checksum is either left out or stated as the value the editor holds." })
      .trim()
      .min(1, "A checksum is either left out or stated as the value the editor holds.")
      .max(64, "That checksum is longer than any this application produces, so save the draft from the " + "editor again rather than pasting one.")
      .optional(),
    mediaPlacements: z.array(mediaPlacementRefSchema).optional(),
  })
  .superRefine((payload, ctx) => {
    if (!Object.hasOwn(payload, "body") || payload.body === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "A saved draft carries the document body, so save it from the editor rather than here.",
      });
      return;
    }
    const parsed = parseDocument(payload.body);
    if (parsed.status === "valid") {
      return;
    }
    for (const issue of parsed.issues) {
      ctx.addIssue({ code: "custom", path: bodyFieldPath(issue.path), message: issue.message });
    }
  });
/** Feeds `submitForReview`: the exact revision the author saw, submitted as the candidate to freeze. */
export const submitForReviewSchema = z.strictObject({
  variantId: contentIdSchema,
  revisionId: contentIdSchema,
});
// Payload types: inferred from the schemas, never written beside them
/** The payload `createVariant` accepts, inferred so a form and its hook cannot hold a second shape. */
export type CreateVariantPayload = z.infer<typeof createVariantSchema>;
/** The payload `saveDraft` accepts, inferred so the editor and its hook read one shape. */
export type SaveDraftPayload = z.infer<typeof saveDraftSchema>;
/** The payload `submitForReview` accepts, inferred so the review step cannot restate it. */
export type SubmitForReviewPayload = z.infer<typeof submitForReviewSchema>;
