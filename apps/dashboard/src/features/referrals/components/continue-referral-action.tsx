"use client";
/**
 * The authorised Continue action for one ordinarily expired referral cycle, and the reason it is not
 * offered when it is not.
 *
 * Continue is the one further window a cycle can carry, so this surface has exactly two states and no
 * third: the read's `actions` admit the command and the shared review step offers it, or they do not
 * and the specific condition is stated in the button's place. A disabled control would say less than
 * the sentence that replaces it, so none is rendered.
 *
 * Everything the rule turns on arrives already resolved. The read decided whether this cycle is
 * ordinarily expired, what the worker-continuation setting allows and which of the closed reasons
 * withholds the action; the command answers with the successor it created and the instant that
 * successor ends. This module therefore holds no window, deadline or succession arithmetic: the
 * continuation's end is never computed here as an acceptance instant plus N x 86,400 seconds, only
 * shown as the service resolved it (AAP 0.8.3).
 *
 * The identity of an attempt is not this module's either. The shared review step mints one
 * `operationId` per intent and reuses it for a retry of the same work, which is what makes a replayed
 * acknowledgement answer `alreadyAccepted` instead of opening a second window.
 */
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
/** The command's name in the read's own `actions` list, exactly as `readReferral` publishes it. */
const CONTINUE_ACTION = "continueReferral";

/** The one word the referral surfaces use for a cycle's index, taken from the permitted-history labels so the two cannot drift apart. */
const CYCLE_TERM = EXPIRED_HISTORY_COPY.fieldLabels.cycleIndex;

/** The heading a section renders at when a caller states none: the level the shared review step defaults to. */
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
// The referral facts this action reads, derived from the read's own signature
//
// The service index re-exports `ReferralCycleRecord` but not the detail row the referral read answers
// with, and a second restatement of that shape here would be a second owner of it. Taking it from the
// read's own return type means a member that moves reaches this file as a compile error.
type ReferralDetailReadResult = Awaited<ReturnType<typeof reads.referrals.readReferral>>;

type ReferralDetailEnvelope = Extract<ReferralDetailReadResult, { readonly kind: "envelope" }>["envelope"];

type ReferralDetailView = Extract<ReferralDetailEnvelope["data"], { readonly view: "detail" }>;
/**
 * The cycle this action acts on: its identity and index, where its window stands, and what the read
 * resolved about the one continuation it can carry.
 *
 * Only the facts the action has a use for are named, so a caller may hand the whole detail row it
 * already holds and nothing outside these members can influence the action.
 */
export type ContinueReferralCycle = Pick<ReferralDetailView["referral"], "referralId" | "cycleIndex" | "datePrecision" | "windowKind" | "status" | "continuation" | "revision">;
/** The worker-continuation setting the read ran under, with the sentence it gives when it withholds the action. */
export type ContinuePolicyFacts = ReferralDetailView["continuationPolicy"];
/**
 * The continuation values the read resolved, shown exactly as resolved.
 *
 * The read states the span in elapsed seconds and the instant it ends at; this component neither
 * derives one from the other nor recomputes either from an acceptance instant and a day count, so a
 * change of clocks cannot make the stated end disagree with the window the service opened.
 */
