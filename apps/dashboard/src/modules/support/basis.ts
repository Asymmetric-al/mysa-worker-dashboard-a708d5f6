/**
 * The one named received-support basis, the five measures that must stay five, the gift row and the
 * read-only support projection `report.ts` computes from, and the coverage guard that keeps a partial
 * history honest.
 *
 * Plan items that put this file in scope:
 * - AAP 0.8.1 row 2: the main reporting basis is one named basis — source-qualified effective cash
 *   allocations, attributed to their original gift dates, reflecting accepted corrections and refunds.
 * - AAP 0.8.8: one statement of grain, basis and coverage that every financial surface obeys.
 * - AAP 0.6.2 "Support projection" and "Gift row", the AAP 0.9.1 tree and the AAP 0.11.1 deliverable
 *   row `modules/support/{report,buckets,basis,goal}.ts`.
 *
 * This module is the sole statement of what the application measures when it says "support". No
 * second basis, second measure list or second projection shape may exist: `report.ts`,
 * `modules/export/{csv,print}`, `data-service/reads/support.ts` and `features/support` read the
 * vocabulary here instead of restating it, which is what makes the chart, the table, the drilldown,
 * the CSV and the print view agree.
 *
 * Declarations that already have a home stay there. The stored record shapes live in
 * `modules/data-service/envelope.ts`, which declares the basis and the goal shape once; the read
 * projections live here, beside the commitment row `./buckets` declares, so the support family holds
 * one projection vocabulary and the store holds one record vocabulary.
 *
 * Every export is a constant or a pure function of its argument. This file reads no clock, performs
 * no arithmetic, imports no currency table and holds no mutable state: an amount is summed, compared
 * and formatted in `modules/money`, through `report.ts`, and never in a type module.
 */
import type { SourceReference } from "../../lib/ids";
import type {
  Coverage,
  GiftAttribution,
  SupportBasis,
  SupportGoalRecord,
} from "../data-service/envelope";
import type { Money } from "../money/amount";
import type { CivilDate, DatePrecision } from "../time/civil";
import type { CommitmentRow } from "./buckets";

// ---------------------------------------------------------------------------------------------
// The one named basis
// ---------------------------------------------------------------------------------------------

/**
 * The basis every support figure in this application is reported on: source-qualified effective cash
 * allocations, attributed to their original gift dates, with accepted corrections and refunds
 * reflected exactly as the source states them.
 *
 * The type is declared once, in `modules/data-service/envelope.ts`, beside the stored projection it
 * types, and re-exported here so this family's whole vocabulary is importable from one place. The
 * annotation below is the guarantee that there is no second member: were that union ever to widen,
 * this file would fail to compile rather than quietly report a second basis.
 */
export const SUPPORT_BASIS: SupportBasis = "effective_cash_allocation";

/** The basis vocabulary, re-exported from its single declaration site in `data-service/envelope`. */
export type { SupportBasis };

/**
 * What this basis measures, in one sentence: the grain it counts at, the date it attributes an amount
 * to, and how a correction or a refund is treated.
 */
export const BASIS_DESCRIPTION =
  "Received support is measured as source-qualified effective cash allocations at the grain of one authorised allocation — a gift with no allocation counts once at gift grain, and a split gift contributes only the allocation this read is authorised to see — attributed to each gift's own original gift date, with accepted corrections and refunds reflected exactly as the source states them.";

// ---------------------------------------------------------------------------------------------
// The five measures, which are never five parts of one total
// ---------------------------------------------------------------------------------------------

/**
 * The five different measures this application reports.
 *
 * They are five measures, not five components of one figure: received gifts, recurring collection
 * outcomes, commitments, monthly-equivalent support and the support goal each measure a different
 * fact, and no code path may sum them into a single "total support". A commitment is never cash, a
 * processing occurrence is never received money, an unmatched received gift never fulfils a promise,
 * and a monthly equivalent is the source's qualification rather than a division of gifts — so adding
 * them would state a number no source ever reported.
 */
export type SupportMeasure =
  | "received-gifts"
  | "recurring-collection-outcomes"
  | "commitments"
  | "monthly-equivalent-support"
  | "support-goal";

/**
 * The five measures in the order every surface lists them — exactly five, with no sixth — so a
 * surface cannot quietly define one of its own and no figure can arrive without saying which measure
 * it is.
 */
export const SUPPORT_MEASURES = [
  "received-gifts",
  "recurring-collection-outcomes",
  "commitments",
  "monthly-equivalent-support",
  "support-goal",
] as const satisfies readonly SupportMeasure[];

/**
 * The reader-facing label of each measure, because a figure states its measure in words and never by
 * colour, position or an adjacent heading alone.
 */
export const SUPPORT_MEASURE_LABELS: Readonly<Record<SupportMeasure, string>> = {
  "received-gifts": "Received gifts",
  "recurring-collection-outcomes": "Recurring collection outcomes",
  commitments: "Commitments",
  "monthly-equivalent-support": "Monthly-equivalent support",
  "support-goal": "Support goal",
};

// ---------------------------------------------------------------------------------------------
// The gift row
// ---------------------------------------------------------------------------------------------

