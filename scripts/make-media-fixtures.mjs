/**
 * Authors and verifies the five committed media fixtures the video, caption, poster and rejection work
 * depends on (AAP 0.9.1, the root `fixtures:media` script, 0.11.1; assumption A6).
 *
 * This is local authoring of committed fixtures — not production transcoding or production scanning.
 * It writes at most five files, all under `apps/dashboard/public/fixtures/media`, and it never reaches
 * the network: a licensed clip is supplied by the operator (already in place, or named by `--from`), and
 * an encoder runs only when `--encode` asks for it. Nothing in the application reads this script, so no
 * runtime path depends on an encoder being installed.
 *
 * Modes
 *   --check      (default) verify what is present, print every digest and the provenance block, write
 *                nothing.
 *   --write      author whatever is missing; never replace an existing artefact.
 *   --force      with `--write`: replace an artefact this script authors.
 *   --encode     Route 1 of assumption A6: encode both clips with a local encoder; needs
 *                `--write --force`.
 *   --from <dir> Route 2 of assumption A6: copy the two supplied clips out of another directory.
 *
 * Exit codes
 *   0  all five artefacts are present and every assertion holds
 *   1  an artefact is present but fails an assertion, or a derivation could not be performed safely
 *   2  the command line is unusable
 *   3  something is missing: an artefact in `--check`, a clip this script cannot produce, or the image
 *      library needed to author the poster
 *
 * Run as `bun scripts/make-media-fixtures.mjs`, or under Node 26 — it imports only `node:` built-ins and
 * the image library, so either runtime behaves identically.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Repository root, derived from this file's own location so the script works from any directory. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The one directory this script writes into. */
const DEST = path.join(ROOT, "apps", "dashboard", "public", "fixtures", "media");

/** The application's directory, whose installed packages include the image library it declares. */
const APPS = path.join(ROOT, "apps");

const MP4 = "sample-h264.mp4";
const WEBM = "sample-vp9.webm";
const VTT = "sample.vtt";
const POSTER = "poster.jpg";
const MKV = "sample-unsupported.mkv";

/** The five fixtures in a fixed, sorted order, so two runs print byte-identical output. */
const FIXTURES = [POSTER, MP4, MKV, WEBM, VTT];

/** The two clips the operator supplies (Route 2) or the encoder produces (Route 1). */
const CLIPS = [MP4, WEBM];

/** Assumption A6 keeps each committed clip small so the repository stays light. */
const MAX_CLIP_BYTES = 2 * 1024 * 1024;

const POSTER_WIDTH = 960;
const POSTER_HEIGHT = 540;
const POSTER_QUALITY = 80;

/** Zinc 100 as the surface and Zinc 600 as the single contrasting band — theme tokens, no artwork. */
const POSTER_SURFACE = { r: 0xf4, g: 0xf4, b: 0xf5 };
const POSTER_BAND = { r: 0x52, g: 0x52, b: 0x5b };
const POSTER_BAND_TOP = 216;
const POSTER_BAND_HEIGHT = 108;

/**
 * The caption track is also the transcript, so each line describes what the clip shows and the two
 * together read as consecutive sentences once the cues are concatenated.
 */
const VTT_LINES = [
  "A single flower opens against a dark background.",
  "Light shifts across its petals as the bloom widens.",
];

/**
 * Cue boundaries inside a clip of `limitSeconds`: the midpoint and the last half second that still lies
 * inside the clip. The committed 5.055 s pair therefore reads 00:00:02.500 and 00:00:05.000, while a
 * shorter encoded clip gets boundaries that fit it instead of cues running past its end.
 */
function captionBoundaries(limitSeconds) {
  const halfSecond = (value) => Math.floor(value * 2) / 2;
  const middle = Math.max(0.5, halfSecond(limitSeconds / 2));
  const last = Math.max(middle + 0.5, halfSecond(limitSeconds));
  return { middle, last };
}

/** The caption track for a clip of `limitSeconds`, as deterministic UTF-8 text with LF endings. */
function vttContent(limitSeconds) {
  const { middle, last } = captionBoundaries(limitSeconds);
  const timings = [
    `00:00:00.000 --> ${formatCueTime(middle)}`,
    `${formatCueTime(middle)} --> ${formatCueTime(last)}`,
  ];
  return `WEBVTT\n\n${timings.map((timing, index) => `${timing}\n${VTT_LINES[index]}`).join("\n\n")}\n`;
}

/** The shortest duration the present clips report, which is the window the captions must fit inside. */
function captionLimitFromClips() {
  const durations = [];
  for (const name of CLIPS) {
    if (!fs.existsSync(fixturePath(name))) continue;
    const { durationS } = probeClip(fs.readFileSync(fixturePath(name)));
    if (typeof durationS === "number") durations.push(durationS);
  }
  if (durations.length === 0) {
    throw new FixtureError(
      EXIT.failed,
      `neither clip reports a duration in its container header, so ${VTT} cannot be bounded to the clip it captions`,
    );
  }
  return Math.min(...durations);
}

/** ISO base media file format: the box types descended into while looking for `mvhd` and `tkhd`. */
const MP4_CONTAINER_BOXES = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

/** EBML element ids this script reads. Values are the ids themselves, not offsets into a layout table. */
const EBML_HEADER = 0x1a45dfa3;
const EBML_DOC_TYPE = 0x4282;
const EBML_SEGMENT = 0x18538067;
const EBML_INFO = 0x1549a966;
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_DURATION = 0x4489;
const EBML_TRACKS = 0x1654ae6b;
const EBML_TRACK_ENTRY = 0xae;
const EBML_VIDEO = 0xe0;
const EBML_PIXEL_WIDTH = 0xb0;
const EBML_PIXEL_HEIGHT = 0xba;

const WEBM_DOC_TYPE = "webm";
const MATROSKA_DOC_TYPE = "matroska";

/** Default Matroska/WebM timecode scale: one millisecond, so duration ticks × scale / 1e9 is seconds. */
const DEFAULT_TIMECODE_SCALE = 1000000;

const EXIT = { ok: 0, failed: 1, usage: 2, missing: 3 };

/** The usage message a bad command line earns: the flag set, then the reason this run cannot proceed. */
const USAGE_HEAD =
  "usage: bun scripts/make-media-fixtures.mjs [--check | --write [--force] [--from <dir>]] [--encode]";

function usageText(reason) {
  return `${USAGE_HEAD}\n       ${reason}`;
}

/*
 * The provenance entries this script generates for itself, held once because a `--write` run that has just
 * authored one of these fixtures and the digest table below both report the same record for it.
 */

/** The poster: generated here with the image library, so it carries no third-party content. */
const GENERATED_POSTER_RECORD = {
  route:
    "Generated by this script with sharp: a flat theme surface with one contrasting band, no text, no logo and no illustration",
  source: "None — generated, not a licensed work",
  licence: "Not applicable (generated)",
};

/** The caption track: written here from this script's own text, so it carries no third-party content. */
const GENERATED_VTT_RECORD = {
  route: "Generated by this script: hand-authored WebVTT, identical bytes on every run",
  source: "None — generated, not a licensed work",
  licence: "Not applicable (generated)",
};

