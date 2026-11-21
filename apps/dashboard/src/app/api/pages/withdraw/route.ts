/**
 * `POST /api/pages/withdraw` — the two withdrawals of a Worker or Project Page: `withdrawPage`, which
 * contains every released edition of the page, and `withdrawLocale`, which contains exactly one
 * language edition and leaves its siblings released. The mutation is chosen by `payload.operation`.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { sessionIdOf } from "../../session-cookie";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every mutation resolves the development session and the scenario clock per request.
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
const MESSAGES = {
  operationRequired: "State which withdrawal this request makes as payload.operation: withdrawPage or withdrawLocale.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
type WithdrawPagePayload = Parameters<typeof mutations.pages.withdrawPage>[1]["payload"];

type WithdrawLocalePayload = Parameters<typeof mutations.pages.withdrawLocale>[1]["payload"];

type Routed<P> = P & { readonly operation: string };

const withdrawPageBodySchema = mutationInputSchema(z.custom<Routed<WithdrawPagePayload>>());
const withdrawLocaleBodySchema = mutationInputSchema(z.custom<Routed<WithdrawLocalePayload>>());

const WITHDRAW_OPERATIONS = ["withdrawPage", "withdrawLocale"] as const;

const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(WITHDRAW_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
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
async function dispatch<P extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<P>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<P, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    // An exception here is a defect rather than a presentation: the service answers refusals as
    // outcomes, so a throw means a store fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(operationId, error));
  }
}
/** One named withdrawal, selected by `payload.operation`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const sessionId = sessionIdOf(request);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "withdrawPage":
      return dispatch(withdrawPageBodySchema, raw, operationId, (input) => mutations.pages.withdrawPage(sessionId, input));
    case "withdrawLocale":
      return dispatch(withdrawLocaleBodySchema, raw, operationId, (input) => mutations.pages.withdrawLocale(sessionId, input));
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page withdrawal");
  }
}
