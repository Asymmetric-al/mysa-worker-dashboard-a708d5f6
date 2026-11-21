/**
 * The one support goal: its record, the explicit `canEditGoal` gate, the amount validation, the pure
 * save decision the service wraps in its outcome union, and the single percentage computation every
 * goal surface presents.
 *
 * Plan items that put this file in scope:
 * - AAP 0.8.1 rows 5–7: goal progress needs a compatible numerator and a positive denominator; a
 *   valid 120% stays 120%; the goal is read-only unless the explicit `canEditGoal` capability is
 *   present; editing takes a positive amount at the currency's precision, saves against the base
 *   revision and recovers on retry.
 * - AAP 0.6.2 "Support projection": the optional `goal {minorUnits, currency, measure,
 *   effectiveFrom, revision}`.
 * - AAP 0.6.1: `mutations/support.ts#saveGoal` is the single permitted financial write, and it calls
 *   this file rather than re-implementing any of it.
 * - AAP 0.8.7: exact integer minor units with the exponent looked up, never assumed.
 * - AAP 0.12.1 criterion 7, the AAP 0.9.1 tree and the AAP 0.11.1 deliverable row
 *   `modules/support/{report,buckets,basis,goal}.ts`.
 *
 * This module owns four things and nothing else may compute or decide them: the goal record, the one
 * permission test for a goal, the amount validation, and the percentage behind a progress figure.
 * `report.ts`, `data-service/reads/support.ts`, `data-service/mutations/support.ts` and
 * `features/support` read that vocabulary here instead of restating it.
 *
 * Six renderings stay six. `no-goal`, `no-percentage`, a genuine `0%`, a `120%`, `paused` and
 * `ended` are different answers, and `unavailable` is a seventh: no state is ever expressed as
 * another, a percentage is never invented, and a number that could not be computed is never shown as
 * zero, `NaN` or `Infinity`.
 *
 * What an edit proves, and what it never does: the goal is a target the worker set, not a financial
 * record. Saving one never posts, corrects, refunds or retries money, never rewrites an earlier
 * report, never publishes public progress, never changes a commitment and never grants finance,
 * publishing or coaching permission. The finance owner is a documented future seam in
 * `docs/architecture.md`, not a hook here.
 *
 * Purity and arithmetic: every export is a constant or a pure function of its argument. No clock is
 * read — an effective date arrives as a parameter — nothing is stored, fetched or mutated, no module
 * state is held, and no side effect runs at import. Financial values stay integer counts of minor
 * units: a monetary value is never parsed from, formatted with or rounded through floating-point
 * arithmetic, and no `number` here stands for major units.
 */
import type { MinorUnits } from "../money/amount";
import { exponentOf } from "../money/currency";
import type { CivilDate } from "../time/civil";
import type { SupportMeasure } from "./basis";

// ---------------------------------------------------------------------------------------------
// The goal record
// ---------------------------------------------------------------------------------------------

/**
 * The one support goal of a support subject: a target amount, the measure it is a target for, the
 * civil day it took effect on, and the revision an edit must present.
 *
 * The amount is an integer count of minor units beside its ISO currency code, never a major-unit
 * decimal and never a float, so a goal and the received support it is compared with are both exact
 * before either is compared. The exponent is looked up in `../money/currency` where a goal is
 * rendered, so a goal in KWD and a goal in JPY travel unchanged and a currency with no exponent is
 * never defaulted to two decimals.
 *
 * Absence means no goal, which is a different fact from a goal of zero — a target of nothing is not
 * a target, which is why `validateGoalAmount` refuses it. `measure` is fixed when the goal is
 * created: an amount edit changes the amount only, so saving a new figure cannot move an existing
 * goal onto another measure.
 *
 * `effectiveFrom` is a civil date, not an instant: a goal takes effect on a day, and a display-zone
 * change must not move it. `revision` is the base revision an edit presents as `expectedRevision`,
 * so a save made against a goal that has changed since is refused rather than overwriting it.
 *
 * The persisted projection in `../data-service/envelope` carries the same five facts in its own
 * storage form; this is the shape a report computes from and a surface renders.
 */
