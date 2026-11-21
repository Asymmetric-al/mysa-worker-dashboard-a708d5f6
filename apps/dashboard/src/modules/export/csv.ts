/**
 * The application's only CSV production path: one `ReportResult` becomes the text of one download,
 * stating the same snapshot facts the screen, the chart, the table and the print view state
 * (AAP 0.8.8; criterion 1).
 *
 * Why it exists. The CSV is one of the six artifacts of one report query and the artifact most able
 * to be read as a financial statement on its own: it leaves the application, it opens in a
 * spreadsheet, and nothing beside it explains what it holds. So the file carries its own identity —
 * the row grain, the one named basis, the currency partition, the period and its state, the coverage,
 * the as-of instant and the exact query in force — as metadata records, and its data records are the
 * rows `runReport` returned, in the order the service sorted them. No page window is re-applied, no
 * filter is re-evaluated and no total is recomputed here: every figure is a value the service
 * computed once, which is why an export cannot disagree with the screen it came from.
 *
 * What it never does. It does not query, rank, re-page, pad, truncate, sum, convert or infer. A
 * withheld value stays withheld, an unknown amount states itself as unknown, a missing month is
 * absent from the rows rather than a zero, and no "remaining" or "other" record is added to make
 * totals balance. A result holding one page of a larger whole is written exactly as it is and
 * labelled `page-only` rather than quietly completed.
 *
 * Money is written twice on purpose. A monetary field states the value's grouping-free decimal
 * rendering in `<field>` beside the exact integer count of minor units in `<field>_minor_units`, both
 * produced from `modules/money/format` and `modules/money/currency`. A consumer that parses a
 * decimal and one that keeps integers therefore read the same amount, and neither has to guess the
 * currency's exponent — three digits for KWD and none for JPY, never a default of two.
 *
 * A record's width states what kind of record it is. A metadata record holds three fields — the
 * sentinel, the fact's name and its value — the header record and every data record hold one field
 * per column, and the widths therefore differ inside one file on purpose. A reader must allow a
 * varying field count (`csv-parse`'s `relax_column_count`, which is off by default) and classify each
 * record by its first field and its position, rather than assuming one uniform width; a reader that
 * insists on a single width rejects the file at its first data record.
 *
 * Escaping has one owner. Every field of every record passes through `neutralizeCell`
 * (`./neutralize`) exactly once, which quotes it and prefixes the documented tab at each position a
 * spreadsheet could open a cell as a formula. The residual that tab leaves on reimport is stated in
 * the file's own metadata record rather than hidden, because no universal mitigation exists. Nothing
 * here joins a raw value with a comma or a record separator.
 *
 * Purity. This module reads no clock, no locale, no environment and no store; it imports only the
 * money, support and export vocabulary, so a domain module never depends on the data service. Given
 * the same result `toCsv` returns the same string: CRLF between records, exactly one trailing CRLF,
 * no byte-order mark, and no mutation of the result it was handed.
 */

import type { Money } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { formatMinor } from "@/modules/money/format";
import { BASIS_DESCRIPTION, SUPPORT_BASIS } from "@/modules/support/basis";
import {
  clampPageSize,
  type ReportId,
  type ReportResult,
  type ReportRow,
} from "@/modules/support/report";

import { neutralizeCell } from "./neutralize";

// ---------------------------------------------------------------------------------------------
// The format's own vocabulary
// ---------------------------------------------------------------------------------------------

/** The record separator every CSV record ends with, and the one the file ends with. */
export const CSV_RECORD_SEPARATOR = "\r\n";

/**
 * The first field of a metadata record, so a reader can find the file's identity without knowing its
 * shape. It is a parsed field value rather than a textual prefix: `neutralizeCell` quotes it like
 * every other field, and nothing outside the quotes marks a metadata record.
 */
export const CSV_META_FIELD = "#meta";

/**
 * What the `amount_unit` metadata record states: every `_minor_units` column holds an exact integer
 * count of the currency's minor units, and the column without that suffix holds the same amount as
 * the grouping-free decimal rendering the file's rows are checked against.
 */
export const CSV_AMOUNT_UNIT = "minor-units";

/**
 * What the `currency` metadata record states when the result is stated in more than one currency —
 * or in none at all. This application holds no exchange rate and converts nothing, so a download
 * covering several currencies never names one of them as its currency.
 */
