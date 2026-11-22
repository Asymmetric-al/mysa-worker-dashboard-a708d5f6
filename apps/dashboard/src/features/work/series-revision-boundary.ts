/**
 * The boundary a prospective "this and future" revision of one repeating plan takes effect from.
 *
 * A revision is prospective, so the plan's own rule engine refuses a boundary that falls before the latest
 * rule boundary the plan already carries. A surface that presented today alone would therefore present a
 * boundary the service has to refuse for any plan whose rule begins in the future — a newly created plan
 * whose first due date is still ahead holds its only rule boundary at that first due date — and a change the
 * worker genuinely made would be dropped as nothing to change.
 *
 * The boundary presented is therefore the later of the plan's own today and the latest rule boundary it
 * carries. Both facts come from the series read: `today` is "today" in the plan's own planning timezone, and
 * `effectiveRevisions` is published in order, so its last entry is the rule in force. No date is computed
 * here, and the answer is always one of the two values the read itself stated.
 */
import { Temporal } from "temporal-polyfill";
import { parseCivilDate } from "@/modules/time/civil";

// ---------------------------------------------------------------------------------------------
// What the boundary is read from
// ---------------------------------------------------------------------------------------------

/** The two facts the boundary is derived from: the plan's own today, and the rule revisions the read lists in order. */
export interface SeriesRevisionBoundaryFacts {
  /** "Today" in the plan's own planning timezone, as the series read states it. */
  readonly today: string;
  /** The plan's rule revisions in the order they took effect, so the last one is the rule in force. */
  readonly effectiveRevisions: readonly { readonly effectiveFrom: string }[];
}

// ---------------------------------------------------------------------------------------------
// The boundary itself
// ---------------------------------------------------------------------------------------------

/**
 * The boundary a prospective revision takes effect from: the later of the plan's own today and the latest
 * rule boundary it carries, as the civil date text the read published.
 *
 * A read that published no readable revision leaves the plan's own today to present, because there is no
 * later boundary it could state instead.
 */
export function prospectiveRevisionBoundary(facts: SeriesRevisionBoundaryFacts): string {
  const latest = facts.effectiveRevisions.at(-1)?.effectiveFrom;
  if (latest === undefined) return facts.today;
  const today = parseCivilDate(facts.today);
  const boundary = parseCivilDate(latest);
  if (today.status !== "parsed" || boundary.status !== "parsed") return facts.today;
  return Temporal.PlainDate.compare(boundary.date, today.date) > 0 ? latest : facts.today;
}
