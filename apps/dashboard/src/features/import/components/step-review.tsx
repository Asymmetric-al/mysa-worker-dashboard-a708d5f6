"use client";
/**
 * Contact import, step three — Validate and review: what each row of the returned window would become,
 * and the worker's decision about every row of it.
 *
 * **What this file decides and what it never decides.** Every fact a row shows is the review the service
 * derived: the verdict, the per-field issues, the cells a field would take, the cells kept as data, the
 * restrictions, the duplicate-contact suggestions and their field-by-field comparisons. None of them is
 * recomputed here, restated in this file's own words or filtered by a second rule — the read is asked for
 * a window and this step renders exactly the rows it answered with, so a verdict the browser guessed
 * could never disagree with the verdict the acceptance applies.
 *
 * **What the worker states.** Two things only: which of the four decisions a row carries, and the members
 * that decision needs — the proposed contact a reused row attaches to, the corrected values of a row that
 * needs correction, and the optional reason a skipped row keeps. A decision is recorded through the
 * container, so this file holds no transport, mints no operation identity and applies nothing: recording a
 * decision is not an acceptance, and the copy says so beside the control that records it.
 *
 * **Why a decision is four visible choices rather than one dropdown.** A decision's consequence is the
 * part a worker must read before taking it — a new private entry copies nothing into a shared record, a
 * reuse attaches to a contact without merging anything into it, a skip creates nothing — so all four are
 * rendered with the sentence that states what each one does and leaves alone. A choice the domain has
 * already reported as unavailable for a row (no contact was proposed, so there is nothing to attach the
 * row to) stays visible and disabled with that reason attached, rather than disappearing from the list.
 * Nothing is pre-selected: a decision the worker never took is never shown as one.
 *
 * **One table, one card.** From `md` upwards the rows are one table inside the family's single scroll
 * port; below it each row is a card carrying the same material and the same controls. The two branches are
 * hidden with `display: none`, so the branch that is not shown is neither a tab stop nor a second copy of
 * a control's name, and their field names carry their branch so no id is rendered twice.
 *
 * **The stop control belongs to the journey, not to this step.** Stopping the import is a consequential
 * change, so it is the shared review step over the cancellation transport, exactly as the results step
 * composes it; {@link ImportStopControl} is the pair of values that composition needs, and this module
 * declares it once for both steps.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { FormErrorSummary, FormField, FormFieldGroup, fieldControlId, type FieldErrorLookup } from "@/components/form-field";
import { PaginationBar } from "@/components/pagination-bar";
import { ScrollRegion } from "@/components/scroll-region";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { MutationInput, ReadEnvelope } from "@/modules/data-service/envelope";
import type { DenialReason, MutationOutcome } from "@/modules/data-service/outcome";
import type { ImportProposalRowReview, ImportProposalView, ImportRowWindow } from "@/modules/data-service/reads/import";
import { IMPORT_DECISION_KINDS, type ImportCellCorrectionInput, type ImportDecisionInput, type ImportDecisionKind } from "@/modules/import/decide";
import { IMPORT_MAX_CELL_CODE_POINTS } from "@/modules/import/parse";
import type { CancelPayload } from "../schemas/acceptance";
import { DECISION_COPY, JOURNEY_COPY, REVIEW_COPY, REVIEW_VERDICT_WORDS, TABLE_LABELS, reviewCandidateLabel, reviewCorrectionLabel, reviewDecisionLabel, reviewDecisionPendingLabel, reviewDecisionSubmitLabel, reviewSkipReasonLabel, reviewWindowSentence } from "../copy";
// The four kinds this step offers, in the order the domain declares them
const DECISION_ORDER: readonly ImportDecisionKind[] = IMPORT_DECISION_KINDS;
const isDecisionKind = (value: unknown): value is ImportDecisionKind => typeof value === "string" && IMPORT_DECISION_KINDS.some((kind) => kind === value);
/** The two presentations of one row: the wide table's cells, and the narrow width's card. */
type Branch = "table" | "card";
const BRANCHES: readonly Branch[] = ["table", "card"];
/**
 * The few sentences this step states that the family's copy module has no entry for: each is wording about
 * a control on this surface, never a domain rule and never a restatement of a sentence the domain derived.
 */
