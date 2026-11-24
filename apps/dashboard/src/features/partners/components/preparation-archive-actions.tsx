"use client";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { outcomeNotice, type OutcomeNoticeCopy } from "@/components/attempt";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { PartnerKind, ReadAction, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { ARCHIVE_COPY, type Copy } from "../copy/privacy";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY } from "../copy/states";
import { useArchivePreparation, useRestorePreparation, type PartnerMutationHandle, type PartnerMutationInput } from "../hooks/use-partner-mutations";
import type { ArchivePreparationPayload } from "../schemas/preparation";
const ARCHIVE_LABEL = "Archive preparation";
const RESTORE_LABEL = "Restore preparation";
const UNAVAILABLE_TITLE = "This change did not reach the source";
const UNAVAILABLE_DESCRIPTION = "The preparation record keeps its place in the source: the request did not arrive, so nothing about it changed.";
const DENIED_TITLE = SURFACE_STATE_COPY["private-preparation"].denied.title;
const DENIED_DESCRIPTION = SURFACE_STATE_COPY["private-preparation"].denied.body;
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { partnerId: "Preparation record" };
const RECEIPT_HEADING_LEVEL = 3;
const ARCHIVE_STATEMENTS: readonly Copy[] = [ARCHIVE_COPY.archiveIsNotDelete, ARCHIVE_COPY.restore, ARCHIVE_COPY.leavesSharedAlone];
const RESTORE_STATEMENTS: readonly Copy[] = [ARCHIVE_COPY.restore, ARCHIVE_COPY.leavesSharedAlone];
type ArchiveDirection = "archive" | "restore";
export interface PreparationArchiveActionsProps {
  readonly partnerId: string;
  readonly kind: PartnerKind;
  readonly archived: boolean;
  readonly expectedRevision: string;
  readonly scope: Scope;
  readonly availableActions: readonly ReadAction[];
  readonly onSettled?: ((outcome: MutationOutcome) => void) | undefined;
  readonly onCheckResult?: (() => void) | undefined;
  readonly className?: string;
}
type OutcomeReceiptProps = { readonly outcome: MutationOutcome; readonly onCheckResult: (() => void) | undefined; readonly onReplay: (() => void) | undefined; readonly onReapply: ((revision: string) => void) | undefined };
const NOTICE_COPY: OutcomeNoticeCopy = { denied: { title: DENIED_TITLE, description: DENIED_DESCRIPTION }, unavailable: { title: UNAVAILABLE_TITLE, description: UNAVAILABLE_DESCRIPTION }, unknown: { title: "This change is not confirmed" }, retryLabel: PARTNER_ACTION_LABELS.retry, checkResultLabel: "Check the result" };
function OutcomeReceipt({ outcome, onCheckResult, onReplay, onReapply }: OutcomeReceiptProps): ReactElement {
  const notice = outcomeNotice(outcome, NOTICE_COPY, { onRetrySameWork: onReplay, onCheckResult, headingLevel: RECEIPT_HEADING_LEVEL });
  return notice === null ? <OperationResult outcome={outcome} headingLevel={RECEIPT_HEADING_LEVEL} onReapply={outcome.outcome === "conflict" && onReapply !== undefined ? () => onReapply(outcome.currentRevision) : undefined} fieldLabels={FIELD_LABELS} /> : <StateNotice {...notice} />;
}
/** Archive or restore one private preparation record, behind a confirmation. */
export default function PreparationArchiveActions({ partnerId, kind, archived, expectedRevision, scope, availableActions, onSettled, onCheckResult, className }: PreparationArchiveActionsProps): ReactElement | null {
  const archive = useArchivePreparation(partnerId);
  const restore = useRestorePreparation(partnerId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settled, setSettled] = useState<{ readonly outcome: MutationOutcome; readonly direction: ArchiveDirection } | null>(null);
  const [receiptTarget, setReceiptTarget] = useState(partnerId);
  if (receiptTarget !== partnerId) {
    setReceiptTarget(partnerId);
    setSettled(null);
    setDialogOpen(false);
  }
  const attemptRef = useRef<PartnerMutationInput<ArchivePreparationPayload> | null>(null);
  const receiptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (settled === null) return;
    receiptRef.current?.focus();
  }, [settled]);
  const direction: ArchiveDirection = archived ? "restore" : "archive";
  const admitted = availableActions.find((entry) => entry.name === (archived ? "restorePreparation" : "archivePreparation"));
  if (kind !== "private-preparation" || admitted === undefined || !admitted.available) return null;
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
    if (previous !== null && previous.payload.partnerId === partnerId) void send(previous);
  };
  const reapply = (revision: string): void => {
    void send({ scope, expectedRevision: revision, payload: { partnerId } });
  };
  const pending = handle.isPending;
  return (
    <section data-slot="preparation-archive-actions" data-direction={direction} data-state={pending ? "pending" : settled === null ? "idle" : "settled"} aria-busy={pending ? true : undefined} className={cn("flex min-w-0 flex-col gap-3 text-start", className)}>
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" disabled={pending} className={BUTTON_WRAP_CLASS} />}>{label}</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{label}</AlertDialogTitle>
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction {...{ type: "button" as const, onClick: confirm, disabled: pending }}>{label}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {pending ? <output className="text-sm text-muted-foreground text-pretty">Applying this change once. The receipt below appears when the partner source answers.</output> : null}
      {settled === null ? null : (
        <div ref={receiptRef} tabIndex={-1} data-slot="preparation-archive-receipt" data-outcome={settled.outcome.outcome} data-direction={settled.direction} className="flex min-w-0 flex-col gap-3">
          <p className="text-sm font-medium text-muted-foreground">{settled.direction === "archive" ? ARCHIVE_LABEL : RESTORE_LABEL}</p>
          <OutcomeReceipt outcome={settled.outcome} onCheckResult={onCheckResult} onReplay={replay} onReapply={reapply} />
        </div>
      )}
    </section>
  );
}
