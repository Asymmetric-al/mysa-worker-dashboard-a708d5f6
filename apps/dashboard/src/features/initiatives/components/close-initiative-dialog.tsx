"use client";
/**
 * Closing an initiative: the disposition, how the work the initiative still owns is dealt with, the
 * statements that say exactly what closing does and does not do, one review step, and the durable
 * receipt of the attempt.
 *
 * Three boundaries are held here rather than stated as promises in prose:
 *
 * - Closing fences new solicitation **only**. A late response that actually arrives after the closure
 *   stays recordable without reopening, so nothing in this dialog claims that the relationship ended.
 * - Closing resolves nothing. Work the initiative owns keeps its owner, and the handoff recorded here
 *   changes who is responsible for it — never whether it was done. The disposition is the worker's own
 *   assessment, so it is never derived from a date, a count or a state.
 * - Closing sends nothing outward, so there is no message to recall and no third-party copy to
 *   reverse, and no outward field is offered to pretend otherwise.
 *
 * The disposition vocabulary and the people who may take work over are the envelope's to state. This
 * dialog renders a closed choice whenever the envelope supplies one (`dispositions`,
 * `handoffRecipients`); where it supplies none it offers the bounded entry the service itself accepts
 * rather than inventing a taxonomy of closure reasons or a roster of principals.
 */
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { ZodError } from "zod";
import ActionReview from "@/components/action-review";
import { FormField, FormFieldGroup, fieldErrorsFromInvalid, FormErrorSummary, type FieldErrorLookup } from "@/components/form-field";
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
import { assertNever } from "@/lib/result";
import type { MutationInput, MutationOutcome, ReadAction, ReadEnvelope, reads } from "@/modules/data-service";
import { CLOSURE_COPY, INITIATIVE_COPY, INITIATIVE_STATE_COPY, REQUESTED_TERMS_COPY, dispositionFallback } from "../copy";
import { useCloseInitiative } from "../hooks/use-initiative-mutations";
import { closeInitiativePayloadSchema, type CloseInitiativePayload, type InitiativeHandoff } from "../schemas/closure";
// The detail read's own types, narrowed to the fields this dialog renders
type InitiativeDetailEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];

type InitiativeDetailData = InitiativeDetailEnvelope["data"];

type InitiativeRow = InitiativeDetailData["initiative"];
/**
 * What this dialog reads from the envelope it is given.
 *
 * The four members it needs are the initiative's identity and state, the work the initiative still
 * owns, an optional admitted disposition list and an optional admitted roster of people who may take
 * that work over. A caller that forwards the detail read's whole envelope satisfies this shape as it
 * stands, so nothing has to be copied out of it and no second projection is built for the dialog.
 */
export interface CloseInitiativeEnvelopeData {
  readonly initiative: Pick<InitiativeRow, "initiativeId" | "name" | "state" | "lifecycle" | "closureDisposition">;
  readonly nextWork: Pick<InitiativeDetailData["nextWork"], "items" | "total">;
  /** The dispositions the source admits, when it states a closed list; absent means the source admits none. */
  readonly dispositions?: readonly string[];
  /** The principals eligible to take unfinished work over, when the source states them. */
  readonly handoffRecipients?: readonly string[];
}
/** The two ways owned unfinished work can be dealt with by a closure. */
export const HANDOFF_CHOICES = ["covering", "eligible-handoff"] as const;

export type HandoffChoice = (typeof HANDOFF_CHOICES)[number];
/** Everything the worker typed. It stays in this component's state, so a refused or unavailable attempt loses nothing (WCAG 3.3.7). */
export interface CloseInitiativeFormValues {
  readonly disposition: string;
  readonly handoffChoice: HandoffChoice | null;
  readonly coveringNote: string;
  readonly recipient: string;
  readonly handoffNote: string;
}
/** The values an unopened dialog holds: the disposition the envelope already records, and nothing else the worker has not written. */
export function initialFormValues(preservedDisposition: string | null): CloseInitiativeFormValues {
  return {
    disposition: preservedDisposition ?? "",
    handoffChoice: null,
    coveringNote: "",
    recipient: "",
    handoffNote: "",
  };
}
const CLOSE_HEADING = CLOSURE_COPY.closeHeading;

const CLOSE_CONFIRM_LABEL = CLOSURE_COPY.closeHeading;

const REVISE_LABEL = "Change the details";

const DONE_LABEL = "Done";

const CANCEL_LABEL = "Cancel";

const REVIEW_LABEL = "Review this closure";

const DISPOSITION_PLACEHOLDER = "Choose a disposition";

