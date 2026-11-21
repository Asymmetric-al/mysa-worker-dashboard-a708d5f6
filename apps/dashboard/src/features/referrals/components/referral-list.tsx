"use client";
/**
 * The referral lists: Active, incomplete date and the permitted Expired history, over the family's
 * one search toolbar and the application's one table preset, with the address as the only query state.
 *
 * Nothing here judges a window, counts a day or derives a deadline. `reads.referrals.readReferrals`
 * answers one page of one list with the window it resolved, the status it judged and the
 * whole-result total, and every value below is that read's own — the caption's count is the read's
 * total rather than the size of the loaded page, and a row whose window end is absent states that
 * absence instead of printing a blank. The URL is the query state, so a detail visit, a shared link
 * and the browser's Back button all return to the exact list, search and page.
 *
 * The three lists are three different questions rather than one filtered list (AAP 0.8.3). A date
 * that is not known precisely enough admits no deadline and no Active or Expired judgement, so the
 * incomplete-date list says so once for the whole view; and the Expired list is a narrow permission
 * over history, so it renders through `ExpiredReferralHistory` — the one component that owns the
 * permission statement, the permitted facts and the withheld ones — and never as a table of the
 * partner record. Continue is offered on neither list: it belongs to a referral's own detail, where
 * the read answers one cycle in full.
 *
 * The read takes no ordering parameter, so this surface states the order the read applies instead of
 * offering a sort control that would change nothing, and no column is sortable.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { PaginationBar } from "@/components/pagination-bar";
import RecordList, { type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import QueryToolbar from "@/components/query-toolbar";
import StateNotice from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Scope } from "@/modules/data-service";
import { LIST_COPY, listCountCaption, NO_DEADLINE_NOTICE, PRECISION_COPY, STATUS_COPY } from "../copy";
import { useReferrals, type ReferralListPage } from "../hooks/use-referrals";
import {
  DEFAULT_REFERRAL_PAGE_SIZE,
  DEFAULT_REFERRAL_VIEW,
  LIST_QUERY_MESSAGES,
  parseReferralListQuery,
  REFERRAL_PAGE_SIZES,
  REFERRAL_VIEWS,
  type ReferralListQuery,
  type ReferralView,
} from "../schemas";
import ExpiredReferralHistory from "./expired-referral-history";
// The contract
/** Props of {@link ReferralList}. */
export interface ReferralListProps {
  /** The exact authority these lists are read under; the service re-derives scope from it on every read. */
  readonly scope: Scope;
  /**
   * The direction the surrounding document is read in, supplied by the route that composes this
   * surface. It is spread on the outermost element only when it is supplied: a list that defaulted
   * the direction would override a right-to-left interface rather than inherit it.
   */
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}
// The rows this surface renders, taken from the read's own payload rather than restated here
/** The arm of the read's payload that the Active and incomplete-date lists share: one table of cycles. */
type ListedReferrals = Extract<ReferralListPage, { readonly list: "active" | "incomplete-date" }>;
/** One row of the Active or incomplete-date table. */
type ListedReferralRow = ListedReferrals["items"][number];
/** The arm of the read's payload that the permitted Expired history answers with. */
type ExpiredReferrals = Extract<ReferralListPage, { readonly list: "expired" }>;
// The address this surface is shown by
/**
 * The parameter names the family's own parser reads, so the address this component writes and the
 * address it parses are one grammar — and that grammar is the one `GET /api/referrals` answers.
 */
const ADDRESS = {
  list: "list",
  search: "search",
  page: "page",
  pageSize: "pageSize",
} as const;
/** The route prefix a row links into, kept in one constant so the family's list and detail addresses stay together. */
const REFERRAL_ROUTE_PREFIX = "/partners/referrals";
/** The page the schema counts from: the read slices from `(page - 1) * pageSize`, so pages start at 1. */
const FIRST_PAGE = 1;
/** The one noun every count and pager on this surface names. */
const ITEM_NOUN = "referral";
/**
 * The query an address that states nothing this surface can honour is read with: the family's own
 * default list and page size, so a refused address never invents a view from the parts that parsed.
 */
