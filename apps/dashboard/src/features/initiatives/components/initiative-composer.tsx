"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
import ActionReview from "@/components/action-review";
import FormField, { civilDateConvention, fieldControlId, fieldErrorsFromInvalid, FormErrorSummary, FormFieldGroup, type FieldErrorLookup, type FormFieldControl } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { MutationOutcome, reads } from "@/modules/data-service";
import { INITIATIVE_COPY } from "../copy";
import { useAttemptSubmit, useCreateInitiative } from "../hooks/use-initiative-mutations";
import { createInitiativePayloadSchema, type CreateInitiativePayload } from "../schemas/initiative";
import DiscardConfirmation from "./discard-confirmation";
import { errorsOf, ReviewFact } from "./figures";
type InitiativeListEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiatives>>, { readonly kind: "envelope" }>["envelope"];
const CREATE_INITIATIVE = "createInitiative";
type ComposerStep = "form" | "review" | "discard";
type InitiativeFormValues = { name: string; purpose: string; responsiblePrincipalId: string; startOn: string; endOn: string };
type SettledEffect = { readonly kind: "invalid" } | { readonly kind: "created"; readonly initiativeId: string | null } | { readonly kind: "receipt" };
export type InitiativeComposerProps = { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly envelope: InitiativeListEnvelope; readonly onCreated?: (initiativeId: string) => void };
const NAME_FIELD = "name";
const PURPOSE_FIELD = "purpose";
const RESPONSIBLE_FIELD = "responsiblePrincipalId";
const PERIOD_FIELD = "period";
const START_FIELD = "period.startOn";
const END_FIELD = "period.endOn";
const FIELD_ORDER = [NAME_FIELD, PURPOSE_FIELD, RESPONSIBLE_FIELD, START_FIELD, END_FIELD] as const;
const START_DATE_LABEL = "Start date";
const END_DATE_LABEL = "End date";
const FIELD_LABELS: Readonly<Record<string, string>> = { [NAME_FIELD]: INITIATIVE_COPY.nameLabel, [PURPOSE_FIELD]: INITIATIVE_COPY.purposeLabel, [RESPONSIBLE_FIELD]: INITIATIVE_COPY.responsibleLabel, [START_FIELD]: START_DATE_LABEL, [END_FIELD]: END_DATE_LABEL };
const DIALOG_DESCRIPTION = "A named purpose inside the ministry you are acting in, with the person responsible and an optional period of dates. Creating an initiative records no pledge, gift, commitment, membership, notification, task or send.";
const SCOPE_LABEL = "Ministry";
const SCOPE_NOTE = "This is the ministry from the selected context. It is stated here and is not a field, because a form may never name a context the session is not admitted to.";
const NAME_DESCRIPTION = "What this outreach is called — up to 200 characters.";
const PURPOSE_DESCRIPTION = "What it is for, in your own words — up to 2,000 characters.";
const SINGLE_PRINCIPAL_DESCRIPTION = "The acting principal is the only person this release admits as responsible, because an initiative carries no delegation. It is shown by its opaque reference and is already selected.";
const PERIOD_DESCRIPTION = "Optional calendar dates, with no time of day and no zone behind them. Leave both empty when the initiative has no period; filling one requires the other.";
const START_DATE_DESCRIPTION = "The first civil date of the initiative, as YYYY-MM-DD.";
const END_DATE_DESCRIPTION = "The last civil date of the initiative, as YYYY-MM-DD. It cannot be before the start date.";
const CANCEL_LABEL = "Cancel";
const REVIEW_LABEL = "Review and create";
const REVIEW_TITLE = "Review this new initiative";
const CONFIRM_LABEL = "Create initiative";
const BACK_LABEL = "Back to the details";
const CLOSE_LABEL = "Close";
const DONE_LABEL = "Done";
const OPEN_LABEL = "Open the initiative";
const KEEP_EDITING_LABEL = "Keep editing";
const DISCARD_LABEL = "Discard and close";
const DISCARD_TITLE = "Discard what you entered?";
const DISCARD_BODY = "Nothing has been created yet. Going back keeps every value you entered; discarding closes this form and loses them.";
const UNAVAILABLE_TITLE = "An initiative cannot be created here";
const NO_PERIOD_TEXT = "No period: this initiative has no start date and no end date.";
const CIVIL_DATE_NOTE = "civil dates, shown exactly as entered";
const SCOPE_FACT_NOTE = "the ministry from the selected context";
type ControlAria = { readonly "aria-describedby": string | undefined; readonly "aria-invalid": true | undefined };
const controlAria = (control: FormFieldControl): ControlAria => ({ "aria-describedby": control.describedBy, "aria-invalid": control.invalid ? true : undefined });
const defaultValuesFor = (actingPrincipalId: string): InitiativeFormValues => ({ name: "", purpose: "", responsiblePrincipalId: actingPrincipalId, startOn: "", endOn: "" });
function payloadOf(values: InitiativeFormValues): CreateInitiativePayload {
  const base = { name: values.name, purpose: values.purpose, responsiblePrincipalId: values.responsiblePrincipalId };
  const startOn = values.startOn.trim();
  const endOn = values.endOn.trim();
  return startOn === "" && endOn === "" ? base : { ...base, period: { startOn, endOn } };
}
function settledEffectOf(outcome: MutationOutcome): SettledEffect {
  if (outcome.outcome === "invalid") return { kind: "invalid" };
  if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") return { kind: "created", initiativeId: outcome.created?.[0] ?? null };
  return { kind: "receipt" };
}
function ReviewSummary({ payload, ministryId, organizationId }: { readonly payload: CreateInitiativePayload; readonly ministryId: string; readonly organizationId: string }): ReactElement {
  const period = payload.period;
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      <ReviewFact label={INITIATIVE_COPY.nameLabel} value={<span className="wrap-anywhere">{payload.name}</span>} />
      <ReviewFact label={INITIATIVE_COPY.purposeLabel} value={<span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{payload.purpose}</span>} />
      <ReviewFact label={INITIATIVE_COPY.responsibleLabel} value={<bdi className="mono-identifier wrap-anywhere">{payload.responsiblePrincipalId}</bdi>} />
      <ReviewFact
        label={INITIATIVE_COPY.periodLabel}
        value={
          period === undefined ? (
            <span>{NO_PERIOD_TEXT}</span>
          ) : (
            <span className="flex min-w-0 flex-wrap items-baseline gap-1">
              {" "}
              <bdi className="mono-identifier">{period.startOn}</bdi> <span aria-hidden="true">–</span> <bdi className="mono-identifier">{period.endOn}</bdi> <span className="text-muted-foreground">{`(${CIVIL_DATE_NOTE})`}</span>{" "}
            </span>
          )
        }
      />
      <ReviewFact
        label={SCOPE_LABEL}
        value={
          <span className="flex min-w-0 flex-col gap-1">
            {" "}
            <bdi className="mono-identifier wrap-anywhere">{ministryId}</bdi>{" "}
            <span className="text-muted-foreground">
              {" "}
              {"in organisation "} <bdi className="mono-identifier wrap-anywhere">{organizationId}</bdi> {` — ${SCOPE_FACT_NOTE}`}{" "}
            </span>{" "}
          </span>
        }
      />
    </dl>
  );
}
/** The create step: the form, the review that names what it will create, and the receipt for one attempt. */
export default function InitiativeComposer({ open, onOpenChange, envelope, onCreated }: InitiativeComposerProps): ReactElement {
  const scope = envelope.scope;
  const actingPrincipalId = scope.principalId;
  const ministryId = scope.ministryId;
  const organizationId = scope.organizationId;
  const expectedRevision = envelope.revision;
  const createAction = envelope.actions.find((action) => action.name === CREATE_INITIATIVE);
  const unavailableReason = createAction === undefined || createAction.available ? null : (createAction.reason?.trim() ?? "This read does not admit the create action, so no form is offered.");
  const admittedPrincipals = useMemo(() => [actingPrincipalId], [actingPrincipalId]);
  const form = useForm({ defaultValues: defaultValuesFor(actingPrincipalId) });
  const create = useCreateInitiative(scope);
  const submit = useAttemptSubmit(create);
  const [step, setStep] = useState<ComposerStep>("form");
  const [edited, setEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [reviewed, setReviewed] = useState<CreateInitiativePayload | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const keepEditingPending = useRef(false);
  const resetVisit = (): void => {
    form.reset(defaultValuesFor(actingPrincipalId));
    setStep("form");
    setEdited(false);
    setErrors(null);
    setReviewed(null);
    setSettled(null);
  };
  useEffect(() => {
    if (!keepEditingPending.current) return;
    keepEditingPending.current = false;
    if (!open || step !== "form") return;
    document.getElementById(fieldControlId(NAME_FIELD))?.focus();
  }, [step, open]);
  const handleSettled = useCallback((outcome: MutationOutcome): void => {
    setSettled(outcome);
    if (outcome.outcome === "invalid") {
      setErrors(fieldErrorsFromInvalid(outcome));
      setStep("form");
      return;
    }
    setErrors(null);
    if (settledEffectOf(outcome).kind === "created") setEdited(false);
  }, []);
  const reviewTheDetails = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const checked = createInitiativePayloadSchema.safeParse(payloadOf(form.state.values));
    if (!checked.success) {
      setErrors(errorsOf(checked.error));
      return;
    }
    setErrors(null);
    setReviewed(checked.data);
    setEdited(true);
    setStep("review");
  };
  const requestClose = (): void => {
    if (edited) setStep("discard");
    else onOpenChange(false);
  };
  const handleOpenChange = (next: boolean): void => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (step === "discard") {
      setStep("form");
      return;
    }
    requestClose();
  };
  const keepEditing = (): void => {
    keepEditingPending.current = true;
    setStep("form");
  };
  const discardAndClose = (): void => {
    setEdited(false);
    setStep("form");
    onOpenChange(false);
  };
  const finish = (): void => {
    setEdited(false);
    onOpenChange(false);
  };
  const markEdited = (): void => setEdited(true);
  const entryOf = (field: { readonly state: { readonly value: string }; handleChange: (value: string) => void; handleBlur: () => void }) => ({
    value: field.state.value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      field.handleChange(event.currentTarget.value);
      markEdited();
    },
    onBlur: field.handleBlur,
  });
  const settledEffect = settled === null ? null : settledEffectOf(settled);
  const createdId = settledEffect !== null && settledEffect.kind === "created" ? settledEffect.initiativeId : null;
  const openCreated = (): void => {
    if (createdId === null) return;
    setEdited(false);
    onCreated?.(createdId);
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={(nextOpen: boolean) => {
        if (!nextOpen) resetVisit();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{INITIATIVE_COPY.createLabel}</DialogTitle>
          <DialogDescription>{DIALOG_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        {unavailableReason !== null ? (
          <div className="flex min-w-0 flex-col gap-4">
            <Alert>
              <AlertTitle>{UNAVAILABLE_TITLE}</AlertTitle>
              <AlertDescription>{unavailableReason}</AlertDescription>
            </Alert>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={finish}>
                {CLOSE_LABEL}
              </Button>
            </DialogFooter>
          </div>
        ) : step === "review" && reviewed !== null ? (
          <div className="flex min-w-0 flex-col gap-4">
            <ActionReview<CreateInitiativePayload>
              title={REVIEW_TITLE}
              description={<ReviewSummary payload={reviewed} ministryId={ministryId} organizationId={organizationId} />}
              confirmLabel={CONFIRM_LABEL}
              cancelLabel={BACK_LABEL}
              onCancel={() => {
                setStep("form");
                setSettled(null);
              }}
              input={{ scope, expectedRevision, payload: reviewed }}
              submit={submit}
              onSettled={handleSettled}
              fieldLabels={FIELD_LABELS}
              headingLevel={3}
            />
            {settledEffect === null ? null : (
              <div className="flex flex-wrap items-center gap-2">
                {settledEffect.kind === "created" && createdId !== null && onCreated !== undefined ? (
                  <Button type="button" onClick={openCreated}>
                    {OPEN_LABEL}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={finish}>
                  {settledEffect.kind === "created" ? DONE_LABEL : CLOSE_LABEL}
                </Button>
              </div>
            )}
          </div>
        ) : step === "discard" ? (
          <DiscardConfirmation title={DISCARD_TITLE} body={DISCARD_BODY} keepEditingLabel={KEEP_EDITING_LABEL} discardLabel={DISCARD_LABEL} onKeepEditing={keepEditing} onDiscard={discardAndClose} />
        ) : (
          <form noValidate className="flex min-w-0 flex-col gap-4" onSubmit={reviewTheDetails}>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="flex min-w-0 flex-wrap items-baseline gap-1">
                <span className="text-muted-foreground">{`${SCOPE_LABEL}: `}</span>
                <bdi className="mono-identifier wrap-anywhere">{ministryId}</bdi>
              </p>
              <p className="text-pretty text-muted-foreground">{SCOPE_NOTE}</p>
            </div>
            {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={3} />}
            <form.Field name="name">
              {(field) => (
                <FormField name={NAME_FIELD} label={INITIATIVE_COPY.nameLabel} description={NAME_DESCRIPTION} error={errors?.byField[NAME_FIELD]} required>
                  {(control) => <Input id={control.id} name={NAME_FIELD} type="text" autoComplete="off" required={control.required} {...entryOf(field)} {...controlAria(control)} />}
                </FormField>
              )}
            </form.Field>
            <form.Field name="purpose">
              {(field) => (
                <FormField name={PURPOSE_FIELD} label={INITIATIVE_COPY.purposeLabel} description={PURPOSE_DESCRIPTION} error={errors?.byField[PURPOSE_FIELD]} required>
                  {(control) => <Textarea id={control.id} name={PURPOSE_FIELD} rows={5} required={control.required} {...entryOf(field)} {...controlAria(control)} />}
                </FormField>
              )}
            </form.Field>
            <form.Field name="responsiblePrincipalId">
              {(field) => (
                <FormField name={RESPONSIBLE_FIELD} label={INITIATIVE_COPY.responsibleLabel} description={SINGLE_PRINCIPAL_DESCRIPTION} error={errors?.byField[RESPONSIBLE_FIELD]} required>
                  {(control) => (
                    <NativeSelect id={control.id} name={RESPONSIBLE_FIELD} className="w-full" required={control.required} {...entryOf(field)} {...controlAria(control)}>
                      {admittedPrincipals.map((principalId) => (
                        <NativeSelectOption key={principalId} value={principalId}>
                          {principalId}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              )}
            </form.Field>
            <FormFieldGroup legend={INITIATIVE_COPY.periodLabel} name={PERIOD_FIELD} description={PERIOD_DESCRIPTION} optionalHint>
              {() => (
                <>
                  <form.Field name="startOn">
                    {(field) => (
                      <FormField name={START_FIELD} label={START_DATE_LABEL} description={`${START_DATE_DESCRIPTION} ${civilDateConvention(field.state.value)}`} error={errors?.byField[START_FIELD]}>
                        {(control) => <Input id={control.id} name={START_FIELD} type="date" {...entryOf(field)} {...controlAria(control)} />}
                      </FormField>
                    )}
                  </form.Field>
                  <form.Field name="endOn">
                    {(field) => (
                      <FormField name={END_FIELD} label={END_DATE_LABEL} description={`${END_DATE_DESCRIPTION} ${civilDateConvention(field.state.value)}`} error={errors?.byField[END_FIELD]}>
                        {(control) => <Input id={control.id} name={END_FIELD} type="date" {...entryOf(field)} {...controlAria(control)} />}
                      </FormField>
                    )}
                  </form.Field>
                </>
              )}
            </FormFieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={requestClose}>
                {CANCEL_LABEL}
              </Button>
              <Button type="submit">{REVIEW_LABEL}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
