import { z } from "zod";
import { parseDocument } from "@/modules/content/document";
import { variantKeyAllowed, type ContentVariant, type VariantAudience, type VariantFamily } from "@/modules/content/variant";
import type { MediaAcceptanceSuccess, MediaAssetScope, MediaRenditionPurpose } from "@/modules/media/asset";
import { ADMITTED_IMAGE_FORMATS, ADMITTED_VIDEO_PROFILES, IMAGE_MAX_BYTES, VIDEO_MAX_BYTES, mediaStateReason } from "@/modules/media/profile";
import { PUBLISH_MODE_LABELS, REVIEW_ROUND_NOTE, VARIANT_AXIS_NOTE } from "./copy/updates-copy";
export const UPDATE_FAMILY = "update" as const satisfies VariantFamily;
export const contentIdSchema = z
  .string({ error: "This action applies to one record, so open the record again and retry." })
  .trim()
  .min(1, "This action applies to one record, so open the record again and retry.")
  .max(128, "That reference is too long to be one record identity, so open the record from its list rather than pasting an address.");
export const audienceSchema = z.enum(Object.values({ public: "public", "approved-supporter": "approved-supporter" } as const satisfies Readonly<Record<ContentVariant["audience"], VariantAudience>>), { error: "Choose the audience this edition serves: public or approved supporters." });
export const localeTagSchema = z
  .string({ error: "State the content locale this edition is written in." })
  .trim()
  .min(2, "Use a content-locale tag such as en, fr or ar-EG.")
  .max(35, "Use a content-locale tag of at most 35 characters, such as ar-EG.")
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/, "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated subtags.");
const PLACEABLE_RENDITION_PURPOSES = { display: "display", playback: "playback", poster: "poster", captions: "captions", transcript: "transcript" } as const satisfies Readonly<Record<MediaRenditionPurpose, MediaRenditionPurpose>>;
export const mediaPlacementRefSchema = z.strictObject({ assetId: contentIdSchema, purpose: z.enum(Object.values(PLACEABLE_RENDITION_PURPOSES), { error: "Choose the rendition this placement uses: display, playback, poster, captions or transcript." }) });
export const createVariantSchema = z.strictObject({ documentId: contentIdSchema, audience: audienceSchema, locale: localeTagSchema }).superRefine((payload, ctx) => {
  if (!variantKeyAllowed(UPDATE_FAMILY, payload.audience)) ctx.addIssue({ code: "custom", path: ["audience"], message: VARIANT_AXIS_NOTE });
});
function bodyFieldPath(documentPath: string): (string | number)[] {
  const segments: (string | number)[] = ["body"];
  for (const segment of documentPath.split(".")) {
    if (segment.length === 0) continue;
    segments.push(/^\d+$/.test(segment) ? Number(segment) : segment);
  }
  return segments;
}
/** Feeds `saveDraft`: the working revision of one variant, which moves the draft pointer and nothing else — no candidate and no release changes because a draft was saved. */ export const saveDraftSchema = z
  .strictObject({
    variantId: contentIdSchema,
    body: z.unknown(),
    contentChecksum: z
      .string({ error: "A checksum is either left out or stated as the value the editor holds." })
      .trim()
      .min(1, "A checksum is either left out or stated as the value the editor holds.")
      .max(64, "That checksum is longer than any this application produces, so save the draft from the editor again rather than pasting one.")
      .optional(),
    mediaPlacements: z.array(mediaPlacementRefSchema).optional(),
  })
  .superRefine((payload, ctx) => {
    if (!Object.hasOwn(payload, "body") || payload.body === undefined) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "A saved draft carries the document body, so save it from the editor rather than here." });
      return;
    }
    const parsed = parseDocument(payload.body);
    if (parsed.status === "valid") return;
    for (const issue of parsed.issues) ctx.addIssue({ code: "custom", path: bodyFieldPath(issue.path), message: issue.message });
  });
