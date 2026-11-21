/**
 * Video admission and preparation for the media module.
 *
 * This file is the repository's only video inspection and remux path. An upload is admitted by real
 * content, never by a filename or an extension, and the served playback rendition is a tag-free copy
 * of the admitted samples: no re-encode, no external binary and no second probe. Preparation is local
 * processing, and the surface that triggers it labels it as such.
 */
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4InputFormat,
  Mp4OutputFormat,
  Output,
  UnsupportedInputFormatError,
  WebMInputFormat,
  WebMOutputFormat,
  type DiscardedTrack,
  type InputFormat,
  type MetadataTags,
  type Rotation,
} from "mediabunny";

/** Largest accepted upload in bytes; a file of exactly this size is accepted. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/** Longest accepted duration in seconds, taken from the container; exactly this duration is accepted. */
export const VIDEO_MAX_DURATION_S = 180;

/** Widest accepted display width in pixels, measured after rotation. */
export const VIDEO_MAX_WIDTH = 1920;

/** Tallest accepted display height in pixels, measured after rotation. */
export const VIDEO_MAX_HEIGHT = 1080;

/** The admitted container-to-codec pairs; a file outside these pairs is refused. */
export const ADMITTED_VIDEO_PROFILES = [
  { container: "mp4", video: ["avc"], audio: ["aac"] },
  { container: "webm", video: ["vp8", "vp9"], audio: ["vorbis", "opus"] },
] as const;

const [MP4_PROFILE, WEBM_PROFILE] = ADMITTED_VIDEO_PROFILES;

const ADMITTED_BY_CONTAINER = { mp4: MP4_PROFILE, webm: WEBM_PROFILE } as const;

/** One admitted container-to-codec pair. */
export type AdmittedVideoProfile = (typeof ADMITTED_VIDEO_PROFILES)[number];

/** A container this profile admits. */
export type AdmittedContainer = AdmittedVideoProfile["container"];

/** A video codec this profile admits. */
export type AdmittedVideoCodec = AdmittedVideoProfile["video"][number];

/** An audio codec this profile admits. */
export type AdmittedAudioCodec = AdmittedVideoProfile["audio"][number];

/** Every way an upload or a preparation attempt can be refused. */
export type VideoRefusalCode =
  | "not-a-video"
  | "unsupported-container"
  | "unsupported-video-codec"
  | "unsupported-audio-codec"
  | "too-large-bytes"
  | "too-long-duration"
  | "too-large-dimensions"
  | "no-video-track"
  | "undecodable"
  | "tags-residual"
  | "remux-unsupported";

/** A refusal names what failed, says so in words, and offers the next step when there is one. */
export type VideoRefusal = {
  readonly ok: false;
  readonly code: VideoRefusalCode;
  readonly message: string;
  readonly action?: string;
};

/** The admitted profile a file satisfies, with display dimensions already adjusted for rotation. */
export type VideoProfileCheck = {
  readonly container: AdmittedContainer;
  readonly codec: AdmittedVideoCodec;
  readonly durationS: number;
  readonly width: number;
  readonly height: number;
};

/** The admission verdict for one upload. */
export type VideoInspectionResult =
  | { readonly ok: true; readonly profileCheck: VideoProfileCheck; readonly rotation: Rotation }
  | VideoRefusal;

/** The result of checking the served rendition for leftover descriptive metadata. */
export type VideoTagVerification = {
  readonly checked: true;
  readonly residualTags: readonly string[];
};

/** The playback rendition of an admitted upload, copied sample-for-sample and free of tags. */
export type VideoPreparationResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly mimeType: string;
      readonly tagVerification: VideoTagVerification;
      readonly profileCheck: VideoProfileCheck;
    }
  | VideoRefusal;

/** Alias retained for the spelling the release plan uses for this result type. */
export type VideoPreperationResult = VideoPreparationResult;

/** The bytes of one candidate upload. */
export type VideoInput = { readonly bytes: Uint8Array };

