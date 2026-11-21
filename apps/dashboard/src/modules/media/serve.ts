/**
 * Scoped serving decisions for media: whether these rendition bytes may be transmitted on this request,
 * and as what.
 *
 * `assertReadable()` is the one function that decides. It takes the asset identity, the rendition the data
 * service resolved and an authorisation the data service already decided, and returns the exact wire facts
 * of the response: either the case that may be sent, or one of the denial, tombstone, unsatisfiable-range
 * and unavailable outcomes. `parseByteRange()` is the repository's only Range parser and
 * `sliceRenditionBytes()` the only way a partial body is taken, so no route handler repeats either
 * decision, states its own cache policy, or words its own refusal.
 *
 * The invariants this module holds for its caller:
 *
 * - It receives authorisation and never performs it. `allowed` arrives already decided by the data service;
 *   nothing here reads a cookie, a session, a request header of its own, a scope resolver or a feature
 *   flag, so a stale, missing or mistaken decision can only deny.
 * - Denial and absence are one response. An unauthorised read, a purpose this module does not serve, an
 *   unresolvable asset and a rendition the caller cannot name all return the same status, the same fixed
 *   neutral body and the same headers, differing only in the `kind` a caller switches on. Any difference
 *   between them — a refusal status beside a not-found status, a different content length, an `Allow`
 *   header — would let a caption, poster or transcript address answer "does this exist, and may someone
 *   else see it?", which is exactly the disclosure the denial exists to prevent.
 * - Every request re-authorises because nothing is remembered. There is no map of decisions, no cache of
 *   bytes, no clock and no randomness: two calls with the same inputs return equal results, and changing
 *   `allowed` between two calls changes the answer on the very next call.
 * - Restriction cannot recall what a reader already holds. What a denial guarantees is that no further read
 *   succeeds; it claims nothing about a copy already received, so no caller may present it as a recall or a
 *   purge and no caller needs to invent one.
 * - Bytes stay the caller's. The bytes arrive with the rendition the service resolved; this module never
 *   opens a file, never returns a path, never names the private original, and hands back a view of the bytes
 *   it was given.
 * - Nothing identifying is echoed. No file name, title, owner, scope identifier or rendition size reaches a
 *   header or a body: the rendition identity is a value the caller may use, never a header field.
 * - A served rendition proves only that these bytes were sent to an admitted reader. It is not evidence that
 *   anything was released, delivered or read, and no caller may present it as any of those.
 * - Custody is somebody else's. No storage adapter, signed address, access token or transfer service appears
 *   here; the bytes arrive with the rendition, so the future media-custody owner has a seam to replace and
 *   nothing to undo.
 *
 * Scope: AAP 0.3.2 (media serving re-authorises per request, with no permanent address for an original),
 * 0.6.1 (the media module's `assertReadable()` and `prepareRendition()`), 0.7.1 (authorisation precedes
 * enumeration), 0.7.2 (opaque rendition identities, re-authorised per request including byte ranges) and
 * 0.8.6 (every retained media request rechecks current scope; restriction stops playback and rejects later
 * reads without promising recall). Evidence: success criteria 18 and 19.
 */
import type {
  MediaAssetScope,
  MediaOriginalReference,
  MediaRendition,
  MediaRenditionPurpose,
} from "./asset";

// ---------------------------------------------------------------------------------------------
// One cache policy and one neutral refusal
//
// Both live here rather than in a route handler, so the policy that makes a restriction take effect on the
// next read and the body that hides whether a record exists each have exactly one author.
// ---------------------------------------------------------------------------------------------

/**
 * The cache policy of every media response: never stored, never shared, never reused.
 *
 * A response that carried a freshness lifetime, a shared-cache directive or a validator would let a cache
 * answer a later request for the same bytes after the asset had been restricted or the reader had changed,
 * so the restriction would not take effect on the next read. That is why this constant is the only cache
 * header this application sets, and why no caller may add a lifetime, a validator or a sharing directive of
 * its own.
 */
export const MEDIA_CACHE_CONTROL = "private, no-store";

/**
 * The status of a refusal: the same answer for an unauthorised read and for a rendition that does not
 * resolve.
 */
export const MEDIA_NEUTRAL_STATUS = 404;

/**
 * The fixed one-line body of a refusal.
 *
 * It says only that the item is not available. Anything more — whether it exists, who may see it, what it is
 * called, how large it is — is the disclosure that the single neutral answer exists to prevent, so this
 * wording is the whole of what a refused caller may learn.
 */
export const MEDIA_NEUTRAL_MESSAGE = "This media item is not available.";

