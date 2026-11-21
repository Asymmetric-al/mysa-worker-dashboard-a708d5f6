/**
 * Fixed report 3, the partner-by-month matrix: one table of partners against months in which every
 * cell that states an amount also opens the exact records behind it.
 *
 * What the file renders, and what it refuses to render. Each figure here is a value the one report
 * computation already produced — a cell's exact minor units and its own `ValueState` — so no sum, row
 * total, column total, grand total or percentage is computed here. The matrix carries no per-partner
 * total, and none is derived: a partner's figure is the result's figure or it is not shown. A cell in
 * which the source recorded no authorised gift is a gap and reads as a gap; a cell whose value the
 * source did not establish, or which this context withholds, states that fact in words. Neither is a
 * zero, because a genuine zero is a recorded value and this component has no way to tell one from an
 * absence if it invented either.
 *
 * One matrix per currency. A row's cells are currency-major, and two currencies are never added
 * together, so each currency in the result is its own table with its own caption and no combined
 * figure anywhere. Every partition states the grain it counts at, because a cell is a sum of
 * allocations and the grain is what stops that sum being read as something else.
 *
 * Two presentations of the same data, one exposed at a time. Above the phone breakpoint the matrix is
 * the table a wide screen can hold; below it the same result is a period-first sequence of headings,
 * each listing the partners whose figure that month states. The switch is a pair of sibling wrappers
 * with opposite responsive display utilities, so `display: none` removes the other composition from
 * the accessibility tree entirely: a screen reader, a keyboard user and a zoomed reader meet exactly
 * one of them, and neither is a second computation. Precision therefore never depends on dragging a
 * table sideways at 320 CSS pixels.
 *
 * One scroll region, and no second one. The wide table sits inside the application's single
 * horizontally scrollable `ScrollRegion`, which owns the region role, its accessible name, the
 * keyboard focus that lets it be scrolled and the `scroll-padding` that keeps a focused cell out from
 * under the sticky shell (WCAG 2.2 1.4.10, 2.4.11, 2.5.7). This file declares no `overflow` of its
 * own: a second scroll port would take the scrolling away from the labelled region and leave an
 * unlabelled box moving instead.
 *
 * A cell without a stated amount is text, never a disabled control. A gap cell and a withheld or
 * unknown cell carry no figure, so the name a drilldown link must announce — partner, month and
 * amount — cannot be completed for them, and their narrowed query honestly returns nothing. They read
 * as the fact they are, and the caption states once, for the whole table, that a month with no
 * recorded gift is a gap rather than a zero.
 *
 * Rule 1: report 3 only — no pivot builder, no column chooser, no matrix export control and no second
 * drilldown surface; the design system's own table parts and the one `ScrollRegion` are composed
 * rather than duplicated, money is rendered through the family's one formatter and the wording comes
 * from the family's copy module; and the distinctions the rule protects hold here, because a cell
 * states its own value state, a gap is never a zero, and the href a link opens is built by the caller
 * from the query the result supplied rather than by this file.
 */

import Link from "next/link";
import type { ReactElement } from "react";

import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { ValueState } from "@/modules/data-service/envelope";
import type { Matrix, MatrixCell, MatrixRow, ReportResult } from "@/modules/support/report";

import { EMPTY_STATES, REPORT_COPY, VALUE_STATE_MEANING } from "../copy";
import AmountValue from "./amount-value";

/** Props of {@link ReportMatrix}. */
export type ReportMatrixProps = {
  /** The report computation's whole answer. Every figure below is read from it and never recomputed. */
  readonly result: ReportResult;
  /** The viewer's display locale, supplied by the route composition; never read from the host. */
  readonly locale: string;
  /** The block's text direction, from the content language rather than from the interface language. */
  readonly dir?: "ltr" | "rtl";
  /**
   * Builds the Gifts-ledger address for one cell from the narrowed query that cell carries.
   *
   * The caller owns it because the address shape belongs to the ledger's route, and this file must
   * never assemble a query of its own: a matrix that built its own filter could open records other
   * than the ones its cell summed.
   */
  readonly drilldownHref: (cell: MatrixCell) => string;
  /** Layout classes for the matrix's place in the report page. Never a colour, radius or shadow. */
  readonly className?: string;
};

/** One month of the matrix, prepared once: the key a cell is found by and its two labels. */
interface MonthColumn {
  /** The month's civil date in its stored ISO form, which is what a matrix cell is matched on. */
  readonly key: string;
  /** The heading a period-first block carries: the month and its year, in the reader's locale. */
  readonly longLabel: string;
  /** The column header the wide table carries: the month and its year, shortened to fit a header. */
  readonly shortLabel: string;
}

