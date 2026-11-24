"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { FormErrorSummary, fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatSourceReference, newOperationId, type SourceReference } from "@/lib/ids";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import type { ImportRowState, MutationInput, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { DenialReason, MutationOutcome, ReadResult } from "@/modules/data-service/outcome";
import type { ImportProposalRowRoute, ImportProposalView, ImportReceiptCancellationView, ImportReceiptView } from "@/modules/data-service/reads/import";
import type { ImportDecisionInput } from "@/modules/import/decide";
import type { ImportConfirmedMapping } from "@/modules/import/map";
import type { ImportRowResultState } from "@/modules/import/receipt";
import { acceptImportRowsRequest, cancelImportRequest, fetchImportProposal, fetchImportReceipt, proposeImportRequest, setRowDecisionRequest, type ImportReadEnvelope } from "../client";
import { IMPORT_OPERATION_PARAM, JOURNEY_COPY, REFUSAL_FRAMING, STEPS, stepIndex, stepLabel, stepTitle } from "../copy";
import { useImportJourney } from "../hooks/use-import-journey";
import type { AcceptImportRowsPayload, CancelPayload } from "../schemas/acceptance";
import FileChooser from "./file-chooser";
import ImportNotice from "./import-notice";
import ImportStepper from "./import-stepper";
import StepAcceptance, { type StepAcceptanceProps } from "./step-acceptance";
import StepMapping from "./step-mapping";
import StepResults, { type ImportResultsRow, type ImportResultsView } from "./step-results";
import StepReview, { type ImportStopControl, type StepReviewRefusal } from "./step-review";
const FIRST_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
type ProposePayload = { readonly fileName: string; readonly contentBase64: string; readonly confirmedMapping?: ImportConfirmedMapping };
type ReadRequest = { readonly identity: string; readonly page: number; readonly pageSize: number };
type ProposalAnswer = "review" | "results" | "refused";
type ReadState<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly request: ReadRequest }
  | { readonly kind: "view"; readonly request: ReadRequest; readonly envelope: ReadEnvelope<ImportReadEnvelope>; readonly view: T }
  | { readonly kind: "pending"; readonly request: ReadRequest }
  | { readonly kind: "denied"; readonly request: ReadRequest; readonly reasonCode: DenialReason }
  | { readonly kind: "refused"; readonly request: ReadRequest; readonly errors: FieldErrorLookup }
  | { readonly kind: "unavailable"; readonly request: ReadRequest; readonly source: SourceReference; readonly guidance: string };
type ProposalRead = ReadState<ImportProposalView>;
type ResultsRead = ReadState<ImportResultsView>;
/** The refusal arms one read answer states, so both reads of this journey build them the same way instead of each restating the vocabulary the transport answers with. */ type ReadRefusal = Extract<ReadState<never>, { readonly kind: "denied" | "refused" | "unavailable" }>;
const refusalStateOf = (answer: ReadResult<ReadEnvelope<ImportReadEnvelope>>, request: ReadRequest): ReadRefusal | null =>
  answer.kind === "denied"
    ? { kind: "denied", request, reasonCode: answer.denied.reasonCode }
    : answer.kind === "unavailable"
      ? { kind: "unavailable", request, source: answer.unavailable.source, guidance: answer.unavailable.guidance }
      : answer.kind === "refused"
        ? { kind: "refused", request, errors: fieldErrorsFromInvalid(answer.refused) }
        : null;
