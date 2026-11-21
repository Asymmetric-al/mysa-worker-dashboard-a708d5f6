"use client";

/**
 * The five development controls, as the transports the development panel and the Settings reset call.
 *
 * `setScenario`, `setClock`, `advanceClock`, `setFailurePlan` and `resetSeed` are the whole write surface
 * of the development runtime (AAP 0.7.1, "Operate the development runtime"), and this hook is the one
 * place the shell dispatches them: `features/shell/api-client` owns the `/api/dev` request and the
 * narrowing of its answer, `features/shell/schemas/dev` owns each body's validation, and nothing here
 * restates either. The development gate is not re-implemented here either — it is the service's — so a
 * build without the runtime answers `denied` and the surface states that honestly rather than hiding a
 * control the person could otherwise have pressed.
 *
 * **One identity per intent.** A retry of the same intent reuses the `operationId` it was first given,
 * so the service answers `alreadyAccepted` with the stored result instead of applying the change a
 * second time; a changed value, target, revision or scope is a different intent and mints a new
 * identity. The intent key below decides only whether the client repeats one attempt: the authoritative
 * intent hash is computed server-side in `modules/data-service/operations` and covers the same three
 * things — scope, revision and payload — which is exactly why an attempt is never re-sent under an
 * identity minted for another revision.
 *
 * **The invalidation policy, stated once.**
 * - `setClock`, `advanceClock` and `setFailurePlan` change no record, so only this session's `dev-state`
 *   read is re-read: a clock or plan change must not cascade into record refetches.
 * - `setScenario` changes the flags every read answers from — which source is unavailable, which media
 *   and coaching modules report, whether continuation is offered — so `dev-state` and the whole scope
 *   prefix are re-read. `router.refresh()` then re-renders the Server Components once for that attempt,
 *   for the reason the reset states below: what a scenario governs is rendered on the server as well, so
 *   invalidating the client cache alone would leave the page showing the world the session has left.
 * - `resetSeed` discards and re-lays every session document, so the whole scope prefix is re-read and
 *   `router.refresh()` re-renders the Server Components once for that attempt: client invalidation alone
 *   would leave the rendered tree showing the records the reset replaced.
 * - A refused outcome — `conflict`, `denied`, `invalid`, `unavailable`, `unknown` — and `unchanged`
 *   invalidate nothing, because what is on screen is still what stands.
 * Nothing here re-reads a record key of its own accord, and emptying the cache remains the context
 * fence's alone (`components/context-switch-guard`).
 *
 * **What this hook never does.** It mints no revision, no scope and no authority, reads no clock — the
 * one conversion from the fixed seed instant is `modules/time/clock`'s `instantAt` — and starts no
 * timer, because the clock is an offset the service holds (assumption A12). It builds no outcome for a
 * request the handler answered: the only outcome built here is the `invalid` the family's own schema
 * produces, which refuses a body before anything is sent.
 *
 * **Reconciliation with the sibling contracts.** This file is written against the modules that exist.
 * `../schemas/dev` exports `DEV_MUTATION_NAMES`/`DevMutationName` and one request schema per control,
 * with `makeSetFailurePlanRequestSchema(advertised)` closing over the modes and targets the runtime
 * advertises; `../api-client`'s `submitDevAction` is the single `/api/dev` POST; and the consumer is
 * `components/dev-panel`, whose props `DevMutationTransports` below repeats so the panel and this hook
 * cannot drift. Three planned shapes are therefore not adopted: the transports are the panel's own
 * members rather than a second `setScenario(input, context)` API; `resetSeed`'s payload is the empty
 * object its schema accepts — the confirmation belongs to the shared review step, which cannot submit an
 * unreviewed reset at all — while the attempt identity, the double-press fence and the durable receipt
 * of a reset stay with `components/action-review`'s reviewed-mutation hook rather than being duplicated
 * here.
 */

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ZodType } from "zod";

