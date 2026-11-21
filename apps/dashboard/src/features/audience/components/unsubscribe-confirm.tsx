"use client";
/**
 * The one confirmation, and the one durable receipt, for turning off a reader's Update email from one publisher
 * for one purpose.
 *
 * **One scope, and only one.** The confirmation names the publisher and the purpose in visible text, the payload is
 * built through `unsubscribePayloadSchema` so it can carry nothing else, and this surface offers no way to turn off
 * two publishers, a second purpose or "everything": a person who wants two purposes reads two confirmations.
 *
 * **What the result may claim.** Accepting changes one membership for this publisher and this purpose. It does not
 * recall a notice already submitted, it does not reach a copy kept anywhere else, and it is not evidence that any
 * message was delivered or read. Those limits are stated beside the receipt rather than softened, and `unknown` is
 * recovered by checking the result under the attempt's own identity — never by sending again under a fresh one.
 *
 * **Authority.** AAP 0.10.1 family 10 and AAP 0.8.5 (an unsubscribe acts on one publisher and one purpose); the
 * mutation contract and its eight outcomes in AAP 0.7.1; `POST /api/unsubscribe` (`unsubscribe`) in AAP 0.6.3; the
 * consequential-action confirmation assigned to the alert dialog in AAP 0.4.2; and criterion 10.
 */
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

// ---------------------------------------------------------------------------------------------------------
// Types taken from the contracts this control dispatches and renders
// ---------------------------------------------------------------------------------------------------------

/** One of the eight outcomes the service states, as the shared receipt renders it. */
type UnsubscribeOutcome = OperationResultProps["outcome"];

/** The four-field input this control submits, without the operation identity the review step owns. */
type UnsubscribeInput = Omit<MutationInput<UnsubscribePayload>, "operationId">;

/**
 * The one membership this confirmation is about: the publisher as the read displayed it, the purpose, the state the
 * membership stands in now, and the revision the caller read.
 *
 * The publisher arrives as a display value *and* as the opaque reference the mutation addresses, because a name is
 * not an identity: the reference is what the payload carries, and the value is only what a person reads.
 */
export type UnsubscribeTarget = {
  readonly publisherId: string;
  /** The publisher name the read states; when it states none, the reference below is displayed instead. */
  readonly publisherLabel: string;
  readonly purpose: UnsubscribePayload["purpose"];
  /** The purpose as this reader sees it worded; when absent, the purpose reference is displayed instead. */
  readonly purposeLabel: string;
  /** Where the membership stands now, so an already-off membership is visible before anyone confirms. */
  readonly membershipState: MembershipState;
  /** The revision this membership stood at when the caller read it, presented with the mutation. */
  readonly expectedRevision: string;
};

export type UnsubscribeConfirmProps = {
  /** The authority this change is addressed to: the scope the preferences read ran under. */
  readonly scope: Scope;
  readonly target: UnsubscribeTarget;
  /**
   * Set the pair to let the route own the dialog, or leave them out and this control owns it through the trigger it
   * renders. Either way the change is written only by an explicit confirm inside the dialog, never on open.
   */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /**
   * Set by the caller for a reason of authority or of the record itself — never for a change elsewhere on the page.
   * A refusal stated here disables the confirm rather than leaving it pressable.
   */
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /**
   * How the caller re-reads what happened, offered on an unconfirmed result. When it is absent, checking the result
   * re-issues this same attempt identity, which the service answers with the result stored for it and never applies
   * twice — so a check can never become a resend.
   */
  readonly onCheckResult?: () => void;
  readonly className?: string;
};

// ---------------------------------------------------------------------------------------------------------
// Wording
//
// Everything the wording module already states is taken from it verbatim. The statements it does not carry — the
// current state line, what an acceptance never proves, and the difference between a definite failure and an
// unconfirmed one — are stated here because no other surface may state them for this action.
// ---------------------------------------------------------------------------------------------------------

const NAME_CLASS = "wrap-anywhere";
const IDENTIFIER_CLASS = "mono-identifier wrap-anywhere";
const CANCEL_LABEL = "Cancel";
/**
 * The action naming a whole publisher cannot be one unwrapped line: the button's own recipe is `nowrap` and
 * `shrink-0`, which pushed the page sideways at 320 CSS px. Wrapping the label inside the available width is what
 * keeps the horizontal scrollbar on a table's own region, where the reflow requirement puts it.
 */
const ACTION_CLASS = "h-auto min-h-9 max-w-full py-2 whitespace-normal text-pretty";

/** Said while the attempt is in flight, so the closed dialog leaves a stated condition rather than a silent wait. */
const WORKING_NOTE = "Turning off these notices — working";

