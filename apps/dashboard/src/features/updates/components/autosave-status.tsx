"use client";
/**
 * The autosave status line of the one Update editor: which state the save is in, what the service last said, and the
 * only recoveries that never repeat an effect on their own.
 *
 * **What it renders.** One closed state from `useDraftRecovery` — `idle`, `unsaved`, `saving`, `saved`,
 * `failed-local-kept`, `conflict` or `unknown` — as a durable, in-context statement. It is not a transient
 * notification and not a dismissal-only message: the statement stands for as long as it is true, so a worker who looks
 * away and comes back still sees what happened. Each state states its own word, so colour is never the only signal, and
 * the word is announced politely rather than assertively, because an autosave interrupts nobody.
 *
 * **What it never computes.** No revision, no instant, no count and no percentage. Every value shown here is one the
 * hook or the service stated, rendered exactly as supplied, which is why the instant beside an acknowledged revision
 * arrives as a prop: the hook's contract carries no clock, and deriving one here would be a second, silently drifting
 * answer to the same question. Nothing on this line is a relative time.
 *
 * **What it never does on its own.** No send, no resend, no automatic retry, no silent discard of anything. A definite
 * answer — a refusal, an outage, a denial, a stale revision — offers only *Retry the same work*, which resubmits the
 * kept text through the same reviewed attempt; an uncertain one additionally offers *Check the result*, which reads the
 * same attempt again instead of starting a second one. "Send again" does not exist here: a lost acknowledgement is not
 * a failure, and repeating it under a fresh identity is the duplicate the operation ledger exists to prevent.
 *
 * **The copy this browser keeps.** Text the service has not acknowledged is mirrored by the hook into one slot of this
 * tab's storage, so a reload can offer it back. This line says plainly when such a copy exists, that it is not record
 * state, and that removing it touches nothing else — and removing it is offered only as a separately labelled
 * destructive action behind a confirmation.
 */
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { DRAFT_VS_RELEASED } from "../copy/updates-copy";
import type { AutosaveState, DraftRecovery, Revision } from "../hooks/use-draft-recovery";

// ---------------------------------------------------------------------------------------------
// The vocabulary of this line
//
// The status words below belong to the autosave lifecycle alone. The lifecycle vocabulary (draft,
// candidate, released, withdrawn) belongs to the edition indicator, and the send, membership, reach
// and value-state words belong to the shared status badge; a state that looked like one of those
// here would let a saved draft be read as something published.
// ---------------------------------------------------------------------------------------------

/** The two actions a definite or an uncertain answer may offer. Both work under the attempt's own identity, so neither can repeat an effect. */
const RETRY_LABEL = "Retry the same work";

const CHECK_RESULT_LABEL = "Check the result";

/** What a status may offer. A state with neither a definite nor an uncertain answer offers nothing, so nothing here can be pressed by mistake. */
type RecoveryOffer = { readonly retrySameWork: boolean; readonly checkResult: boolean };

const NO_OFFER: RecoveryOffer = { retrySameWork: false, checkResult: false };

const RETRY_ONLY: RecoveryOffer = { retrySameWork: true, checkResult: false };

/** Offered for `unknown` alone: checking a definite answer would assert an uncertainty that does not exist. */
const RETRY_OR_CHECK: RecoveryOffer = { retrySameWork: true, checkResult: true };

/** Every durable sentence this line states, written once so the same promise is never worded two ways. */
const UNSAVED_DETAIL = "The editor sends a change after a short pause, and until an answer comes back the service still holds the earlier draft: nothing typed here has reached the record yet.";

const SAVING_DETAIL = "No second attempt starts while one is in flight, so one pause cannot produce two saves. Whether the text was stored is stated only once the service answers.";

const SAVED_DETAIL = "An acknowledgement records this text against that revision and states nothing more: it is not a review, not a release and not a notice.";

const IDLE_DETAIL = "The saved draft still holds what the service last recorded. A change becomes an unsaved change as soon as the editor reports it.";

const KEPT_WITH_COPY = "That copy lives in this tab's own storage and nowhere else: nobody else sees it, it is not the saved draft, and it ends with the tab.";

const KEPT_WITHOUT_COPY = "The editor holds the text on screen, and this browser keeps no separate copy of it: leaving the page would lose it.";

/** Said only when a stored copy exists that this editor is not showing — the recovery a reload offers back. */
const LOCAL_ONLY = "This browser also keeps text from an earlier attempt that this editor is not showing. That copy exists only in this browser: the service has never acknowledged it, nobody else can see it, and it is not part of the draft record.";

