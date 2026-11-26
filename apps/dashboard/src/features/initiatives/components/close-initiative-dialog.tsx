"use client";
import { useId, useRef, useState, type ReactElement } from "react";
import type { ZodError } from "zod";
import ActionReview from "@/components/action-review";
import { FormField, FormFieldGroup, fieldErrorsFromInvalid, FormErrorSummary, type FieldErrorLookup, type FormFieldControl } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { MutationInput, MutationOutcome, ReadAction, ReadEnvelope, reads } from "@/modules/data-service";
import { CLOSURE_COPY, INITIATIVE_COPY, INITIATIVE_STATE_COPY, REQUESTED_TERMS_COPY, dispositionFallback } from "../copy";
import { useAttemptSubmit, useCloseInitiative } from "../hooks/use-initiative-mutations";
import { closeInitiativePayloadSchema, type CloseInitiativePayload, type InitiativeHandoff } from "../schemas/closure";
import DiscardConfirmation from "./discard-confirmation";
import { StatedInstant, TermFact } from "./figures";
type InitiativeDetailEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];
type InitiativeDetailData = InitiativeDetailEnvelope["data"];
type InitiativeRow = InitiativeDetailData["initiative"];
export interface CloseInitiativeEnvelopeData {
  readonly initiative: Pick<InitiativeRow, "initiativeId" | "name" | "state" | "lifecycle" | "closureDisposition">;
  readonly nextWork: Pick<InitiativeDetailData["nextWork"], "items" | "total">;
  readonly dispositions?: readonly string[];
  readonly handoffRecipients?: readonly string[];
}
export const HANDOFF_CHOICES = ["covering", "eligible-handoff"] as const;
export type HandoffChoice = (typeof HANDOFF_CHOICES)[number];
/** Everything the worker typed. It stays in this component's state, so a refused or unavailable attempt loses nothing (WCAG 3.3.7). */
export type CloseInitiativeFormValues = { readonly disposition: string; readonly handoffChoice: HandoffChoice | null; readonly coveringNote: string; readonly recipient: string; readonly handoffNote: string };
/** The values an unopened dialog holds: the disposition the envelope already records, and nothing else the worker has not written. */ export const initialFormValues = (preservedDisposition: string | null): CloseInitiativeFormValues => ({
  disposition: preservedDisposition ?? "",
  handoffChoice: null,
  coveringNote: "",
  recipient: "",
  handoffNote: "",
});
const CLOSE_HEADING = CLOSURE_COPY.closeHeading;
const CANCEL_LABEL = "Cancel";
const DISPOSITION_LABEL = CLOSURE_COPY.dispositionLabel;
const NOTE_MAX_LENGTH = 500;
const DISPOSITION_MAX_LENGTH = 200;
const COVERING_LEGEND = "Open tasks";
const COVERING_NOTE_LABEL = "How this outcome covers open tasks";
const RECIPIENT_LABEL = "Hand off to";
const HANDOFF_NOTE_LABEL = "Hand-off notes";
const HANDOFF_OPTIONS: readonly { readonly choice: HandoffChoice; readonly label: string; readonly description: string }[] = [
  { choice: "covering", label: "Covered by closing outcome", description: "Explain how closing covers these open tasks (tasks stay open until completed in Tasks)." },
  { choice: "eligible-handoff", label: "Hand off to a teammate", description: "Assign an eligible teammate to follow up on these open tasks." },
];
const NO_OWNED_WORK_BODY = "No open tasks are linked to this initiative, so no hand-off is needed.";
const DISCARD_BODY = "Your entries haven’t been saved yet — closing now discards them.";
export const NO_OWNED_WORK_REASON = "No open tasks were linked to this initiative.";
const CLOSING_STATEMENTS: readonly string[] = [CLOSURE_COPY.closeHelp, CLOSURE_COPY.lateResponseNote, CLOSURE_COPY.handoffNote, INITIATIVE_STATE_COPY.closed.description];
const FIELD_LABELS: Readonly<Record<string, string>> = { initiativeId: "Initiative", disposition: DISPOSITION_LABEL, handoff: COVERING_LEGEND, "handoff.reason": COVERING_NOTE_LABEL, "handoff.note": HANDOFF_NOTE_LABEL, "handoff.toPrincipalId": RECIPIENT_LABEL };
const FIELD_ORDER = ["disposition", "handoff", "handoff.toPrincipalId", "handoff.reason", "handoff.note", "initiativeId"] as const;
function fieldMessagesOf(error: ZodError): Readonly<Record<string, readonly string[]>> {
  const messages: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "handoff" : issue.path.map((step) => String(step)).join(".");
    const existing = messages[path] ?? [];
    messages[path] = existing.includes(issue.message) ? existing : [...existing, issue.message];
  }
  return messages;
}
/** The payload one set of entries states. `disposition` is omitted rather than sent empty when the worker left it blank, so the schema's refinement decides whether a closure may state a handoff instead of a disposition — the same rule the service applies. */
export function buildClosePayload(initiativeId: string, values: CloseInitiativeFormValues, ownsUnfinishedWork: boolean): CloseInitiativePayload {
  const disposition = values.disposition.trim();
  const handoff: InitiativeHandoff = !ownsUnfinishedWork ? { kind: "none", reason: NO_OWNED_WORK_REASON } : values.handoffChoice === "eligible-handoff" ? { kind: "eligible-handoff", toPrincipalId: values.recipient.trim(), note: values.handoffNote.trim() } : { kind: "none", reason: values.coveringNote.trim() };
  return { initiativeId: initiativeId.trim(), ...(disposition === "" ? {} : { disposition }), handoff };
}
/** Whether the worker may go back to the entries. Never offered for an unconfirmed result, which would invite a second close. */ export type CloseSettlement = { readonly note: string; readonly initiativeClosed: boolean; readonly offersDone: boolean; readonly offersRevision: boolean };
const CLOSE_SETTLEMENTS: Readonly<Record<MutationOutcome["outcome"], CloseSettlement>> = {
  accepted: { note: "Initiative closed. Your closing outcome is saved, and any open tasks remain in Tasks.", initiativeClosed: true, offersDone: true, offersRevision: false },
  alreadyAccepted: { note: "Already closed by an earlier attempt.", initiativeClosed: true, offersDone: true, offersRevision: false },
  unchanged: { note: "This initiative was already closed.", initiativeClosed: true, offersDone: true, offersRevision: false },
  conflict: { note: "This initiative was updated elsewhere. Review the current details before trying again.", initiativeClosed: false, offersDone: false, offersRevision: true },
  denied: { note: "You don’t have permission to close this initiative.", initiativeClosed: false, offersDone: true, offersRevision: false },
  invalid: { note: "Fix the highlighted fields and try again — your entries are kept.", initiativeClosed: false, offersDone: false, offersRevision: true },
  unavailable: { note: "The service didn’t respond, so the initiative wasn’t closed. Your entries are kept — try again in a moment.", initiativeClosed: false, offersDone: false, offersRevision: true },
  unknown: { note: "Couldn’t confirm closure. Check the result before trying again.", initiativeClosed: false, offersDone: true, offersRevision: false },
};
export const closeSettlement = (outcome: MutationOutcome["outcome"]): CloseSettlement => CLOSE_SETTLEMENTS[outcome];
type OwnedWorkRow = { readonly taskId: string; readonly title: string; readonly dueOn: string | null; readonly status: string };
interface CloseDialogView {
  readonly name: string;
  readonly state: InitiativeRow["state"];
  readonly lifecycle: InitiativeRow["lifecycle"];
  readonly preservedDisposition: string | null;
  readonly ownedWork: readonly OwnedWorkRow[];
  readonly ownsUnfinishedWork: boolean;
  readonly dispositions: readonly string[];
  readonly recipients: readonly string[];
  readonly refusal: string | null;
}
const OPEN_WORK_STATUS_LABEL: Readonly<Record<string, string>> = { open: "Open", reopened: "Reopened", completed: "Completed", cancelled: "Cancelled" };
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const admittedListOf = (value: unknown): readonly string[] => (Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== ""))] : []);
const ownedWorkRowOf = (item: unknown): readonly OwnedWorkRow[] =>
  !isObject(item) || typeof item.taskId !== "string" ? [] : [{ taskId: item.taskId, title: typeof item.title === "string" && item.title.trim() !== "" ? item.title : item.taskId, dueOn: typeof item.dueOn === "string" ? item.dueOn : null, status: typeof item.status === "string" ? item.status : "open" }];
