/**
 * The one request-level file this application owns, and the two decisions it has to take before
 * anything renders or is served — Next allows exactly one proxy per project, so both live here.
 *
 * **The first decision: the committed media fixtures have no HTTP address.** `public/fixtures/media/`
 * holds the seed's private media inputs, and no reader may fetch an original from it: a protected
 * asset has no permanent public URL (AAP 0.3.2, 0.6.2, 0.8.6), and the framework would otherwise serve
 * those files at a permanent unauthenticated address. The predicate that recognises every spelling of
 * that directory is `@/lib/fixture-path-guard`, which owns the rule and the decoding it needs; this
 * file only applies the decision. It is applied at the request level because the framework resolves a
 * `public/` file only after percent-decoding the request path, so a rule written downstream of that
 * decode — a rewrite, a route, a header check — is compared against a spelling the caller chooses, and
 * the encoded forms of the same path would reach the bytes while the literal form was refused. The
 * refusal answers with the same 404 and `cache-control: no-store` an absent file answers with: a
 * refusal that differed from absence would make the directory an enumeration oracle.
 *
 * **The second decision: the development session is established.** The session cookie that every read
 * and mutation resolves its scope from has to exist before the first document renders, and each of the
 * three places that looks like it could mint it is unable to: a Server Component may read a cookie but
 * never set one, so the root layout cannot establish the session it is about to read; `GET /api/session`
 * deliberately has no write path, because a write there would be a way to change who the caller is; and
 * `data-service/authorize.ts` only resolves the cookie a request already carries. A proxy runs ahead of
 * all three and can both rewrite the incoming request and append to the outgoing response, so the cookie
 * is established on the same request that first needs it, and that request's Server Components and Route
 * Handlers already see it.
 *
 * The two are ordered, and the order is the fixture refusal: it answers before the session rule can run,
 * so a request for a fixture path is refused with nothing beside the 404 — no cookie, no header set of
 * its own — and cannot be told apart from a request for a file that does not exist.
 *
 * **A development session, not an authentication system.** Nothing here authenticates anybody: there is
 * no password, credential, token, signature, OAuth scope, expiry protocol or refresh flow, and none is
 * missing, because AAP 0.6.3 asks for exactly a development-session cookie resolved server-side into a
 * principal and its admitted memberships. The value is a seeded session id, so the cookie selects which
 * seeded world a browser works in, and the four session states — signed-in, unavailable, denied, expired
 * — are the seed's own.
 *
 * **A request never names its own identity.** No search parameter, header, route parameter or body is
 * read here: the only input is the cookie the request already carries, narrowed by the store's
 * validator. An id that already names a session is left exactly as the browser sent it — the mint never
 * re-mints and never overrides a chosen session — so opening a second seeded persona, or a second
 * browser context in another scenario (AAP 0.7.2), keeps working. Whether the store holds that session
 * is the resolver's question, and a stale or mistyped id is refused there with the one closed refusal
 * rather than quietly replaced by another identity.
 *
 * **Production never falls back to a seeded session.** The mint is gated by `isDevelopment()`, so a
 * production build passes the request through with no cookie and the session resolver refuses a caller
 * who carries none instead of answering as somebody (AAP 0.7.2, "No secrets, no fallback"). The id
 * written is the seed's own statement of which session a caller means, never a fixture chosen here:
 * this file invents no principal, session state, membership or scope.
 *
 * **No `config.matcher`, and why the framework's own assets are skipped by path instead.** The fixture
 * predicate has to see every request path — a matcher narrowed to the fixtures directory, or to any one
 * spelling of it, is tested against the encoded pathname and lets an encoded separator through. So the
 * proxy runs on every path, and the mint skips `/_next/` explicitly: a compiled chunk carries no session
 * to establish, and on a first cookie-less load it would otherwise answer a `Set-Cookie` per asset. The
 * fixture decision has already been taken before that skip, so no path escapes it.
 *
 * **Layering.** The store is reached only for the two declarations that own this concern — the cookie's
 * name and the validator in front of its value — the entry session id comes from the seed's
 * `DEFAULT_SESSION_ID`, and the fixture rule comes from its own predicate module. This file reads no
 * session document, no request body and no media bytes, calls no service read and states no scope,
 * revision or permission rule.
 */

