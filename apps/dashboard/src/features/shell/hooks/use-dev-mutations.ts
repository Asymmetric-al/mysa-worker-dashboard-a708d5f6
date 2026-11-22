"use client";

/** The six development controls, as the transports the development panel and the Settings reset call. */

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z, type ZodType } from "zod";

import type { DevFailureArming, DevResetTransport } from "@/components/dev-panel";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { newOperationId } from "@/lib/ids";
import type { MutationInput, MutationOutcome } from "@/modules/data-service";
import { mutationInputSchema, type ReadEnvelope, type Scope } from "@/modules/data-service/envelope";
import { invalid } from "@/modules/data-service/outcome";
import type { DevState } from "@/modules/data-service/reads/dev";
import { instantAt } from "@/modules/time/clock";

import { submitDevAction } from "../api-client";
import { advanceClockRequestSchema, makeSetFailurePlanRequestSchema, resetSeedRequestSchema, setClockRequestSchema, setScenarioRequestSchema, type AdvertisedFailurePlan, type DevMutationName } from "../schemas/dev";
import { devStateQueryKey } from "./use-dev-state";

const REMEMBERED_INTENT_LIMIT = 32;

/**
 * The persona switch is the one action this family sends that has no `mutations.dev.*` counterpart: the
 * session a browser acts as is its own cookie's fact, so the switch stores nothing and the handler grants the
 * cookie. Its request schema is therefore declared here rather than beside the five service mutations, whose
 * `DevMutationName` is the service's own roster and does not carry this name.
 */
type SelectPersonaAction = "selectPersona";

/** Every action these transports send: the five service mutations, and the switch. */
type DevTransportAction = DevMutationName | SelectPersonaAction;

/** One request as the transport hands it to the handler: the four fields the mutation envelope states, and the action the handler dispatches on. */
type DevTransportRequest<Action extends DevTransportAction, Payload> = MutationInput<Payload> & { readonly action: Action };

type SelectPersonaPayload = { readonly personaId: string };

/** The refusal the switch's own schema states for an identifier it cannot use: the roster is the only thing a persona can be named from, so an empty or a written value is not one. */
const PERSONA_ID_REQUIRED = "A persona switch names one of the seeded personas this session's development read lists, so send that roster's own identifier rather than an empty or a written one.";

const selectPersonaPayloadSchema = z.strictObject({ personaId: z.string().min(1, PERSONA_ID_REQUIRED).max(64, PERSONA_ID_REQUIRED) });

const selectPersonaRequestSchema: ZodType<DevTransportRequest<SelectPersonaAction, SelectPersonaPayload>> = z
  .looseObject({ action: z.literal("selectPersona", { error: "A development request names the action it asks for, so send the control's own action with the rest of the request." }) })
  .transform((raw): unknown => {
    if (!isRecord(raw)) {
      return undefined;
    }
    const projection: Record<string, unknown> = { ...raw };
    delete projection.action;
    return projection;
  })
  .pipe(mutationInputSchema(selectPersonaPayloadSchema))
  .transform((input) => ({ action: "selectPersona" as const, ...input }));

interface DevIntent {
  readonly action: DevTransportAction;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly payload: unknown;
}

function payloadFields(payload: unknown): string {
  if (!isRecord(payload)) {
    return JSON.stringify(payload) ?? "";
  }
  return Object.keys(payload)
    .sort()
    .map((field) => `${field}=${JSON.stringify(payload[field]) ?? ""}`)
    .join("&");
}

function intentKeyOf(intent: DevIntent): string {
  const { action, scope, expectedRevision, payload } = intent;
  return [action, scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, expectedRevision, payloadFields(payload)].join("|");
}

export interface DevMutationTransports {
  readonly onSetScenario: (scenarioId: string) => Promise<MutationOutcome>;
  readonly onSetClock: (offsetMilliseconds: number) => Promise<MutationOutcome>;
  readonly onAdvanceClock: (advanceMilliseconds: number) => Promise<MutationOutcome>;
  readonly onSetFailurePlan: (arming: DevFailureArming | null) => Promise<MutationOutcome>;
  /** The reviewed reset. */
  readonly reset: DevResetTransport;
  /** Switches the seeded session this browser acts as, so every surface afterwards is read as that identity. */
  readonly onSelectPersona: (personaId: string) => Promise<MutationOutcome>;
}

