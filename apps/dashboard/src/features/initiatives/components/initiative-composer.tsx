"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactElement, type ReactNode } from "react";
import type { ZodError } from "zod";
import { useForm } from "@tanstack/react-form";
import ActionReview from "@/components/action-review";
import FormField, { fieldControlId, fieldErrorsFromInvalid, FormErrorSummary, FormFieldGroup, type FieldErrorLookup, type FormFieldControl } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { assertNever } from "@/lib/result";
import type { MutationInput, MutationOutcome, reads } from "@/modules/data-service";
import { INITIATIVE_COPY } from "../copy";
import { useCreateInitiative } from "../hooks/use-initiative-mutations";
import { createInitiativePayloadSchema, type CreateInitiativePayload } from "../schemas/initiative";
type InitiativeListEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiatives>>, { readonly kind: "envelope" }>["envelope"];
/** The create action this composer submits, as the read names it. */
const CREATE_INITIATIVE = "createInitiative";
type ComposerStep = "form" | "review" | "discard";
type InitiativeFormValues = { name: string; purpose: string; responsiblePrincipalId: string; startOn: string; endOn: string };
type SettledEffect = { readonly kind: "invalid" } | { readonly kind: "created"; readonly initiativeId: string | null } | { readonly kind: "receipt" };
export interface InitiativeComposerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly envelope: InitiativeListEnvelope;
  readonly onCreated?: (initiativeId: string) => void;
}
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
// Wording this step owns: the form's own sentences, never a closed vocabulary another surface states
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
interface ControlAria {
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
}
/** The aria wiring every control under a `FormField` carries, so its description and invalid state are never dropped. */
function controlAria(control: FormFieldControl): ControlAria {
  return { "aria-describedby": control.describedBy, "aria-invalid": control.invalid ? true : undefined };
}
function defaultValuesFor(actingPrincipalId: string): InitiativeFormValues {
  return { name: "", purpose: "", responsiblePrincipalId: actingPrincipalId, startOn: "", endOn: "" };
}
function payloadOf(values: InitiativeFormValues): CreateInitiativePayload {
  const base = { name: values.name, purpose: values.purpose, responsiblePrincipalId: values.responsiblePrincipalId };
  const startOn = values.startOn.trim();
  const endOn = values.endOn.trim();
  if (startOn === "" && endOn === "") return base;
  return { ...base, period: { startOn, endOn } };
}
function lookupOf(error: ZodError): FieldErrorLookup {
  const byField: Record<string, string[]> = {};
  const form: string[] = [];
  for (const issue of error.issues) {
    const path = issue.path.map((segment) => String(segment)).join(".");
    if (path === "") {
      if (!form.includes(issue.message)) form.push(issue.message);
      continue;
    }
    const messages = byField[path];
    if (messages === undefined) {
      byField[path] = [issue.message];
      continue;
    }
    if (!messages.includes(issue.message)) messages.push(issue.message);
  }
  return { byField, form, count: Object.keys(byField).length + form.length };
}
function settledEffectOf(outcome: MutationOutcome): SettledEffect {
  switch (outcome.outcome) {
    case "invalid":
      return { kind: "invalid" };
    case "accepted":
    case "alreadyAccepted": {
      const created = outcome.created ?? [];
      const [initiativeId] = created;
      return { kind: "created", initiativeId: initiativeId ?? null };
    }
    case "unchanged":
    case "conflict":
    case "denied":
    case "unavailable":
    case "unknown":
      return { kind: "receipt" };
    default:
      return assertNever(outcome);
  }
}
function ReviewFact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
function ReviewSummary({ payload, ministryId, organizationId }: { readonly payload: CreateInitiativePayload; readonly ministryId: string; readonly organizationId: string }): ReactElement {
  const period = payload.period;
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      <ReviewFact label={INITIATIVE_COPY.nameLabel}>
        <span className="wrap-anywhere">{payload.name}</span>
      </ReviewFact>
      <ReviewFact label={INITIATIVE_COPY.purposeLabel}>
        <span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{payload.purpose}</span>
      </ReviewFact>
      <ReviewFact label={INITIATIVE_COPY.responsibleLabel}>
        <bdi className="mono-identifier wrap-anywhere">{payload.responsiblePrincipalId}</bdi>
      </ReviewFact>
      <ReviewFact label={INITIATIVE_COPY.periodLabel}>
        {period === undefined ? (
          <span>{NO_PERIOD_TEXT}</span>
        ) : (
          <span className="flex min-w-0 flex-wrap items-baseline gap-1">
            <bdi className="mono-identifier">{period.startOn}</bdi>
            <span aria-hidden="true">–</span>
            <bdi className="mono-identifier">{period.endOn}</bdi>
            <span className="text-muted-foreground">{`(${CIVIL_DATE_NOTE})`}</span>
          </span>
        )}
      </ReviewFact>
      <ReviewFact label={SCOPE_LABEL}>
        <span className="flex min-w-0 flex-col gap-1">
          <bdi className="mono-identifier wrap-anywhere">{ministryId}</bdi>
          <span className="text-muted-foreground">
            {"in organisation "}
            <bdi className="mono-identifier wrap-anywhere">{organizationId}</bdi>
            {` — ${SCOPE_FACT_NOTE}`}
          </span>
        </span>
      </ReviewFact>
    </dl>
  );
}
function DiscardConfirmation({ onKeepEditing, onDiscard }: { readonly onKeepEditing: () => void; readonly onDiscard: () => void }): ReactElement {
  const headingId = useId();
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    frameRef.current?.focus();
  }, []);
  return (
    <section ref={frameRef} aria-labelledby={headingId} tabIndex={-1} className="flex min-w-0 flex-col gap-4 outline-none">
      <h3 id={headingId} className="text-base font-medium">
        {DISCARD_TITLE}
      </h3>
      <p className="text-sm text-pretty text-muted-foreground">{DISCARD_BODY}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" onClick={onKeepEditing}>
          {KEEP_EDITING_LABEL}
        </Button>
        <Button type="button" variant="outline" onClick={onDiscard}>
          {DISCARD_LABEL}
        </Button>
      </div>
    </section>
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
  // A read that says the action is unavailable is answered with the reason it states, rather than with a form that could only fail.
  const unavailableReason = createAction === undefined || createAction.available ? null : (createAction.reason?.trim() ?? "This read does not admit the create action, so no form is offered.");
  const admittedPrincipals = useMemo(() => [actingPrincipalId], [actingPrincipalId]);
  const form = useForm({ defaultValues: defaultValuesFor(actingPrincipalId) });
  const create = useCreateInitiative(scope);
  const [step, setStep] = useState<ComposerStep>("form");
  const [edited, setEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [reviewed, setReviewed] = useState<CreateInitiativePayload | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const awaiting = useRef<{ readonly operationId: string; readonly resolve: (outcome: MutationOutcome) => void } | null>(null);
  const keepEditingPending = useRef(false);
  const settledFromHook = create.state.status === "settled" ? create.state.outcome : null;
  const resetVisit = (): void => {
    form.reset(defaultValuesFor(actingPrincipalId));
    setStep("form");
    setEdited(false);
    setErrors(null);
    setReviewed(null);
    setSettled(null);
    awaiting.current = null;
  };
  useEffect(() => {
    const waiting = awaiting.current;
    if (settledFromHook === null || waiting === null || waiting.operationId !== settledFromHook.operationId) return;
    awaiting.current = null;
    waiting.resolve(settledFromHook);
  }, [settledFromHook]);
  // Answering the discard question with "Keep editing" returns the keyboard position to the first field, because the element that held it is gone once the form comes back.
  useEffect(() => {
    if (!keepEditingPending.current) return;
    keepEditingPending.current = false;
    if (!open || step !== "form") return;
    document.getElementById(fieldControlId(NAME_FIELD))?.focus();
  }, [step, open]);
  const submitCreate = create.submit;
  const submit = useCallback(
    (input: MutationInput<CreateInitiativePayload>): Promise<MutationOutcome> =>
      new Promise<MutationOutcome>((resolve) => {
        awaiting.current = { operationId: input.operationId, resolve };
        submitCreate({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
      }),
    [submitCreate],
  );
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
      // An obviously invalid form never reaches the route and mints no attempt for itself.
      setErrors(lookupOf(checked.error));
      return;
    }
    setErrors(null);
    setReviewed(checked.data);
    setEdited(true);
    setStep("review");
  };
  const requestClose = (): void => {
    if (!edited) {
      onOpenChange(false);
      return;
    }
    setStep("discard");
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
            {settledEffect === null ? null : settledEffect.kind === "created" ? (
              <div className="flex flex-wrap items-center gap-2">
                {onCreated === undefined || createdId === null ? null : (
                  <Button type="button" onClick={openCreated}>
                    {OPEN_LABEL}
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={finish}>
                  {DONE_LABEL}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={finish}>
                  {CLOSE_LABEL}
                </Button>
              </div>
            )}
          </div>
        ) : step === "discard" ? (
          <DiscardConfirmation onKeepEditing={keepEditing} onDiscard={discardAndClose} />
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
                      <FormField name={START_FIELD} label={START_DATE_LABEL} description={START_DATE_DESCRIPTION} error={errors?.byField[START_FIELD]}>
                        {(control) => <Input id={control.id} name={START_FIELD} type="date" {...entryOf(field)} {...controlAria(control)} />}
                      </FormField>
                    )}
                  </form.Field>
                  <form.Field name="endOn">
                    {(field) => (
                      <FormField name={END_FIELD} label={END_DATE_LABEL} description={END_DATE_DESCRIPTION} error={errors?.byField[END_FIELD]}>
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
