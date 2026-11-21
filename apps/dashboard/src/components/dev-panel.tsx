"use client";

/**
 * The one development control surface: the scenario this session runs in, the controllable clock, the
 * single armed failure plan, and the destructive reset.
 *
 * AAP 0.7.2 fixes the runtime this panel operates: a scenario that makes a source unavailable, a clock
 * that is "an offset stored per session, advanced only by the development control", one armed failure
 * for one named read or mutation (assumption A13), and a deterministic reset. AAP 0.6.3 puts all four
 * behind the namespaced development handler. This file is the whole of the interface to that runtime —
 * there is no second settings form, no seed editor, no fixture importer, no log viewer, no telemetry
 * switch and no "simulate a provider" control anywhere else in the application, and none of them
 * appears here (Rule 1 clause 1).
 *
 * What it owns, and why each part belongs here:
 *
 * - **The clock discipline.** Time moves in exactly two ways — setting an offset from the one fixed
 *   seed instant, and advancing by a stated amount — which are the service's own `setClock` and
 *   `advanceClock`. Both are explicit acts: there is no "run at" field, no timer, no interval and no
 *   scheduled callback in this file, because a background change would make the boundaries that make
 *   a demonstration meaningful unobservable. The panel therefore states, next to the derived instant,
 *   that the referral window, the coaching cutoff, notification usefulness, confirmation expiry and
 *   recurrence are each evaluated when a read or command runs against this instant rather than by a
 *   job that fires later.
 * - **One armed failure at a time, visibly.** The mode and the call are chosen from the closed
 *   registry the development read supplies, so a free-text target cannot be typed and a target that
 *   demonstrates a different mode cannot be picked. While a plan is armed the panel shows the mode,
 *   the target, the instant it was armed at, what the person will see and the recovery lesson it is
 *   meant to prove, and offers one disarm action beside them. Arming a second plan is not offered
 *   while one is armed, because the service refuses a second arming rather than replacing the first:
 *   the panel mirrors that refusal instead of promising a replacement it cannot produce.
 * - **A reset that is destructive by construction.** The store is discarded and re-seeded from the
 *   deterministic seed, so the reset goes through the shared review step (`components/action-review`)
 *   with its destructive treatment, states exactly what is lost and that a reset which cannot complete
 *   leaves the stored sessions as they were, and renders its result through the shared receipt.
 * - **One durable receipt for everything else.** A scenario switch, a clock change and an arming are
 *   reversible development acts, so they confirm inline and report through `components/operation-result`
 *   — the application's only receipt. The panel never infers success from an absent error: the outcome
 *   the mutation answered with is what it renders, and a request that throws before it reaches the
 *   service becomes `unavailable` or `unknown` through the service's own mapping.
 *
 * What it refuses to do. It reaches no store, no service and no HTTP endpoint: every action is the
 * transport the shell passes in, which is the namespaced development handler call. It formats no
 * amount, reads no clock of its own, mints no operation identity and holds no copy of the development
 * state — the scenario, the offset, the derived instant, the plan and the reset availability are all
 * read from the development read's answer, so two browser contexts can sit in different scenarios
 * without this file holding either. It is a **development control, not a production feature**: hiding
 * it protects nothing, because the development route is refused on the server, and the panel says so
 * in words rather than implying that the interface is the boundary.
 *
 * Personas and session states belong to `components/persona-switcher`, the permanent **Development
 * data** label to `components/dev-banner`, and the global settings to the Settings surface. None of
 * them grows into this file, and this file lists no persona of its own.
 *
 * Accessibility, direction and 320 CSS pixels. The panel is a labelled region with one heading, its
 * grouped controls are real `fieldset`s with a `legend` (so the mode group, the target group and each
 * clock control are announced as groups rather than as loose fields), a change of the armed plan is
 * announced through the receipt's heading once, and every control is at least 24x24 CSS px. The reset
 * dialog is the design system's alert dialog, which traps focus, returns it to its trigger and closes
 * on Escape. Every instant and identifier renders inside `<bdi>` with the `mono-identifier` utility so
 * a leading zero or a mixed-direction neighbour cannot reorder it, only logical utilities are used so
 * a right-to-left shell mirrors the panel, and the layout stacks its controls with wrapping rows so a
 * 320 CSS px viewport never scrolls sideways.
 *
 * Layering: a shared component below the features and above `components/ui`. It imports no feature and
 * no store (the lint configuration enforces both), and it holds the development state and the failure
 * plan only as the types the modules that own them declare — `DevState` from the development read, and
 * `FailureMode`/`MODE_LABEL`/`DemonstrableTarget` from the failure-plan module — so the words on the
 * panel and the words in a refusal cannot drift apart.
 */

import { useCallback, useId, useRef, useState, type ReactElement } from "react";

