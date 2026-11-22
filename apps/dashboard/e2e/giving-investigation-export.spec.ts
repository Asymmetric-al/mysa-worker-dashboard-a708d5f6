/**
 * Criterion 1 — whole-query agreement: one query, one snapshot, six artifacts (AAP 0.8.8, 0.12.2).
 *
 * What this file proves. A financial figure in this application is never computed by a surface: one
 * `ReportResult` is produced by one report read, and the screen's summary, the chart's data table, the
 * table's rows, a matrix cell's drill-down, the CSV file and the printed page all consume that same
 * result. So for one query the six artifacts must agree exactly — in row count and in integer minor
 * units per currency — and this file compares them rather than trusting the architecture's word for it.
 *
 * The scenario. The established worker (the seed's default session, holding years of received support
 * and two ministries), read from the deterministic seed, with the published validation workload
 * generated into its session by `scripts/generate-workload.ts` for the tests that need more rows than
 * one page holds (10,000 partners and 100,000 gift rows, AAP 0.12.4). The source's coverage is partial
 * (2022-11-20 to 2026-10-31 once the workload is merged with the seed's own 2023-01-01 to 2026-11-20),
 * so every subtotal the six artifacts state is an incomplete subtotal and must say so. The currencies
 * in play are USD (two decimals), EUR, KWD (three decimals) and JPY (zero decimals), plus rows whose
 * currency the source never identified. The seed's own rows put a split gift (one gift, two allocation
 * rows), a refund, an anonymous gift, an approximate date and a row whose currency is unidentified inside
 * the same period the agreement is read over, so the figures compared are the awkward ones.
 *
 * Why five tests rather than one. Each one isolates one agreement, so a failure names the artifact that
 * broke rather than a page that could not be read:
 *   1. the whole query beyond the loaded page — screen summary, the report's own figures, the CSV file
 *      and the printed page, on the generated workload where the query holds 9,619 rows and a page
 *      holds 50;
 *   2. invariance — the whole-query values do not move when the order or the page does, proven by two
 *      exports whose sums and gift identities agree while their first rows differ;
 *   3. the single-currency rule — an amount range is offered only inside one selected currency and is
 *      dropped when the selection stops naming exactly one, and the currencies are stated apart;
 *   4. the chart — the monthly series' accessible data table sums to the same figure the screen, the CSV
 *      and the printed page state, with the one month the source records nothing in left as a gap;
 *   5. one figure at three grains — a matrix cell, the rows its drill-down narrows to and the report it
 *      belongs to, with the CSV and the print of that same narrow query.
 *
 * Money is never read as a float and never compared as formatted text. Every displayed amount is turned
 * back into an exact count of minor units by string manipulation, using the exponent its own decimal
 * places state; the CSV is read through the one parser the application fixes, and its
 * `amount_minor_units` column states the integer directly. No exponent is assumed, and no amount is
 * compared across surfaces as a string.
 *
 * What this file deliberately does not assert, and why.
 *   - A withheld value. The support projection states no `withheld` state for this subject (its
 *     five-state vocabulary is exercised by a coach's boundary, not by a worker's own ledger), and the
 *     seed holds no such row. The value that is genuinely not a number here is the row whose currency
 *     the source never identified, and the month the source records nothing in; both are asserted as
 *     themselves rather than dressed as a withheld case this fixture cannot produce.
 *   - An export of an amount-range query. The four fixed reports' address vocabulary carries a period,
 *     a currency, a designation, a partner, a search and a sort, and no amount range; the export action
 *     of a report therefore cannot carry one. Asserting it would mean inventing a second path or
 *     changing another surface's route, so the range is asserted where it exists (the ledger) and the
 *     whole-query artifacts are compared on the period-and-currency queries the export does carry.
 *   - A performance gate. The p95 and export-duration measurements are reported separately (AAP
 *     0.12.3); nothing here times anything.
 *   - A retry, a skip or a timeout of its own. Every criterion is meant to pass on the first attempt
 *     from a freshly reset seed, and the runner enforces that for the whole suite.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Download, Locator, Page } from "@playwright/test";
import { parse } from "csv-parse/sync";

import { expect, resetSeed, test, type PersonaName } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The seeded scenario this file acts in
// ---------------------------------------------------------------------------------------------

/**
 * The seeded identity every read, download and printed page below is authorised as.
 *
 * The established worker holds received support in four currencies, a partial coverage statement, a
 * split gift, a refund, an anonymous gift, a zero-decimal and a three-decimal currency and one row
 * whose currency the source never identified — so the agreement this file proves is proved over the
 * awkward rows rather than only over the tidy ones. The runner admits the browser context as this
 * persona, so every surface is read in the scope the figures belong to.
 */
const PERSONA: PersonaName = "established-worker";

/** The destinations this file reads, and the one print layout it opens. */
const GIFTS_HREF = "/support/gifts";
const RECEIVED_REPORT_HREF = "/support/reports/received";
const HISTORY_REPORT_HREF = "/support/reports/history";
const MATRIX_REPORT_HREF = "/support/reports/matrix";

/** The one currency the decisive queries are filtered to: the seed's largest, and a two-decimal currency. */
const CURRENCY = "USD";

/**
 * The year whose monthly history this file reads, and the one month inside it in which the workload
 * records nothing at all (`ABSENT_MONTH` in `dev-runtime/generate.ts`), so a gap in a series is a real
 * absent month rather than a month this file could not read.
 */
const HISTORY_YEAR = 2024;
const ABSENT_MONTH = "2024-02";

/** The page sizes the list preset offers (AAP 0.8.7): 50 rows, or the 200 cap when the reader asks for it. */
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_CAP = 200;

/** The matrix cell this file drills: one partner's received support in one month of the seeded year. */
const DRILLDOWN_PARTNER = "partner-church-st-aidan";
const DRILLDOWN_MONTH_FROM = "2026-07-01";
const DRILLDOWN_MONTH_TO = "2026-07-31";

/** The words the surfaces state the snapshot and the coverage in, so a comparison reads the application's own text. */
const DEVELOPMENT_DATA_LABEL = "Development data";
const PARTIAL_COVERAGE_OPENING = "Coverage is partial";
const WHOLE_RESULT_HEADING = "Whole-result support, by currency";
const INCOMPLETE_MARKER = /\(incomplete\)/u;

/** The whole-result figure the ledger states with its gift count, in the ledger's own wording. */
const GIFT_COUNT_IN_FIGURE = /\band\s+([\d,]+)\s+gifts?\b/u;

/** The paged list's own count line: `Showing 1–50 of 9,619 gifts`. The dash is an en dash. */
const SHOWING_LINE = /^Showing\s+[\d,]+\s*\u2013\s*[\d,]+\s+of\s+([\d,]+)\s+(\S+)$/u;

/** The two whole-result counts the export surface states, in the family's own words. */
const ROWS_IN_FILE = /Rows in the file\s+([\d,]+)/u;
const ROWS_IN_RESULT = /Rows in this result:\s+([\d,]+)/u;

/** The facts the snapshot statement states, by the label each is stated under. */
const SNAPSHOT_FACT_LABELS = ["Basis", "Grain", "Period", "Currencies", "Coverage", "As of"] as const;

type SnapshotFactLabel = (typeof SNAPSHOT_FACT_LABELS)[number];

/** The one document key the CSV writer puts on every metadata record (`export/csv.ts`). */
const CSV_META = "#meta";

/** The metadata field names this file reads, each stated once so a renamed field fails one assertion rather than five. */
const CSV_FIELD = {
  grain: "grain",
  basis: "basis",
  currency: "currency",
  periodFrom: "period_from",
  periodTo: "period_to",
  periodState: "period_state",
  coverageState: "coverage_state",
  snapshotAsOf: "snapshot_as_of",
  snapshotQuery: "snapshot_query",
  rowTotal: "row_total",
  amountUnit: "amount_unit",
  page: "page",
} as const;

/**
 * The characters a spreadsheet may treat as the start of a formula, plus the neutraliser the writer
 * prefixes. A cell is inert when its first character is none of them, or when the first character is
 * the writer's own tab.
 */
const DANGEROUS_LEADING_CHARS: readonly string[] = ["=", "+", "-", "@", "\t", "\r", "\n", "\uFF1D", "\uFF0B", "\uFF0D", "\uFF20"];
const NEUTRALISER = "\t";

/** The workload the whole-query agreement is measured on, and the script that produces it (AAP 0.12.4). */
const WORKLOAD_SCRIPT = "scripts/generate-workload.ts";
const WORKLOAD_TIMEOUT_MS = 120_000;

/** How much of a child process's report or a CSV row an error quotes, so a failure is readable without pasting a whole run. */
const DETAIL_LIMIT = 400;

/** The two manifests that only the repository root holds, which is what makes the root findable from the application package. */
const REPOSITORY_ROOT_MARKERS: readonly string[] = ["turbo.json", "bun.lock"];

// ---------------------------------------------------------------------------------------------
// The shapes this file reads
// ---------------------------------------------------------------------------------------------

