/**
 * `GET /api/session` — what this session is admitted to, in the one read envelope.
 *
 * **Why a route exists at all.** The shell already renders admission on the server from the same
 * read, and a Server Component may not fetch the application's own route to re-read what it can
 * read in process. This handler is the browser's transport for the narrower job: a client that has
 * to know its session state, its admitted context or the actions currently open to it — after a
 * context switch, after a development control moved the scenario, or after a reload — asks for the
 * same answer the server rendered, and gets it without a second implementation of it.
 *
 * **One read, one mapper.** `reads.context.readAdmissionState()` resolves the development-session
 * cookie itself and decides which of the five states the session is in; `toResponse` is the
 * application's only status ladder. So the envelope reaches a browser as 200, a session that cannot
 * be established as the refusal its closed reason code names (403), and a store that did not answer
 * as `unavailable` (503) naming the source and the safe retry. This file states no scope, tests no
 * membership, reads no clock and formats nothing: no field is added, removed, recomputed or
 * normalised on the way out, and no status is chosen here.
 *
 * **Nothing in the request selects who the caller is.** The handler takes no request, no route
 * params and no search params, so no path or query string can name a principal, an organisation, a
 * ministry, a session state or a persona. Switching persona belongs to the development controls;
 * this route reports what the admission resolver decided and offers no way to make it decide
 * differently.
 *
 * **No write path.** Only `GET` is exported, so every other method answers 405 from the framework.
 * A mutation here would be a way to change context that skips the membership check, the expected
 * revision and the conflict outcome that the context-change route applies.
 *
 * **What a refusal discloses.** The five states stay five: `signed-in`, and the four that grant
 * nothing — `no-access`, `denied`, `expired`, `unavailable` — each keep their own guidance key and
 * carry no principal, organisation name, ministry title, count or existence flag, so a caller
 * without admission learns nothing about what stands behind the refusal.
 *
 * **Layering.** `app/api → modules/data-service`. This file imports the service package root and
 * nothing deeper: never the synthetic store, never the development runtime, never a component or a
 * feature.
 */

import { outcomeFromError, reads, toResponse } from "@/modules/data-service";

/**
 * Admission is derived from the request's session cookie on every call, so the answer must never be
 * cached: a stored render would serve one session's context — or a `signed-in` state — to a
 * persona switch, a context switch, or a session that has since expired.
 */
export const dynamic = "force-dynamic";

/**
 * The store behind the service reads session documents through `node:fs`, and media preparation
 * loads Node-API native bindings, so this application runs on the Node runtime. Declaring it makes
 * the requirement unmissable: the edge runtime is not a supported execution model here.
 */
export const runtime = "nodejs";

/**
 * The marker a refusal from this route carries where a mutation would carry its operation id.
 *
 * A `GET` performs no effect, so it has no operation to name and mints no identifier of its own.
 * `"read"` is the non-unique attempt marker every read result in the service already carries, which
 * is what keeps a failed read from being mistaken for a change someone could replay.
 */
const READ_ATTEMPT_MARKER = "read";

/**
 * Answers with this session's admission statement: the state, its guidance key, and — only when
 * admitted — the principal, the selected context and the scenario the session runs in, inside the
 * envelope that also states the scope, source, revision, as-of instant, coverage, value states and
 * available actions.
 *
 * A thrown fault is converted through the service's own error mapping rather than surfacing as a
 * framework error page: a store or medium fault becomes `unavailable` naming the source and the
 * retry that is safe, a session that cannot be established becomes `denied`, and anything
 * unrecognised becomes `unknown` carrying only the attempt marker. No fault is answered with seeded
 * data or with a principal this file invented.
 */
export async function GET(): Promise<Response> {
  try {
    return toResponse(await reads.context.readAdmissionState());
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