export const CSV_ALL_CURRENCIES = "all-currencies";

/** What a metadata record states for a fact the source did not supply, instead of a blank field. */
export const CSV_NOT_STATED = "not-stated";

/**
 * The grain of the records this writer emits, keyed by the report that produced them.
 *
 * Every one of the four reports hands the writer its `ReportRow` set: one authorised allocation, or
 * one whole gift where the gift carries no allocation (`modules/support/basis` owns that grain). The
 * four entries therefore state the same grain on purpose — a partner-by-month report exports the
 * allocation rows its cells were summed from, not the cells — and they are written per report so a
 * fifth report cannot be added without deciding, in one place, what it exports.
 */
const EXPORT_ROW_GRAIN = {
  "received-period-and-year-to-date": "gift-allocation",
  "monthly-history": "gift-allocation",
  "partner-month-matrix": "gift-allocation",
  "period-comparison": "gift-allocation",
} as const satisfies Readonly<Record<ReportId, string>>;

/**
 * The A8 residual, stated in the file it applies to: how every field is escaped, and what a consumer
 * must do about the one thing that escaping leaves behind.
 *
 * `./neutralize` adds the tab at each cell start, which includes the start of every line inside a
 * multi-line field, so a reader that re-splits the quoted field on CR or LF finds the prefix there
 * too. The tab is part of the data after a reimport, so a consumer parsing a number strips one
 * leading tab; a mitigation that removed itself would have to guess whether the tab was data.
 */
const NEUTRALISATION_STATEMENT =
  "Every field is quoted. A leading tab is added at each position where a spreadsheet could open a " +
  "cell — the field's own start and the start of every line inside it — when the text there begins " +
  "with = + - @ TAB CR LF or the full-width forms ＝ ＋ － ＠. The tab stays part of the data, so a " +
  "consumer parsing a number strips one leading tab; no universal mitigation exists.";

/** The state of one value, taken from the one place the report result declares it. */
type ValueState = ReportResult["valueStates"][string];

/**
 * The words a value that is not an amount renders as, one per state.
 *
 * It exists for the values `modules/money/format` does not format — a count, a percentage, a date or
 * a label — so that a cell whose value the source never established says so rather than being left
 * blank or filled with a zero. `value` and `zero` are numbers and are written as numbers; their
 * entries here make the table total over the union, so a state added to the envelope's closed set
 * fails the build until it is worded, and they are worded distinctly so a defect that emitted one
 * could never be mistaken for a number or for another state. The five words match the badge
 * vocabulary the interface states for the same facts; this module cannot import a component, so the
 * cell wording is declared here.
 */
export const VALUE_STATE_TEXT: Readonly<Record<ValueState, string>> = {
  value: "Recorded value",
  zero: "Zero",
  unknown: "Unknown",
  withheld: "Withheld",
  unavailable: "Unavailable",
  "incomplete-subtotal": "Incomplete subtotal",
};

/**
 * The one rendering of a stated non-monetary number: the number itself when the state carries one,
 * and the state's word otherwise. Amounts never pass through here — they are formatted by
 * `modules/money/format`, whose own five renderings must not be duplicated.
 *
 * Exported so the print model renders the same five words and the same rule from one place instead
 * of restating them beside its own count and percentage cells.
 */
export function countCellText(count: number, state: ValueState): string {
  return state === "value" || state === "zero" ? String(count) : VALUE_STATE_TEXT[state];
}

// ---------------------------------------------------------------------------------------------
// The metadata record's fields
// ---------------------------------------------------------------------------------------------

/**
 * Every metadata field the file states, in the order it states them.
 *
 * The order is part of the export contract: two exports compared line by line must agree on where a
 * fact sits, and the print model states the same facts through {@link snapshotMetadata}, so the
 * wording and the order are declared once, here, and read by both surfaces.
 */
export type SnapshotFactField =
  | "grain"
  | "basis"
  | "currency"
  | "period_from"
  | "period_to"
  | "period_state"
  | "coverage_from"
  | "coverage_to"
  | "coverage_state"
  | "snapshot_as_of"
  | "snapshot_query"
  | "row_total"
  | "amount_unit"
  | "neutralisation"
  | "page";

