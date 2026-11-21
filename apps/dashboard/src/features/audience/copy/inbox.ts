/**
 * The synthetic inbox's words: the two tabs that show one produced message, the state of an inbox that
 * holds nothing yet, the statement a protected notice carries, the one-copy rule the inbox is checked
 * against, and the disclosure effect the surface shows beside the message.
 */
import type { SimulatedEffect } from "@/components/simulation-label";
/** The disclosure the inbox shows beside the message it produced: the sentence itself comes from `SIMULATION_LABELS["mail-submission"]` and is never restated here, and `satisfies` holds the. */
export const INBOX_SIMULATION_EFFECT = "mail-submission" as const satisfies SimulatedEffect;
/** The two views of one produced message. */
export const INBOX_TAB_LABELS = {
  html: "HTML",
  plain: "Plain text",
} as const;
/** A genuinely quiet inbox: nothing has been produced for this membership yet, which is a different fact from a source that cannot be read. */
export const INBOX_EMPTY_COPY: { title: string; description: string } = {
  title: "No message has been produced for this membership yet",
  description:
    "A message appears here once this publisher has published an Update and a notice has been " +
    "submitted for this membership's purpose. Staying on Immediate means the next publication " +
    "produces the first one. An inbox that cannot be read at all is reported separately as a " +
    "source that is unavailable, so a list holding nothing here always means nothing yet.",
};
/** What a protected notice is: a minimal link-only message whose sender, subject and wording stay safe to hold without access, and which omits every protected artefact rather than hinting at. */
export const PROTECTED_NOTICE_COPY: {
  heading: string;
  description: string;
  linkStatement: string;
  absenceStatement: string;
} = {
  heading: "A protected Update arrives as a link, not as the Update itself",
  description:
    "The message carries a sender, a subject and a link. It holds no protected prose, no image, no " +
    "location, no poster, no transcript and no caption, and it carries no hidden alternative such " +
    "as a preview snippet, alternative text or an attachment.",
  linkStatement: "Following the link checks the reader's current access again, so access is decided at the link " + "rather than taken from the message that carried it.",
  absenceStatement:
    "The missing content is deliberate rather than a fault: a message that had to stay readable " +
    "without access would defeat the protection, so there is nothing to retry and nothing " +
    "incomplete about it.",
};
/** The one-copy rule the inbox is checked against: publisher, purpose, recipient and notification intent are the dedupe key (AAP 0.8.5; criterion 11), so a second copy of one intent is a. */
export const ONE_COPY_STATEMENT =
  "One notification intent produces one message for one recipient. The inbox is checked against " +
  "this rule, so a second copy of the same intent is a defect to fix at its cause rather than a " +
  "state this screen explains or an action it offers to repeat. When a submission's outcome is " +
  "unknown, the check is repeated on the same operation, which returns the result already recorded.";
/** The inbox surface's own heading, naming what the list holds rather than repeating a navigation label from the shell. */
export const INBOX_HEADING = "Messages produced for this membership";
