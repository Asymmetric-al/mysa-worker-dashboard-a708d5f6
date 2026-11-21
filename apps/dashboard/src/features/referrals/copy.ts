/**
 * Wording for the Referrals family: the three lists, the precision an introduction date is known to,
 * the New and continued windows, the status words, the permitted Expired history, the Continue action
 * with its refusals, and the labels the introduction itself carries.
 *
 * Every sentence these surfaces render is written here once, so one rule holds in the list, the form
 * and the detail together: a date that is not known admits no deadline, no Active or Expired judgement
 * and no Continue; expiry is not a closure recorded by the source; the moment a record was entered is
 * never the introduction date; and the Expired history is a narrow permission rather than access to the
 * partner record.
 *
 * Nothing here computes a date, a window, a count or a duration. A function in this module interpolates
 * only the values it is handed, so the resolved instant, the number of days and the zone always arrive
 * from the envelope that resolved them and are never re-derived beside it.
 */
import type { DatePrecisionValue, ReferralListQuery } from "./schemas";

/** The three precisions a date can be known to, each with the word the surface shows and the sentence that keeps it honest. */
export const PRECISION_COPY: Readonly<Record<DatePrecisionValue, { readonly label: string; readonly hint: string }>> = {
  date: {
    label: "Known date",
    hint: "The calendar date the introduction happened, recorded as the source states it. A known date is what gives a referral its window.",
  },
  approximate: {
    label: "Approximate",
    hint: "Recorded as it was remembered. An approximation is never turned into a precise date, so no deadline is derived from it.",
  },
  unknown: {
    label: "Unknown",
    hint: "No date is established for this introduction, so none is stored and none is implied.",
  },
};

/**
 * The one sentence that states what a date outside `date` precision costs, rendered by the
 * incomplete-date list and by the detail.
 *
 * It states the rule rather than warning about missing data: there is no deadline to miss, because
 * none was ever derived, so nothing here is late and nothing here is owed.
 */
export const NO_DEADLINE_NOTICE: string =
  "Without a known introduction date there is no deadline, no Active or Expired judgement and no Continue action; this referral is shown exactly as far as its evidence carries.";

/** The one sentence that names the introduction job, so the list's action and the form's heading cannot drift apart. */
export const RECORD_INTRODUCTION_LABEL = "Record an introduction";

/**
 * The labels the original introduction date carries, on the form that records it and on the record it
 * creates.
 *
 * The entry time is labelled and placed as its own fact throughout, because the two are the only place
 * a late entry could be misread: an introduction recorded today may already be Expired, and entering it
 * does not start its window again.
 */
export const INTRODUCED_BY_COPY = {
  formHeading: RECORD_INTRODUCTION_LABEL,
  formHelp: "Record the date the introduction actually happened and how precisely that date is known. That date becomes day one of the referral's New window.",
  originalIntroductionOnLabel: "Original introduction date",
  originalIntroductionOnHelp: "The date the introduction happened, not the date you are entering it today.",
  datePrecisionLabel: "How precisely is this date known?",
  unknownClearsDateNote: "An unknown date states no date at all, so the date is left empty rather than filled with a guess a later reader would treat as evidence.",
  sourceZoneLabel: "Time zone this date is known in",
  sourceZoneHelp: "The date is read in this zone, so the window ends at the same moment however the date is displayed later.",
  sourceReferenceLabel: "Source reference",
  sourceReferenceHelp: "The reference the source system issued. It is shown as it stands, is never read for meaning and is never used to match one record against another.",
  sectionHeading: "Original introduction",
  entryTimeLabel: "Entered in this application",
  entryTimeNote:
    "When this record was entered here is a separate fact from when the introduction happened. Entry time is never shown as the introduction date, and a late entry does not start the window again.",
  saveLabel: "Save introduction",
  cancelLabel: "Cancel",
} as const;

/** One referral list as the surface presents it: what the list is for, and what to do when it holds nothing. */
export interface ReferralViewCopy {
  readonly heading: string;
  readonly explanation: string;
  readonly empty: {
    readonly title: string;
    readonly body: string;
    /** The genuine first action this list offers when it is empty, or `null` where there is no honest action to offer. */
    readonly actionLabel: string | null;
  };
}

/**
 * The three lists, which answer three different questions and are never one filtered list.
 *
 * The key set is the value set of the schema's `list` member, so adding or renaming a list fails
 * typecheck here until the words exist for it.
 */
