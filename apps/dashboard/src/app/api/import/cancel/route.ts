import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { jsonBodyOf, mutate, operationIdentityOf } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type CancelImportPayload = Parameters<typeof mutations.import.cancelImport>[0]["payload"];
const cancelPayloadSchema: z.ZodType<CancelImportPayload> = z.strictObject({});
const cancelRequestSchema = mutationInputSchema(cancelPayloadSchema);
const isBodyObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Stops only the unaccepted rows of an in-flight import and answers with exactly one of the eight mutation outcomes, so an accepted contact stays accepted. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = cancelRequestSchema.safeParse(isBodyObject(body) ? body : {});
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  return mutate(parsed.data.operationId, () => mutations.import.cancelImport(parsed.data));
}
