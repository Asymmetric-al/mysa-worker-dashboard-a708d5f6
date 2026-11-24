"use client";
import { useId, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { GrantLifecycleState, ModuleKey } from "@/modules/coaching/grant";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { COACHING_COPY, GRANT_STATE_COPY, STOP_EFFECTS, STOP_EFFECT_COPY, type StopEffect } from "../copy";
import { useEndCoaching, useLeaveCoaching, useRevokeGrant, useSetModule, useStopTaskShare, useWithdrawCheckIn } from "../hooks/use-coaching";
import { stopActionFor } from "../schemas";
export type StopRole = "worker" | "coach";
export type StopTarget = { readonly grantId: string; readonly moduleKey?: ModuleKey; readonly checkInId?: string; readonly checkInRevisionId?: string; readonly taskShareId?: string; readonly episodeState: GrantLifecycleState };
/** The facts one submitted attempt presented: the revision it read and the target it named. */
export type StopActionsProps = { readonly available: ReadonlyArray<StopEffect>; readonly target: StopTarget; readonly scope: Scope; readonly expectedRevision: string; readonly role: StopRole; readonly onCheckResult?: () => void; readonly headingLevel?: ReviewHeadingLevel; readonly className?: string };
const TERMINAL_EPISODE_STATES: ReadonlySet<GrantLifecycleState> = new Set<GrantLifecycleState>(["revoked", "expired", "ended", "left", "superseded"]);
const HEADING_TAG: Readonly<Record<ReviewHeadingLevel, "h2" | "h3" | "h4">> = { 2: "h2", 3: "h3", 4: "h4" };
const NESTED_LEVEL: Readonly<Record<ReviewHeadingLevel, ReviewHeadingLevel>> = { 2: 3, 3: 4, 4: 4 };
/** The one type scale's heading utility per level, so the stop surface and the statements it makes state each heading at the level it sits at with the same measure as every other heading there. */
const HEADING_SCALE: Readonly<Record<ReviewHeadingLevel, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const ROOT_CLASS = "flex min-w-0 flex-col gap-4",
  SENTENCE_CLASS = "type-supporting text-pretty";
const REVIEW_BODY_CLASS = "flex min-w-0 flex-col gap-2";
const STATEMENTS_CLASS = "flex min-w-0 flex-col gap-3";
const SOURCE_WORK_KEPT = "The source work is not deleted: the task, the check-in draft, the target history and your private preparation all stay yours, and they keep working exactly as they do now.";
const NOTHING_RECALLED = "Nothing a coach has already read can be recalled, and no message is taken back: this stops what can be read from now on, and it cannot undo what has already been seen.";
const OTHER_ROLE_NOTE: Readonly<Record<StopRole, string>> = { worker: "Leaving belongs to the coach, so no control for it is offered here.", coach: "Only the worker can take this step, so no control for it is offered here." };
function assertUnreachable(effect: never): never {
  throw new Error(`Unhandled stop effect: ${String(effect)}`);
}
export const effectsForRole = (role: StopRole): readonly StopEffect[] => STOP_EFFECTS.filter((effect) => (role === "coach" ? effect === "coach-leave" : effect !== "coach-leave"));
export const isTerminalEpisode = (state: GrantLifecycleState): boolean => TERMINAL_EPISODE_STATES.has(state);
export const stopReviewSentences = (effect: StopEffect): readonly string[] => [STOP_EFFECT_COPY[effect].consequence, STOP_EFFECT_COPY[effect].assurance, SOURCE_WORK_KEPT, NOTHING_RECALLED];
function holdsReceipt(outcome: MutationOutcome | null): boolean {
  if (outcome === null) return false;
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
    case "unchanged":
    case "unknown":
      return true;
    case "conflict":
    case "denied":
    case "invalid":
    case "unavailable":
      return false;
    default:
      return assertUnreachable(outcome);
  }
}
function identityOf(effect: StopEffect, target: StopTarget): string | null {
  switch (effect) {
    case "stop-module":
      return target.moduleKey ?? null;
    case "withdraw-check-in":
      return target.checkInRevisionId ?? target.checkInId ?? null;
    case "remove-task-share":
      return target.taskShareId ?? null;
    case "end-relationship":
    case "coach-leave":
    case "revoke":
      return target.grantId.trim() === "" ? null : target.grantId;
    default:
      return assertUnreachable(effect);
  }
}
function refusalMessages(effect: StopEffect, payload: unknown): readonly string[] {
  const parsed = stopActionFor(effect).schema.safeParse(payload);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}
