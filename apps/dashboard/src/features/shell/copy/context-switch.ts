/**
 * The shell's only wording for a deliberate context switch: the Save / Discard / Stay decision, the
 * sentence that reports a dropped late result, the confirmation after a switch that happened, and the
 * chooser a single-ministry session never sees.
 *
 * Why it is in scope. The assigned-folder brief's second item, "context-switch prompts". AAP 0.10.1
 * family "Shell, Home, Settings, Help", which requires that "context switching offers Save, Discard
 * or Stay", that "one ministry opens directly, several offer a chooser", and that the active context
 * is visible wherever an action could cross it. AAP 0.7.1, whose closed outcome set decides what the
 * confirmation may say: a switch that happened is `accepted` or `alreadyAccepted` and nothing else,
 * while `conflict` keeps its own sentence because it is a different fact. AAP 0.12.1 criterion 19,
 * "switching context discards in-flight results from the old context", which is the fact
 * {@link LATE_RESULT_DISCARDED} reports. AAP 0.3.4, which makes
 * `src/components/context-switch-guard.tsx` the one Save / Discard / Stay dialog and the only place
 * the query cache is cleared, so this module supplies that component's words instead of a second
 * guard; because a shared component may not import a feature, the object below reaches it as a prop
 * passed by `features/shell/components/context-switch-surface.tsx`, and the guard's own literals were
 * replaced by that prop rather than kept beside it. AAP 0.11.1, File Creation Plan row
 * `apps/dashboard/src/features/shell/**`.
 *
 * Four facts, four sentences. An applied switch, a conflict, a refusal and a discarded late result
 * look alike on a quiet screen and mean entirely different things, so each has its own sentence here
 * or in the modules named below, and none of them may be presented as another: a conflict is not a
 * success, a discarded result was not applied or merged, and a refusal leaves the current context
 * exactly as it was.
 *
 * What this module deliberately leaves alone. The shell's persistent data-source label and its effect
 * labels, every badge and status tone, and the meaning of a `denied`, `unavailable` or `invalid`
 * switch outcome: those outcomes keep the current context intact and are worded by
 * `./session-states` and by `@/components/state-notice`. Adding any of them here would be a second
 * owner for a sentence that already has one.
 *
 * Text only. No React, no `"use client"`, no JSX, no function that joins a value into a sentence, no
 * translation catalogue and no `t()` helper: the interface language is the reader's own `Intl`
 * preference and not a second copy of these strings. Every sentence is plain, addresses the reader as
 * "you", states no identity, no gender and no urgency, and carries no markup, no emoji and no
 * placeholder for a value the consumer must fill in. The two values a context switch has to name — the
 * pending context's display name and the caller's description of the unsaved work — stay outside this
 * module, because a name is the admitted membership's and a description is the surface's, and neither
 * may be derived, parsed or guessed from an identifier.
 */

import type { ContextSwitchGuardCopy } from "@/components/context-switch-guard";

/**
 * The words the guard renders for one Save / Discard / Stay decision.
 *
 * Each field is a complete sentence or a complete action label, so the guard places these strings
 * without editing them. The three labels are fixed wording, and every note states a rule the decision
 * itself depends on: what saving means, what counts as unsaved work, why staying is safe, and what a
 * conflict did and did not do.
 */
export type ContextSwitchCopy = {
  /** The dialog's heading, naming the decision being made. */
  readonly title: string;
  /** Why the decision exists: the selection decides what the whole workspace reads under. */
  readonly body: string;
  /** The label of the action that saves through the owning surface and then switches. */
  readonly saveLabel: string;
  /** The label of the action that discards the work in progress and switches. */
  readonly discardLabel: string;
  /** The label of the action that stays, which is the default and is never the destructive one. */
  readonly stayLabel: string;
  /** The explanation beside the save action, referenced by it as its description. */
  readonly saveNote: string;
  /** What counts as unsaved work, and that discarding it is the reader's decision. */
  readonly unsavedWorkNote: string;
  /** What a conflict means: the switch was not applied and the input is kept for comparison. */
  readonly conflictNote: string;
  /** Why staying is safe: it is the default and nothing is discarded unless the reader chooses it. */
  readonly stayNote: string;
};

/**
 * The single wording of the Save / Discard / Stay decision.
 *
 * `satisfies ContextSwitchGuardCopy` is the compile-time proof that this object is exactly what the
 * shared guard accepts, so a field renamed on either side fails the build rather than leaving a
 * dialog that reads a second, hand-written set of sentences.
 */
export const CONTEXT_SWITCH_COPY: ContextSwitchCopy = {
  title: "Switch context?",
  body: "You are choosing a different organization or ministry, and everything this workspace shows is read under that selection, so the work in progress here has to be resolved first. Nothing from this context is carried over to the one you choose.",
  saveLabel: "Save and switch",
  discardLabel: "Discard and switch",
  stayLabel: "Stay here",
  saveNote:
    "Saving is the owning surface's own save, which is the editor's autosave or the form's submit, and this workspace never saves on your behalf. The switch waits for that save to settle before it happens.",
  unsavedWorkNote:
    "Unsaved work here is anything you have changed on this screen that has not been saved yet, and choosing to save it through the surface you are working in or to discard it is your decision rather than a default this workspace applies.",
  conflictNote:
    "The switch was not applied because the context changed while you were deciding. Your input is kept beside the current context so you can compare them and make the choice again.",
  stayNote:
    "Staying here is the default, and nothing is discarded unless you choose to discard it.",
} satisfies ContextSwitchGuardCopy;

/**
 * What is reported when the context fence drops an answer produced under the previous context.
 *
 * One sentence, and it reports only the drop. It never says the answer was applied, merged or shown,
 * because it was not, and it names no record, total, title or count from the context that was left:
 * a reader who is told that a result arrived late is told nothing about what it contained.
 */
export const LATE_RESULT_DISCARDED: string =
  "A result that arrived after the context changed was discarded, because it described the context you had left.";

/**
 * The confirmation shown after a switch the service accepted or had already accepted.
 *
 * A label set rather than a sentence with a value baked in: the organization and ministry names come
 * from the admitted membership the session or chooser envelope supplies, and the consumer renders
 * them isolated inside `<bdi>` from that name. Nothing here derives, parses or guesses a display name
 * from an identifier, and `unlabelledScope` is the word used when the envelope supplies no name at
 * all, so an identifier is never rendered as if it were one.
 */
export const CONTEXT_CHANGED = {
  title: "Context changed",
  body: "Everything in this workspace is now read under the organization and ministry shown here.",
  organizationLabel: "Organization",
  ministryLabel: "Ministry",
  unlabelledScope: "Name not supplied",
} as const;

/**
 * The chooser, and the reason a single-ministry session never has to read it.
 *
 * The note is copy rather than a component decision: a session admitted to one ministry opens that
 * ministry directly, so a prompt about a choice that does not exist is never shown to it.
 */
export const CHOOSER_COPY = {
  title: "Choose an organization and ministry",
  body: "Choose the organization and ministry this workspace should read under. Every option is a membership your session has been admitted to.",
  oneMinistryNote:
    "When your session admits a single ministry, that ministry opens directly and this chooser is not shown.",
} as const;
