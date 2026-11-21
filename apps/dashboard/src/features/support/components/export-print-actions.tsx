"use client";
/** The Support family's export and print controls: the whole-query CSV the service produces, handed to the browser as a download, and the browser's print of the same result (AAP 0.10.1 family 8; AAP … */
import { InfoIcon } from "lucide-react";
import { useCallback, useId, type ReactElement } from "react";
import { refusalSummary } from "@/components/form-field";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { sameScope, type Coverage, type Scope } from "@/modules/data-service/envelope";
import type { ReportQuery } from "@/modules/support/report";
import type { SupportBasis } from "@/modules/support/basis";
import { useExport, type ExportEnvelope } from "../hooks/use-export";
import SnapshotStatement from "./snapshot-statement";
// Props
/** Props of {@link ExportPrintActions}. */
export type ExportPrintActionsProps = {
  readonly scope: Scope;
  readonly query: ReportQuery;
  readonly snapshotId: string;
  readonly snapshot: {
    readonly basis: SupportBasis;
    readonly currencies: readonly string[];
    readonly period: { readonly from: string; readonly to: string } | null;
    readonly coverage: Coverage;
    readonly asOf: string;
    readonly isCurrentPeriod: boolean;
    /** The service's whole-result count: the rows the file holds, never the loaded page's count. */
    readonly rowTotal: number;
  };
  readonly locale: string;
  readonly dir?: "ltr" | "rtl";
  /** The envelope's advisory export action. A `false` value renders the reason instead of the control. */
  readonly canExport: boolean;
  readonly className?: string;
};
// Wording
const HEADING = "Export and print";
const LEAD = "This result leaves the application in two ways: as one CSV file of the whole query, and as the " + "browser's print of the same result. Both come from the result this page already shows, and " + "neither writes a record.";
const ROWS_STATEMENT = " — the whole query rather than the page on screen, so the file is complete rather than a window of the result.";
const FILE_FACTS_STATEMENT = "The file states the grain, basis, currency, period, coverage and snapshot time above in its own " + "metadata records, so it can be checked without this screen.";
const EXPORT_BUSY_SENTENCE = "Preparing the file — the export is reading this query again, and no file has been saved yet.";
const PRINT_LABEL = "Print this report";
const PRINT_NOTE = "Printing uses the same result this page shows, so the sheet states the same grain, basis, " + "currency, period, coverage and snapshot time. It saves no file.";
const RETRY_LABEL = "Run the export again";
const EXPORT_UNAVAILABLE_TITLE = "No export is offered for this result";
const EXPORT_UNAVAILABLE_BODY = "The envelope that supplied this result offered no export in the current scope, so no control is " + "shown that could only fail. Nothing a download would have held is put in its place, and printing " + "the same result is still available.";
const PRODUCED_STATEMENT = "The file was produced from this query and handed to your browser to save. Its bytes are the service's own text, unedited.";
const FILENAME_LABEL = "Saved as";
const ROWS_LABEL = "Rows in the file";
const AS_OF_LABEL = "Read as of";
const PRODUCED_COMPLETENESS = "Every authorised row of the query is in the file, not only the page on screen, and a value that is " + "not a number — zero, unknown, withheld, unavailable or an incomplete subtotal — is written with " + "its own word rather than blanked or guessed.";
const PRODUCED_NO_EFFECT = "Nothing else happened: an export reads the result and writes no record, sends no notice and creates no task, so there is nothing to undo.";
const ELSEWHERE_STATEMENT = "The export answered with a result read under a different authority from the one this page states, " + "so the file was not handed to your browser: a result read in another context is discarded here " + "rather than saved.";
const ELSEWHERE_RECOVERY = "Running the export again reads this query afresh in the authority this page states.";
const DENIED_TITLE = "No file was produced";
const DENIED_DESCRIPTION = "The export was refused before any CSV was written, so there is no empty file, no header-only file " + "and no count from this attempt. Nothing on this surface says what the file would have held, and " + "printing the same result is still available.";
const REFUSED_TITLE = "No file was produced";
const UNAVAILABLE_TITLE = "No file was produced";
const UNAVAILABLE_DESCRIPTION = "The source behind this export could not be read, so no file was written and no row count stands " + "in its place. Repeating the export repeats this read and nothing else, because an export writes " + "no record.";
const TRANSPORT_TITLE = "No file was produced";
const TRANSPORT_DESCRIPTION = "The export request did not complete, so no file was saved. Nothing was changed either way, " + "because an export writes no record; running it again repeats the read and nothing else.";
// Presentation
const COUNT_CLASS = "tabular-figures font-medium text-foreground";
const FILENAME_CLASS = "mono-identifier wrap-anywhere";
const FACT_LABEL_CLASS = "text-muted-foreground";
const FACT_VALUE_CLASS = "min-w-0 wrap-anywhere";
/** The role a receipt and the busy line carry: polite, so it is announced when there is a pause rather than interrupting what the person is reading. */
const STATUS_ROLE = "status" as const;
const OBJECT_URL_LIFETIME_MS = 1_000;
// Presentation helpers
function countText(count: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(count);
  } catch {
    // A locale tag the runtime does not recognise states the number rather than failing the receipt.
    return String(count);
  }
}
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
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, OBJECT_URL_LIFETIME_MS);
}
// The receipt of one export attempt
type FileReceiptProps = { readonly kind: "produced"; readonly envelope: ExportEnvelope; readonly locale: string } | { readonly kind: "elsewhere"; readonly onReexport: () => void };

