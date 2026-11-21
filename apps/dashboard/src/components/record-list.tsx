"use client";

/**
 * The one table preset in the application.
 *
 * Nine surfaces render lists — partners, work, gifts, commitments, initiatives, referrals, the
 * coaching portfolio, content variants and the synthetic inbox — and each of them has to make the
 * same five promises. The count on screen is the whole authorised result and not the page in hand.
 * A selection is a set of explicit record identities: never an audience, never a consent, never an
 * array index, never a name or an email address. A column can be hidden without a drag. A source
 * that could not be read is neither an empty list nor a zero. Returning from a detail restores the
 * same filters, sort and page. Nine hand-written tables would drift apart on all five, so this file
 * is the only place a TanStack Table v9 instance is constructed and the only place a table renders.
 *
 * What the preset owns: the v9 wiring, selection identity and its page-scoped header control,
 * column visibility, the sort affordance, the honest pager total, and the empty / busy / unreadable
 * states. What it deliberately does not own — every filter, every sort order, every page window and
 * every aggregate — stays in the data service, which is what makes chart, table, drilldown, CSV and
 * print agree: the preset receives an already-processed page plus the whole-result `rowCount`, and
 * never filters, sorts, slices or totals a row itself. Any client-side sort, filter or page
 * pipeline here would be a second computation of a financial result — and therefore a second
 * answer to the question the decisive criterion asks.
 *
 * This is the v9 shape, not the v8 one: `useTable` with the four features this preset renders
 * declared once at module scope through `tableFeatures`, and every slice read through the v9 API —
 * the controlled atoms behind `table.state`, `table.getRowCount()`, `column.getIsSorted()` and
 * `row.getIsSelected()`. No global state-change callback and no per-slice setter is passed: the
 * feature's query state is the single owner, so a change is computed here and dispatched as one new
 * query state. Supplying `state` without an updater is the supported v9 controlled form — internal
 * writes land in table atoms that the controlled slice shadows.
 *
 * A feature types its columns against this preset's feature set, so the column definitions carry
 * exactly the properties the preset registered:
 *
 * ```ts
 * const columns: RecordListColumnDef<PartnerRow>[] = [ ... ]
 *
 * // or, with the library helper
 * const helper = createColumnHelper<RecordListFeatureSet, PartnerRow>()
 * ```
 *
 * Composition, not re-styling: the frame comes from `components/ui/table`, the controls from
 * `components/ui/checkbox` and `components/ui/dropdown-menu`, and the one horizontal scroll port
 * from `components/scroll-region`, which also supplies the `scroll-padding` that keeps a focused
 * cell out from under the sticky header. This file declares no `overflow-x` of its own.
 */

import { useEffect, useId, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, Columns3Icon } from "lucide-react";
import {
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type CellContext,
  type Column,
  type ColumnDef,
  type ColumnSort,
  type ColumnVisibilityState,
  type HeaderContext,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortDirection,
  type SortingState,
} from "@tanstack/react-table";

import { PaginationBar } from "@/components/pagination-bar";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";

/**
 * The features this preset renders, declared once and exported.
 *
 * Every one of them earns its place: sorting supplies the header affordance and its controlled
 * slice, selection supplies row identity, column visibility supplies the column menu, and
 * pagination supplies the page count derived from the whole-result `rowCount`. Filtering, grouping,
 * expanding and resizing are deliberately absent — the service filters, and no surface needs a
 * grouped or resizable table, so registering those would add state nothing renders and a resize
 * grip that only a two-pointer drag could operate (WCAG 2.5.7).
 *
 * Declared at module scope because `useTable` requires a stable feature object: a fresh one on every
 * render would rebuild the table's columns and row model each time.
 */
export const recordListFeatures = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
});

/** The preset's feature set, for a feature that needs to name it in a type position. */
export type RecordListFeatureSet = typeof recordListFeatures;

/**
 * A column definition for this preset's table.
 *
 * v9 types a column against the feature set that will consume it, so a feature imports this alias
 * (or `RecordListFeatureSet`) rather than writing `ColumnDef<TRow>`. A column declared against any
 * other feature set would be rejected by the compiler, which is the point: the properties a column
 * may carry are exactly the features the preset registered.
 */
export type RecordListColumnDef<TRow extends RowData> = ColumnDef<RecordListFeatureSet, TRow>;

