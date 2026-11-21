/** The closed repeat rule behind recurring tasks: the domain half of success criterion 13. */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { newOperationId } from "@/lib/ids";
import { type MutationInput, type ReadAction, type Scope, mutations, reads } from "@/modules/data-service";
import { resolveSession } from "@/modules/data-service/authorize";
import { isOutcome, type AcceptedOutcome, type ConflictOutcome, type InvalidOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { DEFAULT_SESSION_ID, type SeededSessionDocuments, seed } from "@/modules/dev-runtime/seed";
import { advanceClock, setClock } from "@/modules/dev-runtime/scenario";
import { resetSession } from "@/modules/store/repository";
import { now } from "@/modules/time/clock";
import { REPEAT_PROFILES, SERIES_STATES, type SeriesRule, monthlyOnDay, nextOccurrences, validateSeriesRule } from "@/modules/time/recurrence";
const SESSION_ID = "domain-recurrence";
const PLANNING_ZONE = "Europe/London";
const DISPLAY_ZONE = "Europe/London";
const SEED_DAY = "2026-11-20";
const WEEK_AFTER_SEED_DAY = "2026-11-27";
const TWO_WEEKS_AFTER_SEED_DAY = "2026-12-04";
const THREE_WEEKS_AFTER_SEED_DAY = "2026-12-11";
const THREE_WEEKS_MS = 21 * 24 * 60 * 60 * 1000;
const NO_STORED_REVISION = "nothing-stored-yet";
type SeriesEnvelope = Extract<Awaited<ReturnType<typeof reads.series.readSeries>>, { kind: "envelope" }>["envelope"];
type SeriesReading = SeriesEnvelope["data"];
type TaskListRow = Extract<Awaited<ReturnType<typeof reads.work.listTasks>>, { kind: "envelope" }>["envelope"]["data"]["tasks"][number];
type TaskListName = Parameters<typeof reads.work.listTasks>[0]["list"];
type CreateSeriesPayload = Parameters<typeof mutations.series.createSeries>[0]["payload"];
type ResolveMissedPlanPayload = Parameters<typeof mutations.series.resolveMissedPlan>[0]["payload"];
let seededDocuments: SeededSessionDocuments | undefined;
let seededScope: Scope | undefined;
function day(value: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(value);
}
function todayInPlanningZone(): string {
  return now().toZonedDateTimeISO(PLANNING_ZONE).toPlainDate().toString();
}
async function laySeededDocuments(): Promise<void> {
  if (seededDocuments === undefined) throw new Error("No seeded documents were built, so this case has no world to start from.");
  await resetSession(SESSION_ID, { state: structuredClone(seededDocuments.state), operations: structuredClone(seededDocuments.operations), meta: structuredClone(seededDocuments.meta) });
}
async function restoreSeedInstant(): Promise<void> {
  const restored = await setClock(SESSION_ID, 0);
  if (!restored.ok) throw new Error(`Restoring the scenario clock to the seed instant failed: ${restored.error.message}`);
}
beforeAll(async () => {
  const sessions = await seed();
  const established = sessions.find((candidate) => candidate.sessionId === DEFAULT_SESSION_ID);
  if (established === undefined) throw new Error(`The seed lays down no session ${JSON.stringify(DEFAULT_SESSION_ID)}, so no recurrence case has a world to start from.`);
  seededDocuments = established.documents;
  await laySeededDocuments();
  const resolved = await resolveSession({ sessionId: SESSION_ID });
  if (!resolved.ok) throw new Error(`The seeded session did not resolve, so no case has an authority to act under: ${JSON.stringify(resolved.refusal)}`);
  if (resolved.session.selected === null) throw new Error("The seeded established worker selects no context, so no series could be created under an authority it never chose.");
  seededScope = resolved.session.selected;
});
beforeEach(async () => {
  await laySeededDocuments();
  await restoreSeedInstant();
});
afterEach(async () => {
  await restoreSeedInstant();
});
function authority(): Scope {
  if (seededScope === undefined) throw new Error("The seeded session's authority was not resolved before this case started.");
  return seededScope;
}
function source(): { sessionId: string } {
  return { sessionId: SESSION_ID };
}
function inputOf<P>(payload: P, expectedRevision: string): MutationInput<P> {
  return { operationId: newOperationId(), scope: authority(), expectedRevision, payload };
}
function untyped<P>(payload: Record<string, unknown>): P {
  return payload as unknown as P;
}
function outcomeOf(result: MutationOutcome): MutationOutcome {
  if (!isOutcome(result)) throw new Error(`A mutation answered with something outside the closed outcome set: ${JSON.stringify(result)}`);
  return result;
}
function acceptedOf(result: MutationOutcome, what: string): AcceptedOutcome {
  const outcome = outcomeOf(result);
  if (outcome.outcome !== "accepted") throw new Error(`${what} was refused rather than accepted: ${JSON.stringify(outcome)}`);
  return outcome;
}
function invalidOutcomeOf(result: MutationOutcome, what: string): InvalidOutcome {
  const outcome = outcomeOf(result);
  expect(outcome.outcome, `${what} must be refused as invalid`).toBe("invalid");
  if (outcome.outcome !== "invalid") throw new Error(`${what} answered ${outcome.outcome} rather than invalid: ${JSON.stringify(outcome)}`);
  return outcome;
}
function conflictOutcomeOf(result: MutationOutcome, what: string): ConflictOutcome {
  const outcome = outcomeOf(result);
  expect(outcome.outcome, `${what} must be a conflict rather than a second effect`).toBe("conflict");
  if (outcome.outcome !== "conflict") throw new Error(`${what} answered ${outcome.outcome} rather than conflict: ${JSON.stringify(outcome)}`);
  return outcome;
}
async function taskRows(list: TaskListName = "all"): Promise<readonly TaskListRow[]> {
  const result = await reads.work.listTasks({ list, displayTimeZone: DISPLAY_ZONE, pageSize: 200 }, source());
  if (result.kind !== "envelope") throw new Error(`The ${JSON.stringify(list)} task list could not be read: ${JSON.stringify(result)}`);
  return result.envelope.data.tasks;
}
async function rowsOfSeries(seriesId: string, list: TaskListName = "all"): Promise<readonly TaskListRow[]> {
  return (await taskRows(list)).filter((row) => row.seriesId === seriesId);
}
async function seriesEnvelopeOf(seriesId: string): Promise<SeriesEnvelope> {
  const result = await reads.series.readSeries({ seriesId }, source());
  if (result.kind !== "envelope") throw new Error(`The series ${JSON.stringify(seriesId)} could not be read: ${JSON.stringify(result)}`);
  return result.envelope;
}
async function seriesReadingOf(seriesId: string): Promise<SeriesReading> {
  return (await seriesEnvelopeOf(seriesId)).data;
}
async function interactionTotal(): Promise<number> {
  const result = await reads.interactions.readInteractions({}, source());
  if (result.kind !== "envelope") throw new Error(`Recorded activity could not be read: ${JSON.stringify(result)}`);
  return result.envelope.data.total;
}
function actionOf(actions: readonly ReadAction[], name: string): ReadAction {
  const found = actions.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`The read offers no ${JSON.stringify(name)} action. It offers ${JSON.stringify(actions.map((candidate) => candidate.name))}.`);
  return found;
}
function occurrenceOf(reading: SeriesReading): TaskListRow {
  const occurrence = reading.currentOccurrence;
  if (occurrence === null) throw new Error("This series names no current occurrence, so the case has no date to answer.");
  return occurrence;
}
function weeklyRule(firstDueOn: string): SeriesRule {
  return { profile: "weekly", interval: 1, firstDueOn: day(firstDueOn), planningTimeZone: PLANNING_ZONE, end: { kind: "ongoing-personal-policy" } };
}
function monthlyRule(firstDueOn: string, dayOfMonth: number): SeriesRule {
  return { profile: "monthlyOnDay", interval: 1, dayOfMonth, firstDueOn: day(firstDueOn), planningTimeZone: PLANNING_ZONE, end: { kind: "ongoing-personal-policy" } };
}
interface CreatedSeries {
  readonly seriesId: string;
  readonly occurrenceId: string;
}
function createdSeriesOf(outcome: AcceptedOutcome): CreatedSeries {
  const [seriesId, occurrenceId] = outcome.created ?? [];
  if (seriesId === undefined || occurrenceId === undefined) throw new Error(`createSeries was accepted without naming both the series and its date: ${JSON.stringify(outcome)}`);
  return { seriesId, occurrenceId };
}
async function createWeeklySeries(title: string, firstDueOn: string): Promise<CreatedSeries> {
  const outcome = acceptedOf(await mutations.series.createSeries(inputOf({ title, profile: "weekly", firstDueOn, planningTimeZone: PLANNING_ZONE, ongoingPolicy: true }, NO_STORED_REVISION), source()), `createSeries ${JSON.stringify(title)}`);
  return createdSeriesOf(outcome);
}
async function createMonthlyOnDaySeries(title: string, firstDueOn: string, dayOfMonth: number, planningTimeZone: string = PLANNING_ZONE): Promise<CreatedSeries> {
  const outcome = acceptedOf(await mutations.series.createSeries(inputOf({ title, profile: "monthlyOnDay", dayOfMonth, firstDueOn, planningTimeZone, ongoingPolicy: true }, NO_STORED_REVISION), source()), `createSeries ${JSON.stringify(title)}`);
  return createdSeriesOf(outcome);
}

