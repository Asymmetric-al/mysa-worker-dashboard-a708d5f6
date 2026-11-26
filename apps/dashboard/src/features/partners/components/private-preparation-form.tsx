"use client";
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { outcomeNotice, useAttemptedMutation, type OutcomeNoticeCopy } from "@/components/attempt";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { PRIVATE_RECORD_COPY } from "../copy/privacy";
import { FORM_OUTCOME_COPY, PARTNER_ACTION_LABELS } from "../copy/states";
import { useCreatePrivatePreparation } from "../hooks/use-partner-mutations";
import type { CreatePrivatePreparationPayload, PreparationContactMethod } from "../schemas/preparation";
import { TextAreaField, TextField } from "./bound-fields";
import { CONTACT_KIND_DEFAULT, CONTACT_METHODS_FIELD, ContactMethodList, contactMethodFieldLabels, type ContactMethodRow } from "./contact-method-rows";
const NAME_FIELD = "displayName";
const NOTE_FIELD = "note";
const METHODS_LEGEND = "Contact details";
const SECTION_HEADING = PARTNER_ACTION_LABELS.addPrivateContact;
const NAME_LABEL = "Name";
const NAME_DESCRIPTION = "How you’ll recognize this person. Email and phone are optional.";
const NOTE_LABEL = "Notes";
const NOTE_DESCRIPTION = `Anything you want to remember about this person. ${PRIVATE_RECORD_COPY.noteIsPrivate.body}`;
const METHODS_HELP = "Optional. Mark whether each detail is okay to use for outreach. Adding details here never sends a message or subscribes anyone.";
const SUBMIT_LABEL = PARTNER_ACTION_LABELS.addPrivateContact;
const ACTION_NOTE = "Creates a private contact visible only to you — never sends messages, subscribes anyone, or creates shared records.";
const RESUBMIT_NOTE = "This contact has already been added. Submitting again will create another separate private contact.";
const UNCONFIRMED_NOTE = "Adding is paused until we check the previous result so we don’t create a duplicate.";
const NO_SHARED_IDENTITY = "No shared partner record, household, email consent, or giving entry is created.";
const CREATED_BODY = "Saved as a private contact visible only to you. No shared record, consent, or subscription was created.";
const DENIED_BODY = "You don’t have permission to add private contacts in this ministry.";
const RECEIPT_HEADING_LEVEL = 3;
const CLEAR_ON_EDIT: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["invalid", "conflict", "denied", "unavailable"]);
const NOTICE_COPY: OutcomeNoticeCopy = {
  denied: { title: "Couldn’t add private contact here", description: DENIED_BODY },
  unavailable: { title: FORM_OUTCOME_COPY.unavailable.title, description: FORM_OUTCOME_COPY.unavailable.body },
  unknown: { title: FORM_OUTCOME_COPY.unknown.title, description: FORM_OUTCOME_COPY.unknown.body },
  retryLabel: PARTNER_ACTION_LABELS.retry,
  checkResultLabel: "Check result",
};
export type PrivatePreparationInitialValues = { readonly displayName?: string; readonly contactMethods?: readonly PreparationContactMethod[]; readonly note?: string };
export type PrivatePreparationFormProps = { readonly scope: Scope; readonly expectedRevision: string; readonly initialValues?: PrivatePreparationInitialValues; readonly onCreated?: (partnerRef: string) => void; readonly dir?: "ltr" | "rtl"; readonly className?: string };
type PreparationFormValues = { displayName: string; contactMethods: ContactMethodRow[]; note: string };
const rowKeyAt = (sequence: number): string => `method-${String(sequence)}`;
function valuesOf(initial: PrivatePreparationInitialValues | undefined): PreparationFormValues {
  const methods = initial?.contactMethods ?? [];
  return { displayName: initial?.displayName ?? "", contactMethods: methods.map((method, index) => ({ kind: method.kind, value: method.value, permitted: method.permitted, rowKey: rowKeyAt(index) })), note: initial?.note ?? "" };
}
function payloadOf(values: PreparationFormValues): CreatePrivatePreparationPayload {
  const methods: PreparationContactMethod[] = values.contactMethods.map((row) => ({ kind: row.kind, value: row.value.trim(), permitted: row.permitted }));
  const note = values.note.trim();
  return { displayName: values.displayName.trim(), ...(methods.length === 0 ? {} : { contactMethods: methods }), ...(note === "" ? {} : { note }) };
}
const fieldLabelsFor = (rowCount: number): Readonly<Record<string, string | undefined>> => contactMethodFieldLabels({ [NAME_FIELD]: NAME_LABEL, [NOTE_FIELD]: NOTE_LABEL, [CONTACT_METHODS_FIELD]: METHODS_LEGEND }, rowCount);
function createdReferenceOf(outcome: MutationOutcome): string | null {
  if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") return null;
  const named = (outcome.created ?? []).find((reference) => reference.trim() !== "");
  if (named !== undefined) return named;
  if (outcome.outcome !== "alreadyAccepted") return null;
  const stored: unknown = outcome.result;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return null;
  const reference: unknown = Reflect.get(stored, "partnerId");
  return typeof reference === "string" && reference.trim() !== "" ? reference : null;
}
function CreatedPrivateRecord({ partnerRef }: { readonly partnerRef: string }): ReactElement {
  const route = `/partners/${encodeURIComponent(partnerRef)}`;
  return (
    <div data-slot="created-private-record" className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4 text-sm">
      <p className="type-group-title text-foreground">Private contact added</p>
      <p className="type-supporting text-pretty">{CREATED_BODY}</p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-body">
        <span className="text-muted-foreground">ID:</span>
        <bdi className="mono-identifier wrap-anywhere">{partnerRef}</bdi>
      </p>
      <p className="min-w-0">
        <Link {...{ href: route, "data-slot": "button", className: cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-target max-w-full whitespace-normal") }}>Open contact</Link>
      </p>
    </div>
  );
}
type OutcomeRegionProps = { readonly outcome: MutationOutcome; readonly fieldLabels: Readonly<Record<string, string | undefined>>; readonly createdReference: string | null; readonly onReapply: (currentRevision: string) => void; readonly onRetrySameWork: () => void; readonly onCheckResult: () => void };
function OutcomeRegion({ outcome, fieldLabels, createdReference, onReapply, onRetrySameWork, onCheckResult }: OutcomeRegionProps): ReactElement {
  const notice = outcomeNotice(outcome, NOTICE_COPY, { onRetrySameWork, onCheckResult, headingLevel: RECEIPT_HEADING_LEVEL, className: "min-w-0" });
  if (notice !== null) return <StateNotice {...notice} />;
  const created = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted";
  return (
    <div data-slot="private-preparation-outcome" data-outcome={outcome.outcome} className="flex min-w-0 flex-col gap-3">
      <OperationResult outcome={outcome} headingLevel={RECEIPT_HEADING_LEVEL} fieldLabels={outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? undefined : fieldLabels} onReapply={outcome.outcome === "conflict" ? () => onReapply(outcome.currentRevision) : undefined} />
      {created ? createdReference === null ? <p className="type-supporting text-pretty">Saved, but no ID was returned — you’ll find it in your Partners list.</p> : <CreatedPrivateRecord partnerRef={createdReference} /> : null}
    </div>
  );
}
/** The form that creates one private preparation record from a name alone, and reports what the attempt produced. */ export default function PrivatePreparationForm({ scope, expectedRevision, initialValues, onCreated, dir, className }: PrivatePreparationFormProps): ReactElement {
  const [headingId, methodsHeadingId, actionNoteId] = [useId(), useId(), useId()];
  const [startingValues] = useState<PreparationFormValues>(() => valuesOf(initialValues));
  const rowSequence = useRef(startingValues.contactMethods.length);
  const form = useForm({ defaultValues: startingValues });
  const { submit } = useCreatePrivatePreparation();
  const creation = useAttemptedMutation<CreatePrivatePreparationPayload>(submit);
  const { outcome, pending: isPending, reset: resetAttempt } = creation;
  const notifiedOperationRef = useRef<string | null>(null);
  const replaySameWork = (): void => void creation.retry();
  const reapplySameWork = (): void => void creation.reapplyOnConflict();
  const clearSettledRefusal = useCallback((): void => {
    if (outcome !== null && CLEAR_ON_EDIT.has(outcome.outcome)) resetAttempt();
  }, [outcome, resetAttempt]);
  const createdReference = outcome === null ? null : createdReferenceOf(outcome);
  useEffect(() => {
    if (outcome === null || createdReference === null || notifiedOperationRef.current === outcome.operationId) return;
    notifiedOperationRef.current = outcome.operationId;
    onCreated?.(createdReference);
  }, [createdReference, onCreated, outcome]);
  const fieldErrors = creation.fieldErrors;
  const unconfirmed = outcome !== null && outcome.outcome === "unknown";
  const setMethods = useCallback(
    (next: readonly ContactMethodRow[]): void => {
      form.setFieldValue(CONTACT_METHODS_FIELD, [...next]);
      clearSettledRefusal();
    },
    [clearSettledRefusal, form],
  );
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isPending || unconfirmed) return;
    void creation.submit({ scope, expectedRevision, payload: payloadOf(form.state.values) });
  };
  return (
    <section dir={dir} aria-labelledby={headingId} data-slot="private-preparation-form" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 {...{ id: headingId, className: "type-section-title" as const }}>{SECTION_HEADING}</h2>
        <p className="type-supporting text-pretty">Only a name is required. Everything else is optional and stays private to you.</p>
      </div>
      <Alert className="min-w-0">
        <AlertTitle>{PRIVATE_RECORD_COPY.preparationIsPrivate.title}</AlertTitle>
        <AlertDescription>
          <p>{PRIVATE_RECORD_COPY.preparationIsPrivate.body}</p>
          <p>{NO_SHARED_IDENTITY}</p>
        </AlertDescription>
      </Alert>
      {outcome === null ? null : <OutcomeRegion outcome={outcome} fieldLabels={fieldLabelsFor(form.state.values.contactMethods.length)} createdReference={createdReference} onReapply={reapplySameWork} onRetrySameWork={replaySameWork} onCheckResult={replaySameWork} />}
      <form onSubmit={handleSubmit} noValidate aria-busy={isPending ? true : undefined} className="flex min-w-0 flex-col gap-6">
        <form.Field name={NAME_FIELD}>{(field) => <TextField field={field} name={NAME_FIELD} label={NAME_LABEL} description={NAME_DESCRIPTION} error={fieldErrors?.byField[NAME_FIELD]} required onEdit={clearSettledRefusal} className="w-full" />}</form.Field>
        <form.Field name={NOTE_FIELD}>{(field) => <TextAreaField field={field} name={NOTE_FIELD} label={NOTE_LABEL} description={NOTE_DESCRIPTION} error={fieldErrors?.byField[NOTE_FIELD]} optionalHint rows={4} onEdit={clearSettledRefusal} className="w-full" />}</form.Field>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 {...{ id: methodsHeadingId, className: "type-subsection-title" as const }}>{METHODS_LEGEND}</h3>
            <p className="type-supporting text-pretty">{METHODS_HELP}</p>
          </div>
          <form.Subscribe selector={(state) => state.values.contactMethods}>
            {(methods) => (
              <ContactMethodList
                rows={methods}
                headingId={methodsHeadingId}
                errors={fieldErrors}
                valueDescription="Email address, phone number, or mailing address (saved as entered, not verified automatically)."
                emptyNote="No contact details added yet — a name alone is enough to save."
                addNote="You can add or remove details anytime."
                onRowsChange={setMethods}
                onAdd={() => {
                  rowSequence.current += 1;
                  setMethods([...methods, { kind: CONTACT_KIND_DEFAULT, value: "", permitted: false, rowKey: rowKeyAt(rowSequence.current) }]);
                }}
              />
            )}
          </form.Subscribe>
        </div>
        <Separator />
        <div className="flex min-w-0 flex-col gap-2">
          {unconfirmed ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Button {...{ type: "submit" as const, disabled: isPending, "aria-describedby": actionNoteId, className: "min-h-target max-w-full whitespace-normal" as const }}>{isPending ? "Adding private contact…" : SUBMIT_LABEL}</Button>
            </div>
          )}
          <p {...{ id: actionNoteId, className: "type-supporting text-pretty" as const }}>{unconfirmed ? UNCONFIRMED_NOTE : createdReference === null ? ACTION_NOTE : RESUBMIT_NOTE}</p>
        </div>
      </form>
    </section>
  );
}
