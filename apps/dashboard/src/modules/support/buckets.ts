/**
 * The five recurring outcome buckets of the support family, the `outside-partition` value that keeps
 * evidence which is unknown or stale out of them, the commitment row that carries a bucket, and the
 * one function that decides a bucket from source evidence.
 */
import type { Money } from "../money/amount";
import type { CivilDate } from "../time/civil";
// The three kinds of commitment
/** The three kinds of commitment the source projection distinguishes, in the order a surface lists them: an automatic recurring gift, a manual recurring gift and a fixed total. */
export const COMMITMENT_KINDS = ["automatic-recurring", "manual-recurring", "fixed-total"] as const;
/** One kind of commitment, derived from {@link COMMITMENT_KINDS}. */
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];
// The five outcomes, and `outside-partition`
/** Every bucket a commitment occurrence can be in, in the order the product lists them: the five outcomes a surface shows, then `outside-partition` for evidence that is `unknown` or `stale`. */
export const RECURRING_BUCKETS = ["received", "processing", "upcoming", "recovery-needs-attention", "not-received", "outside-partition"] as const;
/** Where one recurring occurrence stands, per the source evidence: the five outcomes the product shows, and `outside-partition` for evidence that is `unknown` or `stale`. */
export type RecurringBucket = (typeof RECURRING_BUCKETS)[number];
/** The five in-partition buckets in the order every surface lists them — Received, Processing, Upcoming, Recovery — needs attention, Not received — and nothing else. */
export const PARTITION_BUCKETS = ["received", "processing", "upcoming", "recovery-needs-attention", "not-received"] as const satisfies readonly RecurringBucket[];
/** The one value that sits outside the five, named so a caller states it instead of spelling the string, and so no comparison against it can drift from {@link RecurringBucket}. */
export const OUTSIDE_PARTITION: Extract<RecurringBucket, "outside-partition"> = "outside-partition";
/** The display label of every bucket, because a badge must never carry its state by colour alone. */
export const BUCKET_LABELS: Readonly<Record<RecurringBucket, string>> = {
  received: "Received",
  processing: "Processing",
  upcoming: "Upcoming",
  "recovery-needs-attention": "Recovery — needs attention",
  "not-received": "Not received",
  "outside-partition": "Unknown or stale — outside the five outcomes",
};
// The commitment row
/** Whether a commitment is running or paused, and the civil day it resumes on when one is set. */
export interface CommitmentPause {
  readonly state: "active" | "paused";
  readonly resumeOn?: CivilDate;
}
/** A fixed-total commitment's promised, fulfilled, released and remaining amounts, as the source states them. */
export interface FixedTotalProgress {
  readonly promised: Money;
  readonly fulfilled: Money;
  readonly released: Money;
  readonly remaining: Money;
}
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
// Deciding a bucket from evidence
/** What the source reports about one occurrence, and optionally the day it reported it. */
export interface RecurringEvidence {
  readonly observed: "settled" | "pending" | "scheduled" | "needs-attention" | "not-received" | "unknown" | "stale";
  readonly recordedOn?: CivilDate;
}
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
/** Whether a bucket is one of the five the partition is made of. */
export function isInPartition(bucket: RecurringBucket): boolean {
  return bucket !== OUTSIDE_PARTITION;
}
