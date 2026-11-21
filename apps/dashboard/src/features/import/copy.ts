/**
 * The contact-import family's only wording: the five steps of the journey, the four limits a file is
 * held to before anything is read, the vocabulary of the four row decisions and the five row results,
 * the facts the acceptance summary states, and the framing of a refused file.
 *
 * Scope: AAP 0.10.1's contact-import journey ("a five-step journey (Choose file → Map → Validate and
 * review → Selectively accept → Results) over UTF-8 CSV within displayed limits"), 0.8.7's four fixed
 * import limits, which must be *displayed* as well as enforced, 0.7.2's rule that every simulated
 * effect is labelled where the worker triggers it, and the `features/import/**` row of 0.9.1/0.11.1.
 *
 * Three separations the wording has to keep, because the interface is where they can blur: a suggested
 * contact is a proposal and never a merge; a row decision is not consent; an acceptance is neither a
 * subscription nor a verified identity; and the receipt of an import proves that a local import ran, not
 * that the file was safe to accept.
 *
 * This module holds sentences and vocabulary and nothing else. It states no limit of its own: each of the
 * four limits is read from `IMPORT_LIMIT_DESCRIPTORS`, the descriptors the importer measures a file
 * against, and both the number a row shows and the sentence beside it are built from that descriptor's own
 * value, so a changed limit cannot leave the list describing a limit the importer does not enforce. The
 * decision kinds and the result states are the domain's own unions, so a member added, renamed or withdrawn
 * in `@/modules/import/decide` or `@/modules/import/receipt` leaves a record here incomplete and this module
 * stops compiling rather than drifting into a vocabulary the service would refuse.
 *
 * The sentence that says this import is simulated lives in `@/components/simulation-label`. This module
 * names the effect by key only, so a surface passes the key to the label component and the disclosure
 * keeps its one home.
 *
 * Plain data throughout: no JSX, no component, no hook, no clock, no locale-dependent formatting and no
 * colour. Every value is a string or a small readonly object a component renders, and every state
 * carries a text label, so no meaning is ever left to colour alone.
 */

import type { SimulatedEffect } from "@/components/simulation-label";
import type { ImportDecisionKind } from "@/modules/import/decide";
import type { ImportLimitDescriptor, ImportLimitId } from "@/modules/import/parse";
import { IMPORT_LIMIT_DESCRIPTORS } from "@/modules/import/parse";
import type { ImportRowResultState } from "@/modules/import/receipt";
import { assertNever } from "@/lib/result";

// ---------------------------------------------------------------------------------------------
// The five steps of the journey
// ---------------------------------------------------------------------------------------------

/**
 * The five steps, in the specification's own order and names. The type belongs to this module because
 * no domain module owns the journey's shape; `STEP_COPY` below is keyed by it, so a step with no wording
 * cannot compile.
 */
export type ImportStepId = "choose-file" | "map" | "review" | "accept" | "results";

/**
 * One step: its name, what it is for, and the label of the control that opens it again once the worker
 * has moved past it.
 */
export interface ImportStep {
  readonly id: ImportStepId;
  readonly title: string;
  readonly description: string;
  readonly reopenLabel: string;
}

/**
 * The journey order, declared once. `STEPS` and every visible step number derive from it, so the order a
 * step list shows and the number an announcement speaks cannot disagree.
 */
const STEP_ORDER = [
  "choose-file",
  "map",
  "review",
  "accept",
  "results",
] as const satisfies readonly ImportStepId[];

/** A step's words, without the identifier the order already supplies. */
type StepCopy = Omit<ImportStep, "id">;

/**
 * Each step's words, keyed by the closed step set.
 *
 * `reopenLabel` says what re-opening the step keeps, because re-opening an earlier step must never cost
 * the worker work already entered (WCAG 3.3.7, Redundant Entry). The one step whose reopening does
 * change something is the first: a different file needs a fresh review, so its label says the chosen
 * file is kept until it is replaced rather than promising that a replacement keeps anything.
 */
