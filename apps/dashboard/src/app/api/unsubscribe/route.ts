/** `POST /api/unsubscribe` — the one way a browser turns off a person's Update email from one publisher for one purpose: the internal path of AAP 0.6.3. */
import { z } from "zod";
import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../handler";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// The session, the selected context and the scenario instant are resolved per request, never cached.
export const dynamic = "force-dynamic";
// One publisher and one purpose, and nothing else: `.strict()` refuses a batch form, a second purpose and a consent flag rather than ignoring them, so a body cannot address more than the single membership the acting reader holds for that pair.
const unsubscribePayloadSchema = z.strictObject({
  publisherId: z.string({ error: "Name the one publisher this unsubscribe applies to." }).min(1, "Name the one publisher this unsubscribe applies to.").max(200, "A publisher reference is at most 200 characters."),
  purpose: z.literal(UPDATE_EMAIL_PURPOSE, `This release keeps memberships for one purpose only (${UPDATE_EMAIL_PURPOSE}); another purpose would need its own consent.`),
});
const unsubscribeRequestSchema = z.custom<unknown>((stated) => stated !== undefined, { error: "Send the unsubscribe as a JSON object in the request body: the publisher and the purpose are read from that body alone, never from the address." }).pipe(mutationInputSchema(unsubscribePayloadSchema));
// No GET is exported, deliberately: a link preview, a mail scanner or a page load follows a GET, and consent is the person's own deliberate act, so none of them may unsubscribe a reader. The only entry is a POST naming the publisher and the purpose, and Next answers the methods
// left absent with 405.
/** Turns off the acting reader's Update email from one publisher for one purpose and answers with exactly one of the service's eight outcomes: */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = unsubscribeRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Nothing was attempted, so an unreadable or invalid body is `invalid` and never `unknown`.
    return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.audience.unsubscribe(parsed.data));
  } catch (error) {
    // A throw is a defect rather than a presentation: the mutation answers refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
