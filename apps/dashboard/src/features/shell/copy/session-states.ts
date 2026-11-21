/**
 * The shell's only wording for the five session states, and the standalone account-recovery block a
 * gate renders when no admitted identity exists at all.
 *
 * Why it is in scope. The assigned-folder brief's first item, "copy for session states, denial
 * recovery guidance". AAP 0.10.1 family "Shell, Home, Settings, Help", which requires entry with the
 * four session states plus a no-access recovery state and confines Help to these workflows. AAP 0.7.2,
 * which fixes the states themselves and the no-access user "whose only honest outcome is
 * account-recovery guidance". AAP 0.3.2, which makes authorisation precede enumeration, so a denial
 * discloses nothing — no count, no title, no size, no existence hint — and every sentence a refused
 * reader sees has to be the same whether or not anything is behind the door. AAP 0.12.1 criteria 2, 19,
 * 20 and 21: entry survives a reset seed, the denied persona learns nothing about a hidden record, the
 * notices pass the accessibility pass, and every state is reachable. AAP 0.11.1, File Creation Plan row
 * `apps/dashboard/src/features/shell/**`.
 *
 * Five states, five different facts. A session that cannot be read is not a session that was refused;
 * a refusal is not an expiry; and none of the three is the account that was never admitted anywhere,
 * which is the one case where something can honestly be said about recovery. Collapsing any two of
 * them would either disclose what a refusal is meant to withhold or send a reader looking for a
 * recovery path this release cannot provide, so each state's title, sentence and steps are written to
 * state the one fact that separates it from the state most easily mistaken for it.
 *
 * Exhaustive by construction. Both tables are keyed by the service's own `SessionState`, never by
 * `string` and never by a local copy of the union, so a sixth state added to the service fails this
 * module's compilation instead of rendering nothing. The state-to-guidance mapping itself stays the
 * service's (`GUIDANCE_BY_STATE` in `src/modules/data-service/reads/shell.ts`, keyed
 * `workspace-ready`, `account-recovery`, `request-access`, `sign-in-again`, `retry-later` and
 * bijective with these five states); those are stable keys, not sentences, and the service states
 * that the words belong here. Because the mapping is one-to-one, an entry fetched by state already
 * supplies the words for its guidance key, so no second copy of that mapping is declared here.
 *
 * `SessionState` is imported from `@/modules/data-service/envelope` rather than from the service
 * index, because the index does not re-export it and the service's own consumers import it from the
 * envelope. The import is type-only in both cases, so this module is erased at build time and holds
 * no runtime dependency on the service or on any component.
 *
 * What this module deliberately leaves alone. The persistent data-source label belongs to
 * `src/components/dev-banner.tsx`, the label every external effect shows at the point it is triggered
 * belongs to the shared effect-label component in `src/components` (AAP 0.3.4), every tone, colour,
 * variant and icon belongs to `src/components/status-badge.tsx`, the notice vocabulary belongs to
 * `src/components/state-notice.tsx`, and the Save / Discard / Stay decision belongs to
 * `./context-switch`. Adding any of them here would give a sentence or a tone a second owner. The five
 * words in `SESSION_STATE_LABEL` are the one overlap with `src/components/persona-switcher.tsx`, whose
 * development-only control labels the same five states with a tone attached; it cannot import this
 * module because a shared component may never import a feature, so the words are stated twice for two
 * surfaces and nowhere else. Nothing here describes a capability this release does not have: there is
 * no sign-in form, no reset link, no invitation to send and no contact address to offer, and saying so
 * plainly is the honest alternative to inventing one.
 *
 * Text only. No React, no `"use client"`, no JSX, no function that joins a value into a sentence, no
 * translation catalogue and no `t()` helper: the interface language is the reader's own `Intl`
 * preference, not a second copy of these strings. Every sentence is plain, addresses the reader as
 * "you", names no identity, no gender and no amount, carries no markup, no numbering, no emoji, no
 * placeholder for a value the consumer must fill in, and no bidi control character; an opaque source
 * reference is isolated by the consumer at the render site, which is why `sourceLabel` supplies only
 * the word that introduces it.
 */

import type { NoticeKind } from "@/components/state-notice";
import type { SessionState } from "@/modules/data-service/envelope";

/**
 * The wording one session state renders: a short title, the sentence that carries the fact, the
 * ordered steps a reader can take next, and the notice the state is rendered through.
 *
 * `recoverySteps` is an ordered list the consumer renders as one, so no step carries its own
 * numbering, and an admitted state carries an empty list rather than a step that says there is
 * nothing to do. `actionLabel` is the word of the one control the state offers, and `sourceLabel` the
 * word introducing the source an unreadable surface names; a state that offers neither omits the
 * field instead of passing an empty string, so the consumer can tell "no control" from "a control
 * with no word".
 */
export type SessionStateEntry = {
  /** The short heading; for a refusal it names the surface's condition, never a record. */
  readonly title: string;
  /** The one sentence that states what happened and what it does and does not mean. */
  readonly body: string;
  /** The ordered steps a reader can take, with no numbering of their own; empty for an admission. */
  readonly recoverySteps: readonly string[];
  /** The notice that renders this state, or `null` when the state renders no notice. */
  readonly noticeKind: NoticeKind | null;
  /** The word of the state's one control, where the state offers one. */
  readonly actionLabel?: string;
  /** The word that introduces an opaque source reference, where the state names a source. */
  readonly sourceLabel?: string;
};

