"use client";

/**
 * Contact import, step two — Map: the field each column of the chosen file would supply, shown as a
 * suggestion the worker confirms or changes.
 *
 * Scope: AAP 0.10.1 family "Contact import" ("a five-step journey (Choose file → Map → Validate and
 * review → Selectively accept → Results) over UTF-8 CSV within displayed limits, with per-row
 * decisions, negative-restriction preservation, a stable operation identity and a recoverable
 * receipt") and criterion 4; 0.11.1's `features/import/**` row. Step two only: this surface maps
 * columns to fields and confirms that mapping. It authorises no row, records no row decision, reuses
 * no existing contact and reads no data cell — every one of those belongs to a later step.
 *
 * It computes nothing. `@/modules/import/map` owns the closed target vocabulary, the suggestion, the
 * reasons a column is left out and the rule that refuses an unconfirmable mapping; the envelope
 * carries that suggestion and the chosen file's counts. This file renders those facts and collects
 * the one thing a surface can know and the domain cannot: what the worker decided about each column.
 *
 * Four meanings the rendering keeps apart, because in a mapping table they blur into "mapped":
 *
 * - A **suggestion** is not a decision. A column whose heading the vocabulary recognises starts on
 *   the domain's suggestion and says "Suggested"; nothing is treated as decided until Confirm.
 * - An **ambiguous** column is never guessed. A single-valued field two columns could supply is left
 *   exactly as the domain refuses it: the refusal's own sentence appears on both rows, both controls
 *   read as invalid, and Confirm is unavailable until the worker chooses one column or declines the
 *   field. This file fabricates no pick, and it states no refusal rule of its own.
 * - An **ignored** column stays visible with the domain's reason: no heading, an unrecognised
 *   heading, a fact this import never produces, or a field the worker declined.
 * - A **consent-looking** column is preserved as data and never interpreted. It renders the domain's
 *   reason and a text label saying so, and it carries no control that could give it meaning: no
 *   checkbox, no "subscribe", no "mark as consent". Importing a contact never subscribes anyone
 *   (AAP 0.8.5), so no control here could honour such an offer even if one existed.
 *
 * Columns are addressed by their 1-based position, never by their heading. The same heading can
 * appear twice, so "Email" in position 4 and "Email" in position 9 are two rows with their own
 * occurrence ordinals ("1 of 2", "2 of 2"), two controls and two decisions. Every list key here is a
 * position, and no heading is ever trimmed, folded, parsed or used as a key.
 *
 * Re-entering this step from a later one keeps the worker's confirmed choices (WCAG 3.3.7 Redundant
 * Entry): when the journey hands the confirmed mapping back, it seeds the controls, so the worker
 * re-reads a mapping instead of rebuilding it. Choices are also scoped to the file they were made
 * about — a changed file starts over, because a changed file has to be reviewed again.
 *
 * Direction is the surrounding block's: only logical utilities are used, and every heading, column
 * identifier and mixed-direction value is isolated in `<bdi>` so a right-to-left heading cannot
 * reorder the number beside it. There is one horizontal scroll port — the table's own labelled
 * region, from `md` and above; below `md` the same columns render as cards, so a 320 CSS px screen
 * never scrolls sideways and never loses a control. Ids are prefixed per branch, so the hidden
 * branch shares no id, is no tab stop, and contributes no second accessible name.
 */

import { useState, type ReactElement } from "react";

import { FormErrorSummary, FormField, type FieldErrorLookup } from "@/components/form-field";
import { ScrollRegion } from "@/components/scroll-region";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportProposalRecord, ReadEnvelope } from "@/modules/data-service/envelope";
import { IMPORT_FIELD_VOCABULARY, confirmMapping } from "@/modules/import/map";
import type {
  ImportColumnIgnoreReason,
  ImportColumnMapping,
  ImportConfirmedMapping,
  ImportFieldDescriptor,
  ImportFieldId,
  ImportIgnoredColumn,
  ImportMappingDecision,
  ImportMappingRefusal,
  ImportSuggestedMapping,
} from "@/modules/import/map";

import { TABLE_LABELS } from "../copy";

// ---------------------------------------------------------------------------------------------
// The payload this step reads
// ---------------------------------------------------------------------------------------------

