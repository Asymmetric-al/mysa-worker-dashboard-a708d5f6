/**
 * Media acceptance and rendition preparation: the media module's entry points.
 *
 * One accepting path exists per kind — `acceptImage()` for a still image, `acceptVideo()` for a video — and each
 * delegates the whole profile check to the sibling that owns it (`./image`, `./video`) rather than repeating a
 * byte limit, a pixel limit, a codec rule, a decoder or a muxer here. `prepareRendition()` supplies only the
 * ancillary purposes a placement attaches to an asset it already holds (poster, captions, transcript), which is
 * what keeps a universal dispatcher from appearing.
 *
 * The invariants this module holds for its caller:
 *
 * - Identity and scope belong to the caller. `assetId`, `scope` and `sourceOriginalRef` arrive as inputs and are
 *   passed through unchanged; nothing here mints a record identity or derives one from a name, an address or a
 *   file name.
 * - Bytes, not storage. Every accepted rendition is returned with its bytes. This module never assigns a
 *   `bytesRef`, never writes a file and never names a path: `registerMediaAsset` persists the bytes under the
 *   git-ignored data tree and substitutes the reference it assigns. For the same reason these bytes are never
 *   inlined into a stored JSON document as base64, and nothing here may be served from `public/`.
 * - The original is private and unserved. `sourceOriginalRef` names it opaquely, and no purpose called
 *   `original` exists, so no rendition can carry the uploaded original back out to a reader.
 * - No file name reaches a consumer. `sourceName` is accepted only so the image pipeline can prove that no copy
 *   of it survived into the prepared bytes; it is never stored, returned, logged, echoed in a refusal or used to
 *   establish a kind. Kind comes from the content's magic bytes and from the decoder, never from an extension.
 * - Preparation is local processing. Nothing here uploads, transcodes remotely or scans for malware, and no
 *   message in this file may claim that it does; the surface that triggers preparation carries that label.
 * - Refusals are values. Every refusal carries a `code`, a readable `message` and, where there is one, an
 *   `action`, and none of them throws past this boundary, so a refused upload leaves the surrounding draft and
 *   the sibling renditions exactly as they were.
 *
 * Scope: AAP 0.6.1 (media-module `acceptImage()`, `acceptVideo()`, `prepareRendition()`), 0.6.2 (the asset and
 * rendition record these descriptors feed), 0.8.6 (rendition purposes, the six media states, the private
 * original, alt text required and caption optional), 0.2.1 (`file-type` types images and video by magic bytes,
 * never by name), and the evidence for success criteria 9 and 18.
 */

import { fileTypeFromBuffer, type FileTypeResult } from "file-type";

import {
  prepareDisplayImage,
  type AdmittedImageFormat,
  type ImagePreparationRefusal,
} from "./image";
import {
  inspectVideo,
  preparePlaybackRendition,
  type AdmittedContainer,
  type AdmittedVideoCodec,
  type VideoProfileCheck,
  type VideoRefusal,
} from "./video";

// ---------------------------------------------------------------------------------------------
// States and purposes, each declared once
// ---------------------------------------------------------------------------------------------

/**
 * The six states one media placement can be in, and the only ones.
 *
 * `selected` and `preparing` describe work in progress, `ready` describes accepted renditions, and the three
 * failure states stay distinct because they ask different things of the worker: a `rejected` file needs another
 * file, a `cancelled` upload needs to be chosen again, and an `unavailable` asset needs its source restored.
 */
export type MediaPreparationState =
  | "selected"
  | "preparing"
  | "ready"
  | "rejected"
  | "cancelled"
  | "unavailable";

/** The six states in the order a picker offers them, so no seventh is ever added by accident. */
export const MEDIA_PREPARATION_STATES: readonly MediaPreparationState[] = [
  "selected",
  "preparing",
  "ready",
  "rejected",
  "cancelled",
  "unavailable",
];

/**
 * The five purposes a rendition can serve.
 *
 * There is deliberately no `original`: the uploaded bytes are named by `sourceOriginalRef` and are never a
 * rendition, which is what keeps the original off every serving path.
 */
export type MediaRenditionPurpose = "display" | "playback" | "poster" | "captions" | "transcript";

/**
 * The purposes `prepareRendition()` supplies for an asset that was already accepted.
 *
 * `display` and `playback` are absent on purpose: each is produced by its own acceptance entry point, which is
 * where its profile check and its metadata verification run.
 */
export type MediaAncillaryRenditionPurpose = "poster" | "captions" | "transcript";