import ActionReview, {
  mayReplay,
  type ActionReviewProps,
  type MutationSubmit,
} from "@/components/action-review";
import OperationResult from "@/components/operation-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { DevState } from "@/modules/data-service/reads/dev";
import { isOutcome, outcomeFromError, type MutationOutcome } from "@/modules/data-service/outcome";
import {
  MODE_LABEL,
  type DemonstrableTarget,
  type FailureMode,
} from "@/modules/dev-runtime/failures";

// ---------------------------------------------------------------------------------------------
// The vocabulary the panel works in
// ---------------------------------------------------------------------------------------------

/**
 * The attempt marker a fault carries when the call never reached the service.
 *
 * A development mutation that throws before it answers has no `operationId`, because no attempt was
 * ever lodged, and inventing one would offer a recovery handle that could never find anything. The
 * read layer states the same fact the same way for a read refusal, with a marker instead of an
 * identifier, so this follows it: the receipt shows the state that is true — the source is
 * unavailable or the result is unconfirmed — without pretending an identity exists.
 */
const UNREACHED_ATTEMPT = "dev-panel";

/**
 * Whether a value names one of the three failure modes.
 *
 * Membership is read from the failure-plan module's own label table rather than from a second list
 * here, so a mode added or renamed in that module reaches this panel and a stale literal cannot.
 */
function isFailureMode(value: string): value is FailureMode {
  return Object.hasOwn(MODE_LABEL, value);
}

/**
 * The three modes, in the order the closed outcome set lists the outcomes they inject: a denial, a
 * conflict, then an unconfirmed result. Derived from the label table so the order and the set are one
 * declaration rather than two that could disagree.
 */
const FAILURE_MODES: readonly FailureMode[] = Object.keys(MODE_LABEL).filter(isFailureMode);

/**
 * The four elapsed-time units the clock controls offer.
 *
 * These are durations and not calendar units: "days" here is 24 hours of elapsed time, and no month
 * length, DST rule or civil-date convention applies. The distinction is the one the domain turns on —
 * the referral New window is a calendar-day window while the continuation is elapsed seconds — so the
 * panel says it in words beside the controls instead of letting a tester assume otherwise. Every
 * multiplier is an exact integer of milliseconds, so no floating-point arithmetic enters an offset.
 */
const CLOCK_UNITS = [
  { id: "seconds", singular: "second", plural: "seconds", milliseconds: 1_000 },
  { id: "minutes", singular: "minute", plural: "minutes", milliseconds: 60_000 },
  { id: "hours", singular: "hour", plural: "hours", milliseconds: 3_600_000 },
  { id: "days", singular: "day", plural: "days", milliseconds: 86_400_000 },
] as const;

/** One unit of elapsed time the clock controls accept. */
type ClockUnit = (typeof CLOCK_UNITS)[number];

/** The name of one unit of elapsed time. */
type ClockUnitId = ClockUnit["id"];

/** The units largest first, so an offset reads "3 days, 4 hours and 30 minutes" rather than the reverse. */
const DESCENDING_UNITS: readonly ClockUnit[] = [...CLOCK_UNITS].reverse();

/** The unit one choice names, or `undefined` when a value names none. */
function clockUnitFor(id: string): ClockUnit | undefined {
  return CLOCK_UNITS.find((unit) => unit.id === id);
}

/** Joins the parts of a duration as words: "3 days, 4 hours and 30 minutes". */
function joinWords(parts: readonly string[]): string {
  if (parts.length === 0) {
    return "no time at all";
  }
  if (parts.length === 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/**
 * States a clock offset as words, in the units a reader counts in.
 *
 * The offset is the whole of the clock's state, so the panel states it rather than only the instant it
 * derives: "3 days and 4 hours ahead of the seed instant" tells a tester what they asked for, and the
 * instant beside it tells them what the service made of it. The arithmetic is integer milliseconds
 * throughout, and the sign is part of the sentence because a negative offset places the instant before
 * the seed rather than beyond it.
 */
function describeOffset(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) {
    return "an unreadable offset";
  }
  if (milliseconds === 0) {
    return "no offset, so the clock sits at the seed instant";
  }
  const parts: string[] = [];
  let remaining = Math.abs(milliseconds);
  for (const unit of DESCENDING_UNITS) {
    const count = Math.floor(remaining / unit.milliseconds);
    if (count === 0) {
      continue;
    }
    remaining -= count * unit.milliseconds;
    parts.push(`${String(count)} ${count === 1 ? unit.singular : unit.plural}`);
  }
  const direction = milliseconds > 0 ? "ahead of" : "before";
  return `${joinWords(parts)} ${direction} the seed instant`;
}

/**
 * The locale the panel formats an instant in.
 *
 * Fixed rather than taken from the host: the panel is rendered on the server and again in the browser,
 * and a locale read from each environment would produce two different sentences for one instant — a
 * hydration mismatch over a value that is not the point of the surface. The instant itself is always
 * shown as the stored ISO form beside the words, so nothing depends on the wording.
 */
const INSTANT_LOCALE = "en-GB";

/** The zone a stored instant states: UTC for a `Z` form, else the offset it carries. */
function zoneOf(iso: string): string {
  if (iso.endsWith("Z") || iso.endsWith("z")) {
    return "UTC";
  }
  return /([+-]\d{2}:\d{2})$/.exec(iso)?.[1] ?? "UTC";
}

/**
 * States a stored instant in words, or `null` when it cannot be read.
 *
 * The value comes from the service and is displayed verbatim beside these words, so this only has to
 * be readable, never authoritative: an unparseable instant renders as its ISO form alone instead of
 * failing the panel or inventing a date. No clock is read here — the millisecond value is the instant
 * the service already reported.
 */
function describeInstantWords(iso: string): string | null {
  const milliseconds = Date.parse(iso);
  if (!Number.isFinite(milliseconds)) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat(INSTANT_LOCALE, {
      dateStyle: "long",
      timeStyle: "long",
      timeZone: zoneOf(iso),
    }).format(milliseconds);
  } catch {
    // A zone the runtime will not format states nothing rather than falling back to a guessed one.
    return null;
  }
}