/**
 * One ordering instruction, as the service applies it.
 *
 * v9 calls this shape `ColumnSort`; it is re-exported under the name the service query uses so a
 * feature compares and stores one type across the boundary instead of two identical ones.
 */
export type SortDescriptor = ColumnSort;

/**
 * The list state the owner controls, passed straight through to the service query.
 *
 * Held by the feature — never by the table — so it survives the trip into a detail and back:
 * `page`, `sort` and the visible column set are restored exactly as they were left, which is the
 * continuity the release requires. `page` is 1-based, matching the URL and the pager; the preset
 * converts it to v9's zero-based `pageIndex` at the boundary.
 */
export interface RecordListQueryState {
  /** The ordering the service applied, most significant first. Empty means the source order. */
  sort: SortDescriptor[];
  /** The open page, 1-based. */
  page: number;
  /** The rows per page the service applied. */
  pageSize: number;
  /** Column id to visibility. An absent id is visible; `false` hides it. */
  columnVisibility: ColumnVisibilityState;
}

/** Props of {@link RecordList}. */
export interface RecordListProps<TRow extends RowData> {
  /**
   * The table's accessible name, announced as its caption and reused by the scroll region. State
   * the subject and the scope, for example "Partners in this ministry" — never a count, which belongs
   * to the read and would go stale.
   */
  label: string;

  /** The column definitions the feature supplies, typed against {@link RecordListFeatureSet}. */
  columns: ReadonlyArray<RecordListColumnDef<TRow>>;

  /** The page of rows the service already filtered, sorted and sliced. Never the whole result. */
  rows: ReadonlyArray<TRow>;

  /**
   * The whole-result row count the read reported for this query — not `rows.length`. It is what the
   * pager prints and how the page count is derived, so a filtered page can never be presented as the
   * complete result.
   */
  rowCount: number;

  /** The controlled query state. */
  queryState: RecordListQueryState;

  /** Called with the complete next query state after a sort, page, size or visibility change. */
  onQueryStateChange: (next: RecordListQueryState) => void;

  /**
   * The stable identity of a row, used for React keys and for selection. Required: an index would
   * make a selection describe a position rather than a record, so a sort or a page change would
   * silently repoint it at a different partner.
   */
  getRowId: (row: TRow) => string;

  /** The selected record ids, in selection order. Omit to render no selection controls at all. */
  selectedIds?: ReadonlyArray<string>;

  /**
   * Called with the complete next selection after a checkbox changes. Omit together with
   * `selectedIds` to render a read-only list.
   *
   * The ids reported here are record identities and nothing more: a selection is not an audience, a
   * consent or a campaign, and the bulk action that consumes it must re-check every row when it runs.
   */
  onSelectionChange?: (ids: string[]) => void;

  /** True while a read is in flight: skeleton rows replace the body and the pager goes inert. */
  isLoading?: boolean;

  /**
   * The source that could not be read. Renders the outage instead of a table, with no count, no
   * total and no zero anywhere — an unreadable source is not an empty result.
   */
  unavailable?: { readonly source: SourceReference; readonly onRetry?: () => void };

  /** The real first action offered by a genuinely empty list, for example "Add a partner". */
  emptyAction?: ReactNode;

  /**
   * The row's own menu, rendered in a trailing cell. A feature builds it from the design system and
   * labels its trigger with the record it acts on; every action it offers must also be reachable in
   * the record detail, because a menu may never be the only route to a job.
   */
  rowActions?: (row: TRow) => ReactNode;

  /**
   * A plain-text name for the row, used to label its selection checkbox ("Select Jane Doe"). Supply
   * it whenever the record has a display name; the first data cell's text is used otherwise, which
   * is accurate but depends on what that column renders.
   */
  rowLabel?: (row: TRow) => string;

  /**
   * The plural noun the surface counts, for the pager's count line and the empty state's wording.
   * Defaults to "records"; a feature states its own ("partners", "gifts", "updates").
   */
  itemNoun?: string;

  /**
   * The page sizes this surface's read actually enforces, smallest first.
   *
   * Defaults to the release's 50 and 200, which is what most lists accept. A coaching history pages
   * 25 with a 100 ceiling, so it states its own set: the pager must never offer a size the service
   * would refuse, and must never display a size the service did not apply.
   */
  pageSizeOptions?: readonly number[];

