"use client";
import type { ReactElement } from "react";
import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
export type BoundField = { readonly state: { readonly value: string }; handleChange(value: string): void; handleBlur(): void };
export type BoundControlMarkers = { readonly describedBy: string | undefined; readonly invalid: boolean; readonly required: boolean };
/** The three accessible markers every labelled control takes from the field or group that owns it, so one binding serves them all. */
export const controlAria = (control: BoundControlMarkers): { "aria-describedby": string | undefined; "aria-invalid": true | undefined; "aria-required": true | undefined } => ({
  "aria-describedby": control.describedBy,
  "aria-invalid": control.invalid ? true : undefined,
  "aria-required": control.required ? true : undefined,
});
export interface BoundEntryProps {
  readonly field: BoundField;
  readonly name: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly error?: readonly string[] | undefined;
  readonly required?: boolean;
  readonly optionalHint?: boolean;
  readonly onEdit?: (() => void) | undefined;
  readonly className?: string | undefined;
}
/** One single-line entry bound to its own field: the caller states the type, and the field states the value and the refusal. */
export function TextField({ field, name, label, description, error, required = false, optionalHint = false, onEdit, className, type = "text" }: BoundEntryProps & { readonly type?: "text" | "date" }): ReactElement {
  return (
    <FormField name={name} label={label} description={description} error={error} required={required} optionalHint={optionalHint}>
      {(control) => (
        <Input
          id={control.id}
          type={type}
          value={field.state.value}
          autoComplete="off"
          {...controlAria(control)}
          onChange={(event) => {
            field.handleChange(event.currentTarget.value);
            onEdit?.();
          }}
          onBlur={field.handleBlur}
          className={className}
        />
      )}
    </FormField>
  );
}
/** One multi-line entry bound to its own field, for the sentences a worker writes rather than types. */
export function TextAreaField({ field, name, label, description, error, required = false, optionalHint = false, onEdit, className, rows }: BoundEntryProps & { readonly rows: number }): ReactElement {
  return (
    <FormField name={name} label={label} description={description} error={error} required={required} optionalHint={optionalHint}>
      {(control) => (
        <Textarea
          id={control.id}
          rows={rows}
          value={field.state.value}
          {...controlAria(control)}
          onChange={(event) => {
            field.handleChange(event.currentTarget.value);
            onEdit?.();
          }}
          onBlur={field.handleBlur}
          className={className}
        />
      )}
    </FormField>
  );
}
