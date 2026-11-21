"use client";

/**
 * The contact-import journey's own state: which of the five steps the worker is standing on, what each
 * step has already been given, which steps that work opens, and the one attempt identity for each
 * intent this journey submits.
 *
 * Scope: AAP 0.10.1 family 6 ("a five-step journey Choose file → Map → Validate and review → Selectively
 * accept → Results"), 0.12.1 criterion 4 (per-row decisions, a corrected row, a skipped row, a reused
 * identity, recovery after a lost acknowledgement, and a journey that survives back-navigation), and
 * 0.15.1 ("Data access", "Naming"). Nothing else is added: the two reads and the four mutations live in
 * the sibling hooks, which take their `scope` and `expectedRevision` from the proposal envelope the
 * component holds, so no scope, revision, envelope or outcome appears here.
 *
 * What this hook owns, and why each part belongs here:
 *
 * - **Position and guards.** {@link STEPS} is the single declaration of the journey's order, so a step's
 *   reopening guard is keyed by the closed `ImportStepId` set rather than by a second list of steps: a
 *   sixth step cannot be added without giving it a guard. A step opens when its own input exists, and
 *   nothing later is guessed at.
 * - **The entered work of each step.** Which file was chosen, which mapping was confirmed, and which
 *   decision each row carries. Going back to an earlier step never costs work already entered (WCAG
 *   3.3.7, Redundant Entry), which is criterion 4's "re-open Map from Selectively accept without losing
 *   a decision"; only a genuine change of intent clears the work that change invalidated.
 * - **One attempt identity per intent.** A `proposalOperationId`, and one id per row for that row's
 *   decision, minted through {@link newOperationId} and kept for as long as the intent behind them is
 *   unchanged. Retrying a submission that did not settle therefore replays under its own identity
 *   instead of duplicating the effect the service may already have applied.
 *
 * What it deliberately does not own. The accept attempt's `operationId` belongs to the shared review
 * step's `useReviewedMutation`, which mints exactly one identity per intent (scope, expected revision,
 * payload) and is the application's only decider of an attempt's identity; {@link
 * ImportJourney.acceptIntentKey} is the journey's own deterministic key of the reviewed decisions
 * snapshot, not a second operation id, so each intent still has exactly one owner. No read envelope, no
 * read result and no mutation outcome is stored here, because a receipt for an attempt the worker has
 * not submitted yet would be a state no read produced. Nothing is persisted either — no session
 * storage, no local storage and no URL state — so a reload restarts the journey at its first step
 * rather than resurrecting half of it.
 *
 * Import discipline, and it is a load-bearing rule rather than a style. `@/modules/import/*` reaches
 * the `csv-parse` package through `parse.ts`, and the data service's outcome module reaches a
 * server-only response type, so every import from either in a client module is type-only: a value
 * import would pull server code into the browser bundle. The two domain types this file holds are
 * imported under the domain's own names — `ImportConfirmedMapping` and `ImportDecisionInput` — so a
 * member renamed, withdrawn or added in `map.ts` or `decide.ts` stops this file compiling instead of
 * letting a second copy of the vocabulary drift from the one the service records against.
 *
 * No clock, no parsing, no measuring and no fingerprinting: this module decodes nothing and holds no
 * opinion about a file. `contentBase64` is carried and never inspected, a filename never establishes
 * what a file is, and whether a file is acceptable at all is the importer's judgement, not the
 * browser's. Producing that judgement here — a row limit restated, a type guessed from an extension, a
 * duplicate match invented — would be a second authority the service would then have to contradict.
 */

import { useMemo, useReducer } from "react";

import { STEPS, stepIndex, type ImportStepId } from "@/features/import/copy";
import { newOperationId } from "@/lib/ids";
import type { ImportCellCorrectionInput, ImportDecisionInput } from "@/modules/import/decide";
import type { ImportConfirmedMapping } from "@/modules/import/map";

/**
 * The one file the worker chose, held between steps so that re-opening the first step still shows it.
 */
