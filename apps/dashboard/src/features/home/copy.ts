/**
 * Home's single wording source: the page heading and its lead sentence, the three section headings
 * with their descriptions, empty states and first actions, the short label behind every reason Home
 * can show, and the notices a section renders in place of items.
 *
 * No value is stated here. A phrase that needs a variable — a count, a period, a last-seen time —
 * arrives from the read envelope as text, so this module formats nothing and states no number, date,
 * amount or percentage of its own. Effect labelling is owned once, by `components/simulation-label`,
 * and is never restated or paraphrased here.
 */
import type { HomeReasonCode, HomeSectionKey } from "./home-schema";

// The page
/** Home's `h1` and the one sentence that answers the question the page exists to answer: who needs the worker's attention. */
export const HOME_COPY: { title: string; lead: string } = {
  title: "Home",
  lead: "Start here: what needs your attention, what changed, and what you left open.",
};

// The three sections
/** One section as Home renders it: its heading, what the section holds, what it says when it holds nothing, and the real destination its first action opens. */
export type SectionCopy = {
  heading: string;
  description: string;
  emptyTitle: string;
  emptyBody: string;
  firstAction: { label: string; href: string };
};

/**
 * The three sections, keyed by the closed set in `home-schema` so a section added there fails to
 * compile until it is worded here. Every first action is a route of this application the worker can
 * act from: an empty section offers the job that fills it, never a placeholder and never an illustration.
 */
export const SECTION_COPY: Record<HomeSectionKey, SectionCopy> = {
  attention: {
    heading: "Attention",
    description: "Work that is waiting on a decision or an action from you.",
    emptyTitle: "Nothing needs your attention right now",
    emptyBody: "Nothing here is waiting on a decision or an action from you.",
    firstAction: { label: "Plan your work", href: "/work" },
  },
  information: {
    heading: "Information",
    description: "Things that changed and may matter to your work.",
    emptyTitle: "Nothing new has come in",
    emptyBody: "Nothing has changed since you last looked, so there is nothing to catch up on here.",
    firstAction: { label: "Open Partners", href: "/partners" },
  },
  "unfinished-work": {
    heading: "Unfinished work",
    description: "Drafts, reviews and follow-through that you have not finished yet.",
    emptyTitle: "Nothing is left half-done",
    emptyBody: "No draft, review or follow-up of yours is still open.",
    firstAction: { label: "Open Communication", href: "/communication" },
  },
};

// Why an item is here
/**
 * The short label behind each reason code, keyed by the closed set on purpose: a code added to
 * `HOME_REASON_CODES` without a label fails compilation, rather than reaching a row that would have
 * to invent a label of its own.
 */
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
};

/** The label an item carries when the envelope sends a reason code this family does not label. */
export const UNKNOWN_REASON_LABEL = "Needs attention";

/**
 * The description read beside `UNKNOWN_REASON_LABEL`. The fallback keeps the item visible and
 * explained instead of blank, and claims nothing about why it arrived.
 */
export const UNKNOWN_REASON_LABEL_NOTE = "This item is listed because something about it needs your attention, and the reason it arrived with is not one this page can name yet.";

// The notices a section renders instead of items
/** The heading and the sentence of one notice. */
export type NoticeCopy = { title: string; body: string };

/**
 * The three notices a section shows in place of items. Home is rendered on the server, so a section
 * either arrives already read or reports why it could not be. There is deliberately no loading state
 * to render: the third entry says so in words, so a caller that asks for one gets an honest sentence
 * rather than an invented spinner.
 */
export const NOTICE_COPY = {
  unavailable: {
    title: "This section is unavailable right now",
    body: "Its source could not be read, so there is nothing to show here. The rest of Home still works, and reloading asks the source again.",
  },
  denied: {
    title: "This section is not available to you",
    body: "Your current access does not include this section, so nothing from it is shown here.",
  },
  loadingUnsupported: {
    title: "There is nothing to wait for",
    body: "Home is rendered on the server, so a section arrives already read or says why it could not be. No separate loading state is shown.",
  },
} satisfies Record<"unavailable" | "denied" | "loadingUnsupported", NoticeCopy>;

// An item no row can open
/** What a row shows when an item fails validation: the item stays listed so it is not lost, and the row says why it has no destination. */
export const INCOMPLETE_ITEM_COPY: NoticeCopy = {
  title: "This item cannot be opened right now",
  body: "It is still listed so it is not lost, but the details it needs did not arrive, so it has no destination yet.",
};
