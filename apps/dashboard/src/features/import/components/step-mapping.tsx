"use client";
import { useState, type ReactElement } from "react";
import { FormErrorSummary, FormField, type FieldErrorLookup } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { ImportProposalRecord, ReadEnvelope } from "@/modules/data-service/envelope";
import { IMPORT_FIELD_VOCABULARY, confirmMapping } from "@/modules/import/map";
import type { ImportColumnMapping, ImportConfirmedMapping, ImportFieldDescriptor, ImportFieldId, ImportIgnoredColumn, ImportMappingDecision, ImportMappingRefusal, ImportSuggestedMapping } from "@/modules/import/map";
import { MAPPING_COPY, TABLE_LABELS } from "../copy";
import ImportTable from "./import-table";
export type ImportMappingProposal = ImportProposalRecord & { readonly suggestion: ImportSuggestedMapping };
export type StepMappingProps = { readonly proposal: ReadEnvelope<ImportMappingProposal>; readonly confirmedMapping: ImportConfirmedMapping | null; readonly onConfirm: (mapping: ImportConfirmedMapping) => void; readonly submitting: boolean; readonly fieldErrors: FieldErrorLookup | null };
const MAPPING_HEADINGS: readonly string[] = ["Column", "Heading in the file", "Suggested field", "Field to import", "Status and reason"];
type ColumnChoice = "suggestion" | "ignore" | ImportFieldId;
const SUGGESTION_CHOICE = "suggestion" satisfies ColumnChoice;
const IGNORE_CHOICE = "ignore" satisfies ColumnChoice;
const initialChoice = (column: ImportColumnMapping): ColumnChoice => (column.suggestedField === null ? IGNORE_CHOICE : SUGGESTION_CHOICE);
const readChoice = (value: string): ColumnChoice | null => (value === SUGGESTION_CHOICE ? SUGGESTION_CHOICE : value === IGNORE_CHOICE ? IGNORE_CHOICE : (IMPORT_FIELD_VOCABULARY.find((field) => field.id === value)?.id ?? null));
const fieldDescriptorOf = (fieldId: ImportFieldId | null): ImportFieldDescriptor | undefined => (fieldId === null ? undefined : IMPORT_FIELD_VOCABULARY.find((field) => field.id === fieldId));
type ColumnEdits = { readonly fileIdentity: string; readonly choices: Readonly<Record<number, ColumnChoice>> };
const NO_CHOICES: Readonly<Record<number, ColumnChoice>> = {};
const NO_REFUSALS: readonly ImportMappingRefusal[] = [];
const NO_FIELD_IDS: readonly ImportFieldId[] = [];
const fileIdentityOf = (proposal: ReadEnvelope<ImportMappingProposal>): string => JSON.stringify([proposal.data.fileMeta.name, proposal.data.fileMeta.bytes, proposal.data.fileMeta.rowCount, proposal.data.fileMeta.columnCount]);
const choicesFromConfirmation = (confirmed: ImportConfirmedMapping | null): Readonly<Record<number, ColumnChoice>> =>
  confirmed === null
    ? NO_CHOICES
    : Object.fromEntries([...confirmed.assignments.map((assignment) => [assignment.columnIndex, assignment.fieldId] as const), ...confirmed.ignored.filter((ignored) => !confirmed.assignments.some((assignment) => assignment.columnIndex === ignored.index)).map((ignored) => [ignored.index, IGNORE_CHOICE] as const)]);