const ROW_COPY = {
  /** Beside a row's restrictions: carried through untouched, with no control here that edits one. */
  restrictionsKept: "Kept exactly as written. This step does not edit a restriction, and nothing here removes or narrows one.",
  /** Beside a correction: the bound belongs to the importer, and this field deliberately does not enforce it. */
  correctionLimit: `At most ${String(IMPORT_MAX_CELL_CODE_POINTS)} characters, counted as Unicode code points. This field does not block a longer value: the importer refuses one with its own count, so a valid value is never stopped here.`,
  /** Why the record control is unavailable until a decision has been chosen. */
  chooseFirst: "Choose one of the decisions above, then record it.",
  /** Why the record control is unavailable once the draft states what this import already holds. */
  alreadyRecorded: (rowNumber: number): string => `This decision is already recorded for row ${String(rowNumber)}. Change the choice or one of its values to record a different decision.`,
  /** Said where a row's review material could not be derived, so no cell is left blank in its place. */
  materialMissing: (rowNumber: number): string => `The values, problems, kept cells, restrictions and proposed contacts of row ${String(rowNumber)} were not derived, so none of them is shown as if it were empty.`,
} as const;

/** The cancellation the stop control submits, with the transport that performs it and what to do once it settles. */
export interface ImportStopControl {
  readonly input: Omit<MutationInput<CancelPayload>, "operationId">;
  readonly submit: MutationSubmit<CancelPayload>;
  readonly onSettled: (outcome: MutationOutcome) => void;
}

/**
 * The one stop-this-import review: the shared review step over the cancellation transport, so stopping
 * asks for a confirmation that states what it does and what it leaves alone, and its result is the shared
 * operation receipt rather than a message this family wrote.
 */
export function StopImportReview({ stop }: { readonly stop: ImportStopControl }): ReactElement {
  return <ActionReview<CancelPayload> title={JOURNEY_COPY.stop.title} description={JOURNEY_COPY.stop.description} confirmLabel={JOURNEY_COPY.stop.confirmLabel} consequential input={stop.input} submit={stop.submit} onSettled={stop.onSettled} />;
}

/**
 * Why the last decision about a row was refused, in the closed vocabulary the service answers with.
 *
 * A refusal is never rendered as a success: an `invalid` answer carries the service's own per-field
 * messages, `denied` its closed reason code, `conflict` the fact that the review moved, and `unavailable`
 * the source that could not be reached together with the service's guidance.
 */
export type StepReviewRefusal =
  | { readonly kind: "invalid"; readonly errors: FieldErrorLookup }
  | { readonly kind: "denied"; readonly reasonCode: DenialReason }
  | { readonly kind: "conflict" }
  | { readonly kind: "unavailable"; readonly source: SourceReference; readonly guidance: string }
  | { readonly kind: "unknown"; readonly operationId: string };

/** Props of {@link StepReview}. */
export interface StepReviewProps {
  /** The proposal the read answered with: its rows are the window this step shows, and its revision is what a decision presents. */
  readonly proposal: ReadEnvelope<ImportProposalView>;
  /** The decisions recorded so far in this browser, so a row's controls start from what the worker already chose. */
  readonly decisions: Readonly<Record<number, ImportDecisionInput>>;
  /** The window of rows the read applied, stated beside the table and driven through the shared paging control. */
  readonly window: ImportRowWindow;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  /**
   * Records one row's decision through the container, which owns the attempt identity and re-reads the
   * review.
   *
   * Submission stays with the journey on purpose: the container mints the attempt's operation identity from
   * the decision itself, presents the scope and revision the read answered with, and turns the outcome into
   * `decidingRowNumber` and `refusal`. A second transport inside this step would be a second owner of the
   * attempt that produced the row, so a retry could start a new attempt instead of replaying this one.
   */
  readonly onDecide: (rowNumber: number, decision: ImportDecisionInput) => void;
  /** The row whose decision is in flight, so only that row states it is working. */
  readonly decidingRowNumber: number | null;
  /** The last refused decision, shown in place and never as an accepted row. */
  readonly refusal: StepReviewRefusal | null;
  /** Opens the selectively-accept step; unavailable until at least one row carries a decision. */
  readonly onContinue: () => void;
  readonly stop: ImportStopControl;
  /**
   * The row the results step asked to reopen this step at, so a return to a row the import did not apply lands
   * on that row rather than at the top of a window the worker then has to search. When that row is not in the
   * window the read returned, this step pages to the window that holds it once.
   */
  readonly focusRowNumber?: number | null;
}

/** One row's controls as the worker has left them, before the decision is recorded. */
interface RowDraft {
  /** The chosen decision, or `null` while the worker has chosen none: nothing is ever pre-selected. */
  readonly choice: ImportDecisionKind | null;
  /** The chosen suggestion, as its position in the row's own suggestion list; `""` when none is chosen. */
  readonly candidate: string;
  /** The typed value of each corrected cell, by 1-based column position. */
  readonly corrections: Readonly<Record<number, string>>;
  readonly reason: string;
}
const EMPTY_CORRECTIONS: Readonly<Record<number, string>> = {};