export interface ImportFileSelection {
  /** Display metadata only: a filename or an extension never establishes that a file is a CSV. */
  readonly fileName: string;
  /** Display only; the importer measures the bytes it is given against the import limit itself. */
  readonly byteLength: number;
  /** The chosen bytes, carried for the service to decode. Nothing here looks inside them. */
  readonly contentBase64: string;
}

/**
 * One worker's position in the five-step import journey, with the work each step has been given.
 */
export interface ImportJourney {
  readonly step: ImportStepId;
  /** Whether the step's own input exists, so opening it would show something real. */
  readonly canOpen: (step: ImportStepId) => boolean;
  /** Moves to the step; a no-op when the step is not open, never an error and never a neighbour. */
  readonly goTo: (step: ImportStepId) => void;
  /** Moves one step on when that step is open; otherwise stays where it is. */
  readonly advance: () => void;
  /** Returns to the first step and clears every piece of work and every identity. */
  readonly reset: () => void;

  readonly file: ImportFileSelection | undefined;
  readonly setFile: (selection: ImportFileSelection) => void;

  readonly mapping: ImportConfirmedMapping | undefined;
  readonly setMapping: (mapping: ImportConfirmedMapping) => void;

  readonly decisions: Readonly<Record<number, ImportDecisionInput>>;
  readonly setDecision: (rowNumber: number, decision: ImportDecisionInput) => void;
  readonly acknowledged: boolean;
  readonly acknowledge: () => void;

  /** Stable id for the `proposeImport` intent; undefined until a file is chosen. */
  readonly proposalOperationId: string | undefined;
  /** Stable id for one row's current decision submission; undefined for a row with no decision. */
  readonly decisionOperationId: (rowNumber: number) => string | undefined;
  /**
   * Deterministic key of the reviewed decisions snapshot — the rows in ascending order, each paired
   * with the decision recorded for it — so the accept intent can be renewed exactly when it changes.
   */
  readonly acceptIntentKey: string;
}

/** The journey's opening step: the only step open before the worker has given anything. */
const FIRST_STEP: ImportStepId = "choose-file";

/** Everything the journey holds. One value, so an interdependent transition cannot be half-applied. */
interface JourneyState {
  readonly step: ImportStepId;
  readonly file: ImportFileSelection | undefined;
  readonly mapping: ImportConfirmedMapping | undefined;
  readonly decisions: Readonly<Record<number, ImportDecisionInput>>;
  readonly acknowledged: boolean;
  readonly proposalOperationId: string | undefined;
  readonly decisionOperationIds: Readonly<Record<number, string>>;
}

/** The journey before anything is entered: step one, no work, no identity. */
const EMPTY_JOURNEY: JourneyState = {
  step: FIRST_STEP,
  file: undefined,
  mapping: undefined,
  decisions: {},
  acknowledged: false,
  proposalOperationId: undefined,
  decisionOperationIds: {},
};

/**
 * Every transition the journey has, as a closed union. Each carries the work it applies; the identities
 * are minted by the caller before dispatch, so the reducer reads no clock, no random source and no
 * domain module and can be exercised as a pure function.
 */
type JourneyAction =
  | {
      readonly type: "file-chosen";
      readonly selection: ImportFileSelection;
      readonly operationId: string;
    }
  | {
      readonly type: "mapping-confirmed";
      readonly mapping: ImportConfirmedMapping;
      readonly operationId: string;
    }
  | {
      readonly type: "decision-recorded";
      readonly rowNumber: number;
      readonly decision: ImportDecisionInput;
      readonly operationId: string;
    }
  | { readonly type: "acknowledged" }
  | { readonly type: "step-opened"; readonly step: ImportStepId }
  | { readonly type: "reset" };

/**
 * Whether the worker has decided about at least one row.
 *
 * It stops at the first decision rather than counting them: a file may hold thousands of data rows, and
 * every step list asks this guard on every render. Whether a snapshot has one decision or five thousand
 * is the acceptance payload's business, not this guard's.
 */