  /**
   * Whether the owner's query currently narrows the result. It is the difference between "no
   * partners yet" — a genuine first-run state with a real action — and "no partners match these
   * filters", which explains the filters and offers to clear them. The preset cannot infer it,
   * because the filters live in the toolbar beside this component.
   */
  hasActiveFilters?: boolean;

  /** Clears the owner's filters. Only used when `hasActiveFilters` is true. */
  onClearFilters?: () => void;

  /**
   * The height the sticky shell occupies above this table, applied as the scroll region's
   * `scroll-padding-top` so a focused cell is never hidden beneath it (WCAG 2.2 2.4.11). Defaults to
   * the shell offset plus this table's own header row.
   */
  stickyOffset?: string;

  /**
   * A maximum height, after which the table itself scrolls vertically. Omitted, the region scrolls
   * sideways only and never traps a vertical gesture meant for the page.
   */
  maxHeight?: string;

  /** Layout classes for the whole preset. Never a colour, radius or shadow. */
  className?: string;
}

/** Column id of the preset's leading selection cell. Never collides with a feature's own id. */
const SELECT_COLUMN_ID = "__record_list_select";

/** Column id of the preset's trailing row-actions cell. */
const ACTIONS_COLUMN_ID = "__record_list_actions";

/**
 * The shell offset plus this table's own sticky header row (the design system's `h-12`).
 *
 * `scroll-padding-top` is what the browser scrolls against, so a cell focused by keyboard or by the
 * "skip to content" path lands below both the shell and the header instead of behind them. The
 * fallback keeps the padding meaningful on a surface rendered without the shell.
 */
const DEFAULT_STICKY_OFFSET = "calc(var(--app-shell-sticky-offset, 4rem) + 3rem)";

/** How many skeleton rows a busy body renders at least, and at most. */
const LOADING_ROW_MINIMUM = 3;
const LOADING_ROW_MAXIMUM = 8;

/** The density a busy body assumes when the page size is unknown or implausible. */
const FALLBACK_PAGE_SIZE = 50;

/**
 * The sticky header treatment shared by every header cell.
 *
 * The header sticks inside the scroll region rather than the page: when the owner caps the region's
 * height the header stays in view, and when it does not the region never scrolls vertically so the
 * rule is inert. `bg-background` matters only in the first case, where rows would otherwise show
 * through the header.
 */
const HEAD_CELL_CLASS = "sticky top-0 z-10 bg-background";

/**
 * The mixed state of the select-all checkbox.
 *
 * The design system's checkbox draws a tick in every state, so a partly selected page would show a
 * tick where it should show a dash — a visible claim that contradicts `aria-checked="mixed"`. The
 * tick is hidden and a dash is drawn from the primitive's published `data-indeterminate` attribute
 * (its documented styling hook), with the checked fill so the box reads as neither empty nor ticked.
 * The hit-area expander on `after` is untouched; the dash uses `before`, which the primitive leaves
 * free.
 */
const MIXED_CHECKBOX_CLASS = cn(
  "data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground",
  "data-[indeterminate]:[&_svg]:opacity-0",
  "data-[indeterminate]:before:absolute data-[indeterminate]:before:inset-0 data-[indeterminate]:before:m-auto",
  "data-[indeterminate]:before:h-[2px] data-[indeterminate]:before:w-2 data-[indeterminate]:before:rounded-full",
  "data-[indeterminate]:before:bg-primary-foreground data-[indeterminate]:before:content-['']",
);

/** One row of the column-visibility menu, already resolved to what the menu needs to print. */
interface ColumnVisibilityItem {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  /** `false` for a column the table refuses to hide (a synthetic cell, or the feature's own key column). */
  readonly canHide: boolean;
}

/**
 * A signature of everything in the query state that changes which rows the page holds.
 *
 * Selection is cleared when this changes, so a row filtered or paged away can never be acted on
 * silently. Visibility is included because hiding the column a bulk action is reading changes what
 * the worker can see of the selection; object keys are sorted so two identical maps written in a
 * different order produce the same signature instead of a spurious clear.
 */
