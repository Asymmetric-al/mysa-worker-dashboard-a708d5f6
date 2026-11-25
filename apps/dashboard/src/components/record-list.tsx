"use client";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type CellContext,
  type Column,
  type ColumnDef,
  type ColumnPinningState,
  type ColumnSizingState,
  type ColumnSort,
  type ColumnVisibilityState,
  type ExpandedState,
  type HeaderContext,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { PaginationBar } from "@/components/pagination-bar";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DataGridBody,
  DataGridColumnHeaderButton,
  DataGridColumnHeaderMenu,
  DataGridColumnResizeHandle,
  DataGridContainer,
  DataGridExpandAllButton,
  DataGridExpandButton,
  DataGridFooter,
  DataGridHeader,
  DataGridSkeletonRows,
  DataGridViewSettings,
  type DataGridColumnControlItem,
  type DataGridDensity,
} from "@/components/ui/data-grid";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import {
  buildColumnOrder,
  COLUMN_WIDTH_DEFAULT,
  moveColumnId,
  pinnedSideOf,
  shouldVirtualizeRows,
  stepColumnWidth,
  togglePinnedColumn,
  VIRTUAL_ROW_THRESHOLD,
  type LogicalColumnPinning,
} from "@/lib/data-grid-utils";
import type { SourceReference } from "@/lib/ids";

export const recordListFeatures = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnOrderingFeature,
  rowExpandingFeature,
});

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
  /** Optional inline expandable sub-row renderer (ReUI Data Grid expandable row pattern). Collapsed by default so DOM row counts match visible page rows. */
  renderExpandedRow?: (row: TRow) => ReactNode;
  /** Logical start/end columns pinned by default on desktop (`md+`) inside the single `ScrollRegion`. */
  initialPinnedColumns?: { readonly start?: readonly string[]; readonly end?: readonly string[] };
  /** Opt-in TanStack Virtual windowing for large row pages (also toggleable in Grid View settings when > 40 rows). */
  virtualize?: boolean;
  itemNoun?: string;
  /** The interface locale this list formats its counts in, stated by the route that composes it; left off, the application default interface locale applies. */ locale?: string;
  pageSizeOptions?: readonly number[];
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  /** Whether the surface around this list already offers the one column-visibility control for the same column state: the list then renders no visibility toggles in its own view menu, while still offering density, pinning, ordering and width tuning. */ suppressColumnVisibilityMenu?: boolean;
  /** A surface's own notice for a result no filter narrows and an empty collection, replacing this list's generic one where the surface knows what an empty collection means for its own records; the first action it offers belongs inside it. */ emptyState?: ReactNode;
  stickyOffset?: string;
  maxHeight?: string;
  className?: string;
};

const EXPAND_COLUMN_ID = "__record_list_expand";
const SELECT_COLUMN_ID = "__record_list_select";
const ACTIONS_COLUMN_ID = "__record_list_actions";
const LOADING_ROW_MINIMUM = 3;
const LOADING_ROW_MAXIMUM = 8;
const FALLBACK_PAGE_SIZE = 50;
const UTILITY_COLUMN_WIDTH_PX = 44;
const VIRTUAL_DEFAULT_MAX_HEIGHT = "34rem";
const HEAD_CELL_CLASS = "sticky top-0 z-10 bg-surface-subtle";
const MIXED_CHECKBOX_CLASS = cn(
  "data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground",
  "data-[indeterminate]:[&_svg]:opacity-0",
  "data-[indeterminate]:before:absolute data-[indeterminate]:before:inset-0 data-[indeterminate]:before:m-auto",
  "data-[indeterminate]:before:h-[2px] data-[indeterminate]:before:w-2 data-[indeterminate]:before:rounded-full",
  "data-[indeterminate]:before:bg-primary-foreground data-[indeterminate]:before:content-['']",
);

function querySignature(queryState: RecordListQueryState): string {
  const sorting = queryState.sort.map((entry) => `${entry.id}:${entry.desc ? "desc" : "asc"}`).join(",");
  const visibility = Object.keys(queryState.columnVisibility)
    .sort()
    .map((id) => `${id}:${queryState.columnVisibility[id] === true ? "1" : "0"}`)
    .join(",");
  return `${queryState.page}|${queryState.pageSize}|${sorting}|${visibility}`;
}

