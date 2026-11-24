import type { Money } from "../money/amount";
import type { CivilDate } from "../time/civil";
export const COMMITMENT_KINDS = ["automatic-recurring", "manual-recurring", "fixed-total"] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];
export const RECURRING_BUCKETS = ["received", "processing", "upcoming", "recovery-needs-attention", "not-received", "outside-partition"] as const;
export type RecurringBucket = (typeof RECURRING_BUCKETS)[number];
export const PARTITION_BUCKETS = ["received", "processing", "upcoming", "recovery-needs-attention", "not-received"] as const satisfies readonly RecurringBucket[];
export const OUTSIDE_PARTITION: Extract<RecurringBucket, "outside-partition"> = "outside-partition";
export const BUCKET_LABELS: Readonly<Record<RecurringBucket, string>> = { received: "Received", processing: "Processing", upcoming: "Upcoming", "recovery-needs-attention": "Recovery — needs attention", "not-received": "Not received", "outside-partition": "Unknown or stale — outside the five outcomes" };
export type CommitmentPause = { readonly state: "active" | "paused"; readonly resumeOn?: CivilDate };
export type FixedTotalProgress = { readonly promised: Money; readonly fulfilled: Money; readonly released: Money; readonly remaining: Money };
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
const BUCKET_BY_EVIDENCE: Readonly<Partial<Record<RecurringEvidence["observed"], RecurringBucket>>> = { settled: "received", pending: "processing", scheduled: "upcoming", "needs-attention": "recovery-needs-attention", "not-received": "not-received", unknown: OUTSIDE_PARTITION, stale: OUTSIDE_PARTITION };
export const bucketFor = (evidence: RecurringEvidence): RecurringBucket => BUCKET_BY_EVIDENCE[evidence.observed] ?? unreachableEvidence(evidence.observed as never);
function unreachableEvidence(observed: never): never {
  throw new TypeError(`Unrecognised recurring evidence: ${String(observed)}`);
}
export const isInPartition = (bucket: RecurringBucket): boolean => bucket !== OUTSIDE_PARTITION;
