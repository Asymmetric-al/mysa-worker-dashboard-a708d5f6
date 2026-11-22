"use client";
/**
 * The permitted-field edit body for one partner record: the fields the write itself admits, presented against the
 * revision this page read.
 *
 * Two promises shape it. A change is never an overwrite — the revision that arrived with the read travels with the
 * attempt unchanged, so a record somebody else saved in the meantime answers a `conflict` that shows their value
 * beside this form's input and leaves the decision to the worker. And nothing typed here is ever thrown away: rows
 * added during this sitting, a refusal's messages and an unconfirmed attempt all leave the values exactly as they
 * were entered, so retrying never means retyping.
 *
 * It edits contactability and identity labels, never consent. A permitted contact method is one fact about one
 * record; communication consent for a publisher and a purpose, and a protected-content reader grant, are different
 * facts that this form neither shows nor changes. A restriction is displayed and carried through untouched, and a
 * restriction this form cannot represent stops the submit with an explanation rather than disappearing from the
 * record.
 */
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useCallback, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { fieldErrorsFromInvalid, FormField, FormFieldGroup, type FieldErrorLookup } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import StatusBadge from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import { CONTACT_METHOD_KINDS, type ContactMethodKind, type PartnerRecord } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { PERMISSION_FACT_COPY } from "../copy/facets";
import { IDENTITY_COPY, PRIVATE_RECORD_COPY } from "../copy/privacy";
import { FORM_OUTCOME_COPY, PARTNER_ACTION_LABELS } from "../copy/states";
import type { PartnerRecordEnvelope } from "../hooks/use-partner-record";
import { useSaveContactEdits } from "../hooks/use-partner-mutations";
import { restrictionEditSchema, type SaveContactEditsPayload } from "../schemas/partner-edit";

