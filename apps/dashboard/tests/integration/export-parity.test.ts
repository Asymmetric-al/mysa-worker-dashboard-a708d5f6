/**
 * Whole-query agreement of the export: the integration half of success criterion 1, driven through
 * the real store, the real service read and the real writers.
 *
 * AAP 0.12.2 fixes the comparison this file makes: one query is executed once and captured with a
 * snapshot identity — query, scope, currency, period, basis, coverage and `asOf` — and every artifact
 * is read back against that one `ReportResult`. The artifacts compared here are the CSV file
 * (`toCsv`), the print model (`printModel`) and, through `readExport`, the file the application hands
 * a worker: the export must hold the whole query rather than the loaded page, must agree in count and
 * in minor-unit sums per currency with the summary of the same result, must state its own grain,
 * basis, currency, period, coverage and snapshot instant, must never reveal what the screen withheld,
 * and must not move when the sort or the page window moves.
 *
 * Nothing on this path is mocked, and that is deliberate: a mocked store or a mocked writer would
 * prove the mock, while the failures this file exists to exclude — a page-only file, a combined total
 * across currencies, a float in a monetary sum, a withheld value revealed by subtraction, a zero
 * standing in for a missing month — only appear when the whole path runs. Every expected value is
 * taken from the `ReportResult` the artifact was rendered from. Re-aggregating the rows here to build
 * an independent expected total would make the assertion prove this test instead of the one report
 * function `runReport`, which is the single producer of every financial number in this application.
 */
import { parse } from "csv-parse/sync";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
// The session this file owns
/**
 * A session id of this file's own, so a sibling suite's reset of the seeded world cannot strand it: the
 * documents below are built from the seed once and laid down again before every case.
 */
const SESSION_ID = "it-export-parity";
/**
 * The same records under a session whose admission no longer covers the context it has selected — a
 * membership removed while a tab stayed open. It is the unauthorised principal this file needs, and it
 * is a state the application really reaches: nothing about it is invented for the test.
 */
const REFUSED_SESSION_ID = "it-export-parity-refused";
const SESSION: SessionSource = { sessionId: SESSION_ID };
const REFUSED_SESSION: SessionSource = { sessionId: REFUSED_SESSION_ID };
/** The zone every period in this file is resolved in, so no host zone leaks into a boundary. */
const TIME_ZONE = "UTC";
/** A closed period that spans the whole seeded history: complete, and wider than any page window. */
const CLOSED_PERIOD = { kind: "explicit", from: "2022-11-01", to: "2026-11-19" } as const;
/** The period the scenario clock sits inside (the seed instant is 2026-11-20), so it is still running. */
const RUNNING_PERIOD = { kind: "preset", preset: "this-month" } as const;
/** Three months of 2024, whose middle month the source holds no gift for. */
const GAP_PERIOD = { kind: "explicit", from: "2024-01-01", to: "2024-03-31" } as const;
const GAP_MONTH = "2024-02";
/** The one report the export renders, so the file and the report read are the same computation. */
const EXPORT_REPORT_ID: ReportId = "received-period-and-year-to-date";
/**
 * Gift rows taken from the published workload generator.
 *
 * The readable seed holds eleven gifts, which is fewer than one page: an export that silently applied
 * the default page size would still have looked complete, so this file's world carries enough rows for
 * a page-limited file to be visibly short. The rows are the generator's own first rows, deterministic
 * from its fixed seed, so the volume costs no checked-in fixture and no hand-built amount. The
 * hundred-thousand-row measurement is `tests/integration/workload-timing.test.ts`'s job; generating
 * the whole workload here would spend the suite's budget re-proving what that suite already times.
 */
