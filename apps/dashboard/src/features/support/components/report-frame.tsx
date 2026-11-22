"use client";
/** The frame every one of this application's four fixed reports renders inside. **One read, every artifact.** This file issues exactly one report read — `useReport`, once — and hands the … */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, type ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { refusalSummary } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import { sameScope, type Coverage, type CoverageState, type ReadEnvelope, type Scope } from "@/modules/data-service/envelope";
import { printModel } from "@/modules/export/print";
import type { MatrixCell, ReportQuery, ReportResult } from "@/modules/support/report";
import { COVERAGE_TEMPLATES, REPORT_NOT_FOUND, fillTemplate } from "../copy";
import { reportSnapshotId, useReport, type ReportEnvelope, type ReportRequestQuery } from "../hooks/use-report";
import { REPORT_CATALOG, isReportId, reportTitle, type ReportId } from "../report-catalog";
import ExportPrintActions from "./export-print-actions";
import PrintReport from "./print-report";
import ReportComparison from "./report-comparison";
import ReportHistory from "./report-history";
import ReportMatrix from "./report-matrix";
import ReportReceived from "./report-received";
import SnapshotStatement from "./snapshot-statement";
// What the caller passes
/** Props of {@link ReportFrame}. */
export type ReportFrameProps = {
  readonly scope: Scope;
  /** Which of the four fixed reports this page is: the catalogue is the only report identity. */
  readonly reportId: ReportId;
  readonly query: ReportQuery;
  /** The envelope a `Server Component` already read for this query, used for the first paint only. */
  readonly initialEnvelope?: ReadEnvelope<unknown>;
  readonly locale: string;
  readonly dir?: "ltr" | "rtl";
  readonly yearChoices?: readonly number[];
  readonly onSelectYear?: (year: number) => void;
  readonly className?: string;
};
// Wording this frame owns
const SUPPORT_CRUMB = "Support";
const LOADING_TITLE = "Reading this report";
const LOADING_BODY = "No figure is shown until the read answers, because a report written before the answer would state a number nobody computed.";
const LOADING_LINES = 8;
const DENIED_TITLE = "This report is not permitted in this scope";
const UNAVAILABLE_TITLE = "This report could not be read";
const REFUSED_TITLE = "This report's request was refused";
const UNREACHED_TITLE = "The report request did not complete";
const UNREACHED_BODY = "The request for this report never arrived at an answer, so nothing on this page is a figure and nothing is presented as one. Retrying re-requests the same read.";
const COVERAGE_NOTE_TITLES: Readonly<Partial<Record<CoverageState, string>>> = { partial: "Coverage of this period is partial", unknown: "How much of this period the source covers is unknown" };
const UNSTATED_BOUNDARY = "a date the source does not state";
const GIFTS_ROUTE = "/support/gifts";
const GIFTS_PARAM = { from: "from", to: "to", currency: "currency", recipient: "recipient", partnerId: "partnerId", amountMin: "amountMin", amountMax: "amountMax", designation: "designation", method: "method", search: "search", sortField: "sortField", sortDirection: "sortDirection" } as const;
/** The export action the read states, and the query parameter the history year travels in. */
const EXPORT_ACTION = "exportQuery";
const YEAR_PARAM = "year";
const NO_YEARS: readonly number[] = [];
// Reading what arrived, without trusting it
function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isReportResult(value: unknown): value is ReportResult {
  if (!isJsonObject(value)) return false;
  const snapshot = value["snapshot"];
  return (
    isJsonObject(snapshot) &&
    typeof snapshot["basis"] === "string" &&
    Array.isArray(snapshot["currencies"]) &&
    isJsonObject(snapshot["period"]) &&
    isJsonObject(snapshot["coverage"]) &&
    typeof snapshot["asOf"] === "string" &&
    Array.isArray(value["summary"]) &&
    Array.isArray(value["series"]) &&
    Array.isArray(value["rows"]) &&
    typeof value["total"] === "number" &&
    isJsonObject(value["valueStates"])
  );
}
function isReportEnvelope(value: ReadEnvelope<unknown>): value is ReportEnvelope {
  return isReportResult(value.data);
}
/** The envelope a `Server Component` read for this page, used only when it was read in the authority this frame is acting in: an envelope of another scope is another context's result, so it is … */
function seededEnvelope(initialEnvelope: ReadEnvelope<unknown> | undefined, scope: Scope): ReportEnvelope | undefined {
  if (initialEnvelope === undefined || !isReportEnvelope(initialEnvelope)) return undefined;
  return sameScope(initialEnvelope.scope, scope) ? initialEnvelope : undefined;
}
// The one bridge from the report query to the filter set the browser read accepts
function periodInputOf(period: ReportQuery["period"]): ReportRequestQuery["period"] {
  switch (period.kind) {
    case "preset":
      return { kind: "preset", preset: period.preset };
    case "year":
      return { kind: "year", year: period.year };
    case "explicit":
      return { kind: "explicit", from: String(period.from), to: String(period.to) };
  }
}
/** Reduces the report query to the bounded filter set `readReport` accepts, member for member, and changes nothing a figure depends on. */
function requestQueryOf(query: ReportQuery): ReportRequestQuery {
  const { amountRange, page, sort } = query;
  return {
    reportId: query.reportId,
    period: periodInputOf(query.period),
    ...(query.currency.kind === "one" ? { currency: query.currency.currency } : {}),
    ...(amountRange === undefined ? {} : { amountRange: { minMinor: amountRange.minMinor, maxMinor: amountRange.maxMinor } }),
    ...(query.designation === undefined ? {} : { designation: query.designation }),
    ...(query.partner === undefined ? {} : { partner: query.partner }),
    ...(query.method === undefined ? {} : { method: query.method }),
    ...(query.search === undefined ? {} : { search: query.search }),
    ...(sort === undefined ? {} : { sort: { field: sort.field, direction: sort.direction } }),
    ...(page === undefined ? {} : { page: { index: page.index, ...(page.size === undefined ? {} : { size: page.size }) } }),
    ...(query.timeZone === undefined ? {} : { timeZone: query.timeZone }),
  };
}
// The coverage note the layout sits under
function coverageNoteOf(coverage: Coverage): { readonly title: string; readonly body: string } | null {
  const title = COVERAGE_NOTE_TITLES[coverage.state];
  if (title === undefined) return null;
  return { title, body: fillTemplate(COVERAGE_TEMPLATES[coverage.state], { from: coverage.from ?? UNSTATED_BOUNDARY, to: coverage.to ?? UNSTATED_BOUNDARY }) };
}
// The drill-down
function cellDrilldownHref(cell: MatrixCell): string {
  const { drilldown } = cell;
  const period = drilldown.period;
  const from = period.kind === "explicit" ? period.from : cell.bucketStart;
  const to = period.kind === "explicit" ? period.to : cell.bucketEnd;
  const params = new URLSearchParams();
  params.set(GIFTS_PARAM.from, String(from));
  params.set(GIFTS_PARAM.to, String(to));
  params.set(GIFTS_PARAM.currency, drilldown.currency.kind === "one" ? drilldown.currency.currency : cell.currency);
  const partner = drilldown.partner;
  if (partner !== undefined) {
    params.set(GIFTS_PARAM.recipient, partner.kind);
    if (partner.kind === "partner") params.set(GIFTS_PARAM.partnerId, partner.partnerId);
  }
  const range = drilldown.amountRange;
  if (range !== undefined) {
    params.set(GIFTS_PARAM.amountMin, String(range.minMinor));
    params.set(GIFTS_PARAM.amountMax, String(range.maxMinor));
  }
  if (drilldown.designation !== undefined) params.set(GIFTS_PARAM.designation, drilldown.designation);
  if (drilldown.method !== undefined) params.set(GIFTS_PARAM.method, drilldown.method);
  if (drilldown.search !== undefined) params.set(GIFTS_PARAM.search, drilldown.search);
  const sort = drilldown.sort;
  if (sort !== undefined) {
    params.set(GIFTS_PARAM.sortField, sort.field);
    params.set(GIFTS_PARAM.sortDirection, sort.direction);
  }
  return `${GIFTS_ROUTE}?${params.toString()}`;
}
// The year the history layout states and may switch
/** The calendar year a report covers: the one the query names, or the year its period starts in. A result that has crossed to the browser states a civil day as its own `YYYY-MM-DD` text, so the year is read from that text rather than from a date object only the server held. */
function reportYearOf(query: ReportQuery, result: ReportResult): number {
  if (query.period.kind === "year") {
    return query.period.year;
  }
  // A civil day is a `Temporal` date on the server and its own `YYYY-MM-DD` text once the result has crossed to
  // the browser; `String` states the same ISO day in both forms, so the year is the one that day begins in.
  const startDay = String(result.snapshot.period.from);
  return Number(startDay.slice(0, 4));
}