/**
 * One fact about the snapshot a file states: its machine field name, the label a printed statement
 * shows, and the value exactly as the metadata record carries it.
 */
export interface SnapshotFact {
  readonly field: SnapshotFactField;
  readonly label: string;
  readonly value: string;
}

// ---------------------------------------------------------------------------------------------
// The column table
// ---------------------------------------------------------------------------------------------

/** The row a data record is written from, and the state lookup the writer supplies for it. */
interface CsvRowContext {
  /** The row's position in the result's own window, which is the index its value states use. */
  readonly index: number;
  readonly row: ReportRow;
  /** The state the result recorded for a value path; a path the result does not state is unknown. */
  readonly stateOf: (path: string) => ValueState;
}

/** Writes one cell of a data record, unescaped: the single serialisation point escapes it. */
type CsvCellWriter = (context: CsvRowContext) => string;

/**
 * One column group: the row field it exports, and the `[header, writer]` pairs it contributes.
 *
 * A monetary field contributes three pairs — the currency, the decimal rendering and the exact
 * minor units — and every other field one, so pairing each header with its writer makes a header
 * and its cell impossible to separate or to reorder independently.
 */
interface CsvColumn<Field extends keyof ReportRow> {
  readonly field: Field;
  readonly cells: readonly (readonly [header: string, write: CsvCellWriter])[];
}

/** A row's fields, which are exactly the export's column groups. */
type RowField = keyof ReportRow;

/** The ordered column groups: at least one, so an empty export cannot be represented. */
type ColumnTable = readonly [CsvColumn<RowField>, ...CsvColumn<RowField>[]];

/** The row field one column group exports. */
type FieldOf<Column> = Column extends { readonly field: infer Field } ? Field : never;

/** Every field the table declares. */
type DeclaredFields<Table extends ColumnTable> = FieldOf<Table[number]>;

/** The declared fields as a tuple, so a field exported twice can be detected. */
type DeclaredFieldTuple<Table extends ColumnTable> = {
  readonly [Index in keyof Table]: FieldOf<Table[Index]>;
};

/** True only when no field appears twice in the tuple. */
type FieldsAreDistinct<
  Tuple extends readonly string[],
  Seen extends string = never,
> = Tuple extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
  ? Head extends Seen
    ? false
    : FieldsAreDistinct<Tail, Seen | Head>
  : true;

/**
 * The table, refused at compile time unless it exports every field of a row, no field that a row does
 * not have, and no field twice.
 *
 * This is the guard the whole column design exists for: a field added to `ReportRow` has to break
 * the build until someone decides how it exports, because silently dropping it is a value withheld
 * by omission and `tests/domain/report-agreement.test.ts` would have no way to see it.
 */
type AuditedColumnTable<Table extends ColumnTable> = [
  Exclude<RowField, DeclaredFields<Table>>,
] extends [never]
  ? [Exclude<DeclaredFields<Table>, RowField>] extends [never]
    ? FieldsAreDistinct<DeclaredFieldTuple<Table>> extends true
      ? Table
      : never
    : never
  : never;

// ---------------------------------------------------------------------------------------------
// Reading the result the export states
// ---------------------------------------------------------------------------------------------

/** A calendar day as the file states it: the ISO 8601 calendar, `YYYY-MM-DD`, never a date-time. */
type CivilDate = NonNullable<ReportRow["originalGiftOn"]>;

/**
 * States a civil date as `YYYY-MM-DD` in the ISO 8601 calendar.
 *
 * The calendar is set before the date is written, so a record holding a day in another calendar is
 * still stated as the day it names rather than as a calendar-specific string that would neither sort
 * nor parse as a date. No time of day, zone or offset is added: a civil date is a day, and giving it
 * a midnight would invent an instant the record never held.
 *
 * This is the same conversion `modules/time/civil` performs, restated because this module's imports
 * stop at the money, support and export vocabulary: the conversion is `Temporal`'s own ISO
 * serialisation, so the two cannot drift, and importing the time module here would couple a domain
 * export writer to a module that owns calendar parsing it never uses.
 */
function civilDateText(date: CivilDate): string {
  return date.withCalendar("iso8601").toString();
}

/**
 * The date a row states, or the word for a day the source never established.
 *
 * `datePrecision` travels in its own column, so an approximate day is written as the day it is and
 * is labelled approximate beside it, while a day the source never established is stated as unknown
 * rather than left blank — a blank cell would be a fifth rendering beside the amount's four.
 */
