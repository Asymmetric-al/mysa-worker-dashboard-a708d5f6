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
    reached: "The invitation is recorded with the recipient, organization, ministry, modules, and duration.",
    "not-reached": "No invitation is recorded for you to accept.",
    unknown: "Couldn’t confirm whether an invitation was recorded.",
  },
  "identity-verification": { reached: "Your account has been verified as the invited coach.", "not-reached": "Your account hasn’t been verified as the invited coach yet.", unknown: "Couldn’t confirm account verification." },
  "deliberate-acceptance": {
    reached: "Your acceptance is recorded. Nothing becomes visible until access is active.",
    "not-reached": "Not accepted yet. Viewing this page doesn’t accept the invitation automatically.",
    unknown: "Couldn’t confirm whether acceptance was recorded.",
  },
  "active-access": { reached: "You can view the modules the missionary turned on within the agreed dates.", "not-reached": "Nothing is visible yet — accepting alone doesn’t turn on any modules.", unknown: "Couldn’t confirm whether access is active." },
};
const SURFACE_COPY = {
  heading: "Your coaching invitation",
  purpose: "Review the organization, ministry, modules, and duration below. Opening this page doesn’t accept or share anything automatically.",
  factTerms: { recipient: "Invited coach", organization: "Organization", ministry: "Ministry", duration: "Duration", grant: "Invitation ID" },
  notAcceptedSentence: "Not accepted yet. Accepting confirms your participation but doesn’t share any data on its own.",
  modulesHeading: "Included modules",
  noModulesSentence: "No modules are listed on this invitation.",
  modulesNote: "All modules start off. Only the modules the missionary turns on become visible within the agreed dates.",
  deliberateTitle: "Accepting is your choice",
  deliberateBody: "Only the invited account can accept this invitation — viewing this page or sharing an email address never grants access automatically.",
  readOnlySentence: "Coach access is read-only and never alters the missionary’s records.",
  acceptTitle: "Accept coaching invitation",
  acceptDescription: "Records your acceptance as the invited coach. Doesn’t share data or send messages on its own.",
  acceptConsequence: "Read-only access starts once the grant is active, limited to the modules the missionary turns on and the agreed dates.",
  acceptContainment: "Nothing in the missionary’s workspace changes when you accept.",
  accessNotYetSentence: "Access isn’t live yet — it starts once the grant is active and the missionary turns on modules.",
  acceptLabel: "Accept invitation",
  cancelLabel: "Cancel",
} as const;
const NOTICE_COPY: Readonly<Record<Exclude<InvitationState, "delivered">, NoticeCopy>> = {
  "already-accepted": { title: "Invitation already accepted", description: "Your acceptance is already recorded. Read-only access applies once the grant is active and modules are turned on." },
  superseded: { title: "Replaced by a newer invitation", description: "This invitation was replaced before acceptance. Open the newest invitation from the missionary instead." },
  expired: { title: "Invitation expired", description: "This invitation’s dates have passed. Ask the missionary for a new invitation to start coaching." },
  revoked: { title: "Invitation revoked", description: "The missionary revoked this invitation, so it can’t be accepted. Starting again requires a new invitation." },
};
// The acceptance fact and the portfolio's emptiness are two different facts, and the portfolio card above states the emptiness once when that is what its read returned: both notices below therefore state only where the acceptance stands, and neither repeats what the portfolio says about what is shared.
const NO_PENDING_INVITATION_SENTENCE = "No coaching invitation is waiting for your acceptance.";
const NO_INVITATION_COPY: NoticeCopy = { title: "No coaching invitations", description: `${NO_PENDING_INVITATION_SENTENCE} Opening this page never grants access automatically.` };
const NO_ACCEPTANCE_COPY: NoticeCopy = { title: "No pending invitations", description: `${NO_PENDING_INVITATION_SENTENCE} Your active coaching access is listed in your portfolio above.` };
const MUTED_TEXT_CLASS = "type-supporting text-pretty";
// An invitation names its organization and ministry from the records the missionary's own admission states; where those records carry neither a label nor an identifier, this surface says so rather than leaving the row blank.
const NO_ORGANIZATION_SENTENCE = "No organization listed on this invitation.";
const TRAILING_DIGITS = /(\d+)\s*$/u;
function revisionOrdinal(revision: string): number {
  const digits = TRAILING_DIGITS.exec(revision);
  const parsed = digits === null ? Number.NaN : Number.parseInt(digits[1] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
/** The ministries one invitation names, each beside its own identifier: a label alone would be a name this page matched across records, and an identifier alone names nothing a person can read. */ const MinistryFacts = ({ ministries }: { readonly ministries: InvitationSummary["ministries"] }): ReactElement =>
  ministries.length === 0 ? (
    <span className={MUTED_TEXT_CLASS}>{"No ministry listed on this invitation."}</span>
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
      <h3 {...{ id: headingId, className: "type-subsection-title" }}>{"Invitation status"}</h3>
      <p className={MUTED_TEXT_CLASS}>{"Each stage is tracked separately — completing one doesn’t automatically complete the next."}</p>
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
