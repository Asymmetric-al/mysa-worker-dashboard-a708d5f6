/**
 * The one support goal: its record, the explicit `canEditGoal` gate, the amount validation, the pure
 * save decision the service wraps in its outcome union, and the single percentage computation every
 * goal surface presents.
 */
import type { MinorUnits } from "../money/amount";
import { exponentOf } from "../money/currency";
import type { CivilDate } from "../time/civil";
import type { SupportMeasure } from "./basis";
// The goal record
/** The one support goal of a support subject: a target amount, the measure it is a target for, the civil day it took effect on, and the revision an edit must present. */
export interface GoalRecord {
  readonly minorUnits: MinorUnits;
  readonly currency: string;
  readonly measure: SupportMeasure;
  readonly effectiveFrom: CivilDate;
  readonly revision: number;
}
/** The measure a support goal is a target for in this release: received support on the one named basis. */
export const GOAL_MEASURE = "received-gifts" as const satisfies SupportMeasure;
// The permission gate
/** The capability that, and only that, permits editing the goal. */
export const GOAL_CAPABILITY = "canEditGoal";
/** Why a goal save was refused, and nothing about the goal it was refused for. */
export type GoalDenialReason = "capability-absent" | "scope-mismatch" | "source-unavailable";
/** Whether the caller holds the capability that permits editing the goal — the single permission test for a goal in this application. */
export function canEditGoal(capabilities: readonly string[]): boolean {
  return capabilities.includes(GOAL_CAPABILITY);
}
// The amount
/** A stated goal amount: an exact count of minor units and the currency those units belong to. */
export interface GoalAmountInput {
  readonly minorUnits: MinorUnits;
  readonly currency: string;
}
/** One reason a stated goal amount cannot be accepted, keyed by the field it belongs to so the `invalid` outcome carries per-field messages and the form can mark the field that is wrong. */
export type GoalAmountProblem = { readonly field: "minorUnits"; readonly message: string } | { readonly field: "currency"; readonly message: string };
/** Validates a stated goal amount, returning one problem per refused field and an empty list when the amount is acceptable. */
export function validateGoalAmount(input: GoalAmountInput): GoalAmountProblem[] {
  const problems: GoalAmountProblem[] = [];
  const amount: number = input.minorUnits;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    problems.push({
      field: "minorUnits",
      message: "Set the goal to a whole number of the currency's minor units greater than zero; a fractional count cannot be stated exactly, and zero or a negative number is not a target.",
    });
  }
  if (exponentOf(input.currency) === undefined) {
    problems.push({
      field: "currency",
      message: "This application holds no minor-unit precision for this currency, so a goal cannot be stated in it exactly; choose a currency with a known exponent rather than having one assumed.",
    });
  }
  return problems;
}
// The save decision
/** A save request as the editor states it: the amount the worker entered and the revision it was made against. */
export interface GoalSaveInput {
  readonly amount: GoalAmountInput;
  readonly expectedRevision: number;
}
/** The five answers a save can receive, each of which the service maps to one member of its own outcome union. */
export type GoalSaveDecision =
  | { readonly status: "accepted"; readonly goal: GoalRecord }
  | { readonly status: "unchanged"; readonly goal: GoalRecord }
  | {
      readonly status: "conflict";
      readonly current: GoalRecord;
      readonly input: GoalSaveInput;
    }
  | { readonly status: "denied"; readonly reason: GoalDenialReason }
  | { readonly status: "invalid"; readonly problems: GoalAmountProblem[] };
