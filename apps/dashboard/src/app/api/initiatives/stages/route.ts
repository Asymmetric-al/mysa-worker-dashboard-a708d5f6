/** `POST /api/initiatives/stages` — the one way a browser records a stage assessment against a working-list member. */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../../handler";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// Each request resolves the development session and evaluates the scenario clock once, so nothing here is cacheable.
export const dynamic = "force-dynamic";
// A stage token is opaque at this boundary: the source-approved list is the service's own, so no stage name, order or label is repeated here. `stage` is required and may be explicitly null — the explicit Clear — because an absent key cannot be told apart from "no change".
const setStagePayloadSchema = z.strictObject({
  initiativeId: z.string().min(1, "This change is missing the initiative it belongs to; reopen the initiative and try again."),
  // A working-list member is its own identity, never a partner, a contact or an address.
  memberId: z.string().min(1, "This change is missing the working-list member it belongs to; reload the working list and try again."),
  stage: z.string().min(1, "Choose a stage from the approved list, or clear the stage.").nullable(),
});
const setStageRequestSchema = mutationInputSchema(setStagePayloadSchema);
/** Records one human assessment of where a working-list member stands. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = setStageRequestSchema.safeParse(body);
  if (!parsed.success) {
    // A body that failed to validate carries no legitimate operation identity of its own, so the outcome echoes the identifier it claimed rather than minting one.
    return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  }
  // Exactly one dispatch: the same-value no-op, the permission decision, the revision check and the history entry are the service's, and its `unchanged` reaches the caller as `unchanged`.
  try {
    return toResponse(await mutations.outreach.setStage(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
