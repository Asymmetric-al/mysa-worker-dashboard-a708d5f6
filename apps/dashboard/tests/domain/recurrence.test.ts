/**
 * The closed repeat rule behind recurring tasks: the domain half of success criterion 13.
 *
 * Every case runs against the real service over one file-private session and moves time only through
 * the scenario clock, so each boundary is asserted at read or command time rather than by a
 * background job. Nothing here is armed in the failure plan, so nothing needs disarming.
 *
 * Session and store note: the period fixtures come from `seed()`. Laying them down under this file's
 * own session id goes through `resetSession`, the store's one creating path, because a domain file
 * that shared `established-worker` with a sibling file would have its writes moved under it. No
 * assertion reads the store: every one is made against a service read, a mutation outcome or a pure
 * recurrence function.
 */
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
/** This file's own session document set: stable across runs, so two runs pass in a row without cleanup. */
const SESSION_ID = "domain-recurrence";
/** The zone every rule in this file is planned in. */
const PLANNING_ZONE = "Europe/London";
/** The zone a task list is read in. */
const DISPLAY_ZONE = "Europe/London";
/**
 * The civil dates this file expects, anchored to the seed instant: 2026-11-20T00:00:00Z is midnight
 * on 20 November in the planning zone, and a weekly series started that day falls due on the two
 * Fridays after it.
 */
const SEED_DAY = "2026-11-20";
const WEEK_AFTER_SEED_DAY = "2026-11-27";
const TWO_WEEKS_AFTER_SEED_DAY = "2026-12-04";
const THREE_WEEKS_AFTER_SEED_DAY = "2026-12-11";
/** How far the scenario clock moves to leave three weekly dates behind: elapsed time on the clock, never calendar arithmetic on a rule. */
const THREE_WEEKS_MS = 21 * 24 * 60 * 60 * 1000;
/** A creation compares no revision, so the token a create presents names no stored value. */
const NO_STORED_REVISION = "nothing-stored-yet";
// Shapes derived from the surface itself, so no type is imported from outside this file's modules
type SeriesEnvelope = Extract<Awaited<ReturnType<typeof reads.series.readSeries>>, { kind: "envelope" }>["envelope"];
type SeriesReading = SeriesEnvelope["data"];
type TaskListRow = Extract<Awaited<ReturnType<typeof reads.work.listTasks>>, { kind: "envelope" }>["envelope"]["data"]["tasks"][number];
type TaskListName = Parameters<typeof reads.work.listTasks>[0]["list"];
type CreateSeriesPayload = Parameters<typeof mutations.series.createSeries>[0]["payload"];
type ResolveMissedPlanPayload = Parameters<typeof mutations.series.resolveMissedPlan>[0]["payload"];
// The seeded world this file lays down
let seededDocuments: SeededSessionDocuments | undefined;
let seededScope: Scope | undefined;

