/**
 * The shell's only wording for the development controls: the scenario picker, the clock, the failure
 * plan, the preview persona switch and the reset confirmation, plus the four amounts the clock
 * control advances by.
 *
 * Why it is in scope. The assigned-folder brief's third item, "the development labels". AAP 0.7.2,
 * which fixes what these controls are: a scenario that selects the world this session runs in, a
 * clock held as an offset from one seed instant whose derived instant is displayed exactly as the
 * service computed it, one deterministic failure armed at a time, a destructive local reset, and a
 * persona switch that is "a development control, not an authentication system". Two of that
 * section's assumptions are honoured here by their content rather than by a label: the clock is a
 * per-session offset moved only by these controls with no background job, and one failure mode is
 * armed for one named read or mutation at a time, visibly, before it fires. AAP 0.8.7, which puts
 * every boundary — the notification window, the confirmation window, the referral endpoint and the
 * coaching cutoff — in `@/modules/time`: the presets below are display constants, and this module
 * performs no time arithmetic at all, so the panel shows the offset and the derived instant and
 * never recomputes either. The scope definition keeps the development controls development-only and
 * the reset local, so no sentence here describes a deployment, a production environment or an
 * integration. AAP File Creation Plan row `apps/dashboard/src/features/shell/**`.
 *
 * One home, and no second copy. `components/dev-panel`, `components/persona-switcher` and the
 * Settings reset control are shared components, so they may not import a feature: these objects
 * reach them as props passed by `features/shell/components/dev-controls`, and every sentence a
 * development control says is written here once. Nothing in this module restates the persistent
 * banner label that `components/dev-banner` owns or the per-effect sentences that
 * `components/simulation-label` owns, and no badge, tone or status vocabulary belongs here either.
 *
 * Three facts that must not merge. An armed plan, an idle plan and a plan whose state could not be
 * read are three different states, and the idle case is worded so it cannot be used to report the
 * third as nothing armed. An unconfirmed result is neither a success nor a failure: it offers a
 * re-check by operation identity and never a fresh send. The persona switch is a preview control
 * that confers no access, and the reset discards this application's own local session store and
 * claims nothing beyond that.
 *
 * The failure modes are keyed on the read contract's own union, not on a list written here.
 * `readDevState` reports its plan through `DevState["failurePlan"]`, whose `mode` is the closed
 * failure union or `null` when nothing is armed, so {@link FailureMode} is derived from that member
 * and {@link FAILURE_MODE_COPY} is a total record over it: a mode reaching a panel without a
 * sentence in that table stops the build rather than reaching a screen unlabelled. The type is
 * imported from the data-service read contract rather than from `@/modules/data-service`, because
 * that module re-exports its envelope and outcome contracts only and the mode union lives beside
 * the read that reports it. It is never taken from `@/modules/dev-runtime`, which a feature may not
 * import.
 *
 * Text only. No React, no `"use client"`, no JSX, no runtime dependency, no side effect on import,
 * no function that joins a value into a sentence, no translation catalogue and no `t()` helper: the
 * interface language is the reader's own `Intl` preference, not a second copy of these strings.
 * Every sentence is plain, addresses the reader as "you", names nobody's identity, and carries no
 * markup, no emoji, no exclamation and no urgency.
 */

import type { DevState } from "@/modules/data-service/reads/dev";

// ---------------------------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------------------------

/**
 * The scenario picker: what a scenario decides, and the state of a runtime that offers none.
 *
 * The selectable scenarios are the ones `readDevState` reports, so this object names none of them: a
 * scenario id, label or description written here would be a second registry that could offer a world
 * the seed does not define. The empty state exists because "the runtime advertises no scenario" is a
 * fact to state, not a list to leave blank, and it says so instead of offering a default world.
 */
export const SCENARIO_COPY = {
  /** The control group's heading. */
  title: "Scenario",
  /** What choosing a scenario changes, and for whom. */
  body: "A scenario selects the seeded world this session runs in: which source is unavailable, which content state is seeded and which setting the referral journey is under. It changes that world for this session only, so two sessions can be in two different scenarios at once.",
  /** The heading of the state where no scenario can be chosen. */
  emptyTitle: "No scenario is available",
  /** Why nothing is offered, and that no default is invented in its place. */
  emptyBody:
    "This session's development runtime advertises no scenario, so nothing can be selected here. The state is reported as it stands rather than replaced by a default that the runtime does not define.",
} as const;

