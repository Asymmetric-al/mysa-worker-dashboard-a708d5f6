"use client";
/**
 * The worker's one target composer and lifecycle control: the four canonical measures — calls made, personal
 * messages, conversations and meetings held — over a Weekly period (the default), a Monthly one or a one-off Custom
 * period, with the worker's own private label and the optional Home placement.
 *
 * It submits exactly four named changes, each through the shared review step: save (`saveTarget`), edit
 * (`editTarget`, which opens a prospective version), pause (`pauseTarget`, which stops future counting and keeps the
 * history) and end (`endTarget`, which closes the target for good). Every attempt answers with one of the closed eight
 * outcomes — accepted, alreadyAccepted, unchanged, conflict, denied, invalid, unavailable or unknown — rendered in that
 * action's own receipt with the entered values kept beside it. The receipt is the one `ActionReview` composes, so no
 * second receipt is built here.
 *
 * A change to the quantity, the measure or the calendar start begins a new version from the day it takes effect, so a
 * period that has already closed keeps the version it was measured against: no two versions cover the same day, and no
 * period is split into a prorated bridge.
 */
import { useForm } from "@tanstack/react-form";
import { useId, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import type { ZodError } from "zod";
import ActionReview from "@/components/action-review";
import FormField, { fieldControlId, fieldErrorsFromInvalid, FormErrorSummary, type FieldErrorLookup } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { DEFAULT_TARGET_PERIOD, TARGET_MEASURES, type TargetMeasure, type TargetState } from "@/modules/coaching/target";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { parseCivilDate, serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, MEASURE_COPY, PERIOD_COPY, TARGET_STATE_COPY, TARGET_VERSION_GUARANTEE, type PeriodKind } from "../copy";
import { useEditTarget, useEndTarget, usePauseTarget, useSaveTarget } from "../hooks/use-coaching-mutations";
import { targetEditPayloadSchema, targetSavePayloadSchema, type TargetEditPayload, type TargetEndPayload, type TargetPausePayload, type TargetSavePayload } from "../schemas/target";

/**
 * One target as the worker's own surface reads it: the plan in force, its private label, whether Home lists it, and the
 * state the read resolved for it. `periodEnd` carries the last day of a one-off period and is `null` for a weekly or
 * monthly one, which has no end.
 */
export interface TargetView {
  readonly targetId: string;
  readonly measure: TargetMeasure;
  readonly quantity: number;
  readonly period: PeriodKind;
  readonly calendarStart: CivilDate;
  readonly periodEnd: CivilDate | null;
  readonly privateLabel: string | null;
  readonly homePlacement: boolean;
  readonly state: TargetState;
}

/** Props of {@link TargetForm}. */
export interface TargetFormProps {
  /** The target being changed, or `null` where no target is set yet — the create case. */
  readonly target: TargetView | null;
  /** The context this form acts in, forwarded to all four changes exactly as it was read. */
  readonly scope: Scope;
  /** The revision the read stated, forwarded as the revision every change expects to find. */
  readonly expectedRevision: string;
  /** The interface locale; it labels the region and never reforms a civil date, which is always written `YYYY-MM-DD`. */
  readonly locale: string;
  /** The display direction the route composition states; it is set on this block only, never on a child's styles. */
  readonly dir?: "ltr" | "rtl";
  /** Called with the outcome of every settled attempt, so the composing route can re-read the target and its history. */
  readonly onSettled?: (outcome: MutationOutcome) => void;
  /** Re-reads the target, offered as the one recovery step of an unconfirmed attempt. */
  readonly onCheckResult?: () => void;
  readonly className?: string;
}

/** The values the form holds while the worker is writing: every entry is a string, so no value is coerced before it is validated. */
interface TargetFormValues {
  measure: TargetMeasure;
  quantity: string;
  period: PeriodKind;
  calendarStart: string;
  periodEnd: string;
  privateLabel: string;
  homePlacement: boolean;
}

const MEASURE_FIELD = "measure";
const QUANTITY_FIELD = "quantity";
const PERIOD_FIELD = "period";
const CALENDAR_START_FIELD = "calendarStart";
const PERIOD_END_FIELD = "periodEnd";
const PRIVATE_LABEL_FIELD = "privateLabel";
const HOME_PLACEMENT_FIELD = "homePlacement";

const FIELD_LABELS: Readonly<Record<string, string>> = {
  [MEASURE_FIELD]: "What to count",
  [QUANTITY_FIELD]: "How many in each period",
  [PERIOD_FIELD]: "Period",
  [CALENDAR_START_FIELD]: "First day",
  [PERIOD_END_FIELD]: "Last day",
  [PRIVATE_LABEL_FIELD]: "Your name for this target",
  [HOME_PLACEMENT_FIELD]: "Show it on Home",
};

/** The order a refusal is summarised and focused in: the order the fields appear. */
const FIELD_ORDER = [MEASURE_FIELD, QUANTITY_FIELD, PERIOD_FIELD, CALENDAR_START_FIELD, PERIOD_END_FIELD, PRIVATE_LABEL_FIELD, HOME_PLACEMENT_FIELD] as const;

/** The three period shapes, in the order the selector offers them: the Weekly period a new target uses comes first. */
const PERIOD_KINDS: readonly PeriodKind[] = ["weekly", "monthly", "custom"];

const CREATE_HEADING = "Set a target";
const EDIT_HEADING = "Change this target";
const PLAN_HEADING = "The plan";
const LIFECYCLE_HEADING = "Pause or end this target";
const PLAN_PURPOSE = COACHING_COPY.targets.purpose;

const MEASURE_DESCRIPTION_PREFIX = "A target counts one measure at a time, and nothing is counted that you have not recorded as an activity.";
const QUANTITY_DESCRIPTION = "A positive whole number of the measure you chose. A zero, a negative number, a fraction or an empty entry is refused with the reason rather than turned into a number you did not type.";
const PERIOD_DESCRIPTION = "The stretch of time each count is compared over. A new target uses the weekly period.";
const CUSTOM_START_DESCRIPTION = "The first day of the one-off period, as a calendar day with no time of day behind it. An empty first day is refused rather than filled in with today's date.";
const CUSTOM_END_DESCRIPTION = "The last day of the one-off period, inclusive. An empty last day is refused rather than filled in with today's date.";
const NO_CUSTOM_DATES_NOTE = "A weekly or monthly period starts on the calendar day the target is recorded, so this form asks for no start date for it. A one-off period asks for both of its dates.";
const PRIVATE_LABEL_DESCRIPTION = "A name only you see. It is never disclosed to a coach, never exported and never part of what a coach can read; choosing one changes nothing about what is counted.";
const HOME_PLACEMENT_DESCRIPTION = "Placement changes only what you see on Home. It creates no commitment, no reminder and no notification, and no coach can read it. The target counts the same whether it is placed or not.";
const TARGET_MEANING = "A target is your own plan. A period with nothing recorded states a count of zero and says nothing about the effort you made at it, and it creates no commitment to anyone. Only the modules you switch on are ever readable by a coach.";
const PAUSE_HISTORY_NOTE = "Pausing and ending both keep the history: the periods that have already closed keep the version they were measured against, and no activity record is deleted.";
const REVIEW_NOTE = "Nothing is saved until you confirm it in the next step, and confirming applies this one change once.";
const RANGE_MESSAGE = "The last day of a one-off period must be on or after its first day.";

/** The three period shapes as a type test, so a select's string value narrows without a cast. */
function isPeriodKind(value: string): value is PeriodKind {
  return PERIOD_KINDS.some((kind) => kind === value);
}

/** The four canonical measures as a type test, so a select's string value narrows without a cast. */
function isTargetMeasure(value: string): value is TargetMeasure {
  return TARGET_MEASURES.some((measure) => measure === value);
}

/**
 * The quantity as the schema reads it. Only a written number reaches it: anything else — an empty entry, a word, a
 * trailing separator — arrives as `NaN`, which the schema refuses rather than this form picking a number for it.
 */
const WRITTEN_NUMBER = /^-?\d+(?:\.\d+)?$/u;

function quantityOf(entry: string): number {
  const stated = entry.trim();
  return WRITTEN_NUMBER.test(stated) ? Number(stated) : Number.NaN;
}

/** A quantity as a sentence states it, and the honest wording while the entry is not yet a positive whole number. */
function quantityTextOf(quantity: number): string {
  return Number.isSafeInteger(quantity) && quantity > 0 ? String(quantity) : "a whole number you have not entered yet";
}

/** The values a target starts from: the plan it holds now, or an empty plan for a target that does not exist yet. */
function initialValuesOf(target: TargetView | null): TargetFormValues {
  if (target === null) {
    return { measure: TARGET_MEASURES[0], quantity: "", period: DEFAULT_TARGET_PERIOD.kind, calendarStart: "", periodEnd: "", privateLabel: "", homePlacement: false };
  }
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

/**
 * The plan the entries describe, as the save change states it. Only a one-off period carries the two dates it runs
 * between; a weekly or monthly period leaves them out so the recorded calendar stands rather than being restated.
 */
function planOf(values: TargetFormValues): TargetSavePayload {
  const custom = values.period === "custom";
  const start = values.calendarStart.trim();
  const end = values.periodEnd.trim();
  return { measure: values.measure, quantity: quantityOf(values.quantity), period: values.period, calendarStart: custom && start !== "" ? start : undefined, periodEnd: custom && end !== "" ? end : undefined, privateLabel: values.privateLabel.trim(), homePlacement: values.homePlacement };
}

/** The same plan as a change to a target that already exists. */
function editPayloadOf(targetId: string, plan: TargetSavePayload): TargetEditPayload {
  return { targetId, ...plan };
}

/** The per-field messages a refused schema names, keyed the way a field expects them. */
function fieldMessagesOf(error: ZodError): Readonly<Record<string, readonly string[]>> {
  const messages: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "" : issue.path.map((step) => String(step)).join(".");
    const existing = messages[path];
    if (existing === undefined) {
      messages[path] = [issue.message];
    } else if (!existing.includes(issue.message)) {
      existing.push(issue.message);
    }
  }
  return messages;
}

function fieldLookupOf(error: ZodError): FieldErrorLookup {
  return fieldErrorsFromInvalid({ fields: fieldMessagesOf(error) });
}

/**
 * The one date rule this form states against a field rather than at the form: a one-off period cannot end before it
 * starts. The service states the same rule, and naming it here means the refusal lands on the field that breaks it.
 */
function rangeIssueOf(values: TargetFormValues): readonly string[] {
  if (values.period !== "custom") {
    return [];
  }
  const start = parseCivilDate(values.calendarStart.trim());
  const end = parseCivilDate(values.periodEnd.trim());
  if (start.status !== "parsed" || end.status !== "parsed") {
    return [];
  }
  return end.date.until(start.date).sign > 0 ? [RANGE_MESSAGE] : [];
}

/** Every message the entries earn before anything is sent, or `null` where they earn none. */
function refusalOf(values: TargetFormValues, target: TargetView | null): FieldErrorLookup | null {
  const plan = planOf(values);
  const checked = target === null ? targetSavePayloadSchema.safeParse(plan) : targetEditPayloadSchema.safeParse(editPayloadOf(target.targetId, plan));
  const lookup = checked.success ? null : fieldLookupOf(checked.error);
  const range = rangeIssueOf(values);
  if (range.length === 0) {
    return lookup;
  }
  const byField: Record<string, readonly string[]> = { ...lookup?.byField, [PERIOD_END_FIELD]: [...(lookup?.byField[PERIOD_END_FIELD] ?? []), ...range] };
  const form = lookup?.form ?? [];
  return { byField, form, count: Object.keys(byField).length + form.length };
}

/** Puts the keyboard position on the first field a refusal names, so a corrected entry starts where the problem is. */
function focusFirstRefused(lookup: FieldErrorLookup): void {
  const first = FIELD_ORDER.find((field) => (lookup.byField[field] ?? []).length > 0);
  if (first === undefined) {
    return;
  }
  document.getElementById(fieldControlId(first))?.focus();
}

/** The plan as one sentence: what is counted, how much of it, and over which stretch of time. */
function planSentence(plan: TargetSavePayload): string {
  const noun = MEASURE_COPY[plan.measure].label.toLowerCase();
  const counted = `${quantityTextOf(plan.quantity)} ${noun}`;
  switch (plan.period) {
    case "weekly":
      return `${counted} a week`;
    case "monthly":
      return `${counted} a month`;
    case "custom": {
      const from = plan.calendarStart?.trim() ?? "";
      const to = plan.periodEnd?.trim() ?? "";
      const range = from === "" || to === "" ? "over a one-off period whose two dates are not both entered yet" : `over the one-off period from ${from} to ${to}`;
      return `${counted} ${range}`;
    }
  }
}

/** The plan a target holds now, stated the same way the entries are, so the two can be read against each other. */
function heldPlanOf(target: TargetView): TargetSavePayload {
  return {
    measure: target.measure,
    quantity: target.quantity,
    period: target.period,
    calendarStart: target.period === "custom" ? serialiseCivilDate(target.calendarStart) : undefined,
    periodEnd: target.periodEnd === null ? undefined : serialiseCivilDate(target.periodEnd),
    privateLabel: target.privateLabel ?? "",
    homePlacement: target.homePlacement,
  };
}

function privateLabelText(label: string | null): string {
  const stated = label?.trim() ?? "";
  return stated === "" ? "No name chosen yet" : stated;
}

function placementText(placed: boolean): string {
  return placed ? "Shown on Home" : "Not shown on Home";
}

const LIFECYCLE_NOTE = "Pausing and ending are separate changes with different effects. Pausing stops the target admitting recorded progress; ending closes it for good. Neither deletes an activity record, sends a notice or creates a task.";

const ENDED_PLAN_NOTE = "This target has ended, so its plan is shown here rather than offered for change: a change to an ended target is refused instead of applied.";

const REVIEWING_NOTE = "The plan above is ready to review. Changing an entry begins the review again with the new entries, and nothing is sent until you confirm.";

const PAUSED_PAUSE_REASON = "This target is already paused, so there is nothing to pause. Its history stays as it is, and this release offers no separate resume action.";

const ENDED_PAUSE_REASON = "This target has ended, so it cannot be paused. Ending closed it for good, and its history is kept either way.";

const ENDED_END_REASON = "This target has ended already. Its history and the versions its closed periods were measured against stay exactly as they are.";

const PAUSE_CONSEQUENCE = "Pausing changes only whether this target admits recorded progress. It sends no notice, creates no task and no commitment, and it deletes nothing.";

const END_CONSEQUENCE = "Ending closes the target for good: a later change to its plan is refused rather than applied. It deletes no activity record, sends no notice, and leaves every other target untouched.";

const CREATE_CONSEQUENCE = "Saving records the first version of this plan. The target counts only the activity you record, it creates no commitment and sends no reminder, and no coach can read it unless you switch the Targets module on.";

const labelOf = (field: string): string => FIELD_LABELS[field] ?? "";

function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="font-medium">{term}</dt>
      <dd className="min-w-0 text-pretty">{children}</dd>
    </div>
  );
}

