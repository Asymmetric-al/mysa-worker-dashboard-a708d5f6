/**
 * The three reads behind the Work job: the five task lists, the dated agenda, and one recurring
 * series with the single occurrence it admits.
 *
 * `listTasks` answers Today, Upcoming, Overdue, All and Undated — the five lists and no sixth — over
 * the whole authorised collection, then sorts and pages here so the surface totals nothing.
 * `readAgenda` groups the same dated work by civil date in the worker's display time zone.
 * `readSeries` reports one series' closed rule, its next three dates as previews, the one occurrence
 * that can be acted on, and whether its plan needs review instead of growing an overdue stack.
 *
 * Four facts this module keeps apart, because the Work job loses its meaning when they merge:
 *
 * - Completing a task proves nothing about contact, payment or fulfilment, and a planned meeting is
 *   not a held one. `plannedTime` travels with the zone it is disclosed in and never becomes an
 *   instant, an interaction or a coaching measure.
 * - A task's `category` is the worker's own short label, not a controlled taxonomy: it never decides
 *   which list a task belongs to, and a categorised task is admitted everywhere an uncategorised one
 *   is.
 * - A preview date is a date the rule would produce, not an occurrence. At most one occurrence is
 *   actionable, and a paused or stopped series presents nothing further as actionable.
 * - A skipped occurrence did not perform the task, and a stop explains the fate of the work it leaves
 *   behind rather than completing it.
 *
 * Every date judgement here belongs to `@/modules/time`: "today" is `todayInZone` evaluated against
 * the instant `now()` supplies, next dates come from `nextOccurrences`, a day past the end of its
 * month is resolved by `monthlyOnDay` and disclosed through the module's own resolution facts, and
 * whether a plan needs review is `missedPlan`'s answer over the dates the plan actually produced.
 * Nothing here walks a calendar, adds a month, compares a midnight or decides a threshold, so these
 * reads cannot drift from the mutations that keep the same series.
 *
 * Scope is never an argument. Each read resolves the development session, asserts the selected scope
 * through `../authorize`, and only then enumerates, so a refused read carries no count, title,
 * existence flag or size. An absent store, an undecodable document and an unresolvable time zone are
 * `unavailable` naming the source that failed — never an empty list and never a zero. A browser
 * request naming a zone this runtime cannot resolve never reaches that branch: the transport refuses
 * the request by field first, so an outage here is what an in-process caller sees.
 *
 * Plan items: AAP 0.6.1 "Reads: tasks and series", 0.7.1 "Plan and finish work" and "Keep a series
 * useful", 0.8.2 (work, interactions and recurrence), 0.8.7 (fixed values and boundary semantics),
 * and criterion 13. Layering: `src/app` → `src/features` → `src/components` →
 * `src/modules/data-service` → `src/modules/store`; this file reads the store through its one read
 * function and imports no component, feature, application route or provider package.
 */
import { z } from "zod";

import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { readSession } from "@/modules/store/repository";
import { now } from "@/modules/time/clock";
import {
  parseCivilDate,
  serialiseCivilDate,
  todayInZone,
  type CivilDate,
} from "@/modules/time/civil";
import {
  missedPlan,
  nextOccurrences,
  type DisclosedMonthDayResolution,
  type PlanResolutions,
  type RepeatProfile,
  type SeriesEnd,
  type SeriesOccurrence,
  type SeriesRule,
  type SeriesState,
} from "@/modules/time/recurrence";

import { assertScope, canEdit, canView, resolveSession, type ResolvedSession } from "../authorize";
import {
  buildEnvelope,
  project,
  taskRecordSchema,
  taskSeriesRecordSchema,
  type Coverage,
  type ReadAction,
  type ReadEnvelope,
  type Scope,
  type SeriesEndRecord,
  type SeriesRuleRecord,
  type SeriesRuleRevisionRecord,
  type TaskKind,
  type TaskRecord,
  type TaskRecordStatus,
  type TaskSeriesRecord,
} from "../envelope";
import {
  LOCAL_STORE_SYSTEM,
  denied,
  unavailable,
  type DenialReason,
  type DeniedOutcome,
  type ReadResult,
} from "../outcome";

// ---------------------------------------------------------------------------------------------
// The five lists, the sort vocabulary and the paging contract
// ---------------------------------------------------------------------------------------------

/**
 * The five lists the Work surface offers: what is due today, what is coming up, what has gone past
 * its date, everything, and the work that carries no date at all.
 *
 * The names are the list keys the Work family's copy module already uses, so a surface and a read
 * cannot disagree about which list is which. Undated work is a list of its own and is never swept
 * into the past-due one, because a task with no date is late for nothing.
 */
export type TaskListName = "today" | "upcoming" | "overdue" | "all" | "undated";

/** The fields a list may be sorted by, in the closed set {@link TaskSort} names. */
export type TaskSortField = "dueOn" | "title" | "category" | "status";

/**
 * One ordering instruction, applied in the order the caller lists them.
 *
 * A patch of individual columns is not a sort: the list is ordered by the first instruction, then by
 * the second, and finally by the task's own identifier, so the order is total and a page boundary
 * cannot shuffle two otherwise equal rows.
 */
export interface TaskSort {
  readonly field: TaskSortField;
  readonly direction: "asc" | "desc";
}

/** The closed sort-field set as a runtime value, so an untyped caller cannot invent a field. */
const TASK_SORT_FIELDS = [
  "dueOn",
  "title",
  "category",
  "status",
] as const satisfies readonly TaskSortField[];

/**
 * The order a list falls back to: due date first, then title, then the identifier tiebreak.
 *
 * `listTasks` states the same order the specification fixes, so a surface that sends no ordering gets
 * the agreed one rather than the order the store happened to answer in.
 */
const DEFAULT_TASK_SORT: readonly TaskSort[] = [
  { field: "dueOn", direction: "asc" },
  { field: "title", direction: "asc" },
];

/** The rows a list page holds unless the caller asks for a different size. */
const PAGE_SIZE_DEFAULT = 50;

/**
 * The most rows a list page may hold. A caller asking for more is clamped here rather than refused,
 * so a page size never decides whether a request succeeds.
 */
const PAGE_SIZE_CAP = 200;

/** How many next dates a series preview shows: the three the series editor and the specification fix. */
const PREVIEW_DATE_COUNT = 3;

/**
 * A read has no attempt identity: nothing was asked to change, so nothing can be replayed.
 *
 * The value states that instead of inventing an identifier, matching the marker the authorisation
 * layer puts on its own refusals, so the only field that differs between two refusals is the reason.
 */
const READ_ATTEMPT_ID = "read";

/** The source system that owns the time-zone database a civil day is resolved against. */
const TIME_ZONE_SYSTEM = "time-zone-database";

/**
 * The source a civil day is resolved against, named once and opaquely.
 *
 * A source reference is an opaque handle: it is never parsed for meaning, never compared across
 * systems and never rendered as if its form carried meaning. The zone a request named is request
 * input, not a source identity, so echoing it here would present the caller's own text as the name of
 * a system — and would differ between two callers reading the same source. `reference` therefore says
 * which of that source's jobs failed, and the request's own value stays in the request.
 */
