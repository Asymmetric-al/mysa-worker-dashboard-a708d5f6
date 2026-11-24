import { routeMethods } from "@/app/api/methods";
import { closeInitiativePayloadSchema, mutations } from "@/modules/data-service";
import { writePayloadRoute } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const closeInitiative = (request: Request): Promise<Response> => writePayloadRoute(request, closeInitiativePayloadSchema, mutations.outreach.closeInitiative);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: closeInitiative });
