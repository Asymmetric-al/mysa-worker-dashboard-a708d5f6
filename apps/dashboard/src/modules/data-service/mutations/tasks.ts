/**
 * The seventeen named task and recurring-series mutations: the one write path behind the Work job and
 * the repeat rule that keeps a series useful.
 */
import { z } from "zod";
import { now } from "@/modules/time/clock";
import { parseCivilDate, serialiseCivilDate, todayInZone, type CivilDate } from "@/modules/time/civil";
import {
  REPEAT_PROFILES,
  admitSuccessor,
  applyThisAndFuture,
  missedPlan,
  nextOccurrences,
  validateSeriesRule,
  type RepeatProfile,
  type RuleRevision,
  type SeriesEnd,
  type SeriesOccurrence,
  type SeriesRule,
  type SeriesRulePatch,
  type SeriesState,
} from "@/modules/time/recurrence";
import { canEdit, outcomeOfRefusal, resolveSession, type ResolvedSession, type ScopeDecision } from "../authorize";
import {
  principalIdSchema,
  recordRevisionSchema,
  taskRecordSchema,
  taskSeriesRecordSchema,
  type MutationInput,
  type PrincipalId,
  type Scope,
  type SeriesEndRecord,
  type SeriesRuleRecord,
  type SeriesRuleRevisionRecord,
  type TaskKind,
  type TaskRecord,
  type TaskRecordStatus,
  type TaskSeriesRecord,
} from "../envelope";
import { runMutation, type CurrentTarget, type MutationContext } from "../operations";
import { CORRUPT_DOCUMENT_FAULT, denied, type MutationOutcome, type PerItemResult } from "../outcome";
// Wording this file owns
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
// Small primitives: lengths, identities and revisions
const TITLE_MAX_LENGTH = 200;

const CATEGORY_MAX_LENGTH = 60;

const NOTE_MAX_LENGTH = 2000;

const TAG_MAX_LENGTH = 60;

const SELECTION_MAX_LENGTH = 200;

const PREVIEW_DATE_COUNT = 3;

const PLAN_WALK_COUNT = 12;

function codePointLength(value: string): number {
  return Array.from(value).length;
}
const REVISION_COUNTER = /^rev-(\d+)$/u;

const REVISION_SUFFIX = /~(\d+)$/u;

function nextRevision(current: string): string {
  const counter = REVISION_COUNTER.exec(current);
  if (counter !== null) {
    const counted = Number.parseInt(counter[1] ?? "", 10);
    if (Number.isSafeInteger(counted)) {
      return `rev-${String(counted + 1)}`;
    }
  }
  const suffixed = REVISION_SUFFIX.exec(current);
  if (suffixed !== null) {
    const counted = Number.parseInt(suffixed[1] ?? "", 10);
    if (Number.isSafeInteger(counted)) {
      return `${current.slice(0, current.length - suffixed[0].length)}~${String(counted + 1)}`;
    }
  }
  return `${current}~1`;
}
function newRecordId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
// The stored work document this file writes
/** One private tag applied to a task. */
export type TaskTagRecord = {
  readonly taskId: string;
  readonly tag: string;
  readonly ownerPrincipalId: PrincipalId;
  readonly revision: string;
};
const taskTagRecordSchema: z.ZodType<TaskTagRecord> = z.object({
  taskId: z.string().min(1),
  tag: z.string().min(1),
  ownerPrincipalId: principalIdSchema,
  revision: recordRevisionSchema,
});
const workDocumentSchema = z.object({
  tasks: z.array(taskRecordSchema),
  series: z.array(taskSeriesRecordSchema),
  taskTags: z.array(taskTagRecordSchema).default([]),
});
type WorkDocument = {
  readonly tasks: readonly TaskRecord[];
  readonly series: readonly TaskSeriesRecord[];
  readonly taskTags: readonly TaskTagRecord[];
};
const EMPTY_WORK_DOCUMENT: WorkDocument = { tasks: [], series: [], taskTags: [] };

class UnreadableWorkDocumentError extends Error {
  constructor(subject: string) {
    super(`This session's stored work cannot be read: ${subject}. Nothing was written, because a change applied over a document this build cannot decode would overwrite records it never read.`);
    this.name = CORRUPT_DOCUMENT_FAULT;
    // Keeps `instanceof` working where a built-in subclass is downlevelled past ES2015 semantics.
    Object.setPrototypeOf(this, UnreadableWorkDocumentError.prototype);
  }
}
function readWorkDocument(state: unknown): WorkDocument {
  if (state === undefined || state === null) {
    return EMPTY_WORK_DOCUMENT;
  }
  const decoded = workDocumentSchema.safeParse(state);
  if (!decoded.success) {
    throw new UnreadableWorkDocumentError("the tasks, series and private tags do not decode");
  }
  return decoded.data;
}
function writeWorkDocument(docs: MutationContext["docs"], work: WorkDocument): void {
  const raw: unknown = docs.state;
  const base = isPlainObject(raw) ? raw : {};
  docs.state = {
    ...base,
    tasks: work.tasks,
    series: work.series,
    taskTags: work.taskTags,
  };
}
function isAwaitingAction(status: TaskRecordStatus): boolean {
  return status === "open" || status === "reopened";
}
function taskOf(work: WorkDocument, taskId: string): TaskRecord | undefined {
  return work.tasks.find((task) => task.taskId === taskId);
}
function seriesOf(work: WorkDocument, seriesId: string): TaskSeriesRecord | undefined {
  return work.series.find((series) => series.seriesId === seriesId);
}
function occurrencesOf(work: WorkDocument, seriesId: string): readonly TaskRecord[] {
  return work.tasks.filter((task) => task.seriesId === seriesId);
}
function tagRecordsOf(work: WorkDocument, taskId: string): readonly TaskTagRecord[] {
  return work.taskTags.filter((tag) => tag.taskId === taskId);
}
function withTask(work: WorkDocument, task: TaskRecord): WorkDocument {
  return {
    tasks: work.tasks.map((existing) => (existing.taskId === task.taskId ? task : existing)),
    series: work.series,
    taskTags: work.taskTags,
  };
}
function withNewTasks(work: WorkDocument, tasks: readonly TaskRecord[]): WorkDocument {
  return { tasks: [...work.tasks, ...tasks], series: work.series, taskTags: work.taskTags };
}
function withSeries(work: WorkDocument, series: TaskSeriesRecord): WorkDocument {
  return {
    tasks: work.tasks,
    series: work.series.map((existing) => (existing.seriesId === series.seriesId ? series : existing)),
    taskTags: work.taskTags,
  };
}
function withTaskTags(work: WorkDocument, taskTags: readonly TaskTagRecord[]): WorkDocument {
  return { tasks: work.tasks, series: work.series, taskTags };
}
// Rules, as the engine reads them and as the document stores them
function toEngineEnd(end: SeriesEndRecord): SeriesEnd | undefined {
  switch (end.kind) {
    case "on-date": {
      const on = parseCivilDate(end.on);
      return on.status === "parsed" ? { kind: "on-date", on: on.date } : undefined;
    }
    case "after-count":
      return { kind: "after-count", count: end.count };
    case "ongoing-personal-policy":
      return { kind: "ongoing-personal-policy" };
  }
}
function toEngineRule(record: SeriesRuleRecord): SeriesRule | undefined {
  const firstDueOn = parseCivilDate(record.firstDueOn);
  if (firstDueOn.status === "refused") {
    return undefined;
  }
  const engineEnd = toEngineEnd(record.end);
  if (engineEnd === undefined) {
    return undefined;
  }
  const rule: SeriesRule = {
    profile: record.profile,
    interval: record.interval,
    firstDueOn: firstDueOn.date,
    planningTimeZone: record.planningTimeZone,
    end: engineEnd,
  };
  if (record.dayOfMonth !== null) {
    rule.dayOfMonth = record.dayOfMonth;
  }
  return rule;
}
function toRuleRecord(rule: SeriesRule): SeriesRuleRecord {
  const end = rule.end;
  let storedEnd: SeriesEndRecord;
  switch (end.kind) {
    case "on-date":
      storedEnd = { kind: "on-date", on: serialiseCivilDate(end.on) };
      break;
    case "after-count":
      storedEnd = { kind: "after-count", count: end.count };
      break;
    case "ongoing-personal-policy":
      storedEnd = { kind: "ongoing-personal-policy" };
      break;
  }
  return {
    profile: rule.profile,
    interval: rule.interval,
    dayOfMonth: rule.dayOfMonth ?? null,
    firstDueOn: serialiseCivilDate(rule.firstDueOn),
    planningTimeZone: rule.planningTimeZone,
    end: storedEnd,
  };
}
function civilDateOf(value: string | null): CivilDate | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : undefined;
}
function todayFor(rule: SeriesRule): CivilDate | undefined {
  const resolved = todayInZone(rule.planningTimeZone, now());
  return resolved.status === "resolved" ? resolved.date : undefined;
}
// The views a mutation answers with, and the ones a replay returns verbatim
/** One task as a mutation reports it: the stored fields, and nothing derived. */
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
/** One series' rule as a mutation reports it, in the stored form a surface reads. */
export type SeriesRuleView = {
  readonly profile: RepeatProfile;
  readonly interval: number;
  readonly dayOfMonth: number | null;
  readonly firstDueOn: string;
  readonly planningTimeZone: string;
  readonly end: SeriesEndRecord;
};
/** One series as a mutation reports it. */
export type SeriesView = {
  readonly seriesId: string;
  readonly title: string;
  readonly state: SeriesState;
  readonly planNeedsReview: boolean;
  readonly currentOccurrenceId: string | null;
  readonly revision: string;
  readonly rule: SeriesRuleView;
};
/** A month-day resolution the plan had to make, so a moved date is never moved silently. */
export type PreviewResolution = {
  readonly dueOn: string;
  readonly requestedDay: number;
  readonly resolvedDay: number;
};
/** What a rule would produce next, as a preview. */
export type SeriesPreviewView =
  | {
      readonly status: "preview";
      readonly dates: readonly string[];
      readonly monthDayResolutions: readonly PreviewResolution[];
    }
  | { readonly status: "ended" }
  | { readonly status: "unreadable"; readonly reason: string }
  | { readonly status: "not-admitted"; readonly reason: SeriesState };
