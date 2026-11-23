import { reads, refusedRead, toResponse } from "@/modules/data-service";
import { jsonBodyOf } from "../handler";
import { reportRequestSchema, supportQueryOf } from "../support/query";
import { READ_ATTEMPT, readResponse } from "../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function requestBodyOf(body: unknown): unknown {
  if (typeof body === "object" && body !== null && !Array.isArray(body) && Object.hasOwn(body, "query")) return body;
  return { query: body };
}
/** Computes one of the four fixed reports for the query the body states. */
export async function POST(request: Request): Promise<Response> {
  const parsed = reportRequestSchema.safeParse(requestBodyOf(await jsonBodyOf(request)));
  if (!parsed.success) return toResponse(refusedRead(READ_ATTEMPT, parsed.error));
  return readResponse(READ_ATTEMPT, () => reads.support.readReport(parsed.data.query.reportId, supportQueryOf(parsed.data.query)));
}
