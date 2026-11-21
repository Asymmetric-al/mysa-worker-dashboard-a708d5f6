/** `POST /api/partners/[partnerId]/archive` — the one browser transport for archiving and restoring a worker-private preparation record. */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { archivePreparationInput, mutationInputSchema, mutations, outcomeFromError, restorePreparationInput, toResponse } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, operationIdentityOf } from "../../../handler";
// The store behind the service reads and writes its session documents through `node:fs`, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Scope, the record's revision and the scenario clock are resolved per request, so an archived or restored preparation is never served from a stored response.
export const dynamic = "force-dynamic";
/** The operation identity an `invalid` outcome reports when the body named no attempt of its own, so a malformed request is still answered as a validation result rather than as a fault. */
const UNATTEMPTED_OPERATION_ID = "no-operation-attempted";
/** The changes this path performs, each naming the intent it carries and the one preparation it applies to. */
const preparationIntent = z.discriminatedUnion("intent", [archivePreparationInput.extend({ intent: z.literal("archivePreparation") }), restorePreparationInput.extend({ intent: z.literal("restorePreparation") })], { error: "Name the change this request asks for: archivePreparation or restorePreparation." });
/** The request one preparation change presents for the record this path addresses: the shared mutation contract, with the payload taken from the mutation's own schema and the intent above — and … */
function preparationChangeRequest(address: string) {
  return mutationInputSchema(preparationIntent).superRefine((input, context) => {
    if (input.payload.partnerId !== address) {
      context.addIssue({ code: "custom", path: ["payload", "partnerId"], message: "Name one preparation record. The path names the record this change applies to, and a payload naming a different one would leave the answer describing a record the caller did not address." });
    }
  });
}
/** The dynamic segment Next 16 hands this handler as a promise. */
interface PreparationAddress {
  readonly partnerId: string;
}
/** This path's refusals have always been echoed under its own `no-operation-attempted` marker rather than the shared placeholder, so a caller's recovery is matched against the identity it already has; only that marker stays here, while the rule that reads the attempt the body claims is the shared one. */
function refusalIdentityOf(raw: unknown): string {
  const claimed = operationIdentityOf(raw);
  return claimed === UNIDENTIFIED_ATTEMPT ? UNATTEMPTED_OPERATION_ID : claimed;
}
/** Archives or restores one worker-private preparation record, as `payload.intent` names, and answers with exactly one of the eight outcomes: */
export async function POST(request: Request, context: { params: Promise<PreparationAddress> }): Promise<Response> {
  // Next 16 hands the dynamic segment as a promise, so it is awaited before the body is judged against it. The segment addresses this partner route family and supplies no identity of its own: the preparation
  // the service authorises is the one the request's payload names, and the address is only required to agree with it, so neither is read as proof of authority.
  const { partnerId: addressed } = await context.params;
  // A body that is not JSON at all is a recognised validation failure, not an unrecognised fault, so it reaches the same mapper as a schema refusal and changes nothing.
  const body = await jsonBodyOf(request);
  const parsed = preparationChangeRequest(addressed).safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(refusalIdentityOf(body), parsed.error));
  }
  const { payload } = parsed.data;
  try {
    switch (payload.intent) {
      case "archivePreparation":
        return toResponse(await mutations.partnerPreparation.archivePreparation({ ...parsed.data, payload: { partnerId: payload.partnerId } }));
      case "restorePreparation":
        return toResponse(await mutations.partnerPreparation.restorePreparation({ ...parsed.data, payload: { partnerId: payload.partnerId } }));
      default:
        // Unreachable: the payload schema admits exactly the two intents above, so a third fails to compile at this call instead of reaching the runtime.
        return assertNever(payload, "Unhandled preparation change");
    }
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers its refusals as outcomes, so a throw means a store fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