/** Everything admission established about a file, kept for the remux and its verification. */
type AdmittedVideoDetail = {
  readonly container: AdmittedContainer;
  readonly videoCodec: AdmittedVideoCodec;
  readonly audioCodecs: readonly AdmittedAudioCodec[];
  readonly durationS: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: Rotation;
};

type Admission = { readonly ok: true; readonly detail: AdmittedVideoDetail } | VideoRefusal;

/**
 * Descriptive metadata fields that must not survive into a served rendition.
 *
 * Mediabunny's own emptiness predicate is not part of its public surface, so the field list it uses is
 * stated once here instead of being reimplemented at each call site.
 *
 * `creationTime` is deliberately absent: a container timestamp is not descriptive metadata, so per the
 * documented limitation a surviving MP4 timestamp alone never drops the asset.
 */
const DESCRIPTIVE_TAG_KEYS = [
  "title",
  "description",
  "artist",
  "album",
  "albumArtist",
  "trackNumber",
  "tracksTotal",
  "discNumber",
  "discsTotal",
  "beatsPerMinute",
  "genre",
  "date",
  "lyrics",
  "comment",
  "images",
] as const;

/** Raw container keys that carry a timestamp rather than descriptive content. */
const CONTAINER_TIMESTAMP_RAW_KEY = /^(?:creationtime|modificationtime|dateutc|timestamp)$/i;

function refuse(code: VideoRefusalCode, message: string, action?: string): VideoRefusal {
  return action === undefined ? { ok: false, code, message } : { ok: false, code, message, action };
}

function describesBytes(byteLength: number): string {
  const mib = byteLength / (1024 * 1024);
  return `${byteLength.toLocaleString("en-US")} bytes (${mib.toFixed(1)} MiB)`;
}

function admittedVideoCodecs(container: AdmittedContainer): string {
  return ADMITTED_BY_CONTAINER[container].video.join(", ");
}

function admittedAudioCodecs(container: AdmittedContainer): string {
  return ADMITTED_BY_CONTAINER[container].audio.join(", ");
}

function admitsVideoCodec(
  container: AdmittedContainer,
  codec: string,
): codec is AdmittedVideoCodec {
  return ADMITTED_BY_CONTAINER[container].video.some((admitted) => admitted === codec);
}

function admitsAudioCodec(
  container: AdmittedContainer,
  codec: string,
): codec is AdmittedAudioCodec {
  return ADMITTED_BY_CONTAINER[container].audio.some((admitted) => admitted === codec);
}

/** Maps a detected input format to an admitted container, or to `null` when the profile excludes it. */
function containerOf(format: InputFormat): AdmittedContainer | null {
  // WebM extends Matroska, so the WebM check has to come first.
  if (format instanceof WebMInputFormat) return "webm";
  if (format instanceof Mp4InputFormat) return "mp4";
  return null;
}

function profileCheckOf(detail: AdmittedVideoDetail): VideoProfileCheck {
  return {
    container: detail.container,
    codec: detail.videoCodec,
    durationS: detail.durationS,
    width: detail.width,
    height: detail.height,
  };
}

/**
 * Names every descriptive tag the file still carries, including unknown raw keys.
 * An empty result is the only clean result; a container timestamp alone is not reported.
 */
function residualDescriptiveTags(tags: MetadataTags): string[] {
  const finding: string[] = [];
  for (const key of DESCRIPTIVE_TAG_KEYS) {
    if (tags[key] !== undefined) finding.push(key);
  }
  const raw = tags.raw;
  if (raw !== undefined) {
    for (const key of Object.keys(raw)) {
      if (!CONTAINER_TIMESTAMP_RAW_KEY.test(key)) finding.push(`raw:${key}`);
    }
  }
  return finding.sort();
}

/**
 * Inspects one candidate upload and reports the admitted profile it satisfies, or why it is refused.
 * Read-only: it prepares nothing and changes nothing.
 */
