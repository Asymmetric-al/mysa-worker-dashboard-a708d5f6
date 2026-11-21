/**
 * Scoped serving decisions for media: whether these rendition bytes may be transmitted on this
 * request, and as what.
 */
import type { MediaAssetScope, MediaOriginalReference, MediaRendition, MediaRenditionPurpose } from "./asset";
// One cache policy and one neutral refusal
//
// Both live here rather than in a route handler, so the policy that makes a restriction take effect on the
// next read and the body that hides whether a record exists each have exactly one author.
/** The cache policy of every media response: never stored, never shared, never reused. */
export const MEDIA_CACHE_CONTROL = "private, no-store";
/** The status of a refusal: the same answer for an unauthorised read and for a rendition that does not resolve. */
export const MEDIA_NEUTRAL_STATUS = 404;
/** The fixed one-line body of a refusal. */
export const MEDIA_NEUTRAL_MESSAGE = "This media item is not available.";

const UTF8_ENCODER = new TextEncoder();

const NEUTRAL_BODY = UTF8_ENCODER.encode(MEDIA_NEUTRAL_MESSAGE);

const NEUTRAL_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": MEDIA_CACHE_CONTROL,
  "content-type": "text/plain; charset=utf-8",
  "content-length": String(NEUTRAL_BODY.byteLength),
  "x-content-type-options": "nosniff",
};
const UNAVAILABLE_RETRY_SECONDS = 30;

const UNAVAILABLE_MESSAGE = "This media file could not be read from its source right now. Try again shortly.";
// Byte ranges
//
// The single Range parser and the single way a partial body is taken. Both are pure: the total arrives with
// the rendition, and nothing here reads a clock, a configuration or a file.
/** One satisfiable range: an inclusive byte window within an entity of `total` bytes. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
  readonly total: number;
}
/** What a Range header means for this entity. */
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
/** The bytes of one response: the whole rendition, or the part the range selected. */
export function sliceRenditionBytes(bytes: Uint8Array, range: ByteRange | null): Uint8Array {
  if (range === null) return bytes;
  return bytes.subarray(range.start, range.end + 1);
}
function digitsToSafeInteger(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}
// What the caller must bring: the decision it already made, and the request's window
/** The state of the asset the rendition belongs to, in the terms serving acts on. */
export type MediaServingState = "served" | "restricted" | "withdrawn" | "unavailable";
/** Everything one media request needs to be decided, built by the data service for this request alone. */
export interface ResolvedMediaAuthorisation {
  readonly allowed: boolean;
  readonly scope: MediaAssetScope;
  readonly assetState: MediaServingState;
  readonly requestedPurpose: string;
  readonly bytesRef?: MediaOriginalReference;
  readonly rangeHeader?: string | null;
}
// What a caller receives: the wire facts, or the reason there are none
/** A response that may be sent: its status, the window it covers and the headers it carries. */
export interface MediaReadableResponse {
  readonly kind: "readable";
  readonly status: 200 | 206;
  readonly renditionId: string;
  readonly purpose: MediaRenditionPurpose;
  readonly mimeType: string;
  readonly byteRange: ByteRange | null;
  readonly contentLength: number;
  readonly headers: Readonly<Record<string, string>>;
}
/** A window that names no byte of the entity, answered without a body. */
export interface MediaRangeNotSatisfiableResponse {
  readonly kind: "rangeNotSatisfiable";
  readonly status: 416;
  readonly headers: Readonly<Record<string, string>>;
}
/** The refusal for a reader the service did not authorise, or for a rendition that does not resolve. */
export interface MediaDeniedResponse {
  readonly kind: "denied";
  readonly status: 404;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}
/** The answer for a restricted or withdrawn asset: on the wire it is the refusal above, field for field. */
export interface MediaTombstoneResponse {
  readonly kind: "tombstone";
  readonly status: 404;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}
