"use client";
import { useForm } from "@tanstack/react-form";
import { useCallback, useId, useState, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, FormFieldGroup } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import type { MutationInput, MutationOutcome, Scope } from "@/modules/data-service";
import { INTRODUCED_BY_COPY, NO_DEADLINE_NOTICE, PRECISION_COPY } from "../copy";
import { useRecordIntroduction } from "../hooks/use-referral-mutations";
import { DATE_PRECISION_VALUES, type DatePrecisionValue, type IntroductionPayload } from "../schemas";
export type ReferralIntroductionFormProps = {
  readonly scope: Scope;
  /** The opaque identity of the partner this introduction refers to: a reference, not a join key, never read for meaning or compared with a name, an address or another record. */
  readonly partnerId: string;
  readonly expectedRevision: string;
  readonly sourceReference: SourceReference;
  /** The accepted source zone the envelope resolved the introduction date in; windows are read in it and it is never typed here. */
  readonly sourceZone: string;
  /** When the envelope states this record was entered, already formatted for display. The form never reads a clock. */
  readonly recordedAtDisplay?: string;
  /** Called with the outcome of every settled attempt, so the composing route can re-read the lists or state the result. */
  readonly onRecorded?: (outcome: MutationOutcome) => void;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
};
type IntroductionFormValues = { originalIntroductionOn: string; datePrecision: DatePrecisionValue };
const INITIAL_VALUES: IntroductionFormValues = { originalIntroductionOn: "", datePrecision: "date" };
const DATE_FIELD = "originalIntroductionOn";
const PRECISION_FIELD = "datePrecision";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  [DATE_FIELD]: INTRODUCED_BY_COPY.originalIntroductionOnLabel,
  [PRECISION_FIELD]: INTRODUCED_BY_COPY.datePrecisionLabel,
  sourceZone: INTRODUCED_BY_COPY.sourceZoneLabel,
  sourceReference: INTRODUCED_BY_COPY.sourceReferenceLabel,
  "sourceReference.system": INTRODUCED_BY_COPY.sourceReferenceLabel,
  "sourceReference.reference": INTRODUCED_BY_COPY.sourceReferenceLabel,
};
function isDatePrecision(value: unknown): value is DatePrecisionValue {
  return typeof value === "string" && (DATE_PRECISION_VALUES as readonly string[]).includes(value);
}
function composePayload(partnerId: string, values: IntroductionFormValues, sourceZone: string, sourceReference: SourceReference): IntroductionPayload {
  const typed = values.originalIntroductionOn.trim();
  return { partnerId, originalIntroductionOn: values.datePrecision === "unknown" || typed === "" ? null : typed, datePrecision: values.datePrecision, sourceZone, sourceReference: { system: sourceReference.system, reference: sourceReference.reference } };
}
function EnvelopeFact({ term, values, help }: { readonly term: string; readonly values: readonly string[]; readonly help: string }): ReactElement {
  const stated = values.filter((value) => value.trim() !== "");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="font-medium">{term}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        {stated.length === 0 ? null : (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {/* Each opaque value is isolated, so a mixed-direction neighbour cannot reorder it. */}
            {stated.map((value, index) => (
              <bdi key={`${String(index)}-${value}`} className="mono-identifier wrap-anywhere">
                {value}
              </bdi>
            ))}
          </span>
        )}
        <span className="text-pretty text-muted-foreground">{help}</span>
      </dd>
    </div>
  );
}
function ReviewedIntroduction({ payload }: { readonly payload: IntroductionPayload }): ReactElement {
  const precision = PRECISION_COPY[payload.datePrecision];
  return (
    <dl className="flex min-w-0 flex-col gap-3">
      {payload.originalIntroductionOn === null ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="font-medium text-foreground">{INTRODUCED_BY_COPY.originalIntroductionOnLabel}</dt>
          <dd className="min-w-0">
            <bdi className="mono-identifier">{payload.originalIntroductionOn}</bdi>
          </dd>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="font-medium text-foreground">{INTRODUCED_BY_COPY.datePrecisionLabel}</dt>
        <dd className="flex min-w-0 flex-col items-start gap-1">
          <Badge variant="secondary">{precision.label}</Badge>
          <span className="text-pretty">{precision.hint}</span>
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="font-medium text-foreground">{INTRODUCED_BY_COPY.sourceZoneLabel}</dt>
        <dd className="min-w-0">
          <bdi className="mono-identifier">{payload.sourceZone}</bdi>
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="font-medium text-foreground">{INTRODUCED_BY_COPY.sourceReferenceLabel}</dt>
        <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <bdi className="mono-identifier">{payload.sourceReference.system}</bdi>
          <bdi className="mono-identifier wrap-anywhere">{payload.sourceReference.reference}</bdi>
        </dd>
      </div>
    </dl>
  );
}
export function ReferralIntroductionForm({ scope, partnerId, expectedRevision, sourceReference, sourceZone, recordedAtDisplay, onRecorded, dir, className }: ReferralIntroductionFormProps): ReactElement {
  const headingId = useId();
  const optionIdPrefix = useId();
  const form = useForm({ defaultValues: INITIAL_VALUES });
  const [settledOutcome, setSettledOutcome] = useState<MutationOutcome | null>(null);
  const { mutateAsync } = useRecordIntroduction();
  const submit = useCallback((input: MutationInput<IntroductionPayload>): Promise<MutationOutcome> => mutateAsync({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutateAsync]);
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setSettledOutcome(outcome);
      onRecorded?.(outcome);
    },
    [onRecorded],
  );
  // A refusal's per-field messages are read from the settled outcome, keyed by the schema's own field paths. Correcting a field begins a new intent, so the previous refusal stops being shown against the values it was raised for; returning the current `null` unchanged lets React bail out.
  const fieldErrors = settledOutcome !== null && settledOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(settledOutcome) : null;
  const clearRefusal = useCallback((): void => {
    setSettledOutcome((current) => (current === null ? current : null));
  }, []);
  const enteredAt = recordedAtDisplay?.trim() ?? "";
  return (
    <section dir={dir} aria-labelledby={headingId} data-slot="referral-introduction-form" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={headingId} className="font-heading text-lg font-medium">
          {INTRODUCED_BY_COPY.sectionHeading}
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{INTRODUCED_BY_COPY.formHelp}</p>
      </div>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => {
          const payload = composePayload(partnerId, values, sourceZone, sourceReference);
          const dateIsKnown = values.datePrecision !== "unknown";
          const dateHelp = dateIsKnown ? INTRODUCED_BY_COPY.originalIntroductionOnHelp : `${INTRODUCED_BY_COPY.originalIntroductionOnHelp} ${INTRODUCED_BY_COPY.unknownClearsDateNote}`;
          return (
            <div className="flex min-w-0 flex-col gap-6">
              <FormField name={DATE_FIELD} label={INTRODUCED_BY_COPY.originalIntroductionOnLabel} description={dateHelp} error={fieldErrors?.byField[DATE_FIELD]} required={dateIsKnown}>
                {(control) => (
                  <form.Field name={DATE_FIELD}>
                    {(dateField) => (
                      <Input
                        id={control.id}
                        type="date"
                        value={dateField.state.value}
                        disabled={!dateIsKnown}
                        aria-describedby={control.describedBy}
                        aria-invalid={control.invalid ? true : undefined}
                        aria-required={control.required ? true : undefined}
                        onChange={(event) => {
                          dateField.handleChange(event.currentTarget.value);
                          clearRefusal();
                        }}
                        className="w-full sm:max-w-60"
                      />
                    )}
                  </form.Field>
                )}
              </FormField>
              <FormFieldGroup legend={INTRODUCED_BY_COPY.datePrecisionLabel} name={PRECISION_FIELD} error={fieldErrors?.byField[PRECISION_FIELD]} required>
                {(group) => (
                  <form.Field name={PRECISION_FIELD}>
                    {(precisionField) => (
                      <RadioGroup
                        value={precisionField.state.value}
                        onValueChange={(next) => {
                          if (!isDatePrecision(next)) {
                            return;
                          }
                          precisionField.handleChange(next);
                          // An unknown date clears the date rather than leaving a value this precision would refuse to store.
                          if (next === "unknown") {
                            form.setFieldValue(DATE_FIELD, "");
                          }
                          clearRefusal();
                        }}
                        aria-labelledby={group.legendId}
                        aria-describedby={group.describedBy}
                        aria-invalid={group.invalid ? true : undefined}
                        aria-required={group.required ? true : undefined}
                      >
                        {DATE_PRECISION_VALUES.map((option) => {
                          const wording = PRECISION_COPY[option];
                          const optionId = `${optionIdPrefix}-precision-${option}`;
                          const hintId = `${optionId}-hint`;
                          return (
                            <label key={option} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                              <RadioGroupItem id={optionId} value={option} aria-label={wording.label} aria-describedby={hintId} className="mt-0.5" />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="text-sm font-medium">{wording.label}</span>
                                <span id={hintId} className="text-sm text-pretty text-muted-foreground">
                                  {wording.hint}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </RadioGroup>
                    )}
                  </form.Field>
                )}
              </FormFieldGroup>
              {values.datePrecision === "date" ? null : (
                <Alert>
                  <AlertTitle>{PRECISION_COPY[values.datePrecision].label}</AlertTitle>
                  <AlertDescription>{NO_DEADLINE_NOTICE}</AlertDescription>
                </Alert>
              )}
              <dl className="flex min-w-0 flex-col gap-4 text-sm">
                <EnvelopeFact term={INTRODUCED_BY_COPY.sourceZoneLabel} values={[sourceZone]} help={INTRODUCED_BY_COPY.sourceZoneHelp} />
                <EnvelopeFact term={INTRODUCED_BY_COPY.sourceReferenceLabel} values={[sourceReference.system, sourceReference.reference]} help={INTRODUCED_BY_COPY.sourceReferenceHelp} />
                <EnvelopeFact term={INTRODUCED_BY_COPY.entryTimeLabel} values={[enteredAt]} help={INTRODUCED_BY_COPY.entryTimeNote} />
              </dl>
              <ActionReview<IntroductionPayload>
                title={INTRODUCED_BY_COPY.formHeading}
                description={<ReviewedIntroduction payload={payload} />}
                confirmLabel={INTRODUCED_BY_COPY.saveLabel}
                input={{ scope, expectedRevision, payload }}
                submit={submit}
                onSettled={handleSettled}
                fieldLabels={FIELD_LABELS}
                headingLevel={3}
              />
            </div>
          );
        }}
      </form.Subscribe>
    </section>
  );
}
export default ReferralIntroductionForm;
