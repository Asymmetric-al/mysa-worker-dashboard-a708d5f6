/** The one copy of the request helpers every JSON mutation transport under `src/app/api` shares: the body readers, the attempt identity, the payload without its wire discriminant, and the dispatch that judges one body and calls one named mutation. A transport keeps only what is its own — the closed set of operations it admits, the messages for its fields, and the switch that names one mutation per request. */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT } from "@/modules/data-service/outcome";
import { sessionIdOf } from "./session-cookie";
export { UNIDENTIFIED_ATTEMPT };
const attemptIdentitySchema = z.object({ operationId: z.string() });
/** The bytes one JSON body may occupy when its transport states no ceiling of its own: 16 MiB, above every body the application sends today — the largest is a reviewed import acceptance, whose corrections echo cell text from a file of at most 5 MiB — and far below what an unbounded read would let one request buffer. A transport whose body is legitimately larger states its own ceiling to {@link readRequestBody}. */
export const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;
/** What reading one request's body produced: the value its JSON decodes to, the byte count at which the ceiling refused it, or the reason there is no value at all. */
export type RequestBodyRead = { readonly kind: "body"; readonly value: unknown } | { readonly kind: "oversized"; readonly bytes: number; readonly maxBytes: number } | { readonly kind: "unreadable" };
const utf8Decoder = new TextDecoder("utf-8");
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const joinChunks = (chunks: readonly Uint8Array[], totalBytes: number): Uint8Array => {
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
};
/** Reads one request's body up to `maxBytes`, so an over-size body is refused before any of it is parsed rather than after the whole of it is buffered: the declared `content-length` is judged first and costs no read at all, then the bytes are counted as they arrive and the stream is cancelled the moment the ceiling is passed. A body that arrives unreadable, or that is not JSON, is a request fault the caller can correct, answered `unreadable` here and as `invalid` by the body schema the transport always runs, never a thrown 500. A transport that admits only valid UTF-8 states `fatalUtf8`, so a byte sequence that is not valid UTF-8 is refused as unreadable rather than decoded with replacement characters. */
export async function readRequestBody(request: Request, maxBytes: number = DEFAULT_MAX_BODY_BYTES, fatalUtf8: boolean = false): Promise<RequestBodyRead> {
  const declaredLength = request.headers.get("content-length");
  const declaredBytes = declaredLength === null ? Number.NaN : Number(declaredLength);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) return { kind: "oversized", bytes: declaredBytes, maxBytes };
  const stream = request.body;
  if (stream === null) return { kind: "unreadable" };
  try {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined); // Cancelled rather than drained, so the rest of an over-size upload stops arriving; a cancel that fails leaves the refusal standing.
        return { kind: "oversized", bytes: receivedBytes, maxBytes };
      }
      chunks.push(value);
    }
    // Decoded as `request.json()` decoded it, so a byte sequence that is not valid UTF-8 stays the parse fault it was rather than a second refusal no ceiling asks for — unless this transport states that only valid UTF-8 is admitted, whose own decoder refuses it here.
    return { kind: "body", value: JSON.parse((fatalUtf8 ? strictUtf8Decoder : utf8Decoder).decode(joinChunks(chunks, receivedBytes))) as unknown };
  } catch {
    return { kind: "unreadable" };
  }
}
/** Reads one request's body as the value its JSON decodes to, or `undefined` for a body the reader refused or could not decode — the shape every transport's payload schema already answers as `invalid`. */
export async function jsonBodyOf(request: Request): Promise<unknown> {
  const body = await readRequestBody(request);
  return body.kind === "body" ? body.value : undefined;
}
/** The operation id a request names, read before its envelope is judged, or {@link UNIDENTIFIED_ATTEMPT} when it names none a caller could match an answer to. */
export function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
/** The identity one refused attempt is answered under: the operation id the body states, or the marker this path answers under where it states none a caller could match an answer to, or states one longer than the length this transport is willing to echo. */
export const refusalIdentityGiven =
  (unstated: string, echoedLimit: number = Number.POSITIVE_INFINITY) =>
  (raw: unknown): string => {
    const claimed = operationIdentityOf(raw);
    return claimed === UNIDENTIFIED_ATTEMPT || claimed.length > echoedLimit ? unstated : claimed;
  };
