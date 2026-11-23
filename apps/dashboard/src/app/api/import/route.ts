import { z, ZodError } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { IMPORT_MAX_BYTES } from "@/modules/import/parse";
import { UNIDENTIFIED_ATTEMPT, mutate, operationIdentityOf, readRequestBody } from "../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CONTENT_BASE64_MAX_CHARS = 8_388_608;
const FILE_NAME_MAX_CHARS = 255;
/** The characters base64 spends on a file at the 5 MiB product limit: 4 × ⌈5,242,880 ÷ 3⌉ = 6,990,508, four for every three bytes and padded to a whole block. */
const MAX_FILE_BASE64_CHARS = 4 * Math.ceil(IMPORT_MAX_BYTES / 3);
/** The JSON one request carries beside that field — the attempt identity, the scope and expected revision, the file name, and a confirmed mapping echoing up to 60 headers of up to 2,000 characters, at worst two bytes each and doubled by JSON escaping — roomed at one MiB, far above that echo's worst case. */
const ENVELOPE_MAX_BYTES = 1_048_576;
/** The ceiling on the bytes one import request may declare or send, because the file limit is applied before processing rather than after the body is buffered: the base64 of a file at the 5 MiB limit plus its envelope. A file of exactly 5 MiB arrives whole and is judged by the service's own limits; a request above the ceiling is refused without being read past it. */
const MAX_REQUEST_BYTES = MAX_FILE_BASE64_CHARS + ENVELOPE_MAX_BYTES;
type ProposeImportPayload = Parameters<typeof mutations.import.proposeImport>[0]["payload"];
const proposeImportBodySchema = mutationInputSchema(
  z.strictObject({
    fileName: z.string().min(1, { error: "fileName must name the chosen file." }).max(FILE_NAME_MAX_CHARS, { error: "fileName is longer than a file name can be." }),
    contentBase64: z.string().max(CONTENT_BASE64_MAX_CHARS, { error: "contentBase64 holds more of a file than one import request can carry (8,388,608 characters); choose a smaller file." }),
    confirmedMapping: z.custom<NonNullable<ProposeImportPayload["confirmedMapping"]>>().optional(),
  }),
);
const isBodyObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Proposes an import from the file the body carries, and answers with exactly one of the service's eight outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  const body = await readRequestBody(request, MAX_REQUEST_BYTES);
  // The file limit is applied before processing (AAP 0.8.7), so a request over the ceiling is refused on the bytes that had arrived or were declared, with nothing of it parsed and nothing written. The refusal is keyed at the field that carries the file, and it names no operation identity because a body refused this early never became one.
  if (body.kind === "oversized") {
    const message = `This import request passed the ${String(MAX_REQUEST_BYTES)}-byte ceiling of one request, which is the base64 of a file at the 5 MiB limit plus its envelope: ${String(body.bytes)} bytes had arrived or been declared when it was refused. Nothing was read and nothing was proposed: choose a smaller file and send it again.`;
    return toResponse(outcomeFromError(UNIDENTIFIED_ATTEMPT, new ZodError([{ code: "custom", path: ["contentBase64"], message }])));
  }
  const raw = body.kind === "body" ? body.value : undefined;
  // A body that is not a JSON object and one that breaks a rule reach the caller the same way: as the `invalid` outcome, with messages keyed by field path and nothing read and nothing written. An absent object is judged as an absent envelope rather than reported as a parse fault, so the caller is told which members the mutation needs instead of that its JSON was malformed.
  const parsed = proposeImportBodySchema.safeParse(isBodyObject(raw) ? raw : {});
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(raw), parsed.error));
  return mutate(parsed.data.operationId, () => mutations.import.proposeImport(parsed.data));
}