/** The route family this record lives under, so a settled receipt can point back to the record it changed. */
const PARTNERS_HREF = "/partners";
/** The write this form drives, as the record's own `actions` list names it. */
const EDIT_ACTION = "saveContactEdits";
// The payload paths these controls and the service's per-field messages both address. A control is named by the
// path its message arrives at, so a refusal anchors to the field it names instead of to a cosmetic label.
const DISPLAY_NAME_FIELD = "displayName";
const GIVEN_NAME_FIELD = "nameParts.given";
const FAMILY_NAME_FIELD = "nameParts.family";
const ADDITIONAL_NAMES_FIELD = "nameParts.additional";
const CONTACT_METHODS_FIELD = "contactMethods";
const RESTRICTIONS_FIELD = "restrictions";
const RELATIONSHIP_LABEL_FIELD = "stage";
const RECORD_FIELD = "partnerId";
/** The kind an added contact-method row starts at, taken from the closed vocabulary rather than written out again. */
const CONTACT_KIND_DEFAULT: ContactMethodKind = CONTACT_METHOD_KINDS[0] ?? "email";
const CONTACT_KIND_LABELS: Readonly<Record<ContactMethodKind, string>> = { email: "Email address", phone: "Phone number", postal: "Postal address" };
/** What a phone or a tablet offers for a value of each kind; the value itself is never reformatted or verified. */
const CONTACT_KIND_INPUT_MODES: Readonly<Record<ContactMethodKind, "email" | "tel" | "text">> = { email: "email", phone: "tel", postal: "text" };
const SECTION_HEADING = "Edit permitted fields";
const FORM_LEAD = "Only the fields this record permits you to change are shown, and each one is saved against the revision this page read.";
const REVISION_LABEL = "Revision this edit presents";
const REVISION_NOTE = "It is sent unchanged with your change. If someone saved this record after this page was read, your change is refused as a conflict and their value is shown beside yours instead of being replaced.";
const RECORD_LABEL = "Record";
const DISPLAY_NAME_LABEL = "Display name";
const DISPLAY_NAME_DESCRIPTION = "What this record is recognised by. Changing it changes no other record, no household and no organization.";
const NAMES_LEGEND = "Name parts";
const NAMES_HELP = "Optional. A record may be known by one name only, and a part you leave blank is stored as absent rather than as an empty name.";
const GIVEN_NAME_LABEL = "Given name";
const FAMILY_NAME_LABEL = "Family name";
const ADDITIONAL_NAME_LABEL = "Additional name";
const ADDITIONAL_NAME_PREFIX = "Additional name";
const ADD_ADDITIONAL_NAME_LABEL = "Add another name part";
const REMOVE_ADDITIONAL_NAME_LABEL = "Remove name part";
const ADDITIONAL_NAME_NOTE = "Each part you add can be removed again, and removing one leaves every other part exactly as you wrote it.";
const CONTACT_METHODS_LEGEND = "Contact methods";
const CONTACT_METHODS_HELP = `Each detail states whether this record permits you to use it. Editing that fact changes contactability alone: ${PERMISSION_FACT_COPY.communicationConsent.explanation} ${PERMISSION_FACT_COPY.protectedReaderGrant.explanation}`;
const CONTACT_METHODS_IDENTITY_NOTE = `${IDENTITY_COPY.equalLooking.body} ${IDENTITY_COPY.noJoinKey.body} Adding a detail here therefore re-identifies nothing: the record stays the record it was.`;
const EMPTY_CONTACT_METHODS_NOTE = "No contact method is recorded. Every permitted-field edit is still available, and a method you add is recorded against this same record.";
const CONTACT_METHOD_PREFIX = "Contact method";
const CONTACT_KIND_LABEL = "Kind";
const CONTACT_KIND_DESCRIPTION = "What sort of detail this is: an email address, a phone number or a postal address.";
const CONTACT_VALUE_LABEL = "Value";
const CONTACT_VALUE_DESCRIPTION = "The address, number or postal detail itself. The record stores no verification for it, so it states what was recorded rather than a confirmed detail.";
const PERMITTED_LABEL = "Permitted for contact";
const PERMITTED_DESCRIPTION = "Whether this detail may be used to reach the person. It is a fact about contactability only: it is not communication consent and not a reader grant.";
const PERMITTED_FACT: Readonly<Record<"on" | "off", string>> = { on: "Permitted for contact", off: "Not permitted for contact" };
const ADD_CONTACT_METHOD_LABEL = "Add a contact method";
const REMOVE_CONTACT_METHOD_LABEL = "Remove contact method";
const CONTACT_METHOD_REMOVAL_NOTE = "A row you add can be removed again, and removing one leaves every other row exactly as you wrote it.";
const RELATIONSHIP_LABEL = "Relationship label";
const RELATIONSHIP_LABEL_DESCRIPTION = "The relationship word recorded against this person or household, stated in the source's own words rather than chosen from a list. Leave it empty to clear the label.";
const RESTRICTIONS_LEGEND = "Restrictions";
const RESTRICTIONS_HELP = "A restriction is a limit the source recorded, and this form changes none of them. Each one is carried through this edit exactly as it is stored, so an edit to another field can never drop a restriction the form does not mention.";
const EMPTY_RESTRICTIONS_NOTE = "No restriction is recorded for this record, so this edit carries none.";
const RESTRICTION_BLOCK_TITLE = "This edit cannot carry every restriction";
const RESTRICTION_UNLABELLED = "A restriction with no label is recorded on this record.";
const SUBMIT_LABEL = "Save these changes";
const SUBMIT_PENDING_LABEL = "Saving the changes";
const ACTION_NOTE = "Saving changes the permitted fields of this record. It sends no message, records no interaction, subscribes no one and creates no financial record.";
const UNCONFIRMED_NOTE = "Saving is paused until the result above is checked, because this attempt may already have changed the record. Checking it reads what happened and applies nothing.";
const CHECK_RESULT_LABEL = "Check the result";
const BACK_TO_RECORD_LABEL = "Back to the record";
const ACCEPTED_TITLE = "This record now stands at the revision below";
const ACCEPTED_BODY = "The change was applied once, and this receipt stays on the page as the record of it.";
const EDITS_UNAVAILABLE_TITLE = "Contact edits are unavailable here";
const EDITS_UNAVAILABLE_BODY = "This record does not admit a permitted-field change in the current session and scope, so no field is offered and nothing was changed. A refusal here says nothing about what exists anywhere else.";
const CONFLICT_CHOICE_TITLE = "What to do with your input";
const CONFLICT_CHOICE_BODY = "Applying yours sends what this form holds now against the revision the record stands at, so nothing you have typed is lost and nothing of theirs is overwritten without your decision. Discarding yours returns the form to the values this page read; the value the record holds now stays visible above either way.";
const CONFLICT_APPLY_LABEL = "Apply my changes";
const CONFLICT_DISCARD_LABEL = "Discard mine";
/** The four outcomes an edit clears: the attempt has settled without an effect that keeps describing the values on screen. */
const CLEAR_ON_EDIT: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["invalid", "conflict", "denied", "unavailable"]);

/** One additional name part as the form holds it: its value, plus a key that survives another row's removal. */
interface AdditionalNameRow {
  readonly rowKey: string;
  value: string;
}

/** One contact method as the form holds it: the payload's three members, plus a key that survives another row's removal. */
interface ContactMethodRow {
  readonly rowKey: string;
  kind: ContactMethodKind;
  value: string;
  permitted: boolean;
}

/** Everything this form owns while it is being filled. */
interface EditFormValues {
  displayName: string;
  givenName: string;
  familyName: string;
  additionalNames: AdditionalNameRow[];
  contactMethods: ContactMethodRow[];
  relationshipLabel: string;
}

