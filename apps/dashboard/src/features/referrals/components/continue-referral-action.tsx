"use client";
import Link from "next/link";
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { MutationInput, MutationOutcome, ReadAction, Scope, reads } from "@/modules/data-service";
import { CONTINUE_COPY, CONTINUATION_WINDOW_COPY, EXPIRED_HISTORY_COPY, LIST_COPY, OUTCOME_COPY, STATUS_COPY, type ContinueUnavailableReason } from "../copy";
import { useContinueReferral } from "../hooks/use-referral-mutations";
import type { ContinueReferralPayload } from "../schemas";
const CONTINUE_ACTION = "continueReferral";
/** The one word the referral surfaces use for a cycle's index, taken from the permitted-history labels so the two cannot drift apart. */
const CYCLE_TERM = EXPIRED_HISTORY_COPY.fieldLabels.cycleIndex;
const DEFAULT_HEADING_LEVEL: ReviewHeadingLevel = 2;
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
const ROOT_CLASS = "flex min-w-0 flex-col gap-4";
const PANEL_CLASS = "flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3";
const SENTENCE_CLASS = "text-sm text-pretty text-muted-foreground";
const FACTS_CLASS = "flex min-w-0 flex-col gap-1.5 text-sm";
const FACT_ROW_CLASS = "flex min-w-0 flex-wrap items-baseline gap-x-2";
const FACT_TERM_CLASS = "text-muted-foreground";
const IDENTIFIER_CLASS = "mono-identifier min-w-0 wrap-anywhere";
const SUCCESSOR_LINK_CLASS = "inline-flex min-h-target max-w-full items-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:underline";
/** The referral detail route a successor link opens, taken from the family's own `/partners/referrals` address so the link stays inside the application's route tree. */
const REFERRAL_DETAIL_ROUTE = "/partners/referrals";
//
// The service index re-exports `ReferralCycleRecord` but not the detail row the referral read answers
// with, and a second restatement of that shape here would be a second owner of it. Taking it from the
// read's own return type means a member that moves reaches this file as a compile error.
type ReferralDetailReadResult = Awaited<ReturnType<typeof reads.referrals.readReferral>>;
type ReferralDetailEnvelope = Extract<ReferralDetailReadResult, { readonly kind: "envelope" }>["envelope"];
type ReferralDetailView = Extract<ReferralDetailEnvelope["data"], { readonly view: "detail" }>;
/** The cycle this action acts on: its identity and index, where its window stands, and what the read resolved about the one continuation it can carry. */
export type ContinueReferralCycle = Pick<ReferralDetailView["referral"], "referralId" | "cycleIndex" | "datePrecision" | "windowKind" | "status" | "continuation" | "revision">;
/** The worker-continuation setting the read ran under, with the sentence it gives when it withholds the action. */
export type ContinuePolicyFacts = ReferralDetailView["continuationPolicy"];
/** The continuation values the read resolved, shown exactly as resolved. */
export type ResolvedContinuation = {
  /** The span the read resolved for this continuation, in elapsed seconds. */
  readonly elapsedSeconds: number | null;
  /** The instant the read resolved that span ends at. */
  readonly endsAt: string | null;
};
export type ContinueReferralActionProps = {
  /** The context the command is submitted in. The service re-resolves it and re-checks the resulting record, so this is a claim the caller makes and not an authority it grants. */
  readonly scope: Scope;
  /** The cycle the action acts on. Its `revision` is the revision the caller read, and the command presents it so a cycle that moved settles as a conflict rather than as an overwrite. */
  readonly referral: ContinueReferralCycle;
  /** What the read resolved about the worker-continuation setting, including the sentence it gives when it withholds the action. */
  readonly continuationPolicy: ContinuePolicyFacts;
  /** The `actions` the read's envelope published. Continue is offered only where one of them admits it. */
  readonly actions: readonly ReadAction[];
  /** The values the read resolved for a continuation, where it resolved any. Displayed, never recomputed. */
  readonly resolvedContinuation?: ResolvedContinuation | null;
  /** Reads the result of an operation whose acknowledgement was lost. Recovery is by operation identity, so this re-reads rather than re-sending. */
  readonly onCheckResult?: () => void;
  /** The heading level of this surface, so it nests under whatever heading the page around it reaches. */
  readonly headingLevel?: ReviewHeadingLevel;
  /** The reading direction of the page, set on this block only. The review step inherits it, including its portalled dialog. */
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
};
type ContinueInput = Omit<MutationInput<ContinueReferralPayload>, "operationId">;
/** What a settled continuation reported: the successor it created, and the end the service resolved for that successor. */
type ReportedContinuation = { readonly successorId: string | null; readonly endsAt: string | null; readonly elapsedSeconds: number | null };
function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}
function stringMember(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
function numberMember(record: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function reportedContinuationOf(outcome: MutationOutcome | null): ReportedContinuation | null {
  if (outcome === null || (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted")) {
    return null;
  }
  const created = outcome.created?.find((id) => id.trim() !== "") ?? null;
  const stored = outcome.outcome === "alreadyAccepted" ? asRecord(outcome.result) : null;
  const successorId = stored === null ? null : stringMember(stored, "successorId");
  const endsAt = stored === null ? null : stringMember(stored, "windowEnd");
  const elapsedSeconds = stored === null ? null : numberMember(stored, "elapsedSeconds");
  const identified = successorId ?? created;
  return identified === null ? null : { successorId: identified, endsAt, elapsedSeconds };
}
function classifiedReason(referral: ContinueReferralCycle, policy: ContinuePolicyFacts): ContinueUnavailableReason | null {
  switch (referral.status.status) {
    case "active":
      return "not-ordinarily-expired";
    case "no-deadline":
      return "precision-does-not-admit-a-deadline";
    case "refused":
      return null;
    case "expired":
      break;
  }
  if (referral.windowKind !== "new" || referral.continuation.cycle.consumed || referral.continuation.cycle.successorId !== null) {
    return "already-consumed";
  }
  if (referral.datePrecision !== "date") {
    return "precision-does-not-admit-a-deadline";
  }
  return policy.setting === "off" ? "worker-setting-off" : null;
}
function outcomeCommentary(outcome: MutationOutcome | null): string | null {
  if (outcome === null) {
    return null;
  }
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
      // The continued-window panel states what the attempt produced, and the receipt states the facts.
      return null;
    case "conflict":
      return OUTCOME_COPY.conflict.detail;
    case "unchanged":
      return OUTCOME_COPY.unchanged.detail;
    case "unknown":
      return OUTCOME_COPY.unknown.detail;
    case "denied":
    case "invalid":
    case "unavailable":
      // Each of these is stated in full by the receipt, and a second sentence would suggest a
      // second condition.
      return null;
    default:
      return assertNever(outcome, "Unhandled Continue outcome");
  }
}
/** The specific reason Continue is not offered, worded by the family's own closed record, so a reason added later fails to compile until it is worded there. */
function UnavailableReason({ reason }: { readonly reason: ContinueUnavailableReason }): ReactElement {
  return <p className={SENTENCE_CLASS}>{CONTINUE_COPY.unavailableReasons[reason]}</p>;
}
function CycleFacts({ referral }: { readonly referral: ContinueReferralCycle }): ReactElement {
  const standing = STATUS_COPY[referral.status.status];
  return (
    <dl className={FACTS_CLASS}>
      <div className={FACT_ROW_CLASS}>
        <dt className={FACT_TERM_CLASS}>{CYCLE_TERM}</dt>
        <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="tabular-figures font-medium">
            <bdi>{String(referral.cycleIndex)}</bdi>
          </span>
          <bdi className={IDENTIFIER_CLASS}>{referral.referralId}</bdi>
        </dd>
      </div>
      <div className={FACT_ROW_CLASS}>
        <dt className={FACT_TERM_CLASS}>{LIST_COPY.columns.status}</dt>
        <dd className="flex min-w-0 flex-col gap-1">
          <span>
            <Badge variant="outline">{standing.label}</Badge>
          </span>
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
      <Heading id={headingId} className="text-sm font-medium">
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
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
        <span className={FACT_TERM_CLASS}>{EXPIRED_HISTORY_COPY.consumedLabels.continued}</span>
        <Link href={`${REFERRAL_DETAIL_ROUTE}/${encodeURIComponent(successorId)}`} className={SUCCESSOR_LINK_CLASS}>
          <bdi className={IDENTIFIER_CLASS}>{successorId}</bdi>
        </Link>
      </p>
      {statedEnd === null ? null : <p className="text-sm text-pretty">{statedEnd}</p>}
      {statedEnd === null ? null : <p className={SENTENCE_CLASS}>{CONTINUATION_WINDOW_COPY.elapsedNotCalendar}</p>}
      <p className={SENTENCE_CLASS}>{CONTINUATION_WINDOW_COPY.oneSuccessor}</p>
    </section>
  );
}
export function ContinueReferralAction({ scope, referral, continuationPolicy, actions, resolvedContinuation = null, onCheckResult, headingLevel = DEFAULT_HEADING_LEVEL, dir, className }: ContinueReferralActionProps): ReactElement {
  const { mutateAsync } = useContinueReferral();
  const headingId = useId();
  const successorLabelId = useId();
  const [submitted, setSubmitted] = useState<ContinueInput | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const offered = actions.some((action) => action.name === CONTINUE_ACTION && action.available);
  const liveInput = useMemo<ContinueInput>(() => ({ scope, expectedRevision: referral.revision, payload: { referralId: referral.referralId } }), [scope, referral.revision, referral.referralId]);
  // A successful Continue advances this cycle's revision and the page beside it re-reads. Holding the
  // intent that was submitted, rather than the live one, is what keeps the receipt in place across
  // that re-read: the review step shows a result only while the input it is handed matches the intent
  // it reviewed, and the advanced revision would otherwise read as a different intention.
  const holdsReceipt = settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged");
  const input = holdsReceipt && submitted !== null ? submitted : liveInput;
  // The identity of the attempt is the review step's to mint: it mints one per intent and reuses it
  // for a retry of the same work, which is what lets a replay answer `alreadyAccepted` instead of
  // opening a second window.
  const submit = useCallback<MutationSubmit<ContinueReferralPayload>>(
    async (attempt: MutationInput<ContinueReferralPayload>): Promise<MutationOutcome> => {
      setSubmitted({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      return mutateAsync(attempt);
    },
    [mutateAsync],
  );
  const withheldReason = referral.continuation.reason ?? continuationPolicy.reason;
  const classified = classifiedReason(referral, continuationPolicy);
  const reported = reportedContinuationOf(settled);
  const successorId = reported?.successorId ?? referral.continuation.cycle.successorId ?? null;
  const endsAt = reported?.endsAt ?? resolvedContinuation?.endsAt ?? null;
  const elapsedSeconds = reported?.elapsedSeconds ?? resolvedContinuation?.elapsedSeconds ?? null;
  const commentary = outcomeCommentary(settled);
  const showReview = offered || settled !== null;
  return (
    <div dir={dir} className={cn(ROOT_CLASS, className)}>
      {showReview ? (
        <ActionReview<ContinueReferralPayload>
          title={CONTINUE_COPY.confirm.title}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p>{CONTINUE_COPY.available}</p>
              <p>{CONTINUATION_WINDOW_COPY.explanation}</p>
              <p>{CONTINUATION_WINDOW_COPY.elapsedNotCalendar}</p>
              <p>{CONTINUATION_WINDOW_COPY.oneSuccessor}</p>
              <CycleFacts referral={referral} />
              {endsAt === null || elapsedSeconds === null ? null : <p>{CONTINUATION_WINDOW_COPY.elapsedSeconds(elapsedSeconds, endsAt)}</p>}
            </div>
          }
          consequence={
            <div className="flex min-w-0 flex-col gap-2">
              <p>{CONTINUE_COPY.confirm.body(`${CYCLE_TERM} ${String(referral.cycleIndex)}`)}</p>
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className={FACT_TERM_CLASS}>{CYCLE_TERM}</span>
                <span className="tabular-figures font-medium">
                  <bdi>{String(referral.cycleIndex)}</bdi>
                </span>
                <bdi className={IDENTIFIER_CLASS}>{referral.referralId}</bdi>
              </p>
            </div>
          }
          confirmLabel={CONTINUE_COPY.label}
          cancelLabel={CONTINUE_COPY.confirm.cancelLabel}
          consequential
          input={input}
          submit={submit}
          onSettled={setSettled}
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
