/** The development-session cookie's one declaration: the name it travels under, the session-id grammar its value must satisfy, the refusal a value that cannot be one earns, and the reader that answers an id or nothing. The store imports the grammar because a session id names a file as well as a cookie, so no transport has to reach the store for it. */
export const SESSION_COOKIE = "dashboard_session";
/**
 * The one grant of that cookie: httpOnly, `sameSite=lax`, the root path and a year's life, so no script reads the
 * identity and no cross-site navigation spends it. It lives beside the name because the two are one fact — which
 * cookie carries the session and how it is handed over — and both the request-level proxy and the development
 * control that switches the identity grant it through this one declaration.
 */
export const SESSION_COOKIE_GRANT = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60 } as const;
const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
function describeSessionIdValue(value: unknown): string {
  if (typeof value === "string") return value.length <= 40 ? JSON.stringify(value) : `a ${String(value.length)}-character string`;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}
/** Refusal raised when a value cannot be used as a session id; it is never repaired into one. */
export class InvalidSessionIdError extends Error {
  readonly sessionId: unknown;
  constructor(sessionId: unknown) {
    super(`Cannot use ${describeSessionIdValue(sessionId)} as a session id: a session id must be 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`);
    this.name = "InvalidSessionIdError";
    this.sessionId = sessionId;
  }
}
export function isSafeSessionId(value: unknown): boolean {
  return typeof value === "string" && SAFE_SESSION_ID_PATTERN.test(value);
}
export function readSessionId(cookieValue: string | undefined | null): string | undefined {
  if (typeof cookieValue !== "string") return undefined;
  // `isSafeSessionId` already rejects "" and any value longer than 64 characters, along with everything outside A-Z, a-z, 0-9, underscore and hyphen.
  return isSafeSessionId(cookieValue) ? cookieValue : undefined;
}
