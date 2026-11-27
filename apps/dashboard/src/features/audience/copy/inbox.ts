import type { SimulatedEffect } from "@/components/simulation-label";
export const INBOX_SIMULATION_EFFECT = "mail-submission" as const satisfies SimulatedEffect;
export const INBOX_TAB_LABELS = { html: "HTML", plain: "Plain text" } as const;
export const INBOX_EMPTY_COPY: { title: string; description: string } = {
  title: "No test emails yet",
  description:
    "Messages appear here after you publish an update with email notifications turned on for an active subscriber. Keep email updates set to Immediate to receive the next simulated email.",
};
export const PROTECTED_NOTICE_COPY: { heading: string; description: string; linkStatement: string; absenceStatement: string } = {
  heading: "Protected updates send a link only",
  description: "For privacy, supporter-only emails include only the sender, subject, and a link — never the body text, photos, locations, videos, captions, or preview snippets.",
  linkStatement: "Opening the link verifies the reader’s current access each time.",
  absenceStatement: "The missing body is intentional so sensitive ministry updates stay protected.",
};
export const ONE_COPY_STATEMENT =
  "Each notification produces at most one email per recipient. Retrying an uncertain send checks the existing operation rather than sending a duplicate.";
export const INBOX_HEADING = "Simulated emails";
