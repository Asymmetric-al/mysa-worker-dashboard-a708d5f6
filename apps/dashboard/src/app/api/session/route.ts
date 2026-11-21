/**
 * `GET /api/session` — what this session is admitted to, in the one read envelope.
 */
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
/** Admission is derived from the request's session cookie on every call, so the answer must never be cached: a stored render would serve one session's context — or a `signed-in` state — to a. */
export const dynamic = "force-dynamic";
/** The store behind the service reads session documents through `node:fs`, and media preparation loads Node-API native bindings, so this application runs on the Node runtime. */
export const runtime = "nodejs";

const READ_ATTEMPT_MARKER = "read";
/** Answers with this session's admission statement: the state, its guidance key, and — only when admitted — the principal, the selected context and the scenario the session runs in, inside the. */
export async function GET(): Promise<Response> {
  try {
    return toResponse(await reads.context.readAdmissionState());
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
