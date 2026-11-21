/**
 * `POST /api/initiatives/requests/response` — the one way a browser records the answer to a Request.
 *
 * **One mutation, one path.** Every request dispatches to `mutations.outreach.recordRequestResponse`;
 * there is no `payload.operation` discriminant because this path performs exactly one change. The
 * payload names the Request and the answer: its kind, the named respondent, the standing evidence the
 * respondent offered, and the terms version the answer refers to.
 *
 * **What an answer is bound to.** A response answers the terms version it cites, and that must be the
 * version the stored presentation records, because an answer is evidence about the terms it actually
 * responded to. The seven response kinds stay seven: agreed, conditional, partial, deferred, declined,
 * unanswered and needs clarification. Re-recording the same answer is `unchanged`; a later, different
 * answer replaces the recorded one with its own recorded instant, because a respondent changing their
 * answer is a new fact about the same invitation.
 *
 * **What agreement never proves.** It creates no pledge, gift, commitment, subscription, receipt, task
 * or send: this path records a human answer and nothing else, so recording "agreed" here cannot be read
 * later as support received.
 *
 * **Who authorises.** The service, per request: the initiative the Request belongs to must be in the
 * claimed ministry and the session's principal must be responsible for it. A closed initiative still
 * accepts a late actual response, because closing fences solicitation rather than the record of what
 * happened — and that decision, like every other, is the service's.
 *
 * **What this file never does.** It never chooses a status (only `toResponse` maps an outcome to one),
 * wraps a body, mints or bumps an `operationId` or an `expectedRevision`, restates the payload's rules —
 * the mutation normalises the two payload spellings it admits and then validates them with one closed
 * schema, so a reply built here cannot become a second acceptance rule — decides which version is
 * current, or compares the new answer with the stored one.
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
type RecordRequestResponsePayload = Parameters<
  typeof mutations.outreach.recordRequestResponse
>[0]["payload"];

/**
 * The four-field mutation input around that payload.
 *
 * The payload member is opaque because the mutation validates it: which answer kinds are recorded, that
 * the respondent is a named record, and that the cited version is the presented one are all decided
 * there, with violations answered as `invalid` per field path.
 */
const recordResponseRequestSchema = mutationInputSchema(
  z.custom<RecordRequestResponsePayload>(),
);

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
 * Records the respondent's own answer to one Request, and answers exactly one outcome.
 *
 * Outcome set, as the service answers it: `accepted` (the answer is recorded, with the new revision),
 * `alreadyAccepted` (a replay, with the stored result), `unchanged` (the same answer was already
 * recorded), `conflict` (a stale `expectedRevision`, with the current value and the preserved input),
 * `denied`, `invalid` (with per-field messages, including a version no presentation cites),
 * `unavailable` and `unknown`.
 *
 * The scope and the expected revision travel untouched, so a replay is recognised by its `operationId`
 * and two people recording at once cannot overwrite each other silently. A thrown fault is answered as
 * the service's error mapping says, under this attempt's own id.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = recordResponseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }

  try {
    return toResponse(await mutations.outreach.recordRequestResponse(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
