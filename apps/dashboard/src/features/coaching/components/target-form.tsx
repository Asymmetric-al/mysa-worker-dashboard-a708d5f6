"use client";
import { useForm } from "@tanstack/react-form";
import { useId, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { hasSettled } from "@/components/attempt";
import FormField, { fieldControlId, fieldErrorsFromInvalid, FormErrorSummary, type FieldErrorLookup } from "@/components/form-field";
import { Fact } from "@/components/fact";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SteppedNumberField } from "@/components/ui/number-field";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { DEFAULT_TARGET_PERIOD, TARGET_MEASURES, type TargetMeasure, type TargetState } from "@/modules/coaching/target";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { invalid, UNIDENTIFIED_ATTEMPT, type MutationOutcome } from "@/modules/data-service/outcome";
import { parseCivilDate, serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, MEASURE_COPY, PERIOD_COPY, TARGET_STATE_COPY, TARGET_VERSION_GUARANTEE, type PeriodKind } from "../copy";
import { useEditTarget, useEndTarget, usePauseTarget, useSaveTarget } from "../hooks/use-coaching";
import { targetEditPayloadSchema, targetSavePayloadSchema, type TargetEditPayload, type TargetSavePayload } from "../schemas";
import { Panel } from "./panel";
export type TargetView = { readonly targetId: string; readonly measure: TargetMeasure; readonly quantity: number; readonly period: PeriodKind; readonly calendarStart: CivilDate; readonly periodEnd: CivilDate | null; readonly privateLabel: string | null; readonly homePlacement: boolean; readonly state: TargetState };
export type TargetFormProps = { readonly target: TargetView | null; readonly scope: Scope; readonly expectedRevision: string; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly onSettled?: (outcome: MutationOutcome) => void; readonly onCheckResult?: () => void; readonly className?: string };
type TargetFormValues = { measure: TargetMeasure; quantity: string; period: PeriodKind; calendarStart: string; periodEnd: string; privateLabel: string; homePlacement: boolean };
/** The input one review step was given when it was submitted, kept per payload shape so the create, the edit and each lifecycle review stay type-safe. */ type SubmittedPlanInput =
  | { readonly kind: "create"; readonly input: Omit<MutationInput<TargetSavePayload>, "operationId"> }
  | { readonly kind: "edit"; readonly input: Omit<MutationInput<TargetEditPayload>, "operationId"> }
  | { readonly kind: "pause" | "end"; readonly input: Omit<MutationInput<{ readonly targetId: string }>, "operationId"> };