/** One attribution of the matrix, prepared once: its identity, its label and its cells for one currency. */
interface PartitionRow {
  /** A stable key for this row: its partner reference, or the kind of support it carries. */
  readonly key: string;
  /** The label the result supplies for this attribution. */
  readonly label: string;
  /**
   * Whether the label is an opaque partner reference rather than a word such as "Anonymous support".
   *
   * An opaque reference renders in the identifier utility so a leading zero survives and a
   * mixed-direction neighbour cannot reorder it; a word does not need isolating typography.
   */
  readonly opaqueReference: boolean;
  /** This row's cells for the partition's currency, found by the month each one covers. */
  readonly cellsByMonth: ReadonlyMap<string, MatrixCell>;
}

/** One cell that states an amount, paired with the attribution it belongs to. */
interface StatedCell {
  readonly row: PartitionRow;
  readonly cell: MatrixCell;
}

/** The short word and the full sentence a cell that states no amount renders. */
interface AmountlessMarker {
  readonly word: string;
  readonly explanation: string;
}

/** A month heading states the month and its year; a column header may abbreviate it. */
const MONTH_HEADING_FORMAT: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };
const MONTH_COLUMN_FORMAT: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };

/**
 * What a cell reads where the source recorded no authorised gift in that month.
 *
 * Two words rather than a dash, a blank or a zero: a dash reads as an amount that was left out and a
 * zero reads as a recorded nothing, while this cell's fact is that no gift was recorded at all. The
 * sentence that explains a gap for the whole table is stated once in the caption, so a dense matrix
 * does not repeat it in every empty cell.
 *
 * Declared here rather than in `../copy`, which is the family's single source of the sentences that
 * explain what a figure means: this is a two-word cell marker only a matrix needs, it explains
 * nothing, and the explanation it stands for is the copy module's own sentence for the state.
 */
const GAP_CELL_WORD = "No gift";

/** What the first column is: a partner, or the support that carries no partner identity. */
const PARTNER_COLUMN_HEADING = "Partner or support";

/** The line that separates a stated amount from the partner and month a drilldown link names. */
const NAME_SEPARATOR = " — ";

/**
 * The drilldown control's own classes: an inline link sized to the 24x24 CSS pixel target floor, end
 * aligned on the logical axis so a right-to-left table keeps every figure in the same column, with the
 * application's global `:focus-visible` ring doing the focusing rather than a second outline here.
 */
const DRILLDOWN_LINK_CLASS =
  "inline-flex min-h-6 min-w-6 items-center justify-end rounded-sm underline-offset-4 hover:underline";

/** The order a cell number reads in: the end edge of the logical axis, never the physical right. */
const NUMERIC_CELL_CLASS = "text-end";

/** The quieter text a gap cell and a cell without a stated amount share, so neither reads as a figure. */
const QUIET_TEXT_CLASS = "text-sm text-muted-foreground";

/** States a figure and the currency it is stated in, for the period-first composition. */
const AMOUNTS_IN = "Amounts are in";

/** The gap rule, in one sentence, stated once per composition. */
const GAP_SENTENCE = "A month the source recorded no gift in is a gap, not a zero.";

/** The grain the caption states, so the wide table says what one of its cells counts. */
const CAPTION_GRAIN =
  "one row is one partner or support attribution, one column is one month, and every cell states " +
  "the authorised allocations the source recorded in it";

/** What a period-first block reads when none of that month's figures can be stated. */
const PERIOD_WITHOUT_AMOUNT_NOTE =
  "No amount is stated for this month: either the source recorded no gift, or it did not establish " +
  "the value. Neither is a zero.";

/** The notice a result that carries no matrix renders, instead of a table of unrelated figures. */
const ABSENT_MATRIX_TITLE = "This result carries no partner-by-month matrix";
const ABSENT_MATRIX_DESCRIPTION =
  "The partners-by-month matrix is computed for that one report, so a result from another report has " +
  "no cells to show here. Nothing is substituted for it, because a table that looked like this one " +
  "while describing different records would be worse than no table at all.";

/** One month of the matrix, as the result states it. */
type MatrixMonth = Matrix["months"][number];

