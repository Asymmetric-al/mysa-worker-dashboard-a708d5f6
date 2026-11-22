"use client";
/**
 * The contact-import journey's one container: the five steps, the transport that carries each change,
 * the operation identity every change is made under, and the reads that keep the surface in step with
 * what the service recorded.
 *
 * **What owns what.** The position in the journey and the work each step has been handed belong to
 * `useImportJourney`; this file owns nothing that belongs there. What it does own is the seam: each named
 * change goes through `features/import/client`, every read through the same module, and each change
 * presents the four-field contract — the attempt's `operationId`, the context's `scope`, the revision the
 * caller saw, and the caller's own payload. The journey records where the worker stands; the identity of
 * each attempt is minted once per intent by the surface that sends it — this container for the proposal
 * and the row decision it posts itself, and the shared review step for the acceptance and the
 * cancellation it composes — so pressing the same control again replays one attempt instead of starting a
 * second, and a changed intent is a new attempt with its own identity.
 *
 * **Why the read body is narrowed here.** The transport answers with the read envelope the service built,
 * whose `data` stays `unknown` because the proposal and the receipt are the service's records and not this
 * file's shapes to declare. This container therefore checks the members the surface actually reads and
 * reports anything else as an outage: a body it does not recognise is never rendered as an empty review,
 * an empty result or a zero, and it is never cast into agreement with a shape it has not been checked
 * against.
 *
 * **What happens after an acknowledgement is lost.** An `unknown` answer is neither a failure nor a
 * success. The acceptance remembers the attempt it submitted and offers to check that same operation,
 * which reads back what happened and applies nothing; uncertainty is therefore resolved by re-reading the
 * same operation and never by sending the work again. A refusal keeps its own closed reason: a denied
 * request renders its reason code, an unavailable one its source, an invalid one the service's own field
 * messages, and a conflict the fact that the review moved.
 *
 * **What a reload can and cannot resume.** This page's address may name an operation. A completed one
 * opens the results, which is the same operation read back rather than a second import. One still in
 * review cannot be resumed, because the browser does not keep the chosen file across a reload: the
 * surface says so and offers the first step again instead of pretending to resume a review it cannot
 * finish.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { FormErrorSummary, fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatSourceReference, newOperationId, type SourceReference } from "@/lib/ids";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import type { ImportRowState, MutationInput, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { DenialReason, MutationOutcome, ReadResult } from "@/modules/data-service/outcome";
import type { ImportProposalRowRoute, ImportProposalView, ImportReceiptView } from "@/modules/data-service/reads/import";
import type { ImportDecisionInput } from "@/modules/import/decide";
import type { ImportConfirmedMapping } from "@/modules/import/map";
import type { ImportResultRoute, ImportRowResultState } from "@/modules/import/receipt";
import { acceptImportRowsRequest, cancelImportRequest, fetchImportProposal, fetchImportReceipt, proposeImportRequest, setRowDecisionRequest, type ImportReadEnvelope } from "../client";
import { IMPORT_OPERATION_PARAM, JOURNEY_COPY, REFUSAL_FRAMING, STEPS, stepIndex, stepLabel, stepTitle } from "../copy";
import { useImportJourney } from "../hooks/use-import-journey";
import type { AcceptImportRowsPayload, CancelPayload } from "../schemas/acceptance";
import FileChooser from "./file-chooser";
import ImportStepper from "./import-stepper";
import StepAcceptance from "./step-acceptance";
import StepMapping from "./step-mapping";
import StepResults, { type ImportResultsRow, type ImportResultsView } from "./step-results";
import StepReview, { type ImportStopControl, type StepReviewRefusal } from "./step-review";
// Fixed values: the first window this container asks for, in the sizes the read's paging documents
const FIRST_PAGE = 1;

const DEFAULT_PAGE_SIZE = 50;
/** The payload one proposal presents: the chosen file, and — on the journey's second call — the mapping the worker confirmed. */
interface ProposePayload {
  readonly fileName: string;
  readonly contentBase64: string;
  readonly confirmedMapping?: ImportConfirmedMapping;
}
// ---------------------------------------------------------------------------------------------
// What one read answered, in the shapes this surface reads
// ---------------------------------------------------------------------------------------------
/** The window one read was asked for, kept so a refusal can be retried and a page change re-read the same operation. */
interface ReadRequest {
  readonly identity: string;
  readonly page: number;
  readonly pageSize: number;
}
/** What a proposal read found: a reviewable proposal, the completed operation it names, or nothing usable. */
type ProposalAnswer = "review" | "results" | "refused";
/** The proposal read's state: the reviewable proposal, its refusal, or the outage that replaced it. */
type ProposalRead =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly request: ReadRequest }
  | { readonly kind: "view"; readonly request: ReadRequest; readonly envelope: ReadEnvelope<ImportReadEnvelope>; readonly view: ImportProposalView }
  | { readonly kind: "denied"; readonly request: ReadRequest; readonly reasonCode: DenialReason }
  | { readonly kind: "refused"; readonly request: ReadRequest; readonly errors: FieldErrorLookup }
  | { readonly kind: "unavailable"; readonly request: ReadRequest; readonly source: SourceReference; readonly guidance: string };
