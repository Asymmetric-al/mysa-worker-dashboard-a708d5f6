/** The boundary a prospective "this and future" revision of one repeating plan takes effect from. A revision is prospective, so the plan's rule engine refuses a boundary that falls before the latest rule boundary the plan already carries, and a surface presenting today alone would hand such a plan a boundary the service has to refuse: a plan whose rule begins in the future holds its only rule boundary at that first due date, so a change the worker genuinely made would be dropped as nothing to change. The boundary presented is therefore the later of the plan's own today and that latest boundary. Both facts come from the series read, and no date is computed here. */
import { Temporal } from "temporal-polyfill";
import { parseCivilDate } from "@/modules/time/civil";
/** The two facts the boundary is read from: the plan's own today, and its rule revisions in the order they took effect. */ export interface SeriesRevisionBoundaryFacts {
  /** "Today" in the plan's own planning timezone, as the series read states it. */ readonly today: string;
  /** The plan's rule revisions in the order they took effect, so the last one is the rule in force. */ readonly effectiveRevisions: readonly { readonly effectiveFrom: string }[];
}
/** The boundary a prospective revision takes effect from, as the civil date text the read published; a read whose latest revision is absent or unreadable leaves the plan's own today. */ export function prospectiveRevisionBoundary(facts: SeriesRevisionBoundaryFacts): string {
  const latest = facts.effectiveRevisions.at(-1)?.effectiveFrom;
  if (latest === undefined) return facts.today;
  const today = parseCivilDate(facts.today);
  const boundary = parseCivilDate(latest);
  if (today.status !== "parsed" || boundary.status !== "parsed") return facts.today;
  return Temporal.PlainDate.compare(boundary.date, today.date) > 0 ? latest : facts.today;
}
