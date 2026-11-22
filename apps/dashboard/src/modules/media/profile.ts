/**
 * The media profile vocabulary both sides of the browser boundary validate against: the admitted image families, the
 * admitted video container-and-codec pairs, the limits each one is measured by, and the words each preparation state
 * carries.
 *
 * Pure values and types only, and deliberately nothing else. A chosen file is checked against these limits in the
 * browser before it is sent — the media picker states them before a file is chosen — so nothing here may reach a
 * decoder: `image.ts` imports `sharp` and `video.ts` imports `mediabunny`, and either one in a client bundle is a
 * native module the browser cannot load. The server re-checks the real content with those pipelines in `image.ts`,
 * `video.ts` and `asset.ts`, and each pipeline imports its values from here and re-exports them so every existing
 * consumer keeps the surface it already had; the values are declared once, so the two sides can never disagree about
 * a limit.
 */

// ------------------------------------------------------------------------------------------------
// Images
// ------------------------------------------------------------------------------------------------

/** Largest admitted image file in bytes: a file of exactly 10 MiB is admitted, and one byte more is refused before any decoder sees it. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Largest admitted edge in pixels, measured after EXIF orientation is applied; exactly 8,000 is admitted. */
export const IMAGE_MAX_EDGE_PX = 8000;

/** Longest edge of the display rendition in pixels; an image already smaller than this is never enlarged. */
export const IMAGE_DISPLAY_MAX_EDGE_PX = 2000;

/** The still-image families this pipeline admits. */
export const ADMITTED_IMAGE_FORMATS = ["jpeg", "png", "webp"] as const;

export type AdmittedImageFormat = (typeof ADMITTED_IMAGE_FORMATS)[number];

export type AdmittedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

// ------------------------------------------------------------------------------------------------
// Video
// ------------------------------------------------------------------------------------------------

/** Largest accepted upload in bytes; a file of exactly this size is accepted. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/** Longest accepted duration in seconds, taken from the container; exactly this duration is accepted. */
export const VIDEO_MAX_DURATION_S = 180;

/** Widest accepted display width in pixels, measured after rotation. */
export const VIDEO_MAX_WIDTH = 1920;

/** Tallest accepted display height in pixels, measured after rotation. */
export const VIDEO_MAX_HEIGHT = 1080;

/** The admitted container-to-codec pairs; a file outside these pairs is refused. */
export const ADMITTED_VIDEO_PROFILES = [
  { container: "mp4", video: ["avc"], audio: ["aac"] },
  { container: "webm", video: ["vp8", "vp9"], audio: ["vorbis", "opus"] },
] as const;

export type AdmittedVideoProfile = (typeof ADMITTED_VIDEO_PROFILES)[number];

export type AdmittedContainer = AdmittedVideoProfile["container"];

export type AdmittedVideoCodec = AdmittedVideoProfile["video"][number];

export type AdmittedAudioCodec = AdmittedVideoProfile["audio"][number];

// ------------------------------------------------------------------------------------------------
// Preparation states
// ------------------------------------------------------------------------------------------------

/** The six states one media placement can be in, and the only ones. */
export type MediaPreparationState = "selected" | "preparing" | "ready" | "rejected" | "cancelled" | "unavailable";

export const MEDIA_PREPARATION_STATES: readonly MediaPreparationState[] = ["selected", "preparing", "ready", "rejected", "cancelled", "unavailable"];

/** The two facts a surface states about a placement's state: what it is, and what to do next when there is something to do. */
export type MediaStateReason = { readonly label: string; readonly action?: string };

/** What a refusal has to carry for its words to be stated: its message, and the next step when the pipeline knows one. */
export type MediaRefusalWords = { readonly message: string; readonly action?: string };

const REJECTED_WITHOUT_REFUSAL: MediaStateReason = { label: "This file was not accepted.", action: "Choose a different file." };

const CANCELLED_REASON: MediaStateReason = { label: "The upload was cancelled; nothing was added and the rest of the draft is unchanged.", action: "Choose the file again when you are ready." };

const UNAVAILABLE_REASON: MediaStateReason = { label: "This media file is unavailable, so it cannot be shown or played right now.", action: "Try again, or replace the placement with another file." };

export function mediaStateReason(state: MediaPreparationState, refusal?: MediaRefusalWords): MediaStateReason {
  switch (state) {
    case "selected":
      return { label: "Selected; this file has not been checked yet." };
    case "preparing":
      return { label: "Checking this file with the local media pipeline." };
    case "ready":
      return { label: "Ready." };
    case "rejected": {
      if (refusal === undefined) return REJECTED_WITHOUT_REFUSAL;
      return refusal.action === undefined ? { label: refusal.message } : { label: refusal.message, action: refusal.action };
    }
    case "cancelled":
      return CANCELLED_REASON;
    case "unavailable":
      return UNAVAILABLE_REASON;
  }
  // A caller outside the type system can pass a state this module does not know: nothing is known about such a placement, and the honest answer is the unavailable reason rather than an invented one.
  return UNAVAILABLE_REASON;
}
