/** `POST /api/initiatives/requests/response` — the one way a browser records the answer to a Request. */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, recordRequestResponsePayloadSchema, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../../../handler";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// The change resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";
// The envelope is judged by the shared schema, and the payload by the mutation's own exported schema below: its field names and its closed set of response kinds are the service's, and because that schema is the one that also accepts the flat answer shape, composing it here refuses nothing the
// mutation admits. A payload fault keeps its payload-relative field keys — the ones the service's own refusal states.
const recordResponseEnvelopeSchema = mutationInputSchema(z.unknown());
/** Records the respondent's own answer to one Request, and answers exactly one outcome. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = recordResponseEnvelopeSchema.safeParse(body);
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  const payload = recordRequestResponsePayloadSchema.safeParse(parsed.data.payload);
  if (!payload.success) return toResponse(outcomeFromError(parsed.data.operationId, payload.error));
  // Judged here and then handed on exactly as it arrived: the service validates the same wire payload with this same schema before it reads anything, and that schema is the one that normalises the flat answer shape, so the normalisation happens once, there.
  try {
    return toResponse(await mutations.outreach.recordRequestResponse(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
