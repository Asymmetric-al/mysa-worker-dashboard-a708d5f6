/** `POST /api/partners/[partnerId]/notes` — the browser's one path that stores a worker-private note on a partner record, dispatched to exactly one named mutation: */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../../../handler";
/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";
interface NoteRouteParams {
  readonly partnerId: string;
}
const notePayloadSchema = z.strictObject({ body: z.string().min(1, "A private note needs the text it records; an empty note records nothing.") });
/** The shape every mutation takes — attempt identity, scope, expected revision, payload — composed with this path's payload rather than re-declared beside it. */
const saveNoteRequestSchema = mutationInputSchema(notePayloadSchema);
/** Records one worker-private note on the partner the path names, and answers with exactly one of the service's eight outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`. */
export async function POST(request: Request, context: { params: Promise<NoteRouteParams> }): Promise<Response> {
  // Next 16 hands the dynamic segments as a promise, so they are awaited before the mutation sees them.
  const { partnerId } = await context.params;
  const body = await jsonBodyOf(request);
  // A body that is not JSON and one that breaks a rule reach the caller the same way: as the `invalid` outcome, with messages keyed by field path and nothing read and nothing written. A parse fault is never reported as a server fault, because nothing was attempted and there is nothing to recover.
  const parsed = saveNoteRequestSchema.safeParse(body);
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  try {
    return toResponse(
      await mutations.partnerPreparation.savePrivateNote({
        operationId: parsed.data.operationId,
        scope: parsed.data.scope,
        expectedRevision: parsed.data.expectedRevision,
        // The path segment is the only partner identity this request has: it is opaque, it is never parsed, and it is never compared with a name, an email address or a postal address.
        payload: { partnerId, body: parsed.data.payload.body },
      }),
    );
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