const ReviewSentences = ({ effect }: { readonly effect: StopEffect }): ReactElement => (
  <div className={REVIEW_BODY_CLASS}>
    {stopReviewSentences(effect).map((sentence) => (
      <p key={sentence} className={SENTENCE_CLASS}>
        {sentence}
      </p>
    ))}
  </div>
);
type EffectReviewProps<P> = {
  readonly effect: StopEffect;
  readonly targetIdentity: string;
  readonly input: Omit<MutationInput<P>, "operationId">;
  readonly submit: MutationSubmit<P>;
  readonly headingLevel: ReviewHeadingLevel;
  readonly onCheckResult?: () => void;
  readonly onCancel: () => void;
  readonly onSettled: (outcome: MutationOutcome) => void;
};
function EffectReview<P>({ effect, targetIdentity, input, submit, headingLevel, onCheckResult, onCancel, onSettled }: EffectReviewProps<P>): ReactElement {
  const copy = STOP_EFFECT_COPY[effect];
  return (
    <ActionReview<P>
      title={copy.title}
      headingLevel={headingLevel}
      consequential
      description={
        <div className={REVIEW_BODY_CLASS}>
          <p>{copy.question}</p>
          <p>
            <bdi className="mono-identifier min-w-0 wrap-anywhere">{targetIdentity}</bdi>
          </p>
          <ReviewSentences effect={effect} />
        </div>
      }
      consequence={<ReviewSentences effect={effect} />}
      confirmLabel={copy.title}
      onCancel={onCancel}
      input={input}
      submit={submit}
      checkResult={onCheckResult}
      onSettled={onSettled}
    />
  );
}
const EffectRefused = ({ effect, messages }: { readonly effect: StopEffect; readonly messages: readonly string[] }): ReactElement => (
  <Alert variant="destructive" data-slot="stop-effect-refused" data-outcome="invalid" data-effect={effect}>
    <AlertTitle>{STOP_EFFECT_COPY[effect].title} cannot be sent</AlertTitle>
    <AlertDescription className="flex min-w-0 flex-col gap-2">
      <p>{"This effect names an identity the surface was not given, so nothing is sent. Reopen the relationship from its own page, choose the module, check-in or task summary there, and act on that record instead of this one."}</p>
      {messages.length === 0 ? null : (
        <ul className="flex min-w-0 flex-col gap-1">
          {messages.map((message) => (
            <li key={message} className="min-w-0 wrap-anywhere">
              {message}
            </li>
          ))}
        </ul>
      )}
    </AlertDescription>
  </Alert>
);
/** What a closed episode states about its stop-type effects: the state it stands in, then the six effects once each — their own name, their own assurance, and the note that an effect belongs to the other role. The sentence that a closed episode has nothing left to stop is stated once for the list rather than beside every effect, because it is one fact about the episode and not six. */
function EndedStatements({ state, role }: { readonly state: GrantLifecycleState; readonly role: StopRole }): ReactElement {
  const standing = GRANT_STATE_COPY[state];
  const held = effectsForRole(role);
  return (
    <div data-slot="stop-episode-ended" className={STATEMENTS_CLASS}>
      <Alert>
        <AlertTitle>{standing.label}</AlertTitle>
        <AlertDescription>
          <p>{standing.description}</p>
          <p>{"Beginning again takes a new invitation from the worker, naming the modules and the duration; no later action here can reopen the episode."}</p>
        </AlertDescription>
      </Alert>
      <p className={cn(SENTENCE_CLASS, "text-foreground")}>{"This effect can no longer be applied: the episode has ended, so there is nothing left here to stop and no control is shown."}</p>
      <dl className={STATEMENTS_CLASS}>
        {STOP_EFFECTS.map((effect) => (
          <div key={effect} data-slot="stop-effect-statement" data-effect={effect} className="flex min-w-0 flex-col gap-1">
            <dt className="text-sm font-medium">{STOP_EFFECT_COPY[effect].title}</dt>
            <dd className={cn(SENTENCE_CLASS, "flex min-w-0 flex-col gap-1")}>
              <p>{STOP_EFFECT_COPY[effect].assurance}</p>
              {held.includes(effect) ? null : <p>{OTHER_ROLE_NOTE[role]}</p>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
/** The effects that end access outright rather than narrow one share: each is the destructive variant and each carries a visible destructive boundary drawn from the same token, so a control that closes the whole relationship never reads at a glance like the quieter outline controls that narrow a share beside it. */
const DESTRUCTIVE_EFFECTS: ReadonlySet<StopEffect> = new Set<StopEffect>(["end-relationship", "coach-leave", "revoke"]);
export function StopActions({ available, target, scope, expectedRevision, role, onCheckResult, headingLevel = 2, className }: StopActionsProps): ReactElement {
  const { mutateAsync: setModule } = useSetModule();
  const { mutateAsync: withdrawCheckIn } = useWithdrawCheckIn();
  const { mutateAsync: stopTaskShare } = useStopTaskShare();
  const { mutateAsync: endCoaching } = useEndCoaching();
  const { mutateAsync: leaveCoaching } = useLeaveCoaching();
  const { mutateAsync: revokeGrant } = useRevokeGrant();
  const [chosen, setChosen] = useState<StopEffect | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const [submitted, setSubmitted] = useState<{ readonly expectedRevision: string; readonly target: StopTarget } | null>(null);
  const headingId = useId();
  const terminal = isTerminalEpisode(target.episodeState);
  const kept = holdsReceipt(settled);
  // What the review presents: the facts the attempt itself submitted while its receipt is on screen, and the live ones otherwise. The route re-read after an applied change advances the revision — and, when the grant it named is the one it stopped, hands this surface the relationship that survives — so the receipt keeps describing the change that was made rather than collapsing into a fresh review of another record.
  const reviewAttempt = kept ? submitted : null;
  const reviewTarget = reviewAttempt?.target ?? target;
  // Whether an attempt for the chosen effect is in hand: submitted, settling, or settled with its receipt. The refreshed envelope can reach this surface before the outcome does, so an episode the re-read reports as ended must not displace the review mid-attempt.
  const ended = terminal && !(chosen !== null && (submitted !== null || kept));
  const offered = effectsForRole(role).filter((effect) => available.includes(effect));
  const surface = COACHING_COPY[role === "coach" ? "coachSubject" : "sharing"];
  const standing = GRANT_STATE_COPY[target.episodeState];
  const Heading = HEADING_TAG[headingLevel];
  // The review step mints the attempt's identity and reuses it for a replay of the same work, so this surface records the facts an attempt presented and never mints an identity of its own.
  const holdAttempt = (submittedRevision: string): void => {
    setSubmitted({ expectedRevision: submittedRevision, target });
  };
  const settle = (outcome: MutationOutcome): void => {
    setSettled(outcome);
  };
  const choose = (effect: StopEffect): void => {
    setChosen(effect);
    setSettled(null);
    setSubmitted(null);
  };
  const keep = (): void => {
    setChosen(null);
  };
  /** Every stop effect records the facts its attempt presented before the mutation runs, so the receipt keeps describing the change that was made; the six submissions differ only in which mutation they call. */
  const held =
    <P,>(mutate: (attempt: MutationInput<P>) => Promise<MutationOutcome>): MutationSubmit<P> =>
    (attempt) => {
      holdAttempt(attempt.expectedRevision);
      return mutate(attempt);
    };
  const reviewFor = (effect: StopEffect): ReactElement => {
    // The frame every review shares: one relationship identity, one set of callbacks and one heading level, whatever the effect being reviewed.
    const shared = { effect, targetIdentity: identityOf(effect, reviewTarget) ?? "this relationship", headingLevel: NESTED_LEVEL[headingLevel], onCheckResult, onCancel: keep, onSettled: settle };
    const review = <P,>(payload: P, submit: MutationSubmit<P>): ReactElement => <EffectReview {...shared} input={{ scope, expectedRevision: reviewAttempt?.expectedRevision ?? expectedRevision, payload }} submit={submit} />;
    switch (effect) {
      case "stop-module": {
        const payload = reviewTarget.moduleKey === undefined ? null : { grantId: reviewTarget.grantId, moduleKey: reviewTarget.moduleKey, enabled: false };
        const messages = payload === null ? [] : refusalMessages(effect, payload);
        return payload === null || messages.length > 0 ? <EffectRefused effect={effect} messages={messages} /> : review(payload, held(setModule));
      }
      case "withdraw-check-in": {
        const { checkInId, checkInRevisionId } = reviewTarget;
        const payload = checkInId === undefined || checkInRevisionId === undefined ? null : { checkInId, sharedRevisionId: checkInRevisionId };
        const messages = payload === null ? [] : refusalMessages(effect, payload);
        return payload === null || messages.length > 0 ? <EffectRefused effect={effect} messages={messages} /> : review(payload, held(withdrawCheckIn));
      }
      case "remove-task-share": {
        const payload = reviewTarget.taskShareId === undefined ? null : { taskShareId: reviewTarget.taskShareId };
        const messages = payload === null ? [] : refusalMessages(effect, payload);
        return payload === null || messages.length > 0 ? <EffectRefused effect={effect} messages={messages} /> : review(payload, held(stopTaskShare));
      }
      case "end-relationship":
      case "coach-leave":
      case "revoke": {
        const payload = { grantId: reviewTarget.grantId };
        const messages = refusalMessages(effect, payload);
        const submit = effect === "end-relationship" ? held(endCoaching) : effect === "coach-leave" ? held(leaveCoaching) : held(revokeGrant);
        return messages.length > 0 ? <EffectRefused effect={effect} messages={messages} /> : review(payload, submit);
      }
      default:
        return assertUnreachable(effect);
    }
  };
  return (
    <section aria-labelledby={headingId} data-slot="stop-actions" data-role={role} data-episode-state={target.episodeState} className={cn(ROOT_CLASS, className)}>
      <header className="flex min-w-0 flex-col gap-2">
        <Heading {...{ id: headingId, className: HEADING_SCALE[headingLevel] }}>{surface.heading}</Heading>
        <p className={SENTENCE_CLASS}>{surface.purpose}</p>
        <p className="flex min-w-0 flex-wrap items-center gap-2 type-supporting">
          <Badge variant="outline">{standing.label}</Badge>
          <span className="min-w-0 text-pretty text-muted-foreground">{standing.description}</span>
        </p>
      </header>
      <Separator />
      {ended ? (
        <EndedStatements state={target.episodeState} role={role} />
      ) : (
        <>
          {!terminal && (chosen === null || kept) ? (
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
              {offered.length === 0 ? (
                <p className={SENTENCE_CLASS}>{"No stop-type effect applies to this relationship right now. What is shared stays readable exactly as the invitation named it."}</p>
              ) : (
                <ul className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  {offered.map((effect) => (
                    <li key={effect} className="min-w-0">
                      <Button type="button" variant={DESTRUCTIVE_EFFECTS.has(effect) ? "destructive" : "outline"} className={cn(BUTTON_WRAP_CLASS, "text-start", DESTRUCTIVE_EFFECTS.has(effect) ? "border-destructive/40" : null)} data-effect={effect} onClick={() => choose(effect)}>
                        {STOP_EFFECT_COPY[effect].title}
                        <span className="sr-only">
                          {" for "}
                          <bdi>{identityOf(effect, target) ?? "this relationship"}</bdi>
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          {chosen === null ? null : reviewFor(chosen)}
        </>
      )}
    </section>
  );
}
export default StopActions;
