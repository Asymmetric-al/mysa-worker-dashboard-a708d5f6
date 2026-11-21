/**
 * `POST /api/pages/reach` — how far a released page reaches: `setReach`, which gives every released
 * edition of one page the reach the worker chose, and `stopShowingPublicly`, which contains it. The
 * mutation is chosen by `payload.operation` (AAP 0.6.3 endpoint list; the 0.7.1 "Build and release a
 * Page" job; criterion 12).
 *
 * Reach is exactly three values — Not public, Shared by link: public (reachable by direct link,
 * unlisted and excluded from search indexing) and Listed publicly — with no fourth value and no
 * per-locale or per-person exception (AAP 0.8.6). That vocabulary and the containment rule belong to
 * `apps/dashboard/src/modules/content/reach.ts`, which a Route Handler may not import, so this file
 * forwards the payload untouched and the service's `decideReach` remains the only rule; nothing about
 * reach is decided at the transport.
 *
 * Containment is a publication decision, not an editorial cleanup: `stopShowingPublicly` is accepted
 * while an unrelated draft of the same page is invalid, and it contains every locale edition at once
 * (AAP 0.8.6; criterion 12). Nothing here validates a draft, parses prose or pre-reads the page —
 * refusal at this boundary would turn containment into the editorial cleanup it is not.
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
  operationRequired: "State which reach change this request makes as payload.operation: setReach or stopShowingPublicly.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
type SetReachPayload = Parameters<typeof mutations.pages.setReach>[1]["payload"];

type StopShowingPubliclyPayload = Parameters<typeof mutations.pages.stopShowingPublicly>[1]["payload"];

type Routed<P> = P & { readonly operation: string };

const setReachBodySchema = mutationInputSchema(z.custom<Routed<SetReachPayload>>());
const stopShowingPubliclyBodySchema = mutationInputSchema(z.custom<Routed<StopShowingPubliclyPayload>>());

const REACH_OPERATIONS = ["setReach", "stopShowingPublicly"] as const;

const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(REACH_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
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
/** One named reach change, selected by `payload.operation`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const sessionId = sessionIdOf(request);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "setReach":
      return dispatch(setReachBodySchema, raw, operationId, (input) => mutations.pages.setReach(sessionId, input));
    case "stopShowingPublicly":
      // No draft check and no pre-read before this dispatch: containment has to succeed even while a
      // sibling draft of the page is invalid, and the service contains every locale edition in one go.
      return dispatch(stopShowingPubliclyBodySchema, raw, operationId, (input) => mutations.pages.stopShowingPublicly(sessionId, input));
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page reach change");
  }
}
