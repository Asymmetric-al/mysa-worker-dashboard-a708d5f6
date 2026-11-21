/**
 * `POST /api/partners/[partnerId]/notes` — the browser's one path that stores a worker-private note on
 * a partner record, dispatched to exactly one named mutation: `savePrivateNote`.
 *
 * A note is preparation rather than a shared operational fact: the service stamps its author, fixes its
 * audience to private and keeps it out of every shared projection, roster, export and coach view, so
 * the request body cannot state an audience at all. The partner identity comes from the path segment
 * and nowhere else — the payload carries no `partnerId`, so a body cannot address a different record
 * than the one its URL names.
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
/** The store behind the service writes through `node:fs`, so this handler never runs on the edge. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, never cached. */
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

interface NoteRouteParams {
  readonly partnerId: string;
}

/**
 * The note's own payload: the text, and nothing else. Strictness is the rule here — a body that also
 * names `audience`, `shared`, `authorPrincipalId`, `partnerId` or any other member is refused as
 * `invalid` rather than read as a note whose audience, author or subject the caller chose. Zod reports
 * an unrecognised sibling key on the payload object itself, so the refusal names the offending key.
 */
const notePayloadSchema = z.strictObject({
  body: z.string().min(1, "A private note needs the text it records; an empty note records nothing."),
});

/** The shape every mutation takes — attempt identity, scope, expected revision, payload — composed with this path's payload rather than re-declared beside it. */
const saveNoteRequestSchema = mutationInputSchema(notePayloadSchema);

/**
 * The attempt a refusal answers for. The operation id is the caller's own — minted by the client and
 * forwarded byte for byte, because a replay is recognised by that identity and never by a repeated
 * payload — so a body that named none is answered for an unnamed attempt rather than a fabricated one.
 */
function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = Reflect.get(body, "operationId");
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}

/**
 * Records one worker-private note on the partner the path names, and answers with exactly one of the
 * service's eight outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`,
 * `invalid`, `unavailable` or `unknown`. The outcome is forwarded untouched: this file adds no status,
 * header or field of its own, and it decides no permission, revision or clock fact itself.
 */
export async function POST(request: Request, context: { params: Promise<NoteRouteParams> }): Promise<Response> {
  // Next 16 hands the dynamic segments as a promise, so they are awaited before the mutation sees them.
  const { partnerId } = await context.params;
  const body: unknown = await request.json().catch(() => undefined);
  // A body that is not JSON and one that breaks a rule reach the caller the same way: as the `invalid`
  // outcome, with messages keyed by field path and nothing read and nothing written. A parse fault is
  // never reported as a server fault, because nothing was attempted and there is nothing to recover.
  const parsed = saveNoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    return toResponse(
      await mutations.partnerPreparation.savePrivateNote({
        operationId: parsed.data.operationId,
        scope: parsed.data.scope,
        expectedRevision: parsed.data.expectedRevision,
        // The path segment is the only partner identity this request has: it is opaque, it is never
        // parsed, and it is never compared with a name, an email address or a postal address.
        payload: { partnerId, body: parsed.data.payload.body },
      }),
    );
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes,
    // so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
