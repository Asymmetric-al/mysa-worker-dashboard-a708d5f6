"use client";

/**
 * The coach's deliberate-acceptance step: it reports delivery, identity verification, deliberate acceptance and active
 * access as four separate outcomes, and performs the fourth — acceptance — only when the named coach confirms a
 * reviewed action, which is the only write this component holds.
 */
import { useCallback, useId, useState, type ReactElement, type ReactNode } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import StateNotice from "@/components/state-notice";
import StatusBadge, { COACHING_STATUS, statusBadgeProps, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MODULE_KEYS, type GrantLifecycleState, type ModuleKey } from "@/modules/coaching/grant";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { COACHING_COPY, GRANT_STATE_COPY, MODULE_COPY, SHARING_OUTCOME_COPY, type SharingOutcomeCopy, type SharingOutcomeId } from "../copy";
import { useAcceptInvitation } from "../hooks/use-coaching-mutations";
import type { AcceptancePayload } from "../schemas/invitation";
import type { SharingOutcome, SharingOutcomeSet } from "./sharing-summary";

// ---------------------------------------------------------------------------------------------
// What an invitation is, and which of its states needs the coach's decision
// ---------------------------------------------------------------------------------------------

/** Every state a delivered invitation can be read in, listed once so the closed set has a runtime form as well as a type. */
const INVITATION_STATES = ["delivered", "superseded", "already-accepted", "expired", "revoked"] as const;

/** One state of an invitation as this step reads it: only `delivered` leaves acceptance to the coach. */
type InvitationState = (typeof INVITATION_STATES)[number];

/** The invitation exactly as the surrounding read resolved it, with the named recipient and no identifier used as identity. */
type InvitationSummary = { readonly grantId: string; readonly state: InvitationState; readonly recipientDisplayName: string; readonly organizationName: string; readonly ministryName: string; readonly modules: ReadonlyArray<{ readonly key: ModuleKey }>; readonly durationLabel: string };

/**
 * The props of {@link CoachAcceptance}: the invitation as read, the four outcomes as read, and the context and revision
 * the acceptance is submitted against. The surrounding route types what it hands over with this, so the invitation it
 * builds is checked against the contract the step reads rather than a second description of it.
 */
export interface CoachAcceptanceProps {
  readonly invitation: InvitationSummary | null;
  readonly outcomes: SharingOutcomeSet;
  readonly scope: Scope;
  readonly expectedRevision: string;
}

/** One acceptance as the review step hands it over: the mutation's three stated facts, with its operation identity left to that step. */
type AcceptInput = Omit<MutationInput<AcceptancePayload>, "operationId">;

/** The copy of one statement that replaces the accept control. */
type NoticeCopy = { readonly title: string; readonly description: string };

/**
 * The lifecycle word an invitation state carries. The state itself is this step's own vocabulary and the lifecycle
 * word is the coaching family's, so the four statements below are not a second set of state words.
 */
const LIFECYCLE_OF: Readonly<Record<InvitationState, GrantLifecycleState>> = { delivered: "invited", superseded: "superseded", "already-accepted": "accepted", expired: "expired", revoked: "revoked" };

// ---------------------------------------------------------------------------------------------
// The four outcomes, each with its own word
//
// The words come from `SHARING_OUTCOME_COPY`, which owns what each outcome means; only the wording for the two states
// an outstanding invitation can be in — not reached, and unknown — is stated here, because that copy describes what
// each outcome is rather than where this invitation stands.
// ---------------------------------------------------------------------------------------------

/** The term each outcome is listed under, in the fixed order delivery, identity verification, acceptance, access. */
const OUTCOME_TERM: Readonly<Record<SharingOutcomeId, string>> = { delivery: "Invitation", "identity-verification": "Identity", "deliberate-acceptance": "Acceptance", "active-access": "Access" };

/** Which member of the outcome set each entry of `SHARING_OUTCOME_COPY` is reported in. */
const OUTCOME_FIELD: Readonly<Record<SharingOutcomeId, keyof SharingOutcomeSet>> = { delivery: "delivery", "identity-verification": "identityVerification", "deliberate-acceptance": "acceptance", "active-access": "access" };

/** How each state of an outcome reads, since the copy's own label describes only the reached one. */
const OUTCOME_NOT_REACHED_WORD: Readonly<Record<SharingOutcomeId, string>> = { delivery: "No invitation recorded", "identity-verification": "Identity not verified", "deliberate-acceptance": "Not accepted yet", "active-access": "Access not live yet" };

const OUTCOME_UNKNOWN_WORD: Readonly<Record<SharingOutcomeId, string>> = { delivery: "Recording uncertain", "identity-verification": "Verification unknown", "deliberate-acceptance": "Acceptance unknown", "active-access": "Access unknown" };

const OUTCOME_TONE: Readonly<Record<SharingOutcome, StatusTone>> = { reached: "positive", "not-reached": "muted", unknown: "caution" };

/** What each state of each outcome means for the coach reading this page right now. */
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