// ---------------------------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------------------------

/**
 * The clock control: the offset, the instant the service derived from it, and the words of the two
 * actions that move it.
 *
 * The offset and the derived instant are two separate labels on purpose. An offset alone does not
 * tell a reader what the workspace now reads as, and an instant alone does not tell them what they
 * asked for, so the panel shows both and neither is blended into one sentence. Neither is computed
 * here: `readDevState` reports both, and this module carries no arithmetic.
 */
export const CLOCK_COPY = {
  /** The control group's heading. */
  title: "Clock",
  /** That the clock is an offset, who moves it, and when a boundary becomes true. */
  body: "The clock is an offset from one fixed seed instant, and only the controls here move it. Nothing advances it in the background, so a boundary becomes true when a read or a command is evaluated against the instant shown beside it.",
  /** The label of the stored offset, which is what the reader asked for. */
  offsetLabel: "Offset from the seed instant",
  /** The label of the instant the service derived from that offset, shown as reported. */
  instantLabel: "Instant this session reads at",
  /** The action that moves the clock forward by the chosen amount. */
  advanceLabel: "Advance the clock",
  /** The name of the group of preset amounts the advance action offers. */
  presetsLabel: "Preset amounts to advance by",
} as const;

// ---------------------------------------------------------------------------------------------
// Failure plan
// ---------------------------------------------------------------------------------------------

/**
 * The failure plan: what arming one does, the summary of an armed plan, the disarm action, and the
 * wording of the armed and idle cases.
 *
 * The three states a plan can be in stay three. `armedNote` describes a plan that is on, and
 * `inactiveNote` describes a plan that is off without being usable for a plan whose state could not
 * be read — that state is a different fact with its own repair, and a sentence that could cover both
 * would let a refused read look like a quiet, healthy panel.
 */
export const FAILURE_PLAN_COPY = {
  /** The control group's heading. */
  title: "Failure plan",
  /** What arming a plan is for, in one sentence. */
  body: "A plan injects one outcome into one named read or mutation, so the surface that has to handle a refusal, a stale revision or an unconfirmed result can be seen doing it.",
  /** What an armed plan states before it fires. */
  summary:
    "A plan is armed for exactly one named read or mutation, and it is visible here before it fires: its mode, the call it targets, the instant it was armed at, what you will see and what the way out is.",
  /** The action that returns the plan to nothing armed. */
  clearLabel: "Clear the armed plan",
  /** The armed case: what the plan applies to, and what it leaves alone. */
  armedNote:
    "The armed plan applies to the next call of the named read or mutation only, and it stays visible until you clear it, so no other call in this session is affected.",
  /** The idle case, stated so it cannot stand in for a plan that could not be read. */
  inactiveNote:
    "No plan is armed, so every read and every mutation answers from the application's own behaviour. This sentence describes an idle plan only: a plan whose state could not be read is a different fact, and it is stated as one rather than as nothing armed.",
} as const;

/**
 * One failure mode's words: the name a control shows, what arming it demonstrates, and the honest
 * way out of the outcome it injects.
 */
export type FailureModeCopy = {
  /** The mode's name, matching the outcome it injects. */
  readonly name: string;
  /** What arming the mode demonstrates, in one sentence. */
  readonly explanation: string;
  /** What the person can honestly do once the outcome arrives. */
  readonly recovery: string;
};

/**
 * The three failure modes, as the read contract closes them.
 *
 * Derived from `DevState` rather than declared here, so the set is the development runtime's own and
 * this module keeps no fourth possibility of its own. Keying the table on it makes the mapping total:
 * a mode with no sentence below cannot compile, which is what keeps an unlabelled mode off a screen.
 */
export type FailureMode = NonNullable<DevState["failurePlan"]["mode"]>;

/**
 * The sentence each mode carries.
 *
 * A mode is looked up by the value `readDevState` advertised, and only the three values below exist,
 * so a lookup cannot miss. A surface that meets a value this table does not hold renders that value's
 * own text instead of failing or guessing a label: an unrecognised mode is a fact worth showing, and
 * it is never silently relabelled as one of these three.
 */