/** A whole number typed into a clock control, or `null` when the text is not one. */
function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

/**
 * One failure to arm: a mode and the single named call it is injected into.
 *
 * Both halves are required and both are closed. The mode is one of the three the failure-plan module
 * declares, and the target is one of the registry rows the development read reported — carrying the
 * row rather than its name keeps the kind, the mode it demonstrates and its wording together, so the
 * shell cannot pair a mode with a call that does not demonstrate it.
 */
export interface DevFailureArming {
  readonly mode: FailureMode;
  readonly target: DemonstrableTarget;
}

/**
 * The reset the panel confirms, in the shape the shared review step submits.
 *
 * The identity of the attempt is minted by `ActionReview`, never here; what this carries is what only
 * the shell can know — the scope the development read ran under, the revision it reported as
 * `expectedRevision`, and the one call to the namespaced development handler. Building those inside
 * the panel would mean inventing an authority and a revision, which is exactly what the mutation
 * contract exists to prevent.
 */
export interface DevResetTransport {
  /** The scope, expected revision and payload of the reset, without its attempt identity. */
  readonly input: ActionReviewProps<unknown>["input"];
  /** The one call that dispatches it, answered with one of the closed outcomes. */
  readonly submit: MutationSubmit<unknown>;
}

/** Props of {@link DevPanel}. */
export interface DevPanelProps {
  /**
   * This session's development state, exactly as `readDevState` reported it.
   *
   * The panel renders it and holds no copy: the scenario, the clock offset, the derived instant, the
   * armed plan, the target registry and the reset availability are all read from this value, so a
   * refused or stale change leaves the panel showing what the session really carries rather than what
   * was clicked.
   */
  readonly devState: DevState;

  /** Switches the seeded scenario this session runs in. */
  readonly onSetScenario: (scenarioId: DevState["scenario"]["id"]) => Promise<MutationOutcome>;

  /** Sets the clock's offset from the seed instant, in milliseconds. */
  readonly onSetClock: (offsetMilliseconds: number) => Promise<MutationOutcome>;

  /** Moves the clock forward by an amount of elapsed milliseconds. */
  readonly onAdvanceClock: (advanceMilliseconds: number) => Promise<MutationOutcome>;

  /**
   * Arms one failure, or disarms the armed one when given `null`.
   *
   * One call for both directions, because arming and disarming are the two states of one plan and a
   * second entry point could leave the session with a plan neither control could clear.
   */
  readonly onSetFailurePlan: (arming: DevFailureArming | null) => Promise<MutationOutcome>;

  /** The reviewed reset: the input only the shell can build, and the call that dispatches it. */
  readonly reset: DevResetTransport;

  /** Layout classes for the panel. Never a colour, radius or shadow. */
  readonly className?: string;
}


// ---------------------------------------------------------------------------------------------
// The panel's own bookkeeping
// ---------------------------------------------------------------------------------------------

/** The five acts this panel dispatches, so one in-flight fence and one receipt serve all of them. */
const DEV_PANEL_ACTIONS = [
  "switch-scenario",
  "set-clock",
  "advance-clock",
  "arm-failure",
  "disarm-failure",
] as const;

/** One act the panel dispatches. */
type DevPanelAction = (typeof DEV_PANEL_ACTIONS)[number];

