import type { Metadata } from "next";
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import LanguagePreference from "@/features/audience/components/language-preference";
import PreferenceControl from "@/features/audience/components/preference-control";
import ProofFlow, { type ProofMembership } from "@/features/audience/components/proof-flow";
import UnsubscribeConfirm from "@/features/audience/components/unsubscribe-confirm";
import { PURPOSE_LABEL } from "@/features/audience/copy/membership";
import { reads } from "@/modules/data-service";
import { PageSurface, ReadNotices, type ReadNoticeCopy } from "../../page-frame";
type PreferencesResult = Awaited<ReturnType<typeof reads.audience.readPreferences>>;
type PreferencesEnvelope = Extract<PreferencesResult, { readonly kind: "envelope" }>["envelope"];
type ActionAvailability = { readonly available: boolean; readonly reason: string | undefined };
const PAGE_TITLE = "Reader preferences";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: PAGE_TITLE };
const NOTICE_COPY = {
  noMembership: {
    title: "No email subscription for this session",
    description:
      "This session doesn’t have an active or pending update-email subscription. Previewing updates or importing contacts never subscribes anyone automatically.",
    action: { label: "Open Reader preview", href: "/preview" },
  },
  denied: { title: "Reader preferences aren’t available in this session", description: "Your current session doesn’t have permission to view subscription preferences here." },
  unavailable: { title: "Couldn’t load Reader preferences" },
  refused: { title: "Couldn’t open Reader preferences" },
} as const;
const REFUSAL_COPY: ReadNoticeCopy = { headingLevel: 2, denied: { title: NOTICE_COPY.denied.title, body: NOTICE_COPY.denied.description }, unavailable: { title: NOTICE_COPY.unavailable.title }, refused: { title: NOTICE_COPY.refused.title } };
function availabilityOf(envelope: PreferencesEnvelope, name: string): ActionAvailability {
  const action = envelope.actions.find((candidate) => candidate.name === name);
  return { available: action?.available === true, reason: action?.reason };
}
function MembershipPreferences({ envelope }: { readonly envelope: PreferencesEnvelope }): ReactElement {
  const { data, scope, revision } = envelope;
  const { membershipId, publisherId, choice, state } = data;
  // A membership the read did not name leaves the three record-addressing surfaces without a record to address. Where the read states the publisher such a request would be made to, the proof surface composes the deliberate request that opens one; where it states none, the absence is stated instead, because a request form over a publisher this page invented would address a record the read never mentioned.
  if (membershipId === null || publisherId === null || choice === null || state === "none") {
    if (publisherId === null) return <StateNotice kind="empty" headingLevel={2} title={NOTICE_COPY.noMembership.title} description={NOTICE_COPY.noMembership.description} action={NOTICE_COPY.noMembership.action} />;
    // The request step alone: this notice and that step would state the same absence twice, and the step is the one that offers the real first action an empty surface owes the person. The state, the absent membership and the revision are the read's own, so nothing composed here claims a membership exists or confirms one on render.
    return <ProofFlow scope={scope} publisherId={publisherId} publisherLabel={publisherId} purpose={data.purpose} state={state} membership={null} expectedRevision={revision} confirmation={data.confirmation} confirmationMessage={null} languagePreference={data.languagePreference} headingLevel={2} />;
  }
  const choiceAction = availabilityOf(envelope, "setPreference");
  const languageAction = availabilityOf(envelope, "setLanguagePreference");
  const unsubscribeAction = availabilityOf(envelope, "unsubscribe");
  const membership: ProofMembership = { membershipId, email: data.email, languagePreference: data.languagePreference };
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PreferenceControl scope={scope} membershipId={membershipId} publisherId={publisherId} purpose={data.purpose} currentChoice={choice} expectedRevision={revision} disabled={!choiceAction.available} disabledReason={choiceAction.reason} headingLevel={2} />
      <LanguagePreference
        scope={scope}
        membershipId={membershipId}
        publisherId={publisherId}
        purpose={data.purpose}
        currentChoice={choice}
        currentLanguage={data.languagePreference}
        expectedRevision={revision}
        languageOptions={data.languageOptions}
        disabled={!languageAction.available}
        disabledReason={languageAction.reason}
        headingLevel={2}
      />
      <ProofFlow scope={scope} publisherId={publisherId} publisherLabel={publisherId} purpose={data.purpose} state={state} membership={membership} expectedRevision={revision} confirmation={data.confirmation} confirmationMessage={data.confirmationMessage} languagePreference={data.languagePreference} headingLevel={2} />
      <UnsubscribeConfirm scope={scope} target={{ publisherId, publisherLabel: "", purpose: data.purpose, purposeLabel: PURPOSE_LABEL[data.purpose], membershipState: state, expectedRevision: revision }} disabled={!unsubscribeAction.available} disabledReason={unsubscribeAction.reason} />
    </div>
  );
}
const PreferencesBody = ({ result }: { readonly result: PreferencesResult }): ReactElement => (result.kind === "envelope" ? <MembershipPreferences envelope={result.envelope} /> : <ReadNotices failure={result} copy={REFUSAL_COPY} />);
/** The reader's own preferences and consent surface, read directly from the service for this request. */ export default async function ReaderPreferencesPage(): Promise<ReactElement> {
  const result = await reads.audience.readPreferences();
  return (
    <PageSurface headingId="reader-preferences-heading" title={PAGE_TITLE}>
      <p className="max-w-prose type-supporting text-pretty">
        {"Manage your update-email delivery (Off or Immediate), reading language, email confirmation, and unsubscribe status independently."}
      </p>
      <PreferencesBody result={result} />
    </PageSurface>
  );
}
