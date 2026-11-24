/** The transport's reader for the request's own session id, over the cookie name src/lib/session-cookie.ts declares. */ import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";
/** The session id the request's own cookie carries, or the empty string when it carries none. */ export const sessionIdOf = (request: NextRequest): string => request.cookies.get(SESSION_COOKIE)?.value ?? "";