/** One settled result, with the words a settled outcome can state about the state it produced. */
interface DevPanelResult {
  readonly action: DevPanelAction;
  /**
   * What is true now that the act applied, or `null` when the act states nothing beyond its outcome.
   *
   * It is rendered as the receipt's heading, which is what makes a change of the armed plan audible:
   * the receipt is already the one announcement of an outcome, so the armed state travels in the same
   * sentence ("Failure armed: Changed revision on saveGoal") instead of in a second live region that
   * would speak the same act twice.
   */
  readonly settledHeading: string | null;
  readonly outcome: MutationOutcome;
}

/** One dispatched attempt, kept so a retry repeats the same work rather than starting new work. */
interface DevPanelAttempt {
  readonly action: DevPanelAction;
  readonly settledHeading: string | null;
  readonly run: () => Promise<MutationOutcome>;
}

/**
 * What the clock block states about how time is observed.
 *
 * It is the one sentence that keeps the panel honest about not being a scheduler: every window the
 * release turns on is a function of `(input, now)` evaluated when a read or a command runs, so moving
 * the instant changes what the next request decides and nothing else. A person advancing the clock to
 * prove a boundary needs to know that no job is waiting to fire behind them.
 */
const CLOCK_BOUNDARY_SENTENCE =
  "Every boundary is evaluated when a read or a command runs against this instant: the referral " +
  "window, the coaching cutoff, notification usefulness, confirmation expiry and recurrence all " +
  "decide from it at the moment they are asked.";

/** What the clock block states about the absence of anything scheduled. */
const CLOCK_IMMEDIATE_SENTENCE =
  "Nothing here is scheduled. There is no run-at time, no timer and no background job, so advancing " +
  "is an immediate act and the only two controls that move time are the two below.";

/** The offer the failure block states while a plan is armed. */
const ARMED_DISARM_SENTENCE =
  "Disarm this plan before arming another: exactly one failure is active at a time, and the " +
  "development route refuses a second arming rather than replacing this one.";

/** The sentence the failure block states while nothing is armed. */
const DISARMED_SENTENCE =
  "No failure is armed, so every read and every mutation answers from the application's own behaviour.";

/**
 * What the panel says while one act is in flight.
 *
 * The controls disable themselves during an act, and a disabled control announces nothing, so the
 * waiting state needs words of its own: without them a screen-reader user would hear the buttons stop
 * responding with no statement of why. It is a polite status region, and it disappears when the answer
 * arrives because the receipt then states what happened.
 */
const PENDING_SENTENCE = "Applying that change to this development session and waiting for the answer.";

/** What a reset discards, stated before the destructive control is reached. */
const RESET_DESCRIPTION =
  "The synthetic store is deleted and every seeded session is written again from the deterministic " +
  "seed, so the same readable records come back and a journey can be repeated from the same starting " +
  "point. Partners, notes, interactions, tasks, drafts, releases, audience memberships, coaching " +
  "grants and media records you created are discarded, the clock returns to the seed instant, and an " +
  "armed failure plan is cleared with the document that held it. A reset that cannot complete leaves " +
  "the stored sessions as they were.";

/** What the reset dialog adds before the person confirms it. */
const RESET_CONSEQUENCE =
  "This discards the current synthetic store and cannot be undone from the interface. Nothing is " +
  "sent, published or charged: the reset replaces this application's own data only.";

/**
 * Whether an outcome reports a completed result.
 *
 * These three say the change needs no further press, so the panel can state what the change produced;
 * the other five are corrected or recovered by changing the request, and a heading that named a
 * resulting state would then describe something that is not true.
 */
function isSettled(outcome: MutationOutcome): boolean {
  return (
    outcome.outcome === "accepted" ||
    outcome.outcome === "alreadyAccepted" ||
    outcome.outcome === "unchanged"
  );
}

/**
 * The one development control surface. Render it in the shell's development region beside
 * `components/dev-banner` and `components/persona-switcher`, which supply the permanent Development
 * data label and the persona switch this panel deliberately does not duplicate.
 */