const CALENDAR_SOURCE: SourceReference = { system: TIME_ZONE_SYSTEM, reference: "calendar" };

/** The store's reference for the work family: the two collections every read here consults. */
const WORK_REFERENCE = "work";

const STORE_UNREADABLE_GUIDANCE =
  "The local development store did not answer for this session's work, so nothing is shown in place of it. Retry the read, and reset the development data if it keeps failing.";

const DOCUMENT_UNREADABLE_GUIDANCE =
  "This session's stored work could not be decoded, so nothing is shown in place of it. Reset the development data to restore the known seed.";

const CALENDAR_UNREADABLE_GUIDANCE =
  "A date in this view cannot be evaluated, because the named time zone is not one this runtime resolves. No date is judged in an assumed zone, so choose a display time zone in Settings and read the view again.";

/**
 * The instant type the scenario clock returns.
 *
 * Derived rather than imported so this module never names a second clock: the boundary functions take
 * whatever `now()` produces, and only `@/modules/time/clock` decides what that is.
 */
type ScenarioInstant = ReturnType<typeof now>;

// ---------------------------------------------------------------------------------------------
// Opening a read: session, scope, instant
// ---------------------------------------------------------------------------------------------

/** A read's authority, resolved and admitted, with the one instant the whole read is evaluated at. */
interface ReadyRead {
  readonly status: "ready";
  readonly session: ResolvedSession;
  readonly scope: Scope;
  readonly instant: ScenarioInstant;
}

/** Either the admitted authority or the refusal to return as it stands. */
type ReadOpening = ReadyRead | { readonly status: "refused"; readonly result: ReadResult<never> };

/**
 * Builds the one refusal shape a read may return.
 *
 * Every code comes from the closed denial set and describes the caller's relationship to the request,
 * never a record: a refusal that differed between "not found" and "not permitted" would let a caller
 * enumerate what it cannot read.
 */
function readDenial(reasonCode: DenialReason): DeniedOutcome {
  return denied({ operationId: READ_ATTEMPT_ID, reasonCode });
}

/** Wraps a refusal as the failing half of a {@link ReadOpening}. */
function refused(result: ReadResult<never>): ReadOpening {
  return { status: "refused", result };
}

/**
 * Resolves the session a read acts for and admits its selected scope, or refuses it.
 *
 * Four steps and no more: resolve the development session, take the context it has selected, assert
 * that context against the memberships the session states, and read the scenario instant once so the
 * envelope's `asOf` and every boundary in the read agree. A session that has selected no context has
 * no scope to read in, which is a refusal rather than a guess at its first admitted membership.
 */
async function openRead(): Promise<ReadOpening> {
  const resolution = await resolveSession();
  if (!resolution.ok) {
    return refused({ kind: "denied", denied: resolution.denial });
  }

  const { session } = resolution;
  const scope = session.selected;
  if (scope === null) {
    return refused({ kind: "denied", denied: readDenial("no-membership") });
  }

  const admitted = assertScope(session, scope);
  if (!admitted.ok) {
    return refused({ kind: "denied", denied: admitted.denial });
  }

  return { status: "ready", session, scope, instant: now() };
}

// ---------------------------------------------------------------------------------------------
// Reading the stored work
// ---------------------------------------------------------------------------------------------

/**
 * The two record families a session's state document holds for this job.
 *
 * Only the members this job reads are named: every other family in the document is ignored rather
 * than refused, so a field added elsewhere cannot deny a Work read. The record shapes and their
 * schemas are `../envelope`'s — the one declaration of them — and this file derives nothing from
 * them beyond reading a stored document back.
 */
const storedTasksSchema = z.object({
  tasks: z.array(taskRecordSchema),
});

const storedWorkSchema = z.object({
  tasks: z.array(taskRecordSchema),
  series: z.array(taskSeriesRecordSchema),
});

/** Either the decoded store document or the outage to return as it stands. */
type DecodedRead<T> =
  | { readonly status: "decoded"; readonly value: T }
  | { readonly status: "unavailable"; readonly result: ReadResult<never> };

/**
 * Reads one session's state document and decodes the families a read needs.
 *
 * An absent session, an unreadable file and an undecodable document are three different faults and
 * one honest answer: the source is unavailable. None of them becomes an empty list or a zero, and
 * none falls back to a fixture, because a read that invented work would be worse than a read that
 * says its source is down.
 */
async function readWork<T>(options: {
  readonly session: ResolvedSession;
  readonly job: string;
  readonly schema: z.ZodType<T>;
}): Promise<DecodedRead<T>> {
  const source: SourceReference = { system: LOCAL_STORE_SYSTEM, reference: WORK_REFERENCE };

  let state: unknown;
  try {
    const documents = await readSession(options.session.sessionId);
    if (documents === undefined) {
      return {
        status: "unavailable",
        result: unavailableRead(options.job, source, STORE_UNREADABLE_GUIDANCE),
      };
    }
    state = documents.state;
  } catch {
    return {
      status: "unavailable",
      result: unavailableRead(options.job, source, STORE_UNREADABLE_GUIDANCE),
    };
  }

  const decoded = options.schema.safeParse(state);
  if (!decoded.success) {
    return {
      status: "unavailable",
      result: unavailableRead(options.job, source, DOCUMENT_UNREADABLE_GUIDANCE),
    };
  }
  return { status: "decoded", value: decoded.data };
}

/**
 * Builds the one unavailable read: the source identity, retry guidance and a diagnostic line that
 * names the job and the source and nothing the read failed to return.
 */
function unavailableRead(
  job: string,
  source: SourceReference,
  guidance: string,
): ReadResult<never> {
  logger.sourceUnavailable({
    job,
    source: { system: source.system, reference: source.reference },
  });
  return {
    kind: "unavailable",
    unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance }),
  };
}

/** Either "today" in a named zone or the outage that kept it from being resolved. */
type ResolvedToday =
  | { readonly status: "resolved"; readonly date: CivilDate; readonly text: string }
  | { readonly status: "unavailable"; readonly result: ReadResult<never> };

/**
 * Reads "today" in the zone the caller states, from the instant the read opened at.
 *
 * The instant is handed in rather than read again, so a read evaluates every boundary at one instant.
 * A zone the runtime cannot resolve is an unavailable calendar rather than a fallback to UTC: a due
 * date judged against an assumed zone would put work in a list the worker never asked for.
 *
 * The browser transport refuses such a request at its own boundary, by field, before this read runs,
 * so this is the answer an untyped in-process caller reaches: a read has no `invalid` result to give,
 * and `unavailable` is the only honest one left when it cannot judge a day at all.
 */
function todayForRead(job: string, timeZone: string, instant: ScenarioInstant): ResolvedToday {
  const resolved = todayInZone(timeZone, instant);
  if (resolved.status === "resolved") {
    return {
      status: "resolved",
      date: resolved.date,
      text: serialiseCivilDate(resolved.date),
    };
  }
  return {
    status: "unavailable",
    result: unavailableRead(job, CALENDAR_SOURCE, CALENDAR_UNREADABLE_GUIDANCE),
  };
}