/** Said above the trigger: what the action does before anyone opens the confirmation. */
const TRIGGER_SUMMARY = "Turning these notices off changes one membership: this publisher's Update email for this purpose. Every other purpose, every other publisher and every other record stays as it is.";

/** The label the one purpose is introduced with, so the scope is named in visible text and not only implied. */
const PURPOSE_LABEL = "The one purpose this covers:";

/** The label the current state is introduced with. */
const CURRENT_STATE_LABEL = "This membership today:";

/** The heading over the statement that a submitted notice cannot be recalled. */
const RECALL_TITLE = "What turning this off cannot do";

/** Stated when the schema refuses the pair: the confirmation applies to exactly one publisher and one purpose. */
const STRICT_SCOPE_REASON = "This confirmation applies to exactly one publisher and one purpose, and this membership does not state both, so nothing can be submitted from here.";

/** Stated when the caller withholds the action without naming a reason of its own. */
const AUTHORITY_REASON = "This session cannot turn off these notices.";

/** Said before anyone confirms, when there is genuinely nothing to change; the settled statement words the same condition in its own way. */
const ALREADY_OFF_NOTE = "This membership is already off for this publisher and this purpose, so confirming changes nothing and creates no history entry.";

/** The distinction that keeps an acceptance from reading as delivery, and consent from reading as contact permission. */
const ACCEPTANCE_IS_NOT_DELIVERY = "This changes which notices are submitted for you. It is not a record that any message was delivered or was read, and it is not contact permission for anything else.";

/** The title of the statement beside an accepted, replayed or unchanged receipt. */
const RESULT_TITLE = "Only this membership changed";
const NOTHING_CHANGED_TITLE = "Nothing needed changing";
const NO_OTHER_MEMBERSHIP_TOUCHED = "No other membership of yours changed: other purposes from this publisher, other publishers and every other record about you stand exactly as they were.";

/**
 * The four state words as this surface states them on the current-state line. The audience copy module owns the full
 * descriptions of each state; this line only has to say, before anyone confirms, where the membership stands.
 */
const MEMBERSHIP_STATE_WORD: Readonly<Record<MembershipState, string>> = {
  active: "on — this address was confirmed for this publisher and this purpose",
  "awaiting-proof": "waiting for this address to be confirmed, so no notice is submitted yet",
  off: "off — these notices are not submitted for you",
  restricted: "restricted — a restriction excludes this membership, and a restriction is not a choice you made",
};

/** The field labels an `invalid` outcome is reported under, so a refusal names the member it refused. */
const PAYLOAD_FIELD_LABELS: Readonly<Record<string, string>> = { publisherId: "Publisher", purpose: "Purpose" };

// ---------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------

/**
 * The payload this confirmation is the acknowledgement for: one publisher, one purpose, and nothing else.
 *
 * The schema is the contract the transport validates, so the object is built through it rather than beside it — a
 * second publisher, another purpose or any extra field is refused here and can never reach the handler. `null`
 * means the pair cannot be submitted at all, and the confirmation then states why instead of offering a press that
 * would be refused.
 */
export function unsubscribeAcknowledgement(publisherId: string, purpose: UnsubscribePayload["purpose"]): UnsubscribePayload | null {
  const checked = unsubscribePayloadSchema.safeParse({ publisherId, purpose });
  return checked.success ? checked.data : null;
}

/** The one token the wording module leaves in each sentence that names the publisher. */
const PUBLISHER_TOKEN = "{publisher}";

/** Fills that token for the plain-text sentences a receipt states, where no element can isolate the value. */
function namingPublisher(template: string, publisher: string): string {
  return template.split(PUBLISHER_TOKEN).join(publisher);
}

type DisplayedValue = { readonly text: string; readonly reference: boolean };

/** The name a read stated, or the opaque reference when it stated none: a blank name would read as a rendering fault. */
function displayedValue(label: string, reference: string): DisplayedValue {
  const stated = label.trim();
  return stated === "" ? { text: reference, reference: true } : { text: stated, reference: false };
}

/**
 * Which membership a settled receipt belongs to: the authority it was made in and the publisher-and-purpose pair it
 * addressed. It deliberately leaves the revision out, because an acceptance asks this family's reads for the
 * membership again, and a receipt keyed on the revision would vanish in exactly the moment it became the record.
 */
function membershipSignature(scope: Scope, publisherId: string, purpose: string): string {
  return JSON.stringify([scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, publisherId, purpose]);
}

type SettledStatement = { readonly title: string; readonly sentences: readonly string[] };

