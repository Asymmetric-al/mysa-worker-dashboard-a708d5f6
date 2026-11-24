"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, type ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { refusalSummary } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { isRecord } from "@/lib/guards";
import { assertNever } from "@/lib/result";
import { sameScope, type Coverage, type CoverageState, type GiftAttribution, type ReadEnvelope, type Scope } from "@/modules/data-service/envelope";
import { printModel } from "@/modules/export/print";
import { matrixDrilldownQuery, type MatrixCell, type ReportQuery, type ReportResult } from "@/modules/support/report";
import { COVERAGE_TEMPLATES, REPORT_NOT_FOUND, fillTemplate } from "../copy";
import { GIFTS_PARAM } from "../gift-params";
import { reportSnapshotId, useReport, type ReportEnvelope, type ReportReadResult, type ReportRequestQuery } from "../hooks/use-report";
import { REPORT_CATALOG, isReportId, reportTitle, type ReportId } from "../report-catalog";
import ExportPrintActions from "./export-print-actions";
import PrintReport from "./print-report";
import { ReportComparison, ReportHistory, ReportMatrix, ReportReceived } from "./report-layouts";
import SnapshotStatement from "./snapshot-statement";
export type ReportFrameProps = {
  readonly scope: Scope;
  readonly reportId: ReportId;
  readonly query: ReportQuery;
  readonly initialEnvelope?: ReadEnvelope<unknown>;
  readonly locale: string;
  readonly dir?: "ltr" | "rtl";
  readonly yearChoices?: readonly number[];
  readonly onSelectYear?: (year: number) => void;
  readonly className?: string;
};
const LOADING_BODY = "No figure is shown until the read answers, because a report written before the answer would state a number nobody computed.";
const COVERAGE_NOTE_TITLES: Readonly<Partial<Record<CoverageState, string>>> = { partial: "Coverage of this period is partial", unknown: "How much of this period the source covers is unknown" };
const NO_YEARS: readonly number[] = [];
/** The page window the address states, in the read's own vocabulary: a page index counted from zero, and the rows it holds, which travel together because a row count without a page states no window. */ const PAGE_PARAM = "page";
function isReportResult(value: unknown): value is ReportResult {
  if (!isRecord(value)) return false;
  const snapshot = value["snapshot"];
  return (
    isRecord(snapshot) &&
    typeof snapshot["basis"] === "string" &&
    Array.isArray(snapshot["currencies"]) &&
    isRecord(snapshot["query"]) &&
    isRecord(snapshot["period"]) &&
    isRecord(snapshot["coverage"]) &&
    typeof snapshot["asOf"] === "string" &&
    Array.isArray(value["summary"]) &&
    Array.isArray(value["series"]) &&
    Array.isArray(value["rows"]) &&
    typeof value["total"] === "number" &&
    isRecord(value["valueStates"])
  );
}
const isReportEnvelope = (value: ReadEnvelope<unknown>): value is ReportEnvelope => isReportResult(value.data);
/** The envelope this page already read, when it is this authority's answer to this exact request: the same scope and the same query, identified by the one snapshot identity the read and its export share. A seed that answered another query would state another report's figures without asking for this one, so it is never used. */
const seededEnvelope = (initialEnvelope: ReadEnvelope<unknown> | undefined, scope: Scope, asked: ReportRequestQuery): ReportEnvelope | undefined =>
  initialEnvelope === undefined || !isReportEnvelope(initialEnvelope) || !sameScope(initialEnvelope.scope, scope) ? undefined : reportSnapshotId(requestQueryOf(initialEnvelope.data.snapshot.query)) === reportSnapshotId(asked) ? initialEnvelope : undefined;
