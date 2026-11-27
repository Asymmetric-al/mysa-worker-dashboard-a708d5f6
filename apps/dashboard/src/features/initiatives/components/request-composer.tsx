"use client";
import { useCallback, useId, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
import ActionReview from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, FormErrorSummary, FormFieldGroup, type FieldErrorLookup } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { MutationOutcome, Scope, ValueState, reads } from "@/modules/data-service";
import { minorUnitsOf } from "@/modules/money/amount";
import { formatMinor, type MinorFormatting } from "@/modules/money/format";
import { cadenceValueFallback, INITIATIVE_COPY, REQUEST_LIFECYCLE_COPY, REQUEST_LIFECYCLE_STATES, REQUESTED_TERMS_COPY, RESPONSE_AGREEMENT_COPY, termValueFallback } from "../copy";
import { useAttemptSubmit } from "../hooks/use-initiative-mutations";
import { useDraftRequest } from "../hooks/use-request-mutations";
import { draftRequestPayloadSchema, type DraftRequestPayload } from "../schemas/request";
import { valuePropsOf } from "./form-controls";
import { errorsOf, FactList, ReviewFact, type FactEntry } from "./figures";
type InitiativeDetailEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];
type WorkingListMember = InitiativeDetailEnvelope["data"]["workingList"]["items"][number];
const TERMS_SHAPES = ["financial", "non-financial"] as const;
type TermsShape = (typeof TERMS_SHAPES)[number];
const HEADING_TAG = { 3: "h3", 4: "h4" } as const;
const HEADING_SCALE: Readonly<Record<keyof typeof HEADING_TAG, string>> = { 3: "type-subsection-title", 4: "type-group-title" };
/** The level of this section's heading, so the composing page keeps one outline. */
export type RequestComposerProps = { readonly initiativeId: string; readonly envelope: InitiativeDetailEnvelope; readonly onDrafted?: (outcome: MutationOutcome) => void; readonly onCheckResult?: () => void; readonly locale?: string; readonly headingLevel?: 3 | 4; readonly className?: string };
const RECIPIENT_FIELD = "recipientPartnerId";
const REPRESENTED_FIELD = "representedOrganizationId";
const PURPOSE_FIELD = "purpose";
const VERSION_FIELD = "terms.version";
const TERMS_GAP_FIELD = "terms.nonFinancial";
const CURRENCY_FIELD = "terms.currency";
const AMOUNT_FIELD = "terms.minorUnits";
const CADENCE_FIELD = "terms.cadence";
const TERM_FIELD = "terms.term";
const NON_FINANCIAL_FIELD = "terms.nonFinancial.description";
const FIELD_ORDER = [RECIPIENT_FIELD, REPRESENTED_FIELD, PURPOSE_FIELD, VERSION_FIELD, CURRENCY_FIELD, AMOUNT_FIELD, CADENCE_FIELD, TERM_FIELD, NON_FINANCIAL_FIELD] as const;
const STATED_AMOUNT_STATE: ValueState = "value";
const SURFACE_COPY = {
  heading: "Draft a request",
  intro: "Prepare a partnership invitation for someone on your working list — who you’re asking, why, and the requested terms.",
  lifecycle: `Lifecycle: ${REQUEST_LIFECYCLE_STATES.map((state) => REQUEST_LIFECYCLE_COPY[state].label).join(" → ")}. This saves a private draft only.`,
  draftCreatesNothing: "Saving a draft never sends a message, creates a gift or commitment, or subscribes anyone.",
  recipientLabel: "Partner",
  representedLabel: "Represented organization",
  recipientHelp: "Choose a partner on this initiative’s working list.",
  recipientPlaceholder: "Choose a partner",
  noRecipientTitle: "Add a partner to the working list first",
  noRecipientBody: "Requests can only be drafted for partners on this initiative’s working list. Add partners on the Working list tab first.",
  representedHelp: "Optional organization ID if this partner represents a church or organization.",
  representedPlaceholder: "Leave blank if asking an individual",
  purposeHelp: "What you’re asking for and why (up to 2,000 characters).",
  versionHelp: "Version number for these terms (whole number, starting at 1). Responses stay tied to the version presented.",
  termsHelp: "Choose either a financial amount or a non-financial invitation.",
  shapeCopy: {
    financial: { label: "Financial support", hint: "Enter currency, amount in minor units, and optional frequency and duration." },
    "non-financial": { label: REQUESTED_TERMS_COPY.nonFinancialLabel, hint: "Describe a non-financial ask (such as prayer, hosting, or introductions)." },
  },
  currencyHelp: "3-letter currency code (for example, USD, EUR, GBP).",
  amountHelp: "Enter amount in minor units (whole numbers only — for example, 10000 for 100.00).",
  amountEchoIntro: "Formatted preview:",
  cadenceHelp: "Optional frequency (for example, Monthly or One-time).",
  termHelp: "Optional duration (for example, 12 months or Ongoing).",
  nonFinancialHelp: "Describe what you’re inviting them to do (up to 2,000 characters).",
  reviewLabel: "Review draft",
  reviewTitle: "Review request draft",
  confirmLabel: "Save draft",
  backLabel: "Back to form",
  anotherLabel: "Draft another request",
  unavailableTitle: "Can’t draft requests here",
  unavailableBody: "Drafting requests isn’t available in this initiative right now.",
  minorUnitsNote: "(minor units)",
  nobodyRepresented: "None",
} as const;
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  [RECIPIENT_FIELD]: SURFACE_COPY.recipientLabel,
  [REPRESENTED_FIELD]: SURFACE_COPY.representedLabel,
  [PURPOSE_FIELD]: INITIATIVE_COPY.purposeLabel,
  [VERSION_FIELD]: REQUESTED_TERMS_COPY.versionLabel,
  [TERMS_GAP_FIELD]: REQUESTED_TERMS_COPY.heading,
  [CURRENCY_FIELD]: REQUESTED_TERMS_COPY.currencyLabel,
  [AMOUNT_FIELD]: REQUESTED_TERMS_COPY.amountLabel,
  [CADENCE_FIELD]: REQUESTED_TERMS_COPY.cadenceLabel,
  [TERM_FIELD]: REQUESTED_TERMS_COPY.termLabel,
  [NON_FINANCIAL_FIELD]: REQUESTED_TERMS_COPY.nonFinancialLabel,
};
type RequestFormValues = { recipientPartnerId: string; representedOrganizationId: string; purpose: string; version: string; termsShape: TermsShape; currency: string; minorUnits: string; cadence: string; term: string; nonFinancialDescription: string };
const INITIAL_VALUES: RequestFormValues = { recipientPartnerId: "", representedOrganizationId: "", purpose: "", version: "", termsShape: "financial", currency: "", minorUnits: "", cadence: "", term: "", nonFinancialDescription: "" };
const isTermsShape = (value: unknown): value is TermsShape => typeof value === "string" && (TERMS_SHAPES as readonly string[]).includes(value);
const numberOrUndefined = (text: string): number | undefined => (text.trim() === "" ? undefined : Number(text.trim()));
const WHOLE_MINOR_UNITS = /^\d+$/;
const minorUnitsTextOf = (text: string): number | undefined => (text.trim() === "" ? undefined : WHOLE_MINOR_UNITS.test(text.trim()) ? Number(text.trim()) : Number.NaN);
const statedAmountOf = (currency: string, minorUnits: number | undefined, locale: string): MinorFormatting | null =>
  currency.trim() === "" || minorUnits === undefined || !Number.isSafeInteger(minorUnits) ? null : formatMinor({ currency: currency.trim(), minorUnits: minorUnitsOf(minorUnits) }, STATED_AMOUNT_STATE, locale);
