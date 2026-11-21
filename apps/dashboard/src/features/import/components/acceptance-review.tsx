"use client";
/**
 * Contact import, step four — Selectively accept: what acceptance will and will not do, stated before
 * anything is accepted, and the shared review step that applies the reviewed decisions.
 */
import { useId, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import type { MutationInput } from "@/modules/data-service/envelope";
import { ACCEPTANCE_NOTICE, ACCEPTANCE_REVIEW_COPY, IMPORT_SIMULATION_EFFECT } from "../copy";
import type { AcceptImportRowsPayload } from "../schemas/acceptance";
/** Props of {@link AcceptanceReview}. */
export interface AcceptanceReviewProps {
  readonly input: Omit<MutationInput<AcceptImportRowsPayload>, "operationId">;
  readonly submit: MutationSubmit<AcceptImportRowsPayload>;
  readonly decidedRowCount: number;
  readonly onCancel?: () => void;
}
/** Step four of the contact import: the pre-acceptance notice, then the shared review step over the decisions the worker reviewed. */
export default function AcceptanceReview({ input, submit, decidedRowCount, onCancel }: AcceptanceReviewProps): ReactElement {
  const noticeHeadingId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby={noticeHeadingId} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3 text-sm">
        <p id={noticeHeadingId} className="font-medium">
          {ACCEPTANCE_REVIEW_COPY.noticeHeading}
        </p>
        <p className="text-pretty text-muted-foreground">{ACCEPTANCE_REVIEW_COPY.noticeLead}</p>
        <ul className="flex min-w-0 flex-col gap-2">
          {ACCEPTANCE_NOTICE.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{item.label}</span>
              <span className="text-pretty text-muted-foreground">{item.statement}</span>
            </li>
          ))}
        </ul>
      </section>
      <ActionReview<AcceptImportRowsPayload>
        title={ACCEPTANCE_REVIEW_COPY.title}
        description={ACCEPTANCE_REVIEW_COPY.description}
        confirmLabel={ACCEPTANCE_REVIEW_COPY.confirmLabel}
        simulationEffect={IMPORT_SIMULATION_EFFECT}
        selection={{ count: decidedRowCount, noun: ACCEPTANCE_REVIEW_COPY.selectionNoun }}
        input={input}
        submit={submit}
        onCancel={onCancel}
      />
    </div>
  );
}