import type { DevFailureArming, DevResetTransport } from "@/components/dev-panel";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { newOperationId } from "@/lib/ids";
import type { MutationInput, MutationOutcome } from "@/modules/data-service";
import type { ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import { invalid } from "@/modules/data-service/outcome";
import type { DevState } from "@/modules/data-service/reads/dev";
import { instantAt } from "@/modules/time/clock";

import { submitDevAction } from "../api-client";
import {
  advanceClockRequestSchema,
  makeSetFailurePlanRequestSchema,
  resetSeedRequestSchema,
  setClockRequestSchema,
  setScenarioRequestSchema,
  type AdvertisedFailurePlan,
  type DevMutationName,
  type DevRequest,
} from "../schemas/dev";
import { devStateQueryKey } from "./use-dev-state";

/**
 * The number of intents whose attempt identity is remembered.
 *
 * The five controls are a closed set but their payloads are not — every offset and every scenario the
 * panel offers is a different intent — so the map is bounded and evicts its least recently used entry
 * rather than growing for the life of the session. A forgotten intent is only forgotten by this client:
 * the same intent afterwards mints a new identity, which the service answers as a fresh attempt with
 * the revision that stands at that point.
 */
const REMEMBERED_INTENT_LIMIT = 32;

/** The three fields of an attempt that make it the same intent as another, plus the control it names. */
interface DevIntent {
  readonly action: DevMutationName;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly payload: unknown;
}

/**
 * The payload's own fields, sorted, as one comparable string.
 *
 * Every payload here is an object this hook builds from a literal, so each field's serialisation is
 * stable and two presses of one control answer the same intent. Sorting is what makes the key
 * independent of the order the fields were written in, so a payload assembled differently but describing
 * the same request is still recognised as one intent.
 */
function payloadFields(payload: unknown): string {
  if (!isRecord(payload)) {
    return JSON.stringify(payload) ?? "";
  }
  return Object.keys(payload)
    .sort()
    .map((field) => `${field}=${JSON.stringify(payload[field]) ?? ""}`)
    .join("&");
}

/** The identity key of one intent: the control, the authority, the revision it was read at, its payload. */
function intentKeyOf(intent: DevIntent): string {
  const { action, scope, expectedRevision, payload } = intent;
  return [action, scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, expectedRevision, payloadFields(payload)].join("|");
}

/**
 * Every transport the development region dispatches, built from the envelope the read reported.
 *
 * Each member is the exact prop its component takes, so the panel and this hook cannot drift: the four
 * controls answer one outcome, and the reset travels as the reviewed input the shared review step needs
 * (that step mints the reset's own attempt identity, so a replay from its receipt repeats that identity).
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
export function useDevMutations(scope: Scope, envelope: ReadEnvelope<DevState> | null, enabled: boolean): DevMutationTransports | null {
  const queryClient = useQueryClient();
  const router = useRouter();
  const attempts = useRef(new Map<string, string>());
  const inFlight = useRef(new Map<string, Promise<MutationOutcome>>());
  const refreshedFor = useRef<string | null>(null);

  const expectedRevision = envelope?.revision ?? "";

  /**
   * The failure vocabulary this session's runtime advertises, in the shape the plan schema closes over.
   *
   * It is the read's own answer rather than a list written here, so arming can only name a mode and a
   * call the runtime demonstrates (assumption A13). The schema is memoised on it so a render does not
   * rebuild a validator the envelope did not change for.
   */
  const advertised = useMemo<AdvertisedFailurePlan>(() => {
    const targets = envelope?.data.failureTargets ?? [];
    return {
      modes: [...new Set(targets.flatMap((target) => target.modes))],
      targets: targets.map((target) => ({ kind: target.kind, name: target.name })),
    };
  }, [envelope]);

  const failurePlanSchema = useMemo(() => makeSetFailurePlanRequestSchema(advertised), [advertised]);

  /**
   * Re-renders the Server Components once for one settled scenario change or reset.
   *
   * The refresh is per attempt, not per press: a replay of the same attempt refreshes the render at most
   * once, because the tree it would re-read is the tree that attempt already produced.
   */
  const refreshOnceFor = useCallback(
    (operationId: string): void => {
      if (refreshedFor.current === operationId) {
        return;
      }
      refreshedFor.current = operationId;
      router.refresh();
    },
    [router],
  );

  /** Applies the invalidation policy above to one settled attempt. */
  const settle = useCallback(
    async (action: DevMutationName, outcome: MutationOutcome): Promise<void> => {
      const applied = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted";
      if (!applied) {
        return;
      }
      try {
        if (action === "setScenario" || action === "resetSeed") {
          // A scenario changes what every read in this context answers and a reset re-lays every
          // document, so every read here is stale; the scope prefix includes this session's `dev-state`.
          await queryClient.invalidateQueries({ queryKey: scopeKey(scope) });
        } else {
          await queryClient.invalidateQueries({ queryKey: devStateQueryKey(scope) });
        }
      } catch {
        // A cache invalidation that fails leaves the surface to its next read. It changes nothing the
        // service answered, so the outcome the caller renders stays the service's own — and the server
        // render is still re-read below, because that is the larger of the two stalenesses.
      }
      if (action === "setScenario" || action === "resetSeed") {
        refreshOnceFor(outcome.operationId);
      }
    },
    [queryClient, refreshOnceFor, scope],
  );

  /** The identity of one intent: the id it already carries, or a fresh one remembered for a retry. */
  const identityFor = useCallback((intent: DevIntent): string => {
    const key = intentKeyOf(intent);
    const remembered = attempts.current.get(key);
    if (remembered !== undefined) {
      // Re-inserted so the eviction below drops the least recently used intent rather than the oldest.
      attempts.current.delete(key);
      attempts.current.set(key, remembered);
      return remembered;
    }
    const operationId = newOperationId();
    attempts.current.set(key, operationId);
    while (attempts.current.size > REMEMBERED_INTENT_LIMIT) {
      const oldest = attempts.current.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      attempts.current.delete(oldest);
    }
    return operationId;
  }, []);

  /**
   * Validates one control's body and dispatches it, answering exactly one outcome.
   *
   * A body the family's schema refuses answers `invalid` with its per-field messages and is never sent,
   * so a control shows why the value was refused rather than a round trip that could only repeat it. The
   * same intent already in flight is answered with the attempt that is running: one press is one effect,
   * and a second answer for it would be a second settlement of one intent.
   */
  const submit = useCallback(
    async <Action extends DevMutationName, Payload>(action: Action, schema: ZodType<DevRequest<Action, Payload>>, input: MutationInput<unknown>): Promise<MutationOutcome> => {
      const key = intentKeyOf({
        action,
        scope,
        expectedRevision: input.expectedRevision,
        payload: input.payload,
      });
      const running = inFlight.current.get(key);
      if (running !== undefined) {
        return running;
      }

      const parsed = schema.safeParse({ action, ...input });
      if (!parsed.success) {
        return invalid({ operationId: input.operationId, fields: parsed.error });
      }

      const attempt = (async (): Promise<MutationOutcome> => {
        try {
          // The validated body carries the action it names, so the transport is sent exactly what the
          // schema accepted — the same four fields, with the payload in its declared shape.
          const outcome = await submitDevAction(action, parsed.data);
          await settle(action, outcome);
          return outcome;
        } finally {
          inFlight.current.delete(key);
        }
      })();
      inFlight.current.set(key, attempt);
      return attempt;
    },
    [scope, settle],
  );

  const transports = useMemo<DevMutationTransports | null>(() => {
    if (!enabled || envelope === null) {
      return null;
    }

    /** The four-field input for one control, carrying the identity its intent already has. */
    const build = (action: DevMutationName, payload: unknown): MutationInput<unknown> => ({
      operationId: identityFor({ action, scope, expectedRevision, payload }),
      scope,
      expectedRevision,
      payload,
    });

    return {
      onSetScenario: (scenarioId) => submit("setScenario", setScenarioRequestSchema, build("setScenario", { scenarioId })),

      onSetClock: (offsetMilliseconds) =>
        // The clock reads an instant, not an offset: `instantAt` is the one conversion from the fixed
        // seed instant, so the panel's milliseconds never become a second clock (A12). It refuses a
        // value that is not a safe integer of milliseconds, so a value the control cannot state as an
        // instant is passed on as an unstatable reading and the family's schema reports it.
        submit(
          "setClock",
          setClockRequestSchema,
          build("setClock", {
            offsetIso: Number.isSafeInteger(offsetMilliseconds) ? instantAt(offsetMilliseconds).toString() : "",
          }),
        ),

      onAdvanceClock: (advanceMilliseconds) =>
        // Whole seconds are the unit the mutation moves by, and the schema — not a guard here — is what
        // refuses a fraction, a zero and a negative amount.
        submit("advanceClock", advanceClockRequestSchema, build("advanceClock", { bySeconds: advanceMilliseconds / 1_000 })),

      onSetFailurePlan: (arming) => {
        if (arming === null) {
          // The disarm is the handler's own payload form for clearing the armed plan, so it travels this
          // transport like an arming does and the panel renders the handler's answer rather than an
          // outcome built here.
          return submit("setFailurePlan", failurePlanSchema, build("setFailurePlan", { plan: null }));
        }
        return submit(
          "setFailurePlan",
          failurePlanSchema,
          build("setFailurePlan", {
            mode: arming.mode,
            target: { kind: arming.target.kind, name: arming.target.name },
          }),
        );
      },

      // The reviewed reset: its identity and its double-press fence belong to the review step, so this
      // transport validates and dispatches the input it is handed instead of minting another one.
      reset: {
        input: { scope: envelope.scope, expectedRevision, payload: {} },
        submit: (input) => submit("resetSeed", resetSeedRequestSchema, input),
      },
    };
  }, [enabled, envelope, expectedRevision, failurePlanSchema, identityFor, scope, submit]);

  return transports;
}
