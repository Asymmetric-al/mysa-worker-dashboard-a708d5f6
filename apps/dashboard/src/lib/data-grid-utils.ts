/** Pure, framework-free state helpers for ReUI Data Grid column pinning, ordering, width stepping, and virtualization. */

export type LogicalColumnPinning = {
  readonly start: readonly string[];
  readonly end: readonly string[];
};

export const COLUMN_WIDTH_MIN = 96;
export const COLUMN_WIDTH_MAX = 640;
export const COLUMN_WIDTH_STEP = 24;
export const COLUMN_WIDTH_DEFAULT = 180;
export const VIRTUAL_ROW_THRESHOLD = 40;

/** Moves one column one step toward the start or end of the movable column list. */
export function moveColumnId(order: readonly string[], columnId: string, direction: "start" | "end"): readonly string[] {
  const index = order.indexOf(columnId);
  if (index === -1) return order;
  const target = direction === "start" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  const current = next[index];
  const neighbour = next[target];
  if (current === undefined || neighbour === undefined) return order;
  next[index] = neighbour;
  next[target] = current;
  return next;
}

/** Pins or unpins one column logically (`start` | `end` | `false`), never duplicating an id across edges. */
export function togglePinnedColumn(pinning: LogicalColumnPinning, columnId: string, side: "start" | "end" | false): LogicalColumnPinning {
  const start = pinning.start.filter((id) => id !== columnId);
  const end = pinning.end.filter((id) => id !== columnId);
  if (side === "start") return { start: [...start, columnId], end };
  if (side === "end") return { start, end: [...end, columnId] };
  return { start, end };
}

/** Clamps a column width step to the declared min/max bounds as a safe integer. */
export function stepColumnWidth(current: number, delta: number, min = COLUMN_WIDTH_MIN, max = COLUMN_WIDTH_MAX): number {
  const base = Number.isFinite(current) ? current : COLUMN_WIDTH_DEFAULT;
  return Math.min(max, Math.max(min, Math.round(base + delta)));
}

/** Composes full TanStack Table column order keeping leading/trailing system columns fixed around movable data columns. */
export function buildColumnOrder(dataColumnIds: readonly string[], customOrder: readonly string[], leadingFixed: readonly string[], trailingFixed: readonly string[]): string[] {
  const dataSet = new Set(dataColumnIds);
  const orderedData = customOrder.filter((id) => dataSet.has(id));
  const seen = new Set(orderedData);
  for (const id of dataColumnIds) {
    if (!seen.has(id)) orderedData.push(id);
  }
  return [...leadingFixed, ...orderedData, ...trailingFixed];
}

/** Whether row virtualization is active for a given table size and user/surface toggle. */
export function shouldVirtualizeRows(rowCount: number, virtualizeEnabled: boolean, threshold = VIRTUAL_ROW_THRESHOLD): boolean {
  return virtualizeEnabled && rowCount > threshold;
}

/** Logical pinned side of a column from the current logical pinning state. */
export function pinnedSideOf(pinning: LogicalColumnPinning, columnId: string): "start" | "end" | false {
  if (pinning.start.includes(columnId)) return "start";
  if (pinning.end.includes(columnId)) return "end";
  return false;
}
