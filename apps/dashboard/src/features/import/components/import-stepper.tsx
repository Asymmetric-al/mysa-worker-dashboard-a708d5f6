"use client";
import { CheckIcon } from "lucide-react";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import { STEPS, stepAnnouncement, type ImportStepId } from "../copy";

/** Connected multi-step indicator modeled after ReUI Stepper (`@reui/stepper`) and framed in Maia Zinc. */
export default function ImportStepper({ current, completed, onReopen }: { readonly current: ImportStepId; readonly completed: readonly ImportStepId[]; readonly onReopen: (step: ImportStepId) => void }) {
  const foundPosition = STEPS.findIndex((step) => step.id === current);
  const currentPosition = foundPosition === -1 ? 0 : foundPosition;
  return (
    <Frame spacing="sm">
      <FramePanel className="flex flex-col gap-3.5">
        <Progress value={currentPosition + 1} max={STEPS.length} aria-valuetext={stepAnnouncement(current)} />
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {stepAnnouncement(current)}
        </p>
        <ol data-slot="import-stepper-list" className="grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2 lg:flex lg:items-center lg:gap-0">
          {STEPS.map((step, position) => {
            const isCurrent = position === currentPosition;
            const isCompleted = !isCurrent && completed.includes(step.id);
            const isLast = position === STEPS.length - 1;
            const connectorDone = isCompleted || position < currentPosition;
            return (
              <li
                key={step.id}
                aria-current={isCurrent ? "step" : undefined}
                data-step-state={isCurrent ? "current" : isCompleted ? "completed" : "upcoming"}
                className={cn("flex min-w-0 items-center gap-2", !isLast && "lg:flex-1")}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-figures transition-colors",
                    isCurrent
                      ? "border-primary bg-primary text-primary-foreground shadow-xs ring-2 ring-primary/20"
                      : isCompleted
                        ? "border-positive/40 bg-positive-soft text-foreground"
                        : "border-border bg-surface-subtle text-muted-foreground",
                  )}
                >
                  {isCompleted ? <CheckIcon className="size-3.5" /> : position + 1}
                </span>
                <span className="sr-only">{`${position + 1}. `}</span>
                {isCurrent ? (
                  <span className="truncate font-semibold text-foreground">
                    {step.title}
                    <span className="font-normal text-muted-foreground"> (current step)</span>
                  </span>
                ) : isCompleted ? (
                  <Button type="button" variant="ghost" size="sm" className={`${BUTTON_WRAP_CLASS} shrink px-1.5 underline underline-offset-4`} aria-label={step.reopenLabel} onClick={() => onReopen(step.id)}>
                    {step.title}
                  </Button>
                ) : (
                  <span className="truncate text-muted-foreground">{step.title}</span>
                )}
                {isLast ? null : (
                  <span
                    aria-hidden="true"
                    className={cn("mx-2 hidden h-px min-w-4 flex-1 transition-colors lg:block", connectorDone ? "bg-positive/50" : "bg-border")}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </FramePanel>
    </Frame>
  );
}