type ProposeNotice = { readonly kind: "denied"; readonly reasonCode: DenialReason } | { readonly kind: "unavailable"; readonly source: SourceReference; readonly guidance: string } | { readonly kind: "conflict" } | { readonly kind: "unknown"; readonly operationId: string };
const PROPOSE_NOTICE_COPY: Readonly<Record<ProposeNotice["kind"], { readonly title: string; readonly lead: string }>> = {
  denied: { title: JOURNEY_COPY.proposeRefused.deniedTitle, lead: JOURNEY_COPY.proposeRefused.deniedLead },
  unavailable: { title: JOURNEY_COPY.proposeRefused.unavailableTitle, lead: JOURNEY_COPY.proposeRefused.unavailableLead },
  conflict: { title: JOURNEY_COPY.proposeRefused.conflictTitle, lead: JOURNEY_COPY.proposeRefused.conflictLead },
  unknown: { title: JOURNEY_COPY.proposeRefused.unknownTitle, lead: JOURNEY_COPY.proposeRefused.unknownLead },
};
function isImportProposalView(value: unknown): value is ImportProposalView {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.importOperationId) && typeof value.inFlight === "boolean" && typeof value.revision === "string" && isRecord(value.file) && isRecord(value.summary) && isRecord(value.rowWindow) && Array.isArray(value.rows) && isRecord(value.record) && (value.review === null || isRecord(value.review));
}
const isImportReceiptView = (value: unknown): value is ImportReceiptView =>
  isRecord(value) && isNonEmptyString(value.importOperationId) && isNonEmptyString(value.processedAt) && typeof value.revision === "string" && isRecord(value.file) && isRecord(value.counts) && isRecord(value.summary) && Array.isArray(value.rows) && isRecord(value.rowWindow) && typeof value.cancelled === "boolean";
const settledRowCount = (view: ImportProposalView): number => view.record.results.filter((result) => result.state === "accepted" || result.state === "already-accepted" || result.state === "skipped").length;
const stoppableRowCount = (view: ImportProposalView): number => Math.max(0, view.file.rowCount - settledRowCount(view));
function stateCountsOfResults(results: ImportProposalView["record"]["results"]): Readonly<Record<ImportRowState, number>> | null {
  if (results.length === 0) return null;
  const counts: Record<ImportRowState, number> = { accepted: 0, "already-accepted": 0, skipped: 0, "needs-review": 0, failed: 0 };
  for (const result of results) counts[result.state] += 1;
  return counts;
}
const resultsViewOf = (source: ImportProposalView | ImportReceiptView, rows: readonly ImportResultsRow[], stoppableRows: number, stateCounts: Readonly<Record<ImportRowState, number>> | null, cancellation: ImportReceiptCancellationView | null): ImportResultsView => ({
  importOperationId: source.importOperationId,
  file: { name: source.file.name, bytes: source.file.bytes, rowCount: source.file.rowCount, columnCount: source.file.columnCount },
  summary: { create: source.summary.create, reuse: source.summary.reuse, skip: source.summary.skip, unresolved: source.summary.unresolved, rowCount: source.summary.rowCount },
  rows,
  rowWindow: source.rowWindow,
  stoppableRows,
  stateCounts,
  cancellation,
});
const resultsRowOf = (row: ImportProposalView["rows"][number] | ImportReceiptView["rows"][number], route: ImportProposalRowRoute | null): ImportResultsRow => ({ rowNumber: row.rowNumber, decisionLabel: row.decisionLabel, state: row.state, stateLabel: row.stateLabel, reason: row.reason, route });
const resultsOfProposal = (view: ImportProposalView): ImportResultsView =>
  resultsViewOf(
    view,
    view.rows.map((row) => resultsRowOf(row, row.route)),
    stoppableRowCount(view),
    stateCountsOfResults(view.record.results),
    null, // A proposal states what acceptance would do; the cancellation it records is stated on the receipt, which the same operation answers once it has been stopped.
  );
