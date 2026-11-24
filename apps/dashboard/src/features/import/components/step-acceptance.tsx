"use client";
import { useId, type ReactElement } from "react";
import type { MutationSubmit } from "@/components/action-review";
import type { MutationInput } from "@/modules/data-service/envelope";
import type { ImportProposalSummaryView } from "@/modules/data-service/reads/import";
import type { ImportDecisionKind } from "@/modules/import/decide";
import { RESULTS_COPY } from "../copy";
import type { AcceptImportRowsPayload } from "../schemas/acceptance";
import AcceptanceReview from "./acceptance-review";
const SUMMARY_COPY = {
  heading: "What acceptance will do with this file",
  lead: "Every number below is the importer's own summary of this file and of the decisions recorded for its rows, read back before anything is accepted. Nothing is created until you accept, and a row is accepted only for the decision it carries.",
  countsHeading: "How this file's rows divide",
  decisionsRecordedLabel: "Rows carrying a decision",
  needsReviewLabel: "Rows still awaiting a decision",
  detailNote:
    "This summary states counts only, because the proposal read states counts only. A row's own problems, the cells kept as data and the restrictions it carries are stated row by row on the review step, beside the decision about that row; what became of each row — with how many rows a problem stopped, a correction changed or a restriction accompanied — is stated in the receipt on the results step once this acceptance has run.",
} as const;
const COUNT_ROWS: readonly { readonly kind: ImportDecisionKind; readonly label: string }[] = [
  { kind: "create", label: RESULTS_COPY.summaryLabels.create },
  { kind: "reuse", label: RESULTS_COPY.summaryLabels.reuse },
  { kind: "skip", label: RESULTS_COPY.summaryLabels.skip },
  { kind: "unresolved", label: RESULTS_COPY.summaryLabels.unresolved },
];
const CountFact = ({ label, value }: { readonly label: string; readonly value: number }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <dt className="min-w-0 text-pretty text-muted-foreground">{label}</dt>
    <dd className="tabular-figures font-medium text-foreground">
      <bdi>{String(value)}</bdi>
    </dd>
  </div>
);
/** Props of {@link StepAcceptance}. */
export type StepAcceptanceProps = { readonly summary: ImportProposalSummaryView; readonly decidedRowCount: number; readonly input: Omit<MutationInput<AcceptImportRowsPayload>, "operationId">; readonly submit: MutationSubmit<AcceptImportRowsPayload>; readonly onCancel?: () => void };
/** Step four of the contact import: the pre-acceptance summary of the decisions recorded, then the acceptance itself. */ export default function StepAcceptance({ summary, decidedRowCount, input, submit, onCancel }: StepAcceptanceProps): ReactElement {
  const summaryHeadingId = useId();
  const countsHeadingId = useId();
  return (
    <div data-slot="step-acceptance" className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby={summaryHeadingId} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3 text-sm">
        <h3 id={summaryHeadingId} className="type-subsection-title">
          {SUMMARY_COPY.heading}
        </h3>
        <p className="type-supporting text-pretty">{SUMMARY_COPY.lead}</p>
        <section aria-labelledby={countsHeadingId} className="flex min-w-0 flex-col gap-2">
          <h4 id={countsHeadingId} className="type-group-title">
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
        <p className="type-supporting text-pretty">{SUMMARY_COPY.detailNote}</p>
      </section>
      <AcceptanceReview input={input} submit={submit} decidedRowCount={decidedRowCount} onCancel={onCancel} />
    </div>
  );
}
