"use client";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import RecordList, { type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import StatusBadge from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SegmentedTabs, type SegmentedOption } from "@/components/ui/segmented-tabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/components/ui/use-mobile";
import { cn } from "@/lib/cn";
import { groupTasksByStatus } from "@/lib/task-board";
import type { Scope, TaskRecord } from "@/modules/data-service/envelope";
import { PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT } from "@/modules/support/report";
import { parseCivilDate, serialiseCivilDate } from "@/modules/time/civil";
import { CATEGORY_LABEL, CATEGORY_STATE_LABELS, DUE_DATE_LABEL, PLANNED_MEETING_LABEL, PLANNED_VERSUS_HELD_NOTE, TASK_KIND_LABELS, TASK_LIST_KEYS, TASK_LIST_LABELS, TASK_STATUS_LABELS, UNDATED_LABEL, type TaskListKey } from "../copy/task-status";
import { useTaskLists, type TaskListsQuery, type TaskListsResult } from "../hooks/use-task-lists";
import BulkActionBar, { type BulkSelectionRow } from "./bulk-action-bar";
import TaskActions, { TaskActionResult, TASK_STATUS_TONES, type TaskActionReceipt } from "./task-actions";
import TaskComposer, { type TaskComposerInitialValues, type TaskLinkChoices } from "./task-composer";
type TaskListRow = Extract<TaskListsResult, { readonly kind: "envelope" }>["envelope"]["data"]["tasks"][number];
function editableTaskRecord(row: TaskListRow, scope: Scope): TaskRecord | null {
  if (!row.selectable) return null;
  const { taskId, title, category, dueOn, plannedTime, timeZone, kind, status, partnerId, initiativeId, seriesId, note, revision } = row;
  return { taskId, title, category, dueOn, plannedTime, timeZone, kind, status, partnerId, initiativeId, seriesId, ownerPrincipalId: scope.principalId, note, revision };
}
const TASK_SORT_FIELDS = ["dueOn", "title", "category", "status"] as const;
type SortInstruction = { readonly field: (typeof TASK_SORT_FIELDS)[number]; readonly direction: "asc" | "desc" };
type ListQueryState = { readonly list: TaskListKey; readonly sort: readonly SortInstruction[]; readonly page: number; readonly pageSize: number };
const PARAM = { list: "list", sort: "sort", page: "page", pageSize: "pageSize" } as const;
const SORT_TOKEN_SEPARATOR = ":";
const FIRST_PAGE = 1;
const LIST_SWITCHER_LABEL = "Choose a task list";
const TASK_NOUN = "tasks";
const NEW_TASK_LABEL = "New task";
const MUTED_TEXT_CLASS = "text-muted-foreground";
const IDENTIFIER_CLASS = "mono-identifier";
const INITIATIVE_ROUTE_PREFIX = "/partners/initiatives";
/** One row's private tags as chips, wrapped so a long tag never widens the column. */ const TAG_CHIP_GROUP_CLASS = "flex min-w-0 flex-wrap items-center gap-1";
const TAG_CHIP_TEXT_CLASS = "min-w-0 wrap-anywhere"; /** A row's link, sized so its target is at least 24 CSS px tall (WCAG 2.5.8) and carrying the one inline-link underline so its affordance is never carried by colour alone. */
const ROW_LINK_CLASS = "inline-flex min-h-6 max-w-full items-center break-words inline-link hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const SECTION_CLASS = "flex min-w-0 flex-col gap-3";
const QUIET_CLASS = "type-supporting text-pretty";
const LIST_BODY_CLASS = "flex min-w-0 flex-col gap-3";
const EMPTY_LIST_COPY: Readonly<Record<TaskListKey, { readonly title: string; readonly description: string }>> = {
  today: { title: "All caught up for today", description: "Nothing is due today. Check Upcoming for what’s ahead or Overdue for anything past due." },
  upcoming: { title: "Nothing scheduled ahead", description: "No open tasks are dated after today. Tasks without a due date live in Undated." },
  overdue: { title: "Nothing overdue", description: "You’re caught up — no open tasks are past their due date." },
  all: { title: "No tasks yet", description: "Create your first task to track calls, emails, thank-yous, or partner follow-ups." },
  undated: { title: "No undated tasks", description: "All of your tasks have due dates right now." },
};
const LIST_DENIED_DESCRIPTION = "Your current session doesn’t have access to this task list. If you belong to another ministry, switch to it from the header.";
const NO_IDS: readonly string[] = [];
const overLists = <T,>(valueOf: (list: TaskListKey) => T): Readonly<Record<TaskListKey, T>> => Object.fromEntries(TASK_LIST_KEYS.map((list) => [list, valueOf(list)])) as Readonly<Record<TaskListKey, T>>;
const listNameOf = (stated: string | null): TaskListKey => TASK_LIST_KEYS.find((list) => list === stated) ?? "all";
function sortInstructionsOf(tokens: readonly string[]): readonly SortInstruction[] {
  const instructions: SortInstruction[] = [];
  for (const token of tokens) {
    const [field, direction] = token.split(SORT_TOKEN_SEPARATOR);
    const matched = TASK_SORT_FIELDS.find((candidate) => candidate === field);
    if (matched === undefined) continue;
    if (direction !== "asc" && direction !== "desc") continue;
    instructions.push({ field: matched, direction });
  }
  return instructions;
}
function wholeNumberOf(stated: string | null): number | undefined {
  if (stated === null || !/^\d{1,9}$/u.test(stated)) return undefined;
  const value = Number.parseInt(stated, 10);
  return Number.isFinite(value) && value >= FIRST_PAGE ? value : undefined;
}
const pageSizeOf = (stated: string | null): number => {
  const size = wholeNumberOf(stated);
  return size === undefined ? PAGE_SIZE_DEFAULT : size >= PAGE_SIZE_CAP ? PAGE_SIZE_CAP : PAGE_SIZE_DEFAULT;
};
type SearchParameters = { readonly get: (name: string) => string | null; readonly getAll: (name: string) => string[] };
function searchOf(state: ListQueryState): string {
  const parameters = new URLSearchParams();
  parameters.set(PARAM.list, state.list);
  for (const instruction of state.sort) parameters.append(PARAM.sort, `${instruction.field}${SORT_TOKEN_SEPARATOR}${instruction.direction}`);
  parameters.set(PARAM.page, String(state.page));
  parameters.set(PARAM.pageSize, String(state.pageSize));
  return parameters.toString();
}
function sortInstructionsOfColumns(sort: readonly { readonly id: string; readonly desc: boolean }[]): readonly SortInstruction[] {
  const instructions: SortInstruction[] = [];
  for (const entry of sort) {
    const matched = TASK_SORT_FIELDS.find((candidate) => candidate === entry.id);
    if (matched !== undefined) instructions.push({ field: matched, direction: entry.desc ? "desc" : "asc" });
  }
  return instructions;
}
const sortKeyOf = (sort: TaskListsQuery["sort"]): string => (sort ?? []).map((instruction) => `${instruction.field}${SORT_TOKEN_SEPARATOR}${instruction.direction}`).join(",");
const sameQuery = (left: TaskListsQuery, right: TaskListsQuery): boolean =>
  left.list === right.list && left.displayTimeZone === right.displayTimeZone && (left.page ?? FIRST_PAGE) === (right.page ?? FIRST_PAGE) && (left.pageSize ?? PAGE_SIZE_DEFAULT) === (right.pageSize ?? PAGE_SIZE_DEFAULT) && sortKeyOf(left.sort) === sortKeyOf(right.sort);
