/**
 * The Worker and Project Pages family's own read path and its two edition-level writes:
 * `GET /api/pages` and `POST /api/pages`.
 *
 * **One path, two reads, selected by the query alone.** A request that states `pageId` is answered by
 * `reads.pages.readPage` for that page: its family and kind, the fields a source locks with the reason
 * for each, its giving binding, the draft edition's ordered sections, the presets, every locale
 * edition's own draft/candidate/release pointers, and the reach values a release may carry. A request
 * that states no `pageId` is answered by `reads.pages.readPageCatalogues`: the two guided family
 * catalogues, the eight admitted section types with the fields and bounded presentation choices each
 * admits, which of them a source supplies, the structural operations that stand in for dragging, and
 * the presets that propose a composition. The catalogue is a declaration about the family rather than
 * about one page, which is why the absence of a page is the selector instead of a second path; a
 * `pageId` that is present but empty is forwarded as stated, so the page read — never this file — is
 * what refuses it. No other search parameter is read: one this file does not name changes no answer.
 *
 * **The write carries two named mutations, chosen by `payload.operation`.** `createVariant` adds one
 * exact locale edition of a page with no draft, candidate or release yet, so editing one language can
 * never overwrite another's draft or advance another's release; `saveDraft` moves that edition's draft
 * pointer and leaves its candidate pointer and release head untouched. Both are edition-level facts,
 * which is why they share the path that names the page, while the section, release, withdrawal and
 * reach writes each have their own path beside this one.
 *
 * **`operation` is routing metadata, never a page field.** Only the discriminant is read first; the
 * chosen mutation's own closed schema is then given the whole body, and the discriminant is removed
 * before the payload is forwarded, because every payload schema in the service is strict and declares
 * no `operation`. A body naming any other mutation is `invalid` at `payload.operation` and reaches no
 * mutation, so a section, review or reach verb addressed here is refused by name rather than applied
 * as something else.
 *
 * **Nothing here decides an answer.** `toResponse` is the application's only status ladder, so the
 * outcome the service chose is the status and the body a caller receives: an envelope is 200, a denial
 * 403 carrying no count, title or existence hint, an outage 503 naming the source and the safe retry, a
 * stale revision 409 with the caller's input preserved, a validation failure 422 with per-field
 * messages keyed by the payload's own paths, a lost acknowledgement 202 with the operation id and no
 * promise either way. No payload field is declared or re-validated here, so a field the service refuses
 * is described once, by the service, on the field's own path.
 *
 * **The acting session is the request's own, and it is forwarded as a claim.** The content mutations
 * take the session they act for as an argument, so this transport passes the development-session
 * cookie exactly as the request carries it, and the empty string when it carries none. The service
 * re-resolves the same cookie, compares the two, and answers `denied`/`not-admitted` when they differ,
 * so no body, query or header can name a session here: this file forwards an identity the service
 * verifies. The cookie's wire name is stated once below because a route may not import the store that
 * owns it — the enforced layering rule in `.oxlintrc.json` — and the value carries no scope, no
 * principal and no authority of its own.
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
  reads,
  toResponse,
  type MutationInput,
  type MutationOutcome,
} from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";

// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// The read resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";

/**
 * The marker the service puts on an attempt that carries no identity of its own.
 *
 * An `invalid` answer still names an attempt, and a body so malformed that it states no `operationId`
 * has no other identity to report. Matching the service's own marker keeps the two answers alike.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/** A read has no attempt to replay, so its failure marker matches the one the reads modules state. */
const READ_ATTEMPT_ID = "read";
/**
 * The two refusals this file states itself.
 *
 * Both describe a request the transport had to refuse before any mutation saw it: a body whose
 * `payload.operation` names no mutation on this path, and a body that is not a JSON object at all. Every
 * other refusal — a field of the wrong shape, a stale revision, a refused scope — is the service's own
 * answer, in the service's own words, and is deliberately not restated here.
 */
