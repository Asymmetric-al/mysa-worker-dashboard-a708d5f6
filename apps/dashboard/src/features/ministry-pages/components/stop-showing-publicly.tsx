"use client";
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
import { openRevisionOf, settledRevisionOf, useStopShowingPagePublicly, type StopShowingPayload, type StopShowingVariables } from "../hooks/page-mutations";
export type ContainmentScope = StopShowingVariables["scope"];
type ContainmentOutcome = OperationResultProps["outcome"];
const DELETES_NOTHING = "Nothing is deleted. The Page, its drafts, its review candidates and its media all stay exactly as they are; only how far the Page reaches changes.";
const REACH_NOT_EDITORIAL = "This is a reach change and not an editorial one: it changed how far the Page reaches and nothing about its content, so no draft was tidied, no translation was corrected and no review candidate was cleared.";
/** The count this control acts on: a whole number of editions, or none when the caller stated nothing usable. */ export const statedEditionCount = (editionCount: number): number => (Number.isFinite(editionCount) && editionCount > 0 ? Math.trunc(editionCount) : 0);
/** The payload this confirmation is the acknowledgement for. */ export const containmentAcknowledgement = (documentId: string): StopShowingPayload => ({ documentId, acknowledgeContainsAllLocales: true });
function containmentStatement(outcome: ContainmentOutcome, editions: number): { readonly title: string; readonly sentences: readonly string[] } | null {
  if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted")
    return { title: "Every language edition is contained", sentences: [copy.stopShowingPublicly.resultSummary(editions), REACH_NOT_EDITORIAL, "On the next read, the public discovery index leaves these editions out and the direct address refuses them: open the discovery index to see the result for yourself."] };
  return outcome.outcome === "unchanged" ? { title: "Nothing needed containing", sentences: ["No edition of this Page was public or listed when you confirmed, so nothing was changed and no edition's reach was altered."] } : null;
}
export type StopShowingPubliclyProps = { readonly scope: ContainmentScope; readonly documentId: string; readonly expectedRevision: string; readonly editionCount: number; readonly disabled?: boolean; readonly disabledReason?: string; readonly className?: string };
/** The confirmation and result for containing a Page. */ export function StopShowingPublicly({ scope, documentId, expectedRevision, editionCount, disabled = false, disabledReason, className }: StopShowingPubliclyProps): ReactElement {
  const titleId = useId();
  const reasonId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [attemptRevision, setAttemptRevision] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const stopShowing = useStopShowingPagePublicly();
  const submit = useCallback<MutationSubmit<StopShowingPayload>>((input) => stopShowing.mutateAsync(input), [stopShowing]);
  const review = useReviewedMutation<StopShowingPayload>(submit);
  const openRevision = openRevisionOf(expectedRevision, attemptRevision, settledRevisionOf(review.outcome)); // The revision a new confirmation presents: the read's, or — until that read has landed — the revision this view's own last acceptance produced.
  const input = useMemo<Omit<StopShowingVariables, "operationId">>(() => ({ scope, expectedRevision: attemptRevision ?? openRevision, payload: containmentAcknowledgement(documentId) }), [scope, openRevision, attemptRevision, documentId]); // The revision this confirmation is opened against, held for the attempt: the read that follows an acceptance reports a newer one, and the result below still belongs to the attempt it made.
  const current: ContainmentOutcome | null = review.reviewedIntent === intentKeyOf(input) ? review.outcome : null;
  const editions = statedEditionCount(editionCount);
  const unavailableReason = disabled ? ((disabledReason?.trim() ?? "") === "" ? "This session cannot stop showing this Page publicly." : (disabledReason?.trim() ?? "")) : editions === 0 ? "This Page has no language edition yet, so there is nothing public to stop showing." : null;
  const statement = current === null ? null : containmentStatement(current, editions);
  const retrySameWork = mayReplay(current) ? (): void => void review.retry() : undefined;
  const reapply = reappliableRevision(current) === null ? undefined : (): void => void review.reapply();
  useEffect(() => {
    if (current === null) return;
    resultRef.current?.focus();
  }, [current]);
  const confirm = (): void => {
    setDialogOpen(false);
    setAttemptRevision(openRevision);
    void review.submit({ scope, expectedRevision: openRevision, payload: containmentAcknowledgement(documentId) });
  };
  const state = review.pending ? "working" : current !== null ? "settled" : "review";
  return (
    <section data-slot="stop-showing-publicly" data-state={state} data-edition-count={String(editions)} aria-labelledby={titleId} aria-busy={review.pending ? true : undefined} className={cn("flex min-w-0 flex-col gap-3 text-start", className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3 {...{ id: titleId, className: "type-subsection-title wrap-anywhere" as const }}>{copy.stopShowingPublicly.action}</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <p className="type-supporting text-pretty wrap-anywhere">{"Stopping this hides every language edition of this Page at once: no address serves it, and the public discovery index leaves it out."}</p>
          <p className="type-supporting text-pretty wrap-anywhere">{DELETES_NOTHING}</p>
          <div className="flex flex-wrap items-center gap-2">
            <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <AlertDialogTrigger render={<Button type="button" variant="destructive" disabled={unavailableReason !== null || review.pending} aria-describedby={unavailableReason === null ? undefined : reasonId} />}>{copy.stopShowingPublicly.action}</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{copy.stopShowingPublicly.confirmTitle}</AlertDialogTitle>
                  <AlertDialogDescription className="flex flex-col gap-2">
                    <span>{copy.stopShowingPublicly.confirmBody}</span>
                    <span>
                      This covers all <bdi className="tabular-figures font-medium text-foreground">{String(editions)}</bdi> {editions === 1 ? "language edition" : "language editions"} of this Page.
                    </span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex min-w-0 flex-col gap-2 text-pretty wrap-anywhere">
                  <p className="type-supporting">{DELETES_NOTHING}</p>
                  <Separator />
                  <p className="type-supporting">{copy.stopShowingPublicly.doesNotRecallCopies}</p>
                  <p className="type-supporting">{"A message already sent, a copy a browser or another service kept, and a copy someone passed on sit outside this application and stay where they are."}</p>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>{"Cancel"}</AlertDialogCancel>
                  <AlertDialogAction {...{ confirmVariant: "destructive" as const, onClick: confirm }}>{copy.stopShowingPublicly.action}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {review.pending ? <output className="block type-supporting text-pretty wrap-anywhere">{"Stopping every language edition of this Page — working"}</output> : null}
          {unavailableReason === null ? null : <p {...{ id: reasonId, className: "type-supporting text-pretty wrap-anywhere" as const }}>{unavailableReason}</p>}
        </CardContent>
      </Card>
      {current === null ? null : (
        <div ref={resultRef} tabIndex={-1} data-slot="stop-showing-publicly-result" data-outcome={current.outcome} className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={current} headingLevel={4} onRetrySameWork={retrySameWork} onReapply={reapply} />
          {statement === null ? null : (
            <Alert role={undefined} data-slot="stop-showing-publicly-containment">
              <AlertTitle>
                <h4 className="type-group-title wrap-anywhere">{statement.title}</h4>
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-2 text-pretty wrap-anywhere">
                {statement.sentences.map((sentence) => (
                  <p key={sentence} className="type-supporting">
                    {sentence}
                  </p>
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
