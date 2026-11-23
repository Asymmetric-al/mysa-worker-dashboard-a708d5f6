"use client";
import Link from "next/link";
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { MutationInput, MutationOutcome, ReadAction, Scope, reads } from "@/modules/data-service";
import { CONTINUE_COPY, CONTINUATION_WINDOW_COPY, EXPIRED_HISTORY_COPY, LIST_COPY, OUTCOME_COPY, STATUS_COPY, type ContinueUnavailableReason } from "../copy";
import { useReferral } from "../hooks/use-referral";
import { useContinueReferral } from "../hooks/use-referral-mutations";
import type { ContinueReferralPayload } from "../schemas";
const CYCLE_TERM = EXPIRED_HISTORY_COPY.fieldLabels.cycleIndex;
const DEFAULT_HEADING_LEVEL: ReviewHeadingLevel = 2;
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
const HEADING_SCALE: Readonly<Record<keyof typeof HEADING_TAG, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const PANEL_CLASS = "flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3";
const SENTENCE_CLASS = "type-supporting text-pretty";
const FACT_ROW_CLASS = "flex min-w-0 flex-wrap items-baseline gap-x-2";
const FACT_TERM_CLASS = "text-muted-foreground";
const IDENTIFIER_CLASS = "mono-identifier min-w-0 wrap-anywhere";
type ReferralDetailReadResult = Awaited<ReturnType<typeof reads.referrals.readReferral>>;
type ReferralDetailEnvelope = Extract<ReferralDetailReadResult, { readonly kind: "envelope" }>["envelope"];
type ReferralDetailView = Extract<ReferralDetailEnvelope["data"], { readonly view: "detail" }>;
/** The cycle this action acts on: exactly the members the narrow permitted Expired projection carries, so one action serves the full detail body and the permitted history alike. The revision the command presents is the envelope's own and is handed over separately, because that projection carries no revision of its own. */
export type ContinueReferralCycle = Pick<ReferralDetailView["referral"], "referralId" | "cycleIndex" | "datePrecision" | "windowKind" | "status" | "continuation">;
export type ContinuePolicyFacts = ReferralDetailView["continuationPolicy"];
export type ContinueReferralActionProps = {
  readonly scope: Scope;
  readonly referral: ContinueReferralCycle;
  /** The revision the read that answered this cycle published, taken from its envelope rather than from the row; the command presents it, so a cycle that moved settles as a conflict rather than as an overwrite. */
  readonly expectedRevision: string;
  readonly continuationPolicy: ContinuePolicyFacts;
  readonly actions: readonly ReadAction[];
  readonly onCheckResult?: () => void;
  /** What the action reports once its attempt stands: the surface that hosts it keeps the receipt after a later read stops offering a continuation this attempt has already taken. */
  readonly onSettled?: (outcome: MutationOutcome) => void;
  readonly headingLevel?: ReviewHeadingLevel;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
};
type ContinueInput = Omit<MutationInput<ContinueReferralPayload>, "operationId">;
const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null);
function stringMember(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
function numberMember(record: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function reportedContinuationOf(outcome: MutationOutcome | null): { readonly successorId: string | null; readonly endsAt: string | null; readonly elapsedSeconds: number | null } | null {
  if (outcome === null || (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted")) return null;
  const created = outcome.created?.find((id) => id.trim() !== "") ?? null;
  const stored = outcome.outcome === "alreadyAccepted" ? asRecord(outcome.result) : null;
  const identified = (stored === null ? null : stringMember(stored, "successorId")) ?? created;
  return identified === null ? null : { successorId: identified, endsAt: stored === null ? null : stringMember(stored, "windowEnd"), elapsedSeconds: stored === null ? null : numberMember(stored, "elapsedSeconds") };
}
type SuccessorWindow = { readonly endsAt: string; readonly elapsedSeconds: number };
const MILLIS_PER_SECOND = 1_000;
/** The whole seconds between the two instants a record states, or null when either is absent or unreadable: a continuation is measured in elapsed seconds, so its figure is the distance between those instants. */
function elapsedBetween(start: string | null, end: string | null): number | null {
  if (start === null || end === null) return null;
  const seconds = Math.round((Date.parse(end) - Date.parse(start)) / MILLIS_PER_SECOND);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
/** The window the successor's own record states: both presentations of one referral state the instants its window was written with, so the endpoint and the elapsed figure it is counted in come from the record whether the successor still stands inside its window or has itself since expired. */
function recordedSuccessorWindow(read: ReferralDetailReadResult | undefined): SuccessorWindow | null {
  if (read === undefined || read.kind !== "envelope") return null;
  const { windowStart, windowEnd } = read.envelope.data.referral;
  const elapsedSeconds = elapsedBetween(windowStart, windowEnd);
  return windowEnd === null || elapsedSeconds === null ? null : { endsAt: windowEnd, elapsedSeconds };
}
const STANDING_REASONS: Readonly<Partial<Record<ContinueReferralCycle["status"]["status"], ContinueUnavailableReason | null>>> = { active: "not-ordinarily-expired", "no-deadline": "precision-does-not-admit-a-deadline", refused: null };
function classifiedReason(referral: ContinueReferralCycle, policy: ContinuePolicyFacts): ContinueUnavailableReason | null {
  const standing = STANDING_REASONS[referral.status.status];
  if (standing !== undefined) return standing;
  if (referral.windowKind !== "new" || referral.continuation.cycle.consumed || referral.continuation.cycle.successorId !== null) return "already-consumed";
  if (referral.datePrecision !== "date") return "precision-does-not-admit-a-deadline";
  return policy.setting === "off" ? "worker-setting-off" : null;
}
const OUTCOME_DETAIL: Readonly<Partial<Record<MutationOutcome["outcome"], string>>> = { conflict: OUTCOME_COPY.conflict.detail, unchanged: OUTCOME_COPY.unchanged.detail, unknown: OUTCOME_COPY.unknown.detail };
const outcomeCommentary = (outcome: MutationOutcome | null): string | null => (outcome === null ? null : (OUTCOME_DETAIL[outcome.outcome] ?? null));
const UnavailableReason = ({ reason }: { readonly reason: ContinueUnavailableReason }): ReactElement => <p className={SENTENCE_CLASS}>{CONTINUE_COPY.unavailableReasons[reason]}</p>;
function CycleFacts({ referral }: { readonly referral: ContinueReferralCycle }): ReactElement {
  const standing = STATUS_COPY[referral.status.status];
  return (
    <dl className="flex min-w-0 flex-col gap-1.5 text-sm">
      <div className={FACT_ROW_CLASS}>
        <dt className={FACT_TERM_CLASS}>{CYCLE_TERM}</dt>
        <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <bdi className="tabular-figures font-medium">{String(referral.cycleIndex)}</bdi>
          <bdi className={IDENTIFIER_CLASS}>{referral.referralId}</bdi>
        </dd>
      </div>
      <div className={FACT_ROW_CLASS}>
        <dt className={FACT_TERM_CLASS}>{LIST_COPY.columns.status}</dt>
        <dd className="flex min-w-0 flex-col gap-1">
          <Badge variant="outline">{standing.label}</Badge>
          <span className="min-w-0 text-pretty text-muted-foreground">{standing.description}</span>
        </dd>
      </div>
      <div className={FACT_ROW_CLASS}>
        <dt className={FACT_TERM_CLASS}>{EXPIRED_HISTORY_COPY.fieldLabels.consumed}</dt>
        <dd>{referral.continuation.cycle.consumed ? EXPIRED_HISTORY_COPY.consumedLabels.continued : EXPIRED_HISTORY_COPY.consumedLabels.notContinued}</dd>
      </div>
    </dl>
  );
}
function NotOffered({ headingId, headingLevel, sentence, reason, referral }: { readonly headingId: string; readonly headingLevel: ReviewHeadingLevel; readonly sentence: string | null; readonly reason: ContinueUnavailableReason | null; readonly referral: ContinueReferralCycle }): ReactElement {
  const Heading = HEADING_TAG[headingLevel];
  return (
    <section aria-labelledby={headingId} data-slot="continue-referral-unavailable" className={PANEL_CLASS}>
      <Heading id={headingId} className={HEADING_SCALE[headingLevel]}>
        {CONTINUE_COPY.unavailableHeading}
      </Heading>
      {sentence === null ? null : <p className={SENTENCE_CLASS}>{sentence}</p>}
      {sentence === null && reason !== null ? <UnavailableReason reason={reason} /> : null}
      <CycleFacts referral={referral} />
    </section>
  );
}
function ContinuedWindow({ labelId, successorId, endsAt, elapsedSeconds }: { readonly labelId: string; readonly successorId: string; readonly endsAt: string | null; readonly elapsedSeconds: number | null }): ReactElement {
  const statedEnd = endsAt === null || elapsedSeconds === null ? null : CONTINUATION_WINDOW_COPY.elapsedSeconds(elapsedSeconds, endsAt);
  return (
    <section aria-labelledby={labelId} data-slot="continue-referral-successor" className={PANEL_CLASS}>
      <p id={labelId} className="text-sm font-medium">
        {CONTINUATION_WINDOW_COPY.heading}
      </p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-body">
        <span className={FACT_TERM_CLASS}>{EXPIRED_HISTORY_COPY.consumedLabels.continued}</span>
        <Link href={`/partners/referrals/${encodeURIComponent(successorId)}`} className="inline-flex min-h-target max-w-full items-center text-sm font-medium text-primary inline-link focus-visible:underline">
          <bdi className={IDENTIFIER_CLASS}>{successorId}</bdi>
        </Link>
      </p>
      {statedEnd === null ? null : <p className="type-supporting text-pretty">{statedEnd}</p>}
      {statedEnd === null ? null : <p className={SENTENCE_CLASS}>{CONTINUATION_WINDOW_COPY.elapsedNotCalendar}</p>}
      <p className={SENTENCE_CLASS}>{CONTINUATION_WINDOW_COPY.oneSuccessor}</p>
    </section>
  );
}
export function ContinueReferralAction({ scope, referral, expectedRevision, continuationPolicy, actions, onCheckResult, onSettled, headingLevel = DEFAULT_HEADING_LEVEL, dir, className }: ContinueReferralActionProps): ReactElement {
  const { mutateAsync } = useContinueReferral();
  const headingId = useId();
  const successorLabelId = useId();
  const [submitted, setSubmitted] = useState<ContinueInput | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const offered = actions.some((action) => action.name === "continueReferral" && action.available);
  const liveInput = useMemo<ContinueInput>(() => ({ scope, expectedRevision, payload: { referralId: referral.referralId } }), [scope, expectedRevision, referral.referralId]);
  const holdsReceipt = settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged");
  const input = holdsReceipt && submitted !== null ? submitted : liveInput;
  const submit = useCallback<MutationSubmit<ContinueReferralPayload>>(
    async (attempt: MutationInput<ContinueReferralPayload>): Promise<MutationOutcome> => {
      setSubmitted({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      return mutateAsync(attempt);
    },
    [mutateAsync],
  );
  const settle = useCallback(
    (outcome: MutationOutcome): void => {
      setSettled(outcome);
      onSettled?.(outcome);
    },
    [onSettled],
  );
  const withheldReason = referral.continuation.reason ?? continuationPolicy.reason;
  const classified = classifiedReason(referral, continuationPolicy);
  const reported = reportedContinuationOf(settled);
  const successorId = reported?.successorId ?? referral.continuation.cycle.successorId ?? null;
  const successor = useReferral({ scope, referralId: successorId });
  // The accepted outcome carries no result, so the successor's own record supplies the endpoint, and the elapsed figure is the difference between the two instants that record states. A settled report that carries them itself, as a replay does, is preferred to it.
  const recorded = recordedSuccessorWindow(successor.data);
  const endsAt = reported?.endsAt ?? recorded?.endsAt ?? null;
  const elapsedSeconds = reported?.elapsedSeconds ?? recorded?.elapsedSeconds ?? null;
  const commentary = outcomeCommentary(settled);
  const showReview = offered || settled !== null;
  return (
    <div dir={dir} className={cn("flex min-w-0 flex-col gap-4", className)}>
      {showReview ? (
        <ActionReview<ContinueReferralPayload>
          title={CONTINUE_COPY.confirm.title}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p className="type-supporting">{CONTINUE_COPY.available}</p>
              <p className="type-supporting">{CONTINUATION_WINDOW_COPY.explanation}</p>
              <p className="type-supporting">{CONTINUATION_WINDOW_COPY.elapsedNotCalendar}</p>
              <p className="type-supporting">{CONTINUATION_WINDOW_COPY.oneSuccessor}</p>
              <CycleFacts referral={referral} />
            </div>
          }
          consequence={
            <div className="flex min-w-0 flex-col gap-2">
              <p className="type-supporting">{CONTINUE_COPY.confirm.body(`${CYCLE_TERM} ${String(referral.cycleIndex)}`)}</p>
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-body">
                <span className={FACT_TERM_CLASS}>{CYCLE_TERM}</span>
                <bdi className="tabular-figures font-medium">{String(referral.cycleIndex)}</bdi>
                <bdi className={IDENTIFIER_CLASS}>{referral.referralId}</bdi>
              </p>
            </div>
          }
          confirmLabel={CONTINUE_COPY.label}
          cancelLabel={CONTINUE_COPY.confirm.cancelLabel}
          consequential
          input={input}
          submit={submit}
          onSettled={settle}
          checkResult={onCheckResult}
          headingLevel={headingLevel}
        />
      ) : (
        <NotOffered headingId={headingId} headingLevel={headingLevel} sentence={withheldReason} reason={classified} referral={referral} />
      )}
      {successorId === null ? null : <ContinuedWindow labelId={successorLabelId} successorId={successorId} endsAt={endsAt} elapsedSeconds={elapsedSeconds} />}
      {commentary === null ? null : <p className={SENTENCE_CLASS}>{commentary}</p>}
    </div>
  );
}
export default ContinueReferralAction;
