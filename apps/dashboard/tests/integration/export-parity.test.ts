/** Whole-query agreement of the export: the integration half of success criterion 1, driven through the real store, the real service read and the real writers. */
import { parse } from "csv-parse/sync";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const SESSION_ID = "it-export-parity";
const REFUSED_SESSION_ID = "it-export-parity-refused";
const SESSION: SessionSource = { sessionId: SESSION_ID };
const REFUSED_SESSION: SessionSource = { sessionId: REFUSED_SESSION_ID };
const TIME_ZONE = "UTC";
const formatCounters = vi.hoisted(() => ({ formatMinorCalls: 0 }));
vi.mock("@/modules/money/format", async (importOriginal) => {
  // Every assertion below reads the one formatter's real output; the wrapper only counts how many renderings the
  // writer asks for, which is the cost the exporter pays per row.
  const actual = await importOriginal<typeof import("@/modules/money/format")>();
  return {
    ...actual,
    formatMinor: (...args: Parameters<typeof actual.formatMinor>) => {
      formatCounters.formatMinorCalls += 1;
      return actual.formatMinor(...args);
    },
  };
});
const CLOSED_PERIOD = { kind: "explicit", from: "2022-11-01", to: "2026-11-19" } as const;
const RUNNING_PERIOD = { kind: "preset", preset: "this-month" } as const;
const GAP_PERIOD = { kind: "explicit", from: "2024-01-01", to: "2024-03-31" } as const;
const GAP_MONTH = "2024-02";
const EXPORT_REPORT_ID: ReportId = "received-period-and-year-to-date";
const VOLUME_ROWS = 400;
const SPLIT_GIFT_ID = "gift-harbour-0002";
const SPLIT_ALLOCATION_ROW_ID = "gift-row-harbour-0003";
const SPLIT_GIFT_GRAIN_ROW_ID = "gift-row-harbour-0002";
const ANONYMOUS_ROW_ID = "gift-row-harbour-0008";
const UNKNOWN_CURRENCY_ROW_ID = "gift-row-harbour-0007";
const KWD_ROW_ID = "gift-row-harbour-0004";
const JPY_ROW_ID = "gift-row-harbour-0005";
const REFUND_ROW_ID = "gift-row-harbour-0010";
const LEADING_ZERO_ROW_ID = "gift-row-harbour-0001";
const LEADING_ZERO_GIFT_ID = "gift-harbour-0001";
const MINOR_UNITS_CELL = /^-?\d+$/;
type SupportQuery = NonNullable<Parameters<typeof reads.export.readExport>[0]>;
type ExportedRow = Readonly<Record<string, string>>;
let sessionDocuments: SessionDocuments;
let refusedSessionDocuments: SessionDocuments;
function withVolumeRows(state: SessionStateDocument, sessionId: string): SessionStateDocument {
  const volumeRows = buildWorkload().gifts.slice(0, VOLUME_ROWS);
  return { ...state, context: { ...state.context, sessionId }, gifts: [...state.gifts, ...volumeRows] };
}
type EnvelopeOf<Result> = Result extends { readonly kind: "envelope"; readonly envelope: infer Envelope } ? Envelope : never;
type ExportEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.export.readExport>>>;
type ReportEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.support.readReport>>>;
type GiftsEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.support.readGifts>>>;
function requirementOfEnvelope<Envelope>(result: { readonly kind: string; readonly envelope?: Envelope }, job: string): Envelope {
  if (result.kind !== "envelope" || result.envelope === undefined) throw new Error(`The ${job} read answered "${result.kind}" instead of an envelope: ${JSON.stringify(result)}`);
  return result.envelope;
}
async function exportEnvelope(query: SupportQuery): Promise<ExportEnvelope> {
  return requirementOfEnvelope<ExportEnvelope>(await reads.export.readExport(query, SESSION), "readExport");
}
async function reportEnvelope(reportId: ReportId, query: SupportQuery): Promise<ReportEnvelope> {
  return requirementOfEnvelope<ReportEnvelope>(await reads.support.readReport(reportId, query, SESSION), `readReport(${reportId})`);
}
async function giftsEnvelope(query: SupportQuery): Promise<GiftsEnvelope> {
  return requirementOfEnvelope<GiftsEnvelope>(await reads.support.readGifts(query, SESSION), "readGifts");
}
interface ParsedExport {
  readonly meta: ReadonlyMap<string, string>;
  readonly header: readonly string[];
  readonly rows: readonly ExportedRow[];
  readonly records: readonly (readonly string[])[];
  readonly lines: ReadonlySet<string>;
}
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
function cell(row: ExportedRow, column: string): string {
  return row[column] ?? "";
}
function rowById(rows: readonly ExportedRow[], giftRowId: string): ExportedRow | undefined {
  return rows.find((row) => cell(row, "gift_row_id") === giftRowId);
}
interface ExportedSums {
  readonly totals: readonly Money[];
  readonly unstated: readonly string[];
}
function moneyOfCell(currency: string, minorUnitsCell: string): Money | null {
  // A negative amount begins with the one character a spreadsheet reads as a formula, so the writer has
  // prefixed the cell with the neutraliser's tab and the tab is part of the data the file carries. Exactly
  // one prefix is removed here, which is the documented cost of that mitigation, and the value behind it is
  // then read as an exact integer.
  const value = minorUnitsCell.startsWith(NEUTRALISER_PREFIX) ? minorUnitsCell.slice(NEUTRALISER_PREFIX.length) : minorUnitsCell;
  if (!MINOR_UNITS_CELL.test(value)) return null;
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
function factOf(facts: readonly PrintFact[], field: string): string | undefined {
  return facts.find((fact) => fact.field === field)?.value;
}
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
  const sessions = await seed();
  const base = sessions.find((session) => session.sessionId === DEFAULT_SESSION_ID);
  if (base === undefined) throw new Error(`The seed lays down no session "${DEFAULT_SESSION_ID}", so no export case can start from the seeded world.`);
  sessionDocuments = { state: withVolumeRows(base.documents.state, SESSION_ID), operations: base.documents.operations, meta: base.documents.meta };
  refusedSessionDocuments = { ...sessionDocuments, state: withVolumeRows(base.documents.state, REFUSED_SESSION_ID), meta: { ...base.documents.meta, admittedMemberships: [] } };
});
beforeEach(async () => {
  // Laid down again before every case, so a sibling suite's reset of the shared store leaves this file's
  // world exactly as its assertions expect it, and so one case can never inherit another's writes.
  await resetSession(SESSION_ID, sessionDocuments);
  await resetSession(REFUSED_SESSION_ID, refusedSessionDocuments);
});
afterAll(async () => {
  await resetSession(SESSION_ID);
  await resetSession(REFUSED_SESSION_ID);
});
describe("whole-query export agreement (criterion 1)", () => {
  it("takes one snapshot identity from one service read, and the same computation serves the screen", async () => {
    const report = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const { data: result } = report;
    expect(result.snapshot.basis).toBe(SUPPORT_BASIS);
    expect(result.snapshot.scope).toEqual(report.scope);
    expect(result.snapshot.asOf).toBe(report.asOf);
    expect(result.snapshot.period.state).toBe("complete");
    expect(result.snapshot.query.period.kind).toBe("explicit");
    expect(result.snapshot.currencies.length).toBeGreaterThan(1);
    for (const currency of ["USD", "EUR", "KWD", "JPY", UNKNOWN_CURRENCY]) {
      expect(result.snapshot.currencies).toContain(currency);
    }
    expect(result.snapshot.coverage.state).toBe("partial");
    expect(report.coverage.state).toBe("partial");
    expect(report.coverage.currency).toBe(CSV_ALL_CURRENCIES);
    expect(report.coverage.dateBasis).toBe("original-gift-date");
    expect(result.valueStates["summary.USD.received"]).toBe("incomplete-subtotal");
    expect(report.valueStates["summary.USD.received"]).toBe("incomplete-subtotal");
    expect(result.valueStates["rows.0.amount"]).toBe("value");
    expect(report.valueStates["rows.0.amount"]).toBe("incomplete-subtotal");
    const ledger = await giftsEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    expect(ledger.data.grain).toBe("gift-allocation");
    expect(ledger.data.report.total).toBe(result.total);
    expect(ledger.data.report.summary).toEqual(result.summary);
    expect(ledger.data.report.snapshot.asOf).toBe(result.snapshot.asOf);
  });
  it("exports the whole query, never the loaded page", async () => {
    const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const paged = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const parsed = parseExport(exported.data.csv);
    expect(parsed.meta.get("page")).toBe("whole-query");
    expect(parsed.rows.length).toBe(exported.data.rowCount);
    expect(parsed.rows.length).toBe(paged.data.total);
    expect(parsed.rows.length).toBeGreaterThan(PAGE_SIZE_DEFAULT);
    expect(paged.data.rows.length).toBe(PAGE_SIZE_DEFAULT);
    expect(paged.data.rows.length).toBeLessThan(paged.data.total);
    // The export envelope carries no print model: the print view builds one from the report result it renders, so the
    // printed page is taken from that same query's read. It states the whole result's total and says it holds one page
    // of it, while the file holds every row — and the page's rows are the file's first rows, in the file's own order.
    const printedPage = printModel(paged.data);
    expect(printedPage.rowTotal).toBe(exported.data.rowCount);
    expect(printedPage.rowTotal).toBe(parsed.rows.length);
    expect(printedPage.completeness).toBe("page-only");
    expect(printedPage.notes.some((note) => note.includes("export the CSV for the complete result"))).toBe(true);
    expect(printedPage.rows.map((row) => row[0]?.text ?? "")).toEqual(parsed.rows.slice(0, printedPage.rows.length).map((row) => cell(row, "gift_row_id")));
  });
  it("totals each currency exactly, and refuses to state a combined total across currencies", async () => {
    const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const paged = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const parsed = parseExport(exported.data.csv);
    const sums = sumExportedAmounts(parsed.rows);
    expect(sums.totals).toEqual(totalsOf(paged.data.summary));
    expect(sums.unstated).toEqual([UNKNOWN_CURRENCY_ROW_ID]);
    expect(paged.data.summary.length).toBeGreaterThan(1);
    expect(paged.data.summary.map((entry) => entry.currency)).toEqual(["EUR", "JPY", "KWD", UNKNOWN_CURRENCY, "USD"]);
    for (const entry of paged.data.summary) {
      expect(entry.received.valueState).not.toBe("value");
    }
    const usd = totalsOf(paged.data.summary).find((total) => total.currency === "USD");
    const eur = totalsOf(paged.data.summary).find((total) => total.currency === "EUR");
    if (usd === undefined || eur === undefined) throw new Error("The seeded world holds no USD and EUR support in this period, so no cross-currency case can be made.");
    expect(() => addMinor(usd, eur)).toThrow(MoneyOperationError);
    expect(parsed.meta.get("amount_unit")).toBe("minor-units");
    expect(parsed.meta.has("amount_total")).toBe(false);
    expect(new Set(parsed.rows.map((row) => cell(row, "currency"))).size).toBeGreaterThan(1);
  });
  it("states its own grain, basis, currency, period, coverage and snapshot instant before the rows", async () => {
    const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const parsed = parseExport(exported.data.csv);
    const required = ["grain", "basis", "currency", "period_from", "period_to", "period_state", "coverage_from", "coverage_to", "coverage_state", "snapshot_as_of", "snapshot_query", "row_total", "amount_unit", "neutralisation", "page"];
    for (const field of required) {
      expect(parsed.meta.get(field) ?? "").not.toBe("");
    }
    expect([...parsed.meta.keys()]).toEqual(required);
    expect(parsed.meta.get("grain")).toBe("gift-allocation");
    expect(parsed.meta.get("basis")?.startsWith(SUPPORT_BASIS)).toBe(true);
    expect(parsed.meta.get("period_from")).toBe(exported.data.snapshot.period.from.toString());
    expect(parsed.meta.get("period_to")).toBe(exported.data.snapshot.period.to.toString());
    expect(parsed.meta.get("period_state")).toBe(exported.data.snapshot.period.state);
    expect(parsed.meta.get("coverage_state")).toBe(exported.data.snapshot.coverage.state);
    expect(parsed.meta.get("snapshot_as_of")).toBe(exported.data.snapshot.asOf);
    expect(parsed.meta.get("row_total")).toBe(String(exported.data.rowCount));
    expect(parsed.meta.get("currency")).toBe(UNKNOWN_CURRENCY);
    expect(parsed.header).toEqual(CSV_COLUMN_HEADERS);
    // The printed table's columns are the file's columns: one column list, rendered by two writers from one result.
    const printed = printModel((await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE })).data);
    expect(printed.columns.map((column) => column.header)).toEqual(CSV_COLUMN_HEADERS);
    const kwdRow = rowById(parsed.rows, KWD_ROW_ID);
    const jpyRow = rowById(parsed.rows, JPY_ROW_ID);
    if (kwdRow === undefined || jpyRow === undefined) throw new Error("The seeded three-decimal and zero-decimal gifts are not in the exported period.");
    expect(cell(kwdRow, "amount")).toBe("1.250 KWD");
    expect(cell(kwdRow, "amount_minor_units")).toBe("1250");
    expect(fractionDigitsOf(cell(kwdRow, "amount"))).toBe(exponentOf("KWD"));
    expect(cell(jpyRow, "amount")).toBe("5000 JPY");
    expect(cell(jpyRow, "amount_minor_units")).toBe("5000");
    expect(fractionDigitsOf(cell(jpyRow, "amount"))).toBe(exponentOf("JPY"));
    const wrongExponent = parsed.rows.filter((row) => {
      const exponent = exponentOf(cell(row, "currency"));
      return exponent !== undefined && fractionDigitsOf(cell(row, "amount")) !== exponent;
    });
    expect(wrongExponent.map((row) => cell(row, "gift_row_id"))).toEqual([]);
    const leadingZero = rowById(parsed.rows, LEADING_ZERO_ROW_ID);
    expect(leadingZero).toBeDefined();
    expect(cell(leadingZero ?? {}, "gift_id")).toBe(LEADING_ZERO_GIFT_ID);
    expect(exported.data.csv).toContain(LEADING_ZERO_ROW_ID);
  });
  it("never reveals a withheld or anonymous record, directly or by subtracting one figure from another", async () => {
    const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const paged = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const parsed = parseExport(exported.data.csv);
    const anonymousRow = rowById(parsed.rows, ANONYMOUS_ROW_ID);
    if (anonymousRow === undefined) throw new Error("The seeded anonymous gift is not in the exported period.");
    expect(cell(anonymousRow, "attribution")).toBe("anonymous");
    expect(cell(anonymousRow, "partner_id")).toBe("");
    expect(cell(anonymousRow, "amount_minor_units")).toBe("5000");
    const usd = paged.data.summary.find((entry) => entry.currency === "USD");
    if (usd === undefined) throw new Error("The seeded world holds no USD support in this period, so the anonymous case has nothing to compare with.");
    expect(usd.donorCount.count).toBeLessThan(usd.giftCount.count);
    // The printed page states the same thing as the file. Its model comes from the report result the print view
    // renders rather than from the export envelope, so the report is narrowed to the anonymous attribution, which puts
    // the row on the page that the print view would be given.
    const anonymousPrint = printModel((await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE, partner: { kind: "anonymous" } })).data);
    const partnerColumn = anonymousPrint.columns.map((column) => column.header).indexOf("partner_id");
    const printedAnonymous = anonymousPrint.rows.find((row) => row[0]?.text === ANONYMOUS_ROW_ID);
    expect(printedAnonymous).toBeDefined();
    expect(printedAnonymous?.[partnerColumn]?.text).toBe(VALUE_STATE_TEXT.unknown);
    expect(printedAnonymous?.[partnerColumn]?.accessibleLabel ?? "").toContain("Partner");
    const splitRows = parsed.rows.filter((row) => cell(row, "gift_id") === SPLIT_GIFT_ID);
    expect(splitRows.map((row) => cell(row, "gift_row_id"))).toEqual([SPLIT_ALLOCATION_ROW_ID]);
    expect(cell(splitRows[0] ?? {}, "amount_minor_units")).toBe("4000");
    expect(rowById(parsed.rows, SPLIT_GIFT_GRAIN_ROW_ID)).toBeUndefined();
    // The refund is explained in place rather than hidden: a negative row naming the row it corrects. Its
    // amount cell carries the neutraliser's prefix, because a leading minus would open a spreadsheet formula,
    // and that prefix is exactly what the sum above strips before reading the count of minor units.
    const refundRow = rowById(parsed.rows, REFUND_ROW_ID);
    expect(cell(refundRow ?? {}, "refund_of")).toBe("gift-row-harbour-0009");
    expect(cell(refundRow ?? {}, "amount_minor_units")).toBe(`${NEUTRALISER_PREFIX}-7500`);
    expect(new Set([VALUE_STATE_TEXT.zero, VALUE_STATE_TEXT.unknown, VALUE_STATE_TEXT.withheld, VALUE_STATE_TEXT.unavailable]).size).toBe(4);
    const unknownRow = rowById(parsed.rows, UNKNOWN_CURRENCY_ROW_ID);
    expect(cell(unknownRow ?? {}, "amount")).toBe(VALUE_STATE_TEXT.unknown);
    expect(cell(unknownRow ?? {}, "amount_minor_units")).toBe(VALUE_STATE_TEXT.unknown);
    expect(cell(unknownRow ?? {}, "currency")).toBe(UNKNOWN_CURRENCY);
    const unknownSummary = paged.data.summary.find((entry) => entry.currency === UNKNOWN_CURRENCY);
    expect(unknownSummary?.received.minorUnits).toBeNull();
    expect(unknownSummary?.received.valueState).toBe("unknown");
    // The withheld state, rendered by the same writer and the same print model from the same result: the
    // cell becomes the word, and the printed page states that such a value is in no total and cannot be
    // inferred by subtraction. (The support read states `unknown` for a value its source does not state;
    // `withheld` is the state the envelope admits for a value that exists and is not shown, so the
    // writers' rendering of it is asserted here on the one result they are given.)
    const withheldResult: ReportResult = { ...paged.data, valueStates: { ...paged.data.valueStates, "rows.0.amount": "withheld" } };
    const withheldRows = parseExport(toCsv(withheldResult)).rows;
    const firstRowId = paged.data.rows[0]?.giftRowId;
    const withheldRow = withheldRows.find((row) => cell(row, "gift_row_id") === firstRowId);
    expect(cell(withheldRow ?? {}, "amount")).toBe(VALUE_STATE_TEXT.withheld);
    expect(cell(withheldRow ?? {}, "amount_minor_units")).toBe(VALUE_STATE_TEXT.withheld);
    expect(printModel(withheldResult).notes.some((note) => note.includes("withheld here"))).toBe(true);
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
    expect(firstPage.data.rows.length).toBe(25);
    expect(deepPage.data.rows.length).toBe(25);
    expect(firstPage.data.rows[0]?.giftRowId).not.toBe(deepPage.data.rows[0]?.giftRowId);
    expect(deepPage.data.total).toBe(firstPage.data.total);
    expect(deepPage.data.total).toBe(amountRows.length);
    expect(deepPage.data.summary).toEqual(firstPage.data.summary);
    expect(sumExportedAmounts(amountRows).totals).toEqual(totalsOf(deepPage.data.summary));
  });
  it("prints the same result, with no rounded amount and no zero standing in for a missing month", async () => {
    const running = await reportEnvelope(EXPORT_REPORT_ID, { period: RUNNING_PERIOD, timeZone: TIME_ZONE });
    const runningPrint = printModel(running.data);
    expect(running.data.snapshot.period.state).toBe("in-progress");
    expect(runningPrint.inProgress).toBe(true);
    expect(runningPrint.statusLabel).toBe("In progress");
    expect(factOf(runningPrint.facts, "period_state")).toBe("in-progress");
    expect(factOf(runningPrint.facts, "coverage_state")).toBe(running.data.snapshot.coverage.state);
    expect(factOf(runningPrint.facts, "snapshot_as_of")).toBe(running.data.snapshot.asOf);
    expect(factOf(runningPrint.facts, "basis") ?? "").toContain(SUPPORT_BASIS);
    expect(runningPrint.notes.some((note) => note.includes("Coverage is partial"))).toBe(true);
    const printedTexts: string[] = [];
    const exactTexts: string[] = [];
    const wrongExponent: string[] = [];
    for (const entry of running.data.summary) {
      const line = runningPrint.summary.find((candidate) => candidate.label.includes(`(${entry.currency})`));
      if (line === undefined) throw new Error(`The printed page states no summary line for ${entry.currency}.`);
      printedTexts.push(line.text);
      exactTexts.push(formatMinor({ currency: entry.currency, minorUnits: entry.received.minorUnits ?? minorUnitsOf(0) }, entry.received.valueState, "en").text);
      const exponent = exponentOf(entry.currency);
      if (exponent !== undefined && fractionDigitsOf(line.text) !== exponent) {
        wrongExponent.push(entry.currency);
      }
    }
    expect(printedTexts).toEqual(exactTexts);
    expect(wrongExponent).toEqual([]);
    expect(runningPrint.summary.map((line) => line.state)).toEqual(running.data.summary.map((entry) => entry.received.valueState));
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
      expect(point.value.valueState).toBe("unknown");
      expect(monthlyPrint.notes.some((note) => note.includes(point.bucketStart.toString()) && note.includes("gap, not zero"))).toBe(true);
    }
    const gapFile = parseExport((await exportEnvelope({ period: GAP_PERIOD, timeZone: TIME_ZONE })).data.csv);
    expect(gapFile.rows.filter((row) => cell(row, "original_gift_on").startsWith(GAP_MONTH))).toEqual([]);
  });
  it("hands over a file rendered from the snapshot it states, and re-checks permission before building one", async () => {
    const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const paged = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    expect(snapshotIdentityOf(exported.data.snapshot)).toEqual(snapshotIdentityOf(paged.data.snapshot));
    const parsed = parseExport(exported.data.csv);
    expect([...parsed.meta.entries()]).toEqual(exported.data.metadata.map((fact) => [fact.field, fact.value]));
    // One writer states the same facts on screen, in the file and on the printed page. The export envelope carries no
    // print model, so the printed page's facts are taken from the report read of the same query; the two facts that
    // state a page window are left out, because that read's window is one page where the file is the whole query.
    const pageDependent = new Set(["snapshot_query", "page"]);
    const printedFacts = printModel(paged.data).facts;
    expect(printedFacts.filter((fact) => !pageDependent.has(fact.field))).toEqual(exported.data.metadata.filter((fact) => !pageDependent.has(fact.field)));
    expect(exported.data.metadata.filter((fact) => !pageDependent.has(fact.field))).toEqual(snapshotMetadata(paged.data).filter((fact) => !pageDependent.has(fact.field)));
    const headerRecord = parsed.records.find((record) => record[0] !== CSV_META_FIELD);
    const unknownRecord = parsed.records.find((record) => record[0] === UNKNOWN_CURRENCY_ROW_ID);
    for (const record of [headerRecord, unknownRecord]) {
      if (record === undefined) throw new Error("The exported file is missing a record this case compares with the one writer's output.");
      expect(parsed.lines.has(record.map((value) => neutralizeCell(value)).join(","))).toBe(true);
    }
    expect(sumExportedAmounts(parsed.rows).totals).toEqual(totalsOf(paged.data.summary));
    expect(exported.actions.some((action) => action.name === "exportQuery" && action.available)).toBe(true);
    const refusedExport = await reads.export.readExport({ period: CLOSED_PERIOD, timeZone: TIME_ZONE }, REFUSED_SESSION);
    expect(refusedExport.kind).toBe("denied");
    expect(Object.keys(refusedExport)).toEqual(["kind", "denied"]);
    if (refusedExport.kind !== "denied") throw new Error(`The refused principal's export answered "${refusedExport.kind}".`);
    expect(refusedExport.denied.reasonCode).toBe("no-membership");
    const refusedReport = await reads.support.readReport(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE }, REFUSED_SESSION);
    expect(refusedReport.kind).toBe("denied");
    if (refusedReport.kind !== "denied") throw new Error(`The refused principal's report answered "${refusedReport.kind}".`);
    expect(refusedReport.denied.reasonCode).toBe(refusedExport.denied.reasonCode);
  });
});
describe("the exporter's formatting cost", () => {
  it("formats each monetary row once and writes both amount columns from that one rendering", async () => {
    const { data: result } = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    formatCounters.formatMinorCalls = 0;
    const parsed = parseExport(toCsv(result));
    const markers = new Set<string>(Object.values(VALUE_STATE_TEXT));
    const monetaryRows = parsed.rows.filter((row) => !markers.has(cell(row, "amount")));
    expect(parsed.rows).toHaveLength(PAGE_SIZE_DEFAULT);
    expect(monetaryRows.length).toBeGreaterThan(0);
    // The amount column expands to two cells, and both are written from the one rendering the first of them asks
    // for: a rendering per cell would ask for twice this count, which is the cost this case holds down.
    expect(formatCounters.formatMinorCalls).toBe(monetaryRows.length);
    for (const row of monetaryRows) {
      expect(moneyOfCell(cell(row, "currency"), cell(row, "amount_minor_units"))).not.toBeNull();
    }
  });
});
