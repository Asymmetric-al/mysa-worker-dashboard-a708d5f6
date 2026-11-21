"use client";

/**
 * The Coaching family's one surface for the closed set of stop-type effects — stop sharing a module, withdraw a shared
 * check-in, stop sharing a task summary, end the relationship, the coach leaving, and revoking the grant — offering only
 * the effects the grant's own envelope admits, routing each one through a review and a confirmation to exactly one named
 * mutation, and stating on every effect that the source work is not deleted and that nothing a coach has already read
 * can be recalled; once the episode has ended, every effect is a statement with no control, so a stale save or a
 * re-enable cannot be submitted.
 */
import { useCallback, useId, useState, type ReactElement } from "react";

import ActionReview, { type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { GrantLifecycleState, ModuleKey } from "@/modules/coaching/grant";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";

import { COACHING_COPY, GRANT_STATE_COPY, STOP_EFFECTS, STOP_EFFECT_COPY, type StopEffect } from "../copy";
import { useEndCoaching, useLeaveCoaching, useRevokeGrant, useSetModule, useStopTaskShare, useWithdrawCheckIn } from "../hooks/use-coaching-mutations";
import { stopActionFor } from "../schemas/stop";

/** Which identity is acting: the worker whose work is shared, or the coach it was shared with. */
export type StopRole = "worker" | "coach";

/**
 * The identities one stop-type effect needs, handed in by the route from the envelope it read.
 *
 * `moduleKey`, `checkInId`, `checkInRevisionId` and `taskShareId` are present only for the effect that names them.
 * Withdrawing a check-in names two distinct identities — the check-in and the shared revision a coach can read — and
 * neither is derived from the other, so the route supplies both rather than this surface reading one out of the other.
 * `episodeState` is the lifecycle the read resolved, which decides whether any effect is offered at all.
 */
export type StopTarget = {
  readonly grantId: string;
  readonly moduleKey?: ModuleKey;
  readonly checkInId?: string;
  readonly checkInRevisionId?: string;
  readonly taskShareId?: string;
  readonly episodeState: GrantLifecycleState;
};

export interface StopActionsProps {
  /**
   * The effects the grant's own envelope published as available. This surface renders only these: an effect the
   * envelope withheld is never invented here, and the service re-checks every submission anyway.
   */
  readonly available: ReadonlyArray<StopEffect>;
  readonly target: StopTarget;
  /** The context the change is submitted in. It is a claim the caller makes; the service re-derives and re-authorises it. */
  readonly scope: Scope;
  /** The revision the caller read. Every effect presents it, so a stale attempt settles as a conflict, not an overwrite. */
  readonly expectedRevision: string;
  readonly role: StopRole;
  /** Reads the result of an operation whose acknowledgement was lost, by its operation identity. */
  readonly onCheckResult?: () => void;
  readonly headingLevel?: ReviewHeadingLevel;
  readonly className?: string;
}

/**
 * The episode states in which no stop-type effect can be applied. A coach who has left is as final as an episode the
 * worker ended, so `left` joins the four states the release names: a revoke or a module change after it would be a
 * stale action answered by a status that no longer means anything.
 */
const TERMINAL_EPISODE_STATES: ReadonlySet<GrantLifecycleState> = new Set<GrantLifecycleState>(["revoked", "expired", "ended", "left", "superseded"]);

const HEADING_TAG: Readonly<Record<ReviewHeadingLevel, "h2" | "h3" | "h4">> = { 2: "h2", 3: "h3", 4: "h4" };

/** A review nests one level under the heading it sits beneath; a level-4 surface keeps its reviews at level 4. */
const NESTED_LEVEL: Readonly<Record<ReviewHeadingLevel, ReviewHeadingLevel>> = { 2: 3, 3: 4, 4: 4 };

const ROOT_CLASS = "flex min-w-0 flex-col gap-4";
const HEADER_CLASS = "flex min-w-0 flex-col gap-2";
const SENTENCE_CLASS = "text-sm text-pretty text-muted-foreground";
const PANEL_CLASS = "flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3";
const ROW_CLASS = "flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center";
const TRIGGER_CLASS = "h-auto min-h-target max-w-full py-2 text-start whitespace-normal";
const REVIEW_BODY_CLASS = "flex min-w-0 flex-col gap-2";
const IDENTIFIER_CLASS = "mono-identifier min-w-0 wrap-anywhere";
const STATEMENTS_CLASS = "flex min-w-0 flex-col gap-3";
const STATEMENT_HEADING_CLASS = "text-sm font-medium";

const SOURCE_WORK_KEPT =
  "The source work is not deleted: the task, the check-in draft, the target history and your private preparation " +
  "all stay yours, and they keep working exactly as they do now.";
const NOTHING_RECALLED =
  "Nothing a coach has already read can be recalled, and no message is taken back: this stops what can be read " +
  "from now on, and it cannot undo what has already been seen.";
const MISSING_IDENTITY_SENTENCE =
  "This effect names an identity the surface was not given, so nothing is sent. Reopen the relationship from its " +
  "own page, choose the module, check-in or task summary there, and act on that record instead of this one.";
const ENDED_EFFECT_SENTENCE =
  "This effect can no longer be applied: the episode has ended, so there is nothing left here to stop and no " +
  "control is shown.";
const NEW_INVITATION_SENTENCE =
  "Beginning again takes a new invitation from the worker, naming the modules and the duration; no later action " +
  "here can reopen the episode.";
const NO_EFFECT_SENTENCE = "No stop-type effect applies to this relationship right now. What is shared stays readable exactly as the invitation named it.";
const OTHER_ROLE_NOTE: Readonly<Record<StopRole, string>> = {
  worker: "Leaving belongs to the coach, so no control for it is offered here.",
  coach: "Only the worker can take this step, so no control for it is offered here.",
};

/** Fails the build if a stop effect is added without a place on this surface. */
function assertUnreachable(effect: never): never {
  throw new Error(`Unhandled stop effect: ${String(effect)}`);
}

/** Every effect a role may ever hold, in the closed vocabulary's own order, taken from that vocabulary rather than restated. */
export function effectsForRole(role: StopRole): readonly StopEffect[] {
  return STOP_EFFECTS.filter((effect) => (role === "coach" ? effect === "coach-leave" : effect !== "coach-leave"));
}

/** Whether the episode has reached an end, after which every effect is a statement rather than a control. */
export function isTerminalEpisode(state: GrantLifecycleState): boolean {
  return TERMINAL_EPISODE_STATES.has(state);
}

/** The sentences one effect's review states: its own consequence, then the two assurances every stop-type review carries. */
export function stopReviewSentences(effect: StopEffect): readonly string[] {
  const copy = STOP_EFFECT_COPY[effect];
  return [copy.consequence, copy.assurance, SOURCE_WORK_KEPT, NOTHING_RECALLED];
}

/**
 * Whether a settled attempt keeps its receipt once the route re-reads the relationship.
 *
 * An accepted, replayed or uncertain attempt refreshes the reads, which advances the revision this surface is handed;
 * holding the revision that was submitted keeps the receipt readable instead of collapsing back to a fresh review. A
 * definite refusal changed nothing, so the live revision is the honest one there.
 */
function holdsReceipt(outcome: MutationOutcome | null): boolean {
  if (outcome === null) {
    return false;
  }
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

/** The identity an effect names, as the surface shows and announces it; `null` when the route supplied none. */
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

/** The messages of the one payload schema the mapping table holds for this effect: a refusal here means nothing is sent. */
function refusalMessages(effect: StopEffect, payload: unknown): readonly string[] {
  const parsed = stopActionFor(effect).schema.safeParse(payload);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

/** The two assurances and the effect's own consequence, rendered as the review's body. */
function ReviewSentences({ effect }: { readonly effect: StopEffect }): ReactElement {
  return (
    <div className={REVIEW_BODY_CLASS}>
      {stopReviewSentences(effect).map((sentence) => (
        <p key={sentence} className={SENTENCE_CLASS}>
          {sentence}
        </p>
      ))}
    </div>
  );
}

type EffectReviewProps<P> = {
  readonly effect: StopEffect;
  /** The identifier this effect acts on, shown in the review so the confirmed change names its own record. */
  readonly targetIdentity: string;
  readonly input: Omit<MutationInput<P>, "operationId">;
  readonly submit: MutationSubmit<P>;
  readonly headingLevel: ReviewHeadingLevel;
  readonly onCheckResult?: () => void;
  readonly onCancel: () => void;
  readonly onSettled: (outcome: MutationOutcome) => void;
};

/**
 * One effect's review, confirmation and receipt: the shared review step renders the effect's own consequence with both
 * assurances, holds the `alert-dialog` confirmation, and prints the one durable receipt for whatever the service answers.
 *
 * The review step also owns the attempt's identity, so the only retry it can offer re-submits that same operationId and
 * the ledger answers with the original result: recovery is by identity, never a fresh send under a new one.
 */
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
            <bdi className={IDENTIFIER_CLASS}>{targetIdentity}</bdi>
          </p>
          {/* The consequence is read before the confirm control is pressed, and stated again inside the dialog. */}
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

/** A refused effect: the schema's own messages, the way back, and no control that could send it. */
function EffectRefused({ effect, messages }: { readonly effect: StopEffect; readonly messages: readonly string[] }): ReactElement {
  return (
    <Alert variant="destructive" data-slot="stop-effect-refused" data-outcome="invalid" data-effect={effect}>
      <AlertTitle>{STOP_EFFECT_COPY[effect].title} cannot be sent</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-2">
        <p>{MISSING_IDENTITY_SENTENCE}</p>
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
}

type EndedStatementsProps = { readonly state: GrantLifecycleState; readonly role: StopRole; readonly level: ReviewHeadingLevel };

/**
 * The ended episode: one statement for each effect in the closed vocabulary, none of them a control, so a stale save or a
 * re-enable has nothing to submit. Each statement still carries its effect's own assurance about the source work.
 */
function EndedStatements({ state, role, level }: EndedStatementsProps): ReactElement {
  const standing = GRANT_STATE_COPY[state];
  const held = effectsForRole(role);
  const Heading = HEADING_TAG[level];
  return (
    <div data-slot="stop-episode-ended" className={STATEMENTS_CLASS}>
      <Alert>
        <AlertTitle>{standing.label}</AlertTitle>
        <AlertDescription>
          <p>{standing.description}</p>
          <p>{NEW_INVITATION_SENTENCE}</p>
        </AlertDescription>
      </Alert>
      <ul className={STATEMENTS_CLASS}>
        {STOP_EFFECTS.map((effect) => (
          <li key={effect} data-slot="stop-effect-statement" data-effect={effect}>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>
                  <Heading className={STATEMENT_HEADING_CLASS}>{STOP_EFFECT_COPY[effect].title}</Heading>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex min-w-0 flex-col gap-2">
                <p className={cn(SENTENCE_CLASS, "text-foreground")}>{ENDED_EFFECT_SENTENCE}</p>
                <p className={SENTENCE_CLASS}>{STOP_EFFECT_COPY[effect].assurance}</p>
                {held.includes(effect) ? null : <p className={SENTENCE_CLASS}>{OTHER_ROLE_NOTE[role]}</p>}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The three effects that end access outright, and so read as destructive at the point they are offered. */
const DESTRUCTIVE_EFFECTS: ReadonlySet<StopEffect> = new Set<StopEffect>(["end-relationship", "coach-leave", "revoke"]);

/** Every stop-type effect that applies to the current grant, each reviewed before exactly one named mutation is sent. */
export function StopActions({ available, target, scope, expectedRevision, role, onCheckResult, headingLevel = 2, className }: StopActionsProps): ReactElement {
  const { mutateAsync: setModule } = useSetModule();
  const { mutateAsync: withdrawCheckIn } = useWithdrawCheckIn();
  const { mutateAsync: stopTaskShare } = useStopTaskShare();
  const { mutateAsync: endCoaching } = useEndCoaching();
  const { mutateAsync: leaveCoaching } = useLeaveCoaching();
  const { mutateAsync: revokeGrant } = useRevokeGrant();

  const [chosen, setChosen] = useState<StopEffect | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const [submittedRevision, setSubmittedRevision] = useState<string | null>(null);
  const headingId = useId();

  const terminal = isTerminalEpisode(target.episodeState);
  const kept = holdsReceipt(settled);
  const reviewRevision = kept && submittedRevision !== null ? submittedRevision : expectedRevision;
  const offered = effectsForRole(role).filter((effect) => available.includes(effect));
  const surface = COACHING_COPY[role === "coach" ? "coachSubject" : "sharing"];
  const standing = GRANT_STATE_COPY[target.episodeState];
  const Heading = HEADING_TAG[headingLevel];
  const reviewLevel = NESTED_LEVEL[headingLevel];
  const showRow = chosen === null || kept;

  // The review step mints the attempt's identity and reuses it for a replay of the same work, so this surface records
  // the revision an attempt presented and never mints an identity of its own.
  const holdRevision = useCallback((revision: string): void => {
    setSubmittedRevision(revision);
  }, []);
  const settle = useCallback((outcome: MutationOutcome): void => {
    setSettled(outcome);
  }, []);
  const choose = useCallback((effect: StopEffect): void => {
    setChosen(effect);
    setSettled(null);
    setSubmittedRevision(null);
  }, []);
  const keep = useCallback((): void => {
    setChosen(null);
  }, []);

  const submitModule = useCallback(
    (attempt: Parameters<typeof setModule>[0]): Promise<MutationOutcome> => {
      holdRevision(attempt.expectedRevision);
      return setModule(attempt);
    },
    [holdRevision, setModule],
  );
  const submitWithdrawal = useCallback(
    (attempt: Parameters<typeof withdrawCheckIn>[0]): Promise<MutationOutcome> => {
      holdRevision(attempt.expectedRevision);
      return withdrawCheckIn(attempt);
    },
    [holdRevision, withdrawCheckIn],
  );
  const submitTaskShareStop = useCallback(
    (attempt: Parameters<typeof stopTaskShare>[0]): Promise<MutationOutcome> => {
      holdRevision(attempt.expectedRevision);
      return stopTaskShare(attempt);
    },
    [holdRevision, stopTaskShare],
  );
  const submitEnd = useCallback(
    (attempt: Parameters<typeof endCoaching>[0]): Promise<MutationOutcome> => {
      holdRevision(attempt.expectedRevision);
      return endCoaching(attempt);
    },
    [holdRevision, endCoaching],
  );
  const submitLeave = useCallback(
    (attempt: Parameters<typeof leaveCoaching>[0]): Promise<MutationOutcome> => {
      holdRevision(attempt.expectedRevision);
      return leaveCoaching(attempt);
    },
    [holdRevision, leaveCoaching],
  );
  const submitRevoke = useCallback(
    (attempt: Parameters<typeof revokeGrant>[0]): Promise<MutationOutcome> => {
      holdRevision(attempt.expectedRevision);
      return revokeGrant(attempt);
    },
    [holdRevision, revokeGrant],
  );

  /*
   * The one place an effect becomes a submission: this switch builds the payload the mapping table's own schema admits
   * and names the single hook that sends it, so no effect can reach two mutations and a seventh effect fails to compile.
   * A payload the schema refuses renders its messages and sends nothing.
   */
  const reviewFor = (effect: StopEffect): ReactElement => {
    switch (effect) {
      case "stop-module": {
        const payload = target.moduleKey === undefined ? null : { grantId: target.grantId, moduleKey: target.moduleKey, enabled: false };
        const messages = payload === null ? [] : refusalMessages("stop-module", payload);
        if (payload === null || messages.length > 0) {
          return <EffectRefused effect="stop-module" messages={messages} />;
        }
        return (
          <EffectReview
            effect="stop-module"
            targetIdentity={identityOf("stop-module", target) ?? "this relationship"}
            input={{ scope, expectedRevision: reviewRevision, payload }}
            submit={submitModule}
            headingLevel={reviewLevel}
            onCheckResult={onCheckResult}
            onCancel={keep}
            onSettled={settle}
          />
        );
      }
      case "withdraw-check-in": {
        const { checkInId, checkInRevisionId } = target;
        const payload = checkInId === undefined || checkInRevisionId === undefined ? null : { checkInId, sharedRevisionId: checkInRevisionId };
        const messages = payload === null ? [] : refusalMessages("withdraw-check-in", payload);
        if (payload === null || messages.length > 0) {
          return <EffectRefused effect="withdraw-check-in" messages={messages} />;
        }
        return (
          <EffectReview
            effect="withdraw-check-in"
            targetIdentity={identityOf("withdraw-check-in", target) ?? "this relationship"}
            input={{ scope, expectedRevision: reviewRevision, payload }}
            submit={submitWithdrawal}
            headingLevel={reviewLevel}
            onCheckResult={onCheckResult}
            onCancel={keep}
            onSettled={settle}
          />
        );
      }
      case "remove-task-share": {
        const { taskShareId } = target;
        const payload = taskShareId === undefined ? null : { taskShareId };
        const messages = payload === null ? [] : refusalMessages("remove-task-share", payload);
        if (payload === null || messages.length > 0) {
          return <EffectRefused effect="remove-task-share" messages={messages} />;
        }
        return (
          <EffectReview
            effect="remove-task-share"
            targetIdentity={identityOf("remove-task-share", target) ?? "this relationship"}
            input={{ scope, expectedRevision: reviewRevision, payload }}
            submit={submitTaskShareStop}
            headingLevel={reviewLevel}
            onCheckResult={onCheckResult}
            onCancel={keep}
            onSettled={settle}
          />
        );
      }
      case "end-relationship": {
        const payload = { grantId: target.grantId };
        const messages = refusalMessages("end-relationship", payload);
        if (messages.length > 0) {
          return <EffectRefused effect="end-relationship" messages={messages} />;
        }
        return (
          <EffectReview
            effect="end-relationship"
            targetIdentity={identityOf("end-relationship", target) ?? "this relationship"}
            input={{ scope, expectedRevision: reviewRevision, payload }}
            submit={submitEnd}
            headingLevel={reviewLevel}
            onCheckResult={onCheckResult}
            onCancel={keep}
            onSettled={settle}
          />
        );
      }
      case "coach-leave": {
        const payload = { grantId: target.grantId };
        const messages = refusalMessages("coach-leave", payload);
        if (messages.length > 0) {
          return <EffectRefused effect="coach-leave" messages={messages} />;
        }
        return (
          <EffectReview
            effect="coach-leave"
            targetIdentity={identityOf("coach-leave", target) ?? "this relationship"}
            input={{ scope, expectedRevision: reviewRevision, payload }}
            submit={submitLeave}
            headingLevel={reviewLevel}
            onCheckResult={onCheckResult}
            onCancel={keep}
            onSettled={settle}
          />
        );
      }
      case "revoke": {
        const payload = { grantId: target.grantId };
        const messages = refusalMessages("revoke", payload);
        if (messages.length > 0) {
          return <EffectRefused effect="revoke" messages={messages} />;
        }
        return (
          <EffectReview
            effect="revoke"
            targetIdentity={identityOf("revoke", target) ?? "this relationship"}
            input={{ scope, expectedRevision: reviewRevision, payload }}
            submit={submitRevoke}
            headingLevel={reviewLevel}
            onCheckResult={onCheckResult}
            onCancel={keep}
            onSettled={settle}
          />
        );
      }
      default:
        return assertUnreachable(effect);
    }
  };

  return (
    <section aria-labelledby={headingId} data-slot="stop-actions" data-role={role} data-episode-state={target.episodeState} className={cn(ROOT_CLASS, className)}>
      <header className={HEADER_CLASS}>
        <Heading id={headingId}>{surface.heading}</Heading>
        <p className={SENTENCE_CLASS}>{surface.purpose}</p>
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">{standing.label}</Badge>
          <span className="min-w-0 text-pretty text-muted-foreground">{standing.description}</span>
        </p>
      </header>
      <Separator />
      {terminal ? (
        <EndedStatements state={target.episodeState} role={role} level={reviewLevel} />
      ) : (
        <>
          {showRow ? (
            <div className={PANEL_CLASS}>
              {offered.length === 0 ? (
                <p className={SENTENCE_CLASS}>{NO_EFFECT_SENTENCE}</p>
              ) : (
                <ul className={ROW_CLASS}>
                  {offered.map((effect) => (
                    <li key={effect} className="min-w-0">
                      <Button
                        type="button"
                        variant={DESTRUCTIVE_EFFECTS.has(effect) ? "destructive" : "outline"}
                        className={TRIGGER_CLASS}
                        data-effect={effect}
                        onClick={() => {
                          choose(effect);
                        }}
                      >
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
