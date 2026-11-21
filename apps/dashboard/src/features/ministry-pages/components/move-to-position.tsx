"use client";

/**
 * Where a section sits in this draft edition, and the one way to change it without carrying anything
 * across the screen: a labelled menu of the positions the edition offers.
 *
 * The single-pointer alternative WCAG 2.5.7 requires. Dragging a section is not implemented anywhere
 * in the builder, so this menu and the Move up / Move down buttons are the whole of reordering, and
 * all three produce the same intent: the section's identity and the position it should take. This
 * control only emits that intent — `onMove(toIndex)` — and the caller (`section-outline.tsx`) owns
 * the call, the revision it is checked against and the record of the attempt. There is no mutation
 * here, no query cache key, no store and no clock, so the family keeps one reorder call site.
 *
 * Position numbering, which is the thing most easily got wrong in both directions:
 *
 * - `index` and the emitted `toIndex` are 0-based, because that is what a section's place in the
 *   edition's array is.
 * - Every number a person reads is 1-based, because "Position 0" is not a position anyone counts to.
 *   `copy.builder.positionOption(position + 1)` does that conversion once, for the label of each item.
 * - `count` already includes the section being moved, so the menu offers `count` positions, not
 *   `count + 1`. An extra position would name a slot the edition does not have and the service would
 *   refuse it.
 *
 * The item for the section's own position is disabled rather than omitted or absorbed: a reader can
 * see that the position exists and why it is not offered, and this control cannot submit a move that
 * changes nothing. Nothing is announced by this file — the live region that reports a completed move
 * belongs to the surface that hosts the outline, so a keyboard user hears one sentence per move.
 *
 * It is a `<DropdownMenu>` of the installed design system, so opening, arrow-key movement, typeahead,
 * Escape and the return of focus to the trigger come from the primitive instead of being re-implemented
 * here (Rule 1 clause 2: reuse the specified pattern, add no second menu). The trigger is the installed
 * `Button`, whose 32 CSS px height clears the 24 px target floor of WCAG 2.5.8 (measured in the browser
 * harness at 32 × 147 px) and whose focus treatment — dimensions, ring token, focus-visible styling —
 * comes from the design system rather than being restated here. The popup is portalled, anchored and
 * clamped to the viewport by the primitive, so it opens inside a 320 CSS px screen without the page
 * scrolling sideways and cannot be positioned over the trigger that opened it (2.4.11).
 *
 * Wording: the family's sentences live in `../copy`. `copy.builder.moveToPosition` names the control
 * and `copy.builder.positionOption` names each position. Three short sentences belong to this control
 * instead, because no copy module words them: the marker that says an item is where the section already
 * sits, the reason shown when the edition has nowhere else to put it, and the reason shown when a
 * caller disables the control without saying why. Each is declared once below and none restates a
 * family phrase.
 *
 * Direction is a property of the content, so no `dir` is written here and every spacing utility is
 * logical (`ms-*`, `ps-*`, `text-start`). The section label is isolated in `<bdi>`, because a section
 * title may be in another script than the interface and an unisolated mixed-direction name would
 * reorder against the words around it.
 */

