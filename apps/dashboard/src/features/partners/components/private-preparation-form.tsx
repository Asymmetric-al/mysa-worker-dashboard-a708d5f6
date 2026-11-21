"use client";
/**
 * The form that creates one worker-private preparation record from a name alone: a required name, optional contact
 * methods that each state whether they may be used, an optional opening note, and one receipt for the settled
 * attempt. A private preparation record may exist with no shared identity, so this form creates a record and says so
 * plainly: it records no shared identity, no membership and no consent.
 */
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { fieldErrorsFromInvalid, FormField, FormFieldGroup, type FieldErrorLookup } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import { CONTACT_METHOD_KINDS, type ContactMethodKind, type Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { PRIVATE_RECORD_COPY } from "../copy/privacy";
import { FORM_OUTCOME_COPY, PARTNER_ACTION_LABELS } from "../copy/states";
import { useCreatePrivatePreparation } from "../hooks/use-partner-mutations";
import type { CreatePrivatePreparationPayload, PreparationContactMethod } from "../schemas/preparation";

/** The address of a partner record's own page, so the receipt can name where the created preparation lives. */
const PARTNERS_HREF = "/partners";
const NAME_FIELD = "displayName";
const NOTE_FIELD = "note";
const METHODS_FIELD = "contactMethods";
const SECTION_HEADING = PARTNER_ACTION_LABELS.addPrivateContact;
const FORM_LEAD = "A name is the only thing this needs. Everything else is optional, and you can add or change it later.";
const NAME_LABEL = "Name";
const NAME_DESCRIPTION = "What you will recognise this person by. No email address, phone number or other detail is required.";
const NOTE_LABEL = "Opening note";
const NOTE_DESCRIPTION = "Anything you already know or have decided, written for yourself. " + PRIVATE_RECORD_COPY.noteIsPrivate.body;
const METHODS_LEGEND = "Contact methods";
const METHODS_HELP = "Optional. Each detail you add states whether it may be used to reach the person. " + "Adding a detail here contacts no one, subscribes no one and records no consent.";
const EMPTY_METHODS_NOTE = "No contact method is recorded. A name alone is a complete private contact, so this form can be submitted as it is.";
const KIND_LABEL = "Kind";
const KIND_DESCRIPTION = "What sort of detail this is: an email address, a phone number or a postal address.";
const VALUE_LABEL = "Value";
const VALUE_DESCRIPTION = "The address, number or postal detail itself. Nothing here verifies it, so it states what you know rather than a confirmed detail.";
const PERMITTED_LABEL = "Permitted for contact";
const PERMITTED_DESCRIPTION = "Whether this detail may be used to reach the person. It is a fact about contactability only: it is not communication consent and not a reader grant.";
const ADD_METHOD_LABEL = "Add a contact method";
const METHODS_LIMIT_NOTE = "A row you add can be removed again, and removing one leaves every other row exactly as you wrote it.";
const SUBMIT_LABEL = PARTNER_ACTION_LABELS.addPrivateContact;
const SUBMIT_PENDING_LABEL = "Adding the private contact";
const ACTION_NOTE = "Adding the contact creates one private preparation record. It sends no message, subscribes no one, " + "creates no financial record and grants no one else access to anything.";
const RESUBMIT_NOTE = "The receipt above stands for the record this form already created. Changing these details and " + "adding again creates a second private contact rather than changing the first one.";
const UNCONFIRMED_NOTE = "Adding is paused until the result above is checked, because this attempt may already have created the contact. " + "Checking it reads what happened and applies nothing.";
const CHECK_RESULT_LABEL = "Check the result";
const NO_SHARED_IDENTITY = "Adding a contact here creates no shared identity: no partner, household, organization or membership is created beside it, " + "and no communication consent or reader grant is recorded.";
const CREATED_TITLE = "Created: one private preparation record";
const CREATED_BODY = "It is a private preparation record and the only record this form created. It has no shared identity, no household, " + "no organization and no membership, and no communication consent or reader grant was recorded.";
const CREATED_REFERENCE_LABEL = "Its reference is";
const CREATED_ROUTE_LABEL = "Its page is";
const OPEN_RECORD_LABEL = "Open the private contact";
const CREATED_REFERENCE_UNSTATED = "The result did not state the new record's reference, so the partner roster is where to find it.";
const DENIED_TITLE = "A private contact was not added here";
const DENIED_BODY = "Private preparation is created inside the ministry that admits it, and the ministry selected in this session " + "does not, so nothing was created. A refusal here says nothing about what exists anywhere else.";
const ROW_LEGEND_PREFIX = "Contact method";
const CONTACT_KIND_LABELS: Readonly<Record<ContactMethodKind, string>> = { email: "Email address", phone: "Phone number", postal: "Postal address" };
/** The keyboard a phone or a tablet offers for a value of each kind; the value itself is never reformatted or verified. */
const CONTACT_KIND_INPUT_MODES: Readonly<Record<ContactMethodKind, "email" | "tel" | "text">> = { email: "email", phone: "tel", postal: "text" };
/** The kind an added row starts at, taken from the closed vocabulary rather than written out a second time. */
const CONTACT_KIND_DEFAULT: ContactMethodKind = CONTACT_METHOD_KINDS[0] ?? "email";

/** The four outcomes an edit clears: the attempt has settled without an effect this person needs to keep reading. */
const CLEAR_ON_EDIT: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["invalid", "conflict", "denied", "unavailable"]);

