/** The development-session cookie's one declaration: the name it travels under, the session-id grammar its value must satisfy, the refusal a value that cannot be one earns, and the reader that answers an id or nothing. The store imports the grammar because a session id names a file as well as a cookie, so no transport has to reach the store for it. */
export const SESSION_COOKIE = "dashboard_session";
/** The one grant of that cookie: httpOnly, `sameSite=lax`, the root path and a year's life, so no script reads the identity and no cross-site navigation spends it. It lives beside the name because the two are one fact — which cookie carries the session and how it is handed over — and both the request-level proxy and the development control that switches the identity grant it through this one declaration. */
export const SESSION_COOKIE_GRANT = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60 } as const;
const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const describeSessionIdValue = (value: unknown): string => (typeof value === "string" ? (value.length <= 40 ? JSON.stringify(value) : `a ${String(value.length)}-character string`) : value === null ? "null" : value === undefined ? "undefined" : typeof value === "object" ? "an object" : `a ${typeof value}`);
/** Refusal raised when a value cannot be used as a session id; it is never repaired into one. */ export class InvalidSessionIdError extends Error {
  readonly sessionId: unknown;
  constructor(sessionId: unknown) {
    super(`Cannot use ${describeSessionIdValue(sessionId)} as a session id: a session id must be 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`);
    this.name = "InvalidSessionIdError";
    this.sessionId = sessionId;
  }
}
export const isSafeSessionId = (value: unknown): boolean => typeof value === "string" && SAFE_SESSION_ID_PATTERN.test(value);
/** The session id the request carries, or nothing: a value that cannot be one is answered as no session rather than repaired into one. `isSafeSessionId` already rejects "" and any value longer than 64 characters, along with everything outside A-Z, a-z, 0-9, underscore and hyphen. */
export const readSessionId = (cookieValue: string | undefined | null): string | undefined => (typeof cookieValue !== "string" ? undefined : isSafeSessionId(cookieValue) ? cookieValue : undefined);
