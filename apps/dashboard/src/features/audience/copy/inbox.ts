/**
 * The synthetic inbox's words: the two tabs that show one produced message, the state of an inbox
 * that holds nothing yet, the statement a protected notice carries, the one-copy rule the inbox is
 * checked against, and the disclosure effect the surface shows beside the message.
 *
 * The inbox is where a reader inspects what a notification produced — the message this application
 * keeps, shown as rendered HTML and as plain text from the same stored revision (AAP 0.10.1 family
 * 10). Communication outcomes stay distinct in every sentence here: a submission this application
 * accepted is not a message that reached anyone, so nothing below says one arrived, that a person
 * was contacted, saw or answered it, or that a copy already held can be recalled (Rule 1 clause 3;
 * AAP 0.8.5).
 *
 * This module holds sentences and one effect constant. It reads no clock, formats no date, performs
 * no I/O and computes no count. The five disclosure sentences for a simulated effect live in
 * `SIMULATION_LABELS` in `@/components/simulation-label`, the send-state words live in
 * `@/components/status-badge`, and the empty, unavailable and denied presentations live in
 * `@/components/state-notice`, so none of those three vocabularies is restated here.
 */
import type { SimulatedEffect } from "@/components/simulation-label";

/**
 * The disclosure the inbox shows beside the message it produced: the sentence itself comes from
 * `SIMULATION_LABELS["mail-submission"]` and is never restated here, and `satisfies` holds the
 * constant inside that closed union so a renamed member or a mistyped literal fails to compile
 * instead of leaving the effect unlabelled.
 */
export const INBOX_SIMULATION_EFFECT = "mail-submission" as const satisfies SimulatedEffect;

/**
 * The two views of one produced message. `plain` is a real rendering of the stored revision,
 * produced by the same server-side renderer path as `html` rather than a note about the HTML, so a
 * reader who takes only the text view loses no wording.
 */
export const INBOX_TAB_LABELS = {
  html: "HTML",
  plain: "Plain text",
} as const;

/**
 * A genuinely quiet inbox: nothing has been produced for this membership yet, which is a different
 * fact from a source that cannot be read. An unreadable source is reported by its own notice, so the
 * wording here offers the next honest step instead of describing an absence of information.
 */
export const INBOX_EMPTY_COPY: { title: string; description: string } = {
  title: "No message has been produced for this membership yet",
  description:
    "A message appears here once this publisher has published an Update and a notice has been " +
    "submitted for this membership's purpose. Staying on Immediate means the next publication " +
    "produces the first one. An inbox that cannot be read at all is reported separately as a " +
    "source that is unavailable, so a list holding nothing here always means nothing yet.",
};

/**
 * What a protected notice is: a minimal link-only message whose sender, subject and wording stay
 * safe to hold without access, and which omits every protected artefact rather than hinting at one.
 */
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
  linkStatement:
    "Following the link checks the reader's current access again, so access is decided at the link " +
    "rather than taken from the message that carried it.",
  absenceStatement:
    "The missing content is deliberate rather than a fault: a message that had to stay readable " +
    "without access would defeat the protection, so there is nothing to retry and nothing " +
    "incomplete about it.",
};

/**
 * The one-copy rule the inbox is checked against: publisher, purpose, recipient and notification
 * intent are the dedupe key (AAP 0.8.5; criterion 11), so a second copy of one intent is a defect to
 * fix at its cause, and an unknown outcome is re-queried on the same operation instead of submitted
 * afresh.
 */
export const ONE_COPY_STATEMENT =
  "One notification intent produces one message for one recipient. The inbox is checked against " +
  "this rule, so a second copy of the same intent is a defect to fix at its cause rather than a " +
  "state this screen explains or an action it offers to repeat. When a submission's outcome is " +
  "unknown, the check is repeated on the same operation, which returns the result already recorded.";

/**
 * The inbox surface's own heading, naming what the list holds rather than repeating a navigation
 * label from the shell.
 */
export const INBOX_HEADING = "Messages produced for this membership";
