import type { reads } from "@/modules/data-service";
import type { HomeReasonCode, HomeSectionKey } from "./home-schema";
export type HomeReasonKey = Extract<Awaited<ReturnType<typeof reads.context.readHome>>, { readonly kind: "envelope" }>["envelope"]["data"]["items"][number]["reason"];
export const HOME_COPY: { title: string; lead: string } = { title: "Home", lead: "Here’s what needs your attention, what’s changed recently, and what’s still in progress." };
export type SectionCopy = { heading: string; description: string; emptyTitle: string; emptyBody: string; firstAction: { label: string; href: string } };
export const SECTION_COPY: Record<HomeSectionKey, SectionCopy> = {
  attention: { heading: "Needs your attention", description: "Overdue follow-ups, commitments to check on, and items waiting for your decision.", emptyTitle: "You’re all caught up", emptyBody: "Nothing is waiting on a decision or follow-up right now.", firstAction: { label: "Open Tasks", href: "/work" } },
  information: { heading: "Recent updates & support", description: "Recent gifts, partner activity, and milestones to keep on your radar.", emptyTitle: "Nothing new since you last checked", emptyBody: "Recent gifts, referrals, and logged partner activity will appear here.", firstAction: { label: "View Partners", href: "/partners" } },
  "unfinished-work": { heading: "In progress", description: "Saved drafts, reviews, and imports ready to pick back up.", emptyTitle: "No drafts or open reviews", emptyBody: "Start a ministry update or add a follow-up task whenever you’re ready.", firstAction: { label: "Write an update", href: "/communication" } },
};
export const REASON_LABELS: Record<HomeReasonCode, string> = {
  overdue: "Overdue",
  "due-today": "Due today",
  "plan-needs-review": "Plan needs review",
  "draft-saved": "Draft saved",
  "awaiting-review": "Awaiting review",
  "notice-needs-attention": "Email notice issue",
  "response-recorded": "Activity logged",
  "referral-incomplete-date": "Referral date incomplete",
  "import-needs-review": "Import needs review",
  "target-needs-attention": "Coaching target",
  "source-unavailable": "Source unavailable",
  upcoming: "Upcoming",
  undated: "No due date",
  "commitment-needs-attention": "Commitment needs attention",
  "support-received": "Support received",
  "referral-window-active": "Referral window open",
  "referral-window-expired": "Referral window closed",
};
export const UNKNOWN_REASON_LABEL = "Needs attention";
export type HomeItemWording = { readonly code: HomeReasonCode; readonly destinationLabel: string; readonly fallbackTitle: string; readonly sentence: string };
export const ITEM_WORDING: Record<HomeReasonKey, HomeItemWording> = {
  "task-overdue": { code: "overdue", destinationLabel: "Open Tasks", fallbackTitle: "Task", sentence: "This task is past its due date and still open." },
  "task-due-today": { code: "due-today", destinationLabel: "Open Tasks", fallbackTitle: "Task", sentence: "This task is due today." },
  "task-upcoming": { code: "upcoming", destinationLabel: "Open Tasks", fallbackTitle: "Task", sentence: "This task is coming up soon." },
  "task-undated": { code: "undated", destinationLabel: "Open Tasks", fallbackTitle: "Task", sentence: "This task doesn’t have a due date yet." },
  "series-plan-needs-review": { code: "plan-needs-review", destinationLabel: "Review repeating plan", fallbackTitle: "Repeating plan", sentence: "A few dates passed on this repeating plan — choose how to continue." },
  "commitment-needs-attention": { code: "commitment-needs-attention", destinationLabel: "View commitment", fallbackTitle: "Commitment", sentence: "This recurring commitment needs a quick check." },
  "support-received-this-period": { code: "support-received", destinationLabel: "Open Support", fallbackTitle: "Monthly support", sentence: "View received support for this period with currency and coverage details." },
  "interaction-recorded": { code: "response-recorded", destinationLabel: "View partner", fallbackTitle: "Partner activity", sentence: "Recent activity was logged with this partner." },
  "referral-window-active": { code: "referral-window-active", destinationLabel: "View referral", fallbackTitle: "Referral", sentence: "This referral’s follow-up window is currently open." },
  "referral-window-expired": { code: "referral-window-expired", destinationLabel: "View referral", fallbackTitle: "Referral", sentence: "This referral’s follow-up window has closed." },
  "target-placed-on-home": { code: "target-needs-attention", destinationLabel: "Open Targets", fallbackTitle: "Coaching target", sentence: "Pinned coaching target tracked from your logged activity." },
  "draft-saved": { code: "draft-saved", destinationLabel: "Continue draft", fallbackTitle: "Update draft", sentence: "Saved draft ready to finish or submit for review." },
  "candidate-awaiting-review": { code: "awaiting-review", destinationLabel: "Open review", fallbackTitle: "Pending review", sentence: "Submitted edition waiting for review." },
  "import-awaiting-decisions": { code: "import-needs-review", destinationLabel: "Resume import", fallbackTitle: "Contact import", sentence: "This contact import is waiting for you to review and confirm rows." },
  "notification-needs-attention": { code: "notice-needs-attention", destinationLabel: "Open Send history", fallbackTitle: "Update notification", sentence: "One or more partner notifications need attention in Send history." },
};
export type NoticeCopy = { title: string; body: string };
export const NOTICE_COPY = {
  unavailable: { title: "Couldn’t load this section", body: "We couldn’t reach the data source for this section right now. The rest of Home still works — reload to try again." },
  denied: { title: "You don’t have access to this section", body: "Your current session doesn’t include access to this section." },
  refused: { title: "Couldn’t load this section", body: "This section’s request couldn’t be run right now. The rest of Home still works." },
  loadingUnsupported: { title: "Already loaded", body: "Home loads with the page, so no separate loading step is needed." },
} satisfies Record<"unavailable" | "denied" | "refused" | "loadingUnsupported", NoticeCopy>;
export const INCOMPLETE_ITEM_COPY: NoticeCopy = { title: "Couldn’t open this item yet", body: "It’s kept in your list so nothing is lost, but its link details didn’t load." };
