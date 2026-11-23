import type { NextRequest } from "next/server";
import { z } from "zod";
import { deleteViewInput, mutationInputSchema, mutations, renameViewInput, saveViewInput } from "@/modules/data-service";
import { claimedWriteRoute, claimedWrites } from "../../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type PartnerViewsParams = { readonly partnerId: string };
const MESSAGES = { intentRequired: "State which change this request makes as payload.intent: saveView, renameView or deleteView.", bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload." } as const;
const saveViewPayloadSchema = saveViewInput.extend({ intent: z.literal("saveView") });
const renameViewPayloadSchema = renameViewInput.extend({ intent: z.literal("renameView") });
const deleteViewPayloadSchema = deleteViewInput.extend({ intent: z.literal("deleteView") });
const saveViewBodySchema = mutationInputSchema(saveViewPayloadSchema);
const renameViewBodySchema = mutationInputSchema(renameViewPayloadSchema);
const deleteViewBodySchema = mutationInputSchema(deleteViewPayloadSchema);
const VIEW_INTENTS = ["saveView", "renameView", "deleteView"] as const;
type ViewIntent = (typeof VIEW_INTENTS)[number];
const intentClaimSchema = z.object({ payload: z.object({ intent: z.enum(VIEW_INTENTS, { error: MESSAGES.intentRequired }) }, { error: MESSAGES.intentRequired }) }, { error: MESSAGES.bodyNotJson });
/** The three named view intents, each judged by its own payload schema before it runs. */
const VIEW_WRITES = claimedWrites<ViewIntent>("intent", { saveView: [saveViewBodySchema, mutations.partners.saveView], renameView: [renameViewBodySchema, mutations.partners.renameView], deleteView: [deleteViewBodySchema, mutations.partners.deleteView] });
/** Saves, renames or deletes one saved view the caller owns, selected by `payload.intent`. */
export async function POST(request: NextRequest, { params }: { params: Promise<PartnerViewsParams> }): Promise<Response> {
  await params;
  return claimedWriteRoute(request, intentClaimSchema, (claim) => claim.payload.intent, VIEW_WRITES);
}