/** The three ancillary purposes, in the order a placement offers them. */
export const ANCILLARY_RENDITION_PURPOSES: readonly MediaAncillaryRenditionPurpose[] = [
  "poster",
  "captions",
  "transcript",
];

/** MIME type stored for a caption track, and for a transcript written as WebVTT. */
export const WEBVTT_MIME_TYPE = "text/vtt";

/** MIME type stored for a transcript written as plain text. */
export const PLAIN_TEXT_MIME_TYPE = "text/plain";

// ---------------------------------------------------------------------------------------------
// Preparation descriptors
//
// These are the shapes `registerMediaAsset` maps into the persisted record; the persisted record itself is
// declared once in `data-service/envelope.ts`, so nothing here restates it.
// ---------------------------------------------------------------------------------------------

/**
 * The organization and ministry authority a media asset belongs to, exactly as its caller states it.
 *
 * Media never derives, widens or re-orders this; the caller's own scope type travels through the acceptance
 * result unchanged, which is why the value is typed generically rather than narrowed to a media-owned shape.
 */
export interface MediaAssetScope {
  readonly organizationId: string;
  readonly ministryId: string;
}

/**
 * An opaque, source-qualified reference to the private uploaded original.
 *
 * The pair is the same source-qualified identity every other cross-system reference in this application uses
 * (`{ system, reference }`), declared structurally here because the media module imports nothing from `src/lib`.
 * `reference` is never parsed, never compared across systems and never used as a join key.
 */
export interface MediaOriginalReference {
  readonly system: string;
  readonly reference: string;
}

/** What the admitted-profile check established about the source file, stated in the profile's own terms. */
export type MediaProfileCheck =
  | {
      readonly kind: "image";
      /** Admitted still-image family the decoder established from the content. */
      readonly format: AdmittedImageFormat;
      /** Display width in pixels, measured after EXIF orientation was applied. */
      readonly width: number;
      /** Display height in pixels, measured after EXIF orientation was applied. */
      readonly height: number;
    }
  | {
      readonly kind: "video";
      readonly container: AdmittedContainer;
      readonly codec: AdmittedVideoCodec;
      /** Duration in seconds read from the container. */
      readonly durationS: number;
      /** Display width in pixels, measured after the track's rotation was applied. */
      readonly width: number;
      /** Display height in pixels, measured after the track's rotation was applied. */
      readonly height: number;
    };

/** What the post-encode or post-remux check established about the bytes actually served. */
export interface MediaTagVerification {
  /** True once the delivered bytes were re-read and inspected; a refusal replaces an unchecked result. */
  readonly checked: boolean;
  /** Names of any descriptive metadata or identifying detail that survived; empty is the only clean result. */
  readonly residualTags: string[];
}

/** One prepared rendition: the bytes this application serves, with the checks that admitted them. */
export interface MediaRendition {
  /** The asset identity this rendition belongs to, so a serving decision can refuse another asset's bytes. */
  readonly assetId: string;
  /** Deterministic identity of the rendition: the asset identity, the purpose and the caller's optional variant. */
  readonly renditionId: string;
  readonly purpose: MediaRenditionPurpose;
  /** MIME type the caller serves these bytes as; the pipeline's own answer, never a guess from a file name. */
  readonly mimeType: string;
  /** The prepared bytes, ready for the service to persist and for a scoped route to serve. */
  readonly bytes: Uint8Array;
  /** Width of the prepared bytes in pixels, where the purpose has a picture. */
  readonly width?: number;
  /** Height of the prepared bytes in pixels, where the purpose has a picture. */
  readonly height?: number;
  /** The admitted source profile, for the picture purposes. */
  readonly profileCheck?: MediaProfileCheck;
  /** The delivered-byte verification, for the purposes whose bytes were re-read. */
  readonly tagVerification?: MediaTagVerification;
}

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

/**
 * Every code this module can return: its own four rules plus each sibling pipeline's own vocabulary, carried
 * through unchanged so one implementation owns each profile's reasons.
 */
export type MediaRefusalCode =
  | ImagePreparationRefusal["code"]
  | VideoRefusal["code"]
  /** A video handed to the image entry point, or an image handed to the video entry point. */
  | "kind-mismatch"
  /** An image or poster supplied without alternative text. */
  | "alt-text-required"
  /** A caption track that is not valid UTF-8, is empty, or is not a WebVTT document with a cue. */
  | "invalid-captions"
  /** A transcript that is not valid UTF-8, or holds nothing readable. */
  | "invalid-transcript"
  /** `display` or `playback` asked of the ancillary entry point; its own acceptance entry point produces it. */
  | "use-acceptance-entry-point"
  /** A purpose this module does not prepare at all, reachable only from an untyped caller. */
  | "unsupported-rendition-purpose";

