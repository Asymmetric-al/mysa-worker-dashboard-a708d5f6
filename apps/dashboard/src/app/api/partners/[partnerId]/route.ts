/** `GET /api/partners/[partnerId]` — the three named reads of one partner record: its shared facts (identity, the contact methods this caller may use, restrictions, relationship context, open work and the authorised support history), the caller's own private preparation, and the activity that actually happened; and, for a caller that names no read, the record body folded into one envelope. */
import { outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { pagingParamsOf, pagingQuerySchema } from "../../paging";
/** The store keeps session documents on the local filesystem, so this handler is never an edge one. */
export const runtime = "nodejs";
/** Scope comes from the session cookie and every boundary is judged at the scenario clock of this request, so no answer may be served from a cache across a context switch. */
export const dynamic = "force-dynamic";
const READ_ATTEMPT_ID = "read";
// The three named reads this one record path serves, named in the query string the way the roster path names its own jobs: AAP 0.6.3 declares this record path and no second one, and the record's shared facts, the caller's own private preparation and the activity that actually happened are three reads rather than one. A caller that names one is answered that read alone, so a private section is never folded into a shared
// one and each answer keeps its own revision, coverage and actions; a caller that names none is answered the folded body this path has always given.
const RECORD_READ_JOB = "record";
const PREPARATION_READ_JOB = "preparation";
const INTERACTIONS_READ_JOB = "interactions";
/** Whether a value names one of the three reads above. */
function admitsJob(job: string): boolean {
  return job === RECORD_READ_JOB || job === PREPARATION_READ_JOB || job === INTERACTIONS_READ_JOB;
}
const INTERACTIONS_PAGING_MESSAGES = { page: "State the page of recorded activity as a whole number from 1, the first page a person reads.", pageSize: "State how many records of activity one page holds as a whole number." };
const interactionsQuerySchema = pagingQuerySchema(INTERACTIONS_PAGING_MESSAGES);
/** The first page as this transport states it: a person counts pages from one, and the activity read counts the window it is given from zero. */
const FIRST_PAGE = 1;
interface PartnerRecordParams {
  readonly partnerId: string;
}
/** Answers the read the request names — the record's shared facts, the caller's own private preparation, or the activity that actually happened — or, when it names none, the record body folded into one envelope by the service's own record read; and answers `denied` or `unavailable` for a refusal or an outage. */
export async function GET(request: Request, context: { params: Promise<PartnerRecordParams> }): Promise<Response> {
  try {
    // Next 16 hands a dynamic segment over as a promise. The value is opaque: it reaches the read exactly as it arrived and is never decoded, parsed, matched against a name or an address, or treated as a path.
    const { partnerId } = await context.params;
    const search = new URL(request.url).searchParams;
    const job = search.get("job");
    if (job !== null && !admitsJob(job)) {
      // A job this path does not serve is the request's own fault, answered as the field-keyed refusal a malformed query gets: answering the folded body instead would hand the caller something other than the read it named.
      return toResponse(refusedRead(READ_ATTEMPT_ID, { job: [`This path serves the record, preparation and interactions reads of one partner. The job "${job}" names no read here, so nothing was read.`] }));
    }
    if (job === PREPARATION_READ_JOB) {
      return toResponse(await reads.partners.readPrivatePreparation({ partnerId }));
    }
    if (job === INTERACTIONS_READ_JOB) {
      const grammar = interactionsQuerySchema.safeParse(pagingParamsOf(search));
      if (!grammar.success) {
        // A paging value this read does not admit is a request-level refusal rather than an outage: no source behind the read failed, and the caller has to be told which parameter to correct.
        return toResponse(refusedRead(READ_ATTEMPT_ID, grammar.error));
      }
      const { page, pageSize } = grammar.data;
      const window = page === undefined && pageSize === undefined ? undefined : { index: (page ?? FIRST_PAGE) - FIRST_PAGE, ...(pageSize === undefined ? {} : { size: pageSize }) };
      return toResponse(await reads.interactions.readInteractions({ partnerId, ...(window === undefined ? {} : { page: window }) }));
    }
    if (job === RECORD_READ_JOB) {
      return toResponse(await reads.partners.readPartner(partnerId));
    }
    // No job was named, so the folded body is the one answer this path can mean: the record, its activity and the caller's own preparation in one envelope, folded by the service rather than by this door.
    return toResponse(await reads.partners.readPartnerRecord(partnerId));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known. A read attempted no effect, so the outcome carries the marker rather than a fabricated operation id.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
