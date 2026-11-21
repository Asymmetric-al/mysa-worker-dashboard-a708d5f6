"use client";
/**
 * The one durable receipt for a mutation outcome: the record of what happened that a person returns
 * to.
 */
import { useId, useRef, type ReactElement, type ReactNode } from "react";
import { fieldErrorsFromInvalid, FormErrorSummary } from "@/components/form-field";
import StatusBadge, { type StatusBadgeSpec } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { InvalidOutcome, MutationOutcome, PerItemResult } from "@/modules/data-service/outcome";
type OutcomeName = MutationOutcome["outcome"];
/** The two announcement priorities a live region can carry. */
export type AnnouncementSeverity = "polite" | "assertive";
/** Which outcomes announce politely and which assertively — the one place that decision is made. */
export const OUTCOME_SEVERITY: Readonly<Record<OutcomeName, AnnouncementSeverity>> = {
  accepted: "polite",
  alreadyAccepted: "polite",
  unchanged: "polite",
  invalid: "assertive",
  conflict: "assertive",
  denied: "assertive",
  unavailable: "assertive",
  unknown: "assertive",
};
/** The factual heading of each outcome. */
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
/** The heading level a receipt renders at when the caller states none. */
export type ReceiptHeadingLevel = keyof typeof RECEIPT_HEADING_TAG;
/** The closed per-item vocabulary, listed once so the set has a runtime form as well as a type. */
export const PER_ITEM_RESULT_STATES = ["accepted", "unchanged", "excluded", "failed"] as const;
/** One per-item state word. */
export type PerItemResultState = (typeof PER_ITEM_RESULT_STATES)[number];
/** The word and tone of each per-item state. */
export const PER_ITEM_RESULT_STATUS: Readonly<Record<PerItemResultState, StatusBadgeSpec>> = {
  accepted: { label: "Accepted", tone: "positive" },
  unchanged: { label: "Unchanged", tone: "neutral" },
  excluded: { label: "Excluded", tone: "caution" },
  failed: { label: "Failed", tone: "danger" },
};
const NO_REASON_TEXT = "No reason was stated for this row.";

const PER_ITEM_HEADING = "Result for each row";

const PER_ITEM_MIXED_NOTE = "Each row below reports its own result, and rows can differ, so read them one at a time rather than as one result for the whole batch.";

const NOT_STATED_TEXT = "Not stated";

function describeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return NOT_STATED_TEXT;
  }
  if (typeof value === "string") {
    return value.trim() === "" ? NOT_STATED_TEXT : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const text: unknown = JSON.stringify(value, null, 2);
    return typeof text === "string" ? text : NOT_STATED_TEXT;
  } catch {
    // A cyclic or otherwise unserialisable value states nothing rather than failing the receipt.
    return NOT_STATED_TEXT;
  }
}
function Identifier({ value }: { readonly value: string }): ReactElement | null {
  if (value.trim() === "") {
    return null;
  }
  return <bdi className="mono-identifier">{value}</bdi>;
}
function IdentifierGroup({ label, ids }: { readonly label: string; readonly ids: readonly string[] | undefined }): ReactElement | null {
  const values = (ids ?? []).filter((id) => id.trim() !== "");
  if (values.length === 0) {
    return null;
  }
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
function ReceiptFacts({
  revision,
  revisionLabel = "Revision",
  created,
  changed,
}: {
  readonly revision: string;
  readonly revisionLabel?: string;
  readonly created?: readonly string[] | undefined;
  readonly changed?: readonly string[] | undefined;
}): ReactElement | null {
  const hasRevision = revision.trim() !== "";
  const hasCreated = (created ?? []).some((id) => id.trim() !== "");
  const hasChanged = (changed ?? []).some((id) => id.trim() !== "");
  if (!hasRevision && !hasCreated && !hasChanged) {
    return null;
  }
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
function ValueBlock({ label, value }: { readonly label: string; readonly value: unknown }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-sm font-medium">{label}</p>
      <pre dir="ltr" className="min-w-0 rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap wrap-anywhere text-foreground">
        {describeValue(value)}
      </pre>
    </div>
  );
}
function ReceiptButton({ label, variant, onSelect }: { readonly label: string; readonly variant: "default" | "outline"; readonly onSelect: () => void }): ReactElement {
  return (
    <Button type="button" variant={variant} size="sm" className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal" onClick={onSelect}>
      {label}
    </Button>
  );
}
/** The word and tone of one per-item state, including a state the closed four do not name. */
export function perItemStatus(state: string): StatusBadgeSpec {
  const known: StatusBadgeSpec | undefined = PER_ITEM_RESULT_STATUS[state as PerItemResultState];
  if (known !== undefined) {
    return known;
  }
  return { label: state.trim() === "" ? NOT_STATED_TEXT : state, tone: "muted" };
}
/** One extra column a caller asks a per-item list to show. */
export interface PerItemColumn {
  readonly key: string;
  readonly label: string;
}
const PER_ITEM_CELL_CLASS = "min-w-0 border-b border-border px-2 py-2 align-top text-start wrap-anywhere";

const PER_ITEM_HEAD_CLASS = cn(PER_ITEM_CELL_CLASS, "font-medium text-muted-foreground");
/** Props of {@link PerItemResults}. */
export interface PerItemResultsProps {
  readonly items: readonly PerItemResult[];
  readonly columns?: readonly PerItemColumn[];
  readonly renderItemAction?: (item: PerItemResult) => ReactNode;
  readonly heading?: string;
  readonly className?: string;
}
/** One row per item, each carrying its own result. */
export function PerItemResults({ items, columns = [], renderItemAction, heading = PER_ITEM_HEADING, className }: PerItemResultsProps): ReactElement | null {
  const headingId = useId();
  if (items.length === 0) {
    return null;
  }
  const hasAction = renderItemAction !== undefined;
  const rows = items.map((item, index) => {
    const record: Readonly<Record<string, unknown>> = { ...item };
    const reason = item.reason?.trim() ?? "";
    const reasonOwed = item.state === "excluded" || item.state === "failed";
    return {
      key: `${item.targetId}-${String(index)}`,
      item,
      cells: columns.map((column) => ({
        key: column.key,
        label: column.label,
        text: describeValue(record[column.key]),
      })),
      reason: reason === "" ? null : item.reason,
      reasonOwed: reason === "" && reasonOwed,
      action: renderItemAction?.(item) ?? null,
    };
  });
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <p id={headingId} className="text-sm font-medium">
          {heading}
        </p>
        <p className="text-sm text-muted-foreground">{PER_ITEM_MIXED_NOTE}</p>
      </div>
      {/* Narrow: one labelled block per row, so nothing is squeezed into a column too narrow to
       * hold a state word or an identifier. */}
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
      {/* Wide: the same rows as a table, so columns line up and rows can be compared. */}
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
function hasFacts(outcome: { readonly revision: string; readonly created?: readonly string[] | undefined; readonly changed?: readonly string[] | undefined }): boolean {
  return outcome.revision.trim() !== "" || (outcome.created ?? []).some((id) => id.trim() !== "") || (outcome.changed ?? []).some((id) => id.trim() !== "");
}
interface ReceiptBody {
  readonly summary: ReactNode;
  readonly details: ReactNode;
}
interface ReceiptContext {
  readonly run: (handler: (() => void) | undefined) => (() => void) | undefined;
  readonly onCheckResult: (() => void) | undefined;
  readonly onRetrySameWork: (() => void) | undefined;
  readonly onReapply: (() => void) | undefined;
  readonly perItemColumns: readonly PerItemColumn[] | undefined;
  readonly renderItemAction: ((item: PerItemResult) => ReactNode) | undefined;
}
type ReceiptOutcome = Exclude<MutationOutcome, { readonly outcome: "invalid" }>;

function unknownRecoverySentence(offersCheck: boolean, offersReplay: boolean): string | null {
  if (offersCheck && offersReplay) {
    return (
      "Nothing here starts a second attempt: checking the result reads what happened, and retrying " +
      "sends this same operation, which answers with its original result instead of repeating the " +
      "effect."
    );
  }
  if (offersCheck) {
    return "Nothing here starts a second attempt: checking the result reads what happened, and applies " + "nothing.";
  }
  if (offersReplay) {
    return "Nothing here starts a second attempt: retrying sends this same operation, which answers with " + "its original result instead of repeating the effect.";
  }
  return null;
}
function receiptBody(outcome: ReceiptOutcome, context: ReceiptContext): ReceiptBody {
  switch (outcome.outcome) {
    case "accepted": {
      const items = outcome.items ?? [];
      const facts = hasFacts(outcome);
      const perItem = items.length === 0 ? null : <PerItemResults items={items} columns={context.perItemColumns} renderItemAction={context.renderItemAction} />;
      return {
        summary: (
          <>
            <p>The change was applied once, and it stays on this page as the record of it.</p>
            <p>The revision below is what this record now stands at, and the next change has to present it.</p>
          </>
        ),
        details:
          facts || perItem !== null ? (
            <>
              {facts ? <ReceiptFacts revision={outcome.revision} created={outcome.created} changed={outcome.changed} /> : null}
              {perItem}
            </>
          ) : null,
      };
    }
    case "alreadyAccepted":
      return {
        summary: (
          <>
            <p>You sent this before, and the result stored for it came back unchanged: nothing was applied a second time and the revision did not advance.</p>
            <p>What appears below is what the earlier submission produced, not a new effect.</p>
          </>
        ),
        details: (
          <>
            {hasFacts(outcome) ? <ReceiptFacts revision={outcome.revision} /> : null}
            <ValueBlock label="The result stored for this operation" value={outcome.result} />
          </>
        ),
      };
    case "unchanged":
      return {
        summary: <p>Nothing needed changing, so nothing happened: no history entry and no activity record was created.</p>,
        details: hasFacts(outcome) ? <ReceiptFacts revision={outcome.revision} /> : null,
      };
    case "conflict": {
      const reapply = context.run(context.onReapply);
      return {
        summary: (
          <>
            <p>
              {outcome.reason === "stale-revision"
                ? "Someone else saved a change after you opened this record, so your change was not applied."
                : "This submission reused the identity of an earlier request with different content, so it was refused."}
            </p>
            <p>Your input is kept exactly as you entered it, beside the value the record holds now, and nothing was overwritten in either direction.</p>
            {reapply === undefined ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <ReceiptButton label="Re-apply my input" variant="default" onSelect={reapply} />
              </div>
            )}
          </>
        ),
        details: (
          <>
            <ReceiptFacts revision={outcome.currentRevision} revisionLabel="Current revision" />
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <ValueBlock label="The value the record holds now" value={outcome.current} />
              <ValueBlock label="Your input, kept as you entered it" value={outcome.preservedInput} />
            </div>
          </>
        ),
      };
    }
    case "denied":
      return {
        summary: (
          <>
            <p>This request was refused in the current session and scope, and nothing was changed.</p>
            <p>
              Reason <Identifier value={outcome.reasonCode} />.
            </p>
            <p>The answer is the same whether or not anything exists here, so nothing on this receipt states what you may not see.</p>
          </>
        ),
        details: null,
      };
    case "unavailable": {
      const retry = context.run(context.onRetrySameWork);
      const guidance = outcome.guidance.trim();
      return {
        summary: (
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
          </>
        ),
        details: null,
      };
    }
    case "unknown": {
      const check = context.run(context.onCheckResult);
      const retry = context.run(context.onRetrySameWork);
      const recovery = unknownRecoverySentence(check !== undefined, retry !== undefined);
      return {
        summary: (
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
          </>
        ),
        details: null,
      };
    }
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unhandled mutation outcome: ${String(unhandled)}`);
    }
  }
}
interface InvalidReceiptProps {
  readonly outcome: InvalidOutcome;
  readonly title: string;
  readonly headingLevel: ReceiptHeadingLevel;
  readonly fieldLabels: Readonly<Record<string, string | undefined>> | undefined;
  readonly className: string | undefined;
}
function InvalidReceipt({ outcome, title, headingLevel, fieldLabels, className }: InvalidReceiptProps): ReactElement {
  const errors = fieldErrorsFromInvalid(outcome);
  if (errors.count > 0) {
    return (
      <FormErrorSummary
        errors={errors}
        labels={fieldLabels}
        title={title}
        description="Nothing was changed: correct the fields this submission names and submit again."
        headingLevel={headingLevel}
        className={className}
      />
    );
  }
  const Heading = RECEIPT_HEADING_TAG[headingLevel];
  return (
    <Card data-slot="operation-result" data-outcome="invalid" className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>
          <Heading>{title}</Heading>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p role="alert" className="text-sm">
          The submission was refused before anything changed, and it named no field to correct. Nothing was applied.
        </p>
      </CardContent>
    </Card>
  );
}
/** Props of {@link OperationResult}. */
export interface OperationResultProps {
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
}
/** The one receipt for a mutation outcome. */
export function OperationResult({
  outcome,
  heading,
  headingLevel = 3,
  onCheckResult,
  onRetrySameWork,
  onReapply,
  perItemColumns,
  renderItemAction,
  fieldLabels,
  className,
}: OperationResultProps): ReactElement {
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
  if (outcome.outcome === "invalid") {
    return <InvalidReceipt outcome={outcome} title={title} headingLevel={headingLevel} fieldLabels={fieldLabels} className={className} />;
  }
  const { summary, details } = receiptBody(outcome, {
    run,
    onCheckResult,
    onRetrySameWork,
    onReapply,
    perItemColumns,
    renderItemAction,
  });
  const Heading = RECEIPT_HEADING_TAG[headingLevel];
  return (
    <Card data-slot="operation-result" data-outcome={outcome.outcome} className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>
          <Heading id={titleId}>{title}</Heading>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {/* The frame is focusable so an action can return the keyboard position here, and the token
         * layer's `:focus-visible` outline is what makes that position visible — nothing is
         * suppressed here. The ring around a receipt region is the deliberate consequence: whoever
         * pressed an action on this receipt has to see where the reading position went instead of
         * guessing at it. The region announces its own sentences once. */}
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