/** Props of {@link PartnerEditForm}. */
export interface PartnerEditFormProps {
  /** The record's opaque identifier: encoded where it addresses a route, and never parsed, split or compared. */
  readonly partnerRef: string;
  /**
   * The read this form was seeded from — the record, the revision it stood at and the actions it advertises. The
   * revision is presented unchanged with every attempt, and the actions decide whether any field is offered at all.
   */
  readonly envelope: PartnerRecordEnvelope;
  /** Called once with each settled attempt's outcome, so a composing route can react without owning the receipt. */
  readonly onSettled?: (outcome: MutationOutcome) => void;
  /** The direction the composing route states; set on this section only and never on a child's styles. */
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}

/** The row key an additional name added at `sequence` carries, so removing one row never re-keys another. */
function additionalRowKey(sequence: number): string {
  return `name-part-${String(sequence)}`;
}

/** The row key a contact method added at `sequence` carries, in the same scheme. */
function contactMethodRowKey(sequence: number): string {
  return `contact-method-${String(sequence)}`;
}

/** The form's values, taken from the record exactly as it was read. */
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

/** The method-kind a typed value names, or `null` when it names none the vocabulary holds. */
function contactKindOf(value: string): ContactMethodKind | null {
  return CONTACT_METHOD_KINDS.find((kind) => kind === value) ?? null;
}

/**
 * The change this form asks for. Every member the payload admits is stated, because the write treats an absent
 * member as "leave it as it is": a cleared name part, an emptied contact-method list and a cleared relationship
 * label are all deliberate absences that have to be stated to take effect, while the record's restrictions travel
 * through untouched so that nothing this form does not model can go missing.
 */
function payloadOf(values: EditFormValues, record: PartnerRecord, partnerRef: string): SaveContactEditsPayload {
  const given = values.givenName.trim();
  const family = values.familyName.trim();
  const touchesNames = record.nameParts !== null || given !== "" || family !== "" || values.additionalNames.length > 0;
  const label = values.relationshipLabel.trim();
  return {
    partnerId: partnerRef,
    displayName: values.displayName.trim(),
    // A blank additional row is sent rather than dropped: the schema refuses it by name, which is how the worker
    // learns to remove the row instead of watching it vanish from the record.
    ...(touchesNames ? { nameParts: { given: given === "" ? null : given, family: family === "" ? null : family, additional: values.additionalNames.map((row) => row.value.trim()) } } : {}),
    contactMethods: values.contactMethods.map((row) => ({ kind: row.kind, value: row.value.trim(), permitted: row.permitted })),
    restrictions: record.restrictions.map((restriction) => ({ kind: restriction.kind, detail: restriction.detail })),
    stage: label === "" ? null : label,
  };
}

/**
 * The one reason a stored restriction would prevent this edit: a restriction without a label or without a detail
 * cannot be expressed in the edit's payload, so sending the edit would either drop it or rewrite it. The form then
 * blocks the submit and says why, naming the restriction by its place rather than repeating its private text.
 */
function restrictionCarryProblem(record: PartnerRecord): string | null {
  const unrepresentable = record.restrictions.findIndex((restriction) => !restrictionEditSchema.safeParse(restriction).success);
  if (unrepresentable === -1) {
    return null;
  }
  return `Restriction ${String(unrepresentable + 1)} on this record carries no label or no detail, so this edit cannot carry it through unchanged. Nothing was changed: correct that restriction first, because saving without it would drop a restriction rather than preserve it.`;
}

/** The labels a refusal's per-field messages are introduced by, including one entry per row on the form. */
function fieldLabelsFor(values: EditFormValues): Readonly<Record<string, string | undefined>> {
  const labels: Record<string, string | undefined> = {
    [DISPLAY_NAME_FIELD]: DISPLAY_NAME_LABEL,
    [GIVEN_NAME_FIELD]: GIVEN_NAME_LABEL,
    [FAMILY_NAME_FIELD]: FAMILY_NAME_LABEL,
    [ADDITIONAL_NAMES_FIELD]: ADDITIONAL_NAME_PREFIX,
    [CONTACT_METHODS_FIELD]: CONTACT_METHODS_LEGEND,
    [RESTRICTIONS_FIELD]: RESTRICTIONS_LEGEND,
    [RELATIONSHIP_LABEL_FIELD]: RELATIONSHIP_LABEL,
    [RECORD_FIELD]: RECORD_LABEL,
  };
  values.additionalNames.forEach((_row, index) => {
    labels[`${ADDITIONAL_NAMES_FIELD}.${String(index)}`] = `${ADDITIONAL_NAME_PREFIX} ${String(index + 1)}`;
  });
  values.contactMethods.forEach((_row, index) => {
    const legend = `${CONTACT_METHOD_PREFIX} ${String(index + 1)}`;
    const rowPath = `${CONTACT_METHODS_FIELD}.${String(index)}`;
    labels[rowPath] = legend;
    labels[`${rowPath}.kind`] = `${legend} ${CONTACT_KIND_LABEL.toLowerCase()}`;
    labels[`${rowPath}.value`] = `${legend} value`;
    labels[`${rowPath}.permitted`] = `${legend} ${PERMITTED_LABEL.toLowerCase()}`;
  });
  return labels;
}

