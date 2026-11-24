import { routeMethods } from "@/app/api/methods";
import { mutations, reopenInitiativePayloadSchema } from "@/modules/data-service";
import { writePayloadRoute } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reopenInitiative = (request: Request): Promise<Response> => writePayloadRoute(request, reopenInitiativePayloadSchema, mutations.outreach.reopenInitiative);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: reopenInitiative });
