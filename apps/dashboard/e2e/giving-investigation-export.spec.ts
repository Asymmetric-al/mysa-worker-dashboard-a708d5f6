/** Criterion 1 — whole-query agreement: one query, one snapshot, six artifacts (AAP 0.8.8, 0.12.2). */ import type { Locator, Page } from "@playwright/test";
import { AMOUNT_STATE_WORDS, CSV_FIELD, NEUTRALISER, countOf, ensureWorkload, listTotalOf, csvFileOf, csvTextOf, expect, expectSameAmount, isInert, metadataOf, printedColumnAmounts, rowMinorUnitsOf, statedAmountOf, sumOf, test, withoutNeutraliser, type CsvFile, type StatedAmount } from "../playwright.config";
const openReport = async (page: Page, href: string, heading: string): Promise<void> => {
  await page.goto(href);
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
};
const recordEvidence = (type: string, description: string): void => void test.info().annotations.push({ type, description });
const GIFTS_HREF = "/support/gifts";
const RECEIVED_REPORT_HREF = "/support/reports/received";
const HISTORY_REPORT_HREF = "/support/reports/history";
const MATRIX_REPORT_HREF = "/support/reports/matrix";
const CURRENCY = "USD";
const HISTORY_YEAR = 2024;
const ABSENT_MONTH = "2024-02";
const SNAPSHOT_YEAR = 2026;
const SNAPSHOT_FROM = `${String(SNAPSHOT_YEAR)}-01-01`; // The two civil days that journey's query names, derived from the year so the address and the assertion cannot drift apart.
const SNAPSHOT_TO = `${String(SNAPSHOT_YEAR)}-12-31`;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_CAP = 200;
const DRILLDOWN_PARTNER = "partner-church-st-aidan";
const DRILLDOWN_MONTH_FROM = "2026-07-01";
const DRILLDOWN_MONTH_TO = "2026-07-31";
const DEVELOPMENT_DATA_LABEL = "Development data";
const PARTIAL_COVERAGE_OPENING = "Coverage is partial";
const INCOMPLETE_MARKER = /\(incomplete\)/u;
const GIFT_LINK_LABEL = /^Open gift (\S+)$/u;
const ROWS_IN_FILE = /Rows in the file\s+([\d,]+)/u;
const SNAPSHOT_FACT_LABELS = ["Basis", "Grain", "Period", "Currencies", "Coverage", "As of"] as const;
type SnapshotFactLabel = (typeof SNAPSHOT_FACT_LABELS)[number];
type SnapshotFacts = Readonly<Record<SnapshotFactLabel, string>>;
type WholeResultLine = { readonly kind: "amount"; readonly currency: string; readonly amount: StatedAmount; readonly giftCount: number; readonly statement: string } | { readonly kind: "state"; readonly currency: string; readonly word: string; readonly statement: string }; // One line of the ledger's whole-result summary: a stated amount with its gift count, or a state that is not a number.
async function readWholeResult(page: Page): Promise<readonly WholeResultLine[]> {
  const heading = page.getByRole("heading", { name: "Whole-result support, by currency" });
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
    const gift = /\band\s+([\d,]+)\s+gifts?\b/u.exec(statement);
    if (gift === null) throw new Error(`The whole-result line for ${currency} states ${JSON.stringify(statement.slice(0, 240))} without the gift count it states beside every amount. A figure whose grain cannot be read is not compared.`);
    figures.push({ kind: "amount", currency, amount: statedAmountOf(statement, `The whole-result line for ${currency}`), giftCount: countOf(gift[1] ?? "", `The gift count beside the whole-result figure for ${currency}`), statement });
  }
  return figures;
}
function wholeResultAmountOf(figures: readonly WholeResultLine[], currency: string): { readonly amount: StatedAmount; readonly giftCount: number; readonly statement: string } {
  const line = figures.find((entry) => entry.currency === currency); // The amount the whole-result summary states for one currency, refusing a currency whose line states a state instead.
  if (line === undefined) throw new Error(`The whole-result summary states no figure for ${currency}; it states ${figures.map((entry) => entry.currency).join(", ") || "no currency"}.`);
  if (line.kind !== "amount") throw new Error(`The whole-result line for ${currency} states ${JSON.stringify(line.word)} rather than an amount. That is a state, not a zero.`);
  return { amount: line.amount, giftCount: line.giftCount, statement: line.statement };
}
async function readRenderedRows(page: Page, tableLabel: string): Promise<number> {
  const rows = page.getByRole("table", { name: tableLabel }).locator("tbody tr"); // The counted rows the rendered page holds, which is what the page-size assertions compare against.
  await expect(rows.first()).toBeVisible();
  return rows.count();
}
const NO_RECORDED_VALUE = "No recorded value"; // The words a chart's data table states a month the source records nothing in with: a gap, and never a zero.
type ChartMonth = { readonly start: string; readonly amount: number | undefined };
type MatrixStatedCell = { readonly href: string; readonly amount: StatedAmount };
function drilldownPeriodOf(href: string, subject: string): { readonly from: string; readonly to: string } {
  const stated = new URL(href, "http://localhost").searchParams; // The two calendar days a matrix cell's own drill-down address narrows to, read from the query the application wrote into its link.
  const from = stated.get("from");
  const to = stated.get("to");
  if (from === null || to === null) throw new Error(`${subject} states the drill-down address ${JSON.stringify(href)}, which names no period, so the narrowing it opens cannot be compared with the cell it belongs to.`);
  return { from, to };
}
async function chartMonthsOf(page: Page): Promise<readonly ChartMonth[]> {
  const dataTable = page.getByRole("region", { name: /: data table$/u }).first(); // A chart's monthly series as its accessible data table states it: one entry per month, in civil order, each with the day the month begins on and its point or `undefined`.
  await expect(dataTable, "The chart carries the same figures as a real table beside it.").toBeVisible();
  const rows = dataTable.locator("table tbody tr");
  const stated = await rows.count();
  expect(stated, "The series states one row per month of the year, so a month the source records nothing in is a stated gap rather than a missing row.").toBe(12);
  const months: ChartMonth[] = [];
  for (let index = 0; index < stated; index += 1) {
    const cells = await rows.nth(index).locator("td").allInnerTexts();
    const start = (cells[0] ?? "").replace(/\s+/gu, " ").trim();
    const cell = (cells[1] ?? "").replace(/\s+/gu, " ").trim();
    if (cell.includes(NO_RECORDED_VALUE)) {
      expect(cell, "A month the source records nothing in states that in words and never as a zero or a blank.").not.toMatch(/\d/u);
      months.push({ start, amount: undefined });
      continue;
    }
    const point = statedAmountOf(cell, `The chart's point for ${start}`);
    expect(point.currency, `The chart's point for ${start} is stated in the one currency the query selected.`).toBe(CURRENCY);
    months.push({ start, amount: point.minorUnits });
  }
  return months;
}
async function matrixCellsOf(page: Page): Promise<readonly MatrixStatedCell[]> {
  const cells = page.locator('[data-slot="report-matrix"] table a'); // The partner-by-month matrix's stated cells, read once each from the wide table's own links, which is the one presentation that states every cell exactly once.
  const stated = await cells.count();
  expect(stated, "The matrix states at least one amount as a cell that drills down to the rows behind it.").toBeGreaterThan(0);
  const read: MatrixStatedCell[] = [];
  for (let index = 0; index < stated; index += 1) {
    const cell = cells.nth(index);
    const href = await cell.getAttribute("href");
    if (href === null) throw new Error(`Matrix cell ${String(index)} states no drill-down address, so the records behind it cannot be reached and the cell is not the drilldown the criterion names.`);
    read.push({ href, amount: statedAmountOf(await cell.innerText(), `Matrix cell ${String(index)}`) });
  }
  return read;
}
const SCROLL_TOLERANCE_PX = 1;
type ScrollPlace = { readonly offset: number; readonly height: number };
const scrollPlaceAt = (page: Page): Promise<ScrollPlace> => page.evaluate(() => ({ offset: window.scrollY, height: document.documentElement.scrollHeight }));
/** Reads the place a reader leaves a list at, with the row's own link brought into view exactly as the click requires, once the document has stopped growing. */ async function scrollPlaceOfRow(page: Page, link: Locator, subject: string): Promise<ScrollPlace> {
  await expect(async () => {
    await link.scrollIntoViewIfNeeded();
  }, `${subject} states the row's own link and can bring it into view, which is what makes the place the reader stands at one they can leave from.`).toPass({ timeout: 15_000 });
  let place = await scrollPlaceAt(page); // The height is sampled until it stops growing: a surface fills after its first paint, and a place taken on a half-rendered document is not the place the reader leaves at.
  for (let sample = 0; sample < 12; sample += 1) {
    await page.waitForTimeout(250);
    const next = await scrollPlaceAt(page);
    if (next.height === place.height) return next;
    place = next;
  }
  return place;
}
/** Asserts the reader is back at the place they left: within the tolerance, on a document at least as tall as the one they left, and inside the list rather than at its top. */ async function expectRestoredScrollPlace(page: Page, place: ScrollPlace, subject: string): Promise<void> {
  // The offset must come back within the tolerance on a document at least as tall as the one it was taken on, which is what makes the place the reader left one they can stand at again.
  const restored = async (): Promise<number | undefined> => {
    const read = await scrollPlaceAt(page);
    return read.height >= place.height && Math.abs(read.offset - place.offset) <= SCROLL_TOLERANCE_PX ? read.offset : undefined;
  };
  await expect.poll(restored, { message: `${subject} comes back at the ${String(place.offset)} px place the reader left, within ${String(SCROLL_TOLERANCE_PX)} px of it.` }).toBeGreaterThan(0);
}
async function factOf(scope: Locator, label: string): Promise<string> {
  const value = scope.locator("dt").filter({ hasText: label }).first().locator("xpath=following-sibling::dd[1]"); // One labelled fact a surface states, read from the definition list that states it.
  await expect(value, `The surface states ${JSON.stringify(label)} as a labelled fact.`).toHaveCount(1);
  return (await value.innerText()).replace(/\s+/gu, " ").trim();
}
async function snapshotFactsOf(page: Page, variant: "screen" | "print"): Promise<SnapshotFacts> {
  const statement = page.locator(`[data-snapshot-statement="${variant}"]`).first(); // The four facts every artifact is compared by, read from the snapshot statement the surface renders.
  await expect(statement, `The ${variant} snapshot statement is on screen.`).toBeVisible();
  const labels = (await statement.locator("dt").allInnerTexts()).map((text) => text.replace(/\s+/gu, " ").trim());
  const values = (await statement.locator("dd").allInnerTexts()).map((text) => text.replace(/\s+/gu, " ").trim());
  if (labels.length !== values.length) throw new Error(`The ${variant} snapshot statement states ${String(labels.length)} labels and ${String(values.length)} values, so no fact can be attributed to its label.`);
  const stated: Record<string, string> = {};
  for (const [index, label] of labels.entries()) stated[label] = values[index] ?? "";
  const missing = SNAPSHOT_FACT_LABELS.filter((label) => stated[label] === undefined);
  if (missing.length > 0) throw new Error(`The ${variant} snapshot statement states no ${missing.join(", ")}, so the artifacts cannot be compared on it. It stated ${labels.join(", ")}.`);
  return { Basis: stated.Basis ?? "", Grain: stated.Grain ?? "", Period: stated.Period ?? "", Currencies: stated.Currencies ?? "", Coverage: stated.Coverage ?? "", "As of": stated["As of"] ?? "" };
}
function periodOfFacts(facts: SnapshotFacts): { readonly from: string; readonly to: string } {
  const match = /^(\S+) to (\S+)$/u.exec(facts.Period);
  if (match === null) throw new Error(`The period fact states ${JSON.stringify(facts.Period)} rather than two calendar days, so no period is compared.`);
  return { from: match[1] ?? "", to: match[2] ?? "" };
}
function asOfOfFacts(facts: SnapshotFacts): string {
  const match = /^As of (\S+)/u.exec(facts["As of"]); // The instant an as-of fact states, without the sentence that explains it.
  if (match === null) throw new Error(`The as-of fact states ${JSON.stringify(facts["As of"])} without the instant it was read at, so no snapshot is identified.`);
  return match[1] ?? "";
}
function coverageStateOfFacts(facts: SnapshotFacts): string {
  const match = /^Coverage is (\w+)/u.exec(facts.Coverage);
  if (match === null) throw new Error(`The coverage fact states ${JSON.stringify(facts.Coverage)} without a coverage state, so partial coverage could not be told from complete.`);
  return match[1] ?? "";
}
function expectSameSnapshot(facts: SnapshotFacts, subject: string, expected: SnapshotFacts): void {
  expect(periodOfFacts(facts), `${subject} states the period the other artifacts state.`).toEqual(periodOfFacts(expected)); // Asserts one artifact's snapshot statement carries the same period, coverage state and as-of instant as the query's own report states.
  expect(coverageStateOfFacts(facts), `${subject} states the coverage state the other artifacts state.`).toBe(coverageStateOfFacts(expected));
  expect(asOfOfFacts(facts), `${subject} states the snapshot instant the other artifacts state.`).toBe(asOfOfFacts(expected));
}
const DOWNLOAD_TIMEOUT_MS = 60_000; // How long one export has to produce its file, so a download that never arrives fails as itself rather than as the test's deadline.
async function downloadCsv(page: Page): Promise<CsvFile> {
  const button = page.getByRole("button", { name: "Export the whole query as CSV" }); // Downloads the whole query as a CSV file and parses it, through the surface's own export action.
  await expect(button, "The report offers the whole-query export in this scope.").toBeEnabled();
  const waiting = page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS });
  await button.click();
  const download = await waiting;
  const text = await csvTextOf(download);
  return csvFileOf(text, `The CSV ${download.suggestedFilename()}`);
}
async function asPrinted<T>(page: Page, read: (printed: Locator) => Promise<T>): Promise<T> {
  await page.emulateMedia({ media: "print" }); // Reads a report's printed page as the browser prints it: the medium is switched to print, read, and restored.
  try {
    const printed = page.locator("[data-print-report]");
    await expect(printed, "The report renders the page a browser prints from the same result.").toBeVisible();
    return await read(printed);
  } finally {
    await page.emulateMedia({ media: "screen" });
  }
}
type PrintedPage = { readonly facts: SnapshotFacts; readonly summaryAmount: StatedAmount; readonly rowsStated: number; readonly rows: number; readonly rowAmounts: readonly number[]; readonly about: string };
const readPrintedPage = (page: Page, withAmounts = false): Promise<PrintedPage> =>
  asPrinted(page, async (region) => {
    const facts = await snapshotFactsOf(page, "print");
    const summaryLine = region
      .locator("li")
      .filter({ hasText: `Received support (${CURRENCY})` })
      .first();
    await expect(summaryLine, "The printed page states its per-currency summary line.").toBeVisible();
    const about = (await region.innerText()).replace(/\s+/gu, " ");
    return {
      facts,
      summaryAmount: statedAmountOf(await summaryLine.innerText(), "The printed page's summary line"),
      rowsStated: countOf(/Rows in this result:\s+([\d,]+)/u.exec(about)?.[1] ?? "", "The row total the printed page states"),
      rows: await region.locator("table tbody tr").count(),
      rowAmounts: withAmounts ? await printedColumnAmounts(region, "amount") : [],
      about,
    };
  });
