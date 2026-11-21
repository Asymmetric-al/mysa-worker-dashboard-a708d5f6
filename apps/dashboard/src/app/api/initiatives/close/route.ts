/**
 * `POST /api/initiatives/close` — the browser transport for the one named `closeInitiative` change,
 * which fences further solicitation and records where the unfinished work it owns is going. Closing
 * never resolves an outstanding obligation silently: the service reports every item it leaves open.
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// The change resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";

type CloseInitiativePayload = Parameters<typeof mutations.outreach.closeInitiative>[0]["payload"];

const closeInitiativeRequestSchema = mutationInputSchema(z.custom<CloseInitiativePayload>());

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}
/** Closes one initiative, recording how its unfinished work is handed on or resolved. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = closeInitiativeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.outreach.closeInitiative(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
