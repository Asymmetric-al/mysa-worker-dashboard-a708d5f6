export const CLOCK_COPY = {
  title: "Clock",
  body: "Sets an offset from the fixed seed date for testing deadlines, referral windows, coaching cutoffs, and repeating tasks. Time only moves when you change it here.",
  offsetLabel: "Offset from seed time",
  instantLabel: "Current session time",
  advanceLabel: "Advance clock",
  presetsLabel: "Quick time jumps",
  presetPendingNote: "Updating the development clock…",
} as const;
export const PERSONA_SWITCH_COPY = {
  label: "Preview persona",
  selectLabel: "Act as seeded user",
  explanation: "Preview the workspace as a different seeded user — missionary, coach, reviewer, or reader.",
  grantsNothingNote: "Switching personas doesn’t bypass permissions: every page re-checks access and shows an access-denied message where appropriate.",
  selectionNote: "Stored in this browser’s session cookie only. Doesn’t modify saved records.",
  pendingNote: "Switching preview persona…",
  unlistedIdentityNote: "This session’s user ID isn’t in the seeded persona list.",
  sessionStateLabel: "Session state",
} as const;
/** Notices shown when the development runtime state itself cannot be loaded. */ export const DEV_READ_COPY = {
  loadingTitle: "Loading development tools",
  deniedTitle: "Development controls aren’t available for this session",
  unavailableTitle: "Couldn’t load development tools",
  refusedTitle: "Couldn’t read development state",
  retryLabel: "Try again",
} as const;
export const RESET_COPY = {
  title: "Reset sample data",
  body: "Deletes local changes in this development workspace and restores the default sample dataset. Nothing outside this local app is affected.",
  confirmLabel: "Reset and re-seed",
  cancelLabel: "Cancel",
  irreversibleNote: "All local edits will be cleared and cannot be undone.",
  sameAsCommandNote: "Same as running bun run reset from the repository root.",
} as const;
export const CLOCK_PRESETS = [
  { label: "1 minute", seconds: 60 },
  { label: "1 hour", seconds: 3_600 },
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
] as const;
