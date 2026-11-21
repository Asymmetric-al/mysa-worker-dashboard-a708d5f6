"use client";
/**
 * The two structural changes one draft section can be given — duplicate it, or remove it — each
 * reviewed before it takes effect and each reported by the one durable receipt.
 *
 * Both changes edit the draft edition only. A released edition keeps the sections it was released
 * with, so the review, the confirmation and the receipt all say that removing a section withdraws
 * nothing and recalls nothing; no wording here describes a removal as unpublishing.
 */
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";

import ActionReview, { type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { copy, type ManagedFieldKey } from "../copy";
import { useDuplicatePageSection, useRemovePageSection } from "../hooks/use-section-mutations";
import type { DuplicateSectionPayload, RemoveSectionPayload } from "../schemas/section";

/** The reason a managed section offers neither change: the source supplies it, so the source would refuse the change and this surface says so first. */
const MANAGED_SECTION_REASON: ManagedFieldKey = "source-supplied-section";
/** A section row sits under the edition's own section heading, so its review nests one level below that. */
const REVIEW_HEADING_LEVEL: ReviewHeadingLevel = 4;
const ROOT_CLASS = "flex min-w-0 flex-col gap-2";
const ROW_CLASS = "flex min-w-0 flex-wrap items-center gap-2";
const SENTENCE_CLASS = "text-sm text-pretty";
const LABEL_CLASS = "min-w-0 font-medium wrap-anywhere";
const POSITION_CLASS = "tabular-figures text-sm text-muted-foreground";
const REVIEW_BODY_CLASS = "flex min-w-0 flex-col gap-2";

/** The action whose review is open, or the one whose receipt is showing. */
type ChosenAction = "duplicate" | "remove";

/**
 * The mutation body this control submits, taken from the review step's own submit contract rather than
 * restated: a body that stops carrying its scope or its expected revision stops compiling here.
 */
type SectionMutationBody<Payload> = Parameters<MutationSubmit<Payload>>[0];

/** The review step's input: that body without the attempt identity, which the review step mints. */
type ReviewInput<Payload> = Omit<SectionMutationBody<Payload>, "operationId">;

/** The authority a change is submitted in, read from the same contract. */
type Scope = ReviewInput<unknown>["scope"];

/** The closed outcome set every mutation answers with, read from the same contract. */
type Outcome = Awaited<ReturnType<MutationSubmit<unknown>>>;

/** Fails the build if a mutation outcome is added without a place on this surface. */
function assertUnreachable(value: never): never {
  throw new Error(`Unhandled mutation outcome: ${JSON.stringify(value)}`);
}

/**
 * Whether a settled attempt keeps its receipt after the Page's read re-runs.
 *
 * An accepted, replayed or unknown attempt re-reads the edition, which advances the revision this
 * component is handed; the input that was submitted is then held so the receipt stays readable
 * instead of collapsing back to a fresh review. A definite refusal changed nothing, so the live
 * input is the honest one there.
 */
function holdsReceipt(outcome: Outcome | null): boolean {
  if (outcome === null) {
    return false;
  }
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
    case "unchanged":
    case "unknown":
      return true;
    case "conflict":
    case "denied":
    case "invalid":
    case "unavailable":
      return false;
    default:
      return assertUnreachable(outcome);
  }
}

/** The position of a section counted from one, or `null` when the caller's index names no position. */
function statedPosition(index: number): number | null {
  return Number.isInteger(index) && index >= 0 ? index + 1 : null;
}

/**
 * Where the copy of a section lands, counted from one.
 *
 * `duplicateSection` copies the section immediately after itself — there is no destination to choose
 * and none is offered — so the copy takes the position after the source's, which is the source's
 * zero-based index plus two. An index that names no position in the edition states no position.
 */
function copyPosition(index: number, count: number): number | null {
  const stated = statedPosition(index);
  if (stated === null) {
    return null;
  }
  const positionCount = Number.isInteger(count) && count > 0 ? count : 0;
  return positionCount > 0 && index >= positionCount ? null : stated + 1;
}

