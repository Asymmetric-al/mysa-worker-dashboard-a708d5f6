"use client";

/**
 * Contact import, step four — Selectively accept: what acceptance will and will not do, stated before
 * anything is accepted, and the shared review step that applies the reviewed decisions.
 *
 * Scope: AAP 0.10.1 family "Contact import" (criterion 4's per-row decisions, a stable operation
 * identity and a recoverable receipt), 0.6.4 ("consequential actions go through the shared review
 * step"), 0.3.4's single review-and-result implementation, and 0.7.2's rule that every simulated
 * effect is labelled at the point the worker triggers it — which is why the importer's effect is passed
 * to the review step, whose label renders beside the confirm control and again on the receipt. Step
 * four only: this surface accepts the rows the worker has already decided about. It shows no per-row
 * result, opens no contact and reports no receipt of its own.
 *
 * What it does not own, and must not grow to own:
 *
 * - **Attempt identity.** The `operationId` belongs to `ActionReview`'s `useReviewedMutation`, which
 *   mints exactly one identity per intent and replays it. A payload, an identity or a submission
 *   assembled here would be a second owner of that rule, so this file only forwards what it is given.
 * - **The reviewed decisions.** The payload is the caller's snapshot of the rows the worker actually
 *   reviewed. Building it here from row state would let this surface accept rows the worker never
 *   confirmed, and the file it was given for is the caller's fact too, so `fileFingerprint` and
 *   `acknowledged` arrive inside `input.payload` and are never re-derived.
 * - **The count it states.** The selection is handed in as a number, because the caller counts the rows
 *   it reviewed; where this surface counted decisions of its own it could disagree with the payload it
 *   submits.
 *
 * The notice comes first and is complete. Every line of `ACCEPTANCE_NOTICE` renders above the review
 * step, each as its own label and statement, so the seven things this import never does — creates no
 * audience membership, records no consent, subscribes no one, keeps a consent-looking column as data,
 * preserves a negative restriction, treats a suggested contact as a proposal rather than a merge, and
 * reaches only the rows summarised — are read while the worker can still change their mind. Nothing
 * here is a caveat shown after the fact.
 *
 * Direction, size and rendering. Only logical utilities are used, so a right-to-left block mirrors
 * itself, and nothing has a fixed width, so the step completes at 320 CSS px without the page
 * scrolling sideways. The step is static content above the review step, which owns its own live
 * region, focus moves and 24x24 CSS px targets; a server render produces the same notice and the same
 * disclosure, because nothing here reads a browser API, a clock or a locale.
 */

import { useId, type ReactElement } from "react";

import ActionReview, { type MutationSubmit } from "@/components/action-review";
import type { MutationInput } from "@/modules/data-service/envelope";

import { ACCEPTANCE_NOTICE, ACCEPTANCE_REVIEW_COPY, IMPORT_SIMULATION_EFFECT } from "../copy";
import type { AcceptImportRowsPayload } from "../schemas/acceptance";

/** Props of {@link AcceptanceReview}. */
export interface AcceptanceReviewProps {
  /**
   * The mutation's scope, the revision the caller saw and the payload it reviewed. The identity is
   * absent on purpose: `ActionReview` mints the `operationId` that makes this one attempt.
   */
  readonly input: Omit<MutationInput<AcceptImportRowsPayload>, "operationId">;
  /** The caller's transport for `acceptImportRows`; the review step calls it once per intent. */
  readonly submit: MutationSubmit<AcceptImportRowsPayload>;
  /** How many rows the worker decided about, counted by the caller from the snapshot it submits. */
  readonly decidedRowCount: number;
  /** Closes the step without accepting anything. Absent when the journey offers no way back. */
  readonly onCancel?: () => void;
}

/**
 * Step four of the contact import: the pre-acceptance notice, then the shared review step over the
 * decisions the worker reviewed.
 *
 * The notice is stated once and the review step states the rest. This surface adds no second summary
 * of the change: the review step renders the title, the description, the selection it was given, the
 * containment sentence, the simulated-effect label and the receipt, so a count or a fact stated here
 * as well would be a second account that could disagree with the one the worker confirms.
 */
export default function AcceptanceReview({
  input,
  submit,
  decidedRowCount,
  onCancel,
}: AcceptanceReviewProps): ReactElement {
  const noticeHeadingId = useId();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section
        aria-labelledby={noticeHeadingId}
        className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3 text-sm"
      >
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
        /* The importer's own effect, so the review step renders the sentence beside the confirm
         * control and again on the receipt; the sentence itself stays in `simulation-label`. */
        simulationEffect={IMPORT_SIMULATION_EFFECT}
        selection={{ count: decidedRowCount, noun: ACCEPTANCE_REVIEW_COPY.selectionNoun }}
        input={input}
        submit={submit}
        onCancel={onCancel}
      />
    </div>
  );
}