/**
 * The rejection case is the WebM with its DocType rewritten, so its route and source are the derivation and
 * its licence is whatever the source clip's own record states: the derivation adds no third-party content, and
 * it cannot claim a licence for the clip it derives from that the clip itself does not have.
 */
const DERIVED_MKV = { derivedFrom: WEBM };

/** The derived record for a source clip whose record is `webmRecord`, or `null` when that clip has none. */
function derivedMkvRecord(webmRecord) {
  if (webmRecord === null) return null;
  return {
    route: `Derived by this script from \`${WEBM}\`: the EBML DocType is rewritten from \`${WEBM_DOC_TYPE}\` to \`${MATROSKA_DOC_TYPE}\` and the EBML header size grows by four bytes, with every other byte identical`,
    source: `\`${WEBM}\` in this directory`,
    licence: `${webmRecord.licence} — inherited from \`${WEBM}\`; the derivation adds no third-party content of its own`,
  };
}

/**
 * The provenance recorded for each committed fixture, keyed by the SHA-256 of the exact bytes it was
 * established for. A record is a fact about those bytes and nothing else: a fixture replaced by other content
 * lands on a digest no entry holds, and the run reports that openly instead of letting the new bytes inherit a
 * route and a licence they may not have. `docs/architecture.md` is the delivered record; this table is what
 * the provenance block below prints for a digest it recognises.
 */
const RECORDED_FIXTURE_SOURCES = new Map([
  ["4857025889c3471e37ccf1eeae9199f48d9bce8d1c57d6c8c03dda05c4fa2420", GENERATED_POSTER_RECORD],
  [
    "0cd83d944a6ca7822b4a8306cecc60a36e859b041f6702c6a1ad9ead78924451",
    {
      route:
        "Route 2 of assumption A6 — a published clip committed byte-for-byte; no encoder produced it",
      source:
        "`https://mdn.github.io/shared-assets/videos/flower.mp4` (MDN shared assets, also published in the MDN `interactive-examples` repository under `live-examples/media/cc0-videos/`)",
      licence: "CC0 1.0 public-domain dedication",
    },
  ],
  ["11aec5ad6615d3126cbfa218de50047110fc9c72cbd28836959deeac2201323e", DERIVED_MKV],
  [
    "ba51eec8900af052872a4b89ee70982729349e98aed220db66841c4f2e1e6e61",
    {
      route:
        "Route 1 of assumption A6 — encoded locally from a deterministic synthetic test pattern by the VP9 and Opus encoders present on the authoring host; no third-party clip was supplied, copied or downloaded",
      source:
        "No third-party work: the clip is generated locally, and the container's own tags record the encoders that produced it — `Lavc libvpx-vp9` for the video track and `Lavc libopus` for the audio track",
      licence: "Not applicable (generated)",
    },
  ],
  ["cb14d23eaff181f27211e484e71aca8240b9f3bdb1b8598b2955be9c0611e044", GENERATED_VTT_RECORD],
]);

/** A failure with the exit code it must produce, so `main` never invents one at the call site. */
class FixtureError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = "FixtureError";
    this.exitCode = exitCode;
  }
}

function write(text) {
  process.stdout.write(text);
}

function writeError(text) {
  process.stderr.write(text);
}

/** Reads one command-line flag set into the configuration `main` acts on. */
function parseCommandLine(argv) {
  const config = { mode: "check", force: false, encode: false, from: null };
  let sawCheck = false;
  let sawWrite = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") {
      sawCheck = true;
    } else if (flag === "--write") {
      sawWrite = true;
    } else if (flag === "--force") {
      config.force = true;
    } else if (flag === "--encode") {
      config.encode = true;
    } else if (flag === "--from") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { kind: "usage", reason: "--from needs a directory that holds the two clips" };
      }
      config.from = path.resolve(value);
      index += 1;
    } else {
      return { kind: "usage", reason: `unknown argument ${JSON.stringify(flag)}` };
    }
  }

  if (sawCheck && sawWrite) {
    return { kind: "usage", reason: "--check and --write cannot be combined" };
  }
  if (config.force && !sawWrite) {
    return {
      kind: "usage",
      reason: "--force only replaces an artefact this script authors, so it needs --write",
    };
  }
  if (config.encode && !(sawWrite && config.force)) {
    return {
      kind: "usage",
      reason: "--encode needs --write --force because encoding replaces both clips",
    };
  }
  if (config.from !== null && !fs.existsSync(config.from)) {
    return { kind: "usage", reason: `--from ${config.from} does not exist` };
  }
  if (config.from !== null && !fs.statSync(config.from).isDirectory()) {
    return { kind: "usage", reason: `--from ${config.from} is not a directory` };
  }

  config.mode = sawWrite ? "write" : "check";
  return { kind: "config", config };
}

/** The one-line banner, naming the mode and the destination so a transcript shows what ran. */
function bannerLine(config) {
  const extras = [];
  if (config.encode) extras.push("encode=on");
  if (config.from !== null) extras.push(`from=${config.from}`);
  if (config.force) extras.push("force=on");
  const suffix = extras.length === 0 ? "" : ` ${extras.join(" ")}`;
  return `make-media-fixtures: mode=${config.mode} destination=${DEST}${suffix}`;
}

function fixturePath(name) {
  return path.join(DEST, name);
}

function relativeFixturePath(name) {
  return path.relative(ROOT, fixturePath(name)).split(path.sep).join("/");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function count(bytes) {
  return bytes.toLocaleString("en-US");
}

function hex(value, width = 2) {
  return value.toString(16).padStart(width, "0");
}

function hexDump(bytes) {
  return [...bytes].map((byte) => hex(byte)).join(" ");
}

/** Seconds with the container's own precision, e.g. `5.055 s`. */
function seconds(value) {
  return `${value.toFixed(3)} s`;
}

/** Collects assertion failures so one run reports every problem instead of only the first. */
function createChecklist() {
  const failures = [];
  return {
    failures,
    require(label, holds, expected, observed) {
      if (holds) return true;
      failures.push({ label, expected, observed });
      return false;
    },
  };
}

/**
 * Reads one variable-length integer. With `asId` the whole id is the value; otherwise the leading bits
 * are the width marker and the remainder is the size. `null` means the bytes are not a vint this reader
 * accepts, so no caller walks a document it does not understand.
 */
function readVint(buffer, offset, asId = false) {
  if (offset < 0 || offset >= buffer.length) return null;
  const first = buffer[offset];
  let width = 1;
  let mask = 0x80;
  while (width <= 8 && (first & mask) === 0) {
    mask >>= 1;
    width += 1;
  }
  if (width > 8 || offset + width > buffer.length) return null;

  let value = asId ? first : first & (mask - 1);
  // A size whose payload bits are all ones means "unknown length" and is never inherited by an element
  // this script writes.
  let unknown = !asId && (first & (mask - 1)) === mask - 1;
  for (let index = 1; index < width; index += 1) {
    const byte = buffer[offset + index];
    value = value * 256 + byte;
    if (byte !== 0xff) unknown = false;
  }
  return { width, value, unknown };
}

/** Encodes a size vint at exactly `width` bytes, or `null` when the value does not fit that width. */
function encodeVintSize(value, width) {
  const maximum = 2 ** (7 * width) - 2;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) return null;
  const bytes = Buffer.alloc(width);
  let remaining = value;
  for (let index = width - 1; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] |= 0x80 >> (width - 1);
  return bytes;
}