/** The result read's state: the completed operation, a refusal, an outage, or the fact that it has produced no result yet. */
type ResultsRead =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly request: ReadRequest }
  | { readonly kind: "view"; readonly request: ReadRequest; readonly results: ImportResultsView }
  | { readonly kind: "pending"; readonly request: ReadRequest }
  | { readonly kind: "denied"; readonly request: ReadRequest; readonly reasonCode: DenialReason }
  | { readonly kind: "refused"; readonly request: ReadRequest; readonly errors: FieldErrorLookup }
  | { readonly kind: "unavailable"; readonly request: ReadRequest; readonly source: SourceReference; readonly guidance: string };
/** A refusal a proposal answered with, in the closed vocabulary the service uses. */
type ProposeNotice = { readonly kind: "denied"; readonly reasonCode: DenialReason } | { readonly kind: "unavailable"; readonly source: SourceReference; readonly guidance: string } | { readonly kind: "conflict" } | { readonly kind: "unknown"; readonly operationId: string };
/** The title and lead each proposal refusal is read under, kept in the family's own wording. */
const PROPOSE_NOTICE_COPY: Readonly<Record<ProposeNotice["kind"], { readonly title: string; readonly lead: string }>> = {
  denied: { title: JOURNEY_COPY.proposeRefused.deniedTitle, lead: JOURNEY_COPY.proposeRefused.deniedLead },
  unavailable: { title: JOURNEY_COPY.proposeRefused.unavailableTitle, lead: JOURNEY_COPY.proposeRefused.unavailableLead },
  conflict: { title: JOURNEY_COPY.proposeRefused.conflictTitle, lead: JOURNEY_COPY.proposeRefused.conflictLead },
  unknown: { title: JOURNEY_COPY.proposeRefused.unknownTitle, lead: JOURNEY_COPY.proposeRefused.unknownLead },
};
/**
 * Reports whether a body carries a proposal view: the operation's own identity, whether it is still in
 * flight, the revision the next write must present, and the file, summary, window, rows, stored record
 * and review material the map, review and results steps read. A body missing any of them is not a
 * proposal this surface can render.
 */
function isImportProposalView(value: unknown): value is ImportProposalView {
  return (
    isRecord(value) &&
    isNonEmptyString(value.importOperationId) &&
    typeof value.inFlight === "boolean" &&
    typeof value.revision === "string" &&
    isRecord(value.file) &&
    isRecord(value.summary) &&
    isRecord(value.rowWindow) &&
    Array.isArray(value.rows) &&
    isRecord(value.record) &&
    (value.review === null || isRecord(value.review))
  );
}
/**
 * Reports whether a body carries a receipt view: the operation's processed instant and revision, the file,
 * the per-state counts, the summary, the rows and the window, and whether a cancellation followed it.
 */
function isImportReceiptView(value: unknown): value is ImportReceiptView {
  return (
    isRecord(value) && isNonEmptyString(value.importOperationId) && isNonEmptyString(value.processedAt) && typeof value.revision === "string" && isRecord(value.file) && isRecord(value.counts) && isRecord(value.summary) && Array.isArray(value.rows) && isRecord(value.rowWindow) && typeof value.cancelled === "boolean"
  );
}
/**
 * The rows a stop would still stop: everything this import neither applied nor already left out.
 *
 * The stored proposal's own per-row results are the one global statement of what became of each row, so the
 * count is taken from them: an applied row (`accepted`, `already-accepted`) and a row the import already
 * left out (`skipped`, which is also what a cancellation records) are settled, and every other row — one
 * the acceptance left needing review, one that failed, or one nothing was recorded for — is a row a stop
 * would still reach. The summary's `needsReview` is not this count: it numbers the review's open problems,
 * which is why a file of twenty-five rows can report more of them than it has rows.
 */
function stoppableRowCount(view: ImportProposalView): number {
  let settled = 0;
  for (const result of view.record.results) {
    if (result.state === "accepted" || result.state === "already-accepted" || result.state === "skipped") {
      settled += 1;
    }
  }
  return Math.max(0, view.file.rowCount - settled);
}
/**
 * The per-state counts a proposal's own stored results state.
 *
 * A proposal read by the import's own identity states no `counts` object, yet its stored per-row results are
 * this import's one global statement of what became of each row, so the counts are taken from them: without
 * this, a reload of the import's own address would show the per-row outcomes but lose the accepted, skipped,
 * needs-review and failed totals the surface showed before the reload. An operation that has recorded no
 * result yet — one still in review — states none rather than a set of zeros.
 */
function stateCountsOfResults(results: ImportProposalView["record"]["results"]): Readonly<Record<ImportRowState, number>> | null {
  if (results.length === 0) {
    return null;
  }
  const counts: Record<ImportRowState, number> = { accepted: 0, "already-accepted": 0, skipped: 0, "needs-review": 0, failed: 0 };
  for (const result of results) {
    counts[result.state] += 1;
  }
  return counts;
}
/** The completed proposal as the results step renders it, with the per-state counts its stored results state. */
function resultsOfProposal(view: ImportProposalView): ImportResultsView {
  const rows: readonly ImportResultsRow[] = view.rows.map((row) => ({ rowNumber: row.rowNumber, decisionLabel: row.decisionLabel, state: row.state, stateLabel: row.stateLabel, reason: row.reason, route: row.route }));
  return {
    importOperationId: view.importOperationId,
    file: { name: view.file.name, bytes: view.file.bytes, rowCount: view.file.rowCount, columnCount: view.file.columnCount },
    summary: { create: view.summary.create, reuse: view.summary.reuse, skip: view.summary.skip, unresolved: view.summary.unresolved, rowCount: view.summary.rowCount },
    rows,
    rowWindow: view.rowWindow,
    stoppableRows: stoppableRowCount(view),
    stateCounts: stateCountsOfResults(view.record.results),
  };
}
/**
 * Where one receipt row leads, in the shape the results step renders. A receipt names the record it
 * applied a row to by the reference the store issued for it, and that reference's own record identifier is
 * what the record's destination is addressed by — the same projection the proposal's route already makes.
 */
