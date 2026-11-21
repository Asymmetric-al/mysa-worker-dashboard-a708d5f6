"use client";
/**
 * The five task lists of the Work surface, with the one composer and the three bulk actions over the rows a
 * worker explicitly selected.
 *
 * **What this file is.** The browser half of `reads.work.listTasks`. The route reads all five lists for the
 * session's context and hands this surface their answers, so the first paint states exactly what the server
 * read — and every accepted task mutation invalidates the same five cache entries, which is how a row's status
 * comes back current without this file computing one.
 *
 * **Why every date is judged in one stated zone.** A server render cannot know this browser's chosen display
 * zone, so the route names the zone it read in and this surface re-reads in that same zone. The alternative —
 * a browser read in the browser's own zone beside a server render in another — would put two different
 * todays in one page, and a task the worker can see would fall into a different list after hydration.
 *
 * **What it never does.** It never filters a list, counts a total, or decides whether a row may change: the
 * service owns every query and every permission, and each row states the status, the date relation and the
 * advisory actions the read reported for it.
 */
import { useState, type ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Scope, TaskRecord } from "@/modules/data-service/envelope";
import { TASK_LIST_KEYS, TASK_LIST_LABELS, type TaskListKey } from "../copy/task-status";
import { useTaskLists, type TaskListsResult, type TaskListsQuery } from "../hooks/use-task-lists";
import BulkActionBar, { type BulkSelectionRow } from "./bulk-action-bar";
import TaskComposer, { type TaskComposerInitialValues, type TaskLinkChoices } from "./task-composer";
import WorkTaskRow, { editableTaskRecord, type WorkTaskRowView } from "./work-task-row";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The page window every list is read at: the documented cap, so a list states its whole result rather than a page a reader cannot see past. */
const TASK_PAGE_SIZE = 200;

/** The surface's own wording. Status, kind and date words come from `../copy/task-status`. */
const NEW_TASK_LABEL = "New task";

const NEW_TASK_NOTE = "A task needs only a title. Linking a partner or a plan changes nothing else, and no task here sends a message or creates a stewardship obligation.";

const TASK_NOUN = { one: "task", many: "tasks" } as const;

const SHOWN_OF_TOTAL_TEMPLATE = "Showing {shown} of {total} in this list.";

const SECTION_CLASS = "flex min-w-0 flex-col gap-3";

const ROW_LIST_CLASS = "flex min-w-0 flex-col";

const HEADING_CLASS = "font-heading text-lg font-medium text-pretty";

const QUIET_CLASS = "text-sm text-pretty text-muted-foreground";

/** What each list states when the read answers with no row at all: an empty list says which work it holds, never just "none". */
const EMPTY_LIST_COPY: Readonly<Record<TaskListKey, { readonly title: string; readonly description: string }>> = {
  today: { title: "Nothing is due today", description: "No open task in this context is dated today. Work dated later sits in Upcoming, and work with no date sits in Undated." },
  upcoming: { title: "Nothing is dated ahead", description: "No open task in this context carries a date after today. Undated work is read in its own list rather than listed here." },
  overdue: { title: "Nothing is past its date", description: "Every open task in this context is dated today or later, so no task has passed its date without an answer." },
  all: { title: "This context holds no task", description: "No task exists in this context yet — open, completed, reopened or cancelled — so there is nothing to complete, reopen, edit or cancel." },
  undated: { title: "No task is undated", description: "Every task in this context states a due date, so undated work has its own list with nothing in it." },
};

const NO_SELECTION: readonly string[] = [];

/** The list a query asks for, built from the zone the whole surface reads in. */
function queryOf(list: TaskListKey, displayTimeZone: string): TaskListsQuery {
  return { list, displayTimeZone, pageSize: TASK_PAGE_SIZE };
}

/** The rows one list read answered with, and none when the read answered with a refusal instead of a result. */
function rowsOf(result: TaskListsResult): readonly WorkTaskRowView[] {
  return result.kind === "envelope" ? result.envelope.data.tasks : [];
}

/** One selected row as the bulk bar states it: the identifier a request names, the status the row holds and whether the read admitted a change. */
function selectionRowOf(row: WorkTaskRowView): BulkSelectionRow {
  return { taskId: row.taskId, status: row.status, selectable: row.selectable, ...(row.selectionReason === undefined ? {} : { selectionReason: row.selectionReason }) };
}

