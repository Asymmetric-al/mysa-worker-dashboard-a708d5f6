/**
 * `/preview/preferences` — the reader's own preference-and-consent surface: the Off or Immediate choice for one
 * publisher's Update email, the reading language beside it, the proof of the address that membership is set for, and
 * the unsubscribe for that same publisher and purpose (AAP 0.9.1 "Language, Off/Immediate, unsubscribe, proof flow";
 * AAP 0.10.1 family 10; `GET /api/preferences`, `POST /api/preferences`, `POST /api/unsubscribe`,
 * `POST /api/confirm` in AAP 0.6.3).
 *
 * **Composition only.** One `readPreferences` answer, then the four surfaces the audience feature owns, in the fixed
 * order preference → language → proof → unsubscribe. Nothing here counts, formats, dates, decides a permission or
 * writes anything: each surface takes its own mutation, its own receipt and its own wording, and this file hands the
 * envelope's facts to them.
 *
 * **The four facts stay four.** A language is not consent, awaiting proof is not consent, a source `subscribed` flag
 * is not consent, and an accepted notice is neither delivery nor reading. Rendering this page confirms nothing and
 * writes nothing: `POST /api/confirm` is the only confirmation transport and the confirmation is the person's own
 * activation of the control the proof surface renders. The page reads no address parameter, so its rendering is the
 * same whether or not a confirmation link was followed.
 *
 * **Why the facts are mapped rather than handed over.** Each composed surface takes the concrete values it needs —
 * the scope, the membership, the recorded choice, the revision to act on — so this file names those values from the
 * envelope once and passes them down. A value the read states as absent (no membership, no publisher reference) is
 * never replaced with a placeholder here: the absence is stated instead, because an empty control would read as a
 * preference that exists and an invented reference would address a record the read never mentioned.
 *
 * **Why no callbacks are passed.** A Server Component cannot hand a function to a client surface, so the optional
 * recovery callbacks stay unset and each surface falls back to its own recovery: an unconfirmed attempt is re-issued
 * under the identity it already holds, which the service answers with the stored result rather than applying a second
 * change.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";
import LanguagePreference, { type LanguageOption } from "@/features/audience/components/language-preference";
import PreferenceControl from "@/features/audience/components/preference-control";
import ProofFlow, { type ProofMembership } from "@/features/audience/components/proof-flow";
import UnsubscribeConfirm from "@/features/audience/components/unsubscribe-confirm";
import { PURPOSE_LABEL } from "@/features/audience/copy/membership";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** The one read this route holds, named once so its answer is taken from the read itself. */
type PreferencesResult = Awaited<ReturnType<typeof reads.audience.readPreferences>>;

/** The envelope arm of that answer: the facts, the authority they were read in, and the revision a change presents. */
type PreferencesEnvelope = Extract<PreferencesResult, { readonly kind: "envelope" }>["envelope"];

/** What the read's advisory action list says about one change, with the reason it gives when the change is unavailable. */
interface ActionAvailability {
  readonly available: boolean;
  readonly reason: string | undefined;
}

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The surface's own name, which its heading and its document title both state, so the two can never disagree. */
const PAGE_TITLE = "Your preferences";

/**
 * The membership this page reads is the current persona's own, and an unsubscribe or a restriction has to take effect
 * in the same read that reports it, so the route is rendered per request rather than from a cache.
 */
export const dynamic = "force-dynamic";

/**
 * A static title. The body may refuse the read, and a title derived from a record would disclose a state, a count or an
 * existence hint to a caller that was refused one.
 */
export const metadata: Metadata = { title: PAGE_TITLE };

const HEADING_ID = "reader-preferences-heading";
const WRAPPER_CLASS = "flex min-w-0 flex-col gap-6 text-start";
const H1_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";
const LEDE_CLASS = "max-w-prose text-sm text-pretty text-muted-foreground";
const SURFACES_CLASS = "flex min-w-0 flex-col gap-8";

/** The one sentence above the surfaces, saying what makes them four surfaces rather than one setting. */
const LEDE = "Four separate facts are stated here: your Off or Immediate choice for this publisher's Update email, the language you read it in, the proof that the address that membership is set for is yours, and turning those notices off. Each is changed on its own, and choosing one never decides another.";

/**
 * The languages this page may offer for the reading-language choice.
 *
 * The preferences read publishes the language the membership records and no catalogue of languages the publisher
 * offers, so this page offers none rather than typing tags here: a tag written into this route would be a second source
 * for content locales, and saving one would record a language the read never stated the publisher publishes in. The
 * control then states the language the record holds, in its own words, and lists nothing to choose from.
 */
const NO_OFFERED_LANGUAGES: readonly LanguageOption[] = [];

/**
 * The publisher's display name. The read states the publisher as an opaque reference and no name, so no name is
 * invented: the proof surface shows the reference it was given, and the unsubscribe surface is handed no label at all,
 * which is how it falls back to the reference and marks it as one.
 */
const NO_PUBLISHER_LABEL = "";

/** What this page states where the read gave it no membership to compose, and where the read answered with a refusal. */
const NOTICE_COPY = {
  noMembership: {
    title: "No Update-email membership is recorded for this session",
    description:
      "The read found no membership for this publisher and this purpose, so there is no Off or Immediate choice to record, no reading language to state, no address awaiting proof and no subscription to turn off. A membership is created by requesting notices and then confirming the address yourself; rendering a page, opening a link, importing a contact or editing one creates none.",
    action: { label: "Open the receiving preview", href: "/preview" },
  },
  denied: { title: "Your preferences are not available in this session", description: "This session may not read a membership here, so no choice, language, address or subscription state is stated in its place." },
  unavailable: { title: "Your preferences could not be read" },
  refused: { title: "This page's read was refused" },
} as const;

