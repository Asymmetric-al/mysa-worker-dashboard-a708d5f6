/**
 * Media acceptance and rendition preparation: the media module's entry points.
 */
import { fileTypeFromBuffer, type FileTypeResult } from "file-type";
import { prepareDisplayImage, type AdmittedImageFormat, type ImagePreparationRefusal } from "./image";
import { inspectVideo, preparePlaybackRendition, type AdmittedContainer, type AdmittedVideoCodec, type VideoProfileCheck, type VideoRefusal } from "./video";
// States and purposes, each declared once
/** The six states one media placement can be in, and the only ones. */
export type MediaPreparationState = "selected" | "preparing" | "ready" | "rejected" | "cancelled" | "unavailable";
/** The six states in the order a picker offers them, so no seventh is ever added by accident. */
export const MEDIA_PREPARATION_STATES: readonly MediaPreparationState[] = ["selected", "preparing", "ready", "rejected", "cancelled", "unavailable"];
/** The five purposes a rendition can serve, in the order a placement offers them. */
export const RENDITION_PURPOSES = ["display", "playback", "poster", "captions", "transcript"] as const;
/** One rendition purpose, derived from {@link RENDITION_PURPOSES}. */
export type MediaRenditionPurpose = (typeof RENDITION_PURPOSES)[number];
/** The purposes `prepareRendition()` supplies for an asset that was already accepted. */
export type MediaAncillaryRenditionPurpose = "poster" | "captions" | "transcript";
/** The three ancillary purposes, in the order a placement offers them. */
export const ANCILLARY_RENDITION_PURPOSES: readonly MediaAncillaryRenditionPurpose[] = ["poster", "captions", "transcript"];
/** MIME type stored for a caption track, and for a transcript written as WebVTT. */
export const WEBVTT_MIME_TYPE = "text/vtt";
/** MIME type stored for a transcript written as plain text. */
export const PLAIN_TEXT_MIME_TYPE = "text/plain";
// Preparation descriptors
//
// These are the shapes `registerMediaAsset` maps into the persisted record; the persisted record itself is
// declared once in `data-service/envelope.ts`, so nothing here restates it.
/** The organization and ministry authority a media asset belongs to, exactly as its caller states it. */
export interface MediaAssetScope {
  readonly organizationId: string;
  readonly ministryId: string;
}
/** An opaque, source-qualified reference to the private uploaded original. */
export interface MediaOriginalReference {
  readonly system: string;
  readonly reference: string;
}
/** What the admitted-profile check established about the source file, stated in the profile's own terms. */
export type MediaProfileCheck =
  | {
      readonly kind: "image";
      readonly format: AdmittedImageFormat;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: "video";
      readonly container: AdmittedContainer;
      readonly codec: AdmittedVideoCodec;
      readonly durationS: number;
      readonly width: number;
      readonly height: number;
    };
/** What the post-encode or post-remux check established about the bytes actually served. */
export interface MediaTagVerification {
  readonly checked: boolean;
  readonly residualTags: string[];
}
/** One prepared rendition: the bytes this application serves, with the checks that admitted them. */
export interface MediaRendition {
  readonly assetId: string;
  readonly renditionId: string;
  readonly purpose: MediaRenditionPurpose;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly width?: number;
  readonly height?: number;
  readonly profileCheck?: MediaProfileCheck;
  readonly tagVerification?: MediaTagVerification;
}
// Refusals
/** Every code this module can return: its own four rules plus each sibling pipeline's own vocabulary, carried through unchanged so one implementation owns each profile's reasons. */
export type MediaRefusalCode =
  | ImagePreparationRefusal["code"]
  | VideoRefusal["code"]
  | "kind-mismatch"
  | "alt-text-required"
  | "invalid-captions"
  | "invalid-transcript"
  | "use-acceptance-entry-point"
  | "unsupported-rendition-purpose";