const DISPOSITION_LABEL = CLOSURE_COPY.dispositionLabel;

const INITIATIVE_LABEL = "Initiative";
/** The bound the service puts on a disposition, so an entry that cannot be sent is refused here first with the same limit. */
const DISPOSITION_MAX_LENGTH = 200;
/** The bound the service puts on a handoff note and on the acknowledgement that a disposition covers the work. */
const NOTE_MAX_LENGTH = 500;

const COVERING_LEGEND = "Unfinished work";

const COVERING_LABEL = "The disposition above covers this work";

const COVERING_DESCRIPTION = "You state that the closure you are recording also settles this work, and say how in your own words. The work is not completed by closing.";

const COVERING_NOTE_LABEL = "How the disposition covers this work";

const COVERING_NOTE_DESCRIPTION = "Required. This note is recorded as the reason no handoff was needed.";

const HANDOFF_LABEL = "Hand this work to someone else";

const HANDOFF_DESCRIPTION = "The person you name becomes responsible for the unfinished work. Handing it over neither completes it nor asks anyone to accept it in this application.";

const RECIPIENT_LABEL = "Person taking over";

const RECIPIENT_DESCRIPTION = "Choose from the people this initiative's read states as eligible, or state the person's opaque reference exactly as the source holds it.";

const HANDOFF_NOTE_LABEL = "What is being handed over";

const HANDOFF_NOTE_DESCRIPTION = "Required. Say what the person taking over needs to know; this note is recorded with the closure.";

const HANDOFF_CHOICE_REQUIRED = "Say how the work this initiative still owns is dealt with: covered by the disposition, or handed to someone eligible.";

const NO_OWNED_WORK_TITLE = "No unfinished work is recorded as owned by this initiative";

const NO_OWNED_WORK_BODY = "Nothing is handed over, because the read states no open work for this initiative. The closure records that no handoff was needed.";

const CLOSED_ALREADY_TITLE = "This initiative is already closed";

const CLOSED_ALREADY_BODY = "A closure is recorded, so submitting this form answers that there is nothing to change. The disposition below is the one the closure preserved.";

const REFUSED_TITLE = "Closing is not on offer in this read";

const DISCARD_TITLE = "Close without recording this closure?";

const DISCARD_BODY = "The entries you typed are held only in this dialog, so closing it discards them. Nothing has been sent to the source.";

const KEEP_EDITING_LABEL = "Keep editing";

const DISCARD_LABEL = "Discard the entries and close";

/** The one statement about outward effects: there are none, so nothing is recalled and nothing is reversed. */
const SENDS_NOTHING_NOTE = "Closing sends nothing and recalls nothing: no message leaves this application in this release, so there is no third-party copy to withdraw.";
/** What is recorded when the read states no open work for the initiative, shown in the review so the worker sees the exact statement before confirming. */
export const NO_OWNED_WORK_REASON = "No unfinished work was recorded as owned by this initiative, so nothing was handed over.";
/** The five statements the dialog shows before the worker submits, in reading order. */
const CLOSING_STATEMENTS: readonly string[] = [CLOSURE_COPY.closeHelp, CLOSURE_COPY.lateResponseNote, CLOSURE_COPY.handoffNote, INITIATIVE_STATE_COPY.closed.description, SENDS_NOTHING_NOTE];
/** The field labels the aggregate summary and the receipt use, keyed as the schemas report them. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  initiativeId: "Initiative",
  disposition: DISPOSITION_LABEL,
  handoff: COVERING_LEGEND,
  "handoff.reason": COVERING_NOTE_LABEL,
  "handoff.note": HANDOFF_NOTE_LABEL,
  "handoff.toPrincipalId": RECIPIENT_LABEL,
};

const FIELD_ORDER = ["disposition", "handoff", "handoff.toPrincipalId", "handoff.reason", "handoff.note", "initiativeId"] as const;
/** The prefix the closure schema's handoff members report their messages under. */
const HANDOFF_PATH_PREFIX = "handoff.";
/** The path an issue with no field of its own is reported under, as the shared outcome mapping reads it. */
const ROOT_FIELD_KEY = "_root";
/** The messages a Zod failure carries, keyed by field path so a field and the aggregate summary read the same strings. */
function fieldMessagesOf(error: ZodError): Readonly<Record<string, readonly string[]>> {
  const messages: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "handoff" : issue.path.map((step) => String(step)).join(".");
    const existing = messages[path];
    if (existing === undefined) {
      messages[path] = [issue.message];
    } else if (!existing.includes(issue.message)) {
      existing.push(issue.message);
    }
  }
  return messages;
}
/**
 * The payload one set of entries states.
 *
 * `disposition` is omitted rather than sent empty when the worker left it blank, so the schema's
 * refinement decides whether a closure may state a handoff instead of a disposition — the same rule
 * the service applies. The handoff member is always present because the server schema requires it: the
 * `none` member records why no handoff was needed, which is why silence can never close an initiative.
 */
