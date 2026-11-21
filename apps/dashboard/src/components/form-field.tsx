"use client";
/**
 * The one form and field-error presentation: a labelled-control wrapper, the same contract for a group
 * of controls, the aggregate summary of a failed submit, and the one mapping from a validation outcome
 * to the messages a field shows.
 */
import { CircleAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { ROOT_FIELD_KEY, type InvalidOutcome } from "@/modules/data-service/outcome";
/** The id the control addressed by `name` must carry. */
export function fieldControlId(name: string): string {
  const slug = name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `field-${slug === "" ? "control" : slug}`;
}
function messagesOf(value: unknown): readonly string[] {
  const raw: readonly unknown[] = Array.isArray(value) ? value : [value];
  const messages: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim() !== "" && !messages.includes(entry)) {
      messages.push(entry);
    }
  }
  return messages;
}
/** The per-field messages an `invalid` outcome produced, keyed as the `error` prop of a field expects them. */
export interface FieldErrorLookup {
  readonly byField: Readonly<Record<string, readonly string[]>>;
  readonly form: readonly string[];
  readonly count: number;
}
/** Maps an `invalid` outcome onto the messages a form renders. */
export function fieldErrorsFromInvalid(outcome: Pick<InvalidOutcome, "fields">): FieldErrorLookup {
  const byField: Record<string, readonly string[]> = {};
  const form: string[] = [];
  for (const path of Object.keys(outcome.fields)) {
    const messages = messagesOf(outcome.fields[path]);
    if (messages.length === 0) {
      continue;
    }
    if (path === ROOT_FIELD_KEY || path.trim() === "") {
      form.push(...messages);
      continue;
    }
    byField[path] = messages;
  }
  return { byField, form, count: Object.keys(byField).length + form.length };
}
/** What a {@link FormField} hands its control. */
export interface FormFieldControl {
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly required: boolean;
}
/** Props of {@link FormField}. */
export interface FormFieldProps {
  readonly label: string;
  readonly name: string;
  readonly description?: string;
  readonly error?: string | readonly string[];
  readonly required?: boolean;
  readonly optionalHint?: boolean;
  readonly hideLabel?: boolean;
  readonly children: (field: FormFieldControl) => ReactNode;
  readonly className?: string;
}
function FieldMarkers({ required, optionalHint }: { readonly required: boolean; readonly optionalHint: boolean }): ReactElement | null {
  if (required) {
    return (
      <span aria-hidden="true" className="font-normal text-muted-foreground">
        *
      </span>
    );
  }
  if (optionalHint) {
    return <span className="font-normal text-muted-foreground">(optional)</span>;
  }
  return null;
}
function FieldMessage({ id, messages }: { readonly id: string; readonly messages: readonly string[] }): ReactElement {
  return (
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
}
/** The one labelled control. */
export function FormField({ label, name, description, error, required = false, optionalHint = false, hideLabel = false, children, className }: FormFieldProps): ReactElement {
  const messages = messagesOf(error);
  const invalid = messages.length > 0;
  const id = fieldControlId(name);
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const hint = description ?? "";
  const hasDescription = hint.trim() !== "";
  const describedBy = hasDescription ? (invalid ? `${descriptionId} ${errorId}` : descriptionId) : invalid ? errorId : undefined;
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id} className={cn("min-h-target", hideLabel && "sr-only")}>
        {label}
        <FieldMarkers required={required} optionalHint={optionalHint} />
      </FieldLabel>
      {hasDescription ? <FieldDescription id={descriptionId}>{hint}</FieldDescription> : null}
      {children({ id, describedBy, invalid, required })}
      {invalid ? <FieldMessage id={errorId} messages={messages} /> : null}
    </Field>
  );
}
/** What a {@link FormFieldGroup} hands the controls it groups. */
export interface FormFieldGroupControl {
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly required: boolean;
  readonly legendId: string;
}
/** Props of {@link FormFieldGroup}. */
export interface FormFieldGroupProps {
  readonly legend: string;
  readonly name: string;
  readonly description?: string;
  readonly error?: string | readonly string[];
  readonly required?: boolean;
  readonly optionalHint?: boolean;
  readonly hideLegend?: boolean;
  readonly children: (group: FormFieldGroupControl) => ReactNode;
  readonly className?: string;
}
/** The one labelled group of controls. */
export function FormFieldGroup({ legend, name, description, error, required = false, optionalHint = false, hideLegend = false, children, className }: FormFieldGroupProps): ReactElement {
  const messages = messagesOf(error);
  const invalid = messages.length > 0;
  const id = fieldControlId(name);
  const legendId = `${id}-legend`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const hint = description ?? "";
  const hasDescription = hint.trim() !== "";
  const describedBy = hasDescription ? (invalid ? `${descriptionId} ${errorId}` : descriptionId) : invalid ? errorId : undefined;
  return (
    <FieldSet id={id} className={cn("min-w-0 border-0 p-0", className)} aria-describedby={describedBy}>
      <FieldLegend id={legendId} variant="label" className={cn("flex min-h-target items-center", hideLegend && "sr-only")}>
        {legend}
        <FieldMarkers required={required} optionalHint={optionalHint} />
      </FieldLegend>
      {hasDescription ? <FieldDescription id={descriptionId}>{hint}</FieldDescription> : null}
      {children({ describedBy, invalid, required, legendId })}
      {invalid ? <FieldMessage id={errorId} messages={messages} /> : null}
    </FieldSet>
  );
}
/** The heading levels a surrounding page can need; the level is the caller's, not the summary's. */
export type SummaryHeadingLevel = 2 | 3 | 4;

