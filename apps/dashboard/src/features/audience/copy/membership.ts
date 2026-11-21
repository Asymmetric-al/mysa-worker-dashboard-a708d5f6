/**
 * The Audience family's words for what a membership is: the four states one person's
 * purpose-specific relationship to one publisher's Update email can be read in, the eight reasons a
 * member of that audience receives no notice, the two dispositions a source system places on a row it
 * supplies, the two headings the counts sit under, the human name of the purpose, the membership
 * table's headings, and the statement that a subscribed-style flag is not consent.
 *
 * Plan items that put this file in scope:
 * - AAP 0.9.1 tree row `features/audience/**` and the 0.11.1 deliverable row for the audience
 *   family; AAP 0.10.1 family 10 requires the audience surface to state its four membership states,
 *   its two choices and what actually makes a member eligible.
 * - AAP 0.8.5 consent, publication and notification rows: the audience offers only Off and
 *   Immediate; the membership states are exactly the four below; a held or unqualified source
 *   membership is excluded and never silently activated; a `subscribed` flag is not consent;
 *   importing or editing a contact never subscribes anyone; a late signup never expands an accepted
 *   notification ceiling.
 * - AAP 0.3.4 row "Audience membership and consent": the decision itself lives in
 *   `@/modules/audience/*`. This file supplies words for it and decides nothing.
 * - Acceptance criteria 10 and 11, which read these sentences through the audience view, the
 *   notification preview and the synthetic inbox.
 *
 * This module holds sentences and nothing else. It reads no clock, parses no instant, counts
 * nothing, computes no percentage and decides no consent: the eligible and excluded counts are the
 * service's own answer, and the suffixes in `MEMBERSHIP_STATE_DESCRIPTIONS` only say what a number
 * means. The confirmation window's length is not restated here either — `@/modules/time/window`
 * owns the boundary and `@/features/audience/copy/preferences` states it — so the
 * `confirmation-expired` sentence below refers to the closed window in words only.
 *
 * One implementation per vocabulary. The short state label words, the four membership state words
 * among them, live in `@/components/status-badge` and render through `StatusBadge`; the five
 * simulated-effect sentences live in `@/components/simulation-label`; the Development data label
 * belongs to the shell's `dev-banner`. None of the three is restated, extended or re-exported here,
 * and this file imports none of them: a second copy of a label word is how one state comes to be
 * spelled two ways in one application.
 *
 * Four facts stay four facts in these words, because a reader acts on what they say. A preference is
 * not a subscription, a membership is not contact permission, an address is a value rather than a
 * join key, and an exclusion is a statement about this publisher and this purpose rather than a hint
 * that some other record exists. Publication, notification submission, provider acceptance, delivery
 * and reading also stay separate: no sentence below claims that a notice left this application,
 * reached anyone or was opened.
 *
 * Every map here is a total `Record` over the union its domain module declares — `MembershipState`,
 * `ExclusionReason`, `SourceMembershipDisposition`, `AudiencePurpose` and `NonConsentEvidence` — so a
 * member added or renamed there fails to compile here until it has words, instead of rendering as a
 * blank chip or a missing label.
 */
import { NON_CONSENT_EVIDENCE, type NonConsentEvidence } from "@/modules/audience/consent";
import {
  UPDATE_EMAIL_PURPOSE,
  type AudiencePurpose,
  type MembershipState,
  type SourceMembershipDisposition,
} from "@/modules/audience/membership";
import type { ExclusionReason } from "@/modules/audience/resolve";

// ---------------------------------------------------------------------------------------------
// The four membership states
// ---------------------------------------------------------------------------------------------

/** What one state's words consist of: its explanation, and the suffix a count is rendered with. */
type MembershipStateDescription = {
  /** What the state means, in plain sentences. */
  readonly description: string;
  /** Appended to a count, as in "8 eligible for this publisher and this purpose". */
  readonly eligibleSuffix: string;
};

/**
 * The four states, in the order `@/modules/audience/membership` declares them, each explained once.
 *
 * The three non-active states are kept apart deliberately, because they are three different facts
 * and a reader has a different next step for each: an address waiting for proof, a choice the person
 * made, and a limitation the source imposed. Only `active` is eligible for this purpose, and every
 * sentence says what the state leaves untouched.
 */
