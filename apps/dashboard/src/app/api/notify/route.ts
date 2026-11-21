/** `GET /api/notify` — the per-recipient results of one notification intent — and `POST /api/notify`, the deliberate request that submits one notice for one published edition. */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
import { jsonBodyOf, operationIdentityOf } from "../handler";
// The store behind the service writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// The session, the selected context and the scenario instant are resolved per request, never cached.
export const dynamic = "force-dynamic";
const READ_ATTEMPT_MARKER = "read";
const MESSAGES = {
  intentRequired: "Name the notification intent whose per-recipient results to read, so the answer describes one deliberate notice rather than whichever was submitted last.",
  queryShape: "Read one intent's results by naming it as intentId, with an optional page and pageSize and nothing else.",
  bodyNotJson: "Send the notice as a JSON object carrying the operation id, the scope, the revision you read and the notice itself.",
  documentRequired: "Name the Update this notice is about, so a notice speaks for one document rather than for whichever was published last.",
  releaseInvalid: "Name the published edition's release or variant identifier exactly as the release gave it, so the notice is submitted for the edition that was reviewed.",
  ceilingInvalid: "State the eligible count you acknowledged as a whole number from zero, so the ceiling the accepted notice cannot exceed is the number the review showed you.",
  intendedAtInvalid: "State the intended instant as an ISO-8601 instant carrying an offset, so the hours this notice stays useful for run from the moment the worker meant.",
  pageInvalid: "State the page as a whole number from 0, the first page.",
  pageSizeInvalid: "State the page size as a whole number.",
} as const;
// The read side: the closed query grammar this transport admits
type SendResultQuery = Parameters<typeof reads.audience.readSendResult>[0];
function wholeNumber(message: string) {
  return z
    .string()
    .regex(/^\d{1,9}$/, message)
    .transform((value) => Number(value));
}
// One named intent, optionally one page of it: every other name a request may carry is refused rather than dropped, so no per-person selector can narrow or widen who the recorded rows describe.
const sendResultQuerySchema = z.strictObject({ intentId: z.string({ error: MESSAGES.intentRequired }).trim().min(1, MESSAGES.intentRequired), page: wholeNumber(MESSAGES.pageInvalid).optional(), pageSize: wholeNumber(MESSAGES.pageSizeInvalid).optional() }, { error: MESSAGES.queryShape });
type SendResultQueryParams = z.output<typeof sendResultQuerySchema>;
function rawSendResultParams(search: URLSearchParams): Record<string, unknown> {
  // Every name the request stated is handed to the closed schema above, so the schema decides which names this read admits instead of a helper quietly discarding the rest.
  const stated: Record<string, unknown> = {};
  for (const name of new Set(search.keys())) {
    const values = search.getAll(name);
    stated[name] = values.length === 1 ? values[0] : values;
  }
  return stated;
}
function sendResultQueryOf(params: SendResultQueryParams): SendResultQuery {
  return { intentId: params.intentId, ...(params.page === undefined ? {} : { page: params.page }), ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }) };
}
// The write side: one notice, named by the edition it is about and the instant it was meant for
const identifierOf = (message: string) => z.string({ error: message }).trim().min(1, message);
const noticeSchema = z.strictObject(
  {
    documentId: identifierOf(MESSAGES.documentRequired),
    variantId: identifierOf(MESSAGES.releaseInvalid).optional(),
    releaseId: identifierOf(MESSAGES.releaseInvalid).optional(),
    acknowledgedCeiling: z.number({ error: MESSAGES.ceilingInvalid }).int(MESSAGES.ceilingInvalid).min(0, MESSAGES.ceilingInvalid).optional(),
    intendedAt: z.iso.datetime({ offset: true, error: MESSAGES.intendedAtInvalid }).optional(),
  },
  { error: MESSAGES.bodyNotJson },
);
// The four-field envelope — the attempt's operation id, the scope it claims, the revision the caller read and the notice itself — comes from the shared schema, so this transport states the same identity, claim and revision token as every other mutation instead of a second shape of its own.
const notifyRequestSchema = mutationInputSchema(noticeSchema);
/** Reads the per-recipient results of one notification intent, each recipient's one pinned rendition included. */
export async function GET(request: NextRequest): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const params = sendResultQuerySchema.safeParse(rawSendResultParams(search));
  if (!params.success) {
    // A name this read does not admit is a request-level refusal answered with the same per-field refusal the misspoken writes answer: no source behind the read failed, and the outcome module keys each name it does not admit at the field path that carries it.
    return toResponse(refusedRead(READ_ATTEMPT_MARKER, params.error));
  }
  try {
    return toResponse(await reads.audience.readSendResult(sendResultQueryOf(params.data)));
  } catch (error) {
    // One mapper knows a store outage, an unestablished session and a lost acknowledgement apart, so a thrown fault is answered rather than escaping the boundary as a stack.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
/** Submits one deliberate notice for one published edition. */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await jsonBodyOf(request);
  const operationId = operationIdentityOf(body);
  const parsed = notifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    // Who is eligible, which single rendition each of them is pinned to, how long the notice stays useful and how a repeated attempt is recognised are all the service's to decide at command time; this handler forwards the decision the review screen made and answers with the one outcome.
    return toResponse(await mutations.updates.requestNotification(sessionIdOf(request), parsed.data));
  } catch (error) {
    // A definite outage, an unestablished session and an effect whose fate is unknown each map to their own outcome; none of them becomes an empty result, a zero, or a stack on the wire.
    return toResponse(outcomeFromError(operationId, error));
  }
}
