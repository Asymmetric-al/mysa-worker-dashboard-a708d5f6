"use client";
import type { ReactElement } from "react";
import { FormField, FormFieldGroup, type FieldErrorLookup } from "@/components/form-field";
import StatusBadge from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { MailIcon, MapPinIcon, PhoneIcon } from "lucide-react";
import { controlAria } from "./bound-fields";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CONTACT_METHOD_KINDS, type ContactMethodKind } from "@/modules/data-service/envelope";
export type ContactMethodRow = { readonly rowKey: string; kind: ContactMethodKind; value: string; permitted: boolean };
export const CONTACT_METHOD_ROW_PREFIX = "Contact method";
export const CONTACT_METHODS_FIELD = "contactMethods";
export const CONTACT_KIND_LABEL = "Kind";
export const PERMITTED_LABEL = "Permitted for contact";
const PERMITTED_FACT: Readonly<Record<"on" | "off", string>> = { on: PERMITTED_LABEL, off: "Not permitted for contact" };
const CONTACT_KIND_LABELS: Readonly<Record<ContactMethodKind, string>> = { email: "Email address", phone: "Phone number", postal: "Postal address" };
const CONTACT_KIND_INPUT_MODES: Readonly<Record<ContactMethodKind, "email" | "tel" | "text">> = { email: "email", phone: "tel", postal: "text" };
export const CONTACT_KIND_DEFAULT: ContactMethodKind = CONTACT_METHOD_KINDS[0] ?? "email";
/** The method-kind a typed value names, or `null` when it names none the vocabulary holds. */ export const contactKindOf = (value: string): ContactMethodKind | null => CONTACT_METHOD_KINDS.find((kind) => kind === value) ?? null;
/** Adds one entry per contact-method row to a refusal's field labels, in the convention both record forms read. */ export function contactMethodFieldLabels(labels: Record<string, string | undefined>, rowCount: number): Record<string, string | undefined> {
  for (let index = 0; index < rowCount; index += 1) {
    const rowPath = `${CONTACT_METHODS_FIELD}.${String(index)}`;
    const legend = `${CONTACT_METHOD_ROW_PREFIX} ${String(index + 1)}`;
    labels[rowPath] = legend;
    labels[`${rowPath}.kind`] = `${legend} ${CONTACT_KIND_LABEL.toLowerCase()}`;
    labels[`${rowPath}.value`] = `${legend} value`;
    labels[`${rowPath}.permitted`] = `${legend} ${PERMITTED_LABEL.toLowerCase()}`;
  }
  return labels;
}
type ContactMethodRowFieldProps = { readonly index: number; readonly row: ContactMethodRow; readonly errors: FieldErrorLookup | null; readonly valueDescription: string; readonly showPermittedFact: boolean; readonly onChange: (next: ContactMethodRow) => void; readonly onRemove: () => void };
function ContactMethodRowField({ index, row, errors, valueDescription, showPermittedFact, onChange, onRemove }: ContactMethodRowFieldProps): ReactElement {
  const number = index + 1;
  const legend = `${CONTACT_METHOD_ROW_PREFIX} ${String(number)}`;
  const rowPath = `${CONTACT_METHODS_FIELD}.${String(index)}`;
  const messageFor = (part: string): readonly string[] | undefined => errors?.byField[`${rowPath}.${part}`];
  return (
    <FormFieldGroup legend={legend} name={rowPath} error={errors?.byField[rowPath]} className="rounded-xl border border-border p-4">
      {() => (
        <div className="flex min-w-0 flex-col gap-4">
          {showPermittedFact ? (
            <div className="flex min-w-0">
              <StatusBadge label={row.permitted ? PERMITTED_FACT.on : PERMITTED_FACT.off} tone={row.permitted ? "info" : "neutral"} srPrefix={legend} />
            </div>
          ) : null}
          <FormField name={`${rowPath}.kind`} label={CONTACT_KIND_LABEL} description="What sort of detail this is: an email address, a phone number or a postal address." error={messageFor("kind")} required>
            {(control) => (
              <NativeSelect
                id={control.id}
                className="w-full"
                value={row.kind}
                {...controlAria(control)}
                onChange={(event) => {
                  const kind = contactKindOf(event.currentTarget.value);
                  if (kind !== null) onChange({ ...row, kind });
                }}
              >
                {CONTACT_METHOD_KINDS.map((kind) => (
                  <NativeSelectOption key={kind} value={kind}>
                    {CONTACT_KIND_LABELS[kind]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField name={`${rowPath}.value`} label="Value" description={row.kind === "phone" ? `${valueDescription} Include country dial code (e.g. +1, +44, +27) when calling internationally.` : valueDescription} error={messageFor("value")} required>
            {(control) =>
              row.kind === "phone" ? (
                <InputGroup>
                  <InputGroupAddon align="inline-start" aria-hidden="true" className="gap-1.5 text-xs text-muted-foreground">
                    <PhoneIcon className="size-3.5" />
                    <span className="mono-identifier">Intl</span>
                  </InputGroupAddon>
                  <InputGroupInput id={control.id} type="tel" inputMode="tel" placeholder="+1 555 010 0199" value={row.value} autoComplete="off" spellCheck={false} {...controlAria(control)} onChange={(event) => onChange({ ...row, value: event.currentTarget.value })} />
                </InputGroup>
              ) : row.kind === "email" ? (
                <InputGroup>
                  <InputGroupAddon align="inline-start" aria-hidden="true">
                    <MailIcon className="size-3.5 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput id={control.id} type="text" inputMode="email" placeholder="name@example.org" value={row.value} autoComplete="off" spellCheck={false} {...controlAria(control)} onChange={(event) => onChange({ ...row, value: event.currentTarget.value })} />
                </InputGroup>
              ) : (
                <InputGroup>
                  <InputGroupAddon align="inline-start" aria-hidden="true">
                    <MapPinIcon className="size-3.5 text-muted-foreground" />
                  </InputGroupAddon>
                  <Input id={control.id} type="text" inputMode={CONTACT_KIND_INPUT_MODES[row.kind]} value={row.value} autoComplete="off" spellCheck={false} {...controlAria(control)} onChange={(event) => onChange({ ...row, value: event.currentTarget.value })} className="w-full border-0 bg-transparent shadow-none focus-visible:ring-0" />
                </InputGroup>
              )
            }
          </FormField>
          <FormField name={`${rowPath}.permitted`} label={PERMITTED_LABEL} description="Whether this detail may be used to reach the person. It is a fact about contactability only: it is not communication consent and not a reader grant." error={messageFor("permitted")}>
            {(control) => (
              <div className="flex min-h-target min-w-0 items-center">
                <Checkbox id={control.id} checked={row.permitted} aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} onCheckedChange={(checked) => onChange({ ...row, permitted: checked })} />
              </div>
            )}
          </FormField>
          <div className="flex min-w-0">
            <Button type="button" variant="outline" size="sm" className="min-h-target max-w-full whitespace-normal" onClick={onRemove}>{`Remove ${CONTACT_METHOD_ROW_PREFIX.toLowerCase()} ${String(number)}`}</Button>
          </div>
        </div>
      )}
    </FormFieldGroup>
  );
}
export interface ContactMethodListProps {
  readonly rows: readonly ContactMethodRow[];
  readonly headingId: string;
  readonly errors: FieldErrorLookup | null;
  readonly valueDescription: string;
  readonly emptyNote: string;
  readonly addNote: string;
  readonly showPermittedFact?: boolean;
  readonly onRowsChange: (next: readonly ContactMethodRow[]) => void;
  readonly onAdd: () => void;
}
/** The contact-method rows one form holds, in the order the worker wrote them, with the one control that adds another. */ export const ContactMethodList = ({ rows, headingId, errors, valueDescription, emptyNote, addNote, showPermittedFact = false, onRowsChange, onAdd }: ContactMethodListProps): ReactElement => (
  <div className="flex min-w-0 flex-col gap-4">
    {rows.length === 0 ? (
      <p className="text-sm text-pretty text-muted-foreground">{emptyNote}</p>
    ) : (
      <ul aria-labelledby={headingId} className="flex min-w-0 list-none flex-col gap-4 p-0">
        {rows.map((row, index) => (
          <li key={row.rowKey} className="min-w-0">
            <ContactMethodRowField
              index={index}
              row={row}
              errors={errors}
              valueDescription={valueDescription}
              showPermittedFact={showPermittedFact}
              onChange={(next) => onRowsChange(rows.map((candidate) => (candidate.rowKey === row.rowKey ? next : candidate)))}
              onRemove={() => onRowsChange(rows.filter((candidate) => candidate.rowKey !== row.rowKey))}
            />
          </li>
        ))}
      </ul>
    )}
    <div className="flex min-w-0 flex-col gap-1">
      <Button {...{ type: "button", variant: "outline", className: "min-h-target w-fit max-w-full whitespace-normal", onClick: onAdd }}>Add a contact method</Button>
      <p className="text-xs text-pretty text-muted-foreground">{addNote}</p>
    </div>
  </div>
);