/** A civil day as it is stored, isolated so a mixed-direction neighbour cannot reorder its digits. */
function CivilDateText({ value }: { readonly value: string | undefined }): ReactElement {
  const stated = value?.trim() ?? "";
  return stated === "" ? <span className="text-muted-foreground">a day you have not entered yet</span> : <bdi className="wrap-anywhere">{stated}</bdi>;
}

/** The state the read resolved for this target, stated in words so the meaning never rests on colour or on a badge shape. */
function StateStatement({ state }: { readonly state: TargetState }): ReactElement {
  const copy = TARGET_STATE_COPY[state];
  const statesHistoryIsKept = state === "paused" || state === "ended";
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Badge variant={state === "active" ? "secondary" : "outline"}>{copy.label}</Badge>
      <p className="text-sm text-pretty text-muted-foreground">{copy.description}</p>
      {statesHistoryIsKept ? <p className="text-sm text-pretty text-muted-foreground">{PAUSE_HISTORY_NOTE}</p> : null}
    </div>
  );
}

/** The plan a target holds, as facts rather than as controls: what an ended target is shown as. */
function PlanFacts({ target }: { readonly target: TargetView }): ReactElement {
  const plan = heldPlanOf(target);
  return (
    <dl className="grid min-w-0 gap-3 text-sm">
      <Fact term={labelOf(MEASURE_FIELD)}>{MEASURE_COPY[plan.measure].label}</Fact>
      <Fact term={labelOf(QUANTITY_FIELD)}>
        <bdi className="tabular-figures">{String(plan.quantity)}</bdi> in each period
      </Fact>
      <Fact term={labelOf(PERIOD_FIELD)}>{PERIOD_COPY[plan.period].label}</Fact>
      <Fact term="Starts on">
        <CivilDateText value={serialiseCivilDate(target.calendarStart)} />
      </Fact>
      {target.period === "custom" ? (
        <Fact term={labelOf(PERIOD_END_FIELD)}>
          <CivilDateText value={plan.periodEnd} />
        </Fact>
      ) : null}
      <Fact term={labelOf(PRIVATE_LABEL_FIELD)}>
        {privateLabelText(target.privateLabel)} <span className="text-muted-foreground">— never disclosed to a coach</span>
      </Fact>
      <Fact term={labelOf(HOME_PLACEMENT_FIELD)}>
        {placementText(target.homePlacement)} <span className="text-muted-foreground">— changes only what you see</span>
      </Fact>
    </dl>
  );
}

