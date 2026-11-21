/**
 * The one named received-support basis, the five measures that must stay five, the gift row and the
 * read-only support projection `report.ts` computes from, and the coverage guard that keeps a partial
 * history honest.
 */
import type { SourceReference } from "../../lib/ids";
import type { Coverage, GiftAttribution, SupportBasis, SupportGoalRecord } from "../data-service/envelope";
import type { Money } from "../money/amount";
import type { CivilDate, DatePrecision } from "../time/civil";
import type { CommitmentRow } from "./buckets";
// The one named basis
/** The basis every support figure in this application is reported on: source-qualified effective cash allocations, attributed to their original gift dates, with accepted corrections and. */
export const SUPPORT_BASIS: SupportBasis = "effective_cash_allocation";
/** The basis vocabulary, re-exported from its single declaration site in `data-service/envelope`. */
export type { SupportBasis };
/** What this basis measures, in one sentence: the grain it counts at, the date it attributes an amount to, and how a correction or a refund is treated. */
export const BASIS_DESCRIPTION =
  "Received support is measured as source-qualified effective cash allocations at the grain of one authorised allocation — a gift with no allocation counts once at gift grain, and a split gift contributes only the allocation this read is authorised to see — attributed to each gift's own original gift date, with accepted corrections and refunds reflected exactly as the source states them.";
// The five measures, which are never five parts of one total
/** The five different measures this application reports. */
export type SupportMeasure = "received-gifts" | "recurring-collection-outcomes" | "commitments" | "monthly-equivalent-support" | "support-goal";
/** The five measures in the order every surface lists them — exactly five, with no sixth — so a surface cannot quietly define one of its own and no figure can arrive without saying which. */
export const SUPPORT_MEASURES = ["received-gifts", "recurring-collection-outcomes", "commitments", "monthly-equivalent-support", "support-goal"] as const satisfies readonly SupportMeasure[];
/** The reader-facing label of each measure, because a figure states its measure in words and never by colour, position or an adjacent heading alone. */
export const SUPPORT_MEASURE_LABELS: Readonly<Record<SupportMeasure, string>> = {
  "received-gifts": "Received gifts",
  "recurring-collection-outcomes": "Recurring collection outcomes",
  commitments: "Commitments",
  "monthly-equivalent-support": "Monthly-equivalent support",
  "support-goal": "Support goal",
};
// The gift row
/** One received gift at the grain it is reported in: a single authorised allocation, or a whole gift that carries no allocation at all. */
export interface GiftRow {
  readonly giftRowId: string;
  readonly giftId: string;
  readonly allocationId?: string;
  readonly amount: Money;
  readonly originalGiftOn?: CivilDate;
  readonly datePrecision: DatePrecision;
  readonly designation?: string;
  readonly attribution: GiftAttribution;
  readonly refundOf?: string;
  readonly provenance: SourceReference;
  readonly entryOn: CivilDate;
}
// The support projection
/** The read-only projection one support subject's reports are computed from. */
export interface SupportProjection {
  readonly supportSubjectId: string;
  readonly basis: SupportBasis;
  readonly currencyExponents: Readonly<Record<string, number>>;
  readonly coverage: Coverage;
  readonly asOf: string;
  readonly lastSourceUpdate: string;
  readonly source: SourceReference;
  readonly goal?: SupportGoalRecord;
  readonly gifts: readonly GiftRow[];
  readonly commitments: readonly CommitmentRow[];
}
// The two guards
/** Whether a projection covers only part of the past, which makes every value it underlies an `incomplete-subtotal`. */
export function isIncompleteCoverage(projection: SupportProjection): boolean {
  return projection.coverage.state === "partial";
}
/** Reports the projection's basis, refusing a basis this application does not measure. */
export function assertSingleBasis(projection: SupportProjection): SupportBasis {
  // Widened to `string` on purpose: this value arrives from decoded store data, so the guard has to
  // compare what actually arrived rather than the type it was declared with.
  const basis: string = projection.basis;
  if (basis !== SUPPORT_BASIS) {
    throw new TypeError(
      `Support projection "${projection.supportSubjectId}" reports the basis "${basis}", which this application does not measure. A second basis would make two support figures incomparable, so the projection is refused instead of reported.`,
    );
  }
  return SUPPORT_BASIS;
}
