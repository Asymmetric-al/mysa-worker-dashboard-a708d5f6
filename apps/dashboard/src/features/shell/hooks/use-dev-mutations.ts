"use client";

/**
 * The five development controls, as the transports the development panel and the Settings reset call.
 *
 * One mutation object carries every control, because they share three properties the AAP fixes: the
 * request body shape (`features/shell/schemas/dev.ts` is the single owner of it), the attempt identity
 * (an `operationId` reused for a retry of the same intent and never for a different one), and the cache
 * invalidation that follows a settled attempt so the panel renders the state the service now holds
 * rather than the state it sent.
 *
 * **Identity, stated once.** The four panel controls answer `Promise<MutationOutcome>` and must recover
 * a lost acknowledgement by the same identity (`components/dev-panel` retries the attempt it kept). So
 * an identity is kept per intent — the action plus its payload — and it is reused while the revision
 * the attempt was based on is still the current one. A revision that moved means the earlier attempt
 * has been superseded, and submitting the old identity for a new intent is exactly the `changed-intent`
 * conflict the contract reserves for a caller's mistake; a fresh identity is minted instead.
 *
 * **What this hook never does.** It mints no revision, no scope and no authority: the scope is the
 * envelope's own and the revision is the one the read reported. It performs no clock arithmetic —
 * `instantAt` from the one time module converts the panel's offset into the instant the clock reads —
 * and it invents no outcome for a request the handler answers: the only outcome built here is the
 * `advanceClock` whole-seconds guard, which refuses a fractional amount before anything is sent.
 */

import { useCallback, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { DevFailureArming, DevResetTransport } from "@/components/dev-panel";
import { newOperationId } from "@/lib/ids";
import type { ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { MutationInput, MutationOutcome } from "@/modules/data-service";
import type { DevState } from "@/modules/data-service/reads/dev";
import { instantAt } from "@/modules/time/clock";

import { submitDevAction, type DevAction } from "../api-client";
import { devStateQueryKey } from "./use-dev-state";

/** One request the development handler accepts: its control and the four-field input it judges. */
interface DevRequest {
  readonly action: DevAction;
  readonly input: MutationInput<unknown>;
}

/** One attempt's identity, and the revision it was based on. */
interface DevAttempt {
  readonly operationId: string;
  readonly expectedRevision: string;
}

/**
 * Every transport the development region dispatches, built from the envelope the read reported.
 *
 * Each member is the exact prop its component takes, so the panel and this hook cannot drift: the four
 * controls answer one outcome, and the reset travels as the reviewed input the shared review step needs
 * (it mints the reset's own attempt identity, so a replay from its receipt repeats that identity).
 */
export interface DevMutationTransports {
  readonly onSetScenario: (scenarioId: string) => Promise<MutationOutcome>;
  readonly onSetClock: (offsetMilliseconds: number) => Promise<MutationOutcome>;
  readonly onAdvanceClock: (advanceMilliseconds: number) => Promise<MutationOutcome>;
  readonly onSetFailurePlan: (arming: DevFailureArming | null) => Promise<MutationOutcome>;
  /**
   * The reviewed reset. It is always built, because only the runtime's own answer says whether a reset
   * is available: the panel renders the control where `devState.reset.available` is true and states the
   * runtime's own sentence where it is not.
   */
  readonly reset: DevResetTransport;
}

/**
 * Builds the five transports for the session acting in `scope`.
 *
 * Answers `null` until the development read has reported an envelope: without the revision it reported
 * there is nothing a control could present as `expectedRevision`, and a control that cannot act is not
 * rendered (`components/app-shell` states the same rule for the region).
 */
export function useDevMutations(
  scope: Scope,
  envelope: ReadEnvelope<DevState> | null,
  enabled: boolean,
): DevMutationTransports | null {
  const queryClient = useQueryClient();
  const attempts = useRef(new Map<string, DevAttempt>());

  const expectedRevision = envelope?.revision ?? "";

  const mutation = useMutation({
    mutationFn: ({ action, input }: DevRequest) => submitDevAction(action, input),
    onSettled: async () => {
      // The service's answer is the only statement of what the runtime now holds: a scenario, offset or
      // plan that was applied must be read back, and one that was refused must leave what is displayed
      // unchanged rather than stale.
      await queryClient.invalidateQueries({ queryKey: devStateQueryKey(scope) });
    },
  });

  const dispatch = useCallback(
    (request: DevRequest): Promise<MutationOutcome> => mutation.mutateAsync(request),
    [mutation],
  );

  /**
   * The identity of one intent, reused while the revision it was based on is current.
   *
   * `payload` is the object this hook builds from a literal, so its serialisation is stable and two
   * presses of one control answer the same intent; the revision guard is what keeps a genuinely new
   * attempt from inheriting an old identity after the state moved.
   */
  const identityFor = useCallback(
    (action: DevAction, payload: unknown): string => {
      const key = `${action}:${JSON.stringify(payload)}`;
      const previous = attempts.current.get(key);
      if (previous !== undefined && previous.expectedRevision === expectedRevision) {
        return previous.operationId;
      }
      const operationId = newOperationId();
      attempts.current.set(key, { operationId, expectedRevision });
      return operationId;
    },
    [expectedRevision],
  );

  const build = useCallback(
    (action: DevAction, payload: unknown): DevRequest => ({
      action,
      input: {
        operationId: identityFor(action, payload),
        scope,
        expectedRevision,
        payload,
      },
    }),
    [identityFor, scope, expectedRevision],
  );

  const transports = useMemo<DevMutationTransports | null>(() => {
    if (!enabled || envelope === null) {
      return null;
    }

    return {
      onSetScenario: (scenarioId) => dispatch(build("setScenario", { scenarioId })),

      onSetClock: (offsetMilliseconds) =>
        // The clock takes the instant it should read, not an offset: `instantAt` is the one conversion
        // from the seed instant plus an offset, so the panel's milliseconds never become a second clock.
        dispatch(build("setClock", { offsetIso: instantAt(offsetMilliseconds).toString() })),

      onAdvanceClock: (advanceMilliseconds) => {
        const bySeconds = advanceMilliseconds / 1_000;
        if (!Number.isSafeInteger(bySeconds) || bySeconds <= 0) {
          const payload = { bySeconds: advanceMilliseconds };
          return Promise.resolve({
            outcome: "invalid",
            operationId: identityFor("advanceClock", payload),
            fields: {
              "payload.bySeconds": [
                "A clock advance is a whole number of seconds greater than zero, so choose one of the panel's amounts.",
              ],
            },
          } satisfies MutationOutcome);
        }
        return dispatch(build("advanceClock", { bySeconds }));
      },

      onSetFailurePlan: (arming) => {
        if (arming === null) {
          // The disarm is the handler's own payload form for clearing the armed plan, so it travels
          // this transport like an arming does and the panel renders the handler's answer rather than
          // an outcome built here; its identity is keyed by the action and this payload, so a second
          // press replays the attempt instead of minting another.
          return dispatch(build("setFailurePlan", { plan: null }));
        }
        return dispatch(
          build("setFailurePlan", {
            mode: arming.mode,
            target: { kind: arming.target.kind, name: arming.target.name },
          }),
        );
      },

      // The review step mints the reset's attempt identity, so a replay from its receipt repeats that
      // identity and the handler answers `alreadyAccepted` rather than resetting twice.
      reset: {
        input: { scope: envelope.scope, expectedRevision, payload: {} },
        submit: (input) => dispatch({ action: "resetSeed", input }),
      },
    };
  }, [dispatch, build, identityFor, enabled, envelope, expectedRevision]);

  return transports;
}
