/**
 * `GET /api/drafts` — one edition's working draft or its frozen candidate — and `POST /api/drafts`,
 * the two prose writes that move a draft: saving it, and restoring an earlier revision as a new draft.
 *
 * The transport carries no content rule, no permission decision and no revision handling of its own.
 * The two named reads and the two named mutations it calls own all three, which is what keeps a saved
 * draft from ever becoming a release and keeps a candidate the same frozen object the review step
 * answers. Nothing here reviews, publishes, notifies or subscribes anyone.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { assertNever } from "@/lib/result";
import { PRESENTATION_CHOICES } from "@/modules/content/document";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { RENDITION_PURPOSES } from "@/modules/media/asset";
/**
 * The transport layer's one declaration of how a request's development session is read. Both mutations
 * take the session id as an argument, so this handler passes the id that helper reads rather than
 * restating the cookie name or reading the request headers for a session the service resolves again.
 */
import { sessionIdOf } from "../session-cookie";
// The synthetic store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every request is evaluated per request: the read resolves the development session and the scenario
// clock, and a draft or a candidate must never be served from a cache across a persona switch or a
// revision change.
export const dynamic = "force-dynamic";
/** The attempt identity an answer carries when the request named none: nothing was attempted, so nothing is recoverable under an id the request never sent. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
/** The attempt identity a read refusal carries: a read makes no change, so it has no operation to recover. */
const READ_ATTEMPT_ID = "read";
/** The largest request this transport reads, counted in UTF-8 bytes: an autosave carries prose and asset references, never media bytes, so a larger body is a mistake rather than a draft. */
const REQUEST_BYTE_LIMIT = 1_048_576;
/** The reference bound the service's own record identities use, restated because a payload is validated here before the service sees it. */
const REFERENCE_MAX_LENGTH = 160;
/** The checksum bound the service holds. */
const CHECKSUM_MAX_LENGTH = 96;
/** As many media placements as one draft plausibly carries; a longer list is refused rather than truncated. */
const MEDIA_PLACEMENTS_MAX = 64;

const UTF8 = new TextEncoder();

const MESSAGES = {
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  bodyTooLarge: `A draft request carries prose and media references rather than media bytes, so a body over ${String(REQUEST_BYTE_LIMIT)} bytes is refused before it is read: nothing was saved and the editor's own text is untouched.`,
  payloadMissing: "State the change this request makes as payload, carrying the operation it asks for as payload.operation.",
  operationRequired: 'State which change this request makes as payload.operation: "saveDraft" or "restoreRevisionAsDraft".',
  queryInvalid: "Send the draft read as a query carrying view=draft or view=candidate and the variantId of the edition it addresses.",
  viewRequired: "State which content state this read asks for as view=draft or view=candidate.",
  variantIdRequired: "State the edition this request addresses as variantId: a working draft and a frozen candidate are both read through the edition that holds them.",
  referenceTooLong: `A reference in this request is longer than the ${String(REFERENCE_MAX_LENGTH)} characters any record identity here holds, so open the record from its list rather than pasting an address.`,
  revisionIdRequired: "State which earlier revision to copy into a new draft as revisionId.",
  assetIdRequired: "State which registered media asset a placement uses as assetId.",
  placementPurpose: "Choose the rendition a placement uses: display, playback, poster, captions or transcript.",
  placementsTooMany: `A draft carries at most ${String(MEDIA_PLACEMENTS_MAX)} media placements, so remove the placements this draft does not need rather than saving a longer list.`,
  checksumInvalid: "A checksum is either left out or stated as the value the editor holds for the body it is saving.",
  bodyRequired: "A saved draft carries the document body, so save it from the editor rather than here.",
} as const;
/**
 * The four bounded presentation choices a section may state, taken from the content profile's single
 * declaration: this schema refuses an out-of-set value before the service sees the payload, and a
 * choice the profile admits reaches this walk in the same change rather than being refused here.
 */
type PresentationField = keyof typeof PRESENTATION_CHOICES;

