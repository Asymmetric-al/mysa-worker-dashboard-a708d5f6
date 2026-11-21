/**
 * `POST /api/pages/withdraw` — the two withdrawals of a Worker or Project Page: `withdrawPage`, which
 * contains every released edition of the page, and `withdrawLocale`, which contains exactly one language
 * edition and leaves its siblings released. The mutation is chosen by `payload.operation`.
 *
 * **Two withdrawals, one unit each, and never each other.** `withdrawPage` names the page and walks its
 * release heads, so every locale edition stops being served at one instant — including an edition whose
 * sibling draft is invalid, because containment does not wait for editorial repair. `withdrawLocale`
 * names one edition (its variant), so withdrawing Arabic cannot end French and cannot mean the wider
 * withdrawal. Neither payload names an audience, a reach value, a publication or a message, which is why
 * no request here can be read as the other withdrawal or as a re-release.
 *
 * **Containment, not recall.** A withdrawal stops what this application serves: the addresses answer a
 * short notice and the discovery list stops naming the page. It recalls no copy a reader already holds
 * and no message already submitted, and the tombstone it leaves carries no identifying content — so the
 * answer reports a withdrawal, never a delivery, a deletion or a recall. That distinction is why these
 * two verbs are separate from `publishVariants` on the release path rather than a mode of it.
 *
 * **`operation` is routing metadata, never a withdrawal field.** Only the discriminant is read first;
 * the chosen mutation's own closed schema is then given the whole body, and the discriminant is removed
 * before the payload is forwarded, because both payload schemas in the service are strict and declare no
 * `operation`. A body naming a section, review or reach verb is `invalid` at `payload.operation` and
 * reaches no mutation.
 *
 * **Nothing here decides an answer.** `toResponse` is the application's only status ladder, so the
 * outcome the service chose is the status and the body a caller receives: 200 for a containment that
 * landed, 403 for a refusal that reveals nothing about a record it could not admit, 409 for a stale
 * revision with the caller's input preserved, 422 with per-field messages keyed by the payload's own
 * paths, 503 for an outage naming the source, 202 for a lost acknowledgement carrying the operation id
 * and no promise either way. No payload field is declared or re-validated here, and no status is chosen
 * here.
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
 * The two refusals this file states itself: a body whose `payload.operation` names neither withdrawal,
 * and a body that is not a JSON object at all. Every other refusal — a page this caller may not
 * withdraw, a stale revision — is the service's own answer, in the service's own words.
 */
const MESSAGES = {
  operationRequired:
    "State which withdrawal this request makes as payload.operation: withdrawPage or withdrawLocale.",
  bodyNotJson:
    "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

/** The payload `withdrawPage` accepts, taken from the mutation's own declaration. */
type WithdrawPagePayload = Parameters<typeof mutations.pages.withdrawPage>[1]["payload"];

/** The payload `withdrawLocale` accepts, taken from the mutation's own declaration. */
type WithdrawLocalePayload = Parameters<typeof mutations.pages.withdrawLocale>[1]["payload"];

/**
 * A payload as it arrives on the wire: the mutation's own shape with the routing discriminant still on
 * it, so one schema serves both the envelope and the routing fact and `payloadOf` below removes the
 * discriminant before forwarding.
 */
type Routed<P> = P & { readonly operation: string };

/**
 * One request schema per withdrawal: the four-field envelope around that withdrawal's own payload.
 *
 * The payload is described by the service's type rather than by a second field list, because the
 * service re-validates it under the same constraints: a missing page or variant identity, and any key
 * the withdrawal does not carry, are its answers, given once on the field's own path.
 */
const withdrawPageBodySchema = mutationInputSchema(z.custom<Routed<WithdrawPagePayload>>());
const withdrawLocaleBodySchema = mutationInputSchema(z.custom<Routed<WithdrawLocalePayload>>());

/** The closed set of mutations this path dispatches: the page-wide withdrawal, then the one edition. */
const WITHDRAW_OPERATIONS = ["withdrawPage", "withdrawLocale"] as const;

/** The attempt identity a body states, so a refusal can name the attempt the caller can replay. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of this path's two names.
 *
 * Only the discriminant is read at this point, so a body carrying other keys is not refused here: the
 * chosen withdrawal's own closed schema reports those against their own field paths. What this schema
 * guarantees is that the payload is an object naming a withdrawal this path serves, which is what makes
 * the switch below exhaustive and the forwarding safe.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(WITHDRAW_OPERATIONS, { error: MESSAGES.operationRequired }) },
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
 * Both withdrawal schemas in the service are closed and declare no `operation` field, so leaving the
 * discriminant in place would turn every request into an unrecognised-key refusal. Removing it here is
 * what keeps the field a routing fact rather than a second description of a withdrawal.
 */
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

/**
 * Validates one body against one withdrawal's own schema, then calls exactly that mutation once.
 *
 * The four contract fields are forwarded untouched — `expectedRevision` and `operationId` included — so
 * a replay still answers with the stored result instead of withdrawing a second time, and a stale
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
 * One named withdrawal, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with its own status, so a client never infers success from
 * an absent error: a stale revision is a `conflict` that preserves the submitted input, a replay is
 * `alreadyAccepted` with the stored result, and a discriminant naming no withdrawal on this path is
 * `invalid` naming `payload.operation`. The answer reports what this application stopped serving; it
 * makes no claim about a copy a reader holds or a message already submitted.
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
    case "withdrawPage":
      return dispatch(withdrawPageBodySchema, raw, operationId, (input) =>
        mutations.pages.withdrawPage(sessionId, input),
      );
    case "withdrawLocale":
      return dispatch(withdrawLocaleBodySchema, raw, operationId, (input) =>
        mutations.pages.withdrawLocale(sessionId, input),
      );
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page withdrawal");
  }
}
