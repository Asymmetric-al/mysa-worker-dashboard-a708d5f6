import { SIMULATION_LABELS } from "@/components/simulation-label";
import { MEMBER_CHOICES, type MemberChoice } from "@/modules/audience/membership";
import { CONFIRMATION_WINDOW_HOURS } from "@/modules/time/window";
type PreferenceChoiceCopy = { readonly label: string; readonly description: string; readonly announcement: string };
export const PREFERENCE_CHOICE_COPY: Record<MemberChoice, PreferenceChoiceCopy> = {
  off: {
    label: "Off",
    description: "No notices are submitted for you from this publisher for this purpose. Other publishers, other purposes and every other record about you stay as they are, and this is your own choice rather than a restriction placed on you.",
    announcement: "Off chosen: this publisher's Update email for this purpose is off, and nothing else changed.",
  },
  immediate: {
    label: "Immediate",
    description: "When this publisher publishes an Update, a notice is submitted for this purpose. That submission is simulated inside this application, so it is not a promise that a message reaches you.",
    announcement: "Immediate chosen: a notice is submitted when this publisher publishes, for this purpose only, and nothing else changed.",
  },
};
const CHOICE_PAIR_WORDING = MEMBER_CHOICES.map((choice) => PREFERENCE_CHOICE_COPY[choice].label).join(" and ");
export const LANGUAGE_PREFERENCE_COPY = {
  heading: "Language for this publisher's Update email",
  help: "You can change the language you read this publisher's Updates in whenever you like, and it changes nothing else on this page.",
  separateFromConsent: `Choosing a language is a preference of its own. It does not subscribe you to anything, and it does not switch this publisher's Update email between ${CHOICE_PAIR_WORDING}.`,
  separateFromProof:
    "Choosing a language is not proof that you can read the address this membership is set for. A notice already submitted, and any notice whose outcome is still unknown, keeps the language edition it was pinned to, and changing your language later neither alters that copy nor restarts a confirmation window.",
};
export const PROOF_FLOW_COPY = {
  heading: "Confirm this address for notices",
  requestStep: { label: "Request notices from this publisher", description: "Requesting records a membership that is awaiting proof. It grants nothing yet: no other publisher or purpose is affected, no other record about you changes, and no notice is submitted for you until this address is confirmed." },
  pendingResult: {
    title: "This address is still waiting for confirmation",
    description: `The address has to be confirmed before this membership becomes active. Opening this page, reloading it or previewing a link here is never a confirmation. Notice sending is ${SIMULATION_LABELS["mail-submission"]}, so the confirmation message is the one this page renders.`,
  },
  confirmAction: { label: "Confirm this address", description: "Confirmation happens only when you activate this control yourself. Previewing the message, reloading the page or retrying the request confirms nothing." },
  confirmedState: { title: "This address is confirmed", description: "This publisher's Update email for this purpose is now active for this address. A confirmed membership is not a delivery, and it subscribes you to no other purpose, publisher or record." },
  expiryStatement: `The address can be confirmed within ${CONFIRMATION_WINDOW_HOURS} elapsed hours of accepting. The window is measured in elapsed hours from the moment you accept, and reloading this page, retrying or resending the message never extends it.`,
};
export function CONFIRMATION_DEADLINE_COPY(deadlineLabel: string, expired: boolean): string {
  return expired ? `The confirmation window closed at ${deadlineLabel}. A new request for notices starts a new window.` : `This address can be confirmed until ${deadlineLabel}.`;
}
export const PREFERENCES_ENTRY_COPY: { readonly description: string; readonly linkLabel: string } = {
  description:
    "Your own preference and consent for this publisher's Update email sit on a page of your own: the Off or Immediate choice, the language you read it in, the proof of your address, and turning these notices off. That page states what this session actually holds, including the case where no membership is recorded, and opening it changes nothing.",
  linkLabel: "Open your own preference and consent page for this publisher's Update email",
};
export const UNSUBSCRIBE_COPY = {
  action: "Turn off Update email from {publisher}",
  heading: "Turn off notices from this publisher",
  scopeStatement: "This action changes one membership: Update email from {publisher} for this purpose. Other purposes from this publisher, other publishers and every other record about you stay as they are.",
  confirmationTitle: "Confirm turning off Update email from {publisher}",
  confirmationBody: "No notice is submitted for you when {publisher} publishes an Update. Your language preference stays as it is, and nothing else about your records changes.",
  recallStatement: "A notice that was already submitted cannot be recalled, and a copy kept anywhere else cannot be deleted by this action. Turning notices off stops future notices only.",
  resultStatement: `Only this membership changed: Update email from {publisher} for this purpose is off. Other purposes and other publishers are untouched, and you may choose ${PREFERENCE_CHOICE_COPY.immediate.label} again later.`,
};
