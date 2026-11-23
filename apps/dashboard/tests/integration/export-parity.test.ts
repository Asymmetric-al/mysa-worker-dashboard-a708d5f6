/** Whole-query agreement of the export: the integration half of success criterion 1, driven through the real store, the real service read and the real writers. */
import { parse } from "csv-parse/sync";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportResponse } from "@/app/api/export/respond";
import { reads } from "@/modules/data-service";
import type { SessionSource } from "@/modules/data-service/authorize";
import { buildWorkload } from "@/modules/dev-runtime/generate";
import { DEFAULT_SESSION_ID, seed, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { CSV_ALL_CURRENCIES, CSV_COLUMN_HEADERS, CSV_META_FIELD, CSV_RECORD_SEPARATOR, VALUE_STATE_TEXT, snapshotMetadata, toCsv } from "@/modules/export/csv";
import { NEUTRALISER_PREFIX, neutralizeCell } from "@/modules/export/neutralize";
import { printModel, type PrintFact } from "@/modules/export/print";
import { MoneyOperationError, addMinor, minorUnitsOf, type Money } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY, exponentOf } from "@/modules/money/currency";
import { formatMinor } from "@/modules/money/format";
import { resetSession } from "@/modules/store/repository";
import type { SessionDocuments } from "@/modules/store/paths";
import { SUPPORT_BASIS } from "@/modules/support/basis";
import { PAGE_SIZE_DEFAULT, type CurrencySummary, type ReportId, type ReportResult, type Snapshot } from "@/modules/support/report";
import { firstSaying, requiredSaying, throwing } from "../helpers/answers";
const formatCounters = vi.hoisted(() => ({ formatMinorCalls: 0 }));
vi.mock("@/modules/money/format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/money/format")>(); // Every assertion below reads the one formatter's real output; the wrapper only counts the renderings the writer asks for.
  return {
    ...actual,
    formatMinor: (...args: Parameters<typeof actual.formatMinor>) => {
      formatCounters.formatMinorCalls += 1;
      return actual.formatMinor(...args);
    },
  };
});
const SESSION_ID = "it-export-parity";
const REFUSED_SESSION_ID = "it-export-parity-refused";
const SESSION: SessionSource = { sessionId: SESSION_ID };
const REFUSED_SESSION: SessionSource = { sessionId: REFUSED_SESSION_ID };
const TIME_ZONE = "UTC";
const CLOSED_PERIOD = { kind: "explicit", from: "2022-11-01", to: "2026-11-19" } as const;
const RUNNING_PERIOD = { kind: "preset", preset: "this-month" } as const;
const GAP_PERIOD = { kind: "explicit", from: "2024-01-01", to: "2024-03-31" } as const;
const GAP_MONTH = "2024-02";
const EXPORT_REPORT_ID: ReportId = "received-period-and-year-to-date";
const ANONYMOUS_ROW_ID = "gift-row-harbour-0008";
const UNKNOWN_CURRENCY_ROW_ID = "gift-row-harbour-0007";
const LEADING_ZERO_ROW_ID = "gift-row-harbour-0001";
type SupportQuery = NonNullable<Parameters<typeof reads.export.readExport>[0]>;
type ExportedRow = Readonly<Record<string, string>>;
let sessionDocuments: SessionDocuments;
let refusedSessionDocuments: SessionDocuments;
function withVolumeRows(state: SessionStateDocument, sessionId: string): SessionStateDocument {
  return { ...state, context: { ...state.context, sessionId }, gifts: [...state.gifts, ...buildWorkload().gifts.slice(0, 400)] };
}
type EnvelopeOf<Result> = Result extends { readonly kind: "envelope"; readonly envelope: infer Envelope } ? Envelope : never;
type ExportEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.export.readExport>>>;
type ReportEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.support.readReport>>>;
type GiftsEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.support.readGifts>>>;
function requirementOfEnvelope<Envelope>(result: { readonly kind: string; readonly envelope?: Envelope }, job: string): Envelope {
  if (result.kind !== "envelope" || result.envelope === undefined) throw new Error(`The ${job} read answered "${result.kind}" instead of an envelope: ${JSON.stringify(result)}`);
  return result.envelope;
}
const exportEnvelope = async (query: SupportQuery): Promise<ExportEnvelope> => requirementOfEnvelope<ExportEnvelope>(await reads.export.readExport(query, SESSION), "readExport");
const reportEnvelope = async (reportId: ReportId, query: SupportQuery): Promise<ReportEnvelope> => requirementOfEnvelope<ReportEnvelope>(await reads.support.readReport(reportId, query, SESSION), `readReport(${reportId})`);
const giftsEnvelope = async (query: SupportQuery): Promise<GiftsEnvelope> => requirementOfEnvelope<GiftsEnvelope>(await reads.support.readGifts(query, SESSION), "readGifts");
type ParsedExport = { readonly meta: ReadonlyMap<string, string>; readonly header: readonly string[]; readonly rows: readonly ExportedRow[]; readonly records: readonly (readonly string[])[]; readonly lines: ReadonlySet<string> };
function parseExport(csv: string): ParsedExport {
  const records = parse(csv, { bom: true, relax_column_count: true }) as string[][];
  const meta = new Map<string, string>();
  const dataRecords: string[][] = [];
  let header: readonly string[] = [];
  for (const record of records) {
    const [first] = record;
    if (first === CSV_META_FIELD) {
      const [, field, value] = record;
      if (field === undefined || value === undefined) throw new Error(`A metadata record of the exported file states no field or no value: ${JSON.stringify(record)}`);
      meta.set(field, value);
      continue;
    }
    if (header.length === 0) {
      header = record;
      continue;
    }
    dataRecords.push(record);
  }
  const rows = dataRecords.map((record) => {
    const row: Record<string, string> = {};
    header.forEach((column, index) => {
      row[column] = record[index] ?? "";
    });
    return row;
  });
  return { meta, header, rows, records, lines: new Set(csv.split(CSV_RECORD_SEPARATOR)) };
}
/** The whole-query export, the paged report it is measured against, and the file parsed back: the three facts every agreement case starts from. */
async function exportedRun(): Promise<{ readonly exported: ExportEnvelope; readonly paged: ReportEnvelope; readonly parsed: ParsedExport }> {
  const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
  const paged = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
  return { exported, paged, parsed: parseExport(exported.data.csv) };
}
const cell = (row: ExportedRow, column: string): string => row[column] ?? "";
const rowById = (rows: readonly ExportedRow[], giftRowId: string): ExportedRow | undefined => rows.find((row) => cell(row, "gift_row_id") === giftRowId);
type ExportedSums = { readonly totals: readonly Money[]; readonly unstated: readonly string[] };
function moneyOfCell(currency: string, minorUnitsCell: string): Money | null {
  // A negative amount begins with the one character a spreadsheet reads as a formula, so the writer has prefixed the cell with the neutraliser's tab and the tab is part of the data the file carries. Exactly one prefix is removed here, which is the documented cost of that mitigation, and the value behind it is
  const value = minorUnitsCell.startsWith(NEUTRALISER_PREFIX) ? minorUnitsCell.slice(NEUTRALISER_PREFIX.length) : minorUnitsCell; // then read as an exact integer.
  if (!/^-?\d+$/.test(value)) return null;
  return { currency, minorUnits: minorUnitsOf(Number.parseInt(value, 10)) };
}
function sumExportedAmounts(rows: readonly ExportedRow[]): ExportedSums {
  const running = new Map<string, Money>();
  const unstated: string[] = [];
  for (const row of rows) {
    const currency = cell(row, "currency");
    const amount = moneyOfCell(currency, cell(row, "amount_minor_units"));
    if (amount === null) {
      unstated.push(cell(row, "gift_row_id"));
      continue;
    }
    const current = running.get(currency);
    running.set(currency, current === undefined ? amount : addMinor(current, amount));
  }
  return { totals: [...running.values()].sort(compareCurrencies), unstated };
}
function totalsOf(summary: readonly CurrencySummary[]): readonly Money[] {
  const totals: Money[] = [];
  for (const entry of summary) {
    if (entry.received.minorUnits === null) continue;
    totals.push({ currency: entry.currency, minorUnits: entry.received.minorUnits });
  }
  return totals.sort(compareCurrencies);
}
function compareCurrencies(left: Money, right: Money): number {
  if (left.currency === right.currency) return 0;
  return left.currency < right.currency ? -1 : 1;
}
function fractionDigitsOf(text: string): number {
  const [numeric] = text.split(" ");
  if (numeric === undefined) return 0;
  const point = numeric.indexOf(".");
  return point === -1 ? 0 : numeric.length - point - 1;
}
const factOf = (facts: readonly PrintFact[], field: string): string | undefined => facts.find((fact) => fact.field === field)?.value;
function snapshotIdentityOf(snapshot: Snapshot): Readonly<Record<string, unknown>> {
  return {
    reportId: snapshot.query.reportId,
    currency: snapshot.query.currency.kind === "one" ? `one:${snapshot.query.currency.currency}` : "all",
    period: { from: snapshot.period.from.toString(), to: snapshot.period.to.toString(), state: snapshot.period.state },
    scope: { ...snapshot.scope },
    basis: snapshot.basis,
    currencies: [...snapshot.currencies],
    coverage: { ...snapshot.coverage },
    asOf: snapshot.asOf,
    lastSourceUpdate: snapshot.lastSourceUpdate,
    source: { ...snapshot.source },
  };
}
beforeAll(async () => {
  const base = firstSaying(await seed(), "sessionId", DEFAULT_SESSION_ID, `The seed lays down no session "${DEFAULT_SESSION_ID}", so no export case can start from the seeded world.`);
  sessionDocuments = { state: withVolumeRows(base.documents.state, SESSION_ID), operations: base.documents.operations, meta: base.documents.meta };
  refusedSessionDocuments = { ...sessionDocuments, state: withVolumeRows(base.documents.state, REFUSED_SESSION_ID), meta: { ...base.documents.meta, admittedMemberships: [] } };
});
beforeEach(async () => {
  await resetSession(SESSION_ID, sessionDocuments); // Laid down again before every case, so a sibling suite's reset of the shared store leaves this file's world exactly as its assertions expect it, and so one case can never inherit another's writes.
  await resetSession(REFUSED_SESSION_ID, refusedSessionDocuments);
});
afterAll(async () => {
  for (const sessionId of [SESSION_ID, REFUSED_SESSION_ID]) await resetSession(sessionId);
});
describe("whole-query export agreement (criterion 1)", () => {
  it("takes one snapshot identity from one service read, and the same computation serves the screen", async () => {
    const report = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const { data: result } = report;
    expect(result.snapshot.basis).toBe(SUPPORT_BASIS);
    expect([result.snapshot.scope, [result.snapshot.asOf, result.snapshot.period.state, result.snapshot.query.period.kind]]).toEqual([report.scope, [report.asOf, "complete", "explicit"]]);
    expect(result.snapshot.currencies.length).toBeGreaterThan(1);
    for (const currency of ["USD", "EUR", "KWD", "JPY", UNKNOWN_CURRENCY]) expect(result.snapshot.currencies).toContain(currency);
    expect([result.snapshot.coverage.state, report.coverage.state, report.coverage.currency, report.coverage.dateBasis, result.valueStates["summary.USD.received"]]).toEqual(["partial", "partial", CSV_ALL_CURRENCIES, "original-gift-date", "incomplete-subtotal"]);
    expect([report.valueStates["summary.USD.received"], result.valueStates["rows.0.amount"], report.valueStates["rows.0.amount"]]).toEqual(["incomplete-subtotal", "value", "incomplete-subtotal"]);
    const ledger = await giftsEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    expect([[ledger.data.grain, ledger.data.report.total], ledger.data.report.summary]).toEqual([["gift-allocation", result.total], result.summary]);
    expect(ledger.data.report.snapshot.asOf).toBe(result.snapshot.asOf);
  });
  it("states the ledger's rows without the comparison its view never renders, while the report of the same query states it", async () => {
    const ledger = await giftsEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const report = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE }); // One computation over one query: the ledger asks for the projection its view renders and the report for the comparison it shows, so only that member differs.
    expect([ledger.data.report.comparison, Object.keys(ledger.valueStates).filter((path) => path.startsWith("comparison."))]).toEqual([undefined, []]);
    const comparison = report.data.comparison;
    expect([comparison?.equalElapsed, comparison?.reconciles, (comparison?.contributorDeltas.length ?? 0) > 0, report.valueStates["comparison.USD.current"]]).toEqual([true, true, true, "incomplete-subtotal"]);
    // The ledger states the value of every field its own envelope carries: no comparison, and the designation and attribution values its filters offer. Those two members are the only paths a report of the same query does not state, so both are dropped before the figures are compared.
    const statesOfOneQuery = (states: Readonly<Record<string, string>>): Readonly<Record<string, string>> => Object.fromEntries(Object.entries(states).filter(([path]) => !path.startsWith("comparison.") && !path.startsWith("facets.")));
    expect(statesOfOneQuery(ledger.valueStates)).toEqual(statesOfOneQuery(report.valueStates));
    expect([ledger.data.report.rows, ledger.data.report.summary, ledger.data.report.series, ledger.data.report.total, ledger.data.report.page]).toEqual([report.data.rows, report.data.summary, report.data.series, report.data.total, report.data.page]);
  });
  it("exports the whole query, never the loaded page", async () => {
    const { exported, paged, parsed } = await exportedRun();
    expect([parsed.meta.get("page"), parsed.rows.length, parsed.rows.length]).toEqual(["whole-query", exported.data.rowCount, paged.data.total]);
    expect(parsed.rows.length).toBeGreaterThan(PAGE_SIZE_DEFAULT);
    expect(paged.data.rows.length).toBe(PAGE_SIZE_DEFAULT);
    expect(paged.data.rows.length).toBeLessThan(paged.data.total);
    const printedPage = printModel(paged.data); // The export envelope carries no print model: the print view builds one from the report result it renders, so the printed page states the whole result's total and one page of it while the file holds every row.
    expect([printedPage.rowTotal, printedPage.rowTotal, printedPage.completeness, printedPage.notes.some((note) => note.includes("export the CSV for the complete result"))]).toEqual([exported.data.rowCount, parsed.rows.length, "page-only", true]);
    expect(printedPage.rows.map((row) => row[0]?.text ?? "")).toEqual(parsed.rows.slice(0, printedPage.rows.length).map((row) => cell(row, "gift_row_id")));
  });
  it("totals each currency exactly, and refuses to state a combined total across currencies", async () => {
    const { paged, parsed } = await exportedRun();
    const sums = sumExportedAmounts(parsed.rows);
    expect([sums.totals, sums.unstated]).toEqual([totalsOf(paged.data.summary), [UNKNOWN_CURRENCY_ROW_ID]]);
    expect(paged.data.summary.length).toBeGreaterThan(1);
    expect(paged.data.summary.map((entry) => entry.currency)).toEqual(["EUR", "JPY", "KWD", UNKNOWN_CURRENCY, "USD"]);
    for (const entry of paged.data.summary) expect(entry.received.valueState).not.toBe("value");
    const usd = totalsOf(paged.data.summary).find((total) => total.currency === "USD");
    const eur = totalsOf(paged.data.summary).find((total) => total.currency === "EUR");
    if (usd === undefined || eur === undefined) throw new Error("The seeded world holds no USD and EUR support in this period, so no cross-currency case can be made.");
    expect(() => addMinor(usd, eur)).toThrow(MoneyOperationError);
    expect([parsed.meta.get("amount_unit"), parsed.meta.has("amount_total")]).toEqual(["minor-units", false]);
    expect(new Set(parsed.rows.map((row) => cell(row, "currency"))).size).toBeGreaterThan(1);
  });
  it("states its own grain, basis, currency, period, coverage and snapshot instant before the rows", async () => {
    const { exported, parsed } = await exportedRun();
    const required = ["grain", "basis", "currency", "period_from", "period_to", "period_state", "coverage_from", "coverage_to", "coverage_state", "snapshot_as_of", "snapshot_query", "row_total", "amount_unit", "neutralisation", "page"];
    for (const field of required) expect(parsed.meta.get(field) ?? "").not.toBe("");
    expect([[...parsed.meta.keys()], [parsed.meta.get("grain"), parsed.meta.get("basis")?.startsWith(SUPPORT_BASIS), parsed.meta.get("period_from"), parsed.meta.get("period_to")]]).toEqual([required, ["gift-allocation", true, exported.data.snapshot.period.from.toString(), exported.data.snapshot.period.to.toString()]]);
    expect([parsed.meta.get("period_state"), parsed.meta.get("coverage_state"), parsed.meta.get("snapshot_as_of"), parsed.meta.get("row_total")]).toEqual([exported.data.snapshot.period.state, exported.data.snapshot.coverage.state, exported.data.snapshot.asOf, String(exported.data.rowCount)]);
    expect([parsed.meta.get("currency"), exported.coverage.currency]).toEqual([CSV_ALL_CURRENCIES, CSV_ALL_CURRENCIES]);
    // The printed table's columns are the file's columns: one column list, rendered by two writers from one result.
    expect([parsed.header, printModel((await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE })).data).columns.map((column) => column.header)]).toEqual([CSV_COLUMN_HEADERS, CSV_COLUMN_HEADERS]);
    const kwdRow = rowById(parsed.rows, "gift-row-harbour-0004");
    const jpyRow = rowById(parsed.rows, "gift-row-harbour-0005");
    if (kwdRow === undefined || jpyRow === undefined) throw new Error("The seeded three-decimal and zero-decimal gifts are not in the exported period.");
    expect([cell(kwdRow, "amount"), cell(kwdRow, "amount_minor_units"), fractionDigitsOf(cell(kwdRow, "amount")), cell(jpyRow, "amount"), cell(jpyRow, "amount_minor_units")]).toEqual(["1.250 KWD", "1250", exponentOf("KWD"), "5000 JPY", "5000"]);
    expect(fractionDigitsOf(cell(jpyRow, "amount"))).toBe(exponentOf("JPY"));
    const wrongExponent = parsed.rows.filter((row) => {
      const exponent = exponentOf(cell(row, "currency"));
      return exponent !== undefined && fractionDigitsOf(cell(row, "amount")) !== exponent;
    });
    expect(wrongExponent.map((row) => cell(row, "gift_row_id"))).toEqual([]);
    const leadingZero = rowById(parsed.rows, LEADING_ZERO_ROW_ID);
    expect(leadingZero).toBeDefined();
    expect(cell(leadingZero ?? {}, "gift_id")).toBe("gift-harbour-0001");
    expect(exported.data.csv).toContain(LEADING_ZERO_ROW_ID);
  });
  it("describes the query that produced it, rather than a report substituted for the one posted", async () => {
    const posted: SupportQuery = { reportId: "partner-month-matrix", period: CLOSED_PERIOD, timeZone: TIME_ZONE };
    const exported = await exportEnvelope(posted);
    const parsed = parseExport(exported.data.csv);
    const matrix = await reportEnvelope("partner-month-matrix", { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    // The filename, the snapshot and the file's own query record name the report the caller posted, so no reader of the file has to infer which of the four reports these rows came from.
    expect([exported.data.filename.startsWith("support-partner-month-matrix-"), exported.data.snapshot.query.reportId, parsed.meta.get("snapshot_query")?.split(";")[0]]).toEqual([true, "partner-month-matrix", "report=partner-month-matrix"]);
    // And the rows are that report's rows: the count and the per-currency minor-unit sums the screen holds for the same query.
    expect([parsed.rows.length, sumExportedAmounts(parsed.rows).totals]).toEqual([matrix.data.total, totalsOf(matrix.data.summary)]);
    expect(exported.data.rowCount).toBe(matrix.data.total);
  });
  it("never reveals a withheld or anonymous record, directly or by subtracting one figure from another", async () => {
    const { parsed, paged } = await exportedRun();
    const anonymousRow = requiredSaying(rowById(parsed.rows, ANONYMOUS_ROW_ID), "The seeded anonymous gift is not in the exported period.");
    expect([cell(anonymousRow, "attribution"), cell(anonymousRow, "partner_id"), cell(anonymousRow, "amount_minor_units")]).toEqual(["anonymous", "", "5000"]);
    const usd = firstSaying(paged.data.summary, "currency", "USD", "The seeded world holds no USD support in this period, so the anonymous case has nothing to compare with.");
    expect(usd.donorCount.count).toBeLessThan(usd.giftCount.count);
    const reportPrint = printModel(paged.data);
    const partnerColumn = reportPrint.columns.map((column) => column.header).indexOf("partner_id");
    const printedAnonymous = reportPrint.rows.find((row) => row[0]?.text === ANONYMOUS_ROW_ID);
    expect(printedAnonymous?.[partnerColumn]?.text).toBe(VALUE_STATE_TEXT.unknown);
    expect(printedAnonymous?.[partnerColumn]?.accessibleLabel ?? "").toContain("Partner");
    const splitRows = parsed.rows.filter((row) => cell(row, "gift_id") === "gift-harbour-0002");
    expect([splitRows.map((row) => cell(row, "gift_row_id")), cell(splitRows[0] ?? {}, "amount_minor_units")]).toEqual([["gift-row-harbour-0003"], "4000"]);
    expect(rowById(parsed.rows, "gift-row-harbour-0002")).toBeUndefined();
    // The refund is explained in place rather than hidden: a negative row naming the row it corrects. Its amount cell carries the neutraliser's prefix, because a leading minus would open a spreadsheet formula, and that prefix is exactly what the sum above strips before reading the count of minor units.
    const refundRow = rowById(parsed.rows, "gift-row-harbour-0010");
    expect([cell(refundRow ?? {}, "refund_of"), cell(refundRow ?? {}, "amount_minor_units"), new Set([VALUE_STATE_TEXT.zero, VALUE_STATE_TEXT.unknown, VALUE_STATE_TEXT.withheld, VALUE_STATE_TEXT.unavailable]).size]).toEqual(["gift-row-harbour-0009", `${NEUTRALISER_PREFIX}-7500`, 4]);
    const unknownRow = rowById(parsed.rows, UNKNOWN_CURRENCY_ROW_ID);
    expect([cell(unknownRow ?? {}, "amount"), cell(unknownRow ?? {}, "amount_minor_units"), cell(unknownRow ?? {}, "currency")]).toEqual([VALUE_STATE_TEXT.unknown, VALUE_STATE_TEXT.unknown, UNKNOWN_CURRENCY]);
    const unknownSummary = paged.data.summary.find((entry) => entry.currency === UNKNOWN_CURRENCY);
    expect(unknownSummary?.received.minorUnits).toBeNull();
    expect(unknownSummary?.received.valueState).toBe("unknown");
    // The withheld state, rendered by the same writer and the same print model from the same result: the cell becomes the word, and the printed page states that such a value is in no total and cannot be inferred by subtraction. (The support read states `unknown` for a value its source does not state;
    const withheldResult: ReportResult = { ...paged.data, valueStates: { ...paged.data.valueStates, "rows.0.amount": "withheld" } }; // `withheld` is the state the envelope admits for a value that exists and is not shown, so the writers' rendering of it is asserted here on the one result they are given.)
    const withheldRow = parseExport(await toCsv(withheldResult)).rows.find((row) => cell(row, "gift_row_id") === paged.data.rows[0]?.giftRowId);
    expect([cell(withheldRow ?? {}, "amount"), cell(withheldRow ?? {}, "amount_minor_units"), printModel(withheldResult).notes.some((note) => note.includes("withheld here"))]).toEqual([VALUE_STATE_TEXT.withheld, VALUE_STATE_TEXT.withheld, true]);
  });
  it("leaves the whole-query values where they were when the sort or the page window moves", async () => {
    const byAmount = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE, sort: { field: "amountMinor", direction: "desc" } });
    const byDate = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE, sort: { field: "originalGiftOn", direction: "asc" } });
    const amountRows = parseExport(byAmount.data.csv).rows;
    const dateRows = parseExport(byDate.data.csv).rows;
    expect(amountRows.length).toBe(dateRows.length);
    expect(sumExportedAmounts(amountRows).totals).toEqual(sumExportedAmounts(dateRows).totals);
    expect(amountRows.map((row) => cell(row, "gift_row_id"))).not.toEqual(dateRows.map((row) => cell(row, "gift_row_id")));
    const firstPage = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE, page: { index: 0, size: 25 } });
    const deepPage = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE, page: { index: 3, size: 25 } });
    expect([firstPage.data.rows.length, deepPage.data.rows.length]).toEqual([25, 25]);
    expect(firstPage.data.rows[0]?.giftRowId).not.toBe(deepPage.data.rows[0]?.giftRowId);
    expect([[deepPage.data.total, deepPage.data.total], deepPage.data.summary, sumExportedAmounts(amountRows).totals]).toEqual([[firstPage.data.total, amountRows.length], firstPage.data.summary, totalsOf(deepPage.data.summary)]);
  });
  it("prints the same result, with no rounded amount and no zero standing in for a missing month", async () => {
    const running = await reportEnvelope(EXPORT_REPORT_ID, { period: RUNNING_PERIOD, timeZone: TIME_ZONE });
    const runningPrint = printModel(running.data);
    expect([running.data.snapshot.period.state, runningPrint.inProgress, runningPrint.statusLabel, factOf(runningPrint.facts, "period_state"), factOf(runningPrint.facts, "coverage_state")]).toEqual(["in-progress", true, "In progress", "in-progress", running.data.snapshot.coverage.state]);
    expect(factOf(runningPrint.facts, "snapshot_as_of")).toBe(running.data.snapshot.asOf);
    expect(factOf(runningPrint.facts, "basis") ?? "").toContain(SUPPORT_BASIS);
    expect(runningPrint.notes.some((note) => note.includes("Coverage is partial"))).toBe(true);
    const printedTexts: string[] = [];
    const exactTexts: string[] = [];
    const wrongExponent: string[] = [];
    for (const entry of running.data.summary) {
      const line = runningPrint.summary.find((candidate) => candidate.label.includes(`(${entry.currency})`)) ?? throwing(`The printed page states no summary line for ${entry.currency}.`);
      printedTexts.push(line.text);
      exactTexts.push(formatMinor({ currency: entry.currency, minorUnits: entry.received.minorUnits ?? minorUnitsOf(0) }, entry.received.valueState, "en").text);
      const exponent = exponentOf(entry.currency);
      if (exponent !== undefined && fractionDigitsOf(line.text) !== exponent) wrongExponent.push(entry.currency);
    }
    expect([printedTexts, wrongExponent, runningPrint.summary.map((line) => line.state)]).toEqual([exactTexts, [], running.data.summary.map((entry) => entry.received.valueState)]);
    const closedPrint = printModel((await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE })).data);
    expect(closedPrint.inProgress).toBe(false);
    expect(closedPrint.statusLabel).toBeNull();
    const monthly = await reportEnvelope("monthly-history", { period: GAP_PERIOD, timeZone: TIME_ZONE });
    const monthlyPrint = printModel(monthly.data);
    const gapPoints = monthly.data.series.filter((point) => point.bucketStart.toString().startsWith(GAP_MONTH));
    expect(gapPoints.length).toBeGreaterThan(0);
    for (const point of gapPoints) {
      expect(point.gap).toBe(true);
      expect(point.value.minorUnits).toBeNull();
      expect([point.value.valueState, monthlyPrint.notes.some((note) => note.includes(point.bucketStart.toString()) && note.includes("gap, not zero"))]).toEqual(["unknown", true]);
    }
    expect(parseExport((await exportEnvelope({ period: GAP_PERIOD, timeZone: TIME_ZONE })).data.csv).rows.filter((row) => cell(row, "original_gift_on").startsWith(GAP_MONTH))).toEqual([]);
  });
  it("hands over a file rendered from the snapshot it states, and re-checks permission before building one", async () => {
    const { exported, paged, parsed } = await exportedRun();
    expect([snapshotIdentityOf(exported.data.snapshot), [...parsed.meta.entries()]]).toEqual([snapshotIdentityOf(paged.data.snapshot), exported.data.metadata.map((fact) => [fact.field, fact.value])]);
    const pageDependent = new Set(["snapshot_query", "page"]); // One writer states the same facts on screen, in the file and on the printed page; the two that name a page window are left out, because that read states one page where the file is the whole query.
    expect(printModel(paged.data).facts.filter((fact) => !pageDependent.has(fact.field))).toEqual(exported.data.metadata.filter((fact) => !pageDependent.has(fact.field)));
    expect(exported.data.metadata.filter((fact) => !pageDependent.has(fact.field))).toEqual(snapshotMetadata(paged.data).filter((fact) => !pageDependent.has(fact.field)));
    const headerRecord = parsed.records.find((record) => record[0] !== CSV_META_FIELD);
    const unknownRecord = parsed.records.find((record) => record[0] === UNKNOWN_CURRENCY_ROW_ID);
    for (const record of [headerRecord, unknownRecord]) {
      if (record === undefined) throw new Error("The exported file is missing a record this case compares with the one writer's output.");
      expect(parsed.lines.has(record.map((value) => neutralizeCell(value)).join(","))).toBe(true);
    }
    expect([sumExportedAmounts(parsed.rows).totals, exported.actions.some((action) => action.name === "exportQuery" && action.available)]).toEqual([totalsOf(paged.data.summary), true]);
    const refusedExport = await reads.export.readExport({ period: CLOSED_PERIOD, timeZone: TIME_ZONE }, REFUSED_SESSION);
    expect([refusedExport.kind, Object.keys(refusedExport)]).toEqual(["denied", ["kind", "denied"]]);
    if (refusedExport.kind !== "denied") throw new Error(`The refused principal's export answered "${refusedExport.kind}".`);
    expect(refusedExport.denied.reasonCode).toBe("no-membership");
    const refusedReport = await reads.support.readReport(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE }, REFUSED_SESSION);
    expect(refusedReport.kind).toBe("denied");
    if (refusedReport.kind !== "denied") throw new Error(`The refused principal's report answered "${refusedReport.kind}".`);
    expect(refusedReport.denied.reasonCode).toBe(refusedExport.denied.reasonCode);
  });
  it("answers the envelope itself, with its CSV carried through the slices character for character", async () => {
    const envelope = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const response = exportResponse({ kind: "envelope", envelope });
    expect([response.status, response.headers.get("content-type"), response.headers.get("cache-control")]).toEqual([200, "application/json; charset=utf-8", "no-store"]);
    const body = await response.text();
    expect(envelope.data.csv.length).toBeGreaterThan(65536); // A file longer than one slice, so the case crosses many of the writer's boundaries rather than one.
    // The bytes on the wire are exactly the envelope's own JSON, so a client reading this response reads the same file, row count, provenance records and snapshot the envelope states.
    expect(body).toBe(JSON.stringify(envelope));
    expect((JSON.parse(body) as ExportEnvelope).data.csv).toBe(envelope.data.csv);
  });
});
describe("an export whose caller has gone", () => {
  it("stops for a caller that left before or during the file, and answers it nothing", async () => {
    const alreadyGone = await reads.export.readExport({ period: CLOSED_PERIOD, timeZone: TIME_ZONE }, SESSION, AbortSignal.abort()).then(
      () => throwing("The export read answered a caller that had already gone, so a file was built for nobody."),
      (error: unknown) => error,
    );
    expect([alreadyGone instanceof DOMException, (alreadyGone as DOMException).name]).toEqual([true, "AbortError"]);
    const { data: result } = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const caller = new AbortController();
    const building = toCsv(result, caller.signal);
    caller.abort(); // The caller's socket closes mid-file: the writer's first turn has begun and has not yet resumed, which is the state the abandoned export reaches.
    const stopped = await building.then(
      () => throwing("The writer finished a file whose caller had gone, so the whole CSV was built for nobody."),
      (error: unknown) => error,
    );
    expect([stopped instanceof DOMException, (stopped as DOMException).name]).toEqual([true, "AbortError"]);
  });
});
describe("the exporter's formatting cost", () => {
  it("formats each monetary row once and writes both amount columns from that one rendering", async () => {
    const { data: result } = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    formatCounters.formatMinorCalls = 0;
    const parsed = parseExport(await toCsv(result));
    const monetaryRows = parsed.rows.filter((row) => !new Set<string>(Object.values(VALUE_STATE_TEXT)).has(cell(row, "amount")));
    expect([parsed.rows.length, monetaryRows.length > 0]).toEqual([PAGE_SIZE_DEFAULT, true]);
    expect(formatCounters.formatMinorCalls).toBe(monetaryRows.length); // The amount column expands to two cells, and both are written from the one rendering the first of them asks for: a rendering per cell would ask for twice this count.
    for (const row of monetaryRows) expect(moneyOfCell(cell(row, "currency"), cell(row, "amount_minor_units"))).not.toBeNull();
  });
});
