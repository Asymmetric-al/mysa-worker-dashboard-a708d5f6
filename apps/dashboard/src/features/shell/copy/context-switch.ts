import type { ContextSwitchGuardCopy } from "@/components/context-switch-guard";
export type ContextSwitchCopy = { readonly title: string; readonly body: string; readonly saveLabel: string; readonly discardLabel: string; readonly stayLabel: string; readonly saveNote: string; readonly unsavedWorkNote: string; readonly conflictNote: string; readonly stayNote: string };
export const CONTEXT_SWITCH_COPY: ContextSwitchCopy = {
  title: "Switch context?",
  body: "You are choosing a different organization or ministry, and everything this workspace shows is read under that selection, so the work in progress here has to be resolved first. Nothing from this context is carried over to the one you choose.",
  saveLabel: "Save and switch",
  discardLabel: "Discard and switch",
  stayLabel: "Stay here",
  saveNote: "Saving is the owning surface's own save, which is the editor's autosave or the form's submit, and this workspace never saves on your behalf. The switch waits for that save to settle before it happens.",
  unsavedWorkNote: "Unsaved work here is anything you have changed on this screen that has not been saved yet, and choosing to save it through the surface you are working in or to discard it is your decision rather than a default this workspace applies.",
  conflictNote: "The switch was not applied because the context changed while you were deciding. Your input is kept beside the current context so you can compare them and make the choice again.",
  stayNote: "Staying here is the default, and nothing is discarded unless you choose to discard it.",
} satisfies ContextSwitchGuardCopy;
export const LATE_RESULT_DISCARDED: string = "A result that arrived after the context changed was discarded, because it described the context you had left.";
export const CONTEXT_CHANGED = { title: "Context changed", body: "Everything in this workspace is now read under the organization and ministry shown here.", organizationLabel: "Organization", ministryLabel: "Ministry", unlabelledScope: "Name not supplied" } as const;
export const CHOOSER_COPY = {
  title: "Choose an organization and ministry",
  body: "Choose the organization and ministry this workspace should read under. Every option is a membership your session has been admitted to.",
  oneMinistryNote: "When your session admits a single ministry, that ministry opens directly and this chooser is not shown.",
} as const;
