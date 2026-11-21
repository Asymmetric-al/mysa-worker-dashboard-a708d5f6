/**
 * Proves the image and video profiles that guard every upload (success criteria 9 and 18): a file's
 * kind is established by its content and never by its name, every limit is exact at its boundary, the
 * produced image rendition is re-encoded, bounded to 2,000 px on its longest edge and carries neither
 * descriptive metadata nor a copy of the original file name, and the video path refuses an unadmitted
 * container by content with a reason that names what it does admit.
 *
 * Plan items that put this file in scope: the AAP 0.11.1 deliverable row `tests/domain/*.test.ts`
 * naming `media-profile` for criteria 9 and 18; the criterion 9 and 18 rows of AAP 0.12.1 ("the
 * stripped image contains no source filename or metadata"; an unsupported file shows an actionable
 * reason); the media rows of AAP 0.8.6 and the fixed values of AAP 0.8.7 (10 MiB, 8,000 px, 2,000 px,
 * 100 MiB, 180 s, 1920x1080, each accepted exactly at the limit and refused one over); and AAP 0.12.4,
 * which makes the committed fixtures under `public/fixtures/media` the inputs of these cases.
 *
 * Where the module's own surface differs from the brief for this file:
 *
 * - The brief names "the validation function and the prepare/rendition function" in `media/image`.
 *   The module exposes one ordered pipeline, `prepareDisplayImage()`, which is both, and exports no
 *   separate size or dimension validator. The boundary cases are therefore driven through that
 *   pipeline with complete, decodable images the test assembles in memory from the PNG container
 *   format: no encoder is imported, no assertion library is added and no binary fixture is committed.
 * - The brief names "the six video states" in `media/asset`; they are exported as
 *   `MEDIA_PREPARATION_STATES`, with the label and next step each one shows from `mediaStateReason()`.
 * - The brief expects `seed()` to carry the EXIF-bearing image. It does: `asset-image-portrait`'s
 *   private original is the committed, EXIF-bearing `IMG_20260814-harbour-youth-group.jpg`, and a reset
 *   produces its display rendition from those bytes with `prepareDisplayImage()`, so the stripping path
 *   runs over real EXIF in the seeded world. The cases below still splice their own EXIF/TIFF segment
 *   onto committed bytes, because a case has to own the input it asserts about rather than depend on
 *   what a reset happened to materialise: verifying "no EXIF" on a file that never had any would prove
 *   nothing.
 * - `media/video` does not export its post-remux verification, and its copy is forced, so a
 *   descriptive tag cannot be made to survive on the committed fixtures. The rejection branch is
 *   pinned by the refusal code it returns and by the invariant that no accepted rendition carries a
 *   residual tag, and the documented MP4-timestamp limitation is asserted rather than left unsaid.
 *
 * What this file deliberately does not test: per-request re-authorisation of a served rendition,
 * byte ranges included. That is the media route's boundary, proven by `e2e/video.spec.ts` and the
 * integration suite; this file proves the profile check and the preparation.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

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
import {
  isAdmittedImageFormat,
  prepareDisplayImage,
  ADMITTED_IMAGE_FORMATS,
  IMAGE_DISPLAY_MAX_EDGE_PX,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE_PX,
  type ImagePreparationRefusal,
  type ImagePreparationResult,
  type ImagePreparationSuccess,
} from "@/modules/media/image";
import {
  inspectVideo,
  preparePlaybackRendition,
  ADMITTED_VIDEO_PROFILES,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_S,
  VIDEO_MAX_HEIGHT,
  VIDEO_MAX_WIDTH,
  type VideoInspectionResult,
  type VideoProfileCheck,
  type VideoRefusal,
  type VideoRefusalCode,
} from "@/modules/media/video";
import {
  seed,
  DEFAULT_SESSION_ID,
  type SeededSessionWithDocuments,
  type SessionStateDocument,
} from "@/modules/dev-runtime/seed";

// ---------------------------------------------------------------------------------------------
// The committed fixtures, and the seeded world that names the private original
// ---------------------------------------------------------------------------------------------

/** The directory the application serves the committed media from, resolved from this file. */
const FIXTURE_DIR = fileURLToPath(new URL("../../public/fixtures/media/", import.meta.url));

/** One committed fixture, read as the bytes the pipeline receives from an upload. */
function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURE_DIR, name)));
}

/**
 * The seeded worlds, built once at import.
 *
 * `seed()` persists nothing, opens no file and reads no clock, so calling it here involves no session,
 * no store and no state: every value below is the same value a reset lays down, which is what makes
 * the seeded private-original name and the seeded asset profiles evidence rather than a fixture the
 * test invented. The established worker owns the media this file inspects.
 */
const SEEDED: readonly SeededSessionWithDocuments[] = await seed();

const ESTABLISHED: SeededSessionWithDocuments = firstOf(
  SEEDED.filter((session) => session.sessionId === DEFAULT_SESSION_ID),
  `a seeded session named ${DEFAULT_SESSION_ID}`,
);

/** One seeded media asset, as the session's state document stores it. */
type SeededMediaAsset = SessionStateDocument["mediaAssets"][number];

/** Every media asset the established worker's workspace holds. */
const SEEDED_ASSETS: readonly SeededMediaAsset[] = ESTABLISHED.documents.state.mediaAssets;

/** The seeded still image, whose private original is the revealing name the leak check is built on. */
const SEEDED_IMAGE: SeededMediaAsset = firstOf(
  SEEDED_ASSETS.filter((asset) => asset.kind === "image"),
  "a seeded image asset",
);

/** The revealing name of the seeded image's private original; it is never served and never echoed. */
const PRIVATE_ORIGINAL_REF = SEEDED_IMAGE.sourceOriginalRef;

/**
 * The authority a media asset belongs to, taken from the seed's own harbour context and passed through
 * unchanged. Acceptance and preparation write nothing, so no session is resolved here.
 */
const SCOPE: MediaAssetScope = {
  organizationId: SEEDED_IMAGE.scope.organizationId,
  ministryId: SEEDED_IMAGE.scope.ministryId,
};

