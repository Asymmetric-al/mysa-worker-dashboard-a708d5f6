/**
 * `POST /api/confirm` — the one way a reader confirms a synthetic email-proof membership.
 */
import { z } from "zod";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
/** The store writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Confirmation resolves the development session and reads the scenario clock once per request. */
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

type ConfirmPayload = Parameters<typeof mutations.audience.confirmMembership>[0]["payload"];

// The payload names the membership and nothing else. Proof of possession is the person's own Confirm
// post, so a token, a signed link, a consent choice and a reading language have no field here, and the
// strict object makes such a key a refusal rather than an agreement inferred from extra input.
const confirmPayloadSchema: z.ZodType<ConfirmPayload> = z.strictObject({
  membershipId: z
    .string({ error: "Select the membership to confirm." })
    .min(1, { error: "Select the membership to confirm." })
    .max(200, { error: "A membership identifier is at most 200 characters." }),
});

const confirmRequestSchema = mutationInputSchema(confirmPayloadSchema);

async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    // Malformed or absent JSON is the caller's input fault, so it answers `invalid` with messages
    // rather than the `unknown` an unrecognised failure would report.
    return undefined;
  }
}

function claimedOperationIdOf(body: unknown): string {
  if (!isRecord(body)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed = body["operationId"];
  return isNonEmptyString(claimed) ? claimed : UNIDENTIFIED_ATTEMPT;
}

// Exported methods are the whole method surface of this route: with only POST declared, the framework
// answers GET, HEAD, PUT, PATCH and DELETE with 405, so opening a link, previewing it or scanning the
// message can never confirm a membership.
/** Confirms one membership inside its confirmation window and answers with exactly one outcome: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = confirmRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(claimedOperationIdOf(body), parsed.error));
  }
  try {
    // The window, the revision check and the replay ledger are the service's: 168 elapsed hours after
    // acceptance, strict at equality, evaluated there so no reload or retry can extend it.
    return toResponse(await mutations.audience.confirmMembership(parsed.data));
  } catch (error) {
    // The service answers its refusals as outcomes, so a throw is a store or medium fault, or a failure
    // whose fate is not known: `unavailable` or `unknown`, never a success inferred from silence.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