const REFERRAL_VIEW_COPY = {
  active: {
    heading: "Active",
    explanation: "Introductions whose known date gives them a window that has not ended.",
    empty: {
      title: "Nothing is active right now",
      body: "No referral's window is open. Record an introduction when one is given to you.",
      actionLabel: RECORD_INTRODUCTION_LABEL,
    },
  },
  "incomplete-date": {
    heading: "Incomplete date",
    explanation: "Introductions whose date is approximate or unknown. Evidence of that kind cannot support a deadline or an Active or Expired judgement, so none is shown and none is implied.",
    empty: {
      title: "Nothing is waiting on a date",
      body: "Every introduction you can see has a known date, so nothing is held here.",
      actionLabel: null,
    },
  },
  expired: {
    heading: "Permitted Expired history",
    explanation: "Referrals whose window has ended, shown as a narrow permission for history rather than access to the partner record.",
    empty: {
      title: "No Expired referrals are available to you",
      body: "No ended referral is inside what your permission covers.",
      actionLabel: null,
    },
  },
} as const satisfies Readonly<Record<ReferralListQuery["list"], ReferralViewCopy>>;

/** The list surface: the three lists, the column and control labels a row shows, and what an empty or unmatched list offers. */
export const LIST_COPY = {
  heading: "Referrals",
  recordIntroductionLabel: RECORD_INTRODUCTION_LABEL,
  viewSwitcherLabel: "Referral lists",
  views: REFERRAL_VIEW_COPY,
  columns: {
    partner: "Who was introduced",
    sourceReference: "Source reference",
    originalIntroductionOn: "Original introduction date",
    datePrecision: "Date precision",
    status: "Status",
    windowEnd: "Window ends",
  },
  columnHelp: {
    windowEnd: "Shown where the envelope resolved a window. A referral whose date is approximate or unknown has no window end, which is a fact about its evidence rather than a missing number.",
  },
  noWindowEndLabel: "No window end",
  search: {
    label: "Search referrals",
    placeholder: "A name or a source reference",
    hint: "Search covers the facts this list is permitted to show, and it runs over the whole authorised result rather than the page you are looking at.",
    empty: {
      title: "No referral matches this search",
      body: "Nothing in this list matches the words you entered. Clearing the search shows the list again.",
      actionLabel: "Clear the search",
    },
  },
  sort: {
    label: "Order",
    fieldLabels: {
      windowEnd: "Window end, latest first",
      originalIntroductionOn: "Introduction date, newest first",
    },
  },
} as const;

/**
 * The caption above a list's rows: which list this is, and how many referrals the whole authorised
 * result holds. Both are handed in by the envelope, and the count is the whole result rather than the
 * page, so one page never reads as the whole answer.
 */
export function listCountCaption(query: ReferralListQuery, total: number): string {
  const { heading } = LIST_COPY.views[query.list];
  const noun = total === 1 ? "referral" : "referrals";
  return `${heading}: ${total} ${noun} in the whole result.`;
}

/**
 * The New window, worded so the calendar statement and the resolved instant are both visible.
 *
 * Each function takes a value the envelope already resolved — the number of days, the introduction
 * date, the nominal last included date, the exclusive endpoint and the zone it was resolved in — and
 * never derives one, because the endpoint is resolved once and kept, so a later travel, display or
 * zone-data change must not move it.
 *
 * These statements render only where the envelope resolved a deadline. A referral whose date is
 * approximate or unknown has none, and that surface renders {@link NO_DEADLINE_NOTICE} instead, so no
 * sentence here ever manufactures a deadline the evidence cannot support.
 */
export interface WindowCopy {
  readonly heading: string;
  readonly newWindowHeading: string;
  /** "N calendar days", the length the release states for a New window. */
  readonly lengthDays: (days: number) => string;
  /** Names the introduction date as day one, the fixed reading the whole window is counted from. */
  readonly dayOne: (dayOne: string) => string;
  /** The nominal last included date, which is D plus N minus one as the calendar wording puts it. */
  readonly lastIncluded: (lastIncluded: string) => string;
  /** The exclusive endpoint: the first valid instant starting the day after the last included date. */
  readonly exclusiveEndpoint: (endpoint: string, zone: string) => string;
  /** States that the resolved end is fixed, so it is never recomputed by a later change of place or display. */
  readonly endpointResolvedOnce: string;
  /** Shown when the window this referral carries could not be resolved. */
  readonly unresolvedWindow: string;
  /** Shown for a referral that records no window at all, which is distinct from a window that cannot be read. */
  readonly noWindowRecorded: string;
}

