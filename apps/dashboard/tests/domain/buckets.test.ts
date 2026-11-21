/** Proves the recurring-outcome bucket model: exactly five outcomes, the first-class `outside-partition` value that keeps evidence which is unknown or stale out of them, and the structural rules a … */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reads } from "@/modules/data-service";
import type { SessionSource } from "@/modules/data-service/authorize";
import { seed, type SeededSessionWithDocuments } from "@/modules/dev-runtime/seed";
import type { Money } from "@/modules/money/amount";
import { resetSession } from "@/modules/store/repository";
import * as buckets from "@/modules/support/buckets";
const ALL_BUCKETS: readonly buckets.RecurringBucket[] = [...buckets.PARTITION_BUCKETS, buckets.OUTSIDE_PARTITION];
const ALL_EVIDENCE: readonly buckets.RecurringEvidence["observed"][] = ["settled", "pending", "scheduled", "needs-attention", "not-received", "unknown", "stale"];
/** The words that would state an action this application never performs — a retry — or a fact it never claims — that an unreceived occurrence is a debt being collected. */
const AFFORDANCE_OR_DEBT = /retry|owed|debt|dunning|collect/i;
function usd(minorUnits: number): Money {
  return { currency: "USD", minorUnits: minorUnits as Money["minorUnits"] };
}
function commitmentRow(overrides: Partial<buckets.CommitmentRow> = {}): buckets.CommitmentRow {
  return { commitmentRowId: "commitment-row-1", kind: "automatic-recurring", cadence: "monthly", perOccurrence: usd(2500), bucketState: "received", pause: { state: "active" }, ...overrides };
}
function keysDeep(value: object): readonly string[] {
  return Object.entries(value).flatMap(([key, child]) => (child !== null && typeof child === "object" ? [key, ...keysDeep(child)] : [key]));
}
/** The private session the read-path case acts in: a shared seeded id would put this file's fixtures in a sibling suite's world. */
const SESSION_ID = "domain-buckets-shape";
const SOURCE: SessionSource = { sessionId: SESSION_ID };
type CommitmentsRead = Awaited<ReturnType<typeof reads.support.readCommitments>>;
type CommitmentRowFigure = Extract<CommitmentsRead, { readonly kind: "envelope" }>["envelope"]["data"]["commitments"][number];
/** The seeded world, built once: the documents are deterministic, so the session below always starts from the same bytes. */
let seededWorld: Promise<readonly SeededSessionWithDocuments[]> | undefined;
function seededSessions(): Promise<readonly SeededSessionWithDocuments[]> {
  seededWorld ??= seed();
  return seededWorld;
}
/** Lays the seeded harbour workspace down under this file's own session id, from the documents the seed publishes rather than from a literal written here. */
async function layDownSession(): Promise<void> {
  const sessions = await seededSessions();
  const template = sessions.find((session) => session.sessionId === "established-worker");
  if (template === undefined) throw new Error('The seed lays down no "established-worker" workspace, so the read path has no commitments to state.');
  const { documents } = template;
  await resetSession(SESSION_ID, { ...documents, state: { ...documents.state, context: { ...documents.state.context, sessionId: SESSION_ID } } });
}
beforeAll(layDownSession, 120_000);
afterAll(async () => {
  // The session is this file's own, so the store is left holding none of its fixtures.
  await resetSession(SESSION_ID);
});
async function seededCommitmentRows(): Promise<readonly CommitmentRowFigure[]> {
  const result = await reads.support.readCommitments({}, SOURCE);
  if (result.kind !== "envelope") throw new Error(`The commitments read for "${SESSION_ID}" answered "${result.kind}" instead of an envelope, so there are no rows to inspect.`);
  const { commitments, total } = result.envelope.data;
  // The window the read returns is the whole seeded list, so no row the seed states is left unexamined.
  if (commitments.length !== total) throw new Error(`The commitments read returned ${String(commitments.length)} rows of ${String(total)}, so a page window would hide rows this case is meant to inspect.`);
  return commitments;
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
  it("offers no retry affordance and no debt shape on a not-received occurrence", () => {
    const bucketState = buckets.bucketFor({ observed: "not-received" });
    expect(bucketState).toBe("not-received");
    // The classification is a string primitive, so it holds no field at all; the scan below covers
    // the two places an affordance could still appear here — the row a badge renders and the module —
    // and the case at the end of this file covers the row the read path builds.
    expect(typeof bucketState).toBe("string");
    const row = commitmentRow({ kind: "fixed-total", cadence: "annual", bucketState, fixedTotal: { promised: usd(120_000), fulfilled: usd(40_000), released: usd(0), remaining: usd(80_000) } });
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
describe("the row the read path builds", () => {
  /** The words that would state a measure taken from gifts — a donation, or an average of receipts — which no commitment row may carry. */
  const GIFT_MEASURE = /gift|donation|averag/i;
  it("states a bucket the module names, and no retry affordance, debt shape, gift measure or monthly equivalent", async () => {
    const rows = await seededCommitmentRows();
    // The seeded commitments cover every value, so the scans below reach a row in each state rather
    // than whichever rows the seed happens to list first.
    expect(new Set(rows.map((row) => row.bucket))).toEqual(new Set(buckets.RECURRING_BUCKETS));
    for (const row of rows) {
      // The bucket is the module's own value, labelled and partitioned by the module, so a field set
      // added inside the read path cannot state a seventh value or carry a badge of its own.
      expect(typeof row.bucket).toBe("string");
      expect(buckets.RECURRING_BUCKETS).toContain(row.bucket);
      expect(row.inPartition).toBe(buckets.isInPartition(row.bucket));
      expect(row.bucketLabel).toBe(buckets.BUCKET_LABELS[row.bucket]);
      // A retry affordance or a debt shape anywhere in the row, at any depth, would offer an action
      // this application never performs and would read a missing collection as the donor's debt.
      expect(keysDeep(row).filter((key) => AFFORDANCE_OR_DEBT.test(key))).toEqual([]);
      expect(keysDeep(row).filter((key) => GIFT_MEASURE.test(key))).toEqual([]);
      // No seeded commitment states a source monthly equivalent, so a figure here would be one the read
      // averaged rather than the qualified calculation the model permits. The field itself legitimately
      // stays, carrying null.
      expect(row.monthlyEquivalent).toBeNull();
    }
  });
});