const PRESENTATION_LABELS: Readonly<Record<PresentationField, string>> = {
  treatment: "text treatment",
  layout: "layout",
  alignment: "alignment",
  imageFit: "image fit",
};
/** The refusal one out-of-set presentation value receives, naming the admitted set it must be drawn from. */
function presentationRefusal(field: PresentationField, admitted: readonly string[]): string {
  return `A ${PRESENTATION_LABELS[field]} is one of the admitted presentations, ${admitted.join(" or ")}. Any other value is refused here rather than accepted and styled, so choose one of them.`;
}
function isPresentationField(key: string): key is PresentationField {
  return Object.hasOwn(PRESENTATION_CHOICES, key);
}
/** One presentation value the draft body states outside its admitted set, at the path the body holds it. */
interface PresentationIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}
/**
 * Walks the draft body for presentation values and refuses any outside its admitted set.
 *
 * The body is read as the opaque JSON the editor produced: nothing is parsed into a document model,
 * normalised or re-serialised, so the shape the service then validates is exactly the shape the editor
 * authored. The walk is iterative rather than recursive so a deeply nested body cannot exhaust the
 * stack, and the transport's byte ceiling bounds how much of a body there is to walk.
 */
function presentationIssuesIn(body: unknown): readonly PresentationIssue[] {
  const issues: PresentationIssue[] = [];
  const pending: { readonly node: unknown; readonly path: readonly (string | number)[] }[] = [{ node: body, path: [] }];
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const { node, path } = entry;
    if (Array.isArray(node)) {
      node.forEach((child, index) => {
        pending.push({ node: child, path: [...path, index] });
      });
      continue;
    }
    if (!isRecord(node)) {
      continue;
    }
    for (const [key, child] of Object.entries(node)) {
      if (isPresentationField(key)) {
        const admitted: readonly string[] = PRESENTATION_CHOICES[key];
        if (typeof child !== "string" || !admitted.includes(child)) {
          issues.push({ path: [...path, key], message: presentationRefusal(key, admitted) });
        }
        // A presentation value is a scalar, so there is nothing beneath it to walk.
        continue;
      }
      pending.push({ node: child, path: [...path, key] });
    }
  }
  return issues;
}

// The identifiers a payload may name: opaque, bounded, and never a name, an address or an email
const editionReferenceSchema = z.string({ error: MESSAGES.variantIdRequired }).trim().min(1, MESSAGES.variantIdRequired).max(REFERENCE_MAX_LENGTH, MESSAGES.referenceTooLong);

const revisionReferenceSchema = z.string({ error: MESSAGES.revisionIdRequired }).trim().min(1, MESSAGES.revisionIdRequired).max(REFERENCE_MAX_LENGTH, MESSAGES.referenceTooLong);

const assetReferenceSchema = z.string({ error: MESSAGES.assetIdRequired }).trim().min(1, MESSAGES.assetIdRequired).max(REFERENCE_MAX_LENGTH, MESSAGES.referenceTooLong);

const checksumSchema = z.string({ error: MESSAGES.checksumInvalid }).trim().min(1, MESSAGES.checksumInvalid).max(CHECKSUM_MAX_LENGTH, MESSAGES.checksumInvalid);
// The five renditions a draft placement may name, taken from the media module's one purpose set
const mediaPlacementRefSchema = z.strictObject({
  assetId: assetReferenceSchema,
  purpose: z.enum(RENDITION_PURPOSES, { error: MESSAGES.placementPurpose }),
});
// The two payloads, each closed and each naming the one effect it asks for
const saveDraftPayloadSchema = z
  .strictObject({
    operation: z.literal("saveDraft", { error: MESSAGES.operationRequired }),
    variantId: editionReferenceSchema,
    body: z.unknown(),
    contentChecksum: checksumSchema.optional(),
    mediaPlacements: z.array(mediaPlacementRefSchema).max(MEDIA_PLACEMENTS_MAX, MESSAGES.placementsTooMany).optional(),
  })
  .superRefine((payload, context) => {
    if (!Object.hasOwn(payload, "body") || payload.body === undefined) {
      context.addIssue({ code: "custom", path: ["body"], message: MESSAGES.bodyRequired });
      return;
    }
    for (const issue of presentationIssuesIn(payload.body)) {
      context.addIssue({ code: "custom", path: ["body", ...issue.path], message: issue.message });
    }
  });

const restoreRevisionAsDraftPayloadSchema = z.strictObject({
  operation: z.literal("restoreRevisionAsDraft", { error: MESSAGES.operationRequired }),
  revisionId: revisionReferenceSchema,
});
// One body schema per mutation: the four-field envelope, with that mutation's own payload
const saveDraftRequestSchema = mutationInputSchema(saveDraftPayloadSchema);

const restoreRevisionAsDraftRequestSchema = mutationInputSchema(restoreRevisionAsDraftPayloadSchema);