function day(value: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(value);
}
/** The civil date the scenario clock stands on in the planning zone: the one "today" a rule is read against. */
function todayInPlanningZone(): string {
  return now().toZonedDateTimeISO(PLANNING_ZONE).toPlainDate().toString();
}
async function laySeededDocuments(): Promise<void> {
  if (seededDocuments === undefined) {
    throw new Error("No seeded documents were built, so this case has no world to start from.");
  }
  await resetSession(SESSION_ID, {
    state: structuredClone(seededDocuments.state),
    operations: structuredClone(seededDocuments.operations),
    meta: structuredClone(seededDocuments.meta),
  });
}
async function restoreSeedInstant(): Promise<void> {
  const restored = await setClock(SESSION_ID, 0);
  if (!restored.ok) {
    throw new Error(`Restoring the scenario clock to the seed instant failed: ${restored.error.message}`);
  }
}
beforeAll(async () => {
  const sessions = await seed();
  const established = sessions.find((candidate) => candidate.sessionId === DEFAULT_SESSION_ID);
  if (established === undefined) {
    throw new Error(`The seed lays down no session ${JSON.stringify(DEFAULT_SESSION_ID)}, so no recurrence case has a world to start from.`);
  }
  seededDocuments = established.documents;
  await laySeededDocuments();
  // The authority is the one the resolved session states, which is the same resolution every read and
  // change makes: a scope assembled here would be a second, unchecked way of naming it.
  const resolved = await resolveSession({ sessionId: SESSION_ID });
  if (!resolved.ok) {
    throw new Error(`The seeded session did not resolve, so no case has an authority to act under: ${JSON.stringify(resolved.refusal)}`);
  }
  if (resolved.session.selected === null) {
    throw new Error("The seeded established worker selects no context, so no series could be created under an authority it never chose.");
  }
  seededScope = resolved.session.selected;
});
beforeEach(async () => {
  // Each case starts from the known seed and the seed instant, so one case's advanced clock or
  // accepted change cannot move the world under the next one.
  await laySeededDocuments();
  await restoreSeedInstant();
});
afterEach(async () => {
  await restoreSeedInstant();
});
// The authority every read and change is made under
function authority(): Scope {
  if (seededScope === undefined) {
    throw new Error("The seeded session's authority was not resolved before this case started.");
  }
  return seededScope;
}
function source(): { sessionId: string } {
  return { sessionId: SESSION_ID };
}
function inputOf<P>(payload: P, expectedRevision: string): MutationInput<P> {
  return { operationId: newOperationId(), scope: authority(), expectedRevision, payload };
}
/** States a payload the type would refuse, because an incomplete or unrecognised request is exactly what those cases judge. */
function untyped<P>(payload: Record<string, unknown>): P {
  return payload as unknown as P;
}
// Reading outcomes, so no case asserts on truthiness
function outcomeOf(result: MutationOutcome): MutationOutcome {
  if (!isOutcome(result)) {
    throw new Error(`A mutation answered with something outside the closed outcome set: ${JSON.stringify(result)}`);
  }
  return result;
}
function acceptedOf(result: MutationOutcome, what: string): AcceptedOutcome {
  const outcome = outcomeOf(result);
  if (outcome.outcome !== "accepted") {
    throw new Error(`${what} was refused rather than accepted: ${JSON.stringify(outcome)}`);
  }
  return outcome;
}
function invalidOutcomeOf(result: MutationOutcome, what: string): InvalidOutcome {
  const outcome = outcomeOf(result);
  // A refusal is `invalid` and not one of the other seven: naming the outcome here keeps the case from
  // passing on any refusal that happens to carry field messages.
  expect(outcome.outcome, `${what} must be refused as invalid`).toBe("invalid");
  if (outcome.outcome !== "invalid") {
    throw new Error(`${what} answered ${outcome.outcome} rather than invalid: ${JSON.stringify(outcome)}`);
  }
  return outcome;
}
function conflictOutcomeOf(result: MutationOutcome, what: string): ConflictOutcome {
  const outcome = outcomeOf(result);
  expect(outcome.outcome, `${what} must be a conflict rather than a second effect`).toBe("conflict");
  if (outcome.outcome !== "conflict") {
    throw new Error(`${what} answered ${outcome.outcome} rather than conflict: ${JSON.stringify(outcome)}`);
  }
  return outcome;
}
// Reading the stored work back through the service
async function taskRows(list: TaskListName = "all"): Promise<readonly TaskListRow[]> {
  const result = await reads.work.listTasks({ list, displayTimeZone: DISPLAY_ZONE, pageSize: 200 }, source());
  if (result.kind !== "envelope") {
    throw new Error(`The ${JSON.stringify(list)} task list could not be read: ${JSON.stringify(result)}`);
  }
  return result.envelope.data.tasks;
}
async function rowsOfSeries(seriesId: string, list: TaskListName = "all"): Promise<readonly TaskListRow[]> {
  return (await taskRows(list)).filter((row) => row.seriesId === seriesId);
}
async function seriesEnvelopeOf(seriesId: string): Promise<SeriesEnvelope> {
  const result = await reads.series.readSeries({ seriesId }, source());
  if (result.kind !== "envelope") {
    throw new Error(`The series ${JSON.stringify(seriesId)} could not be read: ${JSON.stringify(result)}`);
  }
  return result.envelope;
}
async function seriesReadingOf(seriesId: string): Promise<SeriesReading> {
  return (await seriesEnvelopeOf(seriesId)).data;
}
async function interactionTotal(): Promise<number> {
  const result = await reads.interactions.readInteractions({}, source());
  if (result.kind !== "envelope") {
    throw new Error(`Recorded activity could not be read: ${JSON.stringify(result)}`);
  }
  return result.envelope.data.total;
}
function actionOf(actions: readonly ReadAction[], name: string): ReadAction {
  const found = actions.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`The read offers no ${JSON.stringify(name)} action. It offers ${JSON.stringify(actions.map((candidate) => candidate.name))}.`);
  }
  return found;
}
function occurrenceOf(reading: SeriesReading): TaskListRow {
  const occurrence = reading.currentOccurrence;
  if (occurrence === null) {
    throw new Error("This series names no current occurrence, so the case has no date to answer.");
  }
  return occurrence;
}
// Creating the rules and series these cases need
function weeklyRule(firstDueOn: string): SeriesRule {
  return {
    profile: "weekly",
    interval: 1,
    firstDueOn: day(firstDueOn),
    planningTimeZone: PLANNING_ZONE,
    end: { kind: "ongoing-personal-policy" },
  };
}
function monthlyRule(firstDueOn: string, dayOfMonth: number): SeriesRule {
  return {
    profile: "monthlyOnDay",
    interval: 1,
    dayOfMonth,
    firstDueOn: day(firstDueOn),
    planningTimeZone: PLANNING_ZONE,
    end: { kind: "ongoing-personal-policy" },
  };
}
interface CreatedSeries {
  readonly seriesId: string;
  readonly occurrenceId: string;
}
function createdSeriesOf(outcome: AcceptedOutcome): CreatedSeries {
  const [seriesId, occurrenceId] = outcome.created ?? [];
  if (seriesId === undefined || occurrenceId === undefined) {
    throw new Error(`createSeries was accepted without naming both the series and its date: ${JSON.stringify(outcome)}`);
  }
  return { seriesId, occurrenceId };
}
async function createWeeklySeries(title: string, firstDueOn: string): Promise<CreatedSeries> {
  const outcome = acceptedOf(
    await mutations.series.createSeries(
      inputOf({ title, profile: "weekly", firstDueOn, planningTimeZone: PLANNING_ZONE, ongoingPolicy: true }, NO_STORED_REVISION),
      source(),
    ),
    `createSeries ${JSON.stringify(title)}`,
  );
  return createdSeriesOf(outcome);
}
async function createMonthlyOnDaySeries(title: string, firstDueOn: string, dayOfMonth: number, planningTimeZone: string = PLANNING_ZONE): Promise<CreatedSeries> {
  const outcome = acceptedOf(
    await mutations.series.createSeries(
      inputOf({ title, profile: "monthlyOnDay", dayOfMonth, firstDueOn, planningTimeZone, ongoingPolicy: true }, NO_STORED_REVISION),
      source(),
    ),
    `createSeries ${JSON.stringify(title)}`,
  );
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
    if (validation.status !== "invalid") {
      return;
    }
    expect(Object.keys(validation.fields)).toEqual(["profile"]);

    const refused = invalidOutcomeOf(
      await mutations.series.createSeries(
        inputOf(
          untyped<CreateSeriesPayload>({
            title: "A repeat nobody offers",
            profile: "daily",
            firstDueOn: SEED_DAY,
            planningTimeZone: PLANNING_ZONE,
            ongoingPolicy: true,
          }),
          NO_STORED_REVISION,
        ),
        source(),
      ),
      "createSeries with a profile outside the closed set",
    );
    expect(Object.keys(refused.fields)).toEqual(["profile"]);
  });

  it("requires a first due date rather than inventing one, with the message keyed to the field", async () => {
    const refused = invalidOutcomeOf(
      await mutations.series.createSeries(
        inputOf(
          untyped<CreateSeriesPayload>({ title: "No first date", profile: "weekly", planningTimeZone: PLANNING_ZONE, ongoingPolicy: true }),
          NO_STORED_REVISION,
        ),
        source(),
      ),
      "createSeries without a first due date",
    );
    expect(Object.keys(refused.fields)).toEqual(["firstDueOn"]);
  });

  it("requires a planning time zone rather than assuming one, with the message keyed to the field", async () => {
    const refused = invalidOutcomeOf(
      await mutations.series.createSeries(
        inputOf(untyped<CreateSeriesPayload>({ title: "No planning zone", profile: "weekly", firstDueOn: SEED_DAY, ongoingPolicy: true }), NO_STORED_REVISION),
        source(),
      ),
      "createSeries without a planning time zone",
    );
    expect(Object.keys(refused.fields)).toEqual(["planningTimeZone"]);
  });

  it("requires an end, and admits an unbounded plan only under the ongoing-personal-series policy", async () => {
    const refusedFields = invalidOutcomeOf(
      await mutations.series.createSeries(
        inputOf(untyped<CreateSeriesPayload>({ title: "Open-ended by accident", profile: "weekly", firstDueOn: SEED_DAY, planningTimeZone: PLANNING_ZONE }), NO_STORED_REVISION),
        source(),
      ),
      "createSeries with neither an end nor the ongoing policy",
    ).fields;
    expect(Object.keys(refusedFields)).toEqual(["end"]);

    const admitted = acceptedOf(
      await mutations.series.createSeries(
        inputOf({ title: "Open-ended on purpose", profile: "weekly", firstDueOn: SEED_DAY, planningTimeZone: PLANNING_ZONE, ongoingPolicy: true }, NO_STORED_REVISION),
        source(),
      ),
      "createSeries under the ongoing policy",
    );
    const reading = await seriesReadingOf(createdSeriesOf(admitted).seriesId);
    expect(reading.rule.end.kind).toBe("ongoing-personal-policy");
  });

  it("reads a whole number of periods only on the profile that reads one, keyed to the field", async () => {
    const zeroInterval = validateSeriesRule({ ...weeklyRule(SEED_DAY), profile: "everyNWeeks", interval: 0 });
    expect(zeroInterval.status).toBe("invalid");
    if (zeroInterval.status !== "invalid") {
      return;
    }
    expect(Object.keys(zeroInterval.fields)).toEqual(["interval"]);

    const refused = invalidOutcomeOf(
      await mutations.series.createSeries(
        inputOf(
          untyped<CreateSeriesPayload>({ title: "Weekly with a stray interval", profile: "weekly", interval: 3, firstDueOn: SEED_DAY, planningTimeZone: PLANNING_ZONE, ongoingPolicy: true }),
          NO_STORED_REVISION,
        ),
        source(),
      ),
      "createSeries stating an interval its profile does not read",
    );
    expect(Object.keys(refused.fields)).toEqual(["interval"]);
  });
});

