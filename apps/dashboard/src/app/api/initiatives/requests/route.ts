import type { NextRequest } from "next/server";
import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { draftRequestPayloadSchema, mutationInputSchema, mutations, outcomeFromError, presentRequestPayloadSchema, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { claimedWriteRoute, mutate, payloadOf, type ClaimedWrite } from "../../handler";
import { readGrammar, readRoute } from "../../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const READ_MESSAGES = { initiativeIdRequired: "Name the initiative whose results to read, so every count is stated over that initiative's own working list rather than over a wider set the caller never asked for." } as const;
const initiativeResultsQuerySchema = z.strictObject({ initiativeId: z.string({ error: READ_MESSAGES.initiativeIdRequired }).trim().min(1, READ_MESSAGES.initiativeIdRequired) });
const readRequestResults = readRoute(
  readGrammar(initiativeResultsQuerySchema, (search) => Object.fromEntries(search)),
  (query) => reads.outreach.readInitiativeResults(query.initiativeId),
);
const PAYLOAD_OPERATION_MESSAGE = "State which change this request makes as payload.operation: draftRequest or presentRequest.";
const REQUEST_OPERATIONS = ["draftRequest", "presentRequest"] as const;
const requestEnvelopeSchema = mutationInputSchema(z.unknown());
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(REQUEST_OPERATIONS, { error: PAYLOAD_OPERATION_MESSAGE }) }, { error: PAYLOAD_OPERATION_MESSAGE }) }, { error: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload." });
async function dispatch(schema: z.ZodType, raw: unknown, operationId: string, run: (input: MutationInput<unknown>) => Promise<MutationOutcome>): Promise<Response> {
  const envelope = requestEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return toResponse(outcomeFromError(operationId, envelope.error));
  const forwarded = payloadOf(envelope.data.payload, "operation");
  const payload = schema.safeParse(forwarded);
  if (!payload.success) return toResponse(outcomeFromError(envelope.data.operationId, payload.error));
  return mutate(envelope.data.operationId, () => run({ ...envelope.data, payload: forwarded }));
}
const REQUEST_WRITES = { draftRequest: (raw, { operationId }) => dispatch(draftRequestPayloadSchema, raw, operationId, mutations.outreach.draftRequest), presentRequest: (raw, { operationId }) => dispatch(presentRequestPayloadSchema, raw, operationId, mutations.outreach.presentRequest) } satisfies Readonly<
  Record<(typeof REQUEST_OPERATIONS)[number], ClaimedWrite>
>;
const changeRequest = (request: NextRequest): Promise<Response> => claimedWriteRoute(request, discriminantSchema, (claim) => claim.payload.operation, REQUEST_WRITES);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readRequestResults, POST: changeRequest });
