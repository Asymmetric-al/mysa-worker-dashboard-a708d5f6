import { ALL_FORMATS, BufferSource, BufferTarget, Conversion, Input, Mp4InputFormat, Mp4OutputFormat, Output, UnsupportedInputFormatError, WebMInputFormat, WebMOutputFormat, type DiscardedTrack, type InputFormat, type MetadataTags, type Rotation } from "mediabunny";
import { countFormatOf } from "@/lib/count-format";
import { ADMITTED_VIDEO_PROFILES, VIDEO_MAX_BYTES, VIDEO_MAX_DURATION_S, VIDEO_MAX_HEIGHT, VIDEO_MAX_WIDTH, type AdmittedAudioCodec, type AdmittedContainer, type AdmittedVideoCodec, type AdmittedVideoProfile } from "./profile";
export { ADMITTED_VIDEO_PROFILES, VIDEO_MAX_BYTES, VIDEO_MAX_DURATION_S, VIDEO_MAX_HEIGHT, VIDEO_MAX_WIDTH };
export type { AdmittedAudioCodec, AdmittedContainer, AdmittedVideoCodec, AdmittedVideoProfile };
const [MP4_PROFILE, WEBM_PROFILE] = ADMITTED_VIDEO_PROFILES;
const ADMITTED_BY_CONTAINER = { mp4: MP4_PROFILE, webm: WEBM_PROFILE } as const;
export type VideoRefusalCode = "not-a-video" | "unsupported-container" | "unsupported-video-codec" | "unsupported-audio-codec" | "too-large-bytes" | "too-long-duration" | "too-large-dimensions" | "no-video-track" | "undecodable" | "tags-residual" | "remux-unsupported";
export type VideoRefusal = { readonly ok: false; readonly code: VideoRefusalCode; readonly message: string; readonly action?: string };
export type VideoProfileCheck = { readonly container: AdmittedContainer; readonly codec: AdmittedVideoCodec; readonly durationS: number; readonly width: number; readonly height: number };
export type VideoInspectionResult = { readonly ok: true; readonly profileCheck: VideoProfileCheck; readonly rotation: Rotation } | VideoRefusal;
export type VideoTagVerification = { readonly checked: true; readonly residualTags: readonly string[] };
export type VideoPreparationResult = { readonly ok: true; readonly bytes: Uint8Array; readonly mimeType: string; readonly tagVerification: VideoTagVerification; readonly profileCheck: VideoProfileCheck } | VideoRefusal;
export type VideoInput = { readonly bytes: Uint8Array };
type AdmittedVideoDetail = { readonly container: AdmittedContainer; readonly videoCodec: AdmittedVideoCodec; readonly audioCodecs: readonly AdmittedAudioCodec[]; readonly durationS: number; readonly width: number; readonly height: number; readonly rotation: Rotation };
type Admission = { readonly ok: true; readonly detail: AdmittedVideoDetail } | VideoRefusal;
const DESCRIPTIVE_TAG_KEYS = ["title", "description", "artist", "album", "albumArtist", "trackNumber", "tracksTotal", "discNumber", "discsTotal", "beatsPerMinute", "genre", "date", "lyrics", "comment", "images"] as const;
const CONTAINER_TIMESTAMP_RAW_KEY = /^(?:creationtime|modificationtime|dateutc|timestamp)$/i;
const refuse = (code: VideoRefusalCode, message: string, action?: string): VideoRefusal => (action === undefined ? { ok: false, code, message } : { ok: false, code, message, action });
const describesBytes = (byteLength: number): string => `${countFormatOf().format(byteLength)} bytes (${(byteLength / (1024 * 1024)).toFixed(1)} MiB)`; // A byte count is a whole number, so it groups through the one whole-number formatter in the application's default interface locale rather than a second hard-coded tag.
function asAlternatives(codecs: readonly string[]): string {
  const last = codecs.at(-1);
  return last === undefined ? "" : codecs.length === 1 ? last : `${codecs.slice(0, -1).join(", ")} or ${last}`;
}
const admittedVideoCodecs = (container: AdmittedContainer): string => asAlternatives(ADMITTED_BY_CONTAINER[container].video);
const admittedAudioCodecs = (container: AdmittedContainer): string => asAlternatives(ADMITTED_BY_CONTAINER[container].audio);
const admitsVideoCodec = (container: AdmittedContainer, codec: string): codec is AdmittedVideoCodec => ADMITTED_BY_CONTAINER[container].video.some((admitted) => admitted === codec);
const admitsAudioCodec = (container: AdmittedContainer, codec: string): codec is AdmittedAudioCodec => ADMITTED_BY_CONTAINER[container].audio.some((admitted) => admitted === codec);
const containerOf = (format: InputFormat): AdmittedContainer | null => (format instanceof WebMInputFormat ? "webm" : format instanceof Mp4InputFormat ? "mp4" : null);
const profileCheckOf = (detail: AdmittedVideoDetail): VideoProfileCheck => ({ container: detail.container, codec: detail.videoCodec, durationS: detail.durationS, width: detail.width, height: detail.height });
function residualDescriptiveTags(tags: MetadataTags): string[] {
  const finding: string[] = DESCRIPTIVE_TAG_KEYS.filter((key) => tags[key] !== undefined);
  const raw = tags.raw;
  if (raw !== undefined) for (const key of Object.keys(raw)) if (!CONTAINER_TIMESTAMP_RAW_KEY.test(key)) finding.push(`raw:${key}`);
  return finding.sort();
}
export async function inspectVideo(input: VideoInput): Promise<VideoInspectionResult> {
  const admission = await admit(input.bytes);
  return !admission.ok ? admission : { ok: true, profileCheck: profileCheckOf(admission.detail), rotation: admission.detail.rotation };
}
/** Copies an admitted upload into a tag-free playback rendition without re-encoding it, verifies the result carries neither tags nor a re-encoded codec, and returns it with that verification. */
export async function preparePlaybackRendition(input: VideoInput): Promise<VideoPreparationResult> {
  const admission = await admit(input.bytes);
  if (!admission.ok) return admission;
  const { detail } = admission;
  let rendition: { readonly bytes: Uint8Array; readonly mimeType: string };
  try {
    rendition = await copyRendition(input.bytes, detail);
  } catch (error) {
    return refuse("remux-unsupported", `The video could not be copied into a clean rendition without re-encoding it: ${describeError(error)}.`, "Export the video again with its original codecs and upload it.");
  }
  const rejection = await verifyRendition(rendition.bytes, detail);
  return rejection !== null ? rejection : { ok: true, bytes: rendition.bytes, mimeType: rendition.mimeType, tagVerification: { checked: true, residualTags: [] }, profileCheck: profileCheckOf(detail) };
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
      if (error instanceof UnsupportedInputFormatError) return refuse("not-a-video", "The file content is not a video container this application recognises.", "Choose an MP4 (.mp4) or WebM (.webm) video file.");
      return refuse("undecodable", "The file could not be read as media.", "Export the video again and upload the new file.");
    }
    const container = containerOf(format);
    if (container === null)
      return refuse("unsupported-container", `The file is in the ${format.name} container, which this profile does not admit.`, `Upload an MP4 (${admittedVideoCodecs("mp4")} video with ${admittedAudioCodecs("mp4")} audio) or a WebM (${admittedVideoCodecs("webm")} video with ${admittedAudioCodecs("webm")} audio).`);
    const duration = await readDuration(input);
    if (!duration.ok) return duration.refusal;
    if (duration.durationS > VIDEO_MAX_DURATION_S) return refuse("too-long-duration", `The video is ${duration.durationS.toFixed(1)} seconds long; the limit is ${VIDEO_MAX_DURATION_S} seconds.`, `Trim the video to ${VIDEO_MAX_DURATION_S} seconds or less and upload it again.`);
    const videoTracks = await input.getVideoTracks();
    if (videoTracks.length === 0) return refuse("no-video-track", "The file carries no video track.", "Upload a video file rather than an audio-only or data file.");
    if (videoTracks.length > 1) return refuse("unsupported-container", `The file carries ${videoTracks.length} video tracks; this profile admits exactly one primary video track.`, "Export a single-video-track file and upload it again.");
    const videoTrack = videoTracks.at(0);
    if (videoTrack === undefined) return refuse("no-video-track", "The file carries no video track.");
    const rawVideoCodec = await videoTrack.getCodec();
    if (rawVideoCodec === null) return refuse("unsupported-video-codec", "The video stream uses a codec this application cannot identify.", `Export the video as ${admittedVideoCodecs(container)} and upload it again.`);
    if (!admitsVideoCodec(container, rawVideoCodec)) return refuse("unsupported-video-codec", `The video stream uses ${rawVideoCodec}, which the ${container} profile does not admit; it admits ${admittedVideoCodecs(container)}.`, `Export the video as ${admittedVideoCodecs(container)} and upload it again.`);
    const audioTracks = await input.getAudioTracks();
    if (audioTracks.length > 1) return refuse("unsupported-container", `The file carries ${audioTracks.length} audio tracks; this profile admits at most one audio track.`, "Export a single-audio-track file and upload it again.");
    const audioCodecs: AdmittedAudioCodec[] = [];
    for (const audioTrack of audioTracks) {
      const rawAudioCodec = await audioTrack.getCodec();
      if (rawAudioCodec === null) return refuse("unsupported-audio-codec", "The audio stream uses a codec this application cannot identify.", `Export the audio as ${admittedAudioCodecs(container)} and upload the video again.`);
      if (!admitsAudioCodec(container, rawAudioCodec)) return refuse("unsupported-audio-codec", `The audio stream uses ${rawAudioCodec}, which the ${container} profile does not admit; it admits ${admittedAudioCodecs(container)}.`, `Export the audio as ${admittedAudioCodecs(container)} and upload the video again.`);
      audioCodecs.push(rawAudioCodec);
    }
    const rotation = await videoTrack.getRotation();
    const width = videoTrack.displayWidth;
    const height = videoTrack.displayHeight;
    if (width > VIDEO_MAX_WIDTH || height > VIDEO_MAX_HEIGHT) return refuse("too-large-dimensions", `The video displays at ${width}x${height} pixels; the limit is ${VIDEO_MAX_WIDTH}x${VIDEO_MAX_HEIGHT}.`, `Export the video at ${VIDEO_MAX_WIDTH}x${VIDEO_MAX_HEIGHT} or smaller and upload it again.`);
    return { ok: true, detail: { container, videoCodec: rawVideoCodec, audioCodecs, durationS: duration.durationS, width, height, rotation } };
  } finally {
    input.dispose();
  }
}
function checkByteLimit(bytes: Uint8Array): VideoRefusal | null {
  if (bytes.byteLength === 0) return refuse("not-a-video", "The file is empty, so it holds no video.", "Choose an MP4 (.mp4) or WebM (.webm) video file.");
  return bytes.byteLength > VIDEO_MAX_BYTES ? refuse("too-large-bytes", `The file is ${describesBytes(bytes.byteLength)}; the limit is ${describesBytes(VIDEO_MAX_BYTES)}.`, `Upload a video of ${describesBytes(VIDEO_MAX_BYTES)} or less.`) : null;
}
async function readDuration(input: Input): Promise<{ readonly ok: true; readonly durationS: number } | { readonly ok: false; readonly refusal: VideoRefusal }> {
  let durationS: number;
  try {
    durationS = await input.computeDuration();
  } catch {
    return { ok: false, refusal: refuse("undecodable", "The duration could not be read from the file, so the video is incomplete or unreadable.", "Export the video again and upload the new file.") };
  }
  return !Number.isFinite(durationS) || durationS <= 0 ? { ok: false, refusal: refuse("undecodable", "The file reports no readable duration, so it holds no media this application can admit.", "Export the video again and upload the new file.") } : { ok: true, durationS };
}
async function copyRendition(bytes: Uint8Array, detail: AdmittedVideoDetail): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  try {
    const target = new BufferTarget();
    const format = detail.container === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
    const output = new Output({ format, target });
    const conversion = await Conversion.init({ input, output, tracks: "primary", copy: { mode: "forced" }, tags: { creationTime: null }, showWarnings: false });
    if (!conversion.isValid) throw new Error(`the admitted tracks cannot be carried over (${describeDiscards(conversion.discardedTracks)})`);
    await conversion.execute();
    if (target.buffer === null) throw new Error("the copy produced no bytes");
    return { bytes: new Uint8Array(target.buffer), mimeType: format.mimeType };
  } finally {
    input.dispose();
  }
}
async function verifyRendition(bytes: Uint8Array, detail: AdmittedVideoDetail): Promise<VideoRefusal | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  try {
    const container = containerOf(await input.getFormat());
    if (container !== detail.container) return refuse("remux-unsupported", "The prepared rendition did not come out in the admitted container.", "Export the video again and upload it.");
    const videoTracks = await input.getVideoTracks();
    const videoTrack = videoTracks.at(0);
    if (videoTracks.length !== 1 || videoTrack === undefined) return refuse("remux-unsupported", "The prepared rendition does not carry exactly one video track.", "Export the video again and upload it.");
    const videoCodec = await videoTrack.getCodec();
    if (videoCodec !== detail.videoCodec) return refuse("remux-unsupported", `The prepared rendition carries ${videoCodec ?? "an unknown codec"} video where the source carried ${detail.videoCodec}, so it was re-encoded and is not served.`, "Export the video again with its original codecs and upload it.");
    const audioTracks = await input.getAudioTracks();
    const audioCodec = await audioTracks.at(0)?.getCodec();
    if (audioTracks.length > 1 || (audioCodec ?? null) !== (detail.audioCodecs.at(0) ?? null)) return refuse("remux-unsupported", "The prepared rendition does not carry its admitted audio unchanged.", "Export the video again with its original codecs and upload it.");
    const residualTags = residualDescriptiveTags(await input.getMetadataTags());
    return residualTags.length > 0 ? refuse("tags-residual", `The prepared rendition still carries descriptive metadata (${residualTags.join(", ")}), so it was discarded rather than served.`, "Strip the metadata from the video and upload it again.") : null;
  } catch {
    return refuse("undecodable", "The prepared rendition could not be re-read, so it was discarded rather than served.", "Export the video again and upload it.");
  } finally {
    input.dispose();
  }
}
function describeDiscards(discarded: readonly DiscardedTrack[]): string {
  const reasons = [...new Set(discarded.map((track) => track.reason))];
  return reasons.length === 0 ? "no track could be copied" : reasons.join(", ");
}
const describeError = (error: unknown): string => (error instanceof Error ? error.message : "unknown failure");
