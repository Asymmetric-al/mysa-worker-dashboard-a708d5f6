"use client";
/**
 * The one development control surface: the scenario this session runs in, the controllable clock, the
 * single armed failure plan, and the destructive reset.
 */
import { useCallback, useId, useRef, useState, type ReactElement } from "react";
import ActionReview, { mayReplay, type ActionReviewProps, type MutationSubmit } from "@/components/action-review";
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
import { MODE_LABEL, type DemonstrableTarget, type FailureMode } from "@/modules/dev-runtime/failures";
// The vocabulary the panel works in
const UNREACHED_ATTEMPT = "dev-panel";

function isFailureMode(value: string): value is FailureMode {
  return Object.hasOwn(MODE_LABEL, value);
}
const FAILURE_MODES: readonly FailureMode[] = Object.keys(MODE_LABEL).filter(isFailureMode);

const CLOCK_UNITS = [
  { id: "seconds", singular: "second", plural: "seconds", milliseconds: 1_000 },
  { id: "minutes", singular: "minute", plural: "minutes", milliseconds: 60_000 },
  { id: "hours", singular: "hour", plural: "hours", milliseconds: 3_600_000 },
  { id: "days", singular: "day", plural: "days", milliseconds: 86_400_000 },
] as const;
type ClockUnit = (typeof CLOCK_UNITS)[number];

type ClockUnitId = ClockUnit["id"];

const DESCENDING_UNITS: readonly ClockUnit[] = [...CLOCK_UNITS].reverse();

