"use client";
import { useMemo, useReducer } from "react";
import { STEPS, stepIndex, type ImportStepId } from "@/features/import/copy";
import { newOperationId } from "@/lib/ids";
import type { ImportCellCorrectionInput, ImportDecisionInput } from "@/modules/import/decide";
import type { ImportConfirmedMapping } from "@/modules/import/map";
export interface ImportFileSelection {
  readonly fileName: string;
  readonly byteLength: number;
  readonly contentBase64: string;
}
export interface ImportJourney {
  readonly step: ImportStepId;
  readonly canOpen: (step: ImportStepId) => boolean;
  readonly goTo: (step: ImportStepId) => void;
  readonly advance: () => void;
  readonly reset: () => void;
  readonly file: ImportFileSelection | undefined;
  readonly setFile: (selection: ImportFileSelection) => void;
  readonly mapping: ImportConfirmedMapping | undefined;
  readonly setMapping: (mapping: ImportConfirmedMapping) => void;
  readonly decisions: Readonly<Record<number, ImportDecisionInput>>;
  readonly setDecision: (rowNumber: number, decision: ImportDecisionInput) => void;
  readonly acknowledged: boolean;
  readonly acknowledge: () => void;
  readonly proposalOperationId: string | undefined;
  readonly decisionOperationId: (rowNumber: number) => string | undefined;
  readonly acceptIntentKey: string;
}
const FIRST_STEP: ImportStepId = "choose-file";

interface JourneyState {
  readonly step: ImportStepId;
  readonly file: ImportFileSelection | undefined;
  readonly mapping: ImportConfirmedMapping | undefined;
  readonly decisions: Readonly<Record<number, ImportDecisionInput>>;
  readonly acknowledged: boolean;
  readonly proposalOperationId: string | undefined;
  readonly decisionOperationIds: Readonly<Record<number, string>>;
}
const EMPTY_JOURNEY: JourneyState = { step: FIRST_STEP, file: undefined, mapping: undefined, decisions: {}, acknowledged: false, proposalOperationId: undefined, decisionOperationIds: {} };
type JourneyAction =
  | { readonly type: "file-chosen"; readonly selection: ImportFileSelection; readonly operationId: string }
  | { readonly type: "mapping-confirmed"; readonly mapping: ImportConfirmedMapping; readonly operationId: string }
  | { readonly type: "decision-recorded"; readonly rowNumber: number; readonly decision: ImportDecisionInput; readonly operationId: string }
  | { readonly type: "acknowledged" }
  | { readonly type: "step-opened"; readonly step: ImportStepId }
  | { readonly type: "reset" };
function hasAnyDecision(decisions: Readonly<Record<number, ImportDecisionInput>>): boolean {
  for (const rowNumber in decisions) {
    if (decisions[rowNumber] !== undefined) {
      return true;
    }
  }
  return false;
}
const STEP_GUARDS: Record<ImportStepId, (state: JourneyState) => boolean> = {
  "choose-file": () => true,
  map: (state) => state.file !== undefined,
  review: (state) => state.file !== undefined && state.mapping !== undefined,
  accept: (state) => state.mapping !== undefined && hasAnyDecision(state.decisions),
  results: (state) => state.acknowledged,
};
function canOpenStep(state: JourneyState, step: ImportStepId): boolean {
  return STEP_GUARDS[step](state);
}
function furthestOpenStep(state: JourneyState): ImportStepId {
  return STEPS.findLast((candidate) => canOpenStep(state, candidate.id))?.id ?? FIRST_STEP;
}
function settleStep(state: JourneyState): JourneyState {
  if (canOpenStep(state, state.step)) {
    return state;
  }
  return { ...state, step: furthestOpenStep(state) };
}
function correctionsSignature(corrections: readonly ImportCellCorrectionInput[] | undefined): readonly (readonly [number, string])[] {
  return (corrections ?? []).map((correction) => [correction.columnNumber, correction.value] as const);
}
function decisionSignature(decision: ImportDecisionInput): string {
  switch (decision.kind) {
    case "create":
      return JSON.stringify(["create", correctionsSignature(decision.corrections)]);
    case "reuse":
      return JSON.stringify(["reuse", decision.candidate.system, decision.candidate.reference, correctionsSignature(decision.corrections)]);
    case "skip":
      return JSON.stringify(["skip", decision.reason ?? null]);
    case "unresolved":
      return JSON.stringify(["unresolved"]);
  }
}
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
function reduceJourney(state: JourneyState, action: JourneyAction): JourneyState {
  switch (action.type) {
    case "file-chosen":
      return settleStep({ ...EMPTY_JOURNEY, step: state.step, file: action.selection, proposalOperationId: action.operationId });
    case "mapping-confirmed":
      return settleStep({ ...state, mapping: action.mapping, proposalOperationId: action.operationId, decisions: {}, decisionOperationIds: {}, acknowledged: false });
    case "decision-recorded":
      return settleStep({ ...state, decisions: { ...state.decisions, [action.rowNumber]: action.decision }, decisionOperationIds: { ...state.decisionOperationIds, [action.rowNumber]: action.operationId }, acknowledged: false });
    case "acknowledged":
      return settleStep({ ...state, acknowledged: true });
    case "step-opened":
      return { ...state, step: action.step };
    case "reset":
      return EMPTY_JOURNEY;
  }
}
/** Holds one worker's transient progress through the five-step contact-import journey: the position, the work each step has been given, and the stable attempt identity of each intent it. */
export function useImportJourney(): ImportJourney {
  const [state, dispatch] = useReducer(reduceJourney, EMPTY_JOURNEY);
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
    const standing = state.file;
    if (standing !== undefined && standing.fileName === selection.fileName && standing.contentBase64 === selection.contentBase64) {
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
