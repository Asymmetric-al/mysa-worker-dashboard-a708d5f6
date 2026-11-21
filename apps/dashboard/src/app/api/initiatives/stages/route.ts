/**
 * `POST /api/initiatives/stages` — the one way a browser records a stage against a working-list
 * member.
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// The change resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";

type SetStagePayload = Parameters<typeof mutations.outreach.setStage>[0]["payload"];

const setStageRequestSchema = mutationInputSchema(z.custom<SetStagePayload>());

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}
/** Records one assessment of where a working-list member stands, and answers exactly one outcome. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = setStageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.outreach.setStage(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
