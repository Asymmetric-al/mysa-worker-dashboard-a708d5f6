"use client";
/**
 * The Work surface's five task lists — Today, Upcoming, Overdue, All and Undated — one at a time under a
 * switcher, rendered through the application's one table preset, with the composer that creates and edits a
 * task and the three bulk actions over the rows a worker explicitly selected.
 *
 * **The service owns the list.** The list, the ordering, the page and the page size are the query the service
 * receives; nothing here filters, sorts, slices or counts a row. The read's `total` is the whole result, so the
 * pager states the size of the list rather than the size of one page, and choosing a sort issues a new query
 * instead of reordering the rows already on screen.
 *
 * **The query is carried in the address.** A worker who opens a partner and comes back finds the list, the sort
 * and the page they left, and a copied address names the same view. Reading and writing that query is the only
 * reason this file touches the router; it navigates nowhere else.
 *
 * **A selection is a selection.** The three bulk actions apply to the rows a worker ticked, never to a filter, a
 * saved view or a page, so the selection is held as the identifiers this surface was given and is dropped
 * whenever the list, the query or the context changes. What a row allows is the read's own advisory answer: the
 * bulk bar re-checks it per row and the service enforces it on submit.
 *
 * **A planned time is a plan.** A meeting's planned time is stated as planned, with the zone it was given in,
 * and nothing on this surface presents it as a meeting that was held.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type ReactElement, type ReactNode } from "react";

import RecordList, { type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import StatusBadge from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/components/ui/use-mobile";
import { cn } from "@/lib/cn";
import type { Scope, TaskRecord } from "@/modules/data-service/envelope";
import { PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT } from "@/modules/support/report";
import { parseCivilDate, serialiseCivilDate } from "@/modules/time/civil";
import { BULK_SELECTION_SCOPE_NOTE } from "../copy/bulk-actions";
import { CATEGORY_LABEL, CATEGORY_STATE_LABELS, DUE_DATE_LABEL, PLANNED_MEETING_LABEL, PLANNED_VERSUS_HELD_NOTE, TASK_KIND_LABELS, TASK_LIST_KEYS, TASK_LIST_LABELS, TASK_STATUS_LABELS, UNDATED_LABEL, type TaskListKey } from "../copy/task-status";
import { useTaskLists, type TaskListsQuery, type TaskListsResult } from "../hooks/use-task-lists";
import BulkActionBar, { type BulkSelectionRow } from "./bulk-action-bar";
import TaskActions, { TASK_STATUS_TONES } from "./task-actions";
import TaskComposer, { type TaskComposerInitialValues, type TaskLinkChoices } from "./task-composer";
import { editableTaskRecord } from "./work-task-row";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** The envelope arm of one list read, and one row as that read projects it. */
type TaskListEnvelope = Extract<TaskListsResult, { readonly kind: "envelope" }>["envelope"];

type TaskListRow = TaskListEnvelope["data"]["tasks"][number];

// ---------------------------------------------------------------------------------------------
// The query the address carries
// ---------------------------------------------------------------------------------------------

/** The four members of the list query a worker can change, in the order the read's own sort vocabulary lists them. */
const TASK_SORT_FIELDS = ["dueOn", "title", "category", "status"] as const;

type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

type SortInstruction = { readonly field: TaskSortField; readonly direction: "asc" | "desc" };

/** The list, ordering and page window this surface is showing: the query, and nothing derived from the rows. */
type ListQueryState = {
  readonly list: TaskListKey;
  readonly sort: readonly SortInstruction[];
  readonly page: number;
  readonly pageSize: number;
};

/** The search parameters this surface reads and writes, named once. Every other key in the address belongs to another surface. */
const PARAM = { list: "list", sort: "sort", page: "page", pageSize: "pageSize" } as const;

/** One ordering instruction as a parameter value, in the same `field:direction` grammar the task handler reads. */
const SORT_TOKEN_SEPARATOR = ":";