/** Whether the record's own actions leave a permitted-field change available in this context. */
function editsAdmitted(envelope: PartnerRecordEnvelope): { readonly admitted: boolean; readonly reason: string | null } {
  const action = envelope.actions.find((candidate) => candidate.name === EDIT_ACTION);
  if (action === undefined || !action.available) {
    return { admitted: false, reason: action?.reason?.trim() ?? null };
  }
  return { admitted: true, reason: null };
}

/** The address of this record's own page, built from its opaque identifier and never from its details. */
function recordHref(partnerRef: string): string {
  return `${PARTNERS_HREF}/${encodeURIComponent(partnerRef)}`;
}

interface AdditionalNameFieldProps {
  readonly index: number;
  readonly row: AdditionalNameRow;
  readonly errors: FieldErrorLookup | null;
  readonly onChange: (next: AdditionalNameRow) => void;
  readonly onRemove: () => void;
}

/** One additional name part: its value, and a control that removes just this row. */
function AdditionalNameField({ index, row, errors, onChange, onRemove }: AdditionalNameFieldProps): ReactElement {
  const number = index + 1;
  const rowPath = `${ADDITIONAL_NAMES_FIELD}.${String(index)}`;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4">
      <FormField name={rowPath} label={`${ADDITIONAL_NAME_LABEL} ${String(number)}`} error={errors?.byField[rowPath]}>
        {(control) => (
          <Input id={control.id} type="text" value={row.value} autoComplete="off" aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} onChange={(event) => onChange({ ...row, value: event.currentTarget.value })} className="w-full" />
        )}
      </FormField>
      <div className="flex min-w-0">
        <Button type="button" variant="outline" size="sm" className="min-h-target max-w-full whitespace-normal" onClick={onRemove}>
          {`${REMOVE_ADDITIONAL_NAME_LABEL} ${String(number)}`}
        </Button>
      </div>
    </div>
  );
}

interface ContactMethodFieldProps {
  readonly index: number;
  readonly row: ContactMethodRow;
  readonly errors: FieldErrorLookup | null;
  readonly onChange: (next: ContactMethodRow) => void;
  readonly onRemove: () => void;
}

/**
 * One contact method: its kind, its value, the fact about whether it may be used, and a control that removes just
 * this row. The permitted flag is shown twice on purpose — once as the control's label and once as the fact the row
 * currently states — so a worker reading the form can tell what is about to be saved without inferring it.
 */
function ContactMethodField({ index, row, errors, onChange, onRemove }: ContactMethodFieldProps): ReactElement {
  const number = index + 1;
  const legend = `${CONTACT_METHOD_PREFIX} ${String(number)}`;
  const rowPath = `${CONTACT_METHODS_FIELD}.${String(index)}`;
  const messageFor = (part: string): readonly string[] | undefined => errors?.byField[`${rowPath}.${part}`];
  return (
    <FormFieldGroup legend={legend} name={rowPath} error={errors?.byField[rowPath]} className="rounded-xl border border-border p-4">
      {() => (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0">
            <StatusBadge label={row.permitted ? PERMITTED_FACT.on : PERMITTED_FACT.off} tone={row.permitted ? "info" : "neutral"} srPrefix={legend} />
          </div>
          <FormField name={`${rowPath}.kind`} label={CONTACT_KIND_LABEL} description={CONTACT_KIND_DESCRIPTION} error={messageFor("kind")} required>
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
          <FormField name={`${rowPath}.value`} label={CONTACT_VALUE_LABEL} description={CONTACT_VALUE_DESCRIPTION} error={messageFor("value")} required>
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
              {`${REMOVE_CONTACT_METHOD_LABEL} ${String(number)}`}
            </Button>
          </div>
        </div>
      )}
    </FormFieldGroup>
  );
}

/**
 * The restrictions this edit carries. They are displayed rather than edited: the restriction's wording belongs to
 * whoever recorded it, and an edit to a name or a contact method must not quietly rewrite a limit on contact.
 */
