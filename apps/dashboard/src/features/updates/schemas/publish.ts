import { z } from "zod";
import { PUBLISH_MODE_LABELS, REVIEW_ROUND_NOTE } from "../copy/updates-copy";
import { contentIdSchema } from "./draft";
/** The two release choices a release selection states, in the family's client spelling: the author records one at submission (the store's own word for it is `SUBMISSION_NOTIFY_MODES` in `./draft`), and a release selection names the same choice as the review surface offers it. */
export const PUBLISH_MODES = ["publish-only", "publish-and-notify-now"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];
const PUBLISH_MODE_PARITY = { "publish-only": "publish-only", "publish-and-notify-now": "publish-and-notify-now" } as const satisfies Readonly<Record<keyof typeof PUBLISH_MODE_LABELS, PublishMode> & Record<PublishMode, keyof typeof PUBLISH_MODE_LABELS>>;
const NOTIFY_NOW_MODE = PUBLISH_MODE_PARITY["publish-and-notify-now"];
export const publishSelectionSchema = z.strictObject({
  variantId: contentIdSchema,
  revisionId: contentIdSchema,
  mode: z.enum(PUBLISH_MODES, { error: "Choose how this edition is released: publish only, or publish and notify now." }),
  candidateNotifyAdmitted: z.boolean({ error: "This release needs the candidate's own notification policy, so reopen the review and choose " + "the publish choice again." }),
});
const DUPLICATE_VARIANT_MESSAGE = "This release lists the same variant edition twice, so remove the repeated entry: one publication " + "releases each edition once.";
export const publishVariantsSchema = z.strictObject({ documentId: contentIdSchema, variants: z.array(publishSelectionSchema).min(1, "Choose at least one variant edition to release.") }).superRefine((payload, ctx) => {
  const selected = new Set<string>();
  payload.variants.forEach((selection, index) => {
    if (selection.mode === NOTIFY_NOW_MODE && selection.candidateNotifyAdmitted === false) ctx.addIssue({ code: "custom", path: ["variants", index, "mode"], message: REVIEW_ROUND_NOTE.reviewerCannotAddNotify });
    if (selected.has(selection.variantId)) {
      ctx.addIssue({ code: "custom", path: ["variants", index, "variantId"], message: DUPLICATE_VARIANT_MESSAGE });
      return;
    }
    selected.add(selection.variantId);
  });
});
export type PublishSelection = z.infer<typeof publishSelectionSchema>;
export type PublishVariantsPayload = z.infer<typeof publishVariantsSchema>;