/** A refused upload or rendition: returned as a value, with what to do next when there is something to do. */
export interface MediaRefusal {
  readonly state: "rejected";
  readonly code: MediaRefusalCode;
  /** Readable reason for the person who chose the file; it never quotes the file name. */
  readonly message: string;
  /** The next step, when there is a useful one. */
  readonly action?: string;
}

// ---------------------------------------------------------------------------------------------
// Inputs and results
// ---------------------------------------------------------------------------------------------

/** What every acceptance needs, whatever the kind: the caller's identity and scope, and the bytes received. */
export interface MediaAcceptanceInput<S extends MediaAssetScope> {
  /** The asset identity the caller minted; media neither creates nor changes it. */
  readonly assetId: string;
  /** The authority the asset belongs to, passed through unchanged and returned by reference. */
  readonly scope: S;
  /** Opaque reference to the private original, passed through unchanged and never made a rendition. */
  readonly sourceOriginalRef: MediaOriginalReference;
  /** The bytes exactly as received; their kind is established by their content, never by a name. */
  readonly bytes: Uint8Array;
  /** The uploaded file name, used only to prove no copy of it survives preparation; never stored. */
  readonly sourceName?: string;
  /** Optional disambiguating suffix for the rendition identity, when one asset carries repeated stills. */
  readonly variant?: string;
}

/** An image acceptance: the profile's alternative text is required, its caption optional. */
export interface AcceptImageInput<S extends MediaAssetScope> extends MediaAcceptanceInput<S> {
  /** What the image shows, in the worker's words; required, and never defaulted from the caption. */
  readonly altText: string;
  /** The visible caption, which is optional and is kept apart from the alternative text. */
  readonly caption?: string;
}

/** A video acceptance: the video profile supplies no text fields of its own. */
export type AcceptVideoInput<S extends MediaAssetScope> = MediaAcceptanceInput<S>;

/** An accepted file: the admitted profile, the renditions prepared for it, and the checks that admitted them. */
export interface MediaAcceptanceSuccess<S extends MediaAssetScope> {
  readonly state: "ready";
  readonly kind: "image" | "video";
  readonly assetId: string;
  /** The caller's own scope value, returned by reference so the record and the read share one authority. */
  readonly scope: S;
  /** The caller's own original reference, returned by reference. */
  readonly sourceOriginalRef: MediaOriginalReference;
  /** What the profile check established about the source file. */
  readonly profileCheck: MediaProfileCheck;
  /**
   * The renditions that make up an accepted asset. Acceptance produces exactly one — `display` for an image,
   * `playback` for a video — and the ancillary ones are added by `prepareRendition()` as the placement asks
   * for them.
   */
  readonly renditions: MediaRendition[];
  /** The delivered-byte verification for the accepted bytes. */
  readonly tagVerification: MediaTagVerification;
  /** The trimmed alternative text the image was accepted with; absent for a video. */
  readonly altText?: string;
  /** The trimmed caption the image was accepted with; absent when none was supplied. */
  readonly caption?: string;
}

/** The outcome of one acceptance: an accepted asset, or the refusal that left the draft untouched. */
export type MediaAcceptanceResult<S extends MediaAssetScope = MediaAssetScope> =
  | MediaAcceptanceSuccess<S>
  | MediaRefusal;

/** What `prepareRendition()` needs: the asset the rendition belongs to, its purpose, and the supplied bytes. */
export interface PrepareRenditionInput {
  /** Identity of the asset this rendition belongs to; the same value its acceptance received. */
  readonly assetId: string;
  /** The purpose to prepare; `poster`, `captions` and `transcript` are prepared here. */
  readonly purpose: MediaRenditionPurpose;
  /** The supplied bytes: a still image for `poster`, a WebVTT or plain-text document for the text purposes. */
  readonly bytes: Uint8Array;
  /** Required for `poster`, where it is the text alternative when the video cannot be played. */
  readonly altText?: string;
  /** The supplied file name, used only for the image pipeline's leak check; never stored or echoed. */
  readonly sourceName?: string;
  /** Optional disambiguating suffix for the rendition identity. */
  readonly variant?: string;
}