/** One exact amount as a surface states it: the currency the source named, and its integer minor units. */
interface StatedAmount {
  readonly currency: string;
  readonly minorUnits: number;
}

/** One parsed CSV file: its metadata records, its one column header record and its authorised rows. */
interface CsvFile {
  readonly metadata: ReadonlyMap<string, string>;
  readonly header: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/** What the snapshot statement states, keyed by the label it states it under. */
type SnapshotFacts = Readonly<Record<SnapshotFactLabel, string>>;

// ---------------------------------------------------------------------------------------------
// Reading an amount, a count or a state exactly
// ---------------------------------------------------------------------------------------------

/**
 * An amount as a surface displays it: an optional sign, thousands groups, an optional fraction whose
 * length is the currency's own exponent, and the currency code the source named.
 *
 * The exponent is read off the display rather than assumed, which is what keeps a three-decimal
 * currency (1.250 KWD is 1,250 minor units) and a zero-decimal one (5,000 JPY is 5,000 minor units)
 * exact without a table of codes in this file.
 */
const AMOUNT_IN_TEXT = /(-?\d[\d,]*)(?:[.,](\d+))?\s+([A-Z]{2,})\b/u;

/** The words a surface uses where a value is not a number. They are states, and never read as a zero. */
const AMOUNT_STATE_WORDS: readonly string[] = ["Unknown amount", "Withheld", "Source unavailable", "No recorded value"];

/**
 * The exact minor units a displayed amount states.
 *
 * A state word is refused rather than read: "Unknown amount", "Withheld", "Source unavailable" and
 * "No recorded value" are four different facts, and none of them is zero — so a surface that states one
 * of them has not stated an amount this file may total, and it says so where it fails.
 */
function statedAmountOf(text: string, subject: string): StatedAmount {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  const state = AMOUNT_STATE_WORDS.find((word) => collapsed.includes(word));
  if (state !== undefined) {
    throw new Error(`${subject} states ${JSON.stringify(state)} rather than an amount (${JSON.stringify(collapsed.slice(0, 200))}). That is a state, not a zero, so this file does not total it.`);
  }
  const match = AMOUNT_IN_TEXT.exec(collapsed);
  if (match === null) {
    throw new Error(`${subject} states ${JSON.stringify(collapsed.slice(0, 200))}, which is not an amount with a currency this file can read. No exponent is assumed in its place.`);
  }
  const [, whole = "", fraction = "", currency = ""] = match;
  const digits = `${whole.replace(/,/gu, "")}${fraction}`;
  const negative = digits.startsWith("-");
  const units = Number(negative ? digits.slice(1) : digits);
  if (!/^-?\d+$/u.test(digits) || !Number.isSafeInteger(units)) {
    throw new Error(`${subject} states ${JSON.stringify(collapsed.slice(0, 200))}, whose digits are not an exact count of minor units. An amount that cannot be read exactly is not compared approximately.`);
  }
  return { currency, minorUnits: negative ? -units : units };
}

/** A whole count a surface states, with the grouping its locale formats it in removed and nothing else changed. */
function countOf(text: string, subject: string): number {
  const digits = text.replace(/,/gu, "").trim();
  const value = Number(digits);
  if (!/^\d+$/u.test(digits) || !Number.isSafeInteger(value)) {
    throw new Error(`${subject} states ${JSON.stringify(text)}, which is not a whole count this file can compare.`);
  }
  return value;
}

/** The exact sum of some minor-unit counts, refused rather than silently rounded past the range of an exact integer. */
function sumOf(amounts: readonly number[], subject: string): number {
  let total = 0;
  for (const amount of amounts) {
    total += amount;
    if (!Number.isSafeInteger(total)) {
      throw new Error(`${subject} sums past the range of an exact integer, so no total is stated for it.`);
    }
  }
  return total;
}

/** States one comparison of two exact amounts so that a failure quotes both surfaces rather than two numbers. */
function expectSameAmount(actual: StatedAmount, expected: StatedAmount, comparison: string): void {
  expect({ currency: actual.currency, minorUnits: actual.minorUnits }, comparison).toEqual({ currency: expected.currency, minorUnits: expected.minorUnits });
}

/** Whether a CSV cell is inert: it does not begin with a character a spreadsheet would open as a formula, or it carries the writer's neutralising tab. */
function isInert(cell: string): boolean {
  const [first] = cell;
  if (first === undefined) {
    return true;
  }
  return first === NEUTRALISER || !DANGEROUS_LEADING_CHARS.includes(first);
}

/** A CSV cell with the writer's neutralising tab removed, so a number it holds is read as the writer stated it. */
function withoutNeutraliser(cell: string): string {
  return cell.startsWith(NEUTRALISER) ? cell.slice(NEUTRALISER.length) : cell;
}

// ---------------------------------------------------------------------------------------------
// The dataset the published criterion is measured on
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
 * The deterministic reset this file's `beforeEach` performs discards every session document, and the
 * workload is one of them, so a test that needs more rows than one page holds regenerates the dataset
 * through the script AAP 0.12.4 maps for it rather than reaching into the store. The generation is
 * guarded rather than assumed: the script must exist, and it must report the published 10,000 partners
 * and 100,000 gift rows, because agreement measured over a short dataset would prove nothing about the
 * query the criterion names.
 */
function ensureWorkload(): void {
  const root = repositoryRoot();
  const script = join(root, WORKLOAD_SCRIPT);
  if (!existsSync(script)) {
    throw new Error(`The workload this test measures is produced by ${WORKLOAD_SCRIPT}, and no such file stands in ${JSON.stringify(root)}. The published dataset is generated rather than committed, so the script is part of the checkout.`);
  }
  let stdout: string;
  try {
    stdout = execFileSync("bun", ["run", "seed:workload"], { cwd: root, encoding: "utf8", stdio: "pipe", timeout: WORKLOAD_TIMEOUT_MS });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`\`bun run seed:workload\` could not generate the published dataset, so no agreement is measured over it: ${detail}`);
  }
  const report = stdout.replace(/\s+/gu, " ");
  if (!/partners\s*:\s*10000\b/u.test(stdout)) {
    throw new Error(`\`bun run seed:workload\` did not report the published 10,000 partners, so the dataset behind this file's figures is not the one the criterion names. It reported: ${report.slice(0, DETAIL_LIMIT)}`);
  }
  if (!/gifts\s*:\s*100000\b/u.test(stdout)) {
    throw new Error(`\`bun run seed:workload\` did not report the published 100,000 gift rows, so the dataset behind this file's figures is not the one the criterion names. It reported: ${report.slice(0, DETAIL_LIMIT)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Reading the application's own surfaces
// ---------------------------------------------------------------------------------------------

/** One line of the ledger's whole-result summary: a stated amount with its gift count, or a state that is not a number. */
type WholeResultLine = { readonly kind: "amount"; readonly currency: string; readonly amount: StatedAmount; readonly giftCount: number; readonly statement: string } | { readonly kind: "state"; readonly currency: string; readonly word: string; readonly statement: string };

/**
 * The whole-result figures the surface states, one per currency.
 *
 * This is the screen artifact: the figures the filters match rather than the rows on the page, read from
 * the surface a worker reads them from. Each currency is stated on its own line, and a line that states
 * a state instead of an amount (the row whose currency the source never identified) is kept as a state.
 */
async function readWholeResult(page: Page): Promise<readonly WholeResultLine[]> {
  const heading = page.getByRole("heading", { name: WHOLE_RESULT_HEADING });
  await expect(heading, "The ledger states its whole-result support for the query it read.").toBeVisible();
  const lines = page.locator('[data-slot="whole-result-summary"] li');
  const stated = await lines.count();
  expect(stated, "A received-support query states at least one currency, so there is a whole-result figure to compare.").toBeGreaterThan(0);
  const figures: WholeResultLine[] = [];
  for (let index = 0; index < stated; index += 1) {
    const line = lines.nth(index);
    const statement = (await line.innerText()).replace(/\s+/gu, " ").trim();
    const currency = (await line.locator("bdi").first().innerText()).replace(/\s+/gu, " ").trim();
    const state = AMOUNT_STATE_WORDS.find((word) => statement.includes(word));
    if (state !== undefined) {
      figures.push({ kind: "state", currency, word: state, statement });
      continue;
    }
    const gift = GIFT_COUNT_IN_FIGURE.exec(statement);
    if (gift === null) {
      throw new Error(`The whole-result line for ${currency} states ${JSON.stringify(statement.slice(0, 240))} without the gift count it states beside every amount. A figure whose grain cannot be read is not compared.`);
    }
    figures.push({ kind: "amount", currency, amount: statedAmountOf(statement, `The whole-result line for ${currency}`), giftCount: countOf(gift[1] ?? "", `The gift count beside the whole-result figure for ${currency}`), statement });
  }
  return figures;
}

/** The amount the whole-result summary states for one currency, refusing a currency whose line states a state instead. */
function wholeResultAmountOf(figures: readonly WholeResultLine[], currency: string): { readonly amount: StatedAmount; readonly giftCount: number; readonly statement: string } {
  const line = figures.find((entry) => entry.currency === currency);
  if (line === undefined) {
    throw new Error(`The whole-result summary states no figure for ${currency}; it states ${figures.map((entry) => entry.currency).join(", ") || "no currency"}.`);
  }
  if (line.kind !== "amount") {
    throw new Error(`The whole-result line for ${currency} states ${JSON.stringify(line.word)} rather than an amount. That is a state, not a zero.`);
  }
  return { amount: line.amount, giftCount: line.giftCount, statement: line.statement };
}

/**
 * The whole-result row count a paged list states: `Showing 1–50 of 9,619 gifts`.
 *
 * This is the count of the rows the filters match, read from the pager rather than from the loaded page,
 * and it is the count the CSV file's row total must equal.
 */
async function readListTotal(page: Page, noun: string): Promise<number> {
  const line = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim();
  const match = SHOWING_LINE.exec(line);
  if (match === null || match[2] !== noun) {
    throw new Error(`The ${noun} list states its whole result as "Showing 1\u2013N of M ${noun}", and it read ${JSON.stringify(line)} instead. A count this file cannot read would leave the whole query unchecked.`);
  }
  return countOf(match[1] ?? "", `The whole-result ${noun} count`);
}

/** The counted rows the rendered page holds, which is what the page-size assertions compare against. */
async function readRenderedRows(page: Page, tableLabel: string): Promise<number> {
  const rows = page.getByRole("table", { name: tableLabel }).locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  return rows.count();
}

/** One labelled fact a surface states, read from the definition list that states it. */
async function factOf(scope: Locator, label: string): Promise<string> {
  const term = scope.locator("dt").filter({ hasText: label }).first();
  const value = term.locator("xpath=following-sibling::dd[1]");
  await expect(value, `The surface states ${JSON.stringify(label)} as a labelled fact.`).toHaveCount(1);
  return (await value.innerText()).replace(/\s+/gu, " ").trim();
}

/**
 * The four facts every artifact is compared by, read from the snapshot statement the surface renders.
 *
 * The statement is the one place a screen states the grain, basis, currency partition, period, coverage
 * and as-of instant of the query it read, and the CSV metadata records and the printed page carry the
 * same six, which is what makes their agreement checkable rather than asserted.
 */
async function snapshotFactsOf(page: Page, variant: "screen" | "print"): Promise<SnapshotFacts> {
  const statement = page.locator(`[data-snapshot-statement="${variant}"]`).first();
  await expect(statement, `The ${variant} snapshot statement is on screen.`).toBeVisible();
  const labels = (await statement.locator("dt").allInnerTexts()).map((text) => text.replace(/\s+/gu, " ").trim());
  const values = (await statement.locator("dd").allInnerTexts()).map((text) => text.replace(/\s+/gu, " ").trim());
  if (labels.length !== values.length) {
    throw new Error(`The ${variant} snapshot statement states ${String(labels.length)} labels and ${String(values.length)} values, so no fact can be attributed to its label.`);
  }
  const stated: Record<string, string> = {};
  for (const [index, label] of labels.entries()) {
    stated[label] = values[index] ?? "";
  }
  const missing = SNAPSHOT_FACT_LABELS.filter((label) => stated[label] === undefined);
  if (missing.length > 0) {
    throw new Error(`The ${variant} snapshot statement states no ${missing.join(", ")}, so the artifacts cannot be compared on it. It stated ${labels.join(", ")}.`);
  }
  return { Basis: stated.Basis ?? "", Grain: stated.Grain ?? "", Period: stated.Period ?? "", Currencies: stated.Currencies ?? "", Coverage: stated.Coverage ?? "", "As of": stated["As of"] ?? "" };
}

/** The two calendar days a period fact states, exactly as written. */
function periodOfFacts(facts: SnapshotFacts): { readonly from: string; readonly to: string } {
  const match = /^(\S+) to (\S+)$/u.exec(facts.Period);
  if (match === null) {
    throw new Error(`The period fact states ${JSON.stringify(facts.Period)} rather than two calendar days, so no period is compared.`);
  }
  return { from: match[1] ?? "", to: match[2] ?? "" };
}

/** The instant an as-of fact states, without the sentence that explains it. */
function asOfOfFacts(facts: SnapshotFacts): string {
  const match = /^As of (\S+)/u.exec(facts["As of"]);
  if (match === null) {
    throw new Error(`The as-of fact states ${JSON.stringify(facts["As of"])} without the instant it was read at, so no snapshot is identified.`);
  }
  return match[1] ?? "";
}

/** The coverage state a coverage fact states, as the word the surfaces use for it. */
function coverageStateOfFacts(facts: SnapshotFacts): string {
  const match = /^Coverage is (\w+)/u.exec(facts.Coverage);
  if (match === null) {
    throw new Error(`The coverage fact states ${JSON.stringify(facts.Coverage)} without a coverage state, so partial coverage could not be told from complete.`);
  }
  return match[1] ?? "";
}

/** How long one export has to produce its file, so a download that never arrives fails as itself rather than as the test's deadline. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

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
 * One CSV download parsed with the one parser the application fixes.
 *
 * The file states its snapshot as `#meta` records, then one column header record and one record per
 * authorised row, every field quoted and every formula-opening cell neutralised with a leading tab. The
 * parser is configured with `bom: true` because an unstripped byte-order mark would silently corrupt the
 * first header name and make every row's first column unreadable, and with `relax_column_count: true`
 * because the file legitimately mixes a three-field metadata record with a fifteen-field data record —
 * every record's width is checked against the header below instead of against the file's first record.
 */
function csvFileOf(text: string, subject: string): CsvFile {
  const records: string[][] = parse(text, { bom: true, relax_column_count: true });
  const metadata = new Map<string, string>();
  let header: readonly string[] | undefined;
  const body: string[][] = [];
  for (const record of records) {
    const [first, second, third] = record;
    if (first === undefined || first.trim() === "") {
      continue;
    }
    if (first === CSV_META) {
      if (second === undefined || third === undefined) {
        throw new Error(`${subject} holds a metadata record that does not state a field and a value: ${JSON.stringify(record)}`);
      }
      metadata.set(second, third);
      continue;
    }
    if (header === undefined) {
      header = record;
      continue;
    }
    body.push(record);
  }
  const columns = header;
  if (columns === undefined) {
    throw new Error(`${subject} holds no column header record, so no row of it can be read by name.`);
  }
  const rows: Record<string, string>[] = [];
  for (const record of body) {
    if (record.length !== columns.length) {
      throw new Error(`${subject} holds a row of ${String(record.length)} fields where its header states ${String(columns.length)}: ${JSON.stringify(record).slice(0, DETAIL_LIMIT)}`);
    }
    const row: Record<string, string> = {};
    for (const [index, name] of columns.entries()) {
      row[name] = record[index] ?? "";
    }
    rows.push(row);
  }
  return { metadata, header: columns, rows };
}

/** One metadata record of a CSV file, refused rather than defaulted when the file does not state it. */
function metadataOf(file: CsvFile, field: string, subject: string): string {
  const value = file.metadata.get(field);
  if (value === undefined) {
    throw new Error(`${subject} states no ${JSON.stringify(field)} metadata record, so the snapshot it holds cannot be identified. It states ${[...file.metadata.keys()].join(", ")}.`);
  }
  return value;
}

/** The signed minor-unit amounts of one column of a printed table, read from the exponent each amount displays. */
async function printedColumnAmounts(region: Locator, columnLabel: string): Promise<readonly number[]> {
  const headers = (await region.locator("table thead th").allInnerTexts()).map((text) => text.replace(/\s+/gu, " ").trim());
  const column = headers.indexOf(columnLabel);
  if (column === -1) {
    throw new Error(`The printed table states no ${JSON.stringify(columnLabel)} column, so its rows cannot be summed: it states ${headers.join(", ")}.`);
  }
  const rows = region.locator("table tbody tr");
  const stated = await rows.count();
  const amounts: number[] = [];
  for (let row = 0; row < stated; row += 1) {
    const cell = (await rows.nth(row).locator("td").nth(column).innerText()).replace(/\s+/gu, " ").trim();
    amounts.push(statedAmountOf(cell, `The printed page's ${columnLabel} cell of row ${String(row)}`).minorUnits);
  }
  return amounts;
}

/** The exact minor units one CSV row states, read from the column the writer states them in. */
function rowMinorUnitsOf(file: CsvFile, row: Readonly<Record<string, string>>, index: number): number {
  const cell = row["amount_minor_units"];
  if (cell === undefined) {
    throw new Error(`The CSV header states no amount_minor_units column, so no row's amount is read exactly: ${file.header.join(", ")}`);
  }
  const stated = withoutNeutraliser(cell).trim();
  const value = Number(stated);
  if (!/^-?\d+$/u.test(stated) || !Number.isSafeInteger(value)) {
    throw new Error(`Row ${String(index)} of the export states ${JSON.stringify(cell)} as its amount_minor_units, which is not an exact count of minor units. A value that is not a number is stated as its own word, and this file does not read a word as a zero.`);
  }
  return value;
}

/** Downloads the whole query as a CSV file and parses it, through the surface's own export action. */
async function downloadCsv(page: Page): Promise<CsvFile> {
  const button = page.getByRole("button", { name: "Export the whole query as CSV" });
  await expect(button, "The report offers the whole-query export in this scope.").toBeEnabled();
  const waiting = page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS });
  await button.click();
  const download = await waiting;
  const text = await csvTextOf(download);
  return csvFileOf(text, `The CSV ${download.suggestedFilename()}`);
}

/** Reads a report's printed page as the browser prints it: the medium is switched to print, read, and restored. */
async function asPrinted<T>(page: Page, read: (printed: Locator) => Promise<T>): Promise<T> {
  await page.emulateMedia({ media: "print" });
  try {
    const printed = page.locator("[data-print-report]");
    await expect(printed, "The report renders the page a browser prints from the same result.").toBeVisible();
    return await read(printed);
  } finally {
    await page.emulateMedia({ media: "screen" });
  }
}

// ---------------------------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------------------------

/** This file acts as the established worker throughout, which is the persona the runner admits the context as. */
test.use({ persona: PERSONA });

/**
 * Every test starts from the deterministic seed.
 *
 * The runner's automatic `seedReset` fixture restores the same seed before the test body and puts this
 * persona's session cookie on the context; the call below states that requirement where this file is
 * read, and a second reset lays the identical documents down again — the same control the Settings reset
 * submits, so the world this file asserts against is the world that command produces. It also discards
 * the generated workload, which is why each test that needs one regenerates it from its own script.
 */
test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

/** Opens one of the fixed reports and downloads the whole query it states, through that report's own export action. */
async function exportedQueryOf(page: Page, href: string): Promise<CsvFile> {
  await page.goto(href);
  await expect(page.getByRole("heading", { name: "Received support", level: 1 })).toBeVisible();
  return downloadCsv(page);
}

/** The exact minor-unit sum of a parsed export together with the identities of the gifts it holds, in the one order two files can be compared by. */
function fingerprintOf(file: CsvFile): { readonly minorUnits: number; readonly giftIds: readonly string[] } {
  const amounts = file.rows.map((row, index) => rowMinorUnitsOf(file, row, index));
  const giftIds = file.rows.map((row) => row["gift_id"] ?? "").sort();
  return { minorUnits: sumOf(amounts, "The export's rows"), giftIds };
}

test("the whole query agrees between the screen, the CSV and the printed page, beyond the loaded page", async ({ page }) => {
  ensureWorkload();

  // --- the screen artifact: the ledger's whole-result figure for one currency --------------------
  await page.goto(`${GIFTS_HREF}?period=this-year&currency=${CURRENCY}`);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  const ledgerFacts = await snapshotFactsOf(page, "screen");
  // One named basis, one grain, one currency partition and one period are what every artifact below is
  // compared by, so the screen's statement of them is read first and nothing is assumed in its place.
  expect(ledgerFacts.Basis, "The screen states the one named received-support basis.").toContain("effective_cash_allocation");
  expect(ledgerFacts.Grain, "The screen states the grain a row is counted at.").toContain("One row is one authorised allocation");
  expect(ledgerFacts.Currencies, "The screen states the currency partition the whole query was read in.").toBe(CURRENCY);
  const ledgerFigure = wholeResultAmountOf(await readWholeResult(page), CURRENCY);
  const wholeRows = await readListTotal(page, "gifts");
  const rowsOnPage = await readRenderedRows(page, "Received gifts");
  // The count is the whole query's, and the page is one window of it: without that, a file's completeness
  // could not be told from a copy of the page.
  expect(wholeRows, "The filtered query holds more rows than one page does, which is what makes completeness beyond the page checkable.").toBeGreaterThan(PAGE_SIZE_DEFAULT);
  expect(rowsOnPage, "The ledger renders one page of the query rather than the whole result.").toBe(PAGE_SIZE_DEFAULT);
  // Partial coverage is stated in the screen's own words, and the figure says it is an incomplete subtotal.
  expect(coverageStateOfFacts(ledgerFacts), "The source's coverage of this period is partial, and the screen states it as partial.").toBe("partial");
  expect(ledgerFigure.statement, "A figure read under partial coverage is labelled an incomplete subtotal, in text rather than by colour.").toMatch(INCOMPLETE_MARKER);
  await expect(page.locator('[data-slot="whole-result-summary"]'), "The summary states that the currencies are never added together.").toContainText("no combined total is stated");
  // Two grains are stated apart: a split gift is one gift of many rows, so the gift count is never the row count.
  expect(ledgerFigure.giftCount, "The gift count is counted at the gift's own grain.").toBeLessThanOrEqual(wholeRows);

  // --- the report artifact: the same figure, from the same query, on the report surface -------------
  await page.goto(`${RECEIVED_REPORT_HREF}?period=this-year&currency=${CURRENCY}`);
  await expect(page.getByRole("heading", { name: "Received support", level: 1 })).toBeVisible();
  const reportFacts = await snapshotFactsOf(page, "screen");
  const reportScreen = page.locator('[data-slot="report-screen"]');
  expectSameAmount(statedAmountOf(await factOf(reportScreen, "Received in the period"), "The report's received-support figure"), ledgerFigure.amount, "The report states the same received support the ledger's whole-result figure states, in minor units.");
  await expect(reportScreen.getByRole("alert").first(), "The report states its partial coverage above the figures it qualifies, in text.").toContainText(PARTIAL_COVERAGE_OPENING);
  const reportRowsStated = countOf(ROWS_IN_FILE.exec((await page.locator('[data-slot="export-print-actions"]').innerText()).replace(/\s+/gu, " "))?.[1] ?? "", "The rows the export action states the file will hold");
  expect(reportRowsStated, "The export action states the whole query's row count, not the loaded page's.").toBe(wholeRows);
  // The two screens read the same snapshot: the same period, the same instant, the same coverage state.
  expect(periodOfFacts(reportFacts), "The report and the ledger state the same period.").toEqual(periodOfFacts(ledgerFacts));
  expect(asOfOfFacts(reportFacts), "The report and the ledger state the same as-of instant.").toBe(asOfOfFacts(ledgerFacts));
  expect(coverageStateOfFacts(reportFacts), "The report and the ledger state the same coverage state.").toBe(coverageStateOfFacts(ledgerFacts));

  // --- the CSV artifact ---------------------------------------------------------------------------
  const csv = await downloadCsv(page);
  const exportSubject = "The whole-query export";
  expect(metadataOf(csv, CSV_FIELD.grain, exportSubject), "The file states the grain of the rows it holds.").toBe("gift-allocation");
  expect(metadataOf(csv, CSV_FIELD.basis, exportSubject), "The file states the one named basis its figures are measured on.").toContain("effective_cash_allocation");
  expect(metadataOf(csv, CSV_FIELD.currency, exportSubject), "The file states the currency partition of the query.").toBe(CURRENCY);
  const csvPeriod = { from: metadataOf(csv, CSV_FIELD.periodFrom, exportSubject), to: metadataOf(csv, CSV_FIELD.periodTo, exportSubject) };
  expect(csvPeriod, "The file states the period the two screens state.").toEqual(periodOfFacts(reportFacts));
  expect(metadataOf(csv, CSV_FIELD.coverageState, exportSubject), "The file states the coverage state the screens state.").toBe(coverageStateOfFacts(reportFacts));
  expect(metadataOf(csv, CSV_FIELD.snapshotAsOf, exportSubject), "The file states the snapshot instant the screens state.").toBe(asOfOfFacts(reportFacts));
  expect(metadataOf(csv, CSV_FIELD.amountUnit, exportSubject), "The file states that its amounts are exact minor units, so no reader has to guess an exponent.").toBe("minor-units");
  expect(metadataOf(csv, CSV_FIELD.page, exportSubject), "The file is the whole query rather than one page of it.").toBe("whole-query");
  expect(metadataOf(csv, CSV_FIELD.snapshotQuery, exportSubject), "The file states the query it was produced from, including the single currency it names.").toContain(`currency=one:${CURRENCY}`);
  const csvTotal = countOf(metadataOf(csv, CSV_FIELD.rowTotal, exportSubject), "The row total the file states");
  expect(csvTotal, "The file's own row total is the whole-result count the pager states.").toBe(wholeRows);
  expect(csv.rows.length, "Every authorised row of the query is in the file, so the file's records match its row total.").toBe(csvTotal);
  expect(csv.rows.length, "The file is complete beyond the page the screen loaded.").toBeGreaterThan(PAGE_SIZE_DEFAULT);

  const currenciesInFile = new Set<string>();
  const giftIdsInFile = new Set<string>();
  const rowAmounts: number[] = [];
  let neutralisedCells = 0;
  let formulaOpeningCells = 0;
  for (const [index, row] of csv.rows.entries()) {
    currenciesInFile.add(row["currency"] ?? "");
    giftIdsInFile.add(row["gift_id"] ?? "");
    rowAmounts.push(rowMinorUnitsOf(csv, row, index));
    const giftDate = row["original_gift_on"] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(giftDate) || giftDate < csvPeriod.from || giftDate > csvPeriod.to) {
      throw new Error(`Row ${String(index)} of the export is dated ${JSON.stringify(giftDate)}, which is not a calendar day inside the period the query states (${csvPeriod.from} to ${csvPeriod.to}). A row outside the query's period would make the file's sum a different figure from the screen's.`);
    }
    for (const cell of Object.values(row)) {
      if (cell.startsWith(NEUTRALISER)) {
        neutralisedCells += 1;
      } else if (!isInert(cell)) {
        formulaOpeningCells += 1;
      }
    }
  }
  expect([...currenciesInFile], "Every row of the file belongs to the one currency the query selected, so no amount in it is compared across currencies.").toEqual([CURRENCY]);
  expect(formulaOpeningCells, "No field of the file can open a spreadsheet formula: each formula-opening cell carries the writer's neutralising tab.").toBe(0);
  expect(neutralisedCells, "The query itself contains rows whose text opens with a formula character (a refund states a negative amount), so the neutralisation check above is not vacuous.").toBeGreaterThan(0);
  const csvSum = sumOf(rowAmounts, "The file's rows");
  expectSameAmount({ currency: CURRENCY, minorUnits: csvSum }, ledgerFigure.amount, "The file's rows sum to the whole-result figure the screen states, in exact minor units.");
  expect(giftIdsInFile.size, "The gift count the screen states is the number of distinct gifts in the file, never the file's row count: the two grains are counted apart.").toBe(ledgerFigure.giftCount);
  // The formatted amount and the exact minor-unit column state the same number, so a reader of either reads one figure.
  for (const [index, row] of csv.rows.slice(0, 5).entries()) {
    const formatted = statedAmountOf(withoutNeutraliser(row["amount"] ?? ""), `The formatted amount of row ${String(index)}`);
    expectSameAmount(formatted, { currency: CURRENCY, minorUnits: rowMinorUnitsOf(csv, row, index) }, `Row ${String(index)} states one amount in its formatted and in its minor-unit column.`);
  }

  // --- the print artifact -------------------------------------------------------------------------
  const printed = await asPrinted(page, async (region) => {
    const facts = await snapshotFactsOf(page, "print");
    const summaryLine = region
      .locator("li")
      .filter({ hasText: `Received support (${CURRENCY})` })
      .first();
    await expect(summaryLine, "The printed page states its per-currency summary line.").toBeVisible();
    const about = (await region.innerText()).replace(/\s+/gu, " ");
    return { facts, summaryAmount: statedAmountOf(await summaryLine.innerText(), "The printed page's summary line"), rowsStated: countOf(ROWS_IN_RESULT.exec(about)?.[1] ?? "", "The row total the printed page states"), rows: await region.locator("table tbody tr").count(), about };
  });
  expect(printed.facts.Basis, "The printed page states the one named basis.").toContain("effective_cash_allocation");
  expect(printed.facts.Grain, "The printed page states the grain.").toContain("One row is one authorised allocation");
  expect(printed.facts.Currencies, "The printed page states the currency partition.").toBe(CURRENCY);
  expect(periodOfFacts(printed.facts), "The printed page states the period the screens and the file state.").toEqual(periodOfFacts(reportFacts));
  expect(asOfOfFacts(printed.facts), "The printed page states the snapshot instant the screens and the file state.").toBe(asOfOfFacts(reportFacts));
  expect(coverageStateOfFacts(printed.facts), "The printed page states the coverage state the screens and the file state.").toBe(coverageStateOfFacts(reportFacts));
  expectSameAmount(printed.summaryAmount, ledgerFigure.amount, "The printed page's summary states the same received support the screen's whole-result figure states.");
  expect(printed.rowsStated, "The printed page states the whole query's row count beside the page it printed.").toBe(wholeRows);
  expect(printed.rows, "The printed page holds the page the screen loaded, and never pretends that page is the query.").toBe(PAGE_SIZE_DEFAULT);
  expect(printed.about, "The printed page says in words that it holds one page of the query.").toContain("one page of the query");
  expect(printed.about, "The printed page explains how to obtain the complete result.").toContain("export the CSV for the complete result");
  expect(printed.about, "The printed page names the shortfall between the page it holds and the query's rows.").toContain(`This view shows ${String(PAGE_SIZE_DEFAULT)} of ${String(wholeRows)} rows`);
  expect(printed.about, "The printed page states its partial coverage in text.").toContain(PARTIAL_COVERAGE_OPENING);

  // The evidence the criterion asks to be reported, recorded on the run itself.
  test
    .info()
    .annotations.push({
      type: "criterion-1 filtered Gifts query",
      description: `period=this-year currency=${CURRENCY}: ${String(wholeRows)} rows, ${String(ledgerFigure.amount.minorUnits)} ${CURRENCY} minor units, ${String(ledgerFigure.giftCount)} gifts; agreed by the ledger summary, the report screen, the CSV (${String(csv.rows.length)} records) and the printed page (${String(printed.rows)} rows of ${String(printed.rowsStated)}).`,
    });
});

