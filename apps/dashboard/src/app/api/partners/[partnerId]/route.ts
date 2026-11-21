/** `GET /api/partners/[partnerId]` — one partner's record body: identity and the contact methods this caller may use, restrictions, relationship context, open work and the authorised support history … */
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
/** The store keeps session documents on the local filesystem, so this handler is never an edge one. */
export const runtime = "nodejs";
/** Scope comes from the session cookie and every boundary is judged at the scenario clock of this request, so no answer may be served from a cache across a context switch. */
export const dynamic = "force-dynamic";
const READ_ATTEMPT_ID = "read";
interface PartnerRecordParams {
  readonly partnerId: string;
}
/** Answers with the record body folded into one envelope by the service's own record read, or its `denied` or `unavailable` refusal, or `unknown` when a fault leaves the answer's fate unclear. */
export async function GET(_request: Request, context: { params: Promise<PartnerRecordParams> }): Promise<Response> {
  try {
    // Next 16 hands a dynamic segment over as a promise. The value is opaque: it reaches the read exactly as it arrived and is never decoded, parsed, matched against a name or an address, or treated as a path.
    const { partnerId } = await context.params;
    // The record body, its activity and the caller's own preparation are one envelope, and the rule that folds them belongs to the service rather than to this door: the handler forwards the address and answers with what the record read says, so a second consumer of the same three reads never
    // rebuilds the fold.
    return toResponse(await reads.partners.readPartnerRecord(partnerId));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known. A read attempted no effect, so the outcome carries the marker rather than a fabricated operation id.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