function hasAnyDecision(decisions: Readonly<Record<number, ImportDecisionInput>>): boolean {
  for (const rowNumber in decisions) {
    if (decisions[rowNumber] !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * What each step needs before opening, keyed by the closed step set: a step added to `copy.ts` without a
 * guard here fails to compile, and a guard can only read the work, never advance the journey.
 */
const STEP_GUARDS: Record<ImportStepId, (state: JourneyState) => boolean> = {
  "choose-file": () => true,
  map: (state) => state.file !== undefined,
  review: (state) => state.file !== undefined && state.mapping !== undefined,
  /* The same non-emptiness the acceptance payload requires: a snapshot with no decision applies
   * nothing while reading as an act. */
  accept: (state) => state.mapping !== undefined && hasAnyDecision(state.decisions),
  results: (state) => state.acknowledged,
};

/** Whether the step's own input exists. */
function canOpenStep(state: JourneyState, step: ImportStepId): boolean {
  return STEP_GUARDS[step](state);
}

/**
 * The last step the entered work opens, in journey order.
 *
 * It exists for one situation: a change of intent clears the work a later step depended on, and the
 * step the worker was standing on may be one of those. Falling back to the furthest step that is still
 * open keeps the journey somewhere real instead of showing a closed step, and the first step is always
 * open, so this always answers.
 */
function furthestOpenStep(state: JourneyState): ImportStepId {
  return STEPS.findLast((candidate) => canOpenStep(state, candidate.id))?.id ?? FIRST_STEP;
}

/**
 * Leaves the worker on the step they are on when it is still open, and otherwise moves them to the
 * furthest step their work now opens. Applied by every transition that can close a step, so no
 * transition can hand back a position with nothing to show.
 */
function settleStep(state: JourneyState): JourneyState {
  if (canOpenStep(state, state.step)) {
    return state;
  }
  return { ...state, step: furthestOpenStep(state) };
}

/**
 * A correction list as the values that make it distinct: the 1-based column and the replacement text,
 * in the order the worker supplied them, because that order is part of what the service records.
 */
function correctionsSignature(
  corrections: readonly ImportCellCorrectionInput[] | undefined,
): readonly (readonly [number, string])[] {
  return (corrections ?? []).map(
    (correction) => [correction.columnNumber, correction.value] as const,
  );
}

/**
 * One deterministic text for a decision, so two decisions can be compared for meaning and a snapshot of
 * them can be keyed without a clock and without hashing the file.
 *
 * Each member the domain's union carries is named, and nothing else is: an identical decision yields
 * identical text, so a re-recorded decision keeps its attempt identity and replays, while a different
 * kind, reuse reference, correction or reason yields different text and a new identity. JSON renders
 * the values, so a value containing a delimiter cannot make two decisions look alike. The switch has no
 * default arm on purpose: a fifth kind would leave this function without a return value and stop the
 * file compiling, rather than keying a decision it does not understand.
 */
function decisionSignature(decision: ImportDecisionInput): string {
  switch (decision.kind) {
    case "create":
      return JSON.stringify(["create", correctionsSignature(decision.corrections)]);
    case "reuse":
      return JSON.stringify([
        "reuse",
        decision.candidate.system,
        decision.candidate.reference,
        correctionsSignature(decision.corrections),
      ]);
    case "skip":
      return JSON.stringify(["skip", decision.reason ?? null]);
    case "unresolved":
      return JSON.stringify(["unresolved"]);
  }
}

/**
 * The reviewed decisions snapshot as one key: each row in ascending order paired with the signature of
 * the decision recorded for it.
 *
 * Ascending row order rather than insertion order, because the key states what was reviewed and not the
 * sequence of clicks; and a row-and-decision pair rather than a bare list, so two snapshots that differ
 * only in which row carries which decision cannot produce the same key.
 */
function reviewedSnapshotKey(decisions: Readonly<Record<number, ImportDecisionInput>>): string {
  const rowNumbers = Object.keys(decisions)
    .map((key) => Number(key))
    .sort((left, right) => left - right);
  const snapshot: (readonly [number, string])[] = [];
  for (const rowNumber of rowNumbers) {
    const decision = decisions[rowNumber];
    if (decision !== undefined) {
      snapshot.push([rowNumber, decisionSignature(decision)]);
    }
  }
  return JSON.stringify(snapshot);
}

/** The journey's transitions, as a pure function of the state and one action. */
function reduceJourney(state: JourneyState, action: JourneyAction): JourneyState {
  switch (action.type) {
    case "file-chosen":
      /* A different file invalidates everything the previous one produced: the confirmed mapping, the
       * per-row decisions, the acknowledgement and every downstream identity. */
      return settleStep({
        ...EMPTY_JOURNEY,
        step: state.step,
        file: action.selection,
        proposalOperationId: action.operationId,
      });
    case "mapping-confirmed":
      /* A confirmed mapping is a changed proposal intent, and the decisions taken against the previous
       * mapping no longer describe this one. */
      return settleStep({
        ...state,
        mapping: action.mapping,
        proposalOperationId: action.operationId,
        decisions: {},
        decisionOperationIds: {},
        acknowledged: false,
      });
    case "decision-recorded":
      /* The acknowledgement confirms one exact snapshot, so changing a decision withdraws it: the worker
       * confirms the rows they actually reviewed, and a stale confirmation is never carried over. */
      return settleStep({
        ...state,
        decisions: { ...state.decisions, [action.rowNumber]: action.decision },
        decisionOperationIds: {
          ...state.decisionOperationIds,
          [action.rowNumber]: action.operationId,
        },
        acknowledged: false,
      });
    case "acknowledged":
      return settleStep({ ...state, acknowledged: true });
    case "step-opened":
      return { ...state, step: action.step };
    case "reset":
      return EMPTY_JOURNEY;
  }
}

/**
 * Holds one worker's transient progress through the five-step contact-import journey: the position, the
 * work each step has been given, and the stable attempt identity of each intent it submits.
 */
export function useImportJourney(): ImportJourney {
  const [state, dispatch] = useReducer(reduceJourney, EMPTY_JOURNEY);

  /* The key covers every decision and a file may hold thousands of data rows, so it is derived once per
   * change to the decisions rather than once per render. */
  const acceptIntentKey = useMemo(() => reviewedSnapshotKey(state.decisions), [state.decisions]);

  const canOpen = (step: ImportStepId): boolean => canOpenStep(state, step);

  const goTo = (step: ImportStepId): void => {
    if (!canOpenStep(state, step)) {
      return;
    }
    dispatch({ type: "step-opened", step });
  };

  const advance = (): void => {
    const next = STEPS[stepIndex(state.step) + 1];
    if (next === undefined || !canOpenStep(state, next.id)) {
      return;
    }
    dispatch({ type: "step-opened", step: next.id });
  };

  const reset = (): void => {
    dispatch({ type: "reset" });
  };

  const setFile = (selection: ImportFileSelection): void => {
    /* The same file and the same bytes are the same proposal intent, so re-choosing it keeps the
     * identity and keeps every decision the worker has already recorded. */
    const standing = state.file;
    if (
      standing !== undefined &&
      standing.fileName === selection.fileName &&
      standing.contentBase64 === selection.contentBase64
    ) {
      return;
    }
    dispatch({ type: "file-chosen", selection, operationId: newOperationId() });
  };

  const setMapping = (mapping: ImportConfirmedMapping): void => {
    dispatch({ type: "mapping-confirmed", mapping, operationId: newOperationId() });
  };

  const setDecision = (rowNumber: number, decision: ImportDecisionInput): void => {
    const standing = state.decisions[rowNumber];
    if (standing !== undefined && decisionSignature(standing) === decisionSignature(decision)) {
      return;
    }
    dispatch({ type: "decision-recorded", rowNumber, decision, operationId: newOperationId() });
  };

  const acknowledge = (): void => {
    if (state.acknowledged) {
      return;
    }
    dispatch({ type: "acknowledged" });
  };

  return {
    step: state.step,
    canOpen,
    goTo,
    advance,
    reset,
    file: state.file,
    setFile,
    mapping: state.mapping,
    setMapping,
    decisions: state.decisions,
    setDecision,
    acknowledged: state.acknowledged,
    acknowledge,
    proposalOperationId: state.proposalOperationId,
    decisionOperationId: (rowNumber: number) => state.decisionOperationIds[rowNumber],
    acceptIntentKey,
  };
}