function RestrictionsBlock({ record }: { readonly record: PartnerRecord }): ReactElement {
  return (
    <section aria-label={RESTRICTIONS_LEGEND} className="flex min-w-0 flex-col gap-2">
      <h3 className="font-heading text-base font-medium">{RESTRICTIONS_LEGEND}</h3>
      <p className="text-sm text-pretty text-muted-foreground">{RESTRICTIONS_HELP}</p>
      {record.restrictions.length === 0 ? (
        <p className="text-sm text-pretty text-muted-foreground">{EMPTY_RESTRICTIONS_NOTE}</p>
      ) : (
        <ul className="flex min-w-0 list-disc flex-col gap-2 ps-4 text-sm">
          {record.restrictions.map((restriction, index) => (
            <li key={`${restriction.kind}-${String(index)}`} className="min-w-0 text-pretty">
              <span className="font-medium">{restriction.kind.trim() === "" ? RESTRICTION_UNLABELLED : restriction.kind}</span>
              {restriction.detail.trim() === "" ? null : <span className="text-muted-foreground">{` — ${restriction.detail}`}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type ConflictOutcome = Extract<MutationOutcome, { readonly outcome: "conflict" }>;

interface ConflictPanelProps {
  readonly outcome: ConflictOutcome;
  readonly fieldLabels: Readonly<Record<string, string | undefined>>;
  readonly onApplyMine: (currentRevision: string) => void;
  readonly onDiscardMine: () => void;
}

/**
 * What a settled conflict asks the worker to decide: the receipt shows the value the record holds beside the input
 * kept as it was entered, and the two controls below it are the only ways forward. Nothing merges the two, and no
 * value is replaced until one of them is chosen.
 */
function ConflictPanel({ outcome, fieldLabels, onApplyMine, onDiscardMine }: ConflictPanelProps): ReactElement {
  const titleId = useId();
  return (
    <section data-slot="partner-edit-conflict" data-reason={outcome.reason} aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <h3 id={titleId} className="sr-only">
        {FORM_OUTCOME_COPY.conflict.title}
      </h3>
      <OperationResult outcome={outcome} headingLevel={4} fieldLabels={fieldLabels} />
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4 text-sm">
        <p className="font-medium">{CONFLICT_CHOICE_TITLE}</p>
        <p className="text-pretty text-muted-foreground">{CONFLICT_CHOICE_BODY}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className="min-h-target max-w-full whitespace-normal" onClick={() => onApplyMine(outcome.currentRevision)}>
            {CONFLICT_APPLY_LABEL}
          </Button>
          <Button type="button" variant="outline" className="min-h-target max-w-full whitespace-normal" onClick={onDiscardMine}>
            {CONFLICT_DISCARD_LABEL}
          </Button>
        </div>
      </div>
    </section>
  );
}

interface AcceptedNoteProps {
  readonly partnerRef: string;
  readonly revision: string;
}

/** What a settled save states about the record it changed, and where to read it. */
function AcceptedNote({ partnerRef, revision }: AcceptedNoteProps): ReactElement {
  return (
    <div data-slot="partner-edit-accepted" className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4 text-sm">
      <p className="font-medium">{ACCEPTED_TITLE}</p>
      <p className="text-pretty">{ACCEPTED_BODY}</p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground">{REVISION_LABEL}</span>
        {/* An opaque revision is isolated, so a mixed-direction neighbour cannot reorder it and a leading zero cannot be lost. */}
        <bdi className="mono-identifier wrap-anywhere">{revision}</bdi>
      </p>
      <p className="min-w-0">
        <Link href={recordHref(partnerRef)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-target max-w-full whitespace-normal")}>
          {BACK_TO_RECORD_LABEL}
        </Link>
      </p>
    </div>
  );
}

interface OutcomeRegionProps {
  readonly outcome: MutationOutcome;
  readonly partnerRef: string;
  readonly fieldLabels: Readonly<Record<string, string | undefined>>;
  readonly onApplyMine: (currentRevision: string) => void;
  readonly onDiscardMine: () => void;
  readonly onRetrySameWork: () => void;
  readonly onCheckResult: () => void;
}

/**
 * The one surface a settled attempt renders: the shared receipt for the outcomes that report a result, the shared
 * conflict panel for a stale write, and the shared notice for the three that report a condition instead of a result.
 * Every one of the eight outcomes is named here, so a ninth fails to compile rather than arriving with nothing to say.
 */
function OutcomeRegion({ outcome, partnerRef, fieldLabels, onApplyMine, onDiscardMine, onRetrySameWork, onCheckResult }: OutcomeRegionProps): ReactElement {
  switch (outcome.outcome) {
    case "accepted":
      return (
        <div data-slot="partner-edit-outcome" data-outcome="accepted" className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={outcome} headingLevel={3} fieldLabels={fieldLabels} />
          <AcceptedNote partnerRef={partnerRef} revision={outcome.revision} />
        </div>
      );
    case "alreadyAccepted":
      return (
        <div data-slot="partner-edit-outcome" data-outcome="alreadyAccepted" className="flex min-w-0 flex-col gap-3">
          {/* A replay states the result stored for this attempt, so the note names the revision that replay first reported. */}
          <OperationResult outcome={outcome} headingLevel={3} fieldLabels={fieldLabels} />
          <AcceptedNote partnerRef={partnerRef} revision={outcome.revision} />
        </div>
      );
    case "unchanged":
      return (
        <div data-slot="partner-edit-outcome" data-outcome="unchanged" className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={outcome} headingLevel={3} fieldLabels={fieldLabels} />
        </div>
      );
    case "invalid":
      return (
        <div data-slot="partner-edit-outcome" data-outcome="invalid" className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={outcome} headingLevel={3} fieldLabels={fieldLabels} />
        </div>
      );
    case "conflict":
      return <ConflictPanel outcome={outcome} fieldLabels={fieldLabels} onApplyMine={onApplyMine} onDiscardMine={onDiscardMine} />;
    case "denied":
      return <StateNotice kind="denied" headingLevel={3} title={EDITS_UNAVAILABLE_TITLE} description={EDITS_UNAVAILABLE_BODY} reasonCode={outcome.reasonCode} className="min-w-0" />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={3} title={FORM_OUTCOME_COPY.unavailable.title} description={FORM_OUTCOME_COPY.unavailable.body} source={outcome.source} retry={{ label: PARTNER_ACTION_LABELS.retry, onClick: onRetrySameWork }} className="min-w-0" />;
    case "unknown":
      return <StateNotice kind="unknown" headingLevel={3} title={FORM_OUTCOME_COPY.unknown.title} description={FORM_OUTCOME_COPY.unknown.body} operationId={outcome.operationId} action={{ label: CHECK_RESULT_LABEL, onClick: onCheckResult }} className="min-w-0" />;
    default:
      // Exhaustive by construction: the eight outcomes above are the closed set, so a ninth fails to compile at this
      // call rather than reaching a surface with nothing to say about it.
      return assertNever(outcome, "Unhandled partner edit outcome");
  }
}

/**
 * The permitted-field edit body for one partner record. It is seeded once from the envelope it was handed and never
 * re-seeded from a later read on its own: a revision that moved has to reach the worker as a conflict they resolve,
 * not as a form that quietly refreshed underneath them. The one deliberate exception is the worker's own choice to
 * discard their input, which returns the controls to the values this page read.
 */
export default function PartnerEditForm({ partnerRef, envelope, onSettled, dir, className }: PartnerEditFormProps): ReactElement {
  const record = envelope.data.partner;
  const headingId = useId();
  const namesHeadingId = useId();
  const methodsHeadingId = useId();
  const actionNoteId = useId();
  const availability = editsAdmitted(envelope);
  const [startingValues] = useState<EditFormValues>(() => valuesOf(record));
  /** The sequence a row's key comes from, seeded past the rows the read already supplied. */
  const rowSequence = useRef({ additional: startingValues.additionalNames.length, methods: startingValues.contactMethods.length });
  const form = useForm({ defaultValues: startingValues });
  const { submit, reset: resetAttempt, isPending, outcome } = useSaveContactEdits(partnerRef);
  /** The attempt a recovery replays: the exact payload and revision last sent, kept as they were sent. */
  const attemptRef = useRef<{ readonly payload: SaveContactEditsPayload; readonly expectedRevision: string } | null>(null);
  const notifiedRef = useRef<string | null>(null);
  /** The one condition a stored restriction can put on this edit, stated once and enforced by the disabled submit. */
  const carryProblem = restrictionCarryProblem(record);

  const submitValues = useCallback(
    (payload: SaveContactEditsPayload, expectedRevision: string): void => {
      attemptRef.current = { payload, expectedRevision };
      void submit({ payload, scope: envelope.scope, expectedRevision }).then((settled: MutationOutcome): void => {
        // One settlement, one notification: a second press that joined the attempt in flight reports the same
        // outcome, and telling the composing route twice about one operation would be a second statement of it.
        if (notifiedRef.current === settled.operationId) {
          return;
        }
        notifiedRef.current = settled.operationId;
        onSettled?.(settled);
      });
    },
    [envelope.scope, onSettled, submit],
  );

  /** Sets every control to `next`, used by the worker's own choice to discard their input. */
  const setValues = useCallback(
    (next: EditFormValues): void => {
      rowSequence.current = { additional: next.additionalNames.length, methods: next.contactMethods.length };
      form.setFieldValue("displayName", next.displayName);
      form.setFieldValue("givenName", next.givenName);
      form.setFieldValue("familyName", next.familyName);
      form.setFieldValue("additionalNames", next.additionalNames);
      form.setFieldValue("contactMethods", next.contactMethods);
      form.setFieldValue("relationshipLabel", next.relationshipLabel);
    },
    [form],
  );

  // Recovery is this same attempt sent again under the identity it already carried, which the service answers with the
  // stored result rather than with a second effect. Nothing here mints a new identity for work that may already exist.
  const replaySameWork = useCallback((): void => {
    const retained = attemptRef.current;
    if (retained !== null) {
      submitValues(retained.payload, retained.expectedRevision);
    }
  }, [submitValues]);

  // Applying the worker's own input against the revision the conflict reported is a different intent from the one that
  // was refused, so it travels under a new attempt identity: a changed intent is not a replay of the stale one.
  const applyMine = useCallback(
    (currentRevision: string): void => {
      submitValues(payloadOf(form.state.values, record, partnerRef), currentRevision);
    },
    [form, partnerRef, record, submitValues],
  );

  // Discarding returns the controls to the values this page read and clears the receipt. It saves nothing, and the
  // value the record holds now stays visible in the receipt until this control is used.
  const discardMine = useCallback((): void => {
    setValues(valuesOf(record));
    resetAttempt();
  }, [record, resetAttempt, setValues]);

  // A refusal, a conflict or an outage stops describing the values on screen the moment one of them changes, so the
  // outcome is cleared on an edit. Nothing entered is cleared with it: every value and every row stays as it was typed.
  const clearSettledRefusal = useCallback((): void => {
    if (outcome !== null && CLEAR_ON_EDIT.has(outcome.outcome)) {
      resetAttempt();
    }
  }, [outcome, resetAttempt]);

  const setAdditionalNames = useCallback(
    (next: readonly AdditionalNameRow[]): void => {
      form.setFieldValue("additionalNames", [...next]);
      clearSettledRefusal();
    },
    [clearSettledRefusal, form],
  );

  const setContactMethods = useCallback(
    (next: readonly ContactMethodRow[]): void => {
      form.setFieldValue("contactMethods", [...next]);
      clearSettledRefusal();
    },
    [clearSettledRefusal, form],
  );

  const fieldErrors = outcome !== null && outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null;
  const unconfirmed = outcome !== null && outcome.outcome === "unknown";
  const labels = fieldLabelsFor(startingValues);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isPending || unconfirmed || carryProblem !== null) {
      return;
    }
    // The revision this page read travels unchanged. A record that moved on answers a conflict rather than being
    // silently overwritten, which is the whole reason the form never refreshes it on its own.
    submitValues(payloadOf(form.state.values, record, partnerRef), envelope.revision);
  };

  return (
    <section dir={dir} aria-labelledby={headingId} data-slot="partner-edit-form" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={headingId} className="font-heading text-lg font-medium">
          {SECTION_HEADING}
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{FORM_LEAD}</p>
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
          <span>{REVISION_LABEL}</span>
          <bdi className="mono-identifier wrap-anywhere">{envelope.revision}</bdi>
        </p>
        <p className="text-sm text-pretty text-muted-foreground">{REVISION_NOTE}</p>
      </div>
      {availability.admitted ? null : (
        // The write this form performs is not available to this context, so no field is drawn at all: a disabled
        // control would suggest the edit is only temporarily out of reach, when what is absent is the permission.
        <StateNotice kind="denied" headingLevel={3} title={EDITS_UNAVAILABLE_TITLE} description={availability.reason ?? EDITS_UNAVAILABLE_BODY} action={{ label: BACK_TO_RECORD_LABEL, href: recordHref(partnerRef) }} className="min-w-0" />
      )}
      {availability.admitted ? (
        <>
          {outcome === null ? null : <OutcomeRegion outcome={outcome} partnerRef={partnerRef} fieldLabels={labels} onApplyMine={applyMine} onDiscardMine={discardMine} onRetrySameWork={replaySameWork} onCheckResult={replaySameWork} />}
          {record.audience === "private" ? (
            <Alert role="note" className="min-w-0">
              <AlertTitle>{PRIVATE_RECORD_COPY.remainsPrivate.title}</AlertTitle>
              <AlertDescription>
                <p>{PRIVATE_RECORD_COPY.preparationIsPrivate.body}</p>
              </AlertDescription>
            </Alert>
          ) : null}
          <form onSubmit={handleSubmit} noValidate aria-busy={isPending ? true : undefined} className="flex min-w-0 flex-col gap-6">
            <form.Field name="displayName">
              {(field) => (
                <FormField name={DISPLAY_NAME_FIELD} label={DISPLAY_NAME_LABEL} description={DISPLAY_NAME_DESCRIPTION} error={fieldErrors?.byField[DISPLAY_NAME_FIELD]} required>
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
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h3 id={namesHeadingId} className="font-heading text-base font-medium">
                  {NAMES_LEGEND}
                </h3>
                <p className="text-sm text-pretty text-muted-foreground">{NAMES_HELP}</p>
              </div>
              <form.Field name="givenName">
                {(field) => (
                  <FormField name={GIVEN_NAME_FIELD} label={GIVEN_NAME_LABEL} error={fieldErrors?.byField[GIVEN_NAME_FIELD]} optionalHint>
                    {(control) => (
                      <Input
                        id={control.id}
                        type="text"
                        value={field.state.value}
                        autoComplete="off"
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
              <form.Field name="familyName">
                {(field) => (
                  <FormField name={FAMILY_NAME_FIELD} label={FAMILY_NAME_LABEL} error={fieldErrors?.byField[FAMILY_NAME_FIELD]} optionalHint>
                    {(control) => (
                      <Input
                        id={control.id}
                        type="text"
                        value={field.state.value}
                        autoComplete="off"
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
                          // One row at a time, added by a control rather than by dragging anything: the row exists the
                          // moment it is added, and removing one takes no other row with it.
                          rowSequence.current.additional += 1;
                          setAdditionalNames([...additionalNames, { rowKey: additionalRowKey(rowSequence.current.additional), value: "" }]);
                        }}
                      >
                        {ADD_ADDITIONAL_NAME_LABEL}
                      </Button>
                      <p className="text-xs text-pretty text-muted-foreground">{ADDITIONAL_NAME_NOTE}</p>
                    </div>
                  </div>
                )}
              </form.Subscribe>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h3 id={methodsHeadingId} className="font-heading text-base font-medium">
                  {CONTACT_METHODS_LEGEND}
                </h3>
                <p className="text-sm text-pretty text-muted-foreground">{CONTACT_METHODS_HELP}</p>
                <p className="text-sm text-pretty text-muted-foreground">{CONTACT_METHODS_IDENTITY_NOTE}</p>
              </div>
              <form.Subscribe selector={(state) => state.values.contactMethods}>
                {(contactMethods) => (
                  <div className="flex min-w-0 flex-col gap-4">
                    {contactMethods.length === 0 ? (
                      <p className="text-sm text-pretty text-muted-foreground">{EMPTY_CONTACT_METHODS_NOTE}</p>
                    ) : (
                      <ul aria-labelledby={methodsHeadingId} className="flex min-w-0 list-none flex-col gap-4 p-0">
                        {contactMethods.map((row, index) => (
                          <li key={row.rowKey} className="min-w-0">
                            <ContactMethodField
                              index={index}
                              row={row}
                              errors={fieldErrors}
                              onChange={(next) => setContactMethods(contactMethods.map((candidate) => (candidate.rowKey === row.rowKey ? next : candidate)))}
                              onRemove={() => setContactMethods(contactMethods.filter((candidate) => candidate.rowKey !== row.rowKey))}
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
                          rowSequence.current.methods += 1;
                          setContactMethods([...contactMethods, { rowKey: contactMethodRowKey(rowSequence.current.methods), kind: CONTACT_KIND_DEFAULT, value: "", permitted: false }]);
                        }}
                      >
                        {ADD_CONTACT_METHOD_LABEL}
                      </Button>
                      <p className="text-xs text-pretty text-muted-foreground">{CONTACT_METHOD_REMOVAL_NOTE}</p>
                    </div>
                  </div>
                )}
              </form.Subscribe>
            </div>
            <form.Field name="relationshipLabel">
              {(field) => (
                <FormField name={RELATIONSHIP_LABEL_FIELD} label={RELATIONSHIP_LABEL} description={RELATIONSHIP_LABEL_DESCRIPTION} error={fieldErrors?.byField[RELATIONSHIP_LABEL_FIELD]} optionalHint>
                  {(control) => (
                    <Input
                      id={control.id}
                      type="text"
                      value={field.state.value}
                      autoComplete="off"
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
            <RestrictionsBlock record={record} />
            {carryProblem === null ? null : (
              <Alert variant="destructive" className="min-w-0">
                <AlertTitle>{RESTRICTION_BLOCK_TITLE}</AlertTitle>
                <AlertDescription>
                  <p>{carryProblem}</p>
                </AlertDescription>
              </Alert>
            )}
            <Separator />
            <div className="flex min-w-0 flex-col gap-2">
              {/* While the last attempt is unconfirmed there is no save control to press: the notice above carries the
                  one honest next step, and a second send is not offered for work that may already have been applied. */}
              {unconfirmed ? null : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={isPending || carryProblem !== null} aria-describedby={actionNoteId} className="min-h-target max-w-full whitespace-normal">
                    {isPending ? SUBMIT_PENDING_LABEL : SUBMIT_LABEL}
                  </Button>
                </div>
              )}
              <p id={actionNoteId} className="text-sm text-pretty text-muted-foreground">
                {unconfirmed ? UNCONFIRMED_NOTE : ACTION_NOTE}
              </p>
            </div>
          </form>
        </>
      ) : null}
    </section>
  );
}