/** A page or a page size is a whole count of rows: never a sign, never a fraction. */
const WHOLE_NUMBER = /^\d{1,9}$/u;

/** The list this surface opens on when the address names none, and the one whose result the route states the page in. */
const DEFAULT_LIST: TaskListKey = "all";

/** Pages are counted from one, which is how the read counts them. */
const FIRST_PAGE = 1;

/** The minimal shape this file needs from the address, so the query grammar is readable on its own. */
type SearchParameters = { readonly get: (name: string) => string | null; readonly getAll: (name: string) => string[] };

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The region heading and the switcher's name, which both switcher controls and the region share. */
const LIST_REGION_HEADING = "Task lists";

const LIST_SWITCHER_LABEL = "Choose a task list";

const TASK_NOUN = "tasks";

const NEW_TASK_LABEL = "New task";

const NEW_TASK_NOTE = "A task needs only a title. Linking a partner or planning a time changes nothing else, and no task here sends a message or creates a stewardship obligation.";

const STATUS_SR_PREFIX = "Task status";

const TITLE_COLUMN_LABEL = "Task";

const STATUS_COLUMN_LABEL = "Status";

const KIND_COLUMN_LABEL = "Kind";

const LINKED_COLUMN_LABEL = "Linked record";

const NO_LINKED_RECORD = "No linked record";

const NOTHING_LINKED = "—";

const SERIES_LINK_LABEL = "Repeating plan";

const PARTNER_ROUTE_PREFIX = "/partners";

const SERIES_ROUTE_PREFIX = "/work/series";

const MUTED_TEXT_CLASS = "text-muted-foreground";

const IDENTIFIER_CLASS = "mono-identifier";

const SECTION_CLASS = "flex min-w-0 flex-col gap-3";

const HEADING_CLASS = "font-heading text-lg font-medium text-pretty";

const QUIET_CLASS = "text-sm text-pretty text-muted-foreground";

const TITLE_CELL_CLASS = "font-medium text-pretty wrap-anywhere";

const LIST_BODY_CLASS = "flex min-w-0 flex-col gap-3";

/**
 * What each list states when it holds no row at all. A list that holds nothing for its own reason is not the
 * same fact as a workspace with no work, so each says which work it would have carried.
 */
const EMPTY_LIST_COPY: Readonly<Record<TaskListKey, { readonly title: string; readonly description: string }>> = {
  today: { title: "Nothing is due today", description: "No open task in this context is dated today. Later work is read in Upcoming, work with no date in Undated, and a task that passed its date without an answer in Overdue." },
  upcoming: { title: "Nothing is dated ahead", description: "Every open task in this context is dated today or earlier. Work with no date is read in Undated rather than listed here." },
  overdue: { title: "Nothing is past its date", description: "No open task in this context has passed its date, so no task is waiting on an answer here." },
  all: { title: "This context holds no task", description: "No task exists in this context yet — open, completed, reopened or cancelled — so there is nothing to complete, reopen, edit or cancel." },
  undated: { title: "No task is undated", description: "Every task in this context states a due date, so the work that has no date is a list of its own and holds nothing." },
};

const NO_IDS: readonly string[] = [];

// ---------------------------------------------------------------------------------------------
// Reading and writing the query
// ---------------------------------------------------------------------------------------------

/** The list an address names, or the default when the value is absent or is not one of the five lists. */
function listNameOf(stated: string | null): TaskListKey {
  return TASK_LIST_KEYS.find((list) => list === stated) ?? DEFAULT_LIST;
}

/** The orderings an address names, keeping only the ones the read admits; an unreadable token is dropped rather than guessed at. */
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

/** A whole positive count, or nothing when the value is absent or is not one. */
function wholeNumberOf(stated: string | null): number | undefined {
  if (stated === null || !WHOLE_NUMBER.test(stated)) return undefined;
  const value = Number.parseInt(stated, 10);
  return Number.isFinite(value) && value >= FIRST_PAGE ? value : undefined;
}

