import type { NoticeKind } from "@/components/state-notice";
/** The three states of an initiative working-list membership. */ export const MEMBERSHIP_STATES = ["included", "removed", "excluded"] as const;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
export const MEMBERSHIP_STATE_COPY: Record<MembershipState, { label: string; description: string; emptyNote: string }> = {
  included: { label: "On working list", description: "Selected by you for this initiative.", emptyNote: "No partners on this list yet." },
  removed: { label: "Removed", description: "Taken off the working list while keeping all history and open tasks.", emptyNote: "No partners removed." },
  excluded: { label: "Not eligible", description: "Marked ineligible by your organization’s records.", emptyNote: "No ineligible partners." },
};
/** Why inclusion is not Asked, not consent and not audience membership. */ export const MEMBERSHIP_RULES_COPY = {
  notAsked: "Adding a partner to the working list doesn’t mean you’ve asked them yet.",
  notConsent: "Adding a partner here never records email consent.",
  notAudienceMembership: "Working-list partners aren’t added to your email audience or sent notifications.",
  explicitSelectionOnly: "Only partners you explicitly select are added — filters never add people automatically.",
  removalPreservesHistory: "Removing a partner keeps their history and any open tasks intact.",
  returnRestoresEligiblePlanning: "Returning a partner puts them back on the list for planning without changing permissions.",
} as const;
/** The four ways a stage can appear on this surface. */ export const STAGE_STATES = ["recorded", "retired", "denied", "unavailable"] as const;
export type StageState = (typeof STAGE_STATES)[number];
export const STAGE_STATE_COPY: Record<StageState, { label: string; description: string }> = {
  recorded: { label: "Recorded", description: "Your own progress note — never a prediction of giving." },
  retired: { label: "Retired", description: "This stage is no longer active in your ministry’s list." },
  denied: { label: "Not permitted", description: "You don’t have permission to view or change this stage." },
  unavailable: { label: "Unavailable", description: "Couldn’t load the stage right now." },
};
/** The stage selector is compact, works by keyboard and single pointer, and has no drag affordance; moving a partner between lists is the explicit Return action. */ export const STAGE_SELECTOR_COPY = {
  label: "Stage",
  help: "Choose your current progress stage for this partner.",
  clearLabel: "Clear stage",
  clearHelp: "Clears the stage label without removing the partner from the list.",
  sameValueNote: "Already set to this stage.",
  movedToListNote: "Use Return to move a removed partner back to the working list.",
  noTaskCreatedNote: "Updating a stage doesn’t create or change tasks.",
} as const;
/** The seven ways a Request can be answered. */ export const RESPONSE_KINDS = ["agreed", "conditional", "partial", "deferred", "declined", "unanswered", "needs clarification"] as const;
export type ResponseKind = (typeof RESPONSE_KINDS)[number];
/** The three kinds that assert agreement — agreed, conditional and partial. */ export const ASSERTING_RESPONSE_KINDS = ["agreed", "conditional", "partial"] as const satisfies readonly ResponseKind[];
export const RESPONSE_KIND_COPY: Record<ResponseKind, { label: string; description: string }> = {
  agreed: { label: "Agreed", description: "Agreed to the requested terms." },
  conditional: { label: "Agreed with conditions", description: "Agreed subject to conditions noted with the response." },
  partial: { label: "Agreed in part", description: "Agreed to part of the request (details noted with the response)." },
  deferred: { label: "Deferred", description: "Asked for more time before deciding." },
  declined: { label: "Declined", description: "Declined this request." },
  unanswered: { label: "Unanswered", description: "No answer received yet." },
  "needs clarification": { label: "Needs clarification", description: "Asked for more details before deciding." },
};
/** The boundaries a response must never be read across. */ export const RESPONSE_AGREEMENT_COPY = {
  namedRespondentOneRequest: "Each response records one named respondent’s answer to one Request.",
  bindsToTermsVersion: "Responses stay linked to the exact terms version presented, even if terms change later.",
  agreementCreatesNothing: "Recording an agreement doesn’t automatically create a gift, commitment, subscription, or task.",
  withdrawalIsNotRefusal: "Withdrawing a Request is your decision, not a decline from the partner.",
  unansweredIsNotDecline: "An unanswered Request isn’t counted as a decline.",
  unansweredIsRecordedState: "Unanswered is tracked explicitly rather than left blank.",
} as const;
/** Requested terms are what the missionary asked for, never received support. */ export const REQUESTED_TERMS_COPY = {
  heading: "Requested terms",
  notReceivedSupport: "What you asked for — tracked separately from received gifts.",
  currencyLabel: "Currency",
  amountLabel: "Requested amount",
  cadenceLabel: "Frequency",
  termLabel: "Duration",
  notStated: "Not specified",
  unknownCurrency: "Unrecognized currency — amount hidden.",
  nonFinancialLabel: "Non-financial request",
  versionLabel: "Terms version",
} as const;
const readableToken = (value: string): string => value.replace(/[_\s-]+/g, " ").trim() || REQUESTED_TERMS_COPY.notStated;
/** Renders a cadence value from the envelope instead of leaving the field blank. */ export const cadenceValueFallback = (value: string): string => readableToken(value);
/** Renders a term value from the envelope instead of leaving the field blank. */ export const termValueFallback = (value: string): string => readableToken(value);
/** Renders a closure disposition from the envelope instead of leaving the field blank. */ export const dispositionFallback = (value: string): string => readableToken(value);
/** The four states a Request passes through; each owns its own draft and version. */ export const REQUEST_LIFECYCLE_STATES = ["draft", "submitted", "presented", "answered"] as const;
export type RequestLifecycleState = (typeof REQUEST_LIFECYCLE_STATES)[number];
export const REQUEST_LIFECYCLE_COPY: Record<RequestLifecycleState, { label: string; description: string }> = {
  draft: { label: "Draft", description: "Prepared privately — not yet submitted or shared with the partner." },
  submitted: { label: "In review", description: "Submitted for review before sharing with the partner." },
  presented: { label: "Presented", description: "Shared with the partner; waiting for their response." },
  answered: { label: "Answered", description: "Response recorded against the presented terms version." },
};
/** The presentation record; the date itself is rendered from the envelope's value. */ export const PRESENTATION_COPY = { presentedOnLabel: "Date presented", mannerLabel: "How it was shared", versionRefLabel: "Presented terms version", earlierVersionsNote: "Earlier versions stay preserved for reference." } as const;
/** Results state their denominator; with none supplied, no share is shown. */ export const RESULTS_COPY = {
  heading: "Results",
  denominatorLabel: "Out of",
  denominatorMissingNote: "Total base unavailable — percentage hidden.",
  noResultsNote: "No responses recorded for this initiative yet.",
  kindColumnLabel: "Response",
  countColumnLabel: "Count",
  shareColumnLabel: "Share",
} as const;
/** Closing stops new requests; it resolves no outstanding work by itself. */ export const CLOSURE_COPY = {
  closeHeading: "Close initiative",
  closeHelp: "Closing stops new requests while keeping all history and open tasks intact.",
  dispositionLabel: "Outcome",
  dispositionRequiredNote: "Choose a closing outcome or hand off any open tasks.",
  handoffNote: "Open tasks can be handed off to an eligible teammate rather than closed automatically.",
  lateResponseNote: "Late responses can still be logged without reopening the initiative.",
  reopenHeading: "Reopen initiative",
  reopenHelp: "Reopening allows new requests again while keeping previous closing notes intact.",
  historyPreservedNote: "Previous closing notes and exclusions are always preserved.",
} as const;
/** The two initiative states. */ export const INITIATIVE_STATES = ["open", "closed"] as const;
export type InitiativeState = (typeof INITIATIVE_STATES)[number];
export const INITIATIVE_STATE_COPY: Record<InitiativeState, { label: string; description: string }> = {
  open: { label: "Open", description: "Active for new requests and partner responses." },
  closed: { label: "Closed", description: "No new requests; all responses and history stay visible." },
};
/** List and header wording for the initiatives surfaces. */ export const INITIATIVE_COPY = {
  listHeading: "Initiatives",
  listEmptyTitle: "No initiatives yet",
  listEmptyBody: "Create an initiative to organize a working list of partners and track your invitations and responses.",
  createLabel: "New initiative",
  nameLabel: "Name",
  purposeLabel: "Purpose",
  responsibleLabel: "Owner",
  periodLabel: "Timeframe",
  membersHeading: "Working list",
  requestsHeading: "Requests",
  nextWorkHeading: "Open tasks",
  historyHeading: "History",
} as const;
export type StateNoticeKind = Exclude<NoticeKind, "loading" | "partial-coverage" | "language-unavailable">;
export const STATE_NOTICE_COPY: Record<StateNoticeKind, { title: string; body: string; actionLabel: string | null }> = {
  empty: { title: "Nothing here yet", body: "Create an initiative to build a working list and track requests.", actionLabel: null },
  unavailable: { title: "Couldn’t load initiative", body: "The initiative service didn’t respond. Try again in a moment.", actionLabel: "Try again" },
  denied: { title: "Initiative unavailable", body: "You don’t have access to this initiative in the current ministry.", actionLabel: null },
  unknown: { title: "Couldn’t confirm change", body: "This update may have already saved. Check the result before trying again.", actionLabel: "Check result" },
  refused: { title: "Invalid request", body: "One of the view parameters wasn’t accepted. Return to Initiatives and try again.", actionLabel: null },
};
