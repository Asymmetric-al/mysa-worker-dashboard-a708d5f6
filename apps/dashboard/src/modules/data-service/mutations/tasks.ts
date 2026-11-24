import { z } from "zod";
import { now } from "@/modules/time/clock";
import { parseCivilDate, serialiseCivilDate, todayInZone, type CivilDate } from "@/modules/time/civil";
import { REPEAT_PROFILES, admitSuccessor, applyThisAndFuture, missedPlan, nextOccurrences, validateSeriesRule, type RepeatProfile, type RuleRevision, type SeriesEnd, type SeriesOccurrence, type SeriesRule, type SeriesRulePatch, type SeriesState } from "@/modules/time/recurrence";
import { canEdit, type ResolvedSession, type ScopeDecision } from "../authorize";
import { principalIdSchema, recordRevisionSchema, taskRecordSchema, taskSeriesRecordSchema, type MutationInput, type PrincipalId, type Scope, type SeriesEndRecord, type SeriesRuleRecord, type SeriesRuleRevisionRecord, type TaskKind, type TaskRecord, type TaskRecordStatus, type TaskSeriesRecord } from "../envelope";
import { openMutation, refuseDenied, runMutation, type ApplyResult, type CurrentTarget, type MutationContext, type MutationName } from "../operations";
import { CORRUPT_DOCUMENT_FAULT, type MutationOutcome, type MutationResult, type PerItemResult } from "../outcome";
const WORDS = {
  titleRequired: "Give this task a title, because a title is the one thing a task cannot do without.",
  titleTooLong: "Shorten the title to a phrase, so it reads at a glance in a list.",
  categoryTooLong: "A category is a short label of your own, so shorten this one.",
  noteTooLong: "A note is a short reminder about the work, so shorten this one.",
  taskIdRequired: "This action applies to one task, so open the task again and retry.",
  seriesIdRequired: "This change applies to one repeating task, so open the series again and retry.",
  occurrenceIdRequired: "This action applies to one date of a repeating task, so open the series again and retry.",
  dueDateInvalid: "Enter the due date as a real calendar date, so the work is never given a day that does not exist.",
  plannedTimeInvalid: "Enter the planned time as a 24-hour clock time, so a meeting states when it is planned rather than an instant in an assumed zone.",
  plannedTimeRequiresZone: "State the time zone the planned time is read in, so the clock reading is never taken as an assumed zone.",
  plannedTimeOnlyForMeeting: "A planned time belongs to a meeting task, so choose Meeting as the kind of work or remove the time.",
  plannedTimeOtherDay: "The planned time falls on a different day from the due date, so align the two before saving.",
  timeZoneInvalid: "Choose a time zone this runtime recognises, so a stored plan is read in a stated zone.",
  kindInvalid: "Choose Task or Meeting as the kind of work.",
  linkInvalid: "Choose the linked record from the list, so a link names a record rather than a typed value.",
  tagRequired: "Name the private tag this action applies.",
  tagTooLong: "A private tag is a short label, so shorten this one.",
  selectionEmpty: "Select at least one task, because a bulk action applies only to the rows you selected.",
  selectionTooLarge: "Select at most 200 tasks in one action, because a larger selection is a filter in disguise.",
  selectionRepeated: "Each row appears once in a selection, so remove the repeated row and submit again.",
  followUpTemplateRequired: "State the follow-up task this action creates for each selected row.",
  followUpTemplateAmbiguous: "State the follow-up task once, so the same request cannot describe two different follow-ups.",
  profileInvalid: "Choose a repeat profile: does not repeat, weekly, every N weeks, monthly on a day, or every N months.",
  intervalRequired: "Choose how many periods between occurrences, as a whole number of at least 1.",
  intervalNotApplicable: "A repeat interval belongs to the every-N-weeks and every-N-months profiles, so choose one of those or remove the interval.",
  dayOfMonthRequired: "Choose the day of the month, from 1 to 31.",
  dayOfMonthNotApplicable: "A day of the month belongs to the monthly profiles, so choose one of those or remove the day.",
  endRequired: "Choose an end date or a number of occurrences, or turn on the ongoing series policy.",
  endAmbiguous: "State one end for this series: an end date, a number of occurrences, or the ongoing policy.",
  endCountInvalid: "Choose how many occurrences, as a whole number of at least 1.",
  firstDueDateRequired: "Choose the first due date the repeat counts from.",
  planningTimeZoneRequired: "Choose the planning time zone, so a display change never moves these dates.",
  effectiveFromRequired: "Choose the date this change takes effect from, so the dates before it keep the rule they were planned under.",
  resolutionRequired: "Choose one of the three resolutions for a plan that needs review: keep this occurrence, move the next date forward, or stop the series.",
  unfinishedWorkInvalid: "Choose what happens to the unfinished work when the series stops: keep it, or cancel it.",
  cancellationNotConfirmed: "Confirm the cancellation, because it is a deliberate act about this task.",
} as const;
const TITLE_MAX_LENGTH = 200,
  CATEGORY_MAX_LENGTH = 60,
  NOTE_MAX_LENGTH = 2000,
  TAG_MAX_LENGTH = 60,
  SELECTION_MAX_LENGTH = 200,
  PREVIEW_DATE_COUNT = 3,
  PLAN_WALK_COUNT = 12;
const codePointLength = (value: string): number => Array.from(value).length;
const REVISION_COUNTER = /^rev-(\d+)$/u,
  REVISION_SUFFIX = /~(\d+)$/u;
