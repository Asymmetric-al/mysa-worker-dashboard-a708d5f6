"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { intentKeyOf, mayReplay, reappliableRevision, useReviewedMutation, type MutationSubmit } from "@/components/action-review";
import OperationResult, { type OperationResultProps } from "@/components/operation-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { UNSUBSCRIBE_COPY } from "@/features/audience/copy/preferences";
import { cn } from "@/lib/cn";
import type { MembershipState, MutationInput, Scope } from "@/modules/data-service/envelope";
import { useUnsubscribe } from "../hooks/use-audience-mutations";
import { unsubscribePayloadSchema, type UnsubscribePayload } from "../schemas/unsubscribe";
type UnsubscribeOutcome = OperationResultProps["outcome"];
type UnsubscribeInput = Omit<MutationInput<UnsubscribePayload>, "operationId">;
/** The one membership this confirmation is about: */ export type UnsubscribeTarget = { readonly publisherId: string; readonly publisherLabel: string; readonly purpose: UnsubscribePayload["purpose"]; readonly purposeLabel: string; readonly membershipState: MembershipState; readonly expectedRevision: string };
export type UnsubscribeConfirmProps = { readonly scope: Scope; readonly target: UnsubscribeTarget; readonly open?: boolean; readonly onOpenChange?: (open: boolean) => void; readonly disabled?: boolean; readonly disabledReason?: string; readonly onCheckResult?: () => void; readonly className?: string };
const IDENTIFIER_CLASS = "mono-identifier wrap-anywhere";
const ACTION_CLASS = "h-auto min-h-9 max-w-full py-2 whitespace-normal text-pretty";
const CURRENT_STATE_LABEL = "This membership today:";
const STRICT_SCOPE_REASON = "This confirmation applies to exactly one publisher and one purpose, and this membership does not state both, so nothing can be submitted from here.";
const AUTHORITY_REASON = "This session cannot turn off these notices.";
const ALREADY_OFF_NOTE = "This membership is already off for this publisher and this purpose, so confirming changes nothing and creates no history entry.";
const ACCEPTANCE_IS_NOT_DELIVERY = "This changes which notices are submitted for you. It is not a record that any message was delivered or was read, and it is not contact permission for anything else.";
const NO_OTHER_MEMBERSHIP_TOUCHED = "No other membership of yours changed: other purposes from this publisher, other publishers and every other record about you stand exactly as they were.";
const MEMBERSHIP_STATE_WORD: Readonly<Record<MembershipState, string>> = {
  active: "on — this address was confirmed for this publisher and this purpose",
  "awaiting-proof": "waiting for this address to be confirmed, so no notice is submitted yet",
  off: "off — these notices are not submitted for you",
  restricted: "restricted — a restriction excludes this membership, and a restriction is not a choice you made",
};
const PAYLOAD_FIELD_LABELS: Readonly<Record<string, string>> = { publisherId: "Publisher", purpose: "Purpose" };
/** The payload this confirmation is the acknowledgement for: */ export function unsubscribeAcknowledgement(publisherId: string, purpose: UnsubscribePayload["purpose"]): UnsubscribePayload | null {
  const checked = unsubscribePayloadSchema.safeParse({ publisherId, purpose });
  return checked.success ? checked.data : null;
}
const PUBLISHER_TOKEN = "{publisher}";
type DisplayedValue = { readonly text: string; readonly reference: boolean };
function displayedValue(label: string, reference: string): DisplayedValue {
  const stated = label.trim();
  return stated === "" ? { text: reference, reference: true } : { text: stated, reference: false };
}
const membershipSignature = (scope: Scope, publisherId: string, purpose: string): string => JSON.stringify([scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, publisherId, purpose]);
type SettledStatement = { readonly title: string; readonly sentences: readonly string[] };
function settledStatement(outcome: UnsubscribeOutcome, publisherText: string): SettledStatement | null {
  if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") return { title: "Only this membership changed", sentences: [UNSUBSCRIBE_COPY.resultStatement.split(PUBLISHER_TOKEN).join(publisherText), NO_OTHER_MEMBERSHIP_TOUCHED, UNSUBSCRIBE_COPY.recallStatement, ACCEPTANCE_IS_NOT_DELIVERY] };
  return outcome.outcome === "unchanged" ? { title: "Nothing needed changing", sentences: [ALREADY_OFF_NOTE, NO_OTHER_MEMBERSHIP_TOUCHED] } : null;
}
const StatedValue = ({ value }: { readonly value: DisplayedValue }): ReactElement => <bdi className={value.reference ? IDENTIFIER_CLASS : "wrap-anywhere"}>{value.text}</bdi>;
type PublisherParts = { readonly before: string; readonly after: string };
function publisherParts(template: string): PublisherParts {
  const at = template.indexOf(PUBLISHER_TOKEN);
  return at < 0 ? { before: template, after: "" } : { before: template.slice(0, at), after: template.slice(at + PUBLISHER_TOKEN.length) };
}
const PublisherSentence = ({ template, value }: { readonly template: string; readonly value: DisplayedValue }): ReactElement => {
  const { before, after } = publisherParts(template);
  return (
    <>
      {before}
      <StatedValue value={value} />
      {after}
    </>
  );
};
/** The confirmation and receipt for turning off one publisher's Update email for this reader and this purpose. */ export function UnsubscribeConfirm({ scope, target, open, onOpenChange, disabled = false, disabledReason, onCheckResult, className }: UnsubscribeConfirmProps): ReactElement {
  const titleId = useId();
  const reasonId = useId();
  const [dialogOpenHere, setDialogOpenHere] = useState(false);
  const setDialogOpen = onOpenChange ?? setDialogOpenHere;
  const resultRef = useRef<HTMLDivElement | null>(null);
  const unsubscribe = useUnsubscribe();
  const submit = useCallback<MutationSubmit<UnsubscribePayload>>((submitted) => unsubscribe.mutateAsync(submitted), [unsubscribe]);
  const review = useReviewedMutation<UnsubscribePayload>(submit);
  const signature = useMemo(() => membershipSignature(scope, target.publisherId, target.purpose), [scope, target.publisherId, target.purpose]);
  const payload = useMemo(() => unsubscribeAcknowledgement(target.publisherId, target.purpose), [target.publisherId, target.purpose]);
  const input = useMemo<UnsubscribeInput | null>(() => (payload === null ? null : { scope, expectedRevision: target.expectedRevision, payload }), [payload, scope, target.expectedRevision]);
  const [settled, setSettled] = useState<{ readonly signature: string; readonly outcome: UnsubscribeOutcome } | null>(null);
  const current: UnsubscribeOutcome | null = (input !== null && review.reviewedIntent !== null && review.reviewedIntent === intentKeyOf(input) ? review.outcome : null) ?? (settled !== null && settled.signature === signature ? settled.outcome : null);
  const publisher = displayedValue(target.publisherLabel, target.publisherId);
  const purpose = displayedValue(target.purposeLabel, target.purpose);
  const membershipState: DisplayedValue = { text: MEMBERSHIP_STATE_WORD[target.membershipState], reference: false };
  const trimmedReason = disabledReason?.trim() ?? "";
  const unavailableReason = disabled ? (trimmedReason === "" ? AUTHORITY_REASON : trimmedReason) : payload === null ? STRICT_SCOPE_REASON : null;
  const actionUnavailable = unavailableReason !== null || review.pending;
  const statement = current === null ? null : settledStatement(current, publisher.text);
  const state = review.pending ? "working" : current !== null ? "settled" : "review";
  useEffect(() => {
    if (current === null) return;
    resultRef.current?.focus();
  }, [current]);
  const settle = (run: () => Promise<UnsubscribeOutcome | null>): void => {
    void run().then((outcome) => {
      if (outcome !== null) setSettled({ signature, outcome });
    });
  };
  const confirm = (): void => {
    if (input === null) return;
    setDialogOpen(false);
    void review.submit(input).then((outcome) => setSettled({ signature, outcome }));
  };
  const replaySameAttempt = (): void => settle(() => review.retry());
  const applyAgain = (): void => settle(() => review.reapply());
  const retrySameWork = current !== null && current.outcome === "unavailable" && mayReplay(current) ? replaySameAttempt : undefined;
  const reapplyHandler = reappliableRevision(current) === null ? undefined : applyAgain;
  return (
    <section data-slot="unsubscribe-confirm" data-state={state} data-membership-state={target.membershipState} aria-labelledby={titleId} aria-busy={review.pending ? true : undefined} className={cn("flex min-w-0 flex-col gap-3 text-start", className)}>
      <h3 id={titleId} className="text-base font-medium wrap-anywhere">
        {UNSUBSCRIBE_COPY.heading}
      </h3>
      <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">Turning these notices off changes one membership: this publisher's Update email for this purpose. Every other purpose, every other publisher and every other record stays as it is.</p>
      <p className="text-sm text-pretty wrap-anywhere">
        {CURRENT_STATE_LABEL} <StatedValue value={membershipState} />.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <AlertDialog open={open ?? dialogOpenHere} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger render={<Button type="button" variant="destructive" className={ACTION_CLASS} disabled={actionUnavailable} aria-describedby={unavailableReason === null ? undefined : reasonId} />}>
            <PublisherSentence template={UNSUBSCRIBE_COPY.action} value={publisher} />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <PublisherSentence template={UNSUBSCRIBE_COPY.confirmationTitle} value={publisher} />
              </AlertDialogTitle>
              <AlertDialogDescription className="flex flex-col gap-2">
                <span>
                  <PublisherSentence template={UNSUBSCRIBE_COPY.confirmationBody} value={publisher} />
                </span>
                <span>
                  {"The one purpose this covers:"} <StatedValue value={purpose} />.
                </span>
                <span>
                  {CURRENT_STATE_LABEL} <StatedValue value={membershipState} />.
                </span>
                <span>
                  <PublisherSentence template={UNSUBSCRIBE_COPY.scopeStatement} value={publisher} />
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Alert role={undefined} data-slot="unsubscribe-confirm-recall">
              <AlertTitle>What turning this off cannot do</AlertTitle>
              <AlertDescription>
                <p>{UNSUBSCRIBE_COPY.recallStatement}</p>
              </AlertDescription>
            </Alert>
            {unavailableReason === null ? null : <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{unavailableReason}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction confirmVariant="destructive" className={ACTION_CLASS} disabled={actionUnavailable} onClick={confirm}>
                <PublisherSentence template={UNSUBSCRIBE_COPY.action} value={publisher} />
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {review.pending ? <output className="block text-sm text-muted-foreground text-pretty wrap-anywhere">Turning off these notices — working</output> : null}
      {unavailableReason === null ? null : (
        <p id={reasonId} className="text-sm text-muted-foreground text-pretty wrap-anywhere">
          {unavailableReason}
        </p>
      )}
      {target.membershipState === "off" && current === null ? <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{ALREADY_OFF_NOTE}</p> : null}
      {current === null ? null : (
        <div ref={resultRef} tabIndex={-1} data-slot="unsubscribe-confirm-result" data-outcome={current.outcome} className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={current} headingLevel={4} onCheckResult={current !== null && current.outcome === "unknown" ? (onCheckResult ?? replaySameAttempt) : undefined} onRetrySameWork={retrySameWork} onReapply={reapplyHandler} fieldLabels={PAYLOAD_FIELD_LABELS} />
          {statement === null ? null : (
            <Alert role={undefined} data-slot="unsubscribe-confirm-statement">
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
export default UnsubscribeConfirm;
