/**
 * `GET /api/support/gifts` — the gifts ledger for one bounded filter set, in the one read envelope.
 *
 * **What it serves.** One page of the whole-query report `reads.support.readGifts` computes: the
 * ledger's rows at the allocation grain, its summary in exact minor units per currency, its series
 * with a gap where a period recorded nothing, and the whole-result `total` that stays the
 * whole-result count while `page` moves. The rows are the same `ReportResult` the overview, the
 * chart, the matrix drilldown, the CSV and the print view read, which is what makes those six
 * surfaces agree in count and in minor-unit sums per currency rather than agree by careful copying
 * (AAP 0.8.8; criterion 1). This handler computes none of it.
 *
 * **The query it forwards, and the one thing it refuses.** The ledger's search vocabulary is the
 * client's own, declared once in `./query`: the period (a preset, or two civil days inclusive at
 * both ends), the currency, an amount range inside that single currency, the attribution, the
 * designation, the giving method, the search term, the sort and the page window. Every one of them
 * travels through untouched, so the read decides whether an amount range may apply, whether a sort
 * field or a giving method is admitted, and what a page holds — and it states a filter it could not
 * apply in the envelope's `actions`, with its own reason, instead of dropping it.
 *
 * Two of the ledger's own client fields are read by no member of the read, and neither is invented
 * here. `giftId` is the detail route's row selection over rows the ledger already returned: the
 * named inventory has no `readGift`, so this transport passes the page the read answered and the
 * client narrows its own rows. The collapsed `recipient=anonymous-or-unresolved` value names two
 * attributions the read selects one at a time — anonymous support, and support that supplied no
 * attribution — so it is refused with a message asking for the one the worker meant, rather than
 * narrowed to a member that would drop the other's rows while presenting the filter as applied.
 *
 * **Who authorises, and what a refusal discloses.** Scope and export permission are the service's:
 * the read re-derives the scope from the development-session cookie on every request and states the
 * export action it offers on this data. A denial (403) carries no count, title, size or existence
 * flag, and it is never answered as an empty page or a zero — the two readings an outage or a
 * refusal must never look like, because both would let a caller believe the ledger holds nothing.
 *
 * Layering: `app/api → modules/data-service`. This file imports the service package root and nothing
 * deeper, and it reaches no second transport, no store and no feature module.
 */

import type { NextRequest } from "next/server";

import { outcomeFromError, reads, toResponse } from "@/modules/data-service";

import { supportQueryFromSearch } from "../query";

/**
 * The store behind the service reads and writes through `node:fs`, so this handler never runs on the
 * edge runtime.
 */
export const runtime = "nodejs";

/**
 * The read resolves the development session, the selected context and the scenario instant per
 * request, so the same URL answers differently for two sessions and is never cached.
 */
export const dynamic = "force-dynamic";

/**
 * The marker a refusal from this route carries where a mutation would carry its operation id.
 *
 * A `GET` performs no effect and mints no identity of its own; `"read"` is the marker every read
 * result in the service already carries, so a failed ledger read cannot be mistaken for a change
 * anyone could replay.
 */
const READ_ATTEMPT_MARKER = "read";

/**
 * Answers with one page of the gifts ledger for the filter set the caller stated.
 *
 * Outcome set: `envelope` (200, the page with its whole-result total, coverage, value states and
 * offered actions), `denied` (403, no admission, no context or no permission for this read),
 * `unavailable` (503, the financial source did not answer) and — for a search parameter the shared
 * grammar cannot read — `invalid` (422) keyed by the field path that carried it.
 *
 * A thrown fault is mapped by the service's own error handling rather than escaping as a framework
 * error page: a store or medium fault becomes `unavailable` naming the source and its safe retry, and
 * anything unrecognised becomes `unknown` carrying only the attempt marker. No fault is answered with
 * an empty ledger or a zero.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = supportQueryFromSearch(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, parsed.error));
  }

  try {
    return toResponse(await reads.support.readGifts(parsed.value));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers refusals as results, so a
    // throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
