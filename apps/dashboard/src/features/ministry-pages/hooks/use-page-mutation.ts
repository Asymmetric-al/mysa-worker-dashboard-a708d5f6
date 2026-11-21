"use client";
/**
 * The Worker and Project Pages family's single mutation transport.
 */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { assertNever } from "@/lib/result";
import type { MutationInput } from "@/modules/data-service";
/**
 * The outcome module rather than the service barrel, because this is a browser module: a value import
 * of the barrel would pull every read, every mutation and the store into the client bundle. The barrel
 * carries the contract types a boundary names; the guard and the constructors a client answers with
 * are owned here, and are imported from their owner rather than restated, so a ninth outcome or a
 * changed denial shape reaches this file as a compile error instead of drifting.
 */
import { isOutcome, unavailable, unknown, type MutationOutcome } from "@/modules/data-service/outcome";
/** What one member of the family's mutation hooks is configured with. */
export interface PageMutationConfig {
  path: string;
  invalidate?: readonly (readonly unknown[])[];
}
const HANDLER_SOURCE_SYSTEM = "data-service";

const TRANSPORT_GUIDANCE =
  "The request did not complete, so this change is reported as neither applied nor refused. Retry it with the same operation id: a replay returns the original result instead of repeating the effect.";
async function readJsonBody(answer: Response): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return undefined;
  }
}
async function postPageMutation<P>(path: string, input: MutationInput<P>): Promise<MutationOutcome> {
  let answer: Response;
  try {
    answer = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return unavailable({
      operationId: input.operationId,
      source: { system: HANDLER_SOURCE_SYSTEM, reference: path },
      guidance: TRANSPORT_GUIDANCE,
    });
  }
  const body = await readJsonBody(answer);
  if (isOutcome(body)) {
    return body;
  }
  return unknown({ operationId: input.operationId });
}
function reReadPrefixes(queryClient: QueryClient, prefixes: PageMutationConfig["invalidate"]): void {
  for (const queryKey of prefixes ?? []) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
/** The family's single mutation transport: posts the four-field input to a documented handler and returns one of eight outcomes; invalidates on accepted/alreadyAccepted, re-reads on unknown. */
export function usePageMutation<P>(config: PageMutationConfig): UseMutationResult<MutationOutcome, never, MutationInput<P>> {
  const queryClient = useQueryClient();
  const { path, invalidate } = config;
  return useMutation<MutationOutcome, never, MutationInput<P>>({
    mutationFn: (input) => postPageMutation(path, input),
    onSuccess: (outcome) => {
      switch (outcome.outcome) {
        case "accepted":
        case "alreadyAccepted":
          reReadPrefixes(queryClient, invalidate);
          return;
        case "unknown":
          reReadPrefixes(queryClient, invalidate);
          return;
        case "unchanged":
        case "conflict":
        case "invalid":
        case "denied":
        case "unavailable":
          return;
        default:
          assertNever(outcome, "Unhandled mutation outcome");
      }
    },
  });
}