/** One row's result from a bulk action: the closed four-word vocabulary, never an aggregate. */
export type BulkItemState = "accepted" | "unchanged" | "excluded" | "failed";
/** One row's result, with the created task named where the action created one. */
export type BulkItemView = {
  readonly taskId: string;
  readonly state: BulkItemState;
  readonly revision: string | null;
  readonly createdTaskId: string | null;
  readonly reasonCode: string | null;
  readonly reason: string | null;
};
/** A bulk action's answer: one result per selected row, and counts derived from those results. */
export type BulkResultView = {
  readonly items: readonly BulkItemView[];
  readonly acceptedCount: number;
  readonly unchangedCount: number;
  readonly excludedCount: number;
  readonly failedCount: number;
  readonly createdTaskIds: readonly string[];
};
function taskView(task: TaskRecord): TaskView {
  return {
    taskId: task.taskId,
    title: task.title,
    category: task.category,
    dueOn: task.dueOn,
    plannedTime: task.plannedTime,
    timeZone: task.timeZone,
    kind: task.kind,
    status: task.status,
    partnerId: task.partnerId,
    initiativeId: task.initiativeId,
    seriesId: task.seriesId,
    note: task.note,
    revision: task.revision,
  };
}
function seriesView(series: TaskSeriesRecord): SeriesView {
  return {
    seriesId: series.seriesId,
    title: series.title,
    state: series.state,
    planNeedsReview: series.planNeedsReview,
    currentOccurrenceId: series.currentOccurrenceId,
    revision: series.revision,
    rule: series.currentRule,
  };
}
function previewView(series: TaskSeriesRecord, rule: SeriesRule): SeriesPreviewView {
  if (series.state === "stopped") {
    return { status: "not-admitted", reason: series.state };
  }
  const today = todayFor(rule);
  if (today === undefined) {
    return { status: "unreadable", reason: "planning-time-zone-unresolved" };
  }
  const preview = nextOccurrences(rule, today, PREVIEW_DATE_COUNT);
  if (preview.status === "refused") {
    return preview.reason === "end-reached" ? { status: "ended" } : { status: "unreadable", reason: preview.reason };
  }
  return {
    status: "preview",
    dates: preview.dates.map(serialiseCivilDate),
    monthDayResolutions: preview.monthDayResolutions.map((resolution) => ({
      dueOn: serialiseCivilDate(resolution.dueOn),
      requestedDay: resolution.requestedDay,
      resolvedDay: resolution.resolvedDay,
    })),
  };
}
function planNeedsReviewNow(series: TaskSeriesRecord, occurrences: readonly TaskRecord[], rule: SeriesRule): boolean {
  if (series.state !== "active") {
    return false;
  }
  const today = todayFor(rule);
  if (today === undefined) {
    return series.planNeedsReview;
  }
  const planned: SeriesOccurrence[] = [];
  let latest: CivilDate | undefined;
  for (const occurrence of occurrences) {
    const dueOn = civilDateOf(occurrence.dueOn);
    if (dueOn === undefined) {
      continue;
    }
    if (latest === undefined || serialiseCivilDate(dueOn) > serialiseCivilDate(latest)) {
      latest = dueOn;
    }
    if (isAwaitingAction(occurrence.status)) {
      planned.push({ dueOn, status: occurrence.status });
    }
  }
  const ahead = nextOccurrences(rule, latest ?? rule.firstDueOn, PLAN_WALK_COUNT);
  if (ahead.status === "preview") {
    for (const date of ahead.dates) {
      if (serialiseCivilDate(date) < serialiseCivilDate(today)) {
        planned.push({ dueOn: date, status: "open" });
      }
    }
  }
  const review = missedPlan({ rule, occurrences: planned, now: now() });
  return review.state === "planNeedsReview";
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
function taskTarget(docs: MutationContext["docs"], taskId: string): CurrentTarget {
  const work = readWorkDocument(docs.state);
  const task = taskOf(work, taskId);
  return task === undefined ? { kind: "absent" } : { kind: "record", revision: task.revision, value: taskView(task) };
}
function seriesTarget(docs: MutationContext["docs"], seriesId: string): CurrentTarget {
  const work = readWorkDocument(docs.state);
  const series = seriesOf(work, seriesId);
  return series === undefined ? { kind: "absent" } : { kind: "record", revision: series.revision, value: seriesView(series) };
}
function lastCompletedDate(occurrences: readonly TaskRecord[]): CivilDate | undefined {
  let latest: CivilDate | undefined;
  for (const occurrence of occurrences) {
    if (occurrence.status !== "completed") {
      continue;
    }
    const dueOn = civilDateOf(occurrence.dueOn);
    if (dueOn === undefined) {
      continue;
    }
    if (latest === undefined || serialiseCivilDate(dueOn) > serialiseCivilDate(latest)) {
      latest = dueOn;
    }
  }
  return latest;
}
// Opening one mutation: the session it acts for, then the runner
/** What a caller may add to a mutation call beyond the four-field input. */
export type TaskMutationOptions = {
  readonly sessionId?: string;
};
type MutationOpening = { readonly ok: true; readonly sessionId: string } | { readonly ok: false; readonly outcome: MutationOutcome };

function attemptIdentityOf(input: unknown): string {
  if (typeof input !== "object" || input === null) {
    return "unidentified-attempt";
  }
  const candidate: unknown = Reflect.get(input, "operationId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : "unidentified-attempt";
}
async function openMutation(input: unknown, options: TaskMutationOptions | undefined): Promise<MutationOpening> {
  const operationId = attemptIdentityOf(input);
  try {
    const resolution = await resolveSession(options?.sessionId === undefined ? undefined : { sessionId: options.sessionId });
    return resolution.ok ? { ok: true, sessionId: resolution.session.sessionId } : { ok: false, outcome: outcomeOfRefusal(resolution.refusal, operationId) };
  } catch {
    // Naming a session directly is refused outside a development build, and a request with no
    // request scope has no cookie: neither becomes a session by being asked for again.
    return { ok: false, outcome: denied({ operationId, reasonCode: "session-unavailable" }) };
  }
}
function payloadOf<P>(schema: z.ZodType<P>, input: MutationInput<P>): P {
  return schema.parse(input.payload);
}
function authorizesOwnWork(session: ResolvedSession, scope: Scope, kind: "task" | "series"): ScopeDecision {
  const decision = canEdit(session, { kind, scope, ownerPrincipalId: session.principalId });
  return decision.allowed ? { ok: true } : { ok: false, denial: decision.denial };
}
function refuseDenied(operationId: string): { readonly refused: MutationOutcome } {
  return { refused: denied({ operationId, reasonCode: "no-permission" }) };
}
// Payload primitives
const titleText = z
  .string({ error: WORDS.titleRequired })
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointLength(value);
    if (length === 0) {
      ctx.addIssue({ code: "custom", message: WORDS.titleRequired });
    } else if (length > TITLE_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: WORDS.titleTooLong });
    }
  });
const categoryText = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > CATEGORY_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: WORDS.categoryTooLong });
    }
  });
const noteText = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > NOTE_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: WORDS.noteTooLong });
    }
  });
const tagText = z
  .string({ error: WORDS.tagRequired })
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointLength(value);
    if (length === 0) {
      ctx.addIssue({ code: "custom", message: WORDS.tagRequired });
    } else if (length > TAG_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: WORDS.tagTooLong });
    }
  });
const taskIdText = z.string({ error: WORDS.taskIdRequired }).trim().min(1, WORDS.taskIdRequired);

const seriesIdText = z.string({ error: WORDS.seriesIdRequired }).trim().min(1, WORDS.seriesIdRequired);

const occurrenceIdText = z.string({ error: WORDS.occurrenceIdRequired }).trim().min(1, WORDS.occurrenceIdRequired);

const linkText = z.string({ error: WORDS.linkInvalid }).trim().min(1, WORDS.linkInvalid);

const civilDateText = z
  .string({ error: WORDS.dueDateInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom", message: WORDS.dueDateInvalid });
    }
  });
const PLANNED_CLOCK_FORM = /^([01]\d|2[0-3]):[0-5]\d$/u;
const PLANNED_DATE_TIME_FORM = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?$/u;

type PlannedTimeValue = {
  readonly clock: string;
  readonly date: string | null;
};
function plannedTimeOf(value: string): PlannedTimeValue {
  const withDate = PLANNED_DATE_TIME_FORM.exec(value);
  if (withDate !== null) {
    return { clock: withDate[2] ?? "00:00", date: withDate[1] ?? null };
  }
  return { clock: value, date: null };
}
const plannedTimeText = z
  .string({ error: WORDS.plannedTimeInvalid })
  .trim()
  .superRefine((value, ctx) => {
    const withDate = PLANNED_DATE_TIME_FORM.exec(value);
    if (PLANNED_CLOCK_FORM.test(value)) {
      return;
    }
    if (withDate === null || parseCivilDate(withDate[1] ?? "").status === "refused") {
      ctx.addIssue({ code: "custom", message: WORDS.plannedTimeInvalid });
    }
  });
