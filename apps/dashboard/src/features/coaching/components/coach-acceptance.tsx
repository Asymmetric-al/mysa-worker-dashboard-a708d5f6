"use client";
import { useCallback, useId, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import StateNotice from "@/components/state-notice";
import StatusBadge, { COACHING_STATUS, statusBadgeProps, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MODULE_KEYS, type GrantLifecycleState, type ModuleKey } from "@/modules/coaching/grant";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { COACHING_COPY, GRANT_STATE_COPY, MODULE_COPY, SHARING_OUTCOME_COPY, type SharingOutcomeId } from "../copy";
import { useAcceptInvitation } from "../hooks/use-coaching";
import type { AcceptancePayload } from "../schemas";
import { Panel } from "./panel";
import { Fact, OUTCOME_STAGE_NAME, OUTCOME_STATE_FIELD, outcomeWord } from "./sharing-summary";
import type { SharingOutcome, SharingOutcomeSet } from "./sharing-summary";
const INVITATION_STATES = ["delivered", "superseded", "already-accepted", "expired", "revoked"] as const;
type InvitationState = (typeof INVITATION_STATES)[number];
type InvitationSummary = { readonly grantId: string; readonly state: InvitationState; readonly recipientDisplayName: string; readonly organizationName: string; readonly ministryName: string; readonly modules: ReadonlyArray<{ readonly key: ModuleKey }>; readonly durationLabel: string };
export type CoachAcceptanceProps = { readonly invitation: InvitationSummary | null; readonly outcomes: SharingOutcomeSet; readonly scope: Scope; readonly expectedRevision: string };
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
const NO_INVITATION_COPY: NoticeCopy = { title: "No coaching invitation for this account", description: `${COACHING_COPY.coachPortfolio.empty} Nothing on this page can create one, and a matching email address grants nothing either.` };
const MUTED_TEXT_CLASS = "text-sm text-pretty text-muted-foreground";
const TRAILING_DIGITS = /(\d+)\s*$/u;
function revisionOrdinal(revision: string): number {
  const digits = TRAILING_DIGITS.exec(revision);
  const parsed = digits === null ? Number.NaN : Number.parseInt(digits[1] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
function InvitationFacts({ invitation, lifecycle }: { readonly invitation: InvitationSummary; readonly lifecycle: GrantLifecycleState }): ReactElement {
  const headingId = useId();
  const modulesId = useId();
  const namedModules = MODULE_KEYS.filter((key) => invitation.modules.some((module) => module.key === key));
  const lifecycleCopy = GRANT_STATE_COPY[lifecycle];
  return (
    <section aria-labelledby={headingId} data-slot="coach-acceptance-invitation" className="min-w-0">
      <Panel titleId={headingId} title={SURFACE_COPY.heading} description={SURFACE_COPY.purpose} action={<StatusBadge label={lifecycleCopy.label} tone={statusBadgeProps(COACHING_STATUS, lifecycle).tone} srPrefix="Invitation state" />} contentClassName="flex min-w-0 flex-col gap-4">
        <dl className="flex min-w-0 flex-col gap-2 text-sm">
          <Fact term={SURFACE_COPY.factTerms.recipient}>
            <bdi className="font-medium">{invitation.recipientDisplayName}</bdi>
          </Fact>
          <Fact term={SURFACE_COPY.factTerms.organization}>
            <bdi>{invitation.organizationName}</bdi>
          </Fact>
          <Fact term={SURFACE_COPY.factTerms.ministry}>
            <bdi>{invitation.ministryName}</bdi>
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
          <h3 {...{ id: modulesId, className: "text-sm font-semibold" }}>{SURFACE_COPY.modulesHeading}</h3>
          {namedModules.length === 0 ? (
            <p className={MUTED_TEXT_CLASS}>{SURFACE_COPY.noModulesSentence}</p>
          ) : (
            <ul className="flex min-w-0 flex-wrap items-center gap-1">
              {namedModules.map((key) => (
                <li key={key}>
                  <Badge variant="secondary" className={"h-auto max-w-full whitespace-normal"}>
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
      <h3 {...{ id: headingId, className: "text-sm font-semibold" }}>{"Where this invitation stands"}</h3>
      <p className={MUTED_TEXT_CLASS}>{"These are four separate outcomes rather than four steps of one, so each is stated on its own and none of them stands in for another."}</p>
      <ul className="flex min-w-0 flex-col gap-4">
        {SHARING_OUTCOME_COPY.map((entry) => {
          const state = outcomes[OUTCOME_STATE_FIELD[entry.id]];
          return (
            <li key={entry.id} data-slot="coach-acceptance-outcome" data-outcome={entry.id} data-state={state} className="flex min-w-0 flex-col gap-1.5">
              <p className="flex min-w-0 flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium">{OUTCOME_STAGE_NAME[entry.id]}</span>
                <StatusBadge label={outcomeWord(entry, state)} tone={OUTCOME_TONE[state]} />
              </p>
              <p className={MUTED_TEXT_CLASS}>{entry.description}</p>
              <p className="text-sm text-pretty">{OUTCOME_STATE_SENTENCE[entry.id][state]}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
export default function CoachAcceptance({ invitation, outcomes, scope, expectedRevision }: CoachAcceptanceProps): ReactElement {
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
  if (invitation === null) return <StateNotice kind="empty" headingLevel={2} title={NO_INVITATION_COPY.title} description={NO_INVITATION_COPY.description} />;
  const state = invitation.state;
  const holdsReceipt = settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged");
  const acceptedJustNow = settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted");
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
              <p>{SURFACE_COPY.acceptDescription}</p>
              <dl className="flex min-w-0 flex-col gap-1">
                <Fact term={SURFACE_COPY.factTerms.recipient}>
                  <bdi>{invitation.recipientDisplayName}</bdi>
                </Fact>
                <Fact term={SURFACE_COPY.factTerms.ministry}>
                  <bdi>{invitation.ministryName}</bdi>
                </Fact>
                <Fact term={SURFACE_COPY.factTerms.duration}>
                  <bdi>{invitation.durationLabel}</bdi>
                </Fact>
              </dl>
            </div>
          }
          consequence={
            <div className="flex min-w-0 flex-col gap-2">
              <p>{SURFACE_COPY.acceptConsequence}</p>
              <p>{SURFACE_COPY.acceptContainment}</p>
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
      {acceptedJustNow ? <p className={MUTED_TEXT_CLASS}>{SURFACE_COPY.accessNotYetSentence}</p> : null}
    </div>
  );
}
