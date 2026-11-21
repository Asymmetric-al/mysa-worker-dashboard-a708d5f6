"use client";
/** The one support goal surface: the target amount, the currency it is stated in, the measure it counts, the civil day it took effect on, the revision a change must present, and its progress — … */
import { useCallback, useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { ZodError } from "zod";
import ActionReview from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, FormErrorSummary, type FieldErrorLookup } from "@/components/form-field";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { MutationInput, ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import { ROOT_FIELD_KEY, type MutationOutcome } from "@/modules/data-service/outcome";
import { exponentOf, UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { SUPPORT_BASIS } from "@/modules/support/basis";
import { formatPercentageBasisPoints, GOAL_CAPABILITY, type GoalProgress } from "@/modules/support/goal";
import { EMPTY_STATES, MEASURE_LABELS, NO_PERCENTAGE, type NoPercentageReason } from "../copy";
import { useGoal, type GoalEnvelope } from "../hooks/use-goal";
import { useSaveGoal, type GoalSaveFormPayload } from "../hooks/use-save-goal";
import { goalSavePayloadSchema } from "../schemas";
import AmountValue from "./amount-value";
import SnapshotStatement from "./snapshot-statement";
type GoalFigure = NonNullable<GoalEnvelope["data"]["goal"]>;
/** Props of {@link GoalPanel}. */
export type GoalPanelProps = {
  readonly scope: Scope;
  readonly locale: string;
  /** The display direction the route composition states; it is set on this block only, never on a child's styles. */
  readonly dir?: "ltr" | "rtl";
  readonly initialEnvelope?: ReadEnvelope<unknown>;
  readonly className?: string;
};
const PANEL_TITLE = "Support goal";
const PANEL_DESCRIPTION = "One target, set against received gifts on the one named basis this application measures. Changing the goal " + "changes only the goal: no gift, commitment, earlier report or public progress is written, and no message is " + "sent.";
const READ_ONLY_FALLBACK_REASON = "This read states no goal-editing capability, so the goal is read-only here: no edit control is offered and a " + "save would be refused.";
const UNEDITABLE_CURRENCY_TITLE = "This goal cannot be changed here";

const UNEDITABLE_CURRENCY_BODY =
  "The goal is stated in a currency this application holds no minor-unit precision for, so an amount in it cannot " + "be written exactly. No currency is substituted in its place and no exponent is assumed, so the goal stays " + "read-only until a source states it in a currency whose precision is known.";

const AMOUNT_LABEL = "Amount";
const MEASURE_LABEL = "Measure";
const EFFECTIVE_FROM_LABEL = "Effective from";
const FACT_LABELS = { amount: AMOUNT_LABEL, measure: MEASURE_LABEL, effectiveFrom: EFFECTIVE_FROM_LABEL, revision: "Revision" } as const;
const FORM_LABELS: Readonly<Record<string, string>> = { amount: AMOUNT_LABEL, effectiveFrom: EFFECTIVE_FROM_LABEL, currency: "Currency", measure: MEASURE_LABEL };
const FORM_FIELD_ORDER = ["amount", "effectiveFrom", "currency", "measure"] as const;
const CIVIL_DAY_NOTE = "a calendar day, with no time of day and no zone behind it";

function goalEnvelopeOf(candidate: ReadEnvelope<unknown> | undefined): GoalEnvelope | undefined {
  if (candidate === undefined) return undefined;
  const data: unknown = candidate.data;
  const shaped = typeof data === "object" && data !== null && "goal" in data && "progress" in data && "percentage" in data && "period" in data && "measure" in data && "canEditGoal" in data;
  return shaped ? (candidate as GoalEnvelope) : undefined;
}
function fieldMessagesOf(error: ZodError): Readonly<Record<string, readonly string[]>> {
  const messages: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? ROOT_FIELD_KEY : issue.path.map((step) => String(step)).join(".");
    const existing = messages[path];
    if (existing === undefined) {
      messages[path] = [issue.message];
    } else if (!existing.includes(issue.message)) {
      existing.push(issue.message);
    }
  }
  return messages;
}
/** The state the read recorded for the goal's amount, defaulting to `unknown` so an unstated state is never shown as a figure. */
function goalAmountStateOf(envelope: GoalEnvelope): ValueState {
  return envelope.valueStates["goal.amount"] ?? "unknown";
}
/** One progress figure as a surface states it: the percentage only where one exists, and always the sentence that explains it. */
interface ProgressPresentation {
  readonly figure: string | null;
  readonly sentence: string;
}
/** Why a percentage is absent, for the one state that does not carry its own reason. */
function absentPercentageReason(goal: GoalFigure | null): NoPercentageReason {
  if (goal === null) return "no-goal";
  return goal.amount.minorUnits === 0 ? "zero-denominator" : "unknown-denominator";
}
/** Every progress state, each with its own figure and its own sentence — never a percentage nobody computed and never a bare `0%`. */
function progressPresentation(progress: GoalProgress, goal: GoalFigure | null, measureLabel: string, from: string, to: string): ProgressPresentation {
  // The formatter runs once, and only for the two states the domain computes a percentage for: a
  // paused, ended, incompatible or unknown figure carries none, and a percentage is never derived
  // here from a state that states none.
  const computed = progress.state === "value" || progress.state === "zero";
  const basisPoints = progress.percentageBasisPoints;
  const figure = computed && basisPoints !== null ? formatPercentageBasisPoints(basisPoints) : null;
  switch (progress.state) {
    case "value":
      if (figure === null) {
        // A state that asserts a percentage but carries none is never explained away with an
        // invented figure, so it falls back to the sentence that says why no percentage is shown.
        return { figure: null, sentence: NO_PERCENTAGE.default };
      }
      return { figure, sentence: `The goal is ${figure} met over ${from} to ${to} on the ${measureLabel} measure. A figure above 100% is stated exactly as it was computed and is never capped.` };
    case "zero":
      return { figure, sentence: `No received support is recorded over ${from} to ${to}, so the goal is 0% met. That is a recorded zero and not an unknown figure.` };
    case "no-goal":
      return { figure: null, sentence: NO_PERCENTAGE["no-goal"] };
    case "no-percentage":
      return { figure: null, sentence: NO_PERCENTAGE[absentPercentageReason(goal)] };
    case "incompatible":
      return { figure: null, sentence: NO_PERCENTAGE["incompatible-measure"] };
    case "paused":
      return { figure: null, sentence: "This goal is paused, so no percentage is shown. A paused goal is not 0%: it is a goal the source is not measuring right now." };
    case "ended":
      return { figure: null, sentence: "This goal has ended, so no percentage is shown. An ended goal is not 0%." };
    case "unavailable":
      return { figure: null, sentence: "The source behind this percentage could not be read, so no percentage is shown. That is not 0% and it is not an absence of giving." };
  }
}
/** The precision a currency carries, stated as the rule the amount field enforces. */
function precisionDescription(currency: string, exponent: number): string {
  if (exponent === 0) {
    return `Enter the amount in ${currency} as figures. ${currency} amounts have no decimal places, so a whole amount is the only exact one.`;
  }
  const places = exponent === 1 ? "one decimal place" : `${exponent} decimal places`;
  return `Enter the amount in ${currency} as figures, with a full stop before the decimals. ${currency} amounts have ${places}, so a longer fraction is refused rather than rounded.`;
}
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5">
      <dt className="font-medium">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
/** The goal's own facts: the amount, the currency it is in, the measure it counts, the day it took effect and the revision a change must present. */
function GoalFacts({ goal, locale, measureLabel, valueState }: { readonly goal: GoalFigure; readonly locale: string; readonly measureLabel: string; readonly valueState: ValueState }): ReactElement {
  return (
    <dl className="grid gap-2 text-sm">
      <Fact term={FACT_LABELS.amount}>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <AmountValue money={goal.amount} valueState={valueState} locale={locale} emphasis="headline" />
          <span className="text-sm text-muted-foreground">
            <bdi>{goal.amount.currency}</bdi>
          </span>
        </span>
      </Fact>
      <Fact term={FACT_LABELS.measure}>
        <bdi>{measureLabel}</bdi>
      </Fact>
      <Fact term={FACT_LABELS.effectiveFrom}>
        <bdi>{goal.effectiveFrom}</bdi> <span className="text-muted-foreground">({CIVIL_DAY_NOTE})</span>
      </Fact>
      <Fact term={FACT_LABELS.revision}>
        <bdi className="mono-identifier">{goal.revision}</bdi> <span className="text-muted-foreground">(the revision a change must present; a stale one is a conflict rather than an overwrite)</span>
      </Fact>
    </dl>
  );
}
function GoalComparison({ current, currentState, locale, amount, currency, effectiveFrom }: { readonly current: GoalFigure | null; readonly currentState: ValueState; readonly locale: string; readonly amount: string; readonly currency: string; readonly effectiveFrom: string }): ReactElement {
  return (
    <dl className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <dt className="font-medium">Current goal</dt>
        <dd>{current === null ? "No goal is set" : <AmountValue money={current.amount} valueState={currentState} locale={locale} />}</dd>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <dt className="font-medium">This change</dt>
        <dd>
          <bdi>{amount.trim() === "" ? "an amount you have not entered yet" : amount}</bdi> <bdi>{currency}</bdi>
        </dd>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <dt className="font-medium">Effective from</dt>
        <dd>{effectiveFrom.trim() === "" ? "a day you have not chosen yet" : <bdi>{effectiveFrom}</bdi>}</dd>
      </div>
    </dl>
  );
}
interface GoalFormProps {
  readonly envelope: GoalEnvelope;
  readonly locale: string;
  readonly onClose: () => void;
  readonly onCheckResult: () => void;
}
/** The goal's one editing surface: four facts, the schema's own messages, a reviewed submit and the service's outcome. */
function GoalForm({ envelope, locale, onClose, onCheckResult }: GoalFormProps): ReactElement {
  const { data } = envelope;
  const goal = data.goal;
  const measureLabel = MEASURE_LABELS[data.measure];
  const currency = goal === null ? envelope.coverage.currency : goal.amount.currency;
  const exponent = exponentOf(currency);
  const currencyKnown = exponent !== undefined && currency !== UNKNOWN_CURRENCY;
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(goal === null ? "" : goal.effectiveFrom);
  const [openedRevision] = useState(envelope.revision);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrorLookup | null>(null);
  const [settled, setSettled] = useState(false);
  const saveGoal = useSaveGoal();
  const mutateGoal = saveGoal.mutateAsync;
  // `measure` is deliberately absent: the payload schema fixes a goal to the one measure this release
  // admits and supplies it itself, so stating it here would offer a choice the form cannot make and
  // the service would only re-check. The measure is shown to the reader as a fact, never as a control.
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
  if (!currencyKnown) {
    return (
      <Alert>
        <AlertTitle>{UNEDITABLE_CURRENCY_TITLE}</AlertTitle>
        <AlertDescription>{UNEDITABLE_CURRENCY_BODY}</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-pretty text-muted-foreground">
        Saved against <bdi>{measureLabel}</bdi>: this release sets a goal against one measure only, so the form states the measure and offers no choice of another.
      </p>
      {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FORM_LABELS} order={FORM_FIELD_ORDER} headingLevel={3} />}
      <FormField name="amount" label={AMOUNT_LABEL} description={precisionDescription(currency, exponent)} error={errors?.byField.amount} required>
        {(field) => (
          <Input
            id={field.id}
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            aria-describedby={field.describedBy}
            aria-invalid={field.invalid ? true : undefined}
            onChange={(event) => {
              setAmount(event.target.value);
              setSettled(false);
            }}
            onBlur={markTouched}
          />
        )}
      </FormField>
      <FormField name="effectiveFrom" label={EFFECTIVE_FROM_LABEL} description={`The day this goal takes effect on — ${CIVIL_DAY_NOTE}.`} error={errors?.byField.effectiveFrom} required>
        {(field) => (
          <Input
            id={field.id}
            name="effectiveFrom"
            type="date"
            value={effectiveFrom}
            aria-describedby={field.describedBy}
            aria-invalid={field.invalid ? true : undefined}
            onChange={(event) => {
              setEffectiveFrom(event.target.value);
              setSettled(false);
            }}
            onBlur={markTouched}
          />
        )}
      </FormField>
      <p className="text-sm text-muted-foreground">
        The currency is <bdi>{currency}</bdi> and is not a free choice: it is the currency this support subject reports in, so the amount inherits a precision the source states rather than one this form assumes.
      </p>
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
      {settled ? (
        <div>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : null}
    </div>
  );
}
/** The single goal surface: what the goal is, how far it has been met, and — only where the read permits it — the change. */
export function GoalPanel({ scope, locale, dir, initialEnvelope, className }: GoalPanelProps): ReactElement {
  const titleId = useId();
  const seed = useMemo(() => goalEnvelopeOf(initialEnvelope), [initialEnvelope]);
  const query = useGoal({ scope, initialEnvelope: seed });
  const [editing, setEditing] = useState(false);
  if (query.isPending) {
    return <StateNotice kind="loading" title="Reading the support goal" headingLevel={3} className={className} />;
  }
  if (query.isError) {
    // A read that never answered, or answered in a form none of the three arms describes, is the one
    // failure the arm switch cannot state: it is reported as the outage it is, with the retry that
    // re-requests it, and no status is read back out of the error to guess at another arm.
    return (
      <StateNotice
        kind="unavailable"
        title="The support goal could not be read"
        description="The source behind the goal did not answer, so no amount, revision or percentage is shown in its place."
        retry={{
          label: "Read the goal again",
          onClick: async () => {
            await query.refetch();
          },
        }}
        headingLevel={3}
        className={className}
      />
    );
  }
  const result = query.data;
  if (result.kind === "denied") {
    // A refusal is stated as a refusal: the arm's own reason code, and no amount, count or title
    // beside it, because the answer is the same whether or not a goal exists in this context.
    return <StateNotice kind="denied" title="The support goal is not readable in this context" description="The goal, its amount and its progress are read under the selected context, and this session holds no authority for it." reasonCode={result.denied.reasonCode} headingLevel={3} className={className} />;
  }
  if (result.kind === "unavailable") {
    // The source's own identity and retry guidance, never an outage worded over the arm that carries it.
    return (
      <StateNotice
        kind="unavailable"
        title="The support goal could not be read"
        description={result.unavailable.guidance}
        source={result.unavailable.source}
        retry={{
          label: "Read the goal again",
          onClick: async () => {
            await query.refetch();
          },
        }}
        headingLevel={3}
        className={className}
      />
    );
  }
  if (result.kind === "refused") {
    // The request this panel's own read made is not one the goal read admits: the refusal names the field
    // to correct, and no amount, revision or percentage is shown in place of either fact.
    return <StateNotice kind="refused" title="This goal's request was refused" headingLevel={3} className={className} />;
  }
  if (result.kind !== "envelope") {
    // A fourth arm added to the goal read's contract fails compilation here rather than rendering as a
    // goal, so no unstated arm can ever fall through to the amount and the progress below.
    return assertNever(result, "The goal read answered with an arm this panel does not render.");
  }
  const envelope = result.envelope;
  const { data, actions } = envelope;
  const goal = data.goal;
  const measureLabel = MEASURE_LABELS[data.measure];
  const editAction = actions.find((action) => action.name === GOAL_CAPABILITY);
  const canEdit = data.canEditGoal;
  const progress = progressPresentation(data.progress, goal, measureLabel, data.period.from, data.period.to);
  const showForm = canEdit && editing;
  return (
    <section aria-labelledby={titleId} dir={dir} className={cn("min-w-0", className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>{PANEL_TITLE}</h2>
          </CardTitle>
          <CardDescription>{PANEL_DESCRIPTION}</CardDescription>
          {canEdit && !showForm ? (
            <CardAction>
              <Button type="button" onClick={() => setEditing(true)}>
                {goal === null ? "Set a goal" : "Change the goal"}
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-6">
          {goal === null ? (
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-base font-medium">{EMPTY_STATES.goal.title}</p>
              <p className="text-sm text-pretty text-muted-foreground">{EMPTY_STATES.goal.body}</p>
            </div>
          ) : (
            <GoalFacts goal={goal} locale={locale} measureLabel={measureLabel} valueState={goalAmountStateOf(envelope)} />
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">Progress</h3>
            {progress.figure === null ? null : (
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="tabular-figures text-2xl font-semibold tracking-tight">
                  <bdi>{progress.figure}</bdi>
                </span>
                <span className="text-sm text-muted-foreground">of the goal</span>
              </p>
            )}
            <p className="text-sm text-pretty text-muted-foreground">{progress.sentence}</p>
          </div>
          <SnapshotStatement basis={SUPPORT_BASIS} currencies={[goal === null ? envelope.coverage.currency : goal.amount.currency]} period={{ from: data.period.from, to: data.period.to }} coverage={envelope.coverage} asOf={envelope.asOf} isCurrentPeriod={data.period.state === "in-progress"} locale={locale} />
          {canEdit ? null : <p className="text-sm text-pretty text-muted-foreground">{editAction?.reason ?? READ_ONLY_FALLBACK_REASON}</p>}
          {showForm ? (
            <>
              <Separator />
              <GoalForm
                envelope={envelope}
                locale={locale}
                onClose={() => {
                  setEditing(false);
                }}
                onCheckResult={() => {
                  void query.refetch();
                }}
              />
            </>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
export default GoalPanel;
