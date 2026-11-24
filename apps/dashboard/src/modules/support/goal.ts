import type { MinorUnits } from "../money/amount";
import { exponentOf } from "../money/currency";
import type { CivilDate } from "../time/civil";
import type { SupportMeasure } from "./basis";
export type GoalRecord = { readonly minorUnits: MinorUnits; readonly currency: string; readonly measure: SupportMeasure; readonly effectiveFrom: CivilDate; readonly revision: number };
export const GOAL_MEASURE = "received-gifts" as const satisfies SupportMeasure;
export const GOAL_CAPABILITY = "canEditGoal";
export type GoalDenialReason = "capability-absent" | "scope-mismatch" | "source-unavailable";
/** Whether the caller holds the capability that permits editing the goal — the single permission test for a goal in this application. */
export const canEditGoal = (capabilities: readonly string[]): boolean => capabilities.includes(GOAL_CAPABILITY);
export type GoalAmountInput = { readonly minorUnits: MinorUnits; readonly currency: string };
export type GoalAmountProblem = { readonly field: "minorUnits"; readonly message: string } | { readonly field: "currency"; readonly message: string };
/** Validates a stated goal amount, returning one problem per refused field and an empty list when the amount is acceptable. */ export function validateGoalAmount(input: GoalAmountInput): GoalAmountProblem[] {
  const problems: GoalAmountProblem[] = [];
  const amount: number = input.minorUnits;
  if (!Number.isSafeInteger(amount) || amount <= 0) problems.push({ field: "minorUnits", message: "Set the goal to a whole number of the currency's minor units greater than zero; a fractional count cannot be stated exactly, and zero or a negative number is not a target." });
  if (exponentOf(input.currency) === undefined) problems.push({ field: "currency", message: "This application holds no minor-unit precision for this currency, so a goal cannot be stated in it exactly; choose a currency with a known exponent rather than having one assumed." });
  return problems;
}
export type GoalSaveInput = { readonly amount: GoalAmountInput; readonly expectedRevision: number };
export type GoalSaveDecision =
  | { readonly status: "accepted"; readonly goal: GoalRecord }
  | { readonly status: "unchanged"; readonly goal: GoalRecord }
  | { readonly status: "conflict"; readonly current: GoalRecord; readonly input: GoalSaveInput }
  | { readonly status: "denied"; readonly reason: GoalDenialReason }
  | { readonly status: "invalid"; readonly problems: GoalAmountProblem[] };
/** Decides a goal save and returns the goal it would produce, without writing anything. */
export function applyGoalSave(current: GoalRecord | undefined, input: GoalSaveInput, capabilities: readonly string[], sourceAvailable: boolean, effectiveFrom: CivilDate): GoalSaveDecision {
  if (!canEditGoal(capabilities)) return { status: "denied", reason: "capability-absent" };
  if (!sourceAvailable) return { status: "denied", reason: "source-unavailable" };
  const problems = validateGoalAmount(input.amount);
  if (problems.length > 0) return { status: "invalid", problems };
  if (current === undefined) return { status: "accepted", goal: { minorUnits: input.amount.minorUnits, currency: input.amount.currency, measure: GOAL_MEASURE, effectiveFrom, revision: 1 } };
  if (input.expectedRevision !== current.revision) return { status: "conflict", current, input };
  return input.amount.minorUnits === current.minorUnits && input.amount.currency === current.currency ? { status: "unchanged", goal: current } : { status: "accepted", goal: { ...current, minorUnits: input.amount.minorUnits, currency: input.amount.currency, revision: current.revision + 1 } };
}
export type GoalProgressState = "value" | "no-goal" | "no-percentage" | "zero" | "incompatible" | "paused" | "ended" | "unavailable";
export type GoalProgress = { readonly state: GoalProgressState; readonly percentageBasisPoints: number | null };
export type GoalProgressInput = { readonly goal?: GoalRecord; readonly numeratorMinor?: MinorUnits; readonly denominatorMinor?: MinorUnits; readonly measureCompatible?: boolean; readonly paused?: boolean; readonly ended?: boolean; readonly sourceAvailable?: boolean };
const BASIS_POINTS_PER_PERCENT = 100n;
const BASIS_POINTS_PER_RATIO = 10_000n;
const NO_PERCENTAGE: GoalProgress = { state: "no-percentage", percentageBasisPoints: null };
/** The percentage behind a progress figure — the only place in the application where a goal percentage is computed. */ export function goalProgress(input: GoalProgressInput): GoalProgress {
  if (input.sourceAvailable === false) return { state: "unavailable", percentageBasisPoints: null };
  const goal = input.goal;
  if (goal === undefined) return { state: "no-goal", percentageBasisPoints: null };
  if (input.ended === true) return { state: "ended", percentageBasisPoints: null };
  if (input.paused === true) return { state: "paused", percentageBasisPoints: null };
  if (input.measureCompatible === false) return { state: "incompatible", percentageBasisPoints: null };
  const denominator: number = input.denominatorMinor ?? goal.minorUnits;
  if (!Number.isSafeInteger(denominator) || denominator <= 0) return NO_PERCENTAGE;
  const numerator: number | undefined = input.numeratorMinor;
  if (numerator === undefined || !Number.isSafeInteger(numerator)) return NO_PERCENTAGE;
  if (numerator === 0) return { state: "zero", percentageBasisPoints: 0 };
  const basisPoints = (BigInt(numerator) * BASIS_POINTS_PER_RATIO) / BigInt(denominator);
  const percentageBasisPoints = Number(basisPoints);
  return !Number.isSafeInteger(percentageBasisPoints) ? NO_PERCENTAGE : { state: "value", percentageBasisPoints };
}
/** Renders basis points as the percentage a surface shows: `12000` is `120%`, `12345` is `123.45%`. */ export function formatPercentageBasisPoints(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints)) throw new RangeError("formatPercentageBasisPoints: a percentage is stated as a whole number of basis points, so a fractional or non-finite value is refused rather than rounded to a figure no caller computed.");
  const sign = basisPoints < 0 ? "-" : "";
  const magnitude = BigInt(basisPoints < 0 ? -basisPoints : basisPoints);
  const whole = magnitude / BASIS_POINTS_PER_PERCENT;
  const hundredths = magnitude % BASIS_POINTS_PER_PERCENT;
  if (hundredths === 0n) return `${sign}${whole}%`;
  return `${sign}${whole}.${hundredths.toString().padStart(2, "0").replace(/0+$/u, "")}%`;
}