// ---------------------------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------------------------

/**
 * What the read's own action list says about one change on this membership.
 *
 * The list is advisory: the service re-checks the scope and the record on submit, so a stale envelope can still earn a
 * refusal. Reading it here is what keeps this page from re-deriving a permission rule the service already decided — a
 * restricted membership disables the choice it refuses instead of the page guessing why.
 */
function availabilityOf(envelope: PreferencesEnvelope, name: string): ActionAvailability {
  const action = envelope.actions.find((candidate) => candidate.name === name);
  return { available: action?.available === true, reason: action?.reason };
}

/** The envelope arm: the four surfaces, composed over the facts the read itself published. */
function MembershipPreferences({ envelope }: { readonly envelope: PreferencesEnvelope }): ReactElement {
  const { data, scope, revision } = envelope;
  const { membershipId, publisherId, choice, state } = data;
  // A membership the read did not name — no identifier, no publisher reference, no recorded choice, or no state at all
  // — leaves the four surfaces without a record to address, so the absence is stated rather than four controls over
  // values this page invented.
  if (membershipId === null || publisherId === null || choice === null || state === "none") {
    return <StateNotice kind="empty" headingLevel={2} title={NOTICE_COPY.noMembership.title} description={NOTICE_COPY.noMembership.description} action={NOTICE_COPY.noMembership.action} />;
  }
  const choiceAction = availabilityOf(envelope, "setPreference");
  const languageAction = availabilityOf(envelope, "setLanguagePreference");
  const unsubscribeAction = availabilityOf(envelope, "unsubscribe");
  const membership: ProofMembership = { membershipId, email: data.email, languagePreference: data.languagePreference };
  return (
    <div className={SURFACES_CLASS}>
      {/* One closed pair — Off or Immediate — for this publisher and this purpose. */}
      <PreferenceControl scope={scope} membershipId={membershipId} publisherId={publisherId} purpose={data.purpose} currentChoice={choice} expectedRevision={revision} disabled={!choiceAction.available} disabledReason={choiceAction.reason} headingLevel={2} />
      {/* The reading language, with its own save and its own payload: nothing here is folded into the choice above. */}
      <LanguagePreference
        scope={scope}
        membershipId={membershipId}
        publisherId={publisherId}
        purpose={data.purpose}
        currentChoice={choice}
        currentLanguage={data.languagePreference}
        expectedRevision={revision}
        languageOptions={NO_OFFERED_LANGUAGES}
        disabled={!languageAction.available}
        disabledReason={languageAction.reason}
        headingLevel={2}
      />
      {/* The proof journey, carrying the state and the window the service resolved rather than a deadline computed here. */}
      <ProofFlow scope={scope} publisherId={publisherId} publisherLabel={publisherId} purpose={data.purpose} state={state} membership={membership} expectedRevision={revision} confirmation={data.confirmation} languagePreference={data.languagePreference} headingLevel={2} />
      {/* Turning the same publisher's notices off, for the same purpose and nothing beside it. */}
      <UnsubscribeConfirm scope={scope} target={{ publisherId, publisherLabel: NO_PUBLISHER_LABEL, purpose: data.purpose, purposeLabel: PURPOSE_LABEL[data.purpose], membershipState: state, expectedRevision: revision }} disabled={!unsubscribeAction.available} disabledReason={unsubscribeAction.reason} />
    </div>
  );
}

/** The body: the composed surfaces for an envelope, and the read's own refusal stated as the refusal it is. */
function PreferencesBody({ result }: { readonly result: PreferencesResult }): ReactElement {
  switch (result.kind) {
    case "envelope":
      return <MembershipPreferences envelope={result.envelope} />;
    case "denied":
      // A denial states no facts at all: no choice, no language, no address, no count, and no hint that a membership exists.
      return <StateNotice kind="denied" headingLevel={2} title={NOTICE_COPY.denied.title} description={NOTICE_COPY.denied.description} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      // An outage is not an empty preference: the source and the guidance the service stated are what this page reports.
      return <StateNotice kind="unavailable" headingLevel={2} title={NOTICE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} />;
    case "refused":
      // The read refused this page's own request, so nothing was read and no permission was refused.
      return <StateNotice kind="refused" headingLevel={2} title={NOTICE_COPY.refused.title} />;
    default:
      return assertNever(result, "Unhandled preferences read result");
  }
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** The reader's own preferences and consent surface, read directly from the service for this request. */
export default async function ReaderPreferencesPage(): Promise<ReactElement> {
  const result = await reads.audience.readPreferences();
  return (
    <section aria-labelledby={HEADING_ID} className={WRAPPER_CLASS}>
      {/* The one h1 on this route: the proof surface continues below it at level two, and the surfaces that label
          themselves with a fieldset legend add no heading of their own. */}
      <h1 id={HEADING_ID} className={H1_CLASS}>
        {PAGE_TITLE}
      </h1>
      <p className={LEDE_CLASS}>{LEDE}</p>
      <PreferencesBody result={result} />
    </section>
  );
}
