/**
 * `GET /api/support/goal` and `POST /api/support/goal` — the one support goal, read and written.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { supportQueryFromSearch } from "../query";
/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";

const READ_ATTEMPT_MARKER = "read";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

type GoalPayload = Parameters<typeof mutations.support.saveGoal>[0]["payload"];

// The payload's own rule is the service's single goal schema, not a second copy here: it decides the
// currency's exponent, the measure and the effective day, so a schema at this boundary that refused
// what it admits — or admitted what it refuses — would make the transport disagree with the mutation
// it carries. This read only states that a payload is present.
const saveGoalRequestSchema = mutationInputSchema(z.custom<GoalPayload>());

function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { readonly operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}
/** Answers with the support goal, its progress, the capability that governs editing it and the period the percentage was measured over. */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = supportQueryFromSearch(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, parsed.error));
  }
  try {
    return toResponse(await reads.support.readGoal(parsed.value));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a
    // throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
/** Saves the goal the body states, and answers with exactly one of the service's eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: NextRequest): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = saveGoalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.support.saveGoal(parsed.data));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes,
    // so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
