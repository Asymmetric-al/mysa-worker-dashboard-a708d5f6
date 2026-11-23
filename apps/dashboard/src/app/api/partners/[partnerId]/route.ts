import { reads, refusedRead, toResponse } from "@/modules/data-service";
import { pagingParamsOf, pagingQuerySchema } from "../../paging";
import { READ_ATTEMPT, readResponse } from "../../read";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RECORD_READ_JOB = "record";
const PREPARATION_READ_JOB = "preparation";
const INTERACTIONS_READ_JOB = "interactions";
const ADMITTED_JOBS: ReadonlySet<string> = new Set([RECORD_READ_JOB, PREPARATION_READ_JOB, INTERACTIONS_READ_JOB]);
const INTERACTIONS_PAGING_MESSAGES = { page: "State the page of recorded activity as a whole number from 1, the first page a person reads.", pageSize: "State how many records of activity one page holds as a whole number." };
const interactionsQuerySchema = pagingQuerySchema(INTERACTIONS_PAGING_MESSAGES);
const FIRST_PAGE = 1;
type PartnerRecordParams = { readonly partnerId: string };
const activityWindowOf = (page: number | undefined, pageSize: number | undefined) => (page === undefined && pageSize === undefined ? undefined : { index: (page ?? FIRST_PAGE) - FIRST_PAGE, ...(pageSize === undefined ? {} : { size: pageSize }) });
/** Answers the read the request names — the record's shared facts, the caller's own private preparation, or the activity that actually happened — or, when it names none, the record body folded into one envelope by the service's own record read. */
async function readPartnerRecord(request: Request, context: { params: Promise<PartnerRecordParams> }): Promise<Response> {
  const { partnerId } = await context.params;
  const search = new URL(request.url).searchParams;
  const job = search.get("job");
  if (job !== null && !ADMITTED_JOBS.has(job)) return toResponse(refusedRead(READ_ATTEMPT, { job: [`This path serves the record, preparation and interactions reads of one partner. The job "${job}" names no read here, so nothing was read.`] }));
  if (job === PREPARATION_READ_JOB) return readResponse(READ_ATTEMPT, () => reads.partners.readPrivatePreparation({ partnerId }));
  if (job === INTERACTIONS_READ_JOB) {
    const grammar = interactionsQuerySchema.safeParse(pagingParamsOf(search));
    if (!grammar.success) return toResponse(refusedRead(READ_ATTEMPT, grammar.error));
    const window = activityWindowOf(grammar.data.page, grammar.data.pageSize);
    return readResponse(READ_ATTEMPT, () => reads.interactions.readInteractions({ partnerId, ...(window === undefined ? {} : { page: window }) }));
  }
  if (job === RECORD_READ_JOB) return readResponse(READ_ATTEMPT, () => reads.partners.readPartner(partnerId));
  return readResponse(READ_ATTEMPT, () => reads.partners.readPartnerRecord(partnerId));
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readPartnerRecord });
