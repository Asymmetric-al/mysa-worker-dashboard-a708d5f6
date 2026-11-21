/**
 * The seventeen named task and recurring-series mutations: the one write path behind the Work job and
 * the repeat rule that keeps a series useful.
 *
 * Every export here is one named job with one meaning — `createTask`, `editTask`, `completeTask`,
 * `reopenTask`, `cancelTask`, the four bulk actions, and the eight series commands — and each runs
 * through `runMutation` in `../operations`, which is the only place validation, authorisation, replay
 * detection, revision comparison, application, scope re-check and the ledger entry are ordered. This
 * file supplies a concrete payload schema and a concrete apply function per job, and nothing else: it
 * opens no transaction, reads no session document itself, writes no ledger entry, compares no
 * revision and builds no outcome. That is what keeps every write to one task or one series on the
 * same contract as every other write in the application.
 *
 * Six facts this file keeps apart, because the Work job loses its meaning when they merge:
 *
 * - Completing a task records that the work was finished. It proves nothing about contact, payment or
 *   fulfilment, and it never writes an interaction: a held meeting is recorded through
 *   `logInteraction`, so "planned" and "held" never become one thing here.
 * - A skipped occurrence was not performed. Skipping answers the date, admits at most one successor
 *   and completes nothing, so the occurrence ends cancelled rather than completed.
 * - Pausing and stopping are different fates. A pause holds future admission and can be resumed; a
 *   stop closes the series and explains what becomes of the work it leaves behind. A stopped series
 *   admits nothing further, so no stale edit, skip, pause, resume or resolution can revive it.
 * - An undated task is late for nothing, a due date is a civil date rather than a fabricated
 *   midnight, and a planned time is a wall-clock reading beside the zone that discloses it.
 * - A series' rule is prospective. A this-and-future edit appends a rule revision with an explicit
 *   effective boundary and leaves every completed or already-materialised occurrence untouched, so
 *   history is never rewritten to match a plan that changed afterwards.
 * - A selection is the rows a worker ticked. No bulk action here can be expressed as a filter, a
 *   saved view or "all matching rows", and every selected row is re-checked when the action runs.
 *
 * All date and recurrence arithmetic belongs to `@/modules/time`: a successor comes from
 * `admitSuccessor`, a plan in review from `missedPlan`, a prospective revision from
 * `applyThisAndFuture`, a rule's admission from `validateSeriesRule`, and the dates a rule would
 * produce from `nextOccurrences`. Nothing here walks a calendar, adds a month, resolves a short month
 * itself or measures elapsed time, so these commands cannot drift from the reads that report the same
 * series. Timestamps come from `now()` in `@/modules/time/clock`, and every boundary — "today" in the
 * planning zone, whether several dates were missed, whether a series may admit one more occurrence —
 * is evaluated when the command runs. There is no scheduler, timer, queue or background job, and none
 * is scaffolded here.
 *
 * Plan items that put this file in scope: AAP 0.6.1 "Mutations: tasks and recurrence" (this file and
 * its seventeen interfaces), 0.7.1 "Plan and finish work" and "Keep a series useful", 0.8.2 (work,
 * interactions and recurrence), 0.8.7 (the day-31 resolution, at most one successor, plan needs
 * review), 0.9.1 and 0.11.1 (`data-service/mutations/*.ts`), and criterion 13.
 *
 * Rule 1 obligations kept here. Clause 1: only the retained Work and recurring-task behaviours are
 * implemented — no calendar integration, reminder job, provider client or deferred scaffold. Clause
 * 2: one runner, one ledger, one schema per mutation and one recurrence engine, which is called
 * rather than copied. Clause 3: `open`, `completed`, `reopened`, `cancelled`, `paused`, `stopped`,
 * `preview` and `actionable` stay distinct, completion never proves contact, and an undetermined
 * effect stays `unknown` and is recovered by operation identity rather than by a repeat under a new
 * one.
 *
 * Layering: `src/app` → `src/features` → `src/components` → `src/modules/data-service` →
 * `src/modules/store`. This file is a data-service mutation module: it imports its sibling contracts,
 * the domain modules for time and recurrence, and no component, feature, application route, store
 * internals or provider package.
 */
import { z } from "zod";

import { now } from "@/modules/time/clock";
import {
  parseCivilDate,
  serialiseCivilDate,
  todayInZone,
  type CivilDate,
} from "@/modules/time/civil";
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

import { canEdit, resolveSession, type ResolvedSession, type ScopeDecision } from "../authorize";
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
import { denied, type MutationOutcome, type PerItemResult } from "../outcome";

// ---------------------------------------------------------------------------------------------
// Wording this file owns
// ---------------------------------------------------------------------------------------------

/**
 * The messages a caller sees when a payload is refused.
 *
 * Each one describes the value that was refused and what to do about it, never the person who typed
 * it and never another record: an `invalid` outcome is keyed by field path, and the sentence beside
 * that path is the whole of what a form shows.
 */
const WORDS = {
  titleRequired:
    "Give this task a title, because a title is the one thing a task cannot do without.",
  titleTooLong: "Shorten the title to a phrase, so it reads at a glance in a list.",
  categoryTooLong: "A category is a short label of your own, so shorten this one.",
  noteTooLong: "A note is a short reminder about the work, so shorten this one.",
  taskIdRequired: "This action applies to one task, so open the task again and retry.",
  seriesIdRequired:
    "This change applies to one repeating task, so open the series again and retry.",
  occurrenceIdRequired:
    "This action applies to one date of a repeating task, so open the series again and retry.",
  dueDateInvalid:
    "Enter the due date as a real calendar date, so the work is never given a day that does not exist.",
  plannedTimeInvalid:
    "Enter the planned time as a 24-hour clock time, so a meeting states when it is planned rather than an instant in an assumed zone.",
  plannedTimeRequiresZone:
    "State the time zone the planned time is read in, so the clock reading is never taken as an assumed zone.",
  plannedTimeOnlyForMeeting:
    "A planned time belongs to a meeting task, so choose Meeting as the kind of work or remove the time.",
  plannedTimeOtherDay:
    "The planned time falls on a different day from the due date, so align the two before saving.",
  timeZoneInvalid:
    "Choose a time zone this runtime recognises, so a stored plan is read in a stated zone.",
  kindInvalid: "Choose Task or Meeting as the kind of work.",
  linkInvalid:
    "Choose the linked record from the list, so a link names a record rather than a typed value.",
  tagRequired: "Name the private tag this action applies.",
  tagTooLong: "A private tag is a short label, so shorten this one.",
  selectionEmpty:
    "Select at least one task, because a bulk action applies only to the rows you selected.",
  selectionTooLarge:
    "Select at most 200 tasks in one action, because a larger selection is a filter in disguise.",
  selectionRepeated:
    "Each row appears once in a selection, so remove the repeated row and submit again.",
  followUpTemplateRequired: "State the follow-up task this action creates for each selected row.",
  followUpTemplateAmbiguous:
    "State the follow-up task once, so the same request cannot describe two different follow-ups.",
  profileInvalid:
    "Choose a repeat profile: does not repeat, weekly, every N weeks, monthly on a day, or every N months.",
  intervalRequired: "Choose how many periods between occurrences, as a whole number of at least 1.",
  intervalNotApplicable:
    "A repeat interval belongs to the every-N-weeks and every-N-months profiles, so choose one of those or remove the interval.",
  dayOfMonthRequired: "Choose the day of the month, from 1 to 31.",
  dayOfMonthNotApplicable:
    "A day of the month belongs to the monthly profiles, so choose one of those or remove the day.",
  endRequired:
    "Choose an end date or a number of occurrences, or turn on the ongoing series policy.",
  endAmbiguous:
    "State one end for this series: an end date, a number of occurrences, or the ongoing policy.",
  endCountInvalid: "Choose how many occurrences, as a whole number of at least 1.",
  firstDueDateRequired: "Choose the first due date the repeat counts from.",
  planningTimeZoneRequired:
    "Choose the planning time zone, so a display change never moves these dates.",
  effectiveFromRequired:
    "Choose the date this change takes effect from, so the dates before it keep the rule they were planned under.",
  resolutionRequired:
    "Choose one of the three resolutions for a plan that needs review: keep this occurrence, move the next date forward, or stop the series.",
  unfinishedWorkInvalid:
    "Choose what happens to the unfinished work when the series stops: keep it, or cancel it.",
  cancelReasonTooLong: "A cancellation reason is a short note, so shorten this one.",
  cancellationNotConfirmed:
    "Confirm the cancellation, because it is a deliberate act about this task.",
} as const;

// ---------------------------------------------------------------------------------------------
// Small primitives: lengths, identities and revisions
// ---------------------------------------------------------------------------------------------

/** The longest title a task or series accepts, counted in Unicode code points. */
const TITLE_MAX_LENGTH = 200;

/** The longest category label, counted in Unicode code points. */
const CATEGORY_MAX_LENGTH = 60;