/** A refused upload or rendition: returned as a value, with what to do next when there is something to do. */
export interface MediaRefusal {
  readonly state: "rejected";
  readonly code: MediaRefusalCode;
  readonly message: string;
  readonly action?: string;
}
// Inputs and results
/** What every acceptance needs, whatever the kind: the caller's identity and scope, and the bytes received. */
export interface MediaAcceptanceInput<S extends MediaAssetScope> {
  readonly assetId: string;
  readonly scope: S;
  readonly sourceOriginalRef: MediaOriginalReference;
  readonly bytes: Uint8Array;
  readonly sourceName?: string;
  readonly variant?: string;
}
/** An image acceptance: the profile's alternative text is required, its caption optional. */
export interface AcceptImageInput<S extends MediaAssetScope> extends MediaAcceptanceInput<S> {
  readonly altText: string;
  readonly caption?: string;
}
/** A video acceptance: the video profile supplies no text fields of its own. */
export type AcceptVideoInput<S extends MediaAssetScope> = MediaAcceptanceInput<S>;
/** An accepted file: the admitted profile, the renditions prepared for it, and the checks that admitted them. */
export interface MediaAcceptanceSuccess<S extends MediaAssetScope> {
  readonly state: "ready";
  readonly kind: "image" | "video";
  readonly assetId: string;
  readonly scope: S;
  readonly sourceOriginalRef: MediaOriginalReference;
  readonly profileCheck: MediaProfileCheck;
  readonly renditions: MediaRendition[];
  readonly tagVerification: MediaTagVerification;
  readonly altText?: string;
  readonly caption?: string;
}
/** The outcome of one acceptance: an accepted asset, or the refusal that left the draft untouched. */
export type MediaAcceptanceResult<S extends MediaAssetScope = MediaAssetScope> = MediaAcceptanceSuccess<S> | MediaRefusal;
/** What `prepareRendition()` needs: the asset the rendition belongs to, its purpose, and the supplied bytes. */
export interface PrepareRenditionInput {
  readonly assetId: string;
  readonly purpose: MediaRenditionPurpose;
  readonly bytes: Uint8Array;
  readonly altText?: string;
  readonly sourceName?: string;
  readonly variant?: string;
}
/** A prepared ancillary rendition. */
export interface MediaRenditionSuccess {
  readonly state: "ready";
  readonly assetId: string;
  readonly rendition: MediaRendition;
  readonly altText?: string;
}
/** The outcome of one ancillary preparation: the rendition, or the refusal that changed nothing. */
export type MediaRenditionResult = MediaRenditionSuccess | MediaRefusal;
// The two acceptance entry points
/** Accepts one still image: types it by content, requires its alternative text, and returns the display rendition. */
export async function acceptImage<S extends MediaAssetScope>(input: AcceptImageInput<S>): Promise<MediaAcceptanceResult<S>> {
  const detected = await detectKind(input.bytes);
  if (detected !== null && isVideoKind(detected)) {
    return refuse("kind-mismatch", "This file is a video, so it cannot be accepted as an image.", "Choose a JPEG, PNG or WebP image, or add the video as a video placement.");
  }
  const altText = trimmedOrEmpty(input.altText);
  if (altText.length === 0) {
    return refuse("alt-text-required", "An image needs alternative text describing what it shows before it can be placed.", "Describe what the image shows, then choose the file again.");
  }
  const prepared = await prepareDisplayImage({
    bytes: input.bytes,
    sourceName: input.sourceName,
    assetId: input.assetId,
  });
  if (prepared.ok === false) return refused(prepared);
  const profileCheck: MediaProfileCheck = {
    kind: "image",
    format: prepared.profileCheck.format,
    width: prepared.profileCheck.width,
    height: prepared.profileCheck.height,
  };
  const tagVerification: MediaTagVerification = {
    checked: prepared.tagVerification.checked,
    residualTags: [...prepared.tagVerification.residualTags],
  };
  const caption = trimmedOrAbsent(input.caption);
  return {
    state: "ready",
    kind: "image",
    assetId: input.assetId,
    scope: input.scope,
    sourceOriginalRef: input.sourceOriginalRef,
    profileCheck,
    renditions: [
      {
        assetId: input.assetId,
        renditionId: renditionIdFor(input.assetId, "display", input.variant),
        purpose: "display",
        mimeType: prepared.mimeType,
        bytes: prepared.bytes,
        width: prepared.width,
        height: prepared.height,
        profileCheck,
        tagVerification,
      },
    ],
    tagVerification,
    altText,
    ...(caption === undefined ? {} : { caption }),
  };
}
/** Accepts one video: types it by content, gates the admitted profile, and returns the tag-free playback rendition. */
export async function acceptVideo<S extends MediaAssetScope>(input: AcceptVideoInput<S>): Promise<MediaAcceptanceResult<S>> {
  const detected = await detectKind(input.bytes);
  if (detected !== null && isImageKind(detected)) {
    return refuse(
      "kind-mismatch",
      "This file is a still image, so it cannot be accepted as a video.",
      "Choose an MP4 (H.264 video with AAC audio) or a WebM (VP8 or VP9 video with Vorbis or Opus audio).",
    );
  }
  const inspection = await inspectVideo({ bytes: input.bytes });
  if (inspection.ok === false) return refused(inspection);
  const preparation = await preparePlaybackRendition({ bytes: input.bytes });
  if (preparation.ok === false) return refused(preparation);
  const profileCheck = videoProfileCheck(preparation.profileCheck);
  const tagVerification: MediaTagVerification = {
    checked: preparation.tagVerification.checked,
    residualTags: [...preparation.tagVerification.residualTags],
  };
  return {
    state: "ready",
    kind: "video",
    assetId: input.assetId,
    scope: input.scope,
    sourceOriginalRef: input.sourceOriginalRef,
    profileCheck: videoProfileCheck(inspection.profileCheck),
    renditions: [
      {
        assetId: input.assetId,
        renditionId: renditionIdFor(input.assetId, "playback", input.variant),
        purpose: "playback",
        mimeType: preparation.mimeType,
        bytes: preparation.bytes,
        width: preparation.profileCheck.width,
        height: preparation.profileCheck.height,
        profileCheck,
        tagVerification,
      },
    ],
    tagVerification,
  };
}
// Ancillary renditions
/** Prepares one ancillary rendition for an asset that was already accepted. */
export async function prepareRendition(input: PrepareRenditionInput): Promise<MediaRenditionResult> {
  switch (input.purpose) {
    case "poster":
      return preparePoster(input);
    case "captions":
      return prepareTextRendition(input, "captions");
    case "transcript":
      return prepareTextRendition(input, "transcript");
    case "display":
      return refuse(
        "use-acceptance-entry-point",
        "A display rendition is produced by accepting the image itself: call acceptImage() with the image's asset identity and it returns that rendition.",
        "Choose the image through the image picker.",
      );
    case "playback":
      return refuse(
        "use-acceptance-entry-point",
        "A playback rendition is produced by accepting the video itself: call acceptVideo() with the video's asset identity and it returns that rendition.",
        "Choose the video through the video picker.",
      );
    default:
      return refuse(
        "unsupported-rendition-purpose",
        "That rendition purpose is not one this module prepares; it prepares poster, captions and transcript renditions.",
        "Add a poster image, a caption track or a transcript instead.",
      );
  }
}
async function preparePoster(input: PrepareRenditionInput): Promise<MediaRenditionResult> {
  const altText = trimmedOrEmpty(input.altText);
  if (altText.length === 0) {
    return refuse(
      "alt-text-required",
      "A poster needs alternative text describing what it shows, because it stands in for the video wherever the video cannot be played.",
      "Describe what the poster shows, then choose the image again.",
    );
  }
  const prepared = await prepareDisplayImage({
    bytes: input.bytes,
    sourceName: input.sourceName,
    assetId: input.assetId,
  });
  if (prepared.ok === false) return refused(prepared);
  return {
    state: "ready",
    assetId: input.assetId,
    altText,
    rendition: {
      assetId: input.assetId,
      renditionId: renditionIdFor(input.assetId, "poster", input.variant),
      purpose: "poster",
      mimeType: prepared.mimeType,
      bytes: prepared.bytes,
      width: prepared.width,
      height: prepared.height,
      profileCheck: {
        kind: "image",
        format: prepared.profileCheck.format,
        width: prepared.profileCheck.width,
        height: prepared.profileCheck.height,
      },
      tagVerification: {
        checked: prepared.tagVerification.checked,
        residualTags: [...prepared.tagVerification.residualTags],
      },
    },
  };
}
function prepareTextRendition(input: PrepareRenditionInput, purpose: MediaAncillaryRenditionPurpose): MediaRenditionResult {
  const isCaptions = purpose === "captions";
  const code = isCaptions ? "invalid-captions" : "invalid-transcript";
  const noun = isCaptions ? "caption track" : "transcript";
  const decoded = decodeUtf8(input.bytes);
  if (decoded === null) {
    return refuse(code, `The ${noun} is not valid UTF-8 text, so it was not accepted.`, `Save the ${noun} as UTF-8 and choose it again.`);
  }
  const text = stripLeadingByteOrderMark(decoded);
  if (text.trim().length === 0) {
    return refuse(code, `The ${noun} holds no text, so it was not accepted.`, `Add the ${noun} and choose the file again.`);
  }
  if (carriesNonTextBytes(text)) {
    return refuse(code, `The ${noun} carries bytes that a text document cannot hold, so it was not accepted.`, `Save the ${noun} as a text file and choose it again.`);
  }
  const lines = splitLines(text);
  const header = firstNonBlankLine(lines);
  const isWebVtt = header !== null && isWebVttHeaderLine(header);
  if (isCaptions) {
    if (!isWebVtt) {
      return refuse(
        code,
        "The caption track is not a WebVTT document, so it was not accepted; its first non-blank line must be the WEBVTT header.",
        "Add the WEBVTT header line to the caption track and choose the file again.",
      );
    }
    if (!hasCuePayload(lines)) {
      return refuse(code, "The caption track carries no cue with text, so it was not accepted.", "Add at least one cue with its text to the caption track and choose the file again.");
    }
  }
  return {
    state: "ready",
    assetId: input.assetId,
    rendition: {
      assetId: input.assetId,
      renditionId: renditionIdFor(input.assetId, purpose, input.variant),
      purpose,
      mimeType: isWebVtt ? WEBVTT_MIME_TYPE : PLAIN_TEXT_MIME_TYPE,
      bytes: encodeUtf8(text),
    },
  };
}
// State reasons
/** What a picker shows for one state: a short label and, where the worker can act, the next step. */
export interface MediaStateReason {
  readonly label: string;
  readonly action?: string;
}
const REJECTED_WITHOUT_REFUSAL: MediaStateReason = {
  label: "This file was not accepted.",
  action: "Choose a different file.",
};
const CANCELLED_REASON: MediaStateReason = {
  label: "The upload was cancelled; nothing was added and the rest of the draft is unchanged.",
  action: "Choose the file again when you are ready.",
};
const UNAVAILABLE_REASON: MediaStateReason = {
  label: "This media file is unavailable, so it cannot be shown or played right now.",
  action: "Try again, or replace the placement with another file.",
};
/** The label and next step for one media state, so no surface renders a silent empty slot. */
export function mediaStateReason(state: MediaPreparationState, refusal?: MediaRefusal): MediaStateReason {
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
  // A caller outside the type system can pass a state this module does not know. Nothing is known about such a
  // placement, and the honest answer to that is the unavailable reason rather than an invented one.
  return UNAVAILABLE_REASON;
}
// Internals
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const UTF8_ENCODER = new TextEncoder();

