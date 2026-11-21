/** `POST /api/publish` — the browser transport for releasing the variants selected on the publish review: */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
import { jsonBodyOf, operationIdentityOf } from "../handler";
// The store behind the service writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every release resolves the development session and the scenario instant per request, never cached.
export const dynamic = "force-dynamic";
const RECORD_REFERENCE_MAX_CHARS = 160;
const RECORD_REFERENCE_MESSAGE = "Name the record by the opaque identifier it was read with, so a release names records this context actually holds.";
const recordReferenceSchema = z.string({ error: RECORD_REFERENCE_MESSAGE }).trim().min(1, RECORD_REFERENCE_MESSAGE).max(RECORD_REFERENCE_MAX_CHARS, RECORD_REFERENCE_MESSAGE);
const RELEASE_CHOICES = ["publish-only", "publish-and-notify-now", "publish-and-notify"] as const;
/** One name this boundary recognises for the closed release choice. */
type ReleaseChoice = (typeof RELEASE_CHOICES)[number];
type RecordedReleaseChoice = "publish-only" | "publish-and-notify";
const RECORDED_RELEASE_CHOICES: Readonly<Record<ReleaseChoice, RecordedReleaseChoice>> = { "publish-only": "publish-only", "publish-and-notify-now": "publish-and-notify", "publish-and-notify": "publish-and-notify" };
const releaseChoiceSchema = z.enum(RELEASE_CHOICES, { error: "Choose how this edition is released: publish only, or publish and notify now." });
const publishSelectionSchema = z
  .strictObject({
    variantId: recordReferenceSchema,
    revisionId: recordReferenceSchema.optional(),
    candidateId: recordReferenceSchema.optional(),
    mode: releaseChoiceSchema.optional(),
    // The candidate's own notification policy as the review screen read it. It grants nothing: the service re-reads that policy from the frozen candidate and refuses, per variant, a mode the submission never asked for, so a reviewer cannot turn publish-only into a notice here.
    candidateNotifyAdmitted: z.boolean().optional(),
  })
  .superRefine((selection, context) => {
    if (selection.revisionId !== undefined && selection.candidateId !== undefined && selection.revisionId !== selection.candidateId) {
      context.addIssue({ code: "custom", path: ["candidateId"], message: "This selection names two different revisions. Name the one frozen candidate it releases: the candidate is the revision." });
    }
  });
const publishPayloadSchema = z.strictObject({
  documentId: recordReferenceSchema.optional(),
  // The recorded choice for this release and nothing more. A notice is a separate, deliberate `requestNotification` under its own operation id, never a step publishing takes on its own.
  mode: releaseChoiceSchema.optional(),
  variants: z.array(publishSelectionSchema).min(1, "Choose one or more selected variants to release, so a release names every edition it publishes."),
});
/** The payload this path accepts, inferred so the mapping below cannot restate it. */
type PublishPayload = z.infer<typeof publishPayloadSchema>;
const publishRequestSchema = mutationInputSchema(publishPayloadSchema);
/** The payload `publishVariants` accepts, taken from the service so this file cannot restate it. */
type ServicePublishPayload = Parameters<typeof mutations.updates.publishVariants>[1]["payload"];
function recordedChoiceOf(choice: ReleaseChoice | undefined): RecordedReleaseChoice | undefined {
  return choice === undefined ? undefined : RECORDED_RELEASE_CHOICES[choice];
}
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
/** Releases the selected variants of an approved candidate. */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = publishRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Refused before the service is reached, so nothing is released: a body that is not JSON, and a body carrying a reach decision, a content edit, a send instruction or an identity claim, both arrive here as per-field messages.
    return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  }
  const input: MutationInput<ServicePublishPayload> = { ...parsed.data, payload: releasePayloadOf(parsed.data.payload) };
  try {
    // The per-variant detail the mutation answers with travels back unchanged: an edition that could not be released keeps the release it already had, and that preserved head is not a new translation — nor does one edition's success roll back beside a sibling's failure.
    return toResponse(await mutations.updates.publishVariants(sessionIdOf(request), input));
  } catch (error) {
    // A throw is a store, filesystem or medium fault rather than a presentation: the mutation answers refusals as outcomes, so this maps to `unavailable` or, when the effect's fate is not known, to `unknown` carrying the operation id the caller re-queries rather than publishes again.
    return toResponse(outcomeFromError(input.operationId, error));
  }
}