const MEASURE_FIELD = "measure";
const QUANTITY_FIELD = "quantity";
const PERIOD_FIELD = "period";
const CALENDAR_START_FIELD = "calendarStart";
const PERIOD_END_FIELD = "periodEnd";
const PRIVATE_LABEL_FIELD = "privateLabel";
const HOME_PLACEMENT_FIELD = "homePlacement";
const FIELD_LABELS: Readonly<Record<string, string>> = {
  [MEASURE_FIELD]: "Activity to track",
  [QUANTITY_FIELD]: "Target per period",
  [PERIOD_FIELD]: "Cadence",
  [CALENDAR_START_FIELD]: "Start date",
  [PERIOD_END_FIELD]: "End date",
  [PRIVATE_LABEL_FIELD]: "Private label",
  [HOME_PLACEMENT_FIELD]: "Show on Home",
};
type PlanTextField = { readonly name: typeof QUANTITY_FIELD | typeof CALENDAR_START_FIELD | typeof PERIOD_END_FIELD | typeof PRIVATE_LABEL_FIELD; readonly type: "number" | "date" | "text"; readonly description: string; readonly className: string };
const FIELD_ORDER = [MEASURE_FIELD, QUANTITY_FIELD, PERIOD_FIELD, CALENDAR_START_FIELD, PERIOD_END_FIELD, PRIVATE_LABEL_FIELD, HOME_PLACEMENT_FIELD] as const;
const PERIOD_KINDS: readonly PeriodKind[] = ["weekly", "monthly", "custom"];
const PLAN_HEADING = "Target settings";
const PLAN_PURPOSE = COACHING_COPY.targets.purpose;
const MEASURE_DESCRIPTION = "Tracks one activity type at a time based on what you log.";
const QUANTITY_DESCRIPTION = "Enter a positive whole number.";
const PERIOD_DESCRIPTION = "How often the count resets. Defaults to weekly.";
const HOME_PLACEMENT_DESCRIPTION = "Only changes what appears on your Home page — never shared with your coach and doesn’t create reminders.";
const QUANTITY_INPUT: PlanTextField = { name: QUANTITY_FIELD, type: "number", description: QUANTITY_DESCRIPTION, className: "w-full tabular-figures sm:max-w-40" };
const CALENDAR_START_INPUT: PlanTextField = { name: CALENDAR_START_FIELD, type: "date", description: "First calendar date of this custom period.", className: "w-full sm:max-w-60" };
const PERIOD_END_INPUT: PlanTextField = { name: PERIOD_END_FIELD, type: "date", description: "Last calendar date of this custom period (inclusive).", className: "w-full sm:max-w-60" };
const PRIVATE_LABEL_INPUT: PlanTextField = { name: PRIVATE_LABEL_FIELD, type: "text", description: "Only visible to you — never shared with your coach or included in exports.", className: "w-full sm:max-w-96" };
const isPeriodKind = (value: string): value is PeriodKind => PERIOD_KINDS.some((kind) => kind === value);
const isTargetMeasure = (value: string): value is TargetMeasure => TARGET_MEASURES.some((measure) => measure === value);
const WRITTEN_NUMBER = /^-?\d+(?:\.\d+)?$/u;
const quantityOf = (entry: string): number => (WRITTEN_NUMBER.test(entry.trim()) ? Number(entry.trim()) : Number.NaN);
const quantityTextOf = (quantity: number): string => (Number.isSafeInteger(quantity) && quantity > 0 ? String(quantity) : "not entered yet");
function initialValuesOf(target: TargetView | null): TargetFormValues {
  if (target === null) return { measure: TARGET_MEASURES[0], quantity: "", period: DEFAULT_TARGET_PERIOD.kind, calendarStart: "", periodEnd: "", privateLabel: "", homePlacement: false };
  return {
    measure: target.measure,
    quantity: String(target.quantity),
    period: target.period,
    calendarStart: target.period === "custom" ? serialiseCivilDate(target.calendarStart) : "",
    periodEnd: target.periodEnd === null ? "" : serialiseCivilDate(target.periodEnd),
    privateLabel: target.privateLabel ?? "",
    homePlacement: target.homePlacement,
  };
}
function planOf(values: TargetFormValues): TargetSavePayload {
  const custom = values.period === "custom";
  const start = values.calendarStart.trim();
  const end = values.periodEnd.trim();
  return { measure: values.measure, quantity: quantityOf(values.quantity), period: values.period, calendarStart: custom && start !== "" ? start : undefined, periodEnd: custom && end !== "" ? end : undefined, privateLabel: values.privateLabel.trim(), homePlacement: values.homePlacement };
}
const editPayloadOf = (targetId: string, plan: TargetSavePayload): TargetEditPayload => ({ targetId, ...plan });
function rangeIssueOf(values: TargetFormValues): readonly string[] {
  if (values.period !== "custom") return [];
  const start = parseCivilDate(values.calendarStart.trim());
  const end = parseCivilDate(values.periodEnd.trim());
  if (start.status !== "parsed" || end.status !== "parsed") return [];
  return end.date.until(start.date).sign > 0 ? ["End date must be on or after start date."] : [];
}
function refusalOf(values: TargetFormValues, target: TargetView | null): FieldErrorLookup | null {
  const plan = planOf(values);
  const checked = target === null ? targetSavePayloadSchema.safeParse(plan) : targetEditPayloadSchema.safeParse(editPayloadOf(target.targetId, plan));
  const lookup = checked.success ? null : fieldErrorsFromInvalid(invalid({ operationId: UNIDENTIFIED_ATTEMPT, fields: checked.error }));
  const range = rangeIssueOf(values);
  if (range.length === 0) return lookup;
  const byField: Record<string, readonly string[]> = { ...lookup?.byField, [PERIOD_END_FIELD]: [...(lookup?.byField[PERIOD_END_FIELD] ?? []), ...range] };
  const form = lookup?.form ?? [];
  return { byField, form, count: Object.keys(byField).length + form.length };
}
function focusFirstRefused(lookup: FieldErrorLookup): void {
  const first = FIELD_ORDER.find((field) => (lookup.byField[field] ?? []).length > 0);
  if (first === undefined) return;
  document.getElementById(fieldControlId(first))?.focus();
}
function planSentence(plan: TargetSavePayload): string {
  const counted = `${quantityTextOf(plan.quantity)} ${MEASURE_COPY[plan.measure].label.toLowerCase()}`;
  switch (plan.period) {
    case "weekly":
      return `${counted} a week`;
    case "monthly":
      return `${counted} a month`;
    case "custom": {
      const from = plan.calendarStart?.trim() ?? "";
      const to = plan.periodEnd?.trim() ?? "";
      const range = from === "" || to === "" ? "over a custom period (enter both dates)" : `from ${from} to ${to}`;
      return `${counted} ${range}`;
    }
  }
}
const heldPlanOf = (target: TargetView): TargetSavePayload => ({
  measure: target.measure,
  quantity: target.quantity,
  period: target.period,
  calendarStart: target.period === "custom" ? serialiseCivilDate(target.calendarStart) : undefined,
  periodEnd: target.periodEnd === null ? undefined : serialiseCivilDate(target.periodEnd),
  privateLabel: target.privateLabel ?? "",
  homePlacement: target.homePlacement,
});
function privateLabelText(label: string | null): string {
  const stated = label?.trim() ?? "";
  return stated === "" ? "None" : stated;
}
const placementText = (placed: boolean): string => (placed ? "Shown on Home" : "Not shown on Home");
const REVIEWING_NOTE = "Review your target below before saving. Changing any field updates the preview — nothing is saved until you confirm.";
const PAUSED_PAUSE_REASON = "Already paused. Your past periods stay recorded.";
const ENDED_PAUSE_REASON = "Ended targets can’t be paused. Your history remains intact.";
const END_ALREADY_ENDED_REASON = "Already ended. All past periods and versions stay intact.";
type LifecycleAction = { readonly key: "pause" | "end"; readonly title: string; readonly description: string; readonly consequence: string; readonly confirmLabel: string };
/** The two lifecycle changes this form offers, each with the words it states and the payload it sends, so the review and the held control beside it are written once. */ const LIFECYCLE_ACTIONS: readonly LifecycleAction[] = [
  { key: "pause", title: "Pause target", description: TARGET_STATE_COPY.paused.description, consequence: "Stops tracking new progress without deleting your activity history or sending any notification.", confirmLabel: "Pause target" },
  { key: "end", title: "End target", description: TARGET_STATE_COPY.ended.description, consequence: "Closes this target permanently so it can no longer be edited. Activity history stays intact and nothing is sent.", confirmLabel: "End target" },
];
const heldReasonOf = (action: LifecycleAction["key"], state: TargetState): string | null => (action === "pause" ? (state === "paused" ? PAUSED_PAUSE_REASON : state === "ended" ? ENDED_PAUSE_REASON : null) : state === "ended" ? END_ALREADY_ENDED_REASON : null);
const labelOf = (field: string): string => FIELD_LABELS[field] ?? "";
type SelectFieldProps<T extends string> = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly error: readonly string[] | undefined;
  readonly value: T;
  readonly narrow: (value: string) => value is T;
  readonly onChange: (next: T) => void;
  readonly onBlur: () => void;
  readonly children: ReactNode;
};
function SelectField<T extends string>({ name, label, description, error, value, narrow, onChange, onBlur, children }: SelectFieldProps<T>): ReactElement {
  return (
    <FormField name={name} label={label} description={description} error={error} required>
      {(control) => (
        <NativeSelect
          id={control.id}
          name={name}
          className="w-full sm:max-w-72"
          value={value}
          aria-describedby={control.describedBy}
          aria-invalid={control.invalid ? true : undefined}
          aria-required={control.required ? true : undefined}
          onChange={(event) => {
            if (narrow(event.currentTarget.value)) onChange(event.currentTarget.value);
          }}
          onBlur={onBlur}
        >
          {children}
        </NativeSelect>
      )}
    </FormField>
  );
}
type InputFieldProps = { readonly name: string; readonly label: string; readonly description: string; readonly error: readonly string[] | undefined; readonly type: "number" | "date" | "text"; readonly className: string; readonly value: string; readonly onChange: (next: string) => void; readonly onBlur: () => void };
const InputField = ({ name, label, description, error, type, className, value, onChange, onBlur }: InputFieldProps): ReactElement => (
  <FormField name={name} label={label} description={description} error={error} required>
    {(control) =>
      type === "number" ? (
        <SteppedNumberField
          id={control.id}
          name={name}
          min={1}
          step={1}
          required={control.required}
          value={value}
          aria-describedby={control.describedBy}
          aria-invalid={control.invalid ? true : undefined}
          aria-required={control.required ? true : undefined}
          decrementLabel={`Decrease ${label.toLowerCase()}`}
          incrementLabel={`Increase ${label.toLowerCase()}`}
          onValueChange={onChange}
          onBlur={onBlur}
          className={className}
        />
      ) : (
        <Input
          id={control.id}
          name={name}
          type={type}
          autoComplete={type === "date" ? undefined : "off"}
          className={className}
          required={control.required}
          value={value}
          aria-describedby={control.describedBy}
          aria-invalid={control.invalid ? true : undefined}
          aria-required={control.required ? true : undefined}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={onBlur}
        />
      )
    }
  </FormField>
);
const CivilDateText = ({ value }: { readonly value: string | undefined }): ReactElement => ((value ?? "").trim() === "" ? <span className="text-muted-foreground">not entered yet</span> : <bdi className="wrap-anywhere">{(value ?? "").trim()}</bdi>);
function StateStatement({ state }: { readonly state: TargetState }): ReactElement {
  const copy = TARGET_STATE_COPY[state];
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Badge variant={state === "active" ? "secondary" : "outline"}>{copy.label}</Badge>
      <p className="type-supporting text-pretty">{copy.description}</p>
      {state === "paused" || state === "ended" ? <p className="type-supporting text-pretty">{"Past periods keep the target version they were measured against, and no logged activities are deleted."}</p> : null}
    </div>
  );
}
type PlanRow = { readonly term: string; readonly value: ReactNode };
const PlanNote = ({ text, suffix }: { readonly text: string; readonly suffix: string }): ReactElement => (
  <>
    {text} <span className="text-muted-foreground">{suffix}</span>
  </>
);
const PlanUnit = ({ figure, unit }: { readonly figure: ReactNode; readonly unit: string }): ReactElement => (
  <>
    {figure} {unit}
  </>
);
const PlanRows = ({ className, rows }: { readonly className: string; readonly rows: readonly PlanRow[] }): ReactElement => (
  <dl className={className}>
    {rows.map((row) => (
      <Fact key={row.term} term={row.term} termClassName="font-medium" detailClassName="min-w-0 text-pretty">
        {row.value}
      </Fact>
    ))}
  </dl>
);
const PLAN_ROWS_CLASS = "flex min-w-0 flex-col gap-3 text-sm";
const privateRow = (label: string | null): PlanRow => ({ term: labelOf(PRIVATE_LABEL_FIELD), value: <PlanNote text={privateLabelText(label)} suffix={"— private to you"} /> });
const placementRow = (placed: boolean): PlanRow => ({ term: labelOf(HOME_PLACEMENT_FIELD), value: <PlanNote text={placementText(placed)} suffix={"— only affects your Home page"} /> });
const planFactsRowsOf = (target: TargetView): readonly PlanRow[] => {
  const plan = heldPlanOf(target);
  return [
    { term: labelOf(MEASURE_FIELD), value: MEASURE_COPY[plan.measure].label },
    { term: labelOf(QUANTITY_FIELD), value: <PlanUnit figure={<bdi className="tabular-figures">{String(plan.quantity)}</bdi>} unit="in each period" /> },
    { term: labelOf(PERIOD_FIELD), value: PERIOD_COPY[plan.period].label },
    { term: "Starts on", value: <CivilDateText value={serialiseCivilDate(target.calendarStart)} /> },
    ...(target.period === "custom" ? [{ term: labelOf(PERIOD_END_FIELD), value: <CivilDateText value={plan.periodEnd} /> }] : []),
    privateRow(target.privateLabel),
    placementRow(target.homePlacement),
  ];
};
const planSummaryRowsOf = (plan: TargetSavePayload): readonly PlanRow[] => [
  { term: labelOf(MEASURE_FIELD), value: MEASURE_COPY[plan.measure].label },
  { term: labelOf(QUANTITY_FIELD), value: `${quantityTextOf(plan.quantity)} in each period` },
  { term: labelOf(PERIOD_FIELD), value: PERIOD_COPY[plan.period].label },
  ...(plan.period === "custom"
    ? [
        { term: labelOf(CALENDAR_START_FIELD), value: <CivilDateText value={plan.calendarStart} /> },
        { term: labelOf(PERIOD_END_FIELD), value: <CivilDateText value={plan.periodEnd} /> },
      ]
    : []),
  privateRow(plan.privateLabel),
  placementRow(plan.homePlacement),
];
const comparisonRowsOf = (plan: TargetSavePayload, target: TargetView): readonly PlanRow[] => [{ term: "Current target", value: planSentence(heldPlanOf(target)) }, { term: "Updated target", value: planSentence(plan) }, privateRow(plan.privateLabel), placementRow(plan.homePlacement)];
const PlanFacts = ({ target }: { readonly target: TargetView }): ReactElement => <PlanRows className={"grid min-w-0 gap-3 text-sm"} rows={planFactsRowsOf(target)} />;
const PlanSummary = ({ plan }: { readonly plan: TargetSavePayload }): ReactElement => <PlanRows className={PLAN_ROWS_CLASS} rows={planSummaryRowsOf(plan)} />;
const PlanComparison = ({ plan, target }: { readonly plan: TargetSavePayload; readonly target: TargetView }): ReactElement => <PlanRows className={PLAN_ROWS_CLASS} rows={comparisonRowsOf(plan, target)} />;
const HeldAction = ({ label, reason, descriptionId }: { readonly label: string; readonly reason: string; readonly descriptionId: string }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <Button {...{ type: "button", variant: "outline", disabled: true, "aria-describedby": descriptionId, className: "min-h-target w-fit max-w-full whitespace-normal" }}>{label}</Button>
    <p {...{ id: descriptionId, className: "type-supporting text-pretty" }}>{reason}</p>
  </div>
);
export default function TargetForm({ target, scope, expectedRevision, locale, dir, onSettled, onCheckResult, className }: TargetFormProps): ReactElement {
  const [headingId, planHeadingId, lifecycleHeadingId, reviewNoteId, pauseReasonId, endReasonId] = [useId(), useId(), useId(), useId(), useId(), useId()];
  const [startingValues] = useState<TargetFormValues>(() => initialValuesOf(target));
  const form = useForm({ defaultValues: startingValues });
  const [refusal, setRefusal] = useState<FieldErrorLookup | null>(null);
  const [planOutcome, setPlanOutcome] = useState<MutationOutcome | null>(null);
  const [submittedPlan, setSubmittedPlan] = useState<SubmittedPlanInput | null>(null);
  const [lifecycleSettlement, setLifecycleSettlement] = useState<{ readonly key: LifecycleAction["key"]; readonly outcome: MutationOutcome } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const saveTarget = useSaveTarget();
  const editTarget = useEditTarget();
  const pauseTarget = usePauseTarget();
  const endTarget = useEndTarget();
  const busy = saveTarget.isPending || editTarget.isPending || pauseTarget.isPending || endTarget.isPending;
  const lifecycleSubmits: Readonly<Record<LifecycleAction["key"], MutationSubmit<{ readonly targetId: string }>>> = { pause: pauseTarget.mutateAsync, end: endTarget.mutateAsync };
  // A pause or an end re-reads the target into the state its own success produced, so the review that reported it is held on the input it submitted until that result stops standing: the receipt it announces and the focus stop it carries are not unmounted by the re-read.
  const lifecycleSubmit =
    (key: LifecycleAction["key"]): MutationSubmit<{ readonly targetId: string }> =>
    async (attempt: MutationInput<{ readonly targetId: string }>): Promise<MutationOutcome> => {
      setSubmittedPlan({ kind: key, input: { scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload } });
      return lifecycleSubmits[key](attempt);
    };
  const settleLifecycle =
    (key: LifecycleAction["key"]) =>
    (outcome: MutationOutcome): void => {
      setLifecycleSettlement(hasSettled(outcome) ? { key, outcome } : null);
      onSettled?.(outcome);
    };
  // An accepted save advances the revision the surface re-reads, so the plan review is held on the input it actually submitted while that result stands: the receipt it announces is not unmounted by its own success.
  const savePlan = async (attempt: MutationInput<TargetSavePayload>): Promise<MutationOutcome> => {
    setSubmittedPlan({ kind: "create", input: { scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload } });
    return saveTarget.mutateAsync(attempt);
  };
  const editPlan = async (attempt: MutationInput<TargetEditPayload>): Promise<MutationOutcome> => {
    setSubmittedPlan({ kind: "edit", input: { scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload } });
    return editTarget.mutateAsync(attempt);
  };
  const settlePlan = (outcome: MutationOutcome): void => {
    setPlanOutcome(outcome);
    onSettled?.(outcome);
  };
  const clearOnEdit = (): void => {
    setRefusal(null);
    setPlanOutcome(null);
  };
  const fieldEdit =
    <T,>(field: { handleChange: (next: T) => void }) =>
    (next: T): void => {
      field.handleChange(next);
      clearOnEdit();
    };
  const reviewThePlan = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy) return;
    const refused = refusalOf(form.state.values, target);
    if (refused !== null && refused.count > 0) {
      setRefusal(refused);
      setPlanOutcome(null);
      setReviewing(false);
      focusFirstRefused(refused);
      return;
    }
    setRefusal(null);
    setReviewing(true);
  };
  const creating = target === null;
  const ended = target !== null && target.state === "ended";
  const serverErrors = planOutcome !== null && planOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(planOutcome) : null;
  // A settled outcome holds its review step on the submitted input; a field edit clears the outcome, which releases the pin so the next change presents the revision it was read at.
  const settledPlanInput = hasSettled(planOutcome) ? submittedPlan : null;
  // A lifecycle settlement stands only for the action it belongs to and only while it holds: that is the one case where the held statement waits, so the review that reported the change keeps its receipt on screen.
  const settledLifecycleInput = (key: LifecycleAction["key"]): Omit<MutationInput<{ readonly targetId: string }>, "operationId"> | null => {
    if (lifecycleSettlement === null || lifecycleSettlement.key !== key || !hasSettled(lifecycleSettlement.outcome)) return null;
    const submitted = submittedPlan;
    return submitted !== null && submitted.kind !== "create" && submitted.kind !== "edit" && submitted.kind === key ? submitted.input : null;
  };
  const errors = refusal ?? serverErrors;
  const textField = (spec: PlanTextField): ReactElement => (
    <form.Field name={spec.name}>{(field) => <InputField name={spec.name} label={labelOf(spec.name)} description={spec.description} error={errors?.byField[spec.name]} type={spec.type} className={spec.className} value={field.state.value} onChange={fieldEdit(field)} onBlur={field.handleBlur} />}</form.Field>
  );
  const planFields = (values: TargetFormValues): ReactElement => (
    <>
      <form.Field name={MEASURE_FIELD}>
        {(field) => (
          <SelectField name={MEASURE_FIELD} label={labelOf(MEASURE_FIELD)} description={`${MEASURE_COPY[field.state.value].hint} ${MEASURE_DESCRIPTION}`} error={errors?.byField[MEASURE_FIELD]} value={field.state.value} narrow={isTargetMeasure} onChange={fieldEdit(field)} onBlur={field.handleBlur}>
            {TARGET_MEASURES.map((measure) => (
              <NativeSelectOption key={measure} value={measure}>
                {MEASURE_COPY[measure].label}
              </NativeSelectOption>
            ))}
          </SelectField>
        )}
      </form.Field>
      {textField(QUANTITY_INPUT)}
      <form.Field name={PERIOD_FIELD}>
        {(field) => (
          <SelectField name={PERIOD_FIELD} label={labelOf(PERIOD_FIELD)} description={`${PERIOD_DESCRIPTION} ${PERIOD_COPY[field.state.value].description}`} error={errors?.byField[PERIOD_FIELD]} value={field.state.value} narrow={isPeriodKind} onChange={fieldEdit(field)} onBlur={field.handleBlur}>
            {PERIOD_KINDS.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {PERIOD_COPY[kind].label}
              </NativeSelectOption>
            ))}
          </SelectField>
        )}
      </form.Field>
      {values.period === "custom" ? (
        <>
          {textField(CALENDAR_START_INPUT)}
          {textField(PERIOD_END_INPUT)}
        </>
      ) : (
        <p className="type-supporting text-pretty">{"Weekly and monthly targets start on the day you save them. Custom periods require start and end dates."}</p>
      )}
      {textField(PRIVATE_LABEL_INPUT)}
      <form.Field name={HOME_PLACEMENT_FIELD}>
        {(field) => (
          <FormField name={HOME_PLACEMENT_FIELD} label={labelOf(HOME_PLACEMENT_FIELD)} description={HOME_PLACEMENT_DESCRIPTION} error={errors?.byField[HOME_PLACEMENT_FIELD]}>
            {(control) => (
              <div className="flex min-h-target flex-wrap items-center gap-3">
                {/* Base UI keeps its own element id on the switch and puts the field id on its hidden input, so the accessible name is stated here rather than left to the label's `for`. */}
                <Switch id={control.id} checked={field.state.value} aria-label={labelOf(HOME_PLACEMENT_FIELD)} aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} onCheckedChange={fieldEdit(field)} />
                <span className="text-sm text-muted-foreground">{placementText(field.state.value)}</span>
              </div>
            )}
          </FormField>
        )}
      </form.Field>
    </>
  );
  return (
    <section id="target-form" dir={dir} aria-labelledby={headingId} aria-busy={busy ? true : undefined} data-slot="target-form" data-interface-locale={locale} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 {...{ id: headingId, className: "type-section-title" }}>{creating ? "Set a target" : "Edit target"}</h2>
        <p className="type-supporting text-pretty">{PLAN_PURPOSE}</p>
        <p className="type-supporting text-pretty">{"Your personal rhythm — a period with zero logged activities doesn’t judge effort or create an obligation. Your coach only sees targets if you turn on the Targets module."}</p>
      </div>
      {target === null ? null : <StateStatement state={target.state} />}
      {ended && target !== null ? (
        <Panel titleId={planHeadingId} headingLevel={3} title={PLAN_HEADING} description="This target has ended and can no longer be edited." cardClassName="min-w-0">
          <PlanFacts target={target} />
        </Panel>
      ) : (
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const plan = planOf(values);
            return (
              <>
                <Panel titleId={planHeadingId} headingLevel={3} title={PLAN_HEADING} cardClassName="min-w-0">
                  <form noValidate onSubmit={reviewThePlan} aria-busy={busy ? true : undefined} className="flex min-w-0 flex-col gap-5">
                    {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={4} />}
                    {planFields(values)}
                    <Separator />
                    <p className="type-supporting text-pretty">{TARGET_VERSION_GUARANTEE}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button {...{ type: "submit", disabled: busy, "aria-describedby": reviewNoteId, className: "min-h-target max-w-full whitespace-normal" }}>{creating ? "Review & save" : "Review changes"}</Button>
                    </div>
                    <p {...{ id: reviewNoteId, className: "type-supporting text-pretty" }}>{reviewing ? REVIEWING_NOTE : "Nothing is saved until you confirm below."}</p>
                  </form>
                </Panel>
                {reviewing && target === null ? (
                  <ActionReview<TargetSavePayload>
                    title="Confirm new target"
                    description={<PlanSummary plan={plan} />}
                    consequence={<p className="type-supporting">{"Saves this target. Tracks only activities you log, creates no reminders, and stays private unless you share the Targets module."}</p>}
                    confirmLabel="Save target"
                    input={settledPlanInput?.kind === "create" ? settledPlanInput.input : { scope, expectedRevision, payload: plan }}
                    submit={savePlan}
                    onSettled={settlePlan}
                    checkResult={onCheckResult}
                    fieldLabels={FIELD_LABELS}
                    headingLevel={3}
                  />
                ) : null}
                {reviewing && target !== null ? (
                  <ActionReview<TargetEditPayload>
                    title="Confirm target changes"
                    description={<PlanComparison plan={plan} target={target} />}
                    consequence={<p className="type-supporting">{TARGET_VERSION_GUARANTEE}</p>}
                    confirmLabel="Save changes"
                    input={settledPlanInput?.kind === "edit" ? settledPlanInput.input : { scope, expectedRevision, payload: editPayloadOf(target.targetId, plan) }}
                    submit={editPlan}
                    onSettled={settlePlan}
                    checkResult={onCheckResult}
                    fieldLabels={FIELD_LABELS}
                    headingLevel={3}
                  />
                ) : null}
              </>
            );
          }}
        </form.Subscribe>
      )}
      {target === null ? null : (
        <section aria-labelledby={lifecycleHeadingId} className="flex min-w-0 flex-col gap-3">
          <h3 {...{ id: lifecycleHeadingId, className: "type-subsection-title" }}>{"Pause or end target"}</h3>
          <p className="type-supporting text-pretty">{"Pausing stops tracking progress; ending closes the target permanently. Neither deletes your logged activities."}</p>
          {LIFECYCLE_ACTIONS.map((action) => {
            const held = heldReasonOf(action.key, target.state);
            const submitted = settledLifecycleInput(action.key);
            return held === null || submitted !== null ? (
              <ActionReview<{ readonly targetId: string }>
                key={action.key}
                title={action.title}
                description={<p className="type-supporting">{action.description}</p>}
                consequence={<p className="type-supporting">{action.consequence}</p>}
                confirmLabel={action.confirmLabel}
                consequential
                input={submitted ?? { scope, expectedRevision, payload: { targetId: target.targetId } }}
                submit={lifecycleSubmit(action.key)}
                onSettled={settleLifecycle(action.key)}
                checkResult={onCheckResult}
                headingLevel={4}
              />
            ) : (
              <HeldAction key={action.key} label={action.confirmLabel} reason={held} descriptionId={action.key === "pause" ? pauseReasonId : endReasonId} />
            );
          })}
        </section>
      )}
    </section>
  );
}