const MESSAGES = {
  operationRequired:
    "State which change this request makes as payload.operation: createVariant or saveDraft.",
  bodyNotJson:
    "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

/** The payload `createVariant` accepts, taken from the mutation's own declaration. */
type CreateVariantPayload = Parameters<typeof mutations.pages.createVariant>[1]["payload"];

/** The payload `saveDraft` accepts, taken from the mutation's own declaration. */
type SaveDraftPayload = Parameters<typeof mutations.pages.saveDraft>[1]["payload"];

/**
 * A payload as it arrives on the wire: the mutation's own shape with the routing discriminant still on
 * it.
 *
 * The intersection is what lets one schema serve both jobs. `mutationInputSchema` validates the four
 * fields every mutation presents, this type keeps the discriminant the transport reads, and `payloadOf`
 * below removes it again — so the payload that reaches the service is exactly the shape its own strict
 * schema validates, with no field added, renamed or defaulted on the way.
 */
type Routed<P> = P & { readonly operation: string };

/**
 * One request schema per mutation: the four-field envelope around that mutation's own payload.
 *
 * The payload is described by the service's type rather than by a second field list, because the
 * mutation re-validates every field under identical constraints. Restating a length, a bound or a
 * vocabulary here would make this file a second owner of the same rule, and the two would eventually
 * disagree about which of them a worker is being told about.
 */
const createVariantBodySchema = mutationInputSchema(z.custom<Routed<CreateVariantPayload>>());
const saveDraftBodySchema = mutationInputSchema(z.custom<Routed<SaveDraftPayload>>());

/** The closed set of mutations this path dispatches, in the order the payload schemas declare them. */
const PAGE_OPERATIONS = ["createVariant", "saveDraft"] as const;

/** The attempt identity a body states, so a refusal can name the attempt the caller can replay. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of this path's two names.
 *
 * Only the discriminant is read at this point, so a body carrying other keys is not refused here: the
 * chosen mutation's own closed schema reports those against their own field paths. What this schema
 * guarantees is that the payload is an object naming a mutation this path serves, which is what makes
 * the switch below exhaustive and the forwarding below safe.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(PAGE_OPERATIONS, { error: MESSAGES.operationRequired }) },
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
 * The chosen mutation's schema is closed and declares no `operation` field, so leaving the discriminant
 * in place would turn every request into an unrecognised-key refusal. Removing it here is what keeps the
 * field a routing fact rather than a second description of a page edition.
 */
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

/**
 * Validates one body against one mutation's own schema, then calls exactly that mutation once.
 *
 * The four contract fields are forwarded untouched — `expectedRevision` and `operationId` included — so
 * a replay still answers with the stored result instead of applying a second effect, and a stale
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
 * The page the request addresses, or the family's catalogues when it addresses none.
 *
 * The answer is always one envelope — `data`, `scope`, `source`, `revision`, `asOf`, `coverage`,
 * `valueStates`, `actions` — never a bare record and never a handler-computed list. A denial carries no
 * title, count or existence hint, and an unavailable source is neither an empty catalogue nor an empty
 * edition.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const pageId = new URL(request.url).searchParams.get("pageId");
  try {
    return toResponse(
      pageId === null
        ? await reads.pages.readPageCatalogues()
        : await reads.pages.readPage({ pageId }),
    );
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and
    // a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}

/**
 * One named page-edition mutation, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with its own status, so a client never infers success from
 * an absent error: a stale revision is a `conflict` that preserves the submitted input, a replay is
 * `alreadyAccepted` with the stored result, and a discriminant naming no mutation on this path is
 * `invalid` naming `payload.operation`. Composing or saving here publishes nothing: `createVariant`
 * creates an edition with no release and `saveDraft` moves one draft pointer.
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
    case "createVariant":
      return dispatch(createVariantBodySchema, raw, operationId, (input) =>
        mutations.pages.createVariant(sessionId, input),
      );
    case "saveDraft":
      return dispatch(saveDraftBodySchema, raw, operationId, (input) =>
        mutations.pages.saveDraft(sessionId, input),
      );
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page edition mutation");
  }
}