export async function inspectVideo(input: VideoInput): Promise<VideoInspectionResult> {
  const admission = await admit(input.bytes);
  if (!admission.ok) return admission;
  return {
    ok: true,
    profileCheck: profileCheckOf(admission.detail),
    rotation: admission.detail.rotation,
  };
}

/**
 * Copies an admitted upload into a tag-free playback rendition without re-encoding it, verifies the
 * result carries neither tags nor a re-encoded codec, and returns it with that verification.
 */
export async function preparePlaybackRendition(input: VideoInput): Promise<VideoPreparationResult> {
  const admission = await admit(input.bytes);
  if (!admission.ok) return admission;
  const { detail } = admission;

  let rendition: { readonly bytes: Uint8Array; readonly mimeType: string };
  try {
    rendition = await copyRendition(input.bytes, detail);
  } catch (error) {
    return refuse(
      "remux-unsupported",
      `The video could not be copied into a clean rendition without re-encoding it: ${describeError(error)}.`,
      "Export the video again with its original codecs and upload it.",
    );
  }

  const rejection = await verifyRendition(rendition.bytes, detail);
  if (rejection !== null) return rejection;

  return {
    ok: true,
    bytes: rendition.bytes,
    mimeType: rendition.mimeType,
    tagVerification: { checked: true, residualTags: [] },
    profileCheck: profileCheckOf(detail),
  };
}

