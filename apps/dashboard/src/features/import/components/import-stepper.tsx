"use client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { STEPS, stepAnnouncement, type ImportStepId } from "../copy";
type ImportStepperProps = { readonly current: ImportStepId; readonly completed: readonly ImportStepId[]; readonly onReopen: (step: ImportStepId) => void };
export default function ImportStepper({ current, completed, onReopen }: ImportStepperProps) {
  const foundPosition = STEPS.findIndex((step) => step.id === current);
  const currentPosition = foundPosition === -1 ? 0 : foundPosition;
  return (
    <div className="flex flex-col gap-3">
      <Progress value={currentPosition + 1} max={STEPS.length} aria-valuetext={stepAnnouncement(current)} />
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {stepAnnouncement(current)}
      </p>
      <ol className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
        {STEPS.map((step, position) => {
          const isCurrent = position === currentPosition;
          return (
            <li key={step.id} aria-current={isCurrent ? "step" : undefined} className="flex min-w-0 items-baseline gap-1.5">
              <span className="text-muted-foreground tabular-nums">{position + 1}.</span>
              {isCurrent ? (
                <span className="font-semibold">
                  {step.title}
                  <span className="font-normal text-muted-foreground"> (current step)</span>
                </span>
              ) : !isCurrent && completed.includes(step.id) ? (
                <Button type="button" variant="ghost" size="sm" className="h-auto min-h-8 max-w-full shrink whitespace-normal py-1.5 underline underline-offset-4" aria-label={step.reopenLabel} onClick={() => onReopen(step.id)}>
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