/** One contact-method row as the form holds it: the payload's own members, plus a key that survives a removal. */
type ContactMethodRow = PreparationContactMethod & { readonly rowKey: string };

/** Everything the form owns while it is being filled. */
interface PreparationFormValues {
  displayName: string;
  contactMethods: ContactMethodRow[];
  note: string;
}

/** Values a composing route may hand back, for the Redundant Entry case where the form is returned to after an interruption. */
export interface PrivatePreparationInitialValues {
  readonly displayName?: string;
  readonly contactMethods?: readonly PreparationContactMethod[];
  readonly note?: string;
}

/** Props of {@link PrivatePreparationForm}. */
export type PrivatePreparationFormProps = {
  /** The organisation, ministry, support subject and principal the attempt is made in; the service re-derives and re-checks all four. */
  readonly scope: Scope;
  /** The revision the composing read saw, presented with every attempt. A creation writes a new record, so it compares against nothing. */
  readonly expectedRevision: string;
  readonly initialValues?: PrivatePreparationInitialValues;
  /** Called once with the created record's opaque reference when an attempt settles as created or already created. */
  readonly onCreated?: (partnerRef: string) => void;
  /** The direction the composing route states; it is set on this section only and never on a child's styles. */
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
};

/** The method-kind a typed value names, or `null` when it names none the vocabulary holds. */
function contactKindOf(value: string): ContactMethodKind | null {
  return CONTACT_METHOD_KINDS.find((kind) => kind === value) ?? null;
}

/** The row key a row added at `sequence` carries, so removing one row never re-keys another. */
function rowKeyAt(sequence: number): string {
  return `method-${String(sequence)}`;
}

/** The form's opening values, from the caller's own values where it states any. */
function valuesOf(initial: PrivatePreparationInitialValues | undefined): PreparationFormValues {
  const methods = initial?.contactMethods ?? [];
  return { displayName: initial?.displayName ?? "", contactMethods: methods.map((method, index) => ({ kind: method.kind, value: method.value, permitted: method.permitted, rowKey: rowKeyAt(index) })), note: initial?.note ?? "" };
}

/** The change this form asks for: a name, the contact methods it holds, and an opening note only when one was written. */
function payloadOf(values: PreparationFormValues): CreatePrivatePreparationPayload {
  const methods: PreparationContactMethod[] = values.contactMethods.map((row) => ({ kind: row.kind, value: row.value.trim(), permitted: row.permitted }));
  const note = values.note.trim();
  const displayName = values.displayName.trim();
  return { displayName, ...(methods.length === 0 ? {} : { contactMethods: methods }), ...(note === "" ? {} : { note }) };
}

/**
 * The created record's opaque reference, taken from the change's own report and never inferred from a name or an
 * address. A creation reports the new record first, before the opening note it also created.
 */
