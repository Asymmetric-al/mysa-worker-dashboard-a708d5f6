"use client";
/**
 * The one form that records a referral's original introduction date, with the precision that date is
 * known to.
 *
 * Scope: AAP 0.6.2 (the referral cycle's `originalIntroductionOn`, `datePrecision`, `sourceZone` and
 * opaque `sourceReference`), AAP 0.8.3 (a late first entry may already be Expired; an approximate or
 * unknown date admits no deadline, no Active or Expired judgement and no Continue), AAP 0.10.1 family
 * 5, success criterion 15, and WCAG 3.3.7 Redundant Entry.
 *
 * Two facts are kept apart here because they are the one place a late entry can be misread: the date
 * the introduction happened, and when the record was entered in this application. The form states the
 * first, reads the second from the envelope, and computes neither — no window, no endpoint and no
 * Active or Expired judgement is derived on this surface. A date that is not precise enough for a
 * deadline says so and stops there, because that judgement belongs to the read that resolved the
 * window.
 *
 * Every sentence the surface renders comes from this family's copy module, the payload it submits is
 * the five keys `introductionPayloadSchema` states, and the identity of the attempt, the scope it acts
 * in and the revision it presents are the composing route's and the shared review step's, never this
 * form's own.
 */
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
/** Props of {@link ReferralIntroductionForm}. */
export interface ReferralIntroductionFormProps {
  /** The authority this write runs under, exactly as the composing route read it. */
  readonly scope: Scope;
  /**
   * The opaque identity of the partner this introduction refers to.
   *
   * It is a reference, not a join key: nothing here reads it for meaning, compares it with a name, an
   * email address or a postal address, or uses it to match one record against another.
   */
  readonly partnerId: string;
  /** The revision the composing route read, which the write presents so a stale attempt is a conflict rather than an overwrite. */
  readonly expectedRevision: string;
  /** The source reference the envelope supplied: the one this cycle keeps as its provenance. */
  readonly sourceReference: SourceReference;
  /** The accepted source zone the envelope resolved the introduction date in; windows are read in it and it is never typed here. */
  readonly sourceZone: string;
  /** When the envelope states this record was entered, already formatted for display. The form never reads a clock. */
  readonly recordedAtDisplay?: string;
  /**
   * Called with the outcome of every settled attempt, so the composing route can re-read the lists or
   * state the result. `accepted`, `alreadyAccepted` and `unchanged` are the three that mean the
   * introduction stands as recorded; a caller that needs only those reads `outcome.outcome`.
   */
  readonly onRecorded?: (outcome: MutationOutcome) => void;
  /** The display direction the route states for this block; it is set here and nowhere below. */
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}
/**
 * The two values this form itself states.
 *
 * Everything else the payload carries — the partner, the zone, the source reference — arrives from the
 * envelope the route read, so no other field is offered and none is invented.
 */
interface IntroductionFormValues {
  originalIntroductionOn: string;
  datePrecision: DatePrecisionValue;
}
/** What the form opens with: no date yet, and the precision the release states first. */
const INITIAL_VALUES: IntroductionFormValues = {
  originalIntroductionOn: "",
  datePrecision: "date",
};
/** The payload key the date carries, used for the field, its error path and the review summary's labels. */
const DATE_FIELD = "originalIntroductionOn";
/** The payload key the precision carries. */
const PRECISION_FIELD = "datePrecision";
/**
 * The labels a refused field shows in the aggregate summary, keyed as the `invalid` outcome keys them.
 *
 * The date and precision keys are the form's own; the zone and reference keys arrive from the same
 * schema the service parses, so a refusal the service raised and one this form's payload check raised
 * are labelled identically.
 */
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  [DATE_FIELD]: INTRODUCED_BY_COPY.originalIntroductionOnLabel,
  [PRECISION_FIELD]: INTRODUCED_BY_COPY.datePrecisionLabel,
  sourceZone: INTRODUCED_BY_COPY.sourceZoneLabel,
  sourceReference: INTRODUCED_BY_COPY.sourceReferenceLabel,
  "sourceReference.system": INTRODUCED_BY_COPY.sourceReferenceLabel,
  "sourceReference.reference": INTRODUCED_BY_COPY.sourceReferenceLabel,
};
/** Reports whether a value from the radio group is one of the three precisions the release states. */
function isDatePrecision(value: unknown): value is DatePrecisionValue {
  return typeof value === "string" && (DATE_PRECISION_VALUES as readonly string[]).includes(value);
}
/**
 * The payload exactly as `introductionPayloadSchema` states it.
 *
 * Its return type is the schema's own output type, so the compiler refuses a payload that omits a
 * required key, carries one the schema does not declare, or puts the revision inside the payload where
 * the four-field mutation body expects to find it. An unknown date states no date at all rather than a
 * guess a later reader would treat as evidence, so the date is `null` in that one case.
 */