// The layout the catalogue names
interface ReportLayoutProps {
  readonly reportId: ReportId;
  readonly result: ReportResult;
  readonly locale: string;
  readonly dir: "ltr" | "rtl";
  readonly year: number;
  readonly years: readonly number[];
  readonly onSelectYear: (year: number) => void;
}
/** Renders exactly one of the four fixed layouts, chosen by the catalogue rather than by the URL. */
function ReportLayout({ reportId, result, locale, dir, year, years, onSelectYear }: ReportLayoutProps): ReactElement {
  const { layout } = REPORT_CATALOG[reportId];
  switch (layout) {
    case "received":
      return <ReportReceived result={result} locale={locale} dir={dir} />;
    case "history":
      return <ReportHistory result={result} locale={locale} dir={dir} year={year} years={years} onSelectYear={onSelectYear} />;
    case "matrix":
      return <ReportMatrix result={result} locale={locale} dir={dir} drilldownHref={cellDrilldownHref} />;
    case "comparison":
      return <ReportComparison result={result} locale={locale} dir={dir} />;
    default:
      return assertNever(layout, "The report catalogue names a layout this frame does not render.");
  }
}
// The frame
/** The shared frame of the four fixed reports: one read, one statement, one layout, one set of controls and one printed page. */
export function ReportFrame({ scope, reportId, query, initialEnvelope, locale, dir = "ltr", yearChoices, onSelectYear, className }: ReportFrameProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const recognised = isReportId(reportId);
  const requestQuery = requestQueryOf(query);
  // The identity of the request: the screen, the CSV and the printed page state one snapshot only when
  // they were asked for under the same identity, so it is computed once here and handed on. The read
  // takes it as its own cache discriminator rather than deriving a second one.
  const snapshotId = reportSnapshotId(requestQuery);
  // The one read this frame issues. Every artifact below is derived from its answer, so no second
  // request is made for the export or the print, and the read is disabled only when the address names
  // no report at all.
  const read = useReport({ scope, query: requestQuery, snapshotId, enabled: recognised });
  const answer = read.data;
  // The envelope in force: the read's own answer whenever there is one, and the Server Component's
  // earlier read of the same query only while this read has neither answered nor failed.
  const envelope = answer === undefined ? (read.isError ? undefined : seededEnvelope(initialEnvelope, scope)) : answer.kind === "envelope" ? answer.envelope : undefined;
  // The result an answered envelope carries, or `null` while no answer stands. The print model is a
  // function of this object and the locale alone, so it is named here, above the branch below, because a
  // hook cannot sit inside one arm of that branch.
  const answeredResult = envelope === undefined ? null : envelope.data;
  // The one print model of this result: built when the result or the locale changes and reused by every
  // render in between, so a re-render for another reason — a filter keystroke in the parent included —
  // no longer rebuilds every cell of every row. It is `null` exactly when no envelope stands.
  const model = useMemo(() => (answeredResult === null ? null : printModel(answeredResult, { locale })), [answeredResult, locale]);
  const retry = {
    label: "Retry the read",
    onClick: (): void => {
      void read.refetch();
    },
  };
  // A year change re-runs the same query through the route's own query state. The route may supply the
  // handler; failing that, this frame changes only the year in the address the route already answers,
  // so the route parses its own vocabulary back and every other filter it read stays as it was.
  const selectYear = useCallback(
    (year: number): void => {
      if (onSelectYear !== undefined) {
        onSelectYear(year);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      params.set(YEAR_PARAM, String(year));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [onSelectYear, pathname, router],
  );
  if (!recognised) {
    // An address that names no report of the four gets the catalogue's own notice and nothing else: no
    // report is substituted, and no fabricated result stands in for one that does not exist.
    return (
      <div data-slot="report-frame" dir={dir} className={cn("flex min-w-0 flex-col gap-6", className)}>
        <StateNotice kind="empty" title={REPORT_NOT_FOUND.title} description={REPORT_NOT_FOUND.body} action={REPORT_NOT_FOUND.action} headingLevel={1} />
      </div>
    );
  }
  const title = reportTitle(reportId);
  const description = REPORT_CATALOG[reportId].description;
  let content: ReactElement;
  let printed: ReactElement | null = null;
  if (envelope === undefined || model === null) {
    if (answer !== undefined && answer.kind === "denied") {
      // A denial states no count, title or size, so nothing here hints at what the scope may not read.
      content = <StateNotice kind="denied" title={DENIED_TITLE} reasonCode={answer.denied.reasonCode} headingLevel={2} />;
    } else if (answer !== undefined && answer.kind === "unavailable") {
      content = <StateNotice kind="unavailable" title={UNAVAILABLE_TITLE} description={answer.unavailable.guidance} source={answer.unavailable.source} retry={retry} headingLevel={2} />;
    } else if (answer !== undefined && answer.kind === "refused") {
      // The report query this address states is not one the read admits: the refusal names what to
      // correct, and the source behind the report answered rather than failing.
      content = <StateNotice kind="refused" title={REFUSED_TITLE} description={refusalSummary(answer.refused)} headingLevel={2} />;
    } else if (read.isError) {
      content = <StateNotice kind="unavailable" title={UNREACHED_TITLE} description={UNREACHED_BODY} retry={retry} headingLevel={2} />;
    } else {
      content = <StateNotice kind="loading" title={LOADING_TITLE} description={LOADING_BODY} headingLevel={2} loadingLines={LOADING_LINES} />;
    }
  } else {
    const result = envelope.data;
    // The snapshot facts every artifact states, taken from the read rather than derived here: the
    // per-currency partition and the period from the result, the coverage and the as-of instant from the
    // envelope, and the period state from the model the printed page reads.
    const facts = { basis: result.snapshot.basis, currencies: result.snapshot.currencies, period: { from: String(result.snapshot.period.from), to: String(result.snapshot.period.to) }, coverage: envelope.coverage, asOf: envelope.asOf, isCurrentPeriod: model.inProgress };
    const note = coverageNoteOf(envelope.coverage);
    content = (
      <>
        {/* One statement of basis, grain, partition, period, coverage and as-of, so the screen artifact
            carries exactly the facts the CSV metadata and the printed page carry. */}
        <SnapshotStatement {...facts} locale={locale} />
        {note === null ? null : (
          // A coverage that is not complete is stated above the figures it qualifies, in the family's
          // own words, through the design system's one inline-notice surface: a figure read under
          // partial coverage is an incomplete subtotal, and a reader is told so before the figure.
          <Alert>
            <AlertTitle>{note.title}</AlertTitle>
            <AlertDescription>{note.body}</AlertDescription>
          </Alert>
        )}
        <ReportLayout reportId={reportId} result={result} locale={locale} dir={dir} year={reportYearOf(query, result)} years={yearChoices ?? NO_YEARS} onSelectYear={selectYear} />
        <Separator />
        {/* The controls of the artifact that leaves the application: the same query, the same snapshot
            identity and the same facts the screen shows, with the envelope's own advisory capability. */}
        <ExportPrintActions scope={scope} query={query} snapshotId={snapshotId} snapshot={{ ...facts, rowTotal: result.total }} locale={locale} dir={dir} canExport={envelope.actions.some((action) => action.name === EXPORT_ACTION && action.available)} />
      </>
    );
    printed = <PrintReport model={model} snapshot={facts} locale={locale} dir={dir} />;
  }
  return (
    <div data-slot="report-frame" dir={dir} className={cn("flex min-w-0 flex-col gap-6", className)}>
      {/*
        The screen region and the printed region are one result in two presentations, and the medium
        decides which of them is exposed. `print:hidden` removes the screen's headings, controls and
        figures from a printed sheet, and `hidden print:block` keeps the printed page out of the
        accessibility tree and off the screen until the browser renders it for paper.
      */}
      <div data-slot="report-screen" className="flex min-w-0 flex-col gap-6 print:hidden">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/support" />}>{SUPPORT_CRUMB}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <header className="flex min-w-0 flex-col gap-2">
          {/* The page's one `h1`: the four layouts nest their own headings beneath it. */}
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-pretty wrap-anywhere">{title}</h1>
          <p className="max-w-prose text-sm text-balance text-muted-foreground md:text-pretty">{description}</p>
        </header>
        {content}
      </div>
      {printed === null ? null : (
        <div data-slot="report-print" className="hidden print:block">
          {printed}
        </div>
      )}
    </div>
  );
}
export default ReportFrame;