export function buildClosePayload(initiativeId: string, values: CloseInitiativeFormValues, ownsUnfinishedWork: boolean): CloseInitiativePayload {
  const disposition = values.disposition.trim();
  const handoff: InitiativeHandoff = !ownsUnfinishedWork
    ? { kind: "none", reason: NO_OWNED_WORK_REASON }
    : values.handoffChoice === "eligible-handoff"
      ? { kind: "eligible-handoff", toPrincipalId: values.recipient.trim(), note: values.handoffNote.trim() }
      : { kind: "none", reason: values.coveringNote.trim() };
  return {
    initiativeId: initiativeId.trim(),
    ...(disposition === "" ? {} : { disposition }),
    handoff,
  };
}
/** What each of the eight outcomes means for this dialog, and which actions it may therefore offer. */
export interface CloseSettlement {
  /** What the closure attempt means, stated once so the receipt and the surface agree. */
  readonly note: string;
  /** Whether the initiative stands closed as a result of this attempt, so the surface that read it is told to re-read. */
  readonly initiativeClosed: boolean;
  /** Whether the dialog's own closing action may be offered: the work is over for this attempt. */
  readonly offersDone: boolean;
  /** Whether the worker may go back to the entries. Never offered for an unconfirmed result, which would invite a second close. */
  readonly offersRevision: boolean;
}
/**
 * The one switch over the closed outcome set, exhausted through `assertNever`.
 *
 * `unknown` deliberately offers no way back to the entries: the effect may already stand, so editing
 * and submitting again would be a second closure under a fresh identity. Its only recovery is checking
 * the result of the attempt that was made.
 */
export function closeSettlement(outcome: MutationOutcome["outcome"]): CloseSettlement {
  switch (outcome) {
    case "accepted":
      return {
        note: "This initiative is closed. The disposition is recorded, the surface that read it now states the closure, and every item of work it owns that was still open stays outstanding.",
        initiativeClosed: true,
        offersDone: true,
        offersRevision: false,
      };
    case "alreadyAccepted":
      return {
        note: "This attempt was already accepted, so the stored result is shown and nothing was closed a second time.",
        initiativeClosed: true,
        offersDone: true,
        offersRevision: false,
      };
    case "unchanged":
      return {
        note: "This initiative already stood closed, so this attempt recorded no change and no second closure.",
        initiativeClosed: true,
        offersDone: true,
        offersRevision: false,
      };
    case "conflict":
      return {
        note: "This initiative moved since this page read it. Your entries are kept exactly as you wrote them, beside the current record, so you can compare before deciding.",
        initiativeClosed: false,
        offersDone: false,
        offersRevision: true,
      };
    case "denied":
      return {
        note: "Nothing was recorded, and this answer names no record, count or title: a refusal reveals nothing about the initiative.",
        initiativeClosed: false,
        offersDone: true,
        offersRevision: false,
      };
    case "invalid":
      return {
        note: "Nothing was sent. Correct the field named above and review the closure again; every entry you made is kept.",
        initiativeClosed: false,
        offersDone: false,
        offersRevision: true,
      };
    case "unavailable":
      return {
        note: "The source could not answer, so no closure was recorded. Your entries are kept, and the same work can be tried again under this attempt's own identity.",
        initiativeClosed: false,
        offersDone: false,
        offersRevision: true,
      };
    case "unknown":
      return {
        note: "The closure may or may not have been recorded, and this application cannot know which. Check the result for this operation rather than closing again.",
        initiativeClosed: false,
        offersDone: true,
        offersRevision: false,
      };
    default:
      return assertNever(outcome, "Unhandled closure outcome");
  }
}
/** One item of work the initiative still owns, named as the closure surface presents it. */
interface OwnedWorkRow {
  readonly taskId: string;
  readonly title: string;
  readonly dueOn: string | null;
  readonly status: string;
}
/** Everything this dialog reads off the envelope, narrowed once so the markup never re-checks a runtime shape. */
interface CloseDialogView {
  readonly name: string;
  readonly state: InitiativeRow["state"];
  readonly lifecycle: InitiativeRow["lifecycle"];
  readonly preservedDisposition: string | null;
  readonly ownedWork: readonly OwnedWorkRow[];
  /** Whether the read states work this initiative owns and has not finished. */
  readonly ownsUnfinishedWork: boolean;
  readonly dispositions: readonly string[];
  readonly recipients: readonly string[];
  /** The reason the read states for not offering a closure, or `null` when it offers one. */
  readonly refusal: string | null;
}

