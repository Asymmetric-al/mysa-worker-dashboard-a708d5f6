import { stat } from "node:fs/promises";
import { canonicalDigest, CorruptJsonError, existsOnDisk, readJson, removeIfExists, writeJsonAtomic } from "./atomic";
import { DATA_ROOT, sessionPaths, type SessionDocumentKey, type SessionDocuments } from "./paths";
import { withSessionLock } from "./sessions";
const CORE_DOCUMENT_KEYS = ["state", "operations", "meta"] as const satisfies readonly SessionDocumentKey[];
const WRITE_ORDER = ["workload", "meta", "operations", "state"] as const satisfies readonly SessionDocumentKey[];
const DELETE_ORDER = ["state", "operations", "meta", "workload"] as const satisfies readonly SessionDocumentKey[];
const DOCUMENT_KEYS = ["state", "operations", "meta", "workload"] as const satisfies readonly SessionDocumentKey[];
const DOCUMENT_KEY_NAMES: readonly string[] = DOCUMENT_KEYS;
/** Source bytes the memo may hold across every session: four times the generated workload's own size, so the session the published measurement reads stays resident while a handful of others share the memo. */ export const MEMO_BYTE_BUDGET = 4 * 67_229_868;
/** How long the memo keeps an entry nothing has read: long enough that the reads behind one screen never re-parse, short enough that a session nobody is visiting gives its dataset back. */ export const MEMO_IDLE_MS = 10 * 60 * 1000;
/** One document as the memo holds it: the signature of the file it was parsed from, the value it parsed to and the source bytes that cost. An entry holds all four of a session's documents, an absent one as an absent value, so a session that has no workload document is not looked for one on every read. */
type HeldDocument = { readonly signature: string; readonly value: unknown; readonly sourceBytes: number };
/** One session's memo entry: the documents it holds, the set the last read answered with, and the bookkeeping the byte budget and the idle window are kept from. */ interface MemoizedSession {
  /** The set the last read answered with, kept while every document in it is still the document on disk; `undefined` once a transaction has dropped a document it declared, so the next read builds a fresh set around the documents it still holds. */ readonly container: SessionDocuments | undefined;
  readonly held: ReadonlyMap<SessionDocumentKey, HeldDocument>;
  readonly sourceBytes: number;
  readonly readAtMs: number;
}
const documentMemo = new Map<string, MemoizedSession>(); // Sessions in the order they were last read, which is the order they are dropped in: the memo is a cache in front of the disk and nothing else, so a session that is not here is answered by its files.
let memoizedBytes = 0;
type DocumentMeasurement = { readonly signature: string; readonly sourceBytes: number };
/** One document as the disk states it: its own `mtimeMs:size` signature, which is what lets a read re-parse only the document that moved, and the bytes it costs; a document the store does not hold states `-`, so its absence is a state to remember rather than a reason to look for it again. */
async function measureDocument(file: string): Promise<DocumentMeasurement> {
  try {
    const stats = await stat(file);
    return { signature: `${stats.mtimeMs}:${stats.size}`, sourceBytes: stats.size };
  } catch {
    return { signature: "-", sourceBytes: 0 };
  }
}
async function measureSession(paths: ReturnType<typeof sessionPaths>): Promise<Readonly<Record<SessionDocumentKey, DocumentMeasurement>>> {
  const [state, operations, meta, workload] = await Promise.all([measureDocument(paths.state), measureDocument(paths.operations), measureDocument(paths.meta), measureDocument(paths.workload)]);
  return { state, operations, meta, workload };
}
/** Whether every document the entry holds is still the document the disk states: one comparison per document, because a write of one says nothing about the other three. */
const holdsCurrentDocuments = (held: ReadonlyMap<SessionDocumentKey, HeldDocument>, measured: Readonly<Record<SessionDocumentKey, DocumentMeasurement>>): boolean => DOCUMENT_KEYS.every((key) => held.get(key)?.signature === measured[key].signature);
/** Drops one session's entry and its bytes from the total, so the bound is maintained incrementally rather than re-measured from the entries. */ function forget(sessionId: string): void {
  const forgotten = documentMemo.get(sessionId);
  if (forgotten === undefined) return;
  memoizedBytes -= forgotten.sourceBytes;
  documentMemo.delete(sessionId);
}
/** Records a session's entry as the newest, then drops the least recently read entries until the total is inside the budget. */ function remember(sessionId: string, entry: MemoizedSession): void {
  forget(sessionId);
  documentMemo.set(sessionId, entry);
  memoizedBytes += entry.sourceBytes;
  for (const [candidateId, candidate] of documentMemo) {
    if (memoizedBytes <= MEMO_BYTE_BUDGET || candidateId === sessionId) break; // The entry this call inserted is the newest, so the scan reaches it last and a session larger than the whole budget is kept rather than evicting every entry and then itself.
    memoizedBytes -= candidate.sourceBytes;
    documentMemo.delete(candidateId);
  }
}
/** Drops every entry nothing has read within the idle window; the map is kept in read order, so the first entry still inside the window ends the scan. */ function dropIdle(nowMs: number): void {
  for (const [sessionId, entry] of documentMemo) {
    if (nowMs - entry.readAtMs < MEMO_IDLE_MS) return;
    forget(sessionId);
  }
}
/** Drops the documents a transaction declared and keeps the ones it could not write, because the parsed dataset behind a write that never touches it is the whole of what the memo is for. The set goes with them, so the next read builds a fresh one from the documents this entry still holds and the documents it reads again. */
function forgetDocuments(sessionId: string, keys: ReadonlySet<SessionDocumentKey>): void {
  const remembered = documentMemo.get(sessionId);
  if (remembered === undefined) return;
  const held = new Map(remembered.held);
  let sourceBytes = remembered.sourceBytes;
  for (const key of keys) {
    const dropped = held.get(key);
    if (dropped === undefined) continue;
    held.delete(key);
    sourceBytes -= dropped.sourceBytes;
  }
  memoizedBytes -= remembered.sourceBytes;
  documentMemo.set(sessionId, { ...remembered, container: undefined, held, sourceBytes }); // Replaced in place, not re-inserted: a transaction that read the session is not a later read of it, so the eviction order still follows the reads.
  memoizedBytes += sourceBytes;
}
const documentValue = (documents: SessionDocuments, key: SessionDocumentKey): unknown => (Object.hasOwn(documents, key) ? documents[key] : undefined);
async function readRequiredDocument(file: string): Promise<unknown> {
  const document = await readJson(file);
  if (document === undefined) throw new CorruptJsonError(file, new Error("the document is missing although the session's state document exists"));
  return document;
}
/** Raised when the store root itself is absent, so no session can be read from it. */ export class StoreAbsentError extends Error {
  readonly code = "ENOENT" as const;
  readonly root: string;
  constructor(root: string) {
    super(`The store root ${root} does not exist, so no session can be read from it.`);
    this.name = "StoreAbsentError";
    this.root = root;
  }
}
/** Reads a session's documents, or `undefined` when the store holds no such session; a corrupt document throws rather than reading as empty, an absent store root throws {@link. */ export async function readSession(sessionId: string): Promise<SessionDocuments | undefined> {
  const paths = sessionPaths(sessionId);
  const nowMs = Date.now();
  dropIdle(nowMs);
  const measured = await measureSession(paths);
  const memoized = documentMemo.get(sessionId);
  if (memoized !== undefined && memoized.container !== undefined && holdsCurrentDocuments(memoized.held, measured)) {
    remember(sessionId, { ...memoized, readAtMs: nowMs }); // A hit costs the recency update and nothing else: the entry keeps the documents it already parsed and the bytes it already counted, answers with the very set the previous read answered with, and moves to the newest position so the eviction order is the read order.
    return memoized.container;
  }
  // The document this read already holds, or nothing when its own signature moved and the file has to be read again.
  const heldDocument = (key: SessionDocumentKey): HeldDocument | undefined => {
    const held = memoized?.held.get(key);
    return held !== undefined && held.signature === measured[key].signature ? held : undefined;
  };
  const heldState = heldDocument("state");
  const state = heldState === undefined ? await readJson(paths.state) : heldState.value;
  if (state === undefined) {
    if (!(await existsOnDisk(DATA_ROOT))) throw new StoreAbsentError(DATA_ROOT);
    forget(sessionId);
    return undefined;
  }
  const heldOperations = heldDocument("operations");
  const operations = heldOperations === undefined ? await readRequiredDocument(paths.operations) : heldOperations.value;
  const heldMeta = heldDocument("meta");
  const meta = heldMeta === undefined ? await readRequiredDocument(paths.meta) : heldMeta.value;
  const heldWorkload = heldDocument("workload");
  const workload = heldWorkload === undefined ? await readJson(paths.workload) : heldWorkload.value;
  const documents: SessionDocuments = { state, operations, meta }; // The set is built around the values this read holds, so a document it did not re-parse is the very object the previous set carried, and a transaction's reference check on an undeclared document still recognises it.
  if (workload !== undefined) documents.workload = workload;
  const held = new Map<SessionDocumentKey, HeldDocument>();
  let sourceBytes = 0;
  for (const key of DOCUMENT_KEYS) {
    held.set(key, { signature: measured[key].signature, value: documentValue(documents, key), sourceBytes: measured[key].sourceBytes });
    sourceBytes += measured[key].sourceBytes;
  }
  remember(sessionId, { container: documents, held, sourceBytes, readAtMs: nowMs });
  return documents;
}
/** Refusal raised by `transact` for a session the store does not hold, which it never creates. */ export class SessionNotFoundError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`No session ${JSON.stringify(sessionId)} exists in the store, and a transaction never creates one.`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}
/** Reads a transaction's write set, refusing a name that is not a document of this store and a document named twice; a store primitive never quietly ignores what its caller declared. */ function writeSetOf(writes: readonly SessionDocumentKey[]): ReadonlySet<SessionDocumentKey> {
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
      const draft: SessionDocuments = { ...current }; // Only a declared document is copied: every other one keeps the reference this transaction read, because a transaction cannot write it and copying the generated dataset on a mutation that touches none of it would cost the whole of it.
      for (const key of DOCUMENT_KEYS) if (declared.has(key)) draft[key] = structuredClone(documentValue(current, key));
      const result = await fn(draft);
      // Each undeclared document is the very object this transaction read, so a callback that assigns another value to one is refused here rather than having its change dropped; the check compares references, never contents, which is the whole-dataset traversal the write set exists to avoid.
      for (const key of DOCUMENT_KEYS) if (!declared.has(key) && documentValue(draft, key) !== documentValue(current, key)) throw new Error(`The transaction changed the "${key}" document, which its write set does not include: the change would never reach the disk, so it is refused rather than dropped.`);
      const paths = sessionPaths(sessionId);
      // WRITE_ORDER keeps the state document last, so a declared key added here never moves the commit marker a reader probes first.
      for (const key of WRITE_ORDER) {
        if (!declared.has(key)) continue;
        const next = documentValue(draft, key);
        if (next === undefined) continue; // A document the draft no longer carries is left on disk: deleting is `resetSession`'s job, and a transaction that silently removed a workload would destroy the dataset behind it.
        const previous = documentValue(current, key);
        if (previous !== undefined && (previous === next || canonicalDigest(previous) === canonicalDigest(next))) continue; // A digest is equal exactly when the two documents would serialise to the same bytes, so an unchanged document is never rewritten and no document is compared as two printed copies.
        await writeJsonAtomic(paths[key], next);
      }
      return result;
    } finally {
      forgetDocuments(sessionId, declared); // Dropped on every path, and only for the documents this transaction declared: a read answered from this entry could otherwise serve a document the callback changed, while a document the write set excludes is still the very one on disk and keeps its parse.
    }
  });
}
/** Makes a session's on-disk documents exactly the given set, or discards them all when no set is given; it is the store's only creating path, and repeating it leaves identical bytes. */ export async function resetSession(sessionId: string, documents?: SessionDocuments): Promise<void> {
  await withSessionLock(sessionId, async () => {
    const paths = sessionPaths(sessionId);
    if (documents === undefined) {
      for (const key of DELETE_ORDER) await removeIfExists(paths[key]);
      forget(sessionId);
      return;
    }
    for (const key of CORE_DOCUMENT_KEYS) if (documentValue(documents, key) === undefined) throw new Error(`Cannot reset session ${JSON.stringify(sessionId)}: the document set carries no "${key}" document, and a session without its state, operations and meta documents is not a session.`);
    for (const key of DELETE_ORDER) if (documentValue(documents, key) === undefined) await removeIfExists(paths[key]);
    for (const key of WRITE_ORDER) {
      const document = documentValue(documents, key);
      if (document !== undefined) await writeJsonAtomic(paths[key], document);
    }
    forget(sessionId);
  });
}
