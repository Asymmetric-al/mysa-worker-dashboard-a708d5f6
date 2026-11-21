/**
 * The printable page of a Support report: one `ReportResult`, read through the `printModel` the export
 * read returns, laid out so the browser's own print produces a sheet whose figures, period, coverage and
 * as-of instant are the ones the screen showed (AAP 0.8.8; AAP 0.10.1 family 8; criterion 1).
 *
 * Why a page and not a document pipeline. Printing here is the browser printing a real route: this
 * application holds no PDF library, no server-side renderer and no workbook path, and it already has
 * exactly one content renderer (`modules/content/render`). So this file emits no HTML string, downloads
 * nothing and reports nothing a second time — it arranges the model's own strings and the model's own
 * columns in the design system's typography, and the browser prints the region.
 *
 * What it may not do, and does not. The report computation and the print model are the service's to
 * run, never this file's, so nothing here re-computes a total, a count, a percentage, a period, a
 * coverage boundary or an as-of instant; nothing re-sorts, re-pages or re-filters; and no money is
 * formatted here, because every amount arrives already rendered by `modules/money/format` beside the
 * sentence that states its value. Re-formatting one, or letting a rounded display value stand in for an
 * exact minor-unit sum, is exactly how a printed page stops agreeing with the ledger, the chart's table,
 * the drilldown and the CSV of the same query.
 *
 * The five value states stay five and a gap stays a gap. A cell prints what the model says: `zero` is a
 * recorded zero, `unknown`, `withheld`, `unavailable` and `incomplete-subtotal` are their own words, and
 * a month the source recorded nothing in is the model's gap sentence rather than a printed `0`. No value
 * can be recovered here, directly or by subtraction, because this file adds no figure of its own.
 *
 * The snapshot is stated once, by the component that owns that statement. `SnapshotStatement` with
 * `variant="print"` receives the same basis, currency partition, period, coverage, as-of instant and
 * current-period judgement the screen statement receives, and only its print typography differs, so the
 * printed statement is the screen's statement word for word. `model.facts` is deliberately not rendered:
 * it is the machine-readable form of those same values, kept for parity testing and the CSV preamble, and
 * printing it beside the statement would state one snapshot twice.
 *
 * Completeness is stated in words. `whole-query` and `page-only` are different claims, and the page makes
 * the claim the model made, in prose, beside the row count the model supplies — never a recount of the
 * rows it happens to hold. The model's ordered notes follow, so partial or unknown coverage, withheld
 * values and missing months are all said on paper.
 *
 * Rules this file holds to: no clock (`Date`/`Date.now`), so the page describes the read it came from and
 * not the day it was printed; no colour, radius or shadow literal, so every value resolves to a token; no
 * interactive or focusable element and no scroll container, because paper has neither a pointer nor a
 * keyboard and the application's one horizontal scroll port belongs to the screen's `ScrollRegion`; every
 * amount, date, currency code and opaque reference sits in a `<bdi>`, so a right-to-left page cannot
 * reorder them; and the headings nest under the report frame's own heading — `h2` for this page, `h3` for
 * its sections — so the printed outline stays in order.
 *
 * Visibility is not decided here. The frame around the reports (`report-frame`) owns the mutually
 * exclusive pair — the on-screen region and this printed page, one exposed at a time — and hands its
 * visibility classes in through `className`; this component lays out the printed page itself.
 */

import type { ReactElement } from "react";

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
import type { Coverage } from "@/modules/data-service/envelope";
import type { PrintCell, PrintColumn, PrintModel, PrintRow } from "@/modules/export/print";
import type { SupportBasis } from "@/modules/support/basis";

import { EMPTY_STATES, SUPPORT_GRAIN_STATEMENT } from "../copy";
import SnapshotStatement from "./snapshot-statement";

// ---------------------------------------------------------------------------------------------
// What the caller passes
// ---------------------------------------------------------------------------------------------

/**
 * The snapshot this printed page states: field for field the one it hands the on-screen statement.
 *
 * Every member arrives from the read envelope and the report result, and none is derived here — the
 * print region exists so that the page and the screen describe one snapshot, so a value this type filled
 * in for itself would be a second description of it.
 */
