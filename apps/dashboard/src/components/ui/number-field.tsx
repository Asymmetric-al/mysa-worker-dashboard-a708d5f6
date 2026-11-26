"use client";
import * as React from "react";
import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { MinusIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type SteppedNumberFieldProps = {
  readonly id?: string;
  readonly name?: string;
  readonly value: string;
  readonly onValueChange: (nextText: string) => void;
  readonly onBlur?: () => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: boolean;
  readonly "aria-required"?: boolean;
  readonly decrementLabel?: string;
  readonly incrementLabel?: string;
  readonly className?: string;
};

/**
 * Base UI `@base-ui/react/number-field` stepped numeric input styled for Maia Zinc.
 * Preserves raw typed text so invalid/empty entries can be explicitly refused by domain validation rather than silently coerced.
 */
export function SteppedNumberField({
  id,
  name,
  value,
  onValueChange,
  onBlur,
  min = 1,
  max,
  step = 1,
  required,
  disabled,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
  decrementLabel = "Decrease value",
  incrementLabel = "Increase value",
  className,
}: SteppedNumberFieldProps) {
  const parsed = value.trim() === "" ? null : Number(value.trim());
  const numericValue = parsed !== null && Number.isFinite(parsed) ? parsed : null;

  const stepBy = (delta: number): void => {
    const base = numericValue ?? (min !== undefined ? Math.max(0, min - 1) : 0);
    const candidate = base + delta;
    const boundedMin = min !== undefined ? Math.max(min, candidate) : candidate;
    const bounded = max !== undefined ? Math.min(max, boundedMin) : boundedMin;
    onValueChange(String(bounded));
  };

  return (
    <BaseNumberField.Root
      value={numericValue}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      data-slot="number-field"
      className={cn("inline-flex w-full items-stretch sm:max-w-48", className)}
    >
      <BaseNumberField.Group className="flex w-full items-stretch overflow-hidden rounded-4xl border border-input bg-control-surface shadow-2xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 aria-invalid:border-invalid-border">
        <BaseNumberField.Decrement
          type="button"
          aria-label={decrementLabel}
          disabled={disabled || (min !== undefined && numericValue !== null && numericValue <= min)}
          onClick={(event) => {
            event.preventDefault();
            stepBy(-step);
          }}
          className="inline-flex min-h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center border-e border-border/80 bg-surface-subtle text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
        >
          <MinusIcon aria-hidden="true" className="size-3.5" />
        </BaseNumberField.Decrement>
        <input
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          autoComplete="off"
          required={required}
          disabled={disabled}
          value={value}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-required={ariaRequired}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onBlur={onBlur}
          className="h-9 w-full min-w-0 bg-transparent px-3 text-center text-base tabular-figures text-foreground outline-none md:text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <BaseNumberField.Increment
          type="button"
          aria-label={incrementLabel}
          disabled={disabled || (max !== undefined && numericValue !== null && numericValue >= max)}
          onClick={(event) => {
            event.preventDefault();
            stepBy(step);
          }}
          className="inline-flex min-h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center border-s border-border/80 bg-surface-subtle text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
        >
          <PlusIcon aria-hidden="true" className="size-3.5" />
        </BaseNumberField.Increment>
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  );
}

export default SteppedNumberField;
