"use client";
/**
 * The tiny synthetic proof journey for one publisher's Update email: the deliberate request that records a
 * membership awaiting proof, the neutral pending result that claims no message was sent or delivered, the
 * confirmation the person makes themselves inside the fixed 168-elapsed-hour window, and the confirmed state.
 *
 * **Authority.** AAP 0.10.1 family 10 ("a tiny proof flow with a 168-hour confirmation window"); AAP 0.8.5 for
 * the four membership states, the Off/Immediate pair this flow never widens, and the rule that a subscribed-style
 * flag is not consent; AAP 0.8.7 for the boundary itself — confirmation expires 168 elapsed hours after
 * acceptance, strict at equality, and a reload, a retry or a resent message never extends it; AAP 0.7.1 for the
 * four-field mutation input and the closed eight-outcome set; AAP 0.12.1 criterion 10.
 *
 * **What this surface never does.** It confirms nothing by being rendered, opened, reloaded, re-read or
 * previewed: the one call to `confirmMembership` is bound to the Confirm control's own activation. There is no
 * effect, no mount-time request, no query callback and no refresh handler that reaches a mutation. The window is
 * displayed from what the service states and never computed here, so there is no clock read and no second
 * arithmetic behind the deadline. There is no token, verification code or signed link, because the confirmation
 * is identified by the membership and the person's explicit act alone. Nothing here says a message was sent,
 * delivered or read: notice sending is simulated, and the label beside the request control says exactly that.
 */
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import { intentKeyOf, useReviewedMutation } from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import SimulationLabel from "@/components/simulation-label";
import StatusBadge, { MEMBERSHIP_STATUS, statusBadgeProps, type MembershipStatus } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MEMBERSHIP_STATE_DESCRIPTIONS, PURPOSE_LABEL } from "@/features/audience/copy/membership";
import { CONFIRMATION_DEADLINE_COPY, LANGUAGE_PREFERENCE_COPY, PROOF_FLOW_COPY } from "@/features/audience/copy/preferences";
import { useConfirmMembership, useSignupForPurpose } from "@/features/audience/hooks/use-audience-mutations";
import type { ConfirmPayload, SignupPayload } from "@/features/audience/schemas/confirmation";
import { cn } from "@/lib/cn";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
/** The membership state the preferences read states, including `none` for a reader who holds no membership yet. */
export type ProofMembershipState = MembershipStatus | "none";
/**
 * The confirmation window as the service reports it at the instant the read ran: `open`, `expired` or
 * `not-awaiting-proof`, with the deadline instant the acceptance recorded. This surface reads that state and
 * never decides it, so no clock, no arithmetic and no time-zone assumption sits behind the wording.
 */
export type ProofConfirmationWindow = { readonly state: "open" | "expired" | "not-awaiting-proof"; readonly deadline: string | null };
/** The membership this journey addresses: the record's identity, the address it is set for and the language it records. */
export type ProofMembership = { readonly membershipId: string; readonly email: string | null; readonly languagePreference: string | null };
export type ProofFlowProps = {
  readonly scope: Scope;
  readonly publisherId: string;
  readonly publisherLabel: string;
  /** The family's one purpose, supplied by the route so this surface states no second copy of the constant. */
  readonly purpose: SignupPayload["purpose"];
  /** The state the read reports for this publisher and purpose; `none` means no membership exists yet. */
  readonly state: ProofMembershipState;
  /** The membership itself, or `null` when the reader holds none for this publisher and purpose. */
  readonly membership: ProofMembership | null;
  /** The revision the read returned: both steps present it as the revision they act on. */
  readonly expectedRevision: string;
  /** The window the service resolved for this membership, absent when the read supplied none. */
  readonly confirmation?: ProofConfirmationWindow;
  /** The reading language the family's own control states, when the route composes one; a language is never consent. */
  readonly languagePreference?: string | null;
  readonly headingLevel?: 2 | 3 | 4;
  /** The display direction the route composition states; it is set on this block only, never on a child's styles. */
  readonly dir?: "ltr" | "rtl";
  /** Re-reads the membership, which is the only recovery an undetermined outcome offers. */
  readonly onCheckResult?: () => void;
  readonly className?: string;
};
/** The step the journey stands on, derived from the read's state and the service's own window flag. */
type ProofStep = "request" | "awaiting-proof" | "confirmation-closed" | "active" | "off" | "restricted";
const SECTION_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
const ZONE_HEADING_TAG = { 2: "h3", 3: "h4", 4: "h4" } as const;
const EMAIL_FIELD = "email";
const SIGNUP_FIELD_LABELS: Readonly<Record<string, string>> = { email: "Email address", publisherId: "Publisher", purpose: "Purpose", displayName: "Display name", languagePreference: "Reading language" };
const CONFIRM_FIELD_LABELS: Readonly<Record<string, string>> = { membershipId: "The membership this confirmation applies to" };
/**
 * The two action controls' sizing, matching the shared notice and receipt controls: a label that wraps inside a
 * phone-width card instead of being clipped by it, at the same 36 px height a default control keeps.
 */
