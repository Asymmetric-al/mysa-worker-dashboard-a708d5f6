/**
 * The published-workload measurement (AAP 0.12.3) — the one run both published numbers come from.
 *
 * What this file measures, and how. The plan fixes the method rather than the number: a filtered Gifts
 * page load is measured 30 times against the generated workload and the 95th percentile of "the server
 * read plus first meaningful render" is reported, and the same run times the export of the whole
 * generated query and records both its elapsed time and the row count it exported. So there is one run
 * of exactly 30 loads and one export — no attempt loop, no retry and no best-of-N selection, because a
 * number chosen from several runs is not the number the method measured. On a shared host that means
 * the run can miss the 500 ms budget, and a miss is published as the result rather than hidden.
 *
 * Why the page rather than the service read. A service read with `JSON.stringify` beside it times the
 * server half of a transport and nothing a worker waits for; the plan names the page load. Each sample
 * is therefore a real navigation of `/support/gifts` as the established worker, and the sample ends at
 * the first moment the ledger's whole-result summary exists in the document. That moment is recorded
 * inside the page, in the page's own clock, by an init script installed before the navigation, so it is
 * measured from the navigation's time origin: the server read, the response, the parse and the render
 * together. The same navigation entry states how much of the sample was the server read's own share
 * (`responseStart - requestStart`), logged beside every sample so the split is visible rather than
 * inferred, and nothing is added to the application to produce it.
 *
 * How it is invoked, and why it is skipped otherwise. Thirty loads over a 67 MB workload document take
 * minutes, and the two figures are an observation of this host rather than a gate over every change, so
 * the cases run only through the documented measurement command — `bun run measure:workload`, which
 * sets `WORKLOAD_MEASUREMENT=1` — and each one states that reason where the runner lists it as skipped,
 * so a skip is never mistaken for a pass.
 *
 * The dataset. The runner's automatic `seedReset` fixture restores the deterministic seed before each
 * test and discards the workload document with it, so each test regenerates the published dataset
 * through the script the plan maps for it (`scripts/generate-workload.ts`) and refuses to measure on
 * anything that does not report the published 10,000 partners and 100,000 gift rows.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cpus, loadavg, release, totalmem } from "node:os";
import { dirname, join } from "node:path";

import type { Download, Page } from "@playwright/test";
import { parse } from "csv-parse/sync";

import { expect, test, type PersonaName } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The run this file performs
// ---------------------------------------------------------------------------------------------

/** The seeded identity the workload is generated for and the page is read as, so the measurement and the dataset are the same scope. */
const PERSONA: PersonaName = "established-worker";

/**
 * The filtered Gifts page the plan's first number is measured over, as the surface's own URL.
 *
 * It is the ledger query AAP 0.12.3 names — one explicit period, one currency and the default page
 * window — written in the parameters the ledger reads, so the navigation asks the service for exactly
 * that query rather than for a page that later filters itself.
 */
const GIFTS_PAGE_HREF = `/support/gifts?${new URLSearchParams({ from: "2025-11-01", to: "2026-10-31", currency: "USD", page: "0", pageSize: "50" }).toString()}`;

/** The received-support report whose export writes the whole generated query: no currency filter and no page window. */
const RECEIVED_REPORT_HREF = `/support/reports/received?${new URLSearchParams({ from: "2022-11-20", to: "2026-11-21" }).toString()}`;

/** The export control of that report, in the surface's own words. */
const EXPORT_CONTROL_NAME = "Export the whole query as CSV";

/** Three page loads are discarded before the run, so the first sample is not the route's first load in this browser context. */
const WARM_UP_LOADS = 3;

/** The sample size the plan fixes: 30 loads, one p95, one verdict. */
const SAMPLES = 30;

/** The two published budgets, held as the boundaries the run is judged by rather than as targets a retry may move. */
const P95_BUDGET_MS = 500;
const EXPORT_BUDGET_MS = 30_000;

/** The whole-result gift count the filtered query must state on the page, which is what tells the generated workload from the seed alone. */
const MIN_WHOLE_RESULT_GIFTS = 50;

/**
 * The exported row count the run must produce.
 *
 * The workload's grain is one authorised allocation, so a 100,000-gift document exports slightly fewer
 * rows than it holds (a split gift contributes only the allocation this ministry may see). The figure
 * recorded when this run was written stood at 99,911, and the assertion is the magnitude the workload
 * guarantees rather than that past value.
 */
