import { existsSync, promises as fsPromises, type Dirent } from "node:fs";
import * as path from "node:path";

/**
 * File names that identify the repository root when walking up from the working directory.
 *
 * Order matters: the workspace marker is checked before the lockfile marker, which is checked
 * before the version-control marker, so a nested checkout cannot be mistaken for the root.
 */
const REPOSITORY_ROOT_MARKERS: readonly string[] = ["turbo.json", "bun.lock", ".git"];

/**
 * Locates the repository root by walking up from `startDirectory` to the filesystem root.
 *
 * Next and Turbo run tasks with the working directory set to the application package, so the
 * store would otherwise land in `apps/dashboard/.data`. Refusing to fall back to the working
 * directory, a temporary directory or a home directory is deliberate: persisting outside the
 * repository is the failure this walk exists to prevent.
 */
function findRepositoryRoot(startDirectory: string): string {
  let currentDirectory = path.resolve(startDirectory);

  for (;;) {
    for (const marker of REPOSITORY_ROOT_MARKERS) {
      if (existsSync(path.join(currentDirectory, marker))) {
        return currentDirectory;
      }
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(
        `Cannot locate the repository root from "${startDirectory}": no directory up to the filesystem root contains any of ${REPOSITORY_ROOT_MARKERS.join(", ")}.`,
      );
    }

    currentDirectory = parentDirectory;
  }
}

/** Absolute path of the synthetic store directory at the repository root; importing this module creates nothing. */
export const DATA_ROOT: string = path.resolve(findRepositoryRoot(process.cwd()), ".data");

/**
 * The single session-id safety rule: a session id reaches this module from a cookie and becomes a
 * file name, so it is refused unless it is 1 to 64 characters of A-Z, a-z, 0-9, underscore or
 * hyphen. The pattern admits no dot, separator, percent escape, whitespace or control character.
 */
const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Documents a session owns, keyed by the part of the store each one holds. */
export type SessionDocumentKey = "state" | "operations" | "meta" | "workload";

/** Absolute path of each of a session's four documents. */
export interface SessionPaths {
  state: string;
  operations: string;
  meta: string;
  workload: string;
}

/**
 * Contents of a session's documents, opaque to the store: `state`, `operations` and `meta` are the
 * three core documents and `workload` exists only once the large dataset has been generated.
 */
export interface SessionDocuments {
  state: unknown;
  operations: unknown;
  meta: unknown;
  workload?: unknown;
}

/** Suffix of each session document, single-sourced so the four file names cannot drift between callers. */
const SESSION_DOCUMENT_SUFFIX: Readonly<Record<SessionDocumentKey, string>> = {
  state: ".state.json",
  operations: ".operations.json",
  meta: ".meta.json",
  workload: ".workload.json",
};

/** Describes a refused session id for a message: JSON quoting escapes control characters, and a long value is summarized rather than echoed. */
function describeSessionIdValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length <= 40
      ? JSON.stringify(value)
      : `a ${String(value.length)}-character string`;
  }
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/** Refusal raised when a value cannot be used as a session id; it is never repaired into one. */
export class InvalidSessionIdError extends Error {
  /** The refused value, exactly as the caller supplied it. */
  readonly sessionId: unknown;

  constructor(sessionId: unknown) {
    super(
      `Cannot use ${describeSessionIdValue(sessionId)} as a session id: a session id must be 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`,
    );
    this.name = "InvalidSessionIdError";
    this.sessionId = sessionId;
  }
}

/** Reports whether a value may be used as a session id, without trimming, repairing or case-folding it. */
export function isSafeSessionId(value: unknown): boolean {
  return typeof value === "string" && SAFE_SESSION_ID_PATTERN.test(value);
}

/** Returns the four absolute document paths of a session, or throws for an id that is unsafe as a file name. */
export function sessionPaths(sessionId: string): SessionPaths {
  if (!isSafeSessionId(sessionId)) {
    throw new InvalidSessionIdError(sessionId);
  }

  return {
    state: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.state),
    operations: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.operations),
    meta: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.meta),
    workload: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.workload),
  };
}

/** Reports whether a caught value carries the given system error code. */
function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && Reflect.get(error, "code") === code;
}

/**
 * Lists the ids of the sessions present in the store.
 *
 * An absent store is a fresh checkout, so it reads as an empty list; every other read fault is
 * rethrown rather than disguised as an empty store. Files that are not a session's state document
 * — the sibling documents, an interrupted `*.tmp` write, a stray directory — are never sessions.
 */
export async function listSessionIds(): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fsPromises.readdir(DATA_ROOT, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const stateSuffix = SESSION_DOCUMENT_SUFFIX.state;
  const sessionIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(stateSuffix)) {
      continue;
    }

    const sessionId = entry.name.slice(0, -stateSuffix.length);
    if (isSafeSessionId(sessionId)) {
      sessionIds.push(sessionId);
    }
  }

  // Code-unit order keeps two runs and two machines in agreement; ids never need locale collation.
  return sessionIds.sort();
}
