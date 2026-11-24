"use client";
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
import { advanceClockRequestSchema, makeSetFailurePlanRequestSchema, resetSeedRequestSchema, selectPersonaRequestSchema, setClockRequestSchema, setScenarioRequestSchema, type AdvertisedFailurePlan, type DevRequest, type DevTransportAction } from "../schemas/dev";
import { devStateQueryKey } from "./use-dev-state";
type DevIntent = { readonly action: DevTransportAction; readonly scope: Scope; readonly expectedRevision: string; readonly payload: unknown };
function payloadFields(payload: unknown): string {
  if (!isRecord(payload)) return JSON.stringify(payload) ?? "";
  return Object.keys(payload)
    .sort()
    .map((field) => `${field}=${JSON.stringify(payload[field]) ?? ""}`)
    .join("&");
}
function intentKeyOf(intent: DevIntent): string {
  const { action, scope, expectedRevision, payload } = intent;
  return [action, scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, expectedRevision, payloadFields(payload)].join("|");
}
// A scenario change, a reset or a clock change alters what every read in the context means, so every entry in the scope is re-read and the rendered tree is asked again, where the other controls touch one entry. A boundary is evaluated against the scenario clock at the moment it is read, so an advance moves the as-of
// of every envelope and every judgement built on it — a referral's expiry, a series' missed dates, a coaching cutoff, a notification window — and only a fresh read and a fresh render state the answer at the instant now in force. A failure plan arms the fate of named mutations and faults and leaves what every read says
// as it was, so it is not one of these.
const changesWhatEveryReadMeans = (action: DevTransportAction): boolean => action === "setScenario" || action === "resetSeed" || action === "setClock" || action === "advanceClock";
export interface DevMutationTransports {
  readonly onSetScenario: (scenarioId: string) => Promise<MutationOutcome>;
  readonly onSetClock: (offsetMilliseconds: number) => Promise<MutationOutcome>;
  readonly onAdvanceClock: (advanceMilliseconds: number) => Promise<MutationOutcome>;
  readonly onSetFailurePlan: (arming: DevFailureArming | null) => Promise<MutationOutcome>;
  readonly reset: DevResetTransport;
  /** Switches the seeded session this browser acts as, so every surface afterwards is read as that identity. */ readonly onSelectPersona: (personaId: string) => Promise<MutationOutcome>;
}
/** Builds the six transports for the session acting in `scope`. */ export function useDevMutations(scope: Scope, envelope: ReadEnvelope<DevState> | null, enabled: boolean): DevMutationTransports | null {
  const queryClient = useQueryClient();
  const router = useRouter();
  const attempts = useRef(new Map<string, string>());
  const inFlight = useRef(new Map<string, Promise<MutationOutcome>>());
  const refreshedFor = useRef<string | null>(null);
  const expectedRevision = envelope?.revision ?? "";
  const advertised = useMemo<AdvertisedFailurePlan>(() => {
    const targets = envelope?.data.failureTargets ?? [];
    return { modes: [...new Set(targets.flatMap((target) => target.modes))], targets: targets.map((target) => ({ kind: target.kind, name: target.name })) };
  }, [envelope]);
  const failurePlanSchema = useMemo(() => makeSetFailurePlanRequestSchema(advertised), [advertised]);
  const refreshOnceFor = useCallback(
    (operationId: string): void => {
      if (refreshedFor.current === operationId) return;
      refreshedFor.current = operationId;
      router.refresh();
    },
    [router],
  );
  const settle = useCallback(
    async (action: DevTransportAction, outcome: MutationOutcome): Promise<void> => {
      if (action === "selectPersona") {
        // A switch that was not applied leaves this browser acting as the identity it already acted as, so nothing it holds is stale. One that was applied changes which identity every read answers for, and every query key is
        if (!(outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged")) return; // scoped to the identity that answered it, so the whole client world is dropped rather than invalidated.
        queryClient.clear();
        refreshOnceFor(outcome.operationId);
        return;
      }
      if (!(outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted")) return;
      const everyReadIsStale = changesWhatEveryReadMeans(action);
      try {
        if (everyReadIsStale) {
          await queryClient.invalidateQueries({ queryKey: scopeKey(scope) });
        } else await queryClient.invalidateQueries({ queryKey: devStateQueryKey(scope) });
      } catch {}
      if (everyReadIsStale) refreshOnceFor(outcome.operationId);
    },
    [queryClient, refreshOnceFor, scope],
  );
  const identityFor = useCallback((intent: DevIntent): string => {
    const key = intentKeyOf(intent);
    const operationId = attempts.current.get(key) ?? newOperationId();
    attempts.current.delete(key);
    attempts.current.set(key, operationId);
    for (const oldest of attempts.current.keys()) if (attempts.current.size > 32) attempts.current.delete(oldest);
    return operationId;
  }, []);
  const submit = useCallback(
    async <Action extends DevTransportAction, Payload>(action: Action, schema: ZodType<DevRequest<Action, Payload>>, input: MutationInput<unknown>): Promise<MutationOutcome> => {
      const key = intentKeyOf({ action, scope, expectedRevision: input.expectedRevision, payload: input.payload });
      const running = inFlight.current.get(key);
      if (running !== undefined) return running;
      const parsed = schema.safeParse({ action, ...input });
      if (!parsed.success) return invalid({ operationId: input.operationId, fields: parsed.error });
      const attempt = (async (): Promise<MutationOutcome> => {
        try {
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
    if (!enabled || envelope === null) return null;
    // Every control submits the authority this development read itself ran under, never the shell's admission scope:
    const authority = envelope.scope; // a session that admits no ministry is refused no development control by its admission, and the read has already named the runtime's own scope for it. The reviewed reset below has always stated this scope for the same reason.
    const build = (action: DevTransportAction, payload: unknown): MutationInput<unknown> => ({ operationId: identityFor({ action, scope: authority, expectedRevision, payload }), scope: authority, expectedRevision, payload });
    return {
      onSetScenario: (scenarioId) => submit("setScenario", setScenarioRequestSchema, build("setScenario", { scenarioId })),
      onSetClock: (offsetMilliseconds) => submit("setClock", setClockRequestSchema, build("setClock", { offsetIso: Number.isSafeInteger(offsetMilliseconds) ? instantAt(offsetMilliseconds).toString() : "" })),
      onAdvanceClock: (advanceMilliseconds) => submit("advanceClock", advanceClockRequestSchema, build("advanceClock", { bySeconds: advanceMilliseconds / 1_000 })),
      onSetFailurePlan: (arming) => {
        return arming === null ? submit("setFailurePlan", failurePlanSchema, build("setFailurePlan", { plan: null })) : submit("setFailurePlan", failurePlanSchema, build("setFailurePlan", { mode: arming.mode, target: { kind: arming.target.kind, name: arming.target.name } }));
      },
      reset: { input: { scope: envelope.scope, expectedRevision, payload: {} }, submit: (input) => submit("resetSeed", resetSeedRequestSchema, input) },
      // The switch names one seeded persona of the roster the read lists and stores nothing: the handler grants this
      onSelectPersona: (personaId) => submit("selectPersona", selectPersonaRequestSchema, build("selectPersona", { personaId })), // browser's session cookie, so the payload carries the identifier and no other field.
    };
  }, [enabled, envelope, expectedRevision, failurePlanSchema, identityFor, submit]);
  return transports;
}
