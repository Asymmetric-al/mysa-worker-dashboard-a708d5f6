"use client";

/** `selectContext` as the shell dispatches it: one validated, intent-keyed attempt over `POST /api/session/context`, answered with exactly one of the eight closed outcomes. */

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { newOperationId } from "@/lib/ids";
import type { MutationOutcome, Scope } from "@/modules/data-service";
// Types come from the barrel, values from the outcome module: the barrel's value graph reaches
// `next/server` and the synthetic store, so a value import there would put server code in the browser
// bundle. `outcome.ts` itself imports only zod, the guards, the id helpers and the redactor.
import { invalid, unknown as unknownOutcome } from "@/modules/data-service/outcome";

import { submitContextSelection } from "../api-client";
import { selectContextRequestSchema, type SelectContextPayload } from "../schemas/select-context";

const REMEMBERED_INTENT_LIMIT = 16;

export interface SelectContextIntent {
  /** The context the caller is acting in now, from the admission envelope. */
  scope: Scope;
  /** The revision of the context record the caller saw, presented as `expectedRevision`. */
  expectedRevision: string;
  /** The context to move to, plus — when the guard has asked — the caller's decision about held work. */
  payload: SelectContextPayload;
}

export interface SelectContextApi {
  /** Validates one intent, dispatches it, and answers exactly one outcome. */
  selectContext(intent: SelectContextIntent): Promise<MutationOutcome>;
  /** The last settled outcome, for the durable result a surface renders after a re-render. */
  outcome: MutationOutcome | null;
  /** The identity of the current or last attempt: the handle a result check re-queries. */
  operationId: string | null;
  /** Whether an attempt is running — a busy state, never a claim that the switch happened. */
  isPending: boolean;
  /** Drops the receipt. The attempt's identity survives in the intent map, so a retry is still a replay. */
  clearOutcome(): void;
}

function intentKeyOf(intent: SelectContextIntent): string {
  const { scope, expectedRevision, payload } = intent;
  return [scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, expectedRevision, payload.organizationId, payload.ministryId, payload.supportSubjectId, payload.resolveUnsavedWork ?? ""].join("|");
}

/** The context switch, as the shell dispatches it. */
export function useSelectContext(): SelectContextApi {
  const router = useRouter();
  const attempts = useRef(new Map<string, string>());
  const inFlight = useRef(new Map<string, Promise<MutationOutcome>>());
  const refreshedFor = useRef<string | null>(null);
  const [outcome, setOutcome] = useState<MutationOutcome | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  /** The identity of one intent: the id it already carries, or a fresh one remembered for a retry. */
  const identityFor = useCallback((key: string): string => {
    const remembered = attempts.current.get(key);
    if (remembered !== undefined) {
      // Re-inserted so the eviction below drops the least recently used intent rather than the oldest.
      attempts.current.delete(key);
      attempts.current.set(key, remembered);
      return remembered;
    }
    const minted = newOperationId();
    attempts.current.set(key, minted);
    while (attempts.current.size > REMEMBERED_INTENT_LIMIT) {
      const oldest = attempts.current.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      attempts.current.delete(oldest);
    }
    return minted;
  }, []);

  /** Re-renders the Server Components once for one settled attempt. */
  const refreshOnceFor = useCallback(
    (settledOperationId: string): void => {
      if (refreshedFor.current === settledOperationId) {
        return;
      }
      refreshedFor.current = settledOperationId;
      router.refresh();
    },
    [router],
  );

  /** Holds one settled outcome as the receipt, and re-reads the server only where a switch was applied. */
  const settle = useCallback(
    (settled: MutationOutcome): void => {
      setOutcome(settled);
      setOperationId(settled.operationId);
      if (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted") {
        refreshOnceFor(settled.operationId);
      }
    },
    [refreshOnceFor],
  );

  const clearOutcome = useCallback((): void => {
    setOutcome(null);
    setOperationId(null);
  }, []);

  const selectContext = useCallback(
    async (intent: SelectContextIntent): Promise<MutationOutcome> => {
      const key = intentKeyOf(intent);
      const running = inFlight.current.get(key);
      if (running !== undefined) {
        // One intent is one effect: a second press asks for the attempt already running, and a second
        // request for it would give one intent two settlements.
        return running;
      }

      const attemptOperationId = identityFor(key);
      const parsed = selectContextRequestSchema.safeParse({ operationId: attemptOperationId, scope: intent.scope, expectedRevision: intent.expectedRevision, payload: intent.payload });

      if (!parsed.success) {
        // The field paths the family's schema reports are the ones the handler would report, so the
        // refusal is shown before a round trip that could only repeat it. Nothing is dispatched.
        const refused = invalid({ operationId: attemptOperationId, fields: parsed.error });
        settle(refused);
        return refused;
      }

      // The identity is exposed before the request leaves: if the answer never arrives, the surface still
      // holds the handle its result check re-queries, and no fresh key is minted to mean "the same work".
      setOperationId(attemptOperationId);
      setPendingCount((count) => count + 1);

      const attempt = (async (): Promise<MutationOutcome> => {
        try {
          // The validated body is exactly the four fields the transport and the handler take. A fault that
          // escapes it is an unconfirmed result, not a failure and not a success: the attempt's identity is
          // the only honest answer, and re-querying it is how the outcome is established.
          return await submitContextSelection(parsed.data);
        } catch {
          return unknownOutcome({ operationId: attemptOperationId });
        } finally {
          inFlight.current.delete(key);
          setPendingCount((count) => count - 1);
        }
      })();
      inFlight.current.set(key, attempt);

      const settled = await attempt;
      settle(settled);
      return settled;
    },
    [identityFor, settle],
  );

  return useMemo<SelectContextApi>(() => ({ selectContext, outcome, operationId, isPending: pendingCount > 0, clearOutcome }), [clearOutcome, operationId, outcome, pendingCount, selectContext]);
}
