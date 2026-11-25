"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { FactList } from "@/components/fact-list";
import { refusalSummary } from "@/components/form-field";
import { RecordList, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, type StatusBadgeSpec } from "@/components/status-badge";
import { SegmentedMeter, type MeterSegmentTone } from "@/components/ui/segmented-meter";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import { assertNever } from "@/lib/result";
import type { Coverage, ReadEnvelope, ValueState, reads } from "@/modules/data-service";
import { PAGE_SIZE_DEFAULT } from "@/modules/support/report";
import { RESPONSE_AGREEMENT_COPY, RESPONSE_KIND_COPY, RESULTS_COPY, STATE_NOTICE_COPY, type ResponseKind } from "../copy";
import { useInitiativeResults, type InitiativeResultsEnvelope } from "../hooks/use-initiative-results";
import { CountFigure, integerOf, pageNumberOf, pageSizeNumberOf, statedState } from "./figures";
type ResultsEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiativeResults>>, { readonly kind: "envelope" }>["envelope"];
type ResultsData = ResultsEnvelope["data"];
type MeasuredCount = ResultsData["requests"]["presented"];
type ResponseKindRow = ResultsData["responseKinds"][number];
type TermsVersionRow = ResultsData["termsVersions"][number];
type RecordedResponseKind = ResponseKindRow["kind"];
type ValueStates = Readonly<Record<string, ValueState>>;
type ColumnVisibility = RecordListQueryState["columnVisibility"];
const COPY_KIND_OF_RECORDED_KIND: Readonly<Record<RecordedResponseKind, ResponseKind>> = { agreed: "agreed", conditional: "conditional", partial: "partial", deferred: "deferred", declined: "declined", unanswered: "unanswered", "needs-clarification": "needs clarification" };
const TERMS_VERSION_STATE: Readonly<Record<TermsVersionRow["state"], StatusBadgeSpec>> = { current: { label: "Current terms version", tone: "info" }, superseded: { label: "Superseded by a later version", tone: "muted" } };
const SURFACE_COPY = {
  intro: "Each row states one recorded response kind, the count the read supplied for it, and the base that count is measured against.",
  worthNote: "A recorded response is one named person's answer; a change in these counts says nothing about anyone's motivation or worth.",
  emptyAction: "Review the Requests on this initiative",
  termsHeading: "Terms versions",
  termsVersionColumn: "Terms version",
  termsStateColumn: "State",
  termsReferencingColumn: "Requests referencing",
  termsResponsesColumn: "Responses recorded",
  readingTitle: "Reading the results",
  readingDescription: "This surface states every recorded response with the base it is counted against, so it waits for the read rather than showing an empty result.",
  kindsLabelSuffix: "by response kind",
} as const;
const shareFormat = new Intl.NumberFormat("en-US", { style: "unit", unit: "percent", maximumFractionDigits: 1 });
const NO_SORT: RecordListQueryState["sort"] = [];
const NO_RESPONSE_KINDS: readonly ResponseKindRow[] = [];
const NO_TERMS_VERSIONS: readonly TermsVersionRow[] = [];
const NO_VALUE_STATES: ValueStates = {};
const NO_COLUMNS_HIDDEN: ColumnVisibility = {};
const RESULT_PARAM = { page: "page", pageSize: "pageSize" } as const;
const FIRST_PAGE = 1;
export type InitiativeResultsQuery = { readonly page: number; readonly pageSize: number };
/** Writes the page window as URL parameters, so a pager change, a reload and a return from a Request all state the same window. */ export function toInitiativeResultsParams(query: InitiativeResultsQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set(RESULT_PARAM.page, String(pageNumberOf(query.page)));
  params.set(RESULT_PARAM.pageSize, String(pageSizeNumberOf(query.pageSize)));
  return params;
}
/** Reads the page window back from an address, applying the same two rules the writer applies so a round trip returns an equal window. */ export function parseInitiativeResultsQuery(source: URLSearchParams | string): InitiativeResultsQuery {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  return { page: pageNumberOf(integerOf(params.get(RESULT_PARAM.page)) ?? FIRST_PAGE), pageSize: pageSizeNumberOf(integerOf(params.get(RESULT_PARAM.pageSize)) ?? PAGE_SIZE_DEFAULT) };
}
const countStatePath = (kind: RecordedResponseKind): string => `responseKinds.${kind}.count`;
const termsStatePath = (termsVersion: string, member: "requestsReferencing" | "responses.count"): string => `termsVersions.${termsVersion}.${member}`;
function coverageSentence(coverage: Coverage): string {
  const { from, to, state } = coverage;
  const span = from !== null && to !== null ? `records from ${from} to ${to}` : from !== null ? `records from ${from} onwards` : to !== null ? `records up to ${to}` : "records with no period stated";
  switch (state) {
    case "complete":
      return `${span}, fully covered`;
    case "partial":
      return `${span}, partly covered`;
    case "unknown":
      return `${span}, coverage not known`;
    default:
      return assertNever(state, "Unhandled coverage state");
  }
}
const initiativeHref = (initiativeId: string): string => `/partners/initiatives/${encodeURIComponent(initiativeId)}`;
function DenominatorFigure({ measured }: { readonly measured: MeasuredCount }): ReactElement {
  if (!Number.isFinite(measured.denominator) || measured.denominator <= 0) return <span className="text-pretty text-muted-foreground">{RESULTS_COPY.denominatorMissingNote}</span>;
  return (
    <span className="break-words">
      <span className="tabular-figures">{countFormatOf().format(measured.denominator)}</span> {measured.denominatorMeaning}
    </span>
  );
}
function ShareFigure({ measured }: { readonly measured: MeasuredCount }): ReactElement {
  const share = measured.percentage;
  return share === undefined || !Number.isFinite(share) ? <span className="text-pretty text-muted-foreground">{RESULTS_COPY.denominatorMissingNote}</span> : <span className="tabular-figures">{shareFormat.format(share)}</span>;
}
function KindFigure({ kind }: { readonly kind: RecordedResponseKind }): ReactElement {
  const copy = RESPONSE_KIND_COPY[COPY_KIND_OF_RECORDED_KIND[kind]];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-medium text-pretty break-words">{copy.label}</span>
      <span className="text-xs text-pretty text-muted-foreground">{copy.description}</span>
    </div>
  );
}
function responseKindColumns(valueStates: ValueStates, showsShare: boolean): ReadonlyArray<RecordListColumnDef<ResponseKindRow>> {
  const columns: RecordListColumnDef<ResponseKindRow>[] = [
    { id: "kind", header: RESULTS_COPY.kindColumnLabel, enableSorting: false, enableHiding: false, cell: ({ row }) => <KindFigure kind={row.original.kind} /> },
    { id: "count", header: RESULTS_COPY.countColumnLabel, enableSorting: false, cell: ({ row }) => <CountFigure count={row.original.count} state={statedState(valueStates, countStatePath(row.original.kind))} /> },
    { id: "denominator", header: RESULTS_COPY.denominatorLabel, enableSorting: false, cell: ({ row }) => <DenominatorFigure measured={row.original} /> },
  ];
  if (showsShare) columns.push({ id: "share", header: RESULTS_COPY.shareColumnLabel, enableSorting: false, cell: ({ row }) => <ShareFigure measured={row.original} /> });
  return columns;
}
function termsVersionColumns(valueStates: ValueStates): ReadonlyArray<RecordListColumnDef<TermsVersionRow>> {
  return [
    { id: "termsVersion", header: SURFACE_COPY.termsVersionColumn, enableSorting: false, enableHiding: false, cell: ({ row }) => <bdi className="mono-identifier break-all">{row.original.termsVersion}</bdi> },
    { id: "state", header: SURFACE_COPY.termsStateColumn, enableSorting: false, cell: ({ row }) => <StatusBadge {...statusBadgeProps(TERMS_VERSION_STATE, row.original.state)} /> },
    { id: "referencing", header: SURFACE_COPY.termsReferencingColumn, enableSorting: false, cell: ({ row }) => <CountFigure count={row.original.requestsReferencing} state={statedState(valueStates, termsStatePath(row.original.termsVersion, "requestsReferencing"))} /> },
    {
      id: "responses",
      header: SURFACE_COPY.termsResponsesColumn,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <CountFigure count={row.original.responses.count} state={statedState(valueStates, termsStatePath(row.original.termsVersion, "responses.count"))} />
          <span className="text-xs text-pretty text-muted-foreground">
            <DenominatorFigure measured={row.original.responses} />
          </span>
        </div>
      ),
    },
  ];
}
const responseKindRowId = (row: ResponseKindRow): string => row.kind;
const termsVersionRowId = (row: TermsVersionRow): string => row.termsVersion;
const KindList = ({ rows, valueStates, showsShare, label }: { readonly rows: readonly ResponseKindRow[]; readonly valueStates: ValueStates; readonly showsShare: boolean; readonly label: string }): ReactElement => (
  <div data-slot="initiative-results-kinds" className="min-w-0 md:hidden">
    <ul aria-label={label} className="flex min-w-0 flex-col gap-4">
      {rows.map((row) => (
        <li key={row.kind} className="flex min-w-0 flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0">
          <KindFigure kind={row.kind} />
          <FactList
            className="flex min-w-0 flex-col gap-1 text-sm"
            rowClassName="flex min-w-0 flex-wrap items-baseline gap-x-2"
            termClassName="text-muted-foreground"
            valueClassName="min-w-0"
            facts={[
              { term: RESULTS_COPY.countColumnLabel, value: <CountFigure count={row.count} state={statedState(valueStates, countStatePath(row.kind))} />, valueClassName: "min-w-0 break-words" },
              { term: RESULTS_COPY.denominatorLabel, value: <DenominatorFigure measured={row} /> },
              ...(showsShare ? [{ term: RESULTS_COPY.shareColumnLabel, value: <ShareFigure measured={row} /> }] : []),
            ]}
          />
        </li>
      ))}
    </ul>
  </div>
);
const Surface = ({ headingId, children, className }: { readonly headingId: string; readonly children: ReactNode; readonly className?: string }): ReactElement => (
  <section aria-labelledby={headingId} data-slot="initiative-results" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
    <h3 {...{ id: headingId, className: "type-subsection-title text-pretty" }}>{RESULTS_COPY.heading}</h3>
    {children}
  </section>
);
const ResultsStatement = (): ReactElement => (
  <div className="flex min-w-0 flex-col gap-1 text-sm text-pretty text-muted-foreground">
    <p className="type-supporting">{SURFACE_COPY.intro}</p>
    <p className="type-supporting">{RESPONSE_AGREEMENT_COPY.agreementCreatesNothing}</p>
    <p className="type-supporting">{SURFACE_COPY.worthNote}</p>
  </div>
);
type InitiativeResultsSurfaceProps = { readonly initiativeId: string; readonly queryState?: RecordListQueryState; readonly initialEnvelope: ReadEnvelope<ResultsData>; readonly onQueryStateChange?: (next: RecordListQueryState) => void; readonly className?: string };
const loadingSurface = (headingId: string, className: string | undefined): ReactElement => (
  <Surface headingId={headingId} className={className}>
    <StateNotice kind="loading" title={SURFACE_COPY.readingTitle} description={SURFACE_COPY.readingDescription} loadingLines={7} />
  </Surface>
);
const RESPONSE_KIND_TONE: Readonly<Record<RecordedResponseKind, MeterSegmentTone>> = {
  agreed: "positive",
  conditional: "info",
  partial: "info",
  deferred: "warning",
  "needs-clarification": "warning",
  declined: "destructive",
  unanswered: "muted",
};