/** Decides a goal save and returns the goal it would produce, without writing anything. */
export function applyGoalSave(current: GoalRecord | undefined, input: GoalSaveInput, capabilities: readonly string[], sourceAvailable: boolean, effectiveFrom: CivilDate): GoalSaveDecision {
  if (!canEditGoal(capabilities)) {
    return { status: "denied", reason: "capability-absent" };
  }
  if (!sourceAvailable) {
    return { status: "denied", reason: "source-unavailable" };
  }
  const problems = validateGoalAmount(input.amount);
  if (problems.length > 0) {
    return { status: "invalid", problems };
  }
  if (current === undefined) {
    return {
      status: "accepted",
      goal: {
        minorUnits: input.amount.minorUnits,
        currency: input.amount.currency,
        measure: GOAL_MEASURE,
        effectiveFrom,
        revision: 1,
      },
    };
  }
  if (input.expectedRevision !== current.revision) {
    return { status: "conflict", current, input };
  }
  if (input.amount.minorUnits === current.minorUnits && input.amount.currency === current.currency) {
    return { status: "unchanged", goal: current };
  }
  return {
    status: "accepted",
    goal: {
      ...current,
      minorUnits: input.amount.minorUnits,
      currency: input.amount.currency,
      revision: current.revision + 1,
    },
  };
}
// Progress
/** Every state a progress figure can be in, each one a different rendering and a different sentence. */
export type GoalProgressState = "value" | "no-goal" | "no-percentage" | "zero" | "incompatible" | "paused" | "ended" | "unavailable";
/** A progress figure: its state, and the percentage in basis points — whole hundredths of a percent — only when the state is `value` or `zero`. */
export interface GoalProgress {
  readonly state: GoalProgressState;
  readonly percentageBasisPoints: number | null;
}
/** What a progress figure is computed from. */
export interface GoalProgressInput {
  readonly goal?: GoalRecord;
  readonly numeratorMinor?: MinorUnits;
  readonly denominatorMinor?: MinorUnits;
  readonly measureCompatible?: boolean;
  readonly paused?: boolean;
  readonly ended?: boolean;
  readonly sourceAvailable?: boolean;
}
const BASIS_POINTS_PER_PERCENT = 100n;

const BASIS_POINTS_PER_RATIO = 10_000n;

const NO_PERCENTAGE: GoalProgress = { state: "no-percentage", percentageBasisPoints: null };
/** The percentage behind a progress figure — the only place in the application where a goal percentage is computed. */
export function goalProgress(input: GoalProgressInput): GoalProgress {
  if (input.sourceAvailable === false) {
    return { state: "unavailable", percentageBasisPoints: null };
  }
  const goal = input.goal;
  if (goal === undefined) {
    return { state: "no-goal", percentageBasisPoints: null };
  }
  if (input.ended === true) {
    return { state: "ended", percentageBasisPoints: null };
  }
  if (input.paused === true) {
    return { state: "paused", percentageBasisPoints: null };
  }
  if (input.measureCompatible === false) {
    return { state: "incompatible", percentageBasisPoints: null };
  }
  const denominator: number = input.denominatorMinor ?? goal.minorUnits;
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    return NO_PERCENTAGE;
  }
  const numerator: number | undefined = input.numeratorMinor;
  if (numerator === undefined || !Number.isSafeInteger(numerator)) {
    return NO_PERCENTAGE;
  }
  if (numerator === 0) {
    return { state: "zero", percentageBasisPoints: 0 };
  }
  const basisPoints = (BigInt(numerator) * BASIS_POINTS_PER_RATIO) / BigInt(denominator);
  const percentageBasisPoints = Number(basisPoints);
  if (!Number.isSafeInteger(percentageBasisPoints)) {
    return NO_PERCENTAGE;
  }
  return { state: "value", percentageBasisPoints };
}
/** Renders basis points as the percentage a surface shows: `12000` is `120%`, `12345` is `123.45%`. */
export function formatPercentageBasisPoints(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints)) {
    throw new RangeError(
      "formatPercentageBasisPoints: a percentage is stated as a whole number of basis points, so a fractional or non-finite value is refused rather than rounded to a figure no caller computed.",
    );
  }
  const sign = basisPoints < 0 ? "-" : "";
  const magnitude = BigInt(basisPoints < 0 ? -basisPoints : basisPoints);
  const whole = magnitude / BASIS_POINTS_PER_PERCENT;
  const hundredths = magnitude % BASIS_POINTS_PER_PERCENT;
  if (hundredths === 0n) {
    return `${sign}${whole}%`;
  }
  const fraction = hundredths.toString().padStart(2, "0").replace(/0+$/u, "");
  return `${sign}${whole}.${fraction}%`;
}