/** A prepared ancillary rendition. */
export interface MediaRenditionSuccess {
  readonly state: "ready";
  readonly assetId: string;
  readonly rendition: MediaRendition;
  /** The trimmed alternative text a poster was accepted with; absent for the text purposes. */
  readonly altText?: string;
}

/** The outcome of one ancillary preparation: the rendition, or the refusal that changed nothing. */
export type MediaRenditionResult = MediaRenditionSuccess | MediaRefusal;

// ---------------------------------------------------------------------------------------------
// The two acceptance entry points
// ---------------------------------------------------------------------------------------------

/**
 * Accepts one still image: types it by content, requires its alternative text, and returns the display rendition.
 *
 * The order is deliberate. The kind is settled from the magic bytes first, so a video handed to this entry point
 * is refused as a kind mismatch without being decoded. The alternative text is checked before the image
 * pipeline runs, so a missing description never costs a full decode and re-encode. Everything the profile
 * requires — the 10 MiB ceiling before any decode, the 8,000-pixel edge after orientation, the bounded
 * re-encode, and the metadata and file-name verification of the delivered bytes — happens inside
 * `prepareDisplayImage()`, the application's single image pipeline, and is not re-checked here.
 *
 * A file whose content is some other image family, or no image at all, is refused by that pipeline with its own
 * precise reason (`unsupported-format`, `not-an-image`, `animated-not-admitted`), so this module never keeps a
 * second opinion about what an image is.
 */