export interface SectionActionsProps {
  /**
   * The authority this change is submitted in: the organization, ministry, support subject and
   * principal the edition was read under. The service re-authorises it on submit, so this is the
   * caller's claim about the context and never a grant this control extends.
   */
  readonly scope: Scope;
  /**
   * The Page the edition belongs to. The family transport re-reads this Page once an attempt could
   * have changed it, which is what makes the outline show the new or removed section.
   */
  readonly documentId: string;
  /** The section this control acts on, handed to the mutation exactly as the edition's read supplied it. */
  readonly sectionId: string;
  /** The section's label, named in the review, the confirmation and each control's accessible name. */
  readonly sectionLabel: string;
  /** The section's zero-based position in the edition, as the outline read it. */
  readonly index: number;
  /** How many sections the edition holds right now. */
  readonly count: number;
  /** The language edition being edited; a section change names it so the change reaches one edition only. */
  readonly variantId: string;
  /** The revision the caller read. Every change presents it, so a change built on a replaced revision is a conflict rather than an overwrite. */
  readonly expectedRevision: string;
  /** Whether the source supplies this section. A managed section offers neither change. */
  readonly managed: boolean;
  /** Whether the caller withholds both changes for a reason of its own. */
  readonly disabled?: boolean;
  readonly className?: string;
}

