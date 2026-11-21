/**
 * The contact-import family's only wording: the five steps of the journey, the four limits a file is held to before anything is read, the vocabulary of the four row decisions and the five row results, the facts the acceptance summary states, the framing of a refused file, the words the choose-file and selectively-accept step bodies add around those, and the words the validate-and-review and results bodies and the journey's own frame add around the material the read derived.
 */
import type { SimulatedEffect } from "@/components/simulation-label";
import type { ImportRowWindow } from "@/modules/data-service/reads/import";
import type { ImportDecisionKind } from "@/modules/import/decide";
import type { ImportLimitDescriptor, ImportLimitId } from "@/modules/import/parse";
import { IMPORT_LIMIT_DESCRIPTORS } from "@/modules/import/parse";
import type { ImportRowResultState } from "@/modules/import/receipt";
import type { ImportRowVerdict } from "@/modules/import/validate";
/**
 * The query parameter the journey's address uses to name one import operation: the page reads it on load, so a
 * reload restores the operation it names rather than starting again, and the surface writes it once it knows the
 * identity it is showing. It is stated in this module, which the server page and the client surface both import,
 * because a Server Component cannot read a value out of a client module.
 */
export const IMPORT_OPERATION_PARAM = "operation";
export type ImportStepId = "choose-file" | "map" | "review" | "accept" | "results";
export type ImportStep = { readonly id: ImportStepId; readonly title: string; readonly description: string; readonly reopenLabel: string };
const STEP_ORDER = ["choose-file", "map", "review", "accept", "results"] as const satisfies readonly ImportStepId[];
type StepCopy = Omit<ImportStep, "id">;
const STEP_COPY: Record<ImportStepId, StepCopy> = {
  "choose-file": { title: "Choose file", description: "Choose one UTF-8 CSV file of contacts, and read the limits it will be measured against before it is read. Nothing is imported until you have reviewed every row.", reopenLabel: "Back to Choose file — your chosen file is kept until you replace it" },
  map: { title: "Map", description: "Name the field each column supplies. Two columns with the same heading stay two separate columns, so each can supply a different field.", reopenLabel: "Back to Map — your column choices are kept" },
  review: { title: "Validate and review", description: "Read what each row would become, correct a cell where you can, and decide about each row on its own.", reopenLabel: "Back to Validate and review — your corrections and decisions are kept" },
  accept: { title: "Selectively accept", description: "Read what acceptance will create, then accept the rows you decided to keep. A row you left undecided is not accepted.", reopenLabel: "Back to Selectively accept — your file, mapping and decisions are kept" },
  results: { title: "Results", description: "See what each row became, open a contact this import created or added to, or return to a row that still needs a decision.", reopenLabel: "Back to Results — the receipt for this import is kept" },
};
export const STEPS: readonly ImportStep[] = STEP_ORDER.map((id) => ({ id, ...STEP_COPY[id] }));
export const stepIndex = (id: ImportStepId): number => STEP_ORDER.indexOf(id);
export const stepTitle = (id: ImportStepId): string => STEP_COPY[id].title;
export const stepLabel = (id: ImportStepId): string => `Step ${stepIndex(id) + 1} of ${STEPS.length}`;
/** What an `aria-live="polite"` region announces when the journey moves to a step: the position and the name together, so a screen-reader user hears where they are without having to find it. */
export const stepAnnouncement = (id: ImportStepId): string => `${stepLabel(id)}: ${stepTitle(id)}`;
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
  "file-bytes": (value) => ({ value: formatByteSize(value), message: `At most ${formatByteSize(value)}. A larger file is refused before it is read, so nothing is imported from it.` }),
  "data-rows": (value) => ({ value: `${formatCount(value)} nonblank data rows`, message: `At most ${formatCount(value)} nonblank data rows; a blank row is not counted. A file with more is refused before anything is imported.` }),
  columns: (value) => ({ value: `${formatCount(value)} columns`, message: `At most ${formatCount(value)} columns. A header row with more is refused before anything is imported from the file.` }),
  "cell-code-points": (value) => ({ value: `${formatCount(value)} characters per cell`, message: `At most ${formatCount(value)} characters in one cell. A longer cell refuses its own row only, so the rest of the file can still be imported.` }),
});
const limitWording = (descriptor: ImportLimitDescriptor): { value: string; message: string } => LIMIT_WORDING[descriptor.id](descriptor.value);
export const LIMIT_ROWS: readonly LimitRow[] = IMPORT_LIMIT_DESCRIPTORS.map((descriptor) => {
  const wording = limitWording(descriptor);
  return { key: LIMIT_ROW_KEY_BY_ID[descriptor.id], label: descriptor.label, value: wording.value, message: wording.message };
});
export type DecisionCopyEntry = { readonly label: string; readonly description: string; readonly consequence: string };
export const DECISION_COPY: Record<ImportDecisionKind, DecisionCopyEntry> = {
  create: {
    label: "Create a new private entry",
    description: "Start a private preparation entry of your own from this row's cells, with no shared record involved.",
    consequence: "The entry is private to you: none of this row's text is copied into a shared record, into shared activity, or into any other partner's audience.",
  },
  reuse: {
    label: "Reuse an authorized identity",
    description: "Attach a private preparation entry to a contact this import proposed for the row and you are authorised to see, naming that contact only by the reference the source issued.",
    consequence: "This does not merge the two records: the contact keeps every field, contact method, tag and audience exactly as it stands, and the changes this row proposes are shown beside the current values for you to compare.",
  },
  skip: { label: "Skip this row", description: "Leave this row out of the import and record nothing for it.", consequence: "Nothing is created for the row and the file is unchanged; a reason you add is kept beside the row, next to the row's own problem." },
  unresolved: { label: "Leave undecided", description: "Record no decision about the row and leave it waiting.", consequence: "The row is neither accepted nor skipped, and it holds no other row back: acceptance covers only the rows you have decided." },
};
export type RowResultBadgeVariant = "default" | "secondary" | "outline" | "destructive";
export type RowResultCopyEntry = { readonly label: string; readonly description: string; readonly badgeVariant: RowResultBadgeVariant };
export const ROW_RESULT_COPY: Record<ImportRowResultState, RowResultCopyEntry> = {
  accepted: { label: "Accepted", description: "This import created the row's private entry, or attached it to a contact you already hold.", badgeVariant: "default" },
  "already-accepted": { label: "Accepted earlier", description: "An earlier attempt of this same import created the row's record, so nothing was created twice and this is the original result rather than a second import.", badgeVariant: "secondary" },
  skipped: { label: "Skipped", description: "The row was left out, either by your own decision or because the import was cancelled before this row was reached.", badgeVariant: "outline" },
  "needs-review": { label: "Needs review", description: "Nothing was applied to this row and nothing failed. The row states why acceptance left it alone, and it can still be decided, corrected or accepted again.", badgeVariant: "outline" },
  failed: {
    label: "Failed",
    description: "The row carries no applied result. Its record names the reason the service gave; where the store could not be reached the row's fate is unknown, and checking the same operation again returns the original result instead of applying the row twice.",
    badgeVariant: "destructive",
  },
};
export const IMPORT_SIMULATION_EFFECT = "importer-safety" as const satisfies SimulatedEffect;
export type AcceptanceNoticeId = "no-audience-membership" | "no-consent" | "no-subscription" | "consent-column-uninterpreted" | "restrictions-preserved" | "suggestions-are-proposals" | "summary-rows-only";
export type AcceptanceNoticeItem = { readonly id: AcceptanceNoticeId; readonly label: string; readonly statement: string };
export const ACCEPTANCE_NOTICE: readonly AcceptanceNoticeItem[] = [
  { id: "no-audience-membership", label: "No audience membership is created", statement: "Acceptance adds private contact entries and nothing else: no Update audience member, publisher or purpose is created or changed." },
  { id: "no-consent", label: "No consent is recorded", statement: "None of these rows records consent to be contacted, to receive Updates or to anything else, whatever the file says about it." },
  { id: "no-subscription", label: "No one is subscribed", statement: "Accepting a row never subscribes a person and never turns a notice on for them; those choices stay with the reader who makes them." },
  { id: "consent-column-uninterpreted", label: "A consent-looking column stays as data", statement: "A column that looks like a subscribed flag is kept as written and is never read as consent, whoever supplied the file." },
  { id: "restrictions-preserved", label: "Negative restrictions are kept as written", statement: "A row that asks not to be contacted keeps that restriction exactly as the file states it; acceptance never removes it or narrows it." },
  {
    id: "suggestions-are-proposals",
    label: "A suggested contact is a proposal, not a merge",
    statement: "A contact proposed for a row is a suggestion. Reusing it attaches a private entry to that contact's own reference, and no field, contact method, tag or audience of that contact is rewritten or combined with this row.",
  },
  { id: "summary-rows-only", label: "Only the rows in this summary", statement: "Acceptance reaches the rows this summary lists. A row you left undecided or skipped is not accepted, and a changed file has to be reviewed again." },
];
export const REFUSAL_FRAMING = { title: "This file was not processed", lead: "Nothing was imported and no record changed. The reason is shown as this application reported it." } as const;
export const TABLE_LABELS = { mapping: "Imported columns and field mapping", review: "Rows awaiting a decision", results: "Per-row import results" } as const;
/** Step two's own wording: one record so the label set lives beside the family's other copy. */
export const MAPPING_COPY = {
  suggestedField: "No field suggested",
  noHeading: "This column has no heading",
  notMapped: "Not mapped",
  noColumns: "This file's heading row has no columns to map.",
  fieldLabel: "Field for column",
  suggestionOption: "Use the suggested field",
  ignoreOption: "Do not import this column",
  lead: "Every field below is a suggestion read from the column headings. Change any of them, then confirm the mapping: confirming records which column supplies which field, and imports nothing by itself.",
  confirmBlocked: "Resolve the choices marked on the rows above, then confirm the mapping.",
  confirmNeedsField: "Map at least one field to a column before confirming: a mapping that pairs no field with a column would import nothing.",
  confirmNote: "Confirming records the column mapping only. No contact is created, no consent is recorded and nobody is subscribed.",
  confirmLabel: "Confirm mapping",
  reconfirmLabel: "Confirm the updated mapping",
  confirmingLabel: "Confirming the mapping…",
  refusalTitle: "This mapping cannot be confirmed yet",
  refusalLead: "Each row marked below states what this mapping needs before the import can use it.",
  unmappedTitle: "No column is mapped to",
  declinedTitle: "Left out by your choices",
  errorsTitle: "The mapping was not accepted",
  errorsLead: "The service returned these messages. Nothing was imported.",
  summaryLabels: { confirmedMapping: "Column mapping" } as Readonly<Record<string, string | undefined>>,
} as const;
export const CHOOSE_FILE_COPY = {
  fileLabel: "CSV file",
  fileHint: "Choose one UTF-8 CSV file from this device. This step reads its bytes in your browser and hands them to the importer, which parses them and measures them against the four limits below; nothing is imported until you have reviewed every row.",
  limitsHeading: "Limits this file is measured against",
  limitsLead: "These are the importer's own limits, shown before you choose a file so a file that could not be accepted is not chosen in the first place.",
  chosenFileHeading: "The file you chose",
  fileNameLabel: "Name",
  fileSizeLabel: "Size",
  noFileChosen: "No file chosen yet. Nothing has been read, parsed or imported, and a file you choose is kept until you replace it.",
  continueLabel: "Continue to Map",
  continueBlocked: "Choose a file to continue to the next step.",
  readingLabel: "Reading the chosen file in this browser…",
  readFailed: "This browser could not read that file, so no file was chosen. Choose it again, or choose another copy of it.",
} as const;
export const chosenFileSize = (byteLength: number): string => formatByteSize(byteLength);
export const ACCEPTANCE_REVIEW_COPY = {
  noticeHeading: "What acceptance does, and what it never does",
  noticeLead: "Read these before you confirm. Each line names something an import is often assumed to do that this one does not, so none of them is discovered after the fact.",
  title: "Accept the rows you decided",
  description: "Accepting applies the decisions you reviewed. A row you decided to create becomes a new private preparation entry of your own; a row you decided to reuse attaches a private entry to the contact you named, and that contact is left exactly as it stands.",
  confirmLabel: "Accept the reviewed rows",
  selectionNoun: "rows",
} as const;
// What step three's body says
/**
 * The words the validate-and-review step states beside the material the read derived: the lead it is read
 * under, the heading of each column of its one per-row table, the statements an empty cell needs, the
 * labels its per-row controls carry, the window it is showing, and the framing of a decision the service
 * refused.
 *
 * A row's problems, mapped cells, kept cells, restrictions, suggestions and reasons are the domain's own
 * sentences, and every one of them is rendered exactly as it arrived rather than restated here.
 */