export type PrintReportSnapshot = {
  /** The one named basis the read was computed on. */
  readonly basis: SupportBasis;
  /** The currency partition the figures are stated in; empty when the read states no currency. */
  readonly currencies: readonly string[];
  /** The civil dates (`YYYY-MM-DD`) the figures cover, or `null` when the read has no period. */
  readonly period: { readonly from: string; readonly to: string } | null;
  /** How much of the past the read covers, taken straight from the envelope. */
  readonly coverage: Coverage;
  /** The instant the read was evaluated at, which is not when the source last changed. */
  readonly asOf: string;
  /** The envelope's judgement that the period has not closed; never inferred from `asOf`. */
  readonly isCurrentPeriod: boolean;
};

/** Props of {@link PrintReport}. */
export type PrintReportProps = {
  /**
   * The printable model the service built from the same `ReportResult` the screen rendered. This file
   * never builds one, so the printed page and the screen cannot describe different computations.
   */
  readonly model: PrintModel;
  /** The snapshot the page states, identical to the one the screen statement receives. */
  readonly snapshot: PrintReportSnapshot;
  /** The viewer's display locale, used for digit grouping in the model and for the row count. */
  readonly locale: string;
  /** The direction of the content, so a right-to-left report prints right to left. */
  readonly dir?: "ltr" | "rtl";
  /** Caller-supplied classes, logical utilities only — the frame's visibility pair arrives here. */
  readonly className?: string;
};

// ---------------------------------------------------------------------------------------------
// How the page is set
// ---------------------------------------------------------------------------------------------

/** The name of the region, so a screen-reader user can reach the printed page as a landmark. */
const REGION_LABEL = "Printable report";

/** The page's block layout, and the smaller typography that applies only on paper. */
const REGION_LAYOUT = "flex min-w-0 flex-col gap-6 print:gap-3 print:text-xs";

/** The title block, kept whole so a page break cannot separate a report's name from its period state. */
const HEADER_LAYOUT = "flex min-w-0 flex-col gap-1 print:break-inside-avoid";

const TITLE_CLASS = "text-xl font-semibold tracking-tight print:text-base";
const STATUS_CLASS = "text-sm font-medium print:text-xs";
const HEADING_CLASS = "text-base font-semibold print:text-sm";
const LABEL_CLASS = "font-medium";

/** A block that must not be split across two printed sheets. */
const KEEP_TOGETHER = "min-w-0 print:break-inside-avoid";

/**
 * A printed cell: the registry's padding, reduced on paper so a row of the wider reports still fits a
 * sheet, with wrapping allowed because an identifier or a date is never worth losing off the edge.
 */
const CELL_CLASS = "align-top print:px-1 print:py-0.5 print:whitespace-normal";
const HEAD_CLASS = "print:px-1 print:py-0.5 print:whitespace-normal";
const ROW_CLASS = "print:break-inside-avoid";

/** Text that must wrap rather than overflow its block at any width, including on a printed sheet. */
const WRAPPING_TEXT_CLASS = "min-w-0 break-words";

/**
 * The alignment a column states, on the logical axis.
 *
 * `text-start`/`text-end` rather than a physical side, so a right-to-left page keeps its amount column
 * on the same edge and the model's hint is the only input — the model never states a side.
 */
const ALIGN: Readonly<Record<PrintColumn["align"], string>> = {
  start: "text-start",
  end: "text-end",
};

/**
 * The headings this page contributes, one per block.
 *
 * They are names, not explanations: what a figure means is `../copy`'s, so a printed sheet cannot
 * paraphrase the basis, the grain, the bucket meanings or the empty state and drift from the screen.
 * They nest under the report frame's heading, which is why the page's own title is an `h2`.
 */
const HEADINGS = {
  summary: "Summary, one line per currency",
  rows: "Rows",
  about: "About this page",
} as const;

/** The field names this page contributes, beside the wording `../copy` owns. */
const LABELS = {
  statedIn: "Stated in",
  rowTotal: "Rows in this result",
} as const;

/** What the caption states when the read carries no currency at all. */
const NO_CURRENCY = "No currency is stated by this read";

/**
 * What the page says about the rows it holds, keyed by the model's own completeness field so a third
 * value cannot be added without being worded here.
 *
 * The distinction is the point: `whole-query` may be read as the query's figures, while `page-only` is a
 * window of them, and a printed sheet that let the second read as the first would be the one place a
 * partial view could pass for a complete answer.
 */
