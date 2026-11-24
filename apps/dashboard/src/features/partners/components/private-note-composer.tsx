"use client";
import { LockKeyholeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactElement } from "react";
import { outcomeNotice, useAttemptedMutation, type OutcomeNoticeCopy } from "@/components/attempt";
import { useUnsavedWork } from "@/components/context-switch-guard";
import { FormField } from "@/components/form-field";
import OperationResult, { focusAnnouncedRegion } from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { AUDIENCE_LABEL_COPY, PRIVATE_RECORD_COPY } from "../copy/privacy";
import { FORM_OUTCOME_COPY } from "../copy/states";
import { useSavePrivateNote } from "../hooks/use-partner-mutations";
import { PRIVATE_NOTE_AUDIENCE, type SavePrivateNotePayload } from "../schemas/private-note";
const FIELD_LABEL = "Your note";
/** The levels this composer can land at: a subsection under a record's own section title, or a group title inside the panel's and the sheet's section scale. */ const NOTE_HEADING_TAG = { 3: "h3", 4: "h4" } as const;
const NOTE_HEADING_SCALE = { 3: "type-subsection-title", 4: "type-group-title" } as const;
const NOTE_HEADING_LEVEL = 3;
const AUDIENCE_WORD = AUDIENCE_LABEL_COPY.private.label;
const RETRY_LABEL = FORM_OUTCOME_COPY.unavailable.actionLabel ?? "Try again";
const CHECK_LABEL = FORM_OUTCOME_COPY.unknown.actionLabel ?? "Check the result";
const UNSAVED_WORK_DESCRIPTION = "This private note has been written on this screen and not saved yet.";
const SAVE_BLOCKED_PENDING = "The note was not saved and the context was not switched, so nothing you typed has been discarded: a save of this note is already in flight, so nothing was sent again.";
const SAVE_NOT_SETTLED = "The note was not saved and the context was not switched, so nothing you typed has been discarded: ";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { body: FIELD_LABEL };
const NOTICE_COPY: OutcomeNoticeCopy = {
  denied: { title: "A private note cannot be saved here", description: "A note is written inside the ministry that admits this record, and the context in view does not admit it. Nothing you typed was sent, and it stays in the box above this notice." },
  unavailable: { title: FORM_OUTCOME_COPY.unavailable.title, description: FORM_OUTCOME_COPY.unavailable.body },
  unknown: { title: FORM_OUTCOME_COPY.unknown.title, description: FORM_OUTCOME_COPY.unknown.body },
  retryLabel: RETRY_LABEL,
  checkResultLabel: CHECK_LABEL,
};
const characterLine = (count: number): string => `${count === 1 ? "1 character" : `${String(count)} characters`}. Your note is filed at the instant the service records when it accepts it, so this line states no date or time of its own.`;
const describedByField = (field: string | undefined, context: string): string => (field === undefined || field.trim() === "" ? context : `${field} ${context}`);
function OutcomeReceipt({ outcome, onReplay, onReapply }: { readonly outcome: MutationOutcome; readonly onReplay: () => void; readonly onReapply: () => void }): ReactElement {
  const notice = outcomeNotice(outcome, NOTICE_COPY, { onRetrySameWork: onReplay, onCheckResult: onReplay, headingLevel: 4 });
  if (notice !== null) return <StateNotice {...notice} />;
  return <OperationResult outcome={outcome} heading={outcome.outcome === "conflict" ? FORM_OUTCOME_COPY.conflict.title : undefined} headingLevel={4} fieldLabels={outcome.outcome === "invalid" ? FIELD_LABELS : undefined} onReapply={outcome.outcome === "conflict" ? onReapply : undefined} />;
}
export type PrivateNoteComposerProps = { readonly scope: Scope; readonly partnerId: string; readonly expectedRevision: string; readonly onSettled?: (outcome: MutationOutcome) => void; readonly headingLevel?: 3 | 4; readonly className?: string };
/** Writes one private note about one record, states its audience in words, and reports what the save answered. The heading takes the level of the presentation it lands in, so the composer reads as part of the private section on the record's route and of the panel's own section scale beside the list. */
export default function PrivateNoteComposer({ scope, partnerId, expectedRevision, onSettled, headingLevel = NOTE_HEADING_LEVEL, className }: PrivateNoteComposerProps): ReactElement {
  const save = useSavePrivateNote(partnerId);
  const router = useRouter();
  const [body, setBody] = useState("");
  const [adoptedRevision, setAdoptedRevision] = useState<{ readonly from: string; readonly revision: string } | null>(null);
  const headingId = useId();
  const Heading = NOTE_HEADING_TAG[headingLevel];
  const contextId = useId();
  const receiptRef = useRef<HTMLDivElement | null>(null);
  const submittingRef = useRef(false);
  // A save that stands has the record read back, and that read is a transition: the receipt is focused again once it has landed rather than only at the moment the answer arrived.
  const [refreshing, startRefresh] = useTransition();
  const revision = adoptedRevision !== null && adoptedRevision.from === expectedRevision ? adoptedRevision.revision : expectedRevision;
  const enteredPayload = (): SavePrivateNotePayload => ({ partnerId, body, audience: PRIVATE_NOTE_AUDIENCE });
  // A settled save is reported once, and the box follows what the outcome means: a save that stands clears it and reads the record back from the source, a conflict keeps it as typed and moves the revision on, and every other arm leaves both alone.
  const settle = (result: MutationOutcome): void => {
    if (result.outcome === "conflict") setAdoptedRevision({ from: expectedRevision, revision: result.currentRevision });
    if (result.outcome === "accepted" || result.outcome === "alreadyAccepted" || result.outcome === "unchanged") {
      setBody("");
      startRefresh(() => router.refresh());
    }
    try {
      onSettled?.(result);
    } catch {}
  };
  const note = useAttemptedMutation<SavePrivateNotePayload>((input) => save.submit(input), settle);
  const busy = note.pending;
  const outcome = note.outcome;
  const bodyErrors = note.fieldErrors?.byField.body;
  // The save control keeps its focus while the save is in flight, so the save is fenced here rather than by disabling the control: a second activation returns early and the attempt already running stays the only one.
  const send = (target: string): void => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    void note
      .submit({ scope, expectedRevision: target, payload: enteredPayload() })
      .catch(() => undefined)
      .finally(() => {
        submittingRef.current = false;
      });
  };
  // The answer a save is given is stated in its receipt's own announced region, so focus lands on that statement instead of back at the top of the document; a save that stands re-reads the record, so the focus is set again once that re-read has landed.
  useEffect(() => {
    if (outcome === null || outcome.outcome === "invalid") return;
    focusAnnouncedRegion(receiptRef.current);
  }, [outcome, refreshing]);
  const saveNote = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    send(revision);
  };
  const replayAttempt = (): void => {
    void note.retry().catch(() => undefined);
  };
  const reapply = (): void => {
    if (outcome !== null && outcome.outcome === "conflict") send(outcome.currentRevision);
  };
  // The guard saves through this composer's own submit rather than a second save path, and every outcome that did not settle is stated as a refusal so the switch stops before any request is sent and the typed note stays in the box.
  const saveForGuard = async (): Promise<void> => {
    if (submittingRef.current) throw new Error(SAVE_BLOCKED_PENDING);
    submittingRef.current = true;
    try {
      switch ((await note.submit({ scope, expectedRevision: revision, payload: enteredPayload() })).outcome) {
        case "accepted":
        case "alreadyAccepted":
        case "unchanged":
          return;
        case "conflict":
          throw new Error(`${SAVE_NOT_SETTLED}the record changed after this page was read, so the receipt states the conflict beside your note.`);
        case "denied":
          throw new Error(`${SAVE_NOT_SETTLED}this session is not permitted to save a note on this record.`);
        case "invalid":
          throw new Error(`${SAVE_NOT_SETTLED}the note was refused, and the box states what it needs.`);
        case "unavailable":
          throw new Error(`${SAVE_NOT_SETTLED}the source behind the note could not be reached, and the same retry is offered.`);
        case "unknown":
          throw new Error(`${SAVE_NOT_SETTLED}whether the note was saved is not known, and the same check answers it.`);
      }
    } finally {
      submittingRef.current = false;
    }
  };
  // Discarding returns the composer to its blank starting state, so no receipt describes a note the box no longer holds.
  const discardForGuard = (): void => {
    setBody("");
    note.reset();
  };
  useUnsavedWork(body.length === 0 ? null : { description: UNSAVED_WORK_DESCRIPTION, save: saveForGuard, discard: discardForGuard });
  return (
    <section data-slot="private-note-composer" aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <Heading {...{ id: headingId, className: cn(NOTE_HEADING_SCALE[headingLevel], "text-pretty") }}>Write a private note</Heading>
      <Alert data-slot="private-note-audience">
        <LockKeyholeIcon aria-hidden="true" />
        <AlertTitle className="flex flex-wrap items-center gap-2">
          {PRIVATE_RECORD_COPY.noteIsPrivate.title}
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{AUDIENCE_WORD}</span>
        </AlertTitle>
        <AlertDescription>
          <p>{PRIVATE_RECORD_COPY.noteIsPrivate.body}</p>
          <p>{AUDIENCE_LABEL_COPY.private.description}</p>
          <p>{PRIVATE_RECORD_COPY.remainsPrivate.body}</p>
        </AlertDescription>
      </Alert>
      <form className="flex min-w-0 flex-col gap-3" onSubmit={saveNote}>
        <FormField label={FIELD_LABEL} name="body" description="Plain text, in your own words: what you observed, decided or want to remember about this contact." error={bodyErrors} required>
          {(field) => (
            <Textarea
              id={field.id}
              name="body"
              dir="auto"
              rows={5}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              readOnly={busy}
              aria-busy={busy || undefined}
              aria-invalid={field.invalid || undefined}
              aria-required={field.required || undefined}
              aria-describedby={describedByField(field.describedBy, contextId)}
              className="min-h-28"
            />
          )}
        </FormField>
        <p {...{ id: contextId, className: "type-supporting text-pretty" as const }}>{characterLine(Array.from(body).length)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button {...{ type: "submit" as const, "aria-busy": busy || undefined }}>{busy ? "Saving the note" : "Save the note"}</Button>
        </div>
      </form>
      {outcome === null ? null : (
        <div ref={receiptRef} tabIndex={-1} className="flex min-w-0 flex-col gap-3">
          <OutcomeReceipt outcome={outcome} onReplay={replayAttempt} onReapply={reapply} />
        </div>
      )}
    </section>
  );
}
