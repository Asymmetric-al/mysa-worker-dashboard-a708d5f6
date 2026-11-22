"use client";
/** The one composer for a worker-private note on a partner record: its audience stated in words, one multi-line control, and the durable receipt of what the save answered. */
import { LockKeyholeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { fieldErrorsFromInvalid, FormField } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { AUDIENCE_LABEL_COPY, PRIVATE_RECORD_COPY } from "../copy/privacy";
import { FORM_OUTCOME_COPY } from "../copy/states";
import { useSavePrivateNote } from "../hooks/use-partner-mutations";
import { PRIVATE_NOTE_AUDIENCE, type SavePrivateNotePayload } from "../schemas/private-note";

const HEADING = "Write a private note";

const FIELD_LABEL = "Your note";

const FIELD_HINT = "Plain text, in your own words: what you observed, decided or want to remember about this contact.";

const SAVE_LABEL = "Save the note";

const SAVING_LABEL = "Saving the note";

/** The audience word the note is written under, taken from the family's own audience vocabulary rather than typed here. */
const AUDIENCE_WORD = AUDIENCE_LABEL_COPY.private.label;

const RETRY_LABEL = FORM_OUTCOME_COPY.unavailable.actionLabel ?? "Try again";

const CHECK_LABEL = FORM_OUTCOME_COPY.unknown.actionLabel ?? "Check the result";

const DENIED_TITLE = "A private note cannot be saved here";

const DENIED_BODY = "A note is written inside the ministry that admits this record, and the context in view does not admit it. Nothing you typed was sent, and it stays in the box above this notice.";

/** The field paths a refusal names, spelled the way the control beside them is labelled. */
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { body: FIELD_LABEL };

/** One attempt at the save: the revision it presents and the change it asks for, kept whole so a lost acknowledgement can be re-checked as the same attempt. */
interface NoteAttempt {
  readonly expectedRevision: string;
  readonly payload: SavePrivateNotePayload;
}

/** The entry and time context stated beside the control: how much text is entered, and where the filing time comes from. */
function characterLine(count: number): string {
  const units = count === 1 ? "1 character" : `${String(count)} characters`;
  return `${units}. Your note is filed at the instant the service records when it accepts it, so this line states no date or time of its own.`;
}

/** The descriptions a control is described by, joined so the field hint, its error and the context line are all announced. */
function describedByField(field: string | undefined, context: string): string {
  return field === undefined || field.trim() === "" ? context : `${field} ${context}`;
}

interface OutcomeReceiptProps {
  readonly outcome: MutationOutcome;
  /** Re-issues the identical attempt, so an uncertain or undelivered save is settled under its own identity rather than repeated under a new one. */
  readonly onReplay: () => void;
  /** Applies the text on screen against the revision the record now holds, after a conflict was read. */
  readonly onReapply: () => void;
}

/** The one receipt for a save: the application's one operation result for the outcomes that produced or preserved an effect, and its one state notice for the three that did not. */
function OutcomeReceipt({ outcome, onReplay, onReapply }: OutcomeReceiptProps): ReactElement {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
    case "unchanged":
      return <OperationResult outcome={outcome} headingLevel={4} />;
    case "conflict":
      return <OperationResult outcome={outcome} heading={FORM_OUTCOME_COPY.conflict.title} headingLevel={4} onReapply={onReapply} />;
    case "invalid":
      return <OperationResult outcome={outcome} headingLevel={4} fieldLabels={FIELD_LABELS} />;
    case "denied":
      return <StateNotice kind="denied" headingLevel={4} title={DENIED_TITLE} description={DENIED_BODY} reasonCode={outcome.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={4} title={FORM_OUTCOME_COPY.unavailable.title} description={FORM_OUTCOME_COPY.unavailable.body} source={outcome.source} action={{ label: RETRY_LABEL, onClick: onReplay }} />;
    case "unknown":
      return <StateNotice kind="unknown" headingLevel={4} title={FORM_OUTCOME_COPY.unknown.title} description={FORM_OUTCOME_COPY.unknown.body} operationId={outcome.operationId} action={{ label: CHECK_LABEL, onClick: onReplay }} />;
    default:
      // Exhaustive by construction: the eight outcomes above are the closed set, so a ninth fails to
      // compile at this call rather than reaching a surface with no receipt to show.
      return assertNever(outcome, "Unhandled private-note save outcome");
  }
}

/** Props of {@link PrivateNoteComposer}. */
export interface PrivateNoteComposerProps {
  /** The authority the save is made in, so the service checks the caller is admitted to it rather than inferring it from the record. */
  readonly scope: Scope;
  /** The opaque reference of the record the note is about — an identifier, never a name, an address or an email match. */
  readonly partnerId: string;
  /** The revision the caller read. Every save presents it, so a change made elsewhere is a conflict rather than an overwrite. */
  readonly expectedRevision: string;
  /** Called with the single outcome each attempt answered, so the caller can re-read the record it already owns. */
  readonly onSettled?: (outcome: MutationOutcome) => void;
  readonly className?: string;
}

/** Writes one private note about one record, states its audience in words, and reports what the save answered. */
export default function PrivateNoteComposer({ scope, partnerId, expectedRevision, onSettled, className }: PrivateNoteComposerProps): ReactElement {
  const save = useSavePrivateNote(partnerId);
  const router = useRouter();
  const [body, setBody] = useState("");
  const [adoptedRevision, setAdoptedRevision] = useState<{ readonly from: string; readonly revision: string } | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const busyRef = useRef(false);
  const lastAttempt = useRef<NoteAttempt | null>(null);
  const headingId = useId();
  const contextId = useId();
  // A save presents the revision its caller read, except after a conflict, where the receipt states the
  // revision the record now holds and presenting that one is what makes re-applying deliberate. The
  // adopted value is used only while the caller still hands over the revision it read, so a caller that
  // re-reads the record supplies a fresh one instead of being masked by a value this component remembers.
  const revision = adoptedRevision !== null && adoptedRevision.from === expectedRevision ? adoptedRevision.revision : expectedRevision;
  const busy = inFlight || save.isPending;
  const outcome = save.outcome;
  const fieldErrors = outcome !== null && outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null;
  const bodyErrors = fieldErrors === null ? undefined : fieldErrors.byField.body;

  const enteredPayload = (): SavePrivateNotePayload => ({ partnerId, body, audience: PRIVATE_NOTE_AUDIENCE });

  const settle = (result: MutationOutcome): void => {
    switch (result.outcome) {
      case "accepted":
      case "alreadyAccepted":
      case "unchanged":
        // A note is appended rather than rewriting the record, so the note's own revision is not the
        // token the next attempt presents: the caller's revision stands, and the receipt names both.
        // The entry is finished, so the box is cleared for the next note; the receipt stays on the page as
        // the record of what the save answered.
        setBody("");
        // A resolved save changed what this record's own read states, so the page re-reads it rather than
        // this composer placing the note in a list it does not own: the note appears beside the box
        // because the service says it is there.
        router.refresh();
        break;
      case "conflict":
        // Nothing was written, and the receipt states the revision the record holds now, so the text on
        // screen can be applied against it deliberately.
        setAdoptedRevision({ from: expectedRevision, revision: result.currentRevision });
        break;
      case "denied":
      case "invalid":
      case "unavailable":
      case "unknown":
        // The text stays exactly as it was entered, and the next attempt presents the revision this
        // composer was given: none of these outcomes wrote anything.
        break;
      default:
        assertNever(result, "Unhandled private-note save outcome");
    }
    try {
      onSettled?.(result);
    } catch {
      // A caller's own reaction is not this composer's answer, so a fault in it cannot remove the receipt.
    }
  };

  const attempt = (input: NoteAttempt): void => {
    if (busyRef.current) {
      // One attempt at a time: a second press while a save is in flight asks for the same change, and the
      // hook answers it with the attempt already running rather than with a second effect.
      return;
    }
    busyRef.current = true;
    setInFlight(true);
    lastAttempt.current = input;
    void save
      .submit({ scope, expectedRevision: input.expectedRevision, payload: input.payload })
      // The hook answers every attempt with one of the eight outcomes and never rejects; the rejection arm
      // exists so that a defect in that contract cannot leave the save fenced forever.
      .then(settle, () => undefined)
      .finally(() => {
        busyRef.current = false;
        setInFlight(false);
      });
  };

  const saveNote = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    attempt({ expectedRevision: revision, payload: enteredPayload() });
  };

  const replayAttempt = (): void => {
    const stored = lastAttempt.current;
    if (stored === null) {
      return;
    }
    attempt(stored);
  };

  const reapply = (): void => {
    if (outcome === null || outcome.outcome !== "conflict") {
      return;
    }
    attempt({ expectedRevision: outcome.currentRevision, payload: enteredPayload() });
  };

  return (
    <section data-slot="private-note-composer" aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <h3 id={headingId} className="text-base font-medium text-pretty">
        {HEADING}
      </h3>
      {/* The audience is stated here, in words and always visible: it is never a tooltip, a placeholder or a
       * control the writer could change, and the schema refuses any audience other than the private one
       * before a request leaves this page. */}
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
        <FormField label={FIELD_LABEL} name="body" description={FIELD_HINT} error={bodyErrors} required>
          {(field) => (
            <Textarea
              id={field.id}
              name="body"
              // The entered text decides the writing direction it is read in, so a right-to-left note is
              // authored without changing the language of the interface around it.
              dir="auto"
              rows={5}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              // The control is held still while the attempt is in flight rather than disabled, so the caret
              // and the focus position survive the save.
              readOnly={busy}
              aria-busy={busy || undefined}
              aria-invalid={field.invalid || undefined}
              aria-required={field.required || undefined}
              aria-describedby={describedByField(field.describedBy, contextId)}
              className="min-h-28"
            />
          )}
        </FormField>
        <p id={contextId} className="text-sm text-pretty text-muted-foreground">
          {characterLine(Array.from(body).length)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? SAVING_LABEL : SAVE_LABEL}
          </Button>
        </div>
      </form>
      {outcome === null ? null : <OutcomeReceipt outcome={outcome} onReplay={replayAttempt} onReapply={reapply} />}
    </section>
  );
}