export interface GoalRecord {
  /** The target as an exact count of `currency`'s minor units. */
  readonly minorUnits: MinorUnits;
  /** ISO 4217 code whose exponent governs display; never defaulted from a locale or a name. */
  readonly currency: string;
  /** Which of the five measures this target is a target for. */
  readonly measure: SupportMeasure;
  /** The civil day the goal took effect on — no time of day and no instant behind it. */
  readonly effectiveFrom: CivilDate;
  /** The base revision an edit presents as `expectedRevision`. */
  readonly revision: number;
}

/**
 * The measure a support goal is a target for in this release: received support on the one named
 * basis.
 *
 * A goal is a target for money that arrives, so it is compared against received gifts and never
 * against a commitment, a monthly equivalent or the goal itself. The measure is named once here so a
 * surface, a report and a save cannot disagree about what the figure counts.
 */
export const GOAL_MEASURE: SupportMeasure = "received-gifts";

// ---------------------------------------------------------------------------------------------
// The permission gate
// ---------------------------------------------------------------------------------------------

/**
 * The capability that, and only that, permits editing the goal. Absent, no edit control exists at
 * all and every attempt is refused with the `denied` outcome; there is no second permission check
 * for a goal anywhere in the application.
 */
export const GOAL_CAPABILITY = "canEditGoal";

/**
 * Why a goal save was refused, and nothing about the goal it was refused for.
 *
 * - `capability-absent`: the caller does not hold {@link GOAL_CAPABILITY}.
 * - `scope-mismatch`: the caller is not admitted to the scope it believed it was acting in. The
 *   service's scope resolver answers this before it calls `applyGoalSave`, so the reason exists for
 *   that check rather than for a branch inside this module.
 * - `source-unavailable`: the source behind the goal projection could not be read. The service maps
 *   it to the `unavailable` outcome, which carries the source identity and retry guidance; this
 *   module states the refusal so a save is never accepted against a source that did not answer.
 */
export type GoalDenialReason = "capability-absent" | "scope-mismatch" | "source-unavailable";

/**
 * Whether the caller holds the capability that permits editing the goal — the single permission test
 * for a goal in this application.
 *
 * The answer decides whether an edit control exists at all: with the capability absent the surface
 * renders no control rather than a disabled one, because a disabled control would claim the action is
 * merely unavailable now, and the save such a control would make is refused by this same test inside
 * the service.
 */
export function canEditGoal(capabilities: readonly string[]): boolean {
  return capabilities.includes(GOAL_CAPABILITY);
}

// ---------------------------------------------------------------------------------------------
// The amount
// ---------------------------------------------------------------------------------------------

/** A stated goal amount: an exact count of minor units and the currency those units belong to. */
export interface GoalAmountInput {
  readonly minorUnits: MinorUnits;
  readonly currency: string;
}

/**
 * One reason a stated goal amount cannot be accepted, keyed by the field it belongs to so the
 * `invalid` outcome carries per-field messages and the form can mark the field that is wrong.
 */
export type GoalAmountProblem =
  | { readonly field: "minorUnits"; readonly message: string }
  | { readonly field: "currency"; readonly message: string };

/**
 * Validates a stated goal amount, returning one problem per refused field and an empty list when the
 * amount is acceptable.
 *
 * The amount must be a positive whole number of minor units: zero and every negative value are
 * refused because a target of nothing is not a target, and a fractional count is refused rather than
 * rounded because rounding would change the goal the worker set. Being a count of minor units, the
 * value is already at the currency's own precision — a KWD goal counts thousandths and a JPY goal
 * counts yen — so no exponent arithmetic happens here.
 *
 * The currency must have an exponent in `../money/currency`. A code with no exponent carries no
 * precision at all, so the amount could not be stated, displayed or compared exactly; it is refused
 * rather than defaulted to two decimals or to another code.
 *
 * The messages are the reader-facing text of the `invalid` outcome: they name what must change and
 * never echo a value beyond the form's own input.
 */
