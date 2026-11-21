/**
 * The print model: one `ReportResult` as the text and the semantics of a printable page, so a worker
 * can print the answer to a report query and read the same figures, the same period, the same coverage
 * and the same snapshot instant the screen showed (AAP 0.8.8; criterion 1).
 *
 * Why a model rather than a page. Printing here is the browser's own print of a real route, not a
 * document pipeline: this application holds no PDF library and no server-side renderer, and it has
 * exactly one content renderer already (`modules/content/render`). Nothing below therefore emits HTML,
 * a class name, a colour, spacing or a stylesheet rule — the support feature lays this model out with
 * the design-system components and the worker prints that page. A printed sheet and a CSV download are
 * then two renderings of one result rather than two computations of it.
 *
 * The print view is evidence, not a second truth. Every figure reaches it from the result the service
 * computed once: the summary's per-currency amounts through `modules/money/format`, the snapshot's
 * grain, basis, currency partition, period, coverage and as-of instant through `snapshotMetadata`
 * (`./csv`), and the row values as the service sorted them. Nothing here queries, re-sorts, re-pages,
 * filters, sums, rounds, converts or infers, so a printed count and a printed per-currency minor-unit
 * sum agree with the screen, the chart's table, the drilldown and the export of the same query.
 *
 * The summary is per currency and never a single total. Received money, commitments, monthly
 * equivalents and goal progress are four different measures, and two currencies have no ordering in
 * this application because it holds no exchange rate: one line per currency, each naming its measure,
 * is the only shape that states what the figures are.
 *
 * A missing month is a sentence, not a zero. `series` states a month the source recorded nothing in as
 * a gap; a printed page says so in words instead of drawing a zero point or a zero row, because a
 * drawn zero would claim the source recorded a zero. This module never reconstructs the month grid to
 * find a bucket the result does not hold — the result's own gaps are the only evidence it reads.
 *
 * A cell is never blank, and the five value states stay five. `value` and `zero` are numbers; `unknown`,
 * `withheld`, `unavailable` and `incomplete-subtotal` state the state's own word from
 * `VALUE_STATE_TEXT` and carry an accessible label naming it, so a screen-reader user hears "withheld"
 * rather than "zero" and no empty cell ever reads as one more kind of value. A value path the result
 * states no state for is `unknown`, never `value`.
 *
 * Purity. No clock, no randomness, no I/O, no browser API and no mutation of the result it is handed:
 * the same result and locale produce a deep-equal model, which is what lets a printed page be compared
 * with the export line by line. The locale only changes a digit's grouping, never a figure.
 */