/** The longest note attached to a task or series, counted in Unicode code points. */
const NOTE_MAX_LENGTH = 2000;

/** The longest cancellation reason, counted in Unicode code points. */
const CANCEL_REASON_MAX_LENGTH = 500;

/** The longest private tag, counted in Unicode code points. */
const TAG_MAX_LENGTH = 60;

/**
 * The most rows one bulk action may act on.
 *
 * A selection is bounded by the list's own page window (50 rows, capped at 200), so 200 is the
 * largest honest explicit selection; anything larger is a filter in disguise and is refused as a
 * selection this product does not offer.
 */
const SELECTION_MAX_LENGTH = 200;

/** How many next dates a series preview shows: the three the series editor fixes. */
const PREVIEW_DATE_COUNT = 3;

/** How far the plan review walks the rule when a series stalled without admitting its next date. */
const PLAN_WALK_COUNT = 12;

/** Counts a value in Unicode code points, so a script outside the Basic Multilingual Plane counts once. */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** The readable form a seeded revision takes, so a bump stays legible to whoever reads the document. */
const REVISION_COUNTER = /^rev-(\d+)$/u;

/** The readable form a revision takes once it has been derived from something that was not `rev-N`. */
const REVISION_SUFFIX = /~(\d+)$/u;

/**
 * The revision a record stands at after one accepted change.
 *
 * A revision is an opaque token whose only job is to differ from the one it replaces, so this bumps a
 * legible `rev-N` counter and otherwise derives the next unused suffix. Nothing compares two
 * revisions for order: the runner compares them for equality, which is all a stale-write check needs.
 */
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

/**
 * Mints the identity of one record this file creates.
 *
 * A record identifier is opaque: it is never derived from a payload, a date, a counter or a name, so
 * no two records can collide and nothing can be learned from its shape. The random source is the Web
 * Crypto global the runtime already provides, which keeps this module free of a Node-only import.
 */
function newRecordId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

/** Reports whether a stored document member is a plain object, as a decoded JSON object is. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------------------------
// The stored work document this file writes
// ---------------------------------------------------------------------------------------------

/**
 * One private tag applied to a task.
 *
 * A tag is the worker's own preparation rather than a property of the work, and the stored task
 * record carries no field for one, so tags live in their own collection inside the same session
 * state document. `ownerPrincipalId` states whose preparation it is: two principals may tag the same
 * task and neither sees the other's label, and a tag is never a shared fact about a partner, a
 * consent or an audience.
 */
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

/**
 * The three record families this file reads from a session's state document.
 *
 * Only the members the Work job changes are named: every other family in the document — partners,
 * gifts, content, coaching and the rest — is preserved untouched, because a document that lost a
 * family to an unrelated task edit would be a silent data loss. The task and series shapes are
 * `../envelope`'s own schemas, so this file re-states no record form.
 */
const workDocumentSchema = z.object({
  tasks: z.array(taskRecordSchema),
  series: z.array(taskSeriesRecordSchema),
  taskTags: z.array(taskTagRecordSchema).default([]),
});

/** The work families as this file holds them while a change is applied. */
type WorkDocument = {
  readonly tasks: readonly TaskRecord[];
  readonly series: readonly TaskSeriesRecord[];
  readonly taskTags: readonly TaskTagRecord[];
};

/** The work document of a session that holds none of these families yet. */
const EMPTY_WORK_DOCUMENT: WorkDocument = { tasks: [], series: [], taskTags: [] };

/**
 * Refusal raised when a session's stored work cannot be read as the records it claims to be.
 *
 * It is thrown rather than answered with an empty document on purpose: a creation applied to a state
 * document this build cannot read would overwrite families it never decoded, so refusing writes
 * nothing and leaves the document exactly as it was. The runner converts an unrecognised fault into
 * `unknown`, which is the honest answer here — the change definitively did not happen, and the caller
 * recovers by re-reading the identity it already holds rather than by repeating the effect under a
 * new one.
 */
class UnreadableWorkDocumentError extends Error {
  constructor(subject: string) {
    super(
      `This session's stored work cannot be read: ${subject}. Nothing was written, because a change applied over a document this build cannot decode would overwrite records it never read.`,
    );
    this.name = "UnreadableWorkDocumentError";
    // Keeps `instanceof` working where a built-in subclass is downlevelled past ES2015 semantics.
    Object.setPrototypeOf(this, UnreadableWorkDocumentError.prototype);
  }
}

/**
 * Reads the work families out of a session's state document.
 *
 * An absent document is an empty one — a session that holds no work has nothing to lose — while a
 * document that is present and cannot be decoded is refused through
 * {@link UnreadableWorkDocumentError}. The two are different facts, and only the second can cost a
 * record.
 */
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

/**
 * Writes the work families back beside every other family the document holds.
 *
 * The raw document is spread first, so a family this file never reads survives the change verbatim.
 * Only the three families above are replaced, and they are replaced whole, so the document cannot
 * end up holding a task twice or a series whose rule and history disagree.
 */
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

/** Reports whether a task is still waiting for an action, which is what makes a past date missed. */
function isAwaitingAction(status: TaskRecordStatus): boolean {
  return status === "open" || status === "reopened";
}

/** One task by identifier, or `undefined` when this document holds none. */
function taskOf(work: WorkDocument, taskId: string): TaskRecord | undefined {
  return work.tasks.find((task) => task.taskId === taskId);
}

/** One series by identifier, or `undefined` when this document holds none. */
function seriesOf(work: WorkDocument, seriesId: string): TaskSeriesRecord | undefined {
  return work.series.find((series) => series.seriesId === seriesId);
}

/** The occurrences a series has admitted, oldest identifier first as the document holds them. */
function occurrencesOf(work: WorkDocument, seriesId: string): readonly TaskRecord[] {
  return work.tasks.filter((task) => task.seriesId === seriesId);
}

/** The tagged preparation one principal holds, for the tags this file adds and removes. */
function tagRecordsOf(work: WorkDocument, taskId: string): readonly TaskTagRecord[] {
  return work.taskTags.filter((tag) => tag.taskId === taskId);
}

/** Replaces one task in place, keeping every other record of its family where it was. */
function withTask(work: WorkDocument, task: TaskRecord): WorkDocument {
  return {
    tasks: work.tasks.map((existing) => (existing.taskId === task.taskId ? task : existing)),
    series: work.series,
    taskTags: work.taskTags,
  };
}

/** Appends new tasks, so an admitted successor or a bulk follow-up joins the family once. */
function withNewTasks(work: WorkDocument, tasks: readonly TaskRecord[]): WorkDocument {
  return { tasks: [...work.tasks, ...tasks], series: work.series, taskTags: work.taskTags };
}

/** Replaces one series in place, keeping every other series where it was. */
function withSeries(work: WorkDocument, series: TaskSeriesRecord): WorkDocument {
  return {
    tasks: work.tasks,
    series: work.series.map((existing) =>
      existing.seriesId === series.seriesId ? series : existing,
    ),
    taskTags: work.taskTags,
  };
}

/** Replaces the private tag collection, which is how a tag is applied and removed. */
function withTaskTags(work: WorkDocument, taskTags: readonly TaskTagRecord[]): WorkDocument {
  return { tasks: work.tasks, series: work.series, taskTags };
}

// ---------------------------------------------------------------------------------------------
// Rules, as the engine reads them and as the document stores them
// ---------------------------------------------------------------------------------------------

/**
 * Reads one stated end condition as the engine's working type, or `undefined` when its date cannot be.
 *
 * An end date is a civil date the record or the payload states, so a value this calendar cannot parse
 * is reported as unreadable rather than replaced by another kind of end: an ongoing policy invented in
 * place of an unreadable date would quietly make a series endless.
 */
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

/**
 * Reads a stored rule as the recurrence engine's working type, or `undefined` when it cannot be read.
 *
 * A stored civil date that this calendar cannot parse is a defect in the record rather than something
 * a worker typed, so it is reported as "this rule cannot be read" instead of being repaired into a
 * plausible date. Every caller treats `undefined` as "no admission is possible", never as "admit
 * something".
 */
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

/** Writes the engine's working rule back into the stored form. */
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

/** The day a stored civil date names, or `undefined` when it cannot be read as one. */
function civilDateOf(value: string | null): CivilDate | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : undefined;
}

/**
 * "Today" in a series' own planning zone, or `undefined` when the zone cannot be resolved.
 *
 * A series whose zone this runtime cannot resolve claims no missed date and admits no computed
 * successor: judging its dates against an assumed zone would move work the worker never moved, so the
 * commands below leave such a series as it stands rather than guessing.
 */
function todayFor(rule: SeriesRule): CivilDate | undefined {
  const resolved = todayInZone(rule.planningTimeZone, now());
  return resolved.status === "resolved" ? resolved.date : undefined;
}

// ---------------------------------------------------------------------------------------------
// The views a mutation answers with, and the ones a replay returns verbatim
// ---------------------------------------------------------------------------------------------

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

