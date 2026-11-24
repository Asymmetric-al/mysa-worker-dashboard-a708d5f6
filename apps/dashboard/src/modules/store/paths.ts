import { existsSync, promises as fsPromises, type Dirent } from "node:fs";
import * as path from "node:path";
import { InvalidSessionIdError, isSafeSessionId } from "@/lib/session-cookie";
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
export type SessionDocumentKey = "state" | "operations" | "meta" | "workload";
export type SessionPaths = { state: string; operations: string; meta: string; workload: string };
export type SessionDocuments = { state: unknown; operations: unknown; meta: unknown; workload?: unknown };
const SESSION_DOCUMENT_SUFFIX: Readonly<Record<SessionDocumentKey, string>> = { state: ".state.json", operations: ".operations.json", meta: ".meta.json", workload: ".workload.json" };
const SESSION_DOCUMENT_SUFFIXES: readonly string[] = Object.values(SESSION_DOCUMENT_SUFFIX);
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