const NO_CLOSURE_REASON = "This read does not state that a closure is available.";

const OPEN_WORK_STATUS_LABEL: Readonly<Record<string, string>> = {
  open: "Open",
  reopened: "Reopened",
  completed: "Completed",
  cancelled: "Cancelled",
};

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** The admitted values an envelope may state as a list: non-empty strings, in the order the source gave them, each at most once. */
function admittedListOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "" && !entries.includes(entry)) {
      entries.push(entry);
    }
  }
  return entries;
}
/** The work the read states as owned and unfinished, mapped to what the list renders. */
function ownedWorkOf(value: unknown): readonly OwnedWorkRow[] {
  const items = isObject(value) ? value.items : undefined;
  if (!Array.isArray(items)) {
    return [];
  }
  const rows: OwnedWorkRow[] = [];
  for (const item of items) {
    if (!isObject(item) || typeof item.taskId !== "string") {
      continue;
    }
    const title = typeof item.title === "string" && item.title.trim() !== "" ? item.title : item.taskId;
    rows.push({
      taskId: item.taskId,
      title,
      dueOn: typeof item.dueOn === "string" ? item.dueOn : null,
      status: typeof item.status === "string" ? item.status : "open",
    });
  }
  return rows;
}
/** The total the read states for that work, so a page of items never understates what the initiative owns. */
function ownedWorkTotalOf(value: unknown, rows: readonly OwnedWorkRow[]): number {
  const total = isObject(value) ? value.total : undefined;
  return typeof total === "number" && Number.isFinite(total) && total > rows.length ? total : rows.length;
}
/** The reason the read gives for withholding the closure, or `null` when it does not withhold it. */
function refusalOf(actions: readonly ReadAction[]): string | null {
  const action = actions.find((entry) => entry.name === "closeInitiative");
  if (action === undefined || action.available) {
    return null;
  }
  const reason = action.reason?.trim() ?? "";
  return reason === "" ? NO_CLOSURE_REASON : reason;
}
/** What this dialog reads off the envelope, or `null` when the envelope is not one it can render. */
function viewOf(envelope: ReadEnvelope<CloseInitiativeEnvelopeData>): CloseDialogView | null {
  const data: unknown = envelope.data;
  if (!isObject(data)) {
    return null;
  }
  const initiative = data.initiative;
  if (!isObject(initiative)) {
    return null;
  }
  const name = typeof initiative.name === "string" ? initiative.name : "";
  const state = initiative.state === "closed" ? "closed" : initiative.state === "open" ? "open" : null;
  const lifecycle = initiative.lifecycle === "closed" ? "closed" : initiative.lifecycle === "reopened" ? "reopened" : "open";
  if (name.trim() === "" || state === null) {
    return null;
  }
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
    // `actions` is advisory and the service re-checks on submit, so a reason is shown as the read's
    // explanation for withholding the control and never as a second authority beside the service.
    refusal: refusalOf(envelope.actions),
  };
}
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-1.5">
      {/* The term and the value both wrap anywhere: a long disposition or identifier is the widest
       * thing in the review, and letting it squeeze the label into a clipped column is how a narrow
       * surface loses the name of the fact it is showing. */}
      <dt className="min-w-0 text-muted-foreground wrap-anywhere">{term}</dt>
      <dd className="min-w-0 wrap-anywhere">{children}</dd>
    </div>
  );
}
/** A civil date as the source states it: a calendar day with no time of day and no zone behind it. */
function CivilDate({ value }: { readonly value: string }): ReactElement {
  return (
    <bdi>
      <time className="tabular-figures" dateTime={value}>
        {value}
      </time>
    </bdi>
  );
}
/** One item of work the initiative still owns, with the fact that closing leaves it outstanding. */
function OwnedWorkItem({ work }: { readonly work: OwnedWorkRow }): ReactElement {
  const statusLabel = OPEN_WORK_STATUS_LABEL[work.status] ?? work.status;
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-2.5">
      <span className="text-sm font-medium text-pretty break-words">{work.title}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{statusLabel}</span>
        <span aria-hidden="true">·</span>
        {work.dueOn === null ? (
          <span>No due date</span>
        ) : (
          <span>
            Due <CivilDate value={work.dueOn} />
          </span>
        )}
        <span aria-hidden="true">·</span>
        <span className="min-w-0 break-all">
          <bdi className="mono-identifier">{work.taskId}</bdi>
        </span>
      </span>
      <span className="text-xs text-pretty text-muted-foreground">Closing does not complete this work.</span>
    </li>
  );
}
/** The statements shown before the worker submits: the fence, the late response, the outstanding work, and the absence of any outward effect. */
function ClosingStatements({ headingId }: { readonly headingId: string }): ReactElement {
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-pretty">
        What closing does, and what it does not do
      </h3>
      <ul className="flex min-w-0 flex-col gap-1.5 text-sm text-pretty text-muted-foreground">
        {CLOSING_STATEMENTS.map((statement) => (
          <li key={statement}>{statement}</li>
        ))}
      </ul>
    </section>
  );
}
/** Props of {@link CloseInitiativeDialog}. */
export interface CloseInitiativeDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The initiative this closure is for: the identifier the mutation names, and never one read off a display value. */
  readonly initiativeId: string;
  /** The detail read's envelope: the scope and revision the change must present, the state, the work it owns and any admitted lists. */
  readonly envelope: ReadEnvelope<CloseInitiativeEnvelopeData>;
  /** Told once per attempt whose result leaves the initiative closed, so the surface that read it can re-read rather than assume. */
  readonly onClosed?: (outcome: MutationOutcome) => void;
  /** Re-reads the initiative for an unconfirmed attempt; the receipt offers this and never a second closure. */
  readonly onCheckResult?: () => void;
  readonly className?: string;
}
/** The two steps of the dialog: the entries, then the review step that applies them. */
type CloseDialogPhase = "details" | "review";
/** The initiative's closure surface: what closing does, how the work it owns is dealt with, one review step, and the receipt of the attempt. */
export default function CloseInitiativeDialog({ open, onOpenChange, initiativeId, envelope, onClosed, onCheckResult, className }: CloseInitiativeDialogProps): ReactElement | null {
  const view = viewOf(envelope);
  const preservedDisposition = view?.preservedDisposition ?? null;
  const ownsUnfinishedWork = view?.ownsUnfinishedWork ?? false;
  const statementsHeadingId = useId();
  const workHeadingId = useId();
  const choiceIdPrefix = useId();
  const close = useCloseInitiative(envelope.scope);
  const submitClose = close.submit;
  const [values, setValues] = useState<CloseInitiativeFormValues>(() => initialFormValues(preservedDisposition));
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [phase, setPhase] = useState<CloseDialogPhase>("details");
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const [discardArmed, setDiscardArmed] = useState(false);
  const waitingRef = useRef<((outcome: MutationOutcome) => void) | null>(null);
  const keepEditingRef = useRef<HTMLButtonElement | null>(null);
  const reportedRef = useRef<string | null>(null);
  const submitting = close.state.status === "submitting";
  const hookOutcome = close.state.status === "settled" ? close.state.outcome : null;
  // The family's handle reports the attempt's state rather than returning its result, while the shared
  // review step resolves once the attempt has an outcome. The attempt's own operationId stays the
  // review step's: nothing is minted here, and a replay resolves this same waiting promise with the
  // stored result.
  useEffect(() => {
    if (hookOutcome === null) {
      return;
    }
    const resolve = waitingRef.current;
    waitingRef.current = null;
    resolve?.(hookOutcome);
  }, [hookOutcome]);
  // The discard step keeps editing as its default: focus moves to that safe option, never to the
  // action that throws the entries away.
  useEffect(() => {
    if (discardArmed) {
      keepEditingRef.current?.focus();
    }
  }, [discardArmed]);
  const payload = buildClosePayload(initiativeId, values, ownsUnfinishedWork);
  const reviewInput: Omit<MutationInput<CloseInitiativePayload>, "operationId"> = { scope: envelope.scope, expectedRevision: envelope.revision, payload };
  const submit = (input: MutationInput<CloseInitiativePayload>): Promise<MutationOutcome> =>
    new Promise<MutationOutcome>((resolve) => {
      waitingRef.current = resolve;
      submitClose({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
    });
  const validationErrors = (): FieldErrorLookup | null => {
    const parsed = closeInitiativePayloadSchema.safeParse(buildClosePayload(initiativeId, values, ownsUnfinishedWork));
    const byField: Record<string, readonly string[]> = {};
    const form: string[] = [];
    if (!parsed.success) {
      for (const [path, messages] of Object.entries(fieldMessagesOf(parsed.error))) {
        if (messages.length === 0) {
          continue;
        }
        if (path === ROOT_FIELD_KEY) {
          form.push(...messages);
          continue;
        }
        // Until the worker chooses how the work is dealt with, the fields a handoff's own messages name
        // are not on screen; the choice is refused on the group instead, and the handoff fields report
        // their own messages as soon as one is chosen.
        if (values.handoffChoice === null && path.startsWith(HANDOFF_PATH_PREFIX)) {
          continue;
        }
        byField[path] = messages;
      }
    }
    // The choice itself is a form concept rather than a payload field: without it the closure is
    // refused on the group it belongs to, whatever the disposition says.
    if (ownsUnfinishedWork && values.handoffChoice === null) {
      byField.handoff = [HANDOFF_CHOICE_REQUIRED];
    }
    const count = Object.keys(byField).length + form.length;
    return count === 0 ? null : { byField, form, count };
  };
  const handleSettled = (outcome: MutationOutcome): void => {
    setSettled(outcome);
    const recorded = closeSettlement(outcome.outcome);
    if (!recorded.initiativeClosed) {
      return;
    }
    const attempt = `${outcome.outcome}:${outcome.operationId}`;
    if (reportedRef.current === attempt) {
      return;
    }
    reportedRef.current = attempt;
    onClosed?.(outcome);
  };
  const settlement = settled === null ? null : closeSettlement(settled.outcome);
  const untouched = initialFormValues(preservedDisposition);
  const hasEntries =
    phase === "review" ||
    values.disposition !== untouched.disposition ||
    values.handoffChoice !== null ||
    values.coveringNote.trim() !== "" ||
    values.recipient.trim() !== "" ||
    values.handoffNote.trim() !== "";
  const closeDialog = (): void => {
    waitingRef.current = null;
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
    // An attempt in flight keeps the dialog open: closing it would hide the receipt that says what the
    // source answered, and an unanswered attempt is exactly the state this surface must not conceal.
    if (submitting) {
      return;
    }
    if (settlement?.initiativeClosed === true) {
      closeDialog();
      return;
    }
    if (hasEntries) {
      setDiscardArmed(true);
      return;
    }
    closeDialog();
  };
  const requestClose = (): void => {
    handleOpenChange(false);
  };
  const update = (next: Partial<CloseInitiativeFormValues>): void => {
    setValues((current) => ({ ...current, ...next }));
    setDiscardArmed(false);
    // A message describes the entries the last attempt submitted, so it stops being shown the moment
    // those entries change; the next submit states what the entries say then.
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
    // An `invalid` answer names the fields that failed, so returning to the entries states them there
    // instead of making the worker remember what the receipt said.
    if (settled !== null && settled.outcome === "invalid") {
      setErrors(fieldErrorsFromInvalid(settled));
    }
    setSettled(null);
    setPhase("details");
  };
  if (view === null) {
    return null;
  }
  const choiceAnnouncement = !ownsUnfinishedWork
    ? ""
    : values.handoffChoice === null
      ? ""
      : values.handoffChoice === "covering"
        ? `A field appeared: ${COVERING_NOTE_LABEL}.`
        : `Fields appeared: ${RECIPIENT_LABEL}, then ${HANDOFF_NOTE_LABEL}.`;
  const dispositionDescription =
    view.preservedDisposition === null
      ? CLOSURE_COPY.dispositionRequiredNote
      : `${CLOSURE_COPY.dispositionRequiredNote} The closure it recorded already states “${dispositionFallback(view.preservedDisposition)}”, and that value is kept here so it is never replaced silently.`;
  const dispositionRequired = !(ownsUnfinishedWork && values.handoffChoice === "eligible-handoff");
  const coveringNoteError = errors?.byField["handoff.reason"];
  const handoffNoteError = errors?.byField["handoff.note"];
  const recipientError = errors?.byField["handoff.toPrincipalId"];
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
              <h3 id={workHeadingId} className="text-base font-medium text-pretty break-words">
                {view.name}
              </h3>
              <Badge variant={view.state === "closed" ? "secondary" : "outline"}>{INITIATIVE_STATE_COPY[view.state].label}</Badge>
            </div>
            <p className="text-sm text-pretty text-muted-foreground">{INITIATIVE_STATE_COPY[view.state].description}</p>
            {view.preservedDisposition === null ? null : (
              <p className="text-sm text-pretty text-muted-foreground">
                {view.lifecycle === "reopened"
                  ? `This initiative was closed before and reopened, and the disposition recorded then is kept: “${dispositionFallback(view.preservedDisposition)}”.`
                  : `The closure recorded states “${dispositionFallback(view.preservedDisposition)}”.`}
              </p>
            )}
            <h4 className="text-sm font-medium">{INITIATIVE_COPY.nextWorkHeading}</h4>
            {view.ownedWork.length === 0 ? (
              <p className="text-sm text-pretty text-muted-foreground">{NO_OWNED_WORK_BODY}</p>
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
              <AlertTitle>{REFUSED_TITLE}</AlertTitle>
              <AlertDescription>{view.refusal}</AlertDescription>
            </Alert>
          )}
          {view.state === "open" ? null : (
            <Alert role={undefined}>
              <AlertTitle>{CLOSED_ALREADY_TITLE}</AlertTitle>
              <AlertDescription>{CLOSED_ALREADY_BODY}</AlertDescription>
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
              <FormField name="disposition" label={DISPOSITION_LABEL} description={dispositionDescription} error={errors?.byField.disposition} required={dispositionRequired}>
                {(field) =>
                  view.dispositions.length === 0 ? (
                    <Input
                      id={field.id}
                      name="disposition"
                      type="text"
                      autoComplete="off"
                      maxLength={DISPOSITION_MAX_LENGTH}
                      value={values.disposition}
                      aria-describedby={field.describedBy}
                      aria-invalid={field.invalid ? true : undefined}
                      aria-required={field.required ? true : undefined}
                      onChange={(event) => {
                        update({ disposition: event.currentTarget.value });
                      }}
                    />
                  ) : (
                    <NativeSelect
                      id={field.id}
                      name="disposition"
                      className="w-full"
                      value={values.disposition}
                      aria-describedby={field.describedBy}
                      aria-invalid={field.invalid ? true : undefined}
                      aria-required={field.required ? true : undefined}
                      onChange={(event) => {
                        update({ disposition: event.currentTarget.value });
                      }}
                    >
                      <NativeSelectOption value="">{DISPOSITION_PLACEHOLDER}</NativeSelectOption>
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
                        onValueChange={(next) => {
                          update({ handoffChoice: next === "eligible-handoff" ? "eligible-handoff" : next === "covering" ? "covering" : null });
                        }}
                      >
                        {HANDOFF_CHOICES.map((choice) => {
                          const optionId = `${choiceIdPrefix}-${choice}`;
                          const optionDescriptionId = `${optionId}-description`;
                          const label = choice === "covering" ? COVERING_LABEL : HANDOFF_LABEL;
                          const description = choice === "covering" ? COVERING_DESCRIPTION : HANDOFF_DESCRIPTION;
                          return (
                            <label key={choice} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                              <RadioGroupItem id={optionId} value={choice} aria-label={label} aria-describedby={optionDescriptionId} className="mt-0.5" />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="text-sm font-medium text-pretty">{label}</span>
                                <span id={optionDescriptionId} className="text-sm text-pretty text-muted-foreground">
                                  {description}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </RadioGroup>
                    )}
                  </FormFieldGroup>
                  {values.handoffChoice === "covering" ? (
                    <FormField name="handoff.reason" label={COVERING_NOTE_LABEL} description={COVERING_NOTE_DESCRIPTION} error={coveringNoteError} required>
                      {(field) => (
                        <Textarea
                          id={field.id}
                          value={values.coveringNote}
                          maxLength={NOTE_MAX_LENGTH}
                          aria-describedby={field.describedBy}
                          aria-invalid={field.invalid ? true : undefined}
                          aria-required={field.required ? true : undefined}
                          onChange={(event) => {
                            update({ coveringNote: event.currentTarget.value });
                          }}
                        />
                      )}
                    </FormField>
                  ) : null}
                  {values.handoffChoice === "eligible-handoff" ? (
                    <>
                      <FormField name="handoff.toPrincipalId" label={RECIPIENT_LABEL} description={RECIPIENT_DESCRIPTION} error={recipientError} required>
                        {(field) =>
                          view.recipients.length === 0 ? (
                            <Input
                              id={field.id}
                              type="text"
                              autoComplete="off"
                              value={values.recipient}
                              aria-describedby={field.describedBy}
                              aria-invalid={field.invalid ? true : undefined}
                              aria-required={field.required ? true : undefined}
                              onChange={(event) => {
                                update({ recipient: event.currentTarget.value });
                              }}
                            />
                          ) : (
                            <NativeSelect
                              id={field.id}
                              className="w-full"
                              value={values.recipient}
                              aria-describedby={field.describedBy}
                              aria-invalid={field.invalid ? true : undefined}
                              aria-required={field.required ? true : undefined}
                              onChange={(event) => {
                                update({ recipient: event.currentTarget.value });
                              }}
                            >
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
                      <FormField name="handoff.note" label={HANDOFF_NOTE_LABEL} description={HANDOFF_NOTE_DESCRIPTION} error={handoffNoteError} required>
                        {(field) => (
                          <Textarea
                            id={field.id}
                            value={values.handoffNote}
                            maxLength={NOTE_MAX_LENGTH}
                            aria-describedby={field.describedBy}
                            aria-invalid={field.invalid ? true : undefined}
                            aria-required={field.required ? true : undefined}
                            onChange={(event) => {
                              update({ handoffNote: event.currentTarget.value });
                            }}
                          />
                        )}
                      </FormField>
                    </>
                  ) : null}
                </>
              ) : (
                <Alert role={undefined}>
                  <AlertTitle>{NO_OWNED_WORK_TITLE}</AlertTitle>
                  <AlertDescription>{NO_OWNED_WORK_BODY}</AlertDescription>
                </Alert>
              )}
              {/* The conditional fields appear without taking focus, so their arrival is announced here. */}
              <output className="sr-only">{choiceAnnouncement}</output>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={submitting} onClick={requestClose}>
                  {CANCEL_LABEL}
                </Button>
                <Button type="submit" disabled={view.refusal !== null}>
                  {REVIEW_LABEL}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex min-w-0 flex-col gap-4">
              <ActionReview<CloseInitiativePayload>
                title={`${CLOSE_HEADING}: ${view.name}`}
                description={
                  <dl className="flex min-w-0 flex-col gap-2 text-sm">
                    <Fact term={INITIATIVE_LABEL}>
                      <span className="text-pretty break-words">{view.name}</span> <bdi className="mono-identifier break-all">{initiativeId}</bdi>
                    </Fact>
                    <Fact term={DISPOSITION_LABEL}>
                      {values.disposition.trim() === "" ? (
                        <span className="text-muted-foreground">{`${REQUESTED_TERMS_COPY.notStated}: the closure records the handoff of the unfinished work instead.`}</span>
                      ) : (
                        <bdi>{dispositionFallback(values.disposition)}</bdi>
                      )}
                    </Fact>
                    <Fact term={COVERING_LEGEND}>
                      {view.ownedWork.length === 0 ? (
                        <span className="text-muted-foreground">{NO_OWNED_WORK_REASON}</span>
                      ) : (
                        <span>
                          {values.handoffChoice === "covering"
                            ? `The disposition covers this work. Note recorded: “${values.coveringNote.trim()}”`
                            : `Handed to ${values.recipient.trim()}. Note recorded: “${values.handoffNote.trim()}”`}
                        </span>
                      )}
                    </Fact>
                    {view.ownedWork.length === 0 ? null : <Fact term={INITIATIVE_COPY.nextWorkHeading}>Every item of work listed above stays outstanding when this closure is recorded.</Fact>}
                  </dl>
                }
                consequence={
                  <ul className="flex min-w-0 flex-col gap-1.5 text-sm text-pretty">
                    {CLOSING_STATEMENTS.map((statement) => (
                      <li key={statement}>{statement}</li>
                    ))}
                  </ul>
                }
                confirmLabel={CLOSE_CONFIRM_LABEL}
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
              {settlement === null ? null : (
                <p data-slot="close-settlement" data-outcome={settled?.outcome} className="text-sm text-pretty text-muted-foreground">
                  {settlement.note}
                </p>
              )}
            </div>
          )}
          {discardArmed ? (
            <Alert variant="destructive">
              <AlertTitle>{DISCARD_TITLE}</AlertTitle>
              <AlertDescription>
                <p>{DISCARD_BODY}</p>
                <span className="mt-3 flex flex-wrap gap-2">
                  <Button ref={keepEditingRef} type="button" variant="outline" size="sm" onClick={() => setDiscardArmed(false)}>
                    {KEEP_EDITING_LABEL}
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={closeDialog}>
                    {DISCARD_LABEL}
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        {phase === "review" && settlement !== null ? (
          <DialogFooter>
            {settlement.offersRevision ? (
              <Button type="button" variant="outline" onClick={revise}>
                {REVISE_LABEL}
              </Button>
            ) : null}
            {settlement.offersDone ? (
              <Button type="button" onClick={requestClose}>
                {DONE_LABEL}
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