/**
 * What a rule would produce next, as a preview.
 *
 * A preview is not a set of occurrences: only one occurrence of a series is ever actionable, and the
 * dates here are what the rule would produce. A stopped series shows none, because a stop admits
 * nothing further and dates that cannot arrive are not a plan.
 */
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

/** Projects one stored task to the view a mutation answers with. */
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

/** Projects one stored series to the view a mutation answers with. */
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

/** Turns the engine's preview into the view a mutation answers with. */
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
    return preview.reason === "end-reached"
      ? { status: "ended" }
      : { status: "unreadable", reason: preview.reason };
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

/**
 * Reviews a series' plan the way the Work read does, so the recorded flag never contradicts the view.
 *
 * The occurrences handed to the engine are the dates the plan actually produced: the stored
 * occurrences that still expect an action, plus the rule's own dates after the latest recorded
 * occurrence that have already passed. A stalled series leaves those later dates unrecorded by
 * design — only one occurrence is admitted at a time — so without them a series that missed three
 * dates would never be flagged. The threshold, the missed dates and the three resolutions stay the
 * engine's answer; nothing here decides a count or words a resolution.
 */
function planNeedsReviewNow(
  series: TaskSeriesRecord,
  occurrences: readonly TaskRecord[],
  rule: SeriesRule,
): boolean {
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

/**
 * The witness a collection reports as its revision: its size and a digest of its members' revisions.
 *
 * A bulk action has no single record to report a revision for, so it answers with the witness the Work
 * read reports for the same collection — `reads/tasks.ts` computes exactly this shape, and the two are
 * kept identical on purpose: a client that stores the revision a bulk action answered with then sees
 * the same token when it re-reads the list, and a collection that genuinely did not move answers with
 * the token it already had rather than a fresh one that would imply a change.
 */
function collectionWitness(
  family: string,
  members: readonly { readonly revision: string }[],
): string {
  const revisions = members
    .map((member) => member.revision)
    .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  let hash = 0x811c9dc5;
  const joined = revisions.join("\u0000");
  for (let index = 0; index < joined.length; index += 1) {
    hash ^= joined.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const digest = (hash >>> 0).toString(16).padStart(8, "0");
  return `${family}/${String(members.length)}/${digest}`;
}

/**
 * The target a single-task change is compared against: the task's own revision and current value.
 *
 * A task this document does not hold is `absent`, so a change to it compares no revision — there is no
 * stored value a stale expectation could overwrite — and the apply step then answers that nothing
 * needed doing. A stale expectation for the change itself is caught by the runner as `conflict`.
 */
function taskTarget(docs: MutationContext["docs"], taskId: string): CurrentTarget {
  const work = readWorkDocument(docs.state);
  const task = taskOf(work, taskId);
  return task === undefined
    ? { kind: "absent" }
    : { kind: "record", revision: task.revision, value: taskView(task) };
}

/** The target a series change is compared against: the series' own revision and current value. */
function seriesTarget(docs: MutationContext["docs"], seriesId: string): CurrentTarget {
  const work = readWorkDocument(docs.state);
  const series = seriesOf(work, seriesId);
  return series === undefined
    ? { kind: "absent" }
    : { kind: "record", revision: series.revision, value: seriesView(series) };
}

/**
 * The latest due date a series has actually completed, which a prospective edit must fall after.
 *
 * A boundary at or before this date would rewrite a plan that completed work was measured against, so
 * the engine refuses it as not prospective. Only completed occurrences count: a skipped date performed
 * nothing, and a cancelled one is not owed.
 */
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

// ---------------------------------------------------------------------------------------------
// Opening one mutation: the session it acts for, then the runner
// ---------------------------------------------------------------------------------------------

/**
 * What a caller may add to a mutation call beyond the four-field input.
 *
 * The browser path names nothing: the development-session cookie decides which session the request
 * acts for. The named form exists for the callers that hold a session id and no request scope — the
 * domain and integration tests that prove isolation by naming a seeded session, and operational
 * scripts — and it passes straight through to `resolveSession`, which refuses it outside a
 * development build. It is not a way to act as somebody: the runner re-resolves the session and
 * refuses a request whose cookie and plan disagree.
 */
export type TaskMutationOptions = {
  readonly sessionId?: string;
};

/** Either the session the mutation acts for, or the refusal to answer with. */
type MutationOpening =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly outcome: MutationOutcome };

/** The attempt identity a request states, read without trusting its type before validation. */
function attemptIdentityOf(input: unknown): string {
  if (typeof input !== "object" || input === null) {
    return "unidentified-attempt";
  }
  const candidate: unknown = Reflect.get(input, "operationId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : "unidentified-attempt";
}

/**
 * Resolves the session a mutation acts for before the runner opens its transaction.
 *
 * The runner needs the session id to key its documents and its lock, so it is resolved once here and
 * again inside the runner, which is what makes a request whose cookie and plan disagree a denial
 * rather than a write into another session. A session that cannot be established answers with the
 * refusal `resolveSession` produced, carrying this attempt's own operation id, because for a write
 * that identity is the caller's recovery handle.
 */
async function openMutation(
  input: unknown,
  options: TaskMutationOptions | undefined,
): Promise<MutationOpening> {
  const operationId = attemptIdentityOf(input);
  try {
    const resolution = await resolveSession(
      options?.sessionId === undefined ? undefined : { sessionId: options.sessionId },
    );
    return resolution.ok
      ? { ok: true, sessionId: resolution.session.sessionId }
      : { ok: false, outcome: denied({ operationId, reasonCode: resolution.denial.reasonCode }) };
  } catch {
    // Naming a session directly is refused outside a development build, and a request with no
    // request scope has no cookie: neither becomes a session by being asked for again.
    return { ok: false, outcome: denied({ operationId, reasonCode: "session-unavailable" }) };
  }
}

/**
 * The payload as this mutation's own schema reads it.
 *
 * The runner validates the payload and hands an `apply` the session and the documents, not the parsed
 * value, so a mutation reads its payload back through the same schema. That second read is what turns
 * the request's raw JSON into the trimmed, defaulted, normalised value the command acts on — a planned
 * time becomes a clock reading beside its day, blank text becomes absent, and `kind` arrives with its
 * default — so no command works from a value the schema has not read. It runs only after the runner has
 * accepted the payload, which is why a failure here is unreachable; a `ZodError` that did escape would
 * still be answered as `invalid` with its field messages rather than escaping the service.
 */
function payloadOf<P>(schema: z.ZodType<P>, input: MutationInput<P>): P {
  return schema.parse(input.payload);
}

/**
 * The authority every task and series change asks for: this principal, acting as themselves, in the
 * context the request claims.
 *
 * Admission lets a colleague read the ministry's work; it does not let them change another
 * principal's task or series, and this release has no delegation that would make it so. The claimed
 * scope is asserted by the runner before this question is asked, so the answer here adds the one fact
 * that matters for a write — the change is the caller's own.
 */
function authorizesOwnWork(
  session: ResolvedSession,
  scope: Scope,
  kind: "task" | "series",
): ScopeDecision {
  const decision = canEdit(session, { kind, scope, ownerPrincipalId: session.principalId });
  return decision.allowed ? { ok: true } : { ok: false, denial: decision.denial };
}

// ---------------------------------------------------------------------------------------------
// Payload primitives
// ---------------------------------------------------------------------------------------------

/** A title: trimmed, non-empty and bounded in code points, because a task is useful once it names itself. */
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

/**
 * A category: the worker's own short label, or none.
 *
 * Deliberately not an enum: a category is not a taxonomy, a stage or a controlled list, so there is
 * no allowed-value set to keep in step with anything else, and no list excludes an uncategorised task.
 * The schema reads the text and bounds it; the command turns text that is only whitespace into the
 * absent state, which is a complete state rather than a missing value.
 */
const categoryText = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > CATEGORY_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: WORDS.categoryTooLong });
    }
  });

/** A note: private preparation about the work, never a record of what happened. */
const noteText = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > NOTE_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: WORDS.noteTooLong });
    }
  });

/** A cancellation reason: a short explanation, and never a hidden note about a person. */
const cancelReasonText = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > CANCEL_REASON_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: WORDS.cancelReasonTooLong });
    }
  });

/** A private tag: the worker's own short label, visible to them alone. */
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

/** An opaque record identifier: a handle to one record, never parsed or compared with a name. */
const taskIdText = z.string({ error: WORDS.taskIdRequired }).trim().min(1, WORDS.taskIdRequired);

const seriesIdText = z
  .string({ error: WORDS.seriesIdRequired })
  .trim()
  .min(1, WORDS.seriesIdRequired);

const occurrenceIdText = z
  .string({ error: WORDS.occurrenceIdRequired })
  .trim()
  .min(1, WORDS.occurrenceIdRequired);

/** An optional link to another record, chosen from the options a read envelope admitted. */
const linkText = z.string({ error: WORDS.linkInvalid }).trim().min(1, WORDS.linkInvalid);