export function validateGoalAmount(input: GoalAmountInput): GoalAmountProblem[] {
  const problems: GoalAmountProblem[] = [];

  const amount: number = input.minorUnits;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    problems.push({
      field: "minorUnits",
      message:
        "Set the goal to a whole number of the currency's minor units greater than zero; a fractional count cannot be stated exactly, and zero or a negative number is not a target.",
    });
  }

  if (exponentOf(input.currency) === undefined) {
    problems.push({
      field: "currency",
      message:
        "This application holds no minor-unit precision for this currency, so a goal cannot be stated in it exactly; choose a currency with a known exponent rather than having one assumed.",
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------------------------
// The save decision
// ---------------------------------------------------------------------------------------------

/**
 * A save request as the editor states it: the amount the worker entered and the revision it was made
 * against. The request carries no measure and no effective date, because neither is what an edit
 * changes — see {@link applyGoalSave}.
 */
export interface GoalSaveInput {
  readonly amount: GoalAmountInput;
  readonly expectedRevision: number;
}

/**
 * The five answers a save can receive, each of which the service maps to one member of its own
 * outcome union.
 *
 * `accepted` and `unchanged` both carry the goal as it now stands; `conflict` returns the current
 * goal beside the caller's preserved input so a conflict panel can show both without the caller
 * re-reading anything; `denied` carries the reason and no fact about the goal at all; `invalid`
 * carries one message per refused field. There is no bare boolean here and no sixth answer: a caller
 * never infers success from the absence of a refusal.
 */
export type GoalSaveDecision =
  | { readonly status: "accepted"; readonly goal: GoalRecord }
  | { readonly status: "unchanged"; readonly goal: GoalRecord }
  | {
      readonly status: "conflict";
      /** The goal as it stands, which the caller did not see. */
      readonly current: GoalRecord;
      /** The request exactly as it arrived, kept for comparison against `current`. */
      readonly input: GoalSaveInput;
    }
  /**
   * The save was refused and says only why: no amount, no revision, no existence flag and no count,
   * so a caller without the capability learns nothing about a goal it may not see.
   */
  | { readonly status: "denied"; readonly reason: GoalDenialReason }
  | { readonly status: "invalid"; readonly problems: GoalAmountProblem[] };

/**
 * Decides a goal save and returns the goal it would produce, without writing anything.
 *
 * The five answers follow from the checks below, in this order: the capability is tested before
 * anything about the goal is echoed; an unavailable source refuses rather than accepting against data
 * it did not read; the stated amount is validated before it is compared with a stored one; and only
 * then is the base revision compared, because a stale expectation is only meaningful once the input
 * itself is well formed.
 *
 * A creation compares no revision. With no goal in scope there is no stored value a stale expectation
 * could overwrite, so the record starts at revision 1 and the expectation is consulted only where a
 * goal already exists.
 *
 * An edit sets the amount and the currency and nothing else: the measure and the effective date are
 * facts about the goal itself, so a new figure cannot move the goal onto another measure or backdate
 * the day it began. Saving the amount the goal already holds changes nothing and answers `unchanged`,
 * with no revision advanced and no history written.
 *
 * Editing a goal never rewrites an earlier report, never publishes public progress and never changes
 * a commitment: the returned `GoalRecord` is the only new value this function produces.
 *
 * Replay is not decided here. This function is pure and sees no `operationId`; the operation ledger
 * (`data-service/operations.ts`) answers a repeated attempt with `alreadyAccepted` and the stored
 * result. Adding a second idempotency mechanism here would be a second owner of the same fact.
 *
 * @param current the goal as the caller's read showed it, or `undefined` when there is none.
 * @param input the stated amount and the revision the edit was made against.
 * @param capabilities the caller's capabilities, tested through {@link canEditGoal}.
 * @param sourceAvailable whether the goal projection could be read at all.
 * @param effectiveFrom the scenario civil day a newly created goal takes effect on, supplied by the
 *   caller because this module reads no clock; an existing goal keeps the day it already has.
 */
export function applyGoalSave(
  current: GoalRecord | undefined,
  input: GoalSaveInput,
  capabilities: readonly string[],
  sourceAvailable: boolean,
  effectiveFrom: CivilDate,
): GoalSaveDecision {
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

  if (
    input.amount.minorUnits === current.minorUnits &&
    input.amount.currency === current.currency
  ) {
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

// ---------------------------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------------------------

/**
 * Every state a progress figure can be in, each one a different rendering and a different sentence.
 *
 * - `value`: a percentage was computed from an exact integer ratio, and may exceed 100%.
 * - `zero`: nothing recorded against a real goal yet — a genuine `0%`, not a missing figure.
 * - `no-goal`: the subject has set no goal, so there is nothing to be a percentage of.
 * - `no-percentage`: a goal exists but no percentage can be formed from it — a denominator that is
 *   absent, zero or negative, a numerator that is absent, or a ratio too large to state as an integer
 *   count of basis points.
 * - `incompatible`: the numerator and the goal are not the same measure, or not the same currency, so
 *   they cannot be compared at all.
 * - `paused` and `ended`: the goal is not being measured right now, and no percentage is invented for
 *   it.
 * - `unavailable`: the source could not be read, so nothing about the goal is claimed.
 */
export type GoalProgressState =
  | "value"
  | "no-goal"
  | "no-percentage"
  | "zero"
  | "incompatible"
  | "paused"
  | "ended"
  | "unavailable";

/**
 * A progress figure: its state, and the percentage in basis points — whole hundredths of a percent —
 * only when the state is `value` or `zero`. Every other state carries `null`, so a surface cannot
 * render a number where this module computed none.
 */
export interface GoalProgress {
  readonly state: GoalProgressState;
  readonly percentageBasisPoints: number | null;
}

/**
 * What a progress figure is computed from. Every member is stated by the caller and defaults to the
 * ordinary case, so a caller that knows something unusual says so explicitly rather than by omission:
 * `goal` absent means no goal, `sourceAvailable` absent means the source answered, `paused` and
 * `ended` absent mean neither applies.
 */
export interface GoalProgressInput {
  /** The goal in force, or absent when the subject has set none. */
  readonly goal?: GoalRecord;
  /** Received support in minor units for the period being measured. */
  readonly numeratorMinor?: MinorUnits;
  /**
   * The target the percentage is measured against, when it is not the goal record's own amount —
   * for instance a goal amount qualified for a stated period. Omitted, it is `goal.minorUnits`.
   */
  readonly denominatorMinor?: MinorUnits;
  /**
   * The report's answer to whether the numerator and the goal are the same measure in the same
   * currency. This module receives bare amounts, so a currency mismatch arrives as an incompatibility
   * rather than as a comparison it would have to refuse itself.
   */
  readonly measureCompatible?: boolean;
  readonly paused?: boolean;
  readonly ended?: boolean;
  /** `false` only when the projection could not be read at all. */
  readonly sourceAvailable?: boolean;
}

/** Basis points in one percent: a percentage is stated as whole hundredths of a percent. */
const BASIS_POINTS_PER_PERCENT = 100n;

/** Basis points per unit ratio: a ratio of `1` is `100%`, which is `10000` basis points. */
const BASIS_POINTS_PER_RATIO = 10_000n;

/** The one answer for every case where no percentage can be stated, so the state cannot drift. */
const NO_PERCENTAGE: GoalProgress = { state: "no-percentage", percentageBasisPoints: null };

/**
 * The percentage behind a progress figure — the only place in the application where a goal percentage
 * is computed.
 *
 * Integer arithmetic only, from exact minor-unit amounts to whole basis points, so `120%` is `12000`
 * and stays `12000`: a ratio above 1 is never clamped to `100%`, because a worker who exceeded a goal
 * is not at 100% of it. The ratio is truncated toward zero rather than rounded up, so a figure never
 * overstates progress, and no state yields `NaN`, `Infinity` or a borrowed zero.
 *
 * Held order of answers, so the states cannot be confused: an unreadable source is `unavailable`
 * before anything else, because nothing about the goal is known; no goal is `no-goal`; a finished goal
 * is `ended` before it is `paused`, because a goal that ended cannot be resumed by pausing it back on;
 * an incomparable numerator is `incompatible`; a denominator that cannot carry a percentage is
 * `no-percentage`; nothing recorded is a genuine `zero`; and only then is a `value` computed.
 *
 * @returns the state and, for `value` and `zero` only, the percentage in basis points.
 */
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

/**
 * Renders basis points as the percentage a surface shows: `12000` is `120%`, `12345` is `123.45%`.
 *
 * Built from integer digits only — the whole percent and at most two decimal places, with trailing
 * zeros dropped — because fixed-decimal and floating-point string formatting both round a value this
 * module has already computed exactly. A negative figure keeps its sign, a fraction is never stated
 * beyond the hundredths a basis point carries, and zero renders as `0%` rather than as an empty
 * string.
 *
 * A value that is not a whole number of basis points is refused with a `RangeError` rather than
 * formatted: it cannot have come from {@link goalProgress}, and formatting it would need a rounding
 * rule no caller has stated.
 */
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
