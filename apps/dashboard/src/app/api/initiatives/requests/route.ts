/** `GET /api/initiatives/requests` — one initiative's results, every count stated over the working list it is measured against — and `POST /api/initiatives/requests`, the two changes that create one … */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { draftRequestPayloadSchema, mutationInputSchema, mutations, outcomeFromError, presentRequestPayloadSchema, refusedRead, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf, payloadOf } from "../../handler";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// Every request resolves the development session and evaluates the scenario clock once.
export const dynamic = "force-dynamic";
const READ_ATTEMPT_ID = "read";
const READ_MESSAGES = { initiativeIdRequired: "Name the initiative whose results to read, so every count is stated over that initiative's own working list rather than over a wider set the caller never asked for." } as const;
// The read side: the one identifier this read is addressed by, taken from the request as it stands. The service owns the counts, their denominators and the scope, so nothing else is read here.
const initiativeResultsQuerySchema = z.strictObject({ initiativeId: z.string({ error: READ_MESSAGES.initiativeIdRequired }).trim().min(1, READ_MESSAGES.initiativeIdRequired) });
/** Answers with one initiative's results inside the read's envelope — scope, source, revision, as-of instant, coverage and the state of every value. */
export async function GET(request: Request): Promise<Response> {
  const parsed = initiativeResultsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return toResponse(refusedRead(READ_ATTEMPT_ID, parsed.error));
  }
  try {
    return toResponse(await reads.outreach.readInitiativeResults(parsed.data.initiativeId));
  } catch (error) {
    // A throw is a defect rather than a presentation: this read answers its refusals as results, so a throw means the store or the session could not be read, and one mapper names which.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
const PAYLOAD_OPERATION_MESSAGE = "State which change this request makes as payload.operation: draftRequest or presentRequest.";
const BODY_NOT_JSON_MESSAGE = "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.";
const REQUEST_OPERATIONS = ["draftRequest", "presentRequest"] as const;
// The envelope is judged by the shared schema, and the payload by the schema of the mutation that `payload.operation` names — one authority per mutation, never one schema shared between them — so a payload fault keeps its payload-relative field keys, the ones the service's own refusal states.
const requestEnvelopeSchema = mutationInputSchema(z.unknown());
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(REQUEST_OPERATIONS, { error: PAYLOAD_OPERATION_MESSAGE }) }, { error: PAYLOAD_OPERATION_MESSAGE }) }, { error: BODY_NOT_JSON_MESSAGE });
/** The two-step dispatch this path needs: the envelope and then the named mutation's own payload schema, each reporting the fields it refused rather than the union of every fault a single composed schema would state. */
async function dispatch<P>(schema: z.ZodType<P>, raw: unknown, operationId: string, run: (input: MutationInput<unknown>) => Promise<MutationOutcome>): Promise<Response> {
  const envelope = requestEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return toResponse(outcomeFromError(operationId, envelope.error));
  }
  // `operation` routes the request and is not part of the change, so it is stripped before the named mutation's own schema judges what is left. The change is then handed on exactly as it arrived: the service validates the same wire payload with the same schema before it reads anything, so a civil
  // date resolves to a day once, there.
  const forwarded = payloadOf(envelope.data.payload, "operation");
  const payload = schema.safeParse(forwarded);
  if (!payload.success) {
    return toResponse(outcomeFromError(envelope.data.operationId, payload.error));
  }
  try {
    return toResponse(await run({ ...envelope.data, payload: forwarded }));
  } catch (error) {
    return toResponse(outcomeFromError(envelope.data.operationId, error));
  }
}
/** One named Request change, selected by `payload.operation`. */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "draftRequest":
      return dispatch(draftRequestPayloadSchema, raw, operationId, mutations.outreach.draftRequest);
    case "presentRequest":
      return dispatch(presentRequestPayloadSchema, raw, operationId, mutations.outreach.presentRequest);
    default:
      // Unreachable: the two names above are the closed set the discriminant admits, so a third mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled Request mutation");
  }
}
