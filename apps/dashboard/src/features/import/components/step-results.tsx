"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { PaginationBar } from "@/components/pagination-bar";
import SimulationLabel from "@/components/simulation-label";
import { Badge } from "@/components/ui/badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { ImportRowState } from "@/modules/data-service/envelope";
import type { ImportProposalRowRoute, ImportReceiptCancellationView, ImportRowWindow } from "@/modules/data-service/reads/import";
import type { RowResultCopyEntry } from "../copy";
import { IMPORT_SIMULATION_EFFECT, JOURNEY_COPY, RESULTS_COPY, RESULT_STATE_HEADINGS, ROW_RESULT_COPY, TABLE_LABELS, chosenFileSize, importReceiptHref, resultCorrectionStatement, resultPartnerLinkLabel, resultStoppableRowSentence, resultWindowSentence, reviewDecisionLabel } from "../copy";
import { IMPORT_ROW_RESULT_STATES } from "@/modules/import/receipt";
import FactRow from "./fact-row";
import ImportTable from "./import-table";
import { StopImportReview, type ImportStopControl } from "./step-review";
const RESULT_HEADINGS: readonly string[] = [RESULTS_COPY.column.row, RESULTS_COPY.column.decision, RESULTS_COPY.column.state, RESULTS_COPY.column.reason, RESULTS_COPY.column.route];
/** One row of a completed import, in the words the read reported: what was decided, what became of it, why, and where it leads. */
export type ImportResultsRow = { readonly rowNumber: number; readonly decisionLabel: string; readonly state: ImportRowState | null; readonly stateLabel: string | null; readonly reason: string | null; readonly route: ImportProposalRowRoute | null };
/** One completed import, in the one shape a completed proposal and a receipt both project onto: */ export interface ImportResultsView {
  readonly importOperationId: string;
  readonly file: { readonly name: string; readonly bytes: number; readonly rowCount: number; readonly columnCount: number };
  readonly summary: { readonly create: number; readonly reuse: number; readonly skip: number; readonly unresolved: number; readonly rowCount: number };
  readonly rows: readonly ImportResultsRow[];
  readonly rowWindow: ImportRowWindow;
  readonly stoppableRows: number;
  readonly stateCounts: Readonly<Record<ImportRowState, number>> | null;
  /** The stop this import's receipt records, exactly as the read states it, or `null` while the import has not been stopped. */ readonly cancellation: ImportReceiptCancellationView | null;
}
/** Props of {@link StepResults}. */ export interface StepResultsProps {
  readonly results: ImportResultsView;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly stop: ImportStopControl;
  readonly onStartAnother: () => void;
  readonly onCorrection?: ((rowNumber: number) => void) | undefined;
  readonly recovered: boolean;
}
function RowRoute({ row, onCorrection }: { readonly row: ImportResultsRow; readonly onCorrection?: ((rowNumber: number) => void) | undefined }): ReactElement {
  const route = row.route;
  if (route === null) return <span className="text-muted-foreground">{RESULTS_COPY.noRoute}</span>;
  if (route.kind === "partner") {
    return (
      <Link className="inline-flex min-h-6 items-center inline-link" href={`${/partners/}${encodeURIComponent(route.partnerId)}`}>
        {resultPartnerLinkLabel(row.rowNumber)}
      </Link>
    );
  }
  if (onCorrection === undefined) return <span className="text-muted-foreground">{resultCorrectionStatement(route.rowNumber)}</span>;
  return (
    <Button type="button" variant="outline" size="sm" className={`${BUTTON_WRAP_CLASS} text-start`} onClick={() => onCorrection(route.rowNumber)}>
      {reviewDecisionLabel(route.rowNumber)}
    </Button>
  );
}
/** Step five of the contact import: the per-row result of one completed operation, its counts and its routes. */ export default function StepResults({ results, onPageChange, onPageSizeChange, stop, onStartAnother, onCorrection, recovered }: StepResultsProps): ReactElement {
  const stateCounts = results.stateCounts;
  const cancellation = results.cancellation;
  const firstRowHeader = useRef<HTMLTableCellElement | null>(null);
  const focusedOperation = useRef<string | null>(null);
  useEffect(() => {
    if (focusedOperation.current === results.importOperationId) return;
    const target = firstRowHeader.current;
    if (target === null) return;
    focusedOperation.current = results.importOperationId;
    target.focus();
  }, [results.importOperationId]);
  const receiptHref = importReceiptHref(results.importOperationId); // The one receipt address this step states, built from the operation it shows: the link, the printed address and the copy control all read this value, so none of them can name a different operation.
  // The answer names the operation it was given for, so an import started after this one never inherits its announcement: the live region only states what the copy control did for the identity on screen.
  const [receiptCopy, setReceiptCopy] = useState<{ readonly operationId: string; readonly result: "copied" | "unavailable" } | null>(null);
  const receiptAnnouncement = receiptCopy === null || receiptCopy.operationId !== results.importOperationId ? "" : receiptCopy.result === "copied" ? RESULTS_COPY.copyReceiptCopied : RESULTS_COPY.copyReceiptUnavailable;
  // The clipboard may be absent or refuse the write, so both answers are announced beside the address rather than thrown: the address is printed above the control, which only saves the work of selecting it.
  const copyReceiptAddress = (): void => {
    const operationId = results.importOperationId;
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) {
      setReceiptCopy({ operationId, result: "unavailable" });
      return;
    }
    try {
      void clipboard.writeText(receiptHref).then(
        () => setReceiptCopy({ operationId, result: "copied" }),
        () => setReceiptCopy({ operationId, result: "unavailable" }),
      );
    } catch {
      setReceiptCopy({ operationId, result: "unavailable" });
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="type-supporting text-pretty">{RESULTS_COPY.lead}</p>
      {recovered ? (
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="font-medium">{JOURNEY_COPY.reload.completedHeading}</p> <p className="type-supporting text-pretty">{JOURNEY_COPY.reload.completedStatement}</p>
        </div>
      ) : null}
      <SimulationLabel effect={IMPORT_SIMULATION_EFFECT} context="block" />
      {/* The identity and its address come before the counts: recovering a lost acknowledgement starts from the one identity the result was read back by. */}
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <p className="font-medium">{RESULTS_COPY.operationHeading}</p>
        <dl className="flex min-w-0 flex-col gap-1">
          <FactRow label={RESULTS_COPY.operationLabels.identity} value={results.importOperationId} mono />
          <FactRow label={RESULTS_COPY.operationLabels.receiptAddress} value={receiptHref} mono />
        </dl>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Link className="inline-flex min-h-6 items-center inline-link" href={receiptHref}>
            {RESULTS_COPY.receiptLinkLabel}
          </Link>
          <Button type="button" variant="outline" size="sm" className={BUTTON_WRAP_CLASS} onClick={copyReceiptAddress}>
            {RESULTS_COPY.copyReceiptLabel}
          </Button>
        </div>
        <p className="type-supporting text-pretty">{RESULTS_COPY.receiptNote}</p>
        <output aria-live="polite" aria-atomic="true" className="block min-h-4 text-xs text-pretty text-muted-foreground">
          {receiptAnnouncement}
        </output>
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <p className="font-medium">{RESULTS_COPY.fileHeading}</p>
        <dl className="flex min-w-0 flex-col gap-1">
          <FactRow label={RESULTS_COPY.fileLabels.name} value={results.file.name} />
          <FactRow label={RESULTS_COPY.fileLabels.size} value={chosenFileSize(results.file.bytes)} />
          <FactRow label={RESULTS_COPY.fileLabels.rows} value={String(results.file.rowCount)} />
          <FactRow label={RESULTS_COPY.fileLabels.columns} value={String(results.file.columnCount)} />
        </dl>
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <p className="font-medium">{RESULTS_COPY.summaryHeading}</p>
        <dl className="flex min-w-0 flex-col gap-1">
          <FactRow label={RESULTS_COPY.summaryLabels.rowCount} value={String(results.summary.rowCount)} />
          <FactRow label={RESULTS_COPY.summaryLabels.create} value={String(results.summary.create)} />
          <FactRow label={RESULTS_COPY.summaryLabels.reuse} value={String(results.summary.reuse)} />
          <FactRow label={RESULTS_COPY.summaryLabels.skip} value={String(results.summary.skip)} />
          <FactRow label={RESULTS_COPY.summaryLabels.unresolved} value={String(results.summary.unresolved)} />
        </dl>
      </div>
      {stateCounts === null ? null : (
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="font-medium">{RESULTS_COPY.stateCountsHeading}</p>
          <dl className="flex min-w-0 flex-col gap-1">
            {IMPORT_ROW_RESULT_STATES.map((state) => (
              <FactRow key={state} label={RESULT_STATE_HEADINGS[state]} value={String(stateCounts[state])} />
            ))}
          </dl>
        </div>
      )}
      {/* The stop the receipt records, stated as the read reports it: the address that reads an import back is where a worker finds out that a stop reached only the rows acceptance had not applied. */}
      {cancellation === null ? null : (
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="font-medium">{RESULTS_COPY.cancellationHeading}</p>
          <dl className="flex min-w-0 flex-col gap-1">
            <FactRow label={RESULTS_COPY.cancellationLabels.cancelledAt} value={cancellation.cancelledAt} mono />
            <FactRow label={RESULTS_COPY.cancellationLabels.acceptedRowsRetained} value={String(cancellation.acceptedRowsRetained)} />
            <FactRow label={RESULTS_COPY.cancellationLabels.stoppedRows} value={String(cancellation.stoppedRows)} />
          </dl>
          <p className="text-pretty text-muted-foreground">{RESULTS_COPY.cancellationStatement}</p>
        </div>
      )}
      <p className="type-supporting text-pretty">{resultWindowSentence(results.rowWindow)}</p>
      <ImportTable label={TABLE_LABELS.results} headings={RESULT_HEADINGS}>
        {results.rows.map((row, rowIndex) => {
          const result: RowResultCopyEntry | null = row.state === null ? null : Object.hasOwn(ROW_RESULT_COPY, row.state) ? ROW_RESULT_COPY[row.state] : null;
          return (
            <TableRow key={row.rowNumber}>
              <TableHead scope="row" tabIndex={rowIndex === 0 ? -1 : undefined} ref={rowIndex === 0 ? (node) => void (firstRowHeader.current = node) : undefined} className="whitespace-normal align-top focus:outline-2 focus:outline-offset-2 focus:outline-[color:var(--ring)]">
                Row <bdi>{String(row.rowNumber)}</bdi>
              </TableHead>
              <TableCell className="whitespace-normal align-top">{row.decisionLabel}</TableCell>
              <TableCell className="whitespace-normal align-top">
                <Badge variant={result === null ? "outline" : result.badgeVariant}>{result === null ? (row.stateLabel ?? RESULTS_COPY.noState) : result.label}</Badge>
              </TableCell>
              <TableCell className="whitespace-normal align-top">
                <span className="block text-pretty">{row.reason === null ? RESULTS_COPY.noReason : row.reason}</span>
              </TableCell>
              <TableCell className="whitespace-normal align-top">
                <RowRoute row={row} onCorrection={onCorrection} />
              </TableCell>
            </TableRow>
          );
        })}
      </ImportTable>
      <PaginationBar total={results.rowWindow.total} page={results.rowWindow.page} pageSize={results.rowWindow.pageSize} itemNoun="rows" onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
      {results.stoppableRows <= 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="type-supporting text-pretty">{resultStoppableRowSentence(results.stoppableRows)}</p> <StopImportReview stop={stop} />
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <Button type="button" variant="outline" className="w-fit" onClick={onStartAnother}>
          {JOURNEY_COPY.startAnotherLabel}
        </Button>
        <p className="type-supporting text-pretty">{JOURNEY_COPY.startAnotherStatement}</p>
      </div>
    </div>
  );
}
