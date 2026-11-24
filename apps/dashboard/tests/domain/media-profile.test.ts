/** Proves the image and video profiles that guard every upload (success criteria 9 and 18): a file's kind is established by its content and never by its name, every limit is exact at its boundary and enforced before decode. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { countTextOf } from "@/lib/count-format";
import {
  acceptImage,
  acceptVideo,
  mediaStateReason,
  prepareRendition,
  ANCILLARY_RENDITION_PURPOSES,
  MEDIA_PREPARATION_STATES,
  PLAIN_TEXT_MIME_TYPE,
  WEBVTT_MIME_TYPE,
  type MediaAcceptanceResult,
  type MediaAcceptanceSuccess,
  type MediaAssetScope,
  type MediaPreparationState,
  type MediaRefusal,
  type MediaRenditionResult,
  type MediaRenditionSuccess,
} from "@/modules/media/asset";
import { isAdmittedImageFormat, prepareDisplayImage, ADMITTED_IMAGE_FORMATS, IMAGE_DISPLAY_MAX_EDGE_PX, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE_PX, type ImagePreparationRefusal, type ImagePreparationResult, type ImagePreparationSuccess } from "@/modules/media/image";
import { inspectVideo, preparePlaybackRendition, ADMITTED_VIDEO_PROFILES, VIDEO_MAX_BYTES, VIDEO_MAX_DURATION_S, VIDEO_MAX_HEIGHT, VIDEO_MAX_WIDTH, type VideoInspectionResult, type VideoProfileCheck, type VideoRefusal, type VideoRefusalCode } from "@/modules/media/video";
import { seed, DEFAULT_SESSION_ID, type SeededSessionWithDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { first, firstWhere, throwing } from "../helpers/answers";
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(fileURLToPath(new URL("../../public/fixtures/media/", import.meta.url)), name)));
const SEEDED: readonly SeededSessionWithDocuments[] = await seed();
const ESTABLISHED: SeededSessionWithDocuments = firstWhere(SEEDED, "sessionId", DEFAULT_SESSION_ID, `a seeded session named ${DEFAULT_SESSION_ID}`);
type SeededMediaAsset = SessionStateDocument["mediaAssets"][number];
const SEEDED_ASSETS: readonly SeededMediaAsset[] = ESTABLISHED.documents.state.mediaAssets;
const SEEDED_IMAGE: SeededMediaAsset = firstWhere(SEEDED_ASSETS, "kind", "image", "a seeded image asset");
const PRIVATE_ORIGINAL_REF = SEEDED_IMAGE.sourceOriginalRef;
const SCOPE: MediaAssetScope = { organizationId: SEEDED_IMAGE.scope.organizationId, ministryId: SEEDED_IMAGE.scope.ministryId };
const PRIVATE_ORIGINAL = { system: "local-fixture", reference: PRIVATE_ORIGINAL_REF } as const;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // Images assembled in memory, from the container format rather than from an encoder
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const body = concat([utf8(type), payload]);
  const chunk = new Uint8Array(4 + body.byteLength + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.byteLength);
  chunk.set(body, 4);
  view.setUint32(4 + body.byteLength, crc32(body));
  return chunk;
}
function greyscalePng(width: number, height: number, chunksBeforeImageData: readonly Uint8Array[] = []): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // eight bits per sample
  header[9] = 0; // greyscale: no colour type, no padding, no palette
  return concat([PNG_SIGNATURE, pngChunk("IHDR", header), ...chunksBeforeImageData, pngChunk("IDAT", new Uint8Array(deflateSync(new Uint8Array(height * (width + 1))))), pngChunk("IEND", new Uint8Array(0))]);
}
function animatedPng(width: number, height: number): Uint8Array {
  const animationControl = new Uint8Array(8);
  const view = new DataView(animationControl.buffer);
  view.setUint32(0, 2); // two frames
  return greyscalePng(width, height, [pngChunk("acTL", animationControl)]);
}
function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const segment = new Uint8Array(4 + payload.byteLength);
  segment[0] = 0xff;
  segment[1] = marker;
  new DataView(segment.buffer).setUint16(2, payload.byteLength + 2);
  segment.set(payload, 4);
  return segment;
}
const XMP_NAMESPACE = "http://ns.adobe.com/xap/1.0/";
const EXIF_SIGNATURE = "Exif\u0000\u0000";
function exifSegment(description: string, orientation: number): Uint8Array {
  const text = utf8(`${description}\u0000`);
  const entries = 2;
  const ifdOffset = 8;
  const descriptionOffset = ifdOffset + 2 + entries * 12 + 4;
  const tiff = new Uint8Array(descriptionOffset + text.byteLength);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49; // "II": little-endian, which every following field is written in
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries, true);
  view.setUint16(ifdOffset + 2, 0x010e, true); // ImageDescription (0x010E), ASCII, too long to sit inline, so its value is an offset.
  view.setUint16(ifdOffset + 4, 2, true);
  view.setUint32(ifdOffset + 6, text.byteLength, true);
  view.setUint32(ifdOffset + 10, descriptionOffset, true);
  view.setUint16(ifdOffset + 14, 0x0112, true);
  view.setUint16(ifdOffset + 16, 3, true);
  view.setUint32(ifdOffset + 18, 1, true);
  view.setUint16(ifdOffset + 22, orientation, true);
  view.setUint32(ifdOffset + 2 + entries * 12, 0, true); // no second IFD
  tiff.set(text, descriptionOffset);
  return jpegSegment(0xe1, concat([utf8(EXIF_SIGNATURE), tiff]));
}
const SPLICED_DESCRIPTION = "harbour youth group portrait";
const withDescriptiveMetadata = (jpeg: Uint8Array): Uint8Array => concat([jpeg.subarray(0, 2), exifSegment(SPLICED_DESCRIPTION, 6), jpegSegment(0xe1, utf8(`${XMP_NAMESPACE}\u0000<x:xmpmeta xmlns:x="adobe:ns:meta/"/>`)), jpeg.subarray(2)]);
const lowerAscii = (byte: number): number => (byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte);
function matchesAt(haystack: Uint8Array, offset: number, needle: Uint8Array): boolean {
  for (let index = 0; index < needle.byteLength; index += 1) {
    const left = haystack[offset + index];
    const right = needle[index];
    if (left === undefined || right === undefined || lowerAscii(left) !== lowerAscii(right)) return false;
  }
  return true;
}
function containsText(haystack: Uint8Array, text: string): boolean {
  const needle = utf8(text);
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
  for (let offset = 0; offset + needle.byteLength <= haystack.byteLength; offset += 1) if (matchesAt(haystack, offset, needle)) return true;
  return false;
}
function indexOfAscii(haystack: Uint8Array, marker: string): number {
  const needle = utf8(marker);
  for (let offset = 0; offset + needle.byteLength <= haystack.byteLength; offset += 1) if (matchesAt(haystack, offset, needle)) return offset;
  return -1;
}
function mvhdCreationTime(bytes: Uint8Array): number {
  const marker = indexOfAscii(bytes, "mvhd");
  if (marker < 0) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[marker + 4] ?? 0;
  if (version === 1) return view.getUint32(marker + 8) * 2 ** 32 + view.getUint32(marker + 12);
  return view.getUint32(marker + 8);
}
// The profile a video gets is decided by the content of its container, so the honest out-of-range input is a real container whose own stated value is out of range: these two helpers start from the committed MP4, which carries the sample layout a muxer writes, and change nothing but the number the container
const VIDEO_SAMPLE_ENTRY = "avc1"; // states — the media timescale every sample duration is counted in, and the display size its video sample entry declares.
function withVideoTimescale(bytes: Uint8Array, timescale: number): Uint8Array {
  const rewritten = Uint8Array.from(bytes);
  const mediaHeader = indexOfAscii(rewritten, "mdhd");
  if (mediaHeader < 0) throw new Error("the fixture must state a media header for its samples to be timed in");
  new DataView(rewritten.buffer, rewritten.byteOffset, rewritten.byteLength).setUint32((rewritten[mediaHeader + 4] ?? 0) === 1 ? mediaHeader + 24 : mediaHeader + 16, timescale);
  return rewritten;
}
function withVideoDisplaySize(bytes: Uint8Array, width: number, height: number): Uint8Array {
  const rewritten = Uint8Array.from(bytes);
  const sampleDescriptions = indexOfAscii(rewritten, "stsd"); // This file's first "avc1" bytes are the brand string "isomavc1" in its file type box rather than a sample entry, so the entry is the one the sample description box holds.
  if (sampleDescriptions < 0) throw new Error("the fixture must state a sample description for its video track");
  const entryInStsd = indexOfAscii(rewritten.subarray(sampleDescriptions), VIDEO_SAMPLE_ENTRY);
  if (entryInStsd < 0) throw new Error(`the fixture must carry an ${VIDEO_SAMPLE_ENTRY} sample entry`);
  const entry = sampleDescriptions + entryInStsd;
  const view = new DataView(rewritten.buffer, rewritten.byteOffset, rewritten.byteLength);
  view.setUint16(entry + 28, width);
  view.setUint16(entry + 30, height);
  return rewritten;
}
const imageRefusal = (result: ImagePreparationResult): ImagePreparationRefusal => (result.ok ? throwing("expected the image pipeline to refuse this file, but it accepted it") : result);
const imageSuccess = (result: ImagePreparationResult): ImagePreparationSuccess => (result.ok ? result : throwing(`expected the image pipeline to accept this file: ${result.message}`));
const videoRefusal = (result: VideoInspectionResult): VideoRefusal => (result.ok ? throwing("expected the video profile to refuse this file, but it admitted it") : result);
const videoCheck = (result: VideoInspectionResult): VideoProfileCheck => (result.ok ? result.profileCheck : throwing(`expected the video profile to admit this file: ${result.message}`));
const acceptanceRefusal = <S extends MediaAssetScope>(result: MediaAcceptanceResult<S>): MediaRefusal => (result.state === "ready" ? throwing("expected this upload to be refused, but it was accepted") : result);
const acceptanceSuccess = <S extends MediaAssetScope>(result: MediaAcceptanceResult<S>): MediaAcceptanceSuccess<S> => (result.state === "rejected" ? throwing(`expected this upload to be accepted: ${result.message}`) : result);
const renditionRefusal = (result: MediaRenditionResult): MediaRefusal => (result.state === "ready" ? throwing("expected this rendition to be refused, but it was prepared") : result);
const renditionSuccess = (result: MediaRenditionResult): MediaRenditionSuccess => (result.state === "rejected" ? throwing(`expected this rendition to be prepared: ${result.message}`) : result);
describe("the admitted profiles are the fixed values", () => {
  it("holds the image ceiling, the pixel edge and the display edge at their exact values", () => expect([IMAGE_MAX_BYTES, IMAGE_MAX_EDGE_PX, IMAGE_DISPLAY_MAX_EDGE_PX]).toEqual([10 * 1024 * 1024, 8000, 2000]));
  it("admits JPEG, PNG and still WebP, and no fourth family", () => {
    expect([...ADMITTED_IMAGE_FORMATS]).toEqual(["jpeg", "png", "webp"]);
    expect(new Set(ADMITTED_IMAGE_FORMATS).size).toBe(3); // A duplicate would hold the count at three while one admitted family went missing.
    for (const admitted of ADMITTED_IMAGE_FORMATS) expect(isAdmittedImageFormat(admitted)).toBe(true);
    for (const excluded of ["gif", "avif", "heic", "tiff", "svg", "bmp", "jp2"]) expect(isAdmittedImageFormat(excluded)).toBe(false);
  });
  it("holds the video ceiling, the duration and the display dimensions at their exact values", () => expect([VIDEO_MAX_BYTES, VIDEO_MAX_DURATION_S, VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT]).toEqual([100 * 1024 * 1024, 180, 1920, 1080]));
  it("admits exactly the two container-and-codec pairs the profile states", () => {
    expect(ADMITTED_VIDEO_PROFILES).toHaveLength(2);
    expect(ADMITTED_VIDEO_PROFILES.map((profile) => profile.container)).toEqual(["mp4", "webm"]);
    const [mp4, webm] = ADMITTED_VIDEO_PROFILES;
    expect([mp4?.video, mp4?.audio, webm?.video, webm?.audio]).toEqual([["avc"], ["aac"], ["vp8", "vp9"], ["vorbis", "opus"]]);
  });
});
it("a file's kind comes from its content, never from its name: refuses a Matroska container by content, with a reason that names what is admitted", async () => {
  const refusal = videoRefusal(await inspectVideo({ bytes: fixture("sample-unsupported.mkv") }));
  expect(refusal.code).toBe("unsupported-container");
  expect(refusal.message).toContain("Matroska"); // Only a reader of the content can name the container the file actually is, and this one is plausible enough for a video that its name would have passed any extension check.
  expect(refusal.action).toBeDefined(); // Actionable: it names what is admitted rather than saying the file is invalid.
  for (const needle of ["MP4", "WebM"]) expect(refusal.action).toContain(needle);
});
it("a file's kind comes from its content, never from its name: refuses a still image offered as a video although its name ends in .mp4", async () => {
  const refusal = acceptanceRefusal(await acceptVideo({ assetId: SEEDED_IMAGE.assetId, scope: SCOPE, sourceOriginalRef: PRIVATE_ORIGINAL, bytes: fixture("poster.jpg"), sourceName: "harbour-holiday-clip.mp4" }));
  expect(refusal.code).toBe("kind-mismatch");
  expect(refusal.message).toContain("still image");
  expect(refusal.message).not.toContain("harbour-holiday-clip");
  expect(refusal.action ?? "").not.toContain("harbour-holiday-clip");
});
it("a file's kind comes from its content, never from its name: refuses a video offered as an image although its name ends in .jpg", async () => {
  const refusal = acceptanceRefusal(await acceptImage({ assetId: SEEDED_IMAGE.assetId, scope: SCOPE, sourceOriginalRef: PRIVATE_ORIGINAL, bytes: fixture("sample-h264.mp4"), sourceName: "welcome-sunday-photo.jpg", altText: "The welcome Sunday video" }));
  expect(refusal.code).toBe("kind-mismatch");
  expect(refusal.message).toContain("video");
  expect(refusal.message).not.toContain("welcome-sunday-photo");
});
it("a file's kind comes from its content, never from its name: accepts an image whose name claims to be a video, because the pipeline never reads the name", async () => {
  const accepted = imageSuccess(await prepareDisplayImage({ bytes: fixture("poster.jpg"), sourceName: "portrait.mp4", assetId: SEEDED_IMAGE.assetId }));
  expect([accepted.format, accepted.mimeType]).toEqual(["jpeg", "image/jpeg"]);
});
// Phase C — the image limits, exactly at the boundary
it("the image limits are exact at their boundaries: refuses one byte over 10 MiB before any decoder sees it, and refuses nothing at 10 MiB for its size", async () => {
  // Driven through the pipeline's own byte gate with buffers of exactly the two sizes. At the limit the gate passes and the next check answers instead, which is the only way to tell a limit from an off-by-one: content that is not an image is refused for its content, never for its size.
  const atLimit = imageRefusal(await prepareDisplayImage({ bytes: new Uint8Array(IMAGE_MAX_BYTES), assetId: SEEDED_IMAGE.assetId }));
  expect(atLimit.code).toBe("not-an-image");
  expect(atLimit.code).not.toBe("too-large-bytes");
  const overLimit = imageRefusal(await prepareDisplayImage({ bytes: new Uint8Array(IMAGE_MAX_BYTES + 1), assetId: SEEDED_IMAGE.assetId }));
  expect(overLimit.code).toBe("too-large-bytes");
  expect(overLimit.message).toContain("10 MiB");
  expect(overLimit.action).toBeDefined();
});
it("the image limits are exact at their boundaries: accepts 8,000 pixels on a side and refuses 8,001 on either side", async () => {
  const atLimit = imageSuccess(await prepareDisplayImage({ bytes: greyscalePng(IMAGE_MAX_EDGE_PX, 10), assetId: SEEDED_IMAGE.assetId }));
  expect(atLimit.profileCheck).toEqual({ format: "png", width: 8000, height: 10 });
  const overWide = imageRefusal(await prepareDisplayImage({ bytes: greyscalePng(IMAGE_MAX_EDGE_PX + 1, 10), assetId: SEEDED_IMAGE.assetId }));
  expect(overWide.code).toBe("too-large-dimensions");
  expect(overWide.message).toContain(`${IMAGE_MAX_EDGE_PX} pixels`);
  const overTall = imageRefusal(await prepareDisplayImage({ bytes: greyscalePng(10, IMAGE_MAX_EDGE_PX + 1), assetId: SEEDED_IMAGE.assetId })); // The bound is per side, so a tall image is refused on the same rule as a wide one.
  expect(overTall.code).toBe("too-large-dimensions");
});
it("the image limits are exact at their boundaries: caps the display rendition at 2,000 px on its longest edge without distorting it", async () => {
  const capped = imageSuccess(await prepareDisplayImage({ bytes: greyscalePng(IMAGE_DISPLAY_MAX_EDGE_PX + 1, 10), assetId: SEEDED_IMAGE.assetId }));
  expect([capped.width, capped.height]).toEqual([2000, 10]);
  const widest = imageSuccess(await prepareDisplayImage({ bytes: greyscalePng(IMAGE_MAX_EDGE_PX, 10), assetId: SEEDED_IMAGE.assetId }));
  expect(Math.max(widest.width, widest.height)).toBe(IMAGE_DISPLAY_MAX_EDGE_PX);
});
it("the image limits are exact at their boundaries: measures the pixel edge after orientation, so a rotated photo is bounded by what a reader sees", async () => {
  const rotated = imageSuccess(await prepareDisplayImage({ bytes: withDescriptiveMetadata(fixture("poster.jpg")), assetId: SEEDED_IMAGE.assetId }));
  expect([rotated.profileCheck, [rotated.width, rotated.height]]).toEqual([{ format: "jpeg", width: 540, height: 960 }, [540, 960]]);
});
it("the image limits are exact at their boundaries: admits a still frame only: an animated image is refused although its family is admitted", async () => {
  expect(imageSuccess(await prepareDisplayImage({ bytes: greyscalePng(4, 4), assetId: SEEDED_IMAGE.assetId })).format).toBe("png");
  // Every frame of an animation is an admitted still family, so only the declared frame count separates the two. One frame-count check refuses animation for every admitted family; a WebP animation cannot be authored from the committed still without adding a fixture file, so the rule
  const animated = imageRefusal(await prepareDisplayImage({ bytes: animatedPng(4, 4), assetId: SEEDED_IMAGE.assetId })); // is proven on the family whose first frame the decoder would otherwise accept on its own.
  expect(animated.code).toBe("animated-not-admitted");
  expect(animated.action).toBeDefined();
});
const ALT_TEXT = "A single flower opening against a dark background";
async function offerSeededImage(overrides: { readonly bytes?: Uint8Array; readonly sourceName?: string; readonly altText?: string; readonly caption?: string }): Promise<MediaAcceptanceResult<MediaAssetScope>> {
  return acceptImage({
    assetId: SEEDED_IMAGE.assetId,
    scope: SCOPE,
    sourceOriginalRef: PRIVATE_ORIGINAL,
    bytes: overrides.bytes ?? fixture("poster.jpg"),
    sourceName: overrides.sourceName ?? PRIVATE_ORIGINAL_REF,
    altText: overrides.altText ?? ALT_TEXT,
    ...(overrides.caption === undefined ? {} : { caption: overrides.caption }),
  });
}
it("the produced image rendition is safe to serve: re-encodes the image without the descriptive metadata it arrived with", async () => {
  const tagged = withDescriptiveMetadata(fixture("poster.jpg"));
  expect([containsText(tagged, EXIF_SIGNATURE), containsText(tagged, XMP_NAMESPACE), containsText(tagged, SPLICED_DESCRIPTION)]).toEqual([true, true, true]); // The input must really carry the metadata, or an assertion about the output would prove nothing.
  const accepted = acceptanceSuccess(await offerSeededImage({ bytes: tagged }));
  const display = first(accepted.renditions, "a display rendition");
  expect([[display.purpose, display.mimeType], display.tagVerification]).toEqual([["display", "image/jpeg"], { checked: true, residualTags: [] }]);
  // The delivered bytes are re-encoded, so no EXIF block, no XMP packet and none of the descriptive text survived — and no colour profile was carried across either.
  expect([containsText(display.bytes, EXIF_SIGNATURE), containsText(display.bytes, XMP_NAMESPACE), containsText(display.bytes, SPLICED_DESCRIPTION), containsText(display.bytes, "ICC_PROFILE")]).toEqual([false, false, false, false]);
});
it("the produced image rendition is safe to serve: never enlarges an image that is already smaller than the display edge", async () => {
  const small = imageSuccess(await prepareDisplayImage({ bytes: greyscalePng(640, 360), assetId: SEEDED_IMAGE.assetId }));
  expect([small.width, small.height]).toEqual([640, 360]); // An unconditional upscale to 2,000 px would show here: the rendition keeps the size it was given.
  expect(Math.max(small.width, small.height)).toBeLessThan(IMAGE_DISPLAY_MAX_EDGE_PX);
  const display = first(acceptanceSuccess(await offerSeededImage({})).renditions, "a display rendition");
  expect([display.width, display.height]).toEqual([960, 540]);
  expect(display.bytes.byteLength).toBeGreaterThan(0);
  expect(Math.max(display.width ?? 0, display.height ?? 0)).toBeLessThanOrEqual(IMAGE_DISPLAY_MAX_EDGE_PX);
});
it("the produced image rendition is safe to serve: carries no copy of the private original's file name", async () => {
  expect(PRIVATE_ORIGINAL_REF).toContain("IMG_20260814");
  const accepted = acceptanceSuccess(await offerSeededImage({}));
  const display = first(accepted.renditions, "a display rendition");
  for (const needle of [PRIVATE_ORIGINAL_REF, "IMG_20260814", "harbour-youth-group", "media-originals"]) expect(containsText(display.bytes, needle)).toBe(false);
  expect([display.renditionId, display.assetId]).toEqual([`${SEEDED_IMAGE.assetId}:display`, SEEDED_IMAGE.assetId]);
  expect(display.renditionId).not.toContain("media-originals");
  expect([accepted.sourceOriginalRef, accepted.scope, accepted.profileCheck.kind]).toEqual([PRIVATE_ORIGINAL, SCOPE, "image"]);
});
it("the produced image rendition is safe to serve: requires alternative text and leaves the caption optional", async () => {
  const withoutAlt = acceptanceRefusal(await offerSeededImage({ altText: "   " }));
  expect(withoutAlt.code).toBe("alt-text-required");
  expect(withoutAlt.action).toBeDefined();
  const captionless = acceptanceSuccess(await offerSeededImage({ caption: "   " }));
  expect(captionless.altText).toBe(ALT_TEXT);
  expect(captionless.caption).toBeUndefined();
  const captioned = acceptanceSuccess(await offerSeededImage({ altText: `  ${ALT_TEXT}  `, caption: "  A bloom  " }));
  expect([captioned.altText, captioned.caption]).toEqual([ALT_TEXT, "A bloom"]);
});
it("the produced image rendition is safe to serve: keeps an accepted placement intact when a later file is refused", async () => {
  const accepted = acceptanceSuccess(await offerSeededImage({}));
  const display = first(accepted.renditions, "a display rendition");
  const preparedBefore = Array.from(display.bytes);
  const shelfBefore = accepted.renditions.map((rendition) => rendition.renditionId);
  const refused = acceptanceRefusal(await offerSeededImage({ bytes: animatedPng(4, 4), sourceName: "IMG_20260814-animation.png" }));
  expect(refused.code).toBe("animated-not-admitted");
  for (const expected of ["renditions", "bytes"]) expect(refused).not.toHaveProperty(expected); // A refusal is a value that carries no bytes and no rendition, so it cannot displace the accepted placement or the prose around it; the service keeps the draft it already had.
  expect([Array.from(display.bytes), accepted.renditions.map((rendition) => rendition.renditionId)]).toEqual([preparedBefore, shelfBefore]);
});
it("the produced image rendition is safe to serve: serves the seeded assets under rendition identities, never the private original", async () => {
  expect(SEEDED_ASSETS.length).toBeGreaterThan(0);
  for (const asset of SEEDED_ASSETS) {
    for (const value of [asset.sourceOriginalRef.length, asset.renditions.length]) expect(value).toBeGreaterThan(0);
    for (const rendition of asset.renditions) {
      expect(rendition.bytesRef).not.toBe(asset.sourceOriginalRef);
      expect(rendition.bytesRef.startsWith("media-originals/")).toBe(false);
      expect(rendition.renditionId).not.toBe(asset.sourceOriginalRef);
      expect(rendition.bytesRef).not.toContain("IMG_20260814");
    }
  }
  for (const asset of SEEDED_ASSETS) {
    expect(asset.tagVerification.checked).toBe(true);
    expect([...asset.tagVerification.residualTags]).toEqual([]);
  }
});
it("the produced image rendition is safe to serve: keeps an unavailable asset's poster rather than an empty player", async () => {
  const withoutPlayback = SEEDED_ASSETS.filter((asset) => asset.kind === "video" && !asset.renditions.some((r) => r.purpose === "playback"));
  expect(withoutPlayback).toHaveLength(1);
  const unavailable = first(withoutPlayback, "a seeded video asset with no playback rendition");
  expect(unavailable.renditions.map((rendition) => rendition.purpose)).toEqual(["poster"]); // The poster stays, so the placement shows the poster and its text alternative while the bytes are gone, and the record claims no preparation that never ran.
});
const SEEDED_MP4_ASSET: SeededMediaAsset = first(
  SEEDED_ASSETS.filter((asset) => asset.renditions.some((r) => r.purpose === "playback" && r.bytesRef.endsWith("sample-h264.mp4"))),
  "the seeded video asset whose playback rendition serves the committed MP4",
);
const acceptSeededVideo = async (bytes: Uint8Array, sourceName: string): Promise<MediaAcceptanceSuccess<MediaAssetScope>> => acceptanceSuccess(await acceptVideo({ assetId: SEEDED_MP4_ASSET.assetId, scope: SCOPE, sourceOriginalRef: PRIVATE_ORIGINAL, bytes, sourceName }));
const SIX_STATES: readonly MediaPreparationState[] = ["selected", "preparing", "ready", "rejected", "cancelled", "unavailable"];
it("the video profile is decided by the content of the container: accepts the committed H.264 MP4 with the profile its own container states", async () => {
  const check = videoCheck(await inspectVideo({ bytes: fixture("sample-h264.mp4") }));
  expect([check.container, check.codec, check.width, check.height]).toEqual(["mp4", "avc", 960, 540]);
  expect(check.durationS).toBeGreaterThan(0);
  expect(check.durationS).toBeLessThanOrEqual(VIDEO_MAX_DURATION_S);
  expect([SEEDED_MP4_ASSET.profileCheck.container, SEEDED_MP4_ASSET.profileCheck.width, SEEDED_MP4_ASSET.profileCheck.height]).toEqual([check.container, check.width, check.height]); // The seeded record describes the same fixture, so no surface can show a codec or a size that the served bytes contradict.
  expect(SEEDED_MP4_ASSET.profileCheck.codec).toContain(check.codec);
  const recorded = SEEDED_MP4_ASSET.profileCheck.durationSeconds ?? 0;
  expect(Math.abs(recorded - check.durationS)).toBeLessThan(0.01);
});
it("the video profile is decided by the content of the container: reads the duration from the container, so it is the same on every inspection", async () => {
  const first = videoCheck(await inspectVideo({ bytes: fixture("sample-h264.mp4") }));
  expect(videoCheck(await inspectVideo({ bytes: fixture("sample-h264.mp4") }))).toEqual(first);
  expect(first.durationS).toBeGreaterThan(1);
  expect(first.durationS).toBeLessThan(3);
});
it("the video profile is decided by the content of the container: accepts the committed VP9 WebM as its own container and codec", async () => {
  const check = videoCheck(await inspectVideo({ bytes: fixture("sample-vp9.webm") }));
  expect([check.container, check.codec, check.width, check.height]).toEqual(["webm", "vp9", 960, 540]);
  expect(check.durationS).toBeGreaterThan(0);
});
it("the video profile is decided by the content of the container: offers exactly six states, each with a reason and a next step where one exists", () => {
  expect(MEDIA_PREPARATION_STATES).toHaveLength(6);
  expect([...MEDIA_PREPARATION_STATES]).toEqual(SIX_STATES);
  for (const state of SIX_STATES) expect(mediaStateReason(state).label.trim().length).toBeGreaterThan(0);
  for (const failed of ["rejected", "cancelled", "unavailable"] as const) expect(mediaStateReason(failed).action).toBeDefined(); // The three failure states stay distinct because they ask different things of the worker, and each offers the step that answers it.
  for (const working of ["selected", "preparing", "ready"] as const) expect(mediaStateReason(working).action).toBeUndefined(); // Nothing has failed in these three, so there is nothing to recover and nothing to offer.
  const unavailable = mediaStateReason("unavailable");
  expect(unavailable.label).toContain("unavailable");
  expect(unavailable.action).toContain("another file");
  const refusal: MediaRefusal = { state: "rejected", code: "unsupported-container", message: "The file is in the Matroska container, which this profile does not admit.", action: "Upload an MP4 or a WebM video." };
  const reason = mediaStateReason("rejected", refusal);
  expect([reason.label, reason.action]).toEqual([refusal.message, refusal.action]);
});
it("the video profile is decided by the content of the container: serves a playback rendition verified free of descriptive tags", async () => {
  const source = fixture("sample-h264.mp4");
  expect(mvhdCreationTime(source)).toBeGreaterThan(0); // The source states a creation instant in its movie header and is admitted anyway: a container timestamp is not descriptive metadata. That is the documented limitation of a copy-remux, and it is asserted here rather than left for a reader to discover.
  const accepted = await acceptSeededVideo(source, "welcome-sunday.mp4");
  const playback = first(accepted.renditions, "a playback rendition");
  expect([playback.purpose, playback.mimeType]).toEqual(["playback", "video/mp4"]);
  expect(playback.bytes.byteLength).toBeGreaterThan(0);
  expect([playback.tagVerification, accepted.tagVerification]).toEqual([
    { checked: true, residualTags: [] },
    { checked: true, residualTags: [] },
  ]);
  // The copy carries no tag container and no creation instant of its own, so the served bytes hold nothing that could identify the shoot; the source's timestamp was dropped on the way through.
  expect([indexOfAscii(playback.bytes, "udta"), indexOfAscii(playback.bytes, "ilst"), mvhdCreationTime(playback.bytes)]).toEqual([-1, -1, 0]);
  const prepared = await preparePlaybackRendition({ bytes: source }); // The preparation verifies the copy it made, before any acceptance wraps it: an empty residual list is the only clean answer, and the copy is the admitted video rather than a re-encode of it.
  if (!prepared.ok) throw new Error(`expected a playback rendition: ${prepared.message}`);
  expect([prepared.tagVerification, [prepared.profileCheck.container, prepared.profileCheck.codec, prepared.bytes.byteLength]]).toEqual([{ checked: true, residualTags: [] }, ["mp4", "avc", playback.bytes.byteLength]]);
  const served = videoCheck(await inspectVideo({ bytes: playback.bytes })); // The served bytes are the admitted video itself, carried over rather than re-encoded.
  const inspectedSource = videoCheck(await inspectVideo({ bytes: source }));
  expect([served.container, served.codec, served.width, served.height]).toEqual([inspectedSource.container, inspectedSource.codec, inspectedSource.width, inspectedSource.height]);
  expect(Math.abs(served.durationS - inspectedSource.durationS)).toBeLessThan(0.1);
  // A rendition that kept a descriptive tag is discarded rather than served, and the pipeline reports that outcome under its own code. The committed fixtures cannot reach the branch — the copy is forced, writes no tag set, and is re-read above — and no sixth fixture may be added, so the code
  const residualTagRefusal = "tags-residual" satisfies VideoRefusalCode; // is pinned to the refusal union here, where deleting the branch would fail the type check.
  expect(residualTagRefusal).toBe("tags-residual");
});
it("the video profile is decided by the content of the container: prepares the poster and the caption track as renditions of the same asset", async () => {
  const accepted = await acceptSeededVideo(fixture("sample-h264.mp4"), "welcome-sunday.mp4");
  const poster = renditionSuccess(await prepareRendition({ assetId: accepted.assetId, purpose: "poster", bytes: fixture("poster.jpg"), sourceName: "poster.jpg", altText: ALT_TEXT }));
  expect([poster.rendition.assetId, poster.rendition.purpose, poster.rendition.mimeType, poster.rendition.renditionId, poster.altText]).toEqual([accepted.assetId, "poster", "image/jpeg", `${accepted.assetId}:poster`, ALT_TEXT]);
  const captions = renditionSuccess(await prepareRendition({ assetId: accepted.assetId, purpose: "captions", bytes: fixture("sample.vtt") }));
  expect([captions.rendition.assetId, captions.rendition.purpose, captions.rendition.mimeType, captions.rendition.renditionId]).toEqual([accepted.assetId, "captions", WEBVTT_MIME_TYPE, `${accepted.assetId}:captions`]);
  const captionText = new TextDecoder().decode(captions.rendition.bytes);
  expect(captionText.startsWith("WEBVTT")).toBe(true);
  expect(captionText).toContain("-->");
  expect(captionText.trim().length).toBeGreaterThan("WEBVTT".length);
  const transcriptOfCaptions = renditionSuccess(await prepareRendition({ assetId: accepted.assetId, purpose: "transcript", bytes: fixture("sample.vtt") }));
  expect(transcriptOfCaptions.rendition.mimeType).toBe(WEBVTT_MIME_TYPE);
  const plainTranscript = renditionSuccess(await prepareRendition({ assetId: accepted.assetId, purpose: "transcript", bytes: utf8("A single flower opens against a dark background.") }));
  expect(plainTranscript.rendition.mimeType).toBe(PLAIN_TEXT_MIME_TYPE);
  expect(renditionRefusal(await prepareRendition({ assetId: accepted.assetId, purpose: "poster", bytes: fixture("poster.jpg") })).code).toBe("alt-text-required");
});
it("the video profile is decided by the content of the container: refuses a caption track that is not UTF-8 WebVTT, and refuses display or playback here", async () => {
  const notUtf8 = renditionRefusal(await prepareRendition({ assetId: SEEDED_MP4_ASSET.assetId, purpose: "captions", bytes: new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x41]) }));
  expect(notUtf8.code).toBe("invalid-captions");
  expect(notUtf8.action).toBeDefined();
  const notWebVtt = renditionRefusal(await prepareRendition({ assetId: SEEDED_MP4_ASSET.assetId, purpose: "captions", bytes: utf8("A caption with no signature.\n") }));
  expect(notWebVtt.code).toBe("invalid-captions");
  expect(notWebVtt.message).toContain("WebVTT");
  // Each picture purpose belongs to the entry point that owns its profile check, so this function never grows into a dispatcher over every purpose.
  for (const purpose of ["display", "playback"] as const) {
    const refused = renditionRefusal(await prepareRendition({ assetId: SEEDED_MP4_ASSET.assetId, purpose, bytes: fixture("poster.jpg"), altText: ALT_TEXT }));
    expect(refused.code).toBe("use-acceptance-entry-point");
  }
  expect([...ANCILLARY_RENDITION_PURPOSES]).toEqual(["poster", "captions", "transcript"]);
});
// The video limits, exactly at their boundary — the counterpart of the image boundaries proven above
it("the video limits are exact at their boundaries: refuses one byte over 100 MiB before any container reader sees it, and refuses nothing at 100 MiB for its size", async () => {
  // Driven through the pipeline's own byte gate with buffers of exactly the two sizes, as the image ceiling is. Bytes of nothing at all, so at the ceiling the gate passes and the content check answers instead: the only way to tell a limit from an off-by-one is that content which is not a
  const atLimit = videoRefusal(await inspectVideo({ bytes: new Uint8Array(VIDEO_MAX_BYTES) })); // video is refused for its content, never for its size.
  expect(atLimit.code).toBe("not-a-video");
  expect(atLimit.code).not.toBe("too-large-bytes");
  const overLimit = videoRefusal(await inspectVideo({ bytes: new Uint8Array(VIDEO_MAX_BYTES + 1) }));
  expect(overLimit.code).toBe("too-large-bytes");
  for (const needle of [countTextOf(VIDEO_MAX_BYTES + 1), countTextOf(VIDEO_MAX_BYTES)]) expect(overLimit.message).toContain(needle); // The reason states both numbers it compares, so a worker can see how far past the ceiling the file is; the expected figures come from the one whole-number formatter the reason itself uses rather than a second rule stated here.
  expect(overLimit.action).toBeDefined();
});
it("the video limits are exact at their boundaries: refuses a video past the 180-second ceiling the container itself reports", async () => {
  const refusal = videoRefusal(await inspectVideo({ bytes: withVideoTimescale(fixture("sample-h264.mp4"), 170) }));
  expect(refusal.code).toBe("too-long-duration");
  for (const needle of ["180.7 seconds", `the limit is ${VIDEO_MAX_DURATION_S} seconds`]) expect(refusal.message).toContain(needle);
  expect(refusal.action).toBeDefined(); // Actionable: it names the trim that would admit the video rather than calling the file invalid.
});
it("the video limits are exact at their boundaries: refuses a video wider or taller than its display ceiling, admitting exactly 1920x1080", async () => {
  const source = fixture("sample-h264.mp4");
  const overCeiling = [
    [VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT + 1],
    [VIDEO_MAX_WIDTH + 1, VIDEO_MAX_HEIGHT],
  ] as const;
  for (const [width, height] of overCeiling) {
    const refusal = videoRefusal(await inspectVideo({ bytes: withVideoDisplaySize(source, width, height) }));
    expect(refusal.code).toBe("too-large-dimensions");
    for (const needle of [`${width}x${height}`, `${VIDEO_MAX_WIDTH}x${VIDEO_MAX_HEIGHT}`]) expect(refusal.message).toContain(needle); // The reason names the pair the container states against the pair the profile admits, so the refusal is a boundary the worker can act on rather than a bare rejection.
    expect(refusal.action).toBeDefined();
  }
  const admitted = videoCheck(await inspectVideo({ bytes: withVideoDisplaySize(source, VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT) }));
  expect([admitted.width, admitted.height]).toEqual([VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT]);
});
it("local processing is never presented as production scanning or transcoding: claims no scan, no transcode and no safety qualification in any reason it shows", async () => {
  // Six refusals, drawn from all three pipelines: each keeps its own code, and the shape declared here is the part they share, so one scan covers a refusal from every one of them.
  const refusals: readonly { readonly code: string; readonly message: string; readonly action?: string }[] = [
    videoRefusal(await inspectVideo({ bytes: fixture("sample-unsupported.mkv") })),
    imageRefusal(await prepareDisplayImage({ bytes: new Uint8Array(IMAGE_MAX_BYTES + 1), assetId: SEEDED_IMAGE.assetId })),
    imageRefusal(await prepareDisplayImage({ bytes: greyscalePng(IMAGE_MAX_EDGE_PX + 1, 4), assetId: SEEDED_IMAGE.assetId })),
    imageRefusal(await prepareDisplayImage({ bytes: animatedPng(4, 4), assetId: SEEDED_IMAGE.assetId })),
    renditionRefusal(await prepareRendition({ assetId: SEEDED_MP4_ASSET.assetId, purpose: "captions", bytes: new Uint8Array([0xff, 0xfe]) })),
    acceptanceRefusal(await acceptVideo({ assetId: SEEDED_MP4_ASSET.assetId, scope: SCOPE, sourceOriginalRef: PRIVATE_ORIGINAL, bytes: fixture("poster.jpg"), sourceName: "harbour-holiday-clip.mp4" })),
  ];
  const overstatement = /virus|malware|antivirus|scan|transcod|certif|guarantee|production/i; // Wording that would overstate what happened: this application decodes, re-encodes and copies bytes locally, so nothing may claim a scan, a transcode or a safety qualification.
  for (const state of SIX_STATES) {
    const reason = mediaStateReason(state);
    expect(`${reason.label}\n${reason.action ?? ""}`).not.toMatch(overstatement); // Label and next step are scanned as one text, so neither can escape the check by being optional.
  }
  for (const refusal of refusals) expect(`${refusal.message}\n${refusal.action ?? ""}`).not.toMatch(overstatement);
  expect(mediaStateReason("preparing").label).toContain("local");
  expect(refusals.map((refusal) => refusal.code)).toEqual(["unsupported-container", "too-large-bytes", "too-large-dimensions", "animated-not-admitted", "invalid-captions", "kind-mismatch"]);
});
