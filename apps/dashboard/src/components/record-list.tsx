"use client";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
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
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import type { SourceReference } from "@/lib/ids";
export const recordListFeatures = tableFeatures({ rowSortingFeature, rowSelectionFeature, columnVisibilityFeature, rowPaginationFeature });
export type RecordListFeatureSet = typeof recordListFeatures;
export type RecordListColumnDef<TRow extends RowData> = ColumnDef<RecordListFeatureSet, TRow>;
export type SortDescriptor = ColumnSort;
/** The list state the owner controls, passed straight through to the service query. */ export type RecordListQueryState = { sort: SortDescriptor[]; page: number; pageSize: number; columnVisibility: ColumnVisibilityState };
/** The page window alone, in the pager's own one-based numbering: the part of the list state that belongs in the address. */ export type RecordListWindow = { readonly page: number; readonly pageSize: number };
export type RecordListProps<TRow extends RowData> = {
  label: string;
  columns: ReadonlyArray<RecordListColumnDef<TRow>>;
  rows: ReadonlyArray<TRow>;
  rowCount: number;
  queryState: RecordListQueryState;
  onQueryStateChange: (next: RecordListQueryState) => void;
  getRowId: (row: TRow) => string;
  selectedIds?: ReadonlyArray<string>;
  onSelectionChange?: (ids: string[]) => void;
  isLoading?: boolean;
  unavailable?: { readonly source: SourceReference; readonly onRetry?: () => void };
  emptyAction?: ReactNode;
  rowActions?: (row: TRow) => ReactNode;
  rowLabel?: (row: TRow) => string;
  itemNoun?: string;
  /** The interface locale this list formats its counts in, stated by the route that composes it; left off, the application default interface locale applies. */
  locale?: string;
  pageSizeOptions?: readonly number[];
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  /** Whether the surface around this list already offers the one column-visibility control for the same column state: the list then renders no control of its own, so one list never states two controls for one concern. Left off, the list shows its own control. */
  suppressColumnVisibilityMenu?: boolean;
  /** A surface's own notice for a result no filter narrows and an empty collection, replacing this list's generic one where the surface knows what an empty collection means for its own records; the first action it offers belongs inside it. */
  emptyState?: ReactNode;
  stickyOffset?: string;
  maxHeight?: string;
  className?: string;
};
const SELECT_COLUMN_ID = "__record_list_select";
const ACTIONS_COLUMN_ID = "__record_list_actions";
const LOADING_ROW_MINIMUM = 3;
const LOADING_ROW_MAXIMUM = 8;
const FALLBACK_PAGE_SIZE = 50;
const HEAD_CELL_CLASS = "sticky top-0 z-10 bg-background";
const MIXED_CHECKBOX_CLASS = cn(
  "data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground",
  "data-[indeterminate]:[&_svg]:opacity-0",
  "data-[indeterminate]:before:absolute data-[indeterminate]:before:inset-0 data-[indeterminate]:before:m-auto",
  "data-[indeterminate]:before:h-[2px] data-[indeterminate]:before:w-2 data-[indeterminate]:before:rounded-full",
  "data-[indeterminate]:before:bg-primary-foreground data-[indeterminate]:before:content-['']",
);
/** The identifier of the region a list gives its rows' actions to render a settled result into, so the result is read at the list's full width below the table instead of inside a row's actions cell; `null` where no list provides one, and the result then renders where it is produced. The identifier travels rather than the element, because the region is part of the list's own markup: no row needs to hold a copy of it in state, and no row's render has to wait for one. */
const RowResultsIdContext = createContext<string | null>(null);
/** The identifier of the list's row-result region, or `null` for a surface that renders outside a list and places its own result. */
export function useRecordListRowResultsId(): string | null {
  return useContext(RowResultsIdContext);
}
type ColumnVisibilityItem = { readonly id: string; readonly label: string; readonly visible: boolean; readonly canHide: boolean };
function querySignature(queryState: RecordListQueryState): string {
  const sorting = queryState.sort.map((entry) => `${entry.id}:${entry.desc ? "desc" : "asc"}`).join(",");
  const visibility = Object.keys(queryState.columnVisibility)
    .sort()
    .map((id) => `${id}:${queryState.columnVisibility[id] === true ? "1" : "0"}`)
    .join(",");
  return `${queryState.page}|${queryState.pageSize}|${sorting}|${visibility}`;
}
function columnLabel<TRow extends RowData>(column: Column<RecordListFeatureSet, TRow, unknown>): string {
  const header = column.columnDef.header;
  return typeof header === "string" && header.trim() !== "" ? header : column.id;
}
function defaultHeader<TRow extends RowData>(context: HeaderContext<RecordListFeatureSet, TRow, unknown>): string {
  return context.column.id;
}
function defaultCell<TRow extends RowData>(context: CellContext<RecordListFeatureSet, TRow, unknown>): ReactNode {
  const value = context.renderValue();
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}
function SortIndicator({ direction }: { readonly direction: SortDirection | false }): ReactElement {
  const Icon = direction === "asc" ? ArrowUpIcon : direction === "desc" ? ArrowDownIcon : ChevronsUpDownIcon;
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", direction === false ? "text-muted-foreground" : "text-foreground")} />;
}
type ColumnVisibilityMenuProps = { readonly tableLabel: string; readonly items: ReadonlyArray<ColumnVisibilityItem>; readonly visibleCount: number; readonly onToggle: (columnId: string, visible: boolean) => void; readonly onShowAll: () => void };
const ColumnVisibilityMenu = ({ tableLabel, items, visibleCount, onToggle, onShowAll }: ColumnVisibilityMenuProps): ReactElement => (
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
        const hidesLastVisible = item.visible && visibleCount <= 1;
        return (
          <DropdownMenuCheckboxItem key={item.id} checked={item.visible} disabled={!item.canHide || hidesLastVisible} closeOnClick={false} onCheckedChange={(checked) => onToggle(item.id, checked)}>
            {item.label}
          </DropdownMenuCheckboxItem>
        );
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onShowAll()}>Show all columns</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
const EMPTY_SELECTION: ReadonlyArray<string> = [];
function normalisePageSize(pageSize: number): number {
  const whole = Math.trunc(pageSize);
  return Number.isFinite(pageSize) && whole >= 1 ? whole : FALLBACK_PAGE_SIZE;
}
/** The first page of a list's window, in the pager's own one-based numbering. */ const FIRST_PAGE = 1;
/** The two address parameters a list's window travels in, named once because every family that already keeps its window in the address writes these two. */ const WINDOW_PARAM = { page: "page", pageSize: "pageSize" } as const;
/** A stated page or row size as a whole number at or above one, or the number the window already states when it is neither. */ function wholeWindowNumber(stated: number, current: number): number {
  if (!Number.isFinite(stated)) return current;
  const whole = Math.trunc(stated);
  return whole >= FIRST_PAGE ? whole : current;
}
/** One address parameter's own number, or `undefined` when it states none a window can use: a repeated parameter is read once, and text that is not a whole number at or above the first page is not a window. */
function statedWindowNumber(search: ReadonlyURLSearchParams, name: string): number | undefined {
  const stated = search.get(name);
  if (stated === null) return undefined;
  const parsed = Number(stated);
  return Number.isSafeInteger(parsed) && parsed >= FIRST_PAGE ? parsed : undefined;
}
/** The page window of a list a reader returns to, kept in the address rather than in the component: a window held in component state is forgotten as soon as the reader opens a record, while the address survives that visit, a reload, a shared link and Back, so it is the only owner of `page` and `pageSize` and no surface states a second copy. Both numbers are read at once, because an address that states a page without a row size does not describe a window; `setWindow` writes both and leaves every other parameter alone, and a column set is not part of the window, since hiding a column changes what is shown of a row and never which records the read returned. */
export function useRecordListWindow(opening: RecordListWindow): RecordListWindow & { readonly setWindow: (next: RecordListWindow) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stated = useMemo<RecordListWindow | undefined>(() => {
    const page = statedWindowNumber(searchParams, WINDOW_PARAM.page);
    const pageSize = statedWindowNumber(searchParams, WINDOW_PARAM.pageSize);
    return page === undefined || pageSize === undefined ? undefined : { page, pageSize };
  }, [searchParams]);
  const page = stated === undefined ? wholeWindowNumber(opening.page, FIRST_PAGE) : stated.page;
  const pageSize = stated === undefined ? wholeWindowNumber(opening.pageSize, FALLBACK_PAGE_SIZE) : stated.pageSize;
  const setWindow = useCallback(
    (next: RecordListWindow): void => {
      const nextPage = wholeWindowNumber(next.page, page);
      const nextPageSize = wholeWindowNumber(next.pageSize, pageSize);
      if (nextPage === page && nextPageSize === pageSize) return; // A window that states what the address already states is no change, so nothing is rewritten and no history entry is made for a reader who clicked the page they were already on.
      const params = new URLSearchParams(searchParams.toString());
      params.set(WINDOW_PARAM.page, String(nextPage));
      params.set(WINDOW_PARAM.pageSize, String(nextPageSize));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [page, pageSize, pathname, router, searchParams],
  );
  return { page, pageSize, setWindow };
}
/** The one table preset: a processed page of rows, rendered with selection, sorting, column visibility and an honest pager, inside the application's only horizontal scroll region. */ export function RecordList<TRow extends RowData>({
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
  locale,
  pageSizeOptions,
  hasActiveFilters = false,
  onClearFilters,
  suppressColumnVisibilityMenu = false,
  emptyState,
  stickyOffset,
  maxHeight,
  className,
}: RecordListProps<TRow>): ReactElement {
  const cellIdBase = useId();
  const rowResultsId = useId();
  const selectionEnabled = onSelectionChange !== undefined;
  const actionsEnabled = rowActions !== undefined;
  const selectedKeys = selectedIds ?? EMPTY_SELECTION;
  const tableColumns = useMemo<RecordListColumnDef<TRow>[]>(
    () => [...(selectionEnabled ? [{ id: SELECT_COLUMN_ID, enableSorting: false, enableHiding: false }] : []), ...columns, ...(actionsEnabled ? [{ id: ACTIONS_COLUMN_ID, enableSorting: false, enableHiding: false }] : [])],
    [columns, selectionEnabled, actionsEnabled],
  );
  const rowSelection = useMemo<RowSelectionState>(() => Object.fromEntries(selectedKeys.map((id) => [id, true])), [selectedKeys]);
  const pageSize = normalisePageSize(queryState.pageSize);
  const table = useTable({
    features: recordListFeatures,
    columns: tableColumns,
    data: rows,
    getRowId,
    state: { sorting: queryState.sort, columnVisibility: queryState.columnVisibility, rowSelection, pagination: { pageIndex: Math.max(0, Math.trunc(queryState.page) - 1), pageSize } },
    manualSorting: true,
    manualPagination: true,
    rowCount: Math.max(0, Math.trunc(rowCount)),
    enableMultiSort: false,
    defaultColumn: { header: defaultHeader, cell: defaultCell },
  });
  const pagination = table.state.pagination;
  const bodyRows = table.getRowModel().rows;
  const visibleLeafColumns = table.getVisibleLeafColumns();
  const allOnPageSelected = table.getIsAllPageRowsSelected();
  const someOnPageSelected = table.getIsSomePageRowsSelected();
  const signature = querySignature(queryState);
  const signatureRef = useRef(signature);
  useEffect(() => {
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    if (onSelectionChange !== undefined && selectedKeys.length > 0) onSelectionChange([]);
  }, [signature, selectedKeys, onSelectionChange]);
  const latestQuery = useRef(queryState);
  useEffect(() => {
    latestQuery.current = queryState;
  }, [queryState]);
  function commitQuery(patch: Partial<RecordListQueryState>): void {
    const next: RecordListQueryState = { ...latestQuery.current, ...patch };
    latestQuery.current = next;
    onQueryStateChange(next);
  }
  function handleSort(column: Column<RecordListFeatureSet, TRow, unknown>): void {
    const next = column.getNextSortingOrder();
    const sort: SortingState = next === false ? [] : [{ id: column.id, desc: next === "desc" }];
    commitQuery({ sort, page: 1 });
  }
  const visibilityItems: ReadonlyArray<ColumnVisibilityItem> = table
    .getAllLeafColumns()
    .filter((column) => column.id !== SELECT_COLUMN_ID && column.id !== ACTIONS_COLUMN_ID)
    .map((column) => ({ id: column.id, label: columnLabel(column), visible: column.getIsVisible(), canHide: column.getCanHide() }));
  const visibleDataColumnCount = visibilityItems.reduce((count, item) => (item.visible ? count + 1 : count), 0);
  function handleToggleColumn(columnId: string, visible: boolean): void {
    if (!visible && visibleDataColumnCount <= 1) return;
    commitQuery({ columnVisibility: { ...latestQuery.current.columnVisibility, [columnId]: visible } });
  }
  const handleShowAllColumns = (): void => commitQuery({ columnVisibility: {} });
  const setSelection = (next: ReadonlySet<string>): void => onSelectionChange?.(Array.from(next));
  function handleRowSelectedChange(rowId: string, selected: boolean): void {
    const next = new Set(selectedKeys);
    if (selected) next.add(rowId);
    else next.delete(rowId);
    setSelection(next);
  }
  function handleSelectAllOnPage(selected: boolean): void {
    const next = new Set(selectedKeys);
    for (const row of bodyRows)
      if (selected) next.add(row.id);
      else next.delete(row.id);
    setSelection(next);
  }
  const firstDataCellIndex = selectionEnabled ? 1 : 0;
  const loadingRowCount = Math.min(Math.max(LOADING_ROW_MINIMUM, pageSize), LOADING_ROW_MAXIMUM);
  const showTable = isLoading || bodyRows.length > 0;
  const resolvedStickyOffset = stickyOffset ?? "calc(var(--app-shell-sticky-offset, 4rem) + 3rem)";
  const rowLabelId = (rowIndex: number): string => `${cellIdBase}-row-${rowIndex}-label`;
  function selectionLabelFor(row: Row<RecordListFeatureSet, TRow>): { "aria-label"?: string; "aria-labelledby"?: string } {
    const name = rowLabel === undefined ? "" : rowLabel(row.original).trim();
    if (name !== "") return { "aria-label": `Select ${name}` };
    return visibleDataColumnCount > 0 ? { "aria-labelledby": rowLabelId(row.index) } : { "aria-label": `Select row ${row.index + 1}` };
  }
  const selectedCount = selectedKeys.length;
  const selectionSummary = selectedCount === 0 ? "" : `${countFormatOf(locale).format(selectedCount)} selected. A selection is not an audience or a consent: the action you choose re-checks every selected row.`;
  if (unavailable !== undefined) {
    return (
      <div data-slot="record-list" className={cn("flex flex-col gap-3", className)}>
        <StateNotice kind="unavailable" title={`${label} could not be read`} description="No count, total or empty result stands in for the missing data." source={unavailable.source} retry={unavailable.onRetry === undefined ? undefined : { label: "Try again", onClick: unavailable.onRetry }} />
      </div>
    );
  }
  const emptyNotice = hasActiveFilters ? (
    <StateNotice
      kind="empty"
      title={`No ${itemNoun} match these filters`}
      description="The filters and search on this surface are narrowing the result, so what you see is the part of the collection they select. Clearing them returns this surface to the view it opens with."
      action={onClearFilters === undefined ? undefined : { label: "Clear filters", onClick: onClearFilters }}
    />
  ) : (
    <div className="flex flex-col items-center gap-4">
      {emptyState ?? <StateNotice kind="empty" title={`No ${itemNoun} yet`} />}
      {emptyAction}
    </div>
  );
  const pager = (
    <PaginationBar
      total={table.getRowCount()}
      page={pagination.pageIndex + 1}
      pageSize={pagination.pageSize}
      pageSizeOptions={pageSizeOptions}
      onPageChange={(page) => commitQuery({ page })}
      onPageSizeChange={(nextPageSize) => commitQuery({ pageSize: nextPageSize })}
      itemNoun={itemNoun}
      locale={locale}
      disabled={isLoading}
    />
  );
  return (
    <div data-slot="record-list" className={cn("flex flex-col gap-3", className)}>
      <output className="sr-only">{isLoading ? `Loading ${itemNoun}.` : ""}</output>
      {showTable ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <output className="text-sm text-muted-foreground">{selectionSummary}</output>
            {visibilityItems.length > 0 && !suppressColumnVisibilityMenu ? <ColumnVisibilityMenu tableLabel={label} items={visibilityItems} visibleCount={visibleDataColumnCount} onToggle={handleToggleColumn} onShowAll={handleShowAllColumns} /> : null}
          </div>
          <ScrollRegion label={`${label}, scrollable`} stickyOffset={resolvedStickyOffset} maxHeight={maxHeight} aria-busy={isLoading ? true : undefined}>
            <Table>
              <TableCaption className="sr-only">{label}</TableCaption>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => {
                      if (header.isPlaceholder) return <TableHead key={header.id} scope="col" className={HEAD_CELL_CLASS} />;
                      const column = header.column;
                      if (column.id === SELECT_COLUMN_ID) {
                        return (
                          <TableHead key={header.id} scope="col" className={cn(HEAD_CELL_CLASS, "w-10")}>
                            <Checkbox className={MIXED_CHECKBOX_CLASS} checked={allOnPageSelected} indeterminate={!allOnPageSelected && someOnPageSelected} disabled={bodyRows.length === 0} onCheckedChange={(checked) => handleSelectAllOnPage(checked)} aria-label={`Select all ${itemNoun} on this page`} />
                          </TableHead>
                        );
                      }
                      if (column.id === ACTIONS_COLUMN_ID) {
                        return (
                          <TableHead key={header.id} scope="col" className={cn(HEAD_CELL_CLASS, "w-10 text-end")}>
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        );
                      }
                      const canSort = column.getCanSort();
                      const sortDirection = column.getIsSorted();
                      const ariaSort = sortDirection === "asc" ? "ascending" : sortDirection === "desc" ? "descending" : "none";
                      return (
                        <TableHead key={header.id} scope="col" aria-sort={canSort ? ariaSort : undefined} className={HEAD_CELL_CLASS}>
                          {canSort ? (
                            <Button variant="ghost" size="sm" className="-ms-3 max-w-full focus-visible:ring-ring" onClick={() => handleSort(column)}>
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
                      <TableRow key={`record-list-loading-${loadingRowIndex}`} className="hover:bg-transparent">
                        {visibleLeafColumns.map((column) => (
                          <TableCell key={column.id}>
                            <Skeleton aria-hidden="true" className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : bodyRows.map((row) => (
                      <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                        {row.getVisibleCells().map((cell, cellIndex) => {
                          if (cell.column.id === SELECT_COLUMN_ID) {
                            return (
                              <TableCell key={cell.id} className="w-10">
                                <Checkbox checked={row.getIsSelected()} onCheckedChange={(checked) => handleRowSelectedChange(row.id, checked)} {...selectionLabelFor(row)} />
                              </TableCell>
                            );
                          }
                          if (cell.column.id === ACTIONS_COLUMN_ID) {
                            return (
                              <TableCell key={cell.id} className="w-10 text-end">
                                <RowResultsIdContext.Provider value={rowResultsId}>{rowActions === undefined ? null : rowActions(row.original)}</RowResultsIdContext.Provider>
                              </TableCell>
                            );
                          }
                          return (
                            <TableCell key={cell.id} id={cellIndex === firstDataCellIndex ? rowLabelId(row.index) : undefined}>
                              <table.FlexRender cell={cell} />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </ScrollRegion>
          {/* A row's settled result renders here, at the list's full width: inside the row's actions cell it widened the table past a phone's viewport and scrolled the table region onto the cell it sat in. `empty:hidden` keeps the region out of the layout while no row has a result, so it adds no gap above the pager. */}
          <div id={rowResultsId} data-slot="record-list-row-results" className="flex min-w-0 flex-col gap-2 text-pretty wrap-anywhere empty:hidden" />
          {pager}
        </>
      ) : (
        <>
          {emptyNotice}
          {pager}
        </>
      )}
    </div>
  );
}
export default RecordList;
