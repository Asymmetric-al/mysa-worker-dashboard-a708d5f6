/**
 * `POST /api/pages/sections` — the six writes that compose one page draft's section list:
 * `addSection`, `moveSection`, `duplicateSection`, `removeSection`, `saveSectionFields` and
 * `applyPreset`, chosen by `payload.operation`.
 *
 * **They share this path because they change one thing: the draft edition's ordered sections.** Every
 * payload names the draft edition it edits — by its draft revision or by the variant that holds it —
 * and then one section, or the position one takes, or one section's fields and presentation. The
 * service resolves the edition and applies the change to that draft alone, so a released edition keeps
 * the sections it was released with and composing never edits what readers are served.
 *
 * **`applyPreset` is owned here, and nowhere else.** A preset proposes a starting composition: the
 * catalogue declares it (`readPageCatalogues`), and applying one composes the sections it names into
 * the draft with that type's empty fields and the profile's opening presentation. It therefore writes
 * exactly what `addSection` writes, repeatedly, into the same record and under the same containment
 * rule — and it creates a reviewable draft and releases nothing. The path that names the page keeps the
 * edition-level writes (`createVariant`, `saveDraft`); a preset applied there would be the one write on
 * that path that changes a section list.
 *
 * **`operation` is routing metadata, never a section field.** Only the discriminant is read first; the
 * chosen mutation's own closed schema is then given the whole body, and the discriminant is removed
 * before the payload is forwarded, because every payload schema in the service is strict and declares
 * no `operation`. A body naming a release, withdrawal, reach or media verb is `invalid` at
 * `payload.operation` and reaches no mutation — which is also why no composing request can publish,
 * withdraw or notify: none of those verbs exists on this path.
 *
 * **Position is always stated, never dragged.** `moveSection` carries the zero-based position the
 * section takes, so a keyboard user and a pointer user submit the same payload and the builder needs no
 * continuous pointer movement (WCAG 2.2 — Dragging Movements). A copy lands after the section it copies
 * because that is the mutation's own behaviour, and a removal takes a reference out of the draft while
 * leaving the media it placed registered.
 *
 * **Nothing here decides an answer.** `toResponse` is the application's only status ladder, so the
 * outcome the service chose is the status and the body a caller receives: 200 for an applied change,
 * 403 for a refusal that carries no title or count, 409 for a stale revision with the caller's input
 * preserved, 422 with per-field messages keyed by the payload's own paths, 503 for an outage naming the
 * source, 202 for a lost acknowledgement with the operation id. No payload field is declared or
 * re-validated here, and no status is chosen here.
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
 * The two refusals this file states itself: a body whose `payload.operation` names no section mutation,
 * and a body that is not a JSON object at all. Every other refusal is the service's own answer, in the
 * service's own words.
 */
