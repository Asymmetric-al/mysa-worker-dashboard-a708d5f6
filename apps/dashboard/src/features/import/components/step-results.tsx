"use client";
/**
 * Contact import, step five — Results: what became of every row of one completed import, read back by
 * the operation's own identity.
 *
 * **What this step shows and what it never claims.** Every row states its decision, the result the
 * service recorded for it, the service's own reason in its own words, and where it leads: a row that
 * became or extended a contact names that contact's destination, and a row that was not applied states
 * that it was not applied and why, without offering a control that would apply it now. A processed
 * import's decisions cannot be changed, so this step offers no way to change one — only the stop control
 * for the rows nothing has been applied to yet, which is the shared review step over the cancellation
 * transport.
 *
 * **What a row's route is.** The service states where each row leads, and every descriptor it states becomes
 * a control here: a row that became or extended a contact opens that contact, and a row it did not apply
 * returns to the review step at that row, because the service keeps inviting the worker to decide or correct
 * it. The correction is a button rather than a link for a reason: the review step's window, the mapping and
 * every decision recorded so far live in the journey, so leaving the journey by navigation would lose the
 * work this route is meant to take the worker back to. A page that was reloaded holds no journey at all —
 * the chosen file is not kept across a reload — so it states that instead of offering a control it could
 * not honour.
 *
 * **Where the counts come from.** The per-decision counts and the count of rows left alone are the read's
 * own summary; the per-state counts are stated only when the read states them, and a read that states none
 * shows none rather than a table of zeros.
 *
 * **Nothing here is accepted before the service says so.** The rows are the receipt of an operation that
 * already ran; this file starts no change of its own, and every outcome it can show — including a
 * cancellation — is the shared operation receipt rather than a message this family wrote.
 *
 * **Why the identity and its address are stated here.** This step's own lead says the result is read back by
 * its identity, so the identity is rendered rather than left to the address bar: a worker whose
 * acknowledgement was lost needs a receipt they can keep. The copy control only accelerates that — the
 * address it copies is printed beside it and stays selectable, so a browser that refuses the clipboard
 * loses nothing.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { PaginationBar } from "@/components/pagination-bar";
import { ScrollRegion } from "@/components/scroll-region";
import SimulationLabel from "@/components/simulation-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportRowState } from "@/modules/data-service/envelope";
import type { ImportProposalRowRoute, ImportRowWindow } from "@/modules/data-service/reads/import";
import type { RowResultCopyEntry } from "../copy";
import { IMPORT_SIMULATION_EFFECT, JOURNEY_COPY, RESULTS_COPY, RESULT_STATE_HEADINGS, ROW_RESULT_COPY, TABLE_LABELS, chosenFileSize, importReceiptHref, resultCorrectionStatement, resultPartnerLinkLabel, resultStoppableRowSentence, resultWindowSentence, reviewDecisionLabel } from "../copy";
import { IMPORT_ROW_RESULT_STATES } from "@/modules/import/receipt";
import { StopImportReview, type ImportStopControl } from "./step-review";
/** The destination of one row that became or extended a contact. */
const PARTNER_HREF_PREFIX = "/partners/";

/** One row of a completed import, in the words the read reported: what was decided, what became of it, why, and where it leads. */
export interface ImportResultsRow {
  readonly rowNumber: number;
  readonly decisionLabel: string;
  readonly state: ImportRowState | null;
  readonly stateLabel: string | null;
  readonly reason: string | null;
  readonly route: ImportProposalRowRoute | null;
}
/**
 * One completed import, in the one shape a completed proposal and a receipt both project onto: the file it
 * read, the counts acceptance decided, the count of rows it left alone, and the window of rows it returned.
 */