/** What a settled outcome means for this membership, or `null` when the receipt already states it in full. */
function settledStatement(outcome: UnsubscribeOutcome, publisherText: string): SettledStatement | null {
  if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") {
    return { title: RESULT_TITLE, sentences: [namingPublisher(UNSUBSCRIBE_COPY.resultStatement, publisherText), NO_OTHER_MEMBERSHIP_TOUCHED, UNSUBSCRIBE_COPY.recallStatement, ACCEPTANCE_IS_NOT_DELIVERY] };
  }
  if (outcome.outcome === "unchanged") {
    return { title: NOTHING_CHANGED_TITLE, sentences: [ALREADY_OFF_NOTE, NO_OTHER_MEMBERSHIP_TOUCHED] };
  }
  // Every other outcome — a stale revision, a refusal, an outage, an unconfirmed attempt — is reported in full by the
  // receipt. A sentence added here would let a result that is not a completed change be read as one.
  return null;
}

/** One name, isolated so a mixed-direction value cannot reorder the sentence it sits in. */
function StatedValue({ value }: { readonly value: DisplayedValue }): ReactElement {
  return <bdi className={value.reference ? IDENTIFIER_CLASS : NAME_CLASS}>{value.text}</bdi>;
}

/** The one token a template leaves for the publisher, as the two parts either side of it. */
type PublisherParts = { readonly before: string; readonly after: string };

/** The one token a template leaves for the publisher, as the parts either side of it, so the value can be isolated. */
function publisherParts(template: string): PublisherParts {
  const at = template.indexOf(PUBLISHER_TOKEN);
  return at < 0 ? { before: template, after: "" } : { before: template.slice(0, at), after: template.slice(at + PUBLISHER_TOKEN.length) };
}

