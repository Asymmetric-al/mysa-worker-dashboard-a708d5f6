/** The store's filesystem mechanism: one deterministic JSON serialiser, one canonical digest of a document's JSON form, one atomic temp-then-rename writer, one absence probe, one absence-aware reader and one tolerant single-document delete. */
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
/** A document that exists but cannot be decoded: carries the path and the parse cause, never the bytes. */
export class CorruptJsonError extends Error {
  readonly file: string;
  constructor(file: string, cause: unknown) {
    // The message names the path but never quotes the bytes: a corrupt document may hold a private note body or a check-in answer, and this store is upstream of redaction.
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
/**
 * The canonical digest of a value's JSON form: two values share a digest exactly when `serialiseJson` would write the
 * same bytes for them. The encoding is fed to one hash as it is walked, so comparing a document with its draft costs
 * one traversal of that document rather than the key-sorted copy and the pretty-printed string a byte comparison needs.
 */
export function canonicalDigest(value: unknown): string {
  const writer = createCanonicalWriter(createHash("sha256"));
  feedCanonicalJson(writer, value, new WeakSet<object>());
  return writer.digest();
}
/** Writes a document through a same-directory temp file and a rename, so a crash leaves the previous document or the new one; always writes, so change detection stays with the caller. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  // Serialising before any I/O is what keeps a rejected value from leaving behind a file, a temp file or a truncated document.
  const contents = serialiseJson(value);
  const directory = dirname(file);
  await mkdir(directory, { recursive: true });
  // The temp file must share the target's directory: a rename across devices is a copy, which is not atomic.
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
    // Absence is the only outcome that is not an error: it stays distinct from a fault and from a corrupt body, so no view can render unavailable as empty or as zero.
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
    // fromEntries, not bracket assignment: an own "__proto__" key parsed from a document must stay ordinary data instead of being taken as a prototype.
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
type JsonDigestHash = ReturnType<typeof createHash>;
// The two refusals carry the wording `JSON.stringify` uses, so a value `writeJsonAtomic` would reject is rejected by the digest with the same answer rather than compared against a document.
const BIGINT_MESSAGE = "Do not know how to serialize a BigInt";
const NO_JSON_FORM_MESSAGE = "canonicalDigest: a value with no JSON form has no bytes to compare";
// Encoded text reaches the hash one token at a time, so it is gathered first: a hash call per token costs several times the token's own encoding, while this bound keeps the buffer from ever holding a whole document.
const DIGEST_BUFFER_LIMIT = 1 << 20;
type CanonicalWriter = ReturnType<typeof createCanonicalWriter>;
function createCanonicalWriter(hash: JsonDigestHash): { readonly write: (text: string) => void; readonly digest: () => string } {
  const pending: string[] = [];
  let pendingLength = 0;
  const drain = (): void => {
    if (pending.length === 0) return;
    hash.update(pending.join(""));
    pending.length = 0;
    pendingLength = 0;
  };
  return {
    write: (text) => {
      pending.push(text);
      pendingLength += text.length;
      if (pendingLength >= DIGEST_BUFFER_LIMIT) drain();
    },
    digest: () => {
      drain();
      return hash.digest("hex");
    },
  };
}
function feedCanonicalJson(writer: CanonicalWriter, value: unknown, ancestors: WeakSet<object>): void {
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    // A scalar is encoded by JSON.stringify itself, so the digest agrees with the stored bytes on every case that encoding decides: -0 and 0 are one value, and a non-finite number is the null the serialiser writes for it.
    writer.write(JSON.stringify(value));
    return;
  }
  if (type === "bigint") throw new TypeError(BIGINT_MESSAGE);
  if (typeof value !== "object") throw new TypeError(NO_JSON_FORM_MESSAGE);
  if (value === null) {
    writer.write("null");
    return;
  }
  const container: object = value;
  if (ancestors.has(container)) throw new TypeError(CIRCULAR_MESSAGE);
  if (Array.isArray(container)) {
    const items: readonly unknown[] = container;
    ancestors.add(container);
    try {
      writer.write("[");
      for (let index = 0; index < items.length; index += 1) {
        if (index > 0) writer.write(",");
        const entry: unknown = items[index];
        // An array slot is never dropped, so a slot with no JSON form is written as the null JSON.stringify writes there and the slot count stays part of the document's identity.
        if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") writer.write("null");
        else feedCanonicalJson(writer, entry, ancestors);
      }
      writer.write("]");
    } finally {
      ancestors.delete(container);
    }
    return;
  }
  if (!isPlainObject(container)) {
    // `sortKeysDeep` leaves a value that is not a plain object to JSON.stringify, so that value's own encoding is already the one `serialiseJson` writes — a Date as its ISO string, a Map as an empty object — and a circular structure inside it is refused by the same call.
    const text = JSON.stringify(container);
    if (text === undefined) throw new TypeError(NO_JSON_FORM_MESSAGE);
    writer.write(text);
    return;
  }
  ancestors.add(container);
  try {
    // Members are visited in the code-unit order `sortKeysDeep` sorts them into, by the one comparator both walks use, so two objects that differ only in insertion order encode identically.
    const members = Object.entries(container).sort(compareKeyEntries);
    writer.write("{");
    let firstMember = true;
    for (const [key, entry] of members) {
      // A member with no JSON form is dropped, exactly as JSON.stringify drops it, so an object that gained an undefined member still matches the document stored without one.
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
      if (!firstMember) writer.write(",");
      firstMember = false;
      writer.write(JSON.stringify(key));
      writer.write(":");
      feedCanonicalJson(writer, entry, ancestors);
    }
    writer.write("}");
  } finally {
    ancestors.delete(container);
  }
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
    // The rename already put the new document in place; only its directory entry may be unflushed, which this platform does not let us force.
  }
}
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT";
}