const CONTROL_CLASS = "h-auto min-h-9 max-w-full py-2 whitespace-normal";
/** The wording the family copy module does not own, gathered once so this file states no sentence twice. */
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
/**
 * Which step the journey stands on. The closed branch is taken only from the service's own flag: the component
 * reads `expired` and never infers it from a comparison of its own.
 */
function stepOf(membership: ProofMembership | null, state: ProofMembershipState, windowClosed: boolean): ProofStep {
  if (membership === null) return "request";
  switch (state) {
    case "awaiting-proof":
      return windowClosed ? "confirmation-closed" : "awaiting-proof";
    case "active":
      return "active";
    case "off":
      return "off";
    case "restricted":
      return "restricted";
    case "none":
      return "request";
  }
}
/**
 * One deadline sentence with the recorded instant isolated, so a right-to-left reading keeps the value whole
 * instead of reordering its parts. The sentence itself is the family copy module's; this only wraps the value.
 */
function DeadlineStatement({ deadlineLabel, expired, id }: { readonly deadlineLabel: string; readonly expired: boolean; readonly id: string }): ReactElement {
  const sentence = CONFIRMATION_DEADLINE_COPY(deadlineLabel, expired);
  const at = sentence.indexOf(deadlineLabel);
  if (at <= 0) {
    return (
      <p id={id} className="text-sm text-pretty text-muted-foreground">
        {sentence}
      </p>
    );
  }
  return (
    <p id={id} className="text-sm text-pretty text-muted-foreground">
      {sentence.slice(0, at)}
      <bdi className="mono-identifier">{deadlineLabel}</bdi>
      {sentence.slice(at + deadlineLabel.length)}
    </p>
  );
}
/** The facts a membership states, each value isolated so a mixed-direction surface keeps it whole. */
function MembershipFacts({ membership }: { readonly membership: ProofMembership }): ReactElement | null {
  const address = membership.email === null ? "" : membership.email.trim();
  const language = membership.languagePreference === null ? "" : membership.languagePreference.trim();
  if (address === "" && language === "") return null;
  return (
    <dl className="flex min-w-0 flex-col gap-1 text-sm">
      {address === "" ? null : (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <dt className="text-muted-foreground">{SURFACE_COPY.addressFact}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <bdi>{address}</bdi>
          </dd>
        </div>
      )}
      {language === "" ? null : (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <dt className="text-muted-foreground">{SURFACE_COPY.languageFact}</dt>
          <dd className="min-w-0">
            <bdi>{language}</bdi>
          </dd>
        </div>
      )}
    </dl>
  );
}
interface ReceiptProps {
  readonly outcome: MutationOutcome;
  readonly headingLevel: 3 | 4;
  readonly fieldLabels: Readonly<Record<string, string>>;
  readonly onCheckResult: (() => void) | undefined;
  readonly onRetrySameWork: () => void;
  readonly onReapply: () => void;
}
/**
 * The one receipt for the step that was taken. Each recovery is offered only where it is honest: an undetermined
 * outcome offers the read that reports what happened and never a second send under a fresh identity, an outage
 * re-requests the same operation so a change that had arrived answers with its original result, and a conflict
 * offers the caller's preserved input beside the revision the record now stands at.
 */
