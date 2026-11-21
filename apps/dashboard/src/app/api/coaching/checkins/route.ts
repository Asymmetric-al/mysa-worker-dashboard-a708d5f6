/**
 * `GET /api/coaching/checkins` — the worker's own check-ins, private draft and shared revision apart —
 * and `POST /api/coaching/checkins`, the four named check-in changes.
 */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
/** The store reads and writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Both verbs resolve the development session and evaluate the scenario clock once per request. */
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
const READ_ATTEMPT_ID = "read";

const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: saveCheckIn, shareCheckIn, updateSharedCheckIn or withdrawCheckIn.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
// One payload type per named mutation, read from the mutation that validates it
type SaveCheckInPayload = Parameters<typeof mutations.coaching.saveCheckIn>[0]["payload"];

type ShareCheckInPayload = Parameters<typeof mutations.coaching.shareCheckIn>[0]["payload"];

type UpdateSharedCheckInPayload = Parameters<typeof mutations.coaching.updateSharedCheckIn>[0]["payload"];

type WithdrawCheckInPayload = Parameters<typeof mutations.coaching.withdrawCheckIn>[0]["payload"];

type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };
// One body schema per mutation: the four-field envelope around that mutation's own payload
const saveCheckInBodySchema = mutationInputSchema(z.custom<WirePayload<SaveCheckInPayload, "saveCheckIn">>());
const shareCheckInBodySchema = mutationInputSchema(z.custom<WirePayload<ShareCheckInPayload, "shareCheckIn">>());
const updateSharedCheckInBodySchema = mutationInputSchema(z.custom<WirePayload<UpdateSharedCheckInPayload, "updateSharedCheckIn">>());
const withdrawCheckInBodySchema = mutationInputSchema(z.custom<WirePayload<WithdrawCheckInPayload, "withdrawCheckIn">>());

const CHECK_IN_OPERATIONS = ["saveCheckIn", "shareCheckIn", "updateSharedCheckIn", "withdrawCheckIn"] as const;
// The read side: the page window the request stated, forwarded as it stands
type CheckInListQuery = Parameters<typeof reads.coaching.readCheckIns>[0];

function checkInListQueryOf(request: Request): CheckInListQuery {
  const params = new URL(request.url).searchParams;
  const page = params.get("page");
  const pageSize = params.get("pageSize");
  return {
    page: page === null ? undefined : Number(page),
    pageSize: pageSize === null ? undefined : Number(pageSize),
  };
}
// The write side: one named mutation per request
const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(CHECK_IN_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
  },
  { error: MESSAGES.bodyNotJson },
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
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}
async function dispatch<Wire extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<Wire>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<Wire, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
// The two verbs
/** One page of the worker's check-ins, each with its captured question set, its private draft revision, its shared revision and the states they stand in. */
export async function GET(request: Request): Promise<Response> {
  try {
    return toResponse(await reads.coaching.readCheckIns(checkInListQueryOf(request)));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and
    // a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** One named check-in mutation, selected by `payload.operation`. */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "saveCheckIn":
      return dispatch(saveCheckInBodySchema, raw, operationId, mutations.coaching.saveCheckIn);
    case "shareCheckIn":
      return dispatch(shareCheckInBodySchema, raw, operationId, mutations.coaching.shareCheckIn);
    case "updateSharedCheckIn":
      return dispatch(updateSharedCheckInBodySchema, raw, operationId, mutations.coaching.updateSharedCheckIn);
    case "withdrawCheckIn":
      return dispatch(withdrawCheckInBodySchema, raw, operationId, mutations.coaching.withdrawCheckIn);
    default:
      // Unreachable: the four names above are the closed set the discriminant schema admits, so a fifth
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled coaching check-in mutation");
  }
}
