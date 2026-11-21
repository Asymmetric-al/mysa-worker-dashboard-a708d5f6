"use client";
/**
 * `Stop showing me publicly`: the one confirmation, and the one durable result, for containing a Page.
 *
 * Containment is a reach change, not an editorial one. It withdraws every language edition of one Page at one
 * instant, and the service performs it without consulting the state of any sibling draft — so this control never
 * reads content validity, never waits for a save and never asks for one, and stays usable while another draft of
 * the same Page still needs fixing. What it cannot do is recall a copy that has already left this application,
 * and the confirmation says so in full instead of softening it.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { intentKeyOf, mayReplay, reappliableRevision, useReviewedMutation, type MutationSubmit } from "@/components/action-review";
import OperationResult, { type OperationResultProps } from "@/components/operation-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { copy } from "../copy";
import { useStopShowingPagePublicly, type StopShowingPayload, type StopShowingVariables } from "../hooks/use-reach-mutations";

// ---------------------------------------------------------------------------------------------------------
// Types taken from the contracts this control dispatches and renders
//
// The scope is the authority the family's own mutation accepts, and the outcome is the one the receipt takes,
// so neither can drift from what the transport validates or from what the receipt understands.
// ---------------------------------------------------------------------------------------------------------

/** The scope this containment is addressed to: the authority the Page read it came from ran under. */
export type ContainmentScope = StopShowingVariables["scope"];

/** What the receipt renders: one of the eight outcomes the service states. */
type ContainmentOutcome = OperationResultProps["outcome"];

/** The four-field input this control submits, without the operation identity the review step mints. */
type ContainmentInput = Omit<StopShowingVariables, "operationId">;

// ---------------------------------------------------------------------------------------------------------
// Wording
//
// Everything the wording module already states is taken from it verbatim. The three statements it does not
// carry — what is not deleted, which copies sit outside this application, and where the effect can be seen —
// are stated here because no other surface may state them for this action.
// ---------------------------------------------------------------------------------------------------------

const CANCEL_LABEL = "Cancel";

/** Said while the attempt is in flight, so the closed dialog leaves a stated condition rather than a disabled button. */
const WORKING_NOTE = "Stopping every language edition of this Page — working";

/** Said above the trigger: what the action does, before anyone opens the confirmation. */
const TRIGGER_SUMMARY = "Stopping this hides every language edition of this Page at once: no address serves it, and the public discovery index leaves it out.";

/** The confirmation's statement about deletion, which the wording module does not carry. */
const DELETES_NOTHING = "Nothing is deleted. The Page, its drafts, its review candidates and its media all stay exactly as they are; only how far the Page reaches changes.";

/** The half of the no-recall statement the wording module leaves implicit: the copies this application cannot see. */
const COPIES_OUTSIDE_THIS_APPLICATION = "A message already sent, a copy a browser or another service kept, and a copy someone passed on sit outside this application and stay where they are.";

/** Said once containment settled: the reach was dismissed, and this was not an editorial cleanup. */
const REACH_NOT_EDITORIAL = "This is a reach change and not an editorial one: it changed how far the Page reaches and nothing about its content, so no draft was tidied, no translation was corrected and no review candidate was cleared.";

/** Where the worker sees the effect for themselves, without this action claiming to have looked. */
const VERIFY_ON_NEXT_READ = "On the next read, the public discovery index leaves these editions out and the direct address refuses them: open the discovery index to see the result for yourself.";

const CONTAINED_TITLE = "Every language edition is contained";

const NOTHING_CHANGED_TITLE = "Nothing needed containing";

const NOTHING_CONTAINED = "No edition of this Page was public or listed when you confirmed, so nothing was changed and no edition's reach was altered.";

/** Stated when the caller withholds the action without naming a reason of its own. */
const AUTHORITY_REASON = "This session cannot stop showing this Page publicly.";

/** Stated when the Page carries no edition at all, so there is nothing public to contain yet. */
const NO_EDITION_REASON = "This Page has no language edition yet, so there is nothing public to stop showing.";