/** The draft a row starts from: the decision already recorded for it, or no chosen decision at all. */
function draftOf(decision: ImportDecisionInput | undefined, review: ImportProposalRowReview | null): RowDraft {
  if (decision === undefined) {
    return { choice: null, candidate: "", corrections: EMPTY_CORRECTIONS, reason: "" };
  }
  const corrections: Record<number, string> = {};
  if (decision.kind === "create" || decision.kind === "reuse") {
    for (const correction of decision.corrections ?? []) {
      corrections[correction.columnNumber] = correction.value;
    }
  }
  if (decision.kind === "reuse") {
    const index = review === null ? -1 : review.suggestions.findIndex((suggestion) => sameReference(suggestion.reference, decision.candidate));
    return { choice: "reuse", candidate: index === -1 ? "" : String(index), corrections, reason: "" };
  }
  if (decision.kind === "skip") {
    return { choice: "skip", candidate: "", corrections, reason: decision.reason ?? "" };
  }
  return { choice: decision.kind, candidate: "", corrections, reason: "" };
}
function sameReference(left: SourceReference, right: SourceReference): boolean {
  return left.system === right.system && left.reference === right.reference;
}

/**
 * How many rows carry a recorded decision: the same question the journey's own guard asks before the
 * selectively-accept step opens, so the control here and the guard there cannot disagree.
 */
function recordedDecisionCount(decisions: Readonly<Record<number, ImportDecisionInput>>): number {
  let count = 0;
  for (const rowNumber in decisions) {
    if (decisions[rowNumber] !== undefined) {
      count += 1;
    }
  }
  return count;
}

/**
 * The corrections a decision carries: exactly the cells the worker rewrote, in the order the row states
 * them. A cell whose text still reads as the value the file supplied is not a correction, so it is not
 * carried — the service re-derives every rule about the value itself.
 */
function correctionsOf(review: ImportProposalRowReview, draft: RowDraft): readonly ImportCellCorrectionInput[] {
  const corrections: ImportCellCorrectionInput[] = [];
  for (const issue of review.issues) {
    if (issue.columnNumber === null) {
      continue;
    }
    const typed = draft.corrections[issue.columnNumber];
    if (typed === undefined || typed === (issue.value ?? "")) {
      continue;
    }
    corrections.push({ columnNumber: issue.columnNumber, value: typed });
  }
  return corrections;
}

/** The decision the row's controls currently describe, or `null` while the worker has chosen none. */
function decisionOf(rowNumber: number, review: ImportProposalRowReview | null, draft: RowDraft): ImportDecisionInput | null {
  const corrections = review === null ? [] : correctionsOf(review, draft);
  switch (draft.choice) {
    case null:
      return null;
    case "create":
      return corrections.length === 0 ? { kind: "create", rowNumber } : { kind: "create", rowNumber, corrections };
    case "reuse": {
      // The candidate control shows the row's first proposal until the worker names another one, so the
      // decision carries the same one the control is showing rather than nothing at all.
      if (review === null || review.suggestions.length === 0) {
        return null;
      }
      const suggestion = review.suggestions[draft.candidate === "" ? 0 : Number(draft.candidate)];
      if (suggestion === undefined) {
        return null;
      }
      return corrections.length === 0 ? { kind: "reuse", rowNumber, candidate: suggestion.reference } : { kind: "reuse", rowNumber, candidate: suggestion.reference, corrections };
    }
    case "skip": {
      const reason = draft.reason.trim();
      return reason === "" ? { kind: "skip", rowNumber } : { kind: "skip", rowNumber, reason: draft.reason };
    }
    case "unresolved":
      return { kind: "unresolved", rowNumber };
  }
}

/** The ordered cells a decision carries, so two payloads that differ only in the order they were typed compare equal. */
function orderedCorrections(corrections: readonly ImportCellCorrectionInput[] | undefined): readonly ImportCellCorrectionInput[] {
  return corrections === undefined ? [] : [...corrections].sort((left, right) => left.columnNumber - right.columnNumber);
}
/**
 * What a decision states, as one comparable string: its kind, the row it is about, the identity a reuse
 * names, its corrected cells in column order, and a skip's reason trimmed as the domain trims it.
 */
