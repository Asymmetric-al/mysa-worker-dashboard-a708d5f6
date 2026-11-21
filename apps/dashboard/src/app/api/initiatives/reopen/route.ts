/**
 * `POST /api/initiatives/reopen` — the one way a browser reopens a closed initiative for further
 * solicitation.
 *
 * **One mutation, one path.** Every request dispatches to `mutations.outreach.reopenInitiative`; there is
 * no `payload.operation` discriminant because this path performs exactly one change. The payload names
 * the initiative and, optionally, the caller's own short reason.
 *
 * **What reopening restores, and what it keeps.** It restores planning, not membership: the closure
 * disposition the record stated is kept, which is what lets a reader tell a reopened initiative from one
 * that was never closed, and every working-list removal and exclusion is kept too — a partner the worker
 * excluded deliberately stays out of the list. Reopening an initiative that is already open is
 * `unchanged`, and nothing here revives a Request, a task or a deadline that was closed beside it.
 *
 * **Who authorises.** The service, per request: the initiative's ministry must be the claimed one and
 * the session's principal must be the person responsible for it. Nothing in the body can widen that, and
 * a refusal is `denied` with a reason code that discloses nothing about the record.
 *
 * **What this file never does.** It never chooses a status (only `toResponse` maps an outcome to one),
 * wraps a body, mints or bumps an `operationId` or an `expectedRevision`, restates the payload's rules —
 * `reopenInitiative`'s own closed schema answers `invalid` with a message per field path — re-includes a
 * removed or excluded member, or rewrites the closure history the record keeps.
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
type ReopenInitiativePayload = Parameters<typeof mutations.outreach.reopenInitiative>[0]["payload"];

/**
 * The four-field mutation input around that payload.
 *
 * The payload member is opaque because the mutation validates it: the required initiative reference and
 * the optional bounded reason are decided there, with violations answered as `invalid` per field path.
 */
const reopenInitiativeRequestSchema = mutationInputSchema(z.custom<ReopenInitiativePayload>());

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
 * Reopens one closed initiative, preserving its closure history and its working-list decisions.
 *
 * Outcome set, as the service answers it: `accepted` (open again, with the new revision),
 * `alreadyAccepted` (a replay, with the stored result), `unchanged` (it was already open), `conflict`
 * (a stale `expectedRevision`, with the current value and the preserved input), `denied`, `invalid`
 * (with per-field messages), `unavailable` and `unknown`.
 *
 * The scope and the expected revision travel untouched, so a reopen built on a closure someone else has
 * since replaced is a `conflict` rather than an overwrite. A thrown fault is answered as the service's
 * error mapping says, under this attempt's own id.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = reopenInitiativeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }

  try {
    return toResponse(await mutations.outreach.reopenInitiative(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
