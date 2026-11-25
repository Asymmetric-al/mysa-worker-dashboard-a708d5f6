"use client";
import { useCallback, useId, useMemo, useState, type ChangeEvent, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import { factFrame } from "@/components/fact-list";
import FormField, { fieldErrorsFromInvalid, fieldMessagesOf, FormErrorSummary, type FieldErrorLookup } from "@/components/form-field";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MeterBar } from "@/components/ui/meter-bar";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadialGauge } from "@/components/ui/radial-gauge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { MutationInput, ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { exponentOf, UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { SUPPORT_BASIS } from "@/modules/support/basis";
import { GOAL_CAPABILITY, type GoalProgress, type GoalProgressState } from "@/modules/support/goal";
import { EMPTY_STATES, GOAL_CURRENCY_CHOICE, GOAL_CURRENCY_UNSTATED, MEASURE_LABELS, NO_PERCENTAGE, VALUE_STATE_MEANING } from "../copy";
import { useGoal, type GoalEnvelope } from "../hooks/use-goal";
import { useSaveGoal, type GoalSaveFormPayload } from "../hooks/use-save-goal";
import { goalSavePayloadSchema } from "../schemas";
import AmountValue from "./amount-value";
import SnapshotStatement from "./snapshot-statement";
type GoalFigure = NonNullable<GoalEnvelope["data"]["goal"]>;
export type GoalPanelProps = { readonly scope: Scope; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly initialEnvelope?: ReadEnvelope<unknown>; readonly className?: string };
const AMOUNT_LABEL = "Amount";
const CURRENCY_LABEL = "Currency";
const EFFECTIVE_FROM_LABEL = "Effective from";
const MEASURE_LABEL = "Measure";
const FACT_LABELS = { amount: AMOUNT_LABEL, measure: MEASURE_LABEL, effectiveFrom: EFFECTIVE_FROM_LABEL, revision: "Revision" } as const;
const FORM_LABELS: Readonly<Record<string, string>> = { amount: AMOUNT_LABEL, effectiveFrom: EFFECTIVE_FROM_LABEL, currency: CURRENCY_LABEL, measure: MEASURE_LABEL };
const FORM_FIELD_ORDER = ["amount", "effectiveFrom", "currency", "measure"] as const;
const CIVIL_DAY_NOTE = "a calendar day, with no time of day and no zone behind it";
const UNEDITABLE_CURRENCY_BODY =
  "The goal is stated in a currency this application holds no minor-unit precision for, so an amount in it cannot be written exactly. No currency is substituted in its place and no exponent is assumed, so the goal stays read-only until a source states it in a currency whose precision is known.";