export const REVIEW_COPY = {
  lead: "Every row below is what the importer would make of this file: the values it would supply, the problems it states, the cells it keeps as data, the restrictions it carries and the contacts it proposes for reuse. Decide about each row on its own and record that decision; a recorded decision applies nothing by itself, and nothing reaches a contact until you accept the rows you decided.",
  column: {
    row: "Row",
    verdict: "Verdict",
    recordedDecision: "Decision recorded",
    suppliedValues: "Values this row would supply",
    problems: "Problems this row states",
    keptCells: "Kept as data, never read as consent",
    restrictions: "Restrictions this row carries",
    suggestions: "Contacts this row could reuse",
    decision: "Decision about this row",
  },
  empty: { problems: "No problem with this row's own values.", suppliedValues: "No column supplies a value for this row.", keptCells: "No cell of this row is kept for correction.", restrictions: "This row carries no restriction.", suggestions: "No existing contact was proposed for this row." },
  noDecisionRecorded: "No decision recorded",
  keptAsData: "Kept as data",
  comparison: { existing: "Existing value", incoming: "This row's value", differs: "The two values differ.", matches: "The two values match.", notCompared: "Not compared: the existing value cannot be read in this context." },
  signalsHeading: "Matched on",
  candidateHeading: "Contact this row would reuse",
  correctionsHeading: "Correct this row's values",
  correctionsNote: "A corrected value travels with the decision about this row; the file itself is unchanged.",
  skipReasonNote: "Optional. A reason you give is kept beside the row's own problem.",
  decisionNote: "Recording a decision applies nothing on its own.",
  windowLead: "This is the window of rows the read returned; every control below acts on the rows shown.",
  continueLabel: "Continue to Selectively accept",
  continueBlocked: "Record a decision about at least one row to continue: acceptance covers only the rows you have decided.",
  refusal: {
    invalidTitle: "The decision was not recorded",
    invalidLead: "The service returned these messages and changed nothing. Correct the row and record the decision again.",
    deniedTitle: "The decision was not recorded",
    deniedLead: "This request is not permitted in the current scope and session, so nothing was recorded. The reason is shown as this application reported it.",
    conflictTitle: "The row changed before this decision arrived",
    conflictLead: "The review you decided about is no longer the review this context holds, so nothing was recorded. Read the rows as they stand now, then decide again.",
    unavailableTitle: "The decision could not be recorded",
    unavailableLead: "The local store could not be reached, so this decision was not recorded and the row is unchanged. Record it again once the store answers.",
    unknownTitle: "The decision may or may not have been recorded",
    unknownLead: "Its acknowledgement was lost, so this row is not presented as decided: record the same decision again to replay the same attempt rather than start a second one.",
  },
  material: { heading: "The per-row review material could not be derived", lead: "This is the read's own statement of what it could not derive. No row is shown as an empty or a ready row in its place." },
} as const;
/** A row's verdict as words, keyed by the domain's own closed union so a verdict added or renamed there fails to compile here instead of rendering unexplained. */
export const REVIEW_VERDICT_WORDS: Record<ImportRowVerdict, string> = { ready: "Ready", "needs-correction": "Needs correction" };
/** The accessible name of one row's decision control: the row number is part of the name, so the control is never one of many unnamed selects. */
export function reviewDecisionLabel(rowNumber: number): string {
  return `Decision about row ${rowNumber}`;
}
/** The label of the control that records one row's decision. */
export function reviewDecisionSubmitLabel(rowNumber: number): string {
  return `Record the decision about row ${rowNumber}`;
}
/** What that control says while its decision is being recorded. */
export function reviewDecisionPendingLabel(rowNumber: number): string {
  return `Recording the decision about row ${rowNumber}…`;
}
/** The label of the control that names which proposed contact a reused row attaches to. */
export function reviewCandidateLabel(rowNumber: number): string {
  return `Contact row ${rowNumber} would reuse`;
}
/** The label of one correction, naming the row and the heading of the column it corrects. */
export function reviewCorrectionLabel(rowNumber: number, header: string): string {
  return header.trim() === "" ? `Row ${rowNumber}: corrected value for the blank heading` : `Row ${rowNumber}: corrected value for "${header}"`;
}
/** The label of the optional reason a skipped row carries. */
export function reviewSkipReasonLabel(rowNumber: number): string {
  return `Why row ${rowNumber} is skipped (optional)`;
}
/** The sentence beside the one per-row table, stating which window of the file it holds. */
export function reviewWindowSentence(window: ImportRowWindow): string {
  if (window.total === 0) {
    return "This file holds no data row to review.";
  }
  const first = (window.page - 1) * window.pageSize + 1;
  const last = Math.min(window.page * window.pageSize, window.total);
  return `Showing rows ${first}\u2013${last} of ${window.total} in this file.`;
}
// What step five's body says
/** The words the results step states around the per-row outcomes the read reported: the lead it is read under, the facts about the file, the labels of the counts acceptance decided, and the headings and columns of its one per-row table. */
export const RESULTS_COPY = {
  lead: "This is the result of one import operation, read back by its own identity. Each row below states what became of it and why; a row that became a contact can be opened from here, and a row that was not applied says so instead of offering a control.",
  fileHeading: "The file this import read",
  fileLabels: { name: "Name", size: "Size", rows: "Data rows", columns: "Columns" },
  summaryHeading: "What acceptance decided about the rows",
  summaryLabels: { create: "Created as a new private entry", reuse: "Attached to a contact you reuse", skip: "Skipped", unresolved: "Left undecided", rowCount: "Data rows in the file" },
  stateCountsHeading: "What became of the rows",
  column: { row: "Row", decision: "Decision", state: "Result", reason: "What happened", route: "Where this row leads" },
  noState: "No result recorded",
  noReason: "This row states no reason of its own.",
  noRoute: "This row leads nowhere further.",
  pendingLead: "Reading this import by its operation identity\u2026",
} as const;
/** One heading per row result state, keyed by the domain's own closed union, so the counts and the rows name each state the same way. */
export const RESULT_STATE_HEADINGS: Record<ImportRowResultState, string> = { accepted: "Rows accepted", "already-accepted": "Rows accepted by an earlier attempt", skipped: "Rows skipped", "needs-review": "Rows still needing review", failed: "Rows that failed" };
/** The link label for a row that became or extended a contact, naming the row it came from. */
export function resultPartnerLinkLabel(rowNumber: number): string {
  return `Open the contact that row ${rowNumber} became`;
}
/** The statement beside a row that was not applied, naming the row and leaving the reason to the row's own reason. */
export function resultCorrectionStatement(rowNumber: number): string {
  return `Row ${rowNumber} was not applied. Its own reason above states why, and the decisions of a processed import cannot be changed here.`;
}
/** The sentence above the stop control, stating how many rows nothing has been applied to yet. */
export function resultStoppableRowSentence(count: number): string {
  return count === 1 ? "One row of this import was left alone and can still be stopped." : `${count} rows of this import were left alone and can still be stopped.`;
}
/** The sentence beside the results table, stating which window of the operation's rows it holds. */
export function resultWindowSentence(window: ImportRowWindow): string {
  if (window.total === 0) {
    return "This import reports no data row.";
  }
  const first = (window.page - 1) * window.pageSize + 1;
  const last = Math.min(window.page * window.pageSize, window.total);
  return `Showing rows ${first}\u2013${last} of ${window.total} in this import.`;
}
// The journey's own frame
/** The words the journey frame states around the five steps: the page's heading and lead, the control that starts another import, the stop-this-import review, and what a reload of this page can and cannot resume. */
export const JOURNEY_COPY = {
  heading: "Import contacts",
  lead: "Bring one UTF-8 CSV file of contacts in: choose the file, confirm what each column supplies, decide about every row, and accept only the rows you decided. Each accepted row becomes a private preparation entry of your own; nothing is merged with an existing contact, nobody is subscribed and no audience membership is created.",
  reading: "Reading the import from the local data service\u2026",
  startAnotherLabel: "Start another import",
  startAnotherStatement: "Starting another import clears this review from the page. The rows this import already applied stay exactly as they are, and its result is read back by its own operation identity.",
  stop: {
    title: "Stop this import",
    description: "Stopping applies nothing further: a row this import already applied keeps the record it became, and every row it has not applied is stopped. It withdraws no contact this import created and recalls no message, because an import sends none.",
    confirmLabel: "Stop the rows not yet applied",
  },
  reload: {
    completedHeading: "This import has already finished",
    completedStatement: "The operation named in this page's address has completed, so what follows is its own result rather than a new review.",
    inFlightHeading: "This import is still in review in this context",
    inFlightStatement:
      "An import started earlier in this context has been neither accepted nor stopped, and this browser does not keep the chosen file across a reload, so its review cannot be resumed here. Choose the file again to continue: the earlier review recorded nothing about a contact, and nothing reaches one until you accept.",
    inFlightAction: "Start again from Choose file",
  },
  readRefused: { title: "The import record was not read", lead: "The request this page sent for the import record was refused, so nothing is shown as an empty review or an empty result and no count is shown as zero. The reason is shown as this application reported it." },
  retryReadLabel: "Read the import again",
  unreadableGuidance: "The import read answered with a body this page does not recognise, so nothing is shown as an empty review or an empty result. Nothing was changed, and the same operation can be read again.",
  proposeRefused: {
    deniedTitle: "The file was not proposed in this context",
    deniedLead: "This request is not permitted in the current scope and session, so the file was not read and nothing was imported. The reason is shown as this application reported it.",
    unavailableTitle: "The file could not be proposed",
    unavailableLead: "The local store could not be reached, so the file was not read and nothing was imported. The same file can be proposed again once the store answers.",
    conflictTitle: "The import changed before this request arrived",
    conflictLead: "Nothing was changed. Read the import again, then continue from the rows as they now stand.",
    unknownTitle: "The proposal may or may not have been read",
    unknownLead: "Its acknowledgement was lost. Choosing the same file again replays the same attempt rather than starting a second one.",
  },
  acceptRefused: { title: "This import was not accepted", lead: "The service returned these messages and applied nothing." },
  unknownAccept: { title: "The acceptance's acknowledgement was lost", statement: "The rows may have been applied and this page cannot tell which. Checking the same operation reads back what happened and applies nothing; no second acceptance starts from here." },
  checkAcceptanceLabel: "Check whether this import was accepted",
  acceptCheck: { inFlightTitle: "This import has not been accepted yet", inFlightStatement: "Reading the same operation shows the import still in review, so the acceptance that lost its acknowledgement applied nothing. Retrying the same work replays that attempt rather than starting a second one." },
} as const;
