import { closeInitiativePayloadSchema, mutations } from "@/modules/data-service";
import { writePayloadRoute } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Closes one initiative, recording how its unfinished work is handed on or resolved. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const POST = (request: Request): Promise<Response> => writePayloadRoute(request, closeInitiativePayloadSchema, mutations.outreach.closeInitiative);
