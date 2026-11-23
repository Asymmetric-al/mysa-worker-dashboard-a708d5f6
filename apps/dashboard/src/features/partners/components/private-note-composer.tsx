"use client";
import { LockKeyholeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactElement } from "react";
import { outcomeNotice, useAttemptedMutation, type OutcomeNoticeCopy } from "@/components/attempt";
import { FormField } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
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
const AUDIENCE_WORD = AUDIENCE_LABEL_COPY.private.label;
const RETRY_LABEL = FORM_OUTCOME_COPY.unavailable.actionLabel ?? "Try again";
const CHECK_LABEL = FORM_OUTCOME_COPY.unknown.actionLabel ?? "Check the result";
const DENIED_BODY = "A note is written inside the ministry that admits this record, and the context in view does not admit it. Nothing you typed was sent, and it stays in the box above this notice.";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { body: FIELD_LABEL };
const NOTICE_COPY: OutcomeNoticeCopy = {
  denied: { title: "A private note cannot be saved here", description: DENIED_BODY },
  unavailable: { title: FORM_OUTCOME_COPY.unavailable.title, description: FORM_OUTCOME_COPY.unavailable.body },
  unknown: { title: FORM_OUTCOME_COPY.unknown.title, description: FORM_OUTCOME_COPY.unknown.body },
  retryLabel: RETRY_LABEL,
  checkResultLabel: CHECK_LABEL,
};
const characterLine = (count: number): string => `${count === 1 ? "1 character" : `${String(count)} characters`}. Your note is filed at the instant the service records when it accepts it, so this line states no date or time of its own.`;
const describedByField = (field: string | undefined, context: string): string => (field === undefined || field.trim() === "" ? context : `${field} ${context}`);
/** The receipt a save answers with: the three recoverable arms through the shared notice, and every other arm through the one result renderer. */
function OutcomeReceipt({ outcome, onReplay, onReapply }: { readonly outcome: MutationOutcome; readonly onReplay: () => void; readonly onReapply: () => void }): ReactElement {
  const notice = outcomeNotice(outcome, NOTICE_COPY, { onRetrySameWork: onReplay, onCheckResult: onReplay, headingLevel: 4 });
  if (notice !== null) return <StateNotice {...notice} />;
  return <OperationResult outcome={outcome} heading={outcome.outcome === "conflict" ? FORM_OUTCOME_COPY.conflict.title : undefined} headingLevel={4} fieldLabels={outcome.outcome === "invalid" ? FIELD_LABELS : undefined} onReapply={outcome.outcome === "conflict" ? onReapply : undefined} />;
}
export type PrivateNoteComposerProps = { readonly scope: Scope; readonly partnerId: string; readonly expectedRevision: string; readonly onSettled?: (outcome: MutationOutcome) => void; readonly className?: string };
/** Writes one private note about one record, states its audience in words, and reports what the save answered. */
export default function PrivateNoteComposer({ scope, partnerId, expectedRevision, onSettled, className }: PrivateNoteComposerProps): ReactElement {
  const save = useSavePrivateNote(partnerId);
  const router = useRouter();
  const [body, setBody] = useState("");
  const [adoptedRevision, setAdoptedRevision] = useState<{ readonly from: string; readonly revision: string } | null>(null);
  const headingId = useId();
  const contextId = useId();
  const revision = adoptedRevision !== null && adoptedRevision.from === expectedRevision ? adoptedRevision.revision : expectedRevision;
  const enteredPayload = (): SavePrivateNotePayload => ({ partnerId, body, audience: PRIVATE_NOTE_AUDIENCE });
  // A settled save is reported once, and the box follows what the outcome means: a save that stands clears it and reads the record back from the source, a conflict keeps it as typed and moves the revision on, and every other arm leaves both alone.
  const settle = (result: MutationOutcome): void => {
    if (result.outcome === "conflict") setAdoptedRevision({ from: expectedRevision, revision: result.currentRevision });
    if (result.outcome === "accepted" || result.outcome === "alreadyAccepted" || result.outcome === "unchanged") {
      setBody("");
      router.refresh();
    }
    try {
      onSettled?.(result);
    } catch {}
  };
  const note = useAttemptedMutation<SavePrivateNotePayload>((input) => save.submit(input), settle);
  const busy = note.pending;
  const outcome = note.outcome;
  const bodyErrors = note.fieldErrors?.byField.body;
  const send = (target: string): void => {
    void note.submit({ scope, expectedRevision: target, payload: enteredPayload() }).catch(() => undefined);
  };
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
  return (
    <section data-slot="private-note-composer" aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <h3 id={headingId} className="type-subsection-title text-pretty">
        Write a private note
      </h3>
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
        <p id={contextId} className="type-supporting text-pretty">
          {characterLine(Array.from(body).length)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving the note" : "Save the note"}
          </Button>
        </div>
      </form>
      {outcome === null ? null : <OutcomeReceipt outcome={outcome} onReplay={replayAttempt} onReapply={reapply} />}
    </section>
  );
}