/** One EBML element header plus where its payload starts and ends. */
function readElement(buffer, offset) {
  const id = readVint(buffer, offset, true);
  if (id === null) return null;
  const size = readVint(buffer, offset + id.width, false);
  if (size === null) return null;
  const payloadStart = offset + id.width + size.width;
  const end = size.unknown ? buffer.length : payloadStart + size.value;
  if (end > buffer.length) return null;
  return {
    id: id.value,
    idWidth: id.width,
    size: size.value,
    sizeWidth: size.width,
    sizeUnknown: size.unknown,
    start: offset,
    payloadStart,
    end,
  };
}

/**
 * Visits the children of one EBML element in document order and reports whether the child chain lands
 * exactly on the parent's end, so a truncated or overlapping document is detected rather than accepted.
 */
function walkEbmlChildren(buffer, start, end, visit) {
  let offset = start;
  while (offset < end) {
    const element = readElement(buffer, offset);
    if (element === null || element.end > end) return false;
    visit(element);
    offset = element.end;
  }
  return offset === end;
}

function readUnsignedElement(buffer, element) {
  const length = element.end - element.payloadStart;
  if (length < 1 || length > 6) return null;
  return buffer.readUIntBE(element.payloadStart, length);
}

function readFloatElement(buffer, element) {
  const length = element.end - element.payloadStart;
  if (length === 4) return buffer.readFloatBE(element.payloadStart);
  if (length === 8) return buffer.readDoubleBE(element.payloadStart);
  return null;
}

function readAsciiElement(buffer, element) {
  return buffer.toString("latin1", element.payloadStart, element.end);
}

/** Reads the EBML header of a WebM or Matroska document, including every DocType child it holds. */
function readEbmlHeader(buffer) {
  const header = readElement(buffer, 0);
  if (header === null || header.id !== EBML_HEADER || header.sizeUnknown) return null;

  const docTypeElements = [];
  const wellFormed = walkEbmlChildren(buffer, header.payloadStart, header.end, (child) => {
    if (child.id === EBML_DOC_TYPE) docTypeElements.push(child);
  });

  return {
    wellFormed,
    docTypeElements,
    docTypes: docTypeElements.map((element) => readAsciiElement(buffer, element)),
    payloadStart: header.payloadStart,
    headerEnd: header.end,
    sizeWidth: header.sizeWidth,
    idEnd: header.payloadStart - header.sizeWidth,
  };
}

/**
 * Reads the duration and display dimensions out of a WebM or Matroska document's own header. This is a
 * header read for the provenance record and for bounding the caption cues; whether a file belongs to the
 * admitted video profile is decided by `apps/dashboard/src/modules/media/video.ts`, never here.
 */
function readEbmlMedia(buffer) {
  const header = readEbmlHeader(buffer);
  if (header === null || !header.wellFormed) return null;

  const segment = readElement(buffer, header.headerEnd);
  if (segment === null || segment.id !== EBML_SEGMENT) return null;

  let timecodeScale = DEFAULT_TIMECODE_SCALE;
  let durationTicks = null;
  let width = null;
  let height = null;

  const segmentWellFormed = walkEbmlChildren(buffer, segment.payloadStart, segment.end, (child) => {
    if (child.id === EBML_INFO) {
      walkEbmlChildren(buffer, child.payloadStart, child.end, (info) => {
        if (info.id === EBML_TIMECODE_SCALE) timecodeScale = readUnsignedElement(buffer, info);
        if (info.id === EBML_DURATION) durationTicks = readFloatElement(buffer, info);
      });
    }
    if (child.id !== EBML_TRACKS) return;
    walkEbmlChildren(buffer, child.payloadStart, child.end, (track) => {
      if (track.id !== EBML_TRACK_ENTRY) return;
      walkEbmlChildren(buffer, track.payloadStart, track.end, (field) => {
        if (field.id !== EBML_VIDEO) return;
        walkEbmlChildren(buffer, field.payloadStart, field.end, (video) => {
          if (video.id === EBML_PIXEL_WIDTH) width = readUnsignedElement(buffer, video);
          if (video.id === EBML_PIXEL_HEIGHT) height = readUnsignedElement(buffer, video);
        });
      });
    });
  });

  const scale = typeof timecodeScale === "number" ? timecodeScale : DEFAULT_TIMECODE_SCALE;
  return {
    wellFormed: segmentWellFormed,
    durationS: durationTicks === null ? null : (durationTicks * scale) / 1e9,
    width,
    height,
  };
}

/** Locates the first box of `type`, descending only through the container boxes that can hold it. */
function findMp4Box(buffer, type, start = 0, end = buffer.length) {
  let offset = start;
  while (offset + 8 <= end) {
    const declared = buffer.readUInt32BE(offset);
    const kind = buffer.toString("latin1", offset + 4, offset + 8);
    let size = declared;
    let headerLength = 8;
    if (declared === 1) {
      if (offset + 16 > end) return null;
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerLength = 16;
    } else if (declared === 0) {
      size = end - offset;
    }
    if (size < headerLength || offset + size > end) return null;
    if (kind === type)
      return { start: offset, payloadStart: offset + headerLength, end: offset + size };
    if (MP4_CONTAINER_BOXES.has(kind)) {
      const inner = findMp4Box(buffer, type, offset + headerLength, offset + size);
      if (inner !== null) return inner;
    }
    offset += size;
  }
  return null;
}

/** Reads the `ftyp` brand at the head of an ISO base media file, or `null` when it is not one. */
function readFtypBrand(buffer) {
  if (buffer.length < 12) return null;
  const size = buffer.readUInt32BE(0);
  if (buffer.toString("latin1", 4, 8) !== "ftyp" || size < 8 || size > buffer.length) return null;
  return buffer.toString("latin1", 8, 12);
}

/**
 * Reads a movie's duration from `mvhd` and its display dimensions from the first `tkhd`. Header reads
 * for the provenance record only — profile acceptance lives in the media module and its tests.
 */
function readMp4Media(buffer) {
  const mvhd = findMp4Box(buffer, "mvhd");
  const tkhd = findMp4Box(buffer, "tkhd");
  if (mvhd === null || tkhd === null) return { durationS: null, width: null, height: null };

  const movieVersion = buffer[mvhd.payloadStart];
  let durationS = null;
  if (movieVersion === 0 && mvhd.payloadStart + 20 <= mvhd.end) {
    const timescale = buffer.readUInt32BE(mvhd.payloadStart + 12);
    const duration = buffer.readUInt32BE(mvhd.payloadStart + 16);
    if (timescale > 0) durationS = duration / timescale;
  } else if (movieVersion === 1 && mvhd.payloadStart + 32 <= mvhd.end) {
    const timescale = buffer.readUInt32BE(mvhd.payloadStart + 20);
    const duration = Number(buffer.readBigUInt64BE(mvhd.payloadStart + 24));
    if (timescale > 0) durationS = duration / timescale;
  }

  // `tkhd` carries the display size as 16.16 fixed point after the 8-byte reserved run, the four 2-byte
  // fields and the 36-byte transform matrix; the version decides how long the leading fields are.
  const trackVersion = buffer[tkhd.payloadStart];
  const sizeOffset = tkhd.payloadStart + (trackVersion === 1 ? 88 : 76);
  let width = null;
  let height = null;
  if (sizeOffset + 8 <= tkhd.end) {
    width = buffer.readUInt32BE(sizeOffset) / 65536;
    height = buffer.readUInt32BE(sizeOffset + 4) / 65536;
  }

  return { durationS, width, height };
}