function seedOf(result: TaskListsResult | undefined, query: TaskListsQuery): TaskListsResult | undefined {
  if (result === undefined || result.kind !== "envelope") return undefined;
  const { list, displayTimeZone, page, pageSize } = result.envelope.data;
  return sameQuery(query, { list, displayTimeZone, page, pageSize }) ? result : undefined;
}
const rowsOf = (result: TaskListsResult | undefined): readonly TaskListRow[] => (result === undefined || result.kind !== "envelope" ? [] : result.envelope.data.tasks);
const civilDateTextOf = (dueOn: string): string => {
  const parsed = parseCivilDate(dueOn);
  return parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : dueOn;
};
function linkedRecordOf(row: TaskListRow, partnerLabels: Readonly<Record<string, string>>): ReactNode {
  const records: ReactNode[] = [];
  if (row.partnerId !== null) {
    const partnerId = row.partnerId;
    const label = partnerLabels[partnerId];
    records.push(
      <Link key="partner" href={`/partners/${encodeURIComponent(partnerId)}`} className={ROW_LINK_CLASS}>
        <bdi>{label === undefined || label.trim() === "" ? partnerId : label}</bdi>
      </Link>,
    );
  }
  if (row.seriesId !== null) {
    records.push(
      <Link key="series" href={`/work/series/${encodeURIComponent(row.seriesId)}`} className={ROW_LINK_CLASS}>
        {"Repeating plan"}
      </Link>,
    );
  }
  if (row.initiativeId !== null) {
    // The initiative is named by its opaque reference, shown isolated because its form carries no meaning, and linked to the detail this application serves at that address.
    records.push(
      <Link key="initiative" href={`${INITIATIVE_ROUTE_PREFIX}/${encodeURIComponent(row.initiativeId)}`} className={ROW_LINK_CLASS}>
        <bdi className={IDENTIFIER_CLASS}>{row.initiativeId}</bdi>
      </Link>,
    );
  }
  if (records.length === 0) {
    return (
      <span className={MUTED_TEXT_CLASS}>
        <span aria-hidden="true">{"—"}</span>
        <span className="sr-only">{"Not linked"}</span>
      </span>
    );
  }
  return <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{records}</span>;
}
type TaskListColumnOptions = { readonly partnerLabels: Readonly<Record<string, string>> }; /** The columns of one task list, exported so the dated agenda renders the same facts rather than restating a status word, a date or a link. */
export const taskListColumns = ({ partnerLabels }: TaskListColumnOptions): ReadonlyArray<RecordListColumnDef<TaskListRow>> => [
  {
    id: "title",
    header: "Task",
    enableHiding: false,
    accessorFn: (row) => row.title,
    cell: (context) => {
      const { title, taskId } = context.row.original;
      return title.trim() === "" ? <bdi className={IDENTIFIER_CLASS}>{taskId}</bdi> : <bdi className="block min-w-48 break-words font-medium text-pretty">{title}</bdi>;
    },
  },
  { id: "status", header: "Status", accessorFn: (row) => row.status, cell: (context) => <StatusBadge label={TASK_STATUS_LABELS[context.row.original.status]} tone={TASK_STATUS_TONES[context.row.original.status]} srPrefix="Task status" /> },
  {
    id: "dueOn",
    header: DUE_DATE_LABEL,
    accessorFn: (row) => row.dueOn ?? "",
    cell: (context) => {
      const { dueOn } = context.row.original;
      return dueOn === null ? <span className={MUTED_TEXT_CLASS}>{UNDATED_LABEL}</span> : <bdi className={IDENTIFIER_CLASS}>{civilDateTextOf(dueOn)}</bdi>;
    },
  },
  {
    id: "category",
    header: CATEGORY_LABEL,
    accessorFn: (row) => row.category ?? "",
    cell: (context) => {
      const { category } = context.row.original;
      return category === null ? <span className={MUTED_TEXT_CLASS}>{CATEGORY_STATE_LABELS.uncategorised}</span> : <bdi>{category}</bdi>;
    },
  },
  {
    id: "tags",
    header: "Private tags",
    enableSorting: false, // The read orders by a task's own fields, so this column states the labels a row carries and offers no order.
    cell: (context) => {
      const { tags } = context.row.original;
      // A private tag is stated only to the principal who applied it, and the read has already kept the ones this session may see; no tag is a fact of its own, never an empty cell.
      return tags.length === 0 ? (
        <span className={MUTED_TEXT_CLASS}>{"None"}</span>
      ) : (
        <span className={TAG_CHIP_GROUP_CLASS}>
          {tags.map((tag) => (
            <Badge key={tag} variant="outline">
              <bdi className={TAG_CHIP_TEXT_CLASS}>{tag}</bdi>
            </Badge>
          ))}
        </span>
      );
    },
  },
  {
    id: "kind",
    header: "Type",
    enableSorting: false,
    cell: (context) => {
      const { kind, plannedTime, timeZone } = context.row.original;
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <span>{TASK_KIND_LABELS[kind]}</span>
          {plannedTime === null || timeZone === null ? null : (
            <span className={cn("flex min-w-0 flex-wrap items-center gap-x-1 text-xs", MUTED_TEXT_CLASS)}>
              <span>{PLANNED_MEETING_LABEL}</span>
              <bdi className={IDENTIFIER_CLASS}>{plannedTime}</bdi>
              <bdi>{timeZone}</bdi>
            </span>
          )}
        </div>
      );
    },
  },
  { id: "linked", header: "Linked to", enableSorting: false, cell: (context) => linkedRecordOf(context.row.original, partnerLabels) },
];
type TaskViewMode = "table" | "board";
const TASK_VIEW_OPTIONS: readonly SegmentedOption<TaskViewMode>[] = [
  { value: "table", label: "Table view" },
  { value: "board", label: "Board view" },
];
const taskRowId = (row: TaskListRow): string => row.taskId;
const taskRowLabel = (row: TaskListRow): string => row.title;
const PAGE_SIZE_OPTIONS: readonly number[] = [PAGE_SIZE_DEFAULT, PAGE_SIZE_CAP];
export interface TaskListsProps {
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly lists: Readonly<Record<TaskListKey, TaskListsResult>>;
  /** The display time zone the browser chose in Settings, handed down by the route: the one zone every list on this surface asks its read to judge a date in, so the zone the worker chose is the zone the lists are read in rather than one this surface assumes. */ readonly displayTimeZone: string;
  readonly partnerLabels: Readonly<Record<string, string>>;
  readonly linkChoices?: TaskLinkChoices;
  readonly timeZoneChoices: readonly string[];
  readonly initialValues?: TaskComposerInitialValues;
  readonly className?: string;
} /** The composer's state: closed, open on a new task, or open on the one record the worker chose to edit together with the private tags that row was read with. */
type SelectionState = { readonly signature: string; readonly ids: readonly string[] };
const NO_SELECTION: SelectionState = { signature: "", ids: NO_IDS };
const selectionSignatureOf = (scope: Scope, list: TaskListKey): string => [scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, list].join("\u0000"); /** The five lists, the switcher, the rows a worker selects, and the composer and bulk actions over them. */
export default function TaskLists({ scope, expectedRevision, lists, displayTimeZone, partnerLabels, linkChoices, timeZoneChoices, initialValues, className }: TaskListsProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParameters = useSearchParams();
  const isNarrow = useIsMobile();
  const switcherId = useId();
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>({});
  const [viewMode, setViewMode] = useState<TaskViewMode>("table");
  const [selection, setSelection] = useState<SelectionState>(NO_SELECTION);
  const [editor, setEditor] = useState<{ readonly mode: "create"; readonly session: number } | { readonly mode: "edit"; readonly record: TaskRecord; readonly tags: readonly string[]; readonly session: number } | null>(null);
  const editorSessionRef = useRef(0);
  // The one receipt a row action publishes, held by the list rather than by the row: completing a task takes its row out of every list that reads only open work, so a result the row owned would leave with it, and a list left empty would state nothing at all about the accepted change.
  const [receipt, setReceipt] = useState<TaskActionReceipt | null>(null);
  const query = ((parameters: SearchParameters): ListQueryState => ({ list: listNameOf(parameters.get(PARAM.list)), sort: sortInstructionsOf(parameters.getAll(PARAM.sort)), page: wholeNumberOf(parameters.get(PARAM.page)) ?? FIRST_PAGE, pageSize: pageSizeOf(parameters.get(PARAM.pageSize)) }))(searchParameters);
  const listQueries = overLists((list) => ((list: TaskListKey, state: ListQueryState, displayTimeZone: string): TaskListsQuery => ({ list, displayTimeZone, page: state.page, pageSize: state.pageSize, ...(state.sort.length === 0 ? {} : { sort: state.sort }) }))(list, query, displayTimeZone));
  const seeds = overLists((list) => seedOf(lists[list], listQueries[list]));
  const reads = {
    today: useTaskLists(scope, listQueries.today, seeds.today),
    upcoming: useTaskLists(scope, listQueries.upcoming, seeds.upcoming),
    overdue: useTaskLists(scope, listQueries.overdue, seeds.overdue),
    all: useTaskLists(scope, listQueries.all, seeds.all),
    undated: useTaskLists(scope, listQueries.undated, seeds.undated),
  };
  const readings = overLists((list) => reads[list].data ?? seeds[list]);
  const active = reads[query.list];
  const reading = readings[query.list];
  // The zone the list on screen was judged in: the reading's own, which is the zone the read resolved its today in, and the queried zone only until that reading exists.
  const judgedZone = reading !== undefined && reading.kind === "envelope" ? reading.envelope.data.displayTimeZone : displayTimeZone;
  const signature = selectionSignatureOf(scope, query.list);
  const selectedIds = selection.signature === signature ? selection.ids : NO_IDS;
  const rowsById = new Map<string, TaskListRow>();
  for (const list of TASK_LIST_KEYS) for (const row of rowsOf(readings[list])) if (!rowsById.has(row.taskId)) rowsById.set(row.taskId, row);
  const selectedTasks: readonly BulkSelectionRow[] = selectedIds.flatMap((taskId) => {
    const row = rowsById.get(taskId);
    return row === undefined ? [] : [{ taskId: row.taskId, status: row.status, selectable: row.selectable, ...(row.selectionReason === undefined ? {} : { selectionReason: row.selectionReason }) }];
  });
  const hasPlannedTime = rowsOf(reading).some((row) => row.plannedTime !== null);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<TaskListRow>>>(() => taskListColumns({ partnerLabels }), [partnerLabels]);
  const listState: RecordListQueryState = { sort: query.sort.map((instruction) => ({ id: instruction.field, desc: instruction.direction === "desc" })), page: query.page, pageSize: query.pageSize, columnVisibility };
  const refreshAll = (): void => {
    for (const list of TASK_LIST_KEYS) void reads[list].refetch();
  };
  const commitQuery = (next: ListQueryState): void => router.replace(`${pathname}?${searchOf(next)}`, { scroll: false });
  const changeList = (next: string): void => {
    const list = listNameOf(next);
    if (list === query.list) return;
    commitQuery({ ...query, list, page: FIRST_PAGE });
  };
  const handleQueryStateChange = (next: RecordListQueryState): void => {
    setColumnVisibility(next.columnVisibility);
    commitQuery({ list: query.list, sort: sortInstructionsOfColumns(next.sort), page: next.page, pageSize: next.pageSize });
  };
  const handleSelectionChange = (ids: readonly string[]): void => setSelection({ signature, ids });
  const clearSelection = (): void => setSelection({ signature, ids: NO_IDS });
  const openCreate = (): void => {
    editorSessionRef.current += 1;
    setEditor({ mode: "create", session: editorSessionRef.current });
  };
  const openEdit = (row: TaskListRow): void => {
    const record = editableTaskRecord(row, scope);
    if (record === null) return;
    editorSessionRef.current += 1;
    setEditor({ mode: "edit", record, tags: row.tags, session: editorSessionRef.current });
  };
  const closeEditor = (): void => setEditor(null);
  function listContent(): ReactNode {
    const name = TASK_LIST_LABELS[query.list];
    const retry = { label: "Try again", onClick: () => void active.refetch() };
    if (reading === undefined) {
      if (active.isError) return <StateNotice kind="unavailable" headingLevel={3} title={`Couldn’t load ${name.toLowerCase()} tasks`} description="We couldn’t reach the task list right now. Try again in a moment." retry={retry} />;
      return <StateNotice kind="loading" headingLevel={3} title={`Loading ${name.toLowerCase()} tasks…`} loadingLines={4} />;
    }
    if (reading.kind === "denied") return <StateNotice kind="denied" headingLevel={3} title={`${name} tasks aren’t available`} description={LIST_DENIED_DESCRIPTION} reasonCode={reading.denied.reasonCode} />;
    if (reading.kind === "unavailable") return <StateNotice kind="unavailable" headingLevel={3} title={`Couldn’t load ${name.toLowerCase()} tasks`} description={reading.unavailable.guidance} source={reading.unavailable.source} retry={retry} />;
    if (reading.kind === "refused")
      return <StateNotice kind="refused" headingLevel={3} title={`Couldn’t load ${name.toLowerCase()} tasks`} description="Adjust the view parameters and try again." />;
    const { tasks, total } = reading.envelope.data;
    // This list's own notice for a result holding no task is handed to the one table pattern rather than returned in the list's place, so a list that holds nothing still states its total and its page size as every list holding rows does.
    const emptyState = <StateNotice kind="empty" headingLevel={3} title={EMPTY_LIST_COPY[query.list].title} description={EMPTY_LIST_COPY[query.list].description} action={{ label: NEW_TASK_LABEL, onClick: openCreate }} />;
    const rowActionsOf = (row: TaskListRow) => <TaskActions taskId={row.taskId} title={row.title} status={row.status} revision={row.revision} scope={scope} actions={row.actions} presentation="row" onEdit={() => openEdit(row)} onReceiptChange={setReceipt} onCheckResult={refreshAll} />;
    const listQuery = { queryState: listState, onQueryStateChange: handleQueryStateChange };
    const statusColumns = groupTasksByStatus(tasks);
    if (viewMode === "board" && tasks.length > 0) {
      return (
        <div data-slot="task-status-board" className="flex min-w-0 flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {`Showing ${String(tasks.length)} of ${String(total)} ${TASK_NOUN} grouped by status — use each card’s menu to complete, reopen, edit, or cancel.`}
          </p>
          <div className="grid min-w-0 gap-3 @2xl/main:grid-cols-2 @5xl/main:grid-cols-4">
            {statusColumns.map((column) => (
              <section key={column.status} aria-label={`${TASK_STATUS_LABELS[column.status]} tasks`} className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border/80 bg-surface-subtle p-3">
                <header className="flex items-center justify-between gap-2 border-b border-border/70 pb-2">
                  <StatusBadge label={TASK_STATUS_LABELS[column.status]} tone={TASK_STATUS_TONES[column.status]} />
                  <Badge variant="outline" className="tabular-figures">
                    {column.items.length}
                  </Badge>
                </header>
                {column.items.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">No tasks here.</p>
                ) : (
                  <ul className="flex min-w-0 flex-col gap-2">
                    {column.items.map((row) => (
                      <li key={row.taskId} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/80 bg-card p-3 shadow-2xs">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <bdi className="min-w-0 text-sm font-medium text-pretty wrap-anywhere text-foreground">
                            {row.title.trim() === "" ? row.taskId : row.title}
                          </bdi>
                          {rowActionsOf(row)}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{row.dueOn === null ? UNDATED_LABEL : civilDateTextOf(row.dueOn)}</span>
                          {row.category === null ? null : <Badge variant="outline">{row.category}</Badge>}
                        </div>
                        {row.tags.length > 0 ? (
                          <div className={TAG_CHIP_GROUP_CLASS}>
                            {row.tags.map((tag) => (
                              <Badge key={tag} variant="secondary">
                                <bdi className={TAG_CHIP_TEXT_CLASS}>{tag}</bdi>
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                        <div className="text-xs">{linkedRecordOf(row, partnerLabels)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>
      );
    }
    return (
      <RecordList<TaskListRow>
        label={`${name} ${TASK_NOUN}`}
        columns={columns}
        rows={tasks}
        rowCount={total}
        getRowId={taskRowId}
        rowLabel={taskRowLabel}
        initialPinnedColumns={{ start: ["title"] }}
        renderExpandedRow={(row) => (
          <div className="grid gap-3 text-xs sm:grid-cols-3">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-medium text-muted-foreground">Task note</span>
              <p className="text-pretty text-foreground">{row.note === null || row.note.trim() === "" ? "No note recorded for this task." : row.note}</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-medium text-muted-foreground">Details</span>
              <span className="text-foreground">
                ID <bdi className="mono-identifier">{row.taskId}</bdi>
              </span>
              {row.plannedTime !== null && row.timeZone !== null ? (
                <span className="text-muted-foreground">
                  Planned <bdi className="mono-identifier text-foreground">{row.plannedTime}</bdi> <bdi>{row.timeZone}</bdi>
                </span>
              ) : null}
            </div>
          </div>
        )}
        queryState={listQuery.queryState}
        onQueryStateChange={listQuery.onQueryStateChange}
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
        rowActions={rowActionsOf}
        itemNoun={TASK_NOUN}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        emptyState={emptyState}
      />
    );
  }
  const body = listContent();
  const listRegion = isNarrow ? (
    <div className={SECTION_CLASS}>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={switcherId}>{LIST_SWITCHER_LABEL}</Label>
        <NativeSelect id={switcherId} value={query.list} className="w-full" onChange={(event) => changeList(event.currentTarget.value)}>
          {TASK_LIST_KEYS.map((list) => (
            <NativeSelectOption key={list} value={list}>
              {TASK_LIST_LABELS[list]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className={LIST_BODY_CLASS}>{body}</div>
    </div>
  ) : (
    <Tabs value={query.list} onValueChange={(next) => changeList(String(next))} className="min-w-0 gap-3">
      <TabsList aria-label={LIST_SWITCHER_LABEL} className="h-auto max-w-full flex-wrap group-data-horizontal/tabs:h-auto">
        {TASK_LIST_KEYS.map((list) => (
          <TabsTrigger key={list} value={list}>
            {TASK_LIST_LABELS[list]}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={query.list} tabIndex={-1} className={LIST_BODY_CLASS}>
        {body}
      </TabsContent>
    </Tabs>
  );
  return (
    <div data-slot="work-task-lists" data-list={query.list} className={cn("flex min-w-0 flex-col gap-6", className)}>
      {editor === null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-border/80 bg-surface-subtle p-4 shadow-xs">
          <Button type="button" onClick={openCreate}>
            <PlusIcon aria-hidden="true" data-icon="inline-start" />
            {NEW_TASK_LABEL}
          </Button>
          <p className={cn(QUIET_CLASS, "max-w-prose")}>{"Only a title is required — due date, linked partner, and notes are optional."}</p>
        </div>
      ) : editor.mode === "create" ? (
        <TaskComposer key={`create-${String(editor.session)}`} mode="create" scope={scope} expectedRevision={expectedRevision} initialValues={initialValues} timeZoneChoices={timeZoneChoices} defaultTimeZone={displayTimeZone} linkChoices={linkChoices} headingLevel={2} onCancel={closeEditor} onDismiss={closeEditor} />
      ) : (
        <TaskComposer key={`edit-${editor.record.taskId}-${String(editor.session)}`} mode="edit" record={editor.record} tags={editor.tags} scope={scope} expectedRevision={editor.record.revision} timeZoneChoices={timeZoneChoices} defaultTimeZone={displayTimeZone} linkChoices={linkChoices} headingLevel={2} onCancel={closeEditor} onDismiss={closeEditor} />
      )}
      {selectedTasks.length === 0 ? null : <BulkActionBar scope={scope} expectedRevision={expectedRevision} selectedTasks={selectedTasks} onClearSelection={clearSelection} onCheckResult={refreshAll} />}
      <div className={SECTION_CLASS}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="type-section-title text-pretty">{"Your tasks"}</h2>
            <p className={cn(QUIET_CLASS, "max-w-prose")}>{`Dates are grouped using your display time zone (${judgedZone}). Scheduled meetings keep their own time zone.`}</p>
          </div>
          <SegmentedTabs label="Task list display layout" value={viewMode} onValueChange={setViewMode} options={TASK_VIEW_OPTIONS} />
        </div>
        {/* Above the list, so the receipt a row action published is read in this list's own context whether or not the row that produced it is still part of the result. */}
        <TaskActionResult receipt={receipt} headingLevel={3} />
        {listRegion}
      </div>
      {hasPlannedTime ? <p className={cn(QUIET_CLASS, "max-w-prose")}>{PLANNED_VERSUS_HELD_NOTE}</p> : null}
    </div>
  );
}
