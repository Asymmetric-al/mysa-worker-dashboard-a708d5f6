/** The five recurring outcome buckets of the support family, the `outside-partition` value that keeps evidence which is unknown or stale out of them, the commitment row that carries a bucket. */
import type { Money } from "../money/amount";
import type { CivilDate } from "../time/civil";
export const COMMITMENT_KINDS = ["automatic-recurring", "manual-recurring", "fixed-total"] as const;
/** One kind of commitment, derived from {@link COMMITMENT_KINDS}. */
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];
// The five outcomes, and `outside-partition`
export const RECURRING_BUCKETS = ["received", "processing", "upcoming", "recovery-needs-attention", "not-received", "outside-partition"] as const;
export type RecurringBucket = (typeof RECURRING_BUCKETS)[number];
export const PARTITION_BUCKETS = ["received", "processing", "upcoming", "recovery-needs-attention", "not-received"] as const satisfies readonly RecurringBucket[];
export const OUTSIDE_PARTITION: Extract<RecurringBucket, "outside-partition"> = "outside-partition";
/** The display label of every bucket, because a badge must never carry its state by colour alone. */
export const BUCKET_LABELS: Readonly<Record<RecurringBucket, string>> = { received: "Received", processing: "Processing", upcoming: "Upcoming", "recovery-needs-attention": "Recovery — needs attention", "not-received": "Not received", "outside-partition": "Unknown or stale — outside the five outcomes" };
export type CommitmentPause = { readonly state: "active" | "paused"; readonly resumeOn?: CivilDate };
export type FixedTotalProgress = { readonly promised: Money; readonly fulfilled: Money; readonly released: Money; readonly remaining: Money };
/** One commitment row as AAP 0.6.2 defines it: a read-only projection of what the source reports about a recurring or fixed-total commitment, carrying the bucket the occurrence currently. */
export interface CommitmentRow {
  readonly commitmentRowId: string;
  readonly kind: CommitmentKind;
  readonly cadence: string;
  readonly perOccurrence: Money;
  readonly bucketState: RecurringBucket;
  readonly lastSuccessfulOn?: CivilDate;
  readonly nextEligibleOn?: CivilDate;
  readonly pause: CommitmentPause;
  readonly fixedTotal?: FixedTotalProgress;
  readonly monthlyEquivalentFromSource?: Money;
}
export type RecurringEvidence = { readonly observed: "settled" | "pending" | "scheduled" | "needs-attention" | "not-received" | "unknown" | "stale"; readonly recordedOn?: CivilDate };
/** Reports the bucket one occurrence belongs to — the only place in the application where a bucket is decided. */
export function bucketFor(evidence: RecurringEvidence): RecurringBucket {
  switch (evidence.observed) {
    case "settled":
      return "received";
    case "pending":
      return "processing";
    case "scheduled":
      return "upcoming";
    case "needs-attention":
      return "recovery-needs-attention";
    case "not-received":
      return "not-received";
    case "unknown":
    case "stale":
      return OUTSIDE_PARTITION;
    default:
      return unreachableEvidence(evidence.observed);
  }
}
function unreachableEvidence(observed: never): never {
  throw new TypeError(`Unrecognised recurring evidence: ${String(observed)}`);
}
export const isInPartition = (bucket: RecurringBucket): boolean => bucket !== OUTSIDE_PARTITION;