export function DevPanel({
  devState,
  onSetScenario,
  onSetClock,
  onAdvanceClock,
  onSetFailurePlan,
  reset,
  className,
}: DevPanelProps): ReactElement {
  const idPrefix = useId();
  const titleId = `${idPrefix}-title`;
  const introId = `${idPrefix}-intro`;
  const scenarioSelectId = `${idPrefix}-scenario-select`;
  const scenarioHintId = `${idPrefix}-scenario-hint`;
  const offsetId = `${idPrefix}-offset`;
  const offsetUnitId = `${idPrefix}-offset-unit`;
  const offsetHintId = `${idPrefix}-offset-hint`;
  const offsetErrorId = `${idPrefix}-offset-error`;
  const advanceId = `${idPrefix}-advance`;
  const advanceUnitId = `${idPrefix}-advance-unit`;
  const advanceHintId = `${idPrefix}-advance-hint`;
  const advanceErrorId = `${idPrefix}-advance-error`;
  const targetHintId = `${idPrefix}-target-hint`;

  /* The last result and the act in flight. One of each for the whole panel: five controls that each
   * kept their own receipt would scatter the same eight-outcome vocabulary across the surface. */
  const [result, setResult] = useState<DevPanelResult | null>(null);
  const [pending, setPending] = useState<DevPanelAction | null>(null);
  const pendingRef = useRef<DevPanelAction | null>(null);
  const lastAttempt = useRef<DevPanelAttempt | null>(null);

  /* `null` follows the state the service reports, so a settled switch needs no effect to re-sync and a
   * refused one leaves the person's choice on screen to correct. */
  const [scenarioChoice, setScenarioChoice] = useState<string | null>(null);
  const [offsetValue, setOffsetValue] = useState("0");
  const [offsetUnit, setOffsetUnit] = useState<ClockUnitId>("hours");
  const [offsetError, setOffsetError] = useState<string | null>(null);
  const [advanceValue, setAdvanceValue] = useState("24");
  const [advanceUnit, setAdvanceUnit] = useState<ClockUnitId>("hours");
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [mode, setMode] = useState<FailureMode>(() => FAILURE_MODES[0] ?? "denied");
  const [targetName, setTargetName] = useState<string | null>(null);

  const { scenario, clock, failurePlan: plan } = devState;
  const busy = pending !== null;

  const chosenScenarioId = scenarioChoice ?? scenario.id;
  const chosenScenario = devState.scenarios.find((choice) => choice.id === chosenScenarioId);
  const scenarioChangePending = chosenScenarioId !== scenario.id;

  const eligibleTargets = devState.failureTargets.filter((target) =>
    target.modes.includes(mode),
  );
  const chosenTarget =
    eligibleTargets.find((target) => target.name === targetName) ?? eligibleTargets[0];

  const derivedWords = describeInstantWords(clock.derivedInstant);
  const seedWords = describeInstantWords(clock.seedInstant);
  const armedWords = plan.armedAt === null ? null : describeInstantWords(plan.armedAt);

  /**
   * Runs one act, one at a time, and reports it once.
   *
   * The fence is a ref rather than the `pending` state: two activations in the same tick would
   * otherwise both read the pre-update value and dispatch twice, which for a clock change means two
   * moves and for an arming means a refusal nobody asked for. A thrown fault never escapes as a crash
   * and never becomes success: the service's own mapping turns it into `unavailable` or `unknown`,
   * which are the only two honest answers when the effect's fate is not known.
   */
  const runAction = useCallback(
    async (
      action: DevPanelAction,
      settledHeading: string | null,
      run: () => Promise<MutationOutcome>,
    ): Promise<void> => {
      if (pendingRef.current !== null) {
        return;
      }
      pendingRef.current = action;
      setPending(action);
      lastAttempt.current = { action, settledHeading, run };

      let outcome: MutationOutcome;
      try {
        const answered: unknown = await run();
        outcome = isOutcome(answered) ? answered : outcomeFromError(UNREACHED_ATTEMPT, answered);
      } catch (error) {
        outcome = outcomeFromError(UNREACHED_ATTEMPT, error);
      }

      pendingRef.current = null;
      setPending(null);
      setResult({ action, settledHeading, outcome });
    },
    [],
  );

  /**
   * Re-runs the last act after an outage or an unconfirmed acknowledgement.
   *
   * A scenario switch, a clock change and an arming each state a value the session should hold, so
   * repeating one is the same statement rather than a second effect — which is why the receipt may
   * offer it where a publish or a send may not.
   */
  const retryLastAttempt = useCallback((): void => {
    const attempt = lastAttempt.current;
    if (attempt === null) {
      return;
    }
    void runAction(attempt.action, attempt.settledHeading, attempt.run);
  }, [runAction]);

  const switchScenario = (): void => {
    if (chosenScenario === undefined || !scenarioChangePending) {
      return;
    }
    const target = chosenScenario;
    void runAction("switch-scenario", `Scenario: ${target.label}`, () => onSetScenario(target.id));
  };

  const applyClockOffset = (): void => {
    const unit = clockUnitFor(offsetUnit);
    if (unit === undefined) {
      setOffsetError("Choose the unit the offset is stated in.");
      return;
    }
    const amount = wholeNumber(offsetValue);
    if (amount === null) {
      setOffsetError(`Enter a whole number of ${unit.plural}, with no decimal point or separator.`);
      return;
    }
    const offset = amount * unit.milliseconds;
    if (!Number.isSafeInteger(offset)) {
      setOffsetError(`That many ${unit.plural} is further than the clock can carry.`);
      return;
    }
    setOffsetError(null);
    void runAction("set-clock", `Clock: ${describeOffset(offset)}`, () => onSetClock(offset));
  };

  const advanceClock = (): void => {
    const unit = clockUnitFor(advanceUnit);
    if (unit === undefined) {
      setAdvanceError("Choose the unit the amount is stated in.");
      return;
    }
    const amount = wholeNumber(advanceValue);
    if (amount === null) {
      setAdvanceError(`Enter a whole number of ${unit.plural}, with no decimal point or separator.`);
      return;
    }
    if (amount <= 0) {
      setAdvanceError(`Advancing moves the clock forward, so enter at least one ${unit.singular}.`);
      return;
    }
    const advance = amount * unit.milliseconds;
    if (!Number.isSafeInteger(advance)) {
      setAdvanceError(`That many ${unit.plural} is further than the clock can carry.`);
      return;
    }
    setAdvanceError(null);
    const stated = `${String(amount)} ${amount === 1 ? unit.singular : unit.plural}`;
    void runAction("advance-clock", `Clock advanced by ${stated}`, () => onAdvanceClock(advance));
  };

  const armFailure = (): void => {
    if (chosenTarget === undefined || plan.armed) {
      return;
    }
    const target = chosenTarget;
    void runAction(
      "arm-failure",
      `Failure armed: ${MODE_LABEL[mode]} on ${target.name}`,
      () => onSetFailurePlan({ mode, target }),
    );
  };

  const disarmFailure = (): void => {
    if (!plan.armed) {
      return;
    }
    void runAction("disarm-failure", "No failure is armed", () => onSetFailurePlan(null));
  };

  const receiptHeading = result !== null && isSettled(result.outcome) ? result.settledHeading : null;
  const receiptRetry = result !== null && mayReplay(result.outcome) ? retryLastAttempt : undefined;

  return (
    <section
      data-slot="dev-panel"
      aria-labelledby={titleId}
      aria-describedby={introId}
      aria-busy={busy ? true : undefined}
      className={cn("flex min-w-0 flex-col gap-6", className)}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={titleId} className="text-lg font-semibold text-pretty">
          Development runtime
        </h2>
        <p id={introId} className="text-sm text-pretty text-muted-foreground">
          The scenario, the clock, one armed failure and the reset for this development session. These
          are development controls: the namespaced development route refuses them on the server outside
          a development session, so hiding this panel is not what protects them. The Development data
          label stays visible beside it, and nothing here is a production feature.
        </p>
      </div>

      {plan.armed && plan.mode !== null && plan.target !== null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <Badge variant="outline">Armed</Badge>
          <p className="min-w-0 flex-1 text-sm text-pretty">
            {plan.modeLabel} is armed on{" "}
            <bdi className="mono-identifier wrap-anywhere">{plan.target.name}</bdi>, so any request to
            that {plan.target.kind} answers with the injected outcome. Disarm it before you judge any
            other behaviour.
          </p>
        </div>
      ) : null}

      {busy ? (
        <output className="block text-sm text-pretty text-muted-foreground">
          {PENDING_SENTENCE}
        </output>
      ) : null}

      {result === null ? null : (
        <div data-slot="dev-panel-result" data-action={result.action} className="min-w-0">
          <OperationResult
            outcome={result.outcome}
            heading={receiptHeading ?? undefined}
            headingLevel={3}
            onRetrySameWork={receiptRetry}
          />
        </div>
      )}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3>Scenario</h3>
          </CardTitle>
          <CardDescription>
            The seeded world this session runs in. A scenario decides which source is unavailable, so a
            demonstration proves something; switching it loads a different world and changes no record
            on its own.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1 text-sm text-pretty">
            <p>
              Running now: <span className="font-medium">{scenario.label}</span>{" "}
              <bdi className="mono-identifier wrap-anywhere text-muted-foreground">
                {scenario.id}
              </bdi>
            </p>
            <p className="text-muted-foreground">{scenario.description}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={scenarioSelectId}>Switch to</Label>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <NativeSelect
                id={scenarioSelectId}
                className="w-full sm:w-72"
                value={chosenScenarioId}
                aria-describedby={scenarioHintId}
                disabled={busy}
                onChange={(event) => {
                  setScenarioChoice(event.currentTarget.value);
                }}
              >
                {devState.scenarios.map((choice) => (
                  <NativeSelectOption key={choice.id} value={choice.id}>
                    {choice.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !scenarioChangePending}
                onClick={switchScenario}
              >
                Switch scenario
              </Button>
            </div>
            <p id={scenarioHintId} className="text-sm text-pretty text-muted-foreground">
              {chosenScenario !== undefined && scenarioChangePending
                ? `This session runs ${scenario.label} now. Switching loads ${chosenScenario.label}: ${chosenScenario.description}`
                : "Choosing a scenario changes nothing until you switch to it."}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3>Clock</h3>
          </CardTitle>
          <CardDescription>
            The scenario instant every boundary is measured against. It is an offset from one fixed seed
            instant rather than a second clock, and the only ways to move it are on this panel.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <dl className="flex min-w-0 flex-col gap-3 text-sm">
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted-foreground">Scenario instant</dt>
              <dd className="min-w-0 text-pretty">
                {derivedWords === null ? null : `${derivedWords}. `}
                <bdi className="mono-identifier wrap-anywhere">{clock.derivedInstant}</bdi>
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted-foreground">Seed instant</dt>
              <dd className="min-w-0 text-pretty">
                {seedWords === null ? null : `${seedWords}. `}
                <bdi className="mono-identifier wrap-anywhere">{clock.seedInstant}</bdi>
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted-foreground">Offset from the seed instant</dt>
              <dd className="min-w-0 text-pretty">
                {describeOffset(clock.offsetMilliseconds)}{" "}
                <bdi className="mono-identifier tabular-figures text-muted-foreground">
                  ({String(clock.offsetMilliseconds)} ms)
                </bdi>
              </dd>
            </div>
          </dl>

          <p className="text-sm text-pretty text-muted-foreground">{CLOCK_BOUNDARY_SENTENCE}</p>
          <p className="text-sm text-pretty text-muted-foreground">{CLOCK_IMMEDIATE_SENTENCE}</p>

          <Separator />

          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="text-sm font-medium">Set the offset from the seed instant</legend>
            <div className="flex min-w-0 flex-wrap items-end gap-2">
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor={offsetId}>Offset</Label>
                <Input
                  id={offsetId}
                  type="number"
                  inputMode="numeric"
                  step={1}
                  value={offsetValue}
                  disabled={busy}
                  aria-invalid={offsetError === null ? undefined : true}
                  aria-describedby={
                    offsetError === null ? offsetHintId : `${offsetHintId} ${offsetErrorId}`
                  }
                  className="w-24 sm:w-28"
                  onChange={(event) => {
                    setOffsetValue(event.currentTarget.value);
                  }}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor={offsetUnitId}>Unit</Label>
                <NativeSelect
                  id={offsetUnitId}
                  className="w-full sm:w-auto"
                  value={offsetUnit}
                  disabled={busy}
                  onChange={(event) => {
                    const next = clockUnitFor(event.currentTarget.value);
                    if (next !== undefined) {
                      setOffsetUnit(next.id);
                    }
                  }}
                >
                  {CLOCK_UNITS.map((unit) => (
                    <NativeSelectOption key={unit.id} value={unit.id}>
                      {unit.plural}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <Button type="button" variant="secondary" disabled={busy} onClick={applyClockOffset}>
                Set the clock offset
              </Button>
            </div>
            <p id={offsetHintId} className="text-sm text-pretty text-muted-foreground">
              Units are elapsed time: a day here is 24 hours, and no unit on this panel is a calendar
              day. A negative offset places the instant before the seed.
            </p>
            {offsetError === null ? null : (
              <p id={offsetErrorId} className="text-sm text-pretty text-destructive">
                {offsetError}
              </p>
            )}
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="text-sm font-medium">Advance the clock</legend>
            <div className="flex min-w-0 flex-wrap items-end gap-2">
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor={advanceId}>Advance by</Label>
                <Input
                  id={advanceId}
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={1}
                  value={advanceValue}
                  disabled={busy}
                  aria-invalid={advanceError === null ? undefined : true}
                  aria-describedby={
                    advanceError === null ? advanceHintId : `${advanceHintId} ${advanceErrorId}`
                  }
                  className="w-24 sm:w-28"
                  onChange={(event) => {
                    setAdvanceValue(event.currentTarget.value);
                  }}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor={advanceUnitId}>Unit</Label>
                <NativeSelect
                  id={advanceUnitId}
                  className="w-full sm:w-auto"
                  value={advanceUnit}
                  disabled={busy}
                  onChange={(event) => {
                    const next = clockUnitFor(event.currentTarget.value);
                    if (next !== undefined) {
                      setAdvanceUnit(next.id);
                    }
                  }}
                >
                  {CLOCK_UNITS.map((unit) => (
                    <NativeSelectOption key={unit.id} value={unit.id}>
                      {unit.plural}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <Button type="button" variant="secondary" disabled={busy} onClick={advanceClock}>
                Advance the clock
              </Button>
            </div>
            <p id={advanceHintId} className="text-sm text-pretty text-muted-foreground">
              Advancing moves the instant forward by elapsed time only. 24 hours reaches the
              notification deadline exactly; 168 hours reaches the confirmation deadline exactly, which
              is where both are refused.
            </p>
            {advanceError === null ? null : (
              <p id={advanceErrorId} className="text-sm text-pretty text-destructive">
                {advanceError}
              </p>
            )}
          </fieldset>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3>Failure plan</h3>
          </CardTitle>
          <CardDescription>
            One simulated failure, injected into one named read or mutation. Exactly one plan is active at
            a time, so a demonstration cannot confuse which failure it is watching.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {plan.armed && plan.target !== null && plan.mode !== null ? (
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
              <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                <Badge variant="outline">Armed</Badge>
                <span className="text-sm font-medium">{plan.modeLabel}</span>
                <bdi className="mono-identifier wrap-anywhere text-sm">{plan.target.name}</bdi>
                <span className="text-sm text-muted-foreground">({plan.target.kind})</span>
              </div>
              {plan.armedAt === null ? null : (
                <p className="text-sm text-pretty">
                  Armed at {armedWords === null ? null : `${armedWords}. `}
                  <bdi className="mono-identifier wrap-anywhere">{plan.armedAt}</bdi>
                </p>
              )}
              <p className="text-sm text-pretty">{plan.effect}</p>
              <p className="text-sm text-pretty text-muted-foreground">{plan.recoveryLesson}</p>
              <div className="flex min-w-0 flex-col gap-2">
                <div>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={disarmFailure}
                  >
                    Disarm this failure
                  </Button>
                </div>
                <p className="text-sm text-pretty text-muted-foreground">{ARMED_DISARM_SENTENCE}</p>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-pretty text-muted-foreground">{DISARMED_SENTENCE}</p>
              <fieldset className="flex min-w-0 flex-col gap-4">
                <legend className="text-sm font-medium">Failure to arm</legend>
                <fieldset className="flex min-w-0 flex-col gap-2">
                  <legend className="text-sm text-muted-foreground">Outcome to inject</legend>
                  <RadioGroup
                    value={mode}
                    onValueChange={(next: unknown) => {
                      if (typeof next === "string" && isFailureMode(next)) {
                        setMode(next);
                        setTargetName(null);
                      }
                    }}
                  >
                    {FAILURE_MODES.map((entry) => {
                      const itemId = `${idPrefix}-mode-${entry}`;
                      return (
                        <label
                          key={entry}
                          htmlFor={itemId}
                          className="flex min-h-6 items-center gap-3 py-1"
                        >
                          <RadioGroupItem
                            id={itemId}
                            value={entry}
                            aria-label={MODE_LABEL[entry]}
                          />
                          <span className="text-sm font-medium">{MODE_LABEL[entry]}</span>
                        </label>
                      );
                    })}
                  </RadioGroup>
                </fieldset>
                <fieldset className="flex min-w-0 flex-col gap-2">
                  <legend className="text-sm text-muted-foreground">Call to inject it into</legend>
                  {eligibleTargets.length === 0 ? (
                    <p className="text-sm text-pretty text-muted-foreground">
                      No call in this release demonstrates {MODE_LABEL[mode]}.
                    </p>
                  ) : (
                    <>
                      <RadioGroup
                        value={chosenTarget?.name ?? ""}
                        aria-describedby={chosenTarget === undefined ? undefined : targetHintId}
                        onValueChange={(next: unknown) => {
                          if (typeof next === "string") {
                            setTargetName(next);
                          }
                        }}
                      >
                        {eligibleTargets.map((target) => {
                          const itemId = `${idPrefix}-target-${target.name}`;
                          return (
                            <label
                              key={target.name}
                              htmlFor={itemId}
                              className="flex min-h-6 items-start gap-3 py-1"
                            >
                              <RadioGroupItem
                                id={itemId}
                                value={target.name}
                                aria-label={target.name}
                                className="mt-0.5"
                              />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <bdi className="mono-identifier wrap-anywhere text-sm font-medium">
                                  {target.name}
                                </bdi>
                                <span className="text-sm text-muted-foreground">{target.kind}</span>
                              </span>
                            </label>
                          );
                        })}
                      </RadioGroup>
                      {chosenTarget === undefined ? null : (
                        <p id={targetHintId} className="text-sm text-pretty text-muted-foreground">
                          {chosenTarget.note}
                        </p>
                      )}
                    </>
                  )}
                </fieldset>
                <div>
                  <Button
                    type="button"
                    disabled={busy || chosenTarget === undefined}
                    onClick={armFailure}
                  >
                    Arm this failure
                  </Button>
                </div>
              </fieldset>
            </>
          )}
        </CardContent>
      </Card>

      {devState.reset.available ? (
        <ActionReview
          title="Reset the development data"
          headingLevel={3}
          consequential
          confirmLabel="Reset and re-seed"
          input={reset.input}
          submit={reset.submit}
          description={<p>{RESET_DESCRIPTION}</p>}
          consequence={<p>{RESET_CONSEQUENCE}</p>}
        />
      ) : (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              <h3>Reset</h3>
            </CardTitle>
            <CardDescription>
              A deterministic reset is not available in this session, so no control is offered that
              could not be honoured.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-pretty text-muted-foreground">{devState.reset.statement}</p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

export default DevPanel;