/** The count a list states: its own whole result, and how much of it the page carries when the cap cut it short. */
function countTextOf(result: TaskListsResult): string {
  if (result.kind !== "envelope") return "";
  const { total, tasks } = result.envelope.data;
  const noun = total === 1 ? TASK_NOUN.one : TASK_NOUN.many;
  if (tasks.length < total) return SHOWN_OF_TOTAL_TEMPLATE.replace("{shown}", String(tasks.length)).replace("{total}", String(total));
  return `${String(total)} ${noun}`;
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

export interface WorkTaskListsProps {
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

// ---------------------------------------------------------------------------------------------
// One list
// ---------------------------------------------------------------------------------------------

interface TaskListSectionProps {
  readonly list: TaskListKey;
  readonly result: TaskListsResult;
  readonly scope: Scope;
  readonly partnerLabels: Readonly<Record<string, string>>;
  readonly selectedIds: readonly string[];
  readonly onSelectedChange: (taskId: string, selected: boolean) => void;
  readonly onEdit: (row: WorkTaskRowView) => void;
  readonly onRetry: () => void;
}

/** One list: its own heading, the count the read reported, and either its rows or the notice its refusal is stated with. */
function TaskListSection({ list, result, scope, partnerLabels, selectedIds, onSelectedChange, onEdit, onRetry }: TaskListSectionProps): ReactElement {
  const label = TASK_LIST_LABELS[list];
  switch (result.kind) {
    case "envelope": {
      const { tasks, total } = result.envelope.data;
      return (
        <section aria-label={label} data-slot="work-task-list" data-list={list} className={SECTION_CLASS}>
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <h2 className={HEADING_CLASS}>{label}</h2>
            <p className={QUIET_CLASS}>{countTextOf(result)}</p>
          </div>
          {tasks.length === 0 && total === 0 ? (
            <StateNotice kind="empty" headingLevel={3} title={EMPTY_LIST_COPY[list].title} description={EMPTY_LIST_COPY[list].description} />
          ) : (
            <ul className={ROW_LIST_CLASS}>
              {tasks.map((row) => (
                <WorkTaskRow
                  key={row.taskId}
                  row={row}
                  scope={scope}
                  partnerLabel={row.partnerId === null ? null : (partnerLabels[row.partnerId] ?? null)}
                  selection={{ selected: selectedIds.includes(row.taskId), onSelectedChange: (selected: boolean) => onSelectedChange(row.taskId, selected) }}
                  onEdit={onEdit}
                  headingLevel={3}
                />
              ))}
            </ul>
          )}
        </section>
      );
    }
    case "denied":
      // A refusal states its closed reason code and nothing else: no row, no count and no hint of what the list
      // would have held, because a denial is not an empty list.
      return (
        <section aria-label={label} data-slot="work-task-list" data-list={list} className={SECTION_CLASS}>
          <h2 className={HEADING_CLASS}>{label}</h2>
          <StateNotice kind="denied" headingLevel={3} title={`${label} is not available in this context`} description="This session may not read this list in the context it is working in, so no row and no count is stated here. Another context, if this session holds one, can be chosen from the shell." reasonCode={result.denied.reasonCode} />
        </section>
      );
    case "unavailable":
      // The source did not answer, so the list is reported as unavailable and never as one that holds nothing.
      return (
        <section aria-label={label} data-slot="work-task-list" data-list={list} className={SECTION_CLASS}>
          <h2 className={HEADING_CLASS}>{label}</h2>
          <StateNotice kind="unavailable" headingLevel={3} title={`${label} could not be read`} description={result.unavailable.guidance} source={result.unavailable.source} retry={{ label: "Try this list again", onClick: onRetry }} />
        </section>
      );
    case "refused":
      // The query this surface states is the read's own admitted one, so a refusal is defensive: it is stated in
      // this list's words rather than thrown, and it says the request was refused rather than the source failing.
      return (
        <section aria-label={label} data-slot="work-task-list" data-list={list} className={SECTION_CLASS}>
          <h2 className={HEADING_CLASS}>{label}</h2>
          <StateNotice kind="refused" headingLevel={3} title={`The request for ${label.toLowerCase()} was refused`} description="This view states only the list, the display time zone and a page size the read admits, so a refusal is answered here in this list's own words rather than thrown. The source behind it did not fail." />
        </section>
      );
  }
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/** The five lists, the composer and the bulk actions over the rows a worker selected. */
export default function WorkTaskLists({ scope, expectedRevision, lists, displayTimeZone, partnerLabels, linkChoices, timeZoneChoices, initialValues, className }: WorkTaskListsProps): ReactElement {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(NO_SELECTION);
  const [editor, setEditor] = useState<EditorState | null>(null);
  // Five reads, each keyed by the whole query it sends: React Query hashes the key structurally, so rebuilding
  // the same query every render addresses the same cache entry rather than starting a second read.
  const reads = {
    today: useTaskLists(scope, queryOf("today", displayTimeZone), lists.today),
    upcoming: useTaskLists(scope, queryOf("upcoming", displayTimeZone), lists.upcoming),
    overdue: useTaskLists(scope, queryOf("overdue", displayTimeZone), lists.overdue),
    all: useTaskLists(scope, queryOf("all", displayTimeZone), lists.all),
    undated: useTaskLists(scope, queryOf("undated", displayTimeZone), lists.undated),
  };
  const results: Readonly<Record<TaskListKey, TaskListsResult>> = {
    today: reads.today.data ?? lists.today,
    upcoming: reads.upcoming.data ?? lists.upcoming,
    overdue: reads.overdue.data ?? lists.overdue,
    all: reads.all.data ?? lists.all,
    undated: reads.undated.data ?? lists.undated,
  };
  // One task appears in several lists at once, so the selection is resolved once per task: the same identifier
  // named twice would send one bulk request carrying the same row twice.
  const rowsById = new Map<string, WorkTaskRowView>();
  for (const list of TASK_LIST_KEYS) {
    for (const row of rowsOf(results[list])) {
      if (!rowsById.has(row.taskId)) rowsById.set(row.taskId, row);
    }
  }
  const selectedRows = selectedIds.flatMap((taskId) => {
    const row = rowsById.get(taskId);
    return row === undefined || !row.selectable ? [] : [row];
  });
  const refresh = (list: TaskListKey): Promise<void> => {
    return reads[list].refetch().then(() => undefined);
  };
  // An attempt whose acknowledgement was lost may have touched rows in any list, so recovery re-reads all five
  // rather than guessing which one holds them: what a lost bulk request did is read back from the lists.
  const refreshAll = (): void => {
    for (const list of TASK_LIST_KEYS) void refresh(list);
  };
  const changeSelection = (taskId: string, selected: boolean): void => {
    setSelectedIds((current) => {
      if (!selected) return current.filter((candidate) => candidate !== taskId);
      return current.includes(taskId) ? current : [...current, taskId];
    });
  };
  const clearSelection = (): void => {
    setSelectedIds(NO_SELECTION);
  };
  const openEditor = (row: WorkTaskRowView): void => {
    const record = editableTaskRecord(row, scope);
    // The read offers Edit only where it reported the row selectable, so a row that states otherwise opens no
    // form: this session may not change that task and the service would refuse the write it could not make.
    if (record === null) return;
    setEditor({ mode: "edit", record });
  };
  const closeEditor = (): void => {
    setEditor(null);
  };
  return (
    <div data-slot="work-task-lists" className={cn("flex min-w-0 flex-col gap-6", className)}>
      {editor === null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => {
              setEditor({ mode: "create" });
            }}
          >
            {NEW_TASK_LABEL}
          </Button>
          <p className={cn(QUIET_CLASS, "max-w-prose")}>{NEW_TASK_NOTE}</p>
        </div>
      ) : editor.mode === "create" ? (
        // The composer owns the create form, its schema, its review step and its receipt: this surface only
        // decides where it is mounted and what it opens with.
        <TaskComposer mode="create" scope={scope} expectedRevision={expectedRevision} initialValues={initialValues} timeZoneChoices={timeZoneChoices} defaultTimeZone={displayTimeZone} linkChoices={linkChoices} headingLevel={2} onCancel={closeEditor} onDismiss={closeEditor} />
      ) : (
        <TaskComposer mode="edit" record={editor.record} scope={scope} expectedRevision={editor.record.revision} timeZoneChoices={timeZoneChoices} defaultTimeZone={displayTimeZone} linkChoices={linkChoices} headingLevel={2} onCancel={closeEditor} onDismiss={closeEditor} />
      )}
      {selectedRows.length === 0 ? null : (
        <BulkActionBar
          scope={scope}
          expectedRevision={expectedRevision}
          selectedTasks={selectedRows.map(selectionRowOf)}
          onClearSelection={clearSelection}
          onCheckResult={refreshAll}
        />
      )}
      <div className="flex min-w-0 flex-col gap-8">
        {TASK_LIST_KEYS.map((list) => (
          <TaskListSection
            key={list}
            list={list}
            result={results[list]}
            scope={scope}
            partnerLabels={partnerLabels}
            selectedIds={selectedIds}
            onSelectedChange={changeSelection}
            onEdit={openEditor}
            onRetry={() => {
              void refresh(list);
            }}
          />
        ))}
      </div>
    </div>
  );
}