/** UTF-8 encoder for the two fixed text bodies below; it holds no state of its own. */
const UTF8_ENCODER = new TextEncoder();

/**
 * The fixed refusal body, encoded once.
 *
 * A constant, not remembered request state: every refusal carries this same array, which is what makes a
 * denial and a tombstone identical on the wire by construction rather than by two call sites agreeing.
 */
const NEUTRAL_BODY = UTF8_ENCODER.encode(MEDIA_NEUTRAL_MESSAGE);

/** The headers of a refusal, shared for the same reason as its body. */
const NEUTRAL_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": MEDIA_CACHE_CONTROL,
  "content-type": "text/plain; charset=utf-8",
  "content-length": String(NEUTRAL_BODY.byteLength),
  "x-content-type-options": "nosniff",
};

/** The retry advice carried by an unavailable read: short, so a restored source is picked up soon. */
const UNAVAILABLE_RETRY_SECONDS = 30;

/** What an unavailable read tells the worker, stating the source problem rather than blaming the file. */
const UNAVAILABLE_MESSAGE =
  "This media file could not be read from its source right now. Try again shortly.";

// ---------------------------------------------------------------------------------------------
// Byte ranges
//
// The single Range parser and the single way a partial body is taken. Both are pure: the total arrives with
// the rendition, and nothing here reads a clock, a configuration or a file.
// ---------------------------------------------------------------------------------------------

/** One satisfiable range: an inclusive byte window within an entity of `total` bytes. */
export interface ByteRange {
  /** First byte position included in the response, counted from zero. */
  readonly start: number;
  /** Last byte position included in the response, inclusive, so `end - start + 1` is its length. */
  readonly end: number;
  /** Size of the whole entity in bytes, which `Content-Range` restates after its slash. */
  readonly total: number;
}

/**
 * What a Range header means for this entity.
 *
 * `none` is the caller serving the whole entity with the whole-entity status: no header was supplied, or it
 * could not be honoured, and RFC 9110 permits a server to ignore such a header. `bytes` is the inclusive
 * window to send with the partial-content status. `unsatisfiable` is a window that names no byte of the
 * entity at all, which the caller answers by naming the entity's size and sending no bytes.
 */
export type ByteRangeResult =
  | { readonly kind: "none" }
  | { readonly kind: "bytes"; readonly range: ByteRange }
  | { readonly kind: "unsatisfiable"; readonly total: number };

/** The one header shape this parser honours: a single byte range, in any of its three forms. */
const RANGE_HEADER_SHAPE = /^bytes=(\d*)-(\d*)$/i;

/**
 * Reads one Range header against one entity, returning the inclusive window to send or why there is none.
 *
 * The three forms it honours are `first-last`, `first-` (to the end of the entity) and `-suffixLength` (the
 * last N bytes). A last position beyond the entity clamps to its end, and a suffix longer than the entity
 * selects the whole entity, which is the standard reading of both. A first position at or beyond the entity,
 * and a zero-length suffix, are unsatisfiable. Everything else is a header that cannot be honoured — nothing
 * supplied, no digits, a unit other than bytes, a last position before the first, a set naming more than one
 * range (this release serves no multipart body), or an entity with no bytes at all — and is reported as
 * absent so the caller sends the whole thing. A denial is decided before this function is ever called, so a
 * refused reader cannot use a range request to learn the size of anything.
 */
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

/**
 * The bytes of one response: the whole rendition, or the part the range selected.
 *
 * The result is a view over the caller's buffer, not a copy — nothing is duplicated to answer a range — so a
 * caller must not mutate what it receives. `Uint8Array.prototype.subarray` clamps its bounds instead of
 * throwing, so a window that somehow overruns the bytes can only produce a shorter view; it can never read
 * past the end of the buffer, and it can never widen the response beyond the rendition it came from.
 */
export function sliceRenditionBytes(bytes: Uint8Array, range: ByteRange | null): Uint8Array {
  if (range === null) return bytes;
  return bytes.subarray(range.start, range.end + 1);
}