function InitiativeResultsSurface({ initiativeId, queryState: controlledState, initialEnvelope, onQueryStateChange, className }: InitiativeResultsSurfaceProps): ReactElement {
  const headingId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stated = useMemo<InitiativeResultsQuery>(() => parseInitiativeResultsQuery(searchParams), [searchParams]);
  const page = controlledState === undefined ? stated.page : controlledState.page;
  const pageSize = controlledState === undefined ? stated.pageSize : controlledState.pageSize;
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(controlledState === undefined ? NO_COLUMNS_HIDDEN : controlledState.columnVisibility);
  const listQueryState = useMemo<RecordListQueryState>(() => ({ sort: NO_SORT, page, pageSize, columnVisibility }), [page, pageSize, columnVisibility]);
  const seeded = useMemo<InitiativeResultsEnvelope<ResultsData>>(() => ({ kind: "envelope", envelope: initialEnvelope }), [initialEnvelope]);
  const read = useInitiativeResults<ResultsData>(initiativeId, seeded);
  const result = read.status === "ready" ? read.result : undefined;
  const envelope = result !== undefined && result.kind === "envelope" ? result.envelope : undefined;
  const kindRows: readonly ResponseKindRow[] = envelope === undefined ? NO_RESPONSE_KINDS : envelope.data.responseKinds;
  const termsRows: readonly TermsVersionRow[] = envelope === undefined ? NO_TERMS_VERSIONS : envelope.data.termsVersions;
  const valueStates: ValueStates = envelope === undefined ? NO_VALUE_STATES : envelope.valueStates;
  const showsShare = kindRows.some((row) => row.percentage !== undefined);
  const kindColumns = useMemo<ReadonlyArray<RecordListColumnDef<ResponseKindRow>>>(() => responseKindColumns(valueStates, showsShare), [valueStates, showsShare]);
  const termsColumns = useMemo<ReadonlyArray<RecordListColumnDef<TermsVersionRow>>>(() => termsVersionColumns(valueStates), [valueStates]);
  const writeWindow = useCallback(
    (nextPage: number, nextPageSize: number): void => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of toInitiativeResultsParams({ page: nextPage, pageSize: nextPageSize })) params.set(key, value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const lastPage = Math.max(FIRST_PAGE, Math.ceil(Math.max(kindRows.length, termsRows.length) / pageSize));
  useEffect(() => {
    if (controlledState !== undefined || page <= lastPage) return;
    writeWindow(lastPage, pageSize);
  }, [controlledState, lastPage, page, pageSize, writeWindow]);
  function handleQueryStateChange(next: RecordListQueryState): void {
    if (next.columnVisibility !== columnVisibility) setColumnVisibility(next.columnVisibility);
    if (next.page === page && next.pageSize === pageSize) return;
    writeWindow(next.page, next.pageSize);
    onQueryStateChange?.({ sort: NO_SORT, page: next.page, pageSize: next.pageSize, columnVisibility });
  }
  if (result === undefined) return loadingSurface(headingId, className);
  if (result.kind !== "envelope") {
    return (
      <Surface headingId={headingId} className={className}>
        {result.kind === "denied" ? (
          <StateNotice kind="denied" headingLevel={4} title={STATE_NOTICE_COPY.denied.title} description={STATE_NOTICE_COPY.denied.body} reasonCode={result.denied.reasonCode} />
        ) : result.kind === "unavailable" ? (
          <StateNotice kind="unavailable" headingLevel={4} title={STATE_NOTICE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} />
        ) : (
          <StateNotice kind="refused" headingLevel={4} title={STATE_NOTICE_COPY.refused.title} description={refusalSummary(result.refused)} />
        )}
      </Surface>
    );
  }
  const results = result.envelope.data;
  const { coverage, asOf } = result.envelope;
  const requestBase = results.requests.presented.denominator;
  const coverageText = coverageSentence(coverage);
  const kindsLabel = `${RESULTS_COPY.heading} for ${results.initiative.name}, ${SURFACE_COPY.kindsLabelSuffix}: ${coverageText}`;
  return (
    <Surface headingId={headingId} className={className}>
      <ResultsStatement />
      <p className="text-xs text-pretty text-muted-foreground">
        {"As of "}
        <bdi>
          <time {...{ className: "tabular-figures", dateTime: asOf }}>{asOf}</time>
        </bdi>
        {` · ${coverageText}`}
      </p>
      {Number.isFinite(requestBase) && requestBase > 0 ? (
        results.requests.answered.count === 0 ? (
          <p className="type-supporting text-pretty">{RESULTS_COPY.noResultsNote}</p>
        ) : null
      ) : (
        <StateNotice kind="empty" headingLevel={4} title={`${RESULTS_COPY.heading}: ${results.initiative.name}`} description={RESULTS_COPY.noResultsNote} action={{ label: SURFACE_COPY.emptyAction, href: `${initiativeHref(initiativeId)}#requests` }} />
      )}
      <SegmentedMeter
        segments={kindRows.map((row) => ({
          key: row.kind,
          label: RESPONSE_KIND_COPY[COPY_KIND_OF_RECORDED_KIND[row.kind]].label,
          count: row.count,
          tone: RESPONSE_KIND_TONE[row.kind],
        }))}
        label="Recorded response kind breakdown"
      />
      <div className="hidden min-w-0 md:block">
        <RecordList label={kindsLabel} columns={kindColumns} rows={kindRows} rowCount={kindRows.length} queryState={listQueryState} onQueryStateChange={handleQueryStateChange} getRowId={responseKindRowId} initialPinnedColumns={{ start: ["kind"] }} itemNoun="response kinds" />
      </div>
      <KindList rows={kindRows} valueStates={valueStates} showsShare={showsShare} label={kindsLabel} />
      {termsRows.length === 0 ? null : (
        <div data-slot="initiative-results-terms" className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h4 className="type-group-title">{SURFACE_COPY.termsHeading}</h4>
            <p className="type-supporting text-pretty">{RESPONSE_AGREEMENT_COPY.bindsToTermsVersion}</p>
          </div>
          <RecordList label={`${RESULTS_COPY.heading} for ${results.initiative.name}: ${SURFACE_COPY.termsHeading}`} columns={termsColumns} rows={termsRows} rowCount={termsRows.length} queryState={listQueryState} onQueryStateChange={handleQueryStateChange} getRowId={termsVersionRowId} initialPinnedColumns={{ start: ["termsVersion"] }} itemNoun="terms versions" />
        </div>
      )}
    </Surface>
  );
}
/** The page window a composing page controls, in the preset's own query-state shape. · The envelope the Server Component already read, and the authority the browser read re-requests under. · Receives every window or column change as well, for a caller that keeps its own copy of the state. */
export type InitiativeResultsProps = { readonly initiativeId: string; readonly queryState?: RecordListQueryState; readonly initialEnvelope?: ReadEnvelope<ResultsData>; readonly onQueryStateChange?: (next: RecordListQueryState) => void; readonly className?: string };
/** The initiative results surface. */ export default function InitiativeResults({ initiativeId, queryState, initialEnvelope, onQueryStateChange, className }: InitiativeResultsProps): ReactElement {
  const headingId = useId();
  return initialEnvelope === undefined ? loadingSurface(headingId, className) : <InitiativeResultsSurface initiativeId={initiativeId} queryState={queryState} initialEnvelope={initialEnvelope} onQueryStateChange={onQueryStateChange} className={className} />;
}
