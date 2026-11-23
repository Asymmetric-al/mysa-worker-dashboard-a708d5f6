/** The methods one path answers, stated once from the handlers it implements: Next answers every method a path does not export with a bare `405` that names none of them, so each transport hands its handlers to {@link routeMethods}, and that one place answers `OPTIONS` (204 with `Allow`), `HEAD` (this path's `GET`, as Next itself would map it), and a `405` naming the set for every method the path does not answer. */
import type { NextRequest } from "next/server";
/** The methods a path answers in its own right: a transport implements `GET`, `POST`, or both, and every other member of this list is refused by {@link routeMethods} on its behalf. */
const IMPLEMENTED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
/** A method a path answers in its own right. */
export type ImplementedMethod = (typeof IMPLEMENTED_METHODS)[number];
/** One method's handler, given the request and the route's own context exactly as Next hands them over. */
export type RouteHandler<Context> = (request: NextRequest, context: Context) => Response | Promise<Response>;
/** Every method a path answers once {@link routeMethods} has run: the implemented ones, the `HEAD` derived from `GET`, the `OPTIONS` answer, and the `405` refusal standing in for each the path does not implement. */
export type RouteMethods<Context> = Readonly<Record<ImplementedMethod | "HEAD" | "OPTIONS", RouteHandler<Context>>>;
const METHOD_NOT_ALLOWED_STATUS = 405;
const NO_CONTENT_STATUS = 204;
/** The `Allow` header names every method the resource supports, so an `OPTIONS` answer and a `405` refusal state the same closed set, in one order, each time a request is answered. */
const allowHeaderOf = (implemented: Partial<Record<ImplementedMethod, RouteHandler<unknown>>>): string => [...IMPLEMENTED_METHODS.filter((method) => implemented[method] !== undefined), ...(implemented.GET === undefined ? [] : ["HEAD" as const]), "OPTIONS"].sort().join(", ");
/** Builds the whole method set of one path from the handlers it implements: the `405` and `OPTIONS` answers are the only place this application states which methods a path accepts, and {@link allowHeaderOf} states it once for both. */
export function routeMethods<Context>(implemented: Partial<Record<ImplementedMethod, RouteHandler<Context>>>): RouteMethods<Context> {
  const allow = allowHeaderOf(implemented as Partial<Record<ImplementedMethod, RouteHandler<unknown>>>);
  const refuse = (): Response => new Response(null, { status: METHOD_NOT_ALLOWED_STATUS, headers: { allow } });
  const answered = (method: ImplementedMethod): RouteHandler<Context> => implemented[method] ?? refuse;
  return { GET: answered("GET"), POST: answered("POST"), PUT: answered("PUT"), PATCH: answered("PATCH"), DELETE: answered("DELETE"), HEAD: implemented.GET ?? refuse, OPTIONS: (): Response => new Response(null, { status: NO_CONTENT_STATUS, headers: { allow } }) };
}