// ---------------------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------------------

/** The count this control acts on: a whole number of editions, or none when the caller stated nothing usable. */
export function statedEditionCount(editionCount: number): number {
  return Number.isFinite(editionCount) && editionCount > 0 ? Math.trunc(editionCount) : 0;
}

function editionNoun(count: number): string {
  return count === 1 ? "language edition" : "language editions";
}

/**
 * The payload this confirmation is the acknowledgement for.
 *
 * `acknowledgeContainsAllLocales` is the literal the schema requires: it records that the worker was shown that
 * containment covers every language edition, so a submission whose confirmation was never displayed cannot be
 * built — removing it fails to compile rather than being silently accepted by the transport.
 */
export function containmentAcknowledgement(documentId: string): StopShowingPayload {
  return { documentId, acknowledgeContainsAllLocales: true };
}

type ContainmentStatement = { readonly title: string; readonly sentences: readonly string[] };

/** What the settled outcome means for this Page's editions, or `null` when there is nothing to add to the receipt. */
function containmentStatement(outcome: ContainmentOutcome, editions: number): ContainmentStatement | null {
  if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") {
    return { title: CONTAINED_TITLE, sentences: [copy.stopShowingPublicly.resultSummary(editions), REACH_NOT_EDITORIAL, VERIFY_ON_NEXT_READ] };
  }
  if (outcome.outcome === "unchanged") {
    return { title: NOTHING_CHANGED_TITLE, sentences: [NOTHING_CONTAINED] };
  }
  // Every other outcome the service states — a stale revision, a refusal, an outage, an unconfirmed attempt —
  // is reported in full by the receipt, and none of them contained anything. Adding a sentence here would let a
  // result that is not a completed containment be read as one.
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Props and component
// ---------------------------------------------------------------------------------------------------------

export type StopShowingPubliclyProps = {
  /**
   * The authority this containment is addressed to: the scope the Page read ran under.
   *
   * The mutation contract is `{ operationId, scope, expectedRevision, payload }`, and the service re-derives the
   * scope from the session before it writes, so a containment that did not state the context it was read in could
   * not be dispatched at all. Every other mutation surface in this application takes the same prop for the same
   * reason.
   */
  readonly scope: ContainmentScope;
  readonly documentId: string;
  readonly expectedRevision: string;
  /** How many language editions the read stated this Page carries; the receipt names this number. */
  readonly editionCount: number;
  /**
   * Set by the caller only for a reason of authority or a missing release. Draft validity is never a reason:
   * containment works while an unrelated draft of the same Page still needs fixing.
   */
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly className?: string;
};

/**
 * The confirmation and result for containing a Page.
 *
 * It composes the installed alert dialog for the confirmation, the shared review step's attempt identity so the
 * acceptance is reviewed once, and the shared receipt so the result survives the visit. Nothing here reads draft
 * state, and nothing here withdraws a single locale — that is a different action.
 */
