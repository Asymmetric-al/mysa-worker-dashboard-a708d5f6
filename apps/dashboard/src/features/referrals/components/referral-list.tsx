"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { PaginationBar } from "@/components/pagination-bar";
import RecordList, { type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import QueryToolbar, { type FacetSpec } from "@/components/query-toolbar";
import StateNotice from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Scope } from "@/modules/data-service";
import { LIST_COPY, listCountCaption, NO_DEADLINE_NOTICE, PRECISION_COPY, STATUS_COPY } from "../copy";
import { useReferrals, type ReferralListPage, type ReferralListReadResult } from "../hooks/use-referrals";
import { DEFAULT_REFERRAL_PAGE_SIZE, DEFAULT_REFERRAL_VIEW, LIST_QUERY_MESSAGES, parseReferralListQuery, REFERRAL_PAGE_SIZES, REFERRAL_VIEWS, type ReferralListQuery, type ReferralView } from "../schemas";
import ExpiredReferralHistory from "./expired-referral-history";
import { INTRODUCTION_COMPOSER_ANCHOR } from "./referral-introduction-composer";
export type ReferralListProps = { readonly scope: Scope; readonly initialResult?: ReferralListReadResult; readonly dir?: "ltr" | "rtl"; readonly className?: string };
type ListedReferralRow = Extract<ReferralListPage, { readonly list: "active" | "incomplete-date" }>["items"][number];
const ADDRESS = { list: "list", search: "search", page: "page", pageSize: "pageSize" } as const;
const FIRST_PAGE = 1;
const ITEM_NOUN = "referrals";
const NO_FACETS: readonly FacetSpec[] = [];
const NO_APPLIED_FILTERS: Readonly<Record<string, readonly string[]>> = {};
const DEFAULT_LIST_QUERY: ReferralListQuery = { list: DEFAULT_REFERRAL_VIEW, search: "", page: FIRST_PAGE, pageSize: DEFAULT_REFERRAL_PAGE_SIZE };
function addressOf(searchParams: ReadonlyURLSearchParams): Readonly<Record<string, string | string[] | undefined>> {
  const address: Record<string, string | string[] | undefined> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    address[key] = values.length > 1 ? values : values[0];
  }
  return address;
}
function listParams(query: ReferralListQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set(ADDRESS.list, query.list);
  if (query.search !== "") params.set(ADDRESS.search, query.search);
  params.set(ADDRESS.page, String(query.page));
  params.set(ADDRESS.pageSize, String(query.pageSize));
  return params;
}
const ROW_STATUS_TONE: Readonly<Record<ListedReferralRow["status"], StatusTone>> = { active: "positive", expired: "neutral", "no-deadline": "muted", refused: "caution" };
const NOT_RECORDED = statusBadgeProps(VALUE_STATE_WORDS, "unknown");
const NotRecorded = (): ReactElement => <StatusBadge label={NOT_RECORDED.label} tone={NOT_RECORDED.tone} />;
function StatusCell({ row }: { readonly row: ListedReferralRow }): ReactElement {
  const copy = STATUS_COPY[row.status];
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <StatusBadge label={copy.label} tone={ROW_STATUS_TONE[row.status]} />
      <span className="text-xs text-muted-foreground text-pretty wrap-anywhere">{copy.description}</span>
      {row.statusReason === null ? null : <bdi className="mono-identifier text-xs">{row.statusReason}</bdi>}
    </span>
  );
}
function ExpiredReferralHistorySection({ items, searchEmpty, dir, headingLevel }: { readonly items: Extract<ReferralListPage, { readonly list: "expired" }>["items"]; readonly searchEmpty: boolean; readonly dir?: "ltr" | "rtl"; readonly headingLevel: 2 | 3 | 4 }): ReactElement {
  if (items.length === 0) return <ExpiredReferralHistory referral={null} searchEmpty={searchEmpty} headingLevel={headingLevel} dir={dir} />;
  return (
    <ul className="flex min-w-0 flex-col gap-4">
      {items.map((referral) => (
        <li key={referral.referralId} className="flex min-w-0 flex-col gap-2">
          <h3 className="font-heading text-base font-medium text-pretty wrap-anywhere">
            <bdi>{referral.partnerDisplayName}</bdi>
          </h3>
          <ExpiredReferralHistory referral={referral} headingLevel={4} dir={dir} />
        </li>
      ))}
    </ul>
  );
}
function ViewSwitcher({ current, hrefOf }: { readonly current: ReferralView; readonly hrefOf: (view: ReferralView) => string }): ReactElement {
  return (
    <nav aria-label={LIST_COPY.viewSwitcherLabel} className="min-w-0">
      <ul className="flex min-w-0 flex-wrap items-center gap-1">
        {REFERRAL_VIEWS.map((view) => {
          const isCurrent = view === current;
          return (
            <li key={view} className="min-w-0">
              <Link href={hrefOf(view)} aria-current={isCurrent ? "page" : undefined} className={cn(buttonVariants({ variant: isCurrent ? "secondary" : "ghost", size: "sm" }), "max-w-full whitespace-normal")}>
                <bdi>{LIST_COPY.views[view].heading}</bdi>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
/** One referral list in the presentation its address names: the switcher, the heading and explanation, the search and the whole-result count. */
export function ReferralList({ scope, initialResult, dir, className }: ReferralListProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const parsed = useMemo(() => parseReferralListQuery(addressOf(searchParams)), [searchParams]);
  const query: ReferralListQuery = parsed.ok ? parsed.query : DEFAULT_LIST_QUERY;
  const referrals = useReferrals({ scope, query, initialResult });
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>({});
  const latestQuery = useRef<ReferralListQuery>(query);
  useEffect(() => {
    latestQuery.current = query;
  }, [query]);
  const commit = useCallback(
    (next: ReferralListQuery) => {
      latestQuery.current = next;
      router.replace(`${pathname}?${listParams(next).toString()}`, { scroll: false });
    },
    [pathname, router],
  );
  const read = referrals.data;
  const data = read !== undefined && read.kind === "envelope" ? read.envelope.data : undefined;
  useEffect(() => {
    if (data === undefined || data.items.length > 0 || data.total === 0 || data.list !== query.list) return;
    const lastPage = Math.max(FIRST_PAGE, Math.ceil(data.total / data.pageSize));
    if (query.page <= lastPage) return;
    commit({ ...latestQuery.current, page: lastPage });
  }, [commit, data, query.page, query.list]);
  const hrefOf = useCallback((next: ReferralView): string => `${pathname}?${listParams(next === query.list ? query : { ...query, list: next, page: FIRST_PAGE }).toString()}`, [pathname, query]);
  const commitPatch = useCallback(
    (patch: Partial<ReferralListQuery>) => {
      commit({ ...latestQuery.current, ...patch });
    },
    [commit],
  );
  const handleSearchChange = useCallback((value: string) => commitPatch({ search: value, page: FIRST_PAGE }), [commitPatch]);
  const handleClearSearch = useCallback(() => commitPatch({ search: "", page: FIRST_PAGE }), [commitPatch]);
  const handleAppliedChange = useCallback((_next: Record<string, string[]>) => {}, []);
  const handlePageChange = useCallback((page: number) => commitPatch({ page }), [commitPatch]);
  const handlePageSizeChange = useCallback((pageSize: number) => commitPatch({ pageSize }), [commitPatch]);
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState) => {
      setColumnVisibility(next.columnVisibility);
      const page = Math.max(FIRST_PAGE, next.page);
      if (page === latestQuery.current.page && next.pageSize === latestQuery.current.pageSize) return;
      commitPatch({ page, pageSize: next.pageSize });
    },
    [commitPatch],
  );
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<ListedReferralRow>>>(() => {
    const detailHref = (referralId: string): string => `/partners/referrals/${encodeURIComponent(referralId)}?${listParams(query).toString()}`;
    return [
      {
        id: "partner",
        header: LIST_COPY.columns.partner,
        enableSorting: false,
        enableHiding: false,
        cell: (context) => (
          <Link href={detailHref(context.row.original.referralId)} className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <bdi>{context.row.original.partnerDisplayName}</bdi>
          </Link>
        ),
      },
      { id: "originalIntroductionOn", header: LIST_COPY.columns.originalIntroductionOn, enableSorting: false, cell: (context) => (context.row.original.originalIntroductionOn === null ? <NotRecorded /> : <bdi className="tabular-figures">{context.row.original.originalIntroductionOn}</bdi>) },
      { id: "datePrecision", header: LIST_COPY.columns.datePrecision, enableSorting: false, cell: (context) => <bdi>{PRECISION_COPY[context.row.original.datePrecision].label}</bdi> },
      { id: "status", header: LIST_COPY.columns.status, enableSorting: false, cell: (context) => <StatusCell row={context.row.original} /> },
      { id: "windowEnd", header: LIST_COPY.columns.windowEnd, enableSorting: false, cell: (context) => (context.row.original.windowEnd === null ? <span className="text-muted-foreground">{LIST_COPY.noWindowEndLabel}</span> : <bdi className="tabular-figures">{context.row.original.windowEnd}</bdi>) },
    ];
  }, [query]);
  const retry = { label: "Try again", onClick: (): void => void referrals.refetch() };
  let content: ReactElement;
  if (referrals.isPending) content = <StateNotice kind="loading" title={LIST_COPY.heading} headingLevel={3} loadingLines={6} />;
  else if (read === undefined) content = <StateNotice kind="unavailable" title={LIST_COPY.heading} retry={retry} headingLevel={3} />;
  else if (read.kind === "denied") content = <StateNotice kind="denied" title={LIST_COPY.heading} reasonCode={read.denied.reasonCode} headingLevel={3} />;
  else if (read.kind === "unavailable") content = <StateNotice kind="unavailable" title={LIST_COPY.heading} description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={3} />;
  else if (read.kind === "refused") content = <StateNotice kind="refused" title={LIST_COPY.heading} headingLevel={3} />;
  else if (read.envelope.data.list !== query.list) content = <StateNotice kind="loading" title={LIST_COPY.heading} headingLevel={3} loadingLines={6} />;
  else {
    const list = read.envelope.data;
    let body: ReactElement;
    const emptyView = LIST_COPY.views[query.list].empty;
    if (list.list === "expired") {
      body =
        list.items.length === 0 && list.total > 0 ? (
          <StateNotice kind="loading" title={LIST_COPY.heading} headingLevel={3} loadingLines={6} />
        ) : (
          <>
            <ExpiredReferralHistorySection items={list.items} searchEmpty={query.search !== ""} dir={dir} headingLevel={3} />
            {list.total === 0 ? null : <PaginationBar total={list.total} page={list.page} pageSize={list.pageSize} pageSizeOptions={REFERRAL_PAGE_SIZES} onPageChange={handlePageChange} onPageSizeChange={handlePageSizeChange} itemNoun={ITEM_NOUN} />}
          </>
        );
    } else if (list.total === 0) {
      body =
        query.search === "" ? (
          // Recording an introduction is the action that fills this list, and the composer this route renders below it is where that record is made: the partner, the revision and the provenance it needs are supplied there, so the view's declared action lands on that composer's own section and a view that declares none offers none.
          <StateNotice kind="empty" title={emptyView.title} description={emptyView.body} action={emptyView.actionLabel === null ? undefined : { label: emptyView.actionLabel, href: INTRODUCTION_COMPOSER_ANCHOR }} headingLevel={3} />
        ) : (
          <StateNotice kind="empty" title={LIST_COPY.search.empty.title} description={LIST_COPY.search.empty.body} action={{ label: LIST_COPY.search.empty.actionLabel, onClick: handleClearSearch }} headingLevel={3} />
        );
    } else if (list.items.length === 0) body = <StateNotice kind="loading" title={LIST_COPY.heading} headingLevel={3} loadingLines={6} />;
    else {
      body = (
        <>
          <RecordList
            label={LIST_COPY.views[query.list].heading}
            columns={columns}
            rows={list.items}
            rowCount={list.total}
            queryState={{ sort: [], page: query.page, pageSize: query.pageSize, columnVisibility }}
            onQueryStateChange={handleQueryStateChange}
            getRowId={(row) => row.referralId}
            itemNoun={ITEM_NOUN}
            pageSizeOptions={REFERRAL_PAGE_SIZES}
          />
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{LIST_COPY.columnHelp.windowEnd}</p>
        </>
      );
    }
    content = (
      <>
        <p className="text-sm font-medium text-pretty wrap-anywhere">{listCountCaption(query, list.total)}</p>
        <div className="flex min-w-0 flex-col gap-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{LIST_COPY.sort.label}</p>
          <ol className="flex list-decimal flex-col gap-0.5 ps-5">
            {[LIST_COPY.sort.fieldLabels.windowEnd, LIST_COPY.sort.fieldLabels.originalIntroductionOn].map((field) => (
              <li key={field}>
                <bdi>{field}</bdi>
              </li>
            ))}
          </ol>
        </div>
        {query.list === "incomplete-date" ? (
          <Alert>
            <AlertDescription>{NO_DEADLINE_NOTICE}</AlertDescription>
          </Alert>
        ) : null}
        {body}
      </>
    );
  }
  return (
    <div data-slot="referral-list" {...(dir === undefined ? {} : { dir })} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <ViewSwitcher current={query.list} hrefOf={hrefOf} />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-heading text-xl font-semibold text-pretty wrap-anywhere">{LIST_COPY.views[query.list].heading}</h2>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty wrap-anywhere">{LIST_COPY.views[query.list].explanation}</p>
      </div>
      <QueryToolbar label={LIST_COPY.search.label} search={{ value: query.search, onChange: handleSearchChange, placeholder: LIST_COPY.search.placeholder }} facets={NO_FACETS} applied={NO_APPLIED_FILTERS} onAppliedChange={handleAppliedChange} pending={referrals.isFetching} />
      <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{LIST_COPY.search.hint}</p>
      {parsed.ok ? null : (
        <Alert>
          <AlertTitle>{LIST_QUERY_MESSAGES.formLevel}</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 ps-5">{Object.entries(parsed.fieldErrors).flatMap(([field, messages]) => messages.map((message, index) => <li key={`${field}-${String(index)}`}>{message}</li>))}</ul>
          </AlertDescription>
        </Alert>
      )}
      {content}
    </div>
  );
}
export default ReferralList;
