/**
 * `GET /api/coaching` — the worker's own coaching overview, in the one read envelope.
 */
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
/** The store reads and writes session documents through `node:fs`, so this handler is never an edge one. */
export const runtime = "nodejs";
/** The read resolves the development session and evaluates the scenario clock once per request. */
export const dynamic = "force-dynamic";

const READ_ATTEMPT_ID = "read";
/** Answers with the worker's coaching overview: private preparation as its own record class, every relationship with its five independent module switches, its duration as a separate fact, its. */
export async function GET(): Promise<Response> {
  try {
    return toResponse(await reads.coaching.readCoachingOverview());
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