/**
 * A civil date carried as `YYYY-MM-DD` and read by `@/modules/time/civil`.
 *
 * A day past the end of its month is refused rather than rolled forward, and no time, zone or instant
 * is invented for it, so a due date stays the day the worker chose and a display-zone change never
 * rebases it.
 */
const civilDateText = z
  .string({ error: WORDS.dueDateInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom", message: WORDS.dueDateInvalid });
    }
  });

/**
 * The two accepted shapes of a planned time: a bare clock reading, or a date-and-time control's value.
 *
 * Each pattern captures the two things a plan states — the day it belongs to and the clock reading —
 * and the hour alternative is grouped so it is never captured on its own: splitting `14:30` into "14"
 * would store a time of day that no clock shows.
 */
const PLANNED_CLOCK_FORM = /^([01]\d|2[0-3]):[0-5]\d$/u;
const PLANNED_DATE_TIME_FORM = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?$/u;

/** A meeting's planned time, split into the clock reading and the day it belongs to when stated. */
type PlannedTimeValue = {
  readonly clock: string;
  readonly date: string | null;
};

/** Splits an already-validated planned time into its clock reading and its day. */
function plannedTimeOf(value: string): PlannedTimeValue {
  const withDate = PLANNED_DATE_TIME_FORM.exec(value);
  if (withDate !== null) {
    return { clock: withDate[2] ?? "00:00", date: withDate[1] ?? null };
  }
  return { clock: value, date: null };
}

/**
 * A planned wall-clock time, never converted to an instant.
 *
 * It stays a reading of a clock: the zone it is read in is the separate `timeZone` field the worker
 * discloses, so a plan is never silently placed in an assumed zone and never becomes something that
 * already happened. A date-and-time value keeps its day, which the command carries onto the task, so
 * the day a time belongs to cannot be dropped between the control and the record.
 */
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

/**
 * The clock reading and the day a validated planned time states.
 *
 * `undefined` for a value this shape does not describe: the field schema has already refused such a
 * value, so a caller reading it here treats it as no plan rather than as a plan in an assumed place.
 */
function plannedTimeFieldOf(value: string | undefined): PlannedTimeValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!PLANNED_CLOCK_FORM.test(value) && PLANNED_DATE_TIME_FORM.exec(value) === null) {
    return undefined;
  }
  return plannedTimeOf(value);
}

/** Text that is only whitespace, read as the absence of a value. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value.trim().length === 0 ? null : value;
}

/**
 * Whether this runtime can resolve a zone identifier.
 *
 * Asking the platform is the only honest test the schema can make without a clock: the build ships
 * its own time-zone data, so a list of names written here would be a second and staler source. The
 * recurrence engine re-checks the zone when it evaluates the rule, which is the check that decides
 * admission.
 */
function isResolvableTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zone a planned time or a series' plan is stated in. */
const timeZoneText = z
  .string({ error: WORDS.timeZoneInvalid })
  .trim()
  .min(1, WORDS.timeZoneInvalid)
  .refine(isResolvableTimeZone, WORDS.timeZoneInvalid);

/** The two kinds of work, listed against the stored task vocabulary so neither can go missing. */
const TASK_KIND_VALUES = ["default", "meeting"] as const satisfies readonly TaskKind[];

const taskKindValue = z.enum(TASK_KIND_VALUES, { error: WORDS.kindInvalid });

/** The closed five-profile set, taken from the recurrence engine rather than restated. */
const repeatProfileValue = z.enum(REPEAT_PROFILES, { error: WORDS.profileInvalid });

/** A whole number of periods between occurrences. */
const intervalValue = z
  .number({ error: WORDS.intervalRequired })
  .int(WORDS.intervalRequired)
  .min(1, WORDS.intervalRequired);

/** A day of the month; 31 stays expressible because a short month resolves to its final day. */
const dayOfMonthValue = z
  .number({ error: WORDS.dayOfMonthRequired })
  .int(WORDS.dayOfMonthRequired)
  .min(1, WORDS.dayOfMonthRequired)
  .max(31, WORDS.dayOfMonthRequired);

/**
 * How a series ends, in the three kinds the engine recognises.
 *
 * The ongoing arm is a policy the worker switched on rather than a missing value, so "no end" and
 * "ongoing policy on" cannot render the same. An end date is inclusive of the day it names, and a
 * count counts occurrences from the first due date.
 */
const endCountValue = z
  .number({ error: WORDS.endCountInvalid })
  .int(WORDS.endCountInvalid)
  .min(1, WORDS.endCountInvalid);

const seriesEndPayload: z.ZodType<SeriesEndRecord> = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("on-date"), on: civilDateText }),
    z.object({ kind: z.literal("after-count"), count: endCountValue }),
    z.object({ kind: z.literal("ongoing-personal-policy") }),
  ],
  { error: WORDS.endRequired },
);

/** The profiles that repeat at an interval, and the profiles that repeat on a day of the month. */
const INTERVAL_PROFILES: ReadonlySet<RepeatProfile> = new Set<RepeatProfile>([
  "everyNWeeks",
  "everyNMonths",
]);
const DAY_OF_MONTH_PROFILES: ReadonlySet<RepeatProfile> = new Set<RepeatProfile>([
  "monthlyOnDay",
  "everyNMonths",
]);

/** Whether a profile reads an interval, which is the whole of what `every N` means here. */
function takesInterval(profile: RepeatProfile): boolean {
  return INTERVAL_PROFILES.has(profile);
}

/** Whether a profile repeats on a day of the month. */
function takesDayOfMonth(profile: RepeatProfile): boolean {
  return DAY_OF_MONTH_PROFILES.has(profile);
}

/**
 * The rows one bulk action applies to: an explicit selection, and nothing else.
 *
 * At least one row and at most {@link SELECTION_MAX_LENGTH}, each row once. No filter, saved view or
 * query object can stand in for this array — a selection is the rows a worker ticked, not an audience
 * — and one repeated identifier is one issue for the selection as a whole, because the selection is
 * what has to be corrected.
 */
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

// ---------------------------------------------------------------------------------------------
// The planned-time rule every task payload shares
// ---------------------------------------------------------------------------------------------

/** The three fields the planned-time rule reads, present on every payload that can state a schedule. */
type PlannedPairing = {
  readonly kind?: TaskKind | undefined;
  readonly dueOn?: string | null | undefined;
  readonly plannedTime?: string | null | undefined;
  readonly timeZone?: string | null | undefined;
};

/**
 * The one planned-time rule: a schedule belongs to a meeting, and a time is always stated in a zone.
 *
 * Refused: an ordinary task carrying a time or a zone, because that would read as an appointment the
 * worker never made; a time with no zone, and a zone with no time, because either alone states half
 * of when the meeting is; and a time on a different day from the due date, because the two would
 * describe two different plans. Honest: a meeting stating both, and a meeting stating neither.
 */
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

// ---------------------------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------------------------

/**
 * The `createTask` payload: every field but the title is optional.
 *
 * `category` is the worker's own label rather than a taxonomy, `dueOn` is a civil date, and
 * `plannedTime` is admitted only together with the zone it is read in and the meeting kind, because a
 * planned time is a disclosed meeting fact and "planned" is not "held".
 */
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

// ---------------------------------------------------------------------------------------------
// editTask
// ---------------------------------------------------------------------------------------------

/**
 * The `editTask` payload: the task, plus whichever editable fields the caller restates.
 *
 * A field that is absent is left alone, and an explicit `null` clears it, so one payload can both
 * change a title and remove a note without the caller having to restate every other field. `kind` is
 * stated only when the shape of the work changes; switching to ordinary work clears the plan, because
 * a task that is not a meeting cannot carry a scheduled time.
 */
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

// ---------------------------------------------------------------------------------------------
// completeTask, reopenTask and cancelTask
// ---------------------------------------------------------------------------------------------

/**
 * The `completeTask` payload: an identifier and nothing else.
 *
 * There is no completion date, outcome, note or contact flag, because completing a task records that
 * the worker finished it and proves nothing about contact, payment or fulfilment — so the payload
 * holds no field in which such a claim could travel.
 */
export const completeTaskSchema = z.strictObject({ taskId: taskIdText });

/** The validated `completeTask` payload. */
export type CompleteTaskPayload = z.infer<typeof completeTaskSchema>;

/** The `reopenTask` payload: the same identifier and nothing else, because reopening is its own act. */
export const reopenTaskSchema = z.strictObject({ taskId: taskIdText });

/** The validated `reopenTask` payload. */
export type ReopenTaskPayload = z.infer<typeof reopenTaskSchema>;

/**
 * The `cancelTask` payload: the task, and the confirmation its deliberate act must carry.
 *
 * The payload must carry that confirmation: a payload that states none is refused with the
 * confirmation message, so the deliberate act is never assumed from the caller's silence. Cancelling
 * never deletes the record and never claims anything about the work, so the payload carries no
 * outcome, no contact flag and no money. A reason is accepted as the caller's own short note about why
 * the work stopped, and it is not written into the task: the stored record has no field for a
 * free-text reason, and appending one to the note would later read as history rather than as a reason.
 */