const NOT_ACKNOWLEDGED = "The service did not acknowledge this text, so nothing was saved.";

// ---------------------------------------------------------------------------------------------
// Wording that reads a value the service supplied
// ---------------------------------------------------------------------------------------------

/** How one status reads: its word, how that word is drawn, the one sentence the live region announces, the durable sentences under it, and what recovery it offers. */
interface AutosaveWording {
  readonly word: string;
  readonly badge: NonNullable<ComponentProps<typeof Badge>["variant"]>;
  readonly statement: ReactNode;
  readonly details: readonly ReactNode[];
  readonly offers: RecoveryOffer;
}

/** The acknowledgement sentence: the revision the service recorded, and the instant it stated for it when the caller supplied one. Both are shown as given; neither is derived, formatted or rounded here. */
function savedStatement(revision: Revision | null, asOf: string | null): ReactNode {
  const statedRevision = revision?.trim() ?? "";
  const statedAsOf = asOf?.trim() ?? "";
  if (statedRevision === "") {
    // The contract always names the revision an acknowledgement confirmed, so this states only what it can rather than
    // inventing one. It never falls back to "saved" alone: the revision is why the line is trustworthy.
    return "Saved — the service acknowledged this text and stated no revision for it.";
  }
  if (statedAsOf === "") {
    return (
      <>
        Saved — acknowledged revision <bdi className="mono-identifier">{statedRevision}</bdi>.
      </>
    );
  }
  return (
    <>
      Saved — acknowledged revision <bdi className="mono-identifier">{statedRevision}</bdi> at <bdi className="mono-identifier">{statedAsOf}</bdi>.
    </>
  );
}

/** Why the text was not saved, in the terms the answer itself used. `invalid` names no field here: the editor's own field errors list them, and repeating them would be a second rendering of one refusal. */
function refusalDetail(outcome: MutationOutcome | null): ReactNode {
  if (outcome === null) {
    return NOT_ACKNOWLEDGED;
  }
  switch (outcome.outcome) {
    case "invalid":
      return "The service refused at least one field, so nothing was saved. The editor lists the fields it refused; this line does not repeat them.";
    case "unavailable":
      return (
        <>
          The source that holds this draft could not be read, so nothing was saved. It named itself <bdi className="mono-identifier">{outcome.source.system}</bdi> with reference <bdi className="mono-identifier">{outcome.source.reference}</bdi>.
        </>
      );
    case "denied":
      return (
        <>
          This session may not save this draft, so nothing was saved. The reason the service gave is <bdi className="mono-identifier">{outcome.reasonCode}</bdi>.
        </>
      );
    default:
      return NOT_ACKNOWLEDGED;
  }
}

/** Which revision the conflict is against: the one the service reported, the one this editor had acknowledged, or neither. */
function conflictDetail(outcome: MutationOutcome | null, acknowledgedRevision: Revision | null): ReactNode {
  const current = outcome !== null && outcome.outcome === "conflict" ? outcome.currentRevision.trim() : "";
  const acknowledged = acknowledgedRevision?.trim() ?? "";
  if (current === "") {
    return "This editor's revision is no longer the one the service holds, so nothing was saved.";
  }
  if (acknowledged === "") {
    return (
      <>
        The service reports that this draft now stands at revision <bdi className="mono-identifier">{current}</bdi>, which is not the revision this editor was working from.
      </>
    );
  }
  return (
    <>
      The service reports that this draft now stands at revision <bdi className="mono-identifier">{current}</bdi>, while this editor last had revision <bdi className="mono-identifier">{acknowledged}</bdi> acknowledged.
    </>
  );
}

const CONFLICT_RETRY = "Retrying the same work resends your text against the revision the service reported, so your text becomes the saved draft if the service accepts it and what the record holds now is replaced.";

/** What an uncertain answer leaves open, what each recovery does, and what this browser still holds. */
function unknownDetails(outcome: MutationOutcome | null, keepsText: boolean): readonly ReactNode[] {
  const details: ReactNode[] = [];
  const operationId = outcome !== null && outcome.outcome === "unknown" ? outcome.operationId.trim() : "";
  if (operationId !== "") {
    details.push(
      <>
        Operation <bdi className="mono-identifier">{operationId}</bdi>.
      </>,
    );
  }
  details.push("Nothing is resent on its own. Checking the result reads that same attempt again and reveals what the service recorded; retrying the same work resubmits this text under the attempt's own identity, so a save that did apply returns its original result instead of saving twice.");
  details.push(keepsText ? KEPT_WITH_COPY : KEPT_WITHOUT_COPY);
  return details;
}

