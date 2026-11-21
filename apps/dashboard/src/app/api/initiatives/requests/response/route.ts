/**
 * `POST /api/initiatives/requests/response` — the one way a browser records the answer to a Request.
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// The change resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";

// The payload's field names and its closed set of response kinds belong to the service: its schema is
// strict and also accepts the flat answer shape, so narrowing it again here would duplicate the
// vocabulary and refuse a shape the mutation admits.
type RecordRequestResponsePayload = Parameters<typeof mutations.outreach.recordRequestResponse>[0]["payload"];

const recordResponseRequestSchema = mutationInputSchema(z.custom<RecordRequestResponsePayload>());

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}
/** Records the respondent's own answer to one Request, and answers exactly one outcome. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = recordResponseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.outreach.recordRequestResponse(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
