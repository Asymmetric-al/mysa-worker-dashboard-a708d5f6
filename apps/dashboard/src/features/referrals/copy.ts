import type { DatePrecisionValue, ReferralListQuery } from "./schemas";
export const PRECISION_COPY: Readonly<Record<DatePrecisionValue, { readonly label: string; readonly hint: string }>> = {
  date: { label: "Exact date", hint: "The calendar day the introduction happened — used as day one of the referral window." },
  approximate: { label: "Approximate", hint: "Roughly remembered. Approximate dates don’t create a referral deadline." },
  unknown: { label: "Unknown", hint: "Saved without a date rather than guessing." },
};
export const NO_DEADLINE_NOTICE: string = "Without an exact introduction date, there’s no referral deadline, no Active/Expired status, and no continuation option.";
export const RECORD_INTRODUCTION_LABEL = "Record introduction";
export const INTRODUCED_BY_COPY = {
  formHeading: RECORD_INTRODUCTION_LABEL,
  formHelp: "Enter when the introduction actually happened and how accurately you know the date. An exact date starts day one of the referral window.",
  originalIntroductionOnLabel: "Introduction date",
  originalIntroductionOnHelp: "The day the introduction happened (not today’s entry date).",
  datePrecisionLabel: "How well is this date known?",
  unknownClearsDateNote: "Leaving the date unknown clears the date field rather than guessing.",
  sourceZoneLabel: "Time zone",
  sourceZoneHelp: "Used to lock in the exact end of the referral window regardless of where you travel later.",
  sourceReferenceLabel: "Source reference",
  sourceReferenceHelp: "Reference ID from the originating system (stored for provenance only, never used to merge records).",
  sectionHeading: "Original introduction",
  entryTimeLabel: "Entered in MYSA",
  entryTimeNote: "Tracked separately from when the introduction happened — logging late doesn’t restart the window.",
  saveLabel: "Save introduction",
  cancelLabel: "Cancel",
} as const;
export type ReferralViewCopy = { readonly heading: string; readonly explanation: string; readonly empty: { readonly title: string; readonly body: string; readonly actionLabel: string | null } };
const REFERRAL_VIEW_COPY = {
  active: { heading: "Active", explanation: "Introductions with an exact date whose referral window is still open.", empty: { title: "No active referrals", body: "Record an introduction whenever someone connects you with a potential partner.", actionLabel: RECORD_INTRODUCTION_LABEL } },
  "incomplete-date": {
    heading: "Incomplete date",
    explanation: "Introductions with an approximate or unknown date. Without an exact date, no deadline or Active/Expired status is assigned.",
    empty: { title: "No referrals missing a date", body: "Every referral you can see has an exact introduction date.", actionLabel: null },
  },
  expired: {
    heading: "Expired history",
    explanation: "Read-only history of ended referrals you’re permitted to view (doesn’t grant partner profile access).",
    empty: { title: "No expired referrals", body: "No ended referrals are available in your history.", actionLabel: null },
  },
} as const satisfies Readonly<Record<ReferralListQuery["list"], ReferralViewCopy>>;
export const LIST_COPY = {
  heading: "Referrals",
  recordIntroductionLabel: RECORD_INTRODUCTION_LABEL,
  viewSwitcherLabel: "Referral lists",
  views: REFERRAL_VIEW_COPY,
  columns: { partner: "Introduced partner", sourceReference: "Source reference", originalIntroductionOn: "Introduction date", datePrecision: "Date accuracy", status: "Status", windowEnd: "Window ends" },
  columnHelp: { windowEnd: "Shown only when the introduction has an exact date." },
  noWindowEndLabel: "No deadline",
  search: {
    label: "Search referrals",
    placeholder: "Search by name or reference…",
    hint: "Searches all visible referrals across pages.",
    empty: { title: "No matching referrals", body: "Try another name or reference, or clear your search.", actionLabel: "Clear search" },
  },
  sort: { label: "Sorted by", fieldLabels: { windowEnd: "Window end (latest first)", originalIntroductionOn: "Introduction date (newest first)" } },
} as const;
export function listCountCaption(query: ReferralListQuery, total: number): string {
  const { heading } = LIST_COPY.views[query.list];
  const noun = total === 1 ? "referral" : "referrals";
  return `${heading}: ${total} ${noun}`;
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
  heading: "Referral window",
  newWindowHeading: "Initial window",
  lengthDays: (days) => `${days} calendar days from the introduction date`,
  dayOne: (dayOne) => `Day one: ${dayOne}.`,
  lastIncluded: (lastIncluded) => `Last included day: ${lastIncluded}.`,
  exclusiveEndpoint: (endpoint, zone) => `Ends at ${endpoint} (${zone}). At that moment, the referral becomes Expired.`,
  endpointResolvedOnce: "The end time is fixed when calculated so changing your display time zone never shifts it.",
  unresolvedWindow: "Couldn’t calculate a window for this referral, so no deadline or Active/Expired status is shown.",
  noWindowRecorded: "No referral window recorded.",
};
export const NOMINAL_VS_RESOLVED = {
  heading: "Written dates & exact end time",
  nominalLabel: "Calendar dates",
  resolvedLabel: "Exact end time",
  disagreementNote: "The written dates and exact end time differ here. Both are shown — the exact end time determines whether the window is Active or Expired.",
  nominalUnavailable: "Calendar date wording isn’t available — showing the exact end time only.",
} as const;
export type ContinuationWindowCopy = { readonly heading: string; readonly explanation: string; readonly elapsedSeconds: (elapsedSeconds: number, endpoint: string) => string; readonly elapsedNotCalendar: string; readonly oneSuccessor: string; readonly predecessorLabel: string };
export const CONTINUATION_WINDOW_COPY: ContinuationWindowCopy = {
  heading: "Continued window",
  explanation: "Opens one additional window on this referral starting the moment you confirm.",
  elapsedSeconds: (elapsedSeconds, endpoint) => `Ends ${elapsedSeconds} seconds after confirmation, at ${endpoint}.`,
  elapsedNotCalendar: "Measured in exact elapsed seconds so daylight-saving changes don’t shorten or lengthen it.",
  oneSuccessor: "Each referral cycle can only be continued once.",
  predecessorLabel: "Continued from",
};
export const REFERRAL_STATUS_WORDS = ["active", "expired", "no-deadline", "refused", "withdrawn", "revoked", "erased", "departed"] as const;
export type ReferralStatusWord = (typeof REFERRAL_STATUS_WORDS)[number];
export type ReferralStatusCopy = { readonly label: string; readonly description: string; readonly closureRecordedBySource: boolean };
export const STATUS_COPY: Readonly<Record<ReferralStatusWord, ReferralStatusCopy>> = {
  active: { label: "Active", description: "This referral’s window is currently open.", closureRecordedBySource: false },
  expired: { label: "Expired", description: "This referral’s window has ended.", closureRecordedBySource: false },
  "no-deadline": { label: "Incomplete date", description: "Date isn’t exact enough for a deadline, so it’s neither Active nor Expired.", closureRecordedBySource: false },
  refused: { label: "Window unavailable", description: "The referral window couldn’t be calculated, so no status is assigned.", closureRecordedBySource: false },
  withdrawn: { label: "Withdrawn", description: "Withdrawn by the organization (tracked separately from normal expiry).", closureRecordedBySource: true },
  revoked: { label: "Revoked", description: "Permission to act on this referral was revoked (tracked separately from normal expiry).", closureRecordedBySource: true },
  erased: { label: "Erased", description: "Record erased by the organization (tracked separately from normal expiry).", closureRecordedBySource: true },
  departed: { label: "Departed", description: "A person or organization involved has departed (tracked separately from normal expiry).", closureRecordedBySource: true },
};
export const EXPIRY_VS_CLOSURE: string = "Expired means the time window ended. Withdrawn, revoked, erased, and departed are organization closures shown separately.";
export const EXPIRED_HISTORY_COPY = {
  heading: "Expired history",
  explanation: "Read-only summary of ended referrals (doesn’t grant full partner profile access).",
  permissionStatement: "Shows name, reference, status, and permitted dates only.",
  readOnlyNote: "Read-only history — nothing can be edited here.",
  absentHeading: "Not shown in expired history",
  fieldLabels: {
    partner: "Introduced partner",
    partnerKind: "Type",
    sourceReference: "Source reference",
    status: "Status",
    originalIntroductionOn: "Introduction date",
    datePrecision: "Date accuracy",
    windowKind: "Window type",
    windowStart: "Window starts",
    windowEnd: "Window ends",
    cycleIndex: "Cycle",
    consumed: "Continuation",
  },
  consumedLabels: { continued: "Continued once", notContinued: "Not continued" },
  noWindowEndLabel: LIST_COPY.noWindowEndLabel,
  noMatchingHint: "Search only checks the fields visible here — hidden details are never matched.",
} as const;
export type ForbiddenFieldCopy = { readonly field: string; readonly label: string; readonly reason: string };
export const FORBIDDEN_FIELDS: readonly ForbiddenFieldCopy[] = [
  { field: "contactChannels", label: "Contact details", reason: "Contact details require active partner permission." },
  { field: "referrerContext", label: "Referrer context", reason: "Referrer notes stay on the private record." },
  { field: "preciseLocation", label: "Exact address", reason: "Precise location isn’t included in expired history." },
  { field: "notes", label: "Private notes", reason: "Your private notes stay private and aren’t projected here." },
  { field: "financialData", label: "Giving history", reason: "Giving is viewed separately in Support with its own permissions." },
];
export const CONTINUE_UNAVAILABLE_REASON_CODES = ["worker-setting-off", "not-ordinarily-expired", "no-current-responsibility", "no-current-permission", "no-continued-policy", "already-consumed", "precision-does-not-admit-a-deadline"] as const;
export type ContinueUnavailableReason = (typeof CONTINUE_UNAVAILABLE_REASON_CODES)[number];
export const UNAVAILABLE_REASONS: Readonly<Record<ContinueUnavailableReason, string>> = {
  "worker-setting-off": "Referral continuations are turned off in your ministry settings.",
  "not-ordinarily-expired": "This referral window hasn’t ended yet.",
  "no-current-responsibility": "You aren’t currently assigned to this referral.",
  "no-current-permission": "You don’t have permission to continue this referral.",
  "no-continued-policy": "Continuation isn’t enabled under this referral’s policy.",
  "already-consumed": "Already continued once (each cycle allows only one continuation).",
  "precision-does-not-admit-a-deadline": "This referral has no exact date or window to continue.",
};
export type ContinueConfirmCopy = { readonly title: string; readonly body: (cycleLabel: string) => string; readonly confirmLabel: string; readonly cancelLabel: string };
export type ContinueCopy = { readonly label: string; readonly available: string; readonly confirm: ContinueConfirmCopy; readonly unavailableHeading: string; readonly unavailableReasons: Readonly<Record<ContinueUnavailableReason, string>> };
export const CONTINUE_COPY: ContinueCopy = {
  label: "Continue referral",
  available: "Opens one additional window on this referral — doesn’t record a new introduction, email consent, or activity.",
  confirm: {
    title: "Continue this referral?",
    body: (cycleLabel) => `Opens one additional window from ${cycleLabel} starting now. The original cycle stays intact and no new introduction is created.`,
    confirmLabel: "Continue referral",
    cancelLabel: "Cancel",
  },
  unavailableHeading: "Continuation unavailable",
  unavailableReasons: UNAVAILABLE_REASONS,
};
export const OUTCOME_COPY = {
  conflict: { detail: "This referral changed elsewhere while you were looking. Review the latest state before trying again." },
  unchanged: { detail: "No changes needed — this referral was already in that state." },
  unknown: { detail: "Couldn’t confirm the update. Check the result before trying again to avoid creating a duplicate window." },
} as const;