function goalEnvelopeOf(candidate: ReadEnvelope<unknown> | undefined): GoalEnvelope | undefined {
  if (candidate === undefined) return undefined;
  const data: unknown = candidate.data;
  return typeof data === "object" && data !== null && "goal" in data && "progress" in data && "percentage" in data && "period" in data && "measure" in data && "canEditGoal" in data ? (candidate as GoalEnvelope) : undefined;
}
const goalAmountStateOf = (envelope: GoalEnvelope): ValueState => envelope.valueStates["goal.amount"] ?? "unknown";
const goalPercentageStateOf = (envelope: GoalEnvelope): ValueState => envelope.valueStates["goal.percentage"] ?? "unknown";
type StatedPercentageState = Exclude<ValueState, "unknown" | "withheld" | "unavailable">;
type ProgressFigure = { readonly text: string; readonly label: string; readonly note: string };
const statesPercentage = (state: ValueState): state is StatedPercentageState => state === "value" || state === "zero" || state === "incomplete-subtotal";
const percentageFigureOf = (percentage: string, state: StatedPercentageState): ProgressFigure => {
  const text = state === "incomplete-subtotal" ? `${percentage}${" (incomplete)"}` : percentage;
  const note = VALUE_STATE_MEANING[state];
  return { text, label: `${text}. ${note}`, note };
};
function progressPresentation(progress: GoalProgress, goal: GoalFigure | null, measureLabel: string, from: string, to: string, percentage: string | null, percentageState: ValueState): { readonly figure: ProgressFigure | null; readonly sentence: string } {
  const figure = (progress.state === "value" || progress.state === "zero") && percentage !== null && statesPercentage(percentageState) ? percentageFigureOf(percentage, percentageState) : null;
  const partialCoverage = percentageState === "incomplete-subtotal" ? " The source holds only part of that period, so the numerator of this percentage covers only the part it holds, and the figure is not a percentage of the whole period." : "";
  const stated: Readonly<Record<Exclude<GoalProgressState, "value" | "zero">, string>> = {
    "no-goal": NO_PERCENTAGE["no-goal"],
    "no-percentage": NO_PERCENTAGE[goal === null ? "no-goal" : goal.amount.minorUnits === 0 ? "zero-denominator" : "unknown-denominator"],
    incompatible: NO_PERCENTAGE["incompatible-measure"],
    paused: "This goal is paused, so no percentage is shown. A paused goal is not 0%: it is a goal the source is not measuring right now.",
    ended: "This goal has ended, so no percentage is shown. An ended goal is not 0%.",
    unavailable: "The source behind this percentage could not be read, so no percentage is shown. That is not 0% and it is not an absence of giving.",
  };
  // A state that asserts a percentage but carries none is never explained away with an invented figure, so it falls back to the sentence that says why no percentage is shown.
  const sentence =
    progress.state === "zero"
      ? `No received support is recorded over ${from} to ${to}, so the goal is 0% met. That is a recorded zero and not an unknown figure.${partialCoverage}`
      : progress.state === "value"
        ? figure === null || percentage === null
          ? NO_PERCENTAGE.default
          : `The goal is ${percentage} met over ${from} to ${to} on the ${measureLabel} measure.${partialCoverage} A figure above 100% is stated exactly as it was computed and is never capped.`
        : stated[progress.state];
  return { figure, sentence };
}
function precisionDescription(currency: string, exponent: number): string {
  if (exponent === 0) return `Enter the amount in ${currency} as figures. ${currency} amounts have no decimal places, so a whole amount is the only exact one.`;
  const places = exponent === 1 ? "one decimal place" : `${exponent} decimal places`;
  return `Enter the amount in ${currency} as figures, with a full stop before the decimals. ${currency} amounts have ${places}, so a longer fraction is refused rather than rounded.`;
}
const Fact = factFrame({ rowClassName: "flex flex-wrap items-baseline gap-x-1.5", termClassName: "font-medium", valueClassName: "min-w-0 break-words" });
const GoalFacts = ({ goal, locale, measureLabel, valueState }: { readonly goal: GoalFigure; readonly locale: string; readonly measureLabel: string; readonly valueState: ValueState }): ReactElement => (
  <dl className="grid gap-2.5 rounded-2xl border border-border/80 bg-surface-subtle p-4 text-sm">
    <Fact term={FACT_LABELS.amount}>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <AmountValue money={goal.amount} valueState={valueState} locale={locale} emphasis="headline" />
        <bdi className="text-sm text-muted-foreground">{goal.amount.currency}</bdi>
      </span>
    </Fact>
    <Fact term={FACT_LABELS.measure} value={<bdi>{measureLabel}</bdi>} />
    <Fact term={FACT_LABELS.effectiveFrom}>
      <bdi>{goal.effectiveFrom}</bdi> <span className="text-muted-foreground">({CIVIL_DAY_NOTE})</span>
    </Fact>
    <Fact term={FACT_LABELS.revision}>
      <bdi className="mono-identifier">{goal.revision}</bdi> <span className="text-muted-foreground">(the revision a change must present; a stale one is a conflict rather than an overwrite)</span>
    </Fact>
  </dl>
);
const GoalComparison = ({ current, currentState, locale, amount, currency, effectiveFrom }: { readonly current: GoalFigure | null; readonly currentState: ValueState; readonly locale: string; readonly amount: string; readonly currency: string; readonly effectiveFrom: string }): ReactElement => (
  <dl className="grid gap-1.5">
    <Fact term="Current goal" value={current === null ? "No goal is set" : <AmountValue money={current.amount} valueState={currentState} locale={locale} />} />
    <Fact term="This change">
      <bdi>{amount.trim() === "" ? "an amount you have not entered yet" : amount}</bdi> <bdi>{currency.trim() === "" ? GOAL_CURRENCY_CHOICE.unchosen : currency}</bdi>
    </Fact>
    <Fact term="Effective from" value={effectiveFrom.trim() === "" ? "a day you have not chosen yet" : <bdi>{effectiveFrom}</bdi>} />
  </dl>
);
function GoalForm({ envelope, locale, onClose, onCheckResult }: { readonly envelope: GoalEnvelope; readonly locale: string; readonly onClose: () => void; readonly onCheckResult: () => void }): ReactElement {
  const { data } = envelope;
  const goal = data.goal;
  const measureLabel = MEASURE_LABELS[data.measure];
  // A stored goal is stated in its own currency. A first goal is stated in one of the currencies the read reports this
  const statedCurrencies = data.currencies; // subject's source stating: where the source states exactly one it is stated as the fixed fact it is, and where it states more the caller chooses, so no currency is chosen for them.
  const [chosenCurrency, setChosenCurrency] = useState("");
  const statedSingle = statedCurrencies.length === 1 ? statedCurrencies[0] : undefined;
  const stated = goal === null ? (statedSingle ?? statedCurrencies.find((entry) => entry.currency === chosenCurrency)) : undefined;
  const choosingCurrency = goal === null && statedCurrencies.length > 1;
  const currency = goal === null ? (stated?.currency ?? "") : goal.amount.currency;
  const exponent = goal === null ? stated?.exponent : exponentOf(goal.amount.currency);
  const currencyKnown = exponent !== undefined && currency !== UNKNOWN_CURRENCY;
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(goal === null ? "" : goal.effectiveFrom);
  const [openedRevision] = useState(envelope.revision);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrorLookup | null>(null);
  const [settled, setSettled] = useState(false);
  const saveGoal = useSaveGoal();
  const mutateGoal = saveGoal.mutateAsync;
  const payload = useMemo<GoalSaveFormPayload>(() => ({ currency, amount, effectiveFrom }), [currency, amount, effectiveFrom]);
  const clientErrors = useMemo<FieldErrorLookup | null>(() => {
    const checked = goalSavePayloadSchema.safeParse(payload);
    return checked.success ? null : fieldErrorsFromInvalid({ fields: fieldMessagesOf(checked.error) });
  }, [payload]);
  const errors = serverErrors ?? (touched ? clientErrors : null);
  const submit = useCallback(async (input: MutationInput<GoalSaveFormPayload>): Promise<MutationOutcome> => mutateGoal({ scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload, operationId: input.operationId }), [mutateGoal]);
  const handleSettled = (outcome: MutationOutcome): void => {
    if (outcome.outcome === "invalid") {
      setServerErrors(fieldErrorsFromInvalid(outcome));
      return;
    }
    setServerErrors(null);
    if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") setSettled(true);
  };
  const markTouched = (): void => setTouched(true);
  if (goal === null && statedCurrencies.length === 0) {
    // The source states no currency this application holds an exact precision for, so a first goal cannot be typed here.
    return (
      <Alert>
        <AlertTitle>{GOAL_CURRENCY_UNSTATED.title}</AlertTitle>
        <AlertDescription>{GOAL_CURRENCY_UNSTATED.body}</AlertDescription>
      </Alert>
    );
  }
  if (goal !== null && !currencyKnown) {
    return (
      <Alert>
        <AlertTitle>This goal cannot be changed here</AlertTitle>
        <AlertDescription>{UNEDITABLE_CURRENCY_BODY}</AlertDescription>
      </Alert>
    );
  }
  const fields: readonly { readonly name: string; readonly label: string; readonly description: string; readonly type: "text" | "date"; readonly inputMode?: "decimal"; readonly autoComplete?: "off"; readonly value: string; readonly onChange: (value: string) => void }[] = [
    { name: "amount", label: AMOUNT_LABEL, description: exponent === undefined ? GOAL_CURRENCY_CHOICE.awaitingCurrency : precisionDescription(currency, exponent), type: "text", inputMode: "decimal", autoComplete: "off", value: amount, onChange: setAmount },
    { name: "effectiveFrom", label: EFFECTIVE_FROM_LABEL, description: `The day this goal takes effect on — ${CIVIL_DAY_NOTE}.`, type: "date", value: effectiveFrom, onChange: setEffectiveFrom },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="type-supporting text-pretty">
        Saved against <bdi>{measureLabel}</bdi>: this release sets a goal against one measure only, so the form states the measure and offers no choice of another.
      </p>
      {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FORM_LABELS} order={FORM_FIELD_ORDER} headingLevel={3} />}
      {choosingCurrency ? (
        <FormField name="currency" label={CURRENCY_LABEL} description={GOAL_CURRENCY_CHOICE.guidance} error={errors?.byField["currency"]} required>
          {(field) => (
            <NativeSelect
              id={field.id}
              name="currency"
              className="w-full sm:max-w-72"
              value={chosenCurrency}
              aria-describedby={field.describedBy}
              aria-invalid={field.invalid ? true : undefined}
              onChange={(event) => {
                setChosenCurrency(event.currentTarget.value);
                setSettled(false);
              }}
              onBlur={markTouched}
            >
              <NativeSelectOption value="">{GOAL_CURRENCY_CHOICE.unset}</NativeSelectOption>
              {statedCurrencies.map((entry) => (
                <NativeSelectOption key={entry.currency} value={entry.currency}>
                  {entry.currency}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {fields.map((entry) => (
        <FormField key={entry.name} name={entry.name} label={entry.label} description={entry.description} error={errors?.byField[entry.name]} required>
          {(field) => {
            const onEntryChange = (event: ChangeEvent<HTMLInputElement>): void => {
              entry.onChange(event.target.value);
              setSettled(false);
            };
            return <Input id={field.id} name={entry.name} type={entry.type} inputMode={entry.inputMode} autoComplete={entry.autoComplete} value={entry.value} aria-describedby={field.describedBy} aria-invalid={field.invalid ? true : undefined} onChange={onEntryChange} onBlur={markTouched} />;
          }}
        </FormField>
      ))}
      {choosingCurrency ? null : (
        <p className="type-supporting">
          The currency is <bdi>{currency}</bdi> and is not a free choice: it is the currency this support subject reports in, so the amount inherits a precision the source states rather than one this form assumes.
        </p>
      )}
      <Separator />
      <ActionReview<GoalSaveFormPayload>
        title="Review this goal change"
        description={<GoalComparison current={goal} currentState={goalAmountStateOf(envelope)} locale={locale} amount={amount} currency={currency} effectiveFrom={effectiveFrom} />}
        confirmLabel="Save goal"
        cancelLabel="Cancel"
        onCancel={onClose}
        input={{ scope: envelope.scope, expectedRevision: openedRevision, payload }}
        submit={submit}
        onSettled={handleSettled}
        checkResult={onCheckResult}
        fieldLabels={FORM_LABELS}
        headingLevel={3}
      />
      {settled ? <Button {...{ type: "button", variant: "outline", onClick: onClose }}>Close</Button> : null}
    </div>
  );
}
/** The single goal surface: what the goal is, how far it has been met, and — only where the read permits it — the change. */ export function GoalPanel({ scope, locale, dir, initialEnvelope, className }: GoalPanelProps): ReactElement {
  const titleId = useId();
  const seed = useMemo(() => goalEnvelopeOf(initialEnvelope), [initialEnvelope]);
  const query = useGoal({ scope, initialEnvelope: seed });
  const [editing, setEditing] = useState(false);
  if (query.isPending) return <StateNotice kind="loading" title="Reading the support goal" headingLevel={3} className={className} />;
  const refetch = { label: "Read the goal again", onClick: (): void => void query.refetch() };
  if (query.isError) return <StateNotice kind="unavailable" title="The support goal could not be read" description="The source behind the goal did not answer, so no amount, revision or percentage is shown in its place." retry={refetch} headingLevel={3} className={className} />;
  const result = query.data;
  if (result.kind === "denied")
    return <StateNotice kind="denied" title="The support goal is not readable in this context" description="The goal, its amount and its progress are read under the selected context, and this session holds no authority for it." reasonCode={result.denied.reasonCode} headingLevel={3} className={className} />;
  if (result.kind === "unavailable") return <StateNotice kind="unavailable" title="The support goal could not be read" description={result.unavailable.guidance} source={result.unavailable.source} retry={refetch} headingLevel={3} className={className} />;
  if (result.kind === "refused") return <StateNotice kind="refused" title="This goal's request was refused" headingLevel={3} className={className} />;
  if (result.kind !== "envelope") return assertNever(result, "The goal read answered with an arm this panel does not render.");
  const envelope = result.envelope;
  const { data, actions } = envelope;
  const goal = data.goal;
  const measureLabel = MEASURE_LABELS[data.measure];
  const editAction = actions.find((action) => action.name === GOAL_CAPABILITY);
  const canEdit = data.canEditGoal;
  const progress = progressPresentation(data.progress, goal, measureLabel, data.period.from, data.period.to, data.percentage, goalPercentageStateOf(envelope));
  const showForm = canEdit && editing;
  return (
    <section aria-labelledby={titleId} dir={dir} className={cn("min-w-0", className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2 {...{ id: titleId, className: "type-section-title" }}>Support goal</h2>
          </CardTitle>
          <CardDescription>{"One target, set against received gifts on the one named basis this application measures. Changing the goal changes only the goal: no gift, commitment, earlier report or public progress is written, and no message is sent."}</CardDescription>
          {canEdit && !showForm ? (
            <CardAction>
              <Button {...{ type: "button", onClick: () => setEditing(true) }}>{goal === null ? "Set a goal" : "Change the goal"}</Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-6">
          {goal === null ? (
            <div className="flex min-w-0 flex-col gap-2">
              <p className="type-subsection-title">{EMPTY_STATES.goal.title}</p>
              <p className="type-supporting text-pretty">{EMPTY_STATES.goal.body}</p>
            </div>
          ) : (
            <GoalFacts goal={goal} locale={locale} measureLabel={measureLabel} valueState={goalAmountStateOf(envelope)} />
          )}
          <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-surface-subtle p-4">
            <h3 className="type-subsection-title">Progress</h3>
            {progress.figure === null
              ? null
              : (() => {
                  const numericMatch = data.percentage === null ? null : /^(\d+(?:\.\d+)?)/.exec(data.percentage.trim());
                  const parsedPercent = numericMatch === null ? null : Number(numericMatch[1]);
                  return (
                    <div className="flex min-w-0 flex-wrap items-center gap-4">
                      {parsedPercent !== null && Number.isFinite(parsedPercent) ? (
                        <RadialGauge percentage={parsedPercent} ariaLabel={`Support goal progress: ${progress.figure.text}`} className="size-16" />
                      ) : null}
                      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                        <p className="flex flex-wrap items-baseline gap-x-2">
                          <span title={progress.figure.label}>
                            <bdi className="tabular-figures text-2xl font-semibold tracking-tight">{progress.figure.text}</bdi>
                            <span className="sr-only">{`. ${progress.figure.note}`}</span>
                          </span>
                          <span className="text-sm text-muted-foreground">of the goal</span>
                        </p>
                        {parsedPercent !== null && Number.isFinite(parsedPercent) ? <MeterBar label="Support goal progress" value={Math.min(100, Math.max(0, parsedPercent))} valueText={progress.figure.text} tone={parsedPercent >= 100 ? "positive" : "primary"} showHeader={false} /> : null}
                      </div>
                    </div>
                  );
                })()}
            <p className="type-supporting text-pretty">{progress.sentence}</p>
          </div>
          <SnapshotStatement basis={SUPPORT_BASIS} currencies={[goal === null ? envelope.coverage.currency : goal.amount.currency]} period={{ from: data.period.from, to: data.period.to }} coverage={envelope.coverage} asOf={envelope.asOf} isCurrentPeriod={data.period.state === "in-progress"} locale={locale} />
          {canEdit ? null : <p className="type-supporting text-pretty">{editAction?.reason ?? "This read states no goal-editing capability, so the goal is read-only here: no edit control is offered and a save would be refused."}</p>}
          {showForm ? (
            <>
              <Separator />
              <GoalForm envelope={envelope} locale={locale} onClose={() => setEditing(false)} onCheckResult={() => void query.refetch()} />
            </>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
export default GoalPanel;