/** What a new target will be, named as the worker entered it. */
function PlanSummary({ plan }: { readonly plan: TargetSavePayload }): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      <Fact term={labelOf(MEASURE_FIELD)}>{MEASURE_COPY[plan.measure].label}</Fact>
      <Fact term={labelOf(QUANTITY_FIELD)}>{quantityTextOf(plan.quantity)} in each period</Fact>
      <Fact term={labelOf(PERIOD_FIELD)}>{PERIOD_COPY[plan.period].label}</Fact>
      {plan.period === "custom" ? (
        <>
          <Fact term={labelOf(CALENDAR_START_FIELD)}>
            <CivilDateText value={plan.calendarStart} />
          </Fact>
          <Fact term={labelOf(PERIOD_END_FIELD)}>
            <CivilDateText value={plan.periodEnd} />
          </Fact>
        </>
      ) : null}
      <Fact term={labelOf(PRIVATE_LABEL_FIELD)}>
        {privateLabelText(plan.privateLabel)} <span className="text-muted-foreground">— never disclosed to a coach</span>
      </Fact>
      <Fact term={labelOf(HOME_PLACEMENT_FIELD)}>
        {placementText(plan.homePlacement)} <span className="text-muted-foreground">— changes only what you see</span>
      </Fact>
    </dl>
  );
}

