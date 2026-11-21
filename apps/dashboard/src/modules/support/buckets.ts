/**
 * The five recurring outcome buckets of the support family, the `outside-partition` value that keeps
 * evidence which is unknown or stale out of them, the commitment row that carries a bucket, and the
 * one function that decides a bucket from source evidence.
 *
 * Plan items that put this file in scope:
 * - AAP 0.8.1 row 4: recurring outcomes use exactly five buckets — Received, Processing, Upcoming,
 *   Recovery — needs attention, Not received — and anything unknown or stale stays outside the
 *   partition, where it is a first-class value rather than a leftover.
 * - AAP 0.6.2 "Commitment row" record: `kind`, `cadence`, `perOccurrence`, `bucketState`,
 *   `lastSuccessfulOn`, `nextEligibleOn`, `pause` and `fixedTotal`.
 * - AAP 0.10.1 Support family ("commitments with the three kinds and the five outcome buckets"),
 *   the AAP 0.9.1 tree and the AAP 0.11.1 deliverable row
 *   `modules/support/{report,buckets,basis,goal}.ts`.
 *
 * This module is the bottom of the support graph: `report.ts`, `basis.ts` and `goal.ts` may import
 * it and it imports none of them. Its only imports are the money and civil-date vocabularies, both
 * `import type`, so importing this file loads no currency table, no time-zone database and no
 * framework.
 *
 * Purity and arithmetic: every export is a constant or a pure function of its argument. No clock is
 * read, nothing is stored, fetched or mutated at import, and no financial arithmetic happens here at
 * all — a bucket names an occurrence's outcome and carries no amount. Money reaches this file only as
 * the `Money` type on a row the source projection has already computed.
 */
import type { Money } from "../money/amount";
import type { CivilDate } from "../time/civil";

// ---------------------------------------------------------------------------------------------
// The three kinds of commitment
// ---------------------------------------------------------------------------------------------

/**
 * The three kinds of commitment the source projection distinguishes, in the order a surface lists
 * them: an automatic recurring gift, a manual recurring gift and a fixed total. Closed on purpose —
 * a fourth kind is a product change rather than a configuration value — and declared in a runtime
 * form, so a stored commitment row derives its schema from this list instead of restating it.
 */
export const COMMITMENT_KINDS = ["automatic-recurring", "manual-recurring", "fixed-total"] as const;

/** One kind of commitment, derived from {@link COMMITMENT_KINDS}. */
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// The five outcomes, and `outside-partition`
// ---------------------------------------------------------------------------------------------

/**
 * Every bucket a commitment occurrence can be in, in the order the product lists them: the five
 * outcomes a surface shows, then `outside-partition` for evidence that is `unknown` or `stale`.
 * Declared in a runtime form, so a stored commitment row's schema is derived from this list.
 */
export const RECURRING_BUCKETS = [
  "received",
  "processing",
  "upcoming",
  "recovery-needs-attention",
  "not-received",
  "outside-partition",
] as const;

/**
 * Where one recurring occurrence stands, per the source evidence: the five outcomes the product
 * shows, and `outside-partition` for evidence that is `unknown` or `stale`.
 *
 * `outside-partition` is a first-class member of this union and deliberately not one of the five, so
 * the partition a surface presents stays exactly five wide. Four rules follow:
 *
 * - No badge, count, chart series or CSV cell may imply a sixth in-partition state. Evidence that
 *   cannot be placed is reported as outside the partition, never as a new bucket and never as a
 *   synonym of one of the five.
 * - A bucket never implies the worker can retry a payment. This application performs no financial
 *   action — no post, no correction, no refund, no retry — so a bucket reports what the source said
 *   and never an action available here.
 * - "Not received" is not donor debt and states nothing about the donor's intent: it says the source
 *   holds no receipt for that occurrence.
 * - Monthly-equivalent support comes from the qualified source calculation carried on the
 *   commitment, never from averaging received gifts. This module computes no equivalent and accepts
 *   no derived average as evidence.
 */
export type RecurringBucket = (typeof RECURRING_BUCKETS)[number];

/**
 * The five in-partition buckets in the order every surface lists them — Received, Processing,
 * Upcoming, Recovery — needs attention, Not received — and nothing else. `outside-partition` is
 * absent by design: it is what keeps the partition exactly five wide.
 */
export const PARTITION_BUCKETS = [
  "received",
  "processing",
  "upcoming",
  "recovery-needs-attention",
  "not-received",
] as const satisfies readonly RecurringBucket[];

/**
 * The one value that sits outside the five, named so a caller states it instead of spelling the
 * string, and so no comparison against it can drift from {@link RecurringBucket}.
 */
