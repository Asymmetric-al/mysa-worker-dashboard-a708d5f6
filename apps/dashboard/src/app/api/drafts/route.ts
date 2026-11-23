import type { NextRequest } from "next/server";
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { PRESENTATION_CHOICES } from "@/modules/content/document";
import { RENDITION_PURPOSES } from "@/modules/media/asset";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT, claimedBodyRoute, dispatch, type ClaimedWrite } from "../handler";
import { readGrammar, readRoute } from "../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const REQUEST_BYTE_LIMIT = 1_048_576;
const REFERENCE_MAX_LENGTH = 160;
const CHECKSUM_MAX_LENGTH = 96;
const MEDIA_PLACEMENTS_MAX = 64;
const UTF8 = new TextEncoder();
const MESSAGES = {
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  bodyTooLarge: `A draft request carries prose and media references rather than media bytes, so a body over ${String(REQUEST_BYTE_LIMIT)} bytes is refused before it is read: nothing was saved and the editor's own text is untouched.`,
  payloadMissing: "State the change this request makes as payload, carrying the operation it asks for as payload.operation.",
  operationRequired: "State which change this request makes as payload.operation: saveDraft or restoreRevisionAsDraft.",
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
type PresentationField = keyof typeof PRESENTATION_CHOICES;
const PRESENTATION_LABELS: Readonly<Record<PresentationField, string>> = { treatment: "text treatment", layout: "layout", alignment: "alignment", imageFit: "image fit" };
const presentationRefusal = (field: PresentationField, admitted: readonly string[]): string => `A ${PRESENTATION_LABELS[field]} is one of the admitted presentations, ${admitted.join(" or ")}. Any other value is refused here rather than accepted and styled, so choose one of them.`;
const isPresentationField = (key: string): key is PresentationField => Object.hasOwn(PRESENTATION_CHOICES, key);
type PresentationIssue = { readonly path: readonly (string | number)[]; readonly message: string };
function presentationIssuesIn(body: unknown): readonly PresentationIssue[] {
  const issues: PresentationIssue[] = [];
  const pending: { readonly node: unknown; readonly path: readonly (string | number)[] }[] = [{ node: body, path: [] }];
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const { node, path } = entry;
    if (Array.isArray(node)) {
      node.forEach((child, index) => pending.push({ node: child, path: [...path, index] }));
      continue;
    }
    if (!isRecord(node)) continue;
    for (const [key, child] of Object.entries(node)) {
      if (!isPresentationField(key)) {
        pending.push({ node: child, path: [...path, key] });
        continue;
      }
      const admitted: readonly string[] = PRESENTATION_CHOICES[key];
      if (typeof child !== "string" || !admitted.includes(child)) issues.push({ path: [...path, key], message: presentationRefusal(key, admitted) });
    }
  }
  return issues;
}
const editionReferenceSchema = z.string({ error: MESSAGES.variantIdRequired }).trim().min(1, MESSAGES.variantIdRequired).max(REFERENCE_MAX_LENGTH, MESSAGES.referenceTooLong);
const revisionReferenceSchema = z.string({ error: MESSAGES.revisionIdRequired }).trim().min(1, MESSAGES.revisionIdRequired).max(REFERENCE_MAX_LENGTH, MESSAGES.referenceTooLong);
const assetReferenceSchema = z.string({ error: MESSAGES.assetIdRequired }).trim().min(1, MESSAGES.assetIdRequired).max(REFERENCE_MAX_LENGTH, MESSAGES.referenceTooLong);
const checksumSchema = z.string({ error: MESSAGES.checksumInvalid }).trim().min(1, MESSAGES.checksumInvalid).max(CHECKSUM_MAX_LENGTH, MESSAGES.checksumInvalid);
const mediaPlacementRefSchema = z.strictObject({ assetId: assetReferenceSchema, purpose: z.enum(RENDITION_PURPOSES, { error: MESSAGES.placementPurpose }) });
const saveDraftPayloadSchema = z
  .strictObject({ operation: z.literal("saveDraft", { error: MESSAGES.operationRequired }), variantId: editionReferenceSchema, body: z.unknown(), contentChecksum: checksumSchema.optional(), mediaPlacements: z.array(mediaPlacementRefSchema).max(MEDIA_PLACEMENTS_MAX, MESSAGES.placementsTooMany).optional() })
  .superRefine((payload, context) => {
    if (!Object.hasOwn(payload, "body") || payload.body === undefined) {
      context.addIssue({ code: "custom", path: ["body"], message: MESSAGES.bodyRequired });
      return;
    }
    for (const issue of presentationIssuesIn(payload.body)) context.addIssue({ code: "custom", path: ["body", ...issue.path], message: issue.message });
  });
const restoreRevisionAsDraftPayloadSchema = z.strictObject({ operation: z.literal("restoreRevisionAsDraft", { error: MESSAGES.operationRequired }), revisionId: revisionReferenceSchema });
const saveDraftRequestSchema = mutationInputSchema(saveDraftPayloadSchema);
const restoreRevisionAsDraftRequestSchema = mutationInputSchema(restoreRevisionAsDraftPayloadSchema);
const DRAFT_MUTATIONS = ["saveDraft", "restoreRevisionAsDraft"] as const;
type DraftMutation = (typeof DRAFT_MUTATIONS)[number];
const claimedMutationSchema = z.object({ payload: z.object({ operation: z.enum(DRAFT_MUTATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.payloadMissing }) }, { error: MESSAGES.bodyNotJson });
const DRAFT_VIEWS = ["draft", "candidate"] as const;
const readQuerySchema = z.strictObject({ view: z.enum(DRAFT_VIEWS, { error: MESSAGES.viewRequired }), variantId: editionReferenceSchema }, { error: MESSAGES.queryInvalid });
const requestTextSchema = z.string({ error: MESSAGES.bodyNotJson }).superRefine((text, context) => {
  if (UTF8.encode(text).byteLength > REQUEST_BYTE_LIMIT) context.addIssue({ code: "custom", message: MESSAGES.bodyTooLarge });
});
function bodyOfText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
/** Reads one edition's working draft or its frozen candidate as the full read envelope, or answers `invalid` for a query this transport does not read and `denied` or `unavailable` as the service refused it. */
export const GET = readRoute(
  readGrammar(readQuerySchema, (search) => ({ view: search.get("view") ?? undefined, variantId: search.get("variantId") ?? undefined })),
  (query) => (query.view === "draft" ? reads.updates.readDraft({ variantId: query.variantId }) : reads.updates.readCandidate({ variantId: query.variantId })),
);
const DRAFT_WRITES = {
  saveDraft: (raw, { operationId, sessionId }) => dispatch(saveDraftRequestSchema, raw, operationId, "operation", (input) => mutations.updates.saveDraft(sessionId, input)),
  restoreRevisionAsDraft: (raw, { operationId, sessionId }) => dispatch(restoreRevisionAsDraftRequestSchema, raw, operationId, "operation", (input) => mutations.updates.restoreRevisionAsDraft(sessionId, input)),
} satisfies Readonly<Record<DraftMutation, ClaimedWrite>>;
/** Saves one edition's draft, or restores an earlier revision as a new draft, and answers with exactly one of the closed outcomes. */
export async function POST(request: NextRequest): Promise<Response> {
  const text = await request.text().catch(() => "");
  const sized = requestTextSchema.safeParse(text);
  if (!sized.success) return toResponse(outcomeFromError(UNIDENTIFIED_ATTEMPT, sized.error));
  return claimedBodyRoute(request, bodyOfText(text), claimedMutationSchema, (claim) => claim.payload.operation, DRAFT_WRITES);
}
