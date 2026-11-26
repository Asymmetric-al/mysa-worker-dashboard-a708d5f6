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
  heading: "Import summary",
  lead: "Review how your rows will be handled before confirming. Nothing is imported until you click below.",
  countsHeading: "Row breakdown",
  decisionsRecordedLabel: "Rows decided",
  needsReviewLabel: "Rows still undecided",
  detailNote:
    "Row-level issues, consent columns, and restrictions are shown on the Review rows step. After importing, you’ll see a row-by-row receipt on the Results step.",
} as const;
const COUNT_ROWS: readonly { readonly kind: ImportDecisionKind; readonly label: string }[] = [
  { kind: "create", label: RESULTS_COPY.summaryLabels.create },
  { kind: "reuse", label: RESULTS_COPY.summaryLabels.reuse },
  { kind: "skip", label: RESULTS_COPY.summaryLabels.skip },
  { kind: "unresolved", label: RESULTS_COPY.summaryLabels.unresolved },
];
const CountFact = ({ label, value }: { readonly label: string; readonly value: number }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border/80 bg-card px-3.5 py-2.5 shadow-2xs">
    <dt className="min-w-0 text-xs text-pretty text-muted-foreground">{label}</dt>
    <dd className="tabular-figures text-lg font-semibold tracking-tight text-foreground">
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
      <section aria-labelledby={summaryHeadingId} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border/80 bg-surface-subtle p-4 text-sm sm:p-5">
        <h3 id={summaryHeadingId} className="type-subsection-title">
          {SUMMARY_COPY.heading}
        </h3>
        <p className="type-supporting text-pretty">{SUMMARY_COPY.lead}</p>
        <section aria-labelledby={countsHeadingId} className="flex min-w-0 flex-col gap-3">
          <h4 id={countsHeadingId} className="type-group-title">
            {SUMMARY_COPY.countsHeading}
          </h4>
          <dl className="grid min-w-0 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
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