function clockUnitFor(id: string): ClockUnit | undefined {
  return CLOCK_UNITS.find((unit) => unit.id === id);
}
function joinWords(parts: readonly string[]): string {
  if (parts.length === 0) {
    return "no time at all";
  }
  if (parts.length === 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}
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
const INSTANT_LOCALE = "en-GB";

function zoneOf(iso: string): string {
  if (iso.endsWith("Z") || iso.endsWith("z")) {
    return "UTC";
  }
  return /([+-]\d{2}:\d{2})$/.exec(iso)?.[1] ?? "UTC";
}
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
function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
// Props
/** One failure to arm: a mode and the single named call it is injected into. */
export interface DevFailureArming {
  readonly mode: FailureMode;
  readonly target: DemonstrableTarget;
}
/** The reset the panel confirms, in the shape the shared review step submits. */
export interface DevResetTransport {
  readonly input: ActionReviewProps<unknown>["input"];
  readonly submit: MutationSubmit<unknown>;
}
/** Props of {@link DevPanel}. */
export interface DevPanelProps {
  readonly devState: DevState;
  readonly onSetScenario: (scenarioId: DevState["scenario"]["id"]) => Promise<MutationOutcome>;
  readonly onSetClock: (offsetMilliseconds: number) => Promise<MutationOutcome>;
  readonly onAdvanceClock: (advanceMilliseconds: number) => Promise<MutationOutcome>;
  readonly onSetFailurePlan: (arming: DevFailureArming | null) => Promise<MutationOutcome>;
  readonly reset: DevResetTransport;
  readonly className?: string;
}
// The panel's own bookkeeping
const DEV_PANEL_ACTIONS = ["switch-scenario", "set-clock", "advance-clock", "arm-failure", "disarm-failure"] as const;

type DevPanelAction = (typeof DEV_PANEL_ACTIONS)[number];

interface DevPanelResult {
  readonly action: DevPanelAction;
  readonly settledHeading: string | null;
  readonly outcome: MutationOutcome;
}
interface DevPanelAttempt {
  readonly action: DevPanelAction;
  readonly settledHeading: string | null;
  readonly run: () => Promise<MutationOutcome>;
}
const CLOCK_BOUNDARY_SENTENCE =
  "Every boundary is evaluated when a read or a command runs against this instant: the referral " +
  "window, the coaching cutoff, notification usefulness, confirmation expiry and recurrence all " +
  "decide from it at the moment they are asked.";
const CLOCK_IMMEDIATE_SENTENCE =
  "Nothing here is scheduled. There is no run-at time, no timer and no background job, so advancing " + "is an immediate act and the only two controls that move time are the two below.";
const ARMED_DISARM_SENTENCE = "Disarm this plan before arming another: exactly one failure is active at a time, and the " + "development route refuses a second arming rather than replacing this one.";

const DISARMED_SENTENCE = "No failure is armed, so every read and every mutation answers from the application's own behaviour.";

const PENDING_SENTENCE = "Applying that change to this development session and waiting for the answer.";

const RESET_DESCRIPTION =
  "The synthetic store is deleted and every seeded session is written again from the deterministic " +
  "seed, so the same readable records come back and a journey can be repeated from the same starting " +
  "point. Partners, notes, interactions, tasks, drafts, releases, audience memberships, coaching " +
  "grants and media records you created are discarded, the clock returns to the seed instant, and an " +
  "armed failure plan is cleared with the document that held it. Every stored session is " +
  "discarded before the seeded ones are written, so a reset that fails part way can leave " +
  "sessions discarded or only partly written. Running it again restores the seeded world.";
const RESET_CONSEQUENCE =
  "This discards the current synthetic store and cannot be undone from the interface. Nothing is " + "sent, published or charged: the reset replaces this application's own data only.";
function isSettled(outcome: MutationOutcome): boolean {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
}
/** The one development control surface. */
export function DevPanel({ devState, onSetScenario, onSetClock, onAdvanceClock, onSetFailurePlan, reset, className }: DevPanelProps): ReactElement {
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
  const [result, setResult] = useState<DevPanelResult | null>(null);
  const [pending, setPending] = useState<DevPanelAction | null>(null);
  const pendingRef = useRef<DevPanelAction | null>(null);
  const lastAttempt = useRef<DevPanelAttempt | null>(null);
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
  const eligibleTargets = devState.failureTargets.filter((target) => target.modes.includes(mode));
  const chosenTarget = eligibleTargets.find((target) => target.name === targetName) ?? eligibleTargets[0];
  const derivedWords = describeInstantWords(clock.derivedInstant);
  const seedWords = describeInstantWords(clock.seedInstant);
  const armedWords = plan.armedAt === null ? null : describeInstantWords(plan.armedAt);
  const runAction = useCallback(async (action: DevPanelAction, settledHeading: string | null, run: () => Promise<MutationOutcome>): Promise<void> => {
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
  }, []);
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
    void runAction("arm-failure", `Failure armed: ${MODE_LABEL[mode]} on ${target.name}`, () => onSetFailurePlan({ mode, target }));
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
    <section data-slot="dev-panel" aria-labelledby={titleId} aria-describedby={introId} aria-busy={busy ? true : undefined} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={titleId} className="text-lg font-semibold text-pretty">
          Development runtime
        </h2>
        <p id={introId} className="text-sm text-pretty text-muted-foreground">
          The scenario, the clock, one armed failure and the reset for this development session. These are development controls: the namespaced development route refuses them on the server outside a
          development session, so hiding this panel is not what protects them. The Development data label stays visible beside it, and nothing here is a production feature.
        </p>
      </div>
      {plan.armed && plan.mode !== null && plan.target !== null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <Badge variant="outline">Armed</Badge>
          <p className="min-w-0 flex-1 text-sm text-pretty">
            {plan.modeLabel} is armed on <bdi className="mono-identifier wrap-anywhere">{plan.target.name}</bdi>, so any request to that {plan.target.kind} answers with the injected outcome. Disarm it
            before you judge any other behaviour.
          </p>
        </div>
      ) : null}
      {busy ? <output className="block text-sm text-pretty text-muted-foreground">{PENDING_SENTENCE}</output> : null}
      {result === null ? null : (
        <div data-slot="dev-panel-result" data-action={result.action} className="min-w-0">
          <OperationResult outcome={result.outcome} heading={receiptHeading ?? undefined} headingLevel={3} onRetrySameWork={receiptRetry} />
        </div>
      )}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3>Scenario</h3>
          </CardTitle>
          <CardDescription>
            The seeded world this session runs in. A scenario decides which source is unavailable, so a demonstration proves something; switching it loads a different world and changes no record on
            its own.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1 text-sm text-pretty">
            <p>
              Running now: <span className="font-medium">{scenario.label}</span> <bdi className="mono-identifier wrap-anywhere text-muted-foreground">{scenario.id}</bdi>
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
              <Button type="button" variant="secondary" disabled={busy || !scenarioChangePending} onClick={switchScenario}>
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
            The scenario instant every boundary is measured against. It is an offset from one fixed seed instant rather than a second clock, and the only ways to move it are on this panel.
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
                {describeOffset(clock.offsetMilliseconds)} <bdi className="mono-identifier tabular-figures text-muted-foreground">({String(clock.offsetMilliseconds)} ms)</bdi>
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
                  aria-describedby={offsetError === null ? offsetHintId : `${offsetHintId} ${offsetErrorId}`}
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
              Units are elapsed time: a day here is 24 hours, and no unit on this panel is a calendar day. A negative offset places the instant before the seed.
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
                  aria-describedby={advanceError === null ? advanceHintId : `${advanceHintId} ${advanceErrorId}`}
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
              Advancing moves the instant forward by elapsed time only. 24 hours reaches the notification deadline exactly; 168 hours reaches the confirmation deadline exactly, which is where both are
              refused.
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
            One simulated failure, injected into one named read or mutation. Exactly one plan is active at a time, so a demonstration cannot confuse which failure it is watching.
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
                  <Button type="button" variant="destructive" disabled={busy} onClick={disarmFailure}>
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
                        <label key={entry} htmlFor={itemId} className="flex min-h-6 items-center gap-3 py-1">
                          <RadioGroupItem id={itemId} value={entry} aria-label={MODE_LABEL[entry]} />
                          <span className="text-sm font-medium">{MODE_LABEL[entry]}</span>
                        </label>
                      );
                    })}
                  </RadioGroup>
                </fieldset>
                <fieldset className="flex min-w-0 flex-col gap-2">
                  <legend className="text-sm text-muted-foreground">Call to inject it into</legend>
                  {eligibleTargets.length === 0 ? (
                    <p className="text-sm text-pretty text-muted-foreground">No call in this release demonstrates {MODE_LABEL[mode]}.</p>
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
                            <label key={target.name} htmlFor={itemId} className="flex min-h-6 items-start gap-3 py-1">
                              <RadioGroupItem id={itemId} value={target.name} aria-label={target.name} className="mt-0.5" />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <bdi className="mono-identifier wrap-anywhere text-sm font-medium">{target.name}</bdi>
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
                  <Button type="button" disabled={busy || chosenTarget === undefined} onClick={armFailure}>
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
            <CardDescription>A deterministic reset is not available in this session, so no control is offered that could not be honoured.</CardDescription>
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
