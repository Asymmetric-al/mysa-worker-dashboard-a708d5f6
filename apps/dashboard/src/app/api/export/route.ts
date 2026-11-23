import { reads, refusedRead, toResponse } from "@/modules/data-service";
import { jsonBodyOf } from "../handler";
import { READ_ATTEMPT, readResponse } from "../read";
import { exportRequestSchema, supportQueryOf } from "../support/query";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Takes the query the body states out of the application as a CSV file: answers `envelope` with it, or `invalid`, `denied`, `unavailable` or `unknown`, and writes no record. */
export async function POST(request: Request): Promise<Response> {
  const parsed = exportRequestSchema.safeParse(await jsonBodyOf(request));
  if (!parsed.success) return toResponse(refusedRead(READ_ATTEMPT, parsed.error));
  return readResponse(READ_ATTEMPT, () => reads.export.readExport(supportQueryOf({ ...parsed.data.query, page: undefined })));
}
