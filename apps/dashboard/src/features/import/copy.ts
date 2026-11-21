/**
 * The contact-import family's only wording: the five steps of the journey, the four limits a file is
 * held to before anything is read, the vocabulary of the four row decisions and the five row results,
 * the facts the acceptance summary states, the framing of a refused file, and the words the
 * choose-file and selectively-accept step bodies add around those.
 */
import type { SimulatedEffect } from "@/components/simulation-label";
import type { ImportDecisionKind } from "@/modules/import/decide";
import type { ImportLimitDescriptor, ImportLimitId } from "@/modules/import/parse";
import { IMPORT_LIMIT_DESCRIPTORS } from "@/modules/import/parse";
import type { ImportRowResultState } from "@/modules/import/receipt";
import { assertNever } from "@/lib/result";
// The five steps of the journey
/** The five steps, in the specification's own order and names. */
export type ImportStepId = "choose-file" | "map" | "review" | "accept" | "results";
/** One step: its name, what it is for, and the label of the control that opens it again once the worker has moved past it. */
export interface ImportStep {
  readonly id: ImportStepId;
  readonly title: string;
  readonly description: string;
  readonly reopenLabel: string;
}
const STEP_ORDER = ["choose-file", "map", "review", "accept", "results"] as const satisfies readonly ImportStepId[];

type StepCopy = Omit<ImportStep, "id">;

const STEP_COPY: Record<ImportStepId, StepCopy> = {
  "choose-file": {
    title: "Choose file",
    description: "Choose one UTF-8 CSV file of contacts, and read the limits it will be measured against before it is read. Nothing is imported until you have reviewed every row.",
    reopenLabel: "Back to Choose file — your chosen file is kept until you replace it",
  },
  map: {
    title: "Map",
    description: "Name the field each column supplies. Two columns with the same heading stay two separate columns, so each can supply a different field.",
    reopenLabel: "Back to Map — your column choices are kept",
  },
  review: {
    title: "Validate and review",
    description: "Read what each row would become, correct a cell where you can, and decide about each row on its own.",
    reopenLabel: "Back to Validate and review — your corrections and decisions are kept",
  },
  accept: {
    title: "Selectively accept",
    description: "Read what acceptance will create, then accept the rows you decided to keep. A row you left undecided is not accepted.",
    reopenLabel: "Back to Selectively accept — your file, mapping and decisions are kept",
  },
  results: {
    title: "Results",
    description: "See what each row became, open a contact this import created or added to, or return to a row that still needs a decision.",
    reopenLabel: "Back to Results — the receipt for this import is kept",
  },
};
/** The five steps in journey order, ready for a step list, a heading or an `aria-live` announcement. */
export const STEPS: readonly ImportStep[] = STEP_ORDER.map((id) => ({ id, ...STEP_COPY[id] }));
/** The zero-based position of a step in the journey, as `STEP_ORDER` declares it. */
export function stepIndex(id: ImportStepId): number {
  return STEP_ORDER.indexOf(id);
}
/** A step's name on its own, for a heading or a breadcrumb. */
export function stepTitle(id: ImportStepId): string {
  return STEP_COPY[id].title;
}
/** A step's position as words, for the indicator beside the step list: "Step 3 of 5". */
export function stepLabel(id: ImportStepId): string {
  return `Step ${stepIndex(id) + 1} of ${STEPS.length}`;
}
/** What an `aria-live="polite"` region announces when the journey moves to a step: the position and the name together, so a screen-reader user hears where they are without having to find the. */
export function stepAnnouncement(id: ImportStepId): string {
  return `${stepLabel(id)}: ${stepTitle(id)}`;
}
// The four limits, shown before a file is chosen
/** Which of the four limits a row describes, so a step can lay each one out by its own kind. */
export type LimitRowKey = "size" | "rows" | "columns" | "cell";
/** One limit as the choose-file step shows it: a short label, the limit itself as it is enforced, and a complete sentence saying what happens at the boundary. */
export interface LimitRow {
  readonly key: LimitRowKey;
  readonly label: string;
  readonly value: string;
  readonly message: string;
}
const LIMIT_ROW_KEY_BY_ID = {
  "file-bytes": "size",
  "data-rows": "rows",
  columns: "columns",
  "cell-code-points": "cell",
} as const satisfies Readonly<Record<ImportLimitId, LimitRowKey>>;
const BYTE_UNITS = ["B", "KiB", "MiB", "GiB"] as const;

