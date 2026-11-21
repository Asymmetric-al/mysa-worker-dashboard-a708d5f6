/**
 * `POST /api/import` — the one browser transport for `proposeImport`, the call that turns the file a worker
 * chose into a reviewable proposal: the displayed limits measured before anything is processed, the columns
 * the file carries, the mapping suggested for them, the per-row validation and the duplicate suggestions.
 *
 * In scope from three sources: the API table's `POST /api/import` row (AAP 0.6.3); the "Bring in a contact
 * list" entry of the named inventory and the five-step "Choose file → Map → Validate and review → Selectively
 * accept → Results" journey (AAP 0.7.1, 0.10.1); and AAP 0.11.1's rule that every handler under
 * `src/app/api` is a thin adapter over exactly one named read or mutation.
 *
 * This path answers `POST` alone. The proposal is read back by operation identity through
 * `GET /api/import/[operationId]`, so a `GET` here is a method the framework refuses rather than a second
 * read of the same review.
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";

/** The store the service writes through uses `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";

/** The development session and the scenario instant are resolved per request, never prerendered or cached. */
export const dynamic = "force-dynamic";

/** The identity a refusal answers for when the body never stated one, so every answer names its attempt. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/**
 * The ceiling on the base64 one request may carry: 8,388,608 characters, a little over six MiB of file
 * bytes. It bounds the HTTP request and not the import — the product limit is five MiB of file bytes,
 * decided by the import domain's own limit check before a single row is read, and it is deliberately not
 * applied here: a file between five and six MiB has to reach the service to be refused with the limit and
 * the size that was measured, which is the readable refusal the journey shows. Above this ceiling the
 * answer is `invalid`, because the request is larger than an import request can carry rather than an
 * import that broke a rule.
 */
const CONTENT_BASE64_MAX_CHARS = 8_388_608;

const FILE_NAME_MAX_CHARS = 255;

/** The payload `proposeImport` accepts, taken from the mutation that validates it so the two cannot drift. */
type ProposeImportPayload = Parameters<typeof mutations.import.proposeImport>[0]["payload"];

const proposeImportBodySchema = mutationInputSchema(
  z.strictObject({
    // Display metadata only: the file's type is decided from its content by the service, never by its name.
    fileName: z.string().min(1, { error: "fileName must name the chosen file." }).max(FILE_NAME_MAX_CHARS, { error: "fileName is longer than a file name can be." }),
    contentBase64: z.string().max(CONTENT_BASE64_MAX_CHARS, {
      error: "contentBase64 holds more of a file than one import request can carry (8,388,608 characters); choose a smaller file.",
    }),
    // Presence only. A confirmed mapping's shape is the mutation's own closed schema, which validates the
    // very same payload before any state change; restating it here would be a second authority over a
    // contract this file does not own, and no mapping entry is read at the transport.
    confirmedMapping: z.custom<NonNullable<ProposeImportPayload["confirmedMapping"]>>().optional(),
  }),
);

function isBodyObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The attempt the refusal answers for. The operation id is the caller's own — minted by the client and
 * forwarded byte for byte, because a replay is recognised by that identity and never by a repeated
 * payload — so a body that named none is answered for an unnamed attempt rather than a fabricated one.
 */
function attemptIdOf(body: unknown): string {
  if (!isBodyObject(body)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed = body["operationId"];
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}

/**
 * Proposes an import from the file the body carries, and answers with exactly one of the service's eight
 * outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown` — whose created identity names the proposal, which is then read back through
 * `GET /api/import/[operationId]`. Forwarded untouched: the outcome is the service's, and this file adds no
 * field, header or status of its own.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  // A body that is not a JSON object and one that breaks a rule reach the caller the same way: as the
  // `invalid` outcome, with messages keyed by field path and nothing read and nothing written. An absent
  // object is judged as an absent envelope rather than reported as a parse fault, so the caller is told
  // which members the mutation needs instead of that its JSON was malformed.
  const parsed = proposeImportBodySchema.safeParse(isBodyObject(body) ? body : {});
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.import.proposeImport(parsed.data));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes, so a
    // throw means a store or medium fault, or a failure whose fate is not known, and the one mapper tells
    // those apart so neither becomes a proposal that was never built.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
