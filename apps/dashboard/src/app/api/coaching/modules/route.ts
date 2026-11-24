import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { mutationInputSchema, mutations } from "@/modules/data-service";
import { writeRoute } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const setModuleBodySchema = mutationInputSchema(z.custom<Parameters<typeof mutations.coaching.setModule>[0]["payload"]>());
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: (request: Request): Promise<Response> => writeRoute(request, setModuleBodySchema, mutations.coaching.setModule) });
