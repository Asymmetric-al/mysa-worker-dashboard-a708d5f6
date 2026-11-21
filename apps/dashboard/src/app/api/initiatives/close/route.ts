/** `POST /api/initiatives/close` — the browser transport for the one named `closeInitiative` change, which fences further solicitation and records where the unfinished work it owns is going. */
import { z } from "zod";
import { closeInitiativePayloadSchema, mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../../handler";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// The change resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";
// The envelope is judged by the shared schema, and the payload by the mutation's own exported schema below, so a payload fault keeps its payload-relative field keys — the ones the service's own refusal states and the close dialog reads its field messages from.
const closeInitiativeEnvelopeSchema = mutationInputSchema(z.unknown());
/** Closes one initiative, recording how its unfinished work is handed on or resolved. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = closeInitiativeEnvelopeSchema.safeParse(body);
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  const payload = closeInitiativePayloadSchema.safeParse(parsed.data.payload);
  if (!payload.success) return toResponse(outcomeFromError(parsed.data.operationId, payload.error));
  // Judged here and then handed on exactly as it arrived: the service validates the same wire payload with this same schema before it reads anything, so a value that schema resolves is resolved once.
  try {
    return toResponse(await mutations.outreach.closeInitiative(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
