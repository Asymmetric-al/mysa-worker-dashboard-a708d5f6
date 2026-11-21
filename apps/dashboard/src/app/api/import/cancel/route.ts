/**
 * `POST /api/import/cancel` — the one browser transport for `cancelImport`, the call that stops the unaccepted rows of a contact import still in flight (AAP 0.6.3 API table; AAP 0.9.1 "`api/` — thin adapters: no business logic, no self-fetch"; AAP 0.7.1 job "Bring in a contact list"; AAP 0.10.1 "Contact import" and AAP 0.12.1 criterion 4).
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";

/** The store behind the service writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";

/** The change resolves the development session and the scenario instant once per request, so no cancellation may be answered from a cache. */
export const dynamic = "force-dynamic";

/** The payload `cancelImport` accepts, read from the mutation that validates it, so this path cannot drift from the contract it forwards to. */
type CancelImportPayload = Parameters<typeof mutations.import.cancelImport>[0]["payload"];

/**
 * The payload this path accepts: nothing beyond the four-field envelope, and strict about it. Its key set —
 * no key at all — mirrors `features/import/schemas/acceptance.ts`'s `cancelPayloadSchema`, the schema the
 * browser checks the same payload against before it posts here. The names are copied rather than imported,
 * because a Route Handler reaches the data service and nothing else, so no feature module — nor the
 * browser-facing client family it belongs to — is pulled into the server.
 */
const cancelPayloadSchema: z.ZodType<CancelImportPayload> = z.strictObject(
  {},
  {
    // An unexpected member is named in the refusal, because the caller sent a payload field this mutation
    // has no use for: no "cancel all", no override, no notification belongs to stopping an import.
    error: (issue) => (issue.code === "unrecognized_keys" ? `cancelImport takes no payload fields: remove ${issue.keys.map((key) => JSON.stringify(key)).join(", ")}.` : issue.message),
  },
);

/** The one shape guard every cancellation runs before any state change: the four-field envelope around that empty payload. */
const cancelRequestSchema = mutationInputSchema(cancelPayloadSchema);

/** The identity a refusal answers for when the body never stated one, so every answer names its attempt. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

function isBodyObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The attempt the refusal answers for. The operation id is the caller's own — minted by the client and
 * forwarded byte for byte, because a replay is recognised by that identity and never by a repeated payload
 * — so a body that named none is answered for an unnamed attempt rather than a fabricated one.
 */
function attemptIdOf(body: unknown): string {
  if (!isBodyObject(body)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed = body["operationId"];
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}

/** Stops only the unaccepted rows of an in-flight import and answers with exactly one of the eight mutation outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown` — so an accepted contact stays accepted. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  // A body that is not a JSON object and one that breaks a rule reach the caller the same way: as the
  // `invalid` outcome, with messages keyed by field path and nothing read and nothing written. An absent
  // object is judged as an absent envelope rather than reported as a parse fault, so the caller is told
  // which members the mutation needs instead of that its JSON was malformed.
  const parsed = cancelRequestSchema.safeParse(isBodyObject(body) ? body : {});
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    // Forwarded untouched: the operation id is the caller's identity for the attempt rather than one this
    // path mints, the scope is only the context the service re-derives authority for before it acts, and
    // the expected revision is what turns a stale caller into a conflict instead of an overwrite.
    return toResponse(await mutations.import.cancelImport(parsed.data));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes, so a
    // throw means a store fault, or a failure whose fate is not known, and the one mapper tells those apart
    // so neither becomes a cancellation that never took effect.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
