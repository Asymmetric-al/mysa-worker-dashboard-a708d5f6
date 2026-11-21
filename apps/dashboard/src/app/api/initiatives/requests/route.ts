/**
 * `GET /api/initiatives/requests` — one initiative's results, every count stated over the working
 * list it is measured against — and `POST /api/initiatives/requests`, the two changes that create one
 * Request and record what was presented: `draftRequest` and `presentRequest`.
 */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// Every request resolves the development session and evaluates the scenario clock once.
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const READ_ATTEMPT_ID = "read";

const READ_MESSAGES = {
  initiativeIdRequired: "Name the initiative whose results to read, so every count is stated over that initiative's own working list rather than over a wider set the caller never asked for.",
} as const;
// The read side: the one identifier this read is addressed by, taken from the request as it stands.
// The service owns the counts, their denominators and the scope, so nothing else is read here.
const initiativeResultsQuerySchema = z.strictObject({
  initiativeId: z.string({ error: READ_MESSAGES.initiativeIdRequired }).trim().min(1, READ_MESSAGES.initiativeIdRequired),
});
/**
 * Answers with one initiative's results inside the read's envelope — scope, source, revision, as-of
 * instant, coverage and the state of every value. Each count arrives as a numerator over the working
 * list it is measured against, and a refusal (`denied`, `unavailable`) arrives with nothing to leak.
 */
export async function GET(request: Request): Promise<Response> {
  const parsed = initiativeResultsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, parsed.error));
  }
  try {
    return toResponse(await reads.outreach.readInitiativeResults(parsed.data.initiativeId));
  } catch (error) {
    // A throw is a defect rather than a presentation: this read answers its refusals as results, so a
    // throw means the store or the session could not be read, and one mapper names which.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}

const PAYLOAD_OPERATION_MESSAGE = "State which change this request makes as payload.operation: draftRequest or presentRequest.";

const BODY_NOT_JSON_MESSAGE = "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.";

const REQUEST_OPERATIONS = ["draftRequest", "presentRequest"] as const;

type RequestPayload = Parameters<typeof mutations.outreach.draftRequest>[0]["payload"];

const requestBodySchema = mutationInputSchema(z.custom<RequestPayload>());

const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(REQUEST_OPERATIONS, { error: PAYLOAD_OPERATION_MESSAGE }) }, { error: PAYLOAD_OPERATION_MESSAGE }),
  },
  { error: BODY_NOT_JSON_MESSAGE },
);
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
function payloadOf(payload: RequestPayload): RequestPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return payload;
  }
  const { operation: _discriminant, ...forwarded } = payload as Readonly<Record<string, unknown>>;
  return forwarded;
}
async function dispatch(
  schema: z.ZodType<MutationInput<RequestPayload>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<RequestPayload>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    return toResponse(outcomeFromError(operationId, error));
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
      return dispatch(requestBodySchema, raw, operationId, mutations.outreach.draftRequest);
    case "presentRequest":
      return dispatch(requestBodySchema, raw, operationId, mutations.outreach.presentRequest);
    default:
      // Unreachable: the two names above are the closed set the discriminant admits, so a third
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled Request mutation");
  }
}
