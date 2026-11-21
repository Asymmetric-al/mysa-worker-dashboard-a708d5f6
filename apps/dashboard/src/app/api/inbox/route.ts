/** `GET /api/inbox` — the receiving persona's synthetic inbox: one produced message per recipient and notification intent, each carrying its rendered HTML beside its plain-text rendition. */
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { pagingParamsOf, pagingQuerySchema } from "../paging";
/** The store behind the service reads its session documents through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, so an unsubscribe takes effect on the very next read rather than in a stored render. */
export const dynamic = "force-dynamic";
const READ_ATTEMPT_MARKER = "read";
const MESSAGES = {
  pageInvalid: "Read the page as a whole number of one or more, so the messages arrive on the page you asked for rather than one this read chose.",
  pageSizeInvalid: "Read the page size as a whole number of one or more, so the messages arrive in pages of the size you asked for; the service applies its own cap.",
} as const;
const inboxQuerySchema = pagingQuerySchema({ page: MESSAGES.pageInvalid, pageSize: MESSAGES.pageSizeInvalid });
/** Reads one page of this reader's inbox, one message per recipient and notification intent. */
export async function GET(request: Request): Promise<Response> {
  // Only a paging window is taken from the URL. The recipient is the session the service resolves, never a parameter, so no request can address another reader's inbox — and nothing here echoes a value back, since an inbox may hold an address, a subject and a message body.
  const search = new URL(request.url).searchParams;
  try {
    const grammar = inboxQuerySchema.safeParse(pagingParamsOf(search));
    if (!grammar.success) {
      // A paging value this read does not admit is a request-level refusal answered with the per-field `invalid` outcome every paging read answers, because no source behind the read failed and the caller has to be told which parameter to correct.
      return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, grammar.error));
    }
    return toResponse(await reads.audience.readInbox(grammar.data));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers its refusals as results, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