function nextRevision(current: string): string {
  const counter = REVISION_COUNTER.exec(current);
  if (counter !== null) {
    const counted = Number.parseInt(counter[1] ?? "", 10);
    if (Number.isSafeInteger(counted)) return `rev-${String(counted + 1)}`;
  }
  const suffixed = REVISION_SUFFIX.exec(current);
  if (suffixed !== null) {
    const counted = Number.parseInt(suffixed[1] ?? "", 10);
    if (Number.isSafeInteger(counted)) return `${current.slice(0, current.length - suffixed[0].length)}~${String(counted + 1)}`;
  }
  return `${current}~1`;
}
const newRecordId = (prefix: string): string => `${prefix}-${globalThis.crypto.randomUUID()}`;
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export type TaskTagRecord = { readonly taskId: string; readonly tag: string; readonly ownerPrincipalId: PrincipalId; readonly revision: string };
const taskTagRecordSchema: z.ZodType<TaskTagRecord> = z.object({ taskId: z.string().min(1), tag: z.string().min(1), ownerPrincipalId: principalIdSchema, revision: recordRevisionSchema });
const workDocumentSchema = z.object({ tasks: z.array(taskRecordSchema), series: z.array(taskSeriesRecordSchema), taskTags: z.array(taskTagRecordSchema).default([]) });
type WorkDocument = { readonly tasks: readonly TaskRecord[]; readonly series: readonly TaskSeriesRecord[]; readonly taskTags: readonly TaskTagRecord[] };
const EMPTY_WORK_DOCUMENT: WorkDocument = { tasks: [], series: [], taskTags: [] };
class UnreadableWorkDocumentError extends Error {
  constructor(subject: string) {
    super(`This session's stored work cannot be read: ${subject}. Nothing was written, because a change applied over a document this build cannot decode would overwrite records it never read.`);
    this.name = CORRUPT_DOCUMENT_FAULT;
    Object.setPrototypeOf(this, UnreadableWorkDocumentError.prototype);
  }
}
function readWorkDocument(state: unknown): WorkDocument {
  if (state === undefined || state === null) return EMPTY_WORK_DOCUMENT;
  const decoded = workDocumentSchema.safeParse(state);
  if (!decoded.success) throw new UnreadableWorkDocumentError("the tasks, series and private tags do not decode");
  return decoded.data;
}
function writeWorkDocument(docs: MutationContext["docs"], work: WorkDocument): void {
  const raw: unknown = docs.state;
  const base = isPlainObject(raw) ? raw : {};
  docs.state = { ...base, tasks: work.tasks, series: work.series, taskTags: work.taskTags };
}
const isAwaitingAction = (status: TaskRecordStatus): boolean => status === "open" || status === "reopened";
const taskOf = (work: WorkDocument, taskId: string): TaskRecord | undefined => work.tasks.find((task) => task.taskId === taskId);
const seriesOf = (work: WorkDocument, seriesId: string): TaskSeriesRecord | undefined => work.series.find((series) => series.seriesId === seriesId);
const occurrencesOf = (work: WorkDocument, seriesId: string): readonly TaskRecord[] => work.tasks.filter((task) => task.seriesId === seriesId);
const tagRecordsOf = (work: WorkDocument, taskId: string): readonly TaskTagRecord[] => work.taskTags.filter((tag) => tag.taskId === taskId);
const withTask = (work: WorkDocument, task: TaskRecord): WorkDocument => ({ tasks: work.tasks.map((existing) => (existing.taskId === task.taskId ? task : existing)), series: work.series, taskTags: work.taskTags });
const withNewTasks = (work: WorkDocument, tasks: readonly TaskRecord[]): WorkDocument => ({ tasks: [...work.tasks, ...tasks], series: work.series, taskTags: work.taskTags });
const withSeries = (work: WorkDocument, series: TaskSeriesRecord): WorkDocument => ({ tasks: work.tasks, series: work.series.map((existing) => (existing.seriesId === series.seriesId ? series : existing)), taskTags: work.taskTags });
const withTaskTags = (work: WorkDocument, taskTags: readonly TaskTagRecord[]): WorkDocument => ({ tasks: work.tasks, series: work.series, taskTags });
function toEngineEnd(end: SeriesEndRecord): SeriesEnd | undefined {
  const dated = end.kind === "on-date" ? civilDateOf(end.on) : undefined;
  return end.kind === "after-count" ? { kind: "after-count", count: end.count } : end.kind === "ongoing-personal-policy" ? { kind: "ongoing-personal-policy" } : dated === undefined ? undefined : { kind: "on-date", on: dated };
}
function toEngineRule(record: SeriesRuleRecord): SeriesRule | undefined {
  const firstDueOn = parseCivilDate(record.firstDueOn);
  if (firstDueOn.status === "refused") return undefined;
  const engineEnd = toEngineEnd(record.end);
  if (engineEnd === undefined) return undefined;
  const rule: SeriesRule = { profile: record.profile, interval: record.interval, firstDueOn: firstDueOn.date, planningTimeZone: record.planningTimeZone, end: engineEnd };
  if (record.dayOfMonth !== null) rule.dayOfMonth = record.dayOfMonth;
  return rule;
}
function toRuleRecord(rule: SeriesRule): SeriesRuleRecord {
  const { end } = rule;
  const storedEnd: SeriesEndRecord = end.kind === "on-date" ? { kind: "on-date", on: serialiseCivilDate(end.on) } : end.kind === "after-count" ? { kind: "after-count", count: end.count } : { kind: "ongoing-personal-policy" };
  return { profile: rule.profile, interval: rule.interval, dayOfMonth: rule.dayOfMonth ?? null, firstDueOn: serialiseCivilDate(rule.firstDueOn), planningTimeZone: rule.planningTimeZone, end: storedEnd };
}
function civilDateOf(value: string | null): CivilDate | undefined {
  if (value === null) return undefined;
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : undefined;
}
function todayFor(rule: SeriesRule): CivilDate | undefined {
  const resolved = todayInZone(rule.planningTimeZone, now());
  return resolved.status === "resolved" ? resolved.date : undefined;
}
export type TaskView = {
  readonly taskId: string;
  readonly title: string;
  readonly category: string | null;
  readonly dueOn: string | null;
  readonly plannedTime: string | null;
  readonly timeZone: string | null;
  readonly kind: TaskKind;
  readonly status: TaskRecordStatus;
  readonly partnerId: string | null;
  readonly initiativeId: string | null;
  readonly seriesId: string | null;
  readonly note: string | null;
  readonly revision: string;
};
export type SeriesRuleView = { readonly profile: RepeatProfile; readonly interval: number; readonly dayOfMonth: number | null; readonly firstDueOn: string; readonly planningTimeZone: string; readonly end: SeriesEndRecord };
export type SeriesView = { readonly seriesId: string; readonly title: string; readonly state: SeriesState; readonly planNeedsReview: boolean; readonly currentOccurrenceId: string | null; readonly revision: string; readonly rule: SeriesRuleView };
export type PreviewResolution = { readonly dueOn: string; readonly requestedDay: number; readonly resolvedDay: number };
export type SeriesPreviewView = { readonly status: "preview"; readonly dates: readonly string[]; readonly monthDayResolutions: readonly PreviewResolution[] } | { readonly status: "ended" } | { readonly status: "unreadable"; readonly reason: string } | { readonly status: "not-admitted"; readonly reason: SeriesState };
export type BulkItemState = "accepted" | "unchanged" | "excluded" | "failed";
export type BulkItemView = { readonly taskId: string; readonly state: BulkItemState; readonly revision: string | null; readonly createdTaskId: string | null; readonly reasonCode: string | null; readonly reason: string | null };
export type BulkResultView = { readonly items: readonly BulkItemView[]; readonly acceptedCount: number; readonly unchangedCount: number; readonly excludedCount: number; readonly failedCount: number; readonly createdTaskIds: readonly string[] };
function taskView(task: TaskRecord): TaskView {
  return { taskId: task.taskId, title: task.title, category: task.category, dueOn: task.dueOn, plannedTime: task.plannedTime, timeZone: task.timeZone, kind: task.kind, status: task.status, partnerId: task.partnerId, initiativeId: task.initiativeId, seriesId: task.seriesId, note: task.note, revision: task.revision };
}
const seriesView = (series: TaskSeriesRecord): SeriesView => ({ seriesId: series.seriesId, title: series.title, state: series.state, planNeedsReview: series.planNeedsReview, currentOccurrenceId: series.currentOccurrenceId, revision: series.revision, rule: series.currentRule });
function previewView(series: TaskSeriesRecord, rule: SeriesRule): SeriesPreviewView {
  if (series.state === "stopped") return { status: "not-admitted", reason: series.state };
  const today = todayFor(rule);
  if (today === undefined) return { status: "unreadable", reason: "planning-time-zone-unresolved" };
  const preview = nextOccurrences(rule, today, PREVIEW_DATE_COUNT);
  if (preview.status === "refused") return preview.reason === "end-reached" ? { status: "ended" } : { status: "unreadable", reason: preview.reason };
  return { status: "preview", dates: preview.dates.map(serialiseCivilDate), monthDayResolutions: preview.monthDayResolutions.map((resolution) => ({ dueOn: serialiseCivilDate(resolution.dueOn), requestedDay: resolution.requestedDay, resolvedDay: resolution.resolvedDay })) };
}
function planNeedsReviewNow(series: TaskSeriesRecord, occurrences: readonly TaskRecord[], rule: SeriesRule): boolean {
  if (series.state !== "active") return false;
  const today = todayFor(rule);
  if (today === undefined) return series.planNeedsReview;
  const planned: SeriesOccurrence[] = [];
  let latest: CivilDate | undefined;
  for (const occurrence of occurrences) {
    const dueOn = civilDateOf(occurrence.dueOn);
    if (dueOn === undefined) continue;
    if (latest === undefined || serialiseCivilDate(dueOn) > serialiseCivilDate(latest)) latest = dueOn;
    if (isAwaitingAction(occurrence.status)) planned.push({ dueOn, status: occurrence.status });
  }
  const ahead = nextOccurrences(rule, latest ?? rule.firstDueOn, PLAN_WALK_COUNT);
  if (ahead.status === "preview") for (const date of ahead.dates) if (serialiseCivilDate(date) < serialiseCivilDate(today)) planned.push({ dueOn: date, status: "open" });
  return missedPlan({ rule, occurrences: planned, now: now() }).state === "planNeedsReview";
}
function collectionWitness(family: string, members: readonly { readonly revision: string }[]): string {
  const revisions = members.map((member) => member.revision).toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  let hash = 0x811c9dc5;
  const joined = revisions.join("\u0000");
  for (let index = 0; index < joined.length; index += 1) {
    hash ^= joined.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const digest = (hash >>> 0).toString(16).padStart(8, "0");
  return `${family}/${String(members.length)}/${digest}`;
}
/** The current value one work mutation states for the record it names, absent where the document holds no such record. */
function workTarget<T extends { readonly revision: string }>(docs: MutationContext["docs"], find: (work: WorkDocument) => T | undefined, view: (record: T) => unknown): CurrentTarget {
  const record = find(readWorkDocument(docs.state));
  return record === undefined ? { kind: "absent" } : { kind: "record", revision: record.revision, value: view(record) };
}
const taskTarget = (docs: MutationContext["docs"], taskId: string): CurrentTarget => workTarget(docs, (work) => taskOf(work, taskId), taskView);
const seriesTarget = (docs: MutationContext["docs"], seriesId: string): CurrentTarget => workTarget(docs, (work) => seriesOf(work, seriesId), seriesView);
function lastCompletedDate(occurrences: readonly TaskRecord[]): CivilDate | undefined {
  let latest: CivilDate | undefined;
  for (const occurrence of occurrences) {
    if (occurrence.status !== "completed") continue;
    const dueOn = civilDateOf(occurrence.dueOn);
    if (dueOn === undefined) continue;
    if (latest === undefined || serialiseCivilDate(dueOn) > serialiseCivilDate(latest)) latest = dueOn;
  }
  return latest;
}
export type TaskMutationOptions = { readonly sessionId?: string };
function authorizesOwnWork(session: ResolvedSession, scope: Scope, kind: "task" | "series"): ScopeDecision {
  const decision = canEdit(session, { kind, scope, ownerPrincipalId: session.principalId });
  return decision.allowed ? { ok: true } : { ok: false, denial: decision.denial };
}
type WorkHooks<P, R extends MutationResult> = { readonly readCurrent?: (documents: MutationContext["docs"], payload: P) => CurrentTarget; readonly apply: (context: MutationContext, payload: P) => ApplyResult<R> };
async function runWorkMutation<P, R extends MutationResult>(input: MutationInput<P>, options: TaskMutationOptions | undefined, schema: z.ZodType<P>, name: MutationName, kind: "task" | "series", hooks: WorkHooks<P, R>): Promise<MutationOutcome> {
  const opening = await openMutation(name, input, options?.sessionId === undefined ? undefined : { sessionId: options.sessionId });
  if (!opening.ok) return opening.outcome;
  const parsed = (): P => schema.parse(input.payload);
  return runMutation<P, R>({
    sessionId: opening.sessionId,
    input,
    schema,
    name,
    authorize: (session) => authorizesOwnWork(session, input.scope, kind),
    readCurrent: (documents) => (hooks.readCurrent === undefined ? { kind: "absent" } : hooks.readCurrent(documents, parsed())),
    apply: (context) => hooks.apply(context, parsed()),
  });
}
/** The one record of this caller's own work a mutation names, refused rather than disclosed where the caller does not own it. */
function requireOwned<T extends { readonly ownerPrincipalId: string }>(record: T | undefined, session: ResolvedSession, operationId: string): T {
  if (record === undefined || record.ownerPrincipalId !== session.principalId) return refuseDenied(operationId);
  return record;
}
const requireOwnedTask = (work: WorkDocument, taskId: string, session: ResolvedSession, operationId: string): TaskRecord => requireOwned(taskOf(work, taskId), session, operationId);
const requireOwnedSeries = (work: WorkDocument, seriesId: string, session: ResolvedSession, operationId: string): TaskSeriesRecord => requireOwned(seriesOf(work, seriesId), session, operationId);
function requireOccurrenceSeries(work: WorkDocument, occurrence: TaskRecord, statedSeriesId: string | undefined): TaskSeriesRecord | undefined {
  const series = occurrence.seriesId === null ? undefined : seriesOf(work, occurrence.seriesId);
  return series === undefined || (statedSeriesId !== undefined && statedSeriesId !== series.seriesId) ? undefined : series;
}
/** A trimmed text field that refuses a missing value where one is required and an over-long value at the stated bound, both with the message the field states. */
const boundedText = (missing: string | undefined, tooLong: string, max: number) => {
  const base = missing === undefined ? z.string() : z.string({ error: missing });
  return base.trim().superRefine((value, ctx) => {
    const length = codePointLength(value);
    if (missing !== undefined && length === 0) ctx.addIssue({ code: "custom", message: missing });
    else if (length > max) ctx.addIssue({ code: "custom", message: tooLong });
  });
};
const titleText = boundedText(WORDS.titleRequired, WORDS.titleTooLong, TITLE_MAX_LENGTH);
const categoryText = boundedText(undefined, WORDS.categoryTooLong, CATEGORY_MAX_LENGTH);
const noteText = boundedText(undefined, WORDS.noteTooLong, NOTE_MAX_LENGTH);
const tagText = boundedText(WORDS.tagRequired, WORDS.tagTooLong, TAG_MAX_LENGTH);
const taskIdText = z.string({ error: WORDS.taskIdRequired }).trim().min(1, WORDS.taskIdRequired),
  seriesIdText = z.string({ error: WORDS.seriesIdRequired }).trim().min(1, WORDS.seriesIdRequired);
const occurrenceIdText = z.string({ error: WORDS.occurrenceIdRequired }).trim().min(1, WORDS.occurrenceIdRequired),
  linkText = z.string({ error: WORDS.linkInvalid }).trim().min(1, WORDS.linkInvalid);
const civilDateText = z
  .string({ error: WORDS.dueDateInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") ctx.addIssue({ code: "custom", message: WORDS.dueDateInvalid });
  });
const PLANNED_CLOCK_FORM = /^([01]\d|2[0-3]):[0-5]\d$/u,
  PLANNED_DATE_TIME_FORM = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?$/u;
type PlannedTimeValue = { readonly clock: string; readonly date: string | null };
function plannedTimeOf(value: string): PlannedTimeValue {
  const withDate = PLANNED_DATE_TIME_FORM.exec(value);
  return withDate !== null ? { clock: withDate[2] ?? "00:00", date: withDate[1] ?? null } : { clock: value, date: null };
}
const plannedTimeText = z
  .string({ error: WORDS.plannedTimeInvalid })
  .trim()
  .superRefine((value, ctx) => {
    const withDate = PLANNED_DATE_TIME_FORM.exec(value);
    if (PLANNED_CLOCK_FORM.test(value)) return;
    if (withDate === null || parseCivilDate(withDate[1] ?? "").status === "refused") ctx.addIssue({ code: "custom", message: WORDS.plannedTimeInvalid });
  });
const plannedTimeFieldOf = (value: string | undefined): PlannedTimeValue | undefined => (value === undefined ? undefined : !PLANNED_CLOCK_FORM.test(value) && PLANNED_DATE_TIME_FORM.exec(value) === null ? undefined : plannedTimeOf(value));
const blankToNull = (value: string | null | undefined): string | null => (value === null || value === undefined ? null : value.trim().length === 0 ? null : value);
function isResolvableTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
const timeZoneText = z.string({ error: WORDS.timeZoneInvalid }).trim().min(1, WORDS.timeZoneInvalid).refine(isResolvableTimeZone, WORDS.timeZoneInvalid);
const TASK_KIND_VALUES = ["default", "meeting"] as const satisfies readonly TaskKind[];
const taskKindValue = z.enum(TASK_KIND_VALUES, { error: WORDS.kindInvalid }),
  repeatProfileValue = z.enum(REPEAT_PROFILES, { error: WORDS.profileInvalid });
const intervalValue = z.number({ error: WORDS.intervalRequired }).int(WORDS.intervalRequired).min(1, WORDS.intervalRequired),
  endCountValue = z.number({ error: WORDS.endCountInvalid }).int(WORDS.endCountInvalid).min(1, WORDS.endCountInvalid);
const dayOfMonthValue = z.number({ error: WORDS.dayOfMonthRequired }).int(WORDS.dayOfMonthRequired).min(1, WORDS.dayOfMonthRequired).max(31, WORDS.dayOfMonthRequired);
const seriesEndPayload: z.ZodType<SeriesEndRecord> = z.discriminatedUnion("kind", [z.object({ kind: z.literal("on-date"), on: civilDateText }), z.object({ kind: z.literal("after-count"), count: endCountValue }), z.object({ kind: z.literal("ongoing-personal-policy") })], { error: WORDS.endRequired });
const INTERVAL_PROFILES: ReadonlySet<RepeatProfile> = new Set<RepeatProfile>(["everyNWeeks", "everyNMonths"]);
const DAY_OF_MONTH_PROFILES: ReadonlySet<RepeatProfile> = new Set<RepeatProfile>(["monthlyOnDay", "everyNMonths"]);
const takesInterval = (profile: RepeatProfile): boolean => INTERVAL_PROFILES.has(profile);
const selectionText = z
  .array(taskIdText, { error: WORDS.selectionEmpty })
  .min(1, WORDS.selectionEmpty)
  .max(SELECTION_MAX_LENGTH, WORDS.selectionTooLarge)
  .superRefine((ids, ctx) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) return ctx.addIssue({ code: "custom", message: WORDS.selectionRepeated });
      seen.add(id);
    }
  });
