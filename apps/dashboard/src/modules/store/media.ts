/**
 * The store's media-byte custody: the one tree every served media byte lives in, the one reference form
 * a record states for one, and the one place one is written or removed.
 *
 * **Where the bytes are, and why it matters.** `.data/media` is inside the store's own git-ignored data
 * tree, never inside the application's `public/` directory. Anything under `public/` is served by the
 * framework at a permanent, unauthenticated address, so a rendition kept there would be fetchable by any
 * persona without passing through the scope-checked route handler that re-authorises every playback,
 * poster, caption, transcript and display request. Two lanes keep the two origins — and their removal —
 * apart:
 *
 * - `media/fixtures/<assetId>/<file>` — bytes the deterministic seed materialises from the committed
 *   development fixtures, one directory per seeded asset.
 * - `media/uploads/<sessionId>/<assetId>/<renditionId>.<ext>` — bytes an upload prepared, one directory
 *   per asset inside the session that registered it, so a session's uploads leave with that session.
 *
 * **The reference form.** A rendition's `bytesRef` is a plain path relative to the store's data root: no
 * leading slash, no parent segment, no backslash and no empty segment, which is exactly the shape
 * {@link readMediaBytes} resolves inside that root. The form is decided here, once,
 * by {@link seededMediaReference} and {@link uploadedMediaReference}: a reference assembled anywhere else
 * would be a second answer to "where does this byte live" that no writer keeps in step, which is how a
 * record ends up naming a file nothing can resolve.
 *
 * **Reads.** One reference is turned back into bytes here and nowhere else. A reference arrives from a
 * stored record, so the containment rule is applied to it again on the way in: a reference naming
 * anything outside the store's media tree is refused rather than opened, which is what keeps a record
 * from becoming a read of an arbitrary file — the application's `public/` directory included, since
 * everything there is served by the framework without any scope check.
 *
 * **Writes.** A byte is written through a same-directory temp file and a rename, the store's one atomic
 * idiom — `atomic.ts` applies it to documents, where the extra step is serialising JSON, and this module
 * applies it to bytes. A crash therefore leaves either no file or the whole file, never a truncated
 * rendition, and a rewrite of the same reference leaves the same bytes. Nothing here serves HTTP, nothing
 * caches bytes in memory, and nothing decides whether a request may read a byte: that is the serving
 * read's job.
 *
 * Layering: a `modules/store` member, reached the way the store's other members are. It owns the custody
 * layout and the filesystem mechanism around it; which byte is written, when, and under which record is
 * its caller's policy, and so is whether a request may have one — this module resolves a reference the
 * caller already holds the authority to, and decides nothing about scope.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import { DATA_ROOT, isSafeSessionId } from "./paths";

/** Absolute path of the one tree the store keeps served media bytes in; importing this module creates nothing. */
export const MEDIA_ROOT: string = join(DATA_ROOT, "media");

/** The lane holding bytes the deterministic seed materialises from the committed fixtures. */
const FIXTURES_LANE = "fixtures";

/** The lane holding bytes an upload prepared for an asset inside one session. */
const UPLOADS_LANE = "uploads";

/**
 * The extension a stored rendition file carries for its media type, so a person reading the directory
 * recognises what a file holds. Nothing decides anything from it: the media type served is the record's own
 * `mimeType`, and a request never reaches a file name. A type the store does not name gets `bin`, which is
 * honest — the bytes are what they are, and the record still states the type they are served as.
 */
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "text/vtt": "vtt",
  "text/plain": "txt",
};

/** Longest single path segment this module will write: far beyond the identifiers and fixture names it is given. */
const MAX_SEGMENT_LENGTH = 128;

/**
 * The extension a stored rendition file carries for one media type, or `bin` for a type the store does not
 * name.
 */
export function extensionForMediaType(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType.trim().toLowerCase()] ?? "bin";
}

/**
 * Refuses a path segment that could name something other than one file inside its directory.
 *
 * A segment reaches this module from a session id, an asset id, a rendition id and a fixture name, so it is
 * checked here rather than trusted: an empty segment, a separator, a parent segment, a percent escape, a NUL
 * byte or a leading dot would all let a reference name a different file than the one it appears to.
 */
function assertSegment(segment: string, role: string): string {
  const trimmed = segment.trim();
  const safe =
    trimmed.length > 0 &&
    trimmed.length <= MAX_SEGMENT_LENGTH &&
    trimmed !== "." &&
    trimmed !== ".." &&
    !trimmed.startsWith(".") &&
    !/[/\\\0%\s]/u.test(trimmed);
  if (!safe) {
    throw new Error(
      `Cannot use ${JSON.stringify(segment)} as a media ${role}: it must be 1 to ${String(MAX_SEGMENT_LENGTH)} characters, with no separator, no parent segment, no leading dot, no percent escape, no whitespace and no control character.`,
    );
  }
  return trimmed;
}