const MESSAGES = {
  operationRequired:
    "State which change this request makes as payload.operation: addSection, moveSection, duplicateSection, removeSection, saveSectionFields or applyPreset.",
  bodyNotJson:
    "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

/** The payload `addSection` accepts, taken from the mutation's own declaration. */
type AddSectionPayload = Parameters<typeof mutations.pages.addSection>[1]["payload"];

/** The payload `moveSection` accepts, taken from the mutation's own declaration. */
type MoveSectionPayload = Parameters<typeof mutations.pages.moveSection>[1]["payload"];

/** The payload `duplicateSection` accepts, taken from the mutation's own declaration. */
type DuplicateSectionPayload = Parameters<typeof mutations.pages.duplicateSection>[1]["payload"];

/** The payload `removeSection` accepts, taken from the mutation's own declaration. */
type RemoveSectionPayload = Parameters<typeof mutations.pages.removeSection>[1]["payload"];

/** The payload `saveSectionFields` accepts, taken from the mutation's own declaration. */
type SaveSectionFieldsPayload = Parameters<typeof mutations.pages.saveSectionFields>[1]["payload"];

/** The payload `applyPreset` accepts, taken from the mutation's own declaration. */
type ApplyPresetPayload = Parameters<typeof mutations.pages.applyPreset>[1]["payload"];

/**
 * A payload as it arrives on the wire: the mutation's own shape with the routing discriminant still on
 * it, so one schema serves both the envelope and the routing fact and `payloadOf` below removes the
 * discriminant before forwarding.
 */
type Routed<P> = P & { readonly operation: string };

/**
 * One request schema per mutation: the four-field envelope around that mutation's own payload.
 *
 * The payload is described by the service's type rather than by a second field list, because the
 * mutation re-validates every field under identical constraints — a field key a section type does not
 * own, a position that is not a whole number, a preset the catalogue does not propose, and a
 * presentation choice outside the four admitted ones are all its answers, given once.
 */
const addSectionBodySchema = mutationInputSchema(z.custom<Routed<AddSectionPayload>>());
const moveSectionBodySchema = mutationInputSchema(z.custom<Routed<MoveSectionPayload>>());
const duplicateSectionBodySchema = mutationInputSchema(z.custom<Routed<DuplicateSectionPayload>>());
const removeSectionBodySchema = mutationInputSchema(z.custom<Routed<RemoveSectionPayload>>());
const saveSectionFieldsBodySchema = mutationInputSchema(
  z.custom<Routed<SaveSectionFieldsPayload>>(),
);
const applyPresetBodySchema = mutationInputSchema(z.custom<Routed<ApplyPresetPayload>>());

/** The closed set of mutations this path dispatches, in the order the payload schemas declare them. */
const SECTION_OPERATIONS = [
  "addSection",
  "moveSection",
  "duplicateSection",
  "removeSection",
  "saveSectionFields",
  "applyPreset",
] as const;

/** The attempt identity a body states, so a refusal can name the attempt the caller can replay. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of this path's six names.
 *
 * Only the discriminant is read at this point, so a body carrying other keys is not refused here: the
 * chosen mutation's own closed schema reports those against their own field paths. What this schema
 * guarantees is that the payload is an object naming a mutation this path serves, which is what makes
 * the switch below exhaustive and the forwarding safe.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(SECTION_OPERATIONS, { error: MESSAGES.operationRequired }) },
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
 * field a routing fact rather than a second description of a section.
 */
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

/**
 * Validates one body against one mutation's own schema, then calls exactly that mutation once.
 *
 * The four contract fields are forwarded untouched — `expectedRevision` and `operationId` included — so
 * a replay still answers with the stored result instead of adding a second section, and a stale
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
 * One named section mutation, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with its own status, so a client never infers success from
 * an absent error: a stale revision is a `conflict` that preserves the submitted input, a replay is
 * `alreadyAccepted` with the stored result, a change that would write exactly what stands is
 * `unchanged`, and a discriminant naming no mutation on this path is `invalid` naming
 * `payload.operation`. Composing changes the draft's structure only: adding, moving, copying, removing,
 * editing or applying a preset publishes nothing, places no notice and alters no subject, consent or
 * giving binding.
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
    case "addSection":
      return dispatch(addSectionBodySchema, raw, operationId, (input) =>
        mutations.pages.addSection(sessionId, input),
      );
    case "moveSection":
      return dispatch(moveSectionBodySchema, raw, operationId, (input) =>
        mutations.pages.moveSection(sessionId, input),
      );
    case "duplicateSection":
      return dispatch(duplicateSectionBodySchema, raw, operationId, (input) =>
        mutations.pages.duplicateSection(sessionId, input),
      );
    case "removeSection":
      return dispatch(removeSectionBodySchema, raw, operationId, (input) =>
        mutations.pages.removeSection(sessionId, input),
      );
    case "saveSectionFields":
      return dispatch(saveSectionFieldsBodySchema, raw, operationId, (input) =>
        mutations.pages.saveSectionFields(sessionId, input),
      );
    case "applyPreset":
      return dispatch(applyPresetBodySchema, raw, operationId, (input) =>
        mutations.pages.applyPreset(sessionId, input),
      );
    default:
      // Unreachable: the six names above are the closed set the discriminant schema admits, so a seventh
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page section mutation");
  }
}
