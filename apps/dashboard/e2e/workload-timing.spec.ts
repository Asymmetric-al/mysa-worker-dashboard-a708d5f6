/** The published-workload measurement (AAP 0.12.3): the one run both published numbers come from, and a miss is published as the result rather than retried or averaged away. */
import { cpus, loadavg, release, totalmem } from "node:os";
import type { Page } from "@playwright/test";
import { parse } from "csv-parse/sync";
import { CSV_META, csvTextOf, ensureWorkload, expect, test, type PersonaName } from "../playwright.config";
const PERSONA: PersonaName = "established-worker";
const GIFTS_PAGE_HREF = `/support/gifts?${new URLSearchParams({ from: "2025-11-01", to: "2026-10-31", currency: "USD", page: "0", pageSize: "50" }).toString()}`;
const RECEIVED_REPORT_HREF = `/support/reports/received?${new URLSearchParams({ from: "2022-11-20", to: "2026-11-21" }).toString()}`;
const SAMPLES = 30;
const P95_BUDGET_MS = 500;
const EXPORT_BUDGET_MS = 30_000;
/** The whole-result gift count the filtered query must state, which tells the generated workload from the seed alone, and the exported rows the run must produce. */
const MIN_EXPORTED_ROWS = 90_000;
const MEANINGFUL_CONTENT_SLOT = '[data-slot="whole-result-summary"]';
const MEANINGFUL_CONTENT_MARK = "__workloadFirstMeaningfulRenderMs";
/** Every wait is bounded well above the budget it is judged by, so a slow host reports a slow sample rather than a navigation or download timeout. */
const NAVIGATION_TIMEOUT_MS = 120_000;
const MARK_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;
const TEST_TIMEOUT_MS = 900_000;
/** The words the runner lists the skip with, so a run of the ordinary gate says why nothing was timed. */
const SKIP_REASON = "The published-workload measurement runs only through `bun run measure:workload` (WORKLOAD_MEASUREMENT=1); the ordinary `bun run test` gate does not time anything.";
const CSV_ROW_TOTAL_FIELD = "row_total";
type LoadSample = { readonly sampleMs: number; readonly serverReadMs: number; readonly domContentLoadedEnd: number; readonly loadEnd: number };
type MachineRecord = { readonly cpu: string; readonly cores: number; readonly memoryBytes: number; readonly osRelease: string; readonly loadAverage: readonly number[]; readonly runtime: string };
type CsvCounts = { readonly rowTotal: number; readonly dataRecords: number; readonly records: number };
const millis = (value: number): number => Math.round(value * 10) / 10;
/** The nearest-rank percentile the plan fixes: the ascending samples read at `ceil(fraction × n) − 1`. */
function percentileOf(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const value = sorted[Math.ceil(fraction * sorted.length) - 1];
  if (value === undefined) throw new Error(`No sample holds the ${String(fraction)} rank of ${String(sorted.length)} samples, so no percentile exists to report.`);
  return value;
}
/** The median of the samples: the middle value of an odd count, and the mean of the middle pair of an even one. */
function medianOf(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined || lower === undefined) throw new Error(`No middle pair exists in ${String(sorted.length)} samples, so no median exists to report.`);
  return sorted.length % 2 === 1 ? upper : (lower + upper) / 2;
}
/** The machine the measurement ran on, in the shape the run's own log states it. */
function machineRecord(): MachineRecord {
  const processors = cpus();
  return { cpu: processors[0]?.model ?? "unknown", cores: processors.length, memoryBytes: totalmem(), osRelease: release(), loadAverage: loadavg(), runtime: (process.versions as { bun?: string }).bun ?? process.version };
}
/** Installs the first-meaningful-render mark into every document this page loads, so the sample shares the navigation's time origin and carries the server read, the response, the parse and the render. */
async function installFirstRenderMark(page: Page): Promise<void> {
  await page.addInitScript(
    (state: { readonly mark: string; readonly slot: string }): void => {
      const clock = window as unknown as Record<string, number | undefined>;
      let observer: MutationObserver | undefined;
      const recordMark = (): void => {
        if (clock[state.mark] !== undefined || document.querySelector(state.slot) === null) return;
        clock[state.mark] = performance.now();
        observer?.disconnect();
      };
      observer = new MutationObserver(recordMark);
      observer.observe(document, { childList: true, subtree: true });
      document.addEventListener("DOMContentLoaded", recordMark, { once: true });
      recordMark();
    },
    { mark: MEANINGFUL_CONTENT_MARK, slot: MEANINGFUL_CONTENT_SLOT },
  );
}
/** The sample one loaded page produced: the mark the page wrote, and the document's own navigation timing beside it. */
async function loadSampleOf(page: Page): Promise<LoadSample> {
  await page.waitForFunction((mark: string) => typeof (window as unknown as Record<string, number | undefined>)[mark] === "number", MEANINGFUL_CONTENT_MARK, { timeout: MARK_TIMEOUT_MS });
  return page.evaluate((mark: string) => {
    const sampleMs = (window as unknown as Record<string, number | undefined>)[mark];
    const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (sampleMs === undefined || navigation === undefined) throw new Error(`The page holds no ${JSON.stringify(mark)} mark beside a navigation entry, so this load produced no sample.`);
    return { sampleMs, serverReadMs: navigation.responseStart - navigation.requestStart, domContentLoadedEnd: navigation.domContentLoadedEventEnd, loadEnd: navigation.loadEventEnd };
  }, MEANINGFUL_CONTENT_MARK);
}
/** The whole-result gift count the loaded ledger states for its query, read from the summary the sample's mark waits for. */
async function wholeResultGiftCount(page: Page): Promise<number> {
  const summary = page.locator(MEANINGFUL_CONTENT_SLOT);
  await expect(summary, "The ledger states the whole-result figures of the query it read.").toBeVisible();
  let total = 0;
  for (const line of await summary.locator("li").allInnerTexts()) for (const match of line.matchAll(/\band\s+([\d,]+)\s+gifts?\b/gu)) total += Number((match[1] ?? "0").replaceAll(",", ""));
  return total;
}
/** The whole-result row count the report states for the query its export writes, which is the count the file's own total is compared with. */
async function rowsStatedByReport(page: Page): Promise<number> {
  const actions = page.locator('[data-slot="export-print-actions"]');
  await expect(actions, "The report states how many rows its whole-query export will hold.").toBeVisible();
  const stated = (await actions.innerText()).replace(/\s+/gu, " ");
  const digits = (/Rows in the file\s*([\d,]+)/u.exec(stated)?.[1] ?? "").replaceAll(",", "");
  const value = Number(digits);
  if (digits === "" || !Number.isSafeInteger(value)) throw new Error(`The report states no readable whole-result row count beside its export control, so the file has no count to agree with: ${JSON.stringify(stated.slice(0, 200))}`);
  return value;
}
/** What one exported file holds, counted through the one parser the application fixes: `#meta` records, one column header record and one record per authorised row. */
function csvCountsOf(text: string, subject: string): CsvCounts {
  const records: string[][] = parse(text, { bom: true, relax_column_count: true }); // `bom: true` because an unstripped byte-order mark would corrupt the first header name, and a relaxed column count because the file legitimately mixes three-field metadata with wider data records.
  const header = records.findIndex((record) => (record[0] ?? "").trim() !== "" && record[0] !== CSV_META);
  const stated = (records.find((record) => record[0] === CSV_META && record[1] === "row_total")?.[2] ?? "").trim();
  if (header < 0) throw new Error(`${subject} holds no column header record, so its rows cannot be told from its statement.`);
  if (stated === "") throw new Error(`${subject} states no ${JSON.stringify(CSV_ROW_TOTAL_FIELD)} metadata record, so the rows it holds cannot be compared with the rows it claims.`);
  const rowTotal = Number(stated);
  if (!/^\d+$/u.test(stated) || !Number.isSafeInteger(rowTotal)) throw new Error(`${subject} states ${JSON.stringify(stated)} as its ${CSV_ROW_TOTAL_FIELD}, which is not a count of rows.`);
  return { rowTotal, dataRecords: records.length - header - 1, records: records.length };
}
/** This file measures the workload the established worker's session carries, and reads both surfaces as that persona. */
test.use({ persona: PERSONA });
test("measures thirty filtered Gifts page loads once and reports their 95th percentile", async ({ page }) => {
  test.skip(process.env.WORKLOAD_MEASUREMENT !== "1", SKIP_REASON);
  test.setTimeout(TEST_TIMEOUT_MS);
  ensureWorkload();
  const machine = machineRecord();
  console.log(JSON.stringify({ measurement: "machine", ...machine }));
  await installFirstRenderMark(page);
  for (let warmUp = 1; warmUp <= 3; warmUp += 1) {
    await page.goto(GIFTS_PAGE_HREF, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    const load = await loadSampleOf(page);
    console.log(JSON.stringify({ measurement: "warm-up-page-load", index: warmUp, sampleMs: millis(load.sampleMs), serverReadMs: millis(load.serverReadMs) }));
  }
  const samples: number[] = [];
  const serverReads: number[] = [];
  let wholeResultGifts = 0;
  for (let index = 1; index <= SAMPLES; index += 1) {
    await page.goto(GIFTS_PAGE_HREF, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    const load = await loadSampleOf(page);
    samples.push(load.sampleMs);
    serverReads.push(load.serverReadMs);
    wholeResultGifts = await wholeResultGiftCount(page);
    console.log(JSON.stringify({ measurement: "filtered-gifts-page-load", index, sampleMs: millis(load.sampleMs), serverReadMs: millis(load.serverReadMs), domContentLoadedEnd: millis(load.domContentLoadedEnd), loadEnd: millis(load.loadEnd) }));
  }
  expect(samples).toHaveLength(SAMPLES);
  for (const sample of samples) {
    expect(Number.isFinite(sample)).toBe(true);
    expect(sample).toBeGreaterThan(0);
  }
  expect(wholeResultGifts, "The filtered query states a whole-result gift count the generated workload produces, not the seed's handful of rows.").toBeGreaterThan(50);
  const p95Ms = percentileOf(samples, 0.95);
  // One run, one p95 and the verdict the run produced: a miss is a published miss, so nothing is averaged against a second attempt or selected from several.
  console.log(
    JSON.stringify({
      measurement: "filtered-gifts-page-load-summary",
      runs: 1,
      samples: samples.length,
      minMs: millis(Math.min(...samples)),
      medianMs: millis(medianOf(samples)),
      p95Ms: millis(p95Ms),
      maxMs: millis(Math.max(...samples)),
      serverReadMinMs: millis(Math.min(...serverReads)),
      serverReadMedianMs: millis(medianOf(serverReads)),
      serverReadP95Ms: millis(percentileOf(serverReads, 0.95)),
      wholeResultGifts,
      budgetMs: P95_BUDGET_MS,
      metBudget: p95Ms < P95_BUDGET_MS,
      ...machine,
    }),
  );
  expect(p95Ms).toBeLessThan(P95_BUDGET_MS);
});
test("times the whole-query CSV export once and states the row count it exported", async ({ page }) => {
  test.skip(process.env.WORKLOAD_MEASUREMENT !== "1", SKIP_REASON);
  test.setTimeout(TEST_TIMEOUT_MS);
  ensureWorkload();
  const machine = machineRecord();
  console.log(JSON.stringify({ measurement: "machine", ...machine }));
  await page.goto(RECEIVED_REPORT_HREF, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
  const control = page.getByRole("button", { name: "Export the whole query as CSV" });
  await expect(control, "The received-support report offers the whole-query export in this scope.").toBeEnabled();
  const statedRows = await rowsStatedByReport(page);
  const startedAt = performance.now();
  const waiting = page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS });
  await control.click();
  const text = await csvTextOf(await waiting);
  const elapsedMs = performance.now() - startedAt;
  const counts = csvCountsOf(text, "The workload export");
  console.log(JSON.stringify({ measurement: "whole-query-csv-export", runs: 1, elapsedMs: millis(elapsedMs), rowCount: counts.rowTotal, dataRecords: counts.dataRecords, csvRecords: counts.records, budgetMs: EXPORT_BUDGET_MS, metBudget: elapsedMs < EXPORT_BUDGET_MS, ...machine }));
  expect(counts.rowTotal, "The file states as many rows as it carries, so the exported count is the file's own count.").toBe(counts.dataRecords);
  expect(counts.rowTotal, "The file's row total is the whole-result count the report stated for the same query, so the file is that query rather than the page on screen.").toBe(statedRows);
  expect(counts.dataRecords).toBeGreaterThan(MIN_EXPORTED_ROWS);
  expect(counts.rowTotal).toBeGreaterThan(MIN_EXPORTED_ROWS);
  expect(elapsedMs).toBeLessThan(EXPORT_BUDGET_MS);
});