/**
 * Writes one part of a civil date in the reader's locale, without moving it through a zone.
 *
 * The date's own parts are what is rendered, so a display-timezone change can never shift a month
 * boundary, and the locale is always the caller's explicit tag rather than the platform's, so the
 * server render and the browser render agree. A tag `Intl` refuses throws a `RangeError`, and a throw
 * during render would take the whole report down over a preference the reader can change; the stored
 * ISO form is the honest fallback, because it is unambiguous and reads as a date. Any other throw is a
 * defect and is not absorbed.
 */
function civilLabel(
  date: MatrixMonth["start"],
  locale: string,
  format: Intl.DateTimeFormatOptions,
): string {
  try {
    return date.toLocaleString(locale, format);
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    return String(date);
  }
}

/** The matrix's months in the result's own order, each prepared with the key a cell is matched on. */
function monthsOf(matrix: Matrix, locale: string): readonly MonthColumn[] {
  return matrix.months.map((month) => ({
    key: String(month.start),
    longLabel: civilLabel(month.start, locale, MONTH_HEADING_FORMAT),
    shortLabel: civilLabel(month.start, locale, MONTH_COLUMN_FORMAT),
  }));
}

/**
 * The matrix's rows in the result's own order, each carrying only the cells of one currency.
 *
 * Cells are matched by the two facts they state — their currency and the month they cover — rather
 * than by their position, so a consumer cannot drift if the result ever states its cells in another
 * order. Nothing here reorders, merges or sums: the row order is the result's, and a row's figures are
 * the figures the result stated for it.
 */
function rowsOf(matrix: Matrix, currency: string): readonly PartitionRow[] {
  return matrix.rows.map((row) => {
    const cellsByMonth = new Map<string, MatrixCell>();
    for (const cell of row.cells) {
      if (cell.currency === currency) {
        cellsByMonth.set(String(cell.bucketStart), cell);
      }
    }
    return {
      key: rowKeyOf(row),
      label: row.label,
      opaqueReference: row.partnerId !== undefined,
      cellsByMonth,
    };
  });
}

/**
 * The identity of one matrix row inside the table.
 *
 * A partner row is keyed by its opaque reference and every other row by the kind of support it
 * carries, so a partner's row and the two nameless kinds — anonymous and unattributed support — each
 * have exactly one identity here and no two can collide.
 */
function rowKeyOf(row: MatrixRow): string {
  return row.partnerId === undefined ? row.attribution.kind : `partner:${row.partnerId}`;
}

/**
 * The word and the explanation a cell that states no amount renders.
 *
 * `unknown`, `withheld` and `unavailable` are the three states a figure can be in without being a
 * figure, and each is named as itself so that a value the source never established, a value this
 * context may not show and a source that could not be read stay three facts rather than one blank.
 * The explanation is the family's own sentence from `../copy`, so the surface explains the state in
 * the same words the rest of the Support family uses. A state that claims to carry an amount while
 * carrying none is not a figure that may be printed, so it reads as unknown: that is a defect in the
 * data, and printing a number for it would be the one thing this component must never do.
 */
function markerFor(valueState: ValueState): AmountlessMarker {
  switch (valueState) {
    case "withheld":
      return { word: "Withheld", explanation: VALUE_STATE_MEANING.withheld };
    case "unavailable":
      return { word: "Unavailable", explanation: VALUE_STATE_MEANING.unavailable };
    default:
      return { word: "Unknown", explanation: VALUE_STATE_MEANING.unknown };
  }
}

/**
 * Whether a cell states a figure a reader could drill into.
 *
 * A gap recorded no authorised row and a state without an amount recorded no value, so neither can
 * name the amount a drilldown link must announce, and neither narrows to anything a reader could
 * reconcile against the cell.
 */
function statesAmount(cell: MatrixCell): boolean {
  return !cell.gap && cell.value.minorUnits !== null;
}

/** The cells of one month that state a figure, for the period-first composition. */
function statedCells(rows: readonly PartitionRow[], month: MonthColumn): readonly StatedCell[] {
  const stated: StatedCell[] = [];
  for (const row of rows) {
    const cell = row.cellsByMonth.get(month.key);
    if (cell !== undefined && statesAmount(cell)) {
      stated.push({ row, cell });
    }
  }
  return stated;
}

// ---------------------------------------------------------------------------------------------
// The two compositions of one currency partition
// ---------------------------------------------------------------------------------------------