export const WINDOW_COPY: WindowCopy = {
  heading: "Window",
  newWindowHeading: "New window",
  lengthDays: (days) => `${days} calendar days from the original introduction date`,
  dayOne: (dayOne) => `The introduction date, ${dayOne}, is day one.`,
  lastIncluded: (lastIncluded) => `The last date the window includes is ${lastIncluded}.`,
  exclusiveEndpoint: (endpoint, zone) =>
    `The window ends at the first moment of the following day, ${endpoint} in ${zone}. From that moment the referral is Expired rather than Active, and a read at that exact moment is already Expired.`,
  endpointResolvedOnce: "The end is resolved once and kept, so changing where you are or how dates are displayed does not move it.",
  unresolvedWindow: "The window this referral carries could not be resolved, so no deadline is shown and no Active or Expired judgement is made; the reason is stated with it.",
  noWindowRecorded: "No window is recorded for this referral.",
};

/**
 * How a disagreement between the calendar wording and the resolved instant is presented: as two
 * labelled facts, never merged into one and never with the wording rewritten to match the instant.
 *
 * The resolved moment decides whether the window is Active or Expired; the wording is kept because a
 * reader checking the original statement needs to see what it said.
 */
export const NOMINAL_VS_RESOLVED = {
  heading: "Calendar wording and resolved end",
  nominalLabel: "Dates as written",
  resolvedLabel: "When the window ends",
  disagreementNote:
    "The calendar wording and the resolved moment disagree here. Both are shown: the resolved moment is what decides whether the window is Active or Expired, and the wording stands as it was written rather than being rewritten to match.",
  nominalUnavailable: "The calendar wording is not available for this referral, so only the resolved moment is shown.",
} as const;

/**
 * The continuation window, which is the one place the family mixes two kinds of time.
 *
 * The New window is counted in calendar days in the accepted source zone; a continuation is a fixed
 * number of elapsed seconds from the moment it is accepted. Saying which is which is the whole job of
 * these sentences, and the number itself always comes from the envelope.
 */
export interface ContinuationWindowCopy {
  readonly heading: string;
  readonly explanation: string;
  /** The resolved end of a continuation, stated as elapsed seconds after acceptance. */
  readonly elapsedSeconds: (elapsedSeconds: number, endpoint: string) => string;
  /** Why elapsed seconds and calendar days are not interchangeable here. */
  readonly elapsedNotCalendar: string;
  /** A cycle carries at most one continuation, so a second attempt is never a second window. */
  readonly oneSuccessor: string;
  /** Labels the cycle a continuation came from. */
  readonly predecessorLabel: string;
}

export const CONTINUATION_WINDOW_COPY: ContinuationWindowCopy = {
  heading: "Continued window",
  explanation: "A continuation opens one further window on the same referral, measured from the moment you accept it.",
  elapsedSeconds: (elapsedSeconds, endpoint) => `It ends ${elapsedSeconds} seconds after acceptance, at ${endpoint}.`,
  elapsedNotCalendar: "This window is measured in elapsed seconds rather than calendar days, so a change of clocks neither lengthens nor shortens it.",
  oneSuccessor: "A cycle carries at most one continuation, so continuing it once is the whole of what it offers.",
  predecessorLabel: "Continued from",
};

/**
 * The closed set of status words a referral can show.
 *
 * The first four are where a window stands, named exactly as the envelope names them, so a list renders
 * `STATUS_COPY[row.status]` without a mapping layer of its own. The last four are closures the source
 * recorded, kept in the same vocabulary precisely so that neither is ever mistaken for the other:
 * a withdrawal is not a window that ran out.
 */
export const REFERRAL_STATUS_WORDS = ["active", "expired", "no-deadline", "refused", "withdrawn", "revoked", "erased", "departed"] as const;

/** One status word from {@link REFERRAL_STATUS_WORDS}. */
export type ReferralStatusWord = (typeof REFERRAL_STATUS_WORDS)[number];

