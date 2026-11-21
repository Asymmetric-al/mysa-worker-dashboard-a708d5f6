"use client";
/**
 * The Support family's export and print controls: the whole-query CSV the service produces, handed to
 * the browser as a download, and the browser's print of the same result (AAP 0.10.1 family 8;
 * AAP 0.8.8; criterion 1).
 *
 * **What this file owns.** Two controls and their honest reporting, nothing more: no format chooser,
 * no workbook or PDF path, no saved or scheduled export, no column picker (Rule 1 clause 1). Before
 * either control is used, the panel states what the file will contain — the grain and basis, the
 * currency partition, the period, the coverage state, the snapshot time, and that the file holds the
 * whole query rather than the loaded page.
 *
 * **Why no CSV is built here.** The file is produced by the service: `useExport` → `reads.readExport`
 * → `modules/export/csv.ts`, which owns the quoting, the formula neutralisation and the metadata
 * records. This file states what will be produced, asks for it with the exact query and snapshot
 * identity the report rendered, and hands the returned string to the browser unchanged — the same
 * bytes, never re-quoted, re-joined or trimmed. Assembling CSV text here would be a second writer
 * that could disagree with the file the service states (Rule 1 clause 2).
 *
 * **Why the shared review step is not used.** `components/action-review` reviews a *change*: it mints
 * an attempt identity the service can replay, presents an `expectedRevision`, offers conflict and
 * replay recovery, and reports through `OperationResult`, whose sentences assert the change that was
 * applied and the revision the record now stands at. An export performs no state change (AAP 0.7.1),
 * so that receipt would state a change the export never made, which is exactly the confusion between
 * outcomes Rule 1 clause 3 forbids. The disclosure a review would give is the panel below, which
 * states what the file will contain before the control is pressed, so no confirmation step is added
 * that would only restate it.
 *
 * **The download path.** `Blob` of type `text/csv;charset=utf-8` over the service's string → an
 * object URL → a hidden `<a download>` carrying the filename the service chose → a click → the
 * object URL released after the browser has had its chance to read the blob. The filename is the
 * service's, so no record content and no user data is derived here.
 *
 * **The refusal path.** A refused export produces *no file at all*: not an empty one, not a
 * header-only one, and no count from the attempt. A `denied` answer renders the closed reason code, an
 * `unavailable` answer renders the source identity, and a request that never completed says so — each
 * through `StateNotice`, the one surface for a state that is not a result. An export writes nothing,
 * so re-running it repeats a read and no effect (AAP 0.7.1), which is what the retry states.
 *
 * **Print.** The second control calls `window.print()`. The printable region is the one
 * `report-frame` renders through `print-report` from the same `ReportResult`, so the sheet states the
 * same figures, grain, coverage and as-of instant as the screen. This control produces no file and
 * makes no claim about delivery.
 *
 * **Capability.** `canExport` is the envelope's advisory action, so a `false` value renders the reason
 * in place of the export control rather than a button that could only fail; the service re-checks on
 * submit if a stale envelope offered one. Printing stays available either way.
 *
 * **Accessibility and direction.** The panel is a named region with a real `h2`, both controls are at
 * least 24×24 CSS px with visible text and the token layer's `:focus-visible` ring (WCAG 2.5.8), the
 * busy condition is stated as text in a live region rather than by colour or a spinner alone, counts
 * and filenames render inside `<bdi>` so a mixed-direction page keeps them intact, and the whole
 * region is hidden from print so the sheet carries the report rather than its controls. Every colour,
 * space and radius resolves to a token in `styles/globals.css`; no physical side property is used, so
 * an RTL page mirrors the panel without a second style.
 *
 * **Layering.** `features/support → components → components/ui`. It imports no store, no `runReport`,
 * no export writer and no second transport: the one call to `/api/export` is `../hooks/use-export`.
 */
import { InfoIcon } from "lucide-react";
import { useCallback, useId, type ReactElement } from "react";
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
  /** The authority the result on screen was read under, used to check that the export answered in it. */
  readonly scope: Scope;
  /** The exact query the report rendered, passed to the export untouched so the file is that query. */
  readonly query: ReportQuery;
  /** The snapshot identity of that query, so the export states the same snapshot the screen states. */
  readonly snapshotId: string;
  /** What the file will contain, stated before the control is pressed and taken from the result. */
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

