import { InvalidSessionIdError, isSafeSessionId } from "@/lib/session-cookie";
const sessionLockTails = new Map<string, Promise<unknown>>();
/** Runs `fn` under the session's lock, so callbacks for one session run strictly one after another in call order while callbacks for different sessions run concurrently. */ export function withSessionLock<T>(sessionId: string, fn: () => T | Promise<T>): Promise<T> {
  if (!isSafeSessionId(sessionId)) throw new InvalidSessionIdError(sessionId);
  const previousTail = sessionLockTails.get(sessionId);
  const result = previousTail === undefined ? Promise.resolve().then(fn) : previousTail.then(fn);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  sessionLockTails.set(sessionId, tail);
  void tail.then(() => {
    if (sessionLockTails.get(sessionId) === tail) sessionLockTails.delete(sessionId);
  });
  return result;
}
