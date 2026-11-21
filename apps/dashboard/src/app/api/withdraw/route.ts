/**
 * `POST /api/withdraw` — the two withdrawals a Ministry Update admits: `withdrawUpdate`, which contains
 * every released edition of one Update inside this application, and `withdrawLocale`, which contains
 * exactly one language edition and leaves its siblings released. The mutation is chosen by
 * `payload.operation`, and the answer is one of the eight mutation outcomes.
 */
import { ZodError, z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
// The store writes through `node:fs`, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every withdrawal resolves the development session and evaluates the scenario clock per request.
export const dynamic = "force-dynamic";

// The session the mutation acts for is the one the request itself carries: the service resolves that
// cookie, re-checks the scope the body claims against it and decides the authority, so this handler
// reads the identity and judges nothing.
type SessionRequest = Parameters<typeof sessionIdOf>[0];

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
// A withdrawal states four fields and one identifier, so this ceiling leaves room for padding and
// refuses anything that is not a withdrawal before the parser sees it.
const MAX_BODY_BYTES = 16_384;

const MESSAGES = {
  operationRequired: "State which withdrawal this request makes as payload.operation: withdrawUpdate or withdrawLocale.",
  bodyNotJson: "Send the withdrawal as a JSON object carrying operationId, scope, expectedRevision and payload.",
  bodyNotObject: "Send the withdrawal as one JSON object rather than a list, a string or a bare value.",
  bodyTooLarge: `Send the withdrawal as one JSON object of at most ${MAX_BODY_BYTES} bytes.`,
} as const;

// One payload type per named withdrawal, read from the mutation that validates it
type WithdrawUpdatePayload = Parameters<typeof mutations.updates.withdrawUpdate>[1]["payload"];

type WithdrawLocalePayload = Parameters<typeof mutations.updates.withdrawLocale>[1]["payload"];

type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };
// One body schema per withdrawal: the four-field envelope around that mutation's own payload
const withdrawUpdateBodySchema = mutationInputSchema(z.custom<WirePayload<WithdrawUpdatePayload, "withdrawUpdate">>());
const withdrawLocaleBodySchema = mutationInputSchema(z.custom<WirePayload<WithdrawLocalePayload, "withdrawLocale">>());

const WITHDRAW_OPERATIONS = ["withdrawUpdate", "withdrawLocale"] as const;

const attemptIdentitySchema = z.object({ operationId: z.string() });

// The discriminant is read before the envelope, so a request that names no withdrawal is told which
// two it may name instead of being judged on the rest of its body first.
const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(WITHDRAW_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
  },
  { error: MESSAGES.bodyNotJson },
);

type ReadBody = { readonly read: true; readonly body: unknown } | { readonly read: false; readonly message: string };

async function jsonBodyOf(request: SessionRequest): Promise<ReadBody> {
  const declared = request.headers.get("content-length");
  const declaredBytes = declared === null ? 0 : Number.parseInt(declared, 10);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
    return { read: false, message: MESSAGES.bodyTooLarge };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { read: false, message: MESSAGES.bodyTooLarge };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { read: false, message: MESSAGES.bodyNotJson };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { read: false, message: MESSAGES.bodyNotObject };
  }
  return { read: true, body: parsed };
}
// A body this handler could not read at all still answers in the one outcome vocabulary, with the
// message keyed to the body, rather than escaping the boundary as a framework error.
function unreadableBody(message: string): Response {
  return toResponse(outcomeFromError(UNIDENTIFIED_ATTEMPT, new ZodError([{ code: "custom", path: ["body"], message }])));
}
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
// The discriminant names the mutation; it is not a field of the payload the service validates.
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
    // A throw here is a store fault or a failure whose fate is not known, never a refusal: the
    // service answers refusals as outcomes, so the one mapper turns a fault into the answer a caller
    // can act on, and it carries this attempt's operation id so the same attempt can be re-queried.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
/** Withdraws every released edition of one Update, or exactly one language edition of it, in the ministry this session is acting in: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: SessionRequest): Promise<Response> {
  const sessionId = sessionIdOf(request);
  const read = await jsonBodyOf(request);
  if (!read.read) {
    return unreadableBody(read.message);
  }
  const operationId = operationIdentityOf(read.body);
  const claimed = discriminantSchema.safeParse(read.body);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "withdrawUpdate":
      // The whole Update, named by its document and nothing else: a caller-supplied edition list could
      // hold a subset while the caller believed it held the Update, so it is not part of the payload.
      return dispatch(withdrawUpdateBodySchema, read.body, operationId, (input) => mutations.updates.withdrawUpdate(sessionId, input));
    case "withdrawLocale":
      // One edition, named by its variant id alone: a locale is a display value rather than an
      // identity, so it is never used to derive which edition this call acts on.
      return dispatch(withdrawLocaleBodySchema, read.body, operationId, (input) => mutations.updates.withdrawLocale(sessionId, input));
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third
      // withdrawal fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled update withdrawal");
  }
}
