/**
 * The Ministry Updates family's media payload schemas: `registerMediaAsset`, `replacePlacement` and
 * `removePlacement`, together with the placement descriptor all three read.
 *
 * Scope: AAP 0.6.1 "Mutations: content and media" (`registerMediaAsset`, `replacePlacement`,
 * `removePlacement`); AAP 0.6.3 `POST /api/media` and `GET /api/media/[assetId]/[rendition]`; the
 * AAP 0.7.1 job row "Attach media" (`readMediaAsset` serves a rendition, these three change what a
 * variant places); AAP 0.8.6's image and video profiles; and criteria 9 and 18. The Update editor
 * composes them through `../hooks/use-update-mutations.ts`, and `@/components/media-picker.tsx`
 * renders the form they validate.
 *
 * One schema per named mutation, each naming its own field set, so a body posted to `/api/media` can
 * only ever mean one thing: registering an asset, replacing one placement's description and removing
 * a placement are three different decisions with three different risks. There is no create-or-update
 * form, no field bag and no dispatcher.
 *
 * A schema here validates the **payload alone**. The four-field mutation input — operation identity,
 * selected context, expected revision and the payload — is composed once in
 * `../hooks/use-update-mutations.ts`, so nothing below declares `operationId`, `scope` or
 * `expectedRevision`, and nothing reads a clock or compares a revision.
 *
 * This file is the client's cheap mirror, never the authority. `acceptImage()` and `acceptVideo()` in
 * `@/modules/media/asset` type the bytes by their content, decode them, apply orientation, bound their
 * edges, re-encode them, strip metadata and verify the delivered bytes; the service re-validates every
 * payload and answers with the closed outcome set. What is here exists so the worker is not made to
 * wait for a request that will certainly be refused, and for nothing else — so no step of that
 * pipeline is re-implemented, and no ceiling is restated: every limit comes from
 * `@/modules/media/image` and `@/modules/media/video`, so one number is written once, in the module
 * that owns it.
 *
 * Two things this file deliberately does not carry. The **original name of the chosen file** never
 * travels: the payload holds the `File` itself, because its bytes are what the pipeline reads, and no
 * descriptive field, path or traversal here persists, renders or echoes a name back (AAP 0.8.6;
 * criterion 9's stripped-image assertion). And no **production claim** is made: preparation is local
 * processing that the picker labels as simulated, so no sentence below describes scanning or
 * transcoding, and no placement here can assert a profile fact about the bytes.
 */

import { z } from "zod";

import {
  mediaStateReason,
  type MediaAcceptanceSuccess,
  type MediaAssetScope,
} from "@/modules/media/asset";
import { ADMITTED_IMAGE_FORMATS, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE_PX } from "@/modules/media/image";
import {
  ADMITTED_VIDEO_PROFILES,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_S,
  VIDEO_MAX_HEIGHT,
  VIDEO_MAX_WIDTH,
} from "@/modules/media/video";

import { contentIdSchema, localeTagSchema } from "./draft";

// ---------------------------------------------------------------------------------------------
// The one bound this family states for itself
// ---------------------------------------------------------------------------------------------

/**
 * Longest free text one placement field of this family may carry, in characters.
 *
 * This is this family's own form bound — how far a caption, a credit or a transcript may run before
 * the form asks for something shorter. It is deliberately not a restatement of a profile limit: the
 * media modules bound bytes, pixels and seconds and say nothing about prose, so there is no owned
 * number to import for it. Every free-text field below uses this one value, so two fields of one
 * descriptor cannot drift apart, and the service holds the same payloads to its own validation on
 * submit.
 */
export const PLACEMENT_TEXT_MAX_CHARS = 4_000;

// ---------------------------------------------------------------------------------------------
// Readable refusals, stated from the profile's own numbers
// ---------------------------------------------------------------------------------------------

/** One mebibyte in bytes: the unit both media profiles state their byte ceilings in. */
const BYTES_PER_MEBIBYTE = 1024 * 1024;