function requestQueryOf(query: ReportQuery): ReportRequestQuery {
  const { amountRange, page, period, sort } = query;
  return {
    reportId: query.reportId,
    period: period.kind === "preset" ? { kind: "preset", preset: period.preset } : period.kind === "year" ? { kind: "year", year: period.year } : { kind: "explicit", from: String(period.from), to: String(period.to) },
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
function coverageNoteOf(coverage: Coverage): { readonly title: string; readonly body: string } | null {
  const title = COVERAGE_NOTE_TITLES[coverage.state];
  return title === undefined ? null : { title, body: fillTemplate(COVERAGE_TEMPLATES[coverage.state], { from: coverage.from ?? "a date the source does not state", to: coverage.to ?? "a date the source does not state" }) };
} /** The gifts address one matrix cell opens: the query that cell stands for, stated in the ledger's own filter set. */
function cellDrilldownHref(query: ReportQuery, attribution: GiftAttribution, cell: MatrixCell): string {
  const drilldown = matrixDrilldownQuery(query, attribution, cell.currency, cell.bucketStart, cell.bucketEnd); // The narrowing is derived here from the query the matrix was computed from, the row's own attribution and the cell's month, so no cell carries a copy of the query behind it.
  const range = drilldown.amountRange;
  const params = new URLSearchParams();
  const stated: readonly (readonly [string, string | undefined])[] = [
    [GIFTS_PARAM.from, String(cell.bucketStart)],
    [GIFTS_PARAM.to, String(cell.bucketEnd)],
    [GIFTS_PARAM.currency, cell.currency],
    [GIFTS_PARAM.recipient, attribution.kind],
    [GIFTS_PARAM.partnerId, attribution.kind === "partner" ? attribution.partnerId : undefined],
    [GIFTS_PARAM.amountMin, range === undefined ? undefined : String(range.minMinor)],
    [GIFTS_PARAM.amountMax, range === undefined ? undefined : String(range.maxMinor)],
    [GIFTS_PARAM.designation, drilldown.designation],
    [GIFTS_PARAM.method, drilldown.method],
    [GIFTS_PARAM.search, drilldown.search],
    [GIFTS_PARAM.sortField, drilldown.sort?.field],
    [GIFTS_PARAM.sortDirection, drilldown.sort?.direction],
  ];
  for (const [key, value] of stated) if (value !== undefined) params.set(key, value);
  return `/support/gifts?${params.toString()}`;
}
const reportYearOf = (query: ReportQuery, result: ReportResult): number => (query.period.kind === "year" ? query.period.year : Number(String(result.snapshot.period.from).slice(0, 4)));
type ReportLayoutProps = { readonly reportId: ReportId; readonly result: ReportResult; readonly locale: string; readonly dir: "ltr" | "rtl"; readonly year: number; readonly years: readonly number[]; readonly onSelectYear: (year: number) => void; readonly onSelectPage: (page: number, pageSize: number) => void };
function ReportLayout({ reportId, result, locale, dir, year, years, onSelectYear, onSelectPage }: ReportLayoutProps): ReactElement {
  const { layout } = REPORT_CATALOG[reportId];
  switch (layout) {
    case "received":
      return <ReportReceived result={result} locale={locale} dir={dir} />;
    case "history":
      return <ReportHistory result={result} locale={locale} dir={dir} year={year} years={years} onSelectYear={onSelectYear} />;
    case "matrix":
      return <ReportMatrix result={result} locale={locale} dir={dir} drilldownHref={cellDrilldownHref} onSelectPage={onSelectPage} />;
    case "comparison":
      return <ReportComparison result={result} locale={locale} dir={dir} />;
    default:
      return assertNever(layout, "The report catalogue names a layout this frame does not render.");
  }
}
/** The shared frame of the four fixed reports: one read, one statement, one layout, one set of controls and one printed page. */ export function ReportFrame({ scope, reportId, query, initialEnvelope, locale, dir = "ltr", yearChoices, onSelectYear, className }: ReportFrameProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const recognised = isReportId(reportId);
  const requestQuery = requestQueryOf(query);
  const snapshotId = reportSnapshotId(requestQuery);
  const seed = seededEnvelope(initialEnvelope, scope, requestQuery); // The envelope this page already read on the server for this same request: seeding the read with it means the mount asks for nothing the page has already read, and an answer to any other request is never passed off as this one's.
  const seededAnswer: ReportReadResult | undefined = seed === undefined ? undefined : { kind: "envelope", envelope: seed };
  const read = useReport({ scope, query: requestQuery, snapshotId, enabled: recognised, initialAnswer: seededAnswer });
  const answer = read.data;
  const envelope = answer === undefined ? (read.isError ? undefined : seed) : answer.kind === "envelope" ? answer.envelope : undefined;
  const retry = { label: "Retry the read", onClick: (): void => void read.refetch() };
  const selectYear = useCallback(
    (year: number): void => {
      if (onSelectYear !== undefined) {
        onSelectYear(year);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      params.set("year", String(year));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [onSelectYear, pathname, router],
  );
  // A page change re-runs the same query through the route's own query state, exactly as a year change does, and no page is held here.
  const selectPage = useCallback(
    (page: number, pageSize: number): void => {
      const params = new URLSearchParams(window.location.search);
      params.set(PAGE_PARAM, String(page));
      params.set("pageSize", String(pageSize));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router],
  );
  const answeredResult = envelope === undefined ? null : envelope.data; // The one print model of the answered result: built when the result or the locale changes and reused in between, so a re-render for another reason rebuilds no cell, and `null` exactly when no envelope stands.
  const model = useMemo(() => (answeredResult === null ? null : printModel(answeredResult, { locale })), [answeredResult, locale]);
  if (!recognised) {
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
    content =
      answer === undefined ? (
        read.isError ? (
          <StateNotice kind="unavailable" title="The report request did not complete" description="The request for this report never arrived at an answer, so nothing on this page is a figure and nothing is presented as one. Retrying re-requests the same read." retry={retry} headingLevel={2} />
        ) : (
          <StateNotice kind="loading" title="Reading this report" description={LOADING_BODY} headingLevel={2} loadingLines={8} />
        )
      ) : answer.kind === "denied" ? (
        <StateNotice kind="denied" title="This report is not permitted in this scope" reasonCode={answer.denied.reasonCode} headingLevel={2} />
      ) : answer.kind === "unavailable" ? (
        <StateNotice kind="unavailable" title="This report could not be read" description={answer.unavailable.guidance} source={answer.unavailable.source} retry={retry} headingLevel={2} />
      ) : answer.kind === "refused" ? (
        <StateNotice kind="refused" title="This report's request was refused" description={refusalSummary(answer.refused)} headingLevel={2} />
      ) : (
        <StateNotice kind="loading" title="Reading this report" description={LOADING_BODY} headingLevel={2} loadingLines={8} />
      );
  } else {
    const result = envelope.data;
    const facts = { basis: result.snapshot.basis, currencies: result.snapshot.currencies, period: { from: String(result.snapshot.period.from), to: String(result.snapshot.period.to) }, coverage: envelope.coverage, asOf: envelope.asOf, isCurrentPeriod: model.inProgress };
    const note = coverageNoteOf(envelope.coverage);
    content = (
      <>
        <SnapshotStatement {...facts} locale={locale} />
        {note === null ? null : (
          <Alert>
            <AlertTitle>{note.title}</AlertTitle>
            <AlertDescription>{note.body}</AlertDescription>
          </Alert>
        )}
        <ReportLayout reportId={reportId} result={result} locale={locale} dir={dir} year={reportYearOf(query, result)} years={yearChoices ?? NO_YEARS} onSelectYear={selectYear} onSelectPage={selectPage} />
        <Separator />
        <ExportPrintActions scope={scope} query={query} snapshotId={snapshotId} snapshot={{ ...facts, rowTotal: result.total }} locale={locale} dir={dir} canExport={envelope.actions.some((action) => action.name === "exportQuery" && action.available)} />
      </>
    );
    printed = <PrintReport model={model} snapshot={facts} locale={locale} dir={dir} />;
  }
  return (
    <div data-slot="report-frame" dir={dir} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div data-slot="report-screen" className="flex min-w-0 flex-col gap-6 print:hidden">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink {...{ className: "inline-link", render: <Link href="/support" /> }}>Support</BreadcrumbLink>{" "}
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>{" "}
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <header className="flex min-w-0 flex-col gap-2">
          <h1 className="type-page-title text-pretty wrap-anywhere">{title}</h1>
          <p className="type-supporting max-w-prose text-balance md:text-pretty">{description}</p>
        </header>
        {content}
      </div>
      {printed === null ? null : <div {...{ "data-slot": "report-print", className: "hidden print:block" }}>{printed}</div>}
    </div>
  );
}
export default ReportFrame;
