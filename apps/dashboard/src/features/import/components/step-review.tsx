"use client";
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { factFrame } from "@/components/fact-list";
import { FormErrorSummary, FormField, FormFieldGroup, fieldControlId, type FieldErrorLookup } from "@/components/form-field";
import { PaginationBar } from "@/components/pagination-bar";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { MutationInput, ReadEnvelope } from "@/modules/data-service/envelope";
import type { DenialReason, MutationOutcome } from "@/modules/data-service/outcome";
import type { ImportProposalRowReview, ImportProposalView, ImportRowWindow } from "@/modules/data-service/reads/import";
import { IMPORT_DECISION_KINDS, type ImportCellCorrectionInput, type ImportDecisionInput, type ImportDecisionKind } from "@/modules/import/decide";
import { IMPORT_MAX_CELL_CODE_POINTS } from "@/modules/import/parse";
import type { CancelPayload } from "../schemas/acceptance";
import { DECISION_COPY, JOURNEY_COPY, REVIEW_COPY, REVIEW_DUPLICATE_COPY, REVIEW_VERDICT_WORDS, TABLE_LABELS, reviewCandidateLabel, reviewCorrectionLabel, reviewDecisionLabel, reviewDecisionPendingLabel, reviewDecisionSubmitLabel, reviewSkipReasonLabel, reviewWindowSentence } from "../copy";
import ImportNotice from "./import-notice";
import ImportTable from "./import-table";
const DECISION_ORDER: readonly ImportDecisionKind[] = IMPORT_DECISION_KINDS;
const isDecisionKind = (value: unknown): value is ImportDecisionKind => typeof value === "string" && IMPORT_DECISION_KINDS.some((kind) => kind === value);
type Branch = "table" | "card";
const BRANCHES: readonly Branch[] = ["table", "card"];
const ROW_COPY = {
  restrictionsKept: "Kept verbatim — restrictions are never edited or removed during import.",
  correctionLimit: `Up to ${String(IMPORT_MAX_CELL_CODE_POINTS)} characters.`,
  chooseFirst: "Pick an option above before saving.",
  alreadyRecorded: (rowNumber: number): string => `Saved for row ${String(rowNumber)}. Change an option or edit a value to update it.`,
  materialMissing: (rowNumber: number): string => `Couldn’t prepare details for row ${String(rowNumber)}.`,
  noName: "No name in this row",
} as const;
/** The cancellation the stop control submits, with the transport that performs it and what to do once it settles. */
export type ImportStopControl = { readonly input: Omit<MutationInput<CancelPayload>, "operationId">; readonly submit: MutationSubmit<CancelPayload>; readonly onSettled: (outcome: MutationOutcome) => void };
/** The one stop-this-import review: the shared review step over the cancellation transport. */ export const StopImportReview = ({ stop }: { readonly stop: ImportStopControl }): ReactElement => (
  <ActionReview<CancelPayload> title={JOURNEY_COPY.stop.title} description={JOURNEY_COPY.stop.description} confirmLabel={JOURNEY_COPY.stop.confirmLabel} consequential input={stop.input} submit={stop.submit} onSettled={stop.onSettled} />
);
/** Why the last decision about a row was refused, in the closed vocabulary the service answers with. */ export type StepReviewRefusal =
  | { readonly kind: "invalid"; readonly errors: FieldErrorLookup }
  | { readonly kind: "denied"; readonly reasonCode: DenialReason }
  | { readonly kind: "conflict"; readonly rowNumber: number; readonly currentRevision: string; readonly preservedInput: ImportDecisionInput }
  | { readonly kind: "unavailable"; readonly source: SourceReference; readonly guidance: string }
  | { readonly kind: "unknown"; readonly operationId: string };