describe("the repeat profile set is closed", () => {
  it("offers exactly the five profiles, so a sixth cannot appear silently", () => {
    expect(REPEAT_PROFILES).toHaveLength(5);
    expect([...REPEAT_PROFILES]).toEqual(["none", "weekly", "everyNWeeks", "monthlyOnDay", "everyNMonths"]);
  });
  it("refuses an unrecognised profile at the rule check and at the boundary", async () => {
    const unrecognised = { ...weeklyRule(SEED_DAY), profile: "daily" } as unknown as SeriesRule;
    const validation = validateSeriesRule(unrecognised);
    expect(validation.status).toBe("invalid");
    if (validation.status !== "invalid") return;
    expect(Object.keys(validation.fields)).toEqual(["profile"]);
    const refused = invalidOutcomeOf(
      await mutations.series.createSeries(inputOf(untyped<CreateSeriesPayload>({ title: "A repeat nobody offers", profile: "daily", firstDueOn: SEED_DAY, planningTimeZone: PLANNING_ZONE, ongoingPolicy: true }), NO_STORED_REVISION), source()),
      "createSeries with a profile outside the closed set",
    );
    expect(Object.keys(refused.fields)).toEqual(["profile"]);
  });
  it("requires a first due date rather than inventing one, with the message keyed to the field", async () => {
    const refused = invalidOutcomeOf(await mutations.series.createSeries(inputOf(untyped<CreateSeriesPayload>({ title: "No first date", profile: "weekly", planningTimeZone: PLANNING_ZONE, ongoingPolicy: true }), NO_STORED_REVISION), source()), "createSeries without a first due date");
    expect(Object.keys(refused.fields)).toEqual(["firstDueOn"]);
  });
  it("requires a planning time zone rather than assuming one, with the message keyed to the field", async () => {
    const refused = invalidOutcomeOf(await mutations.series.createSeries(inputOf(untyped<CreateSeriesPayload>({ title: "No planning zone", profile: "weekly", firstDueOn: SEED_DAY, ongoingPolicy: true }), NO_STORED_REVISION), source()), "createSeries without a planning time zone");
    expect(Object.keys(refused.fields)).toEqual(["planningTimeZone"]);
  });
  it("requires an end, and admits an unbounded plan only under the ongoing-personal-series policy", async () => {
    const refusedFields = invalidOutcomeOf(
      await mutations.series.createSeries(inputOf(untyped<CreateSeriesPayload>({ title: "Open-ended by accident", profile: "weekly", firstDueOn: SEED_DAY, planningTimeZone: PLANNING_ZONE }), NO_STORED_REVISION), source()),
      "createSeries with neither an end nor the ongoing policy",
    ).fields;
    expect(Object.keys(refusedFields)).toEqual(["end"]);
    const admitted = acceptedOf(await mutations.series.createSeries(inputOf({ title: "Open-ended on purpose", profile: "weekly", firstDueOn: SEED_DAY, planningTimeZone: PLANNING_ZONE, ongoingPolicy: true }, NO_STORED_REVISION), source()), "createSeries under the ongoing policy");
    const reading = await seriesReadingOf(createdSeriesOf(admitted).seriesId);
    expect(reading.rule.end.kind).toBe("ongoing-personal-policy");
  });
  it("reads a whole number of periods only on the profile that reads one, keyed to the field", async () => {
    const zeroInterval = validateSeriesRule({ ...weeklyRule(SEED_DAY), profile: "everyNWeeks", interval: 0 });
    expect(zeroInterval.status).toBe("invalid");
    if (zeroInterval.status !== "invalid") return;
    expect(Object.keys(zeroInterval.fields)).toEqual(["interval"]);
    const refused = invalidOutcomeOf(
      await mutations.series.createSeries(inputOf(untyped<CreateSeriesPayload>({ title: "Weekly with a stray interval", profile: "weekly", interval: 3, firstDueOn: SEED_DAY, planningTimeZone: PLANNING_ZONE, ongoingPolicy: true }), NO_STORED_REVISION), source()),
      "createSeries stating an interval its profile does not read",
    );
    expect(Object.keys(refused.fields)).toEqual(["interval"]);
  });
});