function decisionSignature(decision: ImportDecisionInput): string {
  const corrections = orderedCorrections(decision.kind === "create" || decision.kind === "reuse" ? decision.corrections : undefined)
    .map((correction) => `${String(correction.columnNumber)}=${correction.value}`)
    .join("\u001f");
  const candidate = decision.kind === "reuse" ? formatSourceReference(decision.candidate) : "";
  const reason = decision.kind === "skip" ? (decision.reason ?? "").trim() : "";
  return [decision.kind, String(decision.rowNumber), candidate, corrections, reason].join("\u001e");
}
/**
 * Whether a draft describes a decision this import already holds.
 *
 * This is what keeps a second, identical submission out of the transport. Recording the same decision
 * twice is idempotent in the service — it answers `unchanged` — and that answer would have nothing new to
 * show, so the control says the decision is already recorded instead of sending it again. It is a guard
 * over the worker's own draft, never a permission: a different decision, a corrected value or a decision
 * this browser has not seen recorded all enable the control, and after a lost acknowledgement the
 * submission stays available so the same attempt can be replayed.
 */
function sameDecision(decision: ImportDecisionInput, recorded: ImportDecisionInput | undefined): boolean {
  return recorded !== undefined && decisionSignature(decision) === decisionSignature(recorded);
}

/** The cells a correction can be typed for: the row's own issues that name the column they sit in. */
function correctableOf(review: ImportProposalRowReview | null): ImportProposalRowReview["issues"] {
  if (review === null) {
    return [];
  }
  return review.issues.filter((issue) => issue.columnNumber !== null);
}

// The identifying value a row's card is headed by: the first name-bearing cell the domain mapped for it,
// taken exactly as the file supplied it. It is presentation only and never an identity: two rows may carry
// the same text and remain two rows.
const IDENTIFYING_FIELDS: readonly string[] = ["display-name", "name-given", "name-organization", "name-family"];
function identifyingValueOf(review: ImportProposalRowReview | null): string | null {
  if (review === null) {
    return null;
  }
  for (const fieldId of IDENTIFYING_FIELDS) {
    const cell = review.mappedCells.find((candidate) => candidate.fieldId === fieldId);
    if (cell !== undefined && cell.value.trim() !== "") {
      return cell.value;
    }
  }
  return null;
}

// The material one row shows, each item stated as the read derived it
function RowIssues({ review }: { readonly review: ImportProposalRowReview }): ReactElement {
  if (review.issues.length === 0) {
    return <p className="text-muted-foreground">{REVIEW_COPY.empty.problems}</p>;
  }
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
  if (review.mappedCells.length === 0) {
    return <p className="text-muted-foreground">{REVIEW_COPY.empty.suppliedValues}</p>;
  }
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
  if (kept.length === 0) {
    return <p className="text-muted-foreground">{REVIEW_COPY.empty.keptCells}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {kept.map((cell) => (
        <li key={`${String(cell.columnNumber)}-${cell.reason}`}>
          <span className="font-medium">
            {REVIEW_COPY.keptAsData}: <bdi>{cell.header}</bdi>
          </span>
          <span className="block">
            <bdi>{cell.text}</bdi>
          </span>
          <span className="block text-pretty text-muted-foreground">{cell.message}</span>
        </li>
      ))}
    </ul>
  );
}
function RowRestrictions({ review }: { readonly review: ImportProposalRowReview }): ReactElement {
  if (review.restrictions.length === 0) {
    return <p className="text-muted-foreground">{REVIEW_COPY.empty.restrictions}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {review.restrictions.map((restriction) => (
          <li key={`${String(restriction.columnNumber)}-${restriction.text}`}>
            <bdi className="wrap-anywhere">{restriction.text}</bdi>
            <span className="block text-muted-foreground">
              <bdi>{restriction.header}</bdi>
            </span>
          </li>
        ))}
      </ul>
      {/* Said in words rather than offered as a control: a restriction is carried exactly as the file states
       * it, and no field on this surface edits, clears or narrows one. */}
      <p className="text-sm text-pretty text-muted-foreground">{ROW_COPY.restrictionsKept}</p>
    </div>
  );
}
function RowSuggestions({ review }: { readonly review: ImportProposalRowReview }): ReactElement {
  if (review.suggestions.length === 0) {
    return <p className="text-muted-foreground">{REVIEW_COPY.empty.suggestions}</p>;
  }
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

/** One labelled block of a row's material, as the card presentation stacks it. */
function RowSection({ label, children }: { readonly label: string; readonly children: ReactElement }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-sm font-medium">{label}</p>
      {children}
    </div>
  );
}

