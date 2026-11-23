import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
import { writeRoute } from "../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RECORD_REFERENCE_MAX_CHARS = 160;
const RECORD_REFERENCE_MESSAGE = "Name the record by the opaque identifier it was read with, so a release names records this context actually holds.";
const recordReferenceSchema = z.string({ error: RECORD_REFERENCE_MESSAGE }).trim().min(1, RECORD_REFERENCE_MESSAGE).max(RECORD_REFERENCE_MAX_CHARS, RECORD_REFERENCE_MESSAGE);
const RELEASE_CHOICES = ["publish-only", "publish-and-notify-now", "publish-and-notify"] as const;
type ReleaseChoice = (typeof RELEASE_CHOICES)[number];
type RecordedReleaseChoice = "publish-only" | "publish-and-notify";
const RECORDED_RELEASE_CHOICES: Readonly<Record<ReleaseChoice, RecordedReleaseChoice>> = { "publish-only": "publish-only", "publish-and-notify-now": "publish-and-notify", "publish-and-notify": "publish-and-notify" };
const releaseChoiceSchema = z.enum(RELEASE_CHOICES, { error: "Choose how this edition is released: publish only, or publish and notify now." });
const publishSelectionSchema = z.strictObject({ variantId: recordReferenceSchema, revisionId: recordReferenceSchema.optional(), candidateId: recordReferenceSchema.optional(), mode: releaseChoiceSchema.optional(), candidateNotifyAdmitted: z.boolean().optional() }).superRefine((selection, context) => {
  if (selection.revisionId !== undefined && selection.candidateId !== undefined && selection.revisionId !== selection.candidateId)
    context.addIssue({ code: "custom", path: ["candidateId"], message: "This selection names two different revisions. Name the one frozen candidate it releases: the candidate is the revision." });
});
const publishPayloadSchema = z.strictObject({ documentId: recordReferenceSchema.optional(), mode: releaseChoiceSchema.optional(), variants: z.array(publishSelectionSchema).min(1, "Choose one or more selected variants to release, so a release names every edition it publishes.") });
type PublishPayload = z.infer<typeof publishPayloadSchema>;
const publishRequestSchema = mutationInputSchema(publishPayloadSchema);
type ServicePublishPayload = Parameters<typeof mutations.updates.publishVariants>[1]["payload"];
const recordedChoiceOf = (choice: ReleaseChoice | undefined): RecordedReleaseChoice | undefined => (choice === undefined ? undefined : RECORDED_RELEASE_CHOICES[choice]);
function releasePayloadOf(payload: PublishPayload): ServicePublishPayload {
  const mode = recordedChoiceOf(payload.mode);
  return {
    ...(payload.documentId === undefined ? {} : { documentId: payload.documentId }),
    ...(mode === undefined ? {} : { mode }),
    variants: payload.variants.map((selection) => {
      const revisionId = selection.revisionId ?? selection.candidateId;
      const selectionMode = recordedChoiceOf(selection.mode);
      return { variantId: selection.variantId, ...(revisionId === undefined ? {} : { revisionId }), ...(selectionMode === undefined ? {} : { mode: selectionMode }) };
    }),
  };
}
/** Releases the selected variants of an approved candidate: a body that is not JSON, and a body carrying a reach decision, a content edit, a send instruction or an identity claim, are both refused before the service is reached, so nothing is released. */
export const POST = (request: NextRequest): Promise<Response> =>
  writeRoute(request, publishRequestSchema, (input): Promise<MutationOutcome> => {
    const release: MutationInput<ServicePublishPayload> = { ...input, payload: releasePayloadOf(input.payload) };
    return mutations.updates.publishVariants(sessionIdOf(request), release);
  });
