/**
 * `POST /api/session/context` — the context switch: one named mutation, `selectContext`, and nothing else.
 *
 * **What it is.** A thin adapter over `mutations.context.selectContext` (AAP 0.6.3: "`POST
 * /api/session/context` — Mutation: select org/ministry/support subject; outcome `conflict` when unsaved
 * work must be resolved first"). It reads the four-field mutation input of AAP 0.7.1, validates the shape
 * of the payload, dispatches the one named mutation with the caller's own fields and maps the answer
 * through the application's single response ladder. It holds no scope, no membership check, no revision
 * comparison, no store access and no clock read: `runMutation` inside the service resolves the session,
 * re-checks the admitted membership and compares `expectedRevision` against the context record, so a
 * second authorisation path does not exist here.
 *
 * **Why it is not development-gated.** Choosing a context is an ordinary signed-in action — it is how a
 * principal admitted to two ministries acts in either — so the development boundary the five `/api/dev`
 * controls ask for would be the wrong question here, and `selectContext` itself is deliberately not
 * gated (AAP 0.7.1, `mutations/dev.ts`).
 *
 * **Where the body schema comes from.** The request contract for this endpoint is declared once, in
 * `features/shell/schemas/select-context.ts`: the payload names the three branded identifiers a switch
 * names, and `mutationInputSchema` wraps them in the envelope's `operationId`, `scope` and
 * `expectedRevision`. This route validates with that schema as it stands, because a second declaration of
 * the same payload is what lets the two sides drift — a route with its own copy answers `invalid` to a
 * body the browser side already accepts — and the schema carries exactly the members the contract
 * declares, so a member it does not declare is dropped here rather than carried into the transaction.
 *
 * **One payload schema, and it is the browser's.** The body carries the three identifiers a switch
 * names — organisation, ministry and the finance subject the chooser itself reported — plus, when the
 * person has answered the guard's question about work they are holding, their own decision about it:
 * `resolveUnsavedWork` reaches the mutation, which records it in the result's `unsavedWork` and answers
 * `conflict` for `stay`. The principal is not in the payload at all; it is the session's, so no request
 * can nominate another person as the one acting.
 *
 * **One response ladder.** Every branch answers through `toResponse`, and a throw is mapped by
 * `outcomeFromError`: a store or filesystem fault becomes `unavailable`, an unrecognised failure becomes
 * `unknown` carrying the caller's `operationId`, and a refusal or a stale revision stay `denied` and
 * `conflict`. No status, body shape or message is written by hand.
 *
 * **What it never does.** It never reads the session cookie itself, never imports the store or the
 * development runtime, never reads the environment, never reads a wall clock, never logs a payload or an
 * identifier, and offers no rate limit or cache directive (AAP 0.6.3 states that none is implemented).
 *
 * Plan items that put this handler in scope: AAP 0.6.3 (`POST /api/session/context`), 0.6.2 ("Session
 * context": `selectedOrgId`, `selectedMinistryId`, `supportSubjectId`), 0.7.1 (the four-field input and
 * the closed eight outcomes), 0.3.2 ("a context switch clears the cache before any new read is issued"),
 * 0.9.1 and 0.11.1 naming the route, and 0.15.1's error model.
 */
import { selectContextRequestSchema } from "@/features/shell/schemas/select-context";
import { mutations, outcomeFromError, toResponse } from "@/modules/data-service";

/**
 * Every request is evaluated per request: the service reads the development-session cookie, so the same
 * URL answers differently for two sessions and must never be served as a cached answer.
 */
export const dynamic = "force-dynamic";

/** The synthetic store writes through `node:fs`, so the Edge runtime cannot serve this route. */
export const runtime = "nodejs";

/**
 * The marker a body carries when no attempt was lodged.
 *
 * An `operationId` that is absent or unusable names no attempt, and inventing a canonical one would
 * offer a recovery handle that could find nothing; the marker says plainly that no attempt was
 * established, and the strict envelope reports the missing field itself.
 */
const UNREACHED_ATTEMPT = "session-context-route";

/** Reads the request body as JSON, answering `undefined` for a body that is absent or is not JSON. */
async function readJsonBody(request: Request): Promise<unknown> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return undefined;
  }
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The attempt identity the caller presented, or the marker that says no attempt was established. */
function operationIdOf(body: unknown): string {
  if (typeof body === "object" && body !== null) {
    const presented = (body as { readonly operationId?: unknown }).operationId;
    if (typeof presented === "string" && presented.length > 0 && presented.length <= 200) {
      return presented;
    }
  }
  return UNREACHED_ATTEMPT;
}

/**
 * Moves the session into the context the body names and answers with one of the closed outcomes —
 * accepted, alreadyAccepted, unchanged, conflict, denied, invalid, unavailable or unknown.
 *
 * A body that does not validate answers `invalid` with the service's own per-field messages, keyed by the
 * field path that carried the value, and nothing is dispatched. A replay of an attempt already recorded
 * answers `alreadyAccepted` with its stored result, so re-submitting one switch cannot move a session
 * twice.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const operationId = operationIdOf(body);
  const parsed = selectContextRequestSchema.safeParse(body);

  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }

  try {
    return toResponse(await mutations.context.selectContext(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
