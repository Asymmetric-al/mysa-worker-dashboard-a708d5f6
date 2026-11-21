/**
 * The transport layer's one declaration of the development-session cookie.
 *
 * `modules/store/sessions.ts` owns the cookie and `data-service/authorize.ts` is the only module allowed
 * to import it: a Route Handler reaches the data service and nothing deeper, and the lint configuration
 * fails a `src/app/**` import of the store rather than leaving it to review. The content mutations take
 * the session they act for — `(sessionId, input)` — so a handler has to forward the value the browser
 * already sent, and this module is where that wire name lives: once, for every handler that needs it.
 *
 * Forwarding the value grants nothing. What it means, whether it names a session and what that session
 * may do are the service's questions, and the service resolves the request's own cookie itself: an id
 * that does not match it is refused as `not-admitted`, and an absent cookie is forwarded as the empty
 * string, which names no session at all.
 */
import type { NextRequest } from "next/server";

/** The cookie name the development session travels under. */
export const SESSION_COOKIE_NAME = "dashboard_session";

/**
 * The session id the request's own cookie carries, or the empty string when it carries none.
 *
 * The value is returned verbatim — no trimming, decoding or case-folding — because the service's own
 * reader is the only thing that decides whether it may name a session.
 */
export function sessionIdOf(request: NextRequest): string {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
}