function createdReferenceOf(outcome: MutationOutcome): string | null {
  if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") {
    return null;
  }
  const named = (outcome.created ?? []).find((reference) => reference.trim() !== "");
  if (named !== undefined) {
    return named;
  }
  if (outcome.outcome !== "alreadyAccepted") {
    return null;
  }
  // A replay answers with the result stored for the operation, which states the same reference the first answer did.
  const stored: unknown = outcome.result;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return null;
  }
  const reference: unknown = Reflect.get(stored, "partnerId");
  return typeof reference === "string" && reference.trim() !== "" ? reference : null;
}

/** The labels a refusal's per-field messages are introduced by, including one entry per contact-method row on the form. */
function fieldLabelsFor(rowCount: number): Readonly<Record<string, string | undefined>> {
  const labels: Record<string, string | undefined> = { [NAME_FIELD]: NAME_LABEL, [NOTE_FIELD]: NOTE_LABEL, [METHODS_FIELD]: METHODS_LEGEND };
  for (let index = 0; index < rowCount; index += 1) {
    const row = `${METHODS_FIELD}.${String(index)}`;
    const legend = `${ROW_LEGEND_PREFIX} ${String(index + 1)}`;
    labels[row] = legend;
    labels[`${row}.kind`] = `${legend} ${KIND_LABEL.toLowerCase()}`;
    labels[`${row}.value`] = `${legend} value`;
    labels[`${row}.permitted`] = `${legend} ${PERMITTED_LABEL.toLowerCase()}`;
  }
  return labels;
}

