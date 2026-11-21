"use client";
/** The initiative list: one page of the initiatives the admitted ministry lets this worker read, with the whole of its view state — the search text, the state filter, the order, the page window and the hidden columns — held in the address, so a visit to one initiative returns to the view it was opened from. */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { QueryToolbar, type FacetSpec } from "@/components/query-toolbar";
import { RecordList, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { refusalSummary } from "@/components/form-field";
import { StateNotice, type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { ValueState, reads } from "@/modules/data-service";
import { PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT } from "@/modules/support/report";
import { CLOSURE_COPY, INITIATIVE_COPY, INITIATIVE_STATES, INITIATIVE_STATE_COPY, MEMBERSHIP_STATES, MEMBERSHIP_STATE_COPY, REQUESTED_TERMS_COPY, STATE_NOTICE_COPY, type InitiativeState } from "../copy";
import { useInitiatives, type InitiativesEnvelope, type InitiativesFilters } from "../hooks/use-initiatives";
import InitiativeComposer from "./initiative-composer";

// The contract: the list read's own types, narrowed to the fields this surface renders
type InitiativeListEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiatives>>, { readonly kind: "envelope" }>["envelope"];

/** One page of the initiative list, exactly as the read states it: the rows, the whole-result total and the window they came from. */
export type InitiativeListPage = InitiativeListEnvelope["data"];

/** One initiative as the list states it. */
export type InitiativeRow = InitiativeListPage["items"][number];

/** The column-visibility slice the record list preset controls, named from its own query state. */
type ColumnVisibility = RecordListQueryState["columnVisibility"];

type ValueStates = Readonly<Record<string, ValueState>>;

// The three orders the read admits, and the state filter's own word for "either"
/** The orders `readInitiatives` admits, in the order this surface offers them. */
const INITIATIVE_ORDERS = ["name", "period-start", "state"] as const;

/** One order the list may be presented in. The read owns the direction of each, so no direction travels. */
export type InitiativeOrder = (typeof INITIATIVE_ORDERS)[number];

/** The one state filter value that states no filter: either of the read's two states. */
const STATE_ALL = "all";

/** The state filter a view may state: one of the read's two states, or either of them. */
export type InitiativeStateFilter = InitiativeState | typeof STATE_ALL;

const DEFAULT_ORDER: InitiativeOrder = "name";

const FIRST_PAGE = 1;

/** The columns a reader may hide: the name column carries the row's link, so it is never one of them. */
const HIDEABLE_COLUMN_IDS = ["purpose", "responsible", "period", "state", "members"] as const;

const PAGE_SIZE_OPTIONS: readonly number[] = [PAGE_SIZE_DEFAULT, PAGE_SIZE_CAP];

const NO_SORT: RecordListQueryState["sort"] = [];

const NO_VALUE_STATES: ValueStates = {};

const NO_ROWS: InitiativeListPage["items"] = [];

// The one address a row opens, and the actions a read may publish
/** Where an initiative's own record lives, so a row's visit carries the list state with it. */
const DETAILS_PATH = "/partners/initiatives";
/** The one action the list's read publishes for the entry point this surface offers. */
const CREATE_INITIATIVE = "createInitiative";
/** The two facets this surface states: the read's state filter and the read's own orders. */
const STATE_FACET = "state";

const ORDER_FACET = "order";

// The URL grammar
/** The parameters the view state travels as. */
const PARAM = { search: "search", state: "state", sort: "sort", page: "page", pageSize: "pageSize", hidden: "hidden" } as const;

const HIDDEN_SEPARATOR = ",";

const WHOLE_NUMBER = /^\d+$/u;

/** Everything the list's view states: the search text, the state filter, the order, the page window and the columns a reader has hidden. */
export interface InitiativesViewState {
  /** The whole-dataset search the read applies to an initiative's name and purpose; empty asks for nothing. */
  readonly search: string;
  /** The state filter the read applies, or `all` for both states. */
  readonly state: InitiativeStateFilter;
  /** The column whose order the read states; the read applies each order in its own direction. */
  readonly sort: InitiativeOrder;
  /** The page the read states, counted from one as the read counts it. */
  readonly page: number;
  /** The rows a page holds: the default fifty or the admitted cap. */
  readonly pageSize: number;
  /** The columns the reader has hidden, in the preset's own shape. */
  readonly columnVisibility: ColumnVisibility;
}
function isInitiativeState(value: string | null): value is InitiativeState {
  return value !== null && INITIATIVE_STATES.some((admitted) => admitted === value);
}
function isInitiativeOrder(value: string | null): value is InitiativeOrder {
  return value !== null && INITIATIVE_ORDERS.some((admitted) => admitted === value);
}
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
/** The columns a view has hidden, in the order they are written, so the same view always writes one string. */
function hiddenColumnIds(visibility: ColumnVisibility): readonly string[] {
  return HIDEABLE_COLUMN_IDS.filter((id) => visibility[id] === false);
}
function columnVisibilityOf(value: string | null): ColumnVisibility {
  const visibility: ColumnVisibility = {};
  if (value === null) {
    return visibility;
  }
  for (const stated of value.split(HIDDEN_SEPARATOR)) {
    if (HIDEABLE_COLUMN_IDS.some((admitted) => admitted === stated)) {
      visibility[stated] = false;
    }
  }
  return visibility;
}
/** Writes the view state as URL parameters. */
export function toInitiativesParams(state: InitiativesViewState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search !== "") {
    params.set(PARAM.search, state.search);
  }
  if (state.state !== STATE_ALL) {
    params.set(PARAM.state, state.state);
  }
  if (state.sort !== DEFAULT_ORDER) {
    params.set(PARAM.sort, state.sort);
  }
  params.set(PARAM.page, String(pageNumberOf(state.page)));
  params.set(PARAM.pageSize, String(pageSizeNumberOf(state.pageSize)));
  const hidden = hiddenColumnIds(state.columnVisibility);
  if (hidden.length > 0) {
    params.set(PARAM.hidden, hidden.join(HIDDEN_SEPARATOR));
  }
  return params;
}
/** Reads the view state back from an address, applying the same rules the writer applies so a round trip returns an equal view. */
export function parseInitiativesQuery(source: URLSearchParams | string): InitiativesViewState {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  const statedState = params.get(PARAM.state);
  const statedSort = params.get(PARAM.sort);
  return {
    search: params.get(PARAM.search) ?? "",
    state: isInitiativeState(statedState) ? statedState : STATE_ALL,
    sort: isInitiativeOrder(statedSort) ? statedSort : DEFAULT_ORDER,
    page: pageNumberOf(integerOf(params.get(PARAM.page)) ?? FIRST_PAGE),
    pageSize: pageSizeNumberOf(integerOf(params.get(PARAM.pageSize)) ?? PAGE_SIZE_DEFAULT),
    columnVisibility: columnVisibilityOf(params.get(PARAM.hidden)),
  };
}
// Wording this surface alone states
/** The order labels, in the read's own terms: each names the column and the direction the read applies. */
const ORDER_VALUE_COPY: Readonly<Record<InitiativeOrder, string>> = { name: "Name, A to Z", "period-start": "Period start, earliest first", state: "State, open first" };

/** `../copy.ts` owns the family's shared vocabulary — the two states, the three membership states and the notices — and the wording particular to this list is named once here rather than repeated at each use. */
const SURFACE_COPY = {
  intro: "Every initiative you may read in this ministry, filtered and paged over the whole result rather than over the rows on screen.",
  tableLabel: "Initiatives, one page of the whole authorised result",
  itemNoun: "initiatives",
  filtersLabel: "Initiative filters",
  searchPlaceholder: "Search name or purpose",
  stateFilterLabel: "State",
  orderLabel: "Order",
  stateColumnLabel: "State",
  membersColumnLabel: "Working list",
  reopenedLabel: "Reopened",
  createEffectNote: "Creating an initiative records one initiative. It sends no message, presents no Request, adds nobody to a working list and creates no gift, pledge, commitment, notice or task.",
  createUnavailableReason: "This read does not offer creating an initiative in the context it was read in.",
  loadingTitle: "Reading the initiatives",
  loadingBody: "The first answer for this view is still arriving, so nothing here is stated as an empty list or as zero.",
} as const;

// Fixed values
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** The row's one link, styled with the shared token utilities so its focus indicator matches the rest. */
const ROW_LINK_CLASS = "flex min-w-0 flex-col gap-0.5 rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const MUTED_TEXT_CLASS = "text-muted-foreground";

// Reading the read
/** The state the read recorded for one field. */
function statedState(valueStates: ValueStates, path: string): ValueState {
  return valueStates[path] ?? "value";
}
function membershipStatePath(initiativeId: string, member: (typeof MEMBERSHIP_STATES)[number]): string {
  return `${initiativeId}.memberStates.${member}`;
}
function periodStatePath(initiativeId: string, end: "from" | "to"): string {
  return `${initiativeId}.period.${end}`;
}
function firstApplied(applied: Readonly<Record<string, readonly string[]>>, facetId: string): string | undefined {
  const values = applied[facetId];
  return values === undefined ? undefined : values[0];
}
function stateFilterOf(value: string | undefined): InitiativeStateFilter {
  return value !== undefined && isInitiativeState(value) ? value : STATE_ALL;
}
function orderOf(value: string | undefined): InitiativeOrder {
  return value !== undefined && isInitiativeOrder(value) ? value : DEFAULT_ORDER;
}
/** How many narrowing choices the view states: the search and the state filter. An order narrows nothing. */
function activeFilterCount(view: InitiativesViewState): number {
  let count = 0;
  if (view.search.trim() !== "") {
    count += 1;
  }
  if (view.state !== STATE_ALL) {
    count += 1;
  }
  return count;
}

// The cells
/** One endpoint of a period, rendered from the state the read recorded for it rather than from its absence. */
function DateEndpoint({ value, state }: { readonly value: string | null; readonly state: ValueState }): ReactElement {
  switch (state) {
    case "value":
      // A date the read marked as a value is the source's own civil date; a null value beside that mark
      // is nothing to print, so the family's word for an unstated date stands in rather than a blank.
      return value === null ? (
        <span className={MUTED_TEXT_CLASS}>{REQUESTED_TERMS_COPY.notStated}</span>
      ) : (
        <bdi>
          <time className="tabular-figures" dateTime={value}>
            {value}
          </time>
        </bdi>
      );
    case "unknown":
      return <span className={MUTED_TEXT_CLASS}>{REQUESTED_TERMS_COPY.notStated}</span>;
    case "zero":
    case "withheld":
    case "unavailable":
    case "incomplete-subtotal":
      return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, state)} />;
    default:
      return assertNever(state, "Unhandled value state");
  }
}
/** The optional period, with each end stated on its own so one stated date is never hidden by the other. */
function PeriodFigure({ initiativeId, period, valueStates }: { readonly initiativeId: string; readonly period: InitiativeRow["period"]; readonly valueStates: ValueStates }): ReactElement {
  const from = period === null ? null : period.from;
  const to = period === null ? null : period.to;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <DateEndpoint value={from} state={statedState(valueStates, periodStatePath(initiativeId, "from"))} />
      {/* The separator is punctuation, so it is left out of the spoken form; the column heading says
          which two ends of one period the reader is hearing. */}
      <span aria-hidden="true">–</span>
      <DateEndpoint value={to} state={statedState(valueStates, periodStatePath(initiativeId, "to"))} />
    </span>
  );
}
/** One count rendered from its own value state: a number only when the read says the number stands, and the state's own word otherwise. */
function CountFigure({ count, state }: { readonly count: number; readonly state: ValueState }): ReactElement {
  if (!Number.isFinite(count)) {
    // A count that is not a number is never printed as one; it is reported as the unknown it is.
    return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "unknown")} />;
  }
  switch (state) {
    case "value":
    case "zero":
      return <span className="tabular-figures">{countFormat.format(count)}</span>;
    case "unknown":
    case "withheld":
    case "unavailable":
    case "incomplete-subtotal":
      return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, state)} />;
    default:
      return assertNever(state, "Unhandled value state");
  }
}
/** The three membership counts of the reviewed working list, each from its own recorded state. */
function MembersFigure({ initiativeId, counts, valueStates }: { readonly initiativeId: string; readonly counts: InitiativeRow["memberStates"]; readonly valueStates: ValueStates }): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
      {MEMBERSHIP_STATES.map((member) => {
        const copy = MEMBERSHIP_STATE_COPY[member];
        const state = statedState(valueStates, membershipStatePath(initiativeId, member));
        return (
          <div key={member} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <dt className="text-muted-foreground">{copy.label}</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1">
              <CountFigure count={counts[member]} state={state} />
              {/* A zero count is a figure; the empty note is what a reader hears for it, so the cell is
                  never a bare symbol and never reads as withheld data. */}
              {state === "zero" ? <span className="sr-only">{copy.emptyNote}</span> : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
/** The initiative's state, with the family's own wording, and the closure history a reopen preserves. */
function StateFigure({ state, lifecycle }: { readonly state: InitiativeState; readonly lifecycle: InitiativeRow["lifecycle"] }): ReactElement {
  const copy = INITIATIVE_STATE_COPY[state];
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <StatusBadge label={copy.label} tone={state === "closed" ? "neutral" : "positive"} />
      <span className="sr-only">{copy.description}</span>
      {lifecycle === "reopened" ? (
        <>
          <StatusBadge label={SURFACE_COPY.reopenedLabel} tone="muted" />
          <span className="text-xs text-pretty text-muted-foreground">{CLOSURE_COPY.historyPreservedNote}</span>
        </>
      ) : null}
    </div>
  );
}

// The surface's own heading, at the level the route composes it
const HEADING_TAG: Readonly<Record<1 | 2, "h1" | "h2">> = { 1: "h1", 2: "h2" };

function Heading({ level, id, children }: { readonly level: 1 | 2; readonly id: string; readonly children: ReactNode }): ReactElement {
  const Tag = HEADING_TAG[level];
  return (
    <Tag id={id} className="font-heading text-2xl font-semibold text-pretty break-words">
      {children}
    </Tag>
  );
}

// Props
/** Props of {@link InitiativeList}. */
export interface InitiativeListProps {
  /** The envelope the Server Component already read for this address. */
  readonly initialEnvelope: InitiativesEnvelope<InitiativeListPage>;
  /** The level of this surface's own heading. */
  readonly headingLevel?: 1 | 2;
  readonly className?: string;
}

/** The initiative list surface: one page of the initiatives this ministry permits, over the URL's query state, with the composer for a new initiative gated on the action its read publishes. */
export default function InitiativeList({ initialEnvelope, headingLevel = 2, className }: InitiativeListProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const headingId = useId();
  const [composerOpen, setComposerOpen] = useState(false);
  const noticeHeadingLevel: NoticeHeadingLevel = headingLevel === 1 ? 2 : 3;
  // The URL is the query state: a search, a filter, an order, a page, a size or a hidden column all
  // arrive as the same string, and no local copy of them is kept beside it.
  const view = useMemo<InitiativesViewState>(() => parseInitiativesQuery(searchParams), [searchParams]);
  // The latest view this surface dispatched, so two changes raised in one event compose into one view
  // instead of the second overwriting the first from a stale render.
  const latestView = useRef<InitiativesViewState>(view);
  useEffect(() => {
    latestView.current = view;
  }, [view]);
  const commit = useCallback(
    (next: InitiativesViewState) => {
      latestView.current = next;
      router.replace(`${pathname}?${toInitiativesParams(next).toString()}`, { scroll: false });
    },
    [pathname, router],
  );
  const filters = useMemo<InitiativesFilters>(() => ({ ...(view.search === "" ? {} : { search: view.search }), ...(view.state === STATE_ALL ? {} : { state: view.state }) }), [view.search, view.state]);
  // The preset's query state, stated from the view: the read applies one order at a time and owns the
  // direction of each, so the leading entry carries the order and no descending request is invented.
  const listQueryState = useMemo<RecordListQueryState>(() => ({ sort: view.sort === DEFAULT_ORDER ? NO_SORT : [{ id: view.sort, desc: false }], page: view.page, pageSize: view.pageSize, columnVisibility: view.columnVisibility }), [view]);
  const read = useInitiatives<InitiativeListPage>(listQueryState, initialEnvelope, filters);
  const result = read.status === "ready" ? read.result : undefined;
  const envelope = result !== undefined && result.kind === "envelope" ? result.envelope : undefined;
  const page = envelope === undefined ? undefined : envelope.data;
  const rows = page === undefined ? NO_ROWS : page.items;
  const valueStates = envelope === undefined ? NO_VALUE_STATES : envelope.valueStates;
  const total = page === undefined ? 0 : page.total;
  const activeFilters = activeFilterCount(view);
  const createAction = (envelope ?? initialEnvelope.envelope).actions.find((action) => action.name === CREATE_INITIATIVE);
  // The entry point appears only where the current answer admits the action. A read that states it
  // unavailable, or that does not state it at all, is answered with the reason the read gives rather than
  // with a control whose only outcome could be a denial, and a denied, unavailable or refused read states
  // its reason in the notice that replaces the table, so the header adds none of its own.
  const readAnswersWithEnvelope = result === undefined || result.kind === "envelope";
  const offersCreate = readAnswersWithEnvelope && createAction?.available === true;
  const createUnavailableReason = !readAnswersWithEnvelope || offersCreate ? null : (createAction?.reason?.trim() ?? SURFACE_COPY.createUnavailableReason);
  // A page the address states past the last page the read's answer holds — a hand-edited URL, or a
  // result that shrank under the same address — is corrected to the last page that exists, so the pager
  // and the rows always describe the same window. The page count is the read's own total, never a count
  // taken from the page on screen.
  useEffect(() => {
    if (page === undefined || page.total <= 0) {
      return;
    }
    const lastPage = Math.max(FIRST_PAGE, Math.ceil(page.total / view.pageSize));
    if (view.page <= lastPage) {
      return;
    }
    commit({ ...view, page: lastPage });
  }, [commit, page, view]);
  const facets = useMemo<readonly FacetSpec[]>(
    () => [
      { id: STATE_FACET, label: SURFACE_COPY.stateFilterLabel, multi: false, values: INITIATIVE_STATES.map((state) => ({ id: state, label: INITIATIVE_STATE_COPY[state].label })) },
      { id: ORDER_FACET, label: SURFACE_COPY.orderLabel, multi: false, values: INITIATIVE_ORDERS.map((order) => ({ id: order, label: ORDER_VALUE_COPY[order] })) },
    ],
    [],
  );
  // The choices the toolbar shows as applied, so its pickers and its chips describe the view actually
  // read: a default order and the both-states filter are the read's own behaviour, so neither is a
  // stated choice and neither shows as one.
  const applied = useMemo<Readonly<Record<string, readonly string[]>>>(() => {
    const stated: Record<string, readonly string[]> = {};
    if (view.state !== STATE_ALL) {
      stated[STATE_FACET] = [view.state];
    }
    if (view.sort !== DEFAULT_ORDER) {
      stated[ORDER_FACET] = [view.sort];
    }
    return stated;
  }, [view.sort, view.state]);
  // Built once per read and view, because the table preset rebuilds its column instances whenever the
  // column array's identity changes, and because a row's link carries the address it was read under.
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<InitiativeRow>>>(() => {
    const queryString = toInitiativesParams(view).toString();
    const hrefOf = (initiativeId: string): string => `${DETAILS_PATH}/${encodeURIComponent(initiativeId)}?${queryString}`;
    return [
      {
        id: "name",
        header: INITIATIVE_COPY.nameLabel,
        // The read states the order of this list, so no column offers a sort the service would ignore.
        enableSorting: false,
        // The row's name carries its link, so hiding it would leave a row of figures naming nothing.
        enableHiding: false,
        cell: ({ row }) => (
          <Link href={hrefOf(row.original.initiativeId)} className={ROW_LINK_CLASS}>
            <span className="text-pretty break-words">{row.original.name}</span>
            <bdi className="mono-identifier text-xs break-all">{row.original.initiativeId}</bdi>
          </Link>
        ),
      },
      { id: "purpose", header: INITIATIVE_COPY.purposeLabel, enableSorting: false, cell: ({ row }) => <span className="text-pretty break-words">{row.original.purpose}</span> },
      { id: "responsible", header: INITIATIVE_COPY.responsibleLabel, enableSorting: false, cell: ({ row }) => <bdi className="mono-identifier break-all">{row.original.responsiblePrincipalId}</bdi> },
      { id: "period", header: INITIATIVE_COPY.periodLabel, enableSorting: false, cell: ({ row }) => <PeriodFigure initiativeId={row.original.initiativeId} period={row.original.period} valueStates={valueStates} /> },
      { id: "state", header: SURFACE_COPY.stateColumnLabel, enableSorting: false, cell: ({ row }) => <StateFigure state={row.original.state} lifecycle={row.original.lifecycle} /> },
      { id: "members", header: SURFACE_COPY.membersColumnLabel, enableSorting: false, cell: ({ row }) => <MembersFigure initiativeId={row.original.initiativeId} counts={row.original.memberStates} valueStates={valueStates} /> },
    ];
  }, [valueStates, view]);
  const handleSearchChange = useCallback(
    (value: string) => {
      commit({ ...latestView.current, search: value, page: FIRST_PAGE });
    },
    [commit],
  );
  // A narrowed result has a different first page, so a filter, an order or a cleared search returns to it.
  const handleAppliedChange = useCallback(
    (next: Readonly<Record<string, readonly string[]>>) => {
      commit({ ...latestView.current, state: stateFilterOf(firstApplied(next, STATE_FACET)), sort: orderOf(firstApplied(next, ORDER_FACET)), page: FIRST_PAGE });
    },
    [commit],
  );
  const handleClearFilters = useCallback(() => {
    commit({ ...latestView.current, search: "", state: STATE_ALL, page: FIRST_PAGE });
  }, [commit]);
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState) => {
      const [first] = next.sort;
      commit({ ...latestView.current, ...(first === undefined || !isInitiativeOrder(first.id) ? {} : { sort: first.id }), page: pageNumberOf(next.page), pageSize: pageSizeNumberOf(next.pageSize), columnVisibility: next.columnVisibility });
    },
    [commit],
  );
  const openComposer = useCallback(() => {
    setComposerOpen(true);
  }, []);
  // The initiative that was created is opened at its own record, and the address it is opened with is
  // the list state the worker was reading, so returning to the list restores that view.
  const openCreated = useCallback(
    (initiativeId: string) => {
      setComposerOpen(false);
      router.push(`${DETAILS_PATH}/${encodeURIComponent(initiativeId)}?${toInitiativesParams(latestView.current).toString()}`);
    },
    [router],
  );
  let content: ReactElement;
  if (read.status === "loading") {
    // The first answer for this view is still arriving: a busy surface, never an empty list and never a
    // zero, and never another view's page presented as this one's answer.
    content = <StateNotice kind="loading" headingLevel={noticeHeadingLevel} title={SURFACE_COPY.loadingTitle} description={SURFACE_COPY.loadingBody} loadingLines={6} />;
  } else if (result !== undefined && result.kind === "denied") {
    // A denial states no count, name or size: the answer is the same whether or not anything exists in
    // the scope this session may not read.
    content = <StateNotice kind="denied" headingLevel={noticeHeadingLevel} title={STATE_NOTICE_COPY.denied.title} description={STATE_NOTICE_COPY.denied.body} reasonCode={result.denied.reasonCode} />;
  } else if (result !== undefined && result.kind === "unavailable") {
    // The source identity and the read's own guidance replace every figure: an unavailable source is
    // never rendered as an empty list or as zero.
    content = <StateNotice kind="unavailable" headingLevel={noticeHeadingLevel} title={STATE_NOTICE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} />;
  } else if (result !== undefined && result.kind === "refused") {
    // The read refused the request this view sent — an unadmitted window or filter — which is neither a
    // denial nor an outage: the refusal names the field to correct, and no figure stands in its place.
    content = <StateNotice kind="refused" headingLevel={noticeHeadingLevel} title={STATE_NOTICE_COPY.refused.title} description={refusalSummary(result.refused)} />;
  } else if (page !== undefined && total === 0 && activeFilters === 0) {
    // An empty collection offers its real first action; a create action the read states as unavailable is
    // answered with that reason instead of a control.
    content = (
      <StateNotice
        kind="empty"
        headingLevel={noticeHeadingLevel}
        title={INITIATIVE_COPY.listEmptyTitle}
        description={createUnavailableReason === null ? INITIATIVE_COPY.listEmptyBody : `${INITIATIVE_COPY.listEmptyBody} ${createUnavailableReason}`}
        {...(offersCreate ? { action: { label: INITIATIVE_COPY.createLabel, onClick: openComposer } } : {})}
      />
    );
  } else {
    // A result narrowed to nothing is not an empty collection, so the preset's filtered-empty notice and
    // its Clear filters command stand in for the family's empty state.
    content = (
      <RecordList
        label={SURFACE_COPY.tableLabel}
        columns={columns}
        rows={rows}
        // The whole result, never the page on screen: the pager states what the read counted.
        rowCount={total}
        queryState={listQueryState}
        onQueryStateChange={handleQueryStateChange}
        getRowId={(row) => row.initiativeId}
        itemNoun={SURFACE_COPY.itemNoun}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        hasActiveFilters={activeFilters > 0}
        onClearFilters={handleClearFilters}
      />
    );
  }
  return (
    <div data-slot="initiative-list" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading level={headingLevel} id={headingId}>
            {INITIATIVE_COPY.listHeading}
          </Heading>
          <p className="text-sm text-pretty text-muted-foreground">{SURFACE_COPY.intro}</p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1">
          {offersCreate ? (
            <Button type="button" onClick={openComposer} className="h-auto max-w-full whitespace-normal">
              {INITIATIVE_COPY.createLabel}
            </Button>
          ) : null}
          {offersCreate || createUnavailableReason !== null ? <p className="text-xs text-pretty text-muted-foreground">{createUnavailableReason ?? SURFACE_COPY.createEffectNote}</p> : null}
        </div>
      </div>
      <QueryToolbar label={SURFACE_COPY.filtersLabel} search={{ value: view.search, onChange: handleSearchChange, placeholder: SURFACE_COPY.searchPlaceholder }} facets={facets} applied={applied} onAppliedChange={handleAppliedChange} pending={read.isFetching} />
      <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
        {content}
      </section>
      <InitiativeComposer open={composerOpen} onOpenChange={setComposerOpen} envelope={envelope ?? initialEnvelope.envelope} onCreated={openCreated} />
    </div>
  );
}
