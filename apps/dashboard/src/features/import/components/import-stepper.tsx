"use client";

/**
 * The contact-import journey's step indicator, and the only way back to a step already left.
 *
 * Display only. `current`, `completed` and `onReopen` are the whole contract: the journey owns which
 * step it is on and what reopening means, so this component keeps no state, mints no id, reads no
 * clock and performs no navigation of its own. Reopening is offered only for a step whose entered
 * work still exists, because returning to an earlier step must never cost the worker what they had
 * already entered (WCAG 3.3.7, Redundant Entry).
 *
 * Every word is the copy module's: the titles and their order come from `STEPS`, the sentence heard
 * when the journey moves from `stepAnnouncement`, and the promise a revisit keeps from each step's
 * own `reopenLabel`. No title is re-typed and no step is numbered by hand — the 1-based position is
 * derived from `STEPS`, so the order a worker reads and the number a screen reader hears cannot
 * disagree.
 *
 * Announcement and list structure carry the position, because the bar is hidden from assistive
 * technology: the steps stay a real ordered list — the flexible layout keeps each `<li>`'s own list
 * semantics, so no explicit role is added — and the one polite region speaks the position and the
 * name together.
 *
 * The current step is plain text carrying the current-step ARIA state and a visible "(current step)"
 * note, so its place survives without a tone; a step not yet reached is plain, non-focusable text
 * rather than a control that pretends to be unavailable. A revisit is a real button — never the list
 * item itself, never a drag or a swipe — whose accessible name is the step's `reopenLabel`, which
 * begins with the visible title, so the label a worker reads is contained in the name they hear
 * (WCAG 2.5.3). Activating one removes that control from the DOM, so focus after the change is the
 * journey's to place: it moves focus to the reopened step's own heading, which is content this
 * component never renders.
 */

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import { STEPS, stepAnnouncement, type ImportStepId } from "../copy";

/** Props of {@link ImportStepper}. Declared here: the journey is the only caller that binds them. */
type ImportStepperProps = {
  /** The step the journey is on. It is read as the position, and never rendered as a revisit control. */
  readonly current: ImportStepId;
  /** The steps whose entered work still exists, so reopening one loses nothing. */
  readonly completed: readonly ImportStepId[];
  /** Called with a step to reopen; the journey restores the work that step had already entered. */
  readonly onReopen: (step: ImportStepId) => void;
};

export default function ImportStepper({ current, completed, onReopen }: ImportStepperProps) {
  /**
   * The current step's position, from the one declaration of the journey's order. `ImportStepId` is
   * closed and `STEPS` lists every member, so a miss here means the journey and this list disagree;
   * the guard then keeps the indicator on the first step rather than reporting no progress at all.
   */
  const foundPosition = STEPS.findIndex((step) => step.id === current);
  const currentPosition = foundPosition === -1 ? 0 : foundPosition;

  return (
    <div className="flex flex-col gap-3">
      <Progress value={currentPosition + 1} max={STEPS.length} aria-hidden="true" />
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {stepAnnouncement(current)}
      </p>
      <ol className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
        {STEPS.map((step, position) => {
          const isCurrent = position === currentPosition;
          const isCompleted = !isCurrent && completed.includes(step.id);

          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className="flex min-w-0 items-baseline gap-1.5"
            >
              <span className="text-muted-foreground tabular-nums">{position + 1}.</span>
              {isCurrent ? (
                <span className="font-semibold">
                  {step.title}
                  <span className="font-normal text-muted-foreground"> (current step)</span>
                </span>
              ) : isCompleted ? (
                /* The design system's button is a single-line pill and this label is a step title, so
                 * at a phone width, or at 200% zoom on one, the label wraps inside the control rather
                 * than painting past its inline edge. The tone, radius and focus ring are unchanged and
                 * the height floor keeps the target above 24x24 CSS px (WCAG 2.5.8).
                 */
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-8 max-w-full shrink whitespace-normal py-1.5 underline underline-offset-4"
                  aria-label={step.reopenLabel}
                  onClick={() => onReopen(step.id)}
                >
                  {step.title}
                </Button>
              ) : (
                <span className="text-muted-foreground">{step.title}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
