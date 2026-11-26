"use client";
import { useId, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { copy } from "../copy";
export type MoveToPositionProps = {
  readonly controlId: string;
  readonly sectionId: string;
  readonly sectionLabel: string;
  readonly index: number;
  readonly count: number;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly busy?: boolean;
  readonly onMove: (toIndex: number) => void;
  readonly className?: string;
};
const CURRENT_POSITION_LABEL = "Current position";
function unusableReason(callerDisabled: boolean, callerReason: string | undefined, hasOtherPosition: boolean): string | null {
  return callerDisabled ? (callerReason !== undefined && callerReason.length > 0 ? callerReason : "Section order can’t be changed right now.") : hasOtherPosition ? null : "Add another section to reorder.";
}
export function MoveToPosition({ controlId, sectionId, sectionLabel, index, count, disabled, disabledReason, busy = false, onMove, className }: MoveToPositionProps): ReactElement {
  const reasonId = useId();
  const positionCount = Number.isInteger(count) && count > 0 ? count : 0;
  const offersAnotherPosition = positionCount > 1;
  const reason = unusableReason(disabled === true, disabledReason?.trim(), offersAnotherPosition);
  return (
    <div data-section-id={sectionId} className={cn("flex flex-col items-start gap-1", className)}>
      <DropdownMenu>
        {/* A request in flight is stated as `aria-disabled` rather than `disabled`, so the trigger keeps the person's focus; a press during it is answered by the outline's own guard. */}
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" id={controlId} />} disabled={disabled === true || !offersAnotherPosition} aria-disabled={busy ? true : undefined} aria-describedby={reason === null ? undefined : reasonId}>
          {copy.builder.moveToPosition}
          <span className="sr-only">
            {" for "}
            <bdi>{sectionLabel}</bdi>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {Array.from({ length: positionCount }, (_, position) => position).map((position) => {
            const isCurrent = position === (Number.isInteger(index) && index >= 0 && index < positionCount ? index : null);
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
      {reason === null ? null : <span {...{ id: reasonId, className: "text-xs text-muted-foreground" as const }}>{reason}</span>}
    </div>
  );
}
export default MoveToPosition;