/** What both compositions of a partition need: the result's own order, and the figure renderers. */
interface MatrixCompositionProps {
  /** The one currency this partition states; no cell of it ever holds another. */
  readonly currency: string;
  /** The matrix's months in the result's order, prepared once for both compositions. */
  readonly months: readonly MonthColumn[];
  /** This partition's rows in the result's order, each holding only this currency's cells. */
  readonly rows: readonly PartitionRow[];
  /** The viewer's display locale, for every month label and every figure. */
  readonly locale: string;
  /** The caller's builder for a cell's narrowed ledger address. */
  readonly drilldownHref: (cell: MatrixCell) => string;
}

/**
 * A cell that states no amount: the word for the fact, and the family's own sentence behind it.
 *
 * The sentence is visually hidden rather than abbreviated, because the word alone ("Unknown",
 * "Withheld", "Unavailable") is what makes a sighted reader distinguish the three states, and a
 * screen-reader user hears the same distinction only if the sentence arrives with it. The sentence is
 * not repeated once per cell for gaps, which are the common case: the caption states the gap rule for
 * the whole table.
 */
function AmountlessValue({ marker }: { readonly marker: AmountlessMarker }): ReactElement {
  return (
    <span className={QUIET_TEXT_CLASS}>
      {marker.word}
      <span className="sr-only">{`. ${marker.explanation}`}</span>
    </span>
  );
}

/**
 * What one cell shows, and the only place a figure becomes a control.
 *
 * A cell that states an amount is activated through a real link, whose accessible name carries the
 * amount it shows plus the partner and the month it belongs to — so a link lifted out of the table by
 * a screen reader's link list still says what it opens. A cell that states no amount is plain text:
 * there is no amount to name and the narrowed query honestly returns nothing.
 */
function MatrixCellContent({
  cell,
  scopeName,
  locale,
  drilldownHref,
}: {
  /** The cell at this row and month, or `undefined` if the result omitted it. */
  readonly cell: MatrixCell | undefined;
  /** The partner and month this cell belongs to, announced alongside the amount. */
  readonly scopeName: string;
  readonly locale: string;
  readonly drilldownHref: (cell: MatrixCell) => string;
}): ReactElement {
  if (cell === undefined || cell.gap) {
    return <span className={QUIET_TEXT_CLASS}>{GAP_CELL_WORD}</span>;
  }
  const { minorUnits, valueState } = cell.value;
  if (minorUnits === null) {
    return <AmountlessValue marker={markerFor(valueState)} />;
  }
  return (
    <Link href={drilldownHref(cell)} className={DRILLDOWN_LINK_CLASS}>
      <AmountValue
        money={{ currency: cell.currency, minorUnits }}
        valueState={valueState}
        locale={locale}
      />
      <span className="sr-only">{`${NAME_SEPARATOR}${scopeName}`}</span>
    </Link>
  );
}

/**
 * The wide composition: the matrix as a table, inside the application's one scroll region.
 *
 * The caption names the report, the currency partition and the grain, so a reader arriving at the
 * table from a table list knows what it counts and in what units before hearing a figure; the gap rule
 * rides with it rather than in every empty cell. Row headers are `th scope="row"` and column headers
 * `th scope="col"`, so a screen reader announces the partner and the month with each cell, and every
 * figure sits at the end edge of the logical axis whichever direction the block runs in.
 */
