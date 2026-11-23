import { existsSync, promises as fsPromises, type Dirent } from "node:fs";
import * as path from "node:path";
const REPOSITORY_ROOT_MARKERS: readonly string[] = ["turbo.json", "bun.lock", ".git"];
function findRepositoryRoot(startDirectory: string): string {
  let currentDirectory = path.resolve(startDirectory);
  for (;;) {
    for (const marker of REPOSITORY_ROOT_MARKERS) {
      // The workspace root this search finds sits beside the store's runtime directory and contributes nothing to a server bundle, so turbopackIgnore keeps Turbopack from tracing the whole project in behind a path built from the process directory.
      if (existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ currentDirectory, marker))) return currentDirectory;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) throw new Error(`Cannot locate the repository root from "${startDirectory}": no directory up to the filesystem root contains any of ${REPOSITORY_ROOT_MARKERS.join(", ")}.`);
    currentDirectory = parentDirectory;
  }
}
export const DATA_ROOT: string = path.resolve(findRepositoryRoot(process.cwd()), ".data");
const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export type SessionDocumentKey = "state" | "operations" | "meta" | "workload";
export type SessionPaths = { state: string; operations: string; meta: string; workload: string };
export type SessionDocuments = { state: unknown; operations: unknown; meta: unknown; workload?: unknown };
const SESSION_DOCUMENT_SUFFIX: Readonly<Record<SessionDocumentKey, string>> = { state: ".state.json", operations: ".operations.json", meta: ".meta.json", workload: ".workload.json" };
const SESSION_DOCUMENT_SUFFIXES: readonly string[] = Object.values(SESSION_DOCUMENT_SUFFIX);
const describeSessionIdValue = (value: unknown): string => (typeof value === "string" ? (value.length <= 40 ? JSON.stringify(value) : `a ${String(value.length)}-character string`) : value === null ? "null" : value === undefined ? "undefined" : typeof value === "object" ? "an object" : `a ${typeof value}`);
/** Refusal raised when a value cannot be used as a session id; it is never repaired into one. */
export class InvalidSessionIdError extends Error {
  readonly sessionId: unknown;
  constructor(sessionId: unknown) {
    super(`Cannot use ${describeSessionIdValue(sessionId)} as a session id: a session id must be 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`);
    this.name = "InvalidSessionIdError";
    this.sessionId = sessionId;
  }
}
export const isSafeSessionId = (value: unknown): boolean => typeof value === "string" && SAFE_SESSION_ID_PATTERN.test(value);
export function sessionPaths(sessionId: string): SessionPaths {
  if (!isSafeSessionId(sessionId)) throw new InvalidSessionIdError(sessionId);
  return { state: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.state), operations: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.operations), meta: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.meta), workload: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.workload) };
}
const hasErrorCode = (error: unknown, code: string): boolean => error instanceof Error && Reflect.get(error, "code") === code;
export async function listSessionIds(): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fsPromises.readdir(DATA_ROOT, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
  const sessionIds = entries.flatMap((entry) => {
    const documentSuffix = entry.isFile() ? SESSION_DOCUMENT_SUFFIXES.find((suffix) => entry.name.endsWith(suffix)) : undefined;
    const sessionId = documentSuffix === undefined ? "" : entry.name.slice(0, -documentSuffix.length);
    return isSafeSessionId(sessionId) ? [sessionId] : [];
  });
  return [...new Set(sessionIds)].sort();
}