const STEP_COPY: Record<ImportStepId, StepCopy> = {
  "choose-file": {
    title: "Choose file",
    description:
      "Choose one UTF-8 CSV file of contacts, and read the limits it will be measured against before it is read. Nothing is imported until you have reviewed every row.",
    reopenLabel: "Back to Choose file — your chosen file is kept until you replace it",
  },
  map: {
    title: "Map",
    description:
      "Name the field each column supplies. Two columns with the same heading stay two separate columns, so each can supply a different field.",
    reopenLabel: "Back to Map — your column choices are kept",
  },
  review: {
    title: "Validate and review",
    description:
      "Read what each row would become, correct a cell where you can, and decide about each row on its own.",
    reopenLabel: "Back to Validate and review — your corrections and decisions are kept",
  },
  accept: {
    title: "Selectively accept",
    description:
      "Read what acceptance will create, then accept the rows you decided to keep. A row you left undecided is not accepted.",
    reopenLabel: "Back to Selectively accept — your file, mapping and decisions are kept",
  },
  results: {
    title: "Results",
    description:
      "See what each row became, open a contact this import created or added to, or return to a row that still needs a decision.",
    reopenLabel: "Back to Results — the receipt for this import is kept",
  },
};

/**
 * The five steps in journey order, ready for a step list, a heading or an `aria-live` announcement.
 * Built from `STEP_ORDER` and `STEP_COPY` together, so neither the order nor the wording can exist in
 * two places.
 */
export const STEPS: readonly ImportStep[] = STEP_ORDER.map((id) => ({ id, ...STEP_COPY[id] }));

/**
 * The zero-based position of a step in the journey, as `STEP_ORDER` declares it. The closed type makes
 * an unknown step impossible, so the result is always a position in this journey.
 */
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

/**
 * What an `aria-live="polite"` region announces when the journey moves to a step: the position and the
 * name together, so a screen-reader user hears where they are without having to find the step list.
 */
export function stepAnnouncement(id: ImportStepId): string {
  return `${stepLabel(id)}: ${stepTitle(id)}`;
}

// ---------------------------------------------------------------------------------------------
// The four limits, shown before a file is chosen
// ---------------------------------------------------------------------------------------------

/** Which of the four limits a row describes, so a step can lay each one out by its own kind. */
export type LimitRowKey = "size" | "rows" | "columns" | "cell";

/**
 * One limit as the choose-file step shows it: a short label, the limit itself as it is enforced, and a
 * complete sentence saying what happens at the boundary.
 */
export interface LimitRow {
  readonly key: LimitRowKey;
  readonly label: string;
  readonly value: string;
  readonly message: string;
}

/**
 * The key each domain limit is shown under. The annotation is the guard: a limit added to, or renamed
 * in, `IMPORT_LIMIT_DESCRIPTORS` leaves this record incomplete or unmatched, so the list cannot silently
 * miss a limit the importer enforces.
 */
const LIMIT_ROW_KEY_BY_ID = {
  "file-bytes": "size",
  "data-rows": "rows",
  columns: "columns",
  "cell-code-points": "cell",
} as const satisfies Readonly<Record<ImportLimitId, LimitRowKey>>;

/** The binary units a byte limit is stated in, smallest first. */
const BYTE_UNITS = ["B", "KiB", "MiB", "GiB"] as const;

/**
 * Renders a byte limit in the largest binary unit that divides it exactly, so a byte ceiling reads as a
 * size a person can compare with a file rather than as a seven-digit count. The loop stops at the first unit
 * the number does not divide exactly, so a limit that is not a whole number of larger units keeps the
 * smaller unit instead of being rounded up into one it does not reach.
 */
function formatByteSize(bytes: number): string {
  let scaled = bytes;
  let unitIndex = 0;

  while (unitIndex < BYTE_UNITS.length - 1 && scaled >= 1024 && scaled % 1024 === 0) {
    scaled = scaled / 1024;
    unitIndex += 1;
  }

  return `${formatCount(scaled)} ${BYTE_UNITS[unitIndex] ?? BYTE_UNITS[0]}`;
}

/**
 * Groups a whole number with ASCII commas every three digits.
 *
 * A locale-aware formatter would render these digits in the reader's own numbering system, and a limit
 * the importer enforces is not a value whose presentation may change with the host's locale data: the
 * number a warning states, the number a test asserts and the number a screen reader speaks have to be
 * the same number. Truncation is the only adjustment made, because every limit is a whole count.
 */
function formatCount(value: number): string {
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(?:\d{3})+$)/g, ",");
}

/**
 * One limit's number and the sentence stating what happens at it, both built from the same value so they
 * cannot describe different limits.
 *
 * The number is the descriptor's own value, which is the constant `parse.ts` measures a file against, so a
 * changed limit changes both strings without an edit here; the units are the ones each measurement is made
 * in, because a count of characters and a count of bytes are not interchangeable and a limit stated in the
 * wrong unit would be a limit a worker could not meet. Each sentence also says where the refusal lands: a
 * file above a whole-file limit is refused before it is read or before anything is imported, while a cell
 * above its own limit refuses only its row and leaves the rest of the file importable.
 */
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