function plannedTimeFieldOf(value: string | undefined): PlannedTimeValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!PLANNED_CLOCK_FORM.test(value) && PLANNED_DATE_TIME_FORM.exec(value) === null) {
    return undefined;
  }
  return plannedTimeOf(value);
}
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value.trim().length === 0 ? null : value;
}
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

const taskKindValue = z.enum(TASK_KIND_VALUES, { error: WORDS.kindInvalid });

const repeatProfileValue = z.enum(REPEAT_PROFILES, { error: WORDS.profileInvalid });

const intervalValue = z.number({ error: WORDS.intervalRequired }).int(WORDS.intervalRequired).min(1, WORDS.intervalRequired);

const dayOfMonthValue = z.number({ error: WORDS.dayOfMonthRequired }).int(WORDS.dayOfMonthRequired).min(1, WORDS.dayOfMonthRequired).max(31, WORDS.dayOfMonthRequired);

const endCountValue = z.number({ error: WORDS.endCountInvalid }).int(WORDS.endCountInvalid).min(1, WORDS.endCountInvalid);

const seriesEndPayload: z.ZodType<SeriesEndRecord> = z.discriminatedUnion(
  "kind",
  [z.object({ kind: z.literal("on-date"), on: civilDateText }), z.object({ kind: z.literal("after-count"), count: endCountValue }), z.object({ kind: z.literal("ongoing-personal-policy") })],
  { error: WORDS.endRequired },
);
const INTERVAL_PROFILES: ReadonlySet<RepeatProfile> = new Set<RepeatProfile>(["everyNWeeks", "everyNMonths"]);
const DAY_OF_MONTH_PROFILES: ReadonlySet<RepeatProfile> = new Set<RepeatProfile>(["monthlyOnDay", "everyNMonths"]);

function takesInterval(profile: RepeatProfile): boolean {
  return INTERVAL_PROFILES.has(profile);
}
function takesDayOfMonth(profile: RepeatProfile): boolean {
  return DAY_OF_MONTH_PROFILES.has(profile);
}
const selectionText = z
  .array(taskIdText, { error: WORDS.selectionEmpty })
  .min(1, WORDS.selectionEmpty)
  .max(SELECTION_MAX_LENGTH, WORDS.selectionTooLarge)
  .superRefine((ids, ctx) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        ctx.addIssue({ code: "custom", message: WORDS.selectionRepeated });
        return;
      }
      seen.add(id);
    }
  });
// The planned-time rule every task payload shares
type PlannedPairing = {
  readonly kind?: TaskKind | undefined;
  readonly dueOn?: string | null | undefined;
  readonly plannedTime?: string | null | undefined;
  readonly timeZone?: string | null | undefined;
};
function refinePlannedPairing(value: PlannedPairing, ctx: z.RefinementCtx): void {
  const statedTime = value.plannedTime === null ? undefined : plannedTimeFieldOf(value.plannedTime);
  const hasTime = statedTime !== undefined;
  const hasZone = value.timeZone !== undefined && value.timeZone !== null;
  // An unstated kind is ordinary work, which is the state a create without a kind starts in.
  if ((value.kind ?? "default") === "default") {
    if (hasTime || hasZone) {
      ctx.addIssue({
        code: "custom",
        message: WORDS.plannedTimeOnlyForMeeting,
        path: ["plannedTime"],
      });
    }
    return;
  }
  if (hasTime && !hasZone) {
    ctx.addIssue({ code: "custom", message: WORDS.plannedTimeRequiresZone, path: ["timeZone"] });
    return;
  }
  if (!hasTime && hasZone) {
    ctx.addIssue({ code: "custom", message: WORDS.plannedTimeRequiresZone, path: ["plannedTime"] });
    return;
  }
  const plannedDay = statedTime?.date ?? null;
  if (plannedDay !== null && value.dueOn !== undefined && value.dueOn !== null) {
    if (plannedDay !== value.dueOn) {
      ctx.addIssue({ code: "custom", message: WORDS.plannedTimeOtherDay, path: ["plannedTime"] });
    }
  }
}
// createTask
/** The `createTask` payload: every field but the title is optional. */
export const createTaskSchema = z
  .strictObject({
    title: titleText,
    category: categoryText.optional(),
    dueOn: civilDateText.optional(),
    kind: taskKindValue.optional(),
    plannedTime: plannedTimeText.optional(),
    timeZone: timeZoneText.optional(),
    partnerId: linkText.optional(),
    initiativeId: linkText.optional(),
    note: noteText.optional(),
  })
  .superRefine(refinePlannedPairing);
/** The validated `createTask` payload. */
export type CreateTaskPayload = z.infer<typeof createTaskSchema>;
// editTask
/** The `editTask` payload: the task, plus whichever editable fields the caller restates. */
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
    if (value.kind !== undefined) {
      refinePlannedPairing(
        {
          kind: value.kind,
          dueOn: value.dueOn,
          plannedTime: value.plannedTime,
          timeZone: value.timeZone,
        },
        ctx,
      );
    }
  });
/** The validated `editTask` payload. */
export type EditTaskPayload = z.infer<typeof editTaskSchema>;
// completeTask, reopenTask and cancelTask
/** The `completeTask` payload: an identifier and nothing else. */
export const completeTaskSchema = z.strictObject({ taskId: taskIdText });
/** The validated `completeTask` payload. */
export type CompleteTaskPayload = z.infer<typeof completeTaskSchema>;
/** The `reopenTask` payload: the same identifier and nothing else, because reopening is its own act. */
export const reopenTaskSchema = z.strictObject({ taskId: taskIdText });
/** The validated `reopenTask` payload. */
export type ReopenTaskPayload = z.infer<typeof reopenTaskSchema>;
/** The `cancelTask` payload: the task, and the confirmation its deliberate act must carry. */
export const cancelTaskSchema = z.strictObject({
  taskId: taskIdText,
  confirmed: z.literal(true, { error: WORDS.cancellationNotConfirmed }),
});
/** The validated `cancelTask` payload. */
export type CancelTaskPayload = z.infer<typeof cancelTaskSchema>;
// The four bulk actions
/** One private tag added to every selected row. */
export const bulkApplyTagSchema = z.strictObject({
  taskIds: selectionText,
  tag: tagText,
});
/** The validated `bulkApplyTag` payload. */
export type BulkApplyTagPayload = z.infer<typeof bulkApplyTagSchema>;
/** The same selection and the same tag rule in the other direction. */
export const bulkRemoveTagSchema = z.strictObject({
  taskIds: selectionText,
  tag: tagText,
});
/** The validated `bulkRemoveTag` payload. */
export type BulkRemoveTagPayload = z.infer<typeof bulkRemoveTagSchema>;

const followUpTemplateSchema = z.strictObject({
  title: titleText,
  category: categoryText.optional(),
  dueOn: civilDateText.optional(),
  note: noteText.optional(),
});
/** The `bulkCreateTasks` payload: the selection plus the follow-up template repeated once per row. */
export const bulkCreateTasksSchema = z
  .strictObject({
    taskIds: selectionText,
    template: followUpTemplateSchema.optional(),
    draft: followUpTemplateSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const stated = (value.template === undefined ? 0 : 1) + (value.draft === undefined ? 0 : 1);
    if (stated === 0) {
      ctx.addIssue({ code: "custom", message: WORDS.followUpTemplateRequired, path: ["template"] });
    } else if (stated > 1) {
      ctx.addIssue({
        code: "custom",
        message: WORDS.followUpTemplateAmbiguous,
        path: ["template"],
      });
    }
  });