/** One contact-method row: its kind, its value and whether it may be used, each labelled, and a control that removes the row. */
function MethodRow({ index, row, errors, onChange, onRemove }: { readonly index: number; readonly row: ContactMethodRow; readonly errors: FieldErrorLookup | null; readonly onChange: (next: ContactMethodRow) => void; readonly onRemove: () => void }): ReactElement {
  const number = index + 1;
  const rowPath = `${METHODS_FIELD}.${String(index)}`;
  const messageFor = (part: string): readonly string[] | undefined => errors?.byField[`${rowPath}.${part}`];
  return (
    <FormFieldGroup legend={`${ROW_LEGEND_PREFIX} ${String(number)}`} name={rowPath} error={errors?.byField[rowPath]} className="rounded-xl border border-border p-4">
      {() => (
        <div className="flex min-w-0 flex-col gap-4">
          <FormField name={`${rowPath}.kind`} label={KIND_LABEL} description={KIND_DESCRIPTION} error={messageFor("kind")} required>
            {(control) => (
              <NativeSelect
                id={control.id}
                className="w-full"
                value={row.kind}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid ? true : undefined}
                aria-required={control.required ? true : undefined}
                onChange={(event) => {
                  const kind = contactKindOf(event.currentTarget.value);
                  if (kind === null) {
                    return;
                  }
                  onChange({ ...row, kind });
                }}
              >
                {CONTACT_METHOD_KINDS.map((kind) => (
                  <NativeSelectOption key={kind} value={kind}>
                    {CONTACT_KIND_LABELS[kind]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField name={`${rowPath}.value`} label={VALUE_LABEL} description={VALUE_DESCRIPTION} error={messageFor("value")} required>
            {(control) => (
              <Input
                id={control.id}
                type="text"
                inputMode={CONTACT_KIND_INPUT_MODES[row.kind]}
                value={row.value}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid ? true : undefined}
                aria-required={control.required ? true : undefined}
                onChange={(event) => onChange({ ...row, value: event.currentTarget.value })}
                className="w-full"
              />
            )}
          </FormField>
          <FormField name={`${rowPath}.permitted`} label={PERMITTED_LABEL} description={PERMITTED_DESCRIPTION} error={messageFor("permitted")}>
            {/* The box keeps its own size inside a plain frame: the field's body is full width, and a box stretched
                across it would be unreadable as a checkbox. */}
            {(control) => (
              <div className="flex min-h-target min-w-0 items-center">
                <Checkbox id={control.id} checked={row.permitted} aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} onCheckedChange={(checked) => onChange({ ...row, permitted: checked })} />
              </div>
            )}
          </FormField>
          <div className="flex min-w-0">
            <Button type="button" variant="outline" size="sm" className="min-h-target max-w-full whitespace-normal" onClick={onRemove}>
              {`Remove ${ROW_LEGEND_PREFIX.toLowerCase()} ${String(number)}`}
            </Button>
          </div>
        </div>
      )}
    </FormFieldGroup>
  );
}

/** The block that names the record an accepted attempt created and where it lives, without ever naming a shared identity. */
function CreatedPrivateRecord({ partnerRef }: { readonly partnerRef: string }): ReactElement {
  const route = `${PARTNERS_HREF}/${encodeURIComponent(partnerRef)}`;
  return (
    <div data-slot="created-private-record" className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4 text-sm">
      <p className="font-medium text-foreground">{CREATED_TITLE}</p>
      <p className="text-pretty">{CREATED_BODY}</p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground">{CREATED_REFERENCE_LABEL}</span>
        {/* An opaque reference is isolated, so a mixed-direction neighbour cannot reorder it and a leading zero cannot be lost. */}
        <bdi className="mono-identifier wrap-anywhere">{partnerRef}</bdi>
      </p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground">{CREATED_ROUTE_LABEL}</span>
        <bdi className="mono-identifier wrap-anywhere">{route}</bdi>
      </p>
      <p className="min-w-0">
        <Link href={route} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-target max-w-full whitespace-normal")}>
          {OPEN_RECORD_LABEL}
        </Link>
      </p>
    </div>
  );
}

interface OutcomeRegionProps {
  readonly outcome: MutationOutcome;
  readonly fieldLabels: Readonly<Record<string, string | undefined>>;
  readonly createdReference: string | null;
  readonly onReapply: (currentRevision: string) => void;
  readonly onRetrySameWork: () => void;
  readonly onCheckResult: () => void;
}

/**
 * The one surface a settled attempt renders: the shared receipt for the outcomes that report a result, and the shared
 * notice for the three that report a condition instead — a refusal, an outage, or an unconfirmed effect.
 */
function OutcomeRegion({ outcome, fieldLabels, createdReference, onReapply, onRetrySameWork, onCheckResult }: OutcomeRegionProps): ReactElement {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
      return (
        <div data-slot="private-preparation-outcome" data-outcome={outcome.outcome} className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={outcome} headingLevel={3} />
          {createdReference === null ? <p className="text-sm text-pretty text-muted-foreground">{CREATED_REFERENCE_UNSTATED}</p> : <CreatedPrivateRecord partnerRef={createdReference} />}
        </div>
      );
    case "unchanged":
      return (
        <div data-slot="private-preparation-outcome" data-outcome="unchanged" className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={outcome} headingLevel={3} />
        </div>
      );
    case "invalid":
      return (
        <div data-slot="private-preparation-outcome" data-outcome="invalid" className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={outcome} headingLevel={3} fieldLabels={fieldLabels} />
        </div>
      );
    case "conflict":
      return (
        <div data-slot="private-preparation-outcome" data-outcome="conflict" className="flex min-w-0 flex-col gap-3">
          {/* The receipt shows the value the record holds beside the input kept as it was entered; applying it again is the person's own choice. */}
          <OperationResult outcome={outcome} headingLevel={3} fieldLabels={fieldLabels} onReapply={() => onReapply(outcome.currentRevision)} />
        </div>
      );
    case "denied":
      return <StateNotice kind="denied" headingLevel={3} title={DENIED_TITLE} description={DENIED_BODY} reasonCode={outcome.reasonCode} className="min-w-0" />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={3} title={FORM_OUTCOME_COPY.unavailable.title} description={FORM_OUTCOME_COPY.unavailable.body} source={outcome.source} retry={{ label: PARTNER_ACTION_LABELS.retry, onClick: onRetrySameWork }} className="min-w-0" />;
    case "unknown":
      return <StateNotice kind="unknown" headingLevel={3} title={FORM_OUTCOME_COPY.unknown.title} description={FORM_OUTCOME_COPY.unknown.body} operationId={outcome.operationId} action={{ label: CHECK_RESULT_LABEL, onClick: onCheckResult }} className="min-w-0" />;
    default:
      // Exhaustive by construction: the eight outcomes above are the closed set, so a ninth fails to compile here
      // rather than reaching a surface with nothing to say about it.
      return assertNever(outcome, "Unhandled preparation outcome");
  }
}

/**
 * The form that creates one private preparation record from a name alone, and reports what the attempt produced.
 * Every attempt is one named `createPrivatePreparation` change carrying its own operation identity, so a repeated
 * press of an unchanged form replays the original result instead of creating a second contact.
 */
export default function PrivatePreparationForm({ scope, expectedRevision, initialValues, onCreated, dir, className }: PrivatePreparationFormProps): ReactElement {
  const headingId = useId();
  const methodsHeadingId = useId();
  const actionNoteId = useId();
  const [startingValues] = useState<PreparationFormValues>(() => valuesOf(initialValues));
  /** The sequence a contact-method row's key comes from, seeded past the rows the caller supplied. */
  const rowSequence = useRef(startingValues.contactMethods.length);
  const form = useForm({ defaultValues: startingValues });
  const { submit, reset: resetAttempt, isPending, outcome } = useCreatePrivatePreparation();
  /** The attempt a recovery replays: the exact payload and revision last sent, kept as they were sent. */
  const attemptRef = useRef<{ readonly payload: CreatePrivatePreparationPayload; readonly expectedRevision: string } | null>(null);
  const notifiedOperationRef = useRef<string | null>(null);

  const submitValues = useCallback(
    (payload: CreatePrivatePreparationPayload, revision: string): void => {
      attemptRef.current = { payload, expectedRevision: revision };
      void submit({ payload, scope, expectedRevision: revision });
    },
    [scope, submit],
  );

  // Recovery is this same attempt sent again under the identity it already carried, which the service answers with the
  // stored result rather than with a second effect. Nothing here mints a new identity for work that may already exist.
  const replaySameWork = useCallback((): void => {
    const retained = attemptRef.current;
    if (retained !== null) {
      submitValues(retained.payload, retained.expectedRevision);
    }
  }, [submitValues]);

  const reapplyAgainst = useCallback(
    (currentRevision: string): void => {
      const retained = attemptRef.current;
      if (retained !== null) {
        submitValues(retained.payload, currentRevision);
      }
    },
    [submitValues],
  );

  // A refusal, a conflict or an outage stops describing the values on screen the moment one of them changes, so the
  // outcome is cleared on an edit. Nothing entered is cleared with it: every value and every row stays as it was typed.
  const clearSettledRefusal = useCallback((): void => {
    if (outcome !== null && CLEAR_ON_EDIT.has(outcome.outcome)) {
      resetAttempt();
    }
  }, [outcome, resetAttempt]);

  const createdReference = outcome === null ? null : createdReferenceOf(outcome);
  useEffect(() => {
    if (outcome === null || createdReference === null || notifiedOperationRef.current === outcome.operationId) {
      return;
    }
    notifiedOperationRef.current = outcome.operationId;
    onCreated?.(createdReference);
  }, [createdReference, onCreated, outcome]);

  const fieldErrors = outcome !== null && outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null;
  const unconfirmed = outcome !== null && outcome.outcome === "unknown";
  const setMethods = useCallback(
    (next: readonly ContactMethodRow[]): void => {
      form.setFieldValue(METHODS_FIELD, [...next]);
      clearSettledRefusal();
    },
    [clearSettledRefusal, form],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isPending || unconfirmed) {
      return;
    }
    submitValues(payloadOf(form.state.values), expectedRevision);
  };

  return (
    <section dir={dir} aria-labelledby={headingId} data-slot="private-preparation-form" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={headingId} className="font-heading text-lg font-medium">
          {SECTION_HEADING}
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{FORM_LEAD}</p>
      </div>
      <Alert className="min-w-0">
        <AlertTitle>{PRIVATE_RECORD_COPY.preparationIsPrivate.title}</AlertTitle>
        <AlertDescription>
          <p>{PRIVATE_RECORD_COPY.preparationIsPrivate.body}</p>
          <p>{NO_SHARED_IDENTITY}</p>
        </AlertDescription>
      </Alert>
      {outcome === null ? null : <OutcomeRegion outcome={outcome} fieldLabels={fieldLabelsFor(form.state.values.contactMethods.length)} createdReference={createdReference} onReapply={reapplyAgainst} onRetrySameWork={replaySameWork} onCheckResult={replaySameWork} />}
      <form onSubmit={handleSubmit} noValidate aria-busy={isPending ? true : undefined} className="flex min-w-0 flex-col gap-6">
        <form.Field name={NAME_FIELD}>
          {(field) => (
            <FormField name={NAME_FIELD} label={NAME_LABEL} description={NAME_DESCRIPTION} error={fieldErrors?.byField[NAME_FIELD]} required>
              {(control) => (
                <Input
                  id={control.id}
                  type="text"
                  value={field.state.value}
                  autoComplete="off"
                  aria-describedby={control.describedBy}
                  aria-invalid={control.invalid ? true : undefined}
                  aria-required={control.required ? true : undefined}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                    clearSettledRefusal();
                  }}
                  onBlur={field.handleBlur}
                  className="w-full"
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name={NOTE_FIELD}>
          {(field) => (
            <FormField name={NOTE_FIELD} label={NOTE_LABEL} description={NOTE_DESCRIPTION} error={fieldErrors?.byField[NOTE_FIELD]} optionalHint>
              {(control) => (
                <Textarea
                  id={control.id}
                  value={field.state.value}
                  rows={4}
                  aria-describedby={control.describedBy}
                  aria-invalid={control.invalid ? true : undefined}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                    clearSettledRefusal();
                  }}
                  onBlur={field.handleBlur}
                  className="w-full"
                />
              )}
            </FormField>
          )}
        </form.Field>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 id={methodsHeadingId} className="font-heading text-base font-medium">
              {METHODS_LEGEND}
            </h3>
            <p className="text-sm text-pretty text-muted-foreground">{METHODS_HELP}</p>
          </div>
          <form.Subscribe selector={(state) => state.values.contactMethods}>
            {(methods) => (
              <div className="flex min-w-0 flex-col gap-4">
                {methods.length === 0 ? (
                  <p className="text-sm text-pretty text-muted-foreground">{EMPTY_METHODS_NOTE}</p>
                ) : (
                  <ul aria-labelledby={methodsHeadingId} className="flex min-w-0 list-none flex-col gap-4 p-0">
                    {methods.map((row, index) => (
                      <li key={row.rowKey} className="min-w-0">
                        <MethodRow index={index} row={row} errors={fieldErrors} onChange={(next) => setMethods(methods.map((candidate) => (candidate.rowKey === row.rowKey ? next : candidate)))} onRemove={() => setMethods(methods.filter((candidate) => candidate.rowKey !== row.rowKey))} />
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex min-w-0 flex-col gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-target w-fit max-w-full whitespace-normal"
                    onClick={() => {
                      // One row at a time, added by a control rather than by dragging anything: the row exists the
                      // moment it is added, and removing one takes no other row with it.
                      rowSequence.current += 1;
                      setMethods([...methods, { kind: CONTACT_KIND_DEFAULT, value: "", permitted: false, rowKey: rowKeyAt(rowSequence.current) }]);
                    }}
                  >
                    {ADD_METHOD_LABEL}
                  </Button>
                  <p className="text-xs text-pretty text-muted-foreground">{METHODS_LIMIT_NOTE}</p>
                </div>
              </div>
            )}
          </form.Subscribe>
        </div>
        <Separator />
        <div className="flex min-w-0 flex-col gap-2">
          {/* While the last attempt is unconfirmed there is no add control to press: the notice above carries the one
              honest next step, and a second send is not offered for work that may already exist. */}
          {unconfirmed ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={isPending} aria-describedby={actionNoteId} className="min-h-target max-w-full whitespace-normal">
                {isPending ? SUBMIT_PENDING_LABEL : SUBMIT_LABEL}
              </Button>
            </div>
          )}
          <p id={actionNoteId} className="text-sm text-pretty text-muted-foreground">
            {unconfirmed ? UNCONFIRMED_NOTE : createdReference === null ? ACTION_NOTE : RESUBMIT_NOTE}
          </p>
        </div>
      </form>
    </section>
  );
}
