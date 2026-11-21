/**
 * `POST /api/initiatives/stages` — the one way a browser records a stage against a working-list member.
 *
 * **One mutation, one path.** Every request dispatches to `mutations.outreach.setStage`; there is no
 * `payload.operation` discriminant because this path performs exactly one change. The payload names the
 * initiative, the member and either an approved stage or an explicit `null`, which is Clear.
 *
 * **What a stage is and is not.** It is one human assessment drawn from the source-approved list — not a
 * prediction of giving, a measure of worth or the fulfilment of an obligation — so recording the value
 * already stored answers `unchanged`, writes no history entry and changes nothing, and recording a
 * different value creates no task and unpauses nothing. A stage belongs to an included member: a partner
 * who was removed or excluded has to return to the list before an assessment is recorded, and a value
 * the source no longer offers is refused even though a read still reports it as retired.
 *
 * **Who authorises.** The service, per request: the initiative's ministry must be the claimed one and
 * the session's principal must be the person responsible for the initiative. Nothing in the body can
 * widen that, and a refusal is `denied` with a reason code that discloses nothing about the record.
 *
 * **What this file never does.** It never chooses a status (only `toResponse` maps an outcome to one),
 * wraps a body, mints or bumps an `operationId` or an `expectedRevision`, re-states the payload's rules —
 * `setStage`'s own closed schema answers `invalid` with a message per field path — or compares the new
 * stage with the stored one, because that comparison is what decides `unchanged` inside the service.
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
type SetStagePayload = Parameters<typeof mutations.outreach.setStage>[0]["payload"];

/**
 * The four-field mutation input around that payload.
 *
 * The payload member is opaque because the mutation validates it, and it is the only owner of those
 * rules: the approved stage list, the requirement that both identifiers be present, and `null` meaning
 * Clear are all decided there, with violations answered as `invalid`.
 */
const setStageRequestSchema = mutationInputSchema(z.custom<SetStagePayload>());

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
 * Records one assessment of where a working-list member stands, and answers exactly one outcome.
 *
 * Outcome set, as the service answers it: `accepted` (the stage is recorded, with the new revision),
 * `alreadyAccepted` (a replay, with the stored result), `unchanged` (the same value was already
 * recorded, so nothing was written), `conflict` (a stale `expectedRevision`, with the current value and
 * the preserved input), `denied`, `invalid` (with per-field messages), `unavailable` and `unknown`.
 *
 * The scope and the expected revision travel untouched: the service verifies the session is admitted to
 * the claimed scope and decides whether the revision is current. A thrown fault is answered as the
 * service's error mapping says, under this attempt's own id, rather than escaping the boundary.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = setStageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }

  try {
    return toResponse(await mutations.outreach.setStage(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
