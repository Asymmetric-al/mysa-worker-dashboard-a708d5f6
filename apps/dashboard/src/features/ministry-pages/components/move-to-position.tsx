"use client";
import { useId, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { copy } from "../copy";
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
function unusableReason(callerDisabled: boolean, callerReason: string | undefined, hasOtherPosition: boolean): string | null {
  if (callerDisabled) return callerReason !== undefined && callerReason.length > 0 ? callerReason : "The order of this edition cannot be changed right now.";
  return hasOtherPosition ? null : "This edition holds no other position to move this section to.";
}
export function MoveToPosition({ sectionId, sectionLabel, index, count, disabled, disabledReason, onMove, className }: MoveToPositionProps): ReactElement {
  const reasonId = useId();
  const positionCount = Number.isInteger(count) && count > 0 ? count : 0;
  const offersAnotherPosition = positionCount > 1;
  // An index outside the edition marks nothing as current. The caller read that position and this control never corrects or approximates it, so no item is disabled rather than the wrong one.
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
            {" for "}
            <bdi>{sectionLabel}</bdi>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {positions.map((position) => {
            const isCurrent = position === currentPosition;
            const optionLabel = copy.builder.positionOption(position + 1);
            return (
              <DropdownMenuItem
                key={position}
                label={isCurrent ? `${optionLabel}, ${CURRENT_POSITION_LABEL}` : optionLabel}
                disabled={isCurrent}
                className="justify-between"
                onClick={() => {
                  if (isCurrent) return;
                  onMove(position);
                }}
              >
                <span>{optionLabel}</span>
                {isCurrent ? (
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