/**
 * The custody reference of one seeded asset's rendition: `media/fixtures/<assetId>/<file>` relative to the
 * store's data root.
 *
 * The seed names the file it reads its bytes from and this module decides where they live, so the seed's
 * declarative table and every materialised byte agree by construction rather than by two matching constants.
 */
export function seededMediaReference(assetId: string, file: string): string {
  return [
    "media",
    FIXTURES_LANE,
    assertSegment(assetId, "asset id"),
    assertSegment(file, "fixture file name"),
  ].join("/");
}

/**
 * The custody reference of one prepared upload rendition:
 * `media/uploads/<sessionId>/<assetId>/<renditionId>.<ext>` relative to the store's data root.
 *
 * The rendition id is the pipeline's own and carries the asset id and the purpose, so every character that
 * is not safe in a file name is replaced here rather than at the call site; the original upload's name is
 * never part of a reference, which is what keeps a revealing file name out of every stored path.
 */
export function uploadedMediaReference(
  sessionId: string,
  assetId: string,
  renditionId: string,
  mimeType: string,
): string {
  if (!isSafeSessionId(sessionId)) {
    throw new Error(
      `Cannot keep media bytes for ${JSON.stringify(sessionId)}: a session id becomes a directory name, so it must be 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`,
    );
  }
  const file = `${assertSegment(renditionId.replace(/[^A-Za-z0-9_-]/gu, "-"), "rendition id")}.${extensionForMediaType(mimeType)}`;
  return [
    "media",
    UPLOADS_LANE,
    sessionId,
    assertSegment(assetId, "asset id"),
    assertSegment(file, "rendition file name"),
  ].join("/");
}

/**
 * Splits a stored reference into the plain relative path this module may touch, or refuses it.
 *
 * A reference is only ever one this module built, but it also arrives back from a stored record, so the
 * containment rule the serving read applies is applied here too: a leading slash, a backslash, a NUL byte, a
 * drive letter, an empty segment and a parent segment are all refused before a filesystem call is made.
 */
function relativeSegmentsOf(reference: string): readonly string[] {
  const trimmed = reference.trim();
  const segments = trimmed.split("/");
  const contained =
    trimmed.length > 0 &&
    !trimmed.startsWith("/") &&
    !/\\|\0/u.test(trimmed) &&
    !/^[A-Za-z]:/u.test(trimmed) &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  if (!contained || segments[0] !== "media") {
    throw new Error(
      `Cannot resolve ${JSON.stringify(reference)} as a media reference: a reference is a plain path relative to the data root that begins with "media/" and carries no leading slash, parent segment, backslash or empty segment.`,
    );
  }
  return segments;
}

/** The absolute path one custody reference names inside the store's data tree. */
function mediaPathOf(reference: string): string {
  return join(DATA_ROOT, ...relativeSegmentsOf(reference));
}

/**
 * Writes one rendition's bytes at its custody reference, atomically.
 *
 * The bytes are rewritten when the reference already holds them, so recovering a lost acknowledgement with
 * the same operation id writes the same file again instead of failing on an existing one. The temp file
 * shares the target's directory because a rename across devices is a copy, which is not atomic.
 */
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

/**
 * Reads one rendition's bytes at its custody reference.
 *
 * The reference is one this module built, but it arrives back from a stored document, so the containment
 * rule of {@link relativeSegmentsOf} is applied to it again: a leading slash, a backslash, a NUL byte, a
 * drive letter, an empty segment, a parent segment and anything that does not begin with `media/` are all
 * refused before a filesystem call is made. A refused reference and a file that cannot be read right now
 * answer the same `undefined`, because the caller has one honest answer for "these bytes are not there":
 * an unavailable source, never a zero-length body and never a path it could not resolve.
 *
 * The bytes are a copy rather than a view over the read buffer, because the serving decision hands out a
 * subarray of them and nothing served may alias a buffer another read could reuse.
 */
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

/**
 * Discards every stored media byte.
 *
 * Removal is stated at the whole tree because a reset is the only operation that ends a byte's life here:
 * it discards every session and lays the seeded renditions down again from the committed fixtures, so a
 * directory no record names — an upload whose session has gone, a byte left by an interrupted write, a tree
 * from an earlier custody layout — must not survive it. No mutation in this release deletes an asset, so a
 * per-asset or per-session entry point would be a second answer with no caller.
 */
export async function removeAllMedia(): Promise<void> {
  await rm(MEDIA_ROOT, { recursive: true, force: true });
}

/**
 * Discards a cleanup failure, because the caller must see the error that caused the cleanup rather than a
 * secondary one that would hide it.
 */
async function ignoreFailure(operation: Promise<unknown> | undefined): Promise<void> {
  if (operation === undefined) return;
  try {
    await operation;
  } catch {
    // Deliberately ignored: see the doc comment above.
  }
}

/** Makes a directory entry durable; a platform that refuses to fsync a directory is not a write failure. */
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
