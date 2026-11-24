/** Whole-query agreement among every financial surface: the domain half of success criterion 1. */
import { beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import type { Coverage, GiftRowRecord, SupportGoalRecord } from "@/modules/data-service/envelope";
import { DEFAULT_SESSION_ID, seed, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { CSV_ALL_CURRENCIES } from "@/modules/export/csv";
import { printModel, type PrintCell, type PrintModel, type PrintRow } from "@/modules/export/print";
import { addMinor, minorUnitsOf, negateMinor, type Money } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY, exponentOf } from "@/modules/money/currency";
import { formatMinor } from "@/modules/money/format";
import { SUPPORT_BASIS, type GiftRow, type SupportProjection } from "@/modules/support/basis";
import { GOAL_MEASURE } from "@/modules/support/goal";
import { CONTRIBUTOR_DELTA_LIMIT, PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT, REPORT_IDS, buildReportQuery, matrixDrilldownQuery, runReport, validateReportQuery, type CurrencySummary, type ReportQuery, type ReportResult, type SeriesPoint } from "@/modules/support/report";
import { firstWhere, required, throwing } from "../helpers/answers";
const PERIOD_FROM = "2026-01-01";
const PERIOD_TO = "2026-11-20";
let established: Promise<SessionStateDocument> | undefined;
function establishedDocument(): Promise<SessionStateDocument> {
  established ??= loadEstablishedDocument();
  return established;
}
const loadEstablishedDocument = async (): Promise<SessionStateDocument> => firstWhere(await seed(), "sessionId", DEFAULT_SESSION_ID, `the seeded session "${DEFAULT_SESSION_ID}"`).documents.state;
function scopeOf(source: SessionStateDocument): ReportQuery["scope"] {
  const { context } = source;
  const { selectedOrganizationId, selectedMinistryId, selectedSupportSubjectId } = context;
  if (selectedOrganizationId === null || selectedMinistryId === null || selectedSupportSubjectId === null) throw new Error("The seeded session selects no context, so a report cannot run under an authority it never chose.");
  return { organizationId: selectedOrganizationId, ministryId: selectedMinistryId, supportSubjectId: selectedSupportSubjectId, principalId: context.principalId };
}
const day = (value: string): Temporal.PlainDate => Temporal.PlainDate.from(value);
function giftRowsOf(records: readonly GiftRowRecord[]): readonly GiftRow[] {
  return records.map((record) => ({
    giftRowId: record.giftRowId,
    giftId: record.giftId,
    ...(record.allocationId === null ? {} : { allocationId: record.allocationId }),
    amount: record.amount,
    ...(record.originalGiftOn === null ? {} : { originalGiftOn: Temporal.PlainDate.from(record.originalGiftOn) }),
    datePrecision: record.datePrecision,
    ...(record.designation === null ? {} : { designation: record.designation }),
    attribution: record.attribution,
    ...(record.refundOf === null ? {} : { refundOf: record.refundOf }),
    provenance: record.provenance,
    entryOn: Temporal.PlainDate.from(record.entryOn),
  }));
}
type ProjectionShape = { readonly coverage?: Coverage; readonly gifts?: readonly GiftRow[]; readonly goal?: SupportGoalRecord | null; readonly asOf?: string };
function projectionOf(source: SessionStateDocument, shape: ProjectionShape = {}): SupportProjection {
  const record = source.supportProjection;
  if (record === null) throw new Error("The seeded session states no support projection, so there is no basis or coverage to report under.");
  const goal = shape.goal === undefined ? record.goal : shape.goal;
  return {
    supportSubjectId: record.supportSubjectId,
    basis: record.basis,
    currencyExponents: record.currencyExponents,
    coverage: shape.coverage ?? record.coverage,
    asOf: shape.asOf ?? record.asOf,
    lastSourceUpdate: record.lastSourceUpdate,
    source: record.source,
    ...(goal === null ? {} : { goal }),
    gifts: shape.gifts ?? giftRowsOf(source.gifts),
    commitments: [],
  };
}
const amount = (currency: string, minorUnits: number): Money => ({ currency, minorUnits: minorUnitsOf(minorUnits) });
const queryOf = (source: SessionStateDocument, overrides: Partial<ReportQuery> = {}): ReportQuery => ({ reportId: "received-period-and-year-to-date", scope: scopeOf(source), period: { kind: "explicit", from: day(PERIOD_FROM), to: day(PERIOD_TO) }, currency: { kind: "all" }, ...overrides });
function run(query: ReportQuery, projection: SupportProjection): ReportResult {
  const built = buildReportQuery(query);
  if (!built.ok) throw new Error(`The report query was refused: ${built.problems.map((problem) => `${problem.field}: ${problem.message}`).join(" ")}`);
  return runReport(built.query, projection);
}
const minorTotalOf = (amounts: readonly Money[], currency: string): number => amounts.reduce((total, entry) => addMinor(total, entry), amount(currency, 0)).minorUnits;
const summaryFor = (result: ReportResult, currency: string): CurrencySummary => firstWhere(result.summary, "currency", currency, `the ${currency} entry of the result`);
const rowAmountsOf = (result: ReportResult, currency: string): readonly Money[] => result.rows.filter((row) => row.amount.currency === currency).map((row) => row.amount);
const seriesPointsOf = (result: ReportResult, currency: string): readonly SeriesPoint[] => result.series.filter((point) => point.currency === currency);
const seriesAmountsOf = (result: ReportResult, currency: string): readonly Money[] => seriesPointsOf(result, currency).flatMap((point) => (point.gap || point.value.minorUnits === null ? [] : [amount(currency, point.value.minorUnits)]));
function printedAmountsOf(model: PrintModel): readonly Money[] {
  const currencyColumn = printedColumnIndex(model, "currency");
  const minorUnitsColumn = printedColumnIndex(model, "amount_minor_units");
  return model.rows.map((row) => {
    const currencyCell = printedCell(row, currencyColumn, "currency");
    const amountCell = printedCell(row, minorUnitsColumn, "amount_minor_units");
    // A row's own amount is an exact recorded fact, so its state carries a number; a state that does not is refused here rather than read as one, which is what stops this file from inventing a zero.
    if (amountCell.state !== "value" && amountCell.state !== "zero") throw new Error(`A printed row states its amount as "${amountCell.state}", so no minor-unit count may be read from it.`);
    const minorUnits = Number.parseInt(amountCell.text, 10);
    if (!Number.isSafeInteger(minorUnits)) throw new Error(`The printed minor-unit cell "${amountCell.text}" is not a whole count of minor units.`);
    return amount(currencyCell.text, minorUnits);
  });
}
function printedColumnIndex(model: PrintModel, header: string): number {
  const index = model.columns.findIndex((column) => column.header === header);
  if (index < 0) throw new Error(`The print model states no "${header}" column, so its rows cannot be read against the result.`);
  return index;
}
const printedCell = (row: PrintRow, index: number, header: string): PrintCell => required(row[index], `the "${header}" cell of a printed row`);
const printedSummaryLineOf = (model: PrintModel, currency: string) => model.summary.find((candidate) => candidate.label.endsWith(`(${currency})`)) ?? throwing(`the print model's ${currency} summary line`);
const printedFact = (model: PrintModel, field: string): string => (model.facts.find((candidate) => candidate.field === field) ?? throwing(`the print model's "${field}" snapshot fact`)).value;
/** Every value of one kind a result carries at any depth, so a whole answer is checked without naming each path. */
function collectFrom(value: unknown, pick: (held: Readonly<Record<string, unknown>>) => string | number | undefined, found: (string | number)[] = []): readonly (string | number)[] {
  if (Array.isArray(value)) {
    for (const item of value) collectFrom(item, pick, found);
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  const held = value as Readonly<Record<string, unknown>>;
  const picked = pick(held);
  if (picked !== undefined) found.push(picked);
  for (const child of Object.values(value)) collectFrom(child, pick, found);
  return found;
}
const collectMinorUnits = (value: unknown): readonly number[] => collectFrom(value, (held) => (typeof held["minorUnits"] === "number" ? held["minorUnits"] : undefined)) as readonly number[];
const collectCurrencies = (value: unknown): readonly string[] => collectFrom(value, (held) => (typeof held["currency"] === "string" && typeof held["minorUnits"] === "number" ? held["currency"] : undefined)) as readonly string[]; // The same walk as `collectMinorUnits`: one traversal, told what to pick from each object.
const BULK_ROW_COUNT = 120;
const BULK_FIRST_DAY = "2026-01-01";
/** One row per day from a fixed first day, each naming its own partner: the shape the bulk and matrix worlds are built from. */
function syntheticGiftRows(prefix: string, count: number, minorUnits: number, partnerOf: (index: number) => string): readonly GiftRow[] {
  const origin = day(BULK_FIRST_DAY);
  return Array.from({ length: BULK_ROW_COUNT }, (_unused, index) => {
    const giftId = `gift-bulk-${String(index).padStart(4, "0")}`;
    const giftedOn = origin.add({ days: index });
    return { giftRowId: `${giftId}-row`, giftId, amount: amount("USD", minorUnits), originalGiftOn: giftedOn, datePrecision: "date", attribution: { kind: "partner", partnerId: partnerOf(index) }, provenance: { system: "finance", reference: giftId }, entryOn: giftedOn } satisfies GiftRow;
  });
}
const bulkGiftRows = (): readonly GiftRow[] => syntheticGiftRows("bulk", BULK_ROW_COUNT, 10000, (index) => `partner-bulk-${String(index % 7)}`);
const BULK_TOTAL_MINOR_UNITS = minorTotalOf(
  bulkGiftRows().map((row) => row.amount),
  "USD",
);
const bulkProjectionOf = (source: SessionStateDocument): SupportProjection => projectionOf(source, { coverage: { from: PERIOD_FROM, to: PERIOD_TO, state: "complete" }, gifts: bulkGiftRows() });
const MATRIX_PARTNER_COUNT = 120;
const matrixGiftRows = (count: number): readonly GiftRow[] => syntheticGiftRows("matrix", count, 100, (index) => `partner-matrix-${String(index).padStart(4, "0")}`);
/** A page of the matrix holds fewer rows than this result has attributions, so every paging case below meets one. */
const matrixProjectionOf = (source: SessionStateDocument): SupportProjection => projectionOf(source, { coverage: { from: PERIOD_FROM, to: PERIOD_TO, state: "complete" }, gifts: matrixGiftRows(MATRIX_PARTNER_COUNT) });
type MatrixModel = NonNullable<ReportResult["matrix"]>;
type MatrixRowModel = MatrixModel["rows"][number];
/** The matrix report once per case: the query, the result and the model it states. */
function matrixOf(): { result: ReportResult; matrix: MatrixModel; projection: SupportProjection } {
  const projection = projectionOf(document);
  const result = run(queryOf(document, { reportId: "partner-month-matrix" }), projection);
  return { result, matrix: required(result.matrix, "the partner-by-month matrix"), projection };
}
/** One row of the matrix, by the partner it states. */
const matrixRowOf = (matrix: MatrixModel, partnerId: string, what: string): MatrixRowModel => firstWhere(matrix.rows, "partnerId", partnerId, what);
/** One cell of a matrix row, by the currency and the month it starts. */
const cellOf = (row: MatrixRowModel, currency: string, bucketStart: string, what: string) => row.cells.find((cell) => cell.currency === currency && cell.bucketStart.toString() === bucketStart) ?? throwing(what);
/** The query one matrix cell stands for, derived exactly the way the matrix's own link derives it. */
const drilldownOf = (result: ReportResult, row: MatrixRowModel, cell: MatrixRowModel["cells"][number]): ReportQuery => matrixDrilldownQuery(result.snapshot.query, row.attribution, cell.currency, cell.bucketStart, cell.bucketEnd);
/** The owner a matrix cell belongs to: a partner's own reference, or the kind when no partner is named. */
const matrixOwnerOf = (attribution: GiftRow["attribution"]): string => (attribution.kind === "partner" ? `partner:${attribution.partnerId}` : attribution.kind);
/** The key one attribution and month share, so a cell and the result rows behind it are compared by identity rather than by a second sum. */
const matrixCellKey = (attribution: GiftRow["attribution"], bucketStart: Temporal.PlainDate): string => `${matrixOwnerOf(attribution)}:${bucketStart.toString()}`;
/** The key of the cell a result row belongs to, resolved from that row's own original gift date. */
function matrixCellKeyOfRow(matrix: MatrixModel, row: GiftRow): string {
  const giftedOn = required(row.originalGiftOn, "a result row's original gift date");
  const month = matrix.months.find((candidate) => Temporal.PlainDate.compare(giftedOn, candidate.start) >= 0 && Temporal.PlainDate.compare(giftedOn, candidate.end) <= 0) ?? throwing("A result row falls in no month the matrix lists, so the cell it belongs to cannot be named.");
  return matrixCellKey(row.attribution, month.start);
}
let document: SessionStateDocument;
beforeEach(async () => (document = await establishedDocument()));
it("one query, one snapshot, and every surface reads it: states the period, scope, basis, partition, coverage and as-of instant it was computed under", () => {
  const projection = projectionOf(document);
  const query = queryOf(document);
  const result = run(query, projection);
  expect([result.snapshot.query, result.snapshot.scope]).toEqual([query, query.scope]);
  expect(result.snapshot.basis).toBe(SUPPORT_BASIS);
  expect([[result.snapshot.period.from.toString(), result.snapshot.period.to.toString(), result.snapshot.period.state], result.snapshot.coverage]).toEqual([[PERIOD_FROM, PERIOD_TO, "in-progress"], projection.coverage]);
  expect([result.snapshot.asOf, result.snapshot.lastSourceUpdate, result.snapshot.source]).toEqual([projection.asOf, projection.lastSourceUpdate, projection.source]);
  expect(new Set([result.snapshot.asOf, result.snapshot.lastSourceUpdate, result.snapshot.coverage.to]).size).toBe(3); // The instant the read ran, when the source last changed and how far back it covers are three different facts, so a surface can never present one as another.
  // The partition the figures are stated in is the partition the summary answers in, currency for currency and in the same order, so no surface can list a currency the summary never states.
  expect([result.snapshot.currencies, [...result.snapshot.currencies]]).toEqual([result.summary.map((entry) => entry.currency), [...result.snapshot.currencies].sort()]);
});
it("one query, one snapshot, and every surface reads it: prints the same snapshot the result states, so the two surfaces are comparable", () => {
  const result = run(queryOf(document), projectionOf(document));
  const model = printModel(result);
  expect([printedFact(model, "snapshot_as_of"), printedFact(model, "coverage_state"), printedFact(model, "coverage_from"), printedFact(model, "coverage_to")]).toEqual([result.snapshot.asOf, result.snapshot.coverage.state, result.snapshot.coverage.from, result.snapshot.coverage.to]);
  expect([printedFact(model, "period_from"), printedFact(model, "period_to"), printedFact(model, "period_state")]).toEqual([PERIOD_FROM, PERIOD_TO, result.snapshot.period.state]);
  expect([printedFact(model, "row_total"), printedFact(model, "basis").startsWith(`${SUPPORT_BASIS}:`), model.rowTotal, model.inProgress, model.statusLabel]).toEqual([String(result.total), true, result.total, true, "In progress"]);
  expect([model.completeness, printModel(result)]).toEqual(["whole-query", model]); // An unpaged read is the whole query, so the page says so instead of claiming one page is the answer.
});
it("one query, one snapshot, and every surface reads it: resolves a named period against the projection's as-of instant rather than a clock", () => {
  const projection = projectionOf(document);
  const query = queryOf(document, { period: { kind: "preset", preset: "this-month" } });
  const thisMonth = run(query, projection);
  expect([thisMonth.snapshot.period.from.toString(), thisMonth.snapshot.period.to.toString(), thisMonth.snapshot.period.state]).toEqual(["2026-11-01", "2026-11-30", "in-progress"]);
  expect(run(query, projection).snapshot.period).toEqual(thisMonth.snapshot.period); // The same query against the same projection resolves to the same period, because nothing here reads the machine clock.
});
it("one query, one snapshot, and every surface reads it: closes the period when the projection's instant moves past it, leaving the amounts untouched", () => {
  const asSeeded = run(queryOf(document), projectionOf(document));
  const later = run(queryOf(document), projectionOf(document, { asOf: "2026-12-01T00:00:00Z" }));
  expect([asSeeded.snapshot.period.state, later.snapshot.period.state]).toEqual(["in-progress", "complete"]);
  expect(later.snapshot.asOf).not.toBe(asSeeded.snapshot.asOf);
  expect(later.summary).toEqual(asSeeded.summary); // The period's state is derived from the instant, so only the state may move: a figure that moved with it would be a different figure wearing the same numbers.
  expect(later.total).toBe(asSeeded.total);
  expect([printModel(asSeeded).statusLabel, printModel(later).statusLabel]).toEqual(["In progress", null]);
});
it("one query, one snapshot, and every surface reads it: computes only the four fixed reports and refuses a fifth", () => {
  const projection = projectionOf(document);
  expect(REPORT_IDS).toHaveLength(4); // Four fixed reports and no report designer, no scheduled report and no report builder: the closed set is what "one report function" means, and a fifth identity is refused rather than substituted.
  expect(new Set(REPORT_IDS).size).toBe(4);
  for (const reportId of REPORT_IDS) {
    const requested = queryOf(document, { reportId });
    const built = buildReportQuery(requested);
    if (!built.ok) throw new Error(`One of the four fixed reports was refused by the query gate: ${reportId}.`);
    const result = run(requested, projection);
    expect(result.snapshot.query).toEqual(built.query); // Each identity computes, and the snapshot states the query the gate built rather than another.
    expect(result.snapshot.query.reportId).toBe(reportId);
  }
  const invented = { ...queryOf(document), reportId: "report-designer" } as unknown as ReportQuery; // A report identity outside the set arrives from a decoded request as plain data, so it is stubbed as exactly that: the gate refuses it, and the engine refuses it again for a hand-built query.
  const refused = buildReportQuery(invented);
  if (refused.ok) throw new Error("A report identity outside the four fixed reports was accepted.");
  expect(refused.problems.map((problem) => problem.field)).toContain("reportId");
  expect(validateReportQuery(invented).map((problem) => problem.field)).toContain("reportId");
  expect(() => runReport(invented, projection)).toThrow(TypeError);
});
it("count and sum agreement across every surface: re-sums the table rows, the chart series and the printed rows to the same per-currency totals", () => {
  const result = run(queryOf(document), projectionOf(document));
  const model = printModel(result);
  expect(result.page).toBeUndefined();
  expect(result.rows).toHaveLength(result.total);
  expect(model.rows).toHaveLength(result.rows.length);
  const printedAmounts = printedAmountsOf(model);
  expect(result.summary.filter((entry) => entry.exponent === undefined).map((entry) => entry.received.minorUnits)).toEqual([null]); // A currency with no exponent cannot be summed, so its entry states no amount at all rather than a total this application would have had to assume a precision for.
  for (const entry of result.summary) {
    if (entry.exponent === undefined) continue;
    expect(entry.exponent).toBe(exponentOf(entry.currency));
    const tableTotal = minorTotalOf(rowAmountsOf(result, entry.currency), entry.currency);
    const seriesTotal = minorTotalOf(seriesAmountsOf(result, entry.currency), entry.currency);
    const printedTotal = minorTotalOf(
      printedAmounts.filter((printed) => printed.currency === entry.currency),
      entry.currency,
    );
    expect([entry.received.minorUnits, seriesTotal, printedTotal]).toEqual([tableTotal, tableTotal, tableTotal]);
  }
  expect(model.summary).toHaveLength(result.summary.length);
  for (const entry of result.summary) {
    const line = printedSummaryLineOf(model, entry.currency);
    const rendered = formatMinor(amount(entry.currency, entry.received.minorUnits ?? 0), entry.received.valueState, "en");
    expect([line.state, line.text, line.accessibleLabel]).toEqual([entry.received.valueState, rendered.text, rendered.accessibleLabel]);
  }
});
it("count and sum agreement across every surface: counts the whole result in `total` and never the loaded page", () => {
  const projection = bulkProjectionOf(document);
  expect([PAGE_SIZE_DEFAULT, PAGE_SIZE_CAP]).toEqual([50, 200]);
  const unpaged = run(queryOf(document), projection);
  expect(unpaged.page).toBeUndefined();
  expect(unpaged.total).toBe(BULK_ROW_COUNT);
  expect(unpaged.rows).toHaveLength(BULK_ROW_COUNT);
  expect(minorTotalOf(rowAmountsOf(unpaged, "USD"), "USD")).toBe(BULK_TOTAL_MINOR_UNITS);
  const firstPage = run(queryOf(document, { page: { index: 0 } }), projection);
  expect(firstPage.page).toEqual({ index: 0, size: PAGE_SIZE_DEFAULT, totalPages: 3 });
  expect(firstPage.rows).toHaveLength(PAGE_SIZE_DEFAULT);
  expect(firstPage.total).toBe(BULK_ROW_COUNT);
  expect(firstPage.rows.length).not.toBe(firstPage.total); // A page that reported its own row count as the total would fail here, and so would a total that happened to be the page: the two answers are different numbers on purpose.
  expect(minorTotalOf(rowAmountsOf(firstPage, "USD"), "USD")).toBe(
    minorTotalOf(
      bulkGiftRows()
        .slice(0, PAGE_SIZE_DEFAULT)
        .map((row) => row.amount),
      "USD",
    ),
  );
  expect(summaryFor(firstPage, "USD").received.minorUnits).toBe(BULK_TOTAL_MINOR_UNITS);
  expect(run(queryOf(document, { page: { index: 2 } }), projection).rows).toHaveLength(BULK_ROW_COUNT - 2 * PAGE_SIZE_DEFAULT);
  expect(run(queryOf(document, { page: { index: 0, size: 500 } }), projection).page?.size).toBe(PAGE_SIZE_CAP);
});
it("count and sum agreement across every surface: clamps a page index past the last page onto the last page's rows", () => {
  const projection = bulkProjectionOf(document);
  const lastPage = run(queryOf(document, { page: { index: 2 } }), projection);
  // A stale or hand-edited address states a page the result does not have, so it is answered with the last page it does have rather than with metadata that states a page and serves none of it.
  const pastEnd = run(queryOf(document, { page: { index: 500 } }), projection);
  expect(pastEnd.page).toEqual({ index: 2, size: PAGE_SIZE_DEFAULT, totalPages: 3 });
  expect([pastEnd.rows.map((row) => row.giftRowId), pastEnd.total, pastEnd.summary]).toEqual([lastPage.rows.map((row) => row.giftRowId), BULK_ROW_COUNT, lastPage.summary]);
  const empty = run(queryOf(document, { search: "no gift states this reference", page: { index: 5 } }), projection); // A result that fills no page states page zero of none, with no rows rather than a page number it cannot have.
  expect([empty.page, empty.rows, empty.total]).toEqual([{ index: 0, size: PAGE_SIZE_DEFAULT, totalPages: 0 }, [], 0]);
});
it("count and sum agreement across every surface: keeps every whole-query value unchanged when the sort or the page changes", () => {
  const projection = bulkProjectionOf(document);
  const baseline = run(queryOf(document), projection);
  const windows = [run(queryOf(document, { sort: { field: "amountMinor", direction: "asc" }, page: { index: 1 } }), projection), run(queryOf(document, { sort: { field: "originalGiftOn", direction: "asc" }, page: { index: 2 } }), projection)];
  for (const window of windows) {
    // The summary, the chart's series and the whole-result count are whole-query values: a sort or a page that moved one of them would mean the figure was computed from the visible window.
    expect([window.summary, [window.total, minorTotalOf(seriesAmountsOf(window, "USD"), "USD")]]).toEqual([baseline.summary, [baseline.total, BULK_TOTAL_MINOR_UNITS]]);
    expect(window.rows.length).toBeLessThan(window.total);
  }
  const [byAmount, byDate] = windows;
  expect(required(byAmount, "the amount-sorted window").rows).toHaveLength(PAGE_SIZE_DEFAULT);
  expect(required(byDate, "the date-sorted window").rows).toHaveLength(BULK_ROW_COUNT - 2 * PAGE_SIZE_DEFAULT);
});
it("a gift counts once at its own grain: states the authorised allocation of a split gift whether one grain level or both are read", () => {
  const projection = projectionOf(document);
  const wholeGift = run(queryOf(document, { search: "gift-harbour-0002" }), projection);
  expect(wholeGift.rows).toHaveLength(1); // The read carries the parent gift row and this ministry's allocation of it. The authorised allocation is what the basis states, so the pair yields 4000 minor units — never the whole gift at gift grain and never the two rows added together.
  expect([required(wholeGift.rows[0], "the split gift's single authorised row").allocationId, summaryFor(wholeGift, "USD").received.minorUnits]).toEqual(["alloc-harbour-0002-youth", 4000]);
  for (const expected of [10000, 14000]) expect(summaryFor(wholeGift, "USD").received.minorUnits).not.toBe(expected);
  expect([summaryFor(wholeGift, "USD").giftCount.count, summaryFor(wholeGift, "USD").allocationCount.count]).toEqual([1, 1]);
  const allocationOnly = run(queryOf(document, { search: "alloc-harbour-0002-youth" }), projection); // At allocation grain the same figure, so the authorised amount is the figure and not an artefact of the parent having been filtered out.
  expect(allocationOnly.rows).toHaveLength(1);
  expect(summaryFor(allocationOnly, "USD").received.minorUnits).toBe(4000);
  const giftGrainOnly = run(queryOf(document, { search: "gift-row-harbour-0002" }), projection); // At gift grain the whole gift is stated, which is what makes the de-duplication above visible rather than incidental: the parent row is a real row with its own amount.
  expect(giftGrainOnly.rows).toHaveLength(1);
  expect([summaryFor(giftGrainOnly, "USD").received.minorUnits, summaryFor(giftGrainOnly, "USD").allocationCount.count]).toEqual([10000, 0]);
  const whole = run(queryOf(document), projection); // In the whole-query read the parent row is the one that goes, so the gift contributes once.
  expect(whole.rows.some((row) => row.giftRowId === "gift-row-harbour-0002")).toBe(false);
  const splitGiftAmounts = whole.rows.filter((row) => row.giftId === "gift-harbour-0002").map((row) => row.amount);
  expect(splitGiftAmounts).toHaveLength(1);
  expect(minorTotalOf(splitGiftAmounts, "USD")).toBe(4000);
  expect(minorTotalOf(rowAmountsOf(whole, "USD"), "USD")).toBe(24500); // The whole query's USD total is the exact sum of the authorised allocations that remain, so counting the split gift a second time would show up here as 28500 rather than 24500.
});
it("a gift counts once at its own grain: keeps the gift, allocation and donor counts at their own grains and never adds them together", () => {
  const result = run(queryOf(document), projectionOf(document));
  for (const entry of result.summary) {
    const rowsInCurrency = result.rows.filter((row) => row.amount.currency === entry.currency);
    const giftIds = new Set(rowsInCurrency.map((row) => row.giftId));
    const allocationRows = rowsInCurrency.filter((row) => row.allocationId !== undefined);
    const donorIds = new Set(rowsInCurrency.flatMap((row) => (row.attribution.kind === "partner" ? [row.attribution.partnerId] : [])));
    expect([[entry.giftCount.count, entry.allocationCount.count, entry.donorCount.count], Object.keys(entry)]).toEqual([
      [giftIds.size, allocationRows.length, donorIds.size],
      ["currency", "exponent", "received", "giftCount", "allocationCount", "donorCount"],
    ]);
  }
  const summedCounts = result.summary.reduce((total, entry) => total + entry.giftCount.count + entry.allocationCount.count + entry.donorCount.count, 0);
  expect(result.total).toBe(result.rows.length);
  expect(result.total).not.toBe(summedCounts);
  expect(Object.keys(result.valueStates).filter((path) => path.includes("total"))).toEqual([]);
});
it("a gift counts once at its own grain: explains a refunded gift instead of hiding it, and nets the period to the correction", () => {
  const result = run(queryOf(document, { partner: { kind: "partner", partnerId: "partner-church-st-aidan" } }), projectionOf(document));
  expect(result.rows).toHaveLength(2); // A correction is its own row carrying the source's signed amount and naming the row it corrects, so a period that already reported the gift keeps the explanation rather than losing it.
  const original = firstWhere(result.rows, "giftRowId", "gift-row-harbour-0009", "the refunded gift's original row");
  const correction = firstWhere(result.rows, "refundOf", original.giftRowId, "the row that corrects the refunded gift");
  expect([correction.refundOf, correction.amount.currency, correction.amount.minorUnits, original.amount.minorUnits]).toEqual([original.giftRowId, original.amount.currency, negateMinor(original.amount).minorUnits, 7500]);
  // The net follows the correction: 7500 given and 7500 refunded is a genuine zero, and the coverage state still says the period is partial, because coverage outranks the zero rendering.
  expect([summaryFor(result, "USD").received.minorUnits, minorTotalOf(rowAmountsOf(result, "USD"), "USD"), summaryFor(result, "USD").received.valueState]).toEqual([0, 0, "incomplete-subtotal"]);
  const printed = printedAmountsOf(printModel(result)).map((entry) => entry.minorUnits); // Both rows reach the printed table, so the explanation travels with the figure into print.
  for (const needle of [7500, -7500]) expect(printed).toContain(needle);
});
it("currencies stay partitioned: states one entry per currency and no combined figure anywhere", () => {
  const result = run(queryOf(document), projectionOf(document));
  expect([result.summary.map((entry) => entry.currency), result.snapshot.currencies]).toEqual([["EUR", "JPY", "KWD", UNKNOWN_CURRENCY, "USD"], result.summary.map((entry) => entry.currency)]);
  const stated = collectCurrencies(result); // There is no exchange rate in this application, so no amount anywhere in the result is stated in a currency the partition does not name: an aggregate code would be a combined total in disguise.
  expect(stated.length).toBeGreaterThan(0);
  expect(stated.filter((code) => !result.snapshot.currencies.includes(code))).toEqual([]);
  // The download and the printed page state the query's own currency partition, the same fact the envelope's coverage states, so the file and the coverage can never describe the query differently; each row still prints its own currency code, the unknown-currency row included.
  expect(result.snapshot.currencies.length).toBeGreaterThan(1);
  expect(printedFact(printModel(result), "currency")).toBe(CSV_ALL_CURRENCIES);
  const usdOnly = run(queryOf(document, { currency: { kind: "one", currency: "USD" } }), projectionOf(document));
  expect([usdOnly.summary.map((entry) => entry.currency), printedFact(printModel(usdOnly), "currency")]).toEqual([["USD"], "USD"]);
});
it("currencies stay partitioned: respects each currency's exponent and never assumes two decimals", () => {
  const result = run(queryOf(document), projectionOf(document));
  expect([
    [exponentOf("USD"), exponentOf("EUR"), exponentOf("KWD"), exponentOf("JPY"), exponentOf(UNKNOWN_CURRENCY)],
    [summaryFor(result, "KWD").exponent, summaryFor(result, "JPY").exponent, summaryFor(result, "USD").exponent],
  ]).toEqual([
    [2, 2, 3, 0, undefined],
    [3, 0, 2],
  ]);
  // 1,250 minor units is 1.250 KWD and 5,000 minor units is 5,000 JPY: the same integers, three decimals and none, because the exponent is looked up per code.
  expect([formatMinor(amount("KWD", 1250), "value", "en").plain, formatMinor(amount("JPY", 5000), "value", "en").plain, formatMinor(amount("USD", 4000), "value", "en").plain]).toEqual(["1.250 KWD", "5000 JPY", "40.00 USD"]);
  expect([summaryFor(result, "KWD").received.minorUnits, summaryFor(result, "JPY").received.minorUnits]).toEqual([1250, 5000]);
});
it("currencies stay partitioned: keeps an unknown-currency amount as an unknown fact rather than defaulting or dropping it", () => {
  const result = run(queryOf(document), projectionOf(document));
  const unknown = summaryFor(result, UNKNOWN_CURRENCY);
  expect(unknown.exponent).toBeUndefined();
  expect(unknown.received).toEqual({ minorUnits: null, valueState: "unknown" });
  expect(result.valueStates[`summary.${UNKNOWN_CURRENCY}.received`]).toBe("unknown");
  // Present, counted, and never summed: dropping it would understate the result's coverage of the source, and giving it an exponent would state a total nobody can check.
  expect([[unknown.giftCount.count, result.rows.some((row) => row.amount.currency === UNKNOWN_CURRENCY), result.total], seriesPointsOf(result, UNKNOWN_CURRENCY)]).toEqual([[1, true, 10], []]);
  const rendered = formatMinor(amount(UNKNOWN_CURRENCY, 7500), "value", "en"); // The rendering states the code and the unknown currency rather than a two-decimal amount.
  for (const needle of [UNKNOWN_CURRENCY, "minor units"]) expect(rendered.plain).toContain(needle);
  expect(rendered.plain).not.toContain(".");
});
it("currencies stay partitioned: refuses an amount range across currencies and applies it only inside one", () => {
  const projection = projectionOf(document);
  const acrossCurrencies = queryOf(document, { amountRange: { minMinor: minorUnitsOf(5000), maxMinor: minorUnitsOf(5000) } });
  const refused = buildReportQuery(acrossCurrencies); // A range compares minor units, and two currencies' minor units have no ordering, so the query is refused by the constructor rather than answered with a figure that compares KWD with JPY.
  if (refused.ok) throw new Error("A range was accepted beside every currency, which would compare amounts that have no ordering.");
  expect(refused.problems.map((problem) => problem.field)).toContain("amountRange");
  expect(validateReportQuery(acrossCurrencies).map((problem) => problem.field)).toContain("amountRange");
  expect(() => runReport(acrossCurrencies, projection)).toThrow(TypeError);
  const whole = run(queryOf(document), projection);
  expect(whole.rows.some((row) => row.amount.currency === "JPY" && row.amount.minorUnits === 5000)).toBe(true);
  const usdOnly = run(queryOf(document, { currency: { kind: "one", currency: "USD" }, amountRange: { minMinor: minorUnitsOf(5000), maxMinor: minorUnitsOf(5000) } }), projection);
  expect(usdOnly.summary.map((entry) => entry.currency)).toEqual(["USD"]);
  expect(usdOnly.rows.length).toBeGreaterThan(0);
  for (const row of usdOnly.rows) expect([row.amount.currency, row.amount.minorUnits]).toEqual(["USD", 5000]);
  expect(usdOnly.rows.some((row) => row.provenance.reference === "gift-harbour-0005")).toBe(false);
});
it("gaps, coverage and percentages: states a month the source recorded nothing in as a gap rather than a zero", () => {
  const result = run(queryOf(document), projectionOf(document));
  const usd = seriesPointsOf(result, "USD");
  expect(result.series).toHaveLength(4 * 11);
  expect(usd).toHaveLength(11);
  expect(usd.map((point) => point.bucketStart.toString())).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"]);
  expect(required(usd.at(-1), "the final USD point").bucketEnd.toString()).toBe(PERIOD_TO); // The last bucket is clipped to the period, so a part-month states the days it actually covers.
  const january = required(usd[0], "the January USD point");
  expect(january.gap).toBe(true);
  expect(january.value.minorUnits).not.toBe(0); // A gap is not a dip to zero: it carries no amount at all, because a zero would claim the source recorded nothing rather than that nothing was recorded in it.
  expect(january.value.minorUnits).toBeNull();
  expect([january.value.valueState, january.bucketEnd.toString()]).toEqual(["unknown", "2026-01-31"]);
  expect(usd.filter((point) => !point.gap)).toHaveLength(6); // Exactly the six months that recorded a gift are stated; a synthesised point would make it seven.
  expect(usd.filter((point) => !point.gap && point.value.minorUnits === 0)).toEqual([]);
  for (const point of result.series) expect([point.bucketStart.toString() >= PERIOD_FROM, point.bucketEnd.toString() <= PERIOD_TO]).toEqual([true, true]);
  expect(printModel(result).notes.some((note) => note.includes("2026-01-01") && note.includes("gap, not zero"))).toBe(true); // The printed page says the gap in words instead of drawing a zero point or a zero row.
});
it("gaps, coverage and percentages: derives an incomplete subtotal from partial coverage and keeps zero, unknown and partial apart", () => {
  const partial = run(queryOf(document), projectionOf(document));
  expect([partial.snapshot.coverage.state, summaryFor(partial, "USD").received.valueState, partial.valueStates["summary.USD.received"]]).toEqual(["partial", "incomplete-subtotal", "incomplete-subtotal"]);
  for (const point of seriesPointsOf(partial, "USD")) {
    if (point.gap) continue;
    expect([point.value.valueState, partial.valueStates[`series.USD.${point.bucketStart.toString()}`]]).toEqual(["incomplete-subtotal", "incomplete-subtotal"]);
  }
  for (const [index, row] of partial.rows.entries()) {
    const state = partial.valueStates[`rows.${index}.amount`];
    expect(["value", "zero"]).toContain(state);
    expect(row.amount.minorUnits === 0 ? "zero" : "value").toBe(state);
  }
  const partialModel = printModel(partial);
  expect([
    [printedFact(partialModel, "coverage_state"), partialModel.notes.some((note) => note.includes("Coverage is partial"))],
    [partialModel.inProgress, partialModel.statusLabel],
  ]).toEqual([
    ["partial", true],
    [true, "In progress"],
  ]);
  // The same rows under complete coverage are the same figures with the derived state gone, which is what makes the state derived from coverage rather than chosen by whoever built the fixture.
  const complete = run(queryOf(document), projectionOf(document, { coverage: { from: PERIOD_FROM, to: PERIOD_TO, state: "complete" } }));
  expect([summaryFor(complete, "USD").received.minorUnits, summaryFor(complete, "USD").received.valueState, printModel(complete).notes.some((note) => note.includes("Coverage is partial"))]).toEqual([summaryFor(partial, "USD").received.minorUnits, "value", false]);
  // A genuine zero for a currency the partition names and no row matched, under coverage that covers the period: the entry states zero rather than a gap, and its months are still gaps.
  const zeroQuery = run(queryOf(document, { period: { kind: "explicit", from: day(BULK_FIRST_DAY), to: day("2026-04-30") }, currency: { kind: "one", currency: "EUR" } }), bulkProjectionOf(document));
  const zeroEntry = summaryFor(zeroQuery, "EUR");
  expect([zeroEntry.received, zeroEntry.giftCount, [zeroQuery.total, seriesPointsOf(zeroQuery, "EUR").every((point) => point.gap)]]).toEqual([{ minorUnits: 0, valueState: "zero" }, { count: 0, valueState: "zero" }, [0, true]]);
  const unknownCoverage = run(queryOf(document), projectionOf(document, { coverage: { from: null, to: null, state: "unknown" } })); // Coverage the source never stated states no amount at all rather than a total of a period whose extent is unknown, and the page says so.
  expect(summaryFor(unknownCoverage, "USD").received).toEqual({ minorUnits: null, valueState: "unknown" });
  expect(printModel(unknownCoverage).notes.some((note) => note.includes("Coverage is unknown"))).toBe(true);
});
it("gaps, coverage and percentages: states no percentage for a zero denominator and keeps a valid 120% at 120%", () => {
  const quarter = { kind: "explicit", from: day(BULK_FIRST_DAY), to: day("2026-04-30") } as const;
  const coverage: Coverage = { from: PERIOD_FROM, to: PERIOD_TO, state: "complete" };
  const goalIn = (currency: string, minorUnits: number): SupportGoalRecord => ({ amount: amount(currency, minorUnits), measure: GOAL_MEASURE, effectiveFrom: "2026-01-01", revision: "1" });
  const progressWith = (goal: SupportGoalRecord, overrides: Partial<ReportQuery> = {}) => required(run(queryOf(document, { period: quarter, ...overrides }), projectionOf(document, { coverage, gifts: bulkGiftRows(), goal })).goal, "the goal progress the projection states");
  const reached = progressWith(goalIn("USD", 1000000));
  expect([reached.state, reached.percentageBasisPoints]).toEqual(["value", 12000]);
  for (const expected of [10000, 120]) expect(reached.percentageBasisPoints).not.toBe(expected);
  const noDenominator = progressWith(goalIn("USD", 0)); // A zero denominator yields no percentage at all rather than a division by nothing.
  expect([noDenominator.state, noDenominator.percentageBasisPoints]).toEqual(["no-percentage", null]);
  const emptyCurrencyGoal = progressWith(goalIn("EUR", 1000000));
  expect([emptyCurrencyGoal.state, emptyCurrencyGoal.percentageBasisPoints]).toEqual(["zero", 0]);
  const otherCurrency = progressWith(goalIn("EUR", 1000000), { currency: { kind: "one", currency: "USD" } }); // A query restricted to a different currency cannot state the goal at all, so it is incompatible rather than computed from another currency's amount.
  expect([otherCurrency.state, otherCurrency.percentageBasisPoints]).toEqual(["incompatible", null]);
});
it("gaps, coverage and percentages: states a change as a signed difference whose deltas reconcile, with no percentage to divide by", () => {
  const result = run(queryOf(document, { reportId: "period-comparison" }), projectionOf(document));
  const comparison = required(result.comparison, "the comparison the period report states");
  expect([comparison.equalElapsed, [comparison.current.from.toString(), comparison.current.to.toString()], comparison.reconciles]).toEqual([true, [PERIOD_FROM, PERIOD_TO], true]);
  const usd = firstWhere(comparison.perCurrency, "currency", "USD", "the USD entry of the comparison");
  // The comparison states a signed difference and a direction. There is no percentage field at all, so a zero baseline cannot produce a division by it.
  expect([Object.keys(usd), Object.keys(usd).filter((key) => key.toLowerCase().includes("percent"))]).toEqual([["currency", "currentMinor", "baselineMinor", "differenceMinor", "direction", "valueState"], []]);
  // No USD row falls in the equal-elapsed baseline window, so the baseline is a recorded zero and the difference is the whole of the current period.
  expect([usd.baselineMinor, usd.differenceMinor, usd.direction, addMinor(amount("USD", usd.currentMinor), negateMinor(amount("USD", usd.baselineMinor))).minorUnits]).toEqual([0, usd.currentMinor, "increase", usd.differenceMinor]);
  const usdDeltas = comparison.contributorDeltas.filter((delta) => delta.currency === "USD").map((delta) => amount("USD", delta.minorUnits)); // The contributor deltas add up to that difference exactly, so the comparison explains itself rather than gaining a fabricated balancing entry.
  expect(usdDeltas.length).toBeGreaterThan(0);
  expect(minorTotalOf(usdDeltas, "USD")).toBe(usd.differenceMinor);
});
it("gaps, coverage and percentages: bounds the contributor list one document carries, while the count and the reconciliation still cover every change", () => {
  // Forty partners, each with one current-period gift and no earlier-period gift: forty contributor changes in one currency, which is more than the report states in one document. Every amount differs, so the fifteen smallest changes are the ones left out.
  const giftedOn = day("2026-03-01");
  const rows: readonly GiftRow[] = Array.from({ length: 40 }, (_unused, index) => {
    const giftId = `gift-bounded-${String(index).padStart(2, "0")}`;
    return {
      giftRowId: `${giftId}-row`,
      giftId,
      amount: amount("USD", 1000 + index),
      originalGiftOn: giftedOn,
      datePrecision: "date",
      attribution: { kind: "partner", partnerId: `partner-bounded-${String(index).padStart(2, "0")}` },
      provenance: { system: "finance", reference: giftId },
      entryOn: giftedOn,
    } satisfies GiftRow;
  });
  const result = run(queryOf(document, { reportId: "period-comparison" }), projectionOf(document, { coverage: { from: PERIOD_FROM, to: PERIOD_TO, state: "complete" }, gifts: rows }));
  const comparison = required(result.comparison, "the comparison the period report states");
  const listed = comparison.contributorDeltas.filter((delta) => delta.currency === "USD");
  const difference = firstWhere(comparison.perCurrency, "currency", "USD", "the USD entry of the comparison").differenceMinor;
  // The stated list is bounded at the limit and holds the largest changes, in the report's own attribution order rather than a ranking, so the fifteen smallest changes are the ones the document does not carry.
  expect([listed.length, listed.map((delta) => delta.partnerId ?? "unattributed")]).toEqual([CONTRIBUTOR_DELTA_LIMIT, Array.from({ length: CONTRIBUTOR_DELTA_LIMIT }, (_unused, index) => `partner-bounded-${String(index + 15).padStart(2, "0")}`)]);
  // The whole count and the reconciliation are computed over every change, so a bounded list leaves the difference unexplained on this page but never false: the figure, the count and the partition still describe all forty.
  const listedUnits = minorTotalOf(
    listed.map((delta) => amount("USD", delta.minorUnits)),
    "USD",
  );
  expect([comparison.contributorDeltaCounts["USD"], comparison.reconciles, listedUnits === difference, difference, summaryFor(result, "USD").received.minorUnits]).toEqual([40, true, false, 40780, 40780]);
});
it("withholding and non-derivability: states only what the projection carried, so a hidden amount is in no artifact", () => {
  const result = run(queryOf(document, { search: "gift-harbour-0002" }), projectionOf(document));
  const stated = collectMinorUnits(result);
  expect(stated.length).toBeGreaterThan(0);
  expect(stated.every((units) => units === 4000)).toBe(true);
  for (const expected of [10000, 6000]) expect(stated).not.toContain(expected);
  // No artifact states a remainder either: the page, the series and the printed table all carry the authorised figure, so nothing can be recovered from them by subtraction.
  expect([[result.total, minorTotalOf(seriesAmountsOf(result, "USD"), "USD")], printedAmountsOf(printModel(result)).map((entry) => entry.minorUnits)]).toEqual([[1, 4000], [4000]]);
});
it("withholding and non-derivability: has no field that could state a remainder or a total including a hidden value", () => {
  const result = run(queryOf(document), projectionOf(document));
  const forbidden = /other|remainder|including|unreported|unadjusted|gross/iu;
  expect(Object.keys(result).filter((key) => forbidden.test(key))).toEqual([]);
  for (const entry of result.summary) expect([Object.keys(entry).filter((key) => forbidden.test(key)), Object.keys(entry.received).filter((key) => forbidden.test(key))]).toEqual([[], []]);
  const comparison = required(result.comparison, "the comparison");
  expect(Object.keys(comparison).filter((key) => forbidden.test(key))).toEqual([]);
  for (const entry of comparison.perCurrency) expect(Object.keys(entry).filter((key) => forbidden.test(key))).toEqual([]);
  const headers = printModel(result).columns.map((column) => column.header); // The columns a page and a download carry are the row's own fields and nothing beside them, so a hidden amount has no cell to hide in.
  expect(headers).toContain("amount_minor_units");
  expect(headers.filter((header) => forbidden.test(header))).toEqual([]);
});
it("withholding and non-derivability: renders a withheld value with no digits, so no export or print can turn it into a zero", () => {
  // `runReport` never produces a withheld value — a projection holds only the rows this context may read, and hiding happens before the result is built — so the rendering is asserted where it lives: the one money formatter every surface, download and page reads.
  const withheld = formatMinor(amount("USD", 5000), "withheld", "en");
  expect([[withheld.text, withheld.plain], /\d/u.test(withheld.plain)]).toEqual([["Withheld", "Withheld"], false]);
  for (const needle of ["withheld", "subtraction"]) expect(withheld.accessibleLabel.toLowerCase()).toContain(needle);
  for (const state of ["unknown", "withheld", "unavailable"] as const) {
    const rendered = formatMinor(amount("USD", 5000), state, "en");
    for (const value of [rendered.plain.length, rendered.text.length]) expect(value).toBeGreaterThan(0);
    expect([/\d/u.test(rendered.plain), /\d/u.test(rendered.text)]).toEqual([false, false]);
  }
  for (const state of ["value", "zero", "incomplete-subtotal"] as const) expect(/\d/u.test(formatMinor(amount("USD", 5000), state, "en").plain)).toBe(true);
  expect(formatMinor(amount("USD", 0), "zero", "en").plain).not.toBe(withheld.plain);
});
it("withholding and non-derivability: adds anonymous support to the total without giving it an identity or a donor count", () => {
  const result = run(queryOf(document), projectionOf(document));
  const anonymous = result.rows.filter((row) => row.attribution.kind === "anonymous");
  expect(anonymous).toHaveLength(1);
  const row = required(anonymous[0], "the anonymous support row");
  expect(["partnerId" in row.attribution, row.amount.minorUnits, minorTotalOf(rowAmountsOf(result, "USD"), "USD"), summaryFor(result, "USD").donorCount.count]).toEqual([false, 5000, 24500, 4]);
  const partnerIds = new Set(result.rows.flatMap((each) => (each.attribution.kind === "partner" ? [each.attribution.partnerId] : [])));
  expect(partnerIds.size).toBe(7);
});
describe("the partner-by-month matrix reconciles to the same totals", () => {
  it("covers every currency and month, and gives every cell a drilldown of the same authority", () => {
    const { result, matrix } = matrixOf();
    expect(matrix.currencies).toEqual(result.snapshot.currencies);
    expect(matrix.months).toHaveLength(11);
    expect([required(matrix.months[0], "the matrix's first month").start.toString(), required(matrix.months.at(-1), "the matrix's last month").end.toString()]).toEqual([PERIOD_FROM, PERIOD_TO]);
    const expectedCells = matrix.currencies.length * matrix.months.length;
    expect(matrix.rows.length).toBeGreaterThan(0);
    for (const row of matrix.rows) {
      expect(row.cells).toHaveLength(expectedCells);
      for (const cell of row.cells) {
        const drilldown = drilldownOf(result, row, cell); // The drilldown is the same authority and the same filters, narrowed to this cell's month and attribution with no page window, so it opens the records behind the figure.
        expect([drilldown.scope, drilldown.partner, drilldown.currency]).toEqual([result.snapshot.scope, row.attribution, { kind: "one", currency: cell.currency }]);
        expect(drilldown.page).toBeUndefined();
        if (drilldown.period.kind !== "explicit") throw new Error("A matrix cell's drilldown states no explicit period, so it cannot name the month it sums.");
        expect([drilldown.period.from.toString(), drilldown.period.to.toString()]).toEqual([cell.bucketStart.toString(), cell.bucketEnd.toString()]);
      }
    }
  });
  it("sums every cell of a currency to the summary and every month's column to the series point", () => {
    const { result, matrix } = matrixOf();
    const unsupported = matrix.currencies.filter((currency) => exponentOf(currency) === undefined); // A cell is a sum, and a sum of a currency with no exponent is not a number, so such a cell states no amount: a month the source recorded a row in states it as unknown, and only a month it recorded nothing in is a gap.
    expect(unsupported).toEqual([UNKNOWN_CURRENCY]);
    const recorded = matrix.rows.flatMap((row) => row.cells.filter((cell) => unsupported.includes(cell.currency) && !cell.gap).map((cell) => ({ row, cell })));
    const unrecorded = matrix.rows.flatMap((row) => row.cells.filter((cell) => unsupported.includes(cell.currency) && cell.gap));
    expect([recorded.length > 0, unrecorded.length > 0]).toEqual([true, true]);
    expect([recorded.every(({ cell }) => cell.value.minorUnits === null), new Set(recorded.map(({ cell }) => cell.value.valueState))]).toEqual([true, new Set(["unknown"])]);
    // The cells that state an unknown amount are exactly the cells whose month holds a recorded row of that currency, so a recorded row is never collapsed into an absence and no gap is invented for a month no row falls in.
    expect(new Set(recorded.map(({ row, cell }) => matrixCellKey(row.attribution, cell.bucketStart)))).toEqual(new Set(result.rows.filter((row) => unsupported.includes(row.amount.currency)).map((row) => matrixCellKeyOfRow(matrix, row))));
    expect([unrecorded.every((cell) => cell.value.minorUnits === null), unrecorded.length + recorded.length]).toEqual([true, matrix.rows.length * matrix.months.length * unsupported.length]);
    expect(summaryFor(result, UNKNOWN_CURRENCY).received.minorUnits).toBeNull();
    for (const currency of matrix.currencies) {
      if (exponentOf(currency) === undefined) continue;
      const stated = matrix.rows.flatMap((row) => row.cells.filter((cell) => cell.currency === currency)).flatMap((cell) => (cell.gap || cell.value.minorUnits === null ? [] : [amount(currency, cell.value.minorUnits)]));
      expect(minorTotalOf(stated, currency)).toBe(summaryFor(result, currency).received.minorUnits);
    }
    for (const month of matrix.months) {
      for (const currency of matrix.currencies) {
        if (exponentOf(currency) === undefined) continue;
        const cellAmount = (row: MatrixRowModel) => {
          const cell = row.cells.find((candidate) => candidate.currency === currency && candidate.bucketStart.equals(month.start)) ?? throwing("A matrix row states no cell for a month the matrix itself lists.");
          return cell.gap || cell.value.minorUnits === null ? [] : [amount(currency, cell.value.minorUnits)];
        };
        const column = matrix.rows.flatMap(cellAmount);
        const pointSought = seriesPointsOf(result, currency).find((candidate) => candidate.bucketStart.equals(month.start));
        const point = required(pointSought, `the ${currency} series point for ${month.start.toString()}`);
        expect([column.length === 0, column.length === 0 ? null : minorTotalOf(column, currency)]).toEqual([point.gap, point.gap ? null : point.value.minorUnits]);
      }
    }
  });
  it("sums a row of cells to the same attribution's total in the same result", () => {
    const { result, matrix } = matrixOf();
    const partnerRow = matrixRowOf(matrix, "partner-hana-nakamura", "the matrix row of the split gift's donor");
    const cellAmounts = partnerRow.cells.flatMap((cell) => (cell.currency === "USD" && !cell.gap && cell.value.minorUnits !== null ? [amount("USD", cell.value.minorUnits)] : []));
    const rowAmounts = result.rows.filter((row) => row.attribution.kind === "partner" && row.attribution.partnerId === "partner-hana-nakamura" && row.amount.currency === "USD").map((row) => row.amount);
    expect(cellAmounts.length).toBeGreaterThan(0);
    expect([minorTotalOf(cellAmounts, "USD"), minorTotalOf(rowAmounts, "USD")]).toEqual([4000, minorTotalOf(cellAmounts, "USD")]);
  });
  it("returns a drilldown whose rows are a subset of the parent and whose sums add to the cell", () => {
    const { result, matrix, projection } = matrixOf();
    const splitRow = matrixRowOf(matrix, "partner-hana-nakamura", "the matrix row of the split gift's donor");
    const cell = cellOf(splitRow, "USD", "2026-10-01", "the October USD cell of the split gift's donor");
    expect([cell.gap, cell.value.minorUnits]).toEqual([false, 4000]);
    const drilldown = run(drilldownOf(result, splitRow, cell), projection);
    const parentRowIds = new Set(result.rows.map((row) => row.giftRowId));
    expect(drilldown.rows.length).toBeGreaterThan(0);
    for (const row of drilldown.rows) expect(parentRowIds.has(row.giftRowId)).toBe(true);
    expect([[drilldown.total, summaryFor(drilldown, "USD").received.minorUnits], drilldown.snapshot.scope]).toEqual([[drilldown.rows.length, cell.value.minorUnits], result.snapshot.scope]);
  });
  it("states a cell with nothing in it as a gap and returns nothing for its drilldown", () => {
    const { result, matrix, projection } = matrixOf();
    const partnerRow = matrixRowOf(matrix, "partner-jo-mbeki", "the matrix row of the November gift's donor");
    const january = cellOf(partnerRow, "USD", "2026-01-01", "the January USD cell of the November gift's donor");
    expect(january.gap).toBe(true);
    expect(january.value.minorUnits).not.toBe(0);
    expect(january.value.minorUnits).toBeNull();
    const empty = run(drilldownOf(result, partnerRow, january), projection);
    expect([empty.total, empty.rows]).toEqual([0, []]);
    const november = cellOf(partnerRow, "USD", "2026-11-01", "the November USD cell of the November gift's donor");
    expect([november.gap, november.value.minorUnits]).toEqual([false, 12500]);
  });
  it("keeps an unknown-currency row as an exact record, stating its one recorded month as an unknown amount rather than a sum", () => {
    const { result, matrix, projection } = matrixOf();
    const unresolvedSought = matrix.rows.find((row) => row.attribution.kind === "unresolved");
    const unresolved = required(unresolvedSought, "the unattributed matrix row");
    const unknownCells = unresolved.cells.filter((cell) => cell.currency === UNKNOWN_CURRENCY);
    expect(unknownCells).toHaveLength(11);
    const cellSought = unknownCells.find((candidate) => candidate.bucketStart.toString() === "2026-08-01");
    const cell = required(cellSought, "the August cell of the unattributed row");
    expect([cell.gap, cell.value.minorUnits, cell.value.valueState]).toEqual([false, null, "unknown"]); // The source recorded this gift in August, so the month states an unknown amount where a month it recorded no row in states a gap.
    expect([unknownCells.filter((each) => each.gap).length, unknownCells.filter((each) => !each.gap).length]).toEqual([10, 1]);
    expect(unknownCells.filter((each) => each.gap).every((each) => each.value.minorUnits === null)).toBe(true);
    const drilldown = run(drilldownOf(result, unresolved, cell), projection);
    expect([drilldown.total, required(drilldown.rows[0], "the unattributed drilldown's single row").amount.currency]).toEqual([1, UNKNOWN_CURRENCY]);
  });
  // The matrix keeps the paging contract every list and report shares: 50 rows by default, a stated size capped at 200, the whole result's total stated, and a stale page clamped into the pages the result has.
  const pageCases: readonly { readonly stated: { readonly index: number; readonly size?: number }; readonly served: { readonly index: number; readonly size: number; readonly totalPages: number }; readonly rows: number; readonly first: string }[] = [
    { stated: { index: 0 }, served: { index: 0, size: PAGE_SIZE_DEFAULT, totalPages: 3 }, rows: 50, first: "partner-matrix-0000" },
    { stated: { index: 1 }, served: { index: 1, size: PAGE_SIZE_DEFAULT, totalPages: 3 }, rows: 50, first: "partner-matrix-0050" },
    { stated: { index: 2 }, served: { index: 2, size: PAGE_SIZE_DEFAULT, totalPages: 3 }, rows: 20, first: "partner-matrix-0100" },
    { stated: { index: 0, size: PAGE_SIZE_CAP * 2 }, served: { index: 0, size: PAGE_SIZE_CAP, totalPages: 1 }, rows: 120, first: "partner-matrix-0000" },
    { stated: { index: 9 }, served: { index: 2, size: PAGE_SIZE_DEFAULT, totalPages: 3 }, rows: 20, first: "partner-matrix-0100" },
  ];
  it.each(pageCases)("serves the page of $stated.index at $served.size rows and states the whole result's total", ({ stated, served, rows, first }) => {
    const result = run(queryOf(document, { reportId: "partner-month-matrix", page: stated }), matrixProjectionOf(document));
    const matrix = required(result.matrix, "the partner-by-month matrix");
    expect([matrix.total, matrix.page, matrix.rows.length]).toEqual([MATRIX_PARTNER_COUNT, served, rows]);
    expect(required(matrix.rows[0], "the matrix's first served row").partnerId).toBe(first);
    // A cell states its own figure and no copy of the query behind it: the drilldown is derived from the result's own query when the cell is opened.
    for (const row of matrix.rows) expect([row.cells.length, Object.keys(required(row.cells[0], "a served row's first cell"))]).toEqual([matrix.currencies.length * matrix.months.length, ["bucketStart", "bucketEnd", "currency", "value", "gap"]]);
    expect(JSON.stringify(matrix)).not.toContain('"drilldown"');
  });
});
