/**
 * The printable page of a Support report: one `ReportResult`, read through the `printModel` the export
 * read returns, laid out so the browser's own print produces a sheet whose figures, period, coverage
 * and as-of instant are the ones the screen showed (AAP 0.8.8; AAP 0.10.1 family 8; criterion 1).
 */
import type { ReactElement } from "react";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { Coverage } from "@/modules/data-service/envelope";
import type { PrintCell, PrintColumn, PrintModel, PrintRow } from "@/modules/export/print";
import type { SupportBasis } from "@/modules/support/basis";
import { EMPTY_STATES, SUPPORT_GRAIN_STATEMENT } from "../copy";
import SnapshotStatement from "./snapshot-statement";
// What the caller passes
/** The snapshot this printed page states: field for field the one it hands the on-screen statement. */
export type PrintReportSnapshot = {
  readonly basis: SupportBasis;
  readonly currencies: readonly string[];
  readonly period: { readonly from: string; readonly to: string } | null;
  readonly coverage: Coverage;
  readonly asOf: string;
  readonly isCurrentPeriod: boolean;
};
/** Props of {@link PrintReport}. */
export type PrintReportProps = {
  readonly model: PrintModel;
  readonly snapshot: PrintReportSnapshot;
  readonly locale: string;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
};
// How the page is set
const REGION_LABEL = "Printable report";

const REGION_LAYOUT = "flex min-w-0 flex-col gap-6 print:gap-3 print:text-xs";

const HEADER_LAYOUT = "flex min-w-0 flex-col gap-1 print:break-inside-avoid";

const TITLE_CLASS = "text-xl font-semibold tracking-tight print:text-base";
const STATUS_CLASS = "text-sm font-medium print:text-xs";
const HEADING_CLASS = "text-base font-semibold print:text-sm";
const LABEL_CLASS = "font-medium";

const KEEP_TOGETHER = "min-w-0 print:break-inside-avoid";

const CELL_CLASS = "align-top print:px-1 print:py-0.5 print:whitespace-normal";
const HEAD_CLASS = "print:px-1 print:py-0.5 print:whitespace-normal";
const ROW_CLASS = "print:break-inside-avoid";

const WRAPPING_TEXT_CLASS = "min-w-0 break-words";

const ALIGN: Readonly<Record<PrintColumn["align"], string>> = {
  start: "text-start",
  end: "text-end",
};
const HEADINGS = {
  summary: "Summary, one line per currency",
  rows: "Rows",
  about: "About this page",
} as const;
const LABELS = {
  statedIn: "Stated in",
  rowTotal: "Rows in this result",
} as const;
const NO_CURRENCY = "No currency is stated by this read";

const COMPLETENESS_PROSE: Readonly<Record<PrintModel["completeness"], string>> = {
  "whole-query": "This page holds every authorised row of the query, so the figures printed here are the whole " + "query's figures rather than a page of them.",
  "page-only": "This page holds one page of the query, so the rows printed here are a window of the result while " + "the row count stated below is the whole query's count.",
};
// Wording that states a value without changing it
function currencyPartitionText(currencies: readonly string[]): string {
  return currencies.length === 0 ? NO_CURRENCY : currencies.join(", ");
}
function countText(count: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(count);
  } catch {
    return String(count);
  }
}
// The table
function PrintedCell({ cell, align }: { readonly cell: PrintCell; readonly align: PrintColumn["align"] }): ReactElement {
  return (
    <TableCell className={cn(CELL_CLASS, ALIGN[align])}>
      <bdi>{cell.text}</bdi>
      {cell.accessibleLabel === null || cell.accessibleLabel === cell.text ? null : <span className="sr-only">{cell.accessibleLabel}</span>}
    </TableCell>
  );
}
function PrintedRow({ row, columns }: { readonly row: PrintRow; readonly columns: readonly PrintColumn[] }): ReactElement {
  return (
    <TableRow className={ROW_CLASS}>
      {row.map((cell, index) => {
        const column = columns[index];
        return <PrintedCell key={`${String(index)}:${column?.header ?? ""}`} cell={cell} align={column?.align ?? "start"} />;
      })}
    </TableRow>
  );
}
function PrintedTable({ model, partition }: { readonly model: PrintModel; readonly partition: string }): ReactElement {
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
            <TableHead key={`${String(index)}:${column.header}`} className={cn(HEAD_CLASS, ALIGN[column.align])}>
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
// The page
/** Renders one report result as the page a worker prints: its title and period state, the snapshot statement the screen shows, the per-currency summary, the rows, and the words that keep the. */
export function PrintReport({ model, snapshot, locale, dir, className }: PrintReportProps): ReactElement {
  const partition = currencyPartitionText(snapshot.currencies);
  return (
    <section aria-label={REGION_LABEL} data-print-report="" dir={dir} className={cn(REGION_LAYOUT, className)}>
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
              <li key={line.label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4">
                <span className={LABEL_CLASS}>
                  <bdi>{line.label}</bdi>
                </span>
                <span className="tabular-figures">
                  <bdi>{line.text}</bdi>
                  {line.accessibleLabel === line.text ? null : <span className="sr-only">{line.accessibleLabel}</span>}
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