function giftDateText(row: ReportRow): string {
  if (row.originalGiftOn === undefined || row.datePrecision === "unknown") {
    return VALUE_STATE_TEXT.unknown;
  }
  return civilDateText(row.originalGiftOn);
}

/**
 * The value-state path `modules/support/report` records for one row's amount: the row's position in
 * the window the result holds, which is the position this writer writes it at.
 */
function rowAmountPath(index: number): string {
  return `rows.${index}.amount`;
}

/**
 * The locale argument `modules/money/format` requires. Its `plain` rendering never reads the locale's
 * separators or grouping, so no cell can vary with this value; it is stated as a fixed literal
 * because an ambient locale would make the same result produce two files on two machines.
 */
const MACHINE_LOCALE = "en";

/**
 * The two cells of one monetary value: its grouping-free decimal and its exact minor units, or the
 * state's word in both cells when the state carries no number.
 *
 * The pair is produced once and written to both columns, so the two can never disagree — a row whose
 * amount is withheld states `Withheld` beside `Withheld`, never `Withheld` beside `0`, because a zero
 * there would claim the source recorded nothing. `plain` is the documented machine rendering: it is
 * built from the integer minor units and the currency's exponent, carries no grouping and no symbol,
 * and therefore cannot depend on the locale argument this call must state.
 */
function amountCells(amount: Money, state: ValueState): readonly [string, string] {
  if (state === "value" || state === "zero") {
    return [formatMinor(amount, state, MACHINE_LOCALE).plain, String(amount.minorUnits)];
  }
  const marker = VALUE_STATE_TEXT[state];
  return [marker, marker];
}

/**
 * The currency the file states as its own: the single code the result is partitioned by, or a marker
 * that refuses to name one.
 *
 * An unknown-currency amount in the partition settles the answer as unknown, because naming another
 * currency beside it would present a partition that is fully identified when it is not. Several codes
 * are stated as several, since this application holds no exchange rate and a download covering KWD
 * and USD has no single currency.
 */
function currencyOf(result: ReportResult): string {
  const codes = result.snapshot.currencies;
  if (codes.includes(UNKNOWN_CURRENCY)) {
    return UNKNOWN_CURRENCY;
  }
  const [only] = codes;
  return codes.length === 1 && only !== undefined ? only : CSV_ALL_CURRENCIES;
}

/** The period as the query stated it, so the file's query identity can be read against the screen. */
function periodIdentity(period: ReportResult["snapshot"]["query"]["period"]): string {
  switch (period.kind) {
    case "preset":
      return `preset:${period.preset}`;
    case "explicit":
      return `explicit:${civilDateText(period.from)}..${civilDateText(period.to)}`;
    case "year":
      return `year:${String(period.year)}`;
  }
}

/** Which attribution the query was narrowed to, stated as the fact it is. */
function partnerIdentity(partner: ReportResult["snapshot"]["query"]["partner"]): string {
  if (partner === undefined) {
    return CSV_NOT_STATED;
  }
  return partner.kind === "partner" ? `partner:${partner.partnerId}` : partner.kind;
}

/**
 * The query in force, as one stable, human-readable identity: an explicit ordered list of the fields
 * that decide which rows a result holds, each as `label=value`.
 *
 * It is assembled from a fixed list rather than serialised from the query object, because an object's
 * key order is not part of its type and two exports of the same query must state the same string.
 * The string is for a reader — a filter's own text may contain a separator — so it identifies a
 * query for a person comparing a download with the screen, and the machine identity remains the
 * result's own snapshot.
 */
function queryIdentity(query: ReportResult["snapshot"]["query"]): string {
  const range = query.amountRange;
  const page = query.page;
  return [
    `report=${query.reportId}`,
    `period=${periodIdentity(query.period)}`,
    `currency=${query.currency.kind === "one" ? `one:${query.currency.currency}` : "all"}`,
    `amount=${range === undefined ? CSV_NOT_STATED : `${String(range.minMinor)}..${String(range.maxMinor)}`}`,
    `designation=${query.designation ?? CSV_NOT_STATED}`,
    `partner=${partnerIdentity(query.partner)}`,
    `search=${query.search ?? CSV_NOT_STATED}`,
    `sort=${query.sort === undefined ? CSV_NOT_STATED : `${query.sort.field}:${query.sort.direction}`}`,
    `page=${
      page === undefined
        ? CSV_NOT_STATED
        : `index:${String(page.index)},size:${String(clampPageSize(page.size))}`
    }`,
  ].join(";");
}

