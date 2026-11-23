import { routeMethods } from "@/app/api/methods";
import { outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { jsonBodyOf } from "../handler";
import { READ_ATTEMPT } from "../read";
import { exportRequestSchema, foreignScopeRefusal, supportQueryOf } from "../support/query";
import { exportResponse } from "./respond";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CLIENT_CLOSED_REQUEST = 499;
// Nobody is left to read a body, and a caller that walked away has not left a source outage behind: answering the shared outcome conversion would report an `unknown` or `unavailable` export that never failed.
const cancelledResponse = (): Response => new Response(null, { status: CLIENT_CLOSED_REQUEST });
/** Takes the query the body states out of the application as a CSV file: answers `envelope` with it, or `invalid`, `denied`, `unavailable` or `unknown`, and writes no record. Stops computing as soon as the caller that asked for the file has gone. */
async function exportQuery(request: Request): Promise<Response> {
  const parsed = exportRequestSchema.safeParse(await jsonBodyOf(request));
  if (!parsed.success) return toResponse(refusedRead(READ_ATTEMPT, parsed.error));
  const { query } = parsed.data;
  try {
    const posted = supportQueryOf({ ...query, page: undefined }); // Read inside the attempt, so a query this read cannot build is answered as the fault every other one is rather than escaping the boundary.
    const read = await reads.export.readExport(posted, undefined, request.signal);
    // A result read under a different authority from the one the caller states is refused rather than answered, and the caller that left before either is told nothing.
    return exportResponse(read.kind === "envelope" ? (foreignScopeRefusal(query.scope, read.envelope.scope) ?? read) : read);
  } catch (error) {
    // A throw on this path is a store or medium fault, or a failure whose fate is not known, and its outcome carries the read's marker; a throw after the caller aborted is neither.
    return request.signal.aborted ? cancelledResponse() : toResponse(outcomeFromError(READ_ATTEMPT, error));
  }
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: exportQuery });
