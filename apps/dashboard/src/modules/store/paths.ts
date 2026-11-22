import { existsSync, promises as fsPromises, type Dirent } from "node:fs";
import * as path from "node:path";
import { InvalidSessionIdError, isSafeSessionId } from "@/lib/session-cookie";
const REPOSITORY_ROOT_MARKERS: readonly string[] = ["turbo.json", "bun.lock", ".git"];
function findRepositoryRoot(startDirectory: string): string {
  let currentDirectory = path.resolve(startDirectory);
  for (;;) {
    for (const marker of REPOSITORY_ROOT_MARKERS) {
      // What this search looks for is the workspace root that the store's runtime directory sits beside, and neither the directory nor its contents belong in a server bundle. Turbopack cannot bound a path built from the process directory, so it would otherwise trace the whole project into the server output and report
      // both call sites as dynamic filesystem access; the directive keeps that inference off a path that has nothing to contribute to it.
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
/** Contents of a session's documents, opaque to the store: `state`, `operations` and `meta` are the three core documents and `workload` exists only once the large dataset has been generated. */
export type SessionDocuments = { state: unknown; operations: unknown; meta: unknown; workload?: unknown };
const SESSION_DOCUMENT_SUFFIX: Readonly<Record<SessionDocumentKey, string>> = { state: ".state.json", operations: ".operations.json", meta: ".meta.json", workload: ".workload.json" };
const SESSION_DOCUMENT_SUFFIXES: readonly string[] = Object.values(SESSION_DOCUMENT_SUFFIX);
export function sessionPaths(sessionId: string): SessionPaths {
  if (!isSafeSessionId(sessionId)) throw new InvalidSessionIdError(sessionId);
  return { state: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.state), operations: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.operations), meta: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.meta), workload: path.join(DATA_ROOT, sessionId + SESSION_DOCUMENT_SUFFIX.workload) };
}
function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && Reflect.get(error, "code") === code;
}
export async function listSessionIds(): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fsPromises.readdir(DATA_ROOT, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
  const sessionIds = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const documentSuffix = SESSION_DOCUMENT_SUFFIXES.find((suffix) => entry.name.endsWith(suffix));
    if (documentSuffix === undefined) continue;
    const sessionId = entry.name.slice(0, -documentSuffix.length);
    if (isSafeSessionId(sessionId)) sessionIds.add(sessionId);
  }
  // Code-unit order keeps two runs and two machines in agreement; ids never need locale collation.
  return [...sessionIds].sort();
}
