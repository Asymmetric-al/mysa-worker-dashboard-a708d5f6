import type { ReactElement } from "react";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { Coverage } from "@/modules/data-service/envelope";
import type { PrintCell, PrintColumn, PrintModel, PrintRow } from "@/modules/export/print";
import type { SupportBasis } from "@/modules/support/basis";
import { EMPTY_STATES, SUPPORT_GRAIN_STATEMENT } from "../copy";
import { countText } from "./count-text";
import SnapshotStatement from "./snapshot-statement";
export type PrintReportSnapshot = { readonly basis: SupportBasis; readonly currencies: readonly string[]; readonly period: { readonly from: string; readonly to: string } | null; readonly coverage: Coverage; readonly asOf: string; readonly isCurrentPeriod: boolean };
export type PrintReportProps = { readonly model: PrintModel; readonly snapshot: PrintReportSnapshot; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly className?: string };
const KEEP_TOGETHER = "min-w-0 print:break-inside-avoid";
const HEADING_CLASS = "type-subsection-title print:text-sm";
const WRAPPING_TEXT_CLASS = "min-w-0 break-words";
const ALIGN: Readonly<Record<PrintColumn["align"], string>> = { start: "text-start", end: "text-end" };
const HEADINGS = { summary: "Summary, one line per currency", rows: "Rows", about: "About this page" } as const;
const COMPLETENESS_PROSE: Readonly<Record<PrintModel["completeness"], string>> = {
  "whole-query": "This page holds every authorised row of the query, so the figures printed here are the whole " + "query's figures rather than a page of them.",
  "page-only": "This page holds one page of the query, so the rows printed here are a window of the result while " + "the row count stated below is the whole query's count.",
};
const currencyPartitionText = (currencies: readonly string[]): string => (currencies.length === 0 ? "No currency is stated by this read" : currencies.join(", "));
function PrintedCell({ cell, align }: { readonly cell: PrintCell; readonly align: PrintColumn["align"] }): ReactElement {
  return (
    <TableCell className={cn("align-top print:px-1 print:py-0.5 print:whitespace-normal", ALIGN[align])}>
      <bdi>{cell.text}</bdi>
      {cell.accessibleLabel === null || cell.accessibleLabel === cell.text ? null : <span className="sr-only">{cell.accessibleLabel}</span>}
    </TableCell>
  );
}
function PrintedRow({ row, columns }: { readonly row: PrintRow; readonly columns: readonly PrintColumn[] }): ReactElement {
  return (
    <TableRow className="print:break-inside-avoid">
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
        {`${model.title}. Stated in: `}
        <bdi>{partition}</bdi>
        {`. ${SUPPORT_GRAIN_STATEMENT}`}
      </TableCaption>
      <TableHeader>
        <TableRow>
          {model.columns.map((column, index) => (
            <TableHead key={`${String(index)}:${column.header}`} className={cn("print:px-1 print:py-0.5 print:whitespace-normal", ALIGN[column.align])}>
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
} /** Renders one report result as the page a worker prints: its title and period state, the snapshot statement the screen shows, the per-currency summary, the rows, and the words that keep the printed sheet checkable. */
export function PrintReport({ model, snapshot, locale, dir, className }: PrintReportProps): ReactElement {
  const partition = currencyPartitionText(snapshot.currencies);
  return (
    <section aria-label="Printable report" data-print-report="" dir={dir} className={cn("flex min-w-0 flex-col gap-6 print:gap-3 print:text-xs", className)}>
      <header className="flex min-w-0 flex-col gap-1 print:break-inside-avoid">
        <h2 className="type-section-title print:text-base">
          <bdi>{model.title}</bdi>
        </h2>
        {model.statusLabel === null ? null : (
          <p className="text-sm font-medium print:text-xs">
            <bdi>{model.statusLabel}</bdi>
          </p>
        )}
      </header>
      <SnapshotStatement variant="print" basis={snapshot.basis} currencies={snapshot.currencies} period={snapshot.period} coverage={snapshot.coverage} asOf={snapshot.asOf} isCurrentPeriod={snapshot.isCurrentPeriod} locale={locale} className={KEEP_TOGETHER} />
      {model.summary.length === 0 ? null : (
        <div className={cn("flex flex-col gap-2", KEEP_TOGETHER)}>
          <h3 className={HEADING_CLASS}>{HEADINGS.summary}</h3>
          <ul className="flex flex-col gap-1">
            {model.summary.map((line) => (
              <li key={line.label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4">
                <bdi className="font-medium">{line.label}</bdi>
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
        {model.rows.length === 0 ? (
          <div className={cn("flex flex-col gap-1", KEEP_TOGETHER)}>
            <p className="font-medium">{EMPTY_STATES.gifts.title}</p>
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
          {"Rows in this result: "}
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