describe("a missing day of the month resolves to the last day of that month, and says so", () => {
  it.each([
    { resolved: "day 31 in a 28-day February to the 28th", year: 2027, date: "2027-02-28", resolvedDay: 28 },
    { resolved: "day 31 in a 29-day February to the 29th", year: 2028, date: "2028-02-29", resolvedDay: 29 },
  ])("resolves $resolved and discloses the resolution", ({ year, date, resolvedDay }) => {
    const resolution = monthlyOnDay(year, 2, 31);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(resolution.date.toString()).toBe(date);
    expect(resolution.requestedDay).toBe(31);
    expect(resolution.resolvedDay).toBe(resolvedDay);
    expect(resolution.lastDayOfMonthResolved).toBe(true);
  });
  it.each([
    { month: 4, expected: "2027-04-30" },
    { month: 6, expected: "2027-06-30" },
    { month: 9, expected: "2027-09-30" },
    { month: 11, expected: "2027-11-30" },
  ])("resolves day 31 in month $month of 2027 to the 30th and discloses it", ({ month, expected }) => {
    const resolution = monthlyOnDay(2027, month, 31);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(resolution.date.toString()).toBe(expected);
    expect(resolution.resolvedDay).toBe(30);
    expect(resolution.lastDayOfMonthResolved).toBe(true);
  });
  it("records that no resolution was made when the month has a 31st", () => {
    const resolution = monthlyOnDay(2027, 5, 31);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(resolution.date.toString()).toBe("2027-05-31");
    expect(resolution.resolvedDay).toBe(31);
    expect(resolution.lastDayOfMonthResolved).toBe(false);
  });
  it("refuses a month or a day the calendar does not have rather than adjusting it", () => {
    expect(monthlyOnDay(2027, 13, 1)).toEqual({ status: "refused", reason: "invalid-month" });
    expect(monthlyOnDay(2027, 1, 32)).toEqual({ status: "refused", reason: "invalid-day" });
  });
  it("discloses the seeded day-31 series' month-end date through the service", async () => {
    const reading = await seriesReadingOf("series-month-end-support-review");
    expect(reading.rule.dayOfMonth).toBe(31);
    expect(occurrenceOf(reading).dueOn).toBe("2026-11-30");
  });
  it("keeps a due date a civil date, so a change of zone cannot rebase it", async () => {
    const london = await createMonthlyOnDaySeries("Month-end review, London", "2027-01-31", 31, PLANNING_ZONE);
    const auckland = await createMonthlyOnDaySeries("Month-end review, Auckland", "2027-01-31", 31, "Pacific/Auckland");
    const londonReading = await seriesReadingOf(london.seriesId);
    const aucklandReading = await seriesReadingOf(auckland.seriesId);
    expect(occurrenceOf(londonReading).dueOn).toBe("2027-01-31");
    expect(occurrenceOf(aucklandReading).dueOn).toBe("2027-01-31");
    expect(occurrenceOf(londonReading).dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(londonReading.preview).toEqual(aucklandReading.preview);
    expect(londonReading.preview.status).toBe("preview");
    if (londonReading.preview.status !== "preview") return;
    expect(londonReading.preview.dates).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(londonReading.preview.monthDayResolutions).toEqual([{ dueOn: "2027-02-28", requestedDay: 31, resolvedDay: 28 }]);
  });
});

describe("exactly one occurrence is actionable, and the dates after it are previews", () => {
  it("previews the next three dates as dates the plan would use, resolving each month-day it has to", () => {
    const preview = nextOccurrences(monthlyRule("2027-01-31", 31), day("2027-01-31"), 3);
    expect(preview.status).toBe("preview");
    if (preview.status !== "preview") return;
    expect(preview.dates.map((date) => date.toString())).toEqual(["2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(preview.monthDayResolutions.map((resolution) => resolution.resolvedDay)).toEqual([28, 30]);
  });
  it("classifies one occurrence as actionable and the next three dates as previews in the same read", async () => {
    const created = await createMonthlyOnDaySeries("Month-end support review", "2027-01-31", 31);
    const reading = await seriesReadingOf(created.seriesId);
    const occurrence = occurrenceOf(reading);
    expect(reading.actionableOccurrenceId).toBe(created.occurrenceId);
    expect(occurrence.taskId).toBe(created.occurrenceId);
    expect(reading.preview.status).toBe("preview");
    if (reading.preview.status !== "preview") return;
    expect(reading.preview.dates).toHaveLength(3);
    expect(reading.preview.dates[0]).toBe(occurrence.dueOn);
    const rows = await rowsOfSeries(created.seriesId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBe(reading.actionableOccurrenceId);
    expect(rows[0]?.status).toBe("open");
    const previewDates = new Set(reading.preview.dates);
    expect(rows.filter((row) => row.dueOn !== null && previewDates.has(row.dueOn))).toHaveLength(1);
  });
  it("admits exactly one successor when the actionable occurrence is completed, and never a second", async () => {
    const created = await createWeeklySeries("Weekly call round", SEED_DAY);
    const occurrence = occurrenceOf(await seriesReadingOf(created.seriesId));
    const interactionsBefore = await interactionTotal();
    const completed = acceptedOf(await mutations.work.completeTask(inputOf({ taskId: occurrence.taskId }, occurrence.revision), source()), "completeTask");
    expect(completed.created).toHaveLength(1);
    expect(await interactionTotal()).toBe(interactionsBefore);
    const after = await seriesReadingOf(created.seriesId);
    const successor = occurrenceOf(after);
    expect(successor.taskId).toBe(completed.created?.[0]);
    expect(successor.dueOn).toBe(WEEK_AFTER_SEED_DAY);
    expect(successor.status).toBe("open");
    expect(after.actionableOccurrenceId).toBe(successor.taskId);
    const rows = await rowsOfSeries(created.seriesId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === "completed")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "open")).toHaveLength(1);
    const again = outcomeOf(await mutations.work.completeTask(inputOf({ taskId: occurrence.taskId }, completed.revision), source()));
    expect(again.outcome).toBe("unchanged");
    const rowsAfter = await rowsOfSeries(created.seriesId);
    expect(rowsAfter).toHaveLength(2);
    expect(rowsAfter.filter((row) => row.status === "open")).toHaveLength(1);
  });
  it("answers a skipped occurrence without completing it, and admits exactly one successor", async () => {
    const created = await createWeeklySeries("Weekly call round", SEED_DAY);
    const occurrence = occurrenceOf(await seriesReadingOf(created.seriesId));
    const skipped = acceptedOf(await mutations.series.skipOccurrence(inputOf({ occurrenceId: occurrence.taskId }, occurrence.revision), source()), "skipOccurrence");
    expect(skipped.created).toHaveLength(1);
    const after = await seriesReadingOf(created.seriesId);
    const successor = occurrenceOf(after);
    expect(successor.taskId).toBe(skipped.created?.[0]);
    expect(successor.dueOn).toBe(WEEK_AFTER_SEED_DAY);
    expect(successor.status).toBe("open");
    const rows = await rowsOfSeries(created.seriesId);
    expect(rows).toHaveLength(2);
    const answered = rows.find((row) => row.taskId === occurrence.taskId);
    expect(answered?.status).toBe("cancelled");
    expect(answered?.status).not.toBe("completed");
    const again = outcomeOf(await mutations.series.skipOccurrence(inputOf({ occurrenceId: occurrence.taskId }, skipped.revision), source()));
    expect(again.outcome).toBe("unchanged");
    const rowsAfter = await rowsOfSeries(created.seriesId);
    expect(rowsAfter).toHaveLength(2);
    expect(rowsAfter.filter((row) => row.status === "open")).toHaveLength(1);
  });
});

describe("several missed dates produce a plan that needs review, not an overdue stack", () => {
  it("reports the review after three missed dates with exactly the three resolutions it offers", async () => {
    expect(todayInPlanningZone()).toBe(SEED_DAY);
    const created = await createWeeklySeries("Monday review of the working list", SEED_DAY);
    const fresh = await seriesReadingOf(created.seriesId);
    expect(fresh.planReview.state).toBe("on-track");
    expect(fresh.actionableOccurrenceId).toBe(created.occurrenceId);
    const advanced = await advanceClock(SESSION_ID, THREE_WEEKS_MS);
    expect(advanced.ok).toBe(true);
    expect(todayInPlanningZone()).toBe(THREE_WEEKS_AFTER_SEED_DAY);
    const reading = await seriesEnvelopeOf(created.seriesId);
    expect(reading.data.planReview.state).toBe("needs-review");
    expect(reading.data.planReview.missedDateCount).toBe(3);
    expect(reading.data.planReview.missedDates).toEqual([SEED_DAY, WEEK_AFTER_SEED_DAY, TWO_WEEKS_AFTER_SEED_DAY]);
    expect(reading.data.planReview.resolutions).toHaveLength(3);
    expect([...reading.data.planReview.resolutions]).toEqual(["keep-this-occurrence", "move-next-date-forward", "stop-series"]);
    expect(actionOf(reading.actions, "resolveMissedPlan").available).toBe(true);
    expect(await rowsOfSeries(created.seriesId)).toHaveLength(1);
    expect(await rowsOfSeries(created.seriesId, "overdue")).toHaveLength(1);
    expect(reading.data.leftBehind).toHaveLength(0);
  });
  it("resolves the review without inventing a conversation or completing the date", async () => {
    expect(todayInPlanningZone()).toBe(SEED_DAY);
    const created = await createWeeklySeries("Monday review of the working list", SEED_DAY);
    await advanceClock(SESSION_ID, THREE_WEEKS_MS);
    const occurrence = occurrenceOf(await seriesReadingOf(created.seriesId));
    const interactionsBefore = await interactionTotal();
    const fourth = invalidOutcomeOf(await mutations.series.resolveMissedPlan(inputOf(untyped<ResolveMissedPlanPayload>({ occurrenceId: occurrence.taskId, resolution: "reschedule-everything" }), occurrence.revision), source()), "resolveMissedPlan with a resolution outside the three");
    expect(Object.keys(fourth.fields)).toEqual(["resolution"]);
    const resolved = acceptedOf(await mutations.series.resolveMissedPlan(inputOf({ occurrenceId: occurrence.taskId, resolution: "keep-this-occurrence" }, occurrence.revision), source()), "resolveMissedPlan");
    expect(resolved.changed).toContain(created.seriesId);
    const after = await seriesReadingOf(created.seriesId);
    expect(after.planReview.recordedPlanNeedsReview).toBe(false);
    expect(occurrenceOf(after).status).toBe("open");
    expect(await rowsOfSeries(created.seriesId)).toHaveLength(1);
    expect(await interactionTotal()).toBe(interactionsBefore);
  });
});

describe("this occurrence and this-and-future are two different changes", () => {
  it("changes this occurrence alone, leaving the rule and the completed history untouched", async () => {
    const created = await createWeeklySeries("Weekly call round", SEED_DAY);
    const firstOccurrence = occurrenceOf(await seriesReadingOf(created.seriesId));
    const completed = acceptedOf(await mutations.work.completeTask(inputOf({ taskId: firstOccurrence.taskId }, firstOccurrence.revision), source()), "completeTask");
    const before = await seriesEnvelopeOf(created.seriesId);
    const successor = occurrenceOf(before.data);
    const historyBefore = (await rowsOfSeries(created.seriesId)).find((row) => row.status === "completed");
    const edited = acceptedOf(await mutations.series.editOccurrence(inputOf({ occurrenceId: successor.taskId, title: "Call round, moved by hand", note: "Speak to the warden first." }, successor.revision), source()), "editOccurrence");
    expect(edited.changed).toContain(successor.taskId);
    const after = await seriesEnvelopeOf(created.seriesId);
    expect(occurrenceOf(after.data).title).toBe("Call round, moved by hand");
    expect(occurrenceOf(after.data).note).toBe("Speak to the warden first.");
    expect(after.data.rule).toEqual(before.data.rule);
    expect(after.data.effectiveRevisions).toEqual(before.data.effectiveRevisions);
    expect(after.revision).toBe(before.revision);
    const historyAfter = (await rowsOfSeries(created.seriesId)).find((row) => row.status === "completed");
    expect(historyAfter).toEqual(historyBefore);
    expect(historyAfter?.revision).toBe(completed.revision);
  });
  it("creates a prospective rule revision at an explicit boundary and rewrites nothing before it", async () => {
    const created = await createWeeklySeries("Weekly call round", SEED_DAY);
    const firstOccurrence = occurrenceOf(await seriesReadingOf(created.seriesId));
    const completed = acceptedOf(await mutations.work.completeTask(inputOf({ taskId: firstOccurrence.taskId }, firstOccurrence.revision), source()), "completeTask");
    const before = await seriesEnvelopeOf(created.seriesId);
    const successor = occurrenceOf(before.data);
    expect(successor.dueOn).toBe(WEEK_AFTER_SEED_DAY);
    expect(before.data.effectiveRevisions).toHaveLength(1);
    const edited = acceptedOf(await mutations.series.editThisAndFuture(inputOf({ seriesId: created.seriesId, effectiveFrom: WEEK_AFTER_SEED_DAY, profile: "everyNWeeks", interval: 3 }, before.revision), source()), "editThisAndFuture");
    expect(edited.created).toHaveLength(1);
    const after = await seriesEnvelopeOf(created.seriesId);
    const revisions = after.data.effectiveRevisions;
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.effectiveFrom).toBe(SEED_DAY);
    expect(revisions[0]?.rule.profile).toBe("weekly");
    expect(revisions[1]?.effectiveFrom).toBe(WEEK_AFTER_SEED_DAY);
    expect(revisions[1]?.rule.profile).toBe("everyNWeeks");
    expect(revisions[1]?.rule.interval).toBe(3);
    expect(after.data.rule).toEqual(revisions[1]?.rule);
    expect(revisions[1]?.effectiveFrom).toBe(successor.dueOn);
    expect(Temporal.PlainDate.compare(day(SEED_DAY), day(WEEK_AFTER_SEED_DAY))).toBe(-1);
    const history = (await rowsOfSeries(created.seriesId)).find((row) => row.status === "completed");
    expect(history?.dueOn).toBe(SEED_DAY);
    expect(history?.revision).toBe(completed.revision);
  });
  it("refuses a boundary that is not prospective, so completed history cannot be re-planned", async () => {
    const created = await createWeeklySeries("Weekly call round", SEED_DAY);
    const firstOccurrence = occurrenceOf(await seriesReadingOf(created.seriesId));
    acceptedOf(await mutations.work.completeTask(inputOf({ taskId: firstOccurrence.taskId }, firstOccurrence.revision), source()), "completeTask");
    const before = await seriesEnvelopeOf(created.seriesId);
    const refused = outcomeOf(await mutations.series.editThisAndFuture(inputOf({ seriesId: created.seriesId, effectiveFrom: SEED_DAY, profile: "everyNWeeks", interval: 2 }, before.revision), source()));
    expect(refused.outcome).toBe("unchanged");
    expect((await seriesEnvelopeOf(created.seriesId)).data.effectiveRevisions).toHaveLength(1);
  });
});

describe("pausing, resuming and stopping a series", () => {
  it("pauses future admission while the outstanding occurrence keeps its state, and resumes without a backfill", async () => {
    const created = await createWeeklySeries("Weekly call round", SEED_DAY);
    const before = await seriesEnvelopeOf(created.seriesId);
    const occurrence = occurrenceOf(before.data);
    acceptedOf(await mutations.series.pauseSeries(inputOf({ seriesId: created.seriesId }, before.revision), source()), "pauseSeries");
    const paused = await seriesEnvelopeOf(created.seriesId);
    expect(paused.data.state).toBe("paused");
    expect(paused.data.admitsFurtherOccurrences).toBe(false);
    expect(paused.data.actionableOccurrenceId).toBeNull();
    expect(paused.data.currentOccurrence?.taskId).toBe(occurrence.taskId);
    expect(paused.data.currentOccurrence?.status).toBe("open");
    expect(paused.data.currentOccurrence?.dueOn).toBe(occurrence.dueOn);
    expect(paused.data.planReview.state).toBe("not-admitting");
    expect(actionOf(paused.actions, "skipOccurrence").available).toBe(false);
    const skippedWhilePaused = outcomeOf(await mutations.series.skipOccurrence(inputOf({ occurrenceId: occurrence.taskId }, occurrence.revision), source()));
    expect(skippedWhilePaused.outcome).toBe("unchanged");
    expect(await rowsOfSeries(created.seriesId)).toHaveLength(1);
    acceptedOf(await mutations.series.resumeSeries(inputOf({ seriesId: created.seriesId }, paused.revision), source()), "resumeSeries");
    const resumed = await seriesEnvelopeOf(created.seriesId);
    expect(resumed.data.state).toBe("active");
    expect(resumed.data.actionableOccurrenceId).toBe(occurrence.taskId);
    expect(await rowsOfSeries(created.seriesId)).toHaveLength(1);
    expect(resumed.data.preview.status).toBe("preview");
  });
  it("stops a series, states what becomes of its unfinished work, and never completes it", async () => {
    const created = await createWeeklySeries("Weekly call round", SEED_DAY);
    const before = await seriesEnvelopeOf(created.seriesId);
    const occurrence = occurrenceOf(before.data);
    const stopped = acceptedOf(await mutations.series.stopSeries(inputOf({ seriesId: created.seriesId, unfinishedWork: "keep" }, before.revision), source()), "stopSeries");
    expect(stopped.changed).toContain(created.seriesId);
    const reading = await seriesEnvelopeOf(created.seriesId);
    expect(reading.data.state).toBe("stopped");
    expect(reading.data.admitsFurtherOccurrences).toBe(false);
    expect(reading.data.currentOccurrence).toBeNull();
    expect(reading.data.leftBehind).toHaveLength(1);
    expect(reading.data.leftBehind[0]?.taskId).toBe(occurrence.taskId);
    expect(reading.data.leftBehind[0]?.status).toBe("open");
    expect(reading.data.leftBehind[0]?.status).not.toBe("completed");
    expect(reading.data.preview.status).toBe("not-admitted");
    expect(actionOf(reading.actions, "resumeSeries").available).toBe(false);
    expect(actionOf(reading.actions, "stopSeries").available).toBe(false);
  });
  it("cancels unfinished work when that is the stated disposition, and still claims nothing was done", async () => {
    const created = await createWeeklySeries("Weekly call round", SEED_DAY);
    const before = await seriesEnvelopeOf(created.seriesId);
    const stopped = acceptedOf(await mutations.series.stopSeries(inputOf({ seriesId: created.seriesId, unfinishedWork: "cancel" }, before.revision), source()), "stopSeries");
    expect(stopped.changed).toContain(created.occurrenceId);
    const reading = await seriesReadingOf(created.seriesId);
    expect(reading.state).toBe("stopped");
    expect(reading.leftBehind).toHaveLength(0);
    const rows = await rowsOfSeries(created.seriesId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("cancelled");
    expect(rows[0]?.status).not.toBe("completed");
  });
  it("refuses a stale action taken after a stop, and the series stays stopped", async () => {
    const created = await createWeeklySeries("Weekly call round", SEED_DAY);
    const staleRevision = (await seriesEnvelopeOf(created.seriesId)).revision;
    const stopped = acceptedOf(await mutations.series.stopSeries(inputOf({ seriesId: created.seriesId, unfinishedWork: "keep" }, staleRevision), source()), "stopSeries");
    expect(stopped.revision).not.toBe(staleRevision);
    const stalePause = conflictOutcomeOf(await mutations.series.pauseSeries(inputOf({ seriesId: created.seriesId }, staleRevision), source()), "pauseSeries with the revision read before the stop");
    expect(stalePause.reason).toBe("stale-revision");
    expect(stalePause.currentRevision).toBe(stopped.revision);
    expect(stalePause.preservedInput).toEqual({ seriesId: created.seriesId });
    conflictOutcomeOf(await mutations.series.resumeSeries(inputOf({ seriesId: created.seriesId }, staleRevision), source()), "resumeSeries with the revision read before the stop");
    conflictOutcomeOf(await mutations.series.editThisAndFuture(inputOf({ seriesId: created.seriesId, effectiveFrom: WEEK_AFTER_SEED_DAY, profile: "everyNWeeks", interval: 2 }, staleRevision), source()), "editThisAndFuture with the revision read before the stop");
    const afterStale = await seriesEnvelopeOf(created.seriesId);
    expect(afterStale.data.state).toBe("stopped");
    expect(afterStale.data.effectiveRevisions).toHaveLength(1);
    const current = outcomeOf(await mutations.series.resumeSeries(inputOf({ seriesId: created.seriesId }, stopped.revision), source()));
    expect(current.outcome).toBe("unchanged");
    const afterCurrent = await seriesEnvelopeOf(created.seriesId);
    expect(afterCurrent.data.state).toBe("stopped");
    expect(afterCurrent.data.admitsFurtherOccurrences).toBe(false);
  });
  it("keeps paused and stopped distinct: a paused series resumes, a stopped one cannot", async () => {
    expect(SERIES_STATES).toHaveLength(3);
    expect([...SERIES_STATES]).toEqual(["active", "paused", "stopped"]);
    const paused = await seriesEnvelopeOf("series-fortnightly-newsletter");
    expect(paused.data.state).toBe("paused");
    expect(actionOf(paused.actions, "resumeSeries").available).toBe(true);
    const stopped = await seriesEnvelopeOf("series-visit-round");
    expect(stopped.data.state).toBe("stopped");
    expect(actionOf(stopped.actions, "resumeSeries").available).toBe(false);
    expect(actionOf(stopped.actions, "pauseSeries").available).toBe(false);
    expect(actionOf(stopped.actions, "editThisAndFuture").available).toBe(false);
    const resumed = outcomeOf(await mutations.series.resumeSeries(inputOf({ seriesId: "series-fortnightly-newsletter" }, paused.revision), source()));
    expect(resumed.outcome).toBe("accepted");
    expect((await seriesReadingOf("series-fortnightly-newsletter")).state).toBe("active");
    const stoppedResume = outcomeOf(await mutations.series.resumeSeries(inputOf({ seriesId: "series-visit-round" }, stopped.revision), source()));
    expect(stoppedResume.outcome).toBe("unchanged");
    expect((await seriesReadingOf("series-visit-round")).state).toBe("stopped");
  });
});