export const cancelTaskSchema = z.strictObject({
  taskId: taskIdText,
  confirmed: z.literal(true, { error: WORDS.cancellationNotConfirmed }),
  reason: cancelReasonText.optional(),
});

/** The validated `cancelTask` payload. */
export type CancelTaskPayload = z.infer<typeof cancelTaskSchema>;

// ---------------------------------------------------------------------------------------------
// The four bulk actions
// ---------------------------------------------------------------------------------------------

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

/**
 * The task a bulk create writes once per selected row: an ordinary follow-up and nothing more.
 *
 * No kind, planned time or zone, because the only plan a batch can honestly make is a due date; no
 * partner or initiative link, because each created task carries the context of its own row. No field
 * here can record contact, money or a message, so a batch of follow-ups cannot claim that anyone was
 * reached.
 */
const followUpTemplateSchema = z.strictObject({
  title: titleText,
  category: categoryText.optional(),
  dueOn: civilDateText.optional(),
  note: noteText.optional(),
});

/**
 * The `bulkCreateTasks` payload: the selection plus the follow-up template repeated once per row.
 *
 * `template` is the template's one name. `draft` is accepted as the same value because the service
 * interface documents the follow-up under that word; a request that states both is refused rather
 * than resolved by precedence, and a request that states neither has not said what to create.
 */
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

// ---------------------------------------------------------------------------------------------
// Assembling a rule from a payload, and the two refinements that judge one
// ---------------------------------------------------------------------------------------------

/**
 * The end a create payload states, resolved from its two admissible spellings.
 *
 * An `end` states the end directly, in any of the three kinds. `ongoingPolicy: true` states that the
 * qualified ongoing-personal-series policy is on, which is the same fact as the ongoing arm — the
 * flag exists so a caller can say "this series continues" without inventing an end. A request that
 * states an end date *and* the ongoing policy has stated two different ends and is refused rather
 * than resolved by precedence.
 */
function resolveCreateEnd(payload: {
  readonly end?: SeriesEndRecord | undefined;
  readonly ongoingPolicy?: true | undefined;
}): SeriesEndRecord | undefined {
  if (payload.end !== undefined) {
    return payload.end;
  }
  return payload.ongoingPolicy === true ? { kind: "ongoing-personal-policy" } : undefined;
}

/**
 * Builds the engine's working rule from the rule fields a payload states.
 *
 * `undefined` means a date in the payload cannot be read as a civil date, which the field schema has
 * already refused: the refinement then adds no second message for the same value.
 */
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

/** The fields a create payload states about its rule. */
type CreateRuleFields = {
  readonly profile: RepeatProfile;
  readonly interval?: number | undefined;
  readonly dayOfMonth?: number | undefined;
  readonly firstDueOn: string;
  readonly planningTimeZone: string;
  readonly end?: SeriesEndRecord | undefined;
  readonly ongoingPolicy?: true | undefined;
};

/**
 * Judges a create payload's rule with the engine's own validator and places each message on its field.
 *
 * The end condition is resolved first, because "no end" and "the ongoing policy is on" are different
 * statements and a payload that states neither has not finished describing a repeat. Everything else —
 * a profile outside the closed set, an interval a profile does not read, a day of the month a profile
 * does not read, an end date before the first due date — is `validateSeriesRule`'s answer, mapped onto
 * the payload's own field paths so the editor can place each message beside its control.
 */
function refineCreateRule(value: CreateRuleFields, ctx: z.RefinementCtx): void {
  const ambiguous =
    value.ongoingPolicy === true &&
    value.end !== undefined &&
    value.end.kind !== "ongoing-personal-policy";
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

/**
 * Judges the rule fields a prospective edit *does* restate.
 *
 * A this-and-future edit merges into the rule already in force, so the fields it leaves out keep the
 * values the series holds and cannot be judged here. What can be judged is what the payload states:
 * a stated profile must carry the interval and day of the month it reads and no others, and a stated
 * zone must resolve. The merged rule is validated again when the command runs.
 */
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

// ---------------------------------------------------------------------------------------------
// createSeries
// ---------------------------------------------------------------------------------------------

/**
 * The `createSeries` payload: a title, the closed repeat rule, and the dates the rule counts from.
 *
 * A series cannot be created without the three things that make its repeat meaningful — the first due
 * date, the planning time zone that date is a date in, and an end — and the ongoing arm states the
 * qualified ongoing policy as a deliberate choice rather than as a missing value. `partnerId` is an
 * optional link the created occurrence carries, chosen from the options a read envelope admitted.
 */
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

// ---------------------------------------------------------------------------------------------
// editOccurrence
// ---------------------------------------------------------------------------------------------

/**
 * The `editOccurrence` payload: this one date's own work, and no rule field at all.
 *
 * Changing the profile, interval, day of the month, end, first due date or planning zone is
 * `editThisAndFuture`'s job, so those fields are missing here rather than optional: a single-date edit
 * cannot carry a new rule, and no caller has to know which fields would be ignored. `seriesId` may be
 * stated as a second reference, and it never decides which record is changed — the occurrence names
 * its own series, so a second reference cannot disagree with the first.
 */
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

// ---------------------------------------------------------------------------------------------
// editThisAndFuture
// ---------------------------------------------------------------------------------------------

/**
 * The `editThisAndFuture` payload: a prospective boundary plus the rule fields the edit restates.
 *
 * It deliberately carries no `firstDueOn`: the anchor a count-limited end counts from is fixed when the
 * series is created, and restating it here would re-base dates that must stay where they are. Every
 * rule field is optional, so an edit that changes only the repeat profile does not have to restate the
 * zone or the end — the fields it leaves out keep the values the series holds.
 */
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

// ---------------------------------------------------------------------------------------------
// skipOccurrence
// ---------------------------------------------------------------------------------------------

/**
 * The `skipOccurrence` payload: one occurrence and nothing else.
 *
 * There is no completion date, outcome, note or reason, because skipping answers the date rather than
 * performing the work: it admits at most one successor, records no contact and completes nothing, so
 * the payload holds no field in which a completion claim could travel. One identifier, never a list —
 * only one date of a series is actionable.
 */
export const skipOccurrenceSchema = z.strictObject({
  occurrenceId: occurrenceIdText,
  seriesId: seriesIdText.optional(),
});

/** The validated `skipOccurrence` payload. */
export type SkipOccurrencePayload = z.infer<typeof skipOccurrenceSchema>;

// ---------------------------------------------------------------------------------------------
// pauseSeries, resumeSeries and stopSeries
// ---------------------------------------------------------------------------------------------

/**
 * The `pauseSeries` payload: an identifier and nothing else.
 *
 * Pausing stops future admission and leaves the plan intact, so there is no field for a reason, a
 * resume date or a rescheduled occurrence: each of those would be an edit to the plan that pausing does
 * not perform.
 */
export const pauseSeriesSchema = z.strictObject({ seriesId: seriesIdText });

/** The validated `pauseSeries` payload. */
export type PauseSeriesPayload = z.infer<typeof pauseSeriesSchema>;

/** The `resumeSeries` payload: the same identifier, because resuming restates nothing. */
export const resumeSeriesSchema = z.strictObject({ seriesId: seriesIdText });

/** The validated `resumeSeries` payload. */
export type ResumeSeriesPayload = z.infer<typeof resumeSeriesSchema>;

/**
 * The `stopSeries` payload: the series, and what becomes of the work it leaves behind.
 *
 * `unfinishedWork` is the explicit choice the stop makes — `keep` leaves the outstanding occurrence
 * open with its own fate still to decide, `cancel` ends it. When the payload states neither, the
 * outstanding work is kept: a stop that silently cancelled someone's work would decide something the
 * worker never said. The payload carries no disposition beyond that choice, because a stop is not a
 * completion and claims nothing about anyone having been contacted.
 */
export const stopSeriesSchema = z.strictObject({
  seriesId: seriesIdText,
  unfinishedWork: z.enum(["keep", "cancel"], { error: WORDS.unfinishedWorkInvalid }).optional(),
});

/** The validated `stopSeries` payload. */
export type StopSeriesPayload = z.infer<typeof stopSeriesSchema>;

// ---------------------------------------------------------------------------------------------
// resolveMissedPlan
// ---------------------------------------------------------------------------------------------

/**
 * The three resolutions a plan in review offers, in the engine's own vocabulary.
 *
 * The review panel offers exactly these, and the shorter spellings are accepted as the same three
 * resolutions because the service interface documents them that way: `keep-occurrence` is
 * `keep-this-occurrence`, `move-next-forward` is `move-next-date-forward`, and `stop-series` is
 * itself. Each pair names one act, so a fourth resolution cannot reach a request body through here.
 */
const RESOLUTION_SPELLINGS = [
  "keep-this-occurrence",
  "keep-occurrence",
  "move-next-date-forward",
  "move-next-forward",
  "stop-series",
] as const;

/** One resolution as the engine names it. */
type PlanResolution = "keep-this-occurrence" | "move-next-date-forward" | "stop-series";

/** The one resolution a stated spelling names: keep this occurrence, move the next date, or stop. */
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

/**
 * The `resolveMissedPlan` payload: the occurrence under review and one of the three resolutions.
 *
 * No date travels, because the next date a resolution produces is computed by the recurrence engine in
 * the series' own planning zone rather than chosen in the request, and no `seriesId` is needed: the
 * occurrence names its series.
 */
export const resolveMissedPlanSchema = z.strictObject({
  occurrenceId: occurrenceIdText,
  seriesId: seriesIdText.optional(),
  resolution: z.enum(RESOLUTION_SPELLINGS, { error: WORDS.resolutionRequired }),
});

/** The validated `resolveMissedPlan` payload. */
export type ResolveMissedPlanPayload = z.infer<typeof resolveMissedPlanSchema>;

// ---------------------------------------------------------------------------------------------
// Ending one occurrence, and the successor a series may admit
// ---------------------------------------------------------------------------------------------

/**
 * The day a task's work is planned for.
 *
 * A due date is the day the worker chose, as a civil date. A planned time that states its own day
 * carries that day, because a meeting's clock reading belongs to the date it was entered with; the
 * payload schema refuses a planned time whose day disagrees with a stated due date, so the two can
 * never describe two plans here.
 */
function plannedOrDue(plannedDay: string | null, dueOn: string | null): string | null {
  return plannedDay ?? dueOn;
}

/**
 * What ending one occurrence did: the document, the ended task, its series and the successor admitted.
 *
 * `successor` is present only when the series admitted one, which is at most once per ended
 * occurrence. `series` is the series as it now stands, or `null` when the task belongs to none.
 */
type OccurrenceEffect = {
  readonly work: WorkDocument;
  readonly ended: TaskRecord;
  readonly series: TaskSeriesRecord | null;
  readonly successor: TaskRecord | null;
};

/**
 * Ends one occurrence of a series and admits at most one successor — the single implementation behind
 * completing a task, skipping an occurrence and completing a selection in bulk.
 *
 * `nextStatus` says how the occurrence ends: `completed` when the work was done, `cancelled` when the
 * date was answered without doing it. Neither records an interaction, a message or a financial fact,
 * because finishing or skipping a reminder proves nothing about what happened.
 *
 * The successor is the engine's answer, not a calculation here: `admitSuccessor` refuses a series that
 * has ended, is paused, is stopped, or already admitted this occurrence's successor, and this function
 * maps that refusal onto the series rather than creating a second date. A series that has run out of
 * dates has no current occurrence afterwards, which is the honest state of a plan with nothing left.
 *
 * A successor is a fresh, ordinary task: it carries the series' title and the occurrence's own label,
 * note and links, but no planned time — one meeting's clock reading is not the next date's plan — and
 * it starts open with its own revision.
 */
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
      series: work.series.map((existing) =>
        existing.seriesId === series.seriesId ? nextSeries : existing,
      ),
      taskTags: work.taskTags,
    },
    ended,
    series: nextSeries,
    successor,
  };
}

