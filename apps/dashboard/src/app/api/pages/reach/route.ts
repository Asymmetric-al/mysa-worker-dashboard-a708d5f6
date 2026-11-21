/** `POST /api/pages/reach` — how far a released page reaches: */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { sessionIdOf } from "../../session-cookie";
import { dispatch, jsonBodyOf, operationIdentityOf } from "../../handler";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every mutation resolves the development session and the scenario clock per request.
export const dynamic = "force-dynamic";
const MESSAGES = { operationRequired: "State which reach change this request makes as payload.operation: setReach or stopShowingPublicly.", bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload." } as const;
type SetReachPayload = Parameters<typeof mutations.pages.setReach>[1]["payload"];
type StopShowingPubliclyPayload = Parameters<typeof mutations.pages.stopShowingPublicly>[1]["payload"];
type Routed<P> = P & { readonly operation: string };
const setReachBodySchema = mutationInputSchema(z.custom<Routed<SetReachPayload>>());
const stopShowingPubliclyBodySchema = mutationInputSchema(z.custom<Routed<StopShowingPubliclyPayload>>());
const REACH_OPERATIONS = ["setReach", "stopShowingPublicly"] as const;
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(REACH_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
/** One named reach change, selected by `payload.operation`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const sessionId = sessionIdOf(request);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) return toResponse(outcomeFromError(operationId, claimed.error));
  switch (claimed.data.payload.operation) {
    case "setReach":
      return dispatch(setReachBodySchema, raw, operationId, "operation", (input) => mutations.pages.setReach(sessionId, input));
    case "stopShowingPublicly":
      // No draft check and no pre-read before this dispatch: containment has to succeed even while a sibling draft of the page is invalid, and the service contains every locale edition in one go.
      return dispatch(stopShowingPubliclyBodySchema, raw, operationId, "operation", (input) => mutations.pages.stopShowingPublicly(sessionId, input));
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page reach change");
  }
}
