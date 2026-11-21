/**
 * Observed performance of the published workload, behind `WORKLOAD_MEASUREMENT=1`.
 */
import { cpus, loadavg, release, totalmem } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { reads } from "@/modules/data-service";
const MEASURED = process.env.WORKLOAD_MEASUREMENT === "1";

const WORKLOAD_SESSION = { sessionId: "established-worker" };

const GIFTS_QUERY = {
  period: { kind: "explicit", from: "2025-11-01", to: "2026-10-31" },
  currency: "USD",
  page: { index: 0, size: 50 },
  timeZone: "UTC",
} as const;
const EXPORT_QUERY = {
  period: { kind: "explicit", from: "2022-11-20", to: "2026-11-21" },
  timeZone: "UTC",
} as const;
const WARM_UP_CALLS = 3;

const SAMPLES = 30;

function percentileOf(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const value = sorted[Math.ceil(fraction * sorted.length) - 1];
  if (value === undefined) {
    throw new Error(`No sample holds the ${fraction} rank of ${sorted.length} samples.`);
  }
  return value;
}
function medianOf(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined || lower === undefined) {
    throw new Error(`No middle pair exists in ${sorted.length} samples.`);
  }
  return (lower + upper) / 2;
}
function millis(value: number): number {
  return Math.round(value * 10) / 10;
}
function machineRecord() {
  const [firstProcessor] = cpus();
  return {
    measurement: "machine",
    cpu: firstProcessor?.model ?? "unknown",
    cores: cpus().length,
    memoryBytes: totalmem(),
    osRelease: release(),
    loadAverage: loadavg(),
    runtime: (process.versions as { bun?: string }).bun ?? process.version,
  };
}
describe.skipIf(!MEASURED)("published workload performance", () => {
  beforeAll(() => {
    console.log(JSON.stringify(machineRecord()));
  });
  it("measures the filtered Gifts read thirty times and reports its 95th percentile", async () => {
    for (let call = 0; call < WARM_UP_CALLS; call += 1) {
      const warmUp = await reads.support.readGifts(GIFTS_QUERY, WORKLOAD_SESSION);
      expect(warmUp.kind).toBe("envelope");
    }
    const samples: number[] = [];
    let payloadBytes = 0;
    let wholeResultTotal = 0;
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const startedAt = performance.now();
      const result = await reads.support.readGifts(GIFTS_QUERY, WORKLOAD_SESSION);
      const serialised = JSON.stringify(result);
      samples.push(performance.now() - startedAt);
      expect(result.kind).toBe("envelope");
      if (result.kind === "envelope") {
        wholeResultTotal = result.envelope.data.report.total;
      }
      payloadBytes += serialised.length;
    }
    expect(samples).toHaveLength(SAMPLES);
    expect(wholeResultTotal).toBeGreaterThan(50);
    expect(payloadBytes).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(Number.isFinite(sample)).toBe(true);
      expect(sample).toBeGreaterThan(0);
    }
    console.log(
      JSON.stringify({
        measurement: "filtered-gifts",
        total: wholeResultTotal,
        samples: samples.length,
        minMs: millis(samples.reduce((left, right) => Math.min(left, right))),
        medianMs: millis(medianOf(samples)),
        p95Ms: millis(percentileOf(samples, 0.95)),
        maxMs: millis(samples.reduce((left, right) => Math.max(left, right))),
      }),
    );
  }, 300_000);
  it("times the whole-query CSV export once and states the row count it exported", async () => {
    const startedAt = performance.now();
    const result = await reads.export.readExport(EXPORT_QUERY, WORKLOAD_SESSION);
    const elapsedMs = performance.now() - startedAt;
    expect(result.kind).toBe("envelope");
    if (result.kind !== "envelope") {
      throw new Error(`The export answered "${result.kind}" instead of an envelope.`);
    }
    const { data } = result.envelope;
    expect(data.rowCount).toBe(data.print.rowTotal);
    expect(data.rowCount).toBeGreaterThan(90_000);
    expect(elapsedMs).toBeLessThan(30_000);
    console.log(
      JSON.stringify({
        measurement: "whole-query-csv-export",
        elapsedMs: millis(elapsedMs),
        rowCount: data.rowCount,
        csvRecords: data.csv.split("\r\n").length,
      }),
    );
  }, 300_000);
});