export const OUTSIDE_PARTITION: Extract<RecurringBucket, "outside-partition"> = "outside-partition";

/**
 * The display label of every bucket, because a badge must never carry its state by colour alone.
 * These are reader-facing text, not class names and not icon keys; `status-badge` renders the label
 * it reads here rather than holding a second copy of it.
 */
export const BUCKET_LABELS: Readonly<Record<RecurringBucket, string>> = {
  received: "Received",
  processing: "Processing",
  upcoming: "Upcoming",
  "recovery-needs-attention": "Recovery — needs attention",
  "not-received": "Not received",
  "outside-partition": "Unknown or stale — outside the five outcomes",
};

// ---------------------------------------------------------------------------------------------
// The commitment row
// ---------------------------------------------------------------------------------------------

/** Whether a commitment is running or paused, and the civil day it resumes on when one is set. */
export interface CommitmentPause {
  readonly state: "active" | "paused";
  readonly resumeOn?: CivilDate;
}

/**
 * A fixed-total commitment's promised, fulfilled, released and remaining amounts, as the source
 * states them. Four exact amounts rather than a percentage, because a progress figure is the
 * source's to compute and never this application's.
 */
export interface FixedTotalProgress {
  readonly promised: Money;
  readonly fulfilled: Money;
  readonly released: Money;
  readonly remaining: Money;
}

/**
 * One commitment row as AAP 0.6.2 defines it: a read-only projection of what the source reports
 * about a recurring or fixed-total commitment, carrying the bucket the occurrence currently stands
 * in. Every amount is exact minor units with its own currency, and none of them is added, compared
 * or reformatted here — `report.ts` does that through `modules/money`.
 */
export interface CommitmentRow {
  /** Identity of this row within its scope; a commitment appears once, its occurrences are not rows. */
  readonly commitmentRowId: string;
  readonly kind: CommitmentKind;
  /** The source's own cadence wording (monthly, quarterly, annual, …), carried verbatim. */
  readonly cadence: string;
  /** The amount the source reports for one occurrence of that cadence. */
  readonly perOccurrence: Money;
  readonly bucketState: RecurringBucket;
  /** The last day the source confirmed a successful collection, as a civil date. */
  readonly lastSuccessfulOn?: CivilDate;
  /** The next day the source reports the commitment eligible to collect on, as a civil date. */
  readonly nextEligibleOn?: CivilDate;
  readonly pause: CommitmentPause;
  /** Present only for `fixed-total`: the four amounts that fixed total is measured by. */
  readonly fixedTotal?: FixedTotalProgress;
  /**
   * The source's qualified monthly equivalent. Supplied by the source calculation and never derived
   * here: averaging received gifts would state a measure this application cannot know.
   */
  readonly monthlyEquivalentFromSource?: Money;
}

// ---------------------------------------------------------------------------------------------
// Deciding a bucket from evidence
// ---------------------------------------------------------------------------------------------

/**
 * What the source reports about one occurrence, and optionally the day it reported it.
 *
 * `unknown` is evidence that never arrived and `stale` is evidence that has aged past the point the
 * source will confirm it; both leave the five-bucket partition rather than being guessed into one of
 * them.
 */
export interface RecurringEvidence {
  readonly observed:
    | "settled"
    | "pending"
    | "scheduled"
    | "needs-attention"
    | "not-received"
    | "unknown"
    | "stale";
  /** Carried for diagnostics only: it decides no bucket, no deadline and no boundary. */
  readonly recordedOn?: CivilDate;
}

/**
 * Reports the bucket one occurrence belongs to — the only place in the application where a bucket is
 * decided.
 *
 * The mapping is the specification's: settled evidence is Received, pending is Processing, scheduled
 * is Upcoming, needs-attention is Recovery — needs attention, an absent receipt is Not received, and
 * evidence that is unknown or stale is outside the partition. The `switch` has no catch-all over a
 * live value, so a new evidence member fails to compile here instead of landing in a default bucket.
 */
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

/**
 * Reports evidence the type system has ruled out but a decoded source payload can still carry, so a
 * shape that drifted fails loudly where it is read instead of silently becoming a bucket.
 */
function unreachableEvidence(observed: never): never {
  throw new TypeError(`Unrecognised recurring evidence: ${String(observed)}`);
}

/**
 * Whether a bucket is one of the five the partition is made of.
 *
 * It exists so a caller can state a partition total honestly: a total that counted
 * `outside-partition` rows would not be a total of anything, because those rows carry no outcome the
 * five describe.
 */
export function isInPartition(bucket: RecurringBucket): boolean {
  return bucket !== OUTSIDE_PARTITION;
}
