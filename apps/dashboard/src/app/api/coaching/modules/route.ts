/**
 * `POST /api/coaching/modules` — one module disclosure switched on or off for one relationship.
 *
 * **What it serves, and why no discriminant.** This path carries exactly one named mutation,
 * `setModule`, so the body states no `payload.operation`: with one meaning available, a routing field
 * would be a second way to say the same thing and one more value a client could get wrong. The body is
 * the four-field mutation input of AAP 0.7.1 and nothing else:
 *
 *     { operationId, scope, expectedRevision, payload }
 *
 * The payload's fields — the relationship, the module key and its new flag — are declared by the
 * mutation's own strict schema and nowhere else, so the field names, their closed vocabularies and the
 * per-field messages an `invalid` answer carries all come from that one owner, and this file holds no
 * copy of them. `operationId`, `scope` and `expectedRevision` are forwarded untouched: a replay is
 * recognised by identity rather than by a repeated payload, and a stale revision still reaches the
 * service as a `conflict`.
 *
 * **Who authorises.** The service, inside the mutation: it re-derives the caller from the development
 * session, checks that the relationship is the worker's own and that the episode is open, and refuses a
 * stale action on an ended one. This file checks no permission, reads no clock and resolves no module
 * set.
 *
 * **What a toggle never does.** Switching a module off ends that module's disclosure from now on and
 * changes no source record — no target, check-in, task, note or gift row is touched, and nothing a coach
 * has already read is claimed back. The payload schema is closed, so no field here can ask for a
 * deletion, a cascade or a reason, and the five modules stay five independent switches rather than one
 * sharing level.
 *
 * **One status ladder.** Every answer goes through `toResponse`: `accepted`, `alreadyAccepted` and
 * `unchanged` 200, `unknown` 202 with the `operationId`, `denied` 403, `conflict` 409, `invalid` 422
 * and `unavailable` 503 naming the source. A throw is mapped by `outcomeFromError` rather than escaping.
 * Only `POST` is exported: the module states are read on the overview and subject envelopes, so this
 * path has nothing of its own to `GET` and every other method answers 405 from the framework.
 *
 * **Layering.** `app/api → modules/data-service`, the package root only: never the synthetic store,
 * never a mutation module's deep path, never a feature module for a value or a type.
 */

import { z } from "zod";

import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  toResponse,
} from "@/modules/data-service";

/** The store writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";

/** The mutation resolves the development session and evaluates the scenario clock once per request. */
export const dynamic = "force-dynamic";

/**
 * The marker this file reports when a body states no identity of its own.
 *
 * An invalid answer still names an attempt, and a body so malformed that it states no `operationId` has
 * no other identity to report. Matching the service's own marker keeps the two answers alike.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/** What `setModule` accepts: one relationship, one of the five modules, and whether it is now shared. */
type SetModulePayload = Parameters<typeof mutations.coaching.setModule>[0]["payload"];

/**
 * The request body: the service's own four-field envelope around that payload.
 *
 * The payload schema is the mutation's type rather than a second object literal, because the mutation's
 * strict schema is the only validator of those fields — it answers an unknown key, a missing module and
 * a wrong flag type with per-field messages, all keyed on the field path the client sent. The envelope
 * itself stays strict, so a fifth top-level field is `invalid` rather than quietly dropped.
 */
const setModuleBodySchema = mutationInputSchema(z.custom<SetModulePayload>());

/** The attempt identity a body states, so a refusal can name the attempt the caller can replay. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/** The request body, or `undefined` when it is absent or is not valid JSON. */
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}

/** The attempt identity to report on a refusal, read defensively: a malformed body states none. */
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0
    ? identity.data.operationId
    : UNIDENTIFIED_ATTEMPT;
}

/**
 * Switches one module on or off for one relationship and answers with one of the eight outcomes.
 *
 * A stale revision is a `conflict` that preserves the submitted input, a replay is `alreadyAccepted`
 * with the stored result, and an ended episode refuses the toggle as a `conflict` rather than reviving
 * it. The four contract fields reach the mutation unchanged, so the recovery handle on an `unknown`
 * answer is the caller's own `operationId`.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const parsed = setModuleBodySchema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationIdentityOf(raw), parsed.error));
  }

  try {
    return toResponse(await mutations.coaching.setModule(parsed.data));
  } catch (error) {
    // A throw is a defect rather than a presentation: the service answers its refusals as outcomes, so
    // a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