/**
 * Whether the file holds the whole query or one page of it.
 *
 * A page-only file is honest but is not an export: the writer states which one it produced and never
 * asks the service for the rest, because a download that quietly re-queried would be a second read
 * whose snapshot could differ from the one it claims.
 */
function pageScope(result: ReportResult): string {
  return result.rows.length === result.total ? "whole-query" : "page-only";
}

// ---------------------------------------------------------------------------------------------
// The columns
// ---------------------------------------------------------------------------------------------

/**
 * The data columns, in the order written: the row's own identity first, then the monetary value with
 * its currency and both renderings, then the facts that qualify it, then its provenance and the day
 * the record entered the application.
 *
 * An identifier the record genuinely does not carry — an allocation on a gift-grain row, a partner on
 * anonymous support, a corrected row on a gift that was never corrected — is written as an empty
 * field, which is RFC 4180's statement that nothing was recorded there. The columns beside it say why
 * it is absent: the attribution column names anonymous support, the precision column names an unknown
 * day, and a row carrying an allocation states which allocation it is.
 */
const COLUMN_TABLE = [
  {
    field: "giftRowId",
    cells: [["gift_row_id", (context: CsvRowContext) => context.row.giftRowId]],
  },
  {
    field: "giftId",
    cells: [["gift_id", (context: CsvRowContext) => context.row.giftId]],
  },
  {
    field: "allocationId",
    cells: [["allocation_id", (context: CsvRowContext) => context.row.allocationId ?? ""]],
  },
  {
    field: "amount",
    cells: [
      ["currency", (context: CsvRowContext) => context.row.amount.currency],
      [
        "amount",
        (context: CsvRowContext) =>
          amountCells(context.row.amount, context.stateOf(rowAmountPath(context.index)))[0],
      ],
      [
        "amount_minor_units",
        (context: CsvRowContext) =>
          amountCells(context.row.amount, context.stateOf(rowAmountPath(context.index)))[1],
      ],
    ],
  },
  {
    field: "originalGiftOn",
    cells: [["original_gift_on", (context: CsvRowContext) => giftDateText(context.row)]],
  },
  {
    field: "datePrecision",
    cells: [["date_precision", (context: CsvRowContext) => context.row.datePrecision]],
  },
  {
    field: "designation",
    cells: [["designation", (context: CsvRowContext) => context.row.designation ?? ""]],
  },
  {
    field: "attribution",
    cells: [
      ["attribution", (context: CsvRowContext) => context.row.attribution.kind],
      [
        "partner_id",
        (context: CsvRowContext) =>
          context.row.attribution.kind === "partner" ? context.row.attribution.partnerId : "",
      ],
    ],
  },
  {
    field: "refundOf",
    cells: [["refund_of", (context: CsvRowContext) => context.row.refundOf ?? ""]],
  },
  {
    field: "provenance",
    cells: [
      ["source_system", (context: CsvRowContext) => context.row.provenance.system],
      ["source_reference", (context: CsvRowContext) => context.row.provenance.reference],
    ],
  },
  {
    field: "entryOn",
    cells: [["entry_on", (context: CsvRowContext) => civilDateText(context.row.entryOn)]],
  },
] as const satisfies ColumnTable;

/** The checked column table: every field of a row exported exactly once, or this line fails to build. */
const CSV_COLUMNS: AuditedColumnTable<typeof COLUMN_TABLE> = COLUMN_TABLE;

/**
 * The data record's headers, in the order written.
 *
 * This is the export's column contract and the one statement of it: changing a header is a breaking
 * change for anything that reads a download, so the headers are derived from the columns themselves
 * and the print model reads them here instead of restating them.
 */
export const CSV_COLUMN_HEADERS: readonly string[] = CSV_COLUMNS.flatMap((column) =>
  column.cells.map(([header]) => header),
);

// ---------------------------------------------------------------------------------------------
// The records
// ---------------------------------------------------------------------------------------------