/**
 * The editable fields a task edit may restate.
 *
 * Absent means "leave it as it is" and `null` means "clear it", which is why the two are different
 * types rather than one optional value: a caller that clears a note and a caller that says nothing
 * about it are saying different things.
 */
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

/**
 * The editable fields an edit payload states, read as the values a task holds.
 *
 * Absent stays absent, which means "leave it as it is"; `null` stays `null`, which means "clear it";
 * text that is only whitespace is read as cleared, because a blank label is the absence of a label
 * rather than a label with no letters; and a planned time is read as the clock reading and the day it
 * states, so the plan a task keeps is the plan the worker entered.
 */
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
  const planned =
    payload.plannedTime === undefined
      ? undefined
      : payload.plannedTime === null
        ? null
        : (plannedTimeFieldOf(payload.plannedTime) ?? null);

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

/**
 * The task as one edit leaves it, with the plan rule applied in one place.
 *
 * A field the payload leaves out keeps its stored value; a field stated as `null` clears it. The plan
 * follows the kind: an ordinary task carries no time and no zone, so choosing ordinary work removes a
 * plan rather than leaving half of one behind, and a stated time without a re-stated zone keeps the
 * zone the plan was already read in.
 */
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

/** Reports whether two tasks state the same fields, ignoring the revision a change would mint. */
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

// ---------------------------------------------------------------------------------------------
// The per-item result a bulk action reports
// ---------------------------------------------------------------------------------------------

/** Why one row of a selection was not changed. Readable, and never a fact about the row's content. */
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
    message:
      "This row carries that tag as another person's private preparation, so it was left as it was.",
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

/** One row's result, built in one place so the four states read the same wherever they appear. */
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

/** A row the action changed. */
function itemAccepted(taskId: string, revision: string, createdTaskId?: string): BulkItemView {
  return bulkItem({ taskId, state: "accepted", revision, createdTaskId: createdTaskId ?? null });
}

/** A row the action left alone because nothing needed doing. */
function itemUnchanged(
  taskId: string,
  revision: string,
  reason: { readonly code: string; readonly message: string },
): BulkItemView {
  return bulkItem({ taskId, state: "unchanged", revision, reason });
}

/** A row that was no longer eligible when the action ran. */
function itemExcluded(
  taskId: string,
  reason: { readonly code: string; readonly message: string },
): BulkItemView {
  return bulkItem({ taskId, state: "excluded", reason });
}

/** A row whose change could not be written without contradicting another stored fact. */
function itemFailed(
  taskId: string,
  reason: { readonly code: string; readonly message: string },
): BulkItemView {
  return bulkItem({ taskId, state: "failed", reason });
}

/** One row's result as the outcome carries it, so a surface can switch on the state and the code. */
function perItemOf(item: BulkItemView): PerItemResult<BulkItemState> {
  return {
    targetId: item.taskId,
    state: item.state,
    ...(item.revision === null ? {} : { revision: item.revision }),
    ...(item.reasonCode === null ? {} : { reasonCode: item.reasonCode }),
    ...(item.reason === null ? {} : { reason: item.reason }),
  };
}

/** The answer a bulk action gives: one result per row and the counts derived from those results. */
function bulkResult(items: readonly BulkItemView[]): BulkResultView {
  const countOf = (state: BulkItemState): number =>
    items.filter((item) => item.state === state).length;
  return {
    items,
    acceptedCount: countOf("accepted"),
    unchangedCount: countOf("unchanged"),
    excludedCount: countOf("excluded"),
    failedCount: countOf("failed"),
    createdTaskIds: items.flatMap((item) =>
      item.createdTaskId === null ? [] : [item.createdTaskId],
    ),
  };
}

/**
 * Whether every row of a selection was left alone because nothing needed doing.
 *
 * It is the one case that answers `unchanged` rather than `accepted`, because a selection in which
 * every row was already in the requested state changed nothing at all. A selection in which rows were
 * *excluded* is not this case: those rows were not already done, they were no longer eligible, and the
 * caller has to see one result per row to learn that.
 */
function everyRowUnchanged(items: readonly BulkItemView[]): boolean {
  return items.length > 0 && items.every((item) => item.state === "unchanged");
}

// ---------------------------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------------------------

/** What `createTask` answers with: the task as it now stands. */
export type CreateTaskResult = {
  readonly task: TaskView;
};

/**
 * Creates one ordinary or meeting task.
 *
 * Job: record a piece of work the worker means to do, with only a title required. Outcomes:
 * `accepted` with the created task; `invalid` with per-field messages for a payload that states an
 * impossible schedule; `denied` when the caller may not act in the claimed context; `unavailable` or
 * `unknown` when the store could not complete the request.
 */
