/**
 * `GET /api/support/goal` and `POST /api/support/goal` — the one support goal, read and written.
 *
 * **`GET` reads.** `reads.support.readGoal` states the goal the subject has set, its progress, the
 * percentage the goal module could form (or none, with its reason), the period the percentage was
 * measured over, and the resolved `canEditGoal` capability. Four facts stay four: a subject with no
 * goal, a goal that yields no percentage, a genuine `0%` and a valid `120%` are different renderings,
 * and a ratio above one is never clamped here because nothing about progress is computed here. The
 * capability travels in the envelope's data and actions rather than as a hidden flag, so a surface
 * with `canEditGoal` absent offers no edit control at all — and the same test refuses the write
 * below, so a stale envelope can produce a `denied` but never an unauthorised save.
 *
 * **`POST` saves exactly one thing, and it is the only financial write in this application.** This
 * path carries one mutation — `mutations.support.saveGoal` — so its body states no discriminator: a
 * single-mutation path that demanded `payload.operation` would be describing a routing decision it
 * does not make. The body is the four-field mutation input of AAP 0.7.1 and nothing else:
 * `{ operationId, scope, expectedRevision, payload }`. `operationId` is forwarded unchanged because it
 * is the identity of the attempt — replaying it answers `alreadyAccepted` with the stored result
 * instead of saving twice — and this file never mints one. `expectedRevision` is the goal's own
 * revision the caller read, so a stale save is a `conflict` that preserves the typed amount rather
 * than an overwrite.
 *
 * **The payload is the mutation's to describe.** It is validated by `mutationInputSchema` around this
 * mutation's own payload type, so the envelope's four fields are checked here and the payload's fields
 * are checked by `saveGoal`, which is their one owner. Redeclaring an amount, a currency, a measure or
 * an effective day here would give a worker two places to be told different things about one field,
 * and would let this file admit a field the mutation does not. A refused payload is therefore an
 * `invalid` outcome with the per-field messages the mutation's schema produces.
 *
 * **What a save never proves.** It sets a target; it does not post, correct, refund or retry money,
 * touch a gift or a commitment, rewrite an earlier report, publish public progress or grant finance,
 * publishing or coaching permission. Accepting or replaying one invalidates the client's goal,
 * overview and report reads and nothing else — one number changed — and that invalidation belongs to
 * the client hook, not to this transport.
 *
 * **Who authorises.** The service, twice: `saveGoal` resolves the session and asks the `canEditGoal`
 * capability plus the selected-context question before anything is written, and the runner re-checks
 * the resulting record's scope inside its transaction. This handler holds no authority of its own and
 * reads no scope of its own; the scope in the body is the context the caller believes it is acting
 * in, which the service verifies rather than trusts.
 *
 * Layering: `app/api → modules/data-service`. This file imports the service package root and nothing
 * deeper — never the store, never the goal module, never a feature or its payload schema — and it
 * reaches no second transport.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { isRecord } from "@/lib/guards";
import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  reads,
  toResponse,
} from "@/modules/data-service";

import { supportQueryFromSearch } from "../query";

/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";

/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";

/**
 * The marker a read refusal carries where a mutation would carry its operation id.
 *
 * A `GET` performs no effect and mints no identity; `"read"` is the marker every read result in the
 * service already carries, so a failed read cannot be mistaken for a change anyone could replay.
 */
const READ_ATTEMPT_MARKER = "read";

/**
 * The marker a save refusal carries when the body named no attempt of its own.
 *
 * A body whose `operationId` is absent or unusable has no attempt identity, and inventing a canonical
 * one would offer a recovery handle that could find nothing. The marker is the same one `saveGoal`
 * itself uses for the same case, so a refusal looks the same whichever layer read the body first.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/**
 * The payload `saveGoal` accepts, taken from the mutation's own parameter list.
 *
 * Derived rather than restated: the amount, the currency beside it, the one measure and the effective
 * day are the mutation's vocabulary, and a field it adds or withdraws reaches this file by
 * compilation instead of leaving a hand-written copy to drift.
 */
type GoalPayload = Parameters<typeof mutations.support.saveGoal>[0]["payload"];

/**
 * The one body this path accepts: the service's four-field mutation input around the mutation's own
 * payload type.
 *
 * The envelope is the service's schema, so `operationId`, `scope` and `expectedRevision` carry exactly
 * the rules the mutation applies — including the canonical lowercase UUID v4 an operation id must be —
 * and the envelope is strict, so a body carrying a fifth field is refused with that field named rather
 * than quietly dropped. The payload is checked by `saveGoal` itself, which is the reason no field of
 * it is declared here.
 */
const saveGoalRequestSchema = mutationInputSchema(z.custom<GoalPayload>());

/**
 * The operation id a rejected body claimed, for an `invalid` outcome to name.
 *
 * Read defensively from an untrusted body: a request that arrived with a usable id keeps it, so the
 * caller can correlate the refusal with what it sent, and one that arrived without an id gets the
 * marker instead. Nothing was attempted in either case, so no effect can be replayed under the value
 * reported here.
 */
function attemptIdOf(body: unknown): string {
  if (!isRecord(body)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed = body.operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}

/**
 * Answers with the support goal, its progress, the capability that governs editing it and the period
 * the percentage was measured over.
 *
 * Outcome set: `envelope` (200), `denied` (403) and `unavailable` (503) exactly as the read answered,
 * and `invalid` (422) for a search parameter the shared grammar cannot read. A subject with no goal is
 * an envelope with `goal: null`, never a denial and never an error: the absence of a target is a
 * complete state a surface can invite the worker to fill in.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = supportQueryFromSearch(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, parsed.error));
  }

  try {
    return toResponse(await reads.support.readGoal(parsed.value));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a
    // throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}

/**
 * Saves the goal the body states, and answers with exactly one of the service's eight outcomes:
 * `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown`, reported exactly as `saveGoal` answered.
 *
 * The outcome mapping the caller reads: `accepted` and `alreadyAccepted` are one save applied once and
 * the same attempt replayed, `unchanged` is a save that would change nothing, `conflict` carries the
 * value the caller's input collided with plus the input itself so a stale edit preserves the typed
 * amount, `denied` carries a reason code and no goal, `invalid` carries per-field messages, and
 * `unavailable` names the source that is down. `unknown` claims neither success nor failure: the
 * effect may have been applied and the acknowledgement lost, so the same `operationId` is the recovery
 * handle and no resend is implied.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = saveGoalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }

  try {
    return toResponse(await mutations.support.saveGoal(parsed.data));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes,
    // so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