/** The two release modes a submission asks for, in the store's own spelling: the closed pair the editor's publishing preference also states, so a widened list stops compiling here rather than sending a mode the service refuses at submit time. */
export const SUBMISSION_NOTIFY_MODES = ["publish-only", "publish-and-notify"] as const;
export type SubmissionNotifyMode = (typeof SUBMISSION_NOTIFY_MODES)[number];
/** Feeds `submitForReview`: the exact revision to freeze and the release mode the submission records; a submission that states no mode keeps the service's default of `publish-only`. */
export const submitForReviewSchema = z.strictObject({ variantId: contentIdSchema, revisionId: contentIdSchema, notifyMode: z.enum(SUBMISSION_NOTIFY_MODES, { error: "Choose how this submission asks for its release: publish only, or publish and notify now." }).optional() });
export type CreateVariantPayload = z.infer<typeof createVariantSchema>;
export type SaveDraftPayload = z.infer<typeof saveDraftSchema>;
export type SubmitForReviewPayload = z.infer<typeof submitForReviewSchema>;
export const REVIEW_REASON_MAX_CHARS = 2000;
export const approveCandidateSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  revisionId: contentIdSchema,
  contentChecksum: z
    .string({ error: "Approval names the checksum of the revision you read, so approve the candidate from its review panel rather than here." })
    .trim()
    .min(1, "Approve the candidate from its review panel, which carries the checksum of the revision you read. " + REVIEW_ROUND_NOTE.approvalIsPerVariant)
    .max(64, "That checksum is longer than any this application produces, so approve the candidate from its review panel rather than pasting one."),
});
export const requestChangesSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  reason: z
    .string({ error: "Say what needs changing, as a note on this candidate rather than a message to anyone." })
    .trim()
    .min(1, "Say what needs changing so the author can act on it. " + REVIEW_ROUND_NOTE.furtherRoundIsNewSubmission)
    .max(REVIEW_REASON_MAX_CHARS, `Keep the note to ${REVIEW_REASON_MAX_CHARS} characters, which is all this review record ` + "holds, so point at what needs changing and leave the rewriting to the author."),
});
export const restoreRevisionAsDraftSchema = z.strictObject({ revisionId: contentIdSchema });
export type ApproveCandidatePayload = z.infer<typeof approveCandidateSchema>;
export type RequestChangesPayload = z.infer<typeof requestChangesSchema>;
export type RestoreRevisionAsDraftPayload = z.infer<typeof restoreRevisionAsDraftSchema>;
/** The release choices a release selection states, in the review surface's client spelling: a submission records the same choice in the store's own words — `SUBMISSION_NOTIFY_MODES`, which ends `notify` rather than `notify-now` — and the two are mapped, never merged. */
export const PUBLISH_MODES = ["publish-only", "publish-and-notify-now"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];
const PUBLISH_MODE_PARITY = { "publish-only": "publish-only", "publish-and-notify-now": "publish-and-notify-now" } as const satisfies Readonly<Record<keyof typeof PUBLISH_MODE_LABELS, PublishMode> & Record<PublishMode, keyof typeof PUBLISH_MODE_LABELS>>;
const NOTIFY_NOW_MODE = PUBLISH_MODE_PARITY["publish-and-notify-now"];
export const publishSelectionSchema = z.strictObject({
  variantId: contentIdSchema,
  revisionId: contentIdSchema,
  mode: z.enum(PUBLISH_MODES, { error: "Choose how this edition is released: publish only, or publish and notify now." }),
  candidateNotifyAdmitted: z.boolean({ error: "This release needs the candidate's own notification policy, so reopen the review and choose the publish choice again." }),
});
export const publishVariantsSchema = z.strictObject({ documentId: contentIdSchema, variants: z.array(publishSelectionSchema).min(1, "Choose at least one variant edition to release.") }).superRefine((payload, ctx) => {
  const selected = new Set<string>();
  payload.variants.forEach((selection, index) => {
    if (selection.mode === NOTIFY_NOW_MODE && selection.candidateNotifyAdmitted === false) ctx.addIssue({ code: "custom", path: ["variants", index, "mode"], message: REVIEW_ROUND_NOTE.reviewerCannotAddNotify });
    if (selected.has(selection.variantId)) {
      ctx.addIssue({ code: "custom", path: ["variants", index, "variantId"], message: "This release lists the same variant edition twice, so remove the repeated entry: one publication releases each edition once." });
      return;
    }
    selected.add(selection.variantId);
  });
});
export type PublishSelection = z.infer<typeof publishSelectionSchema>;
export type PublishVariantsPayload = z.infer<typeof publishVariantsSchema>;
/** A repeat names the notice that recorded the failure rather than the recipients it is about: the service decides which copies definitely failed, and the stated instant is that notice's own, so no recipient list or dedupe key is computed here. */ export const requestNotificationSchema = z.strictObject(
  {
    documentId: contentIdSchema,
    variantId: contentIdSchema,
    releaseId: contentIdSchema,
    acknowledgedCeiling: z
      .number({ error: "A notice request states the ceiling you acknowledged as a number, so submit it from the publish review screen rather than building one by hand." })
      .int("State the ceiling as a whole number — the eligible count the review screen showed you.")
      .min(0, "A ceiling is a count, so the lowest it can be is zero: zero means nobody is eligible for this notice right now."),
    repeatOfIntentId: contentIdSchema.optional(),
    intendedAt: z.iso.datetime({ offset: true, error: "A notice's intended instant is the one its record states, so take it from the notice rather than writing one here." }).optional(),
  },
  { error: "A notice request carries the release it is submitted for and the ceiling you acknowledged, and nothing else besides the notice a repeat names and the instant that notice was meant for, so submit it from the publish review screen or the delivery results." },
);
export type RequestNotificationPayload = z.infer<typeof requestNotificationSchema>;
export const withdrawUpdateSchema = z.strictObject({ documentId: contentIdSchema });
export const withdrawLocaleSchema = z.strictObject({ variantId: contentIdSchema });
export type WithdrawUpdatePayload = z.infer<typeof withdrawUpdateSchema>;
export type WithdrawLocalePayload = z.infer<typeof withdrawLocaleSchema>;
export const PLACEMENT_TEXT_MAX_CHARS = 4_000;
const CAPTION_LABEL_MAX_CHARS = 120;
const REFUSAL_NEXT_STEP = mediaStateReason("rejected").action ?? "";
const refusal = (problem: string): string => (REFUSAL_NEXT_STEP.length === 0 ? problem : `${problem} ${REFUSAL_NEXT_STEP}`);
function formatByteLimit(bytes: number): string {
  const mebibytes = (bytes / 1024) * 1024;
  return `${Number.isInteger(mebibytes) ? String(mebibytes) : mebibytes.toFixed(1)} MiB`;
}
const declaredMediaType = (file: File): string | null => {
  const trimmed = (file.type.trim().toLowerCase().split(";")[0] ?? "").trim();
  return trimmed.length === 0 || trimmed === "application/octet-stream" ? null : trimmed;
};
type MediaKind = (typeof MEDIA_KINDS)[number];
export const MEDIA_KINDS = ["image", "video"] as const satisfies readonly MediaAcceptanceSuccess<MediaAssetScope>["kind"][];
const placementTextTooLong = (field: string): string => `The ${field} is longer than the ${PLACEMENT_TEXT_MAX_CHARS} characters one placement field may ` + `hold, so shorten it.`;
const optionalPlacementText = (field: string) =>
  z
    .string({ error: `State the ${field} as text, or leave it out.` })
    .trim()
    .max(PLACEMENT_TEXT_MAX_CHARS, placementTextTooLong(field))
    .optional();
