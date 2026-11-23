/** Proves the recurring-outcome bucket model: exactly five outcomes, the first-class `outside-partition` value that keeps evidence which is unknown or stale out of them, and the structural rules a … */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reads } from "@/modules/data-service";
import type { SessionSource } from "@/modules/data-service/authorize";
import type { Money } from "@/modules/money/amount";
import { resetSession } from "@/modules/store/repository";
import * as buckets from "@/modules/support/buckets";
import { expectEnvelope } from "../helpers/answers";
import { layDownSeededSession } from "../helpers/fixtures";
const ALL_BUCKETS: readonly buckets.RecurringBucket[] = [...buckets.PARTITION_BUCKETS, buckets.OUTSIDE_PARTITION];
const ALL_EVIDENCE: readonly buckets.RecurringEvidence["observed"][] = ["settled", "pending", "scheduled", "needs-attention", "not-received", "unknown", "stale"];
/** The words that would state an action this application never performs — a retry — or a fact it never claims — that an unreceived occurrence is a debt being collected. */
const AFFORDANCE_OR_DEBT = /retry|owed|debt|dunning|collect/i;
const usd = (minorUnits: number): Money => ({ currency: "USD", minorUnits: minorUnits as Money["minorUnits"] });
const commitmentRow = (overrides: Partial<buckets.CommitmentRow> = {}): buckets.CommitmentRow => ({ commitmentRowId: "commitment-row-1", kind: "automatic-recurring", cadence: "monthly", perOccurrence: usd(2500), bucketState: "received", pause: { state: "active" }, ...overrides });
const keysDeep = (value: object): readonly string[] => Object.entries(value).flatMap(([key, child]) => (child !== null && typeof child === "object" ? [key, ...keysDeep(child)] : [key]));
/** The private session the read-path case acts in: a shared seeded id would put this file's fixtures in a sibling suite's world. */
const SESSION_ID = "domain-buckets-shape";
const SOURCE: SessionSource = { sessionId: SESSION_ID };
type CommitmentsRead = Awaited<ReturnType<typeof reads.support.readCommitments>>;
type CommitmentRowFigure = Extract<CommitmentsRead, { readonly kind: "envelope" }>["envelope"]["data"]["commitments"][number];
/** Lays the seeded harbour workspace down under this file's own session id, from the documents the seed publishes rather than from a literal written here. */
beforeAll(() => layDownSeededSession(SESSION_ID, "established-worker"), 120_000);
afterAll(async () => {
  await resetSession(SESSION_ID); // The session is this file's own, so the store is left holding none of its fixtures.
});
async function seededCommitmentRows(): Promise<readonly CommitmentRowFigure[]> {
  const { commitments, total } = expectEnvelope(await reads.support.readCommitments({}, SOURCE), `the commitments read for "${SESSION_ID}"`).data;
  if (commitments.length !== total) throw new Error(`The commitments read returned ${String(commitments.length)} rows of ${String(total)}, so a page window would hide rows this case is meant to inspect.`); // The window the read returns is the whole seeded list, so no row the seed states is left unexamined.
  return commitments;
}
describe("the bucket vocabulary", () => {
  it("closes the partition at exactly five outcomes", () => {
    expect(buckets.PARTITION_BUCKETS).toHaveLength(5);
    expect([new Set(buckets.PARTITION_BUCKETS).size, [...buckets.PARTITION_BUCKETS]]).toEqual([5, ["received", "processing", "upcoming", "recovery-needs-attention", "not-received"]]); // A duplicate would hold the count at five while one outcome went missing.
  });
  it("exports outside-partition as a first-class value that is no sixth outcome", () => {
    expect(buckets.OUTSIDE_PARTITION).toBe("outside-partition");
    expect<string[]>([...buckets.PARTITION_BUCKETS]).not.toContain(buckets.OUTSIDE_PARTITION);
    expect(buckets.isInPartition(buckets.OUTSIDE_PARTITION)).toBe(false); // Set membership and the grouping question both answer "no", so the value is a real state rather than a leftover string that happens to be spelled out somewhere.
  });
  it("labels all six values with distinct reader-facing text", () => {
    expect(ALL_BUCKETS).toHaveLength(6);
    expect(new Set(ALL_BUCKETS).size).toBe(6);
    expect(Object.keys(buckets.BUCKET_LABELS).sort()).toEqual([...ALL_BUCKETS].sort()); // Every value carries a label and nothing else does, so a seventh value cannot arrive without this count or this key set changing.
    const labels = ALL_BUCKETS.map((bucket) => buckets.BUCKET_LABELS[bucket]);
    for (const label of labels) {
      expect(label.trim()).not.toBe("");
      expect(label).toMatch(/\p{L}/u);
      expect(label).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|var\(--|\b(?:bg|text|border)-/iu);
    }
    expect(new Set(labels).size).toBe(6);
  });
});
const PLACEMENTS: readonly { readonly placed: string; readonly observed: buckets.RecurringEvidence["observed"]; readonly expected: buckets.RecurringBucket }[] = [
  { placed: "a settled occurrence in Received", observed: "settled", expected: "received" },
  { placed: "a pending occurrence in Processing", observed: "pending", expected: "processing" },
  { placed: "a scheduled occurrence in Upcoming", observed: "scheduled", expected: "upcoming" },
  { placed: "a needs-attention occurrence in Recovery — needs attention", observed: "needs-attention", expected: "recovery-needs-attention" },
  { placed: "an absence of receipt in Not received", observed: "not-received", expected: "not-received" },
];
describe("classifying an occurrence", () => {
  it.each(PLACEMENTS)("places $placed", ({ observed, expected }) => {
    expect(buckets.bucketFor({ observed })).toBe(expected);
  });
});
describe("evidence that cannot be placed", () => {
  it.each([
    { observed: "stale", nearestDefiniteOutcome: "received" },
    { observed: "unknown", nearestDefiniteOutcome: "not-received" },
  ] as const)("keeps $observed evidence outside the partition", ({ observed, nearestDefiniteOutcome }) => {
    const bucket = buckets.bucketFor({ observed });
    expect(bucket).toBe(buckets.OUTSIDE_PARTITION);
    expect(bucket).not.toBe(nearestDefiniteOutcome); // The dangerous default is "stale means not received", so the negative is asserted as well as the positive: a classifier that fell back to the nearest definite outcome fails here twice.
    for (const outcome of buckets.PARTITION_BUCKETS) expect(bucket).not.toBe(outcome);
  });
  it("claims no amount for evidence it cannot place", () => {
    const unplaced = [buckets.bucketFor({ observed: "unknown" }), buckets.bucketFor({ observed: "stale" })];
    for (const bucket of unplaced) {
      expect(typeof bucket).toBe("string"); // A classifier that interpolated a value or summed a total would have to return something carrying digits or a currency code; a bucket is a name and nothing else.
      for (const expected of [/\d/, /\b[A-Z]{3}\b/]) expect(bucket).not.toMatch(expected);
      expect(buckets.isInPartition(bucket)).toBe(false);
    }
  });
});
describe("what a bucket does not say", () => {
  it("offers no retry affordance and no debt shape on a not-received occurrence", () => {
    const bucketState = buckets.bucketFor({ observed: "not-received" });
    expect(bucketState).toBe("not-received");
    expect(typeof bucketState).toBe("string"); // The classification is a string primitive, so it holds no field at all; the scan below covers the two places an affordance could still appear here — the row a badge renders and the module — and the case at the end of this file covers the row the read path builds.
    const row = commitmentRow({ kind: "fixed-total", cadence: "annual", bucketState, fixedTotal: { promised: usd(120_000), fulfilled: usd(40_000), released: usd(0), remaining: usd(80_000) } });
    expect(keysDeep(row).filter((key) => AFFORDANCE_OR_DEBT.test(key))).toEqual([]); // Asserted on the row a badge renders, at any depth: a nested retry or owed field would let the surface offer an action this application never performs, and would read a missing collection as the donor's debt.
    expect(Object.keys(buckets).filter((name) => AFFORDANCE_OR_DEBT.test(name))).toEqual([]); // And on the module's own surface, so no helper can add the affordance beside the vocabulary.
  });
  it("returns only the bucket, never a money total", () => {
    const classifications = ALL_EVIDENCE.map((observed) => buckets.bucketFor({ observed }));
    expect(classifications).toHaveLength(ALL_EVIDENCE.length);
    for (const bucket of classifications) {
      expect(typeof bucket).toBe("string");
      expect(ALL_BUCKETS).toContain(bucket);
      expect(bucket).not.toMatch(/\d/);
    }
  });
});
describe("the five measures stay five", () => {
  it("exposes no monthly-equivalent and no gift measure", () => {
    expect(Object.keys(buckets).filter((name) => /monthly|equivalent|gift|donation|averag|total/i.test(name))).toEqual([]);
    expect(commitmentRow().monthlyEquivalentFromSource).toBeUndefined(); // A monthly equivalent exists only where the source calculated it: a row built without one carries none, because averaging received gifts would state a measure this module cannot know.
  });
  it("refuses to give a received gift a commitment bucket", () => {
    // A commitment is not received money and a received gift is not a commitment outcome, so the evidence vocabulary holds no gift member and asking for one is a programming error rather than a sixth bucket.
    expect(() => buckets.bucketFor({ observed: "gift-received" } as unknown as buckets.RecurringEvidence)).toThrow(/gift-received/);
    expect(buckets.bucketFor({ observed: "settled" })).toBe("received");
  });
  it("groups outside-partition apart from the five outcomes", () => {
    const inPartition = ALL_BUCKETS.filter((bucket) => buckets.isInPartition(bucket));
    const outsidePartition = ALL_BUCKETS.filter((bucket) => !buckets.isInPartition(bucket));
    expect(inPartition).toHaveLength(5); // The grouping covers all six values with no overlap, so no surface can imply a sixth in-partition badge by grouping an unplaced row together with the five.
    expect([[...inPartition], [...outsidePartition]]).toEqual([[...buckets.PARTITION_BUCKETS], [buckets.OUTSIDE_PARTITION]]);
  });
});
describe("the row the read path builds", () => {
  /** The words that would state a measure taken from gifts — a donation, or an average of receipts — which no commitment row may carry. */
  it("states a bucket the module names, and no retry affordance, debt shape, gift measure or monthly equivalent", async () => {
    const rows = await seededCommitmentRows();
    expect(new Set(rows.map((row) => row.bucket))).toEqual(new Set(buckets.RECURRING_BUCKETS)); // The seeded commitments cover every value, so the scans below reach a row in each state rather than whichever rows the seed happens to list first.
    for (const row of rows) {
      expect(typeof row.bucket).toBe("string"); // The bucket is the module's own value, labelled and partitioned by the module, so a field set added inside the read path cannot state a seventh value or carry a badge of its own.
      expect(buckets.RECURRING_BUCKETS).toContain(row.bucket);
      expect([row.inPartition, row.bucketLabel]).toEqual([buckets.isInPartition(row.bucket), buckets.BUCKET_LABELS[row.bucket]]);
      // A retry affordance or a debt shape anywhere in the row, at any depth, would offer an action this application never performs and would read a missing collection as the donor's debt.
      expect([keysDeep(row).filter((key) => AFFORDANCE_OR_DEBT.test(key)), keysDeep(row).filter((key) => /gift|donation|averag/i.test(key))]).toEqual([[], []]);
      expect(row.monthlyEquivalent).toBeNull(); // No seeded commitment states a source monthly equivalent, so a figure here would be one the read averaged rather than the qualified calculation the model permits. The field itself legitimately stays, carrying null.
    }
  });
});
