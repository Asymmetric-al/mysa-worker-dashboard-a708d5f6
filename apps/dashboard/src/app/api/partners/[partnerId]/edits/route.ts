/** `POST /api/partners/[partnerId]/edits` — the one browser write that changes a partner record's permitted fields, and the only path that reaches `saveContactEdits`. */
import { mutationInputSchema, mutations, outcomeFromError, saveContactEditsInput, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../../../handler";
// The store behind the service writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every request resolves the development session, the selected context and the scenario instant afresh.
export const dynamic = "force-dynamic";
/** What `saveContactEdits` accepts, taken from the mutation itself so this path cannot drift from it. */
type SaveContactEditsPayload = Parameters<typeof mutations.partnerPreparation.saveContactEdits>[0]["payload"];
/** The permitted fields one edit may set, and nothing else: the mutation's own payload schema, so every bound and every sentence a caller is refused with belongs to the one rule the write itself applies. */
const contactEditPayloadSchema = saveContactEditsInput.partial({ partnerId: true });
/** The request one edit presents for the record this path names: the shared four-field input composed with this path's payload schema, refusing a payload that selects a different record so a caller … */
function contactEditRequestSchema(target: string) {
  return mutationInputSchema(contactEditPayloadSchema).superRefine((input, context) => {
    const claimed = input.payload.partnerId;
    if (claimed !== undefined && claimed !== target) {
      context.addIssue({ code: "custom", path: ["payload", "partnerId"], message: "Name one record. The path names the record this change applies to, and a payload naming a different one would leave the answer describing a record the caller did not address." });
    }
  });
}
/** Saves the caller's permitted-field edits to the partner record this path names, against the revision they read. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request, { params }: { params: Promise<{ partnerId: string }> }): Promise<Response> {
  // Next 16 hands a dynamic segment as a promise, so it is awaited before the body is judged against it.
  const { partnerId } = await params;
  const body = await jsonBodyOf(request);
  const parsed = contactEditRequestSchema(partnerId).safeParse(body);
  if (!parsed.success) {
    // A validation failure is answered as `invalid` with one message per field path, through the same mapping a thrown fault takes: no state is read, no state is written, and nothing is `unknown`.
    return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  }
  const { operationId, scope, expectedRevision, payload } = parsed.data;
  // Typed against the mutation's own payload: a field it stops accepting fails to compile here rather than reaching the service and being refused there at runtime.
  const edited: SaveContactEditsPayload = { ...payload, partnerId };
  try {
    return toResponse(await mutations.partnerPreparation.saveContactEdits({ operationId, scope, expectedRevision, payload: edited }));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(operationId, error));
  }
}
