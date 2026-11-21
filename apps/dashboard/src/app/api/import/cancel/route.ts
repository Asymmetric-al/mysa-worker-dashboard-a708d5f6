/** `POST /api/import/cancel` — the one browser transport for `cancelImport`, the call that stops the unaccepted rows of a contact import still in flight (AAP 0.6.3 API table; AAP 0.9.1 "`api/` — thin … */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../../handler";
/** The store behind the service writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** The change resolves the development session and the scenario instant once per request, so no cancellation may be answered from a cache. */
export const dynamic = "force-dynamic";
/** The payload `cancelImport` accepts, read from the mutation that validates it, so this path cannot drift from the contract it forwards to. */
type CancelImportPayload = Parameters<typeof mutations.import.cancelImport>[0]["payload"];
/** The payload this path accepts: nothing beyond the four-field envelope, and strict about it. */
const cancelPayloadSchema: z.ZodType<CancelImportPayload> = z.strictObject({});
/** The one shape guard every cancellation runs before any state change: the four-field envelope around that empty payload. */
const cancelRequestSchema = mutationInputSchema(cancelPayloadSchema);
function isBodyObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Stops only the unaccepted rows of an in-flight import and answers with exactly one of the eight mutation outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown` — so an accepted contact stays accepted. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  // A body that is not a JSON object and one that breaks a rule reach the caller the same way: as the `invalid` outcome, with messages keyed by field path and nothing read and nothing written. An absent
  // object is judged as an absent envelope rather than reported as a parse fault, so the caller is told which members the mutation needs instead of that its JSON was malformed.
  const parsed = cancelRequestSchema.safeParse(isBodyObject(body) ? body : {});
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  }
  try {
    // Forwarded untouched: the operation id is the caller's identity for the attempt rather than one this path mints, the scope is only the context the service re-derives authority for before it acts, and the expected revision is what turns a stale caller into a conflict instead of an overwrite.
    return toResponse(await mutations.import.cancelImport(parsed.data));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes, so a throw means a store fault, or a failure whose fate is not known, and the one mapper tells those apart so neither becomes a cancellation that never took effect.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