/** The answer when every permission and resolvability check passed but the bytes' source cannot be read. */
export interface MediaUnavailableResponse {
  readonly kind: "unavailable";
  readonly status: 503;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly source: MediaOriginalReference;
  readonly message: string;
}
/** Every answer this module can give. */
export type MediaReadResult = MediaReadableResponse | MediaRangeNotSatisfiableResponse | MediaDeniedResponse | MediaTombstoneResponse | MediaUnavailableResponse;
// The decision
/** Decides one media request: the response to send, or the refusal to send instead. */
export function assertReadable(assetId: string, rendition: MediaRendition | null, resolvedAuthorisation: ResolvedMediaAuthorisation): MediaReadResult {
  // A caller outside the type system can reach this boundary with nothing at all; failing closed is the only
  // answer a serving decision may give to an absent decision.
  if (resolvedAuthorisation === null || resolvedAuthorisation === undefined) return deny();
  if (!isServablePurpose(resolvedAuthorisation.requestedPurpose)) return deny();
  if (resolvedAuthorisation.allowed !== true) return deny();
  if (assetId.trim().length === 0) return deny();
  if (rendition === null) return deny();
  if (rendition.purpose !== resolvedAuthorisation.requestedPurpose) return deny();
  // The rendition must belong to the asset the request named: bytes resolved for one asset are never served
  // under another's address, whatever a caller passed in.
  if (rendition.assetId !== assetId) return deny();
  if (rendition.mimeType.trim().length === 0) return deny();
  if (!(rendition.bytes instanceof Uint8Array)) return deny();
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
  const totalBytes = rendition.bytes.byteLength;
  const requested = parseByteRange(resolvedAuthorisation.rangeHeader ?? null, totalBytes);
  if (requested.kind === "unsatisfiable") return rangeNotSatisfiable(requested.total);
  const byteRange = requested.kind === "bytes" ? requested.range : null;
  const contentLength = byteRange === null ? totalBytes : byteRange.end - byteRange.start + 1;
  return {
    kind: "readable",
    status: byteRange === null ? 200 : 206,
    renditionId: rendition.renditionId,
    purpose: rendition.purpose,
    mimeType: rendition.mimeType,
    byteRange,
    contentLength,
    headers: readableHeaders(rendition.mimeType, contentLength, byteRange),
  };
}
// Internals
const SERVABLE_PURPOSES: Readonly<Record<MediaRenditionPurpose, true>> = {
  display: true,
  playback: true,
  poster: true,
  captions: true,
  transcript: true,
};
function isServablePurpose(purpose: string): purpose is MediaRenditionPurpose {
  return Object.hasOwn(SERVABLE_PURPOSES, purpose);
}
function readableHeaders(mimeType: string, contentLength: number, byteRange: ByteRange | null): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {
    "cache-control": MEDIA_CACHE_CONTROL,
    "content-type": mimeType,
    "content-length": String(contentLength),
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
  };
  if (byteRange !== null) {
    headers["content-range"] = `bytes ${byteRange.start}-${byteRange.end}/${byteRange.total}`;
  }
  return headers;
}
function deny(): MediaDeniedResponse {
  return {
    kind: "denied",
    status: MEDIA_NEUTRAL_STATUS,
    headers: NEUTRAL_HEADERS,
    body: NEUTRAL_BODY,
  };
}
function tombstone(): MediaTombstoneResponse {
  return {
    kind: "tombstone",
    status: MEDIA_NEUTRAL_STATUS,
    headers: NEUTRAL_HEADERS,
    body: NEUTRAL_BODY,
  };
}
function unavailable(source: MediaOriginalReference): MediaUnavailableResponse {
  const body = UTF8_ENCODER.encode(UNAVAILABLE_MESSAGE);
  return {
    kind: "unavailable",
    status: 503,
    headers: {
      "cache-control": MEDIA_CACHE_CONTROL,
      "content-type": "text/plain; charset=utf-8",
      "content-length": String(body.byteLength),
      "retry-after": String(UNAVAILABLE_RETRY_SECONDS),
      "x-content-type-options": "nosniff",
    },
    body,
    source,
    message: UNAVAILABLE_MESSAGE,
  };
}
function rangeNotSatisfiable(total: number): MediaRangeNotSatisfiableResponse {
  return {
    kind: "rangeNotSatisfiable",
    status: 416,
    headers: {
      "content-range": `bytes */${total}`,
      "cache-control": MEDIA_CACHE_CONTROL,
      "content-length": "0",
      "x-content-type-options": "nosniff",
    },
  };
}
