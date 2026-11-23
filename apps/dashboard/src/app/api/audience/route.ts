import { z } from "zod";
import { mutationInputSchema, mutations, reads } from "@/modules/data-service";
import { writeRoute } from "../handler";
import { readGrammar, readRoute } from "../read";
import { wholePageParameter } from "../paging";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type SignupPayload = Parameters<typeof mutations.audience.signupForPurpose>[0]["payload"];
const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;
const audienceQuerySchema = z.strictObject({
  publisherId: z.string().min(1, "Name the publisher whose audience to read, or omit it and the read answers for the single publisher of this session's Updates.").max(200, "A publisher reference is at most 200 characters.").optional(),
  page: wholePageParameter("State the page as a whole number: pages start at 1, and a lower number is read as the first page.").optional(),
  pageSize: wholePageParameter("State the page size as a whole number: the read answers 50 rows by default and caps at 200.").optional(),
});
const signupPayloadSchema = z.strictObject({
  publisherId: z.string().min(1, "A signup names the publisher whose Update email it asks for.").max(200, "A publisher reference is at most 200 characters."),
  purpose: z.custom<SignupPayload["purpose"]>((stated) => typeof stated === "string" && stated.length > 0 && stated.length <= 200, { error: "A signup states the communication purpose it asks for; the service names the purposes this release keeps memberships for and refuses any other." }),
  email: z.email("This is not a complete email address. The address is stored as a value on the membership and is never used to find, merge or link a record."),
  displayName: z.string().min(1, "A display name is at least one character, or left out.").max(120, "A display name is at most 120 characters.").optional(),
  languagePreference: z.string().regex(LANGUAGE_TAG_SHAPE, "A language preference is a BCP-47 tag such as en, fr-CA or ar.").max(35, "A language tag is at most 35 characters.").optional(),
});
const signupRequestSchema = mutationInputSchema(signupPayloadSchema);
/** Answers with one envelope for the publisher's audience: the four membership states, the eligible and excluded counts, every exclusion reason, and one page of members. */
export const GET = readRoute(
  readGrammar(audienceQuerySchema, (search) => ({ publisherId: search.get("publisherId") ?? undefined, page: search.get("page") ?? undefined, pageSize: search.get("pageSize") ?? undefined })),
  (query) => reads.audience.readAudience(query),
);
/** Opens one purpose-specific membership for the caller, leaves it `awaiting-proof`, and answers with whichever of the service's eight outcomes the attempt produced. */
export const POST = (request: Request): Promise<Response> => writeRoute(request, signupRequestSchema, mutations.audience.signupForPurpose);
