/**
 * The store's filesystem mechanism: one deterministic JSON serialiser, one atomic temp-then-rename
 * writer, one absence probe, one absence-aware reader and one tolerant single-document delete. Policy
 * — which document, when, and under which lock — belongs to `repository.ts`, and no module outside
 * this one and `repository.ts` touches disk.
 */
import { randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
/** A document that exists but cannot be decoded: carries the path and the parse cause, never the bytes. */
export class CorruptJsonError extends Error {
  readonly file: string;
  constructor(file: string, cause: unknown) {
    // The message names the path but never quotes the bytes: a corrupt document may hold a
    // private note body or a check-in answer, and this store is upstream of redaction.
    super(`Corrupt JSON document at ${file}: the bytes could not be decoded as JSON`, { cause });
    this.name = "CorruptJsonError";
    this.file = file;
  }
}
/** Serialises a document to the store's canonical bytes: two-space indent, keys sorted at every depth, one trailing newline. */
export function serialiseJson(value: unknown): string {
  const text = JSON.stringify(sortKeysDeep(value, new WeakSet<object>()), null, 2);
  if (text === undefined) {
    throw new Error("serialiseJson: the value is not JSON-serialisable (JSON.stringify produced no text)");
  }
  return `${text}\n`;
}
/** Writes a document through a same-directory temp file and a rename, so a crash leaves the previous document or the new one; always writes, so change detection stays with the caller. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  // Serialising before any I/O is what keeps a rejected value from leaving behind a file,
  // a temp file or a truncated document.
  const contents = serialiseJson(value);
  const directory = dirname(file);
  await mkdir(directory, { recursive: true });
  // The temp file must share the target's directory: a rename across devices is a copy,
  // which is not atomic.
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "w");
    await handle.writeFile(contents, "utf8");
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
/** Reads a document: `undefined` only when the file is absent, and every other fault or corrupt body thrown. */
export async function readJson<T = unknown>(file: string): Promise<T | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    // Absence is the only outcome that is not an error: it stays distinct from a fault and
    // from a corrupt body, so no view can render unavailable as empty or as zero.
    if (isNotFound(error)) return undefined;
    throw error;
  }
  let text: string;
  try {
    // Strict decoding: invalid UTF-8 is an undecodable document, not a replacement-char one.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CorruptJsonError(file, error);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new CorruptJsonError(file, error);
  }
}
/** Reports whether a path exists, and is the probe that lets a caller tell an absent store root from an absent document. */
export async function existsOnDisk(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
/** Deletes one document, tolerating one that is already gone; clearing the data root belongs to the reset path. */
export async function removeIfExists(file: string): Promise<void> {
  await rm(file, { force: true });
}
const CIRCULAR_MESSAGE = "Converting circular structure to JSON";

function sortKeysDeep(value: unknown, ancestors: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError(CIRCULAR_MESSAGE);
    ancestors.add(value);
    try {
      return value.map((entry) => sortKeysDeep(entry, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (!isPlainObject(value)) return value;
  if (ancestors.has(value)) throw new TypeError(CIRCULAR_MESSAGE);
  ancestors.add(value);
  try {
    // fromEntries, not bracket assignment: an own "__proto__" key parsed from a document
    // must stay ordinary data instead of being taken as a prototype.
    return Object.fromEntries(
      Object.entries(value)
        .sort(compareKeyEntries)
        .map(([key, entry]) => [key, sortKeysDeep(entry, ancestors)] as const),
    );
  } finally {
    ancestors.delete(value);
  }
}
function compareKeyEntries([left]: readonly [string, unknown], [right]: readonly [string, unknown]): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
    // The rename already put the new document in place; only its directory entry may be
    // unflushed, which this platform does not let us force.
  }
}
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT";
}
