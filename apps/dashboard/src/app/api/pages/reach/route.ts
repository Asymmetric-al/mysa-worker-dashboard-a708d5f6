/**
 * `POST /api/pages/reach` — how far a released page reaches: `setReach`, which gives every released
 * edition of one page the reach the worker chose, and `stopShowingPublicly`, which contains it. The
 * mutation is chosen by `payload.operation`.
 *
 * **Reach is exactly three values and nothing else.** `not-public`, `link-public` and `listed` are the
 * whole vocabulary — no custom visibility, no password, no date range, no per-edition override — and the
 * set is declared once in the content module and read by the service's own payload schema, so a fourth
 * value is refused there rather than filtered here. `setReach` names the page, and the service applies
 * that reach to every released edition the page holds, because reach is carried on the release record:
 * a locale edition is never addressed on its own here, and a page's released editions reach as a set.
 *
 * **`stopShowingPublicly` names the same unit for the opposite reason.** It contains every edition of the
 * page at one instant, in every locale and audience, and it completes while an unrelated draft of that
 * page is still invalid, because containment never waits for editorial repair. It recalls no copy a
 * reader already holds, and the tombstone it leaves carries no identifying content.
 *
 * **The containment acknowledgement is a browser-side confirmation, never a wire field.** The worker must
 * be told, and must confirm, that stopping public display hides every language edition; the service's
 * payload for that mutation is the page identity alone and is a closed object, so an acknowledgement key
 * posted beside it would be `invalid`. This file therefore declares no `confirmed`, `acknowledged` or
 * `reason` field — the family's own form schema collects the confirmation and transforms it away before
 * the four-field input is posted.
 *
 * **Choosing a reach is neither publication nor notification.** These two payloads carry a page and one
 * of three reach values; none carries a publish, notify, send, schedule, provider or recipient field, and
 * no answer here can claim that a message was submitted or a reader's copy recalled. Reach changes what
 * this application serves and nothing outside it.
 *
 * **`operation` is routing metadata, never a page field.** Only the discriminant is read first; the
 * chosen mutation's own closed schema is then given the whole body, and the discriminant is removed
 * before the payload is forwarded, because both payload schemas in the service are strict and declare no
 * `operation`. A body naming a section, review or withdrawal verb is `invalid` at `payload.operation` and
 * reaches no mutation.
 *
 * **Nothing here decides an answer.** `toResponse` is the application's only status ladder, so the
 * outcome the service chose is the status and the body a caller receives: 200 for a reach change that
 * landed, 403 for a refusal that reveals nothing about a record it could not admit, 409 for a stale
 * revision with the caller's input preserved, 422 with per-field messages keyed by the payload's own
 * paths, 503 for an outage naming the source, 202 for a lost acknowledgement carrying the operation id.
 * No payload field is declared or re-validated here, and no status is chosen here.
 *
 * **The acting session is the request's own, and it is forwarded as a claim.** The content mutations
 * take the session they act for as an argument, so this transport passes the development-session cookie
 * exactly as the request carries it, and the empty string when it carries none. The service re-resolves
 * the same cookie, compares, and answers `denied`/`not-admitted` when the two differ, so nothing in the
 * request can name a session. The cookie's wire name is stated once below because a route may not import
 * the store that owns it (the enforced layering rule in `.oxlintrc.json`).
 *
 * **Layering.** `app/api → modules/data-service`. This file imports the service's barrel, the contract
 * types it needs, `@/lib/result` for its exhaustiveness check, and nothing deeper: never the store,
 * never a read or mutation module, never a feature, a component or the clock.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { assertNever } from "@/lib/result";
import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  toResponse,
  type MutationInput,
  type MutationOutcome,
} from "@/modules/data-service";
import { sessionIdOf } from "../../session-cookie";

// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every mutation resolves the development session and the scenario clock per request.
export const dynamic = "force-dynamic";

/**
 * The marker the service puts on an attempt that carries no identity of its own.
 *
 * An `invalid` answer still names an attempt, and a body so malformed that it states no `operationId`
 * has no other identity to report. Matching the service's own marker keeps the two answers alike.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
/**
 * The two refusals this file states itself: a body whose `payload.operation` names neither reach
 * mutation, and a body that is not a JSON object at all. Every other refusal — a reach value outside the
 * three, a page this caller may not change, a stale revision — is the service's own answer, in the
 * service's own words.
 */
