"use client";
/** One initiative's results: what the named respondents actually answered, stated as the count the read supplied over the base that count is measured against, in words. **Why nothing is divided … */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { refusalSummary } from "@/components/form-field";
import { RecordList, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS, type StatusBadgeSpec } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { Coverage, ReadEnvelope, ValueState, reads } from "@/modules/data-service";
import { PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT } from "@/modules/support/report";
import { RESPONSE_AGREEMENT_COPY, RESPONSE_KIND_COPY, RESULTS_COPY, STATE_NOTICE_COPY, type ResponseKind } from "../copy";
import { useInitiativeResults, type InitiativeResultsEnvelope } from "../hooks/use-initiative-results";

// The contract: the results read's own types, narrowed to the fields this surface renders
type ResultsEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiativeResults>>, { readonly kind: "envelope" }>["envelope"];

type ResultsData = ResultsEnvelope["data"];

/** One count with the base it is measured against, exactly as the read supplies it. */
type MeasuredCount = ResultsData["requests"]["presented"];

/** One of the seven response kinds, with the count and the base the read recorded for it. */
type ResponseKindRow = ResultsData["responseKinds"][number];

/** The results of one terms version: what referenced it and what answered it. */
type TermsVersionRow = ResultsData["termsVersions"][number];

/** A stored response kind's name: the read's vocabulary, not the reader's. */
type RecordedResponseKind = ResponseKindRow["kind"];

type ValueStates = Readonly<Record<string, ValueState>>;

type ColumnVisibility = RecordListQueryState["columnVisibility"];

// The two vocabularies, joined once
/** The read names the kinds with the stored vocabulary (`needs-clarification`) while this family names the same kinds for readers (`needs clarification`), so one exhaustive map joins them. */
const COPY_KIND_OF_RECORDED_KIND: Readonly<Record<RecordedResponseKind, ResponseKind>> = { agreed: "agreed", conditional: "conditional", partial: "partial", deferred: "deferred", declined: "declined", unanswered: "unanswered", "needs-clarification": "needs clarification" };

/** The two states a terms version can hold on this surface; a version is never silently current. */
const TERMS_VERSION_STATE: Readonly<Record<TermsVersionRow["state"], StatusBadgeSpec>> = { current: { label: "Current terms version", tone: "info" }, superseded: { label: "Superseded by a later version", tone: "muted" } };

// Wording this surface alone states
/** `../copy.ts` owns the family's shared vocabulary — the response kinds, the denominator wording and the statements that a recorded response creates nothing — and the wording particular to the … */
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

// Fixed values
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// The share is the read's own figure, stated with its unit and never recomputed from the count.
const shareFormat = new Intl.NumberFormat("en-US", { style: "unit", unit: "percent", maximumFractionDigits: 1 });

const NO_SORT: RecordListQueryState["sort"] = [];

const NO_RESPONSE_KINDS: readonly ResponseKindRow[] = [];

const NO_TERMS_VERSIONS: readonly TermsVersionRow[] = [];

const NO_VALUE_STATES: ValueStates = {};

const NO_COLUMNS_HIDDEN: ColumnVisibility = {};

// The page window, and the address it survives in
/** The parameters the window travels as. */
const RESULT_PARAM = { page: "page", pageSize: "pageSize" } as const;

const FIRST_PAGE = 1;

const WHOLE_NUMBER = /^\d+$/u;

/** The page window this surface states: the page it shows and how many rows one page holds. */
export interface InitiativeResultsQuery {
  readonly page: number;
  readonly pageSize: number;
}