/** Props of {@link StepReview}. */ export interface StepReviewProps {
  readonly proposal: ReadEnvelope<ImportProposalView>;
  readonly decisions: Readonly<Record<number, ImportDecisionInput>>;
  readonly window: ImportRowWindow;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly onDecide: (rowNumber: number, decision: ImportDecisionInput) => void;
  readonly decidingRowNumber: number | null;
  readonly refusal: StepReviewRefusal | null;
  readonly onContinue: () => void;
  readonly stop: ImportStopControl;
  readonly focusRowNumber?: number | null;
}
type RowDraft = { readonly choice: ImportDecisionKind | null; readonly candidate: string; readonly corrections: Readonly<Record<number, string>>; readonly reason: string };
function draftOf(decision: ImportDecisionInput | undefined, review: ImportProposalRowReview | null): RowDraft {
  if (decision === undefined) return { choice: null, candidate: "", corrections: {}, reason: "" };
  const corrections: Record<number, string> = {};
  const stated = decision.kind === "create" || decision.kind === "reuse" ? (decision.corrections ?? []) : [];
  for (const correction of stated) corrections[correction.columnNumber] = correction.value;
  if (decision.kind === "reuse") {
    const candidate = decision.candidate;
    const index = review === null ? -1 : review.suggestions.findIndex((suggestion) => suggestion.reference.system === candidate.system && suggestion.reference.reference === candidate.reference);
    return { choice: "reuse", candidate: index === -1 ? "" : String(index), corrections, reason: "" };
  }
  return decision.kind === "skip" ? { choice: "skip", candidate: "", corrections, reason: decision.reason ?? "" } : { choice: decision.kind, candidate: "", corrections, reason: "" };
}
/** The row's issues that offer a corrected value — one per column, however many problems that cell states, because an over-long cell also states the value the mapping could not read there. A column the confirmed mapping assigns to no field is stated but offers no correction: the service refuses a correction that would change nothing about the row, so the row is skipped instead. */
const correctableIssuesOf = (review: ImportProposalRowReview | null): readonly ImportProposalRowReview["issues"][number][] => {
  const byColumn = new Map<number, ImportProposalRowReview["issues"][number]>();
  for (const issue of review?.issues ?? []) if (issue.columnNumber !== null && issue.fieldId !== null && !byColumn.has(issue.columnNumber)) byColumn.set(issue.columnNumber, issue);
  return [...byColumn.values()];
};
const correctionsOf = (review: ImportProposalRowReview, draft: RowDraft): readonly ImportCellCorrectionInput[] =>
  correctableIssuesOf(review).flatMap((issue) => {
    const typed = draft.corrections[issue.columnNumber ?? -1];
    return typed === undefined || issue.columnNumber === null || typed === (issue.value ?? "") ? [] : [{ columnNumber: issue.columnNumber, value: typed }];
  });
