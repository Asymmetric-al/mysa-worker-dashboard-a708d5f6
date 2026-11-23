import { z } from "zod";
import { mutationInputSchema, mutations } from "@/modules/data-service";
import { writeRoute } from "../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ConfirmPayload = Parameters<typeof mutations.audience.confirmMembership>[0]["payload"];
const confirmPayloadSchema: z.ZodType<ConfirmPayload> = z.strictObject({ membershipId: z.string({ error: "Select the membership to confirm." }).min(1, { error: "Select the membership to confirm." }).max(200, { error: "A membership identifier is at most 200 characters." }) });
const confirmRequestSchema = mutationInputSchema(confirmPayloadSchema);
/** Confirms one membership inside its confirmation window, which the service evaluates at 168 elapsed hours after acceptance and strict at equality, and answers with exactly one of the eight outcomes. */
export const POST = (request: Request): Promise<Response> => writeRoute(request, confirmRequestSchema, mutations.audience.confirmMembership);