const firstGiftLink = (page: Page): Locator => page.getByRole("link", { name: /^Open gift /u }).first();
const fileMinorUnitsOf = (file: CsvFile, subject: string): number =>
  sumOf(
    file.rows.map((row, index) => rowMinorUnitsOf(file, row, index)),
    subject,
  );
test.use({ persona: "established-worker" }); // This file acts as the established worker throughout, which is the persona the runner admits the context as.; Every test starts from the deterministic seed.
async function exportedQueryOf(page: Page, href: string): Promise<CsvFile> {
  await openReport(page, href, "Received support"); // Opens one of the fixed reports and downloads the whole query it states, through that report's own export action.
  return downloadCsv(page);
}
function fingerprintOf(file: CsvFile): { readonly minorUnits: number; readonly giftIds: readonly string[] } {
  const amounts = file.rows.map((row, index) => rowMinorUnitsOf(file, row, index)); // The exact minor-unit sum of a parsed export together with the identities of the gifts it holds, in the one order two files can be compared by.
  const giftIds = file.rows.map((row) => row["gift_id"] ?? "").sort();
  return { minorUnits: sumOf(amounts, "The export's rows"), giftIds };
}
test("one query, one snapshot: the screen, the chart, the table, a matrix drilldown, the CSV and the print all state the same figures", async ({ page }) => {
  const query = `from=${SNAPSHOT_FROM}&to=${SNAPSHOT_TO}&currency=${CURRENCY}`;
  await page.goto(`${GIFTS_HREF}?${query}`); // --- the screen artifact: the ledger's whole result, and the rows it rendered for it.
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const ledgerFacts = await snapshotFactsOf(page, "screen");
  expect(ledgerFacts.Basis, "The screen states the one named received-support basis.").toContain("effective_cash_allocation");
  expect(ledgerFacts.Grain, "The screen states the grain a row is counted at.").toContain("One row is one authorised allocation");
  expect(ledgerFacts.Currencies, "The screen states the one currency partition the query was read in.").toBe(CURRENCY);
  expect(periodOfFacts(ledgerFacts), "The ledger states the civil year the query names as its own period.").toEqual({ from: SNAPSHOT_FROM, to: SNAPSHOT_TO });
  expect(coverageStateOfFacts(ledgerFacts), "The source's coverage of this period is partial, and the screen states it as partial.").toBe("partial");
  const ledgerFigure = wholeResultAmountOf(await readWholeResult(page), CURRENCY);
  expect(ledgerFigure.statement, "A figure read under partial coverage is labelled an incomplete subtotal, in text rather than by colour.").toMatch(INCOMPLETE_MARKER);
  const wholeRows = await listTotalOf(page, "gifts");
  const rowsOnPage = await readRenderedRows(page, "Received gifts");
  expect(rowsOnPage, "The whole result fits one page for this query, so the rows on screen are the whole result.").toBe(wholeRows);
  const ledgerTable = page.getByRole("table", { name: "Received gifts" });
  const rowAmounts: number[] = [];
  const rowGiftIds: string[] = [];
  for (let index = 0; index < rowsOnPage; index += 1) {
    const row = ledgerTable.locator("tbody tr").nth(index);
    const amount = statedAmountOf(await row.innerText(), `Row ${String(index)} of the ledger`);
    expect(amount.currency, `Row ${String(index)} of the ledger states its amount in the one currency the query selected.`).toBe(CURRENCY);
    rowAmounts.push(amount.minorUnits);
    const label = await row.getByRole("link", { name: GIFT_LINK_LABEL }).getAttribute("aria-label");
    const gift = GIFT_LINK_LABEL.exec(label ?? "");
    if (gift === null) throw new Error(`Row ${String(index)} of the ledger names the gift it opens as ${JSON.stringify(label)}, which is not the identity this file reads. The row and the file's records would then be compared without knowing they are the same records.`);
    rowGiftIds.push(gift[1] ?? "");
  }
  expect(sumOf(rowAmounts, "The ledger's rendered rows"), "The rows on the page sum to the whole-result figure the same screen states, because for this query they are the whole result.").toBe(ledgerFigure.amount.minorUnits);
  await page.goto(`${RECEIVED_REPORT_HREF}?${query}`); // --- the report screen: the same figure, from the same query, on the same snapshot.
  await expect(page.getByRole("heading", { name: "Received support", level: 1 })).toBeVisible();
  const reportFacts = await snapshotFactsOf(page, "screen");
  expectSameAmount(statedAmountOf(await factOf(page.locator('[data-slot="report-screen"]'), "Received in the period"), "The report's received-support figure"), ledgerFigure.amount, "The report states the same received support the ledger's whole-result figure states, in exact minor units.");
  expectSameSnapshot(reportFacts, "The report", ledgerFacts);
  const csv = await downloadCsv(page); // --- the CSV artifact: the whole query, on the same snapshot.
  const subject = "The one-snapshot export";
  const metadata: readonly (readonly [string, string, string])[] = [
    [CSV_FIELD.grain, "gift-allocation", "The file states the grain of the rows it holds."],
    [CSV_FIELD.currency, CURRENCY, "The file states the currency partition of the query."],
    [CSV_FIELD.coverageState, coverageStateOfFacts(reportFacts), "The file states the coverage state the screens state."],
    [CSV_FIELD.snapshotAsOf, asOfOfFacts(reportFacts), "The file states the snapshot instant the screens state."],
    [CSV_FIELD.amountUnit, "minor-units", "The file states that its amounts are exact minor units, so no reader has to guess an exponent."],
    [CSV_FIELD.page, "whole-query", "The file is the whole query rather than one page of it."],
  ];
  for (const [field, stated, why] of metadata) expect(metadataOf(csv, field, subject), why).toBe(stated);
  expect(metadataOf(csv, CSV_FIELD.basis, subject), "The file states the one named basis its figures are measured on.").toContain("effective_cash_allocation");
  expect({ from: metadataOf(csv, CSV_FIELD.periodFrom, subject), to: metadataOf(csv, CSV_FIELD.periodTo, subject) }, "The file states the period the two screens state.").toEqual(periodOfFacts(reportFacts));
  const csvTotal = countOf(metadataOf(csv, CSV_FIELD.rowTotal, subject), "The row total the file states");
  expect(csvTotal, "The file's own row total is the whole-result count the ledger's pager states.").toBe(wholeRows);
  expect(csv.rows.length, "Every authorised row of the query is in the file, so its records match its row total.").toBe(csvTotal);
  const fileMinorUnits = fileMinorUnitsOf(csv, "The file's rows");
  expect(fileMinorUnits, "The file's rows sum to the same minor units the ledger states.").toBe(ledgerFigure.amount.minorUnits);
  expect([...new Set(csv.rows.map((row) => row["gift_id"] ?? ""))].sort(), "The file's gifts are exactly the gifts the ledger's own rows name, so the table and the file are the same records.").toEqual([...new Set(rowGiftIds)].sort());
  // --- the print artifact: the same report, printed from the same navigation.
  const printed = await readPrintedPage(page, true);
  expectSameSnapshot(printed.facts, "The printed page", reportFacts);
  expectSameAmount(printed.summaryAmount, ledgerFigure.amount, "The printed page's summary states the same received support the screen's whole-result figure states.");
  expect(printed.rowsStated, "The printed page states the whole query's row count beside the rows it printed.").toBe(wholeRows);
  expect(printed.rows, "The printed page holds every row of the query, because the whole result fits one page.").toBe(wholeRows);
  expect(printed.rowAmounts.length, "Every printed row states its amount, so the sheet's own rows can be summed.").toBe(wholeRows);
  expect(sumOf(printed.rowAmounts, "The printed page's rows"), "The printed page's rows sum to the same minor units the screen, the file and the chart state.").toBe(ledgerFigure.amount.minorUnits);
  expect(printed.about, "The printed page says it holds every authorised row of the query rather than a window of it.").toContain("every authorised row of the query");
  await page.goto(`${HISTORY_REPORT_HREF}?year=${String(SNAPSHOT_YEAR)}&currency=${CURRENCY}`); // --- the chart artifact: the year's monthly series, read from its data table.
  await expect(page.getByRole("heading", { name: "Monthly history", level: 1 })).toBeVisible();
  expectSameSnapshot(await snapshotFactsOf(page, "screen"), "The chart", reportFacts);
  const chartMonths = await chartMonthsOf(page);
  const statedMonths = chartMonths.filter((month) => month.amount !== undefined);
  expect(statedMonths.length, "Some month of the year records a value, so the series is a figure and not only gaps.").toBeGreaterThan(0);
  const chartMinorUnits = sumOf(
    statedMonths.map((month) => month.amount ?? 0),
    "The chart's stated months",
  );
  expect(chartMinorUnits, "The chart's stated months sum to the same amount the screen, the file and the sheet state.").toBe(ledgerFigure.amount.minorUnits);
  await page.goto(`${MATRIX_REPORT_HREF}?${query}`); // --- the matrix artifact: the same query at a second grain.
  await expect(page.getByRole("heading", { name: "Partners by month", level: 1 })).toBeVisible();
  const matrixFacts = await snapshotFactsOf(page, "screen");
  expectSameSnapshot(matrixFacts, "The matrix", reportFacts);
  const cells = await matrixCellsOf(page);
  const chartStarts = new Set(chartMonths.map((month) => month.start));
  for (const [index, cell] of cells.entries()) {
    expect(cell.amount.currency, `Matrix cell ${String(index)} states its amount in the one currency the query selected.`).toBe(CURRENCY);
    expect(chartStarts.has(drilldownPeriodOf(cell.href, `Matrix cell ${String(index)}`).from), `Matrix cell ${String(index)} belongs to a month the chart states, so the two grains cover the same months.`).toBe(true);
  }
  for (const month of chartMonths) {
    const naming = cells.filter((cell) => drilldownPeriodOf(cell.href, `The cell naming ${month.start}`).from === month.start);
    if (month.amount === undefined) {
      expect(naming.length, `The chart states no recorded value for ${month.start}, and the matrix states no cell for it either: a gap is a gap at both grains.`).toBe(0);
      continue;
    }
    expect(naming.length, `The chart states a point for ${month.start}, so the matrix states at least one cell for it.`).toBeGreaterThan(0);
    const monthMinorUnits = sumOf(
      naming.map((cell) => cell.amount.minorUnits),
      `The cells for ${month.start}`,
    );
    expect(monthMinorUnits, `The matrix's cells that name ${month.start} sum to the chart's point for it.`).toBe(month.amount);
  }
  const matrixMinorUnits = sumOf(
    cells.map((cell) => cell.amount.minorUnits),
    "The matrix's cells",
  );
  expect(matrixMinorUnits, "Every stated cell together sums to the same amount the screen, the file and the chart state.").toBe(ledgerFigure.amount.minorUnits);
  const drilldown = cells[0]; // --- the drilldown: one cell's own link, narrowing the same snapshot.
  if (drilldown === undefined) throw new Error("The matrix stated no cell to drill into, so no drilldown was compared and the sixth artifact of the criterion is unproven here.");
  const drilldownPeriod = drilldownPeriodOf(drilldown.href, "The matrix cell this journey drills");
  await page.locator('[data-slot="report-matrix"] table a').first().click();
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const drilledFacts = await snapshotFactsOf(page, "screen");
  const drilledFigure = wholeResultAmountOf(await readWholeResult(page), CURRENCY);
  expectSameAmount(drilledFigure.amount, drilldown.amount, "The drilled query's whole-result figure is the cell's own amount, in exact minor units.");
  const drilledRows = await listTotalOf(page, "gifts");
  const drilledOnPage = await readRenderedRows(page, "Received gifts");
  expect(drilledOnPage, "The drilled query's whole result fits one page, so the rows on screen are the rows behind the cell.").toBe(drilledRows);
  const drilledTable = page.getByRole("table", { name: "Received gifts" });
  const drilledAmounts: number[] = [];
  for (let index = 0; index < drilledOnPage; index += 1) drilledAmounts.push(statedAmountOf(await drilledTable.locator("tbody tr").nth(index).innerText(), `Row ${String(index)} of the drilled ledger`).minorUnits);
  expect(sumOf(drilledAmounts, "The drilled ledger's rows"), "The drilled rows themselves sum to the cell's figure, which is the whole-result figure of the drilled query.").toBe(drilldown.amount.minorUnits);
  expect(periodOfFacts(drilledFacts), "The drilled query states the cell's month as two civil days.").toEqual(drilldownPeriod);
  expect(drilledFacts.Basis, "The drilled query is measured on the same named basis as the matrix.").toBe(matrixFacts.Basis);
  expect(drilledFacts.Grain, "The drilled query is counted at the same grain as the matrix.").toBe(matrixFacts.Grain);
  expect(coverageStateOfFacts(drilledFacts), "The drilled query carries the same coverage state as the matrix.").toBe(coverageStateOfFacts(matrixFacts));
  expect(asOfOfFacts(drilledFacts), "The drilled query carries the same as-of instant as the matrix.").toBe(asOfOfFacts(matrixFacts));
  recordEvidence(
    "criterion-1 one snapshot",
    `${query}: ${String(wholeRows)} rows and ${String(ledgerFigure.amount.minorUnits)} ${CURRENCY} minor units as of ${asOfOfFacts(ledgerFacts)}, agreed by the ledger's whole-result figure and its ${String(rowsOnPage)} rows, the report screen, the CSV (${String(csv.rows.length)} records), the printed page (${String(printed.rows)} rows), the chart's ${String(statedMonths.length)} stated months and ${String(chartMonths.length - statedMonths.length)} gaps, the matrix's ${String(cells.length)} cells, and the drilled ledger of the first cell (${String(drilledRows)} rows of ${String(drilldown.amount.minorUnits)}).`,
  );
});
test("the whole query agrees between the screen, the CSV and the printed page, beyond the loaded page", async ({ page }) => {
  ensureWorkload();
  await openReport(page, `${GIFTS_HREF}?period=this-year&currency=${CURRENCY}`, "Received gifts"); // --- the screen artifact: the ledger's whole-result figure for one currency --------------------
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  const ledgerFacts = await snapshotFactsOf(page, "screen");
  expect(ledgerFacts.Basis, "The screen states the one named received-support basis.").toContain("effective_cash_allocation");
  expect(ledgerFacts.Grain, "The screen states the grain a row is counted at.").toContain("One row is one authorised allocation");
  expect(ledgerFacts.Currencies, "The screen states the currency partition the whole query was read in.").toBe(CURRENCY);
  const ledgerFigure = wholeResultAmountOf(await readWholeResult(page), CURRENCY);
  const wholeRows = await listTotalOf(page, "gifts");
  const rowsOnPage = await readRenderedRows(page, "Received gifts");
  expect(wholeRows, "The filtered query holds more rows than one page does, which is what makes completeness beyond the page checkable.").toBeGreaterThan(PAGE_SIZE_DEFAULT);
  expect(rowsOnPage, "The ledger renders one page of the query rather than the whole result.").toBe(PAGE_SIZE_DEFAULT);
  expect(coverageStateOfFacts(ledgerFacts), "The source's coverage of this period is partial, and the screen states it as partial.").toBe("partial");
  expect(ledgerFigure.statement, "A figure read under partial coverage is labelled an incomplete subtotal, in text rather than by colour.").toMatch(INCOMPLETE_MARKER);
  await expect(page.locator('[data-slot="whole-result-summary"]'), "The summary states that the currencies are never added together.").toContainText("no combined total is stated");
  expect(ledgerFigure.giftCount, "The gift count is counted at the gift's own grain.").toBeLessThanOrEqual(wholeRows);
  await openReport(page, `${RECEIVED_REPORT_HREF}?period=this-year&currency=${CURRENCY}`, "Received support"); // --- the report artifact: the same figure, from the same query, on the report surface -------------
  const reportFacts = await snapshotFactsOf(page, "screen");
  const reportScreen = page.locator('[data-slot="report-screen"]');
  expectSameAmount(statedAmountOf(await factOf(reportScreen, "Received in the period"), "The report's received-support figure"), ledgerFigure.amount, "The report states the same received support the ledger's whole-result figure states, in minor units.");
  await expect(reportScreen.getByRole("alert").first(), "The report states its partial coverage above the figures it qualifies, in text.").toContainText(PARTIAL_COVERAGE_OPENING);
  expect(countOf(ROWS_IN_FILE.exec((await page.locator('[data-slot="export-print-actions"]').innerText()).replace(/\s+/gu, " "))?.[1] ?? "", "The rows the export action states the file will hold"), "The export action states the whole query's row count, not the loaded page's.").toBe(wholeRows);
  expectSameSnapshot(reportFacts, "The report", ledgerFacts);
  const csv = await downloadCsv(page); // --- the CSV artifact ---------------------------------------------------------------------------
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
      } else if (!isInert(cell)) formulaOpeningCells += 1;
    }
  }
  expect([...currenciesInFile], "Every row of the file belongs to the one currency the query selected, so no amount in it is compared across currencies.").toEqual([CURRENCY]);
  expect(formulaOpeningCells, "No field of the file can open a spreadsheet formula: each formula-opening cell carries the writer's neutralising tab.").toBe(0);
  expect(neutralisedCells, "The query itself contains rows whose text opens with a formula character (a refund states a negative amount), so the neutralisation check above is not vacuous.").toBeGreaterThan(0);
  const csvSum = sumOf(rowAmounts, "The file's rows");
  expectSameAmount({ currency: CURRENCY, minorUnits: csvSum }, ledgerFigure.amount, "The file's rows sum to the whole-result figure the screen states, in exact minor units.");
  expect(giftIdsInFile.size, "The gift count the screen states is the number of distinct gifts in the file, never the file's row count: the two grains are counted apart.").toBe(ledgerFigure.giftCount);
  for (const [index, row] of csv.rows.slice(0, 5).entries()) {
    expectSameAmount(statedAmountOf(withoutNeutraliser(row["amount"] ?? ""), `The formatted amount of row ${String(index)}`), { currency: CURRENCY, minorUnits: rowMinorUnitsOf(csv, row, index) }, `Row ${String(index)} states one amount in its formatted and in its minor-unit column.`);
  }
  const printed = await readPrintedPage(page); // --- the print artifact -------------------------------------------------------------------------
  expect(printed.facts.Basis, "The printed page states the one named basis.").toContain("effective_cash_allocation");
  expect(printed.facts.Grain, "The printed page states the grain.").toContain("One row is one authorised allocation");
  expect(printed.facts.Currencies, "The printed page states the currency partition.").toBe(CURRENCY);
  expectSameSnapshot(printed.facts, "The printed page", reportFacts);
  expectSameAmount(printed.summaryAmount, ledgerFigure.amount, "The printed page's summary states the same received support the screen's whole-result figure states.");
  expect(printed.rowsStated, "The printed page states the whole query's row count beside the page it printed.").toBe(wholeRows);
  expect(printed.rows, "The printed page holds the page the screen loaded, and never pretends that page is the query.").toBe(PAGE_SIZE_DEFAULT);
  expect(printed.about, "The printed page says in words that it holds one page of the query.").toContain("one page of the query");
  expect(printed.about, "The printed page explains how to obtain the complete result.").toContain("export the CSV for the complete result");
  expect(printed.about, "The printed page names the shortfall between the page it holds and the query's rows.").toContain(`This view shows ${String(PAGE_SIZE_DEFAULT)} of ${String(wholeRows)} rows`);
  expect(printed.about, "The printed page states its partial coverage in text.").toContain(PARTIAL_COVERAGE_OPENING);
  recordEvidence(
    "criterion-1 filtered Gifts query",
    `period=this-year currency=${CURRENCY}: ${String(wholeRows)} rows, ${String(ledgerFigure.amount.minorUnits)} ${CURRENCY} minor units, ${String(ledgerFigure.giftCount)} gifts; agreed by the ledger summary, the report screen, the CSV (${String(csv.rows.length)} records) and the printed page (${String(printed.rows)} rows of ${String(printed.rowsStated)}).`,
  );
});
test("the whole-query values do not move when the order and the page do", async ({ page }) => {
  ensureWorkload();
  const ledgerHref = `${GIFTS_HREF}?period=this-year&currency=${CURRENCY}`;
  await openReport(page, ledgerHref, "Received gifts");
  const before = wholeResultAmountOf(await readWholeResult(page), CURRENCY);
  const rowsBefore = await listTotalOf(page, "gifts");
  const firstGiftBefore = await firstGiftLink(page).getAttribute("aria-label");
  const unsorted = await exportedQueryOf(page, `${RECEIVED_REPORT_HREF}?period=this-year&currency=${CURRENCY}`);
  const unsortedPrint = fingerprintOf(unsorted);
  await openReport(page, ledgerHref, "Received gifts"); // The same query, ordered by amount: the surface dispatches the order to the service rather than sorting the page in the browser, so the order that comes back is the whole result's.
  const firstGiftUnsorted = await firstGiftLink(page).getAttribute("aria-label");
  const firstRowBeforeSort = (await page.getByRole("table", { name: "Received gifts" }).locator("tbody tr").first().innerText()).replace(/\s+/gu, " ").trim();
  await page.getByRole("button", { name: "Amount", exact: true }).click();
  await expect(page, "The amount heading dispatches the order to the service, where the whole result is ordered.").toHaveURL(/sortField=amountMinor/u);
  await expect.poll(async () => (await page.getByRole("table", { name: "Received gifts" }).locator("tbody tr").first().innerText()).replace(/\s+/gu, " ").trim(), { message: "The order the service applied replaces the rows on screen before the figures below are read." }).not.toBe(firstRowBeforeSort);
  expect(await firstGiftLink(page).getAttribute("aria-label"), "The order changed the rows, which is what makes the invariance below a claim about the figures rather than about nothing having happened.").not.toBe(firstGiftUnsorted);
  expect(firstGiftBefore, "The ledger's first row is the same before and after a re-read at the same order.").toBe(firstGiftUnsorted);
  const sortedFigures = await readWholeResult(page);
  expectSameAmount(wholeResultAmountOf(sortedFigures, CURRENCY).amount, before.amount, "Ordering the result changes no amount: the figure is the whole query's, not the page's.");
  expect(wholeResultAmountOf(sortedFigures, CURRENCY).giftCount, "Ordering the result changes no gift count.").toBe(before.giftCount);
  expect(await listTotalOf(page, "gifts"), "Ordering the result changes no row count.").toBe(rowsBefore);
  const sorted = await exportedQueryOf(page, `${RECEIVED_REPORT_HREF}?period=this-year&currency=${CURRENCY}&sortField=amountMinor&sortDirection=asc`);
  const sortedPrint = fingerprintOf(sorted);
  expect(sorted.metadata.get(CSV_FIELD.rowTotal), "Both files state the same row total.").toBe(unsorted.metadata.get(CSV_FIELD.rowTotal));
  expect(sortedPrint.minorUnits, "The same rows sum to the same minor units whatever order they are in.").toBe(unsortedPrint.minorUnits);
  expect(sortedPrint.giftIds.length, "Both files hold the same number of rows.").toBe(unsortedPrint.giftIds.length);
  expect(sortedPrint.giftIds.join(","), "The same gifts are in both files, whatever order the rows are in.").toBe(unsortedPrint.giftIds.join(","));
  expect(sortedPrint.minorUnits, "The exported sum is the screen's whole-result figure in both orders.").toBe(before.amount.minorUnits);
  expect(sorted.rows[0]?.["gift_row_id"], "The file's own order followed the query's, so the two files are not the same sequence of records.").not.toBe(unsorted.rows[0]?.["gift_row_id"]);
  await page.goto(`${ledgerHref}&page=1&pageSize=${String(PAGE_SIZE_CAP)}`);
  await expect(page, "The window and the cap are stated in the address, so the page read is the one asked for.").toHaveURL(new RegExp(`page=1&pageSize=${String(PAGE_SIZE_CAP)}`, "u"));
  await expect(page.getByRole("table", { name: "Received gifts" }).locator("tbody tr"), "The 200-row cap is the largest page the list offers, and it is still a page of the result.").toHaveCount(200);
  expect(await listTotalOf(page, "gifts"), "A page window changes no row count: the pager still states the whole result.").toBe(rowsBefore);
  const windowed = await readWholeResult(page);
  expectSameAmount(wholeResultAmountOf(windowed, CURRENCY).amount, before.amount, "A page window changes no amount: the figure is the whole query's.");
  expect(wholeResultAmountOf(windowed, CURRENCY).giftCount, "A page window changes no gift count.").toBe(before.giftCount);
  await page.getByLabel("Rows per page").selectOption(String(PAGE_SIZE_DEFAULT));
  await expect(page.getByRole("table", { name: "Received gifts" }).locator("tbody tr"), "Returning to the default page size renders the default page again.").toHaveCount(PAGE_SIZE_DEFAULT);
  expect(await listTotalOf(page, "gifts"), "Returning the page size to its default changes no row count.").toBe(rowsBefore);
  expectSameAmount(wholeResultAmountOf(await readWholeResult(page), CURRENCY).amount, before.amount, "Returning the page size to its default changes no amount.");
  recordEvidence(
    "criterion-1 invariance",
    `period=this-year currency=${CURRENCY}: ${String(rowsBefore)} rows and ${String(before.amount.minorUnits)} ${CURRENCY} minor units in the unsorted, the amount-ordered and the second-page-of-200 readings; two exports of ${String(unsorted.rows.length)} records each agree in sum and in gift identity while their first records differ.`,
  );
});
test("an amount range is offered only inside one currency, and the currencies stay apart", async ({ page }) => {
  await openReport(page, `${GIFTS_HREF}?period=this-year`, "Received gifts");
  await expect(page.getByRole("button", { name: "Amount range, unavailable" }), "With every currency selected the amount range is stated as unavailable rather than offered as a filter that would compare amounts across currencies.").toBeVisible(); // --- while the query selects every currency, the range states that it cannot be applied -----------
  await expect(page.locator('[data-slot="query-toolbar"]'), "The reason the range cannot be applied is stated in text, so it is not carried by a disabled look alone.").toContainText("Amount range:");
  await expect(page.locator('[data-slot="query-toolbar"]'), "The reason names the rule: an amount range spans one currency's minor units.").toContainText("one currency");
  const allCurrencies = await readWholeResult(page); // --- the currencies are stated apart, and a row whose currency is unknown is not a zero -----------
  const currencyNames = allCurrencies.map((line) => line.currency).sort();
  expect(currencyNames.length, "The seed holds received support in more than one currency, which is what makes the single-currency rule worth asserting.").toBeGreaterThan(1);
  expect(currencyNames, "The two-decimal, three-decimal, zero-decimal and never-identified currencies are each stated on their own line: nothing is added across them.").toEqual(expect.arrayContaining([CURRENCY, "KWD", "JPY", "UNKNOWN"]));
  const unidentified = allCurrencies.find((line) => line.currency === "UNKNOWN");
  expect(unidentified, "The source's row whose currency it never identified is stated as its own currency partition.").toBeDefined();
  expect(unidentified?.kind, "A row whose currency the source never identified cannot be summed, so its partition states a state rather than a number.").toBe("state");
  if (unidentified?.kind === "state") expect(unidentified.word, "The unidentified partition states an unknown amount, never a zero: a zero would claim the source recorded nothing.").toBe("Unknown amount");
  const unfilteredRows = await listTotalOf(page, "gifts");
  const unfilteredAmount = wholeResultAmountOf(allCurrencies, CURRENCY);
  const unfilteredPager = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim();
  await page.getByRole("combobox", { name: "Currency" }).click(); // --- one currency makes the range available ------------------------------------------------------
  await page.getByRole("option", { name: new RegExp(`^${CURRENCY}`, "u") }).click();
  await expect(page, "Choosing one currency is a query the address states, so the view can be returned to.").toHaveURL(new RegExp(`currency=${CURRENCY}`, "u"));
  await expect(page.getByRole("button", { name: "Amount range, unavailable" }), "With exactly one currency selected the range is offered, because a range then compares one currency's minor units.").toHaveCount(0);
  await expect(page.getByRole("list", { name: "Selected filters" }), "The applied filters are stated on screen, so the query this view states is readable without decoding the address.").toContainText(`Currency: ${CURRENCY}`);
  await expect.poll(async () => (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim(), { message: "The narrowed query replaces the count the wider one stated, so the readings below describe the result on screen." }).not.toBe(unfilteredPager);
  const singleCurrencyPager = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim();
  await page.getByRole("combobox", { name: "Amount range" }).click(); // --- a band inside that currency narrows the result to amounts it can compare ---------------------
  await page.getByRole("option", { name: `Under 100 ${CURRENCY}` }).click();
  await expect(page, "The applied band is stated in the address as the minor units it compares, so a reload reads the same rows.").toHaveURL(/amountMin=0&amountMax=9999/u);
  await expect(page.getByRole("list", { name: "Selected filters" }), "The range is stated as an applied filter beside the currency and the period.").toContainText(`Amount range: Under 100 ${CURRENCY}`);
  await expect.poll(async () => (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim(), { message: "The ranged query replaces the count the single-currency query stated, so the readings below describe the narrowed result." }).not.toBe(singleCurrencyPager);
  const rangedAmount = wholeResultAmountOf(await readWholeResult(page), CURRENCY);
  const rangedRows = await listTotalOf(page, "gifts");
  expect(rangedRows, "The band narrows the whole result, so its row count is smaller than the query without it.").toBeLessThanOrEqual(unfilteredRows);
  expect(rangedAmount.amount.minorUnits, "The band narrows the whole result's figure, so its amount is no larger than the query without it.").toBeLessThanOrEqual(unfilteredAmount.amount.minorUnits);
  expect(rangedAmount.amount.minorUnits, "A band from zero upward holds no negative amount, so its whole-result figure cannot be negative.").toBeGreaterThanOrEqual(0);
  const rendered = await readRenderedRows(page, "Received gifts"); // Every row the band narrowed to states an amount inside it, and the rows on this one page sum to the whole-result figure the same screen states — the agreement the ledger is read against, at one grain.
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
  await page.getByRole("button", { name: `Remove this filter: Currency: ${CURRENCY}` }).click(); // --- the selection stops naming one currency, so the range is dropped rather than kept silently --- Removing the applied currency through its own chip is the surface's affordance for clearing a filter; the single-select picker offers no way to state "no choice" other than removing what it
  await expect(page.getByRole("button", { name: "Amount range, unavailable" }), "Once the selection no longer names one currency the range states again that it cannot be applied, rather than comparing currencies.").toBeVisible();
  await expect(page.getByRole("list", { name: "Selected filters" }), "The dropped range is gone from the applied filters, so no invisible filter narrows the result.").not.toContainText("Amount range:");
  await expect(page, "The dropped range is gone from the address too, so a reload cannot reinstate a comparison across currencies.").not.toHaveURL(/amountMin/u);
  await expect.poll(async () => await page.locator('[data-slot="whole-result-summary"] li').count(), { message: "With every currency selected the summary states each currency on its own line again, once the widened read answers." }).toBeGreaterThan(1);
  const afterClearing = await readWholeResult(page);
  expect(afterClearing.length, "With every currency selected the summary states each currency apart again.").toBeGreaterThan(1);
  expect(wholeResultAmountOf(afterClearing, CURRENCY).amount, "Clearing the range and the currency restores the figure the query stated before either was applied.").toEqual(unfilteredAmount.amount);
  recordEvidence(
    "criterion-1 single-currency rule",
    `The range facet is unavailable while ${String(currencyNames.length)} currencies are selected and available once ${CURRENCY} alone is; the band Under 100 ${CURRENCY} narrowed the whole result to ${String(rangedRows)} rows summing to ${String(rangedAmount.amount.minorUnits)} ${CURRENCY} minor units, and clearing the currency dropped the range.`,
  );
});
test("the chart's monthly series sums to the figure the screen, the CSV and the printed page state", async ({ page }) => {
  ensureWorkload();
  const yearFrom = `${String(HISTORY_YEAR)}-01-01`;
  const yearTo = `${String(HISTORY_YEAR)}-12-31`;
  await openReport(page, `${HISTORY_REPORT_HREF}?year=${String(HISTORY_YEAR)}&currency=${CURRENCY}`, "Monthly history"); // --- the chart artifact: the series' accessible data table, not the picture ----------------------
  const figure = page.locator('[data-slot="chart-figure"]').first();
  await expect(figure, "The report draws its monthly series inside the one chart pattern.").toBeVisible();
  const caption = (await figure.locator("figcaption").innerText()).replace(/\s+/gu, " ");
  for (const text of [`Amounts are in ${CURRENCY}`, "Coverage: partial", "As of"]) expect(caption, "The chart states its unit, its coverage and the instant it was read at, so a partial year is not read as a total.").toContain(text);
  const chartMonths = await chartMonthsOf(page);
  const gapMonths = chartMonths.filter((month) => month.amount === undefined).map((month) => month.start);
  const plottedAmounts = chartMonths.filter((month) => month.amount !== undefined).map((month) => month.amount ?? 0);
  const gapMonthLabels = gapMonths.map((month) => month.slice(0, ABSENT_MONTH.length));
  expect(gapMonthLabels, "The one month the source records nothing in is stated as a gap, and no other month is.").toEqual([ABSENT_MONTH]);
  expect(gapMonths, "The gap states the civil day its month begins on, so the month cannot be mistaken for another.").toEqual([`${ABSENT_MONTH}-01`]);
  const seriesSum = sumOf(plottedAmounts, "The chart's twelve monthly points");
  await openReport(page, `${RECEIVED_REPORT_HREF}?from=${yearFrom}&to=${yearTo}&currency=${CURRENCY}`, "Received support"); // --- the screen artifact: the same query stated as one figure ------------------------------------
  const facts = await snapshotFactsOf(page, "screen");
  expect(periodOfFacts(facts), "The report covers exactly the year the chart's series covers.").toEqual({ from: yearFrom, to: yearTo });
  const screenAmount = statedAmountOf(await factOf(page.locator('[data-slot="report-screen"]'), "Received in the period"), "The report's received-support figure for the year");
  expectSameAmount({ currency: CURRENCY, minorUnits: seriesSum }, screenAmount, "The chart's monthly points sum to the figure the screen states for the same period, in exact minor units.");
  const csv = await downloadCsv(page); // --- the CSV artifact: the whole query, summed from the column that states minor units ------------
  expect(metadataOf(csv, CSV_FIELD.page, "The year's export"), "The file is the whole query rather than a page of it.").toBe("whole-query");
  expect({ from: metadataOf(csv, CSV_FIELD.periodFrom, "The year's export"), to: metadataOf(csv, CSV_FIELD.periodTo, "The year's export") }, "The file states the year the chart and the screen state.").toEqual({ from: yearFrom, to: yearTo });
  expect(countOf(metadataOf(csv, CSV_FIELD.rowTotal, "The year's export"), "The year's export row total"), "The file's records are the whole query's rows.").toBe(csv.rows.length);
  const csvSum = fileMinorUnitsOf(csv, "The year's exported rows");
  expect(csvSum, "The file's rows sum to the same minor units the chart's points and the screen's figure state.").toBe(seriesSum);
  const printed = await readPrintedPage(page); // --- the print artifact -------------------------------------------------------------------------
  expect(periodOfFacts(printed.facts), "The printed page states the year the chart, the screen and the file state.").toEqual({ from: yearFrom, to: yearTo });
  expectSameAmount(printed.summaryAmount, { currency: CURRENCY, minorUnits: seriesSum }, "The printed page's summary states the same figure the chart's points sum to.");
  recordEvidence("criterion-1 chart agreement", `${String(HISTORY_YEAR)} ${CURRENCY}: eleven stated months plus the gap at ${ABSENT_MONTH} sum to ${String(seriesSum)} minor units, which the report screen, the export (${String(csv.rows.length)} records) and the printed summary all state.`);
});
test("one figure at three grains: the matrix cell, the rows it narrows to and the report it belongs to", async ({ page }) => {
  await openReport(page, `${MATRIX_REPORT_HREF}?period=this-year&currency=${CURRENCY}`, "Partners by month");
  const matrixFacts = await snapshotFactsOf(page, "screen");
  const parentRows = countOf(ROWS_IN_FILE.exec((await page.locator('[data-slot="export-print-actions"]').innerText()).replace(/\s+/gu, " "))?.[1] ?? "", "The matrix query's whole-result row count");
  const cell = page.locator(`[data-slot="report-matrix"] a[href*="partnerId=${DRILLDOWN_PARTNER}"][href*="from=${DRILLDOWN_MONTH_FROM}"]`).first(); // --- the cell -----------------------------------------------------------------------------------
  await expect(cell, "The matrix states a cell for this partner in this month, and the cell is the link to the records behind it.").toBeVisible();
  const cellAmount = statedAmountOf(await cell.innerText(), "The matrix cell");
  expect(cellAmount.currency, "The cell states its amount in the currency of the partition it sits in.").toBe(CURRENCY);
  await cell.click(); // --- the rows it narrows to ---------------------------------------------------------------------
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const drilledFacts = await snapshotFactsOf(page, "screen");
  const drilledRows = await listTotalOf(page, "gifts");
  const drilledFigure = wholeResultAmountOf(await readWholeResult(page), CURRENCY);
  expect(drilledRows, "The drilled query narrows the parent result rather than repeating it.").toBeLessThan(parentRows);
  expectSameAmount(drilledFigure.amount, cellAmount, "The rows the cell narrows to sum to the cell's own figure, in exact minor units.");
  expect(periodOfFacts(drilledFacts), "The drilled query states the cell's month as two civil days.").toEqual({ from: DRILLDOWN_MONTH_FROM, to: DRILLDOWN_MONTH_TO });
  expect(drilledFacts.Basis, "The drilled query is measured on the same named basis as the matrix.").toBe(matrixFacts.Basis);
  expect(drilledFacts.Grain, "The drilled query is counted at the same grain as the matrix.").toBe(matrixFacts.Grain);
  expect(coverageStateOfFacts(drilledFacts), "The drilled query carries the same coverage statement as the matrix.").toBe(coverageStateOfFacts(matrixFacts));
  const renderedRows = await readRenderedRows(page, "Received gifts");
  expect(renderedRows, "The drilled query's whole result fits one page, so the rows on screen are the rows behind the cell.").toBe(drilledRows);
  const drilledTable = page.getByRole("table", { name: "Received gifts" });
  const drilledAmounts: number[] = [];
  for (let index = 0; index < renderedRows; index += 1) drilledAmounts.push(statedAmountOf(await drilledTable.locator("tbody tr").nth(index).innerText(), `Row ${String(index)} of the drilled ledger`).minorUnits);
  expect(sumOf(drilledAmounts, "The drilled ledger's rows"), "The rows themselves sum to the cell's figure, which is the whole-result figure of the drilled query.").toBe(cellAmount.minorUnits);
  await expect(page.getByRole("list", { name: "Selected filters" }), "The drilled view states the partner it was narrowed to as an applied filter.").toContainText(`Attribution: ${DRILLDOWN_PARTNER}`);
  const drilldownQuery = `from=${DRILLDOWN_MONTH_FROM}&to=${DRILLDOWN_MONTH_TO}&currency=${CURRENCY}&recipient=partner&partnerId=${DRILLDOWN_PARTNER}`; // --- the report of the same narrow query, its CSV and its print ----------------------------------
  await openReport(page, `${RECEIVED_REPORT_HREF}?${drilldownQuery}`, "Received support");
  expectSameAmount(statedAmountOf(await factOf(page.locator('[data-slot="report-screen"]'), "Received in the period"), "The report's figure for the drilled query"), cellAmount, "The report of the drilled query states the cell's figure.");
  const csv = await downloadCsv(page);
  const drilledExport = "The drilled query's export";
  expect(metadataOf(csv, CSV_FIELD.page, drilledExport), "The drilled export is the whole query.").toBe("whole-query");
  expect(metadataOf(csv, CSV_FIELD.currency, drilledExport), "The drilled export states the one currency the cell sits in.").toBe(CURRENCY);
  expect(metadataOf(csv, CSV_FIELD.snapshotQuery, drilledExport), "The drilled export states the same narrowing the ledger's filters state.").toContain(`partner:${DRILLDOWN_PARTNER}`);
  expect(countOf(metadataOf(csv, CSV_FIELD.rowTotal, drilledExport), "The drilled export's row total"), "The drilled export holds the rows the drilled ledger stated.").toBe(drilledRows);
  expect(csv.rows.length, "The drilled export's records are its whole result.").toBe(drilledRows);
  for (const [index, row] of csv.rows.entries()) expect(row["partner_id"], `Row ${String(index)} of the drilled export belongs to the partner the cell names.`).toBe("partner-church-st-aidan");
  expect(fileMinorUnitsOf(csv, "The drilled export's rows"), "The drilled export's rows sum to the cell's figure.").toBe(cellAmount.minorUnits);
  const printed = await readPrintedPage(page, true);
  expect(periodOfFacts(printed.facts), "The printed page states the cell's month.").toEqual({ from: DRILLDOWN_MONTH_FROM, to: DRILLDOWN_MONTH_TO });
  expectSameAmount(printed.summaryAmount, cellAmount, "The printed page's summary states the cell's figure.");
  expect(printed.rowsStated, "The printed page states the drilled query's whole row count.").toBe(drilledRows);
  expect(printed.rows, "The printed page holds every row of the drilled query, because the whole result fits one page.").toBe(drilledRows);
  expect(printed.rowAmounts.length, "Every printed row states its amount, so the page's own rows can be summed.").toBe(drilledRows);
  expect(sumOf(printed.rowAmounts, "The printed page's rows"), "The printed page's rows sum to the cell's figure, in exact minor units: the sheet and the screen are one result.").toBe(cellAmount.minorUnits);
  expect(printed.about, "The printed page says it holds every authorised row of the query rather than a window of it.").toContain("every authorised row of the query");
  recordEvidence(
    "criterion-1 matrix drilldown",
    `Matrix cell ${DRILLDOWN_PARTNER} ${DRILLDOWN_MONTH_FROM}: ${String(cellAmount.minorUnits)} ${CURRENCY} minor units agreed by the cell, the ${String(drilledRows)} rows it narrowed to (from ${String(parentRows)} in the parent query), the drilled report's screen, its export (${String(csv.rows.length)} records) and its printed page (${String(printed.rows)} rows).`,
  );
});
test("a record visit returns to the same filtered view, at the same place in it", async ({ page }) => {
  ensureWorkload();
  const ledgerHref = `${GIFTS_HREF}?period=this-year&currency=${CURRENCY}`;
  await openReport(page, ledgerHref, "Received gifts");
  const table = page.getByRole("table", { name: "Received gifts" });
  await expect(table.locator("tbody tr").first()).toBeVisible();
  await page.mouse.wheel(0, 1_200);
  expect(await page.evaluate(() => window.scrollY), "The filtered ledger is longer than the viewport, which is what makes the place in it something to return to.").toBeGreaterThan(0);
  const chipsBefore = (await page.getByRole("list", { name: "Selected filters" }).innerText()).replace(/\s+/gu, " ").trim();
  const pagerBefore = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim();
  const firstGiftBefore = await firstGiftLink(page).getAttribute("aria-label");
  const giftRecordLink = firstGiftLink(page); // The place the reader leaves at is read with the row's link in view, because the click scrolls the link into view itself: the offset the wheel reached is one the reader only passes through.
  const placeBefore = await scrollPlaceOfRow(page, giftRecordLink, "The gifts ledger");
  await giftRecordLink.click(); // The visit: the row's own link is the only route to the record, and it names the gift it opens.
  await expect(page.getByRole("heading", { name: "Gift record", level: 1 })).toBeVisible();
  await expect(page, "The record is a destination of its own, so the visit is a navigation rather than a panel over the list.").toHaveURL(new RegExp(`${GIFTS_HREF}/gift-[^?]+`, "u"));
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  await expect(page, "The ledger returns with the filters the visit started from, so the query survives the detail visit.").toHaveURL(/period=this-year&currency=USD/u);
  expect((await page.getByRole("list", { name: "Selected filters" }).innerText()).replace(/\s+/gu, " ").trim(), "The applied filters come back exactly as they were.").toBe(chipsBefore);
  expect((await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim(), "The page window comes back exactly as it was.").toBe(pagerBefore);
  await expect(table.locator("tbody tr").first()).toBeVisible();
  expect(await firstGiftLink(page).getAttribute("aria-label"), "The same rows are in the same order after the return.").toBe(firstGiftBefore);
  await expectRestoredScrollPlace(page, placeBefore, "The gifts ledger's return"); // The return restores the offset the reader actually left at rather than bounding it by a document that is still filling: the shell's development panels grow the document across a visit, so the return is held to the offset within the tolerance on a document at least as tall as the one left.
  const restoredOffset = await page.evaluate(() => window.scrollY);
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first(), "The returned view is still labelled as development data, so no surface of this application can be mistaken for production.").toBeVisible();
  recordEvidence(
    "criterion-1 continuity",
    `A gift-record visit and return restored the applied filters (${chipsBefore}), the page window (${pagerBefore}), the first row (${firstGiftBefore ?? "none"}) and the reader's place in it — ${String(restoredOffset)} px down the returned document against the ${String(placeBefore.offset)} px it was left at on a ${String(placeBefore.height)} px document, within the ${String(SCROLL_TOLERANCE_PX)} px scroll tolerance.`,
  );
});