function decisionsFor(suggestion: ImportSuggestedMapping, choiceOf: (columnIndex: number) => ColumnChoice): readonly ImportMappingDecision[] {
  const decisions: ImportMappingDecision[] = [];
  for (const field of IMPORT_FIELD_VOCABULARY) {
    const explicit = suggestion.columns.filter((column) => choiceOf(column.index) === field.id).map((column) => column.index);
    if (explicit.length > 0) {
      decisions.push({ kind: "choose", fieldId: field.id, columnIndexes: explicit });
      continue;
    }
    const claim = suggestion.claims.find((candidate) => candidate.fieldId === field.id);
    if (claim === undefined || !claim.columnIndexes.some((columnIndex) => choiceOf(columnIndex) !== SUGGESTION_CHOICE)) continue;
    const stillSuggested = claim.columnIndexes.filter((columnIndex) => choiceOf(columnIndex) === SUGGESTION_CHOICE);
    decisions.push(stillSuggested.length > 0 ? { kind: "choose", fieldId: field.id, columnIndexes: stillSuggested } : { kind: "decline", fieldId: field.id });
  }
  return decisions;
}
function refusalsByColumn(refusals: readonly ImportMappingRefusal[]): ReadonlyMap<number, readonly ImportMappingRefusal[]> {
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
type BlockedIgnoreReason = "blank-header" | "consent-preserved-as-data" | "excluded-topic";
type ColumnStatusKind = "blocked" | "refusal" | "chosen" | "ignored" | "suggested";
type ColumnStatus = { readonly kind: ColumnStatusKind; readonly label: string; readonly variant: "default" | "secondary" | "outline" | "destructive" };
const BLOCKED_STATUS: Readonly<Record<BlockedIgnoreReason, ColumnStatus>> = {
  "consent-preserved-as-data": { kind: "blocked", label: "Kept as data, not interpreted", variant: "secondary" },
  "excluded-topic": { kind: "blocked", label: "Not imported", variant: "outline" },
  "blank-header": { kind: "blocked", label: "No heading, not mapped", variant: "outline" },
};
const AMBIGUOUS_STATUS: ColumnStatus = { kind: "refusal", label: "Ambiguous — choose one", variant: "destructive" };
const CONFLICT_STATUS: ColumnStatus = { kind: "refusal", label: "Needs a different choice", variant: "destructive" };
const SUGGESTED_STATUS: ColumnStatus = { kind: "suggested", label: "Suggested", variant: "secondary" };
const CHOSEN_STATUS: ColumnStatus = { kind: "chosen", label: "Chosen by you", variant: "default" };
const NOT_USED_STATUS: ColumnStatus = { kind: "ignored", label: "Not used", variant: "outline" };
const UNMAPPED_STATUS: ColumnStatus = { kind: "ignored", label: "Not mapped", variant: "outline" };
type ColumnView = { readonly column: ImportColumnMapping; readonly choice: ColumnChoice; readonly occurrenceLabel: string | null; readonly suggestedLabel: string; readonly status: ColumnStatus; readonly reason: string | null; readonly note: string | null; readonly errors: readonly string[] };
type ColumnViewInput = { readonly suggestion: ImportSuggestedMapping; readonly ignored: readonly ImportIgnoredColumn[]; readonly refusals: ReadonlyMap<number, readonly ImportMappingRefusal[]>; readonly choiceOf: (columnIndex: number) => ColumnChoice };
function buildColumnViews(input: ColumnViewInput): readonly ColumnView[] {
  return input.suggestion.columns.map((column) => {
    const choice = input.choiceOf(column.index);
    const ignored = input.ignored.find((candidate) => candidate.index === column.index) ?? null;
    const refusals = input.refusals.get(column.index) ?? NO_REFUSALS;
    const errors = [...new Set(refusals.map((refusal) => refusal.message))];
    const repeated = input.suggestion.repeatedHeaders.find((candidate) => candidate.header === column.header);
    const chosen = choice !== SUGGESTION_CHOICE && choice !== IGNORE_CHOICE;
    let status: ColumnStatus;
    if (ignored !== null && (ignored.reason === "blank-header" || ignored.reason === "consent-preserved-as-data" || ignored.reason === "excluded-topic")) status = BLOCKED_STATUS[ignored.reason];
    else if (errors.length > 0) status = refusals.every((refusal) => refusal.code === "field-ambiguous") ? AMBIGUOUS_STATUS : CONFLICT_STATUS;
    else if (chosen) status = CHOSEN_STATUS;
    else if (ignored !== null) status = ignored.reason === "unrecognised-header" ? UNMAPPED_STATUS : NOT_USED_STATUS;
    else status = choice === SUGGESTION_CHOICE ? SUGGESTED_STATUS : NOT_USED_STATUS;
    const used = fieldDescriptorOf(status.kind === "suggested" ? column.suggestedField : status.kind === "chosen" && chosen ? choice : null);
    return {
      column,
      choice,
      occurrenceLabel: repeated === undefined || repeated.columnIndexes.length < 2 ? null : `${String(column.occurrence)} of ${String(repeated.columnIndexes.length)}`,
      suggestedLabel: fieldDescriptorOf(column.suggestedField)?.label ?? MAPPING_COPY.suggestedField,
      status,
      reason: ignored !== null && (status.kind === "blocked" || status.kind === "ignored") ? ignored.message : null,
      note: used === undefined ? null : used.note,
      errors,
    };
  });
}
type ColumnViewProps = { readonly view: ColumnView; readonly disabled: boolean; readonly onChoose: (columnIndex: number, value: string) => void };
type ColumnControlProps = ColumnViewProps & { readonly branch: "table" | "card" };
function ColumnControl({ view, branch, disabled, onChoose }: ColumnControlProps): ReactElement {
  const columnIndex = view.column.index;
  return (
    <FormField label={`${MAPPING_COPY.fieldLabel} ${String(columnIndex)}`} name={`mapping-${branch}-${String(columnIndex)}`} hideLabel={branch === "table"} description={view.reason ?? undefined} error={view.errors}>
      {({ id, describedBy, invalid, required }) => (
        <NativeSelect id={id} className="w-full" value={view.choice} disabled={disabled} aria-describedby={describedBy} aria-invalid={invalid ? true : undefined} aria-required={required ? true : undefined} onChange={(event) => onChoose(columnIndex, event.target.value)}>
          <NativeSelectOption value={SUGGESTION_CHOICE}>{MAPPING_COPY.suggestionOption}</NativeSelectOption>
          {IMPORT_FIELD_VOCABULARY.map((field) => (
            <NativeSelectOption key={field.id} value={field.id}>
              {field.label}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value={IGNORE_CHOICE}>{MAPPING_COPY.ignoreOption}</NativeSelectOption>
        </NativeSelect>
      )}
    </FormField>
  );
}
const ColumnStatusBlock = ({ view }: { readonly view: ColumnView }): ReactElement => (
  <div className="flex flex-col items-start gap-1">
    <Badge variant={view.status.variant}>{view.status.label}</Badge>
    {view.reason === null ? null : <p className="text-sm text-muted-foreground">{view.reason}</p>}
    {view.note === null ? null : <p className="text-sm text-muted-foreground">{view.note}</p>}
  </div>
);
function ColumnCard({ view, disabled, onChoose }: ColumnViewProps): ReactElement {
  const { column } = view;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Column <bdi>{String(column.index)}</bdi>
        </CardTitle>
        <CardDescription>
          {column.header === "" ? MAPPING_COPY.noHeading : <bdi>{column.header}</bdi>}
          {view.occurrenceLabel === null ? null : <span className="block">{view.occurrenceLabel}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">
          <span className="text-muted-foreground">Suggested field: </span>
          {view.suggestedLabel}
        </p>
        {view.status.kind === "blocked" ? <p className="text-sm text-muted-foreground">{MAPPING_COPY.notMapped}</p> : <ColumnControl view={view} branch="card" disabled={disabled} onChoose={onChoose} />}
        <ColumnStatusBlock view={view} />
      </CardContent>
    </Card>
  );
}
export default function StepMapping({ proposal, confirmedMapping, onConfirm, submitting, fieldErrors }: StepMappingProps): ReactElement {
  const { suggestion } = proposal.data;
  const { name, rowCount, columnCount } = proposal.data.fileMeta;
  const fileIdentity = fileIdentityOf(proposal);
  const [edits, setEdits] = useState<ColumnEdits>({ fileIdentity, choices: NO_CHOICES });
  const choiceOf = (columnIndex: number): ColumnChoice => {
    const remembered = (edits.fileIdentity === fileIdentity ? edits.choices : NO_CHOICES)[columnIndex] ?? choicesFromConfirmation(confirmedMapping)[columnIndex];
    if (remembered !== undefined) return remembered;
    const column = suggestion.columns.find((candidate) => candidate.index === columnIndex);
    return column === undefined ? IGNORE_CHOICE : initialChoice(column);
  };
  const handleChoose = (columnIndex: number, value: string): void => {
    const choice = readChoice(value);
    if (choice === null) return;
    setEdits((previous) => ({ fileIdentity, choices: { ...(previous.fileIdentity === fileIdentity ? previous.choices : NO_CHOICES), [columnIndex]: choice } }));
  };
  const confirmation = confirmMapping(suggestion, decisionsFor(suggestion, choiceOf));
  const refusals = confirmation.ok ? NO_REFUSALS : confirmation.refusals;
  const mapping = confirmation.ok ? confirmation.mapping : null;
  const ignored = mapping === null ? suggestion.ignored : mapping.ignored;
  const unattributedRefusals = refusals.filter((refusal) => refusal.columnIndexes.length === 0);
  const views = buildColumnViews({ suggestion, ignored, refusals: refusalsByColumn(refusals), choiceOf });
  const handleConfirm = (): void => {
    if (mapping === null || mapping.assignments.length === 0) return;
    onConfirm(mapping);
  };
  const confirmHint = mapping === null ? MAPPING_COPY.confirmBlocked : mapping.assignments.length === 0 ? MAPPING_COPY.confirmNeedsField : MAPPING_COPY.confirmNote;
  const confirmLabel = submitting ? MAPPING_COPY.confirmingLabel : confirmedMapping === null ? MAPPING_COPY.confirmLabel : MAPPING_COPY.reconfirmLabel;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-sm">
        <p>
          <bdi>{name}</bdi> · <bdi>{String(rowCount)}</bdi> rows · <bdi>{String(columnCount)}</bdi> columns
        </p>
        <p className="text-muted-foreground">{MAPPING_COPY.lead}</p>
      </div>
      {fieldErrors === null || fieldErrors.count === 0 ? null : <FormErrorSummary errors={fieldErrors} labels={MAPPING_COPY.summaryLabels} title={MAPPING_COPY.errorsTitle} description={MAPPING_COPY.errorsLead} />}
      {refusals.length === 0 ? null : (
        <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">{MAPPING_COPY.refusalTitle}</p>
          <p className="text-muted-foreground">{MAPPING_COPY.refusalLead}</p>
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
        <p className="text-sm text-muted-foreground">{MAPPING_COPY.noColumns}</p>
      ) : (
        <>
          <ImportTable label={TABLE_LABELS.mapping} headings={MAPPING_HEADINGS} busy={submitting} className="hidden md:block">
            {views.map((view) => (
              <TableRow key={view.column.index}>
                <TableHead scope="row" className="whitespace-normal align-top">
                  Column <bdi>{String(view.column.index)}</bdi>
                </TableHead>
                <TableCell className="whitespace-normal align-top">
                  {view.column.header === "" ? <span className="text-muted-foreground">{MAPPING_COPY.noHeading}</span> : <bdi>{view.column.header}</bdi>}
                  {view.occurrenceLabel === null ? null : <span className="block text-muted-foreground">{view.occurrenceLabel}</span>}
                </TableCell>
                <TableCell className="whitespace-normal align-top">{view.suggestedLabel}</TableCell>
                <TableCell className="whitespace-normal align-top">{view.status.kind === "blocked" ? <span className="text-muted-foreground">{MAPPING_COPY.notMapped}</span> : <ColumnControl view={view} branch="table" disabled={submitting} onChoose={handleChoose} />}</TableCell>
                <TableCell className="whitespace-normal align-top">
                  <ColumnStatusBlock view={view} />
                </TableCell>
              </TableRow>
            ))}
          </ImportTable>
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
        {[[MAPPING_COPY.unmappedTitle, mapping === null ? suggestion.unmapped : mapping.unmapped] as const, [MAPPING_COPY.declinedTitle, mapping === null ? NO_FIELD_IDS : mapping.declined] as const].map(([title, fieldIds]) =>
          fieldIds.length === 0 ? null : (
            <p key={title} className="text-muted-foreground">
              <span className="text-foreground">{title} </span> {labelsOf(fieldIds)}{" "}
            </p>
          ),
        )}
      </div>
      <Separator />
      <FormField label="Confirm the column mapping" name="confirmedMapping" description={confirmHint} error={fieldErrors === null ? undefined : fieldErrors.byField["confirmedMapping"]}>
        {({ id, describedBy }) => (
          <Button id={id} aria-describedby={describedBy} type="button" disabled={!(mapping !== null && mapping.assignments.length > 0 && !submitting)} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        )}
      </FormField>
    </div>
  );
}
const labelsOf = (fieldIds: readonly ImportFieldId[]): string => fieldIds.map((fieldId) => fieldDescriptorOf(fieldId)?.label ?? fieldId).join(", ");