const DRAFT_MUTATIONS = ["saveDraft", "restoreRevisionAsDraft"] as const;

type DraftMutation = (typeof DRAFT_MUTATIONS)[number];
/**
 * The discriminant: which of the two named mutations a request asks for. It is read from
 * `payload.operation` alone, so a payload that states no operation, or one this transport does not
 * serve, is refused instead of being guessed at from its shape.
 */
const claimedMutationSchema = z.object(
  {
    payload: z.object({ operation: z.enum(DRAFT_MUTATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.payloadMissing }),
  },
  { error: MESSAGES.bodyNotJson },
);
// The read grammar: which of the two content states, and the edition that holds it
const DRAFT_VIEWS = ["draft", "candidate"] as const;

const readQuerySchema = z.strictObject(
  {
    view: z.enum(DRAFT_VIEWS, { error: MESSAGES.viewRequired }),
    variantId: editionReferenceSchema,
  },
  { error: MESSAGES.queryInvalid },
);
// Reading the request: bounded before it is parsed, so an oversized body is refused rather than read
const requestTextSchema = z.string({ error: MESSAGES.bodyNotJson }).superRefine((text, context) => {
  if (UTF8.encode(text).byteLength > REQUEST_BYTE_LIMIT) {
    context.addIssue({ code: "custom", message: MESSAGES.bodyTooLarge });
  }
});

function jsonBodyOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A body that is not JSON is answered by the discriminant schema below with the one message a
    // caller can act on, rather than by a throw at the boundary.
    return undefined;
  }
}

const attemptIdentitySchema = z.object({ operationId: z.string() });

function operationIdOf(body: unknown): string {
  const identity = attemptIdentitySchema.safeParse(body);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
/**
 * Removes the transport's discriminant, `payload.operation`, before the payload reaches the service,
 * whose payload schema is closed and does not carry the field: the mutation is named once, here, and
 * the service receives only what it accepts.
 */
function payloadOf<P extends { readonly operation: DraftMutation }>(payload: P): Omit<P, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}
/** Parses one mutation's body, calls that one named mutation, and answers with the outcome it returned. */
async function dispatch<P extends { readonly operation: DraftMutation }>(
  schema: z.ZodType<MutationInput<P>>,
  body: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<P, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    // A throw is a store or medium fault rather than a presentation: the service answers refusals as
    // outcomes, so the one mapper names the outage or the lost acknowledgement it is.
    return toResponse(outcomeFromError(operationId, error));
  }
}
/** Reads one edition's working draft or its frozen candidate as the full read envelope, or answers `invalid` for a query this transport does not read and `denied` or `unavailable` as the service refused it. */
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const grammar = readQuerySchema.safeParse({ view: params.get("view") ?? undefined, variantId: params.get("variantId") ?? undefined });
  if (!grammar.success) {
    // Nothing behind the read failed: the request named something this transport does not read, so the
    // caller is told which field to correct and neither read runs.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, grammar.error));
  }
  try {
    const { view, variantId } = grammar.data;
    // The frozen candidate is read through the edition that holds it, so both states name one identity
    // and one named read each: neither is derived from the other and neither is a second implementation.
    return toResponse(view === "draft" ? await reads.updates.readDraft({ variantId }) : await reads.updates.readCandidate({ variantId }));
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** Saves one edition's draft, or restores an earlier revision as a new draft, and answers with exactly one of the closed outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: NextRequest): Promise<Response> {
  const text = await request.text().catch(() => "");
  const sized = requestTextSchema.safeParse(text);
  if (!sized.success) {
    // The body is refused before it is parsed, so no operation id can be read from it and nothing was
    // attempted: the refusal carries the marker rather than an id the request never got to state.
    return toResponse(outcomeFromError(UNIDENTIFIED_ATTEMPT, sized.error));
  }
  const body = jsonBodyOf(text);
  const operationId = operationIdOf(body);
  const claimed = claimedMutationSchema.safeParse(body);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  const sessionId = sessionIdOf(request);
  switch (claimed.data.payload.operation) {
    case "saveDraft":
      return dispatch(saveDraftRequestSchema, body, operationId, (input) => mutations.updates.saveDraft(sessionId, input));
    case "restoreRevisionAsDraft":
      return dispatch(restoreRevisionAsDraftRequestSchema, body, operationId, (input) => mutations.updates.restoreRevisionAsDraft(sessionId, input));
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third
      // mutation fails to compile at this call rather than reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled draft mutation");
  }
}
