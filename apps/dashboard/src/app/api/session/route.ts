/** `GET /api/session` — what this session is admitted to, in the one read envelope: the admission statement by default, and the context chooser when the browser names that job in the query string. */
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
/** Admission is derived from the request's session cookie on every call, so the answer must never be cached: a stored render would serve one session's context — or a `signed-in` state — to a. */
export const dynamic = "force-dynamic";
/** The store behind the service reads session documents through `node:fs`, and media preparation loads Node-API native bindings, so this application runs on the Node runtime. */
export const runtime = "nodejs";
const READ_ATTEMPT_MARKER = "read";
const CONTEXT_CHOOSER_JOB = "context-chooser";
/** Answers with this session's admission statement — the state, its guidance key and, only when admitted, the principal and the context in force — or, when the chooser job is named. */
export async function GET(request: Request): Promise<Response> {
  const job = new URL(request.url).searchParams.get("job");
  try {
    // A job the shell does not name answers the admission statement, which is this path's own read and the only one a caller who named no job can mean.
    if (job === CONTEXT_CHOOSER_JOB) return toResponse(await reads.context.readContextChooser());
    return toResponse(await reads.context.readAdmissionState());
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