/** Everything this script reports about one clip: container, document type, duration and dimensions. */
function probeClip(bytes) {
  const brand = readFtypBrand(bytes);
  if (brand !== null) {
    return { container: "mp4", brand, docType: null, ...readMp4Media(bytes) };
  }

  const header = readEbmlHeader(bytes);
  const docType = header !== null && header.docTypes.length === 1 ? header.docTypes[0] : null;
  const media = header === null ? null : readEbmlMedia(bytes);
  let container = "unknown";
  if (docType === WEBM_DOC_TYPE) container = "webm";
  else if (docType === MATROSKA_DOC_TYPE) container = "matroska";
  return {
    container,
    brand: null,
    docType,
    durationS: media === null ? null : media.durationS,
    width: media === null ? null : media.width,
    height: media === null ? null : media.height,
  };
}

/**
 * Derives the rejection case from the WebM clip: the same bytes with the EBML DocType rewritten from
 * `webm` to `matroska`, and the EBML header's size vint rewritten for the four bytes that payload grows
 * by. Everything else — including the segment, its clusters and their data — stays byte-identical, and
 * the derivation refuses a document whose structure is not the one it can rewrite safely.
 */
function deriveMatroska(source) {
  const header = readEbmlHeader(source);
  if (header === null) {
    throw new FixtureError(
      EXIT.failed,
      `${WEBM} does not begin with an EBML header, so no Matroska file can be derived from it`,
    );
  }
  if (!header.wellFormed) {
    throw new FixtureError(
      EXIT.failed,
      `${WEBM} has a malformed EBML header, so the DocType cannot be rewritten safely`,
    );
  }
  if (header.docTypeElements.length !== 1) {
    throw new FixtureError(
      EXIT.failed,
      `${WEBM} holds ${header.docTypeElements.length} DocType elements; this derivation rewrites exactly one`,
    );
  }

  const docType = header.docTypeElements[0];
  const observedDocType = header.docTypes[0];
  if (observedDocType !== WEBM_DOC_TYPE) {
    throw new FixtureError(
      EXIT.failed,
      `${WEBM} declares DocType ${JSON.stringify(observedDocType)}, not ${JSON.stringify(WEBM_DOC_TYPE)}`,
    );
  }
  if (docType.sizeWidth !== 1) {
    throw new FixtureError(
      EXIT.failed,
      `${WEBM} writes the DocType size as a ${docType.sizeWidth}-byte vint; this derivation rewrites a one-byte size only`,
    );
  }
  if (readAsciiElement(source, docType) !== WEBM_DOC_TYPE) {
    throw new FixtureError(
      EXIT.failed,
      `${WEBM} carries a DocType payload this derivation cannot read as ASCII`,
    );
  }

  const segment = readElement(source, header.headerEnd);
  if (segment === null || segment.id !== EBML_SEGMENT) {
    throw new FixtureError(
      EXIT.failed,
      `${WEBM} does not begin its Segment element at the end of the EBML header (byte ${header.headerEnd})`,
    );
  }

  const payload = Buffer.from(MATROSKA_DOC_TYPE, "latin1");
  const rewrittenDocTypeSize = encodeVintSize(payload.length, docType.sizeWidth);
  if (rewrittenDocTypeSize === null) {
    throw new FixtureError(
      EXIT.failed,
      `the ${MATROSKA_DOC_TYPE} DocType does not fit the ${docType.sizeWidth}-byte size vint`,
    );
  }

  const rewrittenDocType = Buffer.concat([
    source.subarray(docType.start, docType.start + docType.idWidth),
    rewrittenDocTypeSize,
    payload,
  ]);
  const docTypeLength = docType.end - docType.start;
  const headerPayloadLength =
    header.headerEnd - header.payloadStart - docTypeLength + rewrittenDocType.length;
  const rewrittenHeaderSize = encodeVintSize(headerPayloadLength, header.sizeWidth);
  if (rewrittenHeaderSize === null) {
    throw new FixtureError(
      EXIT.failed,
      `the rewritten EBML header size ${headerPayloadLength} does not fit its ${header.sizeWidth}-byte vint`,
    );
  }

  const derived = Buffer.concat([
    source.subarray(0, header.idEnd),
    rewrittenHeaderSize,
    source.subarray(header.payloadStart, docType.start),
    rewrittenDocType,
    source.subarray(docType.end, header.headerEnd),
    source.subarray(header.headerEnd),
  ]);

  // Re-read what this function just assembled before any caller may write it: a derivation that does not
  // produce a Matroska document is a defect here, never a corrupt fixture on disk.
  const derivedHeader = readEbmlHeader(derived);
  const derivedSegment =
    derivedHeader === null ? null : readElement(derived, derivedHeader.headerEnd);
  const grewBy = derived.length - source.length;
  if (
    derivedHeader === null ||
    derivedHeader.docTypes.length !== 1 ||
    derivedHeader.docTypes[0] !== MATROSKA_DOC_TYPE ||
    derivedSegment === null ||
    derivedSegment.id !== EBML_SEGMENT ||
    grewBy !== payload.length - (docType.end - docType.payloadStart)
  ) {
    throw new FixtureError(
      EXIT.failed,
      `the derived Matroska document did not re-read as one (${WEBM} grew by ${grewBy} bytes)`,
    );
  }

  return { bytes: derived, grewBy, sourceLength: source.length };
}

/** What an operator has to do when a clip is absent and this run has no way to produce it. */
function missingClipInstruction(name) {
  return [
    `${name} is missing from ${DEST}.`,
    `This script authors the caption track, the poster and the Matroska rejection case itself, but it never`,
    `synthesises a clip and never downloads one. Supply an openly licensed clip of at most 2 MiB named`,
    `${name}, either by placing it in that directory or by pointing at the directory that holds it with`,
    `\`--write --from <dir>\` (or encode a synthetic pattern instead with \`--write --force --encode\`), then`,
    `record its source URL and licence in \`docs/architecture.md\`.`,
  ].join("\n");
}

/** Reads a clip the operator supplied, refusing one that is already larger than A6 allows. */
function readSuppliedClip(name, fromDirectory) {
  const source = path.join(fromDirectory, name);
  if (!fs.existsSync(source)) {
    throw new FixtureError(
      EXIT.missing,
      `${name} is not in ${fromDirectory}, so there is nothing to copy. ${missingClipInstruction(name)}`,
    );
  }
  const bytes = fs.readFileSync(source);
  if (bytes.length > MAX_CLIP_BYTES) {
    throw new FixtureError(
      EXIT.failed,
      `${name} in ${fromDirectory} is ${count(bytes.length)} bytes, above the ${count(MAX_CLIP_BYTES)}-byte authoring limit`,
    );
  }
  return bytes;
}