export const MEMBERSHIP_STATE_DESCRIPTIONS: Record<MembershipState, MembershipStateDescription> = {
  active: {
    description:
      "This person consented to this publisher's Update email for this purpose and confirmed the address, so the membership is active. That consent covers this publisher and this purpose only, and it is not contact permission for anything else.",
    eligibleSuffix: "eligible for this publisher and this purpose",
  },
  "awaiting-proof": {
    description:
      "This person asked to receive this publisher's notices for this purpose, and the address is not proven yet. The membership is therefore neither consent nor eligible: eligibility begins only after the person confirms the address explicitly.",
    eligibleSuffix: "not eligible until the address is confirmed",
  },
  off: {
    description:
      "This person chose Off for this publisher's Update email for this purpose. The choice covers this publisher and this purpose only, so other publishers, other purposes and the person's other records are unchanged.",
    eligibleSuffix: "not eligible, because the person chose Off",
  },
  restricted: {
    description:
      "A restriction excludes this membership from this publisher's Update email for this purpose. A restricted membership is never silently re-activated, and a restriction is a limitation rather than a preference, so no hidden record is implied.",
    eligibleSuffix: "not eligible, because a restriction applies",
  },
};

// ---------------------------------------------------------------------------------------------
// Why one member of the audience receives no notice
// ---------------------------------------------------------------------------------------------

/**
 * The eight exclusion reasons, each a sentence that cannot be mistaken for another.
 *
 * The reasons are not degrees of one refusal. `off` and `unsubscribed` are both the person's own
 * decision and differ in what happened before it, `restricted`, `held` and `unqualified` are three
 * source-side answers, `awaiting-proof` and `confirmation-expired` differ by whether the window is
 * still open, and `signed-up-after-intent` is a statement about this send's accepted ceiling rather
 * than about the person at all.
 */
export const EXCLUSION_REASON_COPY: Record<ExclusionReason, string> = {
  restricted:
    "A restriction excludes this person from this publisher's Update email for this purpose, and a restriction is not a preference the person made.",
  off: "The person's own Off choice for this publisher and this purpose excludes this membership, and that choice is not a restriction.",
  unsubscribed:
    "The person unsubscribed from this publisher and this purpose, which is a different history from an address that was never confirmed: the address had been confirmed and the person then turned these notices off.",
  "awaiting-proof":
    "The address is unconfirmed, so there is no consent and no eligibility yet; eligibility begins only after an explicit confirmation.",
  "confirmation-expired":
    "The confirmation window closed without an explicit confirmation, and reloading the page, retrying or resending the message never extends it.",
  held: "The source system holds this row back, so it is excluded and never silently activated.",
  unqualified:
    "This row does not qualify for this publisher's Update email for this purpose, so it is excluded and never silently activated.",
  "signed-up-after-intent":
    "This person signed up after this notification's intent was accepted, and a late signup never expands an accepted ceiling, so this signup is not part of this send.",
};

// ---------------------------------------------------------------------------------------------
// The two dispositions a source system places on a row it supplies
// ---------------------------------------------------------------------------------------------

/**
 * `held` and `unqualified` in the source system's own terms, so a surface can explain a row it did
 * not create without translating the source's judgement into the person's wishes.
 *
 * Neither disposition is a preference, neither is a restriction the application imposed, and
 * neither is ever turned on by a later preference change or confirmation.
 */
export const SOURCE_DISPOSITION_COPY: Record<SourceMembershipDisposition, string> = {
  held: "The source system holds this row back: the membership is excluded, it is never silently activated, and the disposition says nothing about what the person wants.",
  unqualified:
    "The source system does not qualify this row for this purpose: the membership is excluded, it is never silently activated, and the disposition says nothing about what the person wants.",
};

// ---------------------------------------------------------------------------------------------
// The two headings the counts sit under, and the purpose's own name
// ---------------------------------------------------------------------------------------------

/**
 * The heading over the memberships the service counted as eligible for this publisher and purpose.
 *
 * Each heading labels a count the service produced, never a count a surface derived: the audience
 * view and the notification preview render the two lists the service returned, so the words here
 * name the grouping and say nothing about how large it ought to be.
 */
export const ELIGIBLE_HEADING = "Eligible for this purpose";

