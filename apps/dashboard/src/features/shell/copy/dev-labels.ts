/**
 * The shell's only wording for the development controls: the scenario picker, the clock, the failure
 * plan, the preview persona switch and the reset confirmation, plus the four amounts the clock control
 * advances by.
 */
import type { DevState } from "@/modules/data-service/reads/dev";
// Scenario
/** The scenario picker: what a scenario decides, and the state of a runtime that offers none. */
export const SCENARIO_COPY = {
  title: "Scenario",
  body: "A scenario selects the seeded world this session runs in: which source is unavailable, which content state is seeded and which setting the referral journey is under. It changes that world for this session only, so two sessions can be in two different scenarios at once.",
  emptyTitle: "No scenario is available",
  emptyBody:
    "This session's development runtime advertises no scenario, so nothing can be selected here. The state is reported as it stands rather than replaced by a default that the runtime does not define.",
} as const;
// Clock
/** The clock control: the offset, the instant the service derived from it, and the words of the two actions that move it. */
export const CLOCK_COPY = {
  title: "Clock",
  body: "The clock is an offset from one fixed seed instant, and only the controls here move it. Nothing advances it in the background, so a boundary becomes true when a read or a command is evaluated against the instant shown beside it.",
  offsetLabel: "Offset from the seed instant",
  instantLabel: "Instant this session reads at",
  advanceLabel: "Advance the clock",
  presetsLabel: "Preset amounts to advance by",
} as const;
// Failure plan
/** The failure plan: what arming one does, the summary of an armed plan, the disarm action, and the wording of the armed and idle cases. */
export const FAILURE_PLAN_COPY = {
  title: "Failure plan",
  body: "A plan injects one outcome into one named read or mutation, so the surface that has to handle a refusal, a stale revision or an unconfirmed result can be seen doing it.",
  summary:
    "A plan is armed for exactly one named read or mutation, and it is visible here before it fires: its mode, the call it targets, the instant it was armed at, what you will see and what the way out is.",
  clearLabel: "Clear the armed plan",
  armedNote: "The armed plan applies to the next call of the named read or mutation only, and it stays visible until you clear it, so no other call in this session is affected.",
  inactiveNote:
    "No plan is armed, so every read and every mutation answers from the application's own behaviour. This sentence describes an idle plan only: a plan whose state could not be read is a different fact, and it is stated as one rather than as nothing armed.",
} as const;
/** One failure mode's words: the name a control shows, what arming it demonstrates, and the honest way out of the outcome it injects. */
export type FailureModeCopy = {
  readonly name: string;
  readonly explanation: string;
  readonly recovery: string;
};
/** The three failure modes, as the read contract closes them. */
export type FailureMode = NonNullable<DevState["failurePlan"]["mode"]>;
/** The sentence each mode carries. */
export const FAILURE_MODE_COPY: Readonly<Record<FailureMode, FailureModeCopy>> = {
  denied: {
    name: "Scope denial",
    explanation: "Injects a refusal into one read or mutation, so the surface has to answer without revealing whether anything exists behind it.",
    recovery:
      "A denial carries no count, title, size or existence flag for what it refused, and the independent work on that surface stays usable. The way out is to carry on with what your own scope permits, or to ask for the access you need.",
  },
  conflict: {
    name: "Changed revision",
    explanation: "Injects a stale expected revision into one mutation, so a change made since you read the record is detected instead of overwritten.",
    recovery:
      "A conflict shows the current value beside the input you sent, which is kept for comparison, and nothing is replaced until you have compared them and applied your change again deliberately.",
  },
  unknown: {
    name: "Lost acknowledgement",
    explanation: "Injects a lost acknowledgement into one mutation, so the effect may or may not have been applied and neither success nor failure is claimed.",
    recovery:
      "An unconfirmed result offers one way out: check the result by the operation identity this attempt carried, which answers whether the effect exists. It never offers a resend, because a fresh attempt could apply the same change twice.",
  },
};
// Preview persona
/** The persona switch: its label, what selecting one is, and the fact that it grants nothing. */
export const PERSONA_SWITCH_COPY = {
  label: "Preview persona",
  explanation: "This development control selects the seeded persona or session state this session carries, so a preview shows what that identity is given.",
  grantsNothingNote: "It grants nothing: every read that follows is authorised again, so a persona that may not read a surface receives the honest denial notice instead of a hidden destination.",
} as const;
// Reset
/** The reset confirmation: what it deletes, what it restores, and what it cannot do. */
export const RESET_COPY = {
  title: "Reset the local session store",
  body: "This deletes the local session store this application keeps for its development sessions, and re-seeds it from the deterministic seed so the seeded records come back exactly as they were. Nothing outside this application is touched by it.",
  confirmLabel: "Reset and re-seed",
  cancelLabel: "Cancel",
  irreversibleNote: "Every accepted edit is discarded, and the reset cannot be undone.",
  sameAsCommandNote: "This is the same operation as running bun run reset from the repository root.",
} as const;
// Clock presets
/** The four amounts the clock control advances by, as literal seconds. */
export const CLOCK_PRESETS = [
  { label: "1 minute", seconds: 60 },
  { label: "1 hour", seconds: 3_600 },
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
] as const;
