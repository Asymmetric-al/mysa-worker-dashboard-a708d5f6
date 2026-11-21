/**
 * The shell's only wording for the five session states, and the standalone account-recovery block a
 * gate renders when no admitted identity exists at all.
 */
import type { NoticeKind } from "@/components/state-notice";
import type { SessionState } from "@/modules/data-service/envelope";
/** The wording one session state renders: a short title, the sentence that carries the fact, the ordered steps a reader can take next, and the notice the state is rendered through. */
export type SessionStateEntry = {
  readonly title: string;
  readonly body: string;
  readonly recoverySteps: readonly string[];
  readonly noticeKind: NoticeKind | null;
  readonly actionLabel?: string;
  readonly sourceLabel?: string;
};
const NO_ACCESS_STEPS: readonly string[] = [
  "Check that you are using the account you meant to use, because admission follows the account and not the device or the browser.",
  "Ask the organization you work with to confirm whether it has admitted this account; there is no form or invitation that can be sent from here.",
  "Help explains what each state means and which parts of the workspace an admitted session can open.",
];
/** The standalone guidance block rendered for an account with no admitted membership. */
export const NO_ACCESS_RECOVERY = {
  title: "No workspace access",
  body: "This account is not admitted to a workspace, so nothing about organizations, ministries or records can be shown or changed here. Admission is decided outside this workspace, and this screen cannot grant it.",
  steps: NO_ACCESS_STEPS,
  helpLabel: "Open Help",
  helpHref: "/help",
} as const;
/** The wording of every session state, keyed by the service's own union so a state added there fails to compile here. */
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
/** The human word for each session state, for consumers of `src/components/status-badge.tsx`. */
export const SESSION_STATE_LABEL: Record<SessionState, string> = {
  "signed-in": "Signed in",
  unavailable: "Session unavailable",
  denied: "Access denied",
  expired: "Session expired",
  "no-access": "No account access",
};
