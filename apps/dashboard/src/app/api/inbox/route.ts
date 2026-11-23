import { reads } from "@/modules/data-service";
import { pagingParamsOf, pagingQuerySchema } from "../paging";
import { readGrammar, readRoute } from "../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  pageInvalid: "Read the page as a whole number of one or more, so the messages arrive on the page you asked for rather than one this read chose.",
  pageSizeInvalid: "Read the page size as a whole number of one or more, so the messages arrive in pages of the size you asked for; the service applies its own cap.",
} as const;
const inboxQuerySchema = pagingQuerySchema({ page: MESSAGES.pageInvalid, pageSize: MESSAGES.pageSizeInvalid });
/** Reads one page of this reader's inbox, one message per recipient and notification intent. */
export const GET = readRoute(readGrammar(inboxQuerySchema, pagingParamsOf), (params) => reads.audience.readInbox(params));
