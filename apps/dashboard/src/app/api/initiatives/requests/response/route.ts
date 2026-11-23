import { routeMethods } from "@/app/api/methods";
import { mutations, recordRequestResponsePayloadSchema } from "@/modules/data-service";
import { writePayloadRoute } from "../../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Records the respondent's own answer to one Request, and answers exactly one outcome: the envelope is judged by the shared schema, the payload by the mutation's own exported schema, and the change then handed on exactly as it arrived. */
const recordRequestResponse = (request: Request): Promise<Response> => writePayloadRoute(request, recordRequestResponsePayloadSchema, mutations.outreach.recordRequestResponse);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: recordRequestResponse });