async function admit(bytes: Uint8Array): Promise<Admission> {
  const gate = checkByteLimit(bytes);
  if (gate !== null) return gate;

  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  try {
    let format: InputFormat;
    try {
      format = await input.getFormat();
    } catch (error) {
      if (error instanceof UnsupportedInputFormatError) {
        return refuse(
          "not-a-video",
          "The file content is not a video container this application recognises.",
          "Choose an MP4 (.mp4) or WebM (.webm) video file.",
        );
      }
      return refuse(
        "undecodable",
        "The file could not be read as media.",
        "Export the video again and upload the new file.",
      );
    }

    const container = containerOf(format);
    if (container === null) {
      return refuse(
        "unsupported-container",
        `The file is in the ${format.name} container, which this profile does not admit.`,
        `Upload an MP4 (${admittedVideoCodecs("mp4")} video with ${admittedAudioCodecs("mp4")} audio) or a WebM (${admittedVideoCodecs("webm")} video with ${admittedAudioCodecs("webm")} audio).`,
      );
    }

    const duration = await readDuration(input);
    if (!duration.ok) return duration.refusal;
    if (duration.durationS > VIDEO_MAX_DURATION_S) {
      return refuse(
        "too-long-duration",
        `The video is ${duration.durationS.toFixed(1)} seconds long; the limit is ${VIDEO_MAX_DURATION_S} seconds.`,
        `Trim the video to ${VIDEO_MAX_DURATION_S} seconds or less and upload it again.`,
      );
    }

    const videoTracks = await input.getVideoTracks();
    if (videoTracks.length === 0) {
      return refuse(
        "no-video-track",
        "The file carries no video track.",
        "Upload a video file rather than an audio-only or data file.",
      );
    }
    if (videoTracks.length > 1) {
      return refuse(
        "unsupported-container",
        `The file carries ${videoTracks.length} video tracks; this profile admits exactly one primary video track.`,
        "Export a single-video-track file and upload it again.",
      );
    }
    const videoTrack = videoTracks.at(0);
    if (videoTrack === undefined) {
      return refuse("no-video-track", "The file carries no video track.");
    }

    const rawVideoCodec = await videoTrack.getCodec();
    if (rawVideoCodec === null) {
      return refuse(
        "unsupported-video-codec",
        "The video stream uses a codec this application cannot identify.",
        `Export the video as ${admittedVideoCodecs(container)} and upload it again.`,
      );
    }
    if (!admitsVideoCodec(container, rawVideoCodec)) {
      return refuse(
        "unsupported-video-codec",
        `The video stream uses ${rawVideoCodec}, which the ${container} profile does not admit; it admits ${admittedVideoCodecs(container)}.`,
        `Export the video as ${admittedVideoCodecs(container)} and upload it again.`,
      );
    }

    const audioTracks = await input.getAudioTracks();
    if (audioTracks.length > 1) {
      // The rendition carries the primary audio track only, and dropping an alternate language
      // without saying so would change what the worker published.
      return refuse(
        "unsupported-container",
        `The file carries ${audioTracks.length} audio tracks; this profile admits at most one audio track.`,
        "Export a single-audio-track file and upload it again.",
      );
    }
    const audioCodecs: AdmittedAudioCodec[] = [];
    for (const audioTrack of audioTracks) {
      const rawAudioCodec = await audioTrack.getCodec();
      if (rawAudioCodec === null) {
        return refuse(
          "unsupported-audio-codec",
          "The audio stream uses a codec this application cannot identify.",
          `Export the audio as ${admittedAudioCodecs(container)} and upload the video again.`,
        );
      }
      if (!admitsAudioCodec(container, rawAudioCodec)) {
        return refuse(
          "unsupported-audio-codec",
          `The audio stream uses ${rawAudioCodec}, which the ${container} profile does not admit; it admits ${admittedAudioCodecs(container)}.`,
          `Export the audio as ${admittedAudioCodecs(container)} and upload the video again.`,
        );
      }
      audioCodecs.push(rawAudioCodec);
    }

    // displayWidth/displayHeight already apply the track's pixel aspect ratio and rotation, so a
    // 1920x1080 clip stamped with rotation 90 is judged as the 1080x1920 portrait a player shows and
    // is refused by the 1920x1080 limit, while the same clip stored landscape is admitted.
    const rotation = await videoTrack.getRotation();
    const width = videoTrack.displayWidth;
    const height = videoTrack.displayHeight;
    if (width > VIDEO_MAX_WIDTH || height > VIDEO_MAX_HEIGHT) {
      return refuse(
        "too-large-dimensions",
        `The video displays at ${width}x${height} pixels; the limit is ${VIDEO_MAX_WIDTH}x${VIDEO_MAX_HEIGHT}.`,
        `Export the video at ${VIDEO_MAX_WIDTH}x${VIDEO_MAX_HEIGHT} or smaller and upload it again.`,
      );
    }

    return {
      ok: true,
      detail: {
        container,
        videoCodec: rawVideoCodec,
        audioCodecs,
        durationS: duration.durationS,
        width,
        height,
        rotation,
      },
    };
  } finally {
    input.dispose();
  }
}

function checkByteLimit(bytes: Uint8Array): VideoRefusal | null {
  if (bytes.byteLength === 0) {
    return refuse(
      "not-a-video",
      "The file is empty, so it holds no video.",
      "Choose an MP4 (.mp4) or WebM (.webm) video file.",
    );
  }
  if (bytes.byteLength > VIDEO_MAX_BYTES) {
    return refuse(
      "too-large-bytes",
      `The file is ${describesBytes(bytes.byteLength)}; the limit is ${describesBytes(VIDEO_MAX_BYTES)}.`,
      `Upload a video of ${describesBytes(VIDEO_MAX_BYTES)} or less.`,
    );
  }
  return null;
}

async function readDuration(
  input: Input,
): Promise<
  | { readonly ok: true; readonly durationS: number }
  | { readonly ok: false; readonly refusal: VideoRefusal }
> {
  let durationS: number;
  try {
    durationS = await input.computeDuration();
  } catch {
    return {
      ok: false,
      refusal: refuse(
        "undecodable",
        "The duration could not be read from the file, so the video is incomplete or unreadable.",
        "Export the video again and upload the new file.",
      ),
    };
  }
  if (!Number.isFinite(durationS) || durationS <= 0) {
    return {
      ok: false,
      refusal: refuse(
        "undecodable",
        "The file reports no readable duration, so it holds no media this application can admit.",
        "Export the video again and upload the new file.",
      ),
    };
  }
  return { ok: true, durationS };
}