/** The plan a target holds beside the plan these entries would make of it, so a change is read against what it replaces. */
function PlanComparison({ plan, target }: { readonly plan: TargetSavePayload; readonly target: TargetView }): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      <Fact term="The plan now">{planSentence(heldPlanOf(target))}</Fact>
      <Fact term="This change">{planSentence(plan)}</Fact>
      <Fact term={labelOf(PRIVATE_LABEL_FIELD)}>
        {privateLabelText(plan.privateLabel)} <span className="text-muted-foreground">— never disclosed to a coach</span>
      </Fact>
      <Fact term={labelOf(HOME_PLACEMENT_FIELD)}>
        {placementText(plan.homePlacement)} <span className="text-muted-foreground">— changes only what you see</span>
      </Fact>
    </dl>
  );
}

/** A change this target does not admit right now, with the reason stated beside the control that would make it. */
function HeldAction({ label, reason, descriptionId }: { readonly label: string; readonly reason: string; readonly descriptionId: string }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Button type="button" variant="outline" disabled aria-describedby={descriptionId} className="min-h-target w-fit max-w-full whitespace-normal">
        {label}
      </Button>
      <p id={descriptionId} className="text-sm text-pretty text-muted-foreground">
        {reason}
      </p>
    </div>
  );
}

/**
 * The worker's target composer and lifecycle control: the plan, the reviewed save or change, and pause and end as
 * their own reviewed changes, each with its own receipt.
 */
