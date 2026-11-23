import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { mutationInputSchema, mutations } from "@/modules/data-service";
import { writeRoute } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type SetModulePayload = Parameters<typeof mutations.coaching.setModule>[0]["payload"];
const setModuleBodySchema = mutationInputSchema(z.custom<SetModulePayload>());
/** Switches one module on or off for one relationship and answers with one of the eight outcomes. */
const setModule = (request: Request): Promise<Response> => writeRoute(request, setModuleBodySchema, mutations.coaching.setModule);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: setModule });