/** Duplicate and remove one draft section, each reviewed before it takes effect. */
export function SectionActions({ scope, documentId, sectionId, sectionLabel, index, count, variantId, expectedRevision, managed, disabled = false, className }: SectionActionsProps): ReactElement {
  const duplicate = useDuplicatePageSection();
  const remove = useRemovePageSection();
  const reasonId = useId();
  const [chosen, setChosen] = useState<ChosenAction | null>(null);
  const [settled, setSettled] = useState<Outcome | null>(null);
  const [submittedDuplicate, setSubmittedDuplicate] = useState<ReviewInput<DuplicateSectionPayload> | null>(null);
  const [submittedRemove, setSubmittedRemove] = useState<ReviewInput<RemoveSectionPayload> | null>(null);

  // The payload names the edition rather than a draft revision, so the service resolves the current
  // draft of that edition: a section change never carries a revision that could name a released one.
  const liveDuplicate = useMemo<ReviewInput<DuplicateSectionPayload>>(() => ({ scope, expectedRevision, payload: { operation: "duplicateSection", variantId, sectionId } }), [scope, expectedRevision, variantId, sectionId]);
  const liveRemove = useMemo<ReviewInput<RemoveSectionPayload>>(() => ({ scope, expectedRevision, payload: { operation: "removeSection", variantId, sectionId } }), [scope, expectedRevision, variantId, sectionId]);

  const kept = holdsReceipt(settled);
  const duplicateInput = kept && submittedDuplicate !== null ? submittedDuplicate : liveDuplicate;
  const removeInput = kept && submittedRemove !== null ? submittedRemove : liveRemove;

  // The attempt identity belongs to the review step, which mints one per intent and reuses it when a
  // replay of the same work is asked for. This control records what was sent so the receipt survives
  // the re-read, and never mints an identity of its own.
  const submitDuplicate = useCallback<MutationSubmit<DuplicateSectionPayload>>(
    async (attempt) => {
      setSubmittedDuplicate({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      return duplicate.mutateAsync({ ...attempt, documentId });
    },
    [duplicate, documentId],
  );
  const submitRemove = useCallback<MutationSubmit<RemoveSectionPayload>>(
    async (attempt) => {
      setSubmittedRemove({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      return remove.mutateAsync({ ...attempt, documentId });
    },
    [remove, documentId],
  );
  const settle = useCallback((outcome: Outcome): void => {
    setSettled(outcome);
  }, []);
  // Choosing a change begins a new attempt: the previous receipt and the input it held are dropped, so
  // the next intent is judged on the live revision rather than on what a settled attempt saw.
  const choose = useCallback((action: ChosenAction): void => {
    setChosen(action);
    setSettled(null);
    setSubmittedDuplicate(null);
    setSubmittedRemove(null);
  }, []);
  const close = useCallback((): void => {
    setChosen(null);
  }, []);
  const duplicateNow = useCallback((): void => {
    choose("duplicate");
  }, [choose]);
  const removeNow = useCallback((): void => {
    choose("remove");
  }, [choose]);

  const locked = managed === true;
  const actionsDisabled = locked || disabled;
  // No wording in the family's copy module states why a caller withholds both changes, so a caller's
  // own refusal is carried by the control's disabled state alone rather than by an invented sentence.
  const reason = locked ? copy.lockReasons.reasons[MANAGED_SECTION_REASON] : null;
  const describedBy = reason === null ? undefined : reasonId;
  const sourcePosition = statedPosition(index);
  const duplicateAtIndex = copyPosition(index, count);
  // The row returns once an attempt stands, so a worker can start a further change; it stays hidden
  // while a review or a refused attempt is open, where the review's own Cancel is the way back.
  const showRow = chosen === null || kept;
  const label = <bdi className={LABEL_CLASS}>{sectionLabel}</bdi>;

  return (
    <div data-slot="section-actions" data-section-id={sectionId} data-managed={locked ? "true" : "false"} className={cn(ROOT_CLASS, className)}>
      {showRow ? (
        // A source-managed section keeps both controls present and disabled with its reason attached,
        // rather than dropping them: an affordance that disappeared would leave a worker unable to tell
        // a managed section from one whose actions have not loaded. The service refuses the change too.
        <div className={ROW_CLASS}>
          <Button type="button" variant="outline" size="sm" disabled={actionsDisabled} aria-describedby={describedBy} onClick={duplicateNow}>
            {copy.builder.duplicate}
            <span className="sr-only">
              {" for "}
              <bdi>{sectionLabel}</bdi>
            </span>
          </Button>
          <Button type="button" variant="destructive" size="sm" disabled={actionsDisabled} aria-describedby={describedBy} onClick={removeNow}>
            {copy.builder.remove}
            <span className="sr-only">
              {" for "}
              <bdi>{sectionLabel}</bdi>
            </span>
          </Button>
        </div>
      ) : null}
      {reason === null ? null : (
        // The reason is stated in place rather than announced: an alert role here would interrupt a
        // reader as the outline renders every managed section beside it.
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
              <p className={cn(SENTENCE_CLASS, "flex min-w-0 flex-wrap items-baseline gap-x-1.5")}>
                {label}
                {sourcePosition === null ? null : <span className={POSITION_CLASS}>{copy.builder.positionOption(sourcePosition)}</span>}
              </p>
              <p className={SENTENCE_CLASS}>{copy.sectionActions.duplicateReview}</p>
              {/* The copy's position is stated with the family's position wording; no key names the
                  copy's own place, so the sentence above carries that meaning rather than a new label. */}
              {duplicateAtIndex === null ? null : <p className={POSITION_CLASS}>{copy.builder.positionOption(duplicateAtIndex)}</p>}
            </div>
          }
          confirmLabel={copy.sectionActions.confirmDuplicate}
          input={duplicateInput}
          submit={submitDuplicate}
          onSettled={settle}
          onCancel={close}
        />
      ) : null}
      {chosen === "remove" ? (
        // The receipt renders in place. An accepted removal takes this section out of the outline, so a
        // later re-read may drop the row this receipt sits in: the refused and uncertain outcomes — the
        // ones a worker has to act on — keep it, and the outline states the standing removal in the
        // family's own result wording.
        <ActionReview<RemoveSectionPayload>
          title={copy.builder.removeHeading}
          headingLevel={REVIEW_HEADING_LEVEL}
          consequential
          description={
            <div className={REVIEW_BODY_CLASS}>
              <p className={cn(SENTENCE_CLASS, "flex min-w-0 flex-wrap items-baseline gap-x-1.5")}>
                {label}
                {sourcePosition === null ? null : <span className={POSITION_CLASS}>{copy.builder.positionOption(sourcePosition)}</span>}
              </p>
              <p className={SENTENCE_CLASS}>{copy.sectionActions.removeReview}</p>
            </div>
          }
          consequence={
            <div className={REVIEW_BODY_CLASS}>
              <p className={SENTENCE_CLASS}>{label}</p>
              <p className={SENTENCE_CLASS}>{copy.sectionActions.removeConfirm}</p>
            </div>
          }
          confirmLabel={copy.sectionActions.confirmRemove}
          input={removeInput}
          submit={submitRemove}
          onSettled={settle}
          onCancel={close}
        />
      ) : null}
    </div>
  );
}

export default SectionActions;