function querySignature(queryState: RecordListQueryState): string {
  const sorting = queryState.sort
    .map((entry) => `${entry.id}:${entry.desc ? "desc" : "asc"}`)
    .join(",");
  const visibility = Object.keys(queryState.columnVisibility)
    .sort()
    .map((id) => `${id}:${queryState.columnVisibility[id] === true ? "1" : "0"}`)
    .join(",");
  return `${queryState.page}|${queryState.pageSize}|${sorting}|${visibility}`;
}

/**
 * The text of a column's own header, for the visibility menu.
 *
 * Only a string header names the column unambiguously. A rendered header (`ReactNode` or a template
 * function) may contain a control whose text is not a label, so the column id is used instead of
 * guessing — it is less friendly but never wrong.
 */
function columnLabel<TRow extends RowData>(
  column: Column<RecordListFeatureSet, TRow, unknown>,
): string {
  const header = column.columnDef.header;
  if (typeof header === "string" && header.trim() !== "") {
    return header;
  }
  return column.id;
}

/**
 * The heading a column shows when it declares none.
 *
 * The column id is not pretty, but it is the only honest label left: an empty header cell leaves the
 * column unnamed for a screen reader and unnamed in the visibility menu, which is worse than an
 * unpolished one. A column that wants better wording states its own `header`.
 */
function defaultHeader<TRow extends RowData>(
  context: HeaderContext<RecordListFeatureSet, TRow, unknown>,
): string {
  return context.column.id;
}

/**
 * The body a cell shows when its column declares no `cell`.
 *
 * A column that formats its value — an amount, a civil date, a status — supplies its own `cell`,
 * because only it knows that value's units and whether it is a zero, an unknown or a withheld one.
 * This default covers the plain text column, so a column that forgot its renderer shows the record's
 * own value rather than an empty box. A value with no generic rendering is left out instead of being
 * stringified into something meaningless.
 */
function defaultCell<TRow extends RowData>(
  context: CellContext<RecordListFeatureSet, TRow, unknown>,
): ReactNode {
  const value = context.renderValue();
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

/** The direction indicator of a sortable header, decorative because `aria-sort` carries the state. */
function SortIndicator({ direction }: { readonly direction: SortDirection | false }): ReactElement {
  const Icon =
    direction === "asc" ? ArrowUpIcon : direction === "desc" ? ArrowDownIcon : ChevronsUpDownIcon;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        direction === false ? "text-muted-foreground" : "text-foreground",
      )}
    />
  );
}

/** Props of {@link ColumnVisibilityMenu}. */
interface ColumnVisibilityMenuProps {
  /** The table's accessible name, so the menu's trigger says which table it configures. */
  readonly tableLabel: string;
  readonly items: ReadonlyArray<ColumnVisibilityItem>;
  /** How many data columns are currently visible, so the last one can be protected. */
  readonly visibleCount: number;
  readonly onToggle: (columnId: string, visible: boolean) => void;
  readonly onShowAll: () => void;
}

/**
 * The column-visibility control.
 *
 * A menu of labelled checkboxes rather than a two-pointer drag (WCAG 2.5.7): every column can be
 * shown or hidden from the keyboard, and the menu stays open while several are toggled. The last
 * visible data column cannot be hidden — a table with no columns is not a view anyone can use — and
 * the column the table refuses to hide is rendered disabled rather than omitted, so the reader can
 * see that it exists and why it stays.
 */
function ColumnVisibilityMenu({
  tableLabel,
  items,
  visibleCount,
  onToggle,
  onShowAll,
}: ColumnVisibilityMenuProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        <Columns3Icon aria-hidden="true" />
        Columns
        <span className="sr-only"> shown in {tableLabel}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((item) => {
          // A visible column that is the only one left is disabled, so the rule is visible before
          // it is hit rather than silently swallowing the click.
          const hidesLastVisible = item.visible && visibleCount <= 1;
          return (
            <DropdownMenuCheckboxItem
              key={item.id}
              checked={item.visible}
              disabled={!item.canHide || hidesLastVisible}
              closeOnClick={false}
              onCheckedChange={(checked) => {
                onToggle(item.id, checked);
              }}
            >
              {item.label}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            onShowAll();
          }}
        >
          Show all columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An empty selection, so an omitted `selectedIds` keeps a stable identity between renders. */
const EMPTY_SELECTION: ReadonlyArray<string> = [];

/**
 * Counts are grouped with one fixed locale rather than the reader's.
 *
 * The preset renders on the server and again in the browser, so an environment-derived format would
 * produce two different strings for the same number and trip hydration. The words around the number
 * are the caller's — this file never inflects a noun it did not receive.
 */
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * A page size the table can divide by.
 *
 * v9 derives the page count from `rowCount / pageSize`, so a zero, a negative or a non-finite size
 * would produce a division that cannot describe a page. The fallback is the release's default page
 * size; the pager itself still reports whatever the service actually applied.
 */
function normalisePageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) {
    return FALLBACK_PAGE_SIZE;
  }
  const whole = Math.trunc(pageSize);
  return whole >= 1 ? whole : FALLBACK_PAGE_SIZE;
}