const VOLUME_ROWS = 400;
/** The seeded gifts the boundary assertions address by identity. */
const SPLIT_GIFT_ID = "gift-harbour-0002";
const SPLIT_ALLOCATION_ROW_ID = "gift-row-harbour-0003";
const SPLIT_GIFT_GRAIN_ROW_ID = "gift-row-harbour-0002";
const ANONYMOUS_ROW_ID = "gift-row-harbour-0008";
const UNKNOWN_CURRENCY_ROW_ID = "gift-row-harbour-0007";
const KWD_ROW_ID = "gift-row-harbour-0004";
const JPY_ROW_ID = "gift-row-harbour-0005";
const REFUND_ROW_ID = "gift-row-harbour-0010";
/** A leading-zero identifier, asserted character for character through the writer and the parser. */
const LEADING_ZERO_ROW_ID = "gift-row-harbour-0001";
const LEADING_ZERO_GIFT_ID = "gift-harbour-0001";
/** The exact cell that holds an integer count of minor units, so no formatted text is ever summed. */
const MINOR_UNITS_CELL = /^-?\d+$/;
/** The query shape every read in this file takes. */
type SupportQuery = NonNullable<Parameters<typeof reads.export.readExport>[0]>;
/** One gift row of the exported file, keyed by the header the writer states. */
type ExportedRow = Readonly<Record<string, string>>;
// The documents this file's sessions start from
let sessionDocuments: SessionDocuments;
let refusedSessionDocuments: SessionDocuments;

/**
 * Adds the volume rows to the established worker's records.
 *
 * The state document is the seed's own, with only the gift collection extended, so every other
 * family the seed lays down is untouched. The context's session id is restated as the owning session's
 * id, because the document set and the session it is laid down for must name the same session.
 */
function withVolumeRows(state: SessionStateDocument, sessionId: string): SessionStateDocument {
  const volumeRows = buildWorkload().gifts.slice(0, VOLUME_ROWS);
  return {
    ...state,
    context: { ...state.context, sessionId },
    gifts: [...state.gifts, ...volumeRows],
  };
}
/** The envelope a read answers with, derived from the read itself so no second declaration can drift from it. */
type EnvelopeOf<Result> = Result extends { readonly kind: "envelope"; readonly envelope: infer Envelope } ? Envelope : never;
type ExportEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.export.readExport>>>;
type ReportEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.support.readReport>>>;
type GiftsEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.support.readGifts>>>;
/** States that a read answered with its envelope, naming the job when it did not, so no case reads a refusal as data. */
function requirementOfEnvelope<Envelope>(result: { readonly kind: string; readonly envelope?: Envelope }, job: string): Envelope {
  if (result.kind !== "envelope" || result.envelope === undefined) {
    throw new Error(`The ${job} read answered "${result.kind}" instead of an envelope: ${JSON.stringify(result)}`);
  }
  return result.envelope;
}
/** The export's envelope for one query — the file, the print model and the snapshot it states. */
async function exportEnvelope(query: SupportQuery): Promise<ExportEnvelope> {
  return requirementOfEnvelope<ExportEnvelope>(await reads.export.readExport(query, SESSION), "readExport");
}
/** The fixed report's envelope for one query — the `ReportResult` every financial surface reads. */
async function reportEnvelope(reportId: ReportId, query: SupportQuery): Promise<ReportEnvelope> {
  return requirementOfEnvelope<ReportEnvelope>(await reads.support.readReport(reportId, query, SESSION), `readReport(${reportId})`);
}
/** The Gifts ledger's envelope for one query — the screen's own path to the same computation. */
async function giftsEnvelope(query: SupportQuery): Promise<GiftsEnvelope> {
  return requirementOfEnvelope<GiftsEnvelope>(await reads.support.readGifts(query, SESSION), "readGifts");
}
// Reading the file back
interface ParsedExport {
  /** One entry per metadata record the file states before its header, in the order it states them. */
  readonly meta: ReadonlyMap<string, string>;
  /** The column header record, exactly as parsed. */
  readonly header: readonly string[];
  /** The data records, keyed by column header; an absent cell parses as the empty string. */
  readonly rows: readonly ExportedRow[];
  /** Every raw record of the file, metadata, header and data alike. */
  readonly records: readonly (readonly string[])[];
  /** The file's own lines, so a record can be compared with what the writer would have produced for it. */
  readonly lines: ReadonlySet<string>;
}
/**
 * Parses an exported file with the same `csv-parse` the contact importer uses.
 *
 * `bom: true` is not decoration: the first record of this file is a metadata record, so an unstripped
 * byte-order mark would corrupt its first key and the grain, basis and coverage would all be lost.
 * `relax_column_count` is needed because the metadata records carry three fields and the data records
 * carry one per column.
 */
