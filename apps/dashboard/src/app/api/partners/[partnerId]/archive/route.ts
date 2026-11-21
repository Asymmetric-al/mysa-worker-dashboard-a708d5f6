/**
 * `POST /api/partners/[partnerId]/archive` — the one browser transport for archiving and restoring a
 * worker-private preparation record. `payload.intent` names which of the two named mutations runs:
 * `archivePreparation` or `restorePreparation`.
 *
 * The change is recoverable: the preparation leaves the working lists, no record is destroyed and no
 * bytes are erased. It is confined to the private preparation the caller owns — the linked shared
 * partner record, its interactions, its open tasks and its support projection keep their rows and
 * their revisions — and it creates no consent, no publication, no communication outcome and no
 * financial meaning.
 */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
// The store behind the service reads and writes its session documents through `node:fs`, so this
// handler never runs on the edge runtime.
export const runtime = "nodejs";
// Scope, the record's revision and the scenario clock are resolved per request, so an archived or
// restored preparation is never served from a stored response.
export const dynamic = "force-dynamic";

/**
 * The operation identity an `invalid` outcome reports when the body named no attempt of its own, so a
 * malformed request is still answered as a validation result rather than as a fault.
 */
const UNATTEMPTED_OPERATION_ID = "no-operation-attempted";

/**
 * The reference of the private preparation the change applies to. It is opaque: no format is judged,
 * and the service decides whether the reference names a preparation this session may change.
 */
const preparationReferenceField = z
  .string({ error: "Name the preparation record this change applies to, then retry." })
  .min(1, "A preparation record is named by its identifier, and the reference sent is empty.");

/**
 * The changes this path performs, each naming the intent it carries and the one preparation it
 * applies to. Strict, with Zod's own unrecognized-key message rather than a message of this file's,
 * so a request that also names a record kind, a cascade or another field is `invalid` naming that
 * field rather than quietly treated as a narrower request.
 */
const preparationIntent = z.discriminatedUnion(
  "intent",
  [
    z.strictObject({ intent: z.literal("archivePreparation"), partnerId: preparationReferenceField }),
    z.strictObject({ intent: z.literal("restorePreparation"), partnerId: preparationReferenceField }),
  ],
  { error: "Name the change this request asks for: archivePreparation or restorePreparation." },
);

/** The request body: the shared mutation contract, with the payload narrowed to the two intents above. */
const preparationChangeRequest = mutationInputSchema(preparationIntent);

/** The dynamic segment Next 16 hands this handler as a promise. */
interface PreparationAddress {
  readonly partnerId: string;
}

/** The operation identity the body claims, or the marker that stands in when it claims none. */
function operationIdentityOf(body: unknown): string {
  if (typeof body === "object" && body !== null) {
    const claimed: unknown = Reflect.get(body, "operationId");
    if (typeof claimed === "string" && claimed.length > 0) {
      return claimed;
    }
  }
  return UNATTEMPTED_OPERATION_ID;
}

/**
 * Archives or restores one worker-private preparation record, as `payload.intent` names, and answers
 * with exactly one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`,
 * `denied`, `invalid`, `unavailable` or `unknown`.
 */
export async function POST(request: Request, context: { params: Promise<PreparationAddress> }): Promise<Response> {
  // Next 16 hands the dynamic segment as a promise, so it is awaited before the handler proceeds. The
  // segment addresses the partner route family; the preparation the service authorises is the one the
  // request's payload names, so the two are never compared and neither is read as proof of authority.
  await context.params;
  // A body that is not JSON at all is a recognised validation failure, not an unrecognised fault, so it
  // reaches the same mapper as a schema refusal and changes nothing.
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = preparationChangeRequest.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  }
  const { payload } = parsed.data;
  try {
    switch (payload.intent) {
      case "archivePreparation":
        return toResponse(await mutations.partnerPreparation.archivePreparation({ ...parsed.data, payload: { partnerId: payload.partnerId } }));
      case "restorePreparation":
        return toResponse(await mutations.partnerPreparation.restorePreparation({ ...parsed.data, payload: { partnerId: payload.partnerId } }));
      default:
        // Unreachable: the payload schema admits exactly the two intents above, so a third fails to
        // compile at this call instead of reaching the runtime.
        return assertNever(payload, "Unhandled preparation change");
    }
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers its refusals as
    // outcomes, so a throw means a store fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