/**
 * The one table preset: a processed page of rows, rendered with selection, sorting, column
 * visibility and an honest pager, inside the application's only horizontal scroll region.
 *
 * The service has already filtered, sorted, sliced and aggregated, so this component receives a page
 * plus the whole-result `rowCount` and formats exactly that: it holds no copy of a record, computes
 * no total, and imports no report. Its only state is what the owner gave it — `queryState`,
 * `selectedIds` — plus the open/closed condition of the column menu, which is the design system's.
 *
 * Nothing renders a row it was not given, and nothing renders an empty or a zero where the source
 * could not be read: the three not-a-result conditions this surface can meet (busy, unreadable,
 * genuinely empty) are three distinct renderings, and a filtered-empty list says so instead of
 * pretending the collection is empty.
 */
export function RecordList<TRow extends RowData>({
  label,
  columns,
  rows,
  rowCount,
  queryState,
  onQueryStateChange,
  getRowId,
  selectedIds,
  onSelectionChange,
  isLoading = false,
  unavailable,
  emptyAction,
  rowActions,
  rowLabel,
  itemNoun = "records",
  pageSizeOptions,
  hasActiveFilters = false,
  onClearFilters,
  stickyOffset,
  maxHeight,
  className,
}: RecordListProps<TRow>): ReactElement {
  const cellIdBase = useId();
  const selectionEnabled = onSelectionChange !== undefined;
  const actionsEnabled = rowActions !== undefined;
  const selectedKeys = selectedIds ?? EMPTY_SELECTION;

  // The feature's columns, bracketed by the preset's own two cells. Memoized because `useTable`
  // rebuilds its column instances when the array identity changes, and a feature may well build its
  // column array inline.
  const tableColumns = useMemo<RecordListColumnDef<TRow>[]>(() => {
    const next: RecordListColumnDef<TRow>[] = [];
    if (selectionEnabled) {
      next.push({ id: SELECT_COLUMN_ID, enableSorting: false, enableHiding: false });
    }
    for (const column of columns) {
      next.push(column);
    }
    if (actionsEnabled) {
      next.push({ id: ACTIONS_COLUMN_ID, enableSorting: false, enableHiding: false });
    }
    return next;
  }, [columns, selectionEnabled, actionsEnabled]);

  // The controlled selection slice, derived one way from the ids the owner holds. v9 reads selection
  // as a record of selected ids, so the identity is a record id and never a row position.
  const rowSelection = useMemo<RowSelectionState>(() => {
    const next: RowSelectionState = {};
    for (const id of selectedKeys) {
      next[id] = true;
    }
    return next;
  }, [selectedKeys]);

  const pageSize = normalisePageSize(queryState.pageSize);

  const table = useTable({
    features: recordListFeatures,
    columns: tableColumns,
    data: rows,
    getRowId,
    state: {
      sorting: queryState.sort,
      columnVisibility: queryState.columnVisibility,
      rowSelection,
      pagination: {
        pageIndex: Math.max(0, Math.trunc(queryState.page) - 1),
        pageSize,
      },
    },
    // Every stage belongs to the service. Manual pagination plus `rowCount` is also what makes
    // `getRowCount()` report the whole result, so the pager can never print the size of one page.
    manualSorting: true,
    manualPagination: true,
    rowCount: Math.max(0, Math.trunc(rowCount)),
    enableMultiSort: false,
    // A column states its own `header` and `cell`. Where it does not, the heading falls back to the
    // column id and the body to the record's own value, so an unlabelled column of blank cells —
    // which is both a rendering gap and an accessibility failure — cannot happen.
    defaultColumn: { header: defaultHeader, cell: defaultCell },
  });

  // Read back through the controlled slice rather than the props, so the pager and the sort
  // affordances below are describing the state the table actually holds.
  const pagination = table.state.pagination;

  // Every row the body renders and every column it renders for each: read once, so the header, the
  // selection control, the skeleton and the body all describe the same page.
  const bodyRows = table.getRowModel().rows;
  const visibleLeafColumns = table.getVisibleLeafColumns();
  const allOnPageSelected = table.getIsAllPageRowsSelected();
  const someOnPageSelected = table.getIsSomePageRowsSelected();

  const signature = querySignature(queryState);
  const signatureRef = useRef(signature);

  // A selection belongs to the query that produced it. Once a filter, a sort, a page or a visible
  // column set changes, the selected ids may name rows the worker can no longer see, so the
  // selection is cleared rather than carried into an action over invisible records.
  useEffect(() => {
    if (signatureRef.current === signature) {
      return;
    }
    signatureRef.current = signature;
    if (onSelectionChange !== undefined && selectedKeys.length > 0) {
      onSelectionChange([]);
    }
  }, [signature, selectedKeys, onSelectionChange]);

  // The latest query state this component dispatched, so two changes raised in one event — the pager
  // asking for a new size and then for the page that keeps the first visible row in view — compose
  // into one next state instead of the second overwriting the first from a stale prop.
  const latestQuery = useRef(queryState);
  useEffect(() => {
    latestQuery.current = queryState;
  }, [queryState]);

  function commitQuery(patch: Partial<RecordListQueryState>): void {
    const next: RecordListQueryState = { ...latestQuery.current, ...patch };
    latestQuery.current = next;
    onQueryStateChange(next);
  }

  // The header cell is the only place a sort can start. It asks the library for the next order so a
  // column's own descending-first and no-removal policies are honoured, then dispatches the new
  // ordering to the service: nothing is sorted in the browser.
  function handleSort(column: Column<RecordListFeatureSet, TRow, unknown>): void {
    const next = column.getNextSortingOrder();
    const sort: SortingState = next === false ? [] : [{ id: column.id, desc: next === "desc" }];
    commitQuery({ sort, page: 1 });
  }

  const visibilityItems: ReadonlyArray<ColumnVisibilityItem> = table
    .getAllLeafColumns()
    .filter((column) => column.id !== SELECT_COLUMN_ID && column.id !== ACTIONS_COLUMN_ID)
    .map((column) => ({
      id: column.id,
      label: columnLabel(column),
      visible: column.getIsVisible(),
      canHide: column.getCanHide(),
    }));

  const visibleDataColumnCount = visibilityItems.reduce(
    (count, item) => (item.visible ? count + 1 : count),
    0,
  );

  // Hiding a column changes what the worker can see of a selected row but not which rows exist, so
  // the page stays where it is; the selection still clears, through the query signature above.
  function handleToggleColumn(columnId: string, visible: boolean): void {
    if (!visible && visibleDataColumnCount <= 1) {
      return;
    }
    // Composed from the latest dispatched state rather than the prop, so two toggles cannot lose
    // the first: the menu stays open while the reader shows and hides several columns.
    commitQuery({
      columnVisibility: { ...latestQuery.current.columnVisibility, [columnId]: visible },
    });
  }

  function handleShowAllColumns(): void {
    commitQuery({ columnVisibility: {} });
  }

  function setSelection(next: ReadonlySet<string>): void {
    if (onSelectionChange === undefined) {
      return;
    }
    onSelectionChange(Array.from(next));
  }

  function handleRowSelectedChange(rowId: string, selected: boolean): void {
    const next = new Set(selectedKeys);
    if (selected) {
      next.add(rowId);
    } else {
      next.delete(rowId);
    }
    setSelection(next);
  }

  // The header control selects the rows this page holds — the rows the worker can actually see —
  // and leaves anything selected elsewhere untouched. It is never a "select all matching rows"
  // shortcut, because that would select records the worker has not looked at.
  function handleSelectAllOnPage(selected: boolean): void {
    const next = new Set(selectedKeys);
    for (const row of bodyRows) {
      if (selected) {
        next.add(row.id);
      } else {
        next.delete(row.id);
      }
    }
    setSelection(next);
  }

  function handlePageChange(page: number): void {
    commitQuery({ page });
  }

  function handlePageSizeChange(nextPageSize: number): void {
    commitQuery({ pageSize: nextPageSize });
  }

  const firstDataCellIndex = selectionEnabled ? 1 : 0;
  const loadingRowCount = Math.min(Math.max(LOADING_ROW_MINIMUM, pageSize), LOADING_ROW_MAXIMUM);
  const showTable = isLoading || bodyRows.length > 0;
  const resolvedStickyOffset = stickyOffset ?? DEFAULT_STICKY_OFFSET;

  /** The id of the cell that names a row, referenced by that row's selection checkbox. */
  function rowLabelId(rowIndex: number): string {
    return `${cellIdBase}-row-${rowIndex}-label`;
  }

  /**
   * How a row's selection checkbox is named.
   *
   * The caller's own label is the accurate answer; failing that, the first data cell names the row,
   * which is where a list puts the record's own name and its link into the detail. A list with no
   * data column falls back to the row's position, which is all that is left to say.
   */
  function selectionLabelFor(row: Row<RecordListFeatureSet, TRow>): {
    "aria-label"?: string;
    "aria-labelledby"?: string;
  } {
    if (rowLabel !== undefined) {
      const name = rowLabel(row.original);
      if (name.trim() !== "") {
        return { "aria-label": `Select ${name}` };
      }
    }
    if (visibleDataColumnCount > 0) {
      return { "aria-labelledby": rowLabelId(row.index) };
    }
    return { "aria-label": `Select row ${row.index + 1}` };
  }

  const selectedCount = selectedKeys.length;
  const selectionSummary =
    selectedCount === 0
      ? ""
      : `${countFormat.format(selectedCount)} selected. A selection is not an audience or a consent: the action you choose re-checks every selected row.`;

  if (unavailable !== undefined) {
    return (
      <div data-slot="record-list" className={cn("flex flex-col gap-3", className)}>
        <StateNotice
          kind="unavailable"
          title={`${label} could not be read`}
          description="No count, total or empty result stands in for the missing data."
          source={unavailable.source}
          retry={
            unavailable.onRetry === undefined
              ? undefined
              : { label: "Try again", onClick: unavailable.onRetry }
          }
        />
      </div>
    );
  }

  const emptyNotice = hasActiveFilters ? (
    <StateNotice
      kind="empty"
      title={`No ${itemNoun} match these filters`}
      description="The filters and search on this surface are narrowing the result, so this is not an empty collection. Clearing them shows every record the current scope permits."
      action={
        onClearFilters === undefined
          ? undefined
          : { label: "Clear filters", onClick: onClearFilters }
      }
    />
  ) : (
    <div className="flex flex-col items-center gap-4">
      <StateNotice kind="empty" title={`No ${itemNoun} yet`} />
      {emptyAction}
    </div>
  );

  return (
    <div data-slot="record-list" className={cn("flex flex-col gap-3", className)}>
      {/* One persistent polite status region: it reports the busy condition as it starts, instead of
          mounting a live region that already holds its message, which a screen reader never reads. */}
      <output className="sr-only">{isLoading ? `Loading ${itemNoun}.` : ""}</output>

      {showTable ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {/* One persistent polite status line: it announces the selection as it changes and,
                while nothing is selected, states nothing rather than disappearing from the layout. */}
            <output className="text-sm text-muted-foreground">{selectionSummary}</output>
            {visibilityItems.length > 0 ? (
              <ColumnVisibilityMenu
                tableLabel={label}
                items={visibilityItems}
                visibleCount={visibleDataColumnCount}
                onToggle={handleToggleColumn}
                onShowAll={handleShowAllColumns}
              />
            ) : null}
          </div>

          <ScrollRegion
            label={`${label}, scrollable`}
            stickyOffset={resolvedStickyOffset}
            maxHeight={maxHeight}
            aria-busy={isLoading ? true : undefined}
          >
            <Table>
              <TableCaption className="sr-only">{label}</TableCaption>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => {
                      if (header.isPlaceholder) {
                        // Only a grouped header tree produces placeholders, which this preset cannot
                        // build; the empty cell keeps the grid aligned if one ever appears.
                        return (
                          <TableHead key={header.id} scope="col" className={HEAD_CELL_CLASS} />
                        );
                      }

                      const column = header.column;

                      if (column.id === SELECT_COLUMN_ID) {
                        return (
                          <TableHead
                            key={header.id}
                            scope="col"
                            className={cn(HEAD_CELL_CLASS, "w-10")}
                          >
                            <Checkbox
                              className={MIXED_CHECKBOX_CLASS}
                              checked={allOnPageSelected}
                              indeterminate={!allOnPageSelected && someOnPageSelected}
                              disabled={bodyRows.length === 0}
                              onCheckedChange={(checked) => {
                                handleSelectAllOnPage(checked);
                              }}
                              aria-label={`Select all ${itemNoun} on this page`}
                            />
                          </TableHead>
                        );
                      }

                      if (column.id === ACTIONS_COLUMN_ID) {
                        return (
                          <TableHead
                            key={header.id}
                            scope="col"
                            className={cn(HEAD_CELL_CLASS, "w-10 text-end")}
                          >
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        );
                      }

                      const canSort = column.getCanSort();
                      const sortDirection = column.getIsSorted();
                      const ariaSort =
                        sortDirection === "asc"
                          ? "ascending"
                          : sortDirection === "desc"
                            ? "descending"
                            : "none";

                      return (
                        <TableHead
                          key={header.id}
                          scope="col"
                          aria-sort={canSort ? ariaSort : undefined}
                          className={HEAD_CELL_CLASS}
                        >
                          {canSort ? (
                            // The design system's Button, not a click handler on the cell: it is
                            // reachable by Tab, activated by Enter and Space, and no drag takes
                            // part in sorting (WCAG 2.5.7). Base UI renders it on a native
                            // `type="button"`, so it can never submit an enclosing form, and
                            // `size="sm"` is 32 CSS px tall — above the 24x24 floor (WCAG 2.5.8)
                            // without changing the header row's height. `-ms-3` cancels the
                            // button's own `px-3` so the sortable label lines up with the
                            // non-sortable ones, whose cell supplies that padding. The ring is
                            // stated explicitly at full strength rather than left to the variant's
                            // default, so the one focus indicator this control has is never
                            // halved; the variant now draws the same full-strength ring, and
                            // tailwind-merge keeps them identical.
                            <Button
                              variant="ghost"
                              size="sm"
                              className="-ms-3 max-w-full focus-visible:ring-ring"
                              onClick={() => {
                                handleSort(column);
                              }}
                            >
                              <table.FlexRender header={header} />
                              <SortIndicator direction={sortDirection} />
                            </Button>
                          ) : (
                            <table.FlexRender header={header} />
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: loadingRowCount }, (_, loadingRowIndex) => (
                      <TableRow
                        key={`record-list-loading-${loadingRowIndex}`}
                        className="hover:bg-transparent"
                      >
                        {visibleLeafColumns.map((column) => (
                          <TableCell key={column.id}>
                            <Skeleton aria-hidden="true" className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : bodyRows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() ? "selected" : undefined}
                      >
                        {row.getVisibleCells().map((cell, cellIndex) => {
                          if (cell.column.id === SELECT_COLUMN_ID) {
                            return (
                              <TableCell key={cell.id} className="w-10">
                                <Checkbox
                                  checked={row.getIsSelected()}
                                  onCheckedChange={(checked) => {
                                    handleRowSelectedChange(row.id, checked);
                                  }}
                                  {...selectionLabelFor(row)}
                                />
                              </TableCell>
                            );
                          }

                          if (cell.column.id === ACTIONS_COLUMN_ID) {
                            return (
                              <TableCell key={cell.id} className="w-10 text-end">
                                {rowActions === undefined ? null : rowActions(row.original)}
                              </TableCell>
                            );
                          }

                          return (
                            <TableCell
                              key={cell.id}
                              id={
                                cellIndex === firstDataCellIndex ? rowLabelId(row.index) : undefined
                              }
                            >
                              <table.FlexRender cell={cell} />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </ScrollRegion>

          <PaginationBar
            total={table.getRowCount()}
            page={pagination.pageIndex + 1}
            pageSize={pagination.pageSize}
            pageSizeOptions={pageSizeOptions}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            itemNoun={itemNoun}
            disabled={isLoading}
          />
        </>
      ) : (
        emptyNotice
      )}
    </div>
  );
}

export default RecordList;
