/** The methods one path answers, stated once from the handlers it implements: Next answers every method a path does not export with a bare `405` that names none of them, so each transport hands its handlers to {@link routeMethods}, and that one place answers `OPTIONS` (204 with `Allow`), `HEAD` (this path's `GET`, as Next itself would map it), a `405` naming the set for every method the path does not answer, and the request-origin check that keeps a state-changing request another site caused from reaching the handler it would have dispatched. */
import type { NextRequest } from "next/server";
import { toResponse } from "@/modules/data-service";
import { denied, UNIDENTIFIED_ATTEMPT } from "@/modules/data-service/outcome";
/** The methods a path answers in its own right: a transport implements `GET`, `POST`, or both, and every other member of this list is refused by {@link routeMethods} on its behalf. */
const IMPLEMENTED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
/** A method a path answers in its own right. */ export type ImplementedMethod = (typeof IMPLEMENTED_METHODS)[number];
/** One method's handler, given the request and the route's own context exactly as Next hands them over. */ export type RouteHandler<Context> = (request: NextRequest, context: Context) => Response | Promise<Response>;
/** Every method a path answers once {@link routeMethods} has run: the implemented ones, the `HEAD` derived from `GET`, the `OPTIONS` answer, and the `405` refusal standing in for each the path does not implement. */
export type RouteMethods<Context> = Readonly<Record<ImplementedMethod | "HEAD" | "OPTIONS", RouteHandler<Context>>>;
/** The methods that change what the application holds, and so the ones checked before they run: `GET`, the `HEAD` derived from it and the `OPTIONS` answer read the store or state the method set, and a request from another site reaching them leaves every record as it was. */
const STATE_CHANGING_METHODS: ReadonlySet<ImplementedMethod> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const METHOD_NOT_ALLOWED_STATUS = 405;
const NO_CONTENT_STATUS = 204;
/** The headers a browser states about where a request came from: `sec-fetch-site` names its relation to this application and `origin` names the origin itself. */ const FETCH_SITE_HEADER = "sec-fetch-site";
const ORIGIN_HEADER = "origin";
const CROSS_SITE = "cross-site";
/** The `origin` an opaque context states — a sandboxed frame, a `data:` document, a file — which belongs to no application and so is never this one's own. */ const OPAQUE_ORIGIN = "null";
/** The `Allow` header names every method the resource supports, so an `OPTIONS` answer and a `405` refusal state the same closed set, in one order, each time a request is answered. */
const allowHeaderOf = (implemented: Partial<Record<ImplementedMethod, RouteHandler<unknown>>>): string => [...IMPLEMENTED_METHODS.filter((method) => implemented[method] !== undefined), ...(implemented.GET === undefined ? [] : ["HEAD" as const]), "OPTIONS"].sort().join(", ");
/** The origin this request was addressed to, taken from the `host` header the client itself stated: the framework reports the same address with every loopback name written as `localhost`, so a browser that loaded the application from `127.0.0.1` would otherwise be refused for stating an origin the application appears never to answer to. */
const ownOriginOf = (request: NextRequest): string => {
  const host = request.headers.get("host");
  return (host === null ? request.nextUrl.origin : `${request.nextUrl.protocol}//${host}`).toLowerCase();
};
/** States whether a state-changing request came from somewhere other than this application: a browser labels a request another site caused `cross-site` and states in `origin` the site that caused it, so a request saying either is refused, while one carrying neither came from something that is not a browser — a script, or the browser test runner's own client — and contradicts no origin claim. */
const fromAnotherSite = (request: NextRequest): boolean => {
  const fetchSite = request.headers.get(FETCH_SITE_HEADER);
  if (fetchSite !== null && fetchSite.trim().toLowerCase() === CROSS_SITE) return true;
  const stated = request.headers.get(ORIGIN_HEADER)?.trim().toLowerCase();
  return stated !== undefined && (stated === OPAQUE_ORIGIN || stated !== ownOriginOf(request));
};
/** The one answer such a request receives: the closed `denied` outcome under the reason code a failed permission check states, so it is a refusal every client already renders, it says nothing about the operation, the session or any record, and it is decided on the request's own headers rather than after a session, a body or a record is read. */
const refuseForeignRequest = (): Response => toResponse(denied({ operationId: UNIDENTIFIED_ATTEMPT, reasonCode: "no-permission" }));
/** Wraps one state-changing handler with that check, so every path's unsafe methods take the decision from this one place, before the handler can reach a session, a body or the store. */ const checkedOrigin =
  <Context>(handler: RouteHandler<Context>): RouteHandler<Context> =>
  (request, context) =>
    fromAnotherSite(request) ? refuseForeignRequest() : handler(request, context);
/** Builds the whole method set of one path from the handlers it implements: the `405` and `OPTIONS` answers are the only place this application states which methods a path accepts, and {@link allowHeaderOf} states it once for both, while every state-changing method the path does implement reaches {@link checkedOrigin} first so no transport has to remember the check. */
export function routeMethods<Context>(implemented: Partial<Record<ImplementedMethod, RouteHandler<Context>>>): RouteMethods<Context> {
  const allow = allowHeaderOf(implemented as Partial<Record<ImplementedMethod, RouteHandler<unknown>>>);
  const refuse = (): Response => new Response(null, { status: METHOD_NOT_ALLOWED_STATUS, headers: { allow } });
  const answered = (method: ImplementedMethod): RouteHandler<Context> => {
    const handler = implemented[method];
    if (handler === undefined) return refuse;
    return STATE_CHANGING_METHODS.has(method) ? checkedOrigin(handler) : handler;
  };
  return { GET: answered("GET"), POST: answered("POST"), PUT: answered("PUT"), PATCH: answered("PATCH"), DELETE: answered("DELETE"), HEAD: implemented.GET ?? refuse, OPTIONS: (): Response => new Response(null, { status: NO_CONTENT_STATUS, headers: { allow } }) };
}
