"use client";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import { intentKeyOf, useReviewedMutation } from "@/components/action-review";
import { hasSettled } from "@/components/attempt";
import { FactList, factFrame } from "@/components/fact-list";
import FormField, { fieldErrorsFromInvalid } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import SimulationLabel from "@/components/simulation-label";
import StatusBadge, { MEMBERSHIP_STATUS, statusBadgeProps, type MembershipStatus } from "@/components/status-badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MEMBERSHIP_STATE_DESCRIPTIONS, PURPOSE_LABEL } from "@/features/audience/copy/membership";
import { CONFIRMATION_DEADLINE_COPY, LANGUAGE_PREFERENCE_COPY, PROOF_FLOW_COPY, PROOF_MESSAGE_COPY, PROOF_RESEND_COPY } from "@/features/audience/copy/preferences";
import { useConfirmMembership, useSignupForPurpose } from "@/features/audience/hooks/use-audience-mutations";
import type { ConfirmPayload, SignupPayload } from "@/features/audience/schemas/confirmation";
import { cn } from "@/lib/cn";
import type { ConfirmationMessage } from "@/modules/audience/membership";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
/** The membership state the preferences read states, including `none` for a reader who holds no membership yet. */ export type ProofMembershipState = MembershipStatus | "none";
/** The confirmation window as the service reports it at the instant the read ran: */ export type ProofConfirmationWindow = { readonly state: "open" | "expired" | "not-awaiting-proof"; readonly deadline: string | null };
/** The membership this journey addresses: the record's identity, the address it is set for and the language it records. */ export type ProofMembership = { readonly membershipId: string; readonly email: string | null; readonly languagePreference: string | null };
export type ProofFlowProps = {
  readonly scope: Scope;
  readonly publisherId: string;
  readonly publisherLabel: string;
  readonly purpose: SignupPayload["purpose"];
  readonly state: ProofMembershipState;
  readonly membership: ProofMembership | null;
  readonly expectedRevision: string;
  readonly confirmation?: ProofConfirmationWindow;
  /** The confirmation message the read composed for the membership it states, rendered in place of sending one; null where the read states no awaiting-proof membership. */ readonly confirmationMessage?: ConfirmationMessage | null;
  readonly languagePreference?: string | null;
  readonly headingLevel?: 2 | 3 | 4;
  readonly dir?: "ltr" | "rtl";
  readonly onCheckResult?: () => void;
  readonly className?: string;
};
type ProofStep = "request" | "awaiting-proof" | "confirmation-closed" | "active" | "off" | "restricted";
const SECTION_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
const ZONE_HEADING_TAG = { 2: "h3", 3: "h4", 4: "h4" } as const;
const EMAIL_FIELD = "email";
const SIGNUP_FIELD_LABELS: Readonly<Record<string, string>> = { email: "Email address", publisherId: "Publisher", purpose: "Purpose", displayName: "Display name", languagePreference: "Reading language" };
const CONFIRM_FIELD_LABELS: Readonly<Record<string, string>> = { membershipId: "The membership this confirmation applies to" };
const SURFACE_COPY = {
  entitlement: "Applies to this ministry’s update emails only.",
  emailLabel: "Email address",
  emailDescription: "Saved only for this subscription — never used to match or merge other records.",
  addressFact: "Email address",
  languageFact: "Reading language",
  awaitingReadback: "Refreshing subscription status… Confirm below once ready.",
  closedReason: "The confirmation window has expired — request update emails again to start a fresh window.",
  noWindowStated: "Confirmation is checked against the server when you confirm.",
  storedWindowLead: "Confirmation window closed at",
  storedWindowTail: "Confirming inside that window activated your email updates.",
  offNoControl: "Use the notification switch above if you’d like to turn update emails back on.",
  restrictedNoControl: "This subscription has a restriction applied at the source.",
} as const;
const MessageFact = factFrame({ rowClassName: "flex min-w-0 flex-wrap items-baseline gap-x-1.5", termClassName: "text-muted-foreground", valueClassName: "min-w-0 wrap-anywhere" });
function DeadlineStatement({ deadlineLabel, expired, id }: { readonly deadlineLabel: string; readonly expired: boolean; readonly id: string }): ReactElement {
  const sentence = CONFIRMATION_DEADLINE_COPY(deadlineLabel, expired);
  const at = sentence.indexOf(deadlineLabel);
  return at <= 0 ? (
    <p {...{ id, className: "text-sm text-pretty text-muted-foreground" }}>{sentence}</p>
  ) : (
    <p id={id} className="text-sm text-pretty text-muted-foreground">
      {sentence.slice(0, at)}
      <bdi className="mono-identifier">{deadlineLabel}</bdi>
      {sentence.slice(at + deadlineLabel.length)}
    </p>
  );
}
function MembershipFacts({ membership }: { readonly membership: ProofMembership }): ReactElement | null {
  const facts = [
    { term: SURFACE_COPY.addressFact, value: (membership.email ?? "").trim(), valueClassName: "min-w-0 wrap-anywhere" },
    { term: SURFACE_COPY.languageFact, value: (membership.languagePreference ?? "").trim() },
  ].filter((fact) => fact.value !== "");
  if (facts.length === 0) return null;
  return <FactList className="flex min-w-0 flex-col gap-1 text-sm" rowClassName="flex min-w-0 flex-wrap items-baseline gap-x-1.5" termClassName="text-muted-foreground" valueClassName="min-w-0" facts={facts.map((fact) => ({ ...fact, value: <bdi>{fact.value}</bdi> }))} />;
}
type ReceiptProps = { readonly outcome: MutationOutcome; readonly headingLevel: 3 | 4; readonly fieldLabels: Readonly<Record<string, string>>; readonly onCheckResult: (() => void) | undefined; readonly onRetrySameWork: () => void; readonly onReapply: () => void };
const Receipt = ({ outcome, headingLevel, fieldLabels, onCheckResult, onRetrySameWork, onReapply }: ReceiptProps): ReactElement => (
  <OperationResult outcome={outcome} headingLevel={headingLevel} fieldLabels={fieldLabels} onCheckResult={outcome.outcome === "unknown" ? onCheckResult : undefined} onRetrySameWork={outcome.outcome === "unavailable" ? onRetrySameWork : undefined} onReapply={outcome.outcome === "conflict" ? onReapply : undefined} />
);
/** The proof journey for one publisher's Update email: request, tentative acceptance, explicit confirmation, confirmed state. */
export function ProofFlow({ scope, publisherId, publisherLabel, purpose, state, membership, expectedRevision, confirmation, confirmationMessage = null, languagePreference = null, headingLevel = 2, dir, onCheckResult, className }: ProofFlowProps): ReactElement {
  const [titleId, closedReasonId, messageHeadingId, resendReasonId] = [useId(), useId(), useId(), useId()];
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [confirmAttemptFor, setConfirmAttemptFor] = useState<string | null>(null);
  const { mutateAsync: mutateSignup } = useSignupForPurpose();
  const { mutateAsync: mutateConfirm } = useConfirmMembership();
  const submitSignup = useCallback((input: MutationInput<SignupPayload>): Promise<MutationOutcome> => mutateSignup({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutateSignup]);
  const submitConfirm = useCallback((input: MutationInput<ConfirmPayload>): Promise<MutationOutcome> => mutateConfirm({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutateConfirm]);
  const signupReview = useReviewedMutation<SignupPayload>(submitSignup);
  const confirmReview = useReviewedMutation<ConfirmPayload>(submitConfirm);
  const resendReview = useReviewedMutation<SignupPayload>(submitSignup);
  const statedLanguage = languagePreference === null ? null : languagePreference.trim() === "" ? null : languagePreference.trim();
  const deliveredEmail = email.trim();
  const recordedAddress = (membership?.email ?? "").trim();
  const signupInput = useMemo<Omit<MutationInput<SignupPayload>, "operationId">>(
    () => ({ scope, expectedRevision, payload: { publisherId, purpose, email: deliveredEmail, ...(statedLanguage === null ? {} : { languagePreference: statedLanguage }) } }),
    [scope, expectedRevision, publisherId, purpose, deliveredEmail, statedLanguage],
  );
  // Asking for the message again is the request this membership was opened with, sent for the address the record already holds rather than for whatever the form field says: the service answers `unchanged` for a membership that exists, so nothing is created and the acceptance the window runs from stays where the person's own act put it.
  const resendInput = useMemo<Omit<MutationInput<SignupPayload>, "operationId">>(() => ({ scope, expectedRevision, payload: { publisherId, purpose, email: recordedAddress } }), [scope, expectedRevision, publisherId, purpose, recordedAddress]);
  const signupOutcome = signupReview.reviewedIntent !== null && signupReview.reviewedIntent === intentKeyOf(signupInput) ? signupReview.outcome : null;
  const resendOutcome = resendReview.reviewedIntent !== null && resendReview.reviewedIntent === intentKeyOf(resendInput) ? resendReview.outcome : null;
  const confirmOutcome = confirmAttemptFor !== null && membership !== null && confirmAttemptFor === membership.membershipId ? confirmReview.outcome : null;
  const requiresProof = membership !== null && state === "awaiting-proof";
  const windowClosed = requiresProof && confirmation !== undefined && confirmation.state === "expired";
  const deadlineLabel = confirmation === undefined ? null : confirmation.deadline;
  const recordedOutcome = signupReview.outcome;
  const step: ProofStep = membership === null || state === "none" ? "request" : state === "awaiting-proof" && windowClosed ? "confirmation-closed" : state;
  const shownStep: ProofStep = step === "request" && recordedOutcome !== null && (recordedOutcome.outcome === "accepted" || recordedOutcome.outcome === "alreadyAccepted" || recordedOutcome.outcome === "unchanged") ? "awaiting-proof" : step;
  const StepHeading = SECTION_HEADING_TAG[headingLevel];
  const ZoneHeading = ZONE_HEADING_TAG[headingLevel];
  const activeReview = confirmOutcome === null ? (resendOutcome === null ? signupReview : resendReview) : confirmReview;
  const activeOutcome = confirmOutcome ?? resendOutcome ?? signupOutcome;
  const activeOperationId = activeOutcome === null ? null : activeReview.operationId;
  // The one act that opens a membership: the person's own activation of this control. Once the service has recorded it, what the page read is out of date, so the page is asked for its own read again — that is what puts the confirmation control in place without a manual reload. A refusal changed nothing, so nothing is re-read.
  const requestNotices = (): void => {
    void signupReview.submit(signupInput).then((recorded) => {
      if (recorded.outcome === "accepted" || recorded.outcome === "alreadyAccepted" || recorded.outcome === "unchanged") router.refresh();
    });
  };
  // Asking again from the state the membership is already in: the service answers `unchanged` for a membership that exists, so the page is asked to read itself again and state that answer where the request was made, exactly as the first request does.
  const requestMessageAgain = (): void => {
    if (windowClosed || recordedAddress === "") return;
    void resendReview.submit(resendInput).then((recorded) => {
      if (recorded.outcome === "accepted" || recorded.outcome === "alreadyAccepted" || recorded.outcome === "unchanged") router.refresh();
    });
  };
  const confirmAddress = (): void => {
    const target = membership;
    if (target === null || windowClosed) return;
    setConfirmAttemptFor(target.membershipId);
    // Confirmation is the act that changes the state this page read states, and no client query mounts that read, so the route is asked to read itself again rather than leaving the card on its previous step; a refusal changed nothing, so it asks for nothing.
    void confirmReview.submit({ scope, expectedRevision, payload: { membershipId: target.membershipId } }).then((recorded) => {
      if (hasSettled(recorded)) router.refresh();
    });
  };
  // A retry or a re-apply carries out the same act again, so an answer that finally stands leaves the page read out of date for exactly the reason the first press made it so; a refusal changed nothing, so it asks for nothing.
  const settleActiveStep = (run: () => Promise<MutationOutcome | null>): void => {
    void run().then((recorded) => {
      if (hasSettled(recorded)) router.refresh();
    });
  };
  const retryActiveStep = (): void => settleActiveStep(activeReview.retry);
  const reapplyActiveStep = (): void => settleActiveStep(activeReview.reapply);
  return (
    <section aria-labelledby={titleId} dir={dir} data-slot="proof-flow" data-step={shownStep} data-operation-id={activeOperationId === null ? undefined : activeOperationId} className={cn("min-w-0", className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <StepHeading id={titleId}>{PROOF_FLOW_COPY.heading}</StepHeading>
          </CardTitle>
          <CardDescription>
            <bdi className="font-medium text-foreground">{publisherLabel}</bdi>
            {`, ${PURPOSE_LABEL[purpose]}. `}
            {SURFACE_COPY.entitlement}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {shownStep === "request" ? (
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <ZoneHeading className="text-base font-medium">{PROOF_FLOW_COPY.requestStep.label}</ZoneHeading>
                <p className="text-sm text-pretty text-muted-foreground">{PROOF_FLOW_COPY.requestStep.description}</p>
              </div>
              <FormField name={EMAIL_FIELD} label={SURFACE_COPY.emailLabel} description={SURFACE_COPY.emailDescription} error={(signupOutcome !== null && signupOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(signupOutcome) : null)?.byField.email} required>
                {(field) => <Input id={field.id} name={EMAIL_FIELD} type="email" inputMode="email" autoComplete="email" value={email} aria-describedby={field.describedBy} aria-invalid={field.invalid ? true : undefined} onChange={(event) => setEmail(event.target.value)} />}
              </FormField>
              {statedLanguage === null ? null : (
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-sm">
                    {`${SURFACE_COPY.languageFact}: `}
                    <bdi>{statedLanguage}</bdi>
                  </p>
                  <p className="text-sm text-pretty text-muted-foreground">{LANGUAGE_PREFERENCE_COPY.separateFromConsent}</p>
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-2">
                <SimulationLabel effect="mail-submission" />
                <div className="flex flex-wrap items-center gap-2">
                  <Button {...{ type: "button", className: BUTTON_WRAP_CLASS, onClick: requestNotices, disabled: signupReview.pending }}>{signupReview.pending ? `${PROOF_FLOW_COPY.requestStep.label} — working` : PROOF_FLOW_COPY.requestStep.label}</Button>
                </div>
              </div>
            </div>
          ) : null}
          {shownStep === "awaiting-proof" || shownStep === "confirmation-closed" ? (
            <div className="flex min-w-0 flex-col gap-4">
              <StatusBadge {...statusBadgeProps(MEMBERSHIP_STATUS, "awaiting-proof")} className="flex min-w-0 flex-wrap items-center gap-2" />
              <div className="flex min-w-0 flex-col gap-1">
                <ZoneHeading className="text-base font-medium">{PROOF_FLOW_COPY.pendingResult.title}</ZoneHeading>
                <p className="text-sm text-pretty text-muted-foreground">{PROOF_FLOW_COPY.pendingResult.description}</p>
                <p className="text-sm text-pretty text-muted-foreground">{PROOF_FLOW_COPY.expiryStatement}</p>
              </div>
              {membership === null ? null : <MembershipFacts membership={membership} />}
              {deadlineLabel === null ? null : <DeadlineStatement deadlineLabel={deadlineLabel} expired={windowClosed} id={closedReasonId} />}
              {confirmationMessage === null ? null : (
                <section aria-labelledby={messageHeadingId} data-slot="confirmation-message" className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-background p-3">
                  <ZoneHeading id={messageHeadingId} className="text-base font-medium">
                    {PROOF_MESSAGE_COPY.heading}
                  </ZoneHeading>
                  <dl className="flex min-w-0 flex-col gap-1 text-sm">
                    <MessageFact
                      term={PROOF_MESSAGE_COPY.senderLabel}
                      value={
                        <>
                          <bdi>{confirmationMessage.sender.name}</bdi> <bdi>{confirmationMessage.sender.address}</bdi>
                        </>
                      }
                    />
                    <MessageFact term={PROOF_MESSAGE_COPY.toLabel} value={<bdi>{confirmationMessage.to}</bdi>} />
                    <MessageFact term={PROOF_MESSAGE_COPY.subjectLabel} value={confirmationMessage.subject} />
                  </dl>
                  <div className="flex min-w-0 flex-col gap-1">
                    {confirmationMessage.wording.map((paragraph) => (
                      <p key={paragraph} className="text-sm text-pretty">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  <SimulationLabel effect="mail-submission" />
                  <p className="text-sm text-pretty text-muted-foreground">{PROOF_MESSAGE_COPY.renderedHere}</p>
                </section>
              )}
              {membership === null ? (
                <p className="text-sm text-pretty text-muted-foreground">{SURFACE_COPY.awaitingReadback}</p>
              ) : (
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-sm text-pretty text-muted-foreground">{PROOF_FLOW_COPY.confirmAction.description}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" className={BUTTON_WRAP_CLASS} onClick={confirmAddress} disabled={confirmReview.pending || windowClosed} aria-describedby={deadlineLabel === null ? undefined : closedReasonId}>
                      {confirmReview.pending ? `${PROOF_FLOW_COPY.confirmAction.label} — working` : PROOF_FLOW_COPY.confirmAction.label}
                    </Button>
                  </div>
                  {shownStep === "confirmation-closed" ? <p className="text-sm text-pretty text-muted-foreground">{SURFACE_COPY.closedReason}</p> : null}
                  {confirmation === undefined ? <p className="text-sm text-pretty text-muted-foreground">{SURFACE_COPY.noWindowStated}</p> : null}
                </div>
              )}
              {membership === null || recordedAddress === "" ? null : (
                <div className="flex min-w-0 flex-col gap-2">
                  <p id={resendReasonId} className="text-sm text-pretty text-muted-foreground">
                    {PROOF_RESEND_COPY.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" className={BUTTON_WRAP_CLASS} onClick={requestMessageAgain} disabled={resendReview.pending || windowClosed} aria-describedby={resendReasonId}>
                      {resendReview.pending ? `${PROOF_RESEND_COPY.label} — working` : PROOF_RESEND_COPY.label}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {shownStep === "active" ? (
            <div className="flex min-w-0 flex-col gap-4">
              <StatusBadge {...statusBadgeProps(MEMBERSHIP_STATUS, "active")} className="flex min-w-0 flex-wrap items-center gap-2" />
              <div className="flex min-w-0 flex-col gap-1">
                <ZoneHeading className="text-base font-medium">{PROOF_FLOW_COPY.confirmedState.title}</ZoneHeading>
                <p className="text-sm text-pretty text-muted-foreground">{PROOF_FLOW_COPY.confirmedState.description}</p>
              </div>
              {membership === null ? null : <MembershipFacts membership={membership} />}
              {deadlineLabel === null ? null : (
                <p className="text-sm text-pretty text-muted-foreground">
                  {`${SURFACE_COPY.storedWindowLead} `}
                  <bdi className="mono-identifier">{deadlineLabel}</bdi>
                  {`. ${SURFACE_COPY.storedWindowTail}`}
                </p>
              )}
            </div>
          ) : null}
          {shownStep === "off" || shownStep === "restricted" ? (
            <div className="flex min-w-0 flex-col gap-4">
              <StatusBadge {...statusBadgeProps(MEMBERSHIP_STATUS, shownStep)} className="flex min-w-0 flex-wrap items-center gap-2" />
              <p className="text-sm text-pretty text-muted-foreground">{MEMBERSHIP_STATE_DESCRIPTIONS[shownStep].description}</p>
              {membership === null ? null : <MembershipFacts membership={membership} />}
              <p className="text-sm text-pretty text-muted-foreground">{shownStep === "off" ? SURFACE_COPY.offNoControl : SURFACE_COPY.restrictedNoControl}</p>
            </div>
          ) : null}
          {activeOutcome === null ? null : <Receipt outcome={activeOutcome} headingLevel={headingLevel === 2 ? 3 : 4} fieldLabels={confirmOutcome === null ? SIGNUP_FIELD_LABELS : CONFIRM_FIELD_LABELS} onCheckResult={onCheckResult} onRetrySameWork={retryActiveStep} onReapply={reapplyActiveStep} />}
        </CardContent>
      </Card>
    </section>
  );
}
export default ProofFlow;
