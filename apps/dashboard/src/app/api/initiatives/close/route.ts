/**
 * `POST /api/initiatives/close` — the one way a browser closes an initiative's solicitation.
 *
 * **One mutation, one path.** Every request dispatches to `mutations.outreach.closeInitiative`; there is
 * no `payload.operation` discriminant because this path performs exactly one change. The payload names
 * the initiative, states how it closes — a disposition, or the eligible handoff that takes the
 * unfinished work on — and the mutation requires at least one of the two.
 *
 * **What closing does and does not settle.** Closing fences new solicitation. It resolves nothing
 * silently: every open task the initiative owns and every presented Request still awaiting an answer
 * travels back in the outcome's per-item results as it stands, so a closure never claims that work was
 * completed or that an answer arrived. A late actual response is still recordable afterwards without
 * reopening, because closing fences solicitation rather than the record of what happened. Closing an
 * initiative that is already closed is `unchanged`, and leaves the disposition it recorded in place.
 *
 * **Who authorises.** The service, per request: the initiative's ministry must be the claimed one and
 * the session's principal must be the person responsible for it. Nothing in the body can widen that, and
 * a refusal is `denied` with a reason code that discloses nothing about the record.
 *
 * **What this file never does.** It never chooses a status (only `toResponse` maps an outcome to one),
 * wraps a body, mints or bumps an `operationId` or an `expectedRevision`, restates the payload's rules —
 * `closeInitiative`'s own closed schema answers `invalid` with a message per field path — decides what a
 * disposition is worth, or completes, cancels or reassigns any task or Request the initiative owns.
 *
 * **Layering.** `app/api → modules/data-service`, through the barrel only.
 */

import { z } from "zod";

import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  toResponse,
} from "@/modules/data-service";

// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// The change resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";

/** The payload this path forwards, taken from the mutation's own signature. */
type CloseInitiativePayload = Parameters<typeof mutations.outreach.closeInitiative>[0]["payload"];

/**
 * The four-field mutation input around that payload.
 *
 * The payload member is opaque because the mutation validates it: the optional disposition, the closed
 * handoff shape and the rule that one of the two must be stated are decided there, with violations
 * answered as `invalid` per field path.
 */
const closeInitiativeRequestSchema = mutationInputSchema(z.custom<CloseInitiativePayload>());

/**
 * The marker a refusal carries where a real attempt would carry its `operationId`.
 *
 * A body too malformed to state a usable id names no attempt, and answering with a minted one would
 * invite a replay of work that was never tried.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/** The operation id a rejected body claimed, read defensively from an untrusted value. */
function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}

/**
 * Closes one initiative, recording how its unfinished work is handed on or resolved.
 *
 * Outcome set, as the service answers it: `accepted` (closed, with the recorded disposition and the
 * per-item statement of the work still open), `alreadyAccepted` (a replay, with the stored result),
 * `unchanged` (it was already closed), `conflict` (a stale `expectedRevision`, with the current value
 * and the preserved input), `denied`, `invalid` (with per-field messages), `unavailable` and `unknown`.
 *
 * The scope and the expected revision travel untouched, so the closure the caller saw is the closure it
 * acts on. A thrown fault is answered as the service's error mapping says, under this attempt's own id.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = closeInitiativeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }

  try {
    return toResponse(await mutations.outreach.closeInitiative(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
