import { routeMethods } from "@/app/api/methods";
import { mutations, reopenInitiativePayloadSchema } from "@/modules/data-service";
import { writePayloadRoute } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: (request: Request): Promise<Response> => writePayloadRoute(request, reopenInitiativePayloadSchema, mutations.outreach.reopenInitiative) });
