"use client";
import { InfoIcon } from "lucide-react";
import { Fragment, useCallback, useId, type ReactElement } from "react";
import { refusalSummary } from "@/components/form-field";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import SectionCard from "@/components/section-card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { countTextOf } from "@/lib/count-format";
import { sameScope, type Coverage, type Scope } from "@/modules/data-service/envelope";
import type { ReportQuery } from "@/modules/support/report";
import type { SupportBasis } from "@/modules/support/basis";
import { useExport, type ExportEnvelope } from "../hooks/use-export";
import SnapshotStatement from "./snapshot-statement";
export type WholeQueryPrintControls = {
  readonly shownRows: number;
  readonly maxRows: number;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onPrintWholeQuery: () => void;
};
export type ExportPrintActionsProps = {
  readonly scope: Scope;
  readonly query: ReportQuery;
  readonly snapshotId: string;
  readonly snapshot: { readonly basis: SupportBasis; readonly currencies: readonly string[]; readonly period: { readonly from: string; readonly to: string } | null; readonly coverage: Coverage; readonly asOf: string; readonly isCurrentPeriod: boolean; readonly rowTotal: number };
  readonly locale: string;
  readonly dir?: "ltr" | "rtl";
  readonly canExport: boolean;
  readonly wholeQueryPrint?: WholeQueryPrintControls;
  readonly className?: string;
};
const LEAD = "Download all matching rows as a CSV file, or print this report directly from your browser. Neither changes your records.";
const ROWS_LABEL = "Rows included";
const RETRY_LABEL = "Try export again";
const DENIED_DESCRIPTION = "Your current session doesn’t have permission to export CSV files here. Printing this report is still available.";
const UNAVAILABLE_DESCRIPTION = "Couldn’t reach the giving source to build the CSV. No file was downloaded — try again in a moment.";
const TRANSPORT_DESCRIPTION = "The export request didn’t complete, so no file was downloaded. Try again in a moment.";
const COUNT_CLASS = "tabular-figures font-medium text-foreground";
const STATUS_ROLE = "status" as const;
function saveFile(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
function FileReceipt(props: { readonly kind: "produced"; readonly envelope: ExportEnvelope; readonly locale: string } | { readonly kind: "elsewhere"; readonly onReexport: () => void }): ReactElement {
  const titleId = useId();
  return (
    <SectionCard title={props.kind === "produced" ? "CSV downloaded" : "Export skipped"} headingLevel={3} headingId={titleId} cardClassName="min-w-0" dataSlot="export-receipt" cardData={{ "data-receipt": props.kind }} contentClassName="flex min-w-0 flex-col gap-3 text-sm">
      <div role={STATUS_ROLE} aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2">
        {props.kind === "produced" ? (
          <>
            <p className="text-pretty">{"Your CSV file was generated from all matching rows and sent to your browser."}</p>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
              {[
                { label: "File name", value: <bdi className="mono-identifier wrap-anywhere">{props.envelope.data.filename}</bdi> },
                { label: ROWS_LABEL, value: <bdi className={COUNT_CLASS}>{countTextOf(props.envelope.data.rowCount, props.locale)}</bdi> },
                { label: "Snapshot time", value: <bdi>{props.envelope.asOf}</bdi> },
              ].map((fact) => (
                <Fragment key={fact.label}>
                  <dt className="text-muted-foreground">{fact.label}</dt>
                  <dd className="min-w-0 wrap-anywhere">{fact.value}</dd>
                </Fragment>
              ))}
            </dl>
            <p className="text-pretty">{"Includes every matching row across all pages. Non-numeric states (unknown, withheld, unavailable, or incomplete) are clearly labelled."}</p>
          </>
        ) : (
          <>
            <p className="text-pretty">{"Your ministry context changed while exporting, so this file wasn’t saved. Run the export again for your current context."}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button {...{ type: "button", variant: "outline", size: "sm", className: BUTTON_WRAP_CLASS, onClick: props.onReexport }}>{RETRY_LABEL}</Button>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}
/** The export and print controls of one report result: one control for the whole-query file, one for the browser's print, and the receipt or the reason of the attempt that was made. */
export function ExportPrintActions({ scope, query, snapshotId, snapshot, locale, dir, canExport, wholeQueryPrint, className }: ExportPrintActionsProps): ReactElement {
  const { mutateAsync, isPending, data, error } = useExport();
  const titleId = useId();
  const fileStatementId = useId();
  const runExport = useCallback(async (): Promise<void> => {
    const answer = await mutateAsync({ query, snapshotId }).catch(() => null);
    if (answer === null || answer.kind !== "envelope" || !sameScope(answer.envelope.scope, scope)) return;
    saveFile(answer.envelope.data.csv, answer.envelope.data.filename);
  }, [mutateAsync, query, snapshotId, scope]);
  const printReport = useCallback((): void => window.print(), []);
  const answer = data ?? null;
  const produced = answer !== null && answer.kind === "envelope" && sameScope(answer.envelope.scope, scope) ? answer.envelope : null;
  const elsewhere = answer !== null && answer.kind === "envelope" && produced === null;
  const retry = { label: RETRY_LABEL, onClick: runExport };
  const outcome =
    answer === null ? null : answer.kind === "denied" ? (
      <StateNotice kind="denied" title="CSV export unavailable" description={DENIED_DESCRIPTION} reasonCode={answer.denied.reasonCode} headingLevel={3} />
    ) : answer.kind === "unavailable" ? (
      <StateNotice kind="unavailable" title="Couldn’t create CSV" description={UNAVAILABLE_DESCRIPTION} source={answer.unavailable.source} retry={retry} headingLevel={3} />
    ) : answer.kind === "refused" ? (
      <StateNotice kind="refused" title="Couldn’t create CSV" description={refusalSummary(answer.refused)} headingLevel={3} />
    ) : null;
  return (
    <section aria-labelledby={titleId} aria-busy={isPending ? true : undefined} data-slot="export-print-actions" dir={dir} className={cn("flex min-w-0 flex-col gap-4 print:hidden", className)}>
      <SectionCard title="Export & print" headingId={titleId} description={LEAD} cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-4">
        <SnapshotStatement basis={snapshot.basis} currencies={snapshot.currencies} period={snapshot.period} coverage={snapshot.coverage} asOf={snapshot.asOf} isCurrentPeriod={snapshot.isCurrentPeriod} locale={locale} />
        {canExport ? (
          <div id={fileStatementId} className="flex min-w-0 flex-col gap-1 text-sm">
            <p className="min-w-0 text-pretty">
              <span className="font-medium">{ROWS_LABEL}:</span> <bdi className={COUNT_CLASS}>{countTextOf(snapshot.rowTotal, locale)}</bdi>
              {" (all matching rows across every page)."}
            </p>
            <p className="min-w-0 text-pretty text-muted-foreground">The CSV includes basis, currency, period, coverage, and snapshot metadata in its header rows.</p>
          </div>
        ) : (
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertTitle>CSV export isn’t available in this context</AlertTitle>
            <AlertDescription>{"Your current session doesn’t include CSV export permission here. You can still print this report."}</AlertDescription>
          </Alert>
        )}
        <Separator />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {canExport ? (
            <Button type="button" disabled={isPending} aria-describedby={fileStatementId} onClick={() => void runExport()}>
              {isPending ? <Spinner /> : null}
              {isPending ? "Preparing CSV…" : "Export CSV"}
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={wholeQueryPrint?.pending} onClick={printReport}>Print report</Button>
          {wholeQueryPrint !== undefined && wholeQueryPrint.shownRows < snapshot.rowTotal && snapshot.rowTotal <= wholeQueryPrint.maxRows ? (
            <Button type="button" variant="outline" disabled={wholeQueryPrint.pending} onClick={wholeQueryPrint.onPrintWholeQuery}>
              {wholeQueryPrint.pending ? <Spinner /> : null}
              {wholeQueryPrint.pending ? "Preparing full-query print…" : `Print all ${countTextOf(snapshot.rowTotal, locale)} rows`}
            </Button>
          ) : null}
        </div>
        <p className="min-w-0 text-sm text-pretty text-muted-foreground">
          {wholeQueryPrint !== undefined && wholeQueryPrint.shownRows < snapshot.rowTotal && snapshot.rowTotal > wholeQueryPrint.maxRows
            ? `Print report prints the current page (${countTextOf(wholeQueryPrint.shownRows, locale)} of ${countTextOf(snapshot.rowTotal, locale)} rows). The browser can print up to ${countTextOf(wholeQueryPrint.maxRows, locale)} rows at once.${canExport ? " Use Export CSV for all matching rows." : ""}`
            : "Printing uses the exact snapshot shown on screen and includes basis, coverage, and timestamp details."}
        </p>
        {wholeQueryPrint === undefined || wholeQueryPrint.error === null ? null : (
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertTitle>Couldn’t prepare whole-query print</AlertTitle>
            <AlertDescription>{wholeQueryPrint.error}</AlertDescription>
          </Alert>
        )}
        <p role={STATUS_ROLE} className={cn("min-w-0 text-sm text-pretty", isPending ? "flex items-center gap-2 font-medium" : "sr-only")}>
          {isPending ? (
            <>
              <Spinner />
              <span>{"Preparing CSV download…"}</span>
            </>
          ) : null}
        </p>
      </SectionCard>
      {produced === null ? null : <FileReceipt kind="produced" envelope={produced} locale={locale} />}
      {elsewhere ? <FileReceipt kind="elsewhere" onReexport={() => void runExport()} /> : null}
      {outcome}
      {error === null ? null : <StateNotice kind="unavailable" title="Couldn’t create CSV" description={TRANSPORT_DESCRIPTION} retry={retry} headingLevel={3} />}
    </section>
  );
}
export default ExportPrintActions;
