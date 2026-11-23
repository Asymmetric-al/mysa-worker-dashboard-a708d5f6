"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { MutationOutcome, reads } from "@/modules/data-service";
import { CLOSURE_COPY, INITIATIVE_STATE_COPY, MEMBERSHIP_STATE_COPY, REQUESTED_TERMS_COPY, dispositionFallback } from "../copy";
import { useAttemptSubmit, useReopenInitiative } from "../hooks/use-initiative-mutations";
import type { ReopenInitiativePayload } from "../schemas/closure";
import DiscardConfirmation from "./discard-confirmation";
import { StatedInstant } from "./figures";
type InitiativeEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];
type InitiativeDetail = InitiativeEnvelope["data"];
type InitiativeView = InitiativeDetail["initiative"];
type WorkingListEntry = InitiativeDetail["workingList"]["items"][number];
type InitiativeLifecycle = InitiativeView["lifecycle"];
const REOPEN_COPY = {
  reviewHeading: "Review this reopen",
  evidenceHeading: "What reopening keeps",
  earlierClosureTerm: "Earlier closure",
  exclusionCountSuffix: "on the working list. Each one stays as it stands and does not rejoin the working list.",
  noExclusions: "No partner is marked not eligible right now, so no exclusion is at stake and none is added.",
  exclusionsKept: "A partner marked not eligible before the initiative closed stays not eligible: reopening does not put them back on the working list.",
  excludedListLabel: "Partners marked not eligible, with the recorded instant of that decision",
  recordedInstantNote: "Recorded when the exclusion was decided, exactly as the read supplies it.",
  noReason: "No reason given, and none is required.",
  reasonTerm: "Reason given",
  noSolicitation: "Reopening creates no new solicitation: it creates no Request and no presentation, it re-sends nothing and it re-asks nobody.",
  noRecords: "It also creates no task and no message, and it leaves every recorded response and every amount of requested terms untouched.",
  reasonLabel: "Reason",
  reasonDescription: "Optional. Say why this initiative is reopening. Leave it empty if you have nothing to add: an empty reason is accepted, and nothing is read into it later.",
  mismatchBody: "This dialog was given one initiative's details and another initiative's identifier, so it offers no change: submitting either one would have reopened the wrong record. Close it and reopen the initiative from its own page.",
  discardBody: "Nothing has been sent yet, so the reason you typed is not recorded anywhere. Closing this dialog discards it.",
  keepEditingLabel: "Keep editing",
  discardLabel: "Discard the reason",
  reopenedStatement: "This initiative is open again. The earlier closure and its disposition stay recorded, and every partner marked not eligible stays excluded.",
} as const;
const DIALOG_TITLE = CLOSURE_COPY.reopenHeading;
const CONFIRM_LABEL = CLOSURE_COPY.reopenHeading;
const LIFECYCLE_NOTE: Readonly<Record<InitiativeLifecycle, string>> = {
  closed: "The initiative is closed now. That closure is the record this attempt adds to rather than replaces.",
  reopened: "This initiative was closed before and reopened. That earlier closure is the history this attempt keeps.",
  open: "The read states this initiative is already open, so reopening it has nothing to apply and the attempt will answer so.",
};
const exclusionInstantOf = (entry: WorkingListEntry): string | null => entry.history.reduce<string | null>((at, step) => (step.state === "excluded" ? step.at : at), null);
const EvidenceFact = ({ term, children }: { readonly term: string; readonly children: ReactElement }): ReactElement => (
  <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
    <dt className="text-muted-foreground">{term}</dt>
    <dd className="min-w-0 wrap-anywhere">{children}</dd>
  </div>
);
function PreservedExclusion({ entry }: { readonly entry: WorkingListEntry }): ReactElement {
  const instant = exclusionInstantOf(entry);
  return (
    <li className="min-w-0 wrap-anywhere">
      <bdi>{entry.partnerDisplayName}</bdi>
      {instant === null ? null : (
        <>
          <span aria-hidden="true">{" — "}</span> <StatedInstant value={instant} />
        </>
      )}
    </li>
  );
}
function PreservedEvidence({ detail }: { readonly detail: InitiativeDetail }): ReactElement {
  const headingId = useId();
  const initiative = detail.initiative;
  const excluded = detail.workingList.items.filter((entry) => entry.state === "excluded");
  const exclusionCount = initiative.memberStates.excluded;
  const disposition = initiative.closureDisposition === null ? REQUESTED_TERMS_COPY.notStated : dispositionFallback(initiative.closureDisposition);
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 id={headingId} className="type-subsection-title">
          {REOPEN_COPY.evidenceHeading}
        </h3>
        <Badge variant="secondary">{INITIATIVE_STATE_COPY[initiative.state].label}</Badge>
      </div>
      <dl className="flex min-w-0 flex-col gap-1.5 text-sm">
        <EvidenceFact term={CLOSURE_COPY.dispositionLabel}>
          <bdi>{disposition}</bdi>
        </EvidenceFact>
        <EvidenceFact term={REOPEN_COPY.earlierClosureTerm}>
          <span className="text-pretty">{LIFECYCLE_NOTE[initiative.lifecycle]}</span>
        </EvidenceFact>
        <EvidenceFact term={MEMBERSHIP_STATE_COPY.excluded.label}>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="tabular-figures font-medium">{String(exclusionCount)}</span>
            <span className={cn("text-pretty", exclusionCount === 0 && "text-muted-foreground")}>{exclusionCount === 0 ? REOPEN_COPY.noExclusions : REOPEN_COPY.exclusionCountSuffix}</span>
          </span>
        </EvidenceFact>
      </dl>
      {excluded.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <ul aria-label={REOPEN_COPY.excludedListLabel} className="flex min-w-0 flex-col gap-1 text-sm">
            {excluded.map((entry) => (
              <PreservedExclusion key={entry.memberId} entry={entry} />
            ))}
          </ul>
          <p className="text-xs text-pretty text-muted-foreground">{REOPEN_COPY.recordedInstantNote}</p>
        </div>
      )}
      <p className="type-supporting text-pretty">{CLOSURE_COPY.historyPreservedNote}</p>
      <p className="type-supporting text-pretty">{REOPEN_COPY.exclusionsKept}</p>
      <Separator />
      <div className="flex min-w-0 flex-col gap-1 text-sm text-pretty text-muted-foreground">
        <p className="type-supporting">{REOPEN_COPY.noSolicitation}</p>
        <p className="type-supporting">{REOPEN_COPY.noRecords}</p>
      </div>
    </section>
  );
}
const REOPENING_OUTCOMES: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["accepted", "alreadyAccepted"]);
type DialogPhase = "review" | "confirming-discard";
type AttemptProgress = { readonly attempted: boolean; readonly reopened: boolean };
const INITIAL_PROGRESS: AttemptProgress = { attempted: false, reopened: false };
const FIELD_LABELS: Readonly<Record<string, string>> = { initiativeId: "Initiative", reason: REOPEN_COPY.reasonLabel };
export type ReopenInitiativeDialogProps = { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly initiativeId: string; readonly envelope: InitiativeEnvelope; readonly onReopened?: () => void };
type CloseGuard = () => boolean;
type ReopenInitiativeBodyProps = { readonly initiativeId: string; readonly envelope: InitiativeEnvelope; readonly registerCloseGuard: (guard: CloseGuard | null) => void; readonly onClose: () => void; readonly onReopened?: () => void };
function ReopenInitiativeBody({ initiativeId, envelope, registerCloseGuard, onClose, onReopened }: ReopenInitiativeBodyProps): ReactElement {
  const submit = useAttemptSubmit(useReopenInitiative(envelope.scope));
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<DialogPhase>("review");
  const [progress, setProgress] = useState<AttemptProgress>(INITIAL_PROGRESS);
  const [fieldErrors, setFieldErrors] = useState<FieldErrorLookup | null>(null);
  const [expectedRevision] = useState(envelope.revision);
  const payload = useMemo<ReopenInitiativePayload>(() => (reason.trim() === "" ? { initiativeId } : { initiativeId, reason: reason.trim() }), [initiativeId, reason]);
  const input = useMemo(() => ({ scope: envelope.scope, expectedRevision, payload }), [envelope.scope, expectedRevision, payload]);
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setFieldErrors(outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null);
      const reopened = REOPENING_OUTCOMES.has(outcome.outcome);
      setProgress({ attempted: true, reopened });
      if (reopened) onReopened?.();
    },
    [onReopened],
  );
  const keepOpenForUnsentReason = useCallback((): boolean => {
    const unsent = phase === "review" && !progress.attempted && reason.trim() !== "";
    if (unsent) setPhase("confirming-discard");
    return unsent;
  }, [phase, progress.attempted, reason]);
  const requestClose = useCallback((): void => {
    if (!keepOpenForUnsentReason()) onClose();
  }, [keepOpenForUnsentReason, onClose]);
  useEffect(() => {
    registerCloseGuard(keepOpenForUnsentReason);
    return () => registerCloseGuard(null);
  }, [keepOpenForUnsentReason, registerCloseGuard]);
  const initiative = envelope.data.initiative;
  const renderDiscardQuestion = (): ReactElement => <DiscardConfirmation title={DIALOG_TITLE} body={REOPEN_COPY.discardBody} keepEditingLabel={REOPEN_COPY.keepEditingLabel} discardLabel={REOPEN_COPY.discardLabel} onKeepEditing={() => setPhase("review")} onDiscard={onClose} />;
  const renderReview = (): ReactElement => (
    <>
      <PreservedEvidence detail={envelope.data} />
      <FormField name="reason" label={REOPEN_COPY.reasonLabel} description={REOPEN_COPY.reasonDescription} optionalHint error={fieldErrors?.byField.reason}>
        {(field) => <Textarea id={field.id} name="reason" rows={3} value={reason} aria-describedby={field.describedBy} aria-invalid={field.invalid ? true : undefined} onChange={(event) => setReason(event.currentTarget.value)} />}
      </FormField>
      <ActionReview<ReopenInitiativePayload>
        title={REOPEN_COPY.reviewHeading}
        headingLevel={3}
        consequential
        description={
          <>
            <p className="type-supporting flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <bdi className="font-medium text-foreground">{initiative.name}</bdi>
              <span>{CLOSURE_COPY.reopenHelp}</span>
            </p>
            <p className="type-supporting">
              {`${REOPEN_COPY.reasonTerm}: `}
              <bdi>{reason.trim() === "" ? REOPEN_COPY.noReason : reason.trim()}</bdi>
            </p>
          </>
        }
        consequence={
          <>
            <p className="type-supporting">{CLOSURE_COPY.historyPreservedNote}</p> <p className="type-supporting">{REOPEN_COPY.exclusionsKept}</p>
          </>
        }
        confirmLabel={CONFIRM_LABEL}
        onCancel={requestClose}
        input={input}
        submit={submit}
        onSettled={handleSettled}
        fieldLabels={FIELD_LABELS}
      />
      {progress.reopened ? <output className="block text-sm text-pretty">{REOPEN_COPY.reopenedStatement}</output> : null}
    </>
  );
  const renderBody = (): ReactElement => (initiative.initiativeId !== initiativeId ? <p className="type-supporting text-pretty">{REOPEN_COPY.mismatchBody}</p> : phase === "confirming-discard" ? renderDiscardQuestion() : renderReview());
  return <div className="flex min-w-0 flex-col gap-5">{renderBody()}</div>;
}
/** The confirmed reopen of a closed initiative. The wrapper owns the modal substrate and the decision to close, and nothing else: the subscription to the family's mutation, the field, the review step and the receipt all live in the body, whose lifetime is the visit. */
export function ReopenInitiativeDialog({ open, onOpenChange, initiativeId, envelope, onReopened }: ReopenInitiativeDialogProps): ReactElement {
  const closeGuard = useRef<CloseGuard | null>(null);
  const registerCloseGuard = useCallback((guard: CloseGuard | null): void => {
    closeGuard.current = guard;
  }, []);
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (next) {
        onOpenChange(true);
        return;
      }
      if (closeGuard.current?.() === true) return;
      onOpenChange(false);
    },
    [onOpenChange],
  );
  const close = useCallback((): void => onOpenChange(false), [onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-slot="reopen-initiative-dialog">
        <DialogHeader>
          <DialogTitle>{DIALOG_TITLE}</DialogTitle>
          <DialogDescription>{CLOSURE_COPY.reopenHelp}</DialogDescription>
        </DialogHeader>
        <ReopenInitiativeBody initiativeId={initiativeId} envelope={envelope} registerCloseGuard={registerCloseGuard} onClose={close} onReopened={onReopened} />
      </DialogContent>
    </Dialog>
  );
}
export default ReopenInitiativeDialog;
