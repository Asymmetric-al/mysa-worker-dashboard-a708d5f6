"use client";

/**
 * The one durable receipt for a mutation outcome: the record of what happened that a person
 * returns to.
 *
 * AAP 0.3.4 makes the action result a shared concern with exactly one implementation, and 0.7.1
 * fixes the closed eight-outcome vocabulary every named mutation answers with. This file renders
 * that vocabulary and nothing else: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`,
 * `denied`, `invalid`, `unavailable` and `unknown` each get their own words, because each states a
 * genuinely different fact about what is true after the request.
 *
 * What it refuses to do:
 *
 * - It never disappears. There is no transient pop-up notification, no auto-dismiss and no timer
 *   anywhere in this file: a receipt is the proof of acceptance, so it stays in the page flow and
 *   survives a re-render, a navigation within the surface and a reload that re-queries by
 *   `operationId`. AAP 0.5.3 excludes the transient-notification components, and the registry items
 *   that would provide them, for exactly this reason.
 * - It never invents a state outside those eight. There is no queued, no pending-provider and no
 *   retrying-in-the-background arm, because this release has no queue, scheduler or provider
 *   (Rule 1 clause 1). A state that belongs to a domain — accepted by the simulated sender,
 *   delivered, read, withdrawn — belongs to that domain's own model.
 * - It never presents an undetermined effect as success or failure. `unknown` states plainly that
 *   the result is not confirmed, shows the `operationId` it is recovered by, and offers only a
 *   check of that operation or a replay of the same one — never a fresh attempt under a new key.
 * - It never reports a batch as one outcome. `PerItemResults` renders one row per item carrying
 *   that item's own word, so `accepted`, `unchanged`, `excluded` and `failed` rows sit side by side
 *   instead of collapsing into "done".
 * - It never reveals what a denial hides. The `denied` arm prints the closed reason code and
 *   nothing else: no count, no title, no size and no existence flag.
 *
 * Announced once, at one priority. `OUTCOME_SEVERITY` is the single place that decides which
 * outcomes speak politely and which assertively, and the region it names carries only the outcome's
 * sentences and the actions it permits, so a two-hundred-row batch is never read aloud whole. The
 * `invalid` arm delegates its one announcement to `FormErrorSummary`, which already takes focus and
 * speaks the field messages, so no second live region repeats the same failure.
 *
 * Numbers, direction and identity. No amount is formatted here: a receipt that mentions money
 * receives text the money module already produced, and no total is computed. Every opaque value — an
 * operation id, a revision, a created identifier, a reason code, a source reference — renders inside
 * `<bdi>` with the `mono-identifier` utility, so a leading zero survives and a Latin id inside a
 * right-to-left block cannot reorder the sentence around it. Direction is the surrounding block's:
 * only logical utilities are used, so the receipt mirrors its own alignment without setting a
 * `direction` property — with one deliberate exception, a value printed as indented JSON, which
 * declares `dir="ltr"` because that structure reads left to right regardless of where the receipt
 * itself sits. Every colour, radius and space resolves to a token declared once in
 * `styles/globals.css`, and no receipt relies on colour to separate a success from a refusal.
 *
 * Layering: this module imports its outcome contract from the data service and composes the
 * installed `Card`, `Button`, `Separator`, `StatusBadge` and `FormErrorSummary`. It reaches no
 * feature, no store and no HTTP client, holds no server value of its own, and generates no
 * identifier: the `operationId` is minted by the caller and only displayed here.
 */

import { useId, useRef, type ReactElement, type ReactNode } from "react";

import { fieldErrorsFromInvalid, FormErrorSummary } from "@/components/form-field";
import StatusBadge, { type StatusBadgeSpec } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type {
  InvalidOutcome,
  MutationOutcome,
  PerItemResult,
} from "@/modules/data-service/outcome";

/** The name of one member of the closed outcome set. */
type OutcomeName = MutationOutcome["outcome"];

/** The two announcement priorities a live region can carry. */
export type AnnouncementSeverity = "polite" | "assertive";