/** Parses a run of digits that the header shape already proved to be digits, or reports it as too large. */
function digitsToSafeInteger(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

// ---------------------------------------------------------------------------------------------
// What the caller must bring: the decision it already made, and the request's window
// ---------------------------------------------------------------------------------------------

/**
 * The state of the asset the rendition belongs to, in the terms serving acts on.
 *
 * `served` is an ordinary live asset. `restricted` and `withdrawn` are the two ways an admitted reader stops
 * being served, and both answer with the same tombstone as a refusal. `unavailable` is an asset that is in
 * order but whose bytes cannot be read right now, which is a different answer: the reader is entitled to know
 * the source is down rather than to be told the item is gone.
 */
export type MediaServingState = "served" | "restricted" | "withdrawn" | "unavailable";

/**
 * Everything one media request needs to be decided, built by the data service for this request alone.
 *
 * The service resolves the session, derives the scope and answers the permission question; this module
 * receives that answer and never re-derives it. The request's Range header and purpose arrive in the same
 * object so that one function owns the whole decision and a route handler can neither skip the purpose check
 * nor parse a range of its own.
 */
export interface ResolvedMediaAuthorisation {
  /** The service's decision for this request. Anything other than `true` is refused. */
  readonly allowed: boolean;
  /**
   * The authority the decision was made under. Carried so the caller's own provenance travels with the
   * request; it is never read, compared or echoed here, and no denial mentions it.
   */
  readonly scope: MediaAssetScope;
  /** The state the service found for the asset, which decides refusal, tombstone, unavailable or served. */
  readonly assetState: MediaServingState;
  /**
   * The purpose exactly as the request named it, before any lookup — so a request for a purpose this module
   * does not serve, including one that names the private original, is refused before an asset is resolved.
   */
  readonly requestedPurpose: string;
  /** Opaque reference to the bytes' own source; absent means the rendition is not resolvable. */
  readonly bytesRef?: MediaOriginalReference;
  /** The request's Range header, or nothing when it carried none; never consulted before a refusal. */
  readonly rangeHeader?: string | null;
}

// ---------------------------------------------------------------------------------------------
// What a caller receives: the wire facts, or the reason there are none
// ---------------------------------------------------------------------------------------------

/**
 * A response that may be sent: its status, the window it covers and the headers it carries.
 *
 * `headers` already holds the whole set — the content type, the length of the body the caller is about to
 * send and, for a partial response, its content range — so a route handler adds nothing and removes nothing.
 * `byteRange` is what the caller passes to `sliceRenditionBytes()`: the whole rendition when it is null.
 * `renditionId` is the opaque identity a caller may use for its own bookkeeping, deliberately not a header.
 */
export interface MediaReadableResponse {
  readonly kind: "readable";
  /** Whole-entity status, or the partial-content status when a satisfiable range was requested. */
  readonly status: 200 | 206;
  /** Opaque identity of the rendition being sent. */
  readonly renditionId: string;
  /** The purpose the rendition was prepared for, taken from the rendition itself. */
  readonly purpose: MediaRenditionPurpose;
  /** The media type taken from the rendition, never guessed from a file name. */
  readonly mimeType: string;
  /** The inclusive window this response carries, or null when the whole rendition is sent. */
  readonly byteRange: ByteRange | null;
  /** Length of the body the caller must send, in bytes, restated in the headers. */
  readonly contentLength: number;
  /** The complete header set, including the one cache policy this application states. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * A window that names no byte of the entity, answered without a body.
 *
 * The headers name the entity's size, which is what makes the answer useful to a reader already admitted to
 * it, and carry the same cache policy as every other answer so a window cannot be cached past a restriction.
 */
export interface MediaRangeNotSatisfiableResponse {
  readonly kind: "rangeNotSatisfiable";
  readonly status: 416;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The refusal for a reader the service did not authorise, or for a rendition that does not resolve.
 *
 * It carries a body rather than nothing at all because a fixed neutral sentence is a better answer than an
 * empty success, and the same sentence is what a tombstone sends, so the two cases stay indistinguishable.
 */
export interface MediaDeniedResponse {
  readonly kind: "denied";
  readonly status: 404;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/**
 * The answer for a restricted or withdrawn asset: on the wire it is the refusal above, field for field.
 *
 * The `kind` differs only so a caller can name the case in its own diagnostics; a response that differed in
 * any transmitted fact would tell a reader that something once existed here.
 */
export interface MediaTombstoneResponse {
  readonly kind: "tombstone";
  readonly status: 404;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/**
 * The answer when every permission and resolvability check passed but the bytes' source cannot be read.
 *
 * This is the one case that is honestly different from a refusal: the reader is entitled to the item, so
 * telling them the source is down and to try again is the truth, while an empty body presented as success or
 * a fabricated refusal would both be lies. It states the source identity for the caller's retry guidance and
 * never the size, name or content of the rendition.
 */
export interface MediaUnavailableResponse {
  readonly kind: "unavailable";
  readonly status: 503;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  /** Identity of the source that could not be read, so a caller can name it and offer the retry. */
  readonly source: MediaOriginalReference;
  /** Retry guidance in words; it promises no recovery and reveals nothing about the asset. */
  readonly message: string;
}

/**
 * Every answer this module can give. A caller switches over `kind`; these five cases are all of them, and no
 * sixth exists for a state the application cannot reach.
 */
export type MediaReadResult =
  | MediaReadableResponse
  | MediaRangeNotSatisfiableResponse
  | MediaDeniedResponse
  | MediaTombstoneResponse
  | MediaUnavailableResponse;

// ---------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------

/**
 * Decides one media request: the response to send, or the refusal to send instead.
 *
 * The order is the contract, and each step is where it is because of what the step before it makes safe:
 *
 * 1. The purpose is checked before anything is looked up, so a request naming the private original, a purpose
 *    this module does not prepare, or any other arbitrary segment is refused without an asset ever being
 *    resolved. A caption, poster or transcript address therefore cannot become a way to ask whether a
 *    protected video exists.
 * 2. The authorisation the data service already decided is applied next, before any enumeration: a reader who
 *    was not authorised learns nothing, not even that a record was absent.
 * 3. Resolvability follows. A rendition prepared for another purpose, a rendition without bytes, and a
 *    rendition with no source reference all take the same refusal, because "there is nothing here" and "you
 *    may not have it" must be one answer.
 * 4. The asset state then chooses between the tombstone, the honest unavailable answer, and serving.
 * 5. Only an admitted read of a live asset has its Range header parsed, so a range request is never a way past
 *    steps 1 to 4.
 *
 * Nothing is remembered between calls, so every call decides afresh from the inputs it is given. That is how a
 * restriction or a withdrawal takes effect on the very next read, and why a caller must build the
 * authorisation for each request rather than reuse one.
 */
export function assertReadable(
  assetId: string,
  rendition: MediaRendition | null,
  resolvedAuthorisation: ResolvedMediaAuthorisation,
): MediaReadResult {
  // A caller outside the type system can reach this boundary with nothing at all; failing closed is the only
  // answer a serving decision may give to an absent decision.
  if (resolvedAuthorisation === null || resolvedAuthorisation === undefined) return deny();

  if (!isServablePurpose(resolvedAuthorisation.requestedPurpose)) return deny();
  if (resolvedAuthorisation.allowed !== true) return deny();
  if (assetId.trim().length === 0) return deny();
  if (rendition === null) return deny();
  if (rendition.purpose !== resolvedAuthorisation.requestedPurpose) return deny();
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

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

/**
 * The five purposes this module serves, declared as a total map of the media module's own union.
 *
 * A `Record` over the union rather than a list of strings means a purpose added to the media module, or one
 * removed from it, breaks this file's compilation instead of silently becoming unservable — which is what
 * stops one list drifting away from the other. In particular there is no `original` entry, so the uploaded
 * bytes have no serving path at all.
 */
const SERVABLE_PURPOSES: Readonly<Record<MediaRenditionPurpose, true>> = {
  display: true,
  playback: true,
  poster: true,
  captions: true,
  transcript: true,
};

/** Whether a raw request segment names a purpose this module serves; it checks own keys, not the prototype. */
function isServablePurpose(purpose: string): purpose is MediaRenditionPurpose {
  return Object.hasOwn(SERVABLE_PURPOSES, purpose);
}

/** The headers of a response that may be sent: the cache policy, the rendition's type, its length, its window. */
function readableHeaders(
  mimeType: string,
  contentLength: number,
  byteRange: ByteRange | null,
): Readonly<Record<string, string>> {
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

/** The refusal shared by every unauthorised, unservable or unresolvable request. */
function deny(): MediaDeniedResponse {
  return {
    kind: "denied",
    status: MEDIA_NEUTRAL_STATUS,
    headers: NEUTRAL_HEADERS,
    body: NEUTRAL_BODY,
  };
}

/** The answer for a restricted or withdrawn asset: the refusal above, field for field. */
function tombstone(): MediaTombstoneResponse {
  return {
    kind: "tombstone",
    status: MEDIA_NEUTRAL_STATUS,
    headers: NEUTRAL_HEADERS,
    body: NEUTRAL_BODY,
  };
}

/**
 * The answer when everything was in order but the bytes' source cannot be read.
 *
 * The declared length is the length of the retry message, never the size of the rendition: a caller must not
 * be able to learn how large a protected file is from the answer that says it is temporarily unreadable.
 */
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

/** The answer for a window that names no byte of an entity the reader may otherwise have. */
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
