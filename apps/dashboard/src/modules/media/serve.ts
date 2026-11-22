/** Scoped serving decisions for media: whether these rendition bytes may be transmitted on this request, and as what. */
import type { MediaAssetScope, MediaOriginalReference, MediaRendition, MediaRenditionPurpose } from "./asset";
// One cache policy and one neutral refusal, both here rather than in a route handler, so the policy that makes a restriction take effect on the next read and the body that hides whether a record exists each have exactly one author.
/** The cache policy of every media response: never stored, never shared, never reused. */
export const MEDIA_CACHE_CONTROL = "private, no-store";
/** The status of a refusal: the same answer for an unauthorised read and for a rendition that does not resolve. */
export const MEDIA_NEUTRAL_STATUS = 404;
export const MEDIA_NEUTRAL_MESSAGE = "This media item is not available.";
const UTF8_ENCODER = new TextEncoder();
const NEUTRAL_BODY = UTF8_ENCODER.encode(MEDIA_NEUTRAL_MESSAGE);
const NEUTRAL_HEADERS: Readonly<Record<string, string>> = { "cache-control": MEDIA_CACHE_CONTROL, "content-type": "text/plain; charset=utf-8", "content-length": String(NEUTRAL_BODY.byteLength), "x-content-type-options": "nosniff" };
const UNAVAILABLE_RETRY_SECONDS = 30;
const UNAVAILABLE_MESSAGE = "This media file could not be read from its source right now. Try again shortly.";
// Byte ranges: the single Range parser, pure — the entity's total arrives with the rendition's measured size, and nothing here reads a clock, a configuration or a file.
export type ByteRange = { readonly start: number; readonly end: number; readonly total: number };
export type ByteRangeResult = { readonly kind: "none" } | { readonly kind: "bytes"; readonly range: ByteRange } | { readonly kind: "unsatisfiable"; readonly total: number };
const RANGE_HEADER_SHAPE = /^bytes=(\d*)-(\d*)$/i;
/** Reads one Range header against one entity, returning the inclusive window to send or why there is none. */
export function parseByteRange(header: string | null, totalBytes: number): ByteRangeResult {
  const total = Number.isSafeInteger(totalBytes) && totalBytes > 0 ? totalBytes : 0;
  if (total === 0) return { kind: "none" };
  if (header === null) return { kind: "none" };
  const specification = header.trim();
  if (specification.length === 0) return { kind: "none" };
  const matched = RANGE_HEADER_SHAPE.exec(specification);
  if (matched === null) return { kind: "none" };
  const firstDigits = matched[1] ?? "";
  const lastDigits = matched[2] ?? "";
  if (firstDigits.length === 0 && lastDigits.length === 0) return { kind: "none" };
  if (firstDigits.length === 0) {
    const suffixLength = digitsToSafeInteger(lastDigits);
    if (suffixLength === 0) return { kind: "unsatisfiable", total };
    const usable = suffixLength === null ? total : Math.min(suffixLength, total);
    return { kind: "bytes", range: { start: total - usable, end: total - 1, total } };
  }
  const start = digitsToSafeInteger(firstDigits);
  if (start === null || start >= total) return { kind: "unsatisfiable", total };
  if (lastDigits.length === 0) return { kind: "bytes", range: { start, end: total - 1, total } };
  const lastPosition = digitsToSafeInteger(lastDigits);
  if (lastPosition !== null && lastPosition < start) return { kind: "none" };
  const end = lastPosition === null || lastPosition >= total ? total - 1 : lastPosition;
  return { kind: "bytes", range: { start, end, total } };
}
function digitsToSafeInteger(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}
export type MediaServingState = "served" | "restricted" | "withdrawn" | "unavailable";
/**
 * The rendition a serving decision is made on: the record's own identity plus the byte count custody measured for it.
 *
 * It carries no bytes on purpose. A decision that never holds a body cannot transmit one a caller supplied, and the count is the one the caller probed from the store's custody for this rendition's own reference — so the status, the `content-length` and the `content-range` a response states all follow from a size the read obtained rather than from a value it was handed.
 */
