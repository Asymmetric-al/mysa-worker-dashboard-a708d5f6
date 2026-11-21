/**
 * `GET /api/coaching/subjects` — the coach's own read of the subjects they may see.
 */
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
/** The store reads session documents through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Both reads resolve the development session and evaluate the scenario clock once per request. */
export const dynamic = "force-dynamic";

const READ_ATTEMPT_ID = "read";

function namedSubjectOf(request: Request): string | undefined {
  const granted = new URL(request.url).searchParams.get("grantId");
  return granted === null || granted.trim().length === 0 ? undefined : granted;
}
/** Answers with either the coach's portfolio or one subject's admitted modules, whichever the query named, inside the read's envelope — scope, source, revision, as-of instant, coverage, value. */
export async function GET(request: Request): Promise<Response> {
  const grantId = namedSubjectOf(request);
  try {
    return toResponse(grantId === undefined ? await reads.coach.readCoachPortfolio() : await reads.coach.readCoachSubject({ grantId }));
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
