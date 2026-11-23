import { selectContextRequestSchema } from "@/features/shell/schemas/select-context";
import { mutations } from "@/modules/data-service";
import { refusalIdentityGiven, writeRoute } from "../../handler";
import { routeMethods } from "@/app/api/methods";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UNREACHED_ATTEMPT = "session-context-route";
const MAX_OPERATION_ID_LENGTH = 200;
const refusalIdentityOf = refusalIdentityGiven(UNREACHED_ATTEMPT, MAX_OPERATION_ID_LENGTH);
/** Moves the session into the context the body names and answers with one of the closed outcomes — accepted, alreadyAccepted, unchanged, conflict, denied, invalid, unavailable or unknown. */
const selectContext = (request: Request): Promise<Response> => writeRoute(request, selectContextRequestSchema, mutations.context.selectContext, refusalIdentityOf);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: selectContext });
