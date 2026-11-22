"use client";
/**
 * Contact import, step four — Selectively accept: the summary of what the decisions recorded so far will do
 * with this file, stated before anything is accepted, and the journey's one acceptance control.
 *
 * **Why the pre-acceptance summary is exactly these seven numbers.** Every number this step states is the
 * proposal read's own `summary` projection (`ImportProposalSummaryView`), and that read is the only one that
 * answers before an acceptance: how the file's rows divide across the four decisions — `create`, `reuse`,
 * `skip` and `unresolved` — how many data rows the file holds (`rowCount`), how many rows carry a recorded
 * decision (`decisionsRecorded`) and how many are still awaiting one (`needsReview`). It states no other
 * count, percentage or total, because no pre-acceptance read states one: a row's own problems, the cells kept
 * as data and the restrictions it carries are derived per row by the review step, and their counts —
 * `blockedRowCount`, `blockedReasons`, `corrections`, `correctionCount`, `restrictionsPreserved` and
 * `restrictionsCarried` — exist only in the receipt summary (`ImportReceiptView.summary`) that the results
 * step reads back once the operation has been accepted. Nothing here counts a row this step cannot read, and
 * no number the read did not state is shown as a zero.
 *
 * **Where that detail is stated instead.** Before acceptance, each row's problems, kept cells and
 * restrictions are the review step's per-row material, stated beside the decision about that row. After
 * acceptance, what became of each row — and how many rows a problem stopped, a correction changed or a
 * restriction accompanied — is the receipt's, on the results step. This step states the totals those two
 * read and asks for the acceptance; it never restates, approximates or derives either.
 *
 * **What this file decides and what it never does.** It decides nothing of its own: the summary is the
 * service's, the decisions are the journey's, and the acceptance's attempt identity, in-flight fence, replay
 * of the same work, conflict re-apply and durable receipt belong to the shared review step (`ActionReview`)
 * that {@link AcceptanceReview} composes over the journey's own transport. A lost acknowledgement is
 * therefore resolved by checking that same operation, never by sending a second acceptance; this file mints
 * no attempt identity, keeps no transport and owns no operation result, because a second one here would let
 * one reviewed snapshot be accepted twice.
 */
import { useId, type ReactElement } from "react";
import type { MutationSubmit } from "@/components/action-review";
import type { MutationInput } from "@/modules/data-service/envelope";
import type { ImportProposalSummaryView } from "@/modules/data-service/reads/import";
import type { ImportDecisionKind } from "@/modules/import/decide";
import { RESULTS_COPY } from "../copy";
import type { AcceptImportRowsPayload } from "../schemas/acceptance";
import AcceptanceReview from "./acceptance-review";
/**
 * The few words this step states that the family's copy module has no entry for: the heading and lead of the
 * summary itself, the two counts the results step's label set does not name, and the sentence saying where
 * the per-row detail is stated instead. Each decision count keeps the results step's own label, so one
 * vocabulary names a decision kind on every step that states it.
 */
const SUMMARY_COPY = {
  heading: "What acceptance will do with this file",
  lead: "Every number below is the importer's own summary of this file and of the decisions recorded for its rows, read back before anything is accepted. Nothing is created until you accept, and a row is accepted only for the decision it carries.",
  countsHeading: "How this file's rows divide",
  decisionsRecordedLabel: "Rows carrying a decision",
  needsReviewLabel: "Rows still awaiting a decision",
  detailNote:
    "This summary states counts only, because the proposal read states counts only. A row's own problems, the cells kept as data and the restrictions it carries are stated row by row on the review step, beside the decision about that row; what became of each row — with how many rows a problem stopped, a correction changed or a restriction accompanied — is stated in the receipt on the results step once this acceptance has run.",
} as const;
/** The four decisions as counts, in the family's own count labels, so one vocabulary names each kind here and in the results. */
const COUNT_ROWS: readonly { readonly kind: ImportDecisionKind; readonly label: string }[] = [
  { kind: "create", label: RESULTS_COPY.summaryLabels.create },
  { kind: "reuse", label: RESULTS_COPY.summaryLabels.reuse },
  { kind: "skip", label: RESULTS_COPY.summaryLabels.skip },
  { kind: "unresolved", label: RESULTS_COPY.summaryLabels.unresolved },
];
/** One count of the summary, labelled in the family's own words and rendered as its own figure. */
function CountFact({ label, value }: { readonly label: string; readonly value: number }): ReactElement {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="min-w-0 text-pretty text-muted-foreground">{label}</dt>
      <dd className="shrink-0 tabular-figures font-medium text-foreground">
        <bdi>{String(value)}</bdi>
      </dd>
    </div>
  );
}
/** Props of {@link StepAcceptance}. */
export type StepAcceptanceProps = {
  /** The proposal read's own summary of the decisions recorded for this file, exactly as the service computed it. */
  readonly summary: ImportProposalSummaryView;
  /** How many rows of the file the decisions this acceptance posts cover, as the journey holds them. */
  readonly decidedRowCount: number;
  /** The reviewed snapshot this acceptance presents: the context, the revision the worker saw and the payload to apply. */
  readonly input: Omit<MutationInput<AcceptImportRowsPayload>, "operationId">;
  /** The journey's own acceptance transport, which the shared review step submits through. */
  readonly submit: MutationSubmit<AcceptImportRowsPayload>;
  /** The way back to the step where each row's own material is stated and decided. */
  readonly onCancel?: () => void;
};
/** Step four of the contact import: the pre-acceptance summary of the decisions recorded, then the acceptance itself. */
export default function StepAcceptance({ summary, decidedRowCount, input, submit, onCancel }: StepAcceptanceProps): ReactElement {
  const summaryHeadingId = useId();
  const countsHeadingId = useId();
  return (
    <div data-slot="step-acceptance" className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby={summaryHeadingId} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3 text-sm">
        <h3 id={summaryHeadingId} className="font-heading text-base font-medium">
          {SUMMARY_COPY.heading}
        </h3>
        <p className="text-pretty text-muted-foreground">{SUMMARY_COPY.lead}</p>
        <section aria-labelledby={countsHeadingId} className="flex min-w-0 flex-col gap-2">
          <h4 id={countsHeadingId} className="font-semibold text-foreground">
            {SUMMARY_COPY.countsHeading}
          </h4>
          <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
            {COUNT_ROWS.map((row) => (
              <CountFact key={row.kind} label={row.label} value={summary[row.kind]} />
            ))}
            <CountFact label={RESULTS_COPY.summaryLabels.rowCount} value={summary.rowCount} />
            <CountFact label={SUMMARY_COPY.decisionsRecordedLabel} value={summary.decisionsRecorded} />
            <CountFact label={SUMMARY_COPY.needsReviewLabel} value={summary.needsReview} />
          </dl>
        </section>
        <p className="text-pretty text-muted-foreground">{SUMMARY_COPY.detailNote}</p>
      </section>
      {/* The notice and the accept control are the family's one acceptance surface: this step states the
       * summary above them and hands the reviewed snapshot to the shared review step it composes. */}
      <AcceptanceReview input={input} submit={submit} decidedRowCount={decidedRowCount} onCancel={onCancel} />
    </div>
  );
}