/**
 * The heading over the memberships the service excluded, whose reasons `EXCLUSION_REASON_COPY`
 * explains one by one. A member appears under this heading with a stated reason, so exclusion never
 * reads as an unexplained absence.
 */
export const EXCLUDED_HEADING = "Excluded from this purpose";

/**
 * The human name of each purpose, keyed by the constant `@/modules/audience/membership` declares
 * rather than by a retyped string, so a second purpose added there fails to compile here until it
 * has a name instead of reaching a surface as a raw identifier.
 *
 * "Update email" is deliberately narrow: it names the one thing this membership covers, which is the
 * notice this publisher sends when it publishes an Update. It is not a newsletter, not a general
 * mailing list and not a permission to contact the person by any other means.
 */
export const PURPOSE_LABEL: Record<AudiencePurpose, string> = {
  [UPDATE_EMAIL_PURPOSE]: "Update email",
};

// ---------------------------------------------------------------------------------------------
// The membership table's headings
// ---------------------------------------------------------------------------------------------

/** Every heading the membership table renders, so one table has one set of words. */
type MembershipColumnHeadingSet = {
  /** The table's accessible caption, naming what the table holds rather than repeating a nav label. */
  readonly caption: string;
  readonly identity: string;
  readonly emailValue: string;
  readonly state: string;
  readonly languagePreference: string;
  readonly purpose: string;
  readonly since: string;
  readonly exclusionReason: string;
};

/**
 * The headings, each stating the fact it labels in the terms the domain keeps.
 *
 * `emailValue` says in the heading itself that the address is a value: an address is never a join
 * key, two records holding the same address remain two memberships, and holding one proves nothing
 * about who can read it. `languagePreference` says in the heading itself that it is a preference,
 * because a language choice neither subscribes nor unsubscribes anyone and is not proof of anything.
 * `exclusionReason` sits beside the excluded rows, where each reason has a sentence.
 */
export const MEMBERSHIP_COLUMN_HEADINGS: MembershipColumnHeadingSet = {
  caption: "Memberships of this publisher's Update email for this purpose",
  identity: "Person",
  emailValue: "Email address (a value only, never a match)",
  state: "State",
  languagePreference: "Language preference (not consent)",
  purpose: "Purpose",
  since: "Recorded since",
  exclusionReason: "Reason for exclusion",
};

// ---------------------------------------------------------------------------------------------
// A subscribed-style flag is not consent
// ---------------------------------------------------------------------------------------------

/**
 * The one sentence the audience view states beside its counts, so a reader never has to infer why a
 * contact they can see does not appear among the eligible memberships.
 *
 * It names the evidence a person's details most often arrive with, and it holds for every kind the
 * consent module records — `NON_CONSENT_HINTS` explains each one: none of them is consent for this
 * publisher and this purpose.
 */
export const NOT_CONSENT_STATEMENT =
  "A subscribed-style flag, an imported row, a contact edit or an existing partner record is not consent to receive this publisher's Update email for this purpose.";

/**
 * The hint shown beside each kind of evidence the application records without treating it as consent.
 * The members are `@/modules/audience/consent`'s own, declared as a total `Record` so a new kind of
 * evidence fails to compile here until it can be explained rather than silently rendering nothing.
 */
const NON_CONSENT_HINT_COPY: Record<NonConsentEvidence, string> = {
  "subscribed-column":
    "A subscribed column that arrived with a source row is a value in that row. The application records it and never treats it as consent.",
  "contact-edit":
    "A contact created or edited in this application holds what a worker entered, and editing a permitted field is never consent to receive notices.",
  "import-row":
    "An accepted import row creates or reuses a contact, and no imported row subscribes anyone to this publisher's Update email.",
  "partner-record":
    "A partner record exists for the work it supports, and neither its existence nor anything a relationship suggests is consent.",
  "language-preference":
    "A language preference describes how a person reads. Choosing a language is not consent to receive notices and does not prove the address can be read.",
};

/**
 * The hints in the order `NON_CONSENT_EVIDENCE` declares them, derived from that declaration rather
 * than listed again, so the words shown and the decision the consent module makes cannot drift apart.
 * Frozen, because these are the application's words and not a surface's to extend.
 */
export const NON_CONSENT_HINTS: readonly string[] = Object.freeze(
  NON_CONSENT_EVIDENCE.map((evidence) => NON_CONSENT_HINT_COPY[evidence]),
);
