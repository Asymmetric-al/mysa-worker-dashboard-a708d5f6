import type { reads } from "@/modules/data-service";
import type { HomeReasonCode, HomeSectionKey } from "./home-schema";
export type HomeReasonKey = Extract<Awaited<ReturnType<typeof reads.context.readHome>>, { readonly kind: "envelope" }>["envelope"]["data"]["items"][number]["reason"];
export const HOME_COPY: { title: string; lead: string } = { title: "Home", lead: "Start here: what needs your attention, what changed, and what you left open." };
export type SectionCopy = { heading: string; description: string; emptyTitle: string; emptyBody: string; firstAction: { label: string; href: string } };
export const SECTION_COPY: Record<HomeSectionKey, SectionCopy> = {
  attention: { heading: "Attention", description: "Work that is waiting on a decision or an action from you.", emptyTitle: "Nothing needs your attention right now", emptyBody: "Nothing here is waiting on a decision or an action from you.", firstAction: { label: "Plan your work", href: "/work" } },
  information: { heading: "Information", description: "Things that changed and may matter to your work.", emptyTitle: "Nothing new has come in", emptyBody: "Nothing has changed since you last looked, so there is nothing to catch up on here.", firstAction: { label: "Open Partners", href: "/partners" } },
  "unfinished-work": { heading: "Unfinished work", description: "Drafts, reviews and follow-through that you have not finished yet.", emptyTitle: "Nothing is left half-done", emptyBody: "No draft, review or follow-up of yours is still open.", firstAction: { label: "Open Communication", href: "/communication" } },
};
export const REASON_LABELS: Record<HomeReasonCode, string> = {
  overdue: "Overdue",
  "due-today": "Due today",
  "plan-needs-review": "Plan needs review",
  "draft-saved": "Draft saved",
  "awaiting-review": "Awaiting review",
  "notice-needs-attention": "Notification needs attention",
  "response-recorded": "Response recorded",
  "referral-incomplete-date": "Referral date incomplete",
  "import-needs-review": "Import needs review",
  "target-needs-attention": "Target needs attention",
  "source-unavailable": "Source unavailable",
  upcoming: "Upcoming",
  undated: "Undated",
  "commitment-needs-attention": "Commitment needs attention",
  "support-received": "Support received",
  "referral-window-active": "Referral window open",
  "referral-window-expired": "Referral window expired",
};
export const UNKNOWN_REASON_LABEL = "Needs attention";
export type HomeItemWording = { readonly code: HomeReasonCode; readonly destinationLabel: string; readonly fallbackTitle: string; readonly sentence: string };
export const ITEM_WORDING: Record<HomeReasonKey, HomeItemWording> = {
  "task-overdue": { code: "overdue", destinationLabel: "Open Work", fallbackTitle: "Task", sentence: "This task is past the day it was due and is still open." },
  "task-due-today": { code: "due-today", destinationLabel: "Open Work", fallbackTitle: "Task", sentence: "This task is due today and is still open." },
  "task-upcoming": { code: "upcoming", destinationLabel: "Open Work", fallbackTitle: "Task", sentence: "This task is dated after today and is still open." },
  "task-undated": { code: "undated", destinationLabel: "Open Work", fallbackTitle: "Task", sentence: "This task has no date the calendar can read, so the Work list is where its date is decided." },
  "series-plan-needs-review": { code: "plan-needs-review", destinationLabel: "Review the series", fallbackTitle: "Recurring series", sentence: "This recurring series has missed occurrences and its plan needs review." },
  "commitment-needs-attention": { code: "commitment-needs-attention", destinationLabel: "Open the commitment", fallbackTitle: "Commitment", sentence: "The recorded outcome of this commitment needs attention." },
  "support-received-this-period": { code: "support-received", destinationLabel: "Open Support", fallbackTitle: "Received support", sentence: "Received support for the current period is stated by Support, with the amounts, currencies and coverage it was read under." },
  "interaction-recorded": { code: "response-recorded", destinationLabel: "Open the partner", fallbackTitle: "Interaction", sentence: "An interaction with this partner was recorded recently." },
  "referral-window-active": { code: "referral-window-active", destinationLabel: "Open the referral", fallbackTitle: "Referral", sentence: "This referral's New window is open now." },
  "referral-window-expired": { code: "referral-window-expired", destinationLabel: "Open the referral", fallbackTitle: "Referral", sentence: "This referral's New window has closed, and the referral states what that leaves." },
  "target-placed-on-home": { code: "target-needs-attention", destinationLabel: "Open Targets", fallbackTitle: "Coaching target", sentence: "This coaching target is placed on Home and counts only from recorded activity." },
  "draft-saved": { code: "draft-saved", destinationLabel: "Resume the draft", fallbackTitle: "Content draft", sentence: "A draft of this edition is saved and has not been sent for review." },
  "candidate-awaiting-review": { code: "awaiting-review", destinationLabel: "Open the review", fallbackTitle: "Content candidate", sentence: "This edition is frozen as a candidate and is waiting for review." },
  "import-awaiting-decisions": { code: "import-needs-review", destinationLabel: "Open the import", fallbackTitle: "Contact import", sentence: "This contact import is waiting for its row decisions." },
  "notification-needs-attention": { code: "notice-needs-attention", destinationLabel: "Open Delivery", fallbackTitle: "Notification", sentence: "A notification for this published edition needs attention, and Delivery records what each send came back as." },
};
export type NoticeCopy = { title: string; body: string };
export const NOTICE_COPY = {
  unavailable: { title: "This section is unavailable right now", body: "Its source could not be read, so there is nothing to show here. The rest of Home still works, and reloading asks the source again." },
  denied: { title: "This section is not available to you", body: "Your current access does not include this section, so nothing from it is shown here." },
  refused: { title: "This section could not be asked for", body: "Nothing was read for this section, so no item, count or reason is stated here — not an empty section and not a quiet day. The rest of Home still works." },
  loadingUnsupported: { title: "There is nothing to wait for", body: "Home is rendered on the server, so a section arrives already read or says why it could not be. No separate loading state is shown." },
} satisfies Record<"unavailable" | "denied" | "refused" | "loadingUnsupported", NoticeCopy>;
export const INCOMPLETE_ITEM_COPY: NoticeCopy = { title: "This item cannot be opened right now", body: "It is still listed so it is not lost, but the details it needs did not arrive, so it has no destination yet." };