// ---------------------------------------------------------------------------------------------
// Ordering, paging and the collection revision
// ---------------------------------------------------------------------------------------------

/**
 * Compares two strings by code unit.
 *
 * Deliberately not `localeCompare`: a list's order must be identical on the server and in the browser
 * and identical between two machines, and a locale-aware comparison varies with the platform's
 * collation data. Display text is the surface's job; a stable order is this module's.
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/**
 * Compares one optional text field, placing the absent value after every present one.
 *
 * A due date and a category are both optional, and "no date" is not the earliest date: undated work
 * sorts to the end of an ascending list so a worker reads dated commitments first.
 */
function compareOptionalText(left: string | null, right: string | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return compareCodeUnits(left, right);
}

/** Compares two tasks by one field, without applying a direction. */
function compareTaskField(left: TaskRecord, right: TaskRecord, field: TaskSortField): number {
  switch (field) {
    case "dueOn":
      return compareOptionalText(left.dueOn, right.dueOn);
    case "title":
      return compareCodeUnits(left.title, right.title);
    case "category":
      return compareOptionalText(left.category, right.category);
    case "status":
      return compareCodeUnits(left.status, right.status);
  }
}

/**
 * Orders tasks by the caller's instructions, then by identifier so the order is total.
 *
 * A descending instruction reverses that field's whole comparison, absent values included, which is
 * the one rule a reader has to know: descending by due date reads the latest dates first and the
 * undated work after them in ascending order. Every tie is broken by the task's own identifier, so no
 * two rows can swap places between two reads of the same data.
 */
function orderTasks(left: TaskRecord, right: TaskRecord, sort: readonly TaskSort[]): number {
  for (const instruction of sort) {
    const order = compareTaskField(left, right, instruction.field);
    if (order !== 0) {
      return instruction.direction === "desc" ? -order : order;
    }
  }
  return compareCodeUnits(left.taskId, right.taskId);
}

/**
 * Normalises the ordering a caller asked for.
 *
 * A field outside the closed set or a direction that is not `asc`/`desc` is dropped rather than
 * trusted, and an instruction list that ends up empty falls back to the agreed order. The type
 * already forbids both, and the browser transport refuses such an ordering by field before this read
 * runs, so the tolerance here covers only an untyped in-process call — and it keeps that call from
 * putting a list in an order nothing else can reproduce.
 */
function normaliseSort(sort: readonly TaskSort[] | undefined): readonly TaskSort[] {
  if (sort === undefined || sort.length === 0) {
    return DEFAULT_TASK_SORT;
  }
  const accepted = sort.filter(
    (instruction) =>
      (TASK_SORT_FIELDS as readonly string[]).includes(instruction.field) &&
      (instruction.direction === "asc" || instruction.direction === "desc"),
  );
  return accepted.length === 0 ? DEFAULT_TASK_SORT : accepted;
}

/** The page size a caller asked for, kept inside the 1-{@link PAGE_SIZE_CAP} contract. */
function clampPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return PAGE_SIZE_DEFAULT;
  }
  const whole = Math.trunc(requested);
  return whole < 1 ? 1 : Math.min(whole, PAGE_SIZE_CAP);
}

/** Where one page of a whole result starts and ends, with the whole result's count beside it. */
interface PageWindow {
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly start: number;
  readonly end: number;
}

/**
 * Works out the page window for a whole-result count.
 *
 * `total` stays the whole result's count — a read never reports a page's length as its total — and the
 * requested page is clamped to the pages that exist, so a filter that shrinks the result cannot leave
 * a surface on a page of nothing. A result with no rows has no pages, which is `pageCount: 0`, and
 * that is a different fact from a page that happens to be empty.
 */
function pageWindow(
  total: number,
  requestedPage: number | undefined,
  requestedPageSize: number | undefined,
): PageWindow {
  const pageSize = clampPageSize(requestedPageSize);
  const pageCount = Math.ceil(total / pageSize);
  const highest = Math.max(1, pageCount);
  const asked =
    requestedPage === undefined || !Number.isFinite(requestedPage) ? 1 : Math.trunc(requestedPage);
  const page = Math.min(Math.max(1, asked), highest);
  const start = (page - 1) * pageSize;
  return { page, pageSize, pageCount, start, end: start + pageSize };
}

/** A 32-bit FNV-1a digest of a canonical string, in eight lowercase hex digits. */
function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The revision a collection read reports: its family, its size and a digest of its members' revisions.
 *
 * A collection has no single stored revision, so the envelope reports a witness of the whole
 * collection instead of the newest member's revision presented as if it spoke for every row. Any
 * change that rewrites a member's revision or adds or removes a member moves the digest, and each row
 * carries its own revision, which is what a change to that row presents as `expectedRevision`.
 */
function collectionRevision(
  family: string,
  members: readonly { readonly revision: string }[],
): string {
  const revisions = members.map((member) => member.revision).toSorted(compareCodeUnits);
  return `${family}/${String(members.length)}/${digest(revisions.join("\u0000"))}`;
}

/** The coverage a list read states: the whole authorised collection, with no period boundary. */
const WHOLE_COLLECTION_COVERAGE: Coverage = { from: null, to: null, state: "complete" };

/**
 * Reports whether a task still expects an action.
 *
 * `open` and `reopened` are the two states that belong in a list of work to do; a completed task is
 * done and a cancelled one is not owed, and neither is late for anything.
 */
function isAwaitingAction(status: TaskRecordStatus): boolean {
  return status === "open" || status === "reopened";
}

/**
 * Builds the advisory action entry for one named mutation.
 *
 * The reason is present only when the action is unavailable, and it states why the caller may not do
 * this — never anything about a record the caller may not read.
 */
function action(
  name: string,
  available: boolean,
  reason = "This action is not available from this view.",
): ReadAction {
  return available ? { name, available } : { name, available, reason };
}

/** Reports whether a count is a genuine zero or a value, the two states a known number can hold. */
function countState(count: number): "value" | "zero" {
  return count === 0 ? "zero" : "value";
}

/** The five list names as a runtime value, so an untyped caller cannot invent a sixth. */
const TASK_LIST_NAMES = [
  "today",
  "upcoming",
  "overdue",
  "all",
  "undated",
] as const satisfies readonly TaskListName[];

/**
 * The list a caller asked for, or `all` when the name is not one of the five.
 *
 * A name outside the set is answered with the complete list rather than with nothing, and no read
 * invents a sixth list to answer it with. The browser transport refuses such a name at its own
 * boundary — a request naming a list this build does not have is `invalid` on `list`, so a surface is
 * never shown more rows than it asked for — which leaves this fallback to an untyped in-process call
 * that cannot be refused by field.
 */
function normaliseListName(list: TaskListName): TaskListName {
  return (TASK_LIST_NAMES as readonly string[]).includes(list) ? list : "all";
}

// ---------------------------------------------------------------------------------------------
// One task as a list row
// ---------------------------------------------------------------------------------------------