/** Builds the six transports for the session acting in `scope`. */
export function useDevMutations(scope: Scope, envelope: ReadEnvelope<DevState> | null, enabled: boolean): DevMutationTransports | null {
  const queryClient = useQueryClient();
  const router = useRouter();
  const attempts = useRef(new Map<string, string>());
  const inFlight = useRef(new Map<string, Promise<MutationOutcome>>());
  const refreshedFor = useRef<string | null>(null);

  const expectedRevision = envelope?.revision ?? "";

  /** The failure vocabulary this session's runtime advertises, in the shape the plan schema closes over. */
  const advertised = useMemo<AdvertisedFailurePlan>(() => {
    const targets = envelope?.data.failureTargets ?? [];
    return { modes: [...new Set(targets.flatMap((target) => target.modes))], targets: targets.map((target) => ({ kind: target.kind, name: target.name })) };
  }, [envelope]);

  const failurePlanSchema = useMemo(() => makeSetFailurePlanRequestSchema(advertised), [advertised]);

  /** Re-renders the Server Components once for one settled change that reaches past this panel: a scenario, a reset, or the identity the session acts as. */
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
    async (action: DevTransportAction, outcome: MutationOutcome): Promise<void> => {
      if (action === "selectPersona") {
        // A switch that was not applied leaves this browser acting as the identity it already acted as, so
        // nothing it holds is stale. One that was applied changes which identity every read answers for, and
        // every query key is scoped to the identity that answered it, so nothing cached can be reused: the
        // whole client world is dropped rather than invalidated, and the Server Components are re-rendered for
        // the session this browser now carries (AAP 0.2.1 and 0.7.2: a context switch clears the cache before
        // any new read is issued).
        const switched = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
        if (!switched) {
          return;
        }
        queryClient.clear();
        refreshOnceFor(outcome.operationId);
        return;
      }
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

  /** Validates one control's body and dispatches it, answering exactly one outcome. */
  const submit = useCallback(
    async <Action extends DevTransportAction, Payload>(action: Action, schema: ZodType<DevTransportRequest<Action, Payload>>, input: MutationInput<unknown>): Promise<MutationOutcome> => {
      const key = intentKeyOf({ action, scope, expectedRevision: input.expectedRevision, payload: input.payload });
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

    /**
     * The authority every control submits: the scope this development read itself ran under, never the
     * shell's admission scope. A session that admits no ministry — a seeded reader, say — is refused no
     * development control by its admission, and the read has already named the development runtime's own
     * scope for it; submitting the shell's empty scope instead would be refused by the request envelope
     * before the service was ever reached. The reviewed reset below has always stated this scope for the
     * same reason.
     */
    const authority = envelope.scope;

    /** The four-field input for one control, carrying the identity its intent already has. */
    const build = (action: DevTransportAction, payload: unknown): MutationInput<unknown> => ({ operationId: identityFor({ action, scope: authority, expectedRevision, payload }), scope: authority, expectedRevision, payload });

    return {
      onSetScenario: (scenarioId) => submit("setScenario", setScenarioRequestSchema, build("setScenario", { scenarioId })),

      onSetClock: (offsetMilliseconds) =>
        // The clock reads an instant, not an offset: `instantAt` is the one conversion from the fixed
        // seed instant, so the panel's milliseconds never become a second clock (A12). It refuses a
        // value that is not a safe integer of milliseconds, so a value the control cannot state as an
        // instant is passed on as an unstatable reading and the family's schema reports it.
        submit("setClock", setClockRequestSchema, build("setClock", { offsetIso: Number.isSafeInteger(offsetMilliseconds) ? instantAt(offsetMilliseconds).toString() : "" })),

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
        return submit("setFailurePlan", failurePlanSchema, build("setFailurePlan", { mode: arming.mode, target: { kind: arming.target.kind, name: arming.target.name } }));
      },

      // The reviewed reset: its identity and its double-press fence belong to the review step, so this
      // transport validates and dispatches the input it is handed instead of minting another one.
      reset: { input: { scope: envelope.scope, expectedRevision, payload: {} }, submit: (input) => submit("resetSeed", resetSeedRequestSchema, input) },

      onSelectPersona: (personaId) =>
        // The switch names one seeded persona of the roster the read lists and stores nothing: the handler
        // grants this browser's session cookie, so the payload carries the identifier and no other field.
        submit("selectPersona", selectPersonaRequestSchema, build("selectPersona", { personaId })),
    };
  }, [enabled, envelope, expectedRevision, failurePlanSchema, identityFor, submit]);

  return transports;
}