export default function TargetForm({ target, scope, expectedRevision, locale, dir, onSettled, onCheckResult, className }: TargetFormProps): ReactElement {
  const headingId = useId();
  const planHeadingId = useId();
  const lifecycleHeadingId = useId();
  const reviewNoteId = useId();
  const pauseReasonId = useId();
  const endReasonId = useId();
  const [startingValues] = useState<TargetFormValues>(() => initialValuesOf(target));
  const form = useForm({ defaultValues: startingValues });
  const [refusal, setRefusal] = useState<FieldErrorLookup | null>(null);
  const [planOutcome, setPlanOutcome] = useState<MutationOutcome | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const saveTarget = useSaveTarget();
  const editTarget = useEditTarget();
  const pauseTarget = usePauseTarget();
  const endTarget = useEndTarget();
  const busy = saveTarget.isPending || editTarget.isPending || pauseTarget.isPending || endTarget.isPending;
  const submitSave = (input: MutationInput<TargetSavePayload>): Promise<MutationOutcome> => saveTarget.mutateAsync(input);
  const submitEdit = (input: MutationInput<TargetEditPayload>): Promise<MutationOutcome> => editTarget.mutateAsync(input);
  const submitPause = (input: MutationInput<TargetPausePayload>): Promise<MutationOutcome> => pauseTarget.mutateAsync(input);
  const submitEnd = (input: MutationInput<TargetEndPayload>): Promise<MutationOutcome> => endTarget.mutateAsync(input);
  const settlePlan = (outcome: MutationOutcome): void => {
    setPlanOutcome(outcome);
    onSettled?.(outcome);
  };
  const settleLifecycle = (outcome: MutationOutcome): void => {
    onSettled?.(outcome);
  };
  // A refusal or a settled outcome describes the entries it was raised for, so editing one of them stops it being shown
  // against the values on screen. Nothing entered is cleared with it: every value stays exactly as it was typed.
  const clearOnEdit = (): void => {
    setRefusal(null);
    setPlanOutcome(null);
  };
  const reviewThePlan = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const refused = refusalOf(form.state.values, target);
    if (refused !== null && refused.count > 0) {
      // An entry the schema refuses never reaches the route: the messages are stated against the fields they name, the
      // keyboard position moves to the first of them, and no attempt is minted for work that could only be refused.
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
  const errors = refusal ?? serverErrors;
  const planFields = (values: TargetFormValues): ReactElement => (
    <>
      <form.Field name={MEASURE_FIELD}>
        {(field) => (
          <FormField name={MEASURE_FIELD} label={labelOf(MEASURE_FIELD)} description={`${MEASURE_COPY[field.state.value].hint} ${MEASURE_DESCRIPTION_PREFIX}`} error={errors?.byField[MEASURE_FIELD]} required>
            {(control) => (
              <NativeSelect
                id={control.id}
                name={MEASURE_FIELD}
                className="w-full sm:max-w-72"
                value={field.state.value}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid ? true : undefined}
                aria-required={control.required ? true : undefined}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (!isTargetMeasure(next)) {
                    return;
                  }
                  field.handleChange(next);
                  clearOnEdit();
                }}
                onBlur={field.handleBlur}
              >
                {TARGET_MEASURES.map((measure) => (
                  <NativeSelectOption key={measure} value={measure}>
                    {MEASURE_COPY[measure].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name={QUANTITY_FIELD}>
        {(field) => (
          <FormField name={QUANTITY_FIELD} label={labelOf(QUANTITY_FIELD)} description={QUANTITY_DESCRIPTION} error={errors?.byField[QUANTITY_FIELD]} required>
            {(control) => (
              <Input
                id={control.id}
                name={QUANTITY_FIELD}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                autoComplete="off"
                className="w-full tabular-figures sm:max-w-40"
                required={control.required}
                value={field.state.value}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid ? true : undefined}
                aria-required={control.required ? true : undefined}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                  clearOnEdit();
                }}
                onBlur={field.handleBlur}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name={PERIOD_FIELD}>
        {(field) => (
          <FormField name={PERIOD_FIELD} label={labelOf(PERIOD_FIELD)} description={`${PERIOD_DESCRIPTION} ${PERIOD_COPY[field.state.value].description}`} error={errors?.byField[PERIOD_FIELD]} required>
            {(control) => (
              <NativeSelect
                id={control.id}
                name={PERIOD_FIELD}
                className="w-full sm:max-w-72"
                value={field.state.value}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid ? true : undefined}
                aria-required={control.required ? true : undefined}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (!isPeriodKind(next)) {
                    return;
                  }
                  field.handleChange(next);
                  clearOnEdit();
                }}
                onBlur={field.handleBlur}
              >
                {PERIOD_KINDS.map((kind) => (
                  <NativeSelectOption key={kind} value={kind}>
                    {PERIOD_COPY[kind].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
      </form.Field>
      {values.period === "custom" ? (
        <>
          <form.Field name={CALENDAR_START_FIELD}>
            {(field) => (
              <FormField name={CALENDAR_START_FIELD} label={labelOf(CALENDAR_START_FIELD)} description={CUSTOM_START_DESCRIPTION} error={errors?.byField[CALENDAR_START_FIELD]} required>
                {(control) => (
                  <Input
                    id={control.id}
                    name={CALENDAR_START_FIELD}
                    type="date"
                    className="w-full sm:max-w-60"
                    required={control.required}
                    value={field.state.value}
                    aria-describedby={control.describedBy}
                    aria-invalid={control.invalid ? true : undefined}
                    aria-required={control.required ? true : undefined}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                      clearOnEdit();
                    }}
                    onBlur={field.handleBlur}
                  />
                )}
              </FormField>
            )}
          </form.Field>
          <form.Field name={PERIOD_END_FIELD}>
            {(field) => (
              <FormField name={PERIOD_END_FIELD} label={labelOf(PERIOD_END_FIELD)} description={CUSTOM_END_DESCRIPTION} error={errors?.byField[PERIOD_END_FIELD]} required>
                {(control) => (
                  <Input
                    id={control.id}
                    name={PERIOD_END_FIELD}
                    type="date"
                    className="w-full sm:max-w-60"
                    required={control.required}
                    value={field.state.value}
                    aria-describedby={control.describedBy}
                    aria-invalid={control.invalid ? true : undefined}
                    aria-required={control.required ? true : undefined}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                      clearOnEdit();
                    }}
                    onBlur={field.handleBlur}
                  />
                )}
              </FormField>
            )}
          </form.Field>
        </>
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">{NO_CUSTOM_DATES_NOTE}</p>
      )}
      <form.Field name={PRIVATE_LABEL_FIELD}>
        {(field) => (
          <FormField name={PRIVATE_LABEL_FIELD} label={labelOf(PRIVATE_LABEL_FIELD)} description={PRIVATE_LABEL_DESCRIPTION} error={errors?.byField[PRIVATE_LABEL_FIELD]} required>
            {(control) => (
              <Input
                id={control.id}
                name={PRIVATE_LABEL_FIELD}
                type="text"
                autoComplete="off"
                className="w-full sm:max-w-96"
                required={control.required}
                value={field.state.value}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid ? true : undefined}
                aria-required={control.required ? true : undefined}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                  clearOnEdit();
                }}
                onBlur={field.handleBlur}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name={HOME_PLACEMENT_FIELD}>
        {(field) => (
          <FormField name={HOME_PLACEMENT_FIELD} label={labelOf(HOME_PLACEMENT_FIELD)} description={HOME_PLACEMENT_DESCRIPTION} error={errors?.byField[HOME_PLACEMENT_FIELD]}>
            {(control) => (
              <div className="flex min-h-target flex-wrap items-center gap-3">
                <Switch
                  id={control.id}
                  checked={field.state.value}
                  // Base UI keeps its own element id on the switch and puts the field id on its hidden input, so the
                  // accessible name is stated here rather than left to the label's `for`. The wording is the label's.
                  aria-label={labelOf(HOME_PLACEMENT_FIELD)}
                  aria-describedby={control.describedBy}
                  aria-invalid={control.invalid ? true : undefined}
                  onCheckedChange={(checked: boolean) => {
                    field.handleChange(checked);
                    clearOnEdit();
                  }}
                />
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
        <h2 id={headingId} className="font-heading text-lg font-medium">
          {creating ? CREATE_HEADING : EDIT_HEADING}
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{PLAN_PURPOSE}</p>
        <p className="text-sm text-pretty text-muted-foreground">{TARGET_MEANING}</p>
      </div>
      {target === null ? null : <StateStatement state={target.state} />}
      {ended && target !== null ? (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              <h3 id={planHeadingId}>{PLAN_HEADING}</h3>
            </CardTitle>
            <CardDescription>{ENDED_PLAN_NOTE}</CardDescription>
          </CardHeader>
          <CardContent>
            <PlanFacts target={target} />
          </CardContent>
        </Card>
      ) : (
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const plan = planOf(values);
            return (
              <>
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle>
                      <h3 id={planHeadingId}>{PLAN_HEADING}</h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form noValidate onSubmit={reviewThePlan} aria-busy={busy ? true : undefined} className="flex min-w-0 flex-col gap-5">
                      {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={4} />}
                      {planFields(values)}
                      <Separator />
                      <p className="text-sm text-pretty text-muted-foreground">{TARGET_VERSION_GUARANTEE}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="submit" disabled={busy} aria-describedby={reviewNoteId} className="min-h-target max-w-full whitespace-normal">
                          {creating ? "Review and save" : "Review the change"}
                        </Button>
                      </div>
                      <p id={reviewNoteId} className="text-sm text-pretty text-muted-foreground">
                        {reviewing ? REVIEWING_NOTE : REVIEW_NOTE}
                      </p>
                    </form>
                  </CardContent>
                </Card>
                {reviewing && target === null ? (
                  <ActionReview<TargetSavePayload>
                    title="Review this target"
                    description={<PlanSummary plan={plan} />}
                    consequence={<p>{CREATE_CONSEQUENCE}</p>}
                    confirmLabel="Save target"
                    input={{ scope, expectedRevision, payload: plan }}
                    submit={submitSave}
                    onSettled={settlePlan}
                    checkResult={onCheckResult}
                    fieldLabels={FIELD_LABELS}
                    headingLevel={3}
                  />
                ) : null}
                {reviewing && target !== null ? (
                  <ActionReview<TargetEditPayload>
                    title="Review this change"
                    description={<PlanComparison plan={plan} target={target} />}
                    consequence={<p>{TARGET_VERSION_GUARANTEE}</p>}
                    confirmLabel="Save changes"
                    input={{ scope, expectedRevision, payload: editPayloadOf(target.targetId, plan) }}
                    submit={submitEdit}
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
          <h3 id={lifecycleHeadingId} className="font-heading text-base font-medium">
            {LIFECYCLE_HEADING}
          </h3>
          <p className="text-sm text-pretty text-muted-foreground">{LIFECYCLE_NOTE}</p>
          {target.state === "paused" || ended ? (
            <HeldAction label="Pause target" reason={target.state === "paused" ? PAUSED_PAUSE_REASON : ENDED_PAUSE_REASON} descriptionId={pauseReasonId} />
          ) : (
            <ActionReview<TargetPausePayload>
              title="Pause this target"
              description={<p>{TARGET_STATE_COPY.paused.description}</p>}
              consequence={<p>{PAUSE_CONSEQUENCE}</p>}
              confirmLabel="Pause target"
              consequential
              input={{ scope, expectedRevision, payload: { targetId: target.targetId } }}
              submit={submitPause}
              onSettled={settleLifecycle}
              checkResult={onCheckResult}
              headingLevel={4}
            />
          )}
          {ended ? (
            <HeldAction label="End target" reason={ENDED_END_REASON} descriptionId={endReasonId} />
          ) : (
            <ActionReview<TargetEndPayload>
              title="End this target"
              description={<p>{TARGET_STATE_COPY.ended.description}</p>}
              consequence={<p>{END_CONSEQUENCE}</p>}
              confirmLabel="End target"
              consequential
              input={{ scope, expectedRevision, payload: { targetId: target.targetId } }}
              submit={submitEnd}
              onSettled={settleLifecycle}
              checkResult={onCheckResult}
              headingLevel={4}
            />
          )}
        </section>
      )}
    </section>
  );
}
