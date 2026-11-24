"use client";
/** The one control that records how a submission is to be released: publish only, or publish and notify now. */ import { useId, type ReactElement } from "react";
import { FormFieldGroup } from "@/components/form-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import { PUBLISH_MODE_LABELS, SUBMISSION_RELEASE_MODE } from "../copy/updates-copy";
import { SUBMISSION_NOTIFY_MODES, type SubmissionNotifyMode } from "../schemas";
/** The family's own words for each mode a submission records: `notify-now` is the release review's spelling of the store's `notify`, so one copy serves both surfaces. */
const MODE_COPY: Readonly<Record<SubmissionNotifyMode, { readonly label: string; readonly consequence: string }>> = { "publish-only": PUBLISH_MODE_LABELS["publish-only"], "publish-and-notify": PUBLISH_MODE_LABELS["publish-and-notify-now"] };
/** The mode a submission records until its author chooses otherwise: publishing only sends nothing, so a notice is never the answer someone gave by not answering. */ export const DEFAULT_SUBMISSION_RELEASE_MODE: SubmissionNotifyMode = "publish-only";
/** The two values this control takes: the mode a submission records, and the one callback that changes it. */ export type SubmissionReleaseModeProps = { readonly value: SubmissionNotifyMode; readonly onChange: (mode: SubmissionNotifyMode) => void; readonly className?: string };
/** The author's release choice for one submission, as a labelled group of two options with each one's consequence stated. */ export function SubmissionReleaseMode({ value, onChange, className }: SubmissionReleaseModeProps): ReactElement {
  const idPrefix = useId();
  // A control's own report is judged against the closed pair rather than trusted: a value this surface does not speak is not a choice it can record.
  const choose = (next: unknown): void => {
    const admitted = SUBMISSION_NOTIFY_MODES.find((mode) => mode === next);
    if (admitted === undefined || admitted === value) return;
    onChange(admitted);
  };
  return (
    // No required marker: the group always holds a value because publish-only starts selected, so the marker would state a requirement its author cannot fail to meet.
    <FormFieldGroup legend={SUBMISSION_RELEASE_MODE.legend} name="submission-release-mode" description={SUBMISSION_RELEASE_MODE.description} className={cn("text-foreground", className)}>
      {({ describedBy, invalid, legendId }) => (
        <RadioGroup value={value} onValueChange={choose} aria-labelledby={legendId} aria-describedby={describedBy} aria-invalid={invalid} data-slot="submission-release-mode" data-mode={value}>
          {SUBMISSION_NOTIFY_MODES.map((mode) => (
            <label key={mode} htmlFor={`${idPrefix}-mode-${mode}`} className="flex min-h-target items-start gap-3 py-1">
              <RadioGroupItem id={`${idPrefix}-mode-${mode}`} value={mode} aria-label={MODE_COPY[mode].label} aria-describedby={`${idPrefix}-mode-${mode}-consequence`} className="mt-0.5" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{MODE_COPY[mode].label}</span>
                <span id={`${idPrefix}-mode-${mode}-consequence`} className="text-sm text-muted-foreground text-pretty">
                  {MODE_COPY[mode].consequence}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      )}
    </FormFieldGroup>
  );
}
export default SubmissionReleaseMode;
