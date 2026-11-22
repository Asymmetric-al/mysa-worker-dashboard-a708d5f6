/** Media acceptance and rendition preparation: the media module's entry points. */
import { fileTypeFromBuffer, type FileTypeResult } from "file-type";
import { prepareDisplayImage, type AdmittedImageFormat, type ImagePreparationRefusal } from "./image";
import { inspectVideo, preparePlaybackRendition, type AdmittedContainer, type AdmittedVideoCodec, type VideoProfileCheck, type VideoRefusal } from "./video";
import { MEDIA_PREPARATION_STATES, mediaStateReason, type MediaPreparationState, type MediaStateReason } from "./profile";

// The preparation vocabulary and the words each state carries are declared once in `./profile`, which a
// browser surface may state; these re-exports keep this module's own surface exactly as it already was.
export { MEDIA_PREPARATION_STATES, mediaStateReason };
export type { MediaPreparationState, MediaStateReason };
export const RENDITION_PURPOSES = ["display", "playback", "poster", "captions", "transcript"] as const;
export type MediaRenditionPurpose = (typeof RENDITION_PURPOSES)[number];
export type MediaAncillaryRenditionPurpose = "poster" | "captions" | "transcript";
export const ANCILLARY_RENDITION_PURPOSES: readonly MediaAncillaryRenditionPurpose[] = ["poster", "captions", "transcript"];
export const WEBVTT_MIME_TYPE = "text/vtt";
export const PLAIN_TEXT_MIME_TYPE = "text/plain";
// Preparation descriptors: these are the shapes `registerMediaAsset` maps into the persisted record, which is itself declared once in `data-service/envelope.ts`.
export type MediaAssetScope = { readonly organizationId: string; readonly ministryId: string };
export type MediaOriginalReference = { readonly system: string; readonly reference: string };
export type MediaProfileCheck =
  | { readonly kind: "image"; readonly format: AdmittedImageFormat; readonly width: number; readonly height: number }
  | { readonly kind: "video"; readonly container: AdmittedContainer; readonly codec: AdmittedVideoCodec; readonly durationS: number; readonly width: number; readonly height: number };
