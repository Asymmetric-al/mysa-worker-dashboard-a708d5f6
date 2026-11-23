import { z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { compareCodeUnits } from "@/lib/ordering";
import { parseCivilDate, serialiseCivilDate, todayInZone, type CivilDate } from "@/modules/time/civil";
import { missedPlan, nextOccurrences, type DisclosedMonthDayResolution, type PlanResolutions, type RepeatProfile, type SeriesEnd, type SeriesOccurrence, type SeriesRule, type SeriesState } from "@/modules/time/recurrence";
import { canEdit, canView, type ResolvedSession, type SessionSource } from "../authorize";
import {
  principalIdSchema,
  project,
  taskRecordSchema,
  taskSeriesRecordSchema,
  type PrincipalId,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type Scope,
  type SeriesEndRecord,
  type SeriesRuleRecord,
  type SeriesRuleRevisionRecord,
  type TaskKind,
  type TaskRecord,
  type TaskRecordStatus,
  type TaskSeriesRecord,
} from "../envelope";
import { LOCAL_STORE_SYSTEM, type ReadResult } from "../outcome";
import { answerOf, collectionRevision, compareOptionalText, countState, deniedRead, openRead, pageWindow, readAction, readStoreDocument, sourceUnavailableRead, type ScenarioInstant } from "./frame";
export type TaskListName = "today" | "upcoming" | "overdue" | "all" | "undated";
export type TaskSortField = "dueOn" | "title" | "category" | "status";
export type TaskSort = { readonly field: TaskSortField; readonly direction: "asc" | "desc" };
const TASK_SORT_FIELDS = ["dueOn", "title", "category", "status"] as const satisfies readonly TaskSortField[];
const DEFAULT_TASK_SORT: readonly TaskSort[] = [
  { field: "dueOn", direction: "asc" },
  { field: "title", direction: "asc" },
];
const PREVIEW_DATE_COUNT = 3;
const TIME_ZONE_SYSTEM = "time-zone-database";
const CALENDAR_SOURCE: SourceReference = { system: TIME_ZONE_SYSTEM, reference: "calendar" };
const WORK_SOURCE: SourceReference = { system: LOCAL_STORE_SYSTEM, reference: "work" };
const STORE_UNREADABLE_GUIDANCE = "The local development store did not answer for this session's work, so nothing is shown in place of it. Retry the read, and reset the development data if it keeps failing.";
const DOCUMENT_UNREADABLE_GUIDANCE = "This session's stored work could not be decoded, so nothing is shown in place of it. Reset the development data to restore the known seed.";
const CALENDAR_UNREADABLE_GUIDANCE = "A date in this view cannot be evaluated, because the named time zone is not one this runtime resolves. No date is judged in an assumed zone, so choose a display time zone in Settings and read the view again.";
// One private tag as the write path stores it: a label one principal applied to one task, which only that principal sees, so a stored document predating the family decodes as a task with no tag rather than as unreadable.
type TaskTagRecord = { readonly taskId: string; readonly tag: string; readonly ownerPrincipalId: PrincipalId };
const taskTagRecordSchema: z.ZodType<TaskTagRecord> = z.object({ taskId: z.string().min(1), tag: z.string().min(1), ownerPrincipalId: principalIdSchema });
const storedTaskTagsSchema = z.array(taskTagRecordSchema).default([]);
const storedTasksSchema = z.object({ tasks: z.array(taskRecordSchema), taskTags: storedTaskTagsSchema });
const storedWorkSchema = z.object({ tasks: z.array(taskRecordSchema), series: z.array(taskSeriesRecordSchema), taskTags: storedTaskTagsSchema });
type DecodedRead<T> = { readonly status: "decoded"; readonly value: T } | { readonly status: "unavailable"; readonly result: ReadResult<never> };
async function readWork<T>(options: { readonly session: ResolvedSession; readonly job: string; readonly schema: z.ZodType<T> }): Promise<DecodedRead<T>> {
  const stored = await readStoreDocument({ session: options.session, job: options.job, source: WORK_SOURCE, guidance: STORE_UNREADABLE_GUIDANCE });
  if (!stored.ok) return { status: "unavailable", result: stored.result };
  const decoded = options.schema.safeParse(stored.documents.state);
  return !decoded.success ? { status: "unavailable", result: sourceUnavailableRead({ job: options.job, source: WORK_SOURCE, guidance: DOCUMENT_UNREADABLE_GUIDANCE }) } : { status: "decoded", value: decoded.data };
}
type ResolvedToday = { readonly status: "resolved"; readonly date: CivilDate; readonly text: string } | { readonly status: "unavailable"; readonly result: ReadResult<never> };
function todayForRead(job: string, timeZone: string, instant: ScenarioInstant): ResolvedToday {
  const resolved = todayInZone(timeZone, instant);
  return resolved.status === "resolved" ? { status: "resolved", date: resolved.date, text: serialiseCivilDate(resolved.date) } : { status: "unavailable", result: sourceUnavailableRead({ job, source: CALENDAR_SOURCE, guidance: CALENDAR_UNREADABLE_GUIDANCE }) };
}
const TASK_FIELD_ORDERS: Readonly<Record<TaskSortField, (left: TaskRecord, right: TaskRecord) => number>> = {
  dueOn: (left, right) => compareOptionalText(left.dueOn, right.dueOn),
  title: (left, right) => compareCodeUnits(left.title, right.title),
  category: (left, right) => compareOptionalText(left.category, right.category),
  status: (left, right) => compareCodeUnits(left.status, right.status),
};
const compareTaskField = (left: TaskRecord, right: TaskRecord, field: TaskSortField): number => TASK_FIELD_ORDERS[field](left, right);
function orderTasks(left: TaskRecord, right: TaskRecord, sort: readonly TaskSort[]): number {
  for (const instruction of sort) {
    const order = compareTaskField(left, right, instruction.field);
    if (order !== 0) return instruction.direction === "desc" ? -order : order;
  }
  return compareCodeUnits(left.taskId, right.taskId);
}
function normaliseSort(sort: readonly TaskSort[] | undefined): readonly TaskSort[] {
  if (sort === undefined || sort.length === 0) return DEFAULT_TASK_SORT;
  const accepted = sort.filter((instruction) => (TASK_SORT_FIELDS as readonly string[]).includes(instruction.field) && (instruction.direction === "asc" || instruction.direction === "desc"));
  return accepted.length === 0 ? DEFAULT_TASK_SORT : accepted;
}
const isAwaitingAction = (status: TaskRecordStatus): boolean => status === "open" || status === "reopened";
const TASK_LIST_NAMES = ["today", "upcoming", "overdue", "all", "undated"] as const satisfies readonly TaskListName[];
export type TaskDateRelation = "today" | "future" | "past" | "undated";
export type TaskListRow = { readonly taskId: string; readonly revision: string; readonly title: string; readonly category: string | null; readonly dueOn: string | null } & { readonly dateRelation: TaskDateRelation; readonly plannedTime: string | null; readonly timeZone: string | null; readonly kind: TaskKind } & {
  readonly status: TaskRecordStatus;
  readonly partnerId: string | null;
  readonly initiativeId: string | null;
  readonly seriesId: string | null;
} & { readonly tags: readonly string[]; readonly note: string | null; readonly actions: readonly ReadAction[]; readonly selectable: boolean; readonly selectionReason?: string };
const TASK_ROW_FIELDS = ["taskId", "revision", "title", "category", "dueOn", "plannedTime", "timeZone", "kind", "status", "partnerId", "initiativeId", "seriesId", "note"] as const;
const OWNERSHIP_REASON = "This task belongs to another principal's work, so your session may read it but not change it.";
// A tag belongs to the principal who applied it, so it leaves the store only for that principal: the family is filtered here, before the envelope exists, and the labels are ordered by the shared code-unit comparator so one stored set reads in one order on every surface.
function privateTagsByTask(tags: readonly TaskTagRecord[], principalId: PrincipalId): ReadonlyMap<string, readonly string[]> {
  const held = new Map<string, string[]>();
  for (const record of tags) {
    if (record.ownerPrincipalId !== principalId) continue;
    const existing = held.get(record.taskId);
    if (existing === undefined) held.set(record.taskId, [record.tag]);
    else existing.push(record.tag);
  }
  return new Map([...held.entries()].map(([taskId, labels]) => [taskId, labels.toSorted(compareCodeUnits)]));
}
const dateRelationOf = (dueOn: string | null, today: string): TaskDateRelation => (dueOn === null ? "undated" : dueOn === today ? "today" : dueOn < today ? "past" : "future");
function taskRow(options: { readonly task: TaskRecord; readonly session: ResolvedSession; readonly scope: Scope; readonly today: string; readonly privateTags: ReadonlyMap<string, readonly string[]> }): TaskListRow {
  const { task, session, scope, today } = options;
  const mayEdit = canEdit(session, { kind: "task", scope, ownerPrincipalId: task.ownerPrincipalId }).allowed;
  const awaiting = isAwaitingAction(task.status);
  const fields = project(task, TASK_ROW_FIELDS);
  const row: TaskListRow = {
    ...fields,
    dateRelation: dateRelationOf(task.dueOn, today),
    tags: options.privateTags.get(task.taskId) ?? [],
    actions: [
      readAction("editTask", mayEdit, OWNERSHIP_REASON),
      readAction("completeTask", mayEdit && awaiting, mayEdit ? (task.status === "cancelled" ? "This task is cancelled, so completing it is not available; create a new task for the work instead." : "This task is already completed, so it is reopened before it can be completed again.") : OWNERSHIP_REASON),
      readAction("reopenTask", mayEdit && task.status === "completed", mayEdit ? "Only a completed task can be reopened." : OWNERSHIP_REASON),
      readAction("cancelTask", mayEdit && awaiting, mayEdit ? "Only open work can be cancelled." : OWNERSHIP_REASON),
    ],
    selectable: mayEdit,
    ...(mayEdit ? {} : { selectionReason: OWNERSHIP_REASON }),
  };
  return row;
}
export type TaskListQuery = { readonly list: TaskListName; readonly displayTimeZone: string; readonly page?: number; readonly pageSize?: number; readonly sort?: readonly TaskSort[] };
export type TaskListData = { readonly list: TaskListName; readonly displayTimeZone: string; readonly today: string; readonly tasks: readonly TaskListRow[]; readonly total: number; readonly page: number; readonly pageSize: number; readonly pageCount: number };
function inList(task: TaskRecord, list: TaskListName, today: string): boolean {
  if (list === "all") return true;
  if (!isAwaitingAction(task.status)) return false;
  if (task.dueOn === null) return list === "undated";
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
function listActions(selectableOnPage: boolean): readonly ReadAction[] {
  const bulkReason = "No row on this page can be changed from your session, so there is nothing to act on. Clear the filters or open a page holding your own work.";
  return [readAction("createTask", true), readAction("bulkApplyTag", selectableOnPage, bulkReason), readAction("bulkRemoveTag", selectableOnPage, bulkReason), readAction("bulkCreateTasks", selectableOnPage, bulkReason), readAction("bulkCompleteTasks", selectableOnPage, bulkReason)];
}
/** Reads one of the five task lists for the session's selected context. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function listTasks(query: TaskListQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<TaskListData>>> {
  const opening = await openRead({ job: "listTasks", source, unselectedReason: "no-membership" });
  if (!opening.ok) return opening.result;
  const today = todayForRead("listTasks", query.displayTimeZone, opening.instant);
  if (today.status === "unavailable") return today.result;
  const stored = await readWork({ session: opening.session, job: "listTasks", schema: storedTasksSchema });
  if (stored.status === "unavailable") return stored.result;
  const privateTags = privateTagsByTask(stored.value.taskTags, opening.session.principalId);
  const list = (TASK_LIST_NAMES as readonly string[]).includes(query.list) ? query.list : "all";
  const sort = normaliseSort(query.sort);
  const readable = stored.value.tasks.filter((task) => canView(opening.session, { kind: "task", scope: opening.scope, ownerPrincipalId: task.ownerPrincipalId }).allowed);
  const listed = readable.filter((task) => inList(task, list, today.text)).toSorted((left, right) => orderTasks(left, right, sort));
  const window = pageWindow(listed.length, query.page, query.pageSize);
  const rows = listed.slice(window.start, window.end).map((task) => taskRow({ task, session: opening.session, scope: opening.scope, today: today.text, privateTags }));
  const data: TaskListData = { list, displayTimeZone: query.displayTimeZone, today: today.text, tasks: rows, total: listed.length, page: window.page, pageSize: window.pageSize, pageCount: window.pageCount };
  return answerOf(opening.scope, opening.instant.toString(), { data, source: WORK_SOURCE, revision: collectionRevision("tasks", readable), valueStates: { total: countState(listed.length), pageCount: countState(window.pageCount), today: "value" }, actions: listActions(rows.some((row) => row.selectable)) });
}
export type AgendaQuery = { readonly displayTimeZone: string; readonly page?: number; readonly pageSize?: number };
export type AgendaDay = { readonly dueOn: string; readonly label: string; readonly items: readonly TaskListRow[] };
export type AgendaData = { readonly displayTimeZone: string; readonly today: string; readonly days: readonly AgendaDay[]; readonly dayCount: number; readonly total: number; readonly page: number; readonly pageSize: number; readonly pageCount: number };
function orderAgendaItems(left: TaskRecord, right: TaskRecord): number {
  const byDate = compareOptionalText(left.dueOn, right.dueOn);
  if (byDate !== 0) return byDate;
  const byTime = compareOptionalText(left.plannedTime, right.plannedTime);
  return byTime !== 0 ? byTime : compareCodeUnits(left.taskId, right.taskId);
}
function groupByDay(rows: readonly TaskListRow[]): readonly AgendaDay[] {
  const byDate = new Map<string, TaskListRow[]>();
  for (const row of rows) {
    if (row.dueOn === null) continue;
    const existing = byDate.get(row.dueOn);
    if (existing === undefined) {
      byDate.set(row.dueOn, [row]);
    } else existing.push(row);
  }
  return [...byDate.entries()].map(([dueOn, items]) => ({ dueOn, label: dueOn, items }));
}
/** Reads the dated agenda for the session's selected context. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readAgenda(query: AgendaQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<AgendaData>>> {
  const opening = await openRead({ job: "readAgenda", source, unselectedReason: "no-membership" });
  if (!opening.ok) return opening.result;
  const today = todayForRead("readAgenda", query.displayTimeZone, opening.instant);
  if (today.status === "unavailable") return today.result;
  const stored = await readWork({ session: opening.session, job: "readAgenda", schema: storedTasksSchema });
  if (stored.status === "unavailable") return stored.result;
  const privateTags = privateTagsByTask(stored.value.taskTags, opening.session.principalId);
  const readable = stored.value.tasks.filter((task) => canView(opening.session, { kind: "task", scope: opening.scope, ownerPrincipalId: task.ownerPrincipalId }).allowed);
  const dated = readable.filter((task) => task.dueOn !== null && isAwaitingAction(task.status)).toSorted(orderAgendaItems);
  const window = pageWindow(dated.length, query.page, query.pageSize);
  const rows = dated.slice(window.start, window.end).map((task) => taskRow({ task, session: opening.session, scope: opening.scope, today: today.text, privateTags }));
  const days = groupByDay(rows);
  const data: AgendaData = { displayTimeZone: query.displayTimeZone, today: today.text, days, dayCount: days.length, total: dated.length, page: window.page, pageSize: window.pageSize, pageCount: window.pageCount };
  return answerOf(opening.scope, opening.instant.toString(), {
    data,
    source: WORK_SOURCE,
    revision: collectionRevision("tasks", readable),
    valueStates: { total: countState(dated.length), dayCount: countState(days.length), pageCount: countState(window.pageCount), today: "value" },
    actions: listActions(rows.some((row) => row.selectable)),
  });
}
export type SeriesReadQuery = { readonly seriesId: string };
export type SeriesRuleView = { readonly profile: RepeatProfile; readonly interval: number; readonly dayOfMonth: number | null; readonly firstDueOn: string; readonly planningTimeZone: string; readonly end: SeriesEndRecord };
export type SeriesRevisionView = { readonly revisionId: string; readonly effectiveFrom: string; readonly rule: SeriesRuleView };
export type SeriesPreviewResolution = { readonly dueOn: string; readonly requestedDay: number; readonly resolvedDay: number };
export type SeriesPreviewView =
  | { readonly status: "preview"; readonly dates: readonly string[]; readonly dateCount: number; readonly monthDayResolutions: readonly SeriesPreviewResolution[] }
  | { readonly status: "ended" }
  | { readonly status: "not-admitted"; readonly reason: "paused" | "stopped" }
  | { readonly status: "unreadable"; readonly reason: "invalid-rule" | "unbounded" };
export type MissedPlanResolution = PlanResolutions[number];
export type SeriesPlanReviewView = { readonly state: "on-track" | "needs-review" | "not-admitting"; readonly missedDates: readonly string[]; readonly missedDateCount: number; readonly resolutions: readonly MissedPlanResolution[]; readonly recordedPlanNeedsReview: boolean };
export type SeriesReading = { readonly seriesId: string; readonly title: string; readonly state: SeriesState; readonly admitsFurtherOccurrences: boolean } & { readonly rule: SeriesRuleView; readonly effectiveRevisions: readonly SeriesRevisionView[]; readonly today: string } & {
  readonly currentOccurrence: TaskListRow | null;
  readonly actionableOccurrenceId: string | null;
  readonly preview: SeriesPreviewView;
} & { readonly planReview: SeriesPlanReviewView; readonly leftBehind: readonly TaskListRow[] };
const SERIES_RULE_FIELDS = ["profile", "interval", "dayOfMonth", "firstDueOn", "planningTimeZone", "end"] as const;
const PLAN_WALK_COUNT = 12;
const SERIES_OWNERSHIP_REASON = "This repeating task belongs to another principal's work, so your session may read it but not change it.";
function toSeriesRule(record: SeriesRuleRecord): SeriesRule | undefined {
  const firstDueOn = parseCivilDate(record.firstDueOn);
  const end = toSeriesEnd(record.end);
  if (firstDueOn.status !== "parsed" || end === undefined) return undefined;
  const rule: SeriesRule = { profile: record.profile, interval: record.interval, firstDueOn: firstDueOn.date, planningTimeZone: record.planningTimeZone, end };
  if (record.dayOfMonth !== null) rule.dayOfMonth = record.dayOfMonth;
  return rule;
}
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
const ruleViewOf = (rule: SeriesRuleRecord): SeriesRuleView => project(rule, SERIES_RULE_FIELDS);
function toSeriesRevisions(revisions: readonly SeriesRuleRevisionRecord[]): readonly SeriesRevisionView[] | undefined {
  const views: SeriesRevisionView[] = [];
  for (const revision of revisions) {
    if (toSeriesRule(revision.rule) === undefined) return undefined;
    views.push({ revisionId: revision.revisionId, effectiveFrom: revision.effectiveFrom, rule: ruleViewOf(revision.rule) });
  }
  return views;
}
const resolutionView = (resolution: DisclosedMonthDayResolution): SeriesPreviewResolution => ({ dueOn: serialiseCivilDate(resolution.dueOn), requestedDay: resolution.requestedDay, resolvedDay: resolution.resolvedDay });
function previewOf(options: { readonly series: TaskSeriesRecord; readonly rule: SeriesRule; readonly today: CivilDate }): SeriesPreviewView {
  if (options.series.state === "stopped") return { status: "not-admitted", reason: "stopped" };
  const preview = nextOccurrences(options.rule, options.today, PREVIEW_DATE_COUNT);
  if (preview.status === "refused") return preview.reason === "end-reached" ? { status: "ended" } : { status: "unreadable", reason: preview.reason };
  const dates = preview.dates.map(serialiseCivilDate);
  return { status: "preview", dates, dateCount: dates.length, monthDayResolutions: preview.monthDayResolutions.map(resolutionView) };
}
function planReviewOf(options: { readonly series: TaskSeriesRecord; readonly rule: SeriesRule; readonly occurrences: readonly TaskRecord[]; readonly today: CivilDate; readonly instant: ScenarioInstant }): SeriesPlanReviewView {
  const recordedPlanNeedsReview = options.series.planNeedsReview;
  if (options.series.state !== "active") return { state: "not-admitting", missedDates: [], missedDateCount: 0, resolutions: [], recordedPlanNeedsReview };
  const planned: SeriesOccurrence[] = [];
  let latest: CivilDate | undefined;
  for (const occurrence of options.occurrences) {
    const dueOn = occurrence.dueOn === null ? undefined : parseCivilDate(occurrence.dueOn);
    if (dueOn === undefined || dueOn.status !== "parsed") continue;
    if (latest === undefined || serialiseCivilDate(dueOn.date) > serialiseCivilDate(latest)) latest = dueOn.date;
    if (isAwaitingAction(occurrence.status)) planned.push({ dueOn: dueOn.date, status: occurrence.status });
  }
  const anchor = latest ?? options.rule.firstDueOn;
  const ahead = nextOccurrences(options.rule, anchor, PLAN_WALK_COUNT);
  if (ahead.status === "preview") for (const date of ahead.dates) if (serialiseCivilDate(date) < serialiseCivilDate(options.today)) planned.push({ dueOn: date, status: "open" });
  const review = missedPlan({ rule: options.rule, occurrences: planned, now: options.instant });
  if (review.state === "on-track") return { state: "on-track", missedDates: [], missedDateCount: 0, resolutions: [], recordedPlanNeedsReview };
  const missedDates = review.missedDates.map(serialiseCivilDate);
  return { state: "needs-review", missedDates, missedDateCount: missedDates.length, resolutions: review.resolutions, recordedPlanNeedsReview };
}
function seriesActions(options: { readonly mayChangeSeries: boolean; readonly mayChangeOccurrence: boolean; readonly state: SeriesState; readonly hasCurrentOccurrence: boolean; readonly actionableOccurrenceId: string | null; readonly needsReview: boolean }): readonly ReadAction[] {
  const stopped = options.state === "stopped";
  const paused = options.state === "paused";
  const mayAnswerOccurrence = options.mayChangeOccurrence && options.actionableOccurrenceId !== null;
  return [
    readAction("editOccurrence", options.mayChangeOccurrence && options.hasCurrentOccurrence && !stopped, options.mayChangeOccurrence ? (stopped ? "The series is stopped, so it has no current date to change." : "This series names no current date, so there is nothing to change here.") : OWNERSHIP_REASON),
    readAction(
      "skipOccurrence",
      mayAnswerOccurrence,
      options.mayChangeOccurrence ? (stopped ? "The series is stopped, so this date can be neither answered nor replaced." : paused ? "The series is paused, so answering this date would admit no next date; resume the series first." : "This series has no current date to answer.") : OWNERSHIP_REASON,
    ),
    readAction("resolveMissedPlan", options.mayChangeOccurrence && options.needsReview, options.mayChangeOccurrence ? "The plan is not awaiting a review, so there is no missed-plan resolution to choose." : OWNERSHIP_REASON),
    readAction("pauseSeries", options.mayChangeSeries && !stopped && !paused, options.mayChangeSeries ? (paused ? "The series is already paused." : "A stopped series cannot be paused or resumed.") : SERIES_OWNERSHIP_REASON),
    readAction("resumeSeries", options.mayChangeSeries && paused, options.mayChangeSeries ? (stopped ? "A stopped series cannot be resumed." : "The series is already admitting dates.") : SERIES_OWNERSHIP_REASON),
    readAction("stopSeries", options.mayChangeSeries && !stopped, options.mayChangeSeries ? "The series is already stopped." : SERIES_OWNERSHIP_REASON),
    readAction("editThisAndFuture", options.mayChangeSeries && !stopped, options.mayChangeSeries ? "The series is stopped, so a change to its plan could no longer take effect." : SERIES_OWNERSHIP_REASON),
  ];
}
/** Reads one recurring series for the session's selected context. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readSeries(query: SeriesReadQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<SeriesReading>>> {
  const opening = await openRead({ job: "readSeries", source, unselectedReason: "no-membership" });
  if (!opening.ok) return opening.result;
  const stored = await readWork({ session: opening.session, job: "readSeries", schema: storedWorkSchema });
  if (stored.status === "unavailable") return stored.result;
  const privateTags = privateTagsByTask(stored.value.taskTags, opening.session.principalId);
  const seriesId = query.seriesId.trim();
  const series = stored.value.series.find((candidate) => candidate.seriesId === seriesId);
  if (series === undefined) return deniedRead("no-permission");
  const viewable = canView(opening.session, { kind: "series", scope: opening.scope, ownerPrincipalId: series.ownerPrincipalId });
  if (!viewable.allowed) return { kind: "denied", denied: viewable.denial };
  const rule = toSeriesRule(series.currentRule);
  const revisions = toSeriesRevisions(series.effectiveRevisions);
  if (rule === undefined || revisions === undefined) return sourceUnavailableRead({ job: "readSeries", source: WORK_SOURCE, guidance: DOCUMENT_UNREADABLE_GUIDANCE });
  const today = todayForRead("readSeries", rule.planningTimeZone, opening.instant);
  if (today.status === "unavailable") return today.result;
  const occurrences = stored.value.tasks.filter((task) => task.seriesId === series.seriesId && canView(opening.session, { kind: "task", scope: opening.scope, ownerPrincipalId: task.ownerPrincipalId }).allowed);
  const named = series.currentOccurrenceId === null ? undefined : occurrences.find((task) => task.taskId === series.currentOccurrenceId);
  const stopped = series.state === "stopped";
  const currentOccurrence = stopped || named === undefined ? null : taskRow({ task: named, session: opening.session, scope: opening.scope, today: today.text, privateTags });
  const actionableOccurrenceId = series.state === "active" && currentOccurrence !== null && isAwaitingAction(currentOccurrence.status) ? currentOccurrence.taskId : null;
  const planReview = planReviewOf({ series, rule, occurrences, today: today.date, instant: opening.instant });
  const preview = previewOf({ series, rule, today: today.date });
  const leftBehind = stopped
    ? occurrences
        .filter((task) => isAwaitingAction(task.status))
        .toSorted(orderAgendaItems)
        .map((task) => taskRow({ task, session: opening.session, scope: opening.scope, today: today.text, privateTags }))
    : [];
  const mayChangeSeries = canEdit(opening.session, { kind: "series", scope: opening.scope, ownerPrincipalId: series.ownerPrincipalId }).allowed;
  const mayChangeOccurrence = named === undefined ? false : canEdit(opening.session, { kind: "task", scope: opening.scope, ownerPrincipalId: named.ownerPrincipalId }).allowed;
  const data: SeriesReading = { seriesId: series.seriesId, title: series.title, state: series.state, admitsFurtherOccurrences: series.state === "active", rule: ruleViewOf(series.currentRule), effectiveRevisions: revisions, today: today.text, currentOccurrence, actionableOccurrenceId, preview, planReview, leftBehind };
  const valueStates: Readonly<Record<string, RecordedValueState>> = { "preview.dateCount": countState(preview.status === "preview" ? preview.dateCount : 0), "planReview.missedDateCount": countState(planReview.missedDateCount), "leftBehind.count": countState(leftBehind.length), today: "value" };
  const actions = seriesActions({ mayChangeSeries, mayChangeOccurrence, state: series.state, hasCurrentOccurrence: currentOccurrence !== null, actionableOccurrenceId, needsReview: planReview.state === "needs-review" });
  return answerOf(opening.scope, opening.instant.toString(), { data, source: { system: LOCAL_STORE_SYSTEM, reference: series.seriesId }, revision: series.revision, valueStates, actions });
}
