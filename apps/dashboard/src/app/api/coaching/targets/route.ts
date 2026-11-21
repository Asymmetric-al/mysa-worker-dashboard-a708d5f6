/**
 * `GET /api/coaching/targets` — the worker's own targets and their measured periods — and `POST
 * /api/coaching/targets`, the four named changes a target admits.
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
  operationRequired: "State which change this request makes as payload.operation: saveTarget, editTarget, pauseTarget or endTarget.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
// One payload type per named mutation, read from the mutation that validates it
type SaveTargetPayload = Parameters<typeof mutations.coaching.saveTarget>[0]["payload"];

type EditTargetPayload = Parameters<typeof mutations.coaching.editTarget>[0]["payload"];

type PauseTargetPayload = Parameters<typeof mutations.coaching.pauseTarget>[0]["payload"];

type EndTargetPayload = Parameters<typeof mutations.coaching.endTarget>[0]["payload"];

type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };
// One body schema per mutation: the four-field envelope around that mutation's own payload
const saveTargetBodySchema = mutationInputSchema(z.custom<WirePayload<SaveTargetPayload, "saveTarget">>());
const editTargetBodySchema = mutationInputSchema(z.custom<WirePayload<EditTargetPayload, "editTarget">>());
const pauseTargetBodySchema = mutationInputSchema(z.custom<WirePayload<PauseTargetPayload, "pauseTarget">>());
const endTargetBodySchema = mutationInputSchema(z.custom<WirePayload<EndTargetPayload, "endTarget">>());

const TARGET_OPERATIONS = ["saveTarget", "editTarget", "pauseTarget", "endTarget"] as const;
// The read side: the page window the request stated, forwarded as it stands
type TargetListQuery = Parameters<typeof reads.coaching.readTargets>[0];

function targetListQueryOf(request: Request): TargetListQuery {
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
    payload: z.object({ operation: z.enum(TARGET_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
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
/** One page of the worker's targets, each with its versions and its measured periods. */
export async function GET(request: Request): Promise<Response> {
  try {
    return toResponse(await reads.coaching.readTargets(targetListQueryOf(request)));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and
    // a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** One named target mutation, selected by `payload.operation`. */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "saveTarget":
      return dispatch(saveTargetBodySchema, raw, operationId, mutations.coaching.saveTarget);
    case "editTarget":
      return dispatch(editTargetBodySchema, raw, operationId, mutations.coaching.editTarget);
    case "pauseTarget":
      return dispatch(pauseTargetBodySchema, raw, operationId, mutations.coaching.pauseTarget);
    case "endTarget":
      return dispatch(endTargetBodySchema, raw, operationId, mutations.coaching.endTarget);
    default:
      // Unreachable: the four names above are the closed set the discriminant schema admits, so a fifth
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled coaching target mutation");
  }
}
