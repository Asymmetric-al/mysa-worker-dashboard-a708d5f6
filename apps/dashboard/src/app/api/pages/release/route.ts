/**
 * `POST /api/pages/release` — the four writes that carry one page edition from a frozen candidate to a
 * released edition: `submitForReview`, `approveCandidate`, `requestChanges` and `publishVariants`,
 * chosen by `payload.operation`.
 *
 * **The four members this path serves are the whole of the Page release ladder.** `submitForReview`
 * freezes one exact revision as the candidate under review, so what a reviewer answers cannot drift onto
 * a later draft; `approveCandidate` answers one candidate and no sibling edition; `requestChanges`
 * answers the same candidate with the note the author acts on; `publishVariants` releases the approved
 * candidates it names and reports the outcome per edition. They share this path because they are four
 * steps of one lifecycle over one page's editions, and each step's payload names the record that step
 * acts on — the revision, the candidate, the candidates — never a mode, a schedule or a recipient.
 *
 * **What this path deliberately does not serve.** `rejectCandidate` belongs to the Ministry Updates
 * review and has no Pages schema, so a body naming it is `invalid` at `payload.operation`.
 * `requestNotification` has no place on a Page at all: a page release sends nothing, and the review
 * payloads admit `publish-only` and nothing else, so no request here can ask for a notice.
 * `restoreRevisionAsDraft` is a restore rather than a review step and is not on the Pages row. Offering
 * any of them here would be a verb the plan does not name, and a page release that could notify would
 * present publication as delivery.
 *
 * **Publication is not delivery, and no payload can blur the two.** No field in these four payloads
 * names a recipient, a ceiling, a dedupe key, a message body, a provider or a send time; the answer is a
 * per-edition result with a revision, and an `unknown` outcome means the acknowledgement was lost, not
 * that a message was delivered. One edition failing leaves a sibling's prior-good release standing,
 * because each release is recorded for its own edition and there is no batch rollback.
 *
 * **`operation` is routing metadata, never a review field.** Only the discriminant is read first; the
 * chosen mutation's own closed schema is then given the whole body, and the discriminant is removed
 * before the payload is forwarded, because every payload schema in the service is strict and declares
 * no `operation`. A body naming a draft or section verb is `invalid` at `payload.operation` and reaches
 * no mutation.
 *
 * **Nothing here decides an answer.** `toResponse` is the application's only status ladder, so the
 * outcome the service chose is the status and the body a caller receives: 200 for a step that landed,
 * 403 for a refusal that reveals nothing about a candidate it could not admit, 409 for a stale revision
 * with the caller's input preserved, 422 with per-field messages keyed by the payload's own paths, 503
 * for an outage naming the source, 202 for a lost acknowledgement carrying the operation id. No payload
 * field is declared or re-validated here, and no status is chosen here.
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
 * The two refusals this file states itself: a body whose `payload.operation` names none of this path's
 * four steps, and a body that is not a JSON object at all. Every other refusal — a candidate this
 * reviewer may not answer, a stale revision, a mode that differs from the submission's — is the
 * service's own answer, in the service's own words.
 */
const MESSAGES = {
  operationRequired:
    "State which step this request takes as payload.operation: submitForReview, approveCandidate, requestChanges or publishVariants.",
  bodyNotJson:
    "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

/** The payload `submitForReview` accepts, taken from the mutation's own declaration. */
type SubmitForReviewPayload = Parameters<typeof mutations.pages.submitForReview>[1]["payload"];

/** The payload `approveCandidate` accepts, taken from the mutation's own declaration. */
type ApproveCandidatePayload = Parameters<typeof mutations.pages.approveCandidate>[1]["payload"];

/** The payload `requestChanges` accepts, taken from the mutation's own declaration. */
type RequestChangesPayload = Parameters<typeof mutations.pages.requestChanges>[1]["payload"];

/** The payload `publishVariants` accepts, taken from the mutation's own declaration. */
type PublishVariantsPayload = Parameters<typeof mutations.pages.publishVariants>[1]["payload"];

/**
 * A payload as it arrives on the wire: the mutation's own shape with the routing discriminant still on
 * it, so one schema serves both the envelope and the routing fact and `payloadOf` below removes the
 * discriminant before forwarding.
 */
type Routed<P> = P & { readonly operation: string };

/**
 * One request schema per step: the four-field envelope around that step's own payload.
 *
 * The payload is described by the service's type rather than by a second field list. The two answers to
 * a candidate happen to share one payload shape in the service, and that is the service's fact, not a
 * licence to answer both from one schema here: each is derived from its own mutation, so an answer that
 * stops being admitted at compile time fails at the call that would make it.
 */
const submitForReviewBodySchema = mutationInputSchema(z.custom<Routed<SubmitForReviewPayload>>());
const approveCandidateBodySchema = mutationInputSchema(z.custom<Routed<ApproveCandidatePayload>>());
const requestChangesBodySchema = mutationInputSchema(z.custom<Routed<RequestChangesPayload>>());
const publishVariantsBodySchema = mutationInputSchema(z.custom<Routed<PublishVariantsPayload>>());

/** The closed set of mutations this path dispatches, in the order the release ladder takes them. */
const RELEASE_OPERATIONS = [
  "submitForReview",
  "approveCandidate",
  "requestChanges",
  "publishVariants",
] as const;

/** The attempt identity a body states, so a refusal can name the attempt the caller can replay. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of this path's four steps.
 *
 * Only the discriminant is read at this point, so a body carrying other keys is not refused here: the
 * chosen step's own closed schema reports those against their own field paths. What this schema
 * guarantees is that the payload is an object naming a step this path serves, which is what makes the
 * switch below exhaustive and the forwarding safe.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(RELEASE_OPERATIONS, { error: MESSAGES.operationRequired }) },
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
 * The chosen step's schema is closed and declares no `operation` field, so leaving the discriminant in
 * place would turn every request into an unrecognised-key refusal. Removing it here is what keeps the
 * field a routing fact rather than a second description of a review answer.
 */
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

/**
 * Validates one body against one step's own schema, then calls exactly that mutation once.
 *
 * The four contract fields are forwarded untouched — `expectedRevision` and `operationId` included — so
 * a replay still answers with the stored result instead of freezing a second candidate or releasing
 * twice, and a stale revision still reaches the service as a `conflict`. Nothing is minted, bumped or
 * stripped, and a thrown fault is converted under this attempt's id instead of escaping the boundary.
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
 * One step of the page release ladder, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with its own status, so a client never infers success from
 * an absent error: a stale revision is a `conflict` that preserves the submitted input, a replay is
 * `alreadyAccepted` with the stored result, and a discriminant naming no step on this path is `invalid`
 * naming `payload.operation`. The answer never claims that a reader received anything: a release states
 * what this application now serves, and no notice, recipient or delivery is reported from here.
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
    case "submitForReview":
      return dispatch(submitForReviewBodySchema, raw, operationId, (input) =>
        mutations.pages.submitForReview(sessionId, input),
      );
    case "approveCandidate":
      return dispatch(approveCandidateBodySchema, raw, operationId, (input) =>
        mutations.pages.approveCandidate(sessionId, input),
      );
    case "requestChanges":
      return dispatch(requestChangesBodySchema, raw, operationId, (input) =>
        mutations.pages.requestChanges(sessionId, input),
      );
    case "publishVariants":
      return dispatch(publishVariantsBodySchema, raw, operationId, (input) =>
        mutations.pages.publishVariants(sessionId, input),
      );
    default:
      // Unreachable: the four steps above are the closed set the discriminant schema admits, so a fifth
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page release mutation");
  }
}