/**
 * Which outcomes announce politely and which assertively — the one place that decision is made.
 *
 * The three that report a completed, harmless result speak politely, because they confirm work the
 * person just asked for and must not interrupt what they do next. The five that ask for attention
 * speak assertively: a refusal, a stale revision, a refused submission, an unreadable source and an
 * unconfirmed effect all change what the person can do, so none may wait behind other speech.
 *
 * `invalid` is assertive as well, and its announcement is made once by `FormErrorSummary` — the
 * summary that takes focus and lists the field messages. That is why this file renders no second
 * live region for `invalid`: two assertive regions for one failed submission would speak the same
 * refusal twice.
 */
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

/**
 * The factual heading of each outcome.
 *
 * Each word states what is true and nothing more: "Saved" and "Already saved" are different facts
 * about how many times something happened, "Nothing to change" is a no-op rather than a save,
 * "Someone else changed this" names the reason the work was refused instead of blaming the person,
 * and "Result not confirmed" claims neither success nor failure. A caller may pass its own heading
 * when its surface has a more specific statement; the outcome's own sentences still state what
 * happened, so a heading can sharpen the word but never soften the fact.
 */
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

/** The heading elements a surrounding page can need; the level is the caller's, not the receipt's. */
const RECEIPT_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;

/** The heading level a receipt renders at when the caller states none. */
export type ReceiptHeadingLevel = keyof typeof RECEIPT_HEADING_TAG;

/**
 * The closed per-item vocabulary, listed once so the set has a runtime form as well as a type.
 *
 * These four are the words a row of a multi-row operation answers with, and they stay four because
 * they say four different things: the action reached the row, the row needed nothing, the row was
 * no longer eligible when the action ran, or nothing could be applied to it. A mutation whose rows
 * answer in its own words — an import row, a released edition — passes its states through
 * {@link perItemStatus}, which keeps an unknown word visible instead of silently mapping it onto one
 * of these.
 */
export const PER_ITEM_RESULT_STATES = ["accepted", "unchanged", "excluded", "failed"] as const;

/** One per-item state word. */
export type PerItemResultState = (typeof PER_ITEM_RESULT_STATES)[number];

/**
 * The word and tone of each per-item state.
 *
 * The tones reinforce the words rather than carry them: every row prints its own label, so a reader
 * of a greyscale print, or one who cannot resolve the tones, still reads which rows were applied and
 * which were not.
 */
export const PER_ITEM_RESULT_STATUS: Readonly<Record<PerItemResultState, StatusBadgeSpec>> = {
  accepted: { label: "Accepted", tone: "positive" },
  unchanged: { label: "Unchanged", tone: "neutral" },
  excluded: { label: "Excluded", tone: "caution" },
  failed: { label: "Failed", tone: "danger" },
};

/** The wording a row uses when the service stated no reason for its result. */
const NO_REASON_TEXT = "No reason was stated for this row.";

/** The heading a per-item list renders when the caller states none. */
const PER_ITEM_HEADING = "Result for each row";

/**
 * The sentence a mixed batch needs, so the rows are read one at a time.
 *
 * It is always rendered rather than only for batches that happen to differ: whether a batch is mixed
 * is not known until the results are read, and a sentence that appeared only sometimes would leave
 * the uniform-looking batch looking like one aggregate outcome.
 */
const PER_ITEM_MIXED_NOTE =
  "Each row below reports its own result, and rows can differ, so read them one at a time rather than as one result for the whole batch.";

/** The word a value-bearing cell prints when the service stated no value for it. */
const NOT_STATED_TEXT = "Not stated";

/**
 * The text one value renders as, whatever shape it arrives in.
 *
 * A conflict and a stored result carry `unknown` by contract, so this is the one place a receipt
 * turns such a value into readable text: a string prints as it stands, a number or a boolean prints
 * as itself, and anything structured prints as indented JSON so a record's fields stay legible
 * instead of being flattened into one line. `null`, `undefined` and a blank string print
 * {@link NOT_STATED_TEXT} rather than the literal words "null" or "undefined", because a receipt
 * that showed those would look like a value the person could act on.
 */
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

/**
 * One opaque identifier, isolated and monospaced.
 *
 * `mono-identifier` carries the monospace family, uniform digits and `unicode-bidi: isolate`, so an
 * operation id keeps its leading zeros and a Latin id inside a right-to-left block stays where the
 * sentence put it. The value renders verbatim — never trimmed, padded or re-cased — because an
 * identifier is displayed exactly as the service holds it. A blank value renders nothing at all,
 * since an empty isolated run would leave a gap in the sentence around it.
 */
