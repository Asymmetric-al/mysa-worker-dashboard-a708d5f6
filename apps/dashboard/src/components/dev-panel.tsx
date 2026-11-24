"use client";
import { useCallback, useId, useRef, useState, type ReactElement } from "react";
import ActionReview, { type ActionReviewProps, type MutationSubmit } from "@/components/action-review";
import { hasSettled, mayReplay } from "@/components/attempt";
import { factFrame } from "@/components/fact-list";
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
const UNREACHED_ATTEMPT = "dev-panel";
const isFailureMode = (value: string): value is FailureMode => Object.hasOwn(MODE_LABEL, value);
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
const clockUnitFor = (id: string): ClockUnit | undefined => CLOCK_UNITS.find((unit) => unit.id === id);
const joinWords = (parts: readonly string[]): string => (parts.length === 0 ? "no time at all" : parts.length === 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`);
function describeOffset(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "an unreadable offset";
  if (milliseconds === 0) return "no offset, so the clock sits at the seed instant";
  const parts: string[] = [];
  let remaining = Math.abs(milliseconds);
  for (const unit of DESCENDING_UNITS) {
    const count = Math.floor(remaining / unit.milliseconds);
    if (count === 0) continue;
    remaining -= count * unit.milliseconds;
    parts.push(`${String(count)} ${count === 1 ? unit.singular : unit.plural}`);
  }
  return `${joinWords(parts)} ${milliseconds > 0 ? "ahead of" : "before"} the seed instant`;
}
type ClockAmount = { readonly unit: ClockUnit; readonly amount: number; readonly offset: number };
function clockProblem(value: string, unitId: ClockUnitId, noun: string, minimum: number | null): ClockAmount | string {
  const unit = clockUnitFor(unitId);
  if (unit === undefined) return `Choose the unit the ${noun} is stated in.`;
  const amount = wholeNumber(value);
  if (amount === null) return `Enter a whole number of ${unit.plural}, with no decimal point or separator.`;
  if (minimum !== null && amount < minimum) return `Advancing moves the clock forward, so enter at least one ${unit.singular}.`;
  const offset = amount * unit.milliseconds;
  return !Number.isSafeInteger(offset) ? `That many ${unit.plural} is further than the clock can carry.` : { unit, amount, offset };
}
const zoneOf = (iso: string): string => (iso.endsWith("Z") || iso.endsWith("z") ? "UTC" : (/([+-]\d{2}:\d{2})$/.exec(iso)?.[1] ?? "UTC"));
function describeInstantWords(iso: string): string | null {
  const milliseconds = Date.parse(iso);
  if (!Number.isFinite(milliseconds)) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "long", timeZone: zoneOf(iso) }).format(milliseconds);
  } catch {
    return null;
  }
}
function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
export type DevFailureArming = { readonly mode: FailureMode; readonly target: DemonstrableTarget };
export type DevResetTransport = { readonly input: ActionReviewProps<unknown>["input"]; readonly submit: MutationSubmit<unknown> };
export type DevPanelProps = {
  readonly devState: DevState;
  readonly onSetScenario: (scenarioId: DevState["scenario"]["id"]) => Promise<MutationOutcome>;
  readonly onSetClock: (offsetMilliseconds: number) => Promise<MutationOutcome>;
  readonly onAdvanceClock: (advanceMilliseconds: number) => Promise<MutationOutcome>;
  readonly onSetFailurePlan: (arming: DevFailureArming | null) => Promise<MutationOutcome>;
  readonly reset: DevResetTransport;
  readonly className?: string;
};
const DEV_PANEL_ACTIONS = ["switch-scenario", "set-clock", "advance-clock", "arm-failure", "disarm-failure"] as const;
type DevPanelAction = (typeof DEV_PANEL_ACTIONS)[number];
type DevPanelResult = { readonly action: DevPanelAction; readonly settledHeading: string | null; readonly outcome: MutationOutcome };
type DevPanelAttempt = { readonly action: DevPanelAction; readonly settledHeading: string | null; readonly run: () => Promise<MutationOutcome> };
const CLOCK_BOUNDARY_SENTENCE = "Every boundary is evaluated when a read or a command runs against this instant: the referral " + "window, the coaching cutoff, notification usefulness, confirmation expiry and recurrence all " + "decide from it at the moment they are asked.";
const CLOCK_IMMEDIATE_SENTENCE = "Nothing here is scheduled. There is no run-at time, no timer and no background job, so advancing " + "is an immediate act and the only two controls that move time are the two below.";
const ARMED_DISARM_SENTENCE = "Disarm this plan before arming another: exactly one failure is active at a time, and the " + "development route refuses a second arming rather than replacing this one.";
const CLOCK_FIELD_CLASS = "flex min-w-0 flex-col gap-2";
const ClockFact = factFrame({ rowClassName: "flex min-w-0 flex-col gap-0.5", termClassName: "text-muted-foreground", valueClassName: "min-w-0 text-pretty" });
const OFFSET_HINT = "Units are elapsed time: a day here is 24 hours, and no unit on this panel is a calendar day. A negative offset places the instant before the seed.";
const ADVANCE_HINT = "Advancing moves the instant forward by elapsed time only. 24 hours reaches the notification deadline exactly; 168 hours reaches the confirmation deadline exactly, which is where both are refused.";
const chooseClockUnit = (value: string, select: (unit: ClockUnitId) => void): void => {
  const next = clockUnitFor(value);
  if (next !== undefined) select(next.id);
};
const RESET_DESCRIPTION =
  "The synthetic store is deleted and every seeded session is written again from the deterministic " +
  "seed, so the same readable records come back and a journey can be repeated from the same starting " +
  "point. Partners, notes, interactions, tasks, drafts, releases, audience memberships, coaching " +
  "grants and media records you created are discarded, the clock returns to the seed instant, and an " +
  "armed failure plan is cleared with the document that held it. Every stored session is " +
  "discarded before the seeded ones are written, so a reset that fails part way can leave " +
  "sessions discarded or only partly written. Running it again restores the seeded world.";
const RESET_CONSEQUENCE = "This discards the current synthetic store and cannot be undone from the interface. Nothing is " + "sent, published or charged: the reset replaces this application's own data only.";
type ClockFieldCopy = { readonly legend: string; readonly field: string; readonly hint: string; readonly action: string };
type ClockFieldState = { readonly idBase: string; readonly value: string; readonly unit: ClockUnitId; readonly error: string | null; readonly minimum?: number };
type ClockFieldHandlers = { readonly onChange: (value: string) => void; readonly onUnit: (unit: ClockUnitId) => void; readonly onAction: () => void; readonly disabled: boolean };
function ClockField(props: ClockFieldCopy & ClockFieldState & ClockFieldHandlers): ReactElement {
  const { legend, field, hint, action, idBase, value, unit, error, minimum, onChange, onUnit, onAction, disabled } = props;
  const unitId = `${idBase}-unit`;
  const hintId = `${idBase}-hint`;
  const errorId = `${idBase}-error`;
  const describedBy = error === null ? hintId : `${hintId} ${errorId}`;
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className={"flex min-w-0 flex-wrap items-end gap-2"}>
        <div className={CLOCK_FIELD_CLASS}>
          <Label htmlFor={idBase}>{field}</Label>
          <Input id={idBase} type="number" inputMode="numeric" step={1} min={minimum} value={value} disabled={disabled} aria-invalid={error === null ? undefined : true} aria-describedby={describedBy} className={"w-24 sm:w-28"} onChange={(event) => onChange(event.currentTarget.value)} />
        </div>
        <div className={CLOCK_FIELD_CLASS}>
          <Label htmlFor={unitId}>Unit</Label>
          <NativeSelect id={unitId} className={"w-full sm:w-auto"} value={unit} disabled={disabled} onChange={(event) => chooseClockUnit(event.currentTarget.value, onUnit)}>
            {CLOCK_UNITS.map((entry) => (
              <NativeSelectOption key={entry.id} value={entry.id}>
                {entry.plural}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="button" variant="secondary" disabled={disabled} onClick={onAction}>
          {action}
        </Button>
      </div>
      <p id={hintId} className={"type-supporting text-pretty"}>
        {hint}
      </p>
      {error === null ? null : (
        <p id={errorId} className={"type-body text-pretty text-destructive"}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
/** The development runtime's one control surface: scenario, clock, failure modes and reset. */ export function DevPanel({ devState, onSetScenario, onSetClock, onAdvanceClock, onSetFailurePlan, reset, className }: DevPanelProps): ReactElement {
  const idPrefix = useId();
  const titleId = `${idPrefix}-title`;
  const introId = `${idPrefix}-intro`;
  const scenarioSelectId = `${idPrefix}-scenario-select`;
  const scenarioHintId = `${idPrefix}-scenario-hint`;
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
    if (pendingRef.current !== null) return;
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
    if (attempt === null) return;
    void runAction(attempt.action, attempt.settledHeading, attempt.run);
  }, [runAction]);
  const switchScenario = (): void => {
    if (chosenScenario === undefined || !scenarioChangePending) return;
    const target = chosenScenario;
    void runAction("switch-scenario", `Scenario: ${target.label}`, () => onSetScenario(target.id));
  };
  const applyClockOffset = (): void => {
    const settled = clockProblem(offsetValue, offsetUnit, "offset", null);
    if (typeof settled === "string") return setOffsetError(settled);
    setOffsetError(null);
    void runAction("set-clock", `Clock: ${describeOffset(settled.offset)}`, () => onSetClock(settled.offset));
  };
  const advanceClock = (): void => {
    const settled = clockProblem(advanceValue, advanceUnit, "amount", 1);
    if (typeof settled === "string") return setAdvanceError(settled);
    setAdvanceError(null);
    const stated = `${String(settled.amount)} ${settled.amount === 1 ? settled.unit.singular : settled.unit.plural}`;
    void runAction("advance-clock", `Clock advanced by ${stated}`, () => onAdvanceClock(settled.offset));
  };
  const armFailure = (): void => {
    if (chosenTarget === undefined || plan.armed) return;
    const target = chosenTarget;
    void runAction("arm-failure", `Failure armed: ${MODE_LABEL[mode]} on ${target.name}`, () => onSetFailurePlan({ mode, target }));
  };
  const disarmFailure = (): void => {
    if (!plan.armed) return;
    void runAction("disarm-failure", "No failure is armed", () => onSetFailurePlan(null));
  };
  const receiptHeading = result !== null && hasSettled(result.outcome) ? result.settledHeading : null;
  return (
    <section data-slot="dev-panel" aria-labelledby={titleId} aria-describedby={introId} aria-busy={busy ? true : undefined} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={titleId} className="type-section-title text-pretty">
          Development runtime
        </h2>
        <p id={introId} className="type-supporting text-pretty">
          The scenario, the clock, one armed failure and the reset for this development session. These are development controls: the namespaced development route refuses them on the server outside a development session, so hiding this panel is not what protects them. The Development data label stays visible beside it,
          and nothing here is a production feature.
        </p>
      </div>
      {plan.armed && plan.mode !== null && plan.target !== null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <Badge variant="outline">Armed</Badge>
          <p className="min-w-0 flex-1 type-supporting text-pretty">
            {plan.modeLabel} is armed on <bdi className="mono-identifier wrap-anywhere">{plan.target.name}</bdi>, so any request to that {plan.target.kind} answers with the injected outcome. Disarm it before you judge any other behaviour.
          </p>
        </div>
      ) : null}
      {busy ? <output className="block type-supporting text-pretty">{"Applying that change to this development session and waiting for the answer."}</output> : null}
      {result === null ? null : (
        <div data-slot="dev-panel-result" data-action={result.action} className="min-w-0">
          <OperationResult outcome={result.outcome} heading={receiptHeading ?? undefined} headingLevel={3} onRetrySameWork={result !== null && mayReplay(result.outcome) ? retryLastAttempt : undefined} />
        </div>
      )}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3 className="type-subsection-title">Scenario</h3>
          </CardTitle>
          <CardDescription>The seeded world this session runs in. A scenario decides which source is unavailable, so a demonstration proves something; switching it loads a different world and changes no record on its own.</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1 text-pretty">
            <p className="type-body">
              Running now: <span className="font-medium">{scenario.label}</span> <bdi className="mono-identifier wrap-anywhere text-muted-foreground">{scenario.id}</bdi>
            </p>
            <p className="type-supporting">{scenario.description}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={scenarioSelectId}>Switch to</Label>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <NativeSelect id={scenarioSelectId} className="w-full sm:w-72" value={chosenScenarioId} aria-describedby={scenarioHintId} disabled={busy} onChange={(event) => setScenarioChoice(event.currentTarget.value)}>
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
            <p id={scenarioHintId} className="type-supporting text-pretty">
              {chosenScenario !== undefined && scenarioChangePending ? `This session runs ${scenario.label} now. Switching loads ${chosenScenario.label}: ${chosenScenario.description}` : "Choosing a scenario changes nothing until you switch to it."}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3 className="type-subsection-title">Clock</h3>
          </CardTitle>
          <CardDescription>The scenario instant every boundary is measured against. It is an offset from one fixed seed instant rather than a second clock, and the only ways to move it are on this panel.</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <dl className="flex min-w-0 flex-col gap-3 text-sm">
            <ClockFact term="Scenario instant">
              {derivedWords === null ? null : `${derivedWords}. `}
              <bdi className="mono-identifier wrap-anywhere">{clock.derivedInstant}</bdi>
            </ClockFact>
            <ClockFact term="Seed instant">
              {seedWords === null ? null : `${seedWords}. `}
              <bdi className="mono-identifier wrap-anywhere">{clock.seedInstant}</bdi>
            </ClockFact>
            <ClockFact term="Offset from the seed instant">
              {describeOffset(clock.offsetMilliseconds)} <bdi className="mono-identifier tabular-figures text-muted-foreground">({String(clock.offsetMilliseconds)} ms)</bdi>
            </ClockFact>
          </dl>
          <p className="type-supporting text-pretty">{CLOCK_BOUNDARY_SENTENCE}</p>
          <p className="type-supporting text-pretty">{CLOCK_IMMEDIATE_SENTENCE}</p>
          <Separator />
          <ClockField legend="Set the offset from the seed instant" field="Offset" idBase={`${idPrefix}-offset`} value={offsetValue} unit={offsetUnit} error={offsetError} hint={OFFSET_HINT} action="Set the clock offset" onChange={setOffsetValue} onUnit={setOffsetUnit} onAction={applyClockOffset} disabled={busy} />
          <ClockField legend="Advance the clock" field="Advance by" idBase={`${idPrefix}-advance`} minimum={1} value={advanceValue} unit={advanceUnit} error={advanceError} hint={ADVANCE_HINT} action="Advance the clock" onChange={setAdvanceValue} onUnit={setAdvanceUnit} onAction={advanceClock} disabled={busy} />
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3 className="type-subsection-title">Failure plan</h3>
          </CardTitle>
          <CardDescription>One simulated failure, injected into one named read or mutation. Exactly one plan is active at a time, so a demonstration cannot confuse which failure it is watching.</CardDescription>
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
                <p className="type-body text-pretty">
                  Armed at {armedWords === null ? null : `${armedWords}. `}
                  <bdi className="mono-identifier wrap-anywhere">{plan.armedAt}</bdi>
                </p>
              )}
              <p className="type-supporting text-pretty">{plan.effect}</p>
              <p className="type-supporting text-pretty">{plan.recoveryLesson}</p>
              <div className="flex min-w-0 flex-col gap-2">
                <div>
                  <Button type="button" variant="destructive" disabled={busy} onClick={disarmFailure}>
                    Disarm this failure
                  </Button>
                </div>
                <p className="type-supporting text-pretty">{ARMED_DISARM_SENTENCE}</p>
              </div>
            </div>
          ) : (
            <>
              <p className="type-supporting text-pretty">{"No failure is armed, so every read and every mutation answers from the application's own behaviour."}</p>
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
                    <p className="type-supporting text-pretty">No call in this release demonstrates {MODE_LABEL[mode]}.</p>
                  ) : (
                    <>
                      <RadioGroup
                        value={chosenTarget?.name ?? ""}
                        aria-describedby={chosenTarget === undefined ? undefined : targetHintId}
                        onValueChange={(next: unknown) => {
                          if (typeof next === "string") setTargetName(next);
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
                        <p id={targetHintId} className="type-supporting text-pretty">
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
        <ActionReview title="Reset the development data" headingLevel={3} consequential confirmLabel="Reset and re-seed" input={reset.input} submit={reset.submit} description={<p className="type-supporting">{RESET_DESCRIPTION}</p>} consequence={<p className="type-supporting">{RESET_CONSEQUENCE}</p>} />
      ) : (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              <h3 className="type-subsection-title">Reset</h3>
            </CardTitle>
            <CardDescription>A deterministic reset is not available in this session, so no control is offered that could not be honoured.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="type-supporting text-pretty">{devState.reset.statement}</p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
export default DevPanel;