/**
 * The recovery steps for an account that no workspace admits.
 *
 * Declared once and referenced from both {@link NO_ACCESS_RECOVERY} and the `no-access` entry of
 * {@link SESSION_STATE_COPY}, so the standalone block a gate renders and the table entry can never
 * drift into two different sets of instructions. The steps state what a reader can actually settle —
 * which account is in use, and that admission is decided elsewhere — and promise nothing about the
 * outcome, because nothing in this release can grant it.
 */
const NO_ACCESS_STEPS: readonly string[] = [
  "Check that you are using the account you meant to use, because admission follows the account and not the device or the browser.",
  "Ask the organization you work with to confirm whether it has admitted this account; there is no form or invitation that can be sent from here.",
  "Help explains what each state means and which parts of the workspace an admitted session can open.",
];

/**
 * The standalone guidance block rendered for an account with no admitted membership.
 *
 * This is the one state whose words are shown as a page of their own rather than inside a notice, so
 * it carries its own Help destination: the reader is never stranded without a way to understand what
 * happened or what to do next. `steps` is the array declared above, by reference, and `helpHref` is
 * the Help route this application already serves — no other destination is invented here.
 */
export const NO_ACCESS_RECOVERY = {
  title: "No workspace access",
  body: "This account is not admitted to a workspace, so nothing about organizations, ministries or records can be shown or changed here. Admission is decided outside this workspace, and this screen cannot grant it.",
  steps: NO_ACCESS_STEPS,
  helpLabel: "Open Help",
  helpHref: "/help",
} as const;

/**
 * The wording of every session state, keyed by the service's own union so a state added there fails to
 * compile here.
 *
 * A `noticeKind` of `null` means no notice is rendered for that state: `signed-in` is the admitted
 * condition and renders the workspace itself, and `no-access` renders {@link NO_ACCESS_RECOVERY} as
 * its own block because its subject is an account to recover rather than a surface that was stopped.
 */
export const SESSION_STATE_COPY: Record<SessionState, SessionStateEntry> = {
  "signed-in": {
    title: "Signed in",
    body: "Everything in this workspace is read under the organization and ministry this session is admitted to, and every change you make is recorded against that same context.",
    recoverySteps: [],
    // No notice: the admitted state renders the workspace, so there is nothing to report.
    noticeKind: null,
  },
  unavailable: {
    title: "This information could not be read",
    body: "The source that holds it did not answer, so nothing shown here is a zero and nothing shown here is an empty list. The information itself could not be retrieved.",
    recoverySteps: [
      "Carry on with the rest of the workspace, because only this surface is affected and nothing outside it changes.",
      "Trying again repeats the same request under the same identity, so a retry can never become a second effect.",
      "The source is named beside this message, and Help explains what each state means.",
    ],
    noticeKind: "unavailable",
    actionLabel: "Try again",
    sourceLabel: "Source",
  },
  denied: {
    title: "Access is not granted here",
    body: "This part of the workspace is not open to the session you are in. The organization that admits a session decides what it may open, and this session is not admitted here.",
    recoverySteps: [
      "Carry on with the parts of the workspace this session is admitted to, because nothing there is affected by this.",
      "If you expected to work here, the organization that admits this session is the one that decides it, and choosing a different context in the shell changes what the workspace reads under.",
      "Help explains what each state means.",
    ],
    noticeKind: "denied",
    actionLabel: "Open Help",
  },
  expired: {
    title: "This session has ended",
    body: "The session this workspace was reading under has ended, so nothing is read and nothing can be changed until the workspace is entered again. There is no sign-in form, password reset or emailed link to offer, so the workspace entry point is the whole of the route back.",
    recoverySteps: [
      "Enter the workspace again from the workspace entry point, and the new session reads under the context saved for it.",
      "Anything you saved before the session ended stays saved, because a saved change was recorded when it was accepted.",
      "Help explains what each state means.",
    ],
    // No notice kind exists for an ended session, and this is the closest one: the state refuses
    // further reads exactly as a refusal does, and the service's own `session-expired` reason code
    // keeps the two apart while the copy above keeps expiry distinct from a refusal to admit.
    noticeKind: "denied",
    actionLabel: "Go to the workspace entry point",
  },
  "no-access": {
    title: NO_ACCESS_RECOVERY.title,
    body: NO_ACCESS_RECOVERY.body,
    // The same array instance as the standalone block, so the two can never disagree.
    recoverySteps: NO_ACCESS_RECOVERY.steps,
    // No notice: this state renders the standalone recovery block, whose subject is an account to
    // recover rather than a surface that stopped, so no notice kind states it honestly.
    noticeKind: null,
  },
};

/**
 * The human word for each session state, for consumers of `src/components/status-badge.tsx`.
 *
 * Words only: the badge owns every tone, variant, colour and icon in the application, so nothing here
 * decides how a state looks. Each word names the state as a reader would describe it and stays
 * distinct from the other four, which is what stops a reader from reading a refusal as an outage or an
 * outage as an empty workspace.
 */
export const SESSION_STATE_LABEL: Record<SessionState, string> = {
  "signed-in": "Signed in",
  unavailable: "Session unavailable",
  denied: "Access denied",
  expired: "Session expired",
  "no-access": "No account access",
};