const MIN_EXPORTED_ROWS = 90_000;

/**
 * The slot the ledger renders once it has the whole-result figures of the query it read — the first
 * meaningful content of the page (`gifts-ledger.tsx`, `WholeResultSummary`).
 *
 * It is the application's own marker, already rendered for every ledger read, so the measurement reads
 * a slot the surface has rather than one added for a test.
 */
const MEANINGFUL_CONTENT_SLOT = '[data-slot="whole-result-summary"]';

/** The property the init script writes its mark into, in the page's clock and in the page's window. */
const MEANINGFUL_CONTENT_MARK = "__workloadFirstMeaningfulRenderMs";

/** The gift count the ledger's whole-result summary states per currency, in the ledger's own wording. */
const GIFT_COUNT_IN_SUMMARY = /\band\s+([\d,]+)\s+gifts?\b/gu;

/** The report's own statement of how many rows its export will hold (`export-print-actions.tsx`, `ROWS_LABEL`). */
const ROWS_STATED_IN_ACTIONS = /Rows in the file\s*([\d,]+)/u;

/** The region of the report that carries that statement. */
const EXPORT_ACTIONS_SLOT = '[data-slot="export-print-actions"]';

/** The one document key the CSV writer puts on every metadata record (`export/csv.ts`). */
const CSV_META = "#meta";

/** The metadata field that states how many rows the file holds, which must equal the rows the file carries. */
const CSV_ROW_TOTAL_FIELD = "row_total";

/** The workload the plan maps for the measurement, and the script the dataset is regenerated through. */
const WORKLOAD_SCRIPT = "scripts/generate-workload.ts";
const WORKLOAD_TIMEOUT_MS = 120_000;

/** The two manifests only the repository root holds, which is what makes the root findable from the application package. */
const REPOSITORY_ROOT_MARKERS: readonly string[] = ["turbo.json", "bun.lock"];

/** A page load is bounded well above the budget it is judged by, so a slow host is reported as a slow sample rather than as a navigation timeout. */
const NAVIGATION_TIMEOUT_MS = 120_000;

/** How long the page may take to render the whole-result summary after its document has loaded. */
const MARK_TIMEOUT_MS = 60_000;

/** How long the export's download may take to arrive, so an export that misses the budget still reports its own elapsed time instead of this timeout. */
const DOWNLOAD_TIMEOUT_MS = 300_000;

/** Thirty loads over the 67 MB document and one whole-query export, on a host shared with the rest of the build. */
const TEST_TIMEOUT_MS = 900_000;

/** The words the runner lists the skip with, so a run of the ordinary gate says why nothing was timed. */
const SKIP_REASON = "The published-workload measurement runs only through `bun run measure:workload` (WORKLOAD_MEASUREMENT=1); the ordinary `bun run test` gate does not time anything.";

/** How much of a child process's report an error quotes, so a failure is readable without pasting a whole run. */
const DETAIL_LIMIT = 400;

// ---------------------------------------------------------------------------------------------
// The shapes this file logs
// ---------------------------------------------------------------------------------------------

/** What one page load measured: the sample, the server read's own share of it, and the two document milestones either side of the render. */
interface LoadSample {
  readonly sampleMs: number;
  readonly serverReadMs: number;
  readonly domContentLoadedEnd: number;
  readonly loadEnd: number;
}

/** The machine the run was taken on, which the plan requires beside the workload and the sample size. */
interface MachineRecord {
  readonly cpu: string;
  readonly cores: number;
  readonly memoryBytes: number;
  readonly osRelease: string;
  readonly loadAverage: readonly number[];
  readonly runtime: string;
}

/** What one exported CSV file states: the row total its metadata carries, and the data records it actually holds. */
interface CsvCounts {
  readonly rowTotal: number;
  readonly dataRecords: number;
  readonly records: number;
}

// ---------------------------------------------------------------------------------------------
// Reading the run's own numbers
// ---------------------------------------------------------------------------------------------