const resultsOfReceipt = (view: ImportReceiptView): ImportResultsView => {
  const stateCounts: Record<ImportRowResultState, number> = { accepted: view.counts.accepted, "already-accepted": view.counts.alreadyAccepted, skipped: view.counts.skipped, "needs-review": view.counts.needsReview, failed: view.counts.failed };
  return resultsViewOf(
    view,
    view.rows.map((row) => resultsRowOf(row, row.route === null ? null : row.route.kind === "partner" ? { kind: "partner", partnerId: row.route.partnerRef.reference } : { kind: "correction", rowNumber: row.route.rowNumber })),
    view.counts.needsReview + view.counts.failed,
    stateCounts,
    view.cancellation, // The receipt's own record of a stop, reported as the read states it rather than inferred from the rows it skipped.
  );
};
const intentKeyOf = (command: string, input: Omit<MutationInput<unknown>, "operationId">): string => JSON.stringify([command, input.scope, input.expectedRevision, input.payload]);
const isSameWindow = (state: ProposalRead | ResultsRead, request: ReadRequest): boolean => (state.kind === "view" || state.kind === "pending") && state.request.identity === request.identity && state.request.page === request.page && state.request.pageSize === request.pageSize;
const wasApplied = (outcome: MutationOutcome): boolean => outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
function proposeNoticeOf(outcome: MutationOutcome): ProposeNotice | null {
  switch (outcome.outcome) {
    case "denied":
      return { kind: "denied", reasonCode: outcome.reasonCode };
    case "unavailable":
      return { kind: "unavailable", source: outcome.source, guidance: outcome.guidance };
    case "conflict":
      return { kind: "conflict" };
    case "unknown":
      return { kind: "unknown", operationId: outcome.operationId };
    default:
      return null;
  }
}
function reviewRefusalOf(outcome: MutationOutcome, decided: { readonly rowNumber: number; readonly decision: ImportDecisionInput }): StepReviewRefusal | null {
  switch (outcome.outcome) {
    case "invalid":
      return { kind: "invalid", errors: fieldErrorsFromInvalid(outcome) };
    case "denied":
      return { kind: "denied", reasonCode: outcome.reasonCode };
    case "conflict":
      // The decision this attempt posted and the input the service preserved are the same value, and the echoed `preservedInput` is `unknown`, so the typed decision is the one stated back beside the revision the review now stands at.
      return { kind: "conflict", rowNumber: decided.rowNumber, currentRevision: outcome.currentRevision, preservedInput: decided.decision };
    case "unavailable":
      return { kind: "unavailable", source: outcome.source, guidance: outcome.guidance };
    case "unknown":
      return { kind: "unknown", operationId: outcome.operationId };
    default:
      return null;
  }
}
function recordIdentityOf(outcome: MutationOutcome): string {
  const created = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? outcome.created?.[0] : undefined;
  return created === undefined || created === "" ? outcome.operationId : created;
}
function ProposeNoticeBlock({ notice }: { readonly notice: ProposeNotice }): ReactElement {
  const copy = PROPOSE_NOTICE_COPY[notice.kind];
  const details = notice.kind === "denied" ? [{ label: "Reason", value: notice.reasonCode }] : notice.kind === "unavailable" ? [{ label: "Source", value: formatSourceReference(notice.source), guidance: notice.guidance }] : notice.kind === "unknown" ? [{ label: "Operation", value: notice.operationId }] : [];
  return <ImportNotice destructive={notice.kind === "denied"} title={copy.title} lead={copy.lead} details={details} />;
}
function ReadNotice({ state, title, onRetry, fallback = null }: { readonly state: ProposalRead | ResultsRead; readonly title: string; readonly onRetry: (request: ReadRequest) => void; readonly fallback?: ReactElement | null }): ReactElement | null {
  switch (state.kind) {
    case "reading":
      return <StateNotice kind="loading" title={JOURNEY_COPY.reading} />;
    case "denied":
      return <StateNotice kind="denied" title={title} reasonCode={state.reasonCode} retry={{ label: JOURNEY_COPY.retryReadLabel, onClick: () => onRetry(state.request) }} />;
    case "unavailable":
      return <StateNotice kind="unavailable" title={title} source={state.source} description={state.guidance} retry={{ label: JOURNEY_COPY.retryReadLabel, onClick: () => onRetry(state.request) }} />;
    case "refused":
      return (
        <div className="flex min-w-0 flex-col items-start gap-3">
          <FormErrorSummary errors={state.errors} title={JOURNEY_COPY.readRefused.title} description={JOURNEY_COPY.readRefused.lead} />
          <Button type="button" variant="outline" onClick={() => onRetry(state.request)}>
            {JOURNEY_COPY.retryReadLabel}
          </Button>
        </div>
      );
    default:
      return fallback;
  }
}
/** Props of {@link ImportJourney}. */ export type ImportJourneyProps = { readonly scope: Scope; readonly expectedRevision: string; readonly initialOperationId?: string };
/** The five-step contact-import journey: the steps, the transport and the identity of every attempt. */ export default function ImportJourney({ scope, expectedRevision, initialOperationId }: ImportJourneyProps): ReactElement {
  const journey = useImportJourney();
  const headingId = useId();
  const [paging, setPaging] = useState<{ readonly page: number; readonly pageSize: number }>({ page: FIRST_PAGE, pageSize: DEFAULT_PAGE_SIZE });
  const [proposalRead, setProposalRead] = useState<ProposalRead>({ kind: "idle" });
  const [resultsRead, setResultsRead] = useState<ResultsRead>({ kind: "idle" });
  const [proposing, setProposing] = useState(false);
  const [proposeErrors, setProposeErrors] = useState<FieldErrorLookup | null>(null);
  const [proposeNotice, setProposeNotice] = useState<ProposeNotice | null>(null);
  const [decidingRow, setDecidingRow] = useState<number | null>(null);
  const [reviewRefusal, setReviewRefusal] = useState<StepReviewRefusal | null>(null);
  const [acceptUnknown, setAcceptUnknown] = useState<string | null>(null);
  const [correctionRow, setCorrectionRow] = useState<number | null>(null);
  const proposeRefusal = useMemo(() => (proposeErrors === null ? null : { byField: {}, form: [...proposeErrors.form, ...Object.values(proposeErrors.byField).flat()], count: proposeErrors.form.length + Object.values(proposeErrors.byField).flat().length }), [proposeErrors]);
  const [advanceTicket, setAdvanceTicket] = useState(0);
  const attempts = useRef<Map<string, string>>(new Map());
  const latestRequest = useRef(0);
  const mounted = useRef(false);
  const advanceDone = useRef(0);
  const operationIdFor = useCallback((intent: string): string => {
    const known = attempts.current.get(intent);
    if (known !== undefined) return known;
    const minted = newOperationId();
    attempts.current.set(intent, minted);
    return minted;
  }, []);
  // Whichever read answered last states the current scope and the revision a change from this page must present: the proposal while the import is in review, and the receipt once it has been processed, which reports the import record's own revision so the stop offered on the results step is accepted rather than refused as stale.
  const latestEnvelope = proposalRead.kind === "view" ? proposalRead.envelope : resultsRead.kind === "view" ? resultsRead.envelope : null;
  const currentScope = latestEnvelope === null ? scope : latestEnvelope.scope;
  const currentRevision = latestEnvelope === null ? expectedRevision : latestEnvelope.revision;
  const importIdentity = proposalRead.kind === "view" ? proposalRead.request.identity : null;
  // The import a results read found still in review: an address that named one reports it as pending, and that is the same import this surface can review again once the worker chooses its file, before any proposal read has named an identity.
  const inReviewIdentity = resultsRead.kind === "pending" ? resultsRead.request.identity : null;
  const readProposal = useCallback(async (request: ReadRequest): Promise<ProposalAnswer> => {
    latestRequest.current += 1;
    const fence = latestRequest.current;
    setProposalRead((previous) => (isSameWindow(previous, request) ? previous : { kind: "reading", request }));
    const answer: ReadResult<ReadEnvelope<ImportReadEnvelope>> = await fetchImportProposal(request.identity, { page: request.page, pageSize: request.pageSize });
    if (fence !== latestRequest.current) return "refused";
    if (answer.kind !== "envelope") {
      const refused = refusalStateOf(answer, request);
      if (refused !== null) setProposalRead(refused);
      return "refused";
    }
    const body = answer.envelope.data.data;
    if (isImportProposalView(body)) {
      setProposalRead({ kind: "view", request, envelope: answer.envelope, view: body });
      if (body.inFlight) return "review";
      setResultsRead({ kind: "view", request, envelope: answer.envelope, view: resultsOfProposal(body) });
      return "results";
    }
    if (isImportReceiptView(body)) {
      setResultsRead({ kind: "view", request, envelope: answer.envelope, view: resultsOfReceipt(body) });
      setProposalRead({ kind: "idle" });
      return "results";
    }
    setProposalRead({ kind: "unavailable", request, source: answer.envelope.source, guidance: JOURNEY_COPY.unreadableGuidance });
    return "refused";
  }, []);
  const readResults = useCallback(async (request: ReadRequest): Promise<void> => {
    latestRequest.current += 1;
    const fence = latestRequest.current;
    setResultsRead((previous) => (isSameWindow(previous, request) ? previous : { kind: "reading", request }));
    const answer: ReadResult<ReadEnvelope<ImportReadEnvelope>> = await fetchImportReceipt(request.identity, { page: request.page, pageSize: request.pageSize });
    if (fence !== latestRequest.current) return;
    if (answer.kind !== "envelope") {
      const refused = refusalStateOf(answer, request);
      if (refused !== null) setResultsRead(refused);
      return;
    }
    const body = answer.envelope.data.data;
    if (isImportReceiptView(body)) {
      setResultsRead({ kind: "view", request, envelope: answer.envelope, view: resultsOfReceipt(body) });
      return;
    }
    if (isImportProposalView(body)) {
      setResultsRead(body.inFlight ? { kind: "pending", request } : { kind: "view", request, envelope: answer.envelope, view: resultsOfProposal(body) });
      return;
    }
    setResultsRead({ kind: "unavailable", request, source: answer.envelope.source, guidance: JOURNEY_COPY.unreadableGuidance });
  }, []);
  const resultsView = resultsRead.kind === "view" ? resultsRead.view : null;
  const proposalView = proposalRead.kind === "view" ? proposalRead.view : null;
  const proposalEnvelope = proposalRead.kind === "view" ? proposalRead.envelope : null;
  const { acknowledged, step, acknowledge, goTo, advance, file, mapping, decisions } = journey;
  useEffect(() => {
    if (resultsView === null) return;
    if (!acknowledged) {
      acknowledge();
      return;
    }
    if (step !== "results" && correctionRow === null) goTo("results");
  }, [resultsView, acknowledged, step, acknowledge, goTo, correctionRow]);
  useEffect(() => {
    if (advanceTicket === advanceDone.current) return;
    advanceDone.current = advanceTicket;
    advance();
  }, [advanceTicket, advance]);
  // The address names the import the results state, not the attempt whose read answered: a receipt reports the import it belongs to, so a stop's own attempt identity never replaces the identity the receipt address and the screen both show.
  const shownIdentity = importIdentity ?? (resultsRead.kind === "view" ? resultsRead.view.importOperationId : resultsRead.kind === "pending" ? resultsRead.request.identity : null);
  useEffect(() => {
    if (shownIdentity === null) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(IMPORT_OPERATION_PARAM) === shownIdentity) return;
    url.searchParams.set(IMPORT_OPERATION_PARAM, shownIdentity);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }, [shownIdentity]);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (initialOperationId === undefined) return;
    void Promise.resolve().then(() => readResults({ identity: initialOperationId, page: FIRST_PAGE, pageSize: DEFAULT_PAGE_SIZE }));
  }, [initialOperationId, readResults]);
  const propose = useCallback(
    async (confirmed: ImportConfirmedMapping | null): Promise<ProposalAnswer> => {
      if (file === undefined) return "refused";
      setProposing(true);
      setProposeErrors(null);
      setProposeNotice(null);
      const input: Omit<MutationInput<ProposePayload>, "operationId"> = { scope: currentScope, expectedRevision, payload: confirmed === null ? { fileName: file.fileName, contentBase64: file.contentBase64 } : { fileName: file.fileName, contentBase64: file.contentBase64, confirmedMapping: confirmed } };
      const outcome = await proposeImportRequest<ProposePayload>({ operationId: operationIdFor(intentKeyOf("proposeImport", input)), ...input });
      setProposing(false);
      if (!wasApplied(outcome)) {
        if (outcome.outcome === "invalid") setProposeErrors(fieldErrorsFromInvalid(outcome));
        else setProposeNotice(proposeNoticeOf(outcome));
        return "refused";
      }
      setPaging({ page: FIRST_PAGE, pageSize: paging.pageSize });
      // An `unchanged` answer names no identity it created, because the proposal it answered about already existed: the review to show is the one this journey already knows — named by a proposal read, or reported still in review by an address-opened read — and only a journey that knows of none falls back to the attempt that changed nothing. Every other applied answer names what it created or continued.
      const identity = outcome.outcome === "unchanged" ? (importIdentity ?? inReviewIdentity ?? recordIdentityOf(outcome)) : recordIdentityOf(outcome);
      return readProposal({ identity, page: FIRST_PAGE, pageSize: paging.pageSize });
    },
    [currentScope, expectedRevision, importIdentity, inReviewIdentity, file, operationIdFor, paging.pageSize, readProposal],
  );
  const decide = useCallback(
    async (rowNumber: number, decision: ImportDecisionInput): Promise<void> => {
      setDecidingRow(rowNumber);
      setReviewRefusal(null);
      const input: Omit<MutationInput<ImportDecisionInput>, "operationId"> = { scope: currentScope, expectedRevision: currentRevision, payload: decision };
      const outcome = await setRowDecisionRequest<ImportDecisionInput>({ operationId: operationIdFor(intentKeyOf("setRowDecision", input)), ...input });
      // One row's decision may still be in flight after another row's attempt settled, so only the row whose own attempt settled stops reading as pending.
      setDecidingRow((current) => (current === rowNumber ? null : current));
      if (!wasApplied(outcome)) {
        setReviewRefusal(reviewRefusalOf(outcome, { rowNumber, decision }));
        // A stale revision is read back before the worker decides again: the rows and the revision on screen are then the ones the record now stands at, so the row's own control submits against them instead of a revision the service has already left behind.
        if (outcome.outcome === "conflict" && importIdentity !== null) await readProposal({ identity: importIdentity, page: paging.page, pageSize: paging.pageSize });
        return;
      }
      journey.setDecision(rowNumber, decision);
      if (importIdentity !== null) await readProposal({ identity: importIdentity, page: paging.page, pageSize: paging.pageSize });
    },
    [currentRevision, currentScope, importIdentity, journey, operationIdFor, paging.page, paging.pageSize, readProposal],
  );
  const submitAcceptance = useCallback(
    async (input: MutationInput<AcceptImportRowsPayload>): Promise<MutationOutcome> => {
      const outcome = await acceptImportRowsRequest<AcceptImportRowsPayload>(input);
      if (outcome.outcome === "unknown") {
        setAcceptUnknown(outcome.operationId);
        return outcome;
      }
      setAcceptUnknown(null);
      if (wasApplied(outcome) && importIdentity !== null) await readProposal({ identity: importIdentity, page: paging.page, pageSize: paging.pageSize });
      return outcome;
    },
    [importIdentity, paging.page, paging.pageSize, readProposal],
  );
  const checkAcceptance = useCallback((): void => {
    setAcceptUnknown(null);
    const identity = importIdentity ?? initialOperationId;
    if (identity === undefined) return;
    void readResults({ identity, page: paging.page, pageSize: paging.pageSize });
  }, [importIdentity, initialOperationId, paging.page, paging.pageSize, readResults]);
  const correctRow = (rowNumber: number): void => {
    setCorrectionRow(rowNumber);
    journey.goTo("review");
  };
  const stop = useMemo(
    (): ImportStopControl => ({
      input: { scope: currentScope, expectedRevision: currentRevision, payload: {} satisfies CancelPayload },
      submit: cancelImportRequest<CancelPayload>,
      onSettled: (outcome: MutationOutcome): void => {
        if (wasApplied(outcome)) void readResults({ identity: recordIdentityOf(outcome), page: paging.page, pageSize: paging.pageSize });
      },
    }),
    [currentRevision, currentScope, paging.page, paging.pageSize, readResults],
  );
  const rereadWindow = (next: { readonly page: number; readonly pageSize: number }): void => {
    setPaging(next);
    if (step === "results") {
      if (resultsRead.kind === "view") void readResults({ identity: resultsRead.request.identity, ...next });
    } else if (proposalRead.kind === "view") void readProposal({ identity: proposalRead.request.identity, ...next });
  };
  const changePage = (page: number): void => rereadWindow({ page, pageSize: paging.pageSize });
  const changePageSize = (pageSize: number): void => rereadWindow({ page: FIRST_PAGE, pageSize });
  const startAnother = (): void => {
    setProposalRead({ kind: "idle" });
    setResultsRead({ kind: "idle" });
    setProposeErrors(null);
    setProposeNotice(null);
    setReviewRefusal(null);
    setAcceptUnknown(null);
    setCorrectionRow(null);
    setPaging({ page: FIRST_PAGE, pageSize: paging.pageSize });
    attempts.current.clear();
    const url = new URL(window.location.href);
    if (url.searchParams.has(IMPORT_OPERATION_PARAM)) {
      url.searchParams.delete(IMPORT_OPERATION_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }
    journey.reset();
  };
  const recovered = initialOperationId !== undefined && resultsRead.kind === "view" && resultsRead.request.identity === initialOperationId;
  const completedSteps = STEPS.filter((candidate) => stepIndex(candidate.id) < stepIndex(step) && journey.canOpen(candidate.id)).map((candidate) => candidate.id);
  const stepBody = ((): ReactElement => {
    switch (step) {
      case "choose-file":
        return (
          <div className="flex min-w-0 flex-col gap-4">
            {resultsRead.kind === "pending" ? <StateNotice kind="empty" title={JOURNEY_COPY.reload.inFlightHeading} description={JOURNEY_COPY.reload.inFlightStatement} action={{ label: JOURNEY_COPY.reload.inFlightAction, onClick: startAnother }} /> : null}
            <ReadNotice state={resultsRead} title={stepTitle("results")} onRetry={(request) => void readResults(request)} />
            {proposeNotice === null ? null : <ProposeNoticeBlock notice={proposeNotice} />}
            {proposeRefusal === null ? null : <FormErrorSummary errors={proposeRefusal} title={REFUSAL_FRAMING.title} description={REFUSAL_FRAMING.lead} />}
            {/* A proposal read this step started can be refused, and the worker is standing here when it is: the same notice the map and review steps render is rendered here too, so a follow-up read that names no reachable proposal is never silence on this step. */}
            <ReadNotice state={proposalRead} title={stepTitle(step)} onRetry={(request) => void readProposal(request)} />
            <FileChooser selection={file} onChoose={journey.setFile} onContinue={() => void propose(null).then(advanceOnReview)} />
            {proposing ? <StateNotice kind="loading" title={JOURNEY_COPY.reading} /> : null}
          </div>
        );
      case "map":
        if (proposalView === null || proposalEnvelope === null) return <ReadNotice state={proposalRead} title={stepTitle(step)} onRetry={(request) => void readProposal(request)} fallback={<StateNotice kind="loading" title={JOURNEY_COPY.reading} />} />;
        if (proposalView.review === null) return <StateNotice kind="unavailable" title={stepTitle("map")} description={proposalView.reviewDetail.message} />;
        return (
          <div className="flex min-w-0 flex-col gap-4">
            {proposeNotice === null ? null : <ProposeNoticeBlock notice={proposeNotice} />}
            <StepMapping
              proposal={{ ...proposalEnvelope, data: { ...proposalView.record, suggestion: proposalView.review.suggestion } }}
              confirmedMapping={mapping ?? null}
              submitting={proposing}
              fieldErrors={proposeErrors}
              onConfirm={(confirmed) => {
                journey.setMapping(confirmed);
                void propose(confirmed).then(advanceOnReview);
              }}
            />
          </div>
        );
      case "review":
        if (proposalView === null || proposalEnvelope === null) return <ReadNotice state={proposalRead} title={stepTitle(step)} onRetry={(request) => void readProposal(request)} fallback={<StateNotice kind="loading" title={JOURNEY_COPY.reading} />} />;
        return (
          <StepReview
            proposal={{ ...proposalEnvelope, data: proposalView }}
            decisions={decisions}
            window={proposalView.rowWindow}
            onPageChange={changePage}
            onPageSizeChange={changePageSize}
            onDecide={(rowNumber, decision) => void decide(rowNumber, decision)}
            decidingRowNumber={decidingRow}
            refusal={reviewRefusal}
            focusRowNumber={correctionRow}
            onContinue={() => {
              setCorrectionRow(null);
              journey.goTo("accept");
            }}
            stop={stop}
          />
        );
      case "accept":
        if (proposalView === null || proposalEnvelope === null) return <ReadNotice state={proposalRead} title={stepTitle(step)} onRetry={(request) => void readProposal(request)} fallback={<StateNotice kind="loading" title={JOURNEY_COPY.reading} />} />;
        if (proposalView.review === null) return <StateNotice kind="unavailable" title={stepTitle("accept")} description={proposalView.reviewDetail.message} />;
        const acceptInput: StepAcceptanceProps["input"] = { scope: currentScope, expectedRevision: currentRevision, payload: { acknowledged: true, fileFingerprint: proposalView.fileFingerprint, decisions: Object.values(decisions) } };
        return (
          <div className="flex min-w-0 flex-col gap-4">
            <StepAcceptance key={journey.acceptIntentKey} summary={proposalView.summary} input={acceptInput} submit={submitAcceptance} decidedRowCount={Object.values(decisions).length} onCancel={() => journey.goTo("review")} />
            {acceptUnknown === null ? null : <StateNotice kind="unknown" title={JOURNEY_COPY.unknownAccept.title} description={JOURNEY_COPY.unknownAccept.statement} operationId={acceptUnknown} retry={{ label: JOURNEY_COPY.checkAcceptanceLabel, onClick: checkAcceptance }} />}
            {resultsRead.kind === "pending" ? (
              <Alert>
                <AlertTitle>{JOURNEY_COPY.acceptCheck.inFlightTitle}</AlertTitle>
                <AlertDescription>
                  <p className="type-supporting">{JOURNEY_COPY.acceptCheck.inFlightStatement}</p>
                </AlertDescription>
              </Alert>
            ) : null}
            <ReadNotice state={resultsRead} title={stepTitle("results")} onRetry={(request) => void readResults(request)} />
          </div>
        );
      case "results":
        if (resultsView === null) return <ReadNotice state={resultsRead} title={stepTitle("results")} onRetry={(request) => void readResults(request)} fallback={<StateNotice kind="loading" title={JOURNEY_COPY.reading} />} />;
        return <StepResults results={resultsView} recovered={recovered} onPageChange={changePage} onPageSizeChange={changePageSize} stop={stop} onStartAnother={startAnother} onCorrection={journey.canOpen("review") ? correctRow : undefined} />;
    }
  })();
  function advanceOnReview(answered: ProposalAnswer): void {
    if (answered === "review") setAdvanceTicket((ticket) => ticket + 1);
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ImportStepper current={step} completed={completedSteps} onReopen={journey.goTo} />
      <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="type-supporting">{stepLabel(step)}</p>
          <h2 id={headingId} className="type-section-title text-balance">
            {stepTitle(step)}
          </h2>
        </div>
        {stepBody}
      </section>
    </div>
  );
}