function WideMatrix({
  currency,
  months,
  rows,
  locale,
  drilldownHref,
}: MatrixCompositionProps): ReactElement {
  return (
    <ScrollRegion
      label={`${REPORT_COPY.matrix.title} in ${currency}, scrollable`}
      className="rounded-lg"
    >
      <Table>
        <TableCaption className="text-start">
          {`${REPORT_COPY.matrix.title} in `}
          <bdi className="mono-identifier">{currency}</bdi>
          {` — ${CAPTION_GRAIN}. ${GAP_SENTENCE}`}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{PARTNER_COLUMN_HEADING}</TableHead>
            {months.map((month) => (
              <TableHead key={month.key} scope="col" className={NUMERIC_CELL_CLASS}>
                <bdi>{month.shortLabel}</bdi>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableHead scope="row" className="h-auto font-normal">
                <bdi className={row.opaqueReference ? "mono-identifier" : undefined}>
                  {row.label}
                </bdi>
              </TableHead>
              {months.map((month) => (
                <TableCell key={month.key} className={NUMERIC_CELL_CLASS}>
                  <MatrixCellContent
                    cell={row.cellsByMonth.get(month.key)}
                    scopeName={`${row.label}, ${month.longLabel}`}
                    locale={locale}
                    drilldownHref={drilldownHref}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollRegion>
  );
}

/**
 * The narrow composition: the same result as a period-first sequence of labelled blocks.
 *
 * At 320 CSS pixels a partner-by-month table would need a sideways drag to read a row, so the matrix
 * is turned around: each month is a heading, and under it the partners whose figure that month states,
 * with the same amounts and the same drilldown links. It reads the same `result`, computes nothing and
 * declares no scroll container, so precision never depends on a gesture and the page still never
 * scrolls horizontally.
 */
function PeriodFirstMatrix({
  currency,
  months,
  rows,
  locale,
  drilldownHref,
}: MatrixCompositionProps): ReactElement {
  return (
    <section
      aria-label={`${REPORT_COPY.matrix.title} in ${currency}, by period`}
      className="flex min-w-0 flex-col gap-4 md:hidden"
      data-slot="report-matrix-periods"
    >
      <p className={QUIET_TEXT_CLASS}>
        {`${AMOUNTS_IN} `}
        <bdi className="mono-identifier">{currency}</bdi>
        {`. ${GAP_SENTENCE}`}
      </p>
      {months.map((month) => {
        const stated = statedCells(rows, month);
        return (
          <div key={month.key} className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">{month.longLabel}</h3>
            {stated.length === 0 ? (
              <p className={QUIET_TEXT_CLASS}>{PERIOD_WITHOUT_AMOUNT_NOTE}</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {stated.map(({ row, cell }) => (
                  <li
                    key={row.key}
                    className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
                  >
                    <span className="min-w-0 break-words">
                      <bdi className={row.opaqueReference ? "mono-identifier" : undefined}>
                        {row.label}
                      </bdi>
                    </span>
                    <MatrixCellContent
                      cell={cell}
                      scopeName={`${row.label}, ${month.longLabel}`}
                      locale={locale}
                      drilldownHref={drilldownHref}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------

/**
 * Renders fixed report 3: one partner-by-month matrix per currency, each with a cell-level drilldown.
 *
 * A result that carries no matrix, and a matrix whose authorised row set is empty, are two different
 * facts and each is stated as itself: the first is a result from another report, and the second is a
 * query under which the source recorded no gift. Neither renders an empty table, and no figure is
 * invented for either.
 */
export function ReportMatrix({
  result,
  locale,
  dir,
  drilldownHref,
  className,
}: ReportMatrixProps): ReactElement {
  const matrix = result.matrix;

  if (matrix === undefined) {
    return (
      <div data-slot="report-matrix" dir={dir} className={cn("min-w-0", className)}>
        <StateNotice
          kind="empty"
          title={ABSENT_MATRIX_TITLE}
          description={ABSENT_MATRIX_DESCRIPTION}
          action={{
            label: EMPTY_STATES.reports.action.label,
            href: EMPTY_STATES.reports.action.href,
          }}
        />
      </div>
    );
  }

  // With no authorised row there is no attribution to show, and with no currency partition there is
  // no figure the application could state. Both use the Gifts surface's own empty wording, which
  // explains that a period the source does not cover is a gap rather than a zero.
  if (matrix.rows.length === 0 || matrix.currencies.length === 0) {
    return (
      <div data-slot="report-matrix" dir={dir} className={cn("min-w-0", className)}>
        <StateNotice
          kind="empty"
          title={EMPTY_STATES.gifts.title}
          description={EMPTY_STATES.gifts.body}
          action={{
            label: EMPTY_STATES.gifts.action.label,
            href: EMPTY_STATES.gifts.action.href,
          }}
        />
      </div>
    );
  }

  const months = monthsOf(matrix, locale);

  return (
    <div
      data-slot="report-matrix"
      dir={dir}
      className={cn("flex min-w-0 flex-col gap-6", className)}
    >
      {matrix.currencies.map((currency) => {
        const rows = rowsOf(matrix, currency);
        return (
          <div
            key={currency}
            data-slot="report-matrix-partition"
            className="flex min-w-0 flex-col gap-4"
          >
            {/*
              Two compositions of one partition with opposite responsive display utilities, so
              `display: none` removes the other from the accessibility tree: a reader meets the table
              or the period-first sequence, never both and never neither.
            */}
            <div className="hidden min-w-0 md:block">
              <WideMatrix
                currency={currency}
                months={months}
                rows={rows}
                locale={locale}
                drilldownHref={drilldownHref}
              />
            </div>
            <PeriodFirstMatrix
              currency={currency}
              months={months}
              rows={rows}
              locale={locale}
              drilldownHref={drilldownHref}
            />
          </div>
        );
      })}
    </div>
  );
}

export default ReportMatrix;
