"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fieldErrorsFromInvalid, refusalSummary, type FieldErrorLookup } from "@/components/form-field";
import type { NoticeHeadingLevel, StateNoticeProps } from "@/components/state-notice";
import { newOperationId, type SourceReference } from "@/lib/ids";
import type { StoppableRequest } from "@/lib/read-transport";
import type { MutationInput } from "@/modules/data-service/envelope";
import { isOutcome, outcomeFromError, type MutationOutcome, type PerItemResult } from "@/modules/data-service/outcome";
/** The identity one attempt carries: the `operationId` it submits under, and the intent that identity was minted for. */ export type ReviewedAttempt = { readonly operationId: string; readonly intent: string | null };
function canonicalIntent(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalIntent(entry)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalIntent(record[key])}`)
      .join(",")}}`;
  }
  return typeof value === "string" ? JSON.stringify(value) : typeof value === "number" ? (Number.isFinite(value) ? String(value) : JSON.stringify(String(value))) : typeof value === "boolean" ? (value ? "true" : "false") : JSON.stringify(String(value));
}
/** The stable fingerprint of one intent: the context, the revision the caller saw, and the payload. */ export const intentKeyOf = (input: Omit<MutationInput<unknown>, "operationId">): string => canonicalIntent(input);
/** The identity an attempt must carry, given the identity already held and the intent submitted now. */ export function attemptForIntent(current: ReviewedAttempt | null, intent: string, mint: () => string = newOperationId): ReviewedAttempt {
  return current !== null && current.intent === intent ? current : { operationId: mint(), intent };
}
/** Whether an outcome leaves the same operation worth replaying. */ export const mayReplay = (outcome: MutationOutcome | null): boolean => outcome !== null && (outcome.outcome === "unavailable" || outcome.outcome === "unknown");
/** The revision a conflict's preserved input may be re-applied against, or `null` when there is no conflict to re-apply. */ export const reappliableRevision = (outcome: MutationOutcome | null): string | null => (outcome !== null && outcome.outcome === "conflict" ? outcome.currentRevision : null);
/** Whether an outcome reports a result that stands: applied once, already applied, or nothing to change. */ export const hasSettled = (outcome: MutationOutcome | null): boolean => outcome !== null && (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged");
/** The transport an attempt submits through: the caller's own mutation call, which the attempt supplies the identity to. A stopped attempt carries its stop signal beside the four fields, never inside them. */ export type MutationSubmit<P> = (input: MutationInput<P> & StoppableRequest) => Promise<MutationOutcome>;
/** Everything one attempt offers the surface that renders it, so the surface states no part of the cycle itself. */ export type UseAttemptedMutationResult<P> = {
  readonly operationId: string | null;
  readonly pending: boolean;
  readonly outcome: MutationOutcome | null;
  readonly reviewedIntent: string | null;
  readonly fieldErrors: FieldErrorLookup | null;
  readonly canReplay: boolean;
  readonly conflictRevision: string | null;
  submit(input: Omit<MutationInput<P>, "operationId"> & StoppableRequest): Promise<MutationOutcome>;
  retry(): Promise<MutationOutcome | null>;
  reapplyOnConflict(): Promise<MutationOutcome | null>;
  reset(): void;
};
/** Everything a reviewed mutation offers a surface that reviews one intent before it submits it: the cycle's own fields, with the conflict recovery named for what it does. */
export type UseReviewedMutationResult<P> = Pick<UseAttemptedMutationResult<P>, "operationId" | "pending" | "outcome" | "reviewedIntent" | "submit" | "retry" | "reset"> & { reapply(): Promise<MutationOutcome | null> };
/** The one owner of a reviewed attempt's identity: submits once per intent and answers the outcome it received. */ export function useAttemptedMutation<P = unknown>(submit: MutationSubmit<P>, onSettled?: (outcome: MutationOutcome) => void): UseAttemptedMutationResult<P> {
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);
  const [attempt, setAttempt] = useState<ReviewedAttempt | null>(null);
  const attemptRef = useRef<ReviewedAttempt | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [outcome, setOutcome] = useState<MutationOutcome | null>(null);
  const outcomeRef = useRef<MutationOutcome | null>(null);
  const [reviewedIntent, setReviewedIntent] = useState<string | null>(null);
  const inputRef = useRef<Omit<MutationInput<P>, "operationId"> | null>(null);
  const inFlightRef = useRef<Promise<MutationOutcome> | null>(null);
  const adopt = useCallback((next: ReviewedAttempt | null): ReviewedAttempt | null => {
    attemptRef.current = next;
    setAttempt(next);
    return next;
  }, []);
  const submitInput = useCallback(
    (input: Omit<MutationInput<P>, "operationId"> & StoppableRequest, reviewsInput = true): Promise<MutationOutcome> => {
      const running = inFlightRef.current;
      if (running !== null) return running;
      // The four fields are held apart from the stop signal: the identity is minted for what the attempt asks for, and a retry after the wait was stopped presents the same request rather than the signal that once ended it.
      const retained: Omit<MutationInput<P>, "operationId"> = { scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload };
      const signal = input.signal;
      const intent = intentKeyOf(retained);
      if (reviewsInput) setReviewedIntent(intent);
      const identity = attemptForIntent(attemptRef.current, intent);
      adopt(identity);
      inputRef.current = retained;
      pendingRef.current = true;
      setPending(true);
      const request: MutationInput<P> = { operationId: identity.operationId, scope: retained.scope, expectedRevision: retained.expectedRevision, payload: retained.payload };
      const finish = (result: MutationOutcome): MutationOutcome => {
        pendingRef.current = false;
        outcomeRef.current = result;
        setPending(false);
        setOutcome(result);
        onSettledRef.current?.(result);
        return result;
      };
      const run = (async (): Promise<MutationOutcome> => {
        try {
          const answered: unknown = await submitRef.current(signal === undefined ? request : { ...request, signal });
          return finish(isOutcome(answered) ? answered : outcomeFromError(identity.operationId, answered));
        } catch (error) {
          return finish(outcomeFromError(identity.operationId, error));
        }
      })();
      const tracked: Promise<MutationOutcome> = run.finally(() => {
        inFlightRef.current = null;
      });
      inFlightRef.current = tracked;
      return tracked;
    },
    [adopt],
  );
  const retry = useCallback(async (): Promise<MutationOutcome | null> => {
    const input = inputRef.current;
    return input === null || pendingRef.current || !mayReplay(outcomeRef.current) ? null : submitInput(input);
  }, [submitInput]);
  const reapplyOnConflict = useCallback(async (): Promise<MutationOutcome | null> => {
    const input = inputRef.current;
    const revision = reappliableRevision(outcomeRef.current);
    return input === null || revision === null || pendingRef.current ? null : submitInput({ ...input, expectedRevision: revision }, false);
  }, [submitInput]);
  const reset = useCallback((): void => {
    if (pendingRef.current) return;
    adopt(null);
    inputRef.current = null;
    outcomeRef.current = null;
    setOutcome(null);
    setReviewedIntent(null);
  }, [adopt]);
  const fieldErrors = useMemo((): FieldErrorLookup | null => (outcome !== null && outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null), [outcome]);
  return { operationId: attempt === null ? null : attempt.operationId, pending, outcome, reviewedIntent, fieldErrors, canReplay: mayReplay(outcome), conflictRevision: reappliableRevision(outcome), submit: submitInput, retry, reapplyOnConflict, reset };
}
/** Owns the attempt identity, the in-flight fence and the last outcome of one reviewed mutation. */ export function useReviewedMutation<P = unknown>(submit: MutationSubmit<P>): UseReviewedMutationResult<P> {
  const { operationId, pending, outcome, reviewedIntent, submit: submitInput, retry, reapplyOnConflict, reset } = useAttemptedMutation<P>(submit);
  return { operationId, pending, outcome, reviewedIntent, submit: submitInput, retry, reapply: reapplyOnConflict, reset };
}
/** The sentences one surface states for the per-item arms of an outcome, so a batch reports each record in words of its own. */
export type OutcomeRowCopy = { readonly alreadyApplied: string; readonly conflict: string; readonly denied: string; readonly unavailable: (source: SourceReference) => string; readonly unknown: (operationId: string) => string };
/** One record's own outcome, as the per-item row that reports it beside the record it names. */ export function outcomeRow(targetId: string, outcome: MutationOutcome, copy: OutcomeRowCopy): PerItemResult {
  switch (outcome.outcome) {
    case "accepted":
      return { targetId, state: "accepted", revision: outcome.revision };
    case "alreadyAccepted":
      return { targetId, state: "accepted", revision: outcome.revision, reason: copy.alreadyApplied };
    case "unchanged":
      return { targetId, state: "unchanged", revision: outcome.revision };
    case "conflict":
      return { targetId, state: "failed", revision: outcome.currentRevision, reasonCode: outcome.reason, reason: copy.conflict };
    case "denied":
      return { targetId, state: "failed", reasonCode: outcome.reasonCode, reason: copy.denied };
    case "invalid":
      return { targetId, state: "failed", reasonCode: "invalid", reason: refusalSummary(outcome) };
    case "unavailable":
      return { targetId, state: "failed", reasonCode: outcome.source.system, reason: copy.unavailable(outcome.source) };
    case "unknown":
      return { targetId, state: "failed", reasonCode: "unknown", reason: copy.unknown(outcome.operationId) };
  }
}
/** The words a surface states for the three outcomes a person can recover from, so no surface invents its own. */ export type OutcomeNoticeCopy = {
  readonly denied: { readonly title: string; readonly description?: string };
  readonly unavailable: { readonly title: string; readonly description?: string };
  readonly unknown: { readonly title: string; readonly description?: string };
  readonly retryLabel: string;
  readonly checkResultLabel: string;
};
/** What a surface offers beside that notice: the heading level it nests at, and the two recoveries it holds. */
export type OutcomeNoticeOptions = { readonly onRetrySameWork?: (() => void) | undefined; readonly onCheckResult?: (() => void) | undefined; readonly headingLevel?: NoticeHeadingLevel; readonly className?: string };
/** The notice a recoverable outcome renders, and `null` for the outcomes a receipt reports in full. */ export function outcomeNotice(outcome: MutationOutcome, copy: OutcomeNoticeCopy, options: OutcomeNoticeOptions = {}): StateNoticeProps | null {
  const { onRetrySameWork, onCheckResult, headingLevel, className } = options;
  const retry = onRetrySameWork === undefined ? undefined : { label: copy.retryLabel, onClick: onRetrySameWork };
  const check = onCheckResult === undefined ? undefined : { label: copy.checkResultLabel, onClick: onCheckResult };
  const placement = { ...(headingLevel === undefined ? {} : { headingLevel }), ...(className === undefined ? {} : { className }) };
  switch (outcome.outcome) {
    case "denied":
      return { kind: "denied", title: copy.denied.title, ...(copy.denied.description === undefined ? {} : { description: copy.denied.description }), reasonCode: outcome.reasonCode, ...placement };
    case "unavailable":
      return { kind: "unavailable", title: copy.unavailable.title, ...(copy.unavailable.description === undefined ? {} : { description: copy.unavailable.description }), source: outcome.source, ...(retry === undefined ? {} : { retry }), ...placement };
    case "unknown":
      return { kind: "unknown", title: copy.unknown.title, ...(copy.unknown.description === undefined ? {} : { description: copy.unknown.description }), operationId: outcome.operationId, ...(check === undefined ? {} : { action: check }), ...placement };
    default:
      return null;
  }
}
