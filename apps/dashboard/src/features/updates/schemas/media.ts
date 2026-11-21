/**
 * The Ministry Updates family's media payload schemas: `registerMediaAsset`, `replacePlacement` and
 * `removePlacement`, together with the placement descriptor all three read.
 */
import { z } from "zod";
import { mediaStateReason, type MediaAcceptanceSuccess, type MediaAssetScope } from "@/modules/media/asset";
import { ADMITTED_IMAGE_FORMATS, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE_PX } from "@/modules/media/image";
import { ADMITTED_VIDEO_PROFILES, VIDEO_MAX_BYTES, VIDEO_MAX_DURATION_S, VIDEO_MAX_HEIGHT, VIDEO_MAX_WIDTH } from "@/modules/media/video";
import { contentIdSchema, localeTagSchema } from "./draft";
// The one bound this family states for itself
/** Longest free text one placement field of this family may carry, in characters. */
export const PLACEMENT_TEXT_MAX_CHARS = 4_000;
// Readable refusals, stated from the profile's own numbers
const BYTES_PER_MEBIBYTE = 1024 * 1024;

const SECONDS_PER_MINUTE = 60;

const REFUSAL_NEXT_STEP = mediaStateReason("rejected").action ?? "";

function refusal(problem: string): string {
  return REFUSAL_NEXT_STEP.length === 0 ? problem : `${problem} ${REFUSAL_NEXT_STEP}`;
}
function formatByteLimit(bytes: number): string {
  const mebibytes = bytes / BYTES_PER_MEBIBYTE;
  const shown = Number.isInteger(mebibytes) ? String(mebibytes) : mebibytes.toFixed(1);
  return `${shown} MiB`;
}
function formatDurationLimit(seconds: number): string {
  if (seconds % SECONDS_PER_MINUTE !== 0) return `${seconds} seconds`;
  const minutes = seconds / SECONDS_PER_MINUTE;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
function admittedImageTypes(): string {
  return ADMITTED_IMAGE_FORMATS.map((format) => `image/${format}`).join(", ");
}
function admittedVideoTypes(): string {
  return ADMITTED_VIDEO_PROFILES.map((profile) => `video/${profile.container}`).join(", ");
}
const UNKNOWN_MEDIA_TYPE = "application/octet-stream";

function declaredMediaType(file: File): string | null {
  const [essence = ""] = file.type.trim().toLowerCase().split(";");
  const trimmed = essence.trim();
  return trimmed.length === 0 || trimmed === UNKNOWN_MEDIA_TYPE ? null : trimmed;
}
function tooLargeBytes(kind: MediaKind, limit: number): string {
  return refusal(`This ${kind} is larger than the ${formatByteLimit(limit)} admitted for one ${kind}, so it was ` + `not opened.`);
}
function tooLargeStill(side: "width" | "height", measured: number): string {
  const across = side === "width" ? "wide" : "tall";
  return refusal(`This image is ${measured} pixels ${across}, past the ${IMAGE_MAX_EDGE_PX}-pixel limit on one ` + `side, so it was not opened.`);
}
function tooLongVideo(): string {
  return refusal(`This video runs longer than the ${formatDurationLimit(VIDEO_MAX_DURATION_S)} admitted for one ` + `video, so it was not opened.`);
}
function unreadableDuration(): string {
  return refusal(`The length of this video could not be read, so it could not be checked against the ` + `${formatDurationLimit(VIDEO_MAX_DURATION_S)} admitted for one video.`);
}
function tooLargeVideo(axis: "width" | "height", measured: number): string {
  const limit = axis === "width" ? VIDEO_MAX_WIDTH : VIDEO_MAX_HEIGHT;
  const across = axis === "width" ? "wide" : "tall";
  return refusal(`This video is ${measured} pixels ${across}, past the ${limit} pixels admitted across that side ` + `of one video, so it was not opened.`);
}
// The two kinds this family registers
/** The kinds a registration names, tied to the media module's own accepted kinds so a kind added there fails this file's compilation instead of becoming unregisterable here. */
export const MEDIA_KINDS = ["image", "video"] as const satisfies readonly MediaAcceptanceSuccess<MediaAssetScope>["kind"][];

type MediaKind = (typeof MEDIA_KINDS)[number];
// The placement descriptor: what a reader is told about the media
function placementTextTooLong(field: string): string {
  return `The ${field} is longer than the ${PLACEMENT_TEXT_MAX_CHARS} characters one placement field may ` + `hold, so shorten it.`;
}
function optionalPlacementText(field: string) {
  return z
    .string({ error: `State the ${field} as text, or leave it out.` })
    .trim()
    .max(PLACEMENT_TEXT_MAX_CHARS, placementTextTooLong(field))
    .optional();
}
/** What one placement says about the media it shows. */
export const mediaPlacementSchema = z.strictObject({
  altText: z
    .string({ error: "Describe what this image or video shows." })
    .trim()
    .min(1, "Describe what this image or video shows.")
    .max(PLACEMENT_TEXT_MAX_CHARS, placementTextTooLong("alternative text")),
  caption: optionalPlacementText("caption"),
  credit: optionalPlacementText("credit"),
  transcript: optionalPlacementText("transcript"),
  language: localeTagSchema.optional(),
  posterAssetId: contentIdSchema.optional(),
});
// What the picker measured, before the file is uploaded
const mediaProbeSchema = z.strictObject({
  width: z.number({ error: "The width the picker measured must be a number of pixels." }).positive({ error: "The width the picker measured must be more than zero pixels." }).optional(),
  height: z.number({ error: "The height the picker measured must be a number of pixels." }).positive({ error: "The height the picker measured must be more than zero pixels." }).optional(),
  durationSeconds: z
    .number({ error: "The duration the picker measured must be a number of seconds." })
    .positive({ error: "The duration the picker measured must be more than zero seconds." })
    .optional(),
});
// registerMediaAsset
/** Feeds `registerMediaAsset`: one chosen file, the numbers the picker measured from it, and the descriptor its placement will carry. */
export const registerMediaAssetSchema = z
  .strictObject({
    kind: z.enum(MEDIA_KINDS, { error: "Choose whether this file is an image or a video." }),
    file: z.custom<File>((value) => typeof File !== "undefined" && value instanceof File, {
      error: "Choose a file to upload.",
    }),
    probe: mediaProbeSchema.optional(),
    placement: mediaPlacementSchema,
  })
  .superRefine((payload, ctx) => {
    const refuse = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: "custom", path, message });
    };
    const { file, kind, probe } = payload;
    const declared = declaredMediaType(file);
    // The byte ceiling is a property of the upload itself, so it is settled before anything about the
    // file's shape is considered: it is the one limit that cannot depend on a measurement.
    const byteLimit = kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
    if (file.size > byteLimit) {
      refuse(["file"], tooLargeBytes(kind, byteLimit));
    }
    // Only a hint from another media class is refused, and an absent or unknown hint refuses nothing.
    const admitted = kind === "image" ? admittedImageTypes() : admittedVideoTypes();
    if (declared !== null && !declared.startsWith(`${kind}/`)) {
      refuse(["file"], refusal(`This ${kind} placement cannot take a file the browser reports as ${declared}; choose one ` + `of ${admitted}, whose content the local pipeline then checks.`));
    }
    if (kind === "image") {
      const { width, height } = probe ?? {};
      if (width !== undefined && width > IMAGE_MAX_EDGE_PX) {
        refuse(["probe", "width"], tooLargeStill("width", width));
      }
      if (height !== undefined && height > IMAGE_MAX_EDGE_PX) {
        refuse(["probe", "height"], tooLargeStill("height", height));
      }
      return;
    }
    if (probe === undefined) {
      refuse(["probe"], unreadableDuration());
      return;
    }
    if (probe.durationSeconds === undefined) {
      refuse(["probe", "durationSeconds"], unreadableDuration());
    } else if (probe.durationSeconds > VIDEO_MAX_DURATION_S) {
      refuse(["probe", "durationSeconds"], tooLongVideo());
    }
    if (probe.width !== undefined && probe.width > VIDEO_MAX_WIDTH) {
      refuse(["probe", "width"], tooLargeVideo("width", probe.width));
    }
    if (probe.height !== undefined && probe.height > VIDEO_MAX_HEIGHT) {
      refuse(["probe", "height"], tooLargeVideo("height", probe.height));
    }
  });
// replacePlacement and removePlacement
/** Feeds `replacePlacement`: one existing placement of one variant, and the descriptor that replaces it. */
export const replacePlacementSchema = z.strictObject({
  variantId: contentIdSchema,
  placementId: contentIdSchema,
  placement: mediaPlacementSchema,
});
/** Feeds `removePlacement`: one existing placement of one variant, and nothing else. */
export const removePlacementSchema = z.strictObject({
  variantId: contentIdSchema,
  placementId: contentIdSchema,
});
// Payload types: inferred from the schemas, never written beside them
/** The descriptor one placement carries, inferred so the editor and the picker read one shape. */
export type MediaPlacement = z.infer<typeof mediaPlacementSchema>;
/** The payload `registerMediaAsset` accepts, inferred so its form and its hook cannot drift apart. */
export type RegisterMediaAssetPayload = z.infer<typeof registerMediaAssetSchema>;
/** The payload `replacePlacement` accepts, inferred so a replace cannot restate the descriptor. */
export type ReplacePlacementPayload = z.infer<typeof replacePlacementSchema>;
/** The payload `removePlacement` accepts, inferred so a removal carries nothing a removal cannot mean. */
export type RemovePlacementPayload = z.infer<typeof removePlacementSchema>;
