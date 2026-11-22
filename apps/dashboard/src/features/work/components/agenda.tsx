"use client";
/**
 * The dated agenda: the open dated work of this context, grouped by the day each task is due, in the display
 * zone the read judged those dates in.
 *
 * **The grouping is the service's.** `reads.work.readAgenda` returns the days already ordered, already filtered
 * to the work that is waiting on an answer, and already judged against "today" in the stated zone. This surface
 * renders those days in the order it received them and never re-sorts, re-buckets or merges a row. It performs
 * no date arithmetic and reads no clock: the only time facts it uses are the ones the read states — the `dueOn`
 * a day was keyed by, the `dateRelation` each row carries, and the day's own label.
 *
 * **One list, one scroll region, one pager.** Every row is rendered by the application's one table preset with
 * the Work lists' own column definition, so a status word, a category, a planned time and a linked record are
 * worded identically on both destinations, and the surface states the size of the whole result rather than the
 * size of one page. A table per day would have introduced a second horizontal scroller, a second pager and a
 * second rows-per-page control for every day on the page, which is exactly what a surface that must never
 * scroll sideways as a page cannot have; the day is therefore one leading column that opens each group with its
 * heading, leaving a single labelled region that may scroll.
 *
 * **A day is never invented.** Undated work is a state of its own and is never given a midnight to group it
 * under. The read excludes it from the dated days — undated work is read on the five lists — and a row that
 * arrived without a date would be stated in its own group after the dated ones rather than under a day it does
 * not belong to.
 *
 * **What this surface does not do.** It sends nothing, books nothing and completes nothing on its own account:
 * the actions are the read's advisory list, re-checked by the service on submit, and completing a task records
 * that the work was closed and says nothing about contact, payment or a message. Nothing here is dragged to
 * another day, so no action on this surface requires a drag gesture.
 */
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";

import RecordList, { type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import type { Scope } from "@/modules/data-service/envelope";
import { parseCivilDate, serialiseCivilDate } from "@/modules/time/civil";

import { PLANNED_VERSUS_HELD_NOTE, TASK_LIST_LABELS, UNDATED_LABEL } from "../copy/task-status";
import { useAgenda, type AgendaQuery, type AgendaResult } from "../hooks/use-agenda";
import TaskActions from "./task-actions";
import { taskListColumns } from "./task-lists";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** The agenda read's envelope arm: what this surface renders, named once from the service's own types. */
type AgendaEnvelope = Extract<AgendaResult, { readonly kind: "envelope" }>["envelope"];

/** One day the read grouped, and one task row as that read projects it. */
type AgendaDays = AgendaEnvelope["data"]["days"];

type AgendaRow = AgendaDays[number]["items"][number];

/** The query window this surface asks for: the display zone the route chose, and the page it is reading. */
type PageWindow = { readonly page: number; readonly pageSize: number };

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The name the one table preset gives the region, its caption and its scroll region. */
const REGION_LABEL = "Dated agenda";

const TASK_NOUN = "tasks";

/** The lists, which is where a task is created, edited and given a date, because the composer lives there. */
const WORK_HREF = "/work";

/** The leading column that opens each day, and the lists' own date column it stands in for. */
const DAY_COLUMN_ID = "agenda-day";

const DAY_COLUMN_LABEL = "Day";

const DUE_DATE_COLUMN_ID = "dueOn";

/** The envelope field this surface reads the emptiness of the agenda from. */
const TOTAL_FIELD = "total";

/** The agenda has no order of its own to offer: the read accepts a display zone and a page window, and nothing else. */
const NO_SORT: RecordListQueryState["sort"] = [];

const DEFAULT_COLUMN_VISIBILITY: RecordListQueryState["columnVisibility"] = {};

const LOADING_LINES = 4;

const CLASS_SEPARATOR = " ";

const SURFACE_CLASS = "flex min-w-0 flex-col gap-4";

/**
 * The heading that opens a day.
 *
 * The day column has no width of its own: every other column on this table is a single line of text, so the
 * automatic table layout gives this one only what its own contents ask for — and a heading allowed to break
 * anywhere asks for one character, which is what at 320 CSS px read `Mo / nd / ay / 19 / Oc / to / be / r`. Two
 * declarations fix that at the cause. `min-w-32` gives the column a floor of 8rem, wider than the longest day or
 * month name this surface states, so the table honours it and the date reads as words on a useful line;
 * `break-words` breaks inside a word only when no line can hold it, which the floor puts out of reach for a day
 * the calendar read and leaves as the bound for a stored value that could not be read back, rather than letting
 * one spill into the neighbouring column. The region keeps the table's extra width inside its own horizontal
 * scroll, so the page itself still never scrolls sideways.
 */
const HEADING_CLASS = "flex min-w-32 flex-wrap items-baseline gap-x-2 break-words font-heading text-base font-medium text-pretty";

const MUTED_CLASS = "text-sm text-muted-foreground";

const QUIET_CLASS = "max-w-prose text-sm text-pretty text-muted-foreground";

/** A civil date is worded from its own year, month, day and ISO weekday, so its heading never depends on a locale or a zone. */
const WEEKDAY_NAMES: Readonly<Record<number, string>> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };

const MONTH_NAMES: Readonly<Record<number, string>> = { 1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June", 7: "July", 8: "August", 9: "September", 10: "October", 11: "November", 12: "December" };

/**
 * How each day stands relative to the day the read called today, in the read's own vocabulary. The words are
 * the lists' own (`Today`, `Overdue`) so one fact is never stated two ways; a future day needs no word, because
 * the date itself says it, and an undated row is never part of a dated group.
 */
const DAY_MARKERS: Readonly<Record<AgendaRow["dateRelation"], string | undefined>> = { today: TASK_LIST_LABELS.today, past: TASK_LIST_LABELS.overdue, future: undefined, undated: undefined };

/** What the surface states when it holds no dated work, and the one real first action it offers. */
const EMPTY_COPY = { title: "No dated work is open", body: "No open task in this context carries a due date, so no day groups anything. Work with no date is read on the five task lists, where a task is also given a date and completed, reopened or cancelled.", action: "Add a task on the lists" } as const;

const LOADING_TITLE = "Reading the dated agenda";

const RETRY_LABEL = "Try this read again";

/** A request of this page's own that did not answer: the other surfaces in the same context are unaffected. */
const FAILED_COPY = { title: "The dated agenda could not be read", body: "This page's request for the agenda did not answer, so no day, row or count is shown in its place. Retry the read, and reset the development data if it keeps failing." } as const;

/** A refusal is not an empty agenda: no day, row, count or title of a hidden record is stated here. */
const DENIED_COPY = { title: "The dated agenda is not available in this context", body: "This session may not read the tasks of the context it is working in, so no day, row or count is stated here. Another context, if this session holds one, can be chosen from the shell." } as const;

const UNAVAILABLE_TITLE = "The dated agenda could not be read";

const REFUSED_COPY = { title: "This view's request was refused", body: "The agenda states only the display time zone and a page size the read admits, so a request the read refuses is answered here rather than thrown, and the source behind it did not fail." } as const;

/**
 * Why editing leaves this page. The composer that changes a task's date, title, category or link is mounted by
 * the lists, and the agenda opens it there rather than keeping a second form of its own.
 */
const EDIT_NOTE = "Completing, reopening and cancelling a task happen here exactly as they do on the lists. Editing a task's date, title, category or link opens the composer on the lists, because a date is changed by choosing it there and never by dragging a row onto a day.";

// ---------------------------------------------------------------------------------------------
// Reading a civil date for display
// ---------------------------------------------------------------------------------------------

/** How much of one civil date a cell states: the readable heading, the compact form, and the machine value. */
interface CivilDateText {
  readonly heading: string;
  readonly compact: string;
  readonly machine: string;
}

/**
 * The stored civil date as the words a reader needs, derived from the date itself rather than from a locale or
 * a clock: the same stored day states the same heading on the server render and in the browser, so no heading
 * can shift under a hydration, a display zone or a language setting that belongs to content and not to chrome.
 */
function civilDateTextOf(stored: string): CivilDateText {
  const parsed = parseCivilDate(stored);
  // A value that does not read back as the day it states is shown exactly as the read supplied it, rather than
  // being adjusted by the calendar into a day the worker was never told about.
  if (parsed.status !== "parsed") return { heading: stored, compact: stored, machine: stored };
  const date = parsed.date;
  const weekday = WEEKDAY_NAMES[date.dayOfWeek] ?? "";
  const month = MONTH_NAMES[date.month] ?? "";
  const day = String(date.day);
  const year = String(date.year);
  return { heading: `${weekday} ${day} ${month} ${year}`.trim(), compact: `${day} ${month}`.trim(), machine: serialiseCivilDate(date) };
}

// ---------------------------------------------------------------------------------------------
// The window an answer describes
// ---------------------------------------------------------------------------------------------

/**
 * Whether an envelope was read for exactly the window this surface is asking about.
 *
 * The envelope names the display zone, the page and the page size it was read at, so an answer that does not
 * name the window on screen is an answer about a different page and may never be painted under this heading.
 */
function sameWindow(envelope: AgendaEnvelope, query: AgendaQuery): boolean {
  const { displayTimeZone, page, pageSize } = envelope.data;
  return displayTimeZone === query.displayTimeZone && page === query.page && pageSize === query.pageSize;
}

// ---------------------------------------------------------------------------------------------
// The grouping the read stated, recorded so a heading is drawn once per day
// ---------------------------------------------------------------------------------------------

/** One row's place in the grouping: the day it opens or continues, or the date-less group it belongs to. */
type DayCell = { readonly kind: "dated"; readonly text: CivilDateText; readonly marker: string | undefined; readonly lead: boolean } | { readonly kind: "undated"; readonly lead: boolean };

/** The page's rows in the read's order, with the cell that says which day each one stands at. */
interface AgendaLayout {
  readonly rows: readonly AgendaRow[];
  readonly dayCells: ReadonlyMap<string, DayCell>;
}

/**
 * Walks the days exactly as the read returned them, recording which row opens each one.
 *
 * Nothing is re-grouped or re-ordered: the days are the service's own grouping and their items are already in
 * the service's order, so this walk only marks the first row of each day (the row that carries the heading) and
 * keeps aside any row the read stated without a date of its own, so that it is never drawn under a day.
 */
function layoutOf(days: AgendaDays): AgendaLayout {
  const rows: AgendaRow[] = [];
  const dayCells = new Map<string, DayCell>();
  const undated: AgendaRow[] = [];
  for (const day of days) {
    const text = civilDateTextOf(day.dueOn);
    let lead = true;
    for (const row of day.items) {
      // A row with no due date of its own is not part of a day: the heading would give it a date nobody stated.
      if (row.dueOn === null) {
        undated.push(row);
        continue;
      }
      rows.push(row);
      dayCells.set(row.taskId, { kind: "dated", text, marker: lead ? DAY_MARKERS[row.dateRelation] : undefined, lead });
      lead = false;
    }
  }
  // The read excludes undated work from the dated days, so this holds nothing in practice; when a row does
  // arrive without a date it is stated in a group of its own after the dated ones, never under a day.
  let undatedLead = true;
  for (const row of undated) {
    rows.push(row);
    dayCells.set(row.taskId, { kind: "undated", lead: undatedLead });
    undatedLead = false;
  }
  return { rows, dayCells };
}

// ---------------------------------------------------------------------------------------------
// The day column
// ---------------------------------------------------------------------------------------------

/**
 * The one cell that states where a row stands in the agenda: the day's heading on the row that opens it, and the
 * compact date on every later row of the same day, so a row is never left without the day it belongs to.
 */
function dayCellNode(cell: DayCell | undefined): ReactNode {
  if (cell === undefined) return null;
  if (cell.kind === "undated") return cell.lead ? <h2 className={HEADING_CLASS}>{UNDATED_LABEL}</h2> : <span className={MUTED_CLASS}>{UNDATED_LABEL}</span>;
  if (!cell.lead) {
    return (
      <span className={MUTED_CLASS}>
        <time dateTime={cell.text.machine}>{cell.text.compact}</time>
      </span>
    );
  }
  return (
    <h2 className={HEADING_CLASS}>
      <time dateTime={cell.text.machine}>{cell.text.heading}</time>
      {cell.marker === undefined ? null : <span className={MUTED_CLASS}>{cell.marker}</span>}
    </h2>
  );
}

/**
 * The same column with its sort control removed.
 *
 * The agenda's order is the read's — earliest day first, then the time a meeting was planned for, then the
 * record's own identity — and an ordering control here would promise a sort the read does not accept. Removing
 * it keeps the single column definition and hides nothing a worker could otherwise reach: the lists still sort.
 */
function withoutSorting(column: RecordListColumnDef<AgendaRow>): RecordListColumnDef<AgendaRow> {
  return { ...column, enableSorting: false };
}

// ---------------------------------------------------------------------------------------------
// The one list an agenda page renders
// ---------------------------------------------------------------------------------------------

interface AgendaBodyProps {
  /** The authority the agenda was read under, handed to each row's actions unchanged so the service re-checks it. */
  readonly scope: Scope;
  /** The agenda the route read, or the page this surface re-read for the window a worker chose. */
  readonly envelope: AgendaEnvelope;
  /** The partner labels the roster read admitted, so a linked partner is named rather than only referenced. */
  readonly partnerLabels: Readonly<Record<string, string>>;
  /** The columns a worker has chosen to show, kept on this surface: a display choice, never a query member. */
  readonly columnVisibility: RecordListQueryState["columnVisibility"];
  readonly onQueryStateChange: (next: RecordListQueryState) => void;
  /** Opens the composer that changes a task, which the lists mount. */
  readonly onEdit: () => void;
  /** Reads the agenda back after an attempt whose acknowledgement was lost. */
  readonly onCheckResult: () => void;
}

/**
 * The dated page of work as one list: the days in the read's order, and the honest state when it holds none.
 *
 * It is a local component, not an exported surface, because the layout and column work may only run when an
 * envelope exists: keeping it here lets the caller switch between the read's arms without making those hooks
 * conditional, and it introduces no second table, no second scroll region and no second pager.
 */
function AgendaBody({ scope, envelope, partnerLabels, columnVisibility, onQueryStateChange, onEdit, onCheckResult }: AgendaBodyProps): ReactElement {
  const { data } = envelope;
  const layout = useMemo<AgendaLayout>(() => layoutOf(data.days), [data.days]);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<AgendaRow>>>(() => {
    const dayColumn: RecordListColumnDef<AgendaRow> = {
      id: DAY_COLUMN_ID,
      header: DAY_COLUMN_LABEL,
      enableSorting: false,
      // The day is the grouping itself, so hiding it would leave every row without the day it belongs to.
      enableHiding: false,
      cell: (context) => dayCellNode(layout.dayCells.get(context.row.original.taskId)),
    };
    const listColumns: RecordListColumnDef<AgendaRow>[] = [dayColumn];
    for (const column of taskListColumns({ partnerLabels })) {
      // The day column states the date for every row of its group, so the lists' due-date column is not
      // repeated beside it; every other column is the lists' own, unaltered apart from its ordering control.
      if (column.id === DUE_DATE_COLUMN_ID) continue;
      listColumns.push(withoutSorting(column));
    }
    return listColumns;
  }, [layout, partnerLabels]);
  // The empty agenda is the envelope's own `zero`, stated by the read rather than counted here: a context whose
  // open work carries no date has nothing to group, which is not a failure and not a table of no rows.
  if ((envelope.valueStates[TOTAL_FIELD] ?? "value") === "zero") {
    return <StateNotice kind="empty" headingLevel={2} title={EMPTY_COPY.title} description={EMPTY_COPY.body} action={{ label: EMPTY_COPY.action, href: WORK_HREF }} />;
  }
  const queryState: RecordListQueryState = { sort: NO_SORT, page: data.page, pageSize: data.pageSize, columnVisibility };
  const hasPlannedTime = layout.rows.some((row) => row.plannedTime !== null);
  return (
    <>
      <RecordList
        label={REGION_LABEL}
        columns={columns}
        rows={layout.rows}
        // The read's `total` is the whole result, not this page of it, so the pager states the size of the agenda.
        rowCount={data.total}
        getRowId={(row) => row.taskId}
        rowLabel={(row) => row.title}
        queryState={queryState}
        onQueryStateChange={onQueryStateChange}
        rowActions={(row) => <TaskActions taskId={row.taskId} title={row.title} status={row.status} revision={row.revision} scope={scope} actions={row.actions} presentation="row" onEdit={onEdit} onCheckResult={onCheckResult} headingLevel={3} />}
        itemNoun={TASK_NOUN}
      />
      {hasPlannedTime ? <p className={QUIET_CLASS}>{PLANNED_VERSUS_HELD_NOTE}</p> : null}
      <p className={QUIET_CLASS}>{EDIT_NOTE}</p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

interface AgendaProps {
  /** The authority this agenda was read under. Handed on unchanged: no control here derives a scope of its own. */
  readonly scope: Scope;
  /** The agenda the route read for this session's context: the first paint, and the state each re-read replaces. */
  readonly envelope: AgendaEnvelope;
  /** The partner labels the roster read admitted, so a linked partner is named rather than only referenced. */
  readonly partnerLabels: Readonly<Record<string, string>>;
  readonly className?: string;
}

/**
 * One agenda for one context: the read the route already made, the window a worker widens or pages into, and the
 * read's own refusals stated in their own words.
 *
 * The paging window belongs to this surface because paging is part of reading one agenda; the route composition
 * hands it the authority it resolved and the answer it already read, and keeps no state of its own.
 */
export default function Agenda({ scope, envelope, partnerLabels, className }: AgendaProps): ReactElement {
  const router = useRouter();
  const [window, setWindow] = useState<PageWindow>({ page: envelope.data.page, pageSize: envelope.data.pageSize });
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(DEFAULT_COLUMN_VISIBILITY);
  const query = useMemo<AgendaQuery>(() => ({ displayTimeZone: envelope.data.displayTimeZone, page: window.page, pageSize: window.pageSize }), [envelope.data.displayTimeZone, window.page, window.pageSize]);
  const read = useAgenda(scope, query);
  // The answer the route already read describes the query it was read for, and the envelope names that query.
  // Handing it to a different window would paint one page's days under another page's heading, so an answer that
  // does not name this window is dropped and the read is made again instead.
  const seed = sameWindow(envelope, query) ? envelope : undefined;
  const reading: AgendaResult | undefined = read.data ?? (seed === undefined ? undefined : { kind: "envelope", envelope: seed });
  // TanStack Query's own re-read of this same query, which is what an attempt with no acknowledgement is checked
  // against: the surface asks the read again rather than guessing what the attempt did.
  const readAgain = read.refetch;
  const refresh = useCallback((): void => {
    void readAgain();
  }, [readAgain]);
  // The composer that changes a task is mounted by the lists, so an edit opens that surface rather than keeping
  // a second form here. Nothing on this page is dragged onto a day, so no action needs a drag gesture.
  const openEdit = useCallback((): void => {
    router.push(WORK_HREF);
  }, [router]);
  const handleQueryStateChange = useCallback((next: RecordListQueryState): void => {
    // The column set is this surface's own display choice and stays local; the page window is a query member, so
    // it becomes the read this surface asks for next.
    setColumnVisibility(next.columnVisibility);
    setWindow((current) => (next.page === current.page && next.pageSize === current.pageSize ? current : { page: next.page, pageSize: next.pageSize }));
  }, []);
  /** The agenda on screen: the list, the state it holds instead of one, or the refusal the read answered with. */
  function content(): ReactNode {
    if (reading === undefined) {
      // No result stands for this window yet. A busy read never looks like an empty agenda, and a request that
      // did not answer never looks like one either.
      if (read.isError) {
        return <StateNotice kind="unavailable" headingLevel={2} title={FAILED_COPY.title} description={FAILED_COPY.body} retry={{ label: RETRY_LABEL, onClick: refresh }} />;
      }
      return <StateNotice kind="loading" headingLevel={2} title={LOADING_TITLE} loadingLines={LOADING_LINES} />;
    }
    switch (reading.kind) {
      case "envelope":
        return <AgendaBody scope={scope} envelope={reading.envelope} partnerLabels={partnerLabels} columnVisibility={columnVisibility} onQueryStateChange={handleQueryStateChange} onEdit={openEdit} onCheckResult={refresh} />;
      case "denied":
        // A refusal states its closed reason and nothing else: no day, no row, no count and no hint of what the
        // agenda would have held, because a denial is not an empty agenda.
        return <StateNotice kind="denied" headingLevel={2} title={DENIED_COPY.title} description={DENIED_COPY.body} reasonCode={reading.denied.reasonCode} />;
      case "unavailable":
        return <StateNotice kind="unavailable" headingLevel={2} title={UNAVAILABLE_TITLE} description={reading.unavailable.guidance} source={reading.unavailable.source} retry={{ label: RETRY_LABEL, onClick: refresh }} />;
      case "refused":
        // The query this surface states is the read's own admitted one, so a refusal is defensive: it is answered
        // in this surface's words rather than thrown, and it says the request was refused, not that the source failed.
        return <StateNotice kind="refused" headingLevel={2} title={REFUSED_COPY.title} description={REFUSED_COPY.body} />;
    }
  }
  const surfaceClass = className === undefined || className.trim() === "" ? SURFACE_CLASS : `${SURFACE_CLASS}${CLASS_SEPARATOR}${className}`;
  return (
    <div data-slot="work-agenda" data-page={String(window.page)} data-page-size={String(window.pageSize)} className={surfaceClass}>
      {content()}
    </div>
  );
}