/**
 * The single point at which values become a record of the file.
 *
 * Every field — the sentinel, a metadata name, a header, a cell — is escaped here by
 * `neutralizeCell` exactly once, so a quoting rule cannot be applied twice to one field and cannot be
 * skipped for another, and no code path joins a raw value with a comma or the record separator.
 */
function record(fields: readonly string[]): string {
  const escaped = fields.map((field) => neutralizeCell(field)).join(",");
  return `${escaped}${CSV_RECORD_SEPARATOR}`;
}

// ---------------------------------------------------------------------------------------------
// The snapshot the file states
// ---------------------------------------------------------------------------------------------

/**
 * The facts that identify the snapshot the file holds: its grain, basis, currency partition, period
 * and period state, coverage, as-of instant, exact query, whole-result count, amount unit, the
 * neutralisation residual and whether the file is the whole query or one page of it.
 *
 * The print model states these same facts by calling this function, so a printed page and a download
 * of the answer to the same query cannot describe different snapshots (AAP 0.8.8; criterion 1). Every
 * value is read from the result — nothing is taken from a clock, an environment or a default — and an
 * unstated coverage boundary states that it is unstated instead of borrowing the period's own dates.
 */
export function snapshotMetadata(result: ReportResult): readonly SnapshotFact[] {
  const { snapshot } = result;
  return [
    {
      field: "grain",
      label: "Grain",
      value: EXPORT_ROW_GRAIN[snapshot.query.reportId],
    },
    {
      field: "basis",
      label: "Basis",
      value: `${SUPPORT_BASIS}: ${BASIS_DESCRIPTION}`,
    },
    {
      field: "currency",
      label: "Currency",
      value: currencyOf(result),
    },
    {
      field: "period_from",
      label: "Period from",
      value: civilDateText(snapshot.period.from),
    },
    {
      field: "period_to",
      label: "Period to",
      value: civilDateText(snapshot.period.to),
    },
    {
      field: "period_state",
      label: "Period state",
      value: snapshot.period.state,
    },
    {
      field: "coverage_from",
      label: "Coverage from",
      value: snapshot.coverage.from ?? CSV_NOT_STATED,
    },
    {
      field: "coverage_to",
      label: "Coverage to",
      value: snapshot.coverage.to ?? CSV_NOT_STATED,
    },
    {
      field: "coverage_state",
      label: "Coverage state",
      value: snapshot.coverage.state,
    },
    {
      field: "snapshot_as_of",
      label: "Snapshot as of",
      value: snapshot.asOf,
    },
    {
      field: "snapshot_query",
      label: "Snapshot query",
      value: queryIdentity(snapshot.query),
    },
    {
      field: "row_total",
      label: "Row total",
      value: String(result.total),
    },
    {
      field: "amount_unit",
      label: "Amount unit",
      value: CSV_AMOUNT_UNIT,
    },
    {
      field: "neutralisation",
      label: "Neutralisation",
      value: NEUTRALISATION_STATEMENT,
    },
    {
      field: "page",
      label: "Page",
      value: pageScope(result),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------------------------

/**
 * Renders one report result as the text of a CSV download: its metadata records, the one column
 * header record and one record per authorised row, in the order the service returned them.
 *
 * The writer is the export of the query it is given and never a second computation of it: it does not
 * query, re-page, re-sort, sum, round or infer, so a value the screen withheld stays withheld here and
 * the count and per-currency minor-unit sums match the screen it came from. An empty result is still
 * a file — its metadata states `row_total` `0` and its header record still states the columns — and a
 * result holding one page states `page-only` rather than being completed.
 *
 * Deterministic and side-effect free: the same result produces the same string, the result is never
 * mutated, and no clock, locale, environment or store is read.
 */
export function toCsv(result: ReportResult): string {
  const stateOf = (path: string): ValueState => result.valueStates[path] ?? "unknown";

  const records: string[] = [];

  for (const fact of snapshotMetadata(result)) {
    records.push(record([CSV_META_FIELD, fact.field, fact.value]));
  }

  records.push(record(CSV_COLUMN_HEADERS));

  result.rows.forEach((row, index) => {
    const cells = CSV_COLUMNS.flatMap((column) =>
      column.cells.map(([, write]) => write({ index, row, stateOf })),
    );
    records.push(record(cells));
  });

  return records.join("");
}
