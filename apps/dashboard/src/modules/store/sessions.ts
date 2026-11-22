/** The store's session boundary: the per-session mutex every write passes through, and the listing of the sessions that exist and are readable. */
import { InvalidSessionIdError, isSafeSessionId } from "@/lib/session-cookie";
import { CorruptJsonError, readJson } from "./atomic";
import { listSessionIds, sessionPaths } from "./paths";
const sessionLockTails = new Map<string, Promise<unknown>>();
/** Runs `fn` under the session's lock, so callbacks for one session run strictly one after another in call order while callbacks for different sessions run concurrently. */
export function withSessionLock<T>(sessionId: string, fn: () => T | Promise<T>): Promise<T> {
  if (!isSafeSessionId(sessionId)) throw new InvalidSessionIdError(sessionId);
  const previousTail = sessionLockTails.get(sessionId);
  // Chaining onto the previous tail — and, for the first caller, onto an already-resolved promise — defers `fn` to a microtask, so a callback never runs inside its caller's synchronous frame and every caller gets the same ordering guarantee.
  const result = previousTail === undefined ? Promise.resolve().then(fn) : previousTail.then(fn);
  // The tail is stored in a form that always resolves: a rejected callback then neither blocks the next waiter nor leaves an unhandled rejection behind, while the caller still observes its own rejection through `result`.
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  sessionLockTails.set(sessionId, tail);
  // Dropping the entry when the chain drains keeps the map from growing with every session id the runtime has ever seen. The identity check is what makes that safe: if a newer waiter has already replaced the tail, deleting it would let two callbacks for one session run at once.
  void tail.then(() => {
    if (sessionLockTails.get(sessionId) === tail) sessionLockTails.delete(sessionId);
  });
  return result;
}
async function readableSessionId(sessionId: string): Promise<string | undefined> {
  try {
    // Only the state document is read. The meta and workload documents add nothing to the question, and the workload document can hold a hundred thousand records.
    const state = await readJson(sessionPaths(sessionId).state);
    return state === undefined ? undefined : sessionId;
  } catch (error) {
    if (error instanceof CorruptJsonError) return undefined;
    // Every other fault is rethrown rather than disguised as an absent session, so an unreadable store cannot present itself as an empty one.
    throw error;
  }
}
/** Lists the ids of the sessions that exist and are readable, in code-unit order. */
export async function listSessions(): Promise<string[]> {
  const candidates = await listSessionIds();
  const readable = await Promise.all(candidates.map(readableSessionId));
  // Sorted here rather than inherited from discovery order, so the operator sees the same listing whatever order the directory happens to hand back.
  return readable.filter((sessionId): sessionId is string => sessionId !== undefined).toSorted();
}
