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
 * **The stop control belongs to the journey, not to this step.** Stopping the import is a consequential
 * change, so it is the shared review step over the cancellation transport, exactly as the results step
 * composes it; {@link ImportStopControl} is the pair of values that composition needs, and this module
 * declares it once for both steps.
 */
import { useId, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { FormErrorSummary, FormField, type FieldErrorLookup } from "@/components/form-field";
import { PaginationBar } from "@/components/pagination-bar";
import { ScrollRegion } from "@/components/scroll-region";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { MutationInput, ReadEnvelope } from "@/modules/data-service/envelope";
import type { DenialReason, MutationOutcome } from "@/modules/data-service/outcome";
import type { ImportProposalRowReview, ImportProposalView, ImportRowWindow } from "@/modules/data-service/reads/import";
import type { ImportCellCorrectionInput, ImportDecisionInput, ImportDecisionKind } from "@/modules/import/decide";
import type { CancelPayload } from "../schemas/acceptance";
import { DECISION_COPY, JOURNEY_COPY, REVIEW_COPY, REVIEW_VERDICT_WORDS, TABLE_LABELS, reviewCandidateLabel, reviewCorrectionLabel, reviewDecisionLabel, reviewDecisionPendingLabel, reviewDecisionSubmitLabel, reviewSkipReasonLabel, reviewWindowSentence } from "../copy";
// The four kinds this step offers, in the order the domain declares them
const DECISION_ORDER: readonly ImportDecisionKind[] = ["create", "reuse", "skip", "unresolved"];

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
  /** Records one row's decision through the container, which owns the attempt identity and re-reads the review. */
  readonly onDecide: (rowNumber: number, decision: ImportDecisionInput) => void;
  /** The row whose decision is in flight, so only that row states it is working. */
  readonly decidingRowNumber: number | null;
  /** The last refused decision, shown in place and never as an accepted row. */
  readonly refusal: StepReviewRefusal | null;
  /** Opens the selectively-accept step; unavailable until at least one row carries a decision. */
  readonly onContinue: () => void;
  readonly stop: ImportStopControl;
}
/** One row's controls as the worker has left them, before the decision is recorded. */
interface RowDraft {
  readonly choice: ImportDecisionKind;
  /** The chosen suggestion, as its position in the row's own suggestion list; `""` when none is chosen. */
  readonly candidate: string;
  /** The typed value of each corrected cell, by 1-based column position. */
  readonly corrections: Readonly<Record<number, string>>;
  readonly reason: string;
}
const EMPTY_CORRECTIONS: Readonly<Record<number, string>> = {};
/** The draft a row starts from: the decision already recorded for it, or the undecided one. */
function draftOf(decision: ImportDecisionInput | undefined, review: ImportProposalRowReview | null): RowDraft {
  if (decision === undefined) {
    return { choice: "unresolved", candidate: "", corrections: EMPTY_CORRECTIONS, reason: "" };
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
/** The decision the row's controls currently describe, or `null` when the row cannot state one yet. */
function decisionOf(rowNumber: number, review: ImportProposalRowReview | null, draft: RowDraft): ImportDecisionInput | null {
  const corrections = review === null ? [] : correctionsOf(review, draft);
  switch (draft.choice) {
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
/** The cells a correction can be typed for: the row's own issues that name the column they sit in. */
function correctableOf(review: ImportProposalRowReview | null): ImportProposalRowReview["issues"] {
  if (review === null) {
    return [];
  }
  return review.issues.filter((issue) => issue.columnNumber !== null);
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
            <bdi>{formatSourceReference(suggestion.reference)}</bdi>
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
                    <bdi className="min-w-0 wrap-anywhere">{field.existing.length === 0 ? "\u2014" : field.existing.join(", ")}</bdi>
                  </span>
                ) : (
                  <span className="text-muted-foreground">{REVIEW_COPY.comparison.notCompared}</span>
                )}
                <span className="flex min-w-0 flex-wrap gap-x-1">
                  <span className="text-muted-foreground">{REVIEW_COPY.comparison.incoming}:</span>
                  <bdi className="min-w-0 wrap-anywhere">{field.incoming.length === 0 ? "\u2014" : field.incoming.join(", ")}</bdi>
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
// One row's controls
interface RowControlsProps {
  readonly rowNumber: number;
  readonly review: ImportProposalRowReview | null;
  readonly draft: RowDraft;
  readonly pending: boolean;
  readonly onDraft: (rowNumber: number, draft: RowDraft) => void;
  readonly onRecord: (rowNumber: number, decision: ImportDecisionInput) => void;
}
function RowControls({ rowNumber, review, draft, pending, onDraft, onRecord }: RowControlsProps): ReactElement {
  const suggestions = review === null ? [] : review.suggestions;
  const decision = decisionOf(rowNumber, review, draft);
  const correctable = correctableOf(review);
  const offersCorrections = draft.choice === "create" || draft.choice === "reuse";
  const candidate = suggestions[Number(draft.candidate)];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FormField label={reviewDecisionLabel(rowNumber)} name={`decision-${String(rowNumber)}`} description={DECISION_COPY[draft.choice].description}>
        {({ id, describedBy }) => (
          <NativeSelect
            id={id}
            className="w-full max-w-72"
            value={draft.choice}
            disabled={pending}
            aria-describedby={describedBy}
            onChange={(event) => {
              const chosen = DECISION_ORDER.find((kind) => kind === event.currentTarget.value);
              if (chosen === undefined) {
                return;
              }
              const nextCandidate = chosen === "reuse" && draft.candidate === "" && suggestions.length > 0 ? "0" : draft.candidate;
              onDraft(rowNumber, { ...draft, choice: chosen, candidate: nextCandidate });
            }}
          >
            <NativeSelectOption value="create">{DECISION_COPY.create.label}</NativeSelectOption>
            {suggestions.length === 0 ? null : <NativeSelectOption value="reuse">{DECISION_COPY.reuse.label}</NativeSelectOption>}
            <NativeSelectOption value="skip">{DECISION_COPY.skip.label}</NativeSelectOption>
            <NativeSelectOption value="unresolved">{DECISION_COPY.unresolved.label}</NativeSelectOption>
          </NativeSelect>
        )}
      </FormField>
      <p className="text-sm text-pretty text-muted-foreground">{DECISION_COPY[draft.choice].consequence}</p>
      {draft.choice === "reuse" && suggestions.length > 0 ? (
        <FormField label={reviewCandidateLabel(rowNumber)} name={`candidate-${String(rowNumber)}`} description={candidate === undefined ? undefined : candidate.message}>
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
            return (
              <FormField key={columnNumber} label={reviewCorrectionLabel(rowNumber, issue.header ?? "")} name={`correction-${String(rowNumber)}-${String(columnNumber)}`}>
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
      {draft.choice === "skip" ? (
        <FormField label={reviewSkipReasonLabel(rowNumber)} name={`skip-reason-${String(rowNumber)}`} description={REVIEW_COPY.skipReasonNote}>
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
        disabled={pending || decision === null}
        onClick={() => {
          if (decision !== null) {
            onRecord(rowNumber, decision);
          }
        }}
      >
        {pending ? reviewDecisionPendingLabel(rowNumber) : reviewDecisionSubmitLabel(rowNumber)}
      </Button>
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
export default function StepReview({ proposal, decisions, window, onPageChange, onPageSizeChange, onDecide, decidingRowNumber, refusal, onContinue, stop }: StepReviewProps): ReactElement {
  const view = proposal.data;
  const [drafts, setDrafts] = useState<Readonly<Record<number, RowDraft>>>({});
  const blockedReasonId = useId();
  const tableBusy = decidingRowNumber !== null;
  const reviewFor = (rowNumber: number): ImportProposalRowReview | null => view.review?.rows.find((row) => row.rowNumber === rowNumber) ?? null;
  const materialComplete = view.review !== null && view.rows.every((row) => reviewFor(row.rowNumber) !== null);
  const recorded = recordedDecisionCount(decisions);
  const draftFor = (rowNumber: number): RowDraft => drafts[rowNumber] ?? draftOf(decisions[rowNumber], reviewFor(rowNumber));
  const setDraft = (rowNumber: number, draft: RowDraft): void => {
    setDrafts((previous) => ({ ...previous, [rowNumber]: draft }));
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="text-sm text-pretty text-muted-foreground">{REVIEW_COPY.lead}</p>
      {refusal === null ? null : <RefusalBlock refusal={refusal} />}
      {materialComplete ? (
        <>
          <p className="text-sm text-pretty text-muted-foreground">
            {REVIEW_COPY.windowLead} {reviewWindowSentence(window)}
          </p>
          {/* One scroll port for this one table: the region carries the accessible name and the
           * `scroll-padding` that keeps a focused control out from under the sticky shell, and at a
           * narrow width the table scrolls inside it rather than the page scrolling sideways. */}
          <ScrollRegion label={TABLE_LABELS.review} aria-busy={tableBusy ? true : undefined}>
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
                      <TableCell className="whitespace-normal align-top">{review === null ? null : <Badge variant={review.verdict === "ready" ? "secondary" : "destructive"}>{REVIEW_VERDICT_WORDS[review.verdict]}</Badge>}</TableCell>
                      <TableCell className="whitespace-normal align-top">
                        <span className="block">{row.decisionLabel}</span>
                        {row.decision === "unresolved" ? <span className="block text-muted-foreground">{REVIEW_COPY.noDecisionRecorded}</span> : null}
                      </TableCell>
                      <TableCell className="whitespace-normal align-top">{review === null ? null : <RowSuppliedValues review={review} />}</TableCell>
                      <TableCell className="whitespace-normal align-top">{review === null ? null : <RowIssues review={review} />}</TableCell>
                      <TableCell className="whitespace-normal align-top">{review === null ? null : <RowKeptCells review={review} />}</TableCell>
                      <TableCell className="whitespace-normal align-top">{review === null ? null : <RowRestrictions review={review} />}</TableCell>
                      <TableCell className="whitespace-normal align-top">{review === null ? null : <RowSuggestions review={review} />}</TableCell>
                      <TableCell className="whitespace-normal align-top">
                        <RowControls rowNumber={row.rowNumber} review={review} draft={draftFor(row.rowNumber)} pending={decidingRowNumber === row.rowNumber} onDraft={setDraft} onRecord={onDecide} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollRegion>
          <PaginationBar total={window.total} page={window.page} pageSize={window.pageSize} itemNoun="rows" disabled={tableBusy} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
        </>
      ) : (
        <Alert>
          <AlertTitle>{REVIEW_COPY.material.heading}</AlertTitle>
          <AlertDescription>
            <p>{REVIEW_COPY.material.lead}</p>
            <p>{view.reviewDetail.message}</p>
          </AlertDescription>
        </Alert>
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
