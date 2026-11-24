import { z } from "zod";
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { READ_ATTEMPT, readResponse } from "../read";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UPDATE_FAMILY = "update" as const;
const MESSAGES = {
  documentRequired: "This action applies to one Update, so open the Update again and retry rather than pasting an address.",
  pageInvalid: "State the page as a whole number from 1, or leave it out to read the first page.",
  pageSizeInvalid: "State the page size as a whole number from 1, or leave it out and the read applies its own 50-row default and 200-row ceiling.",
  parameterUnrecognised: "Address the Updates list with a page and a page size and nothing else: a parameter this read does not admit belongs to another read, and answering as though it had been read would state a list the request never asked for.",
} as const;
const documentIdSchema = z.string({ error: MESSAGES.documentRequired }).trim().min(1, MESSAGES.documentRequired).max(160, MESSAGES.documentRequired);
const updateTargetSchema = z.object({ documentId: documentIdSchema });
// The list branch's own closed grammar: the window and nothing else. The parameters are read by name from the whole query string, so a name this branch does not admit is refused at that name rather than dropped — a caller who asked this read for a filter, a search or another family's parameter is told so, instead of being answered with a list that ignored half of the question.
const updateListQuerySchema = z.strictObject(
  {
    // The release's 50-row default and 200-row ceiling belong to the read, which clamps the size it is given and states the whole-result total, so nothing here defaults, caps, counts or slices a page.
    page: z.coerce.number({ error: MESSAGES.pageInvalid }).int({ error: MESSAGES.pageInvalid }).min(1, { error: MESSAGES.pageInvalid }).optional(),
    pageSize: z.coerce.number({ error: MESSAGES.pageSizeInvalid }).int({ error: MESSAGES.pageSizeInvalid }).min(1, { error: MESSAGES.pageSizeInvalid }).optional(),
  },
  { error: MESSAGES.parameterUnrecognised },
);
/** The page the list read is asked for, stated in the read's own vocabulary: an unstated half is left unstated rather than defaulted here. */
const updateListQueryOf = (params: z.output<typeof updateListQuerySchema>): NonNullable<Parameters<typeof reads.updates.findContentDocuments>[0]> => ({ families: [UPDATE_FAMILY], ...(params.page === undefined ? {} : { page: params.page }), ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }) });
function readUpdates(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const documentId = search.get("documentId");
  // The only parameter that names a record. Without it the request is the list the Updates surface opens on rather than a malformed read, because a worker asking what their ministry has written holds no identity yet; nothing else may select a principal, persona, organization, ministry, audience or locale: the scope comes from the session resolution inside the service.
  if (documentId === null) {
    const list = updateListQuerySchema.safeParse(Object.fromEntries(search)); // One page of the list, in the one window the read owns: a parameter this branch does not admit is a refusal keyed by field, never a question silently narrowed.
    if (!list.success) return Promise.resolve(toResponse(outcomeFromError(READ_ATTEMPT, list.error)));
    return readResponse(READ_ATTEMPT, () => reads.updates.findContentDocuments(updateListQueryOf(list.data)));
  }
  const target = updateTargetSchema.safeParse({ documentId });
  if (!target.success) return Promise.resolve(toResponse(outcomeFromError(READ_ATTEMPT, target.error)));
  return readResponse(READ_ATTEMPT, () => reads.updates.readVariantOverview({ documentId: target.data.documentId }));
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readUpdates });
