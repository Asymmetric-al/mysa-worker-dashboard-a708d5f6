import { reads, refusedRead, toResponse } from "@/modules/data-service";
import { jsonBodyOf } from "../handler";
import { foreignScopeRefusal, reportRequestSchema, supportQueryOf } from "../support/query";
import { READ_ATTEMPT, readResponse } from "../read";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function requestBodyOf(body: unknown): unknown {
  if (typeof body === "object" && body !== null && !Array.isArray(body) && Object.hasOwn(body, "query")) return body;
  return { query: body };
}
async function runReport(request: Request): Promise<Response> {
  const parsed = reportRequestSchema.safeParse(requestBodyOf(await jsonBodyOf(request)));
  if (!parsed.success) return toResponse(refusedRead(READ_ATTEMPT, parsed.error));
  const { query } = parsed.data;
  return readResponse(READ_ATTEMPT, async () => {
    const read = await reads.support.readReport(query.reportId, supportQueryOf(query));
    return read.kind === "envelope" ? (foreignScopeRefusal(query.scope, read.envelope.scope) ?? read) : read;
  });
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: runReport });
