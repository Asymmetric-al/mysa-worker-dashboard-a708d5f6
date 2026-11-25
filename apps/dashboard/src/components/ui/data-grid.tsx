"use client";
import * as React from "react";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, EyeOffIcon, MinusIcon, MoreVerticalIcon, PinIcon, PinOffIcon, PlusIcon, RotateCcwIcon, Rows2Icon, Rows3Icon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Frame, FrameFooter, FrameHeader, FramePanel } from "@/components/ui/frame";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { COLUMN_WIDTH_STEP } from "@/lib/data-grid-utils";

/** Row density mode supported by ReUI-styled Data Grid surfaces. */
export type DataGridDensity = "default" | "dense";

/** Concentric ReUI Frame container (`@reui/data-grid`) carrying density and virtualization state for Maia Zinc tables. */
export function DataGridContainer({ density = "default", virtualized = false, className, ...props }: React.ComponentProps<typeof Frame> & { readonly density?: DataGridDensity; readonly virtualized?: boolean }) {
  return <Frame spacing="flush" data-slot="data-grid" data-density={density} data-virtualized={virtualized ? "true" : "false"} className={cn("group/data-grid", className)} {...props} />;
}

export function DataGridHeader({ className, ...props }: React.ComponentProps<typeof FrameHeader>) {
  return <FrameHeader data-slot="data-grid-header" className={cn("gap-y-2", className)} {...props} />;
}

export function DataGridBody({ className, ...props }: React.ComponentProps<typeof FramePanel>) {
  return <FramePanel data-slot="data-grid-body" className={className} {...props} />;
}

export function DataGridFooter({ className, ...props }: React.ComponentProps<typeof FrameFooter>) {
  return <FrameFooter data-slot="data-grid-footer" className={className} {...props} />;
}

export type DataGridColumnHeaderButtonProps = Omit<React.ComponentProps<typeof Button>, "variant" | "size"> & { readonly sortDirection: "asc" | "desc" | false };