/**
 * Where a task's due date stands relative to "today" in the display zone the read was evaluated in.
 *
 * The four members keep apart what a list must never merge: work due today, work that still lies
 * ahead, work whose date has gone past, and work that carries no date at all. A date is never
 * invented for the last one.
 */
export type TaskDateRelation = "today" | "future" | "past" | "undated";

/**
 * One task as a list, an agenda or a series reports it.
 *
 * Every field is a fact the stored task states, except the three the read derives: the date relation,
 * the advisory actions and the selection eligibility. `revision` travels with the row because a change
 * to this task presents it as its `expectedRevision` — the collection's own revision is a witness of
 * the whole list, never a substitute for the row it belongs to.
 *
 * `plannedTime` is a wall-clock reading in the `timeZone` stated beside it and is present only on a
 * meeting task. It is a plan, not a record: nothing here counts it as a meeting held.
 */
export interface TaskListRow {
  readonly taskId: string;
  readonly revision: string;
  readonly title: string;
  readonly category: string | null;
  readonly dueOn: string | null;
  readonly dateRelation: TaskDateRelation;
  readonly plannedTime: string | null;
  readonly timeZone: string | null;
  readonly kind: TaskKind;
  readonly status: TaskRecordStatus;
  readonly partnerId: string | null;
  readonly initiativeId: string | null;
  readonly seriesId: string | null;
  readonly note: string | null;
  /** The mutations currently available on this row, with a reason for each that is not. */
  readonly actions: readonly ReadAction[];
  /** Whether this row may be selected for a bulk action; false with a reason when it may not. */
  readonly selectable: boolean;
  readonly selectionReason?: string;
}

/** The stored fields a row carries unchanged, named once so the projection cannot drift. */
const TASK_ROW_FIELDS = [
  "taskId",
  "revision",
  "title",
  "category",
  "dueOn",
  "plannedTime",
  "timeZone",
  "kind",
  "status",
  "partnerId",
  "initiativeId",
  "seriesId",
  "note",
] as const;

/**
 * The reason a row the reader may see cannot be changed, in the words the reader needs.
 *
 * Admission lets a colleague see the ministry's work; it never implies changing another principal's
 * task, because this release has no delegation that would make it so.
 */
const OWNERSHIP_REASON =
  "This task belongs to another principal's work, so your session may read it but not change it.";

/**
 * Reads a stored civil date's relation to today.
 *
 * Both values are the stored `YYYY-MM-DD` form, whose fixed width makes lexical order and calendar
 * order the same order — so this compares two strings rather than opening a second date engine beside
 * `@/modules/time`. Equality is the same day; anything else is before or after it.
 */
function dateRelationOf(dueOn: string | null, today: string): TaskDateRelation {
  if (dueOn === null) {
    return "undated";
  }
  if (dueOn === today) {
    return "today";
  }
  return dueOn < today ? "past" : "future";
}

/**
 * Builds one row from a stored task the caller is already authorised to read.
 *
 * The record's own fields come through `project`, which is the envelope's narrowing helper: a field
 * the caller may not read is absent from the row rather than hidden by a component. The derived
 * members are advisory only — the mutation re-derives scope, permission and revision on submit, so a
 * stale row can produce a `denied` or `conflict` outcome but never an unauthorised write.
 */
function taskRow(options: {
  readonly task: TaskRecord;
  readonly session: ResolvedSession;
  readonly scope: Scope;
  readonly today: string;
}): TaskListRow {
  const { task, session, scope, today } = options;
  const mayEdit = canEdit(session, {
    kind: "task",
    scope,
    ownerPrincipalId: task.ownerPrincipalId,
  }).allowed;
  const awaiting = isAwaitingAction(task.status);

  const fields = project(task, TASK_ROW_FIELDS);
  const row: TaskListRow = {
    ...fields,
    dateRelation: dateRelationOf(task.dueOn, today),
    actions: [
      action("editTask", mayEdit, OWNERSHIP_REASON),
      action(
        "completeTask",
        mayEdit && awaiting,
        mayEdit
          ? task.status === "cancelled"
            ? "This task is cancelled, so completing it is not available; create a new task for the work instead."
            : "This task is already completed, so it is reopened before it can be completed again."
          : OWNERSHIP_REASON,
      ),
      action(
        "reopenTask",
        mayEdit && task.status === "completed",
        mayEdit ? "Only a completed task can be reopened." : OWNERSHIP_REASON,
      ),
      action(
        "cancelTask",
        mayEdit && awaiting,
        mayEdit ? "Only open work can be cancelled." : OWNERSHIP_REASON,
      ),
    ],
    selectable: mayEdit,
    ...(mayEdit ? {} : { selectionReason: OWNERSHIP_REASON }),
  };
  return row;
}

// ---------------------------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------------------------

/** What a caller asks a task list for. */
export interface TaskListQuery {
  /** Which of the five lists to read. Undated work is a list, never a gap in another. */
  readonly list: TaskListName;
  /**
   * The worker's display time zone, as the shell resolved it.
   *
   * Required rather than defaulted: "today" is a civil day in a stated zone, and a due date judged
   * against an assumed zone would put work in the wrong list.
   */
  readonly displayTimeZone: string;
  /** The 1-based page to read; clamped to the pages that exist. 1 when absent. */
  readonly page?: number;
  /** Rows per page: {@link PAGE_SIZE_DEFAULT} when absent, clamped to {@link PAGE_SIZE_CAP}. */
  readonly pageSize?: number;
  /** The ordering to apply, most significant first; the agreed due-date-then-title order when absent. */
  readonly sort?: readonly TaskSort[];
}