/**
 * The proposal payload the Map step renders: the stored proposal, plus the suggestion the mapping
 * module derived from the same parsed file.
 *
 * It is a composition because the two halves are owned in two places and neither may be restated
 * here. `ImportProposalRecord` is the record the service stores and returns — the file it was given,
 * the counts it measured and the mapping it holds. `ImportSuggestedMapping` is the domain's own
 * suggestion, and the facts this step exists to show live only in it: the occurrence ordinal that
 * keeps two identical headings apart, the reason a column is ambiguous, and the reason a column is
 * left out. The stored record reports the mapping that was reached, not the proposal a worker is
 * asked to confirm, so a surface given only the record could not show a suggestion, name an
 * ambiguity or keep a repeated heading distinct. No member below is new: both are the exported
 * shapes, composed.
 */
export type ImportMappingProposal = ImportProposalRecord & {
  /** What step two proposes, from the mapping module's own suggestion over the parsed file. */
  readonly suggestion: ImportSuggestedMapping;
};

/** Props of {@link StepMapping}. */
export interface StepMappingProps {
  /** The proposal envelope: the chosen file, its counts, and the mapping the domain suggests. */
  readonly proposal: ReadEnvelope<ImportMappingProposal>;
  /** The mapping the worker confirmed, when the journey returns to this step; `null` before that. */
  readonly confirmedMapping: ImportConfirmedMapping | null;
  /**
   * Hands the confirmed mapping back to the journey, which mints a fresh operation identity for it:
   * confirming a different mapping is a changed intent, and only the journey may decide that.
   */
  readonly onConfirm: (mapping: ImportConfirmedMapping) => void;
  /** Whether the journey is already confirming this mapping. */
  readonly submitting: boolean;
  /** The messages an `invalid` outcome produced, exactly as the shared form pattern maps them. */
  readonly fieldErrors: FieldErrorLookup | null;
}

// ---------------------------------------------------------------------------------------------
// The worker's three answers about one column
// ---------------------------------------------------------------------------------------------

/**
 * What the worker can say about a column: take the field the heading suggests, name the field
 * explicitly, or leave the column out.
 *
 * There is no fourth answer, and none of them merges anything. This step maps a file's columns to
 * fields; whether a row becomes a new entry or attaches to a contact the worker already holds is
 * decided per row, later, on the review step's own suggestion.
 */
type ColumnChoice = "suggestion" | "ignore" | ImportFieldId;

const SUGGESTION_CHOICE = "suggestion" satisfies ColumnChoice;
const IGNORE_CHOICE = "ignore" satisfies ColumnChoice;

/**
 * The choice a column starts on.
 *
 * A column whose heading the vocabulary recognises starts on the domain's suggestion and is drawn as
 * one: taking it is a visible default the worker can change, and it becomes a decision only when
 * Confirm is pressed. A heading no field claims starts on "not used", because mapping a column nobody
 * has identified would be a guess; the domain's reason for leaving that column out is shown beside
 * it, and the worker can still map it deliberately.
 */
function initialChoice(column: ImportColumnMapping): ColumnChoice {
  return column.suggestedField === null ? IGNORE_CHOICE : SUGGESTION_CHOICE;
}

/** Reads one control's value back into the choice union, or `null` for a value it cannot mean. */
function readChoice(value: string): ColumnChoice | null {
  if (value === SUGGESTION_CHOICE) return SUGGESTION_CHOICE;
  if (value === IGNORE_CHOICE) return IGNORE_CHOICE;
  const descriptor = IMPORT_FIELD_VOCABULARY.find((field) => field.id === value);
  return descriptor === undefined ? null : descriptor.id;
}

/** The vocabulary entry a field id names, or `undefined` when it names none. */
function fieldDescriptorOf(fieldId: ImportFieldId | null): ImportFieldDescriptor | undefined {
  return fieldId === null
    ? undefined
    : IMPORT_FIELD_VOCABULARY.find((field) => field.id === fieldId);
}

// ---------------------------------------------------------------------------------------------
// The one thing the surface knows: which column the worker named for which field
// ---------------------------------------------------------------------------------------------

/** The choices made so far, and the file they were made about. */
interface ColumnEdits {
  readonly fileIdentity: string;
  readonly choices: Readonly<Record<number, ColumnChoice>>;
}