/** One sentence from the wording module, with the publisher it names set apart rather than folded into the string. */
function PublisherSentence({ template, value }: { readonly template: string; readonly value: DisplayedValue }): ReactElement {
  const { before, after } = publisherParts(template);
  return (
    <>
      {before}
      <StatedValue value={value} />
      {after}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------------------------------------

/**
 * The confirmation and receipt for turning off one publisher's Update email for this reader and this purpose.
 *
 * It composes the installed alert dialog for the confirmation, the shared review step for the attempt's identity, and
 * the shared receipt for the result, so the acknowledgement survives the visit and a replay answers with what was
 * already stored rather than applying a second change.
 */
export function UnsubscribeConfirm({ scope, target, open, onOpenChange, disabled = false, disabledReason, onCheckResult, className }: UnsubscribeConfirmProps): ReactElement {
  const titleId = useId();
  const reasonId = useId();
  const [dialogOpenHere, setDialogOpenHere] = useState(false);
  const dialogOpen = open ?? dialogOpenHere;
  const setDialogOpen = onOpenChange ?? setDialogOpenHere;
  const resultRef = useRef<HTMLDivElement | null>(null);
  const unsubscribe = useUnsubscribe();
  const submit = useCallback<MutationSubmit<UnsubscribePayload>>((submitted) => unsubscribe.mutateAsync(submitted), [unsubscribe]);
  const review = useReviewedMutation<UnsubscribePayload>(submit);
  const signature = useMemo(() => membershipSignature(scope, target.publisherId, target.purpose), [scope, target.publisherId, target.purpose]);
  const payload = useMemo(() => unsubscribeAcknowledgement(target.publisherId, target.purpose), [target.publisherId, target.purpose]);
  const input = useMemo<UnsubscribeInput | null>(() => (payload === null ? null : { scope, expectedRevision: target.expectedRevision, payload }), [payload, scope, target.expectedRevision]);
  const [settled, setSettled] = useState<{ readonly signature: string; readonly outcome: UnsubscribeOutcome } | null>(null);

  // An outcome belongs to the input that produced it, so a receipt from an earlier attempt or another membership is
  // never shown beside this one. A receipt already settled for *this* membership stays, even though an acceptance
  // asks the family's reads again and the revision it was submitted against then legitimately moves on.
  const reviewed: UnsubscribeOutcome | null = input !== null && review.reviewedIntent !== null && review.reviewedIntent === intentKeyOf(input) ? review.outcome : null;
  const settledHere: UnsubscribeOutcome | null = settled !== null && settled.signature === signature ? settled.outcome : null;
  const current: UnsubscribeOutcome | null = reviewed ?? settledHere;

  const publisher = displayedValue(target.publisherLabel, target.publisherId);
  const purpose = displayedValue(target.purposeLabel, target.purpose);
  const membershipState: DisplayedValue = { text: MEMBERSHIP_STATE_WORD[target.membershipState], reference: false };
  const trimmedReason = disabledReason?.trim() ?? "";
  const unavailableReason = disabled ? (trimmedReason === "" ? AUTHORITY_REASON : trimmedReason) : payload === null ? STRICT_SCOPE_REASON : null;
  const actionUnavailable = unavailableReason !== null || review.pending;
  const alreadyOff = target.membershipState === "off";
  const statement = current === null ? null : settledStatement(current, publisher.text);
  const describedBy = unavailableReason === null ? undefined : reasonId;
  const state = review.pending ? "working" : current !== null ? "settled" : "review";

  useEffect(() => {
    // The receipt is focused once an attempt settles, so a keyboard and a screen reader land on what happened
    // instead of being left behind on a dialog that has just closed.
    if (current === null) return;
    resultRef.current?.focus();
  }, [current]);

  /** Records the outcome of a replay or a re-application against this membership, so the receipt keeps reporting it. */
  const settle = (run: () => Promise<UnsubscribeOutcome | null>): void => {
    void run().then((outcome) => {
      if (outcome !== null) setSettled({ signature, outcome });
    });
  };

  const confirm = (): void => {
    if (input === null) return;
    // The dialog closes first so the receipt below is reachable at once. The attempt keeps the identity the review
    // step gave it, so a later replay of this same intent answers with the stored result instead of applying twice.
    setDialogOpen(false);
    void review.submit(input).then((outcome) => {
      setSettled({ signature, outcome });
    });
  };

  const replaySameAttempt = (): void => {
    settle(() => review.retry());
  };

  const applyAgain = (): void => {
    settle(() => review.reapply());
  };

  let checkResult: (() => void) | undefined;
  if (current !== null && current.outcome === "unknown") {
    // An unconfirmed attempt is recovered by checking the result under its own identity. Where the caller cannot
    // re-read what happened, re-issuing this same attempt is the check: the service answers with the result stored
    // for it, and a request under a fresh key — the one thing that could turn uncertainty into a second change — is
    // never built here.
    checkResult = onCheckResult ?? replaySameAttempt;
  }
  let retrySameWork: (() => void) | undefined;
  if (current !== null && current.outcome === "unavailable" && mayReplay(current)) {
    // A definite failure did not change anything, so sending this same attempt again is a retry rather than a risk.
    retrySameWork = replaySameAttempt;
  }
  const reapplyHandler = reappliableRevision(current) === null ? undefined : applyAgain;

  return (
    <section data-slot="unsubscribe-confirm" data-state={state} data-membership-state={target.membershipState} aria-labelledby={titleId} aria-busy={review.pending ? true : undefined} className={cn("flex min-w-0 flex-col gap-3 text-start", className)}>
      <h3 id={titleId} className="text-base font-medium wrap-anywhere">
        {UNSUBSCRIBE_COPY.heading}
      </h3>
      <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{TRIGGER_SUMMARY}</p>
      <p className="text-sm text-pretty wrap-anywhere">
        {CURRENT_STATE_LABEL} <StatedValue value={membershipState} />.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger render={<Button type="button" variant="destructive" className={ACTION_CLASS} disabled={actionUnavailable} aria-describedby={describedBy} />}>
            <PublisherSentence template={UNSUBSCRIBE_COPY.action} value={publisher} />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <PublisherSentence template={UNSUBSCRIBE_COPY.confirmationTitle} value={publisher} />
              </AlertDialogTitle>
              {/* The description element is itself a paragraph, so each sentence is a span laid out as a block. */}
              <AlertDialogDescription className="flex flex-col gap-2">
                <span>
                  <PublisherSentence template={UNSUBSCRIBE_COPY.confirmationBody} value={publisher} />
                </span>
                <span>
                  {PURPOSE_LABEL} <StatedValue value={purpose} />.
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
              <AlertTitle>{RECALL_TITLE}</AlertTitle>
              <AlertDescription>
                <p>{UNSUBSCRIBE_COPY.recallStatement}</p>
              </AlertDescription>
            </Alert>
            {unavailableReason === null ? null : <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{unavailableReason}</p>}
            <AlertDialogFooter>
              {/* Cancel is listed first, so it takes the dialog's initial focus and Escape dismisses without writing. */}
              <AlertDialogCancel>{CANCEL_LABEL}</AlertDialogCancel>
              <AlertDialogAction confirmVariant="destructive" className={ACTION_CLASS} disabled={actionUnavailable} onClick={confirm}>
                <PublisherSentence template={UNSUBSCRIBE_COPY.action} value={publisher} />
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
      {/* Stated before anyone confirms, and left to the settled statement afterwards rather than said twice. */}
      {alreadyOff && current === null ? <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{ALREADY_OFF_NOTE}</p> : null}
      {current === null ? null : (
        <div ref={resultRef} tabIndex={-1} data-slot="unsubscribe-confirm-result" data-outcome={current.outcome} className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={current} headingLevel={4} onCheckResult={checkResult} onRetrySameWork={retrySameWork} onReapply={reapplyHandler} fieldLabels={PAYLOAD_FIELD_LABELS} />
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