/**
 * The four limits, in the order the choose-file step shows them: the whole file first, then its rows, its
 * columns and finally the length of a single cell. Every limit here is refused before the work it would
 * limit begins — a file that is too large before it is read, a row or a column before anything is
 * imported, and a cell on its own row while the rest of the file stays acceptable — so the list can be
 * read as a promise about what happens rather than a warning after the fact, and the worker sees all four
 * before choosing a file.
 *
 * The order is `IMPORT_LIMIT_DESCRIPTORS`' own declaration order, and each row's label, number and sentence
 * all come from that descriptor, so there is one place a limit is declared and one place it is worded.
 */
export const LIMIT_ROWS: readonly LimitRow[] = IMPORT_LIMIT_DESCRIPTORS.map((descriptor) => {
  const wording = limitWording(descriptor);

  return {
    key: LIMIT_ROW_KEY_BY_ID[descriptor.id],
    label: descriptor.label,
    value: wording.value,
    message: wording.message,
  };
});

// ---------------------------------------------------------------------------------------------
// The four row decisions
// ---------------------------------------------------------------------------------------------

/**
 * One decision's words: the label the review step offers, a sentence saying what the decision is, and the
 * consequence of taking it.
 */
export interface DecisionCopyEntry {
  readonly label: string;
  readonly description: string;
  readonly consequence: string;
}

/**
 * The four decisions a row can carry, keyed by the domain's own closed union so a member added or renamed
 * in `@/modules/import/decide` fails to compile here rather than rendering a decision the service cannot
 * record.
 *
 * There is no fifth kind and none of these is a merge. Reuse attaches a private preparation entry to a
 * contact this import proposed, by that contact's own opaque reference; it never combines two records,
 * never rewrites the existing one and never reads this row into it. Each consequence also keeps the row
 * decision apart from consent: deciding a row is not subscribing anyone, and it grants no permission to
 * contact a person.
 */
export const DECISION_COPY: Record<ImportDecisionKind, DecisionCopyEntry> = {
  create: {
    label: "Create a new private entry",
    description:
      "Start a private preparation entry of your own from this row's cells, with no shared record involved.",
    consequence:
      "The entry is private to you: none of this row's text is copied into a shared record, into shared activity, or into any other partner's audience.",
  },
  reuse: {
    label: "Reuse an authorized identity",
    description:
      "Attach a private preparation entry to a contact this import proposed for the row and you are authorised to see, naming that contact only by the reference the source issued.",
    consequence:
      "This does not merge the two records: the contact keeps every field, contact method, tag and audience exactly as it stands, and the changes this row proposes are shown beside the current values for you to compare.",
  },
  skip: {
    label: "Skip this row",
    description: "Leave this row out of the import and record nothing for it.",
    consequence:
      "Nothing is created for the row and the file is unchanged; a reason you add is kept beside the row, next to the row's own problem.",
  },
  unresolved: {
    label: "Leave undecided",
    description: "Record no decision about the row and leave it waiting.",
    consequence:
      "The row is neither accepted nor skipped, and it holds no other row back: acceptance covers only the rows you have decided.",
  },
};

// ---------------------------------------------------------------------------------------------
// The five row results
// ---------------------------------------------------------------------------------------------

/** The badge variants this vocabulary may name; a colour is never chosen here, only a variant's name. */
export type RowResultBadgeVariant = "default" | "secondary" | "outline" | "destructive";

/**
 * One result's words: the label the results screen shows, a sentence saying what happened to the row, and
 * the badge variant that carries its tone. The label is always rendered beside the variant, so a result
 * is never told by colour alone.
 */
export interface RowResultCopyEntry {
  readonly label: string;
  readonly description: string;
  readonly badgeVariant: RowResultBadgeVariant;
}

/**
 * The five results a row can carry, keyed by the domain's own closed union, so a sixth state or a renamed
 * one fails to compile here instead of rendering unexplained.
 *
 * `already-accepted` is the lost-acknowledgement story stated as a result: an earlier attempt of this
 * same import created the record and nothing was created again, so the row shows the original result
 * rather than a second import. `needs-review` is not a failure — nothing was applied and nothing failed,
 * the row is simply still waiting. And a `failed` row is not always a definite failure: where the store
 * could not be reached, the row's fate is unknown, so the words promise neither success nor loss.
 */