/** One minute in seconds, so a duration ceiling can be stated in the unit a worker reads fastest. */
const SECONDS_PER_MINUTE = 60;

/**
 * The next-step sentence the picker shows after a refusal, taken from the media module's own state
 * vocabulary rather than written again here.
 *
 * A refusal is worded once per situation. The picker renders `mediaStateReason()` for the states it
 * holds, and the form renders this file's message for a file it already refused, so taking the advice
 * from that function keeps the two from telling the worker two different things about one file.
 */
const REFUSAL_NEXT_STEP = mediaStateReason("rejected").action ?? "";

/** One refusal in a single line: what is wrong with the chosen file, then the shared next step. */
function refusal(problem: string): string {
  return REFUSAL_NEXT_STEP.length === 0 ? problem : `${problem} ${REFUSAL_NEXT_STEP}`;
}

/** A byte ceiling in the unit its profile states it in: `10 MiB`, `100 MiB`. */
function formatByteLimit(bytes: number): string {
  const mebibytes = bytes / BYTES_PER_MEBIBYTE;
  const shown = Number.isInteger(mebibytes) ? String(mebibytes) : mebibytes.toFixed(1);
  return `${shown} MiB`;
}

/** A duration ceiling in minutes when it divides evenly, in seconds otherwise: `3 minutes`. */
function formatDurationLimit(seconds: number): string {
  if (seconds % SECONDS_PER_MINUTE !== 0) return `${seconds} seconds`;
  const minutes = seconds / SECONDS_PER_MINUTE;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * The still-image families the pipeline admits, named as media types for a refusal.
 *
 * Derived from `ADMITTED_IMAGE_FORMATS`, so the sentence lists exactly what the decoder accepts: the
 * three family names are the subtags their media types use, so nothing is copied to say it.
 */
function admittedImageTypes(): string {
  return ADMITTED_IMAGE_FORMATS.map((format) => `image/${format}`).join(", ");
}

/**
 * The video containers the profile admits, named as media types for a refusal, derived from
 * `ADMITTED_VIDEO_PROFILES` so the sentence cannot promise a container the profile refuses.
 */
function admittedVideoTypes(): string {
  return ADMITTED_VIDEO_PROFILES.map((profile) => `video/${profile.container}`).join(", ");
}

/**
 * The media type a browser reports for a file whose type it could not establish. It is the MIME
 * vocabulary's way of saying "unknown" rather than a claim about the file, so it counts as no hint.
 */
const UNKNOWN_MEDIA_TYPE = "application/octet-stream";

/**
 * The media type the browser reports for the chosen file, or `null` when it reports none.
 *
 * This is a hint about a name, never evidence of content: an operating system maps a name to a type,
 * so a correctly formed image whose name is wrong is reported as something it is not. An absent or
 * unknown hint therefore refuses nothing, and the only hint acted on below is one from a different
 * media class — a video chosen for an image placement, or the reverse — because that mistake is worth
 * catching before an upload rather than after it. Which file a slot actually accepts is settled by
 * `acceptImage()`/`acceptVideo()` from the bytes themselves (AAP 0.8.6: neither a name nor an
 * extension establishes type).
 */
function declaredMediaType(file: File): string | null {
  const [essence = ""] = file.type.trim().toLowerCase().split(";");
  const trimmed = essence.trim();
  return trimmed.length === 0 || trimmed === UNKNOWN_MEDIA_TYPE ? null : trimmed;
}

/** The refusal for a file over the byte ceiling its profile states. */
function tooLargeBytes(kind: MediaKind, limit: number): string {
  return refusal(
    `This ${kind} is larger than the ${formatByteLimit(limit)} admitted for one ${kind}, so it was ` +
      `not opened.`,
  );
}

/** The refusal for a still image past the admitted edge on one side. */
function tooLargeStill(side: "width" | "height", measured: number): string {
  const across = side === "width" ? "wide" : "tall";
  return refusal(
    `This image is ${measured} pixels ${across}, past the ${IMAGE_MAX_EDGE_PX}-pixel limit on one ` +
      `side, so it was not opened.`,
  );
}

/** The refusal for a video longer than the admitted duration. */
function tooLongVideo(): string {
  return refusal(
    `This video runs longer than the ${formatDurationLimit(VIDEO_MAX_DURATION_S)} admitted for one ` +
      `video, so it was not opened.`,
  );
}

/** The refusal for a video whose duration could not be read, which is why it could not be checked. */
function unreadableDuration(): string {
  return refusal(
    `The length of this video could not be read, so it could not be checked against the ` +
      `${formatDurationLimit(VIDEO_MAX_DURATION_S)} admitted for one video.`,
  );
}

/** The refusal for a video past the admitted display width or height, measured after rotation. */
function tooLargeVideo(axis: "width" | "height", measured: number): string {
  const limit = axis === "width" ? VIDEO_MAX_WIDTH : VIDEO_MAX_HEIGHT;
  const across = axis === "width" ? "wide" : "tall";
  return refusal(
    `This video is ${measured} pixels ${across}, past the ${limit} pixels admitted across that side ` +
      `of one video, so it was not opened.`,
  );
}

// ---------------------------------------------------------------------------------------------
// The two kinds this family registers
// ---------------------------------------------------------------------------------------------

/**
 * The kinds a registration names, tied to the media module's own accepted kinds so a kind added
 * there fails this file's compilation instead of becoming unregisterable here.
 */
export const MEDIA_KINDS = [
  "image",
  "video",
] as const satisfies readonly MediaAcceptanceSuccess<MediaAssetScope>["kind"][];

/** One kind of upload a placement can show. */
type MediaKind = (typeof MEDIA_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// The placement descriptor: what a reader is told about the media
// ---------------------------------------------------------------------------------------------

/** The message for free text past this family's bound, naming the field it applies to. */
function placementTextTooLong(field: string): string {
  return (
    `The ${field} is longer than the ${PLACEMENT_TEXT_MAX_CHARS} characters one placement field may ` +
    `hold, so shorten it.`
  );
}

/**
 * One optional free-text field of a placement: trimmed, bounded by this family's one bound, and
 * absent when it was not supplied.
 *
 * A blank value is accepted rather than refused, because a caption of nothing is no caption: the
 * media module trims it to absence when it stores the descriptor, and a form that refused an emptied
 * field would make clearing a caption look like a mistake.
 */
function optionalPlacementText(field: string) {
  return z
    .string({ error: `State the ${field} as text, or leave it out.` })
    .trim()
    .max(PLACEMENT_TEXT_MAX_CHARS, placementTextTooLong(field))
    .optional();
}

/**
 * What one placement says about the media it shows.
 *
 * Alternative text is **required** (AAP 0.8.6), and never derived from the caption: a caption is
 * visible prose about the placement, while alternative text is what a screen-reader user is told
 * instead of the picture, and a video whose playback fails keeps it as its text alternative. The
 * caption, the credit and the transcript are descriptive and therefore optional, because a placement
 * without them is complete rather than incomplete.
 *
 * `language` is the content locale of the media, never the interface language, so a caption track can
 * be described in the language it is written in. `posterAssetId` names an **already registered**
 * poster rendition rather than an address, because every rendition read re-authorises on its own and a
 * placement must never become a way around that.
 *
 * Nothing about the asset's bytes travels here. Its type, size, dimensions, duration and the identity
 * of its renditions belong to the asset record that `registerMediaAsset` creates and the service
 * assigns, so a descriptor cannot assert a profile fact and replacing one cannot quietly re-describe
 * the file behind it.
 */
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

// ---------------------------------------------------------------------------------------------
// What the picker measured, before the file is uploaded
// ---------------------------------------------------------------------------------------------

/**
 * The numbers the picker read from the chosen file's own metadata: the decoded dimensions of a still,
 * and the container's duration and display dimensions for a video.
 *
 * They come from the file, never from its name or its declared type, and they arrive only so the form
 * can refuse a file past a profile ceiling without a request. The service measures the same values
 * from the bytes when it accepts the asset and is the authority on all three, so a payload without
 * them is not a claim that the file is small — only that nothing was measured here.
 */
const mediaProbeSchema = z.strictObject({
  width: z
    .number({ error: "The width the picker measured must be a number of pixels." })
    .positive({ error: "The width the picker measured must be more than zero pixels." })
    .optional(),
  height: z
    .number({ error: "The height the picker measured must be a number of pixels." })
    .positive({ error: "The height the picker measured must be more than zero pixels." })
    .optional(),
  durationSeconds: z
    .number({ error: "The duration the picker measured must be a number of seconds." })
    .positive({ error: "The duration the picker measured must be more than zero seconds." })
    .optional(),
});

// ---------------------------------------------------------------------------------------------
// registerMediaAsset
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `registerMediaAsset`: one chosen file, the numbers the picker measured from it, and the
 * descriptor its placement will carry.
 *
 * The file travels as the `File` the picker selected, because only its bytes can be typed: nothing
 * here reads or forwards a name, and `acceptImage()`/`acceptVideo()` decide from the content what the
 * file is. `kind` states which of those two entry points the service will use, so a video submitted as
 * an image is that module's own `kind-mismatch` refusal rather than a surprise at playback.
 *
 * The refinement applies the imported profile ceilings and only those — the byte ceiling for either
 * kind, the edge limit for a still, the duration and display dimensions for a video — each reported
 * against the field whose value produced it, so the form can show the reason beside the control that
 * fixes it. A still whose dimensions were not measured skips the edge check, because the service
 * still measures them and a form that refused for the absence of a measurement would block a file it
 * cannot judge. A video is different: its duration decides whether it can be shown at all, so a video
 * the picker could not measure is refused here with the reason, rather than uploaded to be refused
 * there.
 */
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
    /** Reports one refusal against the field whose value produced it. */
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
      refuse(
        ["file"],
        refusal(
          `This ${kind} placement cannot take a file the browser reports as ${declared}; choose one ` +
            `of ${admitted}, whose content the local pipeline then checks.`,
        ),
      );
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

// ---------------------------------------------------------------------------------------------
// replacePlacement and removePlacement
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `replacePlacement`: one existing placement of one variant, and the descriptor that replaces it.
 *
 * The descriptor is validated exactly as strictly as a new one — the required alternative text
 * included — so swapping a description is never the way an undescribed image or video gets in. The
 * variant and the placement are the identity of what changes: the asset behind the placement keeps its
 * own identity, its own renditions and its own scope, and nothing in this payload can change or
 * re-describe them.
 */
export const replacePlacementSchema = z.strictObject({
  variantId: contentIdSchema,
  placementId: contentIdSchema,
  placement: mediaPlacementSchema,
});

/**
 * Feeds `removePlacement`: one existing placement of one variant, and nothing else.
 *
 * Removing a placement removes a reference and nothing beside it: a registered asset stays available
 * to every other placement that uses it, and a release that already served the media keeps serving it.
 * Withdrawal is a release decision with its own mutation, its own outcome and its own reach rule, so
 * this payload carries no withdrawal, no reach and no release revision.
 */
export const removePlacementSchema = z.strictObject({
  variantId: contentIdSchema,
  placementId: contentIdSchema,
});

// ---------------------------------------------------------------------------------------------
// Payload types: inferred from the schemas, never written beside them
// ---------------------------------------------------------------------------------------------

/** The descriptor one placement carries, inferred so the editor and the picker read one shape. */
export type MediaPlacement = z.infer<typeof mediaPlacementSchema>;

/** The payload `registerMediaAsset` accepts, inferred so its form and its hook cannot drift apart. */
export type RegisterMediaAssetPayload = z.infer<typeof registerMediaAssetSchema>;

/** The payload `replacePlacement` accepts, inferred so a replace cannot restate the descriptor. */
export type ReplacePlacementPayload = z.infer<typeof replacePlacementSchema>;

/** The payload `removePlacement` accepts, inferred so a removal carries nothing a removal cannot mean. */
export type RemovePlacementPayload = z.infer<typeof removePlacementSchema>;