const OUTCOMES_HEADING = "Where this invitation stands";
const OUTCOMES_NOTE = "These are four separate outcomes rather than four steps of one, so each is stated on its own and none of them stands in for another.";

// ---------------------------------------------------------------------------------------------
// The invitation, the deliberate-acceptance rule, and what replaces the accept control
// ---------------------------------------------------------------------------------------------

const SURFACE_COPY = {
  heading: "Your coaching invitation",
  purpose: "This invitation names you, the organization, the ministry, the modules and the duration. Reading it, or following " + "the link that brought you here, shares nothing: where the invitation actually stands is stated below, one outcome " + "at a time.",
  factTerms: { recipient: "Named recipient", organization: "Organization", ministry: "Ministry", duration: "Duration", grant: "Invitation" },
  notAcceptedSentence: "You have not accepted yet. Your own decision is what moves this invitation on, and it shares nothing by itself.",
  modulesHeading: "Modules this invitation names",
  noModulesSentence: "This invitation names no module, so nothing would be readable even after you accept it.",
  modulesNote: "Modules start switched off. Acceptance on its own makes nothing readable: only the modules the worker switches on " + "can be read, and only inside the dates named.",
  deliberateTitle: "Accepting is your own decision",
  deliberateBody: "Accepting belongs to the named recipient and is a deliberate act, not a side effect of opening this page. No " + "permission follows from an email address that matches, from a link that opens, from an existing relationship or " + "from a job title.",
  readOnlySentence: "Your access is read-only: nothing on this page changes the worker's own work.",
  acceptTitle: "Accept this coaching invitation",
  acceptDescription: "Accepting records your decision as the named recipient. It shares nothing on its own, and it sends no message.",
  acceptConsequence: "Access begins only when the grant is active, and only for the modules the worker switches on, inside the dates the invitation names.",
  acceptContainment: "Nothing else changes: your acceptance alters no worker record and opens no module by itself.",
  accessNotYetSentence: "Access does not begin with this acceptance: it begins only when the grant is active, and only for the modules the worker switches on.",
  acceptLabel: "Accept this invitation",
  cancelLabel: "Cancel",
} as const;

/**
 * What stands in place of the accept control, one statement per state. These are the coach's own words for the state
 * rather than the family's, whose descriptions are written to the worker ("You revoked the grant"); the state word
 * itself is the family's label, so one state keeps one name.
 */
const NOTICE_COPY: Readonly<Record<Exclude<InvitationState, "delivered">, NoticeCopy>> = {
  "already-accepted": { title: "You have already accepted this invitation", description: "Your decision is recorded, so there is nothing left to accept here. Access begins only when the grant is " + "active, and only for the modules the worker switches on; opening this page again accepts nothing further." },
  superseded: { title: "A newer invitation replaced this one", description: "It was replaced before it was accepted, so it cannot be accepted now and nothing was shared under it. Open the " + "newest invitation the worker sent you, because nothing here can bring this one back." },
  expired: { title: "This invitation reached its agreed end", description: "The dates this invitation named have passed, so it can no longer be accepted and nothing is readable under it. " + "A new invitation from the worker is what begins a relationship." },
  revoked: { title: "This invitation was revoked", description: "The worker revoked this grant, so it can no longer be accepted and no further read is allowed under it. Revoking " + "stops access; it does not take back what was read before, and only a new invitation begins again." },
};

/** What a coach with no invitation at all is told, in the portfolio copy's own words plus the one fact about this page. */
const NO_INVITATION_COPY: NoticeCopy = { title: "No coaching invitation for this account", description: `${COACHING_COPY.coachPortfolio.empty} Nothing on this page can create one, and a matching email address grants nothing either.` };

const MUTED_TEXT_CLASS = "text-sm text-pretty text-muted-foreground";
const MODULE_CHIP_CLASS = "h-auto max-w-full whitespace-normal";

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const TRAILING_DIGITS = /(\d+)\s*$/u;

/**
 * The ordinal a revision token carries (`rev-3` is the third revision). The acceptance payload states the invitation
 * revision as an ordinal, so this reads it exactly as the service does — digits at the end, and the first revision when
 * the token carries none.
 */