function Receipt({ outcome, headingLevel, fieldLabels, onCheckResult, onRetrySameWork, onReapply }: ReceiptProps): ReactElement {
  return (
    <OperationResult outcome={outcome} headingLevel={headingLevel} fieldLabels={fieldLabels} onCheckResult={outcome.outcome === "unknown" ? onCheckResult : undefined} onRetrySameWork={outcome.outcome === "unavailable" ? onRetrySameWork : undefined} onReapply={outcome.outcome === "conflict" ? onReapply : undefined} />
  );
}
/** The proof journey for one publisher's Update email: request, tentative acceptance, explicit confirmation, confirmed state. */
export function ProofFlow({ scope, publisherId, publisherLabel, purpose, state, membership, expectedRevision, confirmation, languagePreference = null, headingLevel = 2, dir, onCheckResult, className }: ProofFlowProps): ReactElement {
  const titleId = useId();
  const closedReasonId = useId();
  const [email, setEmail] = useState("");
  // The membership this page's own confirm attempt addressed. The receipt is shown for that membership only, so a
  // later read cannot present one membership's outcome beside another's, and a refetch after an acceptance (which
  // changes the revision) never discards the record of what the person's own act produced.
  const [confirmAttemptFor, setConfirmAttemptFor] = useState<string | null>(null);
  const { mutateAsync: mutateSignup } = useSignupForPurpose();
  const { mutateAsync: mutateConfirm } = useConfirmMembership();
  // The attempt's identity is never minted here: useReviewedMutation owns it, so a repeat of one intent reuses one
  // operationId and a changed intent draws a new one.
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
  // A request the service accepted has already recorded an awaiting-proof membership. Until the read returns that
  // membership, the pending result is stated instead of the form, so an accepted request never looks unrecorded and a
  // second, pointless request is not offered. This reads the whole receipt rather than the intent-guarded one above:
  // editing the address afterwards must not make a request that was already recorded look unrecorded again.
  const recordedOutcome = signupReview.outcome;
  const requestRecorded = recordedOutcome !== null && (recordedOutcome.outcome === "accepted" || recordedOutcome.outcome === "alreadyAccepted" || recordedOutcome.outcome === "unchanged");
  const step = stepOf(membership, state, windowClosed);
  const shownStep: ProofStep = step === "request" && requestRecorded ? "awaiting-proof" : step;
  const StepHeading = SECTION_HEADING_TAG[headingLevel];
  const ZoneHeading = ZONE_HEADING_TAG[headingLevel];
  const receiptHeading = headingLevel === 2 ? 3 : 4;
  const signupFieldErrors = signupOutcome !== null && signupOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(signupOutcome) : null;
  const activeOutcome = confirmOutcome ?? signupOutcome;
  const activeOperationId = confirmOutcome === null ? (signupOutcome === null ? null : signupReview.operationId) : confirmReview.operationId;
  const requestNotices = (): void => {
    // The only act that opens a membership: the person's own activation of this control.
    void signupReview.submit(signupInput);
  };
  const confirmAddress = (): void => {
    // The only call to confirmMembership in this component, reachable from the Confirm control's activation alone.
    const target = membership;
    if (target === null || windowClosed) return;
    setConfirmAttemptFor(target.membershipId);
    void confirmReview.submit({ scope, expectedRevision, payload: { membershipId: target.membershipId } });
  };
  const retryActiveStep = (): void => {
    if (confirmOutcome === null) {
      void signupReview.retry();
      return;
    }
    void confirmReview.retry();
  };
  const reapplyActiveStep = (): void => {
    if (confirmOutcome === null) {
      void signupReview.reapply();
      return;
    }
    void confirmReview.reapply();
  };
  return (
    <section aria-labelledby={titleId} dir={dir} data-slot="proof-flow" data-step={shownStep} data-operation-id={activeOperationId === null ? undefined : activeOperationId} className={cn("min-w-0", className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <StepHeading id={titleId}>{PROOF_FLOW_COPY.heading}</StepHeading>
          </CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground">
              <bdi>{publisherLabel}</bdi>
            </span>
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
              <FormField name={EMAIL_FIELD} label={SURFACE_COPY.emailLabel} description={SURFACE_COPY.emailDescription} error={signupFieldErrors?.byField.email} required>
                {(field) => (
                  <Input
                    id={field.id}
                    name={EMAIL_FIELD}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    // Paste is never intercepted: an address copied elsewhere is entered exactly as one typed here.
                    value={email}
                    aria-describedby={field.describedBy}
                    aria-invalid={field.invalid ? true : undefined}
                    onChange={(event) => {
                      setEmail(event.target.value);
                    }}
                  />
                )}
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
                  <Button type="button" className={CONTROL_CLASS} onClick={requestNotices} disabled={signupReview.pending}>
                    {signupReview.pending ? `${PROOF_FLOW_COPY.requestStep.label} — working` : PROOF_FLOW_COPY.requestStep.label}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {shownStep === "awaiting-proof" || shownStep === "confirmation-closed" ? (
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusBadge {...statusBadgeProps(MEMBERSHIP_STATUS, "awaiting-proof")} />
              </div>
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
                    <Button type="button" className={CONTROL_CLASS} onClick={confirmAddress} disabled={confirmReview.pending || windowClosed} aria-describedby={deadlineLabel === null ? undefined : closedReasonId}>
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
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusBadge {...statusBadgeProps(MEMBERSHIP_STATUS, "active")} />
              </div>
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
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusBadge {...statusBadgeProps(MEMBERSHIP_STATUS, shownStep)} />
              </div>
              <p className="text-sm text-pretty text-muted-foreground">{MEMBERSHIP_STATE_DESCRIPTIONS[shownStep].description}</p>
              {membership === null ? null : <MembershipFacts membership={membership} />}
              <p className="text-sm text-pretty text-muted-foreground">{shownStep === "off" ? SURFACE_COPY.offNoControl : SURFACE_COPY.restrictedNoControl}</p>
            </div>
          ) : null}
          {activeOutcome === null ? null : <Receipt outcome={activeOutcome} headingLevel={receiptHeading} fieldLabels={confirmOutcome === null ? SIGNUP_FIELD_LABELS : CONFIRM_FIELD_LABELS} onCheckResult={onCheckResult} onRetrySameWork={retryActiveStep} onReapply={reapplyActiveStep} />}
        </CardContent>
      </Card>
    </section>
  );
}
export default ProofFlow;
