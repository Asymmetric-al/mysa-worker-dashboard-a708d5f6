import { CHECKIN_MAX_ANSWER_SCALARS, CHECKIN_MAX_QUESTION_SCALARS, CHECKIN_MAX_QUESTIONS, CHECKIN_MAX_REQUEST_BYTES, type CheckInState } from "@/modules/coaching/checkin";
import type { GrantLifecycleState, ModuleKey, ModuleReadState } from "@/modules/coaching/grant";
import type { TargetMeasure, TargetPeriod, TargetState } from "@/modules/coaching/target";
import { TASK_SUMMARY_MAX_CODE_POINTS, type TaskShareSummaryState } from "@/modules/coaching/taskshare";
import { BASIS_DESCRIPTION, type SupportMeasure } from "@/modules/support/basis";
export type StateCopy = { readonly label: string; readonly description: string };
export type ModuleCopy = { readonly name: string; readonly description: string };
export const MODULE_COPY: Readonly<Record<ModuleKey, ModuleCopy>> = {
  "support-goal": { name: "Support goal", description: "Your support goal and current progress percentage — never individual gift records." },
  "support-results": { name: "Support summary", description: "Received support totals for a fixed date range you review before sharing — no donor names, gift rows, or commitment breakdowns." },
  targets: { name: "Activity targets", description: "Your activity targets and recorded progress. Your private label for each target stays private." },
  "check-ins": { name: "Check-ins", description: "Only the specific check-in revisions you choose to share. Private drafts stay visible only to you." },
  "task-summaries": { name: "Task summaries", description: "Only the tasks you explicitly select, using the summary you write plus due date and status — never private notes or links." },
};
export const MODULE_READ_STATE_COPY: Readonly<Record<ModuleReadState, StateCopy>> = {
  empty: { label: "Nothing recorded", description: "Shared for these dates, with no activity recorded in this period." },
  partial: { label: "Partial coverage", description: "Some records in this date range are available and others aren’t yet. Missing data isn’t counted as zero." },
  withheld: { label: "Paused for review", description: "Hidden until you review and re-approve your updated summary." },
  unavailable: { label: "Unavailable right now", description: "Couldn’t load this module right now. Try again shortly — your sharing permissions haven’t changed." },
  ended: { label: "Ended", description: "The shared date window has ended, so no new data appears here." },
};
/** The reading the domain states as `null`: a switched-on module whose content is whole. */
export const MODULE_COMPLETE_COPY: StateCopy = { label: "Shared", description: "On — your coach can view this module within the dates you chose." };
export type MeasureCopy = { readonly label: string; readonly hint: string };
export const MEASURE_COPY: Readonly<Record<TargetMeasure, MeasureCopy>> = {
  "calls-made": { label: "Calls made", hint: "Counts calls you log as completed activity (planned tasks aren’t counted)." },
  "personal-messages": { label: "Personal messages", hint: "Counts one-to-one messages you log as completed activity (excludes mass updates)." },
  conversations: { label: "Conversations", hint: "Counts real conversations you log with partners." },
  "meetings-held": { label: "Meetings held", hint: "Counts meetings you log as completed (scheduled or missed meetings aren’t counted)." },
};
export type PeriodKind = TargetPeriod["kind"];
export type PeriodKindCopy = { readonly label: string; readonly description: string };
export const PERIOD_COPY: Readonly<Record<PeriodKind, PeriodKindCopy>> = {
  weekly: { label: "Weekly", description: "Repeats every 7 days starting on your chosen day." },
  monthly: { label: "Monthly", description: "Repeats each calendar month (shorter months end on their last day)." },
  custom: { label: "One-off dates", description: "A single start-to-end date range that doesn’t repeat." },
};
export const TARGET_STATE_COPY: Readonly<Record<TargetState, StateCopy>> = {
  "no-target": { label: "No target", description: "No target set yet. Choose what to count, a goal number, and a timeframe." },
  active: { label: "In progress", description: "Counts logged activity dated inside this active period." },
  "zero-recorded": { label: "None logged yet", description: "0 logged so far in this period. Any activity you log later counts toward the date it occurred." },
  paused: { label: "Paused", description: "Paused — past completed periods stay in your history while new activity isn’t tracked against this target." },
  ended: { label: "Ended", description: "Ended — past periods remain in your history and your logged activities stay untouched." },
  unplaced: { label: "Hidden from Home", description: "Active, but not pinned to your Home page." },
  unavailable: { label: "Unavailable", description: "Couldn’t load activity totals right now — shown as unavailable rather than zero." },
};
export const TASK_SHARE_STATE_COPY: Readonly<Record<TaskShareSummaryState, StateCopy>> = {
  shared: { label: "Shared", description: "Your coach sees this summary along with the task’s current due date and status." },
  "needs-review": { label: "Needs review", description: "Paused because the summary changed — review and approve it before your coach sees updates." },
  removed: { label: "Not shared", description: "Stopped sharing with your coach. Your task itself stays unchanged in Tasks." },
  unavailable: { label: "Unavailable", description: "Couldn’t load this task right now. Try again in a moment." },
};
export const CHECK_IN_STATE_COPY: Readonly<Record<CheckInState, StateCopy>> = {
  "private-draft": { label: "Private draft", description: "Only visible to you. Saved automatically until you choose to share a revision." },
  shared: { label: "Shared", description: "A snapshot is shared with your coach. Further edits stay private until you share a new revision." },
  withdrawn: { label: "Unshared", description: "No longer visible to your coach. Your check-in stays saved in your workspace." },
  unavailable: { label: "Unavailable", description: "Couldn’t load this check-in right now. Your saved writing is safe." },
};
export const GRANT_STATE_COPY: Readonly<Record<GrantLifecycleState, StateCopy>> = {
  invited: { label: "Invitation sent", description: "Recorded with the ministry, modules, and dates you chose. Nothing is visible until your coach accepts." },
  accepted: { label: "Accepted", description: "Your coach accepted. Access becomes active for any modules you turn on." },
  active: { label: "Active", description: "Your coach can view the modules you turned on until the end date." },
  revoked: { label: "Access revoked", description: "You revoked access — your coach can no longer view any modules." },
  expired: { label: "Expired", description: "The agreed sharing period ended automatically on its end date." },
  ended: { label: "Ended by you", description: "You ended this coaching relationship. Your own records remain untouched." },
  left: { label: "Coach stepped away", description: "Your coach left this coaching relationship. Your own records remain untouched." },
  superseded: { label: "Replaced", description: "Replaced by a newer invitation before it was accepted." },
};
export type SharingOutcomeId = "delivery" | "identity-verification" | "deliberate-acceptance" | "active-access";
export type SharingOutcomeCopy = { readonly id: SharingOutcomeId; readonly label: string; readonly description: string };
type SharingOutcomeAt<Id extends SharingOutcomeId> = { readonly id: Id; readonly label: string; readonly description: string };
export const SHARING_OUTCOME_COPY = [
  { id: "delivery", label: "Invitation recorded", description: "Saved in Mysa with your chosen modules and dates. No external email is sent in this demo." },
  { id: "identity-verification", label: "Account verified", description: "Verified against the coach’s signed-in account — never assumed from a matching email or job title." },
  { id: "deliberate-acceptance", label: "Coach accepted", description: "The coach explicitly chose to accept. Opening a preview never accepts automatically." },
  { id: "active-access", label: "Sharing active", description: "Only the modules you turn on are visible, and access stops automatically on the end date." },
] as const satisfies readonly [SharingOutcomeAt<"delivery">, SharingOutcomeAt<"identity-verification">, SharingOutcomeAt<"deliberate-acceptance">, SharingOutcomeAt<"active-access">];
export const STOP_EFFECTS = ["stop-module", "withdraw-check-in", "remove-task-share", "end-relationship", "coach-leave", "revoke"] as const;
export type StopEffect = (typeof STOP_EFFECTS)[number];
export type StopEffectCopy = { readonly title: string; readonly question: string; readonly consequence: string; readonly assurance: string };
export const STOP_EFFECT_COPY: Readonly<Record<StopEffect, StopEffectCopy>> = {
  "stop-module": {
    title: "Stop sharing module",
    question: "Stop sharing this module?",
    consequence: "Your coach can no longer view this module. Other modules you’ve turned on aren’t affected.",
    assurance: "Nothing is deleted — your targets, check-ins, and tasks stay right where they are. Stopping access applies going forward and doesn’t recall what was already seen.",
  },
  "withdraw-check-in": {
    title: "Unshare check-in",
    question: "Stop sharing this check-in?",
    consequence: "Removes this check-in from your coach’s view. Your private draft stays untouched.",
    assurance: "Your check-in isn’t deleted. Unsharing stops future access and doesn’t recall anything already seen.",
  },
  "remove-task-share": {
    title: "Stop sharing task summary",
    question: "Stop sharing this task summary?",
    consequence: "Your coach will no longer see this task summary. The task stays in your Tasks list.",
    assurance: "Your task isn’t deleted or modified.",
  },
  "end-relationship": {
    title: "End coaching relationship",
    question: "End this coaching relationship?",
    consequence: "Immediately stops your coach’s access to every module. Ended relationships can’t be reopened.",
    assurance: "Nothing in your workspace is deleted — your targets, check-ins, tasks, and notes all stay yours.",
  },
  "coach-leave": {
    title: "Leave coaching relationship",
    question: "Leave this coaching relationship?",
    consequence: "Ends your read-only access immediately. Recorded as you stepping away rather than the missionary ending it.",
    assurance: "The missionary’s workspace and records remain untouched.",
  },
  revoke: {
    title: "Revoke coach access",
    question: "Revoke this coach’s access?",
    consequence: "Immediately stops access across every module and invalidates this invitation.",
    assurance: "Nothing in your workspace is deleted. Revoking stops access going forward.",
  },
};
export type LimitCopy = {
  readonly questionSetExceeded: (count: number) => string;
  readonly questionTextExceeded: (index: number, count: number) => string;
  readonly answerTextExceeded: (index: number, count: number) => string;
  readonly requestSizeExceeded: (bytes: number) => string;
  readonly taskDescriptionExceeded: (codePoints: number) => string;
};
export const LIMIT_COPY: LimitCopy = {
  questionSetExceeded(count: number): string {
    return `You have ${count} questions (limit is ${CHECKIN_MAX_QUESTIONS}). Remove one question before saving.`;
  },
  questionTextExceeded(index: number, count: number): string {
    return `Question ${index} is ${count} characters (limit is ${CHECKIN_MAX_QUESTION_SCALARS}). Shorten it before saving.`;
  },
  answerTextExceeded(index: number, count: number): string {
    return `Answer ${index} is ${count} characters (limit is ${CHECKIN_MAX_ANSWER_SCALARS}). Shorten it before saving.`;
  },
  requestSizeExceeded(bytes: number): string {
    return `This check-in is ${bytes} bytes (limit is ${CHECKIN_MAX_REQUEST_BYTES}). Trim it slightly or split notes into a second check-in.`;
  },
  taskDescriptionExceeded(codePoints: number): string {
    return `This summary is ${codePoints} characters (limit is ${TASK_SUMMARY_MAX_CODE_POINTS}). Shorten it before sharing.`;
  },
};
export type TargetPlanRefusals = { readonly measureUnknown: string; readonly quantityNotANumber: string; readonly quantityNotWhole: string; readonly quantityBelowOne: string; readonly periodUnknown: string; readonly calendarDateNotADay: string; readonly privateLabelEmpty: string; readonly targetNotNamed: string };
export const TARGET_PLAN_REFUSALS: TargetPlanRefusals = {
  measureUnknown: "Choose one of the four activity types: Calls made, Personal messages, Conversations, or Meetings held.",
  quantityNotANumber: "Enter a target number for each period.",
  quantityNotWhole: "Enter a whole number (no decimals).",
  quantityBelowOne: "Enter at least 1.",
  periodUnknown: "Choose Weekly, Monthly, or One-off dates.",
  calendarDateNotADay: "Enter a valid calendar date (YYYY-MM-DD, for example 2026-09-12).",
  privateLabelEmpty: "Enter a private name for this target.",
  targetNotNamed: "Couldn’t identify which target to update. Reload Targets and try again.",
};
export type FinancialRangeCopy = { readonly heading: string; readonly purpose: string; readonly basisStatement: string; readonly rangeStatement: string; readonly exclusions: string; readonly measuresNote: string; readonly measures: Readonly<Record<SupportMeasure, string>>; readonly unavailable: string };
export const FINANCIAL_RANGE_COPY: FinancialRangeCopy = {
  heading: "Shared support summary",
  purpose: "High-level totals for a fixed date range you review before sharing.",
  basisStatement: `Effective cash allocation — ${BASIS_DESCRIPTION}`,
  rangeStatement: "Covers only the start and end dates you choose — never your entire giving history.",
  exclusions: "No donor names, individual gifts, or commitment rows are shared. Unavailable figures are shown as unavailable rather than zero.",
  measuresNote: "Each measure below is tracked separately and never combined into one figure.",
  measures: {
    "received-gifts": "Received gifts: verified cash received during this date range.",
    "recurring-collection-outcomes": "Recurring collections: status of scheduled recurring gifts (in-flight payments aren’t counted as cash).",
    commitments: "Commitments: standing pledges (kept separate from received cash).",
    "monthly-equivalent-support": "Monthly equivalents: source-calculated recurring estimates (not averaged from gifts).",
    "support-goal": "Support goal: your personal goal (shared separately from support results).",
  },
  unavailable: "Couldn’t load this support summary right now. Your other shared modules stay available.",
};
export type CoachingSurface = "overview" | "targets" | "checkIns" | "sharing" | "coachPortfolio" | "coachSubject";
export type SurfaceCopy = { readonly heading: string; readonly purpose: string; readonly empty: string; readonly partial: string; readonly unavailable: string };
export const COACHING_COPY: Readonly<Record<CoachingSurface, SurfaceCopy>> = {
  overview: {
    heading: "Coaching",
    purpose: "Track personal ministry targets, write private check-ins, and choose exactly what to share with a coach.",
    empty: "Nothing set up yet. Start privately with an activity target or check-in, and invite a coach whenever you’re ready.",
    partial: "Some coaching data loaded and some is temporarily unavailable. Nothing is shared with a coach until you turn it on and they accept.",
    unavailable: "Couldn’t load Coaching right now. Your saved work is safe — try again in a moment.",
  },
  targets: {
    heading: "Targets",
    purpose: "Set personal weekly, monthly, or one-off goals for calls, personal messages, conversations, and meetings.",
    empty: "No activity targets yet. Create one to track your logged ministry outreach.",
    partial: "Some activity records couldn’t be loaded right now. Missing data isn’t counted as zero.",
    unavailable: "Couldn’t load your activity totals right now. Your logged activities are safe.",
  },
  checkIns: {
    heading: "Check-ins",
    purpose: "Reflect privately on your ministry and share selected revisions with your coach when ready.",
    empty: "No check-ins yet. Start a private check-in — your coach sees nothing until you choose to share it.",
    partial: "Some check-ins couldn’t load right now. Try refreshing in a moment.",
    unavailable: "Couldn’t load Check-ins right now. Your saved drafts are untouched.",
  },
  sharing: {
    heading: "Sharing & coach access",
    purpose: "Invite a coach for a chosen ministry and timeframe, and toggle exactly which modules they can see.",
    empty: "You aren’t sharing with a coach yet. Invite a coach when you’re ready — all modules start off until you turn them on.",
    partial: "Only the modules toggled on below are visible to your coach within your chosen dates.",
    unavailable: "Couldn’t load sharing settings right now. Existing permissions remain unchanged.",
  },
  coachPortfolio: {
    heading: "Coach view",
    purpose: "Read-only overview of missionaries who have invited you and chosen to share modules with you.",
    empty: "No missionaries are sharing with you yet. Invitations appear here once accepted.",
    partial: "Some shared modules couldn’t load right now and are marked unavailable.",
    unavailable: "Couldn’t load Coach view right now. Try again in a moment.",
  },
  coachSubject: {
    heading: "Shared by missionary",
    purpose: "Read-only view of the modules this missionary chose to share with you.",
    empty: "Nothing recorded in this module for the shared dates. Other shared modules remain available.",
    partial: "Some data in this module couldn’t load right now and isn’t counted as zero.",
    unavailable: "Couldn’t load this module right now. Other shared modules remain available.",
  },
};
export const TARGET_VERSION_GUARANTEE =
  "Changing a target’s measure, goal number, or start date creates a new version from its effective date while keeping completed past periods unchanged.";
