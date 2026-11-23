import { z } from "zod";
import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";
import { mutationInputSchema, mutations } from "@/modules/data-service";
import { writeRoute } from "../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const unsubscribePayloadSchema = z.strictObject({
  publisherId: z.string({ error: "Name the one publisher this unsubscribe applies to." }).min(1, "Name the one publisher this unsubscribe applies to.").max(200, "A publisher reference is at most 200 characters."),
  purpose: z.literal(UPDATE_EMAIL_PURPOSE, `This release keeps memberships for one purpose only (${UPDATE_EMAIL_PURPOSE}); another purpose would need its own consent.`),
});
const unsubscribeRequestSchema = z.custom<unknown>((stated) => stated !== undefined, { error: "Send the unsubscribe as a JSON object in the request body: the publisher and the purpose are read from that body alone, never from the address." }).pipe(mutationInputSchema(unsubscribePayloadSchema));
/** Turns off the acting reader's Update email from one publisher for one purpose and answers with exactly one of the service's eight outcomes. */
export const POST = (request: Request): Promise<Response> => writeRoute(request, unsubscribeRequestSchema, mutations.audience.unsubscribe);