function formatByteSize(bytes: number): string {
  let scaled = bytes;
  let unitIndex = 0;
  while (unitIndex < BYTE_UNITS.length - 1 && scaled >= 1024 && scaled % 1024 === 0) {
    scaled = scaled / 1024;
    unitIndex += 1;
  }
  return `${formatCount(scaled)} ${BYTE_UNITS[unitIndex] ?? BYTE_UNITS[0]}`;
}
function formatCount(value: number): string {
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(?:\d{3})+$)/g, ",");
}
function limitWording(descriptor: ImportLimitDescriptor): { value: string; message: string } {
  switch (descriptor.id) {
    case "file-bytes": {
      const size = formatByteSize(descriptor.value);
      return {
        value: size,
        message: `At most ${size}. A larger file is refused before it is read, so nothing is imported from it.`,
      };
    }
    case "data-rows": {
      const rows = formatCount(descriptor.value);
      return {
        value: `${rows} nonblank data rows`,
        message: `At most ${rows} nonblank data rows; a blank row is not counted. A file with more is refused before anything is imported.`,
      };
    }
    case "columns": {
      const columns = formatCount(descriptor.value);
      return {
        value: `${columns} columns`,
        message: `At most ${columns} columns. A header row with more is refused before anything is imported from the file.`,
      };
    }
    case "cell-code-points": {
      const characters = formatCount(descriptor.value);
      return {
        value: `${characters} characters per cell`,
        message: `At most ${characters} characters in one cell. A longer cell refuses its own row only, so the rest of the file can still be imported.`,
      };
    }
    default:
      return assertNever(descriptor.id, "Import limit with no wording");
  }
}
/** The four limits, in the order the choose-file step shows them: the whole file first, then its rows, its columns and finally the length of a single cell. */
export const LIMIT_ROWS: readonly LimitRow[] = IMPORT_LIMIT_DESCRIPTORS.map((descriptor) => {
  const wording = limitWording(descriptor);
  return {
    key: LIMIT_ROW_KEY_BY_ID[descriptor.id],
    label: descriptor.label,
    value: wording.value,
    message: wording.message,
  };
});
// The four row decisions
/** One decision's words: the label the review step offers, a sentence saying what the decision is, and the consequence of taking it. */
export interface DecisionCopyEntry {
  readonly label: string;
  readonly description: string;
  readonly consequence: string;
}
/** The four decisions a row can carry, keyed by the domain's own closed union so a member added or renamed in `@/modules/import/decide` fails to compile here rather than rendering a decision. */
export const DECISION_COPY: Record<ImportDecisionKind, DecisionCopyEntry> = {
  create: {
    label: "Create a new private entry",
    description: "Start a private preparation entry of your own from this row's cells, with no shared record involved.",
    consequence: "The entry is private to you: none of this row's text is copied into a shared record, into shared activity, or into any other partner's audience.",
  },
  reuse: {
    label: "Reuse an authorized identity",
    description: "Attach a private preparation entry to a contact this import proposed for the row and you are authorised to see, naming that contact only by the reference the source issued.",
    consequence:
      "This does not merge the two records: the contact keeps every field, contact method, tag and audience exactly as it stands, and the changes this row proposes are shown beside the current values for you to compare.",
  },
  skip: {
    label: "Skip this row",
    description: "Leave this row out of the import and record nothing for it.",
    consequence: "Nothing is created for the row and the file is unchanged; a reason you add is kept beside the row, next to the row's own problem.",
  },
  unresolved: {
    label: "Leave undecided",
    description: "Record no decision about the row and leave it waiting.",
    consequence: "The row is neither accepted nor skipped, and it holds no other row back: acceptance covers only the rows you have decided.",
  },
};
// The five row results
/** The badge variants this vocabulary may name; a colour is never chosen here, only a variant's name. */
export type RowResultBadgeVariant = "default" | "secondary" | "outline" | "destructive";
/** One result's words: the label the results screen shows, a sentence saying what happened to the row, and the badge variant that carries its tone. */
export interface RowResultCopyEntry {
  readonly label: string;
  readonly description: string;
  readonly badgeVariant: RowResultBadgeVariant;
}
/** The five results a row can carry, keyed by the domain's own closed union, so a sixth state or a renamed one fails to compile here instead of rendering unexplained. */
export const ROW_RESULT_COPY: Record<ImportRowResultState, RowResultCopyEntry> = {
  accepted: {
    label: "Accepted",
    description: "This import created the row's private entry, or attached it to a contact you already hold.",
    badgeVariant: "default",
  },
  "already-accepted": {
    label: "Accepted earlier",
    description: "An earlier attempt of this same import created the row's record, so nothing was created twice and this is the original result rather than a second import.",
    badgeVariant: "secondary",
  },
  skipped: {
    label: "Skipped",
    description: "The row was left out, either by your own decision or because the import was cancelled before this row was reached.",
    badgeVariant: "outline",
  },
  "needs-review": {
    label: "Needs review",
    description: "Nothing was applied to this row and nothing failed. The row states why acceptance left it alone, and it can still be decided, corrected or accepted again.",
    badgeVariant: "outline",
  },
  failed: {
    label: "Failed",
    description:
      "The row carries no applied result. Its record names the reason the service gave; where the store could not be reached the row's fate is unknown, and checking the same operation again returns the original result instead of applying the row twice.",
    badgeVariant: "destructive",
  },
};
// The simulated effect, the acceptance facts and the refused file
/** The import's simulated effect, named by key for `SimulationLabel`. */
export const IMPORT_SIMULATION_EFFECT = "importer-safety" as const satisfies SimulatedEffect;
/** Which pre-acceptance fact a notice line states. */
export type AcceptanceNoticeId =
  | "no-audience-membership"
  | "no-consent"
  | "no-subscription"
  | "consent-column-uninterpreted"
  | "restrictions-preserved"
  | "suggestions-are-proposals"
  | "summary-rows-only";