function decisionOf(rowNumber: number, review: ImportProposalRowReview | null, draft: RowDraft): ImportDecisionInput | null {
  const corrections = review === null ? [] : correctionsOf(review, draft);
  switch (draft.choice) {
    case null:
      return null;
    case "create":
      return corrections.length === 0 ? { kind: "create", rowNumber } : { kind: "create", rowNumber, corrections };
    case "reuse": {
      if (review === null || review.suggestions.length === 0) return null;
      const suggestion = review.suggestions[draft.candidate === "" ? 0 : Number(draft.candidate)];
      return suggestion === undefined ? null : corrections.length === 0 ? { kind: "reuse", rowNumber, candidate: suggestion.reference } : { kind: "reuse", rowNumber, candidate: suggestion.reference, corrections };
    }
    case "skip": {
      const reason = draft.reason.trim();
      return reason === "" ? { kind: "skip", rowNumber } : { kind: "skip", rowNumber, reason: draft.reason };
    }
    case "unresolved":
      return { kind: "unresolved", rowNumber };
  }
}
function decisionSignature(decision: ImportDecisionInput): string {
  const corrections = [...(decision.kind === "create" || decision.kind === "reuse" ? (decision.corrections ?? []) : [])]
    .sort((left, right) => left.columnNumber - right.columnNumber)
    .map((correction) => `${String(correction.columnNumber)}=${correction.value}`)
    .join("\u001f");
  const candidate = decision.kind === "reuse" ? formatSourceReference(decision.candidate) : "";
  const reason = decision.kind === "skip" ? (decision.reason ?? "").trim() : "";
  return [decision.kind, String(decision.rowNumber), candidate, corrections, reason].join("\u001e");
}
/** The decision a refused attempt posted, in this family's own words: the choice, each corrected cell, the contact a reuse names and the reason a skip gives — never the record itself. */ function decisionWordsOf(decision: ImportDecisionInput, review: ImportProposalRowReview | null): readonly string[] {
  const words: string[] = [DECISION_COPY[decision.kind].label];
  if (decision.kind === "create" || decision.kind === "reuse") {
    for (const correction of decision.corrections ?? []) {
      const header = review?.issues.find((issue) => issue.columnNumber === correction.columnNumber)?.header ?? "";
      words.push(`${header.trim() === "" ? `Column ${String(correction.columnNumber)}` : header}: ${correction.value}`);
    }
  }
  if (decision.kind === "reuse") words.push(formatSourceReference(decision.candidate));
  const reason = decision.kind === "skip" ? (decision.reason ?? "").trim() : "";
  if (reason !== "") words.push(reason);
  return words;
}
// The identifying value a row states: the name the row supplies, taken exactly as the file wrote it. A display name or an organization name stands alone, and a given and a family name are joined because either part alone names nobody. It is presentation only and never an identity: two rows may carry the same text and remain two rows.
const IDENTIFYING_FORMS: readonly (readonly string[])[] = [["display-name"], ["name-organization"], ["name-given", "name-family"]];
function identifyingValueOf(review: ImportProposalRowReview | null): string | null {
  if (review === null) return null;
  for (const form of IDENTIFYING_FORMS) {
    const parts: string[] = [];
    for (const fieldId of form) {
      const value = review.mappedCells.find((cell) => cell.fieldId === fieldId)?.value.trim() ?? "";
      if (value === "") break;
      parts.push(value);
    }
    if (parts.length === form.length) return parts.join(" ");
  }
  return null;
}
function RowIssues({ review }: { readonly review: ImportProposalRowReview }): ReactElement {
  if (review.issues.length === 0) return <p className="text-muted-foreground">{REVIEW_COPY.empty.problems}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {review.issues.map((issue) => (
        <li key={`${issue.code}-${String(issue.columnNumber ?? 0)}-${issue.fieldId}`}>
          <span className="font-medium">{issue.label}</span>
          {issue.columnNumber === null ? null : (
            <span className="block text-muted-foreground">
              Column <bdi>{String(issue.columnNumber)}</bdi>
              {issue.header === null || issue.header.trim() === "" ? null : (
                <>
                  , <bdi>{issue.header}</bdi>
                </>
              )}
            </span>
          )}
          <span className="block text-pretty">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
function RowSuppliedValues({ review }: { readonly review: ImportProposalRowReview }): ReactElement {
  if (review.mappedCells.length === 0) return <p className="text-muted-foreground">{REVIEW_COPY.empty.suppliedValues}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {review.mappedCells.map((cell) => (
        <li key={`${String(cell.columnNumber)}-${cell.fieldId}`} className="flex min-w-0 flex-wrap gap-x-1">
          <span className="font-medium">
            <bdi>{cell.header}</bdi>:
          </span>
          <bdi className="min-w-0 wrap-anywhere">{cell.value}</bdi>
        </li>
      ))}
    </ul>
  );
}
function RowKeptCells({ review }: { readonly review: ImportProposalRowReview }): ReactElement {
  const kept = review.preservedCells.filter((cell) => cell.statesConsent);
  if (kept.length === 0) return <p className="text-muted-foreground">{REVIEW_COPY.empty.keptCells}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {kept.map((cell) => (
        <li key={`${String(cell.columnNumber)}-${cell.reason}`}>
          <span className="font-medium">
            {REVIEW_COPY.keptAsData}: <bdi>{cell.header}</bdi>
          </span>
          <bdi className="block">{cell.text}</bdi>
          <span className="block text-pretty text-muted-foreground">{cell.message}</span>
        </li>
      ))}
    </ul>
  );
}
function RowRestrictions({ review }: { readonly review: ImportProposalRowReview }): ReactElement {
  if (review.restrictions.length === 0) return <p className="text-muted-foreground">{REVIEW_COPY.empty.restrictions}</p>;
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {review.restrictions.map((restriction) => (
          <li key={`${String(restriction.columnNumber)}-${restriction.text}`}>
            <bdi className="wrap-anywhere">{restriction.text}</bdi>
            <bdi className="block text-muted-foreground">{restriction.header}</bdi>
          </li>
        ))}
      </ul>
      <p className="text-sm text-pretty text-muted-foreground">{ROW_COPY.restrictionsKept}</p>
    </div>
  );
}
function RowSuggestions({ review }: { readonly review: ImportProposalRowReview }): ReactElement {
  if (review.suggestions.length === 0) return <p className="text-muted-foreground">{REVIEW_COPY.empty.suggestions}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {review.suggestions.map((suggestion) => (
        <li key={formatSourceReference(suggestion.reference)} className="flex flex-col gap-1">
          <p className="text-pretty">{suggestion.message}</p>
          <p className="mono-identifier">
            <bdi className="wrap-anywhere">{formatSourceReference(suggestion.reference)}</bdi>
          </p>
          <p className="font-medium">{REVIEW_COPY.signalsHeading}</p>
          <ul className="flex list-disc flex-col gap-0.5 ps-4">
            {suggestion.signals.map((signal) => (
              <li key={`${signal.kind}-${signal.value}`}>
                <bdi>{signal.value}</bdi>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-2">
            {suggestion.comparison.map((field) => (
              <li key={field.fieldId} className="flex flex-col gap-0.5">
                <span className="font-medium">{field.label}</span>
                {field.existingState === "readable" ? (
                  <span className="flex min-w-0 flex-wrap gap-x-1">
                    <span className="text-muted-foreground">{REVIEW_COPY.comparison.existing}:</span>
                    <bdi className="min-w-0 wrap-anywhere">{field.existing.length === 0 ? "" : field.existing.join(", ")}</bdi>
                  </span>
                ) : (
                  <span className="text-muted-foreground">{REVIEW_COPY.comparison.notCompared}</span>
                )}
                <span className="flex min-w-0 flex-wrap gap-x-1">
                  <span className="text-muted-foreground">{REVIEW_COPY.comparison.incoming}:</span>
                  <bdi className="min-w-0 wrap-anywhere">{field.incoming.length === 0 ? "" : field.incoming.join(", ")}</bdi>
                </span>
                {field.differs === null ? null : <span>{field.differs ? REVIEW_COPY.comparison.differs : REVIEW_COPY.comparison.matches}</span>}
                <span className="text-pretty text-muted-foreground">{field.message}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
const ROW_MATERIAL: readonly { readonly label: string; readonly body: (props: { readonly review: ImportProposalRowReview }) => ReactElement }[] = [
  { label: REVIEW_COPY.column.suppliedValues, body: RowSuppliedValues },
  { label: REVIEW_COPY.column.problems, body: RowIssues },
  { label: REVIEW_COPY.column.keptCells, body: RowKeptCells },
  { label: REVIEW_COPY.column.restrictions, body: RowRestrictions },
  { label: REVIEW_COPY.column.suggestions, body: RowSuggestions },
];
const REVIEW_HEADINGS: readonly string[] = [REVIEW_COPY.column.row, REVIEW_COPY.column.verdict, REVIEW_COPY.column.recordedDecision, REVIEW_COPY.column.material, REVIEW_COPY.column.decision];
/** The review table's five column widths, fixed so opening one row's disclosure re-wraps that row's own material instead of redistributing every column. */ const REVIEW_HEADING_WIDTHS: readonly (string | undefined)[] = ["w-[11%]", "w-[14%]", "w-[13%]", "w-[20%]", undefined];
const decisionFieldName = (branch: Branch, rowNumber: number): string => `decision-${branch}-${String(rowNumber)}`;
const decisionOptionId = (branch: Branch, rowNumber: number, kind: ImportDecisionKind): string => `${fieldControlId(decisionFieldName(branch, rowNumber))}-option-${kind}`;
// Where one option's consequence is stated: inside the row's disclosure, so the choice refers to the sentence that explains it and the two are read together without the sentence taking the choice's place in the row.
const decisionConsequenceId = (branch: Branch, rowNumber: number, kind: ImportDecisionKind): string => `${decisionOptionId(branch, rowNumber, kind)}-consequence`;
// Where the reason a row offers no contact to reuse is stated: beside the consequence of reusing, so a disabled choice explains itself without a line of prose above every row.
const decisionReuseReasonId = (branch: Branch, rowNumber: number): string => `${fieldControlId(decisionFieldName(branch, rowNumber))}-reuse-reason`;
/** One labelled run of a row's material, whether it sits in the review table's one material column or in a card. */ const RowSection = ({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-1">
    <p className="text-sm font-medium">{label}</p>
    {children}
  </div>
);
/** Everything one row's material says that is too long to sit beside its controls, behind the browser's own disclosure: keyboard operable, named by its row, in the DOM of the row it belongs to, and one disclosure rather than a column per fact. The look-alike signal and what each of the four decisions does are stated here too, so the row keeps only what deciding about it needs. */
function RowMaterialDisclosure({ rowNumber, branch, review }: { readonly rowNumber: number; readonly branch: Branch; readonly review: ImportProposalRowReview | null }): ReactElement {
  const duplicateLooking = review === null ? null : review.duplicateLooking;
  const reuseOffered = review !== null && review.suggestions.length > 0;
  return (
    <details className="min-w-0 rounded-xl border border-border/80 bg-surface-subtle px-3 py-2">
      <summary className="min-h-target cursor-pointer text-sm font-medium text-pretty">{REVIEW_DUPLICATE_COPY.summaryLabel(rowNumber)}</summary>
      <div className="flex min-w-0 flex-col gap-3 pt-2.5">
        {review === null
          ? null
          : ROW_MATERIAL.map(({ label, body: Body }) => (
              <RowSection key={label} label={label}>
                <Body review={review} />
              </RowSection>
            ))}
        {duplicateLooking === null ? null : (
          <RowSection label={REVIEW_DUPLICATE_COPY.word}>
            <p className="text-pretty">{REVIEW_DUPLICATE_COPY.sentence(duplicateLooking)}</p>
          </RowSection>
        )}
        <RowSection label={REVIEW_COPY.decisionsHeading}>
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {DECISION_ORDER.map((kind) => (
                <li key={kind}>
                  <span className="text-sm font-medium">{DECISION_COPY[kind].label}</span>
                  <span id={decisionConsequenceId(branch, rowNumber, kind)} className="block text-sm text-pretty text-muted-foreground">
                    {DECISION_COPY[kind].consequence}
                  </span>
                  {kind === "reuse" && !reuseOffered ? (
                    <span id={decisionReuseReasonId(branch, rowNumber)} className="block text-sm text-pretty text-muted-foreground">
                      {REVIEW_COPY.empty.suggestions}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-sm text-pretty text-muted-foreground">{REVIEW_COPY.decisionNote}</p>
          </div>
        </RowSection>
      </div>
    </details>
  );
}
interface DecisionControlProps {
  readonly rowNumber: number;
  readonly branch: Branch;
  readonly review: ImportProposalRowReview | null;
  readonly draft: RowDraft;
  readonly recorded: ImportDecisionInput | undefined;
  readonly pending: boolean;
  readonly onDraft: (rowNumber: number, draft: RowDraft) => void;
  readonly onRecord: (rowNumber: number, decision: ImportDecisionInput) => void;
}
function DecisionControl({ rowNumber, branch, review, draft, recorded, pending, onDraft, onRecord }: DecisionControlProps): ReactElement {
  const suggestions = review === null ? [] : review.suggestions;
  const decision = decisionOf(rowNumber, review, draft);
  const correctable = correctableIssuesOf(review);
  const chosen = draft.choice;
  const candidate = suggestions[Number(draft.candidate)];
  const reuseOffered = suggestions.length > 0;
  const reuseReasonId = decisionReuseReasonId(branch, rowNumber);
  const needsChoiceId = `${fieldControlId(decisionFieldName(branch, rowNumber))}-choice-needed`;
  const recordedId = `${fieldControlId(decisionFieldName(branch, rowNumber))}-already-recorded`;
  const alreadyRecorded = decision !== null && recorded !== undefined && decisionSignature(decision) === decisionSignature(recorded);
  const chooseKind = (next: unknown): void => {
    if (isDecisionKind(next)) onDraft(rowNumber, { ...draft, choice: next, candidate: next === "reuse" && draft.candidate === "" && suggestions.length > 0 ? "0" : draft.candidate });
  };
  const recordDecision = (): void => {
    if (decision !== null) onRecord(rowNumber, decision);
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FormFieldGroup legend={reviewDecisionLabel(rowNumber)} name={decisionFieldName(branch, rowNumber)} description={chosen === null ? undefined : DECISION_COPY[chosen].description} hideLegend>
        {(group) => (
          // Two columns of short choices rather than four lines of prose: each consequence is stated once in the row's disclosure and referenced by the choice it explains, so the four choices stay one glance on one screen.
          <RadioGroup {...{ className: "grid-cols-2 gap-2", value: chosen, "aria-labelledby": group.legendId, "aria-describedby": group.describedBy, onValueChange: chooseKind }}>
            {DECISION_ORDER.map((kind) => {
              const optionId = decisionOptionId(branch, rowNumber, kind);
              const consequenceId = decisionConsequenceId(branch, rowNumber, kind);
              const unavailable = kind === "reuse" && !reuseOffered;
              return (
                <label key={kind} htmlFor={optionId} className="flex min-h-target items-start gap-2">
                  <RadioGroupItem id={optionId} value={kind} disabled={pending || unavailable} aria-describedby={unavailable ? `${consequenceId} ${reuseReasonId}` : consequenceId} className="mt-0.5" />
                  <span className="min-w-0 text-sm font-medium">{DECISION_COPY[kind].label}</span>
                </label>
              );
            })}
          </RadioGroup>
        )}
      </FormFieldGroup>
      {/* The reason a row offers no contact to reuse, and what each decision does, are stated inside the row's disclosure, which each choice points at: they are attached to the choices rather than repeated above the group. */}
      {chosen === "reuse" && reuseOffered ? (
        <FormField label={reviewCandidateLabel(rowNumber)} name={`candidate-${branch}-${String(rowNumber)}`} description={candidate === undefined ? undefined : candidate.message}>
          {({ id, describedBy }) => (
            <NativeSelect id={id} className="w-full max-w-72" value={draft.candidate === "" ? "0" : draft.candidate} disabled={pending} aria-describedby={describedBy} onChange={(event) => onDraft(rowNumber, { ...draft, candidate: event.currentTarget.value })}>
              {suggestions.map((suggestion, index) => (
                <NativeSelectOption key={formatSourceReference(suggestion.reference)} value={String(index)}>
                  {formatSourceReference(suggestion.reference)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {(chosen === "create" || chosen === "reuse") && correctable.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium">{REVIEW_COPY.correctionsHeading}</p>
          <p className="text-sm text-pretty text-muted-foreground">{REVIEW_COPY.correctionsNote}</p>
          {correctable.map((issue) => {
            const columnNumber = issue.columnNumber ?? 0;
            const current = draft.corrections[columnNumber] ?? issue.value ?? "";
            return (
              <FormField key={columnNumber} label={reviewCorrectionLabel(rowNumber, issue.header ?? "")} name={`correction-${branch}-${String(rowNumber)}-${String(columnNumber)}`} description={ROW_COPY.correctionLimit}>
                {({ id, describedBy }) => <Input id={id} className="max-w-72" value={current} disabled={pending} aria-describedby={describedBy} onChange={(event) => onDraft(rowNumber, { ...draft, corrections: { ...draft.corrections, [columnNumber]: event.currentTarget.value } })} />}
              </FormField>
            );
          })}
        </div>
      ) : null}
      {chosen === "skip" ? (
        <FormField label={reviewSkipReasonLabel(rowNumber)} name={`skip-reason-${branch}-${String(rowNumber)}`} description={REVIEW_COPY.skipReasonNote}>
          {({ id, describedBy }) => <Textarea id={id} className="max-w-72" rows={2} value={draft.reason} disabled={pending} aria-describedby={describedBy} onChange={(event) => onDraft(rowNumber, { ...draft, reason: event.currentTarget.value })} />}
        </FormField>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Button {...{ type: "button", className: "w-fit", disabled: pending || decision === null || alreadyRecorded, "aria-describedby": alreadyRecorded ? recordedId : decision === null ? needsChoiceId : undefined, onClick: recordDecision }}>
          {pending ? reviewDecisionPendingLabel(rowNumber) : reviewDecisionSubmitLabel(rowNumber)}
        </Button>
        {alreadyRecorded ? (
          <p id={recordedId} className="min-w-0 text-sm text-pretty text-muted-foreground">
            {ROW_COPY.alreadyRecorded(rowNumber)}
          </p>
        ) : decision === null ? (
          // The reason the control is unavailable stays attached to it as its description while taking no line of the row: the four choices sit directly above, so the row states the rule once and keeps one screen high.
          <p id={needsChoiceId} className="sr-only">
            {ROW_COPY.chooseFirst}
          </p>
        ) : null}
      </div>
    </div>
  );
}
function firstDecisionControl(rowNumber: number): HTMLElement | null {
  for (const branch of BRANCHES) {
    const fieldset = document.getElementById(fieldControlId(decisionFieldName(branch, rowNumber)));
    if (fieldset === null) continue;
    for (const radio of fieldset.querySelectorAll<HTMLElement>('[role="radio"]')) {
      const unavailable = radio.getAttribute("aria-disabled") === "true" || (radio instanceof HTMLInputElement && radio.disabled);
      if (!unavailable && radio.getClientRects().length > 0) return radio;
    }
  }
  return null;
}
// The domain's verdict about one row, as words a badge carries, with the look-alike signal beside it as a second worded badge: a row resembling another row of the same file is neither a verdict nor a decision, so the verdict stays the one validation graded.
const RowVerdict = ({ review, rowNumber }: { readonly review: ImportProposalRowReview | null; readonly rowNumber: number }): ReactElement =>
  review === null ? (
    <StateNotice kind="unavailable" headingLevel={4} title={REVIEW_COPY.material.heading} description={ROW_COPY.materialMissing(rowNumber)} />
  ) : (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant={review.verdict === "ready" ? "secondary" : "destructive"}>{REVIEW_VERDICT_WORDS[review.verdict]}</Badge>
      {review.duplicateLooking === null ? null : <Badge variant="outline">{REVIEW_DUPLICATE_COPY.word}</Badge>}
    </div>
  );
const RowDecisionStatus = ({ decisionLabel, decided }: { readonly decisionLabel: string; readonly decided: boolean }): ReactElement => (
  <div className="flex flex-col gap-1">
    <bdi className="block">{decisionLabel}</bdi>
    {decided ? null : <span className="block text-muted-foreground">{REVIEW_COPY.noDecisionRecorded}</span>}
  </div>
);
const REFUSAL_COPY: Readonly<Record<"denied" | "unavailable", { readonly title: string; readonly lead: string }>> = { denied: { title: REVIEW_COPY.refusal.deniedTitle, lead: REVIEW_COPY.refusal.deniedLead }, unavailable: { title: REVIEW_COPY.refusal.unavailableTitle, lead: REVIEW_COPY.refusal.unavailableLead } };
/** One labelled fact of a refusal: the words that name it, then the value the answer states beside it. */ const RefusalFact = factFrame({ rowClassName: "flex min-w-0 flex-col gap-1", termClassName: "font-medium", valueClassName: "min-w-0 wrap-anywhere" });
function RefusalBlock({ refusal, held, review }: { readonly refusal: StepReviewRefusal; readonly held: string | null; readonly review: ImportProposalRowReview | null }): ReactElement {
  if (refusal.kind === "invalid") return <FormErrorSummary errors={refusal.errors} title={REVIEW_COPY.refusal.invalidTitle} description={REVIEW_COPY.refusal.invalidLead} headingLevel={3} />;
  if (refusal.kind === "unknown") return <StateNotice kind="unknown" headingLevel={3} title={REVIEW_COPY.refusal.unknownTitle} description={REVIEW_COPY.refusal.unknownLead} operationId={refusal.operationId} />;
  // A conflict states three facts rather than the one the notice beside it states — the revision the review now stands at, the decision this attempt posted and the decision the review now holds — and the notice carries one, so the conflict renders its own live region instead of a list squeezed into that sentence.
  if (refusal.kind === "conflict") {
    const recorded = decisionWordsOf(refusal.preservedInput, review);
    return (
      <Alert variant="destructive">
        <AlertTitle>{REVIEW_COPY.refusal.conflictRowTitle(refusal.rowNumber)}</AlertTitle>
        <AlertDescription>
          <p>{REVIEW_COPY.refusal.conflictLead}</p>
          <dl className="flex min-w-0 flex-col gap-2">
            <RefusalFact term={REVIEW_COPY.refusal.conflictCurrentRevision}>
              <bdi className="mono-identifier">{refusal.currentRevision}</bdi>
            </RefusalFact>
            <RefusalFact term={REVIEW_COPY.refusal.conflictPreserved}>
              <ul className="flex list-disc flex-col gap-0.5 ps-4">
                {recorded.map((word, index) => (
                  <li key={`${String(index)}-${word}`} className="text-pretty">
                    <bdi>{word}</bdi>
                  </li>
                ))}
              </ul>
            </RefusalFact>
            <RefusalFact term={REVIEW_COPY.refusal.conflictHeld}>
              <bdi>{held ?? REVIEW_COPY.noDecisionRecorded}</bdi>
            </RefusalFact>
          </dl>
          <p>{REVIEW_COPY.refusal.conflictRecovery}</p>
        </AlertDescription>
      </Alert>
    );
  }
  const words = REFUSAL_COPY[refusal.kind];
  const details = refusal.kind === "denied" ? [{ label: "Reason", value: refusal.reasonCode }] : [{ label: "Source", value: formatSourceReference(refusal.source), guidance: refusal.guidance }];
  return <ImportNotice {...{ destructive: refusal.kind === "denied", title: words.title, lead: words.lead, details }} />;
}
/** Step three of the contact import: every row of the returned window, and the decision recorded about each one. */
export default function StepReview({ proposal, decisions, window, onPageChange, onPageSizeChange, onDecide, decidingRowNumber, refusal, focusRowNumber = null, onContinue, stop }: StepReviewProps): ReactElement {
  const view = proposal.data;
  const [drafts, setDrafts] = useState<Readonly<Record<number, RowDraft>>>({});
  const blockedReasonId = useId();
  const focusHandled = useRef<string | null>(null);
  const tableBusy = decidingRowNumber !== null;
  const reviewFor = (rowNumber: number): ImportProposalRowReview | null => view.review?.rows.find((row) => row.rowNumber === rowNumber) ?? null;
  // The conflicted row as the rows below state it: the decision the review now holds for it, and that row's own review material, which the preserved decision is stated against. A row outside the returned window states neither, and the conflict says so rather than inventing a decision.
  const refusedRow = refusal === null || refusal.kind !== "conflict" ? null : (view.rows.find((row) => row.rowNumber === refusal.rowNumber) ?? null);
  // The decision the review now holds for that row, in the read's own words; a row the read reports as unresolved holds none, which is stated as no decision rather than as the words for leaving it undecided.
  const held: string | null = refusedRow === null || refusedRow.decision === "unresolved" ? null : refusedRow.decisionLabel;
  const refusedReview = refusedRow === null ? null : reviewFor(refusedRow.rowNumber);
  const recorded = Object.values(decisions).filter((decision) => decision !== undefined).length;
  const draftFor = (rowNumber: number): RowDraft => drafts[rowNumber] ?? draftOf(decisions[rowNumber], reviewFor(rowNumber));
  const setDraft = (rowNumber: number, draft: RowDraft): void => setDrafts((previous) => ({ ...previous, [rowNumber]: draft }));
  useEffect(() => {
    if (focusRowNumber === null) {
      focusHandled.current = null;
      return;
    }
    const key = `${String(focusRowNumber)}@${String(window.page)}`;
    if (focusHandled.current === key) return;
    const control = firstDecisionControl(focusRowNumber);
    if (control !== null) {
      focusHandled.current = key;
      control.focus();
      control.scrollIntoView({ block: "center", inline: "nearest" });
      return;
    }
    if (view.review === null) return;
    const pageOfRow = Math.min(Math.max(Math.ceil(focusRowNumber / window.pageSize), 1), Math.max(window.pageCount, 1));
    if (pageOfRow === window.page) return;
    focusHandled.current = key;
    onPageChange(pageOfRow);
  }, [focusRowNumber, view.review, onPageChange, window.page, window.pageCount, window.pageSize]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="text-sm text-pretty text-muted-foreground">{REVIEW_COPY.lead}</p>
      {refusal === null ? null : <RefusalBlock refusal={refusal} held={held} review={refusedReview} />}
      {view.review === null ? (
        <Alert>
          <AlertTitle>{REVIEW_COPY.material.heading}</AlertTitle>
          <AlertDescription>
            <p>{REVIEW_COPY.material.lead}</p>
            <p>{view.reviewDetail.message}</p>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <p className="text-sm text-pretty text-muted-foreground">{`${REVIEW_COPY.windowLead} ${reviewWindowSentence(window)}`}</p>
          {view.rows.length > 0 ? (
            <>
              <ImportTable label={TABLE_LABELS.review} headings={REVIEW_HEADINGS} headingWidths={REVIEW_HEADING_WIDTHS} fixed busy={tableBusy} className="hidden md:block">
                {view.rows.map((row) => {
                  const review = reviewFor(row.rowNumber);
                  const identifying = identifyingValueOf(review);
                  return (
                    <TableRow key={row.rowNumber}>
                      <TableHead scope="row" className="whitespace-normal align-top">
                        <span className="block">
                          Row <bdi>{String(row.rowNumber)}</bdi>
                        </span>
                        {identifying === null ? <span className="block text-muted-foreground">{ROW_COPY.noName}</span> : <bdi className="block text-muted-foreground wrap-anywhere">{identifying}</bdi>}
                      </TableHead>
                      <TableCell className="whitespace-normal align-top">
                        <RowVerdict review={review} rowNumber={row.rowNumber} />
                      </TableCell>
                      <TableCell className="whitespace-normal align-top">
                        <RowDecisionStatus decisionLabel={row.decisionLabel} decided={row.decision !== "unresolved"} />
                      </TableCell>
                      <TableCell className="whitespace-normal align-top">
                        <RowMaterialDisclosure rowNumber={row.rowNumber} branch="table" review={review} />
                      </TableCell>
                      <TableCell className="whitespace-normal align-top">
                        <DecisionControl rowNumber={row.rowNumber} branch="table" review={review} draft={draftFor(row.rowNumber)} recorded={decisions[row.rowNumber]} pending={decidingRowNumber === row.rowNumber} onDraft={setDraft} onRecord={onDecide} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </ImportTable>
              <ul className="flex flex-col gap-4 md:hidden" aria-busy={tableBusy ? true : undefined}>
                {view.rows.map((row) => {
                  const review = reviewFor(row.rowNumber);
                  const identifying = identifyingValueOf(review);
                  return (
                    <li key={row.rowNumber}>
                      <Card>
                        <CardHeader>
                          <CardTitle>
                            Row <bdi>{String(row.rowNumber)}</bdi>
                          </CardTitle>
                          <CardDescription>{identifying === null ? ROW_COPY.noName : <bdi className="wrap-anywhere">{identifying}</bdi>}</CardDescription>
                        </CardHeader>
                        <CardContent className="flex min-w-0 flex-col gap-3">
                          <RowVerdict review={review} rowNumber={row.rowNumber} />
                          <RowDecisionStatus decisionLabel={row.decisionLabel} decided={row.decision !== "unresolved"} />
                          <RowMaterialDisclosure rowNumber={row.rowNumber} branch="card" review={review} />
                          <DecisionControl rowNumber={row.rowNumber} branch="card" review={review} draft={draftFor(row.rowNumber)} recorded={decisions[row.rowNumber]} pending={decidingRowNumber === row.rowNumber} onDraft={setDraft} onRecord={onDecide} />
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
              <PaginationBar total={window.total} page={window.page} pageSize={window.pageSize} itemNoun="rows" disabled={tableBusy} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
            </>
          ) : null}
        </>
      )}
      <Separator />
      <div className="flex flex-col items-start gap-2">
        <Button type="button" disabled={recorded === 0 || tableBusy} aria-describedby={recorded === 0 ? blockedReasonId : undefined} onClick={onContinue}>
          {REVIEW_COPY.continueLabel}
        </Button>
        {recorded === 0 ? (
          <p id={blockedReasonId} className="text-sm text-pretty text-muted-foreground">
            {REVIEW_COPY.continueBlocked}
          </p>
        ) : null}
      </div>
      <StopImportReview stop={stop} />
    </div>
  );
}