const MESSAGES = {
  operationRequired:
    "State which reach change this request makes as payload.operation: setReach or stopShowingPublicly.",
  bodyNotJson:
    "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

/** The payload `setReach` accepts, taken from the mutation's own declaration. */
type SetReachPayload = Parameters<typeof mutations.pages.setReach>[1]["payload"];

/** The payload `stopShowingPublicly` accepts, taken from the mutation's own declaration. */
type StopShowingPubliclyPayload = Parameters<
  typeof mutations.pages.stopShowingPublicly
>[1]["payload"];

/**
 * A payload as it arrives on the wire: the mutation's own shape with the routing discriminant still on
 * it, so one schema serves both the envelope and the routing fact and `payloadOf` below removes the
 * discriminant before forwarding.
 */
type Routed<P> = P & { readonly operation: string };

/**
 * One request schema per reach mutation: the four-field envelope around that mutation's own payload.
 *
 * The payload is described by the service's type rather than by a second field list, because the service
 * re-validates it under the same constraints — the three reach values, the page identity it requires and
 * any key the mutation does not carry are its answers, given once on the field's own path.
 */
const setReachBodySchema = mutationInputSchema(z.custom<Routed<SetReachPayload>>());
const stopShowingPubliclyBodySchema = mutationInputSchema(
  z.custom<Routed<StopShowingPubliclyPayload>>(),
);

/** The closed set of mutations this path dispatches: choosing a reach, then containing the page. */
const REACH_OPERATIONS = ["setReach", "stopShowingPublicly"] as const;

/** The attempt identity a body states, so a refusal can name the attempt the caller can replay. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of this path's two names.
 *
 * Only the discriminant is read at this point, so a body carrying other keys is not refused here: the
 * chosen mutation's own closed schema reports those against their own field paths. What this schema
 * guarantees is that the payload is an object naming a mutation this path serves, which is what makes
 * the switch below exhaustive and the forwarding safe.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(REACH_OPERATIONS, { error: MESSAGES.operationRequired }) },
      { error: MESSAGES.operationRequired },
    ),
  },
  { error: MESSAGES.bodyNotJson },
);

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
 * The payload a mutation receives: the routing discriminant removed, everything else as stated.
 *
 * Both reach schemas in the service are closed and declare no `operation` field, so leaving the
 * discriminant in place would turn every request into an unrecognised-key refusal. Removing it here is
 * what keeps the field a routing fact rather than a second description of a reach setting.
 */
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

/**
 * Validates one body against one mutation's own schema, then calls exactly that mutation once.
 *
 * The four contract fields are forwarded untouched — `expectedRevision` and `operationId` included — so
 * a replay still answers with the stored result instead of applying the reach twice, and a stale
 * revision still reaches the service as a `conflict`. Nothing is minted, bumped or stripped, and a
 * thrown fault is converted under this attempt's id instead of escaping the boundary.
 */
async function dispatch<P extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<P>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<P, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    // An exception here is a defect rather than a presentation: the service answers refusals as
    // outcomes, so a throw means a store fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(operationId, error));
  }
}

/**
 * One named reach change, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with its own status, so a client never infers success from
 * an absent error: a stale revision is a `conflict` that preserves the submitted input, a replay is
 * `alreadyAccepted` with the stored result, a reach already in force is `unchanged`, and a discriminant
 * naming no mutation on this path is `invalid` naming `payload.operation`. The answer reports the reach
 * this application now serves, per edition, and never presents a reach change as a publication, a
 * notice or a recall.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const sessionId = sessionIdOf(request);
  const claimed = discriminantSchema.safeParse(raw);

  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }

  switch (claimed.data.payload.operation) {
    case "setReach":
      return dispatch(setReachBodySchema, raw, operationId, (input) =>
        mutations.pages.setReach(sessionId, input),
      );
    case "stopShowingPublicly":
      return dispatch(stopShowingPubliclyBodySchema, raw, operationId, (input) =>
        mutations.pages.stopShowingPublicly(sessionId, input),
      );
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page reach change");
  }
}