function composePayload(partnerId: string, values: IntroductionFormValues, sourceZone: string, sourceReference: SourceReference): IntroductionPayload {
  const typed = values.originalIntroductionOn.trim();
  return {
    partnerId,
    originalIntroductionOn: values.datePrecision === "unknown" || typed === "" ? null : typed,
    datePrecision: values.datePrecision,
    sourceZone,
    sourceReference: { system: sourceReference.system, reference: sourceReference.reference },
  };
}

/** One fact the envelope supplied, with the sentence that keeps it from being read as something else. */
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
/**
 * What the review step names before the write: the introduction date, the precision it is known to,
 * the zone it is read in and the provenance it keeps.
 *
 * The date row is absent rather than blank where the precision states no date, and the precision row
 * carries its own sentence, so the review of an approximate or unknown entry reads as the incomplete
 * evidence it is instead of as a missing value somebody forgot to fill in.
 */
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
/**
 * The form that records one original introduction date.
 *
 * The two values it states are held by TanStack Form, which owns the unsubmitted input for this
 * multi-field surface; the write itself travels through the shared review step, which mints the one
 * attempt identity a submission carries and renders the service's outcome as the durable receipt
 * beside the form. Nothing typed is discarded when a submission is refused, so a correction costs a
 * correction rather than a re-entry.
 */
export function ReferralIntroductionForm({
  scope,
  partnerId,
  expectedRevision,
  sourceReference,
  sourceZone,
  recordedAtDisplay,
  onRecorded,
  dir,
  className,
}: ReferralIntroductionFormProps): ReactElement {
  const headingId = useId();
  const optionIdPrefix = useId();
  const form = useForm({ defaultValues: INITIAL_VALUES });
  const [settledOutcome, setSettledOutcome] = useState<MutationOutcome | null>(null);
  const { mutateAsync } = useRecordIntroduction();
  const submit = useCallback(
    (input: MutationInput<IntroductionPayload>): Promise<MutationOutcome> =>
      mutateAsync({
        operationId: input.operationId,
        scope: input.scope,
        expectedRevision: input.expectedRevision,
        payload: input.payload,
      }),
    [mutateAsync],
  );
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setSettledOutcome(outcome);
      onRecorded?.(outcome);
    },
    [onRecorded],
  );
  // A refusal's per-field messages are read from the outcome the review step settled, keyed by the
  // same field paths the schema uses, so a control and the aggregate summary state one sentence.
  const fieldErrors = settledOutcome !== null && settledOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(settledOutcome) : null;
  // Correcting a field begins a new intent, so the previous refusal stops being shown against the
  // values it was raised for. Returning the current `null` unchanged lets React bail out, so a
  // keystroke in the ordinary case costs no re-render for this surface. The receipt itself stays the
  // review step's to retire.
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
                          // An unknown date states no date at all, so the date is cleared rather than
                          // left holding a value this precision would refuse to store.
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
