/**
 * The Audience family's only wording for a reader's own preferences: the two choices this
 * publisher's Update email offers, the language preference that stands on its own, the tiny proof
 * journey from request to confirmation, the confirmation deadline as the service resolved it, and
 * the unsubscribe confirmation.
 *
 * This module holds sentences and nothing else. It computes no deadline, no count and no consent
 * decision: `CONFIRMATION_DEADLINE_COPY` formats an instant the service has already resolved, so no
 * clock is read, no instant is parsed and no window is measured here. The offered choices are the
 * closed pair `@/modules/audience/membership` declares and the window's length is the imported
 * `CONFIRMATION_WINDOW_HOURS`, so neither the choice set nor the week it lasts is restated as a
 * literal.
 *
 * Five facts stay five facts in these words, exactly as they do in the domain module: the
 * Off/Immediate choice, the language preference, proof of the address, the membership state, and
 * the fate of a notice already submitted. Publication, notification submission, provider
 * acceptance, delivery and reading are separate outcomes, so no sentence here claims that a notice
 * left this application, reached anyone or was read. Notice sending in this application is
 * simulated, and the canonical sentences that say so are the ones in `@/components/simulation-label`;
 * this file states only what the flow itself does when it has to explain which confirmation message
 * counts, never a second disclaimer.
 */
import { MEMBER_CHOICES, type MemberChoice } from "@/modules/audience/membership";
import { CONFIRMATION_WINDOW_HOURS } from "@/modules/time/window";

/** One choice's words: the label the control shows, the sentence under it, and what a change announces. */
type PreferenceChoiceCopy = {
  readonly label: string;
  readonly description: string;
  readonly announcement: string;
};

/**
 * The two choices' words, keyed by the closed choice set so a third choice added to the membership
 * module leaves this record incomplete and it stops compiling until it is worded here.
 *
 * The labels are the two words themselves, because a reader should not have to interpret a phrase
 * to know which of two choices is which. Both descriptions name what the choice does for this
 * publisher and this purpose only, and both say what it leaves alone: neither choice is a
 * restriction, and neither reaches any other publisher, purpose or record.
 */
export const PREFERENCE_CHOICE_COPY: Record<MemberChoice, PreferenceChoiceCopy> = {
  off: {
    label: "Off",
    description:
      "No notices are submitted for you from this publisher for this purpose. Other publishers, other purposes and every other record about you stay as they are, and this is your own choice rather than a restriction placed on you.",
    announcement:
      "Off chosen: this publisher's Update email for this purpose is off, and nothing else changed.",
  },
  immediate: {
    label: "Immediate",
    description:
      "When this publisher publishes an Update, a notice is submitted for this purpose. That submission is simulated inside this application, so it is not a promise that a message reaches you.",
    announcement:
      "Immediate chosen: a notice is submitted when this publisher publishes, for this purpose only, and nothing else changed.",
  },
};

/**
 * The two choice words in the order `MEMBER_CHOICES` declares, so every sentence that names the
 * pair names it in the same order and in the same words the controls show.
 */
const CHOICE_PAIR_WORDING = MEMBER_CHOICES.map(
  (choice) => PREFERENCE_CHOICE_COPY[choice].label,
).join(" and ");

/**
 * The language preference: its own setting, beside the choice and beside proof, with the three
 * separations a reader needs stated rather than implied.
 */
export const LANGUAGE_PREFERENCE_COPY = {
  heading: "Language for this publisher's Update email",
  help: "You can change the language you read this publisher's Updates in whenever you like, and it changes nothing else on this page.",
  separateFromConsent: `Choosing a language is a preference of its own. It does not subscribe you to anything, and it does not switch this publisher's Update email between ${CHOICE_PAIR_WORDING}.`,
  separateFromProof:
    "Choosing a language is not proof that you can read the address this membership is set for. A notice already submitted, and any notice whose outcome is still unknown, keeps the language edition it was pinned to, and changing your language later neither alters that copy nor restarts a confirmation window.",
};

