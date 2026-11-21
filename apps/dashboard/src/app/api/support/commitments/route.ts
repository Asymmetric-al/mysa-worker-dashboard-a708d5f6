/**
 * `GET /api/support/commitments` — every commitment the source reports, in the one read envelope.
 *
 * **What it serves.** One page of `reads.support.readCommitments`: each commitment with the amount
 * the source states per occurrence of its own cadence, the bucket its occurrence currently stands in,
 * the day it last collected and the day it is next eligible on, and — where the source qualified one
 * — its monthly equivalent. The five recurring outcome buckets plus `outside-partition` and the three
 * commitment kinds travel beside the page as the partitions the read states, so a surface can present
 * them without counting anything itself.
 *
 * **A commitment is not received money**, and this transport is a place that separation could be
 * lost. It is not lost here because nothing is computed here: the read carries the source's own
 * qualification, states no total across kinds, and offers no retry, pause, correction or edit — this
 * application performs no financial action, and the only writable financial fact is the goal, which
 * `POST /api/support/goal` owns. An absent monthly equivalent stays absent rather than becoming a
 * zero, and a `fixed-total` commitment's four amounts stay the source's exact minor units.
 *
 * **The window it accepts, and nothing else.** The list's page window travels as `page.index` and
 * `page.size`, the read's own member paths, and the shared grammar in `../query` reads them. The
 * list's own `commitmentId` detail narrowing and its `showAdditionalTypes` offer are its own state:
 * the named inventory has no `readCommitment` and the read accepts no filter, so neither is invented
 * here, and the read states the kinds and buckets it holds in its data. The default page size and the
 * 200-row cap stay the engine's, so this file clamps nothing.
 *
 * **Who authorises.** The service does, on every request: the read re-derives the scope from the
 * development-session cookie, and a denial (403) carries no count, title, size or existence flag —
 * never an empty list, because a refusal and a subject with no commitments are different facts.
 *
 * Layering: `app/api → modules/data-service`. This file imports the service package root and nothing
 * deeper, and it reaches no second transport, no store and no feature module.
 */

import type { NextRequest } from "next/server";

import { outcomeFromError, reads, toResponse } from "@/modules/data-service";

import { supportPageFromSearch } from "../query";

/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";

/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";

/**
 * The marker a refusal from this route carries where a mutation would carry its operation id.
 *
 * A `GET` performs no effect and mints no identity of its own; `"read"` keeps a failed read from
 * being mistaken for a change someone could replay.
 */
const READ_ATTEMPT_MARKER = "read";

/**
 * Answers with one page of the subject's commitments and the partitions the read states beside it.
 *
 * Outcome set: `envelope` (200, the page, its whole-result count, the page window, the buckets, the
 * kinds, the coverage and the value states), `denied` (403) and `unavailable` (503) exactly as the
 * read answered, and `invalid` (422) for a page window the grammar cannot read — a size with no page,
 * or a value that is not a whole number — keyed by the parameter that carried it.
 *
 * A thrown fault is mapped by the service's own error handling rather than escaping as a framework
 * error page: a store or medium fault becomes `unavailable` naming the source and its safe retry,
 * anything unrecognised becomes `unknown` carrying only the attempt marker, and neither is answered
 * as an empty list or a zero.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = supportPageFromSearch(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, parsed.error));
  }

  try {
    return toResponse(await reads.support.readCommitments(parsed.value));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a
    // throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