/** The validated `bulkCreateTasks` payload. */
export type BulkCreateTasksPayload = z.infer<typeof bulkCreateTasksSchema>;
/** The `bulkCompleteTasks` payload: the rows to complete, and nothing else to claim about them. */
export const bulkCompleteTasksSchema = z.strictObject({ taskIds: selectionText });
/** The validated `bulkCompleteTasks` payload. */
export type BulkCompleteTasksPayload = z.infer<typeof bulkCompleteTasksSchema>;
// Assembling a rule from a payload, and the two refinements that judge one
function resolveCreateEnd(payload: { readonly end?: SeriesEndRecord | undefined; readonly ongoingPolicy?: true | undefined }): SeriesEndRecord | undefined {
  if (payload.end !== undefined) {
    return payload.end;
  }
  return payload.ongoingPolicy === true ? { kind: "ongoing-personal-policy" } : undefined;
}
function engineRuleOf(
  fields: {
    readonly profile: RepeatProfile;
    readonly interval?: number | undefined;
    readonly dayOfMonth?: number | undefined;
    readonly firstDueOn: string;
    readonly planningTimeZone: string;
  },
  end: SeriesEndRecord,
): SeriesRule | undefined {
  const firstDueOn = civilDateOf(fields.firstDueOn);
  if (firstDueOn === undefined) {
    return undefined;
  }
  let engineEnd: SeriesEnd;
  switch (end.kind) {
    case "on-date": {
      const on = civilDateOf(end.on);
      if (on === undefined) {
        return undefined;
      }
      engineEnd = { kind: "on-date", on };
      break;
    }
    case "after-count":
      engineEnd = { kind: "after-count", count: end.count };
      break;
    case "ongoing-personal-policy":
      engineEnd = { kind: "ongoing-personal-policy" };
      break;
  }
  const rule: SeriesRule = {
    profile: fields.profile,
    // A profile that reads no interval still stores one, exactly as the seed's rules do: the engine
    // ignores it, and a stored number that no profile reads is not a decision anybody made twice.
    interval: fields.interval ?? 1,
    firstDueOn,
    planningTimeZone: fields.planningTimeZone,
    end: engineEnd,
  };
  if (fields.dayOfMonth !== undefined) {
    rule.dayOfMonth = fields.dayOfMonth;
  }
  return rule;
}
type CreateRuleFields = {
  readonly profile: RepeatProfile;
  readonly interval?: number | undefined;
  readonly dayOfMonth?: number | undefined;
  readonly firstDueOn: string;
  readonly planningTimeZone: string;
  readonly end?: SeriesEndRecord | undefined;
  readonly ongoingPolicy?: true | undefined;
};
function refineCreateRule(value: CreateRuleFields, ctx: z.RefinementCtx): void {
  const ambiguous = value.ongoingPolicy === true && value.end !== undefined && value.end.kind !== "ongoing-personal-policy";
  if (ambiguous) {
    ctx.addIssue({ code: "custom", message: WORDS.endAmbiguous, path: ["ongoingPolicy"] });
    return;
  }
  const end = resolveCreateEnd(value);
  if (end === undefined) {
    ctx.addIssue({ code: "custom", message: WORDS.endRequired, path: ["end"] });
    return;
  }
  // An interval belongs to the two "every N" profiles. The engine ignores an interval its profile does
  // not read, so a stated interval on any other profile is refused here rather than stored as a number
  // nobody chose: a weekly plan carrying an interval would read as a repeat the worker never asked for.
  if (!takesInterval(value.profile) && value.interval !== undefined) {
    ctx.addIssue({ code: "custom", message: WORDS.intervalNotApplicable, path: ["interval"] });
  }
  const rule = engineRuleOf(value, end);
  if (rule === undefined) {
    return;
  }
  const validation = validateSeriesRule(rule);
  if (validation.status === "invalid") {
    for (const [field, message] of Object.entries(validation.fields)) {
      ctx.addIssue({ code: "custom", message, path: [field] });
    }
  }
}
function refineStatedRuleFields(
  value: {
    readonly profile?: RepeatProfile | undefined;
    readonly interval?: number | undefined;
    readonly dayOfMonth?: number | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const profile = value.profile;
  if (profile === undefined) {
    return;
  }
  if (takesInterval(profile)) {
    if (value.interval === undefined) {
      ctx.addIssue({ code: "custom", message: WORDS.intervalRequired, path: ["interval"] });
    }
  } else if (value.interval !== undefined) {
    ctx.addIssue({ code: "custom", message: WORDS.intervalNotApplicable, path: ["interval"] });
  }
  if (takesDayOfMonth(profile)) {
    if (value.dayOfMonth === undefined) {
      ctx.addIssue({ code: "custom", message: WORDS.dayOfMonthRequired, path: ["dayOfMonth"] });
    }
  } else if (value.dayOfMonth !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: WORDS.dayOfMonthNotApplicable,
      path: ["dayOfMonth"],
    });
  }
}
// createSeries
/** The `createSeries` payload: a title, the closed repeat rule, and the dates the rule counts from. */
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
/** The validated `createSeries` payload. */
export type CreateSeriesPayload = z.infer<typeof createSeriesSchema>;
// editOccurrence
/** The `editOccurrence` payload: this one date's own work, and no rule field at all. */
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
    if (value.kind !== undefined) {
      refinePlannedPairing(
        {
          kind: value.kind,
          dueOn: value.dueOn,
          plannedTime: value.plannedTime,
          timeZone: value.timeZone,
        },
        ctx,
      );
    }
  });
/** The validated `editOccurrence` payload. */
export type EditOccurrencePayload = z.infer<typeof editOccurrenceSchema>;
// editThisAndFuture
/** The `editThisAndFuture` payload: a prospective boundary plus the rule fields the edit restates. */
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
/** The validated `editThisAndFuture` payload. */
export type EditThisAndFuturePayload = z.infer<typeof editThisAndFutureSchema>;
// skipOccurrence
/** The `skipOccurrence` payload: one occurrence and nothing else. */
export const skipOccurrenceSchema = z.strictObject({
  occurrenceId: occurrenceIdText,
  seriesId: seriesIdText.optional(),
});
/** The validated `skipOccurrence` payload. */
export type SkipOccurrencePayload = z.infer<typeof skipOccurrenceSchema>;
// pauseSeries, resumeSeries and stopSeries
/** The `pauseSeries` payload: an identifier and nothing else. */
export const pauseSeriesSchema = z.strictObject({ seriesId: seriesIdText });
/** The validated `pauseSeries` payload. */
export type PauseSeriesPayload = z.infer<typeof pauseSeriesSchema>;
/** The `resumeSeries` payload: the same identifier, because resuming restates nothing. */
export const resumeSeriesSchema = z.strictObject({ seriesId: seriesIdText });
/** The validated `resumeSeries` payload. */
export type ResumeSeriesPayload = z.infer<typeof resumeSeriesSchema>;
/** The `stopSeries` payload: the series, and what becomes of the work it leaves behind. */
export const stopSeriesSchema = z.strictObject({
  seriesId: seriesIdText,
  unfinishedWork: z.enum(["keep", "cancel"], { error: WORDS.unfinishedWorkInvalid }).optional(),
});
/** The validated `stopSeries` payload. */
export type StopSeriesPayload = z.infer<typeof stopSeriesSchema>;
// resolveMissedPlan
const RESOLUTION_SPELLINGS = ["keep-this-occurrence", "keep-occurrence", "move-next-date-forward", "move-next-forward", "stop-series"] as const;

type PlanResolution = "keep-this-occurrence" | "move-next-date-forward" | "stop-series";