function FileReceipt(props: FileReceiptProps): ReactElement {
  const titleId = useId();
  return (
    <Card data-slot="export-receipt" data-receipt={props.kind} className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h3 id={titleId}>{props.kind === "produced" ? "File produced" : "The file was not saved"}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3 text-sm">
        <div role={STATUS_ROLE} aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2">
          {props.kind === "produced" ? (
            <>
              <p className="text-pretty">{PRODUCED_STATEMENT}</p>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
                <dt className={FACT_LABEL_CLASS}>{FILENAME_LABEL}</dt>
                <dd className={FACT_VALUE_CLASS}>
                  <bdi className={FILENAME_CLASS}>{props.envelope.data.filename}</bdi>
                </dd>
                <dt className={FACT_LABEL_CLASS}>{ROWS_LABEL}</dt>
                <dd className={FACT_VALUE_CLASS}>
                  <bdi className={COUNT_CLASS}>{countText(props.envelope.data.rowCount, props.locale)}</bdi>
                </dd>
                <dt className={FACT_LABEL_CLASS}>{AS_OF_LABEL}</dt>
                <dd className={FACT_VALUE_CLASS}>
                  <bdi>{props.envelope.asOf}</bdi>
                </dd>
              </dl>
              <p className="text-pretty">{PRODUCED_COMPLETENESS}</p>
              <p className="text-pretty">{PRODUCED_NO_EFFECT}</p>
            </>
          ) : (
            <>
              <p className="text-pretty">{ELSEWHERE_STATEMENT}</p>
              <p className="text-pretty">{ELSEWHERE_RECOVERY}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal" onClick={props.onReexport}>
                  {RETRY_LABEL}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
// The surface
/** The export and print controls of one report result. */
export function ExportPrintActions({ scope, query, snapshotId, snapshot, locale, dir, canExport, className }: ExportPrintActionsProps): ReactElement {
  const { mutateAsync, isPending, data, error } = useExport();
  const titleId = useId();
  const fileStatementId = useId();
  const runExport = useCallback(async (): Promise<void> => {
    const answer = await mutateAsync({ query, snapshotId }).catch(() => null);
    if (answer === null || answer.kind !== "envelope" || !sameScope(answer.envelope.scope, scope)) return;
    saveFile(answer.envelope.data.csv, answer.envelope.data.filename);
  }, [mutateAsync, query, snapshotId, scope]);

  /** The print region is rendered from the same result elsewhere on the page; this control only asks the browser to print, and states nothing about what happened to the sheet afterwards. */
  const printReport = useCallback((): void => {
    window.print();
  }, []);

  const answer = data ?? null;
  const produced = answer !== null && answer.kind === "envelope" && sameScope(answer.envelope.scope, scope) ? answer.envelope : null;
  const elsewhere = answer !== null && answer.kind === "envelope" && produced === null;
  return (
    <section aria-labelledby={titleId} aria-busy={isPending ? true : undefined} data-slot="export-print-actions" dir={dir} className={cn("flex min-w-0 flex-col gap-4 print:hidden", className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>{HEADING}</h2>
          </CardTitle>
          <CardDescription>{LEAD}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {/* The one statement of the snapshot this result, its file and its printed sheet share. */}
          <SnapshotStatement basis={snapshot.basis} currencies={snapshot.currencies} period={snapshot.period} coverage={snapshot.coverage} asOf={snapshot.asOf} isCurrentPeriod={snapshot.isCurrentPeriod} locale={locale} />
          {canExport ? (
            <div id={fileStatementId} className="flex min-w-0 flex-col gap-1 text-sm">
              <p className="min-w-0 text-pretty">
                <span className="font-medium">{ROWS_LABEL}</span> <bdi className={COUNT_CLASS}>{countText(snapshot.rowTotal, locale)}</bdi>
                {ROWS_STATEMENT}
              </p>
              <p className="min-w-0 text-pretty text-muted-foreground">{FILE_FACTS_STATEMENT}</p>
            </div>
          ) : (
            <Alert>
              <InfoIcon aria-hidden="true" />
              <AlertTitle>{EXPORT_UNAVAILABLE_TITLE}</AlertTitle>
              <AlertDescription>{EXPORT_UNAVAILABLE_BODY}</AlertDescription>
            </Alert>
          )}
          <Separator />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {canExport ? (
              <Button
                type="button"
                disabled={isPending}
                aria-describedby={fileStatementId}
                onClick={() => {
                  void runExport();
                }}
              >
                {isPending ? <Spinner /> : null}
                {isPending ? "Preparing the file…" : "Export the whole query as CSV"}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={printReport}>
              {PRINT_LABEL}
            </Button>
          </div>
          <p className="min-w-0 text-sm text-pretty text-muted-foreground">{PRINT_NOTE}</p>
          {/* A live region that exists before the work starts, so the busy condition is announced as
              text rather than shown by the spinner alone. */}
          <p role={STATUS_ROLE} className={cn("min-w-0 text-sm text-pretty", isPending ? "flex items-center gap-2 font-medium" : "sr-only")}>
            {isPending ? (
              <>
                <Spinner />
                <span>{EXPORT_BUSY_SENTENCE}</span>
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>
      {produced === null ? null : <FileReceipt kind="produced" envelope={produced} locale={locale} />}
      {elsewhere ? (
        <FileReceipt
          kind="elsewhere"
          onReexport={() => {
            void runExport();
          }}
        />
      ) : null}
      {answer !== null && answer.kind === "denied" ? <StateNotice kind="denied" title={DENIED_TITLE} description={DENIED_DESCRIPTION} reasonCode={answer.denied.reasonCode} headingLevel={3} /> : null}
      {answer !== null && answer.kind === "unavailable" ? <StateNotice kind="unavailable" title={UNAVAILABLE_TITLE} description={UNAVAILABLE_DESCRIPTION} source={answer.unavailable.source} retry={{ label: RETRY_LABEL, onClick: runExport }} headingLevel={3} /> : null}
      {answer !== null && answer.kind === "refused" ? (
        // The query this export stated is not one the read admits: the refusal names the field to
        // correct, and no file was produced because none could be asked for.
        <StateNotice kind="refused" title={REFUSED_TITLE} description={refusalSummary(answer.refused)} headingLevel={3} />
      ) : null}
      {error === null ? null : <StateNotice kind="unavailable" title={TRANSPORT_TITLE} description={TRANSPORT_DESCRIPTION} retry={{ label: RETRY_LABEL, onClick: runExport }} headingLevel={3} />}
    </section>
  );
}
export default ExportPrintActions;
