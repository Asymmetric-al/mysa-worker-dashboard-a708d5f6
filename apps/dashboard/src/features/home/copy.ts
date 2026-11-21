/**
 * Home's single wording source: the page heading and its lead sentence, the three section headings
 * with their descriptions, empty states and first actions, the short label behind every reason Home
 * can show, the wording every reason the Home read states arrives with, and the notices a section
 * renders in place of items.
 *
 * No value is stated here. A phrase that needs a variable — a count, a period, a last-seen time —
 * arrives from the read envelope as text, so this module formats nothing and states no number, date,
 * amount or percentage of its own. Effect labelling is owned once, by `components/simulation-label`,
 * and is never restated or paraphrased here.
 */
import type { reads } from "@/modules/data-service";
import type { HomeReasonCode, HomeSectionKey } from "./home-schema";

// The reason vocabulary the Home read states
/**
 * The reasons `readHome` answers with, taken from the read itself rather than restated. A type-only
 * import of the service erases at build time, so naming the service here pulls no store, no session
 * and no handler into a client bundle; it only makes this file fail to compile when the service's
 * vocabulary moves.
 */
type HomeReadData = Extract<Awaited<ReturnType<typeof reads.context.readHome>>, { readonly kind: "envelope" }>["envelope"]["data"];

/** Why one item is on Home, in the service's own kebab-case vocabulary. */
export type HomeReasonKey = HomeReadData["items"][number]["reason"];

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
  upcoming: "Upcoming",
  undated: "Undated",
  "commitment-needs-attention": "Commitment needs attention",
  "support-received": "Support received",
  "referral-window-active": "Referral window open",
  "referral-window-expired": "Referral window expired",
};

/** The label an item carries when the envelope sends a reason code this family does not label. */
export const UNKNOWN_REASON_LABEL = "Needs attention";

/**
 * The description read beside `UNKNOWN_REASON_LABEL`. The fallback keeps the item visible and
 * explained instead of blank, and claims nothing about why it arrived.
 */
export const UNKNOWN_REASON_LABEL_NOTE = "This item is listed because something about it needs your attention, and the reason it arrived with is not one this page can name yet.";

/**
 * The wording one service reason arrives with: the badge code the row labels it with, the words on
 * the destination link, the subject to show when the envelope states no label, and the one sentence
 * saying why the item is on Home.
 */
export type HomeItemWording = {
  /** The short label code the row renders as a badge. */
  readonly code: HomeReasonCode;
  /** The words shown on the destination link. */
  readonly destinationLabel: string;
  /** The subject to show when the envelope states no label for the item. */
  readonly fallbackTitle: string;
  /** One sentence saying why the item is on Home. States no number, date, amount or percentage. */
  readonly sentence: string;
};

/**
 * Every reason `readHome` can state, worded once.
 *
 * The table is total on purpose: it is keyed by the service's own closed vocabulary and typed as a
 * `Record`, never a `Partial` and never a lookup with a fallback, so a reason added to the service
 * fails this file's compilation until it has words. A fallback would let a new reason reach a row
 * that had to invent its own sentence, which is exactly the guesswork this table exists to prevent.
 *
 * A sentence states no value. Anything a reader needs as a figure, a date, an amount or a currency
 * lives at the destination the row links to, which states it with its own coverage and basis; the
 * item's own support figure is deliberately not restated here, and the contents of an item's detail
 * line arrive from the envelope as text.
 */
export const ITEM_WORDING: Record<HomeReasonKey, HomeItemWording> = {
  "task-overdue": {
    code: "overdue",
    destinationLabel: "Open Work",
    fallbackTitle: "Task",
    sentence: "This task is past the day it was due and is still open.",
  },
  "task-due-today": {
    code: "due-today",
    destinationLabel: "Open Work",
    fallbackTitle: "Task",
    sentence: "This task is due today and is still open.",
  },
  "task-upcoming": {
    code: "upcoming",
    destinationLabel: "Open Work",
    fallbackTitle: "Task",
    sentence: "This task is dated after today and is still open.",
  },
  "task-undated": {
    code: "undated",
    destinationLabel: "Open Work",
    fallbackTitle: "Task",
    sentence: "This task has no date the calendar can read, so the Work list is where its date is decided.",
  },
  "series-plan-needs-review": {
    code: "plan-needs-review",
    destinationLabel: "Review the series",
    fallbackTitle: "Recurring series",
    sentence: "This recurring series has missed occurrences and its plan needs review.",
  },
  "commitment-needs-attention": {
    code: "commitment-needs-attention",
    destinationLabel: "Open the commitment",
    fallbackTitle: "Commitment",
    sentence: "The recorded outcome of this commitment needs attention.",
  },
  "support-received-this-period": {
    code: "support-received",
    destinationLabel: "Open Support",
    fallbackTitle: "Received support",
    sentence: "Received support for the current period is stated by Support, with the amounts, currencies and coverage it was read under.",
  },
  "interaction-recorded": {
    code: "response-recorded",
    destinationLabel: "Open the partner",
    fallbackTitle: "Interaction",
    sentence: "An interaction with this partner was recorded recently.",
  },
  "referral-window-active": {
    code: "referral-window-active",
    destinationLabel: "Open the referral",
    fallbackTitle: "Referral",
    sentence: "This referral's New window is open now.",
  },
  "referral-window-expired": {
    code: "referral-window-expired",
    destinationLabel: "Open the referral",
    fallbackTitle: "Referral",
    sentence: "This referral's New window has closed, and the referral states what that leaves.",
  },
  "target-placed-on-home": {
    code: "target-needs-attention",
    destinationLabel: "Open Targets",
    fallbackTitle: "Coaching target",
    sentence: "This coaching target is placed on Home and counts only from recorded activity.",
  },
  "draft-saved": {
    code: "draft-saved",
    destinationLabel: "Resume the draft",
    fallbackTitle: "Content draft",
    sentence: "A draft of this edition is saved and has not been sent for review.",
  },
  "candidate-awaiting-review": {
    code: "awaiting-review",
    destinationLabel: "Open the review",
    fallbackTitle: "Content candidate",
    sentence: "This edition is frozen as a candidate and is waiting for review.",
  },
  "import-awaiting-decisions": {
    code: "import-needs-review",
    destinationLabel: "Open the import",
    fallbackTitle: "Contact import",
    sentence: "This contact import is waiting for its row decisions.",
  },
  "notification-needs-attention": {
    code: "notice-needs-attention",
    destinationLabel: "Open Delivery",
    fallbackTitle: "Notification",
    sentence: "A notification for this published edition needs attention, and Delivery records what each send came back as.",
  },
};

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
