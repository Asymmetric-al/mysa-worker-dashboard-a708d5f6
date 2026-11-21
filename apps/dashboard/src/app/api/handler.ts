/** The one copy of the four request helpers every JSON mutation transport under `src/app/api` shares: the body reader, the attempt identity, the payload without its wire discriminant, and the dispatch that judges one body and calls one named mutation. A transport keeps only what is its own — the closed set of operations it admits, the messages for its fields, and the switch that names one mutation per request. */
import { z } from "zod";
import { outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT } from "@/modules/data-service/outcome";

/** The identity a mutation attempt is reported under when its body carries none, so a request whose body never became a value still answers in the one outcome shape rather than escaping the boundary. Its one declaration sits beside the echo rule in the outcome module, which the ledger states an attempt under as well, and it is re-exported here so a transport reads it from the module it already takes its other three helpers from. */
export { UNIDENTIFIED_ATTEMPT };

const attemptIdentitySchema = z.object({ operationId: z.string() });

/** Reads one request's body. A body that is not JSON is a request fault the caller can correct, answered as `invalid` by the body schema the transport always runs, never a thrown 500. */
export async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** The operation id a request names, read before its envelope is judged, or {@link UNIDENTIFIED_ATTEMPT} when it names none a caller could match an answer to. */
export function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}

/** The payload the service validates: the wire's discriminant chooses which mutation runs, is this transport's own member rather than a field of any mutation's payload, whose schema is closed against unknown keys, and is removed here rather than forwarded as a member the service would refuse. A payload that is not one plain object — a scalar, `null` or a list — is returned as it arrived, for the service's own schema to refuse in its own words. */
export function payloadOf<Payload, Discriminant extends string>(payload: Payload, discriminant: Discriminant): Omit<Payload, Discriminant> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return payload as Omit<Payload, Discriminant>;
  }
  const forwarded = { ...payload } as Record<string, unknown>;
  delete forwarded[discriminant];
  return forwarded as Omit<Payload, Discriminant>;
}

/** Judges one body against one mutation's own schema and calls that one named mutation: a body this schema refuses is answered as `invalid` with its messages keyed by field path and nothing read or written, and every answer crosses the one mapper that knows a store outage from a session that cannot be established from a lost acknowledgement. */
export async function dispatch<Payload, Discriminant extends string>(schema: z.ZodType<MutationInput<Payload>>, raw: unknown, operationId: string, discriminant: Discriminant, run: (input: MutationInput<Omit<Payload, Discriminant>>) => Promise<MutationOutcome>): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    // The validated envelope travels as it arrived: the operation identity is the attempt's own, and the scope and the expected revision are the caller's claims for the service to verify.
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload, discriminant) }));
  } catch (error) {
    // A throw is a defect rather than a presentation: the service answers refusals as outcomes, so this is a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(operationId, error));
  }
}
