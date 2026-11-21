/** The transport layer's one declaration of the development-session cookie. */
import type { NextRequest } from "next/server";
/** The cookie name the development session travels under. */
export const SESSION_COOKIE_NAME = "dashboard_session";
/** The session id the request's own cookie carries, or the empty string when it carries none. */
export function sessionIdOf(request: NextRequest): string {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
}
