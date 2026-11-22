"use client";
/**
 * The one control that records how the edition being submitted is to be released: publish only, or publish and notify
 * now.
 *
 * Where it belongs. A submission freezes the exact revision and records the release mode with it, and the review record
 * keeps that mode: the reviewer who answers the candidate can release the edition in that mode and in no other, because
 * `publishVariants` refuses a mode the submission never asked for. So the choice is the author's, it is made here, at the
 * one moment the submission is confirmed, and both places an author submits a revision render this same control rather
 * than two copies of it.
 *
 * What it does not own. It states no lifecycle word, records nothing and sends nothing: the submission that carries the
 * chosen mode is the caller's, and publication, provider acceptance, delivery and reading stay four separate outcomes
 * that submitting does not reach. The words of both options are the family's own — `PUBLISH_MODE_LABELS` — so a renamed
 * mode fails this file's compilation instead of leaving a label behind.
 *
 * Which vocabulary it speaks. A submission records the release mode in the store's own words (`publish-and-notify`), the
 * same pair the review record keeps and the release schema refuses a mode outside of; the labels are the family's single
 * set of sentences, mapped here so the control and the release review describe one mode with one wording.
 */
import { useId, type ReactElement } from "react";
import { FormFieldGroup } from "@/components/form-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import { PUBLISH_MODE_LABELS, SUBMISSION_RELEASE_MODE } from "../copy/updates-copy";
import { SUBMISSION_NOTIFY_MODES, type SubmissionNotifyMode } from "../schemas/draft";

/** The family's own words for each mode a submission records: the release review's sentence for "notify now" is the same one, so one copy serves both surfaces. */
const MODE_COPY: Readonly<Record<SubmissionNotifyMode, (typeof PUBLISH_MODE_LABELS)[keyof typeof PUBLISH_MODE_LABELS]>> = { "publish-only": PUBLISH_MODE_LABELS["publish-only"], "publish-and-notify": PUBLISH_MODE_LABELS["publish-and-notify-now"] };

/**
 * The mode a submission records until its author chooses otherwise. Publishing only sends nothing, so a notice is never
 * the answer someone gave by not answering: choosing to notify is a deliberate act and never a default.
 */
export const DEFAULT_SUBMISSION_RELEASE_MODE: SubmissionNotifyMode = "publish-only";

export interface SubmissionReleaseModeProps {
  /** The mode this submission records, chosen by the author of the revision being frozen. */
  readonly value: SubmissionNotifyMode;
  readonly onChange: (mode: SubmissionNotifyMode) => void;
  readonly className?: string;
}

/** Whether a control's own report is one of the two modes, rather than a value this surface would have to interpret. */
function isSubmissionNotifyMode(value: unknown): value is SubmissionNotifyMode {
  return SUBMISSION_NOTIFY_MODES.some((mode) => mode === value);
}

/** The author's release choice for one submission, as a labelled group of two options with each one's consequence stated. */
export function SubmissionReleaseMode({ value, onChange, className }: SubmissionReleaseModeProps): ReactElement {
  const idPrefix = useId();
  const choose = (next: unknown): void => {
    if (!isSubmissionNotifyMode(next) || next === value) return;
    onChange(next);
  };
  return (
    // No required marker: the group always holds a value because publish-only starts selected, so the marker would state a requirement its author cannot fail to meet; the schema still requires the field on every submission.
    <FormFieldGroup legend={SUBMISSION_RELEASE_MODE.legend} name="submission-release-mode" description={SUBMISSION_RELEASE_MODE.description} className={cn("text-foreground", className)}>
      {({ describedBy, invalid, legendId }) => (
        <RadioGroup value={value} onValueChange={choose} aria-labelledby={legendId} aria-describedby={describedBy} aria-invalid={invalid} data-slot="submission-release-mode" data-mode={value}>
          {SUBMISSION_NOTIFY_MODES.map((mode) => {
            const wording = MODE_COPY[mode];
            const optionId = `${idPrefix}-mode-${mode}`;
            const consequenceId = `${optionId}-consequence`;
            return (
              <label key={mode} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                <RadioGroupItem id={optionId} value={mode} aria-label={wording.label} aria-describedby={consequenceId} className="mt-0.5" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{wording.label}</span>
                  <span id={consequenceId} className="text-sm text-muted-foreground text-pretty">
                    {wording.consequence}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>
      )}
    </FormFieldGroup>
  );
}

export default SubmissionReleaseMode;
