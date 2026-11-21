/**
 * The store's read, transaction and reset surface: `readSession` returns a session's document set,
 * `transact` runs one serialised read-modify-write, and `resetSession` lays down an exactly specified
 * set or discards the session's documents. This is the only module that decides which session document
 * is written or deleted; `atomic.ts` owns the filesystem mechanism and `sessions.ts` owns the
 * per-session lock.
 */
import { stat } from "node:fs/promises";
import { CorruptJsonError, existsOnDisk, readJson, removeIfExists, serialiseJson, writeJsonAtomic } from "./atomic";
import { DATA_ROOT, sessionPaths, type SessionDocumentKey, type SessionDocuments } from "./paths";
import { withSessionLock } from "./sessions";
const CORE_DOCUMENT_KEYS = ["state", "operations", "meta"] as const satisfies readonly SessionDocumentKey[];

const WRITE_ORDER = ["workload", "meta", "operations", "state"] as const satisfies readonly SessionDocumentKey[];

const DELETE_ORDER = ["state", "operations", "meta", "workload"] as const satisfies readonly SessionDocumentKey[];

const DOCUMENT_KEYS = ["state", "operations", "meta", "workload"] as const satisfies readonly SessionDocumentKey[];

const documentMemo = new Map<string, { readonly signature: string; readonly documents: SessionDocuments }>();

async function signatureOf(paths: ReturnType<typeof sessionPaths>): Promise<string> {
  const parts = await Promise.all(
    DOCUMENT_KEYS.map(async (key) => {
      try {
        const stats = await stat(paths[key]);
        return `${stats.mtimeMs}:${stats.size}`;
      } catch {
        return "-";
      }
    }),
  );
  return parts.join("|");
}
function documentValue(documents: SessionDocuments, key: SessionDocumentKey): unknown {
  return Object.hasOwn(documents, key) ? documents[key] : undefined;
}
async function readRequiredDocument(file: string): Promise<unknown> {
  const document = await readJson(file);
  if (document === undefined) {
    throw new CorruptJsonError(file, new Error("the document is missing although the session's state document exists"));
  }
  return document;
}
/** Raised when the store root itself is absent, so no session can be read from it. */
export class StoreAbsentError extends Error {
  readonly code = "ENOENT" as const;
  readonly root: string;
  constructor(root: string) {
    super(`The store root ${root} does not exist, so no session can be read from it.`);
    this.name = "StoreAbsentError";
    this.root = root;
  }
}
/** Reads a session's documents, or `undefined` when the store holds no such session; a corrupt document throws rather than reading as empty, an absent store root throws {@link. */
export async function readSession(sessionId: string): Promise<SessionDocuments | undefined> {
  const paths = sessionPaths(sessionId);
  const signature = await signatureOf(paths);
  const memoized = documentMemo.get(sessionId);
  if (memoized !== undefined && memoized.signature === signature) {
    return memoized.documents;
  }
  // The state document is the commit marker, so probing it alone answers "does this session exist?"
  // and an absent session is refused without touching the other three documents.
  const state = await readJson(paths.state);
  if (state === undefined) {
    // A document that is absent because the whole root is absent is a store that cannot answer, not a
    // store that holds no such session. The two are told apart here, where the absence rule lives, so
    // that no caller has to guess and no outage is reported as a missing record.
    if (!(await existsOnDisk(DATA_ROOT))) {
      throw new StoreAbsentError(DATA_ROOT);
    }
    documentMemo.delete(sessionId);
    return undefined;
  }
  const [operations, meta, workload] = await Promise.all([readRequiredDocument(paths.operations), readRequiredDocument(paths.meta), readJson(paths.workload)]);
  const documents: SessionDocuments = { state, operations, meta };
  if (workload !== undefined) {
    documents.workload = workload;
  }
  documentMemo.set(sessionId, { signature, documents });
  return documents;
}
/** Refusal raised by `transact` for a session the store does not hold, which it never creates. */
export class SessionNotFoundError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`No session ${JSON.stringify(sessionId)} exists in the store, and a transaction never creates one.`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}
/** Runs one serialised read-modify-write and returns the callback's result; only the documents whose bytes changed are written, and a throwing callback writes nothing. */
export async function transact<T>(sessionId: string, fn: (draft: SessionDocuments) => T | Promise<T>): Promise<T> {
  return withSessionLock(sessionId, async () => {
    const current = await readSession(sessionId);
    if (current === undefined) {
      throw new SessionNotFoundError(sessionId);
    }
    // The callback mutates this deep copy, so a throw or a failed write leaves the stored documents
    // untouched even when the callback had already changed the draft in place.
    const draft = structuredClone(current);
    const result = await fn(draft);
    const paths = sessionPaths(sessionId);
    for (const key of WRITE_ORDER) {
      const next = documentValue(draft, key);
      if (next === undefined) {
        // A document the draft no longer carries is left on disk: deleting is `resetSession`'s job,
        // and a transaction that silently removed a workload would destroy the dataset behind it.
        continue;
      }
      const previous = documentValue(current, key);
      if (previous !== undefined && serialiseJson(previous) === serialiseJson(next)) {
        continue;
      }
      await writeJsonAtomic(paths[key], next);
    }
    // A write of this process is always seen by the next read, whatever the timestamps say.
    documentMemo.delete(sessionId);
    return result;
  });
}
/** Makes a session's on-disk documents exactly the given set, or discards them all when no set is given; it is the store's only creating path, and repeating it leaves identical bytes. */
export async function resetSession(sessionId: string, documents?: SessionDocuments): Promise<void> {
  await withSessionLock(sessionId, async () => {
    const paths = sessionPaths(sessionId);
    if (documents === undefined) {
      // Removing the commit marker first makes the session disappear in one step; a crash after it
      // leaves orphan documents that the next reset clears and that `readSession` never reports.
      for (const key of DELETE_ORDER) {
        await removeIfExists(paths[key]);
      }
      documentMemo.delete(sessionId);
      return;
    }
    for (const key of CORE_DOCUMENT_KEYS) {
      if (documentValue(documents, key) === undefined) {
        throw new Error(
          `Cannot reset session ${JSON.stringify(sessionId)}: the document set carries no "${key}" document, and a session without its state, operations and meta documents is not a session.`,
        );
      }
    }
    // Trim first, so no document of the previous set survives into the new one — a stale workload
    // left behind would make two resets of the same set write different bytes.
    for (const key of DELETE_ORDER) {
      if (documentValue(documents, key) === undefined) {
        await removeIfExists(paths[key]);
      }
    }
    for (const key of WRITE_ORDER) {
      const document = documentValue(documents, key);
      if (document !== undefined) {
        await writeJsonAtomic(paths[key], document);
      }
    }
    // A re-seeded session is a new set of bytes, so the parse of the previous set is dropped here too.
    documentMemo.delete(sessionId);
  });
}