export interface ImportResultsView {
  readonly importOperationId: string;
  readonly file: { readonly name: string; readonly bytes: number; readonly rowCount: number; readonly columnCount: number };
  readonly summary: { readonly create: number; readonly reuse: number; readonly skip: number; readonly unresolved: number; readonly rowCount: number };
  /** The rows the read returned for this window. */
  readonly rows: readonly ImportResultsRow[];
  readonly rowWindow: ImportRowWindow;
  /** How many rows the read states it left alone and can still be stopped. */
  readonly stoppableRows: number;
  /** How many rows ended in each result state, when the read states it; `null` when it states no such count. */
  readonly stateCounts: Readonly<Record<ImportRowState, number>> | null;
}
/** Props of {@link StepResults}. */
export interface StepResultsProps {
  readonly results: ImportResultsView;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  /** The stop control for the rows nothing has been applied to yet, composed from the cancellation transport. */
  readonly stop: ImportStopControl;
  /** Clears this import from the page and returns the journey to its first step. */
  readonly onStartAnother: () => void;
  /**
   * Returns the journey to the review step at the row this import did not apply, so the worker can decide or
   * correct it with the mapping and every decision recorded so far still in hand. Omitted by a journey that
   * holds no file — a reloaded page — where the row can be stated but not reopened.
   */
  readonly onCorrection?: ((rowNumber: number) => void) | undefined;
  /** Whether the results were recovered from this page's own address rather than reached by accepting here. */
  readonly recovered: boolean;
}
/** The result vocabulary a state's words are read from, or `null` when the state names none of the five. */
function rowResultCopyOf(state: ImportRowState | null): RowResultCopyEntry | null {
  if (state === null) {
    return null;
  }
  return Object.hasOwn(ROW_RESULT_COPY, state) ? ROW_RESULT_COPY[state] : null;
}
function FactRow({ label, value, mono = false }: { readonly label: string; readonly value: string; readonly mono?: boolean }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-1">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 wrap-anywhere">
        <bdi className={mono === true ? "font-mono" : undefined}>{value}</bdi>
      </dd>
    </div>
  );
}
/**
 * Where one row leads, as the control that takes the worker there.
 *
 * Both descriptors the service states become real controls. A partner route is a link, because the contact is
 * a destination of its own and nothing in this journey is needed to read it. A correction route is a button,
 * because the review step is a step of this journey rather than a destination: it must be reopened where the
 * chosen file, the confirmed mapping and every recorded decision still live, and leaving by navigation would
 * discard exactly the work the route exists to take the worker back to.
 */