/** What one page of a task list holds. */
export interface TaskListData {
  readonly list: TaskListName;
  readonly displayTimeZone: string;
  /** "Today" as the read resolved it in the display zone, in the stored `YYYY-MM-DD` form. */
  readonly today: string;
  /** The page of rows, already filtered, ordered and sliced. */
  readonly tasks: readonly TaskListRow[];
  /** The whole result's row count — never the page's length. */
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

/**
 * Reports whether one task belongs in one of the five lists.
 *
 * `all` holds every task in every status, so a completed or cancelled task is never orphaned from the
 * surface that can reopen it. The other four are the outstanding work in its relation to today:
 * a completed task is not late for anything, a cancelled one is not owed, and a task with no date
 * belongs to Undated rather than to Overdue. The category plays no part in the decision, because it is
 * the worker's own label rather than a taxonomy the product filters by.
 */
function inList(task: TaskRecord, list: TaskListName, today: string): boolean {
  if (list === "all") {
    return true;
  }
  if (!isAwaitingAction(task.status)) {
    return false;
  }
  if (task.dueOn === null) {
    return list === "undated";
  }
  switch (list) {
    case "today":
      return task.dueOn === today;
    case "upcoming":
      return task.dueOn > today;
    case "overdue":
      return task.dueOn < today;
    case "undated":
      return false;
  }
}

/**
 * The actions a list offers as a whole, for the page it was read for.
 *
 * The three bulk actions act only on rows the worker selected explicitly, so their availability
 * depends on the selection a surface has not made yet; the read states them as available when the page
 * holds at least one row the caller may change, and says why when it holds none. No aggregate outcome
 * is implied: each selected row answers for itself.
 */
function listActions(selectableOnPage: boolean): readonly ReadAction[] {
  const bulkReason =
    "No row on this page can be changed from your session, so there is nothing to act on. Clear the filters or open a page holding your own work.";
  return [
    action("createTask", true),
    action("bulkApplyTag", selectableOnPage, bulkReason),
    action("bulkRemoveTag", selectableOnPage, bulkReason),
    action("bulkCreateTasks", selectableOnPage, bulkReason),
    action("bulkCompleteTasks", selectableOnPage, bulkReason),
  ];
}

/**
 * Reads one of the five task lists for the session's selected context.
 *
 * Filtering, ordering, paging and counting all happen here over the whole authorised collection, so a
 * surface renders what it was given: `total` is the whole result's count and the page is a slice of
 * it, which is what keeps a filtered page from ever being presented as the complete result.
 */
export async function listTasks(
  query: TaskListQuery,
): Promise<ReadResult<ReadEnvelope<TaskListData>>> {
  const opening = await openRead();
  if (opening.status === "refused") {
    return opening.result;
  }

  const today = todayForRead("listTasks", query.displayTimeZone, opening.instant);
  if (today.status === "unavailable") {
    return today.result;
  }

  const stored = await readWork({
    session: opening.session,
    job: "listTasks",
    schema: storedTasksSchema,
  });
  if (stored.status === "unavailable") {
    return stored.result;
  }

  const list = normaliseListName(query.list);
  const sort = normaliseSort(query.sort);
  const readable = stored.value.tasks.filter(
    (task) =>
      canView(opening.session, {
        kind: "task",
        scope: opening.scope,
        ownerPrincipalId: task.ownerPrincipalId,
      }).allowed,
  );
  const listed = readable
    .filter((task) => inList(task, list, today.text))
    .toSorted((left, right) => orderTasks(left, right, sort));

  const window = pageWindow(listed.length, query.page, query.pageSize);
  const rows = listed
    .slice(window.start, window.end)
    .map((task) =>
      taskRow({ task, session: opening.session, scope: opening.scope, today: today.text }),
    );

  const envelope = buildEnvelope<TaskListData>({
    data: {
      list,
      displayTimeZone: query.displayTimeZone,
      today: today.text,
      tasks: rows,
      total: listed.length,
      page: window.page,
      pageSize: window.pageSize,
      pageCount: window.pageCount,
    },
    scope: opening.scope,
    source: { system: LOCAL_STORE_SYSTEM, reference: WORK_REFERENCE },
    revision: collectionRevision("tasks", readable),
    asOf: opening.instant.toString(),
    coverage: WHOLE_COLLECTION_COVERAGE,
    valueStates: {
      total: countState(listed.length),
      pageCount: countState(window.pageCount),
      today: "value",
    },
    actions: listActions(rows.some((row) => row.selectable)),
  });

  return { kind: "envelope", envelope };
}

// ---------------------------------------------------------------------------------------------
// readAgenda
// ---------------------------------------------------------------------------------------------

/** What a caller asks the dated agenda for. */
export interface AgendaQuery {
  /** The worker's display time zone: the zone "today" is a civil day in. */
  readonly displayTimeZone: string;
  /** The 1-based page of items to read, not of days; clamped to the pages that exist. */
  readonly page?: number;
  /** Items per page: {@link PAGE_SIZE_DEFAULT} when absent, clamped to {@link PAGE_SIZE_CAP}. */
  readonly pageSize?: number;
}

/** One day of the agenda: its civil date, the label a surface may show, and the work dated that day. */
export interface AgendaDay {
  /** The day in the stored `YYYY-MM-DD` form; a stored date is never given a time of day. */
  readonly dueOn: string;
  /**
   * The same day in the unambiguous ISO form, ready to render verbatim.
   *
   * The read states no localised label: a month name depends on the reader's locale, which the
   * surface holds, and formatting here would make the server's render and the browser's disagree.
   */
  readonly label: string;
  readonly items: readonly TaskListRow[];
}

/** What one page of the dated agenda holds. */
export interface AgendaData {
  readonly displayTimeZone: string;
  /** "Today" as the read resolved it in the display zone, in the stored `YYYY-MM-DD` form. */
  readonly today: string;
  /** The page's items grouped by civil date, dates ascending, and no day with no items in it. */
  readonly days: readonly AgendaDay[];
  /** How many days this page of items falls across. A day holds at least one item by construction. */
  readonly dayCount: number;
  /** The whole result's item count — never the page's length. */
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

/**
 * Orders agenda items chronologically: by date, then by the wall-clock time each states, then title.
 *
 * Two planned times stated in different zones are compared by their wall-clock readings rather than by
 * a resolved instant: the read does not convert a reading into an instant, and each row discloses the
 * zone its time is stated in. A task with no planned time follows the timed work of its day.
 */
function orderAgendaItems(left: TaskRecord, right: TaskRecord): number {
  const byDate = compareOptionalText(left.dueOn, right.dueOn);
  if (byDate !== 0) {
    return byDate;
  }
  const byTime = compareOptionalText(left.plannedTime, right.plannedTime);
  if (byTime !== 0) {
    return byTime;
  }
  return compareCodeUnits(left.taskId, right.taskId);
}

/**
 * Groups one page of rows by civil date, in the order the rows arrived.
 *
 * A day appears only because an item is dated that day, so an empty day can never be rendered as a
 * zero: the grouping is built from the items rather than from a range of dates.
 */
function groupByDay(rows: readonly TaskListRow[]): readonly AgendaDay[] {
  const byDate = new Map<string, TaskListRow[]>();
  for (const row of rows) {
    if (row.dueOn === null) {
      continue;
    }
    const existing = byDate.get(row.dueOn);
    if (existing === undefined) {
      byDate.set(row.dueOn, [row]);
    } else {
      existing.push(row);
    }
  }
  return [...byDate.entries()].map(([dueOn, items]) => ({ dueOn, label: dueOn, items }));
}

/**
 * Reads the dated agenda for the session's selected context.
 *
 * Undated work is excluded here because it belongs to the Undated list rather than to a day: an agenda
 * bucket needs a date, and inventing one for undated work would answer a question the worker did not
 * ask. Paging applies to items, so a day that straddles a page boundary is not split into two records
 * of itself — the day appears once per page it has items on.
 */
export async function readAgenda(
  query: AgendaQuery,
): Promise<ReadResult<ReadEnvelope<AgendaData>>> {
  const opening = await openRead();
  if (opening.status === "refused") {
    return opening.result;
  }

  const today = todayForRead("readAgenda", query.displayTimeZone, opening.instant);
  if (today.status === "unavailable") {
    return today.result;
  }

  const stored = await readWork({
    session: opening.session,
    job: "readAgenda",
    schema: storedTasksSchema,
  });
  if (stored.status === "unavailable") {
    return stored.result;
  }

  const readable = stored.value.tasks.filter(
    (task) =>
      canView(opening.session, {
        kind: "task",
        scope: opening.scope,
        ownerPrincipalId: task.ownerPrincipalId,
      }).allowed,
  );
  const dated = readable
    .filter((task) => task.dueOn !== null && isAwaitingAction(task.status))
    .toSorted(orderAgendaItems);

  const window = pageWindow(dated.length, query.page, query.pageSize);
  const rows = dated
    .slice(window.start, window.end)
    .map((task) =>
      taskRow({ task, session: opening.session, scope: opening.scope, today: today.text }),
    );
  const days = groupByDay(rows);

  const envelope = buildEnvelope<AgendaData>({
    data: {
      displayTimeZone: query.displayTimeZone,
      today: today.text,
      days,
      dayCount: days.length,
      total: dated.length,
      page: window.page,
      pageSize: window.pageSize,
      pageCount: window.pageCount,
    },
    scope: opening.scope,
    source: { system: LOCAL_STORE_SYSTEM, reference: WORK_REFERENCE },
    revision: collectionRevision("tasks", readable),
    asOf: opening.instant.toString(),
    coverage: WHOLE_COLLECTION_COVERAGE,
    valueStates: {
      total: countState(dated.length),
      dayCount: countState(days.length),
      pageCount: countState(window.pageCount),
      today: "value",
    },
    actions: listActions(rows.some((row) => row.selectable)),
  });

  return { kind: "envelope", envelope };
}

// ---------------------------------------------------------------------------------------------
// readSeries
// ---------------------------------------------------------------------------------------------

/** What a caller asks one recurring series for. */
export interface SeriesReadQuery {
  /** The series to read, as an opaque identifier the store holds for this context. */
  readonly seriesId: string;
}

/**
 * One effective repeat rule as the read reports it.
 *
 * The five profiles are the closed set, `interval` is read only by the two "every N" profiles and
 * `dayOfMonth` only by the two monthly ones, and `firstDueOn` is the date the worker chose rather than
 * a date the rule recomputes. `end` states the end the series carries, including the qualified
 * ongoing-personal-series policy, which is a choice rather than a missing value.
 */
export interface SeriesRuleView {
  readonly profile: RepeatProfile;
  readonly interval: number;
  readonly dayOfMonth: number | null;
  readonly firstDueOn: string;
  readonly planningTimeZone: string;
  readonly end: SeriesEndRecord;
}

/**
 * One prospective rule revision: the rule in force from `effectiveFrom` onwards.
 *
 * A this-and-future edit appends a revision with an explicit boundary instead of rewriting the rule a
 * completed occurrence was measured against, so the boundary a surface shows is the date the plan
 * changed rather than the date it was edited.
 */
export interface SeriesRevisionView {
  readonly revisionId: string;
  readonly effectiveFrom: string;
  readonly rule: SeriesRuleView;
}

/**
 * One date whose day the rule had to resolve to the final day of its month.
 *
 * Both the day the rule asked for and the day it produced are stated, so a surface can disclose the
 * resolution beside the date it affects instead of moving a worker's date silently.
 */
export interface SeriesPreviewResolution {
  readonly dueOn: string;
  readonly requestedDay: number;
  readonly resolvedDay: number;
}

/**
 * What the rule would produce next, and why it produces nothing.
 *
 * Four different facts, kept apart: dates the rule produces as previews, an end the rule states, a
 * series that admits nothing because it is paused or stopped, and a plan that cannot be read at all.
 * None of them is an empty list, and none carries a placeholder date that a reader could mistake for
 * one the rule really produces.
 */
export type SeriesPreviewView =
  | {
      readonly status: "preview";
      /** The next dates, the next one first, each a preview rather than an occurrence. */
      readonly dates: readonly string[];
      readonly dateCount: number;
      readonly monthDayResolutions: readonly SeriesPreviewResolution[];
    }
  | { readonly status: "ended" }
  | { readonly status: "not-admitted"; readonly reason: "paused" | "stopped" }
  | { readonly status: "unreadable"; readonly reason: "invalid-rule" | "unbounded" };

/** One of the three resolutions a plan in review offers, named by the recurrence module's own union. */
export type MissedPlanResolution = PlanResolutions[number];

/**
 * How a series' plan stands at the instant it was read.
 *
 * `needs-review` carries the missed dates and exactly the three resolutions the recurrence module
 * offers — keep this occurrence, move the next date forward, or stop the series — instead of an
 * overdue stack. `not-admitting` states that a paused or stopped series admits nothing, so reviewing
 * its plan for missed dates would judge a plan that is deliberately not running.
 *
 * `recordedPlanNeedsReview` is the series record's own flag, reported beside the evaluation rather
 * than merged into it: the flag says what a command decided when it last looked, and the state says
 * what the dates show now. A surface can show both without this read choosing between them.
 */
export interface SeriesPlanReviewView {
  readonly state: "on-track" | "needs-review" | "not-admitting";
  readonly missedDates: readonly string[];
  readonly missedDateCount: number;
  readonly resolutions: readonly MissedPlanResolution[];
  readonly recordedPlanNeedsReview: boolean;
}

/** One recurring series, the single occurrence it admits, and what its rule produces next. */
export interface SeriesReading {
  readonly seriesId: string;
  readonly title: string;
  readonly state: SeriesState;
  /** Whether this series admits further occurrences: false while paused and never again once stopped. */
  readonly admitsFurtherOccurrences: boolean;
  readonly rule: SeriesRuleView;
  readonly effectiveRevisions: readonly SeriesRevisionView[];
  /** "Today" in the series' own planning zone, which is what its dates are judged against. */
  readonly today: string;
  /** The occurrence the record names, when this context still holds it. */
  readonly currentOccurrence: TaskListRow | null;
  /**
   * The one occurrence a worker may act on now, or `null`.
   *
   * Only an active series names one: a paused series holds its plan, and a stopped series presents
   * nothing further as actionable. Every other date in {@link SeriesPreviewView} is a preview.
   */
  readonly actionableOccurrenceId: string | null;
  readonly preview: SeriesPreviewView;
  readonly planReview: SeriesPlanReviewView;
  /**
   * The unfinished work a stop left behind, disclosed rather than completed.
   *
   * A stop closes the series; it never finishes, cancels or claims the dates it leaves. Empty for a
   * series that is not stopped.
   */
  readonly leftBehind: readonly TaskListRow[];
}

/** The stored fields a rule view carries, named once so the projection cannot drift. */
const SERIES_RULE_FIELDS = [
  "profile",
  "interval",
  "dayOfMonth",
  "firstDueOn",
  "planningTimeZone",
  "end",
] as const;

/** How many dates the plan walk reads after the series' latest occurrence. */
const PLAN_WALK_COUNT = 12;

/**
 * The reason a series the reader may see cannot be changed.
 *
 * The same distinction the task rows carry: admission lets a colleague read the ministry's repeated
 * work, and changing another principal's series is not implied by it.
 */
const SERIES_OWNERSHIP_REASON =
  "This repeating task belongs to another principal's work, so your session may read it but not change it.";

/** Reads one stored rule as the recurrence engine's working rule, or `undefined` when it cannot be. */
function toSeriesRule(record: SeriesRuleRecord): SeriesRule | undefined {
  const firstDueOn = parseCivilDate(record.firstDueOn);
  const end = toSeriesEnd(record.end);
  if (firstDueOn.status !== "parsed" || end === undefined) {
    return undefined;
  }
  const rule: SeriesRule = {
    profile: record.profile,
    interval: record.interval,
    firstDueOn: firstDueOn.date,
    planningTimeZone: record.planningTimeZone,
    end,
  };
  if (record.dayOfMonth !== null) {
    rule.dayOfMonth = record.dayOfMonth;
  }
  return rule;
}

/** Reads a stored series end as the engine's own end, or `undefined` when its date cannot be read. */
function toSeriesEnd(record: SeriesEndRecord): SeriesEnd | undefined {
  switch (record.kind) {
    case "ongoing-personal-policy":
      return { kind: "ongoing-personal-policy" };
    case "after-count":
      return { kind: "after-count", count: record.count };
    case "on-date": {
      const on = parseCivilDate(record.on);
      return on.status === "parsed" ? { kind: "on-date", on: on.date } : undefined;
    }
  }
}

/** Narrows a stored rule to the fields a surface reads, keeping its dates in the stored form. */
function ruleViewOf(rule: SeriesRuleRecord): SeriesRuleView {
  return project(rule, SERIES_RULE_FIELDS);
}

/**
 * Reads a series' stored revisions as views, or `undefined` when one of their rules cannot be read.
 *
 * A revision whose rule cannot be decoded makes the series' history unreadable, which is an outage
 * rather than a series presented with the revisions that happened to parse.
 */
function toSeriesRevisions(
  revisions: readonly SeriesRuleRevisionRecord[],
): readonly SeriesRevisionView[] | undefined {
  const views: SeriesRevisionView[] = [];
  for (const revision of revisions) {
    if (toSeriesRule(revision.rule) === undefined) {
      return undefined;
    }
    views.push({
      revisionId: revision.revisionId,
      effectiveFrom: revision.effectiveFrom,
      rule: ruleViewOf(revision.rule),
    });
  }
  return views;
}

/** Narrows one month-day resolution to the dates a surface states. */
function resolutionView(resolution: DisclosedMonthDayResolution): SeriesPreviewResolution {
  return {
    dueOn: serialiseCivilDate(resolution.dueOn),
    requestedDay: resolution.requestedDay,
    resolvedDay: resolution.resolvedDay,
  };
}

/**
 * Reads what the series' rule produces next, as previews.
 *
 * The dates come from the recurrence engine's own walk, three of them, evaluated from "today" in the
 * series' planning zone. A paused series still shows them because a pause holds the plan rather than
 * ending it; a stopped series shows none, because a stop admits nothing further and dates that cannot
 * arrive are not a plan. Any month-day resolution the walk had to make is carried beside the dates so
 * the date itself is never moved silently.
 */
function previewOf(options: {
  readonly series: TaskSeriesRecord;
  readonly rule: SeriesRule;
  readonly today: CivilDate;
}): SeriesPreviewView {
  if (options.series.state === "stopped") {
    return { status: "not-admitted", reason: "stopped" };
  }

  const preview = nextOccurrences(options.rule, options.today, PREVIEW_DATE_COUNT);
  if (preview.status === "refused") {
    return preview.reason === "end-reached"
      ? { status: "ended" }
      : { status: "unreadable", reason: preview.reason };
  }

  const dates = preview.dates.map(serialiseCivilDate);
  return {
    status: "preview",
    dates,
    dateCount: dates.length,
    monthDayResolutions: preview.monthDayResolutions.map(resolutionView),
  };
}

/**
 * Reads how the series' plan stands, by asking the recurrence engine.
 *
 * The occurrences handed to the engine are the dates the plan actually produced: the series' stored
 * occurrences that still expect an action, plus the dates its rule produced after the latest recorded
 * occurrence that have already passed. A date the plan produced and nothing was done about is exactly
 * what a missed date is, whether or not an occurrence record was ever admitted for it — only one
 * occurrence is admitted at a time, so a stalled series leaves those dates unrecorded by design.
 *
 * The threshold, the missed dates and the three resolutions are the engine's answer; this function
 * adds no date of its own, decides no count and words no resolution.
 */
function planReviewOf(options: {
  readonly series: TaskSeriesRecord;
  readonly rule: SeriesRule;
  readonly occurrences: readonly TaskRecord[];
  readonly today: CivilDate;
  readonly instant: ScenarioInstant;
}): SeriesPlanReviewView {
  const recordedPlanNeedsReview = options.series.planNeedsReview;
  if (options.series.state !== "active") {
    return {
      state: "not-admitting",
      missedDates: [],
      missedDateCount: 0,
      resolutions: [],
      recordedPlanNeedsReview,
    };
  }

  const planned: SeriesOccurrence[] = [];
  let latest: CivilDate | undefined;
  for (const occurrence of options.occurrences) {
    const dueOn = occurrence.dueOn === null ? undefined : parseCivilDate(occurrence.dueOn);
    if (dueOn === undefined || dueOn.status !== "parsed") {
      continue;
    }
    if (latest === undefined || serialiseCivilDate(dueOn.date) > serialiseCivilDate(latest)) {
      latest = dueOn.date;
    }
    if (isAwaitingAction(occurrence.status)) {
      planned.push({ dueOn: dueOn.date, status: occurrence.status });
    }
  }

  const anchor = latest ?? options.rule.firstDueOn;
  const ahead = nextOccurrences(options.rule, anchor, PLAN_WALK_COUNT);
  if (ahead.status === "preview") {
    for (const date of ahead.dates) {
      if (serialiseCivilDate(date) < serialiseCivilDate(options.today)) {
        planned.push({ dueOn: date, status: "open" });
      }
    }
  }

  const review = missedPlan({ rule: options.rule, occurrences: planned, now: options.instant });
  if (review.state === "on-track") {
    return {
      state: "on-track",
      missedDates: [],
      missedDateCount: 0,
      resolutions: [],
      recordedPlanNeedsReview,
    };
  }

  const missedDates = review.missedDates.map(serialiseCivilDate);
  return {
    state: "needs-review",
    missedDates,
    missedDateCount: missedDates.length,
    resolutions: review.resolutions,
    recordedPlanNeedsReview,
  };
}

/**
 * The actions one series read offers, each with the reason it is not available when it is not.
 *
 * Two authorities are kept apart: changing an occurrence is a question about that task, while pausing,
 * resuming, stopping or revising the plan is a question about the series. A stopped series offers
 * neither, because a stale action composed before the Stop must be refusable — the mutation answers
 * `conflict` or `unchanged`, and this list never implies otherwise.
 */
function seriesActions(options: {
  readonly mayChangeSeries: boolean;
  readonly mayChangeOccurrence: boolean;
  readonly state: SeriesState;
  readonly hasCurrentOccurrence: boolean;
  readonly actionableOccurrenceId: string | null;
  readonly needsReview: boolean;
}): readonly ReadAction[] {
  const stopped = options.state === "stopped";
  const paused = options.state === "paused";
  const mayAnswerOccurrence =
    options.mayChangeOccurrence && options.actionableOccurrenceId !== null;

  return [
    action(
      "editOccurrence",
      options.mayChangeOccurrence && options.hasCurrentOccurrence && !stopped,
      options.mayChangeOccurrence
        ? stopped
          ? "The series is stopped, so it has no current date to change."
          : "This series names no current date, so there is nothing to change here."
        : OWNERSHIP_REASON,
    ),
    action(
      "skipOccurrence",
      mayAnswerOccurrence,
      options.mayChangeOccurrence
        ? stopped
          ? "The series is stopped, so this date can be neither answered nor replaced."
          : paused
            ? "The series is paused, so answering this date would admit no next date; resume the series first."
            : "This series has no current date to answer."
        : OWNERSHIP_REASON,
    ),
    action(
      "resolveMissedPlan",
      options.mayChangeOccurrence && options.needsReview,
      options.mayChangeOccurrence
        ? "The plan is not awaiting a review, so there is no missed-plan resolution to choose."
        : OWNERSHIP_REASON,
    ),
    action(
      "pauseSeries",
      options.mayChangeSeries && !stopped && !paused,
      options.mayChangeSeries
        ? paused
          ? "The series is already paused."
          : "A stopped series cannot be paused or resumed."
        : SERIES_OWNERSHIP_REASON,
    ),
    action(
      "resumeSeries",
      options.mayChangeSeries && paused,
      options.mayChangeSeries
        ? stopped
          ? "A stopped series cannot be resumed."
          : "The series is already admitting dates."
        : SERIES_OWNERSHIP_REASON,
    ),
    action(
      "stopSeries",
      options.mayChangeSeries && !stopped,
      options.mayChangeSeries ? "The series is already stopped." : SERIES_OWNERSHIP_REASON,
    ),
    action(
      "editThisAndFuture",
      options.mayChangeSeries && !stopped,
      options.mayChangeSeries
        ? "The series is stopped, so a change to its plan could no longer take effect."
        : SERIES_OWNERSHIP_REASON,
    ),
  ];
}

/**
 * Reads one recurring series for the session's selected context.
 *
 * A series outside this context is refused exactly like one that does not exist anywhere, so the
 * refusal cannot be used to learn that a series exists elsewhere. Everything the recurrence engine
 * offers is then surfaced rather than re-decided: the next three dates as previews, the single
 * occurrence that can be acted on, any month-day resolution the rule had to make, and the plan review
 * with its three resolutions.
 */
export async function readSeries(
  query: SeriesReadQuery,
): Promise<ReadResult<ReadEnvelope<SeriesReading>>> {
  const opening = await openRead();
  if (opening.status === "refused") {
    return opening.result;
  }

  const stored = await readWork({
    session: opening.session,
    job: "readSeries",
    schema: storedWorkSchema,
  });
  if (stored.status === "unavailable") {
    return stored.result;
  }

  const seriesId = query.seriesId.trim();
  const series = stored.value.series.find((candidate) => candidate.seriesId === seriesId);
  if (series === undefined) {
    return { kind: "denied", denied: readDenial("no-permission") };
  }

  const viewable = canView(opening.session, {
    kind: "series",
    scope: opening.scope,
    ownerPrincipalId: series.ownerPrincipalId,
  });
  if (!viewable.allowed) {
    return { kind: "denied", denied: viewable.denial };
  }

  const workSource: SourceReference = { system: LOCAL_STORE_SYSTEM, reference: WORK_REFERENCE };
  const rule = toSeriesRule(series.currentRule);
  const revisions = toSeriesRevisions(series.effectiveRevisions);
  if (rule === undefined || revisions === undefined) {
    return unavailableRead("readSeries", workSource, DOCUMENT_UNREADABLE_GUIDANCE);
  }

  const today = todayForRead("readSeries", rule.planningTimeZone, opening.instant);
  if (today.status === "unavailable") {
    return today.result;
  }

  const occurrences = stored.value.tasks.filter(
    (task) =>
      task.seriesId === series.seriesId &&
      canView(opening.session, {
        kind: "task",
        scope: opening.scope,
        ownerPrincipalId: task.ownerPrincipalId,
      }).allowed,
  );
  const named =
    series.currentOccurrenceId === null
      ? undefined
      : occurrences.find((task) => task.taskId === series.currentOccurrenceId);
  const stopped = series.state === "stopped";
  const currentOccurrence =
    stopped || named === undefined
      ? null
      : taskRow({
          task: named,
          session: opening.session,
          scope: opening.scope,
          today: today.text,
        });
  const actionableOccurrenceId =
    series.state === "active" &&
    currentOccurrence !== null &&
    isAwaitingAction(currentOccurrence.status)
      ? currentOccurrence.taskId
      : null;

  const planReview = planReviewOf({
    series,
    rule,
    occurrences,
    today: today.date,
    instant: opening.instant,
  });
  const preview = previewOf({ series, rule, today: today.date });
  const leftBehind = stopped
    ? occurrences
        .filter((task) => isAwaitingAction(task.status))
        .toSorted(orderAgendaItems)
        .map((task) =>
          taskRow({ task, session: opening.session, scope: opening.scope, today: today.text }),
        )
    : [];

  const mayChangeSeries = canEdit(opening.session, {
    kind: "series",
    scope: opening.scope,
    ownerPrincipalId: series.ownerPrincipalId,
  }).allowed;
  const mayChangeOccurrence =
    named === undefined
      ? false
      : canEdit(opening.session, {
          kind: "task",
          scope: opening.scope,
          ownerPrincipalId: named.ownerPrincipalId,
        }).allowed;

  const previewDateCount = preview.status === "preview" ? preview.dateCount : 0;
  const envelope = buildEnvelope<SeriesReading>({
    data: {
      seriesId: series.seriesId,
      title: series.title,
      state: series.state,
      admitsFurtherOccurrences: series.state === "active",
      rule: ruleViewOf(series.currentRule),
      effectiveRevisions: revisions,
      today: today.text,
      currentOccurrence,
      actionableOccurrenceId,
      preview,
      planReview,
      leftBehind,
    },
    scope: opening.scope,
    source: { system: LOCAL_STORE_SYSTEM, reference: series.seriesId },
    revision: series.revision,
    asOf: opening.instant.toString(),
    coverage: WHOLE_COLLECTION_COVERAGE,
    valueStates: {
      "preview.dateCount": countState(previewDateCount),
      "planReview.missedDateCount": countState(planReview.missedDateCount),
      "leftBehind.count": countState(leftBehind.length),
      today: "value",
    },
    actions: seriesActions({
      mayChangeSeries,
      mayChangeOccurrence,
      state: series.state,
      hasCurrentOccurrence: currentOccurrence !== null,
      actionableOccurrenceId,
      needsReview: planReview.state === "needs-review",
    }),
  });

  return { kind: "envelope", envelope };
}