/** ReUI-inspired Maia Zinc pill header button (`@reui/data-grid-column-header`) with crisp active sort state. */
export function DataGridColumnHeaderButton({ sortDirection, className, children, ...props }: DataGridColumnHeaderButtonProps) {
  const Icon = sortDirection === "asc" ? ArrowUpIcon : sortDirection === "desc" ? ArrowDownIcon : ChevronsUpDownIcon;
  const active = sortDirection !== false;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-slot="data-grid-column-header"
      data-sorted={sortDirection || undefined}
      className={cn("-ms-2.5 h-7 min-h-7 max-w-full rounded-4xl px-2.5 text-xs font-medium tracking-normal", active ? "bg-secondary text-foreground shadow-2xs ring-1 ring-border/80 hover:bg-secondary/90" : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground", className)}
      {...props}
    >
      <span className="truncate">{children}</span>
      <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", active ? "text-foreground" : "text-muted-foreground/80")} />
    </Button>
  );
}

export type DataGridColumnHeaderMenuProps = {
  readonly columnId?: string;
  readonly describedById?: string;
  readonly label: string;
  readonly canSort: boolean;
  readonly sortDirection: "asc" | "desc" | false;
  readonly onSortDirection?: (direction: "asc" | "desc" | false) => void;
  readonly pinned: "start" | "end" | false;
  readonly onTogglePinStart: () => void;
  readonly canMoveStart: boolean;
  readonly canMoveEnd: boolean;
  readonly onMoveStart: () => void;
  readonly onMoveEnd: () => void;
  readonly onWiden: () => void;
  readonly onNarrow: () => void;
  readonly canHide: boolean;
  readonly onHide?: () => void;
};

/**
 * ReUI `@reui/data-grid-column-header` inline column dropdown menu (`md+` desktop only so 320px & 200% zoom tab budgets stay minimal).
 * Exposes sort direction, logical start-pinning, keyboard column ordering, width stepping, and hide directly on each header.
 */
export function DataGridColumnHeaderMenu({
  columnId,
  describedById,
  label,
  canSort,
  sortDirection,
  onSortDirection,
  pinned,
  onTogglePinStart,
  canMoveStart,
  canMoveEnd,
  onMoveStart,
  onMoveEnd,
  onWiden,
  onNarrow,
  canHide,
  onHide,
}: DataGridColumnHeaderMenuProps) {
  const isPinnedStart = pinned === "start";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-slot="data-grid-column-menu"
            data-column-id={columnId}
            aria-label="Column menu"
            aria-describedby={describedById}
            className={cn(
              "hidden min-h-6 min-w-6 shrink-0 rounded-lg text-muted-foreground opacity-65 transition-opacity hover:bg-secondary hover:text-foreground hover:opacity-100 focus-visible:opacity-100 md:inline-flex",
              isPinnedStart && "text-foreground opacity-100",
            )}
          />
        }
      >
        <MoreVerticalIcon aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate text-xs">
            <bdi>{label}</bdi>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {canSort && onSortDirection !== undefined ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onSortDirection("asc")} disabled={sortDirection === "asc"}>
                <ArrowUpIcon aria-hidden="true" />
                Sort ascending
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSortDirection("desc")} disabled={sortDirection === "desc"}>
                <ArrowDownIcon aria-hidden="true" />
                Sort descending
              </DropdownMenuItem>
              {sortDirection !== false ? (
                <DropdownMenuItem onClick={() => onSortDirection(false)}>
                  <RotateCcwIcon aria-hidden="true" />
                  Clear sort
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onTogglePinStart}>
            {isPinnedStart ? <PinOffIcon aria-hidden="true" /> : <PinIcon aria-hidden="true" />}
            {isPinnedStart ? "Unpin column" : "Pin to start"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onMoveStart} disabled={!canMoveStart}>
            <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
            Move toward start
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onMoveEnd} disabled={!canMoveEnd}>
            <ArrowRightIcon aria-hidden="true" className="rtl:rotate-180" />
            Move toward end
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onWiden}>
            <PlusIcon aria-hidden="true" />
            Widen column
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onNarrow}>
            <MinusIcon aria-hidden="true" />
            Narrow column
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {canHide && onHide !== undefined ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onHide}>
                <EyeOffIcon aria-hidden="true" />
                Hide column
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type DataGridExpandAllButtonProps = {
  readonly allExpanded: boolean;
  readonly tableLabel: string;
  readonly onToggleAll: () => void;
};

/** ReUI Data Grid header action to expand or collapse all visible row details on the current page. */
export function DataGridExpandAllButton({ allExpanded, tableLabel, onToggleAll }: DataGridExpandAllButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-slot="data-grid-expand-all"
      aria-pressed={allExpanded}
      onClick={onToggleAll}
      className="h-8 min-h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      {allExpanded ? <ChevronsDownUpIcon aria-hidden="true" className="size-3.5" /> : <ChevronsUpDownIcon aria-hidden="true" className="size-3.5" />}
      <span>{allExpanded ? "Collapse all" : "Expand all"}</span>
      <span className="sr-only">{` row details in ${tableLabel}`}</span>
    </Button>
  );
}

export type DataGridExpandButtonProps = {
  readonly expanded: boolean;
  readonly label: string;
  readonly onToggle: () => void;
  readonly className?: string;
};