/** The payload the service validates: the wire's discriminant chooses which mutation runs, is this transport's own member rather than a field of any mutation's payload, whose schema is closed against unknown keys, and is removed here rather than forwarded as a member the service would refuse. A payload that is not one plain object — a scalar, `null` or a list — is returned as it arrived, for the service's own schema to refuse in its own words. */
export function payloadOf<Payload, Discriminant extends string>(payload: Payload, discriminant: Discriminant): Omit<Payload, Discriminant> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return payload as Omit<Payload, Discriminant>;
  const forwarded = { ...payload } as Record<string, unknown>;
  delete forwarded[discriminant];
  return forwarded as Omit<Payload, Discriminant>;
}
const anyEnvelopeSchema = mutationInputSchema(z.unknown());
/** Judges the shared envelope, then the named mutation's own payload schema, and calls that mutation with the envelope as it arrived: a payload fault keeps its payload-relative field keys, the ones the service's own refusal states. */
export async function writePayloadRoute(request: Request, payloadSchema: z.ZodType, run: (input: MutationInput<unknown>) => Promise<MutationOutcome>): Promise<Response> {
  const body = await jsonBodyOf(request);
  const envelope = anyEnvelopeSchema.safeParse(body);
  if (!envelope.success) return toResponse(outcomeFromError(operationIdentityOf(body), envelope.error));
  const payload = payloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) return toResponse(outcomeFromError(envelope.data.operationId, payload.error));
  return mutate(envelope.data.operationId, () => run(envelope.data));
}
/** Answers one mutation attempt that some judgement other than {@link dispatch} produced: the outcome the named mutation settled, and against a throw the outcome that names a store fault or a lost acknowledgement. */
export async function mutate(operationId: string, run: () => Promise<MutationOutcome>): Promise<Response> {
  try {
    return toResponse(await run());
  } catch (error) {
    return toResponse(outcomeFromError(operationId, error));
  }
}
/** Judges one request body against the schema of the single mutation a path carries and calls it: the same judgement {@link dispatch} makes, for a path whose closed operation set has one member, with the attempt identity the body itself states as the default. */
export async function writeRoute<Payload>(request: Request, schema: z.ZodType<MutationInput<Payload>>, run: (input: MutationInput<Payload>) => Promise<MutationOutcome>, identityOf: (raw: unknown) => string = operationIdentityOf): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = identityOf(raw);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return toResponse(outcomeFromError(operationId, parsed.error));
  try {
    return toResponse(await run(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
/** Judges one body against one mutation's own schema and calls that one named mutation: a body this schema refuses is answered as `invalid` with its messages keyed by field path and nothing read or written, and every answer crosses the one mapper that knows a store outage from a session that cannot be established from a lost acknowledgement. */
export async function dispatch<Payload, Discriminant extends string>(schema: z.ZodType<MutationInput<Payload>>, raw: unknown, operationId: string, discriminant: Discriminant, run: (input: MutationInput<Omit<Payload, Discriminant>>) => Promise<MutationOutcome>): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return toResponse(outcomeFromError(operationId, parsed.error));
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload, discriminant) }));
  } catch (error) {
    return toResponse(outcomeFromError(operationId, error));
  }
}
/** The identity one attempt is answered under: the operation id the caller stated, and the session the request travels in, which a mutation that acts on the session's own scope reads before it runs. */
export type AttemptIdentity = { readonly operationId: string; readonly sessionId: string };
/** One operation of a path's closed set, given the body exactly as it arrived: the operation's own payload schema judges that body next, and its mutation settles the outcome. */
export type ClaimedWrite = (raw: unknown, attempt: AttemptIdentity) => Promise<Response>;
/** One member of such a set, stated as its own data: the schema that judges its payload and the named mutation that applies it. */
export type ClaimedWritePart = readonly [schema: z.ZodType<MutationInput<unknown>>, run: (...args: never[]) => Promise<MutationOutcome>];
/** Builds a path's operation table from that table's own data, so a closed set of named operations is stated once rather than re-stated as one arrow per member: every member answers under the path's one discriminant and is judged by its own schema. */
export function claimedWrites<Operation extends string>(discriminant: string, parts: Readonly<Record<Operation, ClaimedWritePart>>): Readonly<Record<Operation, ClaimedWrite>> {
  const entries = Object.entries(parts) as [Operation, ClaimedWritePart][];
  return Object.fromEntries(entries.map(([operation, [schema, run]]): [Operation, ClaimedWrite] => [operation, (raw, { operationId }) => dispatch(schema, raw, operationId, discriminant, run as (input: MutationInput<unknown>) => Promise<MutationOutcome>)])) as Readonly<Record<Operation, ClaimedWrite>>;
}
/** Judges one body once for a path whose closed operation set names several mutations — a body that is not JSON, or whose `payload` names no operation the path admits, is answered `invalid` in the closed set's own words — and then runs the one operation it named. Every operation the path declares has a handler, and no other value reaches one. */
export async function claimedWriteRoute<Claim, Operation extends string>(request: NextRequest, claim: z.ZodType<Claim>, operationOf: (claim: Claim) => Operation, writes: Readonly<Record<Operation, ClaimedWrite>>): Promise<Response> {
  return claimedBodyRoute(request, await jsonBodyOf(request), claim, operationOf, writes);
}
/** The same judgement over a body the path's own transport read first — a size bound, a decoder, a text length it has to state — so a path whose body is not plain JSON still names its operations in one table. */
export async function claimedBodyRoute<Claim, Operation extends string>(request: NextRequest, raw: unknown, claim: z.ZodType<Claim>, operationOf: (claim: Claim) => Operation, writes: Readonly<Record<Operation, ClaimedWrite>>): Promise<Response> {
  const operationId = operationIdentityOf(raw);
  const claimed = claim.safeParse(raw);
  if (!claimed.success) return toResponse(outcomeFromError(operationId, claimed.error));
  return writes[operationOf(claimed.data)](raw, { operationId, sessionId: sessionIdOf(request) });
}