const LEAD =
  "This result leaves the application in two ways: as one CSV file of the whole query, and as the " +
  "browser's print of the same result. Both come from the result this page already shows, and " +
  "neither writes a record.";

const ROWS_STATEMENT = " — the whole query rather than the page on screen, so the file is complete rather than a window of the result.";

const FILE_FACTS_STATEMENT = "The file states the grain, basis, currency, period, coverage and snapshot time above in its own " + "metadata records, so it can be checked without this screen.";

const EXPORT_LABEL = "Export the whole query as CSV";

const EXPORT_BUSY_LABEL = "Preparing the file…";

const EXPORT_BUSY_SENTENCE = "Preparing the file — the export is reading this query again, and no file has been saved yet.";

const PRINT_LABEL = "Print this report";

const PRINT_NOTE = "Printing uses the same result this page shows, so the sheet states the same grain, basis, " + "currency, period, coverage and snapshot time. It saves no file.";

const RETRY_LABEL = "Run the export again";

const EXPORT_UNAVAILABLE_TITLE = "No export is offered for this result";

const EXPORT_UNAVAILABLE_BODY =
  "The envelope that supplied this result offered no export in the current scope, so no control is " +
  "shown that could only fail. Nothing a download would have held is put in its place, and printing " +
  "the same result is still available.";

const PRODUCED_HEADING = "File produced";

const PRODUCED_STATEMENT = "The file was produced from this query and handed to your browser to save. Its bytes are the service's own text, unedited.";

const FILENAME_LABEL = "Saved as";

const ROWS_LABEL = "Rows in the file";

const AS_OF_LABEL = "Read as of";

const PRODUCED_COMPLETENESS =
  "Every authorised row of the query is in the file, not only the page on screen, and a value that is " +
  "not a number — zero, unknown, withheld, unavailable or an incomplete subtotal — is written with " +
  "its own word rather than blanked or guessed.";

const PRODUCED_NO_EFFECT = "Nothing else happened: an export reads the result and writes no record, sends no notice and creates no task, so there is nothing to undo.";

const ELSEWHERE_HEADING = "The file was not saved";

const ELSEWHERE_STATEMENT =
  "The export answered with a result read under a different authority from the one this page states, " +
  "so the file was not handed to your browser: a result read in another context is discarded here " +
  "rather than saved.";

const ELSEWHERE_RECOVERY = "Running the export again reads this query afresh in the authority this page states.";

const DENIED_TITLE = "No file was produced";

const DENIED_DESCRIPTION =
  "The export was refused before any CSV was written, so there is no empty file, no header-only file " +
  "and no count from this attempt. Nothing on this surface says what the file would have held, and " +
  "printing the same result is still available.";

const UNAVAILABLE_TITLE = "No file was produced";

const UNAVAILABLE_DESCRIPTION =
  "The source behind this export could not be read, so no file was written and no row count stands " +
  "in its place. Repeating the export repeats this read and nothing else, because an export writes " +
  "no record.";

const TRANSPORT_TITLE = "No file was produced";

const TRANSPORT_DESCRIPTION =
  "The export request did not complete, so no file was saved. Nothing was changed either way, " + "because an export writes no record; running it again repeats the read and nothing else.";
// Presentation
const COUNT_CLASS = "tabular-figures font-medium text-foreground";

const FILENAME_CLASS = "mono-identifier wrap-anywhere";

const FACT_LABEL_CLASS = "text-muted-foreground";

const FACT_VALUE_CLASS = "min-w-0 wrap-anywhere";

const REGION_CLASS = "flex min-w-0 flex-col gap-4 print:hidden";
/**
 * The role a receipt and the busy line carry: polite, so it is announced when there is a pause rather
 * than interrupting what the person is reading. It is a named constant because the receipt holds a
 * definition list and paragraphs, which `<output>` cannot carry, so the region keeps its own element
 * and states its role explicitly — the same way `components/operation-result` states its own.
 */
const STATUS_ROLE = "status" as const;

const CSV_MIME_TYPE = "text/csv;charset=utf-8";
/**
 * How long an object URL outlives its click.
 *
 * The browser reads the blob after the click's task returns, so releasing the URL inside that task
 * can leave an empty download behind. One second is far longer than that read needs and far shorter
 * than any session, and the URL is scoped to this document either way.
 */