function routeOfReceipt(route: ImportResultRoute | null): ImportProposalRowRoute | null {
  if (route === null) {
    return null;
  }
  return route.kind === "partner" ? { kind: "partner", partnerId: route.partnerRef.reference } : { kind: "correction", rowNumber: route.rowNumber };
}
/** The receipt as the results step renders it: the same projection, with the per-state counts the receipt states. */
function resultsOfReceipt(view: ImportReceiptView): ImportResultsView {
  const stateCounts: Record<ImportRowResultState, number> = { accepted: view.counts.accepted, "already-accepted": view.counts.alreadyAccepted, skipped: view.counts.skipped, "needs-review": view.counts.needsReview, failed: view.counts.failed };
  const rows: readonly ImportResultsRow[] = view.rows.map((row) => ({ rowNumber: row.rowNumber, decisionLabel: row.decisionLabel, state: row.state, stateLabel: row.stateLabel, reason: row.reason, route: routeOfReceipt(row.route) }));
  return {
    importOperationId: view.importOperationId,
    file: { name: view.file.name, bytes: view.file.bytes, rowCount: view.file.rowCount, columnCount: view.file.columnCount },
    summary: { create: view.summary.create, reuse: view.summary.reuse, skip: view.summary.skip, unresolved: view.summary.unresolved, rowCount: view.summary.rowCount },
    rows,
    rowWindow: view.rowWindow,
    // A receipt states the same fact per state, so the rows a stop would still reach are the ones it left
    // needing review and the ones that failed: neither carries an applied result and neither was left out.
    stoppableRows: view.counts.needsReview + view.counts.failed,
    stateCounts,
  };
}
/**
 * A refused proposal as the file-level summary step one renders: the service's messages stated once, in its
 * own words.
 *
 * The proposal's own members are the file and that file's name, and neither is a control on the choose-file
 * step. Keying the summary by a payload path would print that path as the label and offer a link to a control
 * that is not on the page, so the messages become the summary's form-level entries, which it shows without a
 * target, and nothing about the refusal is renamed or dropped.
 */
function fileRefusalSummary(errors: FieldErrorLookup): FieldErrorLookup {
  const messages = [...errors.form, ...Object.values(errors.byField).flat()];
  return { byField: {}, form: messages, count: messages.length };
}
/**
 * The canonical key of one intent: the change's own name with the whole four-field input it presents, less
 * the attempt identity this key is used to mint. A context or a revision that has moved is therefore a
 * different intent and gets its own attempt, instead of presenting a changed intent under an identity the
 * service already recorded — which it would refuse as a conflict and rightly so.
 */
function intentKeyOf(command: string, input: Omit<MutationInput<unknown>, "operationId">): string {
  return JSON.stringify([command, input.scope, input.expectedRevision, input.payload]);
}
/** Whether a read asks for the window a state already shows, in which case the state stays on screen while it is read again. */
function isSameWindow(state: ProposalRead | ResultsRead, request: ReadRequest): boolean {
  return (state.kind === "view" || state.kind === "pending") && state.request.identity === request.identity && state.request.page === request.page && state.request.pageSize === request.pageSize;
}
/** Whether the change was applied once or replayed, which is the only pair of answers a follow-up read is owed for. */
function wasApplied(outcome: MutationOutcome): boolean {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
}
/** The refusal a proposal answered with, or `null` when it was applied (once, or as a replay). */
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
/** The refusal a row decision answered with, in the closed vocabulary the review step renders in place. */
function reviewRefusalOf(outcome: MutationOutcome): StepReviewRefusal | null {
  switch (outcome.outcome) {
    case "invalid":
      return { kind: "invalid", errors: fieldErrorsFromInvalid(outcome) };
    case "denied":
      return { kind: "denied", reasonCode: outcome.reasonCode };
    case "conflict":
      return { kind: "conflict" };
    case "unavailable":
      return { kind: "unavailable", source: outcome.source, guidance: outcome.guidance };
    case "unknown":
      return { kind: "unknown", operationId: outcome.operationId };
    default:
      return null;
  }
}
/**
 * The identity a change answered with, which is the identity its result is recorded under: the operation a
 * proposal created (or continued), and — for a change that creates no operation of its own, such as a
 * cancellation — the attempt it was made under.
 */