/** Everything the read derived about one row, stacked: the card presentation's body. */
function RowMaterialSections({ review }: { readonly review: ImportProposalRowReview }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RowSection label={REVIEW_COPY.column.suppliedValues}>
        <RowSuppliedValues review={review} />
      </RowSection>
      <RowSection label={REVIEW_COPY.column.problems}>
        <RowIssues review={review} />
      </RowSection>
      <RowSection label={REVIEW_COPY.column.keptCells}>
        <RowKeptCells review={review} />
      </RowSection>
      <RowSection label={REVIEW_COPY.column.restrictions}>
        <RowRestrictions review={review} />
      </RowSection>
      <RowSection label={REVIEW_COPY.column.suggestions}>
        <RowSuggestions review={review} />
      </RowSection>
    </div>
  );
}

// One row's controls
const decisionFieldName = (branch: Branch, rowNumber: number): string => `decision-${branch}-${String(rowNumber)}`;
const decisionOptionId = (branch: Branch, rowNumber: number, kind: ImportDecisionKind): string => `${fieldControlId(decisionFieldName(branch, rowNumber))}-option-${kind}`;
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
/**
 * One row's decision, its members and the control that records it.
 *
 * All four decisions are always rendered, each with the sentence stating what it does and leaves alone. A
 * decision the domain has reported as unavailable for this row is disabled — never omitted — with the
 * domain's finding attached through `aria-describedby`, so the reason is reachable at the control rather
 * than only visible further down the row.
 */
