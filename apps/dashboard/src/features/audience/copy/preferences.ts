import { SIMULATION_LABELS } from "@/components/simulation-label";
import { MEMBER_CHOICES, type MemberChoice } from "@/modules/audience/membership";
import { CONFIRMATION_WINDOW_HOURS } from "@/modules/time/window";
export const PREFERENCE_CHOICE_COPY: Record<MemberChoice, { readonly label: string; readonly description: string; readonly announcement: string }> = {
  off: {
    label: "Off",
    description: "Pause email notifications for this ministry. Other ministries and your contact record stay unchanged.",
    announcement: "Email updates turned off for this ministry.",
  },
  immediate: {
    label: "Immediate",
    description: "Receive an email notification whenever a new update is published. (Email sending is simulated in this demo.)",
    announcement: "Email updates set to Immediate for this ministry.",
  },
};
const CHOICE_PAIR_WORDING = MEMBER_CHOICES.map((choice) => PREFERENCE_CHOICE_COPY[choice].label).join(" or ");
export const LANGUAGE_PREFERENCE_COPY = {
  heading: "Preferred reading language",
  help: "Choose the language you prefer for reading updates from this ministry.",
  separateFromConsent: `Choosing a language doesn’t subscribe you or switch notifications between ${CHOICE_PAIR_WORDING}.`,
  separateFromProof: "Changing language applies to future notices only — emails already sent keep their original language, and changing language doesn’t confirm your email address.",
};
export const PROOF_FLOW_COPY = {
  heading: "Confirm your email address",
  requestStep: { label: "Request update emails", description: "Starts a pending subscription for this ministry only. No emails are sent until you confirm your address." },
  pendingResult: {
    title: "Waiting for email confirmation",
    description: `Confirm your address below to activate update emails. Email delivery is ${SIMULATION_LABELS["mail-submission"]}, so the confirmation preview appears right here.`,
  },
  confirmAction: { label: "Confirm email address", description: "Activates email updates only when you click this button — viewing or reloading this page never confirms automatically." },
  confirmedState: { title: "Email address confirmed", description: "Update emails are now active for this ministry only. Your other subscriptions and contact records weren’t changed." },
  expiryStatement: `Confirmation links stay valid for ${CONFIRMATION_WINDOW_HOURS} hours. Reloading or resending doesn’t extend an existing window.`,
};
export const PROOF_MESSAGE_COPY = {
  heading: "Simulated confirmation email",
  senderLabel: "From",
  toLabel: "To",
  subjectLabel: "Subject",
  renderedHere: "Shown inline here instead of being emailed externally. Use the button above to confirm.",
} as const;
export const PROOF_RESEND_COPY = { label: "Show confirmation message again", description: "Re-displays the same confirmation message without creating a new subscription or extending the deadline." } as const;
export const CONFIRMATION_DEADLINE_COPY = (deadlineLabel: string, expired: boolean): string => (expired ? `Confirmation window expired at ${deadlineLabel}. Request update emails again to start a new window.` : `Confirm before ${deadlineLabel}.`);
export const PREFERENCES_ENTRY_COPY: { readonly description: string; readonly linkLabel: string } = {
  description: "Manage how you receive update emails from this ministry: turn emails Off or Immediate, pick a reading language, confirm your address, or unsubscribe.",
  linkLabel: "Manage reader preferences",
};
export const UNSUBSCRIBE_COPY = {
  action: "Unsubscribe from {publisher}",
  heading: "Unsubscribe from update emails",
  scopeStatement: "Turns off update emails from {publisher} only. Your subscriptions with other ministries and your contact record stay unchanged.",
  confirmationTitle: "Unsubscribe from {publisher}?",
  confirmationBody: "You won’t receive future update emails from {publisher}. Your reading language stays saved.",
  recallStatement: "Unsubscribing stops future emails only — messages already sent can’t be recalled.",
  resultStatement: `Update emails from {publisher} are now off. You can switch back to ${PREFERENCE_CHOICE_COPY.immediate.label} anytime.`,
};
