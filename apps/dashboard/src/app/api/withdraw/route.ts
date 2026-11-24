import { ZodError, z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
import { UNIDENTIFIED_ATTEMPT, claimedBodyRoute, declaresJsonBody, dispatch, type ClaimedWrite } from "../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type SessionRequest = Parameters<typeof sessionIdOf>[0];
const MAX_BODY_BYTES = 16_384;
const MESSAGES = {
  operationRequired: "State which withdrawal this request makes as payload.operation: withdrawUpdate or withdrawLocale.",
  bodyNotJson: "Send the withdrawal as a JSON object carrying operationId, scope, expectedRevision and payload.",
  bodyNotObject: "Send the withdrawal as one JSON object rather than a list, a string or a bare value.",
  bodyTooLarge: `Send the withdrawal as one JSON object of at most ${MAX_BODY_BYTES} bytes.`,
} as const;
type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };
const withdrawUpdateBodySchema = mutationInputSchema(z.custom<WirePayload<Parameters<typeof mutations.updates.withdrawUpdate>[1]["payload"], "withdrawUpdate">>());
const withdrawLocaleBodySchema = mutationInputSchema(z.custom<WirePayload<Parameters<typeof mutations.updates.withdrawLocale>[1]["payload"], "withdrawLocale">>());
const WITHDRAW_OPERATIONS = ["withdrawUpdate", "withdrawLocale"] as const;
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(WITHDRAW_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
type ReadBody = { readonly read: true; readonly body: unknown } | { readonly read: false; readonly message: string };
async function boundedBodyOf(request: SessionRequest): Promise<ReadBody> {
  if (!declaresJsonBody(request)) return { read: false, message: MESSAGES.bodyNotJson };
  const declared = request.headers.get("content-length");
  const declaredBytes = declared === null ? 0 : Number.parseInt(declared, 10);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) return { read: false, message: MESSAGES.bodyTooLarge };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return { read: false, message: MESSAGES.bodyTooLarge };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { read: false, message: MESSAGES.bodyNotJson };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { read: false, message: MESSAGES.bodyNotObject };
  return { read: true, body: parsed };
}
const unreadableBody = (message: string): Response => toResponse(outcomeFromError(UNIDENTIFIED_ATTEMPT, new ZodError([{ code: "custom", path: ["body"], message }])));
const WITHDRAW_WRITES = {
  withdrawUpdate: (raw, { operationId, sessionId }) => dispatch(withdrawUpdateBodySchema, raw, operationId, "operation", (input) => mutations.updates.withdrawUpdate(sessionId, input)),
  withdrawLocale: (raw, { operationId, sessionId }) => dispatch(withdrawLocaleBodySchema, raw, operationId, "operation", (input) => mutations.updates.withdrawLocale(sessionId, input)),
} satisfies Readonly<Record<(typeof WITHDRAW_OPERATIONS)[number], ClaimedWrite>>;
async function withdrawUpdate(request: SessionRequest): Promise<Response> {
  const read = await boundedBodyOf(request);
  if (!read.read) return unreadableBody(read.message);
  return claimedBodyRoute(request, read.body, discriminantSchema, (claim) => claim.payload.operation, WITHDRAW_WRITES);
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: withdrawUpdate });