type PlannedPairing = { readonly kind?: TaskKind | undefined; readonly dueOn?: string | null | undefined; readonly plannedTime?: string | null | undefined; readonly timeZone?: string | null | undefined };
function refinePlannedPairing(value: PlannedPairing, ctx: z.RefinementCtx): void {
  const statedTime = value.plannedTime === null ? undefined : plannedTimeFieldOf(value.plannedTime);
  const hasTime = statedTime !== undefined;
  const hasZone = value.timeZone !== undefined && value.timeZone !== null;
  if ((value.kind ?? "default") === "default") {
    if (hasTime || hasZone) ctx.addIssue({ code: "custom", message: WORDS.plannedTimeOnlyForMeeting, path: ["plannedTime"] });
    return;
  }
  if (hasTime && !hasZone) return ctx.addIssue({ code: "custom", message: WORDS.plannedTimeRequiresZone, path: ["timeZone"] });
  if (!hasTime && hasZone) return ctx.addIssue({ code: "custom", message: WORDS.plannedTimeRequiresZone, path: ["plannedTime"] });
  const plannedDay = statedTime?.date ?? null;
  if (plannedDay !== null && value.dueOn !== undefined && value.dueOn !== null) if (plannedDay !== value.dueOn) ctx.addIssue({ code: "custom", message: WORDS.plannedTimeOtherDay, path: ["plannedTime"] });
}
export const createTaskSchema = z
  .strictObject({ title: titleText, category: categoryText.optional(), dueOn: civilDateText.optional(), kind: taskKindValue.optional(), plannedTime: plannedTimeText.optional(), timeZone: timeZoneText.optional(), partnerId: linkText.optional(), initiativeId: linkText.optional(), note: noteText.optional() })
  .superRefine(refinePlannedPairing);
export type CreateTaskPayload = z.infer<typeof createTaskSchema>;
export const editTaskSchema = z
  .strictObject({
    taskId: taskIdText,
    title: titleText.optional(),
    category: z.union([categoryText, z.null()]).optional(),
    dueOn: z.union([civilDateText, z.null()]).optional(),
    kind: taskKindValue.optional(),
    plannedTime: z.union([plannedTimeText, z.null()]).optional(),
    timeZone: z.union([timeZoneText, z.null()]).optional(),
    partnerId: z.union([linkText, z.null()]).optional(),
    initiativeId: z.union([linkText, z.null()]).optional(),
    note: z.union([noteText, z.null()]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== undefined) refinePlannedPairing({ kind: value.kind, dueOn: value.dueOn, plannedTime: value.plannedTime, timeZone: value.timeZone }, ctx);
  });
