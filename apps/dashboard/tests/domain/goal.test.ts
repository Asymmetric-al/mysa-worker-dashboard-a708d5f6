/** Success criterion 7, at the service boundary: the one support goal, the single financial write this application permits (`saveGoal`), and the percentage rules every goal surface presents. */
import { Temporal } from "temporal-polyfill";
import { beforeAll, describe, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type Scope } from "@/modules/data-service";
import { canEdit, canExport, canReadProtected, resolveSession, type AccessDecision, type ResolvedSession, type SessionSource } from "@/modules/data-service/authorize";
import { DENIAL_REASONS, isOutcome, type DeniedOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { resetSeed } from "@/modules/dev-runtime/reset";
import { minorUnitsOf, type MinorUnits } from "@/modules/money/amount";
import { GOAL_CAPABILITY, GOAL_MEASURE, canEditGoal, formatPercentageBasisPoints, goalProgress, validateGoalAmount, type GoalProgress, type GoalRecord } from "@/modules/support/goal";
const FUNDRAISER: SessionSource = { sessionId: "deputized-fundraiser" };
const REVIEWER: SessionSource = { sessionId: "content-reviewer" };
const STUDENTS: SessionSource = { sessionId: "established-worker-students" };
const SECOND_WORKER: SessionSource = { sessionId: "second-worker" };
interface GoalSavePayload {
  readonly currency?: string;
  readonly amount: { readonly currency: string; readonly minorUnits: number };
  readonly measure: typeof GOAL_MEASURE;
  readonly effectiveFrom: string;
}
type GoalRead = Awaited<ReturnType<typeof reads.support.readGoal>>;
type GoalEnvelope = Extract<GoalRead, { readonly kind: "envelope" }>["envelope"];
type GoalReportData = GoalEnvelope["data"]["report"];
type GoalFigure = NonNullable<GoalEnvelope["data"]["goal"]>;
type OutcomeName = MutationOutcome["outcome"];
async function seedWorld(): Promise<void> {
  await resetSeed();
}
async function sessionOf(source: SessionSource): Promise<ResolvedSession> {
  const resolution = await resolveSession(source);
  if (!resolution.ok) throw new Error(`The seeded session ${source.sessionId} could not be resolved, so no case can act as it: ${JSON.stringify(resolution.refusal)}`);
  return resolution.session;
}
async function scopeOf(source: SessionSource): Promise<Scope> {
  const session = await sessionOf(source);
  if (session.selected === null) throw new Error(`The seeded session ${source.sessionId} has selected no context, so no goal can be read or saved in one.`);
  return session.selected;
}
async function goalEnvelopeOf(source: SessionSource): Promise<GoalEnvelope> {
  const result = await reads.support.readGoal({}, source);
  if (result.kind !== "envelope") throw new Error(`The goal read for ${source.sessionId} answered "${result.kind}" instead of an envelope, so there is no goal surface to assert against.`);
  return result.envelope;
}
function figureOf(envelope: GoalEnvelope): GoalFigure {
  const goal = envelope.data.goal;
  if (goal === null) throw new Error("This subject states no goal, so the case that needs one cannot read it; the seeded world is not the one this file starts from.");
  return goal;
}
async function currentGoalOf(source: SessionSource): Promise<GoalFigure> {
  return figureOf(await goalEnvelopeOf(source));
}
async function reportEnvelopeOf(source: SessionSource): Promise<Extract<Awaited<ReturnType<typeof reads.support.readReport>>, { readonly kind: "envelope" }>["envelope"]> {
  const result = await reads.support.readReport("received-period-and-year-to-date", {}, source);
  if (result.kind !== "envelope") throw new Error(`The report read for ${source.sessionId} answered "${result.kind}" instead of an envelope, so nothing can be compared before and after a goal save.`);
  return result.envelope;
}
async function commitmentsEnvelopeOf(source: SessionSource): Promise<Extract<Awaited<ReturnType<typeof reads.support.readCommitments>>, { readonly kind: "envelope" }>["envelope"]> {
  const result = await reads.support.readCommitments({}, source);
  if (result.kind !== "envelope") throw new Error(`The commitments read for ${source.sessionId} answered "${result.kind}" instead of an envelope, so nothing can be compared before and after a goal save.`);
  return result.envelope;
}
async function saveGoalFor(source: SessionSource, scope: Scope, expectedRevision: string, payload: GoalSavePayload, operationId: string = newOperationId()): Promise<MutationOutcome> {
  return mutations.support.saveGoal({ operationId, scope, expectedRevision, payload }, source);
}
function goalPayload(goal: GoalFigure, minorUnits: number): GoalSavePayload {
  return { amount: { currency: goal.amount.currency, minorUnits }, measure: GOAL_MEASURE, effectiveFrom: goal.effectiveFrom };
}
function outcomeNamed<Name extends OutcomeName>(outcome: MutationOutcome, name: Name): Extract<MutationOutcome, { readonly outcome: Name }> {
  expect(isOutcome(outcome)).toBe(true);
  expect(outcome.outcome).toBe(name);
  if (outcome.outcome !== name) throw new Error(`The case expects the "${name}" outcome and the service answered "${outcome.outcome}": ${JSON.stringify(outcome)}`);
  return outcome as Extract<MutationOutcome, { readonly outcome: Name }>;
}
function denialOf(decision: AccessDecision): DeniedOutcome {
  if (decision.allowed) throw new Error("The case asserts a refusal, and this question was permitted, so a financial write has widened an authority this file never grants.");
  return decision.denial;
}
function withoutGoalProgress(report: GoalReportData): Readonly<Record<string, unknown>> {
  const facts: Record<string, unknown> = { ...report };
  delete facts.goal;
  return facts;
}
beforeAll(seedWorld, 120_000);

describe("a goal with no editing capability", () => {
  it("offers no edit and states why, and the service refuses the same save independently", async () => {
    const session = await sessionOf(REVIEWER);
    const envelope = await goalEnvelopeOf(REVIEWER);
    const goal = figureOf(envelope);
    expect(goal.amount.minorUnits).toBeGreaterThan(0);
    expect(envelope.data.canEditGoal).toBe(false);
    expect(envelope.data.canEditGoal).toBe(canEditGoal(session.capabilities));
    expect(canEditGoal([GOAL_CAPABILITY])).toBe(true);
    expect(canEditGoal([])).toBe(false);
    const edit = envelope.actions.find((action) => action.name === GOAL_CAPABILITY);
    expect(edit).toBeDefined();
    expect(edit?.available).toBe(false);
    expect((edit?.reason ?? "").trim().length).toBeGreaterThan(0);
    expect(envelope.actions.filter((action) => action.available && action.name === GOAL_CAPABILITY)).toEqual([]);
    const scope = await scopeOf(REVIEWER);
    const outcome = await saveGoalFor(REVIEWER, scope, goal.revision, goalPayload(goal, goal.amount.minorUnits + 1000));
    const refused = outcomeNamed(outcome, "denied");
    expect(refused.reasonCode).toBe("capability-absent");
    expect(DENIAL_REASONS).toContain(refused.reasonCode);
    expect(Object.keys(refused).sort()).toEqual(["operationId", "outcome", "reasonCode"]);
    expect(JSON.stringify(refused)).not.toContain(String(goal.amount.minorUnits));
    expect(await currentGoalOf(REVIEWER)).toEqual(goal);
  });
  it("refuses a save a principal makes in another principal's scope", async () => {
    const establishedScope = await scopeOf(FUNDRAISER);
    const goal = await currentGoalOf(FUNDRAISER);
    const outcome = await saveGoalFor(REVIEWER, establishedScope, goal.revision, goalPayload(goal, goal.amount.minorUnits + 1000));
    const refused = outcomeNamed(outcome, "denied");
    expect(refused.reasonCode).toBe("not-admitted");
    expect(await currentGoalOf(FUNDRAISER)).toEqual(goal);
  });
});
describe("the one permitted financial write", () => {
  it("accepts the smallest amount the currency can state, and returns the new revision and what it created", async () => {
    const scope = await scopeOf(STUDENTS);
    const before = await goalEnvelopeOf(STUDENTS);
    expect(before.data.goal).toBeNull();
    expect(before.data.canEditGoal).toBe(true);
    const smallest = 1;
    const currency = "EUR";
    expect(validateGoalAmount({ currency, minorUnits: minorUnitsOf(smallest) })).toEqual([]);
    const payload: GoalSavePayload = { amount: { currency, minorUnits: smallest }, measure: GOAL_MEASURE, effectiveFrom: before.data.period.from };
    const accepted = outcomeNamed(await saveGoalFor(STUDENTS, scope, before.revision, payload), "accepted");
    expect(accepted.revision).toBe("1");
    expect(accepted.created).toEqual([scope.supportSubjectId]);
    expect(accepted.changed).toBeUndefined();
    const saved = await currentGoalOf(STUDENTS);
    expect(saved.amount).toEqual({ currency, minorUnits: smallest });
    expect(Number.isSafeInteger(saved.amount.minorUnits)).toBe(true);
    expect(saved.amount.minorUnits).toBeGreaterThan(0);
    expect(saved.effectiveFrom).toBe(before.data.period.from);
    expect(saved.revision).toBe("1");
    expect((await goalEnvelopeOf(STUDENTS)).data.measure).toBe(GOAL_MEASURE);
  });
  it.each([
    { stated: "zero", minorUnits: 0 },
    { stated: "negative", minorUnits: -1 },
    { stated: "fractional", minorUnits: 10.5 },
  ])("refuses a $stated goal amount as invalid against the amount field", async ({ minorUnits }) => {
    const scope = await scopeOf(FUNDRAISER);
    const goal = await currentGoalOf(FUNDRAISER);
    const refused = outcomeNamed(await saveGoalFor(FUNDRAISER, scope, goal.revision, goalPayload(goal, minorUnits)), "invalid");
    const messages = refused.fields["amount.minorUnits"];
    expect(messages).toBeDefined();
    expect(messages?.length ?? 0).toBeGreaterThan(0);
    expect((messages ?? []).every((message) => message.trim().length > 0)).toBe(true);
    expect(await currentGoalOf(FUNDRAISER)).toEqual(goal);
  });
  it.each([
    { stated: "a currency with no known minor-unit precision", field: "amount.currency", payload: (goal: GoalFigure): GoalSavePayload => ({ ...goalPayload(goal, goal.amount.minorUnits), amount: { currency: "ZZZ", minorUnits: goal.amount.minorUnits } }) },
    { stated: "a measure this release does not set a goal against", field: "measure", payload: (goal: GoalFigure): GoalSavePayload => ({ ...goalPayload(goal, goal.amount.minorUnits), measure: "commitments" as typeof GOAL_MEASURE }) },
    { stated: "a form currency that disagrees with the amount's", field: "currency", payload: (goal: GoalFigure): GoalSavePayload => ({ ...goalPayload(goal, goal.amount.minorUnits), currency: goal.amount.currency === "USD" ? "EUR" : "USD" }) },
    { stated: "a day the calendar does not have", field: "effectiveFrom", payload: (goal: GoalFigure): GoalSavePayload => ({ ...goalPayload(goal, goal.amount.minorUnits), effectiveFrom: "2026-02-31" }) },
  ])("refuses $stated as invalid against $field", async ({ field, payload }) => {
    const scope = await scopeOf(FUNDRAISER);
    const goal = await currentGoalOf(FUNDRAISER);
    const refused = outcomeNamed(await saveGoalFor(FUNDRAISER, scope, goal.revision, payload(goal)), "invalid");
    const messages = refused.fields[field];
    expect(messages).toBeDefined();
    expect((messages ?? []).every((message) => message.trim().length > 0)).toBe(true);
    expect(await currentGoalOf(FUNDRAISER)).toEqual(goal);
  });
  it("answers a save that states the amount already set with unchanged, and advances no revision", async () => {
    const scope = await scopeOf(FUNDRAISER);
    const goal = await currentGoalOf(FUNDRAISER);
    const outcome = await saveGoalFor(FUNDRAISER, scope, goal.revision, goalPayload(goal, goal.amount.minorUnits));
    const unchanged = outcomeNamed(outcome, "unchanged");
    expect(unchanged.revision).toBe(goal.revision);
    expect(await currentGoalOf(FUNDRAISER)).toEqual(goal);
  });
  it("advances the revision by exactly one and names the one record it changed", async () => {
    const scope = await scopeOf(FUNDRAISER);
    const goal = await currentGoalOf(FUNDRAISER);
    const next = goal.amount.minorUnits + 1000;
    const accepted = outcomeNamed(await saveGoalFor(FUNDRAISER, scope, goal.revision, goalPayload(goal, next)), "accepted");
    expect(accepted.revision).toBe(String(Number(goal.revision) + 1));
    expect(accepted.changed).toEqual([scope.supportSubjectId]);
    expect(accepted.created).toBeUndefined();
    const saved = await currentGoalOf(FUNDRAISER);
    expect(saved.revision).toBe(accepted.revision);
    expect(saved.amount).toEqual({ currency: goal.amount.currency, minorUnits: next });
    expect(saved.effectiveFrom).toBe(goal.effectiveFrom);
    expect(saved.measure).toBe(goal.measure);
  });
});
describe("a stale revision is a conflict, never an overwrite", () => {
  it("returns the current value beside the caller's preserved payload and writes nothing", async () => {
    const scope = await scopeOf(FUNDRAISER);
    const before = await currentGoalOf(FUNDRAISER);
    const advancing = outcomeNamed(await saveGoalFor(FUNDRAISER, scope, before.revision, goalPayload(before, before.amount.minorUnits + 2000)), "accepted");
    const current = await currentGoalOf(FUNDRAISER);
    expect(advancing.revision).toBe(current.revision);
    const submitted = goalPayload(before, before.amount.minorUnits + 7000);
    const conflict = outcomeNamed(await saveGoalFor(FUNDRAISER, scope, before.revision, submitted), "conflict");
    expect(conflict.reason).toBe("stale-revision");
    expect(conflict.currentRevision).toBe(current.revision);
    expect(conflict.current).toEqual({ amount: { currency: current.amount.currency, minorUnits: current.amount.minorUnits }, measure: current.measure, effectiveFrom: current.effectiveFrom, revision: current.revision });
    expect(conflict.preservedInput).toEqual(submitted);
    expect(conflict.preservedInput).not.toEqual(conflict.current);
    expect(await currentGoalOf(FUNDRAISER)).toEqual(current);
  });
});
describe("a replay is the stored result, not a second effect", () => {
  it("answers the same operation id with alreadyAccepted, the stored result and no advanced revision", async () => {
    const scope = await scopeOf(FUNDRAISER);
    const before = await currentGoalOf(FUNDRAISER);
    const operationId = newOperationId();
    const submitted = goalPayload(before, before.amount.minorUnits + 5000);
    const accepted = outcomeNamed(await saveGoalFor(FUNDRAISER, scope, before.revision, submitted, operationId), "accepted");
    const stored = await currentGoalOf(FUNDRAISER);
    expect(stored.revision).toBe(accepted.revision);
    const replayed = outcomeNamed(await saveGoalFor(FUNDRAISER, scope, before.revision, submitted, operationId), "alreadyAccepted");
    expect(replayed.revision).toBe(accepted.revision);
    expect(replayed.result).toEqual({ amount: { currency: stored.amount.currency, minorUnits: stored.amount.minorUnits }, measure: stored.measure, effectiveFrom: stored.effectiveFrom, revision: stored.revision });
    expect(await currentGoalOf(FUNDRAISER)).toEqual(stored);
  });
  it("refuses the same operation id with a changed payload as a conflict, and applies nothing", async () => {
    const scope = await scopeOf(FUNDRAISER);
    const before = await currentGoalOf(FUNDRAISER);
    const operationId = newOperationId();
    outcomeNamed(await saveGoalFor(FUNDRAISER, scope, before.revision, goalPayload(before, before.amount.minorUnits + 3000), operationId), "accepted");
    const stored = await currentGoalOf(FUNDRAISER);
    const changed = goalPayload(before, before.amount.minorUnits + 4000);
    const conflict = outcomeNamed(await saveGoalFor(FUNDRAISER, scope, stored.revision, changed, operationId), "conflict");
    expect(conflict.reason).toBe("changed-intent");
    expect(conflict.currentRevision).toBe(stored.revision);
    expect(conflict.preservedInput).toEqual(changed);
    expect(await currentGoalOf(FUNDRAISER)).toEqual(stored);
  });
});

async function goalRecordOf(source: SessionSource): Promise<GoalRecord> {
  const goal = await currentGoalOf(source);
  return { minorUnits: goal.amount.minorUnits, currency: goal.amount.currency, measure: GOAL_MEASURE, effectiveFrom: Temporal.PlainDate.from(goal.effectiveFrom), revision: Number(goal.revision) };
}
const NO_PERCENTAGE_CAUSES: readonly { readonly stated: string; readonly expected: GoalProgress["state"]; readonly progress: (goal: GoalRecord) => GoalProgress }[] = [
  { stated: "a subject that states no goal", expected: "no-goal", progress: () => goalProgress({}) },
  { stated: "a numerator with no goal to measure it against", expected: "no-goal", progress: () => goalProgress({ numeratorMinor: minorUnitsOf(120), denominatorMinor: minorUnitsOf(100) }) },
  { stated: "a zero denominator", expected: "no-percentage", progress: (goal) => goalProgress({ goal, numeratorMinor: minorUnitsOf(120), denominatorMinor: minorUnitsOf(0) }) },
  { stated: "an unknown numerator", expected: "no-percentage", progress: (goal) => goalProgress({ goal, denominatorMinor: minorUnitsOf(100) }) },
  {
    stated: "a numerator the source could not state exactly",
    expected: "no-percentage",
    // A fractional count is what an untrustworthy source hands over; the computation refuses it rather than rounding it into a percentage.
    progress: (goal) => goalProgress({ goal, numeratorMinor: Number.NaN as MinorUnits, denominatorMinor: minorUnitsOf(100) }),
  },
  { stated: "a measure the goal is not measured in", expected: "incompatible", progress: (goal) => goalProgress({ goal, numeratorMinor: minorUnitsOf(120), denominatorMinor: minorUnitsOf(100), measureCompatible: false }) },
];
describe("the percentage rules", () => {
  it("keeps a valid 120 % as 120 %, neither clamped nor expressed as a fraction", async () => {
    const goal = await goalRecordOf(FUNDRAISER);
    const progress = goalProgress({ goal, numeratorMinor: minorUnitsOf(120), denominatorMinor: minorUnitsOf(100) });
    expect(progress.state).toBe("value");
    expect(progress.percentageBasisPoints).toBe(12_000);
    expect(formatPercentageBasisPoints(12_000)).toBe("120%");
    expect(formatPercentageBasisPoints(12_000)).not.toBe("100%");
    expect(formatPercentageBasisPoints(12_000)).not.toBe("1.2%");
  });
  it.each(NO_PERCENTAGE_CAUSES)("produces no percentage at all for $stated", async ({ expected, progress }) => {
    const figure = progress(await goalRecordOf(FUNDRAISER));
    expect(figure.state).toBe(expected);
    expect(figure.percentageBasisPoints).toBeNull();
  });
  it("returns six distinct figures for the six situations a surface must not confuse", async () => {
    const goal = await goalRecordOf(FUNDRAISER);
    const figures: Readonly<Record<string, GoalProgress>> = {
      noGoal: goalProgress({}),
      noPercentage: goalProgress({ goal, numeratorMinor: minorUnitsOf(120), denominatorMinor: minorUnitsOf(0) }),
      zero: goalProgress({ goal, numeratorMinor: minorUnitsOf(0), denominatorMinor: minorUnitsOf(100) }),
      oneHundredTwenty: goalProgress({ goal, numeratorMinor: minorUnitsOf(120), denominatorMinor: minorUnitsOf(100) }),
      paused: goalProgress({ goal, numeratorMinor: minorUnitsOf(120), denominatorMinor: minorUnitsOf(100), paused: true }),
      ended: goalProgress({ goal, numeratorMinor: minorUnitsOf(120), denominatorMinor: minorUnitsOf(100), ended: true }),
    };
    const stated = Object.values(figures);
    expect(Object.keys(figures)).toHaveLength(6);
    expect(new Set(stated.map((figure) => figure.state)).size).toBe(6);
    expect(new Set(stated.map((figure) => `${figure.state}|${String(figure.percentageBasisPoints)}`)).size).toBe(6);
    expect(figures.zero?.percentageBasisPoints).toBe(0);
    expect(formatPercentageBasisPoints(0)).toBe("0%");
    expect(figures.noPercentage?.percentageBasisPoints).toBeNull();
    expect(figures.oneHundredTwenty?.percentageBasisPoints).toBe(12_000);
  });
  it("states a subject with no goal as no goal, and records its percentage as unknown rather than zero", async () => {
    const envelope = await goalEnvelopeOf(SECOND_WORKER);
    expect(envelope.data.goal).toBeNull();
    expect(envelope.data.progress.state).toBe("no-goal");
    expect(envelope.data.progress.percentageBasisPoints).toBeNull();
    expect(envelope.data.percentage).toBeNull();
    expect(envelope.revision).toBe("absent");
    expect(envelope.valueStates["goal.amount"]).toBe("unknown");
    expect(envelope.valueStates["goal.percentage"]).toBe("unknown");
  });
  it("takes the percentage a surface shows from the one computation, and states a partial subtotal as partial", async () => {
    const envelope = await goalEnvelopeOf(FUNDRAISER);
    const progress = envelope.data.progress;
    expect(envelope.data.percentage).toBe(progress.percentageBasisPoints === null ? null : formatPercentageBasisPoints(progress.percentageBasisPoints));
    expect(envelope.coverage.state).toBe("partial");
    expect(envelope.valueStates["goal.amount"]).toBe("incomplete-subtotal");
    expect(envelope.valueStates["goal.percentage"]).toBe("incomplete-subtotal");
  });
});
describe("the write reaches nothing but the goal", () => {
  it("leaves the earlier report and the commitment rows untouched", async () => {
    const scope = await scopeOf(FUNDRAISER);
    const reportBefore = await reportEnvelopeOf(FUNDRAISER);
    const commitmentsBefore = await commitmentsEnvelopeOf(FUNDRAISER);
    const goal = await currentGoalOf(FUNDRAISER);
    outcomeNamed(await saveGoalFor(FUNDRAISER, scope, goal.revision, goalPayload(goal, goal.amount.minorUnits * 2)), "accepted");
    const reportAfter = await reportEnvelopeOf(FUNDRAISER);
    const commitmentsAfter = await commitmentsEnvelopeOf(FUNDRAISER);
    expect(withoutGoalProgress(reportAfter.data)).toEqual(withoutGoalProgress(reportBefore.data));
    expect(reportAfter.revision).toBe(reportBefore.revision);
    expect(reportAfter.coverage).toEqual(reportBefore.coverage);
    expect(reportAfter.asOf).toBe(reportBefore.asOf);
    expect(reportAfter.data.goal).not.toEqual(reportBefore.data.goal);
    expect(commitmentsAfter.data).toEqual(commitmentsBefore.data);
    expect(commitmentsAfter.revision).toBe(commitmentsBefore.revision);
  });
  it("grants no other authority, before or after it succeeds", async () => {
    const session = await sessionOf(FUNDRAISER);
    const scope = await scopeOf(FUNDRAISER);
    const reviewerScope = await scopeOf(REVIEWER);
    const reviewer = await sessionOf(REVIEWER);
    const secondWorker = await sessionOf(SECOND_WORKER);
    const goal = await currentGoalOf(FUNDRAISER);
    const protectedReadBefore = denialOf(canReadProtected(session, { audience: "approved-supporter", reader: null }));
    const exportBefore = denialOf(canExport(secondWorker, scope));
    const reviewerEditBefore = denialOf(canEdit(reviewer, { kind: "support-subject", scope: reviewerScope, capabilities: reviewer.capabilities }));
    expect(canEdit(session, { kind: "support-subject", scope, capabilities: session.capabilities }).allowed).toBe(true);
    const accepted = outcomeNamed(await saveGoalFor(FUNDRAISER, scope, goal.revision, goalPayload(goal, goal.amount.minorUnits * 2)), "accepted");
    expect(accepted.changed).toEqual([scope.supportSubjectId]);
    const protectedReadAfter = denialOf(canReadProtected(session, { audience: "approved-supporter", reader: null }));
    const exportAfter = denialOf(canExport(secondWorker, scope));
    const reviewerEditAfter = denialOf(canEdit(reviewer, { kind: "support-subject", scope: reviewerScope, capabilities: reviewer.capabilities }));
    expect(protectedReadAfter.reasonCode).toBe(protectedReadBefore.reasonCode);
    expect(exportAfter.reasonCode).toBe(exportBefore.reasonCode);
    expect(reviewerEditAfter.reasonCode).toBe(reviewerEditBefore.reasonCode);
    expect(protectedReadAfter.reasonCode).toBe("no-protected-grant");
    expect(exportAfter.reasonCode).toBe("not-admitted");
    expect(reviewerEditAfter.reasonCode).toBe("capability-absent");
    expect(canEdit(session, { kind: "support-subject", scope, capabilities: session.capabilities }).allowed).toBe(true);
  });
});
describe("the goal is a measure of its own", () => {
  it("is never one of the received amounts and never a commitment's occurrence", async () => {
    const envelope = await goalEnvelopeOf(FUNDRAISER);
    const commitments = await commitmentsEnvelopeOf(FUNDRAISER);
    const goal = figureOf(envelope);
    expect(envelope.data.measure).toBe(GOAL_MEASURE);
    const received = envelope.data.report.summary.map((entry) => `${entry.currency}:${String(entry.received.minorUnits)}`);
    expect(received).not.toContain(`${goal.amount.currency}:${goal.amount.minorUnits}`);
    const occurrences = commitments.data.commitments.map((commitment) => `${commitment.perOccurrence.currency}:${commitment.perOccurrence.minorUnits}`);
    expect(occurrences).not.toContain(`${goal.amount.currency}:${goal.amount.minorUnits}`);
    expect(Object.keys(commitments.data)).not.toContain("goal");
  });
});
