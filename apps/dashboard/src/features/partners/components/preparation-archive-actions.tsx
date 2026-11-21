"use client";
/**
 * Archive and restore for the worker's own private preparation: one confirmation built from the family's own
 * wording, one durable receipt, and nothing at all for a shared operational record.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { PartnerKind, ReadAction, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { ARCHIVE_COPY, type Copy } from "../copy/privacy";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY } from "../copy/states";
import { useArchivePreparation, useRestorePreparation, type PartnerMutationHandle, type PartnerMutationInput } from "../hooks/use-partner-mutations";
import type { ArchivePreparationPayload } from "../schemas/preparation";
/** The one record kind this control acts on: a shared person, household, church or organisation record is never archived. */
const PREPARATION_KIND: PartnerKind = "private-preparation";
const ARCHIVE_ACTION_NAME = "archivePreparation";
const RESTORE_ACTION_NAME = "restorePreparation";
const ARCHIVE_LABEL = "Archive preparation";
const RESTORE_LABEL = "Restore preparation";
const CANCEL_LABEL = "Cancel";
const CHECK_RESULT_LABEL = "Check the result";
const WORKING_STATEMENT = "Applying this change once. The receipt below appears when the partner source answers.";
const UNAVAILABLE_TITLE = "This change did not reach the source";
const UNAVAILABLE_DESCRIPTION = "The preparation record keeps its place in the source: the request did not arrive, so nothing about it changed.";
const UNKNOWN_TITLE = "This change is not confirmed";
const DENIED_TITLE = SURFACE_STATE_COPY["private-preparation"].denied.title;
const DENIED_DESCRIPTION = SURFACE_STATE_COPY["private-preparation"].denied.body;
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { partnerId: "Preparation record" };
const RECEIPT_HEADING_LEVEL = 3;
/** The copy an archive confirmation states, in reading order: what archiving does, that restoring undoes it, and what it leaves alone. */
const ARCHIVE_STATEMENTS: readonly Copy[] = [ARCHIVE_COPY.archiveIsNotDelete, ARCHIVE_COPY.restore, ARCHIVE_COPY.leavesSharedAlone];
/** The copy a restore confirmation states: what restoring returns, and what it leaves alone. */
const RESTORE_STATEMENTS: readonly Copy[] = [ARCHIVE_COPY.restore, ARCHIVE_COPY.leavesSharedAlone];
/** Which direction of the change one settled receipt records, so a receipt stays readable after the control flips to the other direction. */
type ArchiveDirection = "archive" | "restore";
interface SettledChange {
  readonly outcome: MutationOutcome;
  readonly direction: ArchiveDirection;
}
/** What the caller supplies: the preparation record, the authority it is changed in, the revision it was read at, and the actions that read admitted. */
export interface PreparationArchiveActionsProps {
  /** The opaque identifier of the private preparation record. */
  readonly partnerId: string;
  /** What kind of record this is; anything but private preparation renders nothing at all. */
  readonly kind: PartnerKind;
  /** Whether the preparation is archived now, which decides the one direction this control offers. */
  readonly archived: boolean;
  /** The revision the caller read, which every change presents as its expected revision. */
  readonly expectedRevision: string;
  /** The scope the caller read in; the service re-derives it and re-checks it on submit. */
  readonly scope: Scope;
  /** The envelope's advisory actions, which decide whether the change is admitted at all. */
  readonly availableActions: readonly ReadAction[];
  /** Called once a change settles, with the outcome the service answered. */
  readonly onSettled?: ((outcome: MutationOutcome) => void) | undefined;
  /** The caller's own re-read of the record, offered as the check for an unconfirmed change. */
  readonly onCheckResult?: (() => void) | undefined;
  readonly className?: string;
}
interface OutcomeReceiptProps {
  readonly outcome: MutationOutcome;
  readonly onCheckResult: (() => void) | undefined;
  readonly onReplay: (() => void) | undefined;
  readonly onReapply: ((revision: string) => void) | undefined;
}
/**
 * The receipt for one settled change: the three states a refusal, an outage or a lost acknowledgement produce
 * read as notices, and every outcome that carries a result of its own reads through the one receipt pattern.
 */
function OutcomeReceipt({ outcome, onCheckResult, onReplay, onReapply }: OutcomeReceiptProps): ReactElement {
  switch (outcome.outcome) {
    case "denied":
      // Nothing but the closed reason code travels with a refusal, so no name, count or existence hint is shown beside it.
      return <StateNotice kind="denied" title={DENIED_TITLE} description={DENIED_DESCRIPTION} reasonCode={outcome.reasonCode} headingLevel={RECEIPT_HEADING_LEVEL} />;
    case "unavailable":
      // Retrying re-sends this same operation, so the service answers with the original result if the change had already been applied.
      return <StateNotice kind="unavailable" title={UNAVAILABLE_TITLE} description={UNAVAILABLE_DESCRIPTION} source={outcome.source} retry={onReplay === undefined ? undefined : { label: PARTNER_ACTION_LABELS.retry, onClick: onReplay }} headingLevel={RECEIPT_HEADING_LEVEL} />;
    case "unknown":
      // Only a read of the record settles an unconfirmed change; archiving again under a fresh identity is never offered.
      return <StateNotice kind="unknown" title={UNKNOWN_TITLE} operationId={outcome.operationId} action={onCheckResult === undefined ? undefined : { label: CHECK_RESULT_LABEL, onClick: onCheckResult }} headingLevel={RECEIPT_HEADING_LEVEL} />;
    case "accepted":
    case "alreadyAccepted":
    case "unchanged":
    case "conflict":
    case "invalid":
      return <OperationResult outcome={outcome} headingLevel={RECEIPT_HEADING_LEVEL} onReapply={outcome.outcome === "conflict" && onReapply !== undefined ? () => onReapply(outcome.currentRevision) : undefined} fieldLabels={FIELD_LABELS} />;
    default:
      return assertNever(outcome, "Unhandled preparation change outcome");
  }
}
/**
 * Archive or restore one private preparation record, behind a confirmation.
 *
 * Renders nothing for any other record kind and nothing when the envelope does not admit the one direction the
 * record's current state offers. A settled change is reported where the worker acted, and the record itself keeps
 * rendering until the service's own read reflects the change: nothing is hidden optimistically here.
 */