/**
 * Every place the workspace could have installed the image library: the root `node_modules` of a hoisted
 * install, then each application package's own `node_modules` of a per-package install.
 */
function sharpPackageRoots() {
  const roots = [path.join(ROOT, "node_modules", "sharp")];
  if (fs.existsSync(APPS)) {
    for (const entry of fs.readdirSync(APPS, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(path.join(APPS, entry.name, "node_modules", "sharp"));
    }
  }
  return roots;
}

/**
 * Loads the image library from the installed package's own entry point. The package is addressed by
 * path rather than by a bare specifier on purpose: a bare specifier lets a runtime that installs missing
 * packages on demand reach the network, and this script never does.
 */
async function loadSharp() {
  const root = sharpPackageRoots().find((candidate) =>
    fs.existsSync(path.join(candidate, "package.json")),
  );
  if (root === undefined) {
    throw new FixtureError(
      EXIT.missing,
      `the image library sharp is not installed, so ${POSTER} cannot be authored; run \`bun install\` at the repository root first`,
    );
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const entry = path.join(root, typeof manifest.main === "string" ? manifest.main : "index.js");
    const imported = await import(pathToFileURL(entry).href);
    const sharp = imported.default ?? imported;
    if (typeof sharp !== "function")
      throw new Error("the installed module exports no sharp factory");
    return sharp;
  } catch (error) {
    throw new FixtureError(
      EXIT.missing,
      `sharp is installed at ${root} but could not be loaded (${String(error)}), so ${POSTER} cannot be authored`,
    );
  }
}

/**
 * Draws the poster: one flat theme surface with a single contrasting band, no text, no logo and no
 * illustration. The buffer is encoded as JPEG without any metadata-carrying call, so no EXIF, ICC or
 * comment segment is produced at all.
 */
async function authorPoster() {
  const sharp = await loadSharp();
  return sharp({
    create: { width: POSTER_WIDTH, height: POSTER_HEIGHT, channels: 3, background: POSTER_SURFACE },
  })
    .composite([
      {
        input: {
          create: {
            width: POSTER_WIDTH,
            height: POSTER_BAND_HEIGHT,
            channels: 3,
            background: POSTER_BAND,
          },
        },
        top: POSTER_BAND_TOP,
        left: 0,
      },
    ])
    .jpeg({ quality: POSTER_QUALITY })
    .toBuffer();
}

/* ---------------------------------------------------------------------------------------------------
 * Route 1 of assumption A6 — the only section that looks for or runs an encoder.
 *
 * Every reference to an encoder lives in this section, and the section is reachable only through
 * `--encode`, so no other mode of this script can depend on a binary being installed.
 * --------------------------------------------------------------------------------------------------- */

/** Seconds of synthetic pattern encoded for each clip; short, because these fixtures exist to be played. */
const ENCODE_SECONDS = 2;

/** Locates an encoder on `PATH`, or explains that Route 1 is unavailable. */
function detectEncoder() {
  const found = spawnSync("which", ["ffmpeg"], { encoding: "utf8" });
  const binary = found.status === 0 ? found.stdout.trim() : "";
  if (binary === "") {
    throw new FixtureError(
      EXIT.missing,
      "--encode needs ffmpeg on PATH and found none; run without --encode to verify the clips the operator supplied",
    );
  }
  const versionRun = spawnSync(binary, ["-version"], { encoding: "utf8" });
  const firstLine = versionRun.status === 0 ? versionRun.stdout.split("\n")[0] : "";
  return { binary, name: path.basename(binary), version: (firstLine ?? "").trim() };
}

/** Runs the encoder once, passing its own diagnostics through when it refuses a job. */
function runEncoder(encoder, name, argumentsForRun) {
  const result = spawnSync(
    encoder.binary,
    ["-hide_banner", "-loglevel", "error", "-y", ...argumentsForRun],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new FixtureError(
      EXIT.failed,
      `the encoder could not write ${name}: ${(result.stderr ?? "").trim()}`,
    );
  }
}

/** Encodes the synthetic pattern into a temporary file, checks its size, then moves it into place. */
function encodeClip(encoder, name, target) {
  const partial = `${target}.partial`;
  const inputs = [
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${POSTER_WIDTH}x${POSTER_HEIGHT}:rate=30:duration=${ENCODE_SECONDS}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${ENCODE_SECONDS}`,
    "-shortest",
  ];
  try {
    if (name === MP4) {
      // The muxer is named explicitly because the temporary file's extension is not the container's, and
      // the encoder refuses to guess a container from a partial name.
      runEncoder(encoder, name, [
        ...inputs,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        partial,
      ]);
    } else {
      // VP9 with Opus is what the fixture is named for; an encoder built without VP9 still produces an
      // admitted WebM through VP8 with Vorbis, so that pair is written rather than the whole run failing.
      try {
        runEncoder(encoder, name, [
          ...inputs,
          "-c:v",
          "libvpx-vp9",
          "-b:v",
          "0",
          "-crf",
          "40",
          "-c:a",
          "libopus",
          "-f",
          "webm",
          partial,
        ]);
      } catch {
        runEncoder(encoder, name, [
          ...inputs,
          "-c:v",
          "libvpx",
          "-b:v",
          "1M",
          "-c:a",
          "libvorbis",
          "-f",
          "webm",
          partial,
        ]);
      }
    }
    const bytes = fs.readFileSync(partial);
    if (bytes.length > MAX_CLIP_BYTES) {
      throw new FixtureError(
        EXIT.failed,
        `the encoded ${name} is ${count(bytes.length)} bytes, above the ${count(MAX_CLIP_BYTES)}-byte authoring limit`,
      );
    }
    fs.renameSync(partial, target);
  } finally {
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
  }
}

/**
 * Authors whatever this run may write and reports what it did: the supplied or encoded clips first, because
 * the Matroska rejection case derives from the WebM, then the caption track, that rejection case and the
 * poster. It also reports every fixture it wrote, so the provenance block prints the record this run
 * authored for those bytes rather than asking the digest table to account for a re-encode. A clip that is
 * absent and unproducible ends the run before anything is written, so a partial set never stands in for a
 * complete one.
 */
async function authorAll(config) {
  fs.mkdirSync(DEST, { recursive: true });
  const notes = [];
  const written = new Set();
  let encoder = null;

  if (config.encode) {
    encoder = detectEncoder();
    notes.push(`encoder: ${encoder.version}`);
  }

  for (const name of CLIPS) {
    const target = fixturePath(name);
    const exists = fs.existsSync(target);
    if (exists && !(config.force && (config.encode || config.from !== null))) continue;

    if (config.encode) {
      encodeClip(encoder, name, target);
      written.add(name);
      notes.push(`encoded ${name} with ${encoder.name}`);
      continue;
    }
    if (config.from !== null) {
      fs.writeFileSync(target, readSuppliedClip(name, config.from));
      written.add(name);
      notes.push(`copied ${name} from ${config.from}`);
      continue;
    }
    if (!exists) throw new FixtureError(EXIT.missing, missingClipInstruction(name));
  }

  if (!fs.existsSync(fixturePath(VTT)) || config.force) {
    fs.writeFileSync(fixturePath(VTT), Buffer.from(vttContent(captionLimitFromClips()), "utf8"));
    written.add(VTT);
    notes.push(`wrote ${VTT}`);
  }

  if (!fs.existsSync(fixturePath(MKV)) || config.force) {
    if (!fs.existsSync(fixturePath(WEBM)))
      throw new FixtureError(EXIT.missing, missingClipInstruction(WEBM));
    const derived = deriveMatroska(fs.readFileSync(fixturePath(WEBM)));
    fs.writeFileSync(fixturePath(MKV), derived.bytes);
    written.add(MKV);
    notes.push(`derived ${MKV} from ${WEBM} (+${derived.grewBy} bytes)`);
  }

  if (!fs.existsSync(fixturePath(POSTER)) || config.force) {
    fs.writeFileSync(fixturePath(POSTER), await authorPoster());
    written.add(POSTER);
    notes.push(`wrote ${POSTER} with sharp`);
  }

  return { notes, written, encoder };
}

/** The authoring facts a read-only run has nothing to report for. */
function noAuthoring() {
  return { notes: [], written: new Set(), encoder: null };
}

/** A JPEG frame header: the marker, the declared height and the declared width. */
function readJpegFrame(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers carry no length: the start-of-image, the reset markers and the template markers.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) return null;
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrameHeader) {
      if (offset + 9 > buffer.length) return null;
      return {
        marker,
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function jpegKindName(marker) {
  if (marker === 0xc0) return "baseline";
  if (marker === 0xc1) return "extended sequential";
  if (marker === 0xc2) return "progressive";
  return `marker 0x${hex(marker)}`;
}

/** One `HH:MM:SS.mmm` cue boundary as seconds. */
const CUE_TIMING = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;

function cueSeconds(match, firstGroup) {
  const hours = Number(match[firstGroup]);
  const minutes = Number(match[firstGroup + 1]);
  const secs = Number(match[firstGroup + 2]);
  const millis = Number(match[firstGroup + 3]);
  return hours * 3600 + minutes * 60 + secs + millis / 1000;
}

function parseVttCues(text) {
  const cues = [];
  for (const line of text.split("\n")) {
    const match = CUE_TIMING.exec(line.trim());
    if (match === null) continue;
    cues.push({ startS: cueSeconds(match, 1), endS: cueSeconds(match, 5) });
  }
  return cues;
}

function formatCueTime(value) {
  const total = Math.round(value * 1000);
  const millis = total % 1000;
  const secs = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / 60000) % 60;
  const hours = Math.floor(total / 3600000);
  return `${hex(hours)}:${hex(minutes)}:${hex(secs)}.${millis.toString().padStart(3, "0")}`;
}

/** Verifies the poster by its own bytes: a sequential JPEG of the authored size with no metadata segment. */
function verifyPoster(bytes, checklist) {
  const head = hexDump(bytes.subarray(0, 3));
  checklist.require(
    `${POSTER} begins with a JPEG start-of-image`,
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    "FF D8 FF",
    head,
  );

  const asText = bytes.toString("latin1");
  checklist.require(
    `${POSTER} carries no EXIF segment`,
    !asText.includes("Exif"),
    "no `Exif` marker",
    asText.includes("Exif") ? "an `Exif` marker" : "none",
  );
  checklist.require(
    `${POSTER} carries no ICC profile`,
    !asText.includes("ICC_PROFILE"),
    "no `ICC_PROFILE` marker",
    asText.includes("ICC_PROFILE") ? "an `ICC_PROFILE` marker" : "none",
  );

  const tail = hexDump(bytes.subarray(Math.max(0, bytes.length - 2)));
  checklist.require(
    `${POSTER} ends with the JPEG end-of-image marker`,
    bytes.length >= 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9,
    "FF D9",
    tail,
  );

  const frame = readJpegFrame(bytes);
  checklist.require(`${POSTER} declares a frame header`, frame !== null, "an SOF segment", "none");
  if (frame !== null) {
    checklist.require(
      `${POSTER} is ${POSTER_WIDTH} × ${POSTER_HEIGHT}`,
      frame.width === POSTER_WIDTH && frame.height === POSTER_HEIGHT,
      `${POSTER_WIDTH} × ${POSTER_HEIGHT}`,
      `${frame.width} × ${frame.height}`,
    );
    checklist.require(
      `${POSTER} is a sequential JPEG`,
      frame.marker === 0xc0 || frame.marker === 0xc1,
      "baseline or extended sequential",
      jpegKindName(frame.marker),
    );
  }

  return {
    kind: frame === null ? null : jpegKindName(frame.marker),
    width: frame === null ? null : frame.width,
    height: frame === null ? null : frame.height,
  };
}

/** Verifies the caption track against the clip duration read from the clip itself. */
function verifyVtt(bytes, checklist, limitSeconds) {
  const asText = bytes.toString("utf8");
  checklist.require(
    `${VTT} begins with the WebVTT header`,
    asText.startsWith("WEBVTT"),
    "`WEBVTT`",
    JSON.stringify(asText.slice(0, 8)),
  );

  const carriageReturn = bytes.includes(0x0d);
  checklist.require(
    `${VTT} uses LF line endings`,
    !carriageReturn,
    "no CR byte",
    carriageReturn ? "a CR byte" : "none",
  );

  const nonAscii = bytes.findIndex((byte) => byte > 0x7f);
  checklist.require(
    `${VTT} is plain ASCII`,
    nonAscii === -1,
    "every byte below 0x80",
    nonAscii === -1 ? "none" : `byte 0x${hex(bytes[nonAscii])} at offset ${nonAscii}`,
  );

  const timingLines = asText.split("\n").filter((line) => line.includes("-->"));
  checklist.require(
    `${VTT} writes every cue as a plain start and end with no cue settings`,
    timingLines.length > 0 && timingLines.every((line) => CUE_TIMING.test(line.trim())),
    "`HH:MM:SS.mmm --> HH:MM:SS.mmm` on every timing line",
    `${timingLines.length} timing lines, ${timingLines.filter((line) => CUE_TIMING.test(line.trim())).length} plain`,
  );

  const cues = parseVttCues(asText);
  checklist.require(
    `${VTT} holds at least one cue`,
    cues.length > 0,
    "at least one cue",
    `${cues.length}`,
  );

  const ordered = cues.every(
    (cue, index) => cue.endS > cue.startS && (index === 0 || cue.startS >= cues[index - 1].startS),
  );
  checklist.require(
    `${VTT} orders its cues and each cue ends after it starts`,
    ordered,
    "ascending cues, each ending after it starts",
    ordered ? "ascending" : "out of order or empty",
  );

  const lastEndS = cues.length === 0 ? null : Math.max(...cues.map((cue) => cue.endS));
  if (limitSeconds !== null && lastEndS !== null) {
    checklist.require(
      `${VTT} ends its last cue inside the clip it captions`,
      lastEndS <= limitSeconds,
      `at most ${formatCueTime(limitSeconds)}`,
      formatCueTime(lastEndS),
    );
  }

  return { cues: cues.length, lastEndS, limitSeconds };
}

/** Verifies one supplied clip by its container magic and the duration its own header reports. */
function verifyClip(name, bytes, checklist) {
  checklist.require(
    `${name} is within the ${count(MAX_CLIP_BYTES)}-byte authoring limit`,
    bytes.length <= MAX_CLIP_BYTES,
    `at most ${count(MAX_CLIP_BYTES)} bytes`,
    `${count(bytes.length)} bytes`,
  );

  const facts = probeClip(bytes);
  if (name === MP4) {
    checklist.require(
      `${MP4} begins with an ISO base media \`ftyp\` box`,
      facts.brand !== null,
      "`ftyp` at offset 4",
      facts.brand === null ? hexDump(bytes.subarray(0, 8)) : `brand ${facts.brand}`,
    );
  } else {
    checklist.require(
      `${WEBM} declares DocType \`${WEBM_DOC_TYPE}\` in its EBML header`,
      facts.container === "webm",
      `EBML DocType \`${WEBM_DOC_TYPE}\``,
      facts.docType === null
        ? hexDump(bytes.subarray(0, 4))
        : `DocType ${JSON.stringify(facts.docType)}`,
    );
  }

  checklist.require(
    `${name} reports a duration in its container header`,
    facts.durationS !== null,
    "a duration",
    facts.durationS === null ? "none" : seconds(facts.durationS),
  );

  return facts;
}