export async function acceptImage<S extends MediaAssetScope>(
  input: AcceptImageInput<S>,
): Promise<MediaAcceptanceResult<S>> {
  const detected = await detectKind(input.bytes);
  if (detected !== null && isVideoKind(detected)) {
    return refuse(
      "kind-mismatch",
      "This file is a video, so it cannot be accepted as an image.",
      "Choose a JPEG, PNG or WebP image, or add the video as a video placement.",
    );
  }

  const altText = trimmedOrEmpty(input.altText);
  if (altText.length === 0) {
    return refuse(
      "alt-text-required",
      "An image needs alternative text describing what it shows before it can be placed.",
      "Describe what the image shows, then choose the file again.",
    );
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

/**
 * Accepts one video: types it by content, gates the admitted profile, and returns the tag-free playback rendition.
 *
 * `inspectVideo()` decides admission — the container, its codecs, the container duration and the display
 * dimensions after rotation — before any copy is attempted, so a file outside the profile is refused without
 * paying for a remux. A Matroska file is the case criterion 18 needs: its magic bytes type it as video, and its
 * content is then refused as `unsupported-container`, because the profile admits MP4 and WebM only.
 * `preparePlaybackRendition()` copies the admitted samples into the served bytes and verifies that copy, and
 * neither the profile nor the tag rule is re-implemented here.
 *
 * The poster and the caption track are deliberately not produced here. A poster is a supplied still that goes
 * through the image pipeline in `prepareRendition()`, captions and transcripts are supplied documents, and
 * nothing in this application extracts a frame from a video.
 */
export async function acceptVideo<S extends MediaAssetScope>(
  input: AcceptVideoInput<S>,
): Promise<MediaAcceptanceResult<S>> {
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

// ---------------------------------------------------------------------------------------------
// Ancillary renditions
// ---------------------------------------------------------------------------------------------

/**
 * Prepares one ancillary rendition for an asset that was already accepted.
 *
 * Only `poster`, `captions` and `transcript` are prepared here. Asking for `display` or `playback` is refused
 * with `use-acceptance-entry-point`, naming the entry point that produces it, which is what keeps this function
 * from growing into a dispatcher over every purpose. A poster runs through the same image pipeline as an
 * accepted image — same limits, same orientation, same stripping, same verification — so no second picture
 * generator exists. Captions and transcripts are supplied documents, validated as UTF-8 text. Every rendition
 * here belongs to the same `assetId` as the playback rendition, so it is served through the same authorisation
 * path: a caption track is never a way around a video that another persona may not see.
 */
export async function prepareRendition(
  input: PrepareRenditionInput,
): Promise<MediaRenditionResult> {
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

/** Prepares a poster from a supplied still image, through the one image pipeline, with its text alternative. */
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

/**
 * Prepares a caption track or a transcript from a supplied text document.
 *
 * The bytes must decode strictly as UTF-8, which refuses a document saved in a single-byte encoding instead of
 * guessing what its author meant. One leading byte-order mark is stripped, and the stored bytes are re-encoded
 * from the decoded text, so a stored document is always canonical UTF-8 without a mark. A caption track must be
 * a WebVTT document — the header on its first non-blank line, and at least one cue that carries text — while a
 * transcript may be WebVTT or plain text. A document that decodes but carries control characters no text
 * document holds is refused rather than stored, so a binary file cannot masquerade as captions. No refusal here
 * mentions the supplied file name.
 */
function prepareTextRendition(
  input: PrepareRenditionInput,
  purpose: MediaAncillaryRenditionPurpose,
): MediaRenditionResult {
  const isCaptions = purpose === "captions";
  const code = isCaptions ? "invalid-captions" : "invalid-transcript";
  const noun = isCaptions ? "caption track" : "transcript";

  const decoded = decodeUtf8(input.bytes);
  if (decoded === null) {
    return refuse(
      code,
      `The ${noun} is not valid UTF-8 text, so it was not accepted.`,
      `Save the ${noun} as UTF-8 and choose it again.`,
    );
  }

  const text = stripLeadingByteOrderMark(decoded);
  if (text.trim().length === 0) {
    return refuse(
      code,
      `The ${noun} holds no text, so it was not accepted.`,
      `Add the ${noun} and choose the file again.`,
    );
  }
  if (carriesNonTextBytes(text)) {
    return refuse(
      code,
      `The ${noun} carries bytes that a text document cannot hold, so it was not accepted.`,
      `Save the ${noun} as a text file and choose it again.`,
    );
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
      return refuse(
        code,
        "The caption track carries no cue with text, so it was not accepted.",
        "Add at least one cue with its text to the caption track and choose the file again.",
      );
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

// ---------------------------------------------------------------------------------------------
// State reasons
// ---------------------------------------------------------------------------------------------

/** What a picker shows for one state: a short label and, where the worker can act, the next step. */
export interface MediaStateReason {
  readonly label: string;
  readonly action?: string;
}

/** Stands in for a rejection whose refusal a caller did not keep, so the slot never renders silently. */
const REJECTED_WITHOUT_REFUSAL: MediaStateReason = {
  label: "This file was not accepted.",
  action: "Choose a different file.",
};

/** A cancelled upload changed nothing, so its action is to choose the file again and its draft is untouched. */
const CANCELLED_REASON: MediaStateReason = {
  label: "The upload was cancelled; nothing was added and the rest of the draft is unchanged.",
  action: "Choose the file again when you are ready.",
};

/** An asset whose bytes or source are missing is stated as unavailable, never as empty and never as zero. */
const UNAVAILABLE_REASON: MediaStateReason = {
  label: "This media file is unavailable, so it cannot be shown or played right now.",
  action: "Try again, or replace the placement with another file.",
};

/**
 * The label and next step for one media state, so no surface renders a silent empty slot.
 *
 * `selected`, `preparing` and `ready` carry no action because nothing has failed and there is nothing to
 * recover; `preparing` describes local processing in those words. For `rejected` the refusal the acceptance
 * returned supplies both the label and the action, because only it knows what failed and what helps; the
 * generic wording stands in only when a caller kept no refusal to offer.
 */
export function mediaStateReason(
  state: MediaPreparationState,
  refusal?: MediaRefusal,
): MediaStateReason {
  switch (state) {
    case "selected":
      return { label: "Selected; this file has not been checked yet." };
    case "preparing":
      return { label: "Checking this file with the local media pipeline." };
    case "ready":
      return { label: "Ready." };
    case "rejected": {
      if (refusal === undefined) return REJECTED_WITHOUT_REFUSAL;
      return refusal.action === undefined
        ? { label: refusal.message }
        : { label: refusal.message, action: refusal.action };
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

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

/** Strict UTF-8 decoder: a document in any other encoding fails here rather than being guessed at. */
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** UTF-8 encoder, so a stored text rendition is canonical UTF-8. */
const UTF8_ENCODER = new TextEncoder();

/** One leading byte-order mark, which a text document may carry and a stored copy need not. */
const BYTE_ORDER_MARK = "\uFEFF";

/** The three ways a text document can break a line. */
const LINE_BREAK = /\r\n|\r|\n/;

/** The word every WebVTT document begins with. */
const WEBVTT_HEADER = "WEBVTT";

/** The arrow every WebVTT cue timing line contains. */
const CUE_TIMING_ARROW = "-->";

/** The three C0 codes that are text: tab, line feed and carriage return. */
const TEXT_CONTROL_CODES: readonly number[] = [0x09, 0x0a, 0x0d];

/** C0 codes end here; everything above is printable or part of a multi-byte character. */
const END_OF_C0_CONTROLS = 0x20;

/** Decodes one byte sequence as UTF-8, or reports that it is not UTF-8 at all. */
function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

/** Encodes text as UTF-8 bytes. */
function encodeUtf8(text: string): Uint8Array {
  return UTF8_ENCODER.encode(text);
}

/** Removes one leading byte-order mark, leaving any other content exactly as it was. */
function stripLeadingByteOrderMark(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
}

/**
 * Reports whether decoded text carries a control character a text document cannot hold.
 *
 * Tab, line feed and carriage return are text; every other C0 control character means the bytes are not a
 * document the worker could have written, so a binary file that happens to decode as UTF-8 is refused rather
 * than stored as captions or a transcript.
 */
function carriesNonTextBytes(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= END_OF_C0_CONTROLS) continue;
    if (TEXT_CONTROL_CODES.includes(code)) continue;
    return true;
  }
  return false;
}

/** Splits a document into lines on any of the three line-break forms, keeping empty lines. */
function splitLines(text: string): string[] {
  return text.split(LINE_BREAK);
}

/** The document's first non-blank line, trimmed; a document of blank lines has none. */
function firstNonBlankLine(lines: readonly string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * Reports whether a line is the WebVTT signature: the word `WEBVTT`, optionally followed by header text after a
 * space or a tab. The signature counts only as the document's first non-blank line; anywhere else, the same
 * text is cue content.
 */
function isWebVttHeaderLine(line: string): boolean {
  if (line === WEBVTT_HEADER) return true;
  return line.startsWith(`${WEBVTT_HEADER} `) || line.startsWith(`${WEBVTT_HEADER}\t`);
}

/**
 * Reports whether a WebVTT document carries at least one cue with text in it: a timing line with a payload line
 * after it, inside the same block. A timing line with nothing under it before the next blank line is an empty
 * cue, which shows nothing to a reader and is not a caption track.
 */
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

/**
 * Types one candidate file by its magic bytes.
 *
 * `file-type` establishes the family from the content, so an extension proves nothing in either direction: an
 * image renamed to a spreadsheet name is still an image, and a document renamed to a video name is not a video.
 * A header the detector cannot classify, or a detector fault on malformed input, yields `null` — no opinion —
 * and the profile pipeline then decides from the decoded content, so each profile keeps exactly one authority.
 */
async function detectKind(bytes: Uint8Array): Promise<FileTypeResult | null> {
  try {
    return (await fileTypeFromBuffer(bytes)) ?? null;
  } catch {
    return null;
  }
}

/** Reports whether the detected family is a video, Matroska included, which `file-type` reports as `video/`. */
function isVideoKind(detected: FileTypeResult): boolean {
  return detected.mime.startsWith("video/");
}

/** Reports whether the detected family is an image, which the video entry point refuses as a kind mismatch. */
function isImageKind(detected: FileTypeResult): boolean {
  return detected.mime.startsWith("image/");
}

/**
 * The deterministic identity of one rendition: the asset identity the caller minted, the purpose, and the
 * caller's optional variant.
 *
 * Nothing random, time-based or counter-based may appear here. Seeded media is produced under `resetSeed()`, and
 * two resets have to produce byte-identical seed content, so the same asset and purpose must always yield the
 * same identity. This value is also never an `operationId`, which names one mutation attempt rather than one
 * rendition.
 */
function renditionIdFor(
  assetId: string,
  purpose: MediaRenditionPurpose,
  variant: string | undefined,
): string {
  const suffix = trimmedOrEmpty(variant);
  return suffix.length === 0 ? `${assetId}:${purpose}` : `${assetId}:${purpose}:${suffix}`;
}

/** States a video profile check in this module's descriptor terms. */
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

/** Trims supplied text, treating nothing supplied as nothing at all. */
function trimmedOrEmpty(value: string | undefined): string {
  return value === undefined ? "" : value.trim();
}

/** Trims optional text, treating absent and whitespace-only alike: a caption of nothing is no caption. */
function trimmedOrAbsent(value: string | undefined): string | undefined {
  const trimmed = trimmedOrEmpty(value);
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Builds a refusal value. */
function refuse(code: MediaRefusalCode, message: string, action?: string): MediaRefusal {
  return action === undefined
    ? { state: "rejected", code, message }
    : { state: "rejected", code, message, action };
}

/** Carries a sibling pipeline's refusal through unchanged, so each profile's reasons have one author. */
function refused(refusal: ImagePreparationRefusal | VideoRefusal): MediaRefusal {
  return refuse(refusal.code, refusal.message, refusal.action);
}