export default function PreparationArchiveActions({ partnerId, kind, archived, expectedRevision, scope, availableActions, onSettled, onCheckResult, className }: PreparationArchiveActionsProps): ReactElement | null {
  const archive = useArchivePreparation(partnerId);
  const restore = useRestorePreparation(partnerId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settled, setSettled] = useState<SettledChange | null>(null);
  // The record this receipt belongs to. A side panel that swaps records re-uses this position, and a receipt
  // from another preparation would be read as a statement about the one now on screen.
  const [receiptTarget, setReceiptTarget] = useState(partnerId);
  if (receiptTarget !== partnerId) {
    setReceiptTarget(partnerId);
    setSettled(null);
    setDialogOpen(false);
  }
  const attemptRef = useRef<PartnerMutationInput<ArchivePreparationPayload> | null>(null);
  const receiptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (settled === null) {
      return;
    }
    // The receipt is the record of what happened, so the keyboard position follows the change rather than staying on a control that may no longer exist.
    receiptRef.current?.focus();
  }, [settled]);
  const direction: ArchiveDirection = archived ? "restore" : "archive";
  const admitted = availableActions.find((entry) => entry.name === (archived ? RESTORE_ACTION_NAME : ARCHIVE_ACTION_NAME));
  // The guard is the record kind plus the envelope's own actions: a shared record, or a direction this read withholds, gets no control and no explanation of one.
  if (kind !== PREPARATION_KIND || admitted === undefined || !admitted.available) {
    return null;
  }
  const handle: PartnerMutationHandle<ArchivePreparationPayload> = archived ? restore : archive;
  const label = archived ? RESTORE_LABEL : ARCHIVE_LABEL;
  const statements = archived ? RESTORE_STATEMENTS : ARCHIVE_STATEMENTS;
  const send = async (input: PartnerMutationInput<ArchivePreparationPayload>): Promise<void> => {
    attemptRef.current = input;
    const outcome = await handle.submit(input);
    setSettled({ outcome, direction });
    onSettled?.(outcome);
  };
  const confirm = (): void => {
    setDialogOpen(false);
    void send({ scope, expectedRevision, payload: { partnerId } });
  };
  const replay = (): void => {
    const previous = attemptRef.current;
    // Only the operation this record's control started can be replayed here: another record's attempt would report its result on this one.
    if (previous !== null && previous.payload.partnerId === partnerId) {
      void send(previous);
    }
  };
  const reapply = (revision: string): void => {
    void send({ scope, expectedRevision: revision, payload: { partnerId } });
  };
  const pending = handle.isPending;
  return (
    <section data-slot="preparation-archive-actions" data-direction={direction} data-state={pending ? "pending" : settled === null ? "idle" : "settled"} aria-busy={pending ? true : undefined} className={cn("flex min-w-0 flex-col gap-3 text-start", className)}>
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {/* The installed alert dialog rather than the shared multi-item review step: one reversible preparation changes here, and the review step exists for reviewed batches where each row can differ. */}
        <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" disabled={pending} className="h-auto min-h-8 max-w-full whitespace-normal" />}>{label}</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{label}</AlertDialogTitle>
            {/* The description element is itself a paragraph, so each copy statement is a block-laid-out span. */}
            <AlertDialogDescription className="flex flex-col gap-2">
              {statements.map((statement) => (
                <span key={statement.title}>{statement.body}</span>
              ))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert>
            <AlertTitle>{ARCHIVE_COPY.scope.title}</AlertTitle>
            <AlertDescription>{ARCHIVE_COPY.scope.body}</AlertDescription>
          </Alert>
          <AlertDialogFooter>
            <AlertDialogCancel>{CANCEL_LABEL}</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirm} disabled={pending}>
              {label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {pending ? <output className="text-sm text-muted-foreground text-pretty">{WORKING_STATEMENT}</output> : null}
      {settled === null ? null : (
        <div ref={receiptRef} tabIndex={-1} data-slot="preparation-archive-receipt" data-outcome={settled.outcome.outcome} data-direction={settled.direction} className="flex min-w-0 flex-col gap-3">
          {/* The act the receipt belongs to stays named here, because the control above flips to the other direction as soon as the service's read reflects the change. */}
          <p className="text-sm font-medium text-muted-foreground">{settled.direction === "archive" ? ARCHIVE_LABEL : RESTORE_LABEL}</p>
          <OutcomeReceipt outcome={settled.outcome} onCheckResult={onCheckResult} onReplay={replay} onReapply={reapply} />
        </div>
      )}
    </section>
  );
}