/** What this status is asked to describe. */
type WordingInput = {
  readonly state: AutosaveState;
  readonly outcome: MutationOutcome | null;
  readonly acknowledgedRevision: Revision | null;
  readonly acknowledgedAsOf: string | null;
  /** Whether the editor still holds text the service has not acknowledged, read from the contract rather than assumed from the state. */
  readonly keepsText: boolean;
};

/**
 * Maps the one status onto the words, the durable sentences and the recovery it offers, exhaustively: a member added
 * to `AutosaveState` fails to compile at the `assertNever` call instead of reaching a surface with no wording.
 */
function wordingOf({ state, outcome, acknowledgedRevision, acknowledgedAsOf, keepsText }: WordingInput): AutosaveWording {
  const kept = keepsText ? KEPT_WITH_COPY : KEPT_WITHOUT_COPY;
  switch (state) {
    case "idle":
      return { word: "Not yet saved", badge: "outline", statement: "Not yet saved — nothing has changed yet, so no save has been asked for.", details: [IDLE_DETAIL], offers: NO_OFFER };
    case "unsaved":
      return { word: "Unsaved changes", badge: "secondary", statement: "Unsaved changes — this text has not reached the service yet.", details: [UNSAVED_DETAIL], offers: NO_OFFER };
    case "saving":
      return { word: "Saving", badge: "secondary", statement: "Saving — one attempt is in flight, and this line states nothing about the text until the service answers.", details: [SAVING_DETAIL], offers: NO_OFFER };
    case "saved":
      return { word: "Saved", badge: "default", statement: savedStatement(acknowledgedRevision, acknowledgedAsOf), details: [SAVED_DETAIL, DRAFT_VS_RELEASED.draftIsNotWhatReadersSee], offers: NO_OFFER };
    case "failed-local-kept":
      return { word: "Not saved", badge: "destructive", statement: "Not saved — your text is kept in this browser.", details: [refusalDetail(outcome), kept], offers: RETRY_ONLY };
    case "conflict":
      return { word: "Not saved", badge: "destructive", statement: "Not saved — the record changed; your text is kept.", details: [conflictDetail(outcome, acknowledgedRevision), CONFLICT_RETRY, kept], offers: RETRY_ONLY };
    case "unknown":
      return { word: "Result unknown", badge: "outline", statement: "The save may or may not have been applied — the acknowledgement was lost.", details: unknownDetails(outcome, keepsText), offers: RETRY_OR_CHECK };
    default:
      return assertNever(state, "Unhandled autosave state");
  }
}

// ---------------------------------------------------------------------------------------------
// The one destructive offer: removing this browser's copy
// ---------------------------------------------------------------------------------------------

const DISCARD_LABELS = { action: "Discard this browser's copy", title: "Discard the copy this browser kept?", confirm: "Discard the copy", cancel: "Keep the copy" } as const;

const DISCARD_STATEMENTS = {
  scope: "This removes only the copy this browser kept of text the service never acknowledged.",
  onScreen: "It removes nothing from the text on screen, and nothing from the draft record: the editor keeps showing exactly what was typed.",
  irreversible: "It cannot be undone from here. Once the copy is discarded, this browser has nothing to offer back after a reload.",
} as const;

type DiscardControlProps = { readonly onDiscard: () => void };

/**
 * The separate, confirmation-guarded removal of this tab's kept copy.
 *
 * It is deliberately not offered beside the two recoveries without a confirmation: the copy is the only thing standing
 * between a lost save and lost work, so removing it is a destructive act that states what it does and does not touch.
 * The open state is this control's own UI state; the status itself stays a pure render of what the hook reports.
 */
