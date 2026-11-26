"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { QueryToolbar, type FacetSpec } from "@/components/query-toolbar";
import { RecordList, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { refusalSummary } from "@/components/form-field";
import { StateNotice, type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS } from "@/components/status-badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { ValueState, reads } from "@/modules/data-service";
import { PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT, clampPageSize } from "@/modules/support/report";
import { CLOSURE_COPY, INITIATIVE_COPY, INITIATIVE_STATES, INITIATIVE_STATE_COPY, MEMBERSHIP_STATES, MEMBERSHIP_STATE_COPY, REQUESTED_TERMS_COPY, STATE_NOTICE_COPY, type InitiativeState } from "../copy";
import { useInitiatives, type InitiativesEnvelope, type InitiativesFilters } from "../hooks/use-initiatives";
import { DEFAULT_ORDER, FIRST_PAGE, INITIATIVE_ORDERS, STATE_ALL, isInitiativeOrder, isInitiativeState, pageNumberOf, parseInitiativesQuery, toInitiativesParams, type InitiativeOrder, type InitiativeStateFilter, type InitiativesViewState } from "../query/initiatives-query";
import { CountFigure, statedState } from "./figures";
import InitiativeComposer from "./initiative-composer";
type InitiativeListEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiatives>>, { readonly kind: "envelope" }>["envelope"];
export type InitiativeListPage = InitiativeListEnvelope["data"];
export type InitiativeRow = InitiativeListPage["items"][number];
type ValueStates = Readonly<Record<string, ValueState>>;
// The grammar lives in one non-client module, so the Server Component that asks the service for this view and this surface that asks the route handler for it parse and write one address rather than a copy each. It is re-exported here because this list is where the family's surfaces reach for it.
export { parseInitiativesQuery, toInitiativesParams };
export type { InitiativeOrder, InitiativeStateFilter, InitiativesViewState };
const PAGE_SIZE_OPTIONS: readonly number[] = [PAGE_SIZE_DEFAULT, PAGE_SIZE_CAP];
const NO_SORT: RecordListQueryState["sort"] = [];
const NO_VALUE_STATES: ValueStates = {};
const NO_ROWS: InitiativeListPage["items"] = [];
const DETAILS_PATH = "/partners/initiatives"; // The one address a row opens, and the actions a read may publish
const STATE_FACET = "state";
const ORDER_FACET = "order";
const ORDER_VALUE_COPY: Readonly<Record<InitiativeOrder, string>> = { name: "Name (A–Z)", "period-start": "Start date (earliest first)", state: "Status (open first)" };
const SURFACE_COPY = {
  intro: "Organize support-raising campaigns, working lists of partners, and partnership requests.",
  tableLabel: "Initiatives",
  itemNoun: "initiatives",
  filtersLabel: "Filter initiatives",
  searchPlaceholder: "Search name or purpose…",
  stateFilterLabel: "Status",
  orderLabel: "Sort by",
  stateColumnLabel: "Status",
  membersColumnLabel: "Working list",
  reopenedLabel: "Reopened",
  createEffectNote: "Creates an initiative only — doesn’t add partners, send messages, or create tasks.",
  createUnavailableReason: "You don’t have permission to create initiatives in this ministry.",
  loadingTitle: "Loading initiatives…",
  loadingBody: "Fetching your ministry’s initiatives.",
} as const;
const MUTED_TEXT_CLASS = "text-muted-foreground";
const membershipStatePath = (initiativeId: string, member: (typeof MEMBERSHIP_STATES)[number]): string => `${initiativeId}.memberStates.${member}`;
const periodStatePath = (initiativeId: string, end: "from" | "to"): string => `${initiativeId}.period.${end}`;
const firstApplied = (applied: Readonly<Record<string, readonly string[]>>, facetId: string): string | undefined => applied[facetId]?.[0];
const stateFilterOf = (value: string | undefined): InitiativeStateFilter => (value !== undefined && isInitiativeState(value) ? value : STATE_ALL);
const orderOf = (value: string | undefined): InitiativeOrder => (value !== undefined && isInitiativeOrder(value) ? value : DEFAULT_ORDER);
function DateEndpoint({ value, state }: { readonly value: string | null; readonly state: ValueState }): ReactElement {
  switch (state) {
    case "value":
      return value === null ? (
        <span className={MUTED_TEXT_CLASS}>{REQUESTED_TERMS_COPY.notStated}</span>
      ) : (
        <bdi>
          <time {...{ className: "tabular-figures", dateTime: value }}>{value}</time>
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
function PeriodFigure({ initiativeId, period, valueStates }: { readonly initiativeId: string; readonly period: InitiativeRow["period"]; readonly valueStates: ValueStates }): ReactElement {
  const from = period === null ? null : period.from;
  const to = period === null ? null : period.to;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <DateEndpoint value={from} state={statedState(valueStates, periodStatePath(initiativeId, "from"))} />
      <span aria-hidden="true">–</span>
      <DateEndpoint value={to} state={statedState(valueStates, periodStatePath(initiativeId, "to"))} />
    </span>
  );
}
const MembersFigure = ({ initiativeId, counts, valueStates }: { readonly initiativeId: string; readonly counts: InitiativeRow["memberStates"]; readonly valueStates: ValueStates }): ReactElement => (
  <dl className="flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
    {MEMBERSHIP_STATES.map((member) => {
      const copy = MEMBERSHIP_STATE_COPY[member];
      const state = statedState(valueStates, membershipStatePath(initiativeId, member));
      return (
        <div key={member} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <dt className="text-muted-foreground">{copy.label}</dt>
          <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1">
            <CountFigure count={counts[member]} state={state} />
            {state === "zero" ? <span className="sr-only">{copy.emptyNote}</span> : null}
          </dd>
        </div>
      );
    })}
  </dl>
);
function StateFigure({ state, lifecycle }: { readonly state: InitiativeState; readonly lifecycle: InitiativeRow["lifecycle"] }): ReactElement {
  const copy = INITIATIVE_STATE_COPY[state];
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <StatusBadge label={copy.label} tone={state === "closed" ? "neutral" : "positive"} />
      <span className="sr-only">{copy.description}</span>
      {lifecycle === "reopened" ? (
        <>
          <StatusBadge label={SURFACE_COPY.reopenedLabel} tone="muted" /> <span className="text-xs text-pretty text-muted-foreground">{CLOSURE_COPY.historyPreservedNote}</span>
        </>
      ) : null}
    </div>
  );
}
const HEADING_TAG: Readonly<Record<1 | 2, "h1" | "h2">> = { 1: "h1", 2: "h2" };
const HEADING_SCALE: Readonly<Record<1 | 2, string>> = { 1: "type-page-title", 2: "type-section-title" };
function Heading({ level, id, children }: { readonly level: 1 | 2; readonly id: string; readonly children: ReactNode }): ReactElement {
  const Tag = HEADING_TAG[level];
  return <Tag {...{ id: id, className: cn(HEADING_SCALE[level], "text-pretty break-words") }}>{children}</Tag>;
}
/** The envelope the Server Component already read for this address. · The level of this surface's own heading. */ export type InitiativeListProps = { readonly initialEnvelope: InitiativesEnvelope<InitiativeListPage>; readonly headingLevel?: 1 | 2; readonly className?: string };
/** The initiative list surface: one page of the initiatives this ministry permits, over the URL's query state, with the composer for a new initiative gated on the action its read publishes. */ export default function InitiativeList({ initialEnvelope, headingLevel = 2, className }: InitiativeListProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const headingId = useId();
  const [composerOpen, setComposerOpen] = useState(false);
  const noticeHeadingLevel: NoticeHeadingLevel = headingLevel === 1 ? 2 : 3;
  const view = useMemo<InitiativesViewState>(() => parseInitiativesQuery(searchParams), [searchParams]);
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
  const listQueryState = useMemo<RecordListQueryState>(() => ({ sort: view.sort === DEFAULT_ORDER ? NO_SORT : [{ id: view.sort, desc: false }], page: view.page, pageSize: view.pageSize, columnVisibility: view.columnVisibility }), [view]);
  const read = useInitiatives<InitiativeListPage>(listQueryState, initialEnvelope, filters);
  const result = read.status === "ready" ? read.result : undefined;
  const envelope = result !== undefined && result.kind === "envelope" ? result.envelope : undefined;
  const page = envelope === undefined ? undefined : envelope.data;
  const rows = page === undefined ? NO_ROWS : page.items;
  const valueStates = envelope === undefined ? NO_VALUE_STATES : envelope.valueStates;
  const total = page === undefined ? 0 : page.total;
  const activeFilters = (view.search.trim() === "" ? 0 : 1) + (view.state === STATE_ALL ? 0 : 1);
  const createAction = (envelope ?? initialEnvelope.envelope).actions.find((action) => action.name === "createInitiative");
  const readAnswersWithEnvelope = result === undefined || result.kind === "envelope";
  const offersCreate = readAnswersWithEnvelope && createAction?.available === true;
  const createUnavailableReason = !readAnswersWithEnvelope || offersCreate ? null : (createAction?.reason?.trim() ?? SURFACE_COPY.createUnavailableReason);
  useEffect(() => {
    if (page === undefined || page.total <= 0) return;
    const lastPage = Math.max(FIRST_PAGE, Math.ceil(page.total / view.pageSize));
    if (view.page <= lastPage) return;
    commit({ ...view, page: lastPage });
  }, [commit, page, view]);
  const facets = useMemo<readonly FacetSpec[]>(
    () => [
      { id: STATE_FACET, label: SURFACE_COPY.stateFilterLabel, multi: false, values: INITIATIVE_STATES.map((state) => ({ id: state, label: INITIATIVE_STATE_COPY[state].label })) },
      { id: ORDER_FACET, label: SURFACE_COPY.orderLabel, multi: false, values: INITIATIVE_ORDERS.map((order) => ({ id: order, label: ORDER_VALUE_COPY[order] })) },
    ],
    [],
  );
  const applied = useMemo<Readonly<Record<string, readonly string[]>>>(() => {
    const stated: Record<string, readonly string[]> = {};
    if (view.state !== STATE_ALL) stated[STATE_FACET] = [view.state];
    if (view.sort !== DEFAULT_ORDER) stated[ORDER_FACET] = [view.sort];
    return stated;
  }, [view.sort, view.state]);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<InitiativeRow>>>(() => {
    const hrefOf = (initiativeId: string): string => `${DETAILS_PATH}/${encodeURIComponent(initiativeId)}?${toInitiativesParams(view).toString()}`;
    return [
      {
        id: "name",
        header: INITIATIVE_COPY.nameLabel,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Link href={hrefOf(row.original.initiativeId)} className="flex min-w-0 flex-col gap-0.5 rounded-sm inline-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
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
  const handleSearchChange = useCallback((value: string) => commit({ ...latestView.current, search: value, page: FIRST_PAGE }), [commit]);
  const handleAppliedChange = useCallback((next: Readonly<Record<string, readonly string[]>>) => commit({ ...latestView.current, state: stateFilterOf(firstApplied(next, STATE_FACET)), sort: orderOf(firstApplied(next, ORDER_FACET)), page: FIRST_PAGE }), [commit]);
  const handleClearFilters = useCallback(() => commit({ ...latestView.current, search: "", state: STATE_ALL, page: FIRST_PAGE }), [commit]);
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState) => {
      const [first] = next.sort;
      commit({ ...latestView.current, ...(first === undefined || !isInitiativeOrder(first.id) ? {} : { sort: first.id }), page: pageNumberOf(next.page), pageSize: clampPageSize(next.pageSize), columnVisibility: next.columnVisibility });
    },
    [commit],
  );
  const openComposer = useCallback(() => setComposerOpen(true), []);
  const openCreated = useCallback(
    (initiativeId: string) => {
      setComposerOpen(false);
      router.push(`${DETAILS_PATH}/${encodeURIComponent(initiativeId)}?${toInitiativesParams(latestView.current).toString()}`);
    },
    [router],
  );
  const emptyDescription = createUnavailableReason === null ? INITIATIVE_COPY.listEmptyBody : `${INITIATIVE_COPY.listEmptyBody} ${createUnavailableReason}`;
  let content: ReactElement;
  if (read.status === "loading") {
    content = <StateNotice kind="loading" headingLevel={noticeHeadingLevel} title={SURFACE_COPY.loadingTitle} description={SURFACE_COPY.loadingBody} loadingLines={6} />;
  } else if (result !== undefined && result.kind === "denied") {
    content = <StateNotice kind="denied" headingLevel={noticeHeadingLevel} title={STATE_NOTICE_COPY.denied.title} description={STATE_NOTICE_COPY.denied.body} reasonCode={result.denied.reasonCode} />;
  } else if (result !== undefined && result.kind === "unavailable") {
    content = <StateNotice kind="unavailable" headingLevel={noticeHeadingLevel} title={STATE_NOTICE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} />;
  } else if (result !== undefined && result.kind === "refused") {
    content = <StateNotice kind="refused" headingLevel={noticeHeadingLevel} title={STATE_NOTICE_COPY.refused.title} description={refusalSummary(result.refused)} />;
  } else if (page !== undefined && total === 0 && activeFilters === 0) {
    content = <StateNotice kind="empty" headingLevel={noticeHeadingLevel} title={INITIATIVE_COPY.listEmptyTitle} description={emptyDescription} {...(offersCreate ? { action: { label: INITIATIVE_COPY.createLabel, onClick: openComposer } } : {})} />;
  } else {
    content = (
      <RecordList
        label={SURFACE_COPY.tableLabel}
        columns={columns}
        rows={rows}
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
      <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-surface-subtle p-4 shadow-xs sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading {...{ level: headingLevel, id: headingId }}>{INITIATIVE_COPY.listHeading}</Heading>
          <p className="type-supporting text-pretty">{SURFACE_COPY.intro}</p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1">
          {offersCreate ? <Button {...{ type: "button", onClick: openComposer, className: BUTTON_WRAP_CLASS }}>{INITIATIVE_COPY.createLabel}</Button> : null}
          {offersCreate || createUnavailableReason !== null ? <p className="text-xs text-pretty text-muted-foreground">{createUnavailableReason ?? SURFACE_COPY.createEffectNote}</p> : null}
        </div>
      </div>
      <QueryToolbar label={SURFACE_COPY.filtersLabel} search={{ value: view.search, onChange: handleSearchChange, placeholder: SURFACE_COPY.searchPlaceholder }} facets={facets} applied={applied} onAppliedChange={handleAppliedChange} pending={read.isFetching} />
      <section {...{ "aria-labelledby": headingId, className: "flex min-w-0 flex-col gap-3" }}>{content}</section>
      <InitiativeComposer open={composerOpen} onOpenChange={setComposerOpen} envelope={envelope ?? initialEnvelope.envelope} onCreated={openCreated} />
    </div>
  );
}