const SUMMARY_HEADING_TAG: Readonly<Record<SummaryHeadingLevel, "h2" | "h3" | "h4">> = {
  2: "h2",
  3: "h3",
  4: "h4",
};
const DEFAULT_SUMMARY_TITLE = "There is a problem with this form";

interface SummaryEntry {
  readonly path: string | null;
  readonly label: string;
  readonly messages: readonly string[];
}
/** Props of {@link FormErrorSummary}. */
export interface FormErrorSummaryProps {
  readonly errors: FieldErrorLookup | null | undefined;
  readonly labels?: Readonly<Record<string, string | undefined>>;
  readonly order?: readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly headingLevel?: SummaryHeadingLevel;
  readonly className?: string;
}
function orderedPaths(byField: Readonly<Record<string, readonly string[]>>, order: readonly string[] | undefined): readonly string[] {
  const paths = Object.keys(byField);
  if (order === undefined || order.length === 0) {
    return paths;
  }
  const named = order.filter((path) => byField[path] !== undefined);
  const rest = paths.filter((path) => !named.includes(path));
  return [...named, ...rest];
}
function buildEntries(errors: FieldErrorLookup | null | undefined, labels: Readonly<Record<string, string | undefined>> | undefined, order: readonly string[] | undefined): readonly SummaryEntry[] {
  if (errors === null || errors === undefined) {
    return [];
  }
  const entries: SummaryEntry[] = errors.form.map((message) => ({
    path: null,
    label: "",
    messages: [message],
  }));
  for (const path of orderedPaths(errors.byField, order)) {
    const messages = errors.byField[path] ?? [];
    if (messages.length === 0) {
      continue;
    }
    const label = labels?.[path]?.trim() ?? "";
    entries.push({ path, label: label === "" ? path : label, messages });
  }
  return entries;
}
const FOCUSABLE_SELECTOR = ["input:not([disabled])", "select:not([disabled])", "textarea:not([disabled])", "button:not([disabled])", "[href]", '[tabindex]:not([tabindex="-1"])'].join(", ");

function focusControl(controlId: string): void {
  const target = document.getElementById(controlId);
  if (target === null) {
    return;
  }
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
    if (errors === null || errors === undefined || announcedFor.current === errors) {
      return;
    }
    announcedFor.current = errors;
    frameRef.current?.focus();
  }, [errors, hasEntries]);
  if (!hasEntries) {
    return null;
  }
  const Heading = SUMMARY_HEADING_TAG[headingLevel];
  return (
    <div ref={frameRef} data-slot="form-error-summary" tabIndex={-1} className={cn("min-w-0 rounded-lg outline-none", className)}>
      <Alert variant="destructive" aria-labelledby={titleId}>
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>
          <Heading id={titleId} className="text-base font-medium">
            {title}
          </Heading>
        </AlertTitle>
        {/* `text-destructive` is stated on this summary's own list and sentence rather than left to
         * the alert's destructive variant, which paints its description at 90% of the token: that
         * composite measures about 4.49:1 on the card surface, a hair under the 4.5:1 WCAG AA minimum
         * for body text, while the full token measures about 4.77:1. Both resolve to the same semantic
         * colour, so the emphasis the design language intends is kept without the contrast loss. */}
        <AlertDescription>
          {description === undefined || description.trim() === "" ? null : <p className="text-destructive">{description}</p>}
          <ul className="flex list-disc flex-col gap-2 ps-4 text-destructive">
            {entries.map((entry, index) => {
              const path = entry.path;
              return (
                <li key={path ?? `form-level-${String(index)}`}>
                  {path === null ? null : (
                    <a
                      className="rounded-sm"
                      href={`#${fieldControlId(path)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        focusControl(fieldControlId(path));
                      }}
                    >
                      {entry.label}
                    </a>
                  )}
                  {/* One line per message. Joining them into a single sentence made two
                   * independent messages read as one — the second swallowed mid-sentence as
                   * though it were the end of the first. */}
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
