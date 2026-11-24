"use client";
import { CircleAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { ROOT_FIELD_KEY, type InvalidOutcome } from "@/modules/data-service/outcome";
import type { ZodError } from "zod";
/** The id the control addressed by `name` must carry. */ export function fieldControlId(name: string): string {
  const slug = name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `field-${slug === "" ? "control" : slug}`;
}
/** The one body measure for a field's hint: the design system's field description states a normal leading of its own, and every 14px paragraph in the product reads at the body measure instead. `leading-5` is the body measure's 20px step, and the class merge keeps it over the design system's own leading. */
const HINT_CLASS = "type-supporting leading-5";
/** The one sentence a date field states about itself: the convention a civil date is written and read in here, and the exact day the field holds once it holds one. */ export function civilDateConvention(value?: string | null): string {
  const held = typeof value === "string" ? value.trim() : "";
  return held === "" ? "Civil dates here are written and read as year-month-day, for example 2026-09-12." : `Civil dates here are written and read as year-month-day, and this one is ${held}.`;
}
function messagesOf(value: unknown): readonly string[] {
  const raw: readonly unknown[] = Array.isArray(value) ? value : [value];
  const messages: string[] = [];
  for (const entry of raw) if (typeof entry === "string" && entry.trim() !== "" && !messages.includes(entry)) messages.push(entry);
  return messages;
}
/** The per-field messages an `invalid` outcome produced, keyed as the `error` prop of a field expects them. */
export type FieldErrorLookup = { readonly byField: Readonly<Record<string, readonly string[]>>; readonly form: readonly string[]; readonly count: number };
/** Maps an `invalid` outcome onto the messages a form renders. */ export function fieldErrorsFromInvalid(outcome: Pick<InvalidOutcome, "fields">): FieldErrorLookup {
  const byField: Record<string, readonly string[]> = {};
  const form: string[] = [];
  for (const path of Object.keys(outcome.fields)) {
    const messages = messagesOf(outcome.fields[path]);
    if (messages.length === 0) continue;
    if (path === ROOT_FIELD_KEY || path.trim() === "") {
      form.push(...messages);
      continue;
    }
    byField[path] = messages;
  }
  return { byField, form, count: Object.keys(byField).length + form.length };
}
/** The messages a schema's own refusal named, keyed by the field path the form renders them at. */ export function fieldMessagesOf(error: ZodError): Readonly<Record<string, readonly string[]>> {
  const collected = new Map<string, string[]>();
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? ROOT_FIELD_KEY : issue.path.map((step) => String(step)).join(".");
    const messages = collected.get(path) ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    collected.set(path, messages);
  }
  return Object.fromEntries(collected);
}
/** The one sentence a refused request is summarised by: each field the refusal names, with the message that says what to correct in it. */ export function refusalSummary(outcome: Pick<InvalidOutcome, "fields">): string {
  const { byField, form } = fieldErrorsFromInvalid(outcome);
  const sentences: string[] = [];
  for (const [path, messages] of Object.entries(byField)) sentences.push(`${path}: ${messages.join(" ")}`);
  sentences.push(...form);
  return sentences.length === 0 ? "The request stated no field this view can name, so it has to be corrected before the read can run." : sentences.join(" ");
}
/** What a {@link FormField} hands its control. */ export type FormFieldControl = { readonly id: string; readonly describedBy: string | undefined; readonly invalid: boolean; readonly required: boolean };
export type FormFieldProps = {
  readonly label: string;
  readonly name: string;
  readonly description?: string;
  readonly error?: string | readonly string[];
  readonly required?: boolean;
  readonly optionalHint?: boolean;
  readonly hideLabel?: boolean;
  readonly children: (field: FormFieldControl) => ReactNode;
  readonly className?: string;
};
function FieldMarkers({ required, optionalHint }: { readonly required: boolean; readonly optionalHint: boolean }): ReactElement | null {
  if (required) {
    return (
      <span aria-hidden="true" className="font-normal text-muted-foreground">
        *
      </span>
    );
  }
  if (optionalHint) return <span className="font-normal text-muted-foreground">(optional)</span>;
  return null;
}
const FieldMessage = ({ id, messages }: { readonly id: string; readonly messages: readonly string[] }): ReactElement => (
  <div className="flex min-w-0 items-start gap-1.5">
    <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
    <FieldError id={id} role={undefined} className="min-w-0">
      <span className="flex flex-col gap-1">
        {messages.map((message) => (
          <span key={message}>{message}</span>
        ))}
      </span>
    </FieldError>
  </div>
);
type FieldFrame = { readonly messages: readonly string[]; readonly invalid: boolean; readonly id: string; readonly descriptionId: string; readonly errorId: string; readonly hint: string; readonly hasDescription: boolean; readonly describedBy: string | undefined };
function fieldFrame(name: string, description: string | undefined, error: string | readonly string[] | undefined): FieldFrame {
  const messages = messagesOf(error);
  const id = fieldControlId(name);
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const hint = description ?? "";
  const invalid = messages.length > 0;
  const hasDescription = hint.trim() !== "";
  return { messages, invalid, id, descriptionId, errorId, hint, hasDescription, describedBy: hasDescription ? (invalid ? `${descriptionId} ${errorId}` : descriptionId) : invalid ? errorId : undefined };
}
/** The one labelled control. */ export function FormField({ label, name, description, error, required = false, optionalHint = false, hideLabel = false, children, className }: FormFieldProps): ReactElement {
  const { messages, invalid, id, descriptionId, errorId, hint, hasDescription, describedBy } = fieldFrame(name, description, error);
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id} className={cn("min-h-target", hideLabel && "sr-only")}>
        {label}
        <FieldMarkers required={required} optionalHint={optionalHint} />
      </FieldLabel>
      {hasDescription ? (
        <FieldDescription id={descriptionId} className={HINT_CLASS}>
          {hint}
        </FieldDescription>
      ) : null}
      {children({ id, describedBy, invalid, required })}
      {invalid ? <FieldMessage id={errorId} messages={messages} /> : null}
    </Field>
  );
}
/** What a {@link FormFieldGroup} hands the controls it groups. */ export type FormFieldGroupControl = { readonly describedBy: string | undefined; readonly invalid: boolean; readonly required: boolean; readonly legendId: string };
export type FormFieldGroupProps = {
  readonly legend: string;
  readonly name: string;
  readonly description?: string;
  readonly error?: string | readonly string[];
  readonly required?: boolean;
  readonly optionalHint?: boolean;
  readonly hideLegend?: boolean;
  readonly children: (group: FormFieldGroupControl) => ReactNode;
  readonly className?: string;
};
/** The one labelled group of controls. */ export function FormFieldGroup({ legend, name, description, error, required = false, optionalHint = false, hideLegend = false, children, className }: FormFieldGroupProps): ReactElement {
  const { messages, invalid, id, descriptionId, errorId, hint, hasDescription, describedBy } = fieldFrame(name, description, error);
  const legendId = `${id}-legend`;
  return (
    <FieldSet id={id} className={cn("min-w-0 border-0 p-0", className)} aria-describedby={describedBy}>
      <FieldLegend id={legendId} variant="label" className={cn("flex min-h-target items-center", hideLegend && "sr-only")}>
        {legend}
        <FieldMarkers required={required} optionalHint={optionalHint} />
      </FieldLegend>
      {hasDescription ? (
        <FieldDescription id={descriptionId} className={HINT_CLASS}>
          {hint}
        </FieldDescription>
      ) : null}
      {children({ describedBy, invalid, required, legendId })}
      {invalid ? <FieldMessage id={errorId} messages={messages} /> : null}
    </FieldSet>
  );
}
/** The heading levels a surrounding page can need; the level is the caller's, not the summary's. */ export type SummaryHeadingLevel = 2 | 3 | 4;
const SUMMARY_HEADING_TAG: Readonly<Record<SummaryHeadingLevel, "h2" | "h3" | "h4">> = { 2: "h2", 3: "h3", 4: "h4" };
/** The one type scale's utility per level, so the one error summary states its heading at the measure of the level it lands at. */
const SUMMARY_HEADING_SCALE: Readonly<Record<SummaryHeadingLevel, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const DEFAULT_SUMMARY_TITLE = "There is a problem with this form";
type SummaryEntry = { readonly path: string | null; readonly label: string; readonly messages: readonly string[] };
export type FormErrorSummaryProps = {
  readonly errors: FieldErrorLookup | null | undefined;
  readonly labels?: Readonly<Record<string, string | undefined>>;
  readonly order?: readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly headingLevel?: SummaryHeadingLevel;
  readonly className?: string;
};
function orderedPaths(byField: Readonly<Record<string, readonly string[]>>, order: readonly string[] | undefined): readonly string[] {
  const paths = Object.keys(byField);
  if (order === undefined || order.length === 0) return paths;
  const named = order.filter((path) => byField[path] !== undefined);
  const rest = paths.filter((path) => !named.includes(path));
  return [...named, ...rest];
}
function buildEntries(errors: FieldErrorLookup | null | undefined, labels: Readonly<Record<string, string | undefined>> | undefined, order: readonly string[] | undefined): readonly SummaryEntry[] {
  if (errors === null || errors === undefined) return [];
  const entries: SummaryEntry[] = errors.form.map((message) => ({ path: null, label: "", messages: [message] }));
  for (const path of orderedPaths(errors.byField, order)) {
    const messages = errors.byField[path] ?? [];
    if (messages.length === 0) continue;
    const label = labels?.[path]?.trim() ?? "";
    entries.push({ path, label: label === "" ? path : label, messages });
  }
  return entries;
}
const FOCUSABLE_SELECTOR = ["input:not([disabled])", "select:not([disabled])", "textarea:not([disabled])", "button:not([disabled])", "[href]", '[tabindex]:not([tabindex="-1"])'].join(", ");
function focusControl(controlId: string): void {
  const target = document.getElementById(controlId);
  if (target === null) return;
  const focusable = target.matches(FOCUSABLE_SELECTOR) ? target : target.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  (focusable ?? target).focus();
  target.scrollIntoView({ block: "center" });
}
/** The aggregate surface a failed submit renders above its fields. */
export function FormErrorSummary({ errors, labels, order, title = DEFAULT_SUMMARY_TITLE, description, headingLevel = 2, className }: FormErrorSummaryProps): ReactElement | null {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const announcedFor = useRef<FieldErrorLookup | null | undefined>(undefined);
  const titleId = useId();
  const entries = buildEntries(errors, labels, order);
  const hasEntries = entries.length > 0;
  useEffect(() => {
    if (!hasEntries) {
      announcedFor.current = null;
      return;
    }
    if (errors === null || errors === undefined || announcedFor.current === errors) return;
    announcedFor.current = errors;
    frameRef.current?.focus();
  }, [errors, hasEntries]);
  if (!hasEntries) return null;
  const Heading = SUMMARY_HEADING_TAG[headingLevel];
  return (
    <div ref={frameRef} data-slot="form-error-summary" tabIndex={-1} className={cn("min-w-0 rounded-lg outline-none", className)}>
      <Alert variant="destructive" aria-labelledby={titleId}>
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>
          <Heading id={titleId} className={SUMMARY_HEADING_SCALE[headingLevel]}>
            {title}
          </Heading>
        </AlertTitle>
        <AlertDescription>
          {description === undefined || description.trim() === "" ? null : <p className="text-destructive">{description}</p>}
          <ul className="flex list-disc flex-col gap-2 ps-4 text-destructive">
            {entries.map((entry, index) => {
              const path = entry.path;
              return (
                <li key={path ?? `form-level-${String(index)}`}>
                  {path === null ? null : (
                    <a
                      className="inline-link rounded-sm"
                      href={`#${fieldControlId(path)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        focusControl(fieldControlId(path));
                      }}
                    >
                      {entry.label}
                    </a>
                  )}
                  {entry.messages.map((message) => (
                    <span key={message} className="block">
                      {message}
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
export default FormField;
