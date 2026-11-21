/**
 * The Ministry Updates family's publish payload schema — the one mutation that releases a document's
 * frozen candidates: `publishVariants`.
 */
import { z } from "zod";
import { PUBLISH_MODE_LABELS, REVIEW_ROUND_NOTE } from "../copy/updates-copy";
import { contentIdSchema } from "./draft";
// The closed publish choice: one vocabulary, mirrored from the family's copy module
/** The two publish choices a release offers: release the edition alone, or release it and submit a notice now. */
export const PUBLISH_MODES = ["publish-only", "publish-and-notify-now"] as const;
/** One publish choice. */
export type PublishMode = (typeof PUBLISH_MODES)[number];

const PUBLISH_MODE_PARITY = {
  "publish-only": "publish-only",
  "publish-and-notify-now": "publish-and-notify-now",
} as const satisfies Readonly<Record<keyof typeof PUBLISH_MODE_LABELS, PublishMode> & Record<PublishMode, keyof typeof PUBLISH_MODE_LABELS>>;
const NOTIFY_NOW_MODE = PUBLISH_MODE_PARITY["publish-and-notify-now"];
// The selection: the frozen candidate, one choice, the candidate's own policy as the form read it
/** One variant edition selected for release: the exact frozen candidate, the publish choice, and the candidate's notification policy as the form holds it. */
export const publishSelectionSchema = z.strictObject({
  variantId: contentIdSchema,
  revisionId: contentIdSchema,
  mode: z.enum(PUBLISH_MODES, {
    error: "Choose how this edition is released: publish only, or publish and notify now.",
  }),
  candidateNotifyAdmitted: z.boolean({
    error: "This release needs the candidate's own notification policy, so reopen the review and choose " + "the publish choice again.",
  }),
});
// Wording this payload needs and the family's copy module holds no key for
const DUPLICATE_VARIANT_MESSAGE = "This release lists the same variant edition twice, so remove the repeated entry: one publication " + "releases each edition once.";
// The payload: one document and the exact editions this intent releases
/** Feeds `publishVariants`: the Update being published and the exact variant editions it releases. */
export const publishVariantsSchema = z
  .strictObject({
    documentId: contentIdSchema,
    variants: z.array(publishSelectionSchema).min(1, "Choose at least one variant edition to release."),
  })
  .superRefine((payload, ctx) => {
    const selected = new Set<string>();
    payload.variants.forEach((selection, index) => {
      if (selection.mode === NOTIFY_NOW_MODE && selection.candidateNotifyAdmitted === false) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "mode"],
          message: REVIEW_ROUND_NOTE.reviewerCannotAddNotify,
        });
      }
      if (selected.has(selection.variantId)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "variantId"],
          message: DUPLICATE_VARIANT_MESSAGE,
        });
        return;
      }
      selected.add(selection.variantId);
    });
  });
// Payload types: inferred from the schemas, never written beside them
/** One selected variant edition, inferred so a review row and its hook cannot restate it. */
export type PublishSelection = z.infer<typeof publishSelectionSchema>;
/** The payload `publishVariants` accepts, inferred so the review form and its hook hold one shape. */
export type PublishVariantsPayload = z.infer<typeof publishVariantsSchema>;