/** Verifies the derived Matroska file, including that it is exactly the WebM it came from plus four bytes. */
function verifyMkv(bytes, checklist, webmBytes) {
  const facts = probeClip(bytes);
  const header = readEbmlHeader(bytes);
  const segment = header === null ? null : readElement(bytes, header.headerEnd);

  checklist.require(
    `${MKV} begins with the EBML header`,
    header !== null,
    "EBML magic `1a 45 df a3`",
    hexDump(bytes.subarray(0, 4)),
  );
  checklist.require(
    `${MKV} declares DocType \`${MATROSKA_DOC_TYPE}\``,
    facts.docType === MATROSKA_DOC_TYPE,
    `\`${MATROSKA_DOC_TYPE}\``,
    facts.docType === null ? "none" : JSON.stringify(facts.docType),
  );
  checklist.require(
    `${MKV} starts its Segment where the EBML header ends`,
    segment !== null && segment.id === EBML_SEGMENT,
    "`18 53 80 67` at the header end",
    segment === null ? "no element" : `id ${hex(segment.id, 8)}`,
  );
  if (webmBytes !== null) {
    checklist.require(
      `${MKV} is exactly ${WEBM} plus four bytes`,
      bytes.length === webmBytes.length + 4,
      `${count(webmBytes.length + 4)} bytes`,
      `${count(bytes.length)} bytes`,
    );
  }

  return facts;
}

