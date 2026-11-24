import type { SourceReference } from "../../lib/ids";
import type { Coverage, GiftAttribution, SupportBasis, SupportGoalRecord } from "../data-service/envelope";
import type { Money } from "../money/amount";
import type { CivilDate, DatePrecision } from "../time/civil";
import type { CommitmentRow } from "./buckets";
export const SUPPORT_BASIS: SupportBasis = "effective_cash_allocation";
export type { SupportBasis };
export const BASIS_DESCRIPTION =
  "Received support is measured as source-qualified effective cash allocations at the grain of one authorised allocation — a gift with no allocation counts once at gift grain, and a split gift contributes only the allocation this read is authorised to see — attributed to each gift's own original gift date, with accepted corrections and refunds reflected exactly as the source states them.";
export type SupportMeasure = "received-gifts" | "recurring-collection-outcomes" | "commitments" | "monthly-equivalent-support" | "support-goal";
export const SUPPORT_MEASURE_LABELS: Readonly<Record<SupportMeasure, string>> = { "received-gifts": "Received gifts", "recurring-collection-outcomes": "Recurring collection outcomes", commitments: "Commitments", "monthly-equivalent-support": "Monthly-equivalent support", "support-goal": "Support goal" };
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
/** Reports the projection's basis, refusing a basis this application does not measure. */ export function assertSingleBasis(projection: SupportProjection): SupportBasis {
  const basis: string = projection.basis;
  if (basis !== SUPPORT_BASIS) throw new TypeError(`Support projection "${projection.supportSubjectId}" reports the basis "${basis}", which this application does not measure. A second basis would make two support figures incomparable, so the projection is refused instead of reported.`);
  return SUPPORT_BASIS;
}