/** The window a first visit states: the first page at the read's own default size. */
export const DEFAULT_INITIATIVE_RESULTS_QUERY: InitiativeResultsQuery = { page: FIRST_PAGE, pageSize: PAGE_SIZE_DEFAULT };
function integerOf(value: string | null): number | undefined {
  if (value === null || !WHOLE_NUMBER.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
function pageNumberOf(value: number): number {
  return Number.isSafeInteger(value) && value >= FIRST_PAGE ? value : FIRST_PAGE;
}
function pageSizeNumberOf(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return PAGE_SIZE_DEFAULT;
  }
  return value >= PAGE_SIZE_CAP ? PAGE_SIZE_CAP : PAGE_SIZE_DEFAULT;
}
/** Writes the page window as URL parameters, so a pager change, a reload and a return from a Request all state the same window. */
export function toInitiativeResultsParams(query: InitiativeResultsQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set(RESULT_PARAM.page, String(pageNumberOf(query.page)));
  params.set(RESULT_PARAM.pageSize, String(pageSizeNumberOf(query.pageSize)));
  return params;
}
/** Reads the page window back from an address, applying the same two rules the writer applies so a round trip returns an equal window. */
export function parseInitiativeResultsQuery(source: URLSearchParams | string): InitiativeResultsQuery {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  return { page: pageNumberOf(integerOf(params.get(RESULT_PARAM.page)) ?? FIRST_PAGE), pageSize: pageSizeNumberOf(integerOf(params.get(RESULT_PARAM.pageSize)) ?? PAGE_SIZE_DEFAULT) };
}

// Reading the read
/** The state the read recorded for one field. */
function statedState(valueStates: ValueStates, path: string): ValueState {
  return valueStates[path] ?? "value";
}

function countStatePath(kind: RecordedResponseKind): string {
  return `responseKinds.${kind}.count`;
}

function termsStatePath(termsVersion: string, member: "requestsReferencing" | "responses.count"): string {
  return `termsVersions.${termsVersion}.${member}`;
}

/** The period the counts cover, in words, so a reader of the table or of its accessible name knows what span the figures describe rather than assuming they cover all of history. */
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

/** The initiative this surface reports on, at the route the application already owns. */
function initiativeHref(initiativeId: string): string {
  return `/partners/initiatives/${encodeURIComponent(initiativeId)}`;
}

// The figures
/** A count rendered from its own value state: a plain number only when the read says the number stands as it is, an incompleteness beside the figure when the period behind it is only partly covered … */
function CountFigure({ count, state }: { readonly count: number; readonly state: ValueState }): ReactElement {
  if (!Number.isFinite(count)) {
    // A count that is not a number is never printed as one; it is reported as the unknown it is.
    return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "unknown")} />;
  }
  switch (state) {
    case "value":
    case "zero":
      return <span className="tabular-figures">{countFormat.format(count)}</span>;
    case "incomplete-subtotal":
      return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="tabular-figures">{countFormat.format(count)}</span>
          <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "incomplete-subtotal")} />
        </span>
      );
    case "unknown":
    case "withheld":
    case "unavailable":
      return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, state)} />;
    default:
      return assertNever(state, "Unhandled value state");
  }
}

/** The base a count is measured against, in words. */
function DenominatorFigure({ measured }: { readonly measured: MeasuredCount }): ReactElement {
  if (!Number.isFinite(measured.denominator) || measured.denominator <= 0) {
    return <span className="text-pretty text-muted-foreground">{RESULTS_COPY.denominatorMissingNote}</span>;
  }
  return (
    <span className="break-words">
      <span className="tabular-figures">{countFormat.format(measured.denominator)}</span> {measured.denominatorMeaning}
    </span>
  );
}

/** The share, and only the share the read computed. */
function ShareFigure({ measured }: { readonly measured: MeasuredCount }): ReactElement {
  const share = measured.percentage;
  if (share === undefined || !Number.isFinite(share)) {
    return <span className="text-pretty text-muted-foreground">{RESULTS_COPY.denominatorMissingNote}</span>;
  }
  return <span className="tabular-figures">{shareFormat.format(share)}</span>;
}

/** A response kind as its reader's word, with the sentence that says what the word covers. */
function KindFigure({ kind }: { readonly kind: RecordedResponseKind }): ReactElement {
  const copy = RESPONSE_KIND_COPY[COPY_KIND_OF_RECORDED_KIND[kind]];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-medium text-pretty break-words">{copy.label}</span>
      <span className="text-xs text-pretty text-muted-foreground">{copy.description}</span>
    </div>
  );
}

