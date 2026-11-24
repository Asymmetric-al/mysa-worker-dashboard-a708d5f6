import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations } from "@/modules/data-service";
import { claimedWriteRoute, dispatch, type ClaimedWrite } from "../../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = { operationRequired: "State which reach change this request makes as payload.operation: setReach or stopShowingPublicly.", bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload." } as const;
type Routed<P> = P & { readonly operation: string };
const setReachBodySchema = mutationInputSchema(z.custom<Routed<Parameters<typeof mutations.pages.setReach>[1]["payload"]>>());
const stopShowingPubliclyBodySchema = mutationInputSchema(z.custom<Routed<Parameters<typeof mutations.pages.stopShowingPublicly>[1]["payload"]>>());
const REACH_OPERATIONS = ["setReach", "stopShowingPublicly"] as const;
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(REACH_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
const WRITES = {
  setReach: (raw, { operationId, sessionId }) => dispatch(setReachBodySchema, raw, operationId, "operation", (input) => mutations.pages.setReach(sessionId, input)),
  stopShowingPublicly: (raw, { operationId, sessionId }) => dispatch(stopShowingPubliclyBodySchema, raw, operationId, "operation", (input) => mutations.pages.stopShowingPublicly(sessionId, input)),
} satisfies Readonly<Record<(typeof REACH_OPERATIONS)[number], ClaimedWrite>>;
const setPageReach = (request: NextRequest): Promise<Response> => claimedWriteRoute(request, discriminantSchema, (claim) => claim.payload.operation, WRITES);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: setPageReach });