import { NextResponse, type NextRequest } from "next/server";

import { isCommittedMediaFixturePath } from "@/lib/fixture-path-guard";
import { isDevelopment } from "@/lib/guards";
import { DEFAULT_SESSION_ID } from "@/modules/dev-runtime/seed";
import { SESSION_COOKIE, readSessionId } from "@/modules/store/sessions";

/**
 * How long the browser keeps the minted cookie: one year, in the seconds the attribute takes.
 *
 * A development session is not a credential with a lifetime to defend, so nothing rotates, renews or
 * checks it against a deadline — the span exists so a seeded session does not vanish mid-journey on a
 * machine left open overnight. It states how long the browser remembers the session, never how long the
 * session stays valid: the store decides that by holding the session's documents or not.
 */
const SESSION_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * The attributes every minted cookie carries (AAP 0.7.2): `httpOnly` so no script can read the session
 * id, `sameSite: "lax"` so a cross-site navigation does not carry it, `path: "/"` so every route of the
 * application resolves the same session, and the one-year lifetime above.
 *
 * They are stated once, here, because it is the response layer that owns them: `store/sessions.ts` names
 * the cookie and validates its value, and keeps the attributes off its own request-agnostic surface for
 * that reason.
 */
const SESSION_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
} as const;

/**
 * The prefix every framework-compiled asset shares. A request under it is answered untouched: there is
 * no session to establish for a chunk, stylesheet or font, and the fixture decision has already been
 * made for it.
 */
const FRAMEWORK_ASSET_PREFIX = "/_next/";

/**
 * Answers a request for the committed media fixtures as if the file did not exist, and otherwise lets
 * the request through to the session decision.
 *
 * The status and the one header are the whole answer, and both are what an absent `public/` file
 * produces, so a caller cannot use the difference between "refused" and "not there" to learn what the
 * fixture directory holds.
 */
function refuseFixturePath(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Applies the two request-level decisions of this file, in order, and answers the request.
 *
 * Three answers to the session question, once the fixture refusal is behind it:
 *
 * - **A framework asset, or a session id already carried.** Answered as it stands, header for header.
 *   The mint neither re-mints nor overrides a chosen session, so a browser that selected a persona keeps
 *   it.
 * - **Not a development build.** Answered with no cookie at all, because a production build has no
 *   seeded world to enter and refuses a caller without a session instead of inventing one.
 * - **Otherwise.** The seed's default session is written twice: into an outgoing copy of the request's
 *   `cookie` header, so this request's own render and Route Handlers already resolve the session, and
 *   onto the response, so the browser carries it from the next request onward.
 */
export default function proxy(request: NextRequest): NextResponse {
  if (isCommittedMediaFixturePath(request.nextUrl.pathname)) {
    return refuseFixturePath();
  }

  if (request.nextUrl.pathname.startsWith(FRAMEWORK_ASSET_PREFIX)) {
    return NextResponse.next();
  }

  const carriedSessionId = readSessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (carriedSessionId !== undefined) {
    return NextResponse.next();
  }

  if (!isDevelopment()) {
    return NextResponse.next();
  }

  // The request's own cookie header is extended rather than replaced, so every other cookie the browser
  // carries still reaches the render that is about to resolve this session.
  const headers = new Headers(request.headers);
  const carriedCookieHeader = headers.get("cookie");
  headers.set(
    "cookie",
    carriedCookieHeader === undefined
      ? `${SESSION_COOKIE}=${DEFAULT_SESSION_ID}`
      : `${carriedCookieHeader}; ${SESSION_COOKIE}=${DEFAULT_SESSION_ID}`,
  );

  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(SESSION_COOKIE, DEFAULT_SESSION_ID, SESSION_COOKIE_ATTRIBUTES);
  return response;
}