const NO_CHOICES: Readonly<Record<number, ColumnChoice>> = {};
const NO_REFUSALS: readonly ImportMappingRefusal[] = [];
const NO_FIELD_IDS: readonly ImportFieldId[] = [];
const NO_REFUSALS_BY_COLUMN: ReadonlyMap<number, readonly ImportMappingRefusal[]> = new Map();

/**
 * What identifies the file a mapping was made against.
 *
 * A different file has different columns, so choices made for the old one are discarded rather than
 * applied by position to a file they were never about — which is also why the sequence requires a
 * changed file to be reviewed again.
 */
function fileIdentityOf(proposal: ReadEnvelope<ImportMappingProposal>): string {
  const { name, bytes, rowCount, columnCount } = proposal.data.fileMeta;
  return JSON.stringify([name, bytes, rowCount, columnCount]);
}

/**
 * The choices the worker already confirmed, so re-entering this step keeps them.
 *
 * Only positions the confirmed mapping speaks about are seeded: an assignment becomes that field and
 * a column the mapping left out becomes "not used". A position it says nothing about keeps the
 * suggestion the worker originally saw, because the confirmation never spoke about it.
 */
function choicesFromConfirmation(
  confirmed: ImportConfirmedMapping | null,
): Readonly<Record<number, ColumnChoice>> {
  if (confirmed === null) return NO_CHOICES;
  const choices: Record<number, ColumnChoice> = {};
  for (const assignment of confirmed.assignments) {
    choices[assignment.columnIndex] = assignment.fieldId;
  }
  for (const ignored of confirmed.ignored) {
    if (choices[ignored.index] === undefined) choices[ignored.index] = IGNORE_CHOICE;
  }
  return choices;
}

/**
 * Turns the worker's per-column answers into the decisions the mapping module confirms.
 *
 * A field with a column named for it is chosen explicitly, so a field the worker has spoken about is
 * never filled from the suggestion behind their back. A field the worker has touched at all — by
 * declining one of its columns, or by moving one to another field — is pinned to the columns still
 * resting on the suggestion, so declining a column really does leave it out: the suggestion would
 * otherwise re-admit every column it claimed, and the row would say "Not used" about a column the
 * mapping still imported. A field left entirely on the suggestion is given no decision, because the
 * domain then applies a decisive suggestion and refuses an ambiguous one with its own sentence — so
 * an ambiguity can never be resolved by this file guessing.
 */
function decisionsFor(
  suggestion: ImportSuggestedMapping,
  choiceOf: (columnIndex: number) => ColumnChoice,
): readonly ImportMappingDecision[] {
  const decisions: ImportMappingDecision[] = [];
  for (const field of IMPORT_FIELD_VOCABULARY) {
    const explicit: number[] = [];
    for (const column of suggestion.columns) {
      if (choiceOf(column.index) === field.id) explicit.push(column.index);
    }
    if (explicit.length > 0) {
      decisions.push({ kind: "choose", fieldId: field.id, columnIndexes: explicit });
      continue;
    }

    const claim = suggestion.claims.find((candidate) => candidate.fieldId === field.id);
    if (claim === undefined) continue;

    const stillSuggested = claim.columnIndexes.filter(
      (columnIndex) => choiceOf(columnIndex) === SUGGESTION_CHOICE,
    );
    const spokenFor = claim.columnIndexes.some(
      (columnIndex) => choiceOf(columnIndex) !== SUGGESTION_CHOICE,
    );
    if (!spokenFor) continue;

    if (stillSuggested.length > 0) {
      decisions.push({ kind: "choose", fieldId: field.id, columnIndexes: stillSuggested });
      continue;
    }
    decisions.push({ kind: "decline", fieldId: field.id });
  }
  return decisions;
}

/** The refusals that name each column, so a row can show the sentence the domain produced for it. */
function refusalsByColumn(
  refusals: readonly ImportMappingRefusal[],
): ReadonlyMap<number, readonly ImportMappingRefusal[]> {
  if (refusals.length === 0) return NO_REFUSALS_BY_COLUMN;
  const byColumn = new Map<number, ImportMappingRefusal[]>();
  for (const refusal of refusals) {
    for (const columnIndex of refusal.columnIndexes) {
      const known = byColumn.get(columnIndex);
      if (known === undefined) byColumn.set(columnIndex, [refusal]);
      else if (!known.includes(refusal)) known.push(refusal);
    }
  }
  return byColumn;
}