test("the whole-query values do not move when the order and the page do", async ({ page }) => {
  ensureWorkload();
  const ledgerHref = `${GIFTS_HREF}?period=this-year&currency=${CURRENCY}`;
  await page.goto(ledgerHref);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const before = wholeResultAmountOf(await readWholeResult(page), CURRENCY);
  const rowsBefore = await readListTotal(page, "gifts");
  const firstGiftBefore = await page
    .getByRole("link", { name: /^Open gift /u })
    .first()
    .getAttribute("aria-label");

  // One export at the order the surface opens in.
  const unsorted = await exportedQueryOf(page, `${RECEIVED_REPORT_HREF}?period=this-year&currency=${CURRENCY}`);
  const unsortedPrint = fingerprintOf(unsorted);

  // The same query, ordered by amount: the surface dispatches the order to the service rather than sorting
  // the page in the browser, so the order that comes back is the whole result's.
  await page.goto(ledgerHref);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const firstGiftUnsorted = await page
    .getByRole("link", { name: /^Open gift /u })
    .first()
    .getAttribute("aria-label");
  const firstRowBeforeSort = (await page.getByRole("table", { name: "Received gifts" }).locator("tbody tr").first().innerText()).replace(/\s+/gu, " ").trim();
  await page.getByRole("button", { name: "Amount", exact: true }).click();
  await expect(page, "The amount heading dispatches the order to the service, where the whole result is ordered.").toHaveURL(/sortField=amountMinor/u);
  await expect.poll(async () => (await page.getByRole("table", { name: "Received gifts" }).locator("tbody tr").first().innerText()).replace(/\s+/gu, " ").trim(), { message: "The order the service applied replaces the rows on screen before the figures below are read." }).not.toBe(firstRowBeforeSort);
  const firstGiftSorted = await page
    .getByRole("link", { name: /^Open gift /u })
    .first()
    .getAttribute("aria-label");
  expect(firstGiftSorted, "The order changed the rows, which is what makes the invariance below a claim about the figures rather than about nothing having happened.").not.toBe(firstGiftUnsorted);
  expect(firstGiftBefore, "The ledger's first row is the same before and after a re-read at the same order.").toBe(firstGiftUnsorted);

  // Re-reading the surfaces at the new order leaves the whole-query values exactly where they were.
  const sortedFigures = await readWholeResult(page);
  expectSameAmount(wholeResultAmountOf(sortedFigures, CURRENCY).amount, before.amount, "Ordering the result changes no amount: the figure is the whole query's, not the page's.");
  expect(wholeResultAmountOf(sortedFigures, CURRENCY).giftCount, "Ordering the result changes no gift count.").toBe(before.giftCount);
  expect(await readListTotal(page, "gifts"), "Ordering the result changes no row count.").toBe(rowsBefore);

  const sorted = await exportedQueryOf(page, `${RECEIVED_REPORT_HREF}?period=this-year&currency=${CURRENCY}&sortField=amountMinor&sortDirection=asc`);
  const sortedPrint = fingerprintOf(sorted);
  expect(sorted.metadata.get(CSV_FIELD.rowTotal), "Both files state the same row total.").toBe(unsorted.metadata.get(CSV_FIELD.rowTotal));
  expect(sortedPrint.minorUnits, "The same rows sum to the same minor units whatever order they are in.").toBe(unsortedPrint.minorUnits);
  expect(sortedPrint.giftIds.length, "Both files hold the same number of rows.").toBe(unsortedPrint.giftIds.length);
  expect(sortedPrint.giftIds.join(","), "The same gifts are in both files, whatever order the rows are in.").toBe(unsortedPrint.giftIds.join(","));
  expect(sortedPrint.minorUnits, "The exported sum is the screen's whole-result figure in both orders.").toBe(before.amount.minorUnits);
  expect(sorted.rows[0]?.["gift_row_id"], "The file's own order followed the query's, so the two files are not the same sequence of records.").not.toBe(unsorted.rows[0]?.["gift_row_id"]);

  // The page window is a window: asking for the second page of two hundred rows moves neither figure.
  await page.goto(`${ledgerHref}&page=1&pageSize=${String(PAGE_SIZE_CAP)}`);
  await expect(page, "The window and the cap are stated in the address, so the page read is the one asked for.").toHaveURL(new RegExp(`page=1&pageSize=${String(PAGE_SIZE_CAP)}`, "u"));
  await expect(page.getByRole("table", { name: "Received gifts" }).locator("tbody tr"), "The 200-row cap is the largest page the list offers, and it is still a page of the result.").toHaveCount(PAGE_SIZE_CAP);
  expect(await readListTotal(page, "gifts"), "A page window changes no row count: the pager still states the whole result.").toBe(rowsBefore);
  const windowed = await readWholeResult(page);
  expectSameAmount(wholeResultAmountOf(windowed, CURRENCY).amount, before.amount, "A page window changes no amount: the figure is the whole query's.");
  expect(wholeResultAmountOf(windowed, CURRENCY).giftCount, "A page window changes no gift count.").toBe(before.giftCount);
  // ... and returning the page size to its default moves the window back without touching the figures.
  await page.getByLabel("Rows per page").selectOption(String(PAGE_SIZE_DEFAULT));
  await expect(page.getByRole("table", { name: "Received gifts" }).locator("tbody tr"), "Returning to the default page size renders the default page again.").toHaveCount(PAGE_SIZE_DEFAULT);
  expect(await readListTotal(page, "gifts"), "Returning the page size to its default changes no row count.").toBe(rowsBefore);
  expectSameAmount(wholeResultAmountOf(await readWholeResult(page), CURRENCY).amount, before.amount, "Returning the page size to its default changes no amount.");

  test
    .info()
    .annotations.push({
      type: "criterion-1 invariance",
      description: `period=this-year currency=${CURRENCY}: ${String(rowsBefore)} rows and ${String(before.amount.minorUnits)} ${CURRENCY} minor units in the unsorted, the amount-ordered and the second-page-of-200 readings; two exports of ${String(unsorted.rows.length)} records each agree in sum and in gift identity while their first records differ.`,
    });
});

