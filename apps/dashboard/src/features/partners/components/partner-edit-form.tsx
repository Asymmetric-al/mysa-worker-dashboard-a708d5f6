"use client";
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useCallback, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { outcomeNotice, useAttemptedMutation, type OutcomeNoticeCopy } from "@/components/attempt";
import { FormField, fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import type { PartnerRecord, ReadEnvelope } from "@/modules/data-service/envelope";
import { invalid, UNIDENTIFIED_ATTEMPT, type MutationOutcome } from "@/modules/data-service/outcome";
import { PERMISSION_FACT_COPY } from "../copy/facets";
import { IDENTITY_COPY, PRIVATE_RECORD_COPY } from "../copy/privacy";
import { FORM_OUTCOME_COPY, PARTNER_ACTION_LABELS } from "../copy/states";
import { useSaveContactEdits } from "../hooks/use-partner-mutations";
import { restrictionEditSchema, saveContactEditsPayloadSchema, type SaveContactEditsPayload } from "../schemas/partner-edit";
import { TextField } from "./bound-fields";
import { CONTACT_KIND_DEFAULT, CONTACT_METHODS_FIELD, ContactMethodList, contactMethodFieldLabels, type ContactMethodRow } from "./contact-method-rows";
type PartnerRecordEnvelope = ReadEnvelope<Extract<Awaited<ReturnType<typeof reads.partners.readPartner>>, { readonly kind: "envelope" }>["envelope"]["data"]>;
const DISPLAY_NAME_FIELD = "displayName";
const GIVEN_NAME_FIELD = "nameParts.given";
const FAMILY_NAME_FIELD = "nameParts.family";
const ADDITIONAL_NAMES_FIELD = "nameParts.additional";
const RELATIONSHIP_LABEL_FIELD = "stage";
const REVISION_LABEL = "Revision this edit presents";
const DISPLAY_NAME_LABEL = "Display name";
const DISPLAY_NAME_DESCRIPTION = "What this record is recognised by. Changing it changes no other record, no household and no organization.";
const GIVEN_NAME_LABEL = "Given name";
const FAMILY_NAME_LABEL = "Family name";
const ADDITIONAL_NAME_PREFIX = "Additional name";
const CONTACT_METHODS_LEGEND = "Contact methods";
const CONTACT_METHODS_HELP = `Each detail states whether this record permits you to use it. Editing that fact changes contactability alone: ${PERMISSION_FACT_COPY.communicationConsent.explanation} ${PERMISSION_FACT_COPY.protectedReaderGrant.explanation}`;
const CONTACT_METHODS_IDENTITY_NOTE = `${IDENTITY_COPY.equalLooking.body} ${IDENTITY_COPY.noJoinKey.body} Adding a detail here therefore re-identifies nothing: the record stays the record it was.`;
const RELATIONSHIP_LABEL = "Relationship label";
const RELATIONSHIP_LABEL_DESCRIPTION = "The relationship word recorded against this person or household, stated in the source's own words rather than chosen from a list. Leave it empty to clear the label.";
const RESTRICTIONS_LEGEND = "Restrictions";
const UNCONFIRMED_NOTE = "Saving is paused until the result above is checked, because this attempt may already have changed the record. Checking it reads what happened and applies nothing.";
const SAVE_NOTE = "Saving changes the permitted fields of this record. It sends no message, records no interaction, subscribes no one and creates no financial record.";
const LOCAL_REFUSAL_NOTE = "Saving cannot start while a field above states what it needs. Nothing you typed has been discarded.";
const BACK_TO_RECORD_LABEL = "Back to the record";
const EDITS_UNAVAILABLE_TITLE = "Contact edits are unavailable here";
const EDITS_UNAVAILABLE_BODY = "This record does not admit a permitted-field change in the current session and scope, so no field is offered and nothing was changed. A refusal here says nothing about what exists anywhere else.";
const CONFLICT_CHOICE_BODY =
  "Applying yours sends what this form holds now against the revision the record stands at, so nothing you have typed is lost and nothing of theirs is overwritten without your decision. Discarding yours returns the form to the values this page read; the value the record holds now stays visible above either way.";
const CLEAR_ON_EDIT: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["invalid", "conflict", "denied", "unavailable"]);
type AdditionalNameRow = { readonly rowKey: string; value: string };
type EditFormValues = { displayName: string; givenName: string; familyName: string; additionalNames: AdditionalNameRow[]; contactMethods: ContactMethodRow[]; relationshipLabel: string };
export type PartnerEditFormProps = { readonly partnerRef: string; readonly envelope: PartnerRecordEnvelope; readonly onSettled?: (outcome: MutationOutcome) => void; readonly dir?: "ltr" | "rtl"; readonly className?: string };
const additionalRowKey = (sequence: number): string => `name-part-${String(sequence)}`;
const contactMethodRowKey = (sequence: number): string => `contact-method-${String(sequence)}`;
function valuesOf(record: PartnerRecord): EditFormValues {
  const parts = record.nameParts;
  return {
    displayName: record.displayName,
    givenName: parts?.given ?? "",
    familyName: parts?.family ?? "",
    additionalNames: (parts?.additional ?? []).map((value, index) => ({ rowKey: additionalRowKey(index), value })),
    contactMethods: record.contactMethods.map((method, index) => ({ rowKey: contactMethodRowKey(index), kind: method.kind, value: method.value, permitted: method.permitted })),
    relationshipLabel: record.stage ?? "",
  };
}
function payloadOf(values: EditFormValues, record: PartnerRecord, partnerRef: string): SaveContactEditsPayload {
  const given = values.givenName.trim();
  const family = values.familyName.trim();
  const touchesNames = record.nameParts !== null || given !== "" || family !== "" || values.additionalNames.length > 0;
  const label = values.relationshipLabel.trim();
  return {
    partnerId: partnerRef,
    displayName: values.displayName.trim(),
    ...(touchesNames ? { nameParts: { given: given === "" ? null : given, family: family === "" ? null : family, additional: values.additionalNames.map((row) => row.value.trim()) } } : {}),
    contactMethods: values.contactMethods.map((row) => ({ kind: row.kind, value: row.value.trim(), permitted: row.permitted })),
    restrictions: record.restrictions.map((restriction) => ({ kind: restriction.kind, detail: restriction.detail })),
    stage: label === "" ? null : label,
  };
}
function restrictionCarryProblem(record: PartnerRecord): string | null {
  const unrepresentable = record.restrictions.findIndex((restriction) => !restrictionEditSchema.safeParse(restriction).success);
  if (unrepresentable === -1) return null;
  return `Restriction ${String(unrepresentable + 1)} on this record carries no label or no detail, so this edit cannot carry it through unchanged. Nothing was changed: correct that restriction first, because saving without it would drop a restriction rather than preserve it.`;
}
const NO_REFUSAL: FieldErrorLookup = { byField: {}, form: [], count: 0 };
/** The form field a path a local refusal can name belongs to, so its message is stated only once that field has been edited; `null` where this form offers no control for the path. */
function formFieldOf(path: string): string | null {
  if (path === DISPLAY_NAME_FIELD) return "displayName";
  if (path === GIVEN_NAME_FIELD) return "givenName";
  if (path === FAMILY_NAME_FIELD) return "familyName";
  if (path === ADDITIONAL_NAMES_FIELD || path.startsWith(`${ADDITIONAL_NAMES_FIELD}.`)) return "additionalNames";
  if (path === CONTACT_METHODS_FIELD || path.startsWith(`${CONTACT_METHODS_FIELD}.`)) return CONTACT_METHODS_FIELD;
  if (path === RELATIONSHIP_LABEL_FIELD) return "relationshipLabel";
  return null;
}
/** The form fields the worker has edited, read from the form's own field metadata. */
const editedFieldNames = (fieldMeta: Readonly<Partial<Record<string, { readonly isDirty: boolean }>>>): readonly string[] => Object.keys(fieldMeta).filter((name) => fieldMeta[name]?.isDirty === true);
/** The refusal the payload this form would send already carries, read from the one schema the change is saved through before anything is sent: a message for a field the worker has not edited is withheld so a pristine form states nothing, and a message the schema states for the form itself is stated once any field has been edited. */
function localRefusalOf(values: EditFormValues, record: PartnerRecord, partnerRef: string, editedFields: readonly string[]): FieldErrorLookup {
  const checked = saveContactEditsPayloadSchema.safeParse(payloadOf(values, record, partnerRef));
  if (checked.success) return NO_REFUSAL;
  const refusal = fieldErrorsFromInvalid(invalid({ operationId: UNIDENTIFIED_ATTEMPT, fields: checked.error }));
  const byField: Record<string, readonly string[]> = {};
  for (const [path, messages] of Object.entries(refusal.byField)) {
    const owner = formFieldOf(path);
    if (owner !== null && editedFields.includes(owner)) byField[path] = messages;
  }
  const form = editedFields.length === 0 ? [] : refusal.form;
  return { byField, form, count: Object.keys(byField).length + form.length };
}
/** One message per path: what this form states before it sends, beside everything the last attempt settled with, so a refusal the record's own schema names is never lost or stated twice. */
function mergedFieldErrors(local: FieldErrorLookup, settled: FieldErrorLookup | null): FieldErrorLookup | null {
  if (settled === null) return local.count === 0 ? null : local;
  const byField: Record<string, readonly string[]> = {};
  for (const path of new Set([...Object.keys(local.byField), ...Object.keys(settled.byField)])) {
    const messages: string[] = [];
    for (const message of [...(local.byField[path] ?? []), ...(settled.byField[path] ?? [])]) if (!messages.includes(message)) messages.push(message);
    if (messages.length > 0) byField[path] = messages;
  }
  const form: string[] = [];
  for (const message of [...local.form, ...settled.form]) if (!form.includes(message)) form.push(message);
  return { byField, form, count: Object.keys(byField).length + form.length };
}
function fieldLabelsFor(values: EditFormValues): Readonly<Record<string, string | undefined>> {
  const labels: Record<string, string | undefined> = {
    [DISPLAY_NAME_FIELD]: DISPLAY_NAME_LABEL,
    [GIVEN_NAME_FIELD]: GIVEN_NAME_LABEL,
    [FAMILY_NAME_FIELD]: FAMILY_NAME_LABEL,
    [ADDITIONAL_NAMES_FIELD]: ADDITIONAL_NAME_PREFIX,
    [CONTACT_METHODS_FIELD]: CONTACT_METHODS_LEGEND,
    ["restrictions"]: RESTRICTIONS_LEGEND,
    [RELATIONSHIP_LABEL_FIELD]: RELATIONSHIP_LABEL,
    ["partnerId"]: "Record",
  };
  values.additionalNames.forEach((_row, index) => {
    labels[`${ADDITIONAL_NAMES_FIELD}.${String(index)}`] = `${ADDITIONAL_NAME_PREFIX} ${String(index + 1)}`;
  });
  return contactMethodFieldLabels(labels, values.contactMethods.length);
}
function editsAdmitted(envelope: PartnerRecordEnvelope): { readonly admitted: boolean; readonly reason: string | null } {
  const action = envelope.actions.find((candidate) => candidate.name === "saveContactEdits");
  if (action === undefined || !action.available) return { admitted: false, reason: action?.reason?.trim() ?? null };
  return { admitted: true, reason: null };
}
const recordHref = (partnerRef: string): string => `/partners/${encodeURIComponent(partnerRef)}`;
type AdditionalNameFieldProps = { readonly index: number; readonly row: AdditionalNameRow; readonly errors: FieldErrorLookup | null; readonly onChange: (next: AdditionalNameRow) => void; readonly onRemove: () => void };
function AdditionalNameField({ index, row, errors, onChange, onRemove }: AdditionalNameFieldProps): ReactElement {
  const number = index + 1;
  const rowPath = `${ADDITIONAL_NAMES_FIELD}.${String(index)}`;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4">
      <FormField name={rowPath} label={`Additional name ${String(number)}`} error={errors?.byField[rowPath]}>
        {(control) => <Input id={control.id} type="text" value={row.value} autoComplete="off" aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} onChange={(event) => onChange({ ...row, value: event.currentTarget.value })} className="w-full" />}
      </FormField>
      <div className="flex min-w-0">
        <Button type="button" variant="outline" size="sm" className="min-h-target max-w-full whitespace-normal" onClick={onRemove}>{`Remove name part ${String(number)}`}</Button>
      </div>
    </div>
  );
}
function RestrictionsBlock({ record }: { readonly record: PartnerRecord }): ReactElement {
  return (
    <section aria-label={RESTRICTIONS_LEGEND} className="flex min-w-0 flex-col gap-2">
      <h3 className="type-subsection-title">{RESTRICTIONS_LEGEND}</h3>
      <p className="type-supporting text-pretty">A restriction is a limit the source recorded, and this form changes none of them. Each one is carried through this edit exactly as it is stored, so an edit to another field can never drop a restriction the form does not mention.</p>
      {record.restrictions.length === 0 ? (
        <p className="type-supporting text-pretty">No restriction is recorded for this record, so this edit carries none.</p>
      ) : (
        <ul className="flex min-w-0 list-disc flex-col gap-2 ps-4 text-sm">
          {record.restrictions.map((restriction, index) => (
            <li key={`${restriction.kind}-${String(index)}`} className="min-w-0 text-pretty">
              <span className="font-medium">{restriction.kind.trim() === "" ? "A restriction with no label is recorded on this record." : restriction.kind}</span>
              {restriction.detail.trim() === "" ? null : <span className="text-muted-foreground">{` — ${restriction.detail}`}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
type ConflictPanelProps = { readonly outcome: Extract<MutationOutcome, { readonly outcome: "conflict" }>; readonly fieldLabels: Readonly<Record<string, string | undefined>>; readonly onApplyMine: (currentRevision: string) => void; readonly onDiscardMine: () => void };
function ConflictPanel({ outcome, fieldLabels, onApplyMine, onDiscardMine }: ConflictPanelProps): ReactElement {
  const titleId = useId();
  return (
    <section data-slot="partner-edit-conflict" data-reason={outcome.reason} aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <h3 id={titleId} className="type-subsection-title sr-only">
        {FORM_OUTCOME_COPY.conflict.title}
      </h3>
      <OperationResult outcome={outcome} headingLevel={4} fieldLabels={fieldLabels} />
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4 text-sm">
        <p className="type-group-title">What to do with your input</p>
        <p className="type-supporting text-pretty">{CONFLICT_CHOICE_BODY}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className="min-h-target max-w-full whitespace-normal" onClick={() => onApplyMine(outcome.currentRevision)}>
            Apply my changes
          </Button>
          <Button type="button" variant="outline" className="min-h-target max-w-full whitespace-normal" onClick={onDiscardMine}>
            Discard mine
          </Button>
        </div>
      </div>
    </section>
  );
}
function AcceptedNote({ partnerRef, revision }: { readonly partnerRef: string; readonly revision: string }): ReactElement {
  return (
    <div data-slot="partner-edit-accepted" className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4 text-sm">
      <p className="type-group-title">This record now stands at the revision below</p>
      <p className="type-supporting text-pretty">The change was applied once, and this receipt stays on the page as the record of it.</p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-body">
        <span className="text-muted-foreground">{REVISION_LABEL}</span>
        <bdi className="mono-identifier wrap-anywhere">{revision}</bdi>
      </p>
      <p className="min-w-0">
        <Link href={recordHref(partnerRef)} data-slot="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-target max-w-full whitespace-normal")}>
          {BACK_TO_RECORD_LABEL}
        </Link>
      </p>
    </div>
  );
}
type OutcomeRegionProps = {
  readonly outcome: MutationOutcome;
  readonly partnerRef: string;
  readonly fieldLabels: Readonly<Record<string, string | undefined>>;
  readonly onApplyMine: (currentRevision: string) => void;
  readonly onDiscardMine: () => void;
  readonly onRetrySameWork: () => void;
  readonly onCheckResult: () => void;
};
const EDITS_NOTICE_COPY: OutcomeNoticeCopy = {
  denied: { title: EDITS_UNAVAILABLE_TITLE, description: EDITS_UNAVAILABLE_BODY },
  unavailable: { title: FORM_OUTCOME_COPY.unavailable.title, description: FORM_OUTCOME_COPY.unavailable.body },
  unknown: { title: FORM_OUTCOME_COPY.unknown.title, description: FORM_OUTCOME_COPY.unknown.body },
  retryLabel: PARTNER_ACTION_LABELS.retry,
  checkResultLabel: "Check the result",
};
function OutcomeRegion({ outcome, partnerRef, fieldLabels, onApplyMine, onDiscardMine, onRetrySameWork, onCheckResult }: OutcomeRegionProps): ReactElement {
  if (outcome.outcome === "conflict") return <ConflictPanel outcome={outcome} fieldLabels={fieldLabels} onApplyMine={onApplyMine} onDiscardMine={onDiscardMine} />;
  const notice = outcomeNotice(outcome, EDITS_NOTICE_COPY, { onRetrySameWork, onCheckResult, headingLevel: 3, className: "min-w-0" });
  if (notice !== null) return <StateNotice {...notice} />;
  return (
    <div data-slot="partner-edit-outcome" data-outcome={outcome.outcome} className="flex min-w-0 flex-col gap-3">
      <OperationResult outcome={outcome} headingLevel={3} fieldLabels={fieldLabels} />
      {outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? <AcceptedNote partnerRef={partnerRef} revision={outcome.revision} /> : null}
    </div>
  );
}
/** The permitted-field edit body for one partner record. */
export default function PartnerEditForm({ partnerRef, envelope, onSettled, dir, className }: PartnerEditFormProps): ReactElement {
  const record = envelope.data.partner;
  const headingId = useId();
  const namesHeadingId = useId();
  const methodsHeadingId = useId();
  const actionNoteId = useId();
  const availability = editsAdmitted(envelope);
  const [startingValues] = useState<EditFormValues>(() => valuesOf(record));
  const rowSequence = useRef({ additional: startingValues.additionalNames.length, methods: startingValues.contactMethods.length });
  const form = useForm({ defaultValues: startingValues });
  const { submit } = useSaveContactEdits(partnerRef);
  const edits = useAttemptedMutation<SaveContactEditsPayload>(submit, onSettled);
  const { outcome, pending: isPending, reset: resetEdits } = edits;
  const carryProblem = restrictionCarryProblem(record);
  const setValues = useCallback(
    (next: EditFormValues): void => {
      rowSequence.current = { additional: next.additionalNames.length, methods: next.contactMethods.length };
      for (const field of ["displayName", "givenName", "familyName", "additionalNames", "contactMethods", "relationshipLabel"] as const) form.setFieldValue(field, next[field]);
    },
    [form],
  );
  const replaySameWork = (): void => void edits.retry();
  const applyMine = (currentRevision: string): void => void edits.submit({ scope: envelope.scope, expectedRevision: currentRevision, payload: payloadOf(form.state.values, record, partnerRef) });
  const discardMine = (): void => {
    setValues(valuesOf(record));
    edits.reset();
  };
  const clearSettledRefusal = useCallback((): void => {
    if (outcome !== null && CLEAR_ON_EDIT.has(outcome.outcome)) resetEdits();
  }, [outcome, resetEdits]);
  const setAdditionalNames = useCallback(
    (next: readonly AdditionalNameRow[]): void => {
      form.setFieldValue("additionalNames", [...next]);
      clearSettledRefusal();
    },
    [clearSettledRefusal, form],
  );
  const setContactMethods = useCallback(
    (next: readonly ContactMethodRow[]): void => {
      form.setFieldValue(CONTACT_METHODS_FIELD, [...next]);
      clearSettledRefusal();
    },
    [clearSettledRefusal, form],
  );
  const settledFieldErrors = edits.fieldErrors;
  const unconfirmed = outcome !== null && outcome.outcome === "unknown";
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isPending || unconfirmed || carryProblem !== null) return;
    const values = form.state.values;
    if (localRefusalOf(values, record, partnerRef, editedFieldNames(form.state.fieldMeta)).count > 0) return;
    void edits.submit({ scope: envelope.scope, expectedRevision: envelope.revision, payload: payloadOf(values, record, partnerRef) });
  };
  return (
    <section dir={dir} aria-labelledby={headingId} data-slot="partner-edit-form" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={headingId} className="type-section-title">
          Edit permitted fields
        </h2>
        <p className="type-supporting text-pretty">Only the fields this record permits you to change are shown, and each one is saved against the revision this page read.</p>
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-supporting">
          <span>{REVISION_LABEL}</span>
          <bdi className="mono-identifier wrap-anywhere">{envelope.revision}</bdi>
        </p>
        <p className="type-supporting text-pretty">It is sent unchanged with your change. If someone saved this record after this page was read, your change is refused as a conflict and their value is shown beside yours instead of being replaced.</p>
      </div>
      {availability.admitted ? null : <StateNotice kind="denied" headingLevel={3} title={EDITS_UNAVAILABLE_TITLE} description={availability.reason ?? EDITS_UNAVAILABLE_BODY} action={{ label: BACK_TO_RECORD_LABEL, href: recordHref(partnerRef) }} className="min-w-0" />}
      {availability.admitted ? (
        <>
          {outcome === null ? null : <OutcomeRegion outcome={outcome} partnerRef={partnerRef} fieldLabels={fieldLabelsFor(startingValues)} onApplyMine={applyMine} onDiscardMine={discardMine} onRetrySameWork={replaySameWork} onCheckResult={replaySameWork} />}
          {record.audience === "private" ? (
            <Alert role="note" className="min-w-0">
              <AlertTitle>{PRIVATE_RECORD_COPY.remainsPrivate.title}</AlertTitle>
              <AlertDescription>
                <p>{PRIVATE_RECORD_COPY.preparationIsPrivate.body}</p>
              </AlertDescription>
            </Alert>
          ) : null}
          <form onSubmit={handleSubmit} noValidate aria-busy={isPending ? true : undefined} className="flex min-w-0 flex-col gap-6">
            <form.Subscribe selector={(state) => state.values}>
              {(values) => {
                const localRefusal = localRefusalOf(values, record, partnerRef, editedFieldNames(form.state.fieldMeta));
                const fieldErrors = mergedFieldErrors(localRefusal, settledFieldErrors);
                return (
                  <>
                    <form.Field name="displayName">{(field) => <TextField field={field} name={DISPLAY_NAME_FIELD} label={DISPLAY_NAME_LABEL} description={DISPLAY_NAME_DESCRIPTION} error={fieldErrors?.byField[DISPLAY_NAME_FIELD]} required onEdit={clearSettledRefusal} className="w-full" />}</form.Field>
                    <div className="flex min-w-0 flex-col gap-4">
                      <div className="flex min-w-0 flex-col gap-1">
                        <h3 id={namesHeadingId} className="type-subsection-title">
                          Name parts
                        </h3>
                        <p className="type-supporting text-pretty">Optional. A record may be known by one name only, and a part you leave blank is stored as absent rather than as an empty name.</p>
                      </div>
                      <form.Field name="givenName">{(field) => <TextField field={field} name={GIVEN_NAME_FIELD} label={GIVEN_NAME_LABEL} error={fieldErrors?.byField[GIVEN_NAME_FIELD]} optionalHint onEdit={clearSettledRefusal} className="w-full" />}</form.Field>
                      <form.Field name="familyName">{(field) => <TextField field={field} name={FAMILY_NAME_FIELD} label={FAMILY_NAME_LABEL} error={fieldErrors?.byField[FAMILY_NAME_FIELD]} optionalHint onEdit={clearSettledRefusal} className="w-full" />}</form.Field>
                      <form.Subscribe selector={(state) => state.values.additionalNames}>
                        {(additionalNames) => (
                          <div className="flex min-w-0 flex-col gap-4">
                            {additionalNames.length === 0 ? null : (
                              <ul aria-labelledby={namesHeadingId} className="flex min-w-0 list-none flex-col gap-4 p-0">
                                {additionalNames.map((row, index) => (
                                  <li key={row.rowKey} className="min-w-0">
                                    <AdditionalNameField
                                      index={index}
                                      row={row}
                                      errors={fieldErrors}
                                      onChange={(next) => setAdditionalNames(additionalNames.map((candidate) => (candidate.rowKey === row.rowKey ? next : candidate)))}
                                      onRemove={() => setAdditionalNames(additionalNames.filter((candidate) => candidate.rowKey !== row.rowKey))}
                                    />
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
                                  rowSequence.current.additional += 1;
                                  setAdditionalNames([...additionalNames, { rowKey: additionalRowKey(rowSequence.current.additional), value: "" }]);
                                }}
                              >
                                Add another name part
                              </Button>
                              <p className="text-xs text-pretty text-muted-foreground">Each part you add can be removed again, and removing one leaves every other part exactly as you wrote it.</p>
                            </div>
                          </div>
                        )}
                      </form.Subscribe>
                    </div>
                    <div className="flex min-w-0 flex-col gap-4">
                      <div className="flex min-w-0 flex-col gap-1">
                        <h3 id={methodsHeadingId} className="type-subsection-title">
                          {CONTACT_METHODS_LEGEND}
                        </h3>
                        <p className="type-supporting text-pretty">{CONTACT_METHODS_HELP}</p>
                        <p className="type-supporting text-pretty">{CONTACT_METHODS_IDENTITY_NOTE}</p>
                      </div>
                      <form.Subscribe selector={(state) => state.values.contactMethods}>
                        {(contactMethods) => (
                          <ContactMethodList
                            rows={contactMethods}
                            headingId={methodsHeadingId}
                            errors={fieldErrors}
                            valueDescription="The address, number or postal detail itself. The record stores no verification for it, so it states what was recorded rather than a confirmed detail."
                            emptyNote="No contact method is recorded. Every permitted-field edit is still available, and a method you add is recorded against this same record."
                            addNote="A row you add can be removed again, and removing one leaves every other row exactly as you wrote it."
                            showPermittedFact
                            onRowsChange={setContactMethods}
                            onAdd={() => {
                              rowSequence.current.methods += 1;
                              setContactMethods([...contactMethods, { rowKey: contactMethodRowKey(rowSequence.current.methods), kind: CONTACT_KIND_DEFAULT, value: "", permitted: false }]);
                            }}
                          />
                        )}
                      </form.Subscribe>
                    </div>
                    <form.Field name="relationshipLabel">
                      {(field) => <TextField field={field} name={RELATIONSHIP_LABEL_FIELD} label={RELATIONSHIP_LABEL} description={RELATIONSHIP_LABEL_DESCRIPTION} error={fieldErrors?.byField[RELATIONSHIP_LABEL_FIELD]} optionalHint onEdit={clearSettledRefusal} className="w-full" />}
                    </form.Field>
                    <RestrictionsBlock record={record} />
                    {carryProblem === null ? null : (
                      <Alert variant="destructive" className="min-w-0">
                        <AlertTitle>This edit cannot carry every restriction</AlertTitle>
                        <AlertDescription>
                          <p>{carryProblem}</p>
                        </AlertDescription>
                      </Alert>
                    )}
                    <Separator />
                    <div className="flex min-w-0 flex-col gap-2">
                      {unconfirmed ? null : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="submit" disabled={isPending || carryProblem !== null || localRefusal.count > 0} aria-describedby={actionNoteId} className="min-h-target max-w-full whitespace-normal">
                            {isPending ? "Saving the changes" : "Save these changes"}
                          </Button>
                        </div>
                      )}
                      <p id={actionNoteId} className="type-supporting text-pretty">
                        {unconfirmed ? UNCONFIRMED_NOTE : localRefusal.count > 0 ? LOCAL_REFUSAL_NOTE : SAVE_NOTE}
                      </p>
                    </div>
                  </>
                );
              }}
            </form.Subscribe>
          </form>
        </>
      ) : null}
    </section>
  );
}
