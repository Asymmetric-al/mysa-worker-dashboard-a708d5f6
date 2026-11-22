/** The store's media-byte custody: the one tree every served media byte lives in, the one reference form a record states for one, and the one place one is written or removed. */
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isSafeSessionId } from "@/lib/session-cookie";
import { DATA_ROOT } from "./paths";
export const MEDIA_ROOT: string = join(DATA_ROOT, "media");
const FIXTURES_LANE = "fixtures";
const UPLOADS_LANE = "uploads";
const MIME_EXTENSIONS: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "text/vtt": "vtt", "text/plain": "txt" };
const MAX_SEGMENT_LENGTH = 128;
export const extensionForMediaType = (mimeType: string): string => MIME_EXTENSIONS[mimeType.trim().toLowerCase()] ?? "bin";
function assertSegment(segment: string, role: string): string {
  const trimmed = segment.trim();
  const safe = trimmed.length > 0 && trimmed.length <= MAX_SEGMENT_LENGTH && trimmed !== "." && trimmed !== ".." && !trimmed.startsWith(".") && !/[/\\\0%\s]/u.test(trimmed);
  if (!safe) throw new Error(`Cannot use ${JSON.stringify(segment)} as a media ${role}: it must be 1 to ${String(MAX_SEGMENT_LENGTH)} characters, with no separator, no parent segment, no leading dot, no percent escape, no whitespace and no control character.`);
  return trimmed;
}
export const seededMediaReference = (assetId: string, file: string): string => ["media", FIXTURES_LANE, assertSegment(assetId, "asset id"), assertSegment(file, "fixture file name")].join("/");
export function uploadedMediaReference(sessionId: string, assetId: string, renditionId: string, mimeType: string): string {
  if (!isSafeSessionId(sessionId)) throw new Error(`Cannot keep media bytes for ${JSON.stringify(sessionId)}: a session id becomes a directory name, so it must be 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`);
  const file = `${assertSegment(renditionId.replace(/[^A-Za-z0-9_-]/gu, "-"), "rendition id")}.${extensionForMediaType(mimeType)}`;
  return ["media", UPLOADS_LANE, sessionId, assertSegment(assetId, "asset id"), assertSegment(file, "rendition file name")].join("/");
}
function relativeSegmentsOf(reference: string): readonly string[] {
  const trimmed = reference.trim();
  const segments = trimmed.split("/");
  const contained = trimmed.length > 0 && !trimmed.startsWith("/") && !/\\|\0/u.test(trimmed) && !/^[A-Za-z]:/u.test(trimmed) && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  if (!contained || segments[0] !== "media") throw new Error(`Cannot resolve ${JSON.stringify(reference)} as a media reference: a reference is a plain path relative to the data root that begins with "media/" and carries no leading slash, parent segment, backslash or empty segment.`);
  return segments;
}
const mediaPathOf = (reference: string): string => join(DATA_ROOT, ...relativeSegmentsOf(reference));
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
/** The size in bytes of one custody file: the one fact a serving decision needs, and the count the response's own length is computed from. Answers `undefined` exactly where a read would — a reference outside the custody tree, or a path that names no readable file. */
export async function statMediaBytes(reference: string): Promise<number | undefined> {
  let file: string;
  try {
    file = mediaPathOf(reference);
  } catch {
    // A reference outside the custody tree is not an error to report here: the caller answers with an unavailable source either way, and naming which rule refused it would describe a location inside this store to whoever asked.
    return undefined;
  }
  try {
    const stats = await stat(file);
    // Anything that is not a regular file holds no byte range to serve, so it is answered as absent rather than opened and failed on.
    return stats.isFile() ? stats.size : undefined;
  } catch {
    return undefined;
  }
}
/** One inclusive byte window of one custody file: the exact bytes one response carries. A window whose end precedes its start names no byte at all, which is how a zero-byte rendition is answered. */
export type MediaByteWindow = { readonly start: number; readonly end: number };
/** Reads one inclusive byte window of one custody file, so a request for a few hundred kilobytes costs those kilobytes rather than the whole rendition. Answers `undefined` exactly where reading the whole file did — a reference outside the custody tree, an unreadable file, or a file shorter than the window the caller probed — because the caller answers all three with the same unavailable source. */
export async function readMediaBytes(reference: string, window: MediaByteWindow): Promise<Uint8Array | undefined> {
  const length = window.end - window.start + 1;
  const wellFormed = Number.isSafeInteger(window.start) && window.start >= 0 && Number.isSafeInteger(window.end) && Number.isSafeInteger(length) && length >= 0;
  if (!wellFormed) return undefined;
  // The probe has already answered for the file, so a window naming no byte opens nothing.
  if (length === 0) return new Uint8Array(0);
  let file: string;
  try {
    file = mediaPathOf(reference);
  } catch {
    // As in `statMediaBytes`: an absent answer, never a rule the caller can learn from.
    return undefined;
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(file, "r");
    const bytes = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await handle.read(bytes, filled, length - filled, window.start + filled);
      // A file that ends inside the window cannot answer it with a shorter body: the response states the length it was authorised to send, so this is the same absent source as an unreadable file.
      if (bytesRead === 0) return undefined;
      filled += bytesRead;
    }
    return bytes;
  } catch {
    return undefined;
  } finally {
    await ignoreFailure(handle?.close());
  }
}
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
    // The rename already put the file in place; only its directory entry may be unflushed, which this platform does not let us force.
  }
}