const chosenFile = (message: string) => z.custom<File>((value) => typeof File !== "undefined" && value instanceof File, { error: message });
export const mediaPlacementSchema = z.strictObject({
  altText: z.string({ error: "Describe what this image or video shows." }).trim().min(1, "Describe what this image or video shows.").max(PLACEMENT_TEXT_MAX_CHARS, placementTextTooLong("alternative text")),
  caption: optionalPlacementText("caption"),
  credit: optionalPlacementText("credit"),
  transcript: optionalPlacementText("transcript"),
  language: localeTagSchema.optional(),
});
/** The poster a video carries: its own image file, prepared into a poster rendition, with the alternative text stated beside it. */
const posterSchema = z.strictObject({ file: chosenFile("Choose the image a player shows before this video starts, or leave the poster out."), altText: optionalPlacementText("poster alternative text") });
/** The caption track a video carries: the WebVTT file itself, in the language the placement already states for the media. */ const captionsSchema = z.strictObject({
  file: chosenFile("Choose the WebVTT file this video's cues are in, or leave the caption track out."),
  language: localeTagSchema,
  label: z.string({ error: "State the track's label as text, or leave it out." }).trim().min(1, "State the track's label as text, or leave it out.").max(CAPTION_LABEL_MAX_CHARS, `A track label holds at most ${CAPTION_LABEL_MAX_CHARS} characters, so shorten it.`).optional(),
});
export const registerMediaAssetSchema = z
  .strictObject({ kind: z.enum(MEDIA_KINDS, { error: "Choose whether this file is an image or a video." }), file: chosenFile("Choose a file to upload."), placement: mediaPlacementSchema, poster: posterSchema.optional(), captions: captionsSchema.optional() })
  .superRefine((payload, ctx) => {
    const refuse = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const { file, kind } = payload;
    const declared = declaredMediaType(file);
    const byteLimit = kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
    if (file.size > byteLimit) refuse(["file"], ((kind: MediaKind, limit: number): string => refusal(`This ${kind} is larger than the ${formatByteLimit(limit)} admitted for one ${kind}, so it was ` + `not opened.`))(kind, byteLimit));
    const admitted = kind === "image" ? ((): string => ADMITTED_IMAGE_FORMATS.map((format) => `image/${format}`).join(", "))() : ((): string => ADMITTED_VIDEO_PROFILES.map((profile) => `video/${profile.container}`).join(", "))();
    if (declared !== null && !declared.startsWith(`${kind}/`)) refuse(["file"], refusal(`This ${kind} placement cannot take a file the browser reports as ${declared}; choose one ` + `of ${admitted}, whose content the local pipeline then checks.`));
    // A poster and a caption track belong to a video, and the service states the same rule in the same words.
    if (kind === "image" && payload.poster !== undefined) refuse(["poster"], "A poster belongs to a video, so an image carries none.");
    if (kind === "image" && payload.captions !== undefined) refuse(["captions"], "A caption track belongs to a video, so an image carries none.");
  });
export const removePlacementSchema = z.strictObject({ variantId: contentIdSchema, placementId: contentIdSchema });
export type MediaPlacement = z.infer<typeof mediaPlacementSchema>;
export type RegisterMediaAssetPayload = z.infer<typeof registerMediaAssetSchema>;
export type RemovePlacementPayload = z.infer<typeof removePlacementSchema>;