const BYTE_ORDER_MARK = "\uFEFF";

const LINE_BREAK = /\r\n|\r|\n/;

const WEBVTT_HEADER = "WEBVTT";

const CUE_TIMING_ARROW = "-->";

const TEXT_CONTROL_CODES: readonly number[] = [0x09, 0x0a, 0x0d];

const END_OF_C0_CONTROLS = 0x20;

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}
function encodeUtf8(text: string): Uint8Array {
  return UTF8_ENCODER.encode(text);
}
function stripLeadingByteOrderMark(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
}
function carriesNonTextBytes(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= END_OF_C0_CONTROLS) continue;
    if (TEXT_CONTROL_CODES.includes(code)) continue;
    return true;
  }
  return false;
}
function splitLines(text: string): string[] {
  return text.split(LINE_BREAK);
}
function firstNonBlankLine(lines: readonly string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}
function isWebVttHeaderLine(line: string): boolean {
  if (line === WEBVTT_HEADER) return true;
  return line.startsWith(`${WEBVTT_HEADER} `) || line.startsWith(`${WEBVTT_HEADER}\t`);
}
function hasCuePayload(lines: readonly string[]): boolean {
  let insideCue = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      insideCue = false;
      continue;
    }
    if (line.includes(CUE_TIMING_ARROW)) {
      insideCue = true;
      continue;
    }
    if (insideCue) return true;
  }
  return false;
}
async function detectKind(bytes: Uint8Array): Promise<FileTypeResult | null> {
  try {
    return (await fileTypeFromBuffer(bytes)) ?? null;
  } catch {
    return null;
  }
}
function isVideoKind(detected: FileTypeResult): boolean {
  return detected.mime.startsWith("video/");
}
function isImageKind(detected: FileTypeResult): boolean {
  return detected.mime.startsWith("image/");
}
function renditionIdFor(assetId: string, purpose: MediaRenditionPurpose, variant: string | undefined): string {
  const suffix = trimmedOrEmpty(variant);
  return suffix.length === 0 ? `${assetId}:${purpose}` : `${assetId}:${purpose}:${suffix}`;
}
function videoProfileCheck(profileCheck: VideoProfileCheck): MediaProfileCheck {
  return {
    kind: "video",
    container: profileCheck.container,
    codec: profileCheck.codec,
    durationS: profileCheck.durationS,
    width: profileCheck.width,
    height: profileCheck.height,
  };
}
function trimmedOrEmpty(value: string | undefined): string {
  return value === undefined ? "" : value.trim();
}
function trimmedOrAbsent(value: string | undefined): string | undefined {
  const trimmed = trimmedOrEmpty(value);
  return trimmed.length === 0 ? undefined : trimmed;
}
function refuse(code: MediaRefusalCode, message: string, action?: string): MediaRefusal {
  return action === undefined ? { state: "rejected", code, message } : { state: "rejected", code, message, action };
}
function refused(refusal: ImagePreparationRefusal | VideoRefusal): MediaRefusal {
  return refuse(refusal.code, refusal.message, refusal.action);
}
