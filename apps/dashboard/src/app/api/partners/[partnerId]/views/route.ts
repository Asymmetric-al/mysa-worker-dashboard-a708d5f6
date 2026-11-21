/** `POST /api/partners/[partnerId]/views` — the browser's only way to save, rename or delete the caller's own saved roster query. */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { deleteViewInput, mutationInputSchema, mutations, outcomeFromError, renameViewInput, saveViewInput, toResponse } from "@/modules/data-service";
import { dispatch, jsonBodyOf, operationIdentityOf } from "../../../handler";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Saving, renaming or deleting a view resolves this session's admission and evaluates the scenario clock once per request, so no answer here may be served from a cache.
export const dynamic = "force-dynamic";
interface PartnerViewsParams {
  readonly partnerId: string;
}
// Wording  Only the two sentences this transport owns live here: the intent that selects the mutation, and a body that is not JSON at all. Every other refusal a caller reads is the mutation's own, because the payload
// schema below is the mutation's schema — one author for each rule, and no second wording to drift from it.
const MESSAGES = { intentRequired: "State which change this request makes as payload.intent: saveView, renameView or deleteView.", bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload." } as const;
// The payloads  One payload per named mutation, each the mutation's own schema plus the one member this transport owns: `intent` selects which mutation runs. The schemas stay closed at every level, so an unknown member is
// `invalid` with the key named rather than quietly dropped, and a body mixing two intents is a refusal instead of a guess. `saveView` carrying an existing `viewId` is how a view is updated: the caller's choices replace the ones it saved before, and no separate update or repair mutation exists.
// A view's stored query keeps the choices the roster read is issued with and nothing else: the mutation's schema states its shape and its bounds, and this transport only checks the value against them. It never
// runs, filters, sorts, expands or counts a stored query, because the service re-issues that query when the view is opened.
const saveViewPayloadSchema = saveViewInput.extend({ intent: z.literal("saveView") });
const renameViewPayloadSchema = renameViewInput.extend({ intent: z.literal("renameView") });
const deleteViewPayloadSchema = deleteViewInput.extend({ intent: z.literal("deleteView") });
// One body schema per mutation: the four-field envelope, with that mutation's own payload
const saveViewBodySchema = mutationInputSchema(saveViewPayloadSchema);
const renameViewBodySchema = mutationInputSchema(renameViewPayloadSchema);
const deleteViewBodySchema = mutationInputSchema(deleteViewPayloadSchema);
const VIEW_INTENTS = ["saveView", "renameView", "deleteView"] as const;
// The write side: one named mutation per request
const intentClaimSchema = z.object({ payload: z.object({ intent: z.enum(VIEW_INTENTS, { error: MESSAGES.intentRequired }) }, { error: MESSAGES.intentRequired }) }, { error: MESSAGES.bodyNotJson });
/** Saves, renames or deletes one saved view the caller owns, selected by `payload.intent`. */
export async function POST(request: Request, { params }: { params: Promise<PartnerViewsParams> }): Promise<Response> {
  // Next 16 hands the dynamic segment as a promise, so it is awaited. The segment is awaited rather than read: it places this path under a partner and is not a saved view's identity, so it is never folded into the payload, never narrows or widens the query a view stores, and never joins anything.
  await params;
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = intentClaimSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.intent) {
    case "saveView":
      return dispatch(saveViewBodySchema, raw, operationId, "intent", mutations.partners.saveView);
    case "renameView":
      return dispatch(renameViewBodySchema, raw, operationId, "intent", mutations.partners.renameView);
    case "deleteView":
      return dispatch(deleteViewBodySchema, raw, operationId, "intent", mutations.partners.deleteView);
    default:
      // Unreachable: the three names above are the closed set the intent schema admits, so a fourth intent fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.intent, "Unhandled saved-view mutation");
  }
}