/** Every refusal's message once, in the order the domain states them. */
function messagesOf(refusals: readonly ImportMappingRefusal[]): readonly string[] {
  const messages: string[] = [];
  for (const refusal of refusals) {
    if (!messages.includes(refusal.message)) messages.push(refusal.message);
  }
  return messages;
}

// ---------------------------------------------------------------------------------------------
// Status words: text first, badge tone only reinforces it
// ---------------------------------------------------------------------------------------------

/** The three reasons the domain never lets a column be mapped, not even by hand. */
type BlockedIgnoreReason = "blank-header" | "consent-preserved-as-data" | "excluded-topic";

function isBlockedReason(reason: ImportColumnIgnoreReason): reason is BlockedIgnoreReason {
  return (
    reason === "blank-header" ||
    reason === "consent-preserved-as-data" ||
    reason === "excluded-topic"
  );
}

/** What a column's status means; the kind decides which sentence the row shows beside it. */
type ColumnStatusKind = "blocked" | "refusal" | "chosen" | "ignored" | "suggested";

/** One status word and the badge tone that reinforces it. The word always carries the meaning. */
interface ColumnStatus {
  readonly kind: ColumnStatusKind;
  readonly label: string;
  readonly variant: "default" | "secondary" | "outline" | "destructive";
}

/**
 * How a column the domain keeps out of the mapping reads.
 *
 * The three words differ because the three cases ask different things of the worker: a heading that
 * says "Subscribed" is data this import preserves and never reads, a heading that names money or an
 * activity record is a fact this import does not produce, and a column with no heading has nothing
 * to identify it. None of them is a failure the worker caused.
 */
const BLOCKED_STATUS: Readonly<Record<BlockedIgnoreReason, ColumnStatus>> = {
  "consent-preserved-as-data": {
    kind: "blocked",
    label: "Kept as data, not interpreted",
    variant: "secondary",
  },
  "excluded-topic": { kind: "blocked", label: "Not imported", variant: "outline" },
  "blank-header": { kind: "blocked", label: "No heading, not mapped", variant: "outline" },
};

const AMBIGUOUS_STATUS: ColumnStatus = {
  kind: "refusal",
  label: "Ambiguous — choose one",
  variant: "destructive",
};
const CONFLICT_STATUS: ColumnStatus = {
  kind: "refusal",
  label: "Needs a different choice",
  variant: "destructive",
};
const SUGGESTED_STATUS: ColumnStatus = {
  kind: "suggested",
  label: "Suggested",
  variant: "secondary",
};
const CHOSEN_STATUS: ColumnStatus = { kind: "chosen", label: "Chosen by you", variant: "default" };
const NOT_USED_STATUS: ColumnStatus = { kind: "ignored", label: "Not used", variant: "outline" };
const UNMAPPED_STATUS: ColumnStatus = { kind: "ignored", label: "Not mapped", variant: "outline" };

/** How a column the mapping leaves out reads when the domain's reason is not one it blocks. */
function statusForIgnoreReason(reason: ImportColumnIgnoreReason): ColumnStatus {
  return reason === "unrecognised-header" ? UNMAPPED_STATUS : NOT_USED_STATUS;
}

// ---------------------------------------------------------------------------------------------
// Everything one row draws, decided once
// ---------------------------------------------------------------------------------------------

/** One column of the file, with the words and the state its row shows. */
interface ColumnView {
  readonly column: ImportColumnMapping;
  readonly choice: ColumnChoice;
  /** "1 of 2" when the same heading repeats; `null` when it is the heading's only column. */
  readonly occurrenceLabel: string | null;
  /** The field the heading suggests, in the domain's own words. */
  readonly suggestedLabel: string;
  readonly status: ColumnStatus;
  /** The domain's reason this column is not used; shown where no control carries it. */
  readonly reason: string | null;
  /** What the field in use is for, in the domain's own words. */
  readonly note: string | null;
  /** The refusals that name this column: they make its control invalid and hold back Confirm. */
  readonly errors: readonly string[];
}

interface ColumnViewInput {
  readonly suggestion: ImportSuggestedMapping;
  readonly ignored: readonly ImportIgnoredColumn[];
  readonly refusals: ReadonlyMap<number, readonly ImportMappingRefusal[]>;
  readonly choiceOf: (columnIndex: number) => ColumnChoice;
}

