import type { DevState } from "@/modules/data-service/reads/dev";
export const SCENARIO_COPY = {
  title: "Scenario",
  body: "A scenario selects the seeded world this session runs in: which source is unavailable, which content state is seeded and which setting the referral journey is under. It changes that world for this session only, so two sessions can be in two different scenarios at once.",
  emptyTitle: "No scenario is available",
  emptyBody: "This session's development runtime advertises no scenario, so nothing can be selected here. The state is reported as it stands rather than replaced by a default that the runtime does not define.",
} as const;
export const CLOCK_COPY = {
  title: "Clock",
  body: "The clock is an offset from one fixed seed instant, and only the controls here move it. Nothing advances it in the background, so a boundary becomes true when a read or a command is evaluated against the instant shown beside it.",
  offsetLabel: "Offset from the seed instant",
  instantLabel: "Instant this session reads at",
  advanceLabel: "Advance the clock",
  presetsLabel: "Preset amounts to advance by",
  presetPendingNote: "Applying that preset to this development session and waiting for the answer.",
} as const;
export const FAILURE_PLAN_COPY = {
  title: "Failure plan",
  body: "A plan injects one outcome into one named read or mutation, so the surface that has to handle a refusal, a stale revision or an unconfirmed result can be seen doing it.",
  summary: "A plan is armed for exactly one named read or mutation, and it is visible here before it fires: its mode, the call it targets, the instant it was armed at, what you will see and what the way out is.",
  clearLabel: "Clear the armed plan",
  armedNote: "The armed plan applies to the next call of the named read or mutation only, and it stays visible until you clear it, so no other call in this session is affected.",
  inactiveNote: "No plan is armed, so every read and every mutation answers from the application's own behaviour. This sentence describes an idle plan only: a plan whose state could not be read is a different fact, and it is stated as one rather than as nothing armed.",
} as const;
export type FailureModeCopy = { readonly name: string; readonly explanation: string; readonly recovery: string };
export type FailureMode = NonNullable<DevState["failurePlan"]["mode"]>;
export const FAILURE_MODE_COPY: Readonly<Record<FailureMode, FailureModeCopy>> = {
  denied: {
    name: "Scope denial",
    explanation: "Injects a refusal into one read or mutation, so the surface has to answer without revealing whether anything exists behind it.",
    recovery: "A denial carries no count, title, size or existence flag for what it refused, and the independent work on that surface stays usable. The way out is to carry on with what your own scope permits, or to ask for the access you need.",
  },
  conflict: {
    name: "Changed revision",
    explanation: "Injects a stale expected revision into one mutation, so a change made since you read the record is detected instead of overwritten.",
    recovery: "A conflict shows the current value beside the input you sent, which is kept for comparison, and nothing is replaced until you have compared them and applied your change again deliberately.",
  },
  unknown: {
    name: "Lost acknowledgement",
    explanation: "Injects a lost acknowledgement into one mutation, so the effect may or may not have been applied and neither success nor failure is claimed.",
    recovery: "An unconfirmed result offers one way out: check the result by the operation identity this attempt carried, which answers whether the effect exists. It never offers a resend, because a fresh attempt could apply the same change twice.",
  },
};
export const PERSONA_SWITCH_COPY = {
  label: "Preview persona",
  selectLabel: "Seeded identity this browser acts as",
  explanation: "This development control selects the seeded session this browser acts as, so a preview shows what that identity is given.",
  grantsNothingNote: "It grants nothing: every read that follows is authorised again, so a persona that may not read a surface receives the honest denial notice instead of a hidden destination.",
  selectionNote: "Choosing one of these selects the seeded session this browser acts as. The choice travels in this browser's own session cookie, it changes nothing the store holds, and it is not a sign-in: the identity a read is authorised for is decided again on every request.",
  pendingNote: "Switching this browser's session and waiting for the answer.",
} as const;
/** The sentences the composition states instead of a panel when this session's development runtime could not be read at all. */
export const DEV_READ_COPY = {
  loadingTitle: "Reading this session's development runtime",
  deniedTitle: "This session's development controls are not readable here",
  unavailableTitle: "This session's development runtime could not be read",
  refusedTitle: "The development read's own request was refused",
  retryLabel: "Read the development runtime again",
} as const;
export const RESET_COPY = {
  title: "Reset the local session store",
  body: "This deletes the local session store this application keeps for its development sessions, and re-seeds it from the deterministic seed so the seeded records come back exactly as they were. Nothing outside this application is touched by it.",
  confirmLabel: "Reset and re-seed",
  cancelLabel: "Cancel",
  irreversibleNote: "Every accepted edit is discarded, and the reset cannot be undone.",
  sameAsCommandNote: "This is the same operation as running bun run reset from the repository root.",
} as const;
export const CLOCK_PRESETS = [
  { label: "1 minute", seconds: 60 },
  { label: "1 hour", seconds: 3_600 },
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
] as const;
