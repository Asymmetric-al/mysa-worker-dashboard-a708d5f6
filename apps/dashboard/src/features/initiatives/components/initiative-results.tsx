"use client";
/**
 * One initiative's results: what the named respondents actually answered, stated as the count the
 * read supplied over the base that count is measured against, in words.
 *
 * **Why nothing is divided here.** AAP 0.8.3 requires every result to state its denominator and
 * requires a missing denominator to produce no share at all. The read already decides that: it omits
 * `percentage` entirely when the base is zero or absent, so this surface states the base beside each
 * count and renders the read's own figure only when the read computed one. A base of nothing can
 * therefore never become `0%`, `NaN` or `Infinity`, and the missing-denominator wording is used
 * instead of a dash that would read as zero.
 *
 * **What this surface refuses to say.** The seven response kinds stay separate — `unanswered` and
 * `needs clarification` are recorded answers about the evidence, not non-responses to be folded
 * away — so no total, share, funnel, ranking or trend is derived from them, and no currency, amount
 * or commitment appears anywhere: a recorded response is an answer, not a pledge, gift, subscription,
 * notice or task.
 *
 * **Layering.** This component composes the family's copy and its one read hook with the shared
 * table, notice and status patterns; it reads nothing itself, calls no transport and formats no
 * figure the service did not compute.
 */
import { useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { RecordList, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS, type StatusBadgeSpec } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { Coverage, ReadEnvelope, ValueState, reads } from "@/modules/data-service";
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
/**
 * The read names the kinds with the stored vocabulary (`needs-clarification`) while this family names
 * the same kinds for readers (`needs clarification`), so one exhaustive map joins them. A kind added
 * to either side stops compiling here rather than reaching a reader as an unnamed row.
 */
const COPY_KIND_OF_RECORDED_KIND: Readonly<Record<RecordedResponseKind, ResponseKind>> = {
  agreed: "agreed",
  conditional: "conditional",
  partial: "partial",
  deferred: "deferred",
  declined: "declined",
  unanswered: "unanswered",
  "needs-clarification": "needs clarification",
};

/** The two states a terms version can hold on this surface; a version is never silently current. */
const TERMS_VERSION_STATE: Readonly<Record<TermsVersionRow["state"], StatusBadgeSpec>> = {
  current: { label: "Current terms version", tone: "info" },
  superseded: { label: "Superseded by a later version", tone: "muted" },
};

// Wording this surface alone states
/**
 * `../copy.ts` owns the family's shared vocabulary — the response kinds, the denominator wording and
 * the statements that a recorded response creates nothing — and the wording particular to the results
 * section is named once here rather than repeated across the table, the narrow list and the notices.
 */
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

// Reading the read
/**
 * The state the read recorded for one field. Every count this read answers is marked by the service,
 * so a path it did not mark carries no special state and the number it supplied is rendered as itself.
 */
function statedState(valueStates: ValueStates, path: string): ValueState {
  return valueStates[path] ?? "value";
}

function countStatePath(kind: RecordedResponseKind): string {
  return `responseKinds.${kind}.count`;
}

function termsStatePath(termsVersion: string, member: "requestsReferencing" | "responses.count"): string {
  return `termsVersions.${termsVersion}.${member}`;
}

/**
 * The period the counts cover, in words, so a reader of the table or of its accessible name knows what
 * span the figures describe rather than assuming they cover all of history.
 */
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
/**
 * A count rendered from its own value state: a plain number only when the read says the number stands
 * as it is, an incompleteness beside the figure when the period behind it is only partly covered, and
 * the state's own word — never a number — when the value is not available to show.
 */
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

/**
 * The base a count is measured against, in words. A base of zero — or one the read could not state —
 * is not a base, so the family's missing-denominator wording stands in its place and no share appears
 * beside it.
 */
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

/**
 * The share, and only the share the read computed. When the read carried none — because the base was
 * zero, absent or unusable — the surface states that absence instead of dividing counts by nothing.
 */
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
    {
      id: "count",
      header: RESULTS_COPY.countColumnLabel,
      enableSorting: false,
      cell: ({ row }) => <CountFigure count={row.original.count} state={statedState(valueStates, countStatePath(row.original.kind))} />,
    },
    {
      id: "denominator",
      header: RESULTS_COPY.denominatorLabel,
      enableSorting: false,
      cell: ({ row }) => <DenominatorFigure measured={row.original} />,
    },
  ];
  // A share column exists only where the read computed a share: an always-present empty column would
  // claim the source was asked and answered nothing.
  if (showsShare) {
    columns.push({
      id: "share",
      header: RESULTS_COPY.shareColumnLabel,
      enableSorting: false,
      cell: ({ row }) => <ShareFigure measured={row.original} />,
    });
  }
  return columns;
}