const ownedWorkOf = (value: unknown): readonly OwnedWorkRow[] => (isObject(value) && Array.isArray(value.items) ? value.items.flatMap(ownedWorkRowOf) : []);
const ownedWorkTotalOf = (value: unknown, rows: readonly OwnedWorkRow[]): number => (isObject(value) && typeof value.total === "number" && Number.isFinite(value.total) && value.total > rows.length ? value.total : rows.length);
const refusalOf = (actions: readonly ReadAction[]): string | null => {
  const action = actions.find((entry) => entry.name === "closeInitiative");
  return action === undefined || action.available ? null : action.reason?.trim() || "This initiative can’t be closed right now.";
};
function viewOf(envelope: ReadEnvelope<CloseInitiativeEnvelopeData>): CloseDialogView | null {
  const data: unknown = envelope.data;
  if (!isObject(data)) return null;
  const initiative = data.initiative;
  if (!isObject(initiative)) return null;
  const name = typeof initiative.name === "string" ? initiative.name : "";
  const state = initiative.state === "closed" ? "closed" : initiative.state === "open" ? "open" : null;
  const lifecycle = initiative.lifecycle === "closed" ? "closed" : initiative.lifecycle === "reopened" ? "reopened" : "open";
  if (name.trim() === "" || state === null) return null;
  const ownedWork = ownedWorkOf(data.nextWork);
  return {
    name,
    state,
    lifecycle,
    preservedDisposition: typeof initiative.closureDisposition === "string" && initiative.closureDisposition.trim() !== "" ? initiative.closureDisposition : null,
    ownedWork,
    ownsUnfinishedWork: ownedWorkTotalOf(data.nextWork, ownedWork) > 0,
    dispositions: admittedListOf(data.dispositions),
    recipients: admittedListOf(data.handoffRecipients),
    refusal: refusalOf(envelope.actions),
  };
}
const controlAria = (field: FormFieldControl): ControlAria => ({ "aria-describedby": field.describedBy, "aria-invalid": field.invalid ? true : undefined, "aria-required": field.required ? true : undefined });
const OwnedWorkItem = ({ work }: { readonly work: OwnedWorkRow }): ReactElement => (
  <li className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-2.5">
    <span className="text-sm font-medium text-pretty break-words">{work.title}</span>
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>{OPEN_WORK_STATUS_LABEL[work.status] ?? work.status}</span>
      <span aria-hidden="true">·</span>
      {work.dueOn === null ? (
        <span>No due date</span>
      ) : (
        <span>
          Due <StatedInstant value={work.dueOn} />
        </span>
      )}
      <span aria-hidden="true">·</span>
      <bdi className="mono-identifier min-w-0 break-all">{work.taskId}</bdi>
    </span>
    <span className="text-xs text-pretty text-muted-foreground">Closing does not complete this work.</span>
  </li>
);
const ClosingStatements = ({ headingId }: { readonly headingId: string }): ReactElement => (
  <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
    <h3 id={headingId} className="type-subsection-title text-pretty">
      What closing does, and what it does not do
    </h3>
    <ul className="flex min-w-0 flex-col gap-1.5 text-sm text-pretty text-muted-foreground">
      {CLOSING_STATEMENTS.map((statement) => (
        <li key={statement}>{statement}</li>
      ))}
    </ul>
  </section>
);
export interface CloseInitiativeDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initiativeId: string;
  readonly envelope: ReadEnvelope<CloseInitiativeEnvelopeData>;
  readonly onClosed?: (outcome: MutationOutcome) => void;
  readonly onCheckResult?: () => void;
  readonly className?: string;
}
type CloseDialogPhase = "details" | "review";
type ControlAria = { readonly "aria-describedby": string | undefined; readonly "aria-invalid": true | undefined; readonly "aria-required": true | undefined };
/** The initiative's closure surface: what closing does, how the work it owns is dealt with, one review step, and the receipt of the attempt. */
export default function CloseInitiativeDialog({ open, onOpenChange, initiativeId, envelope, onClosed, onCheckResult, className }: CloseInitiativeDialogProps): ReactElement | null {
  const view = viewOf(envelope);
  const preservedDisposition = view?.preservedDisposition ?? null;
  const ownsUnfinishedWork = view?.ownsUnfinishedWork ?? false;
  const statementsHeadingId = useId();
  const workHeadingId = useId();
  const choiceIdPrefix = useId();
  const close = useCloseInitiative(envelope.scope);
  const submit = useAttemptSubmit(close);
  const [values, setValues] = useState<CloseInitiativeFormValues>(() => initialFormValues(preservedDisposition));
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [phase, setPhase] = useState<CloseDialogPhase>("details");
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const [discardArmed, setDiscardArmed] = useState(false);
  const reportedRef = useRef<string | null>(null);
  const submitting = close.state.status === "submitting";
  const payload = buildClosePayload(initiativeId, values, ownsUnfinishedWork);
  const reviewInput: Omit<MutationInput<CloseInitiativePayload>, "operationId"> = { scope: envelope.scope, expectedRevision: envelope.revision, payload };
  const validationErrors = (): FieldErrorLookup | null => {
    const parsed = closeInitiativePayloadSchema.safeParse(buildClosePayload(initiativeId, values, ownsUnfinishedWork));
    const byField: Record<string, readonly string[]> = {};
    const form: string[] = [];
    if (!parsed.success) {
      for (const [path, messages] of Object.entries(fieldMessagesOf(parsed.error))) {
        if (messages.length === 0) continue;
        if (path === "_root") form.push(...messages);
        else if (!(values.handoffChoice === null && path.startsWith("handoff."))) byField[path] = messages;
      }
    }
    if (ownsUnfinishedWork && values.handoffChoice === null) byField.handoff = ["Say how the work this initiative still owns is dealt with: covered by the disposition, or handed to someone eligible."];
    const count = Object.keys(byField).length + form.length;
    return count === 0 ? null : { byField, form, count };
  };
  const handleSettled = (outcome: MutationOutcome): void => {
    setSettled(outcome);
    const recorded = closeSettlement(outcome.outcome);
    if (!recorded.initiativeClosed) return;
    const attempt = `${outcome.outcome}:${outcome.operationId}`;
    if (reportedRef.current === attempt) return;
    reportedRef.current = attempt;
    onClosed?.(outcome);
  };
  const settlement = settled === null ? null : closeSettlement(settled.outcome);
  const closeDialog = (): void => {
    reportedRef.current = null;
    setValues(initialFormValues(preservedDisposition));
    setErrors(null);
    setSettled(null);
    setPhase("details");
    setDiscardArmed(false);
    onOpenChange(false);
  };
  const handleOpenChange = (next: boolean): void => {
    if (next) {
      setDiscardArmed(false);
      onOpenChange(true);
      return;
    }
    if (submitting) return;
    if (settlement?.initiativeClosed !== true && (phase === "review" || values.disposition !== initialFormValues(preservedDisposition).disposition || values.handoffChoice !== null || values.coveringNote.trim() !== "" || values.recipient.trim() !== "" || values.handoffNote.trim() !== "")) return setDiscardArmed(true);
    closeDialog();
  };
  const requestClose = (): void => handleOpenChange(false);
  const update = (next: Partial<CloseInitiativeFormValues>): void => {
    setValues((current) => ({ ...current, ...next }));
    setDiscardArmed(false);
    setErrors(null);
  };
  const review = (): void => {
    const found = validationErrors();
    if (found !== null) {
      setErrors(found);
      return;
    }
    setErrors(null);
    setPhase("review");
  };
  const revise = (): void => {
    if (settled !== null && settled.outcome === "invalid") setErrors(fieldErrorsFromInvalid(settled));
    setSettled(null);
    setPhase("details");
  };
  if (view === null) return null;
  const choiceAnnouncement = !ownsUnfinishedWork ? "" : values.handoffChoice === null ? "" : values.handoffChoice === "covering" ? `A field appeared: ${COVERING_NOTE_LABEL}.` : `Fields appeared: ${RECIPIENT_LABEL}, then ${HANDOFF_NOTE_LABEL}.`;
  const dispositionDescription = view.preservedDisposition === null ? CLOSURE_COPY.dispositionRequiredNote : `${CLOSURE_COPY.dispositionRequiredNote} The closure it recorded already states “${dispositionFallback(view.preservedDisposition)}”, and that value is kept here so it is never replaced silently.`;
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-slot="close-initiative-dialog" data-phase={phase} className={cn("sm:max-w-lg", className)}>
        <DialogHeader>
          <DialogTitle>{CLOSE_HEADING}</DialogTitle>
          <DialogDescription>{CLOSURE_COPY.closeHelp}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-5">
          <ClosingStatements headingId={statementsHeadingId} />
          <Separator />
          <section aria-labelledby={workHeadingId} className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-2">
              <h3 {...{ id: workHeadingId, className: "type-subsection-title text-pretty break-words" }}>{view.name}</h3>
              <Badge variant={view.state === "closed" ? "secondary" : "outline"}>{INITIATIVE_STATE_COPY[view.state].label}</Badge>
            </div>
            <p className="type-supporting text-pretty">{INITIATIVE_STATE_COPY[view.state].description}</p>
            {view.preservedDisposition === null ? null : (
              <p className="type-supporting text-pretty">
                {view.lifecycle === "reopened" ? `This initiative was closed before and reopened, and the disposition recorded then is kept: “${dispositionFallback(view.preservedDisposition)}”.` : `The closure recorded states “${dispositionFallback(view.preservedDisposition)}”.`}
              </p>
            )}
            <h4 className="type-group-title">{INITIATIVE_COPY.nextWorkHeading}</h4>
            {view.ownedWork.length === 0 ? (
              <p className="type-supporting text-pretty">{NO_OWNED_WORK_BODY}</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-2">
                {view.ownedWork.map((work) => (
                  <OwnedWorkItem key={work.taskId} work={work} />
                ))}
              </ul>
            )}
          </section>
          <Separator />
          {view.refusal === null ? null : (
            <Alert variant="destructive" role={undefined}>
              <AlertTitle>{"Closing unavailable"}</AlertTitle> <AlertDescription>{view.refusal}</AlertDescription>
            </Alert>
          )}
          {view.state === "open" ? null : (
            <Alert role={undefined}>
              <AlertTitle>{"This initiative is already closed"}</AlertTitle>
              <AlertDescription>{"A closure is recorded, so submitting this form answers that there is nothing to change. The disposition below is the one the closure preserved."}</AlertDescription>
            </Alert>
          )}
          {phase === "details" ? (
            <form
              noValidate
              className="flex min-w-0 flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                review();
              }}
            >
              {errors === null ? null : <FormErrorSummary errors={errors} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={3} />}
              <FormField name="disposition" label={DISPOSITION_LABEL} description={dispositionDescription} error={errors?.byField.disposition} required={!(ownsUnfinishedWork && values.handoffChoice === "eligible-handoff")}>
                {(field) =>
                  view.dispositions.length === 0 ? (
                    <Input id={field.id} name="disposition" type="text" autoComplete="off" maxLength={DISPOSITION_MAX_LENGTH} value={values.disposition} {...controlAria(field)} onChange={(event) => update({ disposition: event.currentTarget.value })} />
                  ) : (
                    <NativeSelect id={field.id} name="disposition" className="w-full" value={values.disposition} {...controlAria(field)} onChange={(event) => update({ disposition: event.currentTarget.value })}>
                      <NativeSelectOption value="">{"Choose a disposition"}</NativeSelectOption>
                      {view.dispositions.map((option) => (
                        <NativeSelectOption key={option} value={option}>
                          {dispositionFallback(option)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )
                }
              </FormField>
              {ownsUnfinishedWork ? (
                <>
                  <FormFieldGroup legend={COVERING_LEGEND} name="handoff" description={CLOSURE_COPY.handoffNote} error={errors?.byField.handoff} required>
                    {({ describedBy, invalid, required, legendId }) => (
                      <RadioGroup
                        value={values.handoffChoice}
                        aria-labelledby={legendId}
                        aria-describedby={describedBy}
                        aria-invalid={invalid ? true : undefined}
                        aria-required={required ? true : undefined}
                        onValueChange={(next) => update({ handoffChoice: next === "eligible-handoff" ? "eligible-handoff" : next === "covering" ? "covering" : null })}
                      >
                        {HANDOFF_OPTIONS.map((option) => {
                          const optionId = `${choiceIdPrefix}-${option.choice}`;
                          const optionDescriptionId = `${optionId}-description`;
                          return (
                            <label key={option.choice} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                              <RadioGroupItem id={optionId} value={option.choice} aria-label={option.label} aria-describedby={optionDescriptionId} className="mt-0.5" />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="text-sm font-medium text-pretty">{option.label}</span>
                                <span {...{ id: optionDescriptionId, className: "text-sm text-pretty text-muted-foreground" }}>{option.description}</span>
                              </span>
                            </label>
                          );
                        })}
                      </RadioGroup>
                    )}
                  </FormFieldGroup>
                  {values.handoffChoice === "covering" ? (
                    <FormField name="handoff.reason" label={COVERING_NOTE_LABEL} description={"Required. This note is recorded as the reason no handoff was needed."} error={errors?.byField["handoff.reason"]} required>
                      {(field) => <Textarea id={field.id} value={values.coveringNote} maxLength={NOTE_MAX_LENGTH} {...controlAria(field)} onChange={(event) => update({ coveringNote: event.currentTarget.value })} />}
                    </FormField>
                  ) : null}
                  {values.handoffChoice === "eligible-handoff" ? (
                    <>
                      <FormField name="handoff.toPrincipalId" label={RECIPIENT_LABEL} description={"Choose from the people this initiative's read states as eligible, or state the person's opaque reference exactly as the source holds it."} error={errors?.byField["handoff.toPrincipalId"]} required>
                        {(field) =>
                          view.recipients.length === 0 ? (
                            <Input id={field.id} type="text" autoComplete="off" value={values.recipient} {...controlAria(field)} onChange={(event) => update({ recipient: event.currentTarget.value })} />
                          ) : (
                            <NativeSelect id={field.id} className="w-full" value={values.recipient} {...controlAria(field)} onChange={(event) => update({ recipient: event.currentTarget.value })}>
                              <NativeSelectOption value="">Choose a person</NativeSelectOption>
                              {view.recipients.map((recipient) => (
                                <NativeSelectOption key={recipient} value={recipient}>
                                  {recipient}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          )
                        }
                      </FormField>
                      <FormField name="handoff.note" label={HANDOFF_NOTE_LABEL} description={"Required. Say what the person taking over needs to know; this note is recorded with the closure."} error={errors?.byField["handoff.note"]} required>
                        {(field) => <Textarea id={field.id} value={values.handoffNote} maxLength={NOTE_MAX_LENGTH} {...controlAria(field)} onChange={(event) => update({ handoffNote: event.currentTarget.value })} />}
                      </FormField>
                    </>
                  ) : null}
                </>
              ) : (
                <Alert role={undefined}>
                  <AlertTitle>{"No unfinished work is recorded as owned by this initiative"}</AlertTitle>
                  <AlertDescription>{NO_OWNED_WORK_BODY}</AlertDescription>
                </Alert>
              )}
              <output className="sr-only">{choiceAnnouncement}</output>
              <DialogFooter>
                <Button {...{ type: "button", variant: "outline", disabled: submitting, onClick: requestClose }}>{CANCEL_LABEL}</Button>
                <Button {...{ type: "submit", disabled: view.refusal !== null }}>{"Review this closure"}</Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex min-w-0 flex-col gap-4">
              <ActionReview<CloseInitiativePayload>
                title={`${CLOSE_HEADING}: ${view.name}`}
                description={
                  <dl className="flex min-w-0 flex-col gap-2 text-sm">
                    <TermFact
                      term="Initiative"
                      value={
                        <>
                          <span className="text-pretty break-words">{view.name}</span> <bdi className="mono-identifier break-all">{initiativeId}</bdi>
                        </>
                      }
                    />
                    <TermFact term={DISPOSITION_LABEL} value={values.disposition.trim() === "" ? <span className="text-muted-foreground">{`${REQUESTED_TERMS_COPY.notStated}: the closure records the handoff of the unfinished work instead.`}</span> : <bdi>{dispositionFallback(values.disposition)}</bdi>} />
                    <TermFact
                      term={COVERING_LEGEND}
                      value={
                        view.ownedWork.length === 0 ? (
                          <span className="text-muted-foreground">{NO_OWNED_WORK_REASON}</span>
                        ) : (
                          <span>{values.handoffChoice === "covering" ? `The disposition covers this work. Note recorded: “${values.coveringNote.trim()}”` : `Handed to ${values.recipient.trim()}. Note recorded: “${values.handoffNote.trim()}”`}</span>
                        )
                      }
                    />
                    {view.ownedWork.length === 0 ? null : <TermFact term={INITIATIVE_COPY.nextWorkHeading} value="Every item of work listed above stays outstanding when this closure is recorded." />}
                  </dl>
                }
                consequence={
                  <ul className="flex min-w-0 flex-col gap-1.5 text-sm text-pretty">
                    {CLOSING_STATEMENTS.map((statement) => (
                      <li key={statement}>{statement}</li>
                    ))}
                  </ul>
                }
                confirmLabel={CLOSURE_COPY.closeHeading}
                cancelLabel={CANCEL_LABEL}
                onCancel={revise}
                consequential
                input={reviewInput}
                submit={submit}
                checkResult={onCheckResult}
                onSettled={handleSettled}
                fieldLabels={FIELD_LABELS}
                headingLevel={3}
              />
              {settlement === null ? null : <p {...{ "data-slot": "close-settlement", "data-outcome": settled?.outcome, className: "type-supporting text-pretty" }}>{settlement.note}</p>}
            </div>
          )}
          {discardArmed ? <DiscardConfirmation title={"Close without recording this closure?"} body={DISCARD_BODY} keepEditingLabel={"Keep editing"} discardLabel={"Discard the entries and close"} onKeepEditing={() => setDiscardArmed(false)} onDiscard={closeDialog} /> : null}
        </div>
        {phase === "review" && settlement !== null ? (
          <DialogFooter>
            {settlement.offersRevision ? <Button {...{ type: "button", variant: "outline", onClick: revise }}>{"Change the details"}</Button> : null}
            {settlement.offersDone ? <Button {...{ type: "button", onClick: requestClose }}>{"Done"}</Button> : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
