"use client";

/**
 * `selectContext` as the shell dispatches it: one validated, intent-keyed attempt over
 * `POST /api/session/context`, answered with exactly one of the eight closed outcomes.
 *
 * **What this hook owns.**
 * - *The attempt.* It builds the four-field mutation input of AAP 0.7.1 — `operationId`, `scope`,
 *   `expectedRevision` and the payload — and validates it with the family's own
 *   `selectContextRequestSchema` before anything leaves. A body the schema refuses is answered `invalid`
 *   with the Zod issue paths as field keys, and no request is sent: the handler validates with this same
 *   schema, so a person sees the field path the service would have named anyway.
 * - *The identity.* An attempt's `operationId` is keyed on its intent — the authority it acts in, the
 *   context record's revision it saw, and the selection it asks for — so a retry of one intent re-uses the
 *   identity it was first given and the service answers `alreadyAccepted` with the stored result instead of
 *   moving the session twice. The authoritative intent hash is computed server-side in
 *   `modules/data-service/operations`; the key here only decides whether *this client* repeats one attempt.
 *   A different selection, revision or scope is a different intent and mints a new identity.
 * - *The receipt.* The latest outcome is held as render state for one durable result — not a second copy of
 *   a record, and not a cache.
 *
 * **What it does not own, because another file is the single owner.**
 * - *The wire.* `features/shell/api-client`'s `submitContextSelection` is the family's one `POST` to
 *   `/api/session/context`: it answers a request that never arrived as `unavailable` and a body it cannot
 *   read as `unknown` under the caller's own identity (AAP 0.3.2 and Rule 1 clause 2 forbid a second
 *   transport implementation, so this hook sends nothing itself).
 * - *The cache.* AAP 0.3.4 makes `components/context-switch-guard`'s `useContextFence` the only place the
 *   TanStack Query cache is emptied: it cancels in-flight reads and clears before it dispatches. This hook
 *   therefore clears nothing, invalidates nothing and reports no switch optimistically. Its `selectContext`
 *   takes exactly `{ scope, expectedRevision, payload }`, which is the shape the fence's dispatch takes, so
 *   composing the two keeps that ordering in one place.
 * - *The wording.* `features/shell/copy/context-switch` owns every label and sentence the switch shows;
 *   this file holds no user-visible copy.
 *
 * **What it does on each settled outcome.** `accepted` and `alreadyAccepted` re-read the Server Components
 * once for that attempt through `router.refresh()`, because the persisted selection is the server's and the
 * next read is the proof; a second resolution of one attempt cannot refresh twice. `conflict` is returned
 * untouched for the guard to re-open over the caller's preserved input. `denied` and `unavailable` are
 * returned untouched, so the context in force and its envelopes stay exactly as they were. `unknown`
 * carries the `operationId` the surface offers as a result check — never a resend under a fresh key. No
 * client state claims the switch happened.
 *
 * **The one in-flight rule.** A second press of the same intent is answered with the attempt already
 * running: one intent is one effect, and a second answer for it would settle one intent twice. A different
 * selection during an attempt is a second intent, dispatched on its own attempt with its own identity — the
 * service serialises the two, and whichever expected revision has moved is answered `conflict` rather than
 * overwriting the other, so a press for one context can never be answered with another's result. The
 * one-switch-at-a-time rule for the shell as a whole lives in the fence the guard drives.
 *
 * **What it never does.** It throws nothing out of a call it drives: a fault that escapes the transport is
 * reported as `unknown` under the attempt's own identity, because success and failure would both be untrue.
 * It imports no store, no development runtime, no design-system source and no other feature, reads no clock,
 * logs nothing and returns no boolean.
 */

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

/**
 * How many intents keep the identity of their attempt.
 *
 * A session's selectable contexts are a closed, small set, but the payload also carries the guard's optional
 * decision about held work, so the map is bounded and evicts its least recently used entry rather than
 * growing for the life of the session. A forgotten intent is only forgotten by this client: pressing it
 * again mints a new identity, which the service answers as a fresh attempt with the revision that then
 * stands — never as a second effect of the first.
 */
const REMEMBERED_INTENT_LIMIT = 16;

/** What a caller asks the shell to do: act in one context, from the one it is acting in now. */
export interface SelectContextIntent {
  /** The context the caller is acting in now, from the admission envelope. */
  scope: Scope;
  /** The revision of the context record the caller saw, presented as `expectedRevision`. */
  expectedRevision: string;
  /** The context to move to, plus — when the guard has asked — the caller's decision about held work. */
  payload: SelectContextPayload;
}

/** What {@link useSelectContext} returns: the one dispatch, the last outcome, and its attempt identity. */
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

/**
 * The identity key of one intent: the authority, the revision it was read at, and the selection it asks for.
 *
 * The payload is a closed four-field object, so its fields are named here rather than reflected over: an
 * attempt is recognised by the values it carries, in the order the contract declares them, and adding a
 * payload member is a change to this line rather than a silent slip through a generic serialiser.
 */
function intentKeyOf(intent: SelectContextIntent): string {
  const { scope, expectedRevision, payload } = intent;
  return [
    scope.organizationId,
    scope.ministryId,
    scope.supportSubjectId,
    scope.principalId,
    expectedRevision,
    payload.organizationId,
    payload.ministryId,
    payload.supportSubjectId,
    payload.resolveUnsavedWork ?? "",
  ].join("|");
}

/**
 * The context switch, as the shell dispatches it.
 *
 * Every settled attempt is reported as one of the eight closed outcomes; no call answers a boolean, and no
 * success is inferred from an absent error.
 */
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

  /**
   * Re-renders the Server Components once for one settled attempt.
   *
   * The refresh is per attempt, not per press: a replay of the same attempt refreshes the render at most
   * once, because the tree it would re-read is the tree that attempt already produced. Where the shell
   * supplies this dispatch to `useContextFence`, this is the switch's single refresh: the fence's own
   * `switched` branch must not refresh a second time.
   */
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
      const parsed = selectContextRequestSchema.safeParse({
        operationId: attemptOperationId,
        scope: intent.scope,
        expectedRevision: intent.expectedRevision,
        payload: intent.payload,
      });

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