function revisionOrdinal(revision: string): number {
  const digits = TRAILING_DIGITS.exec(revision);
  const parsed = digits === null ? Number.NaN : Number.parseInt(digits[1] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** The word one outcome is listed under in the state it is actually in. */
function outcomeWord(entry: SharingOutcomeCopy, state: SharingOutcome): string {
  switch (state) {
    case "reached":
      return entry.label;
    case "not-reached":
      return OUTCOME_NOT_REACHED_WORD[entry.id];
    case "unknown":
      return OUTCOME_UNKNOWN_WORD[entry.id];
  }
}

/** One labelled fact, laid out so a name of any direction wraps inside its own line rather than the page. */
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <dt className="font-medium">{term}</dt>
      <dd className="min-w-0 wrap-anywhere">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The two surfaces the step is read on: the invitation itself, and where it stands
// ---------------------------------------------------------------------------------------------

/** The invitation's own facts: who it names, in which organization and ministry, for how long, and every module it names — all of them switched off. */
function InvitationFacts({ invitation, lifecycle }: { readonly invitation: InvitationSummary; readonly lifecycle: GrantLifecycleState }): ReactElement {
  const headingId = useId();
  const modulesId = useId();
  const namedModules = MODULE_KEYS.filter((key) => invitation.modules.some((module) => module.key === key));
  const lifecycleCopy = GRANT_STATE_COPY[lifecycle];
  return (
    <section aria-labelledby={headingId} data-slot="coach-acceptance-invitation" className="min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={headingId}>{SURFACE_COPY.heading}</h2>
          </CardTitle>
          <CardDescription>{SURFACE_COPY.purpose}</CardDescription>
          <CardAction>
            {/*
             * The state word is the coaching family's own label and the tone is the status vocabulary's mapping, so
             * the four states an invitation can be in are named once for the whole family instead of here.
             */}
            <StatusBadge label={lifecycleCopy.label} tone={statusBadgeProps(COACHING_STATUS, lifecycle).tone} srPrefix="Invitation state" />
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
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
            <h3 id={modulesId} className="text-sm font-semibold">
              {SURFACE_COPY.modulesHeading}
            </h3>
            {namedModules.length === 0 ? (
              <p className={MUTED_TEXT_CLASS}>{SURFACE_COPY.noModulesSentence}</p>
            ) : (
              <ul className="flex min-w-0 flex-wrap items-center gap-1">
                {namedModules.map((key) => (
                  <li key={key}>
                    <Badge variant="secondary" className={MODULE_CHIP_CLASS}>
                      <bdi>{MODULE_COPY[key].name}</bdi>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className={MUTED_TEXT_CLASS}>{SURFACE_COPY.modulesNote}</p>
          </section>
          <Separator />
          {/*
           * `Alert` states its own `role="alert"`; this one is a standing explanation rather than a response to
           * anything, so the role is dropped and the sentences are read in document order like any other text.
           */}
          <Alert role={undefined}>
            <AlertTitle>{SURFACE_COPY.deliberateTitle}</AlertTitle>
            <AlertDescription>
              <p>{SURFACE_COPY.deliberateBody}</p>
              <p>{SURFACE_COPY.readOnlySentence}</p>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </section>
  );
}

/** The four outcomes as a list, one line each, in the fixed order delivery, identity verification, acceptance, access. */
function OutcomeStanding({ outcomes }: { readonly outcomes: SharingOutcomeSet }): ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-slot="coach-acceptance-outcomes" className="flex min-w-0 flex-col gap-3">
      <h3 id={headingId} className="text-sm font-semibold">
        {OUTCOMES_HEADING}
      </h3>
      <p className={MUTED_TEXT_CLASS}>{OUTCOMES_NOTE}</p>
      <ul className="flex min-w-0 flex-col gap-4">
        {SHARING_OUTCOME_COPY.map((entry) => {
          const state = outcomes[OUTCOME_FIELD[entry.id]];
          return (
            <li key={entry.id} data-slot="coach-acceptance-outcome" data-outcome={entry.id} data-state={state} className="flex min-w-0 flex-col gap-1.5">
              <p className="flex min-w-0 flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium">{OUTCOME_TERM[entry.id]}</span>
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

/**
 * Reports delivery, identity verification, deliberate acceptance and active access as four separate outcomes of one
 * invitation, and accepts it only through one reviewed action that the named coach confirms.
 */
export default function CoachAcceptance({ invitation, outcomes, scope, expectedRevision }: CoachAcceptanceProps): ReactElement {
  const { mutateAsync } = useAcceptInvitation();
  const [submitted, setSubmitted] = useState<AcceptInput | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  // The identity of the attempt belongs to the review step, which mints one per intent and reuses it for a retry of
  // the same work; this file only holds the three stated facts of the attempt it handed over.
  const submit = useCallback<MutationSubmit<AcceptancePayload>>(
    async (attempt: MutationInput<AcceptancePayload>): Promise<MutationOutcome> => {
      setSubmitted({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      return mutateAsync(attempt);
    },
    [mutateAsync],
  );
  if (invitation === null) {
    return <StateNotice kind="empty" headingLevel={2} title={NO_INVITATION_COPY.title} description={NO_INVITATION_COPY.description} />;
  }
  const state = invitation.state;
  const holdsReceipt = settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged");
  // Stated from the receipt — an answer the service gave — and never from a decision this page assumed: the outcome
  // list above it moves only when the read it was handed moves.
  const acceptedJustNow = settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted");
  const liveInput: AcceptInput = { scope, expectedRevision, payload: { grantId: invitation.grantId, invitationRevision: revisionOrdinal(expectedRevision) } };
  // The review step shows its receipt only while the input it is handed matches the intent it reviewed, and a
  // refreshed read advances the revision the invitation stands at. Holding the input that was submitted keeps the
  // record of the acceptance on screen across that read; nothing here reports a decision the service has not stated.
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