export const ROW_RESULT_COPY: Record<ImportRowResultState, RowResultCopyEntry> = {
  accepted: {
    label: "Accepted",
    description:
      "This import created the row's private entry, or attached it to a contact you already hold.",
    badgeVariant: "default",
  },
  "already-accepted": {
    label: "Accepted earlier",
    description:
      "An earlier attempt of this same import created the row's record, so nothing was created twice and this is the original result rather than a second import.",
    badgeVariant: "secondary",
  },
  skipped: {
    label: "Skipped",
    description:
      "The row was left out, either by your own decision or because the import was cancelled before this row was reached.",
    badgeVariant: "outline",
  },
  "needs-review": {
    label: "Needs review",
    description:
      "Nothing was applied to this row and nothing failed. The row states why acceptance left it alone, and it can still be decided, corrected or accepted again.",
    badgeVariant: "outline",
  },
  failed: {
    label: "Failed",
    description:
      "The row carries no applied result. Its record names the reason the service gave; where the store could not be reached the row's fate is unknown, and checking the same operation again returns the original result instead of applying the row twice.",
    badgeVariant: "destructive",
  },
};

// ---------------------------------------------------------------------------------------------
// The simulated effect, the acceptance facts and the refused file
// ---------------------------------------------------------------------------------------------

/**
 * The import's simulated effect, named by key for `SimulationLabel`.
 *
 * The sentence itself is owned by `SIMULATION_LABELS["importer-safety"]` in
 * `@/components/simulation-label` and is deliberately not repeated, paraphrased or shortened here: that
 * disclosure has exactly one home, so a surface passes this key to the label component and renders the
 * sentence from there.
 */
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

/**
 * What acceptance will and will not do, stated before anything is accepted, for the acceptance summary to
 * render above its confirm control.
 *
 * Each line names something this import deliberately does not do, because each is a thing an import is
 * often assumed to do: it creates no audience membership, records no consent, subscribes nobody, treats a
 * subscription-looking column as plain data, keeps a negative restriction exactly as the file writes it,
 * proposes contacts without merging them, and reaches only the rows the summary lists. None of these lines
 * is a caveat after the event — the worker reads them before choosing to accept.
 */
export const ACCEPTANCE_NOTICE: readonly AcceptanceNoticeItem[] = [
  {
    id: "no-audience-membership",
    label: "No audience membership is created",
    statement:
      "Acceptance adds private contact entries and nothing else: no Update audience member, publisher or purpose is created or changed.",
  },
  {
    id: "no-consent",
    label: "No consent is recorded",
    statement:
      "None of these rows records consent to be contacted, to receive Updates or to anything else, whatever the file says about it.",
  },
  {
    id: "no-subscription",
    label: "No one is subscribed",
    statement:
      "Accepting a row never subscribes a person and never turns a notice on for them; those choices stay with the reader who makes them.",
  },
  {
    id: "consent-column-uninterpreted",
    label: "A consent-looking column stays as data",
    statement:
      "A column that looks like a subscribed flag is kept as written and is never read as consent, whoever supplied the file.",
  },
  {
    id: "restrictions-preserved",
    label: "Negative restrictions are kept as written",
    statement:
      "A row that asks not to be contacted keeps that restriction exactly as the file states it; acceptance never removes it or narrows it.",
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
    statement:
      "Acceptance reaches the rows this summary lists. A row you left undecided or skipped is not accepted, and a changed file has to be reviewed again.",
  },
];

/**
 * The framing of a refused file: a title and a lead that state the outcome before the reason.
 *
 * The reason itself is not written here and must not be: it comes from the service's own outcome, with its
 * own measured value and wording, and the step renders it verbatim beneath this framing. A paraphrase here
 * would put a second, possibly wrong, account of the same refusal in front of the worker.
 */
export const REFUSAL_FRAMING = {
  title: "This file was not processed",
  lead: "Nothing was imported and no record changed. The reason is shown as this application reported it.",
} as const;

/**
 * The accessible name of each of the import's three tables, passed to the scroll region that wraps the
 * table and to the table's own caption.
 *
 * A wide table is the one place a surface may scroll sideways, and a scroll region without a name is a
 * landmark a screen-reader user cannot identify or choose to enter, so each of the three names says which
 * table it is rather than only that a table is there.
 */
export const TABLE_LABELS = {
  mapping: "Imported columns and field mapping",
  review: "Rows awaiting a decision",
  results: "Per-row import results",
} as const;