function Identifier({ value }: { readonly value: string }): ReactElement | null {
  if (value.trim() === "") {
    return null;
  }
  return <bdi className="mono-identifier">{value}</bdi>;
}

/**
 * One group of identifiers under its own label.
 *
 * A list rather than a comma-separated run: an operation that created three records names three
 * identifiers, and each is its own line so a reader can copy one without picking it out of a
 * sentence. Nothing here counts or summarises them.
 */
function IdentifierGroup({
  label,
  ids,
}: {
  readonly label: string;
  readonly ids: readonly string[] | undefined;
}): ReactElement | null {
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

/**
 * The revision a record now stands at, and the identifiers the operation created or changed.
 *
 * The revision is stated because it is what the next change has to present: a receipt that said
 * only "saved" would leave the person without the value their next write needs
 * (`expectedRevision`). An operation that changed nothing of that kind passes no identifiers and
 * only the revision is listed.
 */
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

/**
 * One labelled value a receipt has to show in full — the current value beside a preserved input, or
 * the result stored for a repeated operation.
 *
 * It wraps rather than scrolls. A conflict can carry a whole record and the page may only ever
 * scroll horizontally inside a table's own labelled region, so the value is set as pre-formatted
 * text that breaks anywhere a word cannot: nothing is clipped at a phone width, and a zoomed reader
 * never has to pan a second scroll container to read what they typed.
 *
 * The block states its own `dir="ltr"`. A record printed as indented JSON is left-to-right
 * structured data — its braces, keys and colons have a fixed order — even when the values inside it
 * are right-to-left text, which the bidirectional algorithm then keeps intact within each string.
 * Inheriting a right-to-left base direction instead would reorder the punctuation around values that
 * must be read as themselves.
 */
function ValueBlock({
  label,
  value,
}: {
  readonly label: string;
  readonly value: unknown;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-sm font-medium">{label}</p>
      <pre
        dir="ltr"
        className="min-w-0 rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap wrap-anywhere text-foreground"
      >
        {describeValue(value)}
      </pre>
    </div>
  );
}

/**
 * One action a receipt offers.
 *
 * Every action is the design system's `Button` at its small height with the label allowed to wrap,
 * which keeps the target well above the 24x24 CSS px floor (WCAG 2.5.8) while a long label such as
 * "Retry the same request" still fits inside a 320 CSS px surface instead of painting past it.
 */
function ReceiptButton({
  label,
  variant,
  onSelect,
}: {
  readonly label: string;
  readonly variant: "default" | "outline";
  readonly onSelect: () => void;
}): ReactElement {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal"
      onClick={onSelect}
    >
      {label}
    </Button>
  );
}

/**
 * The word and tone of one per-item state, including a state the closed four do not name.
 *
 * A mutation whose rows answer in its own vocabulary — an import row, a released edition — keeps
 * that word rather than having it mapped onto one of the four, because mapping it would state
 * something the service never said. Such a word is painted in the quiet muted tone, which reads as
 * "the service's own word" instead of borrowing the meaning of a neighbouring state.
 */
export function perItemStatus(state: string): StatusBadgeSpec {
  const known: StatusBadgeSpec | undefined = PER_ITEM_RESULT_STATUS[state as PerItemResultState];
  if (known !== undefined) {
    return known;
  }
  return { label: state.trim() === "" ? NOT_STATED_TEXT : state, tone: "muted" };
}

/** One extra column a caller asks a per-item list to show. */
export interface PerItemColumn {
  /**
   * The field of the row this column prints: `targetId`, `revision`, `reasonCode`, or a scalar the
   * mutation added to its rows. A field the row does not carry prints {@link NOT_STATED_TEXT}.
   */
  readonly key: string;
  /** The column's header. A caller's own label, never a field path. */
  readonly label: string;
}

/** The cell treatment shared by a per-item row and its header, so the rules line up. */
const PER_ITEM_CELL_CLASS =
  "min-w-0 border-b border-border px-2 py-2 align-top text-start wrap-anywhere";

/** A header cell: the same rules and alignment as the cells under it, in the quiet label tone. */
const PER_ITEM_HEAD_CLASS = cn(PER_ITEM_CELL_CLASS, "font-medium text-muted-foreground");

