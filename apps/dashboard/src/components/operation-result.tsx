"use client";
import { useId, useRef, type ReactElement, type ReactNode } from "react";
import { fieldErrorsFromInvalid, FormErrorSummary } from "@/components/form-field";
import StatusBadge, { type StatusBadgeSpec } from "@/components/status-badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { isRecord } from "@/lib/guards";
import type { InvalidOutcome, MutationOutcome, PerItemResult } from "@/modules/data-service/outcome";
type OutcomeName = MutationOutcome["outcome"];
export type AnnouncementSeverity = "polite" | "assertive";
/** Which outcomes announce politely and which assertively — the one place that decision is made. */
export const OUTCOME_SEVERITY: Readonly<Record<OutcomeName, AnnouncementSeverity>> = { accepted: "polite", alreadyAccepted: "polite", unchanged: "polite", invalid: "assertive", conflict: "assertive", denied: "assertive", unavailable: "assertive", unknown: "assertive" };
export const OUTCOME_HEADINGS: Readonly<Record<OutcomeName, string>> = {
  accepted: "Saved",
  alreadyAccepted: "Already saved",
  unchanged: "Nothing to change",
  conflict: "Someone else changed this",
  denied: "Not permitted",
  invalid: "Check the details",
  unavailable: "Source unavailable",
  unknown: "Result not confirmed",
};
const RECEIPT_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** The one type scale's utility per level, so a receipt states its own heading at the measure of the level it lands at. */ const RECEIPT_HEADING_SCALE: Readonly<Record<"h2" | "h3" | "h4", string>> = { h2: "type-section-title", h3: "type-subsection-title", h4: "type-group-title" };
export type ReceiptHeadingLevel = keyof typeof RECEIPT_HEADING_TAG;
/** The closed per-item vocabulary, listed once so the set has a runtime form as well as a type. */ export const PER_ITEM_RESULT_STATES = ["accepted", "unchanged", "excluded", "failed"] as const;
export type PerItemResultState = (typeof PER_ITEM_RESULT_STATES)[number];
export const PER_ITEM_RESULT_STATUS: Readonly<Record<PerItemResultState, StatusBadgeSpec>> = { accepted: { label: "Accepted", tone: "positive" }, unchanged: { label: "Unchanged", tone: "neutral" }, excluded: { label: "Excluded", tone: "caution" }, failed: { label: "Failed", tone: "danger" } };
const NO_REASON_TEXT = "No reason was stated for this row.";
const PER_ITEM_HEADING = "Result for each row";
const NOT_STATED_TEXT = "Not stated";
const CONFLICT_CURRENT_LABEL = "The value the record holds now";
const CONFLICT_INPUT_LABEL = "Your input, kept as you entered it";
const CONFLICT_VALUE_CLASS = "min-w-0 rounded-md bg-muted p-2 text-sm whitespace-pre-wrap wrap-anywhere text-foreground";
const FIELD_KEY_SEPARATOR = /[_-]+/u;
const CAMEL_WORD_BREAK = /(?<=[a-z0-9])(?=[A-Z])/u;
function describeValue(value: unknown): string {
  if (value === null || value === undefined) return NOT_STATED_TEXT;
  if (typeof value === "string") return value.trim() === "" ? NOT_STATED_TEXT : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const text: unknown = JSON.stringify(value, null, 2);
    return typeof text === "string" ? text : NOT_STATED_TEXT;
  } catch {
    return NOT_STATED_TEXT;
  }
}
const Identifier = ({ value }: { readonly value: string }): ReactElement | null => (value.trim() === "" ? null : <bdi className="mono-identifier">{value}</bdi>);
function IdentifierGroup({ label, ids }: { readonly label: string; readonly ids: readonly string[] | undefined }): ReactElement | null {
  const values = (ids ?? []).filter((id) => id.trim() !== "");
  if (values.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        <ul className="flex min-w-0 flex-col gap-1">
          {values.map((id) => (
            <li key={id} className="min-w-0 wrap-anywhere">
              <Identifier value={id} />
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}
function ReceiptFacts({ revision, revisionLabel = "Revision", created, changed }: { readonly revision: string; readonly revisionLabel?: string; readonly created?: readonly string[] | undefined; readonly changed?: readonly string[] | undefined }): ReactElement | null {
  const hasRevision = revision.trim() !== "";
  if (!hasRevision && !hasFacts({ revision, created, changed })) return null;
  return (
    <dl className="flex min-w-0 flex-col gap-2 text-sm">
      {hasRevision ? (
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-muted-foreground">{revisionLabel}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <Identifier value={revision} />
          </dd>
        </div>
      ) : null}
      <IdentifierGroup label="Created" ids={created} />
      <IdentifierGroup label="Changed" ids={changed} />
    </dl>
  );
}
const ValueBlock = ({ label, value }: { readonly label: string; readonly value: unknown }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-1">
    <p className="text-sm font-medium">{label}</p>
    <pre dir="ltr" className="min-w-0 rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap wrap-anywhere text-foreground">
      {describeValue(value)}
    </pre>
  </div>
);
const ReceiptButton = ({ label, variant, onSelect }: { readonly label: string; readonly variant: "default" | "outline"; readonly onSelect: () => void }): ReactElement => (
  <Button type="button" variant={variant} size="sm" className={BUTTON_WRAP_CLASS} onClick={onSelect}>
    {label}
  </Button>
);
/** The word and tone of one per-item state, including a state the closed four do not name. */ export const perItemStatus = (state: string): StatusBadgeSpec => PER_ITEM_RESULT_STATUS[state as PerItemResultState] ?? { label: state.trim() === "" ? NOT_STATED_TEXT : state, tone: "muted" };
export type PerItemColumn = { readonly key: string; readonly label: string };
const PER_ITEM_CELL_CLASS = "min-w-0 border-b border-border px-2 py-2 align-top text-start wrap-anywhere";
const PER_ITEM_HEAD_CLASS = cn(PER_ITEM_CELL_CLASS, "font-medium text-muted-foreground");
export type PerItemResultsProps = { readonly items: readonly PerItemResult[]; readonly columns?: readonly PerItemColumn[]; readonly renderItemAction?: (item: PerItemResult) => ReactNode; readonly heading?: string; readonly className?: string };
/** One row per item, each carrying its own result. */ export function PerItemResults({ items, columns = [], renderItemAction, heading = PER_ITEM_HEADING, className }: PerItemResultsProps): ReactElement | null {
  const headingId = useId();
  if (items.length === 0) return null;
  const hasAction = renderItemAction !== undefined;
  const rows = items.map((item, index) => {
    const record: Readonly<Record<string, unknown>> = { ...item };
    const reason = item.reason?.trim() ?? "";
    const reasonOwed = item.state === "excluded" || item.state === "failed";
    return { key: `${item.targetId}-${String(index)}`, item, cells: columns.map((column) => ({ key: column.key, label: column.label, text: describeValue(record[column.key]) })), reason: reason === "" ? null : item.reason, reasonOwed: reason === "" && reasonOwed, action: renderItemAction?.(item) ?? null };
  });
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <p id={headingId} className="text-sm font-medium">
          {heading}
        </p>
        <p className="text-sm text-muted-foreground">{"Each row below reports its own result, and rows can differ, so read them one at a time rather than as one result for the whole batch."}</p>
      </div>
      <ul aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <li key={row.key} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-3">
            <p className="flex min-w-0 flex-wrap items-center gap-2">
              <Identifier value={row.item.targetId} />
              <StatusBadge {...perItemStatus(row.item.state)} />
            </p>
            {row.cells.map((cell) => (
              <p key={cell.key} className="min-w-0 text-sm wrap-anywhere">
                <span className="text-muted-foreground">{`${cell.label}: `}</span>
                {cell.text}
              </p>
            ))}
            {row.reason === null ? null : <p className="min-w-0 text-sm text-muted-foreground wrap-anywhere">{row.reason}</p>}
            {row.reasonOwed ? <p className="min-w-0 text-sm text-muted-foreground wrap-anywhere">{NO_REASON_TEXT}</p> : null}
            {row.action === null ? null : <p className="min-w-0">{row.action}</p>}
          </li>
        ))}
      </ul>
      <table aria-labelledby={headingId} className="hidden w-full table-fixed border-collapse text-sm sm:table">
        <thead>
          <tr>
            <th scope="col" className={PER_ITEM_HEAD_CLASS}>
              Row
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={PER_ITEM_HEAD_CLASS}>
                {column.label}
              </th>
            ))}
            <th scope="col" className={PER_ITEM_HEAD_CLASS}>
              Result
            </th>
            {hasAction ? (
              <th scope="col" className={PER_ITEM_HEAD_CLASS}>
                <span className="sr-only">Action</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className={PER_ITEM_CELL_CLASS}>
                <Identifier value={row.item.targetId} />
              </td>
              {row.cells.map((cell) => (
                <td key={cell.key} className={PER_ITEM_CELL_CLASS}>
                  {cell.text}
                </td>
              ))}
              <td className={PER_ITEM_CELL_CLASS}>
                <StatusBadge {...perItemStatus(row.item.state)} className="h-auto max-w-full py-0.5 text-center leading-tight whitespace-normal" />
                {row.reason === null ? null : <p className="mt-1 text-muted-foreground">{row.reason}</p>}
                {row.reasonOwed ? <p className="mt-1 text-muted-foreground">{NO_REASON_TEXT}</p> : null}
              </td>
              {hasAction ? <td className={cn(PER_ITEM_CELL_CLASS, "text-end")}>{row.action}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
function conflictFieldLabel(path: string, fieldLabels: Readonly<Record<string, string | undefined>> | undefined): string {
  const stated = fieldLabels?.[path]?.trim() ?? "";
  if (stated !== "") return stated;
  const name = path.slice(path.lastIndexOf(".") + 1);
  const words = name
    .split(FIELD_KEY_SEPARATOR)
    .flatMap((part) => part.split(CAMEL_WORD_BREAK))
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
  const text = words.join(" ");
  return text === "" ? name : text.charAt(0).toUpperCase() + text.slice(1);
}
/** The keys a record actually states, so a key holding no value is not read as a field. */ const statedKeys = (record: Record<string, unknown>): readonly string[] => Object.keys(record).filter((key) => record[key] !== undefined);
/** Whether the record's value agrees with every field the caller's input states for it, in any key order and in any order the keys were written. */ function valuesAgree(held: unknown, entered: unknown): boolean {
  if (held === entered) return true;
  return Array.isArray(entered) ? Array.isArray(held) && held.length === entered.length && entered.every((member: unknown, index: number) => valuesAgree(held[index], member)) : !isRecord(entered) ? false : isRecord(held) && statedKeys(entered).every((key) => key in held && valuesAgree(held[key], entered[key]));
}
type ConflictDifference = { readonly key: string; readonly label: string; readonly current: unknown; readonly input: unknown };
const labelledAt = (labels: Readonly<Record<string, string | undefined>> | undefined, path: string): boolean => (labels?.[path]?.trim() ?? "") !== "";
const labelledUnder = (labels: Readonly<Record<string, string | undefined>> | undefined, path: string): boolean => Object.keys(labels ?? {}).some((key) => key.startsWith(`${path}.`) && labelledAt(labels, key));
// The receipt lists only the fields the caller's input states that disagree with the record. The record's other fields — its revision, audience and source reference among them — are not part of what the caller proposed, so printing them would state a second revision beside the one the receipt names.
function conflictDifferences(current: unknown, preservedInput: unknown, fieldLabels: Readonly<Record<string, string | undefined>> | undefined): readonly ConflictDifference[] | null {
  if (!isRecord(current) || !isRecord(preservedInput)) return null;
  const statements: ConflictDifference[] = [];
  const stated = (path: string, held: unknown, entered: unknown): void => {
    statements.push({ key: path, label: conflictFieldLabel(path, fieldLabels), current: held, input: entered });
  };
  // A field the surface names as a whole is stated as a whole; one the surface names part by part is stated part by part, under the same words the form uses for it, so no unchanged part of the record is printed. A part the record does not state at all is stated as the value it holds for that part, which is none.
  function differing(held: unknown, entered: unknown, path: string): void {
    if (labelledUnder(fieldLabels, path)) {
      if (isRecord(held) && isRecord(entered)) {
        for (const key of statedKeys(entered)) {
          if (!valuesAgree(held[key], entered[key])) differing(held[key], entered[key], `${path}.${key}`);
        }
        return;
      }
      if (Array.isArray(held) && Array.isArray(entered) && held.length === entered.length) {
        entered.forEach((member: unknown, index: number) => {
          if (!valuesAgree(held[index], member)) differing(held[index], member, `${path}.${String(index)}`);
        });
        return;
      }
    }
    stated(path, held, entered);
  }
  for (const key of statedKeys(preservedInput)) {
    if (current[key] !== undefined && !valuesAgree(current[key], preservedInput[key])) differing(current[key], preservedInput[key], key);
  }
  return statements;
}
/** The fields a stale-revision conflict disagrees on, each with what the record holds beside what the caller entered. */ function ConflictFields({ fields }: { readonly fields: readonly ConflictDifference[] }): ReactElement {
  const headingId = useId();
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <p id={headingId} className="text-sm font-medium">
          {"Fields that differ"}
        </p>
        <p className="text-sm text-muted-foreground">{"Only the fields where the record and your input disagree are listed, each with the value the record holds now beside what you entered. Every other field of the record stays as it is, so it is not restated here."}</p>
      </div>
      <ul aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2 sm:hidden">
        {fields.map((field) => (
          <li key={field.key} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-3">
            <p className="text-sm font-medium wrap-anywhere">{field.label}</p>
            <p className="min-w-0 text-sm wrap-anywhere">
              <span className="text-muted-foreground">{`${CONFLICT_CURRENT_LABEL}: `}</span>
              <bdi dir="ltr" className="wrap-anywhere">
                {describeValue(field.current)}
              </bdi>
            </p>
            <p className="min-w-0 text-sm wrap-anywhere">
              <span className="text-muted-foreground">{`${CONFLICT_INPUT_LABEL}: `}</span>
              <bdi dir="ltr" className="wrap-anywhere">
                {describeValue(field.input)}
              </bdi>
            </p>
          </li>
        ))}
      </ul>
      <table aria-labelledby={headingId} className="hidden w-full table-fixed border-collapse text-sm sm:table">
        <thead>
          <tr>
            <th scope="col" className={PER_ITEM_HEAD_CLASS}>
              {"Field"}
            </th>
            <th scope="col" className={PER_ITEM_HEAD_CLASS}>
              {CONFLICT_CURRENT_LABEL}
            </th>
            <th scope="col" className={PER_ITEM_HEAD_CLASS}>
              {CONFLICT_INPUT_LABEL}
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.key}>
              <th scope="row" className={PER_ITEM_HEAD_CLASS}>
                {field.label}
              </th>
              <td className={PER_ITEM_CELL_CLASS}>
                <pre dir="ltr" className={CONFLICT_VALUE_CLASS}>
                  {describeValue(field.current)}
                </pre>
              </td>
              <td className={PER_ITEM_CELL_CLASS}>
                <pre dir="ltr" className={CONFLICT_VALUE_CLASS}>
                  {describeValue(field.input)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
const hasFacts = (outcome: { readonly revision: string; readonly created?: readonly string[] | undefined; readonly changed?: readonly string[] | undefined }): boolean => outcome.revision.trim() !== "" || (outcome.created ?? []).some((id) => id.trim() !== "") || (outcome.changed ?? []).some((id) => id.trim() !== "");
type ReceiptBody = { readonly summary: ReactNode; readonly details: ReactNode };
type ReceiptContext = {
  readonly run: (handler: (() => void) | undefined) => (() => void) | undefined;
  readonly onCheckResult: (() => void) | undefined;
  readonly onRetrySameWork: (() => void) | undefined;
  readonly onReapply: (() => void) | undefined;
  readonly perItemColumns: readonly PerItemColumn[] | undefined;
  readonly renderItemAction: ((item: PerItemResult) => ReactNode) | undefined;
  readonly fieldLabels: Readonly<Record<string, string | undefined>> | undefined;
};
function unknownRecoverySentence(offersCheck: boolean, offersReplay: boolean): string | null {
  if (offersCheck && offersReplay) return "Nothing here starts a second attempt: checking the result reads what happened, and retrying " + "sends this same operation, which answers with its original result instead of repeating the " + "effect.";
  return offersCheck ? "Nothing here starts a second attempt: checking the result reads what happened, and applies " + "nothing." : offersReplay ? "Nothing here starts a second attempt: retrying sends this same operation, which answers with " + "its original result instead of repeating the effect." : null;
}
const receipt = (summary: ReactNode, details: ReactNode): ReceiptBody => ({ summary, details });
function receiptBody(outcome: Exclude<MutationOutcome, { readonly outcome: "invalid" }>, context: ReceiptContext): ReceiptBody {
  switch (outcome.outcome) {
    case "accepted": {
      const items = outcome.items ?? [];
      const facts = hasFacts(outcome);
      const perItem = items.length === 0 ? null : <PerItemResults items={items} columns={context.perItemColumns} renderItemAction={context.renderItemAction} />;
      return receipt(
        <>
          <p>The change was applied once, and it stays on this page as the record of it.</p>
          <p>The revision below is what this record now stands at, and the next change has to present it.</p>
        </>,
        facts || perItem !== null ? (
          <>
            {facts ? <ReceiptFacts revision={outcome.revision} created={outcome.created} changed={outcome.changed} /> : null}
            {perItem}
          </>
        ) : null,
      );
    }
    case "alreadyAccepted":
      return receipt(
        <>
          <p>You sent this before, and the result stored for it came back unchanged: nothing was applied a second time and the revision did not advance.</p>
          <p>What appears below is what the earlier submission produced, not a new effect.</p>
        </>,
        <>
          {hasFacts(outcome) ? <ReceiptFacts revision={outcome.revision} /> : null}
          <ValueBlock label="The result stored for this operation" value={outcome.result} />
        </>,
      );
    case "unchanged":
      return receipt(<p>Nothing needed changing, so nothing happened: no history entry and no activity record was created.</p>, hasFacts(outcome) ? <ReceiptFacts revision={outcome.revision} /> : null);
    case "conflict": {
      const reapply = context.run(context.onReapply);
      const differences = conflictDifferences(outcome.current, outcome.preservedInput, context.fieldLabels);
      return receipt(
        <>
          <p>{outcome.reason === "stale-revision" ? "Someone else saved a change after you opened this record, so your change was not applied." : "This submission reused the identity of an earlier request with different content, so it was refused."}</p>
          <p>Your input is kept exactly as you entered it, beside the value the record holds now, and nothing was overwritten in either direction.</p>
          {reapply === undefined ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <ReceiptButton label="Re-apply my input" variant="default" onSelect={reapply} />
            </div>
          )}
        </>,
        <>
          <ReceiptFacts revision={outcome.currentRevision} revisionLabel="Current revision" />
          {differences === null ? (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <ValueBlock label={CONFLICT_CURRENT_LABEL} value={outcome.current} />
              <ValueBlock label={CONFLICT_INPUT_LABEL} value={outcome.preservedInput} />
            </div>
          ) : differences.length === 0 ? (
            <p className="text-sm text-pretty">{"Your input states no value the record holds differently, so no field is listed here: what this conflict refuses is the revision, not a value."}</p>
          ) : (
            <ConflictFields fields={differences} />
          )}
        </>,
      );
    }
    case "denied":
      return receipt(
        <>
          <p>This request was refused in the current session and scope, and nothing was changed.</p>
          <p>
            Reason <Identifier value={outcome.reasonCode} />.
          </p>
          <p>The answer is the same whether or not anything exists here, so nothing on this receipt states what you may not see.</p>
        </>,
        null,
      );
    case "unavailable": {
      const retry = context.run(context.onRetrySameWork);
      const guidance = outcome.guidance.trim();
      return receipt(
        <>
          <p>The source behind this work could not be reached, so this receipt reports the outage instead of an empty result or a zero.</p>
          <p>
            Source <bdi className="mono-identifier">{outcome.source.system}</bdi>, reference <bdi className="mono-identifier">{outcome.source.reference}</bdi>.
          </p>
          {guidance === "" ? null : <p>{outcome.guidance}</p>}
          {retry === undefined ? null : (
            <>
              <p>Retrying re-requests this same operation, so the service answers with the original result if the change had already been applied.</p>
              <div className="flex flex-wrap items-center gap-2">
                <ReceiptButton label="Retry the same request" variant="outline" onSelect={retry} />
              </div>
            </>
          )}
        </>,
        null,
      );
    }
    case "unknown": {
      const check = context.run(context.onCheckResult);
      const retry = context.run(context.onRetrySameWork);
      const recovery = unknownRecoverySentence(check !== undefined, retry !== undefined);
      return receipt(
        <>
          <p>This change may have been applied and its acknowledgement never arrived, so its result is not confirmed either way.</p>
          <p>
            Operation <Identifier value={outcome.operationId} />.
          </p>
          {recovery === null ? null : <p>{recovery}</p>}
          {check === undefined && retry === undefined ? null : (
            <div className="flex flex-wrap items-center gap-2">
              {check === undefined ? null : <ReceiptButton label="Check the result" variant="default" onSelect={check} />}
              {retry === undefined ? null : <ReceiptButton label="Retry the same request" variant="outline" onSelect={retry} />}
            </div>
          )}
        </>,
        null,
      );
    }
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unhandled mutation outcome: ${String(unhandled)}`);
    }
  }
}
type InvalidReceiptProps = { readonly outcome: InvalidOutcome; readonly title: string; readonly headingLevel: ReceiptHeadingLevel; readonly fieldLabels: Readonly<Record<string, string | undefined>> | undefined; readonly className: string | undefined };
function InvalidReceipt({ outcome, title, headingLevel, fieldLabels, className }: InvalidReceiptProps): ReactElement {
  const errors = fieldErrorsFromInvalid(outcome);
  if (errors.count > 0) return <FormErrorSummary errors={errors} labels={fieldLabels} title={title} description="Nothing was changed: correct the fields this submission names and submit again." headingLevel={headingLevel} className={className} />;
  const Heading = RECEIPT_HEADING_TAG[headingLevel];
  return (
    <Card data-slot="operation-result" data-outcome="invalid" className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>
          <Heading className={RECEIPT_HEADING_SCALE[RECEIPT_HEADING_TAG[headingLevel]]}>{title}</Heading>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p role="alert" className="type-supporting">
          The submission was refused before anything changed, and it named no field to correct. Nothing was applied.
        </p>
      </CardContent>
    </Card>
  );
}
/** The element a receipt states its outcome in: the outcome's own role, its accessible name, and the programmatic focus stop that lets a surface move a keyboard user onto it. */ const ANNOUNCED_REGION_SELECTOR = '[role="status"][tabindex], [role="alert"][tabindex]';
/** Moves focus onto the region a rendered receipt announces its outcome in, so a settled change is read where it is named rather than on an unnamed wrapper beside it; the container stands in only when the receipt it holds states no such region. */
export function focusAnnouncedRegion(container: HTMLElement | null): void {
  if (container === null) return;
  const region = container.querySelector<HTMLElement>(ANNOUNCED_REGION_SELECTOR);
  (region ?? container).focus();
}
export type OperationResultProps = {
  readonly outcome: MutationOutcome;
  readonly heading?: string;
  readonly headingLevel?: ReceiptHeadingLevel;
  readonly onCheckResult?: () => void;
  readonly onRetrySameWork?: () => void;
  readonly onReapply?: () => void;
  readonly perItemColumns?: readonly PerItemColumn[];
  readonly renderItemAction?: (item: PerItemResult) => ReactNode;
  readonly fieldLabels?: Readonly<Record<string, string | undefined>>;
  readonly className?: string;
};
/** The one receipt for a mutation outcome. */ export function OperationResult({ outcome, heading, headingLevel = 3, onCheckResult, onRetrySameWork, onReapply, perItemColumns, renderItemAction, fieldLabels, className }: OperationResultProps): ReactElement {
  const titleId = useId();
  const regionRef = useRef<HTMLDivElement | null>(null);
  const stated = heading?.trim() ?? "";
  const title = stated === "" ? OUTCOME_HEADINGS[outcome.outcome] : stated;
  const run = (handler: (() => void) | undefined): (() => void) | undefined =>
    handler === undefined
      ? undefined
      : () => {
          try {
            handler();
          } finally {
            regionRef.current?.focus();
          }
        };
  if (outcome.outcome === "invalid") return <InvalidReceipt outcome={outcome} title={title} headingLevel={headingLevel} fieldLabels={fieldLabels} className={className} />;
  const { summary, details } = receiptBody(outcome, { run, onCheckResult, onRetrySameWork, onReapply, perItemColumns, renderItemAction, fieldLabels });
  const Heading = RECEIPT_HEADING_TAG[headingLevel];
  return (
    <Card data-slot="operation-result" data-outcome={outcome.outcome} className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>
          <Heading id={titleId} className={RECEIPT_HEADING_SCALE[RECEIPT_HEADING_TAG[headingLevel]]}>
            {title}
          </Heading>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <div ref={regionRef} role={OUTCOME_SEVERITY[outcome.outcome] === "assertive" ? "alert" : "status"} aria-labelledby={titleId} tabIndex={-1} className="flex min-w-0 flex-col gap-3 text-sm">
          {summary}
        </div>
        {details === null ? null : (
          <>
            <Separator />
            <div className="flex min-w-0 flex-col gap-3">{details}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
export default OperationResult;