/** The page size this surface reads at: the documented default, and the documented cap when a larger window is asked for. */
function pageSizeOf(stated: string | null): number {
  const size = wholeNumberOf(stated);
  if (size === undefined) return PAGE_SIZE_DEFAULT;
  return size >= PAGE_SIZE_CAP ? PAGE_SIZE_CAP : PAGE_SIZE_DEFAULT;
}

/** The whole query state an address carries. */
function queryStateOf(parameters: SearchParameters): ListQueryState {
  return {
    list: listNameOf(parameters.get(PARAM.list)),
    sort: sortInstructionsOf(parameters.getAll(PARAM.sort)),
    page: wholeNumberOf(parameters.get(PARAM.page)) ?? FIRST_PAGE,
    pageSize: pageSizeOf(parameters.get(PARAM.pageSize)),
  };
}

/** The address a query state is written as: every member stated, so a copied address names the same view. */
function searchOf(state: ListQueryState): string {
  const parameters = new URLSearchParams();
  parameters.set(PARAM.list, state.list);
  for (const instruction of state.sort) {
    parameters.append(PARAM.sort, `${instruction.field}${SORT_TOKEN_SEPARATOR}${instruction.direction}`);
  }
  parameters.set(PARAM.page, String(state.page));
  parameters.set(PARAM.pageSize, String(state.pageSize));
  return parameters.toString();
}

/** The orderings the table preset asked for, keeping only the fields the read sorts by. */
function sortInstructionsOfColumns(sort: readonly { readonly id: string; readonly desc: boolean }[]): readonly SortInstruction[] {
  const instructions: SortInstruction[] = [];
  for (const entry of sort) {
    const matched = TASK_SORT_FIELDS.find((candidate) => candidate === entry.id);
    if (matched !== undefined) instructions.push({ field: matched, direction: entry.desc ? "desc" : "asc" });
  }
  return instructions;
}

/** One list's query, built from the stated window and the zone every date on this surface is judged in. */
function queryOfList(list: TaskListKey, state: ListQueryState, displayTimeZone: string): TaskListsQuery {
  return { list, displayTimeZone, page: state.page, pageSize: state.pageSize, ...(state.sort.length === 0 ? {} : { sort: state.sort }) };
}

/** One query's ordering as a single comparable string. */
function sortKeyOf(sort: TaskListsQuery["sort"]): string {
  return (sort ?? []).map((instruction) => `${instruction.field}${SORT_TOKEN_SEPARATOR}${instruction.direction}`).join(",");
}

/** Whether two queries ask the read for the same answer. */
function sameQuery(left: TaskListsQuery, right: TaskListsQuery): boolean {
  return (
    left.list === right.list &&
    left.displayTimeZone === right.displayTimeZone &&
    (left.page ?? FIRST_PAGE) === (right.page ?? FIRST_PAGE) &&
    (left.pageSize ?? PAGE_SIZE_DEFAULT) === (right.pageSize ?? PAGE_SIZE_DEFAULT) &&
    sortKeyOf(left.sort) === sortKeyOf(right.sort)
  );
}

/**
 * The result a server render already read for exactly this query, or nothing.
 *
 * The route reads every list once so the first paint states what the server read; that answer describes the
 * query it was read for, which the envelope itself names. Handing it to a *different* query would paint one
 * page's rows under another page's heading, so an answer that does not match is dropped and the read is made
 * again instead.
 */
function seedOf(result: TaskListsResult | undefined, query: TaskListsQuery): TaskListsResult | undefined {
  if (result === undefined || result.kind !== "envelope") return undefined;
  const { list, displayTimeZone, page, pageSize } = result.envelope.data;
  return sameQuery(query, { list, displayTimeZone, page, pageSize }) ? result : undefined;
}

/** The rows one list read answered with, and none when it answered with a refusal instead of a result. */
function rowsOf(result: TaskListsResult | undefined): readonly TaskListRow[] {
  return result === undefined || result.kind !== "envelope" ? [] : result.envelope.data.tasks;
}