export interface ResolvedContinuation {
  /** The span the read resolved for this continuation, in elapsed seconds. */
  readonly elapsedSeconds: number | null;
  /** The instant the read resolved that span ends at. */
  readonly endsAt: string | null;
}
/** Props of {@link ContinueReferralAction}. */
export interface ContinueReferralActionProps {
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
}
/** The input one Continue attempt carries, without the identity the review step mints for it. */
type ContinueInput = Omit<MutationInput<ContinueReferralPayload>, "operationId">;
/** What a settled continuation reported: the successor it created, and the end the service resolved for that successor. */
interface ReportedContinuation {
  readonly successorId: string | null;
  readonly endsAt: string | null;
  readonly elapsedSeconds: number | null;
}
/** Narrows an opaque JSON result to the object shape a receipt may hold, so each member is read by name rather than trusted by position. */
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
/**
 * Reads the continuation a settled outcome reported.
 *
 * A fresh acceptance names the successor it created; a replay also returns the result stored for the
 * original attempt, which carries the end the service resolved. Both are the service's answers, so
 * neither is derived here, and a result of another shape contributes no successor line at all rather
 * than a guess beside the receipt.
 */
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
/**
 * The one reason this component can name for a withheld action, or `null` where the facts it holds do
 * not name one of the closed reasons.
 *
 * The order follows the service's own judgement — where the window stands, then the cycle's single
 * continuation, then the setting — so a classified code can never contradict the answer the read
 * already gave. `null` is a real answer: an unreadable window and a setting that could not be read
 * have no code in the closed set, and the read's own sentence is shown instead so a service reason is
 * never overwritten by a guess made here.
 */
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
/**
 * What a referral surface adds to the shared receipt for one outcome, or `null` where the receipt
 * already says it in full.
 *
 * The receipt owns the headings and the general reading of all eight outcomes, so each sentence here
 * adds only what a referral changes about the meaning of one. `conflict`, `unchanged` and `unknown`
 * are stated as themselves and never as success or failure.
 */
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
/** The label the family gives one cycle: its index under the one word the referral surfaces use for it. */
function cycleLabelOf(cycleIndex: number): string {
  return `${CYCLE_TERM} ${String(cycleIndex)}`;
}
/** The specific reason Continue is not offered: one arm per reason the family's wording declares, so a reason added later fails to compile until it is stated here. */
function UnavailableReason({ reason }: { readonly reason: ContinueUnavailableReason }): ReactElement {
  switch (reason) {
    case "worker-setting-off":
      return <p className={SENTENCE_CLASS}>{CONTINUE_COPY.unavailableReasons["worker-setting-off"]}</p>;
    case "not-ordinarily-expired":
      return <p className={SENTENCE_CLASS}>{CONTINUE_COPY.unavailableReasons["not-ordinarily-expired"]}</p>;
    case "no-current-responsibility":
      return <p className={SENTENCE_CLASS}>{CONTINUE_COPY.unavailableReasons["no-current-responsibility"]}</p>;
    case "no-current-permission":
      return <p className={SENTENCE_CLASS}>{CONTINUE_COPY.unavailableReasons["no-current-permission"]}</p>;
    case "no-continued-policy":
      return <p className={SENTENCE_CLASS}>{CONTINUE_COPY.unavailableReasons["no-continued-policy"]}</p>;
    case "already-consumed":
      return <p className={SENTENCE_CLASS}>{CONTINUE_COPY.unavailableReasons["already-consumed"]}</p>;
    case "precision-does-not-admit-a-deadline":
      return <p className={SENTENCE_CLASS}>{CONTINUE_COPY.unavailableReasons["precision-does-not-admit-a-deadline"]}</p>;
    default:
      return assertNever(reason, "Unhandled reason for withholding the Continue action");
  }
}
/**
 * The cycle a decision is about: its index and identity, where its window stands, and whether it
 * already carries the one continuation it can.
 *
 * It is rendered beside the reason and inside the review, so the person confirming sees the same two
 * facts the answer was given for. The status word carries its own sentence as text, so a reader who
 * cannot see the badge's tone still learns what the word means.
 */
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
/**
 * The action region when the read does not admit the command.
 *
 * The heading names the region and the reason text is tied to it, so the sentence a person hears is
 * the one that explains this region rather than an unattributed paragraph. No control is rendered:
 * there is nothing here that could act, and a disabled one would leave the reason unstated.
 */
function NotOffered({
  headingId,
  headingLevel,
  sentence,
  reason,
  referral,
}: {
  readonly headingId: string;
  readonly headingLevel: ReviewHeadingLevel;
  readonly sentence: string | null;
  readonly reason: ContinueUnavailableReason | null;
  readonly referral: ContinueReferralCycle;
}): ReactElement {
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
/**
 * The window this continuation opened: the successor it created, linked by identity, and the end the
 * service resolved for that successor.
 *
 * A fresh acceptance names the successor without its end, because the acceptance answer states only
 * what it created; the end appears once the service has resolved it and a read or a replay supplies
 * it. Neither is inferred, and the panel states that the cycle carries one continuation so a second
 * attempt is never read as a second window.
 */
function ContinuedWindow({
  labelId,
  successorId,
  endsAt,
  elapsedSeconds,
}: {
  readonly labelId: string;
  readonly successorId: string;
  readonly endsAt: string | null;
  readonly elapsedSeconds: number | null;
}): ReactElement {
  const statedEnd = endsAt === null || elapsedSeconds === null ? null : CONTINUATION_WINDOW_COPY.elapsedSeconds(elapsedSeconds, endsAt);
  return (
    <section aria-labelledby={labelId} data-slot="continue-referral-successor" className={PANEL_CLASS}>
      <p id={labelId} className="text-sm font-medium">
        {CONTINUATION_WINDOW_COPY.heading}
      </p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
        <span className={FACT_TERM_CLASS}>{EXPIRED_HISTORY_COPY.consumedLabels.continued}</span>
        <Link href={`/referrals/${encodeURIComponent(successorId)}`} className={SUCCESSOR_LINK_CLASS}>
          <bdi className={IDENTIFIER_CLASS}>{successorId}</bdi>
        </Link>
      </p>
      {statedEnd === null ? null : <p className="text-sm text-pretty">{statedEnd}</p>}
      {statedEnd === null ? null : <p className={SENTENCE_CLASS}>{CONTINUATION_WINDOW_COPY.elapsedNotCalendar}</p>}
      <p className={SENTENCE_CLASS}>{CONTINUATION_WINDOW_COPY.oneSuccessor}</p>
    </section>
  );
}
/**
 * The Continue action for one referral cycle.
 *
 * Where the read admits it, the shared review step states what the further window is and what it is
 * not, confirms through its own dialog, and keeps the result in place as the receipt for the attempt.
 * Where the read does not admit it, the reason stands in the action's place.
 */
export function ContinueReferralAction({
  scope,
  referral,
  continuationPolicy,
  actions,
  resolvedContinuation = null,
  onCheckResult,
  headingLevel = DEFAULT_HEADING_LEVEL,
  dir,
  className,
}: ContinueReferralActionProps): ReactElement {
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
              <p>{CONTINUE_COPY.confirm.body(cycleLabelOf(referral.cycleIndex))}</p>
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
