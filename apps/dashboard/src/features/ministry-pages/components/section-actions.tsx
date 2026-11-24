"use client";
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { copy } from "../copy";
import { useDuplicatePageSection, useRemovePageSection } from "../hooks/page-mutations";
import type { DuplicateSectionPayload, RemoveSectionPayload } from "../schemas/section";
const REVIEW_HEADING_LEVEL: ReviewHeadingLevel = 4;
const SENTENCE_CLASS = "text-sm text-pretty";
const POSITION_CLASS = "tabular-figures text-sm text-muted-foreground";
const REVIEW_BODY_CLASS = "flex min-w-0 flex-col gap-2";
type ChosenAction = "duplicate" | "remove";
type SectionMutationBody<Payload> = Parameters<MutationSubmit<Payload>>[0];
type ReviewInput<Payload> = Omit<SectionMutationBody<Payload>, "operationId">;
type Outcome = Awaited<ReturnType<MutationSubmit<unknown>>>;
const KEEPS_RECEIPT: Readonly<Record<Outcome["outcome"], boolean>> = { accepted: true, alreadyAccepted: true, unchanged: true, unknown: true, conflict: false, denied: false, invalid: false, unavailable: false };
const holdsReceipt = (outcome: Outcome | null): boolean => outcome !== null && KEEPS_RECEIPT[outcome.outcome];
const inputOf = <Payload,>(attempt: SectionMutationBody<Payload>): ReviewInput<Payload> => ({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
const statedPosition = (index: number): number | null => (Number.isInteger(index) && index >= 0 ? index + 1 : null);
function copyPosition(index: number, count: number): number | null {
  const stated = statedPosition(index);
  const size = Number.isInteger(count) && count > 0 ? count : 0;
  return stated === null || (size > 0 && index >= size) ? null : stated + 1;
}
export interface SectionActionsProps {
  readonly scope: ReviewInput<unknown>["scope"];
  readonly documentId: string;
  readonly sectionId: string;
  readonly sectionLabel: string;
  readonly index: number;
  readonly count: number;
  readonly variantId: string;
  readonly expectedRevision: string;
  readonly managed: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}
/** Duplicate and remove one draft section, each reviewed before it takes effect. */ export function SectionActions({ scope, documentId, sectionId, sectionLabel, index, count, variantId, expectedRevision, managed, disabled = false, className }: SectionActionsProps): ReactElement {
  const duplicate = useDuplicatePageSection();
  const remove = useRemovePageSection();
  const reasonId = useId();
  const [chosen, setChosen] = useState<ChosenAction | null>(null);
  const [settled, setSettled] = useState<Outcome | null>(null);
  const [submittedDuplicate, setSubmittedDuplicate] = useState<ReviewInput<DuplicateSectionPayload> | null>(null);
  const [submittedRemove, setSubmittedRemove] = useState<ReviewInput<RemoveSectionPayload> | null>(null);
  const liveDuplicate = useMemo<ReviewInput<DuplicateSectionPayload>>(() => ({ scope, expectedRevision, payload: { operation: "duplicateSection", variantId, sectionId } }), [scope, expectedRevision, variantId, sectionId]);
  const liveRemove = useMemo<ReviewInput<RemoveSectionPayload>>(() => ({ scope, expectedRevision, payload: { operation: "removeSection", variantId, sectionId } }), [scope, expectedRevision, variantId, sectionId]);
  const kept = holdsReceipt(settled);
  const submitDuplicate = useCallback<MutationSubmit<DuplicateSectionPayload>>(
    async (attempt) => {
      setSubmittedDuplicate(inputOf(attempt));
      return duplicate.mutateAsync({ ...attempt, documentId });
    },
    [duplicate, documentId],
  );
  const submitRemove = useCallback<MutationSubmit<RemoveSectionPayload>>(
    async (attempt) => {
      setSubmittedRemove(inputOf(attempt));
      return remove.mutateAsync({ ...attempt, documentId });
    },
    [remove, documentId],
  );
  const settle = useCallback((outcome: Outcome): void => setSettled(outcome), []);
  const choose = useCallback((action: ChosenAction): void => {
    setChosen(action);
    setSettled(null);
    setSubmittedDuplicate(null);
    setSubmittedRemove(null);
  }, []);
  const close = useCallback((): void => setChosen(null), []);
  const locked = managed === true;
  const reason = locked ? copy.lockReasons.reasons["source-supplied-section"] : null;
  const describedBy = reason === null ? undefined : reasonId;
  const label = <bdi className={"min-w-0 font-medium wrap-anywhere"}>{sectionLabel}</bdi>;
  const sourcePosition = statedPosition(index);
  const duplicateAtIndex = copyPosition(index, count);
  const positionLine = (
    <p className={cn(SENTENCE_CLASS, "flex min-w-0 flex-wrap items-baseline gap-x-1.5")}>
      {label}
      {sourcePosition === null ? null : <span className={POSITION_CLASS}>{copy.builder.positionOption(sourcePosition)}</span>}
    </p>
  );
  return (
    <div data-slot="section-actions" data-section-id={sectionId} data-managed={locked ? "true" : "false"} className={cn("flex min-w-0 flex-col gap-2", className)}>
      {chosen === null || kept ? (
        <div className={"flex min-w-0 flex-wrap items-center gap-2"}>
          <Button type="button" variant="outline" size="sm" disabled={locked || disabled} aria-describedby={describedBy} onClick={() => choose("duplicate")}>
            {copy.builder.duplicate}
            <span className="sr-only">
              {" for "}
              <bdi>{sectionLabel}</bdi>
            </span>
          </Button>
          <Button type="button" variant="destructive" size="sm" disabled={locked || disabled} aria-describedby={describedBy} onClick={() => choose("remove")}>
            {copy.builder.remove}
            <span className="sr-only">
              {" for "}
              <bdi>{sectionLabel}</bdi>
            </span>
          </Button>
        </div>
      ) : null}
      {reason === null ? null : (
        <Alert role={undefined} data-slot="section-actions-reason">
          <AlertDescription id={reasonId}>
            <p dir="auto">{reason}</p>
            <p dir="auto">{copy.lockReasons.genericLockedReason}</p>
          </AlertDescription>
        </Alert>
      )}
      {chosen === "duplicate" ? (
        <ActionReview<DuplicateSectionPayload>
          title={copy.builder.duplicateHeading}
          headingLevel={REVIEW_HEADING_LEVEL}
          description={
            <div className={REVIEW_BODY_CLASS}>
              {positionLine} <p className={SENTENCE_CLASS}>{copy.sectionActions.duplicateReview}</p> {duplicateAtIndex === null ? null : <p className={POSITION_CLASS}>{copy.builder.positionOption(duplicateAtIndex)}</p>}
            </div>
          }
          confirmLabel={copy.sectionActions.confirmDuplicate}
          input={kept && submittedDuplicate !== null ? submittedDuplicate : liveDuplicate}
          submit={submitDuplicate}
          onSettled={settle}
          onCancel={close}
        />
      ) : null}
      {chosen === "remove" ? (
        <ActionReview<RemoveSectionPayload>
          title={copy.builder.removeHeading}
          headingLevel={REVIEW_HEADING_LEVEL}
          consequential
          description={
            <div className={REVIEW_BODY_CLASS}>
              {positionLine} <p className={SENTENCE_CLASS}>{copy.sectionActions.removeReview}</p>
            </div>
          }
          consequence={
            <div className={REVIEW_BODY_CLASS}>
              <p className={SENTENCE_CLASS}>{label}</p> <p className={SENTENCE_CLASS}>{copy.sectionActions.removeConfirm}</p>
            </div>
          }
          confirmLabel={copy.sectionActions.confirmRemove}
          input={kept && submittedRemove !== null ? submittedRemove : liveRemove}
          submit={submitRemove}
          onSettled={settle}
          onCancel={close}
        />
      ) : null}
    </div>
  );
}
export default SectionActions;