/** A due date in the storage form this surface renders: the calendar day as it was recorded, never a time and never a zone. */
function civilDateTextOf(dueOn: string): string {
  const parsed = parseCivilDate(dueOn);
  // A value that does not read back as the day it states is shown exactly as the read supplied it, rather than
  // being adjusted by the calendar into a day the worker was never told about.
  return parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : dueOn;
}

/** The records one task is linked to, each at the destination this application serves, or the stated absence of any. */
function linkedRecordOf(row: TaskListRow, partnerLabels: Readonly<Record<string, string>>): ReactNode {
  const records: ReactNode[] = [];
  if (row.partnerId !== null) {
    const partnerId = row.partnerId;
    const label = partnerLabels[partnerId];
    records.push(
      <Link key="partner" href={`${PARTNER_ROUTE_PREFIX}/${encodeURIComponent(partnerId)}`}>
        <bdi>{label === undefined || label.trim() === "" ? partnerId : label}</bdi>
      </Link>,
    );
  }
  if (row.seriesId !== null) {
    records.push(
      <Link key="series" href={`${SERIES_ROUTE_PREFIX}/${encodeURIComponent(row.seriesId)}`}>
        {SERIES_LINK_LABEL}
      </Link>,
    );
  }
  if (row.initiativeId !== null) {
    // An initiative is named by its opaque reference: this application serves no surface for one yet, so no
    // link is offered to a destination that does not exist.
    records.push(
      <bdi key="initiative" className={IDENTIFIER_CLASS}>
        {row.initiativeId}
      </bdi>,
    );
  }
  if (records.length === 0) {
    return (
      <span className={MUTED_TEXT_CLASS}>
        <span aria-hidden="true">{NOTHING_LINKED}</span>
        <span className="sr-only">{NO_LINKED_RECORD}</span>
      </span>
    );
  }
  return <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{records}</span>;
}

// ---------------------------------------------------------------------------------------------
// The rows, as the one table preset renders them
// ---------------------------------------------------------------------------------------------

/** What a column needs from the surface around it: the partner labels one roster read admitted. */
interface TaskListColumnOptions {
  readonly partnerLabels: Readonly<Record<string, string>>;
}

/**
 * The columns of one task list, exported so the dated agenda renders the same facts rather than restating a
 * status word, a date or a link.
 *
 * Every sortable column states the value the read orders by, because the preset offers a sort control only for a
 * column that has one — and the order itself stays the service's: the accessor describes the column, it never
 * orders the page.
 */