export type EditTaskPayload = z.infer<typeof editTaskSchema>;
export const completeTaskSchema = z.strictObject({ taskId: taskIdText });
export type CompleteTaskPayload = z.infer<typeof completeTaskSchema>;
export const reopenTaskSchema = z.strictObject({ taskId: taskIdText });
export type ReopenTaskPayload = z.infer<typeof reopenTaskSchema>;
export const cancelTaskSchema = z.strictObject({ taskId: taskIdText, confirmed: z.literal(true, { error: WORDS.cancellationNotConfirmed }) });
export type CancelTaskPayload = z.infer<typeof cancelTaskSchema>;
export const bulkApplyTagSchema = z.strictObject({ taskIds: selectionText, tag: tagText });
export type BulkApplyTagPayload = z.infer<typeof bulkApplyTagSchema>;
export const bulkRemoveTagSchema = z.strictObject({ taskIds: selectionText, tag: tagText });
export type BulkRemoveTagPayload = z.infer<typeof bulkRemoveTagSchema>;
const followUpTemplateSchema = z.strictObject({ title: titleText, category: categoryText.optional(), dueOn: civilDateText.optional(), note: noteText.optional() });
export const bulkCreateTasksSchema = z.strictObject({ taskIds: selectionText, template: followUpTemplateSchema.optional(), draft: followUpTemplateSchema.optional() }).superRefine((value, ctx) => {
  const stated = (value.template === undefined ? 0 : 1) + (value.draft === undefined ? 0 : 1);
  if (stated === 0) {
    ctx.addIssue({ code: "custom", message: WORDS.followUpTemplateRequired, path: ["template"] });
  } else if (stated > 1) ctx.addIssue({ code: "custom", message: WORDS.followUpTemplateAmbiguous, path: ["template"] });
});
export type BulkCreateTasksPayload = z.infer<typeof bulkCreateTasksSchema>;
export const bulkCompleteTasksSchema = z.strictObject({ taskIds: selectionText });
export type BulkCompleteTasksPayload = z.infer<typeof bulkCompleteTasksSchema>;
const resolveCreateEnd = (payload: { readonly end?: SeriesEndRecord | undefined; readonly ongoingPolicy?: true | undefined }): SeriesEndRecord | undefined => (payload.end !== undefined ? payload.end : payload.ongoingPolicy === true ? { kind: "ongoing-personal-policy" } : undefined);
function engineRuleOf(fields: { readonly profile: RepeatProfile; readonly interval?: number | undefined; readonly dayOfMonth?: number | undefined; readonly firstDueOn: string; readonly planningTimeZone: string }, end: SeriesEndRecord): SeriesRule | undefined {
  const firstDueOn = civilDateOf(fields.firstDueOn);
  const engineEnd = toEngineEnd(end);
  if (firstDueOn === undefined || engineEnd === undefined) return undefined;
  const rule: SeriesRule = { profile: fields.profile, interval: fields.interval ?? 1, firstDueOn, planningTimeZone: fields.planningTimeZone, end: engineEnd };
  if (fields.dayOfMonth !== undefined) rule.dayOfMonth = fields.dayOfMonth;
  return rule;
}
type CreateRuleFields = { readonly profile: RepeatProfile; readonly interval?: number | undefined; readonly dayOfMonth?: number | undefined; readonly firstDueOn: string; readonly planningTimeZone: string; readonly end?: SeriesEndRecord | undefined; readonly ongoingPolicy?: true | undefined };
function refineCreateRule(value: CreateRuleFields, ctx: z.RefinementCtx): void {
  if (value.ongoingPolicy === true && value.end !== undefined && value.end.kind !== "ongoing-personal-policy") return ctx.addIssue({ code: "custom", message: WORDS.endAmbiguous, path: ["ongoingPolicy"] });
  const end = resolveCreateEnd(value);
  if (end === undefined) return ctx.addIssue({ code: "custom", message: WORDS.endRequired, path: ["end"] });
  if (!takesInterval(value.profile) && value.interval !== undefined) ctx.addIssue({ code: "custom", message: WORDS.intervalNotApplicable, path: ["interval"] });
  const rule = engineRuleOf(value, end);
  if (rule === undefined) return;
  const validation = validateSeriesRule(rule);
  if (validation.status === "invalid") for (const [field, message] of Object.entries(validation.fields)) ctx.addIssue({ code: "custom", message, path: [field] });
}
function refineStatedRuleFields(value: { readonly profile?: RepeatProfile | undefined; readonly interval?: number | undefined; readonly dayOfMonth?: number | undefined }, ctx: z.RefinementCtx): void {
  const profile = value.profile;
  if (profile === undefined) return;
  if (takesInterval(profile)) {
    if (value.interval === undefined) ctx.addIssue({ code: "custom", message: WORDS.intervalRequired, path: ["interval"] });
  } else if (value.interval !== undefined) ctx.addIssue({ code: "custom", message: WORDS.intervalNotApplicable, path: ["interval"] });
  if (DAY_OF_MONTH_PROFILES.has(profile)) {
    if (value.dayOfMonth === undefined) ctx.addIssue({ code: "custom", message: WORDS.dayOfMonthRequired, path: ["dayOfMonth"] });
  } else if (value.dayOfMonth !== undefined) ctx.addIssue({ code: "custom", message: WORDS.dayOfMonthNotApplicable, path: ["dayOfMonth"] });
}
export const createSeriesSchema = z
  .strictObject({
    title: titleText,
    category: categoryText.optional(),
    note: noteText.optional(),
    profile: repeatProfileValue,
    interval: intervalValue.optional(),
    dayOfMonth: dayOfMonthValue.optional(),
    firstDueOn: civilDateText,
    planningTimeZone: timeZoneText,
    end: seriesEndPayload.optional(),
    ongoingPolicy: z.literal(true, { error: WORDS.endRequired }).optional(),
    partnerId: linkText.optional(),
  })
  .superRefine(refineCreateRule);
export type CreateSeriesPayload = z.infer<typeof createSeriesSchema>;
export const editOccurrenceSchema = z
  .strictObject({
    occurrenceId: occurrenceIdText,
    seriesId: seriesIdText.optional(),
    title: titleText.optional(),
    category: z.union([categoryText, z.null()]).optional(),
    dueOn: z.union([civilDateText, z.null()]).optional(),
    kind: taskKindValue.optional(),
    plannedTime: z.union([plannedTimeText, z.null()]).optional(),
    timeZone: z.union([timeZoneText, z.null()]).optional(),
    note: z.union([noteText, z.null()]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== undefined) refinePlannedPairing({ kind: value.kind, dueOn: value.dueOn, plannedTime: value.plannedTime, timeZone: value.timeZone }, ctx);
  });
export type EditOccurrencePayload = z.infer<typeof editOccurrenceSchema>;
export const editThisAndFutureSchema = z
  .strictObject({
    seriesId: seriesIdText,
    effectiveFrom: civilDateText,
    title: titleText.optional(),
    category: z.union([categoryText, z.null()]).optional(),
    note: z.union([noteText, z.null()]).optional(),
    planningTimeZone: timeZoneText.optional(),
    profile: repeatProfileValue.optional(),
    interval: intervalValue.optional(),
    dayOfMonth: dayOfMonthValue.optional(),
    end: seriesEndPayload.optional(),
  })
  .superRefine(refineStatedRuleFields);