/**
 * The provenance a run that authored a fixture states for the bytes it has just written, or `null` when it
 * cannot state one: a clip copied out of another directory arrives with no source or licence of its own, so
 * only the record for its digest can speak for it.
 */
function authoredRecord(name, authored) {
  if (!authored.written.has(name)) return null;
  if (name === POSTER) return GENERATED_POSTER_RECORD;
  if (name === VTT) return GENERATED_VTT_RECORD;
  if (name === MKV) return DERIVED_MKV;
  if (authored.encoder === null) return null;
  return {
    route:
      "Route 1 of assumption A6 — encoded by this script from a deterministic synthetic test pattern",
    source:
      "No third-party work: the pattern is generated by the local encoder in the authoring run",
    licence: "Not applicable (generated)",
    encoder: authored.encoder.version,
  };
}

/**
 * The recorded provenance of one fixture: the record this run authored for it, else the record held for its
 * digest, else `null` — the honest answer for bytes no record accounts for. The derived rejection case is
 * resolved from `webmRecord`, the record the clip it derives from resolved to.
 */
function fixtureRecord(name, digest, authored, webmRecord) {
  const fromRun = authoredRecord(name, authored);
  const recorded = fromRun ?? RECORDED_FIXTURE_SOURCES.get(digest) ?? null;
  if (recorded === DERIVED_MKV) return derivedMkvRecord(webmRecord);
  return recorded;
}

function sizeRow(entry) {
  return ["Bytes", count(entry.bytes.length)];
}

function digestRow(entry) {
  return ["SHA-256", `\`${entry.digest}\``];
}

function dimensionsText(facts) {
  if (facts.width === null || facts.height === null) return "not read from the container";
  return `${Math.round(facts.width)} × ${Math.round(facts.height)} (container header)`;
}

function durationText(facts) {
  return facts.durationS === null
    ? "not read from the container"
    : `${seconds(facts.durationS)} (container header)`;
}

/**
 * The Markdown rows of one fixture's provenance block: the recorded route, source and licence for the
 * fixture's exact bytes, then the facts this run measured. A fixture whose digest no record accounts for gets
 * one honest row saying so, and no row claims a route for it.
 */
function provenanceRows(name, entry, facts, record) {
  const rows =
    record === null
      ? [
          [
            "Provenance",
            `No provenance is recorded for these bytes (SHA-256 \`${entry.digest}\`); the route, the source and the licence have to be recorded in \`docs/architecture.md\` and in this script's table before this fixture is committed`,
          ],
        ]
      : [
          ["Route", record.route],
          ["Source", record.source],
          ["Licence", record.licence],
        ];
  if (record !== null && typeof record.encoder === "string") rows.push(["Encoder", record.encoder]);
  rows.push(sizeRow(entry), digestRow(entry));

  if (name === MP4 || name === WEBM) {
    rows.push(
      [
        "Container",
        facts.brand === null
          ? `EBML, DocType \`${facts.docType}\``
          : `MP4 (ISO base media file format), \`ftyp\` brand \`${facts.brand}\``,
      ],
      ["Duration", durationText(facts)],
      ["Dimensions", dimensionsText(facts)],
      [
        "Runtime requirement",
        "None beyond the browser's own decoder; neither this script nor the application needs an encoder to read it",
      ],
    );
    return rows;
  }

  if (name === MKV) {
    rows.push(
      ["Container", `EBML, DocType \`${facts.docType}\``],
      [
        "Purpose",
        "The rejection case: a container the video profile has to refuse by content, in the profile test and in the video acceptance journey",
      ],
    );
    return rows;
  }

  if (name === VTT) {
    const lastCue = facts.lastEndS === null ? "no cue" : formatCueTime(facts.lastEndS);
    const limit =
      facts.limitSeconds === null
        ? "no clip duration to compare"
        : `${seconds(facts.limitSeconds)} clip that carries it`;
    rows.push(
      ["Cues", `${facts.cues} cues; the last ends at ${lastCue}, inside the ${limit}`],
      ["Format", "UTF-8, LF line endings, plain ASCII, no cue settings"],
    );
    return rows;
  }

  rows.push(
    [
      "Format",
      `JPEG (${facts.kind ?? "unknown kind"}) ${Math.round(facts.width ?? 0)} × ${Math.round(facts.height ?? 0)}, quality ${POSTER_QUALITY}, no EXIF, no ICC profile, no comment`,
    ],
    [
      "Profile",
      "Within the admitted image profile: JPEG, at most 10 MiB, at most 8,000 px per side",
    ],
  );
  return rows;
}