/** ReUI Data Grid row expand toggle (`@reui/data-grid-table-dnd-rows` / expandable sub-row) respecting the 24x24px target floor. */
export function DataGridExpandButton({ expanded, label, onToggle, className }: DataGridExpandButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      data-slot="data-grid-expand-toggle"
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse details for ${label}` : `Expand details for ${label}`}
      onClick={onToggle}
      className={cn("min-h-6 min-w-6 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground", expanded && "bg-secondary text-foreground", className)}
    >
      <ChevronRightIcon aria-hidden="true" className={cn("size-3.5 transition-transform duration-150", expanded ? "rotate-90" : "rtl:rotate-180")} />
    </Button>
  );
}

export type DataGridColumnResizeHandleProps = {
  readonly onResizeDelta: (deltaPx: number) => void;
};

/**
 * Pointer-only column edge resize handle (uses pointer capture, NEVER `draggable="true"`).
 * Keyboard width stepping is offered via full >= 28px controls in `DataGridViewSettings` so Tab order and WCAG 2.5.8 stay clean.
 */
export function DataGridColumnResizeHandle({ onResizeDelta }: DataGridColumnResizeHandleProps) {
  const startXRef = React.useRef<number | null>(null);
  const [resizing, setResizing] = React.useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    startXRef.current = event.clientX;
    setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (startXRef.current === null) return;
    const isRtl = typeof window !== "undefined" && window.getComputedStyle(event.currentTarget).direction === "rtl";
    const rawDelta = event.clientX - startXRef.current;
    const logicalDelta = isRtl ? -rawDelta : rawDelta;
    if (Math.abs(logicalDelta) < 2) return;
    startXRef.current = event.clientX;
    onResizeDelta(logicalDelta);
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (startXRef.current === null) return;
    startXRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      role="presentation"
      aria-hidden="true"
      data-slot="data-grid-resizer"
      data-resizing={resizing ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endResize}
      onPointerCancel={endResize}
      className={cn(
        "absolute inset-y-1.5 end-0 hidden w-2 cursor-col-resize touch-none select-none md:flex md:items-center md:justify-center",
        "after:h-4 after:w-0.5 after:rounded-full after:transition-colors",
        resizing ? "after:bg-foreground" : "after:bg-transparent hover:after:bg-input",
      )}
    />
  );
}

export type DataGridColumnControlItem = {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly canHide: boolean;
  readonly pinned: "start" | "end" | false;
  readonly canMoveStart: boolean;
  readonly canMoveEnd: boolean;
  readonly widthPx: number | undefined;
};

export type DataGridViewSettingsProps = {
  readonly tableLabel: string;
  readonly density: DataGridDensity;
  readonly onDensityChange: (next: DataGridDensity) => void;
  readonly columns: readonly DataGridColumnControlItem[];
  readonly visibleCount: number;
  readonly suppressVisibility?: boolean;
  readonly onToggleVisibility: (columnId: string, visible: boolean) => void;
  readonly onTogglePinStart: (columnId: string, nextPinned: boolean) => void;
  readonly onMoveColumn: (columnId: string, direction: "start" | "end") => void;
  readonly onStepWidth: (columnId: string, deltaPx: number) => void;
  readonly showVirtualToggle?: boolean;
  readonly virtualEnabled?: boolean;
  readonly onVirtualEnabledChange?: (next: boolean) => void;
  readonly hasCustomLayout: boolean;
  readonly onResetLayout: () => void;
};

/**
 * ReUI unified Data Grid View Settings popover: density, optional virtual scroll,
 * column visibility, logical start-pinning, keyboard column ordering (zero HTML5 drag),
 * keyboard column width stepping, and one-click layout reset.
 */
export function DataGridViewSettings({
  tableLabel,
  density,
  onDensityChange,
  columns,
  visibleCount,
  suppressVisibility = false,
  onToggleVisibility,
  onTogglePinStart,
  onMoveColumn,
  onStepWidth,
  showVirtualToggle = false,
  virtualEnabled = false,
  onVirtualEnabledChange,
  hasCustomLayout,
  onResetLayout,
}: DataGridViewSettingsProps) {
  const triggerText = suppressVisibility ? "Grid view" : "Columns";
  const dense = density === "dense";
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-slot="data-grid-view-trigger"
            className={cn("h-8 min-h-8 gap-1.5 text-xs", (dense || hasCustomLayout || virtualEnabled) && "border-foreground/30 bg-card text-foreground")}
          />
        }
      >
        <SlidersHorizontalIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span>{triggerText}</span>
        <span className="sr-only">{` and view settings for ${tableLabel}`}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(23rem,calc(100vw-2rem))] gap-3 p-3.5">
        <PopoverHeader>
          <PopoverTitle className="text-sm">Grid view &amp; columns</PopoverTitle>
          <PopoverDescription className="text-xs">Adjust row density, pin key columns, reorder, or tune widths for this session.</PopoverDescription>
        </PopoverHeader>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-surface-subtle px-2.5 py-2">
            <span className="text-xs font-medium text-foreground">Row density</span>
            <fieldset className="m-0 inline-flex items-center gap-1 border-0 p-0" aria-label={`Row density for ${tableLabel}`}>
              <Button type="button" variant={dense ? "ghost" : "secondary"} size="sm" aria-pressed={!dense} onClick={() => onDensityChange("default")} className="h-7 min-h-7 gap-1 px-2 text-xs">
                <Rows2Icon aria-hidden="true" className="size-3.5" />
                Comfortable
              </Button>
              <Button type="button" variant={dense ? "secondary" : "ghost"} size="sm" aria-pressed={dense} onClick={() => onDensityChange("dense")} className="h-7 min-h-7 gap-1 px-2 text-xs">
                <Rows3Icon aria-hidden="true" className="size-3.5" />
                Compact
              </Button>
            </fieldset>
          </div>

          {showVirtualToggle && onVirtualEnabledChange !== undefined ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface-subtle px-2.5 py-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-xs font-medium text-foreground">Virtualized scroll</span>
                <span className="text-xs text-muted-foreground">Window rows smoothly on large pages.</span>
              </div>
              <Switch checked={virtualEnabled} aria-label={`Virtualized scroll for ${tableLabel}`} onCheckedChange={onVirtualEnabledChange} />
            </div>
          ) : null}
        </div>

        {columns.length === 0 ? null : (
          <>
            <Separator />
            <fieldset className="m-0 flex max-h-64 flex-col gap-1.5 overflow-y-auto overscroll-contain border-0 p-0 pe-0.5" aria-label={`Column layout for ${tableLabel}`}>
              {columns.map((item) => {
                const hidesLast = item.visible && visibleCount <= 1;
                const isPinnedStart = item.pinned === "start";
                return (
                  <div key={item.id} className="flex min-w-0 items-center justify-between gap-1.5 rounded-xl border border-border/70 bg-card px-2 py-1.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {suppressVisibility ? null : (
                        <Checkbox
                          checked={item.visible}
                          disabled={!item.canHide || hidesLast}
                          aria-label={`Show ${item.label} column`}
                          onCheckedChange={(checked) => onToggleVisibility(item.id, checked)}
                        />
                      )}
                      <span className="truncate text-xs font-medium text-foreground">
                        <bdi>{item.label}</bdi>
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        variant={isPinnedStart ? "secondary" : "ghost"}
                        size="icon-xs"
                        aria-pressed={isPinnedStart}
                        aria-label={isPinnedStart ? `Unpin ${item.label} column` : `Pin ${item.label} column to start`}
                        onClick={() => onTogglePinStart(item.id, !isPinnedStart)}
                        className="min-h-6 min-w-6"
                      >
                        {isPinnedStart ? <PinOffIcon aria-hidden="true" className="size-3" /> : <PinIcon aria-hidden="true" className="size-3" />}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={!item.canMoveStart}
                        aria-label={`Move ${item.label} column toward start`}
                        onClick={() => onMoveColumn(item.id, "start")}
                        className="min-h-6 min-w-6"
                      >
                        <ArrowLeftIcon aria-hidden="true" className="size-3 rtl:rotate-180" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={!item.canMoveEnd}
                        aria-label={`Move ${item.label} column toward end`}
                        onClick={() => onMoveColumn(item.id, "end")}
                        className="min-h-6 min-w-6"
                      >
                        <ArrowRightIcon aria-hidden="true" className="size-3 rtl:rotate-180" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Narrow ${item.label} column`}
                        onClick={() => onStepWidth(item.id, -COLUMN_WIDTH_STEP)}
                        className="min-h-6 min-w-6"
                      >
                        <MinusIcon aria-hidden="true" className="size-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Widen ${item.label} column`}
                        onClick={() => onStepWidth(item.id, COLUMN_WIDTH_STEP)}
                        className="min-h-6 min-w-6"
                      >
                        <PlusIcon aria-hidden="true" className="size-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </fieldset>
          </>
        )}

        <Separator />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{hasCustomLayout ? "Custom layout active" : "Default layout"}</span>
          <Button type="button" variant="ghost" size="sm" disabled={!hasCustomLayout && !dense && !virtualEnabled} onClick={onResetLayout} className="h-7 min-h-7 gap-1.5 text-xs">
            <RotateCcwIcon aria-hidden="true" className="size-3" />
            Reset grid
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type DataGridDensityToggleProps = { readonly density: DataGridDensity; readonly onDensityChange: (next: DataGridDensity) => void; readonly tableLabel: string; readonly className?: string };