describe("a missing day of the month resolves to the last day of that month, and says so", () => {
  it("resolves day 31 in a 28-day February to the 28th and discloses the resolution", () => {
    const resolution = monthlyOnDay(2027, 2, 31);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") {
      return;
    }
    // 2027 is not a leap year, so the 31st of February is a date the calendar does not have: the plan
    // uses the 28th, and the resolution travels with the date rather than being clamped in silence.
    expect(resolution.date.toString()).toBe("2027-02-28");
    expect(resolution.requestedDay).toBe(31);
    expect(resolution.resolvedDay).toBe(28);
    expect(resolution.lastDayOfMonthResolved).toBe(true);
  });

  it("resolves day 31 in a 29-day February to the 29th and discloses the resolution", () => {
    const resolution = monthlyOnDay(2028, 2, 31);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") {
      return;
    }
    // 2028 is a leap year, so the same rule lands one day later than in 2027 without the rule changing.
    expect(resolution.date.toString()).toBe("2028-02-29");
    expect(resolution.requestedDay).toBe(31);
    expect(resolution.resolvedDay).toBe(29);
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
    if (resolution.status !== "resolved") {
      return;
    }
    expect(resolution.date.toString()).toBe(expected);
    expect(resolution.resolvedDay).toBe(30);
    expect(resolution.lastDayOfMonthResolved).toBe(true);
  });

  it("records that no resolution was made when the month has a 31st", () => {
    const resolution = monthlyOnDay(2027, 5, 31);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") {
      return;
    }
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
    // November has 30 days, so the stored occurrence is the 30th and not a day the calendar lacks.
    expect(occurrenceOf(reading).dueOn).toBe("2026-11-30");
  });

  it("keeps a due date a civil date, so a change of zone cannot rebase it", async () => {
    const london = await createMonthlyOnDaySeries("Month-end review, London", "2027-01-31", 31, PLANNING_ZONE);
    const auckland = await createMonthlyOnDaySeries("Month-end review, Auckland", "2027-01-31", 31, "Pacific/Auckland");

    const londonReading = await seriesReadingOf(london.seriesId);
    const aucklandReading = await seriesReadingOf(auckland.seriesId);

    // The same civil rule in two planning zones states the same civil dates: a zone is where a date is
    // read, never a shift applied to the date itself.
    expect(occurrenceOf(londonReading).dueOn).toBe("2027-01-31");
    expect(occurrenceOf(aucklandReading).dueOn).toBe("2027-01-31");
    expect(occurrenceOf(londonReading).dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(londonReading.preview).toEqual(aucklandReading.preview);

    expect(londonReading.preview.status).toBe("preview");
    if (londonReading.preview.status !== "preview") {
      return;
    }
    expect(londonReading.preview.dates).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(londonReading.preview.monthDayResolutions).toEqual([{ dueOn: "2027-02-28", requestedDay: 31, resolvedDay: 28 }]);
  });
});

