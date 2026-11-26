import type { NoticeKind } from "@/components/state-notice";
import type { SessionState } from "@/modules/data-service/envelope";
export type SessionStateEntry = { readonly title: string; readonly body: string; readonly recoverySteps: readonly string[]; readonly noticeKind: NoticeKind | null; readonly actionLabel?: string; readonly sourceLabel?: string };
const NO_ACCESS_STEPS: readonly string[] = [
  "Make sure you’re signed into the account your sending organization granted access to.",
  "Ask your organization administrator to confirm your ministry workspace membership.",
  "Check Help below for a guide to workspace access and session states.",
];
export const NO_ACCESS_RECOVERY = {
  title: "No workspace access",
  body: "This account isn’t linked to a ministry workspace yet, so no organization, ministry, or partner records are shown here.",
  steps: NO_ACCESS_STEPS,
  helpLabel: "Open Help",
  helpHref: "/help",
} as const;
export const SESSION_STATE_COPY: Record<SessionState, SessionStateEntry> = {
  "signed-in": { title: "Signed in", body: "Everything you view and save belongs to the organization and ministry shown in the header.", recoverySteps: [], noticeKind: null },
  unavailable: {
    title: "Couldn’t load this section",
    body: "We couldn’t reach the data source behind this screen, so nothing is replaced with a zero or an empty list.",
    recoverySteps: [
      "Keep working in other areas of your workspace — only this section is affected.",
      "Click Try again to re-request the same data safely without creating duplicates.",
      "The source name is shown beside this message if you need to report an outage.",
    ],
    noticeKind: "unavailable",
    actionLabel: "Try again",
    sourceLabel: "Source",
  },
  denied: {
    title: "You don’t have access here",
    body: "Your current session isn’t permitted to view this part of the workspace. Access is managed by your sending organization.",
    recoverySteps: [
      "Continue using the parts of the workspace available to your account.",
      "If you belong to multiple ministries, check the ministry switcher in the top header.",
      "Contact your sending organization if you expect to have access here.",
    ],
    noticeKind: "denied",
    actionLabel: "Open Help",
  },
  expired: {
    title: "Your session has expired",
    body: "Your session has ended, so your workspace is paused until you open a fresh session.",
    recoverySteps: ["Re-open the workspace from your organization’s sign-in entry point.", "Everything you saved before your session ended is still safely stored.", "See Help for more details on session states."],
    noticeKind: "denied",
    actionLabel: "Return to workspace",
  },
  "no-access": { title: NO_ACCESS_RECOVERY.title, body: NO_ACCESS_RECOVERY.body, recoverySteps: NO_ACCESS_RECOVERY.steps, noticeKind: null },
};