/**
 * The proof journey, in the five stages a reader moves through: request, neutral pending result,
 * explicit confirmation, confirmed state, and the statement of when the window closes.
 *
 * Every stage states what it does not do. Requesting creates a membership awaiting proof and grants
 * nothing; the pending result is neutral and says the confirmation message is the one this page
 * renders; confirmation happens only when the reader activates it; a confirmed membership is active
 * for this publisher and purpose and still is not a delivery.
 */
export const PROOF_FLOW_COPY = {
  heading: "Confirm this address for notices",
  requestStep: {
    label: "Request notices from this publisher",
    description:
      "Requesting records a membership that is awaiting proof. It grants nothing yet: no other publisher or purpose is affected, no other record about you changes, and no notice is submitted for you until this address is confirmed.",
  },
  pendingResult: {
    title: "This address is still waiting for confirmation",
    description:
      "The address has to be confirmed before this membership becomes active. Opening this page, reloading it or previewing a link here is never a confirmation. Notice sending in this application is simulated, so the confirmation message is the one this page renders and no mail leaves the application.",
  },
  confirmAction: {
    label: "Confirm this address",
    description:
      "Confirmation happens only when you activate this control yourself. Previewing the message, reloading the page or retrying the request confirms nothing.",
  },
  confirmedState: {
    title: "This address is confirmed",
    description:
      "This publisher's Update email for this purpose is now active for this address. A confirmed membership is not a delivery, and it subscribes you to no other purpose, publisher or record.",
  },
  expiryStatement: `The address can be confirmed within ${CONFIRMATION_WINDOW_HOURS} elapsed hours of accepting. The window is measured in elapsed hours from the moment you accept, and reloading this page, retrying or resending the message never extends it.`,
};

/**
 * Formats the confirmation deadline the service resolved. It receives an already-formatted label
 * and reports it, which is the whole of its job: it does not parse, compare, add, subtract or read a
 * clock, so it cannot widen or move the window it describes.
 *
 * The expired branch says the window closed at that instant and that a new request starts a new
 * window, and nothing more: it never suggests the closed window can still be used.
 */
export function CONFIRMATION_DEADLINE_COPY(deadlineLabel: string, expired: boolean): string {
  if (expired) {
    return `The confirmation window closed at ${deadlineLabel}. A new request for notices starts a new window.`;
  }
  return `This address can be confirmed until ${deadlineLabel}.`;
}

/**
 * The unsubscribe confirmation for exactly one membership. The consumer substitutes the publisher's
 * name for the literal `{publisher}`, and the purpose is named as words rather than substituted
 * because this release keeps one purpose.
 *
 * Nothing here promises recall. A notice already submitted cannot be brought back, and a copy kept
 * anywhere else cannot be deleted by this action, so the confirmation says what turning notices off
 * actually reaches: future notices for this publisher and this purpose, and nothing else.
 */
export const UNSUBSCRIBE_COPY = {
  action: "Turn off Update email from {publisher}",
  heading: "Turn off notices from this publisher",
  scopeStatement:
    "This action changes one membership: Update email from {publisher} for this purpose. Other purposes from this publisher, other publishers and every other record about you stay as they are.",
  confirmationTitle: "Confirm turning off Update email from {publisher}",
  confirmationBody:
    "No notice is submitted for you when {publisher} publishes an Update. Your language preference stays as it is, and nothing else about your records changes.",
  recallStatement:
    "A notice that was already submitted cannot be recalled, and a copy kept anywhere else cannot be deleted by this action. Turning notices off stops future notices only.",
  resultStatement: `Only this membership changed: Update email from {publisher} for this purpose is off. Other purposes and other publishers are untouched, and you may choose ${PREFERENCE_CHOICE_COPY.immediate.label} again later.`,
};
