import { reads } from "@/modules/data-service";
import { READ_ATTEMPT, readResponse } from "../read";
import { routeMethods } from "@/app/api/methods";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const readSession = (request: Request): Promise<Response> => readResponse(READ_ATTEMPT, () => (new URL(request.url).searchParams.get("job") === "context-chooser" ? reads.context.readContextChooser() : reads.context.readAdmissionState()));
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readSession });
