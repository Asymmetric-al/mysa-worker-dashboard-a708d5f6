/**
 * The Worker and Project Pages family's own read path and its two edition-level writes: `GET
 * /api/pages` and `POST /api/pages`.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// The read resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const READ_ATTEMPT_ID = "read";
const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: createVariant or saveDraft.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
type CreateVariantPayload = Parameters<typeof mutations.pages.createVariant>[1]["payload"];

type SaveDraftPayload = Parameters<typeof mutations.pages.saveDraft>[1]["payload"];

type Routed<P> = P & { readonly operation: string };

const createVariantBodySchema = mutationInputSchema(z.custom<Routed<CreateVariantPayload>>());
const saveDraftBodySchema = mutationInputSchema(z.custom<Routed<SaveDraftPayload>>());

const PAGE_OPERATIONS = ["createVariant", "saveDraft"] as const;

const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(PAGE_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
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
/** The page the request addresses, or the family's catalogues when it addresses none. */
export async function GET(request: NextRequest): Promise<Response> {
  const pageId = new URL(request.url).searchParams.get("pageId");
  try {
    return toResponse(pageId === null ? await reads.pages.readPageCatalogues() : await reads.pages.readPage({ pageId }));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and
    // a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** One named page-edition mutation, selected by `payload.operation`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const sessionId = sessionIdOf(request);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "createVariant":
      return dispatch(createVariantBodySchema, raw, operationId, (input) => mutations.pages.createVariant(sessionId, input));
    case "saveDraft":
      return dispatch(saveDraftBodySchema, raw, operationId, (input) => mutations.pages.saveDraft(sessionId, input));
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page edition mutation");
  }
}