/** Props of {@link PerItemResults}. */
export interface PerItemResultsProps {
  /** The rows the operation reported, in the order the mutation reported them. */
  readonly items: readonly PerItemResult[];
  /** Extra columns, in the order they should appear after the row's own identity. */
  readonly columns?: readonly PerItemColumn[];
  /**
   * A route to the record a row affected, or the correction it needs, rendered in the row's last
   * cell. The caller supplies the destination because only it knows which record the row addresses;
   * a row without one simply has no action.
   */
  readonly renderItemAction?: (item: PerItemResult) => ReactNode;
  /** The list's caption. Defaults to a plain statement of what the rows are. */
  readonly heading?: string;
  /** Layout classes for the list. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * One row per item, each carrying its own result.
 *
 * A multi-row operation has no single outcome, so this renders the rows and refuses to summarise
 * them: an operation that applied to nine rows and skipped one is nine "Accepted" rows and one
 * "Excluded" row, never "done". The visible note above the rows states that they can differ, because
 * a reader who sees only the first row of a uniform-looking batch would otherwise take it for the
 * whole result.
 *
 * Two presentations, one set of rows. A table is the right shape where there is room for columns,
 * and it is the shape a reader compares rows in; at a phone width, or in a narrow panel, the same
 * columns would each be a few characters wide, so the rows are set as labelled blocks instead. The
 * rows are derived once and both presentations read them, so the two can never disagree, and only
 * one of them is ever displayed, so a screen reader meets each row exactly once.
 *
 * Neither presentation scrolls sideways. A table may only scroll inside its own labelled region, and
 * this is not one: the table is fixed-layout with cells that break anywhere a word cannot fit, and a
 * state label wraps inside its column rather than painting over its neighbour.
 *
 * A row whose state is `excluded` or `failed` states that no reason was given when the service
 * supplied none — the two results a person must be able to question — while the two benign results
 * stay quiet rather than repeating a sentence on every row.
 */
export function PerItemResults({
  items,
  columns = [],
  renderItemAction,
  heading = PER_ITEM_HEADING,
  className,
}: PerItemResultsProps): ReactElement | null {
  const headingId = useId();
  if (items.length === 0) {
    return null;
  }
  const hasAction = renderItemAction !== undefined;

  /* The rows are read once, here, and both presentations render this list: `record` lets a
   * caller-named column reach a field the closed `PerItemResult` shape does not declare, and
   * nothing is written back, so a column naming a field a row lacks prints as not stated. */
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
          <li
            key={row.key}
            className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-3"
          >
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
            {row.reason === null ? null : (
              <p className="min-w-0 text-sm text-muted-foreground wrap-anywhere">{row.reason}</p>
            )}
            {row.reasonOwed ? (
              <p className="min-w-0 text-sm text-muted-foreground wrap-anywhere">
                {NO_REASON_TEXT}
              </p>
            ) : null}
            {row.action === null ? null : <p className="min-w-0">{row.action}</p>}
          </li>
        ))}
      </ul>

      {/* Wide: the same rows as a table, so columns line up and rows can be compared. */}
      <table
        aria-labelledby={headingId}
        className="hidden w-full table-fixed border-collapse text-sm sm:table"
      >
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
                <StatusBadge
                  {...perItemStatus(row.item.state)}
                  /* The label wraps inside its column instead of overrunning it: a fixed layout
                   * gives each column a share of the width, and a state word that cannot wrap
                   * would paint across the next cell. */
                  className="h-auto max-w-full py-0.5 text-center leading-tight whitespace-normal"
                />
                {row.reason === null ? null : (
                  <p className="mt-1 text-muted-foreground">{row.reason}</p>
                )}
                {row.reasonOwed ? (
                  <p className="mt-1 text-muted-foreground">{NO_REASON_TEXT}</p>
                ) : null}
              </td>
              {hasAction ? (
                <td className={cn(PER_ITEM_CELL_CLASS, "text-end")}>{row.action}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Whether an outcome's revision and identifiers give the facts block anything to state.
 *
 * The revision is mandatory by contract for the three outcomes that reach it, so this guards only
 * the degenerate case: a blank revision and no identifiers produce no block at all rather than an
 * empty definition list that a reader would take for a missing value.
 */
function hasFacts(outcome: {
  readonly revision: string;
  readonly created?: readonly string[] | undefined;
  readonly changed?: readonly string[] | undefined;
}): boolean {
  return (
    outcome.revision.trim() !== "" ||
    (outcome.created ?? []).some((id) => id.trim() !== "") ||
    (outcome.changed ?? []).some((id) => id.trim() !== "")
  );
}

/**
 * What a receipt shows in its two places: the sentences and permitted actions that go inside the
 * announcing region, and the details that sit below it once the announcement has been made.
 */
interface ReceiptBody {
  /** The outcome's own sentences and the actions it permits. Announced once, at one priority. */
  readonly summary: ReactNode;
  /** The facts a reader comes back to — a revision, identifiers, rows, a comparison — or null. */
  readonly details: ReactNode;
}

/** Everything an arm needs besides the outcome itself. */
interface ReceiptContext {
  /** Wraps one permitted action so the keyboard position stays on the receipt afterwards. */
  readonly run: (handler: (() => void) | undefined) => (() => void) | undefined;
  readonly onCheckResult: (() => void) | undefined;
  readonly onRetrySameWork: (() => void) | undefined;
  readonly onReapply: (() => void) | undefined;
  readonly perItemColumns: readonly PerItemColumn[] | undefined;
  readonly renderItemAction: ((item: PerItemResult) => ReactNode) | undefined;
}

/** The outcomes the receipt body states; `invalid` makes its own announcement instead. */
type ReceiptOutcome = Exclude<MutationOutcome, { readonly outcome: "invalid" }>;

/**
 * The sentence an `unknown` receipt states about the recovery it actually offers, or `null` when it
 * offers none.
 *
 * It is derived from the controls the caller supplied rather than fixed, because the two recoveries
 * are different acts. A check re-reads an operation that already exists and applies nothing; a replay
 * re-sends this same operation under the same identity and is answered with the stored result instead
 * of a second effect. A receipt that described both while rendering one would claim a read it does
 * not offer, or hide that the one control it does offer sends the mutation again. Every variant that
 * renders a control opens with the claim that holds for both: nothing here starts a second attempt.
 */
function unknownRecoverySentence(offersCheck: boolean, offersReplay: boolean): string | null {
  if (offersCheck && offersReplay) {
    return (
      "Nothing here starts a second attempt: checking the result reads what happened, and retrying " +
      "sends this same operation, which answers with its original result instead of repeating the " +
      "effect."
    );
  }
  if (offersCheck) {
    return (
      "Nothing here starts a second attempt: checking the result reads what happened, and applies " +
      "nothing."
    );
  }
  if (offersReplay) {
    return (
      "Nothing here starts a second attempt: retrying sends this same operation, which answers with " +
      "its original result instead of repeating the effect."
    );
  }
  return null;
}

/**
 * The sentences and facts one outcome renders.
 *
 * The switch is exhaustive over the seven outcomes that reach it, and its final branch refuses to
 * compile once `MutationOutcome` gains a member: `outcome` is `never` there only while every member
 * above is handled. Alongside `OUTCOME_HEADINGS` and `OUTCOME_SEVERITY` — both exhaustive records
 * over the same closed set — that is what stops a ninth outcome from reaching a surface without
 * words of its own.
 *
 * Each arm states only what its own outcome establishes. `accepted` says the change happened once;
 * `alreadyAccepted` says the stored result came back and nothing new happened; `unchanged` says no
 * history entry was written; `conflict` says the input was kept and never overwritten; `denied`
 * names the closed reason code and nothing the refusal hides; `unavailable` names the source and
 * the safe retry instead of an empty result; `unknown` claims neither success nor failure and puts
 * the `operationId` in front of the reader as the only recovery handle.
 */
function receiptBody(outcome: ReceiptOutcome, context: ReceiptContext): ReceiptBody {
  switch (outcome.outcome) {
    case "accepted": {
      const items = outcome.items ?? [];
      const facts = hasFacts(outcome);
      const perItem =
        items.length === 0 ? null : (
          <PerItemResults
            items={items}
            columns={context.perItemColumns}
            renderItemAction={context.renderItemAction}
          />
        );
      return {
        summary: (
          <>
            <p>The change was applied once, and it stays on this page as the record of it.</p>
            <p>
              The revision below is what this record now stands at, and the next change has to
              present it.
            </p>
          </>
        ),
        details:
          facts || perItem !== null ? (
            <>
              {facts ? (
                <ReceiptFacts
                  revision={outcome.revision}
                  created={outcome.created}
                  changed={outcome.changed}
                />
              ) : null}
              {perItem}
            </>
          ) : null,
      };
    }

    case "alreadyAccepted":
      return {
        summary: (
          <>
            <p>
              You sent this before, and the result stored for it came back unchanged: nothing was
              applied a second time and the revision did not advance.
            </p>
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
        summary: (
          <p>
            Nothing needed changing, so nothing happened: no history entry and no activity record
            was created.
          </p>
        ),
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
            <p>
              Your input is kept exactly as you entered it, beside the value the record holds now,
              and nothing was overwritten in either direction.
            </p>
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
              <ValueBlock
                label="Your input, kept as you entered it"
                value={outcome.preservedInput}
              />
            </div>
          </>
        ),
      };
    }

    case "denied":
      return {
        summary: (
          <>
            <p>
              This request was refused in the current session and scope, and nothing was changed.
            </p>
            <p>
              Reason <Identifier value={outcome.reasonCode} />.
            </p>
            <p>
              The answer is the same whether or not anything exists here, so nothing on this receipt
              states what you may not see.
            </p>
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
            <p>
              The source behind this work could not be reached, so this receipt reports the outage
              instead of an empty result or a zero.
            </p>
            <p>
              Source <bdi className="mono-identifier">{outcome.source.system}</bdi>, reference{" "}
              <bdi className="mono-identifier">{outcome.source.reference}</bdi>.
            </p>
            {guidance === "" ? null : <p>{outcome.guidance}</p>}
            {retry === undefined ? null : (
              <>
                <p>
                  Retrying re-requests this same operation, so the service answers with the original
                  result if the change had already been applied.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <ReceiptButton
                    label="Retry the same request"
                    variant="outline"
                    onSelect={retry}
                  />
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
            <p>
              This change may have been applied and its acknowledgement never arrived, so its result
              is not confirmed either way.
            </p>
            <p>
              Operation <Identifier value={outcome.operationId} />.
            </p>
            {recovery === null ? null : <p>{recovery}</p>}
            {check === undefined && retry === undefined ? null : (
              <div className="flex flex-wrap items-center gap-2">
                {check === undefined ? null : (
                  <ReceiptButton label="Check the result" variant="default" onSelect={check} />
                )}
                {retry === undefined ? null : (
                  <ReceiptButton
                    label="Retry the same request"
                    variant="outline"
                    onSelect={retry}
                  />
                )}
              </div>
            )}
          </>
        ),
        details: null,
      };
    }

    default: {
      /* Unreachable while every member above is handled: `outcome` is `never` here, so a ninth
       * outcome added to the closed set fails to compile at this assignment instead of reaching a
       * surface with no words for it. */
      const unhandled: never = outcome;
      throw new Error(`Unhandled mutation outcome: ${String(unhandled)}`);
    }
  }
}

/** What an `invalid` receipt needs; it makes the one announcement a refused submission deserves. */
interface InvalidReceiptProps {
  readonly outcome: InvalidOutcome;
  readonly title: string;
  readonly headingLevel: ReceiptHeadingLevel;
  readonly fieldLabels: Readonly<Record<string, string | undefined>> | undefined;
  readonly className: string | undefined;
}

/**
 * The receipt for a payload that failed validation.
 *
 * It delegates the announcement wholesale. `FormErrorSummary` already lists every message once, in
 * the form's reading order, links each entry to the control that carries it and takes focus as the
 * failure appears — so this file renders the summary rather than formatting messages here, and adds
 * no live region of its own that would speak the same failure a second time.
 *
 * A refusal that named no field still needs a receipt: the schema-level message is keyed
 * `ROOT_FIELD_KEY` and reaches the summary as a form-level entry, and a payload refused with no
 * message at all states that nothing was applied rather than rendering an empty alert.
 *
 * This arm therefore stands in the validation surface rather than in the receipt's own card, and
 * that is deliberate: a refused submission is the one outcome a person corrects inside the form, and
 * the summary that lists it has to look the same there and here. A second frame around the same
 * messages would present one failure in two visual languages, and a second heading would say the
 * same words twice.
 */
function InvalidReceipt({
  outcome,
  title,
  headingLevel,
  fieldLabels,
  className,
}: InvalidReceiptProps): ReactElement {
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
          The submission was refused before anything changed, and it named no field to correct.
          Nothing was applied.
        </p>
      </CardContent>
    </Card>
  );
}

/** Props of {@link OperationResult}. */
export interface OperationResultProps {
  /** The outcome the mutation answered with. One of the closed eight; there is no ninth. */
  readonly outcome: MutationOutcome;

  /**
   * The receipt's heading. Defaults to the outcome's own factual word from
   * {@link OUTCOME_HEADINGS}; a surface with a more specific statement may supply one, but the
   * outcome's sentences still state what happened.
   */
  readonly heading?: string;

  /** The heading level that fits the surrounding page. Defaults to 3. */
  readonly headingLevel?: ReceiptHeadingLevel;

  /**
   * Checks the result of the uncertain operation — offered by `unknown`, where re-reading what
   * happened is safe and applies nothing. Must re-query the same `operationId`.
   */
  readonly onCheckResult?: () => void;

  /**
   * Replays the same operation, for `unavailable` and `unknown`. It must send the same
   * `operationId`: a replay answers with the stored result rather than repeating the effect, which
   * is why no receipt ever offers to send the work again under a new identity.
   */
  readonly onRetrySameWork?: () => void;

  /**
   * Applies the preserved input against the current value, for `conflict`. The only way forward
   * from a conflict: the receipt never replaces what the person typed and never discards it.
   */
  readonly onReapply?: () => void;

  /** Extra columns for the per-item rows of a multi-row operation, in order. */
  readonly perItemColumns?: readonly PerItemColumn[];

  /** A route to the record a row affected, or the correction it needs, for a multi-row operation. */
  readonly renderItemAction?: (item: PerItemResult) => ReactNode;

  /** Display names by field path, so an `invalid` summary reads "Email" and not "emails.0.value". */
  readonly fieldLabels?: Readonly<Record<string, string | undefined>>;

  /** Layout classes for the receipt. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * The one receipt for a mutation outcome.
 *
 * Every mutation in the application renders its result through this component: a saved contact, a
 * bulk action over selected rows, an accepted import, a published edition, a submitted notice, a
 * coaching share, a goal save. That is what keeps one set of words on all of them, and what stops a
 * feature from writing its own success panel that quietly claims more than happened.
 *
 * The frame is a `Card` that stays in the page flow, and it holds two parts:
 *
 * - The announcing region, whose role comes from `OUTCOME_SEVERITY` and which contains only the
 *   outcome's sentences and the actions it permits. A batch of two hundred rows is therefore never
 *   read aloud in one pass; the person hears the result and the next step.
 * - The details below it, behind a rule: the revision, the identifiers, the comparison, the rows.
 *   They are what the reader returns to, and they are outside the region so that reading them is a
 *   deliberate act rather than part of the announcement.
 *
 * Actions stay on the receipt. After one is activated, focus returns to the region, because the
 * surface may have re-rendered the receipt into a different outcome and the control that was
 * focused may no longer exist; a keyboard user would otherwise land back at the top of the page.
 *
 * It holds no server value of its own, starts no timer, fetches nothing and mints no identifier: the
 * outcome, the `operationId` and every amount arrive from the caller, which is what makes a replay
 * the same attempt rather than a new one.
 */
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

  /**
   * Runs one permitted action, then returns the keyboard position to the receipt.
   *
   * `finally` rather than a plain call: an action whose handler throws must not strand focus on a
   * control that is about to disappear with the outcome it belonged to.
   */
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
    return (
      <InvalidReceipt
        outcome={outcome}
        title={title}
        headingLevel={headingLevel}
        fieldLabels={fieldLabels}
        className={className}
      />
    );
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
    <Card
      data-slot="operation-result"
      data-outcome={outcome.outcome}
      className={cn("min-w-0", className)}
    >
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
        <div
          ref={regionRef}
          role={OUTCOME_SEVERITY[outcome.outcome] === "assertive" ? "alert" : "status"}
          aria-labelledby={titleId}
          tabIndex={-1}
          className="flex min-w-0 flex-col gap-3 text-sm"
        >
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
