/**
 * The store's read, transaction and reset surface: `readSession` returns a session's document set,
 * `transact` runs one serialised read-modify-write, and `resetSession` lays down an exactly specified
 * set or discards the session's documents. This is the only module that decides which session
 * document is written or deleted; `atomic.ts` owns the filesystem mechanism and `sessions.ts` owns the
 * per-session lock.
 *
 * Every document value is opaque here: `state`, `operations` and `meta` are `unknown` to the store,
 * because the record shapes and schemas behind them belong to `data-service`. A store that validated
 * records could not be replaced behind that layer without a view changing.
 *
 * One transaction takes the session's lock once, hands a deep copy to the callback and writes back
 * only the documents whose canonical bytes changed, in the order `workload`, `meta`, `operations`,
 * `state`. `.state.json` lands last and its presence is what makes a document set a session, so an
 * interrupted transaction leaves a session that still reads as its previous complete state; a reader
 * takes no lock because each rename publishes a whole document. A throwing callback writes nothing.
 * Nothing here invents a session, reads a clock, listens for changes or keeps a document in memory.
 */
import {
  CorruptJsonError,
  existsOnDisk,
  readJson,
  removeIfExists,
  serialiseJson,
  writeJsonAtomic,
} from "./atomic";
import {
  DATA_ROOT,
  sessionPaths,
  type SessionDocumentKey,
  type SessionDocuments,
} from "./paths";
import { withSessionLock } from "./sessions";

/** The documents every session owns: a set without any of them is an incomplete write, not a session. */
const CORE_DOCUMENT_KEYS = [
  "state",
  "operations",
  "meta",
] as const satisfies readonly SessionDocumentKey[];

/** Write order: the commit marker is written last and every other document before it. */
const WRITE_ORDER = [
  "workload",
  "meta",
  "operations",
  "state",
] as const satisfies readonly SessionDocumentKey[];

/** Delete order: the commit marker goes first, so a session disappears in one step. */
const DELETE_ORDER = [
  "state",
  "operations",
  "meta",
  "workload",
] as const satisfies readonly SessionDocumentKey[];

/**
 * Returns the value a document set carries for one document, or `undefined` when the set does not
 * provide it. A provided `null` is a value; only an absent key or an explicit `undefined` counts as
 * "not provided", which is the same distinction `JSON.stringify` draws when it drops a member.
 */
function documentValue(documents: SessionDocuments, key: SessionDocumentKey): unknown {
  return Object.hasOwn(documents, key) ? documents[key] : undefined;
}

/**
 * Reads a document whose absence makes the session incomplete rather than absent. The state document
 * is already on disk, so a missing ledger or scenario document is reported as corruption instead of
 * being replaced by an empty default: reporting `{ operations: {} }` would silently reset an operation
 * ledger, which is the opposite of recovering every acceptance by operation identity.
 */
async function readRequiredDocument(file: string): Promise<unknown> {
  const document = await readJson(file);
  if (document === undefined) {
    throw new CorruptJsonError(
      file,
      new Error("the document is missing although the session's state document exists"),
    );
  }
  return document;
}

/**
 * Raised when the store root itself is absent, so no session can be read from it.
 *
 * It is the outage the store answers with instead of "no such session": a directory that is not there
 * cannot state whether it holds a session, and reporting the absence of a record for it would present a
 * store that could not answer as a session that does not exist. `code` states the filesystem fact it
 * reports — the `ENOENT` the operating system itself raises — so the data service's existing
 * filesystem-fault mapping recognises the store's own medium without importing the store, and `root`
 * names the directory for the operator, in a message that never reaches an outcome.
 */
export class StoreAbsentError extends Error {
  /** The filesystem fact this error reports: the store root does not exist. */
  readonly code = "ENOENT" as const;

  /** The store root that was not found; stated in the message, never in an outcome. */
  readonly root: string;

  constructor(root: string) {
    super(`The store root ${root} does not exist, so no session can be read from it.`);
    this.name = "StoreAbsentError";
    this.root = root;
  }
}

/**
 * Reads a session's documents, or `undefined` when the store holds no such session; a corrupt
 * document throws rather than reading as empty, an absent store root throws {@link StoreAbsentError}
 * rather than reading as an absent session, and no lock is taken because each document is published by
 * an atomic rename.
 */
export async function readSession(sessionId: string): Promise<SessionDocuments | undefined> {
  const paths = sessionPaths(sessionId);

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
    return undefined;
  }

  const [operations, meta, workload] = await Promise.all([
    readRequiredDocument(paths.operations),
    readRequiredDocument(paths.meta),
    readJson(paths.workload),
  ]);

  const documents: SessionDocuments = { state, operations, meta };
  if (workload !== undefined) {
    documents.workload = workload;
  }
  return documents;
}

/** Refusal raised by `transact` for a session the store does not hold, which it never creates. */
export class SessionNotFoundError extends Error {
  /** The session id that named no session. */
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(
      `No session ${JSON.stringify(sessionId)} exists in the store, and a transaction never creates one.`,
    );
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}

/**
 * Runs one serialised read-modify-write and returns the callback's result; only the documents whose
 * bytes changed are written, and a throwing callback writes nothing.
 */
export async function transact<T>(
  sessionId: string,
  fn: (draft: SessionDocuments) => T | Promise<T>,
): Promise<T> {
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

    return result;
  });
}

/**
 * Makes a session's on-disk documents exactly the given set, or discards them all when no set is
 * given; it is the store's only creating path, and repeating it leaves identical bytes.
 */
export async function resetSession(sessionId: string, documents?: SessionDocuments): Promise<void> {
  await withSessionLock(sessionId, async () => {
    const paths = sessionPaths(sessionId);

    if (documents === undefined) {
      // Removing the commit marker first makes the session disappear in one step; a crash after it
      // leaves orphan documents that the next reset clears and that `readSession` never reports.
      for (const key of DELETE_ORDER) {
        await removeIfExists(paths[key]);
      }
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
  });
}
