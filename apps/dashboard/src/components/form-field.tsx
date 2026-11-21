"use client";

/**
 * The one form and field-error presentation: a labelled-control wrapper, the same contract for a
 * group of controls, the aggregate summary of a failed submit, and the one mapping from a
 * validation outcome to the messages a field shows.
 *
 * AAP items: 0.3.4 "Form and field errors" (one implementation, consumed by every form), 0.4.2's
 * `Label + Field` row ("one error presentation for every form; the message comes from the Zod
 * `invalid` outcome") and 0.4.4 gap 2, which assigns form layout and error semantics to `field` +
 * `label` because the shadcn `form` registry item is deliberately not installed. This file supplies
 * what that item would have — the id, `aria-describedby` and `aria-invalid` wiring a control needs,
 * the per-field message, and the summary a failed submit renders — over the installed primitives
 * rather than styling inputs from scratch.
 *
 * Five exports, one responsibility each:
 *
 * - `FormField` labels one control and hands its wiring to the caller's render function. The render
 *   prop is deliberate: `id`, `describedBy`, `invalid` and `required` are obtainable only from here,
 *   so a control cannot be rendered unlabelled, with a second hand-written description, or with an
 *   error pairing of its own. The value is controlled from outside and arrives through `children`;
 *   nothing here holds form state.
 * - `FormFieldGroup` is that contract for a set of controls (radio rows, checkbox sets), carried by
 *   the design system's `FieldSet`/`FieldLegend` so grouping semantics belong to the fieldset rather
 *   than to a `role="group"` div someone remembered to add.
 * - `FormErrorSummary` is the aggregate surface for an `invalid` outcome: it lists every message,
 *   links each entry to the control that carries it, and takes focus once so the failure is
 *   announced where the reader's attention already is.
 * - `fieldErrorsFromInvalid` maps the outcome's path-keyed messages onto the shape these wrappers
 *   accept, so no form re-implements that mapping.
 * - `fieldControlId` is the one derivation of a field's id: the label, the control, its description
 *   and message ids, and a summary entry's link all come from it, so they cannot drift apart.
 *
 * The rules this file keeps:
 *
 * - One message source. The text shown is the text the service returned (`outcome.ts`'s
 *   `FieldMessages`), never rewritten, shortened, re-worded or replaced by a catalogue here. A
 *   message the schema attached to no field is keyed `ROOT_FIELD_KEY`; it becomes a form-level
 *   entry in the summary instead of vanishing. A message that is empty once trimmed is not
 *   renderable and does not mark a field invalid.
 * - One announcing surface. Field-level messages are associated by `aria-describedby` and are not
 *   live regions of their own: the summary takes focus and is read once, and a per-field text that
 *   is also an alert would speak the same failure a second and third time. Errors stay visible text
 *   beside a decorative icon, and a field keeps its `aria-invalid` state and its destructive border
 *   at the same time, so meaning is never carried by colour alone.
 * - Nothing typed is lost. A failed save re-renders the same field tree: this wrapper never clears,
 *   resets or unmounts its control, and it never writes the current server value over the entered
 *   one. On a `conflict` the caller shows the current value beside the preserved input; the field
 *   the person filled in stays exactly as they left it (WCAG 3.3.7 Redundant Entry).
 * - One place owns identity. `fieldControlId` derives a stable id from the field path, the wrapper
 *   and the summary both use it, and the label points at it — so a summary entry lands on the
 *   control that carries the message, not merely near it.
 * - Composition, not restyling. Every frame, message body and label comes from `components/ui`
 *   (`Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldSet`, `FieldLegend`, `Alert`),
 *   and every colour, radius and spacing value resolves to a token in `styles/globals.css`. This
 *   file states no colour of its own, formats no amount (money arrives already validated by the
 *   service), and is not a wrapper that only re-exports `Field`.
 *
 * Direction is the surrounding block's: only logical utilities are used (`ps-*`, `ms-*`,
 * `text-start`), so a right-to-left form aligns and indents on its own start side with no
 * `direction` property here. Every label is a real `<label>` beside a control of at least the 24x24
 * CSS px target floor (`min-h-target`), and a date control stays the installed `Input` with a date
 * type, so a civil date is never given a fabricated midnight.
 */

import { CircleAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { ROOT_FIELD_KEY, type InvalidOutcome } from "@/modules/data-service/outcome";

/**
 * The id the control addressed by `name` must carry.
 *
 * One derivation serves the label's `htmlFor`, the control's `id`, the description and error ids
 * that `aria-describedby` lists, and the link a summary entry follows. A field path such as
 * `name.first` puts a dot into the id, which is legal but awkward to hand-write and impossible to
 * use unescaped in a selector, so every character outside the id-safe set becomes a hyphen:
 * `field-name-first`. The mapping is deterministic and stable across renders and routes, which is
 * what lets the summary anchor to a field it never rendered; it preserves leading zeros exactly,
 * because an identifier is never normalised through a number.
 */
export function fieldControlId(name: string): string {
  const slug = name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `field-${slug === "" ? "control" : slug}`;
}

/**
 * The messages a validation outcome or an `error` prop actually carries, in order and without
 * repeats.
 *
 * It accepts `unknown` because the `invalid` outcome arrives over the wire: `isOutcome` checks that
 * `fields` is a record, not that each value is an array of strings. A value that is not a string is
 * therefore dropped rather than rendered as `[object Object]`, and a message that is blank once
 * trimmed is dropped because there is nothing to show or announce.
 */
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

/**
 * The per-field messages an `invalid` outcome produced, keyed as the `error` prop of a field
 * expects them.
 *
 * `byField` holds one entry per field path; `form` holds the messages that named no field (Zod's
 * pathless issues, keyed `ROOT_FIELD_KEY`) so they reach the summary instead of disappearing, and
 * `count` is the number of summary entries — one per field plus one per form-level message. Values
 * are `readonly string[]`, which is what a `FormField`'s `error` prop accepts without a cast.
 */
export interface FieldErrorLookup {
  /** Messages keyed by field path, ready to pass to a field's `error` prop. */
  readonly byField: Readonly<Record<string, readonly string[]>>;
  /** Messages that named no field; the summary renders them before the field entries. */
  readonly form: readonly string[];
  /** How many entries a summary renders: one per field plus one per form-level message. */
  readonly count: number;
}

/**
 * Maps an `invalid` outcome onto the messages a form renders.
 *
 * The input is `Pick<InvalidOutcome, "fields">` rather than the whole outcome, so a form that
 * validated locally can pass the same shape it received over the wire; a narrowed
 * `MutationOutcome` satisfies it unchanged. Nothing is dropped: every key with at least one
 * message is mapped, and the pathless ones become `form` messages.
 */
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

/**
 * What a {@link FormField} hands its control.
 *
 * `describedBy` is `undefined` rather than an empty string when the field has neither a description
 * nor a message: an empty `aria-describedby` is an id list with no ids, which the ARIA specification
 * forbids and an accessibility audit reports. Providing the absence here is what stops every form
 * from writing `describedBy || undefined` for itself.
 */
export interface FormFieldControl {
  /** The id the control must carry, and the id its label points at. */
  readonly id: string;
  /** Ids of the description and the message, in reading order; absent when neither exists. */
  readonly describedBy: string | undefined;
  /** Whether a message exists. Pass it as `aria-invalid`; nothing else decides that. */
  readonly invalid: boolean;
  /** Whether a value is required. Pass it as `aria-required`, never as the native `required`. */
  readonly required: boolean;
}

/** Props of {@link FormField}. */
export interface FormFieldProps {
  /** The field's visible label; also its accessible name, unless `hideLabel` is set. */
  readonly label: string;
  /** The field path this control carries, e.g. `emails.0.value`. It derives every id. */
  readonly name: string;
  /** A hint shown above the control and read before the message. Never a validation message. */
  readonly description?: string;
  /** The messages for this field, usually from `fieldErrorsFromInvalid(...).byField[name]`. */
  readonly error?: string | readonly string[];
  /** Marks the field required: a visible marker plus `aria-required` through the render prop. */
  readonly required?: boolean;
  /** Prints "optional" beside the label of a genuinely optional field. `required` wins. */
  readonly optionalHint?: boolean;
  /** Keeps the label for assistive technology only, for a control whose purpose is already shown. */
  readonly hideLabel?: boolean;
  /** Renders the control, receiving its id, description and validity wiring. */
  readonly children: (field: FormFieldControl) => ReactNode;
  /** Layout classes for the field box. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * The visible and announced markers a label (or legend) carries.
 *
 * A required field shows an asterisk that assistive technology ignores, because `aria-required`
 * already states it and a bare punctuation character read aloud is noise. An optional field prints
 * the word, so nothing in the form is implied to be mandatory when it is not. `required` wins over
 * `optionalHint`: a field cannot be both, and the stricter of the two is the honest one. Neither
 * marker takes the destructive colour: a required field that is perfectly valid must not be dressed
 * as one that is in error.
 */
function FieldMarkers({
  required,
  optionalHint,
}: {
  readonly required: boolean;
  readonly optionalHint: boolean;
}): ReactElement | null {
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

/**
 * The message block for one field or one group: an icon beside the text.
 *
 * The icon is decorative — the message itself carries the meaning, and the control's `aria-invalid`
 * state plus its destructive border carry the state — so it never becomes the only signal. Each
 * message is its own line inside the design system's `FieldError` frame. Stating the messages as
 * lines rather than handing them over as an array is deliberate: `FieldError`'s own multi-message
 * form indents a bulleted list by `ms-4`, which pushes a field's text 16px right of every
 * single-message field beside it and breaks the one text column the form reads down. Lines keep
 * every message separate, at one left edge, whether a field has one message or five.
 *
 * `FieldError` is asked for no `role` here because the summary is the one fresh announcement on a
 * failed submit; a live region on each field would repeat that failure once per field. The
 * relationship survives through the id that `aria-describedby` lists.
 */
function FieldMessage({
  id,
  messages,
}: {
  readonly id: string;
  readonly messages: readonly string[];
}): ReactElement {
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

/**
 * The one labelled control.
 *
 * Reading order is the DOM order — label, description, control, message — so a screen reader hears
 * the name, then the hint, then the value, then why it was refused; `aria-describedby` lists the
 * same two ids in the same order. The label is a real `<label>` pointing at the control's id, so
 * clicking or tapping it focuses the control without a handler. `hideLabel` keeps that association
 * and moves the label out of sight only.
 *
 * The control receives `required` to pass as `aria-required` rather than the native `required`
 * attribute: the browser's own validation bubble would be a second error presentation beside this
 * one, and the service is the only authority on what is valid.
 */
export function FormField({
  label,
  name,
  description,
  error,
  required = false,
  optionalHint = false,
  hideLabel = false,
  children,
  className,
}: FormFieldProps): ReactElement {
  const messages = messagesOf(error);
  const invalid = messages.length > 0;

  const id = fieldControlId(name);
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const hint = description ?? "";
  const hasDescription = hint.trim() !== "";

  const describedBy = hasDescription
    ? invalid
      ? `${descriptionId} ${errorId}`
      : descriptionId
    : invalid
      ? errorId
      : undefined;

  return (
    /* No `data-invalid` on the field box. The design system's invalid state paints every descendant
     * in `--destructive`, which would recolour the value the person typed: that text measures about
     * 4.45:1 against the input's tinted surface, under the 4.5:1 WCAG AA minimum for body text, and
     * it dresses their own answer as the error. The invalid state is carried instead by what the
     * control already receives — `aria-invalid`, which the input, textarea and select primitives
     * style with a destructive border and ring — beside the visible message and its icon below it.
     */
    <Field className={className}>
      <FieldLabel
        htmlFor={id}
        /* `min-h-target` is the design system's own 24x24 CSS px floor, so the label is a pointer
         * target in its own right (WCAG 2.5.8) rather than a line of text narrower than a finger. */
        className={cn("min-h-target", hideLabel && "sr-only")}
      >
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
  /** Ids of the group's description and message, in reading order; absent when neither exists. */
  readonly describedBy: string | undefined;
  /** Whether the group carries a message. Pass it as `aria-invalid` on the control set. */
  readonly invalid: boolean;
  /** Whether a choice is required. Pass it as `aria-required` on the control set. */
  readonly required: boolean;
  /** The id of the group's legend, for a control that needs the group name in `aria-labelledby`. */
  readonly legendId: string;
}

/** Props of {@link FormFieldGroup}. */
export interface FormFieldGroupProps {
  /** The group's legend: its one name, rendered as the fieldset's `<legend>`. */
  readonly legend: string;
  /** The field path the group carries. It derives every id, exactly as it does for a field. */
  readonly name: string;
  /** A hint shown above the controls and read before the message. */
  readonly description?: string;
  /** The messages for the group, usually from `fieldErrorsFromInvalid(...).byField[name]`. */
  readonly error?: string | readonly string[];
  /** Marks the group required: a visible marker plus `aria-required` through the render prop. */
  readonly required?: boolean;
  /** Prints "optional" beside the legend of a genuinely optional group. `required` wins. */
  readonly optionalHint?: boolean;
  /** Keeps the legend for assistive technology only. */
  readonly hideLegend?: boolean;
  /** Renders the grouped controls, receiving the group's description and validity wiring. */
  readonly children: (group: FormFieldGroupControl) => ReactNode;
  /** Layout classes for the fieldset. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * The one labelled group of controls.
 *
 * A radio row or a checkbox set is one question with one answer, so its name belongs on the group
 * and its hint and message belong to the group too — otherwise every option repeats the same
 * description. `<fieldset>` with a `<legend>` is the element pair that says so natively; the design
 * system's `FieldSet`/`FieldLegend` supply it, and a `role="group"` div would have to be remembered
 * on every use. `min-w-0` and `border-0` neutralise the two user-agent traits that would otherwise
 * break a 320 CSS px layout: a fieldset refuses to shrink below its content and draws a border this
 * design language does not use.
 *
 * The controls inside remain the caller's, addressed by the ids in the render prop's argument, so a
 * `RadioGroup` or a set of `Checkbox`es keeps the semantics its own primitive gives it.
 */
export function FormFieldGroup({
  legend,
  name,
  description,
  error,
  required = false,
  optionalHint = false,
  hideLegend = false,
  children,
  className,
}: FormFieldGroupProps): ReactElement {
  const messages = messagesOf(error);
  const invalid = messages.length > 0;

  const id = fieldControlId(name);
  const legendId = `${id}-legend`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const hint = description ?? "";
  const hasDescription = hint.trim() !== "";

  const describedBy = hasDescription
    ? invalid
      ? `${descriptionId} ${errorId}`
      : descriptionId
    : invalid
      ? errorId
      : undefined;

  return (
    <FieldSet
      /* The fieldset carries the field's own id as well as its legend, description and message ids:
       * a summary entry for a group points at the same id a single control would carry, so one
       * derivation serves both shapes and the entry still resolves to this group. */
      id={id}
      className={cn("min-w-0 border-0 p-0", className)}
      aria-describedby={describedBy}
      /* No `aria-required` here. A fieldset's implicit role is `group`, which does not support the
       * attribute, so an audit reports the required group as invalid ARIA rather than as required.
       * The requirement is carried where it is valid and where this component's own contract puts it:
       * the caller passes the render prop's `required` to the control set's `aria-required`, and the
       * legend shows the visible marker. */
    >
      <FieldLegend
        id={legendId}
        variant="label"
        /* `flex items-center` centres the legend text in the same 24px target row a `FieldLabel`
         * occupies; left as a block, its text sat on the row's top edge and read a few pixels
         * tighter to the hint below than every label above it. */
        className={cn("flex min-h-target items-center", hideLegend && "sr-only")}
      >
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

/** A real heading element for each level, so the summary joins the document outline. */
const SUMMARY_HEADING_TAG: Readonly<Record<SummaryHeadingLevel, "h2" | "h3" | "h4">> = {
  2: "h2",
  3: "h3",
  4: "h4",
};

/** The summary's heading when the caller states none: a statement, not an apology. */
const DEFAULT_SUMMARY_TITLE = "There is a problem with this form";

/** One line of the summary: a form-level message, or a field's messages behind a link to it. */
interface SummaryEntry {
  /** The field the entry belongs to, or `null` for a message that named no field. */
  readonly path: string | null;
  /** The link text: the caller's label for that field, or the field path when it gave none. */
  readonly label: string;
  /** The messages shown beside the link, in the order the service returned them. */
  readonly messages: readonly string[];
}

/** Props of {@link FormErrorSummary}. */
export interface FormErrorSummaryProps {
  /** The messages of the failed submit, from `fieldErrorsFromInvalid`. Nothing renders without them. */
  readonly errors: FieldErrorLookup | null | undefined;
  /** Display names by field path, so an entry reads "Email" and not "emails.0.value". */
  readonly labels?: Readonly<Record<string, string | undefined>>;
  /** Field paths in the form's reading order; paths it omits follow in their own order. */
  readonly order?: readonly string[];
  /** The summary's heading. Defaults to a plain statement that the form has a problem. */
  readonly title?: string;
  /** An optional sentence under the heading, for the caller's own context. Never a message. */
  readonly description?: string;
  /** The heading level that fits the surrounding page. Defaults to 2. */
  readonly headingLevel?: SummaryHeadingLevel;
  /** Layout classes for the focusable frame. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * Orders a field's paths the way the form reads them.
 *
 * The lookup is keyed by path and therefore has no inherent order, while a summary that lists a
 * phone field above a name field reads as noise. The caller's `order` wins where it names a path;
 * anything it does not name keeps its own order after the named ones, so a field the caller forgot
 * still appears instead of being silently dropped.
 */
function orderedPaths(
  byField: Readonly<Record<string, readonly string[]>>,
  order: readonly string[] | undefined,
): readonly string[] {
  const paths = Object.keys(byField);
  if (order === undefined || order.length === 0) {
    return paths;
  }
  const named = order.filter((path) => byField[path] !== undefined);
  const rest = paths.filter((path) => !named.includes(path));
  return [...named, ...rest];
}

/** Flattens a lookup into the lines the summary renders, form-level messages first. */
function buildEntries(
  errors: FieldErrorLookup | null | undefined,
  labels: Readonly<Record<string, string | undefined>> | undefined,
  order: readonly string[] | undefined,
): readonly SummaryEntry[] {
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

/**
 * Selector for the one element focus may land on inside a target: a control, a link, or anything
 * that takes part in the tab order.
 *
 * A summary entry points at whichever element carries the field's id. For a single control that is
 * the control itself; for a group it is the fieldset, which is not focusable — so the entry would
 * scroll the group into view and leave the keyboard position behind. Asking for the first focusable
 * descendant instead lands the reader on the first option of the set, ready to choose.
 */
const FOCUSABLE_SELECTOR = [
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Moves focus to the field a summary entry points at.
 *
 * The anchor's `href` already makes the entry a real link that works without this handler; running
 * it means activating the link lands focus on the control, not merely at the fragment, so the
 * reader can type or choose immediately. A field whose id sits on a container is entered through
 * its first focusable descendant, and a path whose target is not on this screen (a summary rendered
 * in a step whose fields are elsewhere) leaves focus where it was rather than throwing.
 */
function focusControl(controlId: string): void {
  const target = document.getElementById(controlId);
  if (target === null) {
    return;
  }
  const focusable = target.matches(FOCUSABLE_SELECTOR)
    ? target
    : target.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  (focusable ?? target).focus();
  target.scrollIntoView({ block: "center" });
}

/**
 * The aggregate surface a failed submit renders above its fields.
 *
 * It shows every message once, in the form's reading order, with the field's own name as the link
 * into it; a message that named no field is listed without a link, because there is no control for
 * it to point at. The text is the service's, verbatim, and each message keeps its own line: two
 * messages joined into one sentence would read as a single longer one, with the second swallowed
 * mid-sentence as though it were the end of the first.
 *
 * It takes focus once when it appears, and once per new failure after that: `announcedFor` remembers
 * the lookup it already announced, so a re-render with the same messages does not yank focus back to
 * the top while someone is correcting the third field. Focus lands on a frame around the alert, and
 * the alert itself is the one announcing surface — named by its own heading — so the failure is
 * spoken in a single pass while the reading position moves with it. It renders nothing when there is
 * no message: an `invalid` outcome with no field messages is reported through the operation result,
 * not through an empty alert.
 */
export function FormErrorSummary({
  errors,
  labels,
  order,
  title = DEFAULT_SUMMARY_TITLE,
  description,
  headingLevel = 2,
  className,
}: FormErrorSummaryProps): ReactElement | null {
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
    /* The frame is focusable but carries no role: it exists so focus — and with it the reading
     * position — moves to the summary, while the alert inside is the one announcing surface. Giving
     * the frame a grouping role as well would name and describe the same content twice.
     * `outline-none` because a focus ring around a whole alert would read as an interactive surface
     * that it is not; the box itself is the visible change. */
    <div
      ref={frameRef}
      data-slot="form-error-summary"
      tabIndex={-1}
      className={cn("min-w-0 rounded-lg outline-none", className)}
    >
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
          {description === undefined || description.trim() === "" ? null : (
            <p className="text-destructive">{description}</p>
          )}
          <ul className="flex list-disc flex-col gap-2 ps-4 text-destructive">
            {entries.map((entry, index) => {
              /* Bound to a `const` so the narrowing of `path` survives into the click handler:
               * a property read inside a callback is otherwise checked as though it may have
               * changed since the branch above. */
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