export async function createTask(
  input: MutationInput<CreateTaskPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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

// ---------------------------------------------------------------------------------------------
// editTask
// ---------------------------------------------------------------------------------------------

/** What `editTask` answers with: the task as it now stands. */
export type EditTaskResult = {
  readonly task: TaskView;
};

/**
 * Changes whichever editable fields of one task the caller restates.
 *
 * Job: correct the work itself — its title, label, due date, kind, plan, note or links — without
 * rewriting what the task's history means. Outcomes: `accepted` with the task as it now stands;
 * `unchanged` when the payload states nothing different, or when the task is not this principal's or
 * no longer exists; `conflict` when the caller's revision is stale; `invalid` with per-field messages.
 */
export async function editTask(
  input: MutationInput<EditTaskPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const payload = payloadOf(editTaskSchema, input);
      const work = readWorkDocument(docs.state);
      const task = taskOf(work, payload.taskId);
      if (task === undefined || task.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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

// ---------------------------------------------------------------------------------------------
// completeTask
// ---------------------------------------------------------------------------------------------

/** What `completeTask` answers with: the finished task, its series and the successor it admitted. */
export type CompleteTaskResult = {
  readonly task: TaskView;
  readonly series: SeriesView | null;
  readonly successorTaskId: string | null;
};

/**
 * Marks one task complete.
 *
 * Job: record that the worker finished this piece of work. Completion proves nothing about contact,
 * payment or fulfilment and never writes an interaction — a held meeting is recorded through
 * `logInteraction` — and when the task is the actionable occurrence of a series, completing it admits
 * at most one successor and never a cascade. Outcomes: `accepted`; `unchanged` when the task is
 * already complete or cancelled, is not this principal's, no longer exists, or a repeat of the same
 * completion arrives; `conflict` when the caller's revision is stale.
 */
export async function completeTask(
  input: MutationInput<CompleteTaskPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const work = readWorkDocument(docs.state);
      const task = taskOf(work, payloadOf(completeTaskSchema, input).taskId);
      if (task === undefined || task.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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

// ---------------------------------------------------------------------------------------------
// reopenTask
// ---------------------------------------------------------------------------------------------

/** What `reopenTask` answers with: the task as it now stands. */
export type ReopenTaskResult = {
  readonly task: TaskView;
};

/**
 * Reopens a completed or cancelled task.
 *
 * Job: put the work back on the list without creating a second record, because reopening is its own
 * deliberate act and never an edit of the status field. Outcomes: `accepted` with the reopened task;
 * `unchanged` when the task is already open or reopened, is not this principal's, or no longer exists;
 * `conflict` when the caller's revision is stale.
 */
export async function reopenTask(
  input: MutationInput<ReopenTaskPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const work = readWorkDocument(docs.state);
      const task = taskOf(work, payloadOf(reopenTaskSchema, input).taskId);
      if (task === undefined || task.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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

// ---------------------------------------------------------------------------------------------
// cancelTask
// ---------------------------------------------------------------------------------------------

/** What `cancelTask` answers with: the cancelled task, still on the record. */
export type CancelTaskResult = {
  readonly task: TaskView;
};

/**
 * Cancels one open task.
 *
 * Job: end a piece of work that is no longer owed, explaining its fate without deleting the record and
 * without claiming anything was done. Outcomes: `accepted` with the cancelled task; `unchanged` when
 * the task is already cancelled or completed, is not this principal's, or no longer exists; `conflict`
 * when the caller's revision is stale; `invalid` when the confirmation the composer produces is
 * absent.
 */
export async function cancelTask(
  input: MutationInput<CancelTaskPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const work = readWorkDocument(docs.state);
      const task = taskOf(work, payloadOf(cancelTaskSchema, input).taskId);
      if (task === undefined || task.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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

// ---------------------------------------------------------------------------------------------
// bulkApplyTag
// ---------------------------------------------------------------------------------------------

/**
 * Applies one private tag to each selected task.
 *
 * Job: mark the rows the worker ticked with their own short label, visible to them alone. Every row is
 * re-checked when the action runs, and each answers with its own result — `accepted`, `unchanged` when
 * it already carries the tag, `excluded` when it is no longer eligible, or `failed` when the tag is
 * another person's preparation — never one outcome for the selection. Outcomes: `accepted` with
 * per-item results; `unchanged` when every row already carried the tag; `invalid` for an empty or
 * over-large selection.
 */
export async function bulkApplyTag(
  input: MutationInput<BulkApplyTagPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
          items.push(
            existing.ownerPrincipalId === session.principalId
              ? itemUnchanged(taskId, task.revision, BULK_REASONS.alreadyTagged)
              : itemFailed(taskId, BULK_REASONS.tagOwnedElsewhere),
          );
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

// ---------------------------------------------------------------------------------------------
// bulkRemoveTag
// ---------------------------------------------------------------------------------------------

/**
 * Removes one private tag from each selected task.
 *
 * Job: take back the worker's own label. Removing a tag leaves the tasks themselves untouched, because
 * a tag is preparation rather than the work. Outcomes: `accepted` with per-item results; `unchanged`
 * when no selected row carries the tag; `invalid` for an empty or over-large selection.
 */
export async function bulkRemoveTag(
  input: MutationInput<BulkRemoveTagPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
        work.taskTags.filter(
          (record) => !(record.tag === payload.tag && removed.has(record.taskId)),
        ),
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

// ---------------------------------------------------------------------------------------------
// bulkCreateTasks
// ---------------------------------------------------------------------------------------------

/**
 * Creates one ordinary follow-up task for each selected row.
 *
 * Job: turn a review of several relationships into the next steps, without promising anything on
 * anyone's behalf. The selected rows are the context rather than the content: each created task stays
 * linked to its own row's partner or initiative, and no text, note or link is copied from one row into
 * another. Outcomes: `accepted` with per-item results and the created task identifiers; `unchanged`
 * when no selected row was eligible; `invalid` for an empty selection or a payload that states no
 * template.
 */
export async function bulkCreateTasks(
  input: MutationInput<BulkCreateTasksPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
        // No row was eligible, so the caller learns that from one result per row. The document is
        // rewritten as it stands, so nothing is lost and no revision moves for any task.
        writeWorkDocument(docs, work);
        return {
          changed: true,
          revision: collectionWitness("tasks", work.tasks),
          result: bulkResult(items),
          items: items.map(perItemOf),
        };
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

// ---------------------------------------------------------------------------------------------
// bulkCompleteTasks
// ---------------------------------------------------------------------------------------------

/**
 * Completes each selected task that can be completed on its own.
 *
 * Job: finish several pieces of work in one deliberate step. A row is completed only when it is still
 * open and still this principal's; a cancelled row is excluded because nothing there is owed, and a
 * completed row is unchanged rather than failed. Completing an occurrence of a series admits at most
 * one successor per row, exactly as `completeTask` does, and no completion claims that anybody was
 * contacted or that anything was given. Outcomes: `accepted` with per-item results; `unchanged` when
 * every selected row was already complete; `invalid` for an empty or over-large selection.
 */
export async function bulkCompleteTasks(
  input: MutationInput<BulkCompleteTasksPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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

// ---------------------------------------------------------------------------------------------
// createSeries
// ---------------------------------------------------------------------------------------------

/** What `createSeries` answers with: the series, its one actionable occurrence and the preview. */
export type CreateSeriesResult = {
  readonly series: SeriesView;
  readonly occurrence: TaskView;
  readonly preview: SeriesPreviewView;
  readonly firstOccurrence: PreviewResolution | null;
};

/**
 * The rule a create payload describes, or `undefined` when it does not describe a usable one.
 *
 * One assembly for the command itself: the end condition, the engine's working rule and the engine's
 * own validation in that order, so a series is never stored with a rule that could not admit a date.
 */
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

/**
 * Creates a repeating task: its closed rule, its first rule revision and its one actionable occurrence.
 *
 * Job: describe a repeat the worker means, starting from a date they chose. The first due date anchors
 * the series and is never recomputed from the rule; the planning time zone is stored with it, so a
 * display change never moves any date; and a monthly day that does not exist in a month resolves to
 * that month's final day with the resolution disclosed rather than moved silently. Exactly one
 * occurrence is actionable when the series is created, and the answer carries the next three dates as
 * previews. Outcomes: `accepted` with the series, the occurrence and the preview; `invalid` with
 * per-field messages for a rule the engine refuses; `denied` when the caller may not act in the
 * claimed context; `unavailable` or `unknown` when the store could not complete the request.
 */
export async function createSeries(
  input: MutationInput<CreateSeriesPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
      const anchoredAtStart =
        rule.firstDueOn.year === 1 && rule.firstDueOn.month === 1 && rule.firstDueOn.day === 1;
      const firstPreview = nextOccurrences(
        rule,
        anchoredAtStart ? rule.firstDueOn : rule.firstDueOn.subtract({ days: 1 }),
        1,
      );
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

// ---------------------------------------------------------------------------------------------
// editOccurrence
// ---------------------------------------------------------------------------------------------

/** What `editOccurrence` answers with: the date as it now stands, and the series it belongs to. */
export type EditOccurrenceResult = {
  readonly series: SeriesView;
  readonly occurrence: TaskView;
};

/**
 * Changes this one date's own work, leaving the rule and every other date alone.
 *
 * Job: correct the work of the date in force — its title, label, due date, kind, plan or note — without
 * changing what the series will produce next. Completed or cancelled history is not rewritten: a date
 * that has already ended answers `unchanged`, because reopening is `reopenTask`'s act. Outcomes:
 * `accepted` with the date and its series; `unchanged` when the task is not an occurrence, is not this
 * principal's, has already ended, or the payload changes nothing; `conflict` when the revision is
 * stale.
 */
export async function editOccurrence(
  input: MutationInput<EditOccurrencePayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const payload = payloadOf(editOccurrenceSchema, input);
      const work = readWorkDocument(docs.state);
      const occurrence = taskOf(work, payload.occurrenceId);
      if (occurrence === undefined || occurrence.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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

      const next = mergedTask(
        occurrence,
        editableFieldsOf(payload),
        nextRevision(occurrence.revision),
      );
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

// ---------------------------------------------------------------------------------------------
// editThisAndFuture
// ---------------------------------------------------------------------------------------------

/** What `editThisAndFuture` answers with: the series, its rule revision and the date in force. */
export type EditThisAndFutureResult = {
  readonly series: SeriesView;
  readonly occurrence: TaskView | null;
  readonly effectiveFrom: string;
  readonly revisionId: string;
  readonly preview: SeriesPreviewView | null;
};

/**
 * Revises the plan from an explicit boundary onward, leaving everything before it untouched.
 *
 * Job: change the repeat for future dates — its profile, interval, day of the month, end, zone, title or
 * the label its next date inherits — without rewriting what completed, skipped or cancelled history was
 * measured against. The engine appends a rule revision with the effective boundary and refuses a
 * boundary that falls inside history or before the rule now in force. A series that has been stopped
 * takes no revision at all, so a stale edit composed before the stop changes nothing. Outcomes:
 * `accepted` with the series and the new revision; `unchanged` when the edit is not prospective, is
 * stale, changes nothing, or the series has already stopped; `conflict` when the caller's revision is
 * stale.
 */
export async function editThisAndFuture(
  input: MutationInput<EditThisAndFuturePayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const payload = payloadOf(editThisAndFutureSchema, input);
      const work = readWorkDocument(docs.state);
      const series = seriesOf(work, payload.seriesId);
      if (series === undefined || series.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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
        ...(payload.planningTimeZone === undefined
          ? {}
          : { planningTimeZone: payload.planningTimeZone }),
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
      const current =
        series.currentOccurrenceId === null ? undefined : taskOf(work, series.currentOccurrenceId);
      if (
        current !== undefined &&
        isAwaitingAction(current.status) &&
        (payload.category !== undefined || payload.note !== undefined)
      ) {
        movedOccurrence = {
          ...current,
          category:
            payload.category === undefined ? current.category : blankToNull(payload.category),
          note: payload.note === undefined ? current.note : blankToNull(payload.note),
          revision: nextRevision(current.revision),
        };
      }

      const nextSeries: TaskSeriesRecord = {
        ...drafted,
        planNeedsReview: planNeedsReviewNow(drafted, occurrences, merged),
        revision: nextRevision(series.revision),
      };

      const withRule: WorkDocument = withSeries(
        movedOccurrence === null ? work : withTask(work, movedOccurrence),
        nextSeries,
      );
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
        changedIds:
          movedOccurrence === null
            ? [nextSeries.seriesId]
            : [nextSeries.seriesId, movedOccurrence.taskId],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// skipOccurrence
// ---------------------------------------------------------------------------------------------

/** What `skipOccurrence` answers with: the answered date and the successor the series admitted. */
export type SkipOccurrenceResult = {
  readonly series: SeriesView;
  readonly occurrence: TaskView;
  readonly successorTaskId: string | null;
};

/**
 * Answers one date without performing it.
 *
 * Job: let the worker say "not this one" about the date in force. Skipping is not completion: the date
 * ends cancelled, records no contact and completes nothing, and the series admits at most one successor
 * — a second skip of the same date answers `unchanged` rather than growing a second one. A paused or
 * stopped series answers nothing further, so a date composed before a pause or a stop is left as it
 * stands. Outcomes: `accepted`; `unchanged` when the date is not the series' current one, has already
 * ended, belongs to a series that admits nothing, is not this principal's, or the payload changes
 * nothing; `conflict` when the caller's revision is stale.
 */
export async function skipOccurrence(
  input: MutationInput<SkipOccurrencePayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const payload = payloadOf(skipOccurrenceSchema, input);
      const work = readWorkDocument(docs.state);
      const occurrence = taskOf(work, payload.occurrenceId);
      if (occurrence === undefined || occurrence.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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

// ---------------------------------------------------------------------------------------------
// pauseSeries and resumeSeries
// ---------------------------------------------------------------------------------------------

/** What pausing or resuming a series answers with: the series and what it would produce next. */
export type SeriesStateResult = {
  readonly series: SeriesView;
  readonly preview: SeriesPreviewView | null;
};

/** What a series would produce next, or `null` when its stored rule cannot be read as one. */
function previewFor(series: TaskSeriesRecord): SeriesPreviewView | null {
  const rule = toEngineRule(series.currentRule);
  return rule === undefined ? null : previewView(series, rule);
}

/**
 * Pauses a series.
 *
 * Job: stop future admission without ending the plan, so nothing is completed and nothing is
 * cancelled. Outcomes: `accepted` with the paused series; `unchanged` when it is already paused, has
 * already stopped, is not this principal's, or no longer exists; `conflict` when the revision is stale.
 */
export async function pauseSeries(
  input: MutationInput<PauseSeriesPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const payload = payloadOf(pauseSeriesSchema, input);
      const work = readWorkDocument(docs.state);
      const series = seriesOf(work, payload.seriesId);
      if (series === undefined || series.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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

/**
 * Resumes a paused series.
 *
 * Job: let a paused plan admit occurrences again. Resuming admits future dates only: the dates that
 * passed while it was paused are not back-filled into an overdue stack, and the plan review decides
 * afterwards whether the plan itself needs attention. Outcomes: `accepted` with the resumed series;
 * `unchanged` when it is not paused — a stopped series is never revived by this call — or when it is
 * not this principal's; `conflict` when the revision is stale.
 */
export async function resumeSeries(
  input: MutationInput<ResumeSeriesPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const payload = payloadOf(resumeSeriesSchema, input);
      const work = readWorkDocument(docs.state);
      const series = seriesOf(work, payload.seriesId);
      if (series === undefined || series.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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

// ---------------------------------------------------------------------------------------------
// stopSeries
// ---------------------------------------------------------------------------------------------

/** What stopping a series answers with: the series and the fate of the work it leaves behind. */
export type StopSeriesResult = {
  readonly series: SeriesView;
  readonly unfinishedWork: "keep" | "cancel";
  readonly keptTaskIds: readonly string[];
  readonly cancelledTaskIds: readonly string[];
};

/**
 * Stops a series and states what happens to its unfinished work.
 *
 * Job: close the plan. A stop admits nothing further and never completes anything, so the outstanding
 * date is either left open with its own fate to decide (`keep`, the choice a payload that states none
 * receives) or ended as cancelled (`cancel`); both are stated in the answer, because a stop that
 * silently decided the fate of someone's work would be deciding something the worker never said. A
 * stopped series also cannot be revived: every later edit, skip, pause, resume or resolution answers
 * `conflict` when it is stale and `unchanged` when the caller has already seen the stop. Outcomes:
 * `accepted`; `unchanged` when the series has already stopped, is not this principal's, or does not
 * exist; `conflict` when the revision is stale.
 */
export async function stopSeries(
  input: MutationInput<StopSeriesPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const payload = payloadOf(stopSeriesSchema, input);
      const work = readWorkDocument(docs.state);
      const series = seriesOf(work, payload.seriesId);
      if (series === undefined || series.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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

// ---------------------------------------------------------------------------------------------
// resolveMissedPlan
// ---------------------------------------------------------------------------------------------

/** What resolving a plan in review answers with: the series, the date in force and the choice made. */
export type ResolveMissedPlanResult = {
  readonly series: SeriesView;
  readonly occurrence: TaskView | null;
  readonly resolution: PlanResolution;
  readonly preview: SeriesPreviewView | null;
};

/**
 * Resolves a series whose plan needs review with one of exactly three acts.
 *
 * Job: replace a stalled plan with a decision instead of an overdue stack. `keep-this-occurrence` keeps
 * the date in force and records that the plan was looked at; `move-next-date-forward` moves that date
 * to the next one the rule produces from today, so a catch-up sequence is never manufactured;
 * `stop-series` closes the series and keeps its outstanding work open. No resolution claims a
 * conversation happened or completes anything. Outcomes: `accepted` with the series and the date;
 * `unchanged` when the series is not active, the date is not its current one, the rule produces no next
 * date to move to, is not this principal's, or does not exist; `conflict` when the revision is stale.
 */
export async function resolveMissedPlan(
  input: MutationInput<ResolveMissedPlanPayload>,
  options?: TaskMutationOptions,
): Promise<MutationOutcome> {
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
    apply: ({ docs, session }) => {
      const payload = payloadOf(resolveMissedPlanSchema, input);
      const work = readWorkDocument(docs.state);
      const occurrence = taskOf(work, payload.occurrenceId);
      if (occurrence === undefined || occurrence.ownerPrincipalId !== session.principalId) {
        return { changed: false };
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
          planNeedsReview: planNeedsReviewNow(
            drafted,
            occurrencesOf(movedWork, series.seriesId),
            rule,
          ),
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
