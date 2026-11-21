/**
 * `POST /api/session/context` — the one way a browser asks this session to act in another context.
 *
 * **What it serves.** The switch the shell performs: the organisation, ministry and support subject a
 * session wants to act in, plus the caller's own decision about work it has not saved. One mutation
 * serves the path — `mutations.context.selectContext` — so the payload carries no `payload.operation`
 * discriminant and this route requires none: a second verb here would be a second way to change
 * context, and the release has exactly one.
 *
 * **Who authorises.** The service, on every call. It re-derives the acting principal from the
 * development-session cookie, requires the three opaque references together to name one admitted
 * membership, and answers `denied` with a reason code that discloses nothing about the target. Nothing
 * in the request can name a principal, so no payload can make this session act for someone else.
 *
 * **The outcome set is the service's eight, and this file adds none.** A caller's decision to stay
 * (`resolveUnsavedWork: "stay"`) comes back as `conflict` with the selection still in force beside the
 * request; a stale `expectedRevision` is `conflict` too, carrying the current value and the preserved
 * input; a replay is `alreadyAccepted` with the stored result. Only `toResponse` maps those to
 * statuses (200 for accepted/alreadyAccepted/unchanged, 409 conflict, 403 denied, 422 invalid, 503
 * unavailable, 202 unknown), so a status is never chosen here.
 *
 * **What it never does.** It never defaults or rewrites a context reference, mints or bumps an
 * `operationId` or an `expectedRevision`, decides whether the target is admitted, discards unsaved
 * work on the caller's behalf, or re-states a payload rule: `selectContext`'s own closed schema
 * answers `invalid` with per-field messages, so a second schema here would be a second owner of the
 * same rule. It reads no clock, logs nothing, and writes nothing but the selected context the mutation
 * records.
 *
 * **Layering.** `app/api → modules/data-service`, through the barrel only: never the synthetic store,
 * never a deep path into the reads or mutations, never a feature module.
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
// The switch re-resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";

/**
 * The payload this path forwards, taken from the mutation's own signature.
 *
 * Deriving it instead of restating it keeps one description of the switch: a member the mutation adds
 * to or drops from its payload changes this type with it, so a request built here cannot drift from the
 * one the service accepts.
 */
type SelectContextPayload = Parameters<typeof mutations.context.selectContext>[0]["payload"];

/**
 * The four-field mutation input around that payload.
 *
 * The payload member is opaque on purpose, because the mutation validates it: `selectContext` parses
 * its own closed schema before it asks any authority question, and answers a malformed payload as
 * `invalid` with messages keyed by field path. What the envelope alone decides is the contract every
 * mutation shares — a canonical operation id, the claimed scope, the revision the caller saw, and a
 * payload that is present.
 */
const selectContextRequestSchema = mutationInputSchema(z.custom<SelectContextPayload>());

/**
 * The marker a refusal carries where a real attempt would carry its `operationId`.
 *
 * A body so malformed that it states no usable id has no attempt to name, and answering with a minted
 * one would invite a caller to replay or re-query work that was never attempted. The marker matches the
 * one the service itself uses for that case, so the two refusals read alike.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/**
 * The operation id a rejected body claimed, read defensively from an untrusted value.
 *
 * Nothing was applied either way — the body failed the shared envelope before any mutation saw it — but
 * a caller that sent a well-formed id keeps it, so it can correlate the refusal with what it sent.
 */
function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}

/**
 * Asks this session to act in the stated context, and answers exactly one of the eight outcomes.
 *
 * Outcome set: `accepted` (the selection is authoritative, with the revision to present next),
 * `alreadyAccepted` (the same attempt replayed, with the stored result), `unchanged` (the context was
 * already the one asked for), `conflict` (a stale revision, or the caller chose to stay), `denied`
 * (the target is not an admitted membership of this principal), `invalid` (the envelope or the payload
 * is malformed, with per-field messages), `unavailable` (the session's state could not be read) and
 * `unknown` (the effect may have been applied but the acknowledgement was lost).
 *
 * The scope and the expected revision are forwarded untouched: the service verifies that the session is
 * admitted to the claimed scope, so trusting either here would be a second, weaker authorisation. A
 * thrown fault is answered as the service's error mapping says — `unavailable` for a store fault,
 * `denied` for a session that cannot be established, `unknown` carrying this same `operationId` for
 * anything unrecognised — never as a fabricated context or an invented success.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = selectContextRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }

  try {
    return toResponse(await mutations.context.selectContext(parsed.data));
  } catch (error) {
    // The service answers refusals as outcomes, so an exception here is a fault rather than a
    // presentation: converting it keeps the deviation from escaping the boundary as a framework page.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
