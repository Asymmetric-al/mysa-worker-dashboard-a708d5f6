import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
/** A document that exists but cannot be decoded: carries the path and the parse cause, never the bytes. */
export class CorruptJsonError extends Error {
  readonly file: string;
  constructor(file: string, cause: unknown) {
    super(`Corrupt JSON document at ${file}: the bytes could not be decoded as JSON`, { cause });
    this.name = "CorruptJsonError";
    this.file = file;
  }
}
export function serialiseJson(value: unknown): string {
  const text = JSON.stringify(sortKeysDeep(value, new WeakSet<object>()), null, 2);
  if (text === undefined) throw new Error("serialiseJson: the value is not JSON-serialisable (JSON.stringify produced no text)");
  return `${text}\n`;
}
/** The canonical digest of a value's JSON form: two values share a digest exactly when `serialiseJson` would write the same bytes for them. */
export function canonicalDigest(value: unknown): string {
  const tokens: string[] = [];
  feedCanonicalJson(tokens, value, new WeakSet<object>());
  return createHash("sha256").update(tokens.join("")).digest("hex");
}
function feedCanonicalJson(tokens: string[], value: unknown, ancestors: WeakSet<object>): void {
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return void tokens.push(JSON.stringify(value));
  if (type === "bigint") throw new TypeError(BIGINT_MESSAGE);
  if (value === null) return void tokens.push("null");
  if (typeof value !== "object") throw new TypeError(NO_JSON_FORM_MESSAGE);
  const container: object = value;
  if (ancestors.has(container)) throw new TypeError(CIRCULAR_MESSAGE);
  if (!Array.isArray(container) && !isPlainObject(container)) {
    const text = JSON.stringify(container); // A value that is not a plain object is left to `JSON.stringify`, as `sortKeysDeep` leaves it, so a Date keeps its ISO form and a Map stays the empty object it serialises to.
    if (text === undefined) throw new TypeError(NO_JSON_FORM_MESSAGE);
    return void tokens.push(text);
  }
  ancestors.add(container);
  try {
    if (Array.isArray(container)) {
      tokens.push("[");
      container.forEach((entry: unknown, index: number) => {
        if (index > 0) tokens.push(",");
        if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") tokens.push("null");
        else feedCanonicalJson(tokens, entry, ancestors);
      });
      tokens.push("]");
      return;
    }
    tokens.push("{");
    let first = true;
    // Members are visited in the code-unit order `sortKeysDeep` sorts them into, and one with no JSON form is dropped exactly as `JSON.stringify` drops it.
    for (const [key, entry] of Object.entries(container).sort(compareKeyEntries)) {
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
      if (!first) tokens.push(",");
      first = false;
      tokens.push(JSON.stringify(key), ":");
      feedCanonicalJson(tokens, entry, ancestors);
    }
    tokens.push("}");
  } finally {
    ancestors.delete(container);
  }
}
/** Writes bytes through a same-directory temp file and a rename, so a crash leaves the previous file or the new one; always writes, so change detection stays with the caller. */
export async function writeBytesAtomic(file: string, bytes: string | Uint8Array): Promise<void> {
  const directory = dirname(file);
  await mkdir(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
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
/** Writes a document through {@link writeBytesAtomic}, serialising it first so a rejected value leaves no file behind. */
export const writeJsonAtomic = async (file: string, value: unknown): Promise<void> => writeBytesAtomic(file, serialiseJson(value));
/** Reads a document: `undefined` only when the file is absent, and every other fault or corrupt body thrown. */
export async function readJson<T = unknown>(file: string): Promise<T | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
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
export const removeIfExists = async (file: string): Promise<void> => rm(file, { force: true });
const CIRCULAR_MESSAGE = "Converting circular structure to JSON";
const BIGINT_MESSAGE = "Do not know how to serialize a BigInt"; // The digest refuses with the wording `JSON.stringify` uses, so a value the writer would reject is rejected the same way rather than silently stored or compared.
const NO_JSON_FORM_MESSAGE = "canonicalDigest: a value with no JSON form has no bytes to compare";
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
    return Object.fromEntries(
      Object.entries(value)
        .sort(compareKeyEntries)
        .map(([key, entry]) => [key, sortKeysDeep(entry, ancestors)] as const),
    );
  } finally {
    ancestors.delete(value);
  }
}
const compareKeyEntries = ([left]: readonly [string, unknown], [right]: readonly [string, unknown]): number => (left < right ? -1 : left > right ? 1 : 0);
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
async function ignoreFailure(operation: Promise<unknown> | undefined): Promise<void> {
  if (operation === undefined) return;
  try {
    await operation;
  } catch {}
}
async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await ignoreFailure(handle.close());
    }
  } catch {}
}
const isNotFound = (error: unknown): boolean => (typeof error !== "object" || error === null || !("code" in error) ? false : error.code === "ENOENT");
