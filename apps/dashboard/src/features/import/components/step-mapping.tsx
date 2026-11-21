"use client";
/**
 * Contact import, step two — Map: the field each column of the chosen file would supply, shown as a
 * suggestion the worker confirms or changes.
 */
import { useState, type ReactElement } from "react";
import { FormErrorSummary, FormField, type FieldErrorLookup } from "@/components/form-field";
import { ScrollRegion } from "@/components/scroll-region";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
// The payload this step reads
/** The proposal payload the Map step renders: the stored proposal, plus the suggestion the mapping module derived from the same parsed file. */
export type ImportMappingProposal = ImportProposalRecord & {
  readonly suggestion: ImportSuggestedMapping;
};
/** Props of {@link StepMapping}. */
export interface StepMappingProps {
  readonly proposal: ReadEnvelope<ImportMappingProposal>;
  readonly confirmedMapping: ImportConfirmedMapping | null;
  readonly onConfirm: (mapping: ImportConfirmedMapping) => void;
  readonly submitting: boolean;
  readonly fieldErrors: FieldErrorLookup | null;
}
// The worker's three answers about one column
type ColumnChoice = "suggestion" | "ignore" | ImportFieldId;

const SUGGESTION_CHOICE = "suggestion" satisfies ColumnChoice;
const IGNORE_CHOICE = "ignore" satisfies ColumnChoice;

function initialChoice(column: ImportColumnMapping): ColumnChoice {
  return column.suggestedField === null ? IGNORE_CHOICE : SUGGESTION_CHOICE;
}
function readChoice(value: string): ColumnChoice | null {
  if (value === SUGGESTION_CHOICE) return SUGGESTION_CHOICE;
  if (value === IGNORE_CHOICE) return IGNORE_CHOICE;
  const descriptor = IMPORT_FIELD_VOCABULARY.find((field) => field.id === value);
  return descriptor === undefined ? null : descriptor.id;
}
function fieldDescriptorOf(fieldId: ImportFieldId | null): ImportFieldDescriptor | undefined {
  return fieldId === null ? undefined : IMPORT_FIELD_VOCABULARY.find((field) => field.id === fieldId);
}
// The one thing the surface knows: which column the worker named for which field
interface ColumnEdits {
  readonly fileIdentity: string;
  readonly choices: Readonly<Record<number, ColumnChoice>>;
}
const NO_CHOICES: Readonly<Record<number, ColumnChoice>> = {};
const NO_REFUSALS: readonly ImportMappingRefusal[] = [];
const NO_FIELD_IDS: readonly ImportFieldId[] = [];
const NO_REFUSALS_BY_COLUMN: ReadonlyMap<number, readonly ImportMappingRefusal[]> = new Map();