function recordIdentityOf(outcome: MutationOutcome): string {
  if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") {
    const created = outcome.created?.[0];
    if (created !== undefined && created !== "") {
      return created;
    }
  }
  return outcome.operationId;
}
/** The proposal refusal rendered where it happened: never as a success, never as an empty review. */
function ProposeNoticeBlock({ notice }: { readonly notice: ProposeNotice }): ReactElement {
  const copy = PROPOSE_NOTICE_COPY[notice.kind];
  return (
    <Alert variant={notice.kind === "denied" ? "destructive" : "default"}>
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>
        <p>{copy.lead}</p>
        {notice.kind === "denied" ? (
          <p>
            Reason <bdi className="mono-identifier">{notice.reasonCode}</bdi>.
          </p>
        ) : null}
        {notice.kind === "unavailable" ? (
          <p>
            Source <bdi className="mono-identifier">{formatSourceReference(notice.source)}</bdi>. {notice.guidance}
          </p>
        ) : null}
        {notice.kind === "unknown" ? (
          <p>
            Operation <bdi className="mono-identifier">{notice.operationId}</bdi>.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
/**
 * A read the service refused, rendered where the step is: the service's own field messages, phrased under the
 * family's refusal framing and never as an empty review or a zero count, with the read offered again because a
 * read changes nothing.
 */
function ReadRefusalBlock({ errors, onRetry }: { readonly errors: FieldErrorLookup; readonly onRetry: () => void }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col items-start gap-3">
      <FormErrorSummary errors={errors} title={JOURNEY_COPY.readRefused.title} description={JOURNEY_COPY.readRefused.lead} />
      <Button type="button" variant="outline" onClick={onRetry}>
        {JOURNEY_COPY.retryReadLabel}
      </Button>
    </div>
  );
}
/** Props of {@link ImportJourney}. */
export interface ImportJourneyProps {
  /** The context this page was admitted in, which every change presents before a read has answered. */
  readonly scope: Scope;
  /** The revision this page was admitted at, which the first proposal presents because a proposal compares no stored revision. */
  readonly expectedRevision: string;
  /** The operation this page's own address named, if any: a completed one opens its results, one in review is reported as such. */
  readonly initialOperationId?: string;
}
/** The five-step contact-import journey: the steps, the transport and the identity of every attempt. */
export default function ImportJourney({ scope, expectedRevision, initialOperationId }: ImportJourneyProps): ReactElement {
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
  // The row the worker asked to go back to from the results step: the review step opens its window at that
  // row, so the return lands on the row the service said still needs a decision instead of the top of a
  // window the worker then has to search.
  const [correctionRow, setCorrectionRow] = useState<number | null>(null);
  // One summary object per refusal, so the shared summary announces and focuses it once rather than on every
  // render of the step.
  const proposeRefusal = useMemo(() => (proposeErrors === null ? null : fileRefusalSummary(proposeErrors)), [proposeErrors]);
  // A ticket counts the reads that have asked the journey to move on; the effect below performs one move
  // per ticket, because the guard that admits the next step reads state a dispatch only applies on the
  // following render.
  const [advanceTicket, setAdvanceTicket] = useState(0);
  const attempts = useRef<Map<string, string>>(new Map());
  const latestRequest = useRef(0);
  const mounted = useRef(false);
  const advanceDone = useRef(0);
  /**
   * The attempt identity of one intent, minted once and kept: the same intent replays the same attempt,
   * and a changed intent — another file, another mapping, another decision about a row — is a new one.
   */
  const operationIdFor = useCallback((intent: string): string => {
    const known = attempts.current.get(intent);
    if (known !== undefined) {
      return known;
    }
    const minted = newOperationId();
    attempts.current.set(intent, minted);
    return minted;
  }, []);
  const latestEnvelope = proposalRead.kind === "view" ? proposalRead.envelope : null;
  // The context and the revision every change presents: the page's own until a read has answered, and the
  // read's afterwards, because the read is what knows the revision the service will compare against.
  const currentScope = latestEnvelope === null ? scope : latestEnvelope.scope;
  const currentRevision = latestEnvelope === null ? expectedRevision : latestEnvelope.revision;
  // The operation this surface is reviewing, once a read has named it: every later write presents its
  // revision, and every follow-up read asks for it by its own identity.
  const importIdentity = proposalRead.kind === "view" ? proposalRead.request.identity : null;
  const readProposal = useCallback(async (request: ReadRequest): Promise<ProposalAnswer> => {
    latestRequest.current += 1;
    const fence = latestRequest.current;
    // A re-read of the window already on screen keeps the rows visible until its answer arrives, so a
    // recorded decision updates the row it changed instead of replacing the table with a loading state. A
    // read of another window, or of another operation, states that it is reading.
    setProposalRead((previous) => (isSameWindow(previous, request) ? previous : { kind: "reading", request }));
    const answer: ReadResult<ReadEnvelope<ImportReadEnvelope>> = await fetchImportProposal(request.identity, { page: request.page, pageSize: request.pageSize });
    if (fence !== latestRequest.current) {
      return "refused";
    }
    switch (answer.kind) {
      case "denied":
        setProposalRead({ kind: "denied", request, reasonCode: answer.denied.reasonCode });
        return "refused";
      case "unavailable":
        setProposalRead({ kind: "unavailable", request, source: answer.unavailable.source, guidance: answer.unavailable.guidance });
        return "refused";
      case "refused":
        // The request itself was not accepted, so no review and no result was read. The service's own field
        // messages are shown in place, and the same window can be read again: a read changes nothing.
        setProposalRead({ kind: "refused", request, errors: fieldErrorsFromInvalid(answer.refused) });
        return "refused";
      case "envelope": {
        const body = answer.envelope.data.data;
        if (isImportProposalView(body)) {
          setProposalRead({ kind: "view", request, envelope: answer.envelope, view: body });
          if (!body.inFlight) {
            // The operation has finished, so the same identity answers its own result rather than a review.
            setResultsRead({ kind: "view", request, results: resultsOfProposal(body) });
            return "results";
          }
          return "review";
        }
        if (isImportReceiptView(body)) {
          setResultsRead({ kind: "view", request, results: resultsOfReceipt(body) });
          setProposalRead({ kind: "idle" });
          return "results";
        }
        setProposalRead({ kind: "unavailable", request, source: answer.envelope.source, guidance: JOURNEY_COPY.unreadableGuidance });
        return "refused";
      }
    }
  }, []);
  const readResults = useCallback(async (request: ReadRequest): Promise<void> => {
    latestRequest.current += 1;
    const fence = latestRequest.current;
    setResultsRead((previous) => (isSameWindow(previous, request) ? previous : { kind: "reading", request }));
    const answer: ReadResult<ReadEnvelope<ImportReadEnvelope>> = await fetchImportReceipt(request.identity, { page: request.page, pageSize: request.pageSize });
    if (fence !== latestRequest.current) {
      return;
    }
    switch (answer.kind) {
      case "denied":
        setResultsRead({ kind: "denied", request, reasonCode: answer.denied.reasonCode });
        return;
      case "unavailable":
        setResultsRead({ kind: "unavailable", request, source: answer.unavailable.source, guidance: answer.unavailable.guidance });
        return;
      case "refused":
        setResultsRead({ kind: "refused", request, errors: fieldErrorsFromInvalid(answer.refused) });
        return;
      case "envelope": {
        const body = answer.envelope.data.data;
        if (isImportReceiptView(body)) {
          setResultsRead({ kind: "view", request, results: resultsOfReceipt(body) });
          return;
        }
        if (isImportProposalView(body)) {
          // A proposal still in flight has produced no result, which is a different fact from a refused
          // read: the operation exists, and nothing of it has been applied yet.
          setResultsRead(body.inFlight ? { kind: "pending", request } : { kind: "view", request, results: resultsOfProposal(body) });
          return;
        }
        setResultsRead({ kind: "unavailable", request, source: answer.envelope.source, guidance: JOURNEY_COPY.unreadableGuidance });
        return;
      }
    }
  }, []);
  // A completed operation opens its results: the acknowledgement is what the results step's own guard asks
  // for, and both dispatches happen across two renders so each guard sees the state it needs.
  const resultsView = resultsRead.kind === "view" ? resultsRead.results : null;
  const acknowledged = journey.acknowledged;
  const step = journey.step;
  const acknowledge = journey.acknowledge;
  const goTo = journey.goTo;
  useEffect(() => {
    if (resultsView === null) {
      return;
    }
    if (!acknowledged) {
      acknowledge();
      return;
    }
    // A completed operation opens its results — except while the worker is deliberately back inside the journey.
    // The results step's own correction route reopens the review at a row, and bouncing that navigation straight
    // back to the receipt would make the route look like it did nothing. The marker is cleared the moment the
    // worker moves forward again, so the next completed acceptance opens its result as usual.
    if (step !== "results" && correctionRow === null) {
      goTo("results");
    }
  }, [resultsView, acknowledged, step, acknowledge, goTo, correctionRow]);
  // A step whose work has just been recorded opens once the journey holds that work, because the guard
  // that admits the next step reads the state a dispatch only applies on the following render.
  const advance = journey.advance;
  useEffect(() => {
    if (advanceTicket === advanceDone.current) {
      return;
    }
    advanceDone.current = advanceTicket;
    advance();
  }, [advanceTicket, advance]);
  // The address keeps the identity of the import this surface is showing, so a reload restores that one
  // operation — its results once it has finished, or the fact that its review cannot be resumed here — instead
  // of quietly returning to the first step. The current history entry is replaced rather than a new one pushed,
  // so Back still returns to wherever the worker came from and not to an earlier step of this same journey.
  // The identity the address states is the import's own, which the proposal read is what names: a cancellation
  // or a row decision creates no operation of its own, so the identity such a change answers with is the attempt
  // it was made under, and the receipt read back by that attempt is not the address a worker's reload should
  // name. Only a page that opened on an identity — and read its receipt without a proposal — has no proposal to
  // name, and then the identity it read is the one its address already carries.
  const shownIdentity = importIdentity ?? (resultsRead.kind === "view" ? resultsRead.request.identity : null);
  useEffect(() => {
    if (shownIdentity === null) {
      // Nothing is on screen yet — an address that names an operation is being read, or nothing was opened —
      // so the parameter the address already carries is left exactly as it arrived.
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get(IMPORT_OPERATION_PARAM) === shownIdentity) {
      return;
    }
    url.searchParams.set(IMPORT_OPERATION_PARAM, shownIdentity);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }, [shownIdentity]);
  // The address may name an operation: it is read once, and a completed one is the result this page shows.
  useEffect(() => {
    if (mounted.current) {
      return;
    }
    mounted.current = true;
    if (initialOperationId === undefined) {
      return;
    }
    // The read is started once the effect has returned: it is a request, and the state it answers with is
    // set when the answer arrives rather than during this render's commit.
    void Promise.resolve().then(() => readResults({ identity: initialOperationId, page: FIRST_PAGE, pageSize: DEFAULT_PAGE_SIZE }));
  }, [initialOperationId, readResults]);
  /**
   * Proposes the chosen file — with the mapping the worker confirmed, once there is one — and reads the
   * proposal it answers with. The attempt identity is minted once per intent, so choosing the same file
   * again replays that attempt instead of starting a second import.
   */
  const propose = useCallback(
    async (mapping: ImportConfirmedMapping | null): Promise<ProposalAnswer> => {
      const file = journey.file;
      if (file === undefined) {
        return "refused";
      }
      setProposing(true);
      setProposeErrors(null);
      setProposeNotice(null);
      // A proposal compares no stored revision — it starts, continues or replaces a review nothing has been
      // applied from — so it presents the revision this page was admitted at. That value is stable across a
      // repeated press, which is what makes the repeat the same intent and therefore the same attempt.
      const input: Omit<MutationInput<ProposePayload>, "operationId"> = { scope: currentScope, expectedRevision, payload: mapping === null ? { fileName: file.fileName, contentBase64: file.contentBase64 } : { fileName: file.fileName, contentBase64: file.contentBase64, confirmedMapping: mapping } };
      const outcome = await proposeImportRequest<ProposePayload>({ operationId: operationIdFor(intentKeyOf("proposeImport", input)), ...input });
      setProposing(false);
      if (!wasApplied(outcome)) {
        if (outcome.outcome === "invalid") {
          setProposeErrors(fieldErrorsFromInvalid(outcome));
        } else {
          setProposeNotice(proposeNoticeOf(outcome));
        }
        return "refused";
      }
      setPaging({ page: FIRST_PAGE, pageSize: paging.pageSize });
      return readProposal({ identity: recordIdentityOf(outcome), page: FIRST_PAGE, pageSize: paging.pageSize });
    },
    [currentScope, expectedRevision, journey.file, operationIdFor, paging.pageSize, readProposal],
  );
  const decide = useCallback(
    async (rowNumber: number, decision: ImportDecisionInput): Promise<void> => {
      setDecidingRow(rowNumber);
      setReviewRefusal(null);
      const input: Omit<MutationInput<ImportDecisionInput>, "operationId"> = { scope: currentScope, expectedRevision: currentRevision, payload: decision };
      const outcome = await setRowDecisionRequest<ImportDecisionInput>({ operationId: operationIdFor(intentKeyOf("setRowDecision", input)), ...input });
      setDecidingRow(null);
      if (!wasApplied(outcome)) {
        setReviewRefusal(reviewRefusalOf(outcome));
        return;
      }
      // The decision is recorded, so the journey holds it and the review is read back for the revision the
      // next change must present. The row decision creates no operation of its own, so the identity the
      // read asks for is the import's.
      journey.setDecision(rowNumber, decision);
      if (importIdentity === null) {
        return;
      }
      await readProposal({ identity: importIdentity, page: paging.page, pageSize: paging.pageSize });
    },
    [currentRevision, currentScope, importIdentity, journey, operationIdFor, paging.page, paging.pageSize, readProposal],
  );
  /**
   * The acceptance's submit. The shared review step mints the attempt identity and owns the outcome it
   * renders; this observes the same outcome so the surface can read the operation back — and so a lost
   * acknowledgement is remembered as the identity a check can be made against.
   */
  const submitAcceptance = useCallback(
    async (input: MutationInput<AcceptImportRowsPayload>): Promise<MutationOutcome> => {
      const outcome = await acceptImportRowsRequest<AcceptImportRowsPayload>(input);
      if (outcome.outcome === "unknown") {
        setAcceptUnknown(outcome.operationId);
        return outcome;
      }
      setAcceptUnknown(null);
      if (wasApplied(outcome) && importIdentity !== null) {
        await readProposal({ identity: importIdentity, page: paging.page, pageSize: paging.pageSize });
      }
      return outcome;
    },
    [importIdentity, paging.page, paging.pageSize, readProposal],
  );
  /**
   * Checks the same operation the acceptance submitted: the import is read back under its own identity,
   * which resolves the uncertainty and applies nothing. A review that is still in flight says the
   * acceptance applied nothing, and its replay is the way forward.
   */
  const checkAcceptance = useCallback((): void => {
    setAcceptUnknown(null);
    const identity = importIdentity ?? initialOperationId;
    if (identity === undefined) {
      return;
    }
    // The result read answers a proposal that is still in flight as `pending`, which is what tells this
    // surface the acceptance applied nothing, and a completed operation as its own result.
    void readResults({ identity, page: paging.page, pageSize: paging.pageSize });
  }, [importIdentity, initialOperationId, paging.page, paging.pageSize, readResults]);
  /**
   * Returns the journey to the review step at one row the acceptance did not apply.
   *
   * It is a step of this journey rather than a destination, because the chosen file, the confirmed mapping and
   * every decision recorded so far are the journey's own state: reopening the step keeps all of them, where
   * navigating away would discard the work the route exists to take the worker back to. The row is handed on
   * so the review step can put the worker at it, and nothing is re-read here — the review was read for this
   * import already, and a read is not needed to reopen a step whose material is still in hand.
   */
  const correctRow = (rowNumber: number): void => {
    setCorrectionRow(rowNumber);
    journey.goTo("review");
  };
  /** The stop control: the shared review step mints the attempt, and the cancellation's own receipt is read back. */
  const stop = useMemo(
    (): ImportStopControl => ({
      input: { scope: currentScope, expectedRevision: currentRevision, payload: {} satisfies CancelPayload },
      submit: cancelImportRequest<CancelPayload>,
      onSettled: (outcome: MutationOutcome): void => {
        if (!wasApplied(outcome)) {
          return;
        }
        void readResults({ identity: recordIdentityOf(outcome), page: paging.page, pageSize: paging.pageSize });
      },
    }),
    [currentRevision, currentScope, paging.page, paging.pageSize, readResults],
  );
  const rereadWindow = (next: { readonly page: number; readonly pageSize: number }): void => {
    setPaging(next);
    // The step on screen decides which read is paged, not the order the reads happened in: a finished import
    // leaves the proposal and the result both holding a view, so paging by "whichever answered last" would
    // page the surface the worker is not on and leave the one they are on showing its old window.
    if (journey.step === "results") {
      if (resultsRead.kind === "view") {
        void readResults({ identity: resultsRead.request.identity, ...next });
      }
      return;
    }
    if (proposalRead.kind === "view") {
      void readProposal({ identity: proposalRead.request.identity, ...next });
    }
  };
  const changePage = (page: number): void => {
    rereadWindow({ page, pageSize: paging.pageSize });
  };
  const changePageSize = (pageSize: number): void => {
    rereadWindow({ page: FIRST_PAGE, pageSize });
  };
  const startAnother = (): void => {
    setProposalRead({ kind: "idle" });
    setResultsRead({ kind: "idle" });
    setProposeErrors(null);
    setProposeNotice(null);
    setReviewRefusal(null);
    setAcceptUnknown(null);
    setCorrectionRow(null);
    setPaging({ page: FIRST_PAGE, pageSize: paging.pageSize });
    // A finished import's attempts are spent: the identities this page minted named operations that are
    // already recorded, so a file chosen again after this control has to be proposed under a fresh identity
    // rather than replayed as the import that just finished. Nothing is lost — every finished operation keeps
    // its own result, read back by the identity it was recorded under.
    attempts.current.clear();
    // The address names the operation this surface was showing, and it is showing none of them now: the bare
    // route is what a reload of this screen means, and the finished import stays recoverable under its own
    // identity for as long as the worker keeps the address that names it.
    const url = new URL(window.location.href);
    if (url.searchParams.has(IMPORT_OPERATION_PARAM)) {
      url.searchParams.delete(IMPORT_OPERATION_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }
    journey.reset();
  };
  // The result on the page is the one this page's address named only while that is the operation being
  // shown; a result reached by accepting here is not a recovery, and says nothing about the address.
  const recovered = initialOperationId !== undefined && resultsRead.kind === "view" && resultsRead.request.identity === initialOperationId;
  const completedSteps = STEPS.filter((candidate) => stepIndex(candidate.id) < stepIndex(journey.step) && journey.canOpen(candidate.id)).map((candidate) => candidate.id);
  const proposalStepNotice: ReactElement | null = ((): ReactElement | null => {
    switch (proposalRead.kind) {
      case "reading":
        return <StateNotice kind="loading" title={JOURNEY_COPY.reading} />;
      case "denied":
        return <StateNotice kind="denied" title={stepTitle(journey.step)} reasonCode={proposalRead.reasonCode} retry={{ label: JOURNEY_COPY.retryReadLabel, onClick: () => void readProposal(proposalRead.request) }} />;
      case "unavailable":
        return <StateNotice kind="unavailable" title={stepTitle(journey.step)} source={proposalRead.source} description={proposalRead.guidance} retry={{ label: JOURNEY_COPY.retryReadLabel, onClick: () => void readProposal(proposalRead.request) }} />;
      case "refused":
        return <ReadRefusalBlock errors={proposalRead.errors} onRetry={() => void readProposal(proposalRead.request)} />;
      default:
        return null;
    }
  })();
  const resultsStepNotice: ReactElement | null = ((): ReactElement | null => {
    switch (resultsRead.kind) {
      case "reading":
        return <StateNotice kind="loading" title={JOURNEY_COPY.reading} />;
      case "denied":
        return <StateNotice kind="denied" title={stepTitle("results")} reasonCode={resultsRead.reasonCode} retry={{ label: JOURNEY_COPY.retryReadLabel, onClick: () => void readResults(resultsRead.request) }} />;
      case "unavailable":
        return <StateNotice kind="unavailable" title={stepTitle("results")} source={resultsRead.source} description={resultsRead.guidance} retry={{ label: JOURNEY_COPY.retryReadLabel, onClick: () => void readResults(resultsRead.request) }} />;
      case "refused":
        return <ReadRefusalBlock errors={resultsRead.errors} onRetry={() => void readResults(resultsRead.request)} />;
      default:
        return null;
    }
  })();
  const stepBody = ((): ReactElement => {
    switch (journey.step) {
      case "choose-file":
        return (
          <div className="flex min-w-0 flex-col gap-4">
            {resultsRead.kind === "pending" ? <StateNotice kind="empty" title={JOURNEY_COPY.reload.inFlightHeading} description={JOURNEY_COPY.reload.inFlightStatement} action={{ label: JOURNEY_COPY.reload.inFlightAction, onClick: startAnother }} /> : null}
            {resultsStepNotice}
            {proposeNotice === null ? null : <ProposeNoticeBlock notice={proposeNotice} />}
            {proposeRefusal === null ? null : <FormErrorSummary errors={proposeRefusal} title={REFUSAL_FRAMING.title} description={REFUSAL_FRAMING.lead} />}
            <FileChooser
              selection={journey.file}
              onChoose={journey.setFile}
              onContinue={() => {
                void propose(null).then((answered) => {
                  if (answered === "review") {
                    setAdvanceTicket((ticket) => ticket + 1);
                  }
                });
              }}
            />
            {proposing ? <StateNotice kind="loading" title={JOURNEY_COPY.reading} /> : null}
          </div>
        );
      case "map": {
        if (proposalRead.kind !== "view") {
          return proposalStepNotice ?? <StateNotice kind="loading" title={JOURNEY_COPY.reading} />;
        }
        const view = proposalRead.view;
        if (view.review === null) {
          return <StateNotice kind="unavailable" title={stepTitle("map")} description={view.reviewDetail.message} />;
        }
        return (
          <div className="flex min-w-0 flex-col gap-4">
            {proposeNotice === null ? null : <ProposeNoticeBlock notice={proposeNotice} />}
            <StepMapping
              proposal={{ ...proposalRead.envelope, data: { ...view.record, suggestion: view.review.suggestion } }}
              confirmedMapping={journey.mapping ?? null}
              submitting={proposing}
              fieldErrors={proposeErrors}
              onConfirm={(mapping) => {
                journey.setMapping(mapping);
                void propose(mapping).then((answered) => {
                  if (answered === "review") {
                    setAdvanceTicket((ticket) => ticket + 1);
                  }
                });
              }}
            />
          </div>
        );
      }
      case "review": {
        if (proposalRead.kind !== "view") {
          return proposalStepNotice ?? <StateNotice kind="loading" title={JOURNEY_COPY.reading} />;
        }
        return (
          <StepReview
            proposal={{ ...proposalRead.envelope, data: proposalRead.view }}
            decisions={journey.decisions}
            window={proposalRead.view.rowWindow}
            onPageChange={changePage}
            onPageSizeChange={changePageSize}
            onDecide={(rowNumber, decision) => {
              void decide(rowNumber, decision);
            }}
            decidingRowNumber={decidingRow}
            refusal={reviewRefusal}
            focusRowNumber={correctionRow}
            onContinue={() => {
              // Moving forward ends the return to a row: from here the journey continues as it always does, and the
              // next completed acceptance opens its own results.
              setCorrectionRow(null);
              journey.goTo("accept");
            }}
            stop={stop}
          />
        );
      }
      case "accept": {
        if (proposalRead.kind !== "view") {
          return proposalStepNotice ?? <StateNotice kind="loading" title={JOURNEY_COPY.reading} />;
        }
        const view = proposalRead.view;
        if (view.review === null) {
          return <StateNotice kind="unavailable" title={stepTitle("accept")} description={view.reviewDetail.message} />;
        }
        return (
          <div className="flex min-w-0 flex-col gap-4">
            <StepAcceptance
              key={journey.acceptIntentKey}
              summary={view.summary}
              input={{ scope: currentScope, expectedRevision: currentRevision, payload: { acknowledged: true, fileFingerprint: view.fileFingerprint, decisions: Object.values(journey.decisions) } }}
              submit={submitAcceptance}
              decidedRowCount={Object.values(journey.decisions).length}
              onCancel={() => {
                journey.goTo("review");
              }}
            />
            {acceptUnknown === null ? null : <StateNotice kind="unknown" title={JOURNEY_COPY.unknownAccept.title} description={JOURNEY_COPY.unknownAccept.statement} operationId={acceptUnknown} retry={{ label: JOURNEY_COPY.checkAcceptanceLabel, onClick: checkAcceptance }} />}
            {resultsRead.kind === "pending" ? (
              <Alert>
                <AlertTitle>{JOURNEY_COPY.acceptCheck.inFlightTitle}</AlertTitle>
                <AlertDescription>
                  <p>{JOURNEY_COPY.acceptCheck.inFlightStatement}</p>
                </AlertDescription>
              </Alert>
            ) : null}
            {resultsStepNotice}
          </div>
        );
      }
      case "results": {
        if (resultsView === null) {
          return resultsStepNotice ?? <StateNotice kind="loading" title={JOURNEY_COPY.reading} />;
        }
        // A journey still holding the chosen file and mapping can reopen the review at a row; one that was
        // reloaded holds neither, so it states the row instead of offering a control it could not honour.
        return <StepResults results={resultsView} recovered={recovered} onPageChange={changePage} onPageSizeChange={changePageSize} stop={stop} onStartAnother={startAnother} onCorrection={journey.canOpen("review") ? correctRow : undefined} />;
      }
    }
  })();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ImportStepper current={journey.step} completed={completedSteps} onReopen={journey.goTo} />
      <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-muted-foreground">{stepLabel(journey.step)}</p>
          <h2 id={headingId} className="text-xl font-semibold text-balance">
            {stepTitle(journey.step)}
          </h2>
        </div>
        {stepBody}
      </section>
    </div>
  );
}
