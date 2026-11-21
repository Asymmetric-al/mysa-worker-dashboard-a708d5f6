/**
 * `POST /api/pages/release` — the four writes that carry one page edition from a frozen candidate to a
 * released edition: `submitForReview`, `approveCandidate`, `requestChanges` and `publishVariants`,
 * chosen by `payload.operation`.
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
  operationRequired: "State which step this request takes as payload.operation: submitForReview, approveCandidate, requestChanges or publishVariants.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
type SubmitForReviewPayload = Parameters<typeof mutations.pages.submitForReview>[1]["payload"];

type ApproveCandidatePayload = Parameters<typeof mutations.pages.approveCandidate>[1]["payload"];

type RequestChangesPayload = Parameters<typeof mutations.pages.requestChanges>[1]["payload"];

type PublishVariantsPayload = Parameters<typeof mutations.pages.publishVariants>[1]["payload"];

type Routed<P> = P & { readonly operation: string };

const submitForReviewBodySchema = mutationInputSchema(z.custom<Routed<SubmitForReviewPayload>>());
const approveCandidateBodySchema = mutationInputSchema(z.custom<Routed<ApproveCandidatePayload>>());
const requestChangesBodySchema = mutationInputSchema(z.custom<Routed<RequestChangesPayload>>());
const publishVariantsBodySchema = mutationInputSchema(z.custom<Routed<PublishVariantsPayload>>());

const RELEASE_OPERATIONS = ["submitForReview", "approveCandidate", "requestChanges", "publishVariants"] as const;

const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(RELEASE_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
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
/** One step of the page release ladder, selected by `payload.operation`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const sessionId = sessionIdOf(request);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "submitForReview":
      return dispatch(submitForReviewBodySchema, raw, operationId, (input) => mutations.pages.submitForReview(sessionId, input));
    case "approveCandidate":
      return dispatch(approveCandidateBodySchema, raw, operationId, (input) => mutations.pages.approveCandidate(sessionId, input));
    case "requestChanges":
      return dispatch(requestChangesBodySchema, raw, operationId, (input) => mutations.pages.requestChanges(sessionId, input));
    case "publishVariants":
      return dispatch(publishVariantsBodySchema, raw, operationId, (input) => mutations.pages.publishVariants(sessionId, input));
    default:
      // Unreachable: the four steps above are the closed set the discriminant schema admits, so a fifth
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page release mutation");
  }
}