function canonicalResolution(value: (typeof RESOLUTION_SPELLINGS)[number]): PlanResolution {
  switch (value) {
    case "keep-this-occurrence":
    case "keep-occurrence":
      return "keep-this-occurrence";
    case "move-next-date-forward":
    case "move-next-forward":
      return "move-next-date-forward";
    case "stop-series":
      return "stop-series";
  }
}
/** The `resolveMissedPlan` payload: the occurrence under review and one of the three resolutions. */
export const resolveMissedPlanSchema = z.strictObject({
  occurrenceId: occurrenceIdText,
  seriesId: seriesIdText.optional(),
  resolution: z.enum(RESOLUTION_SPELLINGS, { error: WORDS.resolutionRequired }),
});
/** The validated `resolveMissedPlan` payload. */
export type ResolveMissedPlanPayload = z.infer<typeof resolveMissedPlanSchema>;
// Ending one occurrence, and the successor a series may admit
function plannedOrDue(plannedDay: string | null, dueOn: string | null): string | null {
  return plannedDay ?? dueOn;
}
type OccurrenceEffect = {
  readonly work: WorkDocument;
  readonly ended: TaskRecord;
  readonly series: TaskSeriesRecord | null;
  readonly successor: TaskRecord | null;
};
function endOccurrence(options: {
  readonly work: WorkDocument;
  readonly task: TaskRecord;
  readonly nextStatus: Extract<TaskRecordStatus, "completed" | "cancelled">;
  readonly ownerPrincipalId: PrincipalId;
}): OccurrenceEffect {
  const { work, task } = options;
  const ended: TaskRecord = {
    ...task,
    status: options.nextStatus,
    revision: nextRevision(task.revision),
  };
  const tasks = work.tasks.map((existing) => (existing.taskId === task.taskId ? ended : existing));
  const series = task.seriesId === null ? undefined : seriesOf(work, task.seriesId);
  if (series === undefined) {
    return { work: { ...work, tasks }, ended, series: null, successor: null };
  }
  if (series.ownerPrincipalId !== options.ownerPrincipalId) {
    return { work: { ...work, tasks }, ended, series, successor: null };
  }
  if (series.currentOccurrenceId !== task.taskId) {
    // Only the series' current occurrence admits a successor; ending any other date changes that date
    // alone, because a series never grows a second actionable occurrence.
    return { work: { ...work, tasks }, ended, series, successor: null };
  }
  const rule = toEngineRule(series.currentRule);
  const occurrence = civilDateOf(task.dueOn) ?? (rule === undefined ? undefined : todayFor(rule));
  if (rule === undefined || occurrence === undefined) {
    return { work: { ...work, tasks }, ended, series, successor: null };
  }
  const admission = admitSuccessor({ rule, occurrence, state: series.state });
  if (admission.status === "refused") {
    const nextSeries: TaskSeriesRecord =
      admission.reason === "series-ended"
        ? {
            ...series,
            currentOccurrenceId: null,
            planNeedsReview: false,
            revision: nextRevision(series.revision),
          }
        : series;
    return { work: { ...work, tasks }, ended, series: nextSeries, successor: null };
  }
  const successor: TaskRecord = {
    taskId: newRecordId("task"),
    title: series.title,
    category: ended.category,
    dueOn: serialiseCivilDate(admission.nextDueOn),
    plannedTime: null,
    timeZone: null,
    kind: "default",
    status: "open",
    partnerId: ended.partnerId,
    initiativeId: ended.initiativeId,
    seriesId: series.seriesId,
    ownerPrincipalId: series.ownerPrincipalId,
    note: ended.note,
    revision: "rev-1",
  };
  const withSuccessor = [...tasks, successor];
  const current: TaskSeriesRecord = { ...series, currentOccurrenceId: successor.taskId };
  const nextSeries: TaskSeriesRecord = {
    ...current,
    planNeedsReview: planNeedsReviewNow(
      current,
      withSuccessor.filter((existing) => existing.seriesId === series.seriesId),
      rule,
    ),
    revision: nextRevision(series.revision),
  };
  return {
    work: {
      tasks: withSuccessor,
      series: work.series.map((existing) => (existing.seriesId === series.seriesId ? nextSeries : existing)),
      taskTags: work.taskTags,
    },
    ended,
    series: nextSeries,
    successor,
  };
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
function editableFieldsOf(payload: {
  readonly title?: string | undefined;
  readonly category?: string | null | undefined;
  readonly dueOn?: string | null | undefined;
  readonly kind?: TaskKind | undefined;
  readonly plannedTime?: string | null | undefined;
  readonly timeZone?: string | null | undefined;
  readonly partnerId?: string | null | undefined;
  readonly initiativeId?: string | null | undefined;
  readonly note?: string | null | undefined;
}): EditableTaskFields {
  const planned = payload.plannedTime === undefined ? undefined : payload.plannedTime === null ? null : (plannedTimeFieldOf(payload.plannedTime) ?? null);
  return {
    title: payload.title,
    category: payload.category === undefined ? undefined : blankToNull(payload.category),
    dueOn: payload.dueOn,
    kind: payload.kind,
    plannedTime: planned,
    timeZone: payload.timeZone,
    partnerId: payload.partnerId,
    initiativeId: payload.initiativeId,
    note: payload.note === undefined ? undefined : blankToNull(payload.note),
  };
}
function mergedTask(task: TaskRecord, fields: EditableTaskFields, revision: string): TaskRecord {
  const kind = fields.kind ?? task.kind;
  let plannedTime: string | null;
  let timeZone: string | null;
  if (kind !== "meeting") {
    plannedTime = null;
    timeZone = null;
  } else if (fields.plannedTime === undefined) {
    plannedTime = task.plannedTime;
    timeZone = task.timeZone;
  } else if (fields.plannedTime === null) {
    plannedTime = null;
    timeZone = null;
  } else {
    plannedTime = fields.plannedTime.clock;
    timeZone = fields.timeZone ?? task.timeZone;
  }
  const statedDueOn = fields.dueOn === undefined ? task.dueOn : fields.dueOn;
  const plannedDay = fields.plannedTime === undefined ? null : (fields.plannedTime?.date ?? null);
  return {
    taskId: task.taskId,
    title: fields.title ?? task.title,
    category: fields.category === undefined ? task.category : fields.category,
    dueOn: plannedOrDue(plannedDay, statedDueOn),
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
function sameTaskFields(left: TaskRecord, right: TaskRecord): boolean {
  return (
    left.title === right.title &&
    left.category === right.category &&
    left.dueOn === right.dueOn &&
    left.plannedTime === right.plannedTime &&
    left.timeZone === right.timeZone &&
    left.kind === right.kind &&
    left.status === right.status &&
    left.partnerId === right.partnerId &&
    left.initiativeId === right.initiativeId &&
    left.note === right.note
  );
}
// The per-item result a bulk action reports
const BULK_REASONS = {
  notEditable: {
    code: "not-editable",
    message: "This row was no longer eligible when the action ran, so it was left as it was.",
  },
  alreadyTagged: {
    code: "already-tagged",
    message: "This row already carries that tag, so nothing changed.",
  },
  tagAbsent: {
    code: "tag-absent",
    message: "This row does not carry that tag, so nothing changed.",
  },
  tagOwnedElsewhere: {
    code: "tag-owned-elsewhere",
    message: "This row carries that tag as another person's private preparation, so it was left as it was.",
  },
  alreadyComplete: {
    code: "already-complete",
    message: "This row was already complete, so nothing changed.",
  },
  notOwed: {
    code: "not-owed",
    message: "This row was cancelled, so there is nothing here to complete.",
  },
} as const;
function bulkItem(input: {
  readonly taskId: string;
  readonly state: BulkItemState;
  readonly revision?: string | null;
  readonly createdTaskId?: string | null;
  readonly reason?: { readonly code: string; readonly message: string } | null;
}): BulkItemView {
  return {
    taskId: input.taskId,
    state: input.state,
    revision: input.revision ?? null,
    createdTaskId: input.createdTaskId ?? null,
    reasonCode: input.reason?.code ?? null,
    reason: input.reason?.message ?? null,
  };
}
function itemAccepted(taskId: string, revision: string, createdTaskId?: string): BulkItemView {
  return bulkItem({ taskId, state: "accepted", revision, createdTaskId: createdTaskId ?? null });
}
function itemUnchanged(taskId: string, revision: string, reason: { readonly code: string; readonly message: string }): BulkItemView {
  return bulkItem({ taskId, state: "unchanged", revision, reason });
}
function itemExcluded(taskId: string, reason: { readonly code: string; readonly message: string }): BulkItemView {
  return bulkItem({ taskId, state: "excluded", reason });
}
function itemFailed(taskId: string, reason: { readonly code: string; readonly message: string }): BulkItemView {
  return bulkItem({ taskId, state: "failed", reason });
}
function perItemOf(item: BulkItemView): PerItemResult<BulkItemState> {
  return {
    targetId: item.taskId,
    state: item.state,
    ...(item.revision === null ? {} : { revision: item.revision }),
    ...(item.reasonCode === null ? {} : { reasonCode: item.reasonCode }),
    ...(item.reason === null ? {} : { reason: item.reason }),
  };
}
function bulkResult(items: readonly BulkItemView[]): BulkResultView {
  const countOf = (state: BulkItemState): number => items.filter((item) => item.state === state).length;
  return {
    items,
    acceptedCount: countOf("accepted"),
    unchangedCount: countOf("unchanged"),
    excludedCount: countOf("excluded"),
    failedCount: countOf("failed"),
    createdTaskIds: items.flatMap((item) => (item.createdTaskId === null ? [] : [item.createdTaskId])),
  };
}
function everyRowUnchanged(items: readonly BulkItemView[]): boolean {
  return items.length > 0 && items.every((item) => item.state === "unchanged");
}
// createTask
/** What `createTask` answers with: the task as it now stands. */
export type CreateTaskResult = {
  readonly task: TaskView;
};
/** Creates one ordinary or meeting task. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function createTask(input: MutationInput<CreateTaskPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<CreateTaskPayload, CreateTaskResult>({
    sessionId: opening.sessionId,
    input,
    schema: createTaskSchema,
    name: "createTask",
    authorize: (session) => authorizesOwnWork(session, input.scope, "task"),
    apply: ({ docs, session }) => {
      const payload = payloadOf(createTaskSchema, input);
      const work = readWorkDocument(docs.state);
      const planned = plannedTimeFieldOf(payload.plannedTime);
      const task: TaskRecord = {
        taskId: newRecordId("task"),
        title: payload.title,
        category: blankToNull(payload.category),
        dueOn: plannedOrDue(planned?.date ?? null, payload.dueOn ?? null),
        plannedTime: planned?.clock ?? null,
        // A zone is stored only for a meeting that states a plan, because a zone with no time would
        // describe half of when a meeting is.
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
      return {
        changed: true,
        revision: task.revision,
        result: { task: taskView(task) },
        created: [task.taskId],
      };
    },
  });
}
// editTask
/** What `editTask` answers with: the task as it now stands. */
export type EditTaskResult = {
  readonly task: TaskView;
};
/** Changes whichever editable fields of one task the caller restates. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function editTask(input: MutationInput<EditTaskPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<EditTaskPayload, EditTaskResult>({
    sessionId: opening.sessionId,
    input,
    schema: editTaskSchema,
    name: "editTask",
    authorize: (session) => authorizesOwnWork(session, input.scope, "task"),
    readCurrent: (docs) => taskTarget(docs, payloadOf(editTaskSchema, input).taskId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(editTaskSchema, input);
      const work = readWorkDocument(docs.state);
      const task = taskOf(work, payload.taskId);
      if (task === undefined || task.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      const next = mergedTask(task, editableFieldsOf(payload), nextRevision(task.revision));
      if (sameTaskFields(task, next)) {
        return { changed: false };
      }
      writeWorkDocument(docs, withTask(work, next));
      return {
        changed: true,
        revision: next.revision,
        result: { task: taskView(next) },
        changedIds: [next.taskId],
      };
    },
  });
}
// completeTask
/** What `completeTask` answers with: the finished task, its series and the successor it admitted. */
export type CompleteTaskResult = {
  readonly task: TaskView;
  readonly series: SeriesView | null;
  readonly successorTaskId: string | null;
};
/** Marks one task complete. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function completeTask(input: MutationInput<CompleteTaskPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<CompleteTaskPayload, CompleteTaskResult>({
    sessionId: opening.sessionId,
    input,
    schema: completeTaskSchema,
    name: "completeTask",
    authorize: (session) => authorizesOwnWork(session, input.scope, "task"),
    readCurrent: (docs) => taskTarget(docs, payloadOf(completeTaskSchema, input).taskId),
    apply: ({ docs, session, operationId }) => {
      const work = readWorkDocument(docs.state);
      const task = taskOf(work, payloadOf(completeTaskSchema, input).taskId);
      if (task === undefined || task.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      if (!isAwaitingAction(task.status)) {
        return { changed: false };
      }
      const effect = endOccurrence({
        work,
        task,
        nextStatus: "completed",
        ownerPrincipalId: session.principalId,
      });
      writeWorkDocument(docs, effect.work);
      return {
        changed: true,
        revision: effect.ended.revision,
        result: {
          task: taskView(effect.ended),
          series: effect.series === null ? null : seriesView(effect.series),
          successorTaskId: effect.successor?.taskId ?? null,
        },
        changedIds: [effect.ended.taskId],
        ...(effect.successor === null ? {} : { created: [effect.successor.taskId] }),
      };
    },
  });
}
// reopenTask
/** What `reopenTask` answers with: the task as it now stands. */
export type ReopenTaskResult = {
  readonly task: TaskView;
};
/** Reopens a completed or cancelled task. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function reopenTask(input: MutationInput<ReopenTaskPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<ReopenTaskPayload, ReopenTaskResult>({
    sessionId: opening.sessionId,
    input,
    schema: reopenTaskSchema,
    name: "reopenTask",
    authorize: (session) => authorizesOwnWork(session, input.scope, "task"),
    readCurrent: (docs) => taskTarget(docs, payloadOf(reopenTaskSchema, input).taskId),
    apply: ({ docs, session, operationId }) => {
      const work = readWorkDocument(docs.state);
      const task = taskOf(work, payloadOf(reopenTaskSchema, input).taskId);
      if (task === undefined || task.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      if (isAwaitingAction(task.status)) {
        return { changed: false };
      }
      const reopened: TaskRecord = {
        ...task,
        status: "reopened",
        revision: nextRevision(task.revision),
      };
      writeWorkDocument(docs, withTask(work, reopened));
      return {
        changed: true,
        revision: reopened.revision,
        result: { task: taskView(reopened) },
        changedIds: [reopened.taskId],
      };
    },
  });
}
// cancelTask
/** What `cancelTask` answers with: the cancelled task, still on the record. */
export type CancelTaskResult = {
  readonly task: TaskView;
};
/** Cancels one open task. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function cancelTask(input: MutationInput<CancelTaskPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<CancelTaskPayload, CancelTaskResult>({
    sessionId: opening.sessionId,
    input,
    schema: cancelTaskSchema,
    name: "cancelTask",
    authorize: (session) => authorizesOwnWork(session, input.scope, "task"),
    readCurrent: (docs) => taskTarget(docs, payloadOf(cancelTaskSchema, input).taskId),
    apply: ({ docs, session, operationId }) => {
      const work = readWorkDocument(docs.state);
      const task = taskOf(work, payloadOf(cancelTaskSchema, input).taskId);
      if (task === undefined || task.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      if (!isAwaitingAction(task.status)) {
        return { changed: false };
      }
      const cancelled: TaskRecord = {
        ...task,
        status: "cancelled",
        revision: nextRevision(task.revision),
      };
      writeWorkDocument(docs, withTask(work, cancelled));
      return {
        changed: true,
        revision: cancelled.revision,
        result: { task: taskView(cancelled) },
        changedIds: [cancelled.taskId],
      };
    },
  });
}
// bulkApplyTag
/** Applies one private tag to each selected task. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function bulkApplyTag(input: MutationInput<BulkApplyTagPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<BulkApplyTagPayload, BulkResultView>({
    sessionId: opening.sessionId,
    input,
    schema: bulkApplyTagSchema,
    name: "bulkApplyTag",
    authorize: (session) => authorizesOwnWork(session, input.scope, "task"),
    apply: ({ docs, session }) => {
      const payload = payloadOf(bulkApplyTagSchema, input);
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
        added.push({
          taskId,
          tag: payload.tag,
          ownerPrincipalId: session.principalId,
          revision: "rev-1",
        });
        items.push(itemAccepted(taskId, task.revision));
      }
      if (everyRowUnchanged(items)) {
        return { changed: false };
      }
      const nextWork = withTaskTags(work, [...work.taskTags, ...added]);
      writeWorkDocument(docs, nextWork);
      return {
        changed: true,
        revision: collectionWitness("tasks", nextWork.tasks),
        result: bulkResult(items),
        items: items.map(perItemOf),
      };
    },
  });
}
// bulkRemoveTag
/** Removes one private tag from each selected task. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function bulkRemoveTag(input: MutationInput<BulkRemoveTagPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<BulkRemoveTagPayload, BulkResultView>({
    sessionId: opening.sessionId,
    input,
    schema: bulkRemoveTagSchema,
    name: "bulkRemoveTag",
    authorize: (session) => authorizesOwnWork(session, input.scope, "task"),
    apply: ({ docs, session }) => {
      const payload = payloadOf(bulkRemoveTagSchema, input);
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
      if (everyRowUnchanged(items)) {
        return { changed: false };
      }
      const nextWork = withTaskTags(
        work,
        work.taskTags.filter((record) => !(record.tag === payload.tag && removed.has(record.taskId))),
      );
      writeWorkDocument(docs, nextWork);
      return {
        changed: true,
        revision: collectionWitness("tasks", nextWork.tasks),
        result: bulkResult(items),
        items: items.map(perItemOf),
      };
    },
  });
}
// bulkCreateTasks
/** Creates one ordinary follow-up task for each selected row. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function bulkCreateTasks(input: MutationInput<BulkCreateTasksPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<BulkCreateTasksPayload, BulkResultView>({
    sessionId: opening.sessionId,
    input,
    schema: bulkCreateTasksSchema,
    name: "bulkCreateTasks",
    authorize: (session) => authorizesOwnWork(session, input.scope, "task"),
    apply: ({ docs, session }) => {
      const payload = payloadOf(bulkCreateTasksSchema, input);
      const template = payload.template ?? payload.draft;
      if (template === undefined) {
        return { changed: false };
      }
      const work = readWorkDocument(docs.state);
      const items: BulkItemView[] = [];
      const created: TaskRecord[] = [];
      for (const taskId of payload.taskIds) {
        const row = taskOf(work, taskId);
        if (row === undefined || row.ownerPrincipalId !== session.principalId) {
          items.push(itemExcluded(taskId, BULK_REASONS.notEditable));
          continue;
        }
        const followUp: TaskRecord = {
          taskId: newRecordId("task"),
          title: template.title,
          category: blankToNull(template.category),
          dueOn: template.dueOn ?? null,
          plannedTime: null,
          timeZone: null,
          kind: "default",
          status: "open",
          partnerId: row.partnerId,
          initiativeId: row.initiativeId,
          seriesId: null,
          ownerPrincipalId: session.principalId,
          note: blankToNull(template.note),
          revision: "rev-1",
        };
        created.push(followUp);
        items.push(itemAccepted(taskId, row.revision, followUp.taskId));
      }
      if (created.length === 0) {
        // No row was eligible, so nothing was created and no task exists to report: the answer is
        // `unchanged`, which advances no revision and records no history entry. Each row's eligibility
        // was re-checked above when the action ran, so nothing is left to apply and the document is
        // not rewritten.
        return { changed: false };
      }
      const nextWork = withNewTasks(work, created);
      writeWorkDocument(docs, nextWork);
      return {
        changed: true,
        revision: collectionWitness("tasks", nextWork.tasks),
        result: bulkResult(items),
        created: created.map((task) => task.taskId),
        items: items.map(perItemOf),
      };
    },
  });
}
// bulkCompleteTasks
/** Completes each selected task that can be completed on its own. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function bulkCompleteTasks(input: MutationInput<BulkCompleteTasksPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<BulkCompleteTasksPayload, BulkResultView>({
    sessionId: opening.sessionId,
    input,
    schema: bulkCompleteTasksSchema,
    name: "bulkCompleteTasks",
    authorize: (session) => authorizesOwnWork(session, input.scope, "task"),
    apply: ({ docs, session }) => {
      const payload = payloadOf(bulkCompleteTasksSchema, input);
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
        const effect = endOccurrence({
          work,
          task: row,
          nextStatus: "completed",
          ownerPrincipalId: session.principalId,
        });
        work = effect.work;
        if (effect.successor !== null) {
          created.push(effect.successor.taskId);
        }
        items.push(itemAccepted(taskId, effect.ended.revision));
      }
      if (everyRowUnchanged(items)) {
        return { changed: false };
      }
      writeWorkDocument(docs, work);
      return {
        changed: true,
        revision: collectionWitness("tasks", work.tasks),
        result: bulkResult(items),
        ...(created.length === 0 ? {} : { created }),
        items: items.map(perItemOf),
      };
    },
  });
}
// createSeries
/** What `createSeries` answers with: the series, its one actionable occurrence and the preview. */
export type CreateSeriesResult = {
  readonly series: SeriesView;
  readonly occurrence: TaskView;
  readonly preview: SeriesPreviewView;
  readonly firstOccurrence: PreviewResolution | null;
};
function createRuleOf(payload: CreateRuleFields): SeriesRule | undefined {
  const end = resolveCreateEnd(payload);
  if (end === undefined) {
    return undefined;
  }
  const rule = engineRuleOf(payload, end);
  if (rule === undefined) {
    return undefined;
  }
  return validateSeriesRule(rule).status === "valid" ? rule : undefined;
}
/** Creates a repeating task: its closed rule, its first rule revision and its one actionable occurrence. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function createSeries(input: MutationInput<CreateSeriesPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<CreateSeriesPayload, CreateSeriesResult>({
    sessionId: opening.sessionId,
    input,
    schema: createSeriesSchema,
    name: "createSeries",
    authorize: (session) => authorizesOwnWork(session, input.scope, "series"),
    apply: ({ docs, session }) => {
      const payload = payloadOf(createSeriesSchema, input);
      const work = readWorkDocument(docs.state);
      const rule = createRuleOf(payload);
      if (rule === undefined) {
        // The schema already refused this rule shape, so reaching here means the rule cannot be read
        // as a rule at all: nothing is created rather than a series that could never admit a date.
        return { changed: false };
      }
      // The engine answers what the rule actually produces first, so the stored occurrence is the date
      // the plan will use and any month-day resolution travels with it rather than being assumed away.
      // The walk starts the day before the anchor, which only the first calendar day has no room for.
      const anchoredAtStart = rule.firstDueOn.year === 1 && rule.firstDueOn.month === 1 && rule.firstDueOn.day === 1;
      const firstPreview = nextOccurrences(rule, anchoredAtStart ? rule.firstDueOn : rule.firstDueOn.subtract({ days: 1 }), 1);
      if (firstPreview.status === "refused") {
        return { changed: false };
      }
      const firstDate = firstPreview.dates[0];
      if (firstDate === undefined) {
        return { changed: false };
      }
      const firstResolution = firstPreview.monthDayResolutions[0];
      const seriesId = newRecordId("series");
      const storedRule = toRuleRecord(rule);
      const occurrence: TaskRecord = {
        taskId: newRecordId("task"),
        title: payload.title,
        category: blankToNull(payload.category),
        dueOn: serialiseCivilDate(firstDate),
        plannedTime: null,
        timeZone: null,
        kind: "default",
        status: "open",
        partnerId: payload.partnerId ?? null,
        initiativeId: null,
        seriesId,
        ownerPrincipalId: session.principalId,
        note: blankToNull(payload.note),
        revision: "rev-1",
      };
      const drafted: TaskSeriesRecord = {
        seriesId,
        ownerPrincipalId: session.principalId,
        title: payload.title,
        currentRule: storedRule,
        effectiveRevisions: [
          {
            revisionId: newRecordId("series-revision"),
            effectiveFrom: serialiseCivilDate(rule.firstDueOn),
            rule: storedRule,
          },
        ],
        currentOccurrenceId: occurrence.taskId,
        state: "active",
        planNeedsReview: false,
        revision: "rev-1",
      };
      const series: TaskSeriesRecord = {
        ...drafted,
        planNeedsReview: planNeedsReviewNow(drafted, [occurrence], rule),
      };
      const nextWork: WorkDocument = {
        tasks: [...work.tasks, occurrence],
        series: [...work.series, series],
        taskTags: work.taskTags,
      };
      writeWorkDocument(docs, nextWork);
      return {
        changed: true,
        revision: series.revision,
        result: {
          series: seriesView(series),
          occurrence: taskView(occurrence),
          preview: previewView(series, rule),
          firstOccurrence:
            firstResolution === undefined
              ? null
              : {
                  dueOn: serialiseCivilDate(firstResolution.dueOn),
                  requestedDay: firstResolution.requestedDay,
                  resolvedDay: firstResolution.resolvedDay,
                },
        },
        created: [series.seriesId, occurrence.taskId],
      };
    },
  });
}
// editOccurrence
/** What `editOccurrence` answers with: the date as it now stands, and the series it belongs to. */
export type EditOccurrenceResult = {
  readonly series: SeriesView;
  readonly occurrence: TaskView;
};
/** Changes this one date's own work, leaving the rule and every other date alone. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function editOccurrence(input: MutationInput<EditOccurrencePayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<EditOccurrencePayload, EditOccurrenceResult>({
    sessionId: opening.sessionId,
    input,
    schema: editOccurrenceSchema,
    name: "editOccurrence",
    authorize: (session) => authorizesOwnWork(session, input.scope, "series"),
    readCurrent: (docs) => taskTarget(docs, payloadOf(editOccurrenceSchema, input).occurrenceId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(editOccurrenceSchema, input);
      const work = readWorkDocument(docs.state);
      const occurrence = taskOf(work, payload.occurrenceId);
      if (occurrence === undefined || occurrence.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      const series = occurrence.seriesId === null ? undefined : seriesOf(work, occurrence.seriesId);
      if (series === undefined) {
        return { changed: false };
      }
      // A second reference cannot order the change: the occurrence names its own series, so a stated
      // identifier that disagrees with it describes two different records and nothing is changed.
      if (payload.seriesId !== undefined && payload.seriesId !== series.seriesId) {
        return { changed: false };
      }
      if (!isAwaitingAction(occurrence.status)) {
        return { changed: false };
      }
      const next = mergedTask(occurrence, editableFieldsOf(payload), nextRevision(occurrence.revision));
      if (sameTaskFields(occurrence, next)) {
        return { changed: false };
      }
      writeWorkDocument(docs, withTask(work, next));
      return {
        changed: true,
        revision: next.revision,
        result: { series: seriesView(series), occurrence: taskView(next) },
        changedIds: [next.taskId],
      };
    },
  });
}
// editThisAndFuture
/** What `editThisAndFuture` answers with: the series, its rule revision and the date in force. */
export type EditThisAndFutureResult = {
  readonly series: SeriesView;
  readonly occurrence: TaskView | null;
  readonly effectiveFrom: string;
  readonly revisionId: string;
  readonly preview: SeriesPreviewView | null;
};
/** Revises the plan from an explicit boundary onward, leaving everything before it untouched. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function editThisAndFuture(input: MutationInput<EditThisAndFuturePayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<EditThisAndFuturePayload, EditThisAndFutureResult>({
    sessionId: opening.sessionId,
    input,
    schema: editThisAndFutureSchema,
    name: "editThisAndFuture",
    authorize: (session) => authorizesOwnWork(session, input.scope, "series"),
    readCurrent: (docs) => seriesTarget(docs, payloadOf(editThisAndFutureSchema, input).seriesId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(editThisAndFutureSchema, input);
      const work = readWorkDocument(docs.state);
      const series = seriesOf(work, payload.seriesId);
      if (series === undefined || series.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      if (series.state === "stopped") {
        return { changed: false };
      }
      const effectiveFrom = civilDateOf(payload.effectiveFrom);
      if (effectiveFrom === undefined) {
        return { changed: false };
      }
      const revisions: RuleRevision[] = [];
      for (const record of series.effectiveRevisions) {
        const rule = toEngineRule(record.rule);
        const boundary = civilDateOf(record.effectiveFrom);
        if (rule === undefined || boundary === undefined) {
          return { changed: false };
        }
        revisions.push({ effectiveFrom: boundary, rule });
      }
      const occurrences = occurrencesOf(work, series.seriesId);
      const statedEnd = payload.end === undefined ? undefined : toEngineEnd(payload.end);
      if (payload.end !== undefined && statedEnd === undefined) {
        // The payload schema already refused an unreadable end date, so this is defensive: an end that
        // cannot be read is never replaced by a different kind of end.
        return { changed: false };
      }
      const patch: SeriesRulePatch = {
        ...(payload.profile === undefined ? {} : { profile: payload.profile }),
        ...(payload.interval === undefined ? {} : { interval: payload.interval }),
        ...(payload.dayOfMonth === undefined ? {} : { dayOfMonth: payload.dayOfMonth }),
        ...(payload.planningTimeZone === undefined ? {} : { planningTimeZone: payload.planningTimeZone }),
        ...(statedEnd === undefined ? {} : { end: statedEnd }),
      };
      const edit = applyThisAndFuture({
        revisions,
        from: effectiveFrom,
        patch,
        lastCompletedOn: lastCompletedDate(occurrences),
      });
      if (edit.status === "refused") {
        return { changed: false };
      }
      const merged = edit.revision.rule;
      if (validateSeriesRule(merged).status === "invalid") {
        return { changed: false };
      }
      const storedRule = toRuleRecord(merged);
      const revisionRecord: SeriesRuleRevisionRecord = {
        revisionId: newRecordId("series-revision"),
        effectiveFrom: serialiseCivilDate(edit.revision.effectiveFrom),
        rule: storedRule,
      };
      const drafted: TaskSeriesRecord = {
        ...series,
        title: payload.title ?? series.title,
        currentRule: storedRule,
        effectiveRevisions: [...series.effectiveRevisions, revisionRecord],
      };
      // The series stores no category and no note, so a restated label travels to the date in force —
      // which is what the next admitted date inherits when this one ends.
      let movedOccurrence: TaskRecord | null = null;
      const current = series.currentOccurrenceId === null ? undefined : taskOf(work, series.currentOccurrenceId);
      if (current !== undefined && isAwaitingAction(current.status) && (payload.category !== undefined || payload.note !== undefined)) {
        movedOccurrence = {
          ...current,
          category: payload.category === undefined ? current.category : blankToNull(payload.category),
          note: payload.note === undefined ? current.note : blankToNull(payload.note),
          revision: nextRevision(current.revision),
        };
      }
      const nextSeries: TaskSeriesRecord = {
        ...drafted,
        planNeedsReview: planNeedsReviewNow(drafted, occurrences, merged),
        revision: nextRevision(series.revision),
      };
      const withRule: WorkDocument = withSeries(movedOccurrence === null ? work : withTask(work, movedOccurrence), nextSeries);
      writeWorkDocument(docs, withRule);
      return {
        changed: true,
        revision: nextSeries.revision,
        result: {
          series: seriesView(nextSeries),
          occurrence: movedOccurrence === null ? null : taskView(movedOccurrence),
          effectiveFrom: revisionRecord.effectiveFrom,
          revisionId: revisionRecord.revisionId,
          preview: previewView(nextSeries, merged),
        },
        created: [revisionRecord.revisionId],
        changedIds: movedOccurrence === null ? [nextSeries.seriesId] : [nextSeries.seriesId, movedOccurrence.taskId],
      };
    },
  });
}
// skipOccurrence
/** What `skipOccurrence` answers with: the answered date and the successor the series admitted. */
export type SkipOccurrenceResult = {
  readonly series: SeriesView;
  readonly occurrence: TaskView;
  readonly successorTaskId: string | null;
};
/** Answers one date without performing it. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function skipOccurrence(input: MutationInput<SkipOccurrencePayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<SkipOccurrencePayload, SkipOccurrenceResult>({
    sessionId: opening.sessionId,
    input,
    schema: skipOccurrenceSchema,
    name: "skipOccurrence",
    authorize: (session) => authorizesOwnWork(session, input.scope, "series"),
    readCurrent: (docs) => taskTarget(docs, payloadOf(skipOccurrenceSchema, input).occurrenceId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(skipOccurrenceSchema, input);
      const work = readWorkDocument(docs.state);
      const occurrence = taskOf(work, payload.occurrenceId);
      if (occurrence === undefined || occurrence.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      const series = occurrence.seriesId === null ? undefined : seriesOf(work, occurrence.seriesId);
      if (series === undefined) {
        return { changed: false };
      }
      if (payload.seriesId !== undefined && payload.seriesId !== series.seriesId) {
        return { changed: false };
      }
      if (series.state !== "active") {
        return { changed: false };
      }
      if (series.currentOccurrenceId !== occurrence.taskId) {
        return { changed: false };
      }
      if (!isAwaitingAction(occurrence.status)) {
        return { changed: false };
      }
      const effect = endOccurrence({
        work,
        task: occurrence,
        nextStatus: "cancelled",
        ownerPrincipalId: session.principalId,
      });
      writeWorkDocument(docs, effect.work);
      return {
        changed: true,
        revision: effect.ended.revision,
        result: {
          series: effect.series === null ? seriesView(series) : seriesView(effect.series),
          occurrence: taskView(effect.ended),
          successorTaskId: effect.successor?.taskId ?? null,
        },
        changedIds: [effect.ended.taskId],
        ...(effect.successor === null ? {} : { created: [effect.successor.taskId] }),
      };
    },
  });
}
// pauseSeries and resumeSeries
/** What pausing or resuming a series answers with: the series and what it would produce next. */
export type SeriesStateResult = {
  readonly series: SeriesView;
  readonly preview: SeriesPreviewView | null;
};
function previewFor(series: TaskSeriesRecord): SeriesPreviewView | null {
  const rule = toEngineRule(series.currentRule);
  return rule === undefined ? null : previewView(series, rule);
}
/** Pauses a series. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function pauseSeries(input: MutationInput<PauseSeriesPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<PauseSeriesPayload, SeriesStateResult>({
    sessionId: opening.sessionId,
    input,
    schema: pauseSeriesSchema,
    name: "pauseSeries",
    authorize: (session) => authorizesOwnWork(session, input.scope, "series"),
    readCurrent: (docs) => seriesTarget(docs, payloadOf(pauseSeriesSchema, input).seriesId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(pauseSeriesSchema, input);
      const work = readWorkDocument(docs.state);
      const series = seriesOf(work, payload.seriesId);
      if (series === undefined || series.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      if (series.state !== "active") {
        return { changed: false };
      }
      const paused: TaskSeriesRecord = {
        ...series,
        state: "paused",
        planNeedsReview: false,
        revision: nextRevision(series.revision),
      };
      writeWorkDocument(docs, withSeries(work, paused));
      return {
        changed: true,
        revision: paused.revision,
        result: { series: seriesView(paused), preview: previewFor(paused) },
        changedIds: [paused.seriesId],
      };
    },
  });
}
/** Resumes a paused series. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function resumeSeries(input: MutationInput<ResumeSeriesPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<ResumeSeriesPayload, SeriesStateResult>({
    sessionId: opening.sessionId,
    input,
    schema: resumeSeriesSchema,
    name: "resumeSeries",
    authorize: (session) => authorizesOwnWork(session, input.scope, "series"),
    readCurrent: (docs) => seriesTarget(docs, payloadOf(resumeSeriesSchema, input).seriesId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(resumeSeriesSchema, input);
      const work = readWorkDocument(docs.state);
      const series = seriesOf(work, payload.seriesId);
      if (series === undefined || series.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      if (series.state !== "paused") {
        return { changed: false };
      }
      const rule = toEngineRule(series.currentRule);
      if (rule === undefined) {
        return { changed: false };
      }
      const resumed: TaskSeriesRecord = { ...series, state: "active" };
      const next: TaskSeriesRecord = {
        ...resumed,
        planNeedsReview: planNeedsReviewNow(resumed, occurrencesOf(work, series.seriesId), rule),
        revision: nextRevision(series.revision),
      };
      writeWorkDocument(docs, withSeries(work, next));
      return {
        changed: true,
        revision: next.revision,
        result: { series: seriesView(next), preview: previewView(next, rule) },
        changedIds: [next.seriesId],
      };
    },
  });
}
// stopSeries
/** What stopping a series answers with: the series and the fate of the work it leaves behind. */
export type StopSeriesResult = {
  readonly series: SeriesView;
  readonly unfinishedWork: "keep" | "cancel";
  readonly keptTaskIds: readonly string[];
  readonly cancelledTaskIds: readonly string[];
};
/** Stops a series and states what happens to its unfinished work. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function stopSeries(input: MutationInput<StopSeriesPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<StopSeriesPayload, StopSeriesResult>({
    sessionId: opening.sessionId,
    input,
    schema: stopSeriesSchema,
    name: "stopSeries",
    authorize: (session) => authorizesOwnWork(session, input.scope, "series"),
    readCurrent: (docs) => seriesTarget(docs, payloadOf(stopSeriesSchema, input).seriesId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(stopSeriesSchema, input);
      const work = readWorkDocument(docs.state);
      const series = seriesOf(work, payload.seriesId);
      if (series === undefined || series.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      if (series.state === "stopped") {
        return { changed: false };
      }
      const unfinishedWork = payload.unfinishedWork ?? "keep";
      const kept: string[] = [];
      const cancelled: string[] = [];
      let nextWork = work;
      for (const occurrence of occurrencesOf(work, series.seriesId)) {
        if (!isAwaitingAction(occurrence.status)) {
          continue;
        }
        if (unfinishedWork === "keep") {
          kept.push(occurrence.taskId);
          continue;
        }
        cancelled.push(occurrence.taskId);
        nextWork = withTask(nextWork, {
          ...occurrence,
          status: "cancelled",
          revision: nextRevision(occurrence.revision),
        });
      }
      const stopped: TaskSeriesRecord = {
        ...series,
        state: "stopped",
        planNeedsReview: false,
        revision: nextRevision(series.revision),
      };
      writeWorkDocument(docs, withSeries(nextWork, stopped));
      return {
        changed: true,
        revision: stopped.revision,
        result: {
          series: seriesView(stopped),
          unfinishedWork,
          keptTaskIds: kept,
          cancelledTaskIds: cancelled,
        },
        changedIds: [stopped.seriesId, ...cancelled],
      };
    },
  });
}
// resolveMissedPlan
/** What resolving a plan in review answers with: the series, the date in force and the choice made. */
export type ResolveMissedPlanResult = {
  readonly series: SeriesView;
  readonly occurrence: TaskView | null;
  readonly resolution: PlanResolution;
  readonly preview: SeriesPreviewView | null;
};
/** Resolves a series whose plan needs review with one of exactly three acts. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function resolveMissedPlan(input: MutationInput<ResolveMissedPlanPayload>, options?: TaskMutationOptions): Promise<MutationOutcome> {
  const opening = await openMutation(input, options);
  if (!opening.ok) {
    return opening.outcome;
  }
  return runMutation<ResolveMissedPlanPayload, ResolveMissedPlanResult>({
    sessionId: opening.sessionId,
    input,
    schema: resolveMissedPlanSchema,
    name: "resolveMissedPlan",
    authorize: (session) => authorizesOwnWork(session, input.scope, "series"),
    readCurrent: (docs) => taskTarget(docs, payloadOf(resolveMissedPlanSchema, input).occurrenceId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(resolveMissedPlanSchema, input);
      const work = readWorkDocument(docs.state);
      const occurrence = taskOf(work, payload.occurrenceId);
      if (occurrence === undefined || occurrence.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      const series = occurrence.seriesId === null ? undefined : seriesOf(work, occurrence.seriesId);
      if (series === undefined) {
        return { changed: false };
      }
      if (payload.seriesId !== undefined && payload.seriesId !== series.seriesId) {
        return { changed: false };
      }
      if (series.state !== "active") {
        return { changed: false };
      }
      const rule = toEngineRule(series.currentRule);
      if (rule === undefined) {
        return { changed: false };
      }
      const resolution = canonicalResolution(payload.resolution);
      if (resolution === "stop-series") {
        const stopped: TaskSeriesRecord = {
          ...series,
          state: "stopped",
          planNeedsReview: false,
          revision: nextRevision(series.revision),
        };
        writeWorkDocument(docs, withSeries(work, stopped));
        return {
          changed: true,
          revision: stopped.revision,
          result: {
            series: seriesView(stopped),
            occurrence: taskView(occurrence),
            resolution,
            preview: null,
          },
          changedIds: [stopped.seriesId],
        };
      }
      if (resolution === "move-next-date-forward") {
        const today = todayFor(rule);
        if (today === undefined) {
          return { changed: false };
        }
        const ahead = nextOccurrences(rule, today, 1);
        const nextDate = ahead.status === "preview" ? ahead.dates[0] : undefined;
        if (nextDate === undefined) {
          return { changed: false };
        }
        const moved: TaskRecord = {
          ...occurrence,
          dueOn: serialiseCivilDate(nextDate),
          revision: nextRevision(occurrence.revision),
        };
        const movedWork = withTask(work, moved);
        const drafted: TaskSeriesRecord = { ...series, currentOccurrenceId: moved.taskId };
        const next: TaskSeriesRecord = {
          ...drafted,
          planNeedsReview: planNeedsReviewNow(drafted, occurrencesOf(movedWork, series.seriesId), rule),
          revision: nextRevision(series.revision),
        };
        writeWorkDocument(docs, withSeries(movedWork, next));
        return {
          changed: true,
          revision: next.revision,
          result: {
            series: seriesView(next),
            occurrence: taskView(moved),
            resolution,
            preview: previewView(next, rule),
          },
          changedIds: [next.seriesId, moved.taskId],
        };
      }
      // Keeping this occurrence decides nothing about the date itself: it records that the plan was
      // looked at and is to be kept, which is the whole of what the first resolution offers.
      const kept: TaskSeriesRecord = {
        ...series,
        planNeedsReview: false,
        revision: nextRevision(series.revision),
      };
      writeWorkDocument(docs, withSeries(work, kept));
      return {
        changed: true,
        revision: kept.revision,
        result: {
          series: seriesView(kept),
          occurrence: taskView(occurrence),
          resolution,
          preview: previewView(kept, rule),
        },
        changedIds: [kept.seriesId],
      };
    },
  });
}
