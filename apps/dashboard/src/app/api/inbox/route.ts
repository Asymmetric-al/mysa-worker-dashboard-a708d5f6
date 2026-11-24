import { routeMethods } from "@/app/api/methods";
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
const readInbox = readRoute(readGrammar(inboxQuerySchema, pagingParamsOf), (params) => reads.audience.readInbox(params));
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readInbox });
