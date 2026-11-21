/**
 * The store's media-byte custody: the one tree every served media byte lives in, the one reference
 * form a record states for one, and the one place one is written or removed.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATA_ROOT, isSafeSessionId } from "./paths";
/** Absolute path of the one tree the store keeps served media bytes in; importing this module creates nothing. */
export const MEDIA_ROOT: string = join(DATA_ROOT, "media");

const FIXTURES_LANE = "fixtures";

const UPLOADS_LANE = "uploads";

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "text/vtt": "vtt",
  "text/plain": "txt",
};
const MAX_SEGMENT_LENGTH = 128;
/** The extension a stored rendition file carries for one media type, or `bin` for a type the store does not name. */
export function extensionForMediaType(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType.trim().toLowerCase()] ?? "bin";
}
function assertSegment(segment: string, role: string): string {
  const trimmed = segment.trim();
  const safe = trimmed.length > 0 && trimmed.length <= MAX_SEGMENT_LENGTH && trimmed !== "." && trimmed !== ".." && !trimmed.startsWith(".") && !/[/\\\0%\s]/u.test(trimmed);
  if (!safe) {
    throw new Error(
      `Cannot use ${JSON.stringify(segment)} as a media ${role}: it must be 1 to ${String(MAX_SEGMENT_LENGTH)} characters, with no separator, no parent segment, no leading dot, no percent escape, no whitespace and no control character.`,
    );
  }
  return trimmed;
}
/** The custody reference of one seeded asset's rendition: `media/fixtures/<assetId>/<file>` relative to the store's data root. */
export function seededMediaReference(assetId: string, file: string): string {
  return ["media", FIXTURES_LANE, assertSegment(assetId, "asset id"), assertSegment(file, "fixture file name")].join("/");
}
/** The custody reference of one prepared upload rendition: `media/uploads/<sessionId>/<assetId>/<renditionId>.<ext>` relative to the store's data root. */
export function uploadedMediaReference(sessionId: string, assetId: string, renditionId: string, mimeType: string): string {
  if (!isSafeSessionId(sessionId)) {
    throw new Error(
      `Cannot keep media bytes for ${JSON.stringify(sessionId)}: a session id becomes a directory name, so it must be 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`,
    );
  }
  const file = `${assertSegment(renditionId.replace(/[^A-Za-z0-9_-]/gu, "-"), "rendition id")}.${extensionForMediaType(mimeType)}`;
  return ["media", UPLOADS_LANE, sessionId, assertSegment(assetId, "asset id"), assertSegment(file, "rendition file name")].join("/");
}
function relativeSegmentsOf(reference: string): readonly string[] {
  const trimmed = reference.trim();
  const segments = trimmed.split("/");
  const contained =
    trimmed.length > 0 && !trimmed.startsWith("/") && !/\\|\0/u.test(trimmed) && !/^[A-Za-z]:/u.test(trimmed) && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  if (!contained || segments[0] !== "media") {
    throw new Error(
      `Cannot resolve ${JSON.stringify(reference)} as a media reference: a reference is a plain path relative to the data root that begins with "media/" and carries no leading slash, parent segment, backslash or empty segment.`,
    );
  }
  return segments;
}
function mediaPathOf(reference: string): string {
  return join(DATA_ROOT, ...relativeSegmentsOf(reference));
}
/** Writes one rendition's bytes at its custody reference, atomically. */
export async function writeMediaBytes(reference: string, bytes: Uint8Array): Promise<void> {
  const file = mediaPathOf(reference);
  const directory = dirname(file);
  await mkdir(directory, { recursive: true });
  const temporary = `${file}.${String(process.pid)}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "w");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } catch (error) {
    await ignoreFailure(handle?.close());
    await ignoreFailure(rm(temporary, { force: true }));
    throw error;
  }
  await syncDirectory(directory);
}
/** Reads one rendition's bytes at its custody reference. */
export async function readMediaBytes(reference: string): Promise<Uint8Array | undefined> {
  let file: string;
  try {
    file = mediaPathOf(reference);
  } catch {
    // A reference outside the custody tree is not an error to report here: the caller answers with an
    // unavailable source either way, and naming which rule refused it would describe a location inside
    // this store to whoever asked.
    return undefined;
  }
  try {
    return new Uint8Array(await readFile(file));
  } catch {
    return undefined;
  }
}
/** Discards every stored media byte. */
export async function removeAllMedia(): Promise<void> {
  await rm(MEDIA_ROOT, { recursive: true, force: true });
}
async function ignoreFailure(operation: Promise<unknown> | undefined): Promise<void> {
  if (operation === undefined) return;
  try {
    await operation;
  } catch {
    // Deliberately ignored: see the doc comment above.
  }
}
async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await ignoreFailure(handle.close());
    }
  } catch {
    // The rename already put the file in place; only its directory entry may be unflushed, which this
    // platform does not let us force.
  }
}
