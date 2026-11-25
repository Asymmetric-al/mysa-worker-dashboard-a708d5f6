"use client";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import RecordList, { type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import StatusBadge from "@/components/status-badge";
import { CalendarGrid, type CalendarEventItem } from "@/components/ui/calendar-grid";
import { SegmentedTabs, type SegmentedOption } from "@/components/ui/segmented-tabs";
import type { Scope } from "@/modules/data-service/envelope";
import { parseCivilDate, serialiseCivilDate } from "@/modules/time/civil";
import { PLANNED_VERSUS_HELD_NOTE, TASK_LIST_LABELS, TASK_STATUS_LABELS, UNDATED_LABEL } from "../copy/task-status";
import { useAgenda, type AgendaQuery, type AgendaResult } from "../hooks/use-agenda";
import TaskActions, { TaskActionResult, type TaskActionReceipt } from "./task-actions";
import { taskListColumns } from "./task-lists";
type AgendaEnvelope = Extract<AgendaResult, { readonly kind: "envelope" }>["envelope"];
type AgendaDays = AgendaEnvelope["data"]["days"];
type AgendaRow = AgendaDays[number]["items"][number];
const WORK_HREF = "/work";
const NO_SORT: RecordListQueryState["sort"] = [];
const DEFAULT_COLUMN_VISIBILITY: RecordListQueryState["columnVisibility"] = {};
const SURFACE_CLASS = "flex min-w-0 flex-col gap-4";
const HEADING_CLASS = "type-section-title flex min-w-32 flex-wrap items-baseline gap-x-2 break-words text-pretty";
const MUTED_CLASS = "type-supporting";
const QUIET_CLASS = "max-w-prose type-supporting text-pretty";
const WEEKDAY_NAMES: Readonly<Record<number, string>> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };
const MONTH_NAMES: Readonly<Record<number, string>> = { 1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June", 7: "July", 8: "August", 9: "September", 10: "October", 11: "November", 12: "December" };
const DAY_MARKERS: Readonly<Record<AgendaRow["dateRelation"], string | undefined>> = { today: TASK_LIST_LABELS.today, past: TASK_LIST_LABELS.overdue, future: undefined, undated: undefined };
const EMPTY_COPY = { title: "No dated work is open", body: "No open task in this context carries a due date, so no day groups anything. Work with no date is read on the five task lists, where a task is also given a date and completed, reopened or cancelled.", action: "Add a task on the lists" } as const;
const RETRY_LABEL = "Try this read again";
const FAILED_COPY = { title: "The dated agenda could not be read", body: "This page's request for the agenda did not answer, so no day, row or count is shown in its place. Retry the read, and reset the development data if it keeps failing." } as const;
const DENIED_COPY = { title: "The dated agenda is not available in this context", body: "This session may not read the tasks of the context it is working in, so no day, row or count is stated here. Another context, if this session holds one, can be chosen from the shell." } as const;
const REFUSED_COPY = { title: "This view's request was refused", body: "The agenda states only the display time zone and a page size the read admits, so a request the read refuses is answered here rather than thrown, and the source behind it did not fail." } as const;
type CivilDateText = { readonly heading: string; readonly compact: string; readonly machine: string };
function civilDateTextOf(stored: string): CivilDateText {
  const parsed = parseCivilDate(stored);
  if (parsed.status !== "parsed") return { heading: stored, compact: stored, machine: stored };
  const date = parsed.date;
  const weekday = WEEKDAY_NAMES[date.dayOfWeek] ?? "";
  const month = MONTH_NAMES[date.month] ?? "";
  const day = String(date.day);
  const year = String(date.year);
  return { heading: `${weekday} ${day} ${month} ${year}`.trim(), compact: `${day} ${month}`.trim(), machine: serialiseCivilDate(date) };
}
function sameWindow(envelope: AgendaEnvelope, query: AgendaQuery): boolean {
  const { displayTimeZone, page, pageSize } = envelope.data;
  return displayTimeZone === query.displayTimeZone && page === query.page && pageSize === query.pageSize;
}
type DayCell = { readonly kind: "dated"; readonly text: CivilDateText; readonly marker: string | undefined; readonly lead: boolean } | { readonly kind: "undated"; readonly lead: boolean };
type AgendaLayout = { readonly rows: readonly AgendaRow[]; readonly dayCells: ReadonlyMap<string, DayCell> };
function layoutOf(days: AgendaDays): AgendaLayout {
  const rows: AgendaRow[] = [];
  const dayCells = new Map<string, DayCell>();
  const undated: AgendaRow[] = [];
  for (const day of days) {
    const text = civilDateTextOf(day.dueOn);
    let lead = true;
    for (const row of day.items) {
      if (row.dueOn === null) {
        undated.push(row);
        continue;
      }
      rows.push(row);
      dayCells.set(row.taskId, { kind: "dated", text, marker: lead ? DAY_MARKERS[row.dateRelation] : undefined, lead });
      lead = false;
    }
  }
  let undatedLead = true;
  for (const row of undated) {
    rows.push(row);
    dayCells.set(row.taskId, { kind: "undated", lead: undatedLead });
    undatedLead = false;
  }
  return { rows, dayCells };
}
function dayCellNode(cell: DayCell | undefined): ReactNode {
  if (cell === undefined) return null;
  if (cell.kind === "undated") return cell.lead ? <h2 className={HEADING_CLASS}>{UNDATED_LABEL}</h2> : <span className={MUTED_CLASS}>{UNDATED_LABEL}</span>;
  if (!cell.lead)
    return (
      <time dateTime={cell.text.machine} className={MUTED_CLASS}>
        {cell.text.compact}
      </time>
    );
  return (
    <h2 className={HEADING_CLASS}>
      <time dateTime={cell.text.machine}>{cell.text.heading}</time>
      {cell.marker === undefined ? null : <StatusBadge label={cell.marker} tone={cell.marker === TASK_LIST_LABELS.overdue ? "caution" : "info"} />}
    </h2>
  );
}
interface AgendaBodyProps {
  readonly scope: Scope;
  readonly envelope: AgendaEnvelope;
  readonly partnerLabels: Readonly<Record<string, string>>;
  readonly columnVisibility: RecordListQueryState["columnVisibility"];
  readonly onQueryStateChange: (next: RecordListQueryState) => void;
  readonly onEdit: () => void;
  readonly onReceiptChange: (receipt: TaskActionReceipt | null) => void;
  readonly onCheckResult: () => void;
}
type AgendaViewMode = "list" | "calendar";
const AGENDA_VIEW_OPTIONS: readonly SegmentedOption<AgendaViewMode>[] = [
  { value: "list", label: "List view" },
  { value: "calendar", label: "Calendar view" },
];

function AgendaBody({ scope, envelope, partnerLabels, columnVisibility, onQueryStateChange, onEdit, onReceiptChange, onCheckResult }: AgendaBodyProps): ReactElement {
  const { data } = envelope;
  const [viewMode, setViewMode] = useState<AgendaViewMode>("list");
  const layout = useMemo<AgendaLayout>(() => layoutOf(data.days), [data.days]);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<AgendaRow>>>(() => {
    const dayColumn: RecordListColumnDef<AgendaRow> = { id: "agenda-day", header: "Day", enableSorting: false, enableHiding: false, cell: (context) => dayCellNode(layout.dayCells.get(context.row.original.taskId)) };
    const listColumns: RecordListColumnDef<AgendaRow>[] = [dayColumn];
    for (const column of taskListColumns({ partnerLabels })) {
      if (column.id === "dueOn") continue;
      listColumns.push(((column: RecordListColumnDef<AgendaRow>): RecordListColumnDef<AgendaRow> => ({ ...column, enableSorting: false }))(column));
    }
    return listColumns;
  }, [layout, partnerLabels]);
  const calendarEvents = useMemo<readonly CalendarEventItem[]>(
    () =>
      layout.rows.flatMap((row) => {
        if (row.dueOn === null) return [];
        const parsed = parseCivilDate(row.dueOn);
        const dateIso = parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : row.dueOn;
        return [
          {
            id: row.taskId,
            dateIso,
            title: row.title,
            statusLabel: row.dateRelation === "past" ? TASK_LIST_LABELS.overdue : TASK_STATUS_LABELS[row.status],
            subtitle: row.plannedTime !== null && row.timeZone !== null ? `${row.plannedTime} (${row.timeZone})` : row.category ?? undefined,
            overdue: row.dateRelation === "past",
          },
        ];
      }),
    [layout.rows],
  );
  const todayIso = useMemo(() => {
    const todayRow = layout.rows.find((row) => row.dateRelation === "today" && row.dueOn !== null);
    if (todayRow === undefined || todayRow.dueOn === null) return undefined;
    const parsed = parseCivilDate(todayRow.dueOn);
    return parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : todayRow.dueOn;
  }, [layout.rows]);
  // This agenda's own notice for a read that holds no dated work is handed to the one table pattern rather than returned in the list's place, so an agenda with no day states its total and its page size as every other list does.
  const emptyState = <StateNotice kind="empty" headingLevel={2} title={EMPTY_COPY.title} description={EMPTY_COPY.body} action={{ label: EMPTY_COPY.action, href: WORK_HREF }} />;
  const queryState: RecordListQueryState = { sort: NO_SORT, page: data.page, pageSize: data.pageSize, columnVisibility };
  const hasPlannedTime = layout.rows.some((row) => row.plannedTime !== null);
  const rowActions = (row: AgendaRow): ReactElement => <TaskActions taskId={row.taskId} title={row.title} status={row.status} revision={row.revision} scope={scope} actions={row.actions} presentation="row" onEdit={onEdit} onReceiptChange={onReceiptChange} onCheckResult={onCheckResult} />;
  const list = <RecordList label="Dated agenda" columns={columns} rows={layout.rows} rowCount={data.total} getRowId={(row) => row.taskId} rowLabel={(row) => row.title} initialPinnedColumns={{ start: ["agenda-day"] }} queryState={queryState} onQueryStateChange={onQueryStateChange} rowActions={rowActions} itemNoun="tasks" emptyState={emptyState} />;
  // An agenda holding no dated work states that notice and the pager in place of the table, and both notes below describe rows to complete, reopen or edit, so they are stated only where the agenda holds one.
  if ((envelope.valueStates["total"] ?? "value") === "zero") return list;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs label="Agenda layout" value={viewMode} onValueChange={setViewMode} options={AGENDA_VIEW_OPTIONS} />
        <span className="text-xs text-muted-foreground">Read-only calendar inspection — edit dates from the task composer.</span>
      </div>
      {viewMode === "calendar" ? <CalendarGrid events={calendarEvents} todayIso={todayIso} label="Dated agenda calendar" emptyDayMessage="No dated open task falls on this calendar day." /> : list}
      {hasPlannedTime ? <p className={QUIET_CLASS}>{PLANNED_VERSUS_HELD_NOTE}</p> : null}
      <p className={QUIET_CLASS}>{"Completing, reopening and cancelling a task happen here exactly as they do on the lists. Editing a task's date, title, category or link opens the composer on the lists, because a date is changed by choosing it there and never by dragging a row onto a day."}</p>
    </>
  );
}
export type AgendaProps = {
  readonly scope: Scope;
  readonly envelope: AgendaEnvelope;
  readonly partnerLabels: Readonly<Record<string, string>>;
  /** The display time zone the browser chose in Settings, handed down by the route: the zone this surface asks its read to resolve the day today in, so the day a row is grouped under is judged in the zone the worker chose rather than one this surface assumes. */ readonly displayTimeZone: string;
  readonly className?: string;
};
/** One agenda for one context: the read the route already made, the window a worker widens or pages into, and the read's own refusals stated in their own words. */ export default function Agenda({ scope, envelope, partnerLabels, displayTimeZone, className }: AgendaProps): ReactElement {
  const router = useRouter();
  const [window, setWindow] = useState<{ readonly page: number; readonly pageSize: number }>({ page: envelope.data.page, pageSize: envelope.data.pageSize });
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(DEFAULT_COLUMN_VISIBILITY);
  // The one receipt a row action publishes, held here rather than by the row: completing a task takes its row out of the dated read, and a surface whose body states that no day is left would otherwise say nothing about the change it accepted.
  const [receipt, setReceipt] = useState<TaskActionReceipt | null>(null);
  // The read asks for the zone the browser chose in Settings rather than the zone the server render assumed, so today is resolved in the zone the worker picked and a window the worker pages into keeps that zone.
  const query = useMemo<AgendaQuery>(() => ({ displayTimeZone, page: window.page, pageSize: window.pageSize }), [displayTimeZone, window.page, window.pageSize]);
  const seed = sameWindow(envelope, query) ? envelope : undefined; // The window the server already read, when it is the one on screen: seeding the read with it means mounting the agenda asks for nothing the page has already read, and a window the worker pages into is still asked for.
  const seededAnswer: AgendaResult | undefined = seed === undefined ? undefined : { kind: "envelope", envelope: seed };
  const read = useAgenda(scope, query, seededAnswer);
  const reading: AgendaResult | undefined = read.data ?? seededAnswer;
  // The zone the days on this surface were judged in: the reading's own, which is the zone the read resolved its today in, and the queried zone only until that reading exists.
  const judgedZone = reading !== undefined && reading.kind === "envelope" ? reading.envelope.data.displayTimeZone : displayTimeZone;
  const readAgain = read.refetch;
  const refresh = useCallback((): void => void readAgain(), [readAgain]);
  const openEdit = useCallback((): void => router.push(WORK_HREF), [router]);
  const handleQueryStateChange = useCallback((next: RecordListQueryState): void => {
    setColumnVisibility(next.columnVisibility);
    setWindow((current) => (next.page === current.page && next.pageSize === current.pageSize ? current : { page: next.page, pageSize: next.pageSize }));
  }, []);
  function content(): ReactNode {
    if (reading === undefined) {
      if (read.isError) return <StateNotice kind="unavailable" headingLevel={2} title={FAILED_COPY.title} description={FAILED_COPY.body} retry={{ label: RETRY_LABEL, onClick: refresh }} />;
      return <StateNotice kind="loading" headingLevel={2} title="Reading the dated agenda" loadingLines={4} />;
    }
    switch (reading.kind) {
      case "envelope":
        return <AgendaBody scope={scope} envelope={reading.envelope} partnerLabels={partnerLabels} columnVisibility={columnVisibility} onQueryStateChange={handleQueryStateChange} onEdit={openEdit} onReceiptChange={setReceipt} onCheckResult={refresh} />;
      case "denied":
        return <StateNotice kind="denied" headingLevel={2} title={DENIED_COPY.title} description={DENIED_COPY.body} reasonCode={reading.denied.reasonCode} />;
      case "unavailable":
        return <StateNotice kind="unavailable" headingLevel={2} title="The dated agenda could not be read" description={reading.unavailable.guidance} source={reading.unavailable.source} retry={{ label: RETRY_LABEL, onClick: refresh }} />;
      case "refused":
        return <StateNotice kind="refused" headingLevel={2} title={REFUSED_COPY.title} description={REFUSED_COPY.body} />;
    }
  }
  return (
    <div data-slot="work-agenda" data-page={String(window.page)} data-page-size={String(window.pageSize)} className={className === undefined || className.trim() === "" ? SURFACE_CLASS : `${SURFACE_CLASS} ${className}`}>
      {/* Stated once above the surface's own content, so the zone the days on screen were grouped and judged in is read before any day is, on every arm the read answers — the empty one included. */}
      <p className={QUIET_CLASS}>{`Every day on this page is grouped and judged in ${judgedZone}, the display time zone this browser chose in Settings, and the agenda read in that same zone, so no day here is judged in two; a planned meeting still states the zone it is planned in.`}</p>
      {/* Above this surface's own content, so a row action's receipt is read in the agenda's own context whether or not the row that produced it is still part of the read. */}
      <TaskActionResult receipt={receipt} headingLevel={2} />
      {content()}
    </div>
  );
}
