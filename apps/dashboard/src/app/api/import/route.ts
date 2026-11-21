/** `POST /api/import` — the one browser transport for `proposeImport`, the call that turns the file a worker chose into a reviewable proposal. */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../handler";
/** The store the service writes through uses `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** The development session and the scenario instant are resolved per request, never prerendered or cached. */
export const dynamic = "force-dynamic";
/** The ceiling on the base64 one request may carry: 8,388,608 characters, a little over six MiB of file bytes. */
const CONTENT_BASE64_MAX_CHARS = 8_388_608;
const FILE_NAME_MAX_CHARS = 255;
/** The payload `proposeImport` accepts, taken from the mutation that validates it so the two cannot drift. */
type ProposeImportPayload = Parameters<typeof mutations.import.proposeImport>[0]["payload"];
const proposeImportBodySchema = mutationInputSchema(
  z.strictObject({
    // Display metadata only: the file's type is decided from its content by the service, never by its name.
    fileName: z.string().min(1, { error: "fileName must name the chosen file." }).max(FILE_NAME_MAX_CHARS, { error: "fileName is longer than a file name can be." }),
    contentBase64: z.string().max(CONTENT_BASE64_MAX_CHARS, { error: "contentBase64 holds more of a file than one import request can carry (8,388,608 characters); choose a smaller file." }),
    // Presence only. A confirmed mapping's shape is the mutation's own closed schema, which validates the very same payload before any state change; restating it here would be a second authority over a contract this file does not own, and no mapping entry is read at the transport.
    confirmedMapping: z.custom<NonNullable<ProposeImportPayload["confirmedMapping"]>>().optional(),
  }),
);
function isBodyObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Proposes an import from the file the body carries, and answers with exactly one of the service's eight outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  // A body that is not a JSON object and one that breaks a rule reach the caller the same way: as the `invalid` outcome, with messages keyed by field path and nothing read and nothing written. An absent object is judged as an absent envelope rather than reported as a parse
  // fault, so the caller is told which members the mutation needs instead of that its JSON was malformed.
  const parsed = proposeImportBodySchema.safeParse(isBodyObject(body) ? body : {});
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  try {
    return toResponse(await mutations.import.proposeImport(parsed.data));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known, and the one mapper tells those apart so neither becomes a proposal that was never built.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
