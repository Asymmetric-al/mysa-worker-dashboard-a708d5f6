"use client";
import type { ReactElement } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
/** One admitted choice: the label the option states, and the hint that says what choosing it means. */ export type ChoiceWording = { readonly label: string; readonly hint: string };
/** The frame a {@link FormFieldGroup} hands the group it frames, so the legend, the description and the refusal are the field's own. */ export type ChoiceGroupFrame = { readonly legendId: string; readonly describedBy: string | undefined; readonly invalid: boolean; readonly required?: boolean };
export type ChoiceGroupProps<T extends string> = {
  readonly frame: ChoiceGroupFrame;
  readonly value: T | null;
  readonly choices: readonly T[];
  readonly wording: Readonly<Record<T, ChoiceWording>>;
  readonly idPrefix: string;
  readonly onChange: (next: T) => void;
  readonly horizontal?: boolean;
  readonly disabled?: boolean;
};
/** The one bounded-choice group: each option states its label, its hint and the ids its description is read through, so a closed set of choices is written once rather than per surface. */
export function ChoiceGroup<T extends string>({ frame, value, choices, wording, idPrefix, onChange, horizontal = false, disabled = false }: ChoiceGroupProps<T>): ReactElement {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        const chosen = choices.find((choice) => choice === next);
        if (chosen !== undefined) onChange(chosen);
      }}
      aria-labelledby={frame.legendId}
      aria-describedby={frame.describedBy}
      aria-invalid={frame.invalid ? true : undefined}
      aria-required={frame.required === true ? true : undefined}
      disabled={disabled}
      {...(horizontal ? { orientation: "horizontal" as const } : {})}
    >
      {choices.map((choice) => {
        const optionId = `${idPrefix}-${choice}`;
        const hintId = `${optionId}-hint`;
        return (
          <label key={choice} htmlFor={optionId} className="flex min-h-target min-w-0 items-start gap-3 py-1">
            <RadioGroupItem id={optionId} value={choice} aria-label={wording[choice].label} aria-describedby={hintId} className="mt-0.5" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{wording[choice].label}</span>
              <span id={hintId} className="text-sm text-pretty text-muted-foreground">
                {wording[choice].hint}
              </span>
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
export default ChoiceGroup;