const SCROLL_PLACE_TOLERANCE_PX = 2;
const SCROLL_PLACE_FRAME_BUDGET = 90;
const SCROLL_PLACE_STALLED_FRAMES = 60;

function storedScrollPlace(key: string): number | undefined {
  try {
    const stated = window.sessionStorage.getItem(key);
    const place = stated === null ? 0 : Number(stated);
    return Number.isSafeInteger(place) && place > 0 ? place : undefined;
  } catch {
    return undefined;
  }
}

function storeScrollPlace(key: string, place: number): void {
  try {
    window.sessionStorage.setItem(key, String(place));
  } catch {
    // A browser that refuses session storage leaves the place unrecorded and the list unaffected.
  }
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

const EMPTY_SELECTION: ReadonlyArray<string> = [];
function normalisePageSize(pageSize: number): number {
  const whole = Math.trunc(pageSize);
  return Number.isFinite(pageSize) && whole >= 1 ? whole : FALLBACK_PAGE_SIZE;
}

const FIRST_PAGE = 1;
const WINDOW_PARAM = { page: "page", pageSize: "pageSize" } as const;

function wholeWindowNumber(stated: number, current: number): number {
  if (!Number.isFinite(stated)) return current;
  const whole = Math.trunc(stated);
  return whole >= FIRST_PAGE ? whole : current;
}

function statedWindowNumber(search: ReadonlyURLSearchParams, name: string): number | undefined {
  const stated = search.get(name);
  if (stated === null) return undefined;
  const parsed = Number(stated);
  return Number.isSafeInteger(parsed) && parsed >= FIRST_PAGE ? parsed : undefined;
}

/** The page window of a list a reader returns to, kept in the address rather than in the component. */
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
      if (nextPage === page && nextPageSize === pageSize) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set(WINDOW_PARAM.page, String(nextPage));
      params.set(WINDOW_PARAM.pageSize, String(nextPageSize));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [page, pageSize, pathname, router, searchParams],
  );
  return { page, pageSize, setWindow };
}

function isSystemColumn(columnId: string): boolean {
  return columnId === EXPAND_COLUMN_ID || columnId === SELECT_COLUMN_ID || columnId === ACTIONS_COLUMN_ID;
}