function DiscardLocalRecoveryControl({ onDiscard }: DiscardControlProps): ReactElement {
  const [open, setOpen] = useState(false);
  const confirm = (): void => {
    setOpen(false);
    onDiscard();
  };
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button type="button" size="sm" variant="destructive" />}>{DISCARD_LABELS.action}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{DISCARD_LABELS.title}</AlertDialogTitle>
          {/* The description element is itself a paragraph, so each sentence is a span laid out as a block. */}
          <AlertDialogDescription className="flex flex-col gap-2">
            <span>{DISCARD_STATEMENTS.scope}</span>
            <span>{DISCARD_STATEMENTS.onScreen}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{DISCARD_STATEMENTS.irreversible}</p>
        <AlertDialogFooter>
          <AlertDialogCancel>{DISCARD_LABELS.cancel}</AlertDialogCancel>
          <AlertDialogAction confirmVariant="destructive" onClick={confirm}>
            {DISCARD_LABELS.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------------------------

export type AutosaveStatusProps = {
  /** The hook's report: the closed status, the service's last answer, the kept text and the three recoveries. */
  readonly recovery: DraftRecovery;
  /**
   * The instant the service stated for the revision it acknowledged — the draft read's own `asOf`, passed through
   * unchanged. Omitted when the caller has none, in which case the acknowledgement states its revision alone rather
   * than inventing a time.
   */
  readonly acknowledgedAsOf?: string | null;
  /**
   * Reads the same attempt again under its own identity. Offered for `unknown` only, and only when the caller supplies
   * it: a definite answer needs no check, because it is already known that nothing was applied.
   */
  readonly onCheckResult?: () => void;
  readonly className?: string;
};

/**
 * The durable status of one autosave.
 *
 * The live region carries the state word and one sentence, and nothing else: the durable sentences under it are linked
 * with `aria-describedby` rather than included, so an atomic announcement stays short while the full explanation stays
 * on screen for as long as it is true. Focus is never moved when a save settles — an autosave that stole focus would
 * interrupt the sentence being typed — and the region is written so that no motion is involved, so nothing here needs a
 * reduced-motion variant.
 */
export function AutosaveStatus({ recovery, acknowledgedAsOf = null, onCheckResult, className }: AutosaveStatusProps): ReactElement {
  const detailsId = useId();
  const regionRef = useRef<HTMLOutputElement | null>(null);
  const discardRequestedRef = useRef(false);
  const { state, outcome, acknowledgedRevision, keptBody, localRecovery } = recovery;
  const wording = wordingOf({ state, outcome, acknowledgedRevision, acknowledgedAsOf, keepsText: keptBody !== null });
  const details: readonly ReactNode[] = localRecovery.present ? [...wording.details, LOCAL_ONLY] : wording.details;
  const retry = wording.offers.retrySameWork ? recovery.retrySameWork : null;
  const checkResult = wording.offers.checkResult && onCheckResult !== undefined ? onCheckResult : null;
  const offersActions = retry !== null || checkResult !== null || localRecovery.present;
  useEffect(() => {
    // The control that opened the confirmation has just gone with the copy it removed, so the dialog would otherwise
    // return focus to nothing. The region states what remains, so a keyboard lands there instead of at the page start.
    if (!discardRequestedRef.current || localRecovery.present) return;
    discardRequestedRef.current = false;
    regionRef.current?.focus();
  }, [localRecovery.present]);
  const discard = (): void => {
    discardRequestedRef.current = true;
    recovery.discardLocalRecovery();
  };
  return (
    <div data-slot="autosave-status" data-autosave-state={state} className={cn("flex min-w-0 flex-col gap-2 text-start", className)}>
      {/* `<output>` carries the `status` role natively, so the polite live region is a semantic element rather than a
          role placed on a `div`. */}
      <output ref={regionRef} aria-live="polite" aria-atomic="true" aria-describedby={detailsId} tabIndex={-1} data-slot="autosave-status-region" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card px-3 py-2">
        <Badge variant={wording.badge}>{wording.word}</Badge>
        <span className="min-w-0 text-sm text-pretty wrap-anywhere">{wording.statement}</span>
      </output>
      <div id={detailsId} data-slot="autosave-status-details" className="flex min-w-0 flex-col gap-1 ps-1">
        {details.map((detail, index) => (
          <p key={index} className="text-sm text-muted-foreground text-pretty wrap-anywhere">
            {detail}
          </p>
        ))}
      </div>
      {offersActions ? (
        <div data-slot="autosave-status-actions" className="flex min-w-0 flex-wrap items-center gap-2">
          {retry === null ? null : (
            <Button type="button" size="sm" variant="outline" onClick={retry}>
              {RETRY_LABEL}
            </Button>
          )}
          {checkResult === null ? null : (
            <Button type="button" size="sm" variant="outline" onClick={checkResult}>
              {CHECK_RESULT_LABEL}
            </Button>
          )}
          {localRecovery.present ? <DiscardLocalRecoveryControl onDiscard={discard} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export default AutosaveStatus;