function parseExport(csv: string): ParsedExport {
  const records = parse(csv, { bom: true, relax_column_count: true }) as string[][];
  const meta = new Map<string, string>();
  const dataRecords: string[][] = [];
  let header: readonly string[] = [];
  for (const record of records) {
    const [first] = record;
    if (first === CSV_META_FIELD) {
      const [, field, value] = record;
      if (field === undefined || value === undefined) {
        throw new Error(`A metadata record of the exported file states no field or no value: ${JSON.stringify(record)}`);
      }
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
/** Reads one cell of an exported row, with an absent cell stated as the empty string rather than as undefined. */
function cell(row: ExportedRow, column: string): string {
  return row[column] ?? "";
}
/** The row carrying one gift row identity, or `undefined` when the file does not hold it. */
function rowById(rows: readonly ExportedRow[], giftRowId: string): ExportedRow | undefined {
  return rows.find((row) => cell(row, "gift_row_id") === giftRowId);
}
// Reading the numbers back out of the file
interface ExportedSums {
  /** One exact total per currency the file states an amount in. */
  readonly totals: readonly Money[];
  /** The gift rows whose amount cell states a word rather than a number, by identity. */
  readonly unstated: readonly string[];
}
/**
 * Reads one row's exact amount, or `null` when the cell states a word instead of a number.
 *
 * The count of minor units is the only monetary value this test takes out of a file: the human-facing
 * `amount` cell is formatted text and is asserted against, never summed. The cell is an exact integer,
 * read as a number once so the money module can brand it; `minorUnitsOf` refuses anything that is not a
 * safe integer, and every addition goes through `addMinor`, so no fractional value and no floating-point
 * arithmetic ever touches a financial total here.
 */
function moneyOfCell(currency: string, minorUnitsCell: string): Money | null {
  // A negative amount begins with the one character a spreadsheet reads as a formula, so the writer has
  // prefixed the cell with the neutraliser's tab and the tab is part of the data the file carries. Exactly
  // one prefix is removed here, which is the documented cost of that mitigation, and the value behind it is
  // then read as an exact integer.
  const value = minorUnitsCell.startsWith(NEUTRALISER_PREFIX) ? minorUnitsCell.slice(NEUTRALISER_PREFIX.length) : minorUnitsCell;
  if (!MINOR_UNITS_CELL.test(value)) {
    return null;
  }
  return { currency, minorUnits: minorUnitsOf(Number.parseInt(value, 10)) };
}
/** Totals the file's rows per currency, and names the rows that stated no amount at all. */
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
/** The summary's per-currency received amounts, at the same grain the file's rows sum to. */
function totalsOf(summary: readonly CurrencySummary[]): readonly Money[] {
  const totals: Money[] = [];
  for (const entry of summary) {
    if (entry.received.minorUnits === null) {
      continue;
    }
    totals.push({ currency: entry.currency, minorUnits: entry.received.minorUnits });
  }
  return totals.sort(compareCurrencies);
}
function compareCurrencies(left: Money, right: Money): number {
  if (left.currency === right.currency) {
    return 0;
  }
  return left.currency < right.currency ? -1 : 1;
}
/** The decimal places a rendered amount carries, which must be the currency's own exponent and nothing else. */
function fractionDigitsOf(text: string): number {
  const [numeric] = text.split(" ");
  if (numeric === undefined) {
    return 0;
  }
  const point = numeric.indexOf(".");
  return point === -1 ? 0 : numeric.length - point - 1;
}
/** The value of one snapshot fact, or `undefined` when the page or the file does not state it. */
function factOf(facts: readonly PrintFact[], field: string): string | undefined {
  return facts.find((fact) => fact.field === field)?.value;
}
/**
 * Everything a snapshot states about itself except the page window.
 *
 * The export is deliberately unpaged and the report read is paged, so their queries differ in exactly
 * that one field — and the comparison below is what proves that everything else about the two answers,
 * including the currency partition, the coverage and the instant they were read at, is the same
 * snapshot rather than two computations that happen to agree.
 */
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
// The world every case starts from
beforeAll(async () => {
  const sessions = await seed();
  const base = sessions.find((session) => session.sessionId === DEFAULT_SESSION_ID);
  if (base === undefined) {
    throw new Error(`The seed lays down no session "${DEFAULT_SESSION_ID}", so no export case can start from the seeded world.`);
  }
  sessionDocuments = {
    state: withVolumeRows(base.documents.state, SESSION_ID),
    operations: base.documents.operations,
    meta: base.documents.meta,
  };
  refusedSessionDocuments = {
    ...sessionDocuments,
    state: withVolumeRows(base.documents.state, REFUSED_SESSION_ID),
    meta: { ...base.documents.meta, admittedMemberships: [] },
  };
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
// The agreement itself
describe("whole-query export agreement (criterion 1)", () => {
  it("takes one snapshot identity from one service read, and the same computation serves the screen", async () => {
    // Why this shape: every other case compares an artifact with this result, so the identity asserted
    // here is the one all of them are read against — the query, the authority, the basis, the currency
    // partition, the period, the coverage and the instant.
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
    // The coverage the source states is partial, and the envelope derives the one state a caller may not
    // choose: every subtotal of this result is an incomplete subtotal, not a total.
    expect(result.snapshot.coverage.state).toBe("partial");
    expect(report.coverage.state).toBe("partial");
    expect(report.coverage.currency).toBe(CSV_ALL_CURRENCIES);
    expect(report.coverage.dateBasis).toBe("original-gift-date");
    expect(result.valueStates["summary.USD.received"]).toBe("incomplete-subtotal");
    expect(report.valueStates["summary.USD.received"]).toBe("incomplete-subtotal");
    // A single row's amount is a recorded value on the result the writers read, while the envelope derives
    // the partial-coverage state for it — the two states must not be conflated by a surface.
    expect(result.valueStates["rows.0.amount"]).toBe("value");
    expect(report.valueStates["rows.0.amount"]).toBe("incomplete-subtotal");
    // The Gifts ledger is the same computation under the same query, not a second reading of it.
    const ledger = await giftsEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    expect(ledger.data.grain).toBe("gift-allocation");
    expect(ledger.data.report.total).toBe(result.total);
    expect(ledger.data.report.summary).toEqual(result.summary);
    expect(ledger.data.report.snapshot.asOf).toBe(result.snapshot.asOf);
  });

  it("exports the whole query, never the loaded page", async () => {
    // Excludes: an export that silently applies the default page window. With 410 rows in this world, a
    // fifty-row file would parse as fifty rows and fail the equality with the whole-result total.
    const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const paged = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const parsed = parseExport(exported.data.csv);
    expect(parsed.meta.get("page")).toBe("whole-query");
    expect(parsed.rows.length).toBe(exported.data.rowCount);
    expect(parsed.rows.length).toBe(paged.data.total);
    expect(parsed.rows.length).toBeGreaterThan(PAGE_SIZE_DEFAULT);
    // The screen's page is visibly smaller than the file, which is why a page-only file could not pass.
    expect(paged.data.rows.length).toBe(PAGE_SIZE_DEFAULT);
    expect(paged.data.rows.length).toBeLessThan(paged.data.total);
    expect(exported.data.print.rowTotal).toBe(exported.data.rowCount);
    expect(exported.data.print.completeness).toBe("whole-query");
    // A surface showing a page says so, and points at the file for the complete result.
    const printedPage = printModel(paged.data);
    expect(printedPage.completeness).toBe("page-only");
    expect(printedPage.notes.some((note) => note.includes("export the CSV for the complete result"))).toBe(true);
    // The file's rows are the printed page's rows, in the order the service returned them.
    expect(parsed.rows.map((row) => cell(row, "gift_row_id"))).toEqual(exported.data.print.rows.map((row) => row[0]?.text ?? ""));
  });

  it("totals each currency exactly, and refuses to state a combined total across currencies", async () => {
    // Excludes: a float in a monetary sum, and a single total spanning two currencies. Both sums below are
    // integers in minor units added by `addMinor`; the expected value is the summary of the same result.
    const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const paged = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const parsed = parseExport(exported.data.csv);
    const sums = sumExportedAmounts(parsed.rows);
    expect(sums.totals).toEqual(totalsOf(paged.data.summary));
    // One row states no number at all: the gift whose currency the source never identified. It is named
    // here so the totals above are known to be a partition of every other row rather than of an assumption.
    expect(sums.unstated).toEqual([UNKNOWN_CURRENCY_ROW_ID]);
    // The partition: one summary entry per currency, and no entry that spans them.
    expect(paged.data.summary.length).toBeGreaterThan(1);
    expect(paged.data.summary.map((entry) => entry.currency)).toEqual(["EUR", "JPY", "KWD", UNKNOWN_CURRENCY, "USD"]);
    for (const entry of paged.data.summary) {
      expect(entry.received.valueState).not.toBe("value");
    }
    // Two currencies cannot be added at all, which is what keeps a combined total from being expressible.
    const usd = totalsOf(paged.data.summary).find((total) => total.currency === "USD");
    const eur = totalsOf(paged.data.summary).find((total) => total.currency === "EUR");
    if (usd === undefined || eur === undefined) {
      throw new Error("The seeded world holds no USD and EUR support in this period, so no cross-currency case can be made.");
    }
    expect(() => addMinor(usd, eur)).toThrow(MoneyOperationError);
    // The file states one amount unit and never a monetary total, so a reader of it alone cannot add the
    // currencies together either.
    expect(parsed.meta.get("amount_unit")).toBe("minor-units");
    expect(parsed.meta.has("amount_total")).toBe(false);
    expect(new Set(parsed.rows.map((row) => cell(row, "currency"))).size).toBeGreaterThan(1);
  });

  it("states its own grain, basis, currency, period, coverage and snapshot instant before the rows", async () => {
    // Excludes: a file that could be mistaken for a different query. Every fact below is asserted both
    // present and equal to the snapshot the service states, so a file cannot be read as a total of a
    // period or a coverage it never held.
    const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const parsed = parseExport(exported.data.csv);
    const required = [
      "grain",
      "basis",
      "currency",
      "period_from",
      "period_to",
      "period_state",
      "coverage_from",
      "coverage_to",
      "coverage_state",
      "snapshot_as_of",
      "snapshot_query",
      "row_total",
      "amount_unit",
      "neutralisation",
      "page",
    ];
    for (const field of required) {
      expect(parsed.meta.get(field) ?? "").not.toBe("");
    }
    // The facts arrive in the writer's own order, so a reader finds the file's identity where it expects it.
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
    // The column header record is the writer's own list, in the writer's own order.
    expect(parsed.header).toEqual(CSV_COLUMN_HEADERS);
    expect(exported.data.print.columns.map((column) => column.header)).toEqual(CSV_COLUMN_HEADERS);
    // A three-decimal and a zero-decimal amount survive the writer without being coerced to two decimals.
    const kwdRow = rowById(parsed.rows, KWD_ROW_ID);
    const jpyRow = rowById(parsed.rows, JPY_ROW_ID);
    if (kwdRow === undefined || jpyRow === undefined) {
      throw new Error("The seeded three-decimal and zero-decimal gifts are not in the exported period.");
    }
    expect(cell(kwdRow, "amount")).toBe("1.250 KWD");
    expect(cell(kwdRow, "amount_minor_units")).toBe("1250");
    expect(fractionDigitsOf(cell(kwdRow, "amount"))).toBe(exponentOf("KWD"));
    expect(cell(jpyRow, "amount")).toBe("5000 JPY");
    expect(cell(jpyRow, "amount_minor_units")).toBe("5000");
    expect(fractionDigitsOf(cell(jpyRow, "amount"))).toBe(exponentOf("JPY"));
    // Every amount in the file carries its own currency's exponent and no other.
    const wrongExponent = parsed.rows.filter((row) => {
      const exponent = exponentOf(cell(row, "currency"));
      return exponent !== undefined && fractionDigitsOf(cell(row, "amount")) !== exponent;
    });
    expect(wrongExponent.map((row) => cell(row, "gift_row_id"))).toEqual([]);
    // A leading-zero identifier survives character for character: the writer quotes it and the parser
    // reads it back as the same string, rather than as a number that dropped its zeros.
    const leadingZero = rowById(parsed.rows, LEADING_ZERO_ROW_ID);
    expect(leadingZero).toBeDefined();
    expect(cell(leadingZero ?? {}, "gift_id")).toBe(LEADING_ZERO_GIFT_ID);
    expect(exported.data.csv).toContain(LEADING_ZERO_ROW_ID);
  });

  it("never reveals a withheld or anonymous record, directly or by subtracting one figure from another", async () => {
    // Excludes: an artifact that discloses an identity the screen withheld, or lets a reader recover a
    // value by subtraction. Both halves are checked: the anonymous gift on real data, and the rendering of
    // the withheld state that the value-state vocabulary admits and this writer must therefore state.
    const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const paged = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const parsed = parseExport(exported.data.csv);
    const anonymousRow = rowById(parsed.rows, ANONYMOUS_ROW_ID);
    if (anonymousRow === undefined) {
      throw new Error("The seeded anonymous gift is not in the exported period.");
    }
    // The gift is counted — the currency total asserted above is the sum of every USD row, this one included —
    // and no donor is named for it anywhere: the file carries no partner for it and the summary counts it as a
    // gift without counting a donor.
    expect(cell(anonymousRow, "attribution")).toBe("anonymous");
    expect(cell(anonymousRow, "partner_id")).toBe("");
    expect(cell(anonymousRow, "amount_minor_units")).toBe("5000");
    const usd = paged.data.summary.find((entry) => entry.currency === "USD");
    if (usd === undefined) {
      throw new Error("The seeded world holds no USD support in this period, so the anonymous case has nothing to compare with.");
    }
    expect(usd.donorCount.count).toBeLessThan(usd.giftCount.count);
    // The printed page carries no donor for the same row: the partner cell states the absent value.
    const partnerColumn = exported.data.print.columns.map((column) => column.header).indexOf("partner_id");
    const printedAnonymous = exported.data.print.rows.find((row) => row[0]?.text === ANONYMOUS_ROW_ID);
    expect(printedAnonymous?.[partnerColumn]?.text).toBe(VALUE_STATE_TEXT.unknown);
    expect(printedAnonymous?.[partnerColumn]?.accessibleLabel ?? "").toContain("Partner");
    // The one split gift is reported at the allocation this read is authorised to see, and it counts once.
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
    // The four renderings of a value that is not an amount stay four different words.
    expect(new Set([VALUE_STATE_TEXT.zero, VALUE_STATE_TEXT.unknown, VALUE_STATE_TEXT.withheld, VALUE_STATE_TEXT.unavailable]).size).toBe(4);
    // The row whose currency the source never identified states the word in both amount cells, not a zero
    // and not an empty cell, so it can be neither totalled nor mistaken for a genuine nothing.
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
    // Excludes: a surface whose figures depend on the visible window. The file's rows are reordered by the
    // sort while its per-currency sums do not move, and a deep page reports the same whole-result total and
    // the same summary as the first page.
    const byAmount = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE, sort: { field: "amountMinor", direction: "desc" } });
    const byDate = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE, sort: { field: "originalGiftOn", direction: "asc" } });
    const amountRows = parseExport(byAmount.data.csv).rows;
    const dateRows = parseExport(byDate.data.csv).rows;
    expect(amountRows.length).toBe(dateRows.length);
    expect(sumExportedAmounts(amountRows).totals).toEqual(sumExportedAmounts(dateRows).totals);
    // The sort really did apply, so the equality above is not the equality of one order with itself.
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
    // Excludes: a printed page that rounds a minor-unit sum, or that fills a month the source holds no row
    // for with a zero. The running period carries the In progress state; the closed one does not.
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
    // Every printed summary line is the exact minor-unit sum through the one formatter, to that currency's
    // own exponent: a rounding to two decimals would fail on KWD, and a rounding of a zero-decimal sum
    // would fail on JPY.
    const printedTexts: string[] = [];
    const exactTexts: string[] = [];
    const wrongExponent: string[] = [];
    for (const entry of running.data.summary) {
      const line = runningPrint.summary.find((candidate) => candidate.label.includes(`(${entry.currency})`));
      if (line === undefined) {
        throw new Error(`The printed page states no summary line for ${entry.currency}.`);
      }
      // A currency whose amount the source never identified carries no count of minor units, so the line is
      // rendered from the state alone — and the formatter states the word rather than a zero.
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
    // A month the source holds no row for is a gap in the series, stated as a gap, and absent from the file
    // rather than present as a zero row.
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
    // Excludes: an export produced by a second computation, and a refusal that leaks the rows anyway. The
    // file the application hands over is the one writer's output for the snapshot it states, and the
    // refused principal receives a denial with no envelope at all.
    const exported = await exportEnvelope({ period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    const paged = await reportEnvelope(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE });
    // Same snapshot: everything but the page window, which the unpaged export deliberately does not state.
    expect(snapshotIdentityOf(exported.data.snapshot)).toEqual(snapshotIdentityOf(paged.data.snapshot));
    const parsed = parseExport(exported.data.csv);
    // The file's metadata records are the facts the service built from that same snapshot, in order.
    expect([...parsed.meta.entries()]).toEqual(exported.data.metadata.map((fact) => [fact.field, fact.value]));
    expect(exported.data.print.facts).toEqual(exported.data.metadata);
    // Both artifacts of that snapshot state the same facts, except the two that describe the page window a
    // paged read states and an unpaged export deliberately does not.
    const pageDependent = new Set(["snapshot_query", "page"]);
    expect(exported.data.metadata.filter((fact) => !pageDependent.has(fact.field))).toEqual(snapshotMetadata(paged.data).filter((fact) => !pageDependent.has(fact.field)));
    // Every record of the file is exactly what the one neutraliser writes for it: quoted, and prefixed where
    // a spreadsheet could open a cell, with no second escaping path anywhere on this route.
    const headerRecord = parsed.records.find((record) => record[0] !== CSV_META_FIELD);
    const unknownRecord = parsed.records.find((record) => record[0] === UNKNOWN_CURRENCY_ROW_ID);
    for (const record of [headerRecord, unknownRecord]) {
      if (record === undefined) {
        throw new Error("The exported file is missing a record this case compares with the one writer's output.");
      }
      expect(parsed.lines.has(record.map((value) => neutralizeCell(value)).join(","))).toBe(true);
    }
    // The file's own rows total to the summary of the result it was rendered from.
    expect(sumExportedAmounts(parsed.rows).totals).toEqual(totalsOf(paged.data.summary));
    expect(exported.actions.some((action) => action.name === "exportQuery" && action.available)).toBe(true);
    // The principal whose admission no longer covers the context it selected: the export answers a denial and
    // nothing else, and the screen's own read is refused on the same ground — the export is not a way round it.
    const refusedExport = await reads.export.readExport({ period: CLOSED_PERIOD, timeZone: TIME_ZONE }, REFUSED_SESSION);
    expect(refusedExport.kind).toBe("denied");
    expect(Object.keys(refusedExport)).toEqual(["kind", "denied"]);
    if (refusedExport.kind !== "denied") {
      throw new Error(`The refused principal's export answered "${refusedExport.kind}".`);
    }
    expect(refusedExport.denied.reasonCode).toBe("no-membership");
    const refusedReport = await reads.support.readReport(EXPORT_REPORT_ID, { period: CLOSED_PERIOD, timeZone: TIME_ZONE }, REFUSED_SESSION);
    expect(refusedReport.kind).toBe("denied");
    if (refusedReport.kind !== "denied") {
      throw new Error(`The refused principal's report answered "${refusedReport.kind}".`);
    }
    expect(refusedReport.denied.reasonCode).toBe(refusedExport.denied.reasonCode);
  });
});
