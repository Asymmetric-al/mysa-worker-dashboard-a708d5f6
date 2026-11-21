"use client";
/**
 * Where a section sits in this draft edition, and the one way to change it without carrying anything
 * across the screen: a labelled menu of the positions the edition offers.
 */
import { useId, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { copy } from "../copy";
/** Props of {@link MoveToPosition}. */
export interface MoveToPositionProps {
  readonly sectionId: string;
  readonly sectionLabel: string;
  readonly index: number;
  readonly count: number;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onMove: (toIndex: number) => void;
  readonly className?: string;
}
const CURRENT_POSITION_LABEL = "Current position";

const UNSTATED_DISABLED_REASON = "The order of this edition cannot be changed right now.";

const NO_OTHER_POSITION_REASON = "This edition holds no other position to move this section to.";

function unusableReason(callerDisabled: boolean, callerReason: string | undefined, hasOtherPosition: boolean): string | null {
  if (callerDisabled) {
    return callerReason !== undefined && callerReason.length > 0 ? callerReason : UNSTATED_DISABLED_REASON;
  }
  return hasOtherPosition ? null : NO_OTHER_POSITION_REASON;
}
/** The "Move to a position" control for one section of a draft edition. */
export function MoveToPosition({ sectionId, sectionLabel, index, count, disabled, disabledReason, onMove, className }: MoveToPositionProps): ReactElement {
  // Unconditional, so the description the trigger points at survives every branch below.
  const reasonId = useId();
  // A count that is not a usable number offers no position at all rather than a guessed one: the
  // caller supplies the edition's real length, and the sentence below is the honest result of not
  // having it.
  const positionCount = Number.isInteger(count) && count > 0 ? count : 0;
  const offersAnotherPosition = positionCount > 1;
  // An index outside the edition marks nothing as current. The caller read that position and this
  // control never corrects or approximates it, so no item is disabled rather than the wrong one.
  const currentPosition = Number.isInteger(index) && index >= 0 && index < positionCount ? index : null;
  const isDisabled = disabled === true || !offersAnotherPosition;
  const reason = unusableReason(disabled === true, disabledReason?.trim(), offersAnotherPosition);
  const positions = Array.from({ length: positionCount }, (_, position) => position);
  return (
    <div data-section-id={sectionId} className={cn("flex flex-col items-start gap-1", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />} disabled={isDisabled} aria-describedby={reason === null ? undefined : reasonId}>
          {copy.builder.moveToPosition}
          <span className="sr-only">
            {/* `sr-only` positions the span out of flow, so the accessible name inserts a space at
                that boundary; the leading space is written out so the name reads
                "Move to a position for Introduction" with or without that insertion. */}
            {" for "}
            <bdi>{sectionLabel}</bdi>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {positions.map((position) => {
            const isCurrent = position === currentPosition;
            // The one conversion from a 0-based position to the number a person reads.
            const optionLabel = copy.builder.positionOption(position + 1);
            return (
              <DropdownMenuItem
                key={position}
                label={isCurrent ? `${optionLabel}, ${CURRENT_POSITION_LABEL}` : optionLabel}
                disabled={isCurrent}
                className="justify-between"
                onClick={() => {
                  // The current position is rendered disabled precisely so an unchanged move cannot
                  // reach the service; the guard keeps that true even if a future primitive changes
                  // how a disabled item reports a click.
                  if (isCurrent) {
                    return;
                  }
                  onMove(position);
                }}
              >
                <span>{optionLabel}</span>
                {isCurrent ? (
                  // The space is a text node of its own, so the item is announced as
                  // "Position 3 Current position" instead of as one run-on word.
                  <>
                    {" "}
                    <span className="text-xs text-muted-foreground">{CURRENT_POSITION_LABEL}</span>
                  </>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {reason === null ? null : (
        <span id={reasonId} className="text-xs text-muted-foreground">
          {reason}
        </span>
      )}
    </div>
  );
}
export default MoveToPosition;
