import sharp, { type Metadata } from "sharp";
import { ADMITTED_IMAGE_FORMATS, IMAGE_DISPLAY_MAX_EDGE_PX, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE_PX, type AdmittedImageFormat, type AdmittedImageMimeType } from "./profile";
export { ADMITTED_IMAGE_FORMATS, IMAGE_DISPLAY_MAX_EDGE_PX, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE_PX };
export type { AdmittedImageFormat, AdmittedImageMimeType };
const MIME_TYPES: Record<AdmittedImageFormat, AdmittedImageMimeType> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const DECODE_PIXEL_LIMIT = IMAGE_MAX_EDGE_PX * IMAGE_MAX_EDGE_PX;
const JPEG_QUALITY = 82;
const PNG_COMPRESSION_LEVEL = 9;
const WEBP_QUALITY = 82;
const MIN_LEAK_NEEDLE_LENGTH = 4;
const MARKUP_HEAD_BYTES = 2048;
const MAX_PNG_CHUNKS_INSPECTED = 1024;
export type ImageRefusalCode = "not-an-image" | "unsupported-format" | "animated-not-admitted" | "too-large-bytes" | "too-large-dimensions" | "undecodable" | "metadata-residual" | "filename-leak";
export type PrepareDisplayImageInput = { readonly bytes: Uint8Array; readonly sourceName?: string; readonly assetId: string };
export interface ImagePreparationSuccess {
  readonly ok: true;
  readonly bytes: Uint8Array;
  readonly mimeType: AdmittedImageMimeType;
  readonly format: AdmittedImageFormat;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly profileCheck: { readonly format: AdmittedImageFormat; readonly width: number; readonly height: number };
  readonly tagVerification: { readonly checked: true; readonly residualTags: string[] };
}
export type ImagePreparationRefusal = { readonly ok: false; readonly code: ImageRefusalCode; readonly message: string; readonly action?: string };
export type ImagePreparationResult = ImagePreparationSuccess | ImagePreparationRefusal;
type SniffedImageKind = AdmittedImageFormat | "other-image" | "not-an-image";
type VerificationResult = { readonly ok: true; readonly format: AdmittedImageFormat; readonly width: number; readonly height: number } | { readonly ok: false; readonly refusal: ImagePreparationRefusal };
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const JPEG2000_SIGNATURE = [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20] as const;
const JPEG2000_CODESTREAM_SIGNATURE = [0xff, 0x4f, 0xff, 0x51] as const;
const ICO_SIGNATURE = [0x00, 0x00, 0x01, 0x00] as const;
const HEIF_BRANDS: readonly string[] = ["avci", "avcs", "avif", "avis", "heic", "heim", "heis", "heix", "hevc", "hevm", "hevs", "mif1", "msf1"];
export const isAdmittedImageFormat = (format: string): format is AdmittedImageFormat => (ADMITTED_IMAGE_FORMATS as readonly string[]).includes(format);
/** Validates an uploaded image against the admitted profile and produces the display rendition — the single image pipeline of this application, used for every image and for every poster. */
export async function prepareDisplayImage(input: PrepareDisplayImageInput): Promise<ImagePreparationResult> {
  const { bytes } = input;
  if (bytes.byteLength > IMAGE_MAX_BYTES) return refuseTooLargeBytes();
  const sniffed = sniffImageKind(bytes);
  if (sniffed === "not-an-image") return refuseNotAnImage();
  if (sniffed === "other-image") return refuseUnsupportedFormat();
  let header: Metadata;
  try {
    header = await sharp(bytes, { failOn: "error", limitInputPixels: DECODE_PIXEL_LIMIT }).metadata();
  } catch (error) {
    return refusalForDecodeFailure(error);
  }
  const format = header.format;
  if (!isAdmittedImageFormat(format)) return refuseUnsupportedFormat();
  if (declaredFrameCount(bytes, header, format) > 1) return refuseAnimated();
  const display = displayDimensions(header);
  if (display.width > IMAGE_MAX_EDGE_PX || display.height > IMAGE_MAX_EDGE_PX) return refuseTooLargeDimensions(display.width, display.height);
  let prepared: Buffer;
  try {
    prepared = await renderDisplayImage(bytes, format);
  } catch (error) {
    return refusalForDecodeFailure(error);
  }
  const verification = await verifyPreparedImage(prepared, input.sourceName);
  if (verification.ok === false) return verification.refusal;
  return { ok: true, bytes: prepared, mimeType: MIME_TYPES[verification.format], format: verification.format, width: verification.width, height: verification.height, byteLength: prepared.byteLength, profileCheck: { format, width: display.width, height: display.height }, tagVerification: VERIFIED_TAGS };
}
const VERIFIED_TAGS = { checked: true as const, residualTags: [] as string[] };
function containsSourceName(bytes: Uint8Array, sourceName: string | undefined): boolean {
  const trimmed = sourceName?.trim() ?? "";
  return [...new Set<string>([trimmed, basenameOf(trimmed)])].some((candidate) => candidate.length >= MIN_LEAK_NEEDLE_LENGTH && containsBytesIgnoringAsciiCase(bytes, utf8Bytes(candidate)));
}
function basenameOf(value: string): string {
  const separator = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return separator === -1 ? value : value.slice(separator + 1);
}
function utf8Bytes(text: string): number[] {
  const encoded: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;
    if (code < 0x80) {
      encoded.push(code);
    } else if (code < 0x800) {
      encoded.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      encoded.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else encoded.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return encoded;
}
function containsBytesIgnoringAsciiCase(haystack: Uint8Array, needle: readonly number[]): boolean {
  const first = needle[0];
  if (first === undefined || needle.length > haystack.byteLength) return false;
  for (let start = 0; start <= haystack.byteLength - needle.length; start += 1) {
    if (lowerAscii(haystack[start] ?? 0) !== lowerAscii(first)) continue;
    if (needle.every((expected, offset) => lowerAscii(haystack[start + offset] ?? 0) === lowerAscii(expected))) return true;
  }
  return false;
}
const lowerAscii = (byte: number): number => (byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte);
const bytesAsLatin1 = (bytes: Uint8Array, offset: number, length: number): string => (offset < 0 || length <= 0 || offset + length > bytes.byteLength ? "" : Array.from(bytes.slice(offset, offset + length), (byte) => String.fromCharCode(byte)).join(""));
const matchesAt = (bytes: Uint8Array, offset: number, pattern: readonly number[]): boolean => offset >= 0 && offset + pattern.length <= bytes.byteLength && pattern.every((expected, index) => bytes[offset + index] === expected);
function sniffImageKind(bytes: Uint8Array): SniffedImageKind {
  return bytes.byteLength === 0 ? "not-an-image" : matchesAt(bytes, 0, JPEG_SIGNATURE) ? "jpeg" : matchesAt(bytes, 0, PNG_SIGNATURE) ? "png" : bytesAsLatin1(bytes, 0, 4) === "RIFF" && bytesAsLatin1(bytes, 8, 4) === "WEBP" ? "webp" : looksLikeOtherImage(bytes) ? "other-image" : "not-an-image";
}
function looksLikeOtherImage(bytes: Uint8Array): boolean {
  if (bytesAsLatin1(bytes, 0, 3) === "GIF") return true;
  if (bytesAsLatin1(bytes, 0, 4) === "II*\u0000" || bytesAsLatin1(bytes, 0, 4) === "MM\u0000*") return true;
  if (bytesAsLatin1(bytes, 4, 4) === "ftyp" && HEIF_BRANDS.includes(bytesAsLatin1(bytes, 8, 4))) return true;
  return matchesAt(bytes, 0, JPEG2000_SIGNATURE) || matchesAt(bytes, 0, JPEG2000_CODESTREAM_SIGNATURE) ? true : matchesAt(bytes, 0, ICO_SIGNATURE) ? true : bytesAsLatin1(bytes, 0, 2) === "BM" && bytesAsLatin1(bytes, 6, 2) === "\u0000\u0000" ? true : looksLikeMarkup(bytes);
}
const looksLikeMarkup = (bytes: Uint8Array): boolean =>
  bytesAsLatin1(bytes, 0, Math.min(MARKUP_HEAD_BYTES, bytes.byteLength))
    .replace(/^\u00ef\u00bb\u00bf/, "")
    .trimStart()
    .startsWith("<");
function readUint32BigEndian(bytes: Uint8Array, offset: number): number | undefined {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  const third = bytes[offset + 2];
  const fourth = bytes[offset + 3];
  return first === undefined || second === undefined || third === undefined || fourth === undefined ? undefined : ((first << 24) | (second << 16) | (third << 8) | fourth) >>> 0;
}
const declaredFrameCount = (bytes: Uint8Array, header: Metadata, format: AdmittedImageFormat): number => ((header.pages ?? 1) > 1 || format !== "png" ? (header.pages ?? 1) : pngFrameCount(bytes));
function pngFrameCount(bytes: Uint8Array): number {
  let offset = PNG_SIGNATURE.length;
  let inspected = 0;
  while (offset + 8 <= bytes.byteLength && inspected < MAX_PNG_CHUNKS_INSPECTED) {
    const length = readUint32BigEndian(bytes, offset);
    if (length === undefined) return 1;
    const type = bytesAsLatin1(bytes, offset + 4, 4);
    if (type === "acTL") {
      const frames = readUint32BigEndian(bytes, offset + 8);
      return frames === undefined ? 1 : frames;
    }
    if (type === "IDAT" || type === "IEND") return 1;
    offset += 12 + length;
    inspected += 1;
  }
  return 1;
}
function displayDimensions(header: Metadata): { width: number; height: number } {
  const oriented: Metadata["autoOrient"] | undefined = header.autoOrient;
  if (oriented !== undefined && oriented.width > 0 && oriented.height > 0) return { width: oriented.width, height: oriented.height };
  const orientation = header.orientation;
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8 ? { width: header.height, height: header.width } : { width: header.width, height: header.height };
}
async function renderDisplayImage(bytes: Uint8Array, format: AdmittedImageFormat): Promise<Buffer> {
  const bounded = sharp(bytes, { failOn: "error", limitInputPixels: DECODE_PIXEL_LIMIT }).autoOrient().resize({ width: IMAGE_DISPLAY_MAX_EDGE_PX, height: IMAGE_DISPLAY_MAX_EDGE_PX, fit: "inside", withoutEnlargement: true });
  switch (format) {
    case "jpeg":
      return bounded.jpeg({ quality: JPEG_QUALITY, progressive: true }).toBuffer();
    case "png":
      return bounded.png({ compressionLevel: PNG_COMPRESSION_LEVEL, adaptiveFiltering: true }).toBuffer();
    case "webp":
      return bounded.webp({ quality: WEBP_QUALITY }).toBuffer();
  }
}
async function verifyPreparedImage(prepared: Buffer, sourceName: string | undefined): Promise<VerificationResult> {
  let written: Metadata;
  try {
    written = await sharp(prepared, { failOn: "error" }).metadata();
  } catch {
    return { ok: false, refusal: refuse("metadata-residual", "The prepared image could not be verified, so it was not kept.", "Try another image file.") };
  }
  const deliveredFormat = written.format;
  if (!isAdmittedImageFormat(deliveredFormat)) return { ok: false, refusal: refuse("metadata-residual", "The prepared image came out in a format that is not admitted, so it was not kept.", "Try another image file.") };
  if (residualMetadata(written).length > 0) return { ok: false, refusal: refuse("metadata-residual", "Embedded metadata survived image preparation, so the image was not kept.", "Try another image file.") };
  if (Math.max(written.width, written.height) > IMAGE_DISPLAY_MAX_EDGE_PX) return { ok: false, refusal: refuse("metadata-residual", `The prepared image came out larger than ${IMAGE_DISPLAY_MAX_EDGE_PX} pixels on its longest edge, so it was not kept.`, "Try another image file.") };
  if (containsSourceName(prepared, sourceName)) return { ok: false, refusal: refuse("filename-leak", "The prepared image still carried the original file name, so it was not kept.", "Rename the file and choose it again.") };
  return { ok: true, format: deliveredFormat, width: written.width, height: written.height };
}
function residualMetadata(written: Metadata): string[] {
  const resident: string[] = [];
  if (written.exif !== undefined) resident.push("exif");
  if (written.icc !== undefined) resident.push("icc");
  if (written.iptc !== undefined) resident.push("iptc");
  if (written.xmp !== undefined || written.xmpAsString !== undefined) resident.push("xmp");
  if (written.tifftagPhotoshop !== undefined) resident.push("tifftag-photoshop");
  if ((written.comments?.length ?? 0) > 0) resident.push("comments");
  if (written.orientation !== undefined && written.orientation !== 1) resident.push("orientation");
  return resident;
}
const refuse = (code: ImageRefusalCode, message: string, action?: string): ImagePreparationRefusal => (action === undefined ? { ok: false, code, message } : { ok: false, code, message, action });
const refuseNotAnImage = (): ImagePreparationRefusal => refuse("not-an-image", "This file is not an image; only JPEG, PNG and still WebP images are accepted.", "Choose a JPEG, PNG or WebP image.");
const refuseUnsupportedFormat = (): ImagePreparationRefusal => refuse("unsupported-format", "This image format is not accepted; only JPEG, PNG and still WebP images are accepted.", "Save the image as JPEG, PNG or WebP and choose it again.");
const refuseAnimated = (): ImagePreparationRefusal => refuse("animated-not-admitted", "Animated images are not accepted; only a single still frame is.", "Export a still frame and choose it again.");
const refuseTooLargeBytes = (): ImagePreparationRefusal => refuse("too-large-bytes", `This image is larger than the ${IMAGE_MAX_BYTES / (1024 * 1024)} MiB limit, so it was not processed.`, `Reduce the image to ${IMAGE_MAX_BYTES / (1024 * 1024)} MiB or less and choose it again.`);
const refuseTooLargeDimensions = (width: number, height: number): ImagePreparationRefusal =>
  refuse("too-large-dimensions", `This image is ${width} by ${height} pixels; the limit is ${IMAGE_MAX_EDGE_PX} pixels on either side.`, `Resize the image so neither side is over ${IMAGE_MAX_EDGE_PX} pixels and choose it again.`);
function refusalForDecodeFailure(error: unknown): ImagePreparationRefusal {
  if (/pixel limit/i.test(error instanceof Error ? error.message : ""))
    return refuse("too-large-dimensions", `This image declares more pixels than the ${IMAGE_MAX_EDGE_PX}-pixel-per-side limit allows, so it was not processed.`, `Resize the image so neither side is over ${IMAGE_MAX_EDGE_PX} pixels and choose it again.`);
  return refuse("undecodable", "This image could not be decoded; the file may be damaged or incomplete.", "Try another copy of the image.");
}