const DEFAULT_LIST_QUERY: ReferralListQuery = {
  list: DEFAULT_REFERRAL_VIEW,
  search: "",
  page: FIRST_PAGE,
  pageSize: DEFAULT_REFERRAL_PAGE_SIZE,
};
/**
 * The address as the family's parser reads it: its parameters as a record, with a parameter stated
 * more than once kept as every value it carries so the parser can refuse the address rather than
 * this surface quietly preferring one of them.
 */
function addressOf(searchParams: ReadonlyURLSearchParams): Readonly<Record<string, string | string[] | undefined>> {
  const address: Record<string, string | string[] | undefined> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    address[key] = values.length > 1 ? values : values[0];
  }
  return address;
}
/** The address parameters for one query: the four the schema parses, and nothing it would silently ignore. */
function listParams(query: ReferralListQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set(ADDRESS.list, query.list);
  if (query.search !== "") {
    params.set(ADDRESS.search, query.search);
  }
  // No ordering travels: the read takes none and applies its own, so an address carries only the
  // list, the search text and the page window the read executes.
  params.set(ADDRESS.page, String(query.page));
  params.set(ADDRESS.pageSize, String(query.pageSize));
  return params;
}
// The few words this surface adds to the family's copy
/**
 * The retry label the shared notice requires. Every read notice in the application offers its retry
 * under this word, and the family's copy states no label for it; nothing else on this surface is
 * worded here, because the lists, the columns, the statuses, the search and the notices all speak
 * from `../copy`.
 */
const RETRY_LABEL = "Try again";
/**
 * The tone each status word carries, so colour never stands alone: the word itself is the label.
 * An ended window is neutral rather than a fault, and a date too imprecise for a deadline asks for
 * no attention at all.
 */
const ROW_STATUS_TONE: Readonly<Record<ListedReferralRow["status"], StatusTone>> = {
  active: "positive",
  expired: "neutral",
  "no-deadline": "muted",
  refused: "caution",
};
/** The identity of one row: the referral reference the read answers, never a row position. */
function referralRowId(row: ListedReferralRow): string {
  return row.referralId;
}
/** The word a fact the read did not supply renders as, so an absent value is stated rather than left blank. */
const NOT_RECORDED = statusBadgeProps(VALUE_STATE_WORDS, "unknown");
const ROW_LINK_CLASS = "rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const MUTED_TEXT_CLASS = "text-muted-foreground";
// The cells
/** A permitted fact the read could not supply, stated as such instead of as a gap. */
function NotRecorded(): ReactElement {
  return <StatusBadge label={NOT_RECORDED.label} tone={NOT_RECORDED.tone} />;
}
/**
 * Where a row's window stands, in the family's own words: the word the status carries, the sentence
 * that explains it, and — where the window could not be resolved at all — the reason the read gave,
 * printed as the opaque token it is rather than paraphrased into a sentence this file would invent.
 */
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
// The permitted Expired history
/**
 * One permitted Expired history per row of the page, or — when the view holds none — the single
 * statement that history owns, which tells an empty permission apart from a search that matched
 * nothing. The rows never become a table: a permitted history carries no partner access, so no
 * column of it could be offered without widening the permission it is shown under.
 */
