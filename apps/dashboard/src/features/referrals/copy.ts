import type { DatePrecisionValue, ReferralListQuery } from "./schemas";
export const PRECISION_COPY: Readonly<Record<DatePrecisionValue, { readonly label: string; readonly hint: string }>> = {
  date: { label: "Known date", hint: "The calendar date the introduction happened, recorded as the source states it. A known date is what gives a referral its window." },
  approximate: { label: "Approximate", hint: "Recorded as it was remembered. An approximation is never turned into a precise date, so no deadline is derived from it." },
  unknown: { label: "Unknown", hint: "No date is established for this introduction, so none is stored and none is implied." },
};
export const NO_DEADLINE_NOTICE: string = "Without a known introduction date there is no deadline, no Active or Expired judgement and no Continue action; this referral is shown exactly as far as its evidence carries.";
export const RECORD_INTRODUCTION_LABEL = "Record an introduction";
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
  entryTimeNote: "When this record was entered here is a separate fact from when the introduction happened. Entry time is never shown as the introduction date, and a late entry does not start the window again.",
  saveLabel: "Save introduction",
  cancelLabel: "Cancel",
} as const;
export type ReferralViewCopy = { readonly heading: string; readonly explanation: string; readonly empty: { readonly title: string; readonly body: string; readonly actionLabel: string | null } };
const REFERRAL_VIEW_COPY = {
  active: { heading: "Active", explanation: "Introductions whose known date gives them a window that has not ended.", empty: { title: "Nothing is active right now", body: "No referral's window is open. Record an introduction when one is given to you.", actionLabel: RECORD_INTRODUCTION_LABEL } },
  "incomplete-date": {
    heading: "Incomplete date",
    explanation: "Introductions whose date is approximate or unknown. Evidence of that kind cannot support a deadline or an Active or Expired judgement, so none is shown and none is implied.",
    empty: { title: "Nothing is waiting on a date", body: "Every introduction you can see has a known date, so nothing is held here.", actionLabel: null },
  },
  expired: {
    heading: "Permitted Expired history",
    explanation: "Referrals whose window has ended, shown as a narrow permission for history rather than access to the partner record.",
    empty: { title: "No Expired referrals are available to you", body: "No ended referral is inside what your permission covers.", actionLabel: null },
  },
} as const satisfies Readonly<Record<ReferralListQuery["list"], ReferralViewCopy>>;
export const LIST_COPY = {
  heading: "Referrals",
  recordIntroductionLabel: RECORD_INTRODUCTION_LABEL,
  viewSwitcherLabel: "Referral lists",
  views: REFERRAL_VIEW_COPY,
  columns: { partner: "Who was introduced", sourceReference: "Source reference", originalIntroductionOn: "Original introduction date", datePrecision: "Date precision", status: "Status", windowEnd: "Window ends" },
  columnHelp: { windowEnd: "Shown where the envelope resolved a window. A referral whose date is approximate or unknown has no window end, which is a fact about its evidence rather than a missing number." },
  noWindowEndLabel: "No window end",
  search: {
    label: "Search referrals",
    placeholder: "A name or a source reference",
    hint: "Search covers the facts this list is permitted to show, and it runs over the whole authorised result rather than the page you are looking at.",
    empty: { title: "No referral matches this search", body: "Nothing in this list matches the words you entered. Clearing the search shows the list again.", actionLabel: "Clear the search" },
  },
  sort: { label: "Order", fieldLabels: { windowEnd: "Window end, latest first", originalIntroductionOn: "Introduction date, newest first" } },
} as const;
export function listCountCaption(query: ReferralListQuery, total: number): string {
  const { heading } = LIST_COPY.views[query.list];
  const noun = total === 1 ? "referral" : "referrals";
  return `${heading}: ${total} ${noun} in the whole result.`;
}
export type WindowCopy = {
  readonly heading: string;
  readonly newWindowHeading: string;
  readonly lengthDays: (days: number) => string;
  readonly dayOne: (dayOne: string) => string;
  readonly lastIncluded: (lastIncluded: string) => string;
  readonly exclusiveEndpoint: (endpoint: string, zone: string) => string;
  readonly endpointResolvedOnce: string;
  readonly unresolvedWindow: string;
  readonly noWindowRecorded: string;
};
export const WINDOW_COPY: WindowCopy = {
  heading: "Window",
  newWindowHeading: "New window",
  lengthDays: (days) => `${days} calendar days from the original introduction date`,
  dayOne: (dayOne) => `The introduction date, ${dayOne}, is day one.`,
  lastIncluded: (lastIncluded) => `The last date the window includes is ${lastIncluded}.`,
  exclusiveEndpoint: (endpoint, zone) => `The window ends at the first moment of the following day, ${endpoint} in ${zone}. From that moment the referral is Expired rather than Active, and a read at that exact moment is already Expired.`,
  endpointResolvedOnce: "The end is resolved once and kept, so changing where you are or how dates are displayed does not move it.",
  unresolvedWindow: "The window this referral carries could not be resolved, so no deadline is shown and no Active or Expired judgement is made; the reason is stated with it.",
  noWindowRecorded: "No window is recorded for this referral.",
};
export const NOMINAL_VS_RESOLVED = {
  heading: "Calendar wording and resolved end",
  nominalLabel: "Dates as written",
  resolvedLabel: "When the window ends",
  disagreementNote: "The calendar wording and the resolved moment disagree here. Both are shown: the resolved moment is what decides whether the window is Active or Expired, and the wording stands as it was written rather than being rewritten to match.",
  nominalUnavailable: "The calendar wording is not available for this referral, so only the resolved moment is shown.",
} as const;
export type ContinuationWindowCopy = { readonly heading: string; readonly explanation: string; readonly elapsedSeconds: (elapsedSeconds: number, endpoint: string) => string; readonly elapsedNotCalendar: string; readonly oneSuccessor: string; readonly predecessorLabel: string };
export const CONTINUATION_WINDOW_COPY: ContinuationWindowCopy = {
  heading: "Continued window",
  explanation: "A continuation opens one further window on the same referral, measured from the moment you accept it.",
  elapsedSeconds: (elapsedSeconds, endpoint) => `It ends ${elapsedSeconds} seconds after acceptance, at ${endpoint}.`,
  elapsedNotCalendar: "This window is measured in elapsed seconds rather than calendar days, so a change of clocks neither lengthens nor shortens it.",
  oneSuccessor: "A cycle carries at most one continuation, so continuing it once is the whole of what it offers.",
  predecessorLabel: "Continued from",
};
export const REFERRAL_STATUS_WORDS = ["active", "expired", "no-deadline", "refused", "withdrawn", "revoked", "erased", "departed"] as const;
export type ReferralStatusWord = (typeof REFERRAL_STATUS_WORDS)[number];
export type ReferralStatusCopy = { readonly label: string; readonly description: string; readonly closureRecordedBySource: boolean };
export const STATUS_COPY: Readonly<Record<ReferralStatusWord, ReferralStatusCopy>> = {
  active: { label: "Active", description: "The window on this introduction has not ended yet.", closureRecordedBySource: false },
  expired: { label: "Expired", description: "The window ended. This says where the window stands, and nothing about the person it introduced.", closureRecordedBySource: false },
  "no-deadline": { label: "Incomplete date", description: "The date is not known precisely enough for a deadline, so this referral is neither Active nor Expired.", closureRecordedBySource: false },
  refused: { label: "Window unresolved", description: "The window this referral carries could not be read, so no deadline and no judgement are shown; the reason is stated with it.", closureRecordedBySource: false },
  withdrawn: { label: "Withdrawn", description: "The source withdrew this referral. A withdrawal is not an ordinary expiry: a window's end is not what closed it, so it is judged on its own.", closureRecordedBySource: true },
  revoked: { label: "Revoked", description: "Permission to act on this referral was revoked. A revocation is not an ordinary expiry: it closes the permission to act, not the window.", closureRecordedBySource: true },
  erased: { label: "Erased", description: "The source erased this record. An erasure is not an ordinary expiry, so nothing about the referral's details is reconstructed from it.", closureRecordedBySource: true },
  departed: { label: "Departed", description: "The source records that a person or organization involved has departed. A departure is not an ordinary expiry, and no window is judged from it.", closureRecordedBySource: true },
};
export const EXPIRY_VS_CLOSURE: string = "Expired means the window ended. Withdrawn, revoked, erased and departed are closures the source recorded, and they are never shown as an expiry or as an Active or Expired judgement.";
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
  consumedLabels: { continued: "Continued once", notContinued: "Not continued" },
  noWindowEndLabel: LIST_COPY.noWindowEndLabel,
  noMatchingHint: "A search here matches only the facts this list is permitted to show. No hidden field is ever used as a matching clue, so a search that finds nothing has told you nothing about what was withheld.",
} as const;
export type ForbiddenFieldCopy = { readonly field: string; readonly label: string; readonly reason: string };
export const FORBIDDEN_FIELDS: readonly ForbiddenFieldCopy[] = [
  { field: "contactChannels", label: "Contact details", reason: "Contactability is a separate permission, and this history carries none of it." },
  { field: "referrerContext", label: "What the referrer said", reason: "A referrer's context belongs to the private record it was written in, not to permitted history." },
  { field: "preciseLocation", label: "Precise location", reason: "An exact location is narrower than the identity this history is allowed to show." },
  { field: "notes", label: "Notes", reason: "Notes are private preparation with their own audience, and no projection of them reaches this list." },
  { field: "financialData", label: "Financial information", reason: "Support is read on its own authorised basis elsewhere, never inferred from a referral's history." },
];
export const CONTINUE_UNAVAILABLE_REASON_CODES = ["worker-setting-off", "not-ordinarily-expired", "no-current-responsibility", "no-current-permission", "no-continued-policy", "already-consumed", "precision-does-not-admit-a-deadline"] as const;
export type ContinueUnavailableReason = (typeof CONTINUE_UNAVAILABLE_REASON_CODES)[number];
export const UNAVAILABLE_REASONS: Readonly<Record<ContinueUnavailableReason, string>> = {
  "worker-setting-off": "The setting that allows a continued window is off, so an expired referral offers no Continue action.",
  "not-ordinarily-expired": "This referral's window has not ended, so there is nothing to continue.",
  "no-current-responsibility": "You are not currently responsible for this referral, so Continue is not offered.",
  "no-current-permission": "You do not hold current permission to act on this referral, so Continue is not offered.",
  "no-continued-policy": "The policy that admits a continuation does not cover this referral, so Continue is not offered.",
  "already-consumed": "This cycle has already been continued once, and a referral carries at most one continuation.",
  "precision-does-not-admit-a-deadline": "The introduction date is not precise enough to have had a window, so there is nothing to continue.",
};
export type ContinueConfirmCopy = { readonly title: string; readonly body: (cycleLabel: string) => string; readonly confirmLabel: string; readonly cancelLabel: string };
export type ContinueCopy = { readonly label: string; readonly available: string; readonly confirm: ContinueConfirmCopy; readonly unavailableHeading: string; readonly unavailableReasons: Readonly<Record<ContinueUnavailableReason, string>> };
export const CONTINUE_COPY: ContinueCopy = {
  label: "Continue this referral",
  available: "Continue opens one further window on this referral, and nothing else: it is not a new introduction, it records no consent for contact, and it counts no interaction or conversation.",
  confirm: {
    title: "Continue this referral?",
    body: (cycleLabel) => `This continues ${cycleLabel}, the cycle whose window has ended, and opens one further window from the moment you accept. The cycle keeps its own record, and no new introduction is recorded.`,
    confirmLabel: "Continue the referral",
    cancelLabel: "Leave it as it is",
  },
  unavailableHeading: "Continue is not offered",
  unavailableReasons: UNAVAILABLE_REASONS,
};
export const OUTCOME_COPY = {
  conflict: { detail: "This referral changed since you looked, so nothing was changed here. Compare the state it holds now with what you were about to do, then act on what you see." },
  unchanged: { detail: "Nothing changed, so nothing needs doing twice: a cycle carries at most one continuation, and an introduction already recorded stays as it was recorded." },
  unknown: { detail: "The result is uncertain — the change may have been saved. Check the result for this operation rather than acting again, so one intention cannot become two windows or two introductions." },
} as const;
