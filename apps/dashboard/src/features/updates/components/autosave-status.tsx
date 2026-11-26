"use client";
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { fieldErrorsFromInvalid } from "@/components/form-field";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusMark, type StatusMarkState } from "@/components/ui/status-mark";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { DRAFT_VS_RELEASED } from "../copy/updates-copy";
import type { AutosaveState, DraftRecovery, Revision } from "../hooks/use-draft-recovery";
type RecoveryOffer = { readonly retrySameWork: boolean; readonly checkResult: boolean };
const NO_OFFER: RecoveryOffer = { retrySameWork: false, checkResult: false };
const RETRY_ONLY: RecoveryOffer = { retrySameWork: true, checkResult: false };
const RETRY_OR_CHECK: RecoveryOffer = { retrySameWork: true, checkResult: true };
const UNSAVED_DETAIL = "Changes save automatically after a brief pause.";
const SAVING_DETAIL = "Saving your draft now — waiting for confirmation.";
const SAVED_DETAIL = "Saved as a private draft (not yet reviewed, published, or emailed).";
const KEPT_WITH_COPY = "Your unsaved text is backed up in this browser tab until you retry or discard it.";
const KEPT_WITHOUT_COPY = "Your text is still in the editor, but leaving this page without saving will lose it.";
const LOCAL_ONLY = "This browser also has an unconfirmed backup from an earlier save attempt.";
const NOT_ACKNOWLEDGED = "Couldn’t confirm your save.";
function savedStatement(revision: Revision | null, asOf: string | null): ReactNode {
  const statedRevision = revision?.trim() ?? "";
  const statedAsOf = asOf?.trim() ?? "";
  if (statedRevision === "") return "Draft saved.";
  if (statedAsOf === "") {
    return (
      <>
        Draft saved (revision <bdi className="mono-identifier">{statedRevision}</bdi>).
      </>
    );
  }
  return (
    <>
      Draft saved (revision <bdi className="mono-identifier">{statedRevision}</bdi> at <bdi className="mono-identifier">{statedAsOf}</bdi>).
    </>
  );
}
/** The fields an `invalid` answer refused, each stated as `path: message` in the service's own words, capped so the status stays readable. */ function refusedFieldLines(outcome: MutationOutcome | null): readonly string[] {
  if (outcome === null || outcome.outcome !== "invalid") return [];
  const { byField, form } = fieldErrorsFromInvalid(outcome);
  const lines: string[] = [];
  for (const [path, messages] of Object.entries(byField)) {
    for (const message of messages) lines.push(`${path}: ${message}`);
  }
  lines.push(...form);
  return lines.length > 4 ? [...lines.slice(0, 4), "Fix these issues first to see any remaining errors."] : lines;
}
function refusalDetail(outcome: MutationOutcome | null): ReactNode {
  if (outcome === null) return NOT_ACKNOWLEDGED;
  switch (outcome.outcome) {
    case "invalid":
      return refusedFieldLines(outcome).length === 0 ? "Couldn’t save — check your draft for issues and try again." : "Couldn’t save — fix the fields listed below.";
    case "unavailable":
      return (
        <>
          Couldn’t reach the draft service (<bdi className="mono-identifier">{outcome.source.system}</bdi>, <bdi className="mono-identifier">{outcome.source.reference}</bdi>).
        </>
      );
    case "denied":
      return (
        <>
          Your session doesn’t have permission to save this draft (<bdi className="mono-identifier">{outcome.reasonCode}</bdi>).
        </>
      );
    default:
      return NOT_ACKNOWLEDGED;
  }
}
function conflictDetail(outcome: MutationOutcome | null, acknowledgedRevision: Revision | null): ReactNode {
  const current = outcome !== null && outcome.outcome === "conflict" ? outcome.currentRevision.trim() : "";
  const acknowledged = acknowledgedRevision?.trim() ?? "";
  if (current === "") return "This draft was updated elsewhere while you were editing, so your changes weren’t saved yet.";
  if (acknowledged === "") {
    return (
      <>
        This draft is now at revision <bdi className="mono-identifier">{current}</bdi> on the server.
      </>
    );
  }
  return (
    <>
      This draft moved to revision <bdi className="mono-identifier">{current}</bdi> (your editor was on <bdi className="mono-identifier">{acknowledged}</bdi>).
    </>
  );
}
const CONFLICT_RETRY = "Retry save to apply your text on top of the latest revision.";
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
  details.push("Check status to see if the save completed, or retry safely without creating a duplicate save.");
  details.push(keepsText ? KEPT_WITH_COPY : KEPT_WITHOUT_COPY);
  return details;
}
type WordingInput = { readonly state: AutosaveState; readonly outcome: MutationOutcome | null; readonly acknowledgedRevision: Revision | null; readonly acknowledgedAsOf: string | null; readonly keepsText: boolean };
function wordingOf({ state, outcome, acknowledgedRevision, acknowledgedAsOf, keepsText }: WordingInput): { readonly word: string; readonly badge: NonNullable<ComponentProps<typeof Badge>["variant"]>; readonly statement: ReactNode; readonly details: readonly ReactNode[]; readonly offers: RecoveryOffer } {
  const kept = keepsText ? KEPT_WITH_COPY : KEPT_WITHOUT_COPY;
  switch (state) {
    case "idle":
      return { word: "Up to date", badge: "outline", statement: "No unsaved edits.", details: ["Start typing to update your draft — changes autosave after a brief pause."], offers: NO_OFFER };
    case "unsaved":
      return { word: "Unsaved changes", badge: "secondary", statement: "Unsaved edits — waiting to autosave.", details: [UNSAVED_DETAIL], offers: NO_OFFER };
    case "saving":
      return { word: "Saving…", badge: "secondary", statement: "Saving your draft…", details: [SAVING_DETAIL], offers: NO_OFFER };
    case "saved":
      return { word: "Saved", badge: "default", statement: savedStatement(acknowledgedRevision, acknowledgedAsOf), details: [SAVED_DETAIL, DRAFT_VS_RELEASED.draftIsNotWhatReadersSee], offers: NO_OFFER };
    case "failed-local-kept":
      return { word: "Not saved", badge: "destructive", statement: "Couldn’t save — your text is kept locally.", details: [refusalDetail(outcome), ...refusedFieldLines(outcome), kept], offers: RETRY_ONLY };
    case "conflict":
      return { word: "Conflict", badge: "destructive", statement: "Draft updated elsewhere — your text is kept locally.", details: [conflictDetail(outcome, acknowledgedRevision), CONFLICT_RETRY, kept], offers: RETRY_ONLY };
    case "unknown":
      return { word: "Save unconfirmed", badge: "outline", statement: "Your save may have succeeded, but the confirmation was lost.", details: unknownDetails(outcome, keepsText), offers: RETRY_OR_CHECK };
    default:
      return assertNever(state, "Unhandled autosave state");
  }
}
const DISCARD_LABELS = { action: "Discard local backup", title: "Discard local browser backup?", confirm: "Discard backup", cancel: "Keep backup" } as const;
const DISCARD_STATEMENTS = {
  scope: "Removes the unconfirmed backup copy saved in this browser tab.",
  onScreen: "Doesn’t change the text currently in the editor or your saved draft on the server.",
  irreversible: "Once discarded, this backup can’t be restored if you reload the page.",
} as const;
function DiscardLocalRecoveryControl({ onDiscard }: { readonly onDiscard: () => void }): ReactElement {
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
          <AlertDialogAction {...{ confirmVariant: "destructive", onClick: confirm }}>{DISCARD_LABELS.confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export type AutosaveStatusProps = { readonly recovery: DraftRecovery; readonly acknowledgedAsOf?: string | null; readonly onCheckResult?: () => void; readonly className?: string };
const MARK_STATE: Readonly<Record<AutosaveState, StatusMarkState>> = {
  idle: "idle",
  unsaved: "idle",
  saving: "saving",
  saved: "saved",
  "failed-local-kept": "error",
  conflict: "conflict",
  unknown: "conflict",
};

/** The durable status of one autosave. */ export function AutosaveStatus({ recovery, acknowledgedAsOf = null, onCheckResult, className }: AutosaveStatusProps): ReactElement {
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
      {/* `<output>` carries the `status` role natively, so the polite live region is a semantic element rather than a role placed on a `div`. */}
      <output ref={regionRef} aria-live="polite" aria-atomic="true" aria-describedby={detailsId} tabIndex={-1} data-slot="autosave-status-region" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border/80 bg-card px-3 py-2 shadow-2xs">
        <StatusMark state={MARK_STATE[state]} />
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
          {retry === null ? null : <Button {...{ type: "button", size: "sm", variant: "outline", onClick: retry }}>{"Retry save"}</Button>}
          {checkResult === null ? null : <Button {...{ type: "button", size: "sm", variant: "outline", onClick: checkResult }}>{"Check status"}</Button>}
          {localRecovery.present ? <DiscardLocalRecoveryControl onDiscard={discard} /> : null}
        </div>
      ) : null}
    </div>
  );
}
export default AutosaveStatus;