const COMPLETENESS_PROSE: Readonly<Record<PrintModel["completeness"], string>> = {
  "whole-query":
    "This page holds every authorised row of the query, so the figures printed here are the whole " +
    "query's figures rather than a page of them.",
  "page-only":
    "This page holds one page of the query, so the rows printed here are a window of the result while " +
    "the row count stated below is the whole query's count.",
};

// ---------------------------------------------------------------------------------------------
// Wording that states a value without changing it
// ---------------------------------------------------------------------------------------------

/**
 * The currency partition as one readable run of codes.
 *
 * The codes are the snapshot's own and are joined without being formatted: a currency code is an
 * identifier rather than an amount, `SnapshotStatement` states the same partition in the reader's list
 * convention immediately above this table, and joining is the whole of what a caption needs.
 */
function currencyPartitionText(currencies: readonly string[]): string {
  return currencies.length === 0 ? NO_CURRENCY : currencies.join(", ");
}

/**
 * A row count as display text, grouped in the reader's locale.
 *
 * A count is not an amount, so no money formatter is involved; and grouping changes no digit, which is
 * what lets a printed count be compared with the export's own count for the same result. An unusable
 * locale tag falls back to the plain decimal: the count is the fact and the grouping is not.
 */
function countText(count: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(count);
  } catch {
    return String(count);
  }
}

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

/**
 * One printed cell: the model's own text, plus the sentence a screen reader hears when it says more.
 *
 * The text is printed verbatim — it is already the formatter's rendering of an exact amount, or the
 * record's own identifier, or the state's own word — so nothing on this page can turn a withheld value
 * into a figure or a gap into a zero. The accessible sentence is added only when it differs from the
 * visible text, and it is never an `aria-label`, which would replace the printed value instead of
 * explaining it.
 */
function PrintedCell({
  cell,
  align,
}: {
  readonly cell: PrintCell;
  readonly align: PrintColumn["align"];
}): ReactElement {
  return (
    <TableCell className={cn(CELL_CLASS, ALIGN[align])}>
      <bdi>{cell.text}</bdi>
      {cell.accessibleLabel === null || cell.accessibleLabel === cell.text ? null : (
        <span className="sr-only">{cell.accessibleLabel}</span>
      )}
    </TableCell>
  );
}

/**
 * One printed row: one cell per column, in the model's order.
 *
 * A row whose cell count disagrees with the column count is a model defect rather than something to
 * repair here, so a missing column falls back to `start` alignment and the cell still prints: losing a
 * value off a sheet to hide a mismatch would be the worse failure.
 */
function PrintedRow({
  row,
  columns,
}: {
  readonly row: PrintRow;
  readonly columns: readonly PrintColumn[];
}): ReactElement {
  return (
    <TableRow className={ROW_CLASS}>
      {row.map((cell, index) => {
        const column = columns[index];
        return (
          <PrintedCell
            key={`${String(index)}:${column?.header ?? ""}`}
            cell={cell}
            align={column?.align ?? "start"}
          />
        );
      })}
    </TableRow>
  );
}

/**
 * The printed table: the model's columns, the model's rows in the model's order, and a caption that
 * names the report, the currency partition and the grain, so a sheet read on its own says what one row
 * of it is.
 *
 * The caption repeats the grain statement `../copy` declares rather than paraphrasing it: a caption is
 * the only thing a reader of a detached sheet has, and a shortened retelling of the grain rule is how a
 * printed page starts claiming a different count from the one the export makes. It carries no total,
 * because the figures are the result's and the row count is stated in words below the table.
 */
