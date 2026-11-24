"use client";
import { useCallback, useId, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import StateNotice from "@/components/state-notice";
import StatusBadge, { COACHING_STATUS, statusBadgeProps, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MODULE_KEYS, type GrantLifecycleState } from "@/modules/coaching/grant";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { GRANT_STATE_COPY, MODULE_COPY, SHARING_OUTCOME_COPY, type SharingOutcomeId } from "../copy";
import { useAcceptInvitation, useCoachPortfolio } from "../hooks/use-coaching";
import type { AcceptancePayload } from "../schemas";
import { Panel } from "./panel";
import { Fact, OUTCOME_STAGE_NAME, OUTCOME_STATE_FIELD, outcomeWord } from "./sharing-summary";
import type { SharingOutcome, SharingOutcomeSet } from "./sharing-summary";
const INVITATION_STATES = ["delivered", "superseded", "already-accepted", "expired", "revoked"] as const;
type InvitationState = (typeof INVITATION_STATES)[number];
// The invitation this surface states is the invitation the coach portfolio read itself answers with: only its standing is widened, so every fact below is that read's own field rather than a second shape kept in step with it here.
type PendingInvitation = Extract<NonNullable<ReturnType<typeof useCoachPortfolio>["data"]>, { readonly kind: "envelope" }>["envelope"]["data"]["pendingInvitations"][number];
type InvitationSummary = Omit<PendingInvitation, "state"> & { readonly state: InvitationState };
export type CoachAcceptanceProps = { readonly invitation: InvitationSummary | null; readonly outcomes: SharingOutcomeSet; readonly scope: Scope; readonly expectedRevision: string; readonly holdsNoSubjects: boolean };
type AcceptInput = Omit<MutationInput<AcceptancePayload>, "operationId">;
type NoticeCopy = { readonly title: string; readonly description: string };
const LIFECYCLE_OF: Readonly<Record<InvitationState, GrantLifecycleState>> = { delivered: "invited", superseded: "superseded", "already-accepted": "accepted", expired: "expired", revoked: "revoked" };
const OUTCOME_TONE: Readonly<Record<SharingOutcome, StatusTone>> = { reached: "positive", "not-reached": "muted", unknown: "caution" };
const OUTCOME_STATE_SENTENCE: Readonly<Record<SharingOutcomeId, Readonly<Record<SharingOutcome, string>>>> = {
  delivery: {
    reached: "The invitation is recorded here and names the recipient, the organization, the ministry, the modules and the duration.",
    "not-reached": "No invitation is recorded, so there is nothing here for you to accept.",
    unknown: "Whether the invitation was recorded cannot be confirmed from here, so this page claims neither.",
  },
  "identity-verification": { reached: "The account you are acting in was verified as the named recipient's.", "not-reached": "The account you are acting in has not been verified as the named recipient's, so accepting would open nothing.", unknown: "Whether this account was verified cannot be confirmed from here." },
  "deliberate-acceptance": {
    reached: "Your decision is recorded. Nothing is readable to you until access is live.",
    "not-reached": "No acceptance is recorded: opening this page, or following the link that brought you here, accepts nothing.",
    unknown: "An acceptance may or may not have been recorded, and this page does not say which.",
  },
  "active-access": { reached: "You can read the modules the worker switched on, inside the dates the invitation names.", "not-reached": "Nothing is readable yet, and accepting on its own switches no module on.", unknown: "Whether access is live cannot be confirmed from here." },
};
const SURFACE_COPY = {
  heading: "Your coaching invitation",
  purpose: "This invitation names you, the organization, the ministry, the modules and the duration. Reading it, or following the link that brought you here, shares nothing: where the invitation actually stands is stated below, one outcome at a time.",
  factTerms: { recipient: "Named recipient", organization: "Organization", ministry: "Ministry", duration: "Duration", grant: "Invitation" },
  notAcceptedSentence: "You have not accepted yet. Your own decision is what moves this invitation on, and it shares nothing by itself.",
  modulesHeading: "Modules this invitation names",
  noModulesSentence: "This invitation names no module, so nothing would be readable even after you accept it.",
  modulesNote: "Modules start switched off. Acceptance on its own makes nothing readable: only the modules the worker switches on can be read, and only inside the dates named.",
  deliberateTitle: "Accepting is your own decision",
  deliberateBody: "Accepting belongs to the named recipient and is a deliberate act, not a side effect of opening this page. No permission follows from an email address that matches, from a link that opens, from an existing relationship or from a job title.",
  readOnlySentence: "Your access is read-only: nothing on this page changes the worker's own work.",
  acceptTitle: "Accept this coaching invitation",
  acceptDescription: "Accepting records your decision as the named recipient. It shares nothing on its own, and it sends no message.",
  acceptConsequence: "Access begins only when the grant is active, and only for the modules the worker switches on, inside the dates the invitation names.",
  acceptContainment: "Nothing else changes: your acceptance alters no worker record and opens no module by itself.",
  accessNotYetSentence: "Access does not begin with this acceptance: it begins only when the grant is active, and only for the modules the worker switches on.",
  acceptLabel: "Accept this invitation",
  cancelLabel: "Cancel",
} as const;
const NOTICE_COPY: Readonly<Record<Exclude<InvitationState, "delivered">, NoticeCopy>> = {
  "already-accepted": { title: "You have already accepted this invitation", description: "Your decision is recorded, so there is nothing left to accept here. Access begins only when the grant is active, and only for the modules the worker switches on; opening this page again accepts nothing further." },
  superseded: { title: "A newer invitation replaced this one", description: "It was replaced before it was accepted, so it cannot be accepted now and nothing was shared under it. Open the newest invitation the worker sent you, because nothing here can bring this one back." },
  expired: { title: "This invitation reached its agreed end", description: "The dates this invitation named have passed, so it can no longer be accepted and nothing is readable under it. A new invitation from the worker is what begins a relationship." },
  revoked: { title: "This invitation was revoked", description: "The worker revoked this grant, so it can no longer be accepted and no further read is allowed under it. Revoking stops access; it does not take back what was read before, and only a new invitation begins again." },
};
// The acceptance fact and the portfolio's emptiness are two different facts, and the portfolio card above states the emptiness once when that is what its read returned: both notices below therefore state only where the acceptance stands, and neither repeats what the portfolio says about what is shared.
const NO_PENDING_INVITATION_SENTENCE = "No invitation addressed to you is awaiting acceptance, so nothing on this page asks you to accept anything.";
const NO_INVITATION_COPY: NoticeCopy = { title: "No coaching invitation for this account", description: `${NO_PENDING_INVITATION_SENTENCE} Opening this page accepts nothing, and a matching email address grants nothing either.` };
const NO_ACCEPTANCE_COPY: NoticeCopy = { title: "No invitation is waiting for your acceptance", description: `${NO_PENDING_INVITATION_SENTENCE} The access you hold as this worker's coach is what the portfolio reports, and nothing here adds to it or takes any of it away.` };
const MUTED_TEXT_CLASS = "type-supporting text-pretty";
// An invitation names its organization and ministry from the records the worker's own admission states; where those records carry neither a label nor an identifier, this surface says so rather than leaving the row blank.
const NO_ORGANIZATION_SENTENCE = "The records state neither an organization label nor an organization identifier for this invitation, so neither is shown here.";
const TRAILING_DIGITS = /(\d+)\s*$/u;
function revisionOrdinal(revision: string): number {
  const digits = TRAILING_DIGITS.exec(revision);
  const parsed = digits === null ? Number.NaN : Number.parseInt(digits[1] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
/** The ministries one invitation names, each beside its own identifier: a label alone would be a name this page matched across records, and an identifier alone names nothing a person can read. */ const MinistryFacts = ({ ministries }: { readonly ministries: InvitationSummary["ministries"] }): ReactElement =>
  ministries.length === 0 ? (
    <span className={MUTED_TEXT_CLASS}>{"This invitation's record names no ministry, so none is shown here."}</span>
  ) : (
    <span className="flex min-w-0 flex-col gap-1">
      {ministries.map((ministry) => (
        <span key={ministry.ministryId} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          {ministry.ministryLabel === null ? null : <bdi>{ministry.ministryLabel}</bdi>}
          <bdi className="mono-identifier">{ministry.ministryId}</bdi>
        </span>
      ))}
    </span>
  );
function InvitationFacts({ invitation, lifecycle }: { readonly invitation: InvitationSummary; readonly lifecycle: GrantLifecycleState }): ReactElement {
  const [headingId, modulesId] = [useId(), useId()];
  const namedModules = MODULE_KEYS.filter((key) => invitation.modules.includes(key));
  const lifecycleCopy = GRANT_STATE_COPY[lifecycle];
  const { organizationId, organizationLabel } = invitation;
  return (
    <section aria-labelledby={headingId} data-slot="coach-acceptance-invitation" className="min-w-0">
      <Panel titleId={headingId} title={SURFACE_COPY.heading} description={SURFACE_COPY.purpose} action={<StatusBadge label={lifecycleCopy.label} tone={statusBadgeProps(COACHING_STATUS, lifecycle).tone} srPrefix="Invitation state" />} contentClassName="flex min-w-0 flex-col gap-4">
        <dl className="flex min-w-0 flex-col gap-2 text-sm">
          <Fact term={SURFACE_COPY.factTerms.recipient}>
            <bdi className="mono-identifier">{invitation.recipientPrincipalId}</bdi>
          </Fact>
          <Fact term={SURFACE_COPY.factTerms.organization}>
            {organizationLabel === null && organizationId === null ? (
              <span className={MUTED_TEXT_CLASS}>{NO_ORGANIZATION_SENTENCE}</span>
            ) : (
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                {organizationLabel === null ? null : <bdi>{organizationLabel}</bdi>}
                {organizationId === null ? null : <bdi className="mono-identifier">{organizationId}</bdi>}
              </span>
            )}
          </Fact>
          <Fact term={SURFACE_COPY.factTerms.ministry}>
            <MinistryFacts ministries={invitation.ministries} />
          </Fact>
          <Fact term={SURFACE_COPY.factTerms.duration}>
            <bdi>{invitation.durationLabel}</bdi>
          </Fact>
          <Fact term={SURFACE_COPY.factTerms.grant}>
            <bdi className="mono-identifier">{invitation.grantId}</bdi>
          </Fact>
        </dl>
        {lifecycle === "invited" ? <p className={MUTED_TEXT_CLASS}>{SURFACE_COPY.notAcceptedSentence}</p> : null}
        <Separator />
        <section aria-labelledby={modulesId} className="flex min-w-0 flex-col gap-2">
          <h3 {...{ id: modulesId, className: "type-subsection-title" }}>{SURFACE_COPY.modulesHeading}</h3>
          {namedModules.length === 0 ? (
            <p className={MUTED_TEXT_CLASS}>{SURFACE_COPY.noModulesSentence}</p>
          ) : (
            <ul className="flex min-w-0 flex-wrap items-center gap-1">
              {namedModules.map((key) => (
                <li key={key}>
                  <Badge variant="secondary" className="h-auto max-w-full whitespace-normal">
                    <bdi>{MODULE_COPY[key].name}</bdi>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className={MUTED_TEXT_CLASS}>{SURFACE_COPY.modulesNote}</p>
        </section>
        <Separator />
        <Alert role={undefined}>
          <AlertTitle>{SURFACE_COPY.deliberateTitle}</AlertTitle>
          <AlertDescription>
            <p>{SURFACE_COPY.deliberateBody}</p>
            <p>{SURFACE_COPY.readOnlySentence}</p>
          </AlertDescription>
        </Alert>
      </Panel>
    </section>
  );
}
function OutcomeStanding({ outcomes }: { readonly outcomes: SharingOutcomeSet }): ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-slot="coach-acceptance-outcomes" className="flex min-w-0 flex-col gap-3">
      <h3 {...{ id: headingId, className: "type-subsection-title" }}>{"Where this invitation stands"}</h3>
      <p className={MUTED_TEXT_CLASS}>{"These are four separate outcomes rather than four steps of one, so each is stated on its own and none of them stands in for another."}</p>
      <ul className="flex min-w-0 flex-col gap-4">
        {SHARING_OUTCOME_COPY.map((entry) => {
          const state = outcomes[OUTCOME_STATE_FIELD[entry.id]];
          // The copy's description states the outcome as done, so it is printed only where this row's own word states the stage was reached: a row that states otherwise carries only its own sentence, and never the fact its badge denies.
          return (
            <li key={entry.id} data-slot="coach-acceptance-outcome" data-outcome={entry.id} data-state={state} className="flex min-w-0 flex-col gap-1.5">
              <p className="flex min-w-0 flex-wrap items-baseline gap-2 type-body">
                <span className="font-medium">{OUTCOME_STAGE_NAME[entry.id]}</span>
                <StatusBadge label={outcomeWord(entry, state)} tone={OUTCOME_TONE[state]} />
              </p>
              {state === "reached" ? <p className={MUTED_TEXT_CLASS}>{entry.description}</p> : null}
              <p className="type-body text-pretty">{OUTCOME_STATE_SENTENCE[entry.id][state]}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
/** The statement a coach who holds relationships but has no invitation awaiting acceptance reads: a plain region rather than an empty state, because an empty state over a non-empty portfolio would misstate what the read returned. */ function NoAcceptanceStatement(): ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-slot="coach-acceptance-no-invitation" className="min-w-0">
      <Panel titleId={headingId} headingLevel={2} title={NO_ACCEPTANCE_COPY.title} contentClassName="flex min-w-0 flex-col gap-2">
        <p className="max-w-prose text-sm text-pretty">{NO_ACCEPTANCE_COPY.description}</p>
      </Panel>
    </section>
  );
}
export default function CoachAcceptance({ invitation, outcomes, scope, expectedRevision, holdsNoSubjects }: CoachAcceptanceProps): ReactElement {
  const { mutateAsync } = useAcceptInvitation();
  const [submitted, setSubmitted] = useState<AcceptInput | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const submit = useCallback<MutationSubmit<AcceptancePayload>>(
    async (attempt: MutationInput<AcceptancePayload>): Promise<MutationOutcome> => {
      setSubmitted({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      return mutateAsync(attempt);
    },
    [mutateAsync],
  );
  // An invitation awaiting acceptance and the portfolio's own emptiness are separate facts, and this surface states each from the read's own answer: a coach whose read returned relationships reads a statement, never an empty state that claims nothing is shared.
  if (invitation === null) return holdsNoSubjects ? <StateNotice kind="empty" headingLevel={2} title={NO_INVITATION_COPY.title} description={NO_INVITATION_COPY.description} /> : <NoAcceptanceStatement />;
  const state = invitation.state;
  const holdsReceipt = settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged");
  const liveInput: AcceptInput = { scope, expectedRevision, payload: { grantId: invitation.grantId, invitationRevision: revisionOrdinal(expectedRevision) } };
  const input = holdsReceipt && submitted !== null ? submitted : liveInput;
  return (
    <div data-slot="coach-acceptance" className="flex min-w-0 flex-col gap-6">
      <InvitationFacts invitation={invitation} lifecycle={LIFECYCLE_OF[state]} />
      <OutcomeStanding outcomes={outcomes} />
      {state === "delivered" || holdsReceipt ? (
        <ActionReview<AcceptancePayload>
          title={SURFACE_COPY.acceptTitle}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p className="type-supporting">{SURFACE_COPY.acceptDescription}</p>
              <dl className="flex min-w-0 flex-col gap-1">
                <Fact term={SURFACE_COPY.factTerms.recipient}>
                  <bdi className="mono-identifier">{invitation.recipientPrincipalId}</bdi>
                </Fact>
                <Fact term={SURFACE_COPY.factTerms.ministry}>
                  <MinistryFacts ministries={invitation.ministries} />
                </Fact>
                <Fact term={SURFACE_COPY.factTerms.duration}>
                  <bdi>{invitation.durationLabel}</bdi>
                </Fact>
              </dl>
            </div>
          }
          consequence={
            <div className="flex min-w-0 flex-col gap-2">
              <p className="type-supporting">{SURFACE_COPY.acceptConsequence}</p>
              <p className="type-supporting">{SURFACE_COPY.acceptContainment}</p>
            </div>
          }
          confirmLabel={SURFACE_COPY.acceptLabel}
          cancelLabel={SURFACE_COPY.cancelLabel}
          consequential
          input={input}
          submit={submit}
          onSettled={setSettled}
          headingLevel={3}
        />
      ) : (
        <StateNotice kind="empty" headingLevel={3} title={NOTICE_COPY[state].title} description={NOTICE_COPY[state].description} />
      )}
      {settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted") ? <p className={MUTED_TEXT_CLASS}>{SURFACE_COPY.accessNotYetSentence}</p> : null}
    </div>
  );
}
