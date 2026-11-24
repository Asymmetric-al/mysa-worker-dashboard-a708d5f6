import { selectContextRequestSchema } from "@/features/shell/schemas/select-context";
import { mutations } from "@/modules/data-service";
import { refusalIdentityGiven, writeRoute } from "../../handler";
import { routeMethods } from "@/app/api/methods";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_OPERATION_ID_LENGTH = 200;
const refusalIdentityOf = refusalIdentityGiven("session-context-route", MAX_OPERATION_ID_LENGTH);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: (request: Request): Promise<Response> => writeRoute(request, selectContextRequestSchema, mutations.context.selectContext, refusalIdentityOf) });