/** The one ReUI-backed Data Grid preset: selection, sorting, visibility, logical column pinning, accessible resizing, keyboard column ordering, expandable sub-rows, optional virtualization, and an honest pager inside the application's single horizontal scroll region. */
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
  renderExpandedRow,
  initialPinnedColumns,
  virtualize = false,
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scrollRegionRef = useRef<HTMLElement | null>(null);

  const initialPinning = useMemo<LogicalColumnPinning>(
    () => ({
      start: initialPinnedColumns?.start ?? [],
      end: initialPinnedColumns?.end ?? [],
    }),
    [initialPinnedColumns],
  );

  const [density, setDensity] = useState<DataGridDensity>("default");
  const [logicalPinning, setLogicalPinning] = useState<LogicalColumnPinning>(initialPinning);
  const [customColumnOrder, setCustomColumnOrder] = useState<readonly string[]>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [virtualEnabled, setVirtualEnabled] = useState<boolean>(virtualize);

  const expandEnabled = renderExpandedRow !== undefined;
  const selectionEnabled = onSelectionChange !== undefined;
  const actionsEnabled = rowActions !== undefined;
  const selectedKeys = selectedIds ?? EMPTY_SELECTION;

  const dataColumnIds = useMemo<readonly string[]>(() => columns.map((col, idx) => col.id ?? ("accessorKey" in col && typeof col.accessorKey === "string" ? col.accessorKey : `col-${String(idx)}`)), [columns]);

  const leadingFixedIds = useMemo<readonly string[]>(() => [...(expandEnabled ? [EXPAND_COLUMN_ID] : []), ...(selectionEnabled ? [SELECT_COLUMN_ID] : [])], [expandEnabled, selectionEnabled]);
  const trailingFixedIds = useMemo<readonly string[]>(() => (actionsEnabled ? [ACTIONS_COLUMN_ID] : []), [actionsEnabled]);

  const tableColumns = useMemo<RecordListColumnDef<TRow>[]>(
    () => [
      ...(expandEnabled ? [{ id: EXPAND_COLUMN_ID, enableSorting: false, enableHiding: false, size: UTILITY_COLUMN_WIDTH_PX }] : []),
      ...(selectionEnabled ? [{ id: SELECT_COLUMN_ID, enableSorting: false, enableHiding: false, size: UTILITY_COLUMN_WIDTH_PX }] : []),
      ...columns,
      ...(actionsEnabled ? [{ id: ACTIONS_COLUMN_ID, enableSorting: false, enableHiding: false }] : []),
    ],
    [columns, expandEnabled, selectionEnabled, actionsEnabled],
  );

  const resolvedOrder = useMemo<string[]>(() => buildColumnOrder(dataColumnIds, customColumnOrder, leadingFixedIds, trailingFixedIds), [dataColumnIds, customColumnOrder, leadingFixedIds, trailingFixedIds]);

  const effectivePinning = useMemo<LogicalColumnPinning>(() => {
    const startPinnedData = logicalPinning.start.filter((id) => dataColumnIds.includes(id));
    const endPinnedData = logicalPinning.end.filter((id) => dataColumnIds.includes(id));
    return {
      start: startPinnedData.length > 0 ? [...leadingFixedIds, ...startPinnedData] : [],
      end: endPinnedData.length > 0 || (actionsEnabled && startPinnedData.length > 0) ? [...endPinnedData, ...trailingFixedIds] : [],
    };
  }, [actionsEnabled, dataColumnIds, leadingFixedIds, logicalPinning.end, logicalPinning.start, trailingFixedIds]);

  const tanstackPinning = useMemo<ColumnPinningState>(
    () => ({
      left: [...effectivePinning.start],
      right: [...effectivePinning.end],
      start: [...effectivePinning.start],
      end: [...effectivePinning.end],
    }),
    [effectivePinning],
  );

  const rowSelection = useMemo<RowSelectionState>(() => Object.fromEntries(selectedKeys.map((id) => [id, true])), [selectedKeys]);
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
      pagination: { pageIndex: Math.max(0, Math.trunc(queryState.page) - 1), pageSize },
      columnPinning: tanstackPinning,
      columnOrder: resolvedOrder,
      columnSizing,
      expanded,
    },
    manualSorting: true,
    manualPagination: true,
    rowCount: Math.max(0, Math.trunc(rowCount)),
    enableMultiSort: false,
    getRowCanExpand: () => expandEnabled,
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
    setExpanded({});
    if (onSelectionChange !== undefined && selectedKeys.length > 0) onSelectionChange([]);
  }, [signature, selectedKeys, onSelectionChange]);

  const latestQuery = useRef(queryState);
  useEffect(() => {
    latestQuery.current = queryState;
  }, [queryState]);

  const scrollPlaceKey = `${pathname}?${searchParams.toString()}|${label}|${signature}`;
  useEffect(() => {
    const place = storedScrollPlace(scrollPlaceKey);
    const readerHoldsFocus = document.activeElement !== null && document.activeElement !== document.body && document.activeElement !== document.documentElement;
    let restoring = place !== undefined && !readerHoldsFocus;
    let observed = window.scrollY;
    let writeFrame = 0;
    let restoreFrame = 0;
    let steps = 0;
    let stalled = 0;
    let reachable = document.documentElement.scrollHeight - window.innerHeight;
    const write = (): void => {
      writeFrame = 0;
      storeScrollPlace(scrollPlaceKey, observed);
    };
    const onScroll = (): void => {
      observed = window.scrollY;
      if (restoring || writeFrame !== 0) return;
      writeFrame = window.requestAnimationFrame(write);
    };
    const flush = (): void => {
      if (!restoring) storeScrollPlace(scrollPlaceKey, observed);
    };
    const settle = (): void => {
      restoring = false;
      observed = window.scrollY;
    };
    const yieldToReader = (): void => {
      if (!restoring) return;
      if (restoreFrame !== 0) window.cancelAnimationFrame(restoreFrame);
      restoreFrame = 0;
      settle();
    };
    const step = (): void => {
      restoreFrame = 0;
      if (!restoring) return;
      if (place === undefined || Math.abs(window.scrollY - place) <= SCROLL_PLACE_TOLERANCE_PX) {
        settle();
        return;
      }
      window.scrollTo(0, place);
      steps += 1;
      const reached = document.documentElement.scrollHeight - window.innerHeight;
      stalled = reached <= reachable && reached < place - SCROLL_PLACE_TOLERANCE_PX ? stalled + 1 : 0;
      reachable = reached;
      if (steps >= SCROLL_PLACE_FRAME_BUDGET || stalled >= SCROLL_PLACE_STALLED_FRAMES) {
        settle();
        return;
      }
      restoreFrame = window.requestAnimationFrame(step);
    };
    if (!restoring) settle();
    else restoreFrame = window.requestAnimationFrame(step);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    window.addEventListener("focusin", yieldToReader, true);
    window.addEventListener("keydown", yieldToReader, true);
    window.addEventListener("pointerdown", yieldToReader, { passive: true });
    window.addEventListener("wheel", yieldToReader, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("focusin", yieldToReader, true);
      window.removeEventListener("keydown", yieldToReader, true);
      window.removeEventListener("pointerdown", yieldToReader);
      window.removeEventListener("wheel", yieldToReader);
      if (writeFrame !== 0) window.cancelAnimationFrame(writeFrame);
      if (restoreFrame !== 0) window.cancelAnimationFrame(restoreFrame);
      flush();
    };
  }, [scrollPlaceKey]);

  const virtualActive = !isLoading && shouldVirtualizeRows(bodyRows.length, virtualEnabled);
  // TanStack Virtual's hook manages an imperative virtualizer instance that React Compiler intentionally skips memoizing.
  // oxlint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: virtualActive ? bodyRows.length : 0,
    getScrollElement: () => scrollRegionRef.current,
    estimateSize: () => (density === "dense" ? 40 : 52),
    overscan: 8,
  });

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

  function handleSetSortDirection(columnId: string, direction: "asc" | "desc" | false): void {
    const sort: SortingState = direction === false ? [] : [{ id: columnId, desc: direction === "desc" }];
    commitQuery({ sort, page: 1 });
  }

  const orderedDataIds = useMemo<readonly string[]>(() => {
    const currentData = resolvedOrder.filter((id) => !isSystemColumn(id));
    return currentData;
  }, [resolvedOrder]);

  const controlItems: ReadonlyArray<DataGridColumnControlItem> = useMemo(() => {
    const byId = new Map(table.getAllLeafColumns().map((column) => [column.id, column]));
    return orderedDataIds.flatMap((id, index) => {
      const column = byId.get(id);
      if (column === undefined) return [];
      return [
        {
          id,
          label: columnLabel(column),
          visible: column.getIsVisible(),
          canHide: column.getCanHide(),
          pinned: pinnedSideOf(logicalPinning, id),
          canMoveStart: index > 0,
          canMoveEnd: index < orderedDataIds.length - 1,
          widthPx: columnSizing[id],
        },
      ];
    });
  }, [columnSizing, logicalPinning, orderedDataIds, table]);

  const visibleDataColumnCount = controlItems.reduce((count, item) => (item.visible ? count + 1 : count), 0);

  function handleToggleColumn(columnId: string, visible: boolean): void {
    if (!visible && visibleDataColumnCount <= 1) return;
    commitQuery({ columnVisibility: { ...latestQuery.current.columnVisibility, [columnId]: visible } });
  }

  function handleTogglePinStart(columnId: string, nextPinned: boolean): void {
    setLogicalPinning((previous) => togglePinnedColumn(previous, columnId, nextPinned ? "start" : false));
  }

  function handleMoveColumn(columnId: string, direction: "start" | "end"): void {
    setCustomColumnOrder((previous) => {
      const base = previous.length === 0 ? dataColumnIds : buildColumnOrder(dataColumnIds, previous, [], []);
      return moveColumnId(base, columnId, direction);
    });
  }

  function handleStepColumnWidth(columnId: string, deltaPx: number): void {
    setColumnSizing((previous) => ({
      ...previous,
      [columnId]: stepColumnWidth(previous[columnId] ?? COLUMN_WIDTH_DEFAULT, deltaPx),
    }));
  }

  const hasCustomLayout =
    customColumnOrder.length > 0 ||
    Object.keys(columnSizing).length > 0 ||
    Object.values(queryState.columnVisibility).some((value) => value === false) ||
    logicalPinning.start.join(",") !== initialPinning.start.join(",") ||
    logicalPinning.end.join(",") !== initialPinning.end.join(",");

  function handleResetLayout(): void {
    setDensity("default");
    setLogicalPinning(initialPinning);
    setCustomColumnOrder([]);
    setColumnSizing({});
    setVirtualEnabled(virtualize);
    if (!suppressColumnVisibilityMenu) commitQuery({ columnVisibility: {} });
  }

  function toggleRowExpanded(rowId: string): void {
    setExpanded((previous) => {
      const record = typeof previous === "boolean" ? {} : previous;
      const nextValue = !record[rowId];
      if (!nextValue) {
        const rest = { ...record };
        delete rest[rowId];
        return rest;
      }
      return { ...record, [rowId]: true };
    });
  }

  const isRowExpanded = (rowId: string): boolean => (typeof expanded === "boolean" ? expanded : expanded[rowId] === true);
  const allRowsExpanded = expandEnabled && bodyRows.length > 0 && bodyRows.every((row) => isRowExpanded(row.id));
  function toggleAllRowsExpanded(): void {
    if (!expandEnabled || bodyRows.length === 0) return;
    if (allRowsExpanded) {
      setExpanded({});
      return;
    }
    setExpanded(Object.fromEntries(bodyRows.map((row) => [row.id, true])));
  }

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

  // Compute logical sticky start/end offsets as CSS custom properties consumed exclusively at >= md (48rem) so narrow viewports never shift relative cells,
  // and mirror their totals as horizontal scroll padding so focused or scrolled controls always clear pinned start/end columns (WCAG 2.4.11).
  const stickyLayout = useMemo(() => {
    const byColumn: Record<string, { readonly side: "start" | "end"; readonly style: CSSProperties }> = {};
    let startOffset = 0;
    for (const column of visibleLeafColumns) {
      if (effectivePinning.start.includes(column.id)) {
        byColumn[column.id] = { side: "start", style: { "--pin-start-offset": `${String(startOffset)}px` } as CSSProperties };
        const width = isSystemColumn(column.id) ? UTILITY_COLUMN_WIDTH_PX : (columnSizing[column.id] ?? COLUMN_WIDTH_DEFAULT);
        startOffset += width;
      }
    }
    let endOffset = 0;
    for (let index = visibleLeafColumns.length - 1; index >= 0; index -= 1) {
      const column = visibleLeafColumns[index];
      if (column !== undefined && effectivePinning.end.includes(column.id)) {
        byColumn[column.id] = { side: "end", style: { "--pin-end-offset": `${String(endOffset)}px` } as CSSProperties };
        const width = isSystemColumn(column.id) ? UTILITY_COLUMN_WIDTH_PX : (columnSizing[column.id] ?? COLUMN_WIDTH_DEFAULT);
        endOffset += width;
      }
    }
    return { byColumn, totalStartPx: startOffset, totalEndPx: endOffset };
  }, [columnSizing, effectivePinning.end, effectivePinning.start, visibleLeafColumns]);
  const stickyStyleByColumn = stickyLayout.byColumn;
  const scrollRegionPinStyle = useMemo<CSSProperties | undefined>(() => {
    if (stickyLayout.totalStartPx === 0 && stickyLayout.totalEndPx === 0) return undefined;
    return {
      ...(stickyLayout.totalStartPx > 0 ? { "--pin-scroll-pad-start": `${String(stickyLayout.totalStartPx + 16)}px` } : {}),
      ...(stickyLayout.totalEndPx > 0 ? { "--pin-scroll-pad-end": `${String(stickyLayout.totalEndPx + 24)}px` } : {}),
    } as CSSProperties;
  }, [stickyLayout.totalEndPx, stickyLayout.totalStartPx]);

  const widthStyleFor = (columnId: string): CSSProperties | undefined => {
    const explicit = columnSizing[columnId];
    return explicit === undefined ? undefined : { width: `${String(explicit)}px`, minWidth: `${String(explicit)}px`, maxWidth: `${String(explicit)}px` };
  };

  const firstDataCellIndex = leadingFixedIds.length;
  const loadingRowCount = Math.min(Math.max(LOADING_ROW_MINIMUM, pageSize), LOADING_ROW_MAXIMUM);
  const showTable = isLoading || bodyRows.length > 0;
  const resolvedStickyOffset = stickyOffset ?? "calc(var(--app-shell-sticky-offset, 4rem) + 3rem)";
  const resolvedMaxHeight = maxHeight ?? (virtualActive ? VIRTUAL_DEFAULT_MAX_HEIGHT : undefined);
  const rowLabelId = (rowIndex: number): string => `${cellIdBase}-row-${rowIndex}-label`;

  function labelForRow(row: Row<RecordListFeatureSet, TRow>): string {
    const stated = rowLabel === undefined ? "" : rowLabel(row.original).trim();
    return stated !== "" ? stated : `row ${row.index + 1}`;
  }

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

  const totalRows = table.getRowCount();
  const activeSort = queryState.sort[0];
  const activeSortColumn = activeSort === undefined ? undefined : controlItems.find((item) => item.id === activeSort.id);
  const controlById = useMemo(() => new Map(controlItems.map((item) => [item.id, item])), [controlItems]);
  const hiddenColumnCount = controlItems.reduce((count, item) => (item.visible ? count : count + 1), 0);
  const pinnedDataColumnCount = logicalPinning.start.filter((id) => dataColumnIds.includes(id)).length;

  const renderDataRow = (row: Row<RecordListFeatureSet, TRow>): ReactElement => {
    const rowExpanded = expandEnabled && isRowExpanded(row.id);
    const cells = row.getVisibleCells();
    return (
      <Fragment key={row.id}>
        <TableRow data-state={row.getIsSelected() ? "selected" : undefined}>
          {cells.map((cell, cellIndex) => {
            const colId = cell.column.id;
            const pinned = stickyStyleByColumn[colId];
            const sizeStyle = widthStyleFor(colId);
            const cellStyle: CSSProperties | undefined = pinned === undefined && sizeStyle === undefined ? undefined : { ...sizeStyle, ...pinned?.style };
            const pinnedAttr = pinned?.side;
            if (colId === EXPAND_COLUMN_ID) {
              return (
                <TableCell key={cell.id} data-pinned={pinnedAttr} style={cellStyle} className="w-11">
                  <DataGridExpandButton expanded={rowExpanded} label={labelForRow(row)} onToggle={() => toggleRowExpanded(row.id)} />
                </TableCell>
              );
            }
            if (colId === SELECT_COLUMN_ID) {
              return (
                <TableCell key={cell.id} data-pinned={pinnedAttr} style={cellStyle} className="w-11">
                  <Checkbox checked={row.getIsSelected()} onCheckedChange={(checked) => handleRowSelectedChange(row.id, checked)} {...selectionLabelFor(row)} />
                </TableCell>
              );
            }
            if (colId === ACTIONS_COLUMN_ID) {
              return (
                <TableCell key={cell.id} data-pinned={pinnedAttr} style={cellStyle} className="w-11 text-end">
                  {rowActions === undefined ? null : rowActions(row.original)}
                </TableCell>
              );
            }
            return (
              <TableCell key={cell.id} id={cellIndex === firstDataCellIndex ? rowLabelId(row.index) : undefined} data-pinned={pinnedAttr} style={cellStyle} className={sizeStyle === undefined ? undefined : "overflow-hidden text-ellipsis"}>
                <table.FlexRender cell={cell} />
              </TableCell>
            );
          })}
        </TableRow>
        {rowExpanded && renderExpandedRow !== undefined ? (
          <TableRow data-slot="data-grid-expanded-row" className="bg-surface-subtle/90 hover:bg-surface-subtle/90">
            <TableCell colSpan={cells.length} className="whitespace-normal p-4">
              {renderExpandedRow(row.original)}
            </TableCell>
          </TableRow>
        ) : null}
      </Fragment>
    );
  };

  const virtualItems = virtualActive ? rowVirtualizer.getVirtualItems() : [];
  const topSpacerHeight = virtualActive && virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const bottomSpacerHeight = virtualActive && virtualItems.length > 0 ? Math.max(0, rowVirtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0)) : 0;

  return (
    <div data-slot="record-list" className={cn("flex flex-col gap-3", className)}>
      <output className="sr-only">{isLoading ? `Loading ${itemNoun}.` : ""}</output>
      {showTable ? (
        <DataGridContainer density={density} virtualized={virtualActive}>
          <DataGridHeader>
            {selectionSummary !== "" ? (
              <output className="text-sm text-muted-foreground">{selectionSummary}</output>
            ) : (
              <>
                <output className="sr-only">{selectionSummary}</output>
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <span className="tabular-figures rounded-4xl border border-border/80 bg-card px-2 py-0.5 text-foreground shadow-2xs">{countFormatOf(locale).format(totalRows)}</span>
                    <span>{itemNoun}</span>
                  </span>
                  {activeSort !== undefined && activeSortColumn !== undefined ? <span className="hidden rounded-4xl bg-secondary px-2 py-0.5 text-xs text-secondary-foreground sm:inline-flex">{`Sorted by ${activeSortColumn.label} (${activeSort.desc ? "desc" : "asc"})`}</span> : null}
                  {pinnedDataColumnCount > 0 ? <span className="hidden rounded-4xl border border-border/80 bg-card px-2 py-0.5 text-xs text-muted-foreground lg:inline-flex">{`${String(pinnedDataColumnCount)} pinned`}</span> : null}
                  {hiddenColumnCount > 0 ? <span className="hidden rounded-4xl border border-border/80 bg-card px-2 py-0.5 text-xs text-muted-foreground sm:inline-flex">{`${String(hiddenColumnCount)} hidden`}</span> : null}
                  {virtualActive ? <span className="rounded-4xl border border-border/80 bg-card px-2 py-0.5 text-xs text-foreground">Virtualized</span> : null}
                </div>
              </>
            )}
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {expandEnabled && !isLoading && bodyRows.length > 0 ? (
                <DataGridExpandAllButton allExpanded={allRowsExpanded} tableLabel={label} onToggleAll={toggleAllRowsExpanded} />
              ) : null}
              <DataGridViewSettings
                tableLabel={label}
                density={density}
                onDensityChange={setDensity}
                columns={controlItems}
                visibleCount={visibleDataColumnCount}
                suppressVisibility={suppressColumnVisibilityMenu}
                onToggleVisibility={handleToggleColumn}
                onTogglePinStart={handleTogglePinStart}
                onMoveColumn={handleMoveColumn}
                onStepWidth={handleStepColumnWidth}
                showVirtualToggle={bodyRows.length > VIRTUAL_ROW_THRESHOLD}
                virtualEnabled={virtualEnabled}
                onVirtualEnabledChange={setVirtualEnabled}
                hasCustomLayout={hasCustomLayout}
                onResetLayout={handleResetLayout}
              />
            </div>
          </DataGridHeader>
          <DataGridBody>
            <ScrollRegion label={`${label}, scrollable`} stickyOffset={resolvedStickyOffset} maxHeight={resolvedMaxHeight} containerRef={scrollRegionRef} style={scrollRegionPinStyle} aria-busy={isLoading ? true : undefined}>
              <Table>
                <TableCaption className="sr-only">{label}</TableCaption>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id} className="hover:bg-transparent">
                      {headerGroup.headers.map((header) => {
                        if (header.isPlaceholder) return <TableHead key={header.id} scope="col" className={HEAD_CELL_CLASS} />;
                        const column = header.column;
                        const pinned = stickyStyleByColumn[column.id];
                        const sizeStyle = widthStyleFor(column.id);
                        const headStyle: CSSProperties | undefined = pinned === undefined && sizeStyle === undefined ? undefined : { ...sizeStyle, ...pinned?.style };
                        const pinnedAttr = pinned?.side;
                        if (column.id === EXPAND_COLUMN_ID) {
                          return (
                            <TableHead key={header.id} scope="col" data-pinned={pinnedAttr} style={headStyle} className={cn(HEAD_CELL_CLASS, "w-11")}>
                              <span className="sr-only">Row details</span>
                            </TableHead>
                          );
                        }
                        if (column.id === SELECT_COLUMN_ID) {
                          return (
                            <TableHead key={header.id} scope="col" data-pinned={pinnedAttr} style={headStyle} className={cn(HEAD_CELL_CLASS, "w-11")}>
                              <Checkbox className={MIXED_CHECKBOX_CLASS} checked={allOnPageSelected} indeterminate={!allOnPageSelected && someOnPageSelected} disabled={bodyRows.length === 0} onCheckedChange={(checked) => handleSelectAllOnPage(checked)} aria-label={`Select all ${itemNoun} on this page`} />
                            </TableHead>
                          );
                        }
                        if (column.id === ACTIONS_COLUMN_ID) {
                          return (
                            <TableHead key={header.id} scope="col" data-pinned={pinnedAttr} style={headStyle} className={cn(HEAD_CELL_CLASS, "w-11 text-end")}>
                              <span className="sr-only">Actions</span>
                            </TableHead>
                          );
                        }
                        const canSort = column.getCanSort();
                        const sortDirection = column.getIsSorted();
                        const ariaSort = sortDirection === "asc" ? "ascending" : sortDirection === "desc" ? "descending" : "none";
                        const itemMeta = controlById.get(column.id);
                        const headerLabelId = `${cellIdBase}-col-${column.id}`;
                        return (
                          <TableHead key={header.id} scope="col" aria-label={itemMeta?.label} aria-sort={canSort ? ariaSort : undefined} data-pinned={pinnedAttr} style={headStyle} className={cn(HEAD_CELL_CLASS, "md:relative")}>
                            <div className="flex min-w-0 items-center justify-between gap-1 pe-1">
                              <div id={headerLabelId} className="min-w-0 flex-1">
                                {canSort ? (
                                  <DataGridColumnHeaderButton sortDirection={sortDirection} onClick={() => handleSort(column)}>
                                    <table.FlexRender header={header} />
                                  </DataGridColumnHeaderButton>
                                ) : (
                                  <table.FlexRender header={header} />
                                )}
                              </div>
                              {itemMeta === undefined ? null : (
                                <DataGridColumnHeaderMenu
                                  columnId={column.id}
                                  describedById={headerLabelId}
                                  label={itemMeta.label}
                                  canSort={canSort}
                                  sortDirection={sortDirection}
                                  onSortDirection={canSort ? (direction) => handleSetSortDirection(column.id, direction) : undefined}
                                  pinned={itemMeta.pinned}
                                  onTogglePinStart={() => handleTogglePinStart(column.id, itemMeta.pinned !== "start")}
                                  canMoveStart={itemMeta.canMoveStart}
                                  canMoveEnd={itemMeta.canMoveEnd}
                                  onMoveStart={() => handleMoveColumn(column.id, "start")}
                                  onMoveEnd={() => handleMoveColumn(column.id, "end")}
                                  onWiden={() => handleStepColumnWidth(column.id, 24)}
                                  onNarrow={() => handleStepColumnWidth(column.id, -24)}
                                  canHide={!suppressColumnVisibilityMenu && itemMeta.canHide && visibleDataColumnCount > 1}
                                  onHide={!suppressColumnVisibilityMenu && itemMeta.canHide && visibleDataColumnCount > 1 ? () => handleToggleColumn(column.id, false) : undefined}
                                />
                              )}
                            </div>
                            <DataGridColumnResizeHandle onResizeDelta={(delta) => handleStepColumnWidth(column.id, delta)} />
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <DataGridSkeletonRows rows={loadingRowCount} columns={visibleLeafColumns.length} />
                  ) : virtualActive ? (
                    <>
                      {topSpacerHeight > 0 ? (
                        <tr aria-hidden="true">
                          <td colSpan={visibleLeafColumns.length} aria-hidden="true" style={{ height: `${String(topSpacerHeight)}px`, padding: 0, border: 0 }}>
                            <span className="sr-only">Spacer</span>
                          </td>
                        </tr>
                      ) : null}
                      {virtualItems.map((virtualRow) => {
                        const row = bodyRows[virtualRow.index];
                        return row === undefined ? null : renderDataRow(row);
                      })}
                      {bottomSpacerHeight > 0 ? (
                        <tr aria-hidden="true">
                          <td colSpan={visibleLeafColumns.length} aria-hidden="true" style={{ height: `${String(bottomSpacerHeight)}px`, padding: 0, border: 0 }}>
                            <span className="sr-only">Spacer</span>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  ) : (
                    bodyRows.map((row) => renderDataRow(row))
                  )}
                </TableBody>
              </Table>
            </ScrollRegion>
          </DataGridBody>
          <DataGridFooter>{pager}</DataGridFooter>
        </DataGridContainer>
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