// The one table pattern, configured twice
function responseKindColumns(valueStates: ValueStates, showsShare: boolean): ReadonlyArray<RecordListColumnDef<ResponseKindRow>> {
  const columns: RecordListColumnDef<ResponseKindRow>[] = [
    {
      id: "kind",
      header: RESULTS_COPY.kindColumnLabel,
      // The read states the kinds in a fixed order, so no column offers a sort the service would ignore.
      enableSorting: false,
      // The kind is what the row is about; hiding it would leave a row of figures naming nothing.
      enableHiding: false,
      cell: ({ row }) => <KindFigure kind={row.original.kind} />,
    },
    { id: "count", header: RESULTS_COPY.countColumnLabel, enableSorting: false, cell: ({ row }) => <CountFigure count={row.original.count} state={statedState(valueStates, countStatePath(row.original.kind))} /> },
    { id: "denominator", header: RESULTS_COPY.denominatorLabel, enableSorting: false, cell: ({ row }) => <DenominatorFigure measured={row.original} /> },
  ];
  // A share column exists only where the read computed a share: an always-present empty column would
  // claim the source was asked and answered nothing.
  if (showsShare) {
    columns.push({ id: "share", header: RESULTS_COPY.shareColumnLabel, enableSorting: false, cell: ({ row }) => <ShareFigure measured={row.original} /> });
  }
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

function responseKindRowId(row: ResponseKindRow): string {
  return row.kind;
}

function termsVersionRowId(row: TermsVersionRow): string {
  return row.termsVersion;
}

// The narrow composition
interface KindListProps {
  readonly rows: readonly ResponseKindRow[];
  readonly valueStates: ValueStates;
  readonly showsShare: boolean;
  readonly label: string;
}

/** The reading order a phone can actually show: kind word, the count, the base it is counted against and — where the read computed one — the share, with no table and no horizontal scroll. */
function KindList({ rows, valueStates, showsShare, label }: KindListProps): ReactElement {
  return (
    <div data-slot="initiative-results-kinds" className="min-w-0 md:hidden">
      <ul aria-label={label} className="flex min-w-0 flex-col gap-4">
        {rows.map((row) => (
          <li key={row.kind} className="flex min-w-0 flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0">
            <KindFigure kind={row.kind} />
            <dl className="flex min-w-0 flex-col gap-1 text-sm">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <dt className="text-muted-foreground">{RESULTS_COPY.countColumnLabel}</dt>
                <dd className="min-w-0 break-words">
                  <CountFigure count={row.count} state={statedState(valueStates, countStatePath(row.kind))} />
                </dd>
              </div>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <dt className="text-muted-foreground">{RESULTS_COPY.denominatorLabel}</dt>
                <dd className="min-w-0">
                  <DenominatorFigure measured={row} />
                </dd>
              </div>
              {showsShare ? (
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <dt className="text-muted-foreground">{RESULTS_COPY.shareColumnLabel}</dt>
                  <dd className="min-w-0">
                    <ShareFigure measured={row} />
                  </dd>
                </div>
              ) : null}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The surface
interface SurfaceProps {
  readonly headingId: string;
  readonly children: ReactNode;
  readonly className?: string;
}

function Surface({ headingId, children, className }: SurfaceProps): ReactElement {
  return (
    <section aria-labelledby={headingId} data-slot="initiative-results" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <h3 id={headingId} className="font-heading text-base font-medium text-pretty">
        {RESULTS_COPY.heading}
      </h3>
      {children}
    </section>
  );
}

/** What these results are, and the three things they are not: a financial fact, a funnel or a judgement. */
function ResultsStatement(): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm text-pretty text-muted-foreground">
      <p>{SURFACE_COPY.intro}</p>
      <p>{RESPONSE_AGREEMENT_COPY.agreementCreatesNothing}</p>
      <p>{SURFACE_COPY.worthNote}</p>
    </div>
  );
}

interface InitiativeResultsSurfaceProps {
  readonly initiativeId: string;
  /** The page window a composing page controls; absent, the surface reads its own window from the address. */
  readonly queryState?: RecordListQueryState;
  readonly initialEnvelope: ReadEnvelope<ResultsData>;
  readonly onQueryStateChange?: (next: RecordListQueryState) => void;
  readonly className?: string;
}

function InitiativeResultsSurface({ initiativeId, queryState: controlledState, initialEnvelope, onQueryStateChange, className }: InitiativeResultsSurfaceProps): ReactElement {
  const headingId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The address is where this surface's page window lives when no caller states one, so a reload, a
  // return from a Request and the browser's Back button all show the window the reader left rather than
  // the first one.
  const stated = useMemo<InitiativeResultsQuery>(() => parseInitiativeResultsQuery(searchParams), [searchParams]);
  const page = controlledState === undefined ? stated.page : controlledState.page;
  const pageSize = controlledState === undefined ? stated.pageSize : controlledState.pageSize;
  // Column visibility is presentation and stays in this component, as the preset's other lists keep it.
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(controlledState === undefined ? NO_COLUMNS_HIDDEN : controlledState.columnVisibility);
  const listQueryState = useMemo<RecordListQueryState>(() => ({ sort: NO_SORT, page, pageSize, columnVisibility }), [page, pageSize, columnVisibility]);
  // The read seeds from the envelope the Server Component already answered with, so it paints from
  // that authority instead of asking the same question again; this wrapper is the hook's own member
  // shape, not a second copy of the answer.
  const seeded = useMemo<InitiativeResultsEnvelope<ResultsData>>(() => ({ kind: "envelope", envelope: initialEnvelope }), [initialEnvelope]);
  const read = useInitiativeResults<ResultsData>(initiativeId, listQueryState, seeded);
  const result = read.status === "ready" ? read.result : undefined;
  const envelope = result !== undefined && result.kind === "envelope" ? result.envelope : undefined;
  const kindRows: readonly ResponseKindRow[] = envelope === undefined ? NO_RESPONSE_KINDS : envelope.data.responseKinds;
  const termsRows: readonly TermsVersionRow[] = envelope === undefined ? NO_TERMS_VERSIONS : envelope.data.termsVersions;
  const valueStates: ValueStates = envelope === undefined ? NO_VALUE_STATES : envelope.valueStates;
  const showsShare = kindRows.some((row) => row.percentage !== undefined);
  const kindColumns = useMemo<ReadonlyArray<RecordListColumnDef<ResponseKindRow>>>(() => responseKindColumns(valueStates, showsShare), [valueStates, showsShare]);
  const termsColumns = useMemo<ReadonlyArray<RecordListColumnDef<TermsVersionRow>>>(() => termsVersionColumns(valueStates), [valueStates]);
  // The window is written beside every other parameter the page carries — the initiative this section
  // belongs to among them — so the address still states what the page is about.
  const writeWindow = useCallback(
    (nextPage: number, nextPageSize: number): void => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of toInitiativeResultsParams({ page: nextPage, pageSize: nextPageSize })) {
        params.set(key, value);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  // The read answers whole-initiative counts, so the rows it returns are the whole result. A page the
  // address states past the last one those rows occupy would show an empty table over a populated
  // result, so the window is corrected to the last page that exists rather than left blank.
  const lastPage = Math.max(FIRST_PAGE, Math.ceil(Math.max(kindRows.length, termsRows.length) / pageSize));
  useEffect(() => {
    if (controlledState !== undefined || page <= lastPage) {
      return;
    }
    writeWindow(lastPage, pageSize);
  }, [controlledState, lastPage, page, pageSize, writeWindow]);
  function handleQueryStateChange(next: RecordListQueryState): void {
    if (next.columnVisibility !== columnVisibility) {
      setColumnVisibility(next.columnVisibility);
    }
    if (next.page === page && next.pageSize === pageSize) {
      return;
    }
    // The pager's window reaches the address, so the continuity the list surfaces keep holds here too.
    writeWindow(next.page, next.pageSize);
    // A caller that controls the window still receives the change, so it keeps holding its own copy.
    onQueryStateChange?.({ sort: NO_SORT, page: next.page, pageSize: next.pageSize, columnVisibility });
  }
  if (result === undefined) {
    // The first answer is still awaited: a busy surface, never an empty one and never a zero.
    return (
      <Surface headingId={headingId} className={className}>
        <StateNotice kind="loading" title={SURFACE_COPY.readingTitle} description={SURFACE_COPY.readingDescription} loadingLines={7} />
      </Surface>
    );
  }
  if (result.kind === "denied") {
    // No count, no title, no kind and no empty table: the answer is the same whether or not this
    // initiative has requests, so nothing about them is revealed.
    return (
      <Surface headingId={headingId} className={className}>
        <StateNotice kind="denied" headingLevel={4} title={STATE_NOTICE_COPY.denied.title} description={STATE_NOTICE_COPY.denied.body} reasonCode={result.denied.reasonCode} />
      </Surface>
    );
  }
  if (result.kind === "unavailable") {
    // The source identity and the read's own guidance replace the figures: nothing stands in for them.
    return (
      <Surface headingId={headingId} className={className}>
        <StateNotice kind="unavailable" headingLevel={4} title={STATE_NOTICE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} />
      </Surface>
    );
  }
  if (result.kind === "refused") {
    // The working list this surface asked for is not one the read admits: the refusal names the field to
    // correct, and the initiative's Requests answered rather than becoming unavailable.
    return (
      <Surface headingId={headingId} className={className}>
        <StateNotice kind="refused" headingLevel={4} title={STATE_NOTICE_COPY.refused.title} description={refusalSummary(result.refused)} />
      </Surface>
    );
  }
  const results = result.envelope.data;
  const { coverage, asOf } = result.envelope;
  // Every count in this read is measured against the Requests recorded for this initiative, so the
  // read's own base is what says whether any Request exists to report on at all. With none, the seven
  // kinds still render — each stating that no base was supplied, so no share exists — and the empty
  // notice above them offers the real first action instead of leaving the reader with bare zeroes.
  const requestBase = results.requests.presented.denominator;
  const hasRequests = Number.isFinite(requestBase) && requestBase > 0;
  const coverageText = coverageSentence(coverage);
  const kindsLabel = `${RESULTS_COPY.heading} for ${results.initiative.name}, ${SURFACE_COPY.kindsLabelSuffix}: ${coverageText}`;
  return (
    <Surface headingId={headingId} className={className}>
      <ResultsStatement />
      <p className="text-xs text-pretty text-muted-foreground">
        {"As of "}
        <bdi>
          <time className="tabular-figures" dateTime={asOf}>
            {asOf}
          </time>
        </bdi>
        {` · ${coverageText}`}
      </p>
      {hasRequests ? (
        results.requests.answered.count === 0 ? (
          <p className="text-sm text-pretty">{RESULTS_COPY.noResultsNote}</p>
        ) : null
      ) : (
        <StateNotice kind="empty" headingLevel={4} title={`${RESULTS_COPY.heading}: ${results.initiative.name}`} description={RESULTS_COPY.noResultsNote} action={{ label: SURFACE_COPY.emptyAction, href: `${initiativeHref(initiativeId)}#requests` }} />
      )}
      {/*
        Two compositions of one answer with opposite responsive display utilities, so `display: none`
        removes the other from the accessibility tree: a reader meets the table or the labelled
        sequence, never both and never neither (WCAG 1.3.1, 1.4.10).
      */}
      <div className="hidden min-w-0 md:block">
        <RecordList label={kindsLabel} columns={kindColumns} rows={kindRows} rowCount={kindRows.length} queryState={listQueryState} onQueryStateChange={handleQueryStateChange} getRowId={responseKindRowId} itemNoun="response kinds" />
      </div>
      <KindList rows={kindRows} valueStates={valueStates} showsShare={showsShare} label={kindsLabel} />
      {termsRows.length === 0 ? null : (
        <div data-slot="initiative-results-terms" className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h4 className="text-sm font-semibold">{SURFACE_COPY.termsHeading}</h4>
            <p className="text-sm text-pretty text-muted-foreground">{RESPONSE_AGREEMENT_COPY.bindsToTermsVersion}</p>
          </div>
          <RecordList label={`${RESULTS_COPY.heading} for ${results.initiative.name}: ${SURFACE_COPY.termsHeading}`} columns={termsColumns} rows={termsRows} rowCount={termsRows.length} queryState={listQueryState} onQueryStateChange={handleQueryStateChange} getRowId={termsVersionRowId} itemNoun="terms versions" />
        </div>
      )}
    </Surface>
  );
}

/** Props of {@link InitiativeResults}. */
export interface InitiativeResultsProps {
  readonly initiativeId: string;
  /** The page window a composing page controls, in the preset's own query-state shape. */
  readonly queryState?: RecordListQueryState;
  /** The envelope the Server Component already read, and the authority the browser read re-requests under. */
  readonly initialEnvelope?: ReadEnvelope<ResultsData>;
  /** Receives every window or column change as well, for a caller that keeps its own copy of the state. */
  readonly onQueryStateChange?: (next: RecordListQueryState) => void;
  readonly className?: string;
}

/** The initiative results surface. */
export default function InitiativeResults({ initiativeId, queryState, initialEnvelope, onQueryStateChange, className }: InitiativeResultsProps): ReactElement {
  const headingId = useId();
  if (initialEnvelope === undefined) {
    return (
      <Surface headingId={headingId} className={className}>
        <StateNotice kind="loading" title={SURFACE_COPY.readingTitle} description={SURFACE_COPY.readingDescription} loadingLines={7} />
      </Surface>
    );
  }
  return <InitiativeResultsSurface initiativeId={initiativeId} queryState={queryState} initialEnvelope={initialEnvelope} onQueryStateChange={onQueryStateChange} className={className} />;
}