/** The caller's opaque reference to the private uploaded original, returned by reference and never served. */
const PRIVATE_ORIGINAL = { system: "local-fixture", reference: PRIVATE_ORIGINAL_REF } as const;

// ---------------------------------------------------------------------------------------------
// Images assembled in memory, from the container format rather than from an encoder
// ---------------------------------------------------------------------------------------------

/** The eight bytes every PNG begins with. */
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Joins byte runs into one buffer, so a container is built by listing its parts. */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

/** UTF-8 bytes of a string, which is how a text document reaches the pipeline. */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** CRC-32 of a PNG chunk's type and payload, without which a decoder rejects the chunk. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: its length, type, payload and the CRC over type and payload. */
function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const typeBytes = utf8(type);
  const body = concat([typeBytes, payload]);
  const chunk = new Uint8Array(4 + body.byteLength + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.byteLength);
  chunk.set(body, 4);
  view.setUint32(4 + body.byteLength, crc32(body));
  return chunk;
}

/**
 * A complete 8-bit greyscale PNG of exactly the requested pixel size.
 *
 * A boundary case needs an image of a stated width, and this is the one form an image of a stated
 * width can take without an encoder: greyscale is one byte per pixel, so 8,000 by 10 costs 80 KB of
 * zeroed scanlines and deflates to a handful of bytes. `chunksBeforeImageData` is where an animation
 * control chunk goes, because a PNG declares its frame count ahead of its image data.
 */
function greyscalePng(
  width: number,
  height: number,
  chunksBeforeImageData: readonly Uint8Array[] = [],
): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // eight bits per sample
  header[9] = 0; // greyscale: no colour type, no padding, no palette
  // Bytes 10 to 12 stay zero: deflate, adaptive filtering, no interlace.

  const scanlines = new Uint8Array(height * (width + 1));
  return concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    ...chunksBeforeImageData,
    pngChunk("IDAT", new Uint8Array(deflateSync(scanlines))),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * The same image declaring two frames in an `acTL` chunk: an animated PNG.
 *
 * This is how the "still WebP, never animated" rule is proven on content: every frame of an animation
 * is an admitted still family, so only the declared frame count can distinguish the two, and a PNG is
 * the family where the pipeline decodes the first frame unless it reads that count.
 */
function animatedPng(width: number, height: number): Uint8Array {
  const animationControl = new Uint8Array(8);
  const view = new DataView(animationControl.buffer);
  view.setUint32(0, 2); // two frames
  return greyscalePng(width, height, [pngChunk("acTL", animationControl)]);
}

/** One JPEG marker segment: the marker, its two-byte length and its payload. */
function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const segment = new Uint8Array(4 + payload.byteLength);
  segment[0] = 0xff;
  segment[1] = marker;
  new DataView(segment.buffer).setUint16(2, payload.byteLength + 2);
  segment.set(payload, 4);
  return segment;
}

/** The namespace identifier an XMP packet is introduced by inside an APP1 segment. */
const XMP_NAMESPACE = "http://ns.adobe.com/xap/1.0/";

/** The EXIF signature that introduces the TIFF block inside an APP1 segment. */
const EXIF_SIGNATURE = "Exif\u0000\u0000";

/**
 * An APP1 segment carrying a real EXIF TIFF block: an `ImageDescription` and EXIF orientation 6.
 *
 * Orientation 6 means the stored frame is rotated a quarter turn for display, so an image whose stored
 * pair is 960 by 540 shows at 540 by 960 — the transposition that proves the pixel edge is measured on
 * what a reader sees rather than on what the file stores.
 */
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
  // ImageDescription (0x010E), ASCII, too long to sit inline, so its value is an offset.
  view.setUint16(ifdOffset + 2, 0x010e, true);
  view.setUint16(ifdOffset + 4, 2, true);
  view.setUint32(ifdOffset + 6, text.byteLength, true);
  view.setUint32(ifdOffset + 10, descriptionOffset, true);
  // Orientation (0x0112), SHORT, one value, small enough to sit inline in the entry.
  view.setUint16(ifdOffset + 14, 0x0112, true);
  view.setUint16(ifdOffset + 16, 3, true);
  view.setUint32(ifdOffset + 18, 1, true);
  view.setUint16(ifdOffset + 22, orientation, true);
  view.setUint32(ifdOffset + 2 + entries * 12, 0, true); // no second IFD
  tiff.set(text, descriptionOffset);

  return jpegSegment(0xe1, concat([utf8(EXIF_SIGNATURE), tiff]));
}

/** The description the spliced EXIF block states, which a delivered rendition must not repeat. */
const SPLICED_DESCRIPTION = "harbour youth group portrait";

/**
 * The committed still, carrying the descriptive metadata a camera writes.
 *
 * Both segments sit directly after the start-of-image marker, which is where a JPEG reader looks for
 * them, so any decoder that reads this file before the pipeline does reports them. Splicing them onto
 * the committed bytes is what makes the stripping assertion meaningful: verifying "no EXIF" on a file
 * that never held any would prove nothing.
 */
function withDescriptiveMetadata(jpeg: Uint8Array): Uint8Array {
  const xmp = jpegSegment(
    0xe1,
    utf8(`${XMP_NAMESPACE}\u0000<x:xmpmeta xmlns:x="adobe:ns:meta/"/>`),
  );
  return concat([jpeg.subarray(0, 2), exifSegment(SPLICED_DESCRIPTION, 6), xmp, jpeg.subarray(2)]);
}

// ---------------------------------------------------------------------------------------------
// Byte inspection and result narrowing
// ---------------------------------------------------------------------------------------------

