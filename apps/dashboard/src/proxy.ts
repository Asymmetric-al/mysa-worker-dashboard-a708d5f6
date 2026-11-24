/** The one request-level file this application owns, and the two decisions it has to take before anything renders or is served — Next allows exactly one proxy per project, so both live here. */ import { NextResponse, type NextRequest } from "next/server";
import { isCommittedMediaFixturePath } from "@/lib/fixture-path-guard";
import { isDevelopment } from "@/lib/guards";
import { SESSION_COOKIE, SESSION_COOKIE_GRANT, readSessionId } from "@/lib/session-cookie";
import { DEFAULT_SESSION_ID } from "@/modules/dev-runtime/seed";
const refuseFixturePath = (): NextResponse => new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
/** Applies the two request-level decisions of this file, in order, and answers the request. */ export default function proxy(request: NextRequest): NextResponse {
  if (isCommittedMediaFixturePath(request.nextUrl.pathname)) return refuseFixturePath();
  if (request.nextUrl.pathname.startsWith("/_next/")) return NextResponse.next();
  const carriedSessionId = readSessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (carriedSessionId !== undefined) return NextResponse.next();
  if (!isDevelopment()) return NextResponse.next();
  const headers = new Headers(request.headers); // The request's own cookie header is extended rather than replaced, so every other cookie the browser carries still reaches the render that is about to resolve this session.
  const carriedCookieHeader = headers.get("cookie");
  headers.set("cookie", carriedCookieHeader === undefined ? `${SESSION_COOKIE}=${DEFAULT_SESSION_ID}` : `${carriedCookieHeader}; ${SESSION_COOKIE}=${DEFAULT_SESSION_ID}`);
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(SESSION_COOKIE, DEFAULT_SESSION_ID, SESSION_COOKIE_GRANT);
  return response;
}