/** One measured millisecond count, to a tenth, so two logged runs are compared at the precision the plan reports. */
function millis(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The nearest-rank percentile the plan fixes: the ascending samples read at `ceil(fraction × n) − 1`. */
function percentileOf(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const value = sorted[Math.ceil(fraction * sorted.length) - 1];
  if (value === undefined) {
    throw new Error(`No sample holds the ${String(fraction)} rank of ${String(sorted.length)} samples, so no percentile exists to report.`);
  }
  return value;
}

/** The median of the samples: the middle value of an odd count, and the mean of the middle pair of an even one. */
function medianOf(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined || lower === undefined) {
    throw new Error(`No middle pair exists in ${String(sorted.length)} samples, so no median exists to report.`);
  }
  return sorted.length % 2 === 1 ? upper : (lower + upper) / 2;
}

/** The machine the measurement ran on, in the shape the run's own log states it. */
function machineRecord(): MachineRecord {
  const processors = cpus();
  const [firstProcessor] = processors;
  return { cpu: firstProcessor?.model ?? "unknown", cores: processors.length, memoryBytes: totalmem(), osRelease: release(), loadAverage: loadavg(), runtime: (process.versions as { bun?: string }).bun ?? process.version };
}

// ---------------------------------------------------------------------------------------------
// The dataset the plan publishes
// ---------------------------------------------------------------------------------------------

/** The checkout this file belongs to: the nearest ancestor of the working directory that holds both workspace manifests. */
function repositoryRoot(): string {
  let current = process.cwd();
  for (;;) {
    if (REPOSITORY_ROOT_MARKERS.every((marker) => existsSync(join(current, marker)))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`No directory up to the filesystem root from ${JSON.stringify(process.cwd())} holds both ${REPOSITORY_ROOT_MARKERS.join(" and ")}, so this file cannot find the checkout whose workload script it has to run. Run the specs from inside the checkout.`);
    }
    current = parent;
  }
}

/**
 * Regenerates the published validation workload into the established worker's session.
 *
 * The runner's reset discards every session document, the workload among them, so a measurement that
 * needs the 10,000-partner / 100,000-gift dataset regenerates it through the script the plan maps for
 * it rather than reaching into the store. The generation is guarded rather than assumed: the script
 * must exist, and it must report the published counts, because a timing taken over a short dataset
 * would be an observation of a document the plan does not name.
 */