export type EditThisAndFuturePayload = z.infer<typeof editThisAndFutureSchema>;
export const skipOccurrenceSchema = z.strictObject({ occurrenceId: occurrenceIdText, seriesId: seriesIdText.optional() });
export type SkipOccurrencePayload = z.infer<typeof skipOccurrenceSchema>;
export const pauseSeriesSchema = z.strictObject({ seriesId: seriesIdText });
export type PauseSeriesPayload = z.infer<typeof pauseSeriesSchema>;
export const resumeSeriesSchema = z.strictObject({ seriesId: seriesIdText });
export type ResumeSeriesPayload = z.infer<typeof resumeSeriesSchema>;
export const stopSeriesSchema = z.strictObject({ seriesId: seriesIdText, unfinishedWork: z.enum(["keep", "cancel"], { error: WORDS.unfinishedWorkInvalid }).optional() });
export type StopSeriesPayload = z.infer<typeof stopSeriesSchema>;
const RESOLUTION_SPELLINGS = ["keep-this-occurrence", "keep-occurrence", "move-next-date-forward", "move-next-forward", "stop-series"] as const;
type PlanResolution = "keep-this-occurrence" | "move-next-date-forward" | "stop-series";
const CANONICAL_RESOLUTIONS: Readonly<Record<(typeof RESOLUTION_SPELLINGS)[number], PlanResolution>> = {
  "keep-this-occurrence": "keep-this-occurrence",
  "keep-occurrence": "keep-this-occurrence",
  "move-next-date-forward": "move-next-date-forward",
  "move-next-forward": "move-next-date-forward",
  "stop-series": "stop-series",
};
const canonicalResolution = (value: (typeof RESOLUTION_SPELLINGS)[number]): PlanResolution => CANONICAL_RESOLUTIONS[value];
export const resolveMissedPlanSchema = z.strictObject({ occurrenceId: occurrenceIdText, seriesId: seriesIdText.optional(), resolution: z.enum(RESOLUTION_SPELLINGS, { error: WORDS.resolutionRequired }) });
export type ResolveMissedPlanPayload = z.infer<typeof resolveMissedPlanSchema>;
const plannedOrDue = (plannedDay: string | null, dueOn: string | null): string | null => plannedDay ?? dueOn;
type OccurrenceEffect = { readonly work: WorkDocument; readonly ended: TaskRecord; readonly series: TaskSeriesRecord | null; readonly successor: TaskRecord | null };
function endOccurrence(options: { readonly work: WorkDocument; readonly task: TaskRecord; readonly nextStatus: Extract<TaskRecordStatus, "completed" | "cancelled">; readonly ownerPrincipalId: PrincipalId }): OccurrenceEffect {
  const { work, task } = options;
  const ended: TaskRecord = { ...task, status: options.nextStatus, revision: nextRevision(task.revision) };
  const tasks = work.tasks.map((existing) => (existing.taskId === task.taskId ? ended : existing));
  const series = task.seriesId === null ? undefined : seriesOf(work, task.seriesId);
  if (series === undefined) return { work: { ...work, tasks }, ended, series: null, successor: null };
  if (series.ownerPrincipalId !== options.ownerPrincipalId) return { work: { ...work, tasks }, ended, series, successor: null };
  if (series.currentOccurrenceId !== task.taskId) return { work: { ...work, tasks }, ended, series, successor: null };
  const rule = toEngineRule(series.currentRule);
  const occurrence = civilDateOf(task.dueOn) ?? (rule === undefined ? undefined : todayFor(rule));
  if (rule === undefined || occurrence === undefined) return { work: { ...work, tasks }, ended, series, successor: null };
  const admission = admitSuccessor({ rule, occurrence, state: series.state });
  if (admission.status === "refused") {
    const nextSeries: TaskSeriesRecord = admission.reason === "series-ended" ? { ...series, currentOccurrenceId: null, planNeedsReview: false, revision: nextRevision(series.revision) } : series;
    return { work: { ...work, tasks }, ended, series: nextSeries, successor: null };
  }
  const dueOn = serialiseCivilDate(admission.nextDueOn);
  const ownerPrincipalId = series.ownerPrincipalId;
  const taskId = newRecordId("task");
  const successor: TaskRecord = { taskId, title: series.title, category: ended.category, dueOn, plannedTime: null, timeZone: null, kind: "default", status: "open", partnerId: ended.partnerId, initiativeId: ended.initiativeId, seriesId: series.seriesId, ownerPrincipalId, note: ended.note, revision: "rev-1" };
  const withSuccessor = [...tasks, successor];
  const current: TaskSeriesRecord = { ...series, currentOccurrenceId: successor.taskId };
  const sameSeries = withSuccessor.filter((existing) => existing.seriesId === series.seriesId);
  const nextSeries: TaskSeriesRecord = { ...current, planNeedsReview: planNeedsReviewNow(current, sameSeries, rule), revision: nextRevision(series.revision) };
  return { work: { tasks: withSuccessor, series: work.series.map((existing) => (existing.seriesId === series.seriesId ? nextSeries : existing)), taskTags: work.taskTags }, ended, series: nextSeries, successor };
}
type EditableTaskFields = {
  readonly title?: string | undefined;
  readonly category?: string | null | undefined;
  readonly dueOn?: string | null | undefined;
  readonly kind?: TaskKind | undefined;
  readonly plannedTime?: PlannedTimeValue | null | undefined;
  readonly timeZone?: string | null | undefined;
  readonly partnerId?: string | null | undefined;
  readonly initiativeId?: string | null | undefined;
  readonly note?: string | null | undefined;
};
function editableFieldsOf(payload: Omit<EditableTaskFields, "plannedTime"> & { readonly plannedTime?: string | null | undefined }): EditableTaskFields {
  const planned = payload.plannedTime === undefined ? undefined : payload.plannedTime === null ? null : (plannedTimeFieldOf(payload.plannedTime) ?? null);
  const category = payload.category === undefined ? undefined : blankToNull(payload.category);
  return { title: payload.title, category, dueOn: payload.dueOn, kind: payload.kind, plannedTime: planned, timeZone: payload.timeZone, partnerId: payload.partnerId, initiativeId: payload.initiativeId, note: payload.note === undefined ? undefined : blankToNull(payload.note) };
}
function mergedTask(task: TaskRecord, fields: EditableTaskFields, revision: string): TaskRecord {
  const kind = fields.kind ?? task.kind;
  const plannedTime: string | null = kind !== "meeting" ? null : fields.plannedTime === undefined ? task.plannedTime : fields.plannedTime === null ? null : fields.plannedTime.clock;
  const timeZone: string | null = kind !== "meeting" ? null : fields.plannedTime === undefined ? task.timeZone : fields.plannedTime === null ? null : (fields.timeZone ?? task.timeZone);
  const plannedDay = fields.plannedTime === undefined ? null : (fields.plannedTime?.date ?? null);
  return {
    taskId: task.taskId,
    title: fields.title ?? task.title,
    category: fields.category === undefined ? task.category : fields.category,
    dueOn: plannedOrDue(plannedDay, fields.dueOn === undefined ? task.dueOn : fields.dueOn),
    plannedTime,
    timeZone,
    kind,
    status: task.status,
    partnerId: fields.partnerId === undefined ? task.partnerId : fields.partnerId,
    initiativeId: fields.initiativeId === undefined ? task.initiativeId : fields.initiativeId,
    seriesId: task.seriesId,
    ownerPrincipalId: task.ownerPrincipalId,
    note: fields.note === undefined ? task.note : fields.note,
    revision,
  };
}
const COMPARED_TASK_FIELDS = ["title", "category", "dueOn", "plannedTime", "timeZone", "kind", "status", "partnerId", "initiativeId", "note"] as const;
const sameTaskFields = (left: TaskRecord, right: TaskRecord): boolean => COMPARED_TASK_FIELDS.every((field) => left[field] === right[field]);
const BULK_REASONS = {
  notEditable: { code: "not-editable", message: "This row was no longer eligible when the action ran, so it was left as it was." },
  alreadyTagged: { code: "already-tagged", message: "This row already carries that tag, so nothing changed." },
  tagAbsent: { code: "tag-absent", message: "This row does not carry that tag, so nothing changed." },
  tagOwnedElsewhere: { code: "tag-owned-elsewhere", message: "This row carries that tag as another person's private preparation, so it was left as it was." },
  alreadyComplete: { code: "already-complete", message: "This row was already complete, so nothing changed." },
  notOwed: { code: "not-owed", message: "This row was cancelled, so there is nothing here to complete." },
} as const;
function bulkItem(input: { readonly taskId: string; readonly state: BulkItemState; readonly revision?: string | null; readonly createdTaskId?: string | null; readonly reason?: { readonly code: string; readonly message: string } | null }): BulkItemView {
  return { taskId: input.taskId, state: input.state, revision: input.revision ?? null, createdTaskId: input.createdTaskId ?? null, reasonCode: input.reason?.code ?? null, reason: input.reason?.message ?? null };
}
const itemAccepted = (taskId: string, revision: string, createdTaskId?: string): BulkItemView => bulkItem({ taskId, state: "accepted", revision, createdTaskId: createdTaskId ?? null });
const itemUnchanged = (taskId: string, revision: string, reason: { readonly code: string; readonly message: string }): BulkItemView => bulkItem({ taskId, state: "unchanged", revision, reason });
const itemExcluded = (taskId: string, reason: { readonly code: string; readonly message: string }): BulkItemView => bulkItem({ taskId, state: "excluded", reason });
const itemFailed = (taskId: string, reason: { readonly code: string; readonly message: string }): BulkItemView => bulkItem({ taskId, state: "failed", reason });
const perItemOf = (item: BulkItemView): PerItemResult<BulkItemState> => ({ targetId: item.taskId, state: item.state, ...(item.revision === null ? {} : { revision: item.revision }), ...(item.reasonCode === null ? {} : { reasonCode: item.reasonCode }), ...(item.reason === null ? {} : { reason: item.reason }) });
function bulkResult(items: readonly BulkItemView[]): BulkResultView {
  const countOf = (state: BulkItemState): number => items.filter((item) => item.state === state).length;
  return { items, acceptedCount: countOf("accepted"), unchangedCount: countOf("unchanged"), excludedCount: countOf("excluded"), failedCount: countOf("failed"), createdTaskIds: items.flatMap((item) => (item.createdTaskId === null ? [] : [item.createdTaskId])) };
}
const everyRowUnchanged = (items: readonly BulkItemView[]): boolean => items.length > 0 && items.every((item) => item.state === "unchanged");
export type CreateTaskResult = { readonly task: TaskView };
/** Creates one ordinary or meeting task. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const createTask = async (input: MutationInput<CreateTaskPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> => runWorkMutation<CreateTaskPayload, CreateTaskResult>(input, options, createTaskSchema, "createTask", "task", { apply: applyCreateTask });
function applyCreateTask({ docs, session }: MutationContext, payload: CreateTaskPayload): ApplyResult<CreateTaskResult> {
  const work = readWorkDocument(docs.state);
  const planned = plannedTimeFieldOf(payload.plannedTime);
  const task: TaskRecord = {
    taskId: newRecordId("task"),
    title: payload.title,
    category: blankToNull(payload.category),
    dueOn: plannedOrDue(planned?.date ?? null, payload.dueOn ?? null),
    plannedTime: planned?.clock ?? null,
    timeZone: planned === undefined ? null : (payload.timeZone ?? null),
    kind: payload.kind ?? "default",
    status: "open",
    partnerId: payload.partnerId ?? null,
    initiativeId: payload.initiativeId ?? null,
    seriesId: null,
    ownerPrincipalId: session.principalId,
    note: blankToNull(payload.note),
    revision: "rev-1",
  };
  writeWorkDocument(docs, withNewTasks(work, [task]));
  return { changed: true, revision: task.revision, result: { task: taskView(task) }, created: [task.taskId] };
}
export type EditTaskResult = { readonly task: TaskView };
/** Changes whichever editable fields of one task the caller restates. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const editTask = async (input: MutationInput<EditTaskPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<EditTaskPayload, EditTaskResult>(input, options, editTaskSchema, "editTask", "task", { readCurrent: (documents, payload) => taskTarget(documents, payload.taskId), apply: applyEditTask });
function applyEditTask({ docs, session, operationId }: MutationContext, payload: EditTaskPayload): ApplyResult<EditTaskResult> {
  const work = readWorkDocument(docs.state);
  const task = requireOwnedTask(work, payload.taskId, session, operationId);
  const next = mergedTask(task, editableFieldsOf(payload), nextRevision(task.revision));
  if (sameTaskFields(task, next)) return { changed: false };
  writeWorkDocument(docs, withTask(work, next));
  return { changed: true, revision: next.revision, result: { task: taskView(next) }, changedIds: [next.taskId] };
}
export type CompleteTaskResult = { readonly task: TaskView; readonly series: SeriesView | null; readonly successorTaskId: string | null };
/** Marks one task complete. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const completeTask = async (input: MutationInput<CompleteTaskPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<CompleteTaskPayload, CompleteTaskResult>(input, options, completeTaskSchema, "completeTask", "task", { readCurrent: (documents, payload) => taskTarget(documents, payload.taskId), apply: applyCompleteTask });
function applyCompleteTask({ docs, session, operationId }: MutationContext, payload: CompleteTaskPayload): ApplyResult<CompleteTaskResult> {
  const work = readWorkDocument(docs.state);
  const task = requireOwnedTask(work, payload.taskId, session, operationId);
  if (!isAwaitingAction(task.status)) return { changed: false };
  const effect = endOccurrence({ work, task, nextStatus: "completed", ownerPrincipalId: session.principalId });
  writeWorkDocument(docs, effect.work);
  const result = { task: taskView(effect.ended), series: effect.series === null ? null : seriesView(effect.series), successorTaskId: effect.successor?.taskId ?? null };
  return { changed: true, revision: effect.ended.revision, result, changedIds: [effect.ended.taskId], ...(effect.successor === null ? {} : { created: [effect.successor.taskId] }) };
}
export type ReopenTaskResult = { readonly task: TaskView };
/** Reopens a completed or cancelled task. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const reopenTask = async (input: MutationInput<ReopenTaskPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<ReopenTaskPayload, ReopenTaskResult>(input, options, reopenTaskSchema, "reopenTask", "task", { readCurrent: (documents, payload) => taskTarget(documents, payload.taskId), apply: (context, payload) => applyTaskStatusChange(context, payload, "reopened") });
function applyTaskStatusChange(context: MutationContext, payload: ReopenTaskPayload, status: Extract<TaskRecordStatus, "reopened" | "cancelled">): ApplyResult<ReopenTaskResult> {
  const work = readWorkDocument(context.docs.state);
  const task = requireOwnedTask(work, payload.taskId, context.session, context.operationId);
  if (isAwaitingAction(task.status) === (status === "reopened")) return { changed: false };
  const next: TaskRecord = { ...task, status, revision: nextRevision(task.revision) };
  writeWorkDocument(context.docs, withTask(work, next));
  return { changed: true, revision: next.revision, result: { task: taskView(next) }, changedIds: [next.taskId] };
}
export type CancelTaskResult = { readonly task: TaskView };
/** Cancels one open task. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const cancelTask = async (input: MutationInput<CancelTaskPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<CancelTaskPayload, CancelTaskResult>(input, options, cancelTaskSchema, "cancelTask", "task", { readCurrent: (documents, payload) => taskTarget(documents, payload.taskId), apply: (context, payload) => applyTaskStatusChange(context, payload, "cancelled") });
/** Applies one private tag to each selected task. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const bulkApplyTag = async (input: MutationInput<BulkApplyTagPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> => runWorkMutation<BulkApplyTagPayload, BulkResultView>(input, options, bulkApplyTagSchema, "bulkApplyTag", "task", { apply: applyBulkApplyTag });
function applyBulkApplyTag({ docs, session }: MutationContext, payload: BulkApplyTagPayload): ApplyResult<BulkResultView> {
  const work = readWorkDocument(docs.state);
  const items: BulkItemView[] = [];
  const added: TaskTagRecord[] = [];
  for (const taskId of payload.taskIds) {
    const task = taskOf(work, taskId);
    if (task === undefined || task.ownerPrincipalId !== session.principalId) {
      items.push(itemExcluded(taskId, BULK_REASONS.notEditable));
      continue;
    }
    const existing = tagRecordsOf(work, taskId).find((record) => record.tag === payload.tag);
    if (existing !== undefined) {
      items.push(existing.ownerPrincipalId === session.principalId ? itemUnchanged(taskId, task.revision, BULK_REASONS.alreadyTagged) : itemFailed(taskId, BULK_REASONS.tagOwnedElsewhere));
      continue;
    }
    added.push({ taskId, tag: payload.tag, ownerPrincipalId: session.principalId, revision: "rev-1" });
    items.push(itemAccepted(taskId, task.revision));
  }
  if (everyRowUnchanged(items)) return { changed: false };
  const nextWork = withTaskTags(work, [...work.taskTags, ...added]);
  writeWorkDocument(docs, nextWork);
  return { changed: true, revision: collectionWitness("tasks", nextWork.tasks), result: bulkResult(items), items: items.map(perItemOf) };
}
/** Removes one private tag from each selected task. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const bulkRemoveTag = async (input: MutationInput<BulkRemoveTagPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> => runWorkMutation<BulkRemoveTagPayload, BulkResultView>(input, options, bulkRemoveTagSchema, "bulkRemoveTag", "task", { apply: applyBulkRemoveTag });
function applyBulkRemoveTag({ docs, session }: MutationContext, payload: BulkRemoveTagPayload): ApplyResult<BulkResultView> {
  const work = readWorkDocument(docs.state);
  const items: BulkItemView[] = [];
  const removed = new Set<string>();
  for (const taskId of payload.taskIds) {
    const task = taskOf(work, taskId);
    if (task === undefined || task.ownerPrincipalId !== session.principalId) {
      items.push(itemExcluded(taskId, BULK_REASONS.notEditable));
      continue;
    }
    const existing = tagRecordsOf(work, taskId).find((record) => record.tag === payload.tag);
    if (existing === undefined || existing.ownerPrincipalId !== session.principalId) {
      items.push(itemUnchanged(taskId, task.revision, BULK_REASONS.tagAbsent));
      continue;
    }
    removed.add(taskId);
    items.push(itemAccepted(taskId, task.revision));
  }
  if (everyRowUnchanged(items)) return { changed: false };
  const nextWork = withTaskTags(
    work,
    work.taskTags.filter((record) => !(record.tag === payload.tag && removed.has(record.taskId))),
  );
  writeWorkDocument(docs, nextWork);
  return { changed: true, revision: collectionWitness("tasks", nextWork.tasks), result: bulkResult(items), items: items.map(perItemOf) };
}
/** Creates one ordinary follow-up task for each selected row. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const bulkCreateTasks = async (input: MutationInput<BulkCreateTasksPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> => runWorkMutation<BulkCreateTasksPayload, BulkResultView>(input, options, bulkCreateTasksSchema, "bulkCreateTasks", "task", { apply: applyBulkCreateTasks });
function applyBulkCreateTasks({ docs, session }: MutationContext, payload: BulkCreateTasksPayload): ApplyResult<BulkResultView> {
  const template = payload.template ?? payload.draft;
  if (template === undefined) return { changed: false };
  const work = readWorkDocument(docs.state);
  const items: BulkItemView[] = [];
  const created: TaskRecord[] = [];
  for (const taskId of payload.taskIds) {
    const row = taskOf(work, taskId);
    if (row === undefined || row.ownerPrincipalId !== session.principalId) {
      items.push(itemExcluded(taskId, BULK_REASONS.notEditable));
      continue;
    }
    const category = blankToNull(template.category);
    const note = blankToNull(template.note);
    const dueOn = template.dueOn ?? null;
    const followUp: TaskRecord = { taskId: newRecordId("task"), title: template.title, category, dueOn, plannedTime: null, timeZone: null, kind: "default", status: "open", partnerId: row.partnerId, initiativeId: row.initiativeId, seriesId: null, ownerPrincipalId: session.principalId, note, revision: "rev-1" };
    created.push(followUp);
    items.push(itemAccepted(taskId, row.revision, followUp.taskId));
  }
  if (created.length === 0) return { changed: false };
  const nextWork = withNewTasks(work, created);
  writeWorkDocument(docs, nextWork);
  return { changed: true, revision: collectionWitness("tasks", nextWork.tasks), result: bulkResult(items), created: created.map((task) => task.taskId), items: items.map(perItemOf) };
}
/** Completes each selected task that can be completed on its own. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const bulkCompleteTasks = async (input: MutationInput<BulkCompleteTasksPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> => runWorkMutation<BulkCompleteTasksPayload, BulkResultView>(input, options, bulkCompleteTasksSchema, "bulkCompleteTasks", "task", { apply: applyBulkCompleteTasks });
function applyBulkCompleteTasks({ docs, session }: MutationContext, payload: BulkCompleteTasksPayload): ApplyResult<BulkResultView> {
  let work = readWorkDocument(docs.state);
  const items: BulkItemView[] = [];
  const created: string[] = [];
  for (const taskId of payload.taskIds) {
    const row = taskOf(work, taskId);
    if (row === undefined || row.ownerPrincipalId !== session.principalId) {
      items.push(itemExcluded(taskId, BULK_REASONS.notEditable));
      continue;
    }
    if (row.status === "cancelled") {
      items.push(itemExcluded(taskId, BULK_REASONS.notOwed));
      continue;
    }
    if (!isAwaitingAction(row.status)) {
      items.push(itemUnchanged(taskId, row.revision, BULK_REASONS.alreadyComplete));
      continue;
    }
    const effect = endOccurrence({ work, task: row, nextStatus: "completed", ownerPrincipalId: session.principalId });
    work = effect.work;
    if (effect.successor !== null) created.push(effect.successor.taskId);
    items.push(itemAccepted(taskId, effect.ended.revision));
  }
  if (everyRowUnchanged(items)) return { changed: false };
  writeWorkDocument(docs, work);
  return { changed: true, revision: collectionWitness("tasks", work.tasks), result: bulkResult(items), ...(created.length === 0 ? {} : { created }), items: items.map(perItemOf) };
}
export type CreateSeriesResult = { readonly series: SeriesView; readonly occurrence: TaskView; readonly preview: SeriesPreviewView; readonly firstOccurrence: PreviewResolution | null };
function createRuleOf(payload: CreateRuleFields): SeriesRule | undefined {
  const end = resolveCreateEnd(payload);
  if (end === undefined) return undefined;
  const rule = engineRuleOf(payload, end);
  return rule === undefined ? undefined : validateSeriesRule(rule).status === "valid" ? rule : undefined;
}
/** Creates a repeating task: its closed rule, its first rule revision and its one actionable occurrence. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const createSeries = async (input: MutationInput<CreateSeriesPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> => runWorkMutation<CreateSeriesPayload, CreateSeriesResult>(input, options, createSeriesSchema, "createSeries", "series", { apply: applyCreateSeries });
function applyCreateSeries({ docs, session }: MutationContext, payload: CreateSeriesPayload): ApplyResult<CreateSeriesResult> {
  const work = readWorkDocument(docs.state);
  const rule = createRuleOf(payload);
  if (rule === undefined) return { changed: false };
  const firstPreview = nextOccurrences(rule, rule.firstDueOn.year === 1 && rule.firstDueOn.month === 1 && rule.firstDueOn.day === 1 ? rule.firstDueOn : rule.firstDueOn.subtract({ days: 1 }), 1);
  if (firstPreview.status === "refused") return { changed: false };
  const firstDate = firstPreview.dates[0];
  if (firstDate === undefined) return { changed: false };
  const firstResolution = firstPreview.monthDayResolutions[0];
  const seriesId = newRecordId("series");
  const storedRule = toRuleRecord(rule);
  const category = blankToNull(payload.category);
  const dueOn = serialiseCivilDate(firstDate);
  const partnerId = payload.partnerId ?? null;
  const occurrence: TaskRecord = { taskId: newRecordId("task"), title: payload.title, category, dueOn, plannedTime: null, timeZone: null, kind: "default", status: "open", partnerId, initiativeId: null, seriesId, ownerPrincipalId: session.principalId, note: blankToNull(payload.note), revision: "rev-1" };
  const effectiveRevisions = [{ revisionId: newRecordId("series-revision"), effectiveFrom: serialiseCivilDate(rule.firstDueOn), rule: storedRule }];
  const drafted: TaskSeriesRecord = { seriesId, ownerPrincipalId: session.principalId, title: payload.title, currentRule: storedRule, effectiveRevisions, currentOccurrenceId: occurrence.taskId, state: "active", planNeedsReview: false, revision: "rev-1" };
  const series: TaskSeriesRecord = { ...drafted, planNeedsReview: planNeedsReviewNow(drafted, [occurrence], rule) };
  const nextWork: WorkDocument = { tasks: [...work.tasks, occurrence], series: [...work.series, series], taskTags: work.taskTags };
  writeWorkDocument(docs, nextWork);
  const result = { series: seriesView(series), occurrence: taskView(occurrence), preview: previewView(series, rule), firstOccurrence: firstResolution === undefined ? null : { dueOn: serialiseCivilDate(firstResolution.dueOn), requestedDay: firstResolution.requestedDay, resolvedDay: firstResolution.resolvedDay } };
  return { changed: true, revision: series.revision, result, created: [series.seriesId, occurrence.taskId] };
}
export type EditOccurrenceResult = { readonly series: SeriesView; readonly occurrence: TaskView };
/** Changes this one date's own work, leaving the rule and every other date alone. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const editOccurrence = async (input: MutationInput<EditOccurrencePayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<EditOccurrencePayload, EditOccurrenceResult>(input, options, editOccurrenceSchema, "editOccurrence", "series", { readCurrent: (documents, payload) => taskTarget(documents, payload.occurrenceId), apply: applyEditOccurrence });
function applyEditOccurrence({ docs, session, operationId }: MutationContext, payload: EditOccurrencePayload): ApplyResult<EditOccurrenceResult> {
  const work = readWorkDocument(docs.state);
  const occurrence = requireOwnedTask(work, payload.occurrenceId, session, operationId);
  const series = requireOccurrenceSeries(work, occurrence, payload.seriesId);
  if (series === undefined) return { changed: false };
  if (!isAwaitingAction(occurrence.status)) return { changed: false };
  const next = mergedTask(occurrence, editableFieldsOf(payload), nextRevision(occurrence.revision));
  if (sameTaskFields(occurrence, next)) return { changed: false };
  writeWorkDocument(docs, withTask(work, next));
  return { changed: true, revision: next.revision, result: { series: seriesView(series), occurrence: taskView(next) }, changedIds: [next.taskId] };
}
export type EditThisAndFutureResult = { readonly series: SeriesView; readonly occurrence: TaskView | null; readonly effectiveFrom: string; readonly revisionId: string; readonly preview: SeriesPreviewView | null };
/** Revises the plan from an explicit boundary onward, leaving everything before it untouched. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const editThisAndFuture = async (input: MutationInput<EditThisAndFuturePayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<EditThisAndFuturePayload, EditThisAndFutureResult>(input, options, editThisAndFutureSchema, "editThisAndFuture", "series", { readCurrent: (documents, payload) => seriesTarget(documents, payload.seriesId), apply: applyEditThisAndFuture });
function applyEditThisAndFuture({ docs, session, operationId }: MutationContext, payload: EditThisAndFuturePayload): ApplyResult<EditThisAndFutureResult> {
  const work = readWorkDocument(docs.state);
  const series = requireOwnedSeries(work, payload.seriesId, session, operationId);
  if (series.state === "stopped") return { changed: false };
  const effectiveFrom = civilDateOf(payload.effectiveFrom);
  if (effectiveFrom === undefined) return { changed: false };
  const revisions: RuleRevision[] = [];
  for (const record of series.effectiveRevisions) {
    const rule = toEngineRule(record.rule);
    const boundary = civilDateOf(record.effectiveFrom);
    if (rule === undefined || boundary === undefined) return { changed: false };
    revisions.push({ effectiveFrom: boundary, rule });
  }
  const occurrences = occurrencesOf(work, series.seriesId);
  const statedEnd = payload.end === undefined ? undefined : toEngineEnd(payload.end);
  if (payload.end !== undefined && statedEnd === undefined) return { changed: false };
  const patch: SeriesRulePatch = {
    ...(payload.profile === undefined ? {} : { profile: payload.profile }),
    ...(payload.interval === undefined ? {} : { interval: payload.interval }),
    ...(payload.dayOfMonth === undefined ? {} : { dayOfMonth: payload.dayOfMonth }),
    ...(payload.planningTimeZone === undefined ? {} : { planningTimeZone: payload.planningTimeZone }),
    ...(statedEnd === undefined ? {} : { end: statedEnd }),
  };
  const edit = applyThisAndFuture({ revisions, from: effectiveFrom, patch, lastCompletedOn: lastCompletedDate(occurrences) });
  if (edit.status === "refused") return { changed: false };
  const merged = edit.revision.rule;
  if (validateSeriesRule(merged).status === "invalid") return { changed: false };
  const storedRule = toRuleRecord(merged);
  const revisionRecord: SeriesRuleRevisionRecord = { revisionId: newRecordId("series-revision"), effectiveFrom: serialiseCivilDate(edit.revision.effectiveFrom), rule: storedRule };
  const drafted: TaskSeriesRecord = { ...series, title: payload.title ?? series.title, currentRule: storedRule, effectiveRevisions: [...series.effectiveRevisions, revisionRecord] };
  let movedOccurrence: TaskRecord | null = null;
  const current = series.currentOccurrenceId === null ? undefined : taskOf(work, series.currentOccurrenceId);
  if (current !== undefined && isAwaitingAction(current.status) && (payload.category !== undefined || payload.note !== undefined)) {
    movedOccurrence = { ...current, category: payload.category === undefined ? current.category : blankToNull(payload.category), note: payload.note === undefined ? current.note : blankToNull(payload.note), revision: nextRevision(current.revision) };
  }
  const nextSeries: TaskSeriesRecord = { ...drafted, planNeedsReview: planNeedsReviewNow(drafted, occurrences, merged), revision: nextRevision(series.revision) };
  writeWorkDocument(docs, withSeries(movedOccurrence === null ? work : withTask(work, movedOccurrence), nextSeries));
  const result = { series: seriesView(nextSeries), occurrence: movedOccurrence === null ? null : taskView(movedOccurrence), effectiveFrom: revisionRecord.effectiveFrom, revisionId: revisionRecord.revisionId, preview: previewView(nextSeries, merged) };
  return { changed: true, revision: nextSeries.revision, result, created: [revisionRecord.revisionId], changedIds: movedOccurrence === null ? [nextSeries.seriesId] : [nextSeries.seriesId, movedOccurrence.taskId] };
}
export type SkipOccurrenceResult = { readonly series: SeriesView; readonly occurrence: TaskView; readonly successorTaskId: string | null };
/** Answers one date without performing it. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const skipOccurrence = async (input: MutationInput<SkipOccurrencePayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<SkipOccurrencePayload, SkipOccurrenceResult>(input, options, skipOccurrenceSchema, "skipOccurrence", "series", { readCurrent: (documents, payload) => taskTarget(documents, payload.occurrenceId), apply: applySkipOccurrence });
function applySkipOccurrence({ docs, session, operationId }: MutationContext, payload: SkipOccurrencePayload): ApplyResult<SkipOccurrenceResult> {
  const work = readWorkDocument(docs.state);
  const occurrence = requireOwnedTask(work, payload.occurrenceId, session, operationId);
  const series = requireOccurrenceSeries(work, occurrence, payload.seriesId);
  if (series === undefined || series.state !== "active" || series.currentOccurrenceId !== occurrence.taskId) return { changed: false };
  if (!isAwaitingAction(occurrence.status)) return { changed: false };
  const effect = endOccurrence({ work, task: occurrence, nextStatus: "cancelled", ownerPrincipalId: session.principalId });
  writeWorkDocument(docs, effect.work);
  const result = { series: effect.series === null ? seriesView(series) : seriesView(effect.series), occurrence: taskView(effect.ended), successorTaskId: effect.successor?.taskId ?? null };
  return { changed: true, revision: effect.ended.revision, result, changedIds: [effect.ended.taskId], ...(effect.successor === null ? {} : { created: [effect.successor.taskId] }) };
}
export type SeriesStateResult = { readonly series: SeriesView; readonly preview: SeriesPreviewView | null };
function previewFor(series: TaskSeriesRecord): SeriesPreviewView | null {
  const rule = toEngineRule(series.currentRule);
  return rule === undefined ? null : previewView(series, rule);
}
/** Pauses a series. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const pauseSeries = async (input: MutationInput<PauseSeriesPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<PauseSeriesPayload, SeriesStateResult>(input, options, pauseSeriesSchema, "pauseSeries", "series", { readCurrent: (documents, payload) => seriesTarget(documents, payload.seriesId), apply: applyPauseSeries });
function applyPauseSeries({ docs, session, operationId }: MutationContext, payload: PauseSeriesPayload): ApplyResult<SeriesStateResult> {
  const work = readWorkDocument(docs.state);
  const series = requireOwnedSeries(work, payload.seriesId, session, operationId);
  if (series.state !== "active") return { changed: false };
  const paused: TaskSeriesRecord = { ...series, state: "paused", planNeedsReview: false, revision: nextRevision(series.revision) };
  writeWorkDocument(docs, withSeries(work, paused));
  return { changed: true, revision: paused.revision, result: { series: seriesView(paused), preview: previewFor(paused) }, changedIds: [paused.seriesId] };
}
/** Resumes a paused series. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const resumeSeries = async (input: MutationInput<ResumeSeriesPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<ResumeSeriesPayload, SeriesStateResult>(input, options, resumeSeriesSchema, "resumeSeries", "series", { readCurrent: (documents, payload) => seriesTarget(documents, payload.seriesId), apply: applyResumeSeries });
function applyResumeSeries({ docs, session, operationId }: MutationContext, payload: ResumeSeriesPayload): ApplyResult<SeriesStateResult> {
  const work = readWorkDocument(docs.state);
  const series = requireOwnedSeries(work, payload.seriesId, session, operationId);
  if (series.state !== "paused") return { changed: false };
  const rule = toEngineRule(series.currentRule);
  if (rule === undefined) return { changed: false };
  const resumed: TaskSeriesRecord = { ...series, state: "active" };
  const next: TaskSeriesRecord = { ...resumed, planNeedsReview: planNeedsReviewNow(resumed, occurrencesOf(work, series.seriesId), rule), revision: nextRevision(series.revision) };
  writeWorkDocument(docs, withSeries(work, next));
  return { changed: true, revision: next.revision, result: { series: seriesView(next), preview: previewView(next, rule) }, changedIds: [next.seriesId] };
}
export type StopSeriesResult = { readonly series: SeriesView; readonly unfinishedWork: "keep" | "cancel"; readonly keptTaskIds: readonly string[]; readonly cancelledTaskIds: readonly string[] };
/** Stops a series and states what happens to its unfinished work. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const stopSeries = async (input: MutationInput<StopSeriesPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<StopSeriesPayload, StopSeriesResult>(input, options, stopSeriesSchema, "stopSeries", "series", { readCurrent: (documents, payload) => seriesTarget(documents, payload.seriesId), apply: applyStopSeries });
function applyStopSeries({ docs, session, operationId }: MutationContext, payload: StopSeriesPayload): ApplyResult<StopSeriesResult> {
  const work = readWorkDocument(docs.state);
  const series = requireOwnedSeries(work, payload.seriesId, session, operationId);
  if (series.state === "stopped") return { changed: false };
  const unfinishedWork = payload.unfinishedWork ?? "keep";
  const kept: string[] = [];
  const cancelled: string[] = [];
  let nextWork = work;
  for (const occurrence of occurrencesOf(work, series.seriesId)) {
    if (!isAwaitingAction(occurrence.status)) continue;
    if (unfinishedWork === "keep") {
      kept.push(occurrence.taskId);
      continue;
    }
    cancelled.push(occurrence.taskId);
    nextWork = withTask(nextWork, { ...occurrence, status: "cancelled", revision: nextRevision(occurrence.revision) });
  }
  const stopped: TaskSeriesRecord = { ...series, state: "stopped", planNeedsReview: false, revision: nextRevision(series.revision) };
  writeWorkDocument(docs, withSeries(nextWork, stopped));
  return { changed: true, revision: stopped.revision, result: { series: seriesView(stopped), unfinishedWork, keptTaskIds: kept, cancelledTaskIds: cancelled }, changedIds: [stopped.seriesId, ...cancelled] };
}
export type ResolveMissedPlanResult = { readonly series: SeriesView; readonly occurrence: TaskView | null; readonly resolution: PlanResolution; readonly preview: SeriesPreviewView | null };
/** Resolves a series whose plan needs review with one of exactly three acts. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const resolveMissedPlan = async (input: MutationInput<ResolveMissedPlanPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> =>
  runWorkMutation<ResolveMissedPlanPayload, ResolveMissedPlanResult>(input, options, resolveMissedPlanSchema, "resolveMissedPlan", "series", { readCurrent: (documents, payload) => taskTarget(documents, payload.occurrenceId), apply: applyResolveMissedPlan });
function applyResolveMissedPlan({ docs, session, operationId }: MutationContext, payload: ResolveMissedPlanPayload): ApplyResult<ResolveMissedPlanResult> {
  const work = readWorkDocument(docs.state);
  const occurrence = requireOwnedTask(work, payload.occurrenceId, session, operationId);
  const series = requireOccurrenceSeries(work, occurrence, payload.seriesId);
  if (series === undefined || series.state !== "active") return { changed: false };
  const rule = toEngineRule(series.currentRule);
  if (rule === undefined) return { changed: false };
  const resolution = canonicalResolution(payload.resolution);
  if (resolution === "stop-series") {
    const stopped: TaskSeriesRecord = { ...series, state: "stopped", planNeedsReview: false, revision: nextRevision(series.revision) };
    writeWorkDocument(docs, withSeries(work, stopped));
    return { changed: true, revision: stopped.revision, result: { series: seriesView(stopped), occurrence: taskView(occurrence), resolution, preview: null }, changedIds: [stopped.seriesId] };
  }
  if (resolution === "move-next-date-forward") {
    const today = todayFor(rule);
    if (today === undefined) return { changed: false };
    const ahead = nextOccurrences(rule, today, 1);
    const nextDate = ahead.status === "preview" ? ahead.dates[0] : undefined;
    if (nextDate === undefined) return { changed: false };
    const moved: TaskRecord = { ...occurrence, dueOn: serialiseCivilDate(nextDate), revision: nextRevision(occurrence.revision) };
    const movedWork = withTask(work, moved);
    const drafted: TaskSeriesRecord = { ...series, currentOccurrenceId: moved.taskId };
    const next: TaskSeriesRecord = { ...drafted, planNeedsReview: planNeedsReviewNow(drafted, occurrencesOf(movedWork, series.seriesId), rule), revision: nextRevision(series.revision) };
    writeWorkDocument(docs, withSeries(movedWork, next));
    return { changed: true, revision: next.revision, result: { series: seriesView(next), occurrence: taskView(moved), resolution, preview: previewView(next, rule) }, changedIds: [next.seriesId, moved.taskId] };
  }
  const kept: TaskSeriesRecord = { ...series, planNeedsReview: false, revision: nextRevision(series.revision) };
  writeWorkDocument(docs, withSeries(work, kept));
  return { changed: true, revision: kept.revision, result: { series: seriesView(kept), occurrence: taskView(occurrence), resolution, preview: previewView(kept, rule) }, changedIds: [kept.seriesId] };
}
