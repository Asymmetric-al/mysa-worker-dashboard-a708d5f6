"use client";
import { useEffect, useRef, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import type { ZodError } from "zod";
import FormField, { fieldErrorsFromInvalid, FormFieldGroup, type FieldErrorLookup } from "@/components/form-field";
import OperationResult, { type ReceiptHeadingLevel } from "@/components/operation-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { invalid, UNIDENTIFIED_ATTEMPT, type MutationOutcome } from "@/modules/data-service/outcome"; /** Reads a refusal raised before submission through the one owner of the path-to-message mapping, so no second copy of it lives in a form. */
export const refusalLookupOf = (error: ZodError): FieldErrorLookup => fieldErrorsFromInvalid(invalid({ operationId: UNIDENTIFIED_ATTEMPT, fields: error }));
export type FieldMark = "required" | "optional" | "unmarked";
const messagesOf = (errors: FieldErrorLookup | null, path: string): readonly string[] | undefined => (errors === null ? undefined : errors.byField[path]);
function markup(mark: FieldMark, announcesRequired: boolean, describedBy: string | undefined, invalid: boolean, required: boolean): { readonly "aria-describedby": string | undefined; readonly "aria-invalid": true | undefined; readonly "aria-required": true | undefined } {
  return { "aria-describedby": describedBy, "aria-invalid": invalid ? true : undefined, "aria-required": announcesRequired && mark === "required" && required ? true : undefined };
}
type FieldFrameProps = { readonly name: string; readonly label: string; readonly description?: string; readonly errors: FieldErrorLookup | null; readonly error?: string | readonly string[] | undefined; readonly mark?: FieldMark; readonly announcesRequired?: boolean; readonly className?: string };
export interface FormTextFieldProps extends FieldFrameProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onBlur?: (() => void) | undefined;
  readonly type?: "text" | "date" | "number" | "datetime-local";
  readonly autoComplete?: "off";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly inputMode?: "numeric";
} /** One labelled text, date, number or date-time control, with its description, its own refusal message and its aria wiring. */
export const FormTextField = ({ name, label, description, errors, error, mark = "unmarked", announcesRequired = true, className, value, onValueChange, onBlur, type, autoComplete, min, max, step, inputMode }: FormTextFieldProps): ReactElement => (
  <FormField name={name} label={label} description={description} error={error ?? messagesOf(errors, name)} required={mark === "required"} optionalHint={mark === "optional"}>
    {(control) => {
      const wiring = markup(mark, announcesRequired, control.describedBy, control.invalid, control.required);
      const onChange = (event: ChangeEvent<HTMLInputElement>): void => onValueChange(event.currentTarget.value);
      return <Input id={control.id} name={name} type={type} autoComplete={autoComplete} className={className} required={mark === "required" ? control.required : undefined} min={min} max={max} step={step} inputMode={inputMode} value={value} onChange={onChange} onBlur={onBlur} {...wiring} />;
    }}
  </FormField>
);
export type FormSelectFieldProps = FieldFrameProps & { readonly value: string; readonly onValueChange: (value: string) => void; readonly onBlur?: (() => void) | undefined; readonly children: ReactNode };
export type TextSpec<Name extends string> = Omit<FormTextFieldProps, "errors" | "value" | "onValueChange" | "onBlur" | "name"> & { readonly name: Name; readonly controlName?: string }; /** One text control of a form whose values are all text, bound to the value it shows and the one edit path the form states. */
export function BoundField<Name extends string>({ spec, values, errors, onEdit }: { readonly spec: TextSpec<Name>; readonly values: Readonly<Record<Name, string>>; readonly errors: FieldErrorLookup | null; readonly onEdit: (name: Name, value: string) => void }): ReactElement {
  const { name, controlName = name, ...rest } = spec;
  return <FormTextField {...rest} name={controlName} errors={errors} value={values[name]} onValueChange={(value) => onEdit(name, value)} />;
}
/** One labelled native select, with the options its caller states, its own refusal message and its aria wiring. */
export const FormSelectField = ({ name, label, description, errors, error, mark = "unmarked", announcesRequired = true, className, value, onValueChange, onBlur, children }: FormSelectFieldProps): ReactElement => (
  <FormField name={name} label={label} description={description} error={error ?? messagesOf(errors, name)} required={mark === "required"} optionalHint={mark === "optional"}>
    {(control) => (
      <NativeSelect id={control.id} name={name} className={className} required={mark === "required" ? control.required : undefined} value={value} onChange={(event) => onValueChange(event.currentTarget.value)} onBlur={onBlur} {...markup(mark, announcesRequired, control.describedBy, control.invalid, control.required)}>
        {children}
      </NativeSelect>
    )}
  </FormField>
);
/** The same field frame as {@link FormSelectField}, rendered as the styled Select: a longer closed choice whose trigger states the chosen option's own label. */
export const FormStyledSelectField = ({ name, label, description, errors, error, mark = "unmarked", className, value, onValueChange, items, children }: FormSelectFieldProps & { readonly items: Readonly<Record<string, string>> }): ReactElement => (
  <FormField name={name} label={label} description={description} error={error ?? messagesOf(errors, name)} required={mark === "required"} optionalHint={mark === "optional"} className={className}>
    {(control) => (
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onValueChange(String(next));
        }}
        name={name}
      >
        <SelectTrigger id={control.id} aria-describedby={control.describedBy} aria-invalid={control.invalid || undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    )}
  </FormField>
);
export interface FormChoiceGroupProps {
  readonly name: string;
  readonly legend: string;
  readonly description?: string;
  readonly errors: FieldErrorLookup | null;
  readonly required?: boolean;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string; readonly hint?: string }[];
  readonly onValueChange: (value: string) => void;
  readonly orientation?: "vertical";
  readonly idPrefix: string;
}
/** One labelled group of radio options, each a whole touch target with its own hint, so a closed set is never a select a phone cannot read. */
export const FormChoiceGroup = ({ name, legend, description, errors, required = false, value, options, onValueChange, orientation, idPrefix }: FormChoiceGroupProps): ReactElement => (
  <FormFieldGroup legend={legend} name={name} description={description} error={messagesOf(errors, name)} required={required}>
    {(group) => (
      <RadioGroup value={value} onValueChange={onValueChange} orientation={orientation} aria-labelledby={group.legendId} aria-describedby={group.describedBy} aria-invalid={group.invalid ? true : undefined}>
        {options.map((option) => {
          const optionId = `${idPrefix}-${name}-${option.value}`;
          const hintId = `${optionId}-hint`;
          return (
            <label key={option.value} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
              <RadioGroupItem id={optionId} value={option.value} aria-label={option.label} aria-describedby={option.hint === undefined ? undefined : hintId} className="mt-0.5" />
              {option.hint === undefined ? (
                <span className="min-w-0 text-sm font-medium">{option.label}</span>
              ) : (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{option.label}</span>
                  <span id={hintId} className="text-sm text-pretty text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              )}
            </label>
          );
        })}
      </RadioGroup>
    )}
  </FormFieldGroup>
);
export interface FormReceiptProps {
  readonly outcome: MutationOutcome;
  readonly heading?: string;
  readonly headingLevel: ReceiptHeadingLevel;
  readonly fieldLabels?: Readonly<Record<string, string | undefined>> | undefined;
  readonly onCheckResult?: (() => void) | undefined;
  readonly onRetrySameWork?: (() => void) | undefined;
  readonly onReapply?: (() => void) | undefined;
  readonly dataSlot: string;
}
/** The one durable receipt of an attempt, focused when it appears so a keyboard user lands on the record of what happened. */ export function FormReceipt({ outcome, heading, headingLevel, fieldLabels, onCheckResult, onRetrySameWork, onReapply, dataSlot }: FormReceiptProps): ReactElement {
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => frameRef.current?.focus(), [outcome]);
  return (
    <div ref={frameRef} tabIndex={-1} data-slot={dataSlot} data-outcome={outcome.outcome} className="flex min-w-0 flex-col gap-2 outline-none">
      <OperationResult outcome={outcome} heading={heading} headingLevel={headingLevel} onCheckResult={onCheckResult} onRetrySameWork={onRetrySameWork} onReapply={onReapply} fieldLabels={fieldLabels} />
    </div>
  );
}
export type FormFooterProps = { readonly pending: boolean; readonly applied: boolean; readonly submitLabel: string; readonly savingLabel?: string; readonly cancelLabel?: string; readonly doneLabel?: string; readonly onCancel?: (() => void) | undefined; readonly onDismiss?: (() => void) | undefined };
/** The submit and cancel controls every reviewed form states, and the one control that leaves it once the change applied. */ export function FormFooter({ pending, applied, submitLabel, savingLabel = "Saving…", cancelLabel = "Cancel", doneLabel = "Done", onCancel, onDismiss }: FormFooterProps): ReactElement {
  const leave = onDismiss ?? onCancel;
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      {applied ? (
        leave === undefined ? null : (
          <Button type="button" onClick={leave}>
            {doneLabel}
          </Button>
        )
      ) : (
        <>
          {onCancel === undefined ? null : (
            <Button type="button" variant="outline" onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
          <Button type="submit" disabled={pending} aria-busy={pending ? true : undefined}>
            {pending ? savingLabel : submitLabel}
          </Button>
        </>
      )}
    </div>
  );
}