/** Compact density switch for standalone ReUI Data Grids (`default` vs `dense`), keeping the 24px+ target floor. */
export function DataGridDensityToggle({ density, onDensityChange, tableLabel, className }: DataGridDensityToggleProps) {
  const dense = density === "dense";
  return (
    <Button type="button" variant="outline" size="sm" aria-pressed={dense} onClick={() => onDensityChange(dense ? "default" : "dense")} className={cn("h-8 min-h-8 gap-1.5 text-xs", dense ? "border-foreground/30 bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground", className)}>
      {dense ? <Rows3Icon aria-hidden="true" className="size-3.5" /> : <Rows2Icon aria-hidden="true" className="size-3.5" />}
      <span className="hidden sm:inline">{dense ? "Compact" : "Density"}</span>
      <span className="sr-only">{dense ? `Switch ${tableLabel} to comfortable rows` : `Switch ${tableLabel} to compact rows`}</span>
    </Button>
  );
}

export type DataGridFilterChipProps = { readonly facetLabel: string; readonly valueLabel: string; readonly removeLabel: string; readonly onRemove: () => void; readonly className?: string };

/** Two-segment Maia Zinc filter pill inspired by ReUI Filters (`@reui/filters-chip`) with >= 28px tap target height. */
export function DataGridFilterChip({ facetLabel, valueLabel, removeLabel, onRemove, className }: DataGridFilterChipProps) {
  return (
    <button
      type="button"
      data-slot="data-grid-filter-chip"
      aria-label={removeLabel}
      onClick={onRemove}
      className={cn(
        "group/filter-chip inline-flex min-h-7 max-w-full cursor-pointer touch-manipulation items-center overflow-hidden rounded-4xl border border-border/90 bg-card text-xs shadow-2xs transition-colors hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]",
        className,
      )}
    >
      <span className="border-e border-border/80 bg-surface-subtle px-2.5 py-1 font-normal text-muted-foreground">
        <bdi>{facetLabel}</bdi>
        <span>{": "}</span>
      </span>
      <span className="max-w-52 truncate px-2.5 py-1 font-medium text-foreground">
        <bdi>{valueLabel}</bdi>
      </span>
      <span aria-hidden="true" className="flex items-center pe-2 text-muted-foreground transition-colors group-hover/filter-chip:text-foreground">
        <XIcon className="size-3 shrink-0" />
      </span>
    </button>
  );
}

const SKELETON_WIDTHS = ["w-3/4", "w-1/2", "w-4/5", "w-2/3", "w-2/5", "w-3/5"] as const;

/** Realistic varied-width ReUI skeleton rows while a Data Grid query is loading. */
export function DataGridSkeletonRows({ rows, columns }: { readonly rows: number; readonly columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <TableRow key={`data-grid-loading-${String(rowIndex)}`} className="hover:bg-transparent">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <TableCell key={`data-grid-loading-cell-${String(rowIndex)}-${String(columnIndex)}`}>
              <Skeleton aria-hidden="true" className={cn("h-4 rounded-md", SKELETON_WIDTHS[(rowIndex + columnIndex) % SKELETON_WIDTHS.length])} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