/**
 * One received gift at the grain it is reported in: a single authorised allocation, or a whole gift
 * that carries no allocation at all.
 *
 * The grain is the property that makes the figures reconcilable. One row is one authorised
 * allocation; a gift with no allocation is one row at gift grain; a 100-unit gift split 40/60
 * contributes the authorised allocation only, and a view that legitimately holds both grain levels
 * counts the 100 once. `giftCount`, `allocationCount` and `donorCount` are therefore each counted at
 * their own grain and never added together — `report.ts` enforces that, and this shape is why it can.
 *
 * Attribution is an explicit fact rather than a field that is usually empty: `anonymous` is a
 * supporter who chose not to be identified and `unresolved` is a source row that supplied no
 * attribution, and neither is a household, a church or an organisation representative. No display
 * name, email address or postal address appears here, because an equal-looking value establishes
 * neither identity nor authority.
 *
 * `originalGiftOn` is present only when the date is known: `datePrecision` states how well it is
 * known, so an `unknown` date is absent rather than replaced by today or by the entry date. A refund
 * or correction is its own row carrying the source's signed amount and naming the row it corrects,
 * rather than a gift that quietly disappears from a previously reported period.
 */
export interface GiftRow {
  /** Identity of this row within its scope: one authorised allocation, or one unallocated gift. */
  readonly giftRowId: string;
  /** The gift this row belongs to, shared by every allocation row of one split gift. */
  readonly giftId: string;
  /** Present only on an allocation row, which is how a row states its own grain. */
  readonly allocationId?: string;
  /** Exact minor units with their own currency; this module neither sums nor compares them. */
  readonly amount: Money;
  /** The gift's own date, absent when `datePrecision` is `unknown` rather than guessed. */
  readonly originalGiftOn?: CivilDate;
  readonly datePrecision: DatePrecision;
  /** The source's designation for this amount, carried verbatim and never interpreted here. */
  readonly designation?: string;
  readonly attribution: GiftAttribution;
  /** Set on a refund or correction row: the `giftRowId` this row adjusts. */
  readonly refundOf?: string;
  /** The system that owns this row and its opaque reference, so the amount keeps its provenance. */
  readonly provenance: SourceReference;
  /** The day this row entered the application, which is a different fact from the gift's own date. */
  readonly entryOn: CivilDate;
}

// ---------------------------------------------------------------------------------------------
// The support projection
// ---------------------------------------------------------------------------------------------

/**
 * The read-only projection one support subject's reports are computed from.
 *
 * Read-only is a rule rather than a convention. No UI action posts, corrects, refunds or infers
 * money: an accepted correction or refund reaches a report only because the source projection
 * reflects it, and the single writable financial fact in this application is the goal, writable only
 * under the `canEditGoal` capability. Nothing in this module gives a surface a way to change money.
 *
 * `basis` must be the one named basis. `coverage` says how much of the past the read covers, `asOf`
 * is the scenario instant the caller supplies — read here, never taken from a clock — and
 * `lastSourceUpdate` is when the source last changed: three different facts, never collapsed into one
 * timestamp, which is what lets two surfaces be compared only when their as-of time and coverage
 * agree. A currency absent from `currencyExponents` has no exponent in this application, so its
 * amounts stay unknown-currency facts instead of being summed, compared or defaulted to two decimals.
 *
 * `goal` carries the goal as the source states it, in the shape `modules/data-service/envelope.ts`
 * declares once; this module declares no second goal type. Absent means the subject has no goal,
 * which is a different fact from a goal of zero.
 */
export interface SupportProjection {
  /** The support subject this projection is about; a reference, never a name or an email address. */
  readonly supportSubjectId: string;
  readonly basis: SupportBasis;
  /** The minor-unit exponent of every currency present; a code absent from it has none at all. */
  readonly currencyExponents: Readonly<Record<string, number>>;
  readonly coverage: Coverage;
  /** The scenario instant the projection was evaluated at, supplied by the caller. */
  readonly asOf: string;
  /** When the source last changed, which is not when this read ran. */
  readonly lastSourceUpdate: string;
  /** The owning system and its opaque reference for the whole projection. */
  readonly source: SourceReference;
  /** Absent when there is no goal — not a goal of zero, and never a number invented here. */
  readonly goal?: SupportGoalRecord;
  /** Every authorised gift row, at the grain {@link GiftRow} defines. */
  readonly gifts: readonly GiftRow[];
  /** Commitments are not cash: these rows are never added to {@link gifts}. */
  readonly commitments: readonly CommitmentRow[];
}

// ---------------------------------------------------------------------------------------------
// The two guards
// ---------------------------------------------------------------------------------------------

/**
 * Whether a projection covers only part of the past, which makes every value it underlies an
 * `incomplete-subtotal`.
 *
 * `report.ts` derives that value state from this answer rather than choosing it, and a current period
 * labels itself *In progress* from the same fact. Partial coverage is never turned into a zero, an
 * empty list or an unknown value: the amounts are real, the period they cover is not yet whole, and
 * saying so is the difference between an honest subtotal and a wrong total.
 */
export function isIncompleteCoverage(projection: SupportProjection): boolean {
  return projection.coverage.state === "partial";
}

/**
 * Reports the projection's basis, refusing a basis this application does not measure.
 *
 * `report.ts` calls this before it computes anything, so a decoded projection carrying a second basis
 * fails at that boundary instead of being reported as though it were comparable with the figures the
 * application already shows. The refusal is a thrown `TypeError` because it is a broken contract
 * rather than a user-facing outcome: the service turns it into an `unavailable` or `unknown` outcome
 * at the transport edge, where an outcome vocabulary exists.
 */
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
