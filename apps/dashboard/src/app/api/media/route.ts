/**
 * `POST /api/media` — the browser transport for media registration and placement.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
// The store writes through node:fs and media preparation loads Node-API native bindings, so this
// handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every request resolves the development session and evaluates the scenario clock afresh.
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: registerMediaAsset, replacePlacement or removePlacement.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
// One body schema per mutation: the four-field envelope, with that mutation's own payload type
//
// Each payload type is taken from the mutation that validates it, so a field the service adds, renames
// or bounds differently is a compile error here instead of a second declaration that drifts. No payload
// field is restated, because the mutation's own closed schema already answers for every one of them.
type RegisterMediaAssetPayload = Parameters<typeof mutations.media.registerMediaAsset>[1]["payload"];

type PlacementTargetPayload = Parameters<typeof mutations.media.replacePlacement>[1]["payload"];

type RegisterMediaAssetRequest = RegisterMediaAssetPayload & {
  readonly operation: "registerMediaAsset";
};
type ReplacePlacementRequest = PlacementTargetPayload & { readonly operation: "replacePlacement" };

type RemovePlacementRequest = PlacementTargetPayload & { readonly operation: "removePlacement" };

const MEDIA_OPERATIONS = ["registerMediaAsset", "replacePlacement", "removePlacement"] as const;

const registerMediaAssetBodySchema = mutationInputSchema(z.custom<RegisterMediaAssetRequest>());

const replacePlacementBodySchema = mutationInputSchema(z.custom<ReplacePlacementRequest>());

const removePlacementBodySchema = mutationInputSchema(z.custom<RemovePlacementRequest>());
// Reading the request
const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(MEDIA_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
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
  return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
}
// The one verb
/** One named media mutation, selected by `payload.operation`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  try {
    const sessionId = sessionIdOf(request);
    switch (claimed.data.payload.operation) {
      case "registerMediaAsset":
        return await dispatch(registerMediaAssetBodySchema, raw, operationId, (input) => mutations.media.registerMediaAsset(sessionId, input));
      case "replacePlacement":
        return await dispatch(replacePlacementBodySchema, raw, operationId, (input) => mutations.media.replacePlacement(sessionId, input));
      case "removePlacement":
        return await dispatch(removePlacementBodySchema, raw, operationId, (input) => mutations.media.removePlacement(sessionId, input));
      default:
        // Unreachable: the three names above are the closed set the discriminant schema admits, so a
        // fourth mutation fails to compile at this call instead of reaching the runtime.
        return assertNever(claimed.data.payload.operation, "Unhandled media mutation");
    }
  } catch (error) {
    // An exception here is a defect rather than a presentation: the service answers refusals as
    // outcomes, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(operationId, error));
  }
}