/** One pre-acceptance fact: a short label a worker can scan, and the statement behind it. */
export interface AcceptanceNoticeItem {
  readonly id: AcceptanceNoticeId;
  readonly label: string;
  readonly statement: string;
}
/** What acceptance will and will not do, stated before anything is accepted, for the acceptance summary to render above its confirm control. */
export const ACCEPTANCE_NOTICE: readonly AcceptanceNoticeItem[] = [
  {
    id: "no-audience-membership",
    label: "No audience membership is created",
    statement: "Acceptance adds private contact entries and nothing else: no Update audience member, publisher or purpose is created or changed.",
  },
  {
    id: "no-consent",
    label: "No consent is recorded",
    statement: "None of these rows records consent to be contacted, to receive Updates or to anything else, whatever the file says about it.",
  },
  {
    id: "no-subscription",
    label: "No one is subscribed",
    statement: "Accepting a row never subscribes a person and never turns a notice on for them; those choices stay with the reader who makes them.",
  },
  {
    id: "consent-column-uninterpreted",
    label: "A consent-looking column stays as data",
    statement: "A column that looks like a subscribed flag is kept as written and is never read as consent, whoever supplied the file.",
  },
  {
    id: "restrictions-preserved",
    label: "Negative restrictions are kept as written",
    statement: "A row that asks not to be contacted keeps that restriction exactly as the file states it; acceptance never removes it or narrows it.",
  },
  {
    id: "suggestions-are-proposals",
    label: "A suggested contact is a proposal, not a merge",
    statement:
      "A contact proposed for a row is a suggestion. Reusing it attaches a private entry to that contact's own reference, and no field, contact method, tag or audience of that contact is rewritten or combined with this row.",
  },
  {
    id: "summary-rows-only",
    label: "Only the rows in this summary",
    statement: "Acceptance reaches the rows this summary lists. A row you left undecided or skipped is not accepted, and a changed file has to be reviewed again.",
  },
];
/** The framing of a refused file: a title and a lead that state the outcome before the reason. */
export const REFUSAL_FRAMING = {
  title: "This file was not processed",
  lead: "Nothing was imported and no record changed. The reason is shown as this application reported it.",
} as const;
/** The accessible name of each of the import's three tables, passed to the scroll region that wraps the table and to the table's own caption. */
export const TABLE_LABELS = {
  mapping: "Imported columns and field mapping",
  review: "Rows awaiting a decision",
  results: "Per-row import results",
} as const;
// What step one's body says
/** The words only the choose-file step's own body states: the file control's label and hint, the frame around the four limits, the facts a chosen file reports about itself, and the control. */
export const CHOOSE_FILE_COPY = {
  fileLabel: "CSV file",
  fileHint:
    "Choose one UTF-8 CSV file from this device. This step reads its bytes in your browser and hands them to the importer, which parses them and measures them against the four limits below; nothing is imported until you have reviewed every row.",
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
/** A chosen file's size, in the units the byte limit beside it is stated in. */
export function chosenFileSize(byteLength: number): string {
  return formatByteSize(byteLength);
}
// What the selectively-accept step's body says
/** The words only the selectively-accept step adds around `ACCEPTANCE_NOTICE` and the shared review step: the frame the notice is read under, and the three strings the review step needs from. */
export const ACCEPTANCE_REVIEW_COPY = {
  noticeHeading: "What acceptance does, and what it never does",
  noticeLead: "Read these before you confirm. Each line names something an import is often assumed to do that this one does not, so none of them is discovered after the fact.",
  title: "Accept the rows you decided",
  description:
    "Accepting applies the decisions you reviewed. A row you decided to create becomes a new private preparation entry of your own; a row you decided to reuse attaches a private entry to the contact you named, and that contact is left exactly as it stands.",
  confirmLabel: "Accept the reviewed rows",
  selectionNoun: "rows",
} as const;
