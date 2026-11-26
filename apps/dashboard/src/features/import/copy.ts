import type { SimulatedEffect } from "@/components/simulation-label";
import type { ImportRowWindow } from "@/modules/data-service/reads/import";
import type { ImportDecisionKind } from "@/modules/import/decide";
import type { ImportLimitId } from "@/modules/import/parse";
import { IMPORT_LIMIT_DESCRIPTORS } from "@/modules/import/parse";
import type { ImportRowResultState } from "@/modules/import/receipt";
import type { ImportDuplicateLooking, ImportRowVerdict } from "@/modules/import/validate";
/** The query parameter the journey's address uses to name one import operation: */ export const IMPORT_OPERATION_PARAM = "operation";
export type ImportStepId = "choose-file" | "map" | "review" | "accept" | "results";
export type ImportStep = { readonly id: ImportStepId; readonly title: string; readonly description: string; readonly reopenLabel: string };
const STEP_ORDER = ["choose-file", "map", "review", "accept", "results"] as const satisfies readonly ImportStepId[];
const STEP_COPY: Record<ImportStepId, Omit<ImportStep, "id">> = {
  "choose-file": { title: "Choose file", description: "Select a UTF-8 CSV file of contacts. Nothing is imported until you review and confirm your rows.", reopenLabel: "Back to Choose file (your chosen file is kept until replaced)" },
  map: { title: "Match columns", description: "Match each CSV column to the right contact field. Duplicate headers stay separate so you can map each one individually.", reopenLabel: "Back to Match columns (your column choices are kept)" },
  review: { title: "Review rows", description: "Check each row, fix any invalid cells, and choose what to do with every contact.", reopenLabel: "Back to Review rows (your edits and choices are kept)" },
  accept: { title: "Confirm import", description: "Review the summary and confirm which rows to import. Undecided or skipped rows aren’t imported.", reopenLabel: "Back to Confirm import (your file, mapping, and choices are kept)" },
  results: { title: "Results", description: "See what happened to every row and open any private contact created by this import.", reopenLabel: "Back to Results (your import receipt is kept)" },
};
export const STEPS: readonly ImportStep[] = STEP_ORDER.map((id) => ({ id, ...STEP_COPY[id] }));
export const stepIndex = (id: ImportStepId): number => STEP_ORDER.indexOf(id);
export const stepTitle = (id: ImportStepId): string => STEP_COPY[id].title;
export const stepLabel = (id: ImportStepId): string => `Step ${stepIndex(id) + 1} of ${STEPS.length}`;
/** What an `aria-live="polite"` region announces when the journey moves to a step: the position and the name together, so a screen-reader user hears where they are without having to find it. */ export const stepAnnouncement = (id: ImportStepId): string => `${stepLabel(id)}: ${stepTitle(id)}`;
export type LimitRowKey = "size" | "rows" | "columns" | "cell";
export type LimitRow = { readonly key: LimitRowKey; readonly label: string; readonly value: string; readonly message: string };
const LIMIT_ROW_KEY_BY_ID = { "file-bytes": "size", "data-rows": "rows", columns: "columns", "cell-code-points": "cell" } as const satisfies Readonly<Record<ImportLimitId, LimitRowKey>>;
const BYTE_UNITS = ["B", "KiB", "MiB", "GiB"] as const;
function formatByteSize(bytes: number): string {
  let scaled = bytes;
  let unitIndex = 0;
  while (unitIndex < BYTE_UNITS.length - 1 && scaled >= 1024 && scaled % 1024 === 0) [scaled, unitIndex] = [scaled / 1024, unitIndex + 1];
  return `${formatCount(scaled)} ${BYTE_UNITS[unitIndex] ?? BYTE_UNITS[0]}`;
}
const formatCount = (value: number): string =>
  Math.trunc(value)
    .toString()
    .replace(/\B(?=(?:\d{3})+$)/g, ",");
