export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_EDGE_PX = 8000;
export const IMAGE_DISPLAY_MAX_EDGE_PX = 2000;
export const ADMITTED_IMAGE_FORMATS = ["jpeg", "png", "webp"] as const;
export type AdmittedImageFormat = (typeof ADMITTED_IMAGE_FORMATS)[number];
export type AdmittedImageMimeType = "image/png" | "image/jpeg" | "image/webp";
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_MAX_DURATION_S = 180;
export const VIDEO_MAX_WIDTH = 1920;
export const VIDEO_MAX_HEIGHT = 1080;
export const ADMITTED_VIDEO_PROFILES = [
  { container: "mp4", video: ["avc"], audio: ["aac"] },
  { container: "webm", video: ["vp8", "vp9"], audio: ["vorbis", "opus"] },
] as const;
export type AdmittedVideoProfile = (typeof ADMITTED_VIDEO_PROFILES)[number];
export type AdmittedContainer = AdmittedVideoProfile["container"];
export type AdmittedVideoCodec = AdmittedVideoProfile["video"][number];
export type AdmittedAudioCodec = AdmittedVideoProfile["audio"][number];
export type MediaPreparationState = "selected" | "preparing" | "ready" | "rejected" | "cancelled" | "unavailable";
export const MEDIA_PREPARATION_STATES: readonly MediaPreparationState[] = ["selected", "preparing", "ready", "rejected", "cancelled", "unavailable"];
export type MediaStateReason = { readonly label: string; readonly action?: string };
export type MediaRefusalWords = { readonly message: string; readonly action?: string };
const REJECTED_WITHOUT_REFUSAL: MediaStateReason = { label: "This file was not accepted.", action: "Choose a different file." };
const CANCELLED_REASON: MediaStateReason = { label: "The upload was cancelled; nothing was added and the rest of the draft is unchanged.", action: "Choose the file again when you are ready." };
const UNAVAILABLE_REASON: MediaStateReason = { label: "This media file is unavailable, so it cannot be shown or played right now.", action: "Try again, or replace the placement with another file." };
const STATE_REASONS: Readonly<Record<Exclude<MediaPreparationState, "rejected">, MediaStateReason>> = {
  selected: { label: "Selected; this file has not been checked yet." },
  preparing: { label: "Checking this file with the local media pipeline." },
  ready: { label: "Ready." },
  cancelled: CANCELLED_REASON,
  unavailable: UNAVAILABLE_REASON,
};
export function mediaStateReason(state: MediaPreparationState, refusal?: MediaRefusalWords): MediaStateReason {
  if (state !== "rejected") return STATE_REASONS[state];
  return refusal === undefined ? REJECTED_WITHOUT_REFUSAL : refusal.action === undefined ? { label: refusal.message } : { label: refusal.message, action: refusal.action };
}