import type { MinorUnits, Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { REPORT_IDS, type ReportResult, type ReportRow } from "@/modules/support/report";

import { countCellText, snapshotMetadata, VALUE_STATE_TEXT } from "./csv";

// ---------------------------------------------------------------------------------------------
// The model's vocabulary
// ---------------------------------------------------------------------------------------------

/** The state of one value, taken from the one place the report result declares it. */
export type PrintValueState = ReportResult["valueStates"][string];

/**
 * One fact about the snapshot the printed page states: its machine field name, the label a statement
 * shows, and the value — the same three fields, in the same order, that `snapshotMetadata` yields.
 */
export type PrintFact = {
  readonly field: string;
  readonly label: string;
  readonly value: string;
};

/**
 * One line of the printed summary: the measure and currency it names, the amount as display text, the
 * sentence a screen reader announces, and the state the amount is in.
 */
export type PrintSummaryLine = {
  readonly label: string;
  readonly text: string;
  readonly accessibleLabel: string;
  readonly state: PrintValueState;
};

/**
 * One column of the printed table. `align` is the model's only presentational hint and it is logical
 * rather than physical, so a right-to-left page mirrors the numbers without this module knowing which
 * direction the page runs in.
 */
export type PrintColumn = {
  readonly header: string;
  readonly align: "start" | "end";
};

/** One cell of a printed row: what it says, what a screen reader hears, and the state of its value. */
export type PrintCell = {
  readonly text: string;
  readonly accessibleLabel: string | null;
  readonly state: PrintValueState;
};

/** One printed row, one cell per column, in column order. */
export type PrintRow = readonly PrintCell[];

/**
 * A report result as a printable page: its title, its period state, the snapshot facts it states, its
 * per-currency summary, its table, and the notes that keep the page honest about what it does not hold.
 */
export type PrintModel = {
  readonly title: string;
  readonly inProgress: boolean;
  readonly statusLabel: string | null;
  readonly facts: readonly PrintFact[];
  readonly summary: readonly PrintSummaryLine[];
  readonly columns: readonly PrintColumn[];
  readonly rows: readonly PrintRow[];
  readonly rowTotal: number;
  readonly completeness: "whole-query" | "page-only";
  readonly notes: readonly string[];
};

/**
 * The alignment a column states. Derived from {@link PrintColumn} rather than declared again, so a
 * physical `left`/`right` cannot reach a printed table.
 */
type PrintAlign = PrintColumn["align"];

// ---------------------------------------------------------------------------------------------
// The printed names
// ---------------------------------------------------------------------------------------------

/**
 * The printed name of each of the four retained reports, keyed by the report identities the support
 * module lists. The title is a name plus the result's own period and nothing else, because the same
 * query printed twice must print the same heading; a report added to `REPORT_IDS` fails to build until
 * it is named here, and this application has no report designer, no template and no i18n table.
 */
const REPORT_TITLE = {
  "received-period-and-year-to-date": "Received support — period and year to date",
  "monthly-history": "Received support — monthly history",
  "partner-month-matrix": "Received support — partner by month",
  "period-comparison": "Received support — period comparison",
} as const satisfies Readonly<Record<(typeof REPORT_IDS)[number], string>>;

/** The one measure a printed summary line states, named so no line can be read as a combined total. */
const RECEIVED_MEASURE_LABEL = "Received support";

/**
 * The label a period that has not closed prints. It is derived from the snapshot's own period state,
 * never from a clock: a printed page describes the read it came from, not the day it was printed.
 */
const IN_PROGRESS_STATUS = "In progress";

// ---------------------------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------------------------

/** A calendar day as the page states it: the ISO 8601 calendar, `YYYY-MM-DD`, never a date-time. */
type CivilDate = NonNullable<ReportRow["originalGiftOn"]>;

/**
 * States a civil date as `YYYY-MM-DD` in the ISO 8601 calendar.
 *
 * The calendar is set before the date is written, so a day recorded in another calendar is stated as
 * the day it names rather than as a calendar-specific string. No midnight, zone or offset is added: a
 * civil date is a day, and giving it an instant would invent one the record never held.
 */
function civilDateText(date: CivilDate): string {
  return date.withCalendar("iso8601").toString();
}

/**
 * A cell holding the text the record itself carries — an identifier, a currency code, a precision, a
 * source reference — written character for character so Unicode scripts, right-to-left text, emoji and
 * leading-zero identifiers survive the page. Nothing here escapes or re-orders a value: direction is a
 * property of the block the cell is rendered in, not of the string.
 */
function recordedCell(text: string): PrintCell {
  return { text, accessibleLabel: null, state: "value" };
}

/**
 * A cell for an association this row does not carry: an allocation on a gift-grain row, a partner on
 * anonymous support, a correction on a gift that was never corrected.
 *
 * It states `unknown` rather than a blank, because a blank cell on a printed sheet reads as one more
 * kind of value beside the five the amounts use. It never says zero: the row does not claim the source
 * recorded nothing, only that this row carries no such association.
 */
function notCarriedCell(fieldLabel: string): PrintCell {
  const text = VALUE_STATE_TEXT.unknown;
  return {
    text,
    accessibleLabel: `${fieldLabel}: ${text}. This row carries no such value, which is not a zero and not an empty value.`,
    state: "unknown",
  };
}

/** A cell for an optional textual field: the value when the row carries one, and the marker when not. */
function optionalCell(value: string | undefined, fieldLabel: string): PrintCell {
  return value === undefined ? notCarriedCell(fieldLabel) : recordedCell(value);
}

/**
 * The value-state path `modules/support/report` records for one row's amount: the row's position in
 * the window the result holds, which is the position this model prints it at.
 */
function rowAmountPath(index: number): string {
  return `rows.${index}.amount`;
}

/** What one cell's writer reads: the row, its position, the locale and the result's state lookup. */
interface PrintCellContext {
  readonly index: number;
  readonly row: ReportRow;
  /** The locale whose grouping the display text uses; it never changes a figure. */
  readonly locale: string;
  /** The state the result recorded for a value path; a path the result does not state is unknown. */
  readonly stateOf: (path: string) => PrintValueState;
}

/** Writes one cell of a printed row. */
type PrintCellWriter = (context: PrintCellContext) => PrintCell;

/**
 * The amount as display text: the grouped rendering `modules/money/format` produces for the value's
 * state, with the state's own accessible sentence beside it.
 *
 * The formatter is called with the state the result recorded, so a withheld amount prints "Withheld",
 * an unestablished one prints "Unknown amount", and a partial subtotal prints its digits with the
 * incomplete marker — this module never re-rounds, never re-derives and never substitutes a display
 * value for the exact minor-unit count printed in the column beside it.
 */
function amountCell(context: PrintCellContext): PrintCell {
  const state = context.stateOf(rowAmountPath(context.index));
  const formatted = formatMinor(context.row.amount, state, context.locale);
  return { text: formatted.text, accessibleLabel: formatted.accessibleLabel, state };
}

/**
 * The amount as an exact integer count of minor units, or the state's word when the state carries no
 * number, through the one rendering `./csv` declares for a non-monetary number.
 *
 * `zero` prints `0` even beside a contradictory count, exactly as the formatter does, so the two cells
 * of one amount can never disagree about whether a zero or a figure was recorded.
 */
function amountMinorUnitsCell(context: PrintCellContext): PrintCell {
  const state = context.stateOf(rowAmountPath(context.index));
  const carriesNumber = state === "value" || state === "zero" || state === "incomplete-subtotal";
  const count = state === "zero" ? 0 : context.row.amount.minorUnits;
  return {
    text: countCellText(count, state),
    accessibleLabel: carriesNumber
      ? null
      : `${VALUE_STATE_TEXT[state]}. No minor-unit count is stated for this row.`,
    state,
  };
}

/**
 * The day the support was given, or the state's word when the source never established it.
 *
 * `datePrecision` travels in its own column, so an approximate day prints as the day it is and is
 * labelled approximate beside it, while a day the source never established states that rather than
 * borrowing the entry date or today.
 */
function giftDateCell(context: PrintCellContext): PrintCell {
  const { row } = context;
  if (row.originalGiftOn === undefined || row.datePrecision === "unknown") {
    return notCarriedCell("Original gift date");
  }
  return recordedCell(civilDateText(row.originalGiftOn));
}

/** The partner reference of a support row, for the one attribution kind that carries a partner. */
function partnerCell(context: PrintCellContext): PrintCell {
  return context.row.attribution.kind === "partner"
    ? recordedCell(context.row.attribution.partnerId)
    : notCarriedCell("Partner");
}

// ---------------------------------------------------------------------------------------------
// The column table
// ---------------------------------------------------------------------------------------------

/**
 * One column group: the row field it prints, and the `[header, align, writer]` triples it contributes.
 *
 * A monetary field contributes three cells — the currency, the display amount and the exact minor
 * units — and every other field one, so a header and its writer cannot be separated or reordered
 * apart. The headers state the same names, in the same order, as the export's header record, and are
 * declared here rather than imported because the export's per-cell writers are private to it and the
 * page shows the grouped display amount where the file carries the machine-stable decimal; the column
 * audit below is what keeps a new row field from reaching one artefact and not the other.
 */
interface PrintColumnSpec<Field extends keyof ReportRow> {
  readonly field: Field;
  readonly cells: readonly (readonly [header: string, align: PrintAlign, write: PrintCellWriter])[];
}

/** A row's fields, which are exactly the printed column groups. */
type RowField = keyof ReportRow;

/** The ordered column groups: at least one, so an empty table cannot be represented. */
type ColumnTable = readonly [PrintColumnSpec<RowField>, ...PrintColumnSpec<RowField>[]];

/** The row field one column group prints. */
type FieldOf<Column> = Column extends { readonly field: infer Field } ? Field : never;

/** Every field the table declares. */
type DeclaredFields<Table extends ColumnTable> = FieldOf<Table[number]>;

/** The declared fields as a tuple, so a field printed twice can be detected. */
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
 * The table, refused at compile time unless it prints every field of a row, no field a row does not
 * have, and no field twice.
 *
 * This is the guard the printed table exists for: a field added to `ReportRow` breaks the build until
 * someone decides how the page prints it, because a field silently left off a printed sheet is a value
 * withheld by omission.
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

/**
 * The printed columns, in the order printed: the row's own identity first, then the monetary value with
 * its currency and both renderings, then the facts that qualify it, then its provenance and the day the
 * record entered the application.
 *
 * An association a row genuinely does not carry states so in words rather than as a blank, since a
 * printed sheet has no cell borders to distinguish an empty record from a missing one.
 */
const COLUMN_TABLE = [
  {
    field: "giftRowId",
    cells: [
      ["gift_row_id", "start", (context: PrintCellContext) => recordedCell(context.row.giftRowId)],
    ],
  },
  {
    field: "giftId",
    cells: [["gift_id", "start", (context: PrintCellContext) => recordedCell(context.row.giftId)]],
  },
  {
    field: "allocationId",
    cells: [
      [
        "allocation_id",
        "start",
        (context: PrintCellContext) => optionalCell(context.row.allocationId, "Allocation"),
      ],
    ],
  },
  {
    field: "amount",
    cells: [
      [
        "currency",
        "start",
        (context: PrintCellContext) => recordedCell(context.row.amount.currency),
      ],
      ["amount", "end", amountCell],
      ["amount_minor_units", "end", amountMinorUnitsCell],
    ],
  },
  {
    field: "originalGiftOn",
    cells: [["original_gift_on", "start", giftDateCell]],
  },
  {
    field: "datePrecision",
    cells: [
      [
        "date_precision",
        "start",
        (context: PrintCellContext) => recordedCell(context.row.datePrecision),
      ],
    ],
  },
  {
    field: "designation",
    cells: [
      [
        "designation",
        "start",
        (context: PrintCellContext) => optionalCell(context.row.designation, "Designation"),
      ],
    ],
  },
  {
    field: "attribution",
    cells: [
      [
        "attribution",
        "start",
        (context: PrintCellContext) => recordedCell(context.row.attribution.kind),
      ],
      ["partner_id", "start", partnerCell],
    ],
  },
  {
    field: "refundOf",
    cells: [
      [
        "refund_of",
        "start",
        (context: PrintCellContext) => optionalCell(context.row.refundOf, "Refund of"),
      ],
    ],
  },
  {
    field: "provenance",
    cells: [
      [
        "source_system",
        "start",
        (context: PrintCellContext) => recordedCell(context.row.provenance.system),
      ],
      [
        "source_reference",
        "start",
        (context: PrintCellContext) => recordedCell(context.row.provenance.reference),
      ],
    ],
  },
  {
    field: "entryOn",
    cells: [
      [
        "entry_on",
        "start",
        (context: PrintCellContext) => recordedCell(civilDateText(context.row.entryOn)),
      ],
    ],
  },
] as const satisfies ColumnTable;

/** The checked column table: every field of a row printed exactly once, or this line fails to build. */
const PRINT_COLUMNS: AuditedColumnTable<typeof COLUMN_TABLE> = COLUMN_TABLE;

// ---------------------------------------------------------------------------------------------
// The table, the summary and the notes
// ---------------------------------------------------------------------------------------------

/** The printed columns: the headers the table states and the alignment each one takes. */
function printColumns(): readonly PrintColumn[] {
  return PRINT_COLUMNS.flatMap((column) =>
    column.cells.map(([header, align]) => ({ header, align })),
  );
}

/**
 * One printed row per authorised row of the result, in the order the service returned them.
 *
 * No page window, sort or filter is applied here: the model prints the rows it was given, and says
 * whether they are the whole query or one page of it through {@link PrintModel.completeness}.
 */
function printRows(result: ReportResult, locale: string): readonly PrintRow[] {
  const stateOf = (path: string): PrintValueState => result.valueStates[path] ?? "unknown";
  return result.rows.map((row, index) =>
    PRINT_COLUMNS.flatMap((column) =>
      column.cells.map(([, , write]) => write({ index, row, locale, stateOf })),
    ),
  );
}

/**
 * The stand-in amount a summary line is formatted with when its state carries no number.
 *
 * `formatMinor` reads the amount only for the three states that carry one — `value`, `zero` and
 * `incomplete-subtotal` — and states the source's own words for `unknown`, `withheld` and
 * `unavailable`. The stand-in therefore never becomes a figure; it exists so a state that says no
 * amount may be stated is not formatted as if it held one.
 */
const NO_AMOUNT_MINOR_UNITS: MinorUnits = 0 as MinorUnits;

/**
 * One summary line per currency, each naming the measure it states and the currency code it is in.
 *
 * There is no combined line: this application holds no exchange rate, so adding USD minor units to EUR
 * minor units would state a number it cannot know. Each amount is rendered by the one money formatter,
 * which is what makes the printed text and its accessible sentence identical to the screen's and the
 * export's reading of the same value.
 */
function printSummary(result: ReportResult, locale: string): readonly PrintSummaryLine[] {
  return result.summary.map((entry) => {
    const state = entry.received.valueState;
    const amount: Money = {
      currency: entry.currency,
      minorUnits: entry.received.minorUnits ?? NO_AMOUNT_MINOR_UNITS,
    };
    const formatted = formatMinor(amount, state, locale);
    return {
      label: `${RECEIVED_MEASURE_LABEL} (${entry.currency})`,
      text: formatted.text,
      accessibleLabel: formatted.accessibleLabel,
      state,
    };
  });
}

/** Whether the result carries a value this context may not show, in any part of it. */
function carriesWithheldValue(result: ReportResult): boolean {
  return Object.values(result.valueStates).some((state) => state === "withheld");
}

/**
 * The notes the page states about what it does not hold, in a fixed order: completeness, then coverage,
 * then withheld values, then one note per month the source recorded nothing in.
 *
 * Each note is a sentence about the result, never about a record: a note names no partner, no gift and
 * no amount, and a withheld value is described without being counted or inferred, so nothing on the
 * page can be used to reconstruct what the screen withheld — directly or by subtraction.
 */
function printNotes(result: ReportResult): readonly string[] {
  const notes: string[] = [];

  if (result.rows.length !== result.total) {
    notes.push(
      `This view shows ${String(result.rows.length)} of ${String(result.total)} rows; export the CSV for the complete result.`,
    );
  }

  if (result.snapshot.coverage.state === "partial") {
    notes.push(
      "Coverage is partial: each subtotal on this page covers only the part of the period the source holds and is marked incomplete.",
    );
  } else if (result.snapshot.coverage.state === "unknown") {
    notes.push(
      "Coverage is unknown: the source did not state how much of the past this result covers, so no subtotal here is presented as a total.",
    );
  }

  if (carriesWithheldValue(result)) {
    notes.push(
      "Some values are withheld here. They are in no total, directly or by subtraction, and none of them may be inferred from any other figure on this page.",
    );
  }

  for (const point of result.series) {
    if (!point.gap) {
      continue;
    }
    notes.push(
      `No rows in ${point.currency} ${civilDateText(point.bucketStart)} to ${civilDateText(point.bucketEnd)} — shown as a gap, not zero.`,
    );
  }

  return notes;
}

/** The printed heading: the report's name and the period the result states, from the result alone. */
function printTitle(result: ReportResult): string {
  const { period, query } = result.snapshot;
  return `${REPORT_TITLE[query.reportId]} (${civilDateText(period.from)} to ${civilDateText(period.to)})`;
}

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

/**
 * Renders one report result as the printable page's model: its title, its period state, the snapshot
 * facts it states, its per-currency summary, its table and the notes that keep it honest.
 *
 * It never recomputes a total, a count, a percentage, a period, a coverage or an as-of instant: every
 * figure is read from the result the service computed once, which is why a printed page and the CSV of
 * the same query agree in count and in minor-unit sums per currency.
 *
 * `options.locale` selects the digit grouping the display amounts use; it defaults to `"en"` so the
 * same result prints the same grouping on every machine, and it changes no figure's value.
 *
 * @param result the report result to print, never mutated by this call.
 * @param options the caller's locale for digit grouping, defaulting to `"en"`.
 */
export function printModel(result: ReportResult, options?: { locale?: string }): PrintModel {
  const locale = options?.locale ?? "en";
  const inProgress = result.snapshot.period.state === "in-progress";

  return {
    title: printTitle(result),
    inProgress,
    statusLabel: inProgress ? IN_PROGRESS_STATUS : null,
    facts: snapshotMetadata(result),
    summary: printSummary(result, locale),
    columns: printColumns(),
    rows: printRows(result, locale),
    rowTotal: result.total,
    completeness: result.rows.length === result.total ? "whole-query" : "page-only",
    notes: printNotes(result),
  };
}
