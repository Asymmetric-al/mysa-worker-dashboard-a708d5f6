/** Pure grouping helper for the Shadcn UI Kit `Table | Board` task view on `/work`. */

export const TASK_BOARD_STATUS_ORDER = ["open", "reopened", "completed", "cancelled"] as const;
export type TaskBoardStatus = (typeof TASK_BOARD_STATUS_ORDER)[number];

export type TaskBoardColumn<TTask> = {
  readonly status: TaskBoardStatus;
  readonly items: readonly TTask[];
};

/**
 * Groups the active page's tasks into stable status lanes while preserving exact server row order inside each lane.
 * Never invents counts outside the current page and never mutates input order.
 */
export function groupTasksByStatus<TTask extends { readonly status: TaskBoardStatus }>(
  tasks: readonly TTask[],
): readonly TaskBoardColumn<TTask>[] {
  const buckets: Record<TaskBoardStatus, TTask[]> = {
    open: [],
    reopened: [],
    completed: [],
    cancelled: [],
  };
  for (const task of tasks) {
    buckets[task.status].push(task);
  }
  return TASK_BOARD_STATUS_ORDER.map((status) => ({
    status,
    items: buckets[status],
  }));
}
