export const CLOCK_COPY = {
  title: "Clock",
  body: "The clock is an offset from one fixed seed instant, and only the controls here move it. Nothing advances it in the background, so a boundary becomes true when a read or a command is evaluated against the instant shown beside it.",
  offsetLabel: "Offset from the seed instant",
  instantLabel: "Instant this session reads at",
  advanceLabel: "Advance the clock",
  presetsLabel: "Preset amounts to advance by",
  presetPendingNote: "Applying that preset to this development session and waiting for the answer.",
} as const;
export const PERSONA_SWITCH_COPY = {
  label: "Preview persona",
  selectLabel: "Seeded identity this browser acts as",
  explanation: "This development control selects the seeded session this browser acts as, so a preview shows what that identity is given.",
  grantsNothingNote: "It grants nothing: every read that follows is authorised again, so a persona that may not read a surface receives the honest denial notice instead of a hidden destination.",
  selectionNote: "Choosing one of these selects the seeded session this browser acts as. The choice travels in this browser's own session cookie, it changes nothing the store holds, and it is not a sign-in: the identity a read is authorised for is decided again on every request.",
  pendingNote: "Switching this browser's session and waiting for the answer.",
  unlistedIdentityNote: "The principal this session acts as is not one the roster lists, so it is reported as an identity the roster does not describe rather than given a guessed label.",
  sessionStateLabel: "Session state",
} as const;
/** The sentences the composition states instead of a panel when this session's development runtime could not be read at all. */ export const DEV_READ_COPY = {
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