/**
 * Builds every row's view, in file order.
 *
 * The order of the checks is the meaning: a column the domain blocks is reported as blocked whatever
 * the control would say; a refusal outranks a choice, because the worker's choice is what cannot be
 * confirmed; a column the worker named for a field reads as their choice even under a refusal, since
 * that is what they did; and only then does an ignored column, a suggestion or a bare "not used"
 * follow. The reason sentence appears only for the two kinds whose whole story it is, so nothing is
 * said twice and no control is described by a sentence about a different state.
 */
function buildColumnViews(input: ColumnViewInput): readonly ColumnView[] {
  return input.suggestion.columns.map((column) => {
    const choice = input.choiceOf(column.index);
    const ignored = input.ignored.find((candidate) => candidate.index === column.index) ?? null;
    const refusals = input.refusals.get(column.index) ?? NO_REFUSALS;
    const errors = messagesOf(refusals);
    const repeated = input.suggestion.repeatedHeaders.find(
      (candidate) => candidate.header === column.header,
    );
    const suggested = fieldDescriptorOf(column.suggestedField);

    let status: ColumnStatus;
    if (ignored !== null && isBlockedReason(ignored.reason)) {
      status = BLOCKED_STATUS[ignored.reason];
    } else if (errors.length > 0) {
      status = refusals.every((refusal) => refusal.code === "field-ambiguous")
        ? AMBIGUOUS_STATUS
        : CONFLICT_STATUS;
    } else if (choice !== SUGGESTION_CHOICE && choice !== IGNORE_CHOICE) {
      status = CHOSEN_STATUS;
    } else if (ignored !== null) {
      status = statusForIgnoreReason(ignored.reason);
    } else if (choice === SUGGESTION_CHOICE) {
      status = SUGGESTED_STATUS;
    } else {
      status = NOT_USED_STATUS;
    }

    let usedFieldId: ImportFieldId | null = null;
    if (status.kind === "suggested") usedFieldId = column.suggestedField;
    else if (status.kind === "chosen" && choice !== SUGGESTION_CHOICE && choice !== IGNORE_CHOICE) {
      usedFieldId = choice;
    }
    const used = fieldDescriptorOf(usedFieldId);

    return {
      column,
      choice,
      occurrenceLabel:
        repeated === undefined || repeated.columnIndexes.length < 2
          ? null
          : `${String(column.occurrence)} of ${String(repeated.columnIndexes.length)}`,
      suggestedLabel: suggested === undefined ? NO_SUGGESTED_FIELD : suggested.label,
      status,
      reason:
        ignored !== null && (status.kind === "blocked" || status.kind === "ignored")
          ? ignored.message
          : null,
      note: used === undefined ? null : used.note,
      errors,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// The words this surface states for itself
// ---------------------------------------------------------------------------------------------
//
// Every sentence the domain produces — a suggestion, a refusal, the reason a column is left out —
// is rendered exactly as it arrives and is not restated here. These are the words no module owns:
// the lead that says what the step is asking, the two row states the choice model adds, and the
// preconditions the confirm action reports in its own words. `TABLE_LABELS.mapping` names the table
// region and its caption and is read from the copy module, never retyped.

const NO_SUGGESTED_FIELD = "No field suggested";
const NO_HEADING_TEXT = "This column has no heading";
const NOT_MAPPED = "Not mapped";
const NO_COLUMNS = "This file's heading row has no columns to map.";
const FIELD_LABEL_PREFIX = "Field for column";
const SUGGESTION_OPTION = "Use the suggested field";
const IGNORE_OPTION = "Do not import this column";

const MAPPING_LEAD =
  "Every field below is a suggestion read from the column headings. Change any of them, then confirm the mapping: confirming records which column supplies which field, and imports nothing by itself.";

const CONFIRM_BLOCKED_BY_CHOICE =
  "Resolve the choices marked on the rows above, then confirm the mapping.";

const CONFIRM_NEEDS_ONE_FIELD =
  "Map at least one field to a column before confirming: a mapping that pairs no field with a column would import nothing.";

const CONFIRM_NOTE =
  "Confirming records the column mapping only. No contact is created, no consent is recorded and nobody is subscribed.";

const CONFIRM_LABEL = "Confirm mapping";
const RECONFIRM_LABEL = "Confirm the updated mapping";
const CONFIRMING_LABEL = "Confirming the mapping…";

const REFUSAL_TITLE = "This mapping cannot be confirmed yet";
const REFUSAL_LEAD =
  "Each row marked below states what this mapping needs before the import can use it.";

const UNMAPPED_TITLE = "No column is mapped to";
const DECLINED_TITLE = "Left out by your choices";

const ERRORS_TITLE = "The mapping was not accepted";
const ERRORS_LEAD = "The service returned these messages. Nothing was imported.";

/** Display names for the paths a failure of this step can name, so an entry reads as a field. */
const SUMMARY_LABELS: Readonly<Record<string, string | undefined>> = {
  confirmedMapping: "Column mapping",
};

// ---------------------------------------------------------------------------------------------
// One column's control, status word and reason
// ---------------------------------------------------------------------------------------------

/** Props shared by the two presentations of one column. */
interface ColumnViewProps {
  readonly view: ColumnView;
  readonly disabled: boolean;
  readonly onChoose: (columnIndex: number, value: string) => void;
}

/** The same column, in the presentation that is rendering it; the branch keeps the control ids apart. */
interface ColumnControlProps extends ColumnViewProps {
  readonly branch: "table" | "card";
}

/**
 * The closed choice one column carries when the domain permits mapping it.
 *
 * A native select of the domain's own vocabulary plus the two answers the model adds — defer to the
 * suggestion, or leave the column out — because ten or so options over up to sixty columns is a
 * control a keyboard and a 320 px screen can still use, where a radio group per column could not.
 * The label names the column by position, which is its identity; the heading text is shown in the
 * row instead, so a heading in another script never becomes half of a control's accessible name. The
 * domain's reason for the column (and any refusal naming it) arrives as the description and the
 * message, so the select is never described by anything but its own facts.
 */
function ColumnControl({ view, branch, disabled, onChoose }: ColumnControlProps): ReactElement {
  const columnIndex = view.column.index;

  return (
    <FormField
      label={`${FIELD_LABEL_PREFIX} ${String(columnIndex)}`}
      name={`mapping-${branch}-${String(columnIndex)}`}
      hideLabel={branch === "table"}
      description={view.reason ?? undefined}
      error={view.errors}
    >
      {({ id, describedBy, invalid, required }) => (
        <NativeSelect
          id={id}
          className="w-full"
          value={view.choice}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          aria-required={required ? true : undefined}
          onChange={(event) => {
            onChoose(columnIndex, event.target.value);
          }}
        >
          <NativeSelectOption value={SUGGESTION_CHOICE}>{SUGGESTION_OPTION}</NativeSelectOption>
          {IMPORT_FIELD_VOCABULARY.map((field) => (
            <NativeSelectOption key={field.id} value={field.id}>
              {field.label}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value={IGNORE_CHOICE}>{IGNORE_OPTION}</NativeSelectOption>
        </NativeSelect>
      )}
    </FormField>
  );
}

/**
 * What the mapping makes of one column, in a word, with the sentence behind it.
 *
 * The word is always rendered, so no state depends on a badge tone: "Suggested", "Chosen by you",
 * "Not used", "Not mapped", "Kept as data, not interpreted", "Ambiguous — choose one" and "Needs a
 * different choice" are seven different things a worker can act on differently. The sentence under
 * the word is the domain's own — the reason the column is left out, or what the field in use holds —
 * and appears only where it is the whole story of the state above it.
 */
function ColumnStatusBlock({ view }: { readonly view: ColumnView }): ReactElement {
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={view.status.variant}>{view.status.label}</Badge>
      {view.reason === null ? null : <p className="text-sm text-muted-foreground">{view.reason}</p>}
      {view.note === null ? null : <p className="text-sm text-muted-foreground">{view.note}</p>}
    </div>
  );
}

/**
 * One column as a card, for a screen too narrow for the table.
 *
 * The same control, the same words and the same reason as the row it stands in for; only the layout
 * differs, so a worker on a phone makes exactly the decision a worker at a desk makes. The heading
 * text is isolated in `<bdi>` here too, and the occurrence ordinal sits under it, which is what keeps
 * two identical headings two distinguishable cards.
 */
function ColumnCard({ view, disabled, onChoose }: ColumnViewProps): ReactElement {
  const { column } = view;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Column <bdi>{String(column.index)}</bdi>
        </CardTitle>
        <CardDescription>
          {column.header === "" ? NO_HEADING_TEXT : <bdi>{column.header}</bdi>}
          {view.occurrenceLabel === null ? null : (
            <span className="block">{view.occurrenceLabel}</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">
          <span className="text-muted-foreground">Suggested field: </span>
          {view.suggestedLabel}
        </p>
        {view.status.kind === "blocked" ? (
          <p className="text-sm text-muted-foreground">{NOT_MAPPED}</p>
        ) : (
          <ColumnControl view={view} branch="card" disabled={disabled} onChoose={onChoose} />
        )}
        <ColumnStatusBlock view={view} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------------------------

/**
 * Step two of the contact import: the suggested field mapping, and the worker's confirmation of it.
 *
 * Holds the worker's per-column answers and nothing else. The mapping itself, every refusal, every
 * reason and every count come from the envelope and the mapping module, so this surface can disagree
 * with neither. Confirm is only ever pressed with the mapping the domain produced from those answers,
 * and the journey — not this file — mints the operation identity that makes the change a new intent.
 */
export default function StepMapping({
  proposal,
  confirmedMapping,
  onConfirm,
  submitting,
  fieldErrors,
}: StepMappingProps): ReactElement {
  const { suggestion } = proposal.data;
  const { name, rowCount, columnCount } = proposal.data.fileMeta;
  const fileIdentity = fileIdentityOf(proposal);

  const [edits, setEdits] = useState<ColumnEdits>({ fileIdentity, choices: NO_CHOICES });

  // Answers belong to the file they were made about: a changed file starts from its own suggestion
  // rather than inheriting positions from a file the worker was never shown.
  const retained = edits.fileIdentity === fileIdentity ? edits.choices : NO_CHOICES;
  const retainedFromConfirmation = choicesFromConfirmation(confirmedMapping);

  const choiceOf = (columnIndex: number): ColumnChoice => {
    const remembered = retained[columnIndex];
    if (remembered !== undefined) return remembered;
    const confirmed = retainedFromConfirmation[columnIndex];
    if (confirmed !== undefined) return confirmed;
    const column = suggestion.columns.find((candidate) => candidate.index === columnIndex);
    return column === undefined ? IGNORE_CHOICE : initialChoice(column);
  };

  const handleChoose = (columnIndex: number, value: string): void => {
    const choice = readChoice(value);
    if (choice === null) return;
    setEdits((previous) => {
      const base = previous.fileIdentity === fileIdentity ? previous.choices : NO_CHOICES;
      return { fileIdentity, choices: { ...base, [columnIndex]: choice } };
    });
  };

  // The domain is asked on every render rather than remembered here: confirming is a pure function of
  // the suggestion and the answers, and its refusals are the only place a column's problem is stated,
  // so a remembered copy could only disagree with what the rows are already showing.
  const confirmation = confirmMapping(suggestion, decisionsFor(suggestion, choiceOf));
  const refusals = confirmation.ok ? NO_REFUSALS : confirmation.refusals;
  const mapping = confirmation.ok ? confirmation.mapping : null;
  const ignored = mapping === null ? suggestion.ignored : mapping.ignored;
  const unmappedFields = mapping === null ? suggestion.unmapped : mapping.unmapped;
  const declinedFields = mapping === null ? NO_FIELD_IDS : mapping.declined;
  const unattributedRefusals = refusals.filter((refusal) => refusal.columnIndexes.length === 0);

  const views = buildColumnViews({
    suggestion,
    ignored,
    refusals: refusalsByColumn(refusals),
    choiceOf,
  });

  const canConfirm = mapping !== null && mapping.assignments.length > 0 && !submitting;

  const handleConfirm = (): void => {
    if (mapping === null || mapping.assignments.length === 0) return;
    onConfirm(mapping);
  };

  const confirmHint =
    mapping === null
      ? CONFIRM_BLOCKED_BY_CHOICE
      : mapping.assignments.length === 0
        ? CONFIRM_NEEDS_ONE_FIELD
        : CONFIRM_NOTE;

  const confirmLabel = submitting
    ? CONFIRMING_LABEL
    : confirmedMapping === null
      ? CONFIRM_LABEL
      : RECONFIRM_LABEL;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-sm">
        <p>
          <bdi>{name}</bdi> · <bdi>{String(rowCount)}</bdi> rows · <bdi>{String(columnCount)}</bdi>{" "}
          columns
        </p>
        <p className="text-muted-foreground">{MAPPING_LEAD}</p>
      </div>

      {fieldErrors === null || fieldErrors.count === 0 ? null : (
        <FormErrorSummary
          errors={fieldErrors}
          labels={SUMMARY_LABELS}
          title={ERRORS_TITLE}
          description={ERRORS_LEAD}
        />
      )}

      {refusals.length === 0 ? null : (
        <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">{REFUSAL_TITLE}</p>
          <p className="text-muted-foreground">{REFUSAL_LEAD}</p>
          {unattributedRefusals.length === 0 ? null : (
            <ul className="flex list-disc flex-col gap-1 ps-4 text-muted-foreground">
              {unattributedRefusals.map((refusal) => (
                <li key={`${refusal.code}-${refusal.fieldId ?? "any"}`}>{refusal.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {views.length === 0 ? (
        <p className="text-sm text-muted-foreground">{NO_COLUMNS}</p>
      ) : (
        <>
          {/* One horizontal scroll port, and only from `md` up: the region carries the accessible
           * name, the focus ring and the `scroll-padding` that keeps a focused select out from under
           * the sticky shell, and it is hidden rather than replaced below `md`, where the cards
           * carry the same controls so no id or accessible name exists twice. */}
          <ScrollRegion
            label={TABLE_LABELS.mapping}
            className="hidden md:block"
            aria-busy={submitting ? true : undefined}
          >
            <Table>
              <TableCaption className="sr-only">{TABLE_LABELS.mapping}</TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Column</TableHead>
                  <TableHead scope="col">Heading in the file</TableHead>
                  <TableHead scope="col">Suggested field</TableHead>
                  <TableHead scope="col">Field to import</TableHead>
                  <TableHead scope="col">Status and reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {views.map((view) => (
                  /* Every key is the column's position. The heading is never a key: the same
                   * heading can appear twice, and two columns sharing one key would collapse the
                   * second out of existence. */
                  <TableRow key={view.column.index}>
                    <TableHead scope="row" className="whitespace-normal align-top">
                      Column <bdi>{String(view.column.index)}</bdi>
                    </TableHead>
                    <TableCell className="whitespace-normal align-top">
                      {view.column.header === "" ? (
                        <span className="text-muted-foreground">{NO_HEADING_TEXT}</span>
                      ) : (
                        <bdi>{view.column.header}</bdi>
                      )}
                      {view.occurrenceLabel === null ? null : (
                        <span className="block text-muted-foreground">{view.occurrenceLabel}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">
                      {view.suggestedLabel}
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">
                      {view.status.kind === "blocked" ? (
                        <span className="text-muted-foreground">{NOT_MAPPED}</span>
                      ) : (
                        <ColumnControl
                          view={view}
                          branch="table"
                          disabled={submitting}
                          onChoose={handleChoose}
                        />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">
                      <ColumnStatusBlock view={view} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>

          <ul className="flex flex-col gap-4 md:hidden">
            {views.map((view) => (
              <li key={view.column.index}>
                <ColumnCard view={view} disabled={submitting} onChoose={handleChoose} />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-col gap-1 text-sm">
        {unmappedFields.length === 0 ? null : (
          <p className="text-muted-foreground">
            <span className="text-foreground">{UNMAPPED_TITLE} </span>
            {labelsOf(unmappedFields)}
          </p>
        )}
        {declinedFields.length === 0 ? null : (
          <p className="text-muted-foreground">
            <span className="text-foreground">{DECLINED_TITLE} </span>
            {labelsOf(declinedFields)}
          </p>
        )}
      </div>

      <Separator />

      <FormField
        label="Confirm the column mapping"
        name="confirmedMapping"
        description={confirmHint}
        error={fieldErrors === null ? undefined : fieldErrors.byField["confirmedMapping"]}
      >
        {({ id, describedBy }) => (
          /* A button carries no edit state, so it takes the id and the description and not
           * `aria-invalid`: the reasons that hold the mapping back are stated on the rows that own
           * them, and the control's own state would claim an input it does not have. */
          <Button
            id={id}
            aria-describedby={describedBy}
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        )}
      </FormField>
    </div>
  );
}

/** The fields a sentence names, in the vocabulary's own words. */
function labelsOf(fieldIds: readonly ImportFieldId[]): string {
  return fieldIds.map((fieldId) => fieldDescriptorOf(fieldId)?.label ?? fieldId).join(", ");
}