const LIMIT_WORDING: Readonly<Record<ImportLimitId, (value: number) => { value: string; message: string }>> = Object.freeze({
  "file-bytes": (value) => ({ value: formatByteSize(value), message: `Up to ${formatByteSize(value)}. Larger files are rejected before reading.` }),
  "data-rows": (value) => ({ value: `${formatCount(value)} rows`, message: `Up to ${formatCount(value)} non-blank data rows per file.` }),
  columns: (value) => ({ value: `${formatCount(value)} columns`, message: `Up to ${formatCount(value)} columns per file.` }),
  "cell-code-points": (value) => ({ value: `${formatCount(value)} characters per cell`, message: `Up to ${formatCount(value)} characters in any single cell (longer cells flag only that row).` }),
});
export const LIMIT_ROWS: readonly LimitRow[] = IMPORT_LIMIT_DESCRIPTORS.map((descriptor) => {
  const wording = LIMIT_WORDING[descriptor.id](descriptor.value);
  return { key: LIMIT_ROW_KEY_BY_ID[descriptor.id], label: descriptor.label, value: wording.value, message: wording.message };
});
export type DecisionCopyEntry = { readonly label: string; readonly description: string; readonly consequence: string };
export const DECISION_COPY: Record<ImportDecisionKind, DecisionCopyEntry> = {
  create: {
    label: "Create private contact",
    description: "Create a new private contact visible only to you.",
    consequence: "Stays private to you — never copied into shared partner records, team activity, or email audiences.",
  },
  reuse: {
    label: "Link to existing partner",
    description: "Attach a private contact entry to a matching partner you already have access to.",
    consequence: "Never merges or overwrites the existing partner’s details, tags, or permissions — differences are shown side by side.",
  },
  skip: { label: "Skip row", description: "Leave this row out of the import.", consequence: "Nothing is created and your file isn’t changed. Any skip note is saved alongside the row." },
  unresolved: { label: "Decide later", description: "Leave this row undecided for now.", consequence: "Not imported yet, and won’t block the other rows you’ve decided." },
};
export type RowResultBadgeVariant = "default" | "secondary" | "outline" | "destructive";
export type RowResultCopyEntry = { readonly label: string; readonly description: string; readonly badgeVariant: RowResultBadgeVariant };
export const ROW_RESULT_COPY: Record<ImportRowResultState, RowResultCopyEntry> = {
  accepted: { label: "Imported", description: "Created as a private contact or linked to the chosen partner.", badgeVariant: "default" },
  "already-accepted": { label: "Already imported", description: "Imported by an earlier attempt — skipped duplicate creation.", badgeVariant: "secondary" },
  skipped: { label: "Skipped", description: "Left out by your decision or because the import was stopped before this row.", badgeVariant: "outline" },
  "needs-review": { label: "Needs review", description: "Not imported yet — review the reason shown to fix or decide on this row.", badgeVariant: "outline" },
  failed: {
    label: "Failed",
    description: "Couldn’t import this row. See the reason shown; checking the import ID again won’t duplicate applied rows.",
    badgeVariant: "destructive",
  },
};
export const IMPORT_SIMULATION_EFFECT = "importer-safety" as const satisfies SimulatedEffect;
export type AcceptanceNoticeId = "no-audience-membership" | "no-consent" | "no-subscription" | "consent-column-uninterpreted" | "restrictions-preserved" | "suggestions-are-proposals" | "summary-rows-only";
export type AcceptanceNoticeItem = { readonly id: AcceptanceNoticeId; readonly label: string; readonly statement: string };
export const ACCEPTANCE_NOTICE: readonly AcceptanceNoticeItem[] = [
  { id: "no-audience-membership", label: "No email audience changes", statement: "Importing creates private contacts only — nobody is added to your email audience." },
  { id: "no-consent", label: "No consent recorded", statement: "Importing never records email or communication consent, regardless of what the CSV says." },
  { id: "no-subscription", label: "Nobody is subscribed", statement: "No one is subscribed to updates or notifications; readers always choose that themselves." },
  { id: "consent-column-uninterpreted", label: "Subscribed/consent columns stay raw data", statement: "Columns like “subscribed” or “opted in” are preserved as reference text only, never treated as consent." },
  { id: "restrictions-preserved", label: "Do-not-contact restrictions stay intact", statement: "Any restriction in the file is kept verbatim and never removed or weakened." },
  {
    id: "suggestions-are-proposals",
    label: "Matches are suggestions, not merges",
    statement: "Linking to an existing partner attaches your private entry by ID without editing or overwriting their shared profile.",
  },
  { id: "summary-rows-only", label: "Only your decided rows run", statement: "Only the rows summarized here are imported; undecided or skipped rows are untouched." },
];
export const REFUSAL_FRAMING = { title: "Couldn’t process this file", lead: "Nothing was imported and no records changed. See the reason below." } as const;
export const TABLE_LABELS = { mapping: "CSV columns and matched fields", review: "Rows to review", results: "Import results by row" } as const;
/** Step two's own wording: one record so the label set lives beside the family's other copy. */ export const MAPPING_COPY = {
  suggestedField: "No match suggested",
  noHeading: "Blank header",
  notMapped: "Not mapped",
  noColumns: "No columns found in the header row.",
  fieldLabel: "Field for column",
  suggestionOption: "Use suggested field",
  ignoreOption: "Skip this column",
  lead: "Review our suggested matches from your column headings, adjust any column, then confirm to move to row review. Confirming doesn’t import anything yet.",
  confirmBlocked: "Fix the highlighted column choices above before continuing.",
  confirmNeedsField: "Match at least one column to a field before continuing.",
  confirmNote: "Confirming only saves your column matches — no contacts are created and nobody is subscribed.",
  confirmLabel: "Continue to Review rows",
  reconfirmLabel: "Update column matches",
  confirmingLabel: "Saving column matches…",
  refusalTitle: "Fix column matches before continuing",
  refusalLead: "Check the highlighted columns below.",
  unmappedTitle: "Unmapped fields:",
  declinedTitle: "Skipped fields:",
  errorsTitle: "Couldn’t save column matches",
  errorsLead: "Please review the messages below. Nothing was imported.",
  summaryLabels: { confirmedMapping: "Column matches" } as Readonly<Record<string, string | undefined>>,
} as const;
export const CHOOSE_FILE_COPY = {
  fileLabel: "CSV file",
  fileHint: "Choose a UTF-8 CSV file from your device. It’s checked against the limits below before row review — nothing is imported until you confirm.",
  limitsHeading: "File limits",
  limitsLead: "Files are checked against these limits before processing:",
  exampleHeading: "Need a sample file?",
  exampleLead:
    "Download our example CSV with new contacts, rows that need fixing, and duplicate-looking names to test the full import flow safely.",
  exampleLinkLabel: "Download example contacts CSV",
  chosenFileHeading: "Selected file",
  fileNameLabel: "File",
  fileSizeLabel: "Size",
  noFileChosen: "No file selected yet.",
  continueLabel: "Continue to Match columns",
  continueBlocked: "Choose a CSV file to continue.",
  readingLabel: "Reading file…",
  readFailed: "Couldn’t read that file in your browser. Try choosing it again.",
  /** What the chooser states about a file it measured as larger than the limit: the refusal the importer's own limit wording supplies, then the fact that nothing happened to the file here. */
  sizeLimitRefused: (refusalMessage: string): string => `${refusalMessage} The file wasn’t read or uploaded.`,
} as const;
export const chosenFileSize = (byteLength: number): string => formatByteSize(byteLength);
export const ACCEPTANCE_REVIEW_COPY = {
  noticeHeading: "Before you import",
  noticeLead: "Here’s what importing does — and what it intentionally never does:",
  title: "Confirm contact import",
  description: "Creates private contacts for your chosen rows and links any matched rows without modifying existing shared partner profiles.",
  confirmLabel: "Import selected rows",
  selectionNoun: (count: number): string => (count === 1 ? "row" : "rows"),
} as const;
/** The words the validate-and-review step states beside the material the read derived: */ export const REVIEW_COPY = {
  lead: "Review each row’s values, issues, restrictions, and suggested matches, then save your choice for each row. Nothing is imported until you confirm on the next step.",
  column: {
    row: "Row",
    verdict: "Status",
    recordedDecision: "Saved choice",
    material: "Details",
    suppliedValues: "Mapped values",
    problems: "Issues",
    keptCells: "Kept as raw data (not consent)",
    restrictions: "Restrictions",
    suggestions: "Suggested partner matches",
    decision: "Action",
  },
  empty: { problems: "No issues found.", suppliedValues: "No mapped values in this row.", keptCells: "No consent-style columns in this row.", restrictions: "No restrictions in this row.", suggestions: "No existing partner match found." },
  noDecisionRecorded: "Not decided yet",
  keptAsData: "Kept as data",
  comparison: { existing: "Existing partner", incoming: "From CSV", differs: "Different", matches: "Matches", notCompared: "Existing value isn’t visible in this ministry." },
  signalsHeading: "Matched on",
  candidateHeading: "Existing partner to link",
  correctionsHeading: "Fix values for this row",
  correctionsNote: "Edits apply to this import only — your CSV file isn’t modified.",
  skipReasonNote: "Optional note explaining why you skipped this row.",
  decisionNote: "Saving a row choice doesn’t import anything until you confirm on the next step.",
  decisionsHeading: "What each option does",
  windowLead: "Showing rows in this import.",
  continueLabel: "Continue to Confirm import",
  continueBlocked: "Save a decision for at least one row to continue.",
  refusal: {
    invalidTitle: "Couldn’t save row decision",
    invalidLead: "Fix the issues below and save again.",
    deniedTitle: "Couldn’t save row decision",
    deniedLead: "You don’t have permission to update this import in the current ministry.",
    conflictLead: "This import was updated elsewhere before your change arrived. Review the latest row state and try again.",
    conflictRowTitle: (rowNumber: number): string => `Row ${rowNumber} changed elsewhere`,
    conflictCurrentRevision: "Current version",
    conflictPreserved: "Your choice",
    conflictHeld: "Saved choice",
    conflictRecovery: "Your choice is still filled in below — save again to apply it to the latest version.",
    unavailableTitle: "Couldn’t save row decision",
    unavailableLead: "The service didn’t respond, so this row wasn’t changed. Try saving again.",
    unknownTitle: "Couldn’t confirm row decision",
    unknownLead: "We didn’t get a confirmation back. Save the same choice again to verify without duplicating.",
  },
  material: { heading: "Couldn’t prepare row details", lead: "Row details couldn’t be built for this import." },
} as const;
/** A row's verdict as words, keyed by the domain's own closed union so a verdict added or renamed there fails to compile here instead of rendering unexplained. */ export const REVIEW_VERDICT_WORDS: Record<ImportRowVerdict, string> = { ready: "Ready", "needs-correction": "Needs fix" };
/** What a row of this file resembling another row of it says: the badge's word, the name its disclosure carries, and the sentence naming the other rows — none of which is a verdict, a merge or a decision. */ export const REVIEW_DUPLICATE_COPY = {
  word: "Possible duplicate",
  /** The name of the control that opens one row's review material, so the disclosure carries its row number and is never one of many unnamed controls. */ summaryLabel: (rowNumber: number): string => `Details for row ${rowNumber}`,
  /** The sentence naming the other rows of the file one row looks like, what was compared, and that nothing was merged or decided. */ sentence: (duplicate: ImportDuplicateLooking): string => {
    const others = duplicate.otherRowNumbers.map((rowNumber) => `row ${rowNumber}`);
    const named = others.length === 1 ? (others[0] ?? "") : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1] ?? ""}`;
    return `Row ${duplicate.rowNumber} shares the name “${duplicate.name}” with ${named} in this CSV, with no shared email, phone, or ID. Both rows stay separate so you can decide on each one.`;
  },
} as const;
export const reviewDecisionLabel = (rowNumber: number): string => `Action for row ${rowNumber}`;
export const reviewDecisionSubmitLabel = (rowNumber: number): string => `Save row ${rowNumber}`;
export const reviewDecisionPendingLabel = (rowNumber: number): string => `Saving row ${rowNumber}…`;
export const reviewCandidateLabel = (rowNumber: number): string => `Partner to link for row ${rowNumber}`;
export const reviewCorrectionLabel = (rowNumber: number, header: string): string => (header.trim() === "" ? `Row ${rowNumber}: fix blank column` : `Row ${rowNumber}: fix “${header}”`);
export const reviewSkipReasonLabel = (rowNumber: number): string => `Reason for skipping row ${rowNumber} (optional)`;
/** The sentence beside a per-row table, stating which window of the operation's rows it holds. */ const windowSentence = (window: ImportRowWindow, whenEmpty: string, noun: string): string => {
  if (window.total === 0) return whenEmpty;
  const first = (window.page - 1) * window.pageSize + 1;
  return `Showing rows ${first}\u2013${Math.min(window.page * window.pageSize, window.total)} of ${window.total} in this ${noun}.`;
};
export const reviewWindowSentence = (window: ImportRowWindow): string => windowSentence(window, "This file has no data rows to review.", "file");
export const resultWindowSentence = (window: ImportRowWindow): string => windowSentence(window, "No rows were reported for this import.", "import");
/** The receipt address of one import operation: this page's own address, naming the operation by the identity it was read back by, so the link, the address the step states and the address the copy control writes are one string. */
export const importReceiptHref = (operationId: string): string => `/partners/import?${IMPORT_OPERATION_PARAM}=${encodeURIComponent(operationId)}`;
/** The words the results step states around the per-row outcomes the read reported: the lead it is read under, the facts about the file, the labels of the counts acceptance decided, and the headings and columns of its one per-row table. */ export const RESULTS_COPY = {
  lead: "Here’s what happened to each row in this import. Open any created contact below, or review rows that weren’t applied.",
  operationHeading: "Import receipt",
  operationLabels: { identity: "Import ID", receiptAddress: "Receipt link" },
  receiptLinkLabel: "Open receipt",
  receiptNote: "Reopening this link shows the same receipt without re-importing anything.",
  copyReceiptLabel: "Copy receipt link",
  copyReceiptCopied: "Receipt link copied.",
  copyReceiptUnavailable: "Couldn’t copy automatically — select and copy the link above.",
  fileHeading: "File summary",
  fileLabels: { name: "File", size: "Size", rows: "Rows", columns: "Columns" },
  summaryHeading: "Your choices",
  summaryLabels: { create: "Create private contact", reuse: "Link to existing partner", skip: "Skipped", unresolved: "Undecided", rowCount: "Total rows" },
  stateCountsHeading: "Outcome breakdown",
  cancellationHeading: "Import stopped",
  cancellationLabels: { cancelledAt: "Stopped at", acceptedRowsRetained: "Already imported (kept)", stoppedRows: "Stopped before import" },
  cancellationStatement:
    "Stopping only cancelled rows that hadn’t been imported yet. Any contacts already created stay in your list. Time shown in UTC.",
  column: { row: "Row", decision: "Choice", state: "Outcome", reason: "Details", route: "Next step" },
  noState: "Not recorded",
  noReason: "—",
  noRoute: "—",
  pendingLead: "Loading import results…",
} as const;
/** One heading per row result state, keyed by the domain's own closed union, so the counts and the rows name each state the same way. */
export const RESULT_STATE_HEADINGS: Record<ImportRowResultState, string> = { accepted: "Imported", "already-accepted": "Already imported", skipped: "Skipped", "needs-review": "Needs review", failed: "Failed" };
export const resultPartnerLinkLabel = (rowNumber: number): string => `Open contact (row ${rowNumber})`;
export const resultCorrectionStatement = (rowNumber: number): string => `Row ${rowNumber} wasn’t imported. See the reason above — completed imports can’t be edited here.`;
export const resultStoppableRowSentence = (count: number): string => (count === 1 ? "1 row hasn’t been processed yet and can still be stopped." : `${count} rows haven’t been processed yet and can still be stopped.`);
/** The words the journey frame states around the five steps: the page's heading and lead, the control that starts another import, the stop-this-import review, and what a reload of this page can and cannot resume. */ export const JOURNEY_COPY = {
  heading: "Import contacts",
  lead: "Upload a CSV, match columns, and review every row before importing. Imported contacts stay private to you — nothing is merged or subscribed automatically.",
  reading: "Loading import…",
  startAnotherLabel: "Start another import",
  startAnotherStatement: "Clears this screen so you can upload another CSV. Any contacts already imported stay safely in your list.",
  stop: {
    title: "Stop this import",
    description: "Cancels any rows that haven’t been imported yet. Contacts already created stay in your list.",
    confirmLabel: "Stop remaining rows",
  },
  reload: {
    completedHeading: "This import is already complete",
    completedStatement: "Showing the saved receipt for this import ID.",
    inFlightHeading: "Previous import wasn’t finished",
    inFlightStatement:
      "Your browser doesn’t keep the CSV file after a page reload, so choose the file again to pick up where you left off. Nothing was imported yet.",
    inFlightAction: "Choose file again",
  },
  readRefused: { title: "Couldn’t load import", lead: "The import request wasn’t accepted. See the details below." },
  retryReadLabel: "Try again",
  unreadableGuidance: "Received an unexpected response from the import service. Nothing was changed — try loading again.",
  proposeRefused: {
    deniedTitle: "Can’t import contacts here",
    deniedLead: "You don’t have permission to import contacts in this ministry.",
    unavailableTitle: "Couldn’t upload file right now",
    unavailableLead: "The import service didn’t respond, so nothing was read. Try again in a moment.",
    conflictTitle: "Import updated elsewhere",
    conflictLead: "Reload this import to see the latest rows before continuing.",
    unknownTitle: "Couldn’t confirm upload",
    unknownLead: "We didn’t get a confirmation back. Choose the same file again to check without duplicating.",
  },
  acceptRefused: { title: "Couldn’t complete import", lead: "Please check the issues below. Nothing was applied." },
  unknownAccept: { title: "Couldn’t confirm import", statement: "Your rows may have already been imported. Check the import status instead of submitting again." },
  checkAcceptanceLabel: "Check import status",
  acceptCheck: { inFlightTitle: "Import hasn’t run yet", inFlightStatement: "This import is still waiting in review, so nothing was applied. You can safely confirm again." },
} as const;
