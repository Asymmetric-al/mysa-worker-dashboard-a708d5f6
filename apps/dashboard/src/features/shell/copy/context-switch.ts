import type { ContextSwitchGuardCopy } from "@/components/context-switch-guard";
export type ContextSwitchCopy = { readonly title: string; readonly body: string; readonly saveLabel: string; readonly discardLabel: string; readonly stayLabel: string; readonly saveNote: string; readonly unsavedWorkNote: string; readonly conflictNote: string; readonly stayNote: string };
export const CONTEXT_SWITCH_COPY: ContextSwitchCopy = {
  title: "Switch ministry?",
  body: "Switching to a different organization or ministry reloads the workspace for that ministry. Anything unsaved on this screen won’t carry over.",
  saveLabel: "Save and switch",
  discardLabel: "Discard and switch",
  stayLabel: "Stay here",
  saveNote: "Saves your current changes first, then switches once the save succeeds.",
  unsavedWorkNote: "Choose whether to save your changes before switching or discard them.",
  conflictNote: "Your ministry selection changed while you were deciding, so nothing was switched. Review your selection and try again.",
  stayNote: "Nothing is discarded unless you choose Discard and switch.",
} satisfies ContextSwitchGuardCopy;
export const LATE_RESULT_DISCARDED: string = "A delayed response from the ministry you just left was ignored.";
export const CHOOSER_COPY = {
  title: "Choose your ministry",
  body: "Select the organization and ministry you want to work in.",
  oneMinistryNote: "If your account belongs to only one ministry, it opens automatically.",
} as const;