function termsVersionColumns(valueStates: ValueStates): ReadonlyArray<RecordListColumnDef<TermsVersionRow>> {
  return [
    {
      id: "termsVersion",
      header: SURFACE_COPY.termsVersionColumn,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => <bdi className="mono-identifier break-all">{row.original.termsVersion}</bdi>,
    },
    {
      id: "state",
      header: SURFACE_COPY.termsStateColumn,
      enableSorting: false,
      cell: ({ row }) => <StatusBadge {...statusBadgeProps(TERMS_VERSION_STATE, row.original.state)} />,
    },
    {
      id: "referencing",
      header: SURFACE_COPY.termsReferencingColumn,
      enableSorting: false,
      cell: ({ row }) => <CountFigure count={row.original.requestsReferencing} state={statedState(valueStates, termsStatePath(row.original.termsVersion, "requestsReferencing"))} />,
    },
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

/**
 * The reading order a phone can actually show: kind word, the count, the base it is counted against
 * and — where the read computed one — the share, with no table and no horizontal scroll.
 */
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
  readonly queryState: RecordListQueryState;
  readonly initialEnvelope: ReadEnvelope<ResultsData>;
  readonly onQueryStateChange?: (next: RecordListQueryState) => void;
  readonly className?: string;
}

function InitiativeResultsSurface({ initiativeId, queryState, initialEnvelope, onQueryStateChange, className }: InitiativeResultsSurfaceProps): ReactElement {
  const headingId = useId();
  // The read seeds from the envelope the Server Component already answered with, so it paints from
  // that authority instead of asking the same question again; this wrapper is the hook's own member
  // shape, not a second copy of the answer.
  const seeded = useMemo<InitiativeResultsEnvelope<ResultsData>>(() => ({ kind: "envelope", envelope: initialEnvelope }), [initialEnvelope]);
  const read = useInitiativeResults<ResultsData>(initiativeId, queryState, seeded);
  // Column visibility is presentation and stays in this component, as the preset's other lists keep
  // it. This read answers whole-initiative counts rather than a page of rows, so the only state the
  // owner can be asked for is a page or size it controls.
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(queryState.columnVisibility);
  const listQueryState = useMemo<RecordListQueryState>(
    () => ({ sort: NO_SORT, page: queryState.page, pageSize: queryState.pageSize, columnVisibility }),
    [queryState.page, queryState.pageSize, columnVisibility],
  );
  const result = read.status === "ready" ? read.result : undefined;
  const envelope = result !== undefined && result.kind === "envelope" ? result.envelope : undefined;
  const kindRows: readonly ResponseKindRow[] = envelope === undefined ? NO_RESPONSE_KINDS : envelope.data.responseKinds;
  const termsRows: readonly TermsVersionRow[] = envelope === undefined ? NO_TERMS_VERSIONS : envelope.data.termsVersions;
  const valueStates: ValueStates = envelope === undefined ? NO_VALUE_STATES : envelope.valueStates;
  const showsShare = kindRows.some((row) => row.percentage !== undefined);
  const kindColumns = useMemo<ReadonlyArray<RecordListColumnDef<ResponseKindRow>>>(() => responseKindColumns(valueStates, showsShare), [valueStates, showsShare]);
  const termsColumns = useMemo<ReadonlyArray<RecordListColumnDef<TermsVersionRow>>>(() => termsVersionColumns(valueStates), [valueStates]);
  function handleQueryStateChange(next: RecordListQueryState): void {
    if (next.columnVisibility !== columnVisibility) {
      setColumnVisibility(next.columnVisibility);
    }
    // No pager is offered over seven response kinds, so this only ever passes on a change the owner
    // raised itself; a page or size it did not raise is never invented here.
    if ((next.page !== queryState.page || next.pageSize !== queryState.pageSize) && onQueryStateChange !== undefined) {
      onQueryStateChange({ ...queryState, page: next.page, pageSize: next.pageSize });
    }
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
        <StateNotice
          kind="empty"
          headingLevel={4}
          title={`${RESULTS_COPY.heading}: ${results.initiative.name}`}
          description={RESULTS_COPY.noResultsNote}
          action={{ label: SURFACE_COPY.emptyAction, href: `${initiativeHref(initiativeId)}#requests` }}
        />
      )}
      {/*
        Two compositions of one answer with opposite responsive display utilities, so `display: none`
        removes the other from the accessibility tree: a reader meets the table or the labelled
        sequence, never both and never neither (WCAG 1.3.1, 1.4.10).
      */}
      <div className="hidden min-w-0 md:block">
        <RecordList
          label={kindsLabel}
          columns={kindColumns}
          rows={kindRows}
          rowCount={kindRows.length}
          queryState={listQueryState}
          onQueryStateChange={handleQueryStateChange}
          getRowId={responseKindRowId}
          itemNoun="response kinds"
        />
      </div>
      <KindList rows={kindRows} valueStates={valueStates} showsShare={showsShare} label={kindsLabel} />
      {termsRows.length === 0 ? null : (
        <div data-slot="initiative-results-terms" className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h4 className="text-sm font-semibold">{SURFACE_COPY.termsHeading}</h4>
            <p className="text-sm text-pretty text-muted-foreground">{RESPONSE_AGREEMENT_COPY.bindsToTermsVersion}</p>
          </div>
          <RecordList
            label={`${RESULTS_COPY.heading} for ${results.initiative.name}: ${SURFACE_COPY.termsHeading}`}
            columns={termsColumns}
            rows={termsRows}
            rowCount={termsRows.length}
            queryState={listQueryState}
            onQueryStateChange={handleQueryStateChange}
            getRowId={termsVersionRowId}
            itemNoun="terms versions"
          />
        </div>
      )}
    </Surface>
  );
}

/** Props of {@link InitiativeResults}. */
export interface InitiativeResultsProps {
  readonly initiativeId: string;
  /** The list state the page controls; the read keys on it rather than paging, because it answers whole-initiative counts. */
  readonly queryState: RecordListQueryState;
  /**
   * The envelope the Server Component already read, and the authority the browser read re-requests
   * under. The read seeds from it, so a page rendering this surface supplies it; without one there is
   * no scope to read with, and the surface states that the answer has not arrived rather than
   * presenting an empty result.
   */
  readonly initialEnvelope?: ReadEnvelope<ResultsData>;
  readonly onQueryStateChange?: (next: RecordListQueryState) => void;
  readonly className?: string;
}

/**
 * The initiative results surface. Every count it shows came from the read with the base it is counted
 * against, and no figure is divided, summed or ranked here.
 */
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