export function StopShowingPublicly({ scope, documentId, expectedRevision, editionCount, disabled = false, disabledReason, className }: StopShowingPubliclyProps): ReactElement {
  const titleId = useId();
  const reasonId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const stopShowing = useStopShowingPagePublicly();
  const submit = useCallback<MutationSubmit<StopShowingPayload>>((input) => stopShowing.mutateAsync(input), [stopShowing]);
  const review = useReviewedMutation<StopShowingPayload>(submit);
  const input = useMemo<ContainmentInput>(() => ({ scope, expectedRevision, payload: containmentAcknowledgement(documentId) }), [scope, expectedRevision, documentId]);
  // An outcome belongs to the input that produced it: a stale receipt from an earlier read of a different Page
  // stays out of this render rather than being shown beside the Page now on screen.
  const current: ContainmentOutcome | null = review.reviewedIntent === intentKeyOf(input) ? review.outcome : null;
  const editions = statedEditionCount(editionCount);
  const trimmedReason = disabledReason?.trim() ?? "";
  const unavailableReason = disabled ? (trimmedReason === "" ? AUTHORITY_REASON : trimmedReason) : editions === 0 ? NO_EDITION_REASON : null;
  const actionUnavailable = unavailableReason !== null || review.pending;
  const statement = current === null ? null : containmentStatement(current, editions);
  const retrySameWork = mayReplay(current)
    ? (): void => {
        void review.retry();
      }
    : undefined;
  const reapply =
    reappliableRevision(current) === null
      ? undefined
      : (): void => {
          void review.reapply();
        };
  useEffect(() => {
    // The result region is focused once an attempt settles, so a keyboard and a screen reader land on what
    // happened instead of being left on a dialog that has just closed.
    if (current === null) return;
    resultRef.current?.focus();
  }, [current]);
  const confirm = (): void => {
    // The dialog closes first so the receipt below is reachable at once; the attempt keeps its identity in the
    // shared review step, so a retry replays this submission instead of starting a second one.
    setDialogOpen(false);
    void review.submit(input);
  };
  const state = review.pending ? "working" : current !== null ? "settled" : "review";
  const describedBy = unavailableReason === null ? undefined : reasonId;
  return (
    <section data-slot="stop-showing-publicly" data-state={state} data-edition-count={String(editions)} aria-labelledby={titleId} aria-busy={review.pending ? true : undefined} className={cn("flex min-w-0 flex-col gap-3 text-start", className)}>
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3 id={titleId} className="wrap-anywhere">
              {copy.stopShowingPublicly.action}
            </h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{TRIGGER_SUMMARY}</p>
          <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{DELETES_NOTHING}</p>
          <div className="flex flex-wrap items-center gap-2">
            <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <AlertDialogTrigger render={<Button type="button" variant="destructive" disabled={actionUnavailable} aria-describedby={describedBy} />}>{copy.stopShowingPublicly.action}</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{copy.stopShowingPublicly.confirmTitle}</AlertDialogTitle>
                  {/* The description element is itself a paragraph, so each sentence is a span laid out as a block. */}
                  <AlertDialogDescription className="flex flex-col gap-2">
                    <span>{copy.stopShowingPublicly.confirmBody}</span>
                    <span>
                      This covers all <bdi className="tabular-figures font-medium text-foreground">{String(editions)}</bdi> {editionNoun(editions)} of this Page.
                    </span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex min-w-0 flex-col gap-2 text-sm text-pretty wrap-anywhere">
                  <p>{DELETES_NOTHING}</p>
                  <Separator />
                  <p>{copy.stopShowingPublicly.doesNotRecallCopies}</p>
                  <p>{COPIES_OUTSIDE_THIS_APPLICATION}</p>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>{CANCEL_LABEL}</AlertDialogCancel>
                  <AlertDialogAction confirmVariant="destructive" onClick={confirm}>
                    {copy.stopShowingPublicly.action}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {review.pending ? <output className="block text-sm text-muted-foreground text-pretty wrap-anywhere">{WORKING_NOTE}</output> : null}
          {unavailableReason === null ? null : (
            <p id={reasonId} className="text-sm text-muted-foreground text-pretty wrap-anywhere">
              {unavailableReason}
            </p>
          )}
        </CardContent>
      </Card>
      {current === null ? null : (
        <div ref={resultRef} tabIndex={-1} data-slot="stop-showing-publicly-result" data-outcome={current.outcome} className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={current} headingLevel={4} onRetrySameWork={retrySameWork} onReapply={reapply} />
          {statement === null ? null : (
            <Alert role={undefined} data-slot="stop-showing-publicly-containment">
              <AlertTitle>
                <h4 className="wrap-anywhere">{statement.title}</h4>
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-2 text-pretty wrap-anywhere">
                {statement.sentences.map((sentence) => (
                  <p key={sentence}>{sentence}</p>
                ))}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </section>
  );
}

export default StopShowingPublicly;