export function taskListColumns({ partnerLabels }: TaskListColumnOptions): ReadonlyArray<RecordListColumnDef<TaskListRow>> {
  return [
    {
      id: "title",
      header: TITLE_COLUMN_LABEL,
      enableHiding: false,
      accessorFn: (row) => row.title,
      cell: (context) => {
        const { title, taskId } = context.row.original;
        // A task whose title is blank is named by its own identifier: a row is never labelled with an empty cell.
        return title.trim() === "" ? <bdi className={IDENTIFIER_CLASS}>{taskId}</bdi> : <bdi className={TITLE_CELL_CLASS}>{title}</bdi>;
      },
    },
    {
      id: "status",
      header: STATUS_COLUMN_LABEL,
      accessorFn: (row) => row.status,
      cell: (context) => <StatusBadge label={TASK_STATUS_LABELS[context.row.original.status]} tone={TASK_STATUS_TONES[context.row.original.status]} srPrefix={STATUS_SR_PREFIX} />,
    },
    {
      id: "dueOn",
      header: DUE_DATE_LABEL,
      accessorFn: (row) => row.dueOn ?? "",
      cell: (context) => {
        const { dueOn } = context.row.original;
        // Undated work states that it has no date; it is never given one, and it is not the same fact as a date
        // that could not be read.
        return dueOn === null ? <span className={MUTED_TEXT_CLASS}>{UNDATED_LABEL}</span> : <bdi className={IDENTIFIER_CLASS}>{civilDateTextOf(dueOn)}</bdi>;
      },
    },
    {
      id: "category",
      header: CATEGORY_LABEL,
      accessorFn: (row) => row.category ?? "",
      cell: (context) => {
        const { category } = context.row.original;
        // The worker's own short label, and "No category" when they gave none: uncategorised is a state, not a gap.
        return category === null ? <span className={MUTED_TEXT_CLASS}>{CATEGORY_STATE_LABELS.uncategorised}</span> : <bdi>{category}</bdi>;
      },
    },
    {
      id: "kind",
      header: KIND_COLUMN_LABEL,
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
    {
      id: "linked",
      header: LINKED_COLUMN_LABEL,
      enableSorting: false,
      cell: (context) => linkedRecordOf(context.row.original, partnerLabels),
    },
  ];
}

/** One row's identity for the table preset: the task identifier, which is what every request names. */
function taskRowId(row: TaskListRow): string {
  return row.taskId;
}

/** One row's name for a control: its title, so the selection checkbox names the work it selects. */
function taskRowLabel(row: TaskListRow): string {
  return row.title;
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/** The two page sizes every list offers: the documented default and the documented cap. */
const PAGE_SIZE_OPTIONS: readonly number[] = [PAGE_SIZE_DEFAULT, PAGE_SIZE_CAP];

/** What the route composition hands this surface: authority it resolved, answers it already read, records it admitted. */
interface TaskListsProps {
  /** The authority every list was read under. Handed on unchanged: no control here derives a scope of its own. */
  readonly scope: Scope;
  /** The collection revision the lists were read at, which a create presents so a stale write is a conflict rather than an overwrite. */
  readonly expectedRevision: string;
  /** One answer per list, exactly as the route read it: the first paint, and the state each re-read replaces. */
  readonly lists: Readonly<Record<TaskListKey, TaskListsResult>>;
  /** The zone these lists judge their dates in, stated by the page so no date is read in an assumed zone. */
  readonly displayTimeZone: string;
  /** The partner labels the roster read admitted, so a linked partner is named rather than only referenced. */
  readonly partnerLabels: Readonly<Record<string, string>>;
  /** The partners and initiatives a new task may link to, or the outage that stopped that read admitting any. */
  readonly linkChoices?: TaskLinkChoices;
  /** The IANA zones a planned meeting time may be stated in. */
  readonly timeZoneChoices: readonly string[];
  /** What a new task opens with, when the route named a record this session may link. */
  readonly initialValues?: TaskComposerInitialValues;
  readonly className?: string;
}

/** The composer's state: closed, open on a new task, or open on the one record the worker chose to edit. */
type EditorState = { readonly mode: "create" } | { readonly mode: "edit"; readonly record: TaskRecord };

/** A selection, and the context and list it was made in: a selection made elsewhere is not this list's selection. */
type SelectionState = { readonly signature: string; readonly ids: readonly string[] };

const NO_SELECTION: SelectionState = { signature: "", ids: NO_IDS };

/** A context and a list as one string, so a change to either drops the selection made under the other. */
function selectionSignatureOf(scope: Scope, list: TaskListKey): string {
  return [scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, list].join("\u0000");
}

/** The five lists, the switcher, the rows a worker selects, and the composer and bulk actions over them. */
export default function TaskLists({ scope, expectedRevision, lists, displayTimeZone, partnerLabels, linkChoices, timeZoneChoices, initialValues, className }: TaskListsProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParameters = useSearchParams();
  const isNarrow = useIsMobile();
  const switcherId = useId();
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>({});
  const [selection, setSelection] = useState<SelectionState>(NO_SELECTION);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const query = queryStateOf(searchParameters);
  const listQueries: Readonly<Record<TaskListKey, TaskListsQuery>> = {
    today: queryOfList("today", query, displayTimeZone),
    upcoming: queryOfList("upcoming", query, displayTimeZone),
    overdue: queryOfList("overdue", query, displayTimeZone),
    all: queryOfList("all", query, displayTimeZone),
    undated: queryOfList("undated", query, displayTimeZone),
  };
  const seeds: Readonly<Record<TaskListKey, TaskListsResult | undefined>> = {
    today: seedOf(lists.today, listQueries.today),
    upcoming: seedOf(lists.upcoming, listQueries.upcoming),
    overdue: seedOf(lists.overdue, listQueries.overdue),
    all: seedOf(lists.all, listQueries.all),
    undated: seedOf(lists.undated, listQueries.undated),
  };
  // Five reads, one per list, each keyed by the whole query it sends: React Query hashes the key structurally, so
  // rebuilding the same query every render addresses the same entry. All five stay observed rather than only the
  // one on screen, because an accepted change to any task invalidates every list this scope reads, and a list
  // nobody is observing would come back stale the next time it is opened.
  const reads = {
    today: useTaskLists(scope, listQueries.today, seeds.today),
    upcoming: useTaskLists(scope, listQueries.upcoming, seeds.upcoming),
    overdue: useTaskLists(scope, listQueries.overdue, seeds.overdue),
    all: useTaskLists(scope, listQueries.all, seeds.all),
    undated: useTaskLists(scope, listQueries.undated, seeds.undated),
  };
  const readings: Readonly<Record<TaskListKey, TaskListsResult | undefined>> = {
    today: reads.today.data ?? seeds.today,
    upcoming: reads.upcoming.data ?? seeds.upcoming,
    overdue: reads.overdue.data ?? seeds.overdue,
    all: reads.all.data ?? seeds.all,
    undated: reads.undated.data ?? seeds.undated,
  };
  const active = reads[query.list];
  const reading = readings[query.list];
  // One task appears in several lists at once, so the selection is resolved once per task: the same identifier
  // named twice would send one bulk request carrying the same row twice.
  const signature = selectionSignatureOf(scope, query.list);
  const selectedIds = selection.signature === signature ? selection.ids : NO_IDS;
  const rowsById = new Map<string, TaskListRow>();
  for (const list of TASK_LIST_KEYS) {
    for (const row of rowsOf(readings[list])) {
      if (!rowsById.has(row.taskId)) rowsById.set(row.taskId, row);
    }
  }
  // Every selected identifier is stated to the bulk bar as the read projected it, including one this session may
  // not change: the bar reports per row which selection it could act on, so no row is dropped in silence here.
  const selectedTasks: readonly BulkSelectionRow[] = selectedIds.flatMap((taskId) => {
    const row = rowsById.get(taskId);
    if (row === undefined) return [];
    return [{ taskId: row.taskId, status: row.status, selectable: row.selectable, ...(row.selectionReason === undefined ? {} : { selectionReason: row.selectionReason }) }];
  });
  const hasPlannedTime = rowsOf(reading).some((row) => row.plannedTime !== null);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<TaskListRow>>>(() => taskListColumns({ partnerLabels }), [partnerLabels]);
  const listState: RecordListQueryState = {
    sort: query.sort.map((instruction) => ({ id: instruction.field, desc: instruction.direction === "desc" })),
    page: query.page,
    pageSize: query.pageSize,
    columnVisibility,
  };
  /** Re-reads every list: an attempt whose acknowledgement was lost may have touched any of them, so recovery reads them all rather than guessing which one holds the change. */
  const refreshAll = (): void => {
    for (const list of TASK_LIST_KEYS) void reads[list].refetch();
  };
  /** Writes the query into the address without a scroll reset, so the view a worker returns to is the view they left. */
  const commitQuery = (next: ListQueryState): void => {
    router.replace(`${pathname}?${searchOf(next)}`, { scroll: false });
  };
  const changeList = (next: string): void => {
    const list = listNameOf(next);
    if (list === query.list) return;
    // A page belongs to the list it was read from, so another list opens on its first page.
    commitQuery({ ...query, list, page: FIRST_PAGE });
  };
  const handleQueryStateChange = (next: RecordListQueryState): void => {
    // The column set is this surface's own display choice and stays local; the list, ordering and page window are
    // query members, so they are written where a return visit and a copied address can find them.
    setColumnVisibility(next.columnVisibility);
    commitQuery({ list: query.list, sort: sortInstructionsOfColumns(next.sort), page: next.page, pageSize: next.pageSize });
  };
  const handleSelectionChange = (ids: readonly string[]): void => {
    setSelection({ signature, ids });
  };
  const clearSelection = (): void => {
    setSelection({ signature, ids: NO_IDS });
  };
  const openCreate = (): void => {
    setEditor({ mode: "create" });
  };
  const openEdit = (row: TaskListRow): void => {
    // The read offers Edit only where it reported the row selectable, so a row that states otherwise opens no
    // form: this session may not change that task, and the service would refuse the write it could not make.
    const record = editableTaskRecord(row, scope);
    if (record !== null) setEditor({ mode: "edit", record });
  };
  const closeEditor = (): void => {
    setEditor(null);
  };
  /** The list on screen: its rows, the reason it holds none, or the refusal the read answered with. */
  function listContent(): ReactNode {
    if (reading === undefined) {
      if (active.isError) {
        // The request itself did not answer, so no row and no count stands in its place; the other lists are
        // unaffected and the retry re-requests this one.
        return (
          <StateNotice
            kind="unavailable"
            headingLevel={3}
            title={`The ${TASK_LIST_LABELS[query.list]} list could not be read`}
            description="This page's request for the list did not answer, so nothing is shown in its place. Retry the list, and reset the development data if it keeps failing."
            retry={{
              label: "Try this list again",
              onClick: () => {
                void active.refetch();
              },
            }}
          />
        );
      }
      return <StateNotice kind="loading" headingLevel={3} title={`Reading the ${TASK_LIST_LABELS[query.list]} list`} loadingLines={4} />;
    }
    switch (reading.kind) {
      case "envelope": {
        const { tasks, total } = reading.envelope.data;
        if (total === 0) {
          // A list that holds nothing says which work it would have carried, and offers the one action that
          // creates work rather than an illustration.
          return <StateNotice kind="empty" headingLevel={3} title={EMPTY_LIST_COPY[query.list].title} description={EMPTY_LIST_COPY[query.list].description} action={{ label: NEW_TASK_LABEL, onClick: openCreate }} />;
        }
        return (
          <RecordList
            label={`${TASK_LIST_LABELS[query.list]} ${TASK_NOUN}`}
            columns={columns}
            rows={tasks}
            rowCount={total}
            getRowId={taskRowId}
            rowLabel={taskRowLabel}
            queryState={listState}
            onQueryStateChange={handleQueryStateChange}
            selectedIds={selectedIds}
            onSelectionChange={handleSelectionChange}
            rowActions={(row) => (
              <TaskActions
                taskId={row.taskId}
                title={row.title}
                status={row.status}
                revision={row.revision}
                scope={scope}
                actions={row.actions}
                presentation="row"
                onEdit={() => {
                  openEdit(row);
                }}
                onCheckResult={refreshAll}
                headingLevel={4}
              />
            )}
            itemNoun={TASK_NOUN}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        );
      }
      case "denied":
        // A refusal states its closed reason and nothing else: no row, no count and no hint of what the list would
        // have held, because a denial is not an empty list.
        return (
          <StateNotice
            kind="denied"
            headingLevel={3}
            title={`The ${TASK_LIST_LABELS[query.list]} list is not available in this context`}
            description="This session may not read this list in the context it is working in, so no row and no count is stated here. Another context, if this session holds one, can be chosen from the shell."
            reasonCode={reading.denied.reasonCode}
          />
        );
      case "unavailable":
        return (
          <StateNotice
            kind="unavailable"
            headingLevel={3}
            title={`The ${TASK_LIST_LABELS[query.list]} list could not be read`}
            description={reading.unavailable.guidance}
            source={reading.unavailable.source}
            retry={{
              label: "Try this list again",
              onClick: () => {
                void active.refetch();
              },
            }}
          />
        );
      case "refused":
        // The query this surface states is the read's own admitted one, so a refusal is defensive: it is answered
        // in this list's words rather than thrown, and it says the request was refused, not that the source failed.
        return (
          <StateNotice
            kind="refused"
            headingLevel={3}
            title={`The request for the ${TASK_LIST_LABELS[query.list]} list was refused`}
            description="This surface states only the list, the display time zone and a page size the read admits, so a request it refuses is answered here in its own words. The source behind it did not fail."
          />
        );
    }
  }
  const body = listContent();
  // One switcher control is rendered, never two: the segmented control needs room for five labels, so a phone gets
  // the native picker instead, which keeps its selected value, its option order and its accessible name the same.
  // Nothing here hides a focusable control, because the control that is not rendered is not in the page.
  const listRegion = isNarrow ? (
    <div className={SECTION_CLASS}>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={switcherId}>{LIST_SWITCHER_LABEL}</Label>
        <NativeSelect
          id={switcherId}
          value={query.list}
          className="w-full"
          onChange={(event) => {
            changeList(event.currentTarget.value);
          }}
        >
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
    <Tabs
      value={query.list}
      onValueChange={(next) => {
        changeList(String(next));
      }}
      className="min-w-0 gap-3"
    >
      <TabsList aria-label={LIST_SWITCHER_LABEL} className="h-auto max-w-full flex-wrap group-data-horizontal/tabs:h-auto">
        {TASK_LIST_KEYS.map((list) => (
          <TabsTrigger key={list} value={list}>
            {TASK_LIST_LABELS[list]}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* The panel holds the table and its controls, so it takes no place in the tab order of its own: a stop with
          nothing drawn around it reads as a keyboard trap, and the preset's own controls are the stops a worker
          needs here. */}
      <TabsContent value={query.list} tabIndex={-1} className={LIST_BODY_CLASS}>
        {body}
      </TabsContent>
    </Tabs>
  );
  return (
    <div data-slot="work-task-lists" data-list={query.list} className={cn("flex min-w-0 flex-col gap-6", className)}>
      {editor === null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button type="button" onClick={openCreate}>
            {NEW_TASK_LABEL}
          </Button>
          <p className={cn(QUIET_CLASS, "max-w-prose")}>{NEW_TASK_NOTE}</p>
        </div>
      ) : editor.mode === "create" ? (
        // The composer owns the create form, its schema, its attempt identity and its receipt: this surface only
        // decides where it is mounted and what it opens with.
        <TaskComposer mode="create" scope={scope} expectedRevision={expectedRevision} initialValues={initialValues} timeZoneChoices={timeZoneChoices} defaultTimeZone={displayTimeZone} linkChoices={linkChoices} headingLevel={2} onCancel={closeEditor} onDismiss={closeEditor} />
      ) : (
        <TaskComposer mode="edit" record={editor.record} scope={scope} expectedRevision={editor.record.revision} timeZoneChoices={timeZoneChoices} defaultTimeZone={displayTimeZone} linkChoices={linkChoices} headingLevel={2} onCancel={closeEditor} onDismiss={closeEditor} />
      )}
      {selectedTasks.length === 0 ? null : (
        <BulkActionBar scope={scope} expectedRevision={expectedRevision} selectedTasks={selectedTasks} onClearSelection={clearSelection} onCheckResult={refreshAll} />
      )}
      <div className={SECTION_CLASS}>
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className={HEADING_CLASS}>{LIST_REGION_HEADING}</h2>
          <p className={cn(QUIET_CLASS, "max-w-prose")}>{BULK_SELECTION_SCOPE_NOTE}</p>
        </div>
        {listRegion}
      </div>
      {hasPlannedTime ? <p className={cn(QUIET_CLASS, "max-w-prose")}>{PLANNED_VERSUS_HELD_NOTE}</p> : null}
    </div>
  );
}