function DecisionControl({ rowNumber, branch, review, draft, recorded, pending, onDraft, onRecord }: DecisionControlProps): ReactElement {
  const suggestions = review === null ? [] : review.suggestions;
  const decision = decisionOf(rowNumber, review, draft);
  const correctable = correctableOf(review);
  const chosen = draft.choice;
  const offersCorrections = chosen === "create" || chosen === "reuse";
  const candidate = suggestions[Number(draft.candidate)];
  const reuseOffered = suggestions.length > 0;
  const reuseReasonId = `${fieldControlId(decisionFieldName(branch, rowNumber))}-reuse-reason`;
  const needsChoiceId = `${fieldControlId(decisionFieldName(branch, rowNumber))}-choice-needed`;
  const recordedId = `${fieldControlId(decisionFieldName(branch, rowNumber))}-already-recorded`;
  const alreadyRecorded = decision !== null && sameDecision(decision, recorded);
  const blockedHintId = alreadyRecorded ? recordedId : decision === null ? needsChoiceId : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FormFieldGroup legend={reviewDecisionLabel(rowNumber)} name={decisionFieldName(branch, rowNumber)} description={chosen === null ? undefined : DECISION_COPY[chosen].description}>
        {(group) => (
          <RadioGroup
            value={chosen}
            aria-labelledby={group.legendId}
            aria-describedby={group.describedBy}
            onValueChange={(next: unknown) => {
              if (!isDecisionKind(next)) {
                return;
              }
              const nextCandidate = next === "reuse" && draft.candidate === "" && suggestions.length > 0 ? "0" : draft.candidate;
              onDraft(rowNumber, { ...draft, choice: next, candidate: nextCandidate });
            }}
          >
            {DECISION_ORDER.map((kind) => {
              const optionId = decisionOptionId(branch, rowNumber, kind);
              const consequenceId = `${optionId}-consequence`;
              // Only a reuse can be unavailable to a row: a row nothing was proposed for has nothing to
              // attach itself to. Creating, skipping and leaving undecided stay available on every row.
              const unavailable = kind === "reuse" && !reuseOffered;
              return (
                <label key={kind} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                  <RadioGroupItem id={optionId} value={kind} disabled={pending || unavailable} aria-describedby={unavailable ? `${consequenceId} ${reuseReasonId}` : consequenceId} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{DECISION_COPY[kind].label}</span>
                    <span id={consequenceId} className="text-sm text-pretty text-muted-foreground">
                      {DECISION_COPY[kind].consequence}
                    </span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        )}
      </FormFieldGroup>
      {reuseOffered ? null : (
        <p id={reuseReasonId} className="text-sm text-pretty text-muted-foreground">
          {REVIEW_COPY.empty.suggestions}
        </p>
      )}
      {chosen === "reuse" && reuseOffered ? (
        <FormField label={reviewCandidateLabel(rowNumber)} name={`candidate-${branch}-${String(rowNumber)}`} description={candidate === undefined ? undefined : candidate.message}>
          {({ id, describedBy }) => (
            <NativeSelect
              id={id}
              className="w-full max-w-72"
              value={draft.candidate === "" ? "0" : draft.candidate}
              disabled={pending}
              aria-describedby={describedBy}
              onChange={(event) => {
                onDraft(rowNumber, { ...draft, candidate: event.currentTarget.value });
              }}
            >
              {suggestions.map((suggestion, index) => (
                <NativeSelectOption key={formatSourceReference(suggestion.reference)} value={String(index)}>
                  {formatSourceReference(suggestion.reference)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {offersCorrections && correctable.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium">{REVIEW_COPY.correctionsHeading}</p>
          <p className="text-sm text-pretty text-muted-foreground">{REVIEW_COPY.correctionsNote}</p>
          {correctable.map((issue) => {
            const columnNumber = issue.columnNumber ?? 0;
            const current = draft.corrections[columnNumber] ?? issue.value ?? "";
            // The HTML length attribute is deliberately absent: it counts UTF-16 code units while the importer
            // counts Unicode code points, so a valid 2,000-code-point value containing surrogate pairs would be
            // blocked in the browser. The limit is stated, and the domain refuses a longer value with its count.
            return (
              <FormField key={columnNumber} label={reviewCorrectionLabel(rowNumber, issue.header ?? "")} name={`correction-${branch}-${String(rowNumber)}-${String(columnNumber)}`} description={ROW_COPY.correctionLimit}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    className="max-w-72"
                    value={current}
                    disabled={pending}
                    aria-describedby={describedBy}
                    onChange={(event) => {
                      onDraft(rowNumber, { ...draft, corrections: { ...draft.corrections, [columnNumber]: event.currentTarget.value } });
                    }}
                  />
                )}
              </FormField>
            );
          })}
        </div>
      ) : null}
      {chosen === "skip" ? (
        <FormField label={reviewSkipReasonLabel(rowNumber)} name={`skip-reason-${branch}-${String(rowNumber)}`} description={REVIEW_COPY.skipReasonNote}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              className="max-w-72"
              rows={2}
              value={draft.reason}
              disabled={pending}
              aria-describedby={describedBy}
              onChange={(event) => {
                onDraft(rowNumber, { ...draft, reason: event.currentTarget.value });
              }}
            />
          )}
        </FormField>
      ) : null}
      <p className="text-sm text-pretty text-muted-foreground">{REVIEW_COPY.decisionNote}</p>
      <Button
        type="button"
        className="w-fit"
        disabled={pending || decision === null || alreadyRecorded}
        aria-describedby={blockedHintId}
        onClick={() => {
          if (decision !== null) {
            onRecord(rowNumber, decision);
          }
        }}
      >
        {pending ? reviewDecisionPendingLabel(rowNumber) : reviewDecisionSubmitLabel(rowNumber)}
      </Button>
      {alreadyRecorded ? (
        <p id={recordedId} className="text-sm text-pretty text-muted-foreground">
          {ROW_COPY.alreadyRecorded(rowNumber)}
        </p>
      ) : decision === null ? (
        <p id={needsChoiceId} className="text-sm text-pretty text-muted-foreground">
          {ROW_COPY.chooseFirst}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The first decision control of one row that a worker can actually reach: enabled, and inside the branch
 * that is on screen.
 *
 * Each row's decisions sit in the fieldset its group is named by, so the control is found by its role
 * inside that fieldset rather than by guessing at a tag name — the design system renders the radio as the
 * element carrying `role="radio"`, and looking for a button there would never match. The wide table is
 * rendered below `md` but displayed as nothing at all, so a control in it is skipped rather than focused
 * invisibly.
 */
function firstDecisionControl(rowNumber: number): HTMLElement | null {
  for (const branch of BRANCHES) {
    const fieldset = document.getElementById(fieldControlId(decisionFieldName(branch, rowNumber)));
    if (fieldset === null) {
      continue;
    }
    for (const radio of fieldset.querySelectorAll<HTMLElement>('[role="radio"]')) {
      const unavailable = radio.getAttribute("aria-disabled") === "true" || (radio instanceof HTMLInputElement && radio.disabled);
      if (!unavailable && radio.getClientRects().length > 0) {
        return radio;
      }
    }
  }
  return null;
}

/**
 * The domain's verdict about one row, as words a badge carries: a verdict is never colour alone, and a row
 * whose review material was not derived states that instead of showing an empty or a ready verdict.
 */
function RowVerdict({ review, rowNumber }: { readonly review: ImportProposalRowReview | null; readonly rowNumber: number }): ReactElement {
  if (review === null) {
    return <StateNotice kind="unavailable" headingLevel={4} title={REVIEW_COPY.material.heading} description={ROW_COPY.materialMissing(rowNumber)} />;
  }
  return <Badge variant={review.verdict === "ready" ? "secondary" : "destructive"}>{REVIEW_VERDICT_WORDS[review.verdict]}</Badge>;
}

/**
 * What is recorded about one row. A row nothing has been decided for says so in words: it is never left
 * blank, and it is never given the dash or the zero an absent value would have.
 */
function RowDecisionStatus({ decisionLabel, decided }: { readonly decisionLabel: string; readonly decided: boolean }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="block">
        <bdi>{decisionLabel}</bdi>
      </span>
      {decided ? null : <span className="block text-muted-foreground">{REVIEW_COPY.noDecisionRecorded}</span>}
    </div>
  );
}

// The refusal, in the closed vocabulary it arrived with
function RefusalBlock({ refusal }: { readonly refusal: StepReviewRefusal }): ReactElement {
  if (refusal.kind === "invalid") {
    return <FormErrorSummary errors={refusal.errors} title={REVIEW_COPY.refusal.invalidTitle} description={REVIEW_COPY.refusal.invalidLead} headingLevel={3} />;
  }
  if (refusal.kind === "denied") {
    return (
      <Alert variant="destructive">
        <AlertTitle>{REVIEW_COPY.refusal.deniedTitle}</AlertTitle>
        <AlertDescription>
          <p>{REVIEW_COPY.refusal.deniedLead}</p>
          <p>
            Reason <bdi className="mono-identifier">{refusal.reasonCode}</bdi>.
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  if (refusal.kind === "conflict") {
    return (
      <Alert variant="destructive">
        <AlertTitle>{REVIEW_COPY.refusal.conflictTitle}</AlertTitle>
        <AlertDescription>
          <p>{REVIEW_COPY.refusal.conflictLead}</p>
        </AlertDescription>
      </Alert>
    );
  }
  if (refusal.kind === "unknown") {
    return <StateNotice kind="unknown" headingLevel={3} title={REVIEW_COPY.refusal.unknownTitle} description={REVIEW_COPY.refusal.unknownLead} operationId={refusal.operationId} />;
  }
  return (
    <Alert>
      <AlertTitle>{REVIEW_COPY.refusal.unavailableTitle}</AlertTitle>
      <AlertDescription>
        <p>{REVIEW_COPY.refusal.unavailableLead}</p>
        <p>
          Source <bdi className="mono-identifier">{formatSourceReference(refusal.source)}</bdi>. {refusal.guidance}
        </p>
      </AlertDescription>
    </Alert>
  );
}

/** Step three of the contact import: every row of the returned window, and the decision recorded about each one. */
export default function StepReview({ proposal, decisions, window, onPageChange, onPageSizeChange, onDecide, decidingRowNumber, refusal, focusRowNumber = null, onContinue, stop }: StepReviewProps): ReactElement {
  const view = proposal.data;
  const [drafts, setDrafts] = useState<Readonly<Record<number, RowDraft>>>({});
  const blockedReasonId = useId();
  // The row and the window its focus was last placed at: a page change after that must place focus again.
  const focusHandled = useRef<string | null>(null);
  const tableBusy = decidingRowNumber !== null;
  const reviewFor = (rowNumber: number): ImportProposalRowReview | null => view.review?.rows.find((row) => row.rowNumber === rowNumber) ?? null;
  const recorded = recordedDecisionCount(decisions);
  const draftFor = (rowNumber: number): RowDraft => drafts[rowNumber] ?? draftOf(decisions[rowNumber], reviewFor(rowNumber));
  const setDraft = (rowNumber: number, draft: RowDraft): void => {
    setDrafts((previous) => ({ ...previous, [rowNumber]: draft }));
  };
  // Returning the worker to a row a result reported: focus lands on that row's first reachable decision
  // control, vertically centred inside the region's own scroll padding so the sticky shell cannot cover
  // it, and the page is never scrolled sideways to reach it. The row is not always in the window the read
  // returned, so when no control of it is on screen the window that holds it is opened once; row numbers are
  // the file's own 1-based data-row numbers, which makes the page that holds one the only arithmetic needed.
  useEffect(() => {
    if (focusRowNumber === null) {
      focusHandled.current = null;
      return;
    }
    const key = `${String(focusRowNumber)}@${String(window.page)}`;
    if (focusHandled.current === key) {
      return;
    }
    const control = firstDecisionControl(focusRowNumber);
    if (control !== null) {
      focusHandled.current = key;
      control.focus();
      control.scrollIntoView({ block: "center", inline: "nearest" });
      return;
    }
    if (view.review === null) {
      return;
    }
    const pageOfRow = Math.min(Math.max(Math.ceil(focusRowNumber / window.pageSize), 1), Math.max(window.pageCount, 1));
    if (pageOfRow === window.page) {
      return;
    }
    focusHandled.current = key;
    onPageChange(pageOfRow);
  }, [focusRowNumber, view.review, onPageChange, window.page, window.pageCount, window.pageSize]);
  const hasRows = view.rows.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="text-sm text-pretty text-muted-foreground">{REVIEW_COPY.lead}</p>
      {refusal === null ? null : <RefusalBlock refusal={refusal} />}
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
          <p className="text-sm text-pretty text-muted-foreground">
            {REVIEW_COPY.windowLead} {reviewWindowSentence(window)}
          </p>
          {hasRows ? (
            <>
              {/* One scroll port for this one table: the region carries the accessible name and the
               * `scroll-padding` that keeps a focused control out from under the sticky shell, and at a
               * narrow width the table is not displayed at all rather than scrolled inside it. */}
              <ScrollRegion label={TABLE_LABELS.review} className="hidden md:block" aria-busy={tableBusy ? true : undefined}>
                <Table>
                  <TableCaption className="sr-only">{TABLE_LABELS.review}</TableCaption>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead scope="col">{REVIEW_COPY.column.row}</TableHead>
                      <TableHead scope="col">{REVIEW_COPY.column.verdict}</TableHead>
                      <TableHead scope="col">{REVIEW_COPY.column.recordedDecision}</TableHead>
                      <TableHead scope="col">{REVIEW_COPY.column.suppliedValues}</TableHead>
                      <TableHead scope="col">{REVIEW_COPY.column.problems}</TableHead>
                      <TableHead scope="col">{REVIEW_COPY.column.keptCells}</TableHead>
                      <TableHead scope="col">{REVIEW_COPY.column.restrictions}</TableHead>
                      <TableHead scope="col">{REVIEW_COPY.column.suggestions}</TableHead>
                      <TableHead scope="col">{REVIEW_COPY.column.decision}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.rows.map((row) => {
                      const review = reviewFor(row.rowNumber);
                      return (
                        <TableRow key={row.rowNumber}>
                          <TableHead scope="row" className="whitespace-normal align-top">
                            Row <bdi>{String(row.rowNumber)}</bdi>
                          </TableHead>
                          <TableCell className="whitespace-normal align-top">
                            <RowVerdict review={review} rowNumber={row.rowNumber} />
                          </TableCell>
                          <TableCell className="whitespace-normal align-top">
                            <RowDecisionStatus decisionLabel={row.decisionLabel} decided={row.decision !== "unresolved"} />
                          </TableCell>
                          <TableCell className="whitespace-normal align-top">{review === null ? null : <RowSuppliedValues review={review} />}</TableCell>
                          <TableCell className="whitespace-normal align-top">{review === null ? null : <RowIssues review={review} />}</TableCell>
                          <TableCell className="whitespace-normal align-top">{review === null ? null : <RowKeptCells review={review} />}</TableCell>
                          <TableCell className="whitespace-normal align-top">{review === null ? null : <RowRestrictions review={review} />}</TableCell>
                          <TableCell className="whitespace-normal align-top">{review === null ? null : <RowSuggestions review={review} />}</TableCell>
                          <TableCell className="whitespace-normal align-top">
                            <DecisionControl rowNumber={row.rowNumber} branch="table" review={review} draft={draftFor(row.rowNumber)} recorded={decisions[row.rowNumber]} pending={decidingRowNumber === row.rowNumber} onDraft={setDraft} onRecord={onDecide} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollRegion>
              {/* The same row, its material and its controls at a width where the table is not shown. The
               * branch's field names carry `card`, so no control id and no accessible name is rendered twice. */}
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
                          <CardDescription>{identifying === null ? REVIEW_COPY.empty.suppliedValues : <bdi className="wrap-anywhere">{identifying}</bdi>}</CardDescription>
                        </CardHeader>
                        <CardContent className="flex min-w-0 flex-col gap-3">
                          <RowVerdict review={review} rowNumber={row.rowNumber} />
                          {review === null ? null : <RowMaterialSections review={review} />}
                          <RowDecisionStatus decisionLabel={row.decisionLabel} decided={row.decision !== "unresolved"} />
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
