"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { fetchRead } from "@/lib/read-transport";
import type { Scope, reads } from "@/modules/data-service";
export type TaskListsQuery = Parameters<typeof reads.work.listTasks>[0];
export type TaskListsResult = Awaited<ReturnType<typeof reads.work.listTasks>>;
type TaskListsEnvelope = Extract<TaskListsResult, { readonly kind: "envelope" }>["envelope"];
const WIRE_PARAM = { list: "list", displayTimeZone: "displayTimeZone", page: "page", pageSize: "pageSize", sort: "sort" } as const satisfies Record<keyof TaskListsQuery, string>;
function toTaskListSearch(query: TaskListsQuery): string {
  const search = new URLSearchParams();
  search.set("read", "listTasks");
  search.set(WIRE_PARAM.list, query.list);
  search.set(WIRE_PARAM.displayTimeZone, query.displayTimeZone);
  if (query.page !== undefined) search.set(WIRE_PARAM.page, String(query.page));
  if (query.pageSize !== undefined) search.set(WIRE_PARAM.pageSize, String(query.pageSize));
  for (const instruction of query.sort ?? []) search.append(WIRE_PARAM.sort, `${instruction.field}:${instruction.direction}`);
  return search.toString();
}
const isTaskListsData = (value: unknown): boolean => isRecord(value) && typeof value.list === "string" && typeof value.displayTimeZone === "string" && typeof value.today === "string" && Array.isArray(value.tasks) && typeof value.total === "number";
const fetchTaskLists = async (query: TaskListsQuery, signal: AbortSignal): Promise<TaskListsResult> => fetchRead<TaskListsEnvelope["data"], TaskListsEnvelope["coverage"]>({ url: `/api/tasks?${toTaskListSearch(query)}`, admits: isTaskListsData, signal });
/** Reads one of the five task lists for the given scope and query. */ export const useTaskLists = (scope: Scope, query: TaskListsQuery, initialResult?: TaskListsResult): UseQueryResult<TaskListsResult> =>
  useQuery({ queryKey: [...scopeKey(scope), "tasks", query], queryFn: ({ signal }) => fetchTaskLists(query, signal), initialData: initialResult, refetchOnMount: initialResult === undefined });