export const FAILURE_MODE_COPY: Readonly<Record<FailureMode, FailureModeCopy>> = {
  denied: {
    name: "Scope denial",
    explanation:
      "Injects a refusal into one read or mutation, so the surface has to answer without revealing whether anything exists behind it.",
    recovery:
      "A denial carries no count, title, size or existence flag for what it refused, and the independent work on that surface stays usable. The way out is to carry on with what your own scope permits, or to ask for the access you need.",
  },
  conflict: {
    name: "Changed revision",
    explanation:
      "Injects a stale expected revision into one mutation, so a change made since you read the record is detected instead of overwritten.",
    recovery:
      "A conflict shows the current value beside the input you sent, which is kept for comparison, and nothing is replaced until you have compared them and applied your change again deliberately.",
  },
  unknown: {
    name: "Lost acknowledgement",
    explanation:
      "Injects a lost acknowledgement into one mutation, so the effect may or may not have been applied and neither success nor failure is claimed.",
    recovery:
      "An unconfirmed result offers one way out: check the result by the operation identity this attempt carried, which answers whether the effect exists. It never offers a resend, because a fresh attempt could apply the same change twice.",
  },
};

// ---------------------------------------------------------------------------------------------
// Preview persona
// ---------------------------------------------------------------------------------------------

/**
 * The persona switch: its label, what selecting one is, and the fact that it grants nothing.
 *
 * The switch changes which seeded identity this session carries. It is not a way in and never a
 * grant: the service authorises every read that follows, so an identity that may not read a surface
 * meets the denial notice there rather than a destination quietly removed from its navigation. The
 * label matches the word the switch itself is mounted with, so a caller passing these words changes
 * no visible wording.
 */
export const PERSONA_SWITCH_COPY = {
  /** The visible label of the switch, and its accessible group name. */
  label: "Preview persona",
  /** What selecting a persona is, and what it affects. */
  explanation:
    "This development control selects the seeded persona or session state this session carries, so a preview shows what that identity is given.",
  /** That a selection confers no access, and what a refused surface shows instead. */
  grantsNothingNote:
    "It grants nothing: every read that follows is authorised again, so a persona that may not read a surface receives the honest denial notice instead of a hidden destination.",
} as const;

// ---------------------------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------------------------

/**
 * The reset confirmation: what it deletes, what it restores, and what it cannot do.
 *
 * The reset is destructive and local. It discards this application's own local session store and
 * re-seeds it from the deterministic seed, which is the same operation as the documented command, so
 * the panel says both things rather than describing a stronger or larger act than it performs. The
 * wording names no server, no provider, no source system and no other person's copy, because none of
 * them is touched by it.
 */
export const RESET_COPY = {
  /** The confirmation's heading. */
  title: "Reset the local session store",
  /** What the reset deletes, what it re-seeds, and the limit of what it reaches. */
  body: "This deletes the local session store this application keeps for its development sessions, and re-seeds it from the deterministic seed so the seeded records come back exactly as they were. Nothing outside this application is touched by it.",
  /** The action that performs the reset. */
  confirmLabel: "Reset and re-seed",
  /** The action that leaves everything as it is. */
  cancelLabel: "Cancel",
  /** The two facts a reader must have before confirming: what is lost, and that it is final. */
  irreversibleNote: "Every accepted edit is discarded, and the reset cannot be undone.",
  /** The command that performs the identical operation outside the interface. */
  sameAsCommandNote:
    "This is the same operation as running bun run reset from the repository root.",
} as const;

// ---------------------------------------------------------------------------------------------
// Clock presets
// ---------------------------------------------------------------------------------------------

/**
 * The four amounts the clock control advances by, as literal seconds.
 *
 * Display constants only. Every boundary — the notification window, the confirmation window, the
 * referral endpoint and the coaching cutoff — belongs to `@/modules/time` (AAP 0.8.7), so the
 * consumer sends the number below to `advanceClock` and nothing multiplies or converts it here.
 * The values are declared once because `features/shell/schemas/dev` reads them for that payload,
 * which is why each entry is literal seconds rather than a unit and a count a component would have
 * to combine.
 */
export const CLOCK_PRESETS = [
  { label: "1 minute", seconds: 60 },
  { label: "1 hour", seconds: 3_600 },
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
] as const;
