/** The store's read, transaction and reset surface: */
import { stat } from "node:fs/promises";
import { canonicalDigest, CorruptJsonError, existsOnDisk, readJson, removeIfExists, writeJsonAtomic } from "./atomic";
import { DATA_ROOT, sessionPaths, type SessionDocumentKey, type SessionDocuments } from "./paths";
import { withSessionLock } from "./sessions";
const CORE_DOCUMENT_KEYS = ["state", "operations", "meta"] as const satisfies readonly SessionDocumentKey[];
const WRITE_ORDER = ["workload", "meta", "operations", "state"] as const satisfies readonly SessionDocumentKey[];
const DELETE_ORDER = ["state", "operations", "meta", "workload"] as const satisfies readonly SessionDocumentKey[];
const DOCUMENT_KEYS = ["state", "operations", "meta", "workload"] as const satisfies readonly SessionDocumentKey[];
const DOCUMENT_KEY_NAMES: readonly string[] = DOCUMENT_KEYS;
/** Source bytes the memo may hold across every session: four times the generated workload's 67,229,868 bytes, so the session the published Gifts measurement reads stays resident while a handful of other sessions share the memo. */
export const MEMO_BYTE_BUDGET = 4 * 67_229_868;
/** How long the memo keeps an entry nothing has read: long enough that the reads behind one screen never re-parse, short enough that a session nobody is visiting gives its dataset back. */
export const MEMO_IDLE_MS = 10 * 60 * 1000;
interface MemoizedDocuments {
  readonly signature: string;
  readonly documents: SessionDocuments;
  readonly sourceBytes: number;
  readonly readAtMs: number;
}
// Sessions in the order they were last read, which is the order they are dropped in. The memo is a cache in front of the disk and nothing else: every read of a session that is not here is answered by the session's files.
const documentMemo = new Map<string, MemoizedDocuments>();
let memoizedBytes = 0;
interface DocumentSignature {
  readonly signature: string;
  readonly sourceBytes: number;
}
async function signatureOf(paths: ReturnType<typeof sessionPaths>): Promise<DocumentSignature> {
  const parts = await Promise.all(
    DOCUMENT_KEYS.map(async (key) => {
      try {
        const stats = await stat(paths[key]);
        return { stated: `${stats.mtimeMs}:${stats.size}`, bytes: stats.size };
      } catch {
        return { stated: "-", bytes: 0 };
      }
    }),
  );
  return { signature: parts.map((part) => part.stated).join("|"), sourceBytes: parts.reduce((total, part) => total + part.bytes, 0) };
}
/** Drops one session's entry and its bytes from the total, so the bound is maintained incrementally rather than re-measured from the entries. */
function forget(sessionId: string): void {
  const forgotten = documentMemo.get(sessionId);
  if (forgotten === undefined) return;
  memoizedBytes -= forgotten.sourceBytes;
  documentMemo.delete(sessionId);
}
/** Records a freshly parsed document set as the newest entry, then drops the least recently read entries until the total is inside the budget. */
function remember(sessionId: string, entry: MemoizedDocuments): void {
  forget(sessionId);
  documentMemo.set(sessionId, entry);
  memoizedBytes += entry.sourceBytes;
  for (const [candidateId, candidate] of documentMemo) {
    if (memoizedBytes <= MEMO_BYTE_BUDGET) break;
    // The entry this call inserted is the newest, so the scan reaches it last and a session larger than the whole budget is kept rather than evicting every entry and then itself.
    if (candidateId === sessionId) break;
    memoizedBytes -= candidate.sourceBytes;
    documentMemo.delete(candidateId);
  }
}
/** Drops every entry nothing has read within the idle window; the map is kept in read order, so the first entry still inside the window ends the scan. */
function dropIdle(nowMs: number): void {
  for (const [sessionId, entry] of documentMemo) {
    if (nowMs - entry.readAtMs < MEMO_IDLE_MS) return;
    forget(sessionId);
  }
}
const documentValue = (documents: SessionDocuments, key: SessionDocumentKey): unknown => (Object.hasOwn(documents, key) ? documents[key] : undefined);
async function readRequiredDocument(file: string): Promise<unknown> {
  const document = await readJson(file);
  if (document === undefined) throw new CorruptJsonError(file, new Error("the document is missing although the session's state document exists"));
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
  const nowMs = Date.now();
  dropIdle(nowMs);
  const measured = await signatureOf(paths);
  const memoized = documentMemo.get(sessionId);
  if (memoized !== undefined && memoized.signature === measured.signature) {
    // A hit costs the recency update and nothing else: the entry keeps the documents it already parsed and the bytes it already counted, and moves to the newest position so that the eviction order is the read order.
    documentMemo.delete(sessionId);
    const refreshed: MemoizedDocuments = { ...memoized, readAtMs: nowMs };
    documentMemo.set(sessionId, refreshed);
    return refreshed.documents;
  }
  // The state document is the commit marker, so probing it alone answers "does this session exist?" and an absent session is refused without touching the other three documents.
  const state = await readJson(paths.state);
  if (state === undefined) {
    // A document that is absent because the whole root is absent is a store that cannot answer, not a store that holds no such session. The two are told apart here, where the absence rule lives, so that no caller has to guess and no outage is reported as a missing record.
    if (!(await existsOnDisk(DATA_ROOT))) throw new StoreAbsentError(DATA_ROOT);
    forget(sessionId);
    return undefined;
  }
  const [operations, meta, workload] = await Promise.all([readRequiredDocument(paths.operations), readRequiredDocument(paths.meta), readJson(paths.workload)]);
  const documents: SessionDocuments = { state, operations, meta };
  if (workload !== undefined) documents.workload = workload;
  remember(sessionId, { signature: measured.signature, documents, sourceBytes: measured.sourceBytes, readAtMs: nowMs });
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
/** Reads a transaction's write set, refusing a name that is not a document of this store and a document named twice; a store primitive never quietly ignores what its caller declared. */
function writeSetOf(writes: readonly SessionDocumentKey[]): ReadonlySet<SessionDocumentKey> {
  const declared = new Set<SessionDocumentKey>();
  for (const key of writes) {
    if (!DOCUMENT_KEY_NAMES.includes(key)) throw new TypeError(`A transaction's write set names ${JSON.stringify(key)}, which is not a document of this store: the documents are ${DOCUMENT_KEYS.join(", ")}.`);
    if (declared.has(key)) throw new TypeError(`A transaction's write set names the "${key}" document twice: the set states which documents a transaction may write, so a repeated document adds no second intent.`);
    declared.add(key);
  }
  return declared;
}
/** Runs one serialised read-modify-write and returns the callback's result; only a declared document whose bytes changed is written, a change to a document the write set does not declare is refused, and a throwing callback writes nothing. */
export async function transact<T>(sessionId: string, writes: readonly SessionDocumentKey[], fn: (draft: SessionDocuments) => T | Promise<T>): Promise<T> {
  const declared = writeSetOf(writes);
  return withSessionLock(sessionId, async () => {
    try {
      const current = await readSession(sessionId);
      if (current === undefined) throw new SessionNotFoundError(sessionId);
      // The callback mutates this draft, so a throw or a failed write leaves the stored documents untouched even when the callback had already changed the draft in place. Only a declared document is copied: every other one keeps the reference this transaction read, because a transaction cannot write it, and copying the generated dataset on every mutation would cost the whole of it for a write that touches none of it.
      const draft: SessionDocuments = { ...current };
      for (const key of DOCUMENT_KEYS) {
        if (!declared.has(key)) continue;
        const document = documentValue(current, key);
        if (document !== undefined) draft[key] = structuredClone(document);
      }
      const result = await fn(draft);
      // The draft carries every document, and each one the write set does not name is the very object this transaction read, so the callback must treat it as read-only. A callback that assigns another value to one is refused here rather than having its change dropped, because a silently dropped change is the one outcome a write may never have. The check compares references, not contents: comparing contents is the whole-dataset traversal the write set exists to avoid.
      for (const key of DOCUMENT_KEYS) {
        if (declared.has(key)) continue;
        if (documentValue(draft, key) !== documentValue(current, key)) throw new Error(`The transaction changed the "${key}" document, which its write set does not include: the change would never reach the disk, so it is refused rather than dropped.`);
      }
      const paths = sessionPaths(sessionId);
      // WRITE_ORDER keeps the state document last, so adding a declared key here never moves the commit marker a reader probes first.
      for (const key of WRITE_ORDER) {
        if (!declared.has(key)) continue;
        const next = documentValue(draft, key);
        if (next === undefined) {
          // A document the draft no longer carries is left on disk: deleting is `resetSession`'s job, and a transaction that silently removed a workload would destroy the dataset behind it.
          continue;
        }
        const previous = documentValue(current, key);
        // A digest is equal exactly when the two documents would serialise to the same bytes, so an unchanged document is never rewritten and no document is traversed twice to answer the question.
        if (previous !== undefined && (previous === next || canonicalDigest(previous) === canonicalDigest(next))) continue;
        await writeJsonAtomic(paths[key], next);
      }
      return result;
    } finally {
      // Dropped on every path: a read answered from this entry could otherwise serve a document the callback changed, and an undeclared document is held here by its only reference.
      forget(sessionId);
    }
  });
}
/** Makes a session's on-disk documents exactly the given set, or discards them all when no set is given; it is the store's only creating path, and repeating it leaves identical bytes. */
export async function resetSession(sessionId: string, documents?: SessionDocuments): Promise<void> {
  await withSessionLock(sessionId, async () => {
    const paths = sessionPaths(sessionId);
    if (documents === undefined) {
      // Removing the commit marker first makes the session disappear in one step; a crash after it leaves orphan documents that the next reset clears and that `readSession` never reports.
      for (const key of DELETE_ORDER) await removeIfExists(paths[key]);
      forget(sessionId);
      return;
    }
    for (const key of CORE_DOCUMENT_KEYS) {
      if (documentValue(documents, key) === undefined) throw new Error(`Cannot reset session ${JSON.stringify(sessionId)}: the document set carries no "${key}" document, and a session without its state, operations and meta documents is not a session.`);
    }
    // Trim first, so no document of the previous set survives into the new one — a stale workload left behind would make two resets of the same set write different bytes.
    for (const key of DELETE_ORDER) {
      if (documentValue(documents, key) === undefined) await removeIfExists(paths[key]);
    }
    for (const key of WRITE_ORDER) {
      const document = documentValue(documents, key);
      if (document !== undefined) await writeJsonAtomic(paths[key], document);
    }
    forget(sessionId);
  });
}