function RowRoute({ row, onCorrection }: { readonly row: ImportResultsRow; readonly onCorrection?: ((rowNumber: number) => void) | undefined }): ReactElement {
  const route = row.route;
  if (route === null) {
    return <span className="text-muted-foreground">{RESULTS_COPY.noRoute}</span>;
  }
  if (route.kind === "partner") {
    return (
      <Link className="inline-flex min-h-6 items-center underline underline-offset-4" href={`${PARTNER_HREF_PREFIX}${encodeURIComponent(route.partnerId)}`}>
        {resultPartnerLinkLabel(row.rowNumber)}
      </Link>
    );
  }
  if (onCorrection === undefined) {
    // A reloaded page holds no chosen file, so the row it did not apply can be stated here but not reopened.
    return <span className="text-muted-foreground">{resultCorrectionStatement(route.rowNumber)}</span>;
  }
  return (
    <Button type="button" variant="outline" size="sm" className="h-auto min-h-6 whitespace-normal text-start" onClick={() => onCorrection(route.rowNumber)}>
      {reviewDecisionLabel(route.rowNumber)}
    </Button>
  );
}
/** Step five of the contact import: the per-row result of one completed operation, its counts and its routes. */
export default function StepResults({ results, onPageChange, onPageSizeChange, stop, onStartAnother, onCorrection, recovered }: StepResultsProps): ReactElement {
  const stateCounts = results.stateCounts;
  // The receipt is where an operation is actually read, so arriving at it — by accepting, by resolving a lost
  // acknowledgement through the same operation, or by reopening the step — puts the keyboard on its first row
  // instead of leaving focus on a control the step change has just removed from the page. It is placed once per
  // operation, so a page change or an unrelated re-render never pulls focus out of what the worker is reading.
  const firstRowHeader = useRef<HTMLTableCellElement | null>(null);
  const focusedOperation = useRef<string | null>(null);
  useEffect(() => {
    if (focusedOperation.current === results.importOperationId) {
      return;
    }
    const target = firstRowHeader.current;
    if (target === null) {
      return;
    }
    focusedOperation.current = results.importOperationId;
    target.focus();
  }, [results.importOperationId]);
  // The one receipt address this step states, built from the operation it shows: the link, the printed address and
  // the copy control all read this value, so none of them can end up naming a different operation.
  const receiptHref = importReceiptHref(results.importOperationId);
  // The answer names the operation it was given for, so an import started after this one never inherits its
  // announcement: the live region only ever states what the copy control did for the identity on screen.
  const [receiptCopy, setReceiptCopy] = useState<{ readonly operationId: string; readonly result: "copied" | "unavailable" } | null>(null);
  const receiptAnnouncement = receiptCopy === null || receiptCopy.operationId !== results.importOperationId ? "" : receiptCopy.result === "copied" ? RESULTS_COPY.copyReceiptCopied : RESULTS_COPY.copyReceiptUnavailable;
  /**
   * Copies the receipt address. The clipboard may be absent, or may refuse the write — a permission, or a document
   * that does not hold focus — so both answers are announced beside the address rather than thrown: the address is
   * printed above the control, and the control only saves the work of selecting it.
   */
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
      <p className="text-sm text-pretty text-muted-foreground">{RESULTS_COPY.lead}</p>
      {recovered ? (
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="font-medium">{JOURNEY_COPY.reload.completedHeading}</p>
          <p className="text-pretty text-muted-foreground">{JOURNEY_COPY.reload.completedStatement}</p>
        </div>
      ) : null}
      {/* The importer's simulated boundary is stated on its result as well as beside the file control. */}
      <SimulationLabel effect={IMPORT_SIMULATION_EFFECT} context="block" />
      {/* The identity and its address come before the counts: recovering a lost acknowledgement is what this step is
       * for, and that recovery starts from the one identity the result was read back by. */}
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <p className="font-medium">{RESULTS_COPY.operationHeading}</p>
        <dl className="flex min-w-0 flex-col gap-1">
          <FactRow label={RESULTS_COPY.operationLabels.identity} value={results.importOperationId} mono />
          <FactRow label={RESULTS_COPY.operationLabels.receiptAddress} value={receiptHref} mono />
        </dl>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Link className="inline-flex min-h-6 items-center underline underline-offset-4" href={receiptHref}>
            {RESULTS_COPY.receiptLinkLabel}
          </Link>
          <Button type="button" variant="outline" size="sm" className="h-auto min-h-6" onClick={copyReceiptAddress}>
            {RESULTS_COPY.copyReceiptLabel}
          </Button>
        </div>
        <p className="text-pretty text-muted-foreground">{RESULTS_COPY.receiptNote}</p>
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
      <p className="text-sm text-pretty text-muted-foreground">{resultWindowSentence(results.rowWindow)}</p>
      {/* One scroll port for this one table, exactly as the review step has: the region carries the
       * accessible name and the table scrolls inside it rather than the page scrolling sideways. */}
      <ScrollRegion label={TABLE_LABELS.results}>
        <Table>
          <TableCaption className="sr-only">{TABLE_LABELS.results}</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">{RESULTS_COPY.column.row}</TableHead>
              <TableHead scope="col">{RESULTS_COPY.column.decision}</TableHead>
              <TableHead scope="col">{RESULTS_COPY.column.state}</TableHead>
              <TableHead scope="col">{RESULTS_COPY.column.reason}</TableHead>
              <TableHead scope="col">{RESULTS_COPY.column.route}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.rows.map((row, rowIndex) => {
              const result = rowResultCopyOf(row.state);
              return (
                <TableRow key={row.rowNumber}>
                  <TableHead
                    scope="row"
                    tabIndex={rowIndex === 0 ? -1 : undefined}
                    ref={
                      rowIndex === 0
                        ? (node) => {
                            firstRowHeader.current = node;
                          }
                        : undefined
                    }
                    className="whitespace-normal align-top focus:outline-2 focus:outline-offset-2 focus:outline-[color:var(--ring)]"
                  >
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
          </TableBody>
        </Table>
      </ScrollRegion>
      <PaginationBar total={results.rowWindow.total} page={results.rowWindow.page} pageSize={results.rowWindow.pageSize} itemNoun="rows" onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
      {results.stoppableRows <= 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm text-pretty text-muted-foreground">{resultStoppableRowSentence(results.stoppableRows)}</p>
          <StopImportReview stop={stop} />
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <Button type="button" variant="outline" className="w-fit" onClick={onStartAnother}>
          {JOURNEY_COPY.startAnotherLabel}
        </Button>
        <p className="text-sm text-pretty text-muted-foreground">{JOURNEY_COPY.startAnotherStatement}</p>
      </div>
    </div>
  );
}