export type MediaSizedRendition = Omit<MediaRendition, "bytes"> & { readonly byteLength: number };
export type ResolvedMediaAuthorisation = { readonly allowed: boolean; readonly scope: MediaAssetScope; readonly assetState: MediaServingState; readonly requestedPurpose: string; readonly bytesRef?: MediaOriginalReference; readonly rangeHeader?: string | null };
export type MediaReadableResponse = { readonly kind: "readable"; readonly status: 200 | 206; readonly renditionId: string; readonly purpose: MediaRenditionPurpose; readonly mimeType: string; readonly byteRange: ByteRange | null; readonly contentLength: number; readonly headers: Readonly<Record<string, string>> };
export type MediaRangeNotSatisfiableResponse = { readonly kind: "rangeNotSatisfiable"; readonly status: 416; readonly headers: Readonly<Record<string, string>> };
export type MediaDeniedResponse = { readonly kind: "denied"; readonly status: 404; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array };
export type MediaTombstoneResponse = { readonly kind: "tombstone"; readonly status: 404; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array };
export type MediaUnavailableResponse = { readonly kind: "unavailable"; readonly status: 503; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array; readonly source: MediaOriginalReference; readonly message: string };
export type MediaReadResult = MediaReadableResponse | MediaRangeNotSatisfiableResponse | MediaDeniedResponse | MediaTombstoneResponse | MediaUnavailableResponse;
/** Decides one media request: the response to send, or the refusal to send instead. */
export function assertReadable(assetId: string, rendition: MediaSizedRendition | null, resolvedAuthorisation: ResolvedMediaAuthorisation): MediaReadResult {
  // A caller outside the type system can reach this boundary with nothing at all; failing closed is the only answer a serving decision may give to an absent decision.
  if (resolvedAuthorisation === null || resolvedAuthorisation === undefined) return deny();
  if (!isServablePurpose(resolvedAuthorisation.requestedPurpose)) return deny();
  if (resolvedAuthorisation.allowed !== true) return deny();
  if (assetId.trim().length === 0) return deny();
  if (rendition === null) return deny();
  if (rendition.purpose !== resolvedAuthorisation.requestedPurpose) return deny();
  // The rendition must belong to the asset the request named: bytes resolved for one asset are never served under another's address, whatever a caller passed in.
  if (rendition.assetId !== assetId) return deny();
  if (rendition.mimeType.trim().length === 0) return deny();
  // The entity's size, and never its bytes: the count arrives from the caller's probe of this rendition's own custody reference, so a caller can state a length but cannot supply the content that length describes.
  if (!isCustodyByteCount(rendition.byteLength)) return deny();
  const { bytesRef } = resolvedAuthorisation;
  if (bytesRef === undefined) return deny();
  switch (resolvedAuthorisation.assetState) {
    case "withdrawn":
    case "restricted":
      return tombstone();
    case "unavailable":
      return unavailable(bytesRef);
    case "served":
      break;
    default:
      return deny();
  }
  const totalBytes = rendition.byteLength;
  const requested = parseByteRange(resolvedAuthorisation.rangeHeader ?? null, totalBytes);
  if (requested.kind === "unsatisfiable") return rangeNotSatisfiable(requested.total);
  const byteRange = requested.kind === "bytes" ? requested.range : null;
  const contentLength = byteRange === null ? totalBytes : byteRange.end - byteRange.start + 1;
  return { kind: "readable", status: byteRange === null ? 200 : 206, renditionId: rendition.renditionId, purpose: rendition.purpose, mimeType: rendition.mimeType, byteRange, contentLength, headers: readableHeaders(rendition.mimeType, contentLength, byteRange) };
}
const SERVABLE_PURPOSES: Readonly<Record<MediaRenditionPurpose, true>> = { display: true, playback: true, poster: true, captions: true, transcript: true };
const isServablePurpose = (purpose: string): purpose is MediaRenditionPurpose => Object.hasOwn(SERVABLE_PURPOSES, purpose);
// A byte count is a whole number of bytes, and nothing else: zero is a real (empty) entity, while a negative, fractional, infinite or absent count describes no file and fails the decision closed.
const isCustodyByteCount = (byteCount: number): boolean => Number.isSafeInteger(byteCount) && byteCount >= 0;
function readableHeaders(mimeType: string, contentLength: number, byteRange: ByteRange | null): Readonly<Record<string, string>> {
  const headers: Record<string, string> = { "cache-control": MEDIA_CACHE_CONTROL, "content-type": mimeType, "content-length": String(contentLength), "accept-ranges": "bytes", "x-content-type-options": "nosniff" };
  if (byteRange !== null) headers["content-range"] = `bytes ${byteRange.start}-${byteRange.end}/${byteRange.total}`;
  return headers;
}
const deny = (): MediaDeniedResponse => ({ kind: "denied", status: MEDIA_NEUTRAL_STATUS, headers: NEUTRAL_HEADERS, body: NEUTRAL_BODY });
const tombstone = (): MediaTombstoneResponse => ({ kind: "tombstone", status: MEDIA_NEUTRAL_STATUS, headers: NEUTRAL_HEADERS, body: NEUTRAL_BODY });
function unavailable(source: MediaOriginalReference): MediaUnavailableResponse {
  const body = UTF8_ENCODER.encode(UNAVAILABLE_MESSAGE);
  return { kind: "unavailable", status: 503, headers: { "cache-control": MEDIA_CACHE_CONTROL, "content-type": "text/plain; charset=utf-8", "content-length": String(body.byteLength), "retry-after": String(UNAVAILABLE_RETRY_SECONDS), "x-content-type-options": "nosniff" }, body, source, message: UNAVAILABLE_MESSAGE };
}
const rangeNotSatisfiable = (total: number): MediaRangeNotSatisfiableResponse => ({ kind: "rangeNotSatisfiable", status: 416, headers: { "content-range": `bytes */${total}`, "cache-control": MEDIA_CACHE_CONTROL, "content-length": "0", "x-content-type-options": "nosniff" } });