function termsOf(values: RequestFormValues): DraftRequestPayload["terms"] {
  const version = numberOrUndefined(values.version) ?? Number.NaN;
  if (values.termsShape === "non-financial") return { version, nonFinancial: { description: values.nonFinancialDescription } };
  const currency = values.currency.trim();
  const minorUnits = minorUnitsTextOf(values.minorUnits);
  const cadence = values.cadence.trim();
  const term = values.term.trim();
  return { version, ...(currency === "" ? {} : { currency }), ...(minorUnits === undefined ? {} : { minorUnits }), ...(cadence === "" ? {} : { cadence }), ...(term === "" ? {} : { term }) };
}
function payloadOf(initiativeId: string, values: RequestFormValues): DraftRequestPayload {
  const represented = values.representedOrganizationId.trim();
  return { initiativeId, recipientPartnerId: values.recipientPartnerId, ...(represented === "" ? {} : { representedOrganizationId: represented }), purpose: values.purpose, terms: termsOf(values) };
}
function ReviewedRequestFacts({ payload, recipient, locale }: { readonly payload: DraftRequestPayload; readonly recipient: WorkingListMember | undefined; readonly locale: string }): ReactElement {
  const terms = payload.terms;
  const nonFinancial = terms.nonFinancial;
  const amount = statedAmountOf(terms.currency ?? "", terms.minorUnits, locale);
  const facts: readonly FactEntry[] = [
    {
      term: SURFACE_COPY.recipientLabel,
      value: (
        <span className="flex min-w-0 flex-col gap-1">
          {recipient === undefined ? null : <span className="text-pretty">{recipient.partnerDisplayName}</span>} <bdi className="mono-identifier wrap-anywhere">{payload.recipientPartnerId}</bdi>
        </span>
      ),
    },
    { term: SURFACE_COPY.representedLabel, value: payload.representedOrganizationId === undefined ? <span>{SURFACE_COPY.nobodyRepresented}</span> : <bdi className="mono-identifier wrap-anywhere">{payload.representedOrganizationId}</bdi> },
    { term: INITIATIVE_COPY.purposeLabel, value: <span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{payload.purpose}</span> },
    { term: REQUESTED_TERMS_COPY.versionLabel, value: <bdi className="tabular-figures">{String(terms.version)}</bdi> },
    ...(nonFinancial === undefined
      ? [
          { term: REQUESTED_TERMS_COPY.currencyLabel, value: <bdi className="mono-identifier">{terms.currency ?? REQUESTED_TERMS_COPY.notStated}</bdi> },
          {
            term: REQUESTED_TERMS_COPY.amountLabel,
            value:
              amount === null ? (
                <span>{REQUESTED_TERMS_COPY.notStated}</span>
              ) : (
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2" title={amount.accessibleLabel}>
                  <bdi className="tabular-figures">{amount.text}</bdi>
                  <span className="text-muted-foreground">{SURFACE_COPY.minorUnitsNote}</span>
                  {amount.accessibleLabel === amount.text ? null : <span className="sr-only">{amount.accessibleLabel}</span>}
                </span>
              ),
          },
          { term: REQUESTED_TERMS_COPY.cadenceLabel, value: <span className="text-pretty">{cadenceValueFallback(terms.cadence ?? "")}</span> },
          { term: REQUESTED_TERMS_COPY.termLabel, value: <span className="text-pretty">{termValueFallback(terms.term ?? "")}</span> },
        ]
      : [{ term: REQUESTED_TERMS_COPY.nonFinancialLabel, value: <span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{nonFinancial.description}</span> }]),
  ];
  return <FactList className="flex min-w-0 flex-col gap-3 text-sm" rows={facts} row={(fact) => <ReviewFact key={fact.term} term={fact.term} value={fact.value} />} />;
}
/** The request composer: the form, the review that names what it will draft, and the receipt for one attempt. */ export default function RequestComposer({ initiativeId, envelope, onDrafted, onCheckResult, locale = "en-GB", headingLevel = 3, className }: RequestComposerProps): ReactElement {
  const scope = envelope.scope;
  const headingId = useId();
  const optionIdPrefix = useId();
  const noRecipientNoteId = useId();
  const draftAction = envelope.actions.find((action) => action.name === "draftRequest");
  const unavailableReason = draftAction === undefined || draftAction.available ? null : (draftAction.reason?.trim() ?? SURFACE_COPY.unavailableBody);
  const workingList = envelope.data.workingList.items;
  const eligible = useMemo(() => workingList.filter((member) => member.state === "included"), [workingList]);
  const form = useForm({ defaultValues: INITIAL_VALUES });
  const draft = useDraftRequest(scope);
  const submit = useAttemptSubmit(draft);
  const [step, setStep] = useState<"form" | "review">("form");
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [reviewed, setReviewed] = useState<{ readonly scope: Scope; readonly expectedRevision: string; readonly payload: DraftRequestPayload } | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setSettled(outcome);
      setErrors(outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null);
      if (outcome.outcome === "invalid") setStep("form");
      if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") onDrafted?.(outcome);
    },
    [onDrafted],
  );
  const reviewTheDetails = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const checked = draftRequestPayloadSchema.safeParse(payloadOf(initiativeId, form.state.values));
    if (!checked.success) {
      setErrors(errorsOf(checked.error));
      return;
    }
    setErrors(null);
    setReviewed({ scope, expectedRevision: envelope.revision, payload: checked.data });
    setSettled(null);
    setStep("review");
  };
  const returnToForm = useCallback((): void => {
    setReviewed(null);
    setSettled(null);
    setStep("form");
  }, []);
  const startAnother = useCallback((): void => {
    form.reset(INITIAL_VALUES);
    setErrors(null);
    returnToForm();
  }, [form, returnToForm]);
  const recipientOf = (partnerId: string): WorkingListMember | undefined => eligible.find((member) => member.partnerId === partnerId);
  const Heading = HEADING_TAG[headingLevel];
  const markedStatement = (statement: string): ReactElement => <li key={statement}>{statement}</li>;
  return (
    <section aria-labelledby={headingId} data-slot="request-composer" className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <Heading {...{ id: headingId, className: cn(HEADING_SCALE[headingLevel], "text-pretty") }}>{SURFACE_COPY.heading}</Heading>
        <p className="text-sm text-pretty text-muted-foreground">{SURFACE_COPY.intro}</p>
      </div>
      <ul className="flex min-w-0 flex-col gap-1 text-xs text-pretty text-muted-foreground">{[REQUESTED_TERMS_COPY.notReceivedSupport, RESPONSE_AGREEMENT_COPY.agreementCreatesNothing, SURFACE_COPY.draftCreatesNothing, SURFACE_COPY.lifecycle].map(markedStatement)}</ul>
      {unavailableReason !== null ? (
        <Alert>
          <AlertTitle>{SURFACE_COPY.unavailableTitle}</AlertTitle>
          <AlertDescription>{unavailableReason}</AlertDescription>
        </Alert>
      ) : step === "review" && reviewed !== null ? (
        <div className="flex min-w-0 flex-col gap-3">
          <ActionReview<DraftRequestPayload>
            title={SURFACE_COPY.reviewTitle}
            description={<ReviewedRequestFacts payload={reviewed.payload} recipient={recipientOf(reviewed.payload.recipientPartnerId)} locale={locale} />}
            confirmLabel={SURFACE_COPY.confirmLabel}
            cancelLabel={SURFACE_COPY.backLabel}
            onCancel={returnToForm}
            input={reviewed}
            submit={submit}
            onSettled={handleSettled}
            checkResult={onCheckResult}
            fieldLabels={FIELD_LABELS}
            headingLevel={headingLevel}
          />
          {settled === null || settled.outcome === "invalid" ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Button {...{ type: "button", variant: "outline", onClick: startAnother }}>{SURFACE_COPY.anotherLabel}</Button>
            </div>
          )}
        </div>
      ) : (
        <form noValidate className="flex min-w-0 flex-col gap-4" onSubmit={reviewTheDetails}>
          {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={4} />}
          {eligible.length === 0 ? (
            <Alert>
              <AlertTitle>{SURFACE_COPY.noRecipientTitle}</AlertTitle>
              <AlertDescription id={noRecipientNoteId}>{SURFACE_COPY.noRecipientBody}</AlertDescription>
            </Alert>
          ) : (
            <form.Field name="recipientPartnerId">
              {(field) => (
                <FormField name={RECIPIENT_FIELD} label={SURFACE_COPY.recipientLabel} description={SURFACE_COPY.recipientHelp} error={errors?.byField[RECIPIENT_FIELD]} required>
                  {(control) => (
                    <NativeSelect {...valuePropsOf(field, control)} name={RECIPIENT_FIELD} className="w-full" required={control.required}>
                      <NativeSelectOption value="">{SURFACE_COPY.recipientPlaceholder}</NativeSelectOption>
                      {eligible.map((member) => (
                        <NativeSelectOption key={member.memberId} value={member.partnerId}>
                          {member.partnerDisplayName}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              )}
            </form.Field>
          )}
          <form.Field name="representedOrganizationId">
            {(field) => (
              <FormField name={REPRESENTED_FIELD} label={SURFACE_COPY.representedLabel} description={SURFACE_COPY.representedHelp} error={errors?.byField[REPRESENTED_FIELD]} optionalHint>
                {(control) => <Input {...valuePropsOf(field, control)} name={REPRESENTED_FIELD} type="text" autoComplete="off" placeholder={SURFACE_COPY.representedPlaceholder} />}
              </FormField>
            )}
          </form.Field>
          <form.Field name="purpose">
            {(field) => (
              <FormField {...{ name: PURPOSE_FIELD, label: INITIATIVE_COPY.purposeLabel, description: SURFACE_COPY.purposeHelp, error: errors?.byField[PURPOSE_FIELD], required: true }}>{(control) => <Textarea {...valuePropsOf(field, control)} name={PURPOSE_FIELD} rows={4} required={control.required} />}</FormField>
            )}
          </form.Field>
          <form.Field name="version">
            {(field) => (
              <FormField name={VERSION_FIELD} label={REQUESTED_TERMS_COPY.versionLabel} description={SURFACE_COPY.versionHelp} error={errors?.byField[VERSION_FIELD]} required>
                {(control) => <Input {...valuePropsOf(field, control)} name={VERSION_FIELD} type="number" min={1} step={1} className="w-full sm:max-w-40" required={control.required} />}
              </FormField>
            )}
          </form.Field>
          <FormFieldGroup legend={REQUESTED_TERMS_COPY.heading} name={"terms"} description={SURFACE_COPY.termsHelp} error={errors?.byField[TERMS_GAP_FIELD]} required>
            {(group) => (
              <div className="flex min-w-0 flex-col gap-4">
                <form.Field name="termsShape">
                  {(field) => (
                    <RadioGroup
                      value={field.state.value}
                      onValueChange={(next) => {
                        if (!isTermsShape(next)) return;
                        field.handleChange(next);
                      }}
                      aria-labelledby={group.legendId}
                      aria-describedby={group.describedBy}
                      aria-invalid={group.invalid ? true : undefined}
                      aria-required={group.required ? true : undefined}
                    >
                      {TERMS_SHAPES.map((shape) => {
                        const wording = SURFACE_COPY.shapeCopy[shape];
                        const optionId = `${optionIdPrefix}-terms-${shape}`;
                        const hintId = `${optionId}-hint`;
                        return (
                          <label key={shape} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                            <RadioGroupItem id={optionId} value={shape} aria-label={wording.label} aria-describedby={hintId} className="mt-0.5" />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="text-sm font-medium text-pretty">{wording.label}</span>
                              <span {...{ id: hintId, className: "text-sm text-pretty text-muted-foreground" }}>{wording.hint}</span>
                            </span>
                          </label>
                        );
                      })}
                    </RadioGroup>
                  )}
                </form.Field>
                <form.Subscribe selector={(state) => state.values.termsShape}>
                  {(shape) =>
                    shape === "non-financial" ? (
                      <form.Field name="nonFinancialDescription">
                        {(field) => (
                          <FormField name={NON_FINANCIAL_FIELD} label={REQUESTED_TERMS_COPY.nonFinancialLabel} description={SURFACE_COPY.nonFinancialHelp} error={errors?.byField[NON_FINANCIAL_FIELD]} required>
                            {(control) => <Textarea {...valuePropsOf(field, control)} name={NON_FINANCIAL_FIELD} rows={4} required={control.required} />}
                          </FormField>
                        )}
                      </form.Field>
                    ) : (
                      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                        <form.Field name="currency">
                          {(field) => (
                            <FormField name={CURRENCY_FIELD} label={REQUESTED_TERMS_COPY.currencyLabel} description={SURFACE_COPY.currencyHelp} error={errors?.byField[CURRENCY_FIELD]} required>
                              {(control) => <Input {...valuePropsOf(field, control)} name={CURRENCY_FIELD} type="text" autoComplete="off" required={control.required} />}
                            </FormField>
                          )}
                        </form.Field>
                        <form.Field name="minorUnits">
                          {(field) => (
                            <form.Subscribe selector={(state) => state.values.currency}>
                              {(currency) => {
                                const echo = statedAmountOf(currency, minorUnitsTextOf(field.state.value), locale);
                                return (
                                  <FormField name={AMOUNT_FIELD} label={REQUESTED_TERMS_COPY.amountLabel} description={SURFACE_COPY.amountHelp} error={errors?.byField[AMOUNT_FIELD]} required>
                                    {(control) => {
                                      const echoId = `${control.id}-echo`;
                                      const describedBy = echo === null ? control.describedBy : control.describedBy === undefined ? echoId : `${control.describedBy} ${echoId}`;
                                      return (
                                        <div className="flex min-w-0 flex-col gap-1.5">
                                          <Input {...valuePropsOf(field, control)} name={AMOUNT_FIELD} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" required={control.required} aria-describedby={describedBy} />
                                          {echo === null ? null : (
                                            <p id={echoId} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
                                              {SURFACE_COPY.amountEchoIntro} <bdi className="tabular-figures">{echo.text}</bdi>
                                            </p>
                                          )}
                                        </div>
                                      );
                                    }}
                                  </FormField>
                                );
                              }}
                            </form.Subscribe>
                          )}
                        </form.Field>
                        <form.Field name="cadence">
                          {(field) => (
                            <FormField name={CADENCE_FIELD} label={REQUESTED_TERMS_COPY.cadenceLabel} description={SURFACE_COPY.cadenceHelp} error={errors?.byField[CADENCE_FIELD]} optionalHint>
                              {(control) => <Input {...valuePropsOf(field, control)} name={CADENCE_FIELD} type="text" autoComplete="off" />}
                            </FormField>
                          )}
                        </form.Field>
                        <form.Field name="term">
                          {(field) => (
                            <FormField {...{ name: TERM_FIELD, label: REQUESTED_TERMS_COPY.termLabel, description: SURFACE_COPY.termHelp, error: errors?.byField[TERM_FIELD], optionalHint: true }}>{(control) => <Input {...valuePropsOf(field, control)} name={TERM_FIELD} type="text" autoComplete="off" />}</FormField>
                          )}
                        </form.Field>
                      </div>
                    )
                  }
                </form.Subscribe>
              </div>
            )}
          </FormFieldGroup>
          <div className="flex flex-wrap items-center gap-2">
            <Button {...{ type: "submit", disabled: eligible.length === 0, "aria-describedby": eligible.length === 0 ? noRecipientNoteId : undefined }}>{SURFACE_COPY.reviewLabel}</Button>
          </div>
        </form>
      )}
    </section>
  );
}
