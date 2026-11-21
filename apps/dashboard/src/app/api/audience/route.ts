/** `GET /api/audience` — the publisher's audience for the one purpose this release keeps memberships for — and `POST /api/audience`, the deliberate signup that opens the synthetic proof step. */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../handler";
/** The store behind the service reads and writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** The read depends on the development session, the selected context and the scenario clock, so no envelope may be cached across a persona switch, a restriction or a clock change. */
export const dynamic = "force-dynamic";
/** The attempt a read that never reached a mutation reports under: a read makes no operation identity of its own. */
const READ_ATTEMPT_ID = "read";
// The read: the publisher's audience for the one purpose this release keeps memberships for
/** The query the audience read accepts, taken from the read itself so this handler cannot drift from it. */
type AudienceQuery = NonNullable<Parameters<typeof reads.audience.readAudience>[0]>;
const WHOLE_NUMBER_SHAPE = /^\d{1,9}$/;
function wholeNumber(message: string) {
  return z
    .string()
    .regex(WHOLE_NUMBER_SHAPE, message)
    .transform((value) => Number.parseInt(value, 10));
}
const audienceQuerySchema = z.strictObject({
  publisherId: z.string().min(1, "Name the publisher whose audience to read, or omit it and the read answers for the single publisher of this session's Updates.").max(200, "A publisher reference is at most 200 characters.").optional(),
  page: wholeNumber("State the page as a whole number: pages start at 1, and a lower number is read as the first page.").optional(),
  pageSize: wholeNumber("State the page size as a whole number: the read answers 50 rows by default and caps at 200.").optional(),
});
type AudienceQueryParams = z.output<typeof audienceQuerySchema>;
/** Reads only the three parameters the audience read declares. */
function rawAudienceParams(search: URLSearchParams): Record<string, unknown> {
  return { publisherId: search.get("publisherId") ?? undefined, page: search.get("page") ?? undefined, pageSize: search.get("pageSize") ?? undefined };
}
/** Forwards the parameters as the read declares them, omitting the ones the caller left out rather than stating an empty value the read would have to interpret. */
function audienceQueryOf(params: AudienceQueryParams): AudienceQuery {
  return { ...(params.publisherId === undefined ? {} : { publisherId: params.publisherId }), ...(params.page === undefined ? {} : { page: params.page }), ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }) };
}
/** Answers with one envelope for the publisher's audience: the four membership states, the eligible and excluded counts, every exclusion reason, and one page of members. */
export async function GET(request: Request): Promise<Response> {
  const params = audienceQuerySchema.safeParse(rawAudienceParams(new URL(request.url).searchParams));
  if (!params.success) {
    return toResponse(refusedRead(READ_ATTEMPT_ID, params.error));
  }
  try {
    return toResponse(await reads.audience.readAudience(audienceQueryOf(params.data)));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers its refusals as results, so a throw means a store or medium fault, or a failure whose fate is not known. The read attempted no effect, so the outcome carries the read's marker rather than an operation id.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
// The write: the deliberate signup that opens the proof step and grants nothing
/** The mutation's own payload type, read from the mutation so this handler states no second vocabulary. */
type SignupInput = Parameters<typeof mutations.audience.signupForPurpose>[0];
type SignupPayload = SignupInput["payload"];
const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;
const signupPayloadSchema = z.strictObject({
  publisherId: z.string().min(1, "A signup names the publisher whose Update email it asks for.").max(200, "A publisher reference is at most 200 characters."),
  // The purposes this release keeps memberships for are declared once, in the audience module, and the service refuses any other with its own message. This field is checked for presence and size here and typed from the mutation's payload, so the closed vocabulary is never listed a second time.
  purpose: z.custom<SignupPayload["purpose"]>((stated) => typeof stated === "string" && stated.length > 0 && stated.length <= 200, { error: "A signup states the communication purpose it asks for; the service names the purposes this release keeps memberships for and refuses any other." }),
  // The address is a value the membership stores. Nothing here or behind it finds, merges or links a record by it, and no handler may be given a way to look a reader up by it.
  email: z.email("This is not a complete email address. The address is stored as a value on the membership and is never used to find, merge or link a record."),
  displayName: z.string().min(1, "A display name is at least one character, or left out.").max(120, "A display name is at most 120 characters.").optional(),
  // The reading language stands on its own: it records no consent, proves no address and confirms nothing, so a change of language subscribes nobody and completes no proof.
  languagePreference: z.string().regex(LANGUAGE_TAG_SHAPE, "A language preference is a BCP-47 tag such as en, fr-CA or ar.").max(35, "A language tag is at most 35 characters.").optional(),
});
/** The one schema for this mutation: the shared four-field request envelope — operation id, claimed scope, expected revision and payload — around the payload above. */
const signupRequestSchema = mutationInputSchema(signupPayloadSchema);
/** Opens one purpose-specific membership for the caller, leaves it `awaiting-proof`, and answers with whichever of the service's eight outcomes the attempt produced. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = signupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.audience.signupForPurpose(parsed.data));
  } catch (error) {
    // A throw is a defect rather than a presentation: the mutation answers its refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known. The first becomes `unavailable`; the second becomes `unknown` carrying the operation id, so the caller re-queries the
    // same identity instead of sending again.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