/**
 * The provenance block, printed and never written to a file: `docs/architecture.md` is the repository's
 * record, and it is the only place this text belongs. Nothing here depends on the current time, so two
 * runs over the same bytes print identical output.
 */
function provenanceBlock(present, factsByName, records) {
  const lines = [
    "provenance (paste into `docs/architecture.md`)",
    "",
    "local authoring of committed fixtures — not production transcoding or production scanning",
    "",
  ];

  for (const name of FIXTURES) {
    const entry = present.get(name);
    lines.push(
      `#### \`${relativeFixturePath(name)}\``,
      "",
      "| Property | Value |",
      "| --- | --- |",
    );
    if (entry === undefined) {
      lines.push("| Status | MISSING — run `--write` to author it |", "");
      continue;
    }
    for (const [property, value] of provenanceRows(
      name,
      entry,
      factsByName.get(name),
      records.get(name) ?? null,
    )) {
      lines.push(`| ${property} | ${value} |`);
    }
    lines.push("");
  }

  lines.push(
    "**A7 note.** An MP4 container may retain its creation and modification timestamps through a copy-remux. The runtime pipeline re-reads the served metadata tags of every rendition it serves and rejects one that still carries a descriptive tag, so a surviving timestamp alone never drops an asset and no descriptive metadata reaches a reader.",
  );
  return lines.join("\n");
}

/** One line summarising what was verified for a fixture, for the transcript. */
function verifiedSummary(name, entry, facts) {
  if (name === MP4) {
    return `MP4 (\`ftyp\` brand \`${facts.brand}\`) · ${durationText(facts)} · ${dimensionsText(facts)}`;
  }
  if (name === WEBM) {
    return `EBML DocType \`${facts.docType}\` · ${durationText(facts)} · ${dimensionsText(facts)}`;
  }
  if (name === MKV) {
    return `EBML DocType \`${facts.docType}\` · ${count(entry.bytes.length)} bytes, the ${WEBM} clip plus four`;
  }
  if (name === VTT) {
    const lastCue = facts.lastEndS === null ? "no cue" : formatCueTime(facts.lastEndS);
    return `WebVTT · ${facts.cues} cues · the last ends at ${lastCue}`;
  }
  return `JPEG (${facts.kind}) ${facts.width} × ${facts.height} · no EXIF, no ICC profile`;
}

/** Prints the report, the provenance block and the verdict, and returns the exit code. */
function report(config, authored) {
  const checklist = createChecklist();
  const present = new Map();
  const missing = [];

  for (const name of FIXTURES) {
    const target = fixturePath(name);
    if (!fs.existsSync(target)) {
      missing.push(name);
      continue;
    }
    const bytes = fs.readFileSync(target);
    present.set(name, { bytes, digest: sha256(bytes) });
  }

  const factsByName = new Map();
  const webmBytes = present.has(WEBM) ? present.get(WEBM).bytes : null;
  if (present.has(MP4)) factsByName.set(MP4, verifyClip(MP4, present.get(MP4).bytes, checklist));
  if (present.has(WEBM))
    factsByName.set(WEBM, verifyClip(WEBM, present.get(WEBM).bytes, checklist));
  if (present.has(MKV))
    factsByName.set(MKV, verifyMkv(present.get(MKV).bytes, checklist, webmBytes));
  if (present.has(POSTER))
    factsByName.set(POSTER, verifyPoster(present.get(POSTER).bytes, checklist));

  // The captions sit inside every clip that carries them, so the shortest recorded duration bounds them.
  const durations = [factsByName.get(MP4)?.durationS, factsByName.get(WEBM)?.durationS].filter(
    (value) => typeof value === "number",
  );
  const captionLimit = durations.length === 0 ? null : Math.min(...durations);
  if (present.has(VTT))
    factsByName.set(VTT, verifyVtt(present.get(VTT).bytes, checklist, captionLimit));

  // A record belongs to the exact bytes it was established for, so a fixture whose digest no record accounts
  // for is an assertion failure: the block below says so openly instead of printing a route it cannot support.
  // The rejection case carries the source clip's licence, so the WebM's record is resolved before the others.
  const webmPresent = present.get(WEBM);
  const webmRecord =
    webmPresent === undefined ? null : fixtureRecord(WEBM, webmPresent.digest, authored, null);
  const records = new Map();
  for (const name of FIXTURES) {
    const entry = present.get(name);
    if (entry === undefined) continue;
    const record = fixtureRecord(name, entry.digest, authored, webmRecord);
    records.set(name, record);
    checklist.require(
      `${name} has a recorded provenance for its exact bytes`,
      record !== null,
      "a route, a source and a licence recorded for this SHA-256 in `docs/architecture.md` and in this script's table",
      record === null
        ? `no record for sha256 ${entry.digest}`
        : `the record for sha256 ${entry.digest}`,
    );
  }

  if (authored.notes.length > 0) {
    write("\nauthoring\n");
    for (const note of authored.notes) write(`  ${note}\n`);
  }

  write("\nfixtures\n");
  for (const name of FIXTURES) {
    const entry = present.get(name);
    if (entry === undefined) {
      write(`  MISSING  ${name.padEnd(22)}\n`);
      continue;
    }
    write(
      `  present  ${name.padEnd(22)}  ${count(entry.bytes.length).padStart(10)} bytes  sha256 ${entry.digest}\n`,
    );
  }

  if (present.size > 0) {
    write("\nverified\n");
    for (const name of FIXTURES) {
      const entry = present.get(name);
      if (entry === undefined) continue;
      write(`  ${name.padEnd(22)}  ${verifiedSummary(name, entry, factsByName.get(name))}\n`);
    }
  }

  if (checklist.failures.length > 0) {
    write("\nfailures\n");
    for (const failure of checklist.failures) {
      write(
        `  fail  ${failure.label}: expected ${failure.expected}, observed ${failure.observed}\n`,
      );
    }
  }

  write(`\n${provenanceBlock(present, factsByName, records)}\n`);

  const code =
    checklist.failures.length > 0 ? EXIT.failed : missing.length > 0 ? EXIT.missing : EXIT.ok;
  write(
    `\nSTATUS ${code === EXIT.ok ? "PASS" : "FAIL"} — ${present.size} of ${FIXTURES.length} fixtures present, ${checklist.failures.length} assertion failures\n`,
  );
  if (missing.length > 0) {
    write(
      `missing: ${missing.join(", ")}; author them with \`bun scripts/make-media-fixtures.mjs --write\`\n`,
    );
  }
  if (config.mode === "write" && code === EXIT.ok) {
    write(
      "next: commit the authored fixtures, and transcribe the provenance block above into docs/architecture.md\n",
    );
  }

  return code;
}

async function main() {
  const parsed = parseCommandLine(process.argv.slice(2));
  if (parsed.kind === "usage") {
    writeError(`${usageText(parsed.reason)}\n`);
    return EXIT.usage;
  }

  const { config } = parsed;
  write(`${bannerLine(config)}\n`);

  try {
    const authored = config.mode === "write" ? await authorAll(config) : noAuthoring();
    return report(config, authored);
  } catch (error) {
    if (error instanceof FixtureError) {
      writeError(`make-media-fixtures: ${error.message}\n`);
      return error.exitCode;
    }
    throw error;
  }
}

process.exitCode = await main();