test("an amount range is offered only inside one currency, and the currencies stay apart", async ({ page }) => {
  await page.goto(`${GIFTS_HREF}?period=this-year`);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();

  // --- while the query selects every currency, the range states that it cannot be applied -----------
  await expect(page.getByRole("button", { name: "Amount range, unavailable" }), "With every currency selected the amount range is stated as unavailable rather than offered as a filter that would compare amounts across currencies.").toBeVisible();
  await expect(page.locator('[data-slot="query-toolbar"]'), "The reason the range cannot be applied is stated in text, so it is not carried by a disabled look alone.").toContainText("Amount range:");
  await expect(page.locator('[data-slot="query-toolbar"]'), "The reason names the rule: an amount range spans one currency's minor units.").toContainText("one currency");

  // --- the currencies are stated apart, and a row whose currency is unknown is not a zero -----------
  const allCurrencies = await readWholeResult(page);
  const currencyNames = allCurrencies.map((line) => line.currency).sort();
  expect(currencyNames.length, "The seed holds received support in more than one currency, which is what makes the single-currency rule worth asserting.").toBeGreaterThan(1);
  expect(currencyNames, "The two-decimal, three-decimal, zero-decimal and never-identified currencies are each stated on their own line: nothing is added across them.").toEqual(expect.arrayContaining([CURRENCY, "KWD", "JPY", "UNKNOWN"]));
  const unidentified = allCurrencies.find((line) => line.currency === "UNKNOWN");
  expect(unidentified, "The source's row whose currency it never identified is stated as its own currency partition.").toBeDefined();
  expect(unidentified?.kind, "A row whose currency the source never identified cannot be summed, so its partition states a state rather than a number.").toBe("state");
  if (unidentified?.kind === "state") {
    expect(unidentified.word, "The unidentified partition states an unknown amount, never a zero: a zero would claim the source recorded nothing.").toBe("Unknown amount");
  }
  const unfilteredRows = await readListTotal(page, "gifts");
  const unfilteredAmount = wholeResultAmountOf(allCurrencies, CURRENCY);
  const unfilteredPager = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim();

  // --- one currency makes the range available ------------------------------------------------------
  await page.getByRole("combobox", { name: "Currency" }).click();
  await page.getByRole("option", { name: new RegExp(`^${CURRENCY}`, "u") }).click();
  await expect(page, "Choosing one currency is a query the address states, so the view can be returned to.").toHaveURL(new RegExp(`currency=${CURRENCY}`, "u"));
  await expect(page.getByRole("button", { name: "Amount range, unavailable" }), "With exactly one currency selected the range is offered, because a range then compares one currency's minor units.").toHaveCount(0);
  await expect(page.getByRole("list", { name: "Selected filters" }), "The applied filters are stated on screen, so the query this view states is readable without decoding the address.").toContainText(`Currency: ${CURRENCY}`);
  await expect.poll(async () => (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim(), { message: "The narrowed query replaces the count the wider one stated, so the readings below describe the result on screen." }).not.toBe(unfilteredPager);
  const singleCurrencyPager = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim();

  // --- a band inside that currency narrows the result to amounts it can compare ---------------------
  await page.getByRole("combobox", { name: "Amount range" }).click();
  await page.getByRole("option", { name: `Under 100 ${CURRENCY}` }).click();
  await expect(page, "The applied band is stated in the address as the minor units it compares, so a reload reads the same rows.").toHaveURL(/amountMin=0&amountMax=9999/u);
  await expect(page.getByRole("list", { name: "Selected filters" }), "The range is stated as an applied filter beside the currency and the period.").toContainText(`Amount range: Under 100 ${CURRENCY}`);
  await expect.poll(async () => (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim(), { message: "The ranged query replaces the count the single-currency query stated, so the readings below describe the narrowed result." }).not.toBe(singleCurrencyPager);
  const rangedAmount = wholeResultAmountOf(await readWholeResult(page), CURRENCY);
  const rangedRows = await readListTotal(page, "gifts");
  expect(rangedRows, "The band narrows the whole result, so its row count is smaller than the query without it.").toBeLessThanOrEqual(unfilteredRows);
  expect(rangedAmount.amount.minorUnits, "The band narrows the whole result's figure, so its amount is no larger than the query without it.").toBeLessThanOrEqual(unfilteredAmount.amount.minorUnits);
  expect(rangedAmount.amount.minorUnits, "A band from zero upward holds no negative amount, so its whole-result figure cannot be negative.").toBeGreaterThanOrEqual(0);
  // Every row the band narrowed to states an amount inside it, and the rows on this one page sum to the
  // whole-result figure the same screen states — the agreement the ledger is read against, at one grain.
  const rendered = await readRenderedRows(page, "Received gifts");
  expect(rendered, "The band's whole result fits one page, so the rows on screen are the whole query.").toBe(rangedRows);
  const table = page.getByRole("table", { name: "Received gifts" });
  const rangedRowAmounts: number[] = [];
  for (let index = 0; index < rendered; index += 1) {
    const rowAmount = statedAmountOf(await table.locator("tbody tr").nth(index).innerText(), `Row ${String(index)} of the ranged ledger`);
    expect(rowAmount.currency, `Row ${String(index)} of the ranged ledger is in the one currency the band compares.`).toBe(CURRENCY);
    expect(rowAmount.minorUnits, `Row ${String(index)} of the ranged ledger states an amount inside the band it was narrowed to.`).toBeLessThanOrEqual(9999);
    expect(rowAmount.minorUnits, `Row ${String(index)} of the ranged ledger states an amount inside the band it was narrowed to.`).toBeGreaterThanOrEqual(0);
    rangedRowAmounts.push(rowAmount.minorUnits);
  }
  expect(sumOf(rangedRowAmounts, "The ranged ledger's rows"), "The rows on the page sum to the whole-result figure the same screen states, because they are the whole result.").toBe(rangedAmount.amount.minorUnits);

  // --- the selection stops naming one currency, so the range is dropped rather than kept silently ---
  // Removing the applied currency through its own chip is the surface's affordance for clearing a filter;
  // the single-select picker offers no way to state "no choice" other than removing what it states.
  await page.getByRole("button", { name: `Remove this filter: Currency: ${CURRENCY}` }).click();
  await expect(page.getByRole("button", { name: "Amount range, unavailable" }), "Once the selection no longer names one currency the range states again that it cannot be applied, rather than comparing currencies.").toBeVisible();
  await expect(page.getByRole("list", { name: "Selected filters" }), "The dropped range is gone from the applied filters, so no invisible filter narrows the result.").not.toContainText("Amount range:");
  await expect(page, "The dropped range is gone from the address too, so a reload cannot reinstate a comparison across currencies.").not.toHaveURL(/amountMin/u);
  await expect.poll(async () => await page.locator('[data-slot="whole-result-summary"] li').count(), { message: "With every currency selected the summary states each currency on its own line again, once the widened read answers." }).toBeGreaterThan(1);
  const afterClearing = await readWholeResult(page);
  expect(afterClearing.length, "With every currency selected the summary states each currency apart again.").toBeGreaterThan(1);
  expect(wholeResultAmountOf(afterClearing, CURRENCY).amount, "Clearing the range and the currency restores the figure the query stated before either was applied.").toEqual(unfilteredAmount.amount);

  test
    .info()
    .annotations.push({
      type: "criterion-1 single-currency rule",
      description: `The range facet is unavailable while ${String(currencyNames.length)} currencies are selected and available once ${CURRENCY} alone is; the band Under 100 ${CURRENCY} narrowed the whole result to ${String(rangedRows)} rows summing to ${String(rangedAmount.amount.minorUnits)} ${CURRENCY} minor units, and clearing the currency dropped the range.`,
    });
});

test("the chart's monthly series sums to the figure the screen, the CSV and the printed page state", async ({ page }) => {
  ensureWorkload();
  const yearFrom = `${String(HISTORY_YEAR)}-01-01`;
  const yearTo = `${String(HISTORY_YEAR)}-12-31`;

  // --- the chart artifact: the series' accessible data table, not the picture ----------------------
  await page.goto(`${HISTORY_REPORT_HREF}?year=${String(HISTORY_YEAR)}&currency=${CURRENCY}`);
  await expect(page.getByRole("heading", { name: "Monthly history", level: 1 })).toBeVisible();
  const figure = page.locator('[data-slot="chart-figure"]').first();
  await expect(figure, "The report draws its monthly series inside the one chart pattern.").toBeVisible();
  const caption = (await figure.locator("figcaption").innerText()).replace(/\s+/gu, " ");
  expect(caption, "The chart states its unit, so a reader knows what the axis counts.").toContain(`Amounts are in ${CURRENCY}`);
  expect(caption, "The chart states its coverage, so a partial year is not read as a total.").toContain("Coverage: partial");
  expect(caption, "The chart states the instant it was read at.").toContain("As of");
  const dataTableRegion = page.getByRole("region", { name: /: data table$/u }).first();
  await expect(dataTableRegion, "The chart carries the same figures as a real table beside it.").toBeVisible();
  const monthRows = dataTableRegion.locator("table tbody tr");
  const stated = await monthRows.count();
  expect(stated, "The series states one row per month of the year, so a month the source records nothing in is a stated gap rather than a missing row.").toBe(12);
  const gapMonths: string[] = [];
  const plottedAmounts: StatedAmount[] = [];
  for (let index = 0; index < stated; index += 1) {
    const cells = await monthRows.nth(index).locator("td").allInnerTexts();
    const month = (cells[0] ?? "").replace(/\s+/gu, " ").trim();
    const cell = (cells[1] ?? "").replace(/\s+/gu, " ").trim();
    if (cell.includes("No recorded value")) {
      gapMonths.push(month);
      expect(cell, "A month the source records nothing in states that in words and never as a zero or a blank.").not.toMatch(/\d/u);
      continue;
    }
    plottedAmounts.push(statedAmountOf(cell, `The chart's point for ${month}`));
  }
  expect(
    gapMonths.map((month) => month.slice(0, ABSENT_MONTH.length)),
    "The one month the source records nothing in is stated as a gap, and no other month is.",
  ).toEqual([ABSENT_MONTH]);
  expect(gapMonths, "The gap states the civil day its month begins on, so the month cannot be mistaken for another.").toEqual([`${ABSENT_MONTH}-01`]);
  expect([...new Set(plottedAmounts.map((amount) => amount.currency))], "Every point of the series is in the one currency the query selected.").toEqual([CURRENCY]);
  const seriesSum = sumOf(
    plottedAmounts.map((amount) => amount.minorUnits),
    "The chart's twelve monthly points",
  );

  // --- the screen artifact: the same query stated as one figure ------------------------------------
  await page.goto(`${RECEIVED_REPORT_HREF}?from=${yearFrom}&to=${yearTo}&currency=${CURRENCY}`);
  await expect(page.getByRole("heading", { name: "Received support", level: 1 })).toBeVisible();
  const facts = await snapshotFactsOf(page, "screen");
  expect(periodOfFacts(facts), "The report covers exactly the year the chart's series covers.").toEqual({ from: yearFrom, to: yearTo });
  const screenAmount = statedAmountOf(await factOf(page.locator('[data-slot="report-screen"]'), "Received in the period"), "The report's received-support figure for the year");
  expectSameAmount({ currency: CURRENCY, minorUnits: seriesSum }, screenAmount, "The chart's monthly points sum to the figure the screen states for the same period, in exact minor units.");

  // --- the CSV artifact: the whole query, summed from the column that states minor units ------------
  const csv = await downloadCsv(page);
  expect(metadataOf(csv, CSV_FIELD.page, "The year's export"), "The file is the whole query rather than a page of it.").toBe("whole-query");
  expect({ from: metadataOf(csv, CSV_FIELD.periodFrom, "The year's export"), to: metadataOf(csv, CSV_FIELD.periodTo, "The year's export") }, "The file states the year the chart and the screen state.").toEqual({ from: yearFrom, to: yearTo });
  expect(countOf(metadataOf(csv, CSV_FIELD.rowTotal, "The year's export"), "The year's export row total"), "The file's records are the whole query's rows.").toBe(csv.rows.length);
  const csvSum = sumOf(
    csv.rows.map((row, index) => rowMinorUnitsOf(csv, row, index)),
    "The year's exported rows",
  );
  expect(csvSum, "The file's rows sum to the same minor units the chart's points and the screen's figure state.").toBe(seriesSum);

  // --- the print artifact -------------------------------------------------------------------------
  const printed = await asPrinted(page, async (region) => {
    const printFacts = await snapshotFactsOf(page, "print");
    const summaryLine = region
      .locator("li")
      .filter({ hasText: `Received support (${CURRENCY})` })
      .first();
    await expect(summaryLine, "The printed page states the year's received support.").toBeVisible();
    return { facts: printFacts, summaryAmount: statedAmountOf(await summaryLine.innerText(), "The printed page's summary line") };
  });
  expect(periodOfFacts(printed.facts), "The printed page states the year the chart, the screen and the file state.").toEqual({ from: yearFrom, to: yearTo });
  expectSameAmount(printed.summaryAmount, { currency: CURRENCY, minorUnits: seriesSum }, "The printed page's summary states the same figure the chart's points sum to.");

  test
    .info()
    .annotations.push({ type: "criterion-1 chart agreement", description: `${String(HISTORY_YEAR)} ${CURRENCY}: eleven stated months plus the gap at ${ABSENT_MONTH} sum to ${String(seriesSum)} minor units, which the report screen, the export (${String(csv.rows.length)} records) and the printed summary all state.` });
});

test("one figure at three grains: the matrix cell, the rows it narrows to and the report it belongs to", async ({ page }) => {
  await page.goto(`${MATRIX_REPORT_HREF}?period=this-year&currency=${CURRENCY}`);
  await expect(page.getByRole("heading", { name: "Partners by month", level: 1 })).toBeVisible();
  const matrixFacts = await snapshotFactsOf(page, "screen");
  const parentRows = countOf(ROWS_IN_FILE.exec((await page.locator('[data-slot="export-print-actions"]').innerText()).replace(/\s+/gu, " "))?.[1] ?? "", "The matrix query's whole-result row count");

  // --- the cell -----------------------------------------------------------------------------------
  const cell = page.locator(`[data-slot="report-matrix"] a[href*="partnerId=${DRILLDOWN_PARTNER}"][href*="from=${DRILLDOWN_MONTH_FROM}"]`).first();
  await expect(cell, "The matrix states a cell for this partner in this month, and the cell is the link to the records behind it.").toBeVisible();
  const cellAmount = statedAmountOf(await cell.innerText(), "The matrix cell");
  expect(cellAmount.currency, "The cell states its amount in the currency of the partition it sits in.").toBe(CURRENCY);

  // --- the rows it narrows to ---------------------------------------------------------------------
  await cell.click();
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const drilledFacts = await snapshotFactsOf(page, "screen");
  const drilledRows = await readListTotal(page, "gifts");
  const drilledFigure = wholeResultAmountOf(await readWholeResult(page), CURRENCY);
  expect(drilledRows, "The drilled query narrows the parent result rather than repeating it.").toBeLessThan(parentRows);
  expectSameAmount(drilledFigure.amount, cellAmount, "The rows the cell narrows to sum to the cell's own figure, in exact minor units.");
  // A drill-down is a narrowing of the same result, and never a different one: the basis, the currency
  // partition and the coverage are the parent's, and only the period and the attribution are narrower.
  expect(periodOfFacts(drilledFacts), "The drilled query states the cell's month as two civil days.").toEqual({ from: DRILLDOWN_MONTH_FROM, to: DRILLDOWN_MONTH_TO });
  expect(drilledFacts.Basis, "The drilled query is measured on the same named basis as the matrix.").toBe(matrixFacts.Basis);
  expect(drilledFacts.Grain, "The drilled query is counted at the same grain as the matrix.").toBe(matrixFacts.Grain);
  expect(coverageStateOfFacts(drilledFacts), "The drilled query carries the same coverage statement as the matrix.").toBe(coverageStateOfFacts(matrixFacts));
  const renderedRows = await readRenderedRows(page, "Received gifts");
  expect(renderedRows, "The drilled query's whole result fits one page, so the rows on screen are the rows behind the cell.").toBe(drilledRows);
  const drilledTable = page.getByRole("table", { name: "Received gifts" });
  const drilledAmounts: number[] = [];
  for (let index = 0; index < renderedRows; index += 1) {
    drilledAmounts.push(statedAmountOf(await drilledTable.locator("tbody tr").nth(index).innerText(), `Row ${String(index)} of the drilled ledger`).minorUnits);
  }
  expect(sumOf(drilledAmounts, "The drilled ledger's rows"), "The rows themselves sum to the cell's figure, which is the whole-result figure of the drilled query.").toBe(cellAmount.minorUnits);
  const drilledPartner = page.getByRole("list", { name: "Selected filters" });
  await expect(drilledPartner, "The drilled view states the partner it was narrowed to as an applied filter.").toContainText(`Attribution: ${DRILLDOWN_PARTNER}`);

  // --- the report of the same narrow query, its CSV and its print ----------------------------------
  const drilldownQuery = `from=${DRILLDOWN_MONTH_FROM}&to=${DRILLDOWN_MONTH_TO}&currency=${CURRENCY}&recipient=partner&partnerId=${DRILLDOWN_PARTNER}`;
  await page.goto(`${RECEIVED_REPORT_HREF}?${drilldownQuery}`);
  await expect(page.getByRole("heading", { name: "Received support", level: 1 })).toBeVisible();
  const reportAmount = statedAmountOf(await factOf(page.locator('[data-slot="report-screen"]'), "Received in the period"), "The report's figure for the drilled query");
  expectSameAmount(reportAmount, cellAmount, "The report of the drilled query states the cell's figure.");
  const csv = await downloadCsv(page);
  const drilledExport = "The drilled query's export";
  expect(metadataOf(csv, CSV_FIELD.page, drilledExport), "The drilled export is the whole query.").toBe("whole-query");
  expect(metadataOf(csv, CSV_FIELD.currency, drilledExport), "The drilled export states the one currency the cell sits in.").toBe(CURRENCY);
  expect(metadataOf(csv, CSV_FIELD.snapshotQuery, drilledExport), "The drilled export states the same narrowing the ledger's filters state.").toContain(`partner:${DRILLDOWN_PARTNER}`);
  expect(countOf(metadataOf(csv, CSV_FIELD.rowTotal, drilledExport), "The drilled export's row total"), "The drilled export holds the rows the drilled ledger stated.").toBe(drilledRows);
  expect(csv.rows.length, "The drilled export's records are its whole result.").toBe(drilledRows);
  for (const [index, row] of csv.rows.entries()) {
    expect(row["partner_id"], `Row ${String(index)} of the drilled export belongs to the partner the cell names.`).toBe(DRILLDOWN_PARTNER);
  }
  expect(
    sumOf(
      csv.rows.map((row, index) => rowMinorUnitsOf(csv, row, index)),
      "The drilled export's rows",
    ),
    "The drilled export's rows sum to the cell's figure.",
  ).toBe(cellAmount.minorUnits);
  const printed = await asPrinted(page, async (region) => {
    const printFacts = await snapshotFactsOf(page, "print");
    const summaryLine = region
      .locator("li")
      .filter({ hasText: `Received support (${CURRENCY})` })
      .first();
    await expect(summaryLine, "The printed page of the drilled query states its summary line.").toBeVisible();
    const about = (await region.innerText()).replace(/\s+/gu, " ");
    return {
      facts: printFacts,
      summaryAmount: statedAmountOf(await summaryLine.innerText(), "The printed page's summary line"),
      rowsStated: countOf(ROWS_IN_RESULT.exec(about)?.[1] ?? "", "The printed page's row total"),
      rows: await region.locator("table tbody tr").count(),
      rowAmounts: await printedColumnAmounts(region, "amount"),
      about,
    };
  });
  expect(periodOfFacts(printed.facts), "The printed page states the cell's month.").toEqual({ from: DRILLDOWN_MONTH_FROM, to: DRILLDOWN_MONTH_TO });
  expectSameAmount(printed.summaryAmount, cellAmount, "The printed page's summary states the cell's figure.");
  expect(printed.rowsStated, "The printed page states the drilled query's whole row count.").toBe(drilledRows);
  expect(printed.rows, "The printed page holds every row of the drilled query, because the whole result fits one page.").toBe(drilledRows);
  expect(printed.rowAmounts.length, "Every printed row states its amount, so the page's own rows can be summed.").toBe(drilledRows);
  expect(sumOf(printed.rowAmounts, "The printed page's rows"), "The printed page's rows sum to the cell's figure, in exact minor units: the sheet and the screen are one result.").toBe(cellAmount.minorUnits);
  expect(printed.about, "The printed page says it holds every authorised row of the query rather than a window of it.").toContain("every authorised row of the query");

  test
    .info()
    .annotations.push({
      type: "criterion-1 matrix drilldown",
      description: `Matrix cell ${DRILLDOWN_PARTNER} ${DRILLDOWN_MONTH_FROM}: ${String(cellAmount.minorUnits)} ${CURRENCY} minor units agreed by the cell, the ${String(drilledRows)} rows it narrowed to (from ${String(parentRows)} in the parent query), the drilled report's screen, its export (${String(csv.rows.length)} records) and its printed page (${String(printed.rows)} rows).`,
    });
});

test("a record visit returns to the same filtered view, at the same place in it", async ({ page }) => {
  ensureWorkload();
  const ledgerHref = `${GIFTS_HREF}?period=this-year&currency=${CURRENCY}`;
  await page.goto(ledgerHref);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const table = page.getByRole("table", { name: "Received gifts" });
  await expect(table.locator("tbody tr").first()).toBeVisible();

  // The reader's place in a long result is part of the view the surface state carries, so it is moved
  // away from the top before the visit and read back afterwards.
  await page.mouse.wheel(0, 1_200);
  expect(await page.evaluate(() => window.scrollY), "The filtered ledger is longer than the viewport, which is what makes the place in it something to return to.").toBeGreaterThan(0);
  const chipsBefore = (await page.getByRole("list", { name: "Selected filters" }).innerText()).replace(/\s+/gu, " ").trim();
  const pagerBefore = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim();
  const firstGiftBefore = await page
    .getByRole("link", { name: /^Open gift /u })
    .first()
    .getAttribute("aria-label");

  // The visit: the row's own link is the only route to the record, and it names the gift it opens.
  await page
    .getByRole("link", { name: /^Open gift /u })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Gift record", level: 1 })).toBeVisible();
  await expect(page, "The record is a destination of its own, so the visit is a navigation rather than a panel over the list.").toHaveURL(new RegExp(`${GIFTS_HREF}/gift-[^?]+`, "u"));

  // The return: the same query, the same window, the same rows and the same place in them.
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  await expect(page, "The ledger returns with the filters the visit started from, so the query survives the detail visit.").toHaveURL(/period=this-year&currency=USD/u);
  expect((await page.getByRole("list", { name: "Selected filters" }).innerText()).replace(/\s+/gu, " ").trim(), "The applied filters come back exactly as they were.").toBe(chipsBefore);
  expect((await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim(), "The page window comes back exactly as it was.").toBe(pagerBefore);
  await expect(table.locator("tbody tr").first()).toBeVisible();
  expect(
    await page
      .getByRole("link", { name: /^Open gift /u })
      .first()
      .getAttribute("aria-label"),
    "The same rows are in the same order after the return.",
  ).toBe(firstGiftBefore);
  await expect.poll(async () => await page.evaluate(() => window.scrollY), { message: "The return restores the reader's place rather than dropping them at the top of the list." }).toBeGreaterThan(0);
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first(), "The returned view is still labelled as development data, so no surface of this application can be mistaken for production.").toBeVisible();

  test.info().annotations.push({ type: "criterion-1 continuity", description: `A gift-record visit and return restored the applied filters (${chipsBefore}), the page window (${pagerBefore}), the first row (${firstGiftBefore ?? "none"}) and a non-zero scroll position.` });
});
