"use client";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import ActionReview from "@/components/action-review";
import { ChoiceGroup } from "@/components/choice-group";
import FormField, { civilDateConvention, fieldErrorsFromInvalid, FormFieldGroup } from "@/components/form-field";
import { Fact } from "@/components/fact";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import type { MutationInput, MutationOutcome, Scope } from "@/modules/data-service";
import { INTRODUCED_BY_COPY, NO_DEADLINE_NOTICE, PRECISION_COPY } from "../copy";
import { useRecordIntroduction } from "../hooks/use-referral-mutations";
import { DATE_PRECISION_VALUES, type DatePrecisionValue, type IntroductionPayload } from "../schemas";
export type ReferralIntroductionFormProps = {
  readonly scope: Scope;
  readonly partnerId: string;
  readonly expectedRevision: string;
  readonly sourceReference: SourceReference;
  readonly sourceZone: string;
  /** The level this section's own heading lands at: the record's route titles the record at the page's h1 and its sections at h2, where the side panel and the phone sheet state the record at h2 and its sections at h3. */ readonly headingLevel?: 2 | 3;
  readonly recordedAtDisplay?: string;
  readonly onRecorded?: (outcome: MutationOutcome) => void;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
};
type IntroductionFormValues = { originalIntroductionOn: string; datePrecision: DatePrecisionValue };
const INITIAL_VALUES: IntroductionFormValues = { originalIntroductionOn: "", datePrecision: "date" };
/** The tag and the type scale this section's own heading renders at the level it sits in, so one form states the same step below the record's name in the record's route and in the side panel. */ const SECTION_HEADING_TAGS = { 2: "h2", 3: "h3" } as const;
const SECTION_HEADING_SCALES: Readonly<Record<2 | 3, string>> = { 2: "type-section-title", 3: "type-subsection-title" };
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
function composePayload(partnerId: string, values: IntroductionFormValues, sourceZone: string, sourceReference: SourceReference): IntroductionPayload {
  const typed = values.originalIntroductionOn.trim();
  return { partnerId, originalIntroductionOn: values.datePrecision === "unknown" || typed === "" ? null : typed, datePrecision: values.datePrecision, sourceZone, sourceReference: { system: sourceReference.system, reference: sourceReference.reference } };
}
const factOf = (term: string, ddClass: string, value: ReactNode, trailing?: ReactNode): ReactElement => (
  <Fact term={term} termClassName="font-medium text-foreground" detailClassName={ddClass}>
    {value}
    {trailing}
  </Fact>
);
function EnvelopeFact({ term, values, help }: { readonly term: string; readonly values: readonly string[]; readonly help: string }): ReactElement {
  const stated = values.filter((value) => value.trim() !== "");
  const statedLine = (value: string, index: number): ReactElement => (
    <bdi key={`${String(index)}-${value}`} className="mono-identifier wrap-anywhere">
      {value}
    </bdi>
  );
  return (
    <Fact term={term} termClassName="font-medium" detailClassName="flex min-w-0 flex-col gap-1">
      {stated.length === 0 ? null : <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">{stated.map(statedLine)}</span>}
      <span className="text-pretty text-muted-foreground">{help}</span>
    </Fact>
  );
}
function ReviewedIntroduction({ payload }: { readonly payload: IntroductionPayload }): ReactElement {
  const precision = PRECISION_COPY[payload.datePrecision];
  const reference = payload.sourceReference;
  return (
    <dl className="flex min-w-0 flex-col gap-3">
      {payload.originalIntroductionOn === null ? null : factOf(INTRODUCED_BY_COPY.originalIntroductionOnLabel, "min-w-0", <bdi className="mono-identifier">{payload.originalIntroductionOn}</bdi>)}
      {factOf(INTRODUCED_BY_COPY.datePrecisionLabel, "flex min-w-0 flex-col items-start gap-1", <Badge variant="secondary">{precision.label}</Badge>, <span className="text-pretty">{precision.hint}</span>)}
      {factOf(INTRODUCED_BY_COPY.sourceZoneLabel, "min-w-0", <bdi className="mono-identifier">{payload.sourceZone}</bdi>)}
      {factOf(INTRODUCED_BY_COPY.sourceReferenceLabel, "flex min-w-0 flex-wrap items-baseline gap-x-2", <bdi className="mono-identifier">{reference.system}</bdi>, <bdi className="mono-identifier wrap-anywhere">{reference.reference}</bdi>)}
    </dl>
  );
}
export function ReferralIntroductionForm({ scope, partnerId, expectedRevision, sourceReference, sourceZone, headingLevel = 2, recordedAtDisplay, onRecorded, dir, className }: ReferralIntroductionFormProps): ReactElement {
  const headingId = useId();
  const SectionHeading = SECTION_HEADING_TAGS[headingLevel];
  const optionIdPrefix = useId();
  const form = useForm({ defaultValues: INITIAL_VALUES });
  const router = useRouter();
  const [settledOutcome, setSettledOutcome] = useState<MutationOutcome | null>(null);
  const { mutateAsync } = useRecordIntroduction();
  const submit = useCallback((input: MutationInput<IntroductionPayload>): Promise<MutationOutcome> => mutateAsync({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutateAsync]);
  // A recorded introduction is a new cycle in the referral lists and a new fact on the record this form is composed beside, so a resolved attempt asks the route to re-read what it renders rather than this form placing the result in a list it does not own. The receipt stays on screen across that re-read, because the outcome is this component's own state.
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setSettledOutcome(outcome);
      if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") router.refresh();
      onRecorded?.(outcome);
    },
    [onRecorded, router],
  );
  const fieldErrors = settledOutcome !== null && settledOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(settledOutcome) : null;
  const clearRefusal = useCallback((): void => setSettledOutcome(null), []);
  const enteredAt = recordedAtDisplay?.trim() ?? "";
  return (
    <section dir={dir} aria-labelledby={headingId} data-slot="referral-introduction-form" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <SectionHeading {...{ id: headingId, className: SECTION_HEADING_SCALES[headingLevel] }}>{INTRODUCED_BY_COPY.sectionHeading}</SectionHeading>
        <p className="type-supporting text-pretty">{INTRODUCED_BY_COPY.formHelp}</p>
      </div>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => {
          const payload = composePayload(partnerId, values, sourceZone, sourceReference);
          const dateIsKnown = values.datePrecision !== "unknown";
          const dateHelp = dateIsKnown ? INTRODUCED_BY_COPY.originalIntroductionOnHelp : `${INTRODUCED_BY_COPY.originalIntroductionOnHelp} ${INTRODUCED_BY_COPY.unknownClearsDateNote}`;
          return (
            <div className="flex min-w-0 flex-col gap-6">
              <FormField name={DATE_FIELD} label={INTRODUCED_BY_COPY.originalIntroductionOnLabel} description={`${dateHelp} ${civilDateConvention(values[DATE_FIELD])}`} error={fieldErrors?.byField[DATE_FIELD]} required={dateIsKnown}>
                {(control) => (
                  <form.Field name={DATE_FIELD}>
                    {(dateField) => {
                      const onDateChange = (event: ChangeEvent<HTMLInputElement>): void => {
                        dateField.handleChange(event.currentTarget.value);
                        clearRefusal();
                      };
                      return <Input id={control.id} type="date" value={dateField.state.value} disabled={!dateIsKnown} aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} aria-required={control.required ? true : undefined} onChange={onDateChange} className="w-full sm:max-w-60" />;
                    }}
                  </form.Field>
                )}
              </FormField>
              <FormFieldGroup legend={INTRODUCED_BY_COPY.datePrecisionLabel} name={PRECISION_FIELD} error={fieldErrors?.byField[PRECISION_FIELD]} required>
                {(group) => (
                  <form.Field name={PRECISION_FIELD}>
                    {(precisionField) => (
                      <ChoiceGroup
                        frame={group}
                        value={precisionField.state.value}
                        choices={DATE_PRECISION_VALUES}
                        wording={PRECISION_COPY}
                        idPrefix={`${optionIdPrefix}-precision`}
                        onChange={(next) => {
                          precisionField.handleChange(next);
                          if (next === "unknown") form.setFieldValue(DATE_FIELD, "");
                          clearRefusal();
                        }}
                      />
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
                headingLevel={headingLevel === 2 ? 3 : 4}
              />
            </div>
          );
        }}
      </form.Subscribe>
    </section>
  );
}
export default ReferralIntroductionForm;
