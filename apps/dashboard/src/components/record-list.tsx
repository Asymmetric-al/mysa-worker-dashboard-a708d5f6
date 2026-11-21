"use client";
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
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
export const recordListFeatures = tableFeatures({ rowSortingFeature, rowSelectionFeature, columnVisibilityFeature, rowPaginationFeature });
export type RecordListFeatureSet = typeof recordListFeatures;
export type RecordListColumnDef<TRow extends RowData> = ColumnDef<RecordListFeatureSet, TRow>;
export type SortDescriptor = ColumnSort;
/** The list state the owner controls, passed straight through to the service query. */
export type RecordListQueryState = { sort: SortDescriptor[]; page: number; pageSize: number; columnVisibility: ColumnVisibilityState };
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
  pageSizeOptions?: readonly number[];
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  stickyOffset?: string;
  maxHeight?: string;
  className?: string;
};
const SELECT_COLUMN_ID = "__record_list_select";
const ACTIONS_COLUMN_ID = "__record_list_actions";
const DEFAULT_STICKY_OFFSET = "calc(var(--app-shell-sticky-offset, 4rem) + 3rem)";
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
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : "";
}
function SortIndicator({ direction }: { readonly direction: SortDirection | false }): ReactElement {
  const Icon = direction === "asc" ? ArrowUpIcon : direction === "desc" ? ArrowDownIcon : ChevronsUpDownIcon;
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", direction === false ? "text-muted-foreground" : "text-foreground")} />;
}
type ColumnVisibilityMenuProps = { readonly tableLabel: string; readonly items: ReadonlyArray<ColumnVisibilityItem>; readonly visibleCount: number; readonly onToggle: (columnId: string, visible: boolean) => void; readonly onShowAll: () => void };
function ColumnVisibilityMenu({ tableLabel, items, visibleCount, onToggle, onShowAll }: ColumnVisibilityMenuProps): ReactElement {
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
          // A visible column that is the only one left is disabled, so the rule is visible before it is hit rather than silently swallowing the click.
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
}
const EMPTY_SELECTION: ReadonlyArray<string> = [];
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
function normalisePageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return FALLBACK_PAGE_SIZE;
  const whole = Math.trunc(pageSize);
  return whole >= 1 ? whole : FALLBACK_PAGE_SIZE;
}
/** The one table preset: a processed page of rows, rendered with selection, sorting, column visibility and an honest pager, inside the application's only horizontal scroll region. */
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
  // The feature's columns, bracketed by the preset's own two cells. Memoized because `useTable` rebuilds its column instances when the array identity changes, and a feature may well build its column array inline.
  const tableColumns = useMemo<RecordListColumnDef<TRow>[]>(
    () => [...(selectionEnabled ? [{ id: SELECT_COLUMN_ID, enableSorting: false, enableHiding: false }] : []), ...columns, ...(actionsEnabled ? [{ id: ACTIONS_COLUMN_ID, enableSorting: false, enableHiding: false }] : [])],
    [columns, selectionEnabled, actionsEnabled],
  );
  // The controlled selection slice, derived one way from the ids the owner holds. v9 reads selection as a record of selected ids, so the identity is a record id and never a row position.
  const rowSelection = useMemo<RowSelectionState>(() => Object.fromEntries(selectedKeys.map((id) => [id, true])), [selectedKeys]);
  const pageSize = normalisePageSize(queryState.pageSize);
  const table = useTable({
    features: recordListFeatures,
    columns: tableColumns,
    data: rows,
    getRowId,
    state: { sorting: queryState.sort, columnVisibility: queryState.columnVisibility, rowSelection, pagination: { pageIndex: Math.max(0, Math.trunc(queryState.page) - 1), pageSize } },
    // Every stage belongs to the service. Manual pagination plus `rowCount` is also what makes `getRowCount()` report the whole result, so the pager can never print the size of one page.
    manualSorting: true,
    manualPagination: true,
    rowCount: Math.max(0, Math.trunc(rowCount)),
    enableMultiSort: false,
    // A column states its own `header` and `cell`. Where it does not, the heading falls back to the column id and the body to the record's own value, so an unlabelled column of blank cells — which is both a rendering gap and an accessibility failure — cannot happen.
    defaultColumn: { header: defaultHeader, cell: defaultCell },
  });
  // Read back through the controlled slice rather than the props, so the pager and the sort affordances below are describing the state the table actually holds.
  const pagination = table.state.pagination;
  // Every row the body renders and every column it renders for each: read once, so the header, the selection control, the skeleton and the body all describe the same page.
  const bodyRows = table.getRowModel().rows;
  const visibleLeafColumns = table.getVisibleLeafColumns();
  const allOnPageSelected = table.getIsAllPageRowsSelected();
  const someOnPageSelected = table.getIsSomePageRowsSelected();
  const signature = querySignature(queryState);
  const signatureRef = useRef(signature);
  // A selection belongs to the query that produced it. Once a filter, a sort, a page or a visible column set changes, the selected ids may name rows the worker can no longer see, so the selection is cleared rather than carried into an action over invisible records.
  useEffect(() => {
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    if (onSelectionChange !== undefined && selectedKeys.length > 0) onSelectionChange([]);
  }, [signature, selectedKeys, onSelectionChange]);
  // The latest query state this component dispatched, so two changes raised in one event — the pager asking for a new size and then for the page that keeps the first visible row in view — compose into one next state instead of the second overwriting the first from a stale prop.
  const latestQuery = useRef(queryState);
  useEffect(() => {
    latestQuery.current = queryState;
  }, [queryState]);
  function commitQuery(patch: Partial<RecordListQueryState>): void {
    const next: RecordListQueryState = { ...latestQuery.current, ...patch };
    latestQuery.current = next;
    onQueryStateChange(next);
  }
  // The header cell is the only place a sort can start. It asks the library for the next order so a column's own descending-first and no-removal policies are honoured, then dispatches the new ordering to the service: nothing is sorted in the browser.
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
  // Hiding a column changes what the worker can see of a selected row but not which rows exist, so the page stays where it is; the selection still clears, through the query signature above.
  function handleToggleColumn(columnId: string, visible: boolean): void {
    if (!visible && visibleDataColumnCount <= 1) return;
    // Composed from the latest dispatched state rather than the prop, so two toggles cannot lose the first: the menu stays open while the reader shows and hides several columns.
    commitQuery({ columnVisibility: { ...latestQuery.current.columnVisibility, [columnId]: visible } });
  }
  function handleShowAllColumns(): void {
    commitQuery({ columnVisibility: {} });
  }
  const setSelection = (next: ReadonlySet<string>): void => onSelectionChange?.(Array.from(next));
  function handleRowSelectedChange(rowId: string, selected: boolean): void {
    const next = new Set(selectedKeys);
    if (selected) next.add(rowId);
    else next.delete(rowId);
    setSelection(next);
  }
  // The header control selects the rows this page holds — the rows the worker can actually see — and leaves anything selected elsewhere untouched. It is never a "select all matching rows" shortcut, because that would select records the worker has not looked at.
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
  const resolvedStickyOffset = stickyOffset ?? DEFAULT_STICKY_OFFSET;
  function rowLabelId(rowIndex: number): string {
    return `${cellIdBase}-row-${rowIndex}-label`;
  }
  function selectionLabelFor(row: Row<RecordListFeatureSet, TRow>): { "aria-label"?: string; "aria-labelledby"?: string } {
    const name = rowLabel === undefined ? "" : rowLabel(row.original).trim();
    if (name !== "") return { "aria-label": `Select ${name}` };
    return visibleDataColumnCount > 0 ? { "aria-labelledby": rowLabelId(row.index) } : { "aria-label": `Select row ${row.index + 1}` };
  }
  const selectedCount = selectedKeys.length;
  const selectionSummary = selectedCount === 0 ? "" : `${countFormat.format(selectedCount)} selected. A selection is not an audience or a consent: the action you choose re-checks every selected row.`;
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
      description="The filters and search on this surface are narrowing the result, so this is not an empty collection. Clearing them shows every record the current scope permits."
      action={onClearFilters === undefined ? undefined : { label: "Clear filters", onClick: onClearFilters }}
    />
  ) : (
    <div className="flex flex-col items-center gap-4">
      <StateNotice kind="empty" title={`No ${itemNoun} yet`} />
      {emptyAction}
    </div>
  );
  return (
    <div data-slot="record-list" className={cn("flex flex-col gap-3", className)}>
      {/* One persistent polite status region: it reports the busy condition as it starts, instead of mounting a live region that already holds its message, which a screen reader never reads. */}
      <output className="sr-only">{isLoading ? `Loading ${itemNoun}.` : ""}</output>
      {showTable ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {/* One persistent polite status line: it announces the selection as it changes and, while nothing is selected, states nothing rather than disappearing from the layout. */}
            <output className="text-sm text-muted-foreground">{selectionSummary}</output>
            {visibilityItems.length > 0 ? <ColumnVisibilityMenu tableLabel={label} items={visibilityItems} visibleCount={visibleDataColumnCount} onToggle={handleToggleColumn} onShowAll={handleShowAllColumns} /> : null}
          </div>
          <ScrollRegion label={`${label}, scrollable`} stickyOffset={resolvedStickyOffset} maxHeight={maxHeight} aria-busy={isLoading ? true : undefined}>
            <Table>
              <TableCaption className="sr-only">{label}</TableCaption>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => {
                      if (header.isPlaceholder) {
                        // Only a grouped header tree produces placeholders, which this preset cannot build; the empty cell keeps the grid aligned if one ever appears.
                        return <TableHead key={header.id} scope="col" className={HEAD_CELL_CLASS} />;
                      }
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
                            // The design system's Button, not a click handler on the cell: Tab reaches it, Enter and Space activate it, and no drag takes part in sorting (WCAG 2.5.7); `size="sm"` is 32 CSS px, above the 24x24 floor of 2.5.8, and `-ms-3` aligns the label with the non-sortable headings.
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
                                {rowActions === undefined ? null : rowActions(row.original)}
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
          <PaginationBar total={table.getRowCount()} page={pagination.pageIndex + 1} pageSize={pagination.pageSize} pageSizeOptions={pageSizeOptions} onPageChange={(page) => commitQuery({ page })} onPageSizeChange={(nextPageSize) => commitQuery({ pageSize: nextPageSize })} itemNoun={itemNoun} disabled={isLoading} />
        </>
      ) : (
        emptyNotice
      )}
    </div>
  );
}
export default RecordList;
