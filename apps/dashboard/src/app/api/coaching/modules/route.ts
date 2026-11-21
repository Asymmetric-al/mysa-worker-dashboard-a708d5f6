/** `POST /api/coaching/modules` — one module disclosure switched on or off for one relationship. */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../../handler";
/** The store writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** The mutation resolves the development session and evaluates the scenario clock once per request. */
export const dynamic = "force-dynamic";
type SetModulePayload = Parameters<typeof mutations.coaching.setModule>[0]["payload"];
const setModuleBodySchema = mutationInputSchema(z.custom<SetModulePayload>());
/** Switches one module on or off for one relationship and answers with one of the eight outcomes. */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const parsed = setModuleBodySchema.safeParse(raw);
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(raw), parsed.error));
  try {
    return toResponse(await mutations.coaching.setModule(parsed.data));
  } catch (error) {
    // A throw is a defect rather than a presentation: the service answers its refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