function PrintedTable({
  model,
  partition,
}: {
  readonly model: PrintModel;
  readonly partition: string;
}): ReactElement {
  return (
    <Table>
      <TableCaption className="mt-2 text-start print:mt-1 print:caption-top">
        {`${model.title}. ${LABELS.statedIn}: `}
        <bdi>{partition}</bdi>
        {`. ${SUPPORT_GRAIN_STATEMENT}`}
      </TableCaption>
      <TableHeader>
        <TableRow>
          {model.columns.map((column, index) => (
            <TableHead
              key={`${String(index)}:${column.header}`}
              className={cn(HEAD_CLASS, ALIGN[column.align])}
            >
              <bdi>{column.header}</bdi>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {model.rows.map((row, index) => (
          <PrintedRow key={String(index)} row={row} columns={model.columns} />
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

/**
 * Renders one report result as the page a worker prints: its title and period state, the snapshot
 * statement the screen shows, the per-currency summary, the rows, and the words that keep the sheet
 * honest about what it does not hold.
 *
 * Nothing is read from a clock, a browser API, an ambient locale or the store, so the server render, a
 * client render and the printed sheet produce identical text for identical props — which is what makes
 * the printed figures comparable, line for line, with the CSV of the same query.
 */
export function PrintReport({
  model,
  snapshot,
  locale,
  dir,
  className,
}: PrintReportProps): ReactElement {
  const partition = currencyPartitionText(snapshot.currencies);

  return (
    <section
      aria-label={REGION_LABEL}
      data-print-report=""
      dir={dir}
      className={cn(REGION_LAYOUT, className)}
    >
      <header className={HEADER_LAYOUT}>
        <h2 className={TITLE_CLASS}>
          <bdi>{model.title}</bdi>
        </h2>
        {/*
          The period state the model carries, printed as text. It is not derived here: a page that
          decided "in progress" from its own idea of today would describe the day it was printed rather
          than the read it came from.
        */}
        {model.statusLabel === null ? null : (
          <p className={STATUS_CLASS}>
            <bdi>{model.statusLabel}</bdi>
          </p>
        )}
      </header>

      {/*
        One statement, from the component that owns the wording: the same basis, partition, period,
        coverage, as-of instant and current-period judgement the screen statement receives.
      */}
      <SnapshotStatement
        variant="print"
        basis={snapshot.basis}
        currencies={snapshot.currencies}
        period={snapshot.period}
        coverage={snapshot.coverage}
        asOf={snapshot.asOf}
        isCurrentPeriod={snapshot.isCurrentPeriod}
        locale={locale}
        className={KEEP_TOGETHER}
      />

      {/*
        One line per currency and never a combined figure: the model has no exchange rate to combine
        them with, so a single printed total would state a number no source reported.
      */}
      {model.summary.length === 0 ? null : (
        <div className={cn("flex flex-col gap-2", KEEP_TOGETHER)}>
          <h3 className={HEADING_CLASS}>{HEADINGS.summary}</h3>
          <ul className="flex flex-col gap-1">
            {model.summary.map((line) => (
              <li
                key={line.label}
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4"
              >
                <span className={LABEL_CLASS}>
                  <bdi>{line.label}</bdi>
                </span>
                <span className="tabular-figures">
                  <bdi>{line.text}</bdi>
                  {line.accessibleLabel === line.text ? null : (
                    <span className="sr-only">{line.accessibleLabel}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className={HEADING_CLASS}>{HEADINGS.rows}</h3>
        {/*
          A result with no row is stated in the family's own empty wording rather than as a table with
          no body: a printed header row with nothing under it reads as a value that was left out, and a
          blank page would read as a failed print. The wording is `../copy`'s own rather than a variant
          written for paper, so the sheet and the screen say one thing about one empty result; its action
          link is deliberately not rendered, because the printed page carries no control. The notes below
          still state what the read covered.
        */}
        {model.rows.length === 0 ? (
          <div className={cn("flex flex-col gap-1", KEEP_TOGETHER)}>
            <p className={LABEL_CLASS}>{EMPTY_STATES.gifts.title}</p>
            <p className={WRAPPING_TEXT_CLASS}>{EMPTY_STATES.gifts.body}</p>
          </div>
        ) : (
          <PrintedTable model={model} partition={partition} />
        )}
      </div>

      <div className={cn("flex flex-col gap-2", KEEP_TOGETHER)}>
        <h3 className={HEADING_CLASS}>{HEADINGS.about}</h3>
        <p className={WRAPPING_TEXT_CLASS}>{COMPLETENESS_PROSE[model.completeness]}</p>
        <p className={WRAPPING_TEXT_CLASS}>
          {`${LABELS.rowTotal}: `}
          <bdi>{countText(model.rowTotal, locale)}</bdi>
        </p>
        {model.notes.length === 0 ? null : (
          <ul className="flex list-disc flex-col gap-1 ps-5">
            {model.notes.map((note, index) => (
              <li key={`${String(index)}:${note}`} className={WRAPPING_TEXT_CLASS}>
                {note}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default PrintReport;
