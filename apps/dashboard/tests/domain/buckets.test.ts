/**
 * Proves the recurring-outcome bucket model: exactly five outcomes, the first-class
 * `outside-partition` value that keeps evidence which is unknown or stale out of them, and the
 * structural rules a bucket obeys — no sixth state, no retry affordance, no debt, no amount and no
 * monthly equivalent.
 */
import { describe, expect, it } from "vitest";
import type { Money } from "@/modules/money/amount";
import * as buckets from "@/modules/support/buckets";
const ALL_BUCKETS: readonly buckets.RecurringBucket[] = [...buckets.PARTITION_BUCKETS, buckets.OUTSIDE_PARTITION];

const ALL_EVIDENCE: readonly buckets.RecurringEvidence["observed"][] = ["settled", "pending", "scheduled", "needs-attention", "not-received", "unknown", "stale"];

function usd(minorUnits: number): Money {
  return { currency: "USD", minorUnits: minorUnits as Money["minorUnits"] };
}
function commitmentRow(overrides: Partial<buckets.CommitmentRow> = {}): buckets.CommitmentRow {
  return {
    commitmentRowId: "commitment-row-1",
    kind: "automatic-recurring",
    cadence: "monthly",
    perOccurrence: usd(2500),
    bucketState: "received",
    pause: { state: "active" },
    ...overrides,
  };
}
function keysDeep(value: object): readonly string[] {
  return Object.entries(value).flatMap(([key, child]) => (child !== null && typeof child === "object" ? [key, ...keysDeep(child)] : [key]));
}
describe("the bucket vocabulary", () => {
  it("closes the partition at exactly five outcomes", () => {
    expect(buckets.PARTITION_BUCKETS).toHaveLength(5);
    // A duplicate would hold the count at five while one outcome went missing.
    expect(new Set(buckets.PARTITION_BUCKETS).size).toBe(5);
    expect([...buckets.PARTITION_BUCKETS]).toEqual(["received", "processing", "upcoming", "recovery-needs-attention", "not-received"]);
  });
  it("exports outside-partition as a first-class value that is no sixth outcome", () => {
    expect(buckets.OUTSIDE_PARTITION).toBe("outside-partition");
    expect<string[]>([...buckets.PARTITION_BUCKETS]).not.toContain(buckets.OUTSIDE_PARTITION);
    // Set membership and the grouping question both answer "no", so the value is a real state
    // rather than a leftover string that happens to be spelled out somewhere.
    expect(buckets.isInPartition(buckets.OUTSIDE_PARTITION)).toBe(false);
  });
  it("labels all six values with distinct reader-facing text", () => {
    expect(ALL_BUCKETS).toHaveLength(6);
    expect(new Set(ALL_BUCKETS).size).toBe(6);
    // Every value carries a label and nothing else does, so a seventh value cannot arrive without
    // this count or this key set changing.
    expect(Object.keys(buckets.BUCKET_LABELS).sort()).toEqual([...ALL_BUCKETS].sort());
    const labels = ALL_BUCKETS.map((bucket) => buckets.BUCKET_LABELS[bucket]);
    for (const label of labels) {
      expect(label.trim()).not.toBe("");
      // Text, never a colour, an icon or a symbol standing on its own: colour may not carry a
      // state anywhere in this application.
      expect(label).toMatch(/\p{L}/u);
      expect(label).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|var\(--|\b(?:bg|text|border)-/iu);
    }
    expect(new Set(labels).size).toBe(6);
  });
});
describe("classifying an occurrence", () => {
  it("places a settled occurrence in Received", () => {
    expect(buckets.bucketFor({ observed: "settled" })).toBe("received");
  });
  it("places a pending occurrence in Processing", () => {
    expect(buckets.bucketFor({ observed: "pending" })).toBe("processing");
  });
  it("places a scheduled occurrence in Upcoming", () => {
    expect(buckets.bucketFor({ observed: "scheduled" })).toBe("upcoming");
  });
  it("places a needs-attention occurrence in Recovery — needs attention", () => {
    expect(buckets.bucketFor({ observed: "needs-attention" })).toBe("recovery-needs-attention");
  });
  it("places an absence of receipt in Not received", () => {
    expect(buckets.bucketFor({ observed: "not-received" })).toBe("not-received");
  });
});
describe("evidence that cannot be placed", () => {
  it("keeps stale evidence outside the partition", () => {
    const bucket = buckets.bucketFor({ observed: "stale" });
    expect(bucket).toBe(buckets.OUTSIDE_PARTITION);
    // The dangerous default is "stale means not received", so the negative is asserted as well as
    // the positive: a classifier that fell back to the nearest definite outcome fails here twice.
    expect(bucket).not.toBe("received");
    for (const outcome of buckets.PARTITION_BUCKETS) {
      expect(bucket).not.toBe(outcome);
    }
  });
  it("keeps absent evidence outside the partition", () => {
    const bucket = buckets.bucketFor({ observed: "unknown" });
    expect(bucket).toBe(buckets.OUTSIDE_PARTITION);
    expect(bucket).not.toBe("not-received");
    for (const outcome of buckets.PARTITION_BUCKETS) {
      expect(bucket).not.toBe(outcome);
    }
  });
  it("claims no amount for evidence it cannot place", () => {
    const unplaced = [buckets.bucketFor({ observed: "unknown" }), buckets.bucketFor({ observed: "stale" })];
    for (const bucket of unplaced) {
      // A classifier that interpolated a value or summed a total would have to return something
      // carrying digits or a currency code; a bucket is a name and nothing else.
      expect(typeof bucket).toBe("string");
      expect(bucket).not.toMatch(/\d/);
      expect(bucket).not.toMatch(/\b[A-Z]{3}\b/);
      expect(buckets.isInPartition(bucket)).toBe(false);
    }
  });
});
describe("what a bucket does not say", () => {
  const AFFORDANCE_OR_DEBT = /retry|owed|debt|dunning|collect/i;
  it("offers no retry affordance and no debt shape on a not-received occurrence", () => {
    const bucketState = buckets.bucketFor({ observed: "not-received" });
    expect(bucketState).toBe("not-received");
    // The classification is a string primitive, so it holds no field at all; the scan below covers
    // the two places an affordance could still appear — the row a badge renders and the module.
    expect(typeof bucketState).toBe("string");
    const row = commitmentRow({
      kind: "fixed-total",
      cadence: "annual",
      bucketState,
      fixedTotal: {
        promised: usd(120_000),
        fulfilled: usd(40_000),
        released: usd(0),
        remaining: usd(80_000),
      },
    });
    // Asserted on the row a badge renders, at any depth: a nested retry or owed field would let the
    // surface offer an action this application never performs, and would read a missing collection
    // as the donor's debt.
    expect(keysDeep(row).filter((key) => AFFORDANCE_OR_DEBT.test(key))).toEqual([]);
    // And on the module's own surface, so no helper can add the affordance beside the vocabulary.
    expect(Object.keys(buckets).filter((name) => AFFORDANCE_OR_DEBT.test(name))).toEqual([]);
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
    const MEASURE = /monthly|equivalent|gift|donation|averag|total/i;
    expect(Object.keys(buckets).filter((name) => MEASURE.test(name))).toEqual([]);
    // A monthly equivalent exists only where the source calculated it: a row built without one
    // carries none, because averaging received gifts would state a measure this module cannot know.
    expect(commitmentRow().monthlyEquivalentFromSource).toBeUndefined();
  });
  it("refuses to give a received gift a commitment bucket", () => {
    // A commitment is not received money and a received gift is not a commitment outcome, so the
    // evidence vocabulary holds no gift member and asking for one is a programming error rather
    // than a sixth bucket.
    expect(() => buckets.bucketFor({ observed: "gift-received" } as unknown as buckets.RecurringEvidence)).toThrow(/gift-received/);
    // The commitment outcome that does carry the word stays exactly one bucket.
    expect(buckets.bucketFor({ observed: "settled" })).toBe("received");
  });
  it("groups outside-partition apart from the five outcomes", () => {
    const inPartition = ALL_BUCKETS.filter((bucket) => buckets.isInPartition(bucket));
    const outsidePartition = ALL_BUCKETS.filter((bucket) => !buckets.isInPartition(bucket));
    // The grouping covers all six values with no overlap, so no surface can imply a sixth
    // in-partition badge by grouping an unplaced row together with the five.
    expect(inPartition).toHaveLength(5);
    expect([...inPartition]).toEqual([...buckets.PARTITION_BUCKETS]);
    expect([...outsidePartition]).toEqual([buckets.OUTSIDE_PARTITION]);
  });
});