async function copyRendition(
  bytes: Uint8Array,
  detail: AdmittedVideoDetail,
): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  try {
    const target = new BufferTarget();
    const format = detail.container === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
    const output = new Output({ format, target });
    const conversion = await Conversion.init({
      input,
      output,
      // 'primary' keeps the admitted video and audio tracks and leaves out caption, subtitle and data
      // tracks, which are supplied as their own renditions.
      tracks: "primary",
      // Forced copy: encoded samples are carried over untouched, so nothing is re-encoded. A track that
      // cannot be copied is discarded rather than transcoded, which the verification below rejects.
      copy: { mode: "forced" },
      // An empty descriptive tag set. creationTime is explicitly null because leaving it undefined makes
      // the muxers write the wall clock, which is neither deterministic nor free of identifying data.
      tags: { creationTime: null },
      showWarnings: false,
    });
    if (!conversion.isValid) {
      throw new Error(
        `the admitted tracks cannot be carried over (${describeDiscards(conversion.discardedTracks)})`,
      );
    }
    await conversion.execute();
    if (target.buffer === null) {
      throw new Error("the copy produced no bytes");
    }
    return { bytes: new Uint8Array(target.buffer), mimeType: format.mimeType };
  } finally {
    input.dispose();
  }
}

/** Re-reads the served rendition and rejects it unless it is the admitted video, untouched and tag-free. */
async function verifyRendition(
  bytes: Uint8Array,
  detail: AdmittedVideoDetail,
): Promise<VideoRefusal | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  try {
    const container = containerOf(await input.getFormat());
    if (container !== detail.container) {
      return refuse(
        "remux-unsupported",
        "The prepared rendition did not come out in the admitted container.",
        "Export the video again and upload it.",
      );
    }

    const videoTracks = await input.getVideoTracks();
    const videoTrack = videoTracks.at(0);
    if (videoTracks.length !== 1 || videoTrack === undefined) {
      return refuse(
        "remux-unsupported",
        "The prepared rendition does not carry exactly one video track.",
        "Export the video again and upload it.",
      );
    }
    const videoCodec = await videoTrack.getCodec();
    if (videoCodec !== detail.videoCodec) {
      return refuse(
        "remux-unsupported",
        `The prepared rendition carries ${videoCodec ?? "an unknown codec"} video where the source carried ${detail.videoCodec}, so it was re-encoded and is not served.`,
        "Export the video again with its original codecs and upload it.",
      );
    }

    const audioTracks = await input.getAudioTracks();
    const audioCodec = await audioTracks.at(0)?.getCodec();
    if (audioTracks.length > 1 || (audioCodec ?? null) !== (detail.audioCodecs.at(0) ?? null)) {
      return refuse(
        "remux-unsupported",
        "The prepared rendition does not carry its admitted audio unchanged.",
        "Export the video again with its original codecs and upload it.",
      );
    }

    const residualTags = residualDescriptiveTags(await input.getMetadataTags());
    if (residualTags.length > 0) {
      return refuse(
        "tags-residual",
        `The prepared rendition still carries descriptive metadata (${residualTags.join(", ")}), so it was discarded rather than served.`,
        "Strip the metadata from the video and upload it again.",
      );
    }
    return null;
  } catch {
    return refuse(
      "undecodable",
      "The prepared rendition could not be re-read, so it was discarded rather than served.",
      "Export the video again and upload it.",
    );
  } finally {
    input.dispose();
  }
}

function describeDiscards(discarded: readonly DiscardedTrack[]): string {
  const reasons = [...new Set(discarded.map((track) => track.reason))];
  return reasons.length === 0 ? "no track could be copied" : reasons.join(", ");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}
