/**
 * The Coaching family's single wording source: what each sharable module is called and means, what
 * every module, target, check-in, task-summary and grant state says, the four sharing outcomes, the
 * six stop-type effects, the five limit messages, the retained-basis wording a financial range is
 * reported on, and the page copy for the six coaching surfaces.
 */
import { CHECKIN_MAX_ANSWER_SCALARS, CHECKIN_MAX_QUESTION_SCALARS, CHECKIN_MAX_QUESTIONS, CHECKIN_MAX_REQUEST_BYTES, type CheckInState } from "@/modules/coaching/checkin";
import type { GrantLifecycleState, ModuleKey, ModuleReadState } from "@/modules/coaching/grant";
import type { TargetMeasure, TargetPeriod, TargetState } from "@/modules/coaching/target";
import { TASK_SUMMARY_MAX_CODE_POINTS, type TaskShareSummaryState } from "@/modules/coaching/taskshare";
import { BASIS_DESCRIPTION, SUPPORT_BASIS, type SupportMeasure } from "@/modules/support/basis";
// The two shapes every state map shares
/** Wording that names one state: the short label a control or badge renders, and the sentence that says what the state means. */
export interface StateCopy {
  readonly label: string;
  readonly description: string;
}
/** Wording for one thing the worker may share: what it is called, and what sharing it would reveal. */
export interface ModuleCopy {
  readonly name: string;
  readonly description: string;
}
// The five modules a grant may share
/** The five modules, worded once for the invitation screen and for the sharing screen. */
export const MODULE_COPY: Readonly<Record<ModuleKey, ModuleCopy>> = {
  "support-goal": {
    name: "Support goal",
    description:
      "The support goal set for this ministry and how the current period stands against it, on the " +
      "one basis every figure in this application uses. Sharing the goal shares the goal and its " +
      "progress, and no gift row.",
  },
  "support-results": {
    name: "Support results",
    description:
      "Received support over a fixed range of dates you review before you share it, on that same " + "named basis. It carries no donor, gift or commitment drilldown and no way to rebuild a total.",
  },
  targets: {
    name: "Targets",
    description: "The targets you set and how the current period is going, counted only from activity you " + "recorded. The name you give a target stays with you and is never shared.",
  },
  "check-ins": {
    name: "Check-ins",
    description:
      "Only the check-in revisions you deliberately share, with the questions exactly as you worded " + "them when you started writing. Your private writing stays private until you share it.",
  },
  "task-summaries": {
    name: "Task summaries",
    description:
      "Only the task summaries you select and review: a description you wrote for this purpose, the " + "live due date and the live status, and never the task's own title, notes, links or history.",
  },
};
// What a coach reads inside an admitted module
/** The five states a shared module can be read in, worded so no two of them can be mistaken for each other. */
export const MODULE_READ_STATE_COPY: Readonly<Record<ModuleReadState, StateCopy>> = {
  empty: {
    label: "Nothing recorded",
    description: "This module is shared and nothing has been recorded in it for the dates you were given. It is " + "an empty period rather than a hidden one, and it is not a zero.",
  },
  partial: {
    label: "Partly covered",
    description: "Some of this period's records can be read and some cannot yet. What is missing is stated as " + "missing and is never counted as zero.",
  },
  withheld: {
    label: "Held until reviewed",
    description: "Content in this module is held because its reviewed meaning changed. Held is not empty: it " + "stays out of view until the worker reviews it again.",
  },
  unavailable: {
    label: "Unavailable right now",
    description: "The source behind this module cannot be read at the moment. This is an outage that ends on " + "its own — not an empty module, and not the end of the relationship.",
  },
  ended: {
    label: "Has ended",
    description: "The dates this module was shared for have run out, so nothing new appears here. Whether the " + "coaching relationship continues is a separate question from this share ending.",
  },
};
// The four measures a target may count
/** Wording for one measure: its short label, and the hint that keeps the count honest. */
export interface MeasureCopy {
  readonly label: string;
  readonly hint: string;
}
/** The four canonical measures, each with the hint that says where its count comes from. */
export const MEASURE_COPY: Readonly<Record<TargetMeasure, MeasureCopy>> = {
  "calls-made": {
    label: "Calls made",
    hint: "Counts only the individual calls you record as an interaction. Opening a dialler counts " + "nothing, and a call you planned but have not made is not a call.",
  },
  "personal-messages": {
    label: "Personal messages",
    hint: "Counts only the messages to one person that you record as an interaction. A broadcast, an " + "automated reply or a message that was opened counts nothing.",
  },
  conversations: {
    label: "Conversations",
    hint: "Counts only the conversations you record. A planned meeting, a missed meeting and a clicked " + "link count nothing, and five calls that hold two conversations stay five and two.",
  },
  "meetings-held": {
    label: "Meetings held",
    hint: "Counts only the meetings you record as held. A meeting that was planned, booked or missed " + "counts nothing, and completing the task behind it does not make it held.",
  },
};
// The three periods a target may be measured over
/** The period vocabulary, derived from the domain's own `TargetPeriod` union rather than restated: a second hand-written list of period names would drift from the one the resolver measures. */
export type PeriodKind = TargetPeriod["kind"];
/** Wording for one period kind: its label, and what its dates are. */
export interface PeriodKindCopy {
  readonly label: string;
  readonly description: string;
}
/** Weekly, monthly and the one-off custom range, worded so a custom period cannot be read as a rhythm. */
export const PERIOD_COPY: Readonly<Record<PeriodKind, PeriodKindCopy>> = {
  weekly: {
    label: "Weekly",
    description: "Seven days from the weekday the target starts on. This is the period a new target uses, and a " + "period still running says so until it closes.",
  },
  monthly: {
    label: "Monthly",
    description: "One calendar month from the day of the month you chose. A month too short for that day ends " + "on its final day, and that resolution is stated beside the dates.",
  },
  custom: {
    label: "One-off period",
    description: "One first date and one last date that you name. It is a single period and not a rhythm: " + "nothing repeats when it ends.",
  },
};
// The state a target surface renders
/** The seven target states, worded so a genuine zero, a paused target, an ended target, an unplaced target and an unreadable source stay seven different things. */
export const TARGET_STATE_COPY: Readonly<Record<TargetState, StateCopy>> = {
  "no-target": {
    label: "No target",
    description: "No target is set for this period. Setting one asks for a measure, a quantity and a period, and " + "nothing is counted until activity is recorded against it.",
  },
  active: {
    label: "In progress",
    description: "The count comes only from activity records dated inside this period. The period is still " + "running, so the count can still change.",
  },
  "zero-recorded": {
    label: "Nothing recorded yet",
    description:
      "No activity has been recorded in this period so far. It states a count of zero and says " +
      "nothing about the effort you made: a conversation you record later counts from the day it " +
      "happened.",
  },
  paused: {
    label: "Paused",
    description: "The target keeps its history and nothing is counted against it while it is paused. Periods " + "that closed while it was live keep the plan they were measured against.",
  },
  ended: {
    label: "Ended",
    description: "The target has ended. Periods that closed while it was live keep the plan they were measured " + "against, and ending a target changes no activity record.",
  },
  unplaced: {
    label: "Not on Home",
    description: "The target is active and you have not placed it on Home. Placement changes only what you see " + "there: it creates no commitment and no reminder, and no coach can read it.",
  },
  unavailable: {
    label: "Unavailable",
    description: "The activity source behind this target cannot be read right now, so no count is shown. " + "Unavailable is neither a zero nor an empty period.",
  },
};
// What a coach reads of a shared task summary
/** The four readings of a task share, worded so a removal, a hold for review and an outage stay apart. */
export const TASK_SHARE_STATE_COPY: Readonly<Record<TaskShareSummaryState, StateCopy>> = {
  shared: {
    label: "Shared",
    description: "The description you reviewed is current. The task's live due date and live status sit beside " + "it, and sharing the summary created no interaction and no task.",
  },
  "needs-review": {
    label: "Held until you review it",
    description: "The reviewed description changed, so the summary is withheld until you review it again. " + "Nothing new is shown in the meantime, and the task itself keeps working as before.",
  },
  removed: {
    label: "No longer shared",
    description: "You stopped sharing this summary. The task itself is untouched: it keeps its title, its due " + "date and its status.",
  },
  unavailable: {
    label: "Unavailable",
    description: "The task behind this summary cannot be read at the moment. This is an outage, not an empty " + "share and not a removal.",
  },
};
// What a check-in is right now
/** The four check-in states, worded so a private draft, a shared revision, a withdrawal and an outage are four answers. */
export const CHECK_IN_STATE_COPY: Readonly<Record<CheckInState, StateCopy>> = {
  "private-draft": {
    label: "Private draft",
    description: "Saved for you alone. Autosave keeps this draft, and a coach can read nothing until you share a " + "revision deliberately.",
  },
  shared: {
    label: "Shared",
    description:
      "One revision is shared, with the questions as they were worded when you started writing it. " +
      "Your private draft and the shared revision stay separate: changing the draft changes nothing a " +
      "coach can read until you update the shared revision.",
  },
  withdrawn: {
    label: "Withdrawn",
    description: "You withdrew the shared revision. The check-in keeps its record and stays yours, and nothing " + "that was already seen can be recalled.",
  },
  unavailable: {
    label: "Unavailable",
    description: "The check-in source cannot be read at the moment. This is an outage, not an empty check-in.",
  },
};
// The lifecycle of a coaching episode
/** The eight lifecycle states, worded so no two closures read as one. */
export const GRANT_STATE_COPY: Readonly<Record<GrantLifecycleState, StateCopy>> = {
  invited: {
    label: "Invitation recorded",
    description: "The invitation exists in this application and names the person, the ministry, the modules and " + "the duration. No module is switched on yet and the person has not accepted.",
  },
  accepted: {
    label: "Accepted, access not yet live",
    description:
      "The person accepted deliberately and access is not live yet. When the source behind a module " +
      "cannot be read, the episode is accepted but access is unavailable; the other modules stay " +
      "readable.",
  },
  active: {
    label: "Active",
    description: "Access is live until the agreed end. Only the modules you switched on can be read, and only " + "inside the dates the invitation named.",
  },
  revoked: {
    label: "Revoked by the worker",
    description: "You revoked the grant, so no further reads are allowed from now on. Revoking stops access; it " + "does not take back what a coach already saw.",
  },
  expired: {
    label: "Reached its agreed end",
    description: "The share window closed at the end chosen when the episode began. A date passed: this is " + "neither a revocation nor an ending you chose.",
  },
  ended: {
    label: "Ended by the worker",
    description: "You ended the coaching relationship. A later action cannot reopen it, and ending it withdraws " + "nothing that a coach already read.",
  },
  left: {
    label: "Left by the coach",
    description: "The coach left the relationship. This is not an ending you chose: your own work is unchanged " + "and only the coach's access stops.",
  },
  superseded: {
    label: "Replaced by a newer invitation",
    description: "A newer invitation replaced this one before it was accepted, so it can no longer be accepted. " + "Nothing was shared under it.",
  },
};
// The four outcomes a sharing step passes through
/** The four outcomes, in the order a sharing surface states them. */
export type SharingOutcomeId = "delivery" | "identity-verification" | "deliberate-acceptance" | "active-access";
/** Wording for one sharing outcome: its identity, its label, and the one thing it does not mean. */
export interface SharingOutcomeCopy {
  readonly id: SharingOutcomeId;
  readonly label: string;
  readonly description: string;
}
type SharingOutcomeAt<Id extends SharingOutcomeId> = {
  readonly id: Id;
  readonly label: string;
  readonly description: string;
};
/** The four outcomes, as a tuple of exactly four entries in a fixed order: an invitation being recorded, an identity being verified, an acceptance being deliberate, and access being live. */
export const SHARING_OUTCOME_COPY = [
  {
    id: "delivery",
    label: "Invitation recorded",
    description:
      "The invitation was written down in this application and names the person and what would be " +
      "shared. This says nothing about arrival and nothing about access: no message leaves this " +
      "application, and a matching email address verifies nobody.",
  },
  {
    id: "identity-verification",
    label: "Identity verified",
    description: "The person's identity was verified against the account they act in. A matching address, an " + "existing relationship or a staff title verifies nobody on its own.",
  },
  {
    id: "deliberate-acceptance",
    label: "Accepted deliberately",
    description: "The person accepted, as a decision of their own. Opening a link or previewing an invitation " + "accepts nothing, and accepting on its own makes no module readable.",
  },
  {
    id: "active-access",
    label: "Access live",
    description: "Access is live for the modules switched on, inside the agreed dates. It ends at the agreed end " + "even when a stored status still looks live.",
  },
] as const satisfies readonly [SharingOutcomeAt<"delivery">, SharingOutcomeAt<"identity-verification">, SharingOutcomeAt<"deliberate-acceptance">, SharingOutcomeAt<"active-access">];
// The six stop-type effects, each with its own sentence
/** The six things a worker or a coach can stop, closed by name so each one keeps its own sentence. */
export const STOP_EFFECTS = ["stop-module", "withdraw-check-in", "remove-task-share", "end-relationship", "coach-leave", "revoke"] as const;
/** One stop-type effect, derived from {@link STOP_EFFECTS}. */
export type StopEffect = (typeof STOP_EFFECTS)[number];
/** Wording for one stop effect: the title of its control, the question its confirmation asks, what stops happening, and the two assurances every one of them owes the person confirming it. */
export interface StopEffectCopy {
  readonly title: string;
  readonly question: string;
  readonly consequence: string;
  readonly assurance: string;
}
/** The six stop effects, keyed by name so no two share a sentence. */
export const STOP_EFFECT_COPY: Readonly<Record<StopEffect, StopEffectCopy>> = {
  "stop-module": {
    title: "Stop sharing a module",
    question: "Stop sharing this module?",
    consequence: "The module stops being readable from now on and is no longer part of what the invitation " + "shares. The other modules you switched on are unaffected.",
    assurance: "The work in the module is not deleted: your targets, check-ins and task summaries stay exactly " + "as they are. Nothing that was already seen can be recalled.",
  },
  "withdraw-check-in": {
    title: "Withdraw a shared check-in",
    question: "Withdraw the shared revision of this check-in?",
    consequence: "The shared revision stops being readable from now on. Your private draft is a separate " + "revision and keeps working.",
    assurance: "The check-in is not deleted: its record stays yours, and your private draft is untouched. " + "Nothing that was already seen can be recalled.",
  },
  "remove-task-share": {
    title: "Stop sharing a task summary",
    question: "Stop sharing this task summary?",
    consequence: "The summary stops being readable from now on. The task keeps its title, its due date and its " + "status, and it stays on your list.",
    assurance: "The task is not deleted: stopping the share changes nothing about the work itself. Nothing " + "that was already seen can be recalled.",
  },
  "end-relationship": {
    title: "End the coaching relationship",
    question: "End this coaching relationship?",
    consequence: "Every module stops being readable from now on, whatever dates the invitation named, and a " + "later action cannot reopen the episode.",
    assurance: "Your work is not deleted: targets, check-ins, task summaries and notes stay exactly as you " + "left them. Nothing that was already seen can be recalled.",
  },
  "coach-leave": {
    title: "Leave the coaching relationship",
    question: "Leave this coaching relationship?",
    consequence: "Your access to every module stops from now on. The worker's own work carries on untouched, " + "and this is recorded as you leaving rather than as the worker ending it.",
    assurance: "The worker's work is not deleted, and nothing in this application changes it. Nothing that " + "was already seen can be recalled: what you have already read stays read.",
  },
  revoke: {
    title: "Revoke the grant",
    question: "Revoke this coach's access?",
    consequence: "Access stops from now on for every module, and the invitation that granted it can no longer " + "be used.",
    assurance: "Your work is not deleted, and the work behind each module stays as it was. Nothing that was " + "already seen can be recalled.",
  },
};
// The five limit messages
/** The five sentences a limit refusal shows, each built from the constant the domain enforces. */
export interface LimitCopy {
  readonly questionSetExceeded: (count: number) => string;
  readonly questionTextExceeded: (index: number, count: number) => string;
  readonly answerTextExceeded: (index: number, count: number) => string;
  readonly requestSizeExceeded: (bytes: number) => string;
  readonly taskDescriptionExceeded: (codePoints: number) => string;
}
/** The five limit messages, one per limit the coaching domain enforces. */
export const LIMIT_COPY: LimitCopy = {
  questionSetExceeded(count: number): string {
    return (
      `This check-in carries ${count} questions and the limit is ${CHECKIN_MAX_QUESTIONS}. ` +
      "Nothing was dropped: take one question out and save again, with every other question worded " +
      "exactly as you wrote it."
    );
  },
  questionTextExceeded(index: number, count: number): string {
    return `Question ${index} is ${count} characters long and the limit is ` + `${CHECKIN_MAX_QUESTION_SCALARS}. Nothing was dropped: word it within the limit and save again.`;
  },
  answerTextExceeded(index: number, count: number): string {
    return `Answer ${index} is ${count} characters long and the limit is ` + `${CHECKIN_MAX_ANSWER_SCALARS}. Nothing was dropped: word it within the limit and save again.`;
  },
  requestSizeExceeded(bytes: number): string {
    return (
      `This check-in comes to ${bytes} bytes and one check-in may hold ` +
      `${CHECKIN_MAX_REQUEST_BYTES}. Nothing was dropped: save what belongs in this check-in, and ` +
      "keep anything else for a check-in of its own."
    );
  },
  taskDescriptionExceeded(codePoints: number): string {
    return (
      `The description is ${codePoints} characters long and the limit is ` +
      `${TASK_SUMMARY_MAX_CODE_POINTS}. Nothing was dropped: bring it within the limit and review ` +
      "it again before it is shared."
    );
  },
};
// The financial range a worker may share
/** The wording for the one reviewed financial range a grant may disclose. */
export interface FinancialRangeCopy {
  readonly heading: string;
  readonly purpose: string;
  readonly basisStatement: string;
  readonly rangeStatement: string;
  readonly exclusions: string;
  readonly measuresNote: string;
  readonly measures: Readonly<Record<SupportMeasure, string>>;
  readonly unavailable: string;
}
/** The financial range's wording: the basis it is reported on, what it covers, and what it omits. */
export const FINANCIAL_RANGE_COPY: FinancialRangeCopy = {
  heading: "Financial range you shared",
  purpose: "A fixed range of dates that you reviewed before sharing, reported on the same basis as every " + "other figure in this application.",
  basisStatement: `Every figure in this range is reported on the one named basis this application measures, ` + `${SUPPORT_BASIS}, and on no other. ${BASIS_DESCRIPTION}`,
  rangeStatement:
    "The range covers the first date and the last date you reviewed and nothing outside them. " +
    "Sharing it is a separate decision from sharing targets, check-ins or task summaries, and it " +
    "never widens to all history.",
  exclusions:
    "The range carries no donor, gift or commitment drilldown, no per-record amounts and no way to " +
    "rebuild a total from what is shown. A value that cannot be read is stated as unavailable and is " +
    "never shown as zero.",
  measuresNote: "The measures below are five different facts and never five parts of one total, so no two of " + "them are added together.",
  measures: {
    "received-gifts": "Received gifts: cash the source counted as received inside the range, and nothing else.",
    "recurring-collection-outcomes": "Recurring collection outcomes: what happened to each scheduled collection. An occurrence " + "still processing is not received money.",
    commitments: "Commitments: what has been promised. A promise is never cash and never a received figure.",
    "monthly-equivalent-support": "Monthly-equivalent support: the source's own qualification of recurring support, not an " + "average of the gifts in the range.",
    "support-goal": "Support goal: the goal set for the ministry. Sharing a goal is a separate decision from " + "sharing results.",
  },
  unavailable: "The source behind this range cannot be read right now. The range is unavailable rather than " + "empty, and your other shared modules stay readable.",
};
// The six coaching surfaces
/** The six surfaces this family renders, by the names its routes and panels use. */
export type CoachingSurface = "overview" | "targets" | "checkIns" | "sharing" | "coachPortfolio" | "coachSubject";
/** Static wording for one surface: its heading, one line saying what the surface is for, and the four sentences a surface needs. */
export interface SurfaceCopy {
  readonly heading: string;
  readonly purpose: string;
  readonly empty: string;
  readonly partial: string;
  readonly unavailable: string;
}
/** The six surfaces, worded once so a component renders these sentences and invents none. */
export const COACHING_COPY: Readonly<Record<CoachingSurface, SurfaceCopy>> = {
  overview: {
    heading: "Coaching",
    purpose: "Optional private preparation, and the one place you decide what a coach may read, for how " + "long, and in which ministry.",
    empty: "You have not set any coaching preparation up yet. Prepare privately first — write a check-in " + "for yourself or set a target — and invite a coach when you are ready to share something.",
    partial: "Part of your preparation is ready and part is not. Nothing becomes readable by a coach until " + "you switch a module on and the person accepts.",
    unavailable: "Some of your coaching preparation cannot be read right now. What you have already saved is " + "untouched; try again in a moment.",
  },
  targets: {
    heading: "Targets",
    purpose: "Targets count only the calls, messages, conversations and meetings you actually recorded, " + "over a weekly, monthly or one-off period.",
    empty: "No target yet. Set one — a measure, a quantity and a period — and it will count only the " + "activity you record from then on.",
    partial: "Some of this period's activity can be read and some cannot yet. The part that cannot be read " + "is stated as missing rather than counted as zero.",
    unavailable: "The activity source behind your targets cannot be read right now. Targets are unavailable " + "rather than empty, and nothing you recorded has changed.",
  },
  checkIns: {
    heading: "Check-ins",
    purpose: "Write check-ins privately and share one revision deliberately; sharing a check-in creates " + "no notification, no interaction and no task.",
    empty: "No check-in yet. Start one and write as much or as little as you like; a coach reads nothing " + "until you share a revision.",
    partial: "Some of your check-ins can be read and some cannot yet. One that cannot be reached stays " + "listed and is never shown as an empty check-in.",
    unavailable: "Check-ins cannot be read right now. This is an outage rather than an empty list, and your " + "saved writing is untouched.",
  },
  sharing: {
    heading: "Who can see what",
    purpose: "Invite one named coach, for the ministries you choose and a duration you choose, and switch " + "on only the modules you want read.",
    empty:
      "No coaching relationship is set up yet. Invite a coach by naming the person, the ministry, " +
      "the modules and a duration; modules start switched off and nothing is readable until the " +
      "person accepts.",
    partial: "Some modules are switched on and some are off. Only the ones you switched on can be read, " + "and only inside the dates you named.",
    unavailable: "Sharing details cannot be read right now. Access follows the invitation you already " + "recorded; nothing has widened while this is unavailable.",
  },
  coachPortfolio: {
    heading: "Coaching relationships",
    purpose: "Read-only: what workers have deliberately shared with you as their coach, and nothing else.",
    empty: "Nothing is shared with you yet. A relationship appears here only when a worker invites you " + "and you accept it, and then only the modules that worker switched on.",
    partial: "Part of what was shared with you can be read and part cannot yet. The part that cannot be " + "read is stated rather than shown as empty.",
    unavailable: "Coaching relationships cannot be read right now. This is an outage, not an empty portfolio.",
  },
  coachSubject: {
    heading: "What this worker shared",
    purpose: "Read-only: the modules this worker switched on, inside the dates they chose.",
    empty: "This module has nothing recorded for the dates you were given. The other modules you were " + "given stay available.",
    partial: "Part of this module can be read and part cannot yet. What is missing is stated as missing " + "and is never counted as zero.",
    unavailable: "The source behind this module cannot be read right now. The other modules you were given " + "stay available.",
  },
};
// How a target's plan changes over time
/** The one standing sentence a target's history states beside its version list. */
export const TARGET_VERSION_GUARANTEE =
  "A change to the quantity, the measure or the calendar start begins a new version of the plan " +
  "from the date it takes effect, and a period that has closed keeps the version it was measured " +
  "against: no two versions cover the same day, and the period where a change landed is never " +
  "split into a prorated bridge.";