function ExpiredReferralHistorySection({
  items,
  searchEmpty,
  dir,
  headingLevel,
}: {
  readonly items: ExpiredReferrals["items"];
  readonly searchEmpty: boolean;
  readonly dir?: "ltr" | "rtl";
  readonly headingLevel: 2 | 3 | 4;
}): ReactElement {
  if (items.length === 0) {
    return <ExpiredReferralHistory referral={null} searchEmpty={searchEmpty} headingLevel={headingLevel} dir={dir} />;
  }
  // Each permitted record takes its own heading from its approved identity, and the permission card
  // nests one level below it: two records otherwise reach a reader who moves by heading as two
  // identically titled cards, and the title of the permission is never the name of the person it is
  // about. The identity is the record's own value, not a word composed here.
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
// The view switcher
/** The three lists as three addresses, with the one being read marked as the current page. */
function ViewSwitcher({ current, hrefOf }: { readonly current: ReferralView; readonly hrefOf: (view: ReferralView) => string }): ReactElement {
  return (
    <nav aria-label={LIST_COPY.viewSwitcherLabel} className="min-w-0">
      <ul className="flex min-w-0 flex-wrap items-center gap-1">
        {REFERRAL_VIEWS.map((view) => {
          const isCurrent = view === current;
          return (
            <li key={view} className="min-w-0">
              <Link
                href={hrefOf(view)}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(buttonVariants({ variant: isCurrent ? "secondary" : "ghost", size: "sm" }), "max-w-full whitespace-normal")}
              >
                <bdi>{LIST_COPY.views[view].heading}</bdi>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
// The surface
/** The `/partners/referrals` list surface: the three lists, the one search toolbar and the query kept in the address. */
export function ReferralList({ scope, dir, className }: ReferralListProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The address is the query state: a view switch, a search, a page and the browser's Back button
  // all arrive as the same string, and no local copy of the query is kept beside it. An address the
  // family's parser refuses is shown with the refusals it raised and read with the module's own
  // default query, so a hand-edited address never becomes a view this surface invented.
  const parsed = useMemo(() => parseReferralListQuery(addressOf(searchParams)), [searchParams]);
  const query: ReferralListQuery = parsed.ok ? parsed.query : DEFAULT_LIST_QUERY;
  const referrals = useReferrals({ scope, query });
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>({});
  // The latest query this surface dispatched, so two changes raised in one event — the pager asking
  // for a new size and then for the page that keeps the first visible row in view — compose into one
  // view instead of the second overwriting the first from a stale render.
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
  // A page the read states past its own last page — a hand-edited address, or a result that shrank
  // while it was open — is corrected to the last page the read states, so the caption, the rows and
  // the pager always describe one window. Both numbers in that count are the read's own: its
  // whole-result total and the page size it executed.
  useEffect(() => {
    if (data === undefined || data.items.length > 0 || data.total === 0 || data.list !== query.list) {
      return;
    }
    const lastPage = Math.max(FIRST_PAGE, Math.ceil(data.total / data.pageSize));
    if (query.page <= lastPage) {
      return;
    }
    commit({ ...latestQuery.current, page: lastPage });
  }, [commit, data, query.page, query.list]);
  // Switching list returns to the first page, because a page offset belongs to the result it was
  // counted against; following the list already open keeps the page the worker is on.
  const hrefOf = useCallback((next: ReferralView): string => `${pathname}?${listParams(next === query.list ? query : { ...query, list: next, page: FIRST_PAGE }).toString()}`, [pathname, query]);
  const handleSearchChange = useCallback(
    (value: string) => {
      // A search resets the page: the previous page's offset belongs to the previous result.
      commit({ ...latestQuery.current, search: value, page: FIRST_PAGE });
    },
    [commit],
  );
  const handleClearSearch = useCallback(() => {
    commit({ ...latestQuery.current, search: "", page: FIRST_PAGE });
  }, [commit]);
  // Search is the only narrowing this surface offers, so the toolbar is handed no facet and no
  // selection can arrive here. The address stays the single query owner rather than a facet state
  // being created for a control that does not exist.
  const handleAppliedChange = useCallback((_next: Record<string, string[]>) => {
    // Nothing is selected, so there is nothing to write: the facets the read offers are named by the
    // record, work and support surfaces, not by a permitted history that may not be filtered.
  }, []);
  const handlePageChange = useCallback(
    (page: number) => {
      commit({ ...latestQuery.current, page });
    },
    [commit],
  );
  const handlePageSizeChange = useCallback(
    (pageSize: number) => {
      commit({ ...latestQuery.current, pageSize });
    },
    [commit],
  );
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState) => {
      // The columns a worker shows are held here and never travel in the address: they change what
      // this page displays, not which records the read answers with.
      setColumnVisibility(next.columnVisibility);
      // No column is sortable, so the ordering the preset reports is always empty; the read's own
      // order is stated above the table rather than sent as a parameter nothing would honour.
      commit({ ...latestQuery.current, page: Math.max(FIRST_PAGE, next.page), pageSize: next.pageSize });
    },
    [commit],
  );
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<ListedReferralRow>>>(() => {
    // A row opens its referral with the list address it was read under, so a detail visit and the
    // return keep the view, the search and the page.
    const detailHref = (referralId: string): string => `${REFERRAL_ROUTE_PREFIX}/${encodeURIComponent(referralId)}?${listParams(query).toString()}`;
    return [
      {
        id: "partner",
        header: LIST_COPY.columns.partner,
        enableSorting: false,
        enableHiding: false,
        cell: (context) => (
          <Link href={detailHref(context.row.original.referralId)} className={ROW_LINK_CLASS}>
            <bdi>{context.row.original.partnerDisplayName}</bdi>
          </Link>
        ),
      },
      {
        id: "originalIntroductionOn",
        header: LIST_COPY.columns.originalIntroductionOn,
        enableSorting: false,
        cell: (context) => {
          const introduced = context.row.original.originalIntroductionOn;
          return introduced === null ? <NotRecorded /> : <bdi className="tabular-figures">{introduced}</bdi>;
        },
      },
      {
        id: "datePrecision",
        header: LIST_COPY.columns.datePrecision,
        enableSorting: false,
        cell: (context) => <bdi>{PRECISION_COPY[context.row.original.datePrecision].label}</bdi>,
      },
      {
        id: "status",
        header: LIST_COPY.columns.status,
        enableSorting: false,
        cell: (context) => <StatusCell row={context.row.original} />,
      },
      {
        id: "windowEnd",
        // The heading stays a plain string: the preset also reads it as the column's visible name in
        // its Columns menu, where a rendered element would degrade to the bare column id. The family's
        // explanation of a missing window end is stated in the note beneath the table instead.
        header: LIST_COPY.columns.windowEnd,
        enableSorting: false,
        cell: (context) => {
          const windowEnd = context.row.original.windowEnd;
          return windowEnd === null ? <span className={MUTED_TEXT_CLASS}>{LIST_COPY.noWindowEndLabel}</span> : <bdi className="tabular-figures">{windowEnd}</bdi>;
        },
      },
    ];
  }, [query]);
  const retry = {
    label: RETRY_LABEL,
    onClick: () => {
      void referrals.refetch();
    },
  };
  let content: ReactElement;
  if (referrals.isPending) {
    // The read has not answered yet, so nothing is counted and no empty result is implied.
    content = <StateNotice kind="loading" title={LIST_COPY.heading} headingLevel={3} loadingLines={6} />;
  } else if (read === undefined) {
    // No read result arrived at all, which is an outage with a retry rather than an empty list.
    content = <StateNotice kind="unavailable" title={LIST_COPY.heading} retry={retry} headingLevel={3} />;
  } else if (read.kind === "denied") {
    // A denial states no count, title or size: the answer is the same whether or not anything exists
    // in the scope this session may not read.
    content = <StateNotice kind="denied" title={LIST_COPY.heading} reasonCode={read.denied.reasonCode} headingLevel={3} />;
  } else if (read.kind === "unavailable") {
    // The outcome's own guidance and source are shown rather than a sentence written here, so the
    // outage names what failed and what to do about it.
    content = <StateNotice kind="unavailable" title={LIST_COPY.heading} description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={3} />;
  } else if (read.envelope.data.list !== query.list) {
    // The read is still answering the list this surface was showing a moment ago. Those rows are
    // never shown under another list's heading and caption, so the previous answer gives way to the
    // pending state until the list the address names arrives.
    content = <StateNotice kind="loading" title={LIST_COPY.heading} headingLevel={3} loadingLines={6} />;
  } else {
    const list = read.envelope.data;
    let body: ReactElement;
    if (list.list === "expired") {
      // The permitted Expired history is a narrow projection of identity, source reference, status
      // and permitted dates only, so it is rendered by the one component that owns that permission
      // statement and names every fact the permission withholds. Its own empty statements serve an
      // empty and a searched-empty result, so none is written here.
      body =
        list.items.length === 0 && list.total > 0 ? (
          // The address names a page past the end of this result: the correction above re-reads the
          // last page the read states, and the history's empty statement would otherwise claim the
          // permission covers nothing.
          <StateNotice kind="loading" title={LIST_COPY.heading} headingLevel={3} loadingLines={6} />
        ) : (
          <>
            <ExpiredReferralHistorySection items={list.items} searchEmpty={query.search !== ""} dir={dir} headingLevel={3} />
            {list.total === 0 ? null : (
              <PaginationBar
                total={list.total}
                page={list.page}
                pageSize={list.pageSize}
                pageSizeOptions={REFERRAL_PAGE_SIZES}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                itemNoun={ITEM_NOUN}
              />
            )}
          </>
        );
    } else if (list.total === 0) {
      body =
        query.search === "" ? (
          // The genuine empty list. The action the view's copy declares is offered only where it has
          // an address to land on, and recording an introduction has no route in this application's
          // route tree yet, so no control is rendered that would lead nowhere.
          <StateNotice kind="empty" title={LIST_COPY.views[query.list].empty.title} description={LIST_COPY.views[query.list].empty.body} headingLevel={3} />
        ) : (
          // An empty result under a search is a different fact from an empty list, and its remedy is
          // the search itself.
          <StateNotice
            kind="empty"
            title={LIST_COPY.search.empty.title}
            description={LIST_COPY.search.empty.body}
            action={{ label: LIST_COPY.search.empty.actionLabel, onClick: handleClearSearch }}
            headingLevel={3}
          />
        );
    } else if (list.items.length === 0) {
      // The address names a page past the end of this result: the correction above re-reads the last
      // page the read states, and an empty table in the meantime would claim the list holds nothing.
      body = <StateNotice kind="loading" title={LIST_COPY.heading} headingLevel={3} loadingLines={6} />;
    } else {
      body = (
        <>
          <RecordList
            label={LIST_COPY.views[query.list].heading}
            columns={columns}
            rows={list.items}
            rowCount={list.total}
            queryState={{ sort: [], page: query.page, pageSize: query.pageSize, columnVisibility }}
            onQueryStateChange={handleQueryStateChange}
            getRowId={referralRowId}
            itemNoun={ITEM_NOUN}
            pageSizeOptions={REFERRAL_PAGE_SIZES}
          />
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{LIST_COPY.columnHelp.windowEnd}</p>
        </>
      );
    }
    content = (
      <>
        {/* The whole authorised result, counted by the read: one page is never read as the whole list. */}
        <p className="text-sm font-medium text-pretty wrap-anywhere">{listCountCaption(query, list.total)}</p>
        {/* The read applies one order and takes no ordering parameter, so the order is stated rather
            than offered as a control that would change nothing. */}
        <div className="flex min-w-0 flex-col gap-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{LIST_COPY.sort.label}</p>
          <ol className="flex list-decimal flex-col gap-0.5 ps-5">
            <li>
              <bdi>{LIST_COPY.sort.fieldLabels.windowEnd}</bdi>
            </li>
            <li>
              <bdi>{LIST_COPY.sort.fieldLabels.originalIntroductionOn}</bdi>
            </li>
          </ol>
        </div>
        {/* An incomplete date states the rule once for the whole view: no deadline was derived, so
            nothing here is late, owed or continuable. */}
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
      <QueryToolbar
        label={LIST_COPY.search.label}
        search={{ value: query.search, onChange: handleSearchChange, placeholder: LIST_COPY.search.placeholder }}
        facets={[]}
        applied={{}}
        onAppliedChange={handleAppliedChange}
        pending={referrals.isFetching}
      />
      <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{LIST_COPY.search.hint}</p>
      {/* An address the family's parser refused: each refusal is shown in the family's own words,
          keyed by the field it concerns, and the list below is the module's default query. */}
      {parsed.ok ? null : (
        <Alert>
          <AlertTitle>{LIST_QUERY_MESSAGES.formLevel}</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 ps-5">
              {Object.entries(parsed.fieldErrors).flatMap(([field, messages]) => messages.map((message, index) => <li key={`${field}-${String(index)}`}>{message}</li>))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {content}
    </div>
  );
}
export default ReferralList;