const OBJECT_URL_LIFETIME_MS = 1_000;
// Presentation helpers
/**
 * Formats a count for reading without changing it.
 *
 * A whole-result count is `snapshot.rowTotal` or the file's own `rowCount`, rendered exactly as the
 * service reported it: grouping digits is presentation, and a value that is not a number is never
 * produced here.
 */
function countText(count: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(count);
  } catch {
    // A locale tag the runtime does not recognise states the number rather than failing the receipt.
    return String(count);
  }
}
/** Hands one CSV file to the browser under the filename the service chose, and leaves no URL behind. */
function saveFile(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: CSV_MIME_TYPE }));
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

/**
 * The durable record of what one export produced, or of the one answer it deliberately did not save.
 *
 * It is the only success receipt on this surface: `StateNotice` covers states that are not a result,
 * and `OperationResult` reports a change, which an export does not make. Every fact on it comes from
 * the answer the service gave — the filename it chose, the rows it counted and the instant it read at
 * — so the receipt cannot disagree with the file it describes.
 */
function FileReceipt(props: FileReceiptProps): ReactElement {
  const titleId = useId();
  return (
    <Card data-slot="export-receipt" data-receipt={props.kind} className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h3 id={titleId}>{props.kind === "produced" ? PRODUCED_HEADING : ELSEWHERE_HEADING}</h3>
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
/**
 * The export and print controls of one report result.
 *
 * States what the file will contain, produces it on request from the exact query and snapshot
 * identity the report rendered, and reports each answer in place: the file's own filename, row count
 * and as-of instant when one was produced, the closed reason when the export was refused, the source
 * when it was unavailable, and the fact that nothing was saved when the request never completed or
 * answered in another authority.
 */
export function ExportPrintActions({ scope, query, snapshotId, snapshot, locale, dir, canExport, className }: ExportPrintActionsProps): ReactElement {
  const { mutateAsync, isPending, data, error } = useExport();
  const titleId = useId();
  const fileStatementId = useId();
  /*
   * One export per press. The answer's own scope is checked before anything reaches the browser: a
   * result read in another authority is a result this page must not hand over, which is also why the
   * query is passed on untouched rather than rebuilt from the props here.
   */
  const runExport = useCallback(async (): Promise<void> => {
    const answer = await mutateAsync({ query, snapshotId }).catch(() => null);
    if (answer === null || answer.kind !== "envelope" || !sameScope(answer.envelope.scope, scope)) {
      return;
    }
    saveFile(answer.envelope.data.csv, answer.envelope.data.filename);
  }, [mutateAsync, query, snapshotId, scope]);

  /* The print region is rendered from the same result elsewhere on the page; this control only asks
   * the browser to print, and states nothing about what happened to the sheet afterwards. */
  const printReport = useCallback((): void => {
    window.print();
  }, []);

  const answer = data ?? null;
  const produced = answer !== null && answer.kind === "envelope" && sameScope(answer.envelope.scope, scope) ? answer.envelope : null;
  const elsewhere = answer !== null && answer.kind === "envelope" && produced === null;
  return (
    <section aria-labelledby={titleId} aria-busy={isPending ? true : undefined} data-slot="export-print-actions" dir={dir} className={cn(REGION_CLASS, className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>{HEADING}</h2>
          </CardTitle>
          <CardDescription>{LEAD}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {/* The one statement of the snapshot this result, its file and its printed sheet share. */}
          <SnapshotStatement
            basis={snapshot.basis}
            currencies={snapshot.currencies}
            period={snapshot.period}
            coverage={snapshot.coverage}
            asOf={snapshot.asOf}
            isCurrentPeriod={snapshot.isCurrentPeriod}
            locale={locale}
          />
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
                {isPending ? EXPORT_BUSY_LABEL : EXPORT_LABEL}
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
      {answer !== null && answer.kind === "unavailable" ? (
        <StateNotice
          kind="unavailable"
          title={UNAVAILABLE_TITLE}
          description={UNAVAILABLE_DESCRIPTION}
          source={answer.unavailable.source}
          retry={{
            label: RETRY_LABEL,
            onClick: runExport,
          }}
          headingLevel={3}
        />
      ) : null}
      {error === null ? null : (
        <StateNotice
          kind="unavailable"
          title={TRANSPORT_TITLE}
          description={TRANSPORT_DESCRIPTION}
          retry={{
            label: RETRY_LABEL,
            onClick: runExport,
          }}
          headingLevel={3}
        />
      )}
    </section>
  );
}
export default ExportPrintActions;
