import type { NoticeKind } from "@/components/state-notice";
/** The three states of an initiative working-list membership. */ export const MEMBERSHIP_STATES = ["included", "removed", "excluded"] as const;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
export const MEMBERSHIP_STATE_COPY: Record<MembershipState, { label: string; description: string; emptyNote: string }> = {
  included: { label: "On the working list", description: "You selected this partner for this initiative's reviewed working list.", emptyNote: "No partners are on the working list yet." },
  removed: { label: "Removed", description: "No longer on the working list; history and independent obligations are kept.", emptyNote: "No partners have been removed." },
  excluded: { label: "Not eligible", description: "Never a candidate for this initiative; the reason comes from the source.", emptyNote: "No partners are marked not eligible." },
};
/** Why inclusion is not Asked, not consent and not audience membership. */
export const MEMBERSHIP_RULES_COPY = {
  notAsked: "Adding a partner to the working list is not the same as having asked them.",
  notConsent: "Inclusion gives no consent for contact or Updates, and none is recorded here.",
  notAudienceMembership: "A working-list partner is not an Update audience member, and this list enables no notice.",
  explicitSelectionOnly: "Only partners you select join the working list; a later filter match never adds anyone.",
  removalPreservesHistory: "Removing a partner keeps its history and any obligation recorded elsewhere.",
  returnRestoresEligiblePlanning: "Returning a partner restores eligible planning only and grants no permission.",
} as const;
/** The four ways a stage can appear on this surface. */ export const STAGE_STATES = ["recorded", "retired", "denied", "unavailable"] as const;
export type StageState = (typeof STAGE_STATES)[number];
export const STAGE_STATE_COPY: Record<StageState, { label: string; description: string }> = {
  recorded: { label: "Recorded", description: "A human assessment the worker recorded; it is never a prediction of giving." },
  retired: { label: "Retired", description: "The source no longer admits this stage, so it is shown as retired or missing." },
  denied: { label: "Not permitted", description: "You are not permitted to see or set this stage, and nothing about it is shown." },
  unavailable: { label: "Unavailable", description: "The source could not answer, so this is never shown as having no stage." },
};
/** The stage selector is compact, works by keyboard and single pointer, and has no drag affordance; moving a partner between lists is the explicit Return action. */
export const STAGE_SELECTOR_COPY = {
  label: "Stage",
  help: "Choose from the list the source admits; a stage is the worker's own assessment.",
  clearLabel: "Clear stage",
  clearHelp: "Clearing removes the recorded assessment and moves no one between lists.",
  sameValueNote: "No change: the stage already holds this value.",
  movedToListNote: "Moving a partner off the working list is the explicit Return action, never a drag.",
  noTaskCreatedNote: "Changing a stage creates no task and pauses or resumes nothing.",
} as const;
/** The seven ways a Request can be answered. */ export const RESPONSE_KINDS = ["agreed", "conditional", "partial", "deferred", "declined", "unanswered", "needs clarification"] as const;
export type ResponseKind = (typeof RESPONSE_KINDS)[number];
/** The three kinds that assert agreement — agreed, conditional and partial. */
export const ASSERTING_RESPONSE_KINDS = ["agreed", "conditional", "partial"] as const satisfies readonly ResponseKind[];
export const RESPONSE_KIND_COPY: Record<ResponseKind, { label: string; description: string }> = {
  agreed: { label: "Agreed", description: "The named respondent agreed to the terms of this version." },
  conditional: { label: "Agreed with conditions", description: "The respondent agreed subject to conditions recorded with the response." },
  partial: { label: "Agreed in part", description: "The respondent agreed part of the requested terms; the response records which." },
  deferred: { label: "Deferred", description: "The respondent asked for more time before answering; no answer is recorded yet." },
  declined: { label: "Declined", description: "The respondent declined this Request." },
  unanswered: { label: "Unanswered", description: "No answer from the named respondent is recorded yet." },
  "needs clarification": { label: "Needs clarification", description: "The respondent asked for clarification before answering." },
};
/** The boundaries a response must never be read across. */
export const RESPONSE_AGREEMENT_COPY = {
  namedRespondentOneRequest: "A response is the named respondent's answer to one Request.",
  bindsToTermsVersion: "A response binds to the terms version it answers, and earlier versions are kept.",
  agreementCreatesNothing: "Agreement creates no pledge, gift, commitment, subscription, notification or task.",
  withdrawalIsNotRefusal: "Withdrawing a Request is a staff action, not the supporter's refusal.",
  unansweredIsNotDecline: "An unanswered Request is not a decline.",
  unansweredIsRecordedState: "Unanswered is a recorded state, not an empty cell.",
} as const;
/** Requested terms are what the worker asked for, never received support. */
export const REQUESTED_TERMS_COPY = {
  heading: "Requested terms",
  notReceivedSupport: "These are the terms the worker asked for, not received support.",
  currencyLabel: "Currency",
  amountLabel: "Amount requested",
  cadenceLabel: "Cadence",
  termLabel: "Term",
  notStated: "Not stated",
  unknownCurrency: "Currency not recognised, so no amount is shown.",
  nonFinancialLabel: "No amount requested",
  versionLabel: "Terms version",
} as const;
const readableToken = (value: string): string => value.replace(/[_\s-]+/g, " ").trim() || REQUESTED_TERMS_COPY.notStated;
/** Renders a cadence value from the envelope instead of leaving the field blank. */ export const cadenceValueFallback = (value: string): string => readableToken(value);
/** Renders a term value from the envelope instead of leaving the field blank. */ export const termValueFallback = (value: string): string => readableToken(value);
/** Renders a closure disposition from the envelope instead of leaving it blank. */ export const dispositionFallback = (value: string): string => readableToken(value);
/** The four states a Request passes through; each owns its own draft and version. */
export const REQUEST_LIFECYCLE_STATES = ["draft", "submitted", "presented", "answered"] as const;
export type RequestLifecycleState = (typeof REQUEST_LIFECYCLE_STATES)[number];
export const REQUEST_LIFECYCLE_COPY: Record<RequestLifecycleState, { label: string; description: string }> = {
  draft: { label: "Draft", description: "Prepared but not submitted for review, and not presented to the respondent." },
  submitted: { label: "Submitted for review", description: "Waiting for review before it can be presented to the respondent." },
  presented: { label: "Presented", description: "Given to the respondent, with no answer recorded against it yet." },
  answered: { label: "Answered", description: "An answer from the named respondent is recorded against a terms version." },
};
/** The presentation record; the date itself is rendered from the envelope's value. */
export const PRESENTATION_COPY = { presentedOnLabel: "Presented on", mannerLabel: "How it was presented", versionRefLabel: "Terms version presented", earlierVersionsNote: "Earlier presented versions are kept." } as const;
/** Results state their denominator; with none supplied, no share is shown. */
export const RESULTS_COPY = {
  heading: "Results",
  denominatorLabel: "Counted against",
  denominatorMissingNote: "The envelope supplied no denominator, so no share is shown.",
  noResultsNote: "No responses are recorded for this initiative yet.",
  kindColumnLabel: "Response",
  countColumnLabel: "Count",
  shareColumnLabel: "Share of counted responses",
} as const;
/** Closing fences new solicitation; it resolves no outstanding work by itself. */
export const CLOSURE_COPY = {
  closeHeading: "Close initiative",
  closeHelp: "Closing fences new solicitation, and unfinished work that someone owns keeps its owner.",
  dispositionLabel: "Disposition",
  dispositionRequiredNote: "Choose a disposition or an eligible handover before closing.",
  handoffNote: "Work still owned can be handed to someone eligible rather than resolved here.",
  lateResponseNote: "A late response that actually arrives stays recordable without reopening.",
  reopenHeading: "Reopen initiative",
  reopenHelp: "Reopening allows new solicitation again, and the closure history stays in place.",
  historyPreservedNote: "Reopening keeps the closure history and the exclusions that are current.",
} as const;
/** The two initiative states. */ export const INITIATIVE_STATES = ["open", "closed"] as const;
export type InitiativeState = (typeof INITIATIVE_STATES)[number];
export const INITIATIVE_STATE_COPY: Record<InitiativeState, { label: string; description: string }> = {
  open: { label: "Open", description: "Accepting new solicitation and further recorded responses." },
  closed: { label: "Closed", description: "No new solicitation; every recorded response and closure note is kept." },
};
/** List and header wording for the initiatives surfaces. */
export const INITIATIVE_COPY = {
  listHeading: "Initiatives",
  listEmptyTitle: "No initiatives yet",
  listEmptyBody: "Create an initiative to review a working list and record each Request as it is presented.",
  createLabel: "Create an initiative",
  nameLabel: "Name",
  purposeLabel: "Purpose",
  responsibleLabel: "Responsible worker",
  periodLabel: "Period",
  membersHeading: "Working list",
  requestsHeading: "Requests",
  nextWorkHeading: "Next work",
  historyHeading: "History",
} as const;
export type StateNoticeKind = Exclude<NoticeKind, "loading" | "partial-coverage" | "language-unavailable">;
export const STATE_NOTICE_COPY: Record<StateNoticeKind, { title: string; body: string; actionLabel: string | null }> = {
  empty: { title: "Nothing recorded yet", body: "Create an initiative to start a reviewed working list.", actionLabel: null },
  unavailable: { title: "Source unavailable", body: "The source behind this initiative could not answer, so nothing is shown here.", actionLabel: "Try again" },
  denied: { title: "Not available to you", body: "You do not have access to this initiative.", actionLabel: null },
  unknown: { title: "Result not confirmed", body: "The change may have been saved. Check the result for this operation instead.", actionLabel: "Check the result" },
  refused: { title: "This request was refused", body: "The request this view sent is not one the initiative read admits, so nothing was read and the source behind it did not fail.", actionLabel: null },
};