export type MediaTagVerification = { readonly checked: boolean; readonly residualTags: string[] };
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
/** Every code this module can return: its own four rules plus each sibling pipeline's own vocabulary, carried through unchanged so one implementation owns each profile's reasons. */
export type MediaRefusalCode = ImagePreparationRefusal["code"] | VideoRefusal["code"] | "kind-mismatch" | "alt-text-required" | "invalid-captions" | "invalid-transcript" | "use-acceptance-entry-point" | "unsupported-rendition-purpose";
export type MediaRefusal = { readonly state: "rejected"; readonly code: MediaRefusalCode; readonly message: string; readonly action?: string };
export type MediaAcceptanceInput<S extends MediaAssetScope> = { readonly assetId: string; readonly scope: S; readonly sourceOriginalRef: MediaOriginalReference; readonly bytes: Uint8Array; readonly sourceName?: string; readonly variant?: string };
export interface AcceptImageInput<S extends MediaAssetScope> extends MediaAcceptanceInput<S> {
  readonly altText: string;
  readonly caption?: string;
}
export type AcceptVideoInput<S extends MediaAssetScope> = MediaAcceptanceInput<S>;
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
export type MediaAcceptanceResult<S extends MediaAssetScope = MediaAssetScope> = MediaAcceptanceSuccess<S> | MediaRefusal;
export type PrepareRenditionInput = { readonly assetId: string; readonly purpose: MediaRenditionPurpose; readonly bytes: Uint8Array; readonly altText?: string; readonly sourceName?: string; readonly variant?: string };
export type MediaRenditionSuccess = { readonly state: "ready"; readonly assetId: string; readonly rendition: MediaRendition; readonly altText?: string };
export type MediaRenditionResult = MediaRenditionSuccess | MediaRefusal;
/** Accepts one still image: types it by content, requires its alternative text, and returns the display rendition. */
export async function acceptImage<S extends MediaAssetScope>(input: AcceptImageInput<S>): Promise<MediaAcceptanceResult<S>> {
  const detected = await detectKind(input.bytes);
  if (detected !== null && isVideoKind(detected)) return refuse("kind-mismatch", "This file is a video, so it cannot be accepted as an image.", "Choose a JPEG, PNG or WebP image, or add the video as a video placement.");
  const altText = trimmedOrEmpty(input.altText);
  if (altText.length === 0) return refuse("alt-text-required", "An image needs alternative text describing what it shows before it can be placed.", "Describe what the image shows, then choose the file again.");
  const prepared = await prepareDisplayImage({ bytes: input.bytes, sourceName: input.sourceName, assetId: input.assetId });
  if (prepared.ok === false) return refused(prepared);
  const profileCheck: MediaProfileCheck = { kind: "image", format: prepared.profileCheck.format, width: prepared.profileCheck.width, height: prepared.profileCheck.height };
  const tagVerification: MediaTagVerification = { checked: prepared.tagVerification.checked, residualTags: [...prepared.tagVerification.residualTags] };
  const caption = trimmedOrAbsent(input.caption);
  return {
    state: "ready",
    kind: "image",
    assetId: input.assetId,
    scope: input.scope,
    sourceOriginalRef: input.sourceOriginalRef,
    profileCheck,
    renditions: [{ assetId: input.assetId, renditionId: renditionIdFor(input.assetId, "display", input.variant), purpose: "display", mimeType: prepared.mimeType, bytes: prepared.bytes, width: prepared.width, height: prepared.height, profileCheck, tagVerification }],
    tagVerification,
    altText,
    ...(caption === undefined ? {} : { caption }),
  };
}
/** Accepts one video: types it by content, gates the admitted profile, and returns the tag-free playback rendition. */
export async function acceptVideo<S extends MediaAssetScope>(input: AcceptVideoInput<S>): Promise<MediaAcceptanceResult<S>> {
  const detected = await detectKind(input.bytes);
  if (detected !== null && isImageKind(detected)) return refuse("kind-mismatch", "This file is a still image, so it cannot be accepted as a video.", "Choose an MP4 (H.264 video with AAC audio) or a WebM (VP8 or VP9 video with Vorbis or Opus audio).");
  const inspection = await inspectVideo({ bytes: input.bytes });
  if (inspection.ok === false) return refused(inspection);
  const preparation = await preparePlaybackRendition({ bytes: input.bytes });
  if (preparation.ok === false) return refused(preparation);
  const profileCheck = videoProfileCheck(preparation.profileCheck);
  const tagVerification: MediaTagVerification = { checked: preparation.tagVerification.checked, residualTags: [...preparation.tagVerification.residualTags] };
  return {
    state: "ready",
    kind: "video",
    assetId: input.assetId,
    scope: input.scope,
    sourceOriginalRef: input.sourceOriginalRef,
    profileCheck: videoProfileCheck(inspection.profileCheck),
    renditions: [{ assetId: input.assetId, renditionId: renditionIdFor(input.assetId, "playback", input.variant), purpose: "playback", mimeType: preparation.mimeType, bytes: preparation.bytes, width: preparation.profileCheck.width, height: preparation.profileCheck.height, profileCheck, tagVerification }],
    tagVerification,
  };
}
export async function prepareRendition(input: PrepareRenditionInput): Promise<MediaRenditionResult> {
  switch (input.purpose) {
    case "poster":
      return preparePoster(input);
    case "captions":
      return prepareTextRendition(input, "captions");
    case "transcript":
      return prepareTextRendition(input, "transcript");
    case "display":
      return refuse("use-acceptance-entry-point", "A display rendition is produced by accepting the image itself: call acceptImage() with the image's asset identity and it returns that rendition.", "Choose the image through the image picker.");
    case "playback":
      return refuse("use-acceptance-entry-point", "A playback rendition is produced by accepting the video itself: call acceptVideo() with the video's asset identity and it returns that rendition.", "Choose the video through the video picker.");
    default:
      return refuse("unsupported-rendition-purpose", "That rendition purpose is not one this module prepares; it prepares poster, captions and transcript renditions.", "Add a poster image, a caption track or a transcript instead.");
  }
}
async function preparePoster(input: PrepareRenditionInput): Promise<MediaRenditionResult> {
  const altText = trimmedOrEmpty(input.altText);
  if (altText.length === 0) return refuse("alt-text-required", "A poster needs alternative text describing what it shows, because it stands in for the video wherever the video cannot be played.", "Describe what the poster shows, then choose the image again.");
  const prepared = await prepareDisplayImage({ bytes: input.bytes, sourceName: input.sourceName, assetId: input.assetId });
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
      profileCheck: { kind: "image", format: prepared.profileCheck.format, width: prepared.profileCheck.width, height: prepared.profileCheck.height },
      tagVerification: { checked: prepared.tagVerification.checked, residualTags: [...prepared.tagVerification.residualTags] },
    },
  };
}
function prepareTextRendition(input: PrepareRenditionInput, purpose: MediaAncillaryRenditionPurpose): MediaRenditionResult {
  const isCaptions = purpose === "captions";
  const code = isCaptions ? "invalid-captions" : "invalid-transcript";
  const noun = isCaptions ? "caption track" : "transcript";
  const decoded = decodeUtf8(input.bytes);
  if (decoded === null) return refuse(code, `The ${noun} is not valid UTF-8 text, so it was not accepted.`, `Save the ${noun} as UTF-8 and choose it again.`);
  const text = stripLeadingByteOrderMark(decoded);
  if (text.trim().length === 0) return refuse(code, `The ${noun} holds no text, so it was not accepted.`, `Add the ${noun} and choose the file again.`);
  if (carriesNonTextBytes(text)) return refuse(code, `The ${noun} carries bytes that a text document cannot hold, so it was not accepted.`, `Save the ${noun} as a text file and choose it again.`);
  const lines = splitLines(text);
  const header = firstNonBlankLine(lines);
  const isWebVtt = header !== null && isWebVttHeaderLine(header);
  if (isCaptions) {
    if (!isWebVtt) return refuse(code, "The caption track is not a WebVTT document, so it was not accepted; its first non-blank line must be the WEBVTT header.", "Add the WEBVTT header line to the caption track and choose the file again.");
    if (!hasCuePayload(lines)) return refuse(code, "The caption track carries no cue with text, so it was not accepted.", "Add at least one cue with its text to the caption track and choose the file again.");
  }
  return { state: "ready", assetId: input.assetId, rendition: { assetId: input.assetId, renditionId: renditionIdFor(input.assetId, purpose, input.variant), purpose, mimeType: isWebVtt ? WEBVTT_MIME_TYPE : PLAIN_TEXT_MIME_TYPE, bytes: encodeUtf8(text) } };
}
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
const encodeUtf8 = (text: string): Uint8Array => UTF8_ENCODER.encode(text);
const stripLeadingByteOrderMark = (text: string): string => (text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text);
function carriesNonTextBytes(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= END_OF_C0_CONTROLS) continue;
    if (TEXT_CONTROL_CODES.includes(code)) continue;
    return true;
  }
  return false;
}
const splitLines = (text: string): string[] => text.split(LINE_BREAK);
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
const isVideoKind = (detected: FileTypeResult): boolean => detected.mime.startsWith("video/");
const isImageKind = (detected: FileTypeResult): boolean => detected.mime.startsWith("image/");
function renditionIdFor(assetId: string, purpose: MediaRenditionPurpose, variant: string | undefined): string {
  const suffix = trimmedOrEmpty(variant);
  return suffix.length === 0 ? `${assetId}:${purpose}` : `${assetId}:${purpose}:${suffix}`;
}
const videoProfileCheck = (profileCheck: VideoProfileCheck): MediaProfileCheck => ({ kind: "video", container: profileCheck.container, codec: profileCheck.codec, durationS: profileCheck.durationS, width: profileCheck.width, height: profileCheck.height });
const trimmedOrEmpty = (value: string | undefined): string => (value === undefined ? "" : value.trim());
function trimmedOrAbsent(value: string | undefined): string | undefined {
  const trimmed = trimmedOrEmpty(value);
  return trimmed.length === 0 ? undefined : trimmed;
}
const refuse = (code: MediaRefusalCode, message: string, action?: string): MediaRefusal => (action === undefined ? { state: "rejected", code, message } : { state: "rejected", code, message, action });
const refused = (refusal: ImagePreparationRefusal | VideoRefusal): MediaRefusal => refuse(refusal.code, refusal.message, refusal.action);