describe("exactly one occurrence is actionable, and the dates after it are previews", () => {
  it("previews the next three dates as dates the plan would use, resolving each month-day it has to", () => {
    const preview = nextOccurrences(monthlyRule("2027-01-31", 31), day("2027-01-31"), 3);
    expect(preview.status).toBe("preview");
    if (preview.status !== "preview") {
      return;
    }
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
    if (reading.preview.status !== "preview") {
      return;
    }
    expect(reading.preview.dates).toHaveLength(3);
    // The next date the rule produces is the one already in hand: it is a preview of itself and the one
    // date that can be answered today.
    expect(reading.preview.dates[0]).toBe(occurrence.dueOn);
    // Only that date is work. The dates the preview forecasts beyond it are dates the plan would use,
    // so no second occurrence exists that anyone could act on.
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
    // Completing a repeated reminder is not proof of contact: it records that the task was done, and
    // no activity record appears beside it.
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

    // A second completion of the same date cannot cascade: the series already holds its one successor,
    // so the attempt changes nothing and admits no second one.
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
    // Skipping answered the date; it did not perform it, so the date is cancelled rather than completed.
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
    // Anchor the literals below to the clock the seed lays down.
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

    // The three resolutions are the whole of what a plan in review offers: keep, move, or stop.
    expect(reading.data.planReview.resolutions).toHaveLength(3);
    expect([...reading.data.planReview.resolutions]).toEqual(["keep-this-occurrence", "move-next-date-forward", "stop-series"]);
    expect(actionOf(reading.actions, "resolveMissedPlan").available).toBe(true);

    // A missed date is not an obligation: the three dates are not materialised as three overdue tasks,
    // and a stopped series' left-behind list is the only such list this read ever carries.
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

    const fourth = invalidOutcomeOf(
      await mutations.series.resolveMissedPlan(inputOf(untyped<ResolveMissedPlanPayload>({ occurrenceId: occurrence.taskId, resolution: "reschedule-everything" }), occurrence.revision), source()),
      "resolveMissedPlan with a resolution outside the three",
    );
    expect(Object.keys(fourth.fields)).toEqual(["resolution"]);

    const resolved = acceptedOf(
      await mutations.series.resolveMissedPlan(inputOf({ occurrenceId: occurrence.taskId, resolution: "keep-this-occurrence" }, occurrence.revision), source()),
      "resolveMissedPlan",
    );
    expect(resolved.changed).toContain(created.seriesId);

    const after = await seriesReadingOf(created.seriesId);
    expect(after.planReview.recordedPlanNeedsReview).toBe(false);
    // Keeping the occurrence decided what the plan is; it performed nothing and recorded nothing.
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

    const edited = acceptedOf(
      await mutations.series.editOccurrence(inputOf({ occurrenceId: successor.taskId, title: "Call round, moved by hand", note: "Speak to the warden first." }, successor.revision), source()),
      "editOccurrence",
    );
    expect(edited.changed).toContain(successor.taskId);

    const after = await seriesEnvelopeOf(created.seriesId);
    expect(occurrenceOf(after.data).title).toBe("Call round, moved by hand");
    expect(occurrenceOf(after.data).note).toBe("Speak to the warden first.");
    // One date's own work is not the plan: the rule, its revisions and the series' own revision stand.
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

    const edited = acceptedOf(
      await mutations.series.editThisAndFuture(inputOf({ seriesId: created.seriesId, effectiveFrom: WEEK_AFTER_SEED_DAY, profile: "everyNWeeks", interval: 3 }, before.revision), source()),
      "editThisAndFuture",
    );
    // The revised rule is its own record, named by the answer that created it.
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

    // The boundary is inclusive from the date it names: the date at it takes the new rule, and the date
    // immediately before it — the one already completed — stays under the rule it was planned under.
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

    // The completed date itself sits behind the boundary a revision may take effect from, so the plan
    // cannot reach back and re-describe it.
    const refused = outcomeOf(
      await mutations.series.editThisAndFuture(inputOf({ seriesId: created.seriesId, effectiveFrom: SEED_DAY, profile: "everyNWeeks", interval: 2 }, before.revision), source()),
    );
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
    // The outstanding date is still the date it was: pausing stopped future admission, not the work.
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
    // Resuming re-admits the date that was already outstanding; it backfills nothing from the pause.
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
    // The outstanding date is accounted for and kept: stopping explains its fate without claiming it was done.
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
    // The revision is captured before the stop: capturing it afterwards would let this case pass for the
    // wrong reason, because a stale action is exactly what a caller still holding the old token sends.
    const staleRevision = (await seriesEnvelopeOf(created.seriesId)).revision;
    const stopped = acceptedOf(await mutations.series.stopSeries(inputOf({ seriesId: created.seriesId, unfinishedWork: "keep" }, staleRevision), source()), "stopSeries");
    expect(stopped.revision).not.toBe(staleRevision);

    const stalePause = conflictOutcomeOf(await mutations.series.pauseSeries(inputOf({ seriesId: created.seriesId }, staleRevision), source()), "pauseSeries with the revision read before the stop");
    expect(stalePause.reason).toBe("stale-revision");
    expect(stalePause.currentRevision).toBe(stopped.revision);
    expect(stalePause.preservedInput).toEqual({ seriesId: created.seriesId });

    // The other two actions a caller might still hold an open form for are stale in the same way.
    conflictOutcomeOf(await mutations.series.resumeSeries(inputOf({ seriesId: created.seriesId }, staleRevision), source()), "resumeSeries with the revision read before the stop");
    conflictOutcomeOf(
      await mutations.series.editThisAndFuture(inputOf({ seriesId: created.seriesId, effectiveFrom: WEEK_AFTER_SEED_DAY, profile: "everyNWeeks", interval: 2 }, staleRevision), source()),
      "editThisAndFuture with the revision read before the stop",
    );

    const afterStale = await seriesEnvelopeOf(created.seriesId);
    expect(afterStale.data.state).toBe("stopped");
    expect(afterStale.data.effectiveRevisions).toHaveLength(1);

    // Presenting the current token instead does not revive it either: a stopped series has no resume.
    const current = outcomeOf(await mutations.series.resumeSeries(inputOf({ seriesId: created.seriesId }, stopped.revision), source()));
    expect(current.outcome).toBe("unchanged");
    const afterCurrent = await seriesEnvelopeOf(created.seriesId);
    expect(afterCurrent.data.state).toBe("stopped");
    expect(afterCurrent.data.admitsFurtherOccurrences).toBe(false);
  });

  it("keeps paused and stopped distinct: a paused series resumes, a stopped one cannot", async () => {
    expect(SERIES_STATES).toHaveLength(3);
    expect([...SERIES_STATES]).toEqual(["active", "paused", "stopped"]);

    // The seed holds one series in each of the two states that stop admitting dates.
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
