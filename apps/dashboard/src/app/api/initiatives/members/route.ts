/**
 * `POST /api/initiatives/members` — the three changes that act on one initiative's reviewed working
 * list: `addMembers`, `removeMember` and `returnMember`.
 */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// Every request resolves the development session and evaluates the scenario clock once.
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const PAYLOAD_OPERATION_MESSAGE = "State which change this request makes as payload.operation: addMembers, removeMember or returnMember.";

const BODY_NOT_JSON_MESSAGE = "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.";

const MEMBER_OPERATIONS = ["addMembers", "removeMember", "returnMember"] as const;

type MemberPayload = Parameters<typeof mutations.outreach.addMembers>[0]["payload"];

const memberRequestSchema = mutationInputSchema(z.custom<MemberPayload>());

const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(MEMBER_OPERATIONS, { error: PAYLOAD_OPERATION_MESSAGE }) }, { error: PAYLOAD_OPERATION_MESSAGE }),
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
function payloadOf(payload: MemberPayload): MemberPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return payload;
  }
  const { operation: _discriminant, ...forwarded } = payload as Readonly<Record<string, unknown>>;
  return forwarded;
}
async function dispatch(schema: z.ZodType<MutationInput<MemberPayload>>, raw: unknown, operationId: string, run: (input: MutationInput<MemberPayload>) => Promise<MutationOutcome>): Promise<Response> {
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
/** One named working-list change, selected by `payload.operation`. */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "addMembers":
      return dispatch(memberRequestSchema, raw, operationId, mutations.outreach.addMembers);
    case "removeMember":
      return dispatch(memberRequestSchema, raw, operationId, mutations.outreach.removeMember);
    case "returnMember":
      return dispatch(memberRequestSchema, raw, operationId, mutations.outreach.returnMember);
    default:
      // Unreachable: the three names above are the closed set the discriminant admits, so a fourth
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled working-list mutation");
  }
}