function fileIdentityOf(proposal: ReadEnvelope<ImportMappingProposal>): string {
  const { name, bytes, rowCount, columnCount } = proposal.data.fileMeta;
  return JSON.stringify([name, bytes, rowCount, columnCount]);
}
function choicesFromConfirmation(confirmed: ImportConfirmedMapping | null): Readonly<Record<number, ColumnChoice>> {
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
function decisionsFor(suggestion: ImportSuggestedMapping, choiceOf: (columnIndex: number) => ColumnChoice): readonly ImportMappingDecision[] {
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
    const stillSuggested = claim.columnIndexes.filter((columnIndex) => choiceOf(columnIndex) === SUGGESTION_CHOICE);
    const spokenFor = claim.columnIndexes.some((columnIndex) => choiceOf(columnIndex) !== SUGGESTION_CHOICE);
    if (!spokenFor) continue;
    if (stillSuggested.length > 0) {
      decisions.push({ kind: "choose", fieldId: field.id, columnIndexes: stillSuggested });
      continue;
    }
    decisions.push({ kind: "decline", fieldId: field.id });
  }
  return decisions;
}
function refusalsByColumn(refusals: readonly ImportMappingRefusal[]): ReadonlyMap<number, readonly ImportMappingRefusal[]> {
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
function messagesOf(refusals: readonly ImportMappingRefusal[]): readonly string[] {
  const messages: string[] = [];
  for (const refusal of refusals) {
    if (!messages.includes(refusal.message)) messages.push(refusal.message);
  }
  return messages;
}
// Status words: text first, badge tone only reinforces it
type BlockedIgnoreReason = "blank-header" | "consent-preserved-as-data" | "excluded-topic";

function isBlockedReason(reason: ImportColumnIgnoreReason): reason is BlockedIgnoreReason {
  return reason === "blank-header" || reason === "consent-preserved-as-data" || reason === "excluded-topic";
}
type ColumnStatusKind = "blocked" | "refusal" | "chosen" | "ignored" | "suggested";

interface ColumnStatus {
  readonly kind: ColumnStatusKind;
  readonly label: string;
  readonly variant: "default" | "secondary" | "outline" | "destructive";
}
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

function statusForIgnoreReason(reason: ImportColumnIgnoreReason): ColumnStatus {
  return reason === "unrecognised-header" ? UNMAPPED_STATUS : NOT_USED_STATUS;
}
// Everything one row draws, decided once
interface ColumnView {
  readonly column: ImportColumnMapping;
  readonly choice: ColumnChoice;
  readonly occurrenceLabel: string | null;
  readonly suggestedLabel: string;
  readonly status: ColumnStatus;
  readonly reason: string | null;
  readonly note: string | null;
  readonly errors: readonly string[];
}
interface ColumnViewInput {
  readonly suggestion: ImportSuggestedMapping;
  readonly ignored: readonly ImportIgnoredColumn[];
  readonly refusals: ReadonlyMap<number, readonly ImportMappingRefusal[]>;
  readonly choiceOf: (columnIndex: number) => ColumnChoice;
}
function buildColumnViews(input: ColumnViewInput): readonly ColumnView[] {
  return input.suggestion.columns.map((column) => {
    const choice = input.choiceOf(column.index);
    const ignored = input.ignored.find((candidate) => candidate.index === column.index) ?? null;
    const refusals = input.refusals.get(column.index) ?? NO_REFUSALS;
    const errors = messagesOf(refusals);
    const repeated = input.suggestion.repeatedHeaders.find((candidate) => candidate.header === column.header);
    const suggested = fieldDescriptorOf(column.suggestedField);
    let status: ColumnStatus;
    if (ignored !== null && isBlockedReason(ignored.reason)) {
      status = BLOCKED_STATUS[ignored.reason];
    } else if (errors.length > 0) {
      status = refusals.every((refusal) => refusal.code === "field-ambiguous") ? AMBIGUOUS_STATUS : CONFLICT_STATUS;
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
      occurrenceLabel: repeated === undefined || repeated.columnIndexes.length < 2 ? null : `${String(column.occurrence)} of ${String(repeated.columnIndexes.length)}`,
      suggestedLabel: suggested === undefined ? NO_SUGGESTED_FIELD : suggested.label,
      status,
      reason: ignored !== null && (status.kind === "blocked" || status.kind === "ignored") ? ignored.message : null,
      note: used === undefined ? null : used.note,
      errors,
    };
  });
}
// The words this surface states for itself
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
const CONFIRM_BLOCKED_BY_CHOICE = "Resolve the choices marked on the rows above, then confirm the mapping.";

const CONFIRM_NEEDS_ONE_FIELD = "Map at least one field to a column before confirming: a mapping that pairs no field with a column would import nothing.";

const CONFIRM_NOTE = "Confirming records the column mapping only. No contact is created, no consent is recorded and nobody is subscribed.";

const CONFIRM_LABEL = "Confirm mapping";
const RECONFIRM_LABEL = "Confirm the updated mapping";
const CONFIRMING_LABEL = "Confirming the mapping…";

const REFUSAL_TITLE = "This mapping cannot be confirmed yet";
const REFUSAL_LEAD = "Each row marked below states what this mapping needs before the import can use it.";

const UNMAPPED_TITLE = "No column is mapped to";
const DECLINED_TITLE = "Left out by your choices";

const ERRORS_TITLE = "The mapping was not accepted";
const ERRORS_LEAD = "The service returned these messages. Nothing was imported.";

const SUMMARY_LABELS: Readonly<Record<string, string | undefined>> = {
  confirmedMapping: "Column mapping",
};
// One column's control, status word and reason
interface ColumnViewProps {
  readonly view: ColumnView;
  readonly disabled: boolean;
  readonly onChoose: (columnIndex: number, value: string) => void;
}
interface ColumnControlProps extends ColumnViewProps {
  readonly branch: "table" | "card";
}
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
function ColumnStatusBlock({ view }: { readonly view: ColumnView }): ReactElement {
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={view.status.variant}>{view.status.label}</Badge>
      {view.reason === null ? null : <p className="text-sm text-muted-foreground">{view.reason}</p>}
      {view.note === null ? null : <p className="text-sm text-muted-foreground">{view.note}</p>}
    </div>
  );
}
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
          {view.occurrenceLabel === null ? null : <span className="block">{view.occurrenceLabel}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">
          <span className="text-muted-foreground">Suggested field: </span>
          {view.suggestedLabel}
        </p>
        {view.status.kind === "blocked" ? <p className="text-sm text-muted-foreground">{NOT_MAPPED}</p> : <ColumnControl view={view} branch="card" disabled={disabled} onChoose={onChoose} />}
        <ColumnStatusBlock view={view} />
      </CardContent>
    </Card>
  );
}
// The step
/** Step two of the contact import: the suggested field mapping, and the worker's confirmation of it. */
export default function StepMapping({ proposal, confirmedMapping, onConfirm, submitting, fieldErrors }: StepMappingProps): ReactElement {
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
  const confirmHint = mapping === null ? CONFIRM_BLOCKED_BY_CHOICE : mapping.assignments.length === 0 ? CONFIRM_NEEDS_ONE_FIELD : CONFIRM_NOTE;
  const confirmLabel = submitting ? CONFIRMING_LABEL : confirmedMapping === null ? CONFIRM_LABEL : RECONFIRM_LABEL;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-sm">
        <p>
          <bdi>{name}</bdi> · <bdi>{String(rowCount)}</bdi> rows · <bdi>{String(columnCount)}</bdi> columns
        </p>
        <p className="text-muted-foreground">{MAPPING_LEAD}</p>
      </div>
      {fieldErrors === null || fieldErrors.count === 0 ? null : <FormErrorSummary errors={fieldErrors} labels={SUMMARY_LABELS} title={ERRORS_TITLE} description={ERRORS_LEAD} />}
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
          <ScrollRegion label={TABLE_LABELS.mapping} className="hidden md:block" aria-busy={submitting ? true : undefined}>
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
                  <TableRow key={view.column.index}>
                    <TableHead scope="row" className="whitespace-normal align-top">
                      Column <bdi>{String(view.column.index)}</bdi>
                    </TableHead>
                    <TableCell className="whitespace-normal align-top">
                      {view.column.header === "" ? <span className="text-muted-foreground">{NO_HEADING_TEXT}</span> : <bdi>{view.column.header}</bdi>}
                      {view.occurrenceLabel === null ? null : <span className="block text-muted-foreground">{view.occurrenceLabel}</span>}
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">{view.suggestedLabel}</TableCell>
                    <TableCell className="whitespace-normal align-top">
                      {view.status.kind === "blocked" ? (
                        <span className="text-muted-foreground">{NOT_MAPPED}</span>
                      ) : (
                        <ColumnControl view={view} branch="table" disabled={submitting} onChoose={handleChoose} />
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
      <FormField label="Confirm the column mapping" name="confirmedMapping" description={confirmHint} error={fieldErrors === null ? undefined : fieldErrors.byField["confirmedMapping"]}>
        {({ id, describedBy }) => (
          <Button id={id} aria-describedby={describedBy} type="button" disabled={!canConfirm} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        )}
      </FormField>
    </div>
  );
}
function labelsOf(fieldIds: readonly ImportFieldId[]): string {
  return fieldIds.map((fieldId) => fieldDescriptorOf(fieldId)?.label ?? fieldId).join(", ");
}
