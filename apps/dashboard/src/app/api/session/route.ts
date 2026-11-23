import { reads } from "@/modules/data-service";
import { READ_ATTEMPT, readResponse } from "../read";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const CONTEXT_CHOOSER_JOB = "context-chooser";
/** Answers with this session's admission statement — the state, its guidance key and, only when admitted, the principal and the context in force — or, when the chooser job is named, the context chooser. */
export function GET(request: Request): Promise<Response> {
  const chooser = new URL(request.url).searchParams.get("job") === CONTEXT_CHOOSER_JOB;
  return readResponse(READ_ATTEMPT, () => (chooser ? reads.context.readContextChooser() : reads.context.readAdmissionState()));
}