/** The word a status shows, the sentence that explains it, and whether it is a source closure rather than a window's end. */
export interface ReferralStatusCopy {
  readonly label: string;
  readonly description: string;
  /** True for a closure the source recorded. Deciding this once here keeps every surface from deciding it again. */
  readonly closureRecordedBySource: boolean;
}

export const STATUS_COPY: Readonly<Record<ReferralStatusWord, ReferralStatusCopy>> = {
  active: {
    label: "Active",
    description: "The window on this introduction has not ended yet.",
    closureRecordedBySource: false,
  },
  expired: {
    label: "Expired",
    description: "The window ended. This says where the window stands, and nothing about the person it introduced.",
    closureRecordedBySource: false,
  },
  "no-deadline": {
    label: "Incomplete date",
    description: "The date is not known precisely enough for a deadline, so this referral is neither Active nor Expired.",
    closureRecordedBySource: false,
  },
  refused: {
    label: "Window unresolved",
    description: "The window this referral carries could not be read, so no deadline and no judgement are shown; the reason is stated with it.",
    closureRecordedBySource: false,
  },
  withdrawn: {
    label: "Withdrawn",
    description: "The source withdrew this referral. A withdrawal is not an ordinary expiry: a window's end is not what closed it, so it is judged on its own.",
    closureRecordedBySource: true,
  },
  revoked: {
    label: "Revoked",
    description: "Permission to act on this referral was revoked. A revocation is not an ordinary expiry: it closes the permission to act, not the window.",
    closureRecordedBySource: true,
  },
  erased: {
    label: "Erased",
    description: "The source erased this record. An erasure is not an ordinary expiry, so nothing about the referral's details is reconstructed from it.",
    closureRecordedBySource: true,
  },
  departed: {
    label: "Departed",
    description: "The source records that a person or organization involved has departed. A departure is not an ordinary expiry, and no window is judged from it.",
    closureRecordedBySource: true,
  },
};

/**
 * The one sentence that keeps the two halves of the vocabulary apart.
 *
 * It is rendered wherever both could appear, because a list that shows an Expired referral beside a
 * withdrawn one invites exactly the reading this sentence rules out.
 */
export const EXPIRY_VS_CLOSURE: string =
  "Expired means the window ended. Withdrawn, revoked, erased and departed are closures the source recorded, and they are never shown as an expiry or as an Active or Expired judgement.";

/**
 * The permitted Expired history: a narrow permission over history, which is a different thing from
 * access to the partner record.
 *
 * The field labels below name exactly the facts that permission allows, so a component renders those
 * and shows the absent ones from {@link FORBIDDEN_FIELDS} with their reason rather than leaving a gap a
 * reader would fill with a guess.
 */
export const EXPIRED_HISTORY_COPY = {
  heading: "Permitted Expired history",
  explanation: "Ended referrals you are permitted to see as history. This is not access to the partner record.",
  permissionStatement: "This list shows identity, source reference, status and permitted dates only.",
  readOnlyNote: "Nothing here can be changed. A permitted history is read-only, and the referral it describes is kept where it belongs.",
  absentHeading: "Not included here",
  fieldLabels: {
    partner: "Who was introduced",
    partnerKind: "Kind of record",
    sourceReference: "Source reference",
    status: "Status",
    originalIntroductionOn: "Original introduction date",
    datePrecision: "Date precision",
    windowKind: "Window",
    windowStart: "Window start",
    windowEnd: "Window ends",
    cycleIndex: "Cycle",
    consumed: "Continuation",
  },
  consumedLabels: {
    continued: "Continued once",
    notContinued: "Not continued",
  },
  noWindowEndLabel: LIST_COPY.noWindowEndLabel,
  noMatchingHint:
    "A search here matches only the facts this list is permitted to show. No hidden field is ever used as a matching clue, so a search that finds nothing has told you nothing about what was withheld.",
} as const;

/** One fact a permitted Expired history does not carry, with the reason it is absent, so a surface shows why instead of an empty gap. */
export interface ForbiddenFieldCopy {
  readonly field: string;
  readonly label: string;
  readonly reason: string;
}

