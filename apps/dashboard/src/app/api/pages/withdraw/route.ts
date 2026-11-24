import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations } from "@/modules/data-service";
import { claimedWriteRoute, dispatch, type ClaimedWrite } from "../../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = { operationRequired: "State which withdrawal this request makes as payload.operation: withdrawPage or withdrawLocale.", bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload." } as const;
type Routed<P> = P & { readonly operation: string };
const withdrawPageBodySchema = mutationInputSchema(z.custom<Routed<Parameters<typeof mutations.pages.withdrawPage>[1]["payload"]>>());
const withdrawLocaleBodySchema = mutationInputSchema(z.custom<Routed<Parameters<typeof mutations.pages.withdrawLocale>[1]["payload"]>>());
const WITHDRAW_OPERATIONS = ["withdrawPage", "withdrawLocale"] as const;
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(WITHDRAW_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
const WRITES = {
  withdrawPage: (raw, { operationId, sessionId }) => dispatch(withdrawPageBodySchema, raw, operationId, "operation", (input) => mutations.pages.withdrawPage(sessionId, input)),
  withdrawLocale: (raw, { operationId, sessionId }) => dispatch(withdrawLocaleBodySchema, raw, operationId, "operation", (input) => mutations.pages.withdrawLocale(sessionId, input)),
} satisfies Readonly<Record<(typeof WITHDRAW_OPERATIONS)[number], ClaimedWrite>>;
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: (request: NextRequest): Promise<Response> => claimedWriteRoute(request, discriminantSchema, (claim) => claim.payload.operation, WRITES) });
