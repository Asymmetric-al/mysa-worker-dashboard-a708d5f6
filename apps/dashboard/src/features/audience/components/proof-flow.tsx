"use client";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import { intentKeyOf, useReviewedMutation } from "@/components/action-review";
import { hasSettled } from "@/components/attempt";
import FormField, { fieldErrorsFromInvalid } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import SimulationLabel from "@/components/simulation-label";
import StatusBadge, { MEMBERSHIP_STATUS, statusBadgeProps, type MembershipStatus } from "@/components/status-badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MEMBERSHIP_STATE_DESCRIPTIONS, PURPOSE_LABEL } from "@/features/audience/copy/membership";
import { CONFIRMATION_DEADLINE_COPY, LANGUAGE_PREFERENCE_COPY, PROOF_FLOW_COPY } from "@/features/audience/copy/preferences";
import { useConfirmMembership, useSignupForPurpose } from "@/features/audience/hooks/use-audience-mutations";
import type { ConfirmPayload, SignupPayload } from "@/features/audience/schemas/confirmation";
import { cn } from "@/lib/cn";
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
  entitlement: "One membership, for this publisher and this purpose only. No other publisher, no other purpose and no other record about you changes here.",
  emailLabel: "Email address",
  emailDescription: "The address this membership is set for. It is stored as a value on the membership and is never used to look up, match or merge another record.",
  addressFact: "Address on this membership",
  languageFact: "Reading language recorded for this publisher",
  awaitingReadback: "Nothing on this page confirmed the address: confirmation is the person's own act, and the control appears here once the service has read this membership back as awaiting proof.",
  closedReason: "The service reports this window as closed, so this address cannot be confirmed now. The control stays in place and disabled, so a closed window is never mistaken for a missing action.",
  noWindowStated: "This surface was given no window state, so the control asks the service, which refuses a confirmation outside the window the acceptance recorded.",
  storedWindowLead: "The acceptance recorded for this address set its confirmation window to end at",
  storedWindowTail: "Confirming inside that window is what made this membership active. That window is neither a delivery nor a reading.",
  offNoControl: "Changing that choice is the person's own act on the preferences surface, so this flow offers no control that would turn notices on.",
  restrictedNoControl: "A restriction is not a preference, and confirming an address never clears one, so this flow offers no control here.",
} as const;
function DeadlineStatement({ deadlineLabel, expired, id }: { readonly deadlineLabel: string; readonly expired: boolean; readonly id: string }): ReactElement {
  const sentence = CONFIRMATION_DEADLINE_COPY(deadlineLabel, expired);
  const at = sentence.indexOf(deadlineLabel);
  return at <= 0 ? (
    <p id={id} className="text-sm text-pretty text-muted-foreground">
      {sentence}
    </p>
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
    { label: SURFACE_COPY.addressFact, value: (membership.email ?? "").trim(), reference: true },
    { label: SURFACE_COPY.languageFact, value: (membership.languagePreference ?? "").trim(), reference: false },
  ].filter((fact) => fact.value !== "");
  if (facts.length === 0) return null;
  return (
    <dl className="flex min-w-0 flex-col gap-1 text-sm">
      {facts.map((fact) => (
        <div key={fact.label} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <dt className="text-muted-foreground">{fact.label}</dt>
          <dd className={fact.reference ? "min-w-0 wrap-anywhere" : "min-w-0"}>
            <bdi>{fact.value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
type ReceiptProps = { readonly outcome: MutationOutcome; readonly headingLevel: 3 | 4; readonly fieldLabels: Readonly<Record<string, string>>; readonly onCheckResult: (() => void) | undefined; readonly onRetrySameWork: () => void; readonly onReapply: () => void };
const Receipt = ({ outcome, headingLevel, fieldLabels, onCheckResult, onRetrySameWork, onReapply }: ReceiptProps): ReactElement => (
  <OperationResult outcome={outcome} headingLevel={headingLevel} fieldLabels={fieldLabels} onCheckResult={outcome.outcome === "unknown" ? onCheckResult : undefined} onRetrySameWork={outcome.outcome === "unavailable" ? onRetrySameWork : undefined} onReapply={outcome.outcome === "conflict" ? onReapply : undefined} />
);
/** The proof journey for one publisher's Update email: request, tentative acceptance, explicit confirmation, confirmed state. */
export function ProofFlow({ scope, publisherId, publisherLabel, purpose, state, membership, expectedRevision, confirmation, languagePreference = null, headingLevel = 2, dir, onCheckResult, className }: ProofFlowProps): ReactElement {
  const titleId = useId();
  const closedReasonId = useId();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [confirmAttemptFor, setConfirmAttemptFor] = useState<string | null>(null);
  const { mutateAsync: mutateSignup } = useSignupForPurpose();
  const { mutateAsync: mutateConfirm } = useConfirmMembership();
  const submitSignup = useCallback((input: MutationInput<SignupPayload>): Promise<MutationOutcome> => mutateSignup({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutateSignup]);
  const submitConfirm = useCallback((input: MutationInput<ConfirmPayload>): Promise<MutationOutcome> => mutateConfirm({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutateConfirm]);
  const signupReview = useReviewedMutation<SignupPayload>(submitSignup);
  const confirmReview = useReviewedMutation<ConfirmPayload>(submitConfirm);
  const statedLanguage = languagePreference === null ? null : languagePreference.trim() === "" ? null : languagePreference.trim();
  const deliveredEmail = email.trim();
  const signupInput = useMemo<Omit<MutationInput<SignupPayload>, "operationId">>(
    () => ({ scope, expectedRevision, payload: { publisherId, purpose, email: deliveredEmail, ...(statedLanguage === null ? {} : { languagePreference: statedLanguage }) } }),
    [scope, expectedRevision, publisherId, purpose, deliveredEmail, statedLanguage],
  );
  const signupOutcome = signupReview.reviewedIntent !== null && signupReview.reviewedIntent === intentKeyOf(signupInput) ? signupReview.outcome : null;
  const confirmOutcome = confirmAttemptFor !== null && membership !== null && confirmAttemptFor === membership.membershipId ? confirmReview.outcome : null;
  const requiresProof = membership !== null && state === "awaiting-proof";
  const windowClosed = requiresProof && confirmation !== undefined && confirmation.state === "expired";
  const deadlineLabel = confirmation === undefined ? null : confirmation.deadline;
  const recordedOutcome = signupReview.outcome;
  const step: ProofStep = membership === null || state === "none" ? "request" : state === "awaiting-proof" && windowClosed ? "confirmation-closed" : state;
  const shownStep: ProofStep = step === "request" && recordedOutcome !== null && (recordedOutcome.outcome === "accepted" || recordedOutcome.outcome === "alreadyAccepted" || recordedOutcome.outcome === "unchanged") ? "awaiting-proof" : step;
  const StepHeading = SECTION_HEADING_TAG[headingLevel];
  const ZoneHeading = ZONE_HEADING_TAG[headingLevel];
  const activeOutcome = confirmOutcome ?? signupOutcome;
  const activeOperationId = confirmOutcome === null ? (signupOutcome === null ? null : signupReview.operationId) : confirmReview.operationId;
  // The one act that opens a membership: the person's own activation of this control. Once the service has recorded it, what the page read is out of date, so the page is asked for its own read again — that is what puts the confirmation control in place without a manual reload. A refusal changed nothing, so nothing is re-read.
  const requestNotices = (): void => {
    void signupReview.submit(signupInput).then((recorded) => {
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
  const retryActiveStep = (): void => settleActiveStep(confirmOutcome === null ? signupReview.retry : confirmReview.retry);
  const reapplyActiveStep = (): void => settleActiveStep(confirmOutcome === null ? signupReview.reapply : confirmReview.reapply);
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
                  <Button type="button" className={BUTTON_WRAP_CLASS} onClick={requestNotices} disabled={signupReview.pending}>
                    {signupReview.pending ? `${PROOF_FLOW_COPY.requestStep.label} — working` : PROOF_FLOW_COPY.requestStep.label}
                  </Button>
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
