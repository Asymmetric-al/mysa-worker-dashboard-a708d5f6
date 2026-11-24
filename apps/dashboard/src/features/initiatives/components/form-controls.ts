"use client";
import type { ChangeEvent } from "react";
import type { FormFieldControl } from "@/components/form-field";
/** The field API every control in this family reads: the text it holds, its change handler and its blur handler. */ export type TextFieldApi = { readonly state: { readonly value: string }; readonly handleChange: (value: string) => void; readonly handleBlur: () => void };
/** The value, the handlers and the aria wiring one control carries, so a field states them once instead of restating them at every control it renders. */ export function valuePropsOf(field: TextFieldApi, control: FormFieldControl) {
  return { id: control.id, value: field.state.value, "aria-describedby": control.describedBy, "aria-invalid": control.invalid ? true : undefined, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => field.handleChange(event.currentTarget.value), onBlur: field.handleBlur };
}
