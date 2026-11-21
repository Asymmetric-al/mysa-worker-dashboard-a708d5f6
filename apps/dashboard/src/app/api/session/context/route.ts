/** `POST /api/session/context` — the context switch: one named mutation, `selectContext`, and nothing else. **What it is.** A thin adapter over `mutations.context.selectContext` (AAP 0.6.3: */
import { selectContextRequestSchema } from "@/features/shell/schemas/select-context";
import { mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, operationIdentityOf } from "../../handler";
/** Every request is evaluated per request: the service reads the development-session cookie, so the same URL answers differently for two sessions and must never be served as a cached answer. */
export const dynamic = "force-dynamic";
/** The synthetic store writes through `node:fs`, so the Edge runtime cannot serve this route. */
export const runtime = "nodejs";
const UNREACHED_ATTEMPT = "session-context-route";
/** How long an attempt id may be before this path stops echoing it, which has always been a wider bound than the outcome's own. */
const MAX_OPERATION_ID_LENGTH = 200;
/** This path's refusals have always been echoed under its own `session-context-route` marker, and it admits a stated attempt id of at most 200 characters, so those two decisions stay here; the rule that reads the claim is the shared one. */
function refusalIdentityOf(raw: unknown): string {
  const claimed = operationIdentityOf(raw);
  return claimed === UNIDENTIFIED_ATTEMPT || claimed.length > MAX_OPERATION_ID_LENGTH ? UNREACHED_ATTEMPT : claimed;
}
/** Moves the session into the context the body names and answers with one of the closed outcomes — accepted, alreadyAccepted, unchanged, conflict, denied, invalid, unavailable or unknown. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  const operationId = refusalIdentityOf(body);
  const parsed = selectContextRequestSchema.safeParse(body);

  if (!parsed.success) return toResponse(outcomeFromError(operationId, parsed.error));

  try {
    return toResponse(await mutations.context.selectContext(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
