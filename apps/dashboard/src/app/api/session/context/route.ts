/**
 * `POST /api/session/context` — the one way a browser asks this session to act in another context.
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// The switch re-resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";

type SelectContextPayload = Parameters<typeof mutations.context.selectContext>[0]["payload"];

const selectContextRequestSchema = mutationInputSchema(z.custom<SelectContextPayload>());

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}
/** Asks this session to act in the stated context, and answers exactly one of the eight outcomes. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = selectContextRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.context.selectContext(parsed.data));
  } catch (error) {
    // The service answers refusals as outcomes, so an exception here is a fault rather than a
    // presentation: converting it keeps the deviation from escaping the boundary as a framework page.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
