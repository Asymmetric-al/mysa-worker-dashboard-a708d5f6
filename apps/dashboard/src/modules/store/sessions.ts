/**
 * The store's session boundary: the development-session cookie, the validator in front of its
 * value, the per-session mutex every write passes through, and the operator listing of the
 * sessions that exist on disk.
 *
 * Contract (AAP 0.7.2). A session id arrives in an `httpOnly`, `sameSite=lax` development cookie;
 * a session sees only its own files; writes for one session are serialised by an in-process async
 * mutex keyed by session id — the stated concurrency boundary, with one Node process assumed — and
 * an absent or unknown session is refused rather than invented, because production behaviour never
 * falls back to fixtures. It is a development cookie and not an authentication system (AAP 0.3.3):
 * no credential, token, signature, expiry protocol, refresh flow or identity provider appears here.
 *
 * Rules this module holds to.
 * - The session-id safety rule is `paths.ts`'s `isSafeSessionId`; this file never restates it, so a
 *   cookie value cannot be accepted by one copy of the rule and refused by another.
 * - `atomic.ts` owns every document read: `listSessions` reads through `readJson`, and this module
 *   never opens, creates, writes or deletes a file, which leaves `repository.ts` the only writer.
 * - One acquisition per operation. `repository.transact` takes the lock exactly once around a whole
 *   read-modify-write; a second acquisition for the same session inside that callback would wait on
 *   itself. Nesting is therefore a programming error rather than a case to handle: there is
 *   deliberately no re-entrant lock, no timeout, no retry and no backoff.
 * - Nothing here reads a clock or schedules anything, and nothing listens to the filesystem: the
 *   store persists without listeners, and a lock has no deadline, because a deadline would be a
 *   guess at a failure this runtime does not model.
 */
import { CorruptJsonError, readJson } from "./atomic";
import { InvalidSessionIdError, isSafeSessionId, listSessionIds, sessionPaths } from "./paths";

/**
 * Name of the development-session cookie, defined once for the whole repository: the Route Handlers,
 * `src/proxy.ts` and `data-service/authorize.ts` import it instead of repeating the literal. Its
 * attributes (`httpOnly`, `sameSite: "lax"`, `path: "/"`) belong to the HTTP response and stay with
 * the response layer that mints it, which keeps this module request-agnostic.
 */
export const SESSION_COOKIE = "dashboard_session";

/**
 * Reads a session id from a cookie value: the value itself when it may name a session, otherwise
 * `undefined`. It never throws — the session resolver runs on every request, and a hostile, stale or
 * absent cookie must read as "no session" so the caller can refuse the request honestly instead of
 * failing with a server error. The value is returned verbatim: no trimming, case-folding or
 * percent-decoding, and no header parsing either, both of which are the route layer's job.
 */
export function readSessionId(cookieValue: string | undefined | null): string | undefined {
  if (typeof cookieValue !== "string") {
    return undefined;
  }
  // `isSafeSessionId` already rejects "" and any value longer than 64 characters, along with
  // everything outside A-Z, a-z, 0-9, underscore and hyphen.
  return isSafeSessionId(cookieValue) ? cookieValue : undefined;
}

/**
 * The pending tail of each session's lock chain, in its settled form. Only sessions with an
 * acquisition in flight appear, and an entry is removed once its chain drains.
 */
const sessionLockTails = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` under the session's lock, so callbacks for one session run strictly one after another in
 * call order while callbacks for different sessions run concurrently. The mutex is per session on
 * purpose: two browser contexts in different scenarios must never block each other.
 *
 * The caller's promise settles with `fn`'s outcome, rejection included, and the next waiter starts
 * once that outcome is known — a failed mutation releases the lock rather than wedging the session.
 * An id that could name no session is refused with `InvalidSessionIdError` before anything is
 * enqueued, so a bad cookie can never create an entry.
 */
export function withSessionLock<T>(sessionId: string, fn: () => T | Promise<T>): Promise<T> {
  if (!isSafeSessionId(sessionId)) {
    throw new InvalidSessionIdError(sessionId);
  }

  const previousTail = sessionLockTails.get(sessionId);
  // Chaining onto the previous tail — and, for the first caller, onto an already-resolved promise —
  // defers `fn` to a microtask, so a callback never runs inside its caller's synchronous frame and
  // every caller gets the same ordering guarantee.
  const result = previousTail === undefined ? Promise.resolve().then(fn) : previousTail.then(fn);

  // The tail is stored in a form that always resolves: a rejected callback then neither blocks the
  // next waiter nor leaves an unhandled rejection behind, while the caller still observes its own
  // rejection through `result`.
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  sessionLockTails.set(sessionId, tail);

  // Dropping the entry when the chain drains keeps the map from growing with every session id the
  // runtime has ever seen. The identity check is what makes that safe: if a newer waiter has already
  // replaced the tail, deleting it would let two callbacks for one session run at once.
  void tail.then(() => {
    if (sessionLockTails.get(sessionId) === tail) {
      sessionLockTails.delete(sessionId);
    }
  });

  return result;
}

/**
 * Returns the id when that session's state document is present and decodable, which is all the
 * listing needs to decide that the session exists, and `undefined` when it is missing or corrupt.
 * Corrupt bytes drop the session from the listing instead of failing it: the listing is an operator
 * view over many sessions, while a session addressed directly still surfaces its corruption through
 * `repository.readSession`.
 */
async function readableSessionId(sessionId: string): Promise<string | undefined> {
  try {
    // Only the state document is read. The meta and workload documents add nothing to the question,
    // and the workload document can hold a hundred thousand records.
    const state = await readJson(sessionPaths(sessionId).state);
    return state === undefined ? undefined : sessionId;
  } catch (error) {
    if (error instanceof CorruptJsonError) {
      return undefined;
    }
    // Every other fault is rethrown rather than disguised as an absent session, so an unreadable
    // store cannot present itself as an empty one.
    throw error;
  }
}

/**
 * Lists the ids of the sessions that exist and are readable, in code-unit order. It creates,
 * repairs and deletes nothing, so calling it is safe on a store that was never seeded.
 */
export async function listSessions(): Promise<string[]> {
  const candidates = await listSessionIds();
  const readable = await Promise.all(candidates.map(readableSessionId));
  // Sorted here rather than inherited from discovery order, so the operator sees the same listing
  // whatever order the directory happens to hand back.
  return readable.filter((sessionId): sessionId is string => sessionId !== undefined).toSorted();
}