function ensureWorkload(): void {
  const root = repositoryRoot();
  const script = join(root, WORKLOAD_SCRIPT);
  if (!existsSync(script)) {
    throw new Error(`The workload this measurement is taken over is produced by ${WORKLOAD_SCRIPT}, and no such file stands in ${JSON.stringify(root)}. The published dataset is generated rather than committed, so the script is part of the checkout.`);
  }
  let stdout: string;
  try {
    stdout = execFileSync("bun", ["run", "seed:workload"], { cwd: root, encoding: "utf8", stdio: "pipe", timeout: WORKLOAD_TIMEOUT_MS });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`\`bun run seed:workload\` could not generate the published dataset, so nothing is measured over it: ${detail}`);
  }
  const report = stdout.replace(/\s+/gu, " ");
  if (!/partners\s*:\s*10000\b/u.test(stdout)) {
    throw new Error(`\`bun run seed:workload\` did not report the published 10,000 partners, so the document behind these timings is not the one the plan names. It reported: ${report.slice(0, DETAIL_LIMIT)}`);
  }
  if (!/gifts\s*:\s*100000\b/u.test(stdout)) {
    throw new Error(`\`bun run seed:workload\` did not report the published 100,000 gift rows, so the document behind these timings is not the one the plan names. It reported: ${report.slice(0, DETAIL_LIMIT)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Measuring one page load
// ---------------------------------------------------------------------------------------------

/**
 * Installs the first-meaningful-render mark into every document this page loads.
 *
 * The mark is written by the page itself, so it shares the navigation's time origin and the sample
 * carries the server read, the response, the parse and the render rather than only the part the runner
 * could see from outside. Both detection paths are needed: the ledger's summary may already be in the
 * document when the parser reaches it (a server-rendered read, which is the usual case), or it may be
 * added later by a mutation (a client render), so the summary is checked once on `DOMContentLoaded`
 * and observed from before the document has a body until the mark is written once.
 */
async function installFirstRenderMark(page: Page): Promise<void> {
  await page.addInitScript(
    (state: { readonly mark: string; readonly slot: string }): void => {
      const clock = window as unknown as Record<string, number | undefined>;
      let observer: MutationObserver | undefined;
      const recordMark = (): void => {
        if (clock[state.mark] !== undefined || document.querySelector(state.slot) === null) {
          return;
        }
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

/**
 * The sample one loaded page produced: the mark the page wrote, and the document's own navigation
 * timing beside it.
 *
 * `serverReadMs` is the document request's own share (`responseStart - requestStart`), the part of the
 * sample the server spent reading and rendering; the remainder is transport, parse and render on this
 * machine. Both are read from the same navigation entry, so the split always adds up to the sample's
 * own clock rather than to a second measurement of the same load.
 */
async function loadSampleOf(page: Page): Promise<LoadSample> {
  await page.waitForFunction((mark: string) => typeof (window as unknown as Record<string, number | undefined>)[mark] === "number", MEANINGFUL_CONTENT_MARK, { timeout: MARK_TIMEOUT_MS });
  return page.evaluate((mark: string) => {
    const sampleMs = (window as unknown as Record<string, number | undefined>)[mark];
    const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (sampleMs === undefined || navigation === undefined) {
      throw new Error(`The page holds no ${JSON.stringify(mark)} mark beside a navigation entry, so this load produced no sample.`);
    }
    return { sampleMs, serverReadMs: navigation.responseStart - navigation.requestStart, domContentLoadedEnd: navigation.domContentLoadedEventEnd, loadEnd: navigation.loadEventEnd };
  }, MEANINGFUL_CONTENT_MARK);
}

/**
 * The whole-result gift count the loaded ledger states for its query.
 *
 * This is the proof that the query was read over the generated workload rather than over the seed
 * alone: the seed holds a handful of gifts in this period, and the workload holds thousands. The figures
 * are read from the summary the page rendered — the same slot the sample's mark waits for — so a count
 * is read from the application's own statement of it.
 */
async function wholeResultGiftCount(page: Page): Promise<number> {
  const summary = page.locator(MEANINGFUL_CONTENT_SLOT);
  await expect(summary, "The ledger states the whole-result figures of the query it read.").toBeVisible();
  const stated = await summary.locator("li").allInnerTexts();
  let total = 0;
  for (const line of stated) {
    for (const match of line.matchAll(GIFT_COUNT_IN_SUMMARY)) {
      total += Number((match[1] ?? "0").replaceAll(",", ""));
    }
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// Reading the exported file
// ---------------------------------------------------------------------------------------------

/**
 * The whole-result row count the report states for the query its export writes.
 *
 * The export action states how many rows the file will hold, and that figure is the report read's
 * whole-result count rather than the count of the page on screen. Reading it before the download is
 * what lets the file's own row total be compared with the result the same query produces through the
 * report read — two reads of one query, which is the agreement the exported file has to keep.
 */
async function rowsStatedByReport(page: Page): Promise<number> {
  const actions = page.locator(EXPORT_ACTIONS_SLOT);
  await expect(actions, "The report states how many rows its whole-query export will hold.").toBeVisible();
  const stated = (await actions.innerText()).replace(/\s+/gu, " ");
  const digits = (ROWS_STATED_IN_ACTIONS.exec(stated)?.[1] ?? "").replaceAll(",", "");
  const value = Number(digits);
  if (digits === "" || !Number.isSafeInteger(value)) throw new Error(`The report states no readable whole-result row count beside its export control, so the file has no count to agree with: ${JSON.stringify(stated.slice(0, 200))}`);
  return value;
}

/** The text of one downloaded file, decoded as the UTF-8 the writer states in its own content type. */
async function csvTextOf(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(new Uint8Array(chunk as Uint8Array));
  }
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * What one exported file holds, counted through the one parser the application fixes.
 *
 * The file states its snapshot as `#meta` records, then one column header record and one record per
 * authorised row. The parser is configured with `bom: true` because an unstripped byte-order mark would
 * corrupt the first header name, and with `relax_column_count: true` because the file legitimately
 * mixes three-field metadata records with wider data records, so the record kinds are counted and the
 * data records are what the row total is compared against.
 */
function csvCountsOf(text: string, subject: string): CsvCounts {
  const records: string[][] = parse(text, { bom: true, relax_column_count: true });
  let header: readonly string[] | undefined;
  let statedRowTotal: string | undefined;
  let dataRecords = 0;
  for (const record of records) {
    const [first, second, third] = record;
    if (first === undefined || first.trim() === "") {
      continue;
    }
    if (first === CSV_META) {
      if (second === CSV_ROW_TOTAL_FIELD) {
        if (third === undefined) {
          throw new Error(`${subject} states a ${CSV_ROW_TOTAL_FIELD} record without a value: ${JSON.stringify(record)}`);
        }
        statedRowTotal = third.trim();
      }
      continue;
    }
    if (header === undefined) {
      header = record;
      continue;
    }
    dataRecords += 1;
  }
  if (header === undefined) {
    throw new Error(`${subject} holds no column header record, so its rows cannot be told from its statement.`);
  }
  if (statedRowTotal === undefined) {
    throw new Error(`${subject} states no ${JSON.stringify(CSV_ROW_TOTAL_FIELD)} metadata record, so the rows it holds cannot be compared with the rows it claims.`);
  }
  const rowTotal = Number(statedRowTotal);
  if (!/^\d+$/u.test(statedRowTotal) || !Number.isSafeInteger(rowTotal)) {
    throw new Error(`${subject} states ${JSON.stringify(statedRowTotal)} as its ${CSV_ROW_TOTAL_FIELD}, which is not a count of rows.`);
  }
  return { rowTotal, dataRecords, records: records.length };
}

// ---------------------------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------------------------

/** This file measures the workload the established worker's session carries, and reads both surfaces as that persona. */
test.use({ persona: PERSONA });

test("measures thirty filtered Gifts page loads once and reports their 95th percentile", async ({ page }) => {
  test.skip(process.env.WORKLOAD_MEASUREMENT !== "1", SKIP_REASON);
  test.setTimeout(TEST_TIMEOUT_MS);
  ensureWorkload();
  const machine = machineRecord();
  console.log(JSON.stringify({ measurement: "machine", ...machine }));
  await installFirstRenderMark(page);
  for (let warmUp = 1; warmUp <= WARM_UP_LOADS; warmUp += 1) {
    await page.goto(GIFTS_PAGE_HREF, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    const warmUpLoad = await loadSampleOf(page);
    console.log(JSON.stringify({ measurement: "warm-up-page-load", index: warmUp, sampleMs: millis(warmUpLoad.sampleMs), serverReadMs: millis(warmUpLoad.serverReadMs) }));
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
  expect(wholeResultGifts, "The filtered query states a whole-result gift count the generated workload produces, not the seed's handful of rows.").toBeGreaterThan(MIN_WHOLE_RESULT_GIFTS);
  const p95Ms = percentileOf(samples, 0.95);
  // One run, one p95, and the verdict the run produced. A miss is a published miss, so nothing here is
  // averaged against a second attempt or selected from the best of several.
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
  const control = page.getByRole("button", { name: EXPORT_CONTROL_NAME });
  await expect(control, "The received-support report offers the whole-query export in this scope.").toBeEnabled();
  const statedRows = await rowsStatedByReport(page);
  const startedAt = performance.now();
  const waiting = page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS });
  await control.click();
  const download = await waiting;
  const text = await csvTextOf(download);
  const elapsedMs = performance.now() - startedAt;
  const counts = csvCountsOf(text, `The CSV ${download.suggestedFilename()}`);
  console.log(JSON.stringify({ measurement: "whole-query-csv-export", runs: 1, elapsedMs: millis(elapsedMs), rowCount: counts.rowTotal, dataRecords: counts.dataRecords, csvRecords: counts.records, budgetMs: EXPORT_BUDGET_MS, metBudget: elapsedMs < EXPORT_BUDGET_MS, ...machine }));
  expect(counts.rowTotal, "The file states as many rows as it carries, so the exported count is the file's own count.").toBe(counts.dataRecords);
  expect(counts.rowTotal, "The file's row total is the whole-result count the report stated for the same query, so the file is that query rather than the page on screen.").toBe(statedRows);
  expect(counts.dataRecords).toBeGreaterThan(MIN_EXPORTED_ROWS);
  expect(counts.rowTotal).toBeGreaterThan(MIN_EXPORTED_ROWS);
  expect(elapsedMs).toBeLessThan(EXPORT_BUDGET_MS);
});