export const FORBIDDEN_FIELDS: readonly ForbiddenFieldCopy[] = [
  {
    field: "contactChannels",
    label: "Contact details",
    reason: "Contactability is a separate permission, and this history carries none of it.",
  },
  {
    field: "referrerContext",
    label: "What the referrer said",
    reason: "A referrer's context belongs to the private record it was written in, not to permitted history.",
  },
  {
    field: "preciseLocation",
    label: "Precise location",
    reason: "An exact location is narrower than the identity this history is allowed to show.",
  },
  {
    field: "notes",
    label: "Notes",
    reason: "Notes are private preparation with their own audience, and no projection of them reaches this list.",
  },
  {
    field: "financialData",
    label: "Financial information",
    reason: "Support is read on its own authorised basis elsewhere, never inferred from a referral's history.",
  },
];

/**
 * Every reason the one further window a cycle can carry is not on offer, as a closed set.
 *
 * These are the reasons the component classifies itself. When the envelope states its own reason for
 * withholding Continue — including a worker-continuation setting it could not read — that sentence is
 * shown instead, so a service reason is never overwritten by a guess made here.
 */
export const CONTINUE_UNAVAILABLE_REASON_CODES = [
  "worker-setting-off",
  "not-ordinarily-expired",
  "no-current-responsibility",
  "no-current-permission",
  "no-continued-policy",
  "already-consumed",
  "precision-does-not-admit-a-deadline",
] as const;

/** One reason Continue is not offered, from {@link CONTINUE_UNAVAILABLE_REASON_CODES}. */
export type ContinueUnavailableReason = (typeof CONTINUE_UNAVAILABLE_REASON_CODES)[number];

/** What each reason says, worded so a reader learns the condition rather than being blamed for it. */
export const UNAVAILABLE_REASONS: Readonly<Record<ContinueUnavailableReason, string>> = {
  "worker-setting-off": "The setting that allows a continued window is off, so an expired referral offers no Continue action.",
  "not-ordinarily-expired": "This referral's window has not ended, so there is nothing to continue.",
  "no-current-responsibility": "You are not currently responsible for this referral, so Continue is not offered.",
  "no-current-permission": "You do not hold current permission to act on this referral, so Continue is not offered.",
  "no-continued-policy": "The policy that admits a continuation does not cover this referral, so Continue is not offered.",
  "already-consumed": "This cycle has already been continued once, and a referral carries at most one continuation.",
  "precision-does-not-admit-a-deadline": "The introduction date is not precise enough to have had a window, so there is nothing to continue.",
};

/** The confirmation a continuation passes through before it opens a window. */
export interface ContinueConfirmCopy {
  readonly title: string;
  /** The body, naming the cycle it acts on by the label the envelope supplied. */
  readonly body: (cycleLabel: string) => string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}

export interface ContinueCopy {
  readonly label: string;
  /** What the action does, and the three things it does not do, in one sentence. */
  readonly available: string;
  readonly confirm: ContinueConfirmCopy;
  readonly unavailableHeading: string;
  readonly unavailableReasons: Readonly<Record<ContinueUnavailableReason, string>>;
}

export const CONTINUE_COPY: ContinueCopy = {
  label: "Continue this referral",
  available: "Continue opens one further window on this referral, and nothing else: it is not a new introduction, it records no consent for contact, and it counts no interaction or conversation.",
  confirm: {
    title: "Continue this referral?",
    body: (cycleLabel) =>
      `This continues ${cycleLabel}, the cycle whose window has ended, and opens one further window from the moment you accept. The cycle keeps its own record, and no new introduction is recorded.`,
    confirmLabel: "Continue the referral",
    cancelLabel: "Leave it as it is",
  },
  unavailableHeading: "Continue is not offered",
  unavailableReasons: UNAVAILABLE_REASONS,
};

/**
 * What a referral result says beyond the shared receipt.
 *
 * The receipt owns the outcome headings and the general vocabulary of all eight outcomes, so nothing
 * here restates them: each entry adds only what a referral changes about the reading, and the uncertain
 * result is described as uncertain rather than as either success or failure.
 */
export const OUTCOME_COPY = {
  conflict: {
    detail: "This referral changed since you looked, so nothing was changed here. Compare the state it holds now with what you were about to do, then act on what you see.",
  },
  unchanged: {
    detail: "Nothing changed, so nothing needs doing twice: a cycle carries at most one continuation, and an introduction already recorded stays as it was recorded.",
  },
  unknown: {
    detail: "The result is uncertain — the change may have been saved. Check the result for this operation rather than acting again, so one intention cannot become two windows or two introductions.",
  },
} as const;