import { useId, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

import { copy } from "../copy";

/** Props of {@link MoveToPosition}. */
export interface MoveToPositionProps {
  /**
   * The section this control moves, as the outline names it. It is the identity the emitted intent
   * belongs to, and it is rendered as `data-section-id` so a row and its control stay identifiable
   * side by side in the outline and in a browser test.
   */
  readonly sectionId: string;

  /**
   * The section's own title, shown to a person and used to make this control's accessible name
   * unique among the outline's rows. Never parsed, compared or joined on.
   */
  readonly sectionLabel: string;

  /** The section's current place in the edition, 0-based. */
  readonly index: number;

  /** How many sections the edition has, including this one, so the last valid position is `count - 1`. */
  readonly count: number;

  /**
   * Whether the caller has decided the order cannot be changed from here — a locked expansion, a
   * stale outline, a released edition being reviewed. The control states why instead of going inert.
   */
  readonly disabled?: boolean;

  /**
   * Why the order cannot be changed, in the caller's words. Shown beside the control and attached to
   * it with `aria-describedby`, so the reason reaches a screen reader as a description rather than
   * only as a hover tooltip.
   */
  readonly disabledReason?: string;

  /**
   * Emits the destination position, 0-based, for the section named by `sectionId`. The caller turns
   * that into the reorder request; this control never sends it and never records an attempt.
   */
  readonly onMove: (toIndex: number) => void;

  /** Layout classes for the block this control occupies. Never a colour, radius, shadow or font. */
  readonly className?: string;
}

/**
 * The marker on the item that is where the section already sits.
 *
 * This surface's own word, not a family phrase: the copy module names the control and each position,
 * and no key describes the position a section already occupies. It is visible text rather than a tone
 * or an icon, so the disabled item says what it is without relying on colour.
 */
const CURRENT_POSITION_LABEL = "Current position";

/**
 * What a disabled control says when the caller gives no reason.
 *
 * A control that goes silently inert is the failure this sentence exists to prevent: the reader is
 * told the order cannot be changed here, without inventing a cause the caller never supplied.
 */
const UNSTATED_DISABLED_REASON = "The order of this edition cannot be changed right now.";

/**
 * What the control says when the edition holds no other position to move this section to.
 *
 * One section is a real state rather than an empty menu: the trigger stays in place, disabled, and
 * says why, so the reader is never shown a menu with nothing in it.
 */
const NO_OTHER_POSITION_REASON = "This edition holds no other position to move this section to.";

/**
 * Why the control cannot be used, or `null` when it can.
 *
 * Three different facts reach this sentence and none borrows another's words: the caller's own
 * reason for a locked or stale outline, the absence of a second position in the edition, and a caller
 * that disabled the control without saying why — which still gets a sentence, because a control that
 * goes silently inert is exactly what this file refuses to render.
 */
function unusableReason(
  callerDisabled: boolean,
  callerReason: string | undefined,
  hasOtherPosition: boolean,
): string | null {
  if (callerDisabled) {
    return callerReason !== undefined && callerReason.length > 0
      ? callerReason
      : UNSTATED_DISABLED_REASON;
  }
  return hasOtherPosition ? null : NO_OTHER_POSITION_REASON;
}

/**
 * The "Move to a position" control for one section of a draft edition.
 *
 * Renders a menu of every position the edition offers, disables the one the section already holds,
 * and emits the chosen position to the caller. It holds no open state of its own: the primitive keeps
 * it, which keeps the outline from having to know a menu exists.
 */
export function MoveToPosition({
  sectionId,
  sectionLabel,
  index,
  count,
  disabled,
  disabledReason,
  onMove,
  className,
}: MoveToPositionProps): ReactElement {
  // Unconditional, so the description the trigger points at survives every branch below.
  const reasonId = useId();

  // A count that is not a usable number offers no position at all rather than a guessed one: the
  // caller supplies the edition's real length, and the sentence below is the honest result of not
  // having it.
  const positionCount = Number.isInteger(count) && count > 0 ? count : 0;
  const offersAnotherPosition = positionCount > 1;

  // An index outside the edition marks nothing as current. The caller read that position and this
  // control never corrects or approximates it, so no item is disabled rather than the wrong one.
  const currentPosition =
    Number.isInteger(index) && index >= 0 && index < positionCount ? index : null;

  const isDisabled = disabled === true || !offersAnotherPosition;
  const reason = unusableReason(disabled === true, disabledReason?.trim(), offersAnotherPosition);

  const positions = Array.from({ length: positionCount }, (_, position) => position);

  return (
    <div data-section-id={sectionId} className={cn("flex flex-col items-start gap-1", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" />}
          disabled={isDisabled}
          aria-describedby={reason === null ? undefined : reasonId}
        >
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
