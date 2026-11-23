import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, reads } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
import { writeRoute } from "../handler";
import { readGrammar, readRoute } from "../read";
import { wholePageParameter } from "../paging";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  intentRequired: "Name the notification intent whose per-recipient results to read, so the answer describes one deliberate notice rather than whichever was submitted last.",
  queryShape: "Read one intent's results by naming it as intentId, with an optional page and pageSize and nothing else.",
  bodyNotJson: "Send the notice as a JSON object carrying the operation id, the scope, the revision you read and the notice itself.",
  documentRequired: "Name the Update this notice is about, so a notice speaks for one document rather than for whichever was published last.",
  releaseInvalid: "Name the published edition's release or variant identifier exactly as the release gave it, so the notice is submitted for the edition that was reviewed.",
  ceilingInvalid: "State the eligible count you acknowledged as a whole number from zero, so the ceiling the accepted notice cannot exceed is the number the review showed you.",
  intendedAtInvalid: "State the intended instant as an ISO-8601 instant carrying an offset, so the hours this notice stays useful for run from the moment the worker meant.",
  repeatInvalid: "Name the notice a repeat submits again by its own identity, so the copy a definite failure recorded is recognised as that notice's and every accepted or uncertain copy stays untouched.",
  pageInvalid: "State the page as a whole number from 0, the first page.",
  pageSizeInvalid: "State the page size as a whole number.",
} as const;
const sendResultQuerySchema = z.strictObject({ intentId: z.string({ error: MESSAGES.intentRequired }).trim().min(1, MESSAGES.intentRequired), page: wholePageParameter(MESSAGES.pageInvalid).optional(), pageSize: wholePageParameter(MESSAGES.pageSizeInvalid).optional() }, { error: MESSAGES.queryShape });
function rawSendResultParams(search: URLSearchParams): Record<string, unknown> {
  const stated: Record<string, unknown> = {};
  for (const name of new Set(search.keys())) {
    const values = search.getAll(name);
    stated[name] = values.length === 1 ? values[0] : values;
  }
  return stated;
}
const identifierOf = (message: string) => z.string({ error: message }).trim().min(1, message);
const noticeSchema = z.strictObject(
  {
    documentId: identifierOf(MESSAGES.documentRequired),
    variantId: identifierOf(MESSAGES.releaseInvalid).optional(),
    releaseId: identifierOf(MESSAGES.releaseInvalid).optional(),
    acknowledgedCeiling: z.number({ error: MESSAGES.ceilingInvalid }).int(MESSAGES.ceilingInvalid).min(0, MESSAGES.ceilingInvalid).optional(),
    intendedAt: z.iso.datetime({ offset: true, error: MESSAGES.intendedAtInvalid }).optional(),
    repeatOfIntentId: identifierOf(MESSAGES.repeatInvalid).optional(), // A repeat of a definite failure names the notice that recorded it: the service reads that record's own instant and its own publication, so this transport cannot move the window or widen who a repeat could reach.
  },
  { error: MESSAGES.bodyNotJson },
);
const notifyRequestSchema = mutationInputSchema(noticeSchema);
/** Reads the per-recipient results of one notification intent, each recipient's one pinned rendition included: a name this read does not admit is refused at the field path that carries it. */
const readSendResult = readRoute(readGrammar(sendResultQuerySchema, rawSendResultParams), (params) => reads.audience.readSendResult(params));
/** Submits one deliberate notice for one published edition: who is eligible, which single rendition each of them is pinned to, how long the notice stays useful and how a repeated attempt is recognised are all the service's to decide at command time. */
const requestNotice = (request: NextRequest): Promise<Response> => writeRoute(request, notifyRequestSchema, (input) => mutations.updates.requestNotification(sessionIdOf(request), input));
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readSendResult, POST: requestNotice });
