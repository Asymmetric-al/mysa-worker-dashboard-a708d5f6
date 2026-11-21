/**
 * `GET /api/coaching/subjects` — the coach's own read of the subjects they may see.
 *
 * **One path, two reads, chosen by whether the query names a subject.** A request that states no
 * `grantId` (or states it blank) names no subject, so it asks for the portfolio:
 * `reads.coach.readCoachPortfolio()`. A request that states a `grantId` asks for that one subject:
 * `reads.coach.readCoachSubject({ grantId })`. The rule is the query's own shape, never a second
 * dispatch form — there is no `?view=` switch, no action discriminant and no body, so a URL cannot ask
 * for a document this path does not describe.
 *
 * **The coach identity's authority, not this file's.** Both reads authorise before they enumerate: a
 * grant the caller does not hold, a closure (`revoked`, `ended`, `left`, `expired`, `superseded`) and a
 * window whose frozen bound has been reached are omitted by the portfolio before any record is looked
 * at, and the single-subject read answers `denied` — no module name, no count, no existence flag — when
 * the grant is not the caller's own or is no longer readable. The cutoff is evaluated against the
 * read's own instant, so a status row that still says `active` after its bound grants nothing. A
 * refusal is answered as the read reported it, never repaired into an empty portfolio, and an
 * authorised coach who holds no subjects is the portfolio's own `holdsNoSubjects` fact rather than a
 * denial.
 *
 * **No write is served here.** The coach identity holds exactly two writes, `acceptInvitation` and
 * `leaveCoaching`, and both act on the relationship rather than on a subject's content, so both live on
 * `/api/coaching/grants` beside the worker's grant lifecycle. Only `GET` is exported; every other
 * method answers 405 from the framework, and no query can turn this path into a write.
 *
 * **Layering.** `app/api → modules/data-service`, the package root only: the query is forwarded to the
 * read's own declared input, and no default, clamp, module filter or refusal is decided here.
 */

import { outcomeFromError, reads, toResponse } from "@/modules/data-service";

/** The store reads session documents through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";

/** Both reads resolve the development session and evaluate the scenario clock once per request. */
export const dynamic = "force-dynamic";

/** The non-unique attempt marker every read result carries: a `GET` performs no effect to replay. */
const READ_ATTEMPT_ID = "read";

/**
 * The grant the request names as its subject, or `undefined` when it names none.
 *
 * `grantId` is the handle a portfolio entry states and the single-subject read declares, so it is the
 * name this query carries. A blank value names no subject rather than a subject with no identity: the
 * honest answer to `?grantId=` is the portfolio the caller is entitled to, not a denial about a grant
 * nobody named.
 */
function namedSubjectOf(request: Request): string | undefined {
  const granted = new URL(request.url).searchParams.get("grantId");
  return granted === null || granted.trim().length === 0 ? undefined : granted;
}

/**
 * Answers with either the coach's portfolio or one subject's admitted modules, whichever the query
 * named, inside the read's envelope — scope, source, revision, as-of instant, coverage, value states
 * and available actions included.
 *
 * A thrown fault is converted through the service's own error mapping: a store fault becomes
 * `unavailable` naming the source and the safe retry, a session that cannot be established becomes
 * `denied`, and anything unrecognised becomes `unknown` carrying the attempt marker. No fault is
 * answered with an empty portfolio, which would state that the coach holds nothing.
 */
export async function GET(request: Request): Promise<Response> {
  const grantId = namedSubjectOf(request);
  try {
    return toResponse(
      grantId === undefined
        ? await reads.coach.readCoachPortfolio()
        : await reads.coach.readCoachSubject({ grantId }),
    );
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