/** Folds one ASCII letter to lower case, so a byte search ignores the case a codec would too. */
function lowerAscii(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

/** Reports whether `needle` occurs at `offset`, comparing ASCII case-insensitively. */
function matchesAt(haystack: Uint8Array, offset: number, needle: Uint8Array): boolean {
  for (let index = 0; index < needle.byteLength; index += 1) {
    const left = haystack[offset + index];
    const right = needle[index];
    if (left === undefined || right === undefined || lowerAscii(left) !== lowerAscii(right)) {
      return false;
    }
  }
  return true;
}

/**
 * Reports whether the delivered bytes still carry `text`, compared byte for byte and ignoring ASCII
 * case — the same search the pipeline itself runs for a leaked file name, applied here to the markers
 * of the metadata a served rendition must not hold.
 */
function containsText(haystack: Uint8Array, text: string): boolean {
  const needle = utf8(text);
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
  for (let offset = 0; offset + needle.byteLength <= haystack.byteLength; offset += 1) {
    if (matchesAt(haystack, offset, needle)) return true;
  }
  return false;
}

/** The offset of an ASCII marker in the bytes, or -1 when it does not occur. */
function indexOfAscii(haystack: Uint8Array, marker: string): number {
  const needle = utf8(marker);
  for (let offset = 0; offset + needle.byteLength <= haystack.byteLength; offset += 1) {
    if (matchesAt(haystack, offset, needle)) return offset;
  }
  return -1;
}

/**
 * The creation timestamp an MP4's `mvhd` box states, or 0 when the box is absent or unreadable.
 *
 * Read from the bytes rather than from a media library, because the point of the assertion it serves
 * is that the source carries a container timestamp and is admitted anyway.
 */
function mvhdCreationTime(bytes: Uint8Array): number {
  const marker = indexOfAscii(bytes, "mvhd");
  if (marker < 0) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[marker + 4] ?? 0;
  if (version === 1) {
    return view.getUint32(marker + 8) * 2 ** 32 + view.getUint32(marker + 12);
  }
  return view.getUint32(marker + 8);
}

/** The first member of a collection this file requires, so a missing one fails loudly by name. */
function firstOf<T>(items: readonly T[], what: string): T {
  const item = items[0];
  if (item === undefined) throw new Error(`the seed must provide ${what}`);
  return item;
}

/** The refusal an image preparation produced, or a failure saying the pipeline accepted the file. */
function imageRefusal(result: ImagePreparationResult): ImagePreparationRefusal {
  if (result.ok)
    throw new Error("expected the image pipeline to refuse this file, but it accepted it");
  return result;
}

/** The accepted image preparation, or a failure quoting the refusal that replaced it. */
function imageSuccess(result: ImagePreparationResult): ImagePreparationSuccess {
  if (!result.ok)
    throw new Error(`expected the image pipeline to accept this file: ${result.message}`);
  return result;
}

/** The refusal a video inspection produced, or a failure saying the file was admitted. */
function videoRefusal(result: VideoInspectionResult): VideoRefusal {
  if (result.ok)
    throw new Error("expected the video profile to refuse this file, but it admitted it");
  return result;
}

/** The profile the video inspection established, or a failure quoting the refusal that replaced it. */
function videoCheck(result: VideoInspectionResult): VideoProfileCheck {
  if (!result.ok)
    throw new Error(`expected the video profile to admit this file: ${result.message}`);
  return result.profileCheck;
}

/** The refusal an acceptance returned, or a failure saying the file was accepted. */
function acceptanceRefusal<S extends MediaAssetScope>(
  result: MediaAcceptanceResult<S>,
): MediaRefusal {
  if (result.state === "ready")
    throw new Error("expected this upload to be refused, but it was accepted");
  return result;
}

/** The accepted upload, or a failure quoting the refusal that replaced it. */
function acceptanceSuccess<S extends MediaAssetScope>(
  result: MediaAcceptanceResult<S>,
): MediaAcceptanceSuccess<S> {
  if (result.state === "rejected") {
    throw new Error(`expected this upload to be accepted: ${result.message}`);
  }
  return result;
}

/** The refusal a rendition preparation returned, or a failure saying the rendition was produced. */
function renditionRefusal(result: MediaRenditionResult): MediaRefusal {
  if (result.state === "ready") {
    throw new Error("expected this rendition to be refused, but it was prepared");
  }
  return result;
}

/** The prepared rendition, or a failure quoting the refusal that replaced it. */
function renditionSuccess(result: MediaRenditionResult): MediaRenditionSuccess {
  if (result.state === "rejected") {
    throw new Error(`expected this rendition to be prepared: ${result.message}`);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Phase A — the constants are the fixed values
// ---------------------------------------------------------------------------------------------

describe("the admitted profiles are the fixed values", () => {
  it("holds the image ceiling, the pixel edge and the display edge at their exact values", () => {
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(IMAGE_MAX_EDGE_PX).toBe(8000);
    expect(IMAGE_DISPLAY_MAX_EDGE_PX).toBe(2000);
  });

  it("admits JPEG, PNG and still WebP, and no fourth family", () => {
    expect([...ADMITTED_IMAGE_FORMATS]).toEqual(["jpeg", "png", "webp"]);
    // A duplicate would hold the count at three while one admitted family went missing.
    expect(new Set(ADMITTED_IMAGE_FORMATS).size).toBe(3);
    for (const admitted of ADMITTED_IMAGE_FORMATS) {
      expect(isAdmittedImageFormat(admitted)).toBe(true);
    }
    // Families a camera, a phone or a design tool writes that this profile does not take.
    for (const excluded of ["gif", "avif", "heic", "tiff", "svg", "bmp", "jp2"]) {
      expect(isAdmittedImageFormat(excluded)).toBe(false);
    }
  });

  it("holds the video ceiling, the duration and the display dimensions at their exact values", () => {
    expect(VIDEO_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(VIDEO_MAX_DURATION_S).toBe(180);
    expect(VIDEO_MAX_WIDTH).toBe(1920);
    expect(VIDEO_MAX_HEIGHT).toBe(1080);
  });

  it("admits exactly the two container-and-codec pairs the profile states", () => {
    expect(ADMITTED_VIDEO_PROFILES).toHaveLength(2);
    expect(ADMITTED_VIDEO_PROFILES.map((profile) => profile.container)).toEqual(["mp4", "webm"]);
    const [mp4, webm] = ADMITTED_VIDEO_PROFILES;
    expect(mp4?.video).toEqual(["avc"]);
    expect(mp4?.audio).toEqual(["aac"]);
    expect(webm?.video).toEqual(["vp8", "vp9"]);
    expect(webm?.audio).toEqual(["vorbis", "opus"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase B — the kind comes from the content, never from a name
// ---------------------------------------------------------------------------------------------

describe("a file's kind comes from its content, never from its name", () => {
  it("refuses a Matroska container by content, with a reason that names what is admitted", async () => {
    const refusal = videoRefusal(await inspectVideo({ bytes: fixture("sample-unsupported.mkv") }));

    expect(refusal.code).toBe("unsupported-container");
    // Only a reader of the content can name the container the file actually is, and this one is
    // plausible enough for a video that its name would have passed any extension check.
    expect(refusal.message).toContain("Matroska");
    // Actionable: it names what is admitted rather than saying the file is invalid.
    expect(refusal.action).toBeDefined();
    expect(refusal.action).toContain("MP4");
    expect(refusal.action).toContain("WebM");
  });

  it("refuses a still image offered as a video although its name ends in .mp4", async () => {
    const refusal = acceptanceRefusal(
      await acceptVideo({
        assetId: SEEDED_IMAGE.assetId,
        scope: SCOPE,
        sourceOriginalRef: PRIVATE_ORIGINAL,
        bytes: fixture("poster.jpg"),
        sourceName: "harbour-holiday-clip.mp4",
      }),
    );

    expect(refusal.code).toBe("kind-mismatch");
    expect(refusal.message).toContain("still image");
    // A name never reaches a consumer, not even as the thing a refusal quotes back.
    expect(refusal.message).not.toContain("harbour-holiday-clip");
    expect(refusal.action ?? "").not.toContain("harbour-holiday-clip");
  });

  it("refuses a video offered as an image although its name ends in .jpg", async () => {
    const refusal = acceptanceRefusal(
      await acceptImage({
        assetId: SEEDED_IMAGE.assetId,
        scope: SCOPE,
        sourceOriginalRef: PRIVATE_ORIGINAL,
        bytes: fixture("sample-h264.mp4"),
        sourceName: "welcome-sunday-photo.jpg",
        altText: "The welcome Sunday video",
      }),
    );

    expect(refusal.code).toBe("kind-mismatch");
    expect(refusal.message).toContain("video");
    expect(refusal.message).not.toContain("welcome-sunday-photo");
  });

  it("accepts an image whose name claims to be a video, because the pipeline never reads the name", async () => {
    const accepted = imageSuccess(
      await prepareDisplayImage({
        bytes: fixture("poster.jpg"),
        sourceName: "portrait.mp4",
        assetId: SEEDED_IMAGE.assetId,
      }),
    );

    // The decoder establishes the family; the extension established nothing in either direction.
    expect(accepted.format).toBe("jpeg");
    expect(accepted.mimeType).toBe("image/jpeg");
  });
});

// ---------------------------------------------------------------------------------------------
// Phase C — the image limits, exactly at the boundary
// ---------------------------------------------------------------------------------------------

describe("the image limits are exact at their boundaries", () => {
  it("refuses one byte over 10 MiB before any decoder sees it, and refuses nothing at 10 MiB for its size", async () => {
    // Driven through the pipeline's own byte gate with buffers of exactly the two sizes. At the limit
    // the gate passes and the next check answers instead, which is the only way to tell a limit from an
    // off-by-one: content that is not an image is refused for its content, never for its size.
    const atLimit = imageRefusal(
      await prepareDisplayImage({
        bytes: new Uint8Array(IMAGE_MAX_BYTES),
        assetId: SEEDED_IMAGE.assetId,
      }),
    );
    expect(atLimit.code).toBe("not-an-image");
    expect(atLimit.code).not.toBe("too-large-bytes");

    const overLimit = imageRefusal(
      await prepareDisplayImage({
        bytes: new Uint8Array(IMAGE_MAX_BYTES + 1),
        assetId: SEEDED_IMAGE.assetId,
      }),
    );
    expect(overLimit.code).toBe("too-large-bytes");
    expect(overLimit.message).toContain("10 MiB");
    expect(overLimit.action).toBeDefined();
  });

  it("accepts 8,000 pixels on a side and refuses 8,001 on either side", async () => {
    const atLimit = imageSuccess(
      await prepareDisplayImage({
        bytes: greyscalePng(IMAGE_MAX_EDGE_PX, 10),
        assetId: SEEDED_IMAGE.assetId,
      }),
    );
    expect(atLimit.profileCheck).toEqual({ format: "png", width: 8000, height: 10 });

    const overWide = imageRefusal(
      await prepareDisplayImage({
        bytes: greyscalePng(IMAGE_MAX_EDGE_PX + 1, 10),
        assetId: SEEDED_IMAGE.assetId,
      }),
    );
    expect(overWide.code).toBe("too-large-dimensions");
    expect(overWide.message).toContain(`${IMAGE_MAX_EDGE_PX} pixels`);

    // The bound is per side, so a tall image is refused on the same rule as a wide one.
    const overTall = imageRefusal(
      await prepareDisplayImage({
        bytes: greyscalePng(10, IMAGE_MAX_EDGE_PX + 1),
        assetId: SEEDED_IMAGE.assetId,
      }),
    );
    expect(overTall.code).toBe("too-large-dimensions");
  });

  it("caps the display rendition at 2,000 px on its longest edge without distorting it", async () => {
    const capped = imageSuccess(
      await prepareDisplayImage({
        bytes: greyscalePng(IMAGE_DISPLAY_MAX_EDGE_PX + 1, 10),
        assetId: SEEDED_IMAGE.assetId,
      }),
    );
    // One pixel over the display edge is scaled to it, and the untouched axis keeps its own size.
    expect(capped.width).toBe(2000);
    expect(capped.height).toBe(10);

    const widest = imageSuccess(
      await prepareDisplayImage({
        bytes: greyscalePng(IMAGE_MAX_EDGE_PX, 10),
        assetId: SEEDED_IMAGE.assetId,
      }),
    );
    expect(Math.max(widest.width, widest.height)).toBe(IMAGE_DISPLAY_MAX_EDGE_PX);
  });

  it("measures the pixel edge after orientation, so a rotated photo is bounded by what a reader sees", async () => {
    const rotated = imageSuccess(
      await prepareDisplayImage({
        bytes: withDescriptiveMetadata(fixture("poster.jpg")),
        assetId: SEEDED_IMAGE.assetId,
      }),
    );

    // Stored 960 by 540, displayed 540 by 960. The profile check reports the displayed pair, which is
    // the pair an 8,000-pixel edge is applied to and the pair the rendition is bounded on.
    expect(rotated.profileCheck).toEqual({ format: "jpeg", width: 540, height: 960 });
    expect(rotated.width).toBe(540);
    expect(rotated.height).toBe(960);
  });

  it("admits a still frame only: an animated image is refused although its family is admitted", async () => {
    const still = imageSuccess(
      await prepareDisplayImage({ bytes: greyscalePng(4, 4), assetId: SEEDED_IMAGE.assetId }),
    );
    expect(still.format).toBe("png");

    // Every frame of an animation is an admitted still family, so only the declared frame count
    // separates the two. One frame-count check refuses animation for every admitted family; a WebP
    // animation cannot be authored from the committed still without adding a fixture file, so the rule
    // is proven on the family whose first frame the decoder would otherwise accept on its own.
    const animated = imageRefusal(
      await prepareDisplayImage({ bytes: animatedPng(4, 4), assetId: SEEDED_IMAGE.assetId }),
    );
    expect(animated.code).toBe("animated-not-admitted");
    expect(animated.action).toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------------
// Phase D — the produced rendition is safe to serve
// ---------------------------------------------------------------------------------------------

/** The alternative text every accepted image in these cases carries, in the worker's own words. */
const ALT_TEXT = "A single flower opening against a dark background";

/**
 * One image offered through the module's single acceptance entry point, under the seeded asset's
 * identity and private reference. Each case narrows the result it expects, so an acceptance and a
 * refusal are told apart where they are asserted rather than inside this helper.
 */
async function offerSeededImage(overrides: {
  readonly bytes?: Uint8Array;
  readonly sourceName?: string;
  readonly altText?: string;
  readonly caption?: string;
}): Promise<MediaAcceptanceResult<MediaAssetScope>> {
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

describe("the produced image rendition is safe to serve", () => {
  it("re-encodes the image without the descriptive metadata it arrived with", async () => {
    const tagged = withDescriptiveMetadata(fixture("poster.jpg"));
    // The input must really carry the metadata, or an assertion about the output would prove nothing.
    expect(containsText(tagged, EXIF_SIGNATURE)).toBe(true);
    expect(containsText(tagged, XMP_NAMESPACE)).toBe(true);
    expect(containsText(tagged, SPLICED_DESCRIPTION)).toBe(true);

    const accepted = acceptanceSuccess(await offerSeededImage({ bytes: tagged }));
    const display = firstOf(accepted.renditions, "a display rendition");

    expect(display.purpose).toBe("display");
    expect(display.mimeType).toBe("image/jpeg");
    expect(display.tagVerification).toEqual({ checked: true, residualTags: [] });
    // The delivered bytes are re-encoded, so no EXIF block, no XMP packet and none of the descriptive
    // text survived — and no colour profile was carried across either.
    expect(containsText(display.bytes, EXIF_SIGNATURE)).toBe(false);
    expect(containsText(display.bytes, XMP_NAMESPACE)).toBe(false);
    expect(containsText(display.bytes, SPLICED_DESCRIPTION)).toBe(false);
    expect(containsText(display.bytes, "ICC_PROFILE")).toBe(false);
  });

  it("never enlarges an image that is already smaller than the display edge", async () => {
    const small = imageSuccess(
      await prepareDisplayImage({ bytes: greyscalePng(640, 360), assetId: SEEDED_IMAGE.assetId }),
    );
    // An unconditional upscale to 2,000 px would show here: the rendition keeps the size it was given.
    expect(small.width).toBe(640);
    expect(small.height).toBe(360);
    expect(Math.max(small.width, small.height)).toBeLessThan(IMAGE_DISPLAY_MAX_EDGE_PX);

    const committed = acceptanceSuccess(await offerSeededImage({}));
    const display = firstOf(committed.renditions, "a display rendition");
    expect(display.width).toBe(960);
    expect(display.height).toBe(540);
    expect(display.bytes.byteLength).toBeGreaterThan(0);
    expect(Math.max(display.width ?? 0, display.height ?? 0)).toBeLessThanOrEqual(
      IMAGE_DISPLAY_MAX_EDGE_PX,
    );
  });

  it("carries no copy of the private original's file name", async () => {
    // The seeded private original is named the way a phone names a photograph, which is exactly the
    // identifying detail a served rendition must not repeat.
    expect(PRIVATE_ORIGINAL_REF).toContain("IMG_20260814");

    const accepted = acceptanceSuccess(await offerSeededImage({}));
    const display = firstOf(accepted.renditions, "a display rendition");

    for (const needle of [
      PRIVATE_ORIGINAL_REF,
      "IMG_20260814",
      "harbour-youth-group",
      "media-originals",
    ]) {
      expect(containsText(display.bytes, needle)).toBe(false);
    }
    // The rendition has its own identity, and the private original is not it.
    expect(display.renditionId).toBe(`${SEEDED_IMAGE.assetId}:display`);
    expect(display.assetId).toBe(SEEDED_IMAGE.assetId);
    expect(display.renditionId).not.toContain("media-originals");
    // The caller's opaque original reference and its scope travel through unchanged: media mints
    // neither an identity nor an authority of its own.
    expect(accepted.sourceOriginalRef).toBe(PRIVATE_ORIGINAL);
    expect(accepted.scope).toBe(SCOPE);
    expect(accepted.profileCheck.kind).toBe("image");
  });

  it("requires alternative text and leaves the caption optional", async () => {
    const withoutAlt = acceptanceRefusal(await offerSeededImage({ altText: "   " }));
    expect(withoutAlt.code).toBe("alt-text-required");
    expect(withoutAlt.action).toBeDefined();

    // No caption at all, and a caption of nothing, are the same thing: the image is still acceptable.
    const captionless = acceptanceSuccess(await offerSeededImage({ caption: "   " }));
    expect(captionless.altText).toBe(ALT_TEXT);
    expect(captionless.caption).toBeUndefined();

    const captioned = acceptanceSuccess(
      await offerSeededImage({ altText: `  ${ALT_TEXT}  `, caption: "  A bloom  " }),
    );
    expect(captioned.altText).toBe(ALT_TEXT);
    // A caption is trimmed and kept apart from the alternative text, never defaulted from it.
    expect(captioned.caption).toBe("A bloom");
  });

  it("keeps an accepted placement intact when a later file is refused", async () => {
    const accepted = acceptanceSuccess(await offerSeededImage({}));
    const display = firstOf(accepted.renditions, "a display rendition");
    // The delivered bytes as they stand, compared below by value: a refusal must leave them untouched.
    const preparedBefore = Array.from(display.bytes);
    const shelfBefore = accepted.renditions.map((rendition) => rendition.renditionId);

    const refused = acceptanceRefusal(
      await offerSeededImage({
        bytes: animatedPng(4, 4),
        sourceName: "IMG_20260814-animation.png",
      }),
    );
    expect(refused.code).toBe("animated-not-admitted");

    // A refusal is a value that carries no bytes and no rendition, so it cannot displace the accepted
    // placement or the prose around it; the service keeps the draft it already had.
    expect(refused).not.toHaveProperty("renditions");
    expect(refused).not.toHaveProperty("bytes");
    expect(Array.from(display.bytes)).toEqual(preparedBefore);
    expect(accepted.renditions.map((rendition) => rendition.renditionId)).toEqual(shelfBefore);
  });

  it("serves the seeded assets under rendition identities, never the private original", async () => {
    expect(SEEDED_ASSETS.length).toBeGreaterThan(0);
    for (const asset of SEEDED_ASSETS) {
      expect(asset.sourceOriginalRef.length).toBeGreaterThan(0);
      expect(asset.renditions.length).toBeGreaterThan(0);
      for (const rendition of asset.renditions) {
        // No rendition is the original: a served reference is never the private one, and never a path
        // under the originals tree.
        expect(rendition.bytesRef).not.toBe(asset.sourceOriginalRef);
        expect(rendition.bytesRef.startsWith("media-originals/")).toBe(false);
        expect(rendition.renditionId).not.toBe(asset.sourceOriginalRef);
        expect(rendition.bytesRef).not.toContain("IMG_20260814");
      }
    }
    // Nothing was served with a descriptive tag left in it, and every seeded asset states that check ran.
    for (const asset of SEEDED_ASSETS) {
      expect(asset.tagVerification.checked).toBe(true);
      expect([...asset.tagVerification.residualTags]).toEqual([]);
    }
  });

  it("keeps an unavailable asset's poster rather than an empty player", async () => {
    const withoutPlayback = SEEDED_ASSETS.filter(
      (asset) => asset.kind === "video" && !asset.renditions.some((r) => r.purpose === "playback"),
    );
    expect(withoutPlayback).toHaveLength(1);
    const unavailable = firstOf(withoutPlayback, "a seeded video asset with no playback rendition");
    // The poster stays, so the placement shows the poster and its text alternative while the bytes are
    // gone, and the record claims no preparation that never ran.
    expect(unavailable.renditions.map((rendition) => rendition.purpose)).toEqual(["poster"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase E — the video profile is decided by the container, not the name
// ---------------------------------------------------------------------------------------------

/** The seeded video asset whose playback rendition serves the committed H.264 fixture. */
const SEEDED_MP4_ASSET: SeededMediaAsset = firstOf(
  SEEDED_ASSETS.filter((asset) =>
    asset.renditions.some(
      (r) => r.purpose === "playback" && r.bytesRef.endsWith("sample-h264.mp4"),
    ),
  ),
  "the seeded video asset whose playback rendition serves the committed MP4",
);

/** One video accepted through the module's single acceptance entry point, under the seeded identity. */
async function acceptSeededVideo(
  bytes: Uint8Array,
  sourceName: string,
): Promise<MediaAcceptanceSuccess<MediaAssetScope>> {
  return acceptanceSuccess(
    await acceptVideo({
      assetId: SEEDED_MP4_ASSET.assetId,
      scope: SCOPE,
      sourceOriginalRef: PRIVATE_ORIGINAL,
      bytes,
      sourceName,
    }),
  );
}

/** The six states one placement can be in, written out so a seventh added to the module changes a count here. */
const SIX_STATES: readonly MediaPreparationState[] = [
  "selected",
  "preparing",
  "ready",
  "rejected",
  "cancelled",
  "unavailable",
];

describe("the video profile is decided by the content of the container", () => {
  it("accepts the committed H.264 MP4 with the profile its own container states", async () => {
    const check = videoCheck(await inspectVideo({ bytes: fixture("sample-h264.mp4") }));

    expect(check.container).toBe("mp4");
    expect(check.codec).toBe("avc");
    expect(check.width).toBe(960);
    expect(check.height).toBe(540);
    expect(check.durationS).toBeGreaterThan(0);
    expect(check.durationS).toBeLessThanOrEqual(VIDEO_MAX_DURATION_S);

    // The seeded record describes the same fixture, so no surface can show a codec or a size that the
    // served bytes contradict.
    expect(SEEDED_MP4_ASSET.profileCheck.container).toBe(check.container);
    expect(SEEDED_MP4_ASSET.profileCheck.width).toBe(check.width);
    expect(SEEDED_MP4_ASSET.profileCheck.height).toBe(check.height);
    expect(SEEDED_MP4_ASSET.profileCheck.codec).toContain(check.codec);
    // The record states the fixture's duration to the millisecond; the container reports sample time.
    const recorded = SEEDED_MP4_ASSET.profileCheck.durationSeconds ?? 0;
    expect(Math.abs(recorded - check.durationS)).toBeLessThan(0.01);
  });

  it("reads the duration from the container, so it is the same on every inspection", async () => {
    const first = videoCheck(await inspectVideo({ bytes: fixture("sample-h264.mp4") }));
    const second = videoCheck(await inspectVideo({ bytes: fixture("sample-h264.mp4") }));

    expect(second).toEqual(first);
    // A five-second clip, not elapsed test time and not a wall-clock instant.
    expect(first.durationS).toBeGreaterThan(4);
    expect(first.durationS).toBeLessThan(7);
  });

  it("accepts the committed VP9 WebM as its own container and codec", async () => {
    const check = videoCheck(await inspectVideo({ bytes: fixture("sample-vp9.webm") }));

    expect(check.container).toBe("webm");
    expect(check.codec).toBe("vp9");
    expect(check.width).toBe(640);
    expect(check.height).toBe(360);
    expect(check.durationS).toBeGreaterThan(0);
  });

  it("offers exactly six states, each with a reason and a next step where one exists", () => {
    expect(MEDIA_PREPARATION_STATES).toHaveLength(6);
    expect([...MEDIA_PREPARATION_STATES]).toEqual(SIX_STATES);

    for (const state of SIX_STATES) {
      expect(mediaStateReason(state).label.trim().length).toBeGreaterThan(0);
    }
    // The three failure states stay distinct because they ask different things of the worker, and each
    // offers the step that answers it.
    for (const failed of ["rejected", "cancelled", "unavailable"] as const) {
      expect(mediaStateReason(failed).action).toBeDefined();
    }
    // Nothing has failed in these three, so there is nothing to recover and nothing to offer.
    for (const working of ["selected", "preparing", "ready"] as const) {
      expect(mediaStateReason(working).action).toBeUndefined();
    }
    // Unavailable is stated as unavailable: never as empty and never as zero.
    const unavailable = mediaStateReason("unavailable");
    expect(unavailable.label).toContain("unavailable");
    expect(unavailable.action).toContain("another file");

    // A rejection carries the refusal's own words when the caller kept them.
    const refusal: MediaRefusal = {
      state: "rejected",
      code: "unsupported-container",
      message: "The file is in the Matroska container, which this profile does not admit.",
      action: "Upload an MP4 or a WebM video.",
    };
    const reason = mediaStateReason("rejected", refusal);
    expect(reason.label).toBe(refusal.message);
    expect(reason.action).toBe(refusal.action);
  });

  it("serves a playback rendition verified free of descriptive tags", async () => {
    const source = fixture("sample-h264.mp4");
    // The source states a creation instant in its movie header and is admitted anyway: a container
    // timestamp is not descriptive metadata. That is the documented limitation of a copy-remux, and it
    // is asserted here rather than left for a reader to discover.
    expect(mvhdCreationTime(source)).toBeGreaterThan(0);

    const accepted = await acceptSeededVideo(source, "welcome-sunday.mp4");
    const playback = firstOf(accepted.renditions, "a playback rendition");

    expect(playback.purpose).toBe("playback");
    expect(playback.mimeType).toBe("video/mp4");
    expect(playback.bytes.byteLength).toBeGreaterThan(0);
    expect(playback.tagVerification).toEqual({ checked: true, residualTags: [] });
    expect(accepted.tagVerification).toEqual({ checked: true, residualTags: [] });
    // The copy carries no tag container and no creation instant of its own, so the served bytes hold
    // nothing that could identify the shoot; the source's timestamp was dropped on the way through.
    expect(indexOfAscii(playback.bytes, "udta")).toBe(-1);
    expect(indexOfAscii(playback.bytes, "ilst")).toBe(-1);
    expect(mvhdCreationTime(playback.bytes)).toBe(0);

    // The preparation verifies the copy it made, before any acceptance wraps it: an empty residual list
    // is the only clean answer, and the copy is the admitted video rather than a re-encode of it.
    const prepared = await preparePlaybackRendition({ bytes: source });
    if (!prepared.ok) throw new Error(`expected a playback rendition: ${prepared.message}`);
    expect(prepared.tagVerification).toEqual({ checked: true, residualTags: [] });
    expect(prepared.profileCheck.container).toBe("mp4");
    expect(prepared.profileCheck.codec).toBe("avc");
    expect(prepared.bytes.byteLength).toBe(playback.bytes.byteLength);

    // The served bytes are the admitted video itself, carried over rather than re-encoded.
    const served = videoCheck(await inspectVideo({ bytes: playback.bytes }));
    const inspectedSource = videoCheck(await inspectVideo({ bytes: source }));
    expect(served.container).toBe(inspectedSource.container);
    expect(served.codec).toBe(inspectedSource.codec);
    expect(served.width).toBe(inspectedSource.width);
    expect(served.height).toBe(inspectedSource.height);
    expect(Math.abs(served.durationS - inspectedSource.durationS)).toBeLessThan(0.1);

    // A rendition that kept a descriptive tag is discarded rather than served, and the pipeline reports
    // that outcome under its own code. The committed fixtures cannot reach the branch — the copy is
    // forced, writes no tag set, and is re-read above — and no sixth fixture may be added, so the code
    // is pinned to the refusal union here, where deleting the branch would fail the type check.
    const residualTagRefusal = "tags-residual" satisfies VideoRefusalCode;
    expect(residualTagRefusal).toBe("tags-residual");
  });

  it("prepares the poster and the caption track as renditions of the same asset", async () => {
    const accepted = await acceptSeededVideo(fixture("sample-h264.mp4"), "welcome-sunday.mp4");

    const poster = renditionSuccess(
      await prepareRendition({
        assetId: accepted.assetId,
        purpose: "poster",
        bytes: fixture("poster.jpg"),
        sourceName: "poster.jpg",
        altText: ALT_TEXT,
      }),
    );
    expect(poster.rendition.assetId).toBe(accepted.assetId);
    expect(poster.rendition.purpose).toBe("poster");
    expect(poster.rendition.mimeType).toBe("image/jpeg");
    expect(poster.rendition.renditionId).toBe(`${accepted.assetId}:poster`);
    expect(poster.altText).toBe(ALT_TEXT);

    const captions = renditionSuccess(
      await prepareRendition({
        assetId: accepted.assetId,
        purpose: "captions",
        bytes: fixture("sample.vtt"),
      }),
    );
    expect(captions.rendition.assetId).toBe(accepted.assetId);
    expect(captions.rendition.purpose).toBe("captions");
    expect(captions.rendition.mimeType).toBe(WEBVTT_MIME_TYPE);
    expect(captions.rendition.renditionId).toBe(`${accepted.assetId}:captions`);
    // The stored caption track is canonical UTF-8 WebVTT with a cue that carries text.
    const captionText = new TextDecoder().decode(captions.rendition.bytes);
    expect(captionText.startsWith("WEBVTT")).toBe(true);
    expect(captionText).toContain("-->");
    expect(captionText.trim().length).toBeGreaterThan("WEBVTT".length);

    // The caption track may also serve as the transcript, while a plain transcript is stored as text:
    // caption and poster are renditions of one asset, never a separate route to the same bytes.
    const transcriptOfCaptions = renditionSuccess(
      await prepareRendition({
        assetId: accepted.assetId,
        purpose: "transcript",
        bytes: fixture("sample.vtt"),
      }),
    );
    expect(transcriptOfCaptions.rendition.mimeType).toBe(WEBVTT_MIME_TYPE);
    const plainTranscript = renditionSuccess(
      await prepareRendition({
        assetId: accepted.assetId,
        purpose: "transcript",
        bytes: utf8("A single flower opens against a dark background."),
      }),
    );
    expect(plainTranscript.rendition.mimeType).toBe(PLAIN_TEXT_MIME_TYPE);

    // A poster needs its alternative text for the same reason an accepted image does.
    const posterWithoutAlt = renditionRefusal(
      await prepareRendition({
        assetId: accepted.assetId,
        purpose: "poster",
        bytes: fixture("poster.jpg"),
      }),
    );
    expect(posterWithoutAlt.code).toBe("alt-text-required");
  });

  it("refuses a caption track that is not UTF-8 WebVTT, and refuses display or playback here", async () => {
    const notUtf8 = renditionRefusal(
      await prepareRendition({
        assetId: SEEDED_MP4_ASSET.assetId,
        purpose: "captions",
        bytes: new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x41]),
      }),
    );
    expect(notUtf8.code).toBe("invalid-captions");
    expect(notUtf8.action).toBeDefined();

    const notWebVtt = renditionRefusal(
      await prepareRendition({
        assetId: SEEDED_MP4_ASSET.assetId,
        purpose: "captions",
        bytes: utf8("A caption with no signature.\n"),
      }),
    );
    expect(notWebVtt.code).toBe("invalid-captions");
    expect(notWebVtt.message).toContain("WebVTT");

    // Each picture purpose belongs to the entry point that owns its profile check, so this function
    // never grows into a dispatcher over every purpose.
    for (const purpose of ["display", "playback"] as const) {
      const refused = renditionRefusal(
        await prepareRendition({
          assetId: SEEDED_MP4_ASSET.assetId,
          purpose,
          bytes: fixture("poster.jpg"),
          altText: ALT_TEXT,
        }),
      );
      expect(refused.code).toBe("use-acceptance-entry-point");
    }
    expect([...ANCILLARY_RENDITION_PURPOSES]).toEqual(["poster", "captions", "transcript"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase F — local processing, never a production claim
// ---------------------------------------------------------------------------------------------

describe("local processing is never presented as production scanning or transcoding", () => {
  it("claims no scan, no transcode and no safety qualification in any reason it shows", async () => {
    // Six refusals, drawn from all three pipelines: each keeps its own code, and the shape declared
    // here is the part they share, so one scan covers a refusal from every one of them.
    const refusals: readonly {
      readonly code: string;
      readonly message: string;
      readonly action?: string;
    }[] = [
      videoRefusal(await inspectVideo({ bytes: fixture("sample-unsupported.mkv") })),
      imageRefusal(
        await prepareDisplayImage({
          bytes: new Uint8Array(IMAGE_MAX_BYTES + 1),
          assetId: SEEDED_IMAGE.assetId,
        }),
      ),
      imageRefusal(
        await prepareDisplayImage({
          bytes: greyscalePng(IMAGE_MAX_EDGE_PX + 1, 4),
          assetId: SEEDED_IMAGE.assetId,
        }),
      ),
      imageRefusal(
        await prepareDisplayImage({
          bytes: animatedPng(4, 4),
          assetId: SEEDED_IMAGE.assetId,
        }),
      ),
      renditionRefusal(
        await prepareRendition({
          assetId: SEEDED_MP4_ASSET.assetId,
          purpose: "captions",
          bytes: new Uint8Array([0xff, 0xfe]),
        }),
      ),
      acceptanceRefusal(
        await acceptVideo({
          assetId: SEEDED_MP4_ASSET.assetId,
          scope: SCOPE,
          sourceOriginalRef: PRIVATE_ORIGINAL,
          bytes: fixture("poster.jpg"),
          sourceName: "harbour-holiday-clip.mp4",
        }),
      ),
    ];

    // Wording that would overstate what happened: this application decodes, re-encodes and copies
    // bytes locally, so nothing may claim a scan, a transcode or a safety qualification.
    const overstatement = /virus|malware|antivirus|scan|transcod|certif|guarantee|production/i;

    for (const state of SIX_STATES) {
      const reason = mediaStateReason(state);
      // Label and next step are scanned as one text, so neither can escape the check by being optional.
      expect(`${reason.label}\n${reason.action ?? ""}`).not.toMatch(overstatement);
    }
    for (const refusal of refusals) {
      expect(`${refusal.message}\n${refusal.action ?? ""}`).not.toMatch(overstatement);
    }

    // Preparation is described as the local processing it is, and the refusal sets stay distinct.
    expect(mediaStateReason("preparing").label).toContain("local");
    expect(refusals.map((refusal) => refusal.code)).toEqual([
      "unsupported-container",
      "too-large-bytes",
      "too-large-dimensions",
      "animated-not-admitted",
      "invalid-captions",
      "kind-mismatch",
    ]);
  });
});
